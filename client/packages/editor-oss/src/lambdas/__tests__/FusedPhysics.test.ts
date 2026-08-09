import { Object3D } from "three";
import { describe, it, expect, beforeEach } from "vitest";

import type GameManager from "@stem/editor-oss/behaviors/game/GameManager";
import type { LambdaConfig } from "../Lambda";
import { LambdaBase } from "../LambdaBase";
import { LambdaManager } from "../LambdaManager";
import FusedPhysicsLambda from "../packs/fusedPhysics/FusedPhysicsLambda";
import { runPhysicsKernel } from "../packs/fusedPhysics/FusedPhysicsKernel";

// --- Standalone FusedPhysicsLambda tests ---

describe("FusedPhysicsLambda", () => {
    let lambda: FusedPhysicsLambda;

    beforeEach(() => {
        lambda = new FusedPhysicsLambda("fused-physics", {
            attributes: { gravity: 9.81 },
        });
    });

    it("should integrate velocity into position", () => {
        const obj = new Object3D();
        lambda._registerObject(obj, { vx: 10, vy: 0, vz: 0 });

        lambda.apply(1 / 60);

        expect(obj.position.x).toBeGreaterThan(0);
    });

    it("should apply gravity to vy", () => {
        const obj = new Object3D();
        lambda._registerObject(obj, { useGravity: 1, gravityScale: 1 });

        lambda.apply(1 / 60);

        const data = lambda.getComponentData(obj);
        expect(data!.vy).toBeLessThan(0);
    });

    it("should apply linear drag", () => {
        const obj = new Object3D();
        lambda._registerObject(obj, {
            vx: 10, vy: 0, vz: 0,
            drag: 0.1, useGravity: 0,
        });

        lambda.apply(1 / 60);

        const data = lambda.getComponentData(obj);
        expect(data!.vx).toBeLessThan(10);
        expect(data!.vx).toBeGreaterThan(0);
    });

    it("should clamp speed to maxSpeed", () => {
        const obj = new Object3D();
        lambda._registerObject(obj, {
            vx: 100, vy: 100, vz: 100,
            maxSpeed: 5, useGravity: 0,
        });

        lambda.apply(1 / 60);

        const data = lambda.getComponentData(obj);
        const speed = Math.sqrt(data!.vx ** 2 + data!.vy ** 2 + data!.vz ** 2);
        expect(speed).toBeCloseTo(5, 0);
    });

    it("should skip kinematic objects", () => {
        const obj = new Object3D();
        lambda._registerObject(obj, {
            vx: 10, vy: 0, vz: 0,
            isKinematic: 1, useGravity: 1,
        });

        lambda.apply(1 / 60);

        expect(obj.position.x).toBe(0);
    });

    it("should respect freeze constraints", () => {
        const obj = new Object3D();
        lambda._registerObject(obj, {
            vx: 10, vy: 10, vz: 10,
            freezePositionX: 1, freezePositionZ: 1,
            useGravity: 0,
        });

        lambda.apply(1 / 60);

        expect(obj.position.x).toBe(0);
        expect(obj.position.y).toBeGreaterThan(0);
        expect(obj.position.z).toBe(0);
    });

    it("should apply angular velocity and angular drag", () => {
        const obj = new Object3D();
        lambda._registerObject(obj, {
            avx: 1, avy: 0, avz: 0,
            angularDrag: 0.05,
            useGravity: 0,
        });

        lambda.apply(1 / 60);

        expect(obj.rotation.x).toBeGreaterThan(0);
    });

    it("should handle multiple objects", () => {
        const obj1 = new Object3D();
        const obj2 = new Object3D();
        lambda._registerObject(obj1, { vx: 5, useGravity: 0 });
        lambda._registerObject(obj2, { vx: -5, useGravity: 0 });

        lambda.apply(1 / 60);

        expect(obj1.position.x).toBeGreaterThan(0);
        expect(obj2.position.x).toBeLessThan(0);
    });

    it("reuses and clears kernel delta buffers", () => {
        const dpx = new Float32Array([99, 99]);
        const dpy = new Float32Array([99, 99]);
        const dpz = new Float32Array([99, 99]);
        const drx = new Float32Array([99, 99]);
        const dry = new Float32Array([99, 99]);
        const drz = new Float32Array([99, 99]);

        const result = runPhysicsKernel({
            count: 2,
            deltaTime: 1,
            gravity: 0,
            vx: new Float32Array([2, 3]),
            vy: new Float32Array(2),
            vz: new Float32Array(2),
            avx: new Float32Array(2),
            avy: new Float32Array(2),
            avz: new Float32Array(2),
            drag: new Float32Array(2),
            angularDrag: new Float32Array(2),
            gravityScale: new Float32Array(2),
            damping: new Float32Array(2),
            maxSpeed: new Float32Array([100, 100]),
            useGravity: new Uint8Array(2),
            isKinematic: new Uint8Array([0, 1]),
            freezePositionX: new Uint8Array(2),
            freezePositionY: new Uint8Array(2),
            freezePositionZ: new Uint8Array(2),
            freezeRotationX: new Uint8Array(2),
            freezeRotationY: new Uint8Array(2),
            freezeRotationZ: new Uint8Array(2),
            visibilityMask: null,
            dpx,
            dpy,
            dpz,
            drx,
            dry,
            drz,
        });

        expect(result.dpx).toBe(dpx);
        expect(Array.from(result.dpx)).toEqual([2, 0]);
        expect(Array.from(result.dpy)).toEqual([0, 0]);
        expect(Array.from(result.drz)).toEqual([0, 0]);
    });

    it("uses a byte-sized visibility mask in the shared physics kernel", () => {
        const result = runPhysicsKernel({
            count: 2,
            deltaTime: 1,
            gravity: 0,
            vx: new Float32Array([2, 2]),
            vy: new Float32Array(2),
            vz: new Float32Array(2),
            avx: new Float32Array(2),
            avy: new Float32Array(2),
            avz: new Float32Array(2),
            drag: new Float32Array(2),
            angularDrag: new Float32Array(2),
            gravityScale: new Float32Array(2),
            damping: new Float32Array(2),
            maxSpeed: new Float32Array([100, 100]),
            useGravity: new Uint8Array(2),
            isKinematic: new Uint8Array(2),
            freezePositionX: new Uint8Array(2),
            freezePositionY: new Uint8Array(2),
            freezePositionZ: new Uint8Array(2),
            freezeRotationX: new Uint8Array(2),
            freezeRotationY: new Uint8Array(2),
            freezeRotationZ: new Uint8Array(2),
            visibilityMask: new Uint8Array([0, 2]),
        });

        expect(Array.from(result.dpx)).toEqual([0, 4]);
    });
});

// --- Auto-fusion tests in LambdaManager ---

const velocityConfig: LambdaConfig = {
    id: "velocity",
    name: "Velocity",
    version: "1.0.0",
    main: "VelocityLambda.ts",
    attributes: {},
    componentSchema: {
        vx: { name: "VX", type: "number", default: 0 },
        vy: { name: "VY", type: "number", default: 0 },
        vz: { name: "VZ", type: "number", default: 0 },
        damping: { name: "Damping", type: "number", default: 0 },
        maxSpeed: { name: "Max Speed", type: "number", default: 100 },
    },
};

const rigidbodyConfig: LambdaConfig = {
    id: "rigidbody",
    name: "RigidBody",
    version: "1.0.0",
    main: "RigidBodyLambda.ts",
    attributes: { gravity: { name: "Gravity", type: "number", default: 9.81 } },
    componentSchema: {
        mass: { name: "Mass", type: "number", default: 1 },
        drag: { name: "Drag", type: "number", default: 0.05 },
        useGravity: { name: "Use Gravity", type: "boolean", default: true },
        vx: { name: "VX", type: "number", default: 0 },
        vy: { name: "VY", type: "number", default: 0 },
        vz: { name: "VZ", type: "number", default: 0 },
    },
};

class StubVelocityLambda extends LambdaBase {}
class StubRigidBodyLambda extends LambdaBase {}

const createMockGameManager = (): GameManager => ({} as GameManager);

describe("LambdaManager auto-fusion", () => {
    let manager: LambdaManager;
    let game: GameManager;

    beforeEach(() => {
        game = createMockGameManager();
        manager = new LambdaManager(game);
    });

    it("should not fuse when object has only one physics lambda", async () => {
        manager.registerLambdaClass("velocity", velocityConfig, StubVelocityLambda);
        const inst = await manager.createInstance("velocity");
        const obj = new Object3D();

        manager.registerObject(inst!.uuid, obj, { vx: 5 });

        const lambdas = manager.getObjectLambdas(obj);
        expect(lambdas).toHaveLength(1);
        expect(lambdas[0]!.id).toBe("velocity");
    });

    it("should fuse when object is registered with velocity + rigidbody", async () => {
        manager.registerLambdaClass("velocity", velocityConfig, StubVelocityLambda);
        manager.registerLambdaClass("rigidbody", rigidbodyConfig, StubRigidBodyLambda);

        const velInst = await manager.createInstance("velocity");
        const rbInst = await manager.createInstance("rigidbody");
        const obj = new Object3D();

        manager.registerObject(velInst!.uuid, obj, { vx: 5, damping: 0.1 });
        manager.registerObject(rbInst!.uuid, obj, { mass: 2, drag: 0.05 });

        const lambdas = manager.getObjectLambdas(obj);
        // Should have fused instance (individual physics lambdas removed)
        const fusedLambdas = lambdas.filter(l => l.id === "fused-physics");
        expect(fusedLambdas).toHaveLength(1);

        // Object should no longer be in the individual instances
        expect(velInst!.entityCount).toBe(0);
        expect(rbInst!.entityCount).toBe(0);
    });

    it("should merge component data from both lambdas into fused instance", async () => {
        manager.registerLambdaClass("velocity", velocityConfig, StubVelocityLambda);
        manager.registerLambdaClass("rigidbody", rigidbodyConfig, StubRigidBodyLambda);

        const velInst = await manager.createInstance("velocity");
        const rbInst = await manager.createInstance("rigidbody");
        const obj = new Object3D();

        manager.registerObject(velInst!.uuid, obj, { vx: 5, damping: 0.1, maxSpeed: 50 });
        manager.registerObject(rbInst!.uuid, obj, { mass: 2, drag: 0.05, useGravity: true });

        const lambdas = manager.getObjectLambdas(obj);
        const fused = lambdas.find(l => l.id === "fused-physics")!;
        const data = fused.getComponentData(obj)!;

        expect(data).toEqual(expect.objectContaining({ vx: 5, damping: 0.1, mass: 2 }));
    });

    it("should clean up fused instance on dispose", async () => {
        manager.registerLambdaClass("velocity", velocityConfig, StubVelocityLambda);
        manager.registerLambdaClass("rigidbody", rigidbodyConfig, StubRigidBodyLambda);

        const velInst = await manager.createInstance("velocity");
        const rbInst = await manager.createInstance("rigidbody");
        const obj = new Object3D();

        manager.registerObject(velInst!.uuid, obj, { vx: 5 });
        manager.registerObject(rbInst!.uuid, obj, { mass: 2 });

        manager.dispose();

        // After dispose, object should have no lambdas
        expect(manager.getObjectLambdas(obj)).toHaveLength(0);
    });
});
