import * as THREE from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

const hoisted = vi.hoisted(() => ({
    stlLoad: vi.fn(),
    fbxLoad: vi.fn(),
    colladaLoad: vi.fn(),
    mtlLoad: vi.fn(),
    objLoad: vi.fn(),
    objSetMaterials: vi.fn(),
}));

vi.mock("three/addons/loaders/STLLoader.js", () => ({
    STLLoader: class MockSTLLoader {
        load = hoisted.stlLoad;
    },
}));

vi.mock("three/addons/loaders/FBXLoader.js", () => ({
    FBXLoader: class MockFBXLoader {
        load = hoisted.fbxLoad;
    },
}));

vi.mock("three/addons/loaders/ColladaLoader.js", () => ({
    ColladaLoader: class MockColladaLoader {
        load = hoisted.colladaLoad;
    },
}));

vi.mock("three/addons/loaders/MTLLoader.js", () => ({
    MTLLoader: class MockMTLLoader {
        load = hoisted.mtlLoad;
    },
}));

vi.mock("three/addons/loaders/OBJLoader.js", () => ({
    OBJLoader: class MockOBJLoader {
        load = hoisted.objLoad;
        setMaterials = hoisted.objSetMaterials;
    },
}));

import ColladaLoader from "./ColladaLoader";
import FBXLoader from "./FBXLoader";
import OBJLoader from "./OBJLoader";
import STLLoader from "./STLLoader";

afterEach(() => {
    hoisted.stlLoad.mockReset();
    hoisted.fbxLoad.mockReset();
    hoisted.colladaLoad.mockReset();
    hoisted.mtlLoad.mockReset();
    hoisted.objLoad.mockReset();
    hoisted.objSetMaterials.mockReset();
    vi.restoreAllMocks();
});

describe("direct addon loader wrappers", () => {
    it("loads STL files without the legacy package-manager require path", async () => {
        const geometry = new THREE.BufferGeometry();
        hoisted.stlLoad.mockImplementation((_url, onLoad) => onLoad(geometry));
        const loader = new STLLoader();
        loader.require = vi.fn();

        const result = await loader.load("/mesh.stl");

        expect(loader.require).not.toHaveBeenCalled();
        expect(hoisted.stlLoad).toHaveBeenCalledWith("/mesh.stl", expect.any(Function), undefined, expect.any(Function));
        expect(result).toBeInstanceOf(THREE.Mesh);
        expect(result.geometry).toBe(geometry);
    });

    it("loads FBX files without the legacy package-manager require path", async () => {
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        const object = new THREE.Object3D();
        hoisted.fbxLoad.mockImplementation((_url, onLoad) => onLoad(object));
        const loader = new FBXLoader();
        loader.require = vi.fn();

        const result = await loader.load("/model.fbx");

        expect(loader.require).not.toHaveBeenCalled();
        expect(hoisted.fbxLoad).toHaveBeenCalledWith("/model.fbx", expect.any(Function), undefined, expect.any(Function));
        expect(result).toBe(object);
        expect((object as any)._obj).toBe(object);
        expect((object as any)._root).toBe(object);
    });

    it("normalizes deep FBX mesh vertex-color flags without recursive traversal", async () => {
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        const root = new THREE.Object3D();
        let cursor: THREE.Object3D = root;
        for (let i = 0; i < 12_000; i++) {
            const child = new THREE.Object3D();
            cursor.add(child);
            cursor = child;
        }
        const geometry = new THREE.BoxGeometry();
        const material = new THREE.MeshBasicMaterial({vertexColors: true});
        (material as THREE.MeshBasicMaterial & {vertexColors: boolean}).vertexColors = true;
        const mesh = new THREE.Mesh(geometry, material);
        cursor.add(mesh);
        const traverseSpy = vi.spyOn(root, "traverse");
        hoisted.fbxLoad.mockImplementation((_url, onLoad) => onLoad(root));

        const result = await new FBXLoader().load("/deep.fbx");

        expect(result).toBe(root);
        expect(traverseSpy).not.toHaveBeenCalled();
        expect(mesh.material).not.toBe(material);
        expect((mesh.material as THREE.MeshBasicMaterial & {vertexColors: boolean}).vertexColors).toBe(false);
    });

    it("prepares deep Collada meshes without recursive traversal", async () => {
        const root = new THREE.Group();
        let cursor: THREE.Object3D = root;
        for (let i = 0; i < 12_000; i++) {
            const child = new THREE.Object3D();
            cursor.add(child);
            cursor = child;
        }
        const material = new THREE.MeshBasicMaterial();
        const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), material);
        mesh.frustumCulled = true;
        cursor.add(mesh);
        const traverseSpy = vi.spyOn(root, "traverse");
        hoisted.colladaLoad.mockImplementation((_url, onLoad) => onLoad({scene: root, animations: []}));

        const result = await new ColladaLoader().load("/deep.dae", {Name: "Deep"});

        expect(result).toBe(root);
        expect(traverseSpy).not.toHaveBeenCalled();
        expect((material as THREE.Material & {flatShading?: boolean}).flatShading).toBe(true);
        expect(mesh.frustumCulled).toBe(false);
    });

    it("loads OBJ files through the maintained OBJ and MTL addon loaders", async () => {
        const object = new THREE.Group();
        const mtl = {
            preload: vi.fn(),
            create: vi.fn(),
        };
        hoisted.mtlLoad.mockImplementation((_url, onLoad) => onLoad(mtl));
        hoisted.objLoad.mockImplementation((_url, onLoad) => onLoad(object));
        const loader = new OBJLoader();
        loader.require = vi.fn();

        const result = await loader.load(["/model.obj", "/model.mtl"]);

        expect(loader.require).not.toHaveBeenCalled();
        expect(hoisted.mtlLoad).toHaveBeenCalledWith("/model.mtl", expect.any(Function), undefined, expect.any(Function));
        expect(mtl.preload).toHaveBeenCalledTimes(1);
        expect(hoisted.objSetMaterials).toHaveBeenCalledWith(mtl);
        expect(hoisted.objLoad).toHaveBeenCalledWith("/model.obj", expect.any(Function), undefined, expect.any(Function));
        expect(result).toBe(object);
    });

    it("loads OBJ files when the paired MTL file is unavailable", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const object = new THREE.Group();
        hoisted.mtlLoad.mockImplementation((_url, _onLoad, _onProgress, onError) => onError(new Error("missing mtl")));
        hoisted.objLoad.mockImplementation((_url, onLoad) => onLoad(object));

        await expect(new OBJLoader().load(["/model.obj", "/missing.mtl"])).resolves.toBe(object);

        expect(hoisted.objSetMaterials).not.toHaveBeenCalled();
        expect(hoisted.objLoad).toHaveBeenCalledWith("/model.obj", expect.any(Function), undefined, expect.any(Function));
    });
});
