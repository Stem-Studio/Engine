import {Scene} from "three";

import EngineRuntime from "@web-shared/EngineRuntime";
import {assetRefKey} from "@web-shared/asset-management/AssetRef";
import {
    getAssetResolutionContext,
    resolveAssetRevisionId,
    type ReadonlyAssetResolutionContext,
} from "@web-shared/asset-management/AssetResolutionContext";
import {isSceneBehaviorsMigrated} from "@stem/editor-oss/editor/behaviors/LegacyBehaviorMigration";
import global from "@web-shared/global";
import type {LambdaConfig} from "@web-shared/lambdas/Lambda";
import Ajax from "@web-shared/utils/Ajax";
import {backendUrlFromPath} from "@web-shared/utils/UrlUtils";
import {AssetType, getAsset, getAssetDerivatives, getAssetRevisionData, GetAssetRevisionDataOptions, getMyAssets, getSceneAssets} from "../asset";
import type {AccessContext} from "../client";

export type LegacyBehaviorBackendData = {
    ID: string;
    Config: string;
    Code: string;
    CreatedAt: string;
    UpdatedAt: string;
};

type InternalBehaviorData = {
    ID: string;
    RevisionID?: string;
    Config: string;
    Code: string;
    CreatedAt: string;
    UpdatedAt: string;
};

export type BehaviorBackendData = {
    ID: string;
    RevisionID?: string;
    Config: Record<string, any>;
    Code: string;
    CreatedAt: string;
    UpdatedAt: string;
};

const expandConfig = (behavior: InternalBehaviorData): BehaviorBackendData => ({
    ...behavior,
    Config: {
        ...JSON.parse(behavior.Config),
        id: behavior.ID,
    },
});

export const legacyEditBehavior = async (id: string, config: string, code: string): Promise<void> => {
    try {
        const response = await Ajax.post({
            url: backendUrlFromPath(`/api/Behavior/Edit`),
            data: {
                ID: id,
                Config: config,
                Code: code,
            },
            msgBodyType: "urlEncoded",
        });

        if (response?.data.Code !== 200) {
            throw new Error(response?.data.Msg || "Failed to edit behavior.");
        }
    } catch (error) {
        console.error("Error editing behavior:", error);
        throw new Error((error instanceof Error ? error.message : "") || "Failed to edit behavior.");
    }
};

export const legacyAddBehaviorToScene = async (id: string, sceneId: string): Promise<void> => {
    try {
        const response = await Ajax.post({
            url: backendUrlFromPath(`/api/Behavior/AddToScene`),
            data: {
                ID: id,
                SceneID: sceneId,
            },
            msgBodyType: "urlEncoded",
        });

        if (response?.data.Code !== 200) {
            throw new Error(response?.data.Msg || "Failed to add behavior to scene.");
        }
    } catch (error) {
        console.error("Error adding behavior to scene:", error);
        throw new Error((error instanceof Error ? error.message : "") || "Failed to add behavior to scene.");
    }
};

export const getBehaviorRevisionData = async (
    id: string,
    revisionId: string,
    options?: GetAssetRevisionDataOptions,
): Promise<{config: Record<string, any>; code: string}> => {
    const data = await getAssetRevisionData(id, revisionId, "json", options);
    return {
        config: {
            ...JSON.parse(data.config),
            id,
        },
        code: data.code,
    };
};

const legacyGetBehaviorsList = async (): Promise<LegacyBehaviorBackendData[]> => {
    try {
        const response = await Ajax.get({
            url: backendUrlFromPath(`/api/Behavior/List`),
        });

        if (response?.data.Code !== 200) {
            throw new Error(response?.data.Msg || "Failed to list behaviors.");
        }

        return response.data.Data;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Error listing behaviors:", message);
        throw new Error(message || "Failed to list behaviors.");
    }
};

export const getBehaviorsList = async (): Promise<BehaviorBackendData[]> => {
    // TODO: This is super-inefficient. We should never need to fetch all
    // behaviors (including their data) at once. This function should probably
    // just return behavior IDs and perhaps some metadata, like the behavior
    // names.
    const legacyBehaviors = (await legacyGetBehaviorsList()).map(behavior => ({
        ...behavior,
    }));

    const app = global.app as EngineRuntime | undefined | null;
    const scene = app?.scene;
    let newBehaviors: InternalBehaviorData[] = [];

    if (scene) {
        const apiClientOptions = {
            context: "user" as AccessContext,
        };

        const {assets: behaviorAssets} = await getMyAssets({
            types: [AssetType.Behavior],
        });

        const behaviorData = await Promise.all(
            behaviorAssets.map(async asset => {
                const {headRevisionId} = await getAsset(asset.id, { apiClientOptions });
                const {config, code} = await getAssetRevisionData(asset.id, headRevisionId, "json", { apiClientOptions });
                return {
                    ID: asset.id,
                    RevisionID: headRevisionId,
                    Config: typeof config === "string" ? config : JSON.stringify(config),
                    Code: code,
                    CreatedAt: asset.createTime,
                    UpdatedAt: asset.updateTime,
                };
            }),
        );

        newBehaviors = behaviorData.filter(data => data !== null);
    }

    return [...legacyBehaviors, ...newBehaviors].map(expandConfig);
};

export const legacyGetBehaviorsListForScene = async (_sceneId: string): Promise<LegacyBehaviorBackendData[]> => {
    return [];
};

/**
 * Load behavior configs and code from a pre-fetched list of behavior assets.
 *
 * @param behaviorAssets - The behavior assets to load (must already be filtered to type Behavior)
 * @param scene - The scene whose AssetResolutionContext determines which revision to load
 * @returns Parsed behavior data ready for registry registration
 */
export const getBehaviorsFromAssets = async (behaviorAssets: {id: string; createTime: string; updateTime: string}[], scene: Scene): Promise<BehaviorBackendData[]> => {
    const context = getAssetResolutionContext(scene);
    if (!context) {
        return [];
    }

    const behaviorData = await Promise.all(
        behaviorAssets.map(async asset => {
            const revisionId = resolveAssetRevisionId(asset.id, context);
            if (!revisionId) {
                console.warn(`No current revision found for behavior ${asset.id}`);
                return null;
            }
            const {config, code} = await getAssetRevisionData(asset.id, revisionId, "json");
            return {
                ID: asset.id,
                RevisionID: revisionId,
                Config: typeof config === "string" ? config : JSON.stringify(config),
                Code: code,
                CreatedAt: asset.createTime,
                UpdatedAt: asset.updateTime,
            };
        }),
    );

    return behaviorData.filter(data => data !== null).map(expandConfig);
};

export const getBehaviorsListForScene = async (sceneId: string, scene: Scene): Promise<BehaviorBackendData[]> => {
    // Skip loading legacy behaviors if scene has been migrated to Assets API
    const isMigrated = isSceneBehaviorsMigrated(scene);
    const legacyBehaviors = isMigrated
        ? []
        : (await legacyGetBehaviorsListForScene(sceneId)).map(behavior => ({
              ...behavior,
          }));

    const {assets: behaviorAssets} = await getSceneAssets(sceneId, {
        types: [AssetType.Behavior],
    });

    let newBehaviors: InternalBehaviorData[] = [];
    const context = getAssetResolutionContext(scene);

    if (context) {
        const behaviorData = await Promise.all(
            behaviorAssets.map(async asset => {
                const revisionId = resolveAssetRevisionId(asset.id, context);
                if (!revisionId) {
                    console.warn(`No current revision found for behavior ${asset.id}`);
                    return Promise.resolve(null);
                }
                const {config, code} = await getAssetRevisionData(asset.id, revisionId, "json");
                if (config === undefined || config === null) {
                    // No payload resolved (e.g. a local asset whose revision
                    // data couldn't be decoded). Skip rather than feeding
                    // `JSON.parse(undefined)` into expandConfig.
                    console.warn(`No config payload for behavior ${asset.id}`);
                    return Promise.resolve(null);
                }
                return {
                    ID: asset.id,
                    RevisionID: revisionId,
                    Config: typeof config === "string" ? config : JSON.stringify(config), //for behaviors added dynamically config is already parsed
                    Code: code,
                    CreatedAt: asset.createTime,
                    UpdatedAt: asset.updateTime,
                };
            }),
        );

        newBehaviors = behaviorData.filter(data => data !== null);
    }

    return [...legacyBehaviors, ...newBehaviors].map(expandConfig);
};

export type BehaviorImport = {
    ID: string;
    Config: string;
    Code: string;
};

export type BulkImportResponse = {
    imported: number;
    skipped: number;
};

export const bulkImport = async (behaviors: BehaviorImport[]): Promise<BulkImportResponse> => {
    try {
        const response = await Ajax.post({
            url: backendUrlFromPath(`/api/Behavior/BulkImport`),
            data: JSON.stringify(behaviors),
            msgBodyType: "json",
        });

        if (response?.data.Code !== 200) {
            throw new Error(response?.data.Msg || "Failed to bulk import behaviors.");
        }

        return response.data.Data;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Error bulk importing behaviors:", message);
        throw new Error(message || "Failed to bulk import behaviors.");
    }
};

// Published script bundle types for play mode.
export interface ScriptBundle {
    version: number;
    behaviors?: Record<string, BundledBehavior>;
    lambdas?: Record<string, BundledLambda>;
    imports?: Record<string, BundledImport>;
    scripts?: Record<string, BundledImport>;
}

export interface BundledBehavior {
    revisionId: string;
    config: string;
    code: string;
}

export interface BundledLambda {
    revisionId: string;
    config: string;
    code: string;
}

export interface BundledImport {
    revisionId: string;
    code: string;
    name?: string;
}

export type BundledImportRevisionMap = Record<
    string,
    {
        assetId: string;
        revisionId: string;
        code: string;
    }
>;

export type BundledLambdaBackendData = {
    ID: string;
    RevisionID: string;
    Config: LambdaConfig;
    Code: string;
};

/**
 * Fetches a behavior bundle for a scene asset revision.
 * Returns null if no bundle exists (e.g., scene not published, or no behaviors).
 * 
 * @param sceneAssetId - The ID of the scene asset
 * @param sceneRevisionId - The ID of the scene revision
 * @returns A Promise that resolves to the behavior bundle or null.
 */
export const getBehaviorBundle = async (
    sceneAssetId: string,
    sceneRevisionId: string,
): Promise<ScriptBundle | null> => {
    // Fetch derivatives for the scene asset/revision
    const derivatives = await getAssetDerivatives(sceneAssetId, sceneRevisionId, {
        includeDataUrl: true,
    });

    // Find behavior bundle derivative
    const bundleDerivative = derivatives.find(d => d.type === "behaviorBundle");
    if (!bundleDerivative?.dataUrl) {
        return null;
    }

    // Fetch and parse bundle
    const response = await fetch(bundleDerivative.dataUrl);
    if (!response.ok) {
        console.warn("Failed to fetch behavior bundle:", response.status);
        return null;
    }

    return response.json();
};

export const getBehaviorsFromScriptBundle = (bundle: ScriptBundle | null): BehaviorBackendData[] | null => {
    const behaviors = bundle?.behaviors ?? {};
    if (Object.keys(behaviors).length === 0) {
        return null;
    }

    return Object.entries(behaviors).map(([assetId, behavior]) => {
        let config: Record<string, any>;
        try {
            config = JSON.parse(behavior.config);
        } catch (parseErr) {
            console.warn(`[getBehaviorsFromScriptBundle] Failed to parse config for behavior ${assetId}:`, parseErr);
            throw parseErr;
        }

        return {
            ID: assetId,
            RevisionID: behavior.revisionId,
            Config: config,
            Code: behavior.code,
            CreatedAt: "",
            UpdatedAt: "",
        };
    });
};

export const getLambdasFromScriptBundle = (bundle: ScriptBundle | null): BundledLambdaBackendData[] | null => {
    const lambdas = bundle?.lambdas ?? {};
    if (Object.keys(lambdas).length === 0) {
        return null;
    }

    return Object.entries(lambdas).map(([assetId, lambda]) => {
        let config: LambdaConfig;
        try {
            const parsedConfig = JSON.parse(lambda.config) as LambdaConfig;
            config = {
                ...parsedConfig,
                id: parsedConfig.id || assetId,
            };
        } catch (parseErr) {
            console.warn(`[getLambdasFromScriptBundle] Failed to parse config for lambda ${assetId}:`, parseErr);
            throw parseErr;
        }

        return {
            ID: assetId,
            RevisionID: lambda.revisionId,
            Config: config,
            Code: lambda.code,
        };
    });
};

export const getImportRevisionMapFromScriptBundle = (bundle: ScriptBundle | null): BundledImportRevisionMap => {
    if (!bundle) {
        return {};
    }

    const imports = {...(bundle.scripts ?? {}), ...(bundle.imports ?? {})};
    return Object.entries(imports).reduce((acc, [assetId, importAsset]) => {
        acc[assetRefKey({assetId, revisionId: importAsset.revisionId})] = {
            assetId,
            revisionId: importAsset.revisionId,
            code: importAsset.code,
        };
        return acc;
    }, {} as BundledImportRevisionMap);
};

export const getImportResolutionContextFromScriptBundle = (
    bundle: ScriptBundle | null,
): ReadonlyAssetResolutionContext => {
    if (!bundle) {
        return {};
    }

    const imports = {...(bundle.scripts ?? {}), ...(bundle.imports ?? {})};
    return Object.entries(imports).reduce(
        (acc, [assetId, importAsset]) => {
            acc.assetIdToRevisionId[assetId] = importAsset.revisionId;

            const normalizedName = importAsset.name?.trim().toLowerCase();
            if (normalizedName) {
                acc.nameToAssetId[normalizedName] = assetId;
            }

            return acc;
        },
        {
            assetIdToRevisionId: {},
            nameToAssetId: {},
        } as {
            assetIdToRevisionId: Record<string, string>;
            nameToAssetId: Record<string, string>;
        },
    );
};

/**
 * Attempts to load behaviors from a pre-bundled derivative for a scene.
 * Returns null if bundle is not available (scene not published, no behaviors, etc.).
 *
 * @param assetId - The ID of the scene asset
 * @param revisionId - The scene asset revision ID (required when bundlePromise is not provided)
 * @param bundlePromise - A pre-fetched bundle promise; when provided, revisionId is not used
 * @returns A Promise that resolves with behaviors in BehaviorBackendData format, or null
 */
export const getBehaviorsFromBundle = async (
    assetId: string,
    revisionId: string | undefined,
    bundlePromise?: Promise<ScriptBundle | null>
): Promise<BehaviorBackendData[] | null> => {
    try {
        let bundle: ScriptBundle | null;

        if (bundlePromise) {
            // Reuse the prefetched bundle — already in flight since setUpScene()
            bundle = await bundlePromise;
        } else {
            if (!revisionId) {
                console.warn("[getBehaviorsFromBundle] No bundlePromise or revision ID provided");
                return null;
            }
            bundle = await getBehaviorBundle(assetId, revisionId);
        }
        return getBehaviorsFromScriptBundle(bundle);
    } catch (err) {
        console.warn("[getBehaviorsFromBundle] Failed to load behavior bundle:", err);
        return null;
    }
};
