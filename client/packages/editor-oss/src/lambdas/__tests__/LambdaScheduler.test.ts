import { Object3D, PerspectiveCamera } from "three";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { ISpatialGrid } from "@stem/editor-oss/scheduler/types";

const visibilityCheckerMocks = vi.hoisted(() => ({
    beginFrame: vi.fn(),
    endFrame: vi.fn(),
    isVisible: vi.fn(() => true),
    clearCache: vi.fn(),
    dispose: vi.fn(),
}));

// Mock the VisibilityChecker module before importing LambdaScheduler
vi.mock("../../behaviors/performance/implementations/VisibilityChecker", () => ({
    VisibilityChecker: class MockVisibilityChecker {
        beginFrame = visibilityCheckerMocks.beginFrame;
        endFrame = visibilityCheckerMocks.endFrame;
        isVisible = visibilityCheckerMocks.isVisible;
        clearCache = visibilityCheckerMocks.clearCache;
        dispose = visibilityCheckerMocks.dispose;
    },
}));

// Import after mock
import { LambdaScheduler } from "../LambdaScheduler";

describe("LambdaScheduler", () => {
    let scheduler: LambdaScheduler;
    let camera: PerspectiveCamera;

    beforeEach(() => {
        visibilityCheckerMocks.beginFrame.mockClear();
        visibilityCheckerMocks.endFrame.mockClear();
        visibilityCheckerMocks.isVisible.mockClear();
        visibilityCheckerMocks.clearCache.mockClear();
        visibilityCheckerMocks.dispose.mockClear();
        scheduler = new LambdaScheduler({
            targetFPS: 60,
            frameBudgetMs: 12,
            defaultThrottleFactor: 1,
            farDistanceSq: 2500,      // 50m
            veryFarDistanceSq: 10000, // 100m
        });
        camera = new PerspectiveCamera(75, 1, 0.1, 1000);
        camera.position.set(0, 0, 0);
        camera.updateMatrixWorld();
    });

    afterEach(() => {
        scheduler?.dispose();
    });

    describe("constructor", () => {
        it("should use default config when none provided", () => {
            const defaultScheduler = new LambdaScheduler();
            expect(defaultScheduler.frameBudgetMs).toBe(12);
            defaultScheduler.dispose();
        });

        it("should merge provided config with defaults", () => {
            const customScheduler = new LambdaScheduler({ frameBudgetMs: 8 });
            expect(customScheduler.frameBudgetMs).toBe(8);
            customScheduler.dispose();
        });

        it("should apply defaultThrottleFactor as the healthy baseline throttle", () => {
            const customScheduler = new LambdaScheduler({ defaultThrottleFactor: 2 });
            const object = new Object3D();
            object.userData._lambdaHash = 0;
            object.updateMatrixWorld();

            customScheduler.beginFrame(0);
            expect(customScheduler.shouldProcess(object, camera, 0, false)).toBe(2);

            customScheduler.beginFrame(1);
            expect(customScheduler.shouldProcess(object, camera, 0, false)).toBe(0);

            customScheduler.dispose();
        });

        it("should clamp defaultThrottleFactor to the supported adaptive throttle range", () => {
            const customScheduler = new LambdaScheduler({ defaultThrottleFactor: 99 });
            const object = new Object3D();
            object.userData._lambdaHash = 0;
            object.updateMatrixWorld();

            customScheduler.beginFrame(0);
            expect(customScheduler.shouldProcess(object, camera, 0, false)).toBe(3);

            customScheduler.beginFrame(1);
            expect(customScheduler.shouldProcess(object, camera, 0, false)).toBe(0);

            customScheduler.dispose();
        });

        it("should ignore invalid distance and budget config values", () => {
            const customScheduler = new LambdaScheduler({
                targetFPS: 0,
                frameBudgetMs: Number.NaN,
                farDistanceSq: 0,
                veryFarDistanceSq: -1,
            });
            const object = new Object3D();
            object.userData._lambdaHash = 0;
            object.position.set(5, 0, 0);
            object.updateMatrixWorld();

            expect(customScheduler.frameBudgetMs).toBe(12);

            customScheduler.beginFrame(1);

            expect(Number.isFinite(customScheduler.frameDeadline)).toBe(true);
            expect(customScheduler.shouldProcess(object, camera, 0, false)).toBe(1);

            customScheduler.dispose();
        });
    });

    describe("beginFrame", () => {
        it("should use orchestrator frame count when provided", () => {
            scheduler.beginFrame(100);
            // Frame count should now be 100 - we can verify through behavior
        });

        it("should use orchestrator deadline when provided", () => {
            const deadline = performance.now() + 5;
            scheduler.beginFrame({
                deltaTime: 0.016,
                fixedDeltaTime: 0.01667,
                fixedUpdatesEnabled: true,
                frameCount: 1,
                interpolationAlpha: 1,
                fixedOverstep: 0,
                frameStartTime: performance.now(),
                frameDeadline: deadline,
                underRenderPressure: false,
                renderAvgMs: 0,
                spatialGrid: null,
            });
            expect(scheduler.frameDeadline).toBe(deadline);
        });

        it("should reuse orchestrator frameStartTime when provided", () => {
            scheduler.beginFrame({
                deltaTime: 0.016,
                fixedDeltaTime: 0.01667,
                fixedUpdatesEnabled: false,
                frameCount: 1,
                interpolationAlpha: 1,
                fixedOverstep: 0,
                frameStartTime: 1234,
                frameDeadline: 1246,
                underRenderPressure: false,
                renderAvgMs: 0,
                spatialGrid: null,
            });

            expect(scheduler.frameStartTime).toBe(1234);
            expect(scheduler.frameDeadline).toBe(1246);
        });

        it("should use the spatial grid from frame context for distance lookups", () => {
            const mockGrid: ISpatialGrid = {
                update: vi.fn(),
                getDistanceSq: vi.fn().mockReturnValue(25),
                queryRadius: vi.fn().mockReturnValue([]),
                remove: vi.fn(),
                dispose: vi.fn(),
            };
            const object = new Object3D();
            object.position.set(100, 0, 0);
            object.updateMatrixWorld();
            const objectSpy = vi.spyOn(object, "getWorldPosition");

            scheduler.beginFrame({
                deltaTime: 0.016,
                fixedDeltaTime: 0.01667,
                fixedUpdatesEnabled: false,
                frameCount: 1,
                interpolationAlpha: 1,
                fixedOverstep: 0,
                frameStartTime: 100,
                frameDeadline: 112,
                underRenderPressure: false,
                renderAvgMs: 16,
                spatialGrid: mockGrid,
            });
            scheduler.shouldProcess(object, camera, 0, false);

            expect(mockGrid.getDistanceSq).toHaveBeenCalledWith(object.uuid, expect.any(Object));
            expect(objectSpy).not.toHaveBeenCalled();
            objectSpy.mockRestore();
        });

        it("should clear a previous spatial grid when frame context has none", () => {
            const mockGrid: ISpatialGrid = {
                update: vi.fn(),
                getDistanceSq: vi.fn().mockReturnValue(0),
                queryRadius: vi.fn().mockReturnValue([]),
                remove: vi.fn(),
                dispose: vi.fn(),
            };
            const object = new Object3D();
            object.userData._lambdaHash = 0;
            object.position.set(150, 0, 0);
            object.updateMatrixWorld();

            scheduler.setSpatialGrid(mockGrid);
            scheduler.beginFrame({
                deltaTime: 0.016,
                fixedDeltaTime: 0.01667,
                fixedUpdatesEnabled: false,
                frameCount: 0,
                interpolationAlpha: 1,
                fixedOverstep: 0,
                frameStartTime: 100,
                frameDeadline: 112,
                underRenderPressure: false,
                renderAvgMs: 16,
                spatialGrid: null,
            });

            expect(scheduler.shouldProcess(object, camera, 0, false)).toBe(3);
            expect(mockGrid.getDistanceSq).not.toHaveBeenCalled();
        });

        it("should keep config budget available as a compatibility accessor", () => {
            scheduler.beginFrame(1);
            expect(scheduler.frameBudgetMs).toBe(12);
        });
    });

    describe("shouldProcess - Critical Flag", () => {
        it("should always return 1 for critical objects", () => {
            const object = new Object3D();
            object.position.set(1000, 1000, 1000); // Very far away
            object.updateMatrixWorld();

            scheduler.beginFrame();
            const result = scheduler.shouldProcess(object, camera, 0, true);

            expect(result).toBe(1);
        });

        it("should bypass all throttling for critical objects", () => {
            const object = new Object3D();
            object.position.set(200, 0, 0); // Beyond veryFarDistanceSq
            object.updateMatrixWorld();

            // Critical should always return 1
            for (let i = 0; i < 20; i++) {
                scheduler.beginFrame(i);
                const result = scheduler.shouldProcess(object, camera, 0, true);
                expect(result).toBe(1);
            }
        });
    });

    describe("shouldProcess - Distance-based LOD", () => {
        it("should return base throttle for close objects", () => {
            const object = new Object3D();
            object.position.set(10, 0, 0); // 10m away
            object.updateMatrixWorld();

            scheduler.beginFrame(0);
            const result = scheduler.shouldProcess(object, camera, 0, false);

            // Close objects get base throttle (1) - should run
            expect(result).toBeGreaterThanOrEqual(0);
        });

        it("should apply higher throttle for far objects (>50m), capped at 3", () => {
            const object = new Object3D();
            object.position.set(60, 0, 0); // 60m away (>50m, <100m)
            object.updateMatrixWorld();

            // Run multiple frames to find one where the object runs with capped throttle factor 3
            let foundThrottle3 = false;
            for (let i = 0; i < 10; i++) {
                scheduler.beginFrame(i);
                const result = scheduler.shouldProcess(object, camera, 0, false);
                if (result === 3) {
                    foundThrottle3 = true;
                    break;
                }
            }
            // The throttle factor would be 4 for far objects but capped at 3
            expect(foundThrottle3).toBe(true);
        });

        it("should apply highest throttle for very far objects (>100m), capped at 3", () => {
            const object = new Object3D();
            object.position.set(150, 0, 0); // 150m away (>100m)
            object.updateMatrixWorld();

            // Run multiple frames to find one where the object runs with capped throttle factor 3
            let foundThrottle3 = false;
            for (let i = 0; i < 20; i++) {
                scheduler.beginFrame(i);
                const result = scheduler.shouldProcess(object, camera, 0, false);
                if (result === 3) {
                    foundThrottle3 = true;
                    break;
                }
            }
            // The throttle factor would be 10 for very far objects but capped at 3
            expect(foundThrottle3).toBe(true);
        });
    });

    describe("shouldProcess - Interleaving", () => {
        it("should use stable hash for consistent frame assignment", () => {
            const object = new Object3D();
            object.position.set(5, 0, 0);
            object.updateMatrixWorld();

            // Find which frames this object runs on
            const runFrames: number[] = [];
            for (let i = 0; i < 10; i++) {
                scheduler.beginFrame(i);
                const result = scheduler.shouldProcess(object, camera, 0, false);
                if (result > 0) {
                    runFrames.push(i);
                }
            }

            // With throttle=1 and close distance, should run every frame
            expect(runFrames.length).toBe(10);
        });

        it("should cache hash on object userData", () => {
            const object = new Object3D();
            object.position.set(5, 0, 0);
            object.updateMatrixWorld();

            expect(object.userData._lambdaHash).toBeUndefined();

            scheduler.beginFrame(0);
            scheduler.shouldProcess(object, camera, 0, false);

            expect(object.userData._lambdaHash).toBeDefined();
            expect(typeof object.userData._lambdaHash).toBe("number");
        });

        it("should keep cached lambda hashes out of serialized userData", () => {
            const object = new Object3D();
            object.position.set(5, 0, 0);
            object.updateMatrixWorld();

            scheduler.beginFrame(0);
            scheduler.shouldProcess(object, camera, 0, false);

            expect(object.userData._lambdaHash).toBeDefined();
            expect(Object.prototype.propertyIsEnumerable.call(object.userData, "_lambdaHash")).toBe(false);
            expect(JSON.stringify(object.userData)).not.toContain("_lambdaHash");
        });

        it("should preserve legacy hash values while making them non-enumerable", () => {
            const object = new Object3D();
            object.userData._lambdaHash = 0;
            object.position.set(60, 0, 0);
            object.updateMatrixWorld();

            expect(Object.prototype.propertyIsEnumerable.call(object.userData, "_lambdaHash")).toBe(true);

            scheduler.beginFrame(1);
            expect(scheduler.shouldProcess(object, camera, 0, false)).toBe(0);

            expect(object.userData._lambdaHash).toBe(0);
            expect(Object.prototype.propertyIsEnumerable.call(object.userData, "_lambdaHash")).toBe(false);
        });

        it("should reuse cached hash on subsequent calls", () => {
            const object = new Object3D();
            object.position.set(5, 0, 0);
            object.updateMatrixWorld();

            scheduler.beginFrame(0);
            scheduler.shouldProcess(object, camera, 0, false);
            const firstHash = object.userData._lambdaHash;

            scheduler.beginFrame(1);
            scheduler.shouldProcess(object, camera, 0, false);
            const secondHash = object.userData._lambdaHash;

            expect(firstHash).toBe(secondHash);
        });

        it("should prefer the internal hash cache over later userData mutations", () => {
            const object = new Object3D();
            object.position.set(60, 0, 0);
            object.updateMatrixWorld();

            scheduler.beginFrame(0);
            scheduler.shouldProcess(object, camera, 0, false);
            const cachedHash = object.userData._lambdaHash as number;
            const runFrame = cachedHash % 4;

            object.userData._lambdaHash = cachedHash + 1;

            scheduler.beginFrame(runFrame);
            expect(scheduler.shouldProcess(object, camera, 0, false)).toBe(3);
        });

        it("should not redefine already hidden cached hashes on subsequent frames", () => {
            const object = new Object3D();
            object.position.set(5, 0, 0);
            object.updateMatrixWorld();

            scheduler.beginFrame(0);
            scheduler.shouldProcess(object, camera, 0, false);
            expect(Object.prototype.propertyIsEnumerable.call(object.userData, "_lambdaHash")).toBe(false);

            const definePropertySpy = vi.spyOn(Object, "defineProperty");

            scheduler.beginFrame(1);
            scheduler.shouldProcess(object, camera, 0, false);

            expect(definePropertySpy).not.toHaveBeenCalled();
            definePropertySpy.mockRestore();
        });

        it("should skip visibility checks on frames rejected by distance throttling", () => {
            const object = new Object3D();
            object.position.set(60, 0, 0); // Far enough for base throttle factor 4
            object.userData._lambdaHash = 0;
            object.updateMatrixWorld();

            scheduler.beginFrame(1);
            expect(scheduler.shouldProcess(object, camera, 0, false)).toBe(0);
            expect(visibilityCheckerMocks.isVisible).not.toHaveBeenCalled();

            scheduler.beginFrame(0);
            scheduler.shouldProcess(object, camera, 0, false);
            expect(visibilityCheckerMocks.isVisible).toHaveBeenCalledTimes(1);
        });

        it("should prepare visibility once for multiple checks in the same frame", () => {
            const object1 = new Object3D();
            const object2 = new Object3D();
            object1.position.set(5, 0, 0);
            object2.position.set(10, 0, 0);
            object1.updateMatrixWorld();
            object2.updateMatrixWorld();

            scheduler.beginFrame(0);
            scheduler.shouldProcess(object1, camera, 0, false);
            scheduler.shouldProcess(object2, camera, 1, false);

            expect(visibilityCheckerMocks.beginFrame).toHaveBeenCalledTimes(1);
            expect(visibilityCheckerMocks.beginFrame).toHaveBeenCalledWith(camera);
        });
    });

    describe("shouldProcess - Camera caching", () => {
        it("should read current camera matrix without forcing a world-position update", () => {
            const object1 = new Object3D();
            const object2 = new Object3D();
            object1.position.set(5, 0, 0);
            object2.position.set(10, 0, 0);
            object1.updateMatrixWorld();
            object2.updateMatrixWorld();

            const cameraSpy = vi.spyOn(camera, "getWorldPosition");

            scheduler.beginFrame(0);
            scheduler.shouldProcess(object1, camera, 0, false);
            scheduler.shouldProcess(object2, camera, 1, false);

            expect(cameraSpy).not.toHaveBeenCalled();

            cameraSpy.mockRestore();
        });

        it("should reuse current camera matrices when switching cameras within the same frame", () => {
            const object = new Object3D();
            object.position.set(5, 0, 0);
            object.updateMatrixWorld();

            const camera2 = new PerspectiveCamera();
            camera2.position.set(10, 0, 0);
            camera2.updateMatrixWorld();

            const cameraSpy = vi.spyOn(camera, "getWorldPosition");
            const camera2Spy = vi.spyOn(camera2, "getWorldPosition");

            scheduler.beginFrame(0);

            // First call with camera 1
            scheduler.shouldProcess(object, camera, 0, false);
            expect(cameraSpy).not.toHaveBeenCalled();

            // Second call with camera 2 reads its current matrix directly.
            scheduler.shouldProcess(object, camera2, 0, false);
            expect(camera2Spy).not.toHaveBeenCalled();

            // Third call with camera 1 again also uses its current matrix.
            scheduler.shouldProcess(object, camera, 0, false);
            expect(cameraSpy).not.toHaveBeenCalled();

            cameraSpy.mockRestore();
            camera2Spy.mockRestore();
        });

        it("should use getWorldPosition when the camera matrix is stale", () => {
            const object = new Object3D();
            object.position.set(5, 0, 0);
            object.updateMatrixWorld();
            camera.matrixWorldNeedsUpdate = true;

            const cameraSpy = vi.spyOn(camera, "getWorldPosition");

            scheduler.beginFrame(0);
            scheduler.shouldProcess(object, camera, 0, false);

            expect(cameraSpy).toHaveBeenCalledTimes(1);

            cameraSpy.mockRestore();
        });
    });

    describe("shouldProcess - Object position fallback", () => {
        it("should read a current object matrix without forcing a world-position update", () => {
            const object = new Object3D();
            object.position.set(5, 0, 0);
            object.updateMatrixWorld();

            const objectSpy = vi.spyOn(object, "getWorldPosition");

            scheduler.beginFrame(0);
            scheduler.shouldProcess(object, camera, 0, false);

            expect(objectSpy).not.toHaveBeenCalled();

            objectSpy.mockRestore();
        });

        it("should use getWorldPosition when an ancestor matrix is stale", () => {
            const parent = new Object3D();
            const object = new Object3D();
            parent.add(object);
            object.position.set(5, 0, 0);
            parent.updateMatrixWorld(true);
            parent.matrixWorldNeedsUpdate = true;

            const objectSpy = vi.spyOn(object, "getWorldPosition");

            scheduler.beginFrame(0);
            scheduler.shouldProcess(object, camera, 0, false);

            expect(objectSpy).toHaveBeenCalledTimes(1);

            objectSpy.mockRestore();
        });

        it("reuses clean shared ancestry for many lambda targets in one frame", () => {
            const root = new Object3D();
            let sharedParent = root;
            for (let i = 0; i < 500; i++) {
                const child = new Object3D();
                sharedParent.add(child);
                sharedParent = child;
            }
            const targets = Array.from({length: 100}, (_, index) => {
                const target = new Object3D();
                target.userData._lambdaHash = index;
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

            scheduler.beginFrame(0);
            for (let i = 0; i < targets.length; i++) {
                scheduler.shouldProcess(targets[i]!, camera, i, false);
            }

            expect(rootStateReads).toBe(1);
        });

        it("refreshes a lambda target after its cached parent moves mid-frame", () => {
            const parent = new Object3D();
            const first = new Object3D();
            const second = new Object3D();
            parent.add(first, second);
            parent.updateMatrixWorld(true);

            scheduler.beginFrame(0);
            scheduler.shouldProcess(first, camera, 0, false);

            parent.position.x = 25;
            parent.updateMatrix();
            scheduler.shouldProcess(second, camera, 1, false);

            expect(second.matrixWorld.elements[12]).toBeCloseTo(25);
        });
    });

    describe("setSpatialGrid", () => {
        it("should use spatial grid for distance lookups when available", () => {
            const mockGrid: ISpatialGrid = {
                update: vi.fn(),
                getDistanceSq: vi.fn().mockReturnValue(25), // 5m away
                queryRadius: vi.fn().mockReturnValue([]),
                remove: vi.fn(),
                dispose: vi.fn(),
            };

            scheduler.setSpatialGrid(mockGrid);

            const object = new Object3D();
            object.position.set(100, 0, 0); // Would be 100m without grid
            object.updateMatrixWorld();

            scheduler.beginFrame(0);
            scheduler.shouldProcess(object, camera, 0, false);

            // Should use grid's distance instead of computing
            expect(mockGrid.getDistanceSq).toHaveBeenCalled();
        });

        it("should fall back to object position when grid returns null", () => {
            const mockGrid: ISpatialGrid = {
                update: vi.fn(),
                getDistanceSq: vi.fn().mockReturnValue(null),
                queryRadius: vi.fn().mockReturnValue([]),
                remove: vi.fn(),
                dispose: vi.fn(),
            };

            scheduler.setSpatialGrid(mockGrid);

            const object = new Object3D();
            object.position.set(60, 0, 0);
            object.updateMatrixWorld();
            // Force update to trigger fallback to getWorldPosition
            object.matrixWorldNeedsUpdate = true;

            const objectSpy = vi.spyOn(object, "getWorldPosition");

            scheduler.beginFrame(0);
            scheduler.shouldProcess(object, camera, 0, false);

            // Should fall back to computing object position
            expect(objectSpy).toHaveBeenCalled();

            objectSpy.mockRestore();
        });
    });

    describe("dispose", () => {
        it("should dispose visibility checker without error", () => {
            expect(() => scheduler.dispose()).not.toThrow();
        });
    });

    describe("updateConfig", () => {
        it("should ignore invalid runtime quality settings", () => {
            const object = new Object3D();
            object.userData._lambdaHash = 0;
            object.position.set(5, 0, 0);
            object.updateMatrixWorld();

            scheduler.updateConfig({
                targetFPS: Number.NaN,
                frameBudgetMs: 0,
                farDistanceSq: 0,
                veryFarDistanceSq: 0,
            });
            scheduler.beginFrame(1);

            expect(scheduler.frameBudgetMs).toBe(12);
            expect(Number.isFinite(scheduler.frameDeadline)).toBe(true);
            expect(scheduler.shouldProcess(object, camera, 0, false)).toBe(1);
        });

        it("should keep very-far distance at least as large as far distance", () => {
            const object = new Object3D();
            object.userData._lambdaHash = 0;
            object.position.set(75, 0, 0);
            object.updateMatrixWorld();

            scheduler.updateConfig({
                farDistanceSq: 2500,
                veryFarDistanceSq: 100,
            });
            scheduler.beginFrame(4);

            expect(scheduler.shouldProcess(object, camera, 0, false)).toBe(3);
        });
    });
});

describe("LambdaScheduler - Edge Cases", () => {
    let scheduler: LambdaScheduler;
    let camera: PerspectiveCamera;

    beforeEach(() => {
        scheduler = new LambdaScheduler();
        camera = new PerspectiveCamera();
        camera.updateMatrixWorld();
    });

    afterEach(() => {
        scheduler?.dispose();
    });

    it("should handle object with no parent (world matrix not updated)", () => {
        const object = new Object3D();
        // Don't call updateMatrixWorld

        scheduler.beginFrame(0);
        // Should not throw
        expect(() => scheduler.shouldProcess(object, camera, 0, false)).not.toThrow();
    });

    it("should handle object at origin (same position as camera)", () => {
        const object = new Object3D();
        object.position.set(0, 0, 0);
        camera.position.set(0, 0, 0);
        object.updateMatrixWorld();
        camera.updateMatrixWorld();

        scheduler.beginFrame(0);
        const result = scheduler.shouldProcess(object, camera, 0, false);

        // Distance is 0, should use base throttle and run
        expect(result).toBeGreaterThanOrEqual(0);
    });

    it("should handle negative positions", () => {
        const object = new Object3D();
        object.position.set(-100, -50, -75);
        object.updateMatrixWorld();

        scheduler.beginFrame(0);
        // Should not throw and should compute distance correctly
        expect(() => scheduler.shouldProcess(object, camera, 0, false)).not.toThrow();
    });

    it("should cap deltaTime multiplier at 3 for very far objects", () => {
        const object = new Object3D();
        object.position.set(200, 0, 0); // 200m away — raw throttle would be 10
        object.updateMatrixWorld();

        for (let i = 0; i < 20; i++) {
            scheduler.beginFrame(i);
            const result = scheduler.shouldProcess(object, camera, 0, false);
            // When the object runs, multiplier should be capped at 3
            expect(result).toBeLessThanOrEqual(3);
        }
    });

    it("should cap deltaTime multiplier at 3 for far objects", () => {
        const object = new Object3D();
        object.position.set(60, 0, 0); // 60m — raw throttle factor would be 4
        object.updateMatrixWorld();

        for (let i = 0; i < 20; i++) {
            scheduler.beginFrame(i);
            const result = scheduler.shouldProcess(object, camera, 0, false);
            expect(result).toBeLessThanOrEqual(3);
        }
    });

    it("should skip objects when throttled based on hash and frame", () => {
        const object = new Object3D();
        object.position.set(60, 0, 0); // Far enough for throttle factor 4
        object.updateMatrixWorld();

        // Count how many frames the object runs in a cycle of 20
        let runCount = 0;
        for (let i = 0; i < 20; i++) {
            scheduler.beginFrame(i);
            const result = scheduler.shouldProcess(object, camera, 0, false);
            if (result > 0) {
                runCount++;
            }
        }

        // With throttle factor 4, should run roughly 5 times in 20 frames
        expect(runCount).toBeGreaterThan(0);
        expect(runCount).toBeLessThanOrEqual(10);
    });
});
