import * as THREE from "three";
import {traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";

export type QuickBuildStampKind =
    | "ground"
    | "sand"
    | "stone"
    | "path"
    | "water"
    | "bridge"
    | "farm"
    | "fence"
    | "tree"
    | "bush"
    | "rock"
    | "house"
    | "lamp";

export type QuickBuildVariantId =
    | "path-dirt"
    | "path-street"
    | "path-cobble"
    | "bush-round"
    | "bush-hedge"
    | "bush-flowering"
    | "house-cottage"
    | "house-cabin"
    | "house-townhouse";

export const QUICK_BUILD_CELL_SIZE = 4;
export const QUICK_BUILD_TOP_FACE_MATERIAL_INDEX = 2;

export interface QuickBuildMetadata {
    kind: QuickBuildStampKind;
    level: number;
    variantId?: QuickBuildVariantId;
    connections?: QuickBuildConnections;
}

export interface QuickBuildObjectOptions {
    variantId?: QuickBuildVariantId | string | null;
}

export const QUICK_BUILD_MAX_LEVEL = 8;

export type QuickBuildPlacementMode = "tile" | "route" | "segment" | "prop" | "stackable";

export interface QuickBuildPlacementConfig {
    mode: QuickBuildPlacementMode;
    snap: number;
    footprint: {x: number; z: number};
    allowStacking: boolean;
}

export type QuickBuildDirection = "north" | "east" | "south" | "west";

export type QuickBuildConnections = Record<QuickBuildDirection, boolean>;

export const QUICK_BUILD_DIRECTIONS: QuickBuildDirection[] = ["north", "east", "south", "west"];

const QUICK_BUILD_TERRAIN_KINDS = new Set<QuickBuildStampKind>([
    "ground",
    "sand",
    "stone",
    "path",
    "water",
    "bridge",
    "farm",
]);
const QUICK_BUILD_STACKABLE_KINDS = new Set<QuickBuildStampKind>(["tree", "bush", "rock", "lamp"]);

const QUICK_BUILD_PLACEMENT_CONFIGS: Record<QuickBuildStampKind, QuickBuildPlacementConfig> = {
    ground: {mode: "tile", snap: QUICK_BUILD_CELL_SIZE, footprint: {x: QUICK_BUILD_CELL_SIZE, z: QUICK_BUILD_CELL_SIZE}, allowStacking: false},
    sand: {mode: "tile", snap: QUICK_BUILD_CELL_SIZE, footprint: {x: QUICK_BUILD_CELL_SIZE, z: QUICK_BUILD_CELL_SIZE}, allowStacking: false},
    stone: {mode: "tile", snap: QUICK_BUILD_CELL_SIZE, footprint: {x: QUICK_BUILD_CELL_SIZE, z: QUICK_BUILD_CELL_SIZE}, allowStacking: false},
    water: {mode: "tile", snap: QUICK_BUILD_CELL_SIZE, footprint: {x: QUICK_BUILD_CELL_SIZE, z: QUICK_BUILD_CELL_SIZE}, allowStacking: false},
    farm: {mode: "tile", snap: QUICK_BUILD_CELL_SIZE, footprint: {x: QUICK_BUILD_CELL_SIZE, z: QUICK_BUILD_CELL_SIZE}, allowStacking: false},
    path: {mode: "route", snap: QUICK_BUILD_CELL_SIZE, footprint: {x: QUICK_BUILD_CELL_SIZE, z: QUICK_BUILD_CELL_SIZE}, allowStacking: false},
    bridge: {mode: "route", snap: QUICK_BUILD_CELL_SIZE, footprint: {x: QUICK_BUILD_CELL_SIZE, z: QUICK_BUILD_CELL_SIZE}, allowStacking: false},
    fence: {mode: "segment", snap: 1, footprint: {x: 1, z: 0.28}, allowStacking: false},
    tree: {mode: "stackable", snap: 0.5, footprint: {x: 1.25, z: 1.25}, allowStacking: true},
    bush: {mode: "stackable", snap: 0.5, footprint: {x: 0.95, z: 0.95}, allowStacking: true},
    rock: {mode: "stackable", snap: 0.5, footprint: {x: 1.1, z: 1.1}, allowStacking: true},
    lamp: {mode: "stackable", snap: 0.5, footprint: {x: 0.65, z: 0.65}, allowStacking: true},
    house: {mode: "prop", snap: 0.5, footprint: {x: 1.9, z: 1.7}, allowStacking: false},
};

export const EMPTY_QUICK_BUILD_CONNECTIONS: QuickBuildConnections = {
    north: false,
    east: false,
    south: false,
    west: false,
};

export function isQuickBuildTerrainKind(kind: QuickBuildStampKind) {
    return QUICK_BUILD_TERRAIN_KINDS.has(kind);
}

export function isQuickBuildStackableKind(kind: QuickBuildStampKind) {
    return QUICK_BUILD_STACKABLE_KINDS.has(kind);
}

export function isQuickBuildCellExclusiveKind(kind: QuickBuildStampKind) {
    return !getQuickBuildPlacementConfig(kind).allowStacking;
}

export function getQuickBuildPlacementConfig(kind: QuickBuildStampKind): QuickBuildPlacementConfig {
    return QUICK_BUILD_PLACEMENT_CONFIGS[kind];
}

export function getQuickBuildPlacementSnap(kind: QuickBuildStampKind, configuredCellSize = QUICK_BUILD_CELL_SIZE) {
    const config = getQuickBuildPlacementConfig(kind);
    if (config.mode === "tile" || config.mode === "route") {
        return Number.isFinite(configuredCellSize) && configuredCellSize > 0 ? configuredCellSize : QUICK_BUILD_CELL_SIZE;
    }
    return config.snap;
}

const QUICK_BUILD_LABELS: Record<QuickBuildStampKind, string> = {
    ground: "Ground",
    sand: "Sand",
    stone: "Stone",
    path: "Path",
    water: "Water",
    bridge: "Bridge",
    farm: "Farm",
    fence: "Fence",
    tree: "Tree",
    bush: "Shrub",
    rock: "Rock",
    house: "House",
    lamp: "Lamp",
};

export interface QuickBuildVariantDefinition {
    id: QuickBuildVariantId;
    kind: QuickBuildStampKind;
    label: string;
}

const QUICK_BUILD_VARIANTS: Partial<Record<QuickBuildStampKind, QuickBuildVariantDefinition[]>> = {
    path: [
        {id: "path-dirt", kind: "path", label: "Path"},
        {id: "path-street", kind: "path", label: "Street"},
        {id: "path-cobble", kind: "path", label: "Cobble"},
    ],
    bush: [
        {id: "bush-round", kind: "bush", label: "Shrub"},
        {id: "bush-hedge", kind: "bush", label: "Hedge"},
        {id: "bush-flowering", kind: "bush", label: "Flowering"},
    ],
    house: [
        {id: "house-cottage", kind: "house", label: "House"},
        {id: "house-cabin", kind: "house", label: "Cabin"},
        {id: "house-townhouse", kind: "house", label: "Townhouse"},
    ],
};

export function getQuickBuildVariants(kind: QuickBuildStampKind): QuickBuildVariantDefinition[] {
    return QUICK_BUILD_VARIANTS[kind] ?? [];
}

export function getDefaultQuickBuildVariantId(kind: QuickBuildStampKind): QuickBuildVariantId | undefined {
    return getQuickBuildVariants(kind)[0]?.id;
}

export function normalizeQuickBuildVariantId(
    kind: QuickBuildStampKind,
    variantId: string | null | undefined,
): QuickBuildVariantId | undefined {
    const variants = getQuickBuildVariants(kind);
    if (variants.length === 0) return undefined;
    const defaultVariantId = variants[0]?.id;
    const normalized = variants.find(variant => variant.id === variantId)?.id ?? defaultVariantId;
    return normalized === defaultVariantId ? undefined : normalized;
}

function resolveQuickBuildRenderVariantId(
    kind: QuickBuildStampKind,
    variantId: string | null | undefined,
): QuickBuildVariantId | undefined {
    const variants = getQuickBuildVariants(kind);
    if (variants.length === 0) return undefined;
    return variants.find(variant => variant.id === variantId)?.id ?? variants[0]?.id;
}

function getQuickBuildVariantLabel(kind: QuickBuildStampKind, variantId: QuickBuildVariantId | undefined) {
    return getQuickBuildVariants(kind).find(variant => variant.id === variantId)?.label ?? QUICK_BUILD_LABELS[kind];
}

const MATERIALS = {
    ground: new THREE.MeshStandardMaterial({color: 0x4f8f3a, roughness: 0.9}),
    sand: new THREE.MeshStandardMaterial({color: 0xd9bd78, roughness: 0.95}),
    stoneTile: new THREE.MeshStandardMaterial({color: 0x9aa0a6, roughness: 0.96}),
    path: new THREE.MeshStandardMaterial({color: 0xcaa66a, roughness: 0.95}),
    water: new THREE.MeshStandardMaterial({
        color: 0x2f8fcf,
        roughness: 0.35,
        metalness: 0.05,
        transparent: true,
        opacity: 0.72,
    }),
    bridge: new THREE.MeshStandardMaterial({color: 0x8b5e34, roughness: 0.85}),
    bridgeRail: new THREE.MeshStandardMaterial({color: 0x5b3920, roughness: 0.82}),
    street: new THREE.MeshStandardMaterial({color: 0x4b5563, roughness: 0.92}),
    streetCurb: new THREE.MeshStandardMaterial({color: 0xb7bdc5, roughness: 0.9}),
    streetStripe: new THREE.MeshStandardMaterial({color: 0xf4d35e, roughness: 0.7}),
    cobble: new THREE.MeshStandardMaterial({color: 0x9b9285, roughness: 0.96}),
    cobbleAccent: new THREE.MeshStandardMaterial({color: 0xc7bfae, roughness: 0.94}),
    farm: new THREE.MeshStandardMaterial({color: 0x8b5a2b, roughness: 0.98}),
    crop: new THREE.MeshStandardMaterial({color: 0x6aa84f, roughness: 0.84}),
    fence: new THREE.MeshStandardMaterial({color: 0x8a5a33, roughness: 0.86}),
    trunk: new THREE.MeshStandardMaterial({color: 0x6b4423, roughness: 0.85}),
    canopy: new THREE.MeshStandardMaterial({color: 0x3f8f45, roughness: 0.75}),
    bush: new THREE.MeshStandardMaterial({color: 0x4f9b59, roughness: 0.82}),
    hedge: new THREE.MeshStandardMaterial({color: 0x3f7f45, roughness: 0.84}),
    flower: new THREE.MeshStandardMaterial({color: 0xf472b6, roughness: 0.62}),
    rock: new THREE.MeshStandardMaterial({color: 0x8b8f92, roughness: 0.95}),
    houseWall: new THREE.MeshStandardMaterial({color: 0xd8c098, roughness: 0.82}),
    houseRoof: new THREE.MeshStandardMaterial({color: 0x9e3f35, roughness: 0.78}),
    houseTrim: new THREE.MeshStandardMaterial({color: 0x3c2f25, roughness: 0.8}),
    cabinWall: new THREE.MeshStandardMaterial({color: 0x8b5a2b, roughness: 0.86}),
    cabinRoof: new THREE.MeshStandardMaterial({color: 0x4f2f1c, roughness: 0.84}),
    townhouseWall: new THREE.MeshStandardMaterial({color: 0xc45f4f, roughness: 0.8}),
    townhouseRoof: new THREE.MeshStandardMaterial({color: 0x374151, roughness: 0.78}),
    window: new THREE.MeshStandardMaterial({color: 0x96c9e8, roughness: 0.35, metalness: 0.05}),
    lampPost: new THREE.MeshStandardMaterial({color: 0x374151, roughness: 0.7, metalness: 0.2}),
    lampGlow: new THREE.MeshStandardMaterial({
        color: 0xfacc15,
        emissive: 0xf59e0b,
        emissiveIntensity: 0.8,
        roughness: 0.35,
    }),
};

function cloneSharedMaterial(material: THREE.Material): THREE.Material {
    return material.clone();
}

function isEmptyQuickBuildMaterial(material: THREE.Material | null | undefined): boolean {
    if (!material || material.isMaterial !== true) return true;

    const candidate = material as THREE.Material & {
        color?: THREE.Color;
        emissive?: THREE.Color;
        roughness?: number;
        metalness?: number;
        opacity?: number;
        transparent?: boolean;
        name?: string;
        map?: THREE.Texture | null;
        normalMap?: THREE.Texture | null;
        roughnessMap?: THREE.Texture | null;
        metalnessMap?: THREE.Texture | null;
        userData?: Record<string, unknown>;
    };

    // A material entry containing only serializer metadata can be restored by
    // Three.js as either the default white MeshStandardMaterial or the
    // MeshBasicMaterial fallback used when an older save contains
    // `material: null`. Treat both shapes as empty for Quick Build so authored
    // palette materials are restored instead of leaving a visually blank slot.
    const hasNoAuthoredOverrides = candidate.opacity === 1
        && candidate.transparent !== true
        && !candidate.name
        && !candidate.map
        && !candidate.normalMap
        && !candidate.roughnessMap
        && !candidate.metalnessMap
        && Object.keys(candidate.userData ?? {}).length === 0;
    if (!hasNoAuthoredOverrides) return false;
    if (candidate.type === "Material") return true;
    if (candidate.color?.getHex() !== 0xffffff) return false;

    if (candidate.type === "MeshStandardMaterial") {
        return candidate.emissive?.getHex() === 0
            && candidate.roughness === 1
            && candidate.metalness === 0;
    }

    return candidate.type === "MeshBasicMaterial";
}

function createTopTexturableBoxMaterials(material: THREE.Material): THREE.Material[] {
    const side = cloneSharedMaterial(material);
    const top = cloneSharedMaterial(material);
    const bottom = cloneSharedMaterial(material);
    return [side, side, top, bottom, side, side];
}

function markMesh(mesh: THREE.Mesh, receiveShadow = true) {
    mesh.castShadow = true;
    mesh.receiveShadow = receiveShadow;
    return mesh;
}

function markQuickBuildPart(mesh: THREE.Mesh, part: string) {
    mesh.userData.quickBuildPart = part;
    return mesh;
}

function markQuickBuildTopTextureTarget(mesh: THREE.Mesh) {
    mesh.userData.quickBuildTextureMaterialIndices = [QUICK_BUILD_TOP_FACE_MATERIAL_INDEX];
    mesh.userData.isBatchable = false;
    return mesh;
}

function createTopTexturableBoxMesh(geometry: THREE.BoxGeometry, material: THREE.Material) {
    return markQuickBuildTopTextureTarget(
        markMesh(new THREE.Mesh(geometry, createTopTexturableBoxMaterials(material))),
    );
}

function setQuickBuildMetadata(
    object: THREE.Object3D,
    kind: QuickBuildStampKind,
    level = 1,
    variantId?: QuickBuildVariantId | string | null,
) {
    const normalizedVariantId = normalizeQuickBuildVariantId(kind, variantId);
    const renderVariantId = resolveQuickBuildRenderVariantId(kind, variantId);
    object.name = `Quick Build ${getQuickBuildVariantLabel(kind, renderVariantId)}`;
    object.userData.quickBuild = {
        kind,
        level,
        ...(normalizedVariantId ? {variantId: normalizedVariantId} : {}),
    } satisfies QuickBuildMetadata;
    object.userData.isQuickBuildObject = true;
    object.userData.isStemObject = true;
    object.userData.isSelectable = true;
    object.userData.isBatchable = false;
    object.userData.managedBy = "Quick Build";
    object.userData.sceneTreeBadge = "Build";
    object.userData.sceneTreeDescription = "Quick Build stamp";
    object.userData.editorVisibility = object.userData.editorVisibility ?? true;
    object.userData.gameVisibility = object.userData.gameVisibility ?? true;
    object.userData.enableAtStart = object.userData.enableAtStart ?? true;
}

function createFlatTile(kind: "ground" | "sand" | "stone" | "water" | "farm") {
    const group = new THREE.Group();
    setQuickBuildMetadata(group, kind);

    const height = kind === "water" ? 0.06 : kind === "stone" ? 0.16 : 0.12;
    const geometry = new THREE.BoxGeometry(QUICK_BUILD_CELL_SIZE, height, QUICK_BUILD_CELL_SIZE);
    const material = kind === "stone"
        ? MATERIALS.stoneTile
        : kind === "farm"
          ? MATERIALS.farm
          : MATERIALS[kind];
    const mesh = markQuickBuildPart(
        createTopTexturableBoxMesh(geometry, material),
        `${kind}-tile`,
    );
    mesh.position.y = height / 2;
    mesh.castShadow = kind !== "water";
    mesh.receiveShadow = true;
    group.add(mesh);

    if (kind === "farm") {
        for (const x of [-1.2, -0.4, 0.4, 1.2]) {
            const crop = markMesh(
                new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 3.2), cloneSharedMaterial(MATERIALS.crop)),
            );
            crop.name = "Crop Row";
            crop.position.set(x, 0.24, 0);
            group.add(crop);
        }
    }

    return group;
}

function addStreetLaneMarking(host: THREE.Object3D, axis: "x" | "z", length: number, height: number) {
    const stripe = markQuickBuildPart(
        markMesh(
            new THREE.Mesh(
                axis === "x"
                    ? new THREE.BoxGeometry(length, 0.018, 0.06)
                    : new THREE.BoxGeometry(0.06, 0.018, length),
                cloneSharedMaterial(MATERIALS.streetStripe),
            ),
            false,
        ),
        "street-lane-marking",
    );
    stripe.position.y = (height / 2) + 0.012;
    host.add(stripe);
}

function addCobbleAccents(host: THREE.Object3D, width: number, depth: number, height: number) {
    const accents: Array<[number, number, number, number]> = [
        [-0.26, -0.22, 0.28, 0.16],
        [0.24, -0.08, 0.22, 0.2],
        [-0.08, 0.26, 0.2, 0.15],
        [0.34, 0.28, 0.24, 0.14],
    ];
    for (const [xMix, zMix, xSize, zSize] of accents) {
        const stone = markQuickBuildPart(
            markMesh(
                new THREE.Mesh(
                    new THREE.BoxGeometry(Math.min(width * xSize, 0.34), 0.014, Math.min(depth * zSize, 0.26)),
                    cloneSharedMaterial(MATERIALS.cobbleAccent),
                ),
                false,
            ),
            "cobble-accent",
        );
        stone.position.set(xMix * width, (height / 2) + 0.01, zMix * depth);
        host.add(stone);
    }
}

function createConnectedStrip(kind: "path" | "bridge", variantId?: QuickBuildVariantId | string | null) {
    const group = new THREE.Group();
    const renderVariantId = kind === "path" ? resolveQuickBuildRenderVariantId("path", variantId) : undefined;
    setQuickBuildMetadata(group, kind, 1, renderVariantId);

    const material = kind === "bridge"
        ? MATERIALS.bridge
        : renderVariantId === "path-street"
          ? MATERIALS.street
          : renderVariantId === "path-cobble"
            ? MATERIALS.cobble
            : MATERIALS.path;
    const height = kind === "bridge" ? 0.16 : renderVariantId === "path-street" ? 0.1 : 0.08;
    const width = kind === "bridge" ? 1.45 : renderVariantId === "path-street" ? 1.7 : 1.2;
    const y = height / 2;
    const center = markQuickBuildPart(
        createTopTexturableBoxMesh(new THREE.BoxGeometry(width, height, width), material),
        `${kind}-center`,
    );
    center.position.y = y;
    if (renderVariantId === "path-street") {
        addStreetLaneMarking(center, "x", width * 0.68, height);
        addStreetLaneMarking(center, "z", width * 0.68, height);
    } else if (renderVariantId === "path-cobble") {
        addCobbleAccents(center, width, width, height);
    }
    group.add(center);

    const arms: Array<[QuickBuildDirection, THREE.Vector3, THREE.BoxGeometry]> = [
        ["north", new THREE.Vector3(0, y, -1.3), new THREE.BoxGeometry(width, height, 1.4)],
        ["east", new THREE.Vector3(1.3, y, 0), new THREE.BoxGeometry(1.4, height, width)],
        ["south", new THREE.Vector3(0, y, 1.3), new THREE.BoxGeometry(width, height, 1.4)],
        ["west", new THREE.Vector3(-1.3, y, 0), new THREE.BoxGeometry(1.4, height, width)],
    ];

    for (const [direction, position, geometry] of arms) {
        const arm = markQuickBuildPart(
            createTopTexturableBoxMesh(geometry, material),
            `${kind}-${direction}`,
        );
        arm.position.copy(position);
        arm.visible = direction === "east" || direction === "west";
        if (renderVariantId === "path-street") {
            addStreetLaneMarking(arm, direction === "east" || direction === "west" ? "x" : "z", 1.04, height);
        } else if (renderVariantId === "path-cobble") {
            const armSize = new THREE.Vector3();
            geometry.computeBoundingBox();
            geometry.boundingBox?.getSize(armSize);
            addCobbleAccents(arm, armSize.x || width, armSize.z || width, height);
        }
        group.add(arm);
    }

    if (renderVariantId === "path-street") {
        for (const z of [-0.92, 0.92]) {
            const curb = markQuickBuildPart(
                markMesh(new THREE.Mesh(
                    new THREE.BoxGeometry(QUICK_BUILD_CELL_SIZE * 0.72, 0.08, 0.08),
                    cloneSharedMaterial(MATERIALS.streetCurb),
                )),
                "street-curb",
            );
            curb.position.set(0, 0.12, z);
            group.add(curb);
        }
    }

    if (kind === "bridge") {
        for (const z of [-0.84, 0.84]) {
            const rail = markQuickBuildPart(
                markMesh(new THREE.Mesh(
                    new THREE.BoxGeometry(QUICK_BUILD_CELL_SIZE * 0.9, 0.18, 0.12),
                    cloneSharedMaterial(MATERIALS.bridgeRail),
                )),
                "bridge-rail",
            );
            rail.position.set(0, 0.34, z);
            group.add(rail);
        }
    }

    return group;
}

function createFenceSegment() {
    const group = new THREE.Group();
    setQuickBuildMetadata(group, "fence");

    const railLength = 1;
    for (const [part, y] of [["fence-rail-low", 0.34], ["fence-rail-high", 0.72]] as const) {
        const rail = markQuickBuildPart(
            createTopTexturableBoxMesh(new THREE.BoxGeometry(railLength, 0.12, 0.12), MATERIALS.fence),
            part,
        );
        rail.position.set(0, y, 0);
        group.add(rail);
    }

    for (const x of [-0.5, 0.5]) {
        const post = markQuickBuildPart(
            markMesh(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.95, 0.18), cloneSharedMaterial(MATERIALS.fence))),
            "fence-post",
        );
        post.position.set(x, 0.475, 0);
        group.add(post);
    }

    return group;
}

function disposeQuickBuildObjectChildren(object: THREE.Object3D) {
    for (const child of [...object.children]) {
        traverseObjectDepthFirst(child, node => {
            const mesh = node as THREE.Mesh;
            if (!mesh.isMesh) return;
            mesh.geometry?.dispose();
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const material of materials) material.dispose();
        });
        object.remove(child);
    }
}

function hasLegacyFenceStripGeometry(object: THREE.Object3D) {
    return object.children.some(child => {
        const part = child.userData?.quickBuildPart;
        return typeof part === "string" && /^fence-(center|north|east|south|west)$/.test(part);
    });
}

function repairLegacyFenceGeometry(object: THREE.Object3D, metadata: QuickBuildMetadata) {
    if (metadata.kind !== "fence" || !hasLegacyFenceStripGeometry(object)) return false;

    const replacement = createFenceSegment();
    disposeQuickBuildObjectChildren(object);
    while (replacement.children.length > 0) {
        object.add(replacement.children[0]!);
    }
    object.userData.quickBuild = {
        kind: "fence",
        level: metadata.level,
    } satisfies QuickBuildMetadata;
    return true;
}

function createTree() {
    const group = new THREE.Group();
    setQuickBuildMetadata(group, "tree");

    const trunk = markMesh(
        new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.15, 8), cloneSharedMaterial(MATERIALS.trunk)),
    );
    trunk.position.y = 0.575;
    group.add(trunk);

    const canopy = markMesh(
        new THREE.Mesh(new THREE.DodecahedronGeometry(0.72, 0), cloneSharedMaterial(MATERIALS.canopy)),
    );
    canopy.position.y = 1.45;
    canopy.scale.set(1.05, 1.12, 1.05);
    group.add(canopy);

    return group;
}

function createRock() {
    const group = new THREE.Group();
    setQuickBuildMetadata(group, "rock");

    const rock = markMesh(
        new THREE.Mesh(new THREE.DodecahedronGeometry(0.62, 0), cloneSharedMaterial(MATERIALS.rock)),
    );
    rock.position.y = 0.46;
    rock.scale.set(1.25, 0.74, 1);
    rock.rotation.set(0.18, 0.48, -0.08);
    group.add(rock);

    return group;
}

function createBush(variantId?: QuickBuildVariantId | string | null) {
    const group = new THREE.Group();
    const renderVariantId = resolveQuickBuildRenderVariantId("bush", variantId);
    setQuickBuildMetadata(group, "bush", 1, renderVariantId);

    if (renderVariantId === "bush-hedge") {
        const body = markMesh(
            new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.54, 0.5), cloneSharedMaterial(MATERIALS.hedge)),
        );
        body.position.y = 0.38;
        body.rotation.y = 0.08;
        group.add(body);

        for (const x of [-0.55, 0.55]) {
            const cap = markMesh(
                new THREE.Mesh(new THREE.DodecahedronGeometry(0.34, 0), cloneSharedMaterial(MATERIALS.hedge)),
            );
            cap.position.set(x, 0.42, 0);
            cap.scale.set(0.82, 0.72, 0.72);
            group.add(cap);
        }
        return group;
    }

    for (const [x, z, scale] of [[0, 0, 1], [-0.34, 0.08, 0.72], [0.32, -0.1, 0.78]] as const) {
        const bush = markMesh(
            new THREE.Mesh(new THREE.DodecahedronGeometry(0.46 * scale, 0), cloneSharedMaterial(MATERIALS.bush)),
        );
        bush.position.set(x, 0.34 * scale, z);
        bush.scale.y = 0.72;
        group.add(bush);
    }

    if (renderVariantId === "bush-flowering") {
        const flowers: Array<[number, number, number]> = [
            [-0.24, 0.58, 0.12],
            [0.18, 0.5, -0.18],
            [0.32, 0.44, 0.12],
            [-0.08, 0.66, -0.24],
        ];
        for (const [x, y, z] of flowers) {
            const flower = markMesh(
                new THREE.Mesh(new THREE.DodecahedronGeometry(0.075, 0), cloneSharedMaterial(MATERIALS.flower)),
                false,
            );
            flower.position.set(x, y, z);
            group.add(flower);
        }
    }

    return group;
}

function addHouseWindow(group: THREE.Group, x: number, y: number, z: number, width = 0.3, height = 0.24) {
    const windowMesh = markMesh(
        new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.035), cloneSharedMaterial(MATERIALS.window)),
        false,
    );
    windowMesh.position.set(x, y, z);
    group.add(windowMesh);
}

function createHouse(variantId?: QuickBuildVariantId | string | null) {
    const group = new THREE.Group();
    const renderVariantId = resolveQuickBuildRenderVariantId("house", variantId);
    setQuickBuildMetadata(group, "house", 1, renderVariantId);

    if (renderVariantId === "house-cabin") {
        const wall = markMesh(
            new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.92, 1.25), cloneSharedMaterial(MATERIALS.cabinWall)),
        );
        wall.position.y = 0.46;
        group.add(wall);

        for (const y of [0.28, 0.52, 0.76]) {
            const log = markMesh(
                new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.07, 0.04), cloneSharedMaterial(MATERIALS.houseTrim)),
                false,
            );
            log.position.set(0, y, 0.648);
            group.add(log);
        }

        const roof = markMesh(
            new THREE.Mesh(new THREE.ConeGeometry(1.34, 0.62, 4), cloneSharedMaterial(MATERIALS.cabinRoof)),
        );
        roof.position.y = 1.18;
        roof.rotation.y = Math.PI / 4;
        roof.scale.set(1.15, 1, 0.96);
        group.add(roof);

        const porch = markMesh(
            new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.1, 0.44), cloneSharedMaterial(MATERIALS.houseTrim)),
        );
        porch.position.set(0, 0.08, 0.86);
        group.add(porch);

        const door = markMesh(
            new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.5, 0.035), cloneSharedMaterial(MATERIALS.houseTrim)),
            false,
        );
        door.position.set(0, 0.28, 0.648);
        group.add(door);
        addHouseWindow(group, -0.52, 0.58, 0.651, 0.28, 0.22);
        addHouseWindow(group, 0.52, 0.58, 0.651, 0.28, 0.22);

        const chimney = markMesh(
            new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.44, 0.18), cloneSharedMaterial(MATERIALS.houseTrim)),
        );
        chimney.position.set(0.52, 1.38, -0.18);
        group.add(chimney);
        return group;
    }

    if (renderVariantId === "house-townhouse") {
        const wall = markMesh(
            new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.72, 1.28), cloneSharedMaterial(MATERIALS.townhouseWall)),
        );
        wall.position.y = 0.86;
        group.add(wall);

        const roof = markMesh(
            new THREE.Mesh(new THREE.ConeGeometry(0.94, 0.5, 4), cloneSharedMaterial(MATERIALS.townhouseRoof)),
        );
        roof.position.y = 1.97;
        roof.rotation.y = Math.PI / 4;
        roof.scale.z = 1.08;
        group.add(roof);

        const door = markMesh(
            new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.56, 0.035), cloneSharedMaterial(MATERIALS.houseTrim)),
            false,
        );
        door.position.set(0, 0.29, 0.657);
        group.add(door);

        for (const [x, y] of [[-0.32, 0.82], [0.32, 0.82], [-0.32, 1.28], [0.32, 1.28]] as const) {
            addHouseWindow(group, x, y, 0.66, 0.22, 0.22);
        }
        return group;
    }

    const wall = markMesh(
        new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.15, 1.45), cloneSharedMaterial(MATERIALS.houseWall)),
    );
    wall.position.y = 0.575;
    group.add(wall);

    const roof = markMesh(
        new THREE.Mesh(new THREE.ConeGeometry(1.32, 0.72, 4), cloneSharedMaterial(MATERIALS.houseRoof)),
    );
    roof.position.y = 1.51;
    roof.rotation.y = Math.PI / 4;
    roof.scale.z = 1.08;
    group.add(roof);

    const door = markMesh(
        new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.54, 0.035), cloneSharedMaterial(MATERIALS.houseTrim)),
        false,
    );
    door.position.set(0, 0.28, 0.744);
    group.add(door);

    for (const x of [-0.52, 0.52]) {
        addHouseWindow(group, x, 0.67, 0.747);
    }

    return group;
}

function createLamp() {
    const group = new THREE.Group();
    setQuickBuildMetadata(group, "lamp");

    const post = markMesh(
        new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.45, 8), cloneSharedMaterial(MATERIALS.lampPost)),
    );
    post.position.y = 0.725;
    group.add(post);

    const arm = markMesh(
        new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.08, 0.08), cloneSharedMaterial(MATERIALS.lampPost)),
    );
    arm.position.set(0.22, 1.42, 0);
    group.add(arm);

    const lamp = markMesh(
        new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.22, 8), cloneSharedMaterial(MATERIALS.lampGlow)),
        false,
    );
    lamp.position.set(0.5, 1.3, 0);
    group.add(lamp);

    return group;
}

export function createQuickBuildObject(kind: QuickBuildStampKind, options: QuickBuildObjectOptions = {}): THREE.Object3D {
    switch (kind) {
        case "ground":
        case "sand":
        case "stone":
        case "water":
        case "farm":
            return createFlatTile(kind);
        case "path":
            return createConnectedStrip(kind, options.variantId);
        case "bridge":
            return createConnectedStrip(kind);
        case "fence":
            return createFenceSegment();
        case "tree":
            return createTree();
        case "bush":
            return createBush(options.variantId);
        case "rock":
            return createRock();
        case "house":
            return createHouse(options.variantId);
        case "lamp":
            return createLamp();
    }
}

export function getQuickBuildMetadata(object: THREE.Object3D | null | undefined): QuickBuildMetadata | null {
    if (object?.userData?.isQuickBuildPreview === true) return null;
    const data = object?.userData?.quickBuild;
    if (!data || typeof data.kind !== "string") return null;
    if (![
        "ground",
        "sand",
        "stone",
        "path",
        "water",
        "bridge",
        "farm",
        "fence",
        "tree",
        "bush",
        "rock",
        "house",
        "lamp",
    ].includes(data.kind)) return null;
    const kind = data.kind as QuickBuildStampKind;
    const level = Number(data.level);
    const variantId = normalizeQuickBuildVariantId(
        kind,
        typeof data.variantId === "string" ? data.variantId : undefined,
    );
    return {
        kind,
        level: Number.isFinite(level) ? Math.max(1, Math.min(QUICK_BUILD_MAX_LEVEL, Math.floor(level))) : 1,
        ...(variantId ? {variantId} : {}),
        connections: normalizeQuickBuildConnections(data.connections),
    };
}

export function isQuickBuildPreviewObject(object: THREE.Object3D | null | undefined) {
    let current: THREE.Object3D | null | undefined = object;
    while (current) {
        if (current.userData?.isQuickBuildPreview === true) return true;
        current = current.parent;
    }
    return false;
}

export function repairQuickBuildRenderableState(object: THREE.Object3D | null | undefined) {
    const metadata = getQuickBuildMetadata(object);
    if (!object || !metadata) return false;
    let repaired = false;

    if (repairLegacyFenceGeometry(object, metadata)) {
        repaired = true;
    }

    if (object.visible !== true) {
        object.visible = true;
        repaired = true;
    }
    if (object.userData.isBatchable !== false) {
        object.userData.isBatchable = false;
        repaired = true;
    }
    if (object.userData.editorVisibility !== true) {
        object.userData.editorVisibility = true;
        repaired = true;
    }
    if (object.userData.gameVisibility === undefined) {
        object.userData.gameVisibility = true;
        repaired = true;
    }

    traverseObjectDepthFirst(object, child => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;

        if (mesh.userData.isBatchable !== false) {
            mesh.userData.isBatchable = false;
            repaired = true;
        }

        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const invalidMaterialIndex = materials.findIndex(material =>
            !material
            || (material as THREE.Material).isMaterial !== true
            || isEmptyQuickBuildMaterial(material as THREE.Material),
        );
        if (materials.length === 0 || invalidMaterialIndex >= 0) {
            const fallback = getQuickBuildFallbackMaterial(metadata, mesh.userData?.quickBuildPart);
            const groupCount = mesh.geometry?.groups?.length ?? 0;
            const materialCount = Math.max(groupCount, materials.length, 1);
            mesh.material = Array.from({length: materialCount}, (_, index) => {
                const existing = materials[index];
                return existing
                    && (existing as THREE.Material).isMaterial === true
                    && !isEmptyQuickBuildMaterial(existing as THREE.Material)
                    ? existing
                    : cloneSharedMaterial(fallback);
            });
            repaired = true;
        }

        const repairedMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of repairedMaterials) {
            if (material.visible !== true) {
                material.visible = true;
                repaired = true;
            }
            material.needsUpdate = true;
        }
    });

    return repaired;
}

function getQuickBuildFallbackMaterial(
    metadata: QuickBuildMetadata,
    part: unknown,
): THREE.Material {
    const partName = typeof part === "string" ? part : "";
    if (metadata.kind === "farm" && partName.includes("crop")) return MATERIALS.crop;
    if (metadata.kind === "tree") return partName.includes("trunk") ? MATERIALS.trunk : MATERIALS.canopy;
    if (metadata.kind === "bush") {
        if (metadata.variantId === "bush-hedge") return MATERIALS.hedge;
        if (metadata.variantId === "bush-flowering") return MATERIALS.flower;
        return MATERIALS.bush;
    }
    if (metadata.kind === "path") {
        if (metadata.variantId === "path-street") return MATERIALS.street;
        if (metadata.variantId === "path-cobble") return MATERIALS.cobble;
        return MATERIALS.path;
    }
    if (metadata.kind === "bridge") return partName.includes("rail") ? MATERIALS.bridgeRail : MATERIALS.bridge;
    if (metadata.kind === "house") {
        if (metadata.variantId === "house-cabin") return partName.includes("roof") ? MATERIALS.cabinRoof : MATERIALS.cabinWall;
        if (metadata.variantId === "house-townhouse") return partName.includes("roof") ? MATERIALS.townhouseRoof : MATERIALS.townhouseWall;
        return partName.includes("roof") ? MATERIALS.houseRoof : MATERIALS.houseWall;
    }
    if (metadata.kind === "lamp") return partName.includes("glow") ? MATERIALS.lampGlow : MATERIALS.lampPost;
    if (metadata.kind === "stone") return MATERIALS.stoneTile;
    const fallbackByKind: Partial<Record<QuickBuildStampKind, THREE.Material>> = {
        ground: MATERIALS.ground,
        sand: MATERIALS.sand,
        water: MATERIALS.water,
        farm: MATERIALS.farm,
        fence: MATERIALS.fence,
        rock: MATERIALS.rock,
    };
    return fallbackByKind[metadata.kind] ?? MATERIALS.ground;
}

export function normalizeQuickBuildConnections(value: unknown): QuickBuildConnections {
    const input = value && typeof value === "object" ? (value as Partial<Record<QuickBuildDirection, unknown>>) : {};
    return {
        north: input.north === true,
        east: input.east === true,
        south: input.south === true,
        west: input.west === true,
    };
}

export function findQuickBuildRoot(object: THREE.Object3D | null | undefined): THREE.Object3D | null {
    if (isQuickBuildPreviewObject(object)) return null;
    let current: THREE.Object3D | null | undefined = object;
    while (current) {
        if (getQuickBuildMetadata(current)) return current;
        current = current.parent;
    }
    return null;
}

export function getEnhancedQuickBuildScale(
    object: THREE.Object3D,
    kind: QuickBuildStampKind,
): THREE.Vector3 | null {
    const metadata = getQuickBuildMetadata(object);
    const level = metadata?.level ?? 1;
    if (level >= QUICK_BUILD_MAX_LEVEL) return null;

    const nextScale = object.scale.clone();
    switch (kind) {
        case "ground":
        case "sand":
        case "stone":
        case "path":
        case "water":
        case "bridge":
        case "farm":
        case "fence":
            nextScale.x *= 1.15;
            nextScale.z *= 1.15;
            break;
        case "house":
            nextScale.x *= 1.03;
            nextScale.y *= 1.16;
            nextScale.z *= 1.03;
            break;
        case "tree":
        case "bush":
        case "lamp":
            nextScale.x *= 1.05;
            nextScale.y *= 1.14;
            nextScale.z *= 1.05;
            break;
        case "rock":
            nextScale.multiplyScalar(1.12);
            break;
    }
    return nextScale;
}

export function nextQuickBuildUserData(object: THREE.Object3D): Record<string, unknown> {
    const metadata = getQuickBuildMetadata(object);
    if (!metadata) return {...object.userData};
    return {
        ...object.userData,
        quickBuild: {
            ...metadata,
            level: Math.min(QUICK_BUILD_MAX_LEVEL, metadata.level + 1),
        },
        isQuickBuildObject: true,
        isStemObject: true,
        isSelectable: true,
        managedBy: "Quick Build",
        sceneTreeBadge: "Build",
        sceneTreeDescription: "Quick Build stamp",
        editorVisibility: object.userData.editorVisibility ?? true,
        gameVisibility: object.userData.gameVisibility ?? true,
        enableAtStart: object.userData.enableAtStart ?? true,
    };
}

export function snapQuickBuildPoint(point: THREE.Vector3, increment = 1): THREE.Vector3 {
    const step = Number.isFinite(increment) && increment > 0 ? increment : 1;
    return new THREE.Vector3(
        Math.round(point.x / step) * step,
        point.y,
        Math.round(point.z / step) * step,
    );
}

export function applyQuickBuildConnections(object: THREE.Object3D, connections: QuickBuildConnections) {
    const metadata = getQuickBuildMetadata(object);
    if (!metadata) return;

    object.userData.quickBuild = {
        ...metadata,
        connections,
    };

    if (metadata.kind !== "path" && metadata.kind !== "bridge") return;

    const hasConnections = QUICK_BUILD_DIRECTIONS.some(direction => connections[direction]);
    traverseObjectDepthFirst(object, child => {
        const part = child.userData?.quickBuildPart;
        const prefix = `${metadata.kind}-`;
        if (typeof part !== "string" || !part.startsWith(prefix)) return;
        if (part === `${metadata.kind}-center`) {
            child.visible = true;
            return;
        }

        const direction = part.replace(prefix, "") as QuickBuildDirection;
        if (!QUICK_BUILD_DIRECTIONS.includes(direction)) return;
        child.visible = hasConnections ? connections[direction] === true : direction === "east" || direction === "west";
    });
}

export function createQuickBuildPreviewObject(kind: QuickBuildStampKind, options: QuickBuildObjectOptions = {}) {
    const object = createQuickBuildObject(kind, options);
    const renderVariantId = resolveQuickBuildRenderVariantId(kind, options.variantId);
    object.name = `Quick Build ${getQuickBuildVariantLabel(kind, renderVariantId)} Preview`;
    delete object.userData.quickBuild;
    object.userData.isQuickBuildObject = false;
    object.userData.isQuickBuildPreview = true;
    object.userData.isStemObject = false;
    object.userData.isSelectable = false;
    object.userData.editorVisibility = false;
    object.userData.gameVisibility = false;
    traverseObjectDepthFirst(object, child => {
        child.userData.isQuickBuildPreview = true;
        child.userData.isQuickBuildObject = false;
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;

        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const previewMaterials = materials.map(material => {
            const next = material.clone();
            next.transparent = true;
            next.opacity = 0.42;
            next.depthWrite = false;
            return next;
        });
        mesh.material = Array.isArray(mesh.material) ? previewMaterials : previewMaterials[0]!;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
    });
    return object;
}
