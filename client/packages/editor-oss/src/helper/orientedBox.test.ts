import * as THREE from "three";
import {describe, expect, it, vi} from "vitest";

import {computeOrientedBox} from "./orientedBox";

class BoundsOnlyObject extends THREE.Object3D {
    getBoundingBox(_centersOnly = false) {
        return new THREE.Box3(
            new THREE.Vector3(-1, -2, -3),
            new THREE.Vector3(1, 2, 3),
        );
    }
}

class ThrowingBoundsObject extends THREE.Object3D {
    getBoundingBox(_centersOnly = false) {
        throw new Error("getBoundingBox should not be called after abort");
    }
}

describe("computeOrientedBox", () => {
    it("uses getBoundingBox for geometry-less children", () => {
        const root = new THREE.Group();
        root.rotation.y = Math.PI / 3;
        root.scale.set(2, 3, 4);

        const splatLike = new BoundsOnlyObject();
        root.add(splatLike);

        const result = computeOrientedBox(root);
        const size = result.box.getSize(new THREE.Vector3());

        expect(result.hasGeometry).toBe(true);
        expect(size.x).toBeCloseTo(4);
        expect(size.y).toBeCloseTo(12);
        expect(size.z).toBeCloseTo(24);
    });

    it("can abort traversal before expensive child bounds are read", () => {
        const root = new THREE.Group();
        const child = new ThrowingBoundsObject();
        child.userData.skipSelectionBounds = true;
        root.add(child);

        const result = computeOrientedBox(root, undefined, {
            shouldAbort: object => object.userData.skipSelectionBounds === true,
        });

        expect(result.hasGeometry).toBe(false);
        expect(result.box.isEmpty()).toBe(true);
    });

    it("computes deep selection bounds without recursive Three traversal", () => {
        const root = new THREE.Group();
        let parent: THREE.Object3D = root;
        for (let index = 0; index < 12_000; index++) {
            const child = new THREE.Object3D();
            child.position.x = 0.001;
            parent.add(child);
            parent = child;
        }
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 6));
        parent.add(mesh);

        const traverseSpy = vi.spyOn(THREE.Object3D.prototype, "traverse").mockImplementation(() => {
            throw new Error("recursive traversal must not be used");
        });
        const matrixSpy = vi.spyOn(THREE.Object3D.prototype, "updateMatrixWorld").mockImplementation(() => {
            throw new Error("recursive matrix updates must not be used");
        });

        const result = computeOrientedBox(root);
        expect(result.hasGeometry).toBe(true);
        expect(result.box.getSize(new THREE.Vector3()).toArray()).toEqual([2, 4, 6]);
        expect(traverseSpy).not.toHaveBeenCalled();
        expect(matrixSpy).not.toHaveBeenCalled();
    });
});
