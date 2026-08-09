import {
    BoxGeometry,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    Scene,
    Texture,
} from "three";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

const hoisted = vi.hoisted(() => ({
    gltfLoad: vi.fn(),
    setCrossOrigin: vi.fn(),
    setDRACOLoader: vi.fn(),
    setKTX2Loader: vi.fn(),
    setMeshoptDecoder: vi.fn(),
    register: vi.fn(),
    dracoDispose: vi.fn(),
    dracoPreload: vi.fn(),
    dracoSetDecoderPath: vi.fn(),
    dracoSetWorkerLimit: vi.fn(),
    ktxDispose: vi.fn(),
    ktxDetectSupport: vi.fn(),
    ktxSetTranscoderPath: vi.fn(function (this: unknown) {
        return this;
    }),
    ktxSetWorkerLimit: vi.fn(),
    isMobile: vi.fn(() => false),
    loadGLTFWithAssetResolution: vi.fn(async (url: string) => url),
    meshBvhConstruct: vi.fn(),
}));

vi.mock("meshoptimizer", () => ({
    MeshoptDecoder: {},
}));

vi.mock("three-mesh-bvh", () => ({
    acceleratedRaycast: vi.fn(),
    MeshBVH: class MockMeshBVH {
        constructor(geometry: unknown) {
            hoisted.meshBvhConstruct(geometry);
        }
    },
}));

vi.mock("three/addons/loaders/DRACOLoader.js", () => ({
    DRACOLoader: class MockDRACOLoader {
        dispose = hoisted.dracoDispose;
        preload = hoisted.dracoPreload;
        setDecoderPath = hoisted.dracoSetDecoderPath;
        setWorkerLimit = hoisted.dracoSetWorkerLimit;
    },
}));

vi.mock("three/addons/loaders/KTX2Loader.js", () => ({
    KTX2Loader: class MockKTX2Loader {
        dispose = hoisted.ktxDispose;
        detectSupport = hoisted.ktxDetectSupport;
        setTranscoderPath = hoisted.ktxSetTranscoderPath;
        setWorkerLimit = hoisted.ktxSetWorkerLimit;
    },
}));

vi.mock("three/addons/loaders/GLTFLoader.js", () => ({
    GLTFLoader: class MockGLTFLoader {
        load = hoisted.gltfLoad;
        register = hoisted.register;
        setCrossOrigin = hoisted.setCrossOrigin;
        setDRACOLoader = hoisted.setDRACOLoader;
        setKTX2Loader = hoisted.setKTX2Loader;
        setMeshoptDecoder = hoisted.setMeshoptDecoder;
    },
}));

vi.mock("../../../utils/DetectDevice", () => ({
    DetectDevice: {
        isMobile: hoisted.isMobile,
    },
}));

vi.mock("../../../utils/LoaderWrappers", () => ({
    loadGLTFWithAssetResolution: hoisted.loadGLTFWithAssetResolution,
}));

import GLTFLoader from "./GLTFLoader";

const makeDeepScene = () => {
    const scene = new Scene();
    let cursor: Object3D = scene;
    for (let i = 0; i < 12000; i++) {
        const child = new Object3D();
        cursor.add(child);
        cursor = child;
    }

    const texture = new Texture();
    (texture as any).image = {width: 512, height: 512};
    (texture as any).mipmaps = [
        {width: 512, height: 512},
        {width: 256, height: 256},
        {width: 128, height: 128},
    ];
    const material = new MeshBasicMaterial({map: texture});
    const mesh = new Mesh(new BoxGeometry(), material);
    cursor.add(mesh);
    return {scene, material, texture};
};

describe("GLTFLoader traversal", () => {
    beforeEach(() => {
        for (const mock of Object.values(hoisted)) {
            if (typeof mock === "function" && "mockReset" in mock) {
                mock.mockReset();
            }
        }
        hoisted.isMobile.mockReturnValue(false);
        hoisted.loadGLTFWithAssetResolution.mockImplementation(async (url: string) => url);
        hoisted.ktxSetTranscoderPath.mockImplementation(function (this: unknown) {
            return this;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("loads deep scenes through cache and mobile mip paths without recursive Object3D traversal", async () => {
        const {scene, material, texture} = makeDeepScene();
        const traverse = vi.spyOn(scene, "traverse");
        hoisted.isMobile.mockReturnValue(true);
        hoisted.gltfLoad.mockImplementation((_url, onLoad) => {
            onLoad({scene, parser: {}, animations: []});
        });

        const loader = new GLTFLoader();
        const result = await loader.load("/deep.glb");
        loader.dispose();

        expect(result).toBe(scene);
        expect(traverse).not.toHaveBeenCalled();
        expect(hoisted.meshBvhConstruct).toHaveBeenCalledTimes(1);
        expect(material.map).toBe(texture);
        expect((texture as any).image.width).toBeLessThanOrEqual(128);
        expect(hoisted.gltfLoad).toHaveBeenCalledWith("/deep.glb", expect.any(Function), undefined, expect.any(Function));
    });
});
