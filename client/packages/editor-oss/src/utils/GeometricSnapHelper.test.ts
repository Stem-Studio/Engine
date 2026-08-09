import {BoxGeometry, Mesh, MeshBasicMaterial, Object3D, Scene, Vector3} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import {GeometricSnapHelper, type GeometricSnapSettings} from "./GeometricSnapHelper";

const settings: GeometricSnapSettings = {
    snapToVertex: true,
    snapToEdge: false,
    snapToFace: false,
    snapDistance: 0.25,
    visualFeedback: false,
};

function addDeepChain(root: Object3D, depth = 12_000): Object3D {
    let cursor = root;
    for (let i = 0; i < depth; i++) {
        const child = new Object3D();
        child.name = `deep-${i}`;
        cursor.add(child);
        cursor = child;
    }
    return cursor;
}

describe("GeometricSnapHelper", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("uses squared-distance checks while snapping to the closest vertex", () => {
        const scene = new Scene();
        const sceneHelpers = new Object3D();
        const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
        scene.add(mesh);
        scene.updateMatrixWorld(true);

        const helper = new GeometricSnapHelper(scene, sceneHelpers, settings);
        const position = new Vector3(0.49, 0.5, 0.5);
        const distanceTo = vi.spyOn(position, "distanceTo");
        const distanceToSquared = vi.spyOn(position, "distanceToSquared");

        const result = helper.findSnapTarget(position, []);

        expect(result).toMatchObject({type: "vertex", target: mesh});
        expect(result?.position.distanceToSquared(new Vector3(0.5, 0.5, 0.5))).toBeLessThan(1e-12);
        expect(distanceToSquared).toHaveBeenCalled();
        expect(distanceTo).not.toHaveBeenCalled();
    });

    it("does not snap to excluded objects", () => {
        const scene = new Scene();
        const sceneHelpers = new Object3D();
        const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
        scene.add(mesh);
        scene.updateMatrixWorld(true);

        const helper = new GeometricSnapHelper(scene, sceneHelpers, settings);

        expect(helper.findSnapTarget(new Vector3(0.49, 0.5, 0.5), [mesh])).toBeNull();
    });

    it("does not snap to descendant meshes of excluded wrapper objects", () => {
        const scene = new Scene();
        const sceneHelpers = new Object3D();
        const wrapper = new Object3D();
        const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
        wrapper.add(mesh);
        scene.add(wrapper);
        scene.updateMatrixWorld(true);

        const helper = new GeometricSnapHelper(scene, sceneHelpers, settings);

        expect(helper.findSnapTarget(new Vector3(0.49, 0.5, 0.5), [wrapper])).toBeNull();
    });

    it("finds vertices in deep hierarchies without recursive scene traversal", () => {
        const scene = new Scene();
        const sceneHelpers = new Object3D();
        const leafParent = addDeepChain(scene);
        const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
        leafParent.add(mesh);
        const traverse = vi.spyOn(scene, "traverse");

        const helper = new GeometricSnapHelper(scene, sceneHelpers, settings);
        const result = helper.findSnapTarget(new Vector3(0.49, 0.5, 0.5), []);

        expect(result?.type).toBe("vertex");
        expect(result?.target).toBe(mesh);
        expect(traverse).not.toHaveBeenCalled();
    });

    it("excludes deep wrapper descendants without recursive object traversal", () => {
        const scene = new Scene();
        const sceneHelpers = new Object3D();
        const wrapper = new Object3D();
        const leafParent = addDeepChain(wrapper);
        const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
        leafParent.add(mesh);
        scene.add(wrapper);
        const traverse = vi.spyOn(wrapper, "traverse");

        const helper = new GeometricSnapHelper(scene, sceneHelpers, settings);
        const result = helper.findSnapTarget(new Vector3(0.49, 0.5, 0.5), [wrapper]);

        expect(result).toBeNull();
        expect(traverse).not.toHaveBeenCalled();
    });

    it("invalidates cached vertices for descendant meshes when a wrapper object changes", () => {
        const scene = new Scene();
        const sceneHelpers = new Object3D();
        const wrapper = new Object3D();
        const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
        wrapper.add(mesh);
        scene.add(wrapper);
        scene.updateMatrixWorld(true);

        const helper = new GeometricSnapHelper(scene, sceneHelpers, settings);
        expect(helper.findSnapTarget(new Vector3(0.49, 0.5, 0.5), [])?.target).toBe(mesh);

        mesh.position.set(10, 0, 0);
        scene.updateMatrixWorld(true);
        helper.invalidateObject(wrapper);

        expect(helper.findSnapTarget(new Vector3(10.49, 0.5, 0.5), [])?.target).toBe(mesh);
        expect(helper.findSnapTarget(new Vector3(0.49, 0.5, 0.5), [])).toBeNull();
    });

    it("invalidates deep object hierarchies without recursive object traversal", () => {
        const scene = new Scene();
        const sceneHelpers = new Object3D();
        const wrapper = new Object3D();
        const leafParent = addDeepChain(wrapper);
        const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
        leafParent.add(mesh);
        scene.add(wrapper);
        const helper = new GeometricSnapHelper(scene, sceneHelpers, settings);
        expect(helper.findSnapTarget(new Vector3(0.49, 0.5, 0.5), [])?.target).toBe(mesh);
        const traverse = vi.spyOn(wrapper, "traverse");

        expect(() => helper.invalidateObject(wrapper)).not.toThrow();
        expect(traverse).not.toHaveBeenCalled();
    });

    it("skips vertex extraction for meshes outside the snap distance broad phase", () => {
        const scene = new Scene();
        const sceneHelpers = new Object3D();
        const farMesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
        farMesh.position.set(100, 0, 0);
        const nearMesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
        scene.add(farMesh, nearMesh);
        scene.updateMatrixWorld(true);

        const helper = new GeometricSnapHelper(scene, sceneHelpers, settings);
        const getWorldVertices = vi.spyOn(
            helper as unknown as {getWorldVertices(mesh: Mesh): Float32Array},
            "getWorldVertices",
        );

        const result = helper.findSnapTarget(new Vector3(0.49, 0.5, 0.5), []);

        expect(result?.target).toBe(nearMesh);
        expect(getWorldVertices).toHaveBeenCalledWith(nearMesh);
        expect(getWorldVertices).not.toHaveBeenCalledWith(farMesh);
    });

    it("does not compute square roots while rejecting broad-phase misses", () => {
        const scene = new Scene();
        const sceneHelpers = new Object3D();
        for (let i = 0; i < 8; i++) {
            const farMesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
            farMesh.geometry.computeBoundingSphere();
            farMesh.position.set(100 + i * 10, 0, 0);
            scene.add(farMesh);
        }
        scene.updateMatrixWorld(true);

        const helper = new GeometricSnapHelper(scene, sceneHelpers, settings);
        const sqrt = vi.spyOn(Math, "sqrt");

        expect(helper.findSnapTarget(new Vector3(0, 0, 0), [])).toBeNull();
        expect(sqrt).not.toHaveBeenCalled();
    });

    it("caches world vertices in a compact numeric buffer", () => {
        const scene = new Scene();
        const sceneHelpers = new Object3D();
        const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
        scene.add(mesh);
        scene.updateMatrixWorld(true);

        const helper = new GeometricSnapHelper(scene, sceneHelpers, settings);
        const vertices = (helper as unknown as {getWorldVertices(mesh: Mesh): Float32Array}).getWorldVertices(mesh);

        expect(vertices).toBeInstanceOf(Float32Array);
        expect(vertices.length).toBe(mesh.geometry.attributes.position!.count * 3);
    });
});
