import {
    Mesh,
    MeshStandardMaterial,
    PlaneGeometry,
    Texture,
    TextureLoader,
} from "three";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {AssetLoader} from "./AssetLoader";
import {
    resetGpuResourceOwnershipForTests,
    retainObjectGpuResources,
} from "../core/resources/GpuResourceOwnership";
import MeshUtils from "../utils/MeshUtils";

const {mockGetAsset} = vi.hoisted(() => ({
    mockGetAsset: vi.fn(),
}));

vi.mock("@stem/network/api/asset", () => ({
    getAsset: mockGetAsset,
    getAssetDerivatives: vi.fn(),
    getAssetRevision: vi.fn(),
    AssetDerivativeType: {
        Model: "model",
        Image: "image",
        BehaviorBundle: "behaviorBundle",
    },
}));

const futureDate = () => new Date(Date.now() + 60 * 60_000).toISOString();

describe("AssetLoader GPU resource ownership", () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
        resetGpuResourceOwnershipForTests();
    });

    afterEach(() => {
        resetGpuResourceOwnershipForTests();
        vi.restoreAllMocks();
    });

    it("releases texture-cache ownership without disposing a texture retained by a live scene", async () => {
        const loadedTexture = new Texture();
        vi.spyOn(TextureLoader.prototype, "load").mockImplementation(((
            _url: string,
            onLoad?: (texture: Texture) => void,
        ) => {
            onLoad?.(loadedTexture);
            return loadedTexture;
        }) as TextureLoader["load"]);

        mockGetAsset.mockResolvedValue({
            id: "image-1",
            revisionId: "rev-1",
            format: "png",
            derivatives: [{
                assetId: "image-1",
                revisionId: "rev-1",
                id: "derivative-1",
                type: "image",
                format: "png",
                dataUrl: "https://cdn.example/image.png",
                expiresAt: futureDate(),
            }],
        });

        const loader = new AssetLoader();
        const texture = await loader.createTexture({assetId: "image-1", revisionId: "rev-1"});
        const material = new MeshStandardMaterial({map: texture});
        const mesh = new Mesh(new PlaneGeometry(), material);
        retainObjectGpuResources(mesh);

        const disposeTexture = vi.spyOn(texture, "dispose");
        const disposeGeometry = vi.spyOn(mesh.geometry, "dispose");
        const disposeMaterial = vi.spyOn(material, "dispose");

        loader.clear();

        expect(disposeTexture).not.toHaveBeenCalled();

        MeshUtils.dispose(mesh);

        expect(disposeGeometry).toHaveBeenCalledOnce();
        expect(disposeMaterial).toHaveBeenCalledOnce();
        expect(disposeTexture).toHaveBeenCalledOnce();
    });
});
