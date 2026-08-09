import path from "path";
import { fileURLToPath } from "url";

import { makeJointTests } from '../PhysicsEngineJointTests';
import { makeLegacyPhysicsAdapterTests } from '../LegacyPhysicsAdapterTests';
import { makeCharacterControllerTests } from '../PhysicsEngineCharacterControllerTests';
import { makePhysicsTests } from '../PhysicsEngineTests';
import { makeVehicleTests } from '../PhysicsEngineVehicleTests';
import { AmmoPhysicsEngine } from './AmmoPhysicsEngine';
import { initAmmo } from './ammo';
import {BodyShapeType} from '../common/types';
import {RigidBodyType} from '../PhysicsEngine';

const __ammoDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../../assets/js/ammo",
);

describe("AmmoPhysicsEngine contact pair reuse", () => {
    it("reuses swapped contact-pair maps while dispatching started and stopped collisions", () => {
        const engine = Object.create(AmmoPhysicsEngine.prototype) as any;
        const activePairs = new Map<string, any>([
            ["body-a-body-b", {uuid1: "body-a", uuid2: "body-b"}],
        ]);
        const scratchPairs = new Map<string, any>([
            ["stale", {uuid1: "stale-a", uuid2: "stale-b"}],
        ]);
        const onCollision = vi.fn();

        engine.contactPairs = activePairs;
        engine.nextContactPairs = scratchPairs;
        engine.getRigidBodyContactPairs = vi.fn((pairs: Map<string, any>) => {
            pairs.set("body-b-body-c", {uuid1: "body-b", uuid2: "body-c"});
        });
        engine.getCharacterControllerContactPairs = vi.fn();
        engine.dispatchCollisionEvent = vi.fn();

        engine.dispatchCollisionEvents(onCollision);

        expect(engine.getRigidBodyContactPairs).toHaveBeenCalledWith(scratchPairs);
        expect(scratchPairs.has("stale")).toBe(false);
        expect(engine.contactPairs).toBe(scratchPairs);
        expect(engine.nextContactPairs).toBe(activePairs);
        expect(engine.dispatchCollisionEvent).toHaveBeenCalledWith("body-a", "body-b", false, onCollision);
        expect(engine.dispatchCollisionEvent).toHaveBeenCalledWith(
            "body-b",
            "body-c",
            true,
            onCollision,
            undefined,
            undefined,
        );

        engine.dispatchCollisionEvent.mockClear();
        engine.getRigidBodyContactPairs = vi.fn((pairs: Map<string, any>) => {
            pairs.set("body-b-body-c", {uuid1: "body-b", uuid2: "body-c"});
        });

        engine.dispatchCollisionEvents(onCollision);

        expect(engine.getRigidBodyContactPairs).toHaveBeenCalledWith(activePairs);
        expect(engine.contactPairs).toBe(activePairs);
        expect(engine.nextContactPairs).toBe(scratchPairs);
        expect(engine.dispatchCollisionEvent).not.toHaveBeenCalled();
    });
});

describe("AmmoPhysics", () => {
    const makePhysicsEngine = async (gravity: number) => {
        const ammo = await initAmmo({
            locateFile: (file: string) => path.join(__ammoDir, file),
        });
        return new AmmoPhysicsEngine(ammo, gravity);
    };

    it('sleeps idle dynamic bodies by default and honors the awake opt-out', async () => {
        const physics = await makePhysicsEngine(-9.81);
        const internals = physics as unknown as {
            rigidBodies: Map<string, {isActive: () => boolean}>;
        };
        physics.addShape('sleep-floor-shape', {type: BodyShapeType.BOX, width: 10, height: 1, length: 10});
        physics.addRigidBody('sleep-floor', 'sleep-floor-shape', RigidBodyType.Static);
        physics.addShape('sleep-probe-shape', {type: BodyShapeType.SPHERE, radius: 0.25});
        physics.addRigidBody('sleep-probe', 'sleep-probe-shape', RigidBodyType.Dynamic, {mass: 1, restitution: 0, linearDamping: 1, angularDamping: 1});
        physics.setRigidBodyPosition('sleep-probe', {x: 0, y: 4, z: 0});
        physics.addRigidBody('awake-probe', 'sleep-probe-shape', RigidBodyType.Dynamic, {mass: 1, restitution: 0, linearDamping: 1, angularDamping: 1, allowSleep: false});
        physics.setRigidBodyPosition('awake-probe', {x: 2, y: 4, z: 0});

        physics.stepDuration = 1 / 60;
        for (let i = 0; i < 600; i++) physics.simulate();

        expect(internals.rigidBodies.get('sleep-probe')?.isActive()).toBe(false);
        expect(internals.rigidBodies.get('awake-probe')?.isActive()).toBe(true);
        physics.dispose();
    });

    it('applies the configured solver iteration quality to Bullet', async () => {
        const ammo = await initAmmo({
            locateFile: (file: string) => path.join(__ammoDir, file),
        });
        const physics = new AmmoPhysicsEngine(ammo, -9.81, 7);
        const internals = physics as unknown as {
            world: {getSolverInfo: () => {get_m_numIterations: () => number}};
        };

        expect(internals.world.getSolverInfo().get_m_numIterations()).toBe(7);
        physics.setSolverIterations(3);
        expect(internals.world.getSolverInfo().get_m_numIterations()).toBe(3);
        physics.dispose();
    });

    it('clamps invalid or excessive solver iteration options', async () => {
        const ammo = await initAmmo({
            locateFile: (file: string) => path.join(__ammoDir, file),
        });
        const excessive = new AmmoPhysicsEngine(ammo, -9.81, 99) as unknown as {
            solverIterations: number;
            dispose: () => void;
        };
        expect(excessive.solverIterations).toBe(8);
        excessive.dispose();

        const invalid = new AmmoPhysicsEngine(ammo, -9.81, Number.NaN) as unknown as {
            solverIterations: number;
            dispose: () => void;
        };
        expect(invalid.solverIterations).toBe(4);
        invalid.dispose();
    });

    it('normalizes authored mass to zero for static and kinematic bodies', async () => {
        const physics = await makePhysicsEngine(-9.81);
        const internals = physics as unknown as {
            rigidBodies: Map<string, {getInvMass: () => number}>;
        };
        physics.addShape('mass-shape', {type: BodyShapeType.BOX, width: 1, height: 1, length: 1});
        physics.addRigidBody('static-mass', 'mass-shape', RigidBodyType.Static, {mass: 250});
        physics.addRigidBody('kinematic-mass', 'mass-shape', RigidBodyType.Kinematic, {mass: 250});

        expect(internals.rigidBodies.get('static-mass')?.getInvMass()).toBe(0);
        expect(internals.rigidBodies.get('kinematic-mass')?.getInvMass()).toBe(0);
        physics.dispose();
    });

    it('owns one joint per body pair and removes joints before body teardown', async () => {
        const physics = await makePhysicsEngine(-9.81);
        const internals = physics as unknown as {
            jointMap: Map<string, unknown>;
            constraints: Set<unknown>;
        };

        physics.addShape('joint-shape', {type: BodyShapeType.BOX, width: 1, height: 1, length: 1});
        physics.addRigidBody('joint-a', 'joint-shape', RigidBodyType.Static);
        physics.addRigidBody('joint-b', 'joint-shape', RigidBodyType.Dynamic, {position: {x: 2, y: 0, z: 0}});

        physics.addFixedJoint({
            collisionEnabled: false,
            uuidA: 'joint-a', uuidB: 'joint-b',
            pivotB: {x: 2, y: 0, z: 0},
            rotationB: {x: 0, y: 0, z: 0, w: 1},
        });
        expect(internals.jointMap.size).toBe(1);
        expect(internals.constraints.size).toBe(1);

        physics.addPointToPointJoint({
            collisionEnabled: false,
            uuidA: 'joint-a', pivotA: {x: 0, y: 0, z: 0},
            uuidB: 'joint-b', pivotB: {x: 2, y: 0, z: 0},
        });
        expect(internals.jointMap.size).toBe(1);
        expect(internals.constraints.size).toBe(1);

        physics.removeRigidBody('joint-a');
        expect(internals.jointMap.size).toBe(0);
        expect(internals.constraints.size).toBe(0);
        expect(() => physics.dispose()).not.toThrow();
    });

    makePhysicsTests(makePhysicsEngine);
    makeCharacterControllerTests(makePhysicsEngine);
    makeVehicleTests(makePhysicsEngine);
    makeJointTests(makePhysicsEngine);
    makeLegacyPhysicsAdapterTests(makePhysicsEngine);
});
