import type {BufferAttribute, BufferGeometry, InstancedMesh, Object3D, Scene} from "three";

import {traverseObjectDepthFirst} from "./SceneTraverser";

/**
 * Editor previews are allowed to use authored geometry at full fidelity. The
 * budget only applies to procedural preview meshes that a behavior explicitly
 * marks as runtime-only (the same contract used by runtime budgets).
 */
export const DEFAULT_EDITOR_PREVIEW_INSTANCING_TRIANGLE_BUDGET = 750_000;
export const DEFAULT_EDITOR_PREVIEW_INSTANCING_MESH_TRIANGLE_BUDGET = 250_000;

type InstancedMeshLike = InstancedMesh & {
    isInstancedMesh?: boolean;
    count: number;
    geometry: BufferGeometry;
    instanceMatrix?: BufferAttribute;
    instanceColor?: BufferAttribute | null;
};

type EditorPreviewInstancingBudgetConfig = {
    enabled?: boolean;
    maxTotalSubmittedTriangles?: number;
    maxSubmittedTrianglesPerMesh?: number;
    minInstancesPerMesh?: number;
};

type EditorPreviewInstancingBudgetUserData = {
    isRuntimeOnly?: boolean;
    disableEditorPreviewInstancingBudget?: boolean;
    editorPreviewInstancingBudgetOriginalCount?: number;
};

export type EditorPreviewInstancingBudgetOptions = {
    maxTotalSubmittedTriangles?: number;
    maxSubmittedTrianglesPerMesh?: number;
};

export type EditorPreviewInstancingBudgetStats = {
    enabled: boolean;
    targetTriangles: number;
    maxSubmittedTrianglesPerMesh: number;
    originalSubmittedTriangles: number;
    cappedSubmittedTriangles: number;
    meshesConsidered: number;
    meshesCapped: number;
};

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

function isBudgetedPreviewMesh(object: Object3D): object is InstancedMeshLike {
    const candidate = object as InstancedMeshLike;
    const userData = candidate.userData as EditorPreviewInstancingBudgetUserData | undefined;
    return (
        candidate.isInstancedMesh === true &&
        candidate.visible === true &&
        userData?.isRuntimeOnly === true &&
        userData?.disableEditorPreviewInstancingBudget !== true &&
        !!candidate.geometry
    );
}

function getOriginalCount(mesh: InstancedMeshLike): number {
    const userData = mesh.userData as EditorPreviewInstancingBudgetUserData;
    if (Number.isFinite(userData.editorPreviewInstancingBudgetOriginalCount)) {
        return userData.editorPreviewInstancingBudgetOriginalCount!;
    }

    userData.editorPreviewInstancingBudgetOriginalCount = mesh.count;
    return mesh.count;
}

function markActiveInstanceRange(attribute: BufferAttribute | null | undefined, instanceCount: number): void {
    if (!attribute || typeof attribute.itemSize !== "number" || attribute.itemSize <= 0) {
        return;
    }

    const activeInstances = Math.max(
        0,
        Math.min(
            Math.floor(instanceCount),
            Number.isFinite(attribute.count) ? attribute.count : instanceCount,
        ),
    );
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

function getBudgetConfig(scene: Scene): EditorPreviewInstancingBudgetConfig {
    return scene.userData?.rendering?.editorPreviewInstancingBudget ?? {};
}

/**
 * Bound editor-only procedural preview geometry without changing authored
 * meshes or runtime counts. The original count is stored per mesh and is
 * restored before entering Play.
 */
export function applyEditorPreviewInstancingBudget(
    scene: Scene,
    options: EditorPreviewInstancingBudgetOptions = {},
): EditorPreviewInstancingBudgetStats {
    const config = getBudgetConfig(scene);
    const targetTriangles = Number(
        config.maxTotalSubmittedTriangles ??
            options.maxTotalSubmittedTriangles ??
            DEFAULT_EDITOR_PREVIEW_INSTANCING_TRIANGLE_BUDGET,
    );
    const enabled = config.enabled !== false && Number.isFinite(targetTriangles) && targetTriangles > 0;
    const maxSubmittedTrianglesPerMesh = Number(
        config.maxSubmittedTrianglesPerMesh ??
            options.maxSubmittedTrianglesPerMesh ??
            DEFAULT_EDITOR_PREVIEW_INSTANCING_MESH_TRIANGLE_BUDGET,
    );
    const hasPerMeshTriangleCap =
        enabled &&
        Number.isFinite(maxSubmittedTrianglesPerMesh) &&
        maxSubmittedTrianglesPerMesh > 0;
    const stats: EditorPreviewInstancingBudgetStats = {
        enabled,
        targetTriangles: enabled ? Math.floor(targetTriangles) : 0,
        maxSubmittedTrianglesPerMesh: hasPerMeshTriangleCap ? Math.floor(maxSubmittedTrianglesPerMesh) : 0,
        originalSubmittedTriangles: 0,
        cappedSubmittedTriangles: 0,
        meshesConsidered: 0,
        meshesCapped: 0,
    };

    if (!enabled) {
        // A scene can opt out after a previous pass already capped meshes.
        // Restore first so disabling the policy never leaves a stale preview
        // count behind.
        restoreEditorPreviewInstancingBudget(scene);
        return stats;
    }

    const entries: Array<{mesh: InstancedMeshLike; originalCount: number; trianglesPerInstance: number}> = [];
    traverseObjectDepthFirst(scene, object => {
        if (!isBudgetedPreviewMesh(object)) {
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

/** Restore editor preview counts and forget the temporary cap metadata. */
export function restoreEditorPreviewInstancingBudget(scene: Scene): void {
    traverseObjectDepthFirst(scene, object => {
        const candidate = object as InstancedMeshLike;
        if (candidate.isInstancedMesh !== true) {
            return;
        }

        const userData = candidate.userData as EditorPreviewInstancingBudgetUserData | undefined;
        const originalCount = userData?.editorPreviewInstancingBudgetOriginalCount;
        if (!Number.isFinite(originalCount) || originalCount! < 0) {
            return;
        }

        candidate.count = originalCount!;
        markActiveInstanceUploadRanges(candidate);
        delete userData!.editorPreviewInstancingBudgetOriginalCount;
    });
}
