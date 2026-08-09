
/**
 * Module: MeshSerializer.js
 * Purpose: Contains logic for mesh serializer.
 */


import * as THREE from "three";

import BaseSerializer from "../BaseSerializer";
import Object3DSerializer from "./Object3DSerializer";
import GeometriesSerializer from "../geometry/GeometriesSerializer";
import MaterialsSerializer from "../material/MaterialsSerializer";

function isThenable(value) {
    return value && typeof value.then === "function";
}

/**
 * MeshSerializer
 *
 */
class MeshSerializer extends BaseSerializer {
    defaultObject = new THREE.Mesh();
    toJSON(obj, options = {}) {
        var json = Object3DSerializer.prototype.toJSON.call(this, obj, this.defaultObject);

        // json.drawMode = obj.drawMode;
        json.geometry = new GeometriesSerializer().toJSON(obj.geometry);

        if (options.saveMaterial) {
            json.material = new MaterialsSerializer().toJSON(obj.material);
        } else {
            json.material = null;
        }

        return json;
    }

    fromJSON(json, parent, options) {

        if (parent !== undefined) {
            var obj1 = parent;
            Object3DSerializer.prototype.fromJSON.call(this, json, obj1);
            return obj1;
        }

        if (!json.geometry) {
            console.warn(`MeshSerializer: ${json.name} json.geometry is not defined.`);
            return null;
        }

        // TODO
        // if (!json.material) {
        // console.warn(`MeshSerializer: ${json.name} json.material is not defined.`);
        // return null;
        // }

        const createMesh = geometry => {
            var material = json.material
                ? new MaterialsSerializer().fromJSON(json.material, undefined, options)
                : new THREE.MeshBasicMaterial();

            // Three.js treats an empty material array as no renderable
            // material. Older saves can contain `material: []`; keep those
            // meshes visible instead of silently producing an invisible mesh.
            if (Array.isArray(material) && material.length === 0) {
                material = new THREE.MeshStandardMaterial({color: 0xffffff});
            }

            var obj = new THREE.Mesh(geometry, material);

            Object3DSerializer.prototype.fromJSON.call(this, json, obj, options);

            return obj;
        };

        var geometry = new GeometriesSerializer().fromJSON(json.geometry);

        return isThenable(geometry) ? geometry.then(createMesh) : createMesh(geometry);
    }
}

export default MeshSerializer;
