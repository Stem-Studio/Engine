import BaseSerializer from "../BaseSerializer";
import BufferGeometrySerializer from "./BufferGeometrySerializer";

let teapotGeometryPromise = null;

function getTeapotGeometry() {
    if (!teapotGeometryPromise) {
        teapotGeometryPromise = import("three/addons/geometries/TeapotGeometry.js")
            .then(({TeapotGeometry}) => TeapotGeometry);
    }

    return teapotGeometryPromise;
}

/**
 * TeapotBufferGeometrySerializer
 *
 */
class TeapotBufferGeometrySerializer extends BaseSerializer {
    defaultGeometry = null;
    toJSON(obj) {
        return BufferGeometrySerializer.prototype.toJSON.call(this, obj, this.defaultGeometry);
    }

    fromJSON(json, parent) {
        if (parent) {
            BufferGeometrySerializer.prototype.fromJSON.call(this, json, parent);
            return parent;
        }

        return getTeapotGeometry().then(TeapotGeometry => {
            const obj = json.parameters ? new TeapotGeometry(
                json.parameters.size,
                json.parameters.segments,
                json.parameters.bottom,
                json.parameters.lid,
                json.parameters.body,
                json.parameters.fitLid,
                json.parameters.blinn,
            ) : new TeapotGeometry();

            BufferGeometrySerializer.prototype.fromJSON.call(this, json, obj);

            return obj;
        });
    }
}

export default TeapotBufferGeometrySerializer;
