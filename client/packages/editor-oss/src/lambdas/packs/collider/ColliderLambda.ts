import type {Object3D} from "three";

import {LambdaBase} from "../../LambdaBase";

const BROADPHASE_MIN_OBJECTS = 32;
const GRID_PRUNE_INTERVAL = 120;

/** Per-object collider component data. */
interface ColliderData {
    shape: string;
    sizeX: number;
    sizeY: number;
    sizeZ: number;
    [key: string]: unknown;
}

export default class ColliderLambda extends LambdaBase {
    private _activeCollisions: Set<string> = new Set();
    // Reuse between frames to avoid allocation
    private _currentCollisions: Set<string> = new Set();
    private _objectsCache: Object3D[] = [];
    private _dataCache: ColliderData[] = [];
    private _entriesDirty: boolean = true;
    private _maxColliderSpan: number = 1;
    private _spatialGrid: Map<string, number[]> = new Map();
    private _activeGridKeys: string[] = [];
    private _activeGridKeySet: Set<string> = new Set();
    private _testedPairIds: Set<number> = new Set();
    private _framesSinceGridPrune: number = 0;

    onObjectAdded(): void {
        this._entriesDirty = true;
    }

    onObjectRemoved(): void {
        this._entriesDirty = true;
    }

    private _pairKey(a: Object3D, b: Object3D): string {
        const idA = a.uuid;
        const idB = b.uuid;
        return idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`;
    }

    update(_deltaTime: number = 0.016): void {
        if (this._entriesDirty) {
            this._rebuildEntriesCache();
        }

        const count = this._objectsCache.length;
        const current = this._currentCollisions;
        current.clear();

        if (count < BROADPHASE_MIN_OBJECTS) {
            this._clearSpatialGrid();
            this._spatialGrid.clear();
            this._testAllPairs(count, current);
        } else {
            this._testSpatialPairs(count, current);
        }

        for (const key of this._activeCollisions) {
            if (!current.has(key)) {
                this._game?.engine?.call("lambdaEvent", null, {
                    event: "collisionExit",
                    lambdaId: this.id,
                    pairKey: key,
                });
            }
        }

        // Swap sets to avoid allocation
        const tmp = this._activeCollisions;
        this._activeCollisions = current;
        this._currentCollisions = tmp;
    }

    private _rebuildEntriesCache(): void {
        this._objectsCache.length = 0;
        this._dataCache.length = 0;

        let maxColliderSpan = 1;
        for (const [object, data] of this._registeredObjects as Map<Object3D, ColliderData>) {
            this._objectsCache.push(object);
            this._dataCache.push(data);
            maxColliderSpan = Math.max(maxColliderSpan, this._colliderSpan(data));
        }

        this._maxColliderSpan = maxColliderSpan;
        this._entriesDirty = false;
    }

    private _testAllPairs(count: number, current: Set<string>): void {
        for (let i = 0; i < count; i++) {
            for (let j = i + 1; j < count; j++) {
                this._testCollisionPair(i, j, current);
            }
        }
    }

    private _testSpatialPairs(count: number, current: Set<string>): void {
        this._clearSpatialGrid();

        const cellSize = this._maxColliderSpan;
        for (let i = 0; i < count; i++) {
            this._insertIntoSpatialGrid(i, cellSize);
        }

        for (let cellIndex = 0; cellIndex < this._activeGridKeys.length; cellIndex++) {
            const bucket = this._spatialGrid.get(this._activeGridKeys[cellIndex]!);
            if (!bucket || bucket.length < 2) {
                continue;
            }

            for (let i = 0; i < bucket.length; i++) {
                const indexA = bucket[i]!;
                for (let j = i + 1; j < bucket.length; j++) {
                    const indexB = bucket[j]!;
                    const low = indexA < indexB ? indexA : indexB;
                    const high = indexA < indexB ? indexB : indexA;
                    const pairId = low * count + high;

                    if (this._testedPairIds.has(pairId)) {
                        continue;
                    }
                    this._testedPairIds.add(pairId);
                    this._testCollisionPair(low, high, current);
                }
            }
        }

        this._pruneSpatialGridIfNeeded();
    }

    private _testCollisionPair(indexA: number, indexB: number, current: Set<string>): void {
        const objA = this._objectsCache[indexA]!;
        const dataA = this._dataCache[indexA]!;
        const objB = this._objectsCache[indexB]!;
        const dataB = this._dataCache[indexB]!;

        if (!this._intersects(objA, dataA, objB, dataB)) {
            return;
        }

        const key = this._pairKey(objA, objB);
        current.add(key);

        if (!this._activeCollisions.has(key)) {
            this._game?.engine?.call("lambdaEvent", null, {
                event: "collisionEnter",
                lambdaId: this.id,
                objectA: objA.uuid,
                objectB: objB.uuid,
            });
        }
    }

    private _clearSpatialGrid(): void {
        for (let i = 0; i < this._activeGridKeys.length; i++) {
            const bucket = this._spatialGrid.get(this._activeGridKeys[i]!);
            if (bucket) {
                bucket.length = 0;
            }
        }
        this._activeGridKeys.length = 0;
        this._activeGridKeySet.clear();
        this._testedPairIds.clear();
    }

    private _insertIntoSpatialGrid(index: number, cellSize: number): void {
        const object = this._objectsCache[index]!;
        const data = this._dataCache[index]!;
        const shape = data.shape;
        let hx: number;
        let hy: number;
        let hz: number;

        if (shape === "sphere") {
            const radius = this._safeSize(data.sizeX);
            hx = radius;
            hy = radius;
            hz = radius;
        } else if (shape === "box") {
            hx = this._safeSize(data.sizeX) * 0.5;
            hy = this._safeSize(data.sizeY) * 0.5;
            hz = this._safeSize(data.sizeZ) * 0.5;
        } else {
            const radius = Math.max(
                this._safeSize(data.sizeX),
                this._safeSize(data.sizeY),
                this._safeSize(data.sizeZ),
            ) * 0.5;
            hx = radius;
            hy = radius;
            hz = radius;
        }

        const minX = Math.floor((object.position.x - hx) / cellSize);
        const maxX = Math.floor((object.position.x + hx) / cellSize);
        const minY = Math.floor((object.position.y - hy) / cellSize);
        const maxY = Math.floor((object.position.y + hy) / cellSize);
        const minZ = Math.floor((object.position.z - hz) / cellSize);
        const maxZ = Math.floor((object.position.z + hz) / cellSize);

        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                for (let z = minZ; z <= maxZ; z++) {
                    const key = this._cellKey(x, y, z);
                    let bucket = this._spatialGrid.get(key);
                    if (!bucket) {
                        bucket = [];
                        this._spatialGrid.set(key, bucket);
                    }
                    if (!this._activeGridKeySet.has(key)) {
                        this._activeGridKeySet.add(key);
                        this._activeGridKeys.push(key);
                    }
                    bucket.push(index);
                }
            }
        }
    }

    private _pruneSpatialGridIfNeeded(): void {
        this._framesSinceGridPrune++;
        if (
            this._framesSinceGridPrune < GRID_PRUNE_INTERVAL &&
            this._spatialGrid.size <= Math.max(64, this._activeGridKeys.length * 4)
        ) {
            return;
        }

        this._framesSinceGridPrune = 0;
        for (const key of this._spatialGrid.keys()) {
            if (!this._activeGridKeySet.has(key)) {
                this._spatialGrid.delete(key);
            }
        }
    }

    private _cellKey(x: number, y: number, z: number): string {
        return `${x}:${y}:${z}`;
    }

    private _colliderSpan(data: ColliderData): number {
        if (data.shape === "sphere") {
            return Math.max(1, this._safeSize(data.sizeX) * 2);
        }
        return Math.max(
            1,
            this._safeSize(data.sizeX),
            this._safeSize(data.sizeY),
            this._safeSize(data.sizeZ),
        );
    }

    private _safeSize(value: number): number {
        return Number.isFinite(value) ? Math.abs(value) : 0;
    }

    private _intersects(
        objA: Object3D, dataA: ColliderData,
        objB: Object3D, dataB: ColliderData,
    ): boolean {
        const shapeA = dataA.shape;
        const shapeB = dataB.shape;

        if (shapeA === "sphere" && shapeB === "sphere") {
            return this._sphereSphere(objA, dataA.sizeX, objB, dataB.sizeX);
        }

        if (shapeA === "box" && shapeB === "box") {
            return this._boxBox(objA, dataA, objB, dataB);
        }

        // Mixed / capsule: fall back to sphere approximation
        const radiusA = shapeA === "sphere" ? dataA.sizeX : Math.max(dataA.sizeX, dataA.sizeY, dataA.sizeZ) * 0.5;
        const radiusB = shapeB === "sphere" ? dataB.sizeX : Math.max(dataB.sizeX, dataB.sizeY, dataB.sizeZ) * 0.5;
        return this._sphereSphere(objA, radiusA, objB, radiusB);
    }

    private _sphereSphere(a: Object3D, rA: number, b: Object3D, rB: number): boolean {
        const dx = a.position.x - b.position.x;
        const dy = a.position.y - b.position.y;
        const dz = a.position.z - b.position.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        const radii = rA + rB;
        return distSq <= radii * radii;
    }

    private _boxBox(
        a: Object3D, dA: ColliderData,
        b: Object3D, dB: ColliderData,
    ): boolean {
        const hxA = dA.sizeX * 0.5, hyA = dA.sizeY * 0.5, hzA = dA.sizeZ * 0.5;
        const hxB = dB.sizeX * 0.5, hyB = dB.sizeY * 0.5, hzB = dB.sizeZ * 0.5;

        return (
            Math.abs(a.position.x - b.position.x) <= hxA + hxB &&
            Math.abs(a.position.y - b.position.y) <= hyA + hyB &&
            Math.abs(a.position.z - b.position.z) <= hzA + hzB
        );
    }

    dispose(): void {
        this._activeCollisions.clear();
        this._currentCollisions.clear();
        this._objectsCache = [];
        this._dataCache = [];
        this._spatialGrid.clear();
        this._activeGridKeys = [];
        this._activeGridKeySet.clear();
        this._testedPairIds.clear();
        super.dispose();
    }
}
