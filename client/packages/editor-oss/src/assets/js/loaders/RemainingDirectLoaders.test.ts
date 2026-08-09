import * as THREE from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

const hoisted = vi.hoisted(() => ({
    gltfLoad: vi.fn(),
    pdbLoad: vi.fn(),
    register: vi.fn(),
    setMeshoptDecoder: vi.fn(),
    removeUnnecessaryVertices: vi.fn(),
    meshoptDecoder: {},
}));

vi.mock("meshoptimizer", () => ({
    MeshoptDecoder: hoisted.meshoptDecoder,
}));

vi.mock("@pixiv/three-vrm", () => ({
    VRMLoaderPlugin: class MockVRMLoaderPlugin {
        parser: unknown;

        constructor(parser: unknown) {
            this.parser = parser;
        }
    },
    VRMUtils: {
        removeUnnecessaryVertices: hoisted.removeUnnecessaryVertices,
    },
}));

vi.mock("three/addons/loaders/GLTFLoader.js", () => ({
    GLTFLoader: class MockGLTFLoader {
        register = hoisted.register;
        setMeshoptDecoder = hoisted.setMeshoptDecoder;
        load = hoisted.gltfLoad;
    },
}));

vi.mock("three/addons/loaders/PDBLoader.js", () => ({
    PDBLoader: class MockPDBLoader {
        load = hoisted.pdbLoad;
    },
}));

import global from "../../../global";
import ObjectLoader from "./ObjectLoader";
import PDBLoader from "./PDBLoader";
import VRMLoader from "./VRMLoader";

afterEach(() => {
    global.app = null;
    hoisted.gltfLoad.mockReset();
    hoisted.pdbLoad.mockReset();
    hoisted.register.mockReset();
    hoisted.setMeshoptDecoder.mockReset();
    hoisted.removeUnnecessaryVertices.mockReset();
    vi.restoreAllMocks();
});

describe("remaining direct loader wrappers", () => {
    it("loads ObjectLoader JSON without the legacy package-manager require path", async () => {
        const child = new THREE.Object3D();
        child.userData = {Server: true, Url: "/nested-model.json"};
        const root = new THREE.Group();
        root.add(child);
        const objectLoad = vi.spyOn(THREE.ObjectLoader.prototype, "load").mockImplementation(
            (_url, onLoad) => {
                (onLoad as any)(root);
                return undefined as any;
            },
        );
        const loader = new ObjectLoader();
        loader.require = vi.fn();

        const result = await loader.load("/model.json", {});

        expect(loader.require).not.toHaveBeenCalled();
        expect(objectLoad).toHaveBeenCalledWith("/model.json", expect.any(Function), undefined, expect.any(Function));
        expect(result).toBe(root);
        expect(child.userData).toEqual({});
    });

    it("prepares ObjectLoader skinned meshes without a second recursive scene traversal", async () => {
        const geometry = new THREE.BufferGeometry() as THREE.BufferGeometry & {
            animations?: Array<{name: string}>;
        };
        geometry.animations = [{name: "Idle"}];
        const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
        const scene = new THREE.Scene();
        scene.add(mesh);
        const traverseSpy = vi.spyOn(scene, "traverse");
        vi.spyOn(THREE.ObjectLoader.prototype, "load").mockImplementation(
            (_url, onLoad) => {
                (onLoad as any)(scene);
                return undefined as any;
            },
        );

        const result = await new ObjectLoader().load("/avatar.json", {Name: "Avatar"});

        expect(traverseSpy).not.toHaveBeenCalled();
        expect(result).toBe(mesh);
        expect(mesh.userData.scripts?.[0]).toMatchObject({
            name: "AvatarAnimation",
            type: "javascript",
        });
        expect(mesh.userData.scripts?.[0].source).toContain("var IdleAnimation = mixer.clipAction('Idle');");
        expect(mesh.userData.scripts?.[0].source).toContain("IdleAnimation.play();");
    });

    it("sanitizes deep ObjectLoader hierarchies iteratively", async () => {
        const root = new THREE.Group();
        let cursor: THREE.Object3D = root;
        for (let i = 0; i < 12_000; i++) {
            const child = new THREE.Object3D();
            cursor.add(child);
            cursor = child;
        }
        cursor.userData = {Server: true, Url: "/deep.json"};
        vi.spyOn(THREE.ObjectLoader.prototype, "load").mockImplementation(
            (_url, onLoad) => {
                (onLoad as any)(root);
                return undefined as any;
            },
        );

        await expect(new ObjectLoader().load("/deep.json", {})).resolves.toBe(root);

        expect(cursor.userData).toEqual({});
    });

    it("reuses PDB atom materials by color and a single bond material", async () => {
        const geometryAtoms = new THREE.BufferGeometry();
        geometryAtoms.setAttribute(
            "position",
            new THREE.Float32BufferAttribute([
                0, 0, 0,
                1, 0, 0,
                0, 1, 0,
            ], 3),
        );
        geometryAtoms.setAttribute(
            "color",
            new THREE.Float32BufferAttribute([
                1, 0, 0,
                1, 0, 0,
                0, 1, 0,
            ], 3),
        );
        const geometryBonds = new THREE.BufferGeometry();
        geometryBonds.setAttribute(
            "position",
            new THREE.Float32BufferAttribute([
                0, 0, 0,
                1, 0, 0,
                1, 0, 0,
                0, 1, 0,
            ], 3),
        );
        hoisted.pdbLoad.mockImplementation((_url, onLoad) => onLoad({geometryAtoms, geometryBonds}));
        const loader = new PDBLoader();
        loader.require = vi.fn();

        const root = await loader.load("/molecule.pdb");
        const children = root?.children as THREE.Mesh[] | undefined;

        expect(loader.require).not.toHaveBeenCalled();
        expect(children).toHaveLength(5);
        expect(children?.[0]?.material).toBe(children?.[1]?.material);
        expect(children?.[0]?.material).not.toBe(children?.[2]?.material);
        expect(children?.[3]?.material).toBe(children?.[4]?.material);
    });

    it("loads VRM files through the imported GLTF loader without package-manager require", async () => {
        const registerModel = vi.fn();
        global.app = {vrmExpressionControl: {registerModel}} as any;
        const vrmScene = new THREE.Object3D();
        const gltfScene = new THREE.Object3D();
        const vrm = {scene: vrmScene};
        const gltf = {scene: gltfScene, userData: {vrm}};
        hoisted.gltfLoad.mockImplementation((_url, onLoad) => onLoad(gltf));
        const loader = new VRMLoader();
        loader.require = vi.fn();

        const result = await loader.load("/avatar.vrm");

        expect(loader.require).not.toHaveBeenCalled();
        expect(hoisted.register).toHaveBeenCalledWith(expect.any(Function));
        expect(hoisted.setMeshoptDecoder).toHaveBeenCalledWith(hoisted.meshoptDecoder);
        expect(hoisted.gltfLoad).toHaveBeenCalledWith("/avatar.vrm", expect.any(Function), undefined, expect.any(Function));
        expect(hoisted.removeUnnecessaryVertices).toHaveBeenCalledWith(gltfScene);
        expect(registerModel).toHaveBeenCalledWith(vrm);
        expect(result).toBe(vrmScene);
        expect((vrmScene as any)._obj).toBe(gltf);
        expect((vrmScene as any)._root).toBe(vrmScene);
    });

    it("prepares deep VRM scenes without recursive traversal", async () => {
        const vrmScene = new THREE.Object3D();
        let cursor: THREE.Object3D = vrmScene;
        for (let i = 0; i < 12_000; i++) {
            const child = new THREE.Object3D();
            cursor.add(child);
            cursor = child;
        }
        const originalMaterial = new THREE.MeshStandardMaterial({color: 0xff5533});
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(), originalMaterial);
        mesh.frustumCulled = true;
        cursor.add(mesh);
        const traverseSpy = vi.spyOn(vrmScene, "traverse");
        const gltf = {scene: new THREE.Object3D(), userData: {vrm: {scene: vrmScene}}};
        hoisted.gltfLoad.mockImplementation((_url, onLoad) => onLoad(gltf));

        const result = await new VRMLoader().load("/deep.vrm");

        expect(result).toBe(vrmScene);
        expect(traverseSpy).not.toHaveBeenCalled();
        expect(mesh.frustumCulled).toBe(false);
        expect(mesh.material).toBeInstanceOf(THREE.MeshBasicMaterial);
        expect(mesh.material).not.toBe(originalMaterial);
        expect((mesh.material as unknown as THREE.MeshBasicMaterial).color.getHex()).toBe(0xff5533);
    });
});
