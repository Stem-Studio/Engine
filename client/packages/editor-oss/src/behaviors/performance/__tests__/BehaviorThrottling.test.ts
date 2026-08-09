/**
 * Unit tests demonstrating the testability of the new industry-standard architecture
 * Using explicit priority-based throttling instead of brittle auto-detection
 */
import * as THREE from "three";

import BehaviorManager from "../../BehaviorManager";
import {
    IBehaviorThrottler,
    IVisibilityChecker,
    IDistanceThrottler,
    IPerformanceMonitor,
    IThrottleDecision,
    IPerformanceMetrics,
    BehaviorThrottlePriority,
} from "../interfaces/IThrottleStrategy";
import {ThrottleContainer} from "../ThrottleContainer";

vi.mock("three", async (importOriginal) => ({
    ...await importOriginal<typeof import("three")>(),
    Audio: vi.fn(),
    AudioListener: vi.fn(),
}));

// Mock implementations for testing
class MockVisibilityChecker implements IVisibilityChecker {
    private mockVisible = true;
    beginFrame = vi.fn();
    endFrame = vi.fn();

    setVisible(visible: boolean) {
        this.mockVisible = visible;
    }

    isVisible(): boolean {
        return this.mockVisible;
    }

    clearCache(): void {}
    dispose(): void {}
}

class MockDistanceThrottler implements IDistanceThrottler {
    private mockDecision: IThrottleDecision = {shouldUpdate: true, reason: "test"};
    private mockDistanceFactor = 1;
    beginFrame = vi.fn();
    endFrame = vi.fn();

    setDecision(decision: IThrottleDecision) {
        this.mockDecision = decision;
    }

    setDistanceFactor(factor: number) {
        this.mockDistanceFactor = factor;
    }

    shouldThrottle(): IThrottleDecision {
        return this.mockDecision;
    }

    getDistanceFactor(): number {
        return this.mockDistanceFactor;
    }

    updateConfig(): void {}
}

class MockPerformanceMonitor implements IPerformanceMonitor {
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
            cullingEfficiency:
                this.metrics.totalChecks > 0 ? this.metrics.culledCount / this.metrics.totalChecks * 100 : 0,
            throttlingEfficiency:
                this.metrics.totalChecks > 0 ? this.metrics.throttledCount / this.metrics.totalChecks * 100 : 0,
        };
    }

    dispose(): void {
        this.metrics = {
            totalChecks: 0,
            culledCount: 0,
            throttledCount: 0,
            startTime: performance.now(),
        };
    }
}

class MockThrottleContainer extends ThrottleContainer {
    constructor(
        private mockVisibilityChecker: MockVisibilityChecker,
        private mockDistanceThrottler: MockDistanceThrottler,
        private mockPerformanceMonitor: MockPerformanceMonitor,
    ) {
        super();
    }

    createVisibilityChecker(): IVisibilityChecker {
        return this.mockVisibilityChecker;
    }

    createDistanceThrottler(): IDistanceThrottler {
        return this.mockDistanceThrottler;
    }

    createPerformanceMonitor(): IPerformanceMonitor {
        return this.mockPerformanceMonitor;
    }
}

class RealDistanceThrottleContainer extends ThrottleContainer {
    createVisibilityChecker(): IVisibilityChecker {
        return new MockVisibilityChecker();
    }

    createPerformanceMonitor(): IPerformanceMonitor {
        return new MockPerformanceMonitor();
    }
}

// Industry-standard explicit priority-based tests
describe("BehaviorThrottling - Industry Standard Approach", () => {
    let mockVisibilityChecker: MockVisibilityChecker;
    let mockDistanceThrottler: MockDistanceThrottler;
    let mockPerformanceMonitor: MockPerformanceMonitor;
    let mockContainer: MockThrottleContainer;
    let throttler: IBehaviorThrottler;

    beforeEach(() => {
        mockVisibilityChecker = new MockVisibilityChecker();
        mockDistanceThrottler = new MockDistanceThrottler();
        mockPerformanceMonitor = new MockPerformanceMonitor();
        mockContainer = new MockThrottleContainer(mockVisibilityChecker, mockDistanceThrottler, mockPerformanceMonitor);
        throttler = mockContainer.createBehaviorThrottler();
    });

    it("should always update CRITICAL priority behaviors", () => {
        const behavior = {
            throttleConfig: {
                throttlePriority: BehaviorThrottlePriority.CRITICAL,
                enableFrustumCulling: true,
                enableDistanceThrottling: true,
            },
            target: new THREE.Object3D(),
            enableFrustumCulling: true,
            enableDistanceThrottling: true,
        } as any;
        const camera = new THREE.PerspectiveCamera();

        const result = throttler.shouldUpdateBehavior(behavior, camera, 1, 0.016);

        expect(result.shouldUpdate).toBe(true);
        expect(result.reason).toBe("critical-priority");
    });
    it("should throttle LOW priority behaviors appropriately", () => {
        const behavior = {
            uuid: "test-low-priority-uuid",
            throttleConfig: {
                throttlePriority: BehaviorThrottlePriority.LOW,
                enableFrustumCulling: true,
                enableDistanceThrottling: true,
            },
            target: new THREE.Object3D(),
            enableFrustumCulling: true,
            enableDistanceThrottling: true,
        } as any;
        const camera = new THREE.PerspectiveCamera();

        // LOW priority has factor 3, so behavior should update exactly 1 out of every 3 frames
        // (stable interleave distributes which frame based on UUID hash)
        let updateCount = 0;
        for (let frame = 0; frame < 3; frame++) {
            const result = throttler.shouldUpdateBehavior(behavior, camera, frame, 0.016);
            if (result.shouldUpdate) updateCount++;
        }
        expect(updateCount).toBe(1);

        // Throttled frames should have the correct reason
        let throttledResult: any = null;
        for (let frame = 0; frame < 3; frame++) {
            const result = throttler.shouldUpdateBehavior(behavior, camera, frame, 0.016);
            if (!result.shouldUpdate) { throttledResult = result; break; }
        }
        expect(throttledResult).not.toBeNull();
        expect(throttledResult.reason).toBe("throttled-factor-3");
    });

    it("should interleave behaviors independently when they share a target object", () => {
        const target = new THREE.Object3D();
        const behaviorA = {
            uuid: "a",
            throttleConfig: {
                throttlePriority: BehaviorThrottlePriority.LOW,
                enableFrustumCulling: false,
                enableDistanceThrottling: true,
            },
            target,
        } as any;
        const behaviorB = {
            uuid: "b",
            throttleConfig: {
                throttlePriority: BehaviorThrottlePriority.LOW,
                enableFrustumCulling: false,
                enableDistanceThrottling: true,
            },
            target,
        } as any;
        const camera = new THREE.PerspectiveCamera();

        expect(throttler.shouldUpdateBehavior(behaviorA, camera, 1, 0.016).shouldUpdate).toBe(true);
        expect(throttler.shouldUpdateBehavior(behaviorB, camera, 1, 0.016).shouldUpdate).toBe(false);
        expect(target.userData._behaviorHash).toBeUndefined();
    });

    it("should lazily bracket frame-scoped throttling helpers with optional frame hooks", () => {
        const camera = new THREE.PerspectiveCamera();
        const behavior = {
            uuid: "frame-hook-behavior",
            throttleConfig: {
                throttlePriority: BehaviorThrottlePriority.LOW,
                enableFrustumCulling: true,
                enableDistanceThrottling: true,
            },
            target: new THREE.Object3D(),
        } as any;

        throttler.beginFrame?.(camera);

        expect(mockVisibilityChecker.beginFrame).not.toHaveBeenCalled();
        expect(mockDistanceThrottler.beginFrame).not.toHaveBeenCalled();

        throttler.shouldUpdateBehaviorFast?.(behavior, camera, 1, 0.016);
        throttler.endFrame?.();

        expect(mockVisibilityChecker.beginFrame).toHaveBeenCalledWith(camera);
        expect(mockVisibilityChecker.endFrame).toHaveBeenCalledTimes(1);
        expect(mockDistanceThrottler.beginFrame).toHaveBeenCalledWith(camera);
        expect(mockDistanceThrottler.endFrame).toHaveBeenCalledTimes(1);
    });

    it("does not prepare distance or visibility helpers when behavior checks disable both", () => {
        const camera = new THREE.PerspectiveCamera();
        const behavior = {
            uuid: "no-helper-prep-behavior",
            throttleConfig: {
                throttlePriority: BehaviorThrottlePriority.LOW,
                enableFrustumCulling: false,
                enableDistanceThrottling: false,
            },
            target: new THREE.Object3D(),
        } as any;

        throttler.beginFrame?.(camera);
        throttler.shouldUpdateBehaviorFast?.(behavior, camera, 1, 0.016);
        throttler.endFrame?.();

        expect(mockVisibilityChecker.beginFrame).not.toHaveBeenCalled();
        expect(mockVisibilityChecker.endFrame).not.toHaveBeenCalled();
        expect(mockDistanceThrottler.beginFrame).not.toHaveBeenCalled();
        expect(mockDistanceThrottler.endFrame).not.toHaveBeenCalled();
    });

    it("should prepare distance camera state once per frame", () => {
        const realDistanceContainer = new RealDistanceThrottleContainer();
        const realDistanceThrottler = realDistanceContainer.createBehaviorThrottler({
            enableFrustumCulling: false,
            enableDistanceThrottling: true,
        });
        const camera = new THREE.PerspectiveCamera();
        const updateWorldMatrix = vi.spyOn(camera, "updateWorldMatrix");
        const targetA = new THREE.Object3D();
        const targetB = new THREE.Object3D();
        targetA.position.set(60, 0, 0);
        targetB.position.set(120, 0, 0);
        targetA.updateWorldMatrix(true, false);
        targetB.updateWorldMatrix(true, false);
        camera.matrixWorldNeedsUpdate = true;
        const behaviorA = {
            uuid: "distance-prep-a",
            throttleConfig: {
                throttlePriority: BehaviorThrottlePriority.LOW,
                enableFrustumCulling: false,
                enableDistanceThrottling: true,
            },
            target: targetA,
        } as any;
        const behaviorB = {
            uuid: "distance-prep-b",
            throttleConfig: {
                throttlePriority: BehaviorThrottlePriority.LOW,
                enableFrustumCulling: false,
                enableDistanceThrottling: true,
            },
            target: targetB,
        } as any;

        realDistanceThrottler.beginFrame?.(camera);
        realDistanceThrottler.shouldUpdateBehaviorFast?.(behaviorA, camera, 1, 0.016);
        realDistanceThrottler.shouldUpdateBehaviorFast?.(behaviorB, camera, 1, 0.016);
        realDistanceThrottler.endFrame?.();

        expect(updateWorldMatrix).toHaveBeenCalledTimes(1);
        realDistanceThrottler.dispose();
    });

    it("reuses clean shared ancestry for many behavior distance checks", () => {
        const realDistanceContainer = new RealDistanceThrottleContainer();
        const realDistanceThrottler = realDistanceContainer.createBehaviorThrottler({
            enableFrustumCulling: false,
            enableDistanceThrottling: true,
        });
        const camera = new THREE.PerspectiveCamera();
        camera.updateMatrixWorld(true);
        const root = new THREE.Object3D();
        let sharedParent = root;
        for (let i = 0; i < 500; i++) {
            const child = new THREE.Object3D();
            sharedParent.add(child);
            sharedParent = child;
        }
        const targets = Array.from({length: 100}, () => {
            const target = new THREE.Object3D();
            sharedParent.add(target);
            return target;
        });
        root.updateMatrixWorld(true);

        let rootStateReads = 0;
        let rootNeedsUpdate = root.matrixWorldNeedsUpdate;
        Object.defineProperty(root, "matrixWorldNeedsUpdate", {
            configurable: true,
            get: () => {
                rootStateReads++;
                return rootNeedsUpdate;
            },
            set: value => {
                rootNeedsUpdate = value;
            },
        });

        realDistanceThrottler.beginFrame?.(camera);
        for (let i = 0; i < targets.length; i++) {
            realDistanceThrottler.shouldUpdateBehaviorFast?.({
                uuid: `deep-behavior-${i}`,
                throttleConfig: {
                    throttlePriority: BehaviorThrottlePriority.LOW,
                    enableFrustumCulling: false,
                    enableDistanceThrottling: true,
                },
                target: targets[i]!,
            } as any, camera, 1, 0.016);
        }
        realDistanceThrottler.endFrame?.();

        expect(rootStateReads).toBe(1);
        realDistanceThrottler.dispose();
    });

    it("should respect individual behavior culling settings", () => {
        const behavior = {
            uuid: "test-culling-uuid",
            throttleConfig: {
                throttlePriority: BehaviorThrottlePriority.MEDIUM,
                enableFrustumCulling: false, // Explicitly disabled
                enableDistanceThrottling: true,
            },
            target: new THREE.Object3D(),
            enableFrustumCulling: false, // Explicitly disabled
            enableDistanceThrottling: true,
        } as any;
        const camera = new THREE.PerspectiveCamera();

        // Set object as not visible, but behavior has culling disabled
        mockVisibilityChecker.setVisible(false);

        // MEDIUM has factor 2, so behavior runs on 1 of every 2 frames (hash-based)
        // Find the frame where it runs and verify it passes despite being invisible
        let passedFrame = false;
        for (let frame = 0; frame < 2; frame++) {
            const result = throttler.shouldUpdateBehavior(behavior, camera, frame, 0.016);
            if (result.shouldUpdate) {
                expect(result.reason).toBe("passed-all-checks");
                passedFrame = true;
            }
        }
        expect(passedFrame).toBe(true);
    });

    it("should skip hot-loop metrics when performance reporting is disabled", () => {
        const behavior = {
            throttleConfig: {
                throttlePriority: BehaviorThrottlePriority.HIGH,
                enableFrustumCulling: true,
                enableDistanceThrottling: true,
            },
            target: new THREE.Object3D(),
            enableFrustumCulling: true,
            enableDistanceThrottling: true,
        } as any;
        const camera = new THREE.PerspectiveCamera();

        throttler.shouldUpdateBehavior(behavior, camera, 1, 0.016); // Frame 1, HIGH factor is 1, so it updates

        const metrics = mockPerformanceMonitor.getMetrics();
        expect(metrics.totalChecks).toBe(0);
    });

    it("should record performance metrics when reporting is enabled", () => {
        const reportingThrottler = mockContainer.createBehaviorThrottler({
            enablePerformanceReporting: true,
        });
        const behavior = {
            throttleConfig: {
                throttlePriority: BehaviorThrottlePriority.HIGH,
                enableFrustumCulling: true,
                enableDistanceThrottling: true,
            },
            target: new THREE.Object3D(),
            enableFrustumCulling: true,
            enableDistanceThrottling: true,
        } as any;
        const camera = new THREE.PerspectiveCamera();

        reportingThrottler.shouldUpdateBehavior(behavior, camera, 1, 0.016);

        const metrics = mockPerformanceMonitor.getMetrics();
        expect(metrics.totalChecks).toBe(1);
    });

    it("should expose an allocation-free predicate with matching update decisions", () => {
        const behavior = {
            uuid: "fast-path-low-priority-uuid",
            throttleConfig: {
                throttlePriority: BehaviorThrottlePriority.LOW,
                enableFrustumCulling: true,
                enableDistanceThrottling: true,
            },
            target: new THREE.Object3D(),
        } as any;
        const camera = new THREE.PerspectiveCamera();

        for (let frame = 0; frame < 6; frame++) {
            const detailed = throttler.shouldUpdateBehavior(behavior, camera, frame, 0.016);
            const fast = throttler.shouldUpdateBehaviorFast?.(behavior, camera, frame, 0.016);
            expect(fast).toBe(detailed.shouldUpdate);
        }
    });

    it("should quantize fractional pressure before modulo scheduling", () => {
        const behavior = {
            uuid: "fractional-pressure-behavior",
            throttleConfig: {
                throttlePriority: BehaviorThrottlePriority.HIGH,
                enableFrustumCulling: false,
                enableDistanceThrottling: false,
            },
            target: new THREE.Object3D(),
        } as any;
        const camera = new THREE.PerspectiveCamera();

        throttler.setPressureMultiplier?.(2.4);
        throttler.beginFrame?.(camera);

        let detailedUpdates = 0;
        let fastUpdates = 0;
        let throttledResult: IThrottleDecision | null = null;
        for (let frame = 0; frame < 6; frame++) {
            const detailed = throttler.shouldUpdateBehavior(behavior, camera, frame, 0.016);
            const fast = throttler.shouldUpdateBehaviorFast?.(behavior, camera, frame, 0.016);
            if (detailed.shouldUpdate) detailedUpdates++;
            if (fast) fastUpdates++;
            if (!detailed.shouldUpdate) throttledResult = detailed;
        }

        expect(detailedUpdates).toBe(2);
        expect(fastUpdates).toBe(2);
        expect(throttledResult?.reason).toBe("throttled-factor-3");
        expect(throttledResult?.priority).toBe(3);
    });

    it("caches frame modulo values per schedule factor", () => {
        const concrete = throttler as unknown as {
            getFrameModulo(frameCount: number, scheduleFactor: number): number;
            frameModuloCacheFrames: Int32Array;
            frameModuloCacheValues: Int8Array;
        };

        expect(concrete.getFrameModulo(8, 3)).toBe(2);
        expect(concrete.frameModuloCacheFrames[3]).toBe(8);
        expect(concrete.frameModuloCacheValues[3]).toBe(2);

        expect(concrete.getFrameModulo(9, 3)).toBe(0);
        expect(concrete.frameModuloCacheFrames[3]).toBe(9);
        expect(concrete.frameModuloCacheValues[3]).toBe(0);
    });
});

// Example integration test with BehaviorManager
describe("BehaviorManager Integration - Explicit Priority System", () => {
    it("should use injected throttle container with explicit priorities", () => {
        const mockVisibilityChecker = new MockVisibilityChecker();
        const mockDistanceThrottler = new MockDistanceThrottler();
        const mockPerformanceMonitor = new MockPerformanceMonitor();
        const mockContainer = new MockThrottleContainer(
            mockVisibilityChecker,
            mockDistanceThrottler,
            mockPerformanceMonitor,
        );

        const mockGame = {
            scene: (() => { const s = new THREE.Scene(); s.name = "BehaviorThrottlingTestScene"; return s; })(),
            camera: new THREE.PerspectiveCamera(),
        } as any;

        // BehaviorManager with dependency injection - industry standard
        const behaviorManager = new BehaviorManager(
            mockGame,
            new Map(),
            new Map(),
            mockContainer, // Explicit dependency injection
        );

        // System is now predictable and testable
        const metrics = behaviorManager.getPerformanceMetrics();
        expect(metrics).toBeDefined();
    });

    it("should use the throttler fast predicate during per-frame updates when available", () => {
        const mockGame = {
            scene: (() => { const s = new THREE.Scene(); s.name = "BehaviorManagerFastThrottleTestScene"; return s; })(),
            camera: new THREE.PerspectiveCamera(),
        } as any;
        const behaviorManager = new BehaviorManager(mockGame, new Map(), new Map());
        const behavior = {
            uuid: "fast-manager-behavior",
            id: "fast-manager",
            target: new THREE.Object3D(),
            isPaused: false,
            throttleConfig: {
                throttlePriority: BehaviorThrottlePriority.LOW,
                enableFrustumCulling: true,
                enableDistanceThrottling: true,
            },
            update: vi.fn(),
            _accumulatedDelta: 0,
        };
        const shouldUpdateBehavior = vi.fn(() => ({shouldUpdate: true, reason: "fallback"}));
        const shouldUpdateBehaviorFast = vi.fn(() => false);
        (behaviorManager as any).behaviors = [behavior];
        (behaviorManager as any).throttler = {
            beginFrame: vi.fn(),
            endFrame: vi.fn(),
            setPressureMultiplier: vi.fn(),
            shouldUpdateBehavior,
            shouldUpdateBehaviorFast,
            getMetrics: vi.fn(),
            configure: vi.fn(),
            dispose: vi.fn(),
        };

        behaviorManager.update(0.016);

        expect(shouldUpdateBehaviorFast).toHaveBeenCalledWith(behavior, mockGame.camera, 1, 0.016);
        expect(shouldUpdateBehavior).not.toHaveBeenCalled();
        expect(behavior.update).not.toHaveBeenCalled();
        expect(behavior._accumulatedDelta).toBe(0.016);
    });

    it("drains queued behavior commands without mapping the queue", async () => {
        const mockGame = {
            scene: (() => { const s = new THREE.Scene(); s.name = "BehaviorManagerQueueDrainTestScene"; return s; })(),
            camera: new THREE.PerspectiveCamera(),
        } as any;
        const behaviorManager = new BehaviorManager(mockGame, new Map(), new Map());
        const target = new THREE.Object3D();
        const behavior = {
            uuid: "queued-manager-behavior",
            id: "queued-manager",
            target,
            parent: target,
            isPaused: false,
            onStop: vi.fn(),
            dispose: vi.fn(),
        };
        const commandQueue = [{type: 1, behavior}] as any[];
        commandQueue.map = vi.fn(() => {
            throw new Error("command queue map should not be called");
        }) as any;

        (behaviorManager as any).behaviors = [behavior];
        (behaviorManager as any).commandQueue = commandQueue;

        await (behaviorManager as any).processCommandQueue();

        expect(commandQueue.map).not.toHaveBeenCalled();
        expect(behavior.onStop).toHaveBeenCalledOnce();
        expect(behavior.dispose).toHaveBeenCalledOnce();
        expect(behaviorManager.getBehaviors()).toHaveLength(0);
        expect((behaviorManager as any).commandQueue).toHaveLength(0);
    });

    it("yields while resetting large behavior lists progressively", async () => {
        const mockGame = {
            scene: (() => { const s = new THREE.Scene(); s.name = "BehaviorManagerProgressiveResetTestScene"; return s; })(),
            camera: new THREE.PerspectiveCamera(),
        } as any;
        const behaviorManager = new BehaviorManager(mockGame, new Map(), new Map());
        const behaviors = Array.from({length: 70}, (_, index) => ({
            uuid: `reset-manager-behavior-${index}`,
            id: "reset-manager",
            target: new THREE.Object3D(),
            isPaused: false,
            onReset: vi.fn(),
        }));
        const yieldToFrame = vi.fn(async () => {});
        (behaviorManager as any).behaviors = behaviors;

        await behaviorManager.resetProgressive({
            batchSize: 16,
            frameBudgetMs: 1000,
            yieldToFrame,
        });

        expect(yieldToFrame).toHaveBeenCalled();
        for (const behavior of behaviors) {
            expect(behavior.onReset).toHaveBeenCalledOnce();
        }
    });
});
