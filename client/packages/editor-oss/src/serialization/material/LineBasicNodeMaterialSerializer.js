import {LineBasicNodeMaterial} from "three/webgpu";

import BaseSerializer from "../BaseSerializer";
import MaterialSerializer from "./MaterialSerializer";

/**
 * LineBasicNodeMaterialSerializer
 *
 */
class LineBasicNodeMaterialSerializer extends BaseSerializer {
    defaultMaterial = new LineBasicNodeMaterial();
    toJSON(obj) {
        return MaterialSerializer.prototype.toJSON.call(this, obj, this.defaultMaterial);
    }

    fromJSON(json, parent, options) {
        var obj = parent === undefined ? this.defaultMaterial.clone() : parent;

        MaterialSerializer.prototype.fromJSON.call(this, json, obj, options);

        return obj;
    }
}

export default LineBasicNodeMaterialSerializer;
