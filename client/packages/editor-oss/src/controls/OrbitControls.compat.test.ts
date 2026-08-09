import {PerspectiveCamera} from "three";
import {OrbitControls as AddonOrbitControls} from "three/addons/controls/OrbitControls.js";
import {describe, expect, it} from "vitest";

import FreeControls from "./FreeControls";
import {OrbitControls} from "./OrbitControls";

describe("OrbitControls compatibility export", () => {
    it("re-exports the maintained Three addon controls", () => {
        expect(OrbitControls).toBe(AddonOrbitControls);
    });

    it("keeps FreeControls using the local compatibility path", () => {
        const camera = new PerspectiveCamera();
        const element = document.createElement("div");

        const controls = new FreeControls(camera, element);

        expect(controls.controls).toBeInstanceOf(AddonOrbitControls);
        controls.dispose();
    });
});
