import {afterEach, describe, expect, it, vi} from "vitest";
import {Scene} from "three";

import global from "../global";
import GridHelper from "./GridHelper";

function createApp() {
    return {
        on: vi.fn(),
        editor: {
            scene: new Scene(),
            sceneHelpers: new Scene(),
        },
    };
}

describe("GridHelper", () => {
    const previousApp = global.app;

    afterEach(() => {
        global.app = previousApp;
        vi.restoreAllMocks();
    });

    it("disposes the tracked infinite grid material when the grid is rebuilt", () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const helper = new GridHelper();

        helper.enableInfiniteGrid();
        const firstMaterial = (helper as never as {infiniteGridMaterial: {dispose: () => void}}).infiniteGridMaterial;
        const dispose = vi.spyOn(firstMaterial, "dispose");

        helper.enableInfiniteGrid();

        expect(dispose).toHaveBeenCalledTimes(1);
    });

    it("keeps the infinite grid out of dynamic scene batching", () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const helper = new GridHelper();

        helper.enableInfiniteGrid();

        const plane = (helper as never as {
            infiniteGridPlane: {
                material: {
                    depthWrite: boolean;
                    depthTest: boolean;
                    polygonOffset: boolean;
                    polygonOffsetFactor: number;
                    polygonOffsetUnits: number;
                    opacityNode: unknown;
                };
                userData: Record<string, unknown>;
            };
        }).infiniteGridPlane;

        expect(plane.material.depthWrite).toBe(false);
        expect(plane.material.depthTest).toBe(true);
        expect(plane.material.polygonOffset).toBe(true);
        expect(plane.material.polygonOffsetFactor).toBe(-1);
        expect(plane.material.polygonOffsetUnits).toBe(-1);
        expect(plane.material.opacityNode).toBeDefined();
        expect(plane.userData.isBatchable).toBe(false);
    });
});
