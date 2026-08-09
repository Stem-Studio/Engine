import * as THREE from "three";
import {
    traverseObjectDepthFirst,
    updateObjectMatrixWorldDepthFirst,
} from "@stem/editor-oss/utils/SceneTraverser";

import {
    applyQuickBuildConnections,
    EMPTY_QUICK_BUILD_CONNECTIONS,
    getQuickBuildMetadata,
    getQuickBuildPlacementConfig,
    getQuickBuildPlacementSnap,
    isQuickBuildCellExclusiveKind,
    QuickBuildConnections,
    QuickBuildDirection,
    QUICK_BUILD_DIRECTIONS,
    QuickBuildStampKind,
    QuickBuildVariantId,
    snapQuickBuildPoint,
} from "./quickBuildObjects";
import type {QuickBuildTextureApplication} from "./quickBuildTexturePacks";

export type QuickBuildBrushMode = "single" | "radius" | "line" | "rectangle";

export interface QuickBuildBrushOptions {
    mode: QuickBuildBrushMode;
    radius?: number;
    anchor?: THREE.Vector3 | null;
}

export interface QuickBuildPlacementCandidate {
    point: THREE.Vector3;
    key: string;
    valid: boolean;
    reason?: "duplicate" | "overlap";
}

export interface QuickBuildAdjacencyUpdate {
    object: THREE.Object3D;
    connections: QuickBuildConnections;
}

export interface QuickBuildExportObject {
    uuid: string;
    name: string;
    kind: QuickBuildStampKind;
    level: number;
    variantId?: QuickBuildVariantId;
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
    connections: QuickBuildConnections;
    texture?: QuickBuildTextureApplication;
}

export interface QuickBuildExportPayload {
    schema: "stem.quickBuild.v1";
    generatedAt: string;
    counts: Record<QuickBuildStampKind, number>;
    objects: QuickBuildExportObject[];
}

export interface QuickBuildDuplicateGroup {
    key: string;
    kind: QuickBuildStampKind;
    position: {x: number; z: number};
    objects: THREE.Object3D[];
    keep: THREE.Object3D;
    remove: THREE.Object3D[];
}

export interface QuickBuildSceneStats {
    objectCount: number;
    meshCount: number;
    triangleCount: number;
    materialCount: number;
    duplicateCount: number;
    duplicateGroupCount: number;
    staticEligibleCount: number;
    staticObjectCount: number;
    bakedBatchCount: number;
    liveBatchCount: number;
    liveInstanceCount: number;
}

const DIRECTION_OFFSETS: Record<QuickBuildDirection, {x: number; z: number}> = {
    north: {x: 0, z: -1},
    east: {x: 1, z: 0},
    south: {x: 0, z: 1},
    west: {x: -1, z: 0},
};

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
    return (object as THREE.Mesh).isMesh === true;
}

function countGeometryTriangles(geometry: THREE.BufferGeometry | undefined | null) {
    if (!geometry) return 0;
    if (geometry.index) return Math.floor(geometry.index.count / 3);

    const position = geometry.getAttribute("position");
    return position ? Math.floor(position.count / 3) : 0;
}

function addMaterialIds(material: THREE.Material | THREE.Material[] | undefined, materialIds: Set<string>) {
    if (!material) return;
    const materials = Array.isArray(material) ? material : [material];
    for (const item of materials) {
        materialIds.add(item.uuid);
    }
}

function countMeshes(object: THREE.Object3D) {
    let count = 0;
    traverseObjectDepthFirst(object, child => {
        if (isMesh(child)) count++;
    });
    return count;
}

function roundGridValue(value: number) {
    return Number(value.toFixed(4));
}

function getGridUnit(point: THREE.Vector3, increment = 1) {
    const step = Number.isFinite(increment) && increment > 0 ? increment : 1;
    const snapped = snapQuickBuildPoint(point, step);
    return {
        x: Math.round(snapped.x / step),
        z: Math.round(snapped.z / step),
        y: snapped.y,
        step,
    };
}

function pointFromGridUnit(x: number, z: number, y: number, step: number) {
    return new THREE.Vector3(roundGridValue(x * step), y, roundGridValue(z * step));
}

function pointKey(point: THREE.Vector3, increment = 1) {
    const snapped = snapQuickBuildPoint(point, increment);
    return `${roundGridValue(snapped.x)}:${roundGridValue(snapped.z)}`;
}

function placementKey(kind: QuickBuildStampKind, point: THREE.Vector3, increment = 1) {
    return `${kind}:${pointKey(point, getQuickBuildPlacementSnap(kind, increment))}`;
}

function dedupePoints(points: THREE.Vector3[], increment = 1) {
    const seen = new Set<string>();
    const deduped: THREE.Vector3[] = [];
    for (const point of points) {
        const key = pointKey(point, increment);
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(point);
    }
    return deduped;
}

interface QuickBuildFootprintRect {
    centerX: number;
    centerZ: number;
    width: number;
    depth: number;
}

function normalizeYaw(rotationY: number) {
    return Math.atan2(Math.sin(rotationY), Math.cos(rotationY));
}

function getRotatedFootprintSize(kind: QuickBuildStampKind, rotationY = 0, scaleX = 1, scaleZ = 1) {
    const footprint = getQuickBuildPlacementConfig(kind).footprint;
    const width = Math.abs(footprint.x * scaleX);
    const depth = Math.abs(footprint.z * scaleZ);
    const yaw = normalizeYaw(rotationY);
    const cos = Math.abs(Math.cos(yaw));
    const sin = Math.abs(Math.sin(yaw));
    return {
        width: (width * cos) + (depth * sin),
        depth: (width * sin) + (depth * cos),
    };
}

function getQuickBuildFootprintRectAtPoint(
    kind: QuickBuildStampKind,
    point: THREE.Vector3,
    rotationY = 0,
): QuickBuildFootprintRect {
    const size = getRotatedFootprintSize(kind, rotationY);
    return {
        centerX: point.x,
        centerZ: point.z,
        width: size.width,
        depth: size.depth,
    };
}

function getQuickBuildObjectFootprintRect(
    object: THREE.Object3D,
    kind: QuickBuildStampKind,
): QuickBuildFootprintRect {
    const worldPosition = new THREE.Vector3();
    const worldScale = new THREE.Vector3();
    const worldQuaternion = new THREE.Quaternion();
    object.getWorldPosition(worldPosition);
    object.getWorldScale(worldScale);
    object.getWorldQuaternion(worldQuaternion);
    const worldEuler = new THREE.Euler().setFromQuaternion(worldQuaternion, "YXZ");
    const size = getRotatedFootprintSize(kind, worldEuler.y, worldScale.x, worldScale.z);
    return {
        centerX: worldPosition.x,
        centerZ: worldPosition.z,
        width: size.width,
        depth: size.depth,
    };
}

function quickBuildFootprintContainsPoint(rect: QuickBuildFootprintRect, point: THREE.Vector3, padding = 0.001) {
    return Math.abs(point.x - rect.centerX) <= (rect.width / 2) + padding &&
        Math.abs(point.z - rect.centerZ) <= (rect.depth / 2) + padding;
}

function quickBuildFootprintsOverlap(a: QuickBuildFootprintRect, b: QuickBuildFootprintRect, padding = 0.001) {
    return Math.abs(a.centerX - b.centerX) < ((a.width + b.width) / 2) - padding &&
        Math.abs(a.centerZ - b.centerZ) < ((a.depth + b.depth) / 2) - padding;
}

function isQuickBuildFootprintExclusiveKind(kind: QuickBuildStampKind) {
    const mode = getQuickBuildPlacementConfig(kind).mode;
    return mode === "prop" || mode === "segment";
}

function shouldFootprintsCollide(a: QuickBuildStampKind, b: QuickBuildStampKind) {
    return isQuickBuildFootprintExclusiveKind(a) && isQuickBuildFootprintExclusiveKind(b);
}

function getLineGridPoints(start: ReturnType<typeof getGridUnit>, end: ReturnType<typeof getGridUnit>) {
    const points: Array<{x: number; z: number}> = [];
    let x0 = start.x;
    let z0 = start.z;
    const x1 = end.x;
    const z1 = end.z;
    const dx = Math.abs(x1 - x0);
    const dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1;
    const sz = z0 < z1 ? 1 : -1;
    let error = dx - dz;

    while (true) {
        points.push({x: x0, z: z0});
        if (x0 === x1 && z0 === z1) break;

        const doubledError = error * 2;
        if (doubledError > -dz) {
            error -= dz;
            x0 += sx;
        }
        if (doubledError < dx) {
            error += dx;
            z0 += sz;
        }
    }

    return points;
}

export function collectQuickBuildObjects(root: THREE.Object3D | null | undefined): THREE.Object3D[] {
    return collectQuickBuildSceneInventory(root).quickBuildObjects;
}

export function collectQuickBuildBakeObjects(root: THREE.Object3D | null | undefined): THREE.Object3D[] {
    return collectQuickBuildSceneInventory(root).bakeObjects;
}

interface QuickBuildSceneInventory {
    quickBuildObjects: THREE.Object3D[];
    bakeObjects: THREE.Object3D[];
    liveBatchObjects: THREE.Object3D[];
}

export interface QuickBuildSceneCounts {
    stampCount: number;
    bakedBatchCount: number;
    liveBatchCount: number;
}

function collectQuickBuildSceneInventory(root: THREE.Object3D | null | undefined): QuickBuildSceneInventory {
    const inventory: QuickBuildSceneInventory = {
        quickBuildObjects: [],
        bakeObjects: [],
        liveBatchObjects: [],
    };
    if (!root) return inventory;

    traverseObjectDepthFirst(root, object => {
        if (getQuickBuildMetadata(object)) inventory.quickBuildObjects.push(object);
        if (object.userData?.isQuickBuildBake === true) inventory.bakeObjects.push(object);
        if (object.userData?.isQuickBuildLiveBatch === true) inventory.liveBatchObjects.push(object);
    });
    return inventory;
}

export function getQuickBuildSceneCounts(root: THREE.Object3D | null | undefined): QuickBuildSceneCounts {
    const inventory = collectQuickBuildSceneInventory(root);
    return {
        stampCount: inventory.quickBuildObjects.length,
        bakedBatchCount: inventory.bakeObjects.length,
        liveBatchCount: inventory.liveBatchObjects.length,
    };
}

export function getQuickBuildBrushPoints(
    origin: THREE.Vector3,
    increment = 1,
    options: QuickBuildBrushOptions = {mode: "single"},
): THREE.Vector3[] {
    const radius = Math.max(1, Math.min(8, Math.floor(options.radius ?? 1)));
    const current = getGridUnit(origin, increment);
    const anchor = options.anchor ? getGridUnit(options.anchor, increment) : current;

    switch (options.mode) {
        case "single":
            return [pointFromGridUnit(current.x, current.z, current.y, current.step)];
        case "radius": {
            const points: THREE.Vector3[] = [];
            for (let z = current.z - radius; z <= current.z + radius; z++) {
                for (let x = current.x - radius; x <= current.x + radius; x++) {
                    const distance = Math.hypot(x - current.x, z - current.z);
                    if (distance <= radius + 0.001) {
                        points.push(pointFromGridUnit(x, z, current.y, current.step));
                    }
                }
            }
            return dedupePoints(points, increment);
        }
        case "line":
            return getLineGridPoints(anchor, current).map(point =>
                pointFromGridUnit(point.x, point.z, current.y, current.step),
            );
        case "rectangle": {
            const points: THREE.Vector3[] = [];
            const minX = Math.min(anchor.x, current.x);
            const maxX = Math.max(anchor.x, current.x);
            const minZ = Math.min(anchor.z, current.z);
            const maxZ = Math.max(anchor.z, current.z);
            for (let z = minZ; z <= maxZ; z++) {
                for (let x = minX; x <= maxX; x++) {
                    points.push(pointFromGridUnit(x, z, current.y, current.step));
                }
            }
            return dedupePoints(points, increment);
        }
    }
}

export function getQuickBuildFootprint(
    object: THREE.Object3D,
    increment = 1,
): {key: string; kind: QuickBuildStampKind; position: {x: number; z: number}} | null {
    const metadata = getQuickBuildMetadata(object);
    if (!metadata) return null;
    if (!isQuickBuildCellExclusiveKind(metadata.kind)) return null;

    const worldPosition = new THREE.Vector3();
    object.getWorldPosition(worldPosition);
    const snapped = snapQuickBuildPoint(worldPosition, getQuickBuildPlacementSnap(metadata.kind, increment));
    const x = roundGridValue(snapped.x);
    const z = roundGridValue(snapped.z);

    return {
        key: `${metadata.kind}:${x}:${z}`,
        kind: metadata.kind,
        position: {x, z},
    };
}

function getQuickBuildOccupancyFromObjects(objects: THREE.Object3D[], increment = 1) {
    const occupancy = new Map<string, THREE.Object3D>();
    const worldPosition = new THREE.Vector3();
    for (const object of objects) {
        if (object.visible === false) continue;
        const metadata = getQuickBuildMetadata(object);
        if (!metadata) continue;
        if (!isQuickBuildCellExclusiveKind(metadata.kind)) continue;
        if (isQuickBuildFootprintExclusiveKind(metadata.kind)) continue;
        object.getWorldPosition(worldPosition);
        occupancy.set(placementKey(metadata.kind, worldPosition, increment), object);
    }
    return occupancy;
}

export function getQuickBuildOccupancy(root: THREE.Object3D | null | undefined, increment = 1) {
    return getQuickBuildOccupancyFromObjects(collectQuickBuildObjects(root), increment);
}

export function findQuickBuildObjectAtPoint(
    root: THREE.Object3D | null | undefined,
    kind: QuickBuildStampKind,
    point: THREE.Vector3,
    increment = 1,
): THREE.Object3D | null {
    if (isQuickBuildFootprintExclusiveKind(kind)) {
        const objects = collectQuickBuildObjects(root).filter(object => object.visible !== false);
        for (let index = objects.length - 1; index >= 0; index--) {
            const object = objects[index];
            if (!object) continue;
            const metadata = getQuickBuildMetadata(object);
            if (metadata?.kind !== kind) continue;
            if (quickBuildFootprintContainsPoint(getQuickBuildObjectFootprintRect(object, kind), point)) return object;
        }
        return null;
    }

    return getQuickBuildOccupancy(root, increment).get(placementKey(kind, point, increment)) ?? null;
}

export function findAnyQuickBuildObjectAtPoint(
    root: THREE.Object3D | null | undefined,
    point: THREE.Vector3,
    increment = 1,
): THREE.Object3D | null {
    const objects = collectQuickBuildObjects(root).filter(object => object.visible !== false);
    const worldPosition = new THREE.Vector3();

    for (let index = objects.length - 1; index >= 0; index--) {
        const object = objects[index];
        if (!object) continue;
        const metadata = getQuickBuildMetadata(object);
        if (!metadata) continue;

        if (isQuickBuildFootprintExclusiveKind(metadata.kind)) {
            if (quickBuildFootprintContainsPoint(getQuickBuildObjectFootprintRect(object, metadata.kind), point)) {
                return object;
            }
            continue;
        }

        const targetKey = pointKey(point, getQuickBuildPlacementSnap(metadata.kind, increment));
        object.getWorldPosition(worldPosition);
        if (pointKey(worldPosition, getQuickBuildPlacementSnap(metadata.kind, increment)) === targetKey) return object;
    }

    return null;
}

export function findNearestQuickBuildObjectNearPoint(
    root: THREE.Object3D | null | undefined,
    point: THREE.Vector3,
    increment = 1,
): THREE.Object3D | null {
    const maxDistance = Math.max(0.001, increment * 0.6);
    const maxDistanceSq = maxDistance * maxDistance;
    const objects = collectQuickBuildObjects(root).filter(object => object.visible !== false);
    let nearest: {object: THREE.Object3D; distanceSq: number} | null = null;
    const worldPosition = new THREE.Vector3();

    for (let index = objects.length - 1; index >= 0; index--) {
        const object = objects[index];
        if (!object) continue;

        object.getWorldPosition(worldPosition);
        const distanceSq = ((worldPosition.x - point.x) ** 2) + ((worldPosition.z - point.z) ** 2);
        if (distanceSq > maxDistanceSq) continue;
        if (!nearest || distanceSq < nearest.distanceSq) {
            nearest = {object, distanceSq};
        }
    }

    return nearest?.object ?? null;
}

export function getQuickBuildPlacementCandidates(
    root: THREE.Object3D | null | undefined,
    kind: QuickBuildStampKind,
    points: THREE.Vector3[],
    increment = 1,
    rotationY = 0,
): QuickBuildPlacementCandidate[] {
    const existingObjects = collectQuickBuildObjects(root);
    const occupancy = getQuickBuildOccupancyFromObjects(existingObjects, increment);
    const localSeen = new Set<string>();
    const localFootprints: QuickBuildFootprintRect[] = [];
    const enforceOccupancy = isQuickBuildCellExclusiveKind(kind);
    const snap = getQuickBuildPlacementSnap(kind, increment);
    const footprintExclusive = isQuickBuildFootprintExclusiveKind(kind);
    const existingFootprints = footprintExclusive
        ? existingObjects
            .filter(object => {
                if (object.visible === false) return false;
                const metadata = getQuickBuildMetadata(object);
                return metadata ? shouldFootprintsCollide(kind, metadata.kind) : false;
            })
            .map(object => {
                const metadata = getQuickBuildMetadata(object)!;
                return getQuickBuildObjectFootprintRect(object, metadata.kind);
            })
        : [];

    return dedupePoints(points, snap).map(point => {
        const snapped = snapQuickBuildPoint(point, snap);
        const key = placementKey(kind, snapped, increment);
        const candidateFootprint = footprintExclusive
            ? getQuickBuildFootprintRectAtPoint(kind, snapped, rotationY)
            : null;
        const overlapsExisting = !!candidateFootprint &&
            existingFootprints.some(footprint => quickBuildFootprintsOverlap(candidateFootprint, footprint));
        const overlapsLocal = !!candidateFootprint &&
            localFootprints.some(footprint => quickBuildFootprintsOverlap(candidateFootprint, footprint));
        const duplicate = !footprintExclusive && ((enforceOccupancy && occupancy.has(key)) || localSeen.has(key));
        const overlap = overlapsExisting || overlapsLocal;
        localSeen.add(key);
        if (candidateFootprint && !overlap) localFootprints.push(candidateFootprint);
        return {
            point: snapped,
            key,
            valid: !duplicate && !overlap,
            reason: duplicate ? "duplicate" : overlap ? "overlap" : undefined,
        };
    });
}

export function getPlaceableQuickBuildPoints(
    root: THREE.Object3D | null | undefined,
    kind: QuickBuildStampKind,
    points: THREE.Vector3[],
    increment = 1,
): THREE.Vector3[] {
    return getQuickBuildPlacementCandidates(root, kind, points, increment)
        .filter(candidate => candidate.valid)
        .map(candidate => candidate.point);
}

export function findQuickBuildDuplicateGroups(
    root: THREE.Object3D | null | undefined,
    increment = 1,
): QuickBuildDuplicateGroup[] {
    return findQuickBuildDuplicateGroupsInObjects(collectQuickBuildObjects(root), increment);
}

function findQuickBuildDuplicateGroupsInObjects(
    sourceObjects: THREE.Object3D[],
    increment = 1,
): QuickBuildDuplicateGroup[] {
    const buckets = new Map<
        string,
        {kind: QuickBuildStampKind; position: {x: number; z: number}; objects: THREE.Object3D[]}
    >();

    for (const object of sourceObjects) {
        if (object.visible === false) continue;
        const footprint = getQuickBuildFootprint(object, increment);
        if (!footprint) continue;

        const bucket = buckets.get(footprint.key);
        if (bucket) {
            bucket.objects.push(object);
        } else {
            buckets.set(footprint.key, {
                kind: footprint.kind,
                position: footprint.position,
                objects: [object],
            });
        }
    }

    const duplicateGroups: QuickBuildDuplicateGroup[] = [];
    for (const [key, bucket] of buckets) {
        if (bucket.objects.length < 2) continue;

        const meshCounts = new Map(bucket.objects.map(object => [object, countMeshes(object)]));
        const objects = [...bucket.objects].sort((a, b) => {
            const aLevel = getQuickBuildMetadata(a)?.level ?? 1;
            const bLevel = getQuickBuildMetadata(b)?.level ?? 1;
            if (aLevel !== bLevel) return bLevel - aLevel;
            return (meshCounts.get(b) ?? 0) - (meshCounts.get(a) ?? 0);
        });
        const keep = objects[0];
        if (!keep) continue;

        duplicateGroups.push({
            key,
            kind: bucket.kind,
            position: bucket.position,
            objects,
            keep,
            remove: objects.slice(1),
        });
    }

    return duplicateGroups;
}

export function getQuickBuildDuplicateRemovalTargets(
    root: THREE.Object3D | null | undefined,
    increment = 1,
): THREE.Object3D[] {
    return findQuickBuildDuplicateGroups(root, increment).flatMap(group => group.remove);
}

export function collectQuickBuildStaticTargets(objects: THREE.Object3D[]): THREE.Object3D[] {
    const targets: THREE.Object3D[] = [];
    for (const object of objects) {
        updateObjectMatrixWorldDepthFirst(object, true);
        traverseObjectDepthFirst(object, child => {
            if (child === object) return;
            if (child.matrixAutoUpdate !== false) {
                targets.push(child);
            }
        });
    }
    return targets;
}

export function refreshQuickBuildAdjacency(
    root: THREE.Object3D | null | undefined,
    increment = 1,
): QuickBuildAdjacencyUpdate[] {
    const terrainObjects = collectQuickBuildObjects(root).filter(object => {
        if (object.visible === false) return false;
        const metadata = getQuickBuildMetadata(object);
        return metadata?.kind === "path" || metadata?.kind === "bridge";
    });
    const occupancy = new Map<string, THREE.Object3D>();

    for (const object of terrainObjects) {
        if (object.visible === false) continue;
        const metadata = getQuickBuildMetadata(object);
        if (!metadata) continue;

        const worldPosition = new THREE.Vector3();
        object.getWorldPosition(worldPosition);
        occupancy.set(placementKey(metadata.kind, worldPosition, increment), object);
    }

    const updates: QuickBuildAdjacencyUpdate[] = [];
    for (const object of terrainObjects) {
        const metadata = getQuickBuildMetadata(object);
        if (!metadata) continue;

        const worldPosition = new THREE.Vector3();
        object.getWorldPosition(worldPosition);
        const unit = getGridUnit(worldPosition, increment);
        const connections: QuickBuildConnections = {...EMPTY_QUICK_BUILD_CONNECTIONS};

        for (const direction of QUICK_BUILD_DIRECTIONS) {
            const offset = DIRECTION_OFFSETS[direction];
            const neighborPoint = pointFromGridUnit(unit.x + offset.x, unit.z + offset.z, unit.y, unit.step);
            connections[direction] = occupancy.has(placementKey(metadata.kind, neighborPoint, increment));
        }

        applyQuickBuildConnections(object, connections);
        updates.push({object, connections});
    }

    return updates;
}

function serializeVector3(vector: THREE.Vector3): [number, number, number] {
    return [roundGridValue(vector.x), roundGridValue(vector.y), roundGridValue(vector.z)];
}

function serializeEuler(euler: THREE.Euler): [number, number, number] {
    return [roundGridValue(euler.x), roundGridValue(euler.y), roundGridValue(euler.z)];
}

function createKindCounts() {
    return {
        ground: 0,
        sand: 0,
        stone: 0,
        path: 0,
        water: 0,
        bridge: 0,
        farm: 0,
        fence: 0,
        tree: 0,
        bush: 0,
        rock: 0,
        house: 0,
        lamp: 0,
    } satisfies Record<QuickBuildStampKind, number>;
}

export function createQuickBuildExportPayload(root: THREE.Object3D | null | undefined): QuickBuildExportPayload {
    const counts = createKindCounts();
    const objects = collectQuickBuildObjects(root)
        .filter(object => object.visible !== false)
        .map(object => {
            const metadata = getQuickBuildMetadata(object)!;
            counts[metadata.kind] += 1;
            return {
                uuid: object.uuid,
                name: object.name,
                kind: metadata.kind,
                level: metadata.level,
                ...(metadata.variantId ? {variantId: metadata.variantId} : {}),
                position: serializeVector3(object.position),
                rotation: serializeEuler(object.rotation),
                scale: serializeVector3(object.scale),
                connections: metadata.connections ?? EMPTY_QUICK_BUILD_CONNECTIONS,
                texture: object.userData.quickBuildTexture,
            };
        });

    return {
        schema: "stem.quickBuild.v1",
        generatedAt: new Date().toISOString(),
        counts,
        objects,
    };
}

interface BakeBucket {
    kind: QuickBuildStampKind;
    part: string;
    geometry: THREE.BufferGeometry;
    material: THREE.Material | THREE.Material[];
    matrices: THREE.Matrix4[];
    castShadow: boolean;
    receiveShadow: boolean;
    ownsResources: boolean;
}

const QUICK_BUILD_LIVE_BATCH_NAME = "Quick Build Live Batch";
const QUICK_BUILD_LIVE_VISIBILITY_KEY = "__quickBuildLivePreviousVisible";

function cloneMaterial(material: THREE.Material | THREE.Material[]) {
    if (Array.isArray(material)) {
        return material.map(item => item.clone());
    }
    return material.clone();
}

function materialSignature(material: THREE.Material) {
    const standard = material as THREE.MeshStandardMaterial;
    const color = standard.color?.getHexString?.() ?? "none";
    const map = standard.map;
    const image = map?.image as HTMLImageElement | undefined;
    const mapKey = map
        ? image?.currentSrc || image?.src || map.source?.uuid || map.uuid
        : "none";
    return [
        material.type,
        color,
        mapKey,
        String(material.transparent === true),
        String(Number((material.opacity ?? 1).toFixed(4))),
        String(standard.roughness ?? "na"),
        String(standard.metalness ?? "na"),
        String(material.side),
        String(material.depthWrite),
    ].join("|");
}

function materialBucketSignature(material: THREE.Material | THREE.Material[]) {
    return (Array.isArray(material) ? material : [material]).map(materialSignature).join("::");
}

function disposeMaterial(material: THREE.Material | THREE.Material[] | undefined) {
    if (!material) return;
    const materials = Array.isArray(material) ? material : [material];
    materials.forEach(item => item.dispose());
}

function disposeInstancedGroup(group: THREE.Object3D) {
    traverseObjectDepthFirst(group, child => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        (mesh as unknown as {dispose?: () => void}).dispose?.();
        if (mesh.userData?.quickBuildBatchOwnsResources === false) return;
        mesh.geometry?.dispose();
        disposeMaterial(mesh.material);
    });
}

function collectQuickBuildInstanceBuckets(root: THREE.Object3D | null | undefined, live: boolean): {
    buckets: Map<string, BakeBucket>;
    kindCounts: Record<QuickBuildStampKind, number>;
    sourceUuids: string[];
    objectCount: number;
    instanceCount: number;
} {
    const objects = collectQuickBuildObjects(root).filter(object => object.visible !== false);
    const buckets = new Map<string, BakeBucket>();
    const kindCounts = createKindCounts();
    const sourceUuids: string[] = [];
    let instanceCount = 0;

    for (const object of objects) {
        const metadata = getQuickBuildMetadata(object);
        if (!metadata) continue;

        updateObjectMatrixWorldDepthFirst(object, true);
        kindCounts[metadata.kind] += 1;
        sourceUuids.push(object.uuid);
        let meshIndex = 0;

        traverseObjectDepthFirst(object, child => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh || mesh.visible === false) return;

            const part = typeof mesh.userData?.quickBuildPart === "string" ? mesh.userData.quickBuildPart : `mesh-${meshIndex}`;
            const key = `${metadata.kind}:${part}:${meshIndex}:${mesh.geometry?.uuid ?? "no-geometry"}:${materialBucketSignature(mesh.material)}`;
            let bucket = buckets.get(key);
            if (!bucket) {
                bucket = {
                    kind: metadata.kind,
                    part,
                    geometry: live ? mesh.geometry : mesh.geometry.clone(),
                    material: live ? mesh.material : cloneMaterial(mesh.material),
                    matrices: [],
                    castShadow: mesh.castShadow,
                    receiveShadow: mesh.receiveShadow,
                    ownsResources: !live,
                };
                buckets.set(key, bucket);
            }
            bucket.matrices.push(mesh.matrixWorld.clone());
            instanceCount += 1;
            meshIndex++;
        });
    }

    return {
        buckets,
        kindCounts,
        sourceUuids,
        objectCount: objects.length,
        instanceCount,
    };
}

function createQuickBuildInstancedGroup(root: THREE.Object3D | null | undefined, live: boolean): THREE.Group | null {
    const {buckets, kindCounts, sourceUuids, objectCount, instanceCount} = collectQuickBuildInstanceBuckets(root, live);
    if (objectCount === 0 || buckets.size === 0) return null;

    const group = new THREE.Group();
    group.name = live ? QUICK_BUILD_LIVE_BATCH_NAME : "Quick Build Baked Batch";
    group.visible = live;
    group.userData.isStemObject = !live;
    group.userData.isSelectable = !live;
    group.userData.isRuntimeOnly = live;
    group.userData.isQuickBuildLiveBatch = live;
    group.userData.isQuickBuildBake = !live;
    group.userData.editorVisibility = live;
    group.userData.gameVisibility = !live;
    group.userData.enableAtStart = !live;

    const metadata = {
        schema: live ? "stem.quickBuildLiveBatch.v1" : "stem.quickBuildBake.v1",
        objectCount,
        instanceCount,
        sourceUuids,
        kindCounts,
    };
    if (live) {
        group.userData.quickBuildLiveBatch = metadata;
    } else {
        group.userData.quickBuildBake = metadata;
    }

    for (const bucket of buckets.values()) {
        const mesh = new THREE.InstancedMesh(bucket.geometry, bucket.material, bucket.matrices.length);
        mesh.name = `${live ? "Live" : "Baked"} ${bucket.kind} ${bucket.part}`;
        mesh.castShadow = bucket.castShadow;
        mesh.receiveShadow = bucket.receiveShadow;
        mesh.userData.isRuntimeOnly = live;
        mesh.userData.isSelectable = !live;
        mesh.userData.quickBuildBatchOwnsResources = bucket.ownsResources;
        bucket.matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        group.add(mesh);
    }

    return group;
}

export function createQuickBuildBakedBatch(root: THREE.Object3D | null | undefined): THREE.Group | null {
    return createQuickBuildInstancedGroup(root, false);
}

export function collectQuickBuildLiveBatchObjects(root: THREE.Object3D | null | undefined): THREE.Object3D[] {
    return collectQuickBuildSceneInventory(root).liveBatchObjects;
}

function restoreQuickBuildSourceVisibility(root: THREE.Object3D | null | undefined) {
    if (!root) return 0;

    let restored = 0;
    for (const object of collectQuickBuildObjects(root)) {
        traverseObjectDepthFirst(object, child => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh) return;
            if (!Object.prototype.hasOwnProperty.call(mesh.userData, QUICK_BUILD_LIVE_VISIBILITY_KEY)) return;

            mesh.visible = mesh.userData[QUICK_BUILD_LIVE_VISIBILITY_KEY] === true;
            delete mesh.userData[QUICK_BUILD_LIVE_VISIBILITY_KEY];
            restored += 1;
        });
    }
    return restored;
}

function hideQuickBuildSourceMeshes(root: THREE.Object3D | null | undefined) {
    if (!root) return 0;

    let hidden = 0;
    for (const object of collectQuickBuildObjects(root)) {
        traverseObjectDepthFirst(object, child => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh) return;
            if (!Object.prototype.hasOwnProperty.call(mesh.userData, QUICK_BUILD_LIVE_VISIBILITY_KEY)) {
                mesh.userData[QUICK_BUILD_LIVE_VISIBILITY_KEY] = mesh.visible === true;
            }
            if (mesh.visible) hidden += 1;
            mesh.visible = false;
        });
    }
    return hidden;
}

export function clearQuickBuildLiveBatches(root: THREE.Object3D | null | undefined, restoreSourceVisibility = true) {
    if (!root) return 0;

    const liveBatches = collectQuickBuildLiveBatchObjects(root);
    liveBatches.forEach(batch => {
        batch.parent?.remove(batch);
        disposeInstancedGroup(batch);
    });
    if (restoreSourceVisibility) {
        restoreQuickBuildSourceVisibility(root);
    }
    return liveBatches.length;
}

export function rebuildQuickBuildLiveBatch(root: THREE.Object3D | null | undefined): THREE.Group | null {
    if (!root) return null;

    clearQuickBuildLiveBatches(root, true);
    const liveBatch = createQuickBuildInstancedGroup(root, true);
    if (!liveBatch) return null;

    root.add(liveBatch);
    hideQuickBuildSourceMeshes(root);
    return liveBatch;
}

export function analyzeQuickBuildScene(
    root: THREE.Object3D | null | undefined,
    increment = 1,
): QuickBuildSceneStats {
    const inventory = collectQuickBuildSceneInventory(root);
    const quickBuildObjects = inventory.quickBuildObjects.filter(object => object.visible !== false);
    const materialIds = new Set<string>();
    let meshCount = 0;
    let triangleCount = 0;
    let staticEligibleCount = 0;

    for (const object of quickBuildObjects) {
        let hasDynamicTarget = false;

        traverseObjectDepthFirst(object, child => {
            if (child === object) return;
            if (child.matrixAutoUpdate !== false) {
                hasDynamicTarget = true;
            }

            if (!isMesh(child)) return;
            meshCount++;
            triangleCount += countGeometryTriangles(child.geometry);
            addMaterialIds(child.material, materialIds);
        });

        if (hasDynamicTarget) staticEligibleCount++;
    }

    const duplicateGroups = findQuickBuildDuplicateGroupsInObjects(quickBuildObjects, increment);
    const liveInstanceCount = inventory.liveBatchObjects.reduce(
        (count, batch) => count + (Number(batch.userData?.quickBuildLiveBatch?.instanceCount) || 0),
        0,
    );

    return {
        objectCount: quickBuildObjects.length,
        meshCount,
        triangleCount,
        materialCount: materialIds.size,
        duplicateCount: duplicateGroups.reduce((count, group) => count + group.remove.length, 0),
        duplicateGroupCount: duplicateGroups.length,
        staticEligibleCount,
        staticObjectCount: quickBuildObjects.length - staticEligibleCount,
        bakedBatchCount: inventory.bakeObjects.length,
        liveBatchCount: inventory.liveBatchObjects.length,
        liveInstanceCount,
    };
}
