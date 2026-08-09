import {
    DirectionalLight,
    HemisphereLight,
    Object3D,
    Scene,
} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import Editor from "./Editor";

function namedObject(name: string): Object3D {
    const object = new Object3D();
    object.name = name;
    return object;
}

function addDeepChain(root: Object3D, depth = 12_000): Object3D {
    let cursor = root;
    for (let i = 0; i < depth; i++) {
        const child = namedObject(`deep-${i}`);
        cursor.add(child);
        cursor = child;
    }
    return cursor;
}

function createSetSceneHarness() {
    const previousScene = new Scene();
    const engine = {
        scene: previousScene,
        batchedRenderer: namedObject("BatchedRenderer"),
        options: {isPlayModeOnly: false},
    };
    const editor = Object.create(Editor.prototype) as any;
    editor.engine = engine;
    editor.ctx = engine;
    editor.sceneConfig = {VFXOnMobile: true};
    editor.objectsNames = new Set<string>();
    editor.behaviorConfigsLoaded = true;
    editor.processParticleSystems = vi.fn(async () => {});
    editor.onSceneLoaded = vi.fn(async () => {});

    return {editor, engine};
}

describe("Editor.setScene", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("normalizes deeply nested scenes without Three recursive traversal", async () => {
        const scene = new Scene();
        scene.name = "Deep Scene";
        const leaf = addDeepChain(scene);
        const directional = new DirectionalLight();
        directional.name = "Directional Light";
        directional.userData.physics = {enabled: true};
        const hemisphere = new HemisphereLight();
        hemisphere.name = "Hemisphere Light";
        leaf.add(directional, hemisphere);
        const traverse = vi.spyOn(scene, "traverse");
        const {editor, engine} = createSetSceneHarness();

        await editor.setScene(scene, false, true);

        expect(traverse).not.toHaveBeenCalled();
        expect(engine.scene).toBe(scene);
        expect(editor.processParticleSystems).toHaveBeenCalledWith(scene);
        expect(editor.onSceneLoaded).toHaveBeenCalledTimes(1);
        expect(editor.objectsNames.has("Deep Scene")).toBe(true);
        expect(editor.objectsNames.has("Directional Light")).toBe(true);
        expect(directional.userData.physics).toBeUndefined();
        expect(hemisphere.position.toArray()).toEqual([1e9, 1e9, 1e9]);
    });

    it("marks legacy loaded scenes clean when only an edit watermark exists", async () => {
        const scene = new Scene();
        scene.userData.lastEditTime = "2026-07-07T16:59:03.000Z";
        const {editor} = createSetSceneHarness();

        await editor.setScene(scene);

        expect(scene.userData.lastSaveTime).toBe(scene.userData.lastEditTime);
    });
});

describe("Editor.cleanupBehaviorPluginsForObjectAndChildren", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("cleans deep behavior plugin hierarchies without Three recursive traversal", () => {
        const root = namedObject("root");
        const leaf = addDeepChain(root);
        leaf.userData.behaviors = [{id: "script-behavior", uuid: "behavior-uuid"}];
        const plugin = {uuid: "behavior-uuid"};
        const removePlugin = vi.fn();
        const editor = Object.create(Editor.prototype) as any;
        editor.behaviorPluginManager = {
            getPlugin: vi.fn(() => plugin),
            removePlugin,
        };
        const traverse = vi.spyOn(root, "traverse");
        vi.spyOn(console, "log").mockImplementation(() => {});

        editor.cleanupBehaviorPluginsForObjectAndChildren(root);

        expect(traverse).not.toHaveBeenCalled();
        expect(editor.behaviorPluginManager.getPlugin).toHaveBeenCalledWith("behavior-uuid");
        expect(removePlugin).toHaveBeenCalledWith(plugin);
    });
});
