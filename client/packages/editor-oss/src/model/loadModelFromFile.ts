import JSZip from 'jszip';
import { Mesh, Object3D } from 'three';

import { isGaussianSplatObject, isGaussianSplatPlyBlob } from './gaussianSplats';
import { isSupportedModelFormat } from './util';

/**
 * Error thrown when an FBX file contains only animations without any geometry.
 * These files are typically used as animation clips to apply to existing models.
 */
export class AnimationOnlyModelError extends Error {
    constructor(animationCount: number) {
        super(
            `This file contains ${animationCount} animation${animationCount !== 1 ? 's' : ''} but no 3D geometry. ` +
            `It appears to be an animation-only file, which cannot be imported as a standalone model.`,
        );
        this.name = 'AnimationOnlyModelError';
    }
}

/**
 * Checks if a model has any renderable geometry (meshes with vertices).
 * Throws AnimationOnlyModelError if the model only contains animations.
 * @param model
 */
const validateModelHasGeometry = (model: Object3D): void => {
    if (isGaussianSplatObject(model)) {
        return;
    }

    let meshCount = 0;
    let vertexCount = 0;

    traverseObjectDepthFirst(model, child => {
        if (child instanceof Mesh && child.geometry) {
            const positionAttr = child.geometry.getAttribute('position');
            if (positionAttr && positionAttr.count > 0) {
                meshCount++;
                vertexCount += positionAttr.count;
            }
        }
    });

    // If no meshes with vertices were found, check for animations
    if (meshCount === 0 || vertexCount === 0) {
        const animationCount = model.animations?.length ?? 0;

        if (animationCount > 0) {
            // Has animations but no geometry - this is an animation-only file
            throw new AnimationOnlyModelError(animationCount);
        }

        // No geometry and no animations - empty model
        throw new Error('This file does not contain any 3D geometry or animations.');
    }

};

import { ModelFormat, SUPPORTED_MODEL_FORMATS_REGEX } from '@stem/network/api/asset';
import GLTFLoaderExtended from '../assets/js/loaders/GLTFLoaderExtended';
import ModelLoader from '../assets/js/loaders/ModelLoader';
import { findAtlasFiles, loadAtlas } from '../atlas/AtlasDetector';
import { LoadedAtlas } from '../atlas/types';
import global from '../global';
import {
    detectTexturesAndModels,
    getTextureOverridesForModel,
    getBaseName,
    TextureOverrides,
    TextureDetectionResult,
} from '../texture/TextureMapping';
import {traverseObjectDepthFirst} from '../utils/SceneTraverser';

type LoadModelFromFileResult = {
    originalFile: File;
    model: Object3D;
    rootFile: File;
    fileBlobMap: Map<string, Blob>;
    format: ModelFormat;
    atlasData?: LoadedAtlas;
    textureOverrides?: TextureOverrides;
    textureDetection?: TextureDetectionResult;
};

export const loadModelFromFile = async (
    file: File,
    abortSignal: AbortSignal,
    companionFiles?: File[],
    overriddenFileType: string = "",
    sourceBuffer?: ArrayBuffer,
): Promise<LoadModelFromFileResult> => {
    abortSignal.throwIfAborted();

    // If the file is a zip, identify the "root" model file and expand the zip
    // to a map of file names to blobs
    const isZip = file.type === "application/zip" || overriddenFileType === "application/zip";
    let rootFile = file;
    let fileBlobMap = new Map<string, Blob>();
    let rootPath: string | undefined = undefined;
    let atlasData: LoadedAtlas | undefined = undefined;
    let textureOverrides: TextureOverrides | undefined = undefined;
    let textureDetection: TextureDetectionResult | undefined = undefined;

    if (isZip) {
        const {
            rootFile: rootZipFile,
            fileBlobMap: zipFileBlobMap,
            rootPath: rootZipPath,
        } = await expandZip(file, abortSignal);

        abortSignal.throwIfAborted();

        rootFile = rootZipFile;
        fileBlobMap = zipFileBlobMap;
        rootPath = rootZipPath;

        // Detect and load atlas if present in ZIP (atlas takes priority)
        const atlasFiles = findAtlasFiles(fileBlobMap);
        if (atlasFiles.length > 0 && atlasFiles[0]) {
            atlasData = await loadAtlas(atlasFiles[0], fileBlobMap, rootPath ?? '') ?? undefined;
        }

        // If no atlas, detect loose textures and build texture overrides
        if (!atlasData) {
            textureDetection = detectTexturesAndModels(fileBlobMap);

            console.warn(`[Pipeline] loadModelFromFile: textureDetection — ` +
                `${textureDetection.modelPaths.length} models, ` +
                `${textureDetection.texturePaths.length} textures, ` +
                `hasLooseTextures=${textureDetection.hasLooseTextures}`);
            console.warn(`[Pipeline] loadModelFromFile: fileBlobMap keys:`, Array.from(fileBlobMap.keys()));

            if (textureDetection.hasLooseTextures) {
                const modelBaseName = getBaseName(rootZipFile.name);
                textureOverrides = getTextureOverridesForModel(modelBaseName, textureDetection);

                console.warn(`[Pipeline] loadModelFromFile: textureOverrides for "${modelBaseName}":`,
                    textureOverrides ? Object.keys(textureOverrides) : 'none');

                if (!textureOverrides || Object.keys(textureOverrides).length === 0) {
                    // Fallback: if we have exactly 1 model and 1+ textures, force the first texture as override
                    if (textureDetection.modelPaths.length === 1 && textureDetection.texturePaths.length >= 1) {
                        const firstTexturePath = textureDetection.texturePaths[0]!;
                        const textureBlob = fileBlobMap.get(firstTexturePath);
                        if (textureBlob) {
                            textureOverrides = {
                                map: { blob: textureBlob, path: firstTexturePath },
                            };
                            console.warn(`[Pipeline] loadModelFromFile: Fallback override — using "${firstTexturePath}" as map`);
                        }
                    }
                }
            }
        }
    } else if (companionFiles && companionFiles.length > 0) {
        for (const cf of companionFiles) {
            fileBlobMap.set(cf.name, cf);
        }
    }

    // Determine the model format from the file extension and check if it's
    // supported
    const format = rootFile.name.split(".").pop()?.toLowerCase();
    if (!format) {
        throw new Error("Model file has no extension");
    }

    if (!isSupportedModelFormat(format)) {
        throw new Error(`Unsupported model format: ${format}`);
    }

    // Load the model
    const model = await loadModel(
        rootFile,
        format,
        fileBlobMap,
        rootPath,
        atlasData,
        textureOverrides,
        rootFile === file ? sourceBuffer : undefined,
    );
    abortSignal.throwIfAborted();

    if (!model) {
        throw new Error("Failed to load model");
    }

    // Validate that the model has geometry (not just animations)
    validateModelHasGeometry(model);

    return {
        originalFile: file,
        model,
        rootFile,
        fileBlobMap,
        format,
        atlasData,
        textureOverrides,
        textureDetection,
    };
};

const expandZip = async (file: File, abortSignal: AbortSignal) => {
    abortSignal.throwIfAborted();

    const zipper = new JSZip();
    const zip = await zipper.loadAsync(file);
    
    abortSignal.throwIfAborted();

    // Find the root file (the first file that matches SUPPORTED_FORMATS)
    const rootFilePath = Object.keys(zip.files).find(
        (path) => path.match(SUPPORTED_MODEL_FORMATS_REGEX),
    );
    
    if (!rootFilePath) {
        throw new Error("Root file not found");
    }

    // Load all of the file blobs
    const filePromises = Object.entries(zip.files).map(([filename, file]) => {
        return new Promise<[string, Blob]>((resolve, reject) => {
            file.async("blob")
                .then(blob => resolve([filename, blob]))
                .catch(reject);
        });
    });

    const fileBlobs = await Promise.all(filePromises);
    const fileBlobMap = new Map(fileBlobs);
    const rootFileBlob = fileBlobMap.get(rootFilePath)!;
    const rootPath = rootFilePath.split("/").slice(0, -1).join("/");
    const rootFilename = rootFilePath.split("/").pop() || "untitled";
    const rootFile = new File([rootFileBlob], rootFilename);

    return { rootFile, fileBlobMap, rootPath };
};

const loadModel = async (
    file: File,
    format: ModelFormat,
    fileBlobMap: Map<string, Blob>,
    rootPath: string | undefined,
    atlasData: LoadedAtlas | undefined,
    textureOverrides: TextureOverrides | undefined,
    sourceBuffer?: ArrayBuffer,
) => {
    const isGlbOrGltf = format === ModelFormat.Gltf || format === ModelFormat.Glb;

    if (isGlbOrGltf) {
        const loader = new GLTFLoaderExtended();
        if (
            format === ModelFormat.Glb &&
            sourceBuffer &&
            fileBlobMap.size === 0 &&
            !atlasData &&
            !textureOverrides
        ) {
            return loader.parseGlb(sourceBuffer);
        }
        const objectUrl = URL.createObjectURL(file);
        return loader.load(objectUrl, rootPath || "", fileBlobMap, atlasData, textureOverrides).finally(() => {
            URL.revokeObjectURL(objectUrl);
        });
    }

    const objectUrl = URL.createObjectURL(file);

    // For other formats (including PLY), pass fileBlobMap, rootPath, atlasData, and textureOverrides in options
    const forceGaussianSplatPly = format === ModelFormat.Ply
        ? await isGaussianSplatPlyBlob(file)
        : false;

    const loader = new ModelLoader();
    const obj = loader.load(
        objectUrl,
        {
            Type: format,
            ForceGaussianSplatPly: forceGaussianSplatPly,
            DisableReupload: true,
            fileBlobMap,
            rootPath,
            atlasData,
            textureOverrides,
        },
        {
            camera: global.app?.editor?.camera,
            renderer: global.app?.editor?.renderer,
            audioListener: global.app?.editor?.audioListener,
        },
    ).finally(() => {
        loader.dispose();
        URL.revokeObjectURL(objectUrl);
    });

    return obj;
};
