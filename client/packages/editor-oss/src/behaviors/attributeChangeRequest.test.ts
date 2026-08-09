import * as THREE from "three";

import { BehaviorBase, AttributeChangeResult } from "./Behavior";
import BehaviorManager from "./BehaviorManager";
import { ThrottleContainer } from "./performance/ThrottleContainer";
import type { FrameContext } from "../scheduler/types";

vi.mock("three", async (importOriginal) => ({
    ...await importOriginal<typeof import("three")>(),
    Audio: vi.fn(),
    AudioListener: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 *
 * @param behaviorManager
 */
function createMockGame(behaviorManager?: BehaviorManager) {
    const game = {
        scene: new THREE.Scene(),
        camera: new THREE.PerspectiveCamera(),
        behaviorManager: behaviorManager as any,
    } as any;
    return game;
}

/**
 *
 * @param game
 */
function createManager(game?: any): { manager: BehaviorManager; game: any } {
    const g = game ?? createMockGame();
    const manager = new BehaviorManager(g, new Map(), new Map(), new ThrottleContainer());
    g.behaviorManager = manager;
    return { manager, game: g };
}

/**
 *
 * @param manager
 * @param game
 * @param id
 * @param target
 * @param attrs
 */
function createBehavior(
    manager: BehaviorManager,
    game: any,
    id: string,
    target: THREE.Object3D,
    attrs: Record<string, any> = {},
): BehaviorBase {
    // Minimal userData so updateObjectUserDataBehavior won't warn
    const uuid = THREE.MathUtils.generateUUID();
    if (!target.userData.behaviors) {
        target.userData.behaviors = [];
    }
    target.userData.behaviors.push({ uuid, id, attributesData: { ...attrs } });

    const behavior = new BehaviorBase(target, id, {
        gameObject: { target } as any,
        erth: {} as any,
        attributes: { ...attrs },
        uuid,
    });
    // BehaviorBase.init stores game as _behaviorBaseGame; also set .game for fallback
    behavior.init(game);
    (behavior as any).game = game;
    return behavior;
}

/**
 *
 * @param overrides
 */
function createFrameContext(overrides: Partial<FrameContext> = {}): FrameContext {
    return {
        deltaTime: 0.016,
        fixedDeltaTime: 1 / 60,
        frameCount: 1,
        interpolationAlpha: 1,
        fixedOverstep: 0,
        frameStartTime: 0,
        frameDeadline: Infinity,
        underRenderPressure: false,
        renderAvgMs: 0,
        spatialGrid: null,
        fixedUpdatesEnabled: false,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Attribute Change Request System", () => {
    let manager: BehaviorManager;
    let game: any;

    beforeEach(() => {
        const ctx = createManager();
        manager = ctx.manager;
        game = ctx.game;
    });

    // -- getAttribute -------------------------------------------------------

    describe("getAttribute()", () => {
        it("returns the correct attribute value", () => {
            const obj = new THREE.Object3D();
            const b = createBehavior(manager, game, "test", obj, { health: 100 });
            expect(b.getAttribute("health")).toBe(100);
        });

        it("returns undefined for missing keys", () => {
            const obj = new THREE.Object3D();
            const b = createBehavior(manager, game, "test", obj, {});
            expect(b.getAttribute("missing")).toBeUndefined();
        });

    });

    // -- Sync attribute change -----------------------------------------------

    describe("sync attribute change", () => {
        it("applies change immediately and returns result", () => {
            const obj = new THREE.Object3D();
            const b = createBehavior(manager, game, "test", obj, { health: 100 });

            const result = manager.requestAttributeChange(b, "health", 50, null, { sync: true }) as AttributeChangeResult;

            expect(result.accepted).toBe(true);
            expect(result.key).toBe("health");
            expect(result.value).toBe(50);
            expect(result.previousValue).toBe(100);
            expect(b.getAttribute("health")).toBe(50);
        });

        it("fires onAttributeChanged with correct values", () => {
            const obj = new THREE.Object3D();
            const b = createBehavior(manager, game, "test", obj, { score: 0 });
            const changedSpy = vi.fn();
            b.onAttributeChanged = changedSpy;

            manager.requestAttributeChange(b, "score", 42, null, { sync: true });

            expect(changedSpy).toHaveBeenCalledWith("score", 42, 0);
        });

        it("fires onAttributesUpdated for backward compat", () => {
            const obj = new THREE.Object3D();
            const b = createBehavior(manager, game, "test", obj, { x: 1 });
            const updatedSpy = vi.fn();
            b.onAttributesUpdated = updatedSpy;

            manager.requestAttributeChange(b, "x", 2, null, { sync: true });

            expect(updatedSpy).toHaveBeenCalledTimes(1);
        });
    });

    // -- Async attribute change (queued) -------------------------------------

    describe("async attribute change (queued)", () => {
        it("queues the change and resolves after flush", async () => {
            const obj = new THREE.Object3D();
            const b = createBehavior(manager, game, "test", obj, { health: 100 });

            const promise = manager.requestAttributeChange(b, "health", 75, null) as Promise<AttributeChangeResult>;

            // Not yet applied
            expect(b.getAttribute("health")).toBe(100);

            // Trigger the update loop which flushes the queue
            manager.update(0.016);

            const result = await promise;
            expect(result.accepted).toBe(true);
            expect(result.value).toBe(75);
            expect(b.getAttribute("health")).toBe(75);
        });

        it("flushes queued attribute changes even when there are no active behaviors", async () => {
            const obj = new THREE.Object3D();
            const b = createBehavior(manager, game, "test", obj, { health: 100 });

            const promise = manager.requestAttributeChange(b, "health", 60, null) as Promise<AttributeChangeResult>;

            manager.update(0.016);

            await expect(promise).resolves.toMatchObject({ accepted: true, value: 60 });
            expect(b.getAttribute("health")).toBe(60);
        });

        it("keeps hook-enqueued changes in the same drain without shifting the queue", async () => {
            const obj = new THREE.Object3D();
            const b = createBehavior(manager, game, "test", obj, { health: 100, score: 0 });
            let hookPromise: Promise<AttributeChangeResult> | undefined;

            b.onAttributeChanged = (key: string) => {
                if (key === "health") {
                    hookPromise = manager.requestAttributeChange(b, "score", 10, null) as Promise<AttributeChangeResult>;
                }
            };

            const promise = manager.requestAttributeChange(b, "health", 75, null) as Promise<AttributeChangeResult>;
            const queue = (manager as any).attributeChangeQueue as Array<unknown>;
            const shiftSpy = vi.spyOn(queue, "shift");

            manager.update(0.016);

            await expect(promise).resolves.toMatchObject({ accepted: true, value: 75 });
            expect(hookPromise).toBeDefined();
            await expect(hookPromise!).resolves.toMatchObject({ accepted: true, value: 10 });
            expect(shiftSpy).not.toHaveBeenCalled();
            expect(queue).toHaveLength(0);
            expect(b.getAttribute("health")).toBe(75);
            expect(b.getAttribute("score")).toBe(10);
        });
    });

    describe("command queue flushing", () => {
        it("flushes queued behavior starts even when the active behavior list is empty", async () => {
            const obj = new THREE.Object3D();
            const b = createBehavior(manager, game, "test", obj, {});

            (manager as any).isProcessing = true;
            await (manager as any).startBehavior(b);
            (manager as any).isProcessing = false;

            expect(manager.getBehaviors()).toHaveLength(0);

            manager.update(0.016);

            await vi.waitFor(() => {
                expect(manager.getBehaviors()).toContain(b);
            });
        });
    });

    describe("fresh-frame scheduling", () => {
        it("rate-limits repeated behavior update errors", () => {
            const behavior = createBehavior(manager, game, "noisy-behavior", new THREE.Object3D());
            const error = new Error("generic behavior update failure");
            behavior.update = vi.fn(() => {
                throw error;
            });

            (manager as any).behaviors = [behavior];
            (manager as any).throttler = {
                beginFrame: vi.fn(),
                setSpatialGrid: vi.fn(),
                shouldUpdateBehavior: vi.fn(() => ({ shouldUpdate: true })),
            };
            const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

            try {
                manager.update(0.016, createFrameContext({ frameCount: 1 }));
                manager.update(0.016, createFrameContext({ frameCount: 2 }));
                manager.update(0.016, createFrameContext({ frameCount: 3 }));

                expect(consoleError).toHaveBeenCalledTimes(1);

                manager.update(0.016, createFrameContext({ frameCount: 121 }));

                expect(consoleError).toHaveBeenCalledTimes(2);
                expect(behavior.update).toHaveBeenCalledTimes(3);
                expect(consoleError.mock.calls[1]?.[0]).toContain("2 repeated error(s) suppressed");
            } finally {
                consoleError.mockRestore();
            }
        });

        it("suppresses transient UIKit fullscreen camera update errors", () => {
            const behavior = createBehavior(manager, game, "hud-behavior", new THREE.Object3D());
            const error = new Error("fullscreen can only be added to a camera");
            behavior.update = vi.fn(() => {
                throw error;
            });

            (manager as any).behaviors = [behavior];
            (manager as any).throttler = {
                beginFrame: vi.fn(),
                setSpatialGrid: vi.fn(),
                shouldUpdateBehavior: vi.fn(() => ({ shouldUpdate: true })),
            };
            const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

            try {
                manager.update(0.016, createFrameContext({ frameCount: 1 }));
                manager.update(0.016, createFrameContext({ frameCount: 121 }));

                expect(consoleError).not.toHaveBeenCalled();
            } finally {
                consoleError.mockRestore();
            }
        });

        it("runs fixedUpdate-only behaviors from update() when fixed-rate updates are disabled", () => {
            const behavior = createBehavior(manager, game, "fixed-only", new THREE.Object3D());
            const fixedUpdate = vi.fn();
            behavior.fixedUpdate = fixedUpdate;

            (manager as any).behaviors = [behavior];
            (manager as any).throttler = {
                beginFrame: vi.fn(),
                setSpatialGrid: vi.fn(),
                shouldUpdateBehavior: vi.fn(() => ({ shouldUpdate: true })),
            };

            manager.update(0.016, createFrameContext({ fixedUpdatesEnabled: false }));

            expect(fixedUpdate).toHaveBeenCalledWith(0.016);
        });

        it("accumulates delta for unprocessed tail behaviors when update() hits the deadline", () => {
            const tails = Array.from({ length: 10 }, (_, i) => {
                const behavior = createBehavior(manager, game, `tail-${i}`, new THREE.Object3D());
                behavior.update = vi.fn();
                return behavior;
            });

            (manager as any).behaviors = tails;
            (manager as any).throttler = {
                beginFrame: vi.fn(),
                setSpatialGrid: vi.fn(),
                shouldUpdateBehavior: vi.fn(() => ({ shouldUpdate: true })),
            };

            const nowSpy = vi.spyOn(performance, "now").mockReturnValue(10);

            manager.update(0.016, createFrameContext({ frameDeadline: 5 }));

            expect(tails.slice(0, 8).every(behavior => (behavior.update as any).mock.calls.length === 1)).toBe(true);
            expect(tails[8]!._accumulatedDelta).toBeCloseTo(0.016);
            expect(tails[9]!._accumulatedDelta).toBeCloseTo(0.016);

            nowSpy.mockRestore();
        });

        it("does not reclassify every tail behavior when there are no hot behaviors", () => {
            const tails = Array.from({ length: 4 }, (_, i) => {
                const behavior = createBehavior(manager, game, `tail-${i}`, new THREE.Object3D());
                behavior.update = vi.fn();
                return behavior;
            });

            (manager as any).behaviors = tails;
            (manager as any).throttler = {
                beginFrame: vi.fn(),
                setSpatialGrid: vi.fn(),
                shouldUpdateBehavior: vi.fn(() => ({ shouldUpdate: true })),
            };
            const isHotSpy = vi.spyOn(manager as any, "isHotBehavior");

            manager.update(0.016, createFrameContext());

            expect(isHotSpy).toHaveBeenCalledTimes(tails.length);
            expect(tails.every(behavior => (behavior.update as any).mock.calls.length === 1)).toBe(true);
        });

        it("runs hot behaviors before the tail when the deadline is exhausted", () => {
            const player = new THREE.Object3D();
            game.player = player;

            const hotPlayer = createBehavior(manager, game, "hot-player", player);
            hotPlayer.update = vi.fn();

            const hotConsistent = createBehavior(manager, game, "hot-consistent", new THREE.Object3D());
            hotConsistent.throttleConfig = {
                ...hotConsistent.throttleConfig,
                requiresConsistentUpdates: true,
            };
            hotConsistent.update = vi.fn();

            const tails = Array.from({ length: 10 }, (_, i) => {
                const behavior = createBehavior(manager, game, `tail-${i}`, new THREE.Object3D());
                behavior.update = vi.fn();
                return behavior;
            });

            (manager as any).behaviors = [hotPlayer, hotConsistent, ...tails];
            (manager as any).throttler = {
                beginFrame: vi.fn(),
                setSpatialGrid: vi.fn(),
                shouldUpdateBehavior: vi.fn(() => ({ shouldUpdate: true })),
            };

            const callOrder: string[] = [];
            hotPlayer.update = vi.fn(() => callOrder.push(hotPlayer.id));
            hotConsistent.update = vi.fn(() => callOrder.push(hotConsistent.id));
            tails.forEach((tail) => {
                tail.update = vi.fn(() => callOrder.push(tail.id));
            });

            const nowSpy = vi.spyOn(performance, "now").mockReturnValue(10);
            manager.update(0.016, createFrameContext({ frameDeadline: 5 }));

            expect(callOrder).toEqual([
                "hot-player",
                "hot-consistent",
                "tail-0",
                "tail-1",
                "tail-2",
                "tail-3",
                "tail-4",
                "tail-5",
                "tail-6",
                "tail-7",
            ]);

            nowSpy.mockRestore();
        });

        it("runs hot behaviors before the tail without retaining frame scratch arrays", () => {
            const player = new THREE.Object3D();
            game.player = player;

            const hotPlayer = createBehavior(manager, game, "hot-player", player);
            const tailA = createBehavior(manager, game, "tail-a", new THREE.Object3D());
            const hotConsistent = createBehavior(manager, game, "hot-consistent", new THREE.Object3D());
            hotConsistent.throttleConfig = {
                ...hotConsistent.throttleConfig,
                requiresConsistentUpdates: true,
            };
            const tailB = createBehavior(manager, game, "tail-b", new THREE.Object3D());
            const behaviors = [tailA, hotPlayer, tailB, hotConsistent];
            const callOrder: string[] = [];
            behaviors.forEach((behavior) => {
                behavior.update = vi.fn(() => callOrder.push(behavior.id));
            });

            (manager as any).behaviors = behaviors;
            (manager as any).throttler = {
                beginFrame: vi.fn(),
                setSpatialGrid: vi.fn(),
                shouldUpdateBehavior: vi.fn(() => ({ shouldUpdate: true })),
            };
            const isHotSpy = vi.spyOn(manager as any, "isHotBehavior");

            manager.update(0.016, createFrameContext());

            expect(callOrder).toEqual(["hot-player", "hot-consistent", "tail-a", "tail-b"]);
            expect(isHotSpy.mock.calls.filter(([behavior]) => (behavior as BehaviorBase).id === "tail-a")).toHaveLength(1);
            expect((manager as any).hotBehaviorFrameScratch).toBeUndefined();
            expect((manager as any).tailBehaviorFrameScratch).toBeUndefined();
        });

        it("reuses hot behavior classification storage across frames", () => {
            const player = new THREE.Object3D();
            game.player = player;

            const hotPlayer = createBehavior(manager, game, "hot-player", player);
            const tail = createBehavior(manager, game, "tail", new THREE.Object3D());
            hotPlayer.update = vi.fn();
            tail.update = vi.fn();

            (manager as any).behaviors = [hotPlayer, tail];
            (manager as any).throttler = {
                beginFrame: vi.fn(),
                setSpatialGrid: vi.fn(),
                shouldUpdateBehavior: vi.fn(() => ({ shouldUpdate: true })),
            };

            manager.update(0.016, createFrameContext());
            const firstFlags = (manager as any).hotBehaviorFlags;
            const firstIndexes = (manager as any).hotBehaviorIndexes;

            manager.update(0.016, createFrameContext({ frameCount: 2 }));

            expect((manager as any).hotBehaviorFlags).toBe(firstFlags);
            expect((manager as any).hotBehaviorIndexes).toBe(firstIndexes);
            expect((manager as any).hotBehaviorIndexes).toEqual([0]);
        });

        it("clears stale hot flags when a hot behavior becomes a tail behavior", () => {
            const hotThenTail = createBehavior(manager, game, "hot-then-tail", new THREE.Object3D());
            hotThenTail.throttleConfig = {
                ...hotThenTail.throttleConfig,
                requiresConsistentUpdates: true,
            };
            const tails = Array.from({ length: 10 }, (_, i) => {
                const behavior = createBehavior(manager, game, `tail-${i}`, new THREE.Object3D());
                behavior.update = vi.fn();
                return behavior;
            });
            (manager as any).behaviors = [hotThenTail, ...tails];
            (manager as any).throttler = {
                beginFrame: vi.fn(),
                setSpatialGrid: vi.fn(),
                shouldUpdateBehavior: vi.fn(() => ({ shouldUpdate: true })),
            };

            manager.update(0.016, createFrameContext());

            expect((manager as any).hotBehaviorFlags[0]).toBe(true);

            hotThenTail.throttleConfig = {
                ...hotThenTail.throttleConfig,
                requiresConsistentUpdates: false,
            };
            hotThenTail.update = vi.fn();
            const nowSpy = vi.spyOn(performance, "now").mockReturnValue(10);

            manager.update(0.016, createFrameContext({ frameDeadline: 5, frameCount: 2 }));

            expect((manager as any).hotBehaviorIndexes).toEqual([]);
            expect((manager as any).hotBehaviorFlags[0]).toBe(false);
            expect(hotThenTail._accumulatedDelta ?? 0).toBe(0);
            expect(tails[7]!._accumulatedDelta).toBeCloseTo(0.016);
            nowSpy.mockRestore();
        });

        it("does not accumulate skipped tail delta onto hot behaviors after deadline bailout", () => {
            const tails = Array.from({ length: 10 }, (_, i) => {
                const behavior = createBehavior(manager, game, `tail-${i}`, new THREE.Object3D());
                behavior.update = vi.fn();
                return behavior;
            });
            const hotLate = createBehavior(manager, game, "hot-late", new THREE.Object3D());
            hotLate.throttleConfig = {
                ...hotLate.throttleConfig,
                requiresConsistentUpdates: true,
            };

            const callOrder: string[] = [];
            hotLate.update = vi.fn(() => callOrder.push(hotLate.id));
            tails.forEach((tail) => {
                tail.update = vi.fn(() => callOrder.push(tail.id));
            });

            (manager as any).behaviors = [
                ...tails.slice(0, 8),
                hotLate,
                tails[8]!,
                tails[9]!,
            ];
            (manager as any).throttler = {
                beginFrame: vi.fn(),
                setSpatialGrid: vi.fn(),
                shouldUpdateBehavior: vi.fn(() => ({ shouldUpdate: true })),
            };

            const nowSpy = vi.spyOn(performance, "now").mockReturnValue(10);
            manager.update(0.016, createFrameContext({ frameDeadline: 5 }));

            expect(callOrder).toEqual([
                "hot-late",
                "tail-0",
                "tail-1",
                "tail-2",
                "tail-3",
                "tail-4",
                "tail-5",
                "tail-6",
                "tail-7",
            ]);
            expect(hotLate._accumulatedDelta ?? 0).toBe(0);
            expect(tails[8]!._accumulatedDelta).toBeCloseTo(0.016);
            expect(tails[9]!._accumulatedDelta).toBeCloseTo(0.016);

            nowSpy.mockRestore();
        });

        it("resumes the tail from skipped behaviors after a budget bailout", () => {
            const tails = Array.from({ length: 10 }, (_, i) => {
                const behavior = createBehavior(manager, game, `tail-${i}`, new THREE.Object3D());
                behavior.update = vi.fn();
                return behavior;
            });

            (manager as any).behaviors = tails;
            (manager as any).throttler = {
                beginFrame: vi.fn(),
                setSpatialGrid: vi.fn(),
                shouldUpdateBehavior: vi.fn(() => ({ shouldUpdate: true })),
            };

            const nowSpy = vi.spyOn(performance, "now").mockReturnValue(10);

            manager.update(0.016, createFrameContext({ frameDeadline: 5 }));

            const secondPassOrder: string[] = [];
            tails.forEach((tail) => {
                tail.update = vi.fn(() => secondPassOrder.push(tail.id));
            });

            manager.update(0.016, createFrameContext({ frameDeadline: 5, frameCount: 2 }));

            expect(secondPassOrder.slice(0, 4)).toEqual([
                "tail-8",
                "tail-9",
                "tail-0",
                "tail-1",
            ]);

            nowSpy.mockRestore();
        });
    });

    // -- Rejection via onAttributeChangeRequested ----------------------------

    describe("rejection via onAttributeChangeRequested", () => {
        it("rejects when hook returns false", () => {
            const obj = new THREE.Object3D();
            const b = createBehavior(manager, game, "test", obj, { health: 100 });
            b.onAttributeChangeRequested = (key: string, newValue: any) => {
                if (key === "health" && newValue < 0) return false;
                return true;
            };

            const result = manager.requestAttributeChange(b, "health", -10, null, { sync: true }) as AttributeChangeResult;

            expect(result.accepted).toBe(false);
            expect(result.previousValue).toBe(100);
            expect(b.getAttribute("health")).toBe(100); // unchanged
        });

        it("accepts when hook returns true", () => {
            const obj = new THREE.Object3D();
            const b = createBehavior(manager, game, "test", obj, { health: 100 });
            b.onAttributeChangeRequested = () => true;

            const result = manager.requestAttributeChange(b, "health", 50, null, { sync: true }) as AttributeChangeResult;

            expect(result.accepted).toBe(true);
            expect(b.getAttribute("health")).toBe(50);
        });

        it("accepts by default when hook is not implemented", () => {
            const obj = new THREE.Object3D();
            const b = createBehavior(manager, game, "test", obj, { health: 100 });
            // No onAttributeChangeRequested hook

            const result = manager.requestAttributeChange(b, "health", 50, null, { sync: true }) as AttributeChangeResult;

            expect(result.accepted).toBe(true);
            expect(b.getAttribute("health")).toBe(50);
        });

        it("does not fire onAttributeChanged when rejected", () => {
            const obj = new THREE.Object3D();
            const b = createBehavior(manager, game, "test", obj, { health: 100 });
            b.onAttributeChangeRequested = () => false;
            const changedSpy = vi.fn();
            b.onAttributeChanged = changedSpy;

            manager.requestAttributeChange(b, "health", 50, null, { sync: true });

            expect(changedSpy).not.toHaveBeenCalled();
        });

        it("does not fire onAttributesUpdated when rejected", () => {
            const obj = new THREE.Object3D();
            const b = createBehavior(manager, game, "test", obj, { health: 100 });
            b.onAttributeChangeRequested = () => false;
            const updatedSpy = vi.fn();
            b.onAttributesUpdated = updatedSpy;

            manager.requestAttributeChange(b, "health", 50, null, { sync: true });

            expect(updatedSpy).not.toHaveBeenCalled();
        });

        it("passes requester to onAttributeChangeRequested", () => {
            const obj = new THREE.Object3D();
            const target = createBehavior(manager, game, "enemy", obj, { health: 100 });
            const requester = createBehavior(manager, game, "player", obj, {});
            const hookSpy = vi.fn().mockReturnValue(true);
            target.onAttributeChangeRequested = hookSpy;

            manager.requestAttributeChange(target, "health", 50, requester, { sync: true });

            expect(hookSpy).toHaveBeenCalledWith("health", 50, 100, requester);
        });
    });

    // -- Backward compatibility ----------------------------------------------

    describe("backward compatibility", () => {
        it("direct .attributes access still works", () => {
            const obj = new THREE.Object3D();
            const b = createBehavior(manager, game, "test", obj, { health: 100 });

            b.attributes.health = 50;
            expect(b.getAttribute("health")).toBe(50);
            expect(b.attributes.health).toBe(50);
        });

        it("applyAttributesToBehavior still works and fires both hooks", () => {
            const obj = new THREE.Object3D();
            const b = createBehavior(manager, game, "test", obj, { health: 100, score: 0 });
            const changedSpy = vi.fn();
            const updatedSpy = vi.fn();
            b.onAttributeChanged = changedSpy;
            b.onAttributesUpdated = updatedSpy;

            manager.applyAttributesToBehavior(b, { health: 50, score: 10 });

            // onAttributeChanged fires per key
            expect(changedSpy).toHaveBeenCalledTimes(2);
            expect(changedSpy).toHaveBeenCalledWith("health", 50, 100);
            expect(changedSpy).toHaveBeenCalledWith("score", 10, 0);

            // onAttributesUpdated fires once
            expect(updatedSpy).toHaveBeenCalledTimes(1);

            // Values applied
            expect(b.getAttribute("health")).toBe(50);
            expect(b.getAttribute("score")).toBe(10);
        });
    });

    // -- findBehavior / findBehaviors ----------------------------------------

    describe("findBehavior / findBehaviors", () => {
        it("findBehavior finds a behavior on the same object", async () => {
            const obj = new THREE.Object3D();
            const b1 = createBehavior(manager, game, "player", obj, {});
            const b2 = createBehavior(manager, game, "animation", obj, {});

            // Register behaviors in the manager
            await manager.createBehavior(obj, "player", { uuid: b1.uuid, attributes: {} }).catch(() => {});
            // Since createBehavior needs registered classes, let's test via getBehaviorsById directly
            // Instead, manually push to test the findBehavior logic
            (manager as any).behaviors.push(b1, b2);

            const found = b1.findBehavior("animation");
            expect(found).not.toBeNull();
            expect(found).not.toBe(b2);
            expect(found?.id).toBe("animation");
            expect(found?.target).toBe(obj);
        });

        it("findBehavior returns null when not found", () => {
            const obj = new THREE.Object3D();
            const b = createBehavior(manager, game, "player", obj, {});
            (manager as any).behaviors.push(b);

            const found = b.findBehavior("nonexistent");
            expect(found).toBeNull();
        });

        it("findBehavior on a different target", () => {
            const obj1 = new THREE.Object3D();
            const obj2 = new THREE.Object3D();
            const b1 = createBehavior(manager, game, "player", obj1, {});
            const b2 = createBehavior(manager, game, "enemy", obj2, {});
            (manager as any).behaviors.push(b1, b2);

            const found = b1.findBehavior("enemy", obj2);
            expect(found).not.toBeNull();
            expect(found).not.toBe(b2);
            expect(found?.id).toBe("enemy");
            expect(found?.target).toBe(obj2);
        });

        it("findBehaviors finds all behaviors of a type in scene", () => {
            const obj1 = new THREE.Object3D();
            const obj2 = new THREE.Object3D();
            const b1 = createBehavior(manager, game, "enemy", obj1, {});
            const b2 = createBehavior(manager, game, "enemy", obj2, {});
            const b3 = createBehavior(manager, game, "player", obj1, {});
            (manager as any).behaviors.push(b1, b2, b3);

            const enemies = b3.findBehaviors("enemy");
            expect(enemies).toHaveLength(2);
            expect(enemies.map(enemy => enemy.id)).toEqual(["enemy", "enemy"]);
            expect(enemies.every(enemy => enemy !== b1 && enemy !== b2)).toBe(true);
        });

        it("findBehavior resolves by behavior display name on the same object", () => {
            manager.registerBehaviorClass("boxController", {}, class {}, "Box Controller");

            const obj = new THREE.Object3D();
            const controller = createBehavior(manager, game, "boxController", obj, {});
            const observer = createBehavior(manager, game, "observer", obj, {});
            (manager as any).behaviors.push(controller, observer);

            const found = observer.findBehavior("Box Controller");
            expect(found?.id).toBe("boxController");
        });

        it("findBehaviors resolves by behavior display name case-insensitively", () => {
            manager.registerBehaviorClass("enemyAI", {}, class {}, "Enemy AI");

            const obj1 = new THREE.Object3D();
            const obj2 = new THREE.Object3D();
            const b1 = createBehavior(manager, game, "enemyAI", obj1, {});
            const b2 = createBehavior(manager, game, "enemyAI", obj2, {});
            (manager as any).behaviors.push(b1, b2);

            const found = b1.findBehaviors("enemy ai");
            expect(found).toHaveLength(2);
            expect(found.map(item => item.id)).toEqual(["enemyAI", "enemyAI"]);
        });

        it("findBehavior on a different target resolves by display name", () => {
            manager.registerBehaviorClass("health", {}, class {}, "Health");

            const obj1 = new THREE.Object3D();
            const obj2 = new THREE.Object3D();
            const seeker = createBehavior(manager, game, "seeker", obj1, {});
            const targetHealth = createBehavior(manager, game, "health", obj2, {});
            (manager as any).behaviors.push(seeker, targetHealth);

            const found = seeker.findBehavior("Health", obj2);
            expect(found?.id).toBe("health");
            expect(found?.target).toBe(obj2);
        });

        it("prefers exact behavior ids over matching display names", () => {
            manager.registerBehaviorClass("boxController", {}, class {}, "Controller");
            manager.registerBehaviorClass("Controller", {}, class {}, "Something Else");

            const obj = new THREE.Object3D();
            const exactIdMatch = createBehavior(manager, game, "Controller", obj, {});
            const namedMatch = createBehavior(manager, game, "boxController", obj, {});
            const observer = createBehavior(manager, game, "observer", obj, {});
            (manager as any).behaviors.push(exactIdMatch, namedMatch, observer);

            const found = observer.findBehavior("Controller");
            expect(found?.id).toBe("Controller");
        });

        it("blocks direct foreign attribute mutation and still allows requestAttributeChange", () => {
            const obj = new THREE.Object3D();
            const owner = createBehavior(manager, game, "health", obj, {hp: 100});
            const requester = createBehavior(manager, game, "observer", obj, {});
            (manager as any).behaviors.push(owner, requester);

            const foreign = requester.findBehavior("health");
            expect(foreign).not.toBeNull();

            (foreign!.attributes).hp = 25;
            expect(owner.getAttribute("hp")).toBe(100);

            const result = foreign!.requestAttributeChange("hp", 50, {sync: true}) as AttributeChangeResult;
            expect(result.accepted).toBe(true);
            expect(owner.getAttribute("hp")).toBe(50);
        });
    });

    // -- behavior lookup indexes ----------------------------------------------

    describe("behavior lookup indexes", () => {
        it("tracks behavior id and uuid lookups across start and stop", async () => {
            const obj = new THREE.Object3D();
            const otherObj = new THREE.Object3D();
            const first = createBehavior(manager, game, "enemy", obj, {});
            const second = createBehavior(manager, game, "enemy", otherObj, {});

            await (manager as any).startBehavior(first);
            await (manager as any).startBehavior(second);

            expect(manager.getBehaviorsById("enemy")).toEqual([first, second]);
            expect(manager.getTargetBehaviors(obj)).toEqual([first]);
            expect(manager.getTargetBehaviorsById(obj, "enemy")).toEqual([first]);
            expect(manager.getBehaviorByUUID(second.uuid)).toBe(second);

            first.target = otherObj;

            expect(manager.getTargetBehaviors(obj)).toEqual([]);
            expect(manager.getTargetBehaviors(otherObj)).toEqual([first, second]);
            expect(manager.getTargetBehaviorsById(otherObj, "enemy")).toEqual([first, second]);

            (manager as any).stopBehavior(first);

            expect(manager.getBehaviorsById("enemy")).toEqual([second]);
            expect(manager.getTargetBehaviorsById(obj, "enemy")).toEqual([]);
            expect(manager.getBehaviorByUUID(first.uuid)).toBeNull();
        });

        it("rebuilds indexes when the behavior array is replaced or mutated directly", () => {
            const obj = new THREE.Object3D();
            const first = createBehavior(manager, game, "enemy", obj, {});
            const second = createBehavior(manager, game, "enemy", obj, {});

            (manager as any).behaviors = [first, second];

            expect(manager.getBehaviorsById("enemy")).toEqual([first, second]);
            expect(manager.getTargetBehaviors(obj)).toEqual([first, second]);
            expect(manager.getBehaviorByUUID(first.uuid)).toBe(first);

            (manager as any).behaviors.pop();

            expect(manager.getBehaviorsById("enemy")).toEqual([first]);
            expect(manager.getTargetBehaviors(obj)).toEqual([first]);
            expect(manager.getBehaviorByUUID(second.uuid)).toBeNull();
        });

        it("skips duplicate behavior instances through the membership index", async () => {
            const obj = new THREE.Object3D();
            const first = createBehavior(manager, game, "enemy", obj, {});
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

            await (manager as any).startBehavior(first);
            const includesSpy = vi.fn(() => {
                throw new Error("startup should not scan behaviors with Array.includes");
            });
            (manager as any).behaviors.includes = includesSpy;

            await (manager as any).startBehavior(first);

            expect(includesSpy).not.toHaveBeenCalled();
            expect(manager.getBehaviorsById("enemy")).toEqual([first]);
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("already exists"));
        });

        it("dispatches events to target behaviors while honoring excluded ids", async () => {
            const obj = new THREE.Object3D();
            const receiver = createBehavior(manager, game, "receiver", obj, {});
            const skipped = createBehavior(manager, game, "skipped", obj, {});
            const otherTarget = createBehavior(manager, game, "receiver", new THREE.Object3D(), {});
            receiver.onEvent = vi.fn();
            skipped.onEvent = vi.fn();
            otherTarget.onEvent = vi.fn();

            await (manager as any).startBehavior(receiver);
            await (manager as any).startBehavior(skipped);
            await (manager as any).startBehavior(otherTarget);

            manager.sendEventToObjectBehaviors(obj, "activate", {power: 2}, ["skipped"]);

            expect(receiver.onEvent).toHaveBeenCalledWith("activate", {power: 2});
            expect(skipped.onEvent).not.toHaveBeenCalled();
            expect(otherTarget.onEvent).not.toHaveBeenCalled();
        });
    });

    // -- requestAttributeChange via BehaviorBase convenience -----------------

    describe("BehaviorBase.requestAttributeChange()", () => {
        it("delegates to BehaviorManager", () => {
            const obj = new THREE.Object3D();
            const b = createBehavior(manager, game, "test", obj, { hp: 100 });

            const result = b.requestAttributeChange("hp", 50, { sync: true }) as AttributeChangeResult;

            expect(result.accepted).toBe(true);
            expect(result.value).toBe(50);
            expect(b.getAttribute("hp")).toBe(50);
        });
    });

    // -- StemEngineInterface.behaviors ---------------------------------------------

    describe("StemEngineInterface behaviors", () => {
        it("behaviors.getAttribute reads attribute via behavior", () => {
            const obj = new THREE.Object3D();
            const b = createBehavior(manager, game, "test", obj, { health: 100 });
            (manager as any).behaviors.push(b);

            // Simulate createStemEngineInterface behaviors
            const erthBehaviors = {
                find: (target: THREE.Object3D, id: string) => {
                    const results = manager.getTargetBehaviorsById(target, id);
                    return results[0] ?? null;
                },
                findAll: (id: string) => manager.getBehaviorsById(id),
                findOnObject: (target: THREE.Object3D) => manager.getTargetBehaviors(target),
                getAttribute: (behavior: any, key: string) => behavior.getAttribute(key),
                requestChange: (behavior: any, key: string, value: any, options?: any) =>
                    manager.requestAttributeChange(behavior, key, value, null, options),
            };

            const found = erthBehaviors.find(obj, "test");
            expect(found).toBe(b);
            expect(erthBehaviors.getAttribute(b, "health")).toBe(100);

            const result = erthBehaviors.requestChange(b, "health", 50, { sync: true }) as AttributeChangeResult;
            expect(result.accepted).toBe(true);
            expect(b.getAttribute("health")).toBe(50);
        });
    });
});
