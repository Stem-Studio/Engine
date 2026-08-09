import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted ensures these are available inside vi.mock factories (which are hoisted before imports)
const { mockGlobal } = vi.hoisted(() => {
    const mockGlobal: { app: any } = { app: null };
    return { mockGlobal };
});

vi.mock("@web-shared/global", () => ({ default: mockGlobal }));

vi.mock("./v2", () => ({
    createScene: vi.fn(),
    createSceneRevision: vi.fn(),
    updateScene: vi.fn(),
    publishScene: vi.fn(),
    unpublishScene: vi.fn(),
}));

vi.mock("../asset", () => ({
    isNoChangesError: (err: any) => err?.code === "NO_CHANGES",
}));

vi.mock("@web-shared/utils/Ajax", () => ({
    default: { post: vi.fn() },
}));

vi.mock("@web-shared/serialization/Converter", () => ({
    default: class MockConverter {
        toJSON() { return { scene: "data" }; }
    },
}));

vi.mock("@web-shared/asset-management/AssetResolutionContext", () => ({
    getAssetResolutionContext: vi.fn().mockReturnValue({ assetIdToRevisionId: {}, logicalIdToAssetId: {} }),
    emptyAssetResolutionContext: { assetIdToRevisionId: {}, logicalIdToAssetId: {} },
}));

vi.mock("@web-shared/showToast", () => ({ showToast: vi.fn() }));

vi.mock("@web-shared/utils/TimeUtils", () => ({
    default: { getServerUTCTime: vi.fn().mockReturnValue("2026-01-01T00:00:00Z") },
}));

// three.js addon modules not resolvable in test environment
vi.mock("three/addons/loaders/FontLoader", () => ({ FontLoader: vi.fn() }));
vi.mock("three/addons/renderers/CSS3DRenderer", () => ({
    CSS3DObject: vi.fn(),
    CSS3DSprite: vi.fn(),
    CSS3DRenderer: vi.fn(),
}));

import { commitSaveScene, publishCurrentScene } from "./index";
import { createScene, createSceneRevision, publishScene, unpublishScene, updateScene } from "./v2";
import Ajax from "@web-shared/utils/Ajax";
import {
    clearActiveCopilotPreviewPersistence,
    runWithCopilotPreviewSceneSaveAllowed,
    setActiveCopilotPreviewPersistence,
} from "@web-shared/agent/copilotPreviewPersistence";

const makeEditor = (overrides: Record<string, unknown> = {}) => ({
    sceneID: undefined as string | undefined,
    sceneAssetId: undefined as string | undefined,
    sceneRevisionId: null as string | null,
    publishRevisionId: "",
    sceneAlias: undefined as string | undefined,
    sceneName: "Test Scene",
    sceneLockedItems: [],
    sceneThumbnail: "",
    isMultiplayer: false,
    multiplayerAutoJoin: false,
    maxMultiplayerClientsPerRoom: 10,
    isSandbox: false,
    isCollaborative: false,
    maxCollaboratorsInRoom: 0,
    showHUD: true,
    showStats: false,
    showMemoryStats: false,
    useInstancing: false,
    voiceChatEnabled: false,
    rendering: undefined,
    useAvatar: false,
    allowAnonymousFirebase: false,
    isAssetPack: false,
    isTopPick: false,
    isPublic: false,
    isCloneable: false,
    isPublished: false,
    description: "",
    tags: [],
    contentRating: "",
    assetsCount: 0,
    VFXOnMobile: false,
    ...overrides,
});

const makeApp = (editor: ReturnType<typeof makeEditor>) => ({
    editor,
    scene: { userData: {} },
    call: vi.fn(),
    options: {},
});

beforeEach(() => {
    vi.clearAllMocks();
    clearActiveCopilotPreviewPersistence();
});

describe("commitSaveScene", () => {
    it("blocks normal scene revision saves while a Copilot preview is active", async () => {
        const editor = makeEditor({sceneID: "scene-1", sceneAssetId: "asset-1"});
        mockGlobal.app = makeApp(editor);
        setActiveCopilotPreviewPersistence({previewId: "preview-1"});

        await commitSaveScene("");

        expect(updateScene).not.toHaveBeenCalled();
        expect(createSceneRevision).not.toHaveBeenCalled();
        expect(mockGlobal.app.call).toHaveBeenCalledWith(
            "copilotPreviewSaveBlocked",
            null,
            {previewId: "preview-1"},
        );
    });

    it("allows the explicit accept path to save an active Copilot preview", async () => {
        const editor = makeEditor({sceneID: "scene-1", sceneAssetId: "asset-1"});
        mockGlobal.app = makeApp(editor);
        setActiveCopilotPreviewPersistence({previewId: "preview-1"});

        vi.mocked(createSceneRevision).mockResolvedValue({
            asset: {revision: {id: "accepted-revision"}},
        } as any);

        await runWithCopilotPreviewSceneSaveAllowed(() => commitSaveScene(""));

        expect(updateScene).toHaveBeenCalledOnce();
        expect(createSceneRevision).toHaveBeenCalledOnce();
        expect(editor.sceneRevisionId).toBe("accepted-revision");
    });

    describe("new scene (no sceneId)", () => {
        it("calls createScene and updates editor.sceneID and sceneAlias", async () => {
            const editor = makeEditor(); // no sceneID, no sceneAssetId
            mockGlobal.app = makeApp(editor);

            vi.mocked(createScene).mockResolvedValue({
                id: "new-scene-id",
                alias: "new-alias",
            } as any);

            await commitSaveScene("");

            expect(createScene).toHaveBeenCalledOnce();
            expect(createSceneRevision).not.toHaveBeenCalled();
            expect(Ajax.post).not.toHaveBeenCalled();

            expect(editor.sceneID).toBe("new-scene-id");
            expect(editor.sceneAlias).toBe("new-alias");
            expect(mockGlobal.app.call).toHaveBeenCalledWith("sceneSaved", null, { showToast: true });
        });

        it("passes editor.sceneThumbnail into createScene metadata and syncs it back from the response", async () => {
            const editor = makeEditor({ sceneThumbnail: "placeholder:cat-gamer" });
            mockGlobal.app = makeApp(editor);

            vi.mocked(createScene).mockResolvedValue({
                id: "new-scene-id",
                alias: "new-alias",
                thumbnail: "placeholder:cat-gamer",
            } as any);

            await commitSaveScene("");

            expect(createScene).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ thumbnail: "placeholder:cat-gamer" }),
            );
            expect(editor.sceneThumbnail).toBe("placeholder:cat-gamer");
        });
    });

    describe("asset-backed existing scene", () => {
        it("calls updateScene then createSceneRevision and fires sceneSaved", async () => {
            const editor = makeEditor({ sceneID: "scene-123", sceneAssetId: "asset-456" });
            mockGlobal.app = makeApp(editor);

            vi.mocked(updateScene).mockResolvedValue({} as any);
            vi.mocked(createSceneRevision).mockResolvedValue({} as any);

            await commitSaveScene("");

            // Should PATCH scene props first, then POST revision
            expect(updateScene).toHaveBeenCalledOnce();
            expect(updateScene).toHaveBeenCalledWith("scene-123", expect.objectContaining({ name: "Test Scene" }));
            expect(createSceneRevision).toHaveBeenCalledOnce();
            expect(createSceneRevision).toHaveBeenCalledWith("scene-123", expect.any(String), expect.objectContaining({
                metadata: expect.any(Object),
                dependencies: expect.any(Object),
            }));
            expect(createScene).not.toHaveBeenCalled();
            expect(Ajax.post).not.toHaveBeenCalled();

            // sceneID should remain unchanged
            expect(editor.sceneID).toBe("scene-123");
            expect(mockGlobal.app.call).toHaveBeenCalledWith("sceneSaved", null, { showToast: true });
        });

        it("passes retryOnConflict: true to createSceneRevision", async () => {
            const editor = makeEditor({ sceneID: "scene-123", sceneAssetId: "asset-456" });
            mockGlobal.app = makeApp(editor);

            vi.mocked(updateScene).mockResolvedValue({} as any);
            vi.mocked(createSceneRevision).mockResolvedValue({} as any);

            await commitSaveScene("");

            expect(createSceneRevision).toHaveBeenCalledWith(
                "scene-123",
                expect.any(String),
                expect.objectContaining({ retryOnConflict: true }),
            );
        });

        it("treats isNoChangesError as success and fires sceneSaved", async () => {
            const editor = makeEditor({ sceneID: "scene-123", sceneAssetId: "asset-456" });
            mockGlobal.app = makeApp(editor);

            vi.mocked(updateScene).mockResolvedValue({} as any);
            vi.mocked(createSceneRevision).mockRejectedValue({ code: "NO_CHANGES" });

            const onSuccess = vi.fn();
            const onError = vi.fn();
            await commitSaveScene("", { onSuccess, onError });

            expect(onSuccess).toHaveBeenCalled();
            expect(onError).not.toHaveBeenCalled();
            expect(mockGlobal.app.call).toHaveBeenCalledWith("sceneSaved", null, { showToast: true });
            expect(mockGlobal.app.call).not.toHaveBeenCalledWith("sceneSaveFailed");
        });

        it("fires sceneSaveFailed on non-no-changes errors", async () => {
            const editor = makeEditor({ sceneID: "scene-123", sceneAssetId: "asset-456" });
            mockGlobal.app = makeApp(editor);

            vi.mocked(updateScene).mockResolvedValue({} as any);
            vi.mocked(createSceneRevision).mockRejectedValue(new Error("Server error"));

            const onError = vi.fn();
            await commitSaveScene("", { onError });

            expect(onError).toHaveBeenCalled();
            expect(mockGlobal.app.call).toHaveBeenCalledWith("sceneSaveFailed");
            expect(mockGlobal.app.call).not.toHaveBeenCalledWith("sceneSaved", null, { showToast: true });
        });
    });

    describe("legacy scene (sceneId, no sceneAssetId)", () => {
        it("calls Ajax.post to /api/Scene/Save and updates sceneAlias", async () => {
            const editor = makeEditor({ sceneID: "legacy-scene", sceneAssetId: undefined });
            mockGlobal.app = makeApp(editor);

            vi.mocked(Ajax.post).mockResolvedValue({
                data: { Code: 200, Data: { alias: "legacy-alias" } },
            } as any);

            await commitSaveScene("");

            expect(Ajax.post).toHaveBeenCalledOnce();
            const postCall = vi.mocked(Ajax.post).mock.calls[0]![0];
            expect(postCall.url).toContain("/api/Scene/Save");
            expect((postCall.data).ID).toBe("legacy-scene");

            expect(createScene).not.toHaveBeenCalled();
            expect(createSceneRevision).not.toHaveBeenCalled();

            expect(editor.sceneAlias).toBe("legacy-alias");
            expect(mockGlobal.app.call).toHaveBeenCalledWith("sceneSaved", null, { showToast: true });
        });

        it("fires sceneSaveFailed on Ajax error", async () => {
            const editor = makeEditor({ sceneID: "legacy-scene", sceneAssetId: undefined });
            mockGlobal.app = makeApp(editor);

            vi.mocked(Ajax.post).mockResolvedValue({
                data: { Code: 500, Msg: "Server error" },
            } as any);

            await commitSaveScene("");

            expect(mockGlobal.app.call).toHaveBeenCalledWith("sceneSaveFailed");
        });
    });

    describe("captures head revision id from createSceneRevision response", () => {
        it("updates editor.sceneRevisionId after asset-backed save", async () => {
            const editor = makeEditor({ sceneID: "scene-123", sceneAssetId: "asset-456" });
            mockGlobal.app = makeApp(editor);

            vi.mocked(updateScene).mockResolvedValue({} as any);
            vi.mocked(createSceneRevision).mockResolvedValue({
                asset: { id: "asset-456", revision: { id: "new-head-rev" } },
            } as any);

            await commitSaveScene("");

            expect(editor.sceneRevisionId).toBe("new-head-rev");
        });

        it("updates editor.sceneRevisionId after createScene", async () => {
            const editor = makeEditor();
            mockGlobal.app = makeApp(editor);

            vi.mocked(createScene).mockResolvedValue({
                id: "new-scene-id",
                alias: "new-alias",
                asset: { id: "asset-1", revision: { id: "first-rev" } },
            } as any);

            await commitSaveScene("");

            expect(editor.sceneRevisionId).toBe("first-rev");
        });
    });
});

describe("publishCurrentScene", () => {
    it("rejects when no scene is open", async () => {
        const editor = makeEditor();
        mockGlobal.app = makeApp(editor);
        const onError = vi.fn();

        await publishCurrentScene("publish", { onError });

        expect(onError).toHaveBeenCalled();
        expect(publishScene).not.toHaveBeenCalled();
    });

    it("publishes by pinning the current head revision id, no new revision created", async () => {
        const editor = makeEditor({
            sceneID: "scene-123",
            sceneAssetId: "asset-456",
            sceneRevisionId: "current-head",
        });
        mockGlobal.app = makeApp(editor);

        vi.mocked(updateScene).mockResolvedValue({} as any);
        vi.mocked(publishScene).mockResolvedValue({
            publishRevisionId: "current-head",
        } as any);

        const onSuccess = vi.fn();
        await publishCurrentScene("publish", { isPublic: true, onSuccess });

        // Metadata PATCH happened (isPublic not included — publish call sets it)
        expect(updateScene).toHaveBeenCalledOnce();
        const updateCallArgs = vi.mocked(updateScene).mock.calls[0]![1];
        expect(updateCallArgs).not.toHaveProperty("isPublic");

        // Publish call pinned the existing head
        expect(publishScene).toHaveBeenCalledWith("scene-123", "current-head", { isPublic: true });

        // No new revision was created
        expect(createSceneRevision).not.toHaveBeenCalled();

        expect(editor.publishRevisionId).toBe("current-head");
        expect(editor.isPublished).toBe(true);
        expect(editor.isPublic).toBe(true);
        expect(onSuccess).toHaveBeenCalled();
    });

    it("rejects publish when there is no head revision id", async () => {
        const editor = makeEditor({
            sceneID: "scene-123",
            sceneAssetId: "asset-456",
            sceneRevisionId: null,
        });
        mockGlobal.app = makeApp(editor);

        vi.mocked(updateScene).mockResolvedValue({} as any);
        const onError = vi.fn();

        await publishCurrentScene("publish", { onError });

        expect(publishScene).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalled();
        expect(editor.isPublished).toBe(false);
    });

    it("unpublishes by clearing the pin, no new revision created", async () => {
        const editor = makeEditor({
            sceneID: "scene-123",
            sceneAssetId: "asset-456",
            isPublished: true,
            isPublic: true,
            publishRevisionId: "old-rev",
        });
        mockGlobal.app = makeApp(editor);

        vi.mocked(updateScene).mockResolvedValue({} as any);
        vi.mocked(unpublishScene).mockResolvedValue({} as any);

        const onSuccess = vi.fn();
        await publishCurrentScene("unpublish", { onSuccess });

        expect(unpublishScene).toHaveBeenCalledWith("scene-123");
        expect(createSceneRevision).not.toHaveBeenCalled();
        expect(editor.publishRevisionId).toBe("");
        expect(editor.isPublished).toBe(false);
        expect(editor.isPublic).toBe(false);
        expect(onSuccess).toHaveBeenCalled();
    });

    it("surfaces failure when the publish call fails", async () => {
        const editor = makeEditor({
            sceneID: "scene-123",
            sceneAssetId: "asset-456",
            sceneRevisionId: "head-rev",
        });
        mockGlobal.app = makeApp(editor);

        vi.mocked(updateScene).mockResolvedValue({} as any);
        vi.mocked(publishScene).mockRejectedValue(new Error("LakeFS unreachable"));

        const onError = vi.fn();
        const onSuccess = vi.fn();
        await publishCurrentScene("publish", { onError, onSuccess });

        // Editor publish state untouched
        expect(editor.isPublished).toBe(false);
        expect(editor.publishRevisionId).toBe("");
        expect(onError).toHaveBeenCalled();
        expect(onSuccess).not.toHaveBeenCalled();
    });
});
