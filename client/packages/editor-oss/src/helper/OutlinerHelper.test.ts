import {afterEach, describe, expect, it, vi} from "vitest";
import * as THREE from "three";

import EventBus from "../behaviors/event/EventBus";
import global from "../global";
import OutlinerHelper from "./OutlinerHelper";

function createApp() {
    return {
        on: vi.fn(),
        call: vi.fn(),
        scene: new THREE.Scene(),
        camera: new THREE.PerspectiveCamera(),
        renderer: {},
        objectOutliner: null,
    };
}

describe("OutlinerHelper", () => {
    const previousApp = global.app;

    afterEach(() => {
        EventBus.instance.reset();
        global.app = previousApp;
        vi.restoreAllMocks();
    });

    it("unsubscribes only its own EventBus outline listeners on stop", () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const helper = new OutlinerHelper();
        const object = new THREE.Object3D();
        const externalListener = vi.fn();

        EventBus.instance.subscribe("objectOutlined", externalListener);
        helper.start();
        helper.stop();
        app.call.mockClear();

        EventBus.instance.send("objectOutlined", object);

        expect(externalListener).toHaveBeenCalledWith("objectOutlined", object);
        expect(app.call).not.toHaveBeenCalled();
    });

    it("clears objectOutliner compatibility state on stop", () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const helper = new OutlinerHelper();

        helper.onSceneLoaded();
        expect(app.objectOutliner).not.toBeNull();

        helper.stop();

        expect(app.objectOutliner).toBeNull();
        expect(app.call).toHaveBeenCalledWith("outlineObjects", helper, []);
    });

    it("keeps BIM selections out of the post-process outline mask", () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const helper = new OutlinerHelper();
        const bimRoot = new THREE.Group();
        const wallMesh = new THREE.Mesh();
        bimRoot.userData.isPlanCadRoot = true;
        wallMesh.userData.isPlanCadGeneratedChild = true;
        bimRoot.add(wallMesh);

        helper.onObjectSelected(bimRoot);
        helper.onObjectOutlined(wallMesh);

        expect(helper.getSelectedObjects()).toEqual([]);
        expect(helper.getOutlinedObjects()).toEqual([]);
        expect(app.call).toHaveBeenLastCalledWith("outlineObjects", helper, []);
    });

    it("still outlines ordinary scene objects alongside skipped BIM selections", () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const helper = new OutlinerHelper();
        const ordinary = new THREE.Mesh();
        const bim = new THREE.Group();
        bim.userData.isPlanCadManaged = true;

        helper.onObjectArraySelected([bim, ordinary]);

        expect(helper.getSelectedObjects()).toEqual([ordinary]);
        expect(helper.getOutlinedObjects()).toEqual([ordinary]);
        expect(app.call).toHaveBeenLastCalledWith("outlineObjects", helper, [ordinary]);
    });
});
