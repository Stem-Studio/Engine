import {afterEach, describe, expect, it, vi} from "vitest";
import * as THREE from "three";

import global from "../global";
import HoverHelper from "./HoverHelper";

function createApp() {
    return {
        storage: {
            hoverEnabled: true,
            hoveredColor: "#ffff00",
        },
        on: vi.fn(),
        call: vi.fn(),
    };
}

describe("HoverHelper", () => {
    const previousApp = global.app;

    afterEach(() => {
        global.app = previousApp;
        vi.restoreAllMocks();
    });

    it("does not subscribe an empty afterRender hook", () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const helper = new HoverHelper();

        helper.start();

        expect(app.on).toHaveBeenCalledWith(`gpuPick.${helper.id}`, helper.onGpuPick);
        expect(app.on).toHaveBeenCalledWith(`objectRemoved.${helper.id}`, helper.onObjectRemoved);
        expect(app.on).toHaveBeenCalledWith(`storageChanged.${helper.id}`, helper.onStorageChanged);
        expect(app.on).toHaveBeenCalledWith(`objectHovered.${helper.id}`, helper.onObjectHovered);
        expect(app.on).not.toHaveBeenCalledWith(`afterRender.${helper.id}`, expect.any(Function));

        helper.stop();

        expect(app.on).toHaveBeenCalledWith(`gpuPick.${helper.id}`, null);
        expect(app.on).toHaveBeenCalledWith(`objectRemoved.${helper.id}`, null);
        expect(app.on).toHaveBeenCalledWith(`storageChanged.${helper.id}`, null);
        expect(app.on).toHaveBeenCalledWith(`objectHovered.${helper.id}`, null);
        expect(app.on).not.toHaveBeenCalledWith(`afterRender.${helper.id}`, null);
    });

    it("outlines picked objects and unoutlines when hover clears", () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const helper = new HoverHelper();
        const object = new THREE.Object3D();

        helper.onGpuPick({object});
        helper.onGpuPick({object});
        helper.onGpuPick({object: null});

        expect(app.call).toHaveBeenCalledTimes(2);
        expect(app.call).toHaveBeenNthCalledWith(1, "objectOutlined", helper, object);
        expect(app.call).toHaveBeenNthCalledWith(2, "objectUnoutlined", helper, object);
    });

    it("unoutlines the previous object when hover switches directly", () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const helper = new HoverHelper();
        const first = new THREE.Object3D();
        const second = new THREE.Object3D();

        helper.onGpuPick({object: first});
        helper.onGpuPick({object: second});

        expect(app.call).toHaveBeenCalledTimes(3);
        expect(app.call).toHaveBeenNthCalledWith(1, "objectOutlined", helper, first);
        expect(app.call).toHaveBeenNthCalledWith(2, "objectUnoutlined", helper, first);
        expect(app.call).toHaveBeenNthCalledWith(3, "objectOutlined", helper, second);
        expect(helper.hoveredObject).toBe(second);
    });

    it("clears hover outlines when hover is disabled or the helper stops", () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const helper = new HoverHelper();
        const first = new THREE.Object3D();
        const second = new THREE.Object3D();

        helper.onGpuPick({object: first});
        helper.onStorageChanged("hoverEnabled", false);
        helper.onGpuPick({object: second});
        helper.stop();

        expect(app.call).toHaveBeenCalledTimes(2);
        expect(app.call).toHaveBeenNthCalledWith(1, "objectOutlined", helper, first);
        expect(app.call).toHaveBeenNthCalledWith(2, "objectUnoutlined", helper, first);
        expect(helper.hoveredObject).toBeNull();
    });

    it("ignores text objects and clears removed hovered objects", () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const helper = new HoverHelper();
        const object = new THREE.Object3D();
        const text = new THREE.Object3D();
        text.userData.type = "text";

        helper.onGpuPick({object: text});
        helper.onObjectHovered(object);
        helper.onObjectRemoved(object);

        expect(app.call).toHaveBeenCalledTimes(2);
        expect(app.call).toHaveBeenNthCalledWith(1, "objectOutlined", helper, object);
        expect(app.call).toHaveBeenNthCalledWith(2, "objectUnoutlined", helper, object);
        expect(helper.hoveredObject).toBeNull();
    });

    it("tracks hover storage settings", () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const helper = new HoverHelper();

        helper.onStorageChanged("hoverEnabled", false);
        helper.onStorageChanged("hoveredColor", "#00ff00");

        expect(helper.hoverEnabled).toBe(false);
        expect(helper.hoveredColor).toBe("#00ff00");
    });
});
