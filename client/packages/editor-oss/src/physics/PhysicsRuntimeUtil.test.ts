import {Object3D} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import {PhysicsRuntimeUtil} from "./PhysicsRuntimeUtil";

afterEach(() => {
    vi.restoreAllMocks();
});

describe("PhysicsRuntimeUtil", () => {
    it("copies JSON-compatible physics config without JSON.stringify", () => {
        const stringifySpy = vi.spyOn(JSON, "stringify");
        const from = new Object3D();
        const to = new Object3D();
        from.userData.physics = {
            enabled: true,
            shape: "btBoxShape",
            anchorOffset: {x: 1, y: 2, z: 3},
            values: [1, undefined, Number.NaN],
            ignored: undefined,
        };

        PhysicsRuntimeUtil.copyPhysicsConfig(from, to);

        expect(stringifySpy).not.toHaveBeenCalled();
        expect(to.userData.physics).toEqual({
            enabled: true,
            shape: "btBoxShape",
            anchorOffset: {x: 1, y: 2, z: 3},
            values: [1, null, null],
        });
        expect(to.userData.physics).not.toBe(from.userData.physics);
        expect(to.userData.physics.anchorOffset).not.toBe(from.userData.physics.anchorOffset);
    });
});
