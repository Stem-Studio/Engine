import { Object3D, Vector3, Quaternion, Group, BoxGeometry, MeshBasicMaterial, Mesh, SphereGeometry, CylinderGeometry, Matrix4 } from 'three';
import { vi } from 'vitest';

import { BodyShapeType, IPhysics } from './common/types';
import { PhysicsUtil } from './PhysicsUtil';

describe('PhysicsUtil', () => {
    describe('copyPhysicsConfig', () => {
        it('copies physics config without sharing nested mutable state', () => {
            const from = new Object3D();
            const to = new Object3D();
            from.userData.physics = {
                enabled: true,
                shape: 'btBoxShape',
                anchorOffset: {x: 1, y: 2, z: 3},
                scale: {x: 1, y: 1, z: 1},
                rotationLock: {x: false, y: true, z: false},
            };

            PhysicsUtil.copyPhysicsConfig(from, to);

            expect(to.userData.physics).toEqual(from.userData.physics);
            expect(to.userData.physics).not.toBe(from.userData.physics);
            expect(to.userData.physics.anchorOffset).not.toBe(from.userData.physics.anchorOffset);
            expect(to.userData.physics.rotationLock).not.toBe(from.userData.physics.rotationLock);

            to.userData.physics.anchorOffset.x = 99;
            to.userData.physics.rotationLock.y = false;

            expect(from.userData.physics.anchorOffset.x).toBe(1);
            expect(from.userData.physics.rotationLock.y).toBe(true);
        });

        it('clears target physics when source has no physics config', () => {
            const from = new Object3D();
            const to = new Object3D();
            to.userData.physics = {enabled: true};

            PhysicsUtil.copyPhysicsConfig(from, to);

            expect(to.userData.physics).toBeUndefined();
        });
    });

    describe('calculatePhysicsPositionFromObject', () => {
        const position = new Vector3();
        const quaternion = new Quaternion();
        const scale = new Vector3();

        it('should handle an object with no parent', () => {
            const object = new Object3D();
            object.position.set(1, 2, 3);
            object.rotation.set(Math.PI / 4, 0, 0); // rotate 45° on X
            object.scale.set(1, 1, 1);

            PhysicsUtil.calculatePhysicsPositionFromObject(object, position, quaternion, scale);

            expect(position.distanceTo(object.position)).toBeLessThan(1e-15);
            expect(quaternion.angleTo(object.quaternion)).toBeLessThan(1e-6);

            // The scale should be [1, 1, 1], not the object's local scale,
            // because the local scale is baked into the shape.
            expect(scale.distanceTo(object.scale)).toBeLessThan(1e-15);
        });

        it('should handle an object with a parent that has a non-zero position', () => {
            const object = new Object3D();
            object.position.set(1, 2, 3);
            object.rotation.set(Math.PI / 4, 0, 0); // rotate 45° on X
            object.scale.set(1, 1, 1);

            const parent = new Object3D();
            parent.position.set(7, 8, 9);
            parent.add(object);

            PhysicsUtil.calculatePhysicsPositionFromObject(object, position, quaternion, scale);

            expect(position.distanceTo(new Vector3(8, 10, 12))).toBeLessThan(1e-15);
            expect(quaternion.angleTo(object.quaternion)).toBeLessThan(1e-6);
            expect(scale.distanceTo(object.scale)).toBeLessThan(1e-15);
        });

        it.skip('should handle an object with a parent that has a non-zero rotation', () => {
            const object = new Object3D();
            object.position.set(1, 2, 3);
            object.rotation.set(Math.PI / 4, 0, 0); // rotate 45° on X
            object.scale.set(1, 1, 1);

            const parent = new Object3D();
            parent.rotation.set(Math.PI / 2, 0, 0); // rotate 90° on X
            parent.add(object);

            PhysicsUtil.calculatePhysicsPositionFromObject(object, position, quaternion, scale);

            expect(position.distanceTo(new Vector3(1, -3, 2))).toBeLessThan(1e-15);
            // The parent applies a 90 degree rotation to the object.
            expect(quaternion.angleTo(object.quaternion)).toBeCloseTo(Math.PI / 2, 1e-6);
            expect(scale.distanceTo(object.scale)).toBeLessThan(1e-15);
        });

        it('should handle an object with a parent that has a uniform scale', () => {
            const object = new Object3D();
            object.position.set(1, 2, 3);
            object.rotation.set(Math.PI / 4, 0, 0); // rotate 45° on X
            object.scale.set(1, 1, 1);

            const parent = new Object3D();
            parent.scale.set(2, 2, 2);
            parent.add(object);

            PhysicsUtil.calculatePhysicsPositionFromObject(object, position, quaternion, scale);

            expect(position.distanceTo(new Vector3(2, 4, 6))).toBeLessThan(1e-15);
            expect(quaternion.angleTo(object.quaternion)).toBeLessThan(1e-6);
            expect(scale.distanceTo(new Vector3(2, 2, 2))).toBeLessThan(1e-15);
        });

        it('should handle an object with an anchorOffset', () => {
            const object = new Object3D();
            object.position.set(1, 2, 3);
            object.scale.set(1, 1, 1);

            object.userData.physics = {
                anchorOffset: { x: 7, y: 8, z: 9 },
            };

            PhysicsUtil.calculatePhysicsPositionFromObject(object, position, quaternion, scale);

            // The anchorOffset should be applied to the position. Note that the
            // scale does not affect the anchorOffset because the scale is baked
            // into the shape.
            expect(position.distanceTo(new Vector3(8, 10, 12))).toBeLessThan(1e-15);
            expect(scale.distanceTo(object.scale)).toBeLessThan(1e-15);
        });

        it('should handle an object with an anchorOffset and rotation', () => {
            const object = new Object3D();
            object.position.set(1, 2, 3);
            object.rotation.set(0, Math.PI / 2, 0); // rotate 90° on Y
            object.scale.set(1, 1, 1);

            object.userData.physics = {
                anchorOffset: { x: 1, y: 0, z: 0 },
            };

            PhysicsUtil.calculatePhysicsPositionFromObject(object, position, quaternion, scale);

            // The 90° rotation has the effect of rotating the anchorOffset to
            // [0, 0, -1], which is then applied to the position.
            expect(position.distanceTo(new Vector3(1, 2, 2))).toBeLessThan(1e-15);
            expect(quaternion.angleTo(object.quaternion)).toBeLessThan(1e-6);
            expect(scale.distanceTo(object.scale)).toBeLessThan(1e-15);
        });

        it('should handle a child object with an anchorOffset', () => {
            const object = new Object3D();
            object.position.set(1, 2, 3);
            object.rotation.set(0, Math.PI / 2, 0); // rotate 90° on Y
            object.scale.set(1, 1, 1);

            const parent = new Object3D();
            parent.position.set(7, 8, 9);
            parent.add(object);

            object.userData.physics = {
                anchorOffset: { x: 1, y: 0, z: 0 },
            };

            PhysicsUtil.calculatePhysicsPositionFromObject(object, position, quaternion, scale);

            // The 90° rotation has the effect of rotating the anchorOffset to
            // [0, 0, -1], which is then applied to the position. Additionally,
            // the parent offsets the anchorOffset by its position.
            expect(position.distanceTo(new Vector3(8, 10, 11))).toBeLessThan(1e-15);
            expect(quaternion.angleTo(object.quaternion)).toBeLessThan(1e-6);
            expect(scale.distanceTo(object.scale)).toBeLessThan(1e-15);
        });

        it('should handle an object with an anchorScale', () => {
            const object = new Object3D();
            object.position.set(1, 2, 3);
            object.scale.set(1, 2, 4);

            object.userData.physics = {
                anchorScale: { x: 1, y: 0.5, z: 0.25 },
            };

            PhysicsUtil.calculatePhysicsPositionFromObject(object, position, quaternion, scale);

            expect(position.distanceTo(object.position)).toBeLessThan(1e-15);
            // Scale should be [1, 1, 1] since the scale is "baked" into the
            // shape.
            expect(scale.distanceTo(new Vector3(1, 1, 1))).toBeLessThan(1e-15);
        });

        it('should handle a child object with an anchorScale', () => {
            const object = new Object3D();
            object.scale.set(1, 2, 4);

            const parent = new Object3D();
            parent.scale.set(2, 2, 2);
            parent.add(object);

            object.userData.physics = {
                anchorScale: { x: 1, y: 0.5, z: 0.25 },
            };

            PhysicsUtil.calculatePhysicsPositionFromObject(object, position, quaternion, scale);

            // The scale should be that of the parent because the object's
            // local scale is baked into the shape.
            expect(scale.distanceTo(new Vector3(2, 2, 2))).toBeLessThan(1e-15);
        });
    });

    describe('updateObjectTransformFromPhysics', () => {
        const up = new Vector3(0, 1, 0);

        it('should update an object with no parent', () => {
            const object = new Object3D();
            const worldPosition = new Vector3(1, 2, 3);
            const worldQuaternion = new Quaternion().setFromAxisAngle(up, Math.PI / 2);
            const worldScale = new Vector3(3, 2, 1);
            PhysicsUtil.updateObjectTransformFromPhysics(object, worldPosition, worldQuaternion, worldScale);

            expect(object.position.distanceTo(worldPosition)).toBeLessThan(1e-15);
            expect(object.quaternion.angleTo(worldQuaternion)).toBeLessThan(1e-6);
            expect(object.scale.distanceTo(worldScale)).toBeLessThan(1e-15);
        });

        it('should update an object with a parent that has a non-zero position', () => {
            const object = new Object3D();
            const parent = new Object3D();
            parent.position.set(1, 2, 3);
            parent.add(object);

            const worldPosition = new Vector3(4, 4, 4);
            const worldQuaternion = new Quaternion().setFromAxisAngle(up, Math.PI / 2);
            const worldScale = new Vector3(3, 2, 1);
            PhysicsUtil.updateObjectTransformFromPhysics(object, worldPosition, worldQuaternion, worldScale);

            expect(object.position.distanceTo(new Vector3(3, 2, 1))).toBeLessThan(1e-15);
            expect(object.quaternion.angleTo(worldQuaternion)).toBeLessThan(1e-6);
            expect(object.scale.distanceTo(worldScale)).toBeLessThan(1e-15);
        });

        it.skip('should update an object with a parent that has a non-zero rotation', () => {
            const object = new Object3D();
            const parent = new Object3D();
            parent.rotation.set(0, Math.PI / 2, 0); // rotate 90° on Y
            parent.add(object);

            const worldPosition = new Vector3(0, 1, -1);
            const worldQuaternion = new Quaternion().setFromAxisAngle(up, Math.PI / 2);
            const worldScale = new Vector3(3, 2, 1);
            PhysicsUtil.updateObjectTransformFromPhysics(object, worldPosition, worldQuaternion, worldScale);

            expect(object.position.distanceTo(new Vector3(1, 1, 0))).toBeLessThan(1e-15);
            expect(object.quaternion.angleTo(worldQuaternion)).toBeCloseTo(Math.PI / 2, 1e-6);
            expect(object.scale.distanceTo(worldScale)).toBeLessThan(1e-15);
        });

        it('should update an object with a parent that has a uniform scale', () => {
            const object = new Object3D();
            const parent = new Object3D();
            parent.scale.set(2, 2, 2);
            parent.add(object);

            const worldPosition = new Vector3(2, 4, 6);
            const worldQuaternion = new Quaternion();
            const worldScale = new Vector3(6, 4, 2);
            PhysicsUtil.updateObjectTransformFromPhysics(object, worldPosition, worldQuaternion, worldScale);

            expect(object.position.distanceTo(new Vector3(1, 2, 3))).toBeLessThan(1e-15);
            expect(object.scale.distanceTo(new Vector3(3, 2, 1))).toBeLessThan(1e-15);
        });

        it('should update an object with an anchorOffset', () => {
            const object = new Object3D();
            object.userData.physics = {
                anchorOffset: { x: 1, y: 0, z: 0 },
            };

            const worldPosition = new Vector3(1, 0, 0);
            const worldQuaternion = new Quaternion();
            const worldScale = new Vector3(1, 1, 1);
            PhysicsUtil.updateObjectTransformFromPhysics(object, worldPosition, worldQuaternion, worldScale);

            expect(object.position.distanceTo(new Vector3(0, 0, 0))).toBeLessThan(1e-15);
        });

        it('should update an object with an anchorOffset and world space rotation', () => {
            const object = new Object3D();
            object.userData.physics = {
                anchorOffset: { x: 1, y: 0, z: 0 },
            };

            const worldPosition = new Vector3(0, 0, -1);
            const worldQuaternion = new Quaternion().setFromAxisAngle(up, Math.PI / 2);
            const worldScale = new Vector3(1, 1, 1);
            PhysicsUtil.updateObjectTransformFromPhysics(object, worldPosition, worldQuaternion, worldScale);

            expect(object.position.distanceTo(new Vector3(0, 0, 0))).toBeLessThan(1e-15);
            expect(object.quaternion.angleTo(worldQuaternion)).toBeCloseTo(0, 1e-6);
            expect(object.scale.distanceTo(worldScale)).toBeLessThan(1e-15);
        });

        it('should update a child object with an anchorOffset and parent with a non-zero position', () => {
            const object = new Object3D();
            const parent = new Object3D();
            parent.position.set(0, 2, 0);
            parent.add(object);

            object.userData.physics = {
                anchorOffset: { x: 1, y: 0, z: 0 },
            };

            const worldPosition = new Vector3(1, 2, 0);
            const worldQuaternion = new Quaternion();
            const worldScale = new Vector3(1, 1, 1);
            PhysicsUtil.updateObjectTransformFromPhysics(object, worldPosition, worldQuaternion, worldScale);

            expect(object.position.distanceTo(new Vector3(0, 0, 0))).toBeLessThan(1e-15);
            expect(object.scale.distanceTo(worldScale)).toBeLessThan(1e-15);
        });

        it.skip('should update a child object with an anchorOffset and parent with a non-zero rotation', () => {
            const object = new Object3D();
            const parent = new Object3D();
            parent.rotation.set(0, Math.PI / 2, 0);
            parent.add(object);

            object.userData.physics = {
                anchorOffset: { x: 1, y: 0, z: 0 },
            };

            const worldPosition = new Vector3(-1, 0, 0);
            const worldQuaternion = new Quaternion().setFromAxisAngle(up, Math.PI);
            const worldScale = new Vector3(1, 1, 1);
            PhysicsUtil.updateObjectTransformFromPhysics(object, worldPosition, worldQuaternion, worldScale);

            expect(object.position.distanceTo(new Vector3(0, 0, 0))).toBeLessThan(1e-15);
            expect(object.quaternion.angleTo(worldQuaternion)).toBeCloseTo(Math.PI / 2, 1e-6);
            expect(object.scale.distanceTo(worldScale)).toBeLessThan(1e-15);
        });

        it('should update a child object with an anchorOffset and parent with a uniform scale', () => {
            const object = new Object3D();
            const parent = new Object3D();
            parent.scale.set(2, 2, 2);
            parent.add(object);

            object.userData.physics = {
                anchorOffset: { x: 1, y: 0, z: 0 },
            };

            const worldPosition = new Vector3(2, 4, 6);
            const worldQuaternion = new Quaternion();
            const worldScale = new Vector3(2, 2, 2);
            PhysicsUtil.updateObjectTransformFromPhysics(object, worldPosition, worldQuaternion, worldScale);

            expect(object.position.distanceTo(new Vector3(0, 2, 3))).toBeLessThan(1e-15);
            expect(object.scale.distanceTo(new Vector3(1, 1, 1))).toBeLessThan(1e-15);
        });

        it('should update an object with an anchorScale', () => {
            const object = new Object3D();

            object.userData.physics = {
                anchorScale: { x: 1, y: 0.5, z: 0.25 }, // i.e., the initial object scale is [1, 2, 4]
            };

            const worldPosition = new Vector3();
            const worldQuaternion = new Quaternion();
            const worldScale = new Vector3(1, 1, 1);
            PhysicsUtil.updateObjectTransformFromPhysics(object, worldPosition, worldQuaternion, worldScale);

            expect(object.scale.distanceTo(new Vector3(1, 2, 4))).toBeLessThan(1e-15);
        });

        it('should update a child object with an anchorScale and parent with a uniform scale', () => {
            const object = new Object3D();
            const parent = new Object3D();
            parent.scale.set(2, 2, 2);
            parent.add(object);

            object.userData.physics = {
                anchorScale: { x: 1, y: 0.5, z: 0.25 },
            };

            const worldPosition = new Vector3(0, 0, 0);
            const worldQuaternion = new Quaternion();
            const worldScale = new Vector3(2, 2, 2);
            PhysicsUtil.updateObjectTransformFromPhysics(object, worldPosition, worldQuaternion, worldScale);

            expect(object.scale.distanceTo(new Vector3(1, 2, 4))).toBeLessThan(1e-15);
        });
    });

    describe('getShapeData', () => {
        it.skip('should return correct shape data for a box', () => {
            const width = 1;
            const height = 2;
            const depth = 3;
            const geometry = new BoxGeometry(width, height, depth);
            const material = new MeshBasicMaterial();
            const mesh = new Mesh(geometry, material);
            mesh.position.set(1, 2, 3); // should be ignored
            mesh.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2); // should be ignored
            mesh.scale.set(2, 3, 4); // this should be taken into account

            const group = new Group(); // should be ignored
            group.position.set(5, 6, 7);
            group.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 4);
            group.scale.set(8, 9, 10);
            group.add(mesh);

            const shapeData = PhysicsUtil.getShapeData(mesh, BodyShapeType.BOX);
            const expectedScaledWidth = width * 2;
            const expectedScaledHeight = height * 3;
            const expectedScaledDepth = depth * 4;
            expect(shapeData.width).toBeCloseTo(expectedScaledWidth, 5);
            expect(shapeData.height).toBeCloseTo(expectedScaledHeight, 5);
            expect(shapeData.length).toBeCloseTo(expectedScaledDepth, 5);
        });

        it.skip('should return correct shape data for a sphere', () => {
            const radius = 2;
            const geometry = new SphereGeometry(radius);
            const material = new MeshBasicMaterial();
            const mesh = new Mesh(geometry, material);
            mesh.position.set(1, 2, 3); // should be ignored
            mesh.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2); // should be ignored
            mesh.scale.set(2, 3, 4); // this should be taken into account

            const group = new Group(); // should be ignored
            group.position.set(5, 6, 7);
            group.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 4);
            group.scale.set(8, 9, 10);
            group.add(mesh);

            const shapeData = PhysicsUtil.getShapeData(mesh, BodyShapeType.SPHERE);
            const expectedScaledRadius = radius * 4;
            expect(shapeData.radius).toBeCloseTo(expectedScaledRadius, 5);
        });

        it.skip('should return correct shape data for a capsule', () => {
            const radius = 1;
            const height = 4;
            const geometry = new CylinderGeometry(radius, radius, height, 32, 1, false);
            const material = new MeshBasicMaterial();
            const mesh = new Mesh(geometry, material);
            mesh.position.set(1, 2, 3); // should be ignored
            mesh.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2); // should be ignored
            mesh.scale.set(2, 3, 4); // this should be taken into account

            const group = new Group(); // should be ignored
            group.position.set(5, 6, 7);
            group.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 4);
            group.scale.set(8, 9, 10);
            group.add(mesh);

            const shapeData = PhysicsUtil.getShapeData(mesh, BodyShapeType.CAPSULE);
            const expectedScaledRadius = radius * 4;
            const expectedScaledHeight = height * 3 - 2 * expectedScaledRadius;
            expect(shapeData.radius).toBeCloseTo(expectedScaledRadius, 5);
            expect(shapeData.height).toBeCloseTo(expectedScaledHeight, 5);
        });
    });

    describe('updateShapeOffsetAndScale', () => {
        [
            { shape: BodyShapeType.BOX, expectedOffset: { x: 1, y: 3, z: 0 } },
            { shape: BodyShapeType.CAPSULE, expectedOffset: { x: 1, y: 3, z: 0 } },
            { shape: BodyShapeType.SPHERE, expectedOffset: { x: 1, y: 0, z: 0 } },
            { shape: BodyShapeType.CONVEX_HULL, expectedOffset: { x: 1, y: 0, z: 0 } },
            { shape: BodyShapeType.CONCAVE_HULL, expectedOffset: { x: 1, y: 0, z: 0 } },
        ].forEach(({ shape, expectedOffset }) => {
            it(`should compute the correct anchor offset and scale for a ${shape}`, () => {
                // Move the geometry so it's not at the origin.
                const geometry = new BoxGeometry(1, 2, 3);
                geometry.applyMatrix4(new Matrix4().makeTranslation(0, 1, 0));

                const material = new MeshBasicMaterial();
                const mesh = new Mesh(geometry, material);
                mesh.position.set(1, 2, 3); // should be ignored
                mesh.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2); // should be ignored
                mesh.scale.set(2, 3, 4); // this should be taken into account

                mesh.userData.physics = {
                    enabled: true,
                    shape,
                    userShapeOffset: { x: 1, y: 0, z: 0 },
                    userShapeScale: { x: 1, y: 1, z: 2 },
                };

                PhysicsUtil.updateShapeOffsetAndScale(mesh);
                expect(mesh.userData.physics.anchorOffset).toEqual(expectedOffset);

                // Inverse of the object scale
                expect(mesh.userData.physics.anchorScale).toEqual({
                    x: 1.0 / mesh.scale.x,
                    y: 1.0 / mesh.scale.y,
                    z: 1.0 / mesh.scale.z,
                });
            });
        });
    });

    describe('addObjectShapeToPhysics', () => {
        // Regression: shape sharing in `addBodyWithSharedShape` previously inserted an
        // `await` for fast shapes too, splitting `addShape` (synchronous) and
        // `addBody` (microtask). Callers that fire-and-forget this function
        // and immediately post a follow-up message — `MultiplayerUtils.
        // clonePlayerObject` then `addPlayerObject` — would have the follow-up
        // arrive at the worker between SHAPE and BODY and fail to find the
        // body. The fast-shape path must stay fully synchronous.
        it('queues addShape and addBody in the same tick for fast shapes (template path)', () => {
            const calls: Array<'addShape' | 'addBody'> = [];
            const mockPhysics: Partial<IPhysics> = {
                hasShape: () => false,
                addShape: vi.fn(() => { calls.push('addShape'); }),
                addBody: vi.fn(() => { calls.push('addBody'); }),
            };

            const template = new Mesh(new BoxGeometry(1, 2, 1), new MeshBasicMaterial());
            const instance = new Mesh(new BoxGeometry(1, 2, 1), new MeshBasicMaterial());
            for (const obj of [template, instance]) {
                obj.userData.physics = {
                    enabled: true,
                    type: 'rigidBody',
                    shape: BodyShapeType.CAPSULE,
                    mass: 1,
                };
            }

            // Intentionally NOT awaited — mirrors `MultiplayerUtils.
            // clonePlayerObject` which fire-and-forgets this call.
            void PhysicsUtil.addObjectShapeToPhysics(instance, mockPhysics as IPhysics, template);

            // Both messages must have been queued before control returned.
            expect(calls).toEqual(['addShape', 'addBody']);
        });
    });
});
