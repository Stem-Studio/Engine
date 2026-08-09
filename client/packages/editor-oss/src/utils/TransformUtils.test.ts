import { Object3D, Matrix4, Vector3, Quaternion, Euler } from 'three';

import SceneTraverser from './SceneTraverser';
import TransformUtils from './TransformUtils';

describe('TransformUtils.setWorldTransform', () => {
    it.skip('should set translation correctly with no parent', () => {
        const object = new Object3D();
        const matrix = new Matrix4().makeTranslation(5, 10, 15);

        TransformUtils.setWorldTransform(object, matrix);

        expect(object.matrixWorld).toEqual(matrix);
        expect(object.position.equals(new Vector3(5, 10, 15))).toBe(true);
        expect(object.quaternion.equals(new Quaternion())).toBe(true);
        expect(object.scale.equals(new Vector3(1, 1, 1))).toBe(true);
    });

    it('should handle rotation correctly with no parent', () => {
        const object = new Object3D();
        const rotation = new Euler(Math.PI / 4, Math.PI / 2, 0);
        const matrix = new Matrix4().makeRotationFromEuler(rotation);

        TransformUtils.setWorldTransform(object, matrix);

        const expectedQuat = new Quaternion().setFromEuler(rotation);

        expect(object.position.equals(new Vector3(0, 0, 0))).toBe(true);
        expect(object.quaternion.angleTo(expectedQuat)).toBeLessThan(1e-15);
        expect(object.scale.equals(new Vector3(1, 1, 1))).toBe(true);
    });

    it('should handle scaling correctly with no parent', () => {
        const object = new Object3D();
        const matrix = new Matrix4().makeScale(2, 3, 4);

        TransformUtils.setWorldTransform(object, matrix);

        expect(object.position.equals(new Vector3(0, 0, 0))).toBe(true);
        expect(object.quaternion.equals(new Quaternion())).toBe(true);
        expect(object.scale.equals(new Vector3(2, 3, 4))).toBe(true);
    });

    it('should handle combined translation, rotation, and scale', () => {
        const object = new Object3D();
        const pos = new Vector3(1, 2, 3);
        const rot = new Euler(Math.PI / 4, 0, Math.PI / 6);
        const scale = new Vector3(2, 2, 2);

        const matrix = new Matrix4()
            .compose(pos, new Quaternion().setFromEuler(rot), scale);

        TransformUtils.setWorldTransform(object, matrix);

        expect(object.position.distanceTo(pos)).toBeLessThan(1e-15);
        expect(object.quaternion.angleTo(new Quaternion().setFromEuler(rot))).toBeLessThan(1e-15);
        expect(object.scale.distanceTo(scale)).toBeLessThan(1e-15);
    });

    it('should set local transform correctly relative to parent transform', () => {
        const object = new Object3D();
        const parent = new Object3D();

        // Parent has rotation and translation
        parent.position.set(5, 0, 0);
        parent.rotation.set(0, Math.PI / 2, 0); // Rotate 90° around Y
        parent.scale.set(2, 2, 2); // Scale the parent
        parent.updateMatrixWorld(true);

        // Desired world transform for the object
        const worldPosition = new Vector3(5, 0, -10);
        const worldQuaternion = new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0));
        const worldScale = new Vector3(1, 1, 1);
        const worldMatrix = new Matrix4().compose(worldPosition, worldQuaternion, worldScale);

        parent.add(object);
        TransformUtils.setWorldTransform(object, worldMatrix);

        // Decompose the resulting object.matrixWorld
        const decomposedPos = new Vector3();
        const decomposedQuat = new Quaternion();
        const decomposedScale = new Vector3();
        object.matrixWorld.decompose(decomposedPos, decomposedQuat, decomposedScale);

        // Compare to expected world values
        expect(decomposedPos.distanceTo(worldPosition)).toBeLessThan(1e-15);
        expect(decomposedQuat.angleTo(worldQuaternion)).toBeLessThan(1e-15);
        expect(decomposedScale.distanceTo(worldScale)).toBeLessThan(1e-15);
    });

    it('should mark object and descendants dirty for world matrix propagation', () => {
        const object = new Object3D();
        const child = new Object3D();
        const grandChild = new Object3D();
        object.add(child);
        child.add(grandChild);
        const matrix = new Matrix4().makeTranslation(0, 0, 1);

        TransformUtils.setWorldTransform(object, matrix);

        expect(object.matrixWorldNeedsUpdate).toBe(true);
        expect(child.matrixWorldNeedsUpdate).toBe(true);
        expect(grandChild.matrixWorldNeedsUpdate).toBe(true);
    });

    it('updates static descendants during custom scene traversal after a parent world transform changes', () => {
        const root = new Object3D();
        const parent = new Object3D();
        const child = new Object3D();

        child.position.set(1, 0, 0);
        child.updateMatrix();
        child.matrixAutoUpdate = false;

        parent.add(child);
        root.add(parent);
        root.updateMatrixWorld(true);

        const initialChildWorldPosition = new Vector3().setFromMatrixPosition(child.matrixWorld);
        expect(initialChildWorldPosition.equals(new Vector3(1, 0, 0))).toBe(true);

        TransformUtils.setWorldTransform(parent, new Matrix4().makeTranslation(5, 0, 0));

        const traverser = new SceneTraverser(root);
        traverser.update();

        const updatedChildWorldPosition = new Vector3().setFromMatrixPosition(child.matrixWorld);
        expect(updatedChildWorldPosition.distanceTo(new Vector3(6, 0, 0))).toBeLessThan(1e-15);
    });

    it('keeps static descendants compatible with direct updateWorldMatrix calls', () => {
        const root = new Object3D();
        const parent = new Object3D();
        const child = new Object3D();

        child.position.set(1, 0, 0);
        child.updateMatrix();
        child.matrixAutoUpdate = false;

        parent.add(child);
        root.add(parent);
        root.updateMatrixWorld(true);

        TransformUtils.setWorldTransform(parent, new Matrix4().makeTranslation(5, 0, 0));
        child.updateWorldMatrix(true, false);

        const childWorldPosition = new Vector3().setFromMatrixPosition(child.matrixWorld);
        expect(childWorldPosition.distanceTo(new Vector3(6, 0, 0))).toBeLessThan(1e-15);
    });
});

describe('TransformUtils transform conversion helpers', () => {
    it('can write world transforms into a reusable target', () => {
        const object = new Object3D();
        object.position.set(1, 2, 3);
        object.rotation.set(0, Math.PI / 4, 0);
        object.scale.set(2, 3, 4);
        object.updateMatrixWorld(true);
        const target = TransformUtils.createTransform(
            new Vector3(),
            new Quaternion(),
            new Vector3(1, 1, 1),
        );

        const result = TransformUtils.getWorldTransform(object, target);

        expect(result).toBe(target);
        expect(target.position.distanceTo(new Vector3(1, 2, 3))).toBeLessThan(1e-15);
        expect(target.quaternion.angleTo(new Quaternion().setFromEuler(object.rotation))).toBeLessThan(1e-15);
        expect(target.scale.distanceTo(new Vector3(2, 3, 4))).toBeLessThan(1e-15);
    });

    it('can write delta matrices into a reusable target', () => {
        const initial = TransformUtils.createTransform(
            new Vector3(0, 0, 0),
            new Quaternion(),
            new Vector3(1, 1, 1),
        );
        const current = TransformUtils.createTransform(
            new Vector3(5, 0, 0),
            new Quaternion(),
            new Vector3(1, 1, 1),
        );
        const target = new Matrix4();

        const result = TransformUtils.calculateDeltaMatrix(initial, current, target);

        expect(result).toBe(target);
        expect(new Vector3().setFromMatrixPosition(target).distanceTo(new Vector3(5, 0, 0))).toBeLessThan(1e-15);
    });

    it('returns independent world-to-local transform data after subsequent conversions', () => {
        const parent = new Object3D();
        const child = new Object3D();
        parent.position.set(5, 0, 0);
        parent.scale.set(2, 2, 2);
        parent.add(child);
        parent.updateMatrixWorld(true);

        const worldTransform = TransformUtils.createTransform(
            new Vector3(9, 0, 0),
            new Quaternion(),
            new Vector3(2, 2, 2),
        );
        const localTransform = TransformUtils.worldToLocalTransform(child, worldTransform);
        const otherLocalTransform = TransformUtils.createTransform(
            new Vector3(1, 2, 3),
            new Quaternion().setFromEuler(new Euler(0, Math.PI / 4, 0)),
            new Vector3(1, 1, 1),
        );

        TransformUtils.localToWorldTransform(child, otherLocalTransform);

        expect(localTransform.position.distanceTo(new Vector3(2, 0, 0))).toBeLessThan(1e-15);
        expect(localTransform.quaternion.angleTo(new Quaternion())).toBeLessThan(1e-15);
        expect(localTransform.scale.distanceTo(new Vector3(1, 1, 1))).toBeLessThan(1e-15);
    });

    it('returns an independent delta matrix after later delta calculations', () => {
        const initial = TransformUtils.createTransform(
            new Vector3(0, 0, 0),
            new Quaternion(),
            new Vector3(1, 1, 1),
        );
        const current = TransformUtils.createTransform(
            new Vector3(5, 0, 0),
            new Quaternion(),
            new Vector3(1, 1, 1),
        );
        const firstDelta = TransformUtils.calculateDeltaMatrix(initial, current);

        TransformUtils.calculateDeltaMatrix(
            TransformUtils.createTransform(
                new Vector3(1, 0, 0),
                new Quaternion(),
                new Vector3(1, 1, 1),
            ),
            TransformUtils.createTransform(
                new Vector3(1, 3, 0),
                new Quaternion(),
                new Vector3(1, 1, 1),
            ),
        );

        const firstDeltaPosition = new Vector3().setFromMatrixPosition(firstDelta);
        expect(firstDeltaPosition.distanceTo(new Vector3(5, 0, 0))).toBeLessThan(1e-15);
    });
});
