import {Object3D, Scene} from "three";
import {beforeEach, describe, expect, it, vi} from "vitest";

import {collectExportAssetRefs, exportAssets} from "./export";
import {getAsset, getAssetDerivatives, getAssetRevision} from "@stem/network/api/asset";

function addDeepChain(root: Object3D, depth = 12_000): Object3D {
    let cursor = root;
    for (let i = 0; i < depth; i++) {
        const child = new Object3D();
        cursor.add(child);
        cursor = child;
    }
    return cursor;
}

vi.mock("@stem/network/api/asset", () => ({
    getAsset: vi.fn(),
    getAssetDerivatives: vi.fn(),
    getAssetRevision: vi.fn(),
}));

vi.mock("../prefab/util", () => ({
    getPrefabEditRevisionId: (obj: Object3D) => obj.userData?.prefabEditRevisionId || null,
    getPrefabId: (obj: Object3D) => obj.userData?.prefabId || null,
}));

describe("collectExportAssetRefs", () => {
    it("returns asset refs from dependencies", () => {
        const scene = new Scene();
        const deps = { a1: "r1", a2: "r2" };

        const result = collectExportAssetRefs(scene, deps);

        expect(result).toEqual([
            { assetId: "a1", revisionId: "r1" },
            { assetId: "a2", revisionId: "r2" },
        ]);
    });

    it("includes prefab edit revision refs for unlocked prefabs", () => {
        const scene = new Scene();
        const child = new Object3D();
        child.userData.prefabId = "a1";
        child.userData.prefabEditRevisionId = "r-edit";
        scene.add(child);

        const deps = { a1: "r1" };
        const result = collectExportAssetRefs(scene, deps);

        expect(result).toEqual([
            { assetId: "a1", revisionId: "r1" },
            { assetId: "a1", revisionId: "r-edit" },
        ]);
    });

    it("does not include edit revision when prefab is locked", () => {
        const scene = new Scene();
        const child = new Object3D();
        child.userData.prefabId = "a1";
        scene.add(child);

        const deps = { a1: "r1" };
        const result = collectExportAssetRefs(scene, deps);

        expect(result).toEqual([
            { assetId: "a1", revisionId: "r1" },
        ]);
    });

    it("returns empty array when no dependencies and no unlocked prefabs", () => {
        const scene = new Scene();
        const result = collectExportAssetRefs(scene, {});
        expect(result).toEqual([]);
    });

    it("collects prefab edit refs from deep scenes without Three recursive traversal", () => {
        const scene = new Scene();
        const leaf = addDeepChain(scene);
        leaf.userData.prefabId = "deep-prefab";
        leaf.userData.prefabEditRevisionId = "deep-edit";
        const traverse = vi.spyOn(scene, "traverse");

        const result = collectExportAssetRefs(scene, {base: "base-rev"});

        expect(traverse).not.toHaveBeenCalled();
        expect(result).toEqual([
            {assetId: "base", revisionId: "base-rev"},
            {assetId: "deep-prefab", revisionId: "deep-edit"},
        ]);
    });
});

describe("exportAssets", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(getAssetDerivatives).mockResolvedValue([]);
    });

    it("returns all assets, revisions and derivatives", async () => {
        vi.mocked(getAssetRevision).mockResolvedValue({
            id: "r1",
            assetId: "a1",
            dataUrl: "https://example.com/a1-r1",
            dependencies: {},
            metadata: {},
            release: {revisionId: "r1"},
        } as any);

        vi.mocked(getAsset).mockResolvedValue({
            id: "a1",
            name: "Public Asset",
            type: "model",
            format: "glb",
            contentType: "model/gltf-binary",
            description: "",
            latestRelease: {revisionId: "r1"},
        } as any);

        const result = await exportAssets([{assetId: "a1", revisionId: "r1"}]);

        expect(result.assets).toHaveLength(1);
        expect(result.revisions).toHaveLength(1);
        expect(result.derivatives).toHaveLength(0);
    });

    it("includes contentEncoding in serialized revision when present", async () => {
        vi.mocked(getAssetRevision).mockResolvedValue({
            id: "r1",
            assetId: "a1",
            dataUrl: "https://example.com/a1-r1",
            contentEncoding: "gzip",
            dependencies: {},
            metadata: {},
            release: {revisionId: "r1"},
        } as any);

        vi.mocked(getAsset).mockResolvedValue({
            id: "a1",
            name: "Compressed Asset",
            type: "model",
            format: "glb",
            contentType: "model/gltf-binary",
            description: "",
            latestRelease: {revisionId: "r1"},
        } as any);

        const result = await exportAssets([{assetId: "a1", revisionId: "r1"}]);

        expect(result.revisions[0]).toMatchObject({id: "r1", contentEncoding: "gzip"});
    });

    it("omits contentEncoding from serialized revision when not present", async () => {
        vi.mocked(getAssetRevision).mockResolvedValue({
            id: "r1",
            assetId: "a1",
            dataUrl: "https://example.com/a1-r1",
            dependencies: {},
            metadata: {},
            release: {revisionId: "r1"},
        } as any);

        vi.mocked(getAsset).mockResolvedValue({
            id: "a1",
            name: "Uncompressed Asset",
            type: "model",
            format: "glb",
            contentType: "model/gltf-binary",
            description: "",
            latestRelease: {revisionId: "r1"},
        } as any);

        const result = await exportAssets([{assetId: "a1", revisionId: "r1"}]);

        expect(result.revisions[0]!.contentEncoding).toBeUndefined();
    });

    it("includes revision-level format and contentType in serialized revision", async () => {
        vi.mocked(getAssetRevision).mockResolvedValue({
            id: "r1",
            assetId: "a1",
            dataUrl: "https://example.com/a1-r1",
            format: "usdz",
            contentType: "model/vnd.usdz+zip",
            dependencies: {},
            metadata: {},
            release: {revisionId: "r1"},
        } as any);

        vi.mocked(getAsset).mockResolvedValue({
            id: "a1",
            name: "USDZ Asset",
            type: "model",
            format: "glb",
            contentType: "model/gltf-binary",
            description: "",
            latestRelease: {revisionId: "r1"},
        } as any);

        const result = await exportAssets([{assetId: "a1", revisionId: "r1"}]);

        expect(result.revisions[0]).toMatchObject({
            format: "usdz",
            contentType: "model/vnd.usdz+zip",
        });
    });

    it("includes contentEncoding in serialized derivative when present", async () => {
        vi.mocked(getAssetRevision).mockResolvedValue({
            id: "r1",
            assetId: "a1",
            dataUrl: "https://example.com/a1-r1",
            dependencies: {},
            metadata: {},
            release: {revisionId: "r1"},
        } as any);

        vi.mocked(getAsset).mockResolvedValue({
            id: "a1",
            name: "Asset With Derivative",
            type: "model",
            format: "glb",
            contentType: "model/gltf-binary",
            description: "",
            latestRelease: {revisionId: "r1"},
        } as any);

        vi.mocked(getAssetDerivatives).mockResolvedValue([{
            id: "d1",
            assetId: "a1",
            revisionId: "r1",
            type: "thumbnail",
            format: "png",
            contentType: "image/png",
            contentEncoding: "gzip",
            dataUrl: "https://example.com/thumb.png",
        } as any]);

        const result = await exportAssets([{assetId: "a1", revisionId: "r1"}]);

        expect(result.derivatives).toHaveLength(1);
        expect(result.derivatives[0]).toMatchObject({contentEncoding: "gzip"});
    });

    it("omits contentEncoding from serialized derivative when not present", async () => {
        vi.mocked(getAssetRevision).mockResolvedValue({
            id: "r1",
            assetId: "a1",
            dataUrl: "https://example.com/a1-r1",
            dependencies: {},
            metadata: {},
            release: {revisionId: "r1"},
        } as any);

        vi.mocked(getAsset).mockResolvedValue({
            id: "a1",
            name: "Asset With Derivative",
            type: "model",
            format: "glb",
            contentType: "model/gltf-binary",
            description: "",
            latestRelease: {revisionId: "r1"},
        } as any);

        vi.mocked(getAssetDerivatives).mockResolvedValue([{
            id: "d1",
            assetId: "a1",
            revisionId: "r1",
            type: "thumbnail",
            format: "png",
            contentType: "image/png",
            dataUrl: "https://example.com/thumb.png",
        } as any]);

        const result = await exportAssets([{assetId: "a1", revisionId: "r1"}]);

        expect(result.derivatives[0]!.contentEncoding).toBeUndefined();
    });

    it("exports long dependency chains without recursive graph traversal", async () => {
        const chainLength = 128;
        vi.mocked(getAssetRevision).mockImplementation(async (assetId: string, revisionId: string) => {
            const index = Number(assetId.slice(1));
            const nextIndex = index + 1;
            return {
                id: revisionId,
                assetId,
                dataUrl: `https://example.com/${assetId}-${revisionId}`,
                dependencies: nextIndex < chainLength ? {[`a${nextIndex}`]: `r${nextIndex}`} : {},
                metadata: {},
                release: {revisionId},
            } as any;
        });
        vi.mocked(getAsset).mockImplementation(async (assetId: string) => ({
            id: assetId,
            name: `Asset ${assetId}`,
            type: "model",
            format: "glb",
            contentType: "model/gltf-binary",
            description: "",
            latestRelease: {revisionId: "unused"},
        } as any));

        const result = await exportAssets([{assetId: "a0", revisionId: "r0"}]);

        expect(result.revisions).toHaveLength(chainLength);
        expect(result.assets).toHaveLength(chainLength);
        expect(vi.mocked(getAssetRevision)).toHaveBeenCalledTimes(chainLength);
        expect(result.revisions.at(-1)).toMatchObject({assetId: `a${chainLength - 1}`, id: `r${chainLength - 1}`});
    });
});
