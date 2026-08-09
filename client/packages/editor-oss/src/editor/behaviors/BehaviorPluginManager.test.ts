import {Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, Object3D, BufferGeometry} from "three";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import BehaviorPluginManager from "./BehaviorPluginManager";
import type {Behavior} from "../../behaviors/Behavior";
import type BehaviorData from "../../behaviors/BehaviorData";
import {
    EDITOR_PREVIEW_ADOPTED_KEY,
    EDITOR_PREVIEW_BEHAVIOR_ID_KEY,
    EDITOR_PREVIEW_BEHAVIOR_UUID_KEY,
    EDITOR_PREVIEW_ROOT_KEY,
} from "../../behaviors/editorPreviewVisuals";

class MockWorker {
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: ErrorEvent) => void) | null = null;
    postMessage = vi.fn();
    terminate = vi.fn();
}

const OriginalWorker = globalThis.Worker;

// Minimal mock editor — only the fields BehaviorPluginManager accesses
const createMockEditor = () => {
    const callFn = vi.fn();
    return {
        engine: {call: callFn},
        call: callFn,
    } as any;
};

const createMockPlugin = (overrides: Partial<Behavior> = {}): Behavior =>
    ({
        uuid: "plugin-uuid",
        id: "test-behavior",
        attributes: {},
        onEditorAttributesUpdated: vi.fn(),
        onEditorAdded: vi.fn(),
        ...overrides,
    }) as unknown as Behavior;

const createBehaviorData = (overrides: Partial<BehaviorData> = {}): BehaviorData => ({
    id: "test-behavior",
    uuid: "behavior-uuid-1",
    enabled: true,
    priority: 0,
    attributesData: {},
    ...overrides,
});

const createObjectWithBehaviors = (behaviors: BehaviorData[]): Object3D => {
    const obj = new Object3D();
    obj.userData.behaviors = behaviors;
    return obj;
};

const addDeepObjectChain = (root: Object3D, depth = 12_000): Object3D => {
    let current = root;

    for (let i = 0; i < depth; i++) {
        const child = new Object3D();
        current.add(child);
        current = child;
    }

    return current;
};

const createDeepAssetRefAttributes = (assetId: string, depth = 12_000): Record<string, unknown> => {
    const root: Record<string, unknown> = {};
    let current = root;

    for (let i = 0; i < depth; i++) {
        const next: Record<string, unknown> = {};
        current.next = next;
        current = next;
    }

    current.prefab = {assetId, revisionId: "rev-1"};
    return root;
};

function makeTriangleGeometry() {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
        "position",
        new Float32BufferAttribute([
            0, 0, 0,
            1, 0, 0,
            0, 1, 0,
        ], 3),
    );
    return geometry;
}

// Mock Comlink for worker bridge tests
const mockProxy = {
    init: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    sendMessage: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
    setOnPostToMain: vi.fn(),
    [Symbol.for("Comlink.releaseProxy")]: vi.fn(),
};

vi.mock("comlink", () => {
    const releaseProxy = Symbol.for("Comlink.releaseProxy");
    return {
        wrap: vi.fn(() => mockProxy),
        proxy: vi.fn((fn: any) => fn),
        releaseProxy,
    };
});

beforeEach(() => {
    (globalThis as any).Worker = MockWorker;
});

afterEach(() => {
    (globalThis as any).Worker = OriginalWorker;
    vi.restoreAllMocks();
});

describe("BehaviorPluginManager", () => {
    describe("addPlugin", () => {
        it("computes normals for editor meshes created by onEditorAdded", () => {
            const editor = createMockEditor();
            const manager = new BehaviorPluginManager(editor);
            const target = new Object3D();
            const geometry = makeTriangleGeometry();
            const plugin = createMockPlugin({
                onEditorAdded: vi.fn(() => {
                    target.add(new Mesh(geometry, new MeshBasicMaterial()));
                }),
            });

            manager.addPlugin(target, plugin);

            expect(geometry.getAttribute("normal")).toBeDefined();
            expect(geometry.getAttribute("normal").count).toBe(geometry.getAttribute("position").count);
        });

        it("tags runtime-only preview roots created by onEditorAdded with behavior ownership", () => {
            const editor = createMockEditor();
            const manager = new BehaviorPluginManager(editor);
            const target = new Object3D();
            const previewRoot = new Object3D();
            previewRoot.userData.isRuntimeOnly = true;
            const persistentChild = new Object3D();
            target.add(persistentChild);
            const plugin = createMockPlugin({
                uuid: "preview-behavior-uuid",
                id: "preview-behavior-id",
                onEditorAdded: vi.fn(() => {
                    target.add(previewRoot);
                }),
            });

            manager.addPlugin(target, plugin);

            expect(previewRoot.userData[EDITOR_PREVIEW_ROOT_KEY]).toBe(true);
            expect(previewRoot.userData[EDITOR_PREVIEW_BEHAVIOR_UUID_KEY]).toBe("preview-behavior-uuid");
            expect(previewRoot.userData[EDITOR_PREVIEW_BEHAVIOR_ID_KEY]).toBe("preview-behavior-id");
            expect(persistentChild.userData[EDITOR_PREVIEW_ROOT_KEY]).toBeUndefined();
        });

        it("marks owned preview roots for declarative runtime adoption before preserved clear disposes plugins", () => {
            const editor = createMockEditor();
            const manager = new BehaviorPluginManager(editor);
            const target = new Object3D();
            const previewRoot = new Object3D();
            previewRoot.userData.isRuntimeOnly = true;
            const plugin = createMockPlugin({
                uuid: "preview-behavior-uuid",
                id: "preview-behavior-id",
                _adoptEditorPreviewRoot: true,
                onEditorAdded: vi.fn(function (this: any) {
                    this._root = previewRoot;
                    target.add(previewRoot);
                }),
                onEditorDispose: vi.fn(function (this: any) {
                    if (!this._root?.userData?.[EDITOR_PREVIEW_ADOPTED_KEY]) {
                        this._root?.removeFromParent();
                    }
                }),
            } as Partial<Behavior> & {_adoptEditorPreviewRoot: boolean});

            manager.addPlugin(target, plugin);
            manager.clear({preserveEditorPreviewRoots: true});

            expect(previewRoot.userData[EDITOR_PREVIEW_ADOPTED_KEY]).toBe(true);
            expect(previewRoot.parent).toBe(target);
        });

        it("does not preserve preview roots for scripts without a runtime adoption contract", () => {
            const editor = createMockEditor();
            const manager = new BehaviorPluginManager(editor);
            const target = new Object3D();
            const previewRoot = new Object3D();
            previewRoot.userData.isRuntimeOnly = true;
            const plugin = createMockPlugin({
                uuid: "preview-behavior-uuid",
                id: "preview-behavior-id",
                _buildTrack: vi.fn(),
                onEditorAdded: vi.fn(function (this: any) {
                    this._editorPreviewRoot = previewRoot;
                    target.add(previewRoot);
                }),
                onEditorDispose: vi.fn(function (this: any) {
                    if (!this._editorPreviewRoot?.userData?.[EDITOR_PREVIEW_ADOPTED_KEY]) {
                        this._editorPreviewRoot?.removeFromParent();
                    }
                    this._editorPreviewRoot = null;
                }),
            } as Partial<Behavior> & {_buildTrack: unknown});

            manager.addPlugin(target, plugin);
            manager.clear({preserveEditorPreviewRoots: true});

            expect(previewRoot.userData[EDITOR_PREVIEW_ADOPTED_KEY]).toBeUndefined();
            expect(previewRoot.parent).toBeNull();
        });

        it("waits for asynchronous editor preview construction", async () => {
            const editor = createMockEditor();
            const manager = new BehaviorPluginManager(editor);
            const target = new Object3D();
            const previewRoot = new Object3D();
            previewRoot.userData.isRuntimeOnly = true;
            let finishBuild!: () => void;
            const buildGate = new Promise<void>(resolve => {
                finishBuild = resolve;
            });
            const plugin = createMockPlugin({
                onEditorAdded: vi.fn(async () => {
                    await buildGate;
                    target.add(previewRoot);
                }),
            });

            manager.addPlugin(target, plugin);
            const ready = manager.waitForPendingAdditions();
            expect(previewRoot.parent).toBeNull();

            finishBuild();
            await ready;

            expect(previewRoot.parent).toBe(target);
            expect(previewRoot.userData[EDITOR_PREVIEW_ROOT_KEY]).toBe(true);
        });
    });

    describe("behaviorReferencesAsset (via updateAssetRefs)", () => {
        it("detects a direct AssetRef attribute", () => {
            const editor = createMockEditor();
            const manager = new BehaviorPluginManager(editor);

            const behavior = createBehaviorData({
                uuid: "b1",
                attributesData: {
                    prefab: {assetId: "stem-123", revisionId: "rev-1"},
                },
            });
            const plugin = createMockPlugin({uuid: "b1"});
            manager.addPlugin(new Object3D(), plugin);

            const scene = new Group();
            scene.add(createObjectWithBehaviors([behavior]));

            manager.updateAssetRefs(scene, "stem-123");

            expect(plugin.onEditorAttributesUpdated).toHaveBeenCalled();
        });

        it("detects an AssetRef nested in an array", () => {
            const editor = createMockEditor();
            const manager = new BehaviorPluginManager(editor);

            const behavior = createBehaviorData({
                uuid: "b1",
                attributesData: {
                    prefabs: [
                        {assetId: "stem-aaa", revisionId: "rev-1"},
                        {assetId: "stem-bbb", revisionId: "rev-2"},
                    ],
                },
            });
            const plugin = createMockPlugin({uuid: "b1"});
            manager.addPlugin(new Object3D(), plugin);

            const scene = new Group();
            scene.add(createObjectWithBehaviors([behavior]));

            manager.updateAssetRefs(scene, "stem-bbb");

            expect(plugin.onEditorAttributesUpdated).toHaveBeenCalled();
        });

        it("detects an AssetRef nested in an object", () => {
            const editor = createMockEditor();
            const manager = new BehaviorPluginManager(editor);

            const behavior = createBehaviorData({
                uuid: "b1",
                attributesData: {
                    config: {
                        inner: {assetId: "model-xyz", revisionId: "rev-1"},
                    },
                },
            });
            const plugin = createMockPlugin({uuid: "b1"});
            manager.addPlugin(new Object3D(), plugin);

            const scene = new Group();
            scene.add(createObjectWithBehaviors([behavior]));

            manager.updateAssetRefs(scene, "model-xyz");

            expect(plugin.onEditorAttributesUpdated).toHaveBeenCalled();
        });

        it("returns false when no attributes reference the asset", () => {
            const editor = createMockEditor();
            const manager = new BehaviorPluginManager(editor);

            const behavior = createBehaviorData({
                uuid: "b1",
                attributesData: {
                    prefab: {assetId: "stem-other", revisionId: "rev-1"},
                    name: "hello",
                    count: 42,
                },
            });
            const plugin = createMockPlugin({uuid: "b1"});
            manager.addPlugin(new Object3D(), plugin);

            const scene = new Group();
            scene.add(createObjectWithBehaviors([behavior]));

            manager.updateAssetRefs(scene, "stem-123");

            expect(plugin.onEditorAttributesUpdated).not.toHaveBeenCalled();
        });

        it("returns false when attributesData is empty", () => {
            const editor = createMockEditor();
            const manager = new BehaviorPluginManager(editor);

            const behavior = createBehaviorData({uuid: "b1", attributesData: {}});
            const plugin = createMockPlugin({uuid: "b1"});
            manager.addPlugin(new Object3D(), plugin);

            const scene = new Group();
            scene.add(createObjectWithBehaviors([behavior]));

            manager.updateAssetRefs(scene, "stem-123");

            expect(plugin.onEditorAttributesUpdated).not.toHaveBeenCalled();
        });
    });

    describe("updateAssetRefs", () => {
        it("updates plugin attributes before calling onEditorAttributesUpdated", () => {
            const editor = createMockEditor();
            const manager = new BehaviorPluginManager(editor);

            const attributesData = {
                prefab: {assetId: "stem-123", revisionId: "rev-2"},
            };
            const behavior = createBehaviorData({uuid: "b1", attributesData});
            const plugin = createMockPlugin({uuid: "b1"});

            let capturedAttributes: Record<string, any> | undefined;
            (plugin as any).onEditorAttributesUpdated = vi.fn(() => {
                capturedAttributes = (plugin as any).attributes;
            });

            manager.addPlugin(new Object3D(), plugin);

            const scene = new Group();
            scene.add(createObjectWithBehaviors([behavior]));

            manager.updateAssetRefs(scene, "stem-123");

            expect(capturedAttributes).toBe(attributesData);
        });

        it("only notifies plugins whose behaviors reference the changed asset", () => {
            const editor = createMockEditor();
            const manager = new BehaviorPluginManager(editor);

            const matchingBehavior = createBehaviorData({
                uuid: "b1",
                attributesData: {prefab: {assetId: "stem-123", revisionId: "rev-1"}},
            });
            const unrelatedBehavior = createBehaviorData({
                uuid: "b2",
                attributesData: {model: {assetId: "model-456", revisionId: "rev-1"}},
            });

            const matchingPlugin = createMockPlugin({uuid: "b1"});
            const unrelatedPlugin = createMockPlugin({uuid: "b2"});
            manager.addPlugin(new Object3D(), matchingPlugin);
            manager.addPlugin(new Object3D(), unrelatedPlugin);

            const scene = new Group();
            scene.add(createObjectWithBehaviors([matchingBehavior]));
            scene.add(createObjectWithBehaviors([unrelatedBehavior]));

            manager.updateAssetRefs(scene, "stem-123");

            expect(matchingPlugin.onEditorAttributesUpdated).toHaveBeenCalled();
            expect(unrelatedPlugin.onEditorAttributesUpdated).not.toHaveBeenCalled();
        });

        it("fires objectChanged only for affected objects", () => {
            const editor = createMockEditor();
            const manager = new BehaviorPluginManager(editor);

            const matchingBehavior = createBehaviorData({
                uuid: "b1",
                attributesData: {prefab: {assetId: "stem-123", revisionId: "rev-1"}},
            });
            const unrelatedBehavior = createBehaviorData({
                uuid: "b2",
                attributesData: {name: "foo"},
            });

            manager.addPlugin(new Object3D(), createMockPlugin({uuid: "b1"}));

            const scene = new Group();
            const affectedObj = createObjectWithBehaviors([matchingBehavior]);
            const unaffectedObj = createObjectWithBehaviors([unrelatedBehavior]);
            scene.add(affectedObj);
            scene.add(unaffectedObj);

            manager.updateAssetRefs(scene, "stem-123");

            const calls = editor.engine.call.mock.calls.filter(
                (c: any[]) => c[0] === "objectChanged",
            );
            expect(calls).toHaveLength(1);
            expect(calls[0][2]).toBe(affectedObj);
        });

        it("handles behaviors without a registered plugin gracefully", () => {
            const editor = createMockEditor();
            const manager = new BehaviorPluginManager(editor);

            // No plugin registered for this behavior
            const behavior = createBehaviorData({
                uuid: "unregistered",
                attributesData: {prefab: {assetId: "stem-123", revisionId: "rev-1"}},
            });

            const scene = new Group();
            scene.add(createObjectWithBehaviors([behavior]));

            // Should not throw
            expect(() => manager.updateAssetRefs(scene, "stem-123")).not.toThrow();

            // objectChanged should still fire since the behavior references the asset
            const calls = editor.engine.call.mock.calls.filter(
                (c: any[]) => c[0] === "objectChanged",
            );
            expect(calls).toHaveLength(1);
        });

        it("traverses nested children", () => {
            const editor = createMockEditor();
            const manager = new BehaviorPluginManager(editor);

            const behavior = createBehaviorData({
                uuid: "b1",
                attributesData: {prefab: {assetId: "stem-123", revisionId: "rev-1"}},
            });
            const plugin = createMockPlugin({uuid: "b1"});
            manager.addPlugin(new Object3D(), plugin);

            const scene = new Group();
            const parent = new Group();
            const child = createObjectWithBehaviors([behavior]);
            parent.add(child);
            scene.add(parent);

            manager.updateAssetRefs(scene, "stem-123");

            expect(plugin.onEditorAttributesUpdated).toHaveBeenCalled();
        });

        it("updates asset refs in deep scenes without recursive Object3D traversal", () => {
            const editor = createMockEditor();
            const manager = new BehaviorPluginManager(editor);

            const behavior = createBehaviorData({
                uuid: "b1",
                attributesData: {prefab: {assetId: "stem-123", revisionId: "rev-1"}},
            });
            const plugin = createMockPlugin({uuid: "b1"});
            manager.addPlugin(new Object3D(), plugin);

            const scene = new Group();
            const leaf = addDeepObjectChain(scene);
            leaf.add(createObjectWithBehaviors([behavior]));
            const traverseSpy = vi.spyOn(scene, "traverse");

            manager.updateAssetRefs(scene, "stem-123");

            expect(plugin.onEditorAttributesUpdated).toHaveBeenCalled();
            expect(traverseSpy).not.toHaveBeenCalled();
        });

        it("detects deeply nested asset attributes without recursive stack growth", () => {
            const editor = createMockEditor();
            const manager = new BehaviorPluginManager(editor);

            const behavior = createBehaviorData({
                uuid: "b1",
                attributesData: createDeepAssetRefAttributes("stem-123"),
            });
            const plugin = createMockPlugin({uuid: "b1"});
            manager.addPlugin(new Object3D(), plugin);

            const scene = new Group();
            scene.add(createObjectWithBehaviors([behavior]));

            expect(() => manager.updateAssetRefs(scene, "stem-123")).not.toThrow();
            expect(plugin.onEditorAttributesUpdated).toHaveBeenCalled();
        });
    });

    describe("worker lifecycle", () => {
        it("starts plugin workers with editor runtime init data", () => {
            const editor = createMockEditor();
            const manager = new BehaviorPluginManager(editor);
            const getWorkerInitData = vi.fn(() => ({runtime: "editor", foo: "bar"}));
            const plugin = createMockPlugin({
                workerClass: MockWorker as any,
                getWorkerInitData,
            });

            manager.addPlugin(new Object3D(), plugin);
            expect(plugin._workerBridge?.isActive).toBe(true);
            expect(getWorkerInitData).toHaveBeenCalledWith("editor");

            manager.clear();
            expect(plugin._workerBridge?.isActive ?? false).toBe(false);
        });

        it("skips worker init when no workerClass is provided", () => {
            const editor = createMockEditor();
            const manager = new BehaviorPluginManager(editor);
            const plugin = createMockPlugin();

            manager.addPlugin(new Object3D(), plugin);
            expect(plugin._workerBridge).toBeUndefined();
        });
    });

    describe("editor update activity", () => {
        it("only marks plugins with onEditorUpdate as needing the editor update loop", () => {
            const editor = createMockEditor();
            const onUpdateActivityChanged = vi.fn();
            const manager = new BehaviorPluginManager(editor, onUpdateActivityChanged);
            const setupOnlyPlugin = createMockPlugin({uuid: "setup-only"});

            manager.addPlugin(new Object3D(), setupOnlyPlugin);

            expect(manager.hasEditorUpdatePlugins()).toBe(false);
            expect(onUpdateActivityChanged).not.toHaveBeenCalled();

            const onEditorUpdate = vi.fn();
            const updatePlugin = createMockPlugin({
                uuid: "update-plugin",
                onEditorUpdate,
            });
            manager.addPlugin(new Object3D(), updatePlugin);

            expect(manager.hasEditorUpdatePlugins()).toBe(true);
            expect(onUpdateActivityChanged).toHaveBeenLastCalledWith(true);

            manager.update(1);
            expect(onEditorUpdate).toHaveBeenCalledTimes(1);

            manager.removePlugin(updatePlugin);

            expect(manager.hasEditorUpdatePlugins()).toBe(false);
            expect(onUpdateActivityChanged).toHaveBeenLastCalledWith(false);
        });

        it("notifies once when clear removes update plugins", () => {
            const editor = createMockEditor();
            const onUpdateActivityChanged = vi.fn();
            const manager = new BehaviorPluginManager(editor, onUpdateActivityChanged);

            manager.addPlugin(new Object3D(), createMockPlugin({
                uuid: "update-plugin",
                onEditorUpdate: vi.fn(),
            }));
            onUpdateActivityChanged.mockClear();

            manager.clear();

            expect(manager.hasEditorUpdatePlugins()).toBe(false);
            expect(onUpdateActivityChanged).toHaveBeenCalledTimes(1);
            expect(onUpdateActivityChanged).toHaveBeenCalledWith(false);
        });
    });
});
