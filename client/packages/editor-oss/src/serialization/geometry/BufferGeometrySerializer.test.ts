import * as THREE from "three";
import { Brush, Evaluator, ADDITION } from "three-bvh-csg";
import { afterEach, describe, it, expect, beforeAll, vi } from "vitest";

import BufferGeometrySerializer from "./BufferGeometrySerializer";
import GeometriesSerializer from "./GeometriesSerializer";
import CustomTube, { CurveType } from "@stem/editor-oss/object/geometry/CustomTube";

describe("BufferGeometrySerializer", () => {
    beforeAll(async () => {
        // Initialize any required dependencies
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("omits default geometry properties without stringifying every field", () => {
        const stringify = vi.spyOn(JSON, "stringify");
        const geometry = new THREE.BufferGeometry();

        const json = new BufferGeometrySerializer().toJSON(geometry);

        expect(stringify).not.toHaveBeenCalled();
        expect(json.metadata?.generator).toBe("BufferGeometrySerializer");
        expect(json.parameters).toBeUndefined();
        expect(json.userData).toBeUndefined();
    });

    describe("CSG Geometries", () => {
        it("should serialize and deserialize CSG result geometry with all vertex data", () => {
            // Create two simple boxes for CSG operation
            const box1 = new THREE.Mesh(
                new THREE.BoxGeometry(2, 2, 2),
                new THREE.MeshStandardMaterial(),
            );
            box1.position.set(0, 0, 0);
            box1.updateMatrixWorld(true);

            const box2 = new THREE.Mesh(
                new THREE.BoxGeometry(2, 2, 2),
                new THREE.MeshStandardMaterial(),
            );
            box2.position.set(1, 0, 0);
            box2.updateMatrixWorld(true);

            // Perform CSG union operation
            const evaluator = new Evaluator();
            const brush1 = new Brush(box1.geometry.clone().applyMatrix4(box1.matrixWorld));
            const brush2 = new Brush(box2.geometry.clone().applyMatrix4(box2.matrixWorld));
            const resultBrush = evaluator.evaluate(brush1, brush2, ADDITION);
            const resultGeometry = resultBrush.geometry;

            // Verify the result has vertices
            expect(resultGeometry.attributes.position).toBeDefined();
            expect(resultGeometry.attributes.position!.count).toBeGreaterThan(0);
            const originalVertexCount = resultGeometry.attributes.position!.count;

            // Serialize the CSG result geometry
            const serializer = new BufferGeometrySerializer();
            const json = serializer.toJSON(resultGeometry);

            // Verify JSON contains geometry data
            expect(json).toBeDefined();
            expect(json.data).toBeDefined();
            expect(json.data.attributes).toBeDefined();
            expect(json.data.attributes.position).toBeDefined();

            // Deserialize back to geometry
            const deserializedGeometry = serializer.fromJSON(json);

            // Verify deserialized geometry has same vertex count
            expect(deserializedGeometry).toBeDefined();
            expect(deserializedGeometry.attributes.position).toBeDefined();
            expect(deserializedGeometry.attributes.position.count).toBe(originalVertexCount);

            // Verify vertex data is preserved
            const originalPositions = resultGeometry.attributes.position!.array;
            const deserializedPositions = deserializedGeometry.attributes.position.array;
            expect(deserializedPositions.length).toBe(originalPositions.length);

            // Check a few vertices match
            for (let i = 0; i < Math.min(30, originalPositions.length); i += 3) {
                expect(deserializedPositions[i]).toBeCloseTo(originalPositions[i] as number, 5);
                expect(deserializedPositions[i + 1]).toBeCloseTo(originalPositions[i + 1] as number, 5);
                expect(deserializedPositions[i + 2]).toBeCloseTo(originalPositions[i + 2] as number, 5);
            }
        });

        it("should preserve normals and UVs from custom BufferGeometry (non-parametric)", () => {
            // Create a custom BufferGeometry (not a parametric geometry like BoxGeometry)
            // This simulates what a CSG operation would produce
            const geometry = new THREE.BufferGeometry();

            const vertices = new Float32Array([
                -1, -1, 0,
                1, -1, 0,
                1, 1, 0,
                -1, 1, 0,
            ]);

            const normals = new Float32Array([
                0, 0, 1,
                0, 0, 1,
                0, 0, 1,
                0, 0, 1,
            ]);

            const uvs = new Float32Array([
                0, 0,
                1, 0,
                1, 1,
                0, 1,
            ]);

            const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

            geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
            geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
            geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
            geometry.setIndex(new THREE.BufferAttribute(indices, 1));

            // Verify original has normals and UVs
            expect(geometry.attributes.normal).toBeDefined();
            expect(geometry.attributes.uv).toBeDefined();

            // Serialize using BufferGeometrySerializer (for non-parametric geometries)
            const serializer = new BufferGeometrySerializer();
            const json = serializer.toJSON(geometry);

            // Verify JSON contains normals and UVs
            expect(json.data).toBeDefined();
            expect(json.data.attributes.normal).toBeDefined();
            expect(json.data.attributes.uv).toBeDefined();

            // Deserialize
            const deserialized = serializer.fromJSON(json);

            // Verify normals and UVs are preserved
            expect(deserialized.attributes.normal).toBeDefined();
            expect(deserialized.attributes.uv).toBeDefined();
            expect(deserialized.attributes.normal!.count).toBe(geometry.attributes.normal!.count);
            expect(deserialized.attributes.uv!.count).toBe(geometry.attributes.uv!.count);
        });
    });

    describe("Parametric Geometries", () => {
        it("should serialize and deserialize BoxGeometry correctly", () => {
            const box = new THREE.BoxGeometry(2, 3, 4, 2, 3, 4);
            const originalVertexCount = box.attributes.position!.count;

            // Serialize using GeometriesSerializer (which uses BoxBufferGeometrySerializer)
            const serializer = new GeometriesSerializer();
            const json = serializer.toJSON(box);

            // Deserialize
            const deserialized = serializer.fromJSON(json);

            // Verify geometry is recreated correctly
            expect(deserialized).toBeDefined();
            expect(deserialized.attributes.position).toBeDefined();
            expect(deserialized.attributes.position.count).toBe(originalVertexCount);
            expect(deserialized.parameters).toBeDefined();
            expect(deserialized.parameters.width).toBe(2);
            expect(deserialized.parameters.height).toBe(3);
            expect(deserialized.parameters.depth).toBe(4);
        });

        it("should serialize and deserialize SphereGeometry correctly", () => {
            const sphere = new THREE.SphereGeometry(5, 32, 16);
            const originalVertexCount = sphere.attributes.position!.count;

            const serializer = new GeometriesSerializer();
            const json = serializer.toJSON(sphere);
            const deserialized = serializer.fromJSON(json);

            expect(deserialized).toBeDefined();
            expect(deserialized.attributes.position.count).toBe(originalVertexCount);
            expect(deserialized.parameters).toBeDefined();
            expect(deserialized.parameters.radius).toBe(5);
            expect(deserialized.parameters.widthSegments).toBe(32);
            expect(deserialized.parameters.heightSegments).toBe(16);
        });

        it("should serialize and deserialize CylinderGeometry correctly", () => {
            const cylinder = new THREE.CylinderGeometry(2, 3, 10, 32);
            const originalVertexCount = cylinder.attributes.position!.count;

            const serializer = new GeometriesSerializer();
            const json = serializer.toJSON(cylinder);
            const deserialized = serializer.fromJSON(json);

            expect(deserialized).toBeDefined();
            expect(deserialized.attributes.position.count).toBe(originalVertexCount);
            expect(deserialized.parameters).toBeDefined();
            expect(deserialized.parameters.radiusTop).toBe(2);
            expect(deserialized.parameters.radiusBottom).toBe(3);
            expect(deserialized.parameters.height).toBe(10);
        });
    });

    describe("CustomTube Geometries", () => {
        it("should serialize and deserialize CustomTube with curve points", () => {
            const curvePoints = [
                new THREE.Vector3(-2, 0, 0),
                new THREE.Vector3(-1, 1, 0),
                new THREE.Vector3(1, -1, 0),
                new THREE.Vector3(2, 0, 0),
            ];

            const customTube = new CustomTube(
                curvePoints,
                CurveType.CATMULL_ROM,
                64,
                0.2,
                8,
                false,
                0,
            );

            const originalVertexCount = customTube.geometry.attributes.position!.count;

            // CustomTube has its own serializer, but it uses GeometriesSerializer for geometry
            const serializer = new GeometriesSerializer();
            const json = serializer.toJSON(customTube.geometry);
            const deserialized = serializer.fromJSON(json);

            expect(deserialized).toBeDefined();
            expect(deserialized.attributes.position).toBeDefined();
            expect(deserialized.attributes.position.count).toBe(originalVertexCount);
        });
    });

    describe("CustomShape Geometries", () => {
        it("should serialize and deserialize ExtrudeGeometry (used by CustomShape)", () => {
            // Create a simple shape and extrude it (similar to what CustomShape does)
            const shape = new THREE.Shape();
            shape.moveTo(0, 0);
            shape.lineTo(10, 0);
            shape.lineTo(10, 10);
            shape.lineTo(0, 10);
            shape.closePath();

            const extrudeSettings = {
                depth: 5,
                bevelEnabled: false,
            };

            const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
            const originalVertexCount = geometry.attributes.position!.count;

            const serializer = new GeometriesSerializer();
            const json = serializer.toJSON(geometry);
            const deserialized = serializer.fromJSON(json);

            expect(deserialized).toBeDefined();
            expect(deserialized.attributes.position).toBeDefined();
            expect(deserialized.attributes.position.count).toBe(originalVertexCount);
        });
    });

    describe("Plain BufferGeometry", () => {
        it("should serialize and deserialize custom BufferGeometry with attributes", () => {
            // Create a custom geometry (like what CSG produces)
            const geometry = new THREE.BufferGeometry();

            // Create vertices for a simple triangle
            const vertices = new Float32Array([
                0, 0, 0,
                1, 0, 0,
                0, 1, 0,
            ]);

            const normals = new Float32Array([
                0, 0, 1,
                0, 0, 1,
                0, 0, 1,
            ]);

            const uvs = new Float32Array([
                0, 0,
                1, 0,
                0, 1,
            ]);

            geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
            geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
            geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));

            // Serialize
            const serializer = new BufferGeometrySerializer();
            const json = serializer.toJSON(geometry);

            // Verify JSON has all data
            expect(json.data).toBeDefined();
            expect(json.data.attributes.position).toBeDefined();
            expect(json.data.attributes.normal).toBeDefined();
            expect(json.data.attributes.uv).toBeDefined();

            // Deserialize
            const deserialized = serializer.fromJSON(json);

            // Verify all attributes are preserved
            expect(deserialized.attributes.position).toBeDefined();
            expect(deserialized.attributes.normal).toBeDefined();
            expect(deserialized.attributes.uv).toBeDefined();

            // Verify vertex data
            expect(deserialized.attributes.position.count).toBe(3);
            const positions = deserialized.attributes.position.array;
            expect(positions[0]).toBeCloseTo(0);
            expect(positions[1]).toBeCloseTo(0);
            expect(positions[2]).toBeCloseTo(0);
            expect(positions[3]).toBeCloseTo(1);
            expect(positions[4]).toBeCloseTo(0);
            expect(positions[5]).toBeCloseTo(0);
        });

        it("should handle empty BufferGeometry", () => {
            const geometry = new THREE.BufferGeometry();

            const serializer = new BufferGeometrySerializer();
            const json = serializer.toJSON(geometry);
            const deserialized = serializer.fromJSON(json);

            expect(deserialized).toBeDefined();
            expect(deserialized instanceof THREE.BufferGeometry).toBe(true);
        });
    });

    describe("Regression Tests", () => {
        it("should not lose mesh data when saving and loading a scene with CSG geometry", () => {
            // This simulates the actual bug report scenario
            const box1 = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
            box1.updateMatrixWorld(true);

            const box2 = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
            box2.position.set(0.5, 0, 0);
            box2.updateMatrixWorld(true);

            // Perform CSG
            const evaluator = new Evaluator();
            const brush1 = new Brush(box1.geometry.clone().applyMatrix4(box1.matrixWorld));
            const brush2 = new Brush(box2.geometry.clone().applyMatrix4(box2.matrixWorld));
            const result = evaluator.evaluate(brush1, brush2, ADDITION);

            // Create mesh with CSG result
            const csgMesh = new THREE.Mesh(result.geometry);
            csgMesh.name = "CSG_union_Result";

            expect(csgMesh.geometry.attributes.position!.count).toBeGreaterThan(0);

            // Serialize the geometry (simulating save)
            const serializer = new GeometriesSerializer();
            const json = serializer.toJSON(csgMesh.geometry);

            // Deserialize (simulating load)
            const loadedGeometry = serializer.fromJSON(json);

            // Verify the mesh is not lost
            expect(loadedGeometry).toBeDefined();
            expect(loadedGeometry.attributes.position).toBeDefined();
            expect(loadedGeometry.attributes.position.count).toBeGreaterThan(0);
            expect(loadedGeometry.attributes.position.count).toBe(
                csgMesh.geometry.attributes.position!.count,
            );
        });
    });
});
