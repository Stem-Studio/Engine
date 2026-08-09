import {Scene} from "three";

import {AssetType} from "@stem/network/api/asset";
import {legacyGetBehaviorsListForScene} from "@stem/network/api/behavior";
import {createSceneAssetWithData} from "@stem/network/api/scene/v2";
import {setAssetRevision} from '@stem/editor-oss/asset-management/AssetResolutionContext';
import BehaviorData from "../../behaviors/BehaviorData";
import {isLegacyBehaviorId} from "../../behaviors/util";
import {traverseObjectDepthFirst} from "../../utils/SceneTraverser";

/**
 * Migration state for legacy behaviors converted to Assets API.
 * Stored in scene.userData.behaviorsMigrated
 */
export interface BehaviorsMigrationState {
    version: number;
    migratedAt: string;
    migratedBehaviors: string[];
}

/**
 * Result of a legacy behavior migration operation.
 */
export interface MigrationResult {
    migratedCount: number;
    updatedObjectsCount: number;
    idMapping: Record<string, string>;
}

/**
 * Context required for legacy behavior migration.
 */
export interface MigrationContext {
    scene: Scene;
    sceneId: string;
}

/**
 * Represents a legacy behavior to be migrated.
 */
interface LegacyBehavior {
    id: string;
    config: any;
    code: string;
}

/**
 * Checks if a scene has completed legacy behavior migration.
 * A scene is considered migrated if it has a behaviorsMigrated state with at least one migrated behavior.
 * @param scene - The Three.js scene to check
 * @returns true if the scene has been migrated
 */
export function isSceneBehaviorsMigrated(scene: Scene): boolean {
    const migrationState = scene.userData.behaviorsMigrated as BehaviorsMigrationState | undefined;
    return !!migrationState && migrationState.migratedBehaviors.length > 0;
}

/**
 * Collects legacy behaviors from both scene.userData and the legacy backend API
 * that need to be migrated to the new Assets API.
 * @param scene - The scene to collect legacy behaviors from
 * @param sceneId - The ID of the scene to collect legacy behaviors from
 * @returns An array of legacy behaviors
 */
async function collectLegacyBehaviors(scene: Scene, sceneId: string): Promise<LegacyBehavior[]> {
    const legacyBehaviors: LegacyBehavior[] = [];

    // 1. From scene.userData
    const configs = (scene.userData.behaviorConfigs || []) as any[];
    const scripts = (scene.userData.scripts || {}) as Record<string, string>;
    for (const config of configs) {
        const id = config.id || config.name;
        if (isLegacyBehaviorId(id) && scripts[id]) {
            legacyBehaviors.push({id, config, code: scripts[id]});
        }
    }

    // 2. From legacy backend API
    try {
        const backendBehaviors = await legacyGetBehaviorsListForScene(sceneId);
        for (const behavior of backendBehaviors) {
            if (!legacyBehaviors.find(b => b.id === behavior.ID)) {
                legacyBehaviors.push({
                    id: behavior.ID,
                    config: JSON.parse(behavior.Config),
                    code: behavior.Code,
                });
            }
        }
    } catch (error) {
        console.warn("[LegacyBehaviorMigration] Failed to fetch legacy behaviors from backend:", error);
    }

    return legacyBehaviors;
}

/**
 * Updates behavior IDs on all objects in the scene based on the ID mapping.
 * Returns the count of updated behavior references.
 * @param scene - The scene to update
 * @param idMapping - The mapping of old ID to new ID
 * @returns The count of updated behavior references
 */
function updateObjectBehaviorIds(scene: Scene, idMapping: Record<string, string>): number {
    let updatedCount = 0;

    traverseObjectDepthFirst(scene, object => {
        const behaviors = object.userData.behaviors as BehaviorData[] | undefined;
        if (!behaviors || !Array.isArray(behaviors)) {
            return;
        }

        for (const behavior of behaviors) {
            const newId = idMapping[behavior.id];
            if (newId) {
                console.debug(`[LegacyBehaviorMigration] Updating behavior ID on "${object.name}": "${behavior.id}" -> "${newId}"`);
                behavior.id = newId;
                updatedCount++;
            }
        }
    });

    return updatedCount;
}

/**
 * Migrates legacy behaviors to the new Assets API.
 *
 * This function:
 * 1. Collects legacy behaviors from scene.userData and backend API
 * 2. Creates new assets for each unmigrated behavior
 * 3. Updates all behavior IDs on scene objects
 * 4. Tracks migration state to prevent re-migration
 *
 * @param context - The migration context containing scene and user info
 * @returns Migration result with counts and ID mapping, or null if migration was skipped
 */
export async function migrateLegacyBehaviors(context: MigrationContext): Promise<MigrationResult | null> {
    const {scene, sceneId} = context;

    // Check migration state
    const migrationState = scene.userData.behaviorsMigrated as BehaviorsMigrationState | undefined;
    const alreadyMigrated = new Set(migrationState?.migratedBehaviors || []);

    // Collect legacy behaviors
    const legacyBehaviors = await collectLegacyBehaviors(scene, sceneId);
    const toMigrate = legacyBehaviors.filter(b => !alreadyMigrated.has(b.id));

    if (toMigrate.length === 0) {
        console.debug("[LegacyBehaviorMigration] No legacy behaviors to migrate");
        return null;
    }

    console.info(`[LegacyBehaviorMigration] Migrating ${toMigrate.length} legacy behaviors to Assets API`);

    const newlyMigrated: string[] = [];
    const idMapping: Record<string, string> = {};

    for (const behavior of toMigrate) {
        try {
            // Create asset using createSceneAssetWithData (auto-adds to scene)
            const asset = await createSceneAssetWithData({
                sceneId,
                type: AssetType.Behavior,
                name: behavior.config.name || behavior.config.displayName || behavior.id,
                data: JSON.stringify({config: JSON.stringify(behavior.config), code: behavior.code}),
                format: "json",
                contentType: "application/json",
            });

            // Map old ID to new asset ID
            idMapping[behavior.id] = asset.id;

            // Update the scene's asset resolution context
            setAssetRevision(scene, asset.id, asset.headRevisionId);

            newlyMigrated.push(behavior.id);
            console.info(`[LegacyBehaviorMigration] Migrated behavior "${behavior.id}" -> "${asset.id}"`);
        } catch (error) {
            console.error(`[LegacyBehaviorMigration] Failed to migrate behavior "${behavior.id}":`, error);
        }
    }

    // Update behavior IDs on all objects in the scene
    let updatedObjectsCount = 0;
    if (Object.keys(idMapping).length > 0) {
        updatedObjectsCount = updateObjectBehaviorIds(scene, idMapping);
        if (updatedObjectsCount > 0) {
            console.info(`[LegacyBehaviorMigration] Updated ${updatedObjectsCount} behavior references on scene objects`);
        }
    }

    // Update migration state
    if (newlyMigrated.length > 0) {
        scene.userData.behaviorsMigrated = {
            version: 1,
            migratedAt: new Date().toISOString(),
            migratedBehaviors: [...alreadyMigrated, ...newlyMigrated],
        };
        console.info(`[LegacyBehaviorMigration] Migration complete. Migrated: ${newlyMigrated.length}`);
    }

    return {
        migratedCount: newlyMigrated.length,
        updatedObjectsCount,
        idMapping,
    };
}
