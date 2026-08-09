import {BoxGeometry, InstancedBufferAttribute, InstancedMesh, MeshBasicMaterial, Scene} from "three";
import {describe, expect, it} from "vitest";

import {
    applyEditorPreviewInstancingBudget,
    restoreEditorPreviewInstancingBudget,
} from "./editorPreviewInstancingBudget";

function makeMesh(count: number, runtimeOnly = true): InstancedMesh {
    const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), count);
    mesh.userData.isRuntimeOnly = runtimeOnly;
    return mesh;
}

describe("editorPreviewInstancingBudget", () => {
    it("caps only runtime-only preview meshes to the requested triangle budget", () => {
        const scene = new Scene();
        const preview = makeMesh(100);
        const authored = makeMesh(100, false);
        scene.add(preview, authored);

        const stats = applyEditorPreviewInstancingBudget(scene, {
            maxTotalSubmittedTriangles: 600,
            maxSubmittedTrianglesPerMesh: 2_000,
        });

        expect(stats.meshesConsidered).toBe(1);
        expect(stats.meshesCapped).toBe(1);
        expect(preview.count).toBe(50);
        expect(authored.count).toBe(100);
        expect(stats.originalSubmittedTriangles).toBe(1_200);
        expect(stats.cappedSubmittedTriangles).toBe(600);
    });

    it("restores original counts and clears temporary metadata", () => {
        const scene = new Scene();
        const preview = makeMesh(100);
        scene.add(preview);

        applyEditorPreviewInstancingBudget(scene, {maxTotalSubmittedTriangles: 600});
        expect(preview.count).toBe(50);

        restoreEditorPreviewInstancingBudget(scene);
        expect(preview.count).toBe(100);
        expect(preview.userData.editorPreviewInstancingBudgetOriginalCount).toBeUndefined();
    });

    it("preserves the original count when applied repeatedly", () => {
        const scene = new Scene();
        const preview = makeMesh(100);
        scene.add(preview);

        applyEditorPreviewInstancingBudget(scene, {maxTotalSubmittedTriangles: 600});
        applyEditorPreviewInstancingBudget(scene, {maxTotalSubmittedTriangles: 300});

        expect(preview.count).toBe(25);
        restoreEditorPreviewInstancingBudget(scene);
        expect(preview.count).toBe(100);
    });

    it("honors scene opt-out and per-mesh caps", () => {
        const scene = new Scene();
        const optedOut = makeMesh(100);
        optedOut.userData.disableEditorPreviewInstancingBudget = true;
        const capped = makeMesh(100);
        scene.userData.rendering = {
            editorPreviewInstancingBudget: {
                maxTotalSubmittedTriangles: 2_000,
                maxSubmittedTrianglesPerMesh: 60,
            },
        };
        scene.add(optedOut, capped);

        const stats = applyEditorPreviewInstancingBudget(scene);

        expect(stats.meshesConsidered).toBe(1);
        expect(capped.count).toBe(5);
        expect(optedOut.count).toBe(100);
    });

    it("can disable the editor policy for a scene", () => {
        const scene = new Scene();
        const preview = makeMesh(100);
        scene.add(preview);

        applyEditorPreviewInstancingBudget(scene, {maxTotalSubmittedTriangles: 12});
        expect(preview.count).toBe(1);

        scene.userData.rendering = {
            editorPreviewInstancingBudget: {enabled: false},
        };
        const stats = applyEditorPreviewInstancingBudget(scene, {maxTotalSubmittedTriangles: 12});

        expect(stats.enabled).toBe(false);
        expect(preview.count).toBe(100);
        expect(preview.userData.editorPreviewInstancingBudgetOriginalCount).toBeUndefined();
    });

    it("limits the first instance-buffer upload to the active range", () => {
        const scene = new Scene();
        const preview = makeMesh(100);
        preview.instanceColor = new InstancedBufferAttribute(new Float32Array(100 * 3), 3);
        scene.add(preview);

        applyEditorPreviewInstancingBudget(scene, {maxTotalSubmittedTriangles: 600});

        expect(preview.instanceMatrix.updateRanges).toEqual([{start: 0, count: 50 * 16}]);
        expect(preview.instanceColor.updateRanges).toEqual([{start: 0, count: 50 * 3}]);
    });
});
