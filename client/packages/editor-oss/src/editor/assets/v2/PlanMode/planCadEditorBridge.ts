import * as THREE from "three";

import {
  createPlanItemToolNode,
  createPlanNode,
  createPlanSceneState,
  createPlanSlabToolNode,
  createPlanWallToolNode,
  createPlanZoneToolNode,
  deletePlanNode,
  deserializePlanSceneState,
  insertPlanNode,
  PlanSceneRegistry,
  processDirtyPlanNodes,
  serializePlanSceneState,
  updatePlanNode,
} from "./planCadCore";
import type {
  PlanDisplayMode,
  PlanItemSource,
  PlanLevelNode,
  PlanNode,
  PlanPoint2,
  PlanSceneJson,
  PlanSceneState,
  PlanSize3,
  PlanWallNode,
} from "./planCadCore";
import global from "@stem/editor-oss/global";
import { cloneJsonCompatible } from "@stem/editor-oss/utils/cloneJsonCompatible";
import { getLogger } from "@stem/editor-oss/utils/Logger";
import {
  findObjectDepthFirst,
  traverseObjectDepthFirst,
} from "@stem/editor-oss/utils/SceneTraverser";
import { hydratePlanCadModelObjects } from "./planCadModelAssets";
import {
  fetchPascalPlanCadPartCatalogs,
  PASCAL_PLAN_CAD_PART_CATALOGS,
} from "./planCadPascalCatalog";

export const PLAN_CAD_SCENE_USER_DATA_KEY = "planCad";
export const PLAN_CAD_ROOT_NAME = "BIM Plan";
export const PLAN_CAD_SCHEMA = "stem.planCad.v1";

export type PlanCadToolId =
  | "select"
  | "wall"
  | "room"
  | "zone"
  | "door"
  | "window"
  | "part";

export interface PlanCadPartCategory {
  id: string;
  label: string;
  presets: PlanCadPartPreset[];
}

export interface PlanCadPartPreset {
  id: string;
  label: string;
  category: string;
  placement: "floor" | "wall" | "ceiling";
  dimensions: PlanSize3;
  material: string;
  tags: string[];
  source: PlanItemSource;
}

export interface PlanCadSceneData extends PlanSceneJson {
  activeLevelId?: string;
  selectedNodeId?: string | null;
  displayMode?: PlanDisplayMode;
}

export interface PlanCadToolOptions {
  wallHeight?: number;
  wallThickness?: number;
  slabThickness?: number;
  partPresetId?: string;
}

interface PlanCadEditorLike {
  scene?: THREE.Object3D;
  addObject?: (
    object: THREE.Object3D,
    parent?: THREE.Object3D,
  ) => Promise<unknown> | unknown;
  removeObject?: (object: THREE.Object3D) => unknown;
  select?: (object: THREE.Object3D | null, noFocus?: boolean) => unknown;
  execute?: (command: unknown) => Promise<unknown> | unknown;
}

interface PlanCadAppLike {
  editor?: PlanCadEditorLike | null;
  on?: (
    eventName: string,
    handler: ((...args: unknown[]) => void) | null,
  ) => void;
  call?: (eventName: string, ...args: unknown[]) => void;
}

const PLAN_CAD_BUILT_IN_PART_CATALOGS: PlanCadPartCategory[] = [
  {
    id: "furniture",
    label: "Furniture",
    presets: [
      {
        id: "desk",
        label: "Desk",
        category: "furniture",
        placement: "floor",
        dimensions: { x: 1.4, y: 0.76, z: 0.7 },
        material: "wood",
        tags: ["furniture", "desk", "workstation"],
        source: { type: "procedural", presetId: "desk", modelKind: "desk" },
      },
      {
        id: "sofa",
        label: "Sofa",
        category: "furniture",
        placement: "floor",
        dimensions: { x: 2.1, y: 0.82, z: 0.92 },
        material: "fabric",
        tags: ["furniture", "seating", "lounge"],
        source: { type: "procedural", presetId: "sofa", modelKind: "sofa" },
      },
      {
        id: "dining_table",
        label: "Dining Table",
        category: "furniture",
        placement: "floor",
        dimensions: { x: 1.8, y: 0.76, z: 0.95 },
        material: "wood",
        tags: ["furniture", "table", "dining"],
        source: {
          type: "procedural",
          presetId: "dining_table",
          modelKind: "dining_table",
        },
      },
      {
        id: "single_bed",
        label: "Single Bed",
        category: "furniture",
        placement: "floor",
        dimensions: { x: 2.0, y: 0.55, z: 1.0 },
        material: "fabric",
        tags: ["furniture", "bed", "sleeping"],
        source: {
          type: "procedural",
          presetId: "single_bed",
          modelKind: "single_bed",
        },
      },
    ],
  },
  {
    id: "casework",
    label: "Casework",
    presets: [
      {
        id: "cabinet",
        label: "Cabinet",
        category: "casework",
        placement: "floor",
        dimensions: { x: 0.9, y: 1.8, z: 0.45 },
        material: "wood",
        tags: ["casework", "storage", "cabinet"],
        source: {
          type: "procedural",
          presetId: "cabinet",
          modelKind: "cabinet",
        },
      },
      {
        id: "base_cabinet",
        label: "Base Cabinet",
        category: "casework",
        placement: "floor",
        dimensions: { x: 0.9, y: 0.9, z: 0.6 },
        material: "wood",
        tags: ["casework", "kitchen", "base-cabinet"],
        source: {
          type: "procedural",
          presetId: "base_cabinet",
          modelKind: "base_cabinet",
        },
      },
      {
        id: "island",
        label: "Island",
        category: "casework",
        placement: "floor",
        dimensions: { x: 1.8, y: 0.9, z: 0.9 },
        material: "stone",
        tags: ["casework", "kitchen", "island"],
        source: { type: "procedural", presetId: "island", modelKind: "island" },
      },
    ],
  },
  {
    id: "fixtures",
    label: "Fixtures",
    presets: [
      {
        id: "toilet",
        label: "Toilet",
        category: "fixtures",
        placement: "floor",
        dimensions: { x: 0.72, y: 0.78, z: 0.48 },
        material: "ceramic",
        tags: ["plumbing", "bathroom", "toilet"],
        source: { type: "procedural", presetId: "toilet", modelKind: "toilet" },
      },
      {
        id: "sink",
        label: "Sink",
        category: "fixtures",
        placement: "floor",
        dimensions: { x: 0.72, y: 0.86, z: 0.55 },
        material: "ceramic",
        tags: ["plumbing", "bathroom", "sink"],
        source: { type: "procedural", presetId: "sink", modelKind: "sink" },
      },
      {
        id: "shower",
        label: "Shower",
        category: "fixtures",
        placement: "floor",
        dimensions: { x: 0.95, y: 2.1, z: 0.95 },
        material: "glass",
        tags: ["plumbing", "bathroom", "shower"],
        source: { type: "procedural", presetId: "shower", modelKind: "shower" },
      },
    ],
  },
  {
    id: "mep",
    label: "MEP",
    presets: [
      {
        id: "electrical_panel",
        label: "Electrical Panel",
        category: "mep",
        placement: "wall",
        dimensions: { x: 0.45, y: 0.75, z: 0.08 },
        material: "metal",
        tags: ["mep", "electrical", "panel"],
        source: {
          type: "procedural",
          presetId: "electrical_panel",
          modelKind: "electrical_panel",
        },
      },
      {
        id: "hvac_unit",
        label: "HVAC Unit",
        category: "mep",
        placement: "ceiling",
        dimensions: { x: 0.8, y: 0.3, z: 0.8 },
        material: "metal",
        tags: ["mep", "mechanical", "hvac"],
        source: {
          type: "procedural",
          presetId: "hvac_unit",
          modelKind: "hvac_unit",
        },
      },
      {
        id: "floor_drain",
        label: "Floor Drain",
        category: "mep",
        placement: "floor",
        dimensions: { x: 0.22, y: 0.04, z: 0.22 },
        material: "metal",
        tags: ["mep", "plumbing", "drain"],
        source: {
          type: "procedural",
          presetId: "floor_drain",
          modelKind: "floor_drain",
        },
      },
    ],
  },
];

export const PLAN_CAD_PART_CATALOGS: PlanCadPartCategory[] = [
  ...PLAN_CAD_BUILT_IN_PART_CATALOGS,
  ...PASCAL_PLAN_CAD_PART_CATALOGS,
];

export const PLAN_CAD_PART_PRESETS: PlanCadPartPreset[] =
  PLAN_CAD_PART_CATALOGS.flatMap((category) => category.presets);

function replacePlanCadPartCatalogs(catalogs: PlanCadPartCategory[]) {
  PLAN_CAD_PART_CATALOGS.splice(0, PLAN_CAD_PART_CATALOGS.length, ...catalogs);
  PLAN_CAD_PART_PRESETS.splice(
    0,
    PLAN_CAD_PART_PRESETS.length,
    ...PLAN_CAD_PART_CATALOGS.flatMap((category) => category.presets),
  );
}

export function getPlanCadPartCatalogs() {
  return PLAN_CAD_PART_CATALOGS;
}

export function getPlanCadPartPresets() {
  return PLAN_CAD_PART_PRESETS;
}

export function findPlanCadPartPreset(presetId: string | null | undefined) {
  return (
    PLAN_CAD_PART_PRESETS.find((item) => item.id === presetId) ??
    PLAN_CAD_PART_PRESETS[0] ??
    null
  );
}

export async function refreshPascalPlanCadPartCatalogs(
  fetcher?: typeof fetch,
) {
  const pascalCatalogs = await fetchPascalPlanCadPartCatalogs(fetcher);
  const nextCatalogs = [
    ...PLAN_CAD_BUILT_IN_PART_CATALOGS,
    ...pascalCatalogs,
  ];
  replacePlanCadPartCatalogs(nextCatalogs);
  return getPlanCadPartCatalogs();
}

function cloneData<T>(data: T): T {
  return cloneJsonCompatible(data);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

function hashString(input: string) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function getPlanCadDataHash(data: PlanCadSceneData | null | undefined) {
  if (!data) return null;
  const input = stableStringify({
    schema: data.schema,
    rootNodeIds: data.rootNodeIds,
    nodes: data.nodes,
    activeLevelId: data.activeLevelId ?? null,
    selectedNodeId: data.selectedNodeId ?? null,
    displayMode: data.displayMode ?? "stacked",
  });
  return hashString(input);
}

function getPlanCadNodeHash(node: PlanNode) {
  return hashString(stableStringify(node));
}

function disposePlanObject(object: THREE.Object3D) {
  traverseObjectDepthFirst(object, (child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of materials) {
      if (material.userData?.isPlanCadSharedMaterial) continue;
      material.dispose();
    }
  });
}

function pointDistanceSq(a: PlanPoint2, b: PlanPoint2) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function polygonArea(points: PlanPoint2[]) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const current = points[i]!;
    const next = points[(i + 1) % points.length]!;
    area += current.x * next.z - next.x * current.z;
  }
  return area / 2;
}

function normalizePlanPolygon(points: PlanPoint2[]) {
  const normalized: PlanPoint2[] = [];
  for (const point of points) {
    const previous = normalized[normalized.length - 1];
    if (!previous || pointDistanceSq(previous, point) > 0.0001) {
      normalized.push({ x: point.x, z: point.z });
    }
  }
  if (
    normalized.length > 1 &&
    pointDistanceSq(normalized[0]!, normalized[normalized.length - 1]!) <=
      0.0001
  ) {
    normalized.pop();
  }
  if (normalized.length >= 3 && polygonArea(normalized) < 0) {
    normalized.reverse();
  }
  return normalized;
}

function segmentProjectionT(point: PlanPoint2, wall: PlanWallNode) {
  const dx = wall.end.x - wall.start.x;
  const dz = wall.end.z - wall.start.z;
  const lengthSq = dx * dx + dz * dz || 0.000001;
  return Math.max(
    0,
    Math.min(
      1,
      ((point.x - wall.start.x) * dx + (point.z - wall.start.z) * dz) /
        lengthSq,
    ),
  );
}

function wallPointAt(wall: PlanWallNode, t: number): PlanPoint2 {
  return {
    x: wall.start.x + (wall.end.x - wall.start.x) * t,
    z: wall.start.z + (wall.end.z - wall.start.z) * t,
  };
}

function getLevels(state: PlanSceneState) {
  return Object.values(state.nodes)
    .filter((node): node is PlanLevelNode => node.type === "level")
    .sort((a, b) => a.index - b.index);
}

function getActiveLevelId(state: PlanSceneState, data?: PlanCadSceneData) {
  if (data?.activeLevelId && state.nodes[data.activeLevelId]?.type === "level")
    return data.activeLevelId;
  return getLevels(state)[0]?.id ?? null;
}

function isPlanCadSceneContainerNode(node: PlanNode) {
  return (
    node.type === "site" || node.type === "building" || node.type === "level"
  );
}

function applyPlanObjectMetadata(object: THREE.Object3D, node: PlanNode) {
  const typeLabel = `${node.type[0]!.toUpperCase()}${node.type.slice(1)}`;
  const displayName = node.name?.trim();
  object.name = displayName ? `${typeLabel}: ${displayName}` : `BIM ${typeLabel}`;
  object.userData.isStemObject = true;
  object.userData.isSelectable = true;
  object.userData.isRuntimeOnly = true;
  object.userData.isBatchable = false;
  object.userData.isPlanCadManaged = true;
  object.userData.managedBy = "BIM Plan";
  object.userData.sceneTreeBadge = "BIM";
  object.userData.sceneTreeDescription = "Managed by BIM Plan";
  object.userData.planNodeId = node.id;
  object.userData.planNodeType = node.type;
  object.userData.editorVisibility = node.visible;
  object.userData.gameVisibility = false;
  object.visible = node.visible;
}

function createPlanObjectForNode(node: PlanNode) {
  let object: THREE.Object3D;
  switch (node.type) {
    case "wall":
    case "site":
    case "building":
    case "level":
    case "guide":
    case "scan":
      object = new THREE.Group();
      break;
    case "slab":
    case "ceiling":
    case "roof":
    case "zone":
      object = new THREE.Mesh();
      break;
    case "item":
      object = new THREE.Group();
      break;
  }

  applyPlanObjectMetadata(object, node);
  return object;
}

export function createDefaultPlanCadData(): PlanCadSceneData {
  const site = createPlanNode("site", { id: "site_main", name: "Site" });
  const building = createPlanNode("building", {
    id: "building_main",
    parentId: site.id,
    name: "Building",
  });
  const level = createPlanNode("level", {
    id: "level_ground",
    parentId: building.id,
    name: "Ground Floor",
    elevation: 0,
    height: 3,
    index: 0,
  });
  const state = createPlanSceneState([site, building, level]);
  return {
    ...serializePlanSceneState(state),
    activeLevelId: level.id,
    selectedNodeId: null,
    displayMode: "stacked",
  };
}

export function getPlanCadSceneData(
  scene?: THREE.Object3D | null,
): PlanCadSceneData | null {
  const raw = scene?.userData?.[PLAN_CAD_SCENE_USER_DATA_KEY];
  if (!raw || raw.schema !== PLAN_CAD_SCHEMA) return null;
  return cloneData(raw as PlanCadSceneData);
}

export function getUnsupportedPlanCadSchema(
  scene?: THREE.Object3D | null,
): string | null {
  const raw = scene?.userData?.[PLAN_CAD_SCENE_USER_DATA_KEY] as
    | { schema?: unknown }
    | undefined;
  if (!raw || raw.schema === PLAN_CAD_SCHEMA) return null;
  return typeof raw.schema === "string" ? raw.schema : "unknown";
}

export function getOrCreatePlanCadSceneData(
  scene?: THREE.Object3D | null,
): PlanCadSceneData {
  return getPlanCadSceneData(scene) ?? createDefaultPlanCadData();
}

export function planCadDataToState(data: PlanCadSceneData): PlanSceneState {
  return deserializePlanSceneState(data);
}

export function planCadStateToData(
  state: PlanSceneState,
  previous?: PlanCadSceneData,
): PlanCadSceneData {
  const base = serializePlanSceneState(state);
  return {
    ...base,
    activeLevelId: getActiveLevelId(state, previous) ?? previous?.activeLevelId,
    selectedNodeId: previous?.selectedNodeId ?? null,
    displayMode: previous?.displayMode ?? "stacked",
  };
}

export function mutatePlanCadData(
  current: PlanCadSceneData | null | undefined,
  mutator: (
    state: PlanSceneState,
    activeLevelId: string,
  ) => string | null | void,
): PlanCadSceneData {
  const previous = current ?? createDefaultPlanCadData();
  const state = planCadDataToState(previous);
  const activeLevelId = getActiveLevelId(state, previous);
  if (!activeLevelId) return previous;

  const selectedNodeId = mutator(state, activeLevelId);
  const next = planCadStateToData(state, previous);
  if (selectedNodeId !== undefined) {
    next.selectedNodeId = selectedNodeId;
  }
  return next;
}

export function createPlanCadRootObject(
  data: PlanCadSceneData = createDefaultPlanCadData(),
) {
  const root = new THREE.Group();
  root.name = PLAN_CAD_ROOT_NAME;
  root.userData.isStemObject = true;
  root.userData.isSelectable = true;
  root.userData.isRuntimeOnly = true;
  root.userData.isBatchable = false;
  root.userData.isPlanCadRoot = true;
  root.userData.isPlanCadManaged = true;
  root.userData.managedBy = "BIM Plan";
  root.userData.editorVisibility = true;
  root.userData.gameVisibility = false;
  rebuildPlanCadRootObject(root, data);
  return root;
}

export function findPlanCadRoot(
  scene?: THREE.Object3D | null,
): THREE.Object3D | null {
  if (!scene) return null;
  return findObjectDepthFirst(scene, (object) => object.userData?.isPlanCadRoot === true);
}

function findPlanCadRoots(scene: THREE.Object3D): THREE.Object3D[] {
  const roots: THREE.Object3D[] = [];
  traverseObjectDepthFirst(scene, (object) => {
    if (object !== scene && object.userData?.isPlanCadRoot === true) {
      roots.push(object);
    }
  });
  return roots;
}

export function findPlanCadNodeObject(
  object?: THREE.Object3D | null,
): THREE.Object3D | null {
  let current: THREE.Object3D | null | undefined = object;
  while (current) {
    if (typeof current.userData?.planNodeId === "string") return current;
    current = current.parent;
  }
  return null;
}

export function getPlanCadNodeIdFromObject(
  object?: THREE.Object3D | null,
): string | null {
  const planObject = findPlanCadNodeObject(object);
  const nodeId = planObject?.userData?.planNodeId;
  if (typeof nodeId === "string") return nodeId;

  const ownerNodeId = object?.userData?.planCadOwnerNodeId;
  return typeof ownerNodeId === "string" ? ownerNodeId : null;
}

function findPlanCadDeletionNodeId(
  object?: THREE.Object3D | null,
): string | null {
  const directNodeId = getPlanCadNodeIdFromObject(object);
  if (directNodeId) return directNodeId;

  let result: string | null = null;
  if (object) {
    traverseObjectDepthFirst(object, (child) => {
      if (result) return;
      const childNodeId = child.userData?.planNodeId;
      if (typeof childNodeId === "string") {
        result = childNodeId;
        return;
      }
      const ownerNodeId = child.userData?.planCadOwnerNodeId;
      if (typeof ownerNodeId === "string") result = ownerNodeId;
    });
  }
  return result;
}

export async function deleteManagedPlanCadObject(
  editorInput: PlanCadEditorLike | PlanCadAppLike | null | undefined,
  object?: THREE.Object3D | null,
) {
  const editor =
    getEditorFromTarget(editorInput) ??
    (global.app?.editor as PlanCadEditorLike | undefined);
  const scene = editor?.scene as THREE.Object3D | undefined;
  if (!editor || !scene || !object) return false;

  const data = getPlanCadSceneData(scene);
  if (!data) return false;

  if (object.userData?.isPlanCadRoot) {
    return commitPlanCadSceneData(editor, null);
  }

  const nodeId = findPlanCadDeletionNodeId(object);
  if (!nodeId) return false;

  const nextData = deletePlanCadNodeData(data, nodeId);
  if (getPlanCadDataHash(nextData) === getPlanCadDataHash(data)) return false;
  return commitPlanCadSceneData(editor, nextData);
}

export function findPlanCadNodeObjectById(
  root: THREE.Object3D | null | undefined,
  nodeId: string | null | undefined,
): THREE.Object3D | null {
  if (!root || !nodeId) return null;
  return findObjectDepthFirst(root, (object) => object.userData?.planNodeId === nodeId);
}

function getStoredPlanNodeHashes(root: THREE.Object3D): Record<string, string> {
  const hashes = root.userData?.planCad?.nodeHashes;
  return hashes && typeof hashes === "object" && !Array.isArray(hashes)
    ? (hashes as Record<string, string>)
    : {};
}

function resetPlanObjectTransform(object: THREE.Object3D, node: PlanNode) {
  object.position.set(0, 0, 0);
  object.rotation.set(0, 0, 0);
  object.scale.set(1, 1, 1);
  if (node.type === "level") {
    object.position.y = node.elevation;
  }
}

function removeGeneratedObject(object: THREE.Object3D) {
  disposePlanObject(object);
  object.parent?.remove(object);
}

export function rebuildPlanCadRootObject(
  root: THREE.Object3D,
  data: PlanCadSceneData,
  options: { force?: boolean } = {},
) {
  root.userData.isRuntimeOnly = true;
  root.userData.isBatchable = false;
  root.userData.isPlanCadRoot = true;
  root.userData.isPlanCadManaged = true;
  root.userData.managedBy = "BIM Plan";

  const state = planCadDataToState(data);
  const registry = new PlanSceneRegistry();
  const previousNodeHashes = getStoredPlanNodeHashes(root);
  const nextNodeHashes: Record<string, string> = {};
  const dirtyNodeIds = new Set<string>();
  const objects = new Map<string, THREE.Object3D>();
  const existingObjects = new Map<string, THREE.Object3D>();
  const sceneNodes = Object.values(state.nodes).filter(
    (node) => !isPlanCadSceneContainerNode(node),
  );
  const sceneNodeIds = new Set(sceneNodes.map((node) => node.id));

  traverseObjectDepthFirst(root, (object) => {
    const nodeId = object.userData?.planNodeId;
    if (typeof nodeId === "string") {
      existingObjects.set(nodeId, object);
    }
  }, { includeRoot: false });

  for (const [nodeId, object] of existingObjects) {
    const node = state.nodes[nodeId];
    if (
      !node ||
      !sceneNodeIds.has(nodeId) ||
      object.userData?.planNodeType !== node.type
    ) {
      removeGeneratedObject(object);
      continue;
    }

    applyPlanObjectMetadata(object, node);
    objects.set(node.id, object);
    registry.register(node, object);
  }

  for (const node of sceneNodes) {
    const nodeHash = getPlanCadNodeHash(node);
    nextNodeHashes[node.id] = nodeHash;
    let object = objects.get(node.id);
    if (!object) {
      object = createPlanObjectForNode(node);
      objects.set(node.id, object);
      registry.register(node, object);
      dirtyNodeIds.add(node.id);
      continue;
    }
    if (options.force || previousNodeHashes[node.id] !== nodeHash) {
      dirtyNodeIds.add(node.id);
    }
  }

  const getVisibleParent = (node: PlanNode) => {
    let parentId = node.parentId;
    while (parentId) {
      const object = objects.get(parentId);
      if (object) return object;
      parentId = state.nodes[parentId]?.parentId ?? null;
    }
    return root;
  };

  for (const node of sceneNodes) {
    const object = objects.get(node.id);
    if (!object) continue;
    getVisibleParent(node).add(object);
  }

  for (const id of dirtyNodeIds) {
    const node = state.nodes[id];
    const object = objects.get(id);
    if (node && object) resetPlanObjectTransform(object, node);
  }

  state.dirtyNodeIds = dirtyNodeIds;
  processDirtyPlanNodes(state, registry);

  root.userData.planCad = {
    schema: data.schema,
    activeLevelId: data.activeLevelId,
    selectedNodeId: data.selectedNodeId ?? null,
    displayMode: data.displayMode ?? "stacked",
    nodeCount: Object.keys(data.nodes).length,
    dataHash: getPlanCadDataHash(data),
    nodeHashes: nextNodeHashes,
  };

  return { state, registry };
}

function isRootSyncedToData(
  root: THREE.Object3D | null,
  data: PlanCadSceneData | null,
) {
  if (!root || !data) return false;
  return root.userData?.planCad?.dataHash === getPlanCadDataHash(data);
}

function removePlanCadDataFromScene(scene: THREE.Object3D) {
  const nextUserData = { ...(scene.userData || {}) };
  delete nextUserData[PLAN_CAD_SCENE_USER_DATA_KEY];
  scene.userData = nextUserData;
}

function hydratePlanCadExternalModels(root: THREE.Object3D, data: PlanCadSceneData) {
  const tasks = hydratePlanCadModelObjects(root, data);
  if (tasks.length) void Promise.allSettled(tasks);
}

function setPlanCadDataOnScene(scene: THREE.Object3D, data: PlanCadSceneData) {
  scene.userData = {
    ...(scene.userData || {}),
    [PLAN_CAD_SCENE_USER_DATA_KEY]: cloneData(data),
  };
}

async function addRootToEditor(
  editor: PlanCadEditorLike,
  root: THREE.Object3D,
) {
  if (typeof editor?.addObject === "function") {
    await editor.addObject(root);
    return;
  }
  editor?.scene?.add(root);
}

function removeRootFromEditor(editor: PlanCadEditorLike, root: THREE.Object3D) {
  if (typeof editor?.removeObject === "function" && root.parent) {
    editor.removeObject(root);
    return;
  }
  root.parent?.remove(root);
}

function isPlanCadEditorLike(
  target: PlanCadEditorLike | PlanCadAppLike,
): target is PlanCadEditorLike {
  return Object.prototype.hasOwnProperty.call(target, "scene");
}

function getEditorFromTarget(
  target: PlanCadEditorLike | PlanCadAppLike | null | undefined,
) {
  if (!target) return undefined;
  if (isPlanCadEditorLike(target)) return target;
  return target.editor ?? undefined;
}

export function setPlanCadSceneSelection(
  editorInput: PlanCadEditorLike | PlanCadAppLike | null | undefined,
  nodeId: string | null,
  options: { source?: unknown } = {},
) {
  const editor =
    getEditorFromTarget(editorInput) ??
    (global.app?.editor as PlanCadEditorLike | undefined);
  const scene = editor?.scene as THREE.Object3D | undefined;
  if (!scene) return false;

  const data = getPlanCadSceneData(scene);
  if (!data) return false;

  const nextNodeId = nodeId && data.nodes[nodeId] ? nodeId : null;
  if ((data.selectedNodeId ?? null) === nextNodeId) return false;

  const nextData = { ...data, selectedNodeId: nextNodeId };
  setPlanCadDataOnScene(scene, nextData);

  const root = findPlanCadRoot(scene);
  if (root?.userData?.planCad) {
    root.userData.planCad = {
      ...root.userData.planCad,
      selectedNodeId: nextNodeId,
      dataHash: getPlanCadDataHash(nextData),
    };
  }

  const source = options.source ?? editor;
  global.app?.call?.("planCadChanged", source, nextData);
  global.app?.call?.("objectChanged", source, scene);
  return true;
}

export interface PlanCadSceneSyncResult {
  data: PlanCadSceneData | null;
  root: THREE.Object3D | null;
  changed: boolean;
}

const planCadSceneSyncQueues = new WeakMap<THREE.Object3D, Promise<unknown>>();

async function syncPlanCadSceneNow(
  editor: PlanCadEditorLike,
  scene: THREE.Object3D,
  options: { force?: boolean; selectNode?: boolean; source?: unknown },
): Promise<PlanCadSceneSyncResult> {
  const app = global.app;
  const data = getPlanCadSceneData(scene);
  const roots = findPlanCadRoots(scene);
  let root = roots[0] ?? null;
  let changed = false;

  // Multiple UI owners can request scene synchronization during the same
  // scene-load turn. Keep one canonical generated root and remove stale copies
  // left by older builds or an interrupted concurrent load.
  for (let index = 1; index < roots.length; index += 1) {
    const duplicate = roots[index]!;
    disposePlanObject(duplicate);
    // This is internal render-state repair, not a user deletion. Removing it
    // directly avoids the objectRemoved handler interpreting the duplicate as
    // a request to delete the canonical Plan/CAD scene data.
    duplicate.parent?.remove(duplicate);
    changed = true;
  }

  if (!data) {
    if (root) {
      removeRootFromEditor(editor, root);
      root = null;
      changed = true;
    }
    return { data: null, root, changed };
  }

  if (!root) {
    root = createPlanCadRootObject(data);
    await addRootToEditor(editor, root);
    changed = true;
  }

  if (root && (options.force || !isRootSyncedToData(root, data))) {
    rebuildPlanCadRootObject(root, data, { force: options.force });
    changed = true;
  }

  if (root) hydratePlanCadExternalModels(root, data);

  if (root && options.selectNode) {
    const selectedObject = findPlanCadNodeObjectById(
      root,
      data.selectedNodeId ?? null,
    );
    if (selectedObject) editor.select?.(selectedObject, true);
  }

  if (changed) {
    app?.call?.("planCadChanged", options.source ?? editor, data);
  }

  return { data, root, changed };
}

export function syncPlanCadScene(
  editorInput?: PlanCadEditorLike | PlanCadAppLike | null,
  options: { force?: boolean; selectNode?: boolean; source?: unknown } = {},
): Promise<PlanCadSceneSyncResult> {
  const editor =
    getEditorFromTarget(editorInput) ??
    (global.app?.editor as PlanCadEditorLike | undefined);
  const scene = editor?.scene as THREE.Object3D | undefined;
  if (!editor || !scene) {
    return Promise.resolve({ data: null, root: null, changed: false });
  }

  const previous = planCadSceneSyncQueues.get(scene);
  const current = previous
    ? previous
        .catch(() => undefined)
        .then(() => syncPlanCadSceneNow(editor, scene, options))
    : syncPlanCadSceneNow(editor, scene, options);
  planCadSceneSyncQueues.set(scene, current);
  const clearQueue = () => {
    if (planCadSceneSyncQueues.get(scene) === current) {
      planCadSceneSyncQueues.delete(scene);
    }
  };
  void current.then(clearQueue, clearQueue);
  return current;
}

class PlanCadSceneDataCommand {
  type = "PlanCadSceneDataCommand";
  name = "Set BIM Plan data";
  updatable = false;
  object?: THREE.Object3D;
  oldData: PlanCadSceneData | null;
  newData: PlanCadSceneData | null;

  constructor(
    private readonly editor: PlanCadEditorLike,
    data: PlanCadSceneData | null,
    oldData?: PlanCadSceneData | null,
  ) {
    this.object = editor?.scene;
    this.oldData = oldData !== undefined ? (oldData ? cloneData(oldData) : null) : getPlanCadSceneData(this.object);
    this.newData = data ? cloneData(data) : null;
  }

  private async apply(data: PlanCadSceneData | null) {
    const scene = this.editor?.scene as THREE.Object3D | undefined;
    const app = global.app;
    if (!scene) {
      return { message: "PlanCadSceneDataCommand: no scene", status: "error" };
    }

    if (data) {
      setPlanCadDataOnScene(scene, data);
      const { root } = await syncPlanCadScene(this.editor, {
        selectNode: true,
        source: this,
      });
      if (root) app?.call?.("objectChanged", this, root);
      app?.call?.("objectChanged", this, scene);
      app?.call?.("planCadChanged", this, data);
      return {
        message: "PlanCadSceneDataCommand: data changed",
        status: "success",
      };
    }

    removePlanCadDataFromScene(scene);
    await syncPlanCadScene(this.editor, { source: this });
    app?.call?.("objectChanged", this, scene);
    app?.call?.("planCadChanged", this, null);
    return {
      message: "PlanCadSceneDataCommand: data cleared",
      status: "success",
    };
  }

  execute() {
    return this.apply(this.newData);
  }

  undo() {
    return this.apply(this.oldData);
  }
}

export async function commitPlanCadSceneData(
  editorInput: PlanCadEditorLike | PlanCadAppLike | null | undefined,
  data: PlanCadSceneData | null,
  options: { oldData?: PlanCadSceneData | null } = {},
) {
  const editor =
    getEditorFromTarget(editorInput) ??
    (global.app?.editor as PlanCadEditorLike | undefined);
  if (!editor?.scene) return false;
  const unsupportedSchema = getUnsupportedPlanCadSchema(editor.scene);
  if (unsupportedSchema) {
    getLogger()?.warn("[BIMCAD] Unsupported Plan schema is read-only", {
      schema: unsupportedSchema,
    });
    return false;
  }
  const command = new PlanCadSceneDataCommand(editor, data, options.oldData);
  try {
    if (typeof editor.execute === "function") {
      await editor.execute(command);
    } else {
      await command.execute();
    }
  } catch (error) {
    getLogger()?.error("[BIMCAD] Plan commit failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
  return true;
}

function isManagedPlanCadObject(object?: THREE.Object3D | null) {
  return (
    !!object?.userData?.isPlanCadManaged ||
    typeof object?.userData?.planNodeId === "string"
  );
}

function isPlanCadSceneDataCommandSource(source?: unknown) {
  return (
    !!source &&
    typeof source === "object" &&
    (source as { type?: unknown }).type === "PlanCadSceneDataCommand"
  );
}

export function installPlanCadSceneSync(
  app: PlanCadAppLike | null | undefined,
) {
  const editor = app?.editor;
  const on = app?.on;
  if (!on || !editor) return () => {};

  let syncing = false;
  const runSync = (
    options: { force?: boolean; selectNode?: boolean; source?: unknown } = {},
  ) => {
    if (syncing) return;
    syncing = true;
    void syncPlanCadScene(editor, options).finally(() => {
      syncing = false;
    });
  };

  const syncAfterSceneDataChange = (
    _source?: unknown,
    object?: THREE.Object3D,
  ) => {
    if (!object || object === editor.scene) runSync({ source: _source });
  };

  const resetManagedObject = (source?: unknown, object?: THREE.Object3D) => {
    if (!object || object === editor.scene) return;
    if (isPlanCadSceneDataCommandSource(source)) return;
    if (object.userData?.isPlanCadRoot) {
      runSync({ force: true, source });
      return;
    }
    if (isManagedPlanCadObject(object))
      runSync({ force: true, selectNode: true, source });
  };

  on("historyChanged.PlanCadSceneSync", () => runSync());
  on("sceneLoaded.PlanCadSceneSync", () => runSync({ force: true }));
  on("editorCleared.PlanCadSceneSync", () => runSync({ force: true }));
  on("objectChanged.PlanCadSceneSync", (...args: unknown[]) => {
    const [source, object] = args as [unknown, THREE.Object3D | undefined];
    syncAfterSceneDataChange(source, object);
  });
  on("objectRemoved.PlanCadSceneSync", (...args: unknown[]) => {
    const [source, object] = args as [unknown, THREE.Object3D | undefined];
    if (object?.userData?.isPlanCadRoot) {
      const scene = editor.scene;
      if (!scene) return;
      const oldData = getPlanCadSceneData(scene);
      if (oldData) {
        removePlanCadDataFromScene(scene);
        app?.call?.("objectChanged", source ?? editor, scene);
        app?.call?.("planCadChanged", source ?? editor, null);
        void commitPlanCadSceneData(editor, null, { oldData });
      }
      return;
    }
    resetManagedObject(source, object);
  });
  on("objectSelected.PlanCadSceneSync", (...args: unknown[]) => {
    const [source, object] = args as [
      unknown,
      THREE.Object3D | THREE.Object3D[] | null | undefined,
    ];
    const selectedObject = Array.isArray(object) ? null : object;
    setPlanCadSceneSelection(
      editor,
      getPlanCadNodeIdFromObject(selectedObject),
      { source },
    );
  });

  runSync({ force: false });

  return () => {
    on("historyChanged.PlanCadSceneSync", null);
    on("sceneLoaded.PlanCadSceneSync", null);
    on("editorCleared.PlanCadSceneSync", null);
    on("objectChanged.PlanCadSceneSync", null);
    on("objectRemoved.PlanCadSceneSync", null);
    on("objectSelected.PlanCadSceneSync", null);
  };
}

export function setPlanCadSelection(
  data: PlanCadSceneData,
  nodeId: string | null,
): PlanCadSceneData {
  return { ...cloneData(data), selectedNodeId: nodeId };
}

export function updatePlanCadNodeData(
  data: PlanCadSceneData,
  nodeId: string,
  updates: Partial<PlanNode>,
) {
  return mutatePlanCadData({ ...data, selectedNodeId: nodeId }, (state) => {
    const current = state.nodes[nodeId];
    if (!current) return null;
    updatePlanNode(
      state,
      nodeId,
      updates as Partial<Omit<PlanNode, "id" | "type">>,
    );
    return nodeId;
  });
}

export function deletePlanCadNodeData(data: PlanCadSceneData, nodeId: string) {
  return mutatePlanCadData({ ...data, selectedNodeId: null }, (state) => {
    const current = state.nodes[nodeId];
    if (
      !current ||
      current.type === "site" ||
      current.type === "building" ||
      current.type === "level"
    ) {
      return undefined;
    }
    deletePlanNode(state, nodeId);
    return null;
  });
}

export function createPlanCadWall(
  data: PlanCadSceneData | null | undefined,
  start: PlanPoint2,
  end: PlanPoint2,
  options: PlanCadToolOptions = {},
) {
  return mutatePlanCadData(data, (state, activeLevelId) => {
    if (pointDistanceSq(start, end) < 0.0001) return null;
    const wall = createPlanWallToolNode(activeLevelId, start, end, {
      height: options.wallHeight ?? 3,
      thickness: options.wallThickness ?? 0.2,
      material: "wall",
    });
    insertPlanNode(state, wall);
    return wall.id;
  });
}

export function createPlanCadRectangleSlab(
  data: PlanCadSceneData | null | undefined,
  start: PlanPoint2,
  end: PlanPoint2,
  options: PlanCadToolOptions = {},
) {
  return mutatePlanCadData(data, (state, activeLevelId) => {
    if (pointDistanceSq(start, end) < 0.0001) return null;
    const points = [
      { x: start.x, z: start.z },
      { x: end.x, z: start.z },
      { x: end.x, z: end.z },
      { x: start.x, z: end.z },
    ];
    const slab = createPlanSlabToolNode(activeLevelId, points, {
      thickness: options.slabThickness ?? 0.2,
      material: "concrete",
    });
    insertPlanNode(state, slab);
    return slab.id;
  });
}

export function createPlanCadPolygonSlab(
  data: PlanCadSceneData | null | undefined,
  points: PlanPoint2[],
  options: PlanCadToolOptions = {},
) {
  return mutatePlanCadData(data, (state, activeLevelId) => {
    const polygon = normalizePlanPolygon(points);
    if (polygon.length < 3 || Math.abs(polygonArea(polygon)) < 0.0001)
      return null;
    const slab = createPlanSlabToolNode(activeLevelId, polygon, {
      thickness: options.slabThickness ?? 0.2,
      material: "concrete",
    });
    insertPlanNode(state, slab);
    return slab.id;
  });
}

export function createPlanCadRectangleZone(
  data: PlanCadSceneData | null | undefined,
  start: PlanPoint2,
  end: PlanPoint2,
) {
  return mutatePlanCadData(data, (state, activeLevelId) => {
    if (pointDistanceSq(start, end) < 0.0001) return null;
    const zone = createPlanZoneToolNode(activeLevelId, [
      { x: start.x, z: start.z },
      { x: end.x, z: start.z },
      { x: end.x, z: end.z },
      { x: start.x, z: end.z },
    ]);
    insertPlanNode(state, zone);
    return zone.id;
  });
}

export function createPlanCadPolygonZone(
  data: PlanCadSceneData | null | undefined,
  points: PlanPoint2[],
) {
  return mutatePlanCadData(data, (state, activeLevelId) => {
    const polygon = normalizePlanPolygon(points);
    if (polygon.length < 3 || Math.abs(polygonArea(polygon)) < 0.0001)
      return null;
    const zone = createPlanZoneToolNode(activeLevelId, polygon);
    insertPlanNode(state, zone);
    return zone.id;
  });
}

export function createPlanCadPart(
  data: PlanCadSceneData | null | undefined,
  point: PlanPoint2,
  options: PlanCadToolOptions = {},
) {
  return mutatePlanCadData(data, (state, activeLevelId) => {
    const preset = findPlanCadPartPreset(options.partPresetId);
    if (!preset) return null;
    const item = createPlanItemToolNode(activeLevelId, {
      name: preset.label,
      placement: preset.placement,
      position: { x: point.x, y: 0, z: point.z },
      dimensions: preset.dimensions,
      material: preset.material,
      tags: preset.tags,
      source: { ...preset.source, presetId: preset.id },
    });
    insertPlanNode(state, item);
    return item.id;
  });
}

export function addPlanCadOpening(
  data: PlanCadSceneData | null | undefined,
  point: PlanPoint2,
  kind: "door" | "window",
  explicitWallId?: string,
) {
  return mutatePlanCadData(data, (state) => {
    const walls = Object.values(state.nodes).filter(
      (node): node is PlanWallNode => node.type === "wall",
    );
    const wall = explicitWallId
      ? walls.find((candidate) => candidate.id === explicitWallId)
      : walls
          .map((candidate) => {
            const t = segmentProjectionT(point, candidate);
            return {
              wall: candidate,
              t,
              distanceSq: pointDistanceSq(point, wallPointAt(candidate, t)),
            };
          })
          .sort((a, b) => a.distanceSq - b.distanceSq)[0]?.wall;
    if (!wall) return null;

    const t = segmentProjectionT(point, wall);
    const opening = {
      id: `${kind}_${THREE.MathUtils.generateUUID().slice(0, 8)}`,
      kind,
      t,
      width: kind === "door" ? 0.92 : 1.2,
      sillHeight: kind === "door" ? 0 : 0.9,
      height: kind === "door" ? 2.1 : 1.1,
    };
    updatePlanNode<PlanWallNode>(state, wall.id, {
      openings: [...wall.openings, opening],
    });
    return wall.id;
  });
}
