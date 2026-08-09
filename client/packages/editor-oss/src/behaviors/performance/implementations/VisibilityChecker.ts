/**
 * Memory-safe visibility checker with bounded cache and efficient operations
 */
import {Camera, Frustum, Matrix4, Mesh, Object3D} from "three";
import { LRUCache } from 'lru-cache';
import { getVisibilityCacheConfig } from '../../../config/performance.config';
import { IdleWorkQueue } from '../../../lambdas/IdleWorkQueue';
import { IVisibilityChecker } from '../interfaces/IThrottleStrategy';
import {FrameWorldMatrixCache} from "../../../utils/FrameWorldMatrixCache";

interface CacheEntry {
    isVisible: boolean;
    cameraMatrixVersion: number;
    objectMatrixHash: number;
}

interface VisibilityCacheKey {
    objectUuid: string;
}

interface MatrixHashSnapshot {
    elements: Float64Array;
    hash: number;
}

interface CameraMatrixHashSnapshot {
    worldElements: Float64Array;
    projectionElements: Float64Array;
    hash: number;
}

// Configuration constants
const CLEANUP_INTERVAL_MS = 5000; // Clean every 5 seconds

export class VisibilityChecker implements IVisibilityChecker {
    private cache: LRUCache<VisibilityCacheKey, CacheEntry> | null = null;
    private readonly cacheMaxSize: number;
    private readonly cacheDefaultTTL: number;
    private cacheKeysByCameraUuid = new Map<string, WeakMap<Object3D, VisibilityCacheKey>>();
    private objectMatrixHashes = new WeakMap<Object3D, MatrixHashSnapshot>();
    private cameraMatrixHashes = new WeakMap<Camera, CameraMatrixHashSnapshot>();

    // Cache management
    private readonly proactiveCleanupIntervalMs: number;
    private readonly enableProactiveCleanup: boolean;
    private readonly debugMode: boolean;
    private lastCleanupTime = 0;
    private proactiveCleanupInterval: number | null = null;

    // Allocated only when deferred cleanup is used. The default proactive
    // cleanup path does not need an idle queue per checker instance.
    private idleQueue: IdleWorkQueue | null = null;

    // Statistics
    private stats = {
        hits: 0,
        misses: 0,
        cleanups: 0,
        itemsRemoved: 0,
        lastCleanupTime: 0,
    };

    // Per-camera version tracking
    private cameraVersions: Map<string, { version: number, hash: number }> = new Map();

    // Cached frustum per camera version (avoids recomputing per cache miss)
    private _cachedFrustum: Frustum = new Frustum();
    private _cachedFrustumMatrix: Matrix4 = new Matrix4();
    private _cachedFrustumVersion: number = -1;
    private _cachedFrustumCameraUuid: string = "";
    private _preparedFrameCamera: Camera | null = null;
    private _preparedFrameVersion: number = -1;
    private _preparedFrameActive = false;
    private readonly worldMatrixCache = new FrameWorldMatrixCache();

    constructor(_poolSize: number = 10) {
        const config = getVisibilityCacheConfig();

        this.proactiveCleanupIntervalMs = config.cleanupInterval;
        this.enableProactiveCleanup = config.enableProactiveCleanup;
        this.debugMode = config.debugMode;
        this.cacheMaxSize = config.maxSize;
        this.cacheDefaultTTL = config.defaultTTL;
    }

    beginFrame(camera: Camera): void {
        this.worldMatrixCache.beginFrame();
        this._preparedFrameCamera = camera;
        this._preparedFrameVersion = this.updateCameraVersion(camera);
        this._preparedFrameActive = true;
    }

    endFrame(): void {
        this.worldMatrixCache.endFrame();
        this._preparedFrameCamera = null;
        this._preparedFrameVersion = -1;
        this._preparedFrameActive = false;
    }

    isVisible(object: Object3D, camera: Camera): boolean {
        if (!(object as Mesh).geometry) {
            return true;
        }

        const objectId = object.uuid;
        const cameraId = camera.uuid;
        const cacheKey = this.getCacheKey(object, objectId, cameraId);

        // Update camera matrix version if camera actually moved
        const camVersion = this.getCameraVersion(camera);
        this.ensureWorldMatrix(object);
        const objectMatrixHash = this.getObjectMatrixHash(object);
        const cache = this.getCache();

        // Check cache first — version-based invalidation (no performance.now() needed)
        const cached = cache.get(cacheKey);
        if (
            cached &&
            cached.cameraMatrixVersion === camVersion &&
            cached.objectMatrixHash === objectMatrixHash
        ) {
            this.stats.hits++;
            return cached.isVisible;
        }
        this.stats.misses++;

        // Ensure frustum is computed for this camera version
        this.ensureFrustum(camera, camVersion);

        // Perform visibility check using cached frustum
        const isVisible = this.performVisibilityCheckCached(object);

        cache.set(cacheKey, {
            isVisible,
            cameraMatrixVersion: camVersion,
            objectMatrixHash,
        });

        // Periodic cleanup (deferred, only checked occasionally)
        if (this.stats.misses % 100 === 0) {
            this.performPeriodicCleanup(performance.now());
        }

        return isVisible;
    }

    private getCacheKey(object: Object3D, objectId: string, cameraId: string): VisibilityCacheKey {
        let cameraKeys = this.cacheKeysByCameraUuid.get(cameraId);
        if (!cameraKeys) {
            cameraKeys = new WeakMap();
            this.cacheKeysByCameraUuid.set(cameraId, cameraKeys);
        }

        let cacheKey = cameraKeys.get(object);
        if (!cacheKey || cacheKey.objectUuid !== objectId) {
            cacheKey = {objectUuid: objectId};
            cameraKeys.set(object, cacheKey);
        }
        return cacheKey;
    }

    clearCache(): void {
        this.cache?.clear();
        this.cacheKeysByCameraUuid.clear();
        this.objectMatrixHashes = new WeakMap();
        this.cameraMatrixHashes = new WeakMap();
        this.cameraVersions.clear();
        this.worldMatrixCache.reset();
    }

    dispose(): void {
        this.stopProactiveCleanup();
        this.idleQueue?.dispose();
        this.idleQueue = null;
        this.clearCache();
        this.cache = null;
        // Object pools will be garbage collected
    }

    private updateCameraVersion(camera: Camera): number {
        this.ensureWorldMatrix(camera);
        const hash = this.hashCamera(camera);

        let entry = this.cameraVersions.get(camera.uuid);
        if (!entry) {
            entry = { version: 0, hash };
            this.cameraVersions.set(camera.uuid, entry);
        } else if (entry.hash !== hash) {
            entry.version++;
            entry.hash = hash;
        }

        return entry.version;
    }

    private getCameraVersion(camera: Camera): number {
        if (this._preparedFrameActive && this._preparedFrameCamera === camera) {
            if (this._preparedFrameVersion < 0) {
                this._preparedFrameVersion = this.updateCameraVersion(camera);
            }
            return this._preparedFrameVersion;
        }
        return this.updateCameraVersion(camera);
    }

    /**
     * Compute frustum once per camera version, reuse for all objects in that frame
     * @param camera
     * @param version
     */
    private ensureFrustum(camera: Camera, version: number): void {
        if (version !== this._cachedFrustumVersion || camera.uuid !== this._cachedFrustumCameraUuid) {
            this._cachedFrustumMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
            this._cachedFrustum.setFromProjectionMatrix(this._cachedFrustumMatrix);
            this._cachedFrustumVersion = version;
            this._cachedFrustumCameraUuid = camera.uuid;
        }
    }

    private ensureWorldMatrix(object: Object3D): void {
        this.worldMatrixCache.ensureCurrent(object);
    }

    private hashCamera(camera: Camera): number {
        const worldElements = camera.matrixWorld.elements;
        const projectionElements = camera.projectionMatrix.elements;
        let snapshot = this.cameraMatrixHashes.get(camera);

        if (
            snapshot &&
            this.matrixElementsMatch(snapshot.worldElements, worldElements) &&
            this.matrixElementsMatch(snapshot.projectionElements, projectionElements)
        ) {
            return snapshot.hash;
        }

        let hash = this.hashMatrix(camera.matrixWorld);
        hash = this.hashMatrix(camera.projectionMatrix, hash);
        if (!snapshot) {
            snapshot = {
                worldElements: new Float64Array(16),
                projectionElements: new Float64Array(16),
                hash,
            };
            this.cameraMatrixHashes.set(camera, snapshot);
        } else {
            snapshot.hash = hash;
        }
        this.copyMatrixElements(snapshot.worldElements, worldElements);
        this.copyMatrixElements(snapshot.projectionElements, projectionElements);
        return hash;
    }

    private getObjectMatrixHash(object: Object3D): number {
        const elements = object.matrixWorld.elements;
        let snapshot = this.objectMatrixHashes.get(object);

        if (snapshot && this.matrixElementsMatch(snapshot.elements, elements)) {
            return snapshot.hash;
        }

        const hash = this.hashMatrix(object.matrixWorld);
        if (!snapshot) {
            snapshot = { elements: new Float64Array(16), hash };
            this.objectMatrixHashes.set(object, snapshot);
        } else {
            snapshot.hash = hash;
        }
        this.copyMatrixElements(snapshot.elements, elements);
        return hash;
    }

    private matrixElementsMatch(cached: Float64Array, current: ArrayLike<number>): boolean {
        for (let i = 0; i < 16; i++) {
            if (cached[i]! !== current[i]!) {
                return false;
            }
        }
        return true;
    }

    private copyMatrixElements(target: Float64Array, source: ArrayLike<number>): void {
        for (let i = 0; i < 16; i++) {
            target[i] = source[i]!;
        }
    }

    private hashMatrix(matrix: Matrix4, seed = 2166136261): number {
        const elements = matrix.elements;
        let hash = seed;
        for (let i = 0; i < 16; i++) {
            hash ^= Math.round(elements[i]! * 100000);
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    }

    /**
     * Fast visibility check using the pre-computed cached frustum
     * @param object
     */
    private performVisibilityCheckCached(object: Object3D): boolean {
        const mesh = object as Mesh;
        if (!mesh.geometry) return true;

        if (!mesh.geometry.boundingSphere) {
            try {
                mesh.geometry.computeBoundingSphere();
            } catch {
                return true;
            }
        }
        if (!mesh.geometry.boundingSphere) return true;

        try {
            return this._cachedFrustum.intersectsObject(mesh);
        } catch {
            return true;
        }
    }

    private performPeriodicCleanup(now: number): void {
        // Defer cleanup to idle time so it doesn't block the hot isVisible() path
        if (!this.enableProactiveCleanup && now - this.lastCleanupTime >= CLEANUP_INTERVAL_MS) {
            this.lastCleanupTime = now;
            this.getIdleQueue().schedule(() => this.performCleanup());
        }
    }

    private getIdleQueue(): IdleWorkQueue {
        if (!this.idleQueue) {
            this.idleQueue = new IdleWorkQueue();
        }
        return this.idleQueue;
    }

    private getCache(): LRUCache<VisibilityCacheKey, CacheEntry> {
        if (!this.cache) {
            this.cache = new LRUCache<VisibilityCacheKey, CacheEntry>({
                max: this.cacheMaxSize,
                ttl: this.cacheDefaultTTL,
            });

            if (this.enableProactiveCleanup) {
                this.startProactiveCleanup();
            }
        }
        return this.cache;
    }

    // Debugging/monitoring methods
    getCacheStats() {
        const cache = this.cache;
        return {
            size: cache?.size ?? 0,
            maxSize: cache?.max ?? this.cacheMaxSize,
            hits: this.stats.hits,
            misses: this.stats.misses,
            hitRate: this.stats.hits > 0 ? this.stats.hits / (this.stats.hits + this.stats.misses) : 0,
            cleanups: this.stats.cleanups,
            itemsRemoved: this.stats.itemsRemoved,
            trackedCameras: this.cameraVersions.size,
        };
    }

    private startProactiveCleanup(): void {
        if (typeof window !== 'undefined' && window.setInterval) {
            this.proactiveCleanupInterval = window.setInterval(() => {
                this.performProactiveCleanup();
            }, this.proactiveCleanupIntervalMs);
        }
    }

    private stopProactiveCleanup(): void {
        if (this.proactiveCleanupInterval !== null && typeof window !== 'undefined') {
            window.clearInterval(this.proactiveCleanupInterval);
            this.proactiveCleanupInterval = null;
        }
    }

    private performProactiveCleanup(): void {
        this.performCleanup();
    }

    private performCleanup(): void {
        if (!this.cache) {
            return;
        }
        const startTime = performance.now();
        const beforeSize = this.cache.size;
        this.cache.purgeStale();
        const removed = beforeSize - this.cache.size;

        // Update stats
        this.stats.cleanups++;
        this.stats.itemsRemoved += removed;
        this.stats.lastCleanupTime = performance.now() - startTime;

        // Log if entries were removed (debug mode)
        if (removed > 0 && this.debugMode) {
            console.debug(`[VisibilityChecker] Cleanup: removed ${removed} expired entries in ${this.stats.lastCleanupTime.toFixed(2)}ms`);
        }
    }
}
