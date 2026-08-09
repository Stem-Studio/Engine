import type {BufferGeometry, Camera, Object3D, Scene} from "three";

import {traverseObjectDepthFirst} from "./SceneTraverser";

export type RuntimeMainTriangleBudgetConfig = {
    enabled?: boolean;
    /** Keep the budget out of the real WebGPU path until it is explicitly validated there. */
    fallbackOnly?: boolean;
    maxTriangles?: number;
};

export type RuntimeMainTriangleBudgetOptions = {
    isWebGPU?: boolean;
    camera?: Camera | null;
    /** Explicitly rebuild the cap from the authored baseline. Runtime stabilization leaves prior gameplay hides intact. */
    reconsiderHidden?: boolean;
};

export type RuntimeMainTriangleBudgetStats = {
    enabled: boolean;
    skippedWebGPU: boolean;
    maxTriangles: number;
    unitsConsidered: number;
    unitsPreserved: number;
    unitsDisabled: number;
    originalTriangles: number;
    retainedTriangles: number;
};

type RuntimeMainTriangleBudgetUserData = {
    isRuntimeOnly?: boolean;
    disableRuntimeMainTriangleBudget?: boolean;
    runtimeMainPreserve?: boolean;
    runtimeMainPriority?: number;
    tags?: unknown;
    runtimeMainTriangleBudgetHidden?: boolean;
};

type MeshLike = Object3D & {
    isMesh?: boolean;
    isInstancedMesh?: boolean;
    count?: number;
    geometry?: BufferGeometry;
};

type MainVisualUnit = {
    object: Object3D;
    triangles: number;
    meshes: number;
    preserved: boolean;
    disabled: boolean;
    priority: number;
    distanceClass: "near" | "mid" | "far" | "unknown";
    authoredMeshes: number;
};

const originalVisibility = new WeakMap<Object3D, boolean>();

function getConfig(scene: Scene): RuntimeMainTriangleBudgetConfig {
    return (scene.userData?.rendering?.runtimeMainTriangleBudget ?? {}) as RuntimeMainTriangleBudgetConfig;
}

function userData(object: Object3D): RuntimeMainTriangleBudgetUserData {
    return (object.userData ?? {}) as RuntimeMainTriangleBudgetUserData;
}

function hasRuntimeMarker(object: Object3D): boolean {
    let current: Object3D | null = object;
    while (current) {
        if (userData(current).isRuntimeOnly === true) return true;
        current = current.parent;
    }
    return false;
}

function hasFlag(object: Object3D, key: "disableRuntimeMainTriangleBudget" | "runtimeMainPreserve"): boolean {
    let current: Object3D | null = object;
    while (current) {
        if (userData(current)[key] === true) return true;
        current = current.parent;
    }
    return false;
}

function isHeroLike(object: Object3D): boolean {
    let current: Object3D | null = object;
    while (current) {
        const data = userData(current);
        const tags = Array.isArray(data.tags) ? data.tags : [];
        const tagged = tags.some(tag => {
            const value = String(tag).toLowerCase();
            return value === "player" || value === "hero";
        });
        const name = current.name.toLowerCase();
        if (tagged || name === "player" || name === "hero" || name.includes("player")) return true;
        current = current.parent;
    }
    return false;
}

function priorityFor(object: Object3D): number {
    let current: Object3D | null = object;
    let priority = 0;
    while (current) {
        const value = Number(userData(current).runtimeMainPriority);
        if (Number.isFinite(value)) priority = Math.max(priority, value);
        current = current.parent;
    }
    return priority;
}

function estimateTriangles(object: MeshLike): number {
    const geometry = object.geometry;
    if (!geometry) return 0;
    const count = geometry.index?.count ?? geometry.getAttribute("position")?.count ?? 0;
    if (!Number.isFinite(count) || count <= 0) return 0;
    const instances = object.isInstancedMesh === true ? Math.max(1, Math.floor(object.count ?? 1)) : 1;
    return Math.max(0, Math.floor((count * instances) / 3));
}

function isVisibleInScene(object: Object3D, scene: Scene): boolean {
    let current: Object3D | null = object;
    while (current && current !== scene) {
        if (current.visible === false) return false;
        current = current.parent;
    }
    return current === scene;
}

function getDistanceClass(object: Object3D, camera: Camera | null | undefined): MainVisualUnit["distanceClass"] {
    if (!camera || typeof object.getWorldPosition !== "function") return "unknown";
    try {
        const objectPosition = object.getWorldPosition(camera.position.clone());
        const cameraPosition = camera.getWorldPosition?.(camera.position.clone()) ?? camera.position;
        const distance = objectPosition.distanceTo(cameraPosition);
        return distance < 12 ? "near" : distance < 35 ? "mid" : "far";
    } catch {
        return "unknown";
    }
}

function getLogicalUnit(object: Object3D, scene: Scene): Object3D {
    const chain: Object3D[] = [];
    let current: Object3D | null = object;
    while (current && current !== scene) {
        chain.push(current);
        current = current.parent;
    }
    chain.reverse();
    // Runtime builders conventionally use root -> subsystem -> visual unit -> mesh.
    // This depth keeps individual track cells and NPC clones independent while
    // still treating a direct mesh child as a valid whole visual unit.
    const index = chain.length === 2 ? 1 : Math.min(3, chain.length - 2);
    return chain[index] ?? object;
}

export function applyRuntimeMainTriangleBudget(
    scene: Scene,
    options: RuntimeMainTriangleBudgetOptions = {},
): RuntimeMainTriangleBudgetStats {
    if (options.reconsiderHidden === true) {
        restoreRuntimeMainTriangleBudget(scene);
    }
    const config = getConfig(scene);
    const maxTriangles = Number(config.maxTriangles);
    const fallbackOnly = config.fallbackOnly !== false;
    const skippedWebGPU = fallbackOnly && options.isWebGPU === true;
    const enabled = config.enabled === true && Number.isFinite(maxTriangles) && maxTriangles > 0 && !skippedWebGPU;
    const stats: RuntimeMainTriangleBudgetStats = {
        enabled,
        skippedWebGPU,
        maxTriangles: enabled ? Math.floor(maxTriangles) : 0,
        unitsConsidered: 0,
        unitsPreserved: 0,
        unitsDisabled: 0,
        originalTriangles: 0,
        retainedTriangles: 0,
    };
    if (!enabled) return stats;

    const units = new Map<string, MainVisualUnit>();
    traverseObjectDepthFirst(scene, object => {
        const mesh = object as MeshLike;
        if (mesh.isMesh !== true || !mesh.visible || !isVisibleInScene(mesh, scene) || !hasRuntimeMarker(mesh)) return;
        const unit = getLogicalUnit(mesh, scene);
        if (!isVisibleInScene(unit, scene)) return;
        const triangles = estimateTriangles(mesh);
        if (triangles <= 0) return;
        const key = unit.uuid;
        const existing = units.get(key);
        const unitData: MainVisualUnit = existing ?? {
            object: unit,
            triangles: 0,
            meshes: 0,
            preserved: hasFlag(unit, "runtimeMainPreserve") || isHeroLike(unit),
            disabled: hasFlag(unit, "disableRuntimeMainTriangleBudget"),
            priority: priorityFor(unit),
            distanceClass: getDistanceClass(unit, options.camera),
            authoredMeshes: 0,
        };
        unitData.preserved ||= hasFlag(mesh, "runtimeMainPreserve") || isHeroLike(mesh);
        unitData.disabled ||= hasFlag(mesh, "disableRuntimeMainTriangleBudget");
        unitData.triangles += triangles;
        unitData.meshes += 1;
        units.set(key, unitData);
    });

    // A unit containing authored geometry is never hidden by a runtime-only cap.
    traverseObjectDepthFirst(scene, object => {
        const mesh = object as MeshLike;
        if (mesh.isMesh !== true || !mesh.visible || hasRuntimeMarker(mesh)) return;
        const unit = getLogicalUnit(mesh, scene);
        const candidate = units.get(unit.uuid);
        if (candidate) candidate.authoredMeshes += 1;
    });

    const candidates = [...units.values()].filter(candidate => !candidate.disabled && candidate.authoredMeshes === 0);
    stats.unitsConsidered = candidates.length;
    stats.originalTriangles = candidates.reduce((sum, candidate) => sum + candidate.triangles, 0);
    const distanceRank = (value: MainVisualUnit["distanceClass"]): number => value === "near" ? 0 : value === "mid" ? 1 : value === "far" ? 2 : 1;
    for (const candidate of candidates) {
        candidate.preserved ||= candidate.distanceClass === "near";
    }
    candidates.sort((left, right) => {
        if (left.preserved !== right.preserved) return left.preserved ? -1 : 1;
        const distanceDelta = distanceRank(left.distanceClass) - distanceRank(right.distanceClass);
        if (distanceDelta !== 0) return distanceDelta;
        if (left.priority !== right.priority) return right.priority - left.priority;
        return left.triangles - right.triangles;
    });

    let retainedTriangles = 0;
    for (const candidate of candidates) {
        const keep = candidate.preserved || retainedTriangles + candidate.triangles <= stats.maxTriangles;
        originalVisibility.set(candidate.object, candidate.object.visible);
        if (keep) {
            retainedTriangles += candidate.triangles;
            stats.unitsPreserved += 1;
        } else {
            candidate.object.visible = false;
            userData(candidate.object).runtimeMainTriangleBudgetHidden = true;
            stats.unitsDisabled += 1;
        }
    }
    stats.retainedTriangles = retainedTriangles;
    return stats;
}

export function restoreRuntimeMainTriangleBudget(scene: Scene): void {
    traverseObjectDepthFirst(scene, object => {
        const original = originalVisibility.get(object);
        if (original !== undefined) {
            object.visible = original;
            originalVisibility.delete(object);
        }
        if (userData(object).runtimeMainTriangleBudgetHidden === true) {
            delete userData(object).runtimeMainTriangleBudgetHidden;
        }
    });
}
