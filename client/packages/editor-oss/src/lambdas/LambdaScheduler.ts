import { Camera, Object3D, Vector3 } from "three";

import { VisibilityChecker } from "@stem/editor-oss/behaviors/performance/implementations/VisibilityChecker";
import { IVisibilityChecker } from "@stem/editor-oss/behaviors/performance/interfaces/IThrottleStrategy";
import type { FrameContext, ISpatialGrid } from "@stem/editor-oss/scheduler/types";
import {setRuntimeUserDataValue} from "@stem/editor-oss/utils/userDataRuntime";
import {FrameWorldMatrixCache} from "@stem/editor-oss/utils/FrameWorldMatrixCache";

export interface LambdaSchedulerConfig {
    targetFPS: number;
    frameBudgetMs: number; // e.g. 8ms for game logic

    // Fallback throttling when healthy
    defaultThrottleFactor: number;

    // Distance LOD thresholds (squared). Defaults match ThrottleContainer.
    farDistanceSq: number;
    veryFarDistanceSq: number;
}

const DEFAULT_CONFIG: LambdaSchedulerConfig = {
    targetFPS: 60,
    frameBudgetMs: 12,
    defaultThrottleFactor: 1,
    farDistanceSq: 2500,      // ~50m
    veryFarDistanceSq: 10000, // ~100m
};

export class LambdaScheduler {
    private static readonly MAX_THROTTLE_CHANGE_LOGS = 8;

    private visibilityChecker: IVisibilityChecker;
    private frameCount: number = 0;
    private lastFrameTime: number = 0;
    private _frameStartTime: number = 0;
    private throttleFactor: number = 1; // 1 = every frame, 2 = every other, etc.

    // EMA smoothing for adaptive throttle
    private avgFrameTime: number = 16.67;
    private readonly EMA_ALPHA = 0.1;

    // Aux vectors to avoid GC
    private _camPos = new Vector3();
    private _objPos = new Vector3();
    private _camCachedFrame: number = -1; // frame when _camPos was last computed
    private _cachedCameraUuid: string = "";
    private _visibilityPreparedFrame: number = -1;
    private _visibilityPreparedCameraUuid: string = "";

    private config: LambdaSchedulerConfig;
    private spatialGrid: ISpatialGrid | null = null;
    private throttleChangeLogCount = 0;
    private objectHashCache = new WeakMap<Object3D, number>();
    private readonly worldMatrixCache = new FrameWorldMatrixCache();

    constructor(config: Partial<LambdaSchedulerConfig> = {}) {
        this.config = this.normalizeConfig({ ...DEFAULT_CONFIG, ...config });
        this.throttleFactor = this.config.defaultThrottleFactor;
        this.visibilityChecker = new VisibilityChecker();
    }

    /**
     * Attach a spatial grid for O(1) distance lookups.
     * @param grid
     */
    setSpatialGrid(grid: ISpatialGrid | null): void {
        this.spatialGrid = grid;
    }

    /** Absolute frame deadline from orchestrator (safe default: now + frameBudgetMs) */
    private _frameDeadline: number = 0;

    /** Absolute deadline for the current frame — shared with orchestrator */
    get frameDeadline(): number {
        return this._frameDeadline;
    }

    get frameBudgetMs(): number {
        return this.config.frameBudgetMs;
    }

    /** Timestamp when the current frame began — avoids redundant performance.now() calls in lambdas */
    get frameStartTime(): number {
        return this._frameStartTime;
    }

    beginFrame(contextOrFrameCount?: FrameContext | number) {
        this.worldMatrixCache.beginFrame();
        const context: Partial<Pick<FrameContext, "frameCount" | "frameDeadline" | "frameStartTime">> | undefined =
            typeof contextOrFrameCount === "number"
            ? { frameCount: contextOrFrameCount }
            : contextOrFrameCount;

        if (typeof contextOrFrameCount === "object" && contextOrFrameCount) {
            this.spatialGrid = contextOrFrameCount.spatialGrid ?? null;
        }

        if (context?.frameCount !== undefined) {
            this.frameCount = context.frameCount;
        } else {
            this.frameCount++;
        }

        const now = context?.frameStartTime ?? performance.now();
        // Use orchestrator deadline when available.
        this._frameDeadline = context?.frameDeadline ?? (now + this.config.frameBudgetMs);
        this._frameStartTime = now;
        const previousThrottleFactor = this.throttleFactor;
        if (this.lastFrameTime > 0) {
            const dt = now - this.lastFrameTime;
            // EMA smoothing — prevents single-frame spikes from changing throttle
            this.avgFrameTime = this.EMA_ALPHA * dt + (1 - this.EMA_ALPHA) * this.avgFrameTime;

            const targetFrameTime = 1000 / this.config.targetFPS;

            // Wider dead zone to avoid oscillation
            if (this.avgFrameTime > targetFrameTime * 1.2) {
                this.throttleFactor = Math.min(this.throttleFactor + 1, 4);
            } else if (
                this.avgFrameTime < targetFrameTime * 0.85 &&
                this.throttleFactor > this.config.defaultThrottleFactor
            ) {
                this.throttleFactor = Math.max(this.config.defaultThrottleFactor, this.throttleFactor - 1);
            }
        }
        this.lastFrameTime = now;

        if (
            previousThrottleFactor !== this.throttleFactor &&
            this.throttleChangeLogCount < LambdaScheduler.MAX_THROTTLE_CHANGE_LOGS
        ) {
            this.throttleChangeLogCount++;
            console.debug(
                `[LambdaScheduler] throttle ${previousThrottleFactor}->${this.throttleFactor} ` +
                `frame=${this.frameCount} avgFrameTime=${this.avgFrameTime.toFixed(1)}ms ` +
                `spatialGrid=${!!this.spatialGrid}`,
            );
        }
    }

    /**
     * Determines if a specific object should be processed this frame.
     * Returns 0 if should skip.
     * Returns > 0 (the throttle multiplier) if should process.
     * Multiplier should be used to adjust deltaTime (e.g. pos += vel * dt * multiplier)
     * @param object
     * @param camera
     * @param _index
     * @param isCritical
     */
    shouldProcess(
        object: Object3D,
        camera: Camera,
        _index: number,
        isCritical: boolean = false,
    ): number {
        if (isCritical) return 1;

        // 1. Distance/Visibility Check — cache camera position once per frame per camera
        if (this._camCachedFrame !== this.frameCount || this._cachedCameraUuid !== camera.uuid) {
            this.readCameraPosition(camera);
            this._camCachedFrame = this.frameCount;
            this._cachedCameraUuid = camera.uuid;
        }

        // Use spatial grid for O(1) distance lookup when available
        let distSq: number;
        const gridDist = this.spatialGrid?.getDistanceSq(object.uuid, this._camPos);
        if (gridDist !== null && gridDist !== undefined) {
            distSq = gridDist;
        } else {
            this.readObjectPosition(object);
            distSq = this._objPos.distanceToSquared(this._camPos);
        }

        // LOD Levels
        let localThrottle = this.throttleFactor;

        if (distSq > this.config.farDistanceSq) {
            localThrottle = Math.max(localThrottle, 4);

            if (distSq > this.config.veryFarDistanceSq) {
                localThrottle = Math.max(localThrottle, 10);
            }
        }

        // Stable interleave using object uuid hash (immune to add/remove index shifts)
        const hash = this.getObjectHash(object);
        const frameMod = this.frameCount % localThrottle;

        // Cheap early out: if distance/adaptive throttling already skips this
        // frame, avoid frustum cache lookups and bounding-sphere work.
        if (localThrottle > 1 && hash % localThrottle !== frameMod) {
            return 0;
        }

        // Visibility Check (Frustum Culling)
        // We do NOT stop completely to allow game logic (like AI moving behind you) to continue roughly.
        this.prepareVisibilityFrame(camera);
        if (!this.visibilityChecker.isVisible(object, camera)) {
            localThrottle = Math.max(localThrottle, 20);
        }
        const shouldRun = hash % localThrottle === this.frameCount % localThrottle;

        return shouldRun ? Math.min(localThrottle, 3) : 0;
    }

    private readCameraPosition(camera: Camera): void {
        if (this.worldMatrixCache.isCurrent(camera)) {
            this._camPos.setFromMatrixPosition(camera.matrixWorld);
            return;
        }
        camera.getWorldPosition(this._camPos);
        this.worldMatrixCache.markCurrent(camera);
    }

    private readObjectPosition(object: Object3D): void {
        if (this.worldMatrixCache.isCurrent(object)) {
            this._objPos.setFromMatrixPosition(object.matrixWorld);
            return;
        }
        object.getWorldPosition(this._objPos);
        this.worldMatrixCache.markCurrent(object);
    }

    private getObjectHash(object: Object3D): number {
        const cachedHash = this.objectHashCache.get(object);
        if (cachedHash !== undefined) {
            return cachedHash;
        }

        let hash = object.userData._lambdaHash;
        if (typeof hash !== "number" || !Number.isFinite(hash)) {
            hash = this.stableHash(object.uuid);
            this.cacheObjectHash(object, hash);
            return hash;
        }

        if (Object.prototype.propertyIsEnumerable.call(object.userData, "_lambdaHash")) {
            this.cacheObjectHash(object, hash);
        }
        return hash;
    }

    private cacheObjectHash(object: Object3D, hash: number): void {
        this.objectHashCache.set(object, hash);
        setRuntimeUserDataValue(object, "_lambdaHash", hash);
    }

    private prepareVisibilityFrame(camera: Camera): void {
        if (
            this._visibilityPreparedFrame === this.frameCount &&
            this._visibilityPreparedCameraUuid === camera.uuid
        ) {
            return;
        }
        this.visibilityChecker.beginFrame?.(camera);
        this._visibilityPreparedFrame = this.frameCount;
        this._visibilityPreparedCameraUuid = camera.uuid;
    }

    /**
     * Simple string hash that returns a stable non-negative integer
     * @param uuid
     */
    private stableHash(uuid: string): number {
        let h = 0;
        for (let i = 0; i < uuid.length; i++) {
            h = (h << 5) - h + uuid.charCodeAt(i) | 0;
        }
        return Math.abs(h);
    }

    /**
     * Update scheduler config at runtime (e.g. from quality system).
     * @param patch
     */
    updateConfig(patch: Partial<LambdaSchedulerConfig>): void {
        const previousDefaultThrottleFactor = this.config.defaultThrottleFactor;
        this.config = this.normalizeConfig({ ...this.config, ...patch });
        if (this.config.defaultThrottleFactor > previousDefaultThrottleFactor) {
            this.throttleFactor = Math.max(this.throttleFactor, this.config.defaultThrottleFactor);
        } else if (this.throttleFactor < this.config.defaultThrottleFactor) {
            this.throttleFactor = this.config.defaultThrottleFactor;
        }
    }

    dispose() {
        this.worldMatrixCache.reset();
        this.visibilityChecker.endFrame?.();
        this.visibilityChecker.dispose();
        this.objectHashCache = new WeakMap<Object3D, number>();
    }

    private normalizeConfig(config: LambdaSchedulerConfig): LambdaSchedulerConfig {
        const farDistanceSq = this.positiveNumber(
            config.farDistanceSq,
            DEFAULT_CONFIG.farDistanceSq,
        );
        const veryFarDistanceSq =
            Number.isFinite(config.veryFarDistanceSq) && config.veryFarDistanceSq >= farDistanceSq
                ? config.veryFarDistanceSq
                : Math.max(farDistanceSq, DEFAULT_CONFIG.veryFarDistanceSq);

        return {
            ...config,
            targetFPS: this.positiveNumber(config.targetFPS, DEFAULT_CONFIG.targetFPS),
            frameBudgetMs: this.positiveNumber(config.frameBudgetMs, DEFAULT_CONFIG.frameBudgetMs),
            defaultThrottleFactor: Math.max(1, Math.min(4, Math.floor(config.defaultThrottleFactor || 1))),
            farDistanceSq,
            veryFarDistanceSq,
        };
    }

    private positiveNumber(value: number, fallback: number): number {
        return Number.isFinite(value) && value > 0 ? value : fallback;
    }
}
