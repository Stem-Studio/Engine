import {
    type Asset,
    type AssetRevision,
    type CreateAssetRevisionWithDataParams,
    type CreateAssetWithDataParams,
    createAssetRevisionWithData as rawCreateAssetRevisionWithData,
    createAssetWithData as rawCreateAssetWithData,
    getAsset,
    getSceneAssets,
} from "@stem/network/api/asset";
import type {DomainAssetType} from "@stem/network/api/client/api";
import {createSceneAssetWithData as rawCreateSceneAssetWithData, removeAssetsFromScene, updateSceneDependencies} from "@stem/network/api/scene/v2";
import {
    getAssetResolutionContext,
    removeAssetRevision as removeAssetRevisionOnObject,
    setAssetRevision as setAssetRevisionOnObject,
} from "@stem/editor-oss/asset-management/AssetResolutionContext";
import global from "@stem/editor-oss/global";

/**
 * Response type matching the shape returned by getSceneAssets.
 */
export type AssetSourceResponse = {
    assets: Asset[];
};

/**
 * Options for querying assets from an AssetSource.
 */
export type AssetSourceQueryOptions = {
    types?: DomainAssetType[];
    includeDerivatives?: boolean;
    includeDerivativeDataUrl?: boolean;
    includeLatestRelease?: boolean;
    includeThumbnails?: boolean;
};

export type CreateAssetInSourceParams = CreateAssetWithDataParams & {
    /** Update dependency context now but let a caller-managed batch emit objectChanged later. */
    deferSceneSync?: boolean;
};

/**
 * Abstraction for asset discovery and dependency management. Allows the
 * editor, asset panels, and behavior/lambda registration to query and
 * modify available assets without knowing whether the backing source is
 * a scene or a stem.
 */
export interface AssetSource {
    /** Discriminator for the underlying editing context. */
    readonly kind: "scene" | "stem";

    /** ID of the backing scene or stem asset; combined with `kind` to scope React Query caches. */
    readonly id: string;

    /** Fetch assets matching the given options. */
    getAssets(options?: AssetSourceQueryOptions): Promise<AssetSourceResponse>;

    /** Add dependencies. Merges with existing dependencies. */
    addDependencies(dependencies: Record<string, string>): Promise<void>;

    /** Remove dependencies by asset ID. */
    removeDependencies(assetIds: string[]): Promise<void>;

    /** Create a new asset and add it as a dependency. */
    createAsset(params: CreateAssetInSourceParams): Promise<Asset>;

    /** Create a new revision for an existing asset. */
    createAssetRevision(params: CreateAssetRevisionWithDataParams): Promise<AssetRevision>;
}

/**
 * Asset source backed by a database scene. Delegates to getSceneAssets().
 */
export class SceneAssetSource implements AssetSource {
    readonly kind = "scene" as const;

    constructor(readonly id: string) {}

    async getAssets(options?: AssetSourceQueryOptions): Promise<AssetSourceResponse> {
        return getSceneAssets(this.id, options);
    }

    async addDependencies(dependencies: Record<string, string>): Promise<void> {
        const scene = global.app?.scene;
        const existing = scene ? (getAssetResolutionContext(scene)?.assetIdToRevisionId || {}) : {};
        const merged = {...existing, ...dependencies};
        await updateSceneDependencies(this.id, merged);

        if (scene) {
            for (const [assetId, revisionId] of Object.entries(dependencies)) {
                setAssetRevisionOnObject(scene, assetId, revisionId);
            }
            global.app?.call("objectChanged", null, scene);
        }
    }

    async removeDependencies(assetIds: string[]): Promise<void> {
        await removeAssetsFromScene(this.id, assetIds);

        const scene = global.app?.scene;
        if (scene) {
            for (const assetId of assetIds) {
                removeAssetRevisionOnObject(scene, assetId);
            }
            global.app?.call("objectChanged", null, scene);
        }
    }

    async createAsset(params: CreateAssetInSourceParams): Promise<Asset> {
        const {deferSceneSync, ...assetParams} = params;
        const asset = await rawCreateSceneAssetWithData({...assetParams, sceneId: this.id});

        const scene = global.app?.scene;
        if (scene) {
            setAssetRevisionOnObject(scene, asset.id, asset.headRevisionId);
            if (!deferSceneSync) {
                global.app?.call("objectChanged", null, scene);
            }
        }

        return asset;
    }

    async createAssetRevision(params: CreateAssetRevisionWithDataParams): Promise<AssetRevision> {
        return rawCreateAssetRevisionWithData(params);
    }
}

/**
 * Asset source backed by a stem's local dependency context. Reads and
 * writes the scene root's AssetResolutionContext directly. All changes
 * are local until the user explicitly saves, at which point the save
 * flow reads the local context and persists it as a new revision.
 */
export class StemAssetSource implements AssetSource {
    readonly kind = "stem" as const;

    constructor(readonly id: string) {}

    /** Get dependency asset IDs from the local context (excluding the stem's own entry). */
    private getDependencyAssetIds(): string[] {
        const scene = global.app?.scene;
        if (!scene) return [];
        const context = getAssetResolutionContext(scene);
        if (!context?.assetIdToRevisionId) return [];
        return Object.keys(context.assetIdToRevisionId).filter(assetId => assetId !== this.id);
    }

    async getAssets(options?: AssetSourceQueryOptions): Promise<AssetSourceResponse> {
        const depIds = this.getDependencyAssetIds();
        const results = await Promise.all(
            depIds.map(id =>
                getAsset(id, {
                    includeThumbnails: options?.includeThumbnails,
                    includeLatestRelease: options?.includeLatestRelease,
                }).catch(err => {
                    console.warn(`[StemAssetSource] Failed to fetch asset ${id}:`, err);
                    return null;
                }),
            ),
        );

        let assets = results.filter((a): a is Asset => a !== null);

        if (options?.types?.length) {
            const typeSet = new Set<string>(options.types as string[]);
            assets = assets.filter(a => typeSet.has(a.type));
        }

        return {assets};
    }

    addDependencies(dependencies: Record<string, string>): Promise<void> {
        const scene = global.app?.scene;
        if (!scene) return Promise.resolve();

        for (const [assetId, revisionId] of Object.entries(dependencies)) {
            setAssetRevisionOnObject(scene, assetId, revisionId);
        }
        global.app?.call("objectChanged", null, scene);

        return Promise.resolve();
    }

    removeDependencies(assetIds: string[]): Promise<void> {
        const scene = global.app?.scene;
        if (!scene) return Promise.resolve();

        for (const id of assetIds) {
            removeAssetRevisionOnObject(scene, id);
        }
        global.app?.call("objectChanged", null, scene);

        return Promise.resolve();
    }

    async createAsset(params: CreateAssetInSourceParams): Promise<Asset> {
        const {deferSceneSync, ...assetParams} = params;
        const asset = await rawCreateAssetWithData(assetParams);

        const scene = global.app?.scene;
        if (scene) {
            setAssetRevisionOnObject(scene, asset.id, asset.headRevisionId);

            // The server auto-adds the new asset as a dependency of the stem
            // when `X-Root-Asset-Id` is set, which bumps the stem's head
            // revision. Re-fetch and update the resolution context so the
            // next save branches off the current head instead of 409-ing.
            try {
                const stemAsset = await getAsset(this.id);
                if (stemAsset.headRevisionId) {
                    setAssetRevisionOnObject(scene, this.id, stemAsset.headRevisionId);
                }
            } catch (err) {
                console.warn("[StemAssetSource] Failed to refresh stem head revision after create:", err);
            }

            if (!deferSceneSync) {
                global.app?.call("objectChanged", null, scene);
            }
        }

        return asset;
    }

    async createAssetRevision(params: CreateAssetRevisionWithDataParams): Promise<AssetRevision> {
        return rawCreateAssetRevisionWithData(params);
    }
}
