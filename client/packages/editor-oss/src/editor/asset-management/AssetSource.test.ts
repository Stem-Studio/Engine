import {Object3D} from "three";
import {describe, expect, it, vi, beforeEach} from "vitest";

// Mock all dependencies before importing the module under test.
// vi.mock factories are hoisted, so they can only reference vi.fn() and
// vi.hoisted() values — not top-level variables.

vi.mock("@stem/network/api/asset", () => ({
    getAsset: vi.fn(),
    getSceneAssets: vi.fn(),
    createAssetWithData: vi.fn(),
    createAssetRevisionWithData: vi.fn(),
}));

vi.mock("@stem/network/api/scene/v2", () => ({
    createSceneAssetWithData: vi.fn(),
    updateSceneDependencies: vi.fn(),
    removeAssetsFromScene: vi.fn(),
}));

vi.mock("../../asset-management/AssetResolutionContext", () => ({
    getAssetResolutionContext: vi.fn(),
    setAssetRevision: vi.fn(),
    removeAssetRevision: vi.fn(),
}));

vi.mock("../../global", () => ({
    default: {app: null},
}));

// Now import mocked modules to get references to the mock functions
import {getAsset} from "@stem/network/api/asset";
import {createSceneAssetWithData, updateSceneDependencies, removeAssetsFromScene} from "@stem/network/api/scene/v2";
import {createAssetWithData} from "@stem/network/api/asset";
import {getAssetResolutionContext, setAssetRevision, removeAssetRevision} from "@stem/editor-oss/asset-management/AssetResolutionContext";
import global from "@stem/editor-oss/global";
import {StemAssetSource, SceneAssetSource} from "./AssetSource";

// --- Helpers ---

const mockScene = new Object3D();

const setupApp = (scene = mockScene) => {
    (global as any).app = {
        scene,
        editor: {},
        call: vi.fn(),
    };
};

const setSceneContext = (assetIdToRevisionId: Record<string, string>) => {
    vi.mocked(getAssetResolutionContext).mockReturnValue({assetIdToRevisionId});
};

const makeAsset = (id: string, type = "behavior") => ({
    id,
    headRevisionId: `rev-${id}`,
    type,
    name: `Asset ${id}`,
    createTime: "2026-01-01",
    updateTime: "2026-01-01",
    userId: "user-1",
    contentType: "application/json",
    format: "json",
    sceneIds: [],
    description: "",
});

// --- StemAssetSource ---

describe("StemAssetSource", () => {
    const stemId = "stem-1";

    beforeEach(() => {
        vi.clearAllMocks();
        setupApp();
    });

    describe("identity", () => {
        it("exposes kind=\"stem\" and id=stemAssetId", () => {
            const source = new StemAssetSource(stemId);
            expect(source.kind).toBe("stem");
            expect(source.id).toBe(stemId);
        });
    });

    describe("getAssets", () => {
        it("reads dependency IDs from local context, excluding stem's own ID", async () => {
            setSceneContext({
                [stemId]: "stem-rev-1",
                "dep-1": "rev-1",
                "dep-2": "rev-2",
            });
            vi.mocked(getAsset)
                .mockResolvedValueOnce(makeAsset("dep-1") as any)
                .mockResolvedValueOnce(makeAsset("dep-2") as any);

            const source = new StemAssetSource(stemId);
            const result = await source.getAssets();

            expect(getAsset).toHaveBeenCalledTimes(2);
            expect(getAsset).toHaveBeenCalledWith("dep-1", expect.any(Object));
            expect(getAsset).toHaveBeenCalledWith("dep-2", expect.any(Object));
            expect(result.assets).toHaveLength(2);
        });

        it("returns empty when no scene", async () => {
            (global as any).app = null;

            const source = new StemAssetSource(stemId);
            const result = await source.getAssets();

            expect(result.assets).toHaveLength(0);
        });

        it("returns empty when no context", async () => {
            vi.mocked(getAssetResolutionContext).mockReturnValue(null);

            const source = new StemAssetSource(stemId);
            const result = await source.getAssets();

            expect(result.assets).toHaveLength(0);
        });

        it("filters by type when specified", async () => {
            setSceneContext({
                [stemId]: "stem-rev",
                "bhv-1": "rev-1",
                "model-1": "rev-2",
            });
            vi.mocked(getAsset)
                .mockResolvedValueOnce(makeAsset("bhv-1", "behavior") as any)
                .mockResolvedValueOnce(makeAsset("model-1", "model") as any);

            const source = new StemAssetSource(stemId);
            const result = await source.getAssets({types: ["behavior"]});

            expect(result.assets).toHaveLength(1);
            expect(result.assets[0]!.id).toBe("bhv-1");
        });

        it("handles fetch errors gracefully", async () => {
            setSceneContext({[stemId]: "rev", "dep-1": "rev-1"});
            vi.mocked(getAsset).mockRejectedValueOnce(new Error("Network error"));

            const source = new StemAssetSource(stemId);
            const result = await source.getAssets();

            expect(result.assets).toHaveLength(0);
        });
    });

    describe("addDependencies", () => {
        it("calls setAssetRevision for each dependency", async () => {
            const source = new StemAssetSource(stemId);
            await source.addDependencies({"dep-1": "rev-1", "dep-2": "rev-2"});

            expect(setAssetRevision).toHaveBeenCalledWith(mockScene, "dep-1", "rev-1");
            expect(setAssetRevision).toHaveBeenCalledWith(mockScene, "dep-2", "rev-2");
            expect((global as any).app.call).toHaveBeenCalledWith("objectChanged", null, mockScene);
        });

        it("does nothing when no scene", async () => {
            (global as any).app = null;
            const source = new StemAssetSource(stemId);
            await source.addDependencies({"dep-1": "rev-1"});

            expect(setAssetRevision).not.toHaveBeenCalled();
        });
    });

    describe("removeDependencies", () => {
        it("calls removeAssetRevision for each asset ID", async () => {
            const source = new StemAssetSource(stemId);
            await source.removeDependencies(["dep-1", "dep-2"]);

            expect(removeAssetRevision).toHaveBeenCalledWith(mockScene, "dep-1");
            expect(removeAssetRevision).toHaveBeenCalledWith(mockScene, "dep-2");
            expect((global as any).app.call).toHaveBeenCalledWith("objectChanged", null, mockScene);
        });

        it("does nothing when no scene", async () => {
            (global as any).app = null;
            const source = new StemAssetSource(stemId);
            await source.removeDependencies(["dep-1"]);

            expect(removeAssetRevision).not.toHaveBeenCalled();
        });
    });

    describe("createAsset", () => {
        const stemAssetAt = (headRev: string) => ({
            ...makeAsset(stemId, "prefab"),
            headRevisionId: headRev,
        });

        it("creates standalone asset and updates local context", async () => {
            const created = makeAsset("new-1");
            vi.mocked(createAssetWithData).mockResolvedValue(created as any);
            vi.mocked(getAsset).mockResolvedValue(stemAssetAt("stem-rev-1") as any);

            const source = new StemAssetSource(stemId);
            const result = await source.createAsset({
                type: "behavior",
                name: "New",
                data: "{}",
                format: "json",
                contentType: "application/json",
            });

            expect(createAssetWithData).toHaveBeenCalled();
            expect(setAssetRevision).toHaveBeenCalledWith(mockScene, "new-1", "rev-new-1");
            expect(result.id).toBe("new-1");
        });

        it("refreshes the stem revision in the resolution context after a scoped create", async () => {
            const scene = new Object3D();
            scene.userData.stemEditor = {assetId: stemId};
            setupApp(scene);

            vi.mocked(createAssetWithData).mockResolvedValue(makeAsset("new-1") as any);
            vi.mocked(getAsset).mockResolvedValue(stemAssetAt("stem-rev-2") as any);

            const source = new StemAssetSource(stemId);
            await source.createAsset({
                type: "behavior",
                name: "New",
                data: "{}",
                format: "json",
                contentType: "application/json",
            });

            expect(getAsset).toHaveBeenCalledWith(stemId);
            expect(setAssetRevision).toHaveBeenCalledWith(scene, stemId, "stem-rev-2");
        });

        it("tolerates a failed head refresh without touching the stem revision", async () => {
            const scene = new Object3D();
            scene.userData.stemEditor = {assetId: stemId};
            setupApp(scene);

            vi.mocked(createAssetWithData).mockResolvedValue(makeAsset("new-1") as any);
            vi.mocked(getAsset).mockRejectedValue(new Error("network blip"));
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

            const source = new StemAssetSource(stemId);
            const result = await source.createAsset({
                type: "behavior",
                name: "New",
                data: "{}",
                format: "json",
                contentType: "application/json",
            });

            expect(result.id).toBe("new-1");
            // The new asset's revision was set, but the stem's revision wasn't
            // touched because the refresh failed.
            expect(setAssetRevision).not.toHaveBeenCalledWith(scene, stemId, expect.anything());
            expect(warnSpy).toHaveBeenCalled();
            warnSpy.mockRestore();
        });
    });
});

// --- SceneAssetSource ---

describe("SceneAssetSource", () => {
    const sceneId = "scene-1";

    beforeEach(() => {
        vi.clearAllMocks();
        setupApp();
    });

    describe("identity", () => {
        it("exposes kind=\"scene\" and id=sceneId", () => {
            const source = new SceneAssetSource(sceneId);
            expect(source.kind).toBe("scene");
            expect(source.id).toBe(sceneId);
        });
    });

    describe("createAsset", () => {
        it("creates scene-scoped asset and updates context", async () => {
            const created = makeAsset("new-1");
            vi.mocked(createSceneAssetWithData).mockResolvedValue(created as any);

            const source = new SceneAssetSource(sceneId);
            const result = await source.createAsset({
                type: "behavior",
                name: "New",
                data: "{}",
                format: "json",
                contentType: "application/json",
            });

            expect(createSceneAssetWithData).toHaveBeenCalledWith(
                expect.objectContaining({sceneId}),
            );
            expect(setAssetRevision).toHaveBeenCalledWith(mockScene, "new-1", "rev-new-1");
            expect(result.id).toBe("new-1");
        });

        it("can defer objectChanged while still updating the scene dependency context", async () => {
            const scene = new Object3D();
            setupApp(scene);
            const created = makeAsset("new-1");
            vi.mocked(createSceneAssetWithData).mockResolvedValue(created as any);

            const source = new SceneAssetSource(sceneId);
            await source.createAsset({
                type: "behavior",
                name: "New",
                data: "{}",
                format: "json",
                contentType: "application/json",
                deferSceneSync: true,
            });

            expect(setAssetRevision).toHaveBeenCalledWith(scene, "new-1", "rev-new-1");
            expect((global as any).app.call).not.toHaveBeenCalledWith("objectChanged", null, scene);
        });
    });

    describe("addDependencies", () => {
        it("merges with existing context and calls updateSceneDependencies", async () => {
            vi.mocked(getAssetResolutionContext).mockReturnValue({
                assetIdToRevisionId: {"existing-1": "rev-existing"},
            });

            const source = new SceneAssetSource(sceneId);
            await source.addDependencies({"new-1": "rev-1"});

            expect(updateSceneDependencies).toHaveBeenCalledWith(sceneId, {
                "existing-1": "rev-existing",
                "new-1": "rev-1",
            });
            expect(setAssetRevision).toHaveBeenCalledWith(mockScene, "new-1", "rev-1");
        });
    });

    describe("removeDependencies", () => {
        it("calls removeAssetsFromScene and updates context", async () => {
            const source = new SceneAssetSource(sceneId);
            await source.removeDependencies(["dep-1"]);

            expect(removeAssetsFromScene).toHaveBeenCalledWith(sceneId, ["dep-1"]);
            expect(removeAssetRevision).toHaveBeenCalledWith(mockScene, "dep-1");
        });
    });
});
