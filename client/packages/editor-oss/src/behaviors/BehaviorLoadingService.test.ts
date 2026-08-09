import * as THREE from "three";
import {describe, it, expect, vi, beforeEach} from "vitest";

import {BehaviorLoadingService} from "./BehaviorLoadingService";
import type {ScriptBundle} from "@stem/network/api/behavior";

// --- Mocks ---

vi.mock("three", async (importOriginal) => ({
    ...(await importOriginal<typeof import("three")>()),
}));

const mockGetAsset = vi.fn();
vi.mock("@stem/network/api/asset", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@stem/network/api/asset")>();
    return {
        ...actual,
        getAsset: (...args: unknown[]) => mockGetAsset(...args),
    };
});

const mockGetBehaviorBundle = vi.fn();
const mockGetBehaviorsListForScene = vi.fn();
const mockGetBehaviorsFromAssets = vi.fn();
const mockGetScriptRevisionData = vi.fn();
vi.mock("@stem/network/api/behavior", () => ({
    getBehaviorBundle: (...args: unknown[]) => mockGetBehaviorBundle(...args),
    getBehaviorsFromScriptBundle: (bundle: ScriptBundle | null) => {
        if (!bundle || Object.keys(bundle.behaviors ?? {}).length === 0) {
            return null;
        }

        return Object.entries(bundle.behaviors ?? {}).map(([assetId, behavior]) => ({
            ID: assetId,
            RevisionID: behavior.revisionId,
            Config: JSON.parse(behavior.config),
            Code: behavior.code,
            CreatedAt: "",
            UpdatedAt: "",
        }));
    },
    getImportRevisionMapFromScriptBundle: (bundle: ScriptBundle | null) => {
        if (!bundle) {
            return {};
        }

        return Object.fromEntries(
            Object.entries(bundle.imports ?? {}).map(([assetId, importAsset]) => [
                `${assetId}:${importAsset.revisionId}`,
                {
                    assetId,
                    revisionId: importAsset.revisionId,
                    code: importAsset.code,
                },
            ]),
        );
    },
    getImportResolutionContextFromScriptBundle: (bundle: ScriptBundle | null) => {
        if (!bundle) {
            return {};
        }

        return {
            assetIdToRevisionId: Object.fromEntries(
                Object.entries(bundle.imports ?? {}).map(([assetId, importAsset]) => [assetId, importAsset.revisionId]),
            ),
            nameToAssetId: Object.fromEntries(
                Object.entries(bundle.imports ?? {})
                    .filter(([, importAsset]) => !!importAsset.name)
                    .map(([assetId, importAsset]) => [importAsset.name!.toLowerCase(), assetId]),
            ),
        };
    },
    getBehaviorsListForScene: (...args: unknown[]) => mockGetBehaviorsListForScene(...args),
    getBehaviorsFromAssets: (...args: unknown[]) => mockGetBehaviorsFromAssets(...args),
}));

vi.mock("@stem/network/api/script", () => ({
    getScriptRevisionData: (...args: unknown[]) => mockGetScriptRevisionData(...args),
}));

vi.mock("../editor/behaviors/LegacyBehaviorMigration", () => ({
    isSceneBehaviorsMigrated: (scene: THREE.Scene) => !!scene.userData.behaviorsMigrated,
}));

// --- Helpers ---

function makeScene(userData: Record<string, unknown> = {}): THREE.Scene {
    const scene = new THREE.Scene();
    Object.assign(scene.userData, userData);
    return scene;
}

function makeBehaviorBackendData(id: string, code?: string) {
    return {
        ID: id,
        RevisionID: "rev1",
        Config: {name: id, isScript: !!code},
        Code: code ?? null,
    };
}

function makeScriptBundle(behaviorIds: string[] = []): ScriptBundle {
    return {
        version: 1,
        behaviors: Object.fromEntries(
            behaviorIds.map(id => [
                id,
                {
                    revisionId: "rev1",
                    config: JSON.stringify({name: id, isScript: false}),
                    code: "",
                },
            ]),
        ),
        lambdas: {},
        imports: {},
    };
}

/**
 *
 */
function makeMockAssetLoader() {
    return {
        getBehaviorBundleUrl: vi.fn().mockResolvedValue(null),
    } as any;
}

function makeMockAssetSource(
    assets: Array<{id: string}> = [],
    kind: "scene" | "stem" = "scene",
    id = kind === "scene" ? "scene-1" : "stem-1",
) {
    return {
        kind,
        id,
        getAssets: vi.fn().mockResolvedValue({assets}),
        addDependencies: vi.fn(),
        removeDependencies: vi.fn(),
        createAsset: vi.fn(),
        createAssetRevision: vi.fn(),
    } as any;
}

// --- Tests ---

describe("BehaviorLoadingService", () => {
    let service: BehaviorLoadingService;
    let mockAssetLoader: ReturnType<typeof makeMockAssetLoader>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockAssetLoader = makeMockAssetLoader();
        service = new BehaviorLoadingService(true, mockAssetLoader);
        mockGetAsset.mockResolvedValue({headRevisionId: "rev-head"});
        mockGetBehaviorBundle.mockResolvedValue(null);
        mockGetBehaviorsListForScene.mockResolvedValue([]);
        mockGetBehaviorsFromAssets.mockResolvedValue([]);
        mockGetScriptRevisionData.mockResolvedValue({code: ""});
    });

    describe("prefetchBehaviorBundle", () => {
        it("starts a bundle fetch", async () => {
            mockGetBehaviorBundle.mockResolvedValue(makeScriptBundle(["aaa111bbb222ccc333ddd444"]));

            service.prefetchBehaviorBundle("asset-1", "rev-1");

            const scene = makeScene();
            const result = await service.loadSceneConfigs(scene, {
                assetSource: makeMockAssetSource(),
                assetId: "asset-1",
            });

            expect(mockAssetLoader.getBehaviorBundleUrl).toHaveBeenCalledWith({assetId: "asset-1", revisionId: "rev-1"});
            expect(mockGetBehaviorBundle).toHaveBeenCalledWith("asset-1", "rev-1");
            expect(result.configs).toHaveLength(1);
        });

        it("does not start a second fetch if called twice", () => {
            mockGetBehaviorBundle.mockResolvedValue(makeScriptBundle());

            service.prefetchBehaviorBundle("asset-1", "rev-1");
            service.prefetchBehaviorBundle("asset-1", "rev-1");

            expect(mockAssetLoader.getBehaviorBundleUrl).toHaveBeenCalledTimes(1);
        });
    });

    describe("loadSceneConfigs", () => {
        it("uses prefetched bundle when available", async () => {
            mockGetBehaviorBundle.mockResolvedValue(makeScriptBundle(["aaa111bbb222ccc333ddd444"]));

            service.prefetchBehaviorBundle("asset-1", "rev-1");

            const assetSource = makeMockAssetSource();
            const scene = makeScene();
            await service.loadSceneConfigs(scene, {assetSource, assetId: "asset-1"});

            expect(assetSource.getAssets).not.toHaveBeenCalled();
            expect(mockGetBehaviorsFromAssets).not.toHaveBeenCalled();
            expect(mockGetBehaviorsListForScene).not.toHaveBeenCalled();
        });

        it("fetches bundle inline when no prefetch and assetId is provided", async () => {
            mockGetBehaviorBundle.mockResolvedValue(makeScriptBundle(["aaa111bbb222ccc333ddd444"]));

            const assetSource = makeMockAssetSource();
            const scene = makeScene();
            const result = await service.loadSceneConfigs(scene, {assetSource, assetId: "asset-1"});

            expect(mockGetBehaviorBundle).toHaveBeenCalled();
            expect(mockGetBehaviorsListForScene).not.toHaveBeenCalled();
            expect(result.configs).toHaveLength(1);
        });

        it("falls back to scene behavior list when no assetId for scene sources", async () => {
            const asset = {id: "aaa111bbb222ccc333ddd444"};
            const assetSource = makeMockAssetSource([asset]);
            const sceneBehaviors = [makeBehaviorBackendData("aaa111bbb222ccc333ddd444")];
            mockGetBehaviorsListForScene.mockResolvedValue(sceneBehaviors);

            const scene = makeScene();
            const result = await service.loadSceneConfigs(scene, {assetSource});

            expect(mockGetBehaviorBundle).not.toHaveBeenCalled();
            expect(mockGetBehaviorsListForScene).toHaveBeenCalledWith("scene-1", scene);
            expect(mockGetBehaviorsFromAssets).not.toHaveBeenCalled();
            expect(result.configs).toHaveLength(1);
        });

        it("falls back to scene behavior list when bundle returns null", async () => {
            mockGetBehaviorBundle.mockResolvedValue(null);
            const sceneBehaviors = [makeBehaviorBackendData("aaa111bbb222ccc333ddd444")];
            mockGetBehaviorsListForScene.mockResolvedValue(sceneBehaviors);

            const scene = makeScene();
            const result = await service.loadSceneConfigs(scene, {
                assetSource: makeMockAssetSource(),
                assetId: "asset-1",
            });

            expect(mockGetBehaviorsListForScene).toHaveBeenCalledWith("scene-1", scene);
            expect(result.configs).toHaveLength(1);
        });

        it("falls back to assetSource list for stem sources", async () => {
            const asset = {id: "aaa111bbb222ccc333ddd444"};
            const assetSource = makeMockAssetSource([asset], "stem");
            const sceneBehaviors = [makeBehaviorBackendData("aaa111bbb222ccc333ddd444")];
            mockGetBehaviorsFromAssets.mockResolvedValue(sceneBehaviors);

            const scene = makeScene();
            const result = await service.loadSceneConfigs(scene, {assetSource});

            expect(assetSource.getAssets).toHaveBeenCalledWith({types: expect.any(Array)});
            expect(mockGetBehaviorsFromAssets).toHaveBeenCalledWith([asset], scene);
            expect(result.configs).toHaveLength(1);
        });

        it("merges scene.userData configs with backend configs (legacy)", async () => {
            const backendBehavior = makeBehaviorBackendData("aaa111bbb222ccc333ddd444");
            mockGetBehaviorsListForScene.mockResolvedValue([backendBehavior]);

            const sceneConfig = {id: "local-behavior", name: "local", isScript: false};
            const scene = makeScene({behaviorConfigs: [sceneConfig]});

            const result = await service.loadSceneConfigs(scene, {assetSource: makeMockAssetSource()});

            expect(result.configs).toHaveLength(2);
            const ids = result.configs.map(c => c.id);
            expect(ids).toContain("local-behavior");
        });

        it("prefers backend configs over scene.userData configs with same id (legacy)", async () => {
            const sharedId = "aaa111bbb222ccc333ddd444";
            const backendBehavior = makeBehaviorBackendData(sharedId);
            mockGetBehaviorsListForScene.mockResolvedValue([backendBehavior]);

            const refKey = `${sharedId}:rev1`;
            const sceneConfig = {id: refKey, name: "scene-version", isScript: false};
            const scene = makeScene({behaviorConfigs: [sceneConfig]});

            const result = await service.loadSceneConfigs(scene, {assetSource: makeMockAssetSource()});

            const matching = result.configs.filter(c => c.id === refKey);
            expect(matching).toHaveLength(1);
        });

        it("filters out legacy behavior IDs", async () => {
            const modern = makeBehaviorBackendData("aaa111bbb222ccc333ddd444");
            const legacy = makeBehaviorBackendData("character");
            mockGetBehaviorsListForScene.mockResolvedValue([modern, legacy]);

            const scene = makeScene();
            const result = await service.loadSceneConfigs(scene, {assetSource: makeMockAssetSource()});

            expect(result.configs).toHaveLength(1);
        });

        it("extracts scripts from behaviors with Code", async () => {
            const withCode = makeBehaviorBackendData("aaa111bbb222ccc333ddd444", "console.log('hello')");
            mockGetBehaviorsListForScene.mockResolvedValue([withCode]);

            const scene = makeScene();
            const result = await service.loadSceneConfigs(scene, {assetSource: makeMockAssetSource()});

            const key = `aaa111bbb222ccc333ddd444:rev1`;
            expect(result.scripts[key]).toBe("console.log('hello')");
        });

        it("returns migrated-scene configs (file-based from userData + backend)", async () => {
            const backendBehavior = makeBehaviorBackendData("aaa111bbb222ccc333ddd444");
            mockGetBehaviorsListForScene.mockResolvedValue([backendBehavior]);

            const fileConfig = {id: "local-file", name: "local", isScript: false};
            const scriptConfig = {id: "local-script", name: "script", isScript: true};
            const scene = makeScene({
                behaviorConfigs: [fileConfig, scriptConfig],
                behaviorsMigrated: {migratedBehaviors: ["something"]},
            });

            const result = await service.loadSceneConfigs(scene, {assetSource: makeMockAssetSource()});

            const ids = result.configs.map(c => c.id);
            expect(ids).toContain("local-file");
            expect(ids).not.toContain("local-script");
            expect(ids).toContain("aaa111bbb222ccc333ddd444:rev1");
        });
    });

    describe("caching", () => {
        it("deduplicates concurrent loadSceneConfigs calls", async () => {
            const behaviors = [makeBehaviorBackendData("aaa111bbb222ccc333ddd444")];
            mockGetBehaviorsListForScene.mockResolvedValue(behaviors);

            const assetSource = makeMockAssetSource();
            const scene = makeScene();
            const [r1, r2] = await Promise.all([
                service.loadSceneConfigs(scene, {assetSource}),
                service.loadSceneConfigs(scene, {assetSource}),
            ]);

            expect(r1).toBe(r2);
            expect(mockGetBehaviorsListForScene).toHaveBeenCalledTimes(1);
        });

        it("clearSceneConfigsCache allows a fresh load", async () => {
            mockGetBehaviorsListForScene.mockResolvedValue([]);

            const assetSource = makeMockAssetSource();
            const scene = makeScene();
            await service.loadSceneConfigs(scene, {assetSource});
            expect(mockGetBehaviorsListForScene).toHaveBeenCalledTimes(1);

            service.clearSceneConfigsCache();
            await service.loadSceneConfigs(scene, {assetSource});
            expect(mockGetBehaviorsListForScene).toHaveBeenCalledTimes(2);
        });

        it("reuses cached file behavior classes across loadClasses calls", async () => {
            class TestBehavior {}
            const loadBehaviorsBatch = vi.fn().mockResolvedValue([TestBehavior]);
            (service as any).fileLoader = {loadBehaviorsBatch};
            const configs = [
                {
                    id: "test-file-behavior",
                    main: "TestBehavior.ts",
                    isScript: false,
                },
            ] as any;

            const first = await service.loadClasses(configs, {});
            const second = await service.loadClasses(configs, {});

            expect(first.get("test-file-behavior")).toBe(TestBehavior);
            expect(second.get("test-file-behavior")).toBe(TestBehavior);
            expect(loadBehaviorsBatch).toHaveBeenCalledTimes(1);
        });

        it("caches resolved script import revision maps", async () => {
            mockGetScriptRevisionData.mockResolvedValue({
                code: "function helperValue() { return 1; }",
            });
            const context = {
                logicalIdToAssetId: {helper: "helper-asset"},
                assetIdToRevisionId: {"helper-asset": "helper-rev"},
            };
            const source = '@import "helper" as helper\nthis.value = helper.helperValue();';

            const first = await service.resolveScriptImportRevisionMap(source, context);
            const second = await service.resolveScriptImportRevisionMap(source, context);

            expect(second).toBe(first);
            expect(mockGetScriptRevisionData).toHaveBeenCalledTimes(1);
            expect(first).toMatchObject({
                "helper-asset:helper-rev": {
                    assetId: "helper-asset",
                    revisionId: "helper-rev",
                    code: "function helperValue() { return 1; }",
                },
            });
        });

        it("reuses resolved script imports across repeated script class loads", async () => {
            class TestBehavior {}
            mockGetScriptRevisionData.mockResolvedValue({
                code: "function helperValue() { return 1; }",
            });
            const parse = vi.fn(() => TestBehavior);
            const configs = [
                {
                    id: "script-a",
                    name: "script-a",
                    isScript: true,
                },
            ];
            const scripts = {
                "script-a": '@import "helper" as helper\nthis.value = helper.helperValue();',
            };
            const context = {
                logicalIdToAssetId: {helper: "helper-asset"},
                assetIdToRevisionId: {"helper-asset": "helper-rev"},
            };

            await service.loadClasses(configs as any, scripts, {parse} as any, {context});
            await service.loadClasses(configs as any, scripts, {parse} as any, {context});

            expect(mockGetScriptRevisionData).toHaveBeenCalledTimes(1);
            expect(parse).toHaveBeenCalledTimes(2);
            expect(parse).toHaveBeenCalledWith(
                "script-a",
                scripts["script-a"],
                "script-a",
                expect.objectContaining({
                    context,
                    importRevisionMap: expect.objectContaining({
                        "helper-asset:helper-rev": expect.objectContaining({
                            assetId: "helper-asset",
                            revisionId: "helper-rev",
                        }),
                    }),
                }),
            );
        });

        it("yields between script class parses when configured for play startup", async () => {
            class TestBehavior {}
            const parse = vi.fn(() => TestBehavior);
            const yieldToFrame = vi.fn(async () => {});
            const configs = ["script-a", "script-b", "script-c"].map(id => ({
                id,
                name: id,
                isScript: true,
            }));
            const scripts = Object.fromEntries(configs.map(config => [config.id, "this.update = function() {};"]));

            const loaded = await service.loadClasses(configs as any, scripts, {parse} as any, {
                progress: {
                    batchSize: 1,
                    frameBudgetMs: 9999,
                    yieldToFrame,
                },
            });

            expect(parse).toHaveBeenCalledTimes(3);
            expect(yieldToFrame).toHaveBeenCalledTimes(3);
            expect(loaded.get("script-a")).toBe(TestBehavior);
            expect(loaded.get("script-b")).toBe(TestBehavior);
            expect(loaded.get("script-c")).toBe(TestBehavior);
        });
    });
});
