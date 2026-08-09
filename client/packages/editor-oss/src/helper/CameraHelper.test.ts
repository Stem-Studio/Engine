import {PerspectiveCamera, Scene} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import global from "../global";
import CameraHelper from "./CameraHelper";

describe("CameraHelper", () => {
    afterEach(() => {
        global.app = null;
        vi.restoreAllMocks();
    });

    it("unsubscribes storage changes and disposes the Three helper on stop", () => {
        const sceneHelpers = new Scene();
        const app = {
            on: vi.fn(),
            storage: {showCamera: true},
            editor: {
                camera: new PerspectiveCamera(),
                sceneHelpers,
            },
        };
        global.app = app as any;

        const helper = new CameraHelper();
        helper.start();

        expect(app.on).toHaveBeenCalledWith(`storageChanged.${helper.id}`, expect.any(Function));
        expect(sceneHelpers.children).toContain(helper.helper);

        const threeHelper = helper.helper;
        expect(threeHelper).toBeDefined();
        if (!threeHelper) throw new Error("CameraHelper did not create a Three helper");
        const dispose = vi.spyOn(threeHelper, "dispose");

        helper.stop();

        expect(app.on).toHaveBeenCalledWith(`storageChanged.${helper.id}`, null);
        expect(app.on).not.toHaveBeenCalledWith(`appStarted.${helper.id}`, null);
        expect(sceneHelpers.children).not.toContain(threeHelper);
        expect(dispose).toHaveBeenCalledTimes(1);
        expect(helper.helper).toBeUndefined();
    });
});
