import {Object3D} from "three";
import {describe, expect, it, vi} from "vitest";

import type GameManager from "@stem/editor-oss/behaviors/game/GameManager";
import ColliderLambda from "../packs/collider/ColliderLambda";

describe("ColliderLambda", () => {
    it("rebuilds collider caches without per-object map lookup", () => {
        class CountingMap<K, V> extends Map<K, V> {
            public getCalls = 0;

            get(key: K): V | undefined {
                this.getCalls++;
                return super.get(key);
            }
        }

        const engineCall = vi.fn();
        const lambda = new ColliderLambda("collider", {});
        const objectA = new Object3D();
        const objectB = new Object3D();
        const registeredObjects = new CountingMap<Object3D, Record<string, any>>([
            [objectA, {shape: "sphere", sizeX: 1, sizeY: 1, sizeZ: 1}],
            [objectB, {shape: "sphere", sizeX: 1, sizeY: 1, sizeZ: 1}],
        ]);

        objectA.position.set(0, 0, 0);
        objectB.position.set(1.5, 0, 0);
        lambda.init({
            engine: {
                call: engineCall,
            },
        } as unknown as GameManager);
        (lambda as unknown as {
            _registeredObjects: Map<Object3D, Record<string, any>>;
        })._registeredObjects = registeredObjects;

        lambda.apply(1 / 60);

        expect(registeredObjects.getCalls).toBe(0);
        expect(engineCall).toHaveBeenCalledWith("lambdaEvent", null, expect.objectContaining({
            event: "collisionEnter",
            lambdaId: "collider",
            objectA: objectA.uuid,
            objectB: objectB.uuid,
        }));
    });

    it("uses spatial broadphase for larger collider sets without missing enter or exit events", () => {
        const engineCall = vi.fn();
        const lambda = new ColliderLambda("collider", {});
        const objects: Object3D[] = [];

        lambda.init({
            engine: {
                call: engineCall,
            },
        } as unknown as GameManager);

        for (let i = 0; i < 40; i++) {
            const object = new Object3D();
            object.position.set(i === 0 ? 0 : i === 1 ? 1.5 : 1000 + i * 100, 0, 0);
            objects.push(object);
            lambda._registerObject(object, {
                shape: "sphere",
                sizeX: 1,
                sizeY: 1,
                sizeZ: 1,
            });
        }

        const intersectsSpy = vi.spyOn(
            lambda as unknown as Record<string, (...args: unknown[]) => boolean>,
            "_intersects",
        );

        lambda.apply(1 / 60);

        const enterCalls = engineCall.mock.calls.filter(
            ([eventName, _target, payload]) =>
                eventName === "lambdaEvent" &&
                payload?.event === "collisionEnter",
        );
        expect(enterCalls).toHaveLength(1);
        expect(enterCalls[0]![2]).toMatchObject({
            lambdaId: "collider",
            objectA: objects[0]!.uuid,
            objectB: objects[1]!.uuid,
        });
        expect(intersectsSpy.mock.calls.length).toBeLessThan(40);

        engineCall.mockClear();
        objects[1]!.position.set(50000, 0, 0);

        lambda.apply(1 / 60);

        expect(engineCall).toHaveBeenCalledWith("lambdaEvent", null, {
            event: "collisionExit",
            lambdaId: "collider",
            pairKey: expect.any(String),
        });
        expect(intersectsSpy.mock.calls.length).toBeLessThan(80);

        intersectsSpy.mockRestore();
    });
});
