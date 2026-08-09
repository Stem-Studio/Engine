import type {BufferGeometry, Object3D, Scene} from "three";

import {traverseObjectDepthFirst} from "./SceneTraverser";

export type RuntimeShadowBudgetConfig = {
    enabled?: boolean;
    maxTriangles?: number;
    maxMeshes?: number;
};

export type RuntimeShadowBudgetOptions = {
    maxTriangles?: number;
    maxMeshes?: number;
    /** Internal capability-gated fallback policy; authored configs remain opt-in. */
    force?: boolean;
    /** Rebuild from authored castShadow state when an explicit policy change requires it. */
    reconsiderHidden?: boolean;
};

export type RuntimeFallbackShadowBudgetOptions = {
    isWebGPU: boolean;
    maxTriangles?: number;
    maxMeshes?: number;
    minEstimatedShadowTriangles?: number;
    minRuntimeShare?: number;
    minRuntimeTriangles?: number;
};

export type RuntimeFallbackShadowBudgetStats = RuntimeShadowBudgetStats & {
    automatic: boolean;
    estimatedShadowTriangles: number;
    runtimeTriangles: number;
    runtimeShare: number;
    cascadeCount: number;
};

export type RuntimeShadowBudgetStats = {
    enabled: boolean;
    maxTriangles: number;
    maxMeshes: number;
    meshesConsidered: number;
    meshesPreserved: number;
    meshesDisabled: number;
    originalTriangles: number;
    retainedTriangles: number;
};

type RuntimeShadowBudgetUserData = {
    isRuntimeOnly?: boolean;
    disableRuntimeShadowBudget?: boolean;
    runtimeShadowPreserve?: boolean;
    runtimeShadowPriority?: number;
};

type ShadowCandidate = {
    object: Object3D & {castShadow?: boolean; isMesh?: boolean; isInstancedMesh?: boolean; count?: number; geometry?: BufferGeometry};
    triangles: number;
    priority: number;
    preserved: boolean;
};

type ShadowCandidateMetrics = {
    totalTriangles: number;
    runtimeTriangles: number;
    cascadeCount: number;
};

const originalCastShadow = new WeakMap<Object3D, boolean>();
// Track only automatic mutations so a later eligibility change can restore
// them without touching an authored/explicit budget. This is intentionally a
// WeakSet: scenes are short-lived runtime owners and must not be retained.
const automaticBudgetAppliedScenes = new WeakSet<Scene>();

function getBudgetConfig(scene: Scene): RuntimeShadowBudgetConfig {
    return scene.userData?.rendering?.runtimeShadowBudget ?? {};
}

function isRuntimeOnly(object: Object3D): boolean {
    let current: Object3D | null = object;
    while (current) {
        if ((current.userData as RuntimeShadowBudgetUserData | undefined)?.isRuntimeOnly === true) {
            return true;
        }
        current = current.parent;
    }
    return false;
}

function isHeroLike(object: Object3D): boolean {
    let current: Object3D | null = object;
    while (current) {
        const userData = getUserData(current);
        const tags = (userData as RuntimeShadowBudgetUserData & {tags?: unknown}).tags;
        const tagged = Array.isArray(tags) && tags.some(tag => String(tag).toLowerCase() === "player" || String(tag).toLowerCase() === "hero");
        const name = current.name.toLowerCase();
        if (tagged || name === "player" || name === "hero" || name.includes("player")) {
            return true;
        }
        current = current.parent;
    }
    return false;
}

function estimateTriangles(object: ShadowCandidate["object"]): number {
    const geometry = object.geometry;
    if (!geometry) {
        return 0;
    }
    const base = geometry.index?.count ?? geometry.getAttribute("position")?.count ?? 0;
    if (!Number.isFinite(base) || base <= 0) {
        return 0;
    }
    const instances = object.isInstancedMesh === true ? Math.max(1, Math.floor(object.count ?? 1)) : 1;
    return Math.max(0, Math.floor((base * instances) / 3));
}

function getUserData(object: Object3D): RuntimeShadowBudgetUserData {
    return (object.userData ?? {}) as RuntimeShadowBudgetUserData;
}

function rememberOriginalCastShadow(object: Object3D, value: boolean): void {
    if (!originalCastShadow.has(object)) {
        originalCastShadow.set(object, value);
    }
}

function getCascadeCount(scene: Scene): number {
    let cascadeCount = 1;
    traverseObjectDepthFirst(scene, object => {
        const candidate = object as Object3D & {
            isDirectionalLight?: boolean;
            shadow?: {shadowNode?: {cascades?: number}};
        };
        if (candidate.isDirectionalLight !== true || !candidate.shadow) return;
        const cascades = Number(candidate.shadow.shadowNode?.cascades);
        if (Number.isFinite(cascades) && cascades > cascadeCount) {
            cascadeCount = Math.floor(cascades);
        }
    });
    return cascadeCount;
}

function collectShadowCandidateMetrics(scene: Scene): ShadowCandidateMetrics {
    let totalTriangles = 0;
    let runtimeTriangles = 0;
    traverseObjectDepthFirst(scene, object => {
        const candidate = object as ShadowCandidate["object"];
        if (candidate.isMesh !== true) return;
        // Once the automatic policy has disabled a caster, its authored
        // `castShadow` value is retained in the WeakMap. Include that
        // baseline in eligibility metrics so stabilization continues to
        // recognize the same runtime-dominated scene without resurrecting the
        // disabled object during the actual budget pass.
        if (candidate.castShadow !== true && originalCastShadow.get(object) !== true) return;
        const triangles = estimateTriangles(candidate);
        if (triangles <= 0) return;
        totalTriangles += triangles;
        if (isRuntimeOnly(object)) runtimeTriangles += triangles;
    });
    return {
        totalTriangles,
        runtimeTriangles,
        cascadeCount: getCascadeCount(scene),
    };
}

export function applyRuntimeShadowBudget(
    scene: Scene,
    options?: RuntimeShadowBudgetOptions,
): RuntimeShadowBudgetStats {
    // Repeated application is expected when a runtime-only root grows after
    // startup. Keep budget-disabled casters disabled by default: gameplay may
    // have intentionally turned them off since the previous pass. An explicit
    // reconsideration is reserved for an authored-policy rebuild.
    if (options?.reconsiderHidden === true) {
        restoreRuntimeShadowBudget(scene);
    }
    const config = getBudgetConfig(scene);
    const forcedPolicy = options?.force === true && config.enabled !== true;
    const maxTriangles = Number(forcedPolicy ? options?.maxTriangles : (config.maxTriangles ?? options?.maxTriangles));
    const maxMeshes = Number(forcedPolicy ? options?.maxMeshes : (config.maxMeshes ?? options?.maxMeshes));
    const enabled = (config.enabled === true || options?.force === true) && (
        (Number.isFinite(maxTriangles) && maxTriangles > 0) ||
        (Number.isFinite(maxMeshes) && maxMeshes > 0)
    );
    const stats: RuntimeShadowBudgetStats = {
        enabled,
        maxTriangles: enabled && Number.isFinite(maxTriangles) && maxTriangles > 0 ? Math.floor(maxTriangles) : 0,
        maxMeshes: enabled && Number.isFinite(maxMeshes) && maxMeshes > 0 ? Math.floor(maxMeshes) : 0,
        meshesConsidered: 0,
        meshesPreserved: 0,
        meshesDisabled: 0,
        originalTriangles: 0,
        retainedTriangles: 0,
    };
    if (!enabled) {
        return stats;
    }

    const candidates: ShadowCandidate[] = [];
    traverseObjectDepthFirst(scene, object => {
        const candidate = object as ShadowCandidate["object"];
        const userData = getUserData(object);
        if (
            candidate.isMesh !== true ||
            candidate.castShadow !== true ||
            !isRuntimeOnly(object) ||
            userData.disableRuntimeShadowBudget === true
        ) {
            return;
        }
        const triangles = estimateTriangles(candidate);
        if (triangles <= 0) {
            return;
        }
        rememberOriginalCastShadow(object, candidate.castShadow === true);
        const priority = Number(userData.runtimeShadowPriority);
        candidates.push({
            object: candidate,
            triangles,
            priority: Number.isFinite(priority) ? priority : 0,
            preserved: userData.runtimeShadowPreserve === true || isHeroLike(object),
        });
        stats.meshesConsidered += 1;
        stats.originalTriangles += triangles;
    });

    candidates.sort((left, right) => {
        if (left.preserved !== right.preserved) return left.preserved ? -1 : 1;
        if (left.priority !== right.priority) return right.priority - left.priority;
        return left.triangles - right.triangles;
    });

    let retainedMeshes = 0;
    let retainedTriangles = 0;
    for (const candidate of candidates) {
        const underMeshBudget = stats.maxMeshes === 0 || retainedMeshes < stats.maxMeshes;
        const underTriangleBudget = stats.maxTriangles === 0 || retainedTriangles + candidate.triangles <= stats.maxTriangles;
        const keep = candidate.preserved || (underMeshBudget && underTriangleBudget);
        if (keep) {
            candidate.object.castShadow = true;
            retainedMeshes += 1;
            retainedTriangles += candidate.triangles;
        } else {
            candidate.object.castShadow = false;
            stats.meshesDisabled += 1;
        }
    }

    stats.meshesPreserved = retainedMeshes;
    stats.retainedTriangles = retainedTriangles;
    return stats;
}

/**
 * Apply a conservative runtime-only shadow cap on WebGL fallback when a
 * cascaded shadow scene is demonstrably dominated by runtime geometry. This
 * never changes authored meshes, is skipped on WebGPU, and remains disabled
 * when a scene explicitly opts out with `runtimeShadowBudget.enabled=false`.
 */
export function applyAutomaticFallbackRuntimeShadowBudget(
    scene: Scene,
    options: RuntimeFallbackShadowBudgetOptions,
): RuntimeFallbackShadowBudgetStats {
    const config = getBudgetConfig(scene);
    const metrics = collectShadowCandidateMetrics(scene);
    const estimatedShadowTriangles = metrics.totalTriangles * metrics.cascadeCount;
    const runtimeShare = metrics.totalTriangles > 0
        ? metrics.runtimeTriangles / metrics.totalTriangles
        : 0;
    const minEstimatedShadowTriangles = Math.max(
        1,
        Math.floor(options.minEstimatedShadowTriangles ?? 500_000),
    );
    const minRuntimeShare = Math.min(1, Math.max(0, options.minRuntimeShare ?? 0.5));
    const minRuntimeTriangles = Math.max(1, Math.floor(options.minRuntimeTriangles ?? 450_000));
    const automatic = options.isWebGPU !== true
        && config.enabled !== false
        && metrics.cascadeCount >= 2
        && estimatedShadowTriangles >= minEstimatedShadowTriangles
        && (runtimeShare >= minRuntimeShare || metrics.runtimeTriangles >= minRuntimeTriangles);

    const disabledStats: RuntimeFallbackShadowBudgetStats = {
        enabled: false,
        automatic: false,
        estimatedShadowTriangles,
        runtimeTriangles: metrics.runtimeTriangles,
        runtimeShare,
        cascadeCount: metrics.cascadeCount,
        maxTriangles: 0,
        maxMeshes: 0,
        meshesConsidered: 0,
        meshesPreserved: 0,
        meshesDisabled: 0,
        originalTriangles: 0,
        retainedTriangles: 0,
    };
    if (!automatic) {
        // Runtime builders can remove geometry or change the cascade setup
        // after the first post-start stabilization pass. If the scene is no
        // longer fallback-dominated, return its runtime casters to their
        // authored state instead of silently degrading shadow quality for the
        // rest of the Play session.
        if (automaticBudgetAppliedScenes.has(scene)) {
            restoreRuntimeShadowBudget(scene);
            automaticBudgetAppliedScenes.delete(scene);
        }
        return disabledStats;
    }

    const stats = applyRuntimeShadowBudget(scene, {
        force: true,
        // Keep the fallback cap low enough to make WebGL viable on dense
        // runtime-built scenes while preserving authored casters and the
        // higher-quality WebGPU path. 100k is the measured quality/perf
        // knee for the 100 Cars fallback fixture; callers can still opt into
        // an explicit scene budget when they need a different trade-off.
        maxTriangles: options.maxTriangles ?? 100_000,
        maxMeshes: options.maxMeshes,
    });
    if (stats.meshesDisabled > 0) {
        automaticBudgetAppliedScenes.add(scene);
    }
    return {
        ...stats,
        automatic: true,
        estimatedShadowTriangles,
        runtimeTriangles: metrics.runtimeTriangles,
        runtimeShare,
        cascadeCount: metrics.cascadeCount,
    };
}

export function restoreRuntimeShadowBudget(scene: Scene): void {
    traverseObjectDepthFirst(scene, object => {
        const original = originalCastShadow.get(object);
        if (original === undefined) {
            return;
        }
        (object as Object3D & {castShadow?: boolean}).castShadow = original;
        originalCastShadow.delete(object);
    });
}
