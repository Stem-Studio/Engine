import {AssetType, getAsset, getAssetRevision, getSceneAssets} from "@stem/network/api/asset";
import {getBehaviorRevisionData} from "@stem/network/api/behavior";
import {getLambdaRevisionData} from "@stem/network/api/lambda";
import {getScriptRevisionData} from "@stem/network/api/script";
import {getAssetResolutionContext, resolveAssetRevisionId, setAssetRevision} from "@stem/editor-oss/asset-management/AssetResolutionContext";
import global from "@stem/editor-oss/global";
import {seedScriptDependencyEntry} from "../../script-runtime/scriptDependencyCache";
import {buildNameAwareScriptImportContext, getScriptImportDependencyMap} from "../../script-runtime/scriptImportCore";
import {isScriptsEnabled} from "@stem/editor-oss/utils/featureFlags";
import {updateSceneBehaviorRevision} from "../behaviors/util";

type SceneScriptAssetType = typeof AssetType.Behavior | typeof AssetType.Lambda | typeof AssetType.Script;

type SceneScriptAssetRef = {
    assetId: string;
    revisionId: string;
    type: SceneScriptAssetType;
};

type ScriptDependents = {
    behaviors: SceneScriptAssetRef[];
    lambdas: SceneScriptAssetRef[];
};

const loadRevisionDependencies = async (
    assetId: string,
    revisionId: string,
): Promise<Record<string, string>> => {
    const revision = await getAssetRevision(assetId, revisionId, {
        includeDependencies: true,
    });

    return revision.dependencies || {};
};

const dependsOnScriptAsset = async (
    assetId: string,
    revisionId: string,
    targetImportAssetId: string,
    visited = new Set<string>(),
): Promise<boolean> => {
    const key = `${assetId}:${revisionId}`;
    if (visited.has(key)) {
        return false;
    }
    visited.add(key);

    const dependencies = await loadRevisionDependencies(assetId, revisionId);
    if (dependencies[targetImportAssetId]) {
        return true;
    }

    for (const [depAssetId, depRevisionId] of Object.entries(dependencies)) {
        const depAsset = await getAsset(depAssetId);
        if (depAsset.type !== AssetType.Script) {
            continue;
        }

        if (await dependsOnScriptAsset(depAssetId, depRevisionId, targetImportAssetId, visited)) {
            return true;
        }
    }

    return false;
};

export const findScriptAssetDependents = async (importAssetId: string): Promise<ScriptDependents> => {
    if (!isScriptsEnabled()) {
        return {behaviors: [], lambdas: []};
    }

    const sceneId = global.app?.editor?.sceneID;
    const scene = global.app?.scene;
    const context = scene ? getAssetResolutionContext(scene) : null;

    if (!sceneId || !scene || !context) {
        return {behaviors: [], lambdas: []};
    }

    const {assets} = await getSceneAssets(sceneId, {
        types: [AssetType.Behavior, AssetType.Lambda, AssetType.Script],
    });

    const behaviors: SceneScriptAssetRef[] = [];
    const lambdas: SceneScriptAssetRef[] = [];

    for (const asset of assets) {
        const revisionId = resolveAssetRevisionId(asset.id, context);
        if (!revisionId) {
            continue;
        }

        if (asset.id === importAssetId) {
            continue;
        }

        if (!(await dependsOnScriptAsset(asset.id, revisionId, importAssetId))) {
            continue;
        }

        if (asset.type === AssetType.Behavior) {
            behaviors.push({assetId: asset.id, revisionId, type: AssetType.Behavior});
        } else if (asset.type === AssetType.Lambda) {
            lambdas.push({assetId: asset.id, revisionId, type: AssetType.Lambda});
        }
    }

    return {behaviors, lambdas};
};

export const refreshDependentScriptsForScript = async (importAssetId: string): Promise<void> => {
    if (!isScriptsEnabled()) {
        return;
    }
    const app = global.app;
    const editor = app?.editor;
    if (!app || !editor) {
        return;
    }

    await editor.loadBackendImportSources();

    const {behaviors, lambdas} = await findScriptAssetDependents(importAssetId);

    for (const behavior of behaviors) {
        const {config, code} = await getBehaviorRevisionData(behavior.assetId, behavior.revisionId);
        await updateSceneBehaviorRevision({
            assetId: behavior.assetId,
            revisionId: behavior.revisionId,
            code,
            config: config as any,
        });
    }

    for (const lambda of lambdas) {
        const {config, code} = await getLambdaRevisionData(lambda.assetId, lambda.revisionId);
        const sceneContext = app.scene ? getAssetResolutionContext(app.scene) || undefined : undefined;
        const importContext = await buildNameAwareScriptImportContext(editor.sceneID, sceneContext);
        const dependencies = getScriptImportDependencyMap(code, importContext);
        seedScriptDependencyEntry({
            assetId: lambda.assetId,
            revisionId: lambda.revisionId,
            ownerType: "lambda",
            dependencies,
        });

        editor.lambdaConfigRegistry.updateConfig(config.id, config, true);
        editor.lambdaConfigRegistry.setAssetMeta(config.id, {
            assetId: lambda.assetId,
            revisionId: lambda.revisionId,
        });

        await app.game?.ensureLambdaClassLoaded({
            lambdaId: config.id,
            assetId: lambda.assetId,
            revisionId: lambda.revisionId,
            config,
            code,
            forceReload: true,
        });
    }
};

export const updateSceneScriptRevision = async ({
    assetId,
    revisionId,
    code,
}: {
    assetId: string;
    revisionId: string;
    code: string;
}): Promise<void> => {
    if (!isScriptsEnabled()) {
        return;
    }
    const app = global.app;
    const editor = app?.editor;
    const scene = app?.scene;
    const sceneContext = scene ? getAssetResolutionContext(scene) || undefined : undefined;

    if (!app || !editor || !scene) {
        return;
    }

    const importContext = await buildNameAwareScriptImportContext(editor.sceneID, sceneContext);

    seedScriptDependencyEntry({
        assetId,
        revisionId,
        ownerType: "import",
        dependencies: getScriptImportDependencyMap(code, importContext),
    });

    setAssetRevision(scene, assetId, revisionId);
    app.call("objectChanged", null, scene);

    await refreshDependentScriptsForScript(assetId);
};

export const seedSceneScriptDependencyEntry = async (assetId: string, revisionId: string): Promise<void> => {
    if (!isScriptsEnabled()) {
        return;
    }
    const scene = global.app?.scene;
    const context = scene ? getAssetResolutionContext(scene) || undefined : undefined;
    const importContext = await buildNameAwareScriptImportContext(global.app?.editor?.sceneID, context);
    const {code} = await getScriptRevisionData(assetId, revisionId);
    seedScriptDependencyEntry({
        assetId,
        revisionId,
        ownerType: "import",
        dependencies: getScriptImportDependencyMap(code, importContext),
    });
};
