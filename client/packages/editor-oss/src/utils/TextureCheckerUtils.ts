import { Material, Mesh, Object3D, Scene, Texture } from 'three';

import global from "../global";
import { createClickableItems, showToast } from '@stem/editor-oss/showToast';
import {traverseObjectDepthFirst} from "./SceneTraverser";

export interface TextureSizeThresholds {
    /** Warning threshold in pixels (width * height) */
    warningSize: number;
    /** Critical threshold in pixels (width * height) */
    criticalSize: number;
    /** Warning threshold in megabytes (estimated memory usage) */
    warningMemoryMB: number;
    /** Critical threshold in megabytes (estimated memory usage) */
    criticalMemoryMB: number;
}

export interface LargeTextureInfo {
    textureName: string;
    objectName: string;
    objectUuid: string;
    width: number;
    height: number;
    pixels: number;
    estimatedMemoryMB: number;
    materialType: string;
    textureType: string;
}

export interface TextureCheckResult {
    hasLargeTextures: boolean;
    warningTextures: LargeTextureInfo[];
    criticalTextures: LargeTextureInfo[];
    totalTexturesChecked: number;
}

/**
 * Default thresholds for texture sizes
 * - Warning: 2K textures (2048x2048) or ~16MB
 * - Critical: 4K textures (4096x4096) or ~64MB
 */
export const DEFAULT_TEXTURE_THRESHOLDS: TextureSizeThresholds = {
    warningSize: 2048 * 2048, // 4,194,304 pixels
    criticalSize: 4096 * 4096, // 16,777,216 pixels
    warningMemoryMB: 16,
    criticalMemoryMB: 64,
};

/**
 * Estimate memory usage of a texture in megabytes
 * Assumes RGBA format with 4 bytes per pixel and includes mipmaps
 * @param width
 * @param height
 */
function estimateTextureMemory(width: number, height: number): number {
    // Base texture size in bytes (RGBA = 4 bytes per pixel)
    const baseSize = width * height * 4;
    
    // Include mipmaps (approximately 1.33x the base size)
    const withMipmaps = baseSize * 1.33;
    
    // Convert to megabytes
    return withMipmaps / (1024 * 1024);
}

/**
 *
 * @param textureKey
 */
function getTextureTypeName(textureKey: string): string {
    const typeMap: Record<string, string> = {
        map: "Diffuse/Color",
        normalMap: "Normal",
        roughnessMap: "Roughness",
        metalnessMap: "Metalness",
        aoMap: "Ambient Occlusion",
        emissiveMap: "Emissive",
        bumpMap: "Bump",
        displacementMap: "Displacement",
        alphaMap: "Alpha",
        lightMap: "Light",
        envMap: "Environment",
    };
    
    return typeMap[textureKey] || textureKey;
}

/**
 *
 * @param texture
 * @param objectName
 * @param objectUuid
 * @param materialType
 * @param textureKey
 * @param thresholds
 */
function checkTexture(
    texture: Texture,
    objectName: string,
    objectUuid: string,
    materialType: string,
    textureKey: string,
    thresholds: TextureSizeThresholds,
): LargeTextureInfo | null {
    if (!texture.image) {
        return null;
    }

    const img = texture.image as { width?: number; height?: number };
    const width = img.width || 0;
    const height = img.height || 0;
    
    if (width === 0 || height === 0) {
        return null;
    }

    const pixels = width * height;
    const estimatedMemoryMB = estimateTextureMemory(width, height);

    const exceedsWarning = pixels >= thresholds.warningSize || estimatedMemoryMB >= thresholds.warningMemoryMB;
    
    if (!exceedsWarning) {
        return null;
    }

    const textureName = texture.name || texture.uuid || "Unnamed Texture";

    return {
        textureName,
        objectName,
        objectUuid,
        width,
        height,
        pixels,
        estimatedMemoryMB,
        materialType,
        textureType: getTextureTypeName(textureKey),
    };
}

/**
 *
 * @param material
 * @param objectName
 * @param objectUuid
 * @param thresholds
 */
function checkMaterial(
    material: Material,
    objectName: string,
    objectUuid: string,
    thresholds: TextureSizeThresholds,
): LargeTextureInfo[] {
    const largeTextures: LargeTextureInfo[] = [];
    const materialType = material.type;

    // List of common texture properties in Three.js materials
    const textureKeys = [
        "map",
        "normalMap",
        "roughnessMap",
        "metalnessMap",
        "aoMap",
        "emissiveMap",
        "bumpMap",
        "displacementMap",
        "alphaMap",
        "lightMap",
        "envMap",
    ];

    for (const key of textureKeys) {
        const texture = (material as any)[key] as Texture | undefined;
        if (texture && texture.isTexture) {
            const textureInfo = checkTexture(texture, objectName, objectUuid, materialType, key, thresholds);
            if (textureInfo) {
                largeTextures.push(textureInfo);
            }
        }
    }

    return largeTextures;
}

/**
 *
 * @param scene
 * @param thresholds
 */
export function checkSceneTextures(
    scene: Scene,
    thresholds: TextureSizeThresholds = DEFAULT_TEXTURE_THRESHOLDS,
): TextureCheckResult {
    const warningTextures: LargeTextureInfo[] = [];
    const criticalTextures: LargeTextureInfo[] = [];
    const checkedTextures = new Set<string>();
    let totalTexturesChecked = 0;

    traverseObjectDepthFirst(scene, (object: Object3D) => {
        // Check if object is a Mesh with material
        if ((object as Mesh).material !== undefined) {
            const mesh = object as Mesh;
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

            materials.forEach((material: Material) => {
                const largeTextures = checkMaterial(material, object.name || "Unnamed Object", object.uuid, thresholds);
                
                largeTextures.forEach(textureInfo => {
                    // Use texture UUID to avoid counting the same texture multiple times
                    const textureId = `${textureInfo.textureName}_${textureInfo.width}x${textureInfo.height}`;
                    
                    if (!checkedTextures.has(textureId)) {
                        checkedTextures.add(textureId);
                        totalTexturesChecked++;

                        // Categorize by severity
                        const isCritical = 
                            textureInfo.pixels >= thresholds.criticalSize || 
                            textureInfo.estimatedMemoryMB >= thresholds.criticalMemoryMB;

                        if (isCritical) {
                            criticalTextures.push(textureInfo);
                        } else {
                            warningTextures.push(textureInfo);
                        }
                    }
                });
            });
        }
    });

    return {
        hasLargeTextures: warningTextures.length > 0 || criticalTextures.length > 0,
        warningTextures,
        criticalTextures,
        totalTexturesChecked,
    };
}

/**
 *
 * @param info
 */
function formatTextureInfo(info: LargeTextureInfo): string {
    return `${info.objectName} - ${info.textureType} (${info.width}x${info.height}, ~${info.estimatedMemoryMB.toFixed(1)}MB)`;
}

/**
 *
 * @param result
 */
export function notifyLargeTextures(result: TextureCheckResult): void {
    if (!result.hasLargeTextures) {
        return;
    }

    // Helper function to select object by UUID
    const selectObject = (objectUuid: string) => {
        const editor = global.app?.editor;
        if (editor) {
            editor.selectByUuid(objectUuid);
        }
    };

    // Critical textures notification with clickable items
    if (result.criticalTextures.length > 0) {
        const clickableItems = createClickableItems(
            result.criticalTextures.slice(0, 5), // Show up to 5 clickable items
            (texture) => `${texture.objectName} - ${texture.textureType} (${texture.width}×${texture.height}, ~${texture.estimatedMemoryMB.toFixed(1)}MB)`,
            (texture) => selectObject(texture.objectUuid),
            () => "🖼️", // Icon for all texture items
            (texture) => `Click to select "${texture.objectName}" in the editor`,
        );

        const bodyText = result.criticalTextures.length > 5
            ? `Found ${result.criticalTextures.length} textures that are 4K or larger (showing first 5). Click on items to select objects in the editor.`
            : `Found ${result.criticalTextures.length} textures that are 4K or larger. Click on items to select objects in the editor.`;

        showToast({
            type: "error",
            title: "Critical: Very Large Textures Detected!",
            body: bodyText,
            clickableItems,
        });
    }

    // Warning textures notification with clickable items
    if (result.warningTextures.length > 0) {
        const clickableItems = createClickableItems(
            result.warningTextures.slice(0, 5), // Show up to 5 clickable items
            (texture) => `${texture.objectName} - ${texture.textureType} (${texture.width}×${texture.height}, ~${texture.estimatedMemoryMB.toFixed(1)}MB)`,
            (texture) => selectObject(texture.objectUuid),
            () => "⚠️", // Icon for warning items
            (texture) => `Click to select "${texture.objectName}" in the editor`,
        );

        const bodyText = result.warningTextures.length > 5
            ? `Found ${result.warningTextures.length} textures that are 2K or larger (showing first 5). These may impact performance on lower-end devices.`
            : `Found ${result.warningTextures.length} textures that are 2K or larger. These may impact performance on lower-end devices.`;

        showToast({
            type: "warning",
            title: "Warning: Large Textures Detected",
            body: bodyText,
            clickableItems,
        });
    }
}

/**
 *
 * @param scene
 * @param thresholds
 */
export function checkAndNotifyLargeTextures(
    scene: Scene,
    thresholds?: TextureSizeThresholds,
): TextureCheckResult {
    const result = checkSceneTextures(scene, thresholds);
    notifyLargeTextures(result);
    return result;
}

/**
 *
 * @param result
 */
export function logLargeTexturesReport(result: TextureCheckResult): void {
    if (!result.hasLargeTextures) {
        console.info("[TextureChecker] No large textures found. Scene is optimized!");
        return;
    }

    console.group("[TextureChecker] Large Textures Report");
    console.info(`Total textures checked: ${result.totalTexturesChecked}`);
    
    if (result.criticalTextures.length > 0) {
        console.group(`❌ Critical Textures (${result.criticalTextures.length})`);
        result.criticalTextures.forEach(info => {
            console.warn(formatTextureInfo(info));
        });
        console.groupEnd();
    }
    
    if (result.warningTextures.length > 0) {
        console.group(`⚠️ Warning Textures (${result.warningTextures.length})`);
        result.warningTextures.forEach(info => {
            console.log(formatTextureInfo(info));
        });
        console.groupEnd();
    }
    
    console.groupEnd();
}
