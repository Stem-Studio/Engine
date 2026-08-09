import type {BufferAttribute, BufferGeometry, InstancedMesh, Object3D, Scene} from "three";

import {
    createProgressiveYieldController,
    type ProgressiveYieldOptions,
} from "./progressiveYield";
import {traverseObjectDepthFirst} from "./SceneTraverser";

type InstancedMeshLike = InstancedMesh & {
    isInstancedMesh?: boolean;
    count: number;
    geometry: BufferGeometry;
    instanceMatrix?: BufferAttribute;
    instanceColor?: BufferAttribute | null;
};

type RuntimeInstancingBudgetConfig = {
    enabled?: boolean;
    maxTotalSubmittedTriangles?: number;
    maxSubmittedTrianglesPerMesh?: number;
    minInstancesPerMesh?: number;
};

export type RuntimeInstancingBudgetStats = {
    enabled: boolean;
    targetTriangles: number;
    maxSubmittedTrianglesPerMesh: number;
    originalSubmittedTriangles: number;
    cappedSubmittedTriangles: number;
    meshesConsidered: number;
    meshesCapped: number;
};

export type RuntimeInstancingBudgetOptions = {
    maxTotalSubmittedTriangles?: number;
    maxSubmittedTrianglesPerMesh?: number;
};

export type RuntimeInstancingBudgetProgressOptions = RuntimeInstancingBudgetOptions & ProgressiveYieldOptions;

type RuntimeInstancingBudgetUserData = {
    isRuntimeOnly?: boolean;
    disableRuntimeInstancingBudget?: boolean;
    runtimeInstancingBudgetOriginalCount?: number;
};

const RUNTIME_INSTANCING_BUDGET_PROGRESS_DEFAULTS = {
    batchSize: 64,
    frameBudgetMs: 4,
};

function getBudgetConfig(scene: Scene): RuntimeInstancingBudgetConfig {
    return scene.userData?.rendering?.instancingBudget ?? {};
}

function estimateGeometryTriangles(geometry: BufferGeometry): number {
    const indexCount = geometry.index?.count;
    if (typeof indexCount === "number" && Number.isFinite(indexCount) && indexCount > 0) {
        return Math.floor(indexCount / 3);
    }

    const positionCount = geometry.getAttribute("position")?.count;
    return typeof positionCount === "number" && Number.isFinite(positionCount) && positionCount > 0
        ? Math.floor(positionCount / 3)
        : 0;
}

function isBudgetedRuntimeInstancedMesh(object: Object3D): object is InstancedMeshLike {
    const candidate = object as InstancedMeshLike;
    const userData = candidate.userData as RuntimeInstancingBudgetUserData | undefined;
    return (
        candidate.isInstancedMesh === true &&
        candidate.visible === true &&
        userData?.isRuntimeOnly === true &&
        userData?.disableRuntimeInstancingBudget !== true &&
        !!candidate.geometry
    );
}

function getOriginalCount(mesh: InstancedMeshLike): number {
    const userData = mesh.userData as RuntimeInstancingBudgetUserData;
    if (Number.isFinite(userData.runtimeInstancingBudgetOriginalCount)) {
        return userData.runtimeInstancingBudgetOriginalCount!;
    }

    userData.runtimeInstancingBudgetOriginalCount = mesh.count;
    return mesh.count;
}

function markActiveInstanceRange(attribute: BufferAttribute | null | undefined, instanceCount: number): void {
    if (!attribute || typeof attribute.itemSize !== "number" || attribute.itemSize <= 0) {
        return;
    }

    const activeInstances = Math.max(0, Math.min(
        Math.floor(instanceCount),
        Number.isFinite(attribute.count) ? attribute.count : instanceCount,
    ));
    const activeComponents = activeInstances * attribute.itemSize;

    attribute.clearUpdateRanges();
    if (activeComponents > 0) {
        attribute.addUpdateRange(0, activeComponents);
    }
    attribute.needsUpdate = true;
}

function markActiveInstanceUploadRanges(mesh: InstancedMeshLike): void {
    markActiveInstanceRange(mesh.instanceMatrix, mesh.count);
    markActiveInstanceRange(mesh.instanceColor, mesh.count);
}

export function applyRuntimeInstancingBudget(
    scene: Scene,
    options?: RuntimeInstancingBudgetOptions,
): RuntimeInstancingBudgetStats {
    const config = getBudgetConfig(scene);
    const targetTriangles = Number(config.maxTotalSubmittedTriangles ?? options?.maxTotalSubmittedTriangles);
    const enabled = config.enabled !== false && Number.isFinite(targetTriangles) && targetTriangles > 0;
    const maxSubmittedTrianglesPerMesh = Number(
        config.maxSubmittedTrianglesPerMesh ?? options?.maxSubmittedTrianglesPerMesh,
    );
    const hasPerMeshTriangleCap =
        enabled &&
        Number.isFinite(maxSubmittedTrianglesPerMesh) &&
        maxSubmittedTrianglesPerMesh > 0;
    const stats: RuntimeInstancingBudgetStats = {
        enabled,
        targetTriangles: enabled ? Math.floor(targetTriangles) : 0,
        maxSubmittedTrianglesPerMesh: hasPerMeshTriangleCap ? Math.floor(maxSubmittedTrianglesPerMesh) : 0,
        originalSubmittedTriangles: 0,
        cappedSubmittedTriangles: 0,
        meshesConsidered: 0,
        meshesCapped: 0,
    };

    if (!enabled) {
        return stats;
    }

    const entries: Array<{mesh: InstancedMeshLike; originalCount: number; trianglesPerInstance: number}> = [];
    traverseObjectDepthFirst(scene, object => {
        if (!isBudgetedRuntimeInstancedMesh(object)) {
            return;
        }

        const trianglesPerInstance = estimateGeometryTriangles(object.geometry);
        if (trianglesPerInstance <= 0) {
            return;
        }

        const originalCount = getOriginalCount(object);
        if (!Number.isFinite(originalCount) || originalCount <= 0) {
            return;
        }

        entries.push({mesh: object, originalCount, trianglesPerInstance});
        stats.meshesConsidered += 1;
        stats.originalSubmittedTriangles += originalCount * trianglesPerInstance;
    });

    if (entries.length === 0) {
        return stats;
    }

    if (stats.originalSubmittedTriangles <= stats.targetTriangles && !hasPerMeshTriangleCap) {
        for (const entry of entries) {
            entry.mesh.count = entry.originalCount;
        }
        stats.cappedSubmittedTriangles = stats.originalSubmittedTriangles;
        return stats;
    }

    const scale = stats.originalSubmittedTriangles > stats.targetTriangles
        ? stats.targetTriangles / stats.originalSubmittedTriangles
        : 1;
    const minInstancesPerMesh = Math.max(1, Math.floor(Number(config.minInstancesPerMesh ?? 1)));

    for (const entry of entries) {
        let nextCount = Math.floor(entry.originalCount * scale);
        if (hasPerMeshTriangleCap) {
            nextCount = Math.min(
                nextCount,
                Math.floor(stats.maxSubmittedTrianglesPerMesh / entry.trianglesPerInstance),
            );
        }
        nextCount = Math.max(
            Math.min(minInstancesPerMesh, entry.originalCount),
            nextCount,
        );
        entry.mesh.count = Math.min(entry.originalCount, nextCount);
        if (entry.mesh.count < entry.originalCount) {
            stats.meshesCapped += 1;
            markActiveInstanceUploadRanges(entry.mesh);
        }
        stats.cappedSubmittedTriangles += entry.mesh.count * entry.trianglesPerInstance;
    }

    return stats;
}

export async function applyRuntimeInstancingBudgetProgressive(
    scene: Scene,
    options: RuntimeInstancingBudgetProgressOptions = {},
): Promise<RuntimeInstancingBudgetStats> {
    const config = getBudgetConfig(scene);
    const targetTriangles = Number(config.maxTotalSubmittedTriangles ?? options.maxTotalSubmittedTriangles);
    const enabled = config.enabled !== false && Number.isFinite(targetTriangles) && targetTriangles > 0;
    const maxSubmittedTrianglesPerMesh = Number(
        config.maxSubmittedTrianglesPerMesh ?? options.maxSubmittedTrianglesPerMesh,
    );
    const hasPerMeshTriangleCap =
        enabled &&
        Number.isFinite(maxSubmittedTrianglesPerMesh) &&
        maxSubmittedTrianglesPerMesh > 0;
    const stats: RuntimeInstancingBudgetStats = {
        enabled,
        targetTriangles: enabled ? Math.floor(targetTriangles) : 0,
        maxSubmittedTrianglesPerMesh: hasPerMeshTriangleCap ? Math.floor(maxSubmittedTrianglesPerMesh) : 0,
        originalSubmittedTriangles: 0,
        cappedSubmittedTriangles: 0,
        meshesConsidered: 0,
        meshesCapped: 0,
    };

    if (!enabled) {
        return stats;
    }

    const maybeYield = createProgressiveYieldController(options, RUNTIME_INSTANCING_BUDGET_PROGRESS_DEFAULTS);
    const entries: Array<{mesh: InstancedMeshLike; originalCount: number; trianglesPerInstance: number}> = [];
    const stack: Object3D[] = [];
    for (let i = scene.children.length - 1; i >= 0; i--) {
        const child = scene.children[i];
        if (child) stack.push(child);
    }

    while (stack.length > 0) {
        const object = stack.pop();
        if (!object) continue;

        if (isBudgetedRuntimeInstancedMesh(object)) {
            const trianglesPerInstance = estimateGeometryTriangles(object.geometry);
            if (trianglesPerInstance > 0) {
                const originalCount = getOriginalCount(object);
                if (Number.isFinite(originalCount) && originalCount > 0) {
                    entries.push({mesh: object, originalCount, trianglesPerInstance});
                    stats.meshesConsidered += 1;
                    stats.originalSubmittedTriangles += originalCount * trianglesPerInstance;
                }
            }
        }

        for (let i = object.children.length - 1; i >= 0; i--) {
            const child = object.children[i];
            if (child) stack.push(child);
        }

        await maybeYield();
    }

    if (entries.length === 0) {
        return stats;
    }

    if (stats.originalSubmittedTriangles <= stats.targetTriangles && !hasPerMeshTriangleCap) {
        for (const entry of entries) {
            entry.mesh.count = entry.originalCount;
            stats.cappedSubmittedTriangles += entry.originalCount * entry.trianglesPerInstance;
            await maybeYield();
        }
        return stats;
    }

    const scale = stats.originalSubmittedTriangles > stats.targetTriangles
        ? stats.targetTriangles / stats.originalSubmittedTriangles
        : 1;
    const minInstancesPerMesh = Math.max(1, Math.floor(Number(config.minInstancesPerMesh ?? 1)));

    for (const entry of entries) {
        let nextCount = Math.floor(entry.originalCount * scale);
        if (hasPerMeshTriangleCap) {
            nextCount = Math.min(
                nextCount,
                Math.floor(stats.maxSubmittedTrianglesPerMesh / entry.trianglesPerInstance),
            );
        }
        nextCount = Math.max(
            Math.min(minInstancesPerMesh, entry.originalCount),
            nextCount,
        );
        entry.mesh.count = Math.min(entry.originalCount, nextCount);
        if (entry.mesh.count < entry.originalCount) {
            stats.meshesCapped += 1;
            markActiveInstanceUploadRanges(entry.mesh);
        }
        stats.cappedSubmittedTriangles += entry.mesh.count * entry.trianglesPerInstance;
        await maybeYield();
    }

    return stats;
}

export function restoreRuntimeInstancingBudget(scene: Scene): void {
    traverseObjectDepthFirst(scene, object => {
        const candidate = object as InstancedMeshLike;
        if (candidate.isInstancedMesh !== true) {
            return;
        }

        const userData = candidate.userData as RuntimeInstancingBudgetUserData | undefined;
        const originalCount = userData?.runtimeInstancingBudgetOriginalCount;
        if (Number.isFinite(originalCount) && originalCount! >= 0) {
            candidate.count = originalCount!;
            markActiveInstanceUploadRanges(candidate);
        }
    });
}
