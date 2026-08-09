import * as THREE from "three";

import BaseSerializer from "../BaseSerializer";
import MaterialSerializer from "./MaterialSerializer";

/**
 * MeshBasicMaterialSerializer
 *
 */
class MeshBasicMaterialSerializer extends BaseSerializer {
    defaultMaterial = new THREE.MeshBasicMaterial();

    toJSON(obj) {
        return MaterialSerializer.prototype.toJSON.call(this, obj, this.defaultMaterial);
    }

    fromJSON(json, parent, options) {
        var obj = parent === undefined ? this.defaultMaterial.clone() : parent;

        MaterialSerializer.prototype.fromJSON.call(this, json, obj, options);

        return obj;
    }
}

export default MeshBasicMaterialSerializer;
