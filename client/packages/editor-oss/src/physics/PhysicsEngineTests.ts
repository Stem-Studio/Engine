import { BodyShapeType, CollisionBehavior, CollisionShape } from './common/types';
import { DEFAULT_RIGID_BODY_COLLISION_GROUP, PhysicsEngine, RigidBodyType } from './PhysicsEngine';

/**
 * Creates a suite of tests for the PhysicsEngine interface. This should be able
 * to be used with any PhysicsEngine implementation to test its adherence to the
 * interface.
 * 
 * @example
 * describe('MyPhysicsImplementation', () => {
 *     makePhysicsTests(() => {
 *         const physics = await initMyPhysicsImplementation();
 *         return physics;
 *     });
 * });
 * 
 * @param makePhysics - A factory function that returns a promise for a
 * PhysicsEngine implementation
 */
export const makePhysicsTests = (makePhysics: (gravity: number) => Promise<PhysicsEngine>) => {
    let physics: PhysicsEngine;

    beforeEach(async () => {
        vi.resetAllMocks();
        physics = await makePhysics(-9.81);
        physics.stepDuration = 1; // Simplifies testing
    });

    afterEach(() => {
        physics.dispose();
    });

    it('should have default gravity of -9.81', () => {
        expect(physics.getGravity()).toBeCloseTo(-9.81, 5);
    });

    describe('rigid bodies', () => {
        it('should handle gravity', () => {
            physics.addShape('shape1', { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
            physics.addRigidBody('body1', 'shape1', RigidBodyType.Dynamic, { mass: 1 });
            physics.simulate();
            const position = physics.getRigidBodyPosition('body1');

            expectCloseTo(position?.y || 0, -9.81);
        });

        [
            RigidBodyType.Kinematic,
            RigidBodyType.Static,
        ].forEach((type) => {
            it(`should not move a ${type} body while simulating`, () => {
                physics.addShape('shape1', { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                // A stale authored mass must be ignored for non-dynamic
                // bodies; native construction still needs zero inertia.
                physics.addRigidBody('body1', 'shape1', type, { mass: 25 });
                physics.simulate();
                const position = physics.getRigidBodyPosition('body1');

                expect(position).toEqual({ x: 0, y: 0, z: 0 });
            });
        });

        it('should report a collision between two rigid bodies', () => {
            physics.addShape('shape1', { type: BodyShapeType.SPHERE, radius: 0.5 });
            physics.addRigidBody('body1', 'shape1', RigidBodyType.Dynamic, { mass: 1 });

            physics.addShape('shape2', { type: BodyShapeType.SPHERE, radius: 0.5 });
            physics.addRigidBody('body2', 'shape2', RigidBodyType.Dynamic, { mass: 1 });
            physics.setRigidBodyPosition('body2', { x: 1.5, y: 0, z: 0 });
            physics.setRigidBodyLinearVelocity('body2', { x: -1, y: 0, z: 0 });

            const onCollision = vi.fn();
            physics.simulate(onCollision);
            physics.simulate(onCollision);
            physics.simulate(onCollision);
            physics.simulate(onCollision);

            expect(onCollision).toHaveBeenCalledTimes(2);
            
            expect(onCollision.mock.calls[0]![0]).toEqual({
                uuid1: 'body1',
                uuid2: 'body2',
                type1: 'rigidBody',
                type2: 'rigidBody',
                group1: DEFAULT_RIGID_BODY_COLLISION_GROUP,
                group2: DEFAULT_RIGID_BODY_COLLISION_GROUP,
                started: true,
            });

            expect(onCollision.mock.calls[1]![0]).toEqual({
                uuid1: 'body1',
                uuid2: 'body2',
                type1: 'rigidBody',
                type2: 'rigidBody',
                group1: DEFAULT_RIGID_BODY_COLLISION_GROUP,
                group2: DEFAULT_RIGID_BODY_COLLISION_GROUP,
                started: false,
            });
        });

        it('should not report a collision when no bodies are in contact', () => {
            physics.addShape('shape1', { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
            physics.addRigidBody('body1', 'shape1', RigidBodyType.Dynamic, { mass: 1 });

            physics.addShape('shape2', { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
            physics.addRigidBody('body2', 'shape2', RigidBodyType.Dynamic, { mass: 1 });
            physics.setRigidBodyPosition('body2', { x: 10, y: 0, z: 0 });

            const onCollision = vi.fn();
            physics.simulate(onCollision);
            
            expect(onCollision).not.toHaveBeenCalled();
        });

        it('should report collisions but not respond to them if the collision behavior is ghost', () => {
            physics.addShape('shape1', { type: BodyShapeType.SPHERE, radius: 0.5 });
            physics.addRigidBody('body1', 'shape1', RigidBodyType.Dynamic, { mass: 1 });
            physics.setRigidBodyCollisionBehavior('body1', CollisionBehavior.Ghost);

            physics.addShape('shape2', { type: BodyShapeType.SPHERE, radius: 0.5 });
            physics.addRigidBody('body2', 'shape2', RigidBodyType.Dynamic, { mass: 1 });
            physics.setRigidBodyPosition('body2', { x: 1.5, y: 0, z: 0 });
            physics.setRigidBodyLinearVelocity('body2', { x: -1, y: 0, z: 0 });

            const onCollision = vi.fn();
            physics.simulate(onCollision);
            physics.simulate(onCollision);

            // The collision should have been reported
            expect(onCollision).toHaveBeenCalled();

            // But the ghost object (body1) should not have moved
            expect(physics.getRigidBodyPosition('body1')?.x).toBe(0);
        });

        describe('velocity', () => {
            it('prevents a fast CCD body from tunneling through a thin static wall', async () => {
                physics = await makePhysics(0);
                physics.stepDuration = 1 / 60;
                physics.addShape('wall-shape', { type: BodyShapeType.BOX, width: 0.1, height: 10, length: 10 });
                physics.addRigidBody('wall', 'wall-shape', RigidBodyType.Static, { mass: 0 });
                physics.addShape('projectile-shape', { type: BodyShapeType.SPHERE, radius: 0.1 });
                physics.addRigidBody('projectile', 'projectile-shape', RigidBodyType.Dynamic, {
                    mass: 1,
                    ccd: true,
                    position: {x: -2, y: 0, z: 0},
                });
                physics.setRigidBodyLinearVelocity('projectile', {x: 300, y: 0, z: 0});

                physics.simulate();

                const position = physics.getRigidBodyPosition('projectile');
                expect(position?.x ?? Infinity).toBeLessThan(0.2);
            });

            it('setRigidBodyLinearVelocity + getRigidBodyLinearVelocity round-trip', async () => {
                physics = await makePhysics(0);
                physics.stepDuration = 1;
                physics.addShape('shape1', { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                physics.addRigidBody('body1', 'shape1', RigidBodyType.Dynamic, { mass: 1 });
                physics.setRigidBodyLinearVelocity('body1', { x: 2, y: 0, z: 0 });

                const velBefore = physics.getRigidBodyLinearVelocity('body1');
                expectCloseTo(velBefore?.x ?? 0, 2);

                physics.simulate();
                const position = physics.getRigidBodyPosition('body1');
                expectCloseTo(position?.x ?? 0, 2);
            });

            it('getRigidBodyLinearVelocity returns null for a non-existent body', () => {
                expect(physics.getRigidBodyLinearVelocity('nope')).toBeNull();
            });

            it('applyImpulseToRigidBody imparts velocity = impulse / mass', async () => {
                physics = await makePhysics(0);
                physics.stepDuration = 1 / 60;
                physics.addShape('shape1', { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                physics.addRigidBody('body1', 'shape1', RigidBodyType.Dynamic, { mass: 2 });
                physics.applyImpulseToRigidBody('body1', { x: 4, y: 0, z: 0 });
                physics.simulate();

                const vel = physics.getRigidBodyLinearVelocity('body1');
                expectCloseTo(vel?.x ?? 0, 2);
            });

            it('setRigidBodyAngularVelocity + getRigidBodyAngularVelocity round-trip', async () => {
                physics = await makePhysics(0);
                physics.stepDuration = 1 / 60;
                physics.addShape('shape1', { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                physics.addRigidBody('body1', 'shape1', RigidBodyType.Dynamic, { mass: 1 });
                physics.setRigidBodyAngularVelocity('body1', { x: 0, y: Math.PI, z: 0 });

                const angularVel = physics.getRigidBodyAngularVelocity('body1');
                expectCloseTo(angularVel?.y ?? 0, Math.PI);

                // Simulate a handful of frames — rotation should progress.
                for (let i = 0; i < 10; i++) physics.simulate();
                const rotation = physics.getRigidBodyRotation('body1');
                expect(Math.abs(rotation?.y ?? 0)).toBeGreaterThan(0.1);
            });
        });

        describe('damping', () => {
            it('linear damping decays linear velocity over time', async () => {
                physics = await makePhysics(0);
                physics.stepDuration = 1 / 60;
                physics.addShape('shape1', { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                physics.addRigidBody('body1', 'shape1', RigidBodyType.Dynamic, { mass: 1 });
                physics.setRigidBodyLinearVelocity('body1', { x: 10, y: 0, z: 0 });
                physics.setRigidBodyLinearDamping('body1', 5);

                for (let i = 0; i < 120; i++) physics.simulate();

                // Large damping over 2 seconds should decay the velocity
                // significantly. Engines differ on exact decay curve, so
                // just assert it's been cut at least in half.
                const vel = physics.getRigidBodyLinearVelocity('body1');
                expect(Math.abs(vel?.x ?? 0)).toBeLessThan(5);
            });

            it('angular damping decays angular velocity over time', async () => {
                physics = await makePhysics(0);
                physics.stepDuration = 1 / 60;
                physics.addShape('shape1', { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                physics.addRigidBody('body1', 'shape1', RigidBodyType.Dynamic, { mass: 1 });
                physics.setRigidBodyAngularVelocity('body1', { x: 0, y: 10, z: 0 });
                physics.setRigidBodyAngularDamping('body1', 5);

                for (let i = 0; i < 120; i++) physics.simulate();

                const angVel = physics.getRigidBodyAngularVelocity('body1');
                expect(Math.abs(angVel?.y ?? 0)).toBeLessThan(5);
            });
        });

        describe('rotation lock', () => {
            it('locks rotation when all axes are locked, even under off-center impulse', async () => {
                physics = await makePhysics(0);
                physics.stepDuration = 1 / 60;
                physics.addShape('shape1', { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                physics.addRigidBody('body1', 'shape1', RigidBodyType.Dynamic, { mass: 1 });
                physics.setRigidBodyRotationLock('body1', { x: true, y: true, z: true });
                // Off-center impulse — would normally torque the body.
                // With all axes locked, it must only translate.
                physics.applyImpulseToRigidBody(
                    'body1',
                    { x: 0, y: 0, z: 5 },
                    { x: 0, y: 1, z: 0 },
                );

                for (let i = 0; i < 60; i++) physics.simulate();

                const rotation = physics.getRigidBodyRotation('body1');
                const imag = Math.abs(rotation?.x ?? 0) +
                    Math.abs(rotation?.y ?? 0) +
                    Math.abs(rotation?.z ?? 0);
                expect(
                    imag,
                    `rotation deviated from identity: ${JSON.stringify(rotation)}`,
                ).toBeLessThan(0.1);
            });
        });

        describe('setRigidBodyScale', () => {
            it('supports native static heightfields in both backends', () => {
                physics.addShape('terrain-shape', {
                    type: BodyShapeType.HEIGHTFIELD,
                    rows: 4,
                    columns: 4,
                    sampleCount: 4,
                    heightSamples: new Array(16).fill(0),
                    offset: {x: 0, y: 0, z: 0},
                    scale: {x: 10, y: 1, z: 10},
                });
                physics.addRigidBody('terrain', 'terrain-shape', RigidBodyType.Static);

                physics.addShape('height-probe-shape', { type: BodyShapeType.SPHERE, radius: 0.25 });
                physics.addRigidBody('height-probe', 'height-probe-shape', RigidBodyType.Dynamic, { mass: 1 });
                physics.setRigidBodyPosition('height-probe', {x: 0, y: 4, z: 0});

                physics.stepDuration = 1 / 60;
                for (let i = 0; i < 240; i++) physics.simulate();

                const probeY = physics.getRigidBodyPosition('height-probe')?.y ?? 0;
                expect(probeY, `heightfield probe rested at y=${probeY}`).toBeGreaterThan(0.2);
                expect(probeY).toBeLessThan(0.8);
            });

            it('preserves an asymmetric heightfield peak at the shared center sample', () => {
                // This catches row/column swaps and fallback seam regressions
                // that a flat terrain test cannot see. The center sample is
                // one metre above the surrounding 3×3 grid, so the probe
                // should settle on that authored peak in both backends.
                physics.addShape('peak-terrain-shape', {
                    type: BodyShapeType.HEIGHTFIELD,
                    rows: 3,
                    columns: 3,
                    sampleCount: 3,
                    heightSamples: [0, 0, 0, 0, 1, 0, 0, 0, 0],
                    offset: {x: 0, y: 0, z: 0},
                    scale: {x: 4, y: 1, z: 4},
                });
                physics.addRigidBody('peak-terrain', 'peak-terrain-shape', RigidBodyType.Static);
                expect(physics.getRigidBodyPosition('peak-terrain')?.y ?? Infinity).toBeCloseTo(0, 5);
                physics.setRigidBodyPosition('peak-terrain', {x: 0, y: 2, z: 0});
                expect(physics.getRigidBodyPosition('peak-terrain')?.y ?? Infinity).toBeCloseTo(2, 5);
                physics.setRigidBodyPosition('peak-terrain', {x: 0, y: 0, z: 0});
                physics.addShape('peak-probe-shape', {type: BodyShapeType.SPHERE, radius: 0.1});
                physics.addRigidBody('peak-probe', 'peak-probe-shape', RigidBodyType.Dynamic, {mass: 1});
                physics.setRigidBodyPosition('peak-probe', {x: 0, y: 4, z: 0});

                physics.stepDuration = 1 / 60;
                for (let i = 0; i < 240; i++) physics.simulate();

                const probeY = physics.getRigidBodyPosition('peak-probe')?.y ?? 0;
                expect(probeY, `heightfield peak probe rested at y=${probeY}`).toBeGreaterThan(0.9);
                expect(probeY).toBeLessThan(1.35);
            });

            it('scales the collider so a probe rests at the scaled surface', () => {
                // Engine-level regression for the "giant box" bug: a
                // 10×1×10 static floor scaled by 0.1 must collide as a
                // 1×0.1×1 box, not as a raw 10m floor.
                physics.addShape('floor-shape', { type: BodyShapeType.BOX, width: 10, height: 1, length: 10 });
                physics.addRigidBody('floor', 'floor-shape', RigidBodyType.Static);
                physics.setRigidBodyPosition('floor', { x: 0, y: 0, z: 0 });
                physics.setRigidBodyScale('floor', { x: 0.1, y: 0.1, z: 0.1 });

                physics.addShape('probe-shape', { type: BodyShapeType.BOX, width: 0.2, height: 0.2, length: 0.2 });
                physics.addRigidBody('probe', 'probe-shape', RigidBodyType.Dynamic, { mass: 1 });
                physics.setRigidBodyPosition('probe', { x: 0, y: 3, z: 0 });

                physics.stepDuration = 1 / 60;
                for (let i = 0; i < 240; i++) physics.simulate();

                // Scaled floor top is at y=0.05 → probe settles near y≈0.15.
                // If scale is ignored, floor top would be at y=0.5.
                const probeY = physics.getRigidBodyPosition('probe')?.y ?? 0;
                expect(probeY, `probe rested at y=${probeY}; expected ≈0.15 (scale applied)`).toBeGreaterThan(0);
                expect(probeY).toBeLessThan(0.3);
            });

            describe('uniform scale by primitive shape type', () => {
                // For each primitive shape, apply a uniform 2× scale to
                // a static body at the origin and drop a small probe
                // straight down onto it. The Y at which the probe first
                // makes contact tells us the scaled collider's actual
                // top — if setRigidBodyScale didn't take effect, the
                // probe would fall further before contact.

                const dropProbeAndMeasureFirstContactY = (): number => {
                    physics.addShape('probe-shape', { type: BodyShapeType.SPHERE, radius: 0.1 });
                    physics.addRigidBody('probe', 'probe-shape', RigidBodyType.Dynamic, { mass: 1 });
                    physics.setRigidBodyPosition('probe', { x: 0, y: 8, z: 0 });

                    physics.stepDuration = 1 / 60;
                    let firstContactY = Infinity;
                    for (let i = 0; i < 240 && !Number.isFinite(firstContactY); i++) {
                        physics.simulate((e) => {
                            if (e.started && !Number.isFinite(firstContactY) &&
                                (e.uuid1 === 'probe' || e.uuid2 === 'probe')) {
                                firstContactY = physics.getRigidBodyPosition('probe')?.y ?? Infinity;
                            }
                        });
                    }
                    return firstContactY;
                };

                it('box: 2× scale doubles the collider half-extent along Y', () => {
                    // Box width=height=length=1 → half-extent 0.5; scaled
                    // 2× → half-extent 1. Top at y=1; probe (r=0.1)
                    // contacts at y≈1.1.
                    physics.addShape('test-shape', { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                    physics.addRigidBody('test', 'test-shape', RigidBodyType.Static);
                    physics.setRigidBodyScale('test', { x: 2, y: 2, z: 2 });

                    const contactY = dropProbeAndMeasureFirstContactY();
                    expect(
                        contactY,
                        `expected ≈1.1 (scaled box top ≈ 1, probe r=0.1); got ${contactY}`,
                    ).toBeGreaterThan(0.9);
                    expect(contactY).toBeLessThan(1.3);
                });

                it('sphere: 2× scale doubles the radius', () => {
                    // Sphere radius 1 → scaled 2× → radius 2. Top at y=2;
                    // probe contacts at y≈2.1.
                    physics.addShape('test-shape', { type: BodyShapeType.SPHERE, radius: 1 });
                    physics.addRigidBody('test', 'test-shape', RigidBodyType.Static);
                    physics.setRigidBodyScale('test', { x: 2, y: 2, z: 2 });

                    const contactY = dropProbeAndMeasureFirstContactY();
                    expect(
                        contactY,
                        `expected ≈2.1 (scaled sphere radius 2, probe r=0.1); got ${contactY}`,
                    ).toBeGreaterThan(1.9);
                    expect(contactY).toBeLessThan(2.3);
                });

                it('capsule: 2× scale doubles radius and cylindrical length', () => {
                    // Capsule radius=1, height=1 (cylindrical segment) →
                    // half-extent Y = height/2 + radius = 1.5. Scaled 2×
                    // → half-extent Y = 3. Probe contacts at y≈3.1.
                    physics.addShape('test-shape', { type: BodyShapeType.CAPSULE, radius: 1, height: 1 });
                    physics.addRigidBody('test', 'test-shape', RigidBodyType.Static);
                    physics.setRigidBodyScale('test', { x: 2, y: 2, z: 2 });

                    const contactY = dropProbeAndMeasureFirstContactY();
                    expect(
                        contactY,
                        `expected ≈3.1 (scaled capsule half-height 3, probe r=0.1); got ${contactY}`,
                    ).toBeGreaterThan(2.9);
                    expect(contactY).toBeLessThan(3.3);
                });
            });

            it('distinct per-body scales do not cross-talk when bodies share a shape', () => {
                // Regression for the Bullet foot-gun: btCollisionShape
                // setLocalScaling is state on the shape itself, so two
                // bodies sharing one shape can stomp each other's
                // scales. Each engine must either clone the shape per
                // body or carry a per-body scale offset.
                //
                // Two 10×1×10 "floors" share the same shape UUID. One
                // is left at scale 1, the other is scaled to 0.1. A
                // probe is dropped onto each; each probe must settle
                // at a height consistent with *its* floor's scale.

                physics.addShape('floor-shape', { type: BodyShapeType.BOX, width: 10, height: 1, length: 10 });

                physics.addRigidBody('bigFloor', 'floor-shape', RigidBodyType.Static);
                physics.setRigidBodyPosition('bigFloor', { x: -20, y: 0, z: 0 });

                physics.addRigidBody('smallFloor', 'floor-shape', RigidBodyType.Static);
                physics.setRigidBodyPosition('smallFloor', { x: 20, y: 0, z: 0 });
                physics.setRigidBodyScale('smallFloor', { x: 0.1, y: 0.1, z: 0.1 });

                physics.addShape('probe-shape', { type: BodyShapeType.BOX, width: 0.2, height: 0.2, length: 0.2 });
                physics.addRigidBody('bigProbe', 'probe-shape', RigidBodyType.Dynamic, { mass: 1 });
                physics.setRigidBodyPosition('bigProbe', { x: -20, y: 3, z: 0 });
                physics.addRigidBody('smallProbe', 'probe-shape', RigidBodyType.Dynamic, { mass: 1 });
                physics.setRigidBodyPosition('smallProbe', { x: 20, y: 3, z: 0 });

                physics.stepDuration = 1 / 60;
                for (let i = 0; i < 240; i++) physics.simulate();

                const bigProbeY = physics.getRigidBodyPosition('bigProbe')?.y ?? NaN;
                const smallProbeY = physics.getRigidBodyPosition('smallProbe')?.y ?? NaN;

                // bigFloor unscaled: top at y=0.5 → probe settles ≈ y=0.6.
                expect(
                    bigProbeY,
                    `unscaled floor probe rested at y=${bigProbeY}; expected ≈0.6. ` +
                    'A low value (≈0.15) means the small floor\'s scale leaked ' +
                    'into the shared shape.',
                ).toBeGreaterThan(0.4);
                expect(bigProbeY).toBeLessThan(0.8);

                // smallFloor scaled 0.1: top at y=0.05 → probe settles ≈ y=0.15.
                expect(
                    smallProbeY,
                    `scaled floor probe rested at y=${smallProbeY}; expected ≈0.15. ` +
                    'A high value (≈0.6) means the small floor ignored its own scale.',
                ).toBeGreaterThan(0);
                expect(smallProbeY).toBeLessThan(0.3);
            });
        });

        describe('setRigidBodyShape', () => {
            it('replaces the collider while preserving position', () => {
                physics.addShape('box-shape', { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                physics.addShape('sphere-shape', { type: BodyShapeType.SPHERE, radius: 2 });
                physics.addRigidBody('body1', 'box-shape', RigidBodyType.Dynamic, { mass: 1 });
                physics.setRigidBodyPosition('body1', { x: 3, y: 5, z: 7 });

                expect(physics.getRigidBodyShapeUuid('body1')).toBe('box-shape');
                physics.setRigidBodyShape('body1', 'sphere-shape');
                expect(physics.getRigidBodyShapeUuid('body1')).toBe('sphere-shape');

                const pos = physics.getRigidBodyPosition('body1');
                expectCloseTo(pos?.x ?? 0, 3);
                expectCloseTo(pos?.y ?? 0, 5);
                expectCloseTo(pos?.z ?? 0, 7);
            });

            it('rejects replacing a dynamic collider with a concave hull', () => {
                const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
                try {
                    physics.addShape('box-shape', { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                    physics.addShape('concave-shape', {
                        type: BodyShapeType.CONCAVE_HULL,
                        vertices: [[0, 0, 0, 1, 0, 0, 0, 1, 0]],
                        indexes: [[0, 1, 2]],
                    });
                    physics.addRigidBody('body1', 'box-shape', RigidBodyType.Dynamic, { mass: 1 });

                    physics.setRigidBodyShape('body1', 'concave-shape');

                    expect(physics.getRigidBodyShapeUuid('body1')).toBe('box-shape');
                    expect(warn).toHaveBeenCalledWith(expect.stringContaining('concave hull'));
                } finally {
                    warn.mockRestore();
                }
            });

            it('rejects replacing a kinematic collider with a concave hull', () => {
                const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
                try {
                    physics.addShape('box-shape', { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                    physics.addShape('concave-shape', {
                        type: BodyShapeType.CONCAVE_HULL,
                        vertices: [[0, 0, 0, 1, 0, 0, 0, 1, 0]],
                        indexes: [[0, 1, 2]],
                    });
                    physics.addRigidBody('body1', 'box-shape', RigidBodyType.Kinematic);

                    physics.setRigidBodyShape('body1', 'concave-shape');

                    expect(physics.getRigidBodyShapeUuid('body1')).toBe('box-shape');
                    expect(warn).toHaveBeenCalledWith(expect.stringContaining('concave hull'));
                } finally {
                    warn.mockRestore();
                }
            });

            it('allows replacing a static collider with a concave hull', () => {
                physics.addShape('box-shape', { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                physics.addShape('concave-shape', {
                    type: BodyShapeType.CONCAVE_HULL,
                    vertices: [[0, 0, 0, 1, 0, 0, 0, 1, 0]],
                    indexes: [[0, 1, 2]],
                });
                physics.addRigidBody('body1', 'box-shape', RigidBodyType.Static);

                physics.setRigidBodyShape('body1', 'concave-shape');

                expect(physics.getRigidBodyShapeUuid('body1')).toBe('concave-shape');
                expect(physics.hasRigidBody('body1')).toBe(true);
            });
        });

        describe('setRigidBodyCollisionMasks', () => {
            it('suppresses collisions when masks do not overlap', async () => {
                physics = await makePhysics(0);
                physics.stepDuration = 1;
                physics.addShape('shape1', { type: BodyShapeType.SPHERE, radius: 0.5 });
                physics.addRigidBody('body1', 'shape1', RigidBodyType.Dynamic, { mass: 1 });
                physics.setRigidBodyCollisionMasks('body1', 0x0001, 0x0001);

                physics.addShape('shape2', { type: BodyShapeType.SPHERE, radius: 0.5 });
                physics.addRigidBody('body2', 'shape2', RigidBodyType.Dynamic, { mass: 1 });
                physics.setRigidBodyPosition('body2', { x: 1.5, y: 0, z: 0 });
                physics.setRigidBodyLinearVelocity('body2', { x: -1, y: 0, z: 0 });
                // body2 on a different group + mask; the two should ignore
                // each other.
                physics.setRigidBodyCollisionMasks('body2', 0x0002, 0x0002);

                const onCollision = vi.fn();
                for (let i = 0; i < 5; i++) physics.simulate(onCollision);

                expect(onCollision).not.toHaveBeenCalled();
            });
        });

        describe('lifecycle', () => {
            it('hasRigidBody and rigidBodyUuids reflect add/remove', () => {
                physics.addShape('shape1', { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                physics.addRigidBody('body1', 'shape1', RigidBodyType.Dynamic, { mass: 1 });
                physics.addRigidBody('body2', 'shape1', RigidBodyType.Dynamic, { mass: 1 });

                expect(physics.hasRigidBody('body1')).toBe(true);
                expect(physics.hasRigidBody('body2')).toBe(true);
                expect(physics.hasRigidBody('nope')).toBe(false);

                const uuids = Array.from(physics.rigidBodyUuids()).sort();
                expect(uuids).toEqual(['body1', 'body2']);

                physics.removeRigidBody('body1');
                expect(physics.hasRigidBody('body1')).toBe(false);
                expect(physics.hasRigidBody('body2')).toBe(true);
                expect(Array.from(physics.rigidBodyUuids())).toEqual(['body2']);
            });

            it('allows re-adding a body with the same uuid after removal', () => {
                physics.addShape('shape1', { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                physics.addRigidBody('body1', 'shape1', RigidBodyType.Dynamic, { mass: 1 });
                physics.setRigidBodyPosition('body1', { x: 5, y: 0, z: 0 });
                physics.removeRigidBody('body1');

                expect(physics.hasRigidBody('body1')).toBe(false);

                physics.addRigidBody('body1', 'shape1', RigidBodyType.Dynamic, { mass: 1 });
                expect(physics.hasRigidBody('body1')).toBe(true);

                // The re-added body starts at origin, not at the pre-remove
                // position — the engine must not leak state across adds.
                const pos = physics.getRigidBodyPosition('body1');
                expectCloseTo(Math.abs(pos?.x ?? 0) + 1, 1);
            });

            it('getters return null for a removed body', () => {
                physics.addShape('shape1', { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                physics.addRigidBody('body1', 'shape1', RigidBodyType.Dynamic, { mass: 1 });
                physics.removeRigidBody('body1');

                expect(physics.getRigidBodyPosition('body1')).toBeNull();
                expect(physics.getRigidBodyRotation('body1')).toBeNull();
                expect(physics.getRigidBodyLinearVelocity('body1')).toBeNull();
                expect(physics.getRigidBodyType('body1')).toBeNull();
                expect(physics.getRigidBodyShapeUuid('body1')).toBeNull();
            });
        });

        describe('pause / resume', () => {
            it('simulate() is a no-op while paused', () => {
                physics.addShape('shape1', { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                physics.addRigidBody('body1', 'shape1', RigidBodyType.Dynamic, { mass: 1 });

                physics.pause();
                for (let i = 0; i < 5; i++) physics.simulate();

                const pos = physics.getRigidBodyPosition('body1');
                expect(pos?.y).toBe(0);
            });

            it('resume re-enables gravity integration', () => {
                physics.addShape('shape1', { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                physics.addRigidBody('body1', 'shape1', RigidBodyType.Dynamic, { mass: 1 });

                physics.pause();
                physics.simulate();
                expect(physics.getRigidBodyPosition('body1')?.y).toBe(0);

                physics.resume();
                physics.simulate();
                expectCloseTo(physics.getRigidBodyPosition('body1')?.y ?? 0, -9.81);
            });
        });

        describe('transform round-trip', () => {
            it('setRigidBodyPosition + getRigidBodyPosition round-trip', () => {
                physics.addShape('shape1', { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                physics.addRigidBody('body1', 'shape1', RigidBodyType.Static);
                physics.setRigidBodyPosition('body1', { x: 3, y: 4, z: -5 });

                const pos = physics.getRigidBodyPosition('body1');
                expectCloseTo(pos?.x ?? 0, 3);
                expectCloseTo(pos?.y ?? 1, 4);
                expectCloseTo(pos?.z ?? 0, -5);
            });

            it('setRigidBodyRotation + getRigidBodyRotation round-trip', () => {
                physics.addShape('shape1', { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                physics.addRigidBody('body1', 'shape1', RigidBodyType.Static);

                // 90° yaw.
                const q = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
                physics.setRigidBodyRotation('body1', q);

                const result = physics.getRigidBodyRotation('body1');
                expect(Math.abs((result?.x ?? 0) - q.x)).toBeLessThan(0.01);
                expect(Math.abs((result?.y ?? 0) - q.y)).toBeLessThan(0.01);
                expect(Math.abs((result?.z ?? 0) - q.z)).toBeLessThan(0.01);
                expect(Math.abs((result?.w ?? 0) - q.w)).toBeLessThan(0.01);
            });
        });

        describe('kinematic body motion', () => {
            it('setRigidBodyPosition on a kinematic body persists after simulate', () => {
                physics.addShape('shape1', { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                physics.addRigidBody('body1', 'shape1', RigidBodyType.Kinematic);
                physics.stepDuration = 1 / 60;

                physics.setRigidBodyPosition('body1', { x: 0, y: 5, z: 0 });
                physics.simulate();

                const pos = physics.getRigidBodyPosition('body1');
                expectCloseTo(pos?.y ?? 0, 5);
            });

            it('tracks continuous setRigidBodyPosition updates across frames', () => {
                physics.addShape('shape1', { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                physics.addRigidBody('body1', 'shape1', RigidBodyType.Kinematic);
                physics.stepDuration = 1 / 60;

                let drift = 0;
                for (let i = 0; i < 30; i++) {
                    const commandedY = i * 0.1;
                    physics.setRigidBodyPosition('body1', { x: 0, y: commandedY, z: 0 });
                    physics.simulate();
                    const reportedY = physics.getRigidBodyPosition('body1')?.y ?? NaN;
                    if (Math.abs(reportedY - commandedY) > 0.01) drift++;
                }
                expect(drift, 'kinematic body failed to track continuous updates').toBe(0);
            });

            it('dynamic body falling onto kinematic body rests on top', () => {
                physics.addShape('floor-shape', { type: BodyShapeType.BOX, width: 10, height: 1, length: 10 });
                physics.addRigidBody('floor', 'floor-shape', RigidBodyType.Kinematic);
                physics.setRigidBodyPosition('floor', { x: 0, y: 0, z: 0 });

                physics.addShape('box-shape', { type: BodyShapeType.BOX, width: 0.5, height: 0.5, length: 0.5 });
                physics.addRigidBody('box', 'box-shape', RigidBodyType.Dynamic, { mass: 1 });
                physics.setRigidBodyPosition('box', { x: 0, y: 3, z: 0 });

                physics.stepDuration = 1 / 60;
                for (let i = 0; i < 240; i++) physics.simulate();

                // Floor top at y=0.5; box center should settle near y≈0.75.
                const boxY = physics.getRigidBodyPosition('box')?.y ?? 0;
                expect(boxY).toBeGreaterThan(0.5);
                expect(boxY).toBeLessThan(1.0);
            });
        });

        describe('solver stability', () => {
            it('keeps a two-body dynamic stack resting on a static floor', async () => {
                physics = await makePhysics(-9.81);
                physics.stepDuration = 1 / 60;
                physics.setSolverIterations?.(8);

                physics.addShape('floor-shape', {
                    type: BodyShapeType.BOX,
                    width: 20,
                    height: 1,
                    length: 20,
                });
                physics.addRigidBody('floor', 'floor-shape', RigidBodyType.Static, {
                    friction: 0.8,
                    restitution: 0,
                    position: {x: 0, y: 0, z: 0},
                });

                physics.addShape('stack-box-shape', {
                    type: BodyShapeType.BOX,
                    width: 1,
                    height: 1,
                    length: 1,
                });
                physics.addRigidBody('stack-bottom', 'stack-box-shape', RigidBodyType.Dynamic, {
                    mass: 1,
                    friction: 0.8,
                    restitution: 0,
                    position: {x: 0, y: 1.25, z: 0},
                });
                physics.addRigidBody('stack-top', 'stack-box-shape', RigidBodyType.Dynamic, {
                    mass: 1,
                    friction: 0.8,
                    restitution: 0,
                    position: {x: 0, y: 2.25, z: 0},
                });

                for (let i = 0; i < 300; i++) physics.simulate();

                const bottom = physics.getRigidBodyPosition('stack-bottom');
                const top = physics.getRigidBodyPosition('stack-top');
                const bottomVelocity = physics.getRigidBodyLinearVelocity('stack-bottom');
                const topVelocity = physics.getRigidBodyLinearVelocity('stack-top');
                expect(bottom).not.toBeNull();
                expect(top).not.toBeNull();
                expect(bottomVelocity).not.toBeNull();
                expect(topVelocity).not.toBeNull();

                for (const [name, position] of [['bottom', bottom], ['top', top]] as const) {
                    expect(
                        position && Object.values(position).every(Number.isFinite),
                        `${name} stack position became non-finite: ${JSON.stringify(position)}`,
                    ).toBe(true);
                    expect(Math.abs(position?.x ?? Infinity), `${name} stack drifted on X`).toBeLessThan(0.2);
                    expect(Math.abs(position?.z ?? Infinity), `${name} stack drifted on Z`).toBeLessThan(0.2);
                }

                // Floor top is y=0.5. Unit boxes should settle near centers
                // y=1 and y=2, with small backend-specific contact slop.
                expect(bottom?.y ?? NaN).toBeGreaterThan(0.85);
                expect(bottom?.y ?? NaN).toBeLessThan(1.2);
                expect(top?.y ?? NaN).toBeGreaterThan(1.75);
                expect(top?.y ?? NaN).toBeLessThan(2.25);
                expect(Math.abs(bottomVelocity?.y ?? Infinity), 'bottom stack body is still moving vertically').toBeLessThan(0.5);
                expect(Math.abs(topVelocity?.y ?? Infinity), 'top stack body is still moving vertically').toBeLessThan(0.5);
            });
        });

        describe('RigidBodyOptions honored at creation', () => {
            it('initial position is applied at creation', () => {
                physics.addShape('shape1', { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                physics.addRigidBody('body1', 'shape1', RigidBodyType.Static, {
                    position: { x: 2, y: 3, z: -4 },
                });
                const pos = physics.getRigidBodyPosition('body1');
                expectCloseTo(pos?.x ?? 0, 2);
                expectCloseTo(pos?.y ?? 0, 3);
                expectCloseTo(pos?.z ?? 0, -4);
            });

            it('initial quaternion is applied at creation', () => {
                physics.addShape('shape1', { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                const q = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
                physics.addRigidBody('body1', 'shape1', RigidBodyType.Static, {
                    quaternion: q,
                });
                const result = physics.getRigidBodyRotation('body1');
                expect(Math.abs((result?.x ?? 0) - q.x)).toBeLessThan(0.01);
                expect(Math.abs((result?.y ?? 0) - q.y)).toBeLessThan(0.01);
                expect(Math.abs((result?.z ?? 0) - q.z)).toBeLessThan(0.01);
                expect(Math.abs((result?.w ?? 0) - q.w)).toBeLessThan(0.01);
            });

            it('linearDamping at creation decays velocity', async () => {
                physics = await makePhysics(0);
                physics.stepDuration = 1 / 60;
                physics.addShape('shape1', { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                physics.addRigidBody('body1', 'shape1', RigidBodyType.Dynamic, {
                    mass: 1,
                    linearDamping: 5,
                });
                physics.setRigidBodyLinearVelocity('body1', { x: 10, y: 0, z: 0 });

                for (let i = 0; i < 120; i++) physics.simulate();

                const vel = physics.getRigidBodyLinearVelocity('body1');
                expect(Math.abs(vel?.x ?? 0)).toBeLessThan(5);
            });

            it('restitution at creation makes a ball bounce back', async () => {
                physics = await makePhysics(-20);
                physics.stepDuration = 1 / 60;
                physics.addShape('floor-shape', { type: BodyShapeType.BOX, width: 10, height: 1, length: 10 });
                physics.addRigidBody('floor', 'floor-shape', RigidBodyType.Static, {
                    restitution: 1,
                    position: { x: 0, y: -1, z: 0 },
                });

                physics.addShape('ball-shape', { type: BodyShapeType.SPHERE, radius: 0.25 });
                physics.addRigidBody('ball', 'ball-shape', RigidBodyType.Dynamic, {
                    mass: 1,
                    restitution: 1,
                });
                physics.setRigidBodyPosition('ball', { x: 0, y: 2, z: 0 });

                // Simulate long enough for the ball to bounce at least once.
                let peakYAfterImpact = -Infinity;
                let sawImpact = false;
                let previousY = 2;
                for (let i = 0; i < 240; i++) {
                    physics.simulate();
                    const y = physics.getRigidBodyPosition('ball')?.y ?? 0;
                    // Impact = first time y stops descending.
                    if (!sawImpact && y > previousY) sawImpact = true;
                    if (sawImpact && y > peakYAfterImpact) peakYAfterImpact = y;
                    previousY = y;
                }

                expect(sawImpact, 'ball never bounced').toBe(true);
                // Post-bounce peak should be meaningfully above the floor.
                expect(peakYAfterImpact).toBeGreaterThan(0);
            });

            it('friction at creation slows a sliding box', async () => {
                physics = await makePhysics(-20);
                physics.stepDuration = 1 / 60;
                physics.addShape('floor-shape', { type: BodyShapeType.BOX, width: 20, height: 1, length: 20 });
                physics.addRigidBody('floor', 'floor-shape', RigidBodyType.Static, {
                    friction: 1,
                    position: { x: 0, y: -1, z: 0 },
                });

                physics.addShape('box-shape', { type: BodyShapeType.BOX, width: 0.5, height: 0.5, length: 0.5 });
                physics.addRigidBody('box', 'box-shape', RigidBodyType.Dynamic, {
                    mass: 1,
                    friction: 1,
                });
                physics.setRigidBodyPosition('box', { x: 0, y: -0.2, z: 0 });
                physics.setRigidBodyLinearVelocity('box', { x: 10, y: 0, z: 0 });

                for (let i = 0; i < 120; i++) physics.simulate();

                // With unit friction the box should have decelerated
                // considerably from its initial 10 m/s.
                const vel = physics.getRigidBodyLinearVelocity('box');
                expect(Math.abs(vel?.x ?? 0)).toBeLessThan(10);
            });

            it('collisionGroup / collisionMask at creation gate collisions', async () => {
                physics = await makePhysics(0);
                physics.stepDuration = 1;
                physics.addShape('shape1', { type: BodyShapeType.SPHERE, radius: 0.5 });
                physics.addRigidBody('body1', 'shape1', RigidBodyType.Dynamic, {
                    mass: 1,
                    collisionGroup: 0x0001,
                    collisionMask: 0x0001,
                });
                physics.addShape('shape2', { type: BodyShapeType.SPHERE, radius: 0.5 });
                physics.addRigidBody('body2', 'shape2', RigidBodyType.Dynamic, {
                    mass: 1,
                    collisionGroup: 0x0002,
                    collisionMask: 0x0002,
                });
                physics.setRigidBodyPosition('body2', { x: 1.5, y: 0, z: 0 });
                physics.setRigidBodyLinearVelocity('body2', { x: -1, y: 0, z: 0 });

                const onCollision = vi.fn();
                for (let i = 0; i < 5; i++) physics.simulate(onCollision);

                expect(onCollision).not.toHaveBeenCalled();
            });
        });

        describe('asymmetric collision masks', () => {
            it('a one-sided mask mismatch filters the pair out', async () => {
                // Both symmetric-AND (Bullet, Rapier) and asymmetric-OR
                // engines must cull the pair when one side's mask
                // excludes the other's group. body1 sees group 2
                // (accepts body2), body2 sees nothing → pair is
                // filtered.
                physics = await makePhysics(0);
                physics.stepDuration = 1;
                physics.addShape('shape1', { type: BodyShapeType.SPHERE, radius: 0.5 });
                physics.addRigidBody('body1', 'shape1', RigidBodyType.Dynamic, {
                    mass: 1,
                    collisionGroup: 0x0001,
                    collisionMask: 0x0002,
                });
                physics.addShape('shape2', { type: BodyShapeType.SPHERE, radius: 0.5 });
                physics.addRigidBody('body2', 'shape2', RigidBodyType.Dynamic, {
                    mass: 1,
                    collisionGroup: 0x0002,
                    collisionMask: 0x0000,
                });
                physics.setRigidBodyPosition('body2', { x: 1.5, y: 0, z: 0 });
                physics.setRigidBodyLinearVelocity('body2', { x: -1, y: 0, z: 0 });

                const onCollision = vi.fn();
                for (let i = 0; i < 5; i++) physics.simulate(onCollision);

                expect(onCollision).not.toHaveBeenCalled();
            });
        });

        describe('multiple simultaneous collisions', () => {
            it('reports collisions for all overlapping pairs', () => {
                physics.stepDuration = 1;
                // Central body with three bodies converging from different
                // directions, all hitting it in the same simulate step.
                physics.addShape('center-shape', { type: BodyShapeType.SPHERE, radius: 0.5 });
                physics.addRigidBody('center', 'center-shape', RigidBodyType.Dynamic, { mass: 1 });

                const spokes = [
                    { uuid: 'a', pos: { x: 1.2, y: 0, z: 0 }, vel: { x: -2, y: 0, z: 0 } },
                    { uuid: 'b', pos: { x: -1.2, y: 0, z: 0 }, vel: { x: 2, y: 0, z: 0 } },
                    { uuid: 'c', pos: { x: 0, y: 0, z: 1.2 }, vel: { x: 0, y: 0, z: -2 } },
                ];
                for (const s of spokes) {
                    physics.addShape(`${s.uuid}-shape`, { type: BodyShapeType.SPHERE, radius: 0.5 });
                    physics.addRigidBody(s.uuid, `${s.uuid}-shape`, RigidBodyType.Dynamic, { mass: 1 });
                    physics.setRigidBodyPosition(s.uuid, s.pos);
                    physics.setRigidBodyLinearVelocity(s.uuid, s.vel);
                }

                const collisions = new Set<string>();
                const onCollision = vi.fn((e) => {
                    if (e.started && (e.uuid1 === 'center' || e.uuid2 === 'center')) {
                        const other = e.uuid1 === 'center' ? e.uuid2 : e.uuid1;
                        collisions.add(other);
                    }
                });
                for (let i = 0; i < 3; i++) physics.simulate(onCollision);

                expect(
                    Array.from(collisions).sort(),
                    `expected center to collide with a, b, c; got ${Array.from(collisions).join(',')}`,
                ).toEqual(['a', 'b', 'c']);
            });
        });
    });

    describe('shapes', () => {
        describe('shape lifecycle', () => {
            it('hasShape reflects add/remove', () => {
                expect(physics.hasShape('shape1')).toBe(false);
                physics.addShape('shape1', { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                expect(physics.hasShape('shape1')).toBe(true);
                physics.removeShape('shape1');
                expect(physics.hasShape('shape1')).toBe(false);
            });

            it('addShape with an existing uuid is idempotent', () => {
                physics.addShape('shape1', { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                // A second add with the same uuid should not throw.
                physics.addShape('shape1', { type: BodyShapeType.SPHERE, radius: 2 });
                expect(physics.hasShape('shape1')).toBe(true);

                // The original box shape is still usable.
                physics.addRigidBody('body1', 'shape1', RigidBodyType.Dynamic, { mass: 1 });
                expect(physics.hasRigidBody('body1')).toBe(true);
            });

            it('removeShape while a body still uses the shape defers destruction', () => {
                physics.addShape('shape1', { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                physics.addRigidBody('body1', 'shape1', RigidBodyType.Dynamic, { mass: 1 });

                // Request removal; the shape must remain available to the
                // live body until that body is removed.
                physics.removeShape('shape1');
                expect(physics.hasShape('shape1')).toBe(true);

                // Simulating should not crash — the shape is still in use.
                physics.simulate();
                expect(physics.getRigidBodyPosition('body1')).not.toBeNull();

                // After removing the body, the shape should be gone too.
                physics.removeRigidBody('body1');
                expect(physics.hasShape('shape1')).toBe(false);
            });
        });

        describe('smoke tests', () => {
            // These tests are simply to make sure we can create and destroy all
            // the shape types without throwing exceptions. This is important
            // for implementations built on native code that require careful
            // management of memory.
            it(`should create and destroy a box shape`, () => {
                const boxData = { type: BodyShapeType.BOX as const, width: 1, height: 1, length: 1 };
                physics.addShape('shape1', boxData);
                physics.addRigidBody('body1', 'shape1', RigidBodyType.Dynamic, { mass: 1 });
                physics.removeRigidBody('body1');
            });

            it(`should create and destroy a capsule shape`, () => {
                const capsuleData = { type: BodyShapeType.CAPSULE as const, radius: 1, height: 1 };
                physics.addShape('shape1', capsuleData);
                physics.addRigidBody('body1', 'shape1', RigidBodyType.Dynamic, { mass: 1 });
                physics.removeRigidBody('body1');
            });

            it(`should create and destroy a sphere shape`, () => {
                const sphereData = { type: BodyShapeType.SPHERE as const, radius: 1 };
                physics.addShape('shape1', sphereData);
                physics.addRigidBody('body1', 'shape1', RigidBodyType.Dynamic, { mass: 1 });
                physics.removeRigidBody('body1');
            });

            it(`should create and destroy a convex hull shape`, () => {
                const vertices = [0, 0, 0, 1, 0, 0, 0, 1, 0];
                const convexHullData = { type: BodyShapeType.CONVEX_HULL as const, vertices };
                physics.addShape('shape1', convexHullData);
                physics.addRigidBody('body1', 'shape1', RigidBodyType.Dynamic, { mass: 1 });
                physics.removeRigidBody('body1');
            });

            it(`should create and destroy a concave hull shape`, () => {
                const vertices = [[0, 0, 0, 1, 0, 0, 0, 1, 0]];
                const indexes = [[0, 1, 2]];
                const concaveHullData = { type: BodyShapeType.CONCAVE_HULL as const, vertices, indexes };
                physics.addShape('shape1', concaveHullData);
                // Triangle meshes are fixed-world geometry in the shared
                // Ammo/Rapier contract. Dynamic and kinematic concave bodies
                // are rejected before a backend body is created.
                physics.addRigidBody('body1', 'shape1', RigidBodyType.Static, { mass: 0 });
                expect(physics.hasRigidBody('body1')).toBe(true);
                physics.removeRigidBody('body1');
            });

            it(`rejects a dynamic concave hull before creating a body`, () => {
                const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
                try {
                    physics.addShape('shape1', {
                        type: BodyShapeType.CONCAVE_HULL,
                        vertices: [[0, 0, 0, 1, 0, 0, 0, 1, 0]],
                        indexes: [[0, 1, 2]],
                    });
                    physics.addRigidBody('body1', 'shape1', RigidBodyType.Dynamic, { mass: 1 });

                    expect(physics.hasRigidBody('body1')).toBe(false);
                    expect(warn).toHaveBeenCalledWith(expect.stringContaining('concave hull'));
                    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ConvexHull'));
                } finally {
                    warn.mockRestore();
                }
            });

            it(`rejects a kinematic concave hull before creating a body`, () => {
                const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
                try {
                    physics.addShape('shape1', {
                        type: BodyShapeType.CONCAVE_HULL,
                        vertices: [[0, 0, 0, 1, 0, 0, 0, 1, 0]],
                        indexes: [[0, 1, 2]],
                    });
                    physics.addRigidBody('body1', 'shape1', RigidBodyType.Kinematic, { mass: 0 });

                    expect(physics.hasRigidBody('body1')).toBe(false);
                    expect(warn).toHaveBeenCalledWith(expect.stringContaining('kinematic'));
                } finally {
                    warn.mockRestore();
                }
            });

            it(`should create and destroy a concave hull shape with no vertices`, () => {
                // We had a previous bug where this would cause Ammo.js to crash.
                const vertices = [[]];
                const indexes = [[]];
                const concaveHullData = { type: BodyShapeType.CONCAVE_HULL as const, vertices, indexes };
                physics.addShape('shape1', concaveHullData);
                physics.addRigidBody('body1', 'shape1', RigidBodyType.Dynamic, { mass: 1 });
                physics.removeRigidBody('body1');
            });
        });

        describe('degenerate input', () => {
            // Regressions for mesh validation: engines must fail gracefully
            // (no throw, no wasm trap) when handed broken geometry. Historical
            // breakage on Rapier ranged from `RuntimeError: unreachable` (bad
            // trimesh indices) to `Error: expected instance of OA` (hull
            // computation over NaN / coplanar / too-few-point inputs).

            const addBodyShouldNotThrow = (shape: CollisionShape) => {
                physics.addShape('shape1', shape);
                physics.addRigidBody('body1', 'shape1', RigidBodyType.Dynamic, { mass: 1 });
                physics.simulate();
                physics.removeRigidBody('body1');
            };

            describe('convex hull', () => {
                it('does not crash on empty vertex array', () => {
                    addBodyShouldNotThrow({ type: BodyShapeType.CONVEX_HULL, vertices: [] });
                });

                it('does not crash on fewer than four points', () => {
                    // Three points cannot form a 3D convex hull.
                    addBodyShouldNotThrow({
                        type: BodyShapeType.CONVEX_HULL,
                        vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
                    });
                });

                it('does not crash on NaN vertex coordinates', () => {
                    addBodyShouldNotThrow({
                        type: BodyShapeType.CONVEX_HULL,
                        vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0, NaN, 0, 1],
                    });
                });

                it('does not crash on Infinity vertex coordinates', () => {
                    addBodyShouldNotThrow({
                        type: BodyShapeType.CONVEX_HULL,
                        vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0, Infinity, 0, 1],
                    });
                });

                it('does not crash on all-coplanar points', () => {
                    // All four points on z=0 — no valid 3D hull.
                    addBodyShouldNotThrow({
                        type: BodyShapeType.CONVEX_HULL,
                        vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0],
                    });
                });

                it('does not crash on all-duplicate points', () => {
                    addBodyShouldNotThrow({
                        type: BodyShapeType.CONVEX_HULL,
                        vertices: [1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3],
                    });
                });
            });

            describe('concave hull', () => {
                it('does not crash on NaN vertex coordinates', () => {
                    addBodyShouldNotThrow({
                        type: BodyShapeType.CONCAVE_HULL,
                        vertices: [[0, 0, 0, 1, 0, 0, 0, 1, 0, NaN, 0, 1]],
                        indexes: [[0, 1, 2]],
                    });
                });

                it('does not crash on out-of-bounds indices', () => {
                    // Index 5 references a vertex that doesn't exist (only 3
                    // vertices / 9 floats supplied).
                    addBodyShouldNotThrow({
                        type: BodyShapeType.CONCAVE_HULL,
                        vertices: [[0, 0, 0, 1, 0, 0, 0, 1, 0]],
                        indexes: [[0, 1, 5]],
                    });
                });

                it('does not crash on empty index array with non-empty vertices', () => {
                    addBodyShouldNotThrow({
                        type: BodyShapeType.CONCAVE_HULL,
                        vertices: [[0, 0, 0, 1, 0, 0, 0, 1, 0]],
                        indexes: [[]],
                    });
                });

                it('handles multi-sub-mesh input with cumulative vertex offsets', () => {
                    // Regression: Rapier's index-offset math was broken for
                    // concave hulls with multiple sub-meshes, producing
                    // out-of-bounds indices that crashed the wasm trimesh
                    // constructor with `RuntimeError: unreachable`.
                    addBodyShouldNotThrow({
                        type: BodyShapeType.CONCAVE_HULL,
                        vertices: [
                            [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],  // 4 verts (12 floats)
                            [2, 2, 2, 3, 2, 2, 2, 3, 2, 2, 2, 3],  // 4 verts
                            [5, 5, 5, 6, 5, 5, 5, 6, 5, 5, 5, 6],  // 4 verts
                        ],
                        indexes: [
                            [0, 1, 2, 0, 2, 3],  // sub-mesh 0
                            [0, 1, 2, 0, 2, 3],  // sub-mesh 1 — must offset by 4
                            [0, 1, 2, 0, 2, 3],  // sub-mesh 2 — must offset by 8
                        ],
                    });
                });
            });
        });
    });

};

const relativeError = (expected: number, actual: number) =>
    Math.abs((expected - actual) / expected);

const expectCloseTo = (actual: number, expected: number, maxRelativeError: number = 0.02) => {
    expect(relativeError(expected, actual), `${actual} should be close to ${expected}`).toBeLessThanOrEqual(maxRelativeError);
};
