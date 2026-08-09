import {Object3D} from "three";
import {describe, expect, it} from "vitest";

import RigidBodyLambda from "../packs/rigidbody/RigidBodyLambda";
import VelocityLambda from "../packs/velocity/VelocityLambda";

describe("physics SoA lambdas", () => {
    it("updates velocity objects and syncs changed fields back to component data", () => {
        const lambda = new VelocityLambda("velocity", {});
        const object = new Object3D();

        lambda._registerObject(object, {
            vx: 10,
            vy: 0,
            vz: 0,
            damping: 0.5,
            maxSpeed: 100,
        });

        lambda.apply(1);

        expect(object.position.x).toBe(10);
        expect(lambda.getComponentData(object)).toEqual(expect.objectContaining({
            vx: 5,
            vy: 0,
            vz: 0,
        }));
    });

    it("refreshes SoA field values and data refs when an object is registered again", () => {
        const lambda = new VelocityLambda("velocity", {});
        const object = new Object3D();
        const firstData = {vx: 1, vy: 0, vz: 0, damping: 0, maxSpeed: 100};
        const secondData = {vx: 4, vy: 0, vz: 0, damping: 0, maxSpeed: 100};

        lambda._registerObject(object, firstData);
        lambda._registerObject(object, secondData);
        lambda.apply(1);

        expect(object.position.x).toBe(4);
        expect(lambda.getComponentData(object)).toBe(secondData);
        expect(secondData.vx).toBe(4);
    });

    it("updates rigidbody objects and syncs linear and angular velocity fields", () => {
        const lambda = new RigidBodyLambda("rigidbody", {
            attributes: {gravity: 0},
        });
        const object = new Object3D();

        lambda._registerObject(object, {
            vx: 10,
            vy: 0,
            vz: 0,
            avx: 2,
            avy: 0,
            avz: 0,
            drag: 0.5,
            angularDrag: 0.5,
            useGravity: 0,
        });

        lambda.apply(1);

        expect(object.position.x).toBe(5);
        expect(object.rotation.x).toBe(1);
        expect(lambda.getComponentData(object)).toEqual(expect.objectContaining({
            vx: 5,
            vy: 0,
            vz: 0,
            avx: 1,
            avy: 0,
            avz: 0,
        }));
    });
});
