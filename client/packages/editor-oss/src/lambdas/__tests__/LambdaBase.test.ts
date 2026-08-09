/*
 * Copyright: StemStudio contributors
 * Portions of this code are derived from the Shadow Editor (MIT License)
 */
import {Object3D, PerspectiveCamera} from "three";
import {describe, it, expect, vi, beforeEach} from "vitest";

import type GameManager from "@stem/editor-oss/behaviors/game/GameManager";
import {ComponentDataPool} from "../ComponentDataPool";
import {LambdaBase} from "../LambdaBase";

class TestLambda extends LambdaBase {
    public updateCalled = false;
    public processedObjects: Object3D[] = [];

    update(_deltaTime?: number): void {
        this.updateCalled = true;
        for (const [obj] of this._registeredObjects) {
            this.processedObjects.push(obj);
        }
    }
}

const createMockGameManager = (): GameManager => ({} as GameManager);

describe("LambdaBase", () => {
    let lambda: TestLambda;

    beforeEach(() => {
        lambda = new TestLambda("test-lambda", {
            uuid: "test-uuid-123",
            attributes: {strength: 10},
        });
    });

    describe("constructor", () => {
        it("should set id, uuid, and attributes", () => {
            expect(lambda.id).toBe("test-lambda");
            expect(lambda.uuid).toBe("test-uuid-123");
            expect(lambda.attributes).toEqual({strength: 10});
        });

        it("should generate uuid if not provided", () => {
            const noUuid = new TestLambda("test", {});
            expect(noUuid.uuid).toBeTruthy();
            expect(noUuid.uuid.length).toBeGreaterThan(0);
        });

        it("should default attributes to empty object", () => {
            const noAttrs = new TestLambda("test", {});
            expect(noAttrs.attributes).toEqual({});
        });
    });

    describe("init", () => {
        it("should store game reference", () => {
            const game = createMockGameManager();
            lambda.init(game);
            expect(lambda["_game"]).toBe(game);
        });
    });

    describe("_registerObject", () => {
        it("should add object to registered objects map", () => {
            const obj = new Object3D();
            const data = {mass: 5};
            lambda._registerObject(obj, data);

            expect(lambda.entityCount).toBe(1);
            expect(lambda.getComponentData(obj)).toEqual(expect.objectContaining({mass: 5}));
        });

        it("should call onObjectAdded", () => {
            const obj = new Object3D();
            const data = {mass: 5};
            const spy = vi.spyOn(lambda, "onObjectAdded");

            lambda._registerObject(obj, data);

            expect(spy).toHaveBeenCalledWith(obj, data);
        });

        it("should update data when registering same object again", () => {
            const obj = new Object3D();
            lambda._registerObject(obj, {mass: 5});
            lambda._registerObject(obj, {mass: 10});

            expect(lambda.entityCount).toBe(1);
            expect(lambda.getComponentData(obj)).toEqual(expect.objectContaining({mass: 10}));
        });

        it("releases replaced component data after successful duplicate registration", () => {
            const obj = new Object3D();
            const previousData = {mass: 5};
            const nextData = {mass: 10};
            const releaseSpy = vi.spyOn(ComponentDataPool, "release");

            lambda._registerObject(obj, previousData);
            lambda._registerObject(obj, nextData);

            expect(releaseSpy).toHaveBeenCalledWith("test-lambda", previousData);
            expect(lambda.getComponentData(obj)).toBe(nextData);

            releaseSpy.mockRestore();
        });

        it("rolls back first registration when onObjectAdded throws", () => {
            const obj = new Object3D();
            obj.userData._isSceneStatic = true;
            obj.matrixAutoUpdate = true;
            obj.matrixWorldAutoUpdate = false;
            vi.spyOn(lambda, "onObjectAdded").mockImplementation(() => {
                throw new Error("add failed");
            });

            expect(() => lambda._registerObject(obj, {mass: 5})).toThrow("add failed");

            expect(lambda.entityCount).toBe(0);
            expect(lambda.getComponentData(obj)).toBeNull();
            expect(obj.userData._lambdaRegCount).toBeUndefined();
            expect(obj.userData._isSceneStatic).toBe(true);
            expect(obj.matrixAutoUpdate).toBe(true);
            expect(obj.matrixWorldAutoUpdate).toBe(false);
        });

        it("restores previous data when duplicate registration onObjectAdded throws", () => {
            const obj = new Object3D();
            const previousData = {mass: 5};
            lambda._registerObject(obj, previousData);
            const releaseSpy = vi.spyOn(ComponentDataPool, "release");
            vi.spyOn(lambda, "onObjectAdded").mockImplementation(() => {
                throw new Error("refresh failed");
            });

            expect(() => lambda._registerObject(obj, {mass: 10})).toThrow("refresh failed");

            expect(lambda.entityCount).toBe(1);
            expect(lambda.getComponentData(obj)).toBe(previousData);
            expect(obj.userData._lambdaRegCount).toBe(1);
            expect(obj.matrixAutoUpdate).toBe(false);
            expect(releaseSpy).not.toHaveBeenCalled();

            releaseSpy.mockRestore();
        });

        it("should queue when _isApplying is true", () => {
            const obj = new Object3D();
            lambda["_isApplying"] = true;

            lambda._registerObject(obj, {mass: 5});

            expect(lambda.entityCount).toBe(0);
            expect(lambda["_pendingOps"]).toHaveLength(1);
            expect(lambda["_pendingOps"][0]).toEqual({
                type: "add",
                target: obj,
                data: {mass: 5},
            });
        });

        it("keeps lambda registration counts out of serialized userData", () => {
            const obj = new Object3D();

            lambda._registerObject(obj, {mass: 5});

            expect(obj.userData._lambdaRegCount).toBe(1);
            expect(Object.prototype.propertyIsEnumerable.call(obj.userData, "_lambdaRegCount")).toBe(false);
            expect(JSON.stringify(obj.userData)).not.toContain("_lambdaRegCount");
        });

        it("clears legacy scene-static markers when a lambda claims the object", () => {
            const obj = new Object3D();
            obj.userData._isSceneStatic = true;
            obj.matrixWorldAutoUpdate = false;

            expect(Object.prototype.propertyIsEnumerable.call(obj.userData, "_isSceneStatic")).toBe(true);

            lambda._registerObject(obj, {mass: 5});

            expect(obj.matrixWorldAutoUpdate).toBe(true);
            expect(obj.userData._isSceneStatic).toBeUndefined();
            expect(JSON.stringify(obj.userData)).not.toContain("_isSceneStatic");
        });
    });

    describe("_deregisterObject", () => {
        it("should remove object from registered objects map", () => {
            const obj = new Object3D();
            lambda._registerObject(obj, {mass: 5});
            expect(lambda.entityCount).toBe(1);

            lambda._deregisterObject(obj);
            expect(lambda.entityCount).toBe(0);
        });

        it("should call onObjectRemoved", () => {
            const obj = new Object3D();
            lambda._registerObject(obj, {mass: 5});
            const spy = vi.spyOn(lambda, "onObjectRemoved");

            lambda._deregisterObject(obj);

            expect(spy).toHaveBeenCalledWith(obj);
        });

        it("should no-op for non-registered object", () => {
            const obj = new Object3D();
            const spy = vi.spyOn(lambda, "onObjectRemoved");

            lambda._deregisterObject(obj);

            expect(spy).not.toHaveBeenCalled();
            expect(lambda.entityCount).toBe(0);
        });

        it("should queue when _isApplying is true", () => {
            const obj = new Object3D();
            lambda._registerObject(obj, {mass: 5});
            lambda["_isApplying"] = true;

            lambda._deregisterObject(obj);

            expect(lambda.entityCount).toBe(1); // not removed yet
            expect(lambda["_pendingOps"]).toHaveLength(1);
        });

        it("does not inflate lambda ref counts when refreshing the same object", () => {
            const obj = new Object3D();

            lambda._registerObject(obj, {mass: 5});
            lambda._registerObject(obj, {mass: 10});

            expect(lambda.entityCount).toBe(1);
            expect(lambda.getComponentData(obj)).toEqual(expect.objectContaining({mass: 10}));
            expect(obj.userData._lambdaRegCount).toBe(1);
            expect(obj.matrixAutoUpdate).toBe(false);

            lambda._deregisterObject(obj);

            expect(obj.userData._lambdaRegCount).toBeUndefined();
            expect(obj.matrixAutoUpdate).toBe(true);
        });
    });

    describe("_processPendingOps", () => {
        it("should process queued add operations", () => {
            const obj = new Object3D();
            lambda["_isApplying"] = true;
            lambda._registerObject(obj, {mass: 5});
            lambda["_isApplying"] = false;

            lambda._processPendingOps();

            expect(lambda.entityCount).toBe(1);
            expect(lambda.getComponentData(obj)).toEqual(expect.objectContaining({mass: 5}));
        });

        it("should process queued remove operations", () => {
            const obj = new Object3D();
            lambda._registerObject(obj, {mass: 5});
            lambda["_isApplying"] = true;
            lambda._deregisterObject(obj);
            lambda["_isApplying"] = false;

            lambda._processPendingOps();

            expect(lambda.entityCount).toBe(0);
        });

        it("should clear pending ops after processing", () => {
            lambda["_isApplying"] = true;
            lambda._registerObject(new Object3D(), {});
            lambda["_isApplying"] = false;

            lambda._processPendingOps();

            expect(lambda["_pendingOps"]).toHaveLength(0);
        });
    });

    describe("getComponentData", () => {
        it("should return component data for registered object", () => {
            const obj = new Object3D();
            lambda._registerObject(obj, {mass: 5, drag: 0.1});

            expect(lambda.getComponentData(obj)).toEqual(expect.objectContaining({mass: 5, drag: 0.1}));
        });

        it("should return null for non-registered object", () => {
            const obj = new Object3D();
            expect(lambda.getComponentData(obj)).toBeNull();
        });
    });

    describe("setComponentData", () => {
        it("should update specific key in component data", () => {
            const obj = new Object3D();
            lambda._registerObject(obj, {mass: 5, drag: 0.1});

            lambda.setComponentData(obj, "mass", 10);

            expect(lambda.getComponentData(obj)).toEqual(expect.objectContaining({mass: 10, drag: 0.1}));
        });

        it("should no-op for non-registered object", () => {
            const obj = new Object3D();
            lambda.setComponentData(obj, "mass", 10);
            // Should not throw
            expect(lambda.getComponentData(obj)).toBeNull();
        });
    });

    describe("onSet observer", () => {
        class ObservableLambda extends LambdaBase {
            public events: Array<{key: string; newValue: any; oldValue: any}> = [];
            onSet(_target: Object3D, key: string, newValue: any, oldValue: any): void {
                this.events.push({key, newValue, oldValue});
            }
        }

        it("should fire onSet with old and new values when value changes", () => {
            const observable = new ObservableLambda("observable", {});
            const obj = new Object3D();
            observable._registerObject(obj, {mass: 5});

            observable.setComponentData(obj, "mass", 10);

            expect(observable.events).toEqual([{key: "mass", newValue: 10, oldValue: 5}]);
        });

        it("should not fire onSet when value is unchanged", () => {
            const observable = new ObservableLambda("observable", {});
            const obj = new Object3D();
            observable._registerObject(obj, {mass: 5});

            observable.setComponentData(obj, "mass", 5);

            expect(observable.events).toEqual([]);
        });

        it("should not fire onSet during _registerObject seeding", () => {
            const observable = new ObservableLambda("observable", {});
            const obj = new Object3D();

            observable._registerObject(obj, {mass: 5, drag: 0.1});

            expect(observable.events).toEqual([]);
        });

        it("should not fire onSet for direct data mutation (by design)", () => {
            const observable = new ObservableLambda("observable", {});
            const obj = new Object3D();
            observable._registerObject(obj, {mass: 5});

            const data = observable.getComponentData(obj);
            if (data) data.mass = 42;

            expect(observable.events).toEqual([]);
        });

        it("should not fire onSet for non-registered object", () => {
            const observable = new ObservableLambda("observable", {});
            const obj = new Object3D();

            observable.setComponentData(obj, "mass", 10);

            expect(observable.events).toEqual([]);
        });

        it("should swallow errors thrown from onSet without corrupting the write", () => {
            class ThrowingOnSet extends LambdaBase {
                onSet(): void {
                    throw new Error("oh no");
                }
            }
            const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
            const throwing = new ThrowingOnSet("throwing", {});
            const obj = new Object3D();
            throwing._registerObject(obj, {mass: 5});

            throwing.setComponentData(obj, "mass", 10);

            // Data was still written despite the onSet failure
            expect(throwing.getComponentData(obj)).toEqual(expect.objectContaining({mass: 10}));
            expect(errorSpy).toHaveBeenCalledWith(
                expect.stringContaining("Error in onSet"),
                expect.any(Error),
            );
            errorSpy.mockRestore();
        });
    });

    describe("dispose", () => {
        it("should clear all registered objects", () => {
            lambda._registerObject(new Object3D(), {});
            lambda._registerObject(new Object3D(), {});
            expect(lambda.entityCount).toBe(2);

            lambda.dispose();

            expect(lambda.entityCount).toBe(0);
        });

        it("releases component data and restores matrix state", () => {
            const obj = new Object3D();
            const data = {mass: 5};
            const releaseSpy = vi.spyOn(ComponentDataPool, "release");
            lambda._registerObject(obj, data);
            expect(obj.userData._lambdaRegCount).toBe(1);
            expect(obj.matrixAutoUpdate).toBe(false);

            lambda.dispose();

            expect(releaseSpy).toHaveBeenCalledWith("test-lambda", data);
            expect(obj.userData._lambdaRegCount).toBeUndefined();
            expect(obj.matrixAutoUpdate).toBe(true);
            expect(lambda.entityCount).toBe(0);

            releaseSpy.mockRestore();
        });

        it("keeps shared object matrix ownership until the last lambda disposes", () => {
            const obj = new Object3D();
            const other = new TestLambda("other-lambda", {});
            lambda._registerObject(obj, {mass: 5});
            other._registerObject(obj, {mass: 10});
            expect(obj.userData._lambdaRegCount).toBe(2);

            lambda.dispose();

            expect(obj.userData._lambdaRegCount).toBe(1);
            expect(obj.matrixAutoUpdate).toBe(false);
            expect(other.entityCount).toBe(1);

            other.dispose();

            expect(obj.userData._lambdaRegCount).toBeUndefined();
            expect(obj.matrixAutoUpdate).toBe(true);
        });

        it("should clear pending ops", () => {
            lambda["_isApplying"] = true;
            lambda._registerObject(new Object3D(), {});
            lambda["_isApplying"] = false;

            lambda.dispose();

            expect(lambda["_pendingOps"]).toHaveLength(0);
        });
    });

    describe("entityCount", () => {
        it("should return 0 when empty", () => {
            expect(lambda.entityCount).toBe(0);
        });

        it("should return correct count", () => {
            lambda._registerObject(new Object3D(), {});
            lambda._registerObject(new Object3D(), {});
            lambda._registerObject(new Object3D(), {});
            expect(lambda.entityCount).toBe(3);
        });
    });

    describe("apply with command queue", () => {
        it("should process objects registered during apply after apply completes", () => {
            const obj1 = new Object3D();
            const obj2 = new Object3D();

            // Create a lambda that registers another object during update
            class RegisterDuringUpdateLambda extends LambdaBase {
                update(): void {
                    for (const [obj] of this._registeredObjects) {
                        // Register obj2 during iteration
                        if (obj === obj1) {
                            this._registerObject(obj2, {mass: 2});
                        }
                    }
                }
            }

            const regLambda = new RegisterDuringUpdateLambda("test", {});
            regLambda._registerObject(obj1, {mass: 1});
            expect(regLambda.entityCount).toBe(1);

            regLambda.apply();

            // obj2 should now be registered after apply completed
            expect(regLambda.entityCount).toBe(2);
            expect(regLambda.getComponentData(obj2)).toEqual(expect.objectContaining({mass: 2}));
        });

        it("should automatically set _isApplying during apply and call _processPendingOps", () => {
            let wasApplyingDuringUpdate = false;

            class CheckApplyingLambda extends LambdaBase {
                update(): void {
                    wasApplyingDuringUpdate = this._isApplying;
                }
            }

            const checkLambda = new CheckApplyingLambda("test", {});
            checkLambda.apply();

            expect(wasApplyingDuringUpdate).toBe(true);
            expect(checkLambda["_isApplying"]).toBe(false);
        });

        it("should reset _isApplying even if update throws", () => {
            class ThrowingLambda extends LambdaBase {
                update(): void {
                    throw new Error("test error");
                }
            }

            const throwLambda = new ThrowingLambda("test", {});

            expect(() => throwLambda.apply()).toThrow("test error");
            expect(throwLambda["_isApplying"]).toBe(false);
        });
    });

    describe("fixedApply", () => {
        it("should call fixedUpdate without generator overhead", () => {
            class FixedLambda extends LambdaBase {
                public fixedCalls = 0;
                fixedUpdate(): void {
                    this.fixedCalls++;
                }
            }

            const fixedLambda = new FixedLambda("fixed-apply-lambda", {});
            fixedLambda.fixedApply(0.016);

            expect(fixedLambda.fixedCalls).toBe(1);
            expect(fixedLambda["_isApplying"]).toBe(false);
        });

        it("should warn and skip update when fixedUpdate is not implemented", () => {
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

            class NoFixedLambda extends LambdaBase {
                public updateCalls = 0;
                update(): void {
                    this.updateCalls++;
                }
            }

            const noFixed = new NoFixedLambda("no-fixed-apply-lambda", {});
            noFixed.fixedApply(0.016);

            expect(noFixed.updateCalls).toBe(0);
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining("does not implement fixedUpdate()"),
            );
            warnSpy.mockRestore();
        });
    });

    describe("processObjects deadline handling", () => {
        it("should process scheduled objects without per-object map lookup", () => {
            class CountingMap<K, V> extends Map<K, V> {
                public getCalls = 0;

                get(key: K): V | undefined {
                    this.getCalls++;
                    return super.get(key);
                }
            }

            class EntryIterationLambda extends LambdaBase {
                public processed = 0;
                public processedData: Array<Record<string, any>> = [];

                update(deltaTime: number = 0.016): void {
                    this.processObjects(deltaTime, (_object, data) => {
                        this.processed++;
                        this.processedData.push(data);
                    });
                }
            }

            const entryIteration = new EntryIterationLambda("entry-iteration", {});
            const object = new Object3D();
            const data = {mass: 5};
            const camera = new PerspectiveCamera();
            const scheduler = {
                frameDeadline: Infinity,
                shouldProcess: vi.fn(() => 1),
            };
            const registeredObjects = new CountingMap<Object3D, Record<string, any>>([[object, data]]);

            entryIteration.init({
                camera,
                lambdaManager: {
                    scheduler,
                },
            } as unknown as GameManager);
            (entryIteration as unknown as {
                _registeredObjects: Map<Object3D, Record<string, any>>;
            })._registeredObjects = registeredObjects;

            entryIteration.apply(0.016);

            expect(entryIteration.processed).toBe(1);
            expect(entryIteration.processedData).toEqual([data]);
            expect(registeredObjects.getCalls).toBe(0);
            expect(scheduler.shouldProcess).toHaveBeenCalledWith(object, camera, 0, false);
        });

        it("should stop processing once the shared frame deadline is exceeded", () => {
            class DeadlineAwareLambda extends LambdaBase {
                public processed = 0;
                public processedLabels: number[] = [];

                update(deltaTime: number = 0.016): void {
                    this.processObjects(deltaTime, (_object, data) => {
                        this.processed++;
                        this.processedLabels.push(data.label as number);
                    });
                }
            }

            const deadlineAware = new DeadlineAwareLambda("deadline-aware", {});
            const camera = new PerspectiveCamera();
            const scheduler = {
                frameDeadline: 5,
                shouldProcess: vi.fn(() => 1),
            };

            deadlineAware.init({
                camera,
                lambdaManager: {
                    scheduler,
                },
            } as unknown as GameManager);

            for (let i = 0; i < 65; i++) {
                deadlineAware._registerObject(new Object3D(), {label: i});
            }

            const nowSpy = vi.spyOn(performance, "now").mockReturnValue(10);

            deadlineAware.apply(0.016);

            expect(deadlineAware.processed).toBe(64);
            expect(deadlineAware.processedLabels).toEqual(Array.from({length: 64}, (_value, index) => index));

            deadlineAware.processed = 0;
            deadlineAware.processedLabels = [];
            deadlineAware.apply(0.016);

            expect(deadlineAware.processed).toBe(64);
            expect(deadlineAware.processedLabels[0]).toBe(64);
            expect(deadlineAware.processedLabels.slice(1)).toEqual(Array.from({length: 63}, (_value, index) => index));
            nowSpy.mockRestore();
        });

        it("should resume budgeted processing without rescanning earlier map entries", () => {
            class CountingEntriesMap<K, V> extends Map<K, V> {
                public entriesCalls = 0;

                entries(): MapIterator<[K, V]> {
                    this.entriesCalls++;
                    return super.entries();
                }
            }

            class ResumableLambda extends LambdaBase {
                public processedLabels: number[] = [];

                update(deltaTime: number = 0.016): void {
                    this.processObjects(deltaTime, (_object, data) => {
                        this.processedLabels.push(data.label as number);
                    });
                }
            }

            const resumable = new ResumableLambda("resumable", {});
            const camera = new PerspectiveCamera();
            const scheduler = {
                frameDeadline: 5,
                shouldProcess: vi.fn(() => 1),
            };
            const registeredObjects = new CountingEntriesMap<Object3D, Record<string, any>>();
            for (let i = 0; i < 129; i++) {
                registeredObjects.set(new Object3D(), {label: i});
            }

            resumable.init({camera, lambdaManager: {scheduler}} as unknown as GameManager);
            (resumable as unknown as {
                _registeredObjects: Map<Object3D, Record<string, any>>;
            })._registeredObjects = registeredObjects;
            const nowSpy = vi.spyOn(performance, "now").mockReturnValue(10);

            resumable.apply(0.016);
            resumable.apply(0.016);

            expect(resumable.processedLabels).toEqual(Array.from({length: 128}, (_value, index) => index));
            expect(registeredObjects.entriesCalls).toBe(1);
            nowSpy.mockRestore();
        });
    });
});
