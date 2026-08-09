import {
    BoxGeometry,
    Group,
    Mesh,
    MeshStandardMaterial,
    Object3D,
    Texture,
} from "three";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {AssetInstanceManager} from "./AssetInstanceManager";
import {AssetRef} from "./AssetRef";
import {resetGpuResourceOwnershipForTests} from "../core/resources/GpuResourceOwnership";
import MeshUtils from "../utils/MeshUtils";

const {mockLoadModelWithLoader, mockLoadPrefabWithLoader} = vi.hoisted(() => ({
    mockLoadModelWithLoader: vi.fn(),
    mockLoadPrefabWithLoader: vi.fn(),
}));

vi.mock("../model/load-util", () => ({
    loadModelWithLoader: mockLoadModelWithLoader,
}));

vi.mock("../prefab/util", () => ({
    loadPrefabWithLoader: mockLoadPrefabWithLoader,
}));

const ref: AssetRef = {assetId: "managed-model", revisionId: "rev-1"};

const createTemplate = () => {
    const root = new Group();
    const geometry = new BoxGeometry();
    const texture = new Texture();
    const material = new MeshStandardMaterial({map: texture});
    root.add(
        new Mesh(geometry, material),
        new Mesh(geometry, material),
    );

    return {
        root,
        geometry,
        material,
        texture,
        disposeGeometry: vi.spyOn(geometry, "dispose"),
        disposeMaterial: vi.spyOn(material, "dispose"),
        disposeTexture: vi.spyOn(texture, "dispose"),
    };
};

describe("AssetInstanceManager GPU resource ownership", () => {
    let manager: AssetInstanceManager;

    beforeEach(() => {
        vi.clearAllMocks();
        resetGpuResourceOwnershipForTests();
        manager = new AssetInstanceManager({} as any);
    });

    afterEach(() => {
        manager.dispose();
        resetGpuResourceOwnershipForTests();
        vi.restoreAllMocks();
    });

    it("keeps a live clone's shared resources alive when unloading its cached template", async () => {
        const template = createTemplate();
        mockLoadModelWithLoader.mockResolvedValue(template.root);

        await manager.preloadModel(ref);
        const clone = await manager.createModelInstance(ref);

        manager.unloadModel(ref);

        expect(template.disposeGeometry).not.toHaveBeenCalled();
        expect(template.disposeMaterial).not.toHaveBeenCalled();
        expect(template.disposeTexture).not.toHaveBeenCalled();

        MeshUtils.dispose(clone);

        expect(template.disposeGeometry).toHaveBeenCalledOnce();
        expect(template.disposeMaterial).toHaveBeenCalledOnce();
        expect(template.disposeTexture).toHaveBeenCalledOnce();
    });

    it("disposes shared template resources only after the last clone releases them", async () => {
        const template = createTemplate();
        mockLoadModelWithLoader.mockResolvedValue(template.root);

        await manager.preloadModel(ref);
        const first = await manager.createModelInstance(ref);
        const second = await manager.createModelInstance(ref);

        manager.unloadModel(ref);
        MeshUtils.dispose(first);

        expect(template.disposeGeometry).not.toHaveBeenCalled();
        expect(template.disposeMaterial).not.toHaveBeenCalled();
        expect(template.disposeTexture).not.toHaveBeenCalled();

        MeshUtils.dispose(second);

        expect(template.disposeGeometry).toHaveBeenCalledOnce();
        expect(template.disposeMaterial).toHaveBeenCalledOnce();
        expect(template.disposeTexture).toHaveBeenCalledOnce();
    });

    it("releases clone resources exactly once when the same clone is disposed twice", async () => {
        const template = createTemplate();
        mockLoadModelWithLoader.mockResolvedValue(template.root);

        await manager.preloadModel(ref);
        const clone = await manager.createModelInstance(ref);

        manager.unloadModel(ref);
        MeshUtils.dispose(clone);
        MeshUtils.dispose(clone);

        expect(template.disposeGeometry).toHaveBeenCalledOnce();
        expect(template.disposeMaterial).toHaveBeenCalledOnce();
        expect(template.disposeTexture).toHaveBeenCalledOnce();
    });

    it("uses the same ownership path for prefabs", async () => {
        const template = createTemplate();
        const prefabRef: AssetRef = {assetId: "managed-prefab", revisionId: "rev-2"};
        mockLoadPrefabWithLoader.mockResolvedValue(template.root);

        await manager.preloadPrefab(prefabRef);
        const clone = await manager.createPrefabInstance(prefabRef);

        manager.unloadPrefab(prefabRef);
        expect(template.disposeGeometry).not.toHaveBeenCalled();

        MeshUtils.dispose(clone);
        expect(template.disposeGeometry).toHaveBeenCalledOnce();
    });

    it("does not add ownership data to userData or prototypes during clone retain", async () => {
        const template = createTemplate();
        template.root.userData = {label: "template"};
        mockLoadModelWithLoader.mockResolvedValue(template.root);

        await manager.preloadModel(ref);
        const clone = await manager.createModelInstance(ref);

        expect(template.root.userData).toEqual({label: "template"});
        expect(clone.userData).toEqual({label: "template"});
        expect(Object.prototype).not.toHaveProperty("gpuResourceOwner");
        expect(Object3D.prototype).not.toHaveProperty("gpuResourceOwner");
    });
});
