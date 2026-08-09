import {Object3D, PerspectiveCamera, Scene} from "three";
import * as UIKit from "@ni2khanna/uikit";
import {afterEach, describe, expect, it, vi} from "vitest";

import {BehaviorBase} from "./Behavior";
import BehaviorManager from "./BehaviorManager";
import {resetPlayBehaviorStartupTimings} from "./game/GameManager";

function namedObject(name: string): Object3D {
    const object = new Object3D();
    object.name = name;
    return object;
}

function addDeepChain(root: Object3D, depth = 12_000): Object3D {
    let cursor = root;
    for (let i = 0; i < depth; i++) {
        const child = namedObject(`deep-${i}`);
        cursor.add(child);
        cursor = child;
    }
    return cursor;
}

function makeFrameContext(frameDeadline: number, frameCount = 1) {
    return {
        deltaTime: 0.016,
        fixedDeltaTime: 1 / 60,
        fixedUpdatesEnabled: true,
        frameCount,
        interpolationAlpha: 1,
        fixedOverstep: 0,
        frameStartTime: 0,
        frameDeadline,
        underRenderPressure: false,
        renderAvgMs: 0,
        spatialGrid: null,
    };
}

function makeBehavior(id: string, uuid = `${id}-uuid`, target = namedObject(`${id}-target`)) {
    return {
        target,
        setTarget(newTarget: Object3D) {
            this.target = newTarget;
        },
        gameObject: {},
        id,
        uuid,
        attributes: {},
        isPaused: false,
        throttleConfig: {},
        init: vi.fn(),
        dispose: vi.fn(),
        update: vi.fn(),
        onStart: vi.fn(),
        onStop: vi.fn(),
        onPaused: vi.fn(),
        onResumed: vi.fn(),
        onReset: vi.fn(),
        onAttributesUpdated: vi.fn(),
    };
}

describe("BehaviorManager.cleanupBehaviorsForObjectAndChildren", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("cleans deep object hierarchies without recursive traversal", () => {
        const root = namedObject("root");
        const leaf = addDeepChain(root);
        root.userData.behaviors = [{id: "root-behavior", uuid: "root-behavior-uuid"}];
        leaf.userData.behaviors = [{id: "leaf-behavior", uuid: "leaf-behavior-uuid"}];
        leaf.userData.lambdaComponents = [{lambdaId: "leaf-lambda", instanceId: "leaf-lambda-instance"}];
        const traverse = vi.spyOn(root, "traverse");
        const removeBehaviorByUUID = vi.fn();
        const deregisterObjectFromAll = vi.fn();
        const game = {
            removeBehaviorByUUID,
            lambdaManager: {deregisterObjectFromAll},
        };
        const manager = Object.create(BehaviorManager.prototype) as BehaviorManager;
        vi.spyOn(console, "log").mockImplementation(() => {});

        manager.cleanupBehaviorsForObjectAndChildren(root, game as any);

        expect(traverse).not.toHaveBeenCalled();
        expect(removeBehaviorByUUID).toHaveBeenCalledWith("root-behavior-uuid");
        expect(removeBehaviorByUUID).toHaveBeenCalledWith("leaf-behavior-uuid");
        expect(deregisterObjectFromAll).toHaveBeenCalledWith(leaf);
        expect(root.userData.behaviors).toEqual([]);
        expect(leaf.userData.behaviors).toEqual([]);
        expect(leaf.userData.lambdaComponents).toEqual([]);
    });
});

describe("BehaviorManager indexed lookups", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("resolves behavior name aliases without scanning the full behavior list", async () => {
        const manager = new BehaviorManager(
            {
                scene: new Scene(),
            } as any,
            new Map(),
            new Map(),
            undefined,
            new Map([
                ["first.behavior", "Shared Name"],
                ["second.behavior", "Shared Name"],
            ]),
        );
        const first = makeBehavior("first.behavior", "first-uuid");
        const unrelated = makeBehavior("unrelated.behavior", "unrelated-uuid");
        const second = makeBehavior("second.behavior", "second-uuid");

        await (manager as any).startBehavior(first);
        await (manager as any).startBehavior(unrelated);
        await (manager as any).startBehavior(second);
        const filterSpy = vi.spyOn((manager as any).behaviors, "filter");
        const behaviorNameEntriesSpy = vi.spyOn((manager as any).behaviorNames, "entries");

        const results = manager.getBehaviorsById("Shared Name");

        expect(results).toEqual([first, second]);
        expect(filterSpy).not.toHaveBeenCalled();
        expect(behaviorNameEntriesSpy).not.toHaveBeenCalled();
    });

    it("resolves multi-id name lookups without Array.from allocations", async () => {
        const target = namedObject("shared-target");
        const manager = new BehaviorManager(
            {
                scene: new Scene(),
            } as any,
            new Map(),
            new Map(),
            undefined,
            new Map([
                ["first.behavior", "Shared Name"],
                ["second.behavior", "Shared Name"],
            ]),
        );
        const first = makeBehavior("first.behavior", "first-uuid", target);
        const unrelated = makeBehavior("unrelated.behavior", "unrelated-uuid", target);
        const second = makeBehavior("second.behavior", "second-uuid", target);

        await (manager as any).startBehavior(first);
        await (manager as any).startBehavior(unrelated);
        await (manager as any).startBehavior(second);
        const arrayFromSpy = vi.spyOn(Array, "from");

        expect(manager.getBehaviorsById("Shared Name")).toEqual([first, second]);
        expect(manager.getTargetBehaviorsById(target, "Shared Name")).toEqual([first, second]);
        expect(arrayFromSpy).not.toHaveBeenCalled();
    });

    it("refreshes the cached behavior name index when a registered class name changes", async () => {
        const manager = new BehaviorManager(
            {
                scene: new Scene(),
            } as any,
            new Map(),
            new Map(),
        );
        const behavior = makeBehavior("renamed.behavior", "renamed-uuid");
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        manager.registerBehaviorClass("renamed.behavior", {}, class {}, "Old Name");
        manager.registerBehaviorClass("renamed.behavior", {}, class {}, "New Name");
        await (manager as any).startBehavior(behavior);

        expect(manager.getBehaviorsById("Old Name")).toEqual([]);
        expect(manager.getBehaviorsById("New Name")).toEqual([behavior]);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("already exists, overwriting"),
        );
    });
});

describe("BehaviorManager play startup behavior creation", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        delete (globalThis as {__stemPlayBehaviorPhaseTimings?: unknown}).__stemPlayBehaviorPhaseTimings;
        delete (globalThis as {__stemPlayBehaviorPhaseTimingsDropped?: unknown}).__stemPlayBehaviorPhaseTimingsDropped;
    });

    it("yields between behavior construction, init, and start when requested", async () => {
        const events: string[] = [];
        class YieldingBehavior extends BehaviorBase {
            constructor(...args: ConstructorParameters<typeof BehaviorBase>) {
                super(...args);
                events.push("constructor");
            }

            init(game: any): void {
                super.init(game);
                events.push("init");
            }

            onStart(): void {
                events.push("onStart");
            }
        }

        const manager = Object.create(BehaviorManager.prototype) as any;
        manager.behaviorClasses = new Map([["yielding", YieldingBehavior]]);
        manager.behaviorConfigAttributes = new Map([["yielding", {}]]);
        manager.erth = {};
        manager.game = {scene: {userData: {}}, behaviorManager: manager};
        manager.startBehavior = vi.fn(async (behavior: YieldingBehavior) => {
            events.push("start");
            behavior.onStart();
        });
        manager.initBehaviorWorker = vi.fn();
        const yieldToFrame = vi.fn(async () => {
            events.push("yield");
        });

        await manager.createBehavior(namedObject("target"), "yielding", {yieldToFrame});

        const phaseTimings = ((globalThis as {
            __stemPlayBehaviorPhaseTimings?: Array<{id: string; phase: string; success: boolean; target: string}>;
        }).__stemPlayBehaviorPhaseTimings) ?? [];

        expect(events).toEqual([
            "yield",
            "constructor",
            "yield",
            "init",
            "yield",
            "start",
            "onStart",
            "yield",
        ]);
        expect(phaseTimings.map(entry => `${entry.phase}:${entry.id}:${entry.success}`)).toEqual([
            "constructor:yielding:true",
            "init:yielding:true",
            "start:yielding:true",
            "worker:yielding:true",
        ]);
        expect(yieldToFrame).toHaveBeenCalledTimes(4);
    });

    it("keeps the engine target isolated from authored underscore state", async () => {
        const target = namedObject("target");
        class AuthoredScratchStateBehavior extends BehaviorBase {
            init(game: any): void {
                super.init(game);
                (this as any)._target = null;
            }
        }

        const manager = new BehaviorManager(
            {scene: new Scene()} as any,
            new Map([["authored-scratch", {}]]),
            new Map([["authored-scratch", AuthoredScratchStateBehavior]]),
        );

        const behavior = await manager.createBehavior(target, "authored-scratch");

        expect(behavior?.target).toBe(target);
        expect((behavior as any)?._target).toBeNull();
    });

    it("reuses one live GameObject view for behaviors on the same target", async () => {
        const target = namedObject("shared-target");
        const views: unknown[] = [];
        class FirstBehavior extends BehaviorBase {
            constructor(...args: ConstructorParameters<typeof BehaviorBase>) {
                super(...args);
                views.push(this.gameObject);
            }
        }
        class SecondBehavior extends BehaviorBase {
            constructor(...args: ConstructorParameters<typeof BehaviorBase>) {
                super(...args);
                views.push(this.gameObject);
            }
        }

        const manager = new BehaviorManager(
            {scene: new Scene()} as any,
            new Map([[
                "first",
                {},
            ], [
                "second",
                {},
            ]]),
            new Map([
                ["first", FirstBehavior],
                ["second", SecondBehavior],
            ]),
        );

        await manager.createBehavior(target, "first");
        await manager.createBehavior(target, "second");

        expect(views).toHaveLength(2);
        expect(views[0]).toBe(views[1]);
    });

    it("caps phase timing entries and counts dropped late entries without shifting earliest timings", async () => {
        class TimedBehavior extends BehaviorBase {}
        const manager = Object.create(BehaviorManager.prototype) as any;
        manager.behaviorClasses = new Map([["timed", TimedBehavior]]);
        manager.behaviorConfigAttributes = new Map([["timed", {}]]);
        manager.erth = {};
        manager.game = {scene: {userData: {}}, behaviorManager: manager};
        manager.startBehavior = vi.fn(async () => {});
        manager.initBehaviorWorker = vi.fn();

        for (let i = 0; i < 1050; i++) {
            await manager.createBehavior(namedObject(`target-${i}`), "timed");
        }

        const root = globalThis as {
            __stemPlayBehaviorPhaseTimings?: Array<{target: string; phase: string}>;
            __stemPlayBehaviorPhaseTimingsDropped?: number;
        };
        const phaseTimings = root.__stemPlayBehaviorPhaseTimings ?? [];

        expect(phaseTimings).toHaveLength(4096);
        expect(root.__stemPlayBehaviorPhaseTimingsDropped).toBe(104);
        expect(phaseTimings[0]).toMatchObject({target: "target-0", phase: "constructor"});
        expect(phaseTimings[phaseTimings.length - 1]).toMatchObject({target: "target-1023", phase: "worker"});
    });

    it("resets capped phase timings and dropped timing count at play behavior startup reset", () => {
        const root = globalThis as {
            __stemBhvTimings?: Record<string, number>;
            __stemPlayBehaviorTimings?: unknown[];
            __stemPlayBehaviorPhaseTimings?: unknown[];
            __stemPlayBehaviorPhaseTimingsDropped?: number;
        };
        root.__stemBhvTimings = {slow: 10};
        root.__stemPlayBehaviorTimings = [{id: "slow"}];
        root.__stemPlayBehaviorPhaseTimings = [{id: "slow"}];
        root.__stemPlayBehaviorPhaseTimingsDropped = 7;

        resetPlayBehaviorStartupTimings();

        expect(root.__stemBhvTimings).toEqual({});
        expect(root.__stemPlayBehaviorTimings).toEqual([]);
        expect(root.__stemPlayBehaviorPhaseTimings).toEqual([]);
        expect(root.__stemPlayBehaviorPhaseTimingsDropped).toBe(0);
    });

    it("yields inside the real start path before behavior onStart", async () => {
        const events: string[] = [];
        class YieldBeforeStartBehavior extends BehaviorBase {
            constructor(...args: ConstructorParameters<typeof BehaviorBase>) {
                super(...args);
                events.push("constructor");
            }

            init(game: any): void {
                super.init(game);
                events.push("init");
            }

            onStart(): void {
                events.push("onStart");
            }
        }

        const manager = new BehaviorManager(
            {scene: new Scene()} as any,
            new Map([["yielding", {}]]),
            new Map([["yielding", YieldBeforeStartBehavior]]),
        );
        const yieldToFrame = vi.fn(async () => {
            events.push("yield");
        });

        const behavior = await manager.createBehavior(namedObject("target"), "yielding", {yieldToFrame});

        expect(behavior).toBeTruthy();
        expect(events).toEqual([
            "yield",
            "constructor",
            "yield",
            "init",
            "yield",
            "yield",
            "onStart",
            "yield",
        ]);
        expect(yieldToFrame).toHaveBeenCalledTimes(5);
    });

    it("keeps authored yields paint-safe without forcing every lifecycle checkpoint", async () => {
        const events: string[] = [];
        class ExplicitYieldBehavior extends BehaviorBase {
            async onStart(): Promise<void> {
                events.push("onStart");
                await this.yield();
                events.push("after-authored-yield");
            }
        }

        const manager = new BehaviorManager(
            {scene: new Scene()} as any,
            new Map([["explicit-yield", {}]]),
            new Map([["explicit-yield", ExplicitYieldBehavior]]),
        );
        const startupYield = vi.fn(async () => {
            events.push("startup-yield");
        });
        const authoredYield = vi.fn(async () => {
            events.push("authored-yield");
        });

        await manager.createBehavior(namedObject("target"), "explicit-yield", {
            yieldToFrame: authoredYield,
            startupYieldToFrame: startupYield,
        });

        expect(startupYield).toHaveBeenCalled();
        expect(authoredYield).toHaveBeenCalledTimes(1);
        expect(events.indexOf("authored-yield")).toBeGreaterThan(events.indexOf("onStart"));
        expect(events.indexOf("after-authored-yield")).toBeGreaterThan(events.indexOf("authored-yield"));
    });
});

describe("BehaviorManager progressive reset", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("skips inherited no-op reset hooks and only yields for authored resets", async () => {
        const resetCalls = vi.fn();
        class NoResetBehavior extends BehaviorBase {}
        class ResetBehavior extends BehaviorBase {
            onReset(): void {
                resetCalls();
            }
        }

        const manager = Object.create(BehaviorManager.prototype) as any;
        manager.behaviors = [
            new NoResetBehavior(namedObject("no-reset"), "no-reset", {
                gameObject: {} as any,
                erth: {} as any,
            }),
            new ResetBehavior(namedObject("reset"), "reset", {
                gameObject: {} as any,
                erth: {} as any,
            }),
        ];
        manager.processCommandQueue = vi.fn();
        const yieldToFrame = vi.fn(async () => {});

        await manager.resetProgressive({
            batchSize: 1,
            frameBudgetMs: 0,
            yieldToFrame,
        });

        expect(resetCalls).toHaveBeenCalledOnce();
        expect(yieldToFrame).toHaveBeenCalledOnce();
        expect(manager.processCommandQueue).toHaveBeenCalledOnce();
    });
});

describe("BehaviorManager slow start diagnostics", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("warns when onStart spends too long in one synchronous chunk", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const manager = Object.create(BehaviorManager.prototype) as any;
        manager.addEventListeners = vi.fn();
        manager.restoreTransformSnapshot = vi.fn();
        manager.captureTransformSnapshot = vi.fn(() => ({}));
        manager.hasFiniteTransform = vi.fn(() => true);
        manager.behaviorNames = new Map();
        const times = [0, 1205];
        vi.spyOn(performance, "now").mockImplementation(() => times.shift() ?? 1205);
        const behavior = makeBehavior("slow.behavior", "slow-uuid");
        behavior.onStart = vi.fn(async () => {});

        await manager.handleBehaviorStart(behavior, vi.fn(async () => {}));

        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("Slow behavior onStart: \"slow.behavior\""),
        );
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("this.erth.runtime.processInBatches(...)"),
        );
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("this.erth.runtime.yieldToFrame(true)"),
        );
    });

    it("warns when init spends more than one frame in one synchronous chunk", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        class SlowInitBehavior extends BehaviorBase {
            init(game: any): void {
                super.init(game);
            }
        }

        const manager = new BehaviorManager(
            {scene: new Scene()} as any,
            new Map([["slow.init", {}]]),
            new Map([["slow.init", SlowInitBehavior]]),
        );
        const nowSpy = vi.spyOn(performance, "now");
        nowSpy
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(17)
            .mockReturnValue(17);

        await manager.createBehavior(namedObject("slow-target"), "slow.init");

        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("Slow behavior init: \"slow.init\"") ,
        );
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("this.erth.runtime.processInBatches(...)") ,
        );
    });

    it("warns when onAdded spends too long in one synchronous chunk", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const manager = Object.create(BehaviorManager.prototype) as any;
        manager.addEventListeners = vi.fn();
        manager.restoreTransformSnapshot = vi.fn();
        manager.captureTransformSnapshot = vi.fn(() => ({}));
        manager.hasFiniteTransform = vi.fn(() => true);
        manager.behaviorNames = new Map();
        const times = [0, 1304];
        vi.spyOn(performance, "now").mockImplementation(() => times.shift() ?? 1304);
        const behavior = makeBehavior("legacy.slow.behavior", "legacy-slow-uuid") as ReturnType<typeof makeBehavior> & {
            onAdded?: () => Promise<void>;
        };
        behavior.onAdded = vi.fn(async () => {});

        await manager.handleBehaviorStart(behavior, vi.fn(async () => {}));

        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("Slow behavior onAdded: \"legacy.slow.behavior\""),
        );
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("this.erth.runtime.processInBatches(...)"),
        );
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("this.erth.runtime.yieldToFrame(true)"),
        );
    });
});

describe("BehaviorManager transient fullscreen errors", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    function makeFixedBehavior(id: string, fixedUpdate = vi.fn()) {
        const target = namedObject(id);
        return {
            target,
            setTarget(newTarget: Object3D) {
                this.target = newTarget;
            },
            gameObject: {},
            id,
            uuid: `${id}-uuid`,
            attributes: {},
            isPaused: false,
            throttleConfig: {},
            init: vi.fn(),
            dispose: vi.fn(),
            update: vi.fn(),
            fixedUpdate,
            onStart: vi.fn(),
            onStop: vi.fn(),
            onPaused: vi.fn(),
            onResumed: vi.fn(),
            onReset: vi.fn(),
            onAttributesUpdated: vi.fn(),
        };
    }

    it("repairs nested UIKit fullscreen roots without logging repeated transient update errors", () => {
        const uiCamera = new PerspectiveCamera();
        const fullscreen = new (UIKit.Fullscreen as any)({
            getSize(target: {set: (width: number, height: number) => unknown}) {
                return target.set(800, 600);
            },
        }, {});
        const nonCameraParent = namedObject("hud-root");
        nonCameraParent.add(fullscreen);
        const manager = Object.create(BehaviorManager.prototype) as any;
        manager.game = {
            ensureUICamera: vi.fn(() => uiCamera),
            camera: uiCamera,
        };
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        manager.reportBehaviorUpdateError(
            {
                id: "test.behavior",
                panel: {
                    nested: {
                        fullscreen,
                    },
                },
            },
            new Error("fullscreen can only be added to a camera"),
        );

        expect(fullscreen.parent).toBe(uiCamera);
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it("repairs raw fullscreen-named roots that do not expose legacy UIKit layout fields", () => {
        class Fullscreen extends Object3D {
            update() {}
        }

        const uiCamera = new PerspectiveCamera();
        const fullscreen = new Fullscreen();
        const nonCameraParent = namedObject("hud-root");
        nonCameraParent.add(fullscreen);
        const manager = Object.create(BehaviorManager.prototype) as any;
        manager.game = {
            ensureUICamera: vi.fn(() => uiCamera),
            camera: uiCamera,
        };
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        manager.reportBehaviorUpdateError(
            {
                id: "test.behavior",
                panel: {fullscreen},
            },
            new Error("fullscreen can only be added to a camera"),
        );

        expect(fullscreen.parent).toBe(uiCamera);
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it("keeps repaired fullscreen roots from throwing if a script reparents them again", () => {
        class Fullscreen extends Object3D {
            lastDelta = 0;

            update() {
                if (!(this.parent as PerspectiveCamera | null)?.isPerspectiveCamera) {
                    throw new Error("fullscreen can only be added to a camera");
                }
            }
        }

        const uiCamera = new PerspectiveCamera();
        const fullscreen = new Fullscreen();
        const nonCameraParent = namedObject("hud-root");
        nonCameraParent.add(fullscreen);
        const manager = Object.create(BehaviorManager.prototype) as any;
        manager.game = {
            ensureUICamera: vi.fn(() => uiCamera),
            camera: uiCamera,
        };
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        manager.reportBehaviorUpdateError(
            {
                id: "test.behavior",
                panel: {fullscreen},
            },
            new Error("fullscreen can only be added to a camera"),
        );
        nonCameraParent.add(fullscreen);

        expect(() => fullscreen.update()).not.toThrow();
        expect(fullscreen.parent).toBe(uiCamera);
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it("normalizes legacy fullscreen width and height update calls after repair", () => {
        class Fullscreen extends Object3D {
            lastDelta = 0;

            update(delta: number) {
                if (!(this.parent as PerspectiveCamera | null)?.isPerspectiveCamera) {
                    throw new Error("fullscreen can only be added to a camera");
                }
                this.lastDelta = delta;
            }
        }

        const uiCamera = new PerspectiveCamera();
        const fullscreen = new Fullscreen();
        const nonCameraParent = namedObject("hud-root");
        nonCameraParent.add(fullscreen);
        const manager = Object.create(BehaviorManager.prototype) as any;
        manager.game = {
            ensureUICamera: vi.fn(() => uiCamera),
            camera: uiCamera,
        };
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        manager.reportBehaviorUpdateError(
            {
                id: "test.behavior",
                panel: {fullscreen},
            },
            new Error("fullscreen can only be added to a camera"),
        );

        nonCameraParent.add(fullscreen);

        expect(() => (fullscreen.update as (...args: any[]) => void)(800, 600)).not.toThrow();
        expect(fullscreen.parent).toBe(uiCamera);
        expect(fullscreen.lastDelta).toBe(1 / 60);
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it("repairs and suppresses transient fullscreen errors during behavior start", async () => {
        class Fullscreen extends Object3D {
            update() {}
        }

        const uiCamera = new PerspectiveCamera();
        const fullscreen = new Fullscreen();
        const manager = new BehaviorManager(
            {
                scene: new Scene(),
                camera: uiCamera,
                ensureUICamera: vi.fn(() => uiCamera),
            } as any,
            new Map(),
            new Map(),
        );
        const behavior = {
            target: namedObject("target"),
            id: "test.behavior",
            uuid: "behavior-uuid",
            isPaused: false,
            throttleConfig: {},
            panel: {fullscreen},
            onStart: vi.fn(() => {
                throw new Error("fullscreen can only be added to a camera");
            }),
            onAdded: undefined,
        };
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        await expect((manager as any).handleBehaviorStart(behavior)).resolves.toBeUndefined();

        expect(fullscreen.parent).toBe(uiCamera);
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it("suppresses transient fullscreen errors thrown from fixedUpdate", () => {
        const uiCamera = new PerspectiveCamera();
        class Fullscreen extends Object3D {
            update() {}
        }
        const fullscreen = new Fullscreen();
        const manager = new BehaviorManager(
            {
                scene: new Scene(),
                camera: uiCamera,
                ensureUICamera: vi.fn(() => uiCamera),
            } as any,
            new Map(),
            new Map(),
        );
        const behavior = {
            id: "test.behavior",
            uuid: "behavior-uuid",
            isPaused: false,
            panel: {fullscreen},
            fixedUpdate: vi.fn(() => {
                throw new Error("fullscreen can only be added to a camera");
            }),
        };
        (manager as any).behaviors = [behavior];
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        manager.fixedUpdate(1 / 60);

        expect(fullscreen.parent).toBe(uiCamera);
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it("suppresses transient fullscreen errors thrown from update", () => {
        const uiCamera = new PerspectiveCamera();
        class Fullscreen extends Object3D {
            update() {}
        }
        const fullscreen = new Fullscreen();
        const manager = new BehaviorManager(
            {
                scene: new Scene(),
                camera: uiCamera,
                ensureUICamera: vi.fn(() => uiCamera),
            } as any,
            new Map(),
            new Map(),
        );
        const behavior = {
            target: namedObject("target"),
            id: "test.behavior",
            uuid: "behavior-uuid",
            isPaused: false,
            throttleConfig: {},
            panel: {fullscreen},
            update: vi.fn(() => {
                throw new Error("fullscreen can only be added to a camera");
            }),
        };
        (manager as any).behaviors = [behavior];
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        manager.update(1 / 60, makeFrameContext(Infinity));

        expect(fullscreen.parent).toBe(uiCamera);
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it("backs off unrepaired transient fullscreen update errors", () => {
        const uiCamera = new PerspectiveCamera();
        const manager = new BehaviorManager(
            {
                scene: new Scene(),
                camera: uiCamera,
                ensureUICamera: vi.fn(() => uiCamera),
            } as any,
            new Map(),
            new Map(),
        );
        const behavior = {
            target: namedObject("target"),
            id: "test.behavior",
            uuid: "behavior-uuid",
            isPaused: false,
            throttleConfig: {},
            update: vi.fn(() => {
                throw new Error("fullscreen can only be added to a camera");
            }),
        };
        (manager as any).behaviors = [behavior];
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        manager.update(1 / 60);
        manager.update(1 / 60);

        expect(behavior.update).toHaveBeenCalledTimes(1);
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it("backs off repaired transient fullscreen update errors instead of retrying every frame", () => {
        const uiCamera = new PerspectiveCamera();
        class Fullscreen extends Object3D {
            update() {}
        }
        const fullscreen = new Fullscreen();
        const manager = new BehaviorManager(
            {
                scene: new Scene(),
                camera: uiCamera,
                ensureUICamera: vi.fn(() => uiCamera),
            } as any,
            new Map(),
            new Map(),
        );
        const behavior = {
            target: namedObject("target"),
            id: "test.behavior",
            uuid: "behavior-uuid",
            isPaused: false,
            throttleConfig: {},
            panel: {fullscreen},
            update: vi.fn(() => {
                throw new Error("fullscreen can only be added to a camera");
            }),
        };
        (manager as any).behaviors = [behavior];
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        manager.update(1 / 60, makeFrameContext(Infinity, 1));
        manager.update(1 / 60, makeFrameContext(Infinity, 2));
        manager.update(1 / 60, makeFrameContext(Infinity, 31));

        expect(fullscreen.parent).toBe(uiCamera);
        expect(behavior.update).toHaveBeenCalledTimes(2);
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it("caches fixedUpdate behavior discovery between fixed ticks", () => {
        const manager = new BehaviorManager(
            {
                scene: new Scene(),
            } as any,
            new Map(),
            new Map(),
        );
        let fixedUpdateGetterCalls = 0;
        const fixedUpdate = vi.fn();
        const variableOnlyBehavior = {
            id: "variable-only",
            uuid: "variable-only-uuid",
            isPaused: false,
        };
        Object.defineProperty(variableOnlyBehavior, "fixedUpdate", {
            configurable: true,
            get() {
                fixedUpdateGetterCalls++;
                return undefined;
            },
        });
        (manager as any).behaviors = [
            variableOnlyBehavior,
            makeFixedBehavior("fixed", fixedUpdate),
        ];

        manager.fixedUpdate(1 / 60);
        manager.fixedUpdate(1 / 60);

        expect(fixedUpdateGetterCalls).toBe(1);
        expect(fixedUpdate).toHaveBeenCalledTimes(2);
    });

    it("invalidates fixedUpdate discovery when behaviors are added and removed", async () => {
        const manager = new BehaviorManager(
            {
                scene: new Scene(),
            } as any,
            new Map(),
            new Map(),
        );
        const firstFixedUpdate = vi.fn();
        const secondFixedUpdate = vi.fn();
        const first = makeFixedBehavior("first", firstFixedUpdate);
        const second = makeFixedBehavior("second", secondFixedUpdate);

        await (manager as any).startBehavior(first);
        manager.fixedUpdate(1 / 60);
        await (manager as any).startBehavior(second);
        manager.fixedUpdate(1 / 60);
        (manager as any).stopBehavior(first);
        manager.fixedUpdate(1 / 60);

        expect(firstFixedUpdate).toHaveBeenCalledTimes(2);
        expect(secondFixedUpdate).toHaveBeenCalledTimes(2);
    });

    it("does not rescan fullscreen repair roots every frame for the same transient error", () => {
        const uiCamera = new PerspectiveCamera();
        const ensureUICamera = vi.fn(() => uiCamera);
        const manager = Object.create(BehaviorManager.prototype) as any;
        manager.game = {
            ensureUICamera,
            camera: uiCamera,
        };
        manager.frameCount = 1;
        const behavior = {
            id: "test.behavior",
            uuid: "behavior-uuid",
        };
        const error = new Error("fullscreen can only be added to a camera");
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        manager.reportBehaviorUpdateError(behavior, error);
        manager.frameCount = 2;
        manager.reportBehaviorUpdateError(behavior, error);
        manager.frameCount = 30;
        manager.reportBehaviorUpdateError(behavior, error);
        manager.frameCount = 31;
        manager.reportBehaviorUpdateError(behavior, error);

        expect(ensureUICamera).toHaveBeenCalledTimes(2);
        expect(errorSpy).not.toHaveBeenCalled();
    });
});

describe("BehaviorManager update deadline checks", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("does not start a throttler frame when there are no behaviors", () => {
        const manager = new BehaviorManager(
            {
                scene: new Scene(),
                camera: new PerspectiveCamera(),
            } as any,
            new Map(),
            new Map(),
        );
        const throttler = {
            setSpatialGrid: vi.fn(),
            setPressureMultiplier: vi.fn(),
            beginFrame: vi.fn(),
            endFrame: vi.fn(),
        };
        (manager as any).throttler = throttler;

        manager.update(0.016, {
            deltaTime: 0.016,
            fixedDeltaTime: 1 / 60,
            fixedUpdatesEnabled: true,
            frameCount: 1,
            interpolationAlpha: 1,
            fixedOverstep: 0,
            frameStartTime: 0,
            frameDeadline: Infinity,
            underRenderPressure: false,
            renderAvgMs: 0,
            spatialGrid: null,
        });

        expect(throttler.setSpatialGrid).not.toHaveBeenCalled();
        expect(throttler.setPressureMultiplier).not.toHaveBeenCalled();
        expect(throttler.beginFrame).not.toHaveBeenCalled();
        expect(throttler.endFrame).not.toHaveBeenCalled();
    });

    it("does not poll performance.now for tail behavior updates without a finite deadline", () => {
        const manager = new BehaviorManager(
            {
                scene: new Scene(),
                camera: new PerspectiveCamera(),
            } as any,
            new Map(),
            new Map(),
        );
        (manager as any).throttler = null;
        const behaviors = Array.from({length: 9}, (_, index) => ({
            id: `behavior-${index}`,
            uuid: `behavior-${index}-uuid`,
            target: namedObject(`target-${index}`),
            throttleConfig: {},
            update: vi.fn(),
        }));
        (manager as any).behaviors = behaviors;

        const nowSpy = vi.spyOn(performance, "now");

        manager.update(0.016, {
            deltaTime: 0.016,
            fixedDeltaTime: 1 / 60,
            fixedUpdatesEnabled: true,
            frameCount: 1,
            interpolationAlpha: 1,
            fixedOverstep: 0,
            frameStartTime: 0,
            frameDeadline: Infinity,
            underRenderPressure: false,
            renderAvgMs: 0,
            spatialGrid: null,
        });

        expect(nowSpy).not.toHaveBeenCalled();
        expect(behaviors.every((behavior) => behavior.update.mock.calls.length === 1)).toBe(true);
    });

    it("reuses hot classification prepared during spatial target collection", () => {
        const player = namedObject("player");
        const manager = new BehaviorManager(
            {
                scene: new Scene(),
                camera: new PerspectiveCamera(),
                player,
            } as any,
            new Map(),
            new Map(),
        );
        (manager as any).throttler = null;
        const hotTarget = namedObject("hot-target");
        const untrackedTarget = namedObject("untracked-target");
        const behaviors = [
            {
                id: "hot",
                uuid: "hot-uuid",
                target: hotTarget,
                throttleConfig: {requiresConsistentUpdates: true},
                update: vi.fn(),
            },
            {
                id: "untracked",
                uuid: "untracked-uuid",
                target: untrackedTarget,
                throttleConfig: {enableDistanceThrottling: false},
                update: vi.fn(),
            },
        ];
        (manager as any).behaviors = behaviors;
        const tracked: Object3D[] = [];

        manager.prepareFrameSpatialTargets(object => {
            if (object) tracked.push(object);
        }, 7);
        const isHotSpy = vi.spyOn(manager as any, "isHotBehavior");

        manager.update(0.016, makeFrameContext(Infinity, 7));

        expect(tracked).toEqual([hotTarget]);
        expect(isHotSpy).not.toHaveBeenCalled();
        expect(behaviors[0]!.update).toHaveBeenCalledTimes(1);
        expect(behaviors[1]!.update).toHaveBeenCalledTimes(1);
    });

    it("does not touch update-error backoff state on clean behavior updates", () => {
        const manager = new BehaviorManager(
            {
                scene: new Scene(),
                camera: new PerspectiveCamera(),
            } as any,
            new Map(),
            new Map(),
        );
        (manager as any).throttler = null;
        const behavior = {
            id: "clean.behavior",
            uuid: "clean-behavior-uuid",
            target: namedObject("clean-target"),
            throttleConfig: {},
            isPaused: false,
            _accumulatedDelta: 0,
            update: vi.fn(),
        };
        const stateMap = {
            get: vi.fn(),
            delete: vi.fn(),
            set: vi.fn(),
        };
        (manager as any).behaviorUpdateErrorLogState = stateMap;
        (manager as any).behaviorUpdateErrorBackoffCount = 0;
        (manager as any).behaviors = [behavior];

        manager.update(0.016, makeFrameContext(Infinity, 1));

        expect(behavior.update).toHaveBeenCalledTimes(1);
        expect(stateMap.get).not.toHaveBeenCalled();
        expect(stateMap.delete).not.toHaveBeenCalled();
        expect((manager as any).behaviorUpdateErrorPolicy).toBeUndefined();
    });

    it("backs off repeated update exceptions instead of invoking a throwing behavior every frame", () => {
        const manager = new BehaviorManager(
            {
                scene: new Scene(),
                camera: new PerspectiveCamera(),
            } as any,
            new Map(),
            new Map(),
        );
        (manager as any).throttler = null;
        const behavior = {
            id: "throwing.behavior",
            uuid: "throwing-behavior-uuid",
            target: namedObject("throwing-target"),
            throttleConfig: {},
            isPaused: false,
            _accumulatedDelta: 0,
            update: vi.fn(() => {
                throw new Error("boom");
            }),
        };
        (manager as any).behaviors = [behavior];
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        manager.update(0.016, makeFrameContext(Infinity, 1));
        manager.update(0.016, makeFrameContext(Infinity, 2));
        manager.update(0.016, makeFrameContext(Infinity, 3));
        manager.update(0.016, makeFrameContext(Infinity, 4));

        expect(behavior.update).toHaveBeenCalledTimes(3);
        expect(behavior._accumulatedDelta).toBe(0);
        expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it("clears update error backoff after a successful retry", () => {
        const manager = new BehaviorManager(
            {
                scene: new Scene(),
                camera: new PerspectiveCamera(),
            } as any,
            new Map(),
            new Map(),
        );
        (manager as any).throttler = null;
        let attempts = 0;
        const behavior = {
            id: "recovering.behavior",
            uuid: "recovering-behavior-uuid",
            target: namedObject("recovering-target"),
            throttleConfig: {},
            isPaused: false,
            _accumulatedDelta: 0,
            update: vi.fn(() => {
                attempts += 1;
                if (attempts <= 2) {
                    throw new Error("recoverable");
                }
            }),
        };
        (manager as any).behaviors = [behavior];
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        manager.update(0.016, makeFrameContext(Infinity, 1));
        manager.update(0.016, makeFrameContext(Infinity, 2));
        manager.update(0.016, makeFrameContext(Infinity, 3));
        manager.update(0.016, makeFrameContext(Infinity, 4));
        manager.update(0.016, makeFrameContext(Infinity, 5));

        expect(behavior.update).toHaveBeenCalledTimes(4);
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect((manager as any).behaviorUpdateErrorBackoffCount).toBe(0);
    });

    it("resumes tail behavior updates from the skipped tail after a deadline bailout", () => {
        const manager = new BehaviorManager(
            {
                scene: new Scene(),
                camera: new PerspectiveCamera(),
            } as any,
            new Map(),
            new Map(),
        );
        (manager as any).throttler = null;
        const updateOrder: string[] = [];
        const behaviors = Array.from({length: 10}, (_, index) => ({
            id: `behavior-${index}`,
            uuid: `behavior-${index}-uuid`,
            target: namedObject(`target-${index}`),
            throttleConfig: {},
            _accumulatedDelta: undefined as number | undefined,
            update: vi.fn((deltaTime: number) => {
                updateOrder.push(`${index}:${deltaTime.toFixed(3)}`);
            }),
        }));
        (manager as any).behaviors = behaviors;
        const nowSpy = vi.spyOn(performance, "now").mockReturnValue(10);

        manager.update(0.016, makeFrameContext(5));

        expect(updateOrder).toEqual([
            "0:0.016",
            "1:0.016",
            "2:0.016",
            "3:0.016",
            "4:0.016",
            "5:0.016",
            "6:0.016",
            "7:0.016",
        ]);
        expect(behaviors[8]!._accumulatedDelta).toBeCloseTo(0.016);
        expect(behaviors[9]!._accumulatedDelta).toBeCloseTo(0.016);

        updateOrder.length = 0;
        manager.update(0.016, makeFrameContext(5, 2));

        expect(updateOrder).toEqual([
            "8:0.032",
            "9:0.032",
            "0:0.016",
            "1:0.016",
            "2:0.016",
            "3:0.016",
            "4:0.016",
            "5:0.016",
        ]);
        nowSpy.mockRestore();
    });
});
