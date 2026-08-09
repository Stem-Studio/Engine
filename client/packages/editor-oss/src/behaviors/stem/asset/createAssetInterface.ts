import { Texture } from 'three';

import { AssetDerivativesParams, CreateAssetReleaseParams, CreateFromUrlParams, StemAsset, StemAssetAudio, StemAssetFile, StemAssetImage, StemAssetModel, StemAssetScript, StemAssetStem, StemAssetVideo, GetMyAssetsOptions } from './StemAsset';
import { Asset, AssetRelease, AssetType, createAsset, createAssetImport, waitForAssetImport ,
    createAssetRelease as apiCreateAssetRelease,
    getAssetDerivatives as apiGetAssetDerivatives,
    getMyAssets as apiGetMyAssets,
    getSceneAssets,
} from '@stem/network/api/asset';
import { DomainAssetType } from '@stem/network/api/client/api';
import { getScriptRevisionData } from '@stem/network/api/script';
import EngineRuntime from '@stem/editor-oss/EngineRuntime';
import { AssetRef } from '@stem/editor-oss/asset-management/AssetRef';
import GameManager from '../../../behaviors/game/GameManager';
import { parseScriptImports } from '../../../script-runtime/scriptImportCore';
import { createGameObject } from '../core/createGameObject';
import { GameObject } from '../core/GameObject';

const resolveAssetByName = async (
    engine: EngineRuntime,
    name: string,
    assetType: DomainAssetType,
): Promise<AssetRef | null> => {
    const sceneId = engine.editor?.sceneID;
    if (!sceneId) return null;

    const { assets } = await getSceneAssets(sceneId, { types: [assetType] });
    const match = assets.find(a => a.name.toLowerCase() === name.toLowerCase());
    if (!match) return null;

    const revisionId = match.revisionId || match.headRevisionId;
    return { assetId: match.id, revisionId };
};

const createAssetImageInterface = (engine: EngineRuntime): StemAssetImage => {
    return {
        async createTexture(assetRef: AssetRef): Promise<Texture> {
            return engine.assetLoader.createTexture(assetRef);
        },
        async findByName(name: string): Promise<AssetRef | null> {
            return resolveAssetByName(engine, name, AssetType.Image);
        },
        async getUrl(assetRef: AssetRef): Promise<string> {
            const result = await engine.assetLoader.getImageDataUrl(assetRef);
            return result.url;
        },
    };
};

const createAssetAudioInterface = (engine: EngineRuntime): StemAssetAudio => ({
    async getUrl(assetRef: AssetRef): Promise<string> {
        const revision = await engine.assetLoader.getAssetRevision(assetRef);
        if (!revision?.dataUrl) throw new Error('No data URL for audio asset');
        return revision.dataUrl;
    },
    async getUrlByName(name: string): Promise<string> {
        const resolved = await resolveAssetByName(engine, name, AssetType.Audio);
        if (!resolved) throw new Error(`Audio asset not found by name: "${name}"`);
        const revision = await engine.assetLoader.getAssetRevision(resolved);
        if (!revision?.dataUrl) throw new Error('No data URL for audio asset');
        return revision.dataUrl;
    },
    async findByName(name: string): Promise<AssetRef | null> {
        return resolveAssetByName(engine, name, AssetType.Audio);
    },
});

const createAssetVideoInterface = (engine: EngineRuntime): StemAssetVideo => ({
    async getUrl(assetRef: AssetRef): Promise<string> {
        const revision = await engine.assetLoader.getAssetRevision(assetRef);
        if (!revision?.dataUrl) throw new Error('No data URL for video asset');
        return revision.dataUrl;
    },
    async getUrlByName(name: string): Promise<string> {
        const resolved = await resolveAssetByName(engine, name, AssetType.Video);
        if (!resolved) throw new Error(`Video asset not found by name: "${name}"`);
        const revision = await engine.assetLoader.getAssetRevision(resolved);
        if (!revision?.dataUrl) throw new Error('No data URL for video asset');
        return revision.dataUrl;
    },
    async findByName(name: string): Promise<AssetRef | null> {
        return resolveAssetByName(engine, name, AssetType.Video);
    },
});

const createAssetScriptInterface = (engine: EngineRuntime): StemAssetScript => {
    // Cache Blob URLs by (assetId, revisionId). A revision change yields a new
    // cache key, so stale URLs naturally fall out; the old Blob URL is simply
    // not referenced anymore (browser GC reclaims when the page reloads).
    const urlCache = new Map<string, string>();

    const buildUrl = async (assetRef: AssetRef): Promise<string> => {
        const cacheKey = `${assetRef.assetId}:${assetRef.revisionId}`;
        const cached = urlCache.get(cacheKey);
        if (cached) return cached;

        const data = await getScriptRevisionData(assetRef.assetId, assetRef.revisionId);
        // Strip `@import` directives — they are behavior-runtime sugar and
        // would be syntax errors in a worker / standalone-eval realm.
        const stripped = parseScriptImports(data.code).code;
        const blob = new Blob([stripped], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        urlCache.set(cacheKey, url);
        return url;
    };

    return {
        async getUrl(assetRef: AssetRef): Promise<string> {
            return buildUrl(assetRef);
        },
        async getUrlByName(name: string): Promise<string> {
            const resolved = await resolveAssetByName(engine, name, AssetType.Script);
            if (!resolved) throw new Error(`Script asset not found by name: "${name}"`);
            return buildUrl(resolved);
        },
        async findByName(name: string): Promise<AssetRef | null> {
            return resolveAssetByName(engine, name, AssetType.Script);
        },
    };
};

const createAssetFileInterface = (engine: EngineRuntime): StemAssetFile => ({
    async getUrl(assetRef: AssetRef): Promise<string> {
        const revision = await engine.assetLoader.getAssetRevision(assetRef);
        if (!revision?.dataUrl) throw new Error('No data URL for file asset');
        return revision.dataUrl;
    },
    async getUrlByName(name: string): Promise<string> {
        const resolved = await resolveAssetByName(engine, name, AssetType.File);
        if (!resolved) throw new Error(`File asset not found by name: "${name}"`);
        const revision = await engine.assetLoader.getAssetRevision(resolved);
        if (!revision?.dataUrl) throw new Error('No data URL for file asset');
        return revision.dataUrl;
    },
    async findByName(name: string): Promise<AssetRef | null> {
        return resolveAssetByName(engine, name, AssetType.File);
    },
});

const createAssetModelInterface = (engine: EngineRuntime, game?: GameManager): StemAssetModel => {
    return {
        async createFromUrl(params: CreateFromUrlParams): Promise<Asset> {
            const importItem = {
                referenceId: params.name,
                contentType: params.contentType,
                dataUrl: params.url,
            };

            const importResult = await createAssetImport([importItem]);
            const completedImport = await waitForAssetImport(importResult.id);

            const job = completedImport.jobs[0];
            if (!job || job.status !== "success" || !job.uploadId) {
                throw new Error(`Failed to import model from URL: ${params.url}`);
            }

            const asset = await createAsset({
                type: AssetType.Model,
                format: params.format,
                contentType: params.contentType,
                name: params.name,
                uploadId: job.uploadId,
            });

            return asset;
        },
        async preload(assetRef: AssetRef): Promise<void> {
            return engine.assetInstanceManager.preloadModel(assetRef);
        },
        async createInstance(assetRef: AssetRef): Promise<GameObject> {
            const model = await engine.assetInstanceManager.createModelInstance(assetRef);
            return createGameObject(model, game);
        },
        unload(assetRef: AssetRef): void {
            engine.assetInstanceManager.unloadModel(assetRef);
        },
        async findByName(name: string): Promise<AssetRef | null> {
            return resolveAssetByName(engine, name, AssetType.Model);
        },
    };
};

const createAssetStemInterface = (engine: EngineRuntime, game?: GameManager): StemAssetStem => ({
    async preload(assetRef: AssetRef): Promise<void> {
        return engine.assetInstanceManager.preloadPrefab(assetRef);
    },
    async createInstance(assetRef: AssetRef): Promise<GameObject> {
        const object = await engine.assetInstanceManager.createPrefabInstance(assetRef);
        return createGameObject(object, game);
    },
    unload(assetRef: AssetRef): void {
        engine.assetInstanceManager.unloadPrefab(assetRef);
    },
    async findByName(name: string): Promise<AssetRef | null> {
        return resolveAssetByName(engine, name, AssetType.Prefab);
    },
});

export const createAssetInterface = (engine: EngineRuntime, game?: GameManager): StemAsset => {
    return {
        async createAssetRelease(params: CreateAssetReleaseParams): Promise<AssetRelease> {
            const result = await apiCreateAssetRelease(params);
            return result;
        },
        async getAssetDerivatives(params: AssetDerivativesParams) {
            const result = await apiGetAssetDerivatives(params.assetId, params.revisionId, { includeDataUrl: true });
            return result;
        },
        async getMyAssets(options?: GetMyAssetsOptions): Promise<Asset[]> {
            const result = await apiGetMyAssets(options);
            return result.assets;
        },
        model: createAssetModelInterface(engine, game),
        image: createAssetImageInterface(engine),
        audio: createAssetAudioInterface(engine),
        video: createAssetVideoInterface(engine),
        stem: createAssetStemInterface(engine, game),
        file: createAssetFileInterface(engine),
        script: createAssetScriptInterface(engine),
    };
};
