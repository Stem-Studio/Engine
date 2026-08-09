import {Group, Mesh, MeshBasicMaterial, Object3D, BoxGeometry} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

const hoisted = vi.hoisted(() => ({
    gltfExporterParse: vi.fn(),
    gltfExporterSetTextureUtils: vi.fn(),
    showToast: vi.fn(),
    simplifyModel: vi.fn(),
    compressModel: vi.fn(),
    optimizeGlbFile: vi.fn(),
}));

vi.mock("three/addons/exporters/GLTFExporter.js", () => ({
    GLTFExporter: class {
        setTextureUtils = (...args: unknown[]) => hoisted.gltfExporterSetTextureUtils(...args);
        parse = (...args: unknown[]) => hoisted.gltfExporterParse(...args);
    },
}));

vi.mock("three/addons/utils/WebGLTextureUtils.js", () => ({}));

vi.mock("../showToast", () => ({
    showToast: (...args: unknown[]) => hoisted.showToast(...args),
}));

vi.mock("../utils/ModelUtils", () => ({
    ModelUtils: {
        simplifyModel: (...args: unknown[]) => hoisted.simplifyModel(...args),
        compressModel: (...args: unknown[]) => hoisted.compressModel(...args),
    },
    optimizeGlbFile: (...args: unknown[]) => hoisted.optimizeGlbFile(...args),
}));

import {convertToGlb} from "./convertToGlb";

function addDeepChain(root: Object3D, depth = 12_000): Object3D {
    let cursor = root;
    for (let i = 0; i < depth; i++) {
        const child = new Object3D();
        cursor.add(child);
        cursor = child;
    }
    return cursor;
}

describe("convertToGlb", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it("prepares deep export scenes without recursive Object3D traversal", async () => {
        const source = new Group();
        const leaf = addDeepChain(source);
        const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
        leaf.add(mesh);
        const exportedBuffer = new ArrayBuffer(8);
        hoisted.gltfExporterParse.mockImplementation((_scene, resolve: (value: ArrayBuffer) => void) => {
            resolve(exportedBuffer);
        });
        const traverse = vi.spyOn(Object3D.prototype, "traverse").mockImplementation(() => {
            throw new Error("recursive traversal should not be used");
        });

        const result = await convertToGlb(source, new AbortController().signal, {});

        expect(result).toBe(exportedBuffer);
        expect(hoisted.gltfExporterSetTextureUtils).toHaveBeenCalled();
        expect(hoisted.gltfExporterParse).toHaveBeenCalledTimes(1);
        expect(traverse).not.toHaveBeenCalled();
    });
});
