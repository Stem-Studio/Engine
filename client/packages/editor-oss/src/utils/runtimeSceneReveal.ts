import type {Object3D, Scene} from "three";

import {SCENE_HELPERS_ROOT_NAME} from "@stem/editor-oss/scene/dynamicRoots";

type RuntimeSceneRevealOptions = {
    enabled?: boolean;
    batchSize?: number;
    batchWeightBudget?: number;
    targetFrameGapMs?: number;
    longFrameCooldownFrames?: number;
    debugLongFrames?: boolean;
    debugLongFrameLimit?: number;
    progressiveInstancedCounts?: boolean;
    progressiveInstancedUploads?: boolean;
    /** Maximum number of render frames an individual instanced mesh may spend ramping. */
    maxInstancedRampFrames?: number;
    rampInstancedCountsBeforeContinuingReveal?: boolean;
    orderByWeight?: boolean;
    instancedInitialCount?: number;
    instancedCountTriangleBudget?: number;
    includeStaticSceneRenderables?: boolean;
    /** Keep dynamic runtime clones out of the staged reveal when the masked
     * warmup already compiled them atomically. */
    includeRuntimeSceneRenderables?: boolean;
    staticSceneTriangleThreshold?: number;
    includeCameraRuntimeRenderables?: boolean;
    initialRevealBatchSize?: number;
    initialRevealWeightBudget?: number;
    maxCooldownDelayMs?: number;
    maxAdaptiveFrameBatchMultiplier?: number;
    /** Hard upper bound for leaving authored objects hidden during reveal. */
    maxRevealDurationMs?: number;
    precompileRevealBatch?: (objects: Object3D[], batch: RevealedBatchSummary[]) => Promise<void> | void;
    precompileRevealBatchNeedsSummary?: boolean;
    yieldBeforePrecompile?: boolean;
};

export type RuntimeSceneRevealStats = {
    enabled: boolean;
    hiddenObjects: number;
    revealedObjects: number;
    batchSize: number;
    batchWeightBudget: number;
    targetFrameGapMs: number;
    longFrameCooldownFrames: number;
    initialRevealBatchSize: number;
    initialRevealWeightBudget: number;
    maxCooldownDelayMs: number;
    maxAdaptiveFrameBatchMultiplier: number;
    maxRevealDurationMs: number;
    orderByWeight: boolean;
    deferredFrames: number;
    lastFrameGapMs: number;
    instancedCountRamps: number;
    instancedCountRampFrames: number;
    staticSceneHiddenObjects: number;
    initialRevealedObjects: number;
    maxInstancedRampFrames: number;
    forcedCompletions: number;
};

export type RuntimeSceneRevealController = {
    stats: RuntimeSceneRevealStats;
    beforeRender(): void;
    revealInitialFrame(): Promise<void>;
    start(): void;
    restore(): void;
};

type RenderableObject = Object3D & {
    isMesh?: boolean;
    isInstancedMesh?: boolean;
    isPoints?: boolean;
    isLine?: boolean;
    isSprite?: boolean;
    count?: number;
    instanceColor?: BufferAttributeLike | null;
    instanceMatrix?: BufferAttributeLike;
    geometry?: {
        index?: {count?: number} | null;
        getAttribute?: (name: string) => {count?: number} | undefined;
    };
    material?: unknown;
};

type BufferAttributeLike = {
    count?: number;
    itemSize?: number;
    clearUpdateRanges?: () => void;
    addUpdateRange?: (start: number, count: number) => void;
    needsUpdate?: boolean;
};

const DEFAULT_REVEAL_BATCH_SIZE = 2;
const DEFAULT_REVEAL_BATCH_WEIGHT_BUDGET = 2;
const DEFAULT_REVEAL_TARGET_FRAME_GAP_MS = 100;
const DEFAULT_REVEAL_LONG_FRAME_COOLDOWN_FRAMES = 12;
// Keep the first paint bounded. The remainder is scheduled after the initial
// frame by `start()`, so large Playground scenes do not pay an O(scene) reveal
// and shader-warmup cost before the renderer can show anything.
const DEFAULT_INITIAL_REVEAL_BATCH_SIZE = 2;
const DEFAULT_INITIAL_REVEAL_WEIGHT_BUDGET = 2;
const DEFAULT_REVEAL_MAX_COOLDOWN_DELAY_MS = 250;
const DEFAULT_REVEAL_MAX_ADAPTIVE_FRAME_BATCH_MULTIPLIER = 12;
const DEFAULT_REVEAL_MAX_DURATION_MS = 8_000;
// Large authored scenes need enough work per frame to finish inside the
// bounded reveal window. Keep small scenes conservative, but avoid spending
// the entire window on one or two low-cost renderables at a time.
const LARGE_REVEAL_OBJECT_THRESHOLD = 256;
const LARGE_REVEAL_BATCH_SIZE = 8;
const LARGE_REVEAL_BATCH_WEIGHT_BUDGET = 8;
const DEFAULT_REVEAL_INSTANCED_INITIAL_COUNT = 1;
const DEFAULT_REVEAL_INSTANCED_COUNT_TRIANGLE_BUDGET = 250;
// A one-instance-per-frame ramp is visually smooth but can starve the rest of
// a large scene for seconds. Keep progressive ramps bounded; meshes that would
// exceed this budget reveal at their authored count in one frame instead.
const DEFAULT_REVEAL_MAX_INSTANCED_RAMP_FRAMES = 24;
const DEFAULT_STATIC_SCENE_REVEAL_TRIANGLE_THRESHOLD = 1_024;
const INSTANCED_COUNT_RAMP_COOLDOWN_WEIGHT = DEFAULT_REVEAL_LONG_FRAME_COOLDOWN_FRAMES;
// The wall-clock fallback must preserve completeness without turning the
// entire hidden scene into one synchronous render callback. Keep the recovery
// path bounded just like normal reveal work; this is especially important for
// large authored scenes with hundreds of runtime renderables.
const DEFAULT_FORCED_COMPLETION_BATCH_SIZE = 64;
const DEFAULT_FORCED_COMPLETION_RAMP_BATCH_SIZE = 16;
export const RUNTIME_SCENE_REVEAL_PENDING_KEY = "_runtimeSceneRevealPending";
const RUNTIME_SCENE_REVEAL_ACTIVE_KEY = "_runtimeSceneRevealActive";

const CUSTOM_TSL_MATERIAL_KEYS = [
    "colorNode",
    "opacityNode",
    "normalNode",
    "emissiveNode",
    "positionNode",
    "metalnessNode",
    "roughnessNode",
    "fragmentNode",
    "vertexNode",
    "outputNode",
];

type HiddenRevealEntry = {
    object: Object3D;
    weight: number;
    order?: number;
    targetInstancedCount?: number;
    source: "runtime" | "static";
};

type InstancedCountRampEntry = {
    object: RenderableObject;
    targetCount: number;
    weight: number;
};

type RevealedBatchSummary = {
    uuid: string;
    name: string;
    type: string;
    parentName: string | null;
    runtimeRootName: string | null;
    weight: number;
    triangles: number;
    materialType: string;
    instanceCount: number;
    targetInstanceCount?: number;
    userDataKeys: string[];
};

type RevealBatchWeightSummary = Pick<RevealedBatchSummary, "weight">;

type RuntimeSceneRevealFrameRecord = {
    startedAt: number;
    endedAt: number;
    durationMs: number;
    action: string;
    frameGapMs: number;
    revealedDelta: number;
    deferredDelta: number;
    active: boolean;
};

type RuntimeSceneRevealGlobal = typeof globalThis & {
    __STEM_RUNTIME_REVEAL_FRAME_HISTORY__?: RuntimeSceneRevealFrameRecord[];
};

function recordRuntimeSceneRevealFrame(record: RuntimeSceneRevealFrameRecord): void {
    const globalRecord = globalThis as RuntimeSceneRevealGlobal;
    const history = Array.isArray(globalRecord.__STEM_RUNTIME_REVEAL_FRAME_HISTORY__)
        ? globalRecord.__STEM_RUNTIME_REVEAL_FRAME_HISTORY__
        : [];
    history.push(record);
    if (history.length > 160) {
        history.splice(0, history.length - 160);
    }
    globalRecord.__STEM_RUNTIME_REVEAL_FRAME_HISTORY__ = history;
}

function isCameraLike(object: Object3D): boolean {
    const candidate = object as Object3D & {isPerspectiveCamera?: boolean; isOrthographicCamera?: boolean};
    return candidate.isPerspectiveCamera === true || candidate.isOrthographicCamera === true;
}

function isRenderableObject(object: Object3D): object is RenderableObject {
    const candidate = object as RenderableObject;
    return (
        candidate.isMesh === true ||
        candidate.isPoints === true ||
        candidate.isLine === true ||
        candidate.isSprite === true
    );
}

function isExcludedRuntimeRoot(object: Object3D): boolean {
    return (
        object.name === SCENE_HELPERS_ROOT_NAME ||
        object.userData?.isSceneHelper === true ||
        object.userData?.isSceneHelperRoot === true
    );
}

function hasEnabledBehavior(object: Object3D): boolean {
    const behaviors = object.userData?.behaviors;
    return Array.isArray(behaviors) && behaviors.some(behavior => behavior?.enabled !== false);
}

function isRevealExcludedObject(object: Object3D): boolean {
    return object.userData?.excludeRuntimeSceneReveal === true ||
        object.userData?.runtimeSceneReveal === false;
}

function hasCustomNodeMaterial(material: unknown): boolean {
    const materials = Array.isArray(material) ? material : [material];
    return materials.some(entry => {
        if (!entry || typeof entry !== "object") {
            return false;
        }
        const record = entry as Record<string, unknown>;
        if (record.isNodeMaterial === true) {
            return true;
        }
        return CUSTOM_TSL_MATERIAL_KEYS.some(key => record[key] != null);
    });
}

function estimateBaseTriangles(object: RenderableObject): number {
    const geometry = object.geometry;
    const indexCount = geometry?.index?.count;
    if (typeof indexCount === "number" && Number.isFinite(indexCount) && indexCount > 0) {
        return Math.floor(indexCount / 3);
    }

    const positionCount = geometry?.getAttribute?.("position")?.count;
    return typeof positionCount === "number" && Number.isFinite(positionCount) && positionCount > 0
        ? Math.floor(positionCount / 3)
        : 0;
}

function estimateSubmittedTriangles(object: RenderableObject): number {
    const baseTriangles = estimateBaseTriangles(object);
    const instanceCount =
        object.isInstancedMesh === true && typeof object.count === "number" && Number.isFinite(object.count)
            ? Math.max(1, object.count)
            : 1;

    return baseTriangles * instanceCount;
}

function estimateRevealWeight(object: RenderableObject): number {
    let weight = 1;

    if (hasCustomNodeMaterial(object.material)) {
        weight += 2;
    }

    if (object.isInstancedMesh === true) {
        weight += 4;
    }

    const triangles = estimateSubmittedTriangles(object);
    if (triangles >= 1_000_000) {
        weight += 8;
    } else if (triangles >= 200_000) {
        weight += 4;
    } else if (triangles >= 20_000) {
        weight += 2;
    } else if (triangles >= 256) {
        weight += 1;
    }

    return weight;
}

function compareHiddenRevealEntriesByWeight(a: HiddenRevealEntry, b: HiddenRevealEntry): number {
    return a.weight - b.weight || (a.order ?? 0) - (b.order ?? 0);
}

function getMaterialType(material: unknown): string {
    const firstMaterial = Array.isArray(material) ? material[0] : material;
    return firstMaterial && typeof firstMaterial === "object" && "type" in firstMaterial
        ? String((firstMaterial as {type?: unknown}).type ?? "unknown")
        : "unknown";
}

function getRuntimeRootName(object: Object3D): string | null {
    let current: Object3D | null = object;
    let runtimeRootName: string | null = null;
    while (current) {
        if (current.userData?.isRuntimeOnly === true && current.name) {
            runtimeRootName = current.name;
        }
        current = current.parent;
    }
    return runtimeRootName;
}

function describeRevealEntry(entry: HiddenRevealEntry, detailed = true): RevealedBatchSummary {
    const object = entry.object as RenderableObject;
    if (!detailed) {
        return {
            uuid: object.uuid,
            name: object.name || object.uuid,
            type: object.type,
            parentName: null,
            runtimeRootName: null,
            weight: entry.weight,
            triangles: 0,
            materialType: "unknown",
            instanceCount: 1,
            targetInstanceCount: entry.targetInstancedCount,
            userDataKeys: [],
        };
    }

    return {
        uuid: object.uuid,
        name: object.name || object.uuid,
        type: object.type,
        parentName: object.parent?.name || object.parent?.uuid || null,
        runtimeRootName: getRuntimeRootName(object),
        weight: entry.weight,
        triangles: estimateSubmittedTriangles(object),
        materialType: getMaterialType(object.material),
        instanceCount: object.isInstancedMesh === true && typeof object.count === "number" ? object.count : 1,
        targetInstanceCount: entry.targetInstancedCount,
        userDataKeys: Object.keys(object.userData ?? {}).sort().slice(0, 12),
    };
}

function describeInstancedRampEntry(entry: InstancedCountRampEntry): RevealedBatchSummary {
    return describeRevealEntry({
        object: entry.object,
        weight: entry.weight,
        source: "runtime",
    });
}

function getBatchCooldownFrames(
    frameGap: number,
    targetFrameGapMs: number,
    longFrameCooldownFrames: number,
    batchSummary: RevealBatchWeightSummary[],
): number {
    const framePressure = Math.ceil(frameGap / targetFrameGapMs);
    const batchWeight = batchSummary.reduce((maxWeight, entry) => Math.max(maxWeight, entry.weight), 1);
    return Math.min(longFrameCooldownFrames, Math.max(1, framePressure, batchWeight));
}

function getAdaptiveFrameBatchMultiplier(
    frameGap: number,
    targetFrameGapMs: number,
    maxAdaptiveFrameBatchMultiplier: number,
): number {
    if (
        frameGap <= targetFrameGapMs ||
        maxAdaptiveFrameBatchMultiplier <= 1
    ) {
        return 1;
    }

    return Math.min(
        maxAdaptiveFrameBatchMultiplier,
        Math.max(1, Math.floor(frameGap / targetFrameGapMs)),
    );
}

function positiveInteger(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0
        ? Math.floor(value)
        : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
        ? Math.floor(value)
        : fallback;
}

function positiveNumber(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0
        ? value
        : fallback;
}

function nowForReveal(timestamp?: number): number {
    if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
        return timestamp;
    }

    return typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
}

function yieldToNextTask(): Promise<void> {
    if (typeof setTimeout !== "function") {
        return Promise.resolve();
    }

    return new Promise(resolve => setTimeout(resolve, 0));
}

function markInstanceUploadRange(
    attribute: BufferAttributeLike | null | undefined,
    startInstance: number,
    endInstance: number,
): void {
    if (
        !attribute ||
        typeof attribute.itemSize !== "number" ||
        attribute.itemSize <= 0 ||
        typeof attribute.clearUpdateRanges !== "function" ||
        typeof attribute.addUpdateRange !== "function"
    ) {
        return;
    }

    const attributeInstances = Number.isFinite(attribute.count) ? attribute.count! : endInstance;
    const start = Math.max(0, Math.min(
        Math.floor(startInstance),
        attributeInstances,
    ));
    const end = Math.max(start, Math.min(
        Math.floor(endInstance),
        attributeInstances,
    ));
    const activeComponents = (end - start) * attribute.itemSize;

    attribute.clearUpdateRanges();
    if (activeComponents > 0) {
        attribute.addUpdateRange(start * attribute.itemSize, activeComponents);
        attribute.needsUpdate = true;
    }
}

function markInstancedActiveUploadRanges(
    object: RenderableObject,
    startCount = 0,
    endCount = object.count,
): void {
    if (
        object.isInstancedMesh !== true ||
        typeof startCount !== "number" ||
        typeof endCount !== "number" ||
        !Number.isFinite(startCount) ||
        !Number.isFinite(endCount)
    ) {
        return;
    }

    markInstanceUploadRange(object.instanceMatrix, startCount, endCount);
    markInstanceUploadRange(object.instanceColor, startCount, endCount);
}

function setRuntimeSceneRevealActive(scene: Scene, active: boolean): void {
    if (active) {
        delete scene.userData[RUNTIME_SCENE_REVEAL_PENDING_KEY];
        scene.userData[RUNTIME_SCENE_REVEAL_ACTIVE_KEY] = true;
        return;
    }

    delete scene.userData[RUNTIME_SCENE_REVEAL_ACTIVE_KEY];
    delete scene.userData[RUNTIME_SCENE_REVEAL_PENDING_KEY];
}

export function markRuntimeSceneRevealPending(scene: Scene): void {
    scene.userData[RUNTIME_SCENE_REVEAL_PENDING_KEY] = true;
}

export function clearRuntimeSceneRevealPending(scene: Scene): void {
    delete scene.userData[RUNTIME_SCENE_REVEAL_PENDING_KEY];
}

export function isRuntimeSceneRevealPendingOrActive(scene: Scene): boolean {
    return (
        scene.userData?.[RUNTIME_SCENE_REVEAL_PENDING_KEY] === true ||
        scene.userData?.[RUNTIME_SCENE_REVEAL_ACTIVE_KEY] === true
    );
}

export function prepareRuntimeSceneReveal(
    scene: Scene,
    options: RuntimeSceneRevealOptions = {},
): RuntimeSceneRevealController {
    const enabled = options.enabled !== false;
    const hasBatchSizeOverride = options.batchSize !== undefined;
    const hasBatchWeightBudgetOverride = options.batchWeightBudget !== undefined;
    let batchSize = positiveInteger(options.batchSize, DEFAULT_REVEAL_BATCH_SIZE);
    let batchWeightBudget = positiveInteger(options.batchWeightBudget, DEFAULT_REVEAL_BATCH_WEIGHT_BUDGET);
    const targetFrameGapMs = positiveNumber(options.targetFrameGapMs, DEFAULT_REVEAL_TARGET_FRAME_GAP_MS);
    const longFrameCooldownFrames = nonNegativeInteger(
        options.longFrameCooldownFrames,
        DEFAULT_REVEAL_LONG_FRAME_COOLDOWN_FRAMES,
    );
    const initialRevealBatchSize = positiveInteger(
        options.initialRevealBatchSize,
        DEFAULT_INITIAL_REVEAL_BATCH_SIZE,
    );
    const initialRevealWeightBudget = positiveInteger(
        options.initialRevealWeightBudget,
        DEFAULT_INITIAL_REVEAL_WEIGHT_BUDGET,
    );
    const maxCooldownDelayMs = nonNegativeInteger(
        options.maxCooldownDelayMs,
        DEFAULT_REVEAL_MAX_COOLDOWN_DELAY_MS,
    );
    const maxAdaptiveFrameBatchMultiplier = positiveInteger(
        options.maxAdaptiveFrameBatchMultiplier,
        DEFAULT_REVEAL_MAX_ADAPTIVE_FRAME_BATCH_MULTIPLIER,
    );
    const maxRevealDurationMs = positiveNumber(
        options.maxRevealDurationMs,
        DEFAULT_REVEAL_MAX_DURATION_MS,
    );
    const debugLongFrames = options.debugLongFrames === true;
    const debugLongFrameLimit = nonNegativeInteger(options.debugLongFrameLimit, 12);
    const progressiveInstancedCounts = options.progressiveInstancedCounts !== false;
    const progressiveInstancedUploads = options.progressiveInstancedUploads === true;
    const maxInstancedRampFrames = positiveInteger(
        options.maxInstancedRampFrames,
        DEFAULT_REVEAL_MAX_INSTANCED_RAMP_FRAMES,
    );
    const rampInstancedCountsBeforeContinuingReveal = options.rampInstancedCountsBeforeContinuingReveal === true;
    const orderByWeight = options.orderByWeight === true;
    const instancedInitialCount = positiveInteger(
        options.instancedInitialCount,
        DEFAULT_REVEAL_INSTANCED_INITIAL_COUNT,
    );
    const instancedCountTriangleBudget = positiveNumber(
        options.instancedCountTriangleBudget,
        DEFAULT_REVEAL_INSTANCED_COUNT_TRIANGLE_BUDGET,
    );
    const precompileRevealBatch = options.precompileRevealBatch;
    const yieldBeforePrecompile = options.yieldBeforePrecompile === true;
    const includeStaticSceneRenderables = options.includeStaticSceneRenderables === true;
    const includeRuntimeSceneRenderables = options.includeRuntimeSceneRenderables !== false;
    const includeCameraRuntimeRenderables = options.includeCameraRuntimeRenderables === true;
    const staticSceneTriangleThreshold = positiveInteger(
        options.staticSceneTriangleThreshold,
        DEFAULT_STATIC_SCENE_REVEAL_TRIANGLE_THRESHOLD,
    );
    const detailedBatchSummaries =
        debugLongFrames || (precompileRevealBatch != null && options.precompileRevealBatchNeedsSummary !== false);
    const hiddenObjects: HiddenRevealEntry[] = [];
    const hiddenSet = new WeakSet<Object3D>();
    const instancedCountRampQueue: InstancedCountRampEntry[] = [];
    const instancedCountRampSet = new WeakSet<Object3D>();
    const managedInstancedObjects = new Set<RenderableObject>();
    const desiredInstancedCounts = new WeakMap<Object3D, number>();
    const renderedInstancedCounts = new WeakMap<Object3D, number>();
    const uploadedInstancedCounts = new WeakMap<Object3D, number>();
    const requireRenderAcknowledgement = typeof requestAnimationFrame === "function";
    let rafHandle: number | null = null;
    let revealIndex = 0;
    let lastRevealFrameTime: number | null = null;
    let cooldownFramesRemaining = 0;
    let cooldownStartedAt: number | null = null;
    let lastBatchSummary: RevealBatchWeightSummary[] = [];
    let lastBatchWasInstancedCountRamp = false;
    let longFrameLogCount = 0;
    let restoreGeneration = 0;
    let initialRevealFrameConsumed = false;
    let revealStartedAt: number | null = null;
    let forcedCompletionActive = false;

    const stats: RuntimeSceneRevealStats = {
        enabled,
        hiddenObjects: 0,
        revealedObjects: 0,
        batchSize,
        batchWeightBudget,
        targetFrameGapMs,
        longFrameCooldownFrames,
        initialRevealBatchSize,
        initialRevealWeightBudget,
        maxCooldownDelayMs,
        maxAdaptiveFrameBatchMultiplier,
        maxRevealDurationMs,
        orderByWeight,
        deferredFrames: 0,
        lastFrameGapMs: 0,
        instancedCountRamps: 0,
        instancedCountRampFrames: 0,
        staticSceneHiddenObjects: 0,
        initialRevealedObjects: 0,
        maxInstancedRampFrames,
        forcedCompletions: 0,
    };

    const getTargetInstancedCount = (object: RenderableObject): number | undefined => {
        if (
            !progressiveInstancedCounts ||
            object.isInstancedMesh !== true ||
            typeof object.count !== "number" ||
            !Number.isFinite(object.count) ||
            object.count <= instancedInitialCount
        ) {
            return undefined;
        }

        const targetCount = Math.floor(object.count);
        const baseTriangles = estimateBaseTriangles(object);
        const step = baseTriangles > 0
            ? Math.max(1, Math.floor(instancedCountTriangleBudget / baseTriangles))
            : instancedInitialCount;
        const rampFrames = Math.ceil(Math.max(0, targetCount - instancedInitialCount) / step);
        return rampFrames <= maxInstancedRampFrames ? targetCount : undefined;
    };

    const getInstancedCountStep = (object: RenderableObject): number => {
        const baseTriangles = estimateBaseTriangles(object);
        if (baseTriangles <= 0) {
            return instancedInitialCount;
        }

        return Math.max(1, Math.floor(instancedCountTriangleBudget / baseTriangles));
    };

    const resolveLiveTargetInstancedCount = (entry: HiddenRevealEntry, renderable: RenderableObject): number | undefined => {
        if (entry.targetInstancedCount != null) {
            return entry.targetInstancedCount;
        }

        const liveTargetCount = getTargetInstancedCount(renderable);
        if (liveTargetCount == null) {
            return undefined;
        }

        entry.targetInstancedCount = liveTargetCount;
        return liveTargetCount;
    };

    const setManagedInstancedCount = (
        object: RenderableObject,
        count: number,
        uploadThroughCount = count,
    ): void => {
        object.count = count;
        desiredInstancedCounts.set(object, count);
        managedInstancedObjects.add(object);
        const previousUploadedCount = uploadedInstancedCounts.get(object) ?? 0;
        const nextUploadedCount = Math.max(count, uploadThroughCount);
        if (nextUploadedCount > previousUploadedCount) {
            markInstancedActiveUploadRanges(object, previousUploadedCount, nextUploadedCount);
            uploadedInstancedCounts.set(object, nextUploadedCount);
        }
    };

    const clearManagedInstancedCount = (object: Object3D): void => {
        desiredInstancedCounts.delete(object);
        renderedInstancedCounts.delete(object);
        uploadedInstancedCounts.delete(object);
        managedInstancedObjects.delete(object as RenderableObject);
    };

    const hasPendingManagedInstancedRenderAcknowledgement = (): boolean => {
        if (!requireRenderAcknowledgement) {
            return false;
        }

        for (const object of managedInstancedObjects) {
            if (!object.visible) {
                continue;
            }

            const desiredCount = desiredInstancedCounts.get(object);
            if (desiredCount != null && renderedInstancedCounts.get(object) !== desiredCount) {
                return true;
            }
        }

        return false;
    };

    const maybeCompleteReveal = (): boolean => {
        if (
            revealIndex < hiddenObjects.length ||
            instancedCountRampQueue.length > 0 ||
            hasPendingManagedInstancedRenderAcknowledgement()
        ) {
            return false;
        }

        if (rafHandle !== null && typeof cancelAnimationFrame === "function") {
            cancelAnimationFrame(rafHandle);
            rafHandle = null;
        }

        setRuntimeSceneRevealActive(scene, false);
        managedInstancedObjects.clear();
        return true;
    };

    const forceCompleteReveal = (): boolean => {
        if (!forcedCompletionActive) {
            forcedCompletionActive = true;
            stats.forcedCompletions += 1;
        }

        let completedEntries = 0;
        while (
            revealIndex < hiddenObjects.length &&
            completedEntries < DEFAULT_FORCED_COMPLETION_BATCH_SIZE
        ) {
            const entry = hiddenObjects[revealIndex++];
            if (!entry) continue;

            if (hiddenSet.has(entry.object)) {
                entry.object.visible = true;
                hiddenSet.delete(entry.object);
                stats.revealedObjects += 1;
            }
            if (entry.targetInstancedCount != null) {
                restoreTargetInstancedCount(entry);
            }
            completedEntries += 1;
        }

        let completedRamps = 0;
        while (
            instancedCountRampQueue.length > 0 &&
            completedRamps < DEFAULT_FORCED_COMPLETION_RAMP_BATCH_SIZE
        ) {
            const entry = instancedCountRampQueue.shift();
            if (!entry) continue;
            instancedCountRampSet.delete(entry.object);
            restoreRampTargetInstancedCount(entry);
            completedRamps += 1;
        }

        if (revealIndex >= hiddenObjects.length && instancedCountRampQueue.length === 0) {
            forcedCompletionActive = false;
            maybeCompleteReveal();
            return true;
        }

        return false;
    };

    const enforceManagedInstancedCounts = (): void => {
        for (const object of managedInstancedObjects) {
            const desiredCount = desiredInstancedCounts.get(object);
            if (
                desiredCount == null ||
                object.isInstancedMesh !== true ||
                typeof object.count !== "number"
            ) {
                continue;
            }

            if (object.count !== desiredCount) {
                object.count = desiredCount;
                setManagedInstancedCount(object, desiredCount);
            }

            if (object.visible) {
                renderedInstancedCounts.set(object, desiredCount);
            }
        }
    };

    const stageInitialInstancedCount = (entry: HiddenRevealEntry): void => {
        const renderable = entry.object as RenderableObject;
        const targetInstancedCount = resolveLiveTargetInstancedCount(entry, renderable);
        if (
            targetInstancedCount == null ||
            renderable.isInstancedMesh !== true ||
            typeof renderable.count !== "number"
        ) {
            return;
        }

        setManagedInstancedCount(
            renderable,
            Math.min(targetInstancedCount, instancedInitialCount),
            progressiveInstancedUploads ? undefined : targetInstancedCount,
        );
    };

    const restoreTargetInstancedCount = (entry: HiddenRevealEntry): void => {
        const renderable = entry.object as RenderableObject;
        if (
            entry.targetInstancedCount == null ||
            renderable.isInstancedMesh !== true ||
            typeof renderable.count !== "number"
        ) {
            return;
        }

        clearManagedInstancedCount(renderable);
        renderable.count = entry.targetInstancedCount;
        markInstancedActiveUploadRanges(renderable, 0, entry.targetInstancedCount);
    };

    const restoreRampTargetInstancedCount = (entry: InstancedCountRampEntry): void => {
        const renderable = entry.object;
        if (
            renderable.isInstancedMesh !== true ||
            typeof renderable.count !== "number" ||
            !Number.isFinite(entry.targetCount)
        ) {
            return;
        }

        clearManagedInstancedCount(renderable);
        renderable.count = entry.targetCount;
        markInstancedActiveUploadRanges(renderable, 0, entry.targetCount);
    };

    const shouldRevealStaticRenderable = (object: Object3D, underBehaviorObject: boolean): boolean => {
        if (
            !includeStaticSceneRenderables ||
            underBehaviorObject ||
            isRevealExcludedObject(object) ||
            object.userData?.isRuntimeOnly === true ||
            !isRenderableObject(object)
        ) {
            return false;
        }

        if (object.isInstancedMesh === true || hasCustomNodeMaterial(object.material)) {
            return true;
        }

        return estimateSubmittedTriangles(object) >= staticSceneTriangleThreshold;
    };

    if (enabled) {
        type RevealTraversalEntry = {
            object: Object3D;
            runtimeVisualSubtree: boolean;
            excluded: boolean;
            underCamera: boolean;
            underBehaviorObject: boolean;
        };
        const traversalStack: RevealTraversalEntry[] = [];
        for (let i = scene.children.length - 1; i >= 0; i -= 1) {
            const child = scene.children[i];
            if (child) {
                traversalStack.push({
                    object: child,
                    runtimeVisualSubtree: false,
                    excluded: false,
                    underCamera: false,
                    underBehaviorObject: false,
                });
            }
        }

        // Use an explicit stack rather than Object3D.traverse/recursion. The
        // editor accepts deeply generated creator scenes, and reveal prep must
        // remain stack-safe while preserving the original depth-first order.
        while (traversalStack.length > 0) {
            const entry = traversalStack.pop();
            if (!entry) continue;

            const {object, runtimeVisualSubtree, excluded, underCamera, underBehaviorObject} = entry;
            const nextExcluded = excluded || isExcludedRuntimeRoot(object) || isRevealExcludedObject(object);
            const nextUnderCamera = underCamera || isCameraLike(object);
            const nextUnderBehaviorObject = underBehaviorObject || hasEnabledBehavior(object);
            const nextRuntimeVisualSubtree = runtimeVisualSubtree || object.userData?.isRuntimeOnly === true;
            const source =
                nextRuntimeVisualSubtree && includeRuntimeSceneRenderables
                    ? "runtime"
                    : shouldRevealStaticRenderable(object, nextUnderBehaviorObject)
                        ? "static"
                        : null;

            if (
                source &&
                !nextExcluded &&
                (!nextUnderCamera || includeCameraRuntimeRenderables) &&
                object.visible &&
                isRenderableObject(object)
            ) {
                object.visible = false;
                hiddenObjects.push({
                    object,
                    weight: estimateRevealWeight(object),
                    order: hiddenObjects.length,
                    targetInstancedCount: getTargetInstancedCount(object),
                    source,
                });
                if (source === "static") {
                    stats.staticSceneHiddenObjects += 1;
                }
                hiddenSet.add(object);
            }

            for (let i = object.children.length - 1; i >= 0; i -= 1) {
                const child = object.children[i];
                if (child) {
                    traversalStack.push({
                        object: child,
                        runtimeVisualSubtree: nextRuntimeVisualSubtree,
                        excluded: nextExcluded,
                        underCamera: nextUnderCamera,
                        underBehaviorObject: nextUnderBehaviorObject,
                    });
                }
            }
        }
        if (orderByWeight) {
            hiddenObjects.sort(compareHiddenRevealEntriesByWeight);
        }
        if (hiddenObjects.length >= LARGE_REVEAL_OBJECT_THRESHOLD) {
            if (!hasBatchSizeOverride) {
                batchSize = Math.max(batchSize, LARGE_REVEAL_BATCH_SIZE);
            }
            if (!hasBatchWeightBudgetOverride) {
                batchWeightBudget = Math.max(batchWeightBudget, LARGE_REVEAL_BATCH_WEIGHT_BUDGET);
            }
            stats.batchSize = batchSize;
            stats.batchWeightBudget = batchWeightBudget;
        }
        stats.hiddenObjects = hiddenObjects.length;
    }
    setRuntimeSceneRevealActive(scene, enabled && hiddenObjects.length > 0);

    const scheduleRevealFrame = (): void => {
        if (maybeCompleteReveal()) {
            return;
        }

        if (
            (revealIndex < hiddenObjects.length || instancedCountRampQueue.length > 0) &&
            typeof requestAnimationFrame === "function"
        ) {
            rafHandle = requestAnimationFrame(revealBatch);
        }
    };

    const revealBatch = (timestamp?: number): void => {
        void revealBatchAsync(timestamp, false);
    };

    const revealBatchAsync = async (timestamp?: number, initialRevealFrame = false): Promise<void> => {
        const revealWorkStart = nowForReveal();
        const revealedBeforeFrame = stats.revealedObjects;
        const deferredBeforeFrame = stats.deferredFrames;
        const scheduleRevealFrameIfNeeded = (): void => {
            if (maybeCompleteReveal()) {
                return;
            }

            if (!initialRevealFrame) {
                scheduleRevealFrame();
            }
        };
        let revealFrameAction = "idle";
        if (!initialRevealFrame) {
            rafHandle = null;
        }

        try {
            const now = nowForReveal(timestamp);
            revealStartedAt = revealStartedAt ?? now;
            const generation = restoreGeneration;
            let adaptiveFrameBatchMultiplier = 1;
            if (lastRevealFrameTime !== null) {
                const frameGap = Math.max(0, now - lastRevealFrameTime);
                stats.lastFrameGapMs = Math.round(frameGap);
                adaptiveFrameBatchMultiplier = getAdaptiveFrameBatchMultiplier(
                    frameGap,
                    targetFrameGapMs,
                    maxAdaptiveFrameBatchMultiplier,
                );
                if (lastBatchSummary.length > 0) {
                    const baseCooldownFrames = getBatchCooldownFrames(
                        frameGap,
                        targetFrameGapMs,
                        longFrameCooldownFrames,
                        lastBatchSummary,
                    );
                    if (
                        !initialRevealFrame &&
                        frameGap > targetFrameGapMs &&
                        longFrameCooldownFrames > 0 &&
                        (maxCooldownDelayMs === 0 || frameGap <= maxCooldownDelayMs)
                    ) {
                        if (debugLongFrames && longFrameLogCount < debugLongFrameLimit) {
                            longFrameLogCount += 1;
                            console.debug("[RuntimeSceneReveal] Long frame after reveal batch", JSON.stringify({
                                frameGapMs: Math.round(frameGap),
                                instancedCountRamp: lastBatchWasInstancedCountRamp,
                                batch: lastBatchSummary,
                            }));
                        }
                        cooldownFramesRemaining = Math.max(
                            cooldownFramesRemaining,
                            baseCooldownFrames,
                        );
                        cooldownStartedAt = cooldownStartedAt ?? now;
                    }
                    lastBatchSummary = [];
                    lastBatchWasInstancedCountRamp = false;
                }
            }
            lastRevealFrameTime = now;

            if (!initialRevealFrame && forcedCompletionActive) {
                revealFrameAction = "force-complete-batch";
                if (!forceCompleteReveal()) {
                    scheduleRevealFrameIfNeeded();
                }
                return;
            }

            if (
                !initialRevealFrame &&
                revealStartedAt !== null &&
                now - revealStartedAt >= maxRevealDurationMs &&
                (revealIndex < hiddenObjects.length || instancedCountRampQueue.length > 0)
            ) {
                revealFrameAction = "force-complete";
                if (!forceCompleteReveal()) {
                    scheduleRevealFrameIfNeeded();
                }
                return;
            }

            if (
                !initialRevealFrame &&
                cooldownFramesRemaining > 0 &&
                (
                    maxCooldownDelayMs === 0 ||
                    cooldownStartedAt === null ||
                    now - cooldownStartedAt < maxCooldownDelayMs
                )
            ) {
                revealFrameAction = "cooldown";
                cooldownFramesRemaining -= 1;
                stats.deferredFrames += 1;
                lastRevealFrameTime = now;
                scheduleRevealFrameIfNeeded();
                return;
            }
            if (cooldownFramesRemaining > 0) {
                cooldownFramesRemaining = 0;
            }
            cooldownStartedAt = null;

            const rampEntry = instancedCountRampQueue[0];
            const shouldProcessRampEntry =
                !!rampEntry &&
                (rampInstancedCountsBeforeContinuingReveal || revealIndex >= hiddenObjects.length);
            // Keep the first-visible pass moving. Large instanced meshes are already
            // visible at a staged count, and ramping them before revealing later
            // objects can starve the rest of the scene.
            if (rampEntry && shouldProcessRampEntry) {
                const managedCount = desiredInstancedCounts.get(rampEntry.object);
                const currentCount =
                    typeof managedCount === "number" && Number.isFinite(managedCount)
                        ? Math.max(0, Math.floor(managedCount))
                        : typeof rampEntry.object.count === "number" && Number.isFinite(rampEntry.object.count)
                            ? Math.max(0, Math.floor(rampEntry.object.count))
                            : rampEntry.targetCount;
                if (!rampEntry.object.visible) {
                    instancedCountRampQueue.shift();
                    instancedCountRampSet.delete(rampEntry.object);
                    restoreRampTargetInstancedCount(rampEntry);
                } else if (
                    requireRenderAcknowledgement &&
                    renderedInstancedCounts.get(rampEntry.object) !== currentCount
                ) {
                    revealFrameAction = "ramp-wait-render";
                    stats.deferredFrames += 1;
                    lastRevealFrameTime = now;
                    scheduleRevealFrameIfNeeded();
                    return;
                } else if (currentCount >= rampEntry.targetCount) {
                    instancedCountRampQueue.shift();
                    instancedCountRampSet.delete(rampEntry.object);
                    clearManagedInstancedCount(rampEntry.object);
                } else {
                    revealFrameAction = "ramp-count";
                    const nextCount = Math.min(
                        rampEntry.targetCount,
                        currentCount + (getInstancedCountStep(rampEntry.object) * adaptiveFrameBatchMultiplier),
                    );
                    setManagedInstancedCount(
                        rampEntry.object,
                        nextCount,
                        progressiveInstancedUploads ? undefined : rampEntry.targetCount,
                    );
                    stats.instancedCountRampFrames += 1;
                    lastBatchSummary = debugLongFrames
                        ? [describeInstancedRampEntry(rampEntry)]
                        : [{weight: rampEntry.weight}];
                    lastBatchWasInstancedCountRamp = true;
                    if (nextCount >= rampEntry.targetCount) {
                        instancedCountRampQueue.shift();
                        instancedCountRampSet.delete(rampEntry.object);
                    }
                    scheduleRevealFrameIfNeeded();
                    return;
                }
            }

            if (revealIndex < hiddenObjects.length) {
                revealFrameAction = initialRevealFrame ? "initial-reveal" : "reveal";
                let revealedThisBatch = 0;
                let weightThisBatch = 0;
                const batchEntries: HiddenRevealEntry[] = [];
                const effectiveBatchSize = initialRevealFrame
                    ? initialRevealBatchSize
                    : batchSize * adaptiveFrameBatchMultiplier;
                const effectiveBatchWeightBudget = initialRevealFrame
                    ? initialRevealWeightBudget
                    : batchWeightBudget * adaptiveFrameBatchMultiplier;

                while (revealIndex < hiddenObjects.length && revealedThisBatch < effectiveBatchSize) {
                    const entry = hiddenObjects[revealIndex];
                    if (!entry) {
                        revealIndex += 1;
                        continue;
                    }

                    if (
                        revealedThisBatch > 0 &&
                        weightThisBatch + entry.weight > effectiveBatchWeightBudget
                    ) {
                        break;
                    }

                    revealIndex += 1;
                    if (hiddenSet.has(entry.object)) {
                        revealedThisBatch += 1;
                        weightThisBatch += entry.weight;
                        batchEntries.push(entry);
                    }
                }

                for (const entry of batchEntries) {
                    stageInitialInstancedCount(entry);
                }

                const needsBatchSummary = detailedBatchSummaries || precompileRevealBatch != null;
                const batchSummary = needsBatchSummary
                    ? batchEntries.map(entry => describeRevealEntry(entry, detailedBatchSummaries))
                    : null;
                if (batchEntries.length > 0 && precompileRevealBatch) {
                    if (yieldBeforePrecompile) {
                        await yieldToNextTask();
                        if (generation !== restoreGeneration) {
                            revealFrameAction = "stale-after-yield";
                            return;
                        }
                    }
                    try {
                        await precompileRevealBatch(
                            batchEntries.map(entry => entry.object),
                            batchSummary ?? [],
                        );
                    } catch (error) {
                        console.warn("[RuntimeSceneReveal] Failed to precompile reveal batch", error);
                    }
                }

                if (generation !== restoreGeneration) {
                    revealFrameAction = "stale";
                    return;
                }

                for (const entry of batchEntries) {
                    if (!hiddenSet.has(entry.object)) {
                        continue;
                    }
                    const renderable = entry.object as RenderableObject;
                    entry.object.visible = true;
                    hiddenSet.delete(entry.object);
                    stats.revealedObjects += 1;
                    if (
                        entry.targetInstancedCount != null &&
                        renderable.isInstancedMesh === true &&
                        typeof renderable.count === "number" &&
                        renderable.count < entry.targetInstancedCount
                    ) {
                        instancedCountRampQueue.push({
                            object: renderable,
                            targetCount: entry.targetInstancedCount,
                            weight: INSTANCED_COUNT_RAMP_COOLDOWN_WEIGHT,
                        });
                        instancedCountRampSet.add(renderable);
                        stats.instancedCountRamps += 1;
                    }
                }

                if (initialRevealFrame) {
                    stats.initialRevealedObjects += stats.revealedObjects - revealedBeforeFrame;
                    lastBatchSummary = [];
                } else {
                    lastBatchSummary = batchSummary ?? batchEntries.map(entry => ({weight: entry.weight}));
                }
                lastBatchWasInstancedCountRamp = false;
                lastRevealFrameTime = now;
                scheduleRevealFrameIfNeeded();
                return;
            }

            if (revealIndex >= hiddenObjects.length && instancedCountRampQueue.length === 0) {
                revealFrameAction = "complete";
                maybeCompleteReveal();
            }
            scheduleRevealFrameIfNeeded();
        } finally {
            const endedAt = nowForReveal();
            if (debugLongFrames) {
                recordRuntimeSceneRevealFrame({
                    startedAt: Math.round(revealWorkStart * 10) / 10,
                    endedAt: Math.round(endedAt * 10) / 10,
                    durationMs: Math.round((endedAt - revealWorkStart) * 10) / 10,
                    action: revealFrameAction,
                    frameGapMs: stats.lastFrameGapMs,
                    revealedDelta: stats.revealedObjects - revealedBeforeFrame,
                    deferredDelta: stats.deferredFrames - deferredBeforeFrame,
                    active: scene.userData?.[RUNTIME_SCENE_REVEAL_ACTIVE_KEY] === true,
                });
            }
        }
    };

    return {
        stats,
        beforeRender(): void {
            enforceManagedInstancedCounts();
            maybeCompleteReveal();
        },
        async revealInitialFrame(): Promise<void> {
            if (
                !enabled ||
                hiddenObjects.length === 0 ||
                initialRevealFrameConsumed ||
                revealIndex >= hiddenObjects.length
            ) {
                return;
            }

            initialRevealFrameConsumed = true;
            await revealBatchAsync(undefined, true);
        },
        start(): void {
            if (!enabled || hiddenObjects.length === 0 || rafHandle !== null) {
                return;
            }

            if (typeof requestAnimationFrame === "function") {
                rafHandle = requestAnimationFrame(revealBatch);
                return;
            }

            while (revealIndex < hiddenObjects.length || instancedCountRampQueue.length > 0) {
                revealBatch();
            }
        },
        restore(): void {
            restoreGeneration += 1;
            forcedCompletionActive = false;
            revealStartedAt = null;
            if (rafHandle !== null && typeof cancelAnimationFrame === "function") {
                cancelAnimationFrame(rafHandle);
                rafHandle = null;
            }

            for (const entry of hiddenObjects) {
                if (
                    entry.targetInstancedCount != null &&
                    (instancedCountRampSet.has(entry.object) || hiddenSet.has(entry.object)) &&
                    (entry.object as RenderableObject).isInstancedMesh === true
                ) {
                    restoreTargetInstancedCount(entry);
                    instancedCountRampSet.delete(entry.object);
                }
                clearManagedInstancedCount(entry.object);
                if (hiddenSet.has(entry.object)) {
                    entry.object.visible = true;
                    hiddenSet.delete(entry.object);
                }
            }
            instancedCountRampQueue.length = 0;
            managedInstancedObjects.clear();
            revealIndex = hiddenObjects.length;
            stats.revealedObjects = hiddenObjects.length;
            setRuntimeSceneRevealActive(scene, false);
        },
    };
}
