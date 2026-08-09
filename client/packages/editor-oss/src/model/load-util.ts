import { Object3D } from 'three';

import { lookupOssAsset, SUPPORTED_MODEL_FORMATS_REGEX } from '@stem/network/api/asset';

import type JSZip from 'jszip';
import type { AssetLoader } from '../asset-management/AssetLoader';
import { AssetResolutionContext, resolveAssetId, resolveAssetRevisionId } from '../asset-management/AssetResolutionContext';
import type ModelLoader from '../assets/js/loaders/ModelLoader';
import { UploadSettings } from '../editor/assets/v2/LeftPanel/MainTabs/AssetsTab/ModelUpload/types';
import global from '../global';
import type { TextureOverrides } from '../texture/TextureMapping';
import { DetectDevice } from '../utils/DetectDevice';
import { LOD_LEVEL_DESKTOP, LOD_LEVEL_MOBILE } from './lodLevels';
import { isSupportedModelFormat, setModelId, setModelRevisionId } from './util';

export { LOD_LEVEL_DESKTOP, LOD_LEVEL_MOBILE } from './lodLevels';

const GAUSSIAN_SPLAT_PLY_METADATA_KEY = 'gaussianSplatPly';

export const getBestLodForPlatform = (): number => {
    return DetectDevice.isMobile() ? LOD_LEVEL_MOBILE : LOD_LEVEL_DESKTOP;
};

const replaceExtension = (name: string, ext: string) => name.replace(/\.[^/.]+$/, "") + ext;

/**
 * Resolve a model's revision id from the scene's asset-resolution context,
 * falling back to the local asset registry. In local storage the dependency map does not
 * always round-trip through a save/reload, but the registry — re-seeded from
 * the ProjectStore on scene load — always knows the head revision for a
 * synthesized asset. Returns undefined when neither source has it.
 */
const resolveModelRevisionId = (
    modelId: string,
    resolvedModelId: string,
    context: AssetResolutionContext,
): string | undefined =>
    resolveAssetRevisionId(modelId, context)
    ?? lookupOssAsset(resolvedModelId)?.revisionId;

export const createLods = async (
    sourceBuffer: ArrayBuffer,
    fileName: string,
    settings: UploadSettings,
    signal: AbortSignal,
) => {
    if (!settings.lodSettings?.length) {
        return [];
    }

    const {optimizeGlbFileWithStats} = await import("../utils/ModelUtils");
    const modelBuffer = sourceBuffer;
    signal.throwIfAborted();
    const lods = [];

    for (let idx = 0; idx < settings.lodSettings.length; idx++) {
        const lodSettings = settings.lodSettings[idx];
        if (!lodSettings) continue;
        const level = idx + 1;

        const targetReduction = lodSettings.vertexRetention / 100;

        signal.throwIfAborted();

        const {glbData: optimizedBuffer, stats} = await optimizeGlbFileWithStats(modelBuffer, {
            simplifyRatio: targetReduction,
            simplifyError: 0.001,
            compressTextures: settings.compressTextures,
            maxTextureSize: settings.maxTextureSize || undefined,
            textureScale: lodSettings.textureScale / 100,
            removeMorphTargets: true,
            useMeshopt: true,
        });

        signal.throwIfAborted();

        lods.push({
            level,
            file: new File([optimizedBuffer], `${replaceExtension(fileName, "")}_${level}.glb`, {
                type: "model/gltf-binary",
            }),
            vertexCount: stats.vertexCount,
            polygonCount: stats.triangleCount,
            compression: {
                vertexRetention: targetReduction,
                textureScale: lodSettings.textureScale / 100,
                method: "meshopt",
            },
        });
    }

    return lods;
};

type LoadModelOptions = {
    priority?: number;
    preferLod?: number;
};

export const loadModel = async (
    modelId: string,
    context: AssetResolutionContext,
    options: LoadModelOptions = {},
    useDefault: boolean = false,
): Promise<Object3D> => {
    const resolvedModelId = resolveAssetId(modelId, context);
    const revisionId = useDefault ? resolvedModelId : resolveModelRevisionId(modelId, resolvedModelId, context);
    if (!revisionId) {
        throw new Error(`Failed to resolve revision ID for model ID ${modelId}`);
    }
    const appAssetLoader = global.app?.assetLoader;
    if (!appAssetLoader) {
        // AssetLoader should always be available since we await seeding before scene load.
        // If we somehow get here, throw rather than silently making N API calls.
        throw new Error(
            `[loadModel] AssetLoader not available for model ${resolvedModelId}. ` +
            `Ensure createAssetLoader() is awaited before scene deserialization.`,
        );
    }
    return loadModelWithLoader(modelId, context, appAssetLoader, options);
};

/** Options for loading a model with an AssetLoader. */
type LoadModelWithLoaderOptions = {
    /** Loading priority for the model loader (higher = more urgent) */
    priority?: number;
    /** Override the automatic LOD level selection */
    preferLod?: number;
};

type RuntimeModelLoaderOptions = NonNullable<Parameters<ModelLoader["load"]>[1]>;
type AtlasDetectorModule = typeof import('../atlas/AtlasDetector');
type AtlasData = Awaited<ReturnType<AtlasDetectorModule["loadAtlas"]>>;

type ZipModelPackage = {
    rootFile: File;
    fileBlobMap: Map<string, Blob>;
    rootPath: string;
};

const ZIP_BASE64_PREFIX = "UEsDB";

const isUsdZipContainer = (format: string | undefined): boolean =>
    format === "usdz" || format === "kmz";

const createModelLoader = async (): Promise<ModelLoader> => {
    const { default: ModelLoaderClass } = await import('../assets/js/loaders/ModelLoader');
    return new ModelLoaderClass();
};

const hasGaussianSplatPlyMetadata = (metadata: Record<string, unknown> | null | undefined): boolean => {
    return metadata?.[GAUSSIAN_SPLAT_PLY_METADATA_KEY] === true;
};

const isGaussianSplatPlyBlob = async (blob: Blob): Promise<boolean> => {
    const { isGaussianSplatPlyBlob } = await import('./gaussianSplats');
    return isGaussianSplatPlyBlob(blob);
};

const dataUrlMime = (url: string): string | undefined => {
    if (!url.startsWith("data:")) return undefined;
    const comma = url.indexOf(",");
    if (comma < 0) return undefined;
    const header = url.slice("data:".length, comma);
    return header.split(";")[0]?.toLowerCase() || undefined;
};

const isZipDataUrl = (url: string): boolean => {
    if (!url.startsWith("data:")) return false;
    const mime = dataUrlMime(url);
    if (mime?.includes("zip")) return true;
    const comma = url.indexOf(",");
    if (comma < 0) return false;
    return url.slice(comma + 1, comma + 1 + ZIP_BASE64_PREFIX.length) === ZIP_BASE64_PREFIX;
};

const isZipModelPackage = (result: Awaited<ReturnType<AssetLoader["getModelDataUrl"]>>): boolean => {
    const format = result.format?.toLowerCase();
    if (isUsdZipContainer(format)) return false;

    if (typeof result.metadata?.zipMainFile === "string") {
        return true;
    }

    const contentType = result.contentType?.toLowerCase();
    if (contentType?.includes("zip")) {
        return true;
    }

    return isZipDataUrl(result.url);
};

const fetchModelBlob = async (url: string, fallbackContentType: string): Promise<Blob> => {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch packaged model (${response.status})`);
    }
    const blob = await response.blob();
    return blob.type ? blob : blob.slice(0, blob.size, fallbackContentType);
};

const findZipRootFilePath = (
    zip: JSZip,
    metadata: Record<string, unknown> | undefined,
): string | undefined => {
    const paths = Object.entries(zip.files)
        .filter(([, entry]) => !entry.dir)
        .map(([path]) => path);

    const metadataRoot = typeof metadata?.zipMainFile === "string"
        ? metadata.zipMainFile
        : undefined;

    if (metadataRoot) {
        const direct = paths.find(path => path === metadataRoot);
        if (direct) return direct;

        const byBasename = paths.find(path => path.split("/").pop() === metadataRoot);
        if (byBasename) return byBasename;
    }

    return paths.find(path => SUPPORTED_MODEL_FORMATS_REGEX.test(path));
};

const expandZipModelPackage = async (
    archive: Blob,
    metadata: Record<string, unknown> | undefined,
): Promise<ZipModelPackage> => {
    const { default: JSZip } = await import('jszip');
    const zip = await new JSZip().loadAsync(archive);
    const rootFilePath = findZipRootFilePath(zip, metadata);
    if (!rootFilePath) {
        throw new Error("Packaged model ZIP does not contain a supported root model file");
    }

    const fileBlobMap = new Map<string, Blob>();
    await Promise.all(
        Object.entries(zip.files)
            .filter(([, entry]) => !entry.dir)
            .map(async ([path, entry]) => {
                fileBlobMap.set(path, await entry.async("blob"));
            }),
    );

    const rootBlob = fileBlobMap.get(rootFilePath);
    if (!rootBlob) {
        throw new Error(`Packaged model ZIP root file is missing: ${rootFilePath}`);
    }

    const rootFilename = rootFilePath.split("/").pop() || "model";
    const rootPath = rootFilePath.split("/").slice(0, -1).join("/");

    return {
        rootFile: new File([rootBlob], rootFilename, { type: rootBlob.type }),
        fileBlobMap,
        rootPath,
    };
};

const getPackageTextureOptions = async (
    rootFile: File,
    fileBlobMap: Map<string, Blob>,
    rootPath: string,
): Promise<{atlasData?: AtlasData; textureOverrides?: TextureOverrides}> => {
    const { findAtlasFiles, loadAtlas } = await import('../atlas/AtlasDetector');
    const atlasFiles = findAtlasFiles(fileBlobMap);
    const atlasData = atlasFiles[0]
        ? await loadAtlas(atlasFiles[0], fileBlobMap, rootPath)
        : undefined;

    if (atlasData) {
        return { atlasData };
    }

    const {
        detectTexturesAndModels,
        getBaseName,
        getTextureOverridesForModel,
    } = await import('../texture/TextureMapping');
    const textureDetection = detectTexturesAndModels(fileBlobMap);
    if (!textureDetection.hasLooseTextures) {
        return {};
    }

    const modelBaseName = getBaseName(rootFile.name);
    let textureOverrides = getTextureOverridesForModel(modelBaseName, textureDetection);

    if ((!textureOverrides || Object.keys(textureOverrides).length === 0)
        && textureDetection.modelPaths.length === 1
        && textureDetection.texturePaths.length >= 1) {
        const firstTexturePath = textureDetection.texturePaths[0]!;
        const textureBlob = fileBlobMap.get(firstTexturePath);
        if (textureBlob) {
            textureOverrides = {
                map: { blob: textureBlob, path: firstTexturePath },
            };
        }
    }

    return textureOverrides && Object.keys(textureOverrides).length > 0
        ? { textureOverrides }
        : {};
};

const loadZipModelPackage = async (
    result: Awaited<ReturnType<AssetLoader["getModelDataUrl"]>>,
    loadOptions: RuntimeModelLoaderOptions,
): Promise<Object3D | null> => {
    const archive = await fetchModelBlob(result.url, result.contentType || "application/zip");
    const { rootFile, fileBlobMap, rootPath } = await expandZipModelPackage(archive, result.metadata);
    const format = rootFile.name.split(".").pop()?.toLowerCase();

    if (!format || !isSupportedModelFormat(format)) {
        throw new Error(`Unsupported packaged model format: ${format || "(none)"}`);
    }

    const { atlasData, textureOverrides } = await getPackageTextureOptions(rootFile, fileBlobMap, rootPath);
    const rootUrl = URL.createObjectURL(rootFile);
    const loader = await createModelLoader();

    try {
        return await loader.load(
            rootUrl,
            {
                ...loadOptions,
                Type: format,
                ForceGaussianSplatPly: loadOptions.ForceGaussianSplatPly
                    || (format === "ply" && await isGaussianSplatPlyBlob(rootFile)),
                fileBlobMap,
                rootPath,
                atlasData: atlasData ?? undefined,
                textureOverrides,
            },
        );
    } finally {
        loader.dispose();
        URL.revokeObjectURL(rootUrl);
    }
};

/**
 * Load a model using an AssetLoader for efficient caching.
 * This avoids redundant API calls when the asset is already cached.
 * Uses the AssetLoader to get signed CDN URLs and select the best LOD
 * derivative for the current device.
 *
 * @param modelId - The model asset ID (may be a logical ID that gets resolved)
 * @param context - Asset resolution context for mapping logical IDs to real asset/revision IDs
 * @param assetLoader - The AssetLoader instance to use for caching and URL retrieval
 * @param options - Optional loading options
 * @param options.priority - Loading priority for the model loader
 * @param options.preferLod - Override the automatic LOD level selection
 * @returns Promise resolving to the loaded Object3D with modelId and revisionId set in userData
 * @throws Error if the revision ID cannot be resolved or the model fails to load
 */
export const loadModelWithLoader = async (
    modelId: string,
    context: AssetResolutionContext,
    assetLoader: AssetLoader,
    options: LoadModelWithLoaderOptions = {},
): Promise<Object3D> => {
    const resolvedModelId = resolveAssetId(modelId, context);
    const revisionId = resolveModelRevisionId(modelId, resolvedModelId, context);
    if (!revisionId) {
        throw new Error(`Failed to resolve revision ID for model ID ${modelId}`);
    }

    // Use the AssetLoader to get the data URL (from cache or fetch)
    const result = await assetLoader.getModelDataUrl(
        { assetId: resolvedModelId, revisionId },
        { preferLod: options.preferLod },
    );

    console.debug(
        `[loadModelWithLoader] Loading ${resolvedModelId} with LOD ${result.lodLevel ?? 'original'}`,
    );

    const loadOptions: RuntimeModelLoaderOptions = {
        Type: result.format,
        ForceGaussianSplatPly: hasGaussianSplatPlyMetadata(result.metadata),
        DisableReupload: true,
        DisableDefaultPhysics: true,
        Priority: options.priority,
        CacheKey: `${resolvedModelId}:${revisionId}:${result.lodLevel ?? "original"}`,
    };
    const object = isZipModelPackage(result)
        ? await loadZipModelPackage(result, loadOptions)
        : await (await createModelLoader()).load(result.url, loadOptions);
    if (!object) {
        throw new Error(`Failed to load model ${resolvedModelId}`);
    }

    setModelId(object, modelId);
    setModelRevisionId(object, revisionId);

    return object;
};
