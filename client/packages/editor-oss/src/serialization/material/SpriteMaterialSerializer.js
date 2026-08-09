import * as THREE from "three";

import BaseSerializer from "../BaseSerializer";
import MaterialSerializer from "./MaterialSerializer";

/**
 * SpriteMaterialSerializer
 *
 */
class SpriteMaterialSerializer extends BaseSerializer {
    defaultMaterial = new THREE.SpriteMaterial();
    toJSON(obj) {
        var json = MaterialSerializer.prototype.toJSON.call(this, obj, this.defaultMaterial);
        json.isSpriteMaterial = true;
        return json;
    }

    fromJSON(json, parent, options) {
        var obj = parent === undefined ? this.defaultMaterial.clone() : parent;

        MaterialSerializer.prototype.fromJSON.call(this, json, obj, options);

        return obj;
    }
}

export default SpriteMaterialSerializer;
