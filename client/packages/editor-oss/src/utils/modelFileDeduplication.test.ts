import {describe, it, expect} from "vitest";

import {deduplicateModelFiles, isUnprocessableFormat} from "./modelFileDeduplication";

const file = (name: string) => ({name});

describe("isUnprocessableFormat", () => {
    it("returns true for .blend files", () => {
        expect(isUnprocessableFormat("chair.blend")).toBe(true);
    });

    it("returns false for processable formats", () => {
        expect(isUnprocessableFormat("model.glb")).toBe(false);
        expect(isUnprocessableFormat("model.fbx")).toBe(false);
        expect(isUnprocessableFormat("model.obj")).toBe(false);
        expect(isUnprocessableFormat("model.usd")).toBe(false);
        expect(isUnprocessableFormat("model.usda")).toBe(false);
        expect(isUnprocessableFormat("model.usdc")).toBe(false);
        expect(isUnprocessableFormat("model.usdz")).toBe(false);
    });
});

describe("deduplicateModelFiles", () => {
    it("returns empty array for empty input", () => {
        expect(deduplicateModelFiles([])).toEqual([]);
    });

    it("returns single processable file as-is", () => {
        const files = [file("chair.glb")];
        expect(deduplicateModelFiles(files)).toEqual([file("chair.glb")]);
    });

    it("filters out single unprocessable file", () => {
        const files = [file("chair.blend")];
        expect(deduplicateModelFiles(files)).toEqual([]);
    });

    it("picks GLB over FBX and OBJ for same base name", () => {
        const files = [file("chair.obj"), file("chair.fbx"), file("chair.glb")];
        const result = deduplicateModelFiles(files);
        expect(result).toHaveLength(1);
        expect(result[0]!.name).toBe("chair.glb");
    });

    it("picks FBX over OBJ when no GLB exists", () => {
        const files = [file("chair.obj"), file("chair.fbx")];
        const result = deduplicateModelFiles(files);
        expect(result).toHaveLength(1);
        expect(result[0]!.name).toBe("chair.fbx");
    });

    it("keeps files with different base names", () => {
        const files = [file("table.fbx"), file("chair.glb")];
        const result = deduplicateModelFiles(files);
        expect(result).toHaveLength(2);
        const names = result.map(f => f.name).sort();
        expect(names).toEqual(["chair.glb", "table.fbx"]);
    });

    it("handles case-insensitive base name matching", () => {
        const files = [file("Chair.GLB"), file("chair.fbx")];
        const result = deduplicateModelFiles(files);
        expect(result).toHaveLength(1);
        expect(result[0]!.name).toBe("Chair.GLB");
    });

    it("filters out unprocessable formats from mixed input", () => {
        const files = [file("chair.blend"), file("chair.glb"), file("table.usd")];
        const result = deduplicateModelFiles(files);
        expect(result.map(item => item.name).sort()).toEqual(["chair.glb", "table.usd"]);
    });

    it("preserves full file objects with extra properties", () => {
        const files = [{name: "model.glb", fullPath: "/path/to/model.glb"}];
        const result = deduplicateModelFiles(files);
        expect(result[0]).toEqual({name: "model.glb", fullPath: "/path/to/model.glb"});
    });

    it("handles files with path prefixes in name", () => {
        const files = [file("models/chair.fbx"), file("exports/chair.glb")];
        const result = deduplicateModelFiles(files);
        expect(result).toHaveLength(1);
        expect(result[0]!.name).toBe("exports/chair.glb");
    });

    it("returns empty array when all files are unprocessable", () => {
        const files = [file("a.blend")];
        expect(deduplicateModelFiles(files)).toEqual([]);
    });

    it("handles USD variants as processable formats", () => {
        const files = [file("model.usd"), file("model.usda"), file("model.usdc"), file("model.usdz")];
        const result = deduplicateModelFiles(files);
        expect(result).toHaveLength(1);
        expect(result[0]!.name).toBe("model.usdz");
    });

    it("picks GLB over USD variants for the same base name", () => {
        const files = [file("model.usdz"), file("model.glb")];
        const result = deduplicateModelFiles(files);
        expect(result).toHaveLength(1);
        expect(result[0]!.name).toBe("model.glb");
    });
});
