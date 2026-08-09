import {BoxGeometry, Group, Mesh, MeshBasicMaterial, Scene, SphereGeometry} from "three";
import {describe, expect, it} from "vitest";

import {
    applyEditorPreviewGeometryBudget,
    restoreEditorPreviewGeometryBudget,
} from "./editorPreviewGeometryBudget";

function makeModelMesh(): {scene: Scene; mesh: Mesh} {
    const scene = new Scene();
    const model = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    model.userData.modelId = "model-test";
    const mesh = new Mesh(new SphereGeometry(1, 32, 24), new MeshBasicMaterial());
    model.add(mesh);
    scene.add(model);
    return {scene, mesh};
}

describe("editorPreviewGeometryBudget", () => {
    it("simplifies imported model geometry and restores the source", () => {
        const {scene, mesh} = makeModelMesh();
        const source = mesh.geometry;
        const originalTriangles = source.index!.count / 3;

        const stats = applyEditorPreviewGeometryBudget(scene, {
            maxTotalTriangles: 400,
            maxTrianglesPerMesh: 400,
            minTriangles: 100,
            simplifyRatio: 0.25,
        });

        expect(stats.meshesConsidered).toBe(1);
        expect(stats.meshesSimplified).toBe(1);
        expect(mesh.geometry).not.toBe(source);
        expect(mesh.geometry.getAttribute("position").count).toBeLessThan(source.getAttribute("position").count);
        expect(originalTriangles).toBeGreaterThan(stats.previewTriangles);

        restoreEditorPreviewGeometryBudget(scene);
        expect(mesh.geometry).toBe(source);
    });

    it("does not touch non-model or grouped geometry", () => {
        const scene = new Scene();
        const plain = new Mesh(new SphereGeometry(1, 24, 16), new MeshBasicMaterial());
        const groupedRoot = new Group();
        groupedRoot.userData.modelId = "grouped";
        const grouped = new Mesh(new SphereGeometry(1, 24, 16), new MeshBasicMaterial());
        grouped.geometry.addGroup(0, grouped.geometry.index!.count, 0);
        groupedRoot.add(grouped);
        scene.add(plain, groupedRoot);

        const stats = applyEditorPreviewGeometryBudget(scene, {
            maxTotalTriangles: 10,
            minTriangles: 1,
        });

        expect(stats.meshesSimplified).toBe(0);
        expect(plain.geometry).toBeInstanceOf(SphereGeometry);
        expect(grouped.geometry).toBeInstanceOf(SphereGeometry);
    });

    it("restores prior preview geometry when disabled", () => {
        const {scene, mesh} = makeModelMesh();
        const source = mesh.geometry;
        applyEditorPreviewGeometryBudget(scene, {maxTotalTriangles: 400, minTriangles: 100});
        expect(mesh.geometry).not.toBe(source);

        scene.userData.rendering = {editorPreviewGeometryBudget: {enabled: false}};
        const stats = applyEditorPreviewGeometryBudget(scene);
        expect(stats.enabled).toBe(false);
        expect(mesh.geometry).toBe(source);
    });

    it("skips large source geometry without blocking editor startup", () => {
        const {scene, mesh} = makeModelMesh();
        const source = mesh.geometry;
        const stats = applyEditorPreviewGeometryBudget(scene, {
            maxTotalTriangles: 1,
            minTriangles: 1,
            maxSourceTriangles: 10,
        });

        expect(stats.meshesConsidered).toBe(1);
        expect(stats.meshesSimplified).toBe(0);
        expect(stats.meshesSkipped).toBe(1);
        expect(mesh.geometry).toBe(source);
    });
});
