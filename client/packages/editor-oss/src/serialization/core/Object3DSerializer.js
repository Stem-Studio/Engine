import * as THREE from "three";
import {CSS3DObject, CSS3DSprite} from "three/addons/renderers/CSS3DRenderer.js";

import {getAssetResolutionContext} from "@web-shared/asset-management/AssetResolutionContext";
import {applyMaterialSettingsToObject} from "@stem/editor-oss/editor/assets/v2/materials/materialUtils";
import global from "@web-shared/global";
import {PhysicsUtil} from "@web-shared/physics/PhysicsUtil";
import BaseSerializer from "../BaseSerializer";

/**
 * Object3DSerializer
 *
 */
const properties = [
    "castShadow",
    "frustumCulled",
    "matrixAutoUpdate",
    "name",
    "parent",
    "position",
    "quaternion",
    "receiveShadow",
    "renderOrder",
    "rotation",
    "scale",
    "type",
    "up",
    "uuid",
    "visible",
    "isCSS3DObject",
    "isCSS3DSprite",
];

const propertiesToOmit = [
    "isCSS3DObject",
    "isCSS3DSprite",
    "userData",
    "animations",
    "element",
    // stored in old json
    "layers",
    "matrixWorldNeedsUpdate",
    "modelViewMatrix",
];

const DEFAULT_OBJECT_3D = new THREE.Object3D();
const propertiesToOmitSet = new Set(propertiesToOmit);
const copyProperties = new Set(["position", "quaternion", "scale", "up"]);

function hasEquals(value) {
    return value && typeof value.equals === "function";
}

function isDefaultPropertyValue(obj, defaultObject, key) {
    const value = obj[key];
    const defaultValue = defaultObject[key];

    if (value === defaultValue) {
        return true;
    }

    if (hasEquals(value)) {
        return value.equals(defaultValue);
    }

    return false;
}

class Object3DSerializer extends BaseSerializer {
    toJSON(obj, defaultObject) {
        const object3D = defaultObject ? defaultObject : DEFAULT_OBJECT_3D;
        const json = BaseSerializer.prototype.toJSON.call(this, obj);

        for (let i = 0; i < properties.length; i++) {
            const key = properties[i];
            if (key === "parent" && obj.parent) {
                json[key] = obj.parent.uuid;
            } else if (isDefaultPropertyValue(obj, object3D, key)) {
                delete json[key];
            } else if (key === "quaternion") {
                json[key] = {x: obj.quaternion.x, y: obj.quaternion.y, z: obj.quaternion.z, w: obj.quaternion.w};
            } else if (key === "rotation") {
                json[key] = {x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z, order: obj.rotation.order};
            } else {
                json[key] = obj[key];
            }
        }

        if (obj.element) {
            json.element = obj.element.outerHTML;
        }

        if (Object.keys(obj.userData).length > 0) {
            json.userData = {...obj.userData};
            delete json.userData?.helper;
            delete json.userData?.animation;
            delete json.userData?.isTemplateVariant;
            if (json.userData?.planCad?.schema === "stem.planCad.v1") {
                json.userData.planCad = {...json.userData.planCad};
                delete json.userData.planCad.selectedNodeId;
            }
            if (obj instanceof THREE.Camera) {
                delete json.userData?.behaviors;
                delete json.userData?.characterOptions;
                delete json.userData?.cameraData?.characterOptions;
            }
        }

        if (PhysicsUtil.isPhysicsEnabled(obj)) {
            PhysicsUtil.updateShapeOffsetAndScale(obj);
        }

        return json;
    }

    fromJSON(json, parent, options = {}) {
        const revertUuid = options.revertUuid !== false;
        let element;
        let div = json.element ? document.createElement("div") : null;

        if (div) {
            element = new DOMParser().parseFromString(json.element, "text/xml").firstElementChild;
            if (element.childNodes.length === 1) {
                div.innerHTML = element.innerHTML;
            } else {
                div.innerHTML = element;
            }
        }
        let obj;

        if (json.isCSS3DSprite) {
            obj = new CSS3DSprite(div);
        } else if (json.isCSS3DObject) {
            obj = new CSS3DObject(div);
        } else {
            obj = parent === undefined ? new THREE.Object3D() : parent;
        }

        BaseSerializer.prototype.fromJSON.call(this, json, obj);

        for (let i = 0; i < properties.length; i++) {
            const key = properties[i];
            if (propertiesToOmitSet.has(key)) {
                continue;
            } else if (copyProperties.has(key) && json[key]) {
                obj[key].copy(json[key]);
            } else if (key === "rotation" && json[key]) {
                obj[key].set(json[key].x, json[key].y, json[key].z, json[key].order);
            } else if (key === "parent" && json[key]) {
                obj.parentUuid = json[key];
            } else if ((key !== "uuid" || revertUuid) && json[key] !== undefined) {
                obj[key] = json[key];
            }
        }

        Object.assign(obj.userData, json.userData);

        if (obj.userData.materialSettings) {
            const context = options.assetResolutionContext ?? (global.app?.editor?.scene ? getAssetResolutionContext(global.app.editor.scene) : undefined);
            applyMaterialSettingsToObject(obj, obj.userData.materialSettings, context);
        }

        return obj;
    }
}

export default Object3DSerializer;
