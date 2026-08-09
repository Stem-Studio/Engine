import {describe, expect, it, vi} from "vitest";
import {BoxGeometry, MeshBasicMaterial, Object3D, Scene, SkinnedMesh} from "three";

vi.mock("@querielo/spark", async () => {
    const {Object3D} = await vi.importActual<typeof import("three")>("three");
    return {
        SparkWebGpuRenderer: class SparkWebGpuRenderer extends Object3D {
            dispose = vi.fn();
            prepareComposite = vi.fn();
        },
    };
});

import {
    collectSkinnedDepthCandidates,
    ensureSparkComposite,
    getVisibleSkinnedDepthMeshes,
} from "./SparkCompositeBridge";
import {SparkWebGpuRenderer} from "@querielo/spark";

function createDepthWritingSkinnedMesh(): SkinnedMesh {
    return new SkinnedMesh(
        new BoxGeometry(1, 1, 1),
        new MeshBasicMaterial({depthWrite: true}),
    );
}

function addDeepObjectChain(root: Object3D, depth: number): Object3D {
    let current = root;
    for (let i = 0; i < depth; i++) {
        const child = new Object3D();
        child.name = `spark-composite-depth-${i}`;
        current.add(child);
        current = child;
    }
    return current;
}

describe("SparkCompositeBridge skinned depth scan", () => {
    it("reuses an existing deep Spark composite without recursive name lookup", () => {
        const scene = new Scene();
        const leaf = addDeepObjectChain(scene, 12000);
        const existing = new SparkWebGpuRenderer({renderer: {}} as never);
        existing.name = "__SparkWebGpuRenderer";
        leaf.add(existing);
        const getObjectByName = vi.spyOn(scene, "getObjectByName").mockImplementation(() => {
            throw new Error("recursive name lookup should not be used");
        });

        const result = ensureSparkComposite(scene, {} as never);

        expect(result).toBe(existing);
        expect(result.parent).toBe(scene);
        expect(getObjectByName).not.toHaveBeenCalled();
    });

    it("collects skinned depth candidates in deep scenes without Object3D.traverse recursion", () => {
        const scene = new Scene();
        const leaf = addDeepObjectChain(scene, 12000);
        const mesh = createDepthWritingSkinnedMesh();
        leaf.add(mesh);
        const traverse = vi.spyOn(scene, "traverse");

        const candidates = collectSkinnedDepthCandidates(scene);

        expect(candidates).toEqual([mesh]);
        expect(traverse).not.toHaveBeenCalled();
    });

    it("filters cached skinned depth candidates by effective visibility", () => {
        const scene = new Scene();
        const visibleMesh = createDepthWritingSkinnedMesh();
        const hiddenParent = new Object3D();
        const hiddenMesh = createDepthWritingSkinnedMesh();
        hiddenParent.visible = false;
        hiddenParent.add(hiddenMesh);
        scene.add(visibleMesh, hiddenParent);
        const runtime = new Object3D();

        const visible = getVisibleSkinnedDepthMeshes(runtime, scene);

        expect(visible).toEqual([visibleMesh]);
    });
});
