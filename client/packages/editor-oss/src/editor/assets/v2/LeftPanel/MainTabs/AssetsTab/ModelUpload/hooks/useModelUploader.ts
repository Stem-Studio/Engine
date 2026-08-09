import JSZip from 'jszip';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Object3D } from 'three';

import { useLoadAnimations } from './useLoadAnimations';
import { AssetType, createAssetWithData, ModelFormat, SUPPORTED_MODEL_CONTENT_TYPES, SUPPORTED_MODEL_FORMATS_REGEX } from '@stem/network/api/asset';
import { saveScene } from '@stem/network/api/scene';
import { resolveAssetRevisionId } from '@stem/editor-oss/asset-management/AssetResolutionContext';
import { useAssetResolutionContext } from '@stem/editor-oss/context/AssetResolutionContext';
import global from '@stem/editor-oss/global';
import { convertToGlb } from '@stem/editor-oss/model/convertToGlb';
import {
    GAUSSIAN_SPLAT_PLY_METADATA_KEY,
    isGaussianSplatFormat,
    isGaussianSplatObject,
} from '@stem/editor-oss/model/gaussianSplats';
import { createLods } from '@stem/editor-oss/model/load-util';
import { AnimationOnlyModelError, loadModelFromFile } from '@stem/editor-oss/model/loadModelFromFile';
import { uploadModelFromUrl as uploadModelFromUrlUtility } from '@stem/editor-oss/model/uploadModelFromUrl';
import { showToast } from '@stem/editor-oss/showToast';
import Converter from '@stem/editor-oss/utils/Converter';
import { deduplicateModelFiles } from '@stem/editor-oss/utils/modelFileDeduplication';
import { ModelUtils } from '@stem/editor-oss/utils/ModelUtils';
import { useCreateModel, useCreateModelRevision } from '../../../../../../../models/hooks/models';
import { THUMBNAIL_SIZE } from '../constants';
import { LodLevel, UploadSettings } from '../types';
import { cleanupInvalidTextures, detectMissingTextures } from '../utils/cleanupInvalidTextures';
import { voxelizeModel } from '../utils/voxelizeModel';
import { zipFiles } from '../utils/zipFiles';

type ModelData = {
    model: Object3D;
    // The original file chosen by the user (could be a .zip file) or, if the
    // user chose multiple files, a zip containing those files
    zipOrOriginalFile: File;
    // The "root" or "main" model file - either the original file or one of the
    // files in the zip
    rootFile: File;
    format: ModelFormat;
    maxLodLevel: LodLevel;
    // Whether texture overrides were detected and applied
    hasTextureOverrides?: boolean;
    // Number of textures detected
    textureCount?: number;
    // Whether missing/invalid textures were detected on the loaded model
    hasMissingTextures?: boolean;
    isGaussianSplat?: boolean;
};

// Track uploaded texture assets
type UploadedTextureAsset = {
    originalFileName: string;
    assetId: string;
    revisionId: string;
};

const useModelUploader = () => {
    const [modelFiles, setModelFiles] = useState<FileList | File | null>(null);
    const [modelData, setModelData] = useState<ModelData | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<unknown>(null);
    // Queue for multiple model files (when folder contains multiple standalone models)
    const [modelQueue, setModelQueue] = useState<File[]>([]);
    const [currentModelIndex, setCurrentModelIndex] = useState(0);
    // Track texture assets uploaded for this batch
    const [uploadedTextureAssets, setUploadedTextureAssets] = useState<UploadedTextureAsset[]>([]);
    const abortControllerRef = useRef<AbortController>(new AbortController());
    const createModel = useCreateModel();
    const createModelRevision = useCreateModelRevision();
    const {isLoading: isLoadingAnimations} = useLoadAnimations();
    const {context: assetResolutionContext, setAssetRevision} = useAssetResolutionContext();
    const assetResolutionContextRef = useRef(assetResolutionContext);

    useEffect(() => {
        assetResolutionContextRef.current = assetResolutionContext;
    }, [assetResolutionContext]);

    // Derived state for multi-model support
    const hasMoreModels = modelQueue.length > 0 && currentModelIndex < modelQueue.length - 1;
    const totalModels = modelQueue.length;
    const currentModelNumber = modelQueue.length > 0 ? currentModelIndex + 1 : 0;

    // Load the model when the file(s) change
    useEffect(() => {
        if (!modelFiles) {
            return;
        }

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        setIsLoading(true);
        setError(null);
        setUploadedTextureAssets([]);

        // Process files - handles texture uploads and model packaging
        const processFiles = async () => {
            const categorized = await categorizeFiles(modelFiles);

            // If there are textures to upload, upload them first
            if (categorized.textureFiles.length > 0) {
                const uploadedTextures = await uploadTexturesAsAssets(categorized.textureFiles, abortController.signal);
                setUploadedTextureAssets(uploadedTextures);
            }

            // If we have multiple model packages, set up the queue
            if (categorized.modelPackages.length > 1) {
                setModelQueue(categorized.modelPackages);
                setCurrentModelIndex(0);
                // Process the first model package
                return loadModelFromFile(categorized.modelPackages[0]!, abortController.signal);
            }

            // Single model or single package - process directly
            if (categorized.modelPackages.length === 1) {
                setModelQueue([]);
                setCurrentModelIndex(0);
                return loadModelFromFile(categorized.modelPackages[0]!, abortController.signal);
            }

            // Fallback: zip files if multiple (existing behavior)
            setModelQueue([]);
            setCurrentModelIndex(0);
            const originalOrZipFile = await zipFilesIfMultiple(modelFiles);
            return loadModelFromFile(originalOrZipFile, abortController.signal);
        };

        processFiles()
            .then(({originalFile, model, rootFile, format, textureOverrides, textureDetection}) => {
                const isGaussianSplat = isGaussianSplatObject(model) || isGaussianSplatFormat(format);
                const maxLodLevel = isGaussianSplat ? LodLevel.Original : LodLevel.Lod3;
                const hasTextureOverrides = textureOverrides !== undefined && Object.keys(textureOverrides).length > 0;
                const textureCount = textureDetection?.texturePaths?.length ?? 0;
                const hasMissingTextures = detectMissingTextures(model);

                setModelData({
                    zipOrOriginalFile: originalFile,
                    model,
                    rootFile,
                    format,
                    maxLodLevel,
                    hasTextureOverrides,
                    textureCount,
                    hasMissingTextures,
                    isGaussianSplat,
                });
            })
            .catch(error => {
                if (error?.name !== "AbortError") {
                    console.error("Error processing file:", error);

                    // Show specific error message for animation-only files
                    if (error instanceof AnimationOnlyModelError) {
                        showToast({
                            type: "error",
                            title: "Animation-only file",
                            body: error.message,
                        });
                    } else {
                        showToast({type: "error", title: "Failed to load model"});
                    }
                    setError(error);
                }
            })
            .finally(() => {
                setIsLoading(false);
            });
        return () => {
            abortController.abort();

            // Reset state
            setModelData(null);
            setModelQueue([]);
            setCurrentModelIndex(0);
            setUploadedTextureAssets([]);
            setError(null);
        };
    }, [modelFiles]);

    const uploadModelAsync = async (settings: UploadSettings) => {
        const abortSignal = abortControllerRef.current.signal;

        if (!modelData) {
            throw new Error("No model loaded.");
        }

        const originalFile = modelData.zipOrOriginalFile;
        let file = modelData.rootFile;
        let format = modelData.format;
        const isGaussianSplat = modelData.isGaussianSplat || isGaussianSplatObject(modelData.model) || isGaussianSplatFormat(modelData.format);

        // Determine which model to convert to GLB
        let modelToConvert = modelData.model;

        // Apply voxelization if enabled
        if (settings.voxelize && !isGaussianSplat) {
            const resolution = settings.voxelResolution ?? 32;
            modelToConvert = await voxelizeModel(modelData.model, resolution, settings.removeHiddenFaces);
        }

        const oldAnimations = modelToConvert.animations;
        const oldUserData = modelToConvert.userData;
        if (settings.isHumanoid && !settings.voxelize && !isGaussianSplat) {
            // Stamp the humanoid flag onto the GLB extras. At runtime,
            // ModelLoader injects the standard locomotion clips
            // (idle / walk / run / jump) from the shared Mixamo library
            // so per-asset GLBs stay small. Per-model clips already
            // present in the source survive — the merge helper only
            // fills missing slots.
            modelToConvert.userData = {...(oldUserData ?? {}), isHumanoid: true};
        }

        let sourceGlbBuffer: ArrayBuffer | undefined;
        let modelLods: Awaited<ReturnType<typeof createLods>> = [];

        if (!isGaussianSplat) {
            const hadInvalidTextures = await cleanupInvalidTextures(modelToConvert);
            if (hadInvalidTextures) {
                showToast({
                    type: "info",
                    title: "Default texture applied",
                    body: "Some textures could not be loaded. A default placeholder texture has been applied. For your original textures, upload the model with its textures in a ZIP file.",
                });
            }

            sourceGlbBuffer = await convertToGlb(modelToConvert, abortSignal, {})
                .finally(() => {
                    modelToConvert.animations = oldAnimations;
                    modelToConvert.userData = oldUserData;

                    if (settings.voxelize && modelToConvert !== modelData.model) {
                        modelToConvert.traverse((child) => {
                            if (child instanceof THREE.Mesh) {
                                child.geometry?.dispose();
                                if (Array.isArray(child.material)) {
                                    child.material.forEach(m => m.dispose());
                                } else {
                                    child.material?.dispose();
                                }
                            }
                        });
                    }
                });

            if (settings.voxelize) {
                const blob = new Blob([sourceGlbBuffer], { type: 'model/gltf-binary' });
                const fileName = file.name.replace(/\.[^/.]+$/, "") + ".glb";
                file = new File([blob], fileName, { type: 'model/gltf-binary' });
                format = ModelFormat.Glb;
            }

            if (!settings.voxelize) {
                try {
                    modelLods = await createLods(sourceGlbBuffer, file.name, settings, abortSignal);
                } catch (lodError) {
                    console.error('[useModelUploader] LOD creation failed, uploading without LODs:', lodError);
                    showToast({
                        type: "warning",
                        title: "LOD creation skipped",
                        body: "Model will be uploaded without LOD optimization.",
                    });
                    modelLods = [];
                }
            }
        }
        abortSignal.throwIfAborted();

        // Generate thumbnail from the appropriate model
        let thumbnailFile: File;
        if (settings.thumbnailFile) {
            thumbnailFile = settings.thumbnailFile;
        } else {
            const thumbnailSourceModel = settings.voxelize ? modelToConvert : modelData.model;
            const thumbnailUrl = await ModelUtils.createThumbnailFromModel(thumbnailSourceModel, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
            thumbnailFile = Converter.dataURLtoFile(thumbnailUrl, "thumbnail");
        }

        // Store additional metadata if this is a ZIP
        const isZip = originalFile.type === "application/zip";
        const fallbackContentType = SUPPORTED_MODEL_CONTENT_TYPES[format][0];
        const contentType = isZip ? "application/zip" : (originalFile.type || fallbackContentType);
        const metadata = {
            ...(isZip
                ? {
                    zipMainFile: modelData.rootFile.name,
                    zipMainFileContentType: SUPPORTED_MODEL_CONTENT_TYPES[format][0],
                }
                : {}),
            ...((isGaussianSplat && format === ModelFormat.Ply)
                ? {
                    [GAUSSIAN_SPLAT_PLY_METADATA_KEY]: true,
                }
                : {}),
        };
        const normalizedMetadata = Object.keys(metadata).length > 0 ? metadata : undefined;

        // If we are updating an existing model, create a new revision
        if (settings.updateModelId) {
            const context = assetResolutionContextRef.current;
            if (!context) {
                throw new Error("No asset resolution context");
            }
            const parentRevisionId = resolveAssetRevisionId(settings.updateModelId, context);
            if (!parentRevisionId) {
                throw new Error("Failed to resolve parent revision ID");
            }

            const revision = await createModelRevision({
                id: settings.updateModelId,
                parentRevisionId,
                blob: originalFile,
                format,
                contentType,
                thumbnail: {
                    file: thumbnailFile,
                    width: THUMBNAIL_SIZE,
                    height: THUMBNAIL_SIZE,
                },
                lods: modelLods,
                metadata: normalizedMetadata,
            });

            setAssetRevision(revision.assetId, revision.id);

            abortSignal.throwIfAborted();

            return {
                assetId: revision.assetId,
                revisionId: revision.id,
            };
        }

        // Otherwise, create a new model
        const asset = await createModel({
            name: modelData.rootFile.name,
            blob: originalFile,
            format,
            contentType,
            thumbnail: {
                file: thumbnailFile,
                width: THUMBNAIL_SIZE,
                height: THUMBNAIL_SIZE,
            },
            lods: modelLods,
            metadata: normalizedMetadata,
        });

        abortSignal.throwIfAborted();

        return {
            assetId: asset.id,
            revisionId: asset.headRevisionId,
        };
    };

    // Upload the model (called by the user of the hook)
    const uploadModel = (settings: UploadSettings) => {
        setIsUploading(true);
        setError(null);

        return uploadModelAsync(settings)
            .then(async asset => {
                // Save the scene so that the asset resolution context is saved
                await saveScene(false, false);

                showToast({type: "success", title: "Model uploaded successfully"});

                // Fire legacy events
                global.app?.call("finishedModelUpload");
                global.app?.call("modelsFetched");
                return asset;
            })
            .catch(error => {
                if (error?.name !== "AbortError") {
                    console.error("Error uploading model:", error);
                    showToast({type: "error", title: "Failed to upload model"});
                    setError(error);
                }

                throw error;
            })
            .finally(() => {
                setIsUploading(false);
            });
    };

    // Cancel loading / uploading
    const cancel = () => {
        abortControllerRef.current.abort();
    };

    /**
     * Upload a model directly from a URL.
     * This is used for AI-generated models (Meshy, Tripo) where we have a URL
     * instead of a file selected by the user.
     *
     * @param url - URL of the model (e.g., from Meshy/Tripo CDN)
     * @param name - Name for the uploaded model
     * @param settings - Upload settings
     * @returns Promise with asset info and loaded Three.js object
     */
    const uploadFromUrl = async (url: string, name: string, settings: UploadSettings) => {
        setIsUploading(true);
        setError(null);

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        try {
            const result = await uploadModelFromUrlUtility({
                url,
                name,
                settings,
                signal: abortController.signal,
            });

            showToast({type: "success", title: "Model uploaded successfully"});

            return result;
        } catch (error) {
            if ((error as Error)?.name !== "AbortError") {
                console.error("Error uploading model from URL:", error);
                showToast({type: "error", title: "Failed to upload model"});
                setError(error);
            }
            throw error;
        } finally {
            setIsUploading(false);
        }
    };

    /**
     * Advance to the next model in the queue.
     * Called after successfully uploading the current model when there are more to process.
     */
    const advanceToNextModel = async () => {
        if (!hasMoreModels) {
            console.warn('[useModelUploader] advanceToNextModel called but no more models in queue');
            return;
        }

        const nextIndex = currentModelIndex + 1;
        const nextFile = modelQueue[nextIndex];

        if (!nextFile) {
            console.error('[useModelUploader] No file at next index:', nextIndex);
            return;
        }

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        setIsLoading(true);
        setError(null);
        setModelData(null);

        try {
            const {originalFile, model, rootFile, format, textureOverrides, textureDetection} =
                await loadModelFromFile(nextFile, abortController.signal);

            const isGaussianSplat = isGaussianSplatObject(model) || isGaussianSplatFormat(format);
            const maxLodLevel = isGaussianSplat ? LodLevel.Original : LodLevel.Lod3;
            const hasTextureOverrides = textureOverrides !== undefined && Object.keys(textureOverrides).length > 0;
            const textureCount = textureDetection?.texturePaths?.length ?? 0;

            setCurrentModelIndex(nextIndex);
            setModelData({
                zipOrOriginalFile: originalFile,
                model,
                rootFile,
                format,
                maxLodLevel,
                hasTextureOverrides,
                textureCount,
                isGaussianSplat,
            });
        } catch (error) {
            if ((error as Error)?.name !== "AbortError") {
                console.error("Error loading next model:", error);

                // Show specific error message for animation-only files
                if (error instanceof AnimationOnlyModelError) {
                    showToast({
                        type: "error",
                        title: "Animation-only file",
                        body: error.message,
                    });
                } else {
                    showToast({type: "error", title: "Failed to load next model"});
                }
                setError(error);
            }
        } finally {
            setIsLoading(false);
        }
    };

    /**
     * Reload the current model with additional texture files.
     * If the original was a ZIP, adds textures to it. Otherwise creates a new
     * FileList from the original model file plus the texture files.
     * @param textureFiles
     */
    const reloadWithTextures = async (textureFiles: File[]) => {
        if (!modelData) return;

        const {zipOrOriginalFile, rootFile} = modelData;
        const isZip = zipOrOriginalFile.type === 'application/zip' ||
            zipOrOriginalFile.type === 'application/x-zip-compressed' ||
            zipOrOriginalFile.name.toLowerCase().endsWith('.zip');

        if (isZip) {
            const zipper = new JSZip();
            const zip = await zipper.loadAsync(zipOrOriginalFile);
            for (const file of textureFiles) {
                zip.file(file.name, file);
            }
            const newBlob = await zip.generateAsync({type: 'blob'});
            const newZip = new File([newBlob], zipOrOriginalFile.name, {type: 'application/zip'});
            setModelFiles(newZip);
        } else {
            const dt = new DataTransfer();
            dt.items.add(rootFile);
            for (const file of textureFiles) {
                dt.items.add(file);
            }
            setModelFiles(dt.files);
        }
    };

    return {
        modelFiles,
        modelData,
        isLoading: isLoading || isLoadingAnimations,
        isUploading,
        error,
        setModelFiles,
        uploadModel,
        uploadFromUrl,
        cancel,
        // Multi-model queue support
        hasMoreModels,
        totalModels,
        currentModelNumber,
        advanceToNextModel,
        // Texture assets uploaded for this batch
        uploadedTextureAssets,
        // Missing texture support
        reloadWithTextures,
    };
};

const zipFilesIfMultiple = async (files: File | FileList | File[]): Promise<File> => {
    if (files instanceof File) {
        return Promise.resolve(files);
    }

    const fileArray = Array.isArray(files) ? files : Array.from(files);

    if (fileArray.length === 1) {
        return Promise.resolve(fileArray[0]!);
    }

    if (fileArray.length > 1) {
        const blob = await zipFiles(fileArray);
        return new File([blob], "model.zip", { type: "application/zip" });
    }

    return Promise.reject(new Error("No files provided"));
};

// File extensions that are actual texture/supporting files (not system files)
const TEXTURE_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp|bmp|tga|tif|tiff|dds|ktx|ktx2|hdr|exr)$/i;
const SYSTEM_FILES_REGEX = /^\.|(^__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)/i;
const BIN_EXTENSIONS = /\.bin$/i;
const MTL_EXTENSIONS = /\.mtl$/i;

/**
 * Checks if a file is a system/hidden file that should be ignored
 * @param filename
 */
const isSystemFile = (filename: string): boolean => {
    const basename = filename.split('/').pop() || filename;
    return SYSTEM_FILES_REGEX.test(basename);
};

/**
 * Checks if a file is a texture file
 * @param filename
 */
const isTextureFile = (filename: string): boolean => {
    return TEXTURE_EXTENSIONS.test(filename);
};

/**
 * Checks if a file is a binary file (.bin for GLTF)
 * @param filename
 */
const isBinFile = (filename: string): boolean => {
    return BIN_EXTENSIONS.test(filename);
};

const isMtlFile = (filename: string): boolean => {
    return MTL_EXTENSIONS.test(filename);
};

/**
 * Gets the base name of a file (without extension)
 * @param filename
 */
const getBaseName = (filename: string): string => {
    const name = filename.split('/').pop() || filename;
    const dotIndex = name.lastIndexOf('.');
    return dotIndex > 0 ? name.substring(0, dotIndex) : name;
};

/**
 * Finds textures that are relevant to a specific model.
 * First tries to match by model name prefix, then falls back to all textures if no matches.
 * @param modelBaseName
 * @param textureFiles
 */
const findRelevantTextures = (modelBaseName: string, textureFiles: File[]): File[] => {
    const modelNameLower = modelBaseName.toLowerCase();

    // First, try to find textures that specifically match this model
    const matchingTextures = textureFiles.filter(t => {
        const textureName = getBaseName(t.name).toLowerCase();
        // Check if texture name starts with model name (e.g., "chair_diffuse.png" for "chair.glb")
        return textureName.startsWith(modelNameLower) || textureName.includes(modelNameLower);
    });

    if (matchingTextures.length > 0) {
        return matchingTextures;
    }

    // No specific matches - include all textures (shared textures scenario)
    // Each model gets all textures, they'll be embedded in the GLB
    return textureFiles;
};

/**
 * Finds .bin files that are associated with a specific model (for GLTF format)
 * @param modelBaseName
 * @param binFiles
 */
const findAssociatedBinFiles = (modelBaseName: string, binFiles: File[]): File[] => {
    const modelNameLower = modelBaseName.toLowerCase();

    return binFiles.filter(b => {
        const binName = getBaseName(b.name).toLowerCase();
        // Match by name or common patterns like "scene.bin"
        return binName === modelNameLower || binName === 'scene' || binName.startsWith(modelNameLower);
    });
};

const findAssociatedMtlFiles = (modelBaseName: string, mtlFiles: File[]): File[] => {
    const modelNameLower = modelBaseName.toLowerCase();

    return mtlFiles.filter(m => {
        const mtlName = getBaseName(m.name).toLowerCase();
        return mtlName === modelNameLower || mtlName.startsWith(modelNameLower);
    });
};

/**
 * Uploads texture files as image assets.
 * @param textureFiles
 * @param abortSignal
 */
const uploadTexturesAsAssets = async (
    textureFiles: File[],
    abortSignal: AbortSignal,
): Promise<UploadedTextureAsset[]> => {
    const uploadedAssets: UploadedTextureAsset[] = [];

    for (const textureFile of textureFiles) {
        abortSignal.throwIfAborted();

        try {
            const format = textureFile.name.split('.').pop()?.toLowerCase() || 'png';
            const contentType = textureFile.type || 'image/png';

            const asset = await createAssetWithData({
                type: AssetType.Image,
                name: textureFile.name,
                data: textureFile,
                format,
                contentType,
            });

            uploadedAssets.push({
                originalFileName: textureFile.name,
                assetId: asset.id,
                revisionId: asset.headRevisionId,
            });
        } catch (error) {
            console.error(`[uploadTexturesAsAssets] Failed to upload texture ${textureFile.name}:`, error);
            // Continue with other textures even if one fails
        }
    }

    return uploadedAssets;
};

/**
 * Creates model packages (mini-zips) for each model file with its associated textures.
 * @param modelFiles
 * @param textureFiles
 * @param binFiles
 * @param mtlFiles
 */
const createModelPackages = async (
    modelFiles: File[],
    textureFiles: File[],
    binFiles: File[],
    mtlFiles: File[] = [],
): Promise<File[]> => {
    const packages: File[] = [];

    for (const modelFile of modelFiles) {
        const modelBaseName = getBaseName(modelFile.name);

        // Find textures for this model
        const relevantTextures = findRelevantTextures(modelBaseName, textureFiles);

        // Find associated .bin files (for GLTF)
        const associatedBins = findAssociatedBinFiles(modelBaseName, binFiles);

        // Find associated .mtl files (for OBJ)
        const associatedMtls = findAssociatedMtlFiles(modelBaseName, mtlFiles);

        const filesToPackage = [modelFile, ...relevantTextures, ...associatedBins, ...associatedMtls];

        if (filesToPackage.length === 1) {
            // Just the model, no textures or associated files
            packages.push(modelFile);
        } else {
            // Create a mini-zip with all relevant files
            const zipBlob = await zipFiles(filesToPackage);
            const zipFile = new File([zipBlob], `${modelBaseName}.zip`, { type: 'application/zip' });
            packages.push(zipFile);
        }
    }

    return packages;
};

/**
 * Processes a ZIP file and creates model packages for each model inside.
 */
// Maximum ZIP file size (100 MB)
const MAX_ZIP_SIZE_BYTES = 100 * 1024 * 1024;

const processZipFile = async (zipFile: File): Promise<{
    modelPackages: File[];
    textureFiles: File[];
}> => {
    // Check file size limit
    if (zipFile.size > MAX_ZIP_SIZE_BYTES) {
        throw new Error(`ZIP file is too large (${Math.round(zipFile.size / 1024 / 1024)}MB). Maximum supported size is 100MB.`);
    }

    const zipper = new JSZip();
    const zip = await zipper.loadAsync(zipFile);

    const allPaths = Object.keys(zip.files);

    const modelPaths: string[] = [];
    const texturePaths: string[] = [];
    const binPaths: string[] = [];
    const mtlPaths: string[] = [];

    // Categorize files in the ZIP (including nested structures)
    for (const path of allPaths) {
        const entry = zip.files[path]!;

        // Skip directories
        if (entry.dir) {
            continue;
        }

        // Get the filename (last part of path)
        const filename = path.split('/').pop() || path;

        // Skip system/hidden files (check both full path and filename)
        if (isSystemFile(path) || isSystemFile(filename)) {
            continue;
        }

        const isModel = SUPPORTED_MODEL_FORMATS_REGEX.test(filename);
        const isTexture = isTextureFile(filename);
        const isBin = isBinFile(filename);
        const isMtl = isMtlFile(filename);

        if (isModel) {
            modelPaths.push(path);
        } else if (isTexture) {
            texturePaths.push(path);
        } else if (isBin) {
            binPaths.push(path);
        } else if (isMtl) {
            mtlPaths.push(path);
        }
    }

    // Deduplicate model paths (e.g., chair.glb + chair.fbx → keep chair.glb)
    const dedupedModelPaths = deduplicateModelFiles(modelPaths.map(p => ({name: p.split('/').pop() || p, fullPath: p})));
    const dedupedPathSet = new Set(dedupedModelPaths.map(p => p.fullPath));
    const filteredModelPaths = modelPaths.filter(p => dedupedPathSet.has(p));

    // If only one model, return the original ZIP as-is
    if (filteredModelPaths.length <= 1) {
        return { modelPackages: [zipFile], textureFiles: [] };
    }

    // Multiple models - extract textures and create packages
    const textureFiles: File[] = [];
    for (const path of texturePaths) {
        const blob = await zip.files[path]!.async('blob');
        const filename = path.split('/').pop() || path;
        textureFiles.push(new File([blob], filename, { type: blob.type || 'image/png' }));
    }

    // Extract model and bin files
    const modelFiles: File[] = [];
    for (const path of filteredModelPaths) {
        const blob = await zip.files[path]!.async('blob');
        const filename = path.split('/').pop() || path;
        modelFiles.push(new File([blob], filename, { type: blob.type || 'application/octet-stream' }));
    }

    const binFiles: File[] = [];
    for (const path of binPaths) {
        const blob = await zip.files[path]!.async('blob');
        const filename = path.split('/').pop() || path;
        binFiles.push(new File([blob], filename, { type: 'application/octet-stream' }));
    }

    const mtlFiles: File[] = [];
    for (const path of mtlPaths) {
        const blob = await zip.files[path]!.async('blob');
        const filename = path.split('/').pop() || path;
        mtlFiles.push(new File([blob], filename, { type: 'text/plain' }));
    }

    // Create model packages with textures
    const modelPackages = await createModelPackages(modelFiles, textureFiles, binFiles, mtlFiles);

    return { modelPackages, textureFiles };
};

type CategorizedFiles = {
    modelPackages: File[];
    textureFiles: File[];
};

/**
 * Categorizes files and creates model packages.
 *
 * Returns:
 * - modelPackages: Model files (or mini-zips with model + textures) to process
 * - textureFiles: Texture files to upload as separate image assets
 *
 * Logic:
 * - If a ZIP file contains multiple models, create packages for each with its textures
 * - If folder upload has multiple models + textures, create packages for each
 * - Textures are uploaded as separate image assets AND bundled with models for embedding
 * @param files
 */
const categorizeFiles = async (files: FileList | File): Promise<CategorizedFiles> => {
    // Helper to check if a file is a ZIP
    const isZipFile = (file: File) =>
        file.type === 'application/zip' ||
        file.type === 'application/x-zip-compressed' ||
        file.type === 'application/x-zip' ||
        file.name.toLowerCase().endsWith('.zip');

    // Handle single File object
    if (files instanceof File) {
        if (isZipFile(files)) {
            return processZipFile(files);
        }
        // Single non-ZIP file
        return { modelPackages: [files], textureFiles: [] };
    }

    // Handle FileList - check if it's a single ZIP file
    if (files.length === 1 && files[0] && isZipFile(files[0])) {
        return processZipFile(files[0]);
    }

    // Handle FileList (folder upload or multiple file selection)
    const fileArray = Array.from(files);
    const modelFiles: File[] = [];
    const textureFiles: File[] = [];
    const binFiles: File[] = [];
    const mtlFiles: File[] = [];

    for (const file of fileArray) {
        if (isSystemFile(file.name)) continue;

        if (SUPPORTED_MODEL_FORMATS_REGEX.test(file.name)) {
            modelFiles.push(file);
        } else if (isTextureFile(file.name)) {
            textureFiles.push(file);
        } else if (isBinFile(file.name)) {
            binFiles.push(file);
        } else if (isMtlFile(file.name)) {
            mtlFiles.push(file);
        }
    }

    // Deduplicate models by base name, keeping best format per model
    const dedupedModelFiles = deduplicateModelFiles(modelFiles);

    // If only one model, process as single package (may include textures)
    if (dedupedModelFiles.length <= 1) {
        if (dedupedModelFiles.length === 1 && (textureFiles.length > 0 || binFiles.length > 0 || mtlFiles.length > 0)) {
            // Single model with textures/bins/mtls - create a package
            const packages = await createModelPackages(dedupedModelFiles, textureFiles, binFiles, mtlFiles);
            // Don't upload textures separately for single model - they're bundled
            return { modelPackages: packages, textureFiles: [] };
        }
        // Single model, no textures - return as-is
        if (dedupedModelFiles.length === 1) {
            return { modelPackages: [dedupedModelFiles[0]!], textureFiles: [] };
        }
        // No models at all - fallback to zipping everything
        const originalOrZipFile = await zipFilesIfMultiple(files);
        return { modelPackages: [originalOrZipFile], textureFiles: [] };
    }

    // Multiple models - create packages for each and upload textures separately
    const modelPackages = await createModelPackages(dedupedModelFiles, textureFiles, binFiles, mtlFiles);

    return { modelPackages, textureFiles };
};

export default useModelUploader;
