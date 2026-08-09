import * as THREE from "three";

import BaseSerializer from "../BaseSerializer";
import TexturesSerializer from "../texture/TexturesSerializer";

/**
 * MaterialSerializer
 *
 */

const properties = [
    "alphaTest",
    "aoMapIntensity",
    "blendDst",
    "blendDstAlpha",
    "blendEquation",
    "blendEquationAlpha",
    "blendSrc",
    "blendSrcAlpha",
    "blending",
    "bumpScale",
    "clipIntersection",
    "clipShadow",
    "clippingPlanes",
    "combine",
    "color",
    "colorWrite",
    "depthFunc",
    "depthTest",
    "depthWrite",
    "displacementBias",
    "displacementScale",
    "dithering",
    "emissive",
    "emissiveIntensity",
    "envMapIntensity",
    "envMapRotation",
    "isMeshBasicMaterial",
    "isMeshDepthMaterial",
    "isMeshDistanceMaterial",
    "isMeshLambertMaterial",
    "isMeshMatcapMaterial",
    "isMeshNormalMaterial",
    "isMeshPhongMaterial",
    "isMeshPhysicalMaterial",
    "isMeshStandardMaterial",
    "isPointsMaterial",
    "isShadowMaterial",
    "isSpriteMaterial",
    "flatShading",
    "fog",
    "lightMapIntensity",
    "lights",
    "linewidth",
    "metalness",
    "morphNormals",
    "morphTargets",
    "name",
    "normalScale",
    "opacity",
    "polygonOffset",
    "polygonOffsetFactor",
    "polygonOffsetUnits",
    "precision",
    "premultipliedAlpha",
    "refractionRatio",
    "reflectivity",
    "roughness",
    "shadowSide",
    "side",
    "skinning",
    "transparent",
    "type",
    "userData",
    "uuid",
    "vertexColors",
    "visible",
    "wireframe",
    "wireframeLinecap",
    "wireframeLinejoin",
    "wireframeLinewidth",
];

const textures = [
    "alphaMap",
    "aoMap",
    "bumpMap",
    "displacementMap",
    "emissiveMap",
    "envMap",
    "lightMap",
    "map",
    "metalnessMap",
    "normalMap",
    "roughnessMap",
    "specularMap",
];

const DEFAULT_MATERIAL = new THREE.Material();
const allProperties = [...properties, ...textures];
const textureProperties = new Set(textures);
const srgbTextureProperties = new Set(["map", "emissiveMap", "specularMap"]);

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

class MaterialSerializer extends BaseSerializer {
    toJSON(obj, defaultMaterial) {
        const material = defaultMaterial ? defaultMaterial : DEFAULT_MATERIAL;
        const json = BaseSerializer.prototype.toJSON.call(this, obj);

        // Keep the compact default-property omission, but always identify the
        // concrete material. Metadata alone is enough for the loader, yet it
        // looks like an empty entry to inspectors and external tooling.
        if (!json.type && obj?.type) {
            json.type = obj.type;
        }

        for (let i = 0; i < allProperties.length; i++) {
            const key = allProperties[i];
            if (obj[key] instanceof THREE.Color) {
                json[key] = obj[key].getHex();
            } else if (obj[key] instanceof THREE.Texture) {
                json[key] = new TexturesSerializer().toJSON(obj[key]);
            } else if (obj[key] instanceof THREE.Euler) {
                json[key] = {x: obj[key].x, y: obj[key].y, z: obj[key].z, order: obj[key].order};
            } else if (obj[key] === undefined) {
                continue; // Skip undefined properties
            } else if (!valuesEqual(obj[key], material[key])) {
                json[key] = obj[key];
            }
        }

        // A default-valued material is intentionally compact, but a payload
        // containing only serializer metadata/uuid is indistinguishable from
        // an empty material entry to project inspectors and older loaders.
        // Preserve the small core of its authored appearance in that case.
        const payloadKeys = Object.keys(json).filter(key => key !== "metadata" && key !== "type" && key !== "uuid");
        const coreAppearanceKeys = new Set([
            "color",
            "emissive",
            "roughness",
            "metalness",
            "opacity",
            "transparent",
            "envMapRotation",
        ]);
        if (payloadKeys.length === 0 || payloadKeys.every(key => coreAppearanceKeys.has(key))) {
            if (obj.color instanceof THREE.Color) json.color = obj.color.getHex();
            if (obj.emissive instanceof THREE.Color) json.emissive = obj.emissive.getHex();
            for (const key of ["roughness", "metalness"]) {
                if (obj[key] !== undefined) json[key] = obj[key];
            }
        }

        return json;
    }

    fromJSON(json, parent, options) {
        var obj = parent === undefined ? new THREE.Material() : parent;

        // Track pending async texture loads so we can batch needsUpdate into a
        // single shader recompilation instead of one per texture (up to 12x fewer).
        let pendingTextureLoads = 0;

        Object.keys(json).forEach(key => {
            if (key === "metadata") return;

            // TODO: consider using default fromJSON
            if (key === "color" || key === "emissive" || key === "specular") {
                obj[key] = new THREE.Color(json[key]);
            } else if (key === "envMapRotation") {
                obj[key] = new THREE.Euler(json[key].x, json[key].y, json[key].z, json[key].order);
            } else if (key === "normalScale") {
                obj[key] = new THREE.Vector2(json[key].x, json[key].y);
            } else if (key === "clippingPlanes" && json[key]) {
                obj[key] = json[key].map(plane => new THREE.Plane(new THREE.Vector3(plane.normal.x, plane.normal.y, plane.normal.z), plane.constant));
            } else if (textureProperties.has(key) && json[key]) {
                // NOTE: there is a bug in WebGPU backend of three.js that causes failure when
                // we try to update a texture that changes its size. So we create a clone of the texture
                // and reassign it to the material to avoid the issue.
                pendingTextureLoads++;
                const textureKey = key;
                /**
                 *
                 * @param texture
                 */
                function onload(texture) {
                    obj[textureKey] = texture;
                    if (srgbTextureProperties.has(textureKey)) {
                        obj[textureKey].colorSpace = THREE.SRGBColorSpace;
                    }
                    // Batch: only trigger shader recompilation when the last
                    // texture for this material finishes loading.
                    pendingTextureLoads--;
                    if (pendingTextureLoads <= 0) {
                        obj.needsUpdate = true;
                    }
                }
                obj[key] = new TexturesSerializer().fromJSON(json[key], undefined, { ...options, onload });

                if (srgbTextureProperties.has(key)) {
                    obj[key].colorSpace = THREE.SRGBColorSpace;
                }
            } else {
                obj[key] = json[key];
            }
        });

        return obj;
    }
}

export default MaterialSerializer;
