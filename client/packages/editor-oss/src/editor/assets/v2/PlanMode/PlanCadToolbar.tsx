import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ChangeEvent } from "react";
import type { IconType } from "react-icons";
import {
  TbArmchair,
  TbDoor,
  TbPointer,
  TbSquare,
  TbVectorTriangle,
  TbWall,
  TbWindow,
} from "react-icons/tb";
import { VscAdd, VscChevronUp, VscCheck, VscClose, VscTools } from "react-icons/vsc";
import styled from "styled-components";
import * as THREE from "three";

import {
  addPlanCadOpening,
  commitPlanCadSceneData,
  createPlanCadPart,
  createPlanCadPolygonSlab,
  createPlanCadPolygonZone,
  createPlanCadWall,
  findPlanCadNodeObject,
  getOrCreatePlanCadSceneData,
  getPlanCadSceneData,
  PLAN_CAD_PART_CATALOGS,
  PLAN_CAD_PART_PRESETS,
  planCadDataToState,
  planCadStateToData,
  syncPlanCadScene,
} from "./planCadEditorBridge";
import type {
  PlanCadPartPreset,
  PlanCadSceneData,
  PlanCadToolId,
} from "./planCadEditorBridge";
import {
  getPlanCadOpeningPlacement,
  planPointDistanceSq,
  snapPlanPointToGuides,
} from "./planCadGuides";
import type { PlanCadOpeningPlacement, PlanCadSnapResult } from "./planCadGuides";
import { createPlanNode } from "./planCadCore";
import type { PlanDisplayMode, PlanLevelNode } from "./planCadCore";
import {
  exportPlanCadDxf,
  exportPlanCadIfc,
  importPlanCadDxf,
  importPlanCadIfc,
} from "./planCadInterchange";
import {
  BuilderAnchorPill,
  BuilderModeLabel,
  BuilderPanelDivider as PanelDivider,
  BuilderSwatch as Swatch,
  BuilderToolButton as ToolButton,
  BuilderToolGroupButton,
  BuilderToolLabel as ToolLabel,
  BuilderToolMenuChevron as ToolMenuChevron,
  BuilderToolMenuGroup,
  BuilderToolMenuIcon as ToolMenuIcon,
  BuilderToolMenuItem as ToolMenuItem,
  BuilderToolMenuLabel as ToolMenuLabel,
  BuilderToolMenuSheet as ToolMenuSheet,
  BuilderToolMenuShortcut as ToolMenuShortcut,
  BuilderToolMenuText as ToolMenuText,
  BuilderToolbar,
  BuilderToolsCluster,
  builderToolbarToolColors,
  builderToolbarTokens,
  focusVisibleRing,
} from "../common/builderToolbar";
import { Tooltip } from "../common/Tooltip";
import {
  getSnappingSettings,
} from "../RightPanel/panels/ProjectSettings/constants";
import { isInputActive } from "../utils/isInputActive";
import type EngineRuntime from "@stem/editor-oss/EngineRuntime";
import global from "@stem/editor-oss/global";
import { getLogger } from "@stem/editor-oss/utils/Logger";

interface PlanCadToolbarProps {
  pinnedCodeEditorWidth?: number;
  onClose?: () => void;
}

type PlanCadTool = {
  id: PlanCadToolId;
  label: string;
  shortcut: string;
  color: string;
  Icon: IconType;
};

type PlanCadToolGroup = {
  id: string;
  label: string;
  tools: PlanCadTool[];
};

type PointerLike = { x: number; y: number };

type PlanCadRuntimeEditor = Partial<EngineRuntime["editor"]> & {
  scene?: THREE.Object3D;
  sceneHelpers?: THREE.Object3D;
  renderer?: { domElement?: HTMLElement | null };
  view?: string;
  camera?: THREE.Camera | null;
  orthCamera?: THREE.Camera | null;
  mouseAuxPosition?: PointerLike | null;
  gpuPickNum?: number;
  computeIntersectPoint?: (
    pointer: PointerLike,
    sceneHelpers?: THREE.Object3D,
  ) => THREE.Vector3 | null;
};

type PlanCadRuntime = Omit<EngineRuntime, "editor"> & {
  editor?: PlanCadRuntimeEditor;
  viewport?: HTMLElement | null;
  renderer?: { domElement?: HTMLElement | null };
};

function asPlanCadRuntime(app: EngineRuntime | PlanCadRuntime): PlanCadRuntime {
  return app as unknown as PlanCadRuntime;
}

function getPlanCadRuntime(): PlanCadRuntime | undefined {
  return global.app as unknown as PlanCadRuntime | undefined;
}

const PLAN_CAD_TOOLS: PlanCadTool[] = [
  {
    id: "select",
    label: "Select",
    shortcut: "V",
    color: builderToolbarToolColors.shared.select,
    Icon: TbPointer,
  },
  {
    id: "wall",
    label: "Wall",
    shortcut: "1",
    color: builderToolbarToolColors.planCad.wall,
    Icon: TbWall,
  },
  {
    id: "room",
    label: "Room",
    shortcut: "2",
    color: builderToolbarToolColors.planCad.room,
    Icon: TbSquare,
  },
  {
    id: "zone",
    label: "Zone",
    shortcut: "3",
    color: builderToolbarToolColors.planCad.zone,
    Icon: TbVectorTriangle,
  },
  {
    id: "door",
    label: "Door",
    shortcut: "4",
    color: builderToolbarToolColors.planCad.door,
    Icon: TbDoor,
  },
  {
    id: "window",
    label: "Window",
    shortcut: "5",
    color: builderToolbarToolColors.planCad.window,
    Icon: TbWindow,
  },
  {
    id: "part",
    label: "Object",
    shortcut: "6",
    color: builderToolbarToolColors.planCad.part,
    Icon: TbArmchair,
  },
];

const PLAN_CAD_PRIMARY_TOOLS = PLAN_CAD_TOOLS.filter(
  (tool) => tool.id === "select",
);

const PLAN_CAD_TOOL_GROUPS: PlanCadToolGroup[] = [
  {
    id: "structure",
    label: "Structure",
    tools: PLAN_CAD_TOOLS.filter((tool) =>
      ["wall", "room", "zone"].includes(tool.id),
    ),
  },
  {
    id: "openings",
    label: "Openings",
    tools: PLAN_CAD_TOOLS.filter((tool) =>
      ["door", "window"].includes(tool.id),
    ),
  },
  {
    id: "objects",
    label: "Objects",
    tools: PLAN_CAD_TOOLS.filter((tool) => ["part"].includes(tool.id)),
  },
];

const PLAN_CAD_SHORTCUTS: Record<string, PlanCadToolId> = {
  v: "select",
  "1": "wall",
  "2": "room",
  "3": "zone",
  "4": "door",
  "5": "window",
  "6": "part",
};

const PLAN_CAD_HINT_STORAGE_KEY = "stem:planCadHintDismissed";
const PLAN_DISPLAY_MODES: PlanDisplayMode[] = [
  "stacked",
  "exploded",
  "solo",
  "ghosted",
];

type PlanCadInterchangeKind = "json" | "dxf" | "ifc";
type PlanCadInterchangeStatus = {
  tone: "info" | "error";
  message: string;
};

const PLAN_CAD_INTERCHANGE_LABELS: Record<PlanCadInterchangeKind, string> = {
  json: "Plan JSON",
  dxf: "DXF (walls & polygons)",
  ifc: "IFC (basic)",
};

const PLAN_CAD_INTERCHANGE_EXTENSIONS: Record<PlanCadInterchangeKind, string> = {
  json: "json",
  dxf: "dxf",
  ifc: "ifc",
};

const PLAN_CAD_INTERCHANGE_MIME: Record<PlanCadInterchangeKind, string> = {
  json: "application/json",
  dxf: "application/dxf",
  ifc: "application/step",
};

function normalizePlanCadJsonImport(text: string): PlanCadSceneData {
  const raw = JSON.parse(text) as PlanCadSceneData;
  const state = planCadDataToState(raw);
  return {
    ...planCadStateToData(state, raw),
    selectedNodeId:
      raw.selectedNodeId && state.nodes[raw.selectedNodeId]
        ? raw.selectedNodeId
        : null,
  };
}

function serializePlanCadExport(
  kind: PlanCadInterchangeKind,
  data: PlanCadSceneData,
) {
  if (kind === "json") return JSON.stringify(data, null, 2);
  if (kind === "dxf") return exportPlanCadDxf(data);
  return exportPlanCadIfc(data);
}

function parsePlanCadImport(kind: PlanCadInterchangeKind, text: string) {
  if (kind === "json") return normalizePlanCadJsonImport(text);
  if (kind === "dxf") return importPlanCadDxf(text);
  return importPlanCadIfc(text);
}

function triggerPlanCadDownload(
  kind: PlanCadInterchangeKind,
  content: string,
) {
  const extension = PLAN_CAD_INTERCHANGE_EXTENSIONS[kind];
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([content], {
    type: `${PLAN_CAD_INTERCHANGE_MIME[kind]};charset=utf-8`,
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `stem-plan-cad-${date}.${extension}`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getQuickSnapIncrement(app: EngineRuntime | PlanCadRuntime): number {
  const grid = getSnappingSettings(asPlanCadRuntime(app).editor?.scene).grid;
  const increment = Number(grid?.enabled ? grid.increment : 0.25);
  return Number.isFinite(increment) && increment > 0 ? increment : 0.25;
}

function toPlanPoint(point: THREE.Vector3, increment: number) {
  return {
    x: Math.round(point.x / increment) * increment,
    z: Math.round(point.z / increment) * increment,
  };
}

function isPlanCadDebugEnabled() {
  const app = getPlanCadRuntime();
  if (app?.editor?.scene?.userData?.planCadDebug === true) return true;
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage?.getItem("stem:bimCadDebug") === "1";
  } catch {
    return false;
  }
}

function logPlanCad(
  stage: string,
  details?: Record<string, unknown>,
  level: "info" | "warn" = "info",
) {
  if (!isPlanCadDebugEnabled()) return;
  const logger = getLogger();
  const payload = details ? [details] : [];
  logger?.[level]?.(`[BIMCAD] ${stage}`, ...payload);
}

function disposePreview(object: THREE.Object3D | null) {
  if (!object) return;
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh && !(child as THREE.Line).isLine) return;
    (mesh.geometry as THREE.BufferGeometry | undefined)?.dispose?.();
    const material = mesh.material as THREE.Material | THREE.Material[];
    const materials = Array.isArray(material)
      ? material
      : material
        ? [material]
        : [];
    for (const item of materials) item.dispose();
  });
  object.parent?.remove(object);
}

function createLinePreview(
  start: { x: number; z: number },
  end: { x: number; z: number },
  color: THREE.ColorRepresentation,
) {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(start.x, 0.035, start.z),
    new THREE.Vector3(end.x, 0.035, end.z),
  ]);
  const material = new THREE.LineBasicMaterial({ color, linewidth: 2 });
  const line = new THREE.Line(geometry, material);
  line.userData.isPlanCadPreview = true;
  return line;
}

function createPolygonPreview(
  points: Array<{ x: number; z: number }>,
  color: THREE.ColorRepresentation,
) {
  if (points.length < 2) return null;
  const previewPoints = points.map(
    (point) => new THREE.Vector3(point.x, 0.035, point.z),
  );
  if (points.length >= 4) {
    const first = points[0]!;
    previewPoints.push(new THREE.Vector3(first.x, 0.035, first.z));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(previewPoints);
  const material = new THREE.LineBasicMaterial({ color, linewidth: 2 });
  const line = new THREE.Line(geometry, material);
  line.userData.isPlanCadPreview = true;
  return line;
}

function createOpeningPreview(
  placement: PlanCadOpeningPlacement,
  color: THREE.ColorRepresentation,
) {
  const halfWidth = 0.46;
  const dx = Math.cos(placement.angleRadians) * halfWidth;
  const dz = Math.sin(placement.angleRadians) * halfWidth;
  return createLinePreview(
    { x: placement.point.x - dx, z: placement.point.z - dz },
    { x: placement.point.x + dx, z: placement.point.z + dz },
    color,
  );
}

function createPartFootprintPreview(
  center: { x: number; z: number },
  preset: PlanCadPartPreset,
) {
  const halfX = preset.dimensions.x / 2;
  const halfZ = preset.dimensions.z / 2;
  return createPolygonPreview(
    [
      { x: center.x - halfX, z: center.z - halfZ },
      { x: center.x + halfX, z: center.z - halfZ },
      { x: center.x + halfX, z: center.z + halfZ },
      { x: center.x - halfX, z: center.z + halfZ },
    ],
    builderToolbarToolColors.planCad.part,
  );
}

function getFallbackIntersectPoint(
  app: EngineRuntime,
  event?: Event,
): THREE.Vector3 | null {
  const editor = asPlanCadRuntime(app).editor;
  if (typeof editor?.computeIntersectPoint !== "function") return null;
  const pointer =
    event instanceof MouseEvent
      ? { x: event.clientX, y: event.clientY }
      : editor.mouseAuxPosition;
  if (!pointer) return null;
  try {
    return editor.computeIntersectPoint(pointer, editor.sceneHelpers);
  } catch {
    return null;
  }
}

function getPlanCadViewport(app: EngineRuntime): HTMLElement | null {
  const runtime = asPlanCadRuntime(app);
  const candidates = [
    runtime.viewport,
    runtime.renderer?.domElement,
    runtime.editor?.renderer?.domElement,
    typeof document !== "undefined"
      ? document.getElementById("scene-container")
      : null,
  ];
  return (
    candidates.find(
      (candidate): candidate is HTMLElement => candidate instanceof HTMLElement,
    ) ?? null
  );
}

function getPointerPlanCadHit(
  app: EngineRuntime,
  event: MouseEvent | PointerEvent,
): { point: THREE.Vector3; object: THREE.Object3D | null } | null {
  const editor = asPlanCadRuntime(app).editor;
  const viewport = getPlanCadViewport(app);
  const camera =
    editor?.view === "perspective"
      ? editor?.camera
      : editor?.orthCamera || editor?.camera;
  const scene = editor?.scene as THREE.Scene | undefined;
  if (!editor || !viewport || !camera || !scene) {
    const point = getFallbackIntersectPoint(app, event);
    if (!point) {
      logPlanCad(
        "Pointer hit failed: no viewport/camera/scene fallback",
        {
          hasViewport: !!viewport,
          hasCamera: !!camera,
          hasScene: !!scene,
        },
        "warn",
      );
    }
    return point ? { point, object: null } : null;
  }

  const rect = viewport.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    logPlanCad(
      "Pointer hit failed: viewport has no size",
      { width: rect.width, height: rect.height },
      "warn",
    );
    return null;
  }

  const mouse = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);

  const sceneHelpers = editor.sceneHelpers as THREE.Object3D | undefined;
  const pickableChildren = scene.children.filter(
    (child) =>
      child !== sceneHelpers &&
      (!child.userData?.isRuntimeOnly || child.userData?.isPlanCadManaged) &&
      !child.userData?.isPlanCadPreview,
  );
  scene.updateMatrixWorld(true);
  const intersects = raycaster.intersectObjects(pickableChildren, true);
  if (intersects.length > 0) {
    const hit = intersects[0]!;
    return { point: hit.point.clone(), object: hit.object };
  }

  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const point = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(groundPlane, point)) {
    return { point, object: null };
  }

  return null;
}

export const PlanCadToolbar = ({
  pinnedCodeEditorWidth = 0,
  onClose,
}: PlanCadToolbarProps) => {
  const [activeTool, setActiveTool] = useState<PlanCadToolId>("select");
  const [openToolGroupId, setOpenToolGroupId] = useState<string | null>(null);
  const [anchorPoint, setAnchorPoint] = useState<{
    x: number;
    z: number;
  } | null>(null);
  const [polygonPoints, setPolygonPoints] = useState<
    Array<{ x: number; z: number }>
  >([]);
  const [planData, setPlanData] = useState<PlanCadSceneData | null>(() =>
    getPlanCadSceneData(
      (global.app as EngineRuntime | undefined)?.editor?.scene,
    ),
  );
  const [partPresetId, setPartPresetId] = useState(
    PLAN_CAD_PART_PRESETS[0]?.id ?? "",
  );
  const [showHint, setShowHint] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage?.getItem(PLAN_CAD_HINT_STORAGE_KEY) !== "1";
    } catch {
      return false;
    }
  });
  const [interchangeStatus, setInterchangeStatus] =
    useState<PlanCadInterchangeStatus | null>(null);
  const activeToolRef = useRef(activeTool);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const pendingImportKindRef = useRef<PlanCadInterchangeKind>("json");
  const anchorPointRef = useRef(anchorPoint);
  const polygonPointsRef = useRef(polygonPoints);
  const planDataRef = useRef(planData);
  const partPresetIdRef = useRef(partPresetId);
  const previewRef = useRef<THREE.Object3D | null>(null);
  const previewKeyRef = useRef("");
  const previousDisableClickEvents = useRef<boolean | null>(null);
  const selectedPartPreset =
    PLAN_CAD_PART_PRESETS.find((preset) => preset.id === partPresetId) ??
    PLAN_CAD_PART_PRESETS[0]!;
  const planLevels = Object.values(planData?.nodes ?? {})
    .filter((node): node is PlanLevelNode => node.type === "level")
    .sort((a, b) => a.index - b.index);
  const activeLevelId = planData?.activeLevelId ?? planLevels[0]?.id ?? "";
  const displayMode = planData?.displayMode ?? "stacked";
  const activeLevel =
    planLevels.find((level) => level.id === activeLevelId) ??
    planLevels[0] ??
    null;

  const setPolygonDraft = useCallback(
    (points: Array<{ x: number; z: number }>) => {
      polygonPointsRef.current = points;
      setPolygonPoints(points);
    },
    [],
  );

  const setAnchorDraft = useCallback(
    (point: { x: number; z: number } | null) => {
      anchorPointRef.current = point;
      setAnchorPoint(point);
    },
    [],
  );

  const resolvePlanPoint = useCallback(
    (
      app: EngineRuntime | PlanCadRuntime,
      rawPoint: THREE.Vector3,
    ): PlanCadSnapResult => {
      const increment = getQuickSnapIncrement(app);
      const gridPoint = toPlanPoint(rawPoint, increment);
      const snapThreshold = Math.max(0.18, Math.min(0.35, increment * 0.45));
      return snapPlanPointToGuides(
        planDataRef.current,
        gridPoint,
        snapThreshold,
      );
    },
    [],
  );

  const clearPreview = useCallback(() => {
    previewKeyRef.current = "";
    disposePreview(previewRef.current);
    previewRef.current = null;
  }, []);

  const refreshData = useCallback(() => {
    const app = global.app as EngineRuntime | undefined;
    const data = getPlanCadSceneData(app?.editor?.scene);
    planDataRef.current = data;
    setPlanData(data);
  }, []);

  const updatePreview = useCallback(
    (point: THREE.Vector3 | null) => {
      const app = getPlanCadRuntime();
      const helperScene = app?.editor?.sceneHelpers;
      const anchor = anchorPointRef.current;
      const polygon = polygonPointsRef.current;
      const tool = activeToolRef.current;
      if (!app || !helperScene || !point || tool === "select") {
        clearPreview();
        return;
      }

      const resolved = resolvePlanPoint(app, point);
      const current = resolved.point;
      const openingPlacement =
        tool === "door" || tool === "window"
          ? getPlanCadOpeningPlacement(
              planDataRef.current,
              current,
              undefined,
              Math.max(0.5, getQuickSnapIncrement(app) * 1.25),
            )
          : null;

      const previewKey = JSON.stringify({
        tool,
        current: [Number(current.x.toFixed(3)), Number(current.z.toFixed(3))],
        anchor: anchor
          ? [Number(anchor.x.toFixed(3)), Number(anchor.z.toFixed(3))]
          : null,
        polygon: polygon.map((item) => [
          Number(item.x.toFixed(3)),
          Number(item.z.toFixed(3)),
        ]),
        partPresetId: partPresetIdRef.current,
        opening: openingPlacement
          ? [
              openingPlacement.wallId,
              Number(openingPlacement.point.x.toFixed(3)),
              Number(openingPlacement.point.z.toFixed(3)),
            ]
          : null,
      });
      if (previewKeyRef.current === previewKey) return;

      clearPreview();
      previewKeyRef.current = previewKey;
      if (tool === "door" || tool === "window") {
        if (!openingPlacement) return;
        const preview = createOpeningPreview(
          openingPlacement,
          tool === "door"
            ? builderToolbarToolColors.planCad.door
            : builderToolbarToolColors.planCad.window,
        );
        helperScene.add(preview);
        previewRef.current = preview;
        return;
      }

      if (tool === "part") {
        const preset =
          PLAN_CAD_PART_PRESETS.find(
            (item) => item.id === partPresetIdRef.current,
          ) ?? PLAN_CAD_PART_PRESETS[0]!;
        const preview = createPartFootprintPreview(current, preset);
        if (preview) {
          helperScene.add(preview);
          previewRef.current = preview;
        }
        return;
      }

      if (tool !== "wall" && tool !== "room" && tool !== "zone") {
        return;
      }

      if (tool === "wall") {
        if (!anchor) return;
        const preview = createLinePreview(
          anchor,
          current,
          builderToolbarToolColors.planCad.wall,
        );
        helperScene.add(preview);
        previewRef.current = preview;
        return;
      }

      if (polygon.length === 0) return;
      const preview = createPolygonPreview(
        [...polygon, current],
        tool === "room"
          ? builderToolbarToolColors.planCad.room
          : builderToolbarToolColors.planCad.zone,
      );
      if (preview) {
        helperScene.add(preview);
        previewRef.current = preview;
      }
    },
    [clearPreview, resolvePlanPoint],
  );

  const commitMutation = useCallback(
    async (mutator: (data: PlanCadSceneData) => PlanCadSceneData) => {
      const app = global.app as EngineRuntime | undefined;
      const scene = app?.editor?.scene;
      if (!app || !scene) return false;
      const current = getOrCreatePlanCadSceneData(scene);
      const next = mutator(current);
      logPlanCad("Commit start", {
        nodeCount: Object.keys(next.nodes).length,
      });
      const didCommit = await commitPlanCadSceneData(app.editor, next);
      if (didCommit) {
        planDataRef.current = next;
        setPlanData(next);
        clearPreview();
        logPlanCad("Commit complete", {
          nodeCount: Object.keys(next.nodes).length,
          sceneChildren: scene.children.length,
        });
      }
      return didCommit;
    },
    [clearPreview],
  );

  const selectActiveLevel = useCallback(
    (levelId: string) => {
      if (!levelId) return;
      void commitMutation((data) => ({
        ...data,
        activeLevelId: levelId,
        selectedNodeId: levelId,
      }));
    },
    [commitMutation],
  );

  const addLevel = useCallback(() => {
    void commitMutation((data) => {
      const levels = Object.values(data.nodes)
        .filter((node): node is PlanLevelNode => node.type === "level")
        .sort((a, b) => a.index - b.index);
      const previousLevel = levels[levels.length - 1] ?? null;
      const building =
        (previousLevel?.parentId
          ? data.nodes[previousLevel.parentId]
          : undefined) ??
        Object.values(data.nodes).find((node) => node.type === "building");
      if (!building) return data;

      const index =
        levels.reduce((max, level) => Math.max(max, level.index), -1) + 1;
      const height = previousLevel?.height ?? 3;
      const elevation = previousLevel
        ? previousLevel.elevation + previousLevel.height
        : index * height;
      const level = createPlanNode("level", {
        parentId: building.id,
        name: `Level ${index + 1}`,
        elevation,
        height,
        index,
      });
      return {
        ...data,
        activeLevelId: level.id,
        selectedNodeId: level.id,
        nodes: {
          ...data.nodes,
          [building.id]: {
            ...building,
            children: [...building.children, level.id],
          },
          [level.id]: level,
        },
      };
    });
  }, [commitMutation]);

  const cycleDisplayMode = useCallback(() => {
    void commitMutation((data) => {
      const currentIndex = PLAN_DISPLAY_MODES.indexOf(
        data.displayMode ?? "stacked",
      );
      const nextMode =
        PLAN_DISPLAY_MODES[(currentIndex + 1) % PLAN_DISPLAY_MODES.length] ??
        "stacked";
      return {
        ...data,
        displayMode: nextMode,
      };
    });
  }, [commitMutation]);

  const handleExport = useCallback((kind: PlanCadInterchangeKind) => {
    const app = global.app as EngineRuntime | undefined;
    const scene = app?.editor?.scene;
    const label = PLAN_CAD_INTERCHANGE_LABELS[kind];
    if (!scene) {
      setInterchangeStatus({
        tone: "error",
        message: `${label} export failed: no active scene.`,
      });
      getLogger()?.error("[BIMCAD] Plan export failed", {
        format: label,
        error: "No active scene",
      });
      return;
    }

    try {
      const data = getOrCreatePlanCadSceneData(scene);
      triggerPlanCadDownload(kind, serializePlanCadExport(kind, data));
      setOpenToolGroupId(null);
      setInterchangeStatus({
        tone: "info",
        message: `Exported ${label}.`,
      });
    } catch (error) {
      const message = getErrorMessage(error);
      setInterchangeStatus({
        tone: "error",
        message: `${label} export failed: ${message}`,
      });
      getLogger()?.error("[BIMCAD] Plan export failed", {
        format: label,
        error: message,
      });
    }
  }, []);

  const requestImport = useCallback((kind: PlanCadInterchangeKind) => {
    pendingImportKindRef.current = kind;
    setOpenToolGroupId(null);
    importInputRef.current?.click();
  }, []);

  const handleImportFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (!file) return;

      const kind = pendingImportKindRef.current;
      const label = PLAN_CAD_INTERCHANGE_LABELS[kind];
      try {
        const nextData = parsePlanCadImport(kind, await file.text());
        const didCommit = await commitMutation(() => nextData);
        if (!didCommit) {
          throw new Error("Plan import could not be committed.");
        }
        setInterchangeStatus({
          tone: "info",
          message: `Imported ${label}.`,
        });
      } catch (error) {
        const message = getErrorMessage(error);
        setInterchangeStatus({
          tone: "error",
          message: `${label} import failed: ${message}`,
        });
        getLogger()?.error("[BIMCAD] Plan import failed", {
          format: label,
          error: message,
        });
      }
    },
    [commitMutation],
  );

  const activateTool = useCallback(
    (tool: PlanCadToolId) => {
      const previousTool = activeToolRef.current;
      activeToolRef.current = tool;
      setOpenToolGroupId(null);
      if (previousTool !== tool || tool === "select") {
        setAnchorDraft(null);
        setPolygonDraft([]);
        clearPreview();
      }
      setActiveTool(tool);
    },
    [clearPreview, setAnchorDraft, setPolygonDraft],
  );

  const cancelDraft = useCallback(() => {
    setAnchorDraft(null);
    setPolygonDraft([]);
    clearPreview();
  }, [clearPreview, setAnchorDraft, setPolygonDraft]);

  const removeLastPolygonPoint = useCallback(() => {
    const points = polygonPointsRef.current;
    if (points.length === 0) return false;
    const nextPoints = points.slice(0, -1);
    setPolygonDraft(nextPoints);
    if (nextPoints.length === 0) {
      clearPreview();
    }
    return true;
  }, [clearPreview, setPolygonDraft]);

  const finishPolygonDraft = useCallback(() => {
    const tool = activeToolRef.current;
    const points = polygonPointsRef.current;
    if ((tool !== "room" && tool !== "zone") || points.length < 3) return false;

    void commitMutation((data) =>
      tool === "room"
        ? createPlanCadPolygonSlab(data, points)
        : createPlanCadPolygonZone(data, points),
    ).then(() => {
      setPolygonDraft([]);
    });
    return true;
  }, [commitMutation, setPolygonDraft]);

  useLayoutEffect(() => {
    const previousTool = activeToolRef.current;
    activeToolRef.current = activeTool;
    if (previousTool !== activeTool || activeTool === "select") {
      setAnchorDraft(null);
      setPolygonDraft([]);
      clearPreview();
    }
  }, [activeTool, clearPreview, setAnchorDraft, setPolygonDraft]);

  useEffect(() => {
    planDataRef.current = planData;
  }, [planData]);

  useEffect(() => {
    anchorPointRef.current = anchorPoint;
  }, [anchorPoint]);

  useEffect(() => {
    polygonPointsRef.current = polygonPoints;
  }, [polygonPoints]);

  useEffect(() => {
    partPresetIdRef.current = partPresetId;
  }, [partPresetId]);

  useEffect(() => {
    if (!openToolGroupId) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (toolbarRef.current?.contains(event.target as Node)) return;
      setOpenToolGroupId(null);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [openToolGroupId]);

  useEffect(() => {
    const app = global.app as EngineRuntime | undefined;
    const scene = app?.editor?.scene;
    if (!app || !scene) return;

    const syncFromScene = (_source?: unknown, object?: THREE.Object3D) => {
      if (object && object !== scene) return;
      void syncPlanCadScene(app.editor, { source: _source }).then(
        ({ data }) => {
          planDataRef.current = data;
          setPlanData(data);
        },
      );
    };

    app.on("objectChanged.PlanCadToolbar", syncFromScene);
    app.on("planCadChanged.PlanCadToolbar", refreshData);
    syncFromScene(undefined, scene);

    return () => {
      app.on("objectChanged.PlanCadToolbar", null);
      app.on("planCadChanged.PlanCadToolbar", null);
    };
  }, [refreshData]);

  useEffect(() => {
    const app = global.app as EngineRuntime | undefined;
    if (!app) return;

    const shouldDisableEditorSelection = activeTool !== "select";
    if (shouldDisableEditorSelection) {
      if (previousDisableClickEvents.current === null) {
        previousDisableClickEvents.current = app.disableClickEvents;
      }
      app.disableClickEvents = true;
      return () => {
        if (previousDisableClickEvents.current !== null) {
          app.disableClickEvents = previousDisableClickEvents.current;
          previousDisableClickEvents.current = null;
        }
      };
    }

    if (previousDisableClickEvents.current !== null) {
      app.disableClickEvents = previousDisableClickEvents.current;
      previousDisableClickEvents.current = null;
    }
  }, [activeTool]);

  useEffect(() => {
    const app = getPlanCadRuntime();
    const editor = app?.editor;
    if (!app || !editor || activeTool === "select") {
      clearPreview();
      return;
    }

    editor.gpuPickNum = (editor.gpuPickNum ?? 0) + 1;
    app.on(
      "gpuPick.PlanCadToolbar",
      (intersect: { point?: THREE.Vector3 | null }) => {
        updatePreview(intersect?.point ?? null);
      },
    );

    return () => {
      app.on("gpuPick.PlanCadToolbar", null);
      editor.gpuPickNum = Math.max(0, (editor.gpuPickNum ?? 1) - 1);
      clearPreview();
    };
  }, [activeTool, clearPreview, updatePreview]);

  const handlePlanCadHit = useCallback(
    (
      intersect: {
        point?: THREE.Vector3 | null;
        object?: THREE.Object3D | null;
      },
      event?: Event,
      options: { commit?: boolean; source?: string } = {},
    ) => {
      const app = global.app as EngineRuntime | undefined;
      const tool = activeToolRef.current;
      if (!app || app.isPlaying || !app.editor) return;
      const rawPoint =
        intersect?.point ?? getFallbackIntersectPoint(app, event);
      if (!rawPoint) {
        logPlanCad("Hit ignored: missing point", { tool }, "warn");
        return;
      }

      const increment = getQuickSnapIncrement(app);
      const { point } = resolvePlanPoint(app, rawPoint);
      const planObject = findPlanCadNodeObject(intersect?.object);

      if (tool === "select") {
        logPlanCad("Select hit", {
          hasPlanObject: !!planObject,
          nodeId: planObject?.userData?.planNodeId ?? null,
        });
        if (planObject) {
          app.editor.select?.(planObject);
        }
        return;
      }

      if (!options.commit) {
        updatePreview(rawPoint);
        logPlanCad(
          "Raycast ignored without BIM commit marker",
          {
            tool,
            source: options.source ?? "event-bus",
          },
          "warn",
        );
        return;
      }

      event?.preventDefault?.();
      logPlanCad(
        "Viewport commit",
        {
          tool,
          source: options.source ?? "unknown",
          point: [point.x, point.z],
        },
        "warn",
      );

      if (tool === "wall" || tool === "room" || tool === "zone") {
        if (tool === "room" || tool === "zone") {
          const points = polygonPointsRef.current;
          const first = points[0];
          const shouldClose =
            points.length >= 3 &&
            !!first &&
            planPointDistanceSq(first, point) <=
              Math.max(increment * increment * 0.5, 0.0625);
          if (shouldClose) {
            finishPolygonDraft();
            return;
          }
          const last = points[points.length - 1];
          if (!last || planPointDistanceSq(last, point) > 0.0001) {
            setPolygonDraft([...points, point]);
          }
          return;
        }

        const anchor = anchorPointRef.current;
        if (!anchor) {
          setAnchorDraft(point);
          return;
        }

        void commitMutation((data) =>
          createPlanCadWall(data, anchor, point),
        ).then((didCommit) => {
          if (didCommit) setAnchorDraft(point);
        });
        return;
      }

      if (tool === "door" || tool === "window") {
        const wallId =
          planObject?.userData?.planNodeType === "wall"
            ? (planObject.userData.planNodeId as string)
            : undefined;
        const openingPlacement = getPlanCadOpeningPlacement(
          planDataRef.current,
          point,
          wallId,
          Math.max(0.5, increment * 1.25),
        );
        if (!openingPlacement) {
          clearPreview();
          return;
        }
        void commitMutation((data) =>
          addPlanCadOpening(
            data,
            openingPlacement.point,
            tool,
            openingPlacement.wallId,
          ),
        );
        return;
      }

      if (tool === "part") {
        void commitMutation((data) =>
          createPlanCadPart(data, point, {
            partPresetId: partPresetIdRef.current,
          }),
        );
      }
    },
    [
      clearPreview,
      commitMutation,
      finishPolygonDraft,
      resolvePlanPoint,
      setAnchorDraft,
      setPolygonDraft,
      updatePreview,
    ],
  );

  useEffect(() => {
    const app = global.app as EngineRuntime | undefined;
    if (!app) return;

    app.on(
      "raycast.PlanCadToolbar",
      (
        intersect: {
          point?: THREE.Vector3 | null;
          object?: THREE.Object3D | null;
        },
        event?: Event & { planCadCommit?: boolean },
      ) => {
        handlePlanCadHit(intersect, event, {
          commit: event?.planCadCommit === true,
          source: "event-bus",
        });
      },
    );

    return () => {
      app.on("raycast.PlanCadToolbar", null);
    };
  }, [handlePlanCadHit]);

  useEffect(() => {
    const app = global.app as EngineRuntime | undefined;
    const viewport = app ? getPlanCadViewport(app) : null;
    if (!app || !viewport) {
      logPlanCad(
        "Viewport listener unavailable",
        { hasApp: !!app, hasViewport: !!viewport },
        "warn",
      );
      return;
    }
    logPlanCad("Viewport listener attached", {
      viewportId: viewport.id || null,
      viewportClass: viewport.className || null,
    });

    let downPoint: { x: number; y: number } | null = null;
    let activePointerId: number | null = null;
    const activeTouchPointers = new Set<number>();
    let pendingPointerMove: PointerEvent | null = null;
    let pointerMoveFrame: number | null = null;
    let selectPointerCapturedPlanCad = false;

    const isPlanCadUi = (target: EventTarget | null) =>
      target instanceof Element &&
      !!target.closest("[data-plan-cad-ui='true']");

    const stopEditorClick = (event: MouseEvent | PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };

    const shouldIgnorePointer = (event: PointerEvent) =>
      (event.pointerType === "touch" && activeTouchPointers.size > 1) ||
      !event.isPrimary;

    const cancelScheduledPointerMove = () => {
      pendingPointerMove = null;
      if (pointerMoveFrame !== null) {
        window.cancelAnimationFrame(pointerMoveFrame);
        pointerMoveFrame = null;
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        activeTouchPointers.add(event.pointerId);
      }
      const activeTool = activeToolRef.current;
      if (
        event.button !== 0 ||
        shouldIgnorePointer(event) ||
        app.isPlaying ||
        !app.editor ||
        isPlanCadUi(event.target)
      ) {
        return;
      }
      if (activeTool === "select") {
        const hit = getPointerPlanCadHit(app, event);
        selectPointerCapturedPlanCad = !!findPlanCadNodeObject(hit?.object);
        if (!selectPointerCapturedPlanCad) return;
      }
      downPoint = { x: event.clientX, y: event.clientY };
      activePointerId = event.pointerId;
      viewport.setPointerCapture?.(event.pointerId);
      stopEditorClick(event);
    };

    const processPointerMove = (event: PointerEvent) => {
      if (activeToolRef.current === "select") {
        updatePreview(null);
        return;
      }
      if (
        app.isPlaying ||
        !app.editor ||
        shouldIgnorePointer(event) ||
        isPlanCadUi(event.target)
      )
        return;
      const hit = getPointerPlanCadHit(app, event);
      updatePreview(hit?.point ?? null);
    };

    const schedulePointerMove = (event: PointerEvent) => {
      pendingPointerMove = event;
      if (pointerMoveFrame !== null) return;
      pointerMoveFrame = window.requestAnimationFrame(() => {
        pointerMoveFrame = null;
        const latestPointerMove = pendingPointerMove;
        pendingPointerMove = null;
        if (latestPointerMove) {
          processPointerMove(latestPointerMove);
        }
      });
    };

    const handlePointerLeave = () => {
      cancelScheduledPointerMove();
      selectPointerCapturedPlanCad = false;
      updatePreview(null);
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        activeTouchPointers.delete(event.pointerId);
      }
      cancelScheduledPointerMove();
      if (!downPoint || activePointerId !== event.pointerId) return;
      const activeTool = activeToolRef.current;
      const capturedPlanCad = selectPointerCapturedPlanCad;
      selectPointerCapturedPlanCad = false;
      const distance = Math.hypot(
        event.clientX - downPoint.x,
        event.clientY - downPoint.y,
      );
      viewport.releasePointerCapture?.(event.pointerId);
      downPoint = null;
      activePointerId = null;
      if (
        event.button !== 0 ||
        distance > 4 ||
        shouldIgnorePointer(event) ||
        app.isPlaying ||
        !app.editor ||
        isPlanCadUi(event.target)
      )
        return;

      if (activeTool === "select" && !capturedPlanCad) return;
      stopEditorClick(event);
      const hit = getPointerPlanCadHit(app, event);
      if (hit) {
        handlePlanCadHit(hit, event, { commit: true, source: "viewport" });
      }
    };

    const handleDoubleClick = (event: MouseEvent) => {
      const tool = activeToolRef.current;
      if (
        (tool !== "room" && tool !== "zone") ||
        polygonPointsRef.current.length < 3
      )
        return;
      if (app.isPlaying || !app.editor || isPlanCadUi(event.target)) return;

      stopEditorClick(event);
      finishPolygonDraft();
    };

    const handlePointerCancel = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        activeTouchPointers.delete(event.pointerId);
      }
      cancelScheduledPointerMove();
      if (activePointerId === event.pointerId) {
        viewport.releasePointerCapture?.(event.pointerId);
        activePointerId = null;
        downPoint = null;
      }
      selectPointerCapturedPlanCad = false;
      updatePreview(null);
    };

    viewport.addEventListener("pointerdown", handlePointerDown, true);
    viewport.addEventListener("pointermove", schedulePointerMove, true);
    viewport.addEventListener("pointerleave", handlePointerLeave, true);
    viewport.addEventListener("pointercancel", handlePointerCancel, true);
    viewport.addEventListener("dblclick", handleDoubleClick, true);
    document.addEventListener("pointerup", handlePointerUp, true);

    return () => {
      cancelScheduledPointerMove();
      viewport.removeEventListener("pointerdown", handlePointerDown, true);
      viewport.removeEventListener("pointermove", schedulePointerMove, true);
      viewport.removeEventListener("pointerleave", handlePointerLeave, true);
      viewport.removeEventListener("pointercancel", handlePointerCancel, true);
      viewport.removeEventListener("dblclick", handleDoubleClick, true);
      document.removeEventListener("pointerup", handlePointerUp, true);
    };
  }, [finishPolygonDraft, handlePlanCadHit, updatePreview]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isInputActive())
        return;
      const key = event.key.toLowerCase();

      if (key === "escape") {
        event.preventDefault();
        if (openToolGroupId) {
          setOpenToolGroupId(null);
          return;
        }
        if (
          anchorPointRef.current ||
          polygonPointsRef.current.length > 0 ||
          previewRef.current
        ) {
          cancelDraft();
          return;
        }
        if (activeToolRef.current !== "select") {
          activateTool("select");
          return;
        }
        onClose?.();
        return;
      }

      if (key === "enter") {
        if (finishPolygonDraft()) event.preventDefault();
        return;
      }

      if (key === "backspace") {
        if (removeLastPolygonPoint()) event.preventDefault();
        return;
      }

      const next = PLAN_CAD_SHORTCUTS[key];
      if (!next) return;
      event.preventDefault();
      activateTool(next);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activateTool,
    cancelDraft,
    finishPolygonDraft,
    onClose,
    openToolGroupId,
    removeLastPolygonPoint,
  ]);

  const handleFinishPolygon = () => {
    finishPolygonDraft();
  };

  const handleCancelPolygon = () => {
    cancelDraft();
  };

  const handleClose = () => {
    activateTool("select");
    onClose?.();
  };

  const dismissHint = () => {
    setShowHint(false);
    try {
      window.localStorage?.setItem(PLAN_CAD_HINT_STORAGE_KEY, "1");
    } catch {
      /* localStorage can be unavailable in private/embedded contexts */
    }
  };

  const polygonDraftHint =
    polygonPoints.length > 0 ? "Backspace removes last point" : "";
  const finishPolygonDisabledReason =
    polygonPoints.length < 3 ? "Add at least 3 points to finish this polygon." : "";
  const finishPolygonTooltip =
    finishPolygonDisabledReason || "Finish polygon";
  const polygonStatus = [
    polygonPoints.length > 0
      ? `${activeTool === "zone" ? "Zone" : "Room"} ${polygonPoints.length} pts`
      : "",
    polygonDraftHint,
  ]
    .filter(Boolean)
    .join(" / ");

  return (
    <Toolbar
      ref={toolbarRef}
      data-testid="plan-cad-toolbar"
      data-plan-cad-ui="true"
      style={
        pinnedCodeEditorWidth > 0
          ? { left: `calc(50% - ${pinnedCodeEditorWidth / 2}%)` }
          : undefined
      }
    >
      <ModeLabel>BIM Plan</ModeLabel>
      {onClose && (
        <Tooltip text="Close BIM Plan" height="auto">
          <UtilityButton
            type="button"
            aria-label="Close BIM Plan"
            data-testid="plan-cad-close"
            onClick={handleClose}
          >
            <VscClose size={16} />
          </UtilityButton>
        </Tooltip>
      )}
      {showHint && (
        <CoachMark data-testid="plan-cad-hint">
          <CoachMarkText>
            Click twice to draw a wall. Double-click or Enter finishes a room.
          </CoachMarkText>
          <CoachMarkClose
            type="button"
            aria-label="Dismiss BIM Plan hint"
            onClick={dismissHint}
          >
            <VscClose size={13} />
          </CoachMarkClose>
        </CoachMark>
      )}
      <ToolsCluster>
        {PLAN_CAD_PRIMARY_TOOLS.map((tool) => {
          const Icon = tool.Icon;
          const selected = activeTool === tool.id;
          return (
            <Tooltip
              key={tool.id}
              text={`${tool.label} (${tool.shortcut})`}
              height="auto"
              triggerWidth="54px"
              triggerHeight="34px"
            >
              <ToolButton
                type="button"
                aria-label={`${tool.label} BIM tool (${tool.shortcut})`}
                aria-pressed={selected}
                data-testid={`plan-cad-tool-${tool.id}`}
                $selected={selected}
                $color={tool.color}
                onPointerDown={(event) => {
                  if (!event.isPrimary || event.button !== 0) return;
                  event.stopPropagation();
                  activateTool(tool.id);
                }}
                onClick={() => activateTool(tool.id)}
              >
                <Swatch $color={tool.color} />
                <Icon size={16} />
                <ToolLabel>{tool.label}</ToolLabel>
              </ToolButton>
            </Tooltip>
          );
        })}
        {PLAN_CAD_TOOL_GROUPS.map((group) => {
          const groupActiveTool =
            group.tools.find((tool) => tool.id === activeTool) ??
            group.tools[0]!;
          const GroupIcon = groupActiveTool.Icon;
          const isOpen = openToolGroupId === group.id;
          const selected = group.tools.some((tool) => tool.id === activeTool);
          return (
            <ToolMenuGroup key={group.id}>
              <Tooltip
                text={`${group.label}: ${group.tools.map((tool) => `${tool.label} ${tool.shortcut}`).join(", ")}`}
                height="auto"
                triggerWidth="106px"
                triggerHeight="40px"
              >
                <ToolGroupButton
                  type="button"
                  aria-label={`${group.label} BIM tools: ${group.tools.map((tool) => `${tool.label} (${tool.shortcut})`).join(", ")}`}
                  aria-haspopup="menu"
                  aria-expanded={isOpen}
                  data-testid={`plan-cad-group-${group.id}`}
                  $selected={selected}
                  $color={groupActiveTool.color}
                  onPointerDown={(event) => {
                    if (!event.isPrimary || event.button !== 0) return;
                    event.stopPropagation();
                  }}
                  onClick={() =>
                    setOpenToolGroupId((current) =>
                      current === group.id ? null : group.id,
                    )
                  }
                >
                  <Swatch $color={groupActiveTool.color} />
                  <GroupIcon size={16} />
                  <ToolLabel>{group.label}</ToolLabel>
                  <ToolMenuChevron $open={isOpen}>
                    <VscChevronUp size={12} />
                  </ToolMenuChevron>
                </ToolGroupButton>
              </Tooltip>
              <ToolMenuSheet
                role="menu"
                aria-label={`${group.label} BIM tools`}
                aria-hidden={!isOpen}
                $open={isOpen}
              >
                {group.tools.map((tool) => {
                  const Icon = tool.Icon;
                  const optionSelected = activeTool === tool.id;
                  return (
                    <ToolMenuItem
                      key={tool.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={optionSelected}
                      aria-pressed={optionSelected}
                      aria-label={`${tool.label} BIM tool (${tool.shortcut})`}
                      data-testid={`plan-cad-tool-${tool.id}`}
                      $selected={optionSelected}
                      $color={tool.color}
                      onPointerDown={(event) => {
                        if (!event.isPrimary || event.button !== 0) return;
                        event.stopPropagation();
                        activateTool(tool.id);
                      }}
                      onClick={() => activateTool(tool.id)}
                    >
                      <ToolMenuIcon $color={tool.color}>
                        <Icon size={15} />
                      </ToolMenuIcon>
                      <ToolMenuText>
                        <ToolMenuLabel>{tool.label}</ToolMenuLabel>
                        <ToolMenuShortcut>{tool.shortcut}</ToolMenuShortcut>
                      </ToolMenuText>
                    </ToolMenuItem>
                  );
                })}
              </ToolMenuSheet>
            </ToolMenuGroup>
          );
        })}
      </ToolsCluster>
      {activeTool === "part" && (
        <>
          <PanelDivider />
          <PartSelectShell $active>
            <VscTools size={14} />
            <PartSelect
              aria-label="BIM object preset"
              value={selectedPartPreset.id}
              onChange={(event) => {
                partPresetIdRef.current = event.currentTarget.value;
                setPartPresetId(event.currentTarget.value);
              }}
            >
              {PLAN_CAD_PART_CATALOGS.map((category) => (
                <optgroup key={category.id} label={category.label}>
                  {category.presets.map((preset: PlanCadPartPreset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </PartSelect>
          </PartSelectShell>
        </>
      )}
      {planLevels.length > 0 && (
        <>
          <PanelDivider />
          <LevelSelectShell $active={!!activeLevel}>
            <LevelSelect
              aria-label="Active BIM level"
              data-testid="plan-cad-active-level"
              value={activeLevelId}
              onChange={(event) => selectActiveLevel(event.currentTarget.value)}
            >
              {planLevels.map((level) => (
                <option key={level.id} value={level.id}>
                  {level.name || `Level ${level.index + 1}`}
                </option>
              ))}
            </LevelSelect>
          </LevelSelectShell>
          <UtilityGroup>
            <Tooltip text="Add BIM level" height="auto">
              <UtilityButton
                type="button"
                aria-label="Add BIM level"
                data-testid="plan-cad-add-level"
                onClick={addLevel}
              >
                <VscAdd size={15} />
              </UtilityButton>
            </Tooltip>
            <Tooltip text={`Display mode: ${displayMode}`} height="auto">
              <UtilityButton
                type="button"
                aria-label={`Cycle BIM display mode, currently ${displayMode}`}
                data-testid="plan-cad-display-mode"
                onClick={cycleDisplayMode}
              >
                {displayMode.slice(0, 1).toUpperCase()}
              </UtilityButton>
            </Tooltip>
          </UtilityGroup>
        </>
      )}
      <PanelDivider />
      <ToolMenuGroup>
        <Tooltip
          text="Plan interchange: JSON, DXF (walls & polygons), IFC (basic)"
          height="auto"
          triggerWidth="106px"
          triggerHeight="40px"
        >
          <ToolGroupButton
            type="button"
            aria-label="Plan interchange"
            aria-haspopup="menu"
            aria-expanded={openToolGroupId === "interchange"}
            data-testid="plan-cad-interchange"
            $selected={openToolGroupId === "interchange"}
            $color={builderToolbarTokens.accentPlan}
            onPointerDown={(event) => {
              if (!event.isPrimary || event.button !== 0) return;
              event.stopPropagation();
            }}
            onClick={() =>
              setOpenToolGroupId((current) =>
                current === "interchange" ? null : "interchange",
              )
            }
          >
            <VscTools size={16} />
            <ToolLabel>Exchange</ToolLabel>
            <ToolMenuChevron $open={openToolGroupId === "interchange"}>
              <VscChevronUp size={12} />
            </ToolMenuChevron>
          </ToolGroupButton>
        </Tooltip>
        <InterchangeMenuSheet
          role="menu"
          aria-label="Plan interchange actions"
          aria-hidden={openToolGroupId !== "interchange"}
          $open={openToolGroupId === "interchange"}
        >
          {(["json", "dxf", "ifc"] as const).map((kind) => (
            <ToolMenuItem
              key={`export-${kind}`}
              type="button"
              role="menuitem"
              aria-label={`Export ${PLAN_CAD_INTERCHANGE_LABELS[kind]}`}
              data-testid={`plan-cad-export-${kind}`}
              $selected={false}
              $color={builderToolbarTokens.accentPlan}
              onClick={() => handleExport(kind)}
            >
              <ToolMenuIcon $color={builderToolbarTokens.accentPlanText}>
                {kind.toUpperCase().slice(0, 2)}
              </ToolMenuIcon>
              <ToolMenuText>
                <ToolMenuLabel>
                  Export {PLAN_CAD_INTERCHANGE_LABELS[kind]}
                </ToolMenuLabel>
                <ToolMenuShortcut>EX</ToolMenuShortcut>
              </ToolMenuText>
            </ToolMenuItem>
          ))}
          <InterchangeMenuDivider />
          {(["json", "dxf", "ifc"] as const).map((kind) => (
            <ToolMenuItem
              key={`import-${kind}`}
              type="button"
              role="menuitem"
              aria-label={`Import ${PLAN_CAD_INTERCHANGE_LABELS[kind]}`}
              data-testid={`plan-cad-import-${kind}`}
              $selected={false}
              $color={builderToolbarTokens.accentPlan}
              onClick={() => requestImport(kind)}
            >
              <ToolMenuIcon $color={builderToolbarTokens.accentPlanText}>
                {kind.toUpperCase().slice(0, 2)}
              </ToolMenuIcon>
              <ToolMenuText>
                <ToolMenuLabel>
                  Import {PLAN_CAD_INTERCHANGE_LABELS[kind]}
                </ToolMenuLabel>
                <ToolMenuShortcut>IN</ToolMenuShortcut>
              </ToolMenuText>
            </ToolMenuItem>
          ))}
        </InterchangeMenuSheet>
      </ToolMenuGroup>
      <HiddenFileInput
        ref={importInputRef}
        type="file"
        accept=".json,.dxf,.ifc,application/json,application/dxf,application/step"
        data-testid="plan-cad-import-input"
        onChange={handleImportFileChange}
      />
      {interchangeStatus && (
        <InterchangeStatusPill
          data-testid="plan-cad-interchange-status"
          aria-live="polite"
          $tone={interchangeStatus.tone}
          title={interchangeStatus.message}
        >
          {interchangeStatus.message}
        </InterchangeStatusPill>
      )}
      {anchorPoint && (
        <AnchorPill>
          Wall start
        </AnchorPill>
      )}
      {polygonPoints.length > 0 && (
        <AnchorPill>
          {activeTool === "zone" ? "Zone" : "Room"} {polygonPoints.length} pts
        </AnchorPill>
      )}
      {polygonStatus && (
        <DraftStatusPill title={polygonStatus}>{polygonStatus}</DraftStatusPill>
      )}
      {polygonPoints.length > 0 && (
        <UtilityGroup>
          <Tooltip text={finishPolygonTooltip} height="auto">
            <UtilityButton
              type="button"
              aria-label="Finish BIM polygon"
              data-testid="plan-cad-finish-polygon"
              disabled={polygonPoints.length < 3}
              title={finishPolygonTooltip}
              onClick={handleFinishPolygon}
            >
              <VscCheck size={16} />
            </UtilityButton>
          </Tooltip>
          <Tooltip text="Cancel polygon" height="auto">
            <UtilityButton
              type="button"
              aria-label="Cancel BIM polygon"
              data-testid="plan-cad-cancel-polygon"
              onClick={handleCancelPolygon}
            >
              <VscClose size={16} />
            </UtilityButton>
          </Tooltip>
        </UtilityGroup>
      )}
    </Toolbar>
  );
};

const Toolbar = styled(BuilderToolbar).attrs({
  $maxWidth: "min(1120px, calc(100vw - 520px))",
  $mobileBreakpoint: "860px",
})``;

const ModeLabel = styled(BuilderModeLabel).attrs({ $width: "62px" })``;

const ToolsCluster = styled(BuilderToolsCluster).attrs({
  $columns: "54px repeat(3, 106px)",
})``;

const ToolMenuGroup = styled(BuilderToolMenuGroup).attrs({
  $width: "106px",
})``;

const ToolGroupButton = styled(BuilderToolGroupButton).attrs({
  $width: "106px",
  $labelMaxWidth: "66px",
})``;

const PartSelectShell = styled.div<{ $active: boolean }>`
  width: 116px;
  flex: 0 0 116px;
  height: 34px;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  border: 1px solid
    ${({ $active }) =>
      $active
        ? builderToolbarTokens.accentSteelBorder
        : builderToolbarTokens.borderSubtle};
  border-radius: 8px;
  background: ${({ $active }) =>
    $active
      ? builderToolbarTokens.accentSteelSurface
      : builderToolbarTokens.surfaceSubtle};
  color: ${({ $active }) =>
    $active
      ? builderToolbarTokens.accentSteelText
      : builderToolbarTokens.textSecondary};
  padding: 0 8px;
`;

const PartSelect = styled.select`
  min-width: 0;
  height: 30px;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 11px;
  font-weight: 700;
  outline: none;
  cursor: pointer;

  ${focusVisibleRing}

  &:disabled {
    color: ${builderToolbarTokens.textDisabled};
    cursor: default;
  }

  option {
    color: ${builderToolbarTokens.textOption};
  }
`;

const LevelSelectShell = styled(PartSelectShell)`
  width: 112px;
  flex-basis: 112px;
  grid-template-columns: minmax(0, 1fr);
`;

const LevelSelect = styled(PartSelect)`
  width: 100%;
`;

const AnchorPill = styled(BuilderAnchorPill).attrs({ $width: "96px" })``;

const DraftStatusPill = styled.div`
  width: 128px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border: 1px solid ${builderToolbarTokens.accentPlanBorderStrong};
  border-radius: 8px;
  background: ${builderToolbarTokens.measurementSurface};
  color: ${builderToolbarTokens.textPrimary};
  padding: 0 8px;
  box-shadow: inset 0 0 0 1px ${builderToolbarTokens.surfaceSubtle};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 900;
  line-height: 1;
  font-variant-numeric: tabular-nums;
`;

const UtilityButton = styled.button`
  width: 34px;
  height: 34px;
  border: 1px solid ${builderToolbarTokens.borderSubtle};
  border-radius: 8px;
  background: ${builderToolbarTokens.surfaceSubtle};
  color: ${builderToolbarTokens.textPrimary};
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;

  &:hover:not(:disabled) {
    background: ${builderToolbarTokens.surfaceHover};
    border-color: ${builderToolbarTokens.accentSteel};
  }

  ${focusVisibleRing}

  &:disabled {
    color: ${builderToolbarTokens.textDisabled};
    cursor: default;
  }
`;

const UtilityGroup = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 34px);
  gap: 6px;
`;

const InterchangeMenuSheet = styled(ToolMenuSheet)`
  width: 252px;
`;

const InterchangeMenuDivider = styled.div`
  height: 1px;
  margin: 2px 4px;
  background: ${builderToolbarTokens.borderMuted};
`;

const HiddenFileInput = styled.input`
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
`;

const InterchangeStatusPill = styled.div<{ $tone: "info" | "error" }>`
  width: 224px;
  height: 34px;
  display: flex;
  align-items: center;
  border: 1px solid
    ${({ $tone }) =>
      $tone === "error"
        ? builderToolbarTokens.errorBorder
        : builderToolbarTokens.accentPlanBorder};
  border-radius: 8px;
  background: ${({ $tone }) =>
    $tone === "error"
      ? builderToolbarTokens.errorSurface
      : builderToolbarTokens.accentPlanSurface};
  color: ${({ $tone }) =>
    $tone === "error"
      ? builderToolbarTokens.errorText
      : builderToolbarTokens.accentPlanText};
  padding: 0 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 800;
`;

const CoachMark = styled.div`
  min-height: 34px;
  max-width: 304px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 24px;
  align-items: center;
  gap: 8px;
  border: 1px solid ${builderToolbarTokens.accentPlanBorder};
  border-radius: 8px;
  background: ${builderToolbarTokens.accentPlanSurface};
  color: ${builderToolbarTokens.accentPlanText};
  padding: 6px 6px 6px 10px;
`;

const CoachMarkText = styled.span`
  min-width: 0;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.25;
`;

const CoachMarkClose = styled.button`
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: ${builderToolbarTokens.accentPlanText};
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;

  &:hover {
    background: ${builderToolbarTokens.surfaceHover};
  }

  ${focusVisibleRing}
`;
