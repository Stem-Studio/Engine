import * as THREE from "three";
import {describe, expect, it, vi} from "vitest";

import {ensureRenderableMeshNormals, ensureRenderableMeshNormalsProgressive} from "./ensureRenderableMeshNormals";

function makeTriangleGeometry() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute([
            0, 0, 0,
            1, 0, 0,
            0, 1, 0,
        ], 3),
    );
    return geometry;
}

describe("ensureRenderableMeshNormals", () => {
    it("computes missing normals on mesh BufferGeometry", () => {
        const geometry = makeTriangleGeometry();
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
        const scene = new THREE.Scene();
        scene.add(mesh);

        const stats = ensureRenderableMeshNormals(scene);

        expect(geometry.getAttribute("normal")).toBeDefined();
        expect(geometry.getAttribute("normal").count).toBe(geometry.getAttribute("position").count);
        expect(stats.normalsComputed).toBe(1);
        expect(stats.maxComputeVertexCount).toBe(3);
        expect(stats.totalComputeMs).toBeGreaterThanOrEqual(0);
    });

    it("does not recompute valid normals", () => {
        const geometry = makeTriangleGeometry();
        geometry.computeVertexNormals();
        const originalNormal = geometry.getAttribute("normal");
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());

        const stats = ensureRenderableMeshNormals(mesh);

        expect(geometry.getAttribute("normal")).toBe(originalNormal);
        expect(stats.normalsComputed).toBe(0);
    });

    it("skips line and point primitives", () => {
        const scene = new THREE.Scene();
        const lineGeometry = makeTriangleGeometry();
        const pointsGeometry = makeTriangleGeometry();
        scene.add(new THREE.Line(lineGeometry, new THREE.LineBasicMaterial()));
        scene.add(new THREE.Points(pointsGeometry, new THREE.PointsMaterial()));

        const stats = ensureRenderableMeshNormals(scene);

        expect(lineGeometry.getAttribute("normal")).toBeUndefined();
        expect(pointsGeometry.getAttribute("normal")).toBeUndefined();
        expect(stats.meshesVisited).toBe(0);
        expect(stats.normalsComputed).toBe(0);
    });

    it("normalizes deeply nested meshes without recursive stack growth", () => {
        const scene = new THREE.Scene();
        let cursor: THREE.Object3D = scene;
        for (let i = 0; i < 12000; i++) {
            const child = new THREE.Object3D();
            cursor.add(child);
            cursor = child;
        }
        const geometry = makeTriangleGeometry();
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
        cursor.add(mesh);

        expect(() => ensureRenderableMeshNormals(scene)).not.toThrow();
        expect(geometry.getAttribute("normal")).toBeDefined();
    });

    it("can yield while progressively normalizing large scenes", async () => {
        const scene = new THREE.Scene();
        const geometries: THREE.BufferGeometry[] = [];
        const yieldToFrame = vi.fn(async () => {});
        for (let i = 0; i < 70; i++) {
            const geometry = makeTriangleGeometry();
            geometries.push(geometry);
            scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
        }

        const stats = await ensureRenderableMeshNormalsProgressive(scene, {
            batchSize: 16,
            frameBudgetMs: 1000,
            yieldToFrame,
        });

        expect(stats.normalsComputed).toBe(70);
        expect(yieldToFrame).toHaveBeenCalled();
        for (const geometry of geometries) {
            expect(geometry.getAttribute("normal")).toBeDefined();
        }
    });

    it("stops progressive normalization when cancelled between slices", async () => {
        const scene = new THREE.Scene();
        const geometries: THREE.BufferGeometry[] = [];
        let keepGoing = true;
        const yieldToFrame = vi.fn(async () => {
            keepGoing = false;
        });
        for (let i = 0; i < 10; i++) {
            const geometry = makeTriangleGeometry();
            geometries.push(geometry);
            scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
        }

        const stats = await ensureRenderableMeshNormalsProgressive(scene, {
            batchSize: 2,
            frameBudgetMs: 1000,
            yieldToFrame,
            shouldContinue: () => keepGoing,
        });

        expect(stats.normalsComputed).toBe(1);
        expect(yieldToFrame).toHaveBeenCalledTimes(1);
        expect(geometries[0]?.getAttribute("normal")).toBeDefined();
        expect(geometries.slice(1).every(geometry => geometry.getAttribute("normal") === undefined)).toBe(true);
    });

});
