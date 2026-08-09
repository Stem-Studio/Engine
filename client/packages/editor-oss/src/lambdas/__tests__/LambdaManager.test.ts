import {Object3D} from "three";
import {describe, it, expect, vi, beforeEach} from "vitest";

import type GameManager from "@stem/editor-oss/behaviors/game/GameManager";
import {ComponentDataPool} from "../ComponentDataPool";
import {createForeignLambdaView, type LambdaConfig} from "../Lambda";
import {LambdaBase} from "../LambdaBase";
import {LambdaManager} from "../LambdaManager";
import {FUSED_PHYSICS_ID} from "../packs/fusedPhysics/FusedPhysicsLambda";

class MockLambda extends LambdaBase {
    public initCalled = false;
    public disposeCalled = false;

    init(game: GameManager): void {
        this.initCalled = true;
        this._game = game;
    }

    dispose(): void {
        this.disposeCalled = true;
        super.dispose();
    }
}

class FailingInitLambda extends LambdaBase {
    init(): void {
        throw new Error("Init failed");
    }
}

class FailingDisposeLambda extends LambdaBase {
    dispose(): void {
        throw new Error("Dispose failed");
    }
}

class RecordingLambda extends LambdaBase {
    static callOrder: string[] = [];

    update(): void {
        RecordingLambda.callOrder.push(this.id);
    }
}

class CountingUpdateLambda extends LambdaBase {
    static callCount = 0;

    update(): void {
        CountingUpdateLambda.callCount++;
    }
}

class DeadlineRecordingLambda extends LambdaBase {
    static callOrder: string[] = [];

    update(): void {
        DeadlineRecordingLambda.callOrder.push(String(this.attributes.label));
    }
}

class ReloadedLambda extends LambdaBase {
    public runtimeTag = "reloaded";
}

class FixedOnlyLambda extends LambdaBase {
    static fixedUpdateCalls: number[] = [];

    fixedUpdate(fixedDeltaTime: number): void {
        FixedOnlyLambda.fixedUpdateCalls.push(fixedDeltaTime);
    }
}

class FixedDeadlineRecordingLambda extends LambdaBase {
    static callOrder: string[] = [];

    fixedUpdate(): void {
        FixedDeadlineRecordingLambda.callOrder.push(String(this.attributes.label));
    }
}

class ThrowingObjectAddedLambda extends LambdaBase {
    onObjectAdded(): void {
        throw new Error("onObjectAdded failed");
    }
}

const mockConfig: LambdaConfig = {
    id: "test-lambda",
    name: "Test Lambda",
    version: "1.0.0",
    main: "TestLambda.ts",
    attributes: {strength: {name: "Strength", type: "number", default: 10}},
    componentSchema: {
        mass: {name: "Mass", type: "number", default: 1.0},
        drag: {name: "Drag", type: "number", default: 0.1},
    },
};

const createMockGameManager = (): GameManager => ({
    scene: {
        userData: {},
    },
} as GameManager);

describe("LambdaManager", () => {
    let manager: LambdaManager;
    let game: GameManager;

    beforeEach(() => {
        game = createMockGameManager();
        manager = new LambdaManager(game);
        (game as any).lambdaManager = manager;
        FixedOnlyLambda.fixedUpdateCalls = [];
        FixedDeadlineRecordingLambda.callOrder = [];
        CountingUpdateLambda.callCount = 0;
        DeadlineRecordingLambda.callOrder = [];
    });

    describe("registerLambdaClass", () => {
        it("should store class and config", () => {
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);

            expect(manager.hasLambdaClass("test-lambda")).toBe(true);
            expect(manager.getConfig("test-lambda")).toEqual(mockConfig);
        });

        it("should reject duplicates with error", () => {
            const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);

            expect(errorSpy).toHaveBeenCalledWith(
                expect.stringContaining("already registered"),
            );
            errorSpy.mockRestore();
        });
    });

    describe("unregisterLambdaClass", () => {
        it("should remove class and config", () => {
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);
            manager.unregisterLambdaClass("test-lambda");

            expect(manager.hasLambdaClass("test-lambda")).toBe(false);
            expect(manager.getConfig("test-lambda")).toBeNull();
        });
    });

    describe("createInstance", () => {
        it("should return instance with correct id", async () => {
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);

            const instance = await manager.createInstance("test-lambda");

            expect(instance).not.toBeNull();
            expect(instance!.id).toBe("test-lambda");
        });

        it("should use provided uuid", async () => {
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);

            const instance = await manager.createInstance("test-lambda", {
                uuid: "custom-uuid",
            });

            expect(instance!.uuid).toBe("custom-uuid");
        });

        it("should call init", async () => {
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);

            const instance = (await manager.createInstance("test-lambda")) as MockLambda;

            expect(instance.initCalled).toBe(true);
        });

        it("yields around constructor and init without exposing the yield hook to lambda options", async () => {
            const events: string[] = [];
            class YieldingLambda extends LambdaBase {
                constructor(id: string, options: any) {
                    super(id, options);
                    events.push("constructor");
                    expect(options.yieldToFrame).toBeUndefined();
                }

                init(gameManager: GameManager): void {
                    super.init(gameManager);
                    events.push("init");
                }
            }
            manager.registerLambdaClass("yielding", {...mockConfig, id: "yielding"}, YieldingLambda);
            const yieldToFrame = vi.fn(async () => {
                events.push("yield");
            });

            const instance = await manager.createInstance("yielding", {
                uuid: "yielding-instance",
                yieldToFrame,
            });

            expect(instance?.uuid).toBe("yielding-instance");
            expect(events).toEqual([
                "yield",
                "constructor",
                "yield",
                "init",
                "yield",
            ]);
            expect(yieldToFrame).toHaveBeenCalledTimes(3);
        });

        it("should return null for unknown lambdaId", async () => {
            const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
            const instance = await manager.createInstance("unknown");

            expect(instance).toBeNull();
            errorSpy.mockRestore();
        });

        it("should return null and dispose on init failure", async () => {
            const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
            manager.registerLambdaClass("failing", {...mockConfig, id: "failing"}, FailingInitLambda);

            const instance = await manager.createInstance("failing");

            expect(instance).toBeNull();
            errorSpy.mockRestore();
        });

        it("should be retrievable after creation", async () => {
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);

            const instance = await manager.createInstance("test-lambda");
            const retrieved = manager.getInstance(instance!.uuid);

            expect(retrieved).toBe(instance);
        });
    });

    describe("destroyInstance", () => {
        it("should call dispose and remove from instances", async () => {
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);
            const instance = (await manager.createInstance("test-lambda")) as MockLambda;

            manager.destroyInstance(instance.uuid);

            expect(instance.disposeCalled).toBe(true);
            expect(manager.getInstance(instance.uuid)).toBeNull();
        });

        it("should deregister all objects from instance", async () => {
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);
            const instance = await manager.createInstance("test-lambda");
            const obj = new Object3D();
            manager.registerObject(instance!.uuid, obj, {mass: 5});

            manager.destroyInstance(instance!.uuid);

            expect(manager.getObjectLambdas(obj)).toHaveLength(0);
        });

        it("should handle dispose errors gracefully", async () => {
            const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
            manager.registerLambdaClass("failing", {...mockConfig, id: "failing"}, FailingDisposeLambda);
            const instance = await manager.createInstance("failing");

            manager.destroyInstance(instance!.uuid);

            expect(manager.getInstance(instance!.uuid)).toBeNull();
            errorSpy.mockRestore();
        });

        it("should no-op for unknown instanceId", () => {
            // Should not throw
            manager.destroyInstance("unknown-id");
        });

        it("invalidates the cached instance list after an instance is destroyed", async () => {
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);
            const first = await manager.createInstance("test-lambda");
            const second = await manager.createInstance("test-lambda");

            expect(manager.getAllInstances()).toEqual([first, second]);

            manager.destroyInstance(first!.uuid);

            expect(manager.getAllInstances()).toEqual([second]);
        });
    });

    describe("reloadLambdaClass", () => {
        it("preserves instance ids, attributes, and object registrations across class reload", async () => {
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);
            const instance = await manager.createInstance("test-lambda", {
                uuid: "instance-1",
                attributes: {strength: 42},
            });
            const obj = new Object3D();
            manager.registerObject("instance-1", obj, {mass: 5, drag: 0.25, _isCritical: true});

            await manager.reloadLambdaClass("test-lambda", {
                ...mockConfig,
                description: "Reloaded",
            }, ReloadedLambda);

            const reloaded = manager.getInstance("instance-1") as ReloadedLambda | null;
            expect(reloaded).not.toBeNull();
            expect(reloaded).not.toBe(instance);
            expect(reloaded).toBeInstanceOf(ReloadedLambda);
            expect(reloaded!.runtimeTag).toBe("reloaded");
            expect(reloaded!.attributes).toEqual({strength: 42});
            expect(reloaded!.getComponentData(obj)).toEqual(expect.objectContaining({mass: 5, drag: 0.25}));
            expect(reloaded!.getComponentData(obj)?._isCritical).toBe(false);
            expect(manager.getObjectLambdas(obj)).toEqual([reloaded]);
            expect(manager.getConfig("test-lambda")?.description).toBe("Reloaded");
        });
    });

    describe("getInstancesByType", () => {
        it("should return instances matching type", async () => {
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);
            await manager.createInstance("test-lambda");
            await manager.createInstance("test-lambda");

            const instances = manager.getInstancesByType("test-lambda");
            expect(instances).toHaveLength(2);
        });

        it("should remove destroyed instances from type lookups", async () => {
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);
            const first = await manager.createInstance("test-lambda");
            const second = await manager.createInstance("test-lambda");

            manager.destroyInstance(first!.uuid);

            expect(manager.getInstancesByType("test-lambda")).toEqual([second]);
        });

        it("should return empty for unknown type", () => {
            expect(manager.getInstancesByType("unknown")).toHaveLength(0);
        });
    });

    describe("attribute requests and foreign views", () => {
        it("updates lambda attributes through requestAttributeChange and persists to scene data", async () => {
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);
            (game.scene.userData as any).lambdaInstances = [{
                lambdaId: "test-lambda",
                instanceId: "lambda-1",
                enabled: true,
                attributes: {strength: 10},
            }];

            const instance = await manager.createInstance("test-lambda", {
                uuid: "lambda-1",
                attributes: {strength: 10},
            });

            const result = instance!.requestAttributeChange("strength", 42, {sync: true});
            expect(result).toEqual({
                accepted: true,
                key: "strength",
                value: 42,
                previousValue: 10,
            });
            expect(instance!.attributes.strength).toBe(42);
            expect((game.scene.userData as any).lambdaInstances[0].attributes).toEqual({strength: 42});
        });

        it("blocks direct foreign attribute mutation while allowing requestAttributeChange", async () => {
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);
            const instance = await manager.createInstance("test-lambda", {
                attributes: {strength: 10},
            });
            const foreign = createForeignLambdaView(instance!);

            (foreign.attributes).strength = 99;
            expect(instance!.attributes.strength).toBe(10);

            const result = foreign.requestAttributeChange("strength", 25, {sync: true});
            expect(result).toEqual({
                accepted: true,
                key: "strength",
                value: 25,
                previousValue: 10,
            });
            expect(instance!.attributes.strength).toBe(25);
        });

        it("keeps hook-enqueued async changes in the same drain without shifting the queue", async () => {
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);
            const instance = await manager.createInstance("test-lambda", {
                attributes: {strength: 10, agility: 1},
            });
            let hookPromise: Promise<any> | undefined;

            instance!.onAttributeChanged = (key: string) => {
                if (key === "strength") {
                    hookPromise = manager.requestAttributeChange(instance!, "agility", 5, null) as Promise<any>;
                }
            };

            const promise = manager.requestAttributeChange(instance!, "strength", 42, null) as Promise<any>;
            const queue = (manager as any).attributeChangeQueue as Array<unknown>;
            const shiftSpy = vi.spyOn(queue, "shift");

            manager.update(0.016);

            await expect(promise).resolves.toMatchObject({accepted: true, value: 42});
            expect(hookPromise).toBeDefined();
            await expect(hookPromise!).resolves.toMatchObject({accepted: true, value: 5});
            expect(shiftSpy).not.toHaveBeenCalled();
            expect(queue).toHaveLength(0);
            expect(instance!.attributes.strength).toBe(42);
            expect(instance!.attributes.agility).toBe(5);
        });
    });

    describe("dependency wave cache", () => {
        it("should reuse cached waves when instances have not changed", async () => {
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);
            await manager.createInstance("test-lambda");

            const first = (manager as any).buildWaves();
            const second = (manager as any).buildWaves();

            expect(second).toBe(first);
        });

        it("should keep no-metadata lambdas in one wave without building dependency edges", async () => {
            const plainConfigA: LambdaConfig = {
                id: "plain-a",
                name: "Plain A",
                version: "1.0.0",
                main: "PlainA.ts",
                attributes: {},
                componentSchema: {},
            };
            const plainConfigB: LambdaConfig = {
                id: "plain-b",
                name: "Plain B",
                version: "1.0.0",
                main: "PlainB.ts",
                attributes: {},
                componentSchema: {},
            };
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

            manager.registerLambdaClass("plain-a", plainConfigA, RecordingLambda);
            manager.registerLambdaClass("plain-b", plainConfigB, RecordingLambda);
            const plainA = await manager.createInstance("plain-a");
            const plainB = await manager.createInstance("plain-b");

            const waves = (manager as any).buildWaves();

            expect(waves).toEqual([[plainA, plainB]]);
            expect(warnSpy).not.toHaveBeenCalled();

            warnSpy.mockRestore();
        });

        it("should rebuild dependency waves after updateConfig changes read/write metadata", async () => {
            const lambdaAConfig: LambdaConfig = {
                id: "lambda-a",
                name: "Lambda A",
                version: "1.0.0",
                main: "LambdaA.ts",
                attributes: {},
                componentSchema: {},
            };
            const lambdaBConfig: LambdaConfig = {
                id: "lambda-b",
                name: "Lambda B",
                version: "1.0.0",
                main: "LambdaB.ts",
                attributes: {},
                componentSchema: {},
            };

            manager.registerLambdaClass("lambda-b", lambdaBConfig, RecordingLambda);
            manager.registerLambdaClass("lambda-a", lambdaAConfig, RecordingLambda);
            await manager.createInstance("lambda-b");
            await manager.createInstance("lambda-a");

            RecordingLambda.callOrder = [];
            manager.update(0.016);
            expect(RecordingLambda.callOrder).toEqual(["lambda-b", "lambda-a"]);

            manager.updateConfig("lambda-a", {
                ...lambdaAConfig,
                writeComponents: ["transform"],
            });
            manager.updateConfig("lambda-b", {
                ...lambdaBConfig,
                readComponents: ["transform"],
            });

            RecordingLambda.callOrder = [];
            manager.update(0.016);
            expect(RecordingLambda.callOrder).toEqual(["lambda-a", "lambda-b"]);
        });

        it("should refresh cached component defaults after updateConfig changes schema metadata", async () => {
            const initialConfig: LambdaConfig = {
                id: "configurable",
                name: "Configurable",
                version: "1.0.0",
                main: "Configurable.ts",
                attributes: {},
                componentSchema: {
                    mass: {name: "Mass", type: "number", default: 1},
                },
            };
            const updatedConfig: LambdaConfig = {
                ...initialConfig,
                componentSchema: {
                    mass: {name: "Mass", type: "number", default: 2},
                    drag: {name: "Drag", type: "number", default: 0.25},
                },
            };

            manager.registerLambdaClass("configurable", initialConfig, MockLambda);
            const instance = await manager.createInstance("configurable");
            const firstObject = new Object3D();
            const secondObject = new Object3D();

            manager.registerObject(instance!.uuid, firstObject);
            manager.updateConfig("configurable", updatedConfig);
            manager.registerObject(instance!.uuid, secondObject);

            expect(instance!.getComponentData(firstObject)).toMatchObject({mass: 1});
            expect(instance!.getComponentData(secondObject)).toMatchObject({mass: 2, drag: 0.25});
        });

        it("should count each writer-reader pair once for overlapping components", async () => {
            const writerConfig: LambdaConfig = {
                id: "writer",
                name: "Writer",
                version: "1.0.0",
                main: "Writer.ts",
                attributes: {},
                componentSchema: {},
                writeComponents: ["transform", "velocity"],
            };
            const readerConfig: LambdaConfig = {
                id: "reader",
                name: "Reader",
                version: "1.0.0",
                main: "Reader.ts",
                attributes: {},
                componentSchema: {},
                readComponents: ["transform", "velocity"],
            };
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

            manager.registerLambdaClass("writer", writerConfig, RecordingLambda);
            manager.registerLambdaClass("reader", readerConfig, RecordingLambda);
            const writer = await manager.createInstance("writer");
            const reader = await manager.createInstance("reader");

            const waves = (manager as any).buildWaves();

            expect(waves).toEqual([[writer], [reader]]);
            expect(warnSpy).not.toHaveBeenCalled();

            warnSpy.mockRestore();
        });

        it("should keep same-component read-write peers in the same wave", async () => {
            const writerConfig: LambdaConfig = {
                id: "writer",
                name: "Writer",
                version: "1.0.0",
                main: "Writer.ts",
                attributes: {},
                componentSchema: {},
                writeComponents: ["transform"],
            };
            const peerConfig: LambdaConfig = {
                id: "peer",
                name: "Peer",
                version: "1.0.0",
                main: "Peer.ts",
                attributes: {},
                componentSchema: {},
                readComponents: ["transform"],
                writeComponents: ["transform"],
            };

            manager.registerLambdaClass("writer", writerConfig, RecordingLambda);
            manager.registerLambdaClass("peer", peerConfig, RecordingLambda);
            const writer = await manager.createInstance("writer");
            const peer = await manager.createInstance("peer");

            const waves = (manager as any).buildWaves();

            expect(waves).toEqual([[writer, peer]]);
        });

        it("should keep cyclic lambdas scheduled in a fallback wave", async () => {
            const lambdaAConfig: LambdaConfig = {
                id: "lambda-a",
                name: "Lambda A",
                version: "1.0.0",
                main: "LambdaA.ts",
                attributes: {},
                componentSchema: {},
                readComponents: ["velocity"],
                writeComponents: ["transform"],
            };
            const lambdaBConfig: LambdaConfig = {
                id: "lambda-b",
                name: "Lambda B",
                version: "1.0.0",
                main: "LambdaB.ts",
                attributes: {},
                componentSchema: {},
                readComponents: ["transform"],
                writeComponents: ["velocity"],
            };
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

            manager.registerLambdaClass("lambda-a", lambdaAConfig, RecordingLambda);
            manager.registerLambdaClass("lambda-b", lambdaBConfig, RecordingLambda);
            const lambdaA = await manager.createInstance("lambda-a");
            const lambdaB = await manager.createInstance("lambda-b");

            const waves = (manager as any).buildWaves();

            expect(waves).toHaveLength(1);
            expect(waves[0]).toEqual([lambdaA, lambdaB]);
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining("lambda(s) stuck in dependency cycle"),
                "lambda-a, lambda-b",
            );

            warnSpy.mockRestore();
        });
    });

    describe("update", () => {
        it("does not tick adaptive scheduling when no lambda instances exist", () => {
            const beginFrameSpy = vi.spyOn(manager.scheduler, "beginFrame");

            manager.update(0.016);

            expect(beginFrameSpy).not.toHaveBeenCalled();
        });

        it("reuses authoritative frame preparation across fixed and variable stages", async () => {
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);
            await manager.createInstance("test-lambda");
            const beginFrameSpy = vi.spyOn(manager.scheduler, "beginFrame");
            const context = {
                deltaTime: 1 / 60,
                fixedDeltaTime: 1 / 60,
                fixedUpdatesEnabled: true,
                frameCount: 1,
                interpolationAlpha: 0,
                fixedOverstep: 0,
                frameStartTime: 0,
                frameDeadline: 8,
                underRenderPressure: false,
                renderAvgMs: 16,
                spatialGrid: null,
            };

            manager.beginSimulationFrame(context);
            manager.fixedUpdate(1 / 60, context);
            manager.update(1 / 60, context);

            expect(beginFrameSpy).toHaveBeenCalledOnce();
        });

        it("ticks adaptive scheduling when lambda instances exist", async () => {
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);
            await manager.createInstance("test-lambda");
            const beginFrameSpy = vi.spyOn(manager.scheduler, "beginFrame");

            manager.update(0.016);

            expect(beginFrameSpy).toHaveBeenCalledOnce();
        });

        it("executes all instances in one fresh pass", async () => {
            manager.registerLambdaClass("counting-lambda", {...mockConfig, id: "counting-lambda"}, CountingUpdateLambda);
            await manager.createInstance("counting-lambda");
            await manager.createInstance("counting-lambda");
            await manager.createInstance("counting-lambda");

            manager.update(0.016);

            expect(CountingUpdateLambda.callCount).toBe(3);
        });

        it("checks the shared deadline after every eight variable-update instances", async () => {
            manager.registerLambdaClass("counting-lambda", {...mockConfig, id: "counting-lambda"}, CountingUpdateLambda);
            for (let i = 0; i < 9; i++) {
                await manager.createInstance("counting-lambda");
            }

            const nowSpy = vi.spyOn(performance, "now");
            nowSpy.mockReturnValue(10);

            manager.update(0.016, {
                deltaTime: 0.016,
                fixedDeltaTime: 1 / 60,
                fixedUpdatesEnabled: true,
                frameCount: 1,
                interpolationAlpha: 1,
                fixedOverstep: 0,
                frameStartTime: 0,
                frameDeadline: 5,
                underRenderPressure: false,
                renderAvgMs: 0,
                spatialGrid: null,
            });

            expect(CountingUpdateLambda.callCount).toBe(8);
            nowSpy.mockRestore();
        });

        it("resumes variable updates from the skipped tail after a deadline bailout", async () => {
            manager.registerLambdaClass("deadline-recording", {
                ...mockConfig,
                id: "deadline-recording",
                componentSchema: {},
            }, DeadlineRecordingLambda);
            for (let i = 0; i < 10; i++) {
                await manager.createInstance("deadline-recording", {attributes: {label: i}});
            }

            const nowSpy = vi.spyOn(performance, "now").mockReturnValue(10);
            const context = {
                deltaTime: 0.016,
                fixedDeltaTime: 1 / 60,
                fixedUpdatesEnabled: true,
                frameCount: 1,
                interpolationAlpha: 1,
                fixedOverstep: 0,
                frameStartTime: 0,
                frameDeadline: 5,
                underRenderPressure: false,
                renderAvgMs: 0,
                spatialGrid: null,
            };

            manager.update(0.016, context);
            expect(DeadlineRecordingLambda.callOrder).toEqual([
                "0", "1", "2", "3", "4", "5", "6", "7",
            ]);

            DeadlineRecordingLambda.callOrder = [];
            manager.update(0.016, {...context, frameCount: 2});

            expect(DeadlineRecordingLambda.callOrder.slice(0, 2)).toEqual(["8", "9"]);
            expect(DeadlineRecordingLambda.callOrder).toEqual([
                "8", "9", "0", "1", "2", "3", "4", "5",
            ]);
            nowSpy.mockRestore();
        });

        it("does not poll performance.now for variable updates without a finite deadline", async () => {
            manager.registerLambdaClass("counting-lambda", {...mockConfig, id: "counting-lambda"}, CountingUpdateLambda);
            for (let i = 0; i < 9; i++) {
                await manager.createInstance("counting-lambda");
            }

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

            expect(CountingUpdateLambda.callCount).toBe(9);
            expect(nowSpy).not.toHaveBeenCalled();
            nowSpy.mockRestore();
        });

        it("never deadline-throttles authoritative fixed-update instances", async () => {
            manager.registerLambdaClass("fixed-only", {...mockConfig, id: "fixed-only"}, FixedOnlyLambda);
            for (let i = 0; i < 9; i++) {
                await manager.createInstance("fixed-only");
            }

            const nowSpy = vi.spyOn(performance, "now").mockReturnValue(10);

            manager.fixedUpdate(1 / 60, {
                deltaTime: 0.016,
                fixedDeltaTime: 1 / 60,
                fixedUpdatesEnabled: true,
                frameCount: 1,
                interpolationAlpha: 1,
                fixedOverstep: 0,
                frameStartTime: 0,
                frameDeadline: 5,
                underRenderPressure: false,
                renderAvgMs: 0,
                spatialGrid: null,
            });

            expect(FixedOnlyLambda.fixedUpdateCalls).toHaveLength(9);
            expect(nowSpy).not.toHaveBeenCalled();
            nowSpy.mockRestore();
        });

        it("runs every fixed instance exactly once on every fixed step", async () => {
            manager.registerLambdaClass("fixed-recording", {
                ...mockConfig,
                id: "fixed-recording",
                componentSchema: {},
            }, FixedDeadlineRecordingLambda);
            for (let i = 0; i < 10; i++) {
                await manager.createInstance("fixed-recording", {attributes: {label: i}});
            }

            const nowSpy = vi.spyOn(performance, "now").mockReturnValue(10);
            const context = {
                deltaTime: 0.016,
                fixedDeltaTime: 1 / 60,
                fixedUpdatesEnabled: true,
                frameCount: 1,
                interpolationAlpha: 1,
                fixedOverstep: 0,
                frameStartTime: 0,
                frameDeadline: 5,
                underRenderPressure: false,
                renderAvgMs: 0,
                spatialGrid: null,
            };

            manager.fixedUpdate(1 / 60, context);
            expect(FixedDeadlineRecordingLambda.callOrder).toEqual([
                "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
            ]);

            FixedDeadlineRecordingLambda.callOrder = [];
            manager.fixedUpdate(1 / 60, {...context, frameCount: 2});

            expect(FixedDeadlineRecordingLambda.callOrder).toEqual([
                "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
            ]);
            expect(nowSpy).not.toHaveBeenCalled();
            nowSpy.mockRestore();
        });

        it("orders fixed writers before readers regardless of creation order", async () => {
            const order: string[] = [];
            class FixedWriter extends LambdaBase {
                fixedUpdate(): void {
                    order.push("writer");
                }
            }
            class FixedReader extends LambdaBase {
                fixedUpdate(): void {
                    order.push("reader");
                }
            }
            manager.registerLambdaClass("fixed-reader", {
                ...mockConfig,
                id: "fixed-reader",
                readComponents: ["transform"],
                writeComponents: [],
            }, FixedReader);
            manager.registerLambdaClass("fixed-writer", {
                ...mockConfig,
                id: "fixed-writer",
                readComponents: [],
                writeComponents: ["transform"],
            }, FixedWriter);
            // Deliberately create the reader first to prove this is not Map
            // insertion order.
            await manager.createInstance("fixed-reader");
            await manager.createInstance("fixed-writer");

            manager.fixedUpdate(1 / 60);

            expect(order).toEqual(["writer", "reader"]);
        });

        it("uses the cached fixed-instance list without allocating a fresh values iterator", async () => {
            manager.registerLambdaClass("fixed-recording", {
                ...mockConfig,
                id: "fixed-recording",
                componentSchema: {},
            }, FixedDeadlineRecordingLambda);
            for (let i = 0; i < 10; i++) {
                await manager.createInstance("fixed-recording", {attributes: {label: i}});
            }

            (manager as any).getInstanceList();
            const valuesSpy = vi.spyOn((manager as any).instances, "values");
            const nowSpy = vi.spyOn(performance, "now").mockReturnValue(10);

            manager.fixedUpdate(1 / 60, {
                deltaTime: 0.016,
                fixedDeltaTime: 1 / 60,
                fixedUpdatesEnabled: true,
                frameCount: 2,
                interpolationAlpha: 1,
                fixedOverstep: 0,
                frameStartTime: 0,
                frameDeadline: 5,
                underRenderPressure: false,
                renderAvgMs: 0,
                spatialGrid: null,
            });

            expect(FixedDeadlineRecordingLambda.callOrder).toEqual([
                "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
            ]);
            expect(valuesSpy).not.toHaveBeenCalled();
            expect(nowSpy).not.toHaveBeenCalled();

            nowSpy.mockRestore();
            valuesSpy.mockRestore();
        });

        it("caches fixedUpdate instance discovery between fixed ticks", async () => {
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);
            manager.registerLambdaClass("fixed-only", {...mockConfig, id: "fixed-only"}, FixedOnlyLambda);
            const variableOnly = await manager.createInstance("test-lambda");
            await manager.createInstance("fixed-only");
            let fixedUpdateGetterCalls = 0;
            Object.defineProperty(variableOnly, "fixedUpdate", {
                configurable: true,
                get() {
                    fixedUpdateGetterCalls++;
                    return undefined;
                },
            });

            manager.fixedUpdate(1 / 60);
            manager.fixedUpdate(1 / 60);

            expect(fixedUpdateGetterCalls).toBe(1);
            expect(FixedOnlyLambda.fixedUpdateCalls).toHaveLength(2);
        });

        it("invalidates fixedUpdate discovery when lambda instances are added and removed", async () => {
            manager.registerLambdaClass("fixed-recording", {
                ...mockConfig,
                id: "fixed-recording",
                componentSchema: {},
            }, FixedDeadlineRecordingLambda);

            const first = await manager.createInstance("fixed-recording", {attributes: {label: "first"}});
            manager.fixedUpdate(1 / 60);
            const second = await manager.createInstance("fixed-recording", {attributes: {label: "second"}});
            manager.fixedUpdate(1 / 60);
            manager.destroyInstance(first!.uuid);
            manager.fixedUpdate(1 / 60);

            expect(second).not.toBeNull();
            expect(FixedDeadlineRecordingLambda.callOrder).toEqual([
                "first",
                "first",
                "second",
                "second",
            ]);
        });

        it("does not poll performance.now for fixed updates without a finite deadline", async () => {
            manager.registerLambdaClass("fixed-only", {...mockConfig, id: "fixed-only"}, FixedOnlyLambda);
            for (let i = 0; i < 9; i++) {
                await manager.createInstance("fixed-only");
            }

            const nowSpy = vi.spyOn(performance, "now");

            manager.fixedUpdate(1 / 60, {
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

            expect(FixedOnlyLambda.fixedUpdateCalls).toHaveLength(9);
            expect(nowSpy).not.toHaveBeenCalled();
            nowSpy.mockRestore();
        });
    });

    describe("registerObject", () => {
        it("should add object to instance and reverse lookup", async () => {
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);
            const instance = await manager.createInstance("test-lambda");
            const obj = new Object3D();

            const result = manager.registerObject(instance!.uuid, obj, {mass: 5});

            expect(result).toBe(true);
            expect(instance!.entityCount).toBe(1);
            expect(instance!.getComponentData(obj)).toEqual(expect.objectContaining({mass: 5}));
            expect(manager.getObjectLambdas(obj)).toHaveLength(1);
        });

        it("should use default component data if none provided", async () => {
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);
            const instance = await manager.createInstance("test-lambda");
            const obj = new Object3D();

            manager.registerObject(instance!.uuid, obj);

            expect(instance!.getComponentData(obj)).toEqual(expect.objectContaining({mass: 1.0, drag: 0.1}));
        });

        it("auto-fuses physics registrations without leaking runtime criticality", async () => {
            manager.registerLambdaClass("velocity", {
                ...mockConfig,
                id: "velocity",
                name: "Velocity",
                componentSchema: {
                    vx: {name: "Velocity X", type: "number", default: 0},
                    vy: {name: "Velocity Y", type: "number", default: 0},
                    drag: {name: "Drag", type: "number", default: 0},
                },
            }, MockLambda);
            manager.registerLambdaClass("rigidbody", {
                ...mockConfig,
                id: "rigidbody",
                name: "Rigid Body",
                componentSchema: {
                    mass: {name: "Mass", type: "number", default: 1},
                    drag: {name: "Drag", type: "number", default: 0},
                    useGravity: {name: "Use Gravity", type: "number", default: 1},
                },
            }, MockLambda);
            const velocity = await manager.createInstance("velocity", {
                attributes: {gravityStrength: 5, solver: "velocity"},
            });
            const rigidbody = await manager.createInstance("rigidbody", {
                attributes: {gravity: 9, solver: "rigidbody"},
            });
            const obj = new Object3D();

            manager.registerObject(velocity!.uuid, obj, {
                vx: 1,
                vy: 2,
                drag: 0.1,
                _isCritical: true,
            });
            manager.registerObject(rigidbody!.uuid, obj, {
                mass: 4,
                drag: 0.7,
                useGravity: 1,
                _isCritical: true,
            });

            const lambdas = manager.getObjectLambdas(obj);
            expect(lambdas).toHaveLength(1);
            expect(lambdas[0]!.id).toBe(FUSED_PHYSICS_ID);
            expect(velocity!.entityCount).toBe(0);
            expect(rigidbody!.entityCount).toBe(0);
            expect(lambdas[0]!.attributes).toEqual(expect.objectContaining({
                gravity: 9,
                gravityStrength: 5,
                solver: "rigidbody",
            }));
            expect(lambdas[0]!.getComponentData(obj)).toEqual(expect.objectContaining({
                vx: 1,
                vy: 2,
                mass: 4,
                drag: 0.7,
                useGravity: 1,
            }));
            expect(lambdas[0]!.getComponentData(obj)?._isCritical).toBe(false);
        });

        it("should return false for unknown instance", () => {
            const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
            const obj = new Object3D();

            const result = manager.registerObject("unknown", obj, {});

            expect(result).toBe(false);
            errorSpy.mockRestore();
        });

        it("releases pooled default data when registration fails", async () => {
            manager.registerLambdaClass(
                "throwing-lambda",
                {...mockConfig, id: "throwing-lambda"},
                ThrowingObjectAddedLambda,
            );
            const instance = await manager.createInstance("throwing-lambda");
            const obj = new Object3D();
            const releaseSpy = vi.spyOn(ComponentDataPool, "release");
            const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

            const result = manager.registerObject(instance!.uuid, obj);

            expect(result).toBe(false);
            expect(instance!.entityCount).toBe(0);
            expect(manager.getObjectLambdas(obj)).toHaveLength(0);
            expect(releaseSpy).toHaveBeenCalledWith("throwing-lambda", expect.any(Object));

            releaseSpy.mockRestore();
            errorSpy.mockRestore();
        });
    });

    describe("deregisterObject", () => {
        it("should remove from instance and reverse lookup", async () => {
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);
            const instance = await manager.createInstance("test-lambda");
            const obj = new Object3D();
            manager.registerObject(instance!.uuid, obj, {mass: 5});

            manager.deregisterObject(instance!.uuid, obj);

            expect(instance!.entityCount).toBe(0);
            expect(manager.getObjectLambdas(obj)).toHaveLength(0);
        });

        it("should no-op for unknown instance", () => {
            const obj = new Object3D();
            // Should not throw
            manager.deregisterObject("unknown", obj);
        });
    });

    describe("deregisterObjectFromAll", () => {
        it("should remove object from all lambda instances", async () => {
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);
            const instance1 = await manager.createInstance("test-lambda");
            const instance2 = await manager.createInstance("test-lambda");
            const obj = new Object3D();
            manager.registerObject(instance1!.uuid, obj, {mass: 1});
            manager.registerObject(instance2!.uuid, obj, {mass: 2});

            expect(manager.getObjectLambdas(obj)).toHaveLength(2);

            manager.deregisterObjectFromAll(obj);

            expect(manager.getObjectLambdas(obj)).toHaveLength(0);
            expect(instance1!.entityCount).toBe(0);
            expect(instance2!.entityCount).toBe(0);
        });
    });

    describe("getObjectLambdas", () => {
        it("should return correct instances for object", async () => {
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);
            const instance = await manager.createInstance("test-lambda");
            const obj = new Object3D();
            manager.registerObject(instance!.uuid, obj, {});

            const lambdas = manager.getObjectLambdas(obj);

            expect(lambdas).toHaveLength(1);
            expect(lambdas[0]).toBe(instance);
        });

        it("should return empty for unregistered object", () => {
            expect(manager.getObjectLambdas(new Object3D())).toHaveLength(0);
        });
    });

    describe("forEachRegisteredObject", () => {
        it("iterates each registered object once", async () => {
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);
            const instance1 = await manager.createInstance("test-lambda");
            const instance2 = await manager.createInstance("test-lambda");
            const obj1 = new Object3D();
            const obj2 = new Object3D();

            manager.registerObject(instance1!.uuid, obj1, {});
            manager.registerObject(instance2!.uuid, obj1, {});
            manager.registerObject(instance1!.uuid, obj2, {});

            const objects: Object3D[] = [];
            manager.forEachRegisteredObject(object => objects.push(object));

            expect(objects).toHaveLength(2);
            expect(objects).toEqual(expect.arrayContaining([obj1, obj2]));
        });

        it("skips objects after their last registration is removed", async () => {
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);
            const instance = await manager.createInstance("test-lambda");
            const obj = new Object3D();

            manager.registerObject(instance!.uuid, obj, {});
            manager.deregisterObject(instance!.uuid, obj);

            const objects: Object3D[] = [];
            manager.forEachRegisteredObject(object => objects.push(object));

            expect(objects).toHaveLength(0);
        });
    });

    describe("update", () => {
        it("runs fixedUpdate-only lambdas from apply() by default in legacy runtime mode", async () => {
            manager.registerLambdaClass("fixed-only", {...mockConfig, id: "fixed-only"}, FixedOnlyLambda);
            await manager.createInstance("fixed-only");

            manager.update(0.016);

            expect(FixedOnlyLambda.fixedUpdateCalls).toEqual([0.016]);
        });
    });

    describe("dispose", () => {
        it("should destroy all instances but keep registered classes", async () => {
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);
            const instance = (await manager.createInstance("test-lambda")) as MockLambda;

            manager.dispose();

            expect(instance.disposeCalled).toBe(true);
            expect(manager.getInstance(instance.uuid)).toBeNull();
            // Classes should be preserved for reuse between play cycles
            expect(manager.hasLambdaClass("test-lambda")).toBe(true);
        });

        it("should clear object registrations while draining multiple live instances", async () => {
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);
            const instance1 = await manager.createInstance("test-lambda");
            const instance2 = await manager.createInstance("test-lambda");
            const obj = new Object3D();
            manager.registerObject(instance1!.uuid, obj, {mass: 1});
            manager.registerObject(instance2!.uuid, obj, {mass: 2});

            manager.dispose();

            expect(manager.getInstance(instance1!.uuid)).toBeNull();
            expect(manager.getInstance(instance2!.uuid)).toBeNull();
            expect(manager.getObjectLambdas(obj)).toHaveLength(0);
            expect(manager.hasLambdaClass("test-lambda")).toBe(true);
        });
    });

    describe("fullDispose", () => {
        it("should destroy all instances and clear registries", async () => {
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);
            const instance = (await manager.createInstance("test-lambda")) as MockLambda;

            manager.fullDispose();

            expect(instance.disposeCalled).toBe(true);
            expect(manager.getInstance(instance.uuid)).toBeNull();
            expect(manager.hasLambdaClass("test-lambda")).toBe(false);
        });
    });

    describe("query", () => {
        const configA: LambdaConfig = {
            ...mockConfig,
            id: "velocity",
            name: "Velocity",
        };
        const configB: LambdaConfig = {
            ...mockConfig,
            id: "collider",
            name: "Collider",
        };

        it("should find objects matching required lambda types", async () => {
            manager.registerLambdaClass("velocity", configA, MockLambda);
            manager.registerLambdaClass("collider", configB, MockLambda);
            const instA = await manager.createInstance("velocity");
            const instB = await manager.createInstance("collider");

            const obj1 = new Object3D();
            const obj2 = new Object3D();
            manager.registerObject(instA!.uuid, obj1, {});
            manager.registerObject(instB!.uuid, obj1, {});
            manager.registerObject(instA!.uuid, obj2, {}); // only velocity

            const results = manager.query({required: ["velocity", "collider"]});
            expect(results).toHaveLength(1);
            expect(results[0]).toBe(obj1);
        });

        it("should exclude objects with excluded lambda types", async () => {
            manager.registerLambdaClass("velocity", configA, MockLambda);
            manager.registerLambdaClass("collider", configB, MockLambda);
            const instA = await manager.createInstance("velocity");
            const instB = await manager.createInstance("collider");

            const obj1 = new Object3D();
            const obj2 = new Object3D();
            manager.registerObject(instA!.uuid, obj1, {});
            manager.registerObject(instA!.uuid, obj2, {});
            manager.registerObject(instB!.uuid, obj2, {}); // has collider → excluded

            const results = manager.query({
                required: ["velocity"],
                excluded: ["collider"],
            });
            expect(results).toHaveLength(1);
            expect(results[0]).toBe(obj1);
        });

        it("should update archetype after deregisterObject", async () => {
            manager.registerLambdaClass("velocity", configA, MockLambda);
            manager.registerLambdaClass("collider", configB, MockLambda);
            const instA = await manager.createInstance("velocity");
            const instB = await manager.createInstance("collider");

            const obj = new Object3D();
            manager.registerObject(instA!.uuid, obj, {});
            manager.registerObject(instB!.uuid, obj, {});

            expect(manager.query({required: ["velocity", "collider"]})).toHaveLength(1);

            manager.deregisterObject(instB!.uuid, obj);

            expect(manager.query({required: ["velocity", "collider"]})).toHaveLength(0);
            expect(manager.query({required: ["velocity"]})).toHaveLength(1);
        });

        it("should update archetype after destroyInstance", async () => {
            manager.registerLambdaClass("velocity", configA, MockLambda);
            const inst = await manager.createInstance("velocity");
            const obj = new Object3D();
            manager.registerObject(inst!.uuid, obj, {});

            expect(manager.query({required: ["velocity"]})).toHaveLength(1);

            manager.destroyInstance(inst!.uuid);

            expect(manager.query({required: ["velocity"]})).toHaveLength(0);
        });

        it("should clear archetypes on dispose", async () => {
            manager.registerLambdaClass("velocity", configA, MockLambda);
            const inst = await manager.createInstance("velocity");
            const obj = new Object3D();
            manager.registerObject(inst!.uuid, obj, {});

            manager.dispose();

            expect(manager.query({})).toHaveLength(0);
        });
    });

    describe("sendEventToObjectLambdas", () => {
        it("should send events to all lambdas associated with an object", async () => {
            manager.registerLambdaClass("test-lambda", mockConfig, MockLambda);
            const instance = await manager.createInstance("test-lambda");
            const obj = new Object3D();
            manager.registerObject(instance!.uuid, obj, {});

            const eventSpy = vi.spyOn(instance!, "onEvent");
            manager.sendEventToObjectLambdas(obj, "trigger", {type: "activate"});

            expect(eventSpy).toHaveBeenCalledWith("trigger", {type: "activate"});
        });

        it("should handle event errors gracefully", async () => {
            class ErrorEventLambda extends LambdaBase {
                onEvent(): void {
                    throw new Error("Event error");
                }
            }

            const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
            manager.registerLambdaClass("error-lambda", {...mockConfig, id: "error-lambda"}, ErrorEventLambda);
            const instance = await manager.createInstance("error-lambda");
            const obj = new Object3D();
            manager.registerObject(instance!.uuid, obj, {});

            // Should not throw
            manager.sendEventToObjectLambdas(obj, "trigger", {});
            expect(errorSpy).toHaveBeenCalled();
            errorSpy.mockRestore();
        });
    });
});
