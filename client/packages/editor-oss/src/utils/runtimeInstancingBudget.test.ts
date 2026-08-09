import {BoxGeometry, Group, InstancedBufferAttribute, InstancedMesh, MeshBasicMaterial, Scene} from "three";
import {describe, expect, it, vi} from "vitest";

import {
    applyRuntimeInstancingBudget,
    applyRuntimeInstancingBudgetProgressive,
    restoreRuntimeInstancingBudget,
} from "./runtimeInstancingBudget";

function makeInstancedMesh(count: number, runtimeOnly = true): InstancedMesh {
    const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), count);
    mesh.userData.isRuntimeOnly = runtimeOnly;
    return mesh;
}

function addAtDeepLeaf(scene: Scene, object: InstancedMesh, depth = 512): void {
    const root = new Group();
    let parent = root;
    for (let i = 0; i < depth; i++) {
        const child = new Group();
        parent.add(child);
        parent = child;
    }
    parent.add(object);
    scene.add(root);
}

describe("runtimeInstancingBudget", () => {
    it("proportionally scales runtime-only instanced meshes to the triangle target", () => {
        const scene = new Scene();
        const first = makeInstancedMesh(100);
        const second = makeInstancedMesh(50);
        scene.add(first, second);

        const stats = applyRuntimeInstancingBudget(scene, {maxTotalSubmittedTriangles: 900});

        expect(stats.meshesConsidered).toBe(2);
        expect(stats.meshesCapped).toBe(2);
        expect(first.count).toBe(50);
        expect(second.count).toBe(25);
        expect(stats.originalSubmittedTriangles).toBe(1800);
        expect(stats.cappedSubmittedTriangles).toBe(900);
    });

    it("progressively scales runtime-only instanced meshes without changing results", async () => {
        const scene = new Scene();
        const first = makeInstancedMesh(100);
        const second = makeInstancedMesh(50);
        scene.add(first, second);
        let yields = 0;

        const stats = await applyRuntimeInstancingBudgetProgressive(scene, {
            maxTotalSubmittedTriangles: 900,
            batchSize: 1,
            frameBudgetMs: 0,
            yieldToFrame: async () => {
                yields++;
            },
        });

        expect(yields).toBeGreaterThan(0);
        expect(stats.meshesConsidered).toBe(2);
        expect(stats.meshesCapped).toBe(2);
        expect(first.count).toBe(50);
        expect(second.count).toBe(25);
        expect(stats.originalSubmittedTriangles).toBe(1800);
        expect(stats.cappedSubmittedTriangles).toBe(900);
    });

    it("does not cap authored or opted-out instanced meshes", () => {
        const scene = new Scene();
        const authored = makeInstancedMesh(100, false);
        const optedOut = makeInstancedMesh(100);
        optedOut.userData.disableRuntimeInstancingBudget = true;
        scene.add(authored, optedOut);

        const stats = applyRuntimeInstancingBudget(scene, {maxTotalSubmittedTriangles: 100});

        expect(stats.meshesConsidered).toBe(0);
        expect(authored.count).toBe(100);
        expect(optedOut.count).toBe(100);
    });

    it("can be disabled at scene level", () => {
        const scene = new Scene();
        scene.userData.rendering = {instancingBudget: {enabled: false}};
        const mesh = makeInstancedMesh(100);
        scene.add(mesh);

        const stats = applyRuntimeInstancingBudget(scene, {maxTotalSubmittedTriangles: 100});

        expect(stats.enabled).toBe(false);
        expect(mesh.count).toBe(100);
    });

    it("lets scene-level targets override the caller-provided target", () => {
        const scene = new Scene();
        scene.userData.rendering = {instancingBudget: {maxTotalSubmittedTriangles: 600}};
        const mesh = makeInstancedMesh(100);
        scene.add(mesh);

        const stats = applyRuntimeInstancingBudget(scene, {maxTotalSubmittedTriangles: 100});

        expect(stats.targetTriangles).toBe(600);
        expect(mesh.count).toBe(50);
    });

    it("caps an individual instanced mesh even when the total budget allows it", () => {
        const scene = new Scene();
        const mesh = makeInstancedMesh(100);
        scene.add(mesh);

        const stats = applyRuntimeInstancingBudget(scene, {
            maxTotalSubmittedTriangles: 2_000,
            maxSubmittedTrianglesPerMesh: 60,
        });

        expect(stats.maxSubmittedTrianglesPerMesh).toBe(60);
        expect(stats.meshesCapped).toBe(1);
        expect(mesh.count).toBe(5);
        expect(stats.cappedSubmittedTriangles).toBe(60);
    });

    it("limits first GPU upload ranges to the active capped instances", () => {
        const scene = new Scene();
        const mesh = makeInstancedMesh(100);
        mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(100 * 3), 3);
        scene.add(mesh);

        applyRuntimeInstancingBudget(scene, {maxTotalSubmittedTriangles: 600});

        expect(mesh.count).toBe(50);
        expect(mesh.instanceMatrix.updateRanges).toEqual([{start: 0, count: 50 * 16}]);
        expect(mesh.instanceColor.updateRanges).toEqual([{start: 0, count: 50 * 3}]);
    });

    it("restores original instance counts after play teardown", () => {
        const scene = new Scene();
        const mesh = makeInstancedMesh(100);
        scene.add(mesh);

        applyRuntimeInstancingBudget(scene, {maxTotalSubmittedTriangles: 600});
        expect(mesh.count).toBe(50);

        restoreRuntimeInstancingBudget(scene);

        expect(mesh.count).toBe(100);
    });

    it("applies and restores through deep hierarchies without Three's recursive traverse", () => {
        const scene = new Scene();
        const mesh = makeInstancedMesh(100);
        addAtDeepLeaf(scene, mesh);
        const traverseSpy = vi.spyOn(scene, "traverse");

        const stats = applyRuntimeInstancingBudget(scene, {maxTotalSubmittedTriangles: 600});

        expect(stats.meshesConsidered).toBe(1);
        expect(mesh.count).toBe(50);

        restoreRuntimeInstancingBudget(scene);

        expect(mesh.count).toBe(100);
        expect(traverseSpy).not.toHaveBeenCalled();
    });
});
