import * as THREE from "three";

import BaseSerializer from "../BaseSerializer";

/**
 * GeometrySerializer
 *
 */
const properties = [
    "type",
    "boundingBox",
    "boundingSphere",
    "colors",
    "colorsNeedUpdate",
    "faces",
    "faceVertexUvs",
    "groupsNeedUpdate",
    "isGeometry",
    "lineDistances",
    "lineDistancesNeedUpdate",
    "morphTargets",
    "morphNormals",
    "name",
    "normalsNeedUpdate",
    "parameters",
    "skinWeights",
    "skinIndices",
    "uuid",
    "vertices",
    "verticesNeedUpdate",
    "elementsNeedUpdate",
    "uvsNeedUpdate",
    "normalsNeedUpdate",
];
const DEFAULT_GEOMETRY = new THREE.BufferGeometry();

function hasEquals(value) {
    return value && typeof value.equals === "function";
}

function isPlainObject(value) {
    return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

function valuesEqual(value, defaultValue) {
    if (value === defaultValue) {
        return true;
    }

    if (defaultValue !== undefined && defaultValue !== null && hasEquals(value)) {
        return value.equals(defaultValue);
    }

    if (Array.isArray(value) && Array.isArray(defaultValue)) {
        if (value.length !== defaultValue.length) {
            return false;
        }
        for (let i = 0; i < value.length; i++) {
            if (!valuesEqual(value[i], defaultValue[i])) {
                return false;
            }
        }
        return true;
    }

    if (isPlainObject(value) && isPlainObject(defaultValue)) {
        const keys = Object.keys(value);
        const defaultKeys = Object.keys(defaultValue);
        if (keys.length !== defaultKeys.length) {
            return false;
        }
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (!Object.prototype.hasOwnProperty.call(defaultValue, key) || !valuesEqual(value[key], defaultValue[key])) {
                return false;
            }
        }
        return true;
    }

    return false;
}

class GeometrySerializer extends BaseSerializer {
    toJSON(obj, defaultGeometry) {
        const geometry = defaultGeometry ? defaultGeometry : DEFAULT_GEOMETRY;
        const json = BaseSerializer.prototype.toJSON.call(this, obj);

        for (let i = 0; i < properties.length; i++) {
            const prop = properties[i];
            if (!valuesEqual(obj[prop], geometry[prop])) {
                json[prop] = obj[prop];
            }
        }

        return json;
    }

    fromJSON(json, parent) {
        var obj = parent === undefined ? new THREE.BufferGeometry() : parent;

        BaseSerializer.prototype.fromJSON.call(this, obj);

        properties.forEach(prop => {
            if (json[prop] !== undefined) {
                obj[prop] = json[prop];
            }
        });

        return obj;
    }
}

export default GeometrySerializer;
