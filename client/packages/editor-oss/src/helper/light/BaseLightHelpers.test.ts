import {Object3D} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import {ApplicationMode} from "../../EngineRuntime";
import global from "../../global";
import {BaseLightHelpers} from "./BaseLightHelpers";

class TestHelperObject extends Object3D {
    update = vi.fn();
    dispose = vi.fn();
}

class TestLightHelpers extends BaseLightHelpers<TestHelperObject> {
    readonly created: TestHelperObject[] = [];

    protected createHelper(): TestHelperObject {
        const helper = new TestHelperObject();
        this.created.push(helper);
        return helper;
    }

    protected shouldHaveHelper(object: Object3D): boolean {
        return object.userData.shouldHaveHelper !== false;
    }
}

describe("BaseLightHelpers", () => {
    afterEach(() => {
        global.app = null;
        vi.restoreAllMocks();
    });

    it("disposes generated helpers when the helper manager stops", () => {
        const addSelectionHelper = vi.fn();
        const removeSelectionHelper = vi.fn();
        const app = {
            mode: ApplicationMode.EDIT,
            on: vi.fn(),
            editor: {
                addSelectionHelper,
                removeSelectionHelper,
            },
        };
        global.app = app as any;

        const manager = new TestLightHelpers();
        const light = new Object3D();
        manager.start();
        manager.onObjectAdded(light);

        const helper = manager.created[0];
        expect(helper).toBeDefined();
        if (!helper) throw new Error("Light helper was not created");
        expect(addSelectionHelper).toHaveBeenCalledWith(helper);

        manager.stop();

        expect(app.on).toHaveBeenCalledWith(`objectAdded.${manager.id}`, null);
        expect(app.on).toHaveBeenCalledWith(`objectRemoved.${manager.id}`, null);
        expect(app.on).toHaveBeenCalledWith(`collabObjectRemoved.${manager.id}`, null);
        expect(app.on).toHaveBeenCalledWith(`objectChanged.${manager.id}`, null);
        expect(app.on).toHaveBeenCalledWith(`objectUpdated.${manager.id}`, null);
        expect(app.on).toHaveBeenCalledWith(`appModeEntered.${manager.id}`, null);
        expect(removeSelectionHelper).toHaveBeenCalledWith(helper);
        expect(helper.dispose).toHaveBeenCalledTimes(1);

        manager.onObjectRemoved(light);
        expect(helper.dispose).toHaveBeenCalledTimes(1);
    });
});
