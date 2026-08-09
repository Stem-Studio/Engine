import * as THREE from "three";

/**
 * BIM Plan core model and generated geometry helpers.
 *
 * Architectural/product inspiration: https://github.com/pascalorg/editor
 * (MIT). This module is a StemStudio-native implementation; no Pascal source
 * is bundled here.
 */

export type PlanNodeType =
    | "site"
    | "building"
    | "level"
    | "wall"
    | "slab"
    | "ceiling"
    | "roof"
    | "zone"
    | "guide"
    | "scan"
    | "item";

export type PlanDisplayMode = "stacked" | "exploded" | "solo" | "ghosted";

export interface PlanPoint2 {
    x: number;
    z: number;
}

export interface PlanSize3 {
    x: number;
    y: number;
    z: number;
}

export interface PlanBaseNode {
    id: string;
    type: PlanNodeType;
    parentId: string | null;
    children: string[];
    visible: boolean;
    name?: string;
    metadata?: Record<string, unknown>;
}

export interface PlanSiteNode extends PlanBaseNode {
    type: "site";
}

export interface PlanBuildingNode extends PlanBaseNode {
    type: "building";
    address?: string;
}

export interface PlanLevelNode extends PlanBaseNode {
    type: "level";
    elevation: number;
    height: number;
    index: number;
}

export interface PlanWallOpening {
    id: string;
    kind: "door" | "window" | "opening";
    t: number;
    width: number;
    sillHeight: number;
    height: number;
}

export interface PlanWallNode extends PlanBaseNode {
    type: "wall";
    start: PlanPoint2;
    end: PlanPoint2;
    thickness: number;
    height: number;
    elevation: number;
    material?: string;
    tags?: string[];
    openings: PlanWallOpening[];
}

export interface PlanSlabNode extends PlanBaseNode {
    type: "slab";
    points: PlanPoint2[];
    thickness: number;
    elevation: number;
    material?: string;
    tags?: string[];
}

export interface PlanCeilingNode extends PlanBaseNode {
    type: "ceiling";
    points: PlanPoint2[];
    thickness: number;
    elevation: number;
    material?: string;
    tags?: string[];
}

export interface PlanRoofNode extends PlanBaseNode {
    type: "roof";
    points: PlanPoint2[];
    thickness: number;
    elevation: number;
    pitch: number;
    material?: string;
    tags?: string[];
}

export interface PlanZoneNode extends PlanBaseNode {
    type: "zone";
    points: PlanPoint2[];
    elevation: number;
    tags?: string[];
}

export interface PlanGuideNode extends PlanBaseNode {
    type: "guide";
    url: string;
    position: PlanPoint2;
    rotation: number;
    scale: PlanSize3;
}

export interface PlanScanNode extends PlanBaseNode {
    type: "scan";
    assetId?: string;
    url?: string;
    position: PlanSize3;
    rotation: PlanSize3;
    scale: PlanSize3;
}

export type PlanItemModelKind =
    | "box"
    | "desk"
    | "sofa"
    | "dining_table"
    | "single_bed"
    | "cabinet"
    | "base_cabinet"
    | "island"
    | "toilet"
    | "sink"
    | "shower"
    | "electrical_panel"
    | "hvac_unit"
    | "floor_drain";

export interface PlanItemSource {
    type: "procedural" | "model";
    presetId?: string;
    modelKind?: PlanItemModelKind;
    assetId?: string;
    url?: string;
    format?: "glb" | "gltf" | "ifc" | "obj";
}

export interface PlanItemNode extends PlanBaseNode {
    type: "item";
    placement: "floor" | "wall" | "ceiling";
    position: PlanSize3;
    dimensions: PlanSize3;
    rotation: number;
    wallId?: string;
    wallT?: number;
    wallHeight?: number;
    material?: string;
    tags?: string[];
    source?: PlanItemSource;
}

export type PlanNode =
    | PlanSiteNode
    | PlanBuildingNode
    | PlanLevelNode
    | PlanWallNode
    | PlanSlabNode
    | PlanCeilingNode
    | PlanRoofNode
    | PlanZoneNode
    | PlanGuideNode
    | PlanScanNode
    | PlanItemNode;

export interface PlanSceneState {
    nodes: Record<string, PlanNode>;
    rootNodeIds: string[];
    dirtyNodeIds: Set<string>;
    revision: number;
}

export interface PlanSceneJson {
    schema: "stem.planCad.v1";
    rootNodeIds: string[];
    nodes: Record<string, PlanNode>;
}

export interface PlanCameraPreset {
    mode: "plan" | "elevation" | "isometric" | "walkthrough";
    projection: "orthographic" | "perspective";
    position: [number, number, number];
    target: [number, number, number];
    up: [number, number, number];
}

export interface PlanInterchangeCapabilities {
    json: "ready";
    ifc: "ready";
    dxf: "ready";
    notes: string[];
}

export interface PlanWallMiterJoint {
    end: "start" | "end";
    connectedWallId: string;
    angleRadians: number;
}

export interface PlanSnapLine {
    axis: "x" | "z";
    value: number;
    sourceNodeId: string;
    distance: number;
}

const NODE_PREFIX: Record<PlanNodeType, string> = {
    site: "site",
    building: "building",
    level: "level",
    wall: "wall",
    slab: "slab",
    ceiling: "ceiling",
    roof: "roof",
    zone: "zone",
    guide: "guide",
    scan: "scan",
    item: "item",
};

function createId(type: PlanNodeType, seed?: string) {
    return `${NODE_PREFIX[type]}_${seed || THREE.MathUtils.generateUUID().slice(0, 8)}`;
}

function baseNode<T extends PlanNodeType>(
    type: T,
    input: Partial<PlanBaseNode> & {id?: string; parentId?: string | null},
): PlanBaseNode & {type: T} {
    return {
        id: input.id ?? createId(type),
        type,
        parentId: input.parentId ?? null,
        children: input.children ? [...input.children] : [],
        visible: input.visible ?? true,
        name: input.name,
        metadata: input.metadata ? {...input.metadata} : undefined,
    };
}

export function createPlanSceneState(nodes: PlanNode[] = []): PlanSceneState {
    const state: PlanSceneState = {nodes: {}, rootNodeIds: [], dirtyNodeIds: new Set(), revision: 0};
    for (const node of nodes) {
        insertPlanNode(state, node);
    }
    state.dirtyNodeIds.clear();
    return state;
}

export function createPlanNode(type: "site", input?: Partial<PlanSiteNode>): PlanSiteNode;
export function createPlanNode(type: "building", input?: Partial<PlanBuildingNode>): PlanBuildingNode;
export function createPlanNode(type: "level", input?: Partial<PlanLevelNode>): PlanLevelNode;
export function createPlanNode(type: "wall", input: Partial<PlanWallNode> & Pick<PlanWallNode, "start" | "end">): PlanWallNode;
export function createPlanNode(type: "slab", input: Partial<PlanSlabNode> & Pick<PlanSlabNode, "points">): PlanSlabNode;
export function createPlanNode(
    type: "ceiling",
    input: Partial<PlanCeilingNode> & Pick<PlanCeilingNode, "points">,
): PlanCeilingNode;
export function createPlanNode(type: "roof", input: Partial<PlanRoofNode> & Pick<PlanRoofNode, "points">): PlanRoofNode;
export function createPlanNode(type: "zone", input: Partial<PlanZoneNode> & Pick<PlanZoneNode, "points">): PlanZoneNode;
export function createPlanNode(type: "guide", input: Partial<PlanGuideNode> & Pick<PlanGuideNode, "url">): PlanGuideNode;
export function createPlanNode(type: "scan", input?: Partial<PlanScanNode>): PlanScanNode;
export function createPlanNode(type: "item", input?: Partial<PlanItemNode>): PlanItemNode;
export function createPlanNode(type: PlanNodeType, input: any = {}): PlanNode {
    switch (type) {
        case "site":
            return {...baseNode("site", input)};
        case "building":
            return {...baseNode("building", input), address: input.address};
        case "level":
            return {
                ...baseNode("level", input),
                elevation: input.elevation ?? 0,
                height: input.height ?? 3,
                index: input.index ?? 0,
            };
        case "wall":
            return {
                ...baseNode("wall", input),
                start: input.start,
                end: input.end,
                thickness: input.thickness ?? 0.2,
                height: input.height ?? 3,
                elevation: input.elevation ?? 0,
                material: input.material,
                tags: input.tags ? [...input.tags] : [],
                openings: input.openings ? [...input.openings] : [],
            };
        case "slab":
            return {
                ...baseNode("slab", input),
                points: [...input.points],
                thickness: input.thickness ?? 0.2,
                elevation: input.elevation ?? 0,
                material: input.material,
                tags: input.tags ? [...input.tags] : [],
            };
        case "ceiling":
            return {
                ...baseNode("ceiling", input),
                points: [...input.points],
                thickness: input.thickness ?? 0.12,
                elevation: input.elevation ?? 3,
                material: input.material,
                tags: input.tags ? [...input.tags] : [],
            };
        case "roof":
            return {
                ...baseNode("roof", input),
                points: [...input.points],
                thickness: input.thickness ?? 0.18,
                elevation: input.elevation ?? 3,
                pitch: input.pitch ?? 0,
                material: input.material,
                tags: input.tags ? [...input.tags] : [],
            };
        case "zone":
            return {
                ...baseNode("zone", input),
                points: [...input.points],
                elevation: input.elevation ?? 0,
                tags: input.tags ? [...input.tags] : [],
            };
        case "guide":
            return {
                ...baseNode("guide", input),
                url: input.url,
                position: input.position ?? {x: 0, z: 0},
                rotation: input.rotation ?? 0,
                scale: input.scale ?? {x: 1, y: 1, z: 1},
            };
        case "scan":
            return {
                ...baseNode("scan", input),
                assetId: input.assetId,
                url: input.url,
                position: input.position ?? {x: 0, y: 0, z: 0},
                rotation: input.rotation ?? {x: 0, y: 0, z: 0},
                scale: input.scale ?? {x: 1, y: 1, z: 1},
            };
        case "item":
            return {
                ...baseNode("item", input),
                placement: input.placement ?? "floor",
                position: input.position ?? {x: 0, y: 0, z: 0},
                dimensions: input.dimensions ?? {x: 1, y: 1, z: 1},
                rotation: input.rotation ?? 0,
                wallId: input.wallId,
                wallT: input.wallT,
                wallHeight: input.wallHeight,
                material: input.material,
                tags: input.tags ? [...input.tags] : [],
                source: input.source ? {...input.source} : undefined,
            };
    }
}

export function insertPlanNode(state: PlanSceneState, node: PlanNode) {
    state.nodes[node.id] = node;
    if (node.parentId) {
        const parent = state.nodes[node.parentId];
        if (!parent) {
            state.rootNodeIds = state.rootNodeIds.includes(node.id) ? state.rootNodeIds : [...state.rootNodeIds, node.id];
        } else if (!parent.children.includes(node.id)) {
            parent.children = [...parent.children, node.id];
            state.dirtyNodeIds.add(parent.id);
        }
    } else if (!state.rootNodeIds.includes(node.id)) {
        state.rootNodeIds = [...state.rootNodeIds, node.id];
    }
    state.dirtyNodeIds.add(node.id);
    state.revision++;
    return node;
}

export function updatePlanNode<T extends PlanNode>(
    state: PlanSceneState,
    id: string,
    updates: Partial<Omit<T, "id" | "type">>,
) {
    const current = state.nodes[id] as T | undefined;
    if (!current) return null;

    const next = {...current, ...updates, id: current.id, type: current.type} as T;
    state.nodes[id] = next;
    state.dirtyNodeIds.add(id);
    state.revision++;
    return next;
}

export function deletePlanNode(state: PlanSceneState, id: string) {
    const node = state.nodes[id];
    if (!node) return false;

    for (const childId of [...node.children]) {
        deletePlanNode(state, childId);
    }

    if (node.parentId) {
        const parent = state.nodes[node.parentId];
        if (parent) {
            parent.children = parent.children.filter(childId => childId !== id);
            state.dirtyNodeIds.add(parent.id);
        }
    } else {
        state.rootNodeIds = state.rootNodeIds.filter(rootId => rootId !== id);
    }

    delete state.nodes[id];
    state.dirtyNodeIds.delete(id);
    state.revision++;
    return true;
}

export class PlanSceneRegistry {
    readonly nodes = new Map<string, THREE.Object3D>();
    readonly byType: Record<PlanNodeType, Set<string>> = {
        site: new Set(),
        building: new Set(),
        level: new Set(),
        wall: new Set(),
        slab: new Set(),
        ceiling: new Set(),
        roof: new Set(),
        zone: new Set(),
        guide: new Set(),
        scan: new Set(),
        item: new Set(),
    };

    register(node: PlanNode, object: THREE.Object3D) {
        this.unregister(node.id);
        this.nodes.set(node.id, object);
        this.byType[node.type].add(node.id);
        object.userData.planNodeId = node.id;
        object.userData.planNodeType = node.type;
    }

    unregister(id: string) {
        const object = this.nodes.get(id);
        if (!object) return;
        const type = object.userData.planNodeType as PlanNodeType | undefined;
        if (type) this.byType[type].delete(id);
        this.nodes.delete(id);
    }

    get<T extends THREE.Object3D = THREE.Object3D>(id: string): T | undefined {
        return this.nodes.get(id) as T | undefined;
    }

    getByType(type: PlanNodeType) {
        return [...this.byType[type]].map(id => this.nodes.get(id)).filter(Boolean) as THREE.Object3D[];
    }
}

function disposeObjectChildren(object: THREE.Object3D) {
    for (const child of [...object.children]) {
        child.traverse(node => {
            const mesh = node as THREE.Mesh;
            if (!mesh.isMesh) return;
            mesh.geometry?.dispose();
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const material of materials) disposePlanMaterial(material);
        });
        object.remove(child);
    }
}

type PlanTextureKind = "wall" | "slab" | "wood" | "fabric" | "metal" | "ceramic";

const PLAN_TEXTURE_URLS: Record<PlanTextureKind, string> = {
    wall: "/assets/textures/bim/prepared-drywall.webp",
    slab: "/assets/textures/bim/concrete-plate.webp",
    wood: "/assets/textures/bim/wood-fine.webp",
    fabric: "/assets/textures/bim/blue-cotton.webp",
    metal: "/assets/textures/bim/stainless-steel.webp",
    ceramic: "/assets/textures/bim/white-stucco.webp",
};

function canLoadPlanTextures() {
    if (typeof window === "undefined" || typeof document === "undefined" || typeof Image === "undefined") return false;
    return !window.navigator?.userAgent?.toLowerCase().includes("jsdom");
}

function createPlanTexture(kind: PlanTextureKind, repeat = {x: 1, y: 1}) {
    if (!canLoadPlanTextures()) return null;
    const texture = new THREE.TextureLoader().load(PLAN_TEXTURE_URLS[kind]);
    texture.name = `BIM ${kind} texture`;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(Math.max(0.25, repeat.x), Math.max(0.25, repeat.y));
    texture.anisotropy = 4;
    return texture;
}

function disposePlanMaterial(material: THREE.Material) {
    const texturedMaterial = material as THREE.MeshStandardMaterial;
    texturedMaterial.map?.dispose();
    material.dispose();
}

function makePlanMaterial(
    color: number,
    transparent = false,
    opacity = 1,
    textureKind?: PlanTextureKind,
    textureRepeat = {x: 1, y: 1},
) {
    const map = textureKind ? createPlanTexture(textureKind, textureRepeat) : null;
    const material = new THREE.MeshStandardMaterial({
        color: map ? 0xffffff : color,
        roughness: textureKind === "metal" ? 0.42 : 0.88,
        metalness: textureKind === "metal" ? 0.35 : 0,
        transparent,
        opacity,
        map: map ?? undefined,
    });
    return material;
}

function wallLength(wall: PlanWallNode) {
    return Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z);
}

function wallPointAt(wall: PlanWallNode, t: number) {
    return {
        x: wall.start.x + (wall.end.x - wall.start.x) * t,
        z: wall.start.z + (wall.end.z - wall.start.z) * t,
    };
}

function wallAngle(wall: PlanWallNode) {
    return Math.atan2(wall.end.z - wall.start.z, wall.end.x - wall.start.x);
}

function samePoint(a: PlanPoint2, b: PlanPoint2, tolerance = 0.001) {
    return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.z - b.z) <= tolerance;
}

export function getPlanWallMiterJoints(state: PlanSceneState, wallId: string): PlanWallMiterJoint[] {
    const wall = state.nodes[wallId];
    if (!wall || wall.type !== "wall") return [];

    const wallTheta = wallAngle(wall);
    const joints: PlanWallMiterJoint[] = [];
    for (const candidate of Object.values(state.nodes)) {
        if (candidate.type !== "wall" || candidate.id === wall.id) continue;
        const candidateTheta = wallAngle(candidate);
        const angleRadians = Math.atan2(Math.sin(candidateTheta - wallTheta), Math.cos(candidateTheta - wallTheta));

        if (samePoint(wall.start, candidate.start) || samePoint(wall.start, candidate.end)) {
            joints.push({end: "start", connectedWallId: candidate.id, angleRadians});
        }
        if (samePoint(wall.end, candidate.start) || samePoint(wall.end, candidate.end)) {
            joints.push({end: "end", connectedWallId: candidate.id, angleRadians});
        }
    }
    return joints;
}

function addWallSegment(group: THREE.Group, wall: PlanWallNode, startT: number, endT: number, y: number, height: number) {
    const length = wallLength(wall);
    const segmentLength = Math.max(0, (endT - startT) * length);
    if (segmentLength <= 0.001 || height <= 0.001) return;

    const start = wallPointAt(wall, startT);
    const end = wallPointAt(wall, endT);
    const center = {x: (start.x + end.x) / 2, z: (start.z + end.z) / 2};
    const angle = wallAngle(wall);

    const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(segmentLength, height, wall.thickness),
        makePlanMaterial(0xd8d1c3, false, 1, "wall", {
            x: Math.max(1, segmentLength / 1.5),
            y: Math.max(1, height / 1.5),
        }),
    );
    mesh.position.set(center.x, wall.elevation + y + height / 2, center.z);
    mesh.rotation.y = -angle;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
}

export function updatePlanWallObject(object: THREE.Object3D, wall: PlanWallNode) {
    const group = object as THREE.Group;
    disposeObjectChildren(group);

    const openings = [...wall.openings]
        .map(opening => {
            const length = wallLength(wall);
            const halfT = opening.width / Math.max(length, 0.001) / 2;
            return {
                ...opening,
                minT: Math.max(0, opening.t - halfT),
                maxT: Math.min(1, opening.t + halfT),
            };
        })
        .sort((a, b) => a.minT - b.minT);

    let cursor = 0;
    for (const opening of openings) {
        addWallSegment(group, wall, cursor, opening.minT, 0, wall.height);
        addWallSegment(group, wall, opening.minT, opening.maxT, 0, opening.sillHeight);
        const top = opening.sillHeight + opening.height;
        addWallSegment(group, wall, opening.minT, opening.maxT, top, wall.height - top);
        cursor = opening.maxT;
    }
    addWallSegment(group, wall, cursor, 1, 0, wall.height);

    group.userData.planCad = {
        kind: "wall",
        openingCount: openings.length,
        length: wallLength(wall),
    };
}

function createFlatShapeGeometry(points: PlanPoint2[], thickness = 0.08) {
    const shape = new THREE.Shape(points.map(point => new THREE.Vector2(point.x, point.z)));
    return new THREE.ExtrudeGeometry(shape, {depth: thickness, bevelEnabled: false});
}

function updatePolygonObject(
    object: THREE.Object3D,
    points: PlanPoint2[],
    elevation: number,
    thickness: number,
    color: number,
    textureKind?: PlanTextureKind,
) {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) disposePlanMaterial(material);
    mesh.geometry = createFlatShapeGeometry(points, thickness);
    mesh.material = makePlanMaterial(color, false, 1, textureKind, {x: 2, y: 2});
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = elevation;
    mesh.receiveShadow = true;
}

export function updatePlanItemObject(object: THREE.Object3D, item: PlanItemNode) {
    disposeObjectChildren(object);
    object.position.set(item.position.x, item.position.y, item.position.z);
    object.rotation.y = item.rotation;
    object.userData.planCad = {
        kind: "item",
        source: item.source ?? null,
        placement: item.placement,
        dimensions: item.dimensions,
    };

    const modelKind = item.source?.modelKind ?? "box";
    const materialName = item.material ?? "default";
    const addBox = (
        name: string,
        size: PlanSize3,
        position: PlanSize3,
        color = 0x8ea5b5,
        opacity = 1,
        textureKind?: PlanTextureKind,
    ) => {
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(size.x, size.y, size.z),
            makePlanMaterial(color, opacity < 1, opacity, textureKind),
        );
        mesh.name = name;
        mesh.position.set(position.x, position.y, position.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        object.add(mesh);
        return mesh;
    };
    const addCylinder = (
        name: string,
        radius: number,
        height: number,
        position: PlanSize3,
        color = 0x8ea5b5,
        radialSegments = 24,
    ) => {
        const mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(radius, radius, height, radialSegments),
            makePlanMaterial(color),
        );
        mesh.name = name;
        mesh.position.set(position.x, position.y, position.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        object.add(mesh);
        return mesh;
    };
    const dims = item.dimensions;
    const halfX = dims.x / 2;
    const halfY = dims.y / 2;
    const halfZ = dims.z / 2;
    const wood = materialName === "wood" ? 0x9b6a3f : 0x8ea5b5;
    const fabric = materialName === "fabric" ? 0x6b7f9e : 0x8ea5b5;
    const ceramic = materialName === "ceramic" ? 0xf3f4f6 : 0x8ea5b5;
    const metal = materialName === "metal" ? 0x9ca3af : 0x8ea5b5;
    const stone = materialName === "stone" ? 0xb8b0a4 : 0x8ea5b5;
    const woodTexture: PlanTextureKind | undefined = materialName === "wood" ? "wood" : undefined;
    const fabricTexture: PlanTextureKind | undefined = materialName === "fabric" ? "fabric" : undefined;
    const ceramicTexture: PlanTextureKind | undefined = materialName === "ceramic" ? "ceramic" : undefined;
    const metalTexture: PlanTextureKind | undefined = materialName === "metal" ? "metal" : undefined;
    const stoneTexture: PlanTextureKind | undefined = materialName === "stone" ? "slab" : undefined;

    switch (modelKind) {
        case "desk":
        case "dining_table": {
            addBox("top", {x: dims.x, y: dims.y * 0.08, z: dims.z}, {x: 0, y: dims.y * 0.92, z: 0}, wood, 1, woodTexture);
            const legSize = Math.min(dims.x, dims.z) * 0.08;
            for (const x of [-halfX + legSize, halfX - legSize]) {
                for (const z of [-halfZ + legSize, halfZ - legSize]) {
                    addBox("leg", {x: legSize, y: dims.y * 0.86, z: legSize}, {x, y: dims.y * 0.43, z}, wood, 1, woodTexture);
                }
            }
            break;
        }
        case "sofa": {
            addBox("seat", {x: dims.x, y: dims.y * 0.38, z: dims.z * 0.78}, {x: 0, y: dims.y * 0.2, z: dims.z * 0.08}, fabric, 1, fabricTexture);
            addBox("back", {x: dims.x, y: dims.y * 0.72, z: dims.z * 0.16}, {x: 0, y: dims.y * 0.48, z: -halfZ + dims.z * 0.08}, fabric, 1, fabricTexture);
            addBox("left arm", {x: dims.x * 0.08, y: dims.y * 0.55, z: dims.z}, {x: -halfX + dims.x * 0.04, y: dims.y * 0.34, z: 0}, fabric, 1, fabricTexture);
            addBox("right arm", {x: dims.x * 0.08, y: dims.y * 0.55, z: dims.z}, {x: halfX - dims.x * 0.04, y: dims.y * 0.34, z: 0}, fabric, 1, fabricTexture);
            break;
        }
        case "single_bed": {
            addBox("frame", {x: dims.x, y: dims.y * 0.22, z: dims.z}, {x: 0, y: dims.y * 0.11, z: 0}, wood, 1, woodTexture);
            addBox("mattress", {x: dims.x * 0.94, y: dims.y * 0.32, z: dims.z * 0.9}, {x: 0, y: dims.y * 0.36, z: 0}, 0xded6cb, 1, "fabric");
            addBox("pillow", {x: dims.x * 0.28, y: dims.y * 0.14, z: dims.z * 0.72}, {x: -halfX + dims.x * 0.18, y: dims.y * 0.62, z: 0}, 0xf8fafc);
            break;
        }
        case "cabinet":
        case "base_cabinet":
        case "island": {
            const caseTexture = modelKind === "island" ? stoneTexture : woodTexture;
            addBox("case", dims, {x: 0, y: halfY, z: 0}, modelKind === "island" ? stone : wood, 1, caseTexture);
            addBox("front left", {x: dims.x * 0.44, y: dims.y * 0.82, z: 0.02}, {x: -dims.x * 0.23, y: halfY, z: halfZ + 0.012}, 0x6f4e37, 1, woodTexture);
            addBox("front right", {x: dims.x * 0.44, y: dims.y * 0.82, z: 0.02}, {x: dims.x * 0.23, y: halfY, z: halfZ + 0.012}, 0x6f4e37, 1, woodTexture);
            break;
        }
        case "toilet": {
            addBox("tank", {x: dims.x * 0.78, y: dims.y * 0.38, z: dims.z * 0.22}, {x: 0, y: dims.y * 0.72, z: -halfZ + dims.z * 0.11}, ceramic, 1, ceramicTexture);
            const bowl = addCylinder("bowl", Math.min(dims.x, dims.z) * 0.28, dims.y * 0.34, {x: 0, y: dims.y * 0.34, z: dims.z * 0.08}, ceramic);
            bowl.scale.z = 1.25;
            break;
        }
        case "sink": {
            addBox("vanity", {x: dims.x, y: dims.y * 0.72, z: dims.z}, {x: 0, y: dims.y * 0.36, z: 0}, wood, 1, woodTexture);
            const basin = addCylinder("basin", Math.min(dims.x, dims.z) * 0.28, dims.y * 0.12, {x: 0, y: dims.y * 0.84, z: 0}, ceramic);
            basin.scale.z = 0.72;
            break;
        }
        case "shower": {
            addBox("base", {x: dims.x, y: dims.y * 0.05, z: dims.z}, {x: 0, y: dims.y * 0.025, z: 0}, ceramic, 1, ceramicTexture);
            addBox("back glass", {x: dims.x, y: dims.y * 0.86, z: 0.025}, {x: 0, y: dims.y * 0.48, z: -halfZ}, 0x96c9e8, 0.42);
            addBox("side glass", {x: 0.025, y: dims.y * 0.86, z: dims.z}, {x: -halfX, y: dims.y * 0.48, z: 0}, 0x96c9e8, 0.42);
            break;
        }
        case "electrical_panel": {
            addBox("panel", dims, {x: 0, y: halfY, z: 0}, metal, 1, metalTexture);
            addBox("door seam", {x: dims.x * 0.02, y: dims.y * 0.86, z: dims.z * 1.08}, {x: 0, y: halfY, z: dims.z * 0.04}, 0x4b5563, 1, metalTexture);
            break;
        }
        case "hvac_unit": {
            addBox("unit", dims, {x: 0, y: halfY, z: 0}, metal, 1, metalTexture);
            for (const x of [-0.22, 0, 0.22]) {
                addBox("vent", {x: dims.x * 0.08, y: dims.y * 1.04, z: dims.z * 0.04}, {x: x * dims.x, y: halfY, z: halfZ + dims.z * 0.03}, 0x4b5563, 1, metalTexture);
            }
            break;
        }
        case "floor_drain": {
            const ring = addCylinder("drain", Math.min(dims.x, dims.z) * 0.5, dims.y, {x: 0, y: halfY, z: 0}, metal, 32);
            ring.scale.y = 1;
            addBox("slot", {x: dims.x * 0.75, y: dims.y * 1.05, z: dims.z * 0.08}, {x: 0, y: halfY + dims.y * 0.02, z: 0}, 0x4b5563);
            break;
        }
        case "box":
        default:
            addBox("proxy", dims, {x: 0, y: halfY, z: 0});
            break;
    }
}

export function processDirtyPlanNodes(state: PlanSceneState, registry: PlanSceneRegistry) {
    const processed: Array<{id: string; type: PlanNodeType; updated: boolean}> = [];
    for (const id of [...state.dirtyNodeIds]) {
        const node = state.nodes[id];
        const object = registry.get(id);
        if (!node || !object) {
            state.dirtyNodeIds.delete(id);
            processed.push({id, type: node?.type ?? "item", updated: false});
            continue;
        }

        if (node.type === "wall") {
            updatePlanWallObject(object, node);
            object.userData.planCad.miterJoints = getPlanWallMiterJoints(state, node.id);
        }
        if (node.type === "slab") updatePolygonObject(object, node.points, node.elevation, node.thickness, 0xb9b09d, "slab");
        if (node.type === "ceiling") updatePolygonObject(object, node.points, node.elevation, node.thickness, 0xe5e7eb, "wall");
        if (node.type === "roof") updatePolygonObject(object, node.points, node.elevation, node.thickness, 0x8f4d3d);
        if (node.type === "zone") updatePolygonObject(object, node.points, node.elevation + 0.01, 0.02, 0x69a297);
        if (node.type === "item") updatePlanItemObject(object, node);
        if (node.type === "level") object.position.y = node.elevation;

        object.visible = node.visible;
        state.dirtyNodeIds.delete(id);
        processed.push({id, type: node.type, updated: true});
    }
    return processed;
}

export function createPlanWallToolNode(parentId: string, start: PlanPoint2, end: PlanPoint2, input: Partial<PlanWallNode> = {}) {
    return createPlanNode("wall", {...input, parentId, start, end});
}

export function createPlanSlabToolNode(parentId: string, points: PlanPoint2[], input: Partial<PlanSlabNode> = {}) {
    return createPlanNode("slab", {...input, parentId, points});
}

export function createPlanZoneToolNode(parentId: string, points: PlanPoint2[], input: Partial<PlanZoneNode> = {}) {
    return createPlanNode("zone", {...input, parentId, points});
}

export function createPlanItemToolNode(parentId: string, input: Partial<PlanItemNode> = {}) {
    return createPlanNode("item", {...input, parentId});
}

export function createPlanGuideToolNode(parentId: string, url: string, input: Partial<PlanGuideNode> = {}) {
    return createPlanNode("guide", {...input, parentId, url});
}

export function createPlanScanToolNode(parentId: string, input: Partial<PlanScanNode> = {}) {
    return createPlanNode("scan", {...input, parentId});
}

function pointInPolygon(point: PlanPoint2, polygon: PlanPoint2[]) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i]!;
        const b = polygon[j]!;
        const intersects =
            a.z > point.z !== b.z > point.z &&
            point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z || 0.000001) + a.x;
        if (intersects) inside = !inside;
    }
    return inside;
}

function aabbOverlap(aCenter: PlanSize3, aSize: PlanSize3, bCenter: PlanSize3, bSize: PlanSize3) {
    return (
        Math.abs(aCenter.x - bCenter.x) * 2 < aSize.x + bSize.x &&
        Math.abs(aCenter.z - bCenter.z) * 2 < aSize.z + bSize.z
    );
}

export class PlanSpatialGrid {
    constructor(private readonly state: PlanSceneState) {}

    getSlabElevationAt(levelId: string, x: number, z: number) {
        const slabs = Object.values(this.state.nodes).filter(
            (node): node is PlanSlabNode => node.type === "slab" && node.parentId === levelId,
        );
        const slab = slabs.find(candidate => pointInPolygon({x, z}, candidate.points));
        return slab ? slab.elevation + slab.thickness : null;
    }

    canPlaceOnFloor(levelId: string, position: PlanSize3, dimensions: PlanSize3) {
        const elevation = this.getSlabElevationAt(levelId, position.x, position.z);
        if (elevation === null) return false;

        const items = Object.values(this.state.nodes).filter(
            (node): node is PlanItemNode => node.type === "item" && node.parentId === levelId && node.placement === "floor",
        );
        return !items.some(item => aabbOverlap(position, dimensions, item.position, item.dimensions));
    }

    canPlaceOnWall(wallId: string, t: number, height: number, dimensions: PlanSize3) {
        const wall = this.state.nodes[wallId];
        if (!wall || wall.type !== "wall" || t < 0 || t > 1) return false;
        if (height < 0 || height + dimensions.y > wall.height) return false;

        const tSpan = dimensions.x / Math.max(wallLength(wall), 0.001);
        const minT = t - tSpan / 2;
        const maxT = t + tSpan / 2;
        return !Object.values(this.state.nodes).some(node => {
            if (node.type !== "item" || node.wallId !== wallId || node.wallT === undefined) return false;
            const otherSpan = node.dimensions.x / Math.max(wallLength(wall), 0.001);
            return Math.max(minT, node.wallT - otherSpan / 2) < Math.min(maxT, node.wallT + otherSpan / 2);
        });
    }

    getSnapLines(levelId: string, point: PlanPoint2, tolerance = 0.2): PlanSnapLine[] {
        const lines: PlanSnapLine[] = [];
        for (const node of Object.values(this.state.nodes)) {
            if (node.parentId !== levelId) continue;

            const points: PlanPoint2[] = [];
            if (node.type === "wall") points.push(node.start, node.end);
            if (node.type === "slab" || node.type === "ceiling" || node.type === "roof" || node.type === "zone") {
                points.push(...node.points);
            }
            if (node.type === "item") points.push({x: node.position.x, z: node.position.z});

            for (const source of points) {
                const dx = Math.abs(point.x - source.x);
                const dz = Math.abs(point.z - source.z);
                if (dx <= tolerance) lines.push({axis: "x", value: source.x, sourceNodeId: node.id, distance: dx});
                if (dz <= tolerance) lines.push({axis: "z", value: source.z, sourceNodeId: node.id, distance: dz});
            }
        }
        return lines.sort((a, b) => a.distance - b.distance);
    }
}

export function getPlanSelectionPath(state: PlanSceneState, id: string) {
    const path: PlanNode[] = [];
    let current: PlanNode | undefined = state.nodes[id];
    while (current) {
        path.unshift(current);
        current = current.parentId ? state.nodes[current.parentId] : undefined;
    }
    return path;
}

export function getPlanSelectionAtDepth(state: PlanSceneState, id: string, depth: PlanNodeType) {
    return getPlanSelectionPath(state, id).find(node => node.type === depth) ?? null;
}

export function applyPlanLevelDisplayMode(
    state: PlanSceneState,
    registry: PlanSceneRegistry,
    mode: PlanDisplayMode,
    activeLevelId?: string,
) {
    const levels = Object.values(state.nodes)
        .filter((node): node is PlanLevelNode => node.type === "level")
        .sort((a, b) => a.index - b.index);

    for (const level of levels) {
        const object = registry.get(level.id);
        if (!object) continue;

        object.visible = mode !== "solo" || level.id === activeLevelId;
        if (mode === "stacked" || mode === "solo") object.position.y = level.elevation;
        if (mode === "exploded") object.position.y = level.index * (level.height + 1);
        if (mode === "ghosted") {
            object.position.y = level.elevation;
            object.visible = true;
            object.userData.planGhosted = level.id !== activeLevelId;
        }
    }
}

export function getPlanCameraPreset(mode: PlanCameraPreset["mode"], target: [number, number, number] = [0, 0, 0]) {
    const [x, y, z] = target;
    const presets: Record<PlanCameraPreset["mode"], PlanCameraPreset> = {
        plan: {mode, projection: "orthographic", position: [x, y + 40, z + 0.001], target, up: [0, 0, -1]},
        elevation: {mode, projection: "orthographic", position: [x, y + 2, z + 40], target, up: [0, 1, 0]},
        isometric: {mode, projection: "orthographic", position: [x + 24, y + 20, z + 24], target, up: [0, 1, 0]},
        walkthrough: {mode, projection: "perspective", position: [x, y + 1.6, z + 6], target, up: [0, 1, 0]},
    };
    return presets[mode];
}

export function exportPlanSceneJson(state: PlanSceneState) {
    return JSON.stringify(serializePlanSceneState(state), null, 2);
}

export function serializePlanSceneState(state: PlanSceneState): PlanSceneJson {
    return {
        schema: "stem.planCad.v1",
        rootNodeIds: [...state.rootNodeIds],
        nodes: Object.fromEntries(
            Object.entries(state.nodes).map(([id, node]) => [id, {...node, children: [...node.children]}]),
        ) as Record<string, PlanNode>,
    };
}

export function importPlanSceneJson(json: string) {
    return deserializePlanSceneState(JSON.parse(json));
}

export function deserializePlanSceneState(raw: unknown) {
    const parsed = raw as Partial<PlanSceneJson> | undefined;
    if (!parsed || parsed.schema !== "stem.planCad.v1") {
        throw new Error("Unsupported Plan/CAD schema");
    }
    if (!parsed.nodes || !parsed.rootNodeIds) {
        throw new Error("Invalid Plan/CAD scene data");
    }
    const nodes = parsed.nodes;
    const rootNodeIds = parsed.rootNodeIds;
    const state: PlanSceneState = {
        nodes: Object.fromEntries(
            Object.entries(nodes).map(([id, node]) => [id, {...node, children: [...node.children]}]),
        ) as Record<string, PlanNode>,
        rootNodeIds: [...rootNodeIds],
        dirtyNodeIds: new Set(Object.keys(nodes)),
        revision: 0,
    };
    return state;
}

export function getPlanInterchangeCapabilities(): PlanInterchangeCapabilities {
    return {
        json: "ready",
        ifc: "ready",
        dxf: "ready",
        notes: [
            "JSON preserves StemStudio architectural nodes.",
            "DXF (walls & polygons) exports semantic layers and imports StemStudio payloads plus basic wall/slab/zone geometry.",
            "IFC (basic) exports semantic entity types and round-trips StemStudio payloads for lossless Plan/CAD data.",
        ],
    };
}
