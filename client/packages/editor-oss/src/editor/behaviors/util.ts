import {getModifiedAttributeKeys} from "./attributeDiff";
import {BehaviorConfig} from "./BehaviorConfig";
import BehaviorObjectSettingsApplier from "./BehaviorObjectSettingsApplier";
import {AssetType, isConflictError, isNoChangesError} from "@stem/network/api/asset";
import {
    getAssetResolutionContext,
    removeAssetRevision,
    setAssetRevision,
    type ReadonlyAssetResolutionContext,
} from "@stem/editor-oss/asset-management/AssetResolutionContext";
import BehaviorData from "../../behaviors/BehaviorData";
import global from "@stem/editor-oss/global";
import {isPrefab, isPrefabUnlocked} from "@stem/editor-oss/prefab/util";
import {queryClient} from "@web-shared/queryClient";
import {seedScriptDependencyEntry} from "../../script-runtime/scriptDependencyCache";
import {
    buildNameAwareScriptImportContext,
    getScriptImportDependencyMap,
    loadReferencedScriptImportRevisionMap,
    type ScriptImportRevisionMap,
} from "../../script-runtime/scriptImportCore";
import {traverseSceneDepthFirst} from "@stem/editor-oss/utils/SceneUtil";
import type {AssetSource} from "../asset-management/AssetSource";
import {createAsset, createAssetRevision, getAsset, seedAssetRevisionData} from "../asset-management/hooks/assets";
import Editor from "../Editor";

/**
 * Updates existing behavior instances in the scene in-place after a behavior
 * definition has been saved. Unlike the previous remove/re-add approach, this
 * keeps behavior data in userData.behaviors at all times so scene serialization
 * is never missing behaviors.
 *
 * Optionally re-keys instances to a new behavior id (fork-on-edit case). When
 * newBehaviorId is provided and differs from behaviorId, every matching
 * behavior has its id field rewritten to the new id and is reinitialized
 * against the config registered under the new id.
 *
 * @param behaviorId - The behavior ID to find on scene objects
 * @param editor - The editor instance providing scene, config registry, and plugin management
 * @param attributesToReset - Attribute keys whose values should be cleared so defaults apply
 * @param newBehaviorId - Optional new id to swap to; when undefined, keeps behaviorId
 */
export const swapExistingBehaviors = (
    behaviorId: string,
    editor: Editor | null | undefined,
    attributesToReset?: string[],
    newBehaviorId?: string,
) => {
    const scene = editor?.scene;
    if (!scene || !editor) return;

    // Look up the config under the EFFECTIVE id (the new one when an id swap
    // is in flight, since updateBehaviorRegistries has already re-keyed it).
    const effectiveBehaviorId = newBehaviorId ?? behaviorId;
    const config = editor.behaviorConfigRegistry.getConfig(effectiveBehaviorId);
    const configAttributes = config?.attributes || {};

    traverseSceneDepthFirst(scene, object => {
        // If this is a prefab and it's locked, don't traverse its children.
        const shouldTraverseChildren = !isPrefab(object) || isPrefabUnlocked(object);

        const behaviors = object.userData?.behaviors as BehaviorData[] | undefined;
        if (!behaviors) {
            return shouldTraverseChildren;
        }

        for (const behavior of behaviors) {
            // Match instances against the OLD id (current scene state).
            if (behavior.id !== behaviorId) continue;

            // Re-key to the new id when swapping.
            if (newBehaviorId && newBehaviorId !== behaviorId) {
                behavior.id = newBehaviorId;
            }

            // Reset changed attributes to their defaults
            if (attributesToReset && attributesToReset.length > 0 && behavior.attributesData) {
                for (const attrKey of attributesToReset) {
                    delete behavior.attributesData[attrKey];
                }
            }

            // Strip attributes that no longer exist in the config
            if (behavior.attributesData) {
                for (const key of Object.keys(behavior.attributesData)) {
                    if (!configAttributes[key]) {
                        delete behavior.attributesData[key];
                    }
                }
            }

            // Re-apply object settings from the updated config
            if (config?.objectSettings) {
                BehaviorObjectSettingsApplier.applyObjectSettings(object, config.objectSettings);
            }

            // Reinitialize the behavior plugin with new code
            editor.removeBehaviorPlugin(behavior.uuid);
            editor.addBehaviorPlugin(object, behavior);
        }

        return shouldTraverseChildren;
    });
};

export interface UpdateBehaviorRegistriesParams {
    behaviorId: string;
    code: string;
    config: BehaviorConfig;
    /** Also register under this alias ID (e.g. YAML config.id for imports) */
    aliasId?: string;
    /** Skip immediate script parsing when the caller will parse with a resolved import map. */
    skipParse?: boolean;
    /** When provided and different from behaviorId, the previous id is
     * unregistered before registering behaviorId. Used for fork-on-edit when
     * an asset id changes. */
    previousBehaviorId?: string;
}

/**
 * Updates behavior registries (config, script, and type) for a behavior.
 *
 * @param params - The behavior update parameters
 * @param params.behaviorId - The ID of the behavior being updated
 * @param params.code - The new behavior script source code
 * @param params.config - The new behavior configuration
 * @param params.aliasId - Optional alias ID to also register under
 * @param params.previousBehaviorId
 * @returns void
 */
export const updateBehaviorRegistries = ({
    behaviorId,
    code,
    config,
    aliasId,
    skipParse,
    previousBehaviorId,
}: UpdateBehaviorRegistriesParams) => {
    const editor = global.app?.editor;
    const behaviorConfigRegistry = editor?.behaviorConfigRegistry;
    const behaviorScriptRegistry = editor?.behaviorScriptRegistry;

    const unregisterIfRegistered = (id: string) => {
        if (behaviorConfigRegistry?.getConfig(id)) {
            behaviorConfigRegistry.unregisterConfig(id, true);
        }
        const getScript = (behaviorScriptRegistry as {getScript?: (name: string) => string | null} | undefined)?.getScript;
        if (typeof getScript === "function" && behaviorScriptRegistry) {
            if (getScript.call(behaviorScriptRegistry, id)) {
                behaviorScriptRegistry.unregisterScript(id, true);
            }
        } else {
            behaviorScriptRegistry?.unregisterScript?.(id, true);
        }
    };

    // Drop the old id's registry entries when an id swap is in flight, so
    // nothing in the editor still resolves through the stale id.
    if (previousBehaviorId && previousBehaviorId !== behaviorId) {
        unregisterIfRegistered(previousBehaviorId);
    }

    // Update registries
    unregisterIfRegistered(behaviorId);
    behaviorConfigRegistry?.registerConfig(behaviorId, config);
    behaviorScriptRegistry?.registerScript(behaviorId, code);

    // Alias registration (e.g. YAML config.id differs from server asset ID)
    if (aliasId && aliasId !== behaviorId) {
        unregisterIfRegistered(aliasId);
        behaviorConfigRegistry?.registerConfig(aliasId, config);
        behaviorScriptRegistry?.registerScript(aliasId, code);
    }

    if (code && editor && !skipParse) {
        void editor.parseAndRegisterScriptBehavior(behaviorId, code);
    }
};

export interface UpdateSceneBehaviorRevisionParams {
    assetId: string;
    revisionId: string;
    code: string;
    config: BehaviorConfig;
    /** Register under this alias ID in addition to assetId (e.g. YAML config.id for imports) */
    aliasId?: string;
    /** Defer the expensive scene config sync/objectChanged event to a caller-managed batch flush. */
    deferSceneSync?: boolean;
    /** Precomputed script import context for batch imports. Avoids per-behavior scene script scans. */
    scriptImportContext?: ReadonlyAssetResolutionContext;
    /** Shared batch cache of fetched script import revision sources. */
    scriptImportRevisionMap?: ScriptImportRevisionMap;
    /** When set and different from assetId, swap behavior instances from
     * assetId to this new id. Used by fork-on-edit when the user starts
     * editing a behavior they don't own and we transparently fork it. */
    newAssetId?: string;
}

/**
 * Single entry point for applying a behavior revision to the scene.
 * Updates registries, asset resolution context, swaps existing instances, and fires events.
 * Call this after creating a revision via the API.
 *
 * Optionally re-keys all references from assetId to newAssetId in one pass.
 * When newAssetId equals (or is omitted) assetId, this is a pure same-id
 * revision change.
 * @param root0
 * @param root0.assetId
 * @param root0.revisionId
 * @param root0.code
 * @param root0.config
 * @param root0.aliasId
 * @param root0.newAssetId
 */
export const updateSceneBehaviorRevision = async ({
    assetId,
    revisionId,
    code,
    config,
    aliasId,
    deferSceneSync,
    scriptImportContext,
    scriptImportRevisionMap,
    newAssetId,
}: UpdateSceneBehaviorRevisionParams) => {
    const app = global.app;
    const editor = app?.editor;
    const scene = app?.scene;
    if (!editor || !scene) return;

    const isAssetIdChange = !!newAssetId && newAssetId !== assetId;
    const effectiveAssetId = newAssetId ?? assetId;

    // Read existing config from registry before overwriting (for attribute diff).
    // Always under the OLD id since the registry hasn't been re-keyed yet.
    const originalConfig = editor.behaviorConfigRegistry?.getConfig(assetId);
    const currentAttributes = originalConfig?.attributes || {};
    const modifiedAttributeKeys = getModifiedAttributeKeys(currentAttributes, config.attributes || {});

    // 1. Update import dependency metadata, then registries. On fork, cache
    // dependencies under the new asset id because the saved revision belongs
    // to the fork.
    const sceneContext = getAssetResolutionContext(scene) || undefined;
    const importContext = scriptImportContext ?? await buildNameAwareScriptImportContext(editor.sceneID, sceneContext);
    const dependencies = getScriptImportDependencyMap(code, importContext);
    seedScriptDependencyEntry({
        assetId: effectiveAssetId,
        revisionId,
        ownerType: "behavior",
        dependencies,
    });
    const importRevisionMap = await loadReferencedScriptImportRevisionMap(
        code,
        importContext,
        scriptImportRevisionMap,
    );
    if (scriptImportRevisionMap) {
        Object.assign(scriptImportRevisionMap, importRevisionMap);
    }
    updateBehaviorRegistries({
        behaviorId: effectiveAssetId,
        code,
        config,
        aliasId,
        skipParse: true,
        previousBehaviorId: isAssetIdChange ? assetId : undefined,
    });

    // 2. Update asset resolution context (before swap so plugins see the new revision)
    setAssetRevision(scene, effectiveAssetId, revisionId);
    if (isAssetIdChange) {
        // Drop the stale old-id mapping after the new one is in place; the
        // swap below removes the last in-scene references to the old id.
        removeAssetRevision(scene, assetId);
    }

    // 3. Swap existing behavior instances in the scene
    swapExistingBehaviors(assetId, editor, modifiedAttributeKeys, isAssetIdChange ? effectiveAssetId : undefined);

    // 4. Sync and fire events. Batch imports can register many behaviors in a
    // row; callers may defer this to one final flush after the import batch.
    if (!deferSceneSync) {
        editor.syncSceneBehaviorConfigs();
        app.call("objectChanged", null, scene);
    }
    await editor.parseAndRegisterScriptBehavior(effectiveAssetId, code, importContext, importRevisionMap, {contextIsNameAware: true});
};

export interface CreateBehaviorParams {
    assetSource?: AssetSource;
    name: string;
    code: string;
    config: BehaviorConfig;
    description?: string;
    /** Register under this alias ID in addition to the new asset ID */
    aliasId?: string;
    /** Defer scene config sync/objectChanged to a caller-managed batch flush. */
    deferSceneSync?: boolean;
    /** Precomputed script import context for batch imports. */
    scriptImportContext?: ReadonlyAssetResolutionContext;
    /** Shared batch cache of fetched script import revision sources. */
    scriptImportRevisionMap?: ScriptImportRevisionMap;
}

/**
 * Creates a new behavior asset. If an assetSource is provided, also updates
 * registries and instances in the current editing context.
 *
 * @param params - The behavior creation parameters
 * @param params.assetSource - The asset source for the current editing context
 * @param params.name - The behavior name
 * @param params.code - The behavior script source code
 * @param params.config - The behavior configuration (config.id will be set to the new asset ID)
 * @param params.description - Optional description for the asset
 * @param params.aliasId - Optional alias ID for dual-registration
 * @returns The created asset
 */
export const createBehavior = async ({
    assetSource,
    name,
    code,
    config,
    description,
    aliasId,
    deferSceneSync,
    scriptImportContext,
    scriptImportRevisionMap,
}: CreateBehaviorParams) => {
    const sceneContext = global.app?.scene ? getAssetResolutionContext(global.app.scene) || undefined : undefined;
    const importContext = scriptImportContext ?? await buildNameAwareScriptImportContext(global.app?.editor?.sceneID, sceneContext);
    const dependencies = getScriptImportDependencyMap(code, importContext);
    const asset = await createAsset({
        type: AssetType.Behavior,
        assetSource,
        deferAssetSourceSceneSync: deferSceneSync,
        name,
        data: JSON.stringify({config: JSON.stringify(config), code}),
        format: "json",
        contentType: "application/json",
        options: {
            ...(description ? {description} : {}),
            dependencies,
        },
    });

    config.id = asset.id;
    const configStr = JSON.stringify(config);

    seedAssetRevisionData(queryClient, asset.id, asset.headRevisionId, "json", {config: configStr, code});
    seedScriptDependencyEntry({
        assetId: asset.id,
        revisionId: asset.headRevisionId,
        ownerType: "behavior",
        dependencies,
    });

    if (assetSource) {
        await updateSceneBehaviorRevision({
            assetId: asset.id,
            revisionId: asset.headRevisionId,
            code,
            config,
            aliasId,
            deferSceneSync,
            scriptImportContext: importContext,
            scriptImportRevisionMap,
        });
    }

    return asset;
};

export interface CreateBehaviorRevisionParams {
    assetId: string;
    parentRevisionId: string;
    code: string;
    config: BehaviorConfig;
    /** If provided, triggers scene registry updates and instance swapping */
    assetSource?: AssetSource;
    /** Register under this alias ID in addition to the asset ID */
    aliasId?: string;
    /** Defer scene config sync/objectChanged to a caller-managed batch flush. */
    deferSceneSync?: boolean;
    /** Precomputed script import context for batch imports. */
    scriptImportContext?: ReadonlyAssetResolutionContext;
    /** Shared batch cache of fetched script import revision sources. */
    scriptImportRevisionMap?: ScriptImportRevisionMap;
    /**
     * If true, retry once with a fresh parent revision on 409 Conflict. Only safe
     * for automated callers (copilot, import) that don't need merge resolution.
     * User-facing edits should resolve conflicts via merge, not blind retry.
     */
    retryOnConflict?: boolean;
}

/**
 * Creates a new behavior revision. If sceneId is provided, also updates scene registries and instances.
 *
 * - If the server reports no changes (isNoChangesError), returns the parent revision id.
 *   (The server guarantees no two sequential revisions have identical content, so parent == head.)
 * - If retryOnConflict is true and a 409 is returned, retries once with the fresh head revision.
 *
 * @param params - The behavior revision parameters
 * @param params.assetId - The behavior's asset ID
 * @param params.parentRevisionId - The parent revision ID for the new revision
 * @param params.code - The new behavior script source code
 * @param params.config - The new behavior configuration
 * @param params.sceneId - Optional scene ID. If provided, triggers scene updates.
 * @param params.assetSource
 * @param params.aliasId - Optional alias ID for dual-registration
 * @param params.retryOnConflict - If true, retry once with fresh parent on 409
 * @returns An object with the id of the new (or existing) revision
 */
export const createBehaviorRevision = async ({
    assetId,
    parentRevisionId,
    code,
    config,
    assetSource,
    aliasId,
    deferSceneSync,
    scriptImportContext,
    scriptImportRevisionMap,
    retryOnConflict,
}: CreateBehaviorRevisionParams): Promise<{id: string}> => {
    const configStr = JSON.stringify(config);
    const data = JSON.stringify({config: configStr, code});
    const sceneContext = global.app?.scene ? getAssetResolutionContext(global.app.scene) || undefined : undefined;
    const importContext = scriptImportContext ?? await buildNameAwareScriptImportContext(global.app?.editor?.sceneID, sceneContext);
    const dependencies = getScriptImportDependencyMap(code, importContext);

    const applyScene = async (revisionId: string) => {
        seedAssetRevisionData(queryClient, assetId, revisionId, "json", {config: configStr, code});
        seedScriptDependencyEntry({
            assetId,
            revisionId,
            ownerType: "behavior",
            dependencies,
        });
        if (assetSource) {
            await updateSceneBehaviorRevision({
                assetId,
                revisionId,
                code,
                config,
                aliasId,
                deferSceneSync,
                scriptImportContext: importContext,
                scriptImportRevisionMap,
            });
        }
    };

    // TEMP diagnostics for "first save loses behavior edits" — remove with the
    // matching [behavior-save] logs in useBehaviorSave.ts.
    console.log("[behavior-save] createBehaviorRevision", {
        assetId,
        parentRevisionId,
        codeFirstLine: (code ?? "").split("\n", 1)[0]?.slice(0, 120) ?? "",
    });

    try {
        const revision = await createAssetRevision({
                assetId,
                parentRevisionId,
                data,
                format: "json",
                contentType: "application/json",
                options: {dependencies},
        });
        await applyScene(revision.id);
        return revision;
    } catch (err: unknown) {
        // No changes: server rejected because data matches current head.
        // Server guarantees no two sequential revisions are identical, so parent == head here.
        // Still apply scene sync to ensure aliases (e.g. imported YAML config.id) are
        // re-registered in the current editor session after reload.
        if (isNoChangesError(err)) {
            console.log("[behavior-save] createBehaviorRevision: server reports NO CHANGES — data matches head, returning parent", {
                assetId,
                parentRevisionId,
            });
            await applyScene(parentRevisionId);
            return {id: parentRevisionId};
        }
        // Stale parent: retry once with fresh head, if caller opted in
        if (retryOnConflict && isConflictError(err)) {
            const {headRevisionId} = await getAsset(queryClient, assetId);
            const revision = await createAssetRevision({
                assetId,
                parentRevisionId: headRevisionId,
                data,
                format: "json",
                contentType: "application/json",
                options: {dependencies},
            });
            await applyScene(revision.id);
            return revision;
        }
        throw err;
    }
};

type VersionType = "major" | "minor" | "patch";

/**
 * Increments a semver version string by the specified component.
 *
 * @param version - A semver version string in "x.y.z" format
 * @param type - Which component to increment: "major", "minor", or "patch"
 * @returns The incremented version string
 */
export function incrementVersion(version: string, type: VersionType = "patch"): string {
    const parts = version.split(".").map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) {
        throw new Error("Invalid version format. Expected format: x.y.z");
    }

    let [major, minor, patch] = parts;

    switch (type) {
        case "major":
            if (major) {
                major++;
            }
            minor = 0;
            patch = 0;
            break;
        case "minor":
            if (minor) {
                minor++;
            }
            patch = 0;
            break;
        case "patch":
            if (patch) {
                patch++;
            }
            break;
    }

    return `${major}.${minor}.${patch}`;
}
