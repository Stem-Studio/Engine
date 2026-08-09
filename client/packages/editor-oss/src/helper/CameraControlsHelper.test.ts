import {MOUSE, PerspectiveCamera, Vector3} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import global from "../global";
import CameraControlsHelper from "./CameraControlsHelper";

function createApp() {
    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld(true);

    const orbitControls = {
        state: MOUSE.ROTATE,
        target: new Vector3(0, 0, -10),
        update: vi.fn(),
    };

    return {
        editor: {
            camera,
            controls: {
                current: {
                    controls: orbitControls,
                },
            },
        },
        on: vi.fn(),
    };
}

describe("CameraControlsHelper", () => {
    const previousApp = global.app;

    afterEach(() => {
        global.app = previousApp;
        vi.restoreAllMocks();
    });

    it("subscribes to animate only while movement input is active", () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const addEventListener = vi.spyOn(document, "addEventListener").mockImplementation(() => {});
        const removeEventListener = vi.spyOn(document, "removeEventListener").mockImplementation(() => {});
        const helper = new CameraControlsHelper();

        helper.start();

        expect(app.on).not.toHaveBeenCalledWith(`animate.${helper.id}`, expect.any(Function));
        expect(addEventListener).toHaveBeenCalledWith("keydown", helper.boundHandleKeyDown);

        helper.handleKeyDown({code: "KeyW", ctrlKey: false, metaKey: false} as KeyboardEvent);
        helper.handleKeyDown({code: "KeyW", ctrlKey: false, metaKey: false} as KeyboardEvent);

        expect(app.on).toHaveBeenCalledTimes(1);
        expect(app.on).toHaveBeenCalledWith(`animate.${helper.id}`, helper.boundUpdate);

        helper.handleKeyUp({code: "ShiftLeft"} as KeyboardEvent);

        expect(app.on).toHaveBeenCalledTimes(1);

        helper.handleKeyUp({code: "KeyW"} as KeyboardEvent);

        expect(app.on).toHaveBeenCalledTimes(2);
        expect(app.on).toHaveBeenLastCalledWith(`animate.${helper.id}`, null);

        helper.stop();

        expect(removeEventListener).toHaveBeenCalledWith("keydown", helper.boundHandleKeyDown);
        expect(removeEventListener).toHaveBeenCalledWith("keyup", helper.boundHandleKeyUp);
    });

    it("moves the editor camera and target while reusing scratch vectors", () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const helper = new CameraControlsHelper();
        const forwardScratch = helper.forwardScratch;
        const rightScratch = helper.rightScratch;
        const offsetScratch = helper.offsetScratch;
        const targetOffsetScratch = helper.targetOffsetScratch;

        helper.moveState.forward = 1;
        helper.moveState.right = 1;
        helper.update();

        expect(app.editor.camera.position.x).toBeCloseTo(0.2);
        expect(app.editor.camera.position.z).toBeCloseTo(-0.2);
        expect(app.editor.controls.current.controls.target.x).toBeCloseTo(0.2);
        expect(app.editor.controls.current.controls.target.z).toBeCloseTo(-10);
        expect(app.editor.controls.current.controls.update).toHaveBeenCalledTimes(1);
        expect(helper.forwardScratch).toBe(forwardScratch);
        expect(helper.rightScratch).toBe(rightScratch);
        expect(helper.offsetScratch).toBe(offsetScratch);
        expect(helper.targetOffsetScratch).toBe(targetOffsetScratch);
    });
});
