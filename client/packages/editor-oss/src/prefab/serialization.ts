import {keyBy, mapValues} from "lodash";
import {Group, MathUtils, Object3D} from "three";

import global from "../global";
import {isPrefabUnlocked, lockPrefab, setPrefabId} from "./util";
import {
    AssetResolutionContext,
    emptyAssetResolutionContext,
    setAssetResolutionContext,
} from "@stem/editor-oss/asset-management/AssetResolutionContext";
import {
    findDirectDependencies,
    mapAssetIds,
    remapBehaviorAttributeUuids,
    resolveBehaviorAttributeAssetRefs,
    resolveLambdaComponentDataAssetRefs,
} from "@stem/editor-oss/asset-management/dependencies";
import BehaviorData from "../behaviors/BehaviorData";
import type {LambdaComponentData} from "../lambdas/Lambda";
import Converter from "../serialization/Converter";
import {cloneObject, processChildData} from "../utils/ObjectUtils";
import {traverseObjectDepthFirst} from "../utils/SceneTraverser";

export type SerializePrefabResult = {
    data: string;
    assetResolutionContext: AssetResolutionContext;
};

/**
 * Serialize the given object as a prefab.
 *
 * @remarks
 * The object need not be a prefab instance; it can be any Object3D. The
 * function will handle:
 * - Locking the prefab (if it is unlocked)
 * - Mapping all asset references to logical asset IDs
 * - Serializing the prefab to JSON
 * - Generating an asset resolution context
 *
 * The serialized prefab object will be a JSON string. The logical asset ID map
 * will be a map of logical asset IDs to asset IDs. This mapping is used at
 * runtime to map logical asset IDs to asset IDs, and should be stored along
 * with the serialized prefab object. It allows the prefab object to be
 * imported into different environments (e.g. production vs development) without
 * needing to change the prefab payload - only the logical asset ID map needs to
 * be updated.
 *
 * @param object - The prefab object to serialize
 * @returns A JSON string representing the serialized prefab object and an asset
 * resolution context.
 */
export const serializePrefab = (object: Object3D): SerializePrefabResult => {
    // Clone the object so we don't modify the original
    const clone = cloneObject(object);

    // Lock the cloned prefab (serialized prefabs should not be open for
    // editing).
    if (isPrefabUnlocked(clone)) {
        lockPrefab(clone);
    }

    // Remove the prefab ID from the clone. Otherwise, we'll create a circular
    // reference where the prefab is its own parent.
    setPrefabId(clone, null);

    // Remove the asset resolution context (if there is one) since this will get
    // stored along with the serialized prefab object.
    setAssetResolutionContext(clone, null);

    // Generate persistent UUIDs for each behavior and lambda component (if they
    // don't have one). If they already have one, we want to maintain the existing UUID.
    traverseObjectDepthFirst(clone, child => {
        if (child.userData?.behaviors) {
            for (const behavior of child.userData.behaviors as BehaviorData[]) {
                if (!behavior.prefabBehaviorUuid) {
                    behavior.prefabBehaviorUuid = MathUtils.generateUUID();
                }
            }
        }
        if (child.userData?.lambdaComponents) {
            for (const component of child.userData.lambdaComponents as LambdaComponentData[]) {
                if (!component.prefabLambdaUuid) {
                    component.prefabLambdaUuid = MathUtils.generateUUID();
                }
            }
        }
    });

    // Find dependencies on the original object. We use the original object
    // because findDirectDependencies uses the asset context of its parent when
    // resolving dependencies.
    const dependencies = findDirectDependencies(object);
    const assetIdToRevisionId = mapValues(keyBy(dependencies, "assetId"), "revisionId");

    // Map all asset references to logical asset IDs.
    const logicalIdToAssetId: Record<string, string> = {};
    mapAssetIds(clone, emptyAssetResolutionContext, assetId => {
        // Ignore asset IDs that aren't a direct dependency of this prefab.
        if (!assetIdToRevisionId[assetId]) {
            return assetId;
        }

        let logicalAssetId = logicalIdToAssetId[assetId];
        if (!logicalAssetId) {
            logicalAssetId = MathUtils.generateUUID();
            logicalIdToAssetId[logicalAssetId] = assetId;
        }

        return logicalAssetId;
    });

    const options = {
        server: global.app?.options?.server,
    };

    const objects = new (Converter as any)().toJSON({scene: clone, options});

    return {
        data: JSON.stringify(objects),
        assetResolutionContext: {
            logicalIdToAssetId,
            assetIdToRevisionId,
        },
    };
};

/**
 * Deserialize the given prefab JSON data.
 *
 * @remarks
 * This is a very low-level function meant for I/O operations. If you want to
 * load a prefab, use the `loadPrefab` function instead.
 *
 * @param jsonStr - The JSON string to deserialize
 * @param context - The asset revision context
 * @param skipChildrenProcess
 * @returns An object representing the deserialized prefab.
 */
export const deserializePrefab = async (
    jsonStr: string,
    context: AssetResolutionContext,
    skipChildrenProcess: boolean = false,
): Promise<Object3D> => {
    const options = {
        server: global.app?.options?.server,
        assetResolutionContext: context,
    };

    const objects = JSON.parse(jsonStr);
    const converter = new (Converter as any)();
    const group = (await converter.parseAsGroup(objects, options)) as Group;
    const prefab = group.children[0];
    if (!prefab) {
        throw new Error("Failed to deserialize prefab.");
    }


    // Assign unique UUIDs to each object, behavior, and lambda component,
    // tracking old-to-new mappings so we can remap object attribute references.
    const uuidMap = new Map<string, string>();

    traverseObjectDepthFirst(prefab, object => {
        const oldUuid = object.uuid;
        object.uuid = MathUtils.generateUUID();
        uuidMap.set(oldUuid, object.uuid);

        if (object.userData?.behaviors) {
            for (const behavior of object.userData.behaviors as BehaviorData[]) {
                behavior.uuid = MathUtils.generateUUID();
            }
        }
        if (object.userData?.lambdaComponents) {
            for (const component of object.userData.lambdaComponents as LambdaComponentData[]) {
                component.uuid = MathUtils.generateUUID();
            }
        }
    });

    // Remap "object" type behavior attributes to use the new UUIDs
    remapBehaviorAttributeUuids(prefab, uuidMap);

    if (!skipChildrenProcess) {
        processChildData(prefab, true);
    }

    // Map logical asset IDs back to asset IDs.
    mapAssetIds(prefab, context, assetId => {
        // If the asset ID is not in the context, return it as-is.
        const resolvedAssetId = context.logicalIdToAssetId?.[assetId];
        return resolvedAssetId || assetId;
    });

    // Assign the revision context to the prefab but drop the logical ID map
    // since we already mapped all asset IDs.
    setAssetResolutionContext(prefab, {
        ...context,
        logicalIdToAssetId: undefined,
    });

    // Resolve all behavior attribute asset references using the supplied
    // context.
    resolveBehaviorAttributeAssetRefs(prefab, context);
    resolveLambdaComponentDataAssetRefs(prefab, context);

    return prefab;
};
