import {Mesh, Object3D, Texture, type BufferGeometry, type Material} from "three";

import {traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";

export function disposePreviewModel(model: Object3D): void {
    if (model.userData?.skipPreviewDispose) return;

    const geometries = new Set<BufferGeometry>();
    const materials = new Set<Material>();
    const textures = new Set<Texture>();

    traverseObjectDepthFirst(model, child => {
        if (!(child instanceof Mesh)) return;
        if (child.geometry) geometries.add(child.geometry);

        const meshMaterials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of meshMaterials) {
            if (!material || materials.has(material)) continue;
            materials.add(material);
            for (const value of Object.values(material)) {
                if (value instanceof Texture) textures.add(value);
            }
        }
    });

    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();

    const disposable = model as Object3D & {dispose?: () => void};
    disposable.dispose?.();
}
