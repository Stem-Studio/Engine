import {Object3D, Scene} from "three";

import {AssetLoader} from "@stem/editor-oss/asset-management/AssetLoader";
import {AssetRef} from "@stem/editor-oss/asset-management/AssetRef";
import {
    AssetResolutionContext,
    emptyAssetResolutionContext,
    getAssetResolutionContext,
    ReadonlyAssetResolutionContext,
    resolveAssetRevisionId,
    setAssetResolutionContext,
} from "@stem/editor-oss/asset-management/AssetResolutionContext";
import {findDirectDependencies} from "@stem/editor-oss/asset-management/dependencies";
import global from "../global";
import {someObject} from "../utils/SceneUtil";

export type RevisionConflict = {
    assetId: string;
    sceneRevisionId: string;
    prefabRevisionId: string;
};

export type UnlockPrefabCheck = {
    canUnlock: boolean;
    conflicts: RevisionConflict[];
    newDependencies: Record<string, string>;
};

export enum PrefabConversionError {
    None,
    HasMultipleAssetRevisions,
    HasUnlockedPrefab,
}

/**
 * Checks if the given object can be converted to a prefab.
 *
 * @param object - The object to check
 * @returns A PrefabConversionError indicating whether the object can be
 * converted to a prefab.
 */
export const canConvertToPrefab = (object: Object3D): PrefabConversionError => {
    // If any of the object's children are prefabs that are unlocked for
    // editing, return false.
    const hasUnlockedPrefab = object.children.some(child => {
        return someObject(child, obj => {
            return isPrefab(obj) && isPrefabUnlocked(obj);
        });
    });

    if (hasUnlockedPrefab) {
        return PrefabConversionError.HasUnlockedPrefab;
    }

    // Check for references to different revisions of the same asset.
    const dependencies = findDirectDependencies(object);
    const uniqueAssets = new Map<string, AssetRef>();
    for (const dependency of dependencies) {
        const assetRef = uniqueAssets.get(dependency.assetId);
        if (assetRef && assetRef.revisionId !== dependency.revisionId) {
            return PrefabConversionError.HasMultipleAssetRevisions;
        }
        uniqueAssets.set(dependency.assetId, dependency);
    }

    return PrefabConversionError.None;
};

/**
 * Gets the prefab ID for the given object.
 *
 * @remarks
 * This will return null if the object is not a prefab instance.
 *
 * @param object - The object
 * @returns A prefab ID, or null if the object is not a prefab instance.
 */
export const getPrefabId = (object: Object3D): string | null => {
    if (object.userData?.prefabId) {
        return object.userData.prefabId as string;
    }

    return null;
};

/**
 * Sets the prefab ID for the given object.
 *
 * @param object - The object
 * @param prefabId - The prefab ID (or null to remove it)
 */
export const setPrefabId = (object: Object3D, prefabId: string | null): void => {
    if (!prefabId) {
        delete object.userData.prefabId;
    } else {
        object.userData.prefabId = prefabId;
    }
};

/**
 * Gets the prefab revision ID for the given object.
 * @remarks
 * This is the revision ID that has been used to load the prefab.
 *
 * @param object - The object
 * @returns The prefab revision ID
 */
export const getPrefabRevisionId = (object: Object3D): string | null => {
    if (object.userData?.prefabRevisionId) {
        return object.userData.prefabRevisionId as string;
    }
    return null;
};

/**
 * Sets the prefab revision ID for the given object.
 * 
 * @param object - The object
 * @param prefabRevisionId - The prefab revision ID
 */
export const setPrefabRevisionId = (object: Object3D, prefabRevisionId: string | null): void => {
    if (!prefabRevisionId) {
        delete object.userData.prefabRevisionId;
    } else {
        object.userData.prefabRevisionId = prefabRevisionId;
    }
};

/**
 * Indicates whether the given object is a prefab instance.
 *
 * @remarks
 * This method will return true even if the prefab instance is unlocked for
 * editing.
 *
 * @param object - The object to check
 * @returns true if the object is a prefab instance, false otherwise.
 */
export const isPrefab = (object: Object3D): boolean => {
    return Boolean(getPrefabId(object));
};

/**
 * Indicates whether the given prefab object is currently unlocked for editing.
 *
 * @param object - The prefab object to check
 * @returns true if the prefab is unlocked, false otherwise.
 */
export const isPrefabUnlocked = (object: Object3D): boolean => {
    return Boolean(object.userData?.prefabEditRevisionId);
};

/**
 * Indicates whether any instance of the given prefab ID is unlocked for editing
 * in the given scene.
 *
 * @param scene - The scene to check
 * @param prefabId - The prefab ID to check
 * @returns true if any instance of the prefab is unlocked, false otherwise.
 */
export const isPrefabUnlockedInScene = (scene: Scene, prefabId: string): boolean => {
    return someObject(scene, obj => getPrefabId(obj) === prefabId && isPrefabUnlocked(obj));
};

/**
 * Check if a prefab can be unlocked for editing within a scene.
 *
 * @remarks
 * This function checks for conflicts between the prefab's dependencies and the
 * scene's asset resolution context. If the prefab references a different
 * revision of an asset that is already in the scene, the prefab cannot be
 * unlocked because the scene can only have one revision of each asset.
 *
 * @param object - The prefab instance to check
 * @param sceneContext - The scene's asset resolution context
 * @returns An object indicating whether the prefab can be unlocked, any
 * conflicts, and any new dependencies that need to be added to the scene.
 */
export const checkPrefabUnlock = (
    object: Object3D,
    sceneContext: ReadonlyAssetResolutionContext,
): UnlockPrefabCheck => {
    const prefabId = getPrefabId(object);
    if (!prefabId) {
        return {canUnlock: false, conflicts: [], newDependencies: {}};
    }

    // Get the prefab's own context (not inherited)
    const prefabContext = getAssetResolutionContext(object, false) || emptyAssetResolutionContext;

    const conflicts: RevisionConflict[] = [];
    const newDependencies: Record<string, string> = {};

    // Check each of the prefab's dependencies
    const prefabDependencies = prefabContext.assetIdToRevisionId || {};
    const sceneDependencies = sceneContext.assetIdToRevisionId || {};

    for (const [assetId, prefabRevisionId] of Object.entries(prefabDependencies)) {
        const sceneRevisionId = sceneDependencies[assetId];

        if (sceneRevisionId) {
            // Scene already has this asset - check for conflict
            if (sceneRevisionId !== prefabRevisionId) {
                conflicts.push({assetId, sceneRevisionId, prefabRevisionId});
            }
            // If revisions match, no action needed
        } else {
            // Scene doesn't have this asset - it's a new dependency
            newDependencies[assetId] = prefabRevisionId;
        }
    }

    return {
        canUnlock: conflicts.length === 0,
        conflicts,
        newDependencies,
    };
};

export const lockPrefab = (object: Object3D) => {
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

/**
 * Unlocks the given prefab instance, allowing it to be edited independently of
 * the original prefab.
 *
 * @remarks
 * If the object is already unlocked, or is not a prefab instance, this function
 * will do nothing.
 *
 * Before calling this function, use `checkPrefabUnlock` to verify there are no
 * conflicts and add any new dependencies to the scene.
 *
 * @param object - The prefab instance to unlock
 */
export const unlockPrefab = (object: Object3D) => {
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
    // Store the revision ID so that we know which revision the user started
    // editing from.
    object.userData.prefabEditRevisionId = revisionId;

    // Clear the prefab's own asset resolution context. Once unlocked, the
    // prefab's dependencies are resolved using the scene's context.
    setAssetResolutionContext(object, null);
};

/**
 * Load the specified prefab revision.
 *
 * @param prefabId - The prefab ID
 * @param context - The asset revision context
 * @param skipChildrenProcess
 * @returns A promise that resolves to the prefab instance.
 */
export const loadPrefab = async (
    prefabId: string,
    context: ReadonlyAssetResolutionContext,
    skipChildrenProcess: boolean = false,
): Promise<Object3D> => {
    const appAssetLoader = global.app?.assetLoader;
    if (!appAssetLoader) {
        throw new Error(
            `[loadPrefab] AssetLoader not available for prefab ${prefabId}. ` +
            `Ensure createAssetLoader() is awaited before scene deserialization.`,
        );
    }
    return loadPrefabWithLoader(prefabId, context, appAssetLoader, skipChildrenProcess);
};

/**
 * Load a prefab using an AssetLoader for efficient caching.
 *
 * @param prefabId - The prefab ID
 * @param context - The asset revision context
 * @param assetLoader - The AssetLoader instance to use for caching and URL retrieval
 * @param skipChildrenProcess - When true, skip processing of child objects during deserialization
 * @returns A promise that resolves to the prefab instance.
 */
export const loadPrefabWithLoader = async (
    prefabId: string,
    context: ReadonlyAssetResolutionContext,
    assetLoader: AssetLoader,
    skipChildrenProcess: boolean = false,
): Promise<Object3D> => {
    const prefabRevisionId = resolveAssetRevisionId(prefabId, context);
    if (!prefabRevisionId) {
        throw new Error(`Prefab ${prefabId} not found in revision context`);
    }

    const ref: AssetRef = { assetId: prefabId, revisionId: prefabRevisionId };
    const prefabRevision = await assetLoader.getAssetRevision(ref);
    if (!prefabRevision?.dataUrl) {
        throw new Error(`Failed to load prefab revision metadata ${prefabId}:${prefabRevisionId}`);
    }

    const prefabStr = await fetch(prefabRevision.dataUrl).then(r => r.text());
    const prefabResolutionContext: AssetResolutionContext = {
        assetIdToRevisionId: prefabRevision.dependencies || {},
        logicalIdToAssetId: (prefabRevision.metadata?.logicalAssetIdMap || {}) as Record<string, string>,
    };
    const {deserializePrefab} = await import("./serialization");
    const prefabInstance = await deserializePrefab(prefabStr, prefabResolutionContext, skipChildrenProcess);
    if (!prefabInstance) {
        throw new Error(`Failed to load prefab revision ${prefabId}:${prefabRevisionId}`);
    }

    setPrefabId(prefabInstance, prefabId);

    return prefabInstance;
};

export const getPrefabEditRevisionId = (object: Object3D): string | null => {
    return (object.userData?.prefabEditRevisionId || null) as string | null;
};

/**
 * Returns the root of the prefab that contains the given object.
 *
 * @param object - The object
 * @returns the root of the prefab that contains the object or null if the
 * object is not part of a prefab.
 */
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
