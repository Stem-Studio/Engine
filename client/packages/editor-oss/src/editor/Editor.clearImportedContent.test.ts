import * as THREE from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import Editor from "./Editor";

afterEach(() => {
    vi.unstubAllGlobals();
});

/**
 * Build a minimal Editor stub. We avoid the real constructor (which spins up
 * the entire engine) and replace just the methods clearImportedContent and
 * runInScriptImportContext call into.
 */
const makeEditor = (scene: THREE.Scene) => {
    // Cast to `any` — intersecting with Editor would collapse to `never`
    // because `_scriptImportDepth` is private on Editor.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = Object.create(Editor.prototype);
    editor._scriptImportDepth = 0;
    // `scene` is a getter that reads through ctx in production. Override it
    // on this instance so we can hand in a plain THREE.Scene.
    Object.defineProperty(editor, "scene", {
        configurable: true,
        get: () => scene,
    });
    editor.engine = {
        call: vi.fn(),
        game: {
            lambdaManager: {
                deregisterObjectFromAll: vi.fn(),
            },
        },
    };
    editor.removeObject = vi.fn((obj: THREE.Object3D) => {
        obj.parent?.remove(obj);
    });
    editor.removeBehaviorFromObject = vi.fn((obj: THREE.Object3D, uuid: string) => {
        const arr = obj.userData.behaviors as Array<{uuid: string}> | undefined;
        if (arr) obj.userData.behaviors = arr.filter(b => b.uuid !== uuid);
        return null;
    });
    return editor;
};

describe("Editor.runInScriptImportContext", () => {
    it("increments and decrements the depth counter around fn", async () => {
        const editor = makeEditor(new THREE.Scene());
        expect(editor._scriptImportDepth).toBe(0);

        let depthInsideFn = -1;
        await editor.runInScriptImportContext(async () => {
            depthInsideFn = editor._scriptImportDepth;
        });

        expect(depthInsideFn).toBe(1);
        expect(editor._scriptImportDepth).toBe(0);
    });

    it("decrements the counter even when fn throws", async () => {
        const editor = makeEditor(new THREE.Scene());

        await expect(
            editor.runInScriptImportContext(async () => {
                throw new Error("script blew up");
            }),
        ).rejects.toThrow("script blew up");

        expect(editor._scriptImportDepth).toBe(0);
    });

    it("nests safely (composite imports)", async () => {
        const editor = makeEditor(new THREE.Scene());
        let outerDepth = -1;
        let innerDepth = -1;

        await editor.runInScriptImportContext(async () => {
            outerDepth = editor._scriptImportDepth;
            await editor.runInScriptImportContext(async () => {
                innerDepth = editor._scriptImportDepth;
            });
            // Still inside the outer context after the inner returns.
            expect(editor._scriptImportDepth).toBe(1);
        });

        expect(outerDepth).toBe(1);
        expect(innerDepth).toBe(2);
        expect(editor._scriptImportDepth).toBe(0);
    });
});

describe("Editor script import preview reveal", () => {
    it("reveals runtime-only import preview meshes progressively", () => {
        const scene = new THREE.Scene();
        const root = new THREE.Group();
        root.userData.isRuntimeOnly = true;
        const first = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
        const second = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
        root.add(first, second);
        scene.add(root);
        const editor = makeEditor(scene);

        const callbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const controller = editor.prepareScriptImportPreviewReveal({batchSize: 1});

        expect(controller?.stats.hiddenObjects).toBe(2);
        expect(first.visible).toBe(false);
        expect(second.visible).toBe(false);

        editor.startScriptImportPreviewReveal();
        callbacks.shift()?.(16);

        expect(first.visible).toBe(true);
        expect(second.visible).toBe(false);

        editor.restoreScriptImportPreviewReveal();
        expect(second.visible).toBe(true);
    });
});

describe("Editor scene traversal", () => {
    const buildTraversalScene = () => {
        const scene = new THREE.Scene();
        scene.name = "scene";
        const a = new THREE.Object3D();
        a.name = "a";
        const a1 = new THREE.Object3D();
        a1.name = "a1";
        const a2 = new THREE.Object3D();
        a2.name = "a2";
        const b = new THREE.Object3D();
        b.name = "b";
        a.add(a1, a2);
        scene.add(a, b);
        return scene;
    };

    it("traverses scene descendants in pre-order without visiting the scene root", () => {
        const editor = makeEditor(buildTraversalScene());
        const visited: string[] = [];

        editor.traverseSceneObjects((object: THREE.Object3D) => {
            visited.push(object.name);
        });

        expect(visited).toEqual(["a", "a1", "a2", "b"]);
    });

    it("reverse traverses descendants post-order without a scene snapshot array", () => {
        const scene = buildTraversalScene();
        const editor = makeEditor(scene);
        const visited: string[] = [];

        editor.reverseTraverseSceneObjects((object: THREE.Object3D) => {
            visited.push(object.name);
            object.removeFromParent();
        });

        expect(visited).toEqual(["b", "a2", "a1", "a"]);
        expect(scene.children).toHaveLength(0);
    });
});

describe("Editor.clearImportedContent", () => {
    const buildScene = () => {
        const scene = new THREE.Scene();

        // Four default scene objects (matches DEFAULT_OBJECT_NAMES).
        const defaultCamera = new THREE.Object3D();
        defaultCamera.name = "DefaultCamera";
        const ambient = new THREE.Object3D();
        ambient.name = "AmbientLight";
        const hemi = new THREE.Object3D();
        hemi.name = "HemisphereLight";
        const directional = new THREE.Object3D();
        directional.name = "Directional Light";
        // Attach a fake behavior + lambda to one default to verify detach.
        directional.userData.behaviors = [{uuid: "b1", id: "dayNightCycle"}];
        directional.userData.lambdaComponents = [{instanceId: "L1"}];

        scene.add(defaultCamera, ambient, hemi, directional);

        // One user-authored object — not imported, not default.
        const manualSphere = new THREE.Object3D();
        manualSphere.name = "ManualSphere";
        scene.add(manualSphere);

        // One imported root with an imported child (so we exercise deepest-first).
        const importedRoot = new THREE.Object3D();
        importedRoot.name = "ImportedRoot";
        importedRoot.userData.isImported = true;
        const importedChild = new THREE.Object3D();
        importedChild.name = "ImportedChild";
        importedChild.userData.isImported = true;
        importedRoot.add(importedChild);
        scene.add(importedRoot);

        return {scene, defaultCamera, ambient, hemi, directional, manualSphere, importedRoot, importedChild};
    };

    it("removes only objects flagged userData.isImported", () => {
        const env = buildScene();
        const editor = makeEditor(env.scene);
        const traverseSpy = vi.spyOn(THREE.Object3D.prototype, "traverse").mockImplementation(() => {
            throw new Error("recursive traverse should not be used for imported cleanup");
        });

        editor.clearImportedContent();

        const removed = editor.removeObject.mock.calls.map((call: unknown[]) => (call[0] as THREE.Object3D).name);
        expect(removed).toContain("ImportedRoot");
        expect(removed).toContain("ImportedChild");
        expect(removed).not.toContain("ManualSphere");
        expect(removed).not.toContain("DefaultCamera");
        expect(traverseSpy).not.toHaveBeenCalled();
    });

    it("removes the deepest imported objects first", () => {
        const env = buildScene();
        const editor = makeEditor(env.scene);

        editor.clearImportedContent();

        const removedOrder = editor.removeObject.mock.calls.map((call: unknown[]) => (call[0] as THREE.Object3D).name);
        // ImportedChild (depth 2) must come before ImportedRoot (depth 1).
        expect(removedOrder.indexOf("ImportedChild")).toBeLessThan(removedOrder.indexOf("ImportedRoot"));
    });

    it("detaches behaviors and lambdas from default objects", () => {
        const env = buildScene();
        const editor = makeEditor(env.scene);

        editor.clearImportedContent();

        // Behavior on the directional light got detached.
        expect(editor.removeBehaviorFromObject).toHaveBeenCalledWith(env.directional, "b1");
        // Lambda manager was asked to deregister all lambdas on the directional light.
        expect(editor.engine.game.lambdaManager.deregisterObjectFromAll).toHaveBeenCalledWith(env.directional);
        // userData.lambdaComponents reset to empty.
        expect(env.directional.userData.lambdaComponents).toEqual([]);
    });

    it("leaves user-authored (manual) objects' attachments alone", () => {
        const env = buildScene();
        env.manualSphere.userData.behaviors = [{uuid: "user-b1", id: "userBehavior"}];
        const editor = makeEditor(env.scene);

        editor.clearImportedContent();

        expect(editor.removeBehaviorFromObject).not.toHaveBeenCalledWith(env.manualSphere, "user-b1");
        expect(env.manualSphere.userData.behaviors).toEqual([{uuid: "user-b1", id: "userBehavior"}]);
    });

    it("fires sceneGraphChanged once at the end", () => {
        const env = buildScene();
        const editor = makeEditor(env.scene);

        editor.clearImportedContent();

        const sceneGraphChangedCalls = editor.engine.call.mock.calls.filter(
            (call: unknown[]) => call[0] === "sceneGraphChanged",
        );
        expect(sceneGraphChangedCalls.length).toBe(1);
    });

    it("survives a missing lambdaManager (engine in editor-only state)", () => {
        const env = buildScene();
        const editor = makeEditor(env.scene);
        editor.engine.game.lambdaManager = null;

        expect(() => editor.clearImportedContent()).not.toThrow();
        // Behavior detach still ran.
        expect(editor.removeBehaviorFromObject).toHaveBeenCalledWith(env.directional, "b1");
    });
});
