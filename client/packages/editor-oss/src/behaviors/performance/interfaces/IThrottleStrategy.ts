/**
 * Core interfaces for behavior throttling system
 * Following SOLID principles with proper separation of concerns
 */
import * as THREE from 'three';

import type { ISpatialGrid } from '../../../scheduler/types';
import { Behavior } from '../../Behavior';

/**
 * Explicit throttling priority levels following industry standards
 * Each behavior must explicitly declare its priority level
 */
export enum BehaviorThrottlePriority {
    /** Never throttle - critical for gameplay (player movement, core mechanics) */
    CRITICAL = 'CRITICAL',
    /** Rarely throttle - important for responsiveness (AI, interactions) */
    HIGH = 'HIGH',
    /** Moderately throttle - visible but not critical (animations, effects) */
    MEDIUM = 'MEDIUM',
    /** Aggressively throttle - background/ambient (environment, audio) */
    LOW = 'LOW',
    /** Most aggressive throttling - non-essential (debug, metrics) */
    MINIMAL = 'MINIMAL'
}

export interface IThrottleDecision {
    shouldUpdate: boolean;
    reason: string;
    priority?: number;
}

export interface IVisibilityChecker {
    beginFrame?(camera: THREE.Camera): void;
    endFrame?(): void;
    isVisible(object: THREE.Object3D, camera: THREE.Camera): boolean;
    clearCache(): void;
    dispose(): void;
}

export interface IDistanceThrottler {
    beginFrame?(camera: THREE.Camera): void;
    endFrame?(): void;
    shouldThrottle(object: THREE.Object3D, camera: THREE.Camera, frameCount: number): IThrottleDecision;
    /** Returns the raw distance-based throttle factor (1 = close, farFactor, veryFarFactor) without applying modulo */
    getDistanceFactor(object: THREE.Object3D, camera: THREE.Camera, frameCount?: number): number;
    updateConfig(config: IThrottleConfig): void;
    /** Attach a spatial grid for O(1) distance lookups */
    setSpatialGrid?(grid: ISpatialGrid | null): void;
}

export interface IPerformanceMetrics {
    totalChecks: number;
    culledCount: number;
    throttledCount: number;
    runTimeMs: number;
    cullingEfficiency: number;
    throttlingEfficiency: number;
}

export interface IPerformanceMonitor {
    recordCheck(): void;
    recordCull(): void;
    recordThrottle(): void;
    getMetrics(): IPerformanceMetrics;
    dispose(): void;
}

export interface IBehaviorThrottler {
    shouldUpdateBehavior(
        behavior: Behavior,
        camera: THREE.Camera,
        frameCount: number,
        deltaTime: number
    ): IThrottleDecision;

    /**
     * Allocation-free hot-loop predicate. Use shouldUpdateBehavior() when
     * callers need diagnostic reason strings or priority details.
     */
    shouldUpdateBehaviorFast?(
        behavior: Behavior,
        camera: THREE.Camera,
        frameCount: number,
        deltaTime: number
    ): boolean;

    /** Call once per frame before processing behaviors to update adaptive throttle */
    beginFrame?(camera?: THREE.Camera): void;
    endFrame?(): void;
    configure(config: Partial<IThrottleConfig>): void;
    getMetrics(): IPerformanceMetrics;
    /** Attach a spatial grid for O(1) distance lookups in throttle checks */
    setSpatialGrid?(grid: ISpatialGrid | null): void;
    /** Feed orchestrator pressure signal to boost adaptive throttle multiplier */
    setPressureMultiplier?(multiplier: number): void;
    dispose(): void;
}

export interface IThrottleConfig {
    readonly farDistanceSq: number;
    readonly veryFarDistanceSq: number;
    readonly farThrottleFactor: number;
    readonly veryFarThrottleFactor: number;
    readonly enableFrustumCulling: boolean;
    readonly enableDistanceThrottling: boolean;
    readonly enablePerformanceReporting: boolean;

    // Global throttling enable/disable - when false, ALL behaviors update every frame
    readonly throttlingEnabled: boolean;

    // Priority-based throttling factors
    readonly priorityThrottleFactors: {
        [BehaviorThrottlePriority.CRITICAL]: number;
        [BehaviorThrottlePriority.HIGH]: number;
        [BehaviorThrottlePriority.MEDIUM]: number;
        [BehaviorThrottlePriority.LOW]: number;
        [BehaviorThrottlePriority.MINIMAL]: number;
    };
}

export interface IConfigValidator {
    validate(config: Partial<IThrottleConfig>): IThrottleConfig;
}
