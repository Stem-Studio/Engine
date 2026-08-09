import {Group, Mesh} from "three";
import {describe, expect, it, vi} from "vitest";

import {OBJLoader2} from "./OBJLoader2";
import {OBJLoader2 as SharedOBJLoader2} from "../../../../../shared/src/assets/js/loaders/OBJLoader2";

const SIMPLE_OBJ = [
    "o triangle",
    "v 0 0 0",
    "v 1 0 0",
    "v 0 1 0",
    "f 1 2 3",
].join("\n");

const SIMPLE_MTL = [
    "newmtl red",
    "Kd 1.0 0.0 0.0",
].join("\n");

describe("OBJLoader2 compatibility adapter", () => {
    it("keeps the legacy named export available through shared re-exports", () => {
        expect(SharedOBJLoader2).toBe(OBJLoader2);
        expect(typeof new OBJLoader2().load).toBe("function");
        expect(typeof new OBJLoader2().parseAsync).toBe("function");
        expect(typeof OBJLoader2.Parser).toBe("function");
    });

    it("parses OBJ text into the legacy loaderRootNode return shape", () => {
        const loader = new OBJLoader2();

        const root = loader.parse(SIMPLE_OBJ);

        expect(root).toBeInstanceOf(Group);
        expect(root.children.some(child => child instanceof Mesh)).toBe(true);
    });

    it("keeps _loadObj legacy event wrapping for content-backed resources", () => {
        const loader = new OBJLoader2();
        loader.setModelName("legacy-obj");
        const onLoad = vi.fn();

        loader._loadObj({content: SIMPLE_OBJ, extension: "OBJ", name: "triangle.obj"}, onLoad);

        expect(onLoad).toHaveBeenCalledTimes(1);
        expect(onLoad.mock.calls[0]![0]).toMatchObject({
            detail: {
                modelName: "legacy-obj",
                instanceNo: 0,
            },
        });
        expect(onLoad.mock.calls[0]![0].detail.loaderRootNode.children.length).toBeGreaterThan(0);
    });

    it("keeps parseAsync callback shape without requiring the retired worker path", async () => {
        const loader = new OBJLoader2();

        const event = await new Promise<any>(resolve => {
            loader.parseAsync(SIMPLE_OBJ, resolve);
        });

        expect(event.detail.loaderRootNode).toBeInstanceOf(Group);
        expect(event.detail.loaderRootNode.children.length).toBeGreaterThan(0);
    });

    it("parses MTL content and stores a material creator for later OBJ parsing", () => {
        const loader = new OBJLoader2();
        const onLoad = vi.fn();

        loader.loadMtl("inline.mtl", SIMPLE_MTL, onLoad);

        expect(onLoad).toHaveBeenCalledTimes(1);
        expect(onLoad.mock.calls[0]![1]).toBeTruthy();
        expect(loader.materialCreator).toBe(onLoad.mock.calls[0]![1]);
        expect(loader.materialCreator.create("red")).toBeTruthy();
    });

    it("keeps the public Parser entry point backed by the maintained OBJ parser", () => {
        const parser = new OBJLoader2.Parser();
        const onMesh = vi.fn();
        parser.setCallbackMeshBuilder(onMesh);

        const group = parser.parseText(SIMPLE_OBJ);

        expect(group).toBeInstanceOf(Group);
        expect(group.children.length).toBeGreaterThan(0);
        expect(onMesh).toHaveBeenCalledWith(expect.objectContaining({cmd: "meshData", object: group}), []);
    });
});
