import { Object3D } from 'three';

import EngineRuntime from "@stem/editor-oss/EngineRuntime";
import {AssetResolutionContext, getAssetResolutionContext} from "@stem/editor-oss/asset-management/AssetResolutionContext";
import { applyMaterialSettingsToObject } from '@stem/editor-oss/editor/assets/v2/materials/materialUtils';
import global from "@stem/editor-oss/global";
import { SerializedObject3D } from '../schema/Object3DSchema';
import {traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";

export const applyToObject3d = (object: Object3D, json: SerializedObject3D, context?: AssetResolutionContext | null) => {
    (object as Object3D & { parentUuid?: string }).parentUuid = json.parent;

    if (json.uuid) {
        object.uuid = json.uuid;
    }

    if (json.name) {
        object.name = json.name;
    }

    if (json.position) {
        object.position.set(json.position.x, json.position.y, json.position.z);
    }

    if (json.quaternion) {
        object.quaternion.set(json.quaternion.x, json.quaternion.y, json.quaternion.z, json.quaternion.w);
    }

    if (json.scale) {
        object.scale.set(json.scale.x, json.scale.y, json.scale.z);
    }

    if (json.visible !== undefined) {
        object.visible = json.visible;
    }

    const shouldApplyCastShadow = json.castShadow !== undefined;
    const shouldApplyReceiveShadow = json.receiveShadow !== undefined;
    if (shouldApplyCastShadow) {
        object.castShadow = json.castShadow!;
    }
    if (shouldApplyReceiveShadow) {
        object.receiveShadow = json.receiveShadow!;
    }
    if (shouldApplyCastShadow || shouldApplyReceiveShadow) {
        traverseObjectDepthFirst(object, child => {
            if (!(child as Object3D & { isMesh?: boolean }).isMesh) {
                return;
            }
            if (shouldApplyCastShadow) {
                child.castShadow = json.castShadow!;
            }
            if (shouldApplyReceiveShadow) {
                child.receiveShadow = json.receiveShadow!;
            }
        });
    }

    if (json.userData) {
        object.userData = {
            ...object.userData,
            ...json.userData,
        };
    }

    if (object.userData.materialSettings) {
        if (!context) {
            const app = global.app as EngineRuntime;
            context = app?.editor?.scene ? getAssetResolutionContext(app.editor.scene) : undefined;
        }
        applyMaterialSettingsToObject(object, object.userData.materialSettings, context);
    }
};

export const extractFromObject3d = (object: Object3D): SerializedObject3D => {
    return {
        uuid: object.uuid,
        name: object.name,
        parent: object.parent?.uuid,
        position: { x: object.position.x, y: object.position.y, z: object.position.z },
        quaternion: { x: object.quaternion.x, y: object.quaternion.y, z: object.quaternion.z, w: object.quaternion.w },
        scale: { x: object.scale.x, y: object.scale.y, z: object.scale.z },
        visible: object.visible,
        castShadow: object.castShadow,
        receiveShadow: object.receiveShadow,
        userData: object.userData,
    };
};
