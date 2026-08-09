import {describe, expect, it} from "vitest";
import {Object3D} from "three";

import {
    isGaussianSplatFormat,
    isGaussianSplatObject,
    isGaussianSplatPlyHeader,
    markGaussianSplatObject,
} from "./gaussianSplats";

describe("isGaussianSplatPlyHeader", () => {
    it("detects SPZ model format without network API dependencies", () => {
        expect(isGaussianSplatFormat("spz")).toBe(true);
        expect(isGaussianSplatFormat("SPZ")).toBe(true);
        expect(isGaussianSplatFormat("glb")).toBe(false);
        expect(isGaussianSplatFormat(undefined)).toBe(false);
    });

    it("detects gaussian splat PLY headers", () => {
        const header = [
            "ply",
            "format binary_little_endian 1.0",
            "element vertex 10",
            "property float x",
            "property float y",
            "property float z",
            "property float scale_0",
            "property float scale_1",
            "property float scale_2",
            "property float rot_0",
            "property float rot_1",
            "property float rot_2",
            "property float rot_3",
            "property float opacity",
            "property float f_dc_0",
            "end_header",
        ].join("\n");

        expect(isGaussianSplatPlyHeader(header)).toBe(true);
    });

    it("rejects regular mesh PLY headers", () => {
        const header = [
            "ply",
            "format ascii 1.0",
            "element vertex 8",
            "property float x",
            "property float y",
            "property float z",
            "property float nx",
            "property float ny",
            "property float nz",
            "element face 12",
            "property list uchar int vertex_indices",
            "end_header",
        ].join("\n");

        expect(isGaussianSplatPlyHeader(header)).toBe(false);
    });
});

describe("isGaussianSplatObject", () => {
    it("short-circuits after the first gaussian splat marker", () => {
        const root = new Object3D();
        const splat = new Object3D();
        const shouldNotBeVisited = new Object3D();
        let touchedSibling = false;

        markGaussianSplatObject(splat, "spz");
        Object.defineProperty(shouldNotBeVisited, "userData", {
            configurable: true,
            get() {
                touchedSibling = true;
                return {};
            },
        });

        root.add(splat, shouldNotBeVisited);

        expect(isGaussianSplatObject(root)).toBe(true);
        expect(touchedSibling).toBe(false);
    });

    it("detects nested splat meshes and rejects regular objects", () => {
        const root = new Object3D();
        const child = new Object3D();
        const splatMesh = new Object3D();
        Object.defineProperty(splatMesh, "type", {
            configurable: true,
            value: "SplatMesh",
        });
        child.add(splatMesh);
        root.add(child);

        expect(isGaussianSplatObject(root)).toBe(true);
        expect(isGaussianSplatObject(new Object3D())).toBe(false);
        expect(isGaussianSplatObject(null)).toBe(false);
    });
});
