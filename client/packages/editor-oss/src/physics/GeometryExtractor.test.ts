import {BufferAttribute, BufferGeometry, Mesh, Object3D} from "three";
import {describe, expect, it, vi} from "vitest";

import {GeometryExtractor} from "./GeometryExtractor";

function createIndexedTriangleGeometry(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
    ]), 3));
    geometry.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2]), 1));
    return geometry;
}

describe("GeometryExtractor", () => {
    it("extracts world-space positions and Uint32 indices without mutating the source transform", () => {
        const parent = new Object3D();
        const root = new Object3D();
        parent.add(root);
        root.position.set(8, 9, 10);
        root.rotation.set(0.1, 0.2, 0.3, "ZYX");
        root.scale.set(2, 3, 4);

        const mesh = new Mesh(createIndexedTriangleGeometry());
        mesh.position.set(1, 0, 0);
        root.add(mesh);

        const geometries = GeometryExtractor.extractGeometries(root, false, {x: 10, y: 1, z: 0.5});

        expect(geometries).toHaveLength(1);
        expect(Array.from(geometries[0]!.positions)).toEqual([
            20, 0, 0,
            40, 0, 0,
            20, 3, 0,
        ]);
        expect(geometries[0]!.indices).toBeInstanceOf(Uint32Array);
        expect(Array.from(geometries[0]!.indices!)).toEqual([0, 1, 2]);

        expect(root.parent).toBe(parent);
        expect(root.position.toArray()).toEqual([8, 9, 10]);
        expect(root.rotation.x).toBe(0.1);
        expect(root.rotation.y).toBe(0.2);
        expect(root.rotation.z).toBe(0.3);
        expect(root.rotation.order).toBe("ZYX");
        expect(root.scale.toArray()).toEqual([2, 3, 4]);
    });

    it("restores the source transform when traversal throws", () => {
        const parent = new Object3D();
        const root = new Object3D();
        parent.add(root);
        root.position.set(1, 2, 3);
        root.rotation.set(0.4, 0.5, 0.6, "YZX");
        root.scale.set(4, 5, 6);

        const mesh = new Mesh(createIndexedTriangleGeometry());
        root.add(mesh);

        vi.spyOn(mesh, "getVertexPosition").mockImplementation(() => {
            throw new Error("forced extraction failure");
        });

        expect(() => GeometryExtractor.extractGeometries(root)).toThrow("forced extraction failure");
        expect(root.parent).toBe(parent);
        expect(root.position.toArray()).toEqual([1, 2, 3]);
        expect(root.rotation.x).toBe(0.4);
        expect(root.rotation.y).toBe(0.5);
        expect(root.rotation.z).toBe(0.6);
        expect(root.rotation.order).toBe("YZX");
        expect(root.scale.toArray()).toEqual([4, 5, 6]);
    });

    it("extracts geometry through very deep hierarchies without using recursive traversal", () => {
        const root = new Object3D();
        let cursor = root;
        for (let i = 0; i < 12_000; i++) {
            const child = new Object3D();
            child.position.x = 0.001;
            cursor.add(child);
            cursor = child;
        }

        cursor.add(new Mesh(createIndexedTriangleGeometry()));

        const traverseSpy = vi.spyOn(root, "traverse");
        const traverseVisibleSpy = vi.spyOn(root, "traverseVisible");
        const geometries = GeometryExtractor.extractGeometries(root);

        expect(geometries).toHaveLength(1);
        expect(traverseSpy).not.toHaveBeenCalled();
        expect(traverseVisibleSpy).not.toHaveBeenCalled();
    });
});
