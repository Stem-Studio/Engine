import * as THREE from "three";

import BaseSerializer from "../BaseSerializer";
import WebGLShadowMapSerializer from "./WebGLShadowMapSerializer";

/**
 * WebGLRendererSerializer
 *
 */

const DEFAULT_OBJECT = new THREE.WebGLRenderer({preserveDrawingBuffer: true});
const properties = [
    "autoClear",
    "autoClearColor",
    "autoClearDepth",
    "autoClearStencil",
    "clippingPlanes",
    "localClippingEnabled",
    "shadowMap",
    "sortObjects",
    "toneMapping",
    "toneMappingExposure",
];

const legacyIgnoredProperties = new Set([
    "autoUpdateScene",
    "gammaFactor",
    "physicallyCorrectLights",
]);

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

class WebGLRendererSerializer extends BaseSerializer {
    toJSON(obj) {
        const json = BaseSerializer.prototype.toJSON.call(this, obj);

        for (let i = 0; i < properties.length; i++) {
            const prop = properties[i];
            if (prop === "shadowMap") {
                json[prop] = new WebGLShadowMapSerializer().toJSON(obj[prop], DEFAULT_OBJECT.shadowMap);
            } else if (!valuesEqual(obj[prop], DEFAULT_OBJECT[prop])) {
                json[prop] = obj[prop];
            }
        }

        return json;
    }

    fromJSON(json, parent) {
        var obj =
            parent === undefined
                ? new THREE.WebGLRenderer({antialias: json.antialias, preserveDrawingBuffer: true})
                : parent;

        properties.forEach(prop => {
            if (prop === "shadowMap") {
                if (json[prop] !== undefined) {
                    new WebGLShadowMapSerializer().fromJSON(json[prop], obj[prop]);
                }
            } else if (json[prop] !== undefined) {
                obj[prop] = json[prop];
            }
        });

        legacyIgnoredProperties.forEach(prop => {
            if (json[prop] !== undefined) {
                delete obj[prop];
            }
        });

        return obj;
    }
}

export default WebGLRendererSerializer;
