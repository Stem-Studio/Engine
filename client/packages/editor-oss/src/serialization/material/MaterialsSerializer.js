
/**
 * Module: MaterialsSerializer.js
 * Purpose: Contains logic for materials serializer.
 */


import * as THREE from "three";

import BaseSerializer from "../BaseSerializer";
import LineBasicMaterialSerializer from "./LineBasicMaterialSerializer";
import LineBasicNodeMaterialSerializer from "./LineBasicNodeMaterialSerializer";
import LineDashedMaterialSerializer from "./LineDashedMaterialSerializer";
import MeshBasicMaterialSerializer from "./MeshBasicMaterialSerializer";
import MeshBasicNodeMaterialSerializer from "./MeshBasicNodeMaterialSerializer";
import MeshDepthMaterialSerializer from "./MeshDepthMaterialSerializer";
import MeshDistanceMaterialSerializer from "./MeshDistanceMaterialSerializer";
import MeshLambertMaterialSerializer from "./MeshLambertMaterialSerializer";
import MeshNormalMaterialSerializer from "./MeshNormalMaterialSerializer";
import MeshPhongMaterialSerializer from "./MeshPhongMaterialSerializer";
import MeshPhysicalMaterialSerializer from "./MeshPhysicalMaterialSerializer";
import MeshPhysicalNodeMaterialSerializer from "./MeshPhysicalNodeMaterialSerializer";
import MeshStandardMaterialSerializer from "./MeshStandardMaterialSerializer";
import MeshStandardNodeMaterialSerializer from "./MeshStandardNodeMaterialSerializer";
import MeshToonMaterialSerializer from "./MeshToonMaterialSerializer";
import PointsMaterialSerializer from "./PointsMaterialSerializer";
import PointsNodeMaterialSerializer from "./PointsNodeMaterialSerializer";
import ShadowMaterialSerializer from "./ShadowMaterialSerializer";
import SpriteMaterialSerializer from "./SpriteMaterialSerializer";
import SpriteNodeMaterialSerializer from "./SpriteNodeMaterialSerializer";

const Serializers = {
    LineBasicMaterial: LineBasicMaterialSerializer,
    LineDashedMaterial: LineDashedMaterialSerializer,
    MeshBasicMaterial: MeshBasicMaterialSerializer,
    MeshDepthMaterial: MeshDepthMaterialSerializer,
    MeshDistanceMaterial: MeshDistanceMaterialSerializer,
    MeshLambertMaterial: MeshLambertMaterialSerializer,
    MeshNormalMaterial: MeshNormalMaterialSerializer,
    MeshPhongMaterial: MeshPhongMaterialSerializer,
    MeshPhysicalMaterial: MeshPhysicalMaterialSerializer,
    MeshStandardMaterial: MeshStandardMaterialSerializer,
    MeshToonMaterial: MeshToonMaterialSerializer,
    PointsMaterial: PointsMaterialSerializer,
    ShadowMaterial: ShadowMaterialSerializer,
    SpriteMaterial: SpriteMaterialSerializer,

    // NodeMaterial variants (WebGPU)
    LineBasicNodeMaterial: LineBasicNodeMaterialSerializer,
    MeshBasicNodeMaterial: MeshBasicNodeMaterialSerializer,
    MeshPhysicalNodeMaterial: MeshPhysicalNodeMaterialSerializer,
    MeshStandardNodeMaterial: MeshStandardNodeMaterialSerializer,
    PointsNodeMaterial: PointsNodeMaterialSerializer,
    SpriteNodeMaterial: SpriteNodeMaterialSerializer,
};

function ensureMaterialType(json, material) {
    if (json && typeof json === "object" && !json.type && material?.type) {
        // Keep the compact default-valued representation, but retain the
        // concrete type so legacy/custom serializers cannot emit an entry
        // that looks empty to inspectors.
        json.type = material.type;
    }
    return json;
}

/**
 * MaterialsSerializer
 *
 */
class MaterialsSerializer extends BaseSerializer {
    createFallbackMaterial() {
        // An empty material slot makes a mesh render nothing (and an empty
        // material array is rejected by some WebGPU paths). Keep the scene
        // usable when an older or partially-written project contains a
        // malformed entry. Quick Build will replace this with its authored
        // kind-specific material during scene repair when metadata exists.
        return new THREE.MeshStandardMaterial({color: 0xffffff});
    }

    serializerForJSON(json) {
        const generator = typeof json?.metadata?.generator === "string"
            ? json.metadata.generator.replace("Serializer", "")
            : typeof json?.type === "string"
                ? json.type
                : "";
        return Serializers[generator];
    }

    toJSON(obj) {
        if (Array.isArray(obj)) {

            var list = [];

            obj.forEach(n => {
                var serializer = n && Serializers[n.type];

                if (!serializer) {
                    // Preserve the slot instead of serializing an empty
                    // array, which would make the mesh disappear after a
                    // reload.
                    list.push(ensureMaterialType(
                        new MeshStandardMaterialSerializer().toJSON(this.createFallbackMaterial()),
                        this.createFallbackMaterial(),
                    ));
                    return;
                }

                list.push(ensureMaterialType(new serializer().toJSON(n), n));
            });

            return list.length > 0
                ? list
                : ensureMaterialType(
                    new MeshStandardMaterialSerializer().toJSON(this.createFallbackMaterial()),
                    this.createFallbackMaterial(),
                );
        } else {

            var serializer = obj && Serializers[obj.type];

            if (!serializer) {
                return ensureMaterialType(
                    new MeshStandardMaterialSerializer().toJSON(this.createFallbackMaterial()),
                    this.createFallbackMaterial(),
                );
            }

            return ensureMaterialType(new serializer().toJSON(obj), obj);
        }
    }

    fromJSON(json, parent, options) {
        if (Array.isArray(json)) {

            var list = [];

            json.forEach(n => {
                var serializer = this.serializerForJSON(n);

                if (serializer === undefined) {
                    list.push(this.createFallbackMaterial());
                    return;
                }

                try {
                    list.push(new serializer().fromJSON(n, parent, options));
                } catch (error) {
                    console.warn("MaterialsSerializer: malformed material entry; using fallback.", error);
                    list.push(this.createFallbackMaterial());
                }
            });

            return list.length > 0 ? list : [this.createFallbackMaterial()];
        } else {
            var serializer = this.serializerForJSON(json);

            if (serializer === undefined) {
                return this.createFallbackMaterial();
            }

            try {
                return new serializer().fromJSON(json, parent, options);
            } catch (error) {
                console.warn("MaterialsSerializer: malformed material entry; using fallback.", error);
                return this.createFallbackMaterial();
            }
        }
    }
}

export default MaterialsSerializer;
