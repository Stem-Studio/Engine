import {BoxGeometry, DirectionalLight, Group, Mesh, MeshBasicMaterial, Object3D, Scene} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import ShadowUtils from "./ShadowUtils";

function addDeepChain(root: Object3D, depth = 12_000): Object3D {
    let cursor = root;
    for (let i = 0; i < depth; i++) {
        const child = new Object3D();
        cursor.add(child);
        cursor = child;
    }
    return cursor;
}

describe("ShadowUtils", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("finds shadow-casting lights in deep scenes without recursive traversal", () => {
        const scene = new Scene();
        const leaf = addDeepChain(scene);
        const light = new DirectionalLight();
        light.castShadow = true;
        leaf.add(light);

        const traverseSpy = vi.spyOn(scene, "traverse");
        const lights = ShadowUtils.checkShadowCastingLights(scene);

        expect(lights).toEqual([light]);
        expect(traverseSpy).not.toHaveBeenCalled();
    });

    it("applies shadow and fog settings to deep groups without recursive traversal", () => {
        const root = new Group();
        const leaf = addDeepChain(root);
        const material = new MeshBasicMaterial();
        const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
        leaf.add(mesh);

        const traverseSpy = vi.spyOn(root, "traverse");

        expect(() => ShadowUtils.applyCastShadow(root, true, false)).not.toThrow();
        expect(() => ShadowUtils.applyReceiveShadow(root, true, false)).not.toThrow();
        expect(() => ShadowUtils.applyReceiveFog(root, false, false)).not.toThrow();

        expect(mesh.castShadow).toBe(true);
        expect(mesh.receiveShadow).toBe(true);
        expect(material.fog).toBe(false);
        expect(traverseSpy).not.toHaveBeenCalled();
    });

    it("reads descendant fog state from deep Object3D roots without recursive traversal", () => {
        const root = new Object3D();
        const leaf = addDeepChain(root);
        const material = new MeshBasicMaterial() as MeshBasicMaterial & {fog?: boolean};
        material.fog = false;
        leaf.add(new Mesh(new BoxGeometry(1, 1, 1), material));

        const traverseSpy = vi.spyOn(root, "traverse");

        expect(ShadowUtils.isReceiveFogEnabled(root)).toBe(false);
        expect(traverseSpy).not.toHaveBeenCalled();
    });
});
