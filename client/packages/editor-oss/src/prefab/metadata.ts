import type {Object3D} from "three";

import {
    emptyAssetResolutionContext,
    getAssetResolutionContext,
    resolveAssetRevisionId,
    setAssetResolutionContext,
} from "@stem/editor-oss/asset-management/AssetResolutionContext";

/**
 * Lightweight prefab metadata helpers.
 *
 * Keep this module free of prefab loading / serialization imports so hot engine
 * paths can inspect prefab state without pulling model loaders into startup.
 */
export const getPrefabId = (object: Object3D): string | null => {
    if (object.userData?.prefabId) {
        return object.userData.prefabId as string;
    }

    return null;
};

export const setPrefabId = (object: Object3D, prefabId: string | null): void => {
    if (!prefabId) {
        delete object.userData.prefabId;
    } else {
        object.userData.prefabId = prefabId;
    }
};

export const getPrefabRevisionId = (object: Object3D): string | null => {
    if (object.userData?.prefabRevisionId) {
        return object.userData.prefabRevisionId as string;
    }
    return null;
};

export const setPrefabRevisionId = (object: Object3D, prefabRevisionId: string | null): void => {
    if (!prefabRevisionId) {
        delete object.userData.prefabRevisionId;
    } else {
        object.userData.prefabRevisionId = prefabRevisionId;
    }
};

export const isPrefab = (object: Object3D): boolean => {
    return Boolean(getPrefabId(object));
};

export const isPrefabUnlocked = (object: Object3D): boolean => {
    return Boolean(object.userData?.prefabEditRevisionId);
};

export const lockPrefab = (object: Object3D): void => {
    if (!isPrefab(object)) {
        console.warn("Object is not a prefab instance.");
        return;
    }

    if (!isPrefabUnlocked(object)) {
        console.warn("Prefab is not unlocked.");
        return;
    }

    delete object.userData.prefabEditRevisionId;
};

export const unlockPrefab = (object: Object3D): void => {
    const prefabId = getPrefabId(object);
    if (!prefabId) {
        console.warn("Object is not a prefab.");
        return;
    }

    const context = getAssetResolutionContext(object, true) || emptyAssetResolutionContext;
    const revisionId = resolveAssetRevisionId(prefabId, context);
    if (!revisionId) {
        console.warn("Prefab not found in resolution context.");
        return;
    }

    object.userData.prefabEditRevisionId = revisionId;
    setAssetResolutionContext(object, null);
};

export const getPrefabEditRevisionId = (object: Object3D): string | null => {
    return (object.userData?.prefabEditRevisionId || null) as string | null;
};

export const getPrefabRoot = (object: Object3D): Object3D | null => {
    let obj: Object3D | null = object;
    while (obj) {
        if (isPrefab(obj)) {
            return obj;
        }
        obj = obj.parent;
    }
    return null;
};
