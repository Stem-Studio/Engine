import {Scene} from "three";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

const getSceneV2 = vi.fn();
const legacyLoadScene = vi.fn();

vi.mock("@stem/network/api/scene/v2", () => ({
    getScene: (...args: unknown[]) => getSceneV2(...args),
}));

vi.mock("@stem/network/api/scene", () => ({
    checkIsSceneCollaborator: vi.fn(),
    loadScene: (...args: unknown[]) => legacyLoadScene(...args),
}));

import {EngineRuntime} from "../EngineRuntime";
import {loadSceneRestorePayload} from "./loadSceneRestorePayload";

describe("loadSceneRestorePayload", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("restores through the OSS v2 adapter and never requests the legacy remote scene endpoint", async () => {
        const storedScene = [{metadata: {generator: "SceneSerializer"}, name: "Saved scene"}];
        const dataUrl = "data:application/json;base64,eyJsb2NhIjp0cnVlfQ==";
        getSceneV2.mockResolvedValue({
            id: "oss-project-1",
            asset: {
                revision: {
                    dataUrl,
                    metadata: {
                        dependencies: {"asset-1": "revision-1"},
                        logicalIdToAssetId: {"hero-model": "asset-1"},
                    },
                },
            },
        });
        const fetchImpl = vi.fn(async (url: string) => {
            if (!url.startsWith("data:")) {
                throw new Error(`Unexpected remote request: ${url}`);
            }
            return {
                ok: true,
                status: 200,
                json: async () => storedScene,
            } as Response;
        });

        await expect(loadSceneRestorePayload("oss-project-1", fetchImpl as typeof fetch)).resolves.toEqual({
            data: storedScene,
            metadata: {
                Dependencies: {"asset-1": "revision-1"},
                LogicalIDToAssetID: {"hero-model": "asset-1"},
            },
        });

        expect(getSceneV2).toHaveBeenCalledWith("oss-project-1", {
            includeDerivatives: true,
            includeDerivativeDataUrl: true,
        });
        expect(fetchImpl).toHaveBeenCalledOnce();
        expect(fetchImpl).toHaveBeenCalledWith(dataUrl);
        expect(legacyLoadScene).not.toHaveBeenCalled();
    });

    it("restores an OSS Play -> Edit transition from ProjectStore data without a remote API call", async () => {
        const storedScene = [{metadata: {generator: "SceneSerializer"}, name: "Edit snapshot"}];
        const dataUrl = "data:application/json;base64,W10=";
        getSceneV2.mockResolvedValue({
            id: "oss-project-2",
            asset: {
                revision: {
                    dataUrl,
                    metadata: {
                        dependencies: {},
                        logicalIdToAssetId: {},
                    },
                },
            },
        });
        const fetchSpy = vi.fn(async (url: string) => {
            expect(url).toMatch(/^data:/);
            return {
                ok: true,
                status: 200,
                json: async () => storedScene,
            } as Response;
        });
        vi.stubGlobal("fetch", fetchSpy);

        const runtime = Object.create(EngineRuntime.prototype) as EngineRuntime;
        const restoredScene = new Scene();
        const setScene = vi.fn(async () => {});
        const loadSceneFromData = vi.fn(async ({sceneData}: {sceneData: unknown}) => {
            expect(sceneData).toEqual({
                data: storedScene,
                metadata: {
                    Dependencies: {},
                    LogicalIDToAssetID: {},
                },
            });
            return {scene: restoredScene};
        });
        const runtimeInternals = runtime as unknown as {
            _scene: Scene;
            editor: {sceneID: string; setScene: typeof setScene};
            camera: object;
            renderer: {domElement: {width: number; height: number}};
            options: object;
            assetLoader: object;
            seedAssetLoader: () => Promise<void>;
            loadSceneFromData: typeof loadSceneFromData;
            ensureRenderableMeshNormalsForScene: () => Promise<void>;
            ensureSceneRenderingSupport: () => Promise<void>;
            call: ReturnType<typeof vi.fn>;
            restoreSceneState: () => Promise<void>;
        };
        runtimeInternals._scene = new Scene();
        runtimeInternals.editor = {sceneID: "oss-project-2", setScene};
        runtimeInternals.camera = {};
        runtimeInternals.renderer = {domElement: {width: 1280, height: 720}};
        runtimeInternals.options = {};
        runtimeInternals.assetLoader = {};
        runtimeInternals.seedAssetLoader = vi.fn(async () => {});
        runtimeInternals.loadSceneFromData = loadSceneFromData;
        runtimeInternals.ensureRenderableMeshNormalsForScene = vi.fn(async () => {});
        runtimeInternals.ensureSceneRenderingSupport = vi.fn(async () => {});
        runtimeInternals.call = vi.fn();

        await runtimeInternals.restoreSceneState();

        expect(getSceneV2).toHaveBeenCalledWith("oss-project-2", {
            includeDerivatives: true,
            includeDerivativeDataUrl: true,
        });
        expect(fetchSpy).toHaveBeenCalledOnce();
        expect(legacyLoadScene).not.toHaveBeenCalled();
        expect(setScene).toHaveBeenCalledWith(restoredScene, true);
    });
});
