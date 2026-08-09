import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { IconType } from "react-icons";
import {
  TbBarrierBlock,
  TbBeach,
  TbBuildingBridge2,
  TbDroplet,
  TbEraser,
  TbFence,
  TbGrain,
  TbHome2,
  TbLamp2,
  TbLayoutGrid,
  TbMountain,
  TbPlant2,
  TbPointer,
  TbRoad,
  TbTrees,
} from "react-icons/tb";
import {
  VscAdd,
  VscArchive,
  VscChevronUp,
  VscClose,
  VscChromeMinimize,
  VscCircleLarge,
  VscCircleSmallFilled,
  VscRefresh,
  VscScreenFull,
  VscSymbolColor,
} from "react-icons/vsc";
import styled from "styled-components";
import * as THREE from "three";

import {
  createQuickBuildObject,
  createQuickBuildPreviewObject,
  findQuickBuildRoot,
  getDefaultQuickBuildVariantId,
  getQuickBuildMetadata,
  getQuickBuildPlacementSnap,
  getQuickBuildVariants,
  isQuickBuildCellExclusiveKind,
  isQuickBuildPreviewObject,
  isQuickBuildStackableKind,
  QUICK_BUILD_CELL_SIZE,
  QuickBuildStampKind,
  QuickBuildVariantId,
  repairQuickBuildRenderableState,
  snapQuickBuildPoint,
} from "./quickBuildObjects";
import {
  clearQuickBuildLiveBatches,
  collectQuickBuildBakeObjects,
  collectQuickBuildObjects,
  createQuickBuildBakedBatch,
  findAnyQuickBuildObjectAtPoint,
  findQuickBuildObjectAtPoint,
  findNearestQuickBuildObjectNearPoint,
  getQuickBuildBrushPoints,
  getQuickBuildPlacementCandidates,
  QuickBuildBrushMode,
  rebuildQuickBuildLiveBatch,
  refreshQuickBuildAdjacency,
} from "./quickBuildSceneTools";
import {
  applyQuickBuildTexturePreset,
  formatQuickBuildTexturePresetCredit,
  getTexturePresetsForKind,
  isQuickBuildTexturePresetCompatible,
  loadQuickBuildTexture,
  loadQuickBuildTexturePack,
  loadQuickBuildTexturePackIndex,
} from "./quickBuildTexturePacks";
import type { QuickBuildTexturePreset } from "./quickBuildTexturePacks";
import {
  BuilderAnchorPill as AnchorPill,
  BuilderModeLabel as ModeLabel,
  BuilderPanelDivider as PanelDivider,
  BuilderSwatch as Swatch,
  BuilderToolButton as ToolButton,
  BuilderToolGroupButton as ToolGroupButton,
  BuilderToolLabel as ToolLabel,
  BuilderToolMenuChevron as ToolMenuChevron,
  BuilderToolMenuGroup as ToolMenuGroup,
  BuilderToolMenuIcon as ToolMenuIcon,
  BuilderToolMenuItem as ToolMenuItem,
  BuilderToolMenuLabel as ToolMenuLabel,
  BuilderToolMenuSheet as ToolMenuSheet,
  BuilderToolMenuShortcut as ToolMenuShortcut,
  BuilderToolMenuText as ToolMenuText,
  BuilderToolbar as Toolbar,
  BuilderToolsCluster as ToolsCluster,
  builderToolbarToolColors,
  builderToolbarTokens,
  focusVisibleRing,
} from "../common/builderToolbar";
import { Tooltip } from "../common/Tooltip";
import { isInputActive } from "../utils/isInputActive";
import { AddObjectCommand } from "@stem/editor-oss/command/AddObjectCommand.js";
import { MultiCmdsCommand } from "@stem/editor-oss/command/MultiCmdsCommand.js";
import { RemoveObjectCommand } from "@stem/editor-oss/command/RemoveObjectCommand.js";
import type EngineRuntime from "@stem/editor-oss/EngineRuntime";
import type Editor from "@stem/editor-oss/editor/Editor";
import global from "@stem/editor-oss/global";
import { showToast } from "@stem/editor-oss/showToast";
import { getLogger } from "@stem/editor-oss/utils/Logger";

type QuickBuildToolId = "select" | "erase" | QuickBuildStampKind;

type QuickBuildTool = {
  id: QuickBuildToolId;
  label: string;
  shortcut?: string;
  color: string;
  Icon: IconType;
  variantId?: QuickBuildVariantId;
};

type QuickBuildToolGroup = {
  id: string;
  label: string;
  tools: QuickBuildTool[];
};

type QuickBuildBrushTool = {
  id: QuickBuildBrushMode;
  label: string;
  Icon: IconType;
};

type TexturePackStatus = "loading" | "loaded" | "unavailable" | "error";

const QUICK_BUILD_SCENE_REFRESH_DEBOUNCE_MS = 250;
const QUICK_BUILD_LIVE_REFRESH_GRACE_MS =
  QUICK_BUILD_SCENE_REFRESH_DEBOUNCE_MS + 50;

const QUICK_BUILD_TOOLS: QuickBuildTool[] = [
  {
    id: "select",
    label: "Select",
    shortcut: "V",
    color: builderToolbarToolColors.shared.select,
    Icon: TbPointer,
  },
  {
    id: "erase",
    label: "Erase",
    shortcut: "E",
    color: builderToolbarToolColors.shared.erase,
    Icon: TbEraser,
  },
  {
    id: "ground",
    label: "Ground",
    shortcut: "1",
    color: builderToolbarToolColors.quickBuild.ground,
    Icon: TbLayoutGrid,
  },
  {
    id: "sand",
    label: "Sand",
    shortcut: "7",
    color: builderToolbarToolColors.quickBuild.sand,
    Icon: TbBeach,
  },
  {
    id: "stone",
    label: "Stone",
    shortcut: "8",
    color: builderToolbarToolColors.quickBuild.stone,
    Icon: TbBarrierBlock,
  },
  {
    id: "path",
    label: "Path",
    shortcut: "2",
    color: builderToolbarToolColors.quickBuild.path,
    Icon: TbRoad,
  },
  {
    id: "water",
    label: "Water",
    shortcut: "3",
    color: builderToolbarToolColors.quickBuild.water,
    Icon: TbDroplet,
  },
  {
    id: "bridge",
    label: "Bridge",
    shortcut: "B",
    color: builderToolbarToolColors.quickBuild.bridge,
    Icon: TbBuildingBridge2,
  },
  {
    id: "farm",
    label: "Farm",
    shortcut: "9",
    color: builderToolbarToolColors.quickBuild.farm,
    Icon: TbGrain,
  },
  {
    id: "fence",
    label: "Fence",
    shortcut: "0",
    color: builderToolbarToolColors.quickBuild.fence,
    Icon: TbFence,
  },
  {
    id: "tree",
    label: "Tree",
    shortcut: "4",
    color: builderToolbarToolColors.quickBuild.tree,
    Icon: TbTrees,
  },
  {
    id: "bush",
    label: "Shrub",
    shortcut: "U",
    color: builderToolbarToolColors.quickBuild.bush,
    Icon: TbPlant2,
  },
  {
    id: "rock",
    label: "Rock",
    shortcut: "5",
    color: builderToolbarToolColors.quickBuild.rock,
    Icon: TbMountain,
  },
  {
    id: "house",
    label: "House",
    shortcut: "6",
    color: builderToolbarToolColors.quickBuild.house,
    Icon: TbHome2,
  },
  {
    id: "lamp",
    label: "Lamp",
    shortcut: "L",
    color: builderToolbarToolColors.quickBuild.lamp,
    Icon: TbLamp2,
  },
];

const QUICK_BUILD_PRIMARY_TOOLS = QUICK_BUILD_TOOLS.filter(
  (tool) => tool.id === "select" || tool.id === "erase",
);

const QUICK_BUILD_VARIANT_TOOLS: QuickBuildTool[] = [
  {
    id: "path",
    label: "Path",
    shortcut: "2",
    color: builderToolbarToolColors.quickBuild.path,
    Icon: TbRoad,
    variantId: "path-dirt",
  },
  {
    id: "path",
    label: "Street",
    color: builderToolbarToolColors.quickBuild.street,
    Icon: TbRoad,
    variantId: "path-street",
  },
  {
    id: "path",
    label: "Cobble",
    color: builderToolbarToolColors.quickBuild.cobble,
    Icon: TbRoad,
    variantId: "path-cobble",
  },
  {
    id: "bush",
    label: "Shrub",
    shortcut: "U",
    color: builderToolbarToolColors.quickBuild.bush,
    Icon: TbPlant2,
    variantId: "bush-round",
  },
  {
    id: "bush",
    label: "Hedge",
    color: builderToolbarToolColors.quickBuild.hedge,
    Icon: TbPlant2,
    variantId: "bush-hedge",
  },
  {
    id: "bush",
    label: "Flowering",
    color: builderToolbarToolColors.quickBuild.flowering,
    Icon: TbPlant2,
    variantId: "bush-flowering",
  },
  {
    id: "house",
    label: "House",
    shortcut: "6",
    color: builderToolbarToolColors.quickBuild.house,
    Icon: TbHome2,
    variantId: "house-cottage",
  },
  {
    id: "house",
    label: "Cabin",
    color: builderToolbarToolColors.quickBuild.cabin,
    Icon: TbHome2,
    variantId: "house-cabin",
  },
  {
    id: "house",
    label: "Townhouse",
    color: builderToolbarToolColors.quickBuild.townhouse,
    Icon: TbHome2,
    variantId: "house-townhouse",
  },
];

function getQuickBuildVariantTool(
  kind: QuickBuildStampKind,
  variantId: QuickBuildVariantId | undefined,
) {
  return QUICK_BUILD_VARIANT_TOOLS.find(
    (tool) => tool.id === kind && tool.variantId === variantId,
  );
}

function getQuickBuildToolTestId(tool: QuickBuildTool) {
  if (
    !isStampTool(tool.id) ||
    !tool.variantId ||
    tool.variantId === getDefaultQuickBuildVariantId(tool.id)
  ) {
    return `quick-build-tool-${tool.id}`;
  }
  return `quick-build-tool-${tool.id}-${tool.variantId.replace(`${tool.id}-`, "")}`;
}

function formatQuickBuildShortcut(tool: QuickBuildTool) {
  return tool.shortcut ? ` (${tool.shortcut})` : "";
}

const QUICK_BUILD_TOOL_GROUPS: QuickBuildToolGroup[] = [
  {
    id: "terrain",
    label: "Terrain",
    tools: QUICK_BUILD_TOOLS.filter((tool) =>
      ["ground", "sand", "stone", "farm"].includes(tool.id),
    ),
  },
  {
    id: "paths",
    label: "Routes",
    tools: [
      ...QUICK_BUILD_VARIANT_TOOLS.filter((tool) => tool.id === "path"),
      ...QUICK_BUILD_TOOLS.filter((tool) =>
        ["water", "bridge", "fence"].includes(tool.id),
      ),
    ],
  },
  {
    id: "nature",
    label: "Nature",
    tools: [
      ...QUICK_BUILD_TOOLS.filter((tool) => tool.id === "tree"),
      ...QUICK_BUILD_VARIANT_TOOLS.filter((tool) => tool.id === "bush"),
      ...QUICK_BUILD_TOOLS.filter((tool) => tool.id === "rock"),
    ],
  },
  {
    id: "buildings",
    label: "Build",
    tools: [
      ...QUICK_BUILD_VARIANT_TOOLS.filter((tool) => tool.id === "house"),
      ...QUICK_BUILD_TOOLS.filter((tool) => tool.id === "lamp"),
    ],
  },
];

const QUICK_BUILD_ROTATION_STEP = Math.PI / 2;

const SHORTCUTS: Record<string, QuickBuildToolId> = {
  v: "select",
  escape: "select",
  e: "erase",
  "1": "ground",
  "2": "path",
  "3": "water",
  "4": "tree",
  "5": "rock",
  "6": "house",
  "7": "sand",
  "8": "stone",
  "9": "farm",
  "0": "fence",
  b: "bridge",
  u: "bush",
  l: "lamp",
};

const BRUSH_TOOLS: QuickBuildBrushTool[] = [
  { id: "single", label: "Single", Icon: VscCircleSmallFilled },
  { id: "radius", label: "Radius", Icon: VscCircleLarge },
  { id: "line", label: "Line", Icon: VscChromeMinimize },
  { id: "rectangle", label: "Rectangle", Icon: VscScreenFull },
];

const QUICK_BUILD_HINT_STORAGE_KEY = "stem:quickBuildHintDismissed";
const QUICK_BUILD_ERASE_HOVER_COLOR = builderToolbarToolColors.shared.erase;

type QuickBuildEraseHighlightRecord = {
  mesh: THREE.Mesh;
  originalMaterial: THREE.Material | THREE.Material[];
  highlightMaterial: THREE.Material | THREE.Material[];
};

type QuickBuildBakeSourceState = {
  object: THREE.Object3D;
  visible: boolean;
  hasEditorVisibility: boolean;
  editorVisibility: unknown;
  hasGameVisibility: boolean;
  gameVisibility: unknown;
  hasRuntimeBakeUuid: boolean;
  runtimeBakeUuid: unknown;
};

type QuickBuildSceneSummary = {
  stampCount: number;
  bakedBatchCount: number;
};

interface QuickBuildToolbarProps {
  pinnedCodeEditorWidth?: number;
  onClose?: () => void;
}

type QuickBuildEditor = Editor & {
  computeIntersectPoint?: (
    position: { x: number; y: number },
    sceneHelpers?: THREE.Object3D,
  ) => THREE.Vector3;
};

function isStampTool(id: QuickBuildToolId): id is QuickBuildStampKind {
  return id !== "select" && id !== "erase";
}

function getQuickBuildEditor(app: EngineRuntime): QuickBuildEditor | null {
  return app.editor as QuickBuildEditor | null;
}

function getQuickBuildCellSize(app: EngineRuntime): number {
  const configuredCellSize = Number(
    getQuickBuildEditor(app)?.scene?.userData?.quickBuild?.cellSize,
  );
  return Number.isFinite(configuredCellSize) && configuredCellSize > 0
    ? configuredCellSize
    : QUICK_BUILD_CELL_SIZE;
}

function getQuickBuildToolSnap(app: EngineRuntime, kind: QuickBuildStampKind) {
  return getQuickBuildPlacementSnap(kind, getQuickBuildCellSize(app));
}

function getQuickBuildScene(app: EngineRuntime): THREE.Object3D | null {
  return getQuickBuildEditor(app)?.scene ?? null;
}

function getSelectedQuickBuildRoots(app: EngineRuntime): THREE.Object3D[] {
  const selected = app.editor?.selected;
  const selectedObjects = Array.isArray(selected)
    ? selected
    : selected
      ? [selected]
      : [];
  const roots = new Set<THREE.Object3D>();

  for (const object of selectedObjects) {
    const root = findQuickBuildRoot(object);
    if (root) roots.add(root);
  }

  return [...roots];
}

function getQuickBuildEraseTarget(
  app: EngineRuntime,
  intersect: {
    point?: THREE.Vector3 | null;
    object?: THREE.Object3D | null;
  },
) {
  if (!intersect?.point) return null;

  const scene = getQuickBuildScene(app);
  const quickBuildRoot = findQuickBuildRoot(intersect.object);
  if (!scene) return quickBuildRoot;

  const baseCellSize = getQuickBuildCellSize(app);
  const exactEraseTarget = findAnyQuickBuildObjectAtPoint(
    scene,
    intersect.point,
    baseCellSize,
  );
  const nearestEraseTarget =
    !exactEraseTarget && !quickBuildRoot
      ? findNearestQuickBuildObjectNearPoint(
          scene,
          intersect.point,
          baseCellSize,
        )
      : null;
  return quickBuildRoot ?? exactEraseTarget ?? nearestEraseTarget;
}

function resolveSelectedQuickBuildVariantId(
  selectedVariants: Partial<Record<QuickBuildStampKind, QuickBuildVariantId>>,
  kind: QuickBuildStampKind,
) {
  return selectedVariants[kind] ?? getDefaultQuickBuildVariantId(kind) ?? null;
}

function isQuickBuildToolSelected(
  tool: QuickBuildTool,
  activeTool: QuickBuildToolId,
  selectedVariants: Partial<Record<QuickBuildStampKind, QuickBuildVariantId>>,
) {
  if (tool.id !== activeTool) return false;
  if (!isStampTool(tool.id) || !tool.variantId) return true;
  return (
    resolveSelectedQuickBuildVariantId(selectedVariants, tool.id) ===
    tool.variantId
  );
}

function logQuickBuild(
  stage: string,
  details?: Record<string, unknown>,
  level: "info" | "warn" | "error" = "info",
) {
  if (level === "info" && !isQuickBuildDebugEnabled()) return;
  const logger = getLogger();
  const payload = details ? [details] : [];
  logger?.[level]?.(`[QuickBuild] ${stage}`, ...payload);
}

function isQuickBuildDebugEnabled() {
  if (typeof window === "undefined") return false;
  if (
    (window as Window & { __STEM_QUICK_BUILD_DEBUG?: boolean })
      .__STEM_QUICK_BUILD_DEBUG === true
  ) {
    return true;
  }
  return window.localStorage?.getItem("quickBuildDebug") === "1";
}

function quickBuildDebugDetails<T extends Record<string, unknown>>(
  factory: () => T,
): Partial<T> {
  return isQuickBuildDebugEnabled() ? factory() : {};
}

function hashQuickBuildSeed(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getQuickBuildScatterOffset(seed: string, cellSize: number) {
  const hash = hashQuickBuildSeed(seed);
  const angle = ((hash & 0xffff) / 0xffff) * Math.PI * 2;
  const radiusMix = ((hash >>> 16) & 0xffff) / 0xffff;
  const radius = (0.16 + radiusMix * 0.18) * cellSize;
  return new THREE.Vector3(
    Math.cos(angle) * radius,
    0,
    Math.sin(angle) * radius,
  );
}

function quickBuildCellKey(point: THREE.Vector3, cellSize: number) {
  const snapped = snapQuickBuildPoint(point, cellSize);
  return `${roundNumber(snapped.x)}:${roundNumber(snapped.z)}`;
}

function countStackableQuickBuildObjectsInCell(
  scene: THREE.Object3D | null,
  point: THREE.Vector3,
  cellSize: number,
) {
  if (!scene) return 0;
  const targetKey = quickBuildCellKey(point, cellSize);
  let count = 0;
  for (const object of collectQuickBuildObjects(scene)) {
    if (object.visible === false) continue;
    const metadata = getQuickBuildMetadata(object);
    if (!metadata || !isQuickBuildStackableKind(metadata.kind)) continue;
    const worldPosition = new THREE.Vector3();
    object.getWorldPosition(worldPosition);
    if (quickBuildCellKey(worldPosition, cellSize) === targetKey) count += 1;
  }
  return count;
}

function getQuickBuildPlacementSeed(
  scene: THREE.Object3D | null,
  kind: QuickBuildStampKind,
  point: THREE.Vector3,
  cellSize: number,
  localCellCounts: Map<string, number>,
) {
  const cellKey = quickBuildCellKey(point, cellSize);
  const localIndex = localCellCounts.get(cellKey) ?? 0;
  localCellCounts.set(cellKey, localIndex + 1);
  const existingCount = countStackableQuickBuildObjectsInCell(
    scene,
    point,
    cellSize,
  );
  return `${kind}:${cellKey}:${existingCount + localIndex}`;
}

function getQuickBuildObjectPlacementPoint(
  kind: QuickBuildStampKind,
  point: THREE.Vector3,
  cellSize: number,
  seed: string,
) {
  const snapped = snapQuickBuildPoint(point, cellSize);
  if (!isQuickBuildStackableKind(kind)) return snapped;

  const offset = getQuickBuildScatterOffset(seed, cellSize);
  return new THREE.Vector3(snapped.x + offset.x, point.y, snapped.z + offset.z);
}

function getQuickBuildResolvedPlacementPoint(
  scene: THREE.Object3D | null,
  kind: QuickBuildStampKind,
  point: THREE.Vector3,
  cellSize: number,
  localCellCounts: Map<string, number>,
) {
  const snapped = snapQuickBuildPoint(point, cellSize);
  if (!isQuickBuildStackableKind(kind)) return snapped;
  return getQuickBuildObjectPlacementPoint(
    kind,
    point,
    cellSize,
    getQuickBuildPlacementSeed(scene, kind, snapped, cellSize, localCellCounts),
  );
}

function getQuickBuildBrushOrigin(
  kind: QuickBuildStampKind,
  point: THREE.Vector3,
) {
  return isQuickBuildStackableKind(kind)
    ? new THREE.Vector3(point.x, 0, point.z)
    : point;
}

function normalizeRotationStep(step: number) {
  return ((step % 4) + 4) % 4;
}

function getQuickBuildRotationRadians(rotationSteps: number) {
  return normalizeRotationStep(rotationSteps) * QUICK_BUILD_ROTATION_STEP;
}

function getQuickBuildRotationDegrees(rotationSteps: number) {
  return normalizeRotationStep(rotationSteps) * 90;
}

function movePreviewObjectToPoint(
  object: THREE.Object3D,
  point: THREE.Vector3Like,
) {
  object.updateMatrixWorld(true);
  const boundingBox = new THREE.Box3().setFromObject(object);
  const objBottom = boundingBox.min.y;
  if (!isFinite(objBottom)) {
    object.position.set(point.x, point.y, point.z);
  } else {
    const deltaY = point.y - objBottom;
    object.position.set(point.x, object.position.y + deltaY, point.z);
  }
  object.updateMatrixWorld(true);
}

function roundNumber(value: number) {
  return Number(value.toFixed(3));
}

function vectorDiagnostics(vector: THREE.Vector3 | null | undefined) {
  return vector ? vector.toArray().map(roundNumber) : null;
}

function boxDiagnostics(box: THREE.Box3) {
  if (box.isEmpty()) return null;
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);
  return {
    min: vectorDiagnostics(box.min),
    max: vectorDiagnostics(box.max),
    center: vectorDiagnostics(center),
    size: vectorDiagnostics(size),
  };
}

function rendererDiagnostics(app: EngineRuntime) {
  const info = app.renderer?.info ?? getQuickBuildEditor(app)?.renderer?.info;
  if (!info) return null;

  return {
    memory: info.memory ? { ...info.memory } : null,
    render: info.render ? { ...info.render } : null,
  };
}

function objectRenderDiagnostics(
  app: EngineRuntime,
  object: THREE.Object3D | null | undefined,
) {
  if (!object) return null;

  object.updateWorldMatrix(true, true);
  const worldPosition = new THREE.Vector3();
  object.getWorldPosition(worldPosition);
  const box = new THREE.Box3().setFromObject(object);
  const editor = getQuickBuildEditor(app);
  const camera =
    editor?.view === "perspective"
      ? editor?.camera
      : editor?.orthCamera || editor?.camera;
  let inCameraFrustum: boolean | null = null;

  if (camera && !box.isEmpty()) {
    camera.updateMatrixWorld?.();
    camera.updateProjectionMatrix?.();
    const projection = new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    const frustum = new THREE.Frustum().setFromProjectionMatrix(projection);
    inCameraFrustum = frustum.intersectsBox(box);
  }

  const meshes: Array<Record<string, unknown>> = [];
  let meshCount = 0;
  let visibleMeshCount = 0;
  let materialCount = 0;
  let hiddenMaterialCount = 0;
  let mappedMaterialCount = 0;
  let batchableMeshCount = 0;

  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;

    meshCount += 1;
    if (mesh.visible) visibleMeshCount += 1;
    if (mesh.userData?.isBatchable !== false) batchableMeshCount += 1;

    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    materialCount += materials.length;
    const materialDetails = materials.map((material) => {
      const maybeMapped = material as THREE.MeshStandardMaterial;
      if (material.visible === false) hiddenMaterialCount += 1;
      if (maybeMapped.map) mappedMaterialCount += 1;
      return {
        type: material.type,
        uuid: material.uuid,
        visible: material.visible !== false,
        transparent: material.transparent === true,
        opacity: roundNumber(material.opacity ?? 1),
        hasMap: !!maybeMapped.map,
        mapUuid: maybeMapped.map?.uuid ?? null,
        needsUpdate: material.needsUpdate === true,
      };
    });

    if (meshes.length < 6) {
      const meshWorldPosition = new THREE.Vector3();
      mesh.getWorldPosition(meshWorldPosition);
      meshes.push({
        uuid: mesh.uuid,
        name: mesh.name || null,
        part: mesh.userData?.quickBuildPart ?? null,
        visible: mesh.visible,
        worldPosition: vectorDiagnostics(meshWorldPosition),
        batchable: mesh.userData?.isBatchable !== false,
        materials: materialDetails,
      });
    }
  });

  return {
    uuid: object.uuid,
    name: object.name || null,
    parent: object.parent
      ? {
          uuid: object.parent.uuid,
          name: object.parent.name || object.parent.type,
          type: object.parent.type,
        }
      : null,
    visible: object.visible,
    worldPosition: vectorDiagnostics(worldPosition),
    bounds: boxDiagnostics(box),
    inCameraFrustum,
    userData: {
      quickBuild: object.userData?.quickBuild ?? null,
      texture: object.userData?.quickBuildTexture ?? null,
      editorVisibility: object.userData?.editorVisibility,
      gameVisibility: object.userData?.gameVisibility,
      isBatchable: object.userData?.isBatchable,
      isSelectable: object.userData?.isSelectable,
    },
    meshCount,
    visibleMeshCount,
    materialCount,
    hiddenMaterialCount,
    mappedMaterialCount,
    batchableMeshCount,
    meshes,
    renderer: rendererDiagnostics(app),
  };
}

function findSceneObjectByUuid(
  scene: THREE.Object3D | null | undefined,
  uuid: string,
): THREE.Object3D | null {
  let result: THREE.Object3D | null = null;
  scene?.traverse((object) => {
    if (!result && object.uuid === uuid) result = object;
  });
  return result;
}

function getBakeSourceUuids(batches: THREE.Object3D[]) {
  const sourceUuids = new Set<string>();
  for (const batch of batches) {
    const batchSourceUuids = batch.userData?.quickBuildBake?.sourceUuids;
    if (!Array.isArray(batchSourceUuids)) continue;
    for (const uuid of batchSourceUuids) {
      if (typeof uuid === "string") sourceUuids.add(uuid);
    }
  }
  return [...sourceUuids];
}

function snapshotQuickBuildBakeSources(
  scene: THREE.Object3D | null | undefined,
  sourceUuids: string[],
) {
  const states: QuickBuildBakeSourceState[] = [];
  for (const uuid of sourceUuids) {
    const object = findSceneObjectByUuid(scene, uuid);
    if (!object) continue;
    states.push({
      object,
      visible: object.visible,
      hasEditorVisibility: Object.prototype.hasOwnProperty.call(
        object.userData,
        "editorVisibility",
      ),
      editorVisibility: object.userData.editorVisibility,
      hasGameVisibility: Object.prototype.hasOwnProperty.call(
        object.userData,
        "gameVisibility",
      ),
      gameVisibility: object.userData.gameVisibility,
      hasRuntimeBakeUuid: Object.prototype.hasOwnProperty.call(
        object.userData,
        "quickBuildRuntimeBakeUuid",
      ),
      runtimeBakeUuid: object.userData.quickBuildRuntimeBakeUuid,
    });
  }
  return states;
}

function restoreQuickBuildBakeSourceStates(
  app: EngineRuntime,
  states: QuickBuildBakeSourceState[],
) {
  for (const state of states) {
    state.object.visible = state.visible;
    if (state.hasEditorVisibility) {
      state.object.userData.editorVisibility = state.editorVisibility;
    } else {
      delete state.object.userData.editorVisibility;
    }
    if (state.hasGameVisibility) {
      state.object.userData.gameVisibility = state.gameVisibility;
    } else {
      delete state.object.userData.gameVisibility;
    }
    if (state.hasRuntimeBakeUuid) {
      state.object.userData.quickBuildRuntimeBakeUuid =
        state.runtimeBakeUuid;
    } else {
      delete state.object.userData.quickBuildRuntimeBakeUuid;
    }
    app.call("objectChanged", app.editor, state.object);
  }
}

function markQuickBuildSourcesBaked(
  app: EngineRuntime,
  batch: THREE.Object3D,
  states: QuickBuildBakeSourceState[],
) {
  for (const state of states) {
    state.object.visible = true;
    state.object.userData.editorVisibility = true;
    state.object.userData.gameVisibility = false;
    state.object.userData.quickBuildRuntimeBakeUuid = batch.uuid;
    app.call("objectChanged", app.editor, state.object);
  }
}

function markQuickBuildSourcesUnbaked(
  app: EngineRuntime,
  states: QuickBuildBakeSourceState[],
) {
  for (const state of states) {
    state.object.visible = true;
    state.object.userData.editorVisibility = true;
    state.object.userData.gameVisibility = true;
    delete state.object.userData.quickBuildRuntimeBakeUuid;
    app.call("objectChanged", app.editor, state.object);
  }
}

class QuickBuildBakeCommand {
  type = "QuickBuildBakeCommand";
  name = "Optimize Quick Build for play";
  updatable = false;
  object: THREE.Object3D;

  constructor(
    private readonly app: EngineRuntime,
    private readonly batch: THREE.Object3D,
    private readonly sourceStates: QuickBuildBakeSourceState[],
  ) {
    this.object = batch;
  }

  async execute() {
    await this.app.editor?.addObject?.(this.batch);
    markQuickBuildSourcesBaked(this.app, this.batch, this.sourceStates);
    this.app.call("objectChanged", this.app.editor, this.app.editor?.scene);
    return {
      message: "QuickBuildBakeCommand: batch baked",
      status: "success",
    };
  }

  undo() {
    this.app.editor?.removeObject?.(this.batch);
    restoreQuickBuildBakeSourceStates(this.app, this.sourceStates);
    this.app.call("objectChanged", this.app.editor, this.app.editor?.scene);
    return {
      message: "QuickBuildBakeCommand: batch removed",
      status: "success",
    };
  }
}

class QuickBuildClearBakesCommand {
  type = "QuickBuildClearBakesCommand";
  name = "Restore editable Quick Build stamps";
  updatable = false;
  object?: THREE.Object3D;

  constructor(
    private readonly app: EngineRuntime,
    private readonly batches: THREE.Object3D[],
    private readonly sourceStates: QuickBuildBakeSourceState[],
  ) {
    this.object = batches[0];
  }

  execute() {
    for (const batch of this.batches) {
      this.app.editor?.removeObject?.(batch);
    }
    markQuickBuildSourcesUnbaked(this.app, this.sourceStates);
    this.app.call("objectChanged", this.app.editor, this.app.editor?.scene);
    return {
      message: "QuickBuildClearBakesCommand: bakes cleared",
      status: "success",
    };
  }

  async undo() {
    for (const batch of this.batches) {
      await this.app.editor?.addObject?.(batch);
    }
    restoreQuickBuildBakeSourceStates(this.app, this.sourceStates);
    this.app.call("objectChanged", this.app.editor, this.app.editor?.scene);
    return {
      message: "QuickBuildClearBakesCommand: bakes restored",
      status: "success",
    };
  }
}

function refreshQuickBuildSceneAdjacency(
  app: EngineRuntime,
  restoreLiveBatch = true,
) {
  const scene = getQuickBuildScene(app);
  if (!scene) return;

  const hadLiveBatch = clearQuickBuildLiveBatches(scene, true) > 0;
  for (const update of refreshQuickBuildAdjacency(
    scene,
    getQuickBuildCellSize(app),
  )) {
    app.call("objectChanged", app.editor, update.object);
  }
  if (hadLiveBatch && restoreLiveBatch) {
    rebuildQuickBuildLiveBatch(scene);
  }
}

function repairQuickBuildSceneRenderState(app: EngineRuntime) {
  const scene = getQuickBuildScene(app);
  if (!scene) return 0;

  let repaired = 0;
  for (const object of collectQuickBuildObjects(scene)) {
    if (!repairQuickBuildRenderableState(object)) continue;
    repaired += 1;
    app.call("objectChanged", app.editor, object);
  }

  if (repaired > 0) {
    app.call("objectChanged", app.editor, scene);
    logQuickBuild("Repaired Quick Build render state", { repaired });
  }

  return repaired;
}

function createQuickBuildObjectsForPoints(
  app: EngineRuntime,
  kind: QuickBuildStampKind,
  points: THREE.Vector3[],
  texturePreset: QuickBuildTexturePreset | null = null,
  texture: THREE.Texture | null = null,
  rotationSteps = 0,
  variantId: QuickBuildVariantId | null = null,
): THREE.Object3D[] {
  const cellSize = getQuickBuildToolSnap(app, kind);
  const scene = getQuickBuildScene(app);
  const localCellCounts = new Map<string, number>();
  const rotationY = getQuickBuildRotationRadians(rotationSteps);
  return points.map((point) => {
    const object = createQuickBuildObject(kind, { variantId });
    object.rotation.y = rotationY;
    if (texturePreset && texture) {
      applyQuickBuildTexturePreset(object, texturePreset, texture);
    }
    app.editor?.moveObjectToPoint(
      object,
      getQuickBuildResolvedPlacementPoint(
        scene,
        kind,
        point,
        cellSize,
        localCellCounts,
      ),
    );
    return object;
  });
}

async function placeQuickBuildObjects(
  app: EngineRuntime,
  kind: QuickBuildStampKind,
  points: THREE.Vector3[],
  texturePreset: QuickBuildTexturePreset | null = null,
  rotationSteps = 0,
  variantId: QuickBuildVariantId | null = null,
) {
  const scene = getQuickBuildScene(app);
  if (!scene) {
    logQuickBuild(
      "Placement blocked: scene unavailable",
      { kind, requestedPoints: points.length },
      "warn",
    );
    return false;
  }

  const baseCellSize = getQuickBuildCellSize(app);
  const cellSize = getQuickBuildToolSnap(app, kind);
  const rotationY = getQuickBuildRotationRadians(rotationSteps);
  const candidates = getQuickBuildPlacementCandidates(
    scene,
    kind,
    points,
    baseCellSize,
    rotationY,
  );
  const placeablePoints = candidates
    .filter((candidate) => candidate.valid)
    .map((candidate) => candidate.point);
  if (placeablePoints.length === 0) {
    logQuickBuild(
      "Placement blocked: no placeable points",
      {
        kind,
        requestedPoints: points.length,
        cellSize,
        baseCellSize,
        candidates: candidates.slice(0, 12).map((candidate) => ({
          key: candidate.key,
          valid: candidate.valid,
          reason: candidate.reason ?? null,
          point: vectorDiagnostics(candidate.point),
        })),
        renderer: rendererDiagnostics(app),
      },
      "warn",
    );
    return false;
  }

  const texture = texturePreset
    ? await loadQuickBuildTexture(texturePreset.url)
    : null;
  const objects = createQuickBuildObjectsForPoints(
    app,
    kind,
    placeablePoints,
    texturePreset,
    texture,
    rotationSteps,
    variantId,
  );
  const addedObjects = new Set<string>();
  const commands = objects.map(
    (object) =>
      new AddObjectCommand(
        object,
        undefined,
        (added: THREE.Object3D | undefined) => {
          if (added?.uuid) {
            addedObjects.add(added.uuid);
          }
          logQuickBuild("AddObject callback", {
            uuid: added?.uuid,
            name: added?.name,
            parent: added?.parent?.name || added?.parent?.type,
            sceneChildren: scene.children.length,
            ...quickBuildDebugDetails(() => ({
              diagnostics: objectRenderDiagnostics(app, added),
            })),
          });
        },
        true,
        true,
      ),
  );
  logQuickBuild("Placement command start", {
    kind,
    requestedPoints: points.length,
    placeablePoints: placeablePoints.length,
    texturePreset: texturePreset?.id ?? null,
    variantId,
    cellSize,
    baseCellSize,
    ...quickBuildDebugDetails(() => ({
      candidates: candidates.slice(0, 12).map((candidate) => ({
        key: candidate.key,
        valid: candidate.valid,
        reason: candidate.reason ?? null,
        point: vectorDiagnostics(candidate.point),
      })),
      renderer: rendererDiagnostics(app),
    })),
  });
  const batchDetails = { kind, count: objects.length };
  app.call("quickBuildBatchStarted", app.editor, batchDetails);
  try {
    const result = await app.editor?.execute(new MultiCmdsCommand(commands));
    const missingParents = objects
      .filter((object) => !object.parent)
      .map((object) => object.uuid);
    for (const object of objects) {
      repairQuickBuildRenderableState(object);
      app.call("objectChanged", app.editor, object);
    }
    app.call("objectChanged", app.editor, scene);
    logQuickBuild(
      missingParents.length > 0
        ? "Placement command completed with detached objects"
        : "Placement command completed",
      {
        kind,
        result,
        variantId,
        objects: objects.map((object) => ({
          uuid: object.uuid,
          position: object.position.toArray(),
          ...quickBuildDebugDetails(() => ({
            diagnostics: objectRenderDiagnostics(app, object),
          })),
        })),
        addedCallbackUuids: [...addedObjects],
        missingParents,
        sceneChildren: scene.children.length,
        cellSize,
        baseCellSize,
      },
      missingParents.length > 0 ? "warn" : "info",
    );
    refreshQuickBuildSceneAdjacency(app, false);
  } catch (error) {
    logQuickBuild(
      "Placement command failed",
      { error: error instanceof Error ? error.message : String(error), kind },
      "error",
    );
    showToast({
      type: "error",
      body: "Could not place Quick Build stamps.",
    });
    return false;
  } finally {
    app.call("quickBuildBatchEnded", app.editor, batchDetails);
  }
  return true;
}

async function eraseQuickBuildObject(
  app: EngineRuntime,
  object: THREE.Object3D,
) {
  try {
    await app.editor?.execute(
      new RemoveObjectCommand(object, app.editor?.selected),
    );
    refreshQuickBuildSceneAdjacency(app, false);
    return true;
  } catch (error) {
    logQuickBuild(
      "Erase command failed",
      { error: error instanceof Error ? error.message : String(error) },
      "error",
    );
    showToast({
      type: "error",
      body: "Could not erase the Quick Build stamp.",
    });
    return false;
  }
}

async function paintQuickBuildObject(
  app: EngineRuntime,
  object: THREE.Object3D,
  preset: QuickBuildTexturePreset,
) {
  if (object.userData?.quickBuildTexture?.presetId === preset.id) {
    logQuickBuild("Paint skipped: texture already applied", {
      uuid: object.uuid,
      kind: getQuickBuildMetadata(object)?.kind ?? null,
      texturePreset: preset.id,
      ...quickBuildDebugDetails(() => ({
        diagnostics: objectRenderDiagnostics(app, object),
      })),
    });
    return false;
  }

  const texture = await loadQuickBuildTexture(preset.url);
  if (!applyQuickBuildTexturePreset(object, preset, texture)) return false;

  app.call("objectChanged", app.editor, object);
  logQuickBuild("Paint applied", {
    uuid: object.uuid,
    kind: getQuickBuildMetadata(object)?.kind ?? null,
    texturePreset: preset.id,
    ...quickBuildDebugDetails(() => ({
      diagnostics: objectRenderDiagnostics(app, object),
    })),
  });
  return true;
}

async function applyQuickBuildTextureToSelection(
  app: EngineRuntime,
  preset: QuickBuildTexturePreset,
) {
  const roots = getSelectedQuickBuildRoots(app).filter((root) => {
    const metadata = getQuickBuildMetadata(root);
    return metadata ? preset.stampKinds.includes(metadata.kind) : false;
  });
  if (roots.length === 0) return 0;

  const texture = await loadQuickBuildTexture(preset.url);
  let appliedCount = 0;
  roots.forEach((root) => {
    if (!applyQuickBuildTexturePreset(root, preset, texture)) return;
    appliedCount += 1;
    app.call("objectChanged", app.editor, root);
  });
  return appliedCount;
}

function disposePreviewObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;

    mesh.geometry?.dispose?.();
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of materials) {
      material.dispose();
    }
  });
}

function setPreviewValidity(object: THREE.Object3D, valid: boolean) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;

    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of materials) {
      const standard = material as THREE.MeshStandardMaterial;
      if (standard.color) {
        standard.color.set(
          valid
            ? builderToolbarToolColors.shared.validPreview
            : builderToolbarToolColors.shared.invalidPreview,
        );
      }
      material.opacity = valid ? 0.42 : 0.28;
    }
  });
}

function createEraseHighlightMaterial(material: THREE.Material) {
  const highlighted = material.clone();
  const maybeStandard = highlighted as THREE.MeshStandardMaterial;
  if (maybeStandard.color) {
    maybeStandard.color.lerp(new THREE.Color(QUICK_BUILD_ERASE_HOVER_COLOR), 0.45);
  }
  if (maybeStandard.emissive) {
    maybeStandard.emissive.set(QUICK_BUILD_ERASE_HOVER_COLOR);
    maybeStandard.emissiveIntensity = Math.max(
      maybeStandard.emissiveIntensity ?? 0,
      0.55,
    );
  }
  highlighted.transparent = true;
  highlighted.opacity = Math.min(0.92, Math.max(0.68, highlighted.opacity));
  highlighted.depthWrite = false;
  highlighted.needsUpdate = true;
  return highlighted;
}

function applyQuickBuildEraseHighlight(object: THREE.Object3D) {
  const records: QuickBuildEraseHighlightRecord[] = [];
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;

    const originalMaterial = mesh.material;
    const highlightMaterial = Array.isArray(originalMaterial)
      ? originalMaterial.map(createEraseHighlightMaterial)
      : createEraseHighlightMaterial(originalMaterial);
    mesh.material = highlightMaterial;
    records.push({ mesh, originalMaterial, highlightMaterial });
  });
  object.userData.quickBuildEraseHover = records.length > 0;
  return records;
}

function clearQuickBuildEraseHighlight(
  object: THREE.Object3D,
  records: QuickBuildEraseHighlightRecord[],
) {
  for (const record of records) {
    record.mesh.material = record.originalMaterial;
    const highlighted = Array.isArray(record.highlightMaterial)
      ? record.highlightMaterial
      : [record.highlightMaterial];
    for (const material of highlighted) {
      material.dispose();
    }
  }
  delete object.userData.quickBuildEraseHover;
}

function getQuickBuildViewport(app: EngineRuntime): HTMLElement | null {
  const candidates = [
    app.viewport,
    app.renderer?.domElement,
    getQuickBuildEditor(app)?.renderer?.domElement,
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

function shouldSkipQuickBuildRaycastObject(
  object: THREE.Object3D,
  sceneHelpers: THREE.Object3D | undefined,
) {
  return (
    object === sceneHelpers ||
    object.visible === false ||
    object.userData?.isRuntimeOnly === true ||
    object.userData?.isQuickBuildPreview === true ||
    object.userData?.isPlanCadPreview === true ||
    object.userData?.isPlanCadManaged === true
  );
}

function getQuickBuildPointerRaycastCandidates(
  scene: THREE.Object3D,
  sceneHelpers: THREE.Object3D | undefined,
) {
  const candidates: THREE.Object3D[] = [];
  const seen = new Set<string>();
  const addCandidate = (object: THREE.Object3D) => {
    if (seen.has(object.uuid)) return;
    if (shouldSkipQuickBuildRaycastObject(object, sceneHelpers)) return;
    seen.add(object.uuid);
    candidates.push(object);
  };

  for (const object of collectQuickBuildObjects(scene)) {
    addCandidate(object);
  }
  for (const child of scene.children) {
    addCandidate(child);
  }

  return candidates;
}

function getPointerQuickBuildHit(
  app: EngineRuntime,
  event: MouseEvent | PointerEvent,
  raycastCandidates?: THREE.Object3D[],
): { point: THREE.Vector3; object: THREE.Object3D | null } | null {
  const editor = getQuickBuildEditor(app);
  const viewport = getQuickBuildViewport(app);
  const camera =
    editor?.view === "perspective"
      ? editor?.camera
      : editor?.orthCamera || editor?.camera;
  const scene = editor?.scene as THREE.Scene | undefined;
  if (!editor || !viewport || !camera || !scene) {
    const point =
      typeof editor?.computeIntersectPoint === "function"
        ? editor.computeIntersectPoint(
            { x: event.clientX, y: event.clientY },
            editor.sceneHelpers,
          )
        : null;
    if (!point) {
      logQuickBuild(
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
    logQuickBuild(
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
  const pickableChildren =
    raycastCandidates ??
    getQuickBuildPointerRaycastCandidates(scene, sceneHelpers);
  const objectIntersect =
    raycaster
      .intersectObjects(pickableChildren, true)
      .find((hit) => !isQuickBuildPreviewObject(hit.object)) ?? null;
  const objectHit = objectIntersect?.object ?? null;
  if (objectIntersect) {
    return { point: objectIntersect.point, object: objectHit };
  }

  const groundPoint = new THREE.Vector3();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  if (raycaster.ray.intersectPlane(groundPlane, groundPoint)) {
    return { point: groundPoint, object: objectHit };
  }

  if (objectHit) {
    const objectPoint = new THREE.Vector3();
    objectHit.getWorldPosition(objectPoint);
    return { point: objectPoint, object: objectHit };
  }

  return null;
}

export const QuickBuildToolbar = ({
  pinnedCodeEditorWidth = 0,
  onClose,
}: QuickBuildToolbarProps) => {
  const [activeTool, setActiveTool] = useState<QuickBuildToolId>("ground");
  const [openToolGroupId, setOpenToolGroupId] = useState<string | null>(null);
  const [brushMode, setBrushMode] = useState<QuickBuildBrushMode>("single");
  const [brushRadius, setBrushRadius] = useState(1);
  const [brushAnchor, setBrushAnchor] = useState<THREE.Vector3 | null>(null);
  const [placementRotationSteps, setPlacementRotationSteps] = useState(0);
  const [texturePackStatus, setTexturePackStatus] =
    useState<TexturePackStatus>("loading");
  const [texturePresets, setTexturePresets] = useState<
    QuickBuildTexturePreset[]
  >([]);
  const [selectedTextureIdsByKind, setSelectedTextureIdsByKind] = useState<
    Partial<Record<QuickBuildStampKind, string>>
  >({});
  const [selectedVariantIdsByKind, setSelectedVariantIdsByKind] = useState<
    Partial<Record<QuickBuildStampKind, QuickBuildVariantId>>
  >({});
  const [selectedQuickBuildKind, setSelectedQuickBuildKind] =
    useState<QuickBuildStampKind | null>(null);
  const [sceneSummary, setSceneSummary] = useState<QuickBuildSceneSummary>({
    stampCount: 0,
    bakedBatchCount: 0,
  });
  const [showHint, setShowHint] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage?.getItem(QUICK_BUILD_HINT_STORAGE_KEY) !== "1";
    } catch {
      return false;
    }
  });
  const activeToolRef = useRef(activeTool);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const brushModeRef = useRef(brushMode);
  const brushRadiusRef = useRef(brushRadius);
  const brushAnchorRef = useRef<THREE.Vector3 | null>(brushAnchor);
  const placementRotationStepsRef = useRef(placementRotationSteps);
  const selectedVariantIdsByKindRef = useRef<
    Partial<Record<QuickBuildStampKind, QuickBuildVariantId>>
  >({});
  const selectedTexturePresetRef = useRef<QuickBuildTexturePreset | null>(null);
  const previewGroupRef = useRef<THREE.Group | null>(null);
  const previewKeyRef = useRef("");
  const lastLiveBatchRefreshAtRef = useRef(0);
  const eraseHighlightRef = useRef<{
    target: THREE.Object3D;
    records: QuickBuildEraseHighlightRecord[];
  } | null>(null);
  const previousDisableClickEvents = useRef<boolean | null>(null);
  const liveBatchEnabledRef = useRef(false);
  const textureTargetKind = isStampTool(activeTool)
    ? activeTool
    : selectedQuickBuildKind;
  const selectedTextureId = textureTargetKind
    ? (selectedTextureIdsByKind[textureTargetKind] ?? "")
    : "";
  const hasTextureSelectionForKind =
    !!textureTargetKind &&
    Object.prototype.hasOwnProperty.call(
      selectedTextureIdsByKind,
      textureTargetKind,
    );
  const compatibleTexturePresets = useMemo(
    () =>
      textureTargetKind
        ? texturePresets.filter((preset) =>
            isQuickBuildTexturePresetCompatible(preset, textureTargetKind),
          )
        : [],
    [textureTargetKind, texturePresets],
  );
  const selectedTexturePreset = useMemo(
    () =>
      compatibleTexturePresets.find(
        (preset) => preset.id === selectedTextureId,
      ) ?? null,
    [compatibleTexturePresets, selectedTextureId],
  );
  const selectedTexturePreviewUrl = selectedTexturePreset?.url ?? "";
  const textureSelectDisabled =
    texturePackStatus !== "loaded" ||
    !textureTargetKind ||
    compatibleTexturePresets.length === 0;
  const textureSelectLabel =
    texturePackStatus === "loading"
      ? "Loading textures"
      : texturePackStatus === "error"
        ? "Texture pack error"
        : texturePackStatus === "unavailable"
          ? "No texture packs"
          : !textureTargetKind
            ? "Select stamp/object"
            : compatibleTexturePresets.length === 0
              ? "No textures for item"
              : "No texture";
  const textureTooltip =
    texturePackStatus === "unavailable"
      ? "No Quick Build texture packs found at /vendor/texture-packs/manifest.json"
      : texturePackStatus === "error"
        ? "Could not load Quick Build texture packs"
        : selectedTexturePreset
          ? formatQuickBuildTexturePresetCredit(selectedTexturePreset)
          : "Texture applies to the selected Quick Build object and future matching stamps";

  const clearPreview = useCallback(() => {
    const preview = previewGroupRef.current;
    previewKeyRef.current = "";
    if (!preview) return;

    preview.parent?.remove(preview);
    disposePreviewObject(preview);
    previewGroupRef.current = null;
  }, []);

  const clearEraseHighlight = useCallback(() => {
    const highlighted = eraseHighlightRef.current;
    if (!highlighted) return;

    clearQuickBuildEraseHighlight(highlighted.target, highlighted.records);
    eraseHighlightRef.current = null;
  }, []);

  const updateEraseHighlight = useCallback(
    (target: THREE.Object3D | null) => {
      if (eraseHighlightRef.current?.target === target) return;
      clearEraseHighlight();
      if (!target) return;

      const records = applyQuickBuildEraseHighlight(target);
      if (records.length === 0) return;
      eraseHighlightRef.current = { target, records };
    },
    [clearEraseHighlight],
  );

  const setBrushAnchorDraft = useCallback((point: THREE.Vector3 | null) => {
    brushAnchorRef.current = point;
    setBrushAnchor(point);
  }, []);

  const setSelectedVariantForKind = useCallback(
    (
      kind: QuickBuildStampKind,
      variantId: QuickBuildVariantId | null | undefined,
    ) => {
      const nextVariantId = variantId ?? getDefaultQuickBuildVariantId(kind);
      if (!nextVariantId) return;
      selectedVariantIdsByKindRef.current = {
        ...selectedVariantIdsByKindRef.current,
        [kind]: nextVariantId,
      };
      setSelectedVariantIdsByKind(selectedVariantIdsByKindRef.current);
    },
    [],
  );

  const activateQuickBuildTool = useCallback(
    (tool: QuickBuildToolId, variantId?: QuickBuildVariantId | null) => {
      activeToolRef.current = tool;
      if (isStampTool(tool) && getQuickBuildVariants(tool).length > 0) {
        setSelectedVariantForKind(tool, variantId);
      }
      if (!isStampTool(tool)) {
        setBrushAnchorDraft(null);
        clearPreview();
      }
      setActiveTool(tool);
    },
    [clearPreview, setBrushAnchorDraft, setSelectedVariantForKind],
  );

  const updatePreview = useCallback(
    (point: THREE.Vector3 | null) => {
      const app = global.app as EngineRuntime | undefined;
      const tool = activeToolRef.current;
      if (!app || !isStampTool(tool) || !point) {
        clearPreview();
        return;
      }

      const scene = getQuickBuildScene(app);
      const helperScene = getQuickBuildEditor(app)?.sceneHelpers;
      if (!scene || !helperScene) {
        clearPreview();
        return;
      }

      const baseCellSize = getQuickBuildCellSize(app);
      const cellSize = getQuickBuildToolSnap(app, tool);
      const brushOrigin = getQuickBuildBrushOrigin(tool, point);
      const points = getQuickBuildBrushPoints(brushOrigin, cellSize, {
        mode: brushModeRef.current,
        radius: brushRadiusRef.current,
        anchor: brushAnchorRef.current,
      });
      const rotationSteps = normalizeRotationStep(
        placementRotationStepsRef.current,
      );
      const rotationY = getQuickBuildRotationRadians(rotationSteps);
      const variantId = resolveSelectedQuickBuildVariantId(
        selectedVariantIdsByKindRef.current,
        tool,
      );
      const candidates = getQuickBuildPlacementCandidates(
        scene,
        tool,
        points,
        baseCellSize,
        rotationY,
      );
      const previewCellCounts = new Map<string, number>();
      const previewPlacements = candidates.map((candidate) => ({
        candidate,
        placementPoint: getQuickBuildResolvedPlacementPoint(
          scene,
          tool,
          candidate.point,
          cellSize,
          previewCellCounts,
        ),
      }));
      const previewKey = JSON.stringify({
        tool,
        mode: brushModeRef.current,
        radius: brushRadiusRef.current,
        snap: cellSize,
        rotationSteps,
        variantId,
        candidates: previewPlacements.map(({ candidate, placementPoint }) => [
          Number(placementPoint.x.toFixed(3)),
          Number(placementPoint.y.toFixed(3)),
          Number(placementPoint.z.toFixed(3)),
          candidate.valid,
        ]),
      });
      if (previewKeyRef.current === previewKey) return;

      clearPreview();
      previewKeyRef.current = previewKey;
      const previewGroup = new THREE.Group();
      previewGroup.name = "Quick Build Preview";
      previewGroup.userData.isQuickBuildPreview = true;

      for (const { candidate, placementPoint } of previewPlacements) {
        const preview = createQuickBuildPreviewObject(tool, { variantId });
        setPreviewValidity(preview, candidate.valid);
        preview.rotation.y = rotationY;
        movePreviewObjectToPoint(preview, placementPoint);
        previewGroup.add(preview);
      }

      if (previewGroup.children.length > 0) {
        helperScene.add(previewGroup);
        previewGroupRef.current = previewGroup;
      }
    },
    [clearPreview],
  );

  const refreshLiveBatch = useCallback(
    (enabled = liveBatchEnabledRef.current) => {
      const app = global.app as EngineRuntime | undefined;
      const scene = app ? getQuickBuildScene(app) : null;
      if (!scene) return;

      lastLiveBatchRefreshAtRef.current =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      liveBatchEnabledRef.current = enabled;
      if (enabled) {
        rebuildQuickBuildLiveBatch(scene);
      } else {
        clearQuickBuildLiveBatches(scene, true);
      }
    },
    [],
  );

  const refreshSceneSummary = useCallback(() => {
    const app = global.app as EngineRuntime | undefined;
    const scene = app ? getQuickBuildScene(app) : null;
    setSceneSummary({
      stampCount: collectQuickBuildObjects(scene).length,
      bakedBatchCount: collectQuickBuildBakeObjects(scene).length,
    });
  }, []);

  const bakeQuickBuildBatch = useCallback(async () => {
    const app = global.app as EngineRuntime | undefined;
    const scene = app ? getQuickBuildScene(app) : null;
    if (!app?.editor || !scene) return;

    clearQuickBuildLiveBatches(scene, true);
    const batch = createQuickBuildBakedBatch(scene);
    if (!batch) {
      showToast({
        type: "error",
        body: "Place Quick Build stamps before optimizing them for play.",
      });
      refreshLiveBatch();
      refreshSceneSummary();
      return;
    }

    const sourceUuids = getBakeSourceUuids([batch]);
    const sourceStates = snapshotQuickBuildBakeSources(scene, sourceUuids);
    try {
      await app.editor.execute?.(
        new QuickBuildBakeCommand(app, batch, sourceStates),
      );
      refreshLiveBatch();
      refreshSceneSummary();
    } catch (error) {
      logQuickBuild(
        "Optimize command failed",
        { error: error instanceof Error ? error.message : String(error) },
        "error",
      );
      showToast({
        type: "error",
        body: "Could not optimize Quick Build stamps for play.",
      });
      refreshLiveBatch();
      refreshSceneSummary();
    }
  }, [refreshLiveBatch, refreshSceneSummary]);

  const clearQuickBuildBakes = useCallback(async () => {
    const app = global.app as EngineRuntime | undefined;
    const scene = app ? getQuickBuildScene(app) : null;
    if (!app?.editor || !scene) return;

    const batches = collectQuickBuildBakeObjects(scene);
    if (batches.length === 0) {
      refreshSceneSummary();
      return;
    }
    const sourceStates = snapshotQuickBuildBakeSources(
      scene,
      getBakeSourceUuids(batches),
    );
    try {
      await app.editor.execute?.(
        new QuickBuildClearBakesCommand(app, batches, sourceStates),
      );
      refreshLiveBatch();
      refreshSceneSummary();
    } catch (error) {
      logQuickBuild(
        "Clear bakes command failed",
        { error: error instanceof Error ? error.message : String(error) },
        "error",
      );
      showToast({
        type: "error",
        body: "Could not restore editable Quick Build stamps.",
      });
      refreshLiveBatch();
      refreshSceneSummary();
    }
  }, [refreshLiveBatch, refreshSceneSummary]);

  useEffect(() => {
    const app = global.app as EngineRuntime | undefined;
    if (!app) return;

    const repairAndRefresh = () => {
      repairQuickBuildSceneRenderState(app);
      refreshSceneSummary();
    };

    repairAndRefresh();
    app.on("sceneGraphChanged.QuickBuildToolbarRepair", repairAndRefresh);
    return () => {
      app.on("sceneGraphChanged.QuickBuildToolbarRepair", null);
      clearQuickBuildLiveBatches(getQuickBuildScene(app), true);
    };
  }, [refreshSceneSummary]);

  const handleTexturePresetChange = useCallback(
    (presetId: string) => {
      if (!textureTargetKind) return;
      setSelectedTextureIdsByKind((previous) => ({
        ...previous,
        [textureTargetKind]: presetId,
      }));

      const preset = compatibleTexturePresets.find(
        (item) => item.id === presetId,
      );
      const app = global.app as EngineRuntime | undefined;
      if (!preset || !app) return;

      void applyQuickBuildTextureToSelection(app, preset)
        .then((appliedCount) => {
          if (appliedCount > 0) {
            showToast({
              type: "success",
              body: `Applied ${preset.label} to ${appliedCount} Quick Build object${appliedCount === 1 ? "" : "s"}.`,
            });
            refreshLiveBatch();
          }
        })
        .catch(() => {
          showToast({
            type: "error",
            body: "Could not load Quick Build texture.",
          });
        });
    },
    [compatibleTexturePresets, refreshLiveBatch, textureTargetKind],
  );

  const updateBrushRadius = useCallback((delta: number) => {
    setBrushMode("radius");
    setBrushRadius((value) => Math.max(1, Math.min(8, value + delta)));
  }, []);

  const rotatePlacement = useCallback((delta: number) => {
    if (!isStampTool(activeToolRef.current)) return;
    setPlacementRotationSteps((value) => {
      const next = normalizeRotationStep(value + delta);
      placementRotationStepsRef.current = next;
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    activeToolRef.current = activeTool;
    if (activeTool !== "erase") {
      clearEraseHighlight();
    }
    if (!isStampTool(activeTool)) {
      setBrushAnchorDraft(null);
      clearPreview();
    }
  }, [activeTool, clearEraseHighlight, clearPreview, setBrushAnchorDraft]);

  useEffect(() => {
    brushModeRef.current = brushMode;
    setBrushAnchorDraft(null);
    clearEraseHighlight();
    clearPreview();
  }, [brushMode, clearEraseHighlight, clearPreview, setBrushAnchorDraft]);

  useEffect(() => () => clearEraseHighlight(), [clearEraseHighlight]);

  useEffect(() => {
    brushRadiusRef.current = brushRadius;
  }, [brushRadius]);

  useEffect(() => {
    brushAnchorRef.current = brushAnchor;
  }, [brushAnchor]);

  useEffect(() => {
    placementRotationStepsRef.current = placementRotationSteps;
    const rotationY = getQuickBuildRotationRadians(placementRotationSteps);
    previewGroupRef.current?.children.forEach((child) => {
      child.rotation.y = rotationY;
    });
  }, [placementRotationSteps]);

  useEffect(() => {
    refreshLiveBatch(activeTool !== "select");

    return () => {
      const app = global.app as EngineRuntime | undefined;
      clearQuickBuildLiveBatches(app ? getQuickBuildScene(app) : null, true);
    };
  }, [activeTool, refreshLiveBatch]);

  useEffect(() => {
    let cancelled = false;
    setTexturePackStatus("loading");

    void loadQuickBuildTexturePackIndex()
      .then(async (index) => {
        if (!index) {
          if (!cancelled) setTexturePackStatus("unavailable");
          return [];
        }
        const packs = await Promise.all(
          index.packs.map((pack) =>
            loadQuickBuildTexturePack(pack.manifestUrl),
          ),
        );
        if (!cancelled) setTexturePackStatus("loaded");
        return packs.flatMap((pack) =>
          QUICK_BUILD_TOOLS.flatMap((tool) =>
            isStampTool(tool.id) ? getTexturePresetsForKind(pack, tool.id) : [],
          ),
        );
      })
      .then((presets) => {
        if (cancelled) return;
        const seen = new Set<string>();
        setTexturePresets(
          presets.filter((preset) => {
            if (seen.has(preset.id)) return false;
            seen.add(preset.id);
            return true;
          }),
        );
      })
      .catch((error) => {
        logQuickBuild(
          "Could not load optional Quick Build texture packs",
          { error: error instanceof Error ? error.message : String(error) },
          "warn",
        );
        if (!cancelled) {
          setTexturePackStatus("error");
          setTexturePresets([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    selectedTexturePresetRef.current = selectedTexturePreset;
  }, [selectedTexturePreset]);

  useEffect(() => {
    selectedVariantIdsByKindRef.current = selectedVariantIdsByKind;
  }, [selectedVariantIdsByKind]);

  useEffect(() => {
    if (!openToolGroupId) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (toolbarRef.current?.contains(event.target as Node)) return;
      setOpenToolGroupId(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenToolGroupId(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openToolGroupId]);

  useEffect(() => {
    if (!textureTargetKind || texturePackStatus !== "loaded") return;
    if (compatibleTexturePresets.length === 0) return;
    const currentSelectionIsCompatible =
      !!selectedTextureId &&
      compatibleTexturePresets.some(
        (preset) => preset.id === selectedTextureId,
      );
    if (currentSelectionIsCompatible) return;
    if (hasTextureSelectionForKind && !selectedTextureId) return;

    const nextTextureId = compatibleTexturePresets[0]?.id ?? "";
    if (nextTextureId === selectedTextureId && hasTextureSelectionForKind)
      return;
    setSelectedTextureIdsByKind((previous) => ({
      ...previous,
      [textureTargetKind]: nextTextureId,
    }));
  }, [
    compatibleTexturePresets,
    hasTextureSelectionForKind,
    selectedTextureId,
    texturePackStatus,
    textureTargetKind,
  ]);

  useEffect(() => {
    const app = global.app as EngineRuntime | undefined;
    if (!app) return;

    const syncSelection = () => {
      const root = getSelectedQuickBuildRoots(app)[0] ?? null;
      const metadata = getQuickBuildMetadata(root);
      setSelectedQuickBuildKind(metadata?.kind ?? null);
      if (metadata?.kind && metadata.variantId) {
        setSelectedVariantForKind(metadata.kind, metadata.variantId);
      }
    };

    app.on("objectSelected.QuickBuildToolbarSelection", syncSelection);
    app.on("objectArraySelected.QuickBuildToolbarSelection", syncSelection);
    syncSelection();

    return () => {
      app.on("objectSelected.QuickBuildToolbarSelection", null);
      app.on("objectArraySelected.QuickBuildToolbarSelection", null);
    };
  }, [setSelectedVariantForKind]);

  useEffect(() => {
    const app = global.app as EngineRuntime | undefined;
    if (!app) return;

    let refreshTimeout: number | null = null;
    const scheduleRefresh = () => {
      if (refreshTimeout !== null) {
        window.clearTimeout(refreshTimeout);
      }
      refreshTimeout = window.setTimeout(() => {
        refreshTimeout = null;
        refreshSceneSummary();
        const now =
          typeof performance !== "undefined" ? performance.now() : Date.now();
        if (
          now - lastLiveBatchRefreshAtRef.current >
          QUICK_BUILD_LIVE_REFRESH_GRACE_MS
        ) {
          refreshLiveBatch();
        }
      }, QUICK_BUILD_SCENE_REFRESH_DEBOUNCE_MS);
    };

    refreshSceneSummary();
    app.on("objectAdded.QuickBuildToolbarLiveBatch", scheduleRefresh);
    app.on("objectRemoved.QuickBuildToolbarLiveBatch", scheduleRefresh);
    app.on("objectChanged.QuickBuildToolbarLiveBatch", scheduleRefresh);

    return () => {
      if (refreshTimeout !== null) {
        window.clearTimeout(refreshTimeout);
      }
      app.on("objectAdded.QuickBuildToolbarLiveBatch", null);
      app.on("objectRemoved.QuickBuildToolbarLiveBatch", null);
      app.on("objectChanged.QuickBuildToolbarLiveBatch", null);
    };
  }, [refreshLiveBatch, refreshSceneSummary]);

  useEffect(() => {
    const app = global.app as EngineRuntime | undefined;
    if (!app) return;

    if (activeTool !== "select" && app.editor?.selected) {
      app.editor.select?.(null, true);
    }

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

  const handleQuickBuildHit = useCallback(
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
      if (
        tool === "select" ||
        !app ||
        app.isPlaying ||
        !app.editor ||
        !intersect?.point
      )
        return;

      if (!options.commit) {
        if (tool === "erase") {
          updateEraseHighlight(getQuickBuildEraseTarget(app, intersect));
        } else {
          clearEraseHighlight();
        }
        updatePreview(intersect.point);
        logQuickBuild(
          "Raycast ignored without Quick Build commit marker",
          {
            tool,
            source: options.source ?? "event-bus",
          },
          "warn",
        );
        return;
      }

      event?.preventDefault?.();
      const quickBuildRoot = findQuickBuildRoot(intersect.object);
      const baseCellSize = getQuickBuildCellSize(app);
      const cellSize = isStampTool(tool)
        ? getQuickBuildToolSnap(app, tool)
        : baseCellSize;
      const placementOrigin =
        tool !== "erase" && isStampTool(tool)
          ? getQuickBuildBrushOrigin(tool, intersect.point)
          : intersect.point;
      const snapped = snapQuickBuildPoint(placementOrigin, cellSize);
      const scene = getQuickBuildScene(app);
      const hitObject = intersect.object ?? null;

      if (tool === "erase") {
        const eraseTarget = getQuickBuildEraseTarget(app, intersect);
        if (eraseTarget) {
          const usingFallback = !quickBuildRoot && eraseTarget !== hitObject;
          logQuickBuild(
            usingFallback
              ? "Erase using nearest-cell fallback"
              : "Erase target resolved",
            {
              targetUuid: eraseTarget.uuid,
              snapped: snapped.toArray(),
              point: intersect.point.toArray(),
              cellSize,
            },
          );
          clearEraseHighlight();
          void eraseQuickBuildObject(app, eraseTarget).then((didErase) => {
            if (didErase) refreshLiveBatch();
          });
        } else {
          logQuickBuild(
            "Erase skipped: no target at cell",
            {
              snapped: snapped.toArray(),
              cellSize,
            },
            "warn",
          );
        }
        return;
      }

      clearEraseHighlight();
      const activeBrushMode = brushModeRef.current;
      const shouldReuseOccupiedCell = isQuickBuildCellExclusiveKind(tool);
      const occupiedRoot =
        shouldReuseOccupiedCell && activeBrushMode === "single" && scene
          ? findQuickBuildObjectAtPoint(scene, tool, snapped, baseCellSize)
          : null;
      const hitRootMetadata = getQuickBuildMetadata(quickBuildRoot);
      const matchingRoot =
        shouldReuseOccupiedCell && hitRootMetadata?.kind === tool
          ? quickBuildRoot
          : occupiedRoot;
      const texturePreset =
        selectedTexturePresetRef.current?.stampKinds.includes(tool)
          ? selectedTexturePresetRef.current
          : null;
      const variantId = resolveSelectedQuickBuildVariantId(
        selectedVariantIdsByKindRef.current,
        tool,
      );

      if (matchingRoot && activeBrushMode === "single") {
        const metadata = getQuickBuildMetadata(matchingRoot);
        if (metadata?.kind === tool) {
          if (texturePreset) {
            if (
              matchingRoot.userData?.quickBuildTexture?.presetId ===
              texturePreset.id
            ) {
              logQuickBuild(
                "Placement skipped: occupied cell already has selected texture",
                {
                  kind: tool,
                  existingUuid: matchingRoot.uuid,
                  texturePreset: texturePreset.id,
                  snapped: snapped.toArray(),
                  hitPoint: vectorDiagnostics(intersect.point),
                  cellSize,
                  ...quickBuildDebugDetails(() => ({
                    diagnostics: objectRenderDiagnostics(app, matchingRoot),
                  })),
                },
              );
              return;
            }
            void paintQuickBuildObject(app, matchingRoot, texturePreset)
              .then((didPaint) => {
                logQuickBuild(
                  didPaint
                    ? "Painted occupied cell"
                    : "Placement skipped: occupied cell paint unavailable",
                  {
                    kind: tool,
                    existingUuid: matchingRoot.uuid,
                    texturePreset: texturePreset.id,
                    snapped: snapped.toArray(),
                    cellSize,
                    ...quickBuildDebugDetails(() => ({
                      diagnostics: objectRenderDiagnostics(app, matchingRoot),
                    })),
                  },
                  didPaint ? "info" : "warn",
                );
                refreshLiveBatch();
              })
              .catch(() => {
                showToast({
                  type: "error",
                  body: "Could not load Quick Build texture.",
                });
              });
            return;
          }

          logQuickBuild(
            "Placement skipped: occupied cell",
            {
              kind: tool,
              existingUuid: matchingRoot.uuid,
              level: metadata.level,
              snapped: snapped.toArray(),
              cellSize,
              hitPoint: vectorDiagnostics(intersect.point),
              ...quickBuildDebugDetails(() => ({
                diagnostics: objectRenderDiagnostics(app, matchingRoot),
              })),
            },
            "warn",
          );
          return;
        }
      }

      if (
        (activeBrushMode === "line" || activeBrushMode === "rectangle") &&
        !brushAnchorRef.current
      ) {
        setBrushAnchorDraft(snapped);
        return;
      }

      const points = getQuickBuildBrushPoints(snapped, cellSize, {
        mode: activeBrushMode,
        radius: brushRadiusRef.current,
        anchor: brushAnchorRef.current,
      });
      logQuickBuild("Viewport commit", {
        tool,
        source: options.source ?? "unknown",
        brushMode: activeBrushMode,
        brushRadius: brushRadiusRef.current,
        pointCount: points.length,
        variantId,
        hitPoint: vectorDiagnostics(intersect.point),
        snapped: snapped.toArray(),
        cellSize,
        hitObject: hitObject
          ? {
              uuid: hitObject.uuid,
              name: hitObject.name || null,
              type: hitObject.type,
              quickBuildRootUuid: quickBuildRoot?.uuid ?? null,
              quickBuildRootKind:
                getQuickBuildMetadata(quickBuildRoot)?.kind ?? null,
            }
          : null,
        ...quickBuildDebugDetails(() => ({
          renderer: rendererDiagnostics(app),
        })),
      });
      void placeQuickBuildObjects(
        app,
        tool,
        points,
        texturePreset,
        placementRotationStepsRef.current,
        variantId,
      )
        .then((didPlace) => {
          if (didPlace) {
            setBrushAnchorDraft(null);
            clearPreview();
            refreshLiveBatch();
          }
        })
        .catch(() => {
          showToast({
            type: "error",
            body: "Could not load Quick Build texture.",
          });
        });
    },
    [
      clearEraseHighlight,
      clearPreview,
      refreshLiveBatch,
      setBrushAnchorDraft,
      updateEraseHighlight,
      updatePreview,
    ],
  );

  useEffect(() => {
    const app = global.app as EngineRuntime | undefined;
    if (!app) return;

    app.on(
      "raycast.QuickBuildToolbar",
      (
        intersect: {
          point?: THREE.Vector3 | null;
          object?: THREE.Object3D | null;
        },
        event?: Event & { quickBuildCommit?: boolean },
      ) => {
        handleQuickBuildHit(intersect, event, {
          commit: event?.quickBuildCommit === true,
          source: "event-bus",
        });
      },
    );

    return () => {
      app.on("raycast.QuickBuildToolbar", null);
    };
  }, [handleQuickBuildHit]);

  useEffect(() => {
    const app = global.app as EngineRuntime | undefined;
    const viewport = app ? getQuickBuildViewport(app) : null;
    if (!app || !viewport) {
      logQuickBuild(
        "Viewport listener unavailable",
        { hasApp: !!app, hasViewport: !!viewport },
        "warn",
      );
      return;
    }
    logQuickBuild("Viewport listener attached", {
      viewportId: viewport.id || null,
      viewportClass: viewport.className || null,
      activeTool,
    });

    let downPoint: { x: number; y: number } | null = null;
    let activePointerId: number | null = null;
    let didDragPaint = false;
    const activeTouchPointers = new Set<number>();
    let pendingPointerMove: PointerEvent | null = null;
    let pointerMoveFrame: number | null = null;
    let strokeRaycastCandidates: THREE.Object3D[] | null = null;

    const isQuickBuildUi = (target: EventTarget | null) =>
      target instanceof Element &&
      !!target.closest("[data-quick-build-ui='true']");

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

    const clearStrokeRaycastCandidates = () => {
      strokeRaycastCandidates = null;
    };

    const getPointerMoveHit = (event: PointerEvent) => {
      if (activePointerId !== event.pointerId || !downPoint) {
        return getPointerQuickBuildHit(app, event);
      }
      if (!strokeRaycastCandidates) {
        const scene = getQuickBuildScene(app);
        const sceneHelpers = getQuickBuildEditor(app)?.sceneHelpers;
        strokeRaycastCandidates = scene
          ? getQuickBuildPointerRaycastCandidates(scene, sceneHelpers)
          : [];
      }
      return getPointerQuickBuildHit(app, event, strokeRaycastCandidates);
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        activeTouchPointers.add(event.pointerId);
      }
      if (
        activeToolRef.current === "select" ||
        event.button !== 0 ||
        shouldIgnorePointer(event) ||
        app.isPlaying ||
        !app.editor ||
        isQuickBuildUi(event.target)
      ) {
        return;
      }
      downPoint = { x: event.clientX, y: event.clientY };
      activePointerId = event.pointerId;
      didDragPaint = false;
      clearStrokeRaycastCandidates();
      viewport.setPointerCapture?.(event.pointerId);
      stopEditorClick(event);
    };

    const canDragPaintFromPointerMove = (event: PointerEvent) => {
      if (
        activePointerId !== event.pointerId ||
        !downPoint ||
        shouldIgnorePointer(event) ||
        isQuickBuildUi(event.target)
      ) {
        return false;
      }
      if (
        brushModeRef.current !== "single" &&
        brushModeRef.current !== "radius" &&
        activeToolRef.current !== "erase"
      ) {
        return false;
      }
      const distance = Math.hypot(
        event.clientX - downPoint.x,
        event.clientY - downPoint.y,
      );
      return distance > 4 || didDragPaint;
    };

    const processPointerMove = (event: PointerEvent) => {
      if (activeToolRef.current === "select") {
        clearEraseHighlight();
        updatePreview(null);
        return;
      }
      if (
        app.isPlaying ||
        !app.editor ||
        shouldIgnorePointer(event) ||
        isQuickBuildUi(event.target)
      )
        return;
      const hit = getPointerMoveHit(event);
      if (activeToolRef.current === "erase") {
        updateEraseHighlight(hit ? getQuickBuildEraseTarget(app, hit) : null);
      } else {
        clearEraseHighlight();
      }
      updatePreview(hit?.point ?? null);

      if (
        activePointerId === event.pointerId &&
        downPoint &&
        hit &&
        (brushModeRef.current === "single" ||
          brushModeRef.current === "radius" ||
          activeToolRef.current === "erase")
      ) {
        const distance = Math.hypot(
          event.clientX - downPoint.x,
          event.clientY - downPoint.y,
        );
        if (distance > 4 || didDragPaint) {
          didDragPaint = true;
          stopEditorClick(event);
          handleQuickBuildHit(hit, event, {
            commit: true,
            source: "viewport-drag",
          });
          clearStrokeRaycastCandidates();
        }
      }
    };

    const schedulePointerMove = (event: PointerEvent) => {
      pendingPointerMove = event;
      if (canDragPaintFromPointerMove(event)) {
        stopEditorClick(event);
      }
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

    const flushScheduledPointerMove = (pointerId: number) => {
      const latestPointerMove = pendingPointerMove;
      cancelScheduledPointerMove();
      if (latestPointerMove && latestPointerMove.pointerId === pointerId) {
        processPointerMove(latestPointerMove);
      }
    };

    const handlePointerLeave = () => {
      cancelScheduledPointerMove();
      clearStrokeRaycastCandidates();
      clearEraseHighlight();
      updatePreview(null);
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        activeTouchPointers.delete(event.pointerId);
      }
      if (activeToolRef.current === "select") {
        cancelScheduledPointerMove();
        clearStrokeRaycastCandidates();
        clearEraseHighlight();
        return;
      }
      if (!downPoint || activePointerId !== event.pointerId) {
        cancelScheduledPointerMove();
        clearStrokeRaycastCandidates();
        clearEraseHighlight();
        return;
      }
      flushScheduledPointerMove(event.pointerId);
      const distance = Math.hypot(
        event.clientX - downPoint.x,
        event.clientY - downPoint.y,
      );
      viewport.releasePointerCapture?.(event.pointerId);
      downPoint = null;
      activePointerId = null;
      clearStrokeRaycastCandidates();
      if (
        event.button !== 0 ||
        didDragPaint ||
        distance > 4 ||
        shouldIgnorePointer(event) ||
        app.isPlaying ||
        !app.editor ||
        isQuickBuildUi(event.target)
      ) {
        clearEraseHighlight();
        return;
      }

      stopEditorClick(event);
      const hit = getPointerQuickBuildHit(app, event);
      if (hit) {
        handleQuickBuildHit(hit, event, { commit: true, source: "viewport" });
      }
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
      clearStrokeRaycastCandidates();
      clearEraseHighlight();
      updatePreview(null);
    };

    viewport.addEventListener("pointerdown", handlePointerDown, true);
    viewport.addEventListener("pointermove", schedulePointerMove, true);
    viewport.addEventListener("pointerleave", handlePointerLeave, true);
    viewport.addEventListener("pointercancel", handlePointerCancel, true);
    document.addEventListener("pointerup", handlePointerUp, true);

    return () => {
      cancelScheduledPointerMove();
      clearStrokeRaycastCandidates();
      viewport.removeEventListener("pointerdown", handlePointerDown, true);
      viewport.removeEventListener("pointermove", schedulePointerMove, true);
      viewport.removeEventListener("pointerleave", handlePointerLeave, true);
      viewport.removeEventListener("pointercancel", handlePointerCancel, true);
      document.removeEventListener("pointerup", handlePointerUp, true);
    };
  }, [
    activeTool,
    clearEraseHighlight,
    handleQuickBuildHit,
    updateEraseHighlight,
    updatePreview,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isInputActive())
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (openToolGroupId) {
          setOpenToolGroupId(null);
          return;
        }
        if (
          brushAnchorRef.current ||
          previewGroupRef.current ||
          activeToolRef.current !== "select"
        ) {
          setBrushAnchorDraft(null);
          clearPreview();
          activateQuickBuildTool("select");
          return;
        }
        onClose?.();
        return;
      }
      if (event.key === "[") {
        event.preventDefault();
        updateBrushRadius(-1);
        return;
      }
      if (event.key === "]") {
        event.preventDefault();
        updateBrushRadius(1);
        return;
      }
      if (
        event.key.toLowerCase() === "r" &&
        isStampTool(activeToolRef.current)
      ) {
        event.preventDefault();
        rotatePlacement(event.shiftKey ? -1 : 1);
        return;
      }

      const next = SHORTCUTS[event.key.toLowerCase()];
      if (!next) return;
      event.preventDefault();
      if (next === "select") {
        setBrushAnchorDraft(null);
      }
      activateQuickBuildTool(next);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activateQuickBuildTool,
    clearPreview,
    onClose,
    openToolGroupId,
    rotatePlacement,
    setBrushAnchorDraft,
    updateBrushRadius,
  ]);

  const activeToolDefinition = QUICK_BUILD_TOOLS.find(
    (tool) => tool.id === activeTool,
  );
  const placementRotationDegrees = getQuickBuildRotationDegrees(
    placementRotationSteps,
  );
  const bakeDisabledReason =
    sceneSummary.stampCount === 0
      ? "Place Quick Build stamps before optimizing them for play."
      : "";
  const clearBakesDisabledReason =
    sceneSummary.bakedBatchCount === 0
      ? "No optimized Quick Build batches to restore."
      : "";
  const bakeTooltip =
    bakeDisabledReason ||
    `Optimize ${sceneSummary.stampCount} Quick Build stamp${sceneSummary.stampCount === 1 ? "" : "s"} for play. Editable stamps stay available in the editor.`;
  const clearBakesTooltip =
    clearBakesDisabledReason ||
    `Restore editable stamps by removing ${sceneSummary.bakedBatchCount} optimized runtime batch${sceneSummary.bakedBatchCount === 1 ? "" : "es"}.`;

  const dismissHint = () => {
    setShowHint(false);
    try {
      window.localStorage?.setItem(QUICK_BUILD_HINT_STORAGE_KEY, "1");
    } catch {
      /* localStorage can be unavailable in private/embedded contexts */
    }
  };

  const handleClose = () => {
    setBrushAnchorDraft(null);
    clearPreview();
    activateQuickBuildTool("select");
    onClose?.();
  };

  return (
    <Toolbar
      ref={toolbarRef}
      $bottom="18px"
      data-testid="quick-build-toolbar"
      data-quick-build-ui="true"
      data-active-tool={activeTool}
      style={
        pinnedCodeEditorWidth > 0
          ? { left: `calc(50% - ${pinnedCodeEditorWidth / 2}%)` }
          : undefined
      }
    >
      <ModeLabel>Quick Build</ModeLabel>
      {onClose && (
        <Tooltip text="Close Quick Build" height="auto">
          <UtilityButton
            type="button"
            aria-label="Close Quick Build"
            data-testid="quick-build-close"
            onClick={handleClose}
          >
            <VscClose size={16} />
          </UtilityButton>
        </Tooltip>
      )}
      {showHint && (
        <CoachMark data-testid="quick-build-hint">
          <CoachMarkText>
            Click the ground to stamp. Number and letter shortcuts switch tools,
            R rotates, Esc exits.
          </CoachMarkText>
          <CoachMarkClose
            type="button"
            aria-label="Dismiss Quick Build hint"
            onClick={dismissHint}
          >
            <VscClose size={13} />
          </CoachMarkClose>
        </CoachMark>
      )}
      <ToolsCluster aria-label="Quick build tools">
        {QUICK_BUILD_PRIMARY_TOOLS.map((tool) => {
          const Icon = tool.Icon;
          const selected = activeTool === tool.id;
          return (
            <Tooltip
              key={tool.id}
              text={`${tool.label}${formatQuickBuildShortcut(tool)}`}
              height="auto"
              triggerWidth="54px"
              triggerHeight="34px"
            >
              <ToolButton
                type="button"
                aria-label={`${tool.label} tool${formatQuickBuildShortcut(tool)}`}
                aria-pressed={selected}
                data-testid={`quick-build-tool-${tool.id}`}
                $selected={selected}
                $color={tool.color}
                onPointerDown={(event) => {
                  if (!event.isPrimary || event.button !== 0) return;
                  event.stopPropagation();
                  activateQuickBuildTool(tool.id);
                }}
                onClick={() => activateQuickBuildTool(tool.id)}
              >
                <Swatch $color={tool.color} />
                <Icon size={16} />
                <ToolLabel>{tool.label}</ToolLabel>
              </ToolButton>
            </Tooltip>
          );
        })}
        {QUICK_BUILD_TOOL_GROUPS.map((group) => {
          const activeVariantId = isStampTool(activeTool)
            ? resolveSelectedQuickBuildVariantId(
                selectedVariantIdsByKind,
                activeTool,
              )
            : null;
          const variantActiveTool =
            isStampTool(activeTool) && activeVariantId
              ? getQuickBuildVariantTool(activeTool, activeVariantId)
              : undefined;
          const groupActiveTool =
            group.tools.find((tool) =>
              variantActiveTool
                ? tool.id === variantActiveTool.id &&
                  tool.variantId === variantActiveTool.variantId
                : isQuickBuildToolSelected(
                    tool,
                    activeTool,
                    selectedVariantIdsByKind,
                  ),
            ) ??
            group.tools.find((tool) => tool.id === activeTool) ??
            group.tools[0]!;
          const GroupIcon = groupActiveTool.Icon;
          const isOpen = openToolGroupId === group.id;
          const selected = group.tools.some((tool) =>
            isQuickBuildToolSelected(
              tool,
              activeTool,
              selectedVariantIdsByKind,
            ),
          );
          return (
            <ToolMenuGroup key={group.id}>
              <Tooltip
                text={`${group.label}: ${group.tools.map((tool) => `${tool.label}${formatQuickBuildShortcut(tool)}`).join(", ")}`}
                height="auto"
                triggerWidth="92px"
                triggerHeight="40px"
              >
                <ToolGroupButton
                  type="button"
                  aria-label={`${group.label} quick build tools`}
                  aria-haspopup="menu"
                  aria-expanded={isOpen}
                  aria-pressed={selected}
                  data-testid={`quick-build-group-${group.id}`}
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
                aria-label={`${group.label} quick build tools`}
                aria-hidden={!isOpen}
                $open={isOpen}
              >
                {group.tools.map((tool) => {
                  const Icon = tool.Icon;
                  const optionSelected = isQuickBuildToolSelected(
                    tool,
                    activeTool,
                    selectedVariantIdsByKind,
                  );
                  return (
                    <ToolMenuItem
                      key={`${tool.id}-${tool.variantId ?? "default"}`}
                      type="button"
                      role="menuitemradio"
                      aria-checked={optionSelected}
                      aria-pressed={optionSelected}
                      aria-label={`${tool.label} tool${formatQuickBuildShortcut(tool)}`}
                      data-testid={getQuickBuildToolTestId(tool)}
                      $selected={optionSelected}
                      $color={tool.color}
                      onPointerDown={(event) => {
                        if (!event.isPrimary || event.button !== 0) return;
                        event.stopPropagation();
                        activateQuickBuildTool(tool.id, tool.variantId);
                        setOpenToolGroupId(null);
                      }}
                      onClick={() => {
                        activateQuickBuildTool(tool.id, tool.variantId);
                        setOpenToolGroupId(null);
                      }}
                    >
                      <ToolMenuIcon $color={tool.color}>
                        <Icon size={15} />
                      </ToolMenuIcon>
                      <ToolMenuText>
                        <ToolMenuLabel>{tool.label}</ToolMenuLabel>
                        <ToolMenuShortcut $empty={!tool.shortcut}>
                          {tool.shortcut ?? ""}
                        </ToolMenuShortcut>
                      </ToolMenuText>
                    </ToolMenuItem>
                  );
                })}
              </ToolMenuSheet>
            </ToolMenuGroup>
          );
        })}
      </ToolsCluster>
      <ActiveDot
        $active={isStampTool(activeTool)}
        $color={activeToolDefinition?.color}
        aria-hidden="true"
      />
      <PanelDivider />
      <Tooltip
        text={textureTooltip}
        height="auto"
        triggerWidth="168px"
        triggerHeight="34px"
      >
        <TextureSelectShell
          data-testid="quick-build-texture-select"
          title={textureTooltip}
          $active={!!selectedTexturePreset}
          $status={texturePackStatus}
        >
          <TexturePreviewThumb
            data-testid="quick-build-texture-preview"
            $active={!!selectedTexturePreset}
            $status={texturePackStatus}
          >
            {selectedTexturePreviewUrl ? (
              <TexturePreviewImage
                src={selectedTexturePreviewUrl}
                alt=""
                aria-hidden="true"
                data-testid="quick-build-texture-preview-image"
                loading="lazy"
              />
            ) : (
              <VscSymbolColor size={14} />
            )}
          </TexturePreviewThumb>
          <TextureSelect
            aria-label="Quick build texture preset"
            data-testid="quick-build-texture-preset"
            value={selectedTexturePreset?.id ?? ""}
            disabled={textureSelectDisabled}
            onChange={(event) =>
              handleTexturePresetChange(event.currentTarget.value)
            }
          >
            <option value="">{textureSelectLabel}</option>
            {compatibleTexturePresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </TextureSelect>
        </TextureSelectShell>
      </Tooltip>
      <PanelDivider />
      <BrushGroup aria-label="Quick build brush modes">
        {BRUSH_TOOLS.map((tool) => {
          const Icon = tool.Icon;
          const selected = brushMode === tool.id;
          return (
            <Tooltip
              key={tool.id}
              text={`${tool.label} brush`}
              height="auto"
              triggerWidth="28px"
              triggerHeight="34px"
            >
              <BrushButton
                type="button"
                aria-label={`${tool.label} brush`}
                aria-pressed={selected}
                data-testid={`quick-build-brush-${tool.id}`}
                $selected={selected}
                onPointerDown={(event) => {
                  if (!event.isPrimary || event.button !== 0) return;
                  event.stopPropagation();
                  setBrushMode(tool.id);
                }}
                onClick={() => setBrushMode(tool.id)}
              >
                <Icon size={14} />
              </BrushButton>
            </Tooltip>
          );
        })}
        <Tooltip
          text={`Radius ${brushRadius} ([ / ])`}
          height="auto"
          triggerWidth="54px"
          triggerHeight="34px"
        >
          <RadiusControl>
            <RadiusButton
              type="button"
              aria-label="Decrease quick build radius"
              disabled={brushRadius <= 1}
              onClick={() => updateBrushRadius(-1)}
            >
              <VscChromeMinimize size={12} />
            </RadiusButton>
            <RadiusValue data-testid="quick-build-radius-value">
              {brushRadius}
            </RadiusValue>
            <RadiusButton
              type="button"
              aria-label="Increase quick build radius"
              disabled={brushRadius >= 8}
              onClick={() => updateBrushRadius(1)}
            >
              <VscAdd size={12} />
            </RadiusButton>
          </RadiusControl>
        </Tooltip>
      </BrushGroup>
      <Tooltip
        text={`Rotate stamp ${placementRotationDegrees}deg (R / Shift+R)`}
        height="auto"
        triggerWidth="72px"
        triggerHeight="34px"
      >
        <RotationControl aria-label="Quick build placement rotation">
          <RotationButton
            type="button"
            aria-label="Rotate quick build stamp counterclockwise"
            disabled={!isStampTool(activeTool)}
            onClick={() => rotatePlacement(-1)}
          >
            <VscRefresh size={13} />
          </RotationButton>
          <RotationValue data-testid="quick-build-rotation-value">
            {placementRotationDegrees}deg
          </RotationValue>
          <RotationButton
            type="button"
            aria-label="Rotate quick build stamp clockwise"
            disabled={!isStampTool(activeTool)}
            onClick={() => rotatePlacement(1)}
          >
            <VscRefresh size={13} />
          </RotationButton>
        </RotationControl>
      </Tooltip>
      <PanelDivider />
      <BakeGroup aria-label="Quick Build optimization controls">
        <Tooltip text={bakeTooltip} height="auto">
          <OutputButton
            type="button"
            aria-label="Optimize Quick Build stamps for play"
            data-testid="quick-build-bake-batch"
            disabled={!!bakeDisabledReason}
            title={bakeTooltip}
            onClick={() => {
              void bakeQuickBuildBatch();
            }}
          >
            <VscArchive size={15} />
            <OutputButtonLabel>Optimize</OutputButtonLabel>
          </OutputButton>
        </Tooltip>
        <Tooltip text={clearBakesTooltip} height="auto">
          <OutputButton
            type="button"
            aria-label="Restore editable Quick Build stamps"
            data-testid="quick-build-clear-bakes"
            disabled={!!clearBakesDisabledReason}
            title={clearBakesTooltip}
            onClick={() => {
              void clearQuickBuildBakes();
            }}
          >
            <VscRefresh size={15} />
            <OutputButtonLabel>Restore</OutputButtonLabel>
          </OutputButton>
        </Tooltip>
        {sceneSummary.bakedBatchCount > 0 && (
          <BakeStatus data-testid="quick-build-bake-status">
            {sceneSummary.bakedBatchCount} optimized
          </BakeStatus>
        )}
      </BakeGroup>
      {brushAnchor && (
        <AnchorPill>
          {brushMode === "line" ? "Line" : "Rect"} start
        </AnchorPill>
      )}
    </Toolbar>
  );
};

const UtilityButton = styled.button`
  width: 34px;
  height: 34px;
  border: 1px solid ${builderToolbarTokens.borderSubtle};
  border-radius: 8px;
  background: ${builderToolbarTokens.surfaceSubtle};
  color: ${builderToolbarTokens.textSecondary};
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;

  &:hover {
    background: ${builderToolbarTokens.surfaceHover};
    border-color: ${builderToolbarTokens.borderSubtle};
  }

  ${focusVisibleRing}

  &:disabled {
    color: ${builderToolbarTokens.textDisabled};
    border-color: ${builderToolbarTokens.borderDisabled};
    background: ${builderToolbarTokens.surfaceDisabled};
    cursor: default;
  }
`;

const OutputButton = styled(UtilityButton)`
  width: 92px;
  grid-auto-flow: column;
  grid-auto-columns: max-content;
  gap: 6px;
  padding: 0 10px;
`;

const OutputButtonLabel = styled.span`
  font-size: 10px;
  font-weight: 800;
  line-height: 1;
`;

const CoachMark = styled.div`
  min-height: 34px;
  max-width: 304px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 24px;
  align-items: center;
  gap: 8px;
  border: 1px solid ${builderToolbarTokens.accentGoldBorder};
  border-radius: 8px;
  background: ${builderToolbarTokens.accentGoldSurface};
  color: ${builderToolbarTokens.accentGoldTextSoft};
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
  color: ${builderToolbarTokens.accentGoldTextSoft};
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;

  &:hover {
    background: ${builderToolbarTokens.surfaceHover};
  }

  ${focusVisibleRing}
`;

const ActiveDot = styled.span<{ $active: boolean; $color?: string }>`
  width: 6px;
  height: 34px;
  border-radius: 999px;
  background: ${({ $color }) => $color || builderToolbarTokens.activeFallback};
  opacity: ${({ $active }) => ($active ? 1 : 0)};
`;

const TextureSelectShell = styled.div<{
  $active: boolean;
  $status: TexturePackStatus;
}>`
  width: 168px;
  flex: 0 0 168px;
  height: 34px;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  border: 1px solid
    ${({ $active, $status }) =>
      $active
        ? builderToolbarTokens.accentGoldBorderStrong
        : $status === "error"
          ? builderToolbarTokens.errorBorder
          : builderToolbarTokens.borderSubtle};
  border-radius: 8px;
  background: ${({ $active, $status }) =>
    $active
      ? builderToolbarTokens.accentGoldSurface
      : $status === "error"
        ? builderToolbarTokens.errorSurface
        : builderToolbarTokens.surfaceSubtle};
  color: ${({ $active, $status }) =>
    $active
      ? builderToolbarTokens.accentGoldText
      : $status === "error"
        ? builderToolbarTokens.errorText
        : builderToolbarTokens.textSecondary};
  padding: 0 8px;
`;

const TexturePreviewThumb = styled.span<{
  $active: boolean;
  $status: TexturePackStatus;
}>`
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 1px solid
    ${({ $active, $status }) =>
      $active
        ? builderToolbarTokens.accentGoldBorderStrong
        : $status === "error"
          ? builderToolbarTokens.errorBorder
          : builderToolbarTokens.borderSubtle};
  border-radius: 6px;
  background:
    linear-gradient(
      45deg,
      ${builderToolbarTokens.surfaceHover} 25%,
      transparent 25%
    ),
    linear-gradient(
      -45deg,
      ${builderToolbarTokens.surfaceHover} 25%,
      transparent 25%
    ),
    linear-gradient(
      45deg,
      transparent 75%,
      ${builderToolbarTokens.surfaceHover} 75%
    ),
    linear-gradient(
      -45deg,
      transparent 75%,
      ${builderToolbarTokens.surfaceHover} 75%
    ),
    ${builderToolbarTokens.darkCheckboard};
  background-position:
    0 0,
    0 6px,
    6px -6px,
    -6px 0;
  background-size: 12px 12px;
  color: ${({ $active, $status }) =>
    $active
      ? builderToolbarTokens.accentGoldText
      : $status === "error"
        ? builderToolbarTokens.errorText
        : builderToolbarTokens.textSecondary};
`;

const TexturePreviewImage = styled.img`
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  image-rendering: auto;
`;

const TextureSelect = styled.select`
  min-width: 0;
  height: 30px;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
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

const BakeGroup = styled.div`
  display: grid;
  grid-template-columns: 92px 92px auto;
  gap: 6px;
  align-items: center;
  flex: 0 0 auto;
`;

const BakeStatus = styled.span`
  min-width: 74px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  place-items: center;
  border: 1px solid ${builderToolbarTokens.borderSubtle};
  border-radius: 8px;
  background: ${builderToolbarTokens.surfaceSubtle};
  color: ${builderToolbarTokens.accentGold};
  font-size: 10px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  padding: 0 8px;
`;

const BrushGroup = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 28px) 54px;
  gap: 6px;
  align-items: center;
  flex: 0 0 auto;
`;

const BrushButton = styled.button<{ $selected: boolean }>`
  width: 28px;
  height: 34px;
  border: 1px solid
    ${({ $selected }) =>
      $selected
        ? builderToolbarTokens.accentGold
        : builderToolbarTokens.borderSubtle};
  border-radius: 8px;
  background: ${({ $selected }) =>
    $selected
      ? builderToolbarTokens.accentGoldSurfaceStrong
      : builderToolbarTokens.surfaceSubtle};
  color: ${({ $selected }) =>
    $selected
      ? builderToolbarTokens.accentGoldText
      : builderToolbarTokens.textPrimary};
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;

  &:hover {
    background: ${builderToolbarTokens.surfaceHover};
    border-color: ${builderToolbarTokens.accentGold};
  }

  ${focusVisibleRing}
`;

const RadiusControl = styled.div`
  width: 54px;
  height: 34px;
  display: grid;
  grid-template-columns: 16px 18px 16px;
  align-items: center;
  border: 1px solid ${builderToolbarTokens.borderSubtle};
  border-radius: 8px;
  background: ${builderToolbarTokens.surfaceSubtle};
`;

const RadiusButton = styled.button`
  width: 16px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 0;
  background: transparent;
  color: ${builderToolbarTokens.textPrimary};
  cursor: pointer;
  padding: 0;

  &:hover:not(:disabled) {
    color: ${builderToolbarTokens.accentGold};
  }

  ${focusVisibleRing}

  &:disabled {
    color: ${builderToolbarTokens.textDisabled};
    cursor: default;
  }
`;

const RadiusValue = styled.span`
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
  text-align: center;
  font-variant-numeric: tabular-nums;
`;

const RotationControl = styled.div`
  width: 72px;
  height: 34px;
  display: grid;
  grid-template-columns: 18px 36px 18px;
  align-items: center;
  border: 1px solid ${builderToolbarTokens.borderSubtle};
  border-radius: 8px;
  background: ${builderToolbarTokens.surfaceSubtle};
  flex: 0 0 72px;
`;

const RotationButton = styled.button`
  width: 18px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 0;
  background: transparent;
  color: ${builderToolbarTokens.textPrimary};
  cursor: pointer;
  padding: 0;

  &:first-child svg {
    transform: scaleX(-1);
  }

  &:hover:not(:disabled) {
    color: ${builderToolbarTokens.accentGold};
  }

  ${focusVisibleRing}

  &:disabled {
    color: ${builderToolbarTokens.textDisabled};
    cursor: default;
  }
`;

const RotationValue = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: clip;
  white-space: nowrap;
  font-size: 10px;
  font-weight: 800;
  line-height: 1;
  text-align: center;
  font-variant-numeric: tabular-nums;
`;
