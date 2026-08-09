import { Object3D } from 'three';

import { ModelFormat, SUPPORTED_MODEL_FORMATS } from '@stem/network/api/asset';

export {LOD_LEVEL_DESKTOP, LOD_LEVEL_MOBILE} from "./lodLevels";

export {
    getModelId,
    setModelId,
    getModelRevisionId,
    setModelRevisionId,
    isModelAssetInstance,
} from './userData';

export const isSupportedModelFormat = (format: string): format is ModelFormat => {
    const supportedModelFormatStrs: readonly string[] = SUPPORTED_MODEL_FORMATS;
    return supportedModelFormatStrs.includes(format.toLowerCase());
};

export const attachLod = (mesh: Object3D, lod: Object3D, level: number) => {
    if (!mesh.userData.lods) {
        mesh.userData.lods = {};
    }
    (mesh.userData.lods as Record<number, Object3D>)[level] = lod;
    // @ts-expect-error --- Add a new event type
    mesh.dispatchEvent({type: "lodAdded", lod, level});
};

export const getLods = (mesh: Object3D): Record<number, Object3D> | undefined => {
    return mesh.userData.lods as Record<number, Object3D> | undefined;
};

export const hasLods = (mesh: Object3D): boolean => {
    const lods = mesh.userData.lods as Record<number, Object3D> | undefined;
    return !!lods && Object.keys(lods).length > 0;
};
