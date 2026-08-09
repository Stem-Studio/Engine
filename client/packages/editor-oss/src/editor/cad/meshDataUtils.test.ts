import * as THREE from "three";
import {describe, expect, it} from "vitest";

import {MeshData} from "./MeshData";
import {createGeometryFromMeshData, createMeshDataFromGeometry} from "./meshDataUtils";

describe("meshDataUtils", () => {
    it("creates one quad face from a primitive plane without splitting triangles", () => {
        const geometry = new THREE.PlaneGeometry(1, 1);

        const meshData = createMeshDataFromGeometry(geometry);
        const faces = Array.from(meshData.faces.values());

        expect(meshData.vertices.size).toBe(4);
        expect(faces).toHaveLength(1);
        expect(faces[0]!.vertexIds).toHaveLength(4);
    });

    it("merges connected coplanar triangles into one editable face", () => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(
                [
                    0, 0, 0,
                    1, 0, 0,
                    1, 1, 0,
                    0, 1, 0,
                ],
                3,
            ),
        );
        geometry.setIndex([0, 1, 2, 0, 2, 3]);

        const meshData = createMeshDataFromGeometry(geometry);
        const faces = Array.from(meshData.faces.values());

        expect(meshData.vertices.size).toBe(4);
        expect(faces).toHaveLength(1);
        expect(faces[0]!.vertexIds).toHaveLength(4);
    });

    it("orders tilted coplanar quad vertices without splitting the face", () => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(
                [
                    0, 0, 0,
                    1, 0, 1,
                    1, 1, 1,
                    0, 1, 0,
                ],
                3,
            ),
        );
        geometry.setIndex([0, 1, 2, 0, 2, 3]);

        const meshData = createMeshDataFromGeometry(geometry);
        const faces = Array.from(meshData.faces.values());

        expect(meshData.vertices.size).toBe(4);
        expect(faces).toHaveLength(1);
        expect(faces[0]!.vertexIds).toHaveLength(4);
        expect(new Set(faces[0]!.vertexIds)).toHaveLength(4);
    });

    it("triangulates editable quad faces without changing vertex order", () => {
        const meshData = new MeshData();
        const a = meshData.addVertex({x: 0, y: 0, z: 0});
        const b = meshData.addVertex({x: 1, y: 0, z: 0});
        const c = meshData.addVertex({x: 1, y: 1, z: 0});
        const d = meshData.addVertex({x: 0, y: 1, z: 0});
        meshData.addFace([a.id, b.id, c.id, d.id]);

        const geometry = createGeometryFromMeshData(meshData);
        const positions = geometry.getAttribute("position");

        expect(positions.count).toBe(4);
        expect(positions.array).toBeInstanceOf(Float32Array);
        expect(geometry.index!.array).toBeInstanceOf(Uint16Array);
        expect(Array.from(geometry.index!.array)).toEqual([0, 1, 2, 0, 2, 3]);
    });
});
