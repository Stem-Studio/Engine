import {Object3D} from "three";

import { resolveAssetId, resolveAssetRevisionId, ReadonlyAssetResolutionContext } from '@stem/editor-oss/asset-management/AssetResolutionContext';
import { remapBehaviorAttributeUuids, resolveBehaviorAttributeAssetRefs, resolveLambdaComponentDataAssetRefs } from '@stem/editor-oss/asset-management/dependencies';
import BehaviorData from '@stem/editor-oss/behaviors/BehaviorData';
import type {LambdaComponentData} from '@stem/editor-oss/lambdas/Lambda';
import { PhysicsUtil } from '@stem/editor-oss/physics/PhysicsUtil';
import { getPrefabId, isPrefabUnlocked, loadPrefab, setPrefabId, setPrefabRevisionId } from '@stem/editor-oss/prefab/util';
import { PrefabSchema, SerializedPrefab } from '../schema/PrefabSchema';
import { applyToObject3d, extractFromObject3d } from '../util/object3d';

interface PrefabUuidNode {
    uuid: string;
    children?: PrefabUuidNode[];
}

const isPlainRecord = (value: unknown): value is Record<string, any> =>
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value);

export class PrefabSerializer {
    toJSON(obj: Object3D): SerializedPrefab {
        const prefabId = getPrefabId(obj);
        if (!prefabId) {
            throw new Error("Object is not a prefab instance");
        }

        if (isPrefabUnlocked(obj)) {
            throw new Error("Cannot serialize an unlocked prefab instance");
        }

        // Clean the userData by removing the prefabId, prefabRevisionId
        const userData = {
            ...obj.userData,
        };

        delete userData.prefabId;
        delete userData.prefabRevisionId;
                
        // Compute shape offset and scale for physics. These get stored in
        // userData so that they don't need to be re-computed at runtime
        if (PhysicsUtil.isPhysicsEnabled(obj)) {
            PhysicsUtil.updateShapeOffsetAndScale(obj);
        }

        return {
            ...extractFromObject3d(obj),
            metadata: {
                generator: this.constructor.name,
            },
            prefabId,
            userData,
        };
    }

    async fromJSON(
        json: unknown,
        _parent: Object3D | null,
        options: {assetResolutionContext: ReadonlyAssetResolutionContext},
    ): Promise<Object3D | null> {
        const context = options.assetResolutionContext;
        const result = PrefabSchema.safeParse(json);
        if (!result.success) {
            console.warn("Failed to parse prefab data:", result.error);
            throw new Error("Failed to parse prefab data");
        }

        const {prefabId, parent: jsonParentUuid, userData} = result.data;

        const resolvedPrefabId = resolveAssetId(prefabId, context);

        let prefab: Object3D;
        try {
            prefab = await loadPrefab(resolvedPrefabId, context, true);
        } catch (error) {
            console.warn("Failed to load prefab:", error);
            // If the prefab fails to load, create an empty object so that the
            // prefab remains in the scene. Otherwise, the prefab is not present
            // in the scene and any data associated with it is lost on the next
            // scene save.
            prefab = new Object3D();
            setPrefabId(prefab, resolvedPrefabId);
            const revisionId = resolveAssetRevisionId(resolvedPrefabId, context);
            if (revisionId) {
                setPrefabRevisionId(prefab, revisionId);
            }
        }

        (prefab as Object3D & {parentUuid?: string}).parentUuid = jsonParentUuid;

        // Overrides stored in the scene
        applyToObject3d(prefab, {
            ...result.data,
            userData: undefined, // Don't override the prefab's userData
        });

        this.applyBehaviorOverrides(prefab, userData?.behaviors, context);

        // Lambda component overrides: individual prefab instances may override
        // componentData of lambda components on the prefab.
        if (prefab.userData?.lambdaComponents && userData?.lambdaComponents) {
            const jsonComponents = userData.lambdaComponents as LambdaComponentData[];
            const prefabComponents = (prefab.userData.lambdaComponents || []) as LambdaComponentData[];
            for (const jsonComponent of jsonComponents) {
                const prefabComponent = prefabComponents.find(
                    c => c.prefabLambdaUuid === jsonComponent.prefabLambdaUuid,
                );
                if (prefabComponent) {
                    prefabComponent.componentData = jsonComponent.componentData;
                }
            }

            // Re-resolve the lambda componentData asset references since we
            // have overridden their values.
            resolveLambdaComponentDataAssetRefs(prefab, context);
        }

        // Physics override: individual instances can enable/disable physics but
        // they cannot override any other physics settings.
        if (prefab.userData?.physics && userData?.physics) {
            prefab.userData.physics = {
                ...prefab.userData.physics,
                enabled: userData.physics.enabled,
            };
        }

        if (userData) {
            prefab.userData = {
                ...userData,
                // Prefab userData takes preference by default (we must
                // explicitly handle any exceptions, such as behaviors, above).
                ...prefab.userData,
            };
        }

        // Scenes may require prefab instances to have specific UUIDs assigned to
        // their children (e.g., for behavior attribute references). If this is
        // the case, we need to restore the original UUIDs to the model parts.
        if (userData?.children) {
            // Build a map from current UUIDs (assigned by loadPrefab) to the
            // instance-specific UUIDs stored in userData.children. We need this to
            // remap behavior "object" attributes after reverting UUIDs.
            const uuidMap = new Map<string, string>();
            this.buildUuidMap(prefab.children, userData.children || [], uuidMap);

            this.mapUuids(prefab.children, userData.children || []);

            // Remap behavior "object" attributes to use the instance-specific UUIDs
            remapBehaviorAttributeUuids(prefab, uuidMap);
        }

        return prefab;
    }

    private applyBehaviorOverrides(
        prefab: Object3D,
        jsonBehaviors: unknown,
        context: ReadonlyAssetResolutionContext,
    ): void {
        if (!Array.isArray(jsonBehaviors) || !Array.isArray(prefab.userData?.behaviors)) {
            return;
        }

        const prefabBehaviors = prefab.userData.behaviors as BehaviorData[];
        let didOverride = false;

        for (const jsonBehavior of jsonBehaviors as BehaviorData[]) {
            const prefabBehaviorUuid = jsonBehavior?.prefabBehaviorUuid;
            if (!prefabBehaviorUuid) {
                console.warn("Skipping prefab behavior override without prefabBehaviorUuid");
                continue;
            }

            const prefabBehavior = prefabBehaviors.find(
                b => b.prefabBehaviorUuid === prefabBehaviorUuid,
            );
            if (!prefabBehavior) {
                console.warn(`Skipping prefab behavior override for unknown behavior "${prefabBehaviorUuid}"`);
                continue;
            }

            if (jsonBehavior.id && prefabBehavior.id && jsonBehavior.id !== prefabBehavior.id) {
                console.warn(
                    `Skipping prefab behavior override "${prefabBehaviorUuid}" because behavior id changed from "${prefabBehavior.id}" to "${jsonBehavior.id}"`,
                );
                continue;
            }

            if (jsonBehavior.attributesData === undefined) {
                continue;
            }

            if (!isPlainRecord(jsonBehavior.attributesData)) {
                console.warn(`Skipping prefab behavior override "${prefabBehaviorUuid}" with invalid attributesData`);
                continue;
            }

            prefabBehavior.attributesData = {...jsonBehavior.attributesData};
            didOverride = true;
        }

        if (didOverride) {
            resolveBehaviorAttributeAssetRefs(prefab, context);
        }
    }

    /**
     * Builds a map from current UUIDs to instance-specific UUIDs.
     * This mirrors the structure traversal of revertUUID.
     *
     * @param children - The child objects with current UUIDs
     * @param list - The stored UUID list from userData.children
     * @param uuidMap - Map to populate with current UUID to instance UUID mappings
     */
    buildUuidMap(children: Object3D[], list: PrefabUuidNode[], uuidMap: Map<string, string>): void {
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            const node = list[i];
            if (node && child) {
                uuidMap.set(child.uuid, node.uuid);
            }
            if (child?.children && node?.children) {
                this.buildUuidMap(child.children, node.children, uuidMap);
            }
        }
    }

    /**
     * Restores the original UUIDs to model parts
     * @param {Object3D[]} children - The child objects
     * @param {Array} list - The original UUID list
     */
    mapUuids(children: Object3D[], list: PrefabUuidNode[]): void {
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            const node = list[i];

            if (node && child) {
                child.uuid = node.uuid;
            }

            if (child?.children && node?.children) {
                this.mapUuids(child.children, node.children);
            }
        }
    }
}
