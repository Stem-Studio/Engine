import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateSceneRevisionApi = vi.fn();

vi.mock("../client", () => ({
    getScenesApiClient: () => ({
        createSceneRevision: (...args: any[]) => mockCreateSceneRevisionApi(...args),
    }),
    getJobsApiClient: vi.fn(),
}));

vi.mock("../asset", () => ({
    isConflictError: (err: any) => err?.statusCode === 409,
    createAssetUpload: vi.fn(),
    dataToBase64: vi.fn(),
    getDataByteLength: vi.fn(),
    gzipData: vi.fn(),
    INLINE_DATA_MAX_BYTES: 0,
    uploadAssetData: vi.fn(),
}));

vi.mock("@web-shared/global", () => ({ default: { app: null } }));

vi.mock("../../../buildMode", () => ({
    IS_OSS: true,
}));

import {listSceneRevisionCaptures, sceneSettingsToCreateRequest, upsertSceneRevisionCapture} from "./v2";
import type { SceneSettings } from "./index";

beforeEach(() => {
    vi.clearAllMocks();
});

// NOTE: tests for `createSceneRevision` were removed — that path exercises a
// remote server revision API (409-retry, server-assigned ids), while this
// adapter generates local `oss-rev-*` ids.

describe("sceneSettingsToCreateRequest", () => {
    it("maps PascalCase SceneSettings to v2 createScene request fields", () => {
        const settings: SceneSettings = {
            Alias: "alpha",
            AllowAnonymousFirebase: true,
            Dependencies: {"asset-1": "rev-1"},
            Description: "desc",
            IsAssetPack: true,
            IsCloneable: true,
            IsCollaborative: false,
            IsMultiplayer: true,
            IsSandbox: false,
            IsTopPick: true,
            LockedItems: "abc",
            MaxCollaboratorsInRoom: 8,
            MaxMultiplayerClientsPerRoom: 4,
            MultiplayerAutoJoin: true,
            ShowHUD: true,
            ShowStats: false,
            Thumbnail: "https://example.com/t.png",
            UseAvatar: true,
            UseInstancing: false,
            VFXOnMobile: true,
            VoiceChatEnabled: true,
        };

        const result = sceneSettingsToCreateRequest(settings, "My Scene");

        expect(result).toEqual({
            name: "My Scene",
            alias: "alpha",
            allowAnonymousFirebase: true,
            dependencies: {"asset-1": "rev-1"},
            description: "desc",
            isAssetPack: true,
            isCloneable: true,
            isCollaborative: false,
            isMultiplayer: true,
            isSandbox: false,
            isTopPick: true,
            lockedItems: "abc",
            maxCollaboratorsInRoom: 8,
            maxMultiplayerClientsPerRoom: 4,
            multiplayerAutoJoin: true,
            rendering: undefined,
            showHUD: true,
            showStats: false,
            tags: undefined,
            thumbnail: "https://example.com/t.png",
            useAvatar: true,
            useInstancing: false,
            vfxOnMobile: true,
            voiceChatEnabled: true,
        });
    });

    it("joins Tags array into a comma-separated string", () => {
        const result = sceneSettingsToCreateRequest({Tags: ["a", "b", "c"]}, "n");
        expect(result.tags).toBe("a, b, c");
    });

    it("leaves tags undefined when Tags is missing", () => {
        const result = sceneSettingsToCreateRequest({}, "n");
        expect(result.tags).toBeUndefined();
    });

    it("drops IsPublic, IsPublished, ID, AssetsCount, MajorVersion, MinorVersion, ProductionMode, CompartmentsEnabled", () => {
        const result = sceneSettingsToCreateRequest(
            {
                ID: "abc",
                IsPublic: true,
                IsPublished: true,
                AssetsCount: true,
                MajorVersion: 5,
                MinorVersion: 2,
                ProductionMode: true,
                CompartmentsEnabled: true,
            },
            "n",
        );

        expect(result).not.toHaveProperty("id");
        expect(result).not.toHaveProperty("isPublic");
        expect(result).not.toHaveProperty("isPublished");
        expect(result).not.toHaveProperty("assetsCount");
        expect(result).not.toHaveProperty("majorVersion");
        expect(result).not.toHaveProperty("minorVersion");
        expect(result).not.toHaveProperty("productionMode");
        expect(result).not.toHaveProperty("compartmentsEnabled");
    });

    it("uses the provided name even when SceneSettings.Name is set", () => {
        const result = sceneSettingsToCreateRequest({Name: "from-settings"}, "from-arg");
        expect(result.name).toBe("from-arg");
    });

    it("returns an object with only the name field for empty input", () => {
        const result = sceneSettingsToCreateRequest({}, "Untitled");
        expect(result.name).toBe("Untitled");
        const definedKeys = Object.entries(result)
            .filter(([, v]) => v !== undefined)
            .map(([k]) => k);
        expect(definedKeys).toEqual(["name"]);
    });

    it("passes Rendering through unchanged (PascalCase shape matches DomainRendering)", () => {
        const rendering = {
            ShadowMapType: 2,
            Ambient: {Color: "#fff", Intensity: 1},
        };
        const result = sceneSettingsToCreateRequest({Rendering: rendering as any}, "n");
        expect(result.rendering).toBe(rendering);
    });
});

describe("scene revision capture OSS guards", () => {
    it("returns an empty capture list without a hosted endpoint", async () => {
        await expect(listSceneRevisionCaptures("scene-1")).resolves.toEqual([]);
    });

    it("returns a local capture shape without saving to a hosted endpoint", async () => {
        await expect(
            upsertSceneRevisionCapture("scene-1", "rev-1", {
                name: "Version name",
                source: "copilot",
            }),
        ).resolves.toMatchObject({
            id: "oss-capture-rev-1",
            sceneId: "scene-1",
            revisionId: "rev-1",
            name: "Version name",
            source: "copilot",
        });
    });
});
