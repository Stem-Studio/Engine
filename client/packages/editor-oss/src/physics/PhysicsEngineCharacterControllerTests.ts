import { BodyShapeType, CollisionBehavior } from './common/types';
import { DEFAULT_CHARACTER_CONTROLLER_COLLISION_GROUP, DEFAULT_RIGID_BODY_COLLISION_GROUP, PhysicsEngine, RigidBodyType } from './PhysicsEngine';
import { vi } from 'vitest';

/**
 * Shared harness for the engine-facing character-controller API (the new
 * interface defined in
 * `docs/planning/2026-04-20-character-controller-interface.md`). Runs
 * against any `PhysicsEngine` implementation; each engine's test file
 * calls `makeCharacterControllerTests(makeEngine)` alongside
 * `makePhysicsTests` and `makeLegacyPhysicsAdapterTests`.
 * @param makePhysics
 */
export const makeCharacterControllerTests = (
    makePhysics: (gravity: number) => Promise<PhysicsEngine>,
) => {
    describe("character controller native API", () => {
        let physics: PhysicsEngine;

        beforeEach(async () => {
            physics = await makePhysics(-9.8);
            physics.stepDuration = 1 / 60;
            physics.addShape("character-shape", { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
            physics.addCharacterController("character1", "character-shape");
        });

        afterEach(() => {
            physics.dispose();
        });

        it("rejects concave character-controller shapes", () => {
            // Controllers are moving/kinematic collision objects. Keep the
            // same static-only concave invariant as rigid bodies so a mesh
            // cannot silently enter an expensive unsupported path.
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            try {
                physics.addShape("concave-character-shape", {
                    type: BodyShapeType.CONCAVE_HULL,
                    vertices: [[0, 0, 0, 1, 0, 0, 0, 1, 0]],
                    indexes: [[0, 1, 2]],
                });
                physics.addCharacterController("concave-character", "concave-character-shape");

                expect(physics.hasCharacterController("concave-character")).toBe(false);
                expect(warn).toHaveBeenCalledWith(expect.stringContaining("concave hull"));
            } finally {
                warn.mockRestore();
            }
        });

        it("applies gravity via setCharacterControllerGravity (character falls)", () => {
            physics.setCharacterControllerGravity("character1", { x: 0, y: -20, z: 0 });
            for (let i = 0; i < 15; i++) {
                physics.simulate();
            }
            const position = physics.getCharacterControllerPosition("character1");
            expect(position!.y).toBeLessThan(-0.1);
        });

        it("moves horizontally via setCharacterControllerWalkVelocity", () => {
            physics.addShape("floor-shape", { type: BodyShapeType.BOX, width: 20, height: 1, length: 20 });
            physics.addRigidBody("floor", "floor-shape", RigidBodyType.Static, { position: { x: 0, y: -1, z: 0 } });
            physics.setCharacterControllerGravity("character1", { x: 0, y: -10, z: 0 });

            for (let i = 0; i < 60; i++) {
                physics.setCharacterControllerWalkVelocity("character1", { x: 2, y: 0, z: 0 });
                physics.simulate();
            }
            const position = physics.getCharacterControllerPosition("character1");
            // 2 m/s × 1 s = 2 m. Engines may leave a small error; allow
            // a wide tolerance.
            expect(position!.x).toBeGreaterThan(1.5);
            expect(position!.x).toBeLessThan(2.5);
        });

        it("jumpCharacterController raises the character off the ground", () => {
            physics.addShape("floor-shape", { type: BodyShapeType.BOX, width: 20, height: 1, length: 20 });
            physics.addRigidBody("floor", "floor-shape", RigidBodyType.Static, { position: { x: 0, y: -1, z: 0 } });
            // Place character slightly above the floor so gravity drops
            // them onto it — some engines only register "grounded" after
            // a collision resolution, not for a character that starts
            // exactly touching.
            physics.setCharacterControllerPosition("character1", { x: 0, y: 0.2, z: 0 });
            physics.setCharacterControllerGravity("character1", { x: 0, y: -20, z: 0 });

            // Settle on the floor.
            for (let i = 0; i < 30; i++) {
                physics.simulate();
            }
            const startY = physics.getCharacterControllerPosition("character1")!.y;

            // Jump at 6.32 m/s — matches sqrt(2·20·1) for jumpHeight=1.
            const accepted = physics.jumpCharacterController("character1", 6.32);
            expect(accepted).toBe(true);

            let peakY = startY;
            for (let i = 0; i < 60; i++) {
                physics.setCharacterControllerWalkVelocity("character1", { x: 0, y: 0, z: 0 });
                physics.simulate();
                const y = physics.getCharacterControllerPosition("character1")!.y;
                if (y > peakY) peakY = y;
            }
            expect(peakY - startY).toBeGreaterThan(0.5);
        });

        it("jumpCharacterController returns false when airborne", () => {
            physics.setCharacterControllerGravity("character1", { x: 0, y: -20, z: 0 });
            for (let i = 0; i < 5; i++) {
                physics.simulate();
            }
            const accepted = physics.jumpCharacterController("character1", 6);
            expect(accepted).toBe(false);
        });

        it("jumpCharacterController returns false during an existing jump (no double-jump stacking)", () => {
            // Regression: in an earlier revision, calling jump()
            // repeatedly while the character was rising would stack
            // speeds and launch the character unreasonably high.
            physics.addShape("floor-shape", { type: BodyShapeType.BOX, width: 20, height: 1, length: 20 });
            physics.addRigidBody("floor", "floor-shape", RigidBodyType.Static, { position: { x: 0, y: -1, z: 0 } });
            physics.setCharacterControllerPosition("character1", { x: 0, y: 0.2, z: 0 });
            physics.setCharacterControllerGravity("character1", { x: 0, y: -20, z: 0 });

            for (let i = 0; i < 30; i++) physics.simulate();

            const first = physics.jumpCharacterController("character1", 6);
            expect(first).toBe(true);

            // Step once so the character has lifted off the ground.
            physics.simulate();

            // Second jump while still rising — must be rejected.
            const second = physics.jumpCharacterController("character1", 6);
            expect(second).toBe(false);
        });

        describe("applyImpulseToCharacterController", () => {
            it("raises the character when applied while airborne", () => {
                physics.setCharacterControllerGravity("character1", { x: 0, y: 0, z: 0 });
                const startY = physics.getCharacterControllerPosition("character1")!.y;
                physics.applyImpulseToCharacterController("character1", { x: 0, y: 8, z: 0 });
                for (let i = 0; i < 30; i++) {
                    physics.simulate();
                }
                const endY = physics.getCharacterControllerPosition("character1")!.y;
                // 8 m/s upward for 0.5 s with no gravity: ~4 m rise.
                expect(endY - startY).toBeGreaterThan(1);
            });

            it("combines with gravity for a bounce-pad-style arc", () => {
                physics.addShape("floor-shape", { type: BodyShapeType.BOX, width: 20, height: 1, length: 20 });
                physics.addRigidBody("floor", "floor-shape", RigidBodyType.Static, { position: { x: 0, y: -1, z: 0 } });
                physics.setCharacterControllerPosition("character1", { x: 0, y: 0.2, z: 0 });
                physics.setCharacterControllerGravity("character1", { x: 0, y: -20, z: 0 });

                for (let i = 0; i < 30; i++) {
                    physics.simulate();
                }
                const startY = physics.getCharacterControllerPosition("character1")!.y;

                physics.applyImpulseToCharacterController("character1", { x: 0, y: 6.32, z: 0 });
                let peakY = startY;
                for (let i = 0; i < 60; i++) {
                    physics.simulate();
                    const y = physics.getCharacterControllerPosition("character1")!.y;
                    if (y > peakY) peakY = y;
                }
                // h = v²/2g = 6.32²/40 ≈ 1.0 m. Allow slack.
                expect(peakY - startY).toBeGreaterThan(0.5);
            });
        });

        describe("getCharacterControllerLinearVelocity", () => {
            it("reports y in m/s while free-falling under gravity", () => {
                physics.setCharacterControllerGravity("character1", { x: 0, y: -60, z: 0 });
                const steps = 10;
                for (let i = 0; i < steps; i++) {
                    physics.simulate();
                }
                const velocity = physics.getCharacterControllerLinearVelocity("character1");
                // Euler integration: v = g · N · dt = -60 · 10 · 1/60 = -10 m/s.
                expect(velocity!.y).toBeLessThan(-8);
                expect(velocity!.y).toBeGreaterThan(-12);
            });
        });

        describe("onGround stability", () => {
            const addFloor = () => {
                physics.addShape("floor-shape", { type: BodyShapeType.BOX, width: 20, height: 1, length: 20 });
                physics.addRigidBody("floor", "floor-shape", RigidBodyType.Static, { position: { x: 0, y: -1, z: 0 } });
            };

            it("reports grounded for the full duration of resting on a static floor", () => {
                addFloor();
                physics.setCharacterControllerPosition("character1", { x: 0, y: 0.2, z: 0 });
                physics.setCharacterControllerGravity("character1", { x: 0, y: -20, z: 0 });

                // Settle onto floor.
                for (let i = 0; i < 30; i++) {
                    physics.simulate();
                }

                let airborneFrames = 0;
                const totalFrames = 60;
                for (let i = 0; i < totalFrames; i++) {
                    physics.simulate();
                    if (!physics.isCharacterControllerOnGround("character1")) {
                        airborneFrames++;
                    }
                }
                expect(
                    airborneFrames,
                    `character flickered off ground ${airborneFrames}/${totalFrames} frames while resting`,
                ).toBe(0);
            });

            it("does not sink into the floor across many steps", () => {
                addFloor();
                physics.setCharacterControllerPosition("character1", { x: 0, y: 0.2, z: 0 });
                physics.setCharacterControllerGravity("character1", { x: 0, y: -20, z: 0 });

                // Settle onto floor.
                for (let i = 0; i < 60; i++) {
                    physics.simulate();
                }
                const settledY = physics.getCharacterControllerPosition("character1")!.y;

                for (let i = 0; i < 120; i++) {
                    physics.simulate();
                }
                const finalY = physics.getCharacterControllerPosition("character1")!.y;

                // A resting character shouldn't drift more than ~half a
                // meter over 2 s. Engines that integrate gravity between
                // ground-contact resolutions may drift a small amount
                // under snap, but anything over 0.5 m indicates a real
                // "sinking into the floor" bug.
                expect(Math.abs(finalY - settledY)).toBeLessThan(0.5);
            });

            it("is grounded before a jump and again after landing", () => {
                addFloor();
                physics.setCharacterControllerPosition("character1", { x: 0, y: 0.2, z: 0 });
                physics.setCharacterControllerGravity("character1", { x: 0, y: -20, z: 0 });

                for (let i = 0; i < 30; i++) {
                    physics.simulate();
                }
                expect(physics.isCharacterControllerOnGround("character1")).toBe(true);
                const startY = physics.getCharacterControllerPosition("character1")!.y;

                physics.jumpCharacterController("character1", 6.32);

                // Simulate long enough for a full jump + fall + land arc.
                // h = v²/(2g) = 6.32²/40 ≈ 1 m → ~0.32 s up, ~0.32 s down.
                // Snap-to-ground / computed-grounded semantics vary per
                // engine during the mid-air phase, so we only verify the
                // physics: the character actually rises, and the session
                // returns to a grounded state by the end.
                let peakY = startY;
                for (let i = 0; i < 240; i++) {
                    physics.simulate();
                    const y = physics.getCharacterControllerPosition("character1")!.y;
                    if (y > peakY) peakY = y;
                }

                expect(peakY - startY, "expected physical rise from jump").toBeGreaterThan(0.5);
                expect(
                    physics.isCharacterControllerOnGround("character1"),
                    "expected the character to be grounded again after the jump arc",
                ).toBe(true);
            });
        });

        describe("kinematic platform carry", () => {
            it("stays grounded on an ascending kinematic platform via walkVelocity.y", () => {
                const platformHeight = 0.2;
                let platformY = -0.5 - platformHeight / 2;
                physics.addShape("platform-shape", { type: BodyShapeType.BOX, width: 4, height: platformHeight, length: 4 });
                physics.addRigidBody("platform", "platform-shape", RigidBodyType.Kinematic, {
                    position: { x: 0, y: platformY, z: 0 },
                });
                physics.setCharacterControllerPosition("character1", { x: 0, y: 0.2, z: 0 });
                physics.setCharacterControllerGravity("character1", { x: 0, y: -20, z: 0 });

                // Settle on the platform.
                for (let i = 0; i < 15; i++) {
                    physics.simulate();
                }
                expect(physics.isCharacterControllerOnGround("character1")).toBe(true);

                // Platform rises at 0.84 m/s — matches the known-passing
                // speed the adapter's "speed-adjustment applied" test
                // uses on every engine. Character carry goes through
                // walkVelocity.y (the interface's contract since the
                // separate platform channel was dropped).
                const ascent = 0.84;
                const dt = 1 / 60;
                let airborneFrames = 0;
                const totalFrames = 60;
                for (let i = 0; i < totalFrames; i++) {
                    platformY += ascent * dt;
                    physics.setRigidBodyPosition("platform", { x: 0, y: platformY, z: 0 });
                    physics.setCharacterControllerWalkVelocity("character1", { x: 0, y: ascent, z: 0 });
                    physics.simulate();
                    if (!physics.isCharacterControllerOnGround("character1")) {
                        airborneFrames++;
                    }
                }

                // Allow up to ~15% flicker. Rapier's snap/grounded
                // evaluation takes a frame or two to catch up each time
                // the platform moves; Ammo's Bullet controller rides
                // cleanly. We only want to catch "character falls off
                // the platform entirely" regressions.
                expect(
                    airborneFrames,
                    `character went airborne ${airborneFrames}/${totalFrames} frames on a rising platform`,
                ).toBeLessThan(10);
            });

            it("stays on the platform while walking on a rising platform", () => {
                // Same setup, but the character is walking in +X while
                // the platform ascends. Verifies combined walk + carry
                // via a single setCharacterControllerWalkVelocity call.
                const platformHeight = 0.2;
                let platformY = -0.5 - platformHeight / 2;
                physics.addShape("platform-shape", { type: BodyShapeType.BOX, width: 20, height: platformHeight, length: 20 });
                physics.addRigidBody("platform", "platform-shape", RigidBodyType.Kinematic, {
                    position: { x: 0, y: platformY, z: 0 },
                });
                physics.setCharacterControllerPosition("character1", { x: 0, y: 0.2, z: 0 });
                physics.setCharacterControllerGravity("character1", { x: 0, y: -20, z: 0 });

                for (let i = 0; i < 15; i++) {
                    physics.simulate();
                }
                const startX = physics.getCharacterControllerPosition("character1")!.x;

                const ascent = 0.84;
                const walkSpeed = 2;
                const dt = 1 / 60;
                let airborneFrames = 0;
                const totalFrames = 60;
                for (let i = 0; i < totalFrames; i++) {
                    platformY += ascent * dt;
                    physics.setRigidBodyPosition("platform", { x: 0, y: platformY, z: 0 });
                    physics.setCharacterControllerWalkVelocity("character1", { x: walkSpeed, y: ascent, z: 0 });
                    physics.simulate();
                    if (!physics.isCharacterControllerOnGround("character1")) {
                        airborneFrames++;
                    }
                }

                const endPos = physics.getCharacterControllerPosition("character1")!;
                expect(
                    endPos.x - startX,
                    `character moved only ${(endPos.x - startX).toFixed(2)}m in X during ${totalFrames} frames walking at ${walkSpeed} m/s`,
                ).toBeGreaterThan(walkSpeed * totalFrames * dt * 0.5);
                expect(
                    airborneFrames,
                    `character went airborne ${airborneFrames}/${totalFrames} frames while walking on a rising platform`,
                ).toBeLessThan(10);
            });
        });

        describe("slopes and steps", () => {
            it("does not climb a ramp steeper than maxSlope when walking into it", () => {
                // Floor + an 80° ramp butted up against it. Character walks
                // forward into the ramp base and should stop.
                physics.addShape("floor-shape", { type: BodyShapeType.BOX, width: 10, height: 1, length: 10 });
                physics.addRigidBody("floor", "floor-shape", RigidBodyType.Static, { position: { x: 0, y: -1, z: 0 } });

                const slopeDeg = 80;
                const slopeRad = (slopeDeg * Math.PI) / 180;
                const half = -slopeRad / 2;
                const rampRotation = { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };

                physics.addShape("ramp-shape", { type: BodyShapeType.BOX, width: 10, height: 1, length: 10 });
                physics.addRigidBody("ramp", "ramp-shape", RigidBodyType.Static, {
                    position: { x: 5, y: 0, z: 0 },
                    quaternion: rampRotation,
                });

                physics.setCharacterControllerPosition("character1", { x: 0, y: 0.2, z: 0 });
                physics.setCharacterControllerGravity("character1", { x: 0, y: -20, z: 0 });
                physics.setCharacterControllerMaxSlope("character1", (60 * Math.PI) / 180);
                physics.setCharacterControllerStepHeight("character1", 0.1);

                for (let i = 0; i < 30; i++) {
                    physics.simulate();
                }
                const startY = physics.getCharacterControllerPosition("character1")!.y;

                for (let i = 0; i < 120; i++) {
                    physics.setCharacterControllerWalkVelocity("character1", { x: 4, y: 0, z: 0 });
                    physics.simulate();
                }

                const endY = physics.getCharacterControllerPosition("character1")!.y;
                // Character should be blocked at the base of the 80° ramp,
                // not climbing up it. Allow a small numerical drift; a real
                // climb would be many meters given 2 s × 4 m/s at 80°.
                expect(endY - startY).toBeLessThan(0.5);
            });

            it("walks down a gentle ramp and stays grounded", () => {
                const slopeDeg = 20;
                const slopeRad = (slopeDeg * Math.PI) / 180;
                const half = -slopeRad / 2;
                const rampRotation = { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };

                physics.addShape("ramp-shape", { type: BodyShapeType.BOX, width: 20, height: 0.5, length: 10 });
                physics.addRigidBody("ramp", "ramp-shape", RigidBodyType.Static, {
                    position: { x: 0, y: 0, z: 0 },
                    quaternion: rampRotation,
                });

                // Place character near the high end of the ramp, at a height
                // that sits just above the rotated surface at that X.
                const characterX = -5;
                const surfaceYAtX = (0.25 - Math.sin(slopeRad) * characterX) / Math.cos(slopeRad);
                physics.setCharacterControllerPosition("character1", { x: characterX, y: surfaceYAtX + 0.6, z: 0 });
                physics.setCharacterControllerGravity("character1", { x: 0, y: -20, z: 0 });
                physics.setCharacterControllerMaxSlope("character1", (60 * Math.PI) / 180);
                physics.setCharacterControllerStepHeight("character1", 0.1);

                for (let i = 0; i < 10; i++) {
                    physics.simulate();
                }

                let airborne = 0;
                const totalFrames = 60;
                for (let i = 0; i < totalFrames; i++) {
                    physics.setCharacterControllerWalkVelocity("character1", { x: 4, y: 0, z: 0 });
                    physics.simulate();
                    if (!physics.isCharacterControllerOnGround("character1")) airborne++;
                }

                // Allow a couple of flickers — individual engines handle
                // the snap-to-ramp with different latencies — but the
                // character should be grounded the vast majority of the
                // walk.
                expect(
                    airborne,
                    `character airborne on ${airborne}/${totalFrames} frames walking down a ${slopeDeg}° ramp`,
                ).toBeLessThan(totalFrames / 2);
            });

            it("follows the slope walking downward (dy/dx ≈ tan(θ))", () => {
                const slopeDeg = 20;
                const slopeRad = (slopeDeg * Math.PI) / 180;
                const half = -slopeRad / 2;
                const rampRotation = { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };

                physics.addShape("ramp-shape", { type: BodyShapeType.BOX, width: 20, height: 0.5, length: 10 });
                physics.addRigidBody("ramp", "ramp-shape", RigidBodyType.Static, {
                    position: { x: 0, y: 0, z: 0 },
                    quaternion: rampRotation,
                });

                const characterX = -5;
                const surfaceYAtX = (0.25 - Math.sin(slopeRad) * characterX) / Math.cos(slopeRad);
                physics.setCharacterControllerPosition("character1", { x: characterX, y: surfaceYAtX + 0.6, z: 0 });
                physics.setCharacterControllerGravity("character1", { x: 0, y: -20, z: 0 });
                physics.setCharacterControllerMaxSlope("character1", (60 * Math.PI) / 180);
                physics.setCharacterControllerStepHeight("character1", 0.1);

                // Short settle so the character is on the surface.
                for (let i = 0; i < 10; i++) {
                    physics.simulate();
                }
                const startPos = physics.getCharacterControllerPosition("character1")!;

                const walkFrames = 60;
                for (let i = 0; i < walkFrames; i++) {
                    physics.setCharacterControllerWalkVelocity("character1", { x: 4, y: 0, z: 0 });
                    physics.simulate();
                }
                const endPos = physics.getCharacterControllerPosition("character1")!;

                const dx = endPos.x - startPos.x;
                const dy = startPos.y - endPos.y;
                const expectedRatio = Math.tan(slopeRad);
                const actualRatio = dx > 0 ? dy / dx : 0;

                // Accept 80% of the ideal ratio. Looser than "stays
                // grounded" — catches regressions where the character
                // floats along level Y as if the ramp is a horizontal
                // floor (snap-to-ground has failed).
                expect(
                    actualRatio,
                    `on ${slopeDeg}° ramp: dx=${dx.toFixed(3)}, dy=${dy.toFixed(3)}, ` +
                    `expected dy/dx ≈ ${expectedRatio.toFixed(3)}, got ${actualRatio.toFixed(3)}`,
                ).toBeGreaterThan(expectedRatio * 0.8);
            });

            it("steps up onto a ledge shorter than stepHeight", () => {
                // Floor at y=[-1, 0]. Ledge (short step) sitting on the
                // floor with top at y=0.07 — well within a stepHeight
                // of 0.1.
                physics.addShape("floor-shape", { type: BodyShapeType.BOX, width: 20, height: 1, length: 20 });
                physics.addRigidBody("floor", "floor-shape", RigidBodyType.Static, { position: { x: 0, y: -0.5, z: 0 } });

                const stepBoxHeight = 0.14;
                physics.addShape("ledge-shape", { type: BodyShapeType.BOX, width: 2, height: stepBoxHeight, length: 2 });
                physics.addRigidBody("ledge", "ledge-shape", RigidBodyType.Static, {
                    position: { x: 3, y: stepBoxHeight / 2, z: 0 },
                });

                physics.setCharacterControllerPosition("character1", { x: 0, y: 0.6, z: 0 });
                physics.setCharacterControllerGravity("character1", { x: 0, y: -20, z: 0 });
                physics.setCharacterControllerMaxSlope("character1", (60 * Math.PI) / 180);
                physics.setCharacterControllerStepHeight("character1", 0.2);

                for (let i = 0; i < 30; i++) {
                    physics.simulate();
                }
                const startX = physics.getCharacterControllerPosition("character1")!.x;

                for (let i = 0; i < 180; i++) {
                    physics.setCharacterControllerWalkVelocity("character1", { x: 2, y: 0, z: 0 });
                    physics.simulate();
                }
                const endPos = physics.getCharacterControllerPosition("character1")!;

                // Character should have stepped up onto the ledge and
                // walked forward. Ledge top at y=0.14; character center
                // should settle at floor-top + stepBox height + half
                // character height ≈ 0 + 0.14 + 0.5 = 0.64.
                expect(
                    endPos.x,
                    `character ended at x=${endPos.x.toFixed(2)} after walking forward for 3 s; ` +
                    "expected to climb onto the ledge and past x=3",
                ).toBeGreaterThan(startX + 2);
                expect(
                    endPos.y,
                    `character ended at y=${endPos.y.toFixed(2)}; expected ~0.64 (on top of the ledge)`,
                ).toBeGreaterThan(0.4);
            });
        });

        describe("teleport", () => {
            it("setCharacterControllerPosition moves the character immediately", () => {
                physics.setCharacterControllerPosition("character1", { x: 5, y: 2, z: -3 });
                const position = physics.getCharacterControllerPosition("character1");
                expect(position!.x).toBeCloseTo(5, 3);
                expect(position!.y).toBeCloseTo(2, 3);
                expect(position!.z).toBeCloseTo(-3, 3);
            });

            it("teleported position persists after simulate with zero gravity", () => {
                physics.setCharacterControllerGravity("character1", { x: 0, y: 0, z: 0 });
                physics.setCharacterControllerPosition("character1", { x: 5, y: 2, z: -3 });
                physics.simulate();
                const position = physics.getCharacterControllerPosition("character1");
                // Allow a small tolerance — some engines apply a tiny
                // settle nudge on the first step after a teleport.
                expect(Math.abs(position!.x - 5)).toBeLessThan(0.1);
                expect(Math.abs(position!.y - 2)).toBeLessThan(0.1);
                expect(Math.abs(position!.z - -3)).toBeLessThan(0.1);
            });
        });

        describe("rotation", () => {
            // Rotation support is engine-specific. The setter may store the
            // requested rotation or be a documented no-op returning identity,
            // so the shared tests accept either behavior.
            const isIdentity = (q: { x: number; y: number; z: number; w: number }) =>
                Math.abs(q.x) < 1e-3 && Math.abs(q.y) < 1e-3 && Math.abs(q.z) < 1e-3 && Math.abs(q.w - 1) < 1e-3;

            const isClose = (
                a: { x: number; y: number; z: number; w: number },
                b: { x: number; y: number; z: number; w: number },
                tol = 1e-3,
            ) =>
                Math.abs(a.x - b.x) < tol &&
                Math.abs(a.y - b.y) < tol &&
                Math.abs(a.z - b.z) < tol &&
                Math.abs(a.w - b.w) < tol;

            it("getCharacterControllerRotation returns a non-null quaternion for a live controller", () => {
                const q = physics.getCharacterControllerRotation("character1");
                expect(q).not.toBeNull();
                // Quaternion should be roughly unit-length.
                const mag = Math.sqrt(q!.x * q!.x + q!.y * q!.y + q!.z * q!.z + q!.w * q!.w);
                expect(Math.abs(mag - 1)).toBeLessThan(0.01);
            });

            it("setCharacterControllerRotation round-trips the quaternion (or returns identity on engines without rotation support)", () => {
                // 90° rotation around Y.
                const yawQuarter = { x: 0, y: Math.sin(Math.PI / 4), z: 0, w: Math.cos(Math.PI / 4) };
                physics.setCharacterControllerRotation("character1", yawQuarter);
                const q = physics.getCharacterControllerRotation("character1")!;

                expect(
                    isClose(q, yawQuarter) || isIdentity(q),
                    `expected rotation to match ${JSON.stringify(yawQuarter)} or be identity, got ${JSON.stringify(q)}`,
                ).toBe(true);
            });

            it("identity rotation round-trips on every engine", () => {
                // Every engine should be able to accept and return the
                // identity quaternion, even engines that treat
                // setCharacterControllerRotation as a no-op.
                const identity = { x: 0, y: 0, z: 0, w: 1 };
                physics.setCharacterControllerRotation("character1", identity);
                const q = physics.getCharacterControllerRotation("character1")!;
                expect(isIdentity(q)).toBe(true);
            });

            it("getCharacterControllerRotation returns null for a removed controller", () => {
                physics.removeCharacterController("character1");
                const q = physics.getCharacterControllerRotation("character1");
                expect(q).toBeNull();
            });
        });

        describe("lifecycle", () => {
            it("removeCharacterController removes the character from iteration", () => {
                expect(physics.hasCharacterController("character1")).toBe(true);
                physics.removeCharacterController("character1");
                expect(physics.hasCharacterController("character1")).toBe(false);

                const uuids = Array.from(physics.characterControllerUuids());
                expect(uuids).not.toContain("character1");
            });

            it("can re-add a character controller with the same uuid after removal", () => {
                physics.removeCharacterController("character1");
                expect(physics.hasCharacterController("character1")).toBe(false);

                // Re-add using the same shape (shape uuid persists because
                // afterEach disposes the whole engine, not addShape).
                physics.addCharacterController("character1", "character-shape");
                expect(physics.hasCharacterController("character1")).toBe(true);

                // Verify the re-added controller is live and responds to
                // position updates.
                physics.setCharacterControllerPosition("character1", { x: 1, y: 2, z: 3 });
                const position = physics.getCharacterControllerPosition("character1");
                expect(position!.x).toBeCloseTo(1, 3);
                expect(position!.y).toBeCloseTo(2, 3);
                expect(position!.z).toBeCloseTo(3, 3);
            });

            it("removed character controller no longer appears in simulate updates", () => {
                physics.setCharacterControllerPosition("character1", { x: 0, y: 10, z: 0 });
                physics.setCharacterControllerGravity("character1", { x: 0, y: -20, z: 0 });

                physics.removeCharacterController("character1");

                // simulate should not throw for a removed controller.
                for (let i = 0; i < 10; i++) {
                    physics.simulate();
                }

                // Querying position after removal should return null
                // (character no longer exists in the engine's tracking).
                const position = physics.getCharacterControllerPosition("character1");
                expect(position).toBeNull();
            });
        });

        describe("collision behavior", () => {
            it("Ghost: character passes through a rigid body", () => {
                physics.addShape("wall-shape", { type: BodyShapeType.BOX, width: 1, height: 5, length: 5 });
                physics.addRigidBody("wall", "wall-shape", RigidBodyType.Static, { position: { x: 3, y: 0, z: 0 } });
                physics.setCharacterControllerGravity("character1", { x: 0, y: 0, z: 0 });
                physics.setCharacterControllerPosition("character1", { x: 0, y: 0, z: 0 });
                physics.setCharacterControllerCollisionBehavior("character1", CollisionBehavior.Ghost);

                for (let i = 0; i < 180; i++) {
                    physics.setCharacterControllerWalkVelocity("character1", { x: 3, y: 0, z: 0 });
                    physics.simulate();
                }

                const endX = physics.getCharacterControllerPosition("character1")!.x;
                // Ghost walks through → should end well past the wall (x≈3).
                expect(
                    endX,
                    `Ghost character stopped at x=${endX.toFixed(2)}; expected to pass wall at x=3`,
                ).toBeGreaterThan(4);
            });

            it("Regular: character is blocked by a rigid body", () => {
                physics.addShape("wall-shape", { type: BodyShapeType.BOX, width: 1, height: 5, length: 5 });
                physics.addRigidBody("wall", "wall-shape", RigidBodyType.Static, { position: { x: 3, y: 0, z: 0 } });
                physics.setCharacterControllerGravity("character1", { x: 0, y: 0, z: 0 });
                physics.setCharacterControllerPosition("character1", { x: 0, y: 0, z: 0 });
                physics.setCharacterControllerCollisionBehavior("character1", CollisionBehavior.Regular);

                for (let i = 0; i < 180; i++) {
                    physics.setCharacterControllerWalkVelocity("character1", { x: 3, y: 0, z: 0 });
                    physics.simulate();
                }

                const endX = physics.getCharacterControllerPosition("character1")!.x;
                // Wall starts at x = 3 - 0.5 = 2.5; a 1m-wide character
                // centered on x resolves against the wall at x ≈ 2.
                expect(
                    endX,
                    `Regular character passed through wall to x=${endX.toFixed(2)}`,
                ).toBeLessThan(2.5);
            });
        });

        describe("character vs character", () => {
            it("two characters blocking each other do not overlap", () => {
                physics.addShape("character-shape-2", { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                physics.addCharacterController("character2", "character-shape-2");
                physics.setCharacterControllerGravity("character1", { x: 0, y: 0, z: 0 });
                physics.setCharacterControllerGravity("character2", { x: 0, y: 0, z: 0 });
                physics.setCharacterControllerPosition("character1", { x: 0, y: 0, z: 0 });
                physics.setCharacterControllerPosition("character2", { x: 2, y: 0, z: 0 });

                for (let i = 0; i < 120; i++) {
                    physics.setCharacterControllerWalkVelocity("character1", { x: 2, y: 0, z: 0 });
                    physics.setCharacterControllerWalkVelocity("character2", { x: 0, y: 0, z: 0 });
                    physics.simulate();
                }

                const c1 = physics.getCharacterControllerPosition("character1")!;
                const c2 = physics.getCharacterControllerPosition("character2")!;
                const gap = Math.abs(c2.x - c1.x);
                // Two 1m-wide boxes touching at the edge are 1m apart
                // center-to-center. Anything less than 0.9 means they
                // clipped through each other.
                expect(
                    gap,
                    `characters overlapped: c1.x=${c1.x.toFixed(2)}, c2.x=${c2.x.toFixed(2)}, gap=${gap.toFixed(2)}`,
                ).toBeGreaterThan(0.9);
            });
        });

        describe("runtime setting changes", () => {
            it("setCharacterControllerMaxSlope applied at runtime changes climb behavior", () => {
                // 45° ramp. With maxSlope=60° the character can climb;
                // with maxSlope=20° the character should be blocked.
                const slopeDeg = 45;
                const slopeRad = (slopeDeg * Math.PI) / 180;
                const half = slopeRad / 2;
                const rampRotation = { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };

                physics.addShape("ramp-shape", { type: BodyShapeType.BOX, width: 20, height: 0.5, length: 10 });
                physics.addRigidBody("ramp", "ramp-shape", RigidBodyType.Static, {
                    position: { x: 0, y: 0, z: 0 },
                    quaternion: rampRotation,
                });

                const characterX = -5;
                const surfaceYAtX = (0.25 - (-Math.sin(slopeRad)) * characterX) / Math.cos(slopeRad);
                physics.setCharacterControllerPosition("character1", { x: characterX, y: surfaceYAtX + 0.6, z: 0 });
                physics.setCharacterControllerGravity("character1", { x: 0, y: -20, z: 0 });
                physics.setCharacterControllerStepHeight("character1", 0.1);

                // Set a low max slope — walking uphill should be blocked.
                physics.setCharacterControllerMaxSlope("character1", (20 * Math.PI) / 180);

                for (let i = 0; i < 30; i++) physics.simulate();
                const startY = physics.getCharacterControllerPosition("character1")!.y;

                for (let i = 0; i < 120; i++) {
                    physics.setCharacterControllerWalkVelocity("character1", { x: 4, y: 0, z: 0 });
                    physics.simulate();
                }

                const endY = physics.getCharacterControllerPosition("character1")!.y;
                expect(
                    endY - startY,
                    `character climbed ${(endY - startY).toFixed(2)}m uphill on a 45° ramp with maxSlope=20°`,
                ).toBeLessThan(1);
            });

            it("setCharacterControllerStepHeight applied at runtime blocks over-tall steps", () => {
                physics.addShape("floor-shape", { type: BodyShapeType.BOX, width: 20, height: 1, length: 20 });
                physics.addRigidBody("floor", "floor-shape", RigidBodyType.Static, { position: { x: 0, y: -0.5, z: 0 } });

                // Ledge 0.3m tall.
                physics.addShape("ledge-shape", { type: BodyShapeType.BOX, width: 2, height: 0.3, length: 2 });
                physics.addRigidBody("ledge", "ledge-shape", RigidBodyType.Static, {
                    position: { x: 3, y: 0.15, z: 0 },
                });

                physics.setCharacterControllerPosition("character1", { x: 0, y: 0.6, z: 0 });
                physics.setCharacterControllerGravity("character1", { x: 0, y: -20, z: 0 });
                physics.setCharacterControllerMaxSlope("character1", (60 * Math.PI) / 180);
                // Very small step height — can't climb a 0.3m ledge.
                physics.setCharacterControllerStepHeight("character1", 0.05);

                for (let i = 0; i < 30; i++) physics.simulate();
                const startY = physics.getCharacterControllerPosition("character1")!.y;

                for (let i = 0; i < 180; i++) {
                    physics.setCharacterControllerWalkVelocity("character1", { x: 2, y: 0, z: 0 });
                    physics.simulate();
                }

                const endY = physics.getCharacterControllerPosition("character1")!.y;
                // With stepHeight=0.05, a 0.3m ledge is 6× too tall; the
                // character should not have climbed onto it.
                expect(
                    endY - startY,
                    `character climbed ${(endY - startY).toFixed(2)}m onto a 0.3m ledge with stepHeight=0.05`,
                ).toBeLessThan(0.15);
            });
        });

        describe("cross-body collisions", () => {
            it("reports a collision between a rigid body and a character controller", async () => {
                physics = await makePhysics(0);
                physics.stepDuration = 1;

                physics.addShape("shape1", { type: BodyShapeType.SPHERE, radius: 0.5 });
                physics.addCharacterController("character1", "shape1");

                physics.addShape("shape2", { type: BodyShapeType.SPHERE, radius: 0.5 });
                physics.addRigidBody("body1", "shape2", RigidBodyType.Dynamic, { mass: 1 });
                physics.setRigidBodyPosition("body1", { x: 1.5, y: 0, z: 0 });
                physics.setRigidBodyLinearVelocity("body1", { x: -1, y: 0, z: 0 });

                const onCollision = vi.fn();
                physics.simulate(onCollision);
                physics.simulate(onCollision);

                expect(onCollision.mock.calls[0]![0]).toEqual(expect.objectContaining({
                    uuid1: "character1",
                    uuid2: "body1",
                    type1: "characterController",
                    type2: "rigidBody",
                    group1: DEFAULT_CHARACTER_CONTROLLER_COLLISION_GROUP,
                    group2: DEFAULT_RIGID_BODY_COLLISION_GROUP,
                    started: true,
                }));
            });

            it("reports contactPoint and contactNormal on character/rigid-body contact", async () => {
                // Character falls onto a static floor; the resulting
                // collision event should carry a finite contactPoint and
                // a unit-length contactNormal.
                physics = await makePhysics(-20);
                physics.stepDuration = 1 / 60;

                physics.addShape("floor-shape", { type: BodyShapeType.BOX, width: 10, height: 1, length: 10 });
                physics.addRigidBody("floor", "floor-shape", RigidBodyType.Static);
                physics.setRigidBodyPosition("floor", { x: 0, y: -1, z: 0 });

                physics.addShape("char-shape", { type: BodyShapeType.BOX, width: 1, height: 1, length: 1 });
                physics.addCharacterController("character1", "char-shape");
                physics.setCharacterControllerGravity("character1", { x: 0, y: -20, z: 0 });

                const collisions: any[] = [];
                for (let i = 0; i < 30; i++) {
                    physics.simulate((e) => collisions.push(e));
                }

                const withContact = collisions.find(
                    (e) => e.contactPoint && e.contactNormal && e.started,
                );
                expect(
                    withContact,
                    `no collision event carried contactPoint + contactNormal. events: ${JSON.stringify(collisions)}`,
                ).toBeDefined();

                const p = withContact!.contactPoint as { x: number; y: number; z: number };
                const n = withContact!.contactNormal as { x: number; y: number; z: number };

                expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
                expect(Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z)).toBe(true);

                const nLen = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
                expect(nLen).toBeGreaterThan(0.9);
                expect(nLen).toBeLessThan(1.1);
            });
        });
    });
};
