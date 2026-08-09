import * as THREE from "three";

import BaseSerializer from "../BaseSerializer";
import MaterialSerializer from "./MaterialSerializer";

/**
 * MeshPhongMaterialSerializer
 *
 */
class MeshPhongMaterialSerializer extends BaseSerializer {
    defaultMaterial = new THREE.MeshPhongMaterial();
    toJSON(obj) {
        let json = MaterialSerializer.prototype.toJSON.call(this, obj, this.defaultMaterial);

        json.specular = obj.specular;
        json.shininess = obj.shininess;

        return json;
    }

    fromJSON(json, parent, options) {
        var obj = parent === undefined ? this.defaultMaterial.clone() : parent;

        MaterialSerializer.prototype.fromJSON.call(this, json, obj, options);

        obj.specular = new THREE.Color(json.specular);
        obj.shininess = json.shininess;

        return obj;
    }
}

export default MeshPhongMaterialSerializer;
