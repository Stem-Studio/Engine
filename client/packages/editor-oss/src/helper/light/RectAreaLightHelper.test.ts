import {Mesh, MeshBasicMaterial, Raycaster, RectAreaLight, Vector3} from "three";
import {describe, expect, it} from "vitest";

import RectAreaLightHelper from "./RectAreaLightHelper";

describe("RectAreaLightHelper", () => {
    it("keeps the picker non-rendering while preserving light raycasts", () => {
        const light = new RectAreaLight(0xffffff, 1, 2, 2);
        const helper = new RectAreaLightHelper(light);
        const picker = helper.children[0] as Mesh;
        const material = picker.material as MeshBasicMaterial;

        expect(material.opacity).toBe(0);
        expect(material.colorWrite).toBe(false);
        expect(material.depthWrite).toBe(false);

        helper.updateMatrixWorld(true);
        const raycaster = new Raycaster(new Vector3(0, 0, -2), new Vector3(0, 0, 1));
        const intersects: Array<{object: unknown}> = [];

        helper.raycast(raycaster, intersects);

        expect(intersects).toHaveLength(1);
        expect(intersects[0]?.object).toBe(light);

        helper.dispose();
    });
});
