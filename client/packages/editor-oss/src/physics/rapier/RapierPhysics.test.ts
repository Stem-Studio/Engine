import { makeJointTests } from '../PhysicsEngineJointTests';
import { makeLegacyPhysicsAdapterTests } from '../LegacyPhysicsAdapterTests';
import { makeCharacterControllerTests } from '../PhysicsEngineCharacterControllerTests';
import { makePhysicsTests } from '../PhysicsEngineTests';
import { makeVehicleTests } from '../PhysicsEngineVehicleTests';
import { initRapier } from './rapier';
import { RapierPhysicsEngine } from './RapierPhysicsEngine';
import {
    createRapierHeightfieldShape,
    getRapierHeightfieldDiagnostics,
    getRapierHeightfieldGridDimensions,
    getRapierHeightfieldMode,
    resetRapierHeightfieldModeForTests,
} from './rapierHeightfield';
import {BodyShapeType} from '../common/types';
import {normalizeHeightfieldShape} from '../common/heightfield';
import {RigidBodyType} from '../PhysicsEngine';
import Rapier from '@dimforge/rapier3d-compat';

describe('RapierPhysics', () => {
    const makePhysicsEngine = async (gravity: number) => {
        await initRapier();
        return new RapierPhysicsEngine(gravity);
    };

    it('uses bounded multi-iteration solving for normal fixed steps', async () => {
        const physics = await makePhysicsEngine(-9.81);
        const internals = physics as unknown as {
            solverIterations: number;
            world: { integrationParameters: { numSolverIterations: number } };
        };

        expect(internals.solverIterations).toBe(4);

        physics.stepDuration = 1 / 60;
        physics.simulate();
        expect(internals.world.integrationParameters.numSolverIterations).toBe(4);

        // Preserve the historical single-step behavior for unusually large
        // caller-selected timesteps rather than over-solving a huge interval.
        physics.stepDuration = 1;
        physics.simulate();
        expect(internals.world.integrationParameters.numSolverIterations).toBe(1);

        physics.setSolverIterations(6);
        expect(internals.solverIterations).toBe(6);
        expect(internals.world.integrationParameters.numSolverIterations).toBe(6);

        physics.dispose();
    });

    it('clamps invalid or excessive solver iteration options', async () => {
        const excessive = new RapierPhysicsEngine(-9.81, 99) as unknown as {
            solverIterations: number;
            dispose: () => void;
        };
        expect(excessive.solverIterations).toBe(8);
        excessive.dispose();

        const invalid = new RapierPhysicsEngine(-9.81, Number.NaN) as unknown as {
            solverIterations: number;
            dispose: () => void;
        };
        expect(invalid.solverIterations).toBe(4);
        invalid.dispose();
    });

    it('sleeps idle dynamic bodies by default and honors the awake opt-out', async () => {
        const physics = await makePhysicsEngine(-9.81);
        const internals = physics as unknown as {
            rigidBodies: Map<string, {isSleeping: () => boolean}>;
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

        expect(internals.rigidBodies.get('sleep-probe')?.isSleeping()).toBe(true);
        expect(internals.rigidBodies.get('awake-probe')?.isSleeping()).toBe(false);
        physics.dispose();
    });

    it('normalizes authored mass to zero for static and kinematic bodies', async () => {
        const physics = await makePhysicsEngine(-9.81);
        const internals = physics as unknown as {
            rigidBodies: Map<string, {mass: () => number}>;
        };
        physics.addShape('mass-shape', {type: BodyShapeType.BOX, width: 1, height: 1, length: 1});
        physics.addRigidBody('static-mass', 'mass-shape', RigidBodyType.Static, {mass: 250});
        physics.addRigidBody('kinematic-mass', 'mass-shape', RigidBodyType.Kinematic, {mass: 250});

        expect(internals.rigidBodies.get('static-mass')?.mass()).toBe(0);
        expect(internals.rigidBodies.get('kinematic-mass')?.mass()).toBe(0);
        physics.dispose();
    });

    it('maps CCD tuning to Rapier hard and soft CCD', async () => {
        const physics = await makePhysicsEngine(0);
        const internals = physics as unknown as {
            rigidBodies: Map<string, {isCcdEnabled: () => boolean; softCcdPrediction: () => number}>;
        };
        physics.addShape('ccd-probe-shape', {type: BodyShapeType.SPHERE, radius: 0.1});
        physics.addRigidBody('ccd-probe', 'ccd-probe-shape', RigidBodyType.Dynamic, {
            mass: 1,
            ccd: true,
            ccdMotionThreshold: 1.25,
            ccdSweptSphereRadius: 0.75,
        });

        const body = internals.rigidBodies.get('ccd-probe');
        expect(body?.isCcdEnabled()).toBe(true);
        expect(body?.softCcdPrediction()).toBeCloseTo(1.25, 5);
        physics.dispose();
    });

    it('maps shared terrain axes to Rapier heightfield axes', () => {
        const grid = getRapierHeightfieldGridDimensions({rows: 2, columns: 3});

        // Shared terrain rows run along Z and columns run along X. Rapier's
        // heightfield matrix rows run along X and columns run along Z.
        expect(grid).toEqual({rows: 3, columns: 2});
    });

    it('probes native heightfields once and reuses the supported fallback mode', async () => {
        await initRapier();
        resetRapierHeightfieldModeForTests();
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const heightfield = normalizeHeightfieldShape({
            type: BodyShapeType.HEIGHTFIELD,
            rows: 2,
            columns: 2,
            sampleCount: 2,
            heightSamples: [0, 0, 0, 0],
            offset: {x: 0, y: 0, z: 0},
            scale: {x: 1, y: 1, z: 1},
        });

        const first = createRapierHeightfieldShape(heightfield);
        const second = createRapierHeightfieldShape(heightfield);
        const mode = getRapierHeightfieldMode();
        const diagnostics = getRapierHeightfieldDiagnostics();
        expect(first.type).toBe(second.type);
        expect(['native', 'trimesh']).toContain(mode);
        if (mode === 'trimesh') {
            expect(warning).toHaveBeenCalledTimes(1);
            expect(diagnostics.fallbackReason).toMatch(/RuntimeError|unreachable|trap/i);
            expect((first as Rapier.TriMesh).flags).toBe(Rapier.TriMeshFlags.FIX_INTERNAL_EDGES);
        } else {
            expect(mode).toBe('native');
            expect(warning).not.toHaveBeenCalled();
            expect(diagnostics.fallbackReason).toBeNull();
        }

        warning.mockRestore();
        resetRapierHeightfieldModeForTests();
    });

    it('owns one joint per body pair and removes joints before body teardown', async () => {
        const physics = await makePhysicsEngine(-9.81);
        const internals = physics as unknown as {
            jointMap: Map<string, unknown>;
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

        // Re-authoring the same pair replaces the native constraint rather
        // than accumulating a second solver row for the same bodies.
        physics.addPointToPointJoint({
            collisionEnabled: false,
            uuidA: 'joint-a', pivotA: {x: 0, y: 0, z: 0},
            uuidB: 'joint-b', pivotB: {x: 2, y: 0, z: 0},
        });
        expect(internals.jointMap.size).toBe(1);

        physics.removeRigidBody('joint-a');
        expect(internals.jointMap.size).toBe(0);
        expect(() => physics.dispose()).not.toThrow();
    });

    makePhysicsTests(makePhysicsEngine);
    makeCharacterControllerTests(makePhysicsEngine);
    makeVehicleTests(makePhysicsEngine);
    makeJointTests(makePhysicsEngine);
    makeLegacyPhysicsAdapterTests(makePhysicsEngine);
});
