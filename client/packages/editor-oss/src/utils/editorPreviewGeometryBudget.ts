import {BufferGeometry, Mesh, Object3D, Scene} from "three";
import {SimplifyModifier} from "three/addons/modifiers/SimplifyModifier.js";

import {traverseObjectDepthFirst} from "./SceneTraverser";

/**
 * Editor-only geometry reduction for imported model previews. The source
 * geometry is retained in a WeakMap and restored before Play, so this policy
 * never changes serialized assets or runtime fidelity.
 */
export const DEFAULT_EDITOR_PREVIEW_GEOMETRY_TRIANGLE_BUDGET = 180_000;
export const DEFAULT_EDITOR_PREVIEW_GEOMETRY_TRIANGLES_PER_MESH = 30_000;
export const DEFAULT_EDITOR_PREVIEW_GEOMETRY_MIN_TRIANGLES = 8_000;
export const DEFAULT_EDITOR_PREVIEW_GEOMETRY_RETENTION = 0.45;
// SimplifyModifier is synchronous and becomes super-linear on large meshes.
// Keep the editor startup path bounded until an async/worker decimator exists.
export const DEFAULT_EDITOR_PREVIEW_GEOMETRY_MAX_SOURCE_TRIANGLES = 24_000;

type EditorPreviewGeometryBudgetConfig = {
    enabled?: boolean;
    maxTotalTriangles?: number;
    maxTrianglesPerMesh?: number;
    minTriangles?: number;
    simplifyRatio?: number;
    maxMeshes?: number;
    maxSourceTriangles?: number;
};

export type EditorPreviewGeometryBudgetOptions = {
    maxTotalTriangles?: number;
    maxTrianglesPerMesh?: number;
    minTriangles?: number;
    simplifyRatio?: number;
    maxMeshes?: number;
    maxSourceTriangles?: number;
};

export type EditorPreviewGeometryBudgetStats = {
    enabled: boolean;
    originalTriangles: number;
    previewTriangles: number;
    meshesConsidered: number;
    meshesSimplified: number;
    meshesSkipped: number;
};

type GeometryReplacement = {
    source: BufferGeometry;
    simplified: BufferGeometry;
    signature: string;
};

const replacements = new WeakMap<Mesh, GeometryReplacement>();

function estimateTriangles(geometry: BufferGeometry): number {
    const indexCount = geometry.index?.count;
    if (typeof indexCount === "number" && Number.isFinite(indexCount) && indexCount > 0) {
        return Math.floor(indexCount / 3);
    }
    const positionCount = geometry.getAttribute("position")?.count;
    return typeof positionCount === "number" && Number.isFinite(positionCount) && positionCount > 0
        ? Math.floor(positionCount / 3)
        : 0;
}

function getConfig(scene: Scene): EditorPreviewGeometryBudgetConfig {
    return scene.userData?.rendering?.editorPreviewGeometryBudget ?? {};
}

function getModelRoot(object: Object3D): Object3D | null {
    let current: Object3D | null = object;
    while (current) {
        if (typeof current.userData?.modelId === "string" && current.userData.modelId.length > 0) {
            return current;
        }
        current = current.parent;
    }
    return null;
}

function isEligibleMesh(object: Object3D): object is Mesh {
    const mesh = object as Mesh;
    return (
        mesh.isMesh === true &&
        mesh.visible === true &&
        mesh.geometry instanceof BufferGeometry &&
        !(mesh as Mesh & {isInstancedMesh?: boolean}).isInstancedMesh &&
        mesh.userData?.disableEditorPreviewGeometryBudget !== true &&
        !!getModelRoot(mesh) &&
        mesh.geometry.morphAttributes.position === undefined &&
        // SimplifyModifier cannot preserve material-group boundaries reliably.
        mesh.geometry.groups.length === 0 &&
        (!Array.isArray(mesh.material) || mesh.material.length === 1)
    );
}

function resolveNumber(value: unknown, fallback: number, minimum: number): number {
    const number = Number(value);
    return Number.isFinite(number) && number >= minimum ? number : fallback;
}

function buildSignature(
    maxTotalTriangles: number,
    maxTrianglesPerMesh: number,
    minTriangles: number,
    simplifyRatio: number,
    maxMeshes: number,
    maxSourceTriangles: number,
): string {
    return `${maxTotalTriangles}:${maxTrianglesPerMesh}:${minTriangles}:${simplifyRatio}:${maxMeshes}:${maxSourceTriangles}`;
}

/** Apply a reversible editor-only authored-model geometry budget. */
export function applyEditorPreviewGeometryBudget(
    scene: Scene,
    options: EditorPreviewGeometryBudgetOptions = {},
): EditorPreviewGeometryBudgetStats {
    const config = getConfig(scene);
    const enabled = config.enabled !== false;
    const maxTotalTriangles = Math.floor(resolveNumber(
        config.maxTotalTriangles ?? options.maxTotalTriangles,
        DEFAULT_EDITOR_PREVIEW_GEOMETRY_TRIANGLE_BUDGET,
        1,
    ));
    const maxTrianglesPerMesh = Math.floor(resolveNumber(
        config.maxTrianglesPerMesh ?? options.maxTrianglesPerMesh,
        DEFAULT_EDITOR_PREVIEW_GEOMETRY_TRIANGLES_PER_MESH,
        1,
    ));
    const minTriangles = Math.floor(resolveNumber(
        config.minTriangles ?? options.minTriangles,
        DEFAULT_EDITOR_PREVIEW_GEOMETRY_MIN_TRIANGLES,
        1,
    ));
    const simplifyRatio = Math.min(0.95, Math.max(0.1, resolveNumber(
        config.simplifyRatio ?? options.simplifyRatio,
        DEFAULT_EDITOR_PREVIEW_GEOMETRY_RETENTION,
        0.1,
    )));
    const maxMeshes = Math.floor(resolveNumber(config.maxMeshes ?? options.maxMeshes, Number.MAX_SAFE_INTEGER, 1));
    const maxSourceTriangles = Math.floor(resolveNumber(
        config.maxSourceTriangles ?? options.maxSourceTriangles,
        DEFAULT_EDITOR_PREVIEW_GEOMETRY_MAX_SOURCE_TRIANGLES,
        1,
    ));
    const signature = buildSignature(
        maxTotalTriangles,
        maxTrianglesPerMesh,
        minTriangles,
        simplifyRatio,
        maxMeshes,
        maxSourceTriangles,
    );
    const stats: EditorPreviewGeometryBudgetStats = {
        enabled,
        originalTriangles: 0,
        previewTriangles: 0,
        meshesConsidered: 0,
        meshesSimplified: 0,
        meshesSkipped: 0,
    };

    if (!enabled) {
        restoreEditorPreviewGeometryBudget(scene);
        return stats;
    }

    const entries: Array<{mesh: Mesh; original: BufferGeometry; triangles: number}> = [];
    traverseObjectDepthFirst(scene, object => {
        if (!isEligibleMesh(object)) return;
        const replacement = replacements.get(object);
        if (replacement?.source === object.geometry && replacement.signature === signature) {
            const triangles = estimateTriangles(replacement.simplified);
            stats.originalTriangles += estimateTriangles(replacement.source);
            stats.previewTriangles += triangles;
            stats.meshesConsidered += 1;
            stats.meshesSimplified += 1;
            return;
        }
        if (replacement) {
            object.geometry = replacement.source;
            replacement.simplified.dispose();
            replacements.delete(object);
        }
        const triangles = estimateTriangles(object.geometry);
        if (triangles <= 0) return;
        stats.originalTriangles += triangles;
        stats.meshesConsidered += 1;
        entries.push({mesh: object, original: object.geometry, triangles});
    });

    if (entries.length === 0) return stats;
    const eligible = entries
        .filter(entry => entry.triangles >= minTriangles)
        .sort((a, b) => b.triangles - a.triangles)
        .slice(0, maxMeshes);
    const eligibleTotal = eligible.reduce((sum, entry) => sum + entry.triangles, 0);
    const targetTotal = Math.min(maxTotalTriangles, eligibleTotal);
    const modifier = new SimplifyModifier();

    for (const entry of entries) {
        if (!eligible.includes(entry)) {
            stats.previewTriangles += entry.triangles;
            stats.meshesSkipped += 1;
            continue;
        }
        if (entry.triangles > maxSourceTriangles) {
            stats.previewTriangles += entry.triangles;
            stats.meshesSkipped += 1;
            continue;
        }
        const proportionalTarget = eligibleTotal > targetTotal
            ? Math.floor(entry.triangles * targetTotal / eligibleTotal)
            : entry.triangles;
        const targetTriangles = Math.max(
            Math.floor(entry.triangles * simplifyRatio),
            Math.min(entry.triangles, Math.min(maxTrianglesPerMesh, proportionalTarget)),
        );
        const sourceVertices = entry.original.getAttribute("position")?.count ?? 0;
        const targetVertices = Math.max(3, Math.floor(sourceVertices * targetTriangles / entry.triangles));
        const removeCount = Math.max(0, sourceVertices - targetVertices);
        if (removeCount <= 0 || targetTriangles >= entry.triangles) {
            stats.previewTriangles += entry.triangles;
            stats.meshesSkipped += 1;
            continue;
        }
        try {
            const simplified = modifier.modify(entry.original, removeCount);
            if (estimateTriangles(simplified) <= 0) throw new Error("Simplifier returned empty geometry");
            simplified.computeBoundingBox();
            simplified.computeBoundingSphere();
            if (!simplified.getAttribute("normal")) simplified.computeVertexNormals();
            entry.mesh.geometry = simplified;
            replacements.set(entry.mesh, {source: entry.original, simplified, signature});
            stats.previewTriangles += estimateTriangles(simplified);
            stats.meshesSimplified += 1;
        } catch {
            stats.previewTriangles += entry.triangles;
            stats.meshesSkipped += 1;
        }
    }

    return stats;
}

/** Restore original authored geometry and dispose temporary preview meshes. */
export function restoreEditorPreviewGeometryBudget(scene: Scene): void {
    traverseObjectDepthFirst(scene, object => {
        const mesh = object as Mesh;
        const replacement = replacements.get(mesh);
        if (!replacement) return;
        mesh.geometry = replacement.source;
        replacement.simplified.dispose();
        replacements.delete(mesh);
    });
}
