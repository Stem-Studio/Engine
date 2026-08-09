import {BufferAttribute, BufferGeometry, InterleavedBufferAttribute, Mesh, Object3D} from "three";

import {traverseObjectDepthFirst} from "../utils/SceneTraverser";

const DEFAULT_NORMALS_PROGRESS_BATCH_SIZE = 64;
const DEFAULT_NORMALS_PROGRESS_FRAME_BUDGET_MS = 8;

export interface RenderableMeshNormalsStats {
    meshesVisited: number;
    geometriesChecked: number;
    normalsComputed: number;
    skippedMissingPosition: number;
    failed: number;
    totalComputeMs: number;
    maxComputeMs: number;
    maxComputeVertexCount: number;
    maxComputeObjectName?: string;
    maxComputeGeometryUuid?: string;
}

export interface RenderableMeshNormalsProgressOptions {
    batchSize?: number;
    frameBudgetMs?: number;
    yieldToFrame?: () => Promise<void>;
    shouldContinue?: () => boolean;
}

type NormalRepairCandidate = {
    object: Object3D;
    geometry: BufferGeometry;
    positionCount: number;
};

type NormalRepairResult = {
    computed: boolean;
    computeMs: number;
};

function hasValidNormalAttribute(geometry: BufferGeometry, position: BufferAttribute | InterleavedBufferAttribute): boolean {
    const normal = geometry.getAttribute("normal");
    return !!normal && normal.itemSize === 3 && normal.count === position.count;
}

function createEmptyRenderableMeshNormalsStats(): RenderableMeshNormalsStats {
    return {
        meshesVisited: 0,
        geometriesChecked: 0,
        normalsComputed: 0,
        skippedMissingPosition: 0,
        failed: 0,
        totalComputeMs: 0,
        maxComputeMs: 0,
        maxComputeVertexCount: 0,
    };
}

function getRenderableMeshNormalRepairCandidate(
    object: Object3D,
    checkedGeometries: Set<BufferGeometry>,
    stats: RenderableMeshNormalsStats,
): NormalRepairCandidate | null {
    if (!(object as Mesh).isMesh) return null;

    stats.meshesVisited += 1;

    const geometry = (object as Mesh).geometry;
    if (!geometry?.isBufferGeometry || checkedGeometries.has(geometry)) return null;

    checkedGeometries.add(geometry);
    stats.geometriesChecked += 1;

    const position = geometry.getAttribute("position");
    if (!position || position.itemSize !== 3 || position.count < 3) {
        stats.skippedMissingPosition += 1;
        return null;
    }

    if (hasValidNormalAttribute(geometry, position)) return null;

    return {
        object,
        geometry,
        positionCount: position.count,
    };
}

function computeRenderableMeshNormals(
    candidate: NormalRepairCandidate,
    stats: RenderableMeshNormalsStats,
): NormalRepairResult {
    const start = nowForNormalsProgress();
    let computed = false;

    try {
        candidate.geometry.computeVertexNormals();
        const normal = candidate.geometry.getAttribute("normal");
        if (normal) {
            normal.needsUpdate = true;
            stats.normalsComputed += 1;
            computed = true;
        }
    } catch (error) {
        stats.failed += 1;
        console.warn("[Render] Failed to compute mesh normals", {
            objectName: candidate.object.name,
            objectUuid: candidate.object.uuid,
            error,
        });
    }

    const computeMs = nowForNormalsProgress() - start;
    stats.totalComputeMs += computeMs;
    if (computeMs > stats.maxComputeMs) {
        stats.maxComputeMs = computeMs;
        stats.maxComputeVertexCount = candidate.positionCount;
        stats.maxComputeObjectName = candidate.object.name;
        stats.maxComputeGeometryUuid = candidate.geometry.uuid;
    }

    return {computed, computeMs};
}

function processRenderableMeshNormalsObject(
    object: Object3D,
    checkedGeometries: Set<BufferGeometry>,
    stats: RenderableMeshNormalsStats,
): NormalRepairResult {
    const candidate = getRenderableMeshNormalRepairCandidate(object, checkedGeometries, stats);
    if (!candidate) {
        return {computed: false, computeMs: 0};
    }

    return computeRenderableMeshNormals(candidate, stats);
}

function nowForNormalsProgress(): number {
    return typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
}

function defaultYieldNormalsProgressToFrame(): Promise<void> {
    return new Promise(resolve => {
        const finish = () => setTimeout(() => resolve(), 0);
        if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(() => finish());
        } else {
            finish();
        }
    });
}

export function ensureRenderableMeshNormals(root: Object3D): RenderableMeshNormalsStats {
    const checkedGeometries = new Set<BufferGeometry>();
    const stats = createEmptyRenderableMeshNormalsStats();

    traverseObjectDepthFirst(root, object => {
        processRenderableMeshNormalsObject(object, checkedGeometries, stats);
    });

    return stats;
}

export async function ensureRenderableMeshNormalsProgressive(
    root: Object3D,
    options: RenderableMeshNormalsProgressOptions = {},
): Promise<RenderableMeshNormalsStats> {
    const checkedGeometries = new Set<BufferGeometry>();
    const stats = createEmptyRenderableMeshNormalsStats();
    const yieldToFrame = options.yieldToFrame ?? defaultYieldNormalsProgressToFrame;
    const shouldContinue = options.shouldContinue ?? (() => true);
    const batchSize = Math.max(1, Math.floor(options.batchSize ?? DEFAULT_NORMALS_PROGRESS_BATCH_SIZE));
    const frameBudgetMs = Math.max(0, options.frameBudgetMs ?? DEFAULT_NORMALS_PROGRESS_FRAME_BUDGET_MS);
    const stack: Object3D[] = [root];
    let sliceStart = nowForNormalsProgress();
    let processedThisSlice = 0;

    const maybeYield = async (): Promise<void> => {
        processedThisSlice += 1;
        if (
            processedThisSlice < batchSize &&
            nowForNormalsProgress() - sliceStart < frameBudgetMs
        ) {
            return;
        }

        await yieldToFrame();
        sliceStart = nowForNormalsProgress();
        processedThisSlice = 0;
    };

    while (stack.length > 0 && shouldContinue()) {
        const object = stack.pop();
        if (!object) continue;

        const candidate = getRenderableMeshNormalRepairCandidate(object, checkedGeometries, stats);
        if (candidate) {
            computeRenderableMeshNormals(candidate, stats);
        }

        for (let i = object.children.length - 1; i >= 0; i--) {
            const child = object.children[i];
            if (child) stack.push(child);
        }

        await maybeYield();
    }

    return stats;
}
