import * as THREE from "three";

import type EngineRuntime from "@stem/editor-oss/EngineRuntime";
import { BehaviorCodeValidator } from "@stem/editor-oss/agent/validation/BehaviorCodeValidator";
import {
  emptyAssetResolutionContext,
  getAssetResolutionContext,
  type ReadonlyAssetResolutionContext,
} from "@stem/editor-oss/asset-management/AssetResolutionContext";
import { traverseObjectDepthFirst } from "@stem/editor-oss/utils/SceneTraverser";
import type {
  CopilotPreviewSession,
  CopilotValidationResult,
  CopilotValidationStatus,
} from "./copilotPreviewSession";
import { getCopilotPreviewRuntimeErrors } from "./copilotPreviewRuntimeErrors";

type ScriptRegistryLike = {
  getScripts?: () => Record<string, string>;
};

type EditorValidationContext = {
  behaviorScriptRegistry?: ScriptRegistryLike;
  isMultiplayer?: boolean;
};

type GameValidationContext = {
  lambdaScripts?: Record<string, string>;
};

export type CopilotPreviewImpactSummary = {
  beforeAfterHighlights: string[];
  estimatedImpact: string;
};

const validationStatusPriority: Record<CopilotValidationStatus, number> = {
  fail: 4,
  warn: 3,
  pending: 2,
  pass: 1,
};

const worstStatus = (
  left: CopilotValidationStatus,
  right: CopilotValidationStatus,
): CopilotValidationStatus =>
  validationStatusPriority[left] >= validationStatusPriority[right]
    ? left
    : right;

const getSceneObjectCount = (scene: THREE.Scene | null | undefined): number => {
  if (!scene) return 0;
  let count = 0;
  traverseObjectDepthFirst(scene, () => count++, { includeRoot: false });
  return count;
};

const hasFiniteCameraState = (
  camera: THREE.Camera | null | undefined,
): boolean => {
  if (!camera) return false;
  const position = camera.position;
  return (
    Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    Number.isFinite(position.z)
  );
};

const isPlayerCandidate = (object: THREE.Object3D): boolean => {
  const name = object.name?.trim().toLowerCase();
  if (
    name === "player" ||
    name === "camera target" ||
    object.userData?.isPlayer === true ||
    object.userData?.player === true
  ) {
    return true;
  }
  if (!Array.isArray(object.userData?.tags)) return false;
  return object.userData.tags.some(
    (tag: unknown) => String(tag).toLowerCase() === "player",
  );
};

type SceneValidationFacts = {
  objectCount: number;
  playerCandidate: THREE.Object3D | null;
  hasPhysicsObjects: boolean;
};

const collectSceneValidationFacts = (
  scene: THREE.Scene | null | undefined,
): SceneValidationFacts => {
  const facts: SceneValidationFacts = {
    objectCount: 0,
    playerCandidate: null,
    hasPhysicsObjects: false,
  };
  if (!scene) return facts;

  traverseObjectDepthFirst(
    scene,
    (object) => {
      facts.objectCount++;
      if (!facts.playerCandidate && isPlayerCandidate(object))
        facts.playerCandidate = object;
      if (!facts.hasPhysicsObjects) {
        facts.hasPhysicsObjects = Boolean(
          object.userData?.physics ||
          object.userData?.physicsConfig ||
          object.userData?.rigidBody,
        );
      }
    },
    { includeRoot: false },
  );
  return facts;
};

type ScriptValidationOptions = {
  scripts: Record<string, string>;
  kind: "behavior" | "lambda";
  id: string;
  label: string;
  emptyDetail: string;
  noun: string;
};

const validateScripts = ({
  scripts,
  kind,
  id,
  label,
  emptyDetail,
  noun,
}: ScriptValidationOptions): CopilotValidationResult => {
  const validator = new BehaviorCodeValidator();
  let status: CopilotValidationStatus = "pass";
  let scriptCount = 0;
  let errorCount = 0;
  let warningCount = 0;
  const failedScripts: string[] = [];

  for (const [scriptId, code] of Object.entries(scripts)) {
    if (typeof code !== "string" || code.trim().length === 0) continue;
    scriptCount++;
    const result = validator.validate(code, kind);
    errorCount += result.errorCount;
    warningCount += result.warningCount + result.infoCount;
    if (result.errorCount > 0) {
      status = worstStatus(status, "fail");
      if (failedScripts.length < 3) failedScripts.push(scriptId);
    } else if (result.warningCount > 0 || result.infoCount > 0) {
      status = worstStatus(status, "warn");
    }
  }

  if (scriptCount === 0) {
    return { id, label, status: "pass", detail: emptyDetail };
  }
  return {
    id,
    label,
    status,
    detail:
      status === "fail"
        ? `${errorCount} error${errorCount === 1 ? "" : "s"} in ${failedScripts.join(", ")}.`
        : warningCount > 0
          ? `${warningCount} warning${warningCount === 1 ? "" : "s"} across ${scriptCount} ${noun}${scriptCount === 1 ? "" : "s"}.`
          : `${scriptCount} ${noun}${scriptCount === 1 ? "" : "s"} passed.`,
  };
};

const collectBehaviorScripts = (app: EngineRuntime): Record<string, string> => {
  const editor = app.editor as EditorValidationContext | null | undefined;
  const registryScripts = editor?.behaviorScriptRegistry?.getScripts?.() ?? {};
  const sceneScripts =
    (app.scene?.userData?.scripts as Record<string, string> | undefined) ?? {};

  return {
    ...sceneScripts,
    ...registryScripts,
  };
};

const validateBehaviorScripts = (
  app: EngineRuntime,
): CopilotValidationResult => {
  return validateScripts({
    scripts: collectBehaviorScripts(app),
    kind: "behavior",
    id: "generated-code-static",
    label: "Generated code static checks",
    emptyDetail: "No scene-local behavior scripts detected.",
    noun: "script",
  });
};

const validateLambdaScripts = (app: EngineRuntime): CopilotValidationResult => {
  const game = app.game as GameValidationContext | null | undefined;
  return validateScripts({
    scripts: game?.lambdaScripts ?? {},
    kind: "lambda",
    id: "generated-lambda-static",
    label: "Generated lambda static checks",
    emptyDetail: "No loaded lambda scripts detected.",
    noun: "lambda script",
  });
};

const validateRuntimeErrors = (
  app: EngineRuntime,
  session?: CopilotPreviewSession | null,
): CopilotValidationResult => {
  const previewErrors = session
    ? getCopilotPreviewRuntimeErrors(
        session.previewId,
        new Date(session.startedAt).getTime(),
      )
    : [];

  if (previewErrors.length > 0) {
    return {
      id: "runtime-errors",
      label: "No blocking runtime errors",
      status: "fail",
      detail:
        previewErrors[previewErrors.length - 1]?.message ||
        "Runtime error detected during preview.",
    };
  }

  if (app.isPlaying && app.game) {
    return {
      id: "runtime-errors",
      label: "No blocking runtime errors",
      status: "pass",
      detail: "No runtime errors were captured while this preview was active.",
    };
  }

  return {
    id: "runtime-errors",
    label: "No blocking runtime errors",
    status: "pending",
    detail:
      "Start or restart playtest to capture runtime errors for this preview.",
  };
};

const countAssetRefs = (context: ReadonlyAssetResolutionContext): number => {
  const assetIds = new Set<string>();
  for (const assetId of Object.values(context.logicalIdToAssetId ?? {})) {
    if (assetId) assetIds.add(assetId);
  }
  for (const assetId of Object.keys(context.assetIdToRevisionId ?? {})) {
    if (assetId) assetIds.add(assetId);
  }
  for (const assetId of Object.values(context.nameToAssetId ?? {})) {
    if (assetId) assetIds.add(assetId);
  }
  return assetIds.size;
};

const validateAssetResolution = (
  app: EngineRuntime,
): CopilotValidationResult => {
  const context = app.scene
    ? (getAssetResolutionContext(app.scene) ?? emptyAssetResolutionContext)
    : emptyAssetResolutionContext;
  const logicalIdToAssetId = context.logicalIdToAssetId ?? {};
  const missingLogicalRefs: string[] = [];
  for (const [logicalId, assetId] of Object.entries(logicalIdToAssetId)) {
    if (!assetId && missingLogicalRefs.length < 3)
      missingLogicalRefs.push(logicalId);
  }
  const assetRefCount = countAssetRefs(context);

  if (missingLogicalRefs.length > 0) {
    return {
      id: "asset-resolution",
      label: "Asset references available",
      status: "warn",
      detail: `Missing asset ids for ${missingLogicalRefs.slice(0, 3).join(", ")}.`,
    };
  }

  return {
    id: "asset-resolution",
    label: "Asset references available",
    status: "pass",
    detail:
      assetRefCount > 0
        ? `${assetRefCount} referenced asset${assetRefCount === 1 ? "" : "s"} tracked in the scene context.`
        : "No external asset references detected.",
  };
};

type SnapshotSummary = {
  objectCount: number;
  scriptCount: number;
  gameEnabled: boolean;
};

const summarizeSnapshot = (session: CopilotPreviewSession): SnapshotSummary => {
  const summary: SnapshotSummary = {
    objectCount: 0,
    scriptCount: 0,
    gameEnabled: false,
  };
  for (const entry of session.snapshot.sceneJson) {
    if (!entry || typeof entry !== "object") continue;
    const value = entry as {
      uuid?: unknown;
      type?: unknown;
      source?: unknown;
      isBehaviorScript?: unknown;
      userData?: { game?: { enabled?: boolean } };
    };
    if (
      typeof value.uuid === "string" &&
      value.type !== "Scene" &&
      value.type !== "PerspectiveCamera" &&
      value.type !== "OrthographicCamera"
    ) {
      summary.objectCount++;
    }
    if (typeof value.source === "string" || value.isBehaviorScript === true) {
      summary.scriptCount++;
    }
    if (value.userData?.game?.enabled === true) summary.gameEnabled = true;
  }
  return summary;
};

const formatDelta = (before: number, after: number): string => {
  const delta = after - before;
  if (delta === 0) return "no change";
  return delta > 0 ? `+${delta}` : `${delta}`;
};

const summarizeImpactFromValidation = (
  validationResults: CopilotValidationResult[],
  objectDelta: number,
): string => {
  if (validationResults.some((result) => result.status === "fail")) {
    return "High: validation has blocking failures.";
  }
  if (
    validationResults.some(
      (result) => result.status === "warn" || result.status === "pending",
    )
  ) {
    return "Medium: review warnings and playtest before accepting.";
  }
  if (Math.abs(objectDelta) > 200) {
    return "Medium: object count changed enough to warrant performance testing.";
  }
  return "Low: structural checks passed with a small scene-level impact.";
};

export const summarizeCopilotPreviewImpact = (
  app: EngineRuntime,
  session: CopilotPreviewSession,
): CopilotPreviewImpactSummary => {
  const before = summarizeSnapshot(session);
  const afterObjectCount = getSceneObjectCount(app.scene);
  const afterScriptCount = Object.keys(collectBehaviorScripts(app)).length;
  const beforeAssetRefCount = countAssetRefs(
    session.snapshot.assetResolutionContext,
  );
  const currentAssetContext = app.scene
    ? (getAssetResolutionContext(app.scene) ?? emptyAssetResolutionContext)
    : emptyAssetResolutionContext;
  const afterAssetRefCount = countAssetRefs(currentAssetContext);
  const afterGameEnabled = app.scene?.userData?.game?.enabled === true;

  return {
    beforeAfterHighlights: [
      `Objects: ${before.objectCount} -> ${afterObjectCount} (${formatDelta(before.objectCount, afterObjectCount)})`,
      `Behavior scripts: ${before.scriptCount} -> ${afterScriptCount} (${formatDelta(before.scriptCount, afterScriptCount)})`,
      `Asset refs: ${beforeAssetRefCount} -> ${afterAssetRefCount} (${formatDelta(beforeAssetRefCount, afterAssetRefCount)})`,
      `Game enabled: ${before.gameEnabled ? "yes" : "no"} -> ${afterGameEnabled ? "yes" : "no"}`,
    ],
    estimatedImpact: summarizeImpactFromValidation(
      session.validationResults,
      afterObjectCount - before.objectCount,
    ),
  };
};

export const runCopilotPreviewValidation = (
  app: EngineRuntime,
  session?: CopilotPreviewSession | null,
): CopilotValidationResult[] => {
  const scene = app.scene;
  const { objectCount, playerCandidate, hasPhysicsObjects } =
    collectSceneValidationFacts(scene);
  const gameEnabled = scene?.userData?.game?.enabled;
  const cameraIsFinite = hasFiniteCameraState(app.camera);
  const editor = app.editor as EditorValidationContext | null | undefined;

  return [
    {
      id: "scene-loads",
      label: "Scene loads",
      status: scene && objectCount > 0 ? "pass" : "fail",
      detail: scene
        ? `${objectCount} scene object${objectCount === 1 ? "" : "s"} available.`
        : "No active scene is loaded.",
    },
    {
      id: "player-spawn",
      label: "Player can spawn",
      status: playerCandidate ? "pass" : "warn",
      detail: playerCandidate
        ? `Found ${playerCandidate.name || "player-tagged object"}.`
        : "No object named or tagged Player was found; camera-only games may still be valid.",
    },
    {
      id: "main-camera",
      label: "Main camera exists",
      status: cameraIsFinite ? "pass" : "fail",
      detail: cameraIsFinite
        ? "Camera position is valid."
        : "No usable main camera was found.",
    },
    {
      id: "game-enabled",
      label: "Game enabled",
      status: gameEnabled === true ? "pass" : "warn",
      detail:
        gameEnabled === true
          ? "Scene game mode is enabled."
          : "Default workspace playtest will enable game mode in memory before playing.",
    },
    validateAssetResolution(app),
    validateRuntimeErrors(app, session),
    {
      id: "physics-init",
      label: "Physics initializes",
      status:
        app.isPlaying && app.physics
          ? "pass"
          : hasPhysicsObjects
            ? "pending"
            : "pass",
      detail:
        app.isPlaying && app.physics
          ? "Physics runtime is active in playtest."
          : hasPhysicsObjects
            ? "Physics objects were found; restart playtest to confirm runtime initialization."
            : "No physics-enabled objects detected.",
    },
    validateBehaviorScripts(app),
    validateLambdaScripts(app),
    {
      id: "multiplayer-sync",
      label: "Multiplayer sync",
      status: editor?.isMultiplayer ? "pending" : "pass",
      detail: editor?.isMultiplayer
        ? "Multiplayer room sync needs a dedicated room validation pass."
        : "Single-player workspace preview.",
    },
    {
      id: "performance-budget",
      label: "Performance budget",
      status: objectCount > 1200 ? "warn" : "pass",
      detail:
        objectCount > 1200
          ? `${objectCount} objects may need performance testing.`
          : "Scene object count is within the lightweight preview budget.",
    },
  ];
};
