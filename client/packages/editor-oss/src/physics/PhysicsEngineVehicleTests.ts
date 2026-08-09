import { VehicleData, VehicleOptions } from './common/types';
import { PhysicsEngine } from './PhysicsEngine';

/**
 * Shared harness for the mandatory engine-facing vehicle API.
 * Both supported backends must implement this contract.
 *
 * @example
 * describe('MyPhysicsImplementation', () => {
 *     makeVehicleTests(makeMyPhysicsImplementation);
 * });
 *
 * @param makePhysics - A factory that returns a promise for a
 * `PhysicsEngine` implementation.
 */
export const makeVehicleTests = (
    makePhysics: (gravity: number) => Promise<PhysicsEngine>,
) => {
    let physics: PhysicsEngine;

    beforeEach(async () => {
        vi.resetAllMocks();
        physics = await makePhysics(-9.81);
        physics.stepDuration = 1;
    });

    afterEach(() => {
        physics.dispose();
    });

    describe('vehicles', () => {
        const testSpec: VehicleData = {
            chassisObjectUuid: 'chassis-visual',
            chassis: {
                halfExtents: { x: 1, y: 0.5, z: 2 },
                centerOffset: { x: 0, y: 0, z: 0 },
                initialTransform: {
                    position: { x: 0, y: 5, z: 0 },
                    quaternion: { x: 0, y: 0, z: 0, w: 1 },
                },
            },
            wheels: [
                { name: 'FL', isFront: true, radius: 0.3, width: 0.2, connection: { x: -1, y: 0, z: 1.5 } },
                { name: 'FR', isFront: true, radius: 0.3, width: 0.2, connection: { x: 1, y: 0, z: 1.5 } },
                { name: 'RL', isFront: false, radius: 0.3, width: 0.2, connection: { x: -1, y: 0, z: -1.5 } },
                { name: 'RR', isFront: false, radius: 0.3, width: 0.2, connection: { x: 1, y: 0, z: -1.5 } },
            ],
        };

        const testOptions: VehicleOptions = {
            mass: 800,
            suspensionStiffness: 30,
            suspensionDamping: 4.4,
            suspensionCompression: 2.3,
            suspensionRestLength: 0.6,
            rollInfluence: 0.1,
            wheelFriction: 1000,
            maxEngineForce: 2000,
            maxBrakeForce: 100,
            maxSteerAngle: 0.5,
            throttleDeadzone: 0.05,
            steerDeadzone: 0.05,
        };

        const vehiclePhysicsOrSkip = (): PhysicsEngine => physics;

        it('should add and remove a vehicle', () => {
            const vp = vehiclePhysicsOrSkip();
            if (!vp) return;
            vp.addVehicle('vehicle1', testSpec, testOptions);
            expect(vp.hasVehicle('vehicle1')).toBe(true);
            vp.removeVehicle('vehicle1');
            expect(vp.hasVehicle('vehicle1')).toBe(false);
        });

        it('should return the correct wheel count', () => {
            const vp = vehiclePhysicsOrSkip();
            if (!vp) return;
            vp.addVehicle('vehicle1', testSpec, testOptions);
            expect(vp.getVehicleWheelCount('vehicle1')).toBe(4);
        });

        it('should return chassis position', () => {
            const vp = vehiclePhysicsOrSkip();
            if (!vp) return;
            vp.addVehicle('vehicle1', testSpec, testOptions);
            const pos = vp.getVehicleChassisPosition('vehicle1');
            expect(pos).not.toBeNull();
            expect(pos!.x).toBe(0);
            expect(pos!.y).toBe(5);
            expect(pos!.z).toBe(0);
        });

        it('should move chassis under gravity after simulation', () => {
            const vp = vehiclePhysicsOrSkip();
            if (!vp) return;
            vp.addVehicle('vehicle1', testSpec, testOptions);
            vp.simulate();
            const pos = vp.getVehicleChassisPosition('vehicle1');
            expect(pos).not.toBeNull();
            expect(pos!.y).toBeLessThan(5);
        });

        it('should return wheel transforms', () => {
            const vp = vehiclePhysicsOrSkip();
            if (!vp) return;
            vp.addVehicle('vehicle1', testSpec, testOptions);
            for (let i = 0; i < 4; i++) {
                const wt = vp.getVehicleWheelTransform('vehicle1', i);
                expect(wt).not.toBeNull();
                expect(wt!.position).toBeDefined();
                expect(wt!.rotation).toBeDefined();
            }
        });

        it('should return 0 wheels for non-existent vehicle', () => {
            const vp = vehiclePhysicsOrSkip();
            if (!vp) return;
            expect(vp.getVehicleWheelCount('nonexistent')).toBe(0);
        });

        // Regression coverage for DOT-7688: the vehicle chassis is registered
        // in `vehicles` only, not in `rigidBodies`. Body-mutating methods used
        // to silently no-op when given a vehicle uuid because they only
        // consulted `rigidBodies`. The `getRigidBody` helper in each engine
        // now falls back to the chassis body.
        describe('chassis addressable via rigid-body API (DOT-7688)', () => {
            it('setRigidBodyPosition moves the chassis', () => {
                const vp = vehiclePhysicsOrSkip();
                if (!vp) return;
                vp.addVehicle('vehicle1', testSpec, testOptions);
                physics.setRigidBodyPosition('vehicle1', { x: 7, y: 11, z: -3 });
                const pos = vp.getVehicleChassisPosition('vehicle1');
                expect(pos).not.toBeNull();
                expect(pos!.x).toBeCloseTo(7, 3);
                expect(pos!.y).toBeCloseTo(11, 3);
                expect(pos!.z).toBeCloseTo(-3, 3);
            });

            it('setRigidBodyRotation rotates the chassis', () => {
                const vp = vehiclePhysicsOrSkip();
                if (!vp) return;
                vp.addVehicle('vehicle1', testSpec, testOptions);
                // 90deg about Y: (0, sin(45deg), 0, cos(45deg))
                const half = Math.SQRT1_2;
                physics.setRigidBodyRotation('vehicle1', { x: 0, y: half, z: 0, w: half });
                const rot = physics.getRigidBodyRotation('vehicle1');
                expect(rot).not.toBeNull();
                expect(rot!.x).toBeCloseTo(0, 3);
                expect(Math.abs(rot!.y)).toBeCloseTo(half, 3);
                expect(rot!.z).toBeCloseTo(0, 3);
                expect(Math.abs(rot!.w)).toBeCloseTo(half, 3);
            });

            it('setRigidBodyLinearVelocity sets chassis linear velocity', () => {
                const vp = vehiclePhysicsOrSkip();
                if (!vp) return;
                vp.addVehicle('vehicle1', testSpec, testOptions);
                physics.setRigidBodyLinearVelocity('vehicle1', { x: 2, y: 0, z: 0 });
                const v = physics.getRigidBodyLinearVelocity('vehicle1');
                expect(v).not.toBeNull();
                expect(v!.x).toBeCloseTo(2, 3);
            });

            it('setRigidBodyAngularVelocity sets chassis angular velocity', () => {
                const vp = vehiclePhysicsOrSkip();
                if (!vp) return;
                vp.addVehicle('vehicle1', testSpec, testOptions);
                physics.setRigidBodyAngularVelocity('vehicle1', { x: 0, y: 1.5, z: 0 });
                const w = physics.getRigidBodyAngularVelocity('vehicle1');
                expect(w).not.toBeNull();
                expect(w!.y).toBeCloseTo(1.5, 3);
            });

            it('getRigidBodyPosition reports chassis position', () => {
                const vp = vehiclePhysicsOrSkip();
                if (!vp) return;
                vp.addVehicle('vehicle1', testSpec, testOptions);
                const pos = physics.getRigidBodyPosition('vehicle1');
                expect(pos).not.toBeNull();
                expect(pos!.y).toBeCloseTo(5, 3);
            });
        });
    });
};
