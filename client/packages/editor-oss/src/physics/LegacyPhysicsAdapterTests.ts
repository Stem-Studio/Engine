import { Object3D, Vector3 } from 'three';

import { COLLISION_TYPE } from '@stem/editor-oss/types/editor';
import {BodyShapeType, CollisionFlag, type CollisionRegistration} from './common/types';
import { LegacyPhysicsAdapter } from './LegacyPhysicsAdapter';
import { CollisionEvent, PhysicsEngine, RigidBodyType } from './PhysicsEngine';

type AdapterCollisionInternals = {
    players: Map<string, unknown>;
    collidableUuids: Set<string>;
    collisionListeners: Map<string, CollisionRegistration[]>;
    contactPairs: Map<string, Map<string, unknown>>;
    dispatchCollision(uuid1: string, uuid2: string): void;
    dispatchCollisionEvents(): void;
    handleCollision(event: CollisionEvent): void;
};

/**
 * Tests `LegacyPhysicsAdapter`-specific responsibilities. The
 * underlying physics behavior (gravity, onGround, slopes, kinematic
 * platforms, shape scaling, etc.) is covered by the engine-facing
 * factories (`makePhysicsTests`, `makeCharacterControllerTests`,
 * `makeVehicleTests`). These tests focus on the adapter's translation
 * from the legacy `IPhysics` data shapes to the `PhysicsEngine`
 * primitive calls, dispatcher plumbing, collision-listener routing,
 * and vehicle visual binding.
 *
 * @example
 * describe('MyPhysicsImplementation', () => {
 *     makeLegacyPhysicsAdapterTests(makeMyPhysicsImplementation);
 * });
 *
 * @param makePhysics - A function that returns a promise for the physics engine
 */
export const makeLegacyPhysicsAdapterTests = (makePhysics: (gravity: number) => Promise<PhysicsEngine>) => {
    describe('LegacyPhysicsAdapter', () => {
        const commonData = {
            uuid: 'body1',
            template: '',
            name: 'Body1',
            position: { x: 0, y: 0, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
            mass: 1,
            friction: 0.5,
            rollingFriction: 0.5,
            spinningFriction: 0.5,
            contactStiffness: 0.5,
            contactDamping: 0.5,
        };

        const dispatcher = {
            onBodyUpdate: vi.fn(),
            onCollision: vi.fn(),
            onReady: vi.fn(),
        };

        let physics: LegacyPhysicsAdapter;
        let engine: PhysicsEngine;

        beforeEach(async () => {
            vi.resetAllMocks();
            engine = await makePhysics(-9.81);
            physics = new LegacyPhysicsAdapter(engine, dispatcher);
        });

        afterEach(() => {
            physics.terminate();
        });

        const characterCalls = () =>
            dispatcher.onBodyUpdate.mock.calls.filter((c: any[]) => c[0] === 'character1');

        const onGroundSequence = (startIndex: number) =>
            characterCalls().slice(startIndex).map((c: any[]) => c[5]?.onGround === true);

        const countTransitions = (sequence: boolean[]) => {
            let count = 0;
            for (let i = 1; i < sequence.length; i++) {
                if (sequence[i] !== sequence[i - 1]) count++;
            }
            return count;
        };

        describe('shape helpers', () => {
            it('addBox registers the rigid body in the engine', () => {
                physics.addBox(new Object3D(), { ...commonData, uuid: 'box1', type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                expect(engine.hasRigidBody('box1')).toBe(true);
            });

            it('addSphere registers the rigid body in the engine', () => {
                physics.addSphere(new Object3D(), { ...commonData, uuid: 'sphere1', type: BodyShapeType.SPHERE, radius: 1 });
                expect(engine.hasRigidBody('sphere1')).toBe(true);
            });

            it('addCapsuleShape registers the rigid body in the engine', () => {
                physics.addCapsuleShape(new Object3D(), { ...commonData, uuid: 'caps1', type: BodyShapeType.CAPSULE, radius: 0.3, height: 1 });
                expect(engine.hasRigidBody('caps1')).toBe(true);
            });

            it('collision_flag maps to the correct RigidBodyType', () => {
                physics.addBox(new Object3D(), { ...commonData, uuid: 'dyn', type: BodyShapeType.BOX, width: 1, height: 1, length: 1, collision_flag: CollisionFlag.DYNAMIC, mass: 1 });
                physics.addBox(new Object3D(), { ...commonData, uuid: 'stat', type: BodyShapeType.BOX, width: 1, height: 1, length: 1, collision_flag: CollisionFlag.STATIC, mass: 0 });
                physics.addBox(new Object3D(), { ...commonData, uuid: 'kine', type: BodyShapeType.BOX, width: 1, height: 1, length: 1, collision_flag: CollisionFlag.KINEMATIC, mass: 0 });

                expect(engine.getRigidBodyType('dyn')).toBe(RigidBodyType.Dynamic);
                expect(engine.getRigidBodyType('stat')).toBe(RigidBodyType.Static);
                expect(engine.getRigidBodyType('kine')).toBe(RigidBodyType.Kinematic);
            });

            it('does not register a rejected dynamic concave body in adapter bookkeeping', () => {
                const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
                try {
                    physics.addConcaveHull(new Object3D(), {
                        ...commonData,
                        uuid: 'dynamic-mesh',
                        type: BodyShapeType.CONCAVE_HULL,
                        vertices: [[0, 0, 0, 1, 0, 0, 0, 1, 0]],
                        indexes: [[0, 1, 2]],
                    });

                    expect(engine.hasRigidBody('dynamic-mesh')).toBe(false);
                    expect(physics.getDynamicBodyObject('dynamic-mesh')).toBeUndefined();
                    expect(warn).toHaveBeenCalledWith(expect.stringContaining('concave hull'));
                } finally {
                    warn.mockRestore();
                }
            });

            it('treats removal of an unknown body as idempotent cleanup', () => {
                const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
                try {
                    physics.remove('missing-body');

                    expect(engine.hasRigidBody('missing-body')).toBe(false);
                    expect(warn).not.toHaveBeenCalled();
                } finally {
                    warn.mockRestore();
                }
            });
        });

        describe('dispatcher onBodyUpdate', () => {
            it('fires onBodyUpdate for each tracked rigid body after simulate', () => {
                physics.addBox(new Object3D(), { ...commonData, uuid: 'box1', type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                physics.simulate(1 / 60);

                const calls = dispatcher.onBodyUpdate.mock.calls.filter((c: any[]) => c[0] === 'box1');
                expect(calls.length).toBeGreaterThan(0);
                expect(calls.at(-1)?.[5]?.angularVelocity).toBeDefined();
            });

            it('setOrigin on a kinematic body reaches the engine', () => {
                // The adapter does not dispatch onBodyUpdate for
                // kinematic bodies (only dynamic and character
                // controllers), so we verify translation via the
                // engine state directly.
                physics.addBox(new Object3D(), {
                    ...commonData,
                    uuid: 'platform',
                    mass: 0,
                    collision_flag: CollisionFlag.KINEMATIC,
                    type: BodyShapeType.BOX,
                    width: 2, height: 0.2, length: 2,
                    position: { x: 0, y: 0, z: 0 },
                });
                physics.setOrigin('platform', { x: 0, y: 5, z: 0 });
                physics.simulate(1 / 60);

                const pos = engine.getRigidBodyPosition('platform');
                expect(pos?.y).toBeCloseTo(5, 2);
            });

            it('populates motionState (linearVelocity, onGround) for players', async () => {
                physics.addBox(new Object3D(), { ...commonData, uuid: 'character1', type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                await physics.addPlayerObject('character1', true);
                physics.simulate(1 / 60);

                const motionState = characterCalls().at(-1)?.[5];
                expect(motionState).toBeDefined();
                expect(motionState?.linearVelocity).toBeDefined();
                expect(typeof motionState?.onGround).toBe('boolean');
            });
        });

        describe('addPlayerObject options', () => {
            it('respects playerGravity passed during creation', async () => {
                physics.addBox(new Object3D(), { ...commonData, uuid: 'character1', type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                await physics.addPlayerObject('character1', true, {playerGravity: -60, jumpHeight: 1, stepHeight: 0.5, maxSlope: 60});
                physics.simulate(1 / 60);

                expect(dispatcher.onBodyUpdate).toHaveBeenCalledOnce();
                expect(dispatcher.onBodyUpdate.mock.calls[0]![0]).toBe('character1');
                const positionY = dispatcher.onBodyUpdate.mock.calls[0]![1].y;
                expectCloseTo(positionY, -1 / 60);
            });
        });

        describe('addPlayerObject failure handling', () => {
            it('rejects an unknown rigid body without retaining stale player state', async () => {
                const internals = physics as unknown as AdapterCollisionInternals;
                internals.players.set('missing-character', {});

                await expect(physics.addPlayerObject('missing-character', true)).rejects.toThrow('Failed to find player shape');

                expect(internals.players.has('missing-character')).toBe(false);
            });

            it('preserves a rigid body when the backend rejects its character controller', async () => {
                physics.addConcaveHull(new Object3D(), {
                    ...commonData,
                    uuid: 'concave-character',
                    type: BodyShapeType.CONCAVE_HULL,
                    mass: 0,
                    collision_flag: CollisionFlag.STATIC,
                    vertices: [[0, 0, 0, 1, 0, 0, 0, 1, 0]],
                    indexes: [[0, 1, 2]],
                });

                const internals = physics as unknown as AdapterCollisionInternals;
                internals.players.set('concave-character', {});

                const addController = vi.spyOn(engine, 'addCharacterController');
                const setPosition = vi.spyOn(engine, 'setCharacterControllerPosition');
                const setRotation = vi.spyOn(engine, 'setCharacterControllerRotation');
                const setMaxSlope = vi.spyOn(engine, 'setCharacterControllerMaxSlope');
                const setStepHeight = vi.spyOn(engine, 'setCharacterControllerStepHeight');
                const setGravity = vi.spyOn(engine, 'setCharacterControllerGravity');
                const removeRigidBody = vi.spyOn(engine, 'removeRigidBody');

                await expect(physics.addPlayerObject('concave-character', true)).rejects.toThrow('Failed to add character controller');

                expect(addController).toHaveBeenCalledWith('concave-character', 'concave-character');
                expect(engine.hasCharacterController('concave-character')).toBe(false);
                expect(engine.hasRigidBody('concave-character')).toBe(true);
                expect(internals.players.has('concave-character')).toBe(false);
                expect(setPosition).not.toHaveBeenCalled();
                expect(setRotation).not.toHaveBeenCalled();
                expect(setMaxSlope).not.toHaveBeenCalled();
                expect(setStepHeight).not.toHaveBeenCalled();
                expect(setGravity).not.toHaveBeenCalled();
                expect(removeRigidBody).not.toHaveBeenCalled();
            });

            it('does not configure or remove the rigid body when controller creation is a no-op', async () => {
                physics.addBox(new Object3D(), {
                    ...commonData,
                    uuid: 'missing-controller',
                    type: BodyShapeType.BOX,
                    width: 1,
                    height: 1,
                    length: 1,
                });

                const internals = physics as unknown as AdapterCollisionInternals;
                internals.players.set('missing-controller', {});

                vi.spyOn(engine, 'addCharacterController').mockImplementation(() => {});
                const setPosition = vi.spyOn(engine, 'setCharacterControllerPosition');
                const setRotation = vi.spyOn(engine, 'setCharacterControllerRotation');
                const setMaxSlope = vi.spyOn(engine, 'setCharacterControllerMaxSlope');
                const setStepHeight = vi.spyOn(engine, 'setCharacterControllerStepHeight');
                const setGravity = vi.spyOn(engine, 'setCharacterControllerGravity');
                const removeRigidBody = vi.spyOn(engine, 'removeRigidBody');

                await expect(physics.addPlayerObject('missing-controller', true)).rejects.toThrow('Failed to add character controller');

                expect(engine.hasCharacterController('missing-controller')).toBe(false);
                expect(engine.hasRigidBody('missing-controller')).toBe(true);
                expect(internals.players.has('missing-controller')).toBe(false);
                expect(setPosition).not.toHaveBeenCalled();
                expect(setRotation).not.toHaveBeenCalled();
                expect(setMaxSlope).not.toHaveBeenCalled();
                expect(setStepHeight).not.toHaveBeenCalled();
                expect(setGravity).not.toHaveBeenCalled();
                expect(removeRigidBody).not.toHaveBeenCalled();
            });
        });

        describe('applyImpulseToPlayer', () => {
            it('moves the player upward with a vertical impulse (zero gravity)', async () => {
                physics.addBox(new Object3D(), { ...commonData, uuid: 'character1', type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                await physics.addPlayerObject('character1', true);
                physics.setPlayerGravity('character1', { x: 0, y: 0, z: 0 });
                physics.applyImpulseToPlayer('character1', { x: 0, y: 1, z: 0 } as Vector3);
                physics.simulate(1 / 60);

                const positionY = dispatcher.onBodyUpdate.mock.calls[0]![1].y;
                expectCloseTo(positionY, 1 / 60);
            });

            it('combines with gravity for a net-zero first frame', async () => {
                physics.addBox(new Object3D(), { ...commonData, uuid: 'character1', type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                await physics.addPlayerObject('character1', true);
                physics.setPlayerGravity('character1', { x: 0, y: -60, z: 0 });
                physics.applyImpulseToPlayer('character1', { x: 0, y: 1, z: 0 } as Vector3);
                physics.simulate(1 / 60);

                const positionY = dispatcher.onBodyUpdate.mock.calls[0]![1].y;
                expect(positionY).toBeCloseTo(0, 5);
            });

            it('never over-reports onGround across a full airborne arc', async () => {
                physics.addBox(new Object3D(), { ...commonData, uuid: 'character1', type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                await physics.addPlayerObject('character1', true);
                physics.setPlayerGravity('character1', { x: 0, y: -20, z: 0 });

                physics.applyImpulseToPlayer('character1', { x: 0, y: 6, z: 0 } as Vector3);

                const overReports: number[] = [];
                for (let i = 0; i < 120; i++) {
                    physics.simulate(1 / 60);
                    const motionState = characterCalls().at(-1)?.[5];
                    if (motionState?.onGround === true) overReports.push(i);
                }
                expect(
                    overReports,
                    `onGround reported true on ${overReports.length} airborne frames: ${overReports.join(',')}`,
                ).toEqual([]);
            });
        });

        describe('movePlayerObject', () => {
            const addFloor = () => {
                physics.addBox(new Object3D(), {
                    ...commonData,
                    uuid: 'floor',
                    mass: 0,
                    type: BodyShapeType.BOX,
                    width: 20, height: 1, length: 20,
                    position: { x: 0, y: -1, z: 0 },
                });
            };

            it('drives the character in the walk direction', async () => {
                addFloor();
                physics.addBox(new Object3D(), { ...commonData, uuid: 'character1', type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                await physics.addPlayerObject('character1', true);
                physics.setPlayerGravity('character1', { x: 0, y: 0, z: 0 });

                const walkPerFrame = new Vector3(2 / 60, 0, 0);
                for (let i = 0; i < 60; i++) {
                    physics.movePlayerObject('character1', walkPerFrame, false);
                    physics.simulate(1 / 60);
                }

                const endX = characterCalls().at(-1)?.[1].x ?? 0;
                expect(endX).toBeGreaterThan(1);
            });

            it('flips onGround exactly twice during a jump (takeoff + landing)', async () => {
                addFloor();
                physics.addBox(new Object3D(), { ...commonData, uuid: 'character1', type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                await physics.addPlayerObject('character1', true, {
                    playerGravity: -20,
                    jumpHeight: 1,
                    stepHeight: 0.5,
                    maxSlope: 60,
                });

                for (let i = 0; i < 10; i++) physics.simulate(1 / 60);
                const preJumpIndex = Math.max(0, characterCalls().length - 1);

                physics.movePlayerObject('character1', new Vector3(0, 0, 0), true);
                physics.simulate(1 / 60);

                for (let i = 0; i < 180; i++) {
                    physics.movePlayerObject('character1', new Vector3(0, 0, 0), false);
                    physics.simulate(1 / 60);
                }

                const sequence = onGroundSequence(preJumpIndex);
                const transitions = countTransitions(sequence);
                expect(
                    transitions,
                    `onGround flipped ${transitions} times during a single jump; expected 2 (takeoff, landing). Sequence: ${sequence.map((g) => g ? 'G' : '.').join('')}`,
                ).toBe(2);
                expect(sequence[0]).toBe(true);
                expect(sequence.at(-1)).toBe(true);
            });

            it('reports onGround stable after landing with no late flicker', async () => {
                addFloor();
                physics.addBox(new Object3D(), { ...commonData, uuid: 'character1', type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                await physics.addPlayerObject('character1', true, {
                    playerGravity: -20,
                    jumpHeight: 1,
                    stepHeight: 0.5,
                    maxSlope: 60,
                });

                for (let i = 0; i < 10; i++) physics.simulate(1 / 60);

                physics.movePlayerObject('character1', new Vector3(0, 0, 0), true);
                physics.simulate(1 / 60);

                let landedAt = -1;
                for (let i = 0; i < 180; i++) {
                    physics.movePlayerObject('character1', new Vector3(0, 0, 0), false);
                    physics.simulate(1 / 60);
                    const motionState = characterCalls().at(-1)?.[5];
                    if (motionState?.onGround === true) {
                        landedAt = characterCalls().length - 1;
                        break;
                    }
                }
                expect(landedAt, 'character never landed within 3s').toBeGreaterThanOrEqual(0);

                for (let i = 0; i < 120; i++) {
                    physics.movePlayerObject('character1', new Vector3(0, 0, 0), false);
                    physics.simulate(1 / 60);
                }

                const postLanding = onGroundSequence(landedAt);
                const airborne = postLanding.filter((g) => !g).length;
                expect(
                    airborne,
                    `onGround flipped back to false on ${airborne}/${postLanding.length} post-landing frames`,
                ).toBe(0);
            });
        });

        describe('setPlayerSpeedAdjustment', () => {
            it('combined with an ascending kinematic platform keeps the character grounded (reproduces PlatformBehavior stutter)', async () => {
                // PlatformBehavior reports per-frame platform motion via
                // setPlayerSpeedAdjustment so riders are carried along. On
                // an ascending platform the adjustment drives walkVelocity.y
                // positive, which a naïve takeoff detector would mistake
                // for a jump. This is the regression that motivated the
                // adapter's speed-adjustment folding logic.
                const platformHeight = 0.2;
                let platformY = -0.5 - platformHeight / 2;
                physics.addBox(new Object3D(), {
                    ...commonData,
                    uuid: 'platform',
                    mass: 0,
                    collision_flag: CollisionFlag.KINEMATIC,
                    type: BodyShapeType.BOX,
                    width: 4,
                    height: platformHeight,
                    length: 4,
                    position: { x: 0, y: platformY, z: 0 },
                });
                physics.addBox(new Object3D(), { ...commonData, uuid: 'character1', type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                await physics.addPlayerObject('character1', true);
                physics.setPlayerGravity('character1', { x: 0, y: -10, z: 0 });

                for (let i = 0; i < 10; i++) physics.simulate(1 / 60);
                const motionState = characterCalls().at(-1)?.[5];
                expect(motionState?.onGround).toBe(true);
                const settledIndex = characterCalls().length;

                const ascentPerFrame = 0.84 / 60;
                for (let i = 0; i < 60; i++) {
                    platformY += ascentPerFrame;
                    physics.setOrigin('platform', { x: 0, y: platformY, z: 0 });
                    physics.setPlayerSpeedAdjustment('character1', new Vector3(0, ascentPerFrame, 0));
                    physics.movePlayerObject('character1', new Vector3(0, 0, 0), false);
                    physics.simulate(1 / 60);
                }

                const sequence = onGroundSequence(settledIndex);
                const airborne = sequence.filter((g) => !g).length;
                expect(
                    airborne,
                    `character reported airborne on ${airborne}/${sequence.length} ascending-platform-with-adjustment frames. Sequence: ${sequence.map((g) => g ? 'G' : '.').join('')}`,
                ).toBe(0);
            });
        });

        describe('simulate hot paths', () => {
            it('reuses the collision callback between simulation frames', () => {
                const callbacks: unknown[] = [];
                const emptyIterator = function* () {};
                const fakeEngine = {
                    stepDuration: 0,
                    dispose: vi.fn(),
                    simulate: vi.fn((onCollision: unknown) => {
                        callbacks.push(onCollision);
                    }),
                    rigidBodyUuids: vi.fn(emptyIterator),
                    characterControllerUuids: vi.fn(emptyIterator),
                    vehicleUuids: vi.fn(emptyIterator),
                } as unknown as PhysicsEngine;
                const adapter = new LegacyPhysicsAdapter(fakeEngine, dispatcher);

                adapter.simulate(1 / 60);
                adapter.simulate(1 / 60);

                expect(callbacks).toHaveLength(2);
                expect(callbacks[0]).toBe(callbacks[1]);
            });

            it('reuses the default unit scale payload for physics body updates', () => {
                const fakeEngine = {
                    stepDuration: 0,
                    dispose: vi.fn(),
                    simulate: vi.fn(),
                    rigidBodyUuids: function* () {
                        yield 'body1';
                    },
                    getRigidBodyType: vi.fn(() => RigidBodyType.Dynamic),
                    getRigidBodyPosition: vi.fn(() => ({ x: 1, y: 2, z: 3 })),
                    getRigidBodyRotation: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
                    getRigidBodyLinearVelocity: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
                    characterControllerUuids: function* () {
                        yield 'character1';
                    },
                    getCharacterControllerPosition: vi.fn(() => ({ x: 4, y: 5, z: 6 })),
                    getCharacterControllerRotation: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
                    getCharacterControllerLinearVelocity: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
                    isCharacterControllerOnGround: vi.fn(() => true),
                    addVehicle: vi.fn(),
                    vehicleUuids: function* () {
                        yield 'vehicle1';
                    },
                    getVehicleChassisPosition: vi.fn(() => ({ x: 7, y: 8, z: 9 })),
                    getVehicleChassisRotation: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
                    getVehicleWheelCount: vi.fn(() => 1),
                    getVehicleWheelTransform: vi.fn(() => ({
                        position: { x: 10, y: 11, z: 12 },
                        rotation: { x: 0, y: 0, z: 0, w: 1 },
                    })),
                } as unknown as PhysicsEngine;
                const adapter = new LegacyPhysicsAdapter(fakeEngine, dispatcher);
                (adapter as any).vehicleVisualData.set('vehicle1', {
                    chassisVisualUuid: 'chassis',
                    wheelVisualUuids: ['wheel1'],
                });

                adapter.simulate(1 / 60);

                const bodyUpdates = dispatcher.onBodyUpdate.mock.calls;
                expect(bodyUpdates).toHaveLength(4);
                const scale = bodyUpdates[0]![3];
                expect(scale).toEqual({ x: 1, y: 1, z: 1 });
                expect(bodyUpdates.map((call: any[]) => call[3])).toEqual([scale, scale, scale, scale]);
            });

            it('dispatches both contact directions in stable listener order', () => {
                const emptyIterator = function* () {};
                const fakeEngine = {
                    stepDuration: 0,
                    dispose: vi.fn(),
                    simulate: vi.fn(),
                    rigidBodyUuids: vi.fn(emptyIterator),
                    characterControllerUuids: vi.fn(emptyIterator),
                } as unknown as PhysicsEngine;
                const adapter = new LegacyPhysicsAdapter(fakeEngine, dispatcher);
                const internals = adapter as unknown as AdapterCollisionInternals;
                internals.players.set('player', {});
                internals.collidableUuids.add('sensor');
                adapter.detectCollisionsForObject(
                    'sensor',
                    {id: 'sensor-player', type: COLLISION_TYPE.WITH_PLAYER},
                    true,
                );
                adapter.detectCollisionsForObject(
                    'player',
                    {id: 'player-sensor', type: COLLISION_TYPE.WITH_COLLIDABLE_OBJECTS},
                    true,
                );

                internals.dispatchCollision('sensor', 'player');

                expect(dispatcher.onCollision.mock.calls).toEqual([
                    ['sensor', 'sensor-player'],
                    ['player', 'player-sensor'],
                ]);
            });

            it('removes matching collision listeners in place and deletes empty buckets', () => {
                const emptyIterator = function* () {};
                const fakeEngine = {
                    stepDuration: 0,
                    dispose: vi.fn(),
                    simulate: vi.fn(),
                    rigidBodyUuids: vi.fn(emptyIterator),
                    characterControllerUuids: vi.fn(emptyIterator),
                } as unknown as PhysicsEngine;
                const adapter = new LegacyPhysicsAdapter(fakeEngine, dispatcher);
                const listeners = [
                    {id: 'keep-a', type: COLLISION_TYPE.WITH_PLAYER},
                    {id: 'remove', type: COLLISION_TYPE.WITH_PLAYER},
                    {id: 'keep-b', type: COLLISION_TYPE.WITH_PLAYER},
                ];
                const internals = adapter as unknown as AdapterCollisionInternals;
                internals.collisionListeners.set('sensor', listeners);

                adapter.detectCollisionsForObject(
                    'sensor',
                    {id: 'remove', type: COLLISION_TYPE.WITH_PLAYER},
                    false,
                );

                expect(internals.collisionListeners.get('sensor')).toBe(listeners);
                expect(listeners.map(listener => listener.id)).toEqual(['keep-a', 'keep-b']);

                adapter.detectCollisionsForObject(
                    'sensor',
                    {id: 'keep-a', type: COLLISION_TYPE.WITH_PLAYER},
                    false,
                );
                adapter.detectCollisionsForObject(
                    'sensor',
                    {id: 'keep-b', type: COLLISION_TYPE.WITH_PLAYER},
                    false,
                );

                expect(internals.collisionListeners.has('sensor')).toBe(false);
            });

            it('removes canonical contact pairs when end events reverse UUID order', () => {
                const emptyIterator = function* () {};
                const fakeEngine = {
                    stepDuration: 0,
                    dispose: vi.fn(),
                    simulate: vi.fn(),
                    rigidBodyUuids: vi.fn(emptyIterator),
                    characterControllerUuids: vi.fn(emptyIterator),
                } as unknown as PhysicsEngine;
                const adapter = new LegacyPhysicsAdapter(fakeEngine, dispatcher);
                const internals = adapter as unknown as AdapterCollisionInternals;
                adapter.detectCollisionsForObject(
                    'body-b',
                    {id: 'body-b-listener', type: COLLISION_TYPE.UNKNOWN},
                    true,
                );

                internals.handleCollision({
                    uuid1: 'body-b',
                    uuid2: 'body-a',
                    started: true,
                    type1: 'rigidBody',
                    type2: 'rigidBody',
                    group1: 1,
                    group2: 1,
                });
                internals.dispatchCollisionEvents();
                expect(dispatcher.onCollision).toHaveBeenCalledWith('body-b', 'body-b-listener');

                dispatcher.onCollision.mockClear();
                internals.handleCollision({
                    uuid1: 'body-a',
                    uuid2: 'body-b',
                    started: false,
                    type1: 'rigidBody',
                    type2: 'rigidBody',
                    group1: 1,
                    group2: 1,
                });
                internals.dispatchCollisionEvents();

                expect(dispatcher.onCollision).not.toHaveBeenCalled();
                expect(internals.contactPairs.size).toBe(0);
            });
        });

        describe('collisions', () => {
            it('should report a collision with a collidable object', () => {
                physics.addBox(new Object3D(), { ...commonData, uuid: 'body1', type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                physics.addCollidableObject('body1');

                physics.addBox(new Object3D(), { ...commonData, uuid: 'body2', type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                physics.detectCollisionsForObject('body2', { id: 'listener1', type: COLLISION_TYPE.WITH_COLLIDABLE_OBJECTS }, true);

                physics.simulate(1 / 60);

                expect(dispatcher.onCollision).toHaveBeenCalledWith('body2', 'listener1');
            });

            it('should report a collision with a player', async () => {
                physics.addBox(new Object3D(), { ...commonData, uuid: 'character1', type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                await physics.addPlayerObject('character1', true);

                physics.addBox(new Object3D(), { ...commonData, uuid: 'body1', type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                physics.detectCollisionsForObject('body1', { id: 'listener1', type: COLLISION_TYPE.WITH_PLAYER }, true);

                physics.simulate(1 / 60);

                expect(dispatcher.onCollision).toHaveBeenCalledWith('body1', 'listener1');
            });

            it('should not report a collision with a collidable object when collisions are disabled', () => {
                physics.addBox(new Object3D(), { ...commonData, uuid: 'body1', type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                physics.addCollidableObject('body1');

                physics.addBox(new Object3D(), { ...commonData, uuid: 'body2', type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                physics.detectCollisionsForObject('body2', { id: 'listener1', type: COLLISION_TYPE.WITH_COLLIDABLE_OBJECTS }, true);
                physics.detectCollisionsForObject('body2', { id: 'listener1', type: COLLISION_TYPE.WITH_COLLIDABLE_OBJECTS }, false);

                physics.simulate(1 / 60);

                expect(dispatcher.onCollision).not.toHaveBeenCalled();
            });

            it('should not report a collision with a player when collisions are disabled', async () => {
                physics.addBox(new Object3D(), { ...commonData, uuid: 'character1', type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                await physics.addPlayerObject('character1', true);

                physics.addBox(new Object3D(), { ...commonData, uuid: 'body1', type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                physics.detectCollisionsForObject('body1', { id: 'listener1', type: COLLISION_TYPE.WITH_PLAYER }, true);
                physics.detectCollisionsForObject('body1', { id: 'listener1', type: COLLISION_TYPE.WITH_PLAYER }, false);

                physics.simulate(1 / 60);

                expect(dispatcher.onCollision).not.toHaveBeenCalled();
            });
        });

        describe('push impulse', () => {
            it('reuses its push direction vector while still applying dynamic-body impulses', () => {
                const impulses: Array<{ uuid: string; impulse: { x: number; y: number; z: number } }> = [];
                const fakeEngine = {
                    dispose: vi.fn(),
                    getRigidBodyType: vi.fn(() => RigidBodyType.Dynamic),
                    getRigidBodyPosition: vi.fn(() => ({ x: 4, y: 0, z: 0 })),
                    getRigidBodyLinearVelocity: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
                    applyImpulseToRigidBody: vi.fn((uuid: string, impulse: { x: number; y: number; z: number }) => {
                        impulses.push({ uuid, impulse: { ...impulse } });
                    }),
                } as unknown as PhysicsEngine;
                const adapter = new LegacyPhysicsAdapter(fakeEngine, dispatcher);
                const targetObject = new Object3D();
                targetObject.userData.physics = {
                    mass: 1,
                    friction: 0.5,
                    restitution: 0.5,
                    contactDamping: 0.2,
                };
                const collision: CollisionEvent = {
                    type1: 'characterController',
                    uuid1: 'character1',
                    group1: 1,
                    type2: 'rigidBody',
                    uuid2: 'crate',
                    group2: 1,
                    started: true,
                };

                (adapter as any).players.set('character1', {
                    gravity: -10,
                    jumpSpeed: 1,
                    isJumping: false,
                    pushObjects: true,
                    pushImpulse: 1,
                    pushVerticalScale: 0,
                    walkVelocity: { x: 1, y: 0, z: 0 },
                });
                (adapter as any).dynamicObjects.set('crate', targetObject);

                (adapter as any).handleCollision(collision);
                const pushDirection = (adapter as any).pushDirection;
                (adapter as any).players.get('character1').walkVelocity.x = 2;
                (adapter as any).handleCollision(collision);

                expect((adapter as any).pushDirection).toBe(pushDirection);
                expect(fakeEngine.applyImpulseToRigidBody).toHaveBeenCalledTimes(2);
                expect(impulses).toHaveLength(2);
                const firstImpulse = impulses[0]!;
                const secondImpulse = impulses[1]!;
                expect(firstImpulse.uuid).toBe('crate');
                expect(firstImpulse.impulse.x).toBeGreaterThan(0);
                expect(secondImpulse.impulse.x).toBeGreaterThan(firstImpulse.impulse.x);
            });
        });

        describe('kick impulse', () => {
            it('moves a real dynamic body in both supported backend implementations', async () => {
                physics.addBox(new Object3D(), {
                    ...commonData,
                    uuid: 'character1',
                    type: BodyShapeType.BOX,
                    position: {x: 0, y: 0, z: 0},
                    width: 1,
                    height: 1,
                    length: 1,
                });
                await physics.addPlayerObject('character1', true);
                physics.addBox(new Object3D(), {
                    ...commonData,
                    uuid: 'kick-target',
                    type: BodyShapeType.BOX,
                    position: {x: 0, y: 0, z: 1.5},
                    width: 0.5,
                    height: 0.5,
                    length: 0.5,
                });

                physics.kickNearbyObjects('character1', 5);

                expect(engine.getRigidBodyLinearVelocity('kick-target')?.z).toBeGreaterThan(0);
            });

            it('kicks only dynamic bodies in the character-facing reach cone', () => {
                const impulses: Array<{uuid: string; impulse: {x: number; y: number; z: number}}> = [];
                const positions = new Map([
                    ['front', {x: 0, y: 0, z: 1}],
                    ['edge', {x: 1.9, y: 0, z: 1.4}],
                    ['behind', {x: 0, y: 0, z: -1}],
                    ['high', {x: 0, y: 2, z: 1}],
                    ['static-front', {x: 0, y: 0, z: 1}],
                ]);
                const fakeEngine = {
                    getCharacterControllerPosition: vi.fn(() => ({x: 0, y: 0, z: 0})),
                    getCharacterControllerRotation: vi.fn(() => ({x: 0, y: 0, z: 0, w: 1})),
                    rigidBodyUuids: vi.fn(function* () {
                        yield* positions.keys();
                    }),
                    getRigidBodyType: vi.fn((uuid: string) => uuid === 'static-front' ? RigidBodyType.Static : RigidBodyType.Dynamic),
                    getRigidBodyPosition: vi.fn((uuid: string) => positions.get(uuid) ?? null),
                    applyImpulseToRigidBody: vi.fn((uuid: string, impulse: {x: number; y: number; z: number}) => {
                        impulses.push({uuid, impulse: {...impulse}});
                    }),
                } as unknown as PhysicsEngine;
                const adapter = new LegacyPhysicsAdapter(fakeEngine, dispatcher);

                adapter.kickNearbyObjects('character', 5);

                expect(impulses.map(entry => entry.uuid)).toEqual(['front', 'edge']);
                expect(impulses[0]?.impulse.z).toBeGreaterThan(0);
                expect(impulses[0]?.impulse.y).toBeGreaterThan(0);
                expect(impulses[0]?.impulse.z).toBeGreaterThan(impulses[1]?.impulse.z ?? 0);
                expect(fakeEngine.applyImpulseToRigidBody).toHaveBeenCalledTimes(2);
            });

            it('ignores invalid or non-positive kick magnitudes without querying bodies', () => {
                const rigidBodyUuids = vi.fn(function* () {
                    yield 'body';
                });
                const fakeEngine = {
                    getCharacterControllerPosition: vi.fn(() => ({x: 0, y: 0, z: 0})),
                    getCharacterControllerRotation: vi.fn(() => ({x: 0, y: 0, z: 0, w: 1})),
                    rigidBodyUuids,
                } as unknown as PhysicsEngine;
                const adapter = new LegacyPhysicsAdapter(fakeEngine, dispatcher);

                adapter.kickNearbyObjects('character', 0);
                adapter.kickNearbyObjects('character', Number.NaN);

                expect(rigidBodyUuids).not.toHaveBeenCalled();
            });
        });

        describe('scale', () => {
            it('forwards data.scale to the engine (giant-box regression)', async () => {
                // Adapter previously dropped `data.scale` in addBody, so
                // shapes extracted at a parent-scale-compensated size
                // (a 10m geometry with scale=0.1) would collide at raw
                // geometry size instead of the intended world size.
                physics.addBox(new Object3D(), {
                    ...commonData,
                    uuid: 'floor',
                    type: BodyShapeType.BOX,
                    collision_flag: CollisionFlag.STATIC,
                    mass: 0,
                    position: { x: 0, y: 0, z: 0 },
                    scale: { x: 0.1, y: 0.1, z: 0.1 },
                    width: 10, height: 1, length: 10,
                });
                physics.addBox(new Object3D(), {
                    ...commonData,
                    uuid: 'probe',
                    type: BodyShapeType.BOX,
                    collision_flag: CollisionFlag.DYNAMIC,
                    mass: 1,
                    position: { x: 0, y: 3, z: 0 },
                    scale: { x: 1, y: 1, z: 1 },
                    width: 0.2, height: 0.2, length: 0.2,
                });

                for (let i = 0; i < 240; i++) physics.simulate(1 / 60);

                const probeY = dispatcher.onBodyUpdate.mock.calls
                    .filter((c: any[]) => c[0] === 'probe')
                    .at(-1)?.[1]?.y;
                expect(
                    probeY,
                    `probe rested at y=${probeY}; expected ≈0.15 (scale applied). ` +
                    'A value near 0.6 means data.scale is being dropped and the ' +
                    '10m floor is colliding at full size.',
                ).toBeGreaterThan(0);
                expect(probeY).toBeLessThan(0.3);
            });
        });
    });
};

const relativeError = (expected: number, actual: number) =>
    Math.abs((expected - actual) / expected);

const expectCloseTo = (actual: number, expected: number, maxRelativeError: number = 0.02) => {
    expect(relativeError(expected, actual), `${actual} should be close to ${expected}`).toBeLessThanOrEqual(maxRelativeError);
};
