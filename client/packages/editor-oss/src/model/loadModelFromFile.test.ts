import {BoxGeometry, Group, Mesh, MeshBasicMaterial, Object3D} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

const hoisted = vi.hoisted(() => ({
    parseGlb: vi.fn(),
}));

vi.mock("../assets/js/loaders/GLTFLoaderExtended", () => ({
    default: class GLTFLoaderExtended {
        parseGlb = (...args: unknown[]) => hoisted.parseGlb(...args);
    },
}));

vi.mock("../assets/js/loaders/ModelLoader", () => ({
    default: class ModelLoader {
        load = vi.fn();
        dispose = vi.fn();
    },
}));

import {loadModelFromFile} from "./loadModelFromFile";

function addDeepChain(root: Object3D, depth = 12_000): Object3D {
    let cursor = root;
    for (let i = 0; i < depth; i++) {
        const child = new Object3D();
        cursor.add(child);
        cursor = child;
    }
    return cursor;
}

describe("loadModelFromFile", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it("validates deep GLB models from source buffers without recursive Object3D traversal", async () => {
        const model = new Group();
        const leaf = addDeepChain(model);
        leaf.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
        const sourceBuffer = new ArrayBuffer(16);
        hoisted.parseGlb.mockResolvedValue(model);
        const traverse = vi.spyOn(Object3D.prototype, "traverse").mockImplementation(() => {
            throw new Error("recursive traversal should not be used");
        });
        const file = new File([sourceBuffer], "avatar.glb", {type: "model/gltf-binary"});

        const result = await loadModelFromFile(
            file,
            new AbortController().signal,
            undefined,
            "",
            sourceBuffer,
        );

        expect(result.model).toBe(model);
        expect(result.rootFile).toBe(file);
        expect(hoisted.parseGlb).toHaveBeenCalledWith(sourceBuffer);
        expect(traverse).not.toHaveBeenCalled();
    });
});
