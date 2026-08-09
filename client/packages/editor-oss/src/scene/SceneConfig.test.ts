import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDefaultRendering } = vi.hoisted(() => ({
    mockDefaultRendering: { shadowMapType: 0, ambient: {}, fog: {} },
}));

vi.mock("@stem/network/api/scene", () => ({
    renderingApiToEditor: vi.fn((r) => r ?? mockDefaultRendering),
}));

vi.mock("../editor/defaultRendering", () => ({
    defaultRendering: mockDefaultRendering,
}));

// three.js example modules not resolvable in test environment
vi.mock("three/addons/loaders/FontLoader", () => ({ FontLoader: vi.fn() }));
vi.mock("three/addons/geometries/TextGeometry", () => ({ TextGeometry: vi.fn() }));
vi.mock("three/addons/renderers/CSS3DRenderer", () => ({
    CSS3DObject: vi.fn(),
    CSS3DSprite: vi.fn(),
    CSS3DRenderer: vi.fn(),
}));

import { SceneConfig } from "./SceneConfig";
import { renderingApiToEditor } from "@stem/network/api/scene";

// Minimal valid v2 scene response (nested asset/revision shape)
const makeScene = (overrides: Record<string, any> = {}): any => {
    const {asset: assetOverride, ...rest} = overrides;
    const defaultMetadata = {
        lockedItems: "obj-a,obj-b",
        vfxOnMobile: true,
        useAvatar: true,
        isMultiplayer: true,
        multiplayerAutoJoin: false,
        maxMultiplayerClientsPerRoom: 8,
        maxCollaboratorsInRoom: 4,
        showHud: true,
        hudRenderer: "uikit",
        showStats: true,
        showMemoryStats: true,
        useInstancing: true,
        voiceChatEnabled: true,
        rendering: { shadowMapType: 1 },
    };
    return {
        id: "scene-1",
        name: "Test Scene",
        alias: "test-scene",
        thumbnail: "https://cdn/thumb.png",
        isPublic: true,
        isAssetPack: false,
        isTopPick: false,
        isCloneable: true,
        isPublished: true,
        publishRevisionId: "rev-1",
        isSandbox: false,
        isCollaborative: false,
        allowAnonymousFirebase: false,
        userId: "user-1",
        description: "A scene",
        tags: JSON.stringify(["action", "adventure"]),
        contentRating: "Everyone",
        majorVersion: 2,
        minorVersion: 3,
        assetsCount: 5,
        asset: assetOverride !== undefined ? assetOverride : {
            id: "asset-1",
            revision: {
                id: "rev-1",
                metadata: defaultMetadata,
            },
        },
        ...rest,
    };
};

describe("SceneConfig", () => {
    let config: SceneConfig;

    beforeEach(() => {
        vi.clearAllMocks();
        config = new SceneConfig();
    });

    describe("loadFromMetadata", () => {
        it("maps top-level scene fields correctly", () => {
            config.loadFromMetadata(makeScene());

            expect(config.sceneID).toBe("scene-1");
            expect(config.sceneName).toBe("Test Scene");
            expect(config.sceneAlias).toBe("test-scene");
            expect(config.sceneThumbnail).toBe("https://cdn/thumb.png");
            expect(config.isPublic).toBe(true);
            expect(config.isAssetPack).toBe(false);
            expect(config.isTopPick).toBe(false);
            expect(config.isCloneable).toBe(true);
            expect(config.isPublished).toBe(true);
            expect(config.isSandbox).toBe(false);
            expect(config.isCollaborative).toBe(false);
            expect(config.allowAnonymousFirebase).toBe(false);
            expect(config.projectUserId).toBe("user-1");
            expect(config.description).toBe("A scene");
            expect(config.contentRating).toBe("Everyone");
            expect(config.majorVersion).toBe(2);
            expect(config.minorVersion).toBe(3);
            expect(config.assetsCount).toBe(5);
            expect(config.sceneAssetId).toBe("asset-1");
            expect(config.sceneRevisionId).toBe("rev-1");
            expect(config.publishRevisionId).toBe("rev-1");
        });

        it("defaults publishRevisionId to empty string when absent", () => {
            config.loadFromMetadata(makeScene({publishRevisionId: undefined}));
            expect(config.publishRevisionId).toBe("");
        });

        it("maps metadata fields correctly", () => {
            config.loadFromMetadata(makeScene());

            expect(config.sceneLockedItems).toEqual(["obj-a", "obj-b"]);
            expect(config.VFXOnMobile).toBe(true);
            expect(config.useAvatar).toBe(true);
            expect(config.isMultiplayer).toBe(true);
            expect(config.multiplayerAutoJoin).toBe(false);
            expect(config.maxMultiplayerClientsPerRoom).toBe(8);
            expect(config.maxCollaboratorsInRoom).toBe(4);
            expect(config.showHUD).toBe(true);
            expect(config.hudRenderer).toBe("uikit");
            expect(config.showStats).toBe(true);
            expect(config.showMemoryStats).toBe(true);
            expect(config.useInstancing).toBe(true);
            expect(config.voiceChatEnabled).toBe(true);
        });

        it("passes rendering to renderingApiToEditor", () => {
            const rendering = { shadowMapType: 1 };
            config.loadFromMetadata(makeScene());

            expect(renderingApiToEditor).toHaveBeenCalledWith(rendering);
        });

        it("parses tags from a JSON string", () => {
            config.loadFromMetadata(makeScene({ tags: JSON.stringify(["rpg", "pvp"]) }));
            expect(config.tags).toEqual(["rpg", "pvp"]);
        });

        it("defaults tags to [] when absent", () => {
            config.loadFromMetadata(makeScene({ tags: undefined }));
            expect(config.tags).toEqual([]);
        });

        it("splits lockedItems on commas", () => {
            config.loadFromMetadata(makeScene({ asset: { id: "a", revision: { id: "r", metadata: { lockedItems: "a,b,c" } } } }));
            expect(config.sceneLockedItems).toEqual(["a", "b", "c"]);
        });

        it("defaults lockedItems to [] when absent", () => {
            config.loadFromMetadata(makeScene({ asset: { id: "a", revision: { id: "r", metadata: {} } } }));
            expect(config.sceneLockedItems).toEqual([]);
        });

        it("handles empty revision metadata by using defaults", () => {
            config.loadFromMetadata(makeScene({ asset: { id: "a", revision: { id: "r", metadata: {} } } }));

            expect(config.sceneLockedItems).toEqual([]);
            expect(config.isMultiplayer).toBe(false);
            expect(config.multiplayerAutoJoin).toBe(true);
            expect(config.maxMultiplayerClientsPerRoom).toBe(4);
            expect(config.maxCollaboratorsInRoom).toBe(6);
            expect(config.showHUD).toBe(false);
            expect(config.hudRenderer).toBe("html");
            expect(config.useInstancing).toBe(false);
            expect(config.voiceChatEnabled).toBe(false);
        });

        it("defaults name to 'Untitled Scene' when absent", () => {
            config.loadFromMetadata(makeScene({ name: undefined }));
            expect(config.sceneName).toBe("Untitled Scene");
        });

        it("defaults contentRating to 'Unrated' when absent", () => {
            config.loadFromMetadata(makeScene({ contentRating: undefined }));
            expect(config.contentRating).toBe("Unrated");
        });

        it("maps sceneAssetId from asset.id", () => {
            config.loadFromMetadata(makeScene());
            expect(config.sceneAssetId).toBe("asset-1");
        });
    });

    describe("clear", () => {
        it("resets all fields to their defaults after loadFromMetadata", () => {
            config.loadFromMetadata(makeScene());
            config.clear();

            expect(config.sceneID).toBeNull();
            expect(config.sceneName).toBe("Untitled Scene");
            expect(config.sceneAlias).toBe("");
            expect(config.sceneLockedItems).toEqual([]);
            expect(config.sceneThumbnail).toBeNull();
            expect(config.isPublic).toBe(false);
            expect(config.isAssetPack).toBe(false);
            expect(config.isTopPick).toBe(false);
            expect(config.isCloneable).toBe(false);
            expect(config.isPublished).toBe(false);
            expect(config.useAvatar).toBe(false);
            expect(config.isMultiplayer).toBe(false);
            expect(config.isSandbox).toBe(false);
            expect(config.isCollaborative).toBe(false);
            expect(config.showHUD).toBe(false);
            expect(config.hudRenderer).toBe("html");
            expect(config.showStats).toBe(false);
            expect(config.showMemoryStats).toBe(false);
            expect(config.useInstancing).toBe(false);
            expect(config.voiceChatEnabled).toBe(false);
            expect(config.sceneAssetId).toBeNull();
            expect(config.sceneRevisionId).toBeNull();
            expect(config.publishRevisionId).toBe("");
            expect(config.projectUserId).toBe("");
            expect(config.description).toBe("");
            expect(config.contentRating).toBe("Unrated");
        });

        it("resets multiplayerAutoJoin to true", () => {
            config.loadFromMetadata(makeScene({ asset: { id: "a", revision: { id: "r", metadata: { multiplayerAutoJoin: false } } } }));
            expect(config.multiplayerAutoJoin).toBe(false);
            config.clear();
            expect(config.multiplayerAutoJoin).toBe(true);
        });

        it("resets allowAnonymousFirebase to false", () => {
            config.loadFromMetadata(makeScene({ allowAnonymousFirebase: true }));
            expect(config.allowAnonymousFirebase).toBe(true);
            config.clear();
            expect(config.allowAnonymousFirebase).toBe(false);
        });
    });
});
