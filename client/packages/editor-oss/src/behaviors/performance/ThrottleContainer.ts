/**
 * Dependency injection container for behavior throttling
 * Industry-standard explicit priority-based throttling system
 */
import {Camera, Object3D, Vector3} from "three";
import type { ISpatialGrid } from '../../scheduler/types';
import { Behavior } from '../Behavior';
import {FrameWorldMatrixCache} from "../../utils/FrameWorldMatrixCache";
import { VisibilityChecker } from './implementations/VisibilityChecker';
import {
    IBehaviorThrottler,
    IVisibilityChecker,
    IDistanceThrottler,
    IPerformanceMonitor,
    IConfigValidator,
    IThrottleConfig,
    IThrottleDecision,
    IPerformanceMetrics,
    BehaviorThrottlePriority,
} from './interfaces/IThrottleStrategy';

type ThrottledBehavior = Behavior & {
    _throttleHash?: number;
};

export interface IThrottleContainer {
    createBehaviorThrottler(config?: Partial<IThrottleConfig>): IBehaviorThrottler;
    createVisibilityChecker(): IVisibilityChecker;
    createDistanceThrottler(): IDistanceThrottler;
    createPerformanceMonitor(): IPerformanceMonitor;
    createConfigValidator(): IConfigValidator;
}

/**
 * Default configuration for throttling system with explicit priority factors
 * Optimized for character movement stability
 */
const DEFAULT_THROTTLE_CONFIG: IThrottleConfig = {
    farDistanceSq: 2500,
    veryFarDistanceSq: 10000,
    farThrottleFactor: 2,        // Reduced from 3 - lighter throttling for better smoothness
    veryFarThrottleFactor: 5,    // Reduced from 10 - prevent aggressive throttling
    enableFrustumCulling: true,
    enableDistanceThrottling: true,
    enablePerformanceReporting: false,
    throttlingEnabled: true,     // Global throttling enable/disable
    priorityThrottleFactors: {
        [BehaviorThrottlePriority.CRITICAL]: 1,  // Never throttle
        [BehaviorThrottlePriority.HIGH]: 1,      // Changed from 2 - critical behaviors shouldn't be throttled
        [BehaviorThrottlePriority.MEDIUM]: 2,    // Changed from 3 - lighter throttling
        [BehaviorThrottlePriority.LOW]: 3,       // Changed from 5 - moderate throttling
        [BehaviorThrottlePriority.MINIMAL]: 5,    // Changed from 10 - less aggressive
    },
};

export class ThrottleContainer implements IThrottleContainer {
    createBehaviorThrottler(config?: Partial<IThrottleConfig>): IBehaviorThrottler {
        const validator = this.createConfigValidator();
        const finalConfig = validator.validate({
            ...DEFAULT_THROTTLE_CONFIG,
            ...config,
        });

        return new BehaviorThrottler(
            this.createVisibilityChecker(),
            this.createDistanceThrottler(),
            this.createPerformanceMonitor(),
            finalConfig,
        );
    }

    createVisibilityChecker(): IVisibilityChecker {
        return new VisibilityChecker();
    }

    createDistanceThrottler(): IDistanceThrottler {
        return new DistanceThrottler();
    }

    createPerformanceMonitor(): IPerformanceMonitor {
        return new PerformanceMonitor();
    }

    createConfigValidator(): IConfigValidator {
        return new ConfigValidator();
    }
}

// Implementation classes - these should ideally be in separate files for better organization

class BehaviorThrottler implements IBehaviorThrottler {
    // Adaptive throttle scaling (mirrors LambdaScheduler EMA pattern)
    private adaptiveMultiplier: number = 1;
    private avgFrameTime: number = 16.67;
    private lastFrameTime: number = 0;
    private readonly EMA_ALPHA = 0.1;
    private performanceReportingEnabled: boolean;
    // External pressure signal from orchestrator (1 = no pressure, up to 4)
    private _externalPressureMultiplier: number = 1;
    private frameModuloCacheFrames = new Int32Array(61);
    private frameModuloCacheValues = new Int8Array(61);
    private distanceFrameCamera: Camera | null = null;
    private visibilityFrameCamera: Camera | null = null;

    constructor(
        private readonly visibilityChecker: IVisibilityChecker,
        private readonly distanceThrottler: IDistanceThrottler,
        private readonly performanceMonitor: IPerformanceMonitor,
        private config: IThrottleConfig,
    ) {
        this.performanceReportingEnabled = config.enablePerformanceReporting;
    }

    /** Call once per frame before processing behaviors to update adaptive throttle */
    beginFrame(_camera?: Camera): void {
        const now = performance.now();
        if (this.lastFrameTime > 0) {
            const dt = now - this.lastFrameTime;
            this.avgFrameTime = this.EMA_ALPHA * dt + (1 - this.EMA_ALPHA) * this.avgFrameTime;
            const target = 16.67; // 60fps
            if (this.avgFrameTime > target * 1.2) {
                this.adaptiveMultiplier = Math.min(this.adaptiveMultiplier + 1, 4);
            } else if (this.avgFrameTime < target * 0.85 && this.adaptiveMultiplier > 1) {
                this.adaptiveMultiplier = Math.max(1, this.adaptiveMultiplier - 1);
            }
        }
        this.lastFrameTime = now;
        // Merge external orchestrator pressure (take the higher of local vs external)
        this.adaptiveMultiplier = Math.max(this.adaptiveMultiplier, this._externalPressureMultiplier);
        this.distanceFrameCamera = null;
        this.visibilityFrameCamera = null;
    }

    endFrame(): void {
        if (this.distanceFrameCamera) {
            this.distanceThrottler.endFrame?.();
            this.distanceFrameCamera = null;
        }
        if (this.visibilityFrameCamera) {
            this.visibilityChecker.endFrame?.();
            this.visibilityFrameCamera = null;
        }
    }

    setPressureMultiplier(multiplier: number): void {
        this._externalPressureMultiplier = this.normalizeScheduleFactor(multiplier, 1, 4);
    }

    shouldUpdateBehavior(
        behavior: Behavior,
        camera: Camera,
        frameCount: number,
    ): IThrottleDecision {
        if (this.performanceReportingEnabled) {
            this.performanceMonitor.recordCheck();
        }

        // STEP 0: Check if throttling is globally disabled
        if (!this.config.throttlingEnabled) {
            return { shouldUpdate: true, reason: 'throttling-disabled' };
        }

        // STEP 1: Check explicit priority - industry standard approach
        const priorityFactor = this.config.priorityThrottleFactors[behavior.throttleConfig.throttlePriority];

        // CRITICAL behaviors always update
        if (behavior.throttleConfig.throttlePriority === BehaviorThrottlePriority.CRITICAL) {
            return { shouldUpdate: true, reason: 'critical-priority' };
        }

        // STEP 1b: Check requiresConsistentUpdates flag - these behaviors need every frame
        if (behavior.throttleConfig.requiresConsistentUpdates) {
            return { shouldUpdate: true, reason: 'requires-consistent-updates' };
        }

        // STEP 2: Check if no target
        if (!behavior.target) {
            return { shouldUpdate: true, reason: 'no-target' };
        }

        // STEP 3: Compute combined throttle factor (priority × distance × adaptive)
        let combinedFactor = Math.max(priorityFactor, this.adaptiveMultiplier);

        if (this.config.enableDistanceThrottling && behavior.throttleConfig.enableDistanceThrottling) {
            this.prepareDistanceFrame(camera);
            const distanceFactor = this.distanceThrottler.getDistanceFactor(behavior.target, camera, frameCount);
            combinedFactor = Math.min(priorityFactor * distanceFactor, 60);
            combinedFactor = Math.max(combinedFactor, this.adaptiveMultiplier);
        }

        // STEP 4: Frustum culling — boost throttle instead of hard-cull
        // Invisible behaviors still run at heavily reduced rate (e.g. AI behind camera)
        if (this.config.enableFrustumCulling && behavior.throttleConfig.enableFrustumCulling) {
            this.prepareVisibilityFrame(camera);
            const isVisible = this.visibilityChecker.isVisible(behavior.target, camera);
            if (!isVisible) {
                if (this.performanceReportingEnabled) {
                    this.performanceMonitor.recordCull();
                }
                // Opt-in full skip for visual-only behaviors (not CRITICAL)
                if (behavior.throttleConfig.skipWhenInvisible) {
                    return { shouldUpdate: false, reason: 'invisible-skip' };
                }
                combinedFactor = Math.max(combinedFactor, 20);
            }
        }

        // STEP 5: Stable interleave using UUID hash (prevents frame spikes)
        // Without this, ALL behaviors with factor=3 skip the same frames.
        // Hash spreads them evenly so ~1/3 run each frame.
        const scheduleFactor = this.normalizeScheduleFactor(combinedFactor);
        if (scheduleFactor > 1) {
            const hash = this.getThrottleHash(behavior);
            if (hash % scheduleFactor !== this.getFrameModulo(frameCount, scheduleFactor)) {
                if (this.performanceReportingEnabled) {
                    this.performanceMonitor.recordThrottle();
                }
                return {
                    shouldUpdate: false,
                    reason: `throttled-factor-${scheduleFactor}`,
                    priority: scheduleFactor,
                };
            }
        }

        return { shouldUpdate: true, reason: 'passed-all-checks' };
    }

    shouldUpdateBehaviorFast(
        behavior: Behavior,
        camera: Camera,
        frameCount: number,
    ): boolean {
        if (this.performanceReportingEnabled) {
            this.performanceMonitor.recordCheck();
        }

        if (!this.config.throttlingEnabled) {
            return true;
        }

        const priorityFactor = this.config.priorityThrottleFactors[behavior.throttleConfig.throttlePriority];

        if (behavior.throttleConfig.throttlePriority === BehaviorThrottlePriority.CRITICAL) {
            return true;
        }

        if (behavior.throttleConfig.requiresConsistentUpdates) {
            return true;
        }

        if (!behavior.target) {
            return true;
        }

        let combinedFactor = Math.max(priorityFactor, this.adaptiveMultiplier);

        if (this.config.enableDistanceThrottling && behavior.throttleConfig.enableDistanceThrottling) {
            this.prepareDistanceFrame(camera);
            const distanceFactor = this.distanceThrottler.getDistanceFactor(behavior.target, camera, frameCount);
            combinedFactor = Math.min(priorityFactor * distanceFactor, 60);
            combinedFactor = Math.max(combinedFactor, this.adaptiveMultiplier);
        }

        if (this.config.enableFrustumCulling && behavior.throttleConfig.enableFrustumCulling) {
            this.prepareVisibilityFrame(camera);
            const isVisible = this.visibilityChecker.isVisible(behavior.target, camera);
            if (!isVisible) {
                if (this.performanceReportingEnabled) {
                    this.performanceMonitor.recordCull();
                }
                if (behavior.throttleConfig.skipWhenInvisible) {
                    return false;
                }
                combinedFactor = Math.max(combinedFactor, 20);
            }
        }

        const scheduleFactor = this.normalizeScheduleFactor(combinedFactor);
        if (scheduleFactor > 1) {
            const hash = this.getThrottleHash(behavior);
            if (hash % scheduleFactor !== this.getFrameModulo(frameCount, scheduleFactor)) {
                if (this.performanceReportingEnabled) {
                    this.performanceMonitor.recordThrottle();
                }
                return false;
            }
        }

        return true;
    }

    private prepareDistanceFrame(camera: Camera): void {
        if (this.distanceFrameCamera === camera) {
            return;
        }
        if (this.distanceFrameCamera) {
            this.distanceThrottler.endFrame?.();
        }
        this.distanceThrottler.beginFrame?.(camera);
        this.distanceFrameCamera = camera;
    }

    private prepareVisibilityFrame(camera: Camera): void {
        if (this.visibilityFrameCamera === camera) {
            return;
        }
        if (this.visibilityFrameCamera) {
            this.visibilityChecker.endFrame?.();
        }
        this.visibilityChecker.beginFrame?.(camera);
        this.visibilityFrameCamera = camera;
    }

    private getFrameModulo(frameCount: number, scheduleFactor: number): number {
        if (scheduleFactor <= 1) {
            return 0;
        }

        if (scheduleFactor < this.frameModuloCacheFrames.length) {
            if (this.frameModuloCacheFrames[scheduleFactor] !== frameCount) {
                this.frameModuloCacheFrames[scheduleFactor] = frameCount;
                this.frameModuloCacheValues[scheduleFactor] = frameCount % scheduleFactor;
            }
            return this.frameModuloCacheValues[scheduleFactor]!;
        }

        return frameCount % scheduleFactor;
    }

    private getThrottleHash(behavior: Behavior): number {
        const throttledBehavior = behavior as ThrottledBehavior;
        let hash = throttledBehavior._throttleHash;
        if (hash === undefined) {
            hash = this.stableHash(behavior.uuid);
            throttledBehavior._throttleHash = hash;
        }
        return hash;
    }

    private normalizeScheduleFactor(factor: number, min = 1, max = 60): number {
        if (!Number.isFinite(factor)) {
            return min;
        }
        return Math.max(min, Math.min(max, Math.ceil(factor)));
    }

    /**
     * Simple string hash returning a stable non-negative integer
     * @param uuid
     */
    private stableHash(uuid: string): number {
        let h = 0;
        for (let i = 0; i < uuid.length; i++) {
            h = (h << 5) - h + uuid.charCodeAt(i) | 0;
        }
        return Math.abs(h);
    }

    configure(config: Partial<IThrottleConfig>): void {
        const validator = new ConfigValidator();
        this.config = validator.validate({ ...this.config, ...config });
        this.performanceReportingEnabled = this.config.enablePerformanceReporting;
        this.distanceThrottler.updateConfig(this.config);
    }

    getMetrics(): IPerformanceMetrics {
        return this.performanceMonitor.getMetrics();
    }

    setSpatialGrid(grid: ISpatialGrid | null): void {
        this.distanceThrottler.setSpatialGrid?.(grid);
    }

    dispose(): void {
        this.distanceThrottler.endFrame?.();
        this.visibilityChecker.dispose();
        this.performanceMonitor.dispose();
    }
}

class DistanceThrottler implements IDistanceThrottler {
    private config: IThrottleConfig = DEFAULT_THROTTLE_CONFIG;
    private objectWorldPosAux = new Vector3();
    private cameraWorldPosAux = new Vector3();
    private spatialGrid: ISpatialGrid | null = null;
    private cameraCachedFrame = -1;
    private cameraCachedUuid = "";
    private preparedFrameCamera: Camera | null = null;
    private readonly worldMatrixCache = new FrameWorldMatrixCache();

    setSpatialGrid(grid: ISpatialGrid | null): void {
        this.spatialGrid = grid;
    }

    beginFrame(camera: Camera): void {
        this.worldMatrixCache.beginFrame();
        this.readWorldPosition(camera, this.cameraWorldPosAux);
        this.cameraCachedFrame = -1;
        this.cameraCachedUuid = camera.uuid;
        this.preparedFrameCamera = camera;
    }

    endFrame(): void {
        this.worldMatrixCache.endFrame();
        this.preparedFrameCamera = null;
    }

    private getDistanceSq(object: Object3D, camera: Camera, frameCount?: number): number {
        const cameraPosition = this.getCameraWorldPosition(camera, frameCount);
        // Use spatial grid for O(1) lookup when available
        if (this.spatialGrid) {
            const gridDist = this.spatialGrid.getDistanceSq(object.uuid, cameraPosition);
            if (gridDist !== null && gridDist !== undefined) {
                return gridDist;
            }
        }
        // Fallback: compute world positions (O(n) path)
        this.readWorldPosition(object, this.objectWorldPosAux);
        return this.objectWorldPosAux.distanceToSquared(cameraPosition);
    }

    getDistanceFactor(object: Object3D, camera: Camera, frameCount?: number): number {
        const distanceSq = this.getDistanceSq(object, camera, frameCount);
        if (distanceSq > this.config.veryFarDistanceSq) return this.config.veryFarThrottleFactor;
        if (distanceSq > this.config.farDistanceSq) return this.config.farThrottleFactor;
        return 1;
    }

    shouldThrottle(object: Object3D, camera: Camera, frameCount: number): IThrottleDecision {
        const distanceSq = this.getDistanceSq(object, camera, frameCount);

        if (distanceSq > this.config.veryFarDistanceSq) {
            const shouldUpdate = frameCount % this.config.veryFarThrottleFactor === 0;
            return {
                shouldUpdate,
                reason: shouldUpdate ? 'very-far-throttled-update' : 'very-far-throttled-skip',
                priority: 1,
            };
        } else if (distanceSq > this.config.farDistanceSq) {
            const shouldUpdate = frameCount % this.config.farThrottleFactor === 0;
            return {
                shouldUpdate,
                reason: shouldUpdate ? 'far-throttled-update' : 'far-throttled-skip',
                priority: 2,
            };
        }

        return { shouldUpdate: true, reason: 'close-object', priority: 3 };
    }

    updateConfig(config: IThrottleConfig): void {
        this.config = config;
    }

    private getCameraWorldPosition(camera: Camera, frameCount?: number): Vector3 {
        if (this.preparedFrameCamera === camera) {
            return this.cameraWorldPosAux;
        }

        if (
            frameCount !== undefined &&
            this.cameraCachedFrame === frameCount &&
            this.cameraCachedUuid === camera.uuid &&
            this.worldMatrixCache.isCurrent(camera)
        ) {
            return this.cameraWorldPosAux;
        }

        this.readWorldPosition(camera, this.cameraWorldPosAux);
        this.cameraCachedFrame = frameCount ?? -1;
        this.cameraCachedUuid = camera.uuid;
        return this.cameraWorldPosAux;
    }

    private readWorldPosition(object: Object3D, target: Vector3): void {
        if (!this.worldMatrixCache.isCurrent(object)) {
            object.updateWorldMatrix(true, false);
            this.worldMatrixCache.markCurrent(object);
        }
        target.setFromMatrixPosition(object.matrixWorld);
    }
}

class PerformanceMonitor implements IPerformanceMonitor {
    private metrics = {
        totalChecks: 0,
        culledCount: 0,
        throttledCount: 0,
        startTime: performance.now(),
    };

    recordCheck(): void {
        this.metrics.totalChecks++;
    }

    recordCull(): void {
        this.metrics.culledCount++;
    }

    recordThrottle(): void {
        this.metrics.throttledCount++;
    }

    getMetrics(): IPerformanceMetrics {
        const runTime = performance.now() - this.metrics.startTime;
        return {
            totalChecks: this.metrics.totalChecks,
            culledCount: this.metrics.culledCount,
            throttledCount: this.metrics.throttledCount,
            runTimeMs: runTime,
            cullingEfficiency: this.metrics.totalChecks > 0 ?
                this.metrics.culledCount / this.metrics.totalChecks * 100 : 0,
            throttlingEfficiency: this.metrics.totalChecks > 0 ?
                this.metrics.throttledCount / this.metrics.totalChecks * 100 : 0,
        };
    }

    dispose(): void {
        // Reset metrics
        this.metrics = {
            totalChecks: 0,
            culledCount: 0,
            throttledCount: 0,
            startTime: performance.now(),
        };
    }
}

class ConfigValidator implements IConfigValidator {
    validate(config: Partial<IThrottleConfig>): IThrottleConfig {
        const configuredPriorityFactors = config.priorityThrottleFactors as Partial<Record<BehaviorThrottlePriority, number>> | undefined;

        return {
            farDistanceSq: this.validateNumber(config.farDistanceSq, DEFAULT_THROTTLE_CONFIG.farDistanceSq, 100, 100000),
            veryFarDistanceSq: this.validateNumber(
                config.veryFarDistanceSq,
                DEFAULT_THROTTLE_CONFIG.veryFarDistanceSq,
                config.farDistanceSq || DEFAULT_THROTTLE_CONFIG.farDistanceSq,
                1000000,
            ),
            farThrottleFactor: this.validateScheduleFactor(
                config.farThrottleFactor,
                DEFAULT_THROTTLE_CONFIG.farThrottleFactor,
                60,
            ),
            veryFarThrottleFactor: this.validateScheduleFactor(
                config.veryFarThrottleFactor,
                DEFAULT_THROTTLE_CONFIG.veryFarThrottleFactor,
                120,
            ),
            enableFrustumCulling: config.enableFrustumCulling ?? DEFAULT_THROTTLE_CONFIG.enableFrustumCulling,
            enableDistanceThrottling: config.enableDistanceThrottling ?? DEFAULT_THROTTLE_CONFIG.enableDistanceThrottling,
            enablePerformanceReporting: config.enablePerformanceReporting ?? DEFAULT_THROTTLE_CONFIG.enablePerformanceReporting,
            throttlingEnabled: config.throttlingEnabled ?? DEFAULT_THROTTLE_CONFIG.throttlingEnabled,
            priorityThrottleFactors: {
                [BehaviorThrottlePriority.CRITICAL]: this.validateScheduleFactor(
                    configuredPriorityFactors?.[BehaviorThrottlePriority.CRITICAL],
                    DEFAULT_THROTTLE_CONFIG.priorityThrottleFactors[BehaviorThrottlePriority.CRITICAL],
                ),
                [BehaviorThrottlePriority.HIGH]: this.validateScheduleFactor(
                    configuredPriorityFactors?.[BehaviorThrottlePriority.HIGH],
                    DEFAULT_THROTTLE_CONFIG.priorityThrottleFactors[BehaviorThrottlePriority.HIGH],
                ),
                [BehaviorThrottlePriority.MEDIUM]: this.validateScheduleFactor(
                    configuredPriorityFactors?.[BehaviorThrottlePriority.MEDIUM],
                    DEFAULT_THROTTLE_CONFIG.priorityThrottleFactors[BehaviorThrottlePriority.MEDIUM],
                ),
                [BehaviorThrottlePriority.LOW]: this.validateScheduleFactor(
                    configuredPriorityFactors?.[BehaviorThrottlePriority.LOW],
                    DEFAULT_THROTTLE_CONFIG.priorityThrottleFactors[BehaviorThrottlePriority.LOW],
                ),
                [BehaviorThrottlePriority.MINIMAL]: this.validateScheduleFactor(
                    configuredPriorityFactors?.[BehaviorThrottlePriority.MINIMAL],
                    DEFAULT_THROTTLE_CONFIG.priorityThrottleFactors[BehaviorThrottlePriority.MINIMAL],
                ),
            },
        };
    }

    private validateNumber(value: number | undefined, defaultValue: number, min: number, max: number): number {
        if (typeof value !== 'number' || isNaN(value)) {
            return defaultValue;
        }
        return Math.max(min, Math.min(max, value));
    }

    private validateScheduleFactor(value: number | undefined, defaultValue: number, max = 60): number {
        if (typeof value !== "number" || !Number.isFinite(value)) {
            return defaultValue;
        }
        return Math.max(1, Math.min(max, Math.floor(value)));
    }
}
