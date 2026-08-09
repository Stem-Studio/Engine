import * as THREE from "three";
import {describe, expect, it, vi} from "vitest";

import {disposePreviewModel} from "./previewModelResources";

describe("disposePreviewModel", () => {
    it("disposes shared preview resources once", () => {
        const texture = new THREE.Texture();
        const material = new THREE.MeshBasicMaterial({map: texture});
        const geometry = new THREE.BoxGeometry();
        const root = new THREE.Group();
        root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
        const textureDispose = vi.spyOn(texture, "dispose");
        const materialDispose = vi.spyOn(material, "dispose");
        const geometryDispose = vi.spyOn(geometry, "dispose");

        disposePreviewModel(root);

        expect(textureDispose).toHaveBeenCalledTimes(1);
        expect(materialDispose).toHaveBeenCalledTimes(1);
        expect(geometryDispose).toHaveBeenCalledTimes(1);
    });

    it("handles deep hierarchies without Three's recursive traversal", () => {
        const traverseSpy = vi.spyOn(THREE.Object3D.prototype, "traverse");
        const root = new THREE.Group() as THREE.Group & {dispose?: () => void};
        root.dispose = vi.fn();
        let parent: THREE.Object3D = root;
        for (let i = 0; i < 12_000; i++) {
            const child = new THREE.Object3D();
            parent.add(child);
            parent = child;
        }
        parent.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()));

        expect(() => disposePreviewModel(root)).not.toThrow();
        expect(traverseSpy).not.toHaveBeenCalled();
        expect(root.dispose).toHaveBeenCalledTimes(1);
    });

    it("preserves preview disposal opt-out", () => {
        const geometry = new THREE.BufferGeometry();
        const geometryDispose = vi.spyOn(geometry, "dispose");
        const root = new THREE.Group();
        root.userData.skipPreviewDispose = true;
        root.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));

        disposePreviewModel(root);

        expect(geometryDispose).not.toHaveBeenCalled();
    });
});
