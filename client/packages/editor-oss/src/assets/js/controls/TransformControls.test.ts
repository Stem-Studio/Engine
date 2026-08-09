import {Raycaster, Vector3} from "three";
import {describe, expect, it} from "vitest";

import {TransformControlsPlane} from "./TransformControls";

describe("TransformControlsPlane", () => {
    it("stays non-renderable while remaining available for drag raycasts", () => {
        const plane = new TransformControlsPlane({});
        const raycaster = new Raycaster(
            new Vector3(0, 0, 1),
            new Vector3(0, 0, -1),
        );

        expect(plane.visible).toBe(false);
        expect(raycaster.intersectObject(plane).length).toBeGreaterThan(0);

        plane.geometry.dispose();
        const materials = Array.isArray(plane.material) ? plane.material : [plane.material];
        materials.forEach(material => material.dispose());
    });
});
