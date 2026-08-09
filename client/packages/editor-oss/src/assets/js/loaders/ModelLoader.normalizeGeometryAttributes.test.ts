import * as THREE from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import {DetectDevice} from "../../../utils/DetectDevice";
import ModelLoader from "./ModelLoader";

type ModelLoaderNormalizeAccess = {
    normalizeGeometryAttributes(child: THREE.Object3D): void;
    processModel(
        obj: THREE.Object3D,
        options?: {DisableDefaultPhysics?: boolean; EnableMorphing?: boolean},
        environment?: {skipChildrenClear?: boolean},
    ): void;
};

function createPositionGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array([
            0, 0, 0,
            1, 1, 1,
            2, 0, 0,
        ]), 3),
    );
    return geometry;
}

function addDeepObjectChain(root: THREE.Object3D, depth = 12_000): THREE.Object3D {
    let current = root;

    for (let i = 0; i < depth; i++) {
        const child = new THREE.Object3D();
        current.add(child);
        current = child;
    }

    return current;
}

describe("ModelLoader geometry normalization", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("does not recompute bounds for geometry normalized earlier in the load pipeline", () => {
        const loader = new ModelLoader() as unknown as ModelLoaderNormalizeAccess;
        const geometry = createPositionGeometry();
        const mesh = new THREE.Mesh(geometry);
        const computeBoundingBox = vi.spyOn(geometry, "computeBoundingBox");

        loader.normalizeGeometryAttributes(mesh);
        loader.normalizeGeometryAttributes(mesh);

        expect(computeBoundingBox).toHaveBeenCalledTimes(1);
        expect(geometry.boundingBox).not.toBeNull();
    });

    it("does not recompute an existing bounding box while marking the geometry normalized", () => {
        const loader = new ModelLoader() as unknown as ModelLoaderNormalizeAccess;
        const geometry = createPositionGeometry();
        geometry.computeBoundingBox();
        const mesh = new THREE.Mesh(geometry);
        const computeBoundingBox = vi.spyOn(geometry, "computeBoundingBox");

        loader.normalizeGeometryAttributes(mesh);
        loader.normalizeGeometryAttributes(mesh);

        expect(computeBoundingBox).not.toHaveBeenCalled();
    });

    it("processes deep model hierarchies without recursive Object3D traversal", () => {
        const loader = new ModelLoader() as unknown as ModelLoaderNormalizeAccess;
        const root = new THREE.Group();
        const leaf = addDeepObjectChain(root);
        const geometry = createPositionGeometry();
        const mesh = new THREE.Mesh(geometry);
        leaf.add(mesh);
        const traverseSpy = vi.spyOn(root, "traverse");

        expect(() => loader.processModel(root, {DisableDefaultPhysics: true})).not.toThrow();

        expect(geometry.boundingBox).not.toBeNull();
        expect(mesh.userData.isRuntimeOnly).toBe(true);
        expect(root.userData.isRuntimeOnly).toBeUndefined();
        expect(root.userData._children).toHaveLength(1);
        expect(root.userData._children[0].uuid).toBe(root.children[0]!.uuid);
        expect(traverseSpy).not.toHaveBeenCalled();
    });

    it("strips mobile morph state during the same non-recursive model processing pass", () => {
        vi.spyOn(DetectDevice, "isMobile").mockReturnValue(true);
        const loader = new ModelLoader() as unknown as ModelLoaderNormalizeAccess;
        const root = new THREE.Group();
        const geometry = createPositionGeometry();
        geometry.morphAttributes.position = [
            new THREE.Float32BufferAttribute([
                0, 0, 0,
                0.1, 0.1, 0.1,
                0.2, 0, 0,
            ], 3),
        ];
        const mesh = new THREE.Mesh(geometry);
        mesh.morphTargetInfluences = [0.5];
        mesh.morphTargetDictionary = {raise: 0};
        root.add(mesh);
        const traverseSpy = vi.spyOn(root, "traverse");

        loader.processModel(root, {DisableDefaultPhysics: true});

        expect(mesh.morphTargetInfluences).toBeUndefined();
        expect(mesh.morphTargetDictionary).toBeUndefined();
        expect(geometry.morphAttributes).toEqual({});
        expect(mesh.userData.isRuntimeOnly).toBe(true);
        expect(geometry.boundingBox).not.toBeNull();
        expect(traverseSpy).not.toHaveBeenCalled();
    });
});
