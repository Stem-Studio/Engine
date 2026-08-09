import {getAssetResolutionContext, setAssetRevision} from "@stem/editor-oss/asset-management/AssetResolutionContext";
import global from "@stem/editor-oss/global";
import type {LambdaConfig} from "../../lambdas/Lambda";
import {seedScriptDependencyEntry} from "../../script-runtime/scriptDependencyCache";
import {buildNameAwareScriptImportContext, getScriptImportDependencyMap} from "../../script-runtime/scriptImportCore";

export interface UpdateLambdaRegistriesParams {
    lambdaId: string;
    config: LambdaConfig;
    /**
     * When set and different from lambdaId, the previous id is unregistered
     * before registering lambdaId. Used by fork-on-edit when an asset id
     * changes.
     */
    previousLambdaId?: string;
    /**
     * When provided, also pin the asset meta (assetId + revisionId) on the
     * registry under lambdaId. Lets callers fold the existing
     * `setAssetMeta` step into a single registry update.
     */
    assetMeta?: {assetId: string; revisionId: string};
}

/**
 * Update editor `lambdaConfigRegistry` (and the running game's
 * `lambdaManager` if the scene is playing) so the new lambda id resolves
 * to its config. Mirrors `updateBehaviorRegistries` for the behavior path.
 *
 * Single source of truth for the "register-or-update + optional asset
 * meta + runtime sync" sequence — used by LambdaEditor save, the AI
 * script-tool import flow, and the fork-on-edit dispatcher.
 *
 * @param params see {@link UpdateLambdaRegistriesParams}
 * @param params.lambdaId
 * @param params.config
 * @param params.previousLambdaId
 * @param params.assetMeta
 */
export const updateLambdaRegistries = ({lambdaId, config, previousLambdaId, assetMeta}: UpdateLambdaRegistriesParams) => {
    const editor = global.app?.editor;
    const registry = editor?.lambdaConfigRegistry;
    if (!registry) return;

    // Drop the old id's registry entry when an id swap is in flight, so
    // nothing in the editor still resolves through the stale id.
    if (previousLambdaId && previousLambdaId !== lambdaId && registry.getConfig(previousLambdaId)) {
        registry.unregisterConfig(previousLambdaId, true);
    }

    if (assetMeta) {
        registry.setAssetMeta(lambdaId, assetMeta);
    }

    if (registry.getConfig(lambdaId)) {
        registry.updateConfig(lambdaId, config, true);
    } else {
        registry.registerConfig(lambdaId, config, true);
    }

    // If a game is running, refresh the runtime lambda manager so any live
    // instances pick up the new config under this id. Called unconditionally
    // (mirrors prior behavior in LambdaEditor) — `updateConfig` just updates
    // a map and is benign even when no class is registered yet.
    const lambdaManager = global.app?.game?.lambdaManager;
    if (lambdaManager) {
        try {
            lambdaManager.updateConfig(lambdaId, config);
        } catch (err) {
            console.warn("[updateLambdaRegistries] Failed to update runtime lambdaManager:", err);
        }
    }
};

export interface UpdateSceneLambdaRevisionParams {
    assetId: string;
    revisionId: string;
    code: string;
    /** Serialized LambdaConfig — same shape the server stores. */
    configStr: string;
}

/**
 * Pin a new lambda revision into the current scene and refresh the
 * derived editor state so the UI reflects the change. Mirrors
 * `updateSceneBehaviorRevision` for the lambda path.
 *
 * Steps, in order:
 *   1. seed import-dependency cache for the new revision
 *   2. refresh `lambdaConfigRegistry` (and runtime `lambdaManager`) via
 *      {@link updateLambdaRegistries}
 *   3. write the new revision into the scene's `AssetResolutionContext`
 *   4. fire `objectChanged` so React consumers re-read the context — this
 *      is what advances `RevisionSection`'s "Current" indicator and the
 *      asset tree's `headRevisionId`
 *
 * Live lambda instances are NOT re-instantiated here. The editor doesn't
 * run lambdas; the runtime engine instantiates them fresh from the pinned
 * revision when the scene plays.
 * @param root0
 * @param root0.assetId
 * @param root0.revisionId
 * @param root0.code
 * @param root0.configStr
 */
export const updateSceneLambdaRevision = async ({
    assetId,
    revisionId,
    code,
    configStr,
}: UpdateSceneLambdaRevisionParams): Promise<void> => {
    const app = global.app;
    const editor = app?.editor;
    const scene = app?.scene;
    if (!app || !editor || !scene) return;

    let config: LambdaConfig;
    try {
        config = JSON.parse(configStr) as LambdaConfig;
    } catch (err) {
        console.error("[updateSceneLambdaRevision] Failed to parse config:", err);
        return;
    }

    const sceneContext = getAssetResolutionContext(scene) || undefined;
    const importContext = await buildNameAwareScriptImportContext(editor.sceneID, sceneContext);
    const dependencies = getScriptImportDependencyMap(code, importContext);
    seedScriptDependencyEntry({
        assetId,
        revisionId,
        ownerType: "lambda",
        dependencies,
    });

    // Lambda components reference lambdas via `component.lambdaId = config.id`,
    // so the registry must be keyed by `config.id`. Fall back to the asset id
    // for malformed configs that lack one.
    updateLambdaRegistries({
        lambdaId: config.id ?? assetId,
        config,
        assetMeta: {assetId, revisionId},
    });

    setAssetRevision(scene, assetId, revisionId);
    app.call("objectChanged", null, scene);
};
