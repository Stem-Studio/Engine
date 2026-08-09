import {PointsNodeMaterial} from "three/webgpu";

import BaseSerializer from "../BaseSerializer";
import MaterialSerializer from "./MaterialSerializer";

/**
 * PointsNodeMaterialSerializer
 *
 */
class PointsNodeMaterialSerializer extends BaseSerializer {
    defaultMaterial = new PointsNodeMaterial();
    toJSON(obj) {
        return MaterialSerializer.prototype.toJSON.call(this, obj, this.defaultMaterial);
    }

    fromJSON(json, parent, options) {
        var obj = parent === undefined ? this.defaultMaterial.clone() : parent;

        MaterialSerializer.prototype.fromJSON.call(this, json, obj, options);

        return obj;
    }
}

export default PointsNodeMaterialSerializer;
