import * as THREE from "three";
import {PCFSoftShadowMap} from "three";
import {describe, expect, it, vi} from "vitest";

import {SettingsHandlers} from "./SettingsHandlers";

/**
 *
 */
function createHarness() {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 1, 100000);
    camera.name = "DefaultCamera";
    camera.userData.cameraData = {
        cameraFOV: 60,
        cameraNear: 1,
        cameraFar: 100000,
        cameraType: "Third Person",
    };
    const app = {
        camera,
        editor: {scene, sceneName: "Untitled"},
        environmentManager: {
            updateEnvironmentSettings: vi.fn(async () => {}),
        },
        call: vi.fn(),
    };

    return {
        app,
        scene,
        handlers: new SettingsHandlers(app as any),
    };
}

describe("SettingsHandlers normalization", () => {
    it("applies camera settings to the default app camera by name", () => {
        const {handlers, app, scene} = createHarness();
        const camera = app.camera;
        const updateSpy = vi.spyOn(camera, "updateProjectionMatrix");

        expect(scene.getObjectByName("DefaultCamera")).toBeUndefined();

        const result = handlers.handleSetCameraSettings({
            target: "DefaultCamera",
            cameraType: "NONE",
            fov: 60,
            near: 0.01,
            far: 500,
        });

        expect(result.status).toBe("success");
        expect(camera.userData.cameraData.cameraNear).toBe(0.01);
        expect(camera.userData.cameraData.cameraFar).toBe(500);
        expect(camera.userData.cameraData.cameraType).toBe("NONE");
        expect(camera.near).toBe(0.01);
        expect(camera.far).toBe(500);
        expect(updateSpy).toHaveBeenCalledTimes(1);
        expect(app.call).toHaveBeenCalledWith("objectChanged", app.editor, camera);
    });

    it("gets camera settings from the default app camera by name", () => {
        const {handlers, app} = createHarness();

        handlers.handleSetCameraSettings({
            target: "DefaultCamera",
            cameraType: "NONE",
            fov: 60,
            near: 0.01,
            far: 500,
        });

        const result = handlers.handleGetCameraSettings({target: "DefaultCamera"});

        expect(result.status).toBe("success");
        expect(result.data.near).toBe(0.01);
        expect(result.data.far).toBe(500);
        expect(result.data.cameraType).toBe("NONE");
        expect(result.data.projection.near).toBe(app.camera.near);
    });

    it("gets post-processing sub-effect settings", () => {
        const {handlers} = createHarness();

        handlers.handleSetPostProcessing({
            outline: {enabled: true, edgeStrength: 2},
            bloom: {enabled: false, strength: 0.5},
        });

        const result = handlers.handleGetSceneSetting({category: "outline"});

        expect(result.status).toBe("success");
        expect(result.data).toEqual({enabled: true, edgeStrength: 2});
    });

    it("accepts object gradients and stores them as CSS strings", async () => {
        const {handlers, scene} = createHarness();

        const result = await handlers.handleSetSceneBackground({
            type: "Gradient",
            gradient: {topColor: "#87CEEB", bottomColor: "#dfefff"},
            gradientMode: "3D",
        });

        expect(result.status).toBe("success");
        expect(scene.userData.rendering.background.gradient).toBe(
            "linear-gradient(180deg, #87CEEB 0%, #dfefff 100%)",
        );
        expect(scene.userData.rendering.background.gradientMode).toBe("3d");
    });

    it("accepts string shadow map labels and stores numeric constants", async () => {
        const {handlers, scene} = createHarness();

        const result = await handlers.handleSetRenderingSettings({
            shadowMapType: "PCFSoftShadowMap",
        });

        expect(result.status).toBe("success");
        expect(scene.userData.rendering.shadowMapType).toBe(PCFSoftShadowMap);
    });

    it("defaults new game settings to game-enabled", () => {
        const {handlers, scene} = createHarness();

        const result = handlers.handleSetGameSettings({lives: 5});

        expect(result.status).toBe("success");
        expect(scene.userData.game.isGame).toBe(true);
        expect(scene.userData.game.lives).toBe(5);
        expect(result.data.isGame).toBe(true);
    });

    it("updates project title, notifies scene-name listeners, and supports project readback", () => {
        const {handlers, app} = createHarness();

        const result = handlers.handleSetProjectTitle({title: "Crystal Dash"});
        const readback = handlers.handleGetSceneSetting({category: "project"});

        expect(result.status).toBe("success");
        expect(app.editor.sceneName).toBe("Crystal Dash");
        expect(app.call).toHaveBeenCalledWith("sceneNameUpdated");
        expect(app.call).toHaveBeenCalledWith("objectChanged", app.editor, app.editor.scene);
        expect(readback.status).toBe("success");
        expect(readback.data).toEqual({title: "Crystal Dash"});
    });

    it("does not turn rendering-only settings into a game", async () => {
        const {handlers, scene} = createHarness();

        const result = await handlers.handleSetRenderingSettings({
            shadowMapType: "PCFSoftShadowMap",
        });

        expect(result.status).toBe("success");
        expect(scene.userData.game.isGame).toBe(false);
    });

    it("accepts legacy enabled game-setting writes as an isGame alias", () => {
        const {handlers, scene} = createHarness();

        const result = handlers.handleSetGameSettings({enabled: false});

        expect(result.status).toBe("success");
        expect(scene.userData.game.isGame).toBe(false);
        expect(scene.userData.game.enabled).toBeUndefined();
        expect(result.data.isGame).toBe(false);
    });

    it("repairs legacy rendering values when reading editor settings", async () => {
        const {handlers, scene} = createHarness();
        scene.userData.rendering = {
            shadowMapType: "PCFSoftShadowMap",
            background: {
                type: "Gradient",
                gradient: {topColor: "#111111", bottomColor: "#999999"},
                gradientMode: "3D",
            },
        };
        scene.userData.game = {};

        const result = await handlers.handleGetEditorSettings({category: "background"});

        expect(result.status).toBe("success");
        expect(scene.userData.rendering.shadowMapType).toBe(PCFSoftShadowMap);
        expect(scene.userData.rendering.background.gradient).toBe(
            "linear-gradient(180deg, #111111 0%, #999999 100%)",
        );
        expect(scene.userData.rendering.background.gradientMode).toBe("3d");
    });
});
