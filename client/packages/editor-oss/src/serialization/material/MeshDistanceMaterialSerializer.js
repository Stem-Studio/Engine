import * as THREE from "three";

import BaseSerializer from "../BaseSerializer";
import MaterialSerializer from "./MaterialSerializer";

/**
 * MeshDistanceMaterialSerializer
 *
 */
class MeshDistanceMaterialSerializer extends BaseSerializer {
    defaultMaterial = new THREE.MeshDistanceMaterial();
    toJSON(obj) {
        return MaterialSerializer.prototype.toJSON.call(this, obj, this.defaultMaterial);
    }

    fromJSON(json, parent, options) {
        var obj = parent === undefined ? this.defaultMaterial.clone() : parent;

        MaterialSerializer.prototype.fromJSON.call(this, json, obj, options);

        return obj;
    }
}

export default MeshDistanceMaterialSerializer;
