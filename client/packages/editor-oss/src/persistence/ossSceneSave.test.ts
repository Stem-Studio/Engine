/**
 * Tests for the OSS scene-save wiring. Verifies two things:
 *
 *   1. `setProjectStore` automatically installs / clears the OSS save
 *      handler on `network/scene` depending on the store kind. This is
 *      what makes every existing `saveScene(...)` call site route to
 *      IndexedDB / FS Access in OSS builds without changes to call sites.
 *
 *   2. The `ossSaveScene` handler itself serializes the editor state via
 *      Converter, builds a ProjectBody, and persists it through the
 *      registered store. Failures are reported via app events + a toast.
 */

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {Group, Mesh, MeshBasicMaterial, Scene, SphereGeometry} from "three";

import {ossSaveScene} from "./ossSceneSave";
import {setProjectStore} from "./projectStoreFactory";
import type {ProjectStore} from "./ProjectStore";
import type {ProjectBody, ProjectMeta} from "./types";

type PreviewState = {previewId: string; label?: string};

const networkScene = await vi.hoisted(async () => {
    const handlerSpy = vi.fn();
    return {
        handlerSpy,
        module: {
            setSceneSaveHandler: handlerSpy,
        },
    };
});

const copilotPreview = vi.hoisted(() => ({
    getActive: vi.fn<() => PreviewState | null>(() => null),
    isBlocked: vi.fn<() => boolean>(() => false),
}));

const stemEditorSave = vi.hoisted(() => ({
    save: vi.fn(async () => undefined),
}));

const serializationProbe = vi.hoisted(() => ({firstMeshGeometry: null as unknown}));

vi.mock("@stem/network/api/scene/saveHandler", async () => networkScene.module);

vi.mock("../agent/copilotPreviewPersistence", () => ({
    getActiveCopilotPreviewPersistence: copilotPreview.getActive,
    isCopilotPreviewSceneSaveBlocked: copilotPreview.isBlocked,
}));

vi.mock("../editor/stem-editor/saveStemEditor", () => ({
    saveStemEditor: stemEditorSave.save,
}));

vi.mock("../showToast", () => ({
    showToast: vi.fn(),
}));

vi.mock("../serialization/Converter", () => {
    return {
        default: class {
            toJSON(opts: unknown) {
                const scene = (opts as {scene?: {uuid?: string}}).scene;
                const candidate = scene as {
                    traverse?: (callback: (object: {isMesh?: boolean; geometry?: unknown}) => void) => void;
                } | undefined;
                candidate?.traverse?.(object => {
                    if (serializationProbe.firstMeshGeometry === null && object.isMesh) {
                        serializationProbe.firstMeshGeometry = object.geometry ?? null;
                    }
                });
                return [{uuid: scene?.uuid, userData: {}, wrapped: opts}];
            }
        },
    };
});

const stubStore = (
    kind: "indexeddb" | "filesystem" | "remote",
    save?: ProjectStore["save"],
    saveAssets?: ProjectStore["saveAssets"],
): ProjectStore => {
    const saveProject = save ?? vi.fn(async (body: ProjectBody): Promise<ProjectMeta> => body.meta);
    const saveProjectAssets = saveAssets ?? vi.fn(async () => undefined);
    return {
        kind,
        list: vi.fn(async () => ({projects: [], page: 1, hasMore: false, totalCount: 0})),
        load: vi.fn(async () => ({meta: {id: "", name: "", updatedAt: "", createdAt: ""}, sceneJson: "{}"})),
        save: saveProject,
        commitProject: async (body, assets) => {
            await saveProjectAssets(body.meta.id, assets);
            return saveProject(body);
        },
        delete: vi.fn(async () => undefined),
        exportToBlob: vi.fn(async () => new Blob([])),
        importFromBlob: vi.fn(async (): Promise<ProjectMeta> => ({id: "", name: "", updatedAt: "", createdAt: ""})),
        saveAssets: saveProjectAssets,
        loadAssets: vi.fn(async () => []),
    };
};

beforeEach(() => {
    networkScene.handlerSpy.mockClear();
    // Reset singleton + clear handler between tests.
    setProjectStore(undefined);
    networkScene.handlerSpy.mockClear();
});

afterEach(() => {
    setProjectStore(undefined);
});

describe("setProjectStore handler wiring", () => {
    it("installs the OSS save handler when an IndexedDB store is registered", () => {
        setProjectStore(stubStore("indexeddb"));
        const last = networkScene.handlerSpy.mock.calls.at(-1);
        expect(typeof last?.[0]).toBe("function");
    });

    it("installs the OSS save handler when a FileSystem store is registered", () => {
        setProjectStore(stubStore("filesystem"));
        const last = networkScene.handlerSpy.mock.calls.at(-1);
        expect(typeof last?.[0]).toBe("function");
    });

    it("clears the save handler when a Remote store is registered", () => {
        setProjectStore(stubStore("remote"));
        const last = networkScene.handlerSpy.mock.calls.at(-1);
        expect(last?.[0]).toBeNull();
    });

    it("clears the save handler when the store is unset", () => {
        setProjectStore(undefined);
        const last = networkScene.handlerSpy.mock.calls.at(-1);
        expect(last?.[0]).toBeNull();
    });
});

describe("ossSaveScene", () => {
    type AppLike = {
        options: unknown;
        camera: unknown;
        scripts: unknown;
        scene: {uuid: string; name: string; userData?: Record<string, unknown>};
        editor: {
            isReadOnly?: boolean;
            sceneID?: string;
            sceneName?: string;
            sceneThumbnail?: string;
            onSaveScene: () => void;
            refreshEditorPreviewInstancingBudget?: () => void;
        };
        call: ReturnType<typeof vi.fn>;
    };

    const buildApp = (overrides: Partial<AppLike["editor"]> = {}): AppLike => ({
        options: {fov: 60},
        camera: {position: [0, 0, 5]},
        scripts: {},
        scene: {uuid: "scene-1", name: "main", userData: {}},
        editor: {
            isReadOnly: false,
            sceneName: "My Project",
            onSaveScene: vi.fn(),
            ...overrides,
        },
        call: vi.fn(),
    });

    beforeEach(async () => {
        const globalMod = await import("../global");
        // @ts-expect-error mutate for test
        globalMod.default.app = undefined;
        copilotPreview.getActive.mockReturnValue(null);
        copilotPreview.isBlocked.mockReturnValue(false);
        stemEditorSave.save.mockClear();
        serializationProbe.firstMeshGeometry = null;
    });

    it("persists a serialized body via the registered ProjectStore and back-fills sceneID", async () => {
        const saveSpy = vi.fn(async (body: ProjectBody): Promise<ProjectMeta> => body.meta);
        setProjectStore(stubStore("indexeddb", saveSpy));

        const app = buildApp(); // no sceneID — handler must generate one
        const globalMod = await import("../global");
        // @ts-expect-error mutate for test
        globalMod.default.app = app;

        await ossSaveScene(false, false);

        expect(saveSpy).toHaveBeenCalledTimes(1);
        const body = saveSpy.mock.calls[0]![0]!;
        expect(body.meta.name).toBe("My Project");
        expect(body.meta.id).toMatch(/^oss-/);
        expect(body.sceneJson).toContain('"wrapped"');
        expect(app.call).toHaveBeenCalledWith("sceneSaveStart");
        expect(app.call).toHaveBeenCalledWith(
            "sceneSaved",
            null,
            expect.objectContaining({id: body.meta.id}),
        );
        expect(app.editor.sceneID).toBe(body.meta.id);
        expect(JSON.parse(body.sceneJson)[0].userData.lastSaveTime).toEqual(expect.any(Number));
        expect(app.scene.userData?.lastSaveTime).toEqual(expect.any(Number));
    });

    it("preserves an existing sceneID across saves", async () => {
        const saveSpy = vi.fn(async (body: ProjectBody): Promise<ProjectMeta> => body.meta);
        setProjectStore(stubStore("indexeddb", saveSpy));

        const app = buildApp({sceneID: "existing-id"});
        const globalMod = await import("../global");
        // @ts-expect-error mutate for test
        globalMod.default.app = app;

        await ossSaveScene(false, false);
        const body = saveSpy.mock.calls[0]![0]!;
        expect(body.meta.id).toBe("existing-id");
        expect(app.editor.sceneID).toBe("existing-id");
    });

    it("serializes authored geometry while editor preview geometry is capped", async () => {
        const saveSpy = vi.fn(async (body: ProjectBody): Promise<ProjectMeta> => body.meta);
        setProjectStore(stubStore("indexeddb", saveSpy));

        const scene = new Scene();
        const modelRoot = new Group();
        modelRoot.userData.modelId = "model-save-test";
        const mesh = new Mesh(new SphereGeometry(1, 32, 24), new MeshBasicMaterial());
        modelRoot.add(mesh);
        scene.add(modelRoot);
        const source = mesh.geometry;

        const {applyEditorPreviewGeometryBudget} = await import("../utils/editorPreviewGeometryBudget");
        applyEditorPreviewGeometryBudget(scene, {
            maxTotalTriangles: 400,
            minTriangles: 100,
            simplifyRatio: 0.25,
        });
        expect(mesh.geometry).not.toBe(source);

        const app = buildApp({
            sceneID: "preview-save",
            refreshEditorPreviewInstancingBudget: () => {
                applyEditorPreviewGeometryBudget(scene);
            },
        });
        app.scene = scene as unknown as AppLike["scene"];
        const globalMod = await import("../global");
        // @ts-expect-error mutate for test
        globalMod.default.app = app;

        await ossSaveScene(false, false);

        expect(serializationProbe.firstMeshGeometry).toBe(source);
        expect(mesh.geometry).toBe(source);
        expect(saveSpy).toHaveBeenCalledTimes(1);
    });

    it("emits sceneSaveFailed and does not write when serialization throws", async () => {
        const saveSpy = vi.fn();
        setProjectStore(stubStore("indexeddb", saveSpy));

        const app = buildApp();
        // Replace Converter mock for this test to throw.
        const converterMod = (await import("../serialization/Converter")) as {default: unknown};
        const original = converterMod.default;
        converterMod.default = class {
            toJSON() {
                throw new Error("serialize boom");
            }
        };

        const globalMod = await import("../global");
        // @ts-expect-error mutate for test
        globalMod.default.app = app;

        await expect(ossSaveScene(false, false)).rejects.toThrow("serialize boom");

        expect(saveSpy).not.toHaveBeenCalled();
        expect(app.call).toHaveBeenCalledWith("sceneSaveFailed");

        converterMod.default = original;
    });

    it("reports a save FAILURE (not success) when binary asset persistence throws", async () => {
        // The scene JSON saves fine, but persisting its binary assets fails.
        // Reporting "Saved" here would be a masking fallback: a reload would
        // render a scene with missing models. The save must surface as failed.
        const saveSpy = vi.fn(async (body: ProjectBody): Promise<ProjectMeta> => body.meta);
        const saveAssetsSpy = vi.fn(async () => {
            throw new Error("asset disk write failed");
        });
        setProjectStore(stubStore("filesystem", saveSpy, saveAssetsSpy));

        const app = buildApp({sceneID: "proj-assets"});
        const globalMod = await import("../global");
        // @ts-expect-error mutate for test
        globalMod.default.app = app;

        await expect(ossSaveScene(false, false)).rejects.toThrow("asset disk write failed");

        expect(saveSpy).not.toHaveBeenCalled();
        expect(saveAssetsSpy).toHaveBeenCalledTimes(1);
        expect(app.call).toHaveBeenCalledWith("sceneSaveFailed");
        // Must NOT have falsely announced success.
        expect(app.call).not.toHaveBeenCalledWith("sceneSaved", expect.anything(), expect.anything());
        expect(app.scene.userData?.lastSaveTime).toBeUndefined();
    });

    it("coalesces overlapping requests into one non-overlapping follow-up save", async () => {
        let releaseFirstWrite!: () => void;
        const firstWriteGate = new Promise<void>(resolve => {
            releaseFirstWrite = resolve;
        });
        let writesInFlight = 0;
        let maxWritesInFlight = 0;
        let writeCount = 0;
        const saveSpy = vi.fn(async (body: ProjectBody): Promise<ProjectMeta> => {
            writesInFlight++;
            maxWritesInFlight = Math.max(maxWritesInFlight, writesInFlight);
            writeCount++;
            if (writeCount === 1) await firstWriteGate;
            writesInFlight--;
            return body.meta;
        });
        setProjectStore(stubStore("filesystem", saveSpy));

        const app = buildApp({sceneID: "queued-save"});
        app.scene.userData = {lastEditTime: 100};
        const globalMod = await import("../global");
        // @ts-expect-error mutate for test
        globalMod.default.app = app;

        const first = ossSaveScene(false, false);
        await vi.waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));

        app.scene.userData.lastEditTime = 200;
        const second = ossSaveScene(false, false);
        const coalescedThird = ossSaveScene(false, false);
        releaseFirstWrite();
        await Promise.all([first, second, coalescedThird]);

        expect(saveSpy).toHaveBeenCalledTimes(2);
        expect(maxWritesInFlight).toBe(1);
        expect(app.scene.userData.lastSaveTime).toBe(200);
        expect(app.call.mock.calls.filter(([event]) => event === "sceneSaveStart")).toHaveLength(2);
    });

    it("does not mark a replacement scene saved when the original commit finishes", async () => {
        let release!: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        const saveSpy = vi.fn(async (body: ProjectBody): Promise<ProjectMeta> => {
            await gate;
            return body.meta;
        });
        setProjectStore(stubStore("indexeddb", saveSpy));
        const app = buildApp({sceneID: "scene-a"});
        app.scene.userData = {lastEditTime: 10};
        const globalMod = await import("../global");
        // @ts-expect-error mutate for test
        globalMod.default.app = app;

        const saving = ossSaveScene(false, false);
        await vi.waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
        const replacement = {uuid: "scene-b", name: "replacement", userData: {lastEditTime: 20}};
        app.scene = replacement;
        release();

        await expect(saving).rejects.toThrow(/no longer active/);
        expect(replacement.userData).not.toHaveProperty("lastSaveTime");
        expect(app.call).not.toHaveBeenCalledWith("sceneSaved", expect.anything(), expect.anything());
    });

    it("does not mark the scene saved after its ProjectStore is switched", async () => {
        let release!: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        const firstStore = stubStore(
            "indexeddb",
            vi.fn(async (body: ProjectBody): Promise<ProjectMeta> => {
                await gate;
                return body.meta;
            }),
        );
        setProjectStore(firstStore);
        const app = buildApp({sceneID: "store-switch"});
        app.scene.userData = {lastEditTime: 10};
        const globalMod = await import("../global");
        // @ts-expect-error mutate for test
        globalMod.default.app = app;

        const saving = ossSaveScene(false, false);
        await Promise.resolve();
        setProjectStore(stubStore("filesystem"));
        release();

        await expect(saving).rejects.toThrow(/no longer active/);
        expect(app.scene.userData).not.toHaveProperty("lastSaveTime");
    });

    it("short-circuits in read-only mode", async () => {
        const saveSpy = vi.fn();
        setProjectStore(stubStore("indexeddb", saveSpy));

        const app = buildApp({isReadOnly: true});
        const globalMod = await import("../global");
        // @ts-expect-error mutate for test
        globalMod.default.app = app;

        await ossSaveScene(false, false);
        expect(saveSpy).not.toHaveBeenCalled();
        expect(app.call).not.toHaveBeenCalledWith("sceneSaveStart");
    });

    it("blocks local saves while a Copilot preview is active", async () => {
        const saveSpy = vi.fn();
        setProjectStore(stubStore("indexeddb", saveSpy));
        copilotPreview.isBlocked.mockReturnValue(true);
        copilotPreview.getActive.mockReturnValue({previewId: "preview-1", label: "Preview"});

        const app = buildApp();
        const globalMod = await import("../global");
        // @ts-expect-error mutate for test
        globalMod.default.app = app;

        await ossSaveScene(false, false);

        expect(saveSpy).not.toHaveBeenCalled();
        expect(app.call).toHaveBeenCalledWith(
            "copilotPreviewSaveBlocked",
            null,
            expect.objectContaining({previewId: "preview-1"}),
        );
    });

    it("delegates to the stem editor save flow for stem-editor scenes", async () => {
        const saveSpy = vi.fn();
        setProjectStore(stubStore("indexeddb", saveSpy));

        const app = buildApp();
        app.scene.userData = {stemEditor: {assetId: "stem-asset"}};
        const globalMod = await import("../global");
        // @ts-expect-error mutate for test
        globalMod.default.app = app;

        await ossSaveScene(false, false);

        expect(stemEditorSave.save).toHaveBeenCalledTimes(1);
        expect(saveSpy).not.toHaveBeenCalled();
        expect(app.call).not.toHaveBeenCalledWith("sceneSaveStart");
    });
});
