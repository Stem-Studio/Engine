import {BoxGeometry, InstancedMesh, Mesh, MeshStandardMaterial, Object3D, Scene} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import Instancer from "./Instancer";

function addDeepChain(root: Object3D, depth = 12_000): Object3D {
    let cursor = root;
    for (let i = 0; i < depth; i++) {
        const child = new Object3D();
        cursor.add(child);
        cursor = child;
    }
    return cursor;
}

function createInstancingRoot(index: number): Object3D {
    const root = new Object3D();
    root.name = `AssetRoot-${index}`;
    root.userData = {
        isStemObject: true,
        modelId: "shared-model",
        modelRevisionId: "shared-revision",
    };

    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    mesh.name = `Mesh-${index}`;
    root.add(mesh);
    return root;
}

describe("Instancer", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("discovers instancing roots in deep scenes without Three recursive traversal", () => {
        const scene = new Scene();
        const leaf = addDeepChain(scene);
        for (let i = 0; i < 4; i++) {
            leaf.add(createInstancingRoot(i));
        }
        const traverse = vi.spyOn(scene, "traverse");
        const instancer = new Instancer();

        instancer.convertMeshesToInstancedMeshes(scene);

        expect(traverse).not.toHaveBeenCalled();
        const instancedMeshes = scene.children.filter((child): child is InstancedMesh => child instanceof InstancedMesh);
        expect(instancedMeshes).toHaveLength(1);
        expect(instancedMeshes[0]!.count).toBe(4);
        expect(leaf.children.filter(child => child.name.startsWith("AssetRoot-"))).toHaveLength(4);
        instancer.dispose(scene);
    });

    it("progressively converts large batches without refreshing bounds per instance", async () => {
        const scene = new Scene();
        for (let i = 0; i < 64; i++) {
            scene.add(createInstancingRoot(i));
        }
        const yieldToFrame = vi.fn(async () => {});
        const computeBoundingBox = vi.spyOn(InstancedMesh.prototype, "computeBoundingBox");
        const instancer = new Instancer();

        await instancer.convertMeshesToInstancedMeshesProgressive(scene, {
            batchSize: 8,
            frameBudgetMs: 0,
            yieldToFrame,
        });

        const instancedMeshes = scene.children.filter((child): child is InstancedMesh => child instanceof InstancedMesh);
        expect(instancedMeshes).toHaveLength(1);
        expect(instancedMeshes[0]!.count).toBe(64);
        expect(yieldToFrame).toHaveBeenCalled();
        expect(computeBoundingBox).toHaveBeenCalledTimes(1);

        instancer.dispose(scene);
    });
});
