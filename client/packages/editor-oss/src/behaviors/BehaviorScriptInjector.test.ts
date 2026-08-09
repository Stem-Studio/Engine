import {Camera, Object3D, PerspectiveCamera} from "three";
import * as UIKit from "@ni2khanna/uikit";
import {afterEach, describe, expect, it, vi} from "vitest";

import global from "../global";
import {BEHAVIOR_LIFECYCLE_HOOK_QUERY, type BehaviorOptions} from "./Behavior";
import BehaviorScriptInjector from "./BehaviorScriptInjector";
import {
    EDITOR_PREVIEW_ADOPTED_KEY,
    EDITOR_PREVIEW_BEHAVIOR_UUID_KEY,
    markEditorPreviewRoot,
} from "./editorPreviewVisuals";

const createBehaviorOptions = (): BehaviorOptions =>
    ({
        gameObject: {},
        erth: {},
    }) as BehaviorOptions;

const createFullscreenRenderer = (width: number, height: number) => ({
    domElement: {
        clientWidth: width,
        clientHeight: height,
    },
    getSize(target: {set: (width: number, height: number) => unknown}) {
        return target.set(width, height);
    },
});

describe("BehaviorScriptInjector runtime THREE endowment", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        global.app = null;
        delete (globalThis as {app?: unknown}).app;
    });

    it("exposes core Three classes and node materials without importing three/webgpu as the namespace", () => {
        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-three-test",
            `
                this.createdObject = new THREE.Object3D();
                this.nodeMaterial = new THREE.MeshPhysicalNodeMaterial({ reflectivity: 0.5 });
                this.standardNodeMaterial = new THREE.MeshStandardNodeMaterial();
                this.basicNodeMaterial = new THREE.MeshBasicNodeMaterial();
                this.pointsNodeMaterial = new THREE.PointsNodeMaterial();
                this.lineNodeMaterial = new THREE.LineBasicNodeMaterial();
                this.spriteNodeMaterial = new THREE.SpriteNodeMaterial();
            `,
        );

        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;

        expect(behavior.createdObject).toBeInstanceOf(Object3D);
        expect(behavior.nodeMaterial.type).toBe("MeshPhysicalNodeMaterial");
        expect(behavior.standardNodeMaterial.type).toBe("MeshStandardNodeMaterial");
        expect(behavior.basicNodeMaterial.type).toBe("MeshBasicNodeMaterial");
        expect(behavior.pointsNodeMaterial.type).toBe("PointsNodeMaterial");
        expect(behavior.lineNodeMaterial.type).toBe("LineBasicNodeMaterial");
        expect(behavior.spriteNodeMaterial.type).toBe("SpriteNodeMaterial");
    });

    it("disposes scoped browser resources when a direct behavior omits dispose", () => {
        const diagnostics = (globalThis as typeof globalThis & {
            __STEM_SCRIPT_RESOURCE_DIAGNOSTICS__?: () => {scopes: number; intervals: number};
        }).__STEM_SCRIPT_RESOURCE_DIAGNOSTICS__;
        expect(diagnostics).toBeTypeOf("function");
        const before = diagnostics!();

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-resource-scope-fallback-dispose-test",
            `
                this.intervalId = setInterval(() => {}, 60_000);
            `,
        );
        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;

        expect(diagnostics!().intervals).toBeGreaterThan(before.intervals);
        behavior.dispose();
        expect(diagnostics!()).toEqual(before);
    });

    it("exposes TSL through THREE.TSL and a top-level TSL alias for legacy visual scripts", () => {
        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-tsl-test",
            `
                this.fromThreeNamespace = THREE.TSL.uniform(1.25);
                this.fromAlias = TSL.uniform(2.5);
            `,
        );

        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;

        expect(behavior.fromThreeNamespace.value).toBe(1.25);
        expect(behavior.fromAlias.value).toBe(2.5);
    });

    it("returns generated script init and onStart promises so play startup can await them", async () => {
        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-awaited-startup-hooks-test",
            `
                this.init = function(game) {
                    this.initState = "started";
                    this.gameName = game.name;
                    return Promise.resolve().then(() => {
                        this.initState = "finished";
                    });
                };
                this.onStart = function() {
                    this.startState = "started";
                    return {
                        then: (resolve) => Promise.resolve().then(() => {
                            this.startState = "finished";
                            resolve();
                        })
                    };
                };
            `,
        );

        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;

        const initResult = behavior.init({name: "test-game"} as any);
        expect(typeof initResult?.then).toBe("function");
        expect(behavior.initState).toBe("started");
        await initResult;
        expect(behavior.initState).toBe("finished");
        expect(behavior.gameName).toBe("test-game");

        const startResult = behavior.onStart();
        expect(typeof startResult?.then).toBe("function");
        expect(behavior.startState).toBe("started");
        await startResult;
        expect(behavior.startState).toBe("finished");
    });

    it("returns generated script lifecycle promises in compartment mode", async () => {
        global.app = {
            editor: {
                scene: {
                    userData: {
                        compartmentsEnabled: true,
                    },
                },
            },
        } as any;

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-awaited-compartment-hooks-test",
            `
                this.init = function() {
                    this.initState = "started";
                    return Promise.resolve().then(() => {
                        this.initState = "finished";
                    });
                };
                this.onStart = function() {
                    this.startState = "started";
                    return Promise.resolve().then(() => {
                        this.startState = "finished";
                    });
                };
            `,
        );

        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;

        const initResult = behavior.init({} as any);
        expect(typeof initResult?.then).toBe("function");
        expect(behavior.script.initState).toBe("started");
        await initResult;
        expect(behavior.script.initState).toBe("finished");

        const startResult = behavior.onStart();
        expect(typeof startResult?.then).toBe("function");
        expect(behavior.script.startState).toBe("started");
        await startResult;
        expect(behavior.script.startState).toBe("finished");
    });

    it("exposes the play-start yield hook to generated script behaviors", async () => {
        const yieldToFrame = vi.fn(async () => {});
        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-yield-hook-test",
            `
                this.init = function() {
                    this.initState = "started";
                    return this.yield().then(() => {
                        this.initState = "yielded";
                    });
                };
            `,
        );

        const behavior = new BehaviorClass(new Object3D(), "test.behavior", {
            ...createBehaviorOptions(),
            yieldToFrame,
        }) as any;

        const result = behavior.init({} as any);
        expect(typeof result?.then).toBe("function");
        expect(behavior.initState).toBe("started");
        await result;

        expect(yieldToFrame).toHaveBeenCalledTimes(1);
        expect(behavior.initState).toBe("yielded");
    });

    it("exposes the play-start yield hook in compartment-mode script behaviors", async () => {
        global.app = {
            editor: {
                scene: {
                    userData: {
                        compartmentsEnabled: true,
                    },
                },
            },
        } as any;
        const yieldToFrame = vi.fn(async () => {});
        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-compartment-yield-hook-test",
            `
                this.init = function() {
                    this.initState = "started";
                    return this.yield().then(() => {
                        this.initState = "yielded";
                    });
                };
            `,
        );

        const behavior = new BehaviorClass(new Object3D(), "test.behavior", {
            ...createBehaviorOptions(),
            yieldToFrame,
        }) as any;

        const result = behavior.init({} as any);
        expect(typeof result?.then).toBe("function");
        expect(behavior.script.initState).toBe("started");
        await result;

        expect(yieldToFrame).toHaveBeenCalledTimes(1);
        expect(behavior.script.initState).toBe("yielded");
    });

    it("does not wrap inherited direct-script lifecycle hooks that were not authored", () => {
        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-direct-no-authored-reset-test",
            `
                this.value = 1;
            `,
        );

        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;

        expect(typeof behavior.onReset).toBe("function");
        expect(typeof behavior.update).toBe("function");
        expect(behavior[BEHAVIOR_LIFECYCLE_HOOK_QUERY]("onReset")).toBe(false);
        expect(behavior[BEHAVIOR_LIFECYCLE_HOOK_QUERY]("update")).toBe(false);
        expect(() => behavior.onReset()).not.toThrow();
    });

    it("keeps authored direct-script lifecycle hooks callable", () => {
        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-direct-authored-reset-test",
            `
                this.resetCount = 0;
                this.onReset = function() {
                    this.resetCount++;
                };
            `,
        );

        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;

        expect(Object.prototype.hasOwnProperty.call(behavior, "onReset")).toBe(true);
        expect(behavior[BEHAVIOR_LIFECYCLE_HOOK_QUERY]("onReset")).toBe(true);
        behavior.onReset();
        expect(behavior.resetCount).toBe(1);
    });

    it("skips compartment reset work when the script did not author onReset", () => {
        global.app = {
            editor: {
                scene: {
                    userData: {
                        compartmentsEnabled: true,
                    },
                },
            },
        } as any;

        const target = new Object3D();
        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-compartment-no-authored-reset-test",
            `
                this.value = 1;
            `,
        );

        const behavior = new BehaviorClass(target, "test.behavior", createBehaviorOptions()) as any;
        behavior.init({} as any);
        behavior.script.target = undefined;

        expect(behavior[BEHAVIOR_LIFECYCLE_HOOK_QUERY]("onReset")).toBe(false);
        expect(() => behavior.onReset()).not.toThrow();
        expect(behavior.script.target).toBeUndefined();
    });

    it("reuses parsed classes for identical script inputs without sharing instance state", () => {
        const script = `
            this.instanceValue = (this.instanceValue || 0) + 1;
        `;
        const firstClass = new BehaviorScriptInjector().parse("runtime-cache-test", script);
        const secondClass = new BehaviorScriptInjector().parse("runtime-cache-test", script);

        const firstBehavior = new firstClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;
        const secondBehavior = new secondClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;

        expect(secondClass).toBe(firstClass);
        expect(firstBehavior.instanceValue).toBe(1);
        expect(secondBehavior.instanceValue).toBe(1);
    });

    it("reuses parsed classes when only the display name differs", () => {
        const script = `
            this.value = 1;
        `;
        const editorClass = new BehaviorScriptInjector().parse("runtime-cache-display-name-test", script);
        const playClass = new BehaviorScriptInjector().parse("runtime-cache-display-name-test", script, "Display Name");

        expect(playClass).toBe(editorClass);
    });

    it("does not reuse parsed classes across different import revisions", () => {
        const script = `
            @import "hud-helper" as helper
            this.value = helper.getValue();
        `;
        const context = {
            logicalIdToAssetId: {"hud-helper": "hud-helper-asset"},
            assetIdToRevisionId: {"hud-helper-asset": "hud-helper-rev-1"},
        };

        const rev1Class = new BehaviorScriptInjector().parse(
            "runtime-cache-import-test",
            script,
            undefined,
            {
                context,
                importRevisionMap: {
                    "hud-helper-asset:hud-helper-rev-1": {
                        assetId: "hud-helper-asset",
                        revisionId: "hud-helper-rev-1",
                        code: "function getValue() { return 1; }",
                    },
                },
            },
        );
        const rev2Class = new BehaviorScriptInjector().parse(
            "runtime-cache-import-test",
            script,
            undefined,
            {
                context: {
                    ...context,
                    assetIdToRevisionId: {"hud-helper-asset": "hud-helper-rev-2"},
                },
                importRevisionMap: {
                    "hud-helper-asset:hud-helper-rev-2": {
                        assetId: "hud-helper-asset",
                        revisionId: "hud-helper-rev-2",
                        code: "function getValue() { return 2; }",
                    },
                },
            },
        );

        expect(rev2Class).not.toBe(rev1Class);
    });

    it("adopts matching editor preview visual roots for the first generated _buildVisuals call", () => {
        const target = new Object3D();
        const previewRoot = new Object3D();
        previewRoot.name = "editor-preview-root";
        previewRoot.userData.isRuntimeOnly = true;
        markEditorPreviewRoot(previewRoot, {uuid: "behavior-uuid", id: "editor-side-behavior-id"} as any);
        target.add(previewRoot);

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-preview-adoption-test",
            `
                this._buildCount = 0;
                this._buildVisuals = function(parent) {
                    this._buildCount++;
                    const root = new THREE.Group();
                    root.name = "runtime-built-root";
                    root.userData.isRuntimeOnly = true;
                    parent.add(root);
                    this._root = root;
                };
                this._teardownVisuals = function() {
                    if (this._root && this._root.parent) {
                        this._root.parent.remove(this._root);
                    }
                    this._root = null;
                };
                this.init = function() {
                    this._buildVisuals(this.target);
                };
                this.dispose = function() {
                    this._teardownVisuals();
                };
            `,
        );

        const behavior = new BehaviorClass(target, "test.behavior", {
            ...createBehaviorOptions(),
            uuid: "behavior-uuid",
        }) as any;

        behavior.init({} as any);

        expect(behavior._buildCount).toBe(0);
        expect(behavior._root).toBe(previewRoot);
        expect(previewRoot.userData[EDITOR_PREVIEW_ADOPTED_KEY]).toBe(true);
        expect(target.children).toEqual([previewRoot]);

        behavior._buildVisuals(target);

        expect(behavior._buildCount).toBe(1);
        expect(target.children.map(child => child.name)).toEqual(["editor-preview-root", "runtime-built-root"]);

        behavior.dispose();

        expect(previewRoot.parent).toBe(target);
    });

    it("delegates teardown for adopted-looking roots that are not marked editor preview roots", () => {
        const target = new Object3D();
        const nonPreviewRoot = new Object3D();
        nonPreviewRoot.name = "adopted-looking-runtime-root";
        nonPreviewRoot.userData.isRuntimeOnly = true;
        nonPreviewRoot.userData[EDITOR_PREVIEW_ADOPTED_KEY] = true;
        nonPreviewRoot.userData[EDITOR_PREVIEW_BEHAVIOR_UUID_KEY] = "behavior-uuid";
        target.add(nonPreviewRoot);

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-preview-teardown-strict-root-test",
            `
                this._buildVisuals = function() {};
                this._teardownVisuals = function() {
                    this._teardownVisualsCalls = (this._teardownVisualsCalls || 0) + 1;
                    if (this._root && this._root.parent) {
                        this._root.parent.remove(this._root);
                    }
                };
                this.dispose = function() {
                    this._teardownVisuals();
                };
            `,
        );

        const behavior = new BehaviorClass(target, "test.behavior", {
            ...createBehaviorOptions(),
            uuid: "behavior-uuid",
        }) as any;
        behavior._root = nonPreviewRoot;

        behavior.dispose();

        expect(behavior._teardownVisualsCalls).toBe(1);
        expect(nonPreviewRoot.parent).toBeNull();
    });

    it("preserves adopted editor preview roots when generated editor dispose calls owned-root teardown", () => {
        const target = new Object3D();
        const previewRoot = new Object3D();
        previewRoot.name = "editor-preview-root";
        previewRoot.userData.isRuntimeOnly = true;
        markEditorPreviewRoot(previewRoot, {uuid: "behavior-uuid", id: "editor-side-behavior-id"} as any);
        previewRoot.userData[EDITOR_PREVIEW_ADOPTED_KEY] = true;
        target.add(previewRoot);

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-preview-owned-root-preservation-test",
            `
                this._disposeOwnedRoot = function(root) {
                    this._disposeOwnedRootCalls = (this._disposeOwnedRootCalls || 0) + 1;
                    if (root && root.parent) {
                        root.parent.remove(root);
                    }
                };
                this._adoptEditorPreviewRoot = true;
                this.onEditorDispose = function() {
                    this._disposeOwnedRoot(this._editorPreviewRoot, false);
                    this._editorPreviewRoot = null;
                };
            `,
        );

        const behavior = new BehaviorClass(target, "test.behavior", {
            ...createBehaviorOptions(),
            uuid: "behavior-uuid",
        }) as any;
        behavior._editorPreviewRoot = previewRoot;

        behavior.onEditorDispose();

        expect(behavior._disposeOwnedRootCalls).toBeUndefined();
        expect(previewRoot.parent).toBe(target);
    });

    it("disposes adopted-looking preview roots without an adoption contract", () => {
        const target = new Object3D();
        const previewRoot = new Object3D();
        previewRoot.name = "editor-preview-root";
        previewRoot.userData.isRuntimeOnly = true;
        markEditorPreviewRoot(previewRoot, {uuid: "behavior-uuid", id: "editor-side-behavior-id"} as any);
        previewRoot.userData[EDITOR_PREVIEW_ADOPTED_KEY] = true;
        target.add(previewRoot);

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-preview-owned-root-no-contract-disposal-test",
            `
                this._buildTrack = function() {};
                this._disposeOwnedRoot = function(root) {
                    this._disposeOwnedRootCalls = (this._disposeOwnedRootCalls || 0) + 1;
                    if (root && root.parent) {
                        root.parent.remove(root);
                    }
                };
                this.onEditorDispose = function() {
                    this._disposeOwnedRoot(this._editorPreviewRoot, false);
                    this._editorPreviewRoot = null;
                };
            `,
        );

        const behavior = new BehaviorClass(target, "test.behavior", {
            ...createBehaviorOptions(),
            uuid: "behavior-uuid",
        }) as any;
        behavior._editorPreviewRoot = previewRoot;

        behavior.onEditorDispose();

        expect(behavior._disposeOwnedRootCalls).toBe(1);
        expect(previewRoot.parent).toBeNull();
    });

    it("assigns declarative editor preview adoption state before onStart", () => {
        const target = new Object3D();
        const previewRoot = new Object3D();
        previewRoot.name = "editor-preview-root";
        previewRoot.userData.isRuntimeOnly = true;
        const previewVisual = new Object3D();
        previewVisual.name = "preview-visual";
        previewRoot.add(previewVisual);
        markEditorPreviewRoot(previewRoot, {uuid: "behavior-uuid", id: "editor-side-behavior-id"} as any);
        previewRoot.userData[EDITOR_PREVIEW_ADOPTED_KEY] = true;
        target.add(previewRoot);

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-explicit-preview-adoption-test",
            `
                this._adoptEditorPreviewRoot = true;
                this.onStart = function() {
                    this._runtimeRoot = this._adoptedEditorPreviewRoot;
                    this._adoptionContext = this._adoptedEditorPreviewContext;
                    if (!this._runtimeRoot) {
                        this.rebuilt = true;
                        this._runtimeRoot = new THREE.Group();
                    }
                    this.runtimeStateInitialized = true;
                };
            `,
        );

        const behavior = new BehaviorClass(target, "test.behavior", {
            ...createBehaviorOptions(),
            uuid: "behavior-uuid",
        }) as any;

        behavior.onStart();

        expect(behavior._runtimeRoot).toBe(previewRoot);
        expect(behavior.rebuilt).toBeUndefined();
        expect(behavior.runtimeStateInitialized).toBe(true);
        expect(behavior._adoptionContext).toMatchObject({
            behaviorId: "test.behavior",
            behaviorUuid: "behavior-uuid",
            parent: target,
        });
        expect(previewRoot.userData[EDITOR_PREVIEW_ADOPTED_KEY]).toBe(true);
    });

    it("does not assign declarative preview adoption for roots owned by another behavior", () => {
        const target = new Object3D();
        const previewRoot = new Object3D();
        previewRoot.name = "editor-preview-root";
        previewRoot.userData.isRuntimeOnly = true;
        markEditorPreviewRoot(previewRoot, {uuid: "other-behavior-uuid", id: "editor-side-behavior-id"} as any);
        previewRoot.userData[EDITOR_PREVIEW_ADOPTED_KEY] = true;
        target.add(previewRoot);

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-explicit-preview-adoption-fail-closed-test",
            `
                this._adoptEditorPreviewRoot = true;
                this.onStart = function() {
                    this._runtimeRoot = this._adoptedEditorPreviewRoot;
                    if (!this._runtimeRoot) {
                        this.rebuilt = true;
                        this._runtimeRoot = new THREE.Group();
                    }
                };
            `,
        );

        const behavior = new BehaviorClass(target, "test.behavior", {
            ...createBehaviorOptions(),
            uuid: "behavior-uuid",
        }) as any;

        behavior.onStart();

        expect(behavior.rebuilt).toBe(true);
        expect(behavior._runtimeRoot).not.toBe(previewRoot);
        expect(previewRoot.parent).toBe(target);
    });

    it("ignores function-valued preview adoption hooks without invoking them", () => {
        const target = new Object3D();
        const previewRoot = new Object3D();
        previewRoot.name = "editor-preview-root";
        previewRoot.userData.isRuntimeOnly = true;
        markEditorPreviewRoot(previewRoot, {uuid: "behavior-uuid", id: "editor-side-behavior-id"} as any);
        previewRoot.userData[EDITOR_PREVIEW_ADOPTED_KEY] = true;
        target.add(previewRoot);

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-explicit-preview-adoption-function-ignored-test",
            `
                this._adoptEditorPreviewRoot = function() {
                    this.adoptionFunctionInvoked = true;
                    this._runtimeRoot = this.target.children[0];
                };
                this.onStart = function() {
                    this._runtimeRoot = this._adoptedEditorPreviewRoot;
                    if (!this._runtimeRoot) {
                        this.rebuilt = true;
                        this._runtimeRoot = new THREE.Group();
                    }
                };
            `,
        );

        const behavior = new BehaviorClass(target, "test.behavior", {
            ...createBehaviorOptions(),
            uuid: "behavior-uuid",
        }) as any;

        behavior.onStart();

        expect(behavior.adoptionFunctionInvoked).toBeUndefined();
        expect(behavior.rebuilt).toBe(true);
        expect(behavior._runtimeRoot).not.toBe(previewRoot);
        expect(behavior._adoptedEditorPreviewRoot).toBeNull();
    });

    it("clears stale declarative adopted roots before onStart rebuilds", () => {
        const target = new Object3D();
        const previewRoot = new Object3D();
        previewRoot.name = "editor-preview-root";
        previewRoot.userData.isRuntimeOnly = true;
        markEditorPreviewRoot(previewRoot, {uuid: "other-behavior-uuid", id: "editor-side-behavior-id"} as any);
        previewRoot.userData[EDITOR_PREVIEW_ADOPTED_KEY] = true;
        target.add(previewRoot);
        const staleRoot = new Object3D();

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-explicit-preview-adoption-stale-root-cleared-test",
            `
                this._adoptEditorPreviewRoot = true;
                this.onStart = function() {
                    this._runtimeRoot = this._adoptedEditorPreviewRoot;
                    if (!this._runtimeRoot) {
                        this.rebuilt = true;
                        this._runtimeRoot = new THREE.Group();
                    }
                };
            `,
        );

        const behavior = new BehaviorClass(target, "test.behavior", {
            ...createBehaviorOptions(),
            uuid: "behavior-uuid",
        }) as any;
        behavior._adoptedEditorPreviewRoot = staleRoot;

        behavior.onStart();

        expect(behavior.rebuilt).toBe(true);
        expect(behavior._runtimeRoot).not.toBe(previewRoot);
        expect(behavior._runtimeRoot).not.toBe(staleRoot);
        expect(behavior._adoptedEditorPreviewRoot).toBeNull();
    });

    it("marks generated visual roots as runtime-only when scripts omit the flag", () => {
        const target = new Object3D();

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-generated-visual-root-flag-test",
            `
                this._buildVisuals = function(parent) {
                    const root = new THREE.Group();
                    root.name = "runtime-built-root";
                    const mesh = new THREE.Mesh(
                        new THREE.BoxGeometry(1, 1, 1),
                        new THREE.MeshBasicMaterial()
                    );
                    root.add(mesh);
                    parent.add(root);
                    this._root = root;
                    return root;
                };
                this.init = function() {
                    this._buildVisuals(this.target);
                };
            `,
        );

        const behavior = new BehaviorClass(target, "test.behavior", createBehaviorOptions()) as any;

        behavior.init({} as any);

        expect(behavior._root.userData.isRuntimeOnly).toBe(true);
        expect(target.children[0]?.userData.isRuntimeOnly).toBe(true);
    });

    it("exposes TSL in compartment mode", () => {
        global.app = {
            editor: {
                scene: {
                    userData: {
                        compartmentsEnabled: true,
                    },
                },
            },
        } as any;

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-tsl-compartment-test",
            `
                this.init = function() {
                    this.fromThreeNamespace = THREE.TSL.uniform(3.75);
                    this.fromAlias = TSL.uniform(4.5);
                };
            `,
        );

        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;
        behavior.init({});

        expect(behavior.script.fromThreeNamespace.value).toBe(3.75);
        expect(behavior.script.fromAlias.value).toBe(4.5);
    });

    it("parents script-created UIKit fullscreen roots to the runtime UI camera", () => {
        const uiCamera = new PerspectiveCamera();
        const ensureUICamera = vi.fn(() => uiCamera);
        global.app = {
            editor: {
                scene: {
                    userData: {},
                },
            },
            game: {
                ensureUICamera,
            },
        } as any;

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-uikit-fullscreen-test",
            `
                this.fullscreen = new UIKit.Fullscreen({
                    getSize(target) {
                        return target.set(800, 600);
                    }
                }, {});
            `,
        );

        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;

        expect(ensureUICamera).toHaveBeenCalledTimes(1);
        expect(behavior.fullscreen.parent).toBe(uiCamera);
        expect(() => behavior.fullscreen.update(800, 600)).not.toThrow();
    });

    it("exposes a direct Fullscreen constructor with runtime camera parenting", () => {
        const uiCamera = new PerspectiveCamera();
        const ensureUICamera = vi.fn(() => uiCamera);
        global.app = {
            editor: {
                scene: {
                    userData: {},
                },
            },
            game: {
                ensureUICamera,
            },
        } as any;

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-direct-fullscreen-test",
            `
                this.fullscreen = new Fullscreen({
                    getSize(target) {
                        return target.set(800, 600);
                    }
                }, {});
            `,
        );

        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;

        expect(ensureUICamera).toHaveBeenCalledTimes(1);
        expect(behavior.fullscreen.parent).toBe(uiCamera);
        expect(() => behavior.fullscreen.update(800, 600)).not.toThrow();
    });

    it("normalizes runtime Fullscreen root 100% sizing without mutating caller properties", () => {
        const uiCamera = new PerspectiveCamera(60, 1280 / 720);
        const ensureUICamera = vi.fn(() => uiCamera);
        global.app = {
            editor: {
                scene: {
                    userData: {},
                },
            },
            game: {
                ensureUICamera,
            },
        } as any;

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-uikit-fullscreen-root-full-percent-normalize-test",
            `
                const renderer = {
                    domElement: { clientWidth: 1280, clientHeight: 720 },
                    getSize(target) {
                        return target.set(1280, 720);
                    }
                };
                const props = {
                    width: "100%",
                    height: " 100.0% ",
                    positionType: "absolute",
                    top: 12,
                    customValue: "kept"
                };
                this.props = props;
                this.fullscreen = new UIKit.Fullscreen(renderer, props);
                this.dispose = function() {
                    this.fullscreen.dispose();
                    this.disposed = true;
                };
            `,
        );

        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;
        const disposeSpy = vi.spyOn(behavior.fullscreen, "dispose");

        expect(behavior.props).toEqual({
            width: "100%",
            height: " 100.0% ",
            positionType: "absolute",
            top: 12,
            customValue: "kept",
        });
        expect(behavior.fullscreen.inputProperties).not.toBe(behavior.props);
        expect(Object.prototype.hasOwnProperty.call(behavior.fullscreen.inputProperties, "width")).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(behavior.fullscreen.inputProperties, "height")).toBe(false);
        expect(behavior.fullscreen.inputProperties.positionType).toBe("absolute");
        expect(behavior.fullscreen.inputProperties.top).toBe(12);
        expect(behavior.fullscreen.inputProperties.customValue).toBe("kept");

        expect(ensureUICamera).toHaveBeenCalledTimes(1);
        expect(behavior.fullscreen.parent).toBe(uiCamera);
        expect(() => behavior.fullscreen.update(1280, 720)).not.toThrow();
        expect(() => behavior.fullscreen.update(1 / 60)).not.toThrow();

        expect(behavior.fullscreen.size.value[0]).toBeCloseTo(1280, 5);
        expect(behavior.fullscreen.size.value[1]).toBeCloseTo(720, 5);

        expect(() => behavior.dispose()).not.toThrow();
        expect(disposeSpy).toHaveBeenCalledTimes(1);
        expect(behavior.disposed).toBe(true);
    });

    it("removes only runtime Fullscreen root dimensions that are exactly full percentages", () => {
        const uiCamera = new PerspectiveCamera(60, 1280 / 720);
        global.app = {
            editor: {
                scene: {
                    userData: {},
                },
            },
            game: {
                ensureUICamera: vi.fn(() => uiCamera),
            },
        } as any;

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-uikit-fullscreen-root-percent-scope-test",
            `
                const renderer = {
                    domElement: { clientWidth: 1280, clientHeight: 720 },
                    getSize(target) {
                        return target.set(1280, 720);
                    }
                };
                this.mixedProps = { width: "100%", height: "50%" };
                this.nearFullProps = { width: "100.0001%", height: "99.999%" };
                this.numericProps = { width: 100, height: 720 };
                this.fullscreenMixed = new UIKit.Fullscreen(renderer, this.mixedProps);
                this.fullscreenNearFull = new UIKit.Fullscreen(renderer, this.nearFullProps);
                this.fullscreenNumeric = new UIKit.Fullscreen(renderer, this.numericProps);
            `,
        );

        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;

        expect(behavior.mixedProps).toEqual({width: "100%", height: "50%"});
        expect(Object.prototype.hasOwnProperty.call(behavior.fullscreenMixed.inputProperties, "width")).toBe(false);
        expect(behavior.fullscreenMixed.inputProperties.height).toBe("50%");

        expect(behavior.fullscreenNearFull.inputProperties).toBe(behavior.nearFullProps);
        expect(behavior.fullscreenNearFull.inputProperties.width).toBe("100.0001%");
        expect(behavior.fullscreenNearFull.inputProperties.height).toBe("99.999%");

        expect(behavior.fullscreenNumeric.inputProperties).toBe(behavior.numericProps);
        expect(behavior.fullscreenNumeric.inputProperties.width).toBe(100);
        expect(behavior.fullscreenNumeric.inputProperties.height).toBe(720);
    });

    it("reattaches script-created UIKit fullscreen roots moved under non-camera parents", () => {
        const uiCamera = new PerspectiveCamera();
        global.app = {
            editor: {
                scene: {
                    userData: {},
                },
            },
            game: {
                ensureUICamera: vi.fn(() => uiCamera),
            },
        } as any;

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-uikit-fullscreen-reattach-test",
            `
                this.fullscreen = new UIKit.Fullscreen({
                    getSize(target) {
                        return target.set(800, 600);
                    }
                }, {});
            `,
        );

        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;
        const nonCameraParent = new Object3D();
        nonCameraParent.add(behavior.fullscreen);

        expect(behavior.fullscreen.parent).toBe(nonCameraParent);
        expect(() => behavior.fullscreen.update(800, 600)).not.toThrow();
        expect(behavior.fullscreen.parent).toBe(uiCamera);
    });

    it("does not globally patch raw UIKit fullscreen update parenting", () => {
        const uiCamera = new PerspectiveCamera();
        global.app = {
            editor: {
                scene: {
                    userData: {},
                },
            },
            game: {
                ensureUICamera: vi.fn(() => uiCamera),
            },
        } as any;

        const fullscreen = new (UIKit.Fullscreen as any)({
            getSize(target: {set: (width: number, height: number) => unknown}) {
                return target.set(800, 600);
            },
        }, {});
        const nonCameraParent = new Object3D();
        nonCameraParent.add(fullscreen);

        expect(() => fullscreen.update(800, 600)).not.toThrow();
        expect(fullscreen.parent).toBe(nonCameraParent);
    });

    it("keeps raw UIKit fullscreen root 100% sizing behavior unchanged", () => {
        const uiCamera = new PerspectiveCamera(60, 1280 / 720);
        const props = {
            width: "100%",
            height: "100%",
            positionType: "absolute",
        };
        const fullscreen = new (UIKit.Fullscreen as any)(createFullscreenRenderer(1280, 720), props);
        uiCamera.add(fullscreen);

        expect(() => fullscreen.update(1 / 60)).not.toThrow();
        expect(() => fullscreen.update(1 / 60)).not.toThrow();

        expect(fullscreen.inputProperties).toBe(props);
        expect(props).toEqual({
            width: "100%",
            height: "100%",
            positionType: "absolute",
        });
        expect(fullscreen.size.value[0]).toBe(0);
        expect(fullscreen.size.value[1]).toBe(0);
    });

    it("parents UIKit fullscreen roots created inside imported helper scripts", () => {
        const uiCamera = new PerspectiveCamera();
        const ensureUICamera = vi.fn(() => uiCamera);
        global.app = {
            editor: {
                scene: {
                    userData: {},
                },
            },
            game: {
                ensureUICamera,
            },
        } as any;

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-uikit-fullscreen-import-test",
            `
                @import "hud-helper" as hud
                this.fullscreen = hud.makeFullscreen({
                    getSize(target) {
                        return target.set(800, 600);
                    }
                });
            `,
            undefined,
            {
                context: {
                    logicalIdToAssetId: {"hud-helper": "hud-helper-asset"},
                    assetIdToRevisionId: {"hud-helper-asset": "hud-helper-rev"},
                },
                importRevisionMap: {
                    "hud-helper-asset:hud-helper-rev": {
                        assetId: "hud-helper-asset",
                        revisionId: "hud-helper-rev",
                        code: `
                            function makeFullscreen(renderer) {
                                return new UIKit.Fullscreen(renderer, {});
                            }
                        `,
                    },
                },
            },
        );

        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;

        expect(ensureUICamera).toHaveBeenCalledTimes(1);
        expect(behavior.fullscreen.parent).toBe(uiCamera);
        expect(() => behavior.fullscreen.update(1 / 60)).not.toThrow();
    });

    it("defers script-created UIKit fullscreen updates until a runtime UI camera exists", () => {
        global.app = {
            editor: {
                scene: {
                    userData: {},
                },
            },
            game: {
                ensureUICamera: vi.fn(() => {
                    throw new Error("ui camera not ready");
                }),
            },
        } as any;

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-uikit-fullscreen-deferred-test",
            `
                this.fullscreen = new UIKit.Fullscreen({
                    getSize(target) {
                        return target.set(800, 600);
                    }
                }, {});
            `,
        );

        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;

        expect(() => behavior.fullscreen.update(1 / 60)).not.toThrow();
        expect(behavior.fullscreen.parent).toBeNull();
    });

    it("auto-updates discovered UIKit fullscreen roots once per behavior update frame", () => {
        const uiCamera = new PerspectiveCamera();
        global.app = {
            editor: {
                scene: {
                    userData: {},
                },
            },
            game: {
                ensureUICamera: vi.fn(() => uiCamera),
            },
        } as any;

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-uikit-fullscreen-auto-update-test",
            `
                this.fullscreen = new UIKit.Fullscreen({
                    domElement: { clientWidth: 800, clientHeight: 600 },
                    getSize(target) {
                        return target.set(800, 600);
                    }
                }, {});
                this.fullscreen.add(new UIKit.Text({
                    text: "Speed",
                    positionType: "absolute",
                    top: 12,
                    right: 16
                }));
                const originalUpdate = this.fullscreen.update;
                this.fullscreen.updateCount = 0;
                this.fullscreen.update = function(delta) {
                    this.updateCount++;
                    this.lastDelta = delta;
                    return originalUpdate.call(this, delta);
                };
                this.update = function(delta) {
                    UIKitPointerEvents.update(delta);
                };
            `,
        );
        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;

        behavior.update(0.125);

        expect(behavior.fullscreen.parent).toBe(uiCamera);
        expect(behavior.fullscreen.updateCount).toBe(1);
        expect(behavior.fullscreen.lastDelta).toBe(0.125);
    });

    it("does not double-update fullscreen roots already updated by the script hook", () => {
        const uiCamera = new PerspectiveCamera();
        global.app = {
            editor: {
                scene: {
                    userData: {},
                },
            },
            game: {
                ensureUICamera: vi.fn(() => uiCamera),
            },
        } as any;

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-uikit-fullscreen-no-double-update-test",
            `
                this.fullscreen = new UIKit.Fullscreen({
                    domElement: { clientWidth: 800, clientHeight: 600 },
                    getSize(target) {
                        return target.set(800, 600);
                    }
                }, {});
                const originalUpdate = this.fullscreen.update;
                this.fullscreen.updateCount = 0;
                this.fullscreen.update = function(delta) {
                    this.updateCount++;
                    this.lastDelta = delta;
                    return originalUpdate.call(this, delta);
                };
                this.update = function(delta) {
                    this.fullscreen.update(delta);
                };
            `,
        );
        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;

        behavior.update(1 / 30);

        expect(behavior.fullscreen.updateCount).toBe(1);
        expect(behavior.fullscreen.lastDelta).toBe(1 / 30);
    });

    it("repairs fullscreen camera parenting before behavior-frame auto update", () => {
        const uiCamera = new PerspectiveCamera();
        global.app = {
            editor: {
                scene: {
                    userData: {},
                },
            },
            game: {
                ensureUICamera: vi.fn(() => uiCamera),
            },
        } as any;

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-uikit-fullscreen-auto-camera-repair-test",
            `
                this.fullscreen = new UIKit.Fullscreen({
                    domElement: { clientWidth: 800, clientHeight: 600 },
                    getSize(target) {
                        return target.set(800, 600);
                    }
                }, {});
                const originalUpdate = this.fullscreen.update;
                this.fullscreen.updateCount = 0;
                this.fullscreen.update = function(delta) {
                    this.updateCount++;
                    this.lastDelta = delta;
                    return originalUpdate.call(this, delta);
                };
                this.update = function() {};
            `,
        );
        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;
        const nonCameraParent = new Object3D();
        nonCameraParent.add(behavior.fullscreen);

        behavior.update(1 / 20);

        expect(behavior.fullscreen.parent).toBe(uiCamera);
        expect(behavior.fullscreen.updateCount).toBe(1);
        expect(behavior.fullscreen.lastDelta).toBe(1 / 20);
    });

    it("stops auto-updating fullscreen roots after behavior teardown disposes them", () => {
        const uiCamera = new PerspectiveCamera();
        global.app = {
            editor: {
                scene: {
                    userData: {},
                },
            },
            game: {
                ensureUICamera: vi.fn(() => uiCamera),
            },
        } as any;

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-uikit-fullscreen-auto-teardown-test",
            `
                this.fullscreen = new UIKit.Fullscreen({
                    domElement: { clientWidth: 800, clientHeight: 600 },
                    getSize(target) {
                        return target.set(800, 600);
                    }
                }, {});
                const originalUpdate = this.fullscreen.update;
                this.fullscreen.updateCount = 0;
                this.fullscreen.update = function(delta) {
                    this.updateCount++;
                    this.lastDelta = delta;
                    return originalUpdate.call(this, delta);
                };
                this.update = function() {};
                this.dispose = function() {
                    this.fullscreen.removeFromParent();
                    this.fullscreen.dispose();
                };
            `,
        );
        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;

        behavior.update(1 / 60);
        behavior.dispose();
        behavior.update(1 / 30);

        expect(behavior.fullscreen.updateCount).toBe(1);
        expect(behavior.fullscreen.parent).toBeNull();
    });

    it("does not resurrect detached fullscreen roots on behavior-frame auto update", async () => {
        const uiCamera = new PerspectiveCamera();
        global.app = {
            editor: {
                scene: {
                    userData: {},
                },
            },
            game: {
                ensureUICamera: vi.fn(() => uiCamera),
            },
        } as any;

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-uikit-fullscreen-detached-no-resurrection-test",
            `
                this.fullscreen = new UIKit.Fullscreen({
                    domElement: { clientWidth: 800, clientHeight: 600 },
                    getSize(target) {
                        return target.set(800, 600);
                    }
                }, {});
                const originalUpdate = this.fullscreen.update;
                this.fullscreen.updateCount = 0;
                this.fullscreen.update = function(delta) {
                    this.updateCount++;
                    this.lastDelta = delta;
                    return originalUpdate.call(this, delta);
                };
                this.update = function() {};
            `,
        );
        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;

        behavior.update(1 / 60);
        behavior.fullscreen.removeFromParent();
        await Promise.resolve();
        behavior.update(1 / 30);

        expect(behavior.fullscreen.updateCount).toBe(1);
        expect(behavior.fullscreen.parent).toBeNull();
    });

    it("propagates repeated fullscreen camera update failures after repair retry", () => {
        const uiCamera = new PerspectiveCamera();
        global.app = {
            editor: {
                scene: {
                    userData: {},
                },
            },
            game: {
                ensureUICamera: vi.fn(() => uiCamera),
            },
        } as any;

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-uikit-fullscreen-repeated-camera-error-propagates-test",
            `
                this.fullscreen = new UIKit.Fullscreen({
                    domElement: { clientWidth: 800, clientHeight: 600 },
                    getSize() {
                        throw new Error("fullscreen can only be added to a camera");
                    }
                }, {});
                this.update = function(delta) {
                    this.fullscreen.update(delta);
                };
            `,
        );
        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;

        expect(() => behavior.update(1 / 60)).toThrow("fullscreen can only be added to a camera");
        expect(behavior.fullscreen.parent).toBe(uiCamera);
    });

    it("does not deep-scan behavior fields during cached fullscreen auto-update frames", () => {
        const uiCamera = new PerspectiveCamera();
        global.app = {
            editor: {
                scene: {
                    userData: {},
                },
            },
            game: {
                ensureUICamera: vi.fn(() => uiCamera),
            },
        } as any;

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-uikit-fullscreen-no-frame-rescan-test",
            `
                this.fullscreen = new UIKit.Fullscreen({
                    domElement: { clientWidth: 800, clientHeight: 600 },
                    getSize(target) {
                        return target.set(800, 600);
                    }
                }, {});
                const originalUpdate = this.fullscreen.update;
                this.fullscreen.updateCount = 0;
                this.fullscreen.update = function(delta) {
                    this.updateCount++;
                    this.lastDelta = delta;
                    return originalUpdate.call(this, delta);
                };
                this.update = function() {};
            `,
        );
        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;

        behavior.update(1 / 60);

        let scanCount = 0;
        Object.defineProperty(behavior, "rescanTrap", {
            enumerable: true,
            configurable: true,
            get() {
                scanCount++;
                throw new Error("frame deep scan touched rescanTrap");
            },
        });

        behavior.update(1 / 30);

        expect(scanCount).toBe(0);
        expect(behavior.fullscreen.updateCount).toBe(2);
    });

    it("discovers async onStart-created fullscreen roots on first update and caches thereafter", async () => {
        const uiCamera = new PerspectiveCamera();
        global.app = {
            editor: {
                scene: {
                    userData: {},
                },
            },
            game: {
                ensureUICamera: vi.fn(() => uiCamera),
            },
        } as any;

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-uikit-fullscreen-async-onstart-first-frame-discovery-test",
            `
                this.onStart = async function() {
                    await Promise.resolve();
                    this.fullscreen = new UIKit.Fullscreen({
                        domElement: { clientWidth: 800, clientHeight: 600 },
                        getSize(target) {
                            return target.set(800, 600);
                        }
                    }, {});
                    const originalUpdate = this.fullscreen.update;
                    this.fullscreen.updateCount = 0;
                    this.fullscreen.update = function(delta) {
                        this.updateCount++;
                        this.lastDelta = delta;
                        return originalUpdate.call(this, delta);
                    };
                };
                this.update = function() {};
            `,
        );
        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;

        await behavior.onStart();
        expect(behavior.fullscreen.parent).toBe(uiCamera);

        behavior.fullscreen.removeFromParent();
        behavior.fullscreenDetachedBeforeFirstUpdate = behavior.fullscreen.parent;
        uiCamera.add(behavior.fullscreen);
        behavior.update(1 / 60);

        let scanCount = 0;
        Object.defineProperty(behavior, "lateRescanTrap", {
            enumerable: true,
            configurable: true,
            get() {
                scanCount++;
                throw new Error("second frame deep scan touched lateRescanTrap");
            },
        });
        behavior.update(1 / 30);

        expect(behavior.fullscreen.parent).toBe(uiCamera);
        expect(behavior.fullscreen.updateCount).toBe(2);
        expect(behavior.fullscreen.lastDelta).toBe(1 / 30);
        expect(scanCount).toBe(0);
    });

    it("auto-updates discovered UIKit fullscreen roots during fixedUpdate frames", () => {
        const uiCamera = new PerspectiveCamera();
        global.app = {
            editor: {
                scene: {
                    userData: {},
                },
            },
            game: {
                ensureUICamera: vi.fn(() => uiCamera),
            },
        } as any;

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-uikit-fullscreen-fixed-auto-update-test",
            `
                this.fullscreen = new UIKit.Fullscreen({
                    domElement: { clientWidth: 800, clientHeight: 600 },
                    getSize(target) {
                        return target.set(800, 600);
                    }
                }, {});
                const originalUpdate = this.fullscreen.update;
                this.fullscreen.updateCount = 0;
                this.fullscreen.update = function(delta) {
                    this.updateCount++;
                    this.lastDelta = delta;
                    return originalUpdate.call(this, delta);
                };
                this.fixedUpdate = function() {};
            `,
        );
        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;

        behavior.fixedUpdate(0.02);

        expect(behavior.fullscreen.updateCount).toBe(1);
        expect(behavior.fullscreen.lastDelta).toBe(0.02);
    });

    it("keeps nested behavior-frame fullscreen auto-updates isolated by frame epoch", () => {
        const uiCamera = new PerspectiveCamera();
        global.app = {
            editor: {
                scene: {
                    userData: {},
                },
            },
            game: {
                ensureUICamera: vi.fn(() => uiCamera),
            },
        } as any;

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-uikit-fullscreen-reentrant-auto-update-test",
            `
                this.fullscreen = new UIKit.Fullscreen({
                    domElement: { clientWidth: 800, clientHeight: 600 },
                    getSize(target) {
                        return target.set(800, 600);
                    }
                }, {});
                const originalUpdate = this.fullscreen.update;
                this.fullscreen.updateDeltas = [];
                this.fullscreen.update = function(delta) {
                    this.updateDeltas.push(delta);
                    return originalUpdate.call(this, delta);
                };
                this.update = function(delta) {
                    if (!this.reentered) {
                        this.reentered = true;
                        this.update(delta / 2);
                    }
                };
            `,
        );
        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;

        behavior.update(0.1);

        expect(behavior.fullscreen.updateDeltas).toEqual([0.05, 0.1]);
    });

    it("does not auto-update UIKit fullscreen roots outside generated behavior ownership", () => {
        const uiCamera = new PerspectiveCamera();
        global.app = {
            editor: {
                scene: {
                    userData: {},
                },
            },
            game: {
                ensureUICamera: vi.fn(() => uiCamera),
            },
        } as any;
        const externalFullscreen = new (UIKit.Fullscreen as any)({
            domElement: {clientWidth: 800, clientHeight: 600},
            getSize(target: {set: (width: number, height: number) => unknown}) {
                return target.set(800, 600);
            },
        }, {});
        uiCamera.add(externalFullscreen);
        const originalExternalUpdate = externalFullscreen.update;
        externalFullscreen.updateCount = 0;
        externalFullscreen.update = function(delta: number) {
            this.updateCount++;
            return originalExternalUpdate.call(this, delta);
        };

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-uikit-fullscreen-external-no-auto-update-test",
            `
                this.update = function() {};
            `,
        );
        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;

        behavior.update(1 / 60);

        expect(externalFullscreen.updateCount).toBe(0);
    });

    it("reattaches TinySkies-style fullscreen HUDs when the runtime UI camera becomes available", () => {
        const uiCamera = new PerspectiveCamera();
        const ensureUICamera = vi.fn<() => PerspectiveCamera>(() => {
            throw new Error("ui camera not ready");
        });
        global.app = {
            editor: {
                scene: {
                    userData: {},
                },
            },
            game: {
                ensureUICamera,
            },
        } as any;

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-uikit-fullscreen-late-camera-test",
            `
                this._buildHud = function() {
                    if (this._fullscreen) return;
                    this._fullscreen = new UIKit.Fullscreen({
                        getSize(target) {
                            return target.set(800, 600);
                        }
                    }, {});
                };
                this._tickHud = function() {
                    if (!this._fullscreen) this._buildHud();
                    this._fullscreen.update(800, 600);
                };
                this.update = function() {
                    this._tickHud();
                };
            `,
        );
        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;

        expect(() => behavior.update(1 / 60)).not.toThrow();
        expect(behavior._fullscreen.parent).toBeNull();

        ensureUICamera.mockImplementation(() => uiCamera);

        expect(() => behavior.update(1 / 60)).not.toThrow();
        expect(behavior._fullscreen.parent).toBe(uiCamera);
    });

    it("repairs TinySkies-style fullscreen HUDs moved under a generic camera before the UI camera is ready", () => {
        const genericCamera = new Camera();
        const uiCamera = new PerspectiveCamera();
        let uiCameraReady = false;
        const ensureUICamera = vi.fn<() => PerspectiveCamera>(() => {
            if (!uiCameraReady) {
                throw new Error("ui camera not ready");
            }
            return uiCamera;
        });
        global.app = {
            editor: {
                scene: {
                    userData: {},
                },
            },
            game: {
                ensureUICamera,
            },
        } as any;

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-uikit-fullscreen-generic-parent-repair-test",
            `
                this._game = {
                    uiCamera: null,
                    renderer: {
                        domElement: { clientWidth: 800, clientHeight: 600 },
                        getSize(target) {
                            return target.set(800, 600);
                        }
                    }
                };
                this._game.uiCamera = this._externalCamera;
                this._buildHud = function() {
                    if (this._fullscreen) return;
                    this._fullscreen = new UIKit.Fullscreen(this._game.renderer, {});
                };
                this._tickHud = function() {
                    if (!this._fullscreen) this._buildHud();
                    if (!this._fullscreen) return;
                    if (this._game.uiCamera && !this._fullscreen.parent) {
                        this._game.uiCamera.add(this._fullscreen);
                    }
                    this._fullscreen.update(
                        this._game.renderer.domElement.clientWidth,
                        this._game.renderer.domElement.clientHeight
                    );
                    this._fullscreenParent = this._fullscreen.parent;
                };
                this.update = function() {
                    this._tickHud();
                };
            `,
        );
        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;
        behavior._externalCamera = genericCamera;
        behavior._game.uiCamera = genericCamera;

        expect(() => behavior.update(1 / 60)).not.toThrow();
        expect(behavior._fullscreen.parent).toBe(genericCamera);

        uiCameraReady = true;

        expect(() => behavior.update(1 / 60)).not.toThrow();
        expect(behavior._fullscreen.parent).toBe(uiCamera);
        expect(behavior._fullscreenParent).toBe(uiCamera);
    });

    it("does not treat generic Three cameras as valid UIKit fullscreen parents", () => {
        const genericCamera = new Camera();
        const fallbackCamera = new PerspectiveCamera();
        global.app = {
            editor: {
                scene: {
                    userData: {},
                },
            },
            game: {
                ensureUICamera: vi.fn(() => genericCamera),
                uiCamera: genericCamera,
                camera: genericCamera,
            },
            camera: fallbackCamera,
        } as any;

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-uikit-fullscreen-generic-camera-test",
            `
                this.fullscreen = new UIKit.Fullscreen({
                    getSize(target) {
                        return target.set(800, 600);
                    }
                }, {});
            `,
        );

        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;

        expect(behavior.fullscreen.parent).toBe(fallbackCamera);
        expect(() => behavior.fullscreen.update(1 / 60)).not.toThrow();
    });

    it("parents UIKit fullscreen roots from the runtime global app when the module app is not set", () => {
        const uiCamera = new PerspectiveCamera();
        const ensureUICamera = vi.fn(() => uiCamera);
        (globalThis as {app?: unknown}).app = {
            game: {
                ensureUICamera,
            },
        };

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-uikit-fullscreen-global-app-test",
            `
                this.fullscreen = new UIKit.Fullscreen({
                    getSize(target) {
                        return target.set(800, 600);
                    }
                }, {});
            `,
        );

        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;

        expect(ensureUICamera).toHaveBeenCalledTimes(1);
        expect(behavior.fullscreen.parent).toBe(uiCamera);
        expect(() => behavior.fullscreen.update(800, 600)).not.toThrow();
    });

    it("does not suppress script errors that only reuse the fullscreen camera message", () => {
        const uiCamera = new PerspectiveCamera();
        global.app = {
            editor: {
                scene: {
                    userData: {},
                },
            },
            game: {
                ensureUICamera: vi.fn(() => uiCamera),
            },
        } as any;

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-uikit-fullscreen-direct-hook-transient-test",
            `
                this.update = function() {
                    throw new Error("fullscreen can only be added to a camera");
                };
            `,
        );
        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        expect(() => behavior.update(1 / 60)).toThrow("fullscreen can only be added to a camera");
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it("wraps non-compartment script hooks assigned after construction", () => {
        const uiCamera = new PerspectiveCamera();
        global.app = {
            editor: {
                scene: {
                    userData: {},
                },
            },
            game: {
                ensureUICamera: vi.fn(() => uiCamera),
            },
        } as any;

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-uikit-fullscreen-late-hook-assignment-test",
            `
                this.installUpdateHook = function() {
                    this.update = function() {
                        throw new Error("fullscreen can only be added to a camera");
                    };
                };
            `,
        );
        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        expect(behavior[BEHAVIOR_LIFECYCLE_HOOK_QUERY]("update")).toBe(false);
        behavior.installUpdateHook();

        expect(behavior[BEHAVIOR_LIFECYCLE_HOOK_QUERY]("update")).toBe(true);
        expect(() => behavior.update(1 / 60)).toThrow("fullscreen can only be added to a camera");
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it("repairs state-held legacy fullscreen roots before non-compartment hooks run", () => {
        const uiCamera = new PerspectiveCamera();
        global.app = {
            editor: {
                scene: {
                    userData: {},
                },
            },
            game: {
                ensureUICamera: vi.fn(() => uiCamera),
            },
        } as any;

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-uikit-fullscreen-prehook-repair-test",
            `
                class LegacyFullscreen extends THREE.Object3D {
                    update() {
                        if (!this.parent?.isPerspectiveCamera && !this.parent?.isOrthographicCamera) {
                            throw new Error("fullscreen can only be added to a camera");
                        }
                        this.didUpdate = true;
                    }
                }
                const fullscreen = new LegacyFullscreen();
                const nonCameraParent = new THREE.Object3D();
                nonCameraParent.add(fullscreen);
                this.panel = { fullscreen };
                this.update = function() {
                    this.panel.fullscreen.update(1 / 60);
                };
            `,
        );
        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;

        expect(behavior.panel.fullscreen.parent).toBe(uiCamera);
        expect(() => behavior.update(1 / 60)).not.toThrow();
        expect(behavior.panel.fullscreen.parent).toBe(uiCamera);
        expect(behavior.panel.fullscreen.didUpdate).toBe(true);
    });

    it("repairs known non-compartment fullscreen roots again after scripts reparent them", () => {
        const uiCamera = new PerspectiveCamera();
        global.app = {
            editor: {
                scene: {
                    userData: {},
                },
            },
            game: {
                ensureUICamera: vi.fn(() => uiCamera),
            },
        } as any;

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-uikit-fullscreen-reparented-frame-repair-test",
            `
                class LegacyFullscreen extends THREE.Object3D {
                    update() {
                        if (!this.parent?.isPerspectiveCamera && !this.parent?.isOrthographicCamera) {
                            throw new Error("fullscreen can only be added to a camera");
                        }
                        this.didUpdateCount = (this.didUpdateCount || 0) + 1;
                    }
                }
                const fullscreen = new LegacyFullscreen();
                const nonCameraParent = new THREE.Object3D();
                nonCameraParent.add(fullscreen);
                this.panel = { fullscreen };
                this.update = function() {
                    this.panel.fullscreen.update(1 / 60);
                    nonCameraParent.add(this.panel.fullscreen);
                };
            `,
        );
        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;

        expect(() => behavior.update(1 / 60)).not.toThrow();
        expect(behavior.panel.fullscreen.parent).not.toBe(uiCamera);
        expect(() => behavior.update(1 / 60)).not.toThrow();
        expect(behavior.panel.fullscreen.didUpdateCount).toBe(2);
    });

    it("repairs closure-held UIKit fullscreen roots used by non-compartment script hooks", () => {
        const uiCamera = new PerspectiveCamera();
        global.app = {
            editor: {
                scene: {
                    userData: {},
                },
            },
            game: {
                ensureUICamera: vi.fn(() => uiCamera),
            },
        } as any;

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-uikit-fullscreen-closure-hook-test",
            `
                const renderer = {
                    getSize(target) {
                        return target.set(800, 600);
                    }
                };
                const fullscreen = new UIKit.Fullscreen(renderer, {});
                const nonCameraParent = new THREE.Object3D();
                nonCameraParent.add(fullscreen);
                this.update = function() {
                    fullscreen.update(1 / 60);
                    this.fullscreenParent = fullscreen.parent;
                };
            `,
        );
        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;

        expect(() => behavior.update(1 / 60)).not.toThrow();
        expect(behavior.fullscreenParent).toBe(uiCamera);
    });

    it("suppresses transient compartment fullscreen update errors and repairs nested roots", () => {
        const uiCamera = new PerspectiveCamera();
        global.app = {
            editor: {
                scene: {
                    userData: {
                        compartmentsEnabled: true,
                    },
                },
            },
            game: {
                ensureUICamera: vi.fn(() => uiCamera),
            },
        } as any;

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-uikit-fullscreen-compartment-transient-test",
            `
                const renderer = {
                    getSize(target) {
                        return target.set(800, 600);
                    }
                };
                this.panel = {
                    nested: {
                        fullscreen: new UIKit.Fullscreen(renderer, {})
                    }
                };
                this.nonCameraParent = new THREE.Object3D();
                this.nonCameraParent.add(this.panel.nested.fullscreen);
                this.update = function() {
                    this.nonCameraParent.add(this.panel.nested.fullscreen);
                    throw new Error("fullscreen can only be added to a camera");
                };
            `,
        );
        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;
        behavior.init({});
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        behavior.update(1 / 60);

        expect(errorSpy).not.toHaveBeenCalled();
        expect(behavior.script.panel.nested.fullscreen.parent).toBe(uiCamera);
    });

    it("repairs state-held legacy fullscreen roots before compartment hooks run", () => {
        const uiCamera = new PerspectiveCamera();
        global.app = {
            editor: {
                scene: {
                    userData: {
                        compartmentsEnabled: true,
                    },
                },
            },
            game: {
                ensureUICamera: vi.fn(() => uiCamera),
            },
        } as any;

        const BehaviorClass = new BehaviorScriptInjector().parse(
            "runtime-uikit-fullscreen-compartment-prehook-repair-test",
            `
                this.init = function() {
                    class LegacyFullscreen extends THREE.Object3D {
                        update() {
                            if (!this.parent?.isPerspectiveCamera && !this.parent?.isOrthographicCamera) {
                                throw new Error("fullscreen can only be added to a camera");
                            }
                            this.didUpdate = true;
                        }
                    }
                    const fullscreen = new LegacyFullscreen();
                    const nonCameraParent = new THREE.Object3D();
                    nonCameraParent.add(fullscreen);
                    this.panel = { fullscreen };
                };
                this.update = function() {
                    this.panel.fullscreen.update(1 / 60);
                };
            `,
        );
        const behavior = new BehaviorClass(new Object3D(), "test.behavior", createBehaviorOptions()) as any;
        behavior.init({});

        expect(behavior.script.panel.fullscreen.parent).toBe(uiCamera);
        expect(() => behavior.update(1 / 60)).not.toThrow();
        expect(behavior.script.panel.fullscreen.parent).toBe(uiCamera);
        expect(behavior.script.panel.fullscreen.didUpdate).toBe(true);
    });
});
