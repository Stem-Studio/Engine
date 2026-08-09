import * as THREE from "three";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { BehaviorConfig } from "./BehaviorConfig";
import type { BehaviorAttributeData } from "./BehaviorAttributes";
import type { AssetSource } from "../../asset-management/SceneAssetSource";

// Mock all heavy dependencies before importing the module under test
vi.mock("../Editor", () => ({ default: vi.fn() }));
vi.mock("../../prefab/util", () => ({
    isPrefab: () => false,
    isPrefabUnlocked: () => true,
}));

const mockCreateAsset = vi.fn();
const mockCreateAssetRevision = vi.fn();
const mockSeedAssetRevisionData = vi.fn();
const mockGetAsset = vi.fn();
const mockSeedScriptDependencyEntry = vi.fn();
const mockBuildNameAwareScriptImportContext = vi.fn();
const mockGetScriptImportDependencyMap = vi.fn();
const mockLoadReferencedScriptImportRevisionMap = vi.fn();
const mockGetAssetResolutionContext = vi.fn();
const mockRemoveAssetRevision = vi.fn();
vi.mock("../asset-management/hooks/assets", () => ({
    createAsset: (...args: unknown[]) => mockCreateAsset(...args),
    createAssetRevision: (...args: unknown[]) => mockCreateAssetRevision(...args),
    seedAssetRevisionData: (...args: unknown[]) => mockSeedAssetRevisionData(...args),
    getAsset: (...args: unknown[]) => mockGetAsset(...args),
}));

const mockSetAssetRevision = vi.fn();
vi.mock("../../asset-management/AssetResolutionContext", () => ({
    emptyAssetResolutionContext: {},
    getAssetResolutionContext: (...args: unknown[]) => mockGetAssetResolutionContext(...args),
    removeAssetRevision: (...args: unknown[]) => mockRemoveAssetRevision(...args),
    setAssetRevision: (...args: unknown[]) => mockSetAssetRevision(...args),
}));

vi.mock("../../script-runtime/scriptDependencyCache", () => ({
    seedScriptDependencyEntry: (...args: unknown[]) => mockSeedScriptDependencyEntry(...args),
}));

vi.mock("../../script-runtime/scriptImportCore", () => ({
    buildNameAwareScriptImportContext: (...args: unknown[]) => mockBuildNameAwareScriptImportContext(...args),
    getScriptImportDependencyMap: (...args: unknown[]) => mockGetScriptImportDependencyMap(...args),
    loadReferencedScriptImportRevisionMap: (...args: unknown[]) => mockLoadReferencedScriptImportRevisionMap(...args),
}));

vi.mock("@stem/network/api/asset", () => ({
    AssetType: { Behavior: "Behavior" },
    isNoChangesError: (err: {code?: string}) => err?.code === "NO_CHANGES",
    isConflictError: (err: {statusCode?: number}) => err?.statusCode === 409,
}));

const mockGlobal: any = { app: null };
vi.mock("../../global", () => ({
    default: mockGlobal,
}));

vi.mock("../../queryClient", () => ({
    queryClient: { __mock: true },
}));

vi.mock("./BehaviorObjectSettingsApplier", () => ({
    default: { applyObjectSettings: vi.fn() },
}));

vi.mock("./attributeDiff", () => ({
    getModifiedAttributeKeys: vi.fn().mockReturnValue([]),
}));

vi.mock("../../utils/SceneUtil", () => ({
    traverseSceneDepthFirst: vi.fn(),
}));

// Import after mocks are set up
const { updateBehaviorRegistries, updateSceneBehaviorRevision, createBehavior, createBehaviorRevision } = await import("./util");

const testConfig: BehaviorConfig = {
    id: "bhv-1",
    name: "TestBehavior",
    description: "",
    version: "1.0.0",
    author: "",
    isScript: true,
    main: "",
    attributes: { speed: { type: "number", name: "speed" } as BehaviorAttributeData },
};

const createMockApp = () => {
    const scene = new THREE.Group();
    const editor = {
        scene,
        sceneID: "scene-123",
        behaviorConfigRegistry: {
            getConfig: vi.fn().mockReturnValue(null),
            registerConfig: vi.fn(),
            unregisterConfig: vi.fn(),
        },
        behaviorScriptRegistry: {
            getScript: vi.fn().mockReturnValue(null),
            registerScript: vi.fn(),
            unregisterScript: vi.fn(),
        },
        parseAndRegisterScriptBehavior: vi.fn().mockResolvedValue(undefined),
        syncSceneBehaviorConfigs: vi.fn(),
        removeBehaviorPlugin: vi.fn(),
        addBehaviorPlugin: vi.fn(),
    };
    const app = { editor, scene, call: vi.fn() };
    mockGlobal.app = app;
    return { app, editor, scene };
};

// ── updateBehaviorRegistries ─────────────────────────────────────────────────

describe("updateBehaviorRegistries", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetAssetResolutionContext.mockReturnValue(null);
        mockBuildNameAwareScriptImportContext.mockImplementation(async (_sceneId: string | undefined, context: unknown) => context ?? {});
        mockGetScriptImportDependencyMap.mockReturnValue({});
        mockLoadReferencedScriptImportRevisionMap.mockResolvedValue({});
        createMockApp();
    });

    it("registers config and script in registries", () => {
        const { editor } = createMockApp();
        // Pretend the behavior is already registered so the unregister path runs.
        editor.behaviorConfigRegistry.getConfig.mockReturnValue(testConfig);

        updateBehaviorRegistries({ behaviorId: "bhv-1", code: "this.init = function() {}", config: testConfig });

        expect(editor.behaviorConfigRegistry.registerConfig).toHaveBeenCalledWith("bhv-1", testConfig);
        expect(editor.behaviorScriptRegistry.registerScript).toHaveBeenCalledWith("bhv-1", "this.init = function() {}");
    });

    it("calls parseAndRegisterScriptBehavior when code is provided", () => {
        const { editor } = createMockApp();

        updateBehaviorRegistries({ behaviorId: "bhv-1", code: "this.init = function() {}", config: testConfig });

        expect(editor.parseAndRegisterScriptBehavior).toHaveBeenCalledWith("bhv-1", "this.init = function() {}");
    });

    it("registers under alias when aliasId is provided", () => {
        const { editor } = createMockApp();

        updateBehaviorRegistries({ behaviorId: "bhv-1", code: "code", config: testConfig, aliasId: "yaml-id" });

        expect(editor.behaviorConfigRegistry.registerConfig).toHaveBeenCalledWith("yaml-id", testConfig);
        expect(editor.behaviorScriptRegistry.registerScript).toHaveBeenCalledWith("yaml-id", "code");
    });

    it("skips alias when aliasId equals behaviorId", () => {
        const { editor } = createMockApp();

        updateBehaviorRegistries({ behaviorId: "bhv-1", code: "code", config: testConfig, aliasId: "bhv-1" });

        expect(editor.behaviorConfigRegistry.registerConfig).toHaveBeenCalledTimes(1);
    });
});

// ── updateSceneBehaviorRevision ──────────────────────────────────────────────

describe("updateSceneBehaviorRevision", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetAssetResolutionContext.mockReturnValue(null);
        mockBuildNameAwareScriptImportContext.mockImplementation(async (_sceneId: string | undefined, context: unknown) => context ?? {});
        mockGetScriptImportDependencyMap.mockReturnValue({});
        mockLoadReferencedScriptImportRevisionMap.mockResolvedValue({});
    });

    it("updates registries, asset resolution context, and fires events", async () => {
        const { editor, app } = createMockApp();

        await updateSceneBehaviorRevision({
            assetId: "bhv-1",
            revisionId: "rev-2",
            code: "code",
            config: testConfig,
        });

        expect(editor.behaviorConfigRegistry.registerConfig).toHaveBeenCalledWith("bhv-1", testConfig);
        expect(mockSetAssetRevision).toHaveBeenCalledWith(app.scene, "bhv-1", "rev-2");
        expect(editor.syncSceneBehaviorConfigs).toHaveBeenCalled();
        expect(app.call).toHaveBeenCalledWith("objectChanged", null, app.scene);
    });

    it("can defer scene sync while still registering and parsing the behavior", async () => {
        const { editor, app } = createMockApp();

        await updateSceneBehaviorRevision({
            assetId: "bhv-1",
            revisionId: "rev-2",
            code: "code",
            config: testConfig,
            deferSceneSync: true,
        });

        expect(editor.behaviorConfigRegistry.registerConfig).toHaveBeenCalledWith("bhv-1", testConfig);
        expect(mockSetAssetRevision).toHaveBeenCalledWith(app.scene, "bhv-1", "rev-2");
        expect(editor.parseAndRegisterScriptBehavior).toHaveBeenCalled();
        expect(editor.syncSceneBehaviorConfigs).not.toHaveBeenCalled();
        expect(app.call).not.toHaveBeenCalledWith("objectChanged", null, app.scene);
    });

    it("reuses a precomputed script import context and parses the behavior once", async () => {
        const { editor } = createMockApp();
        const importContext = {assetIdToRevisionId: {"script-1": "script-rev"}};
        const importRevisionMap = {
            "script-1:script-rev": {
                assetId: "script-1",
                revisionId: "script-rev",
                code: "function helper() {}",
            },
        };
        mockGetScriptImportDependencyMap.mockReturnValue({"script-1": "script-rev"});
        mockLoadReferencedScriptImportRevisionMap.mockResolvedValue(importRevisionMap);

        await updateSceneBehaviorRevision({
            assetId: "bhv-1",
            revisionId: "rev-2",
            code: "import {helper} from 'script-1';",
            config: testConfig,
            scriptImportContext: importContext,
        });

        expect(mockBuildNameAwareScriptImportContext).not.toHaveBeenCalled();
        expect(mockGetScriptImportDependencyMap).toHaveBeenCalledWith("import {helper} from 'script-1';", importContext);
        expect(mockLoadReferencedScriptImportRevisionMap).toHaveBeenCalledWith(
            "import {helper} from 'script-1';",
            importContext,
            undefined,
        );
        expect(editor.parseAndRegisterScriptBehavior).toHaveBeenCalledTimes(1);
        expect(editor.parseAndRegisterScriptBehavior).toHaveBeenCalledWith(
            "bhv-1",
            "import {helper} from 'script-1';",
            importContext,
            importRevisionMap,
            {contextIsNameAware: true},
        );
    });

    it("reuses and extends a shared script import revision map", async () => {
        const { editor } = createMockApp();
        const importContext = {assetIdToRevisionId: {"script-1": "script-rev"}};
        const sharedImportRevisionMap = {
            "script-0:script-rev": {
                assetId: "script-0",
                revisionId: "script-rev",
                code: "function cached() {}",
            },
        };
        const importRevisionMap = {
            "script-1:script-rev": {
                assetId: "script-1",
                revisionId: "script-rev",
                code: "function helper() {}",
            },
        };
        mockLoadReferencedScriptImportRevisionMap.mockResolvedValue(importRevisionMap);

        await updateSceneBehaviorRevision({
            assetId: "bhv-1",
            revisionId: "rev-2",
            code: "import {helper} from 'script-1';",
            config: testConfig,
            scriptImportContext: importContext,
            scriptImportRevisionMap: sharedImportRevisionMap,
        });

        expect(mockLoadReferencedScriptImportRevisionMap).toHaveBeenCalledWith(
            "import {helper} from 'script-1';",
            importContext,
            sharedImportRevisionMap,
        );
        expect(sharedImportRevisionMap).toMatchObject(importRevisionMap);
        expect(editor.parseAndRegisterScriptBehavior).toHaveBeenCalledWith(
            "bhv-1",
            "import {helper} from 'script-1';",
            importContext,
            importRevisionMap,
            {contextIsNameAware: true},
        );
    });

    it("reads existing config for attribute diff before overwriting", async () => {
        const { editor } = createMockApp();
        const oldConfig = { ...testConfig, attributes: { speed: { type: "number", name: "speed" } as BehaviorAttributeData, health: { type: "number", name: "health" } as BehaviorAttributeData } };
        editor.behaviorConfigRegistry.getConfig.mockReturnValue(oldConfig);

        await updateSceneBehaviorRevision({
            assetId: "bhv-1",
            revisionId: "rev-2",
            code: "code",
            config: { ...testConfig, attributes: { speed: { type: "number", name: "speed" } as BehaviorAttributeData } },
        });

        expect(editor.behaviorConfigRegistry.getConfig).toHaveBeenCalledWith("bhv-1");
    });

    it("no-ops when editor is missing", async () => {
        mockGlobal.app = null;

        await updateSceneBehaviorRevision({
            assetId: "bhv-1",
            revisionId: "rev-2",
            code: "code",
            config: testConfig,
        });

        expect(mockSetAssetRevision).not.toHaveBeenCalled();
    });

    it("applies forked behavior revisions under the new asset id", async () => {
        const { editor, app } = createMockApp();
        const sceneContext = {assetIdToRevisionId: {"bhv-1": "rev-1"}};
        const importRevisionMap = {"script-1": "script-rev"};
        mockGetAssetResolutionContext.mockReturnValue(sceneContext);
        mockGetScriptImportDependencyMap.mockReturnValue({"script-1": "script-rev"});
        mockLoadReferencedScriptImportRevisionMap.mockResolvedValue(importRevisionMap);
        editor.behaviorConfigRegistry.getConfig.mockImplementation((id: string) => id === "bhv-1" ? testConfig : null);
        editor.behaviorScriptRegistry.getScript.mockImplementation((id: string) => id === "bhv-1" ? "old code" : null);

        await updateSceneBehaviorRevision({
            assetId: "bhv-1",
            newAssetId: "bhv-fork",
            revisionId: "rev-fork",
            code: "import {helper} from 'script-1';",
            config: testConfig,
        });

        expect(mockSeedScriptDependencyEntry).toHaveBeenCalledWith({
            assetId: "bhv-fork",
            revisionId: "rev-fork",
            ownerType: "behavior",
            dependencies: {"script-1": "script-rev"},
        });
        expect(editor.behaviorConfigRegistry.unregisterConfig).toHaveBeenCalledWith("bhv-1", true);
        expect(editor.behaviorScriptRegistry.unregisterScript).toHaveBeenCalledWith("bhv-1", true);
        expect(editor.behaviorConfigRegistry.registerConfig).toHaveBeenCalledWith("bhv-fork", testConfig);
        expect(editor.behaviorScriptRegistry.registerScript).toHaveBeenCalledWith("bhv-fork", "import {helper} from 'script-1';");
        expect(mockSetAssetRevision).toHaveBeenCalledWith(app.scene, "bhv-fork", "rev-fork");
        expect(mockRemoveAssetRevision).toHaveBeenCalledWith(app.scene, "bhv-1");
        expect(editor.parseAndRegisterScriptBehavior).toHaveBeenLastCalledWith(
            "bhv-fork",
            "import {helper} from 'script-1';",
            sceneContext,
            importRevisionMap,
            {contextIsNameAware: true},
        );
    });
});

// ── createBehavior ───────────────────────────────────────────────────────────

describe("createBehavior", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetAssetResolutionContext.mockReturnValue(null);
        mockBuildNameAwareScriptImportContext.mockImplementation(async (_sceneId: string | undefined, context: unknown) => context ?? {});
        mockGetScriptImportDependencyMap.mockReturnValue({});
        mockLoadReferencedScriptImportRevisionMap.mockResolvedValue({});
        createMockApp();
    });

    it("calls createAsset and sets config.id", async () => {
        mockCreateAsset.mockResolvedValue({ id: "new-asset-id", headRevisionId: "rev-1" });
        const config = { ...testConfig, id: "" };

        const asset = await createBehavior({ assetSource: {} as unknown as AssetSource, name: "Test", code: "code", config });

        expect(mockCreateAsset).toHaveBeenCalledWith(expect.objectContaining({
            type: "Behavior",
            assetSource: {} as unknown as AssetSource,
            name: "Test",
        }));
        expect(config.id).toBe("new-asset-id");
        expect(asset.id).toBe("new-asset-id");
    });

    it("seeds revision data cache", async () => {
        mockCreateAsset.mockResolvedValue({ id: "new-asset-id", headRevisionId: "rev-1" });

        await createBehavior({ assetSource: {} as unknown as AssetSource, name: "Test", code: "code", config: { ...testConfig, id: "" } });

        expect(mockSeedAssetRevisionData).toHaveBeenCalledWith(
            expect.anything(),
            "new-asset-id",
            "rev-1",
            "json",
            expect.objectContaining({ code: "code" }),
        );
    });

    it("calls updateSceneBehaviorRevision when assetSource is provided", async () => {
        mockCreateAsset.mockResolvedValue({ id: "new-asset-id", headRevisionId: "rev-1" });

        await createBehavior({ assetSource: {} as unknown as AssetSource, name: "Test", code: "code", config: { ...testConfig, id: "" } });

        expect(mockSetAssetRevision).toHaveBeenCalled();
    });

    it("honors deferred scene sync for batch-created behaviors", async () => {
        mockCreateAsset.mockResolvedValue({ id: "new-asset-id", headRevisionId: "rev-1" });
        const { editor, app } = createMockApp();

        await createBehavior({
            assetSource: {} as unknown as AssetSource,
            name: "Test",
            code: "code",
            config: { ...testConfig, id: "" },
            deferSceneSync: true,
        });

        expect(mockSetAssetRevision).toHaveBeenCalledWith(app.scene, "new-asset-id", "rev-1");
        expect(editor.parseAndRegisterScriptBehavior).toHaveBeenCalled();
        expect(editor.syncSceneBehaviorConfigs).not.toHaveBeenCalled();
        expect(app.call).not.toHaveBeenCalledWith("objectChanged", null, app.scene);
    });

    it("skips updateSceneBehaviorRevision when no assetSource is provided", async () => {
        mockCreateAsset.mockResolvedValue({ id: "new-asset-id", headRevisionId: "rev-1" });
        createMockApp();
        mockSetAssetRevision.mockClear();

        await createBehavior({ name: "Test", code: "code", config: { ...testConfig, id: "" } });

        expect(mockSetAssetRevision).not.toHaveBeenCalled();
    });
});

// ── createBehaviorRevision ───────────────────────────────────────────────────

describe("createBehaviorRevision", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetAssetResolutionContext.mockReturnValue(null);
        mockBuildNameAwareScriptImportContext.mockImplementation(async (_sceneId: string | undefined, context: unknown) => context ?? {});
        mockGetScriptImportDependencyMap.mockReturnValue({});
        mockLoadReferencedScriptImportRevisionMap.mockResolvedValue({});
        createMockApp();
    });

    it("calls createAssetRevision with correct params", async () => {
        mockCreateAssetRevision.mockResolvedValue({ id: "rev-2", assetId: "bhv-1" });

        await createBehaviorRevision({
            assetId: "bhv-1",
            parentRevisionId: "rev-1",
            code: "code",
            config: testConfig,
        });

        expect(mockCreateAssetRevision).toHaveBeenCalledWith(expect.objectContaining({
            assetId: "bhv-1",
            parentRevisionId: "rev-1",
            format: "json",
            contentType: "application/json",
        }));
    });

    it("seeds revision data cache", async () => {
        mockCreateAssetRevision.mockResolvedValue({ id: "rev-2", assetId: "bhv-1" });

        await createBehaviorRevision({
            assetId: "bhv-1",
            parentRevisionId: "rev-1",
            code: "new code",
            config: testConfig,
        });

        expect(mockSeedAssetRevisionData).toHaveBeenCalledWith(
            expect.anything(),
            "bhv-1",
            "rev-2",
            "json",
            expect.objectContaining({ code: "new code" }),
        );
    });

    it("calls updateSceneBehaviorRevision when assetSource is provided", async () => {
        mockCreateAssetRevision.mockResolvedValue({ id: "rev-2", assetId: "bhv-1" });

        await createBehaviorRevision({
            assetId: "bhv-1",
            parentRevisionId: "rev-1",
            code: "code",
            config: testConfig,
            assetSource: {} as unknown as AssetSource,
        });

        await vi.waitFor(() => {
            expect(mockSetAssetRevision).toHaveBeenCalled();
        });
    });

    it("honors deferred scene sync for batch behavior revisions", async () => {
        mockCreateAssetRevision.mockResolvedValue({ id: "rev-2", assetId: "bhv-1" });
        const { editor, app } = createMockApp();

        await createBehaviorRevision({
            assetId: "bhv-1",
            parentRevisionId: "rev-1",
            code: "code",
            config: testConfig,
            assetSource: {} as unknown as AssetSource,
            deferSceneSync: true,
        });

        expect(mockSetAssetRevision).toHaveBeenCalledWith(app.scene, "bhv-1", "rev-2");
        expect(editor.parseAndRegisterScriptBehavior).toHaveBeenCalled();
        expect(editor.syncSceneBehaviorConfigs).not.toHaveBeenCalled();
        expect(app.call).not.toHaveBeenCalledWith("objectChanged", null, app.scene);
    });

    it("skips updateSceneBehaviorRevision when no assetSource is provided", async () => {
        mockCreateAssetRevision.mockResolvedValue({ id: "rev-2", assetId: "bhv-1" });
        createMockApp();
        mockSetAssetRevision.mockClear();

        await createBehaviorRevision({
            assetId: "bhv-1",
            parentRevisionId: "rev-1",
            code: "code",
            config: testConfig,
        });

        expect(mockSetAssetRevision).not.toHaveBeenCalled();
    });

    it("returns the created revision", async () => {
        const mockRevision = { id: "rev-2", assetId: "bhv-1" };
        mockCreateAssetRevision.mockResolvedValue(mockRevision);

        const revision = await createBehaviorRevision({
            assetId: "bhv-1",
            parentRevisionId: "rev-1",
            code: "code",
            config: testConfig,
        });

        expect(revision).toBe(mockRevision);
    });

    it("returns parent revision id on isNoChangesError", async () => {
        mockCreateAssetRevision.mockRejectedValue({ code: "NO_CHANGES" });

        const revision = await createBehaviorRevision({
            assetId: "bhv-1",
            parentRevisionId: "rev-1",
            code: "code",
            config: testConfig,
        });

        expect(revision).toEqual({ id: "rev-1" });
    });

    it("reuses the current revision on isNoChangesError and still refreshes the scene when assetSource is provided", async () => {
        mockCreateAssetRevision.mockRejectedValue({ code: "NO_CHANGES" });

        await createBehaviorRevision({
            assetId: "bhv-1",
            parentRevisionId: "rev-1",
            code: "code",
            config: testConfig,
            assetSource: {} as unknown as AssetSource,
        });

        await vi.waitFor(() => {
            expect(mockSetAssetRevision).toHaveBeenCalledWith(expect.anything(), "bhv-1", "rev-1");
        });
    });

    it("retries with fresh head on 409 when retryOnConflict is true", async () => {
        mockCreateAssetRevision
            .mockRejectedValueOnce({ statusCode: 409 })
            .mockResolvedValueOnce({ id: "rev-3", assetId: "bhv-1" });
        mockGetAsset.mockResolvedValue({ headRevisionId: "rev-2" });

        const revision = await createBehaviorRevision({
            assetId: "bhv-1",
            parentRevisionId: "rev-1",
            code: "code",
            config: testConfig,
            retryOnConflict: true,
        });

        expect(mockGetAsset).toHaveBeenCalled();
        expect(mockCreateAssetRevision).toHaveBeenCalledTimes(2);
        expect(mockCreateAssetRevision.mock.calls[1]![0]).toMatchObject({ parentRevisionId: "rev-2" });
        expect(revision.id).toBe("rev-3");
    });

    it("does not retry on 409 when retryOnConflict is false", async () => {
        mockCreateAssetRevision.mockRejectedValue({ statusCode: 409 });

        await expect(createBehaviorRevision({
            assetId: "bhv-1",
            parentRevisionId: "rev-1",
            code: "code",
            config: testConfig,
        })).rejects.toMatchObject({ statusCode: 409 });

        expect(mockCreateAssetRevision).toHaveBeenCalledTimes(1);
    });

    it("rethrows non-409 errors even when retryOnConflict is true", async () => {
        mockCreateAssetRevision.mockRejectedValue({ statusCode: 500, message: "Server error" });

        await expect(createBehaviorRevision({
            assetId: "bhv-1",
            parentRevisionId: "rev-1",
            code: "code",
            config: testConfig,
            retryOnConflict: true,
        })).rejects.toMatchObject({ statusCode: 500 });

        expect(mockCreateAssetRevision).toHaveBeenCalledTimes(1);
    });
});
