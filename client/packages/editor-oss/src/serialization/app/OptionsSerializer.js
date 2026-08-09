import BaseSerializer from "../BaseSerializer";

/**
 * OptionsSerializer
 *
 */

const fieldsToOmit = new Set(["_id", "metadata", "server", "isPlayModeOnly", "gammaFactor"]);
const retiredRendererFields = new Set(["gammaFactor"]);

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

class OptionsSerializer extends BaseSerializer {
    toJSON(obj) {
        const json = BaseSerializer.prototype.toJSON.call(this, obj);
        const keys = Object.keys(obj);
        const defaults = obj.defaultValues;

        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (key === "defaultValues" || retiredRendererFields.has(key)) {
                continue;
            }

            if (key === "server") {
                // Always serialize server config.
                json[key] = obj[key];
            } else if (!defaults || !valuesEqual(obj[key], defaults[key])) {
                json[key] = obj[key];
            }
        }

        return json;
    }

    fromJSON(json) {
        const obj = {};
        const keys = Object.keys(json);

        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (!fieldsToOmit.has(key)) {
                obj[key] = json[key];
            }
        }

        return obj;
    }
}

export default OptionsSerializer;
