import { BodyShapeType } from './common/types';
import { PhysicsEngine, RigidBodyType } from './PhysicsEngine';

/**
 * Shared harness for the mandatory engine-facing joint API.
 * Both supported backends must implement this contract.
 *
 * @example
 * describe('MyPhysicsImplementation', () => {
 *     makeJointTests(makeMyPhysicsImplementation);
 * });
 *
 * @param makePhysics - A factory that returns a promise for a
 * `PhysicsEngine` implementation.
 */
export const makeJointTests = (
    makePhysics: (gravity: number) => Promise<PhysicsEngine>,
) => {
    let physics: PhysicsEngine;

    beforeEach(async () => {
        vi.resetAllMocks();
        physics = await makePhysics(-9.81);
        physics.stepDuration = 1 / 60;
    });

    afterEach(() => {
        physics.dispose();
    });

    const jointPhysicsOrSkip = (): PhysicsEngine => physics;

    /** Adds a unit box body at the given position. */
    const addBox = (uuid: string, type: RigidBodyType, pos: { x: number; y: number; z: number }, mass = 1) => {
        const shapeUuid = `${uuid}-shape`;
        physics.addShape(shapeUuid, { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
        physics.addRigidBody(uuid, shapeUuid, type, { mass, position: pos });
    };

    describe('joints', () => {
        describe('addFixedJoint', () => {
            it('holds body B rigidly against a static body A', () => {
                const jp = jointPhysicsOrSkip();
                if (!jp) return;

                addBox('a', RigidBodyType.Static, { x: 0, y: 5, z: 0 }, 0);
                addBox('b', RigidBodyType.Dynamic, { x: 2, y: 5, z: 0 });

                jp.addFixedJoint({
                    collisionEnabled: false,
                    uuidA: 'a', uuidB: 'b',
                    pivotB: { x: 2, y: 0, z: 0 },
                    rotationB: { x: 0, y: 0, z: 0, w: 1 },
                });

                for (let i = 0; i < 120; i++) physics.simulate();

                const pos = physics.getRigidBodyPosition('b');
                // Body B should hang near its original position rather
                // than fall freely. Tolerance is generous because fixed
                // joints in Bullet/Rapier are slightly compliant.
                expect(pos!.y).toBeGreaterThan(3);
            });
        });

        describe('addHingeJoint', () => {
            it('keeps a dynamic body swinging under the static anchor', () => {
                const jp = jointPhysicsOrSkip();
                if (!jp) return;

                addBox('a', RigidBodyType.Static, { x: 0, y: 5, z: 0 }, 0);
                addBox('b', RigidBodyType.Dynamic, { x: 2, y: 5, z: 0 });

                // Hinge around Z axis at the origin of A, attaching B
                // two units along A's +X axis.
                jp.addHingeJoint({
                    collisionEnabled: false,
                    uuidA: 'a', uuidB: 'b',
                    hingeAxis: { x: 0, y: 0, z: 1 },
                    relPos: { x: 2, y: 0, z: 0 },
                    relRotation: { x: 0, y: 0, z: 0, w: 1 },
                    angularLimitEnabled: false,
                    angularLimit: { x: 0, y: 0, z: 0 },
                    motorEnabled: false,
                    motorSpeed: 0,
                    motorTorque: 0,
                });

                for (let i = 0; i < 120; i++) physics.simulate();

                const pos = physics.getRigidBodyPosition('b');
                // Pendulum preserves its radius (roughly 2 from A).
                const dx = pos!.x;
                const dy = pos!.y - 5;
                const radius = Math.sqrt(dx * dx + dy * dy);
                expect(radius).toBeGreaterThan(1.5);
                expect(radius).toBeLessThan(2.5);
                // Must have swung downward.
                expect(pos!.y).toBeLessThan(5);
            });
        });

        describe('addPointToPointJoint', () => {
            it('keeps the two pivots roughly coincident while B hangs', () => {
                const jp = jointPhysicsOrSkip();
                if (!jp) return;

                addBox('a', RigidBodyType.Static, { x: 0, y: 5, z: 0 }, 0);
                addBox('b', RigidBodyType.Dynamic, { x: 1, y: 5, z: 0 });

                // Attach pivot at A's +X face to pivot at B's -X face.
                jp.addPointToPointJoint({
                    collisionEnabled: false,
                    uuidA: 'a', pivotA: { x: 0.5, y: 0, z: 0 },
                    uuidB: 'b', pivotB: { x: -0.5, y: 0, z: 0 },
                });

                for (let i = 0; i < 120; i++) physics.simulate();

                const pos = physics.getRigidBodyPosition('b');
                // The point-to-point keeps both pivots coincident,
                // so B's center (at +0.5 local from pivot) should stay
                // within a unit radius of (0.5, 5, 0).
                const dx = pos!.x - 0.5;
                const dy = pos!.y - 5;
                const dist = Math.sqrt(dx * dx + dy * dy);
                expect(dist).toBeLessThan(1.1);
            });
        });

        describe('removeJoint', () => {
            it('lets body B fall freely after removal', () => {
                const jp = jointPhysicsOrSkip();
                if (!jp) return;

                addBox('a', RigidBodyType.Static, { x: 0, y: 5, z: 0 }, 0);
                addBox('b', RigidBodyType.Dynamic, { x: 2, y: 5, z: 0 });

                jp.addFixedJoint({
                    collisionEnabled: false,
                    uuidA: 'a', uuidB: 'b',
                    pivotB: { x: 2, y: 0, z: 0 },
                    rotationB: { x: 0, y: 0, z: 0, w: 1 },
                });

                for (let i = 0; i < 30; i++) physics.simulate();
                const yHeld = physics.getRigidBodyPosition('b')!.y;

                jp.removeJoint('a', 'b');

                for (let i = 0; i < 120; i++) physics.simulate();
                const yAfter = physics.getRigidBodyPosition('b')!.y;

                // After release the body falls well below the jointed
                // position.
                expect(yAfter).toBeLessThan(yHeld - 5);
            });

            it('is order-independent in the uuid pair', () => {
                const jp = jointPhysicsOrSkip();
                if (!jp) return;

                addBox('a', RigidBodyType.Static, { x: 0, y: 5, z: 0 }, 0);
                addBox('b', RigidBodyType.Dynamic, { x: 2, y: 5, z: 0 });

                jp.addFixedJoint({
                    collisionEnabled: false,
                    uuidA: 'a', uuidB: 'b',
                    pivotB: { x: 2, y: 0, z: 0 },
                    rotationB: { x: 0, y: 0, z: 0, w: 1 },
                });

                // Swap order on remove — should still take effect.
                jp.removeJoint('b', 'a');

                for (let i = 0; i < 120; i++) physics.simulate();
                const pos = physics.getRigidBodyPosition('b');
                // Body should fall once joint is gone.
                expect(pos!.y).toBeLessThan(0);
            });
        });
    });
};
