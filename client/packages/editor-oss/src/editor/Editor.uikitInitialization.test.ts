import {beforeEach, describe, expect, it, vi} from "vitest";
import {Object3D, PerspectiveCamera, Scene, Vector3} from "three";

const uikitInitializationMocks = vi.hoisted(() => ({
    ensureUIKitRuntimeInitialized: vi.fn<() => Promise<void>>(),
}));

vi.mock("../behaviors/uikit/UIKitInitialization", () => uikitInitializationMocks);

import Editor from "./Editor";

describe("Editor UIKit behavior activation ordering", () => {
    beforeEach(() => {
        uikitInitializationMocks.ensureUIKitRuntimeInitialized.mockReset();
    });

    it("starts scene activation without globally blocking on the UIKit bootstrap", async () => {
        let releaseInitialization!: () => void;
        const initialization = new Promise<void>(resolve => {
            releaseInitialization = resolve;
        });
        uikitInitializationMocks.ensureUIKitRuntimeInitialized.mockReturnValue(initialization);

        const editor = Object.create(Editor.prototype) as any;
        editor.engine = {options: {isPlayModeOnly: false}, camera: {}};
        editor.ctx = editor.engine;
        editor.uikitRuntimeInitialization =
            uikitInitializationMocks.ensureUIKitRuntimeInitialized();
        editor.isUIKitRuntimeInitialized = false;

        const activationOrder: string[] = [];
        editor.loadSceneBehaviors = vi.fn(() => {
            // BehaviorScriptInjector.parse executes the user module body. This
            // represents `const root = new UIKit.Fullscreen(...)` at top level.
            activationOrder.push("top-level UIKit construction");
        });
        editor.cleanupScriptsAndConfigs = vi.fn();
        editor.convertToNewBehaviors = vi.fn();
        editor.convertCameraToNewFormat = vi.fn();
        editor.addBackendBehaviorsToScene = vi.fn(async () => {});
        editor.loadBackendLambdaConfigs = vi.fn(async () => {});
        editor.loadBackendImportSources = vi.fn(async () => {});
        editor.notifyObjectsAddedToScene = vi.fn();
        editor.clearAndAddObjectsBehaviorPlugins = vi.fn(async () => {});
        editor.syncSceneBehaviorConfigs = vi.fn();

        const sceneActivation = editor.onSceneLoaded();
        await Promise.resolve();

        expect(editor.loadSceneBehaviors).toHaveBeenCalledOnce();
        expect(activationOrder).toEqual(["top-level UIKit construction"]);

        activationOrder.push("UIKit runtime initialized");
        releaseInitialization();
        await sceneActivation;

        expect(activationOrder).toEqual(["top-level UIKit construction", "UIKit runtime initialized"]);
    });

    it("repairs Quick Build materials on play-only scene loads", async () => {
        const editor = Object.create(Editor.prototype) as any;
        editor.engine = {options: {isPlayModeOnly: true}};
        editor.loadSceneBehaviors = vi.fn();
        editor.repairQuickBuildSceneMaterials = vi.fn();

        await editor.onSceneLoaded();

        expect(editor.repairQuickBuildSceneMaterials).toHaveBeenCalledOnce();
    });

    it("guards an independent script registration before parse executes user UIKit code", async () => {
        let releaseInitialization!: () => void;
        const initialization = new Promise<void>(resolve => {
            releaseInitialization = resolve;
        });
        uikitInitializationMocks.ensureUIKitRuntimeInitialized.mockReturnValue(initialization);

        const parse = vi.fn(() => class TopLevelUIKitBehavior {});
        const registerType = vi.fn();
        const editor = Object.create(Editor.prototype) as any;
        editor.uikitRuntimeInitialization =
            uikitInitializationMocks.ensureUIKitRuntimeInitialized();
        editor.isUIKitRuntimeInitialized = false;
        editor.sceneConfig = {sceneID: "local-playground-scene"};
        editor.engine = {
            behaviorLoadingService: {
                resolveScriptImportRevisionMap: vi.fn(async () => ({})),
            },
        };
        editor.behaviorScriptInjector = {parse};
        editor.behaviorTypeRegistry = {
            getType: vi.fn(() => undefined),
            unregisterType: vi.fn(),
            registerType,
        };

        const script = "const hud = new UIKit.Fullscreen(renderer);";
        const registration = editor.parseAndRegisterScriptBehavior(
            "top-level-uikit",
            script,
            {},
            undefined,
            {contextIsNameAware: true},
        );
        await Promise.resolve();

        expect(parse).not.toHaveBeenCalled();

        releaseInitialization();
        await registration;

        expect(parse).toHaveBeenCalledWith(
            "top-level-uikit",
            script,
            undefined,
            expect.objectContaining({context: {}}),
        );
        expect(registerType).toHaveBeenCalledOnce();
    });
});

describe("Editor.ensureUICamera", () => {
    beforeEach(() => {
        uikitInitializationMocks.ensureUIKitRuntimeInitialized.mockReset();
        uikitInitializationMocks.ensureUIKitRuntimeInitialized.mockResolvedValue(undefined);
    });

    function createEditorUICameraHarness() {
        const camera = new PerspectiveCamera();
        const scene = new Scene();
        const editor = Object.create(Editor.prototype) as any;
        editor.engine = {camera, scene};
        editor.ctx = editor.engine;
        editor.uiCamera = null;
        editor._uiCameraInitPromise = null;
        return {editor, camera, scene};
    }

    it("synchronizes stable frames without copying the camera, deep-cloning userData, or rebuilding projection", async () => {
        const {editor, camera} = createEditorUICameraHarness();
        camera.userData = {role: "editor-main", nested: {value: 7}};

        const uiCamera = await editor.ensureUICamera();
        const copySpy = vi.spyOn(uiCamera, "copy");
        const projectionSpy = vi.spyOn(uiCamera, "updateProjectionMatrix");
        const initialUserData = uiCamera.userData;
        const initialNestedUserData = uiCamera.userData.nested;

        for (let i = 0; i < 20; i++) {
            uiCamera.updateMatrixWorld();
        }

        expect(copySpy).not.toHaveBeenCalled();
        expect(projectionSpy).not.toHaveBeenCalled();
        expect(uiCamera.userData).toBe(initialUserData);
        expect(uiCamera.userData.nested).toBe(initialNestedUserData);
        expect(uiCamera.userData).toMatchObject({role: "editor-main", isRuntimeOnly: true});
        expect(uiCamera.userData.nested).not.toBe(camera.userData.nested);

        camera.position.set(4, 5, 6);
        camera.fov = 75;
        camera.updateProjectionMatrix();
        uiCamera.updateMatrixWorld();

        expect(uiCamera.position.toArray()).toEqual([4, 5, 6]);
        expect(uiCamera.fov).toBe(75);
        expect(uiCamera.near).toBeCloseTo(0.2);
        expect(projectionSpy).toHaveBeenCalledTimes(1);
        expect(copySpy).not.toHaveBeenCalled();
    });

    it("copies authoritative source matrixWorld when source camera uses manual world updates", async () => {
        const {editor, camera} = createEditorUICameraHarness();

        const uiCamera = await editor.ensureUICamera();
        const hudRoot = new Object3D();
        const observedParentPosition = new Vector3();
        hudRoot.updateMatrixWorld = vi.fn(function updateHUDRootMatrixWorld(this: Object3D, force?: boolean) {
            observedParentPosition.setFromMatrixPosition(this.parent!.matrixWorld);
            Object3D.prototype.updateMatrixWorld.call(this, force);
        });
        uiCamera.add(hudRoot);

        camera.matrixWorldAutoUpdate = false;
        camera.position.set(3.746, 3.9, -1.253);
        camera.matrixWorld.makeTranslation(3.746, 3.9, -1.253);
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

        uiCamera.updateMatrixWorld();

        expect(uiCamera.position.toArray()).toEqual([3.746, 3.9, -1.253]);
        expect(uiCamera.matrixWorld.equals(camera.matrixWorld)).toBe(true);
        expect(uiCamera.matrixWorldInverse.equals(camera.matrixWorldInverse)).toBe(true);
        expect(hudRoot.updateMatrixWorld).toHaveBeenCalledOnce();
        expect(observedParentPosition.toArray()).toEqual([3.746, 3.9, -1.253]);
    });

    it("derives UI camera matrixWorld from local transforms when source camera auto-updates", async () => {
        const {editor, camera} = createEditorUICameraHarness();

        const uiCamera = await editor.ensureUICamera();

        camera.matrixWorldAutoUpdate = true;
        camera.position.set(2, 3, 4);
        camera.matrixWorld.makeTranslation(20, 30, 40);

        uiCamera.updateMatrixWorld();

        const uiWorldPosition = new Vector3().setFromMatrixPosition(uiCamera.matrixWorld);
        expect(uiCamera.position.toArray()).toEqual([2, 3, 4]);
        expect(uiWorldPosition.toArray()).toEqual([2, 3, 4]);
        expect(uiCamera.matrixWorld.equals(camera.matrixWorld)).toBe(false);
    });
});

describe("Editor deferred behavior activation lifecycle", () => {
    function createDeferredRetryHarness() {
        let resolveParse!: () => void;
        let typeReady = false;
        const parse = new Promise<void>(resolve => {
            resolveParse = () => {
                typeReady = true;
                resolve();
            };
        });
        const retry = vi.fn();
        const editor = Object.create(Editor.prototype) as any;
        editor.engine = {};
        editor.isStarted = true;
        editor.behaviorPluginActivationToken = 7;
        editor.behaviorTypeRegistry = {
            getType: vi.fn(() => typeReady ? class ParsedBehavior {} : undefined),
        };
        editor.behaviorScriptRegistry = {
            getScript: vi.fn(() => "const hud = new UIKit.Fullscreen(renderer);"),
        };
        editor.behaviorPluginManager = {
            getPlugin: vi.fn(() => undefined),
        };
        editor.ensureBehaviorTypeParsed = vi.fn(() => parse);
        // The initial call below uses the prototype directly. A valid deferred
        // continuation reaches this instance method, making retries observable
        // without constructing the full plugin.
        editor.addBehaviorPlugin = retry;

        const behaviorData = {
            id: "top-level-uikit",
            uuid: "behavior-instance",
            enabled: true,
            priority: 0,
        };
        const object = new Object3D();

        return {editor, behaviorData, object, resolveParse, retry};
    }

    it("ignores a missing-type retry from a superseded editor activation", async () => {
        const {editor, behaviorData, object, resolveParse, retry} = createDeferredRetryHarness();

        Editor.prototype.addBehaviorPlugin.call(editor, object, behaviorData);
        editor.behaviorPluginActivationToken += 1;
        resolveParse();
        await Promise.resolve();
        await Promise.resolve();

        expect(retry).not.toHaveBeenCalled();
    });

    it("retries a missing type while its editor activation remains current", async () => {
        const {editor, behaviorData, object, resolveParse, retry} = createDeferredRetryHarness();

        Editor.prototype.addBehaviorPlugin.call(editor, object, behaviorData);
        resolveParse();
        await vi.waitFor(() => {
            expect(retry).toHaveBeenCalledWith(object, behaviorData);
        });
    });
});
