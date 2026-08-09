import type {WebGPURenderer} from "three/webgpu";

import Converter from "./Converter";
import {deduplicateModelFiles} from "./modelFileDeduplication";
import {ModelUtils} from "./ModelUtils";
import {ModelFormat, SUPPORTED_MODEL_FORMATS_REGEX} from "@stem/network/api/asset";
import type {SceneSettings} from "@stem/network/api/scene";
import {createScene, publishScene, sceneSettingsToCreateRequest} from "@stem/network/api/scene/v2";
import type {ImportProgress} from "../editor/assets/v2/common/ImportProgressDialog";
import {zipFiles} from "../editor/assets/v2/LeftPanel/MainTabs/AssetsTab/ModelUpload/utils/zipFiles";
import global from "../global";
import {createModelWithData} from "@stem/editor-oss/model/createModelWithData";
import {convertToGlb} from "@stem/editor-oss/model/convertToGlb";
import {loadModelFromFile} from "@stem/editor-oss/model/loadModelFromFile";
import {showToast} from "@stem/editor-oss/showToast";
import {detectTextureType, TextureType} from "@stem/editor-oss/texture/TextureMapping";

type ImportResult = {
    success: boolean;
    sceneId?: string;
    error?: string;
    successCount?: number;
    failedCount?: number;
    failedAssets?: string[];
};

type ProgressCallback = (progress: ImportProgress) => void;

type PackagedModel = {
    sourceFile: File;
    modelName: string;
};

type PreparedModelUpload = {
    assetName: string;
    modelBlob: Blob;
    thumbnailFile: File;
};

const STEP_UPLOAD = "1/2";
const STEP_PUBLISH = "2/2";
const THUMBNAIL_SIZE = 256;
const SYSTEM_FILES_REGEX = /^\.|(^__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)/i;
const TEXTURE_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp|bmp|tga|tif|tiff|dds|ktx|ktx2|hdr|exr)$/i;
const BIN_EXTENSIONS = /\.bin$/i;
const MTL_EXTENSIONS = /\.mtl$/i;

const isSystemFile = (filename: string): boolean => {
    const basename = filename.split("/").pop() || filename;
    return SYSTEM_FILES_REGEX.test(basename);
};

const isTextureFile = (filename: string): boolean => TEXTURE_EXTENSIONS.test(filename);
const isBinFile = (filename: string): boolean => BIN_EXTENSIONS.test(filename);
const isMtlFile = (filename: string): boolean => MTL_EXTENSIONS.test(filename);

const getBaseName = (filename: string): string => {
    const name = filename.split("/").pop() || filename;
    const dotIndex = name.lastIndexOf(".");
    return dotIndex > 0 ? name.substring(0, dotIndex) : name;
};

const getRootFolderName = (files: File[]): string => {
    const relativePath = files[0]?.webkitRelativePath;
    if (relativePath && relativePath.includes("/")) {
        return relativePath.split("/")[0] || "Imported Asset Pack";
    }

    return "Imported Asset Pack";
};

const isBaseColorTexture = (file: File): boolean => {
    const type = detectTextureType(file.name);
    return type === TextureType.Unknown || type === TextureType.Diffuse;
};

type TextureVariantInfo = {
    variants: File[];
    pbrTextures: File[];
};

const detectTextureVariants = (textureFiles: File[]): TextureVariantInfo => {
    const baseColor: File[] = [];
    const pbr: File[] = [];

    for (const file of textureFiles) {
        if (isBaseColorTexture(file)) {
            baseColor.push(file);
        } else {
            pbr.push(file);
        }
    }

    return {
        variants: baseColor.length >= 2 ? baseColor : [],
        pbrTextures: pbr,
    };
};

const findRelevantTextures = (modelBaseName: string, textureFiles: File[]): File[] => {
    const modelNameLower = modelBaseName.toLowerCase();

    const matchingTextures = textureFiles.filter(textureFile => {
        const textureName = getBaseName(textureFile.name).toLowerCase();
        return textureName.startsWith(modelNameLower) || textureName.includes(modelNameLower);
    });

    return matchingTextures.length > 0 ? matchingTextures : textureFiles;
};

const findAssociatedMtlFiles = (modelBaseName: string, mtlFiles: File[]): File[] => {
    const modelNameLower = modelBaseName.toLowerCase();

    return mtlFiles.filter(mtlFile => {
        const mtlName = getBaseName(mtlFile.name).toLowerCase();
        return mtlName === modelNameLower || mtlName.startsWith(modelNameLower);
    });
};

const findAssociatedBinFiles = (modelBaseName: string, binFiles: File[]): File[] => {
    const modelNameLower = modelBaseName.toLowerCase();

    return binFiles.filter(binFile => {
        const binName = getBaseName(binFile.name).toLowerCase();
        return binName === modelNameLower || binName === "scene" || binName.startsWith(modelNameLower);
    });
};

const toFileList = (files: File[]): FileList => {
    const dataTransfer = new DataTransfer();
    files.forEach(file => dataTransfer.items.add(file));
    return dataTransfer.files;
};

const createModelPackages = async (files: File[], selectedVariant?: File): Promise<PackagedModel[]> => {
    const modelFiles: File[] = [];
    let textureFiles: File[] = [];
    const binFiles: File[] = [];
    const mtlFiles: File[] = [];

    for (const file of files) {
        if (isSystemFile(file.name)) {
            continue;
        }

        if (SUPPORTED_MODEL_FORMATS_REGEX.test(file.name)) {
            modelFiles.push(file);
            continue;
        }

        if (isTextureFile(file.name)) {
            textureFiles.push(file);
            continue;
        }

        if (isBinFile(file.name)) {
            binFiles.push(file);
            continue;
        }

        if (isMtlFile(file.name)) {
            mtlFiles.push(file);
        }
    }

    // If a variant was selected, filter texture files to only include the
    // chosen base-color variant plus all PBR-type textures.
    if (selectedVariant) {
        textureFiles = textureFiles.filter(f => !isBaseColorTexture(f) || f === selectedVariant);
    }

    const dedupedModelFiles = deduplicateModelFiles(modelFiles);

    if (dedupedModelFiles.length === 0) {
        throw new Error("No supported model files found in selected folder");
    }

    const packages: PackagedModel[] = [];

    for (const modelFile of dedupedModelFiles) {
        const modelBaseName = getBaseName(modelFile.name);
        const ext = modelFile.name.split(".").pop()?.toLowerCase();
        if (!ext || !Object.values(ModelFormat).includes(ext as ModelFormat)) {
            continue;
        }

        const relevantTextures = findRelevantTextures(modelBaseName, textureFiles);
        const associatedBins = findAssociatedBinFiles(modelBaseName, binFiles);
        const associatedMtls = findAssociatedMtlFiles(modelBaseName, mtlFiles);
        const bundledFiles = [modelFile, ...relevantTextures, ...associatedBins, ...associatedMtls];

        if (bundledFiles.length === 1) {
            packages.push({
                sourceFile: modelFile,
                modelName: modelFile.name,
            });
            continue;
        }

        const zipBlob = await zipFiles(toFileList(bundledFiles));
        packages.push({
            sourceFile: new File([zipBlob], `${modelBaseName}.zip`, {type: "application/zip"}),
            modelName: modelFile.name,
        });
    }

    if (packages.length === 0) {
        throw new Error("No importable model files found in selected folder");
    }

    return packages;
};

const buildMinimalScenePayload = (origin: string) => {
    return [
        {
            metadata: {generator: "OptionsSerializer"},
            server: origin,
        },
        {
            metadata: {generator: "SceneSerializer"},
            uuid: crypto.randomUUID(),
            type: "Scene",
            name: "Scene",
            children: [],
            userData: {},
        },
    ];
};

const prepareModelUpload = async (packagedModel: PackagedModel): Promise<PreparedModelUpload> => {
    const abortSignal = new AbortController().signal;
    const {model} = await loadModelFromFile(packagedModel.sourceFile, abortSignal);
    const sourceGlbBuffer = await convertToGlb(model, abortSignal, {});
    const thumbnailUrl = await ModelUtils.createThumbnailFromModel(model, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    const thumbnailFile = Converter.dataURLtoFile(thumbnailUrl, "thumbnail");
    const modelBaseName = getBaseName(packagedModel.modelName);

    return {
        assetName: `${modelBaseName}.glb`,
        modelBlob: new Blob([sourceGlbBuffer], {type: "model/gltf-binary"}),
        thumbnailFile,
    };
};

const processAssetPackImport = async (
    files: File[],
    folderName: string,
    onComplete: (result: ImportResult) => void,
    onProgress?: ProgressCallback,
    onSelectVariant?: (variants: File[]) => Promise<File | null>,
    onSelectTextures?: () => Promise<File[] | null>,
) => {
    let headlessRenderer: WebGPURenderer | null = null;
    const previousApp = global.app;
    try {
        onProgress?.({
            currentStep: "Preparing assets...",
            overallProgress: 0,
            stepIndicator: STEP_UPLOAD,
        });

        // Create a temporary headless renderer when running from the dashboard
        // (where global.app is null). GLTFLoaderExtended needs a renderer for
        // KTX2Loader.detectSupport(). Follows the same pattern as
        // ModelUtils.createThumbnailFromModel().
        if (!global.app?.renderer) {
            const {WebGPURenderer} = await import("three/webgpu");
            headlessRenderer = new WebGPURenderer({antialias: false, alpha: true});
            await headlessRenderer.init();
            global.app = {renderer: headlessRenderer} as any;
        }

        // Detect texture variants and let the user pick one if available
        let selectedVariant: File | undefined;
        if (onSelectVariant) {
            const allTextures = files.filter(f => !isSystemFile(f.name) && isTextureFile(f.name));
            const {variants} = detectTextureVariants(allTextures);
            if (variants.length >= 2) {
                const picked = await onSelectVariant(variants);
                if (!picked) {
                    // User cancelled variant selection — abort import
                    onComplete({success: false, error: "Import cancelled"});
                    return;
                }
                selectedVariant = picked;
            }
        }

        // Check if the folder has any texture files at all — if not, prompt user
        if (onSelectTextures) {
            const allTextures = files.filter(f => !isSystemFile(f.name) && isTextureFile(f.name));
            if (allTextures.length === 0) {
                const extraTextures = await onSelectTextures();
                if (extraTextures && extraTextures.length > 0) {
                    files = [...files, ...extraTextures];
                }
            }
        }

        const packages = await createModelPackages(files, selectedVariant);
        const dependencies: Record<string, string> = {};
        const failedAssets: string[] = [];

        for (let index = 0; index < packages.length; index++) {
            const sourcePackage = packages[index]!;
            const assetLabel = getBaseName(sourcePackage.modelName);
            const progress = Math.round((index / packages.length) * 80);

            try {
                const prepared = await prepareModelUpload(sourcePackage);

                onProgress?.({
                    currentStep: `Importing ${prepared.assetName} (${index + 1}/${packages.length})`,
                    overallProgress: progress,
                    stepIndicator: STEP_UPLOAD,
                });

                const asset = await createModelWithData({
                    name: prepared.assetName,
                    blob: prepared.modelBlob,
                    format: ModelFormat.Glb,
                    contentType: "model/gltf-binary",
                    thumbnail: {
                        file: prepared.thumbnailFile,
                        width: THUMBNAIL_SIZE,
                        height: THUMBNAIL_SIZE,
                    },
                });

                dependencies[asset.id] = asset.headRevisionId;
            } catch (assetError) {
                console.error(`Failed to import asset "${assetLabel}":`, assetError);
                failedAssets.push(assetLabel);
            }
        }

        if (Object.keys(dependencies).length === 0) {
            throw new Error("All assets failed to import");
        }

        onProgress?.({
            currentStep: "Publishing asset pack scene...",
            overallProgress: 90,
            stepIndicator: STEP_PUBLISH,
        });

        const settings: SceneSettings = {
            IsAssetPack: true,
            IsCollaborative: false,
            Dependencies: dependencies,
        };
        const serializedScene = JSON.stringify(buildMinimalScenePayload(window.location.origin));
        const created = await createScene(serializedScene, sceneSettingsToCreateRequest(settings, folderName));
        await publishScene(created.id, created.asset.revision.id, {isPublic: true});
        const sceneId = created.id;

        onProgress?.({
            currentStep: "Asset pack published",
            overallProgress: 100,
            stepIndicator: STEP_PUBLISH,
        });

        const successCount = Object.keys(dependencies).length;
        onComplete({
            success: true,
            sceneId,
            successCount,
            failedCount: failedAssets.length,
            failedAssets: failedAssets.length > 0 ? failedAssets : undefined,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Asset pack import failed";
        showToast({type: "error", body: message});
        onComplete({
            success: false,
            error: message,
        });
    } finally {
        if (headlessRenderer) {
            headlessRenderer.dispose();
            global.app = previousApp;
        }
    }
};

/**
 * Imports a folder of model assets and creates a published asset-pack scene.
 * @param onStart
 * @param onComplete
 * @param onProgress
 * @param onSelectVariant
 * @param onSelectTextures
 */
export function dashboardAssetPackImport(
    onStart: () => void,
    onComplete: (result: ImportResult) => void,
    onProgress?: ProgressCallback,
    onSelectVariant?: (variants: File[]) => Promise<File | null>,
    onSelectTextures?: () => Promise<File[] | null>,
) {
    let input: HTMLInputElement | null = document.createElement("input");
    const directoryInput = input as HTMLInputElement & {webkitdirectory?: boolean; directory?: boolean};

    input.type = "file";
    input.style.display = "none";
    directoryInput.webkitdirectory = true;
    directoryInput.directory = true;
    input.multiple = true;
    document.body.appendChild(input);

    input.value = "";

    input.onchange = event => {
        if (input) {
            input.onchange = null;
        }

        const files = Array.from((event.target as HTMLInputElement)?.files || []);
        if (files.length === 0) {
            onComplete({success: false, error: "No folder selected"});
            if (input?.parentNode) {
                input.parentNode.removeChild(input);
            }
            input = null;
            return;
        }

        const folderName = getRootFolderName(files);
        onStart();

        void processAssetPackImport(files, folderName, onComplete, onProgress, onSelectVariant, onSelectTextures);

        if (input?.parentNode) {
            input.parentNode.removeChild(input);
        }
        input = null;
    };

    input.click();
}

export const DashboardAssetPackImportUtils = {
    dashboardAssetPackImport,
};
