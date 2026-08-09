import * as THREE from "three";

import BaseSerializer from "../BaseSerializer";

/**
 * BufferGeometrySerializer
 *
 */

const properties = ["groups", "morphAttributes", "name", "parameters", "type", "userData", "uuid"];
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

class BufferGeometrySerializer extends BaseSerializer {
    defaultGeometry = DEFAULT_GEOMETRY;

    toJSON(obj, defaultGeometry) {
        const geometry = defaultGeometry !== undefined ? defaultGeometry : this.defaultGeometry;

        // Use Three.js's built-in toJSON method to properly serialize all geometry data
        // including attributes (position, normal, uv, etc.)
        const json = obj.toJSON();

        // Add our metadata
        json.metadata = this.metadata;

        // For geometries with parameters (primitives), only include if different from default
        for (let i = 0; i < properties.length; i++) {
            const prop = properties[i];
            // If no default geometry available, serialize all properties
            if (!geometry || !valuesEqual(obj[prop], geometry[prop])) {
                if (obj[prop] !== undefined && json[prop] === undefined) {
                    json[prop] = obj[prop];
                }
            }
        }

        return json;
    }

    fromJSON(json, parent) {
        // Use Three.js's built-in BufferGeometryLoader to properly deserialize
        // all geometry data including attributes
        if (parent === undefined) {
            const loader = new THREE.BufferGeometryLoader();
            const obj = loader.parse(json);

            // Apply additional properties
            properties.forEach(prop => {
                if (json[prop] !== undefined) {
                    obj[prop] = json[prop];
                }
            });

            return obj;
        }

        // If parent is provided, use it
        var obj = parent;
        BaseSerializer.prototype.fromJSON.call(this, json, obj);

        properties.forEach(prop => {
            if (json[prop] !== undefined) {
                obj[prop] = json[prop];
            }
        });

        return obj;
    }
}

export default BufferGeometrySerializer;
