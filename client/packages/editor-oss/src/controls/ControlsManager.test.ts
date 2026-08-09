import {PerspectiveCamera} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import global from "@web-shared/global";
import ControlsManager from "./ControlsManager";

function createApp(camera: PerspectiveCamera) {
    return {
        storage: {controlMode: "FreeControls"},
        editor: {
            camera,
            sceneID: "scene-1",
        },
        on: vi.fn(),
        call: vi.fn(),
    };
}

describe("ControlsManager", () => {
    afterEach(() => {
        global.app = null;
        vi.restoreAllMocks();
    });

    it("emits cameraChanged only when per-frame controls report movement", () => {
        const camera = new PerspectiveCamera();
        const element = document.createElement("div");
        const app = createApp(camera);
        global.app = app as any;

        const manager = new ControlsManager(camera, element);
        expect(app.on).toHaveBeenCalledWith(`animate.${manager.id}`, manager.boundUpdate);
        expect(app.on).toHaveBeenCalledWith(`gpuPick.${manager.id}`, manager.boundGPUPick);

        const update = vi.spyOn(manager.current.controls, "update");
        update.mockReturnValueOnce(false);
        update.mockReturnValueOnce(true);

        expect(manager.update({}, 1 / 60)).toBe(false);
        expect(app.call).not.toHaveBeenCalledWith("cameraChanged", manager, camera);

        expect(manager.update({}, 1 / 60)).toBe(true);
        expect(app.call).toHaveBeenCalledWith("cameraChanged", manager, camera);

        manager.dispose();
        expect(app.on).toHaveBeenCalledWith(`animate.${manager.id}`, null);
        expect(app.on).toHaveBeenCalledWith(`gpuPick.${manager.id}`, null);
    });

    it("bridges legacy editor control change events to cameraChanged", () => {
        const camera = new PerspectiveCamera();
        const element = document.createElement("div");
        const app = createApp(camera);
        global.app = app as any;

        const manager = new ControlsManager(camera, element);
        manager.changeMode("EditorControls");

        manager.current.controls.dispatchEvent({type: "change"});

        expect(app.call).toHaveBeenCalledWith("cameraChanged", manager, camera);

        const controls = manager.current.controls;
        manager.dispose();
        app.call.mockClear();
        controls.dispatchEvent({type: "change"});

        expect(app.call).not.toHaveBeenCalledWith("cameraChanged", manager, camera);
    });

    it("disposes replaced non-first-person controls on ordinary mode switches", () => {
        const camera = new PerspectiveCamera();
        const element = document.createElement("div");
        const app = createApp(camera);
        global.app = app as any;

        const manager = new ControlsManager(camera, element);
        const previous = manager.current;
        const previousDispose = vi.spyOn(previous, "dispose");

        manager.changeMode("EditorControls");

        expect(previousDispose).toHaveBeenCalledTimes(1);

        manager.dispose();
    });

    it("does not rebuild controls when the requested mode is already active", () => {
        const camera = new PerspectiveCamera();
        const element = document.createElement("div");
        const app = createApp(camera);
        global.app = app as any;

        const manager = new ControlsManager(camera, element);
        const current = manager.current;
        const currentDispose = vi.spyOn(current, "dispose");

        manager.changeMode("FreeControls");

        expect(manager.current).toBe(current);
        expect(currentDispose).not.toHaveBeenCalled();

        manager.dispose();
    });

    it("preserves the previous control only while first-person mode is active", () => {
        const camera = new PerspectiveCamera();
        const element = document.createElement("div");
        element.requestPointerLock = vi.fn();
        const originalExitPointerLock = document.exitPointerLock;
        Object.defineProperty(document, "exitPointerLock", {
            configurable: true,
            value: vi.fn(),
        });
        const app = createApp(camera);
        global.app = app as any;

        try {
            const manager = new ControlsManager(camera, element);
            const preserved = manager.current;
            const preservedDispose = vi.spyOn(preserved, "dispose");

            manager.changeMode("FirstPersonControls");
            const firstPerson = manager.current;
            const firstPersonDispose = vi.spyOn(firstPerson, "dispose");

            expect(preservedDispose).not.toHaveBeenCalled();

            manager.changeMode("EditorControls");

            expect(firstPersonDispose).toHaveBeenCalledTimes(1);
            expect(preservedDispose).toHaveBeenCalledTimes(1);

            manager.dispose();
        } finally {
            Object.defineProperty(document, "exitPointerLock", {
                configurable: true,
                value: originalExitPointerLock,
            });
        }
    });
});
