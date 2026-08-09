import {MeshBasicMaterial, MeshStandardMaterial} from "three";
import type {Object3D, Scene} from "three";

import {
    createProgressiveYieldController,
    type ProgressiveYieldOptions,
} from "./progressiveYield";
import {traverseObjectDepthFirst} from "./SceneTraverser";

type RuntimeMaterialBudgetConfig = {
    enabled?: boolean;
    stripDecorativeEmissiveNodes?: boolean;
    downgradeSimpleStandardNodeMaterials?: boolean;
    downgradeSimpleStandardMaterials?: boolean;
    preserveBatchableStandardMaterials?: boolean;
    shareEquivalentRuntimeMaterials?: boolean;
};

export type RuntimeMaterialBudgetStats = {
    enabled: boolean;
    materialsVisited: number;
    materialsSimplified: number;
    materialsDowngraded: number;
    materialsShared: number;
    materialShareGroups: number;
};

type RuntimeMaterialBudgetUserData = {
    isRuntimeOnly?: boolean;
    disableRuntimeMaterialBudget?: boolean;
    disableRuntimeMaterialSharing?: boolean;
    runtimeMaterialBudgetDowngradedFromNodeMaterial?: boolean;
    runtimeMaterialBudgetDowngradedFromStandardMaterial?: boolean;
    runtimeMaterialBudgetMutable?: boolean;
};

type NodeMaterialLike = {
    type?: string;
    isNodeMaterial?: boolean;
    isMeshStandardNodeMaterial?: boolean;
    isMeshStandardMaterial?: boolean;
    isMeshBasicMaterial?: boolean;
    emissiveNode?: unknown;
    needsUpdate?: boolean;
    userData?: RuntimeMaterialBudgetUserData;
};

type RuntimeMaterialSharingState = {
    sharedMaterialsByKey: Map<string, NodeMaterialLike>;
    shareGroupUseCounts: Map<string, number>;
};

const originalEmissiveNodes = new WeakMap<NodeMaterialLike, unknown>();
const downgradedStandardMaterials = new WeakMap<NodeMaterialLike, MeshStandardMaterial>();
const originalNodeMaterialsByDowngrade = new WeakMap<MeshStandardMaterial, NodeMaterialLike>();
const downgradedBasicMaterials = new WeakMap<NodeMaterialLike, MeshBasicMaterial>();
const originalStandardMaterialsByBasicDowngrade = new WeakMap<MeshBasicMaterial, NodeMaterialLike>();
const originalSharedMaterialsByObject = new WeakMap<Object3D, unknown>();
const RUNTIME_MATERIAL_BUDGET_PROGRESS_DEFAULTS = {
    batchSize: 32,
    frameBudgetMs: 4,
};
const STANDARD_NODE_MATERIAL_CUSTOM_KEYS = [
    "lightsNode",
    "envNode",
    "aoNode",
    "colorNode",
    "normalNode",
    "opacityNode",
    "backdropNode",
    "backdropAlphaNode",
    "alphaTestNode",
    "maskNode",
    "maskShadowNode",
    "positionNode",
    "geometryNode",
    "depthNode",
    "receivedShadowPositionNode",
    "castShadowPositionNode",
    "receivedShadowNode",
    "castShadowNode",
    "outputNode",
    "mrtNode",
    "fragmentNode",
    "vertexNode",
    "contextNode",
    "emissiveNode",
    "metalnessNode",
    "roughnessNode",
];
const MATERIAL_TEXTURE_KEYS = [
    "alphaMap",
    "aoMap",
    "bumpMap",
    "clearcoatMap",
    "clearcoatNormalMap",
    "clearcoatRoughnessMap",
    "displacementMap",
    "emissiveMap",
    "envMap",
    "gradientMap",
    "iridescenceMap",
    "iridescenceThicknessMap",
    "lightMap",
    "map",
    "matcap",
    "metalnessMap",
    "normalMap",
    "roughnessMap",
    "sheenColorMap",
    "sheenRoughnessMap",
    "specularColorMap",
    "specularIntensityMap",
    "thicknessMap",
    "transmissionMap",
];
const SIMPLE_SHARED_MATERIAL_USER_DATA_KEYS = new Set([
    "runtimeMaterialBudgetDowngradedFromNodeMaterial",
    "runtimeMaterialBudgetDowngradedFromStandardMaterial",
]);
const SIMPLE_SHARED_MATERIAL_KEY_FIELDS = [
    "alphaHash",
    "alphaTest",
    "blendAlpha",
    "blendColor",
    "blendDst",
    "blendDstAlpha",
    "blendEquation",
    "blendEquationAlpha",
    "blendSrc",
    "blendSrcAlpha",
    "blending",
    "clipIntersection",
    "clipShadows",
    "colorWrite",
    "depthFunc",
    "depthTest",
    "depthWrite",
    "dithering",
    "forceSinglePass",
    "fog",
    "opacity",
    "polygonOffset",
    "polygonOffsetFactor",
    "polygonOffsetUnits",
    "premultipliedAlpha",
    "shadowSide",
    "side",
    "stencilFail",
    "stencilFunc",
    "stencilFuncMask",
    "stencilRef",
    "stencilWrite",
    "stencilWriteMask",
    "stencilZFail",
    "stencilZPass",
    "toneMapped",
    "transparent",
    "vertexColors",
    "visible",
    "wireframe",
];
const SIMPLE_SHARED_STANDARD_KEY_FIELDS = [
    "aoMapIntensity",
    "bumpScale",
    "displacementBias",
    "displacementScale",
    "emissiveIntensity",
    "envMapIntensity",
    "flatShading",
    "lightMapIntensity",
    "metalness",
    "roughness",
];

function getBudgetConfig(scene: Scene): RuntimeMaterialBudgetConfig {
    return scene.userData?.rendering?.runtimeMaterialBudget ?? {};
}

function isDynamicBatchingEnabled(scene: Scene): boolean {
    return scene.userData?.rendering?.batching?.enableDynamic !== false;
}

function isRuntimeOnlyObject(object: Object3D): boolean {
    return (object.userData as RuntimeMaterialBudgetUserData | undefined)?.isRuntimeOnly === true;
}

function isCameraLike(object: Object3D): boolean {
    const candidate = object as Object3D & {isPerspectiveCamera?: boolean; isOrthographicCamera?: boolean};
    return candidate.isPerspectiveCamera === true || candidate.isOrthographicCamera === true;
}

function visitObjectMaterials(object: Object3D, visitMaterial: (material: NodeMaterialLike) => void): void {
    const material = (object as Object3D & {material?: unknown}).material;
    if (!material) {
        return;
    }

    if (Array.isArray(material)) {
        for (const entry of material) {
            if (entry && typeof entry === "object") {
                visitMaterial(entry as NodeMaterialLike);
            }
        }
        return;
    }

    if (typeof material === "object") {
        visitMaterial(material as NodeMaterialLike);
    }
}

function shouldSimplifyMaterial(material: NodeMaterialLike): boolean {
    return (
        material.userData?.disableRuntimeMaterialBudget !== true &&
        material.isMeshStandardNodeMaterial === true &&
        material.emissiveNode != null
    );
}

function hasCustomStandardNodeSlots(material: NodeMaterialLike): boolean {
    const record = material as Record<string, unknown>;
    return STANDARD_NODE_MATERIAL_CUSTOM_KEYS.some(key => record[key] != null);
}

function shouldDowngradeMaterial(material: NodeMaterialLike): boolean {
    return (
        material.userData?.disableRuntimeMaterialBudget !== true &&
        material.isMeshStandardNodeMaterial === true &&
        !hasCustomStandardNodeSlots(material)
    );
}

function shouldDowngradeSimpleStandardMaterial(material: NodeMaterialLike): boolean {
    return (
        material.userData?.disableRuntimeMaterialBudget !== true &&
        material.userData?.runtimeMaterialBudgetMutable !== true &&
        material.isNodeMaterial !== true &&
        material.isMeshStandardNodeMaterial !== true &&
        (material.isMeshStandardMaterial === true || material instanceof MeshStandardMaterial) &&
        !hasTextureSlot(material) &&
        !hasClippingPlanes(material)
    );
}

function hasOnlyShareSafeUserData(material: NodeMaterialLike): boolean {
    const userData = material.userData;
    if (!userData) {
        return true;
    }

    return Object.keys(userData).every(key => SIMPLE_SHARED_MATERIAL_USER_DATA_KEYS.has(key));
}

function hasTextureSlot(material: NodeMaterialLike): boolean {
    const record = material as Record<string, unknown>;
    return MATERIAL_TEXTURE_KEYS.some(key => record[key] != null);
}

function getMaterialDefinesKey(material: NodeMaterialLike): string | null {
    const defines = (material as Record<string, unknown>).defines;
    if (!defines || typeof defines !== "object") {
        return "none";
    }

    const entries = Object.entries(defines as Record<string, unknown>);
    if (entries.length === 0) {
        return "none";
    }

    const keyParts = entries
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => {
            if (
                value == null ||
                typeof value === "string" ||
                typeof value === "number" ||
                typeof value === "boolean"
            ) {
                return `${key}:${String(value ?? "null")}`;
            }

            return null;
        });

    if (keyParts.some(part => part == null)) {
        return null;
    }

    return keyParts.join(",");
}

function hasClippingPlanes(material: NodeMaterialLike): boolean {
    const clippingPlanes = (material as Record<string, unknown>).clippingPlanes;
    return Array.isArray(clippingPlanes) && clippingPlanes.length > 0;
}

function getColorKey(value: unknown): string {
    if (value && typeof value === "object" && typeof (value as {getHexString?: unknown}).getHexString === "function") {
        return (value as {getHexString: () => string}).getHexString();
    }

    return "none";
}

function getVectorKey(value: unknown): string {
    if (value && typeof value === "object") {
        const vector = value as {x?: unknown; y?: unknown};
        if (typeof vector.x === "number" && typeof vector.y === "number") {
            return `${vector.x},${vector.y}`;
        }
    }

    return "none";
}

function getMaterialShareKey(material: NodeMaterialLike): string | null {
    if (
        material.userData?.disableRuntimeMaterialBudget === true ||
        material.userData?.disableRuntimeMaterialSharing === true ||
        material.userData?.runtimeMaterialBudgetMutable === true ||
        material.isNodeMaterial === true ||
        material.isMeshStandardNodeMaterial === true ||
        hasCustomStandardNodeSlots(material) ||
        hasTextureSlot(material) ||
        hasClippingPlanes(material) ||
        !hasOnlyShareSafeUserData(material)
    ) {
        return null;
    }

    const record = material as Record<string, unknown>;
    const definesKey = getMaterialDefinesKey(material);
    if (definesKey == null) {
        return null;
    }

    const isStandard = material.isMeshStandardMaterial === true || material instanceof MeshStandardMaterial;
    const isBasic = material.isMeshBasicMaterial === true || material instanceof MeshBasicMaterial;
    if (!isStandard && !isBasic) {
        return null;
    }

    const values = [
        `type:${material.type ?? (isStandard ? "MeshStandardMaterial" : "MeshBasicMaterial")}`,
        `color:${getColorKey(record.color)}`,
        `defines:${definesKey}`,
        `program:${typeof record.customProgramCacheKey === "function"
            ? (record.customProgramCacheKey as () => string)()
            : "default"}`,
    ];

    for (const field of SIMPLE_SHARED_MATERIAL_KEY_FIELDS) {
        values.push(`${field}:${String(record[field] ?? "default")}`);
    }

    if (isStandard) {
        values.push(`emissive:${getColorKey(record.emissive)}`);
        values.push(`normalScale:${getVectorKey(record.normalScale)}`);
        for (const field of SIMPLE_SHARED_STANDARD_KEY_FIELDS) {
            values.push(`${field}:${String(record[field] ?? "default")}`);
        }
    }

    return values.join("|");
}

function rememberOriginalSharedMaterialAssignment(object: Object3D, material: unknown): void {
    if (originalSharedMaterialsByObject.has(object)) {
        return;
    }

    originalSharedMaterialsByObject.set(object, Array.isArray(material) ? material.slice() : material);
}

function createMaterialSharingState(): RuntimeMaterialSharingState {
    return {
        sharedMaterialsByKey: new Map(),
        shareGroupUseCounts: new Map(),
    };
}

function trackMaterialShareCandidate(
    material: NodeMaterialLike,
    state: RuntimeMaterialSharingState,
): NodeMaterialLike | null {
    const key = getMaterialShareKey(material);
    if (!key) {
        return null;
    }

    const sharedMaterial = state.sharedMaterialsByKey.get(key);
    if (!sharedMaterial) {
        state.sharedMaterialsByKey.set(key, material);
        state.shareGroupUseCounts.set(key, 1);
        return material;
    }

    state.shareGroupUseCounts.set(key, (state.shareGroupUseCounts.get(key) ?? 1) + 1);
    return sharedMaterial;
}

function shareObjectEquivalentRuntimeMaterials(
    object: Object3D,
    state: RuntimeMaterialSharingState,
    stats: RuntimeMaterialBudgetStats,
): void {
    const materialOwner = object as Object3D & {material?: unknown};
    const material = materialOwner.material;
    if (Array.isArray(material)) {
        let changed = false;
        const nextMaterials = material.map(entry => {
            if (!entry || typeof entry !== "object") {
                return entry;
            }

            const sharedMaterial = trackMaterialShareCandidate(entry as NodeMaterialLike, state);
            if (!sharedMaterial || sharedMaterial === entry) {
                return entry;
            }

            changed = true;
            stats.materialsShared += 1;
            return sharedMaterial;
        });

        if (changed) {
            rememberOriginalSharedMaterialAssignment(object, material);
            materialOwner.material = nextMaterials;
        }
        return;
    }

    if (!material || typeof material !== "object") {
        return;
    }

    const sharedMaterial = trackMaterialShareCandidate(material as NodeMaterialLike, state);
    if (sharedMaterial && sharedMaterial !== material) {
        rememberOriginalSharedMaterialAssignment(object, material);
        materialOwner.material = sharedMaterial;
        stats.materialsShared += 1;
    }
}

function finalizeMaterialSharingStats(
    state: RuntimeMaterialSharingState,
    stats: RuntimeMaterialBudgetStats,
): void {
    stats.materialShareGroups = [...state.shareGroupUseCounts.values()].filter(count => count > 1).length;
}

function getOrCreateDowngradedMaterial(material: NodeMaterialLike): MeshStandardMaterial {
    const existing = downgradedStandardMaterials.get(material);
    if (existing) {
        return existing;
    }

    const downgraded = new MeshStandardMaterial();
    downgraded.copy(material as unknown as MeshStandardMaterial);
    downgraded.name = typeof (material as {name?: unknown}).name === "string"
        ? (material as {name: string}).name
        : downgraded.name;
    downgraded.userData = {
        ...downgraded.userData,
        runtimeMaterialBudgetDowngradedFromNodeMaterial: true,
    };
    downgraded.needsUpdate = true;
    downgradedStandardMaterials.set(material, downgraded);
    originalNodeMaterialsByDowngrade.set(downgraded, material);
    return downgraded;
}

function copyStandardMaterialDisplayState(
    target: MeshBasicMaterial,
    source: MeshStandardMaterial,
): void {
    target.name = source.name;
    target.color.copy(source.color);
    target.alphaMap = source.alphaMap;
    target.alphaTest = source.alphaTest;
    target.blending = source.blending;
    target.clipIntersection = source.clipIntersection;
    target.clipShadows = source.clipShadows;
    target.clippingPlanes = source.clippingPlanes;
    target.colorWrite = source.colorWrite;
    target.defines = source.defines ? {...source.defines} : undefined;
    target.depthFunc = source.depthFunc;
    target.depthTest = source.depthTest;
    target.depthWrite = source.depthWrite;
    target.dithering = source.dithering;
    target.forceSinglePass = source.forceSinglePass;
    target.fog = source.fog;
    target.opacity = source.opacity;
    target.polygonOffset = source.polygonOffset;
    target.polygonOffsetFactor = source.polygonOffsetFactor;
    target.polygonOffsetUnits = source.polygonOffsetUnits;
    target.premultipliedAlpha = source.premultipliedAlpha;
    target.shadowSide = source.shadowSide;
    target.side = source.side;
    target.stencilFail = source.stencilFail;
    target.stencilFunc = source.stencilFunc;
    target.stencilFuncMask = source.stencilFuncMask;
    target.stencilRef = source.stencilRef;
    target.stencilWrite = source.stencilWrite;
    target.stencilWriteMask = source.stencilWriteMask;
    target.stencilZFail = source.stencilZFail;
    target.stencilZPass = source.stencilZPass;
    target.toneMapped = source.toneMapped;
    target.transparent = source.transparent;
    target.userData = {
        ...source.userData,
        runtimeMaterialBudgetDowngradedFromStandardMaterial: true,
    };
    target.vertexColors = source.vertexColors;
    target.visible = source.visible;
    target.wireframe = source.wireframe;
    target.needsUpdate = true;
}

function getOrCreateBasicDowngradedMaterial(material: NodeMaterialLike): MeshBasicMaterial {
    const existing = downgradedBasicMaterials.get(material);
    if (existing) {
        return existing;
    }

    const downgraded = new MeshBasicMaterial();
    copyStandardMaterialDisplayState(downgraded, material as unknown as MeshStandardMaterial);
    downgradedBasicMaterials.set(material, downgraded);
    originalStandardMaterialsByBasicDowngrade.set(downgraded, material);
    return downgraded;
}

function replaceObjectMaterials(
    object: Object3D,
    replaceMaterial: (material: NodeMaterialLike) => NodeMaterialLike | MeshStandardMaterial | MeshBasicMaterial,
): void {
    const materialOwner = object as Object3D & {material?: unknown};
    const material = materialOwner.material;
    if (!material) {
        return;
    }

    if (Array.isArray(material)) {
        let changed = false;
        const nextMaterials = material.map(entry => {
            if (!entry || typeof entry !== "object") {
                return entry;
            }
            const nextMaterial = replaceMaterial(entry as NodeMaterialLike);
            if (nextMaterial !== entry) {
                changed = true;
            }
            return nextMaterial;
        });
        if (changed) {
            materialOwner.material = nextMaterials;
        }
        return;
    }

    if (typeof material === "object") {
        const nextMaterial = replaceMaterial(material as NodeMaterialLike);
        if (nextMaterial !== material) {
            materialOwner.material = nextMaterial;
        }
    }
}

function restoreOriginalEmissiveNode(material: NodeMaterialLike): void {
    if (!originalEmissiveNodes.has(material)) {
        return;
    }

    material.emissiveNode = originalEmissiveNodes.get(material);
    material.needsUpdate = true;
    originalEmissiveNodes.delete(material);
}

export function applyRuntimeMaterialBudget(scene: Scene): RuntimeMaterialBudgetStats {
    const config = getBudgetConfig(scene);
    const enabled = config.enabled !== false;
    const stripDecorativeEmissiveNodes = config.stripDecorativeEmissiveNodes !== false;
    const downgradeSimpleStandardNodeMaterials = config.downgradeSimpleStandardNodeMaterials !== false;
    const preserveBatchableStandardMaterials =
        config.preserveBatchableStandardMaterials === true && isDynamicBatchingEnabled(scene);
    const downgradeSimpleStandardMaterials =
        config.downgradeSimpleStandardMaterials !== false && !preserveBatchableStandardMaterials;
    const shareEquivalentRuntimeMaterialsEnabled = config.shareEquivalentRuntimeMaterials !== false;
    const stats: RuntimeMaterialBudgetStats = {
        enabled,
        materialsVisited: 0,
        materialsSimplified: 0,
        materialsDowngraded: 0,
        materialsShared: 0,
        materialShareGroups: 0,
    };

    if (
        !enabled ||
        (!stripDecorativeEmissiveNodes &&
            !downgradeSimpleStandardNodeMaterials &&
            !downgradeSimpleStandardMaterials &&
            !shareEquivalentRuntimeMaterialsEnabled)
    ) {
        return stats;
    }

    const visitedMaterials = new WeakSet<NodeMaterialLike>();
    const downgradedMaterials = new WeakSet<NodeMaterialLike>();
    const sharingState = shareEquivalentRuntimeMaterialsEnabled ? createMaterialSharingState() : null;
    const stack: Array<{object: Object3D; runtimeSubtree: boolean; underCamera: boolean}> = [];

    for (let i = scene.children.length - 1; i >= 0; i--) {
        const child = scene.children[i];
        if (child) {
            stack.push({object: child, runtimeSubtree: false, underCamera: false});
        }
    }

    while (stack.length > 0) {
        const {object, runtimeSubtree, underCamera} = stack.pop()!;

        if ((object.userData as RuntimeMaterialBudgetUserData | undefined)?.disableRuntimeMaterialBudget === true) {
            continue;
        }

        const nextRuntimeSubtree = runtimeSubtree || isRuntimeOnlyObject(object);
        const nextUnderCamera = underCamera || isCameraLike(object);
        if (nextRuntimeSubtree) {
            visitObjectMaterials(object, material => {
                if (visitedMaterials.has(material)) {
                    return;
                }
                visitedMaterials.add(material);
                stats.materialsVisited += 1;

                if (!stripDecorativeEmissiveNodes || !shouldSimplifyMaterial(material)) {
                    return;
                }

                if (!originalEmissiveNodes.has(material)) {
                    originalEmissiveNodes.set(material, material.emissiveNode);
                }
                material.emissiveNode = null;
                material.needsUpdate = true;
                stats.materialsSimplified += 1;
            });

            if (downgradeSimpleStandardNodeMaterials) {
                replaceObjectMaterials(object, material => {
                    if (!shouldDowngradeMaterial(material)) {
                        return material;
                    }

                    const downgraded = getOrCreateDowngradedMaterial(material);
                    if (!downgradedMaterials.has(material)) {
                        downgradedMaterials.add(material);
                        stats.materialsDowngraded += 1;
                    }
                    return downgraded;
                });
            }

            if (downgradeSimpleStandardMaterials) {
                replaceObjectMaterials(object, material => {
                    if (!shouldDowngradeSimpleStandardMaterial(material)) {
                        return material;
                    }

                    const downgraded = getOrCreateBasicDowngradedMaterial(material);
                    if (!downgradedMaterials.has(material)) {
                        downgradedMaterials.add(material);
                        stats.materialsDowngraded += 1;
                    }
                    return downgraded;
                });
            }

            if (sharingState && !nextUnderCamera) {
                shareObjectEquivalentRuntimeMaterials(object, sharingState, stats);
            }
        }

        for (let i = object.children.length - 1; i >= 0; i--) {
            const child = object.children[i];
            if (child) {
                stack.push({object: child, runtimeSubtree: nextRuntimeSubtree, underCamera: nextUnderCamera});
            }
        }
    }

    if (sharingState) {
        finalizeMaterialSharingStats(sharingState, stats);
    }

    return stats;
}

export async function applyRuntimeMaterialBudgetProgressive(
    scene: Scene,
    options: ProgressiveYieldOptions = {},
): Promise<RuntimeMaterialBudgetStats> {
    const config = getBudgetConfig(scene);
    const enabled = config.enabled !== false;
    const stripDecorativeEmissiveNodes = config.stripDecorativeEmissiveNodes !== false;
    const downgradeSimpleStandardNodeMaterials = config.downgradeSimpleStandardNodeMaterials !== false;
    const preserveBatchableStandardMaterials =
        config.preserveBatchableStandardMaterials === true && isDynamicBatchingEnabled(scene);
    const downgradeSimpleStandardMaterials =
        config.downgradeSimpleStandardMaterials !== false && !preserveBatchableStandardMaterials;
    const shareEquivalentRuntimeMaterialsEnabled = config.shareEquivalentRuntimeMaterials !== false;
    const stats: RuntimeMaterialBudgetStats = {
        enabled,
        materialsVisited: 0,
        materialsSimplified: 0,
        materialsDowngraded: 0,
        materialsShared: 0,
        materialShareGroups: 0,
    };

    if (
        !enabled ||
        (!stripDecorativeEmissiveNodes &&
            !downgradeSimpleStandardNodeMaterials &&
            !downgradeSimpleStandardMaterials &&
            !shareEquivalentRuntimeMaterialsEnabled)
    ) {
        return stats;
    }

    const maybeYield = createProgressiveYieldController(options, RUNTIME_MATERIAL_BUDGET_PROGRESS_DEFAULTS);
    const visitedMaterials = new WeakSet<NodeMaterialLike>();
    const downgradedMaterials = new WeakSet<NodeMaterialLike>();
    const sharingState = shareEquivalentRuntimeMaterialsEnabled ? createMaterialSharingState() : null;
    const stack: Array<{object: Object3D; runtimeSubtree: boolean; underCamera: boolean}> = [];

    for (let i = scene.children.length - 1; i >= 0; i--) {
        const child = scene.children[i];
        if (child) {
            stack.push({object: child, runtimeSubtree: false, underCamera: false});
        }
    }

    while (stack.length > 0) {
        const {object, runtimeSubtree, underCamera} = stack.pop()!;

        if ((object.userData as RuntimeMaterialBudgetUserData | undefined)?.disableRuntimeMaterialBudget === true) {
            await maybeYield();
            continue;
        }

        const nextRuntimeSubtree = runtimeSubtree || isRuntimeOnlyObject(object);
        const nextUnderCamera = underCamera || isCameraLike(object);
        if (nextRuntimeSubtree) {
            visitObjectMaterials(object, material => {
                if (visitedMaterials.has(material)) {
                    return;
                }
                visitedMaterials.add(material);
                stats.materialsVisited += 1;

                if (!stripDecorativeEmissiveNodes || !shouldSimplifyMaterial(material)) {
                    return;
                }

                if (!originalEmissiveNodes.has(material)) {
                    originalEmissiveNodes.set(material, material.emissiveNode);
                }
                material.emissiveNode = null;
                material.needsUpdate = true;
                stats.materialsSimplified += 1;
            });

            if (downgradeSimpleStandardNodeMaterials) {
                replaceObjectMaterials(object, material => {
                    if (!shouldDowngradeMaterial(material)) {
                        return material;
                    }

                    const downgraded = getOrCreateDowngradedMaterial(material);
                    if (!downgradedMaterials.has(material)) {
                        downgradedMaterials.add(material);
                        stats.materialsDowngraded += 1;
                    }
                    return downgraded;
                });
            }

            if (downgradeSimpleStandardMaterials) {
                replaceObjectMaterials(object, material => {
                    if (!shouldDowngradeSimpleStandardMaterial(material)) {
                        return material;
                    }

                    const downgraded = getOrCreateBasicDowngradedMaterial(material);
                    if (!downgradedMaterials.has(material)) {
                        downgradedMaterials.add(material);
                        stats.materialsDowngraded += 1;
                    }
                    return downgraded;
                });
            }

            if (sharingState && !nextUnderCamera) {
                shareObjectEquivalentRuntimeMaterials(object, sharingState, stats);
            }
        }

        for (let i = object.children.length - 1; i >= 0; i--) {
            const child = object.children[i];
            if (child) {
                stack.push({object: child, runtimeSubtree: nextRuntimeSubtree, underCamera: nextUnderCamera});
            }
        }

        await maybeYield();
    }

    if (sharingState) {
        finalizeMaterialSharingStats(sharingState, stats);
    }

    return stats;
}

export function restoreRuntimeMaterialBudget(scene: Scene): void {
    const visitedMaterials = new WeakSet<NodeMaterialLike>();
    const restoredDowngrades = new WeakSet<object>();
    traverseObjectDepthFirst(scene, object => {
        if (originalSharedMaterialsByObject.has(object)) {
            (object as Object3D & {material?: unknown}).material = originalSharedMaterialsByObject.get(object);
            originalSharedMaterialsByObject.delete(object);
        }

        replaceObjectMaterials(object, material => {
            const originalMaterial = originalNodeMaterialsByDowngrade.get(material as unknown as MeshStandardMaterial);
            if (originalMaterial) {
                restoreOriginalEmissiveNode(originalMaterial);
                if (!restoredDowngrades.has(material as unknown as MeshStandardMaterial)) {
                    restoredDowngrades.add(material as unknown as MeshStandardMaterial);
                    downgradedStandardMaterials.delete(originalMaterial);
                    originalNodeMaterialsByDowngrade.delete(material as unknown as MeshStandardMaterial);
                    (material as unknown as MeshStandardMaterial).dispose();
                }
                return originalMaterial;
            }

            const originalStandardMaterial = originalStandardMaterialsByBasicDowngrade.get(
                material as unknown as MeshBasicMaterial,
            );
            if (originalStandardMaterial) {
                if (!restoredDowngrades.has(material as unknown as MeshStandardMaterial)) {
                    restoredDowngrades.add(material as unknown as MeshStandardMaterial);
                    downgradedBasicMaterials.delete(originalStandardMaterial);
                    originalStandardMaterialsByBasicDowngrade.delete(material as unknown as MeshBasicMaterial);
                    (material as unknown as MeshBasicMaterial).dispose();
                }

                const originalNodeMaterial = originalNodeMaterialsByDowngrade.get(
                    originalStandardMaterial as unknown as MeshStandardMaterial,
                );
                if (originalNodeMaterial) {
                    restoreOriginalEmissiveNode(originalNodeMaterial);
                    if (!restoredDowngrades.has(originalStandardMaterial as unknown as MeshStandardMaterial)) {
                        restoredDowngrades.add(originalStandardMaterial as unknown as MeshStandardMaterial);
                        downgradedStandardMaterials.delete(originalNodeMaterial);
                        originalNodeMaterialsByDowngrade.delete(
                            originalStandardMaterial as unknown as MeshStandardMaterial,
                        );
                        (originalStandardMaterial as unknown as MeshStandardMaterial).dispose();
                    }
                    return originalNodeMaterial;
                }

                return originalStandardMaterial;
            }

            if (!visitedMaterials.has(material)) {
                visitedMaterials.add(material);
                restoreOriginalEmissiveNode(material);
            }

            return material;
        });
    });
}
