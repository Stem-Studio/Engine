import * as THREE from "three";

import BaseSerializer from "../BaseSerializer";
import MaterialSerializer from "./MaterialSerializer";

/**
 * ShadowMaterialSerializer
 *
 */
class ShadowMaterialSerializer extends BaseSerializer {
    defaultMaterial = new THREE.ShadowMaterial();
    toJSON(obj) {
        return MaterialSerializer.prototype.toJSON.call(this, obj, this.defaultMaterial);
    }

    fromJSON(json, parent, options) {
        var obj = parent === undefined ? this.defaultMaterial.clone() : parent;

        MaterialSerializer.prototype.fromJSON.call(this, json, obj, options);

        return obj;
    }
}

export default ShadowMaterialSerializer;
