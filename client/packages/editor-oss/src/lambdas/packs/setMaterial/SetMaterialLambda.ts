import { Color, Material, Mesh, Object3D } from "three";

import { LambdaBase } from "../../LambdaBase";
import {traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";

type SetMaterialData = {
    color?: string;
    emissive?: string;
    opacity?: number;
    includeChildren?: boolean;
};

export default class SetMaterialLambda extends LambdaBase {
    private applyMaterial(material: Material, data: SetMaterialData): void {
        const anyMaterial = material as Material & {
            color?: Color;
            emissive?: Color;
        };
        if (data.color && anyMaterial.color) {
            anyMaterial.color.set(data.color);
        }
        if (data.emissive && anyMaterial.emissive) {
            anyMaterial.emissive.set(data.emissive);
        }

        if (data.opacity !== undefined) {
            const opacity = Math.max(0, Math.min(1, Number(data.opacity)));
            anyMaterial.opacity = opacity;
            anyMaterial.transparent = opacity < 1;
        }

        anyMaterial.needsUpdate = true;
    }

    private applyToObject(target: Object3D, data: SetMaterialData): void {
        const mesh = target as Mesh;
        if (!mesh.isMesh || !mesh.material) {
            return;
        }

        if (Array.isArray(mesh.material)) {
            mesh.material.forEach(mat => this.applyMaterial(mat, data));
            return;
        }

        this.applyMaterial(mesh.material, data);
    }

    update(deltaTime: number = 0.016): void {
        this.processObjects(deltaTime, (object, data) => {
            const cfg = data as SetMaterialData;
            const includeChildren = cfg.includeChildren !== false;

            this.applyToObject(object, cfg);
            if (includeChildren) {
                traverseObjectDepthFirst(object, child => this.applyToObject(child, cfg), {includeRoot: false});
            }
        });
    }
}
