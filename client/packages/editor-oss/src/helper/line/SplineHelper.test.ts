import {Object3D, Scene, Vector3} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import global from "../../global";
import SplineHelper from "./SplineHelper";

function createCurve(points: Vector3[]) {
    const curve = new Object3D();
    curve.userData.type = "CatmullRomCurve";
    curve.userData.points = points;
    return curve;
}

describe("SplineHelper", () => {
    afterEach(() => {
        global.app = null;
        vi.restoreAllMocks();
    });

    it("removes and disposes selected spline helper resources on stop", () => {
        const sceneHelpers = new Scene();
        const app = {
            on: vi.fn(),
            editor: {sceneHelpers},
        };
        global.app = app as any;

        const helper = new SplineHelper();
        const curve = createCurve([new Vector3(1, 0, 0), new Vector3(2, 0, 0)]);

        helper.start();
        helper.onObjectSelected(curve);

        expect(helper.box).toHaveLength(2);
        expect(sceneHelpers.children).toHaveLength(2);

        const geometry = helper.box[0]?.geometry;
        const material = helper.box[0]?.material;
        expect(geometry).toBeDefined();
        expect(material).toBeDefined();
        if (!geometry || !material || Array.isArray(material)) {
            throw new Error("SplineHelper did not create expected shared geometry/material");
        }
        const geometryDispose = vi.spyOn(geometry, "dispose");
        const materialDispose = vi.spyOn(material, "dispose");

        helper.stop();

        expect(app.on).toHaveBeenCalledWith(`objectSelected.${helper.id}`, null);
        expect(app.on).toHaveBeenCalledWith(`objectChanged.${helper.id}`, null);
        expect(helper.box).toHaveLength(0);
        expect(sceneHelpers.children).toHaveLength(0);
        expect(geometryDispose).toHaveBeenCalledTimes(1);
        expect(materialDispose).toHaveBeenCalledTimes(1);

        helper.onCancelSelectLine();
        expect(geometryDispose).toHaveBeenCalledTimes(1);
        expect(materialDispose).toHaveBeenCalledTimes(1);
    });
});
