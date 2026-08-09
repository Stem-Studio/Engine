import {describe, expect, it, vi, beforeEach} from "vitest";

vi.mock("@stem/network/api/asset", () => ({
    createAssetWithData: vi.fn(),
    AssetType: {Behavior: "behavior", Model: "model"},
}));

vi.mock("@stem/network/api/scene/v2", () => ({}));
vi.mock("../../../asset-management/AssetResolutionContext", () => ({}));
vi.mock("../../../context/AssetResolutionContext", () => ({
    useAssetResolutionContext: () => ({context: {}}),
}));
vi.mock("../../../context/AssetSourceContext", () => ({
    useAssetSource: () => null,
}));

vi.mock("@stem/editor-oss/global", () => ({
    default: {app: null},
}));

vi.mock("@web-shared/queryClient", () => ({
    queryClient: {
        setQueryData: vi.fn(),
        invalidateQueries: vi.fn().mockResolvedValue(undefined),
    },
}));

import {createAsset, refreshEditorAssets} from "./assets";
import {createAssetWithData} from "@stem/network/api/asset";
import global from "@stem/editor-oss/global";
import {queryClient} from "@web-shared/queryClient";

// --- Helpers ---

const makeAsset = (id: string) => ({
    id,
    headRevisionId: `rev-${id}`,
    type: "behavior",
    name: `Asset ${id}`,
    createTime: "2026-01-01",
    updateTime: "2026-01-01",
    userId: "user-1",
    contentType: "application/json",
    format: "json",
    sceneIds: [],
    description: "",
});

// --- Tests ---

describe("createAsset", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (global as any).app = {call: vi.fn()};
    });

    it("delegates to assetSource.createAsset when assetSource is provided", async () => {
        const created = makeAsset("new-1");
        const mockSource = {
            createAsset: vi.fn().mockResolvedValue(created),
            kind: "scene" as const,
            id: "test-source",
        };

        const result = await createAsset({
            assetSource: mockSource as any,
            type: "behavior",
            name: "Test",
            data: "{}",
            format: "json",
            contentType: "application/json",
        });

        expect(mockSource.createAsset).toHaveBeenCalledWith({
            type: "behavior",
            name: "Test",
            data: "{}",
            format: "json",
            contentType: "application/json",
        });
        expect(createAssetWithData).not.toHaveBeenCalled();
        expect(result.id).toBe("new-1");
    });

    it("passes deferred scene sync only to assetSource-backed creates", async () => {
        const created = makeAsset("new-1");
        const mockSource = {
            createAsset: vi.fn().mockResolvedValue(created),
            kind: "scene" as const,
            id: "test-source",
        };

        await createAsset({
            assetSource: mockSource as any,
            deferAssetSourceSceneSync: true,
            type: "behavior",
            name: "Test",
            data: "{}",
            format: "json",
            contentType: "application/json",
        });

        expect(mockSource.createAsset).toHaveBeenCalledWith({
            type: "behavior",
            name: "Test",
            data: "{}",
            format: "json",
            contentType: "application/json",
            deferSceneSync: true,
        });
        expect(createAssetWithData).not.toHaveBeenCalled();
    });

    it("creates standalone asset when no assetSource", async () => {
        const created = makeAsset("standalone-1");
        vi.mocked(createAssetWithData).mockResolvedValue(created as any);

        const result = await createAsset({
            type: "behavior",
            name: "Test",
            data: "{}",
            format: "json",
            contentType: "application/json",
        });

        expect(createAssetWithData).toHaveBeenCalled();
        expect(result.id).toBe("standalone-1");
    });

    it("seeds detail cache after creation", async () => {
        const created = makeAsset("new-1");
        vi.mocked(createAssetWithData).mockResolvedValue(created as any);

        await createAsset({
            type: "behavior",
            name: "Test",
            data: "{}",
            format: "json",
            contentType: "application/json",
        });

        expect(queryClient.setQueryData).toHaveBeenCalledWith(
            expect.arrayContaining(["assets", "detail", "new-1"]),
            created,
        );
    });

    it("invalidates the editor-list scope for the assetSource when provided", async () => {
        const created = makeAsset("new-1");
        const mockSource = {
            createAsset: vi.fn().mockResolvedValue(created),
            kind: "stem" as const,
            id: "stem-1",
        };

        await createAsset({
            assetSource: mockSource as any,
            type: "behavior",
            name: "Test",
            data: "{}",
            format: "json",
            contentType: "application/json",
        });

        expect(queryClient.invalidateQueries).toHaveBeenCalledWith(
            expect.objectContaining({queryKey: ["assets", "list", "stem", "stem-1"]}),
        );
    });

    it("fires sceneAssetChanged event", async () => {
        const created = makeAsset("new-1");
        vi.mocked(createAssetWithData).mockResolvedValue(created as any);

        await createAsset({
            type: "behavior",
            name: "Test",
            data: "{}",
            format: "json",
            contentType: "application/json",
        });

        expect((global as any).app.call).toHaveBeenCalledWith("sceneAssetChanged", null);
    });
});

describe("refreshEditorAssets", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("invalidates the scene-list scope for a scene source", async () => {
        const source = {kind: "scene" as const, id: "scene-42"};

        await refreshEditorAssets(queryClient, source as any);

        expect(queryClient.invalidateQueries).toHaveBeenCalledWith(
            expect.objectContaining({queryKey: ["assets", "list", "scene", "scene-42"]}),
        );
    });

    it("invalidates the stem-list scope for a stem source", async () => {
        const source = {kind: "stem" as const, id: "stem-7"};

        await refreshEditorAssets(queryClient, source as any);

        expect(queryClient.invalidateQueries).toHaveBeenCalledWith(
            expect.objectContaining({queryKey: ["assets", "list", "stem", "stem-7"]}),
        );
    });
});
