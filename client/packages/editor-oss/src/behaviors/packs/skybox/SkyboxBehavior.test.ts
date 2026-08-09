import {Group, Mesh, MeshBasicMaterial, Object3D, SphereGeometry} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import SkyboxBehavior from "./SkyboxBehavior";

function createBehavior(target: Object3D): SkyboxBehavior {
    return new SkyboxBehavior(target, "skybox", {
        gameObject: {} as any,
        erth: {} as any,
    });
}

function addDeepChain(root: Object3D, depth = 12_000): Object3D {
    let cursor = root;
    for (let i = 0; i < depth; i++) {
        const child = new Object3D();
        cursor.add(child);
        cursor = child;
    }
    return cursor;
}

describe("SkyboxBehavior", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("configures deep skybox hierarchies without recursive traversal", () => {
        const root = new Group();
        root.userData.physics = {enabled: true};
        const leaf = addDeepChain(root);
        const material = new MeshBasicMaterial();
        const mesh = new Mesh(new SphereGeometry(1, 8, 4), material);
        leaf.add(mesh);
        const traverse = vi.spyOn(root, "traverse");
        const behavior = createBehavior(root);

        behavior.onEditorAdded();

        expect(root.userData.physics.enabled).toBe(false);
        expect(mesh.castShadow).toBe(false);
        expect(mesh.receiveShadow).toBe(false);
        expect(material.transparent).toBe(true);
        expect(traverse).not.toHaveBeenCalled();
    });
});
