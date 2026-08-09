import { Box3, BufferAttribute, BufferGeometry, Object3D, Vector3, Quaternion, Group, BoxGeometry, MeshBasicMaterial, Mesh, SphereGeometry, CylinderGeometry, Matrix4 } from 'three';
import { afterEach, vi } from 'vitest';

import { BodyShapeType, IPhysics } from './common/types';
import { CollisionType, isConcaveHullBodyTypeSupported, isConcaveHullEffectiveBodyTypeSupported, resolveCollisionType, resolveEffectiveCollisionType } from './common/physicsConfig';
import type { PhysicsConfig } from './common/physicsConfig';
import { getModelAssetShapeKey, PhysicsUtil } from './PhysicsUtil';
import BoundingBoxUtil from '@stem/editor-oss/utils/BoundingBoxUtil';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('PhysicsUtil', () => {
    const createTetrahedronGeometry = () => {
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(new Float32Array([
            0, 0, 0,
            1, 0, 0,
            0, 1, 0,
            0, 0, 1,
        ]), 3));
        geometry.setIndex([0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3]);
        return geometry;
    };

    const expectScaledExtents = (vertices: ArrayLike<number>) => {
        let maxX = -Infinity;
        let maxY = -Infinity;
        let maxZ = -Infinity;
        for (let i = 0; i < vertices.length; i += 3) {
            maxX = Math.max(maxX, vertices[i]!);
            maxY = Math.max(maxY, vertices[i + 1]!);
            maxZ = Math.max(maxZ, vertices[i + 2]!);
        }
        expect(maxX).toBeCloseTo(2);
        expect(maxY).toBeCloseTo(3);
        expect(maxZ).toBeCloseTo(4);
    };

    describe('getSimplifiedGeometry', () => {
        it('extracts world-space geometry while preserving the source transform', () => {
            const geometry = new BufferGeometry();
            geometry.setAttribute('position', new BufferAttribute(new Float32Array([
                0, 0, 0,
                1, 0, 0,
                0, 1, 0,
            ]), 3));

            const parent = new Object3D();
            const root = new Object3D();
            parent.add(root);
            root.position.set(8, 9, 10);
            root.rotation.set(0.1, 0.2, 0.3, 'ZYX');
            root.scale.set(2, 3, 4);
            root.userData.physics = {
                enabled: true,
                userShapeScale: {x: 10, y: 1, z: 0.5},
            };

            const mesh = new Mesh(geometry, new MeshBasicMaterial());
            mesh.position.set(1, 0, 0);
            root.add(mesh);

            const simplified = PhysicsUtil.getSimplifiedGeometry(root, 0);
            const positions = simplified[0]!.getAttribute('position').array;

            expect(Array.from(positions)).toEqual([
                20, 0, 0,
                40, 0, 0,
                20, 3, 0,
            ]);
            expect(root.parent).toBe(parent);
            expect(root.position.toArray()).toEqual([8, 9, 10]);
            expect(root.rotation.x).toBe(0.1);
            expect(root.rotation.y).toBe(0.2);
            expect(root.rotation.z).toBe(0.3);
            expect(root.rotation.order).toBe('ZYX');
            expect(root.scale.toArray()).toEqual([2, 3, 4]);
        });

        it('restores the source transform when traversal throws', () => {
            const parent = new Object3D();
            const root = new Object3D();
            parent.add(root);
            root.position.set(1, 2, 3);
            root.rotation.set(0.4, 0.5, 0.6, 'YZX');
            root.scale.set(4, 5, 6);

            const mesh = new Mesh(createTetrahedronGeometry(), new MeshBasicMaterial());
            root.add(mesh);

            vi.spyOn(mesh, 'getVertexPosition').mockImplementation(() => {
                throw new Error('forced extraction failure');
            });

            expect(() => PhysicsUtil.getSimplifiedGeometry(root)).toThrow('forced extraction failure');
            expect(root.parent).toBe(parent);
            expect(root.position.toArray()).toEqual([1, 2, 3]);
            expect(root.rotation.x).toBe(0.4);
            expect(root.rotation.y).toBe(0.5);
            expect(root.rotation.z).toBe(0.6);
            expect(root.rotation.order).toBe('YZX');
            expect(root.scale.toArray()).toEqual([4, 5, 6]);
        });

        it('extracts geometry through very deep hierarchies without using recursive traversal', () => {
            const root = new Object3D();
            root.userData.physics = {enabled: true};

            let cursor = root;
            for (let i = 0; i < 12_000; i++) {
                const child = new Object3D();
                child.position.x = 0.001;
                cursor.add(child);
                cursor = child;
            }

            cursor.add(new Mesh(createTetrahedronGeometry(), new MeshBasicMaterial()));

            const traverseSpy = vi.spyOn(root, 'traverse');
            const traverseVisibleSpy = vi.spyOn(root, 'traverseVisible');
            const simplified = PhysicsUtil.getSimplifiedGeometry(root, 0);

            expect(simplified).toHaveLength(1);
            expect(traverseSpy).not.toHaveBeenCalled();
            expect(traverseVisibleSpy).not.toHaveBeenCalled();
        });
    });

    describe('getModelAssetShapeKey', () => {
        it('includes world scale for shareable convex model hulls', () => {
            const parent = new Object3D();
            parent.scale.set(5, 1, 0.5);

            const object = new Object3D();
            object.userData.modelId = 'model-1';
            object.userData.modelRevisionId = 'rev-1';
            object.scale.set(2, 3, 4);
            parent.add(object);

            const key = getModelAssetShapeKey(
                object,
                BodyShapeType.CONVEX_HULL,
                true,
                {userShapeScale: {x: 1.25, y: 1, z: 0.5}} as PhysicsConfig,
            );

            expect(key).toBe(
                `model:model-1:rev-1:${BodyShapeType.CONVEX_HULL}:true:` +
                    'ls=2.0000,3.0000,4.0000:' +
                    'us=1.2500,1.0000,0.5000:' +
                    'ws=10.0000,3.0000,2.0000',
            );
        });

        it('omits world scale for concave model hull keys', () => {
            const object = new Object3D();
            object.userData.modelId = 'model-1';
            object.userData.modelRevisionId = 'rev-1';
            object.scale.set(2, 3, 4);

            const key = getModelAssetShapeKey(
                object,
                BodyShapeType.CONCAVE_HULL,
                false,
                {userShapeScale: {x: 1, y: 1, z: 1}} as PhysicsConfig,
            );

            expect(key).toBe(
                `model:model-1:rev-1:${BodyShapeType.CONCAVE_HULL}:false:` +
                    'ls=2.0000,3.0000,4.0000:' +
                    'us=1.0000,1.0000,1.0000',
            );
        });
    });

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

        it('copies JSON-compatible physics config without JSON.stringify', () => {
            const stringifySpy = vi.spyOn(JSON, 'stringify');
            const from = new Object3D();
            const to = new Object3D();
            from.userData.physics = {
                enabled: true,
                shape: 'btBoxShape',
                anchorOffset: {x: 1, y: 2, z: 3},
                values: [1, undefined, Number.NaN],
                ignored: undefined,
            };

            PhysicsUtil.copyPhysicsConfig(from, to);

            expect(stringifySpy).not.toHaveBeenCalled();
            expect(to.userData.physics).toEqual({
                enabled: true,
                shape: 'btBoxShape',
                anchorOffset: {x: 1, y: 2, z: 3},
                values: [1, null, null],
            });
            expect(to.userData.physics).not.toBe(from.userData.physics);
            expect(to.userData.physics.anchorOffset).not.toBe(from.userData.physics.anchorOffset);
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

        it('should handle an object with a parent that has a non-zero rotation', () => {
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

        it('should update an object with a parent that has a non-zero rotation', () => {
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

        it('should update a child object with an anchorOffset and parent with a non-zero rotation', () => {
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
        it('reuses a caller-owned bounding box when computing box shape data', () => {
            const targets: unknown[] = [];
            const originalGetBoxWithoutTransform = BoundingBoxUtil.getBoxWithoutTransform;
            vi.spyOn(BoundingBoxUtil, 'getBoxWithoutTransform').mockImplementation((object, skipInvisible, target) => {
                targets.push(target);
                return originalGetBoxWithoutTransform.call(BoundingBoxUtil, object, skipInvisible, target);
            });

            const meshA = new Mesh(new BoxGeometry(1, 2, 3), new MeshBasicMaterial());
            const meshB = new Mesh(new BoxGeometry(2, 4, 6), new MeshBasicMaterial());

            PhysicsUtil.getShapeData(meshA, BodyShapeType.BOX);
            PhysicsUtil.getShapeData(meshB, BodyShapeType.BOX);

            expect(targets).toHaveLength(2);
            expect(targets[0]).toBeInstanceOf(Box3);
            expect(targets[0]).toBe(targets[1]);
        });

        it('creates nonzero sphere colliders for group-based models', () => {
            const group = new Group();
            const left = new Mesh(new SphereGeometry(1, 8, 8), new MeshBasicMaterial());
            const right = new Mesh(new SphereGeometry(1, 8, 8), new MeshBasicMaterial());
            left.position.x = -3;
            right.position.x = 3;
            group.add(left, right);

            const shapeData = PhysicsUtil.getShapeData(group, BodyShapeType.SPHERE);

            expect(shapeData.type).toBe(BodyShapeType.SPHERE);
            expect((shapeData as {radius: number}).radius).toBeCloseTo(4);
        });

        it('should return correct shape data for a box', () => {
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

        it('should return correct shape data for a sphere', () => {
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

        it('should return correct shape data for a capsule', () => {
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

    describe('hull vertex extraction', () => {
        it('applies userShapeScale once on the sync convex hull path', () => {
            const root = new Object3D();
            root.userData.physics = {
                enabled: true,
                userShapeScale: {x: 2, y: 3, z: 4},
            };
            root.add(new Mesh(createTetrahedronGeometry(), new MeshBasicMaterial()));

            const vertices = PhysicsUtil.getConvexHullVertices(root, 0);

            expectScaledExtents(vertices);
        });

        it('applies userShapeScale once on the sync concave hull path', () => {
            const root = new Object3D();
            root.userData.physics = {
                enabled: true,
                userShapeScale: {x: 2, y: 3, z: 4},
            };
            root.add(new Mesh(createTetrahedronGeometry(), new MeshBasicMaterial()));

            const result = PhysicsUtil.getConcaveHullVertices(root) as { vertices: number[][] };

            expect(result.vertices).toHaveLength(1);
            expectScaledExtents(result.vertices[0]!);
        });
    });

    describe('updateShapeOffsetAndScale', () => {
        it.each([
            ['missing', undefined, '<missing>'],
            ['empty', '', '""'],
            ['unknown', 'torus', '"torus"'],
        ])('warns and preserves offsets for a %s runtime shape', (_label, shape, expectedShape) => {
            const mesh = new Mesh(new BoxGeometry(2, 4, 6), new MeshBasicMaterial());
            mesh.name = 'Offset Boundary';
            mesh.userData.physics = {
                enabled: true,
                type: 'rigidBody',
                shape,
                mass: 1,
                anchorOffset: {x: 7, y: 8, z: 9},
                anchorScale: {x: 4, y: 5, z: 6},
            };
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

            PhysicsUtil.updateShapeOffsetAndScale(mesh);

            expect(mesh.userData.physics.anchorOffset).toEqual({x: 7, y: 8, z: 9});
            expect(mesh.userData.physics.anchorScale).toEqual({x: 4, y: 5, z: 6});
            expect(warn).toHaveBeenCalledOnce();
            expect(warn).toHaveBeenCalledWith(
                expect.stringContaining(
                    `unsupported shape ${expectedShape} for object "Offset Boundary"`,
                ),
            );
        });

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
        it('resolves omitted and unknown body types as dynamic for shared policy checks', () => {
            expect(resolveCollisionType(undefined)).toBe(CollisionType.Dynamic);
            expect(resolveCollisionType('not-a-body-type')).toBe(CollisionType.Dynamic);
            expect(resolveCollisionType(' STATIC ')).toBe(CollisionType.Static);
            expect(resolveEffectiveCollisionType(CollisionType.Static, 1)).toBe(CollisionType.Dynamic);
            expect(resolveEffectiveCollisionType(undefined, 0)).toBe(CollisionType.Static);
            expect(resolveEffectiveCollisionType(undefined, undefined)).toBe(CollisionType.Static);
            expect(resolveEffectiveCollisionType(CollisionType.Dynamic, 0)).toBe(CollisionType.Static);
            expect(resolveEffectiveCollisionType(CollisionType.Kinematic, 0)).toBe(CollisionType.Kinematic);
            expect(resolveEffectiveCollisionType(2, 0)).toBe(CollisionType.Kinematic);
            expect(resolveEffectiveCollisionType(CollisionType.Static, '1')).toBe(CollisionType.Dynamic);
            expect(isConcaveHullEffectiveBodyTypeSupported(CollisionType.Static, 1)).toBe(false);
            expect(isConcaveHullEffectiveBodyTypeSupported(undefined, 0)).toBe(true);
            expect(isConcaveHullEffectiveBodyTypeSupported(undefined, undefined)).toBe(true);
            expect(isConcaveHullEffectiveBodyTypeSupported(CollisionType.Dynamic, 0)).toBe(true);
            expect(isConcaveHullBodyTypeSupported(BodyShapeType.CONCAVE_HULL, CollisionType.Static)).toBe(true);
            expect(isConcaveHullBodyTypeSupported(BodyShapeType.CONCAVE_HULL, CollisionType.Dynamic)).toBe(false);
            expect(isConcaveHullBodyTypeSupported(BodyShapeType.CONCAVE_HULL, CollisionType.Kinematic)).toBe(false);
            expect(isConcaveHullBodyTypeSupported(BodyShapeType.BOX, CollisionType.Dynamic)).toBe(true);
        });

        it.each([
            ['dynamic', CollisionType.Dynamic],
            ['kinematic', CollisionType.Kinematic],
            ['static with positive mass', CollisionType.Static],
            ['missing', undefined],
        ] as const)('rejects %s concave hulls before hull computation or physics dispatch', async (_label, ctype) => {
            const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
            mesh.name = `Invalid ${_label} concave`;
            mesh.userData.physics = {
                enabled: true,
                type: 'rigidBody',
                shape: BodyShapeType.CONCAVE_HULL,
                mass: 1,
                ...(ctype === undefined ? {} : {ctype}),
            };

            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            const getSimplifiedGeometry = vi.spyOn(PhysicsUtil, 'getSimplifiedGeometry');
            const hasShape = vi.fn();
            const addShape = vi.fn();
            const addBody = vi.fn();
            const addConcaveHull = vi.fn();
            const mockPhysics: Partial<IPhysics> = {
                hasShape,
                addShape,
                addBody,
                addConcaveHull,
            };

            await PhysicsUtil.addObjectShapeToPhysics(mesh, mockPhysics as IPhysics, undefined, false);

            expect(getSimplifiedGeometry).not.toHaveBeenCalled();
            expect(hasShape).not.toHaveBeenCalled();
            expect(addShape).not.toHaveBeenCalled();
            expect(addBody).not.toHaveBeenCalled();
            expect(addConcaveHull).not.toHaveBeenCalled();
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('only for Static bodies'));
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('ctype "Static" with mass <= 0'));
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('ConvexHull'));
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('compound primitive colliders'));
        });

        it.each([
            ['explicit static', CollisionType.Static],
            ['missing ctype with zero mass', undefined],
            ['dynamic ctype with zero mass', CollisionType.Dynamic],
        ] as const)('preserves effective-static concave hull construction for %s', async (_label, ctype) => {
            const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
            mesh.name = 'Static terrain';
            mesh.userData.physics = {
                enabled: true,
                type: 'rigidBody',
                shape: BodyShapeType.CONCAVE_HULL,
                mass: 0,
                ...(ctype === undefined ? {} : {ctype}),
            };

            const addConcaveHull = vi.fn();
            const mockPhysics: Partial<IPhysics> = {addConcaveHull};

            await PhysicsUtil.addObjectShapeToPhysics(mesh, mockPhysics as IPhysics, undefined, false);

            expect(addConcaveHull).toHaveBeenCalledOnce();
            expect(addConcaveHull.mock.calls[0]![1]).toMatchObject({
                type: BodyShapeType.CONCAVE_HULL,
            });
        });

        it.each([
            ['box', BodyShapeType.BOX],
            ['btBoxShape', BodyShapeType.BOX],
            ['sphere', BodyShapeType.SPHERE],
            ['btSphereShape', BodyShapeType.SPHERE],
            ['capsule', BodyShapeType.CAPSULE],
            ['cylinder', BodyShapeType.CAPSULE],
            ['btCapsuleShape', BodyShapeType.CAPSULE],
            ['convexHull', BodyShapeType.CONVEX_HULL],
            ['btConvexHullShape', BodyShapeType.CONVEX_HULL],
            ['concaveHull', BodyShapeType.CONCAVE_HULL],
            ['trimesh', BodyShapeType.CONCAVE_HULL],
            ['btConcaveHullShape', BodyShapeType.CONCAVE_HULL],
        ])('normalizes runtime shape alias %s to %s', (shape, expected) => {
            expect(PhysicsUtil.toBodyShapeType(shape)).toBe(expected);
        });

        it('normalizes friendly shape ids case-insensitively without changing bt ids', () => {
            expect(PhysicsUtil.toBodyShapeType('  BoX  ')).toBe(BodyShapeType.BOX);
            expect(PhysicsUtil.toBodyShapeType(BodyShapeType.CAPSULE)).toBe(BodyShapeType.CAPSULE);
        });

        it.each([undefined, null, '', '   ', 'torus', 42])(
            'returns undefined for unsupported shape input %j',
            (shape) => {
                const normalized: BodyShapeType | undefined = PhysicsUtil.toBodyShapeType(shape);
                expect(normalized).toBeUndefined();
            },
        );

        it('adds a direct runtime object whose config uses the friendly box alias', async () => {
            const mesh = new Mesh(new BoxGeometry(2, 4, 6), new MeshBasicMaterial());
            mesh.name = 'Runtime Box';
            mesh.userData.physics = {
                enabled: true,
                type: 'rigidBody',
                shape: 'box',
                mass: 1,
            };
            const addBox = vi.fn();
            const mockPhysics: Partial<IPhysics> = {addBox};

            await PhysicsUtil.addObjectShapeToPhysics(mesh, mockPhysics as IPhysics);

            expect(addBox).toHaveBeenCalledOnce();
            expect(addBox.mock.calls[0]![1]).toMatchObject({
                type: BodyShapeType.BOX,
                width: 2,
                height: 4,
                length: 6,
            });
        });

        it('rejects unknown runtime shapes without creating the wrong collider', async () => {
            const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
            mesh.name = 'Mystery Collider';
            mesh.userData.physics = {
                enabled: true,
                type: 'rigidBody',
                shape: 'torus',
                mass: 1,
            };
            const addBox = vi.fn();
            const addSphere = vi.fn();
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            const mockPhysics: Partial<IPhysics> = {addBox, addSphere};

            await PhysicsUtil.addObjectShapeToPhysics(mesh, mockPhysics as IPhysics);

            expect(addBox).not.toHaveBeenCalled();
            expect(addSphere).not.toHaveBeenCalled();
            expect(warn).toHaveBeenCalledWith(
                expect.stringContaining('unsupported shape "torus" for object "Mystery Collider"'),
            );
        });

        it('uses friendly aliases when calculating runtime anchor offsets', () => {
            const mesh = new Mesh(new BoxGeometry(2, 4, 6), new MeshBasicMaterial());
            mesh.position.set(5, 6, 7);
            mesh.userData.physics = {
                enabled: true,
                type: 'rigidBody',
                shape: 'box',
                mass: 1,
            };

            PhysicsUtil.updateShapeOffsetAndScale(mesh);

            expect(mesh.userData.physics.anchorOffset).toEqual({x: 0, y: 0, z: 0});
        });

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
