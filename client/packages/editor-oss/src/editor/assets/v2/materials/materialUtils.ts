/* eslint-disable import/order */
import * as THREE from "three";
import {
    EMPTY_TEXTURE_SETTINGS,
    EMPTY_TEXTURES,
    IMaterialSettings,
    IMaterialSettingsMap,
    IMaterialSettingsTextures,
} from "../RightPanel/sections/MaterialRenderingSection/types";
import {MATERIAL_TYPES} from "@stem/editor-oss/types/editor";
import {fetchAssetImageDerivative} from "../../../asset-management/hooks/assets";
import {parseMaterialAssetIdWithRevision} from "../../../images/hooks";
import {resolveAssetId, resolveAssetRevisionId} from "@stem/editor-oss/asset-management/AssetResolutionContext";
import {useAssetResolutionContext} from "@stem/editor-oss/context/AssetResolutionContext";
import global from "@stem/editor-oss/global";

// Keep a single cache per module to avoid reloading textures when only UV transforms change
const textureUrlMap: WeakMap<THREE.Texture, string> = new WeakMap();
const managedTextureKeyByTexture: WeakMap<THREE.Texture, string> = new WeakMap();
const managedTextureCache: Map<string, {texture: THREE.Texture; refCount: number}> = new Map();

type ManagedTextureOptions = {
    targetKey: TextureTargetKey;
    settings: IMaterialSettings;
    stableAssetKey?: string;
};

const roundCacheNumber = (value: number): string => value.toFixed(4);

const getManagedTextureColorSpaceKey = (targetKey: TextureTargetKey): "srgb" | "linear" => {
    return targetKey === "map" || targetKey === "emissiveMap" || targetKey === "specularMap" ? "srgb" : "linear";
};

const inferMaterialType = (mat: THREE.Material | undefined | null): MATERIAL_TYPES => {
    if (!mat) return MATERIAL_TYPES.SPECULAR;
    if (mat instanceof THREE.MeshPhysicalMaterial) return MATERIAL_TYPES.PBR;
    if (mat instanceof THREE.MeshStandardMaterial) return MATERIAL_TYPES.METALLIC;
    return MATERIAL_TYPES.SPECULAR;
};

const getFirstMaterialFromObject = (object: THREE.Object3D): THREE.Material | undefined => {
    let firstMaterial: THREE.Material | undefined;

    object.traverse(child => {
        if (firstMaterial || (!(child instanceof THREE.Mesh) && !(child instanceof THREE.SkinnedMesh))) {
            return;
        }

        const meshMaterial = child.material as THREE.Material | THREE.Material[];
        const material = Array.isArray(meshMaterial) ? meshMaterial[0] : meshMaterial;
        if (material) {
            firstMaterial = material;
        }
    });

    return firstMaterial;
};

export const createDefaultMaterialSettings = (material?: THREE.Material): IMaterialSettings => ({
    isDoubleSided: material?.side === THREE.DoubleSide,
    tileAmountX: 0.5,
    tileAmountY: 0.5,
    panningSpeedX: 0.5,
    panningSpeedY: 0.5,
    materialType: inferMaterialType(material),
    textures: {...EMPTY_TEXTURES},
    texturesSettings: {
        ...EMPTY_TEXTURE_SETTINGS,
        opacity: material?.opacity ?? 1,
        useBaseAlpha: material?.transparent ?? false,
        color:
            material && "color" in material && material.color instanceof THREE.Color
                ? `#${material.color.getHexString()}`
                : "#fff",
        metallic:
            material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial
                ? material.metalness
                : EMPTY_TEXTURE_SETTINGS.metallic,
        roughness:
            material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial
                ? material.roughness
                : EMPTY_TEXTURE_SETTINGS.roughness,
        emissiveIntensity:
            material && "emissiveIntensity" in material && typeof material.emissiveIntensity === "number"
                ? material.emissiveIntensity
                : EMPTY_TEXTURE_SETTINGS.emissiveIntensity,
        normalScale:
            material && "normalScale" in material && material.normalScale instanceof THREE.Vector2
                ? material.normalScale.x
                : EMPTY_TEXTURE_SETTINGS.normalScale,
        specularIntensity:
            material instanceof THREE.MeshPhysicalMaterial
                ? material.specularIntensity
                : material instanceof THREE.MeshPhongMaterial
                  ? material.shininess / 30
                  : EMPTY_TEXTURE_SETTINGS.specularIntensity,
        specularColor:
            material instanceof THREE.MeshPhysicalMaterial
                ? `#${material.specularColor.getHexString()}`
                : material instanceof THREE.MeshPhongMaterial
                  ? `#${material.specular.getHexString()}`
                  : undefined,
        emissiveColor:
            material && "emissive" in material && material.emissive instanceof THREE.Color
                ? `#${material.emissive.getHexString()}`
                : undefined,
        ao:
            material && "aoMapIntensity" in material && typeof material.aoMapIntensity === "number"
                ? material.aoMapIntensity
                : EMPTY_TEXTURE_SETTINGS.ao,
    },
});

const cloneMaterialSettings = (settings: IMaterialSettings): IMaterialSettings => ({
    ...settings,
    textures: {...settings.textures},
    texturesSettings: {...settings.texturesSettings},
});

const isMaterialSettingsMap = (settings: unknown): settings is IMaterialSettingsMap => {
    if (!settings || typeof settings !== "object") {
        return false;
    }

    return Object.keys(settings).some(key => key.includes("::"));
};

const buildManagedTextureKey = (
    url: string,
    {targetKey, settings, stableAssetKey}: ManagedTextureOptions,
): string => {
    const identity = stableAssetKey ? `asset:${stableAssetKey}` : `url:${url}`;
    const colorSpace = getManagedTextureColorSpaceKey(targetKey);
    return [
        identity,
        `target:${targetKey}`,
        `cs:${colorSpace}`,
        `rx:${roundCacheNumber(settings.tileAmountX)}`,
        `ry:${roundCacheNumber(settings.tileAmountY)}`,
        `ox:${roundCacheNumber(settings.panningSpeedX)}`,
        `oy:${roundCacheNumber(settings.panningSpeedY)}`,
    ].join("|");
};

const configureTexture = (
    texture: THREE.Texture,
    targetKey: TextureTargetKey,
    settings: IMaterialSettings,
) => {
    if (targetKey === "map" || targetKey === "emissiveMap" || targetKey === "specularMap") {
        texture.colorSpace = THREE.SRGBColorSpace;
    }

    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(settings.tileAmountX, settings.tileAmountY);
    texture.offset.set(settings.panningSpeedX, settings.panningSpeedY);
};

const acquireManagedTexture = (
    url: string,
    options: ManagedTextureOptions,
): THREE.Texture => {
    const key = buildManagedTextureKey(url, options);
    const cached = managedTextureCache.get(key);

    if (cached) {
        cached.refCount += 1;
        return cached.texture;
    }

    const texture = new THREE.TextureLoader().load(url);
    configureTexture(texture, options.targetKey, options.settings);
    textureUrlMap.set(texture, url);
    managedTextureKeyByTexture.set(texture, key);

    managedTextureCache.set(key, {texture, refCount: 1});
    return texture;
};

const releaseManagedTexture = (texture: THREE.Texture | null | undefined): void => {
    if (!texture) return;

    const key = managedTextureKeyByTexture.get(texture);
    if (!key) return;

    const cached = managedTextureCache.get(key);
    if (!cached) {
        managedTextureKeyByTexture.delete(texture);
        textureUrlMap.delete(texture);
        return;
    }

    cached.refCount -= 1;
    if (cached.refCount <= 0) {
        managedTextureCache.delete(key);
        managedTextureKeyByTexture.delete(texture);
        textureUrlMap.delete(texture);
        texture.dispose?.();
    }
};

/**
 * Generate a unique path key for a material in the object hierarchy
 * Format: "path.to.mesh::materialIndex"
 * @param mesh - The mesh containing the material
 * @param materialIndex - The index of the material in the mesh's material array
 * @param rootObject - The root object to calculate path from
 * @returns A unique path key for the material
 */
export const generateMaterialPathKey = (
    mesh: THREE.Mesh | THREE.SkinnedMesh,
    materialIndex: number,
    rootObject: THREE.Object3D,
): string => {
    const pathParts: string[] = [];
    let current: THREE.Object3D | null = mesh;

    // Build path from mesh to root
    while (current && current !== rootObject) {
        pathParts.unshift(current.name || current.uuid);
        current = current.parent;
    }

    // Add root
    pathParts.unshift("root");

    return `${pathParts.join("///")}::${materialIndex}`;
};

const splitMaterialPath = (path: string, separator: string): string[] => path.split(separator);

const isMaterialPathMatch = (
    storedPath: string,
    childPathParts: string[],
    rootObject: THREE.Object3D,
    separator: string,
): boolean => {
    const stableRootPath = ["root", ...childPathParts].join(separator);
    const legacyNamedRootPath = [rootObject.name || "root", ...childPathParts].join(separator);
    const rootlessPath = childPathParts.join(separator);

    if (
        storedPath === stableRootPath ||
        storedPath === legacyNamedRootPath ||
        storedPath === rootlessPath
    ) {
        return true;
    }

    const storedParts = splitMaterialPath(storedPath, separator);

    if (storedParts.length !== childPathParts.length + 1) {
        return false;
    }

    return childPathParts.every((part, index) => storedParts[index + 1] === part);
};

/**
 * Find a material by its path key in an object hierarchy
 * @param object - The root object to search from
 * @param pathKey - The path key generated by generateMaterialPathKey
 * @returns The material and its parent mesh, or null if not found
 */
export const findMaterialByPathKey = (
    object: THREE.Object3D,
    pathKey: string,
): {material: THREE.Material; mesh: THREE.Mesh | THREE.SkinnedMesh; index: number} | null => {
    const [path, indexStr] = pathKey.split("::");
    const materialIndex = parseInt(indexStr || "0", 10);

    if (!path) return null;

    let result: {material: THREE.Material; mesh: THREE.Mesh | THREE.SkinnedMesh; index: number} | null = null;

    object.traverse(child => {
        if (result) return; // Already found
        if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.SkinnedMesh)) return;

        // Build path for this child
        const childPathParts: string[] = [];
        let current: THREE.Object3D | null = child;

        while (current && current !== object) {
            childPathParts.unshift(current.name || current.uuid);
            current = current.parent;
        }

        // Detect separator from pathKey to support backward compatibility
        const separator = path.includes("///") ? "///" : ".";
        if (isMaterialPathMatch(path, childPathParts, object, separator)) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            const targetMaterial = materials[materialIndex] as THREE.Material | undefined;
            if (targetMaterial) {
                result = {material: targetMaterial, mesh: child, index: materialIndex};
            }
        }
    });

    return result;
};

type MaterialWithMaps = THREE.Material &
    Partial<Record<TextureTargetKey, THREE.Texture | null>> & {
        emissive?: THREE.Color;
        color?: THREE.Color;
        specular?: THREE.Color;
        emissiveIntensity?: number;
        metalness?: number;
        roughness?: number;
        aoMapIntensity?: number;
        normalScale?: THREE.Vector2;
        opacity?: number;
        transparent?: boolean;
    };

export type TextureTargetKey =
    | "map"
    | "aoMap"
    | "roughnessMap"
    | "metalnessMap"
    | "normalMap"
    | "emissiveMap"
    | "specularMap"
    | "";

export const createMaterialForType = (type: MATERIAL_TYPES): THREE.Material => {
    switch (type) {
        case MATERIAL_TYPES.SPECULAR:
            return new THREE.MeshPhongMaterial();
        case MATERIAL_TYPES.METALLIC:
            return new THREE.MeshStandardMaterial();
        case MATERIAL_TYPES.PBR:
            return new THREE.MeshPhysicalMaterial();
        default:
            return new THREE.MeshPhongMaterial();
    }
};

const applyOrClearMap = (params: {
    material: MaterialWithMaps;
    mapKey: keyof IMaterialSettingsTextures;
    targetKey: TextureTargetKey;
    textures: IMaterialSettingsTextures;
    settings: IMaterialSettings;
    originalTexture?: THREE.Texture | null;
}) => {
    const {material, mapKey, targetKey, textures, settings, originalTexture} = params;
    const value = textures[mapKey];
    if (!targetKey) return;

    if (value && isAssetId(value)) {
        releaseManagedTexture(material[targetKey] ?? null);
        material[targetKey] = null;
        return;
    }
    const url = textures[mapKey];
    const current = material[targetKey] ?? null;

    // Handle explicit deletion marker
    if (url === "__deleted__") {
        releaseManagedTexture(current);
        material[targetKey] = null;
        return;
    }

    if (!url) {
        // If URL is empty but we have an original texture, keep it instead of clearing
        if (originalTexture) {
            releaseManagedTexture(current);
            material[targetKey] = originalTexture;
            if (originalTexture) {
                originalTexture.wrapS = THREE.RepeatWrapping;
                originalTexture.wrapT = THREE.RepeatWrapping;
                originalTexture.repeat.set(settings.tileAmountX, settings.tileAmountY);
                originalTexture.offset.set(settings.panningSpeedX, settings.panningSpeedY);
                if (originalTexture.image) {
                    originalTexture.needsUpdate = true;
                }
            }
        } else {
            // No original texture to preserve, clear it
            releaseManagedTexture(current);
            material[targetKey] = null;
        }
        return;
    }

    const desiredKey = buildManagedTextureKey(url, {targetKey, settings});
    if (current && managedTextureKeyByTexture.get(current) === desiredKey) {
        return;
    }

    releaseManagedTexture(current);
    material[targetKey] = acquireManagedTexture(url, {targetKey, settings});
};

/**
 * Check if a value is an assetId (not a URL or path)
 * Assumes assetId is a 24-character hex string (Mongo-style) or UUID
 * @param value
 */
export const isAssetId = (value: string): boolean => {
    if (typeof value !== "string" || !value) return false;
    // Mongo-style 24-hex id or UUID (integrated builds).
    if (/^([a-f0-9]{24}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(value)) {
        return true;
    }
    // OSS synthesizes asset ids as `oss-asset-<timestamp>-<rand>` (see
    // network/.../asset/index.ts). These are real asset ids, not URLs. Without
    // this, a material texture backed by an imported OSS image asset fails both
    // the apply path (treated as a URL → TextureLoader 404 → blank texture) and
    // the resolve path (skipped entirely), so the texture renders empty.
    return value.startsWith("oss-asset-");
};

/**
 * Map a material settings texture key to a Three.js material texture property
 * @param mapKey - The key from IMaterialSettingsTextures
 * @returns The corresponding THREE.Material texture property
 */
const mapKeyToTextureTargetKey = (mapKey: keyof IMaterialSettingsTextures): TextureTargetKey => {
    switch (mapKey) {
        case "base":
            return "map";
        case "ambient":
            return "aoMap";
        case "roughness":
            return "roughnessMap";
        case "metallic":
            return "metalnessMap";
        case "normal":
            return "normalMap";
        case "emissive":
            return "emissiveMap";
        case "specular":
            return "specularMap";
        default:
            return "";
    }
};

export const updateDynamicTexturesForMaterial = async (
    mat: MaterialWithMaps & {userData?: any},
    settings: IMaterialSettings,
    context?: ReturnType<typeof useAssetResolutionContext>["context"] | null,
) => {
    if (!settings?.textures) return;

    for (const mapKey of Object.keys(settings.textures) as Array<keyof IMaterialSettingsTextures>) {
        const assetData = parseMaterialAssetIdWithRevision(settings.textures[mapKey]);
        if (!assetData) continue;
        const {assetId} = assetData;
        if (assetId && isAssetId(assetId)) {
            // NOTE: we update assetId to cut off legacy revision info.
            // This line can be removed after all materials are updated to new format without revision in textures
            settings.textures[mapKey] = assetData?.assetId || settings.textures[mapKey];

            try {
                const resolvedAssetId = context ? resolveAssetId(assetId, context) : assetId;
                const revisionID = context ? resolveAssetRevisionId(assetId, context) : undefined;
                // Use AssetLoader (cached) when available, fall back to individual API call
                const assetLoader = global.app?.assetLoader;
                let url: string;
                if (assetLoader && revisionID) {
                    const result = await assetLoader.getImageDataUrl({ assetId: resolvedAssetId, revisionId: revisionID });
                    url = result.url;
                } else {
                    url = await fetchAssetImageDerivative(resolvedAssetId, undefined, context);
                }
                const targetKey = mapKeyToTextureTargetKey(mapKey);
                if (!targetKey) continue;

                const current = mat[targetKey] ?? null;
                const stableAssetKey = `${resolvedAssetId}:${revisionID ?? "latest"}`;
                const desiredKey = buildManagedTextureKey(url, {targetKey, settings, stableAssetKey});
                if (current && managedTextureKeyByTexture.get(current) === desiredKey) {
                    mat.needsUpdate = true;
                    continue;
                }

                releaseManagedTexture(current);

                const tex = acquireManagedTexture(url, {targetKey, settings, stableAssetKey});
                tex.userData = {imageId: resolvedAssetId, revisionID};

                mat[targetKey] = tex;
                mat.needsUpdate = true;
            } catch (err) {
                console.warn("Cannot fetch asset", err);
            }
        }
    }
};

export const applyMaterialSettingsToObject = (
    object: THREE.Object3D,
    settingsMap: IMaterialSettingsMap | IMaterialSettings | undefined,
    context?: ReturnType<typeof useAssetResolutionContext>["context"] | null,
) => {
    if (!settingsMap) return;

    let map: IMaterialSettingsMap;

    // Handle legacy single settings object - convert to map
    if ("materialType" in settingsMap && "textures" in settingsMap) {
        // This is a legacy IMaterialSettings object, convert to map
        const legacySettings = settingsMap as IMaterialSettings;
        map = {};

        // Convert legacy settings to map by traversing all materials
        object.traverse(child => {
            if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.SkinnedMesh)) return;
            const mesh = child as THREE.Mesh | THREE.SkinnedMesh;

            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((material, index) => {
                const pathKey = generateMaterialPathKey(mesh, index, object);
                map[pathKey] = {...legacySettings};
            });
        });

        object.userData.materialSettings = map;
    } else {
        map = {...settingsMap};
    }

    // Resolve targets and detect collisions
    const resolvedTargets: Array<{
        key: string;
        settings: IMaterialSettings;
        found: {material: THREE.Material; mesh: THREE.Mesh | THREE.SkinnedMesh; index: number};
    }> = [];

    // Map to track collisions: "meshUuid::materialIndex" -> key
    const slotToKeyMap = new Map<string, string>();
    const keysToRemove = new Set<string>();

    Object.entries(map).forEach(([pathKey, settings]) => {
        const found = findMaterialByPathKey(object, pathKey);
        if (found) {
            resolvedTargets.push({key: pathKey, settings, found});

            // Unique identifier for the material slot on the specific mesh instance
            const slotId = `${found.mesh.uuid}::${found.index}`;

            if (slotToKeyMap.has(slotId)) {
                // Collision detected
                const previousKey = slotToKeyMap.get(slotId)!;
                // "Remove first items": previousKey is the first item
                keysToRemove.add(previousKey);
                // Update map with current key (last one wins)
                slotToKeyMap.set(slotId, pathKey);
            } else {
                slotToKeyMap.set(slotId, pathKey);
            }
        }
    });

    // Remove first items and save to object.userData.materialSettings
    if (keysToRemove.size > 0) {
        keysToRemove.forEach(key => {
            delete map[key];
        });
    }

    // Always update the persisted settings on the object with the clean map
    object.userData.materialSettings = map;

    const materialReplacements: Array<{
        mesh: THREE.Mesh | THREE.SkinnedMesh;
        index: number;
        material: THREE.Material;
        settings: IMaterialSettings;
    }> = [];

    resolvedTargets.forEach(({key, settings, found}) => {
        if (keysToRemove.has(key)) return;

        const {material, mesh, index} = found;
        const updatedMaterial = applySettingsToMaterial(material, settings);
        updatedMaterial.needsUpdate = true;

        materialReplacements.push({
            mesh,
            index,
            material: updatedMaterial,
            settings,
        });
    });

    // Apply all collected material replacements directly on the resolved mesh slots
    materialReplacements.forEach(({mesh, index, material, settings}) => {
        const currentMaterial = mesh.material;

        if (Array.isArray(currentMaterial)) {
            if (index >= 0 && index < currentMaterial.length) {
                currentMaterial[index] = material;
            }
        } else {
            // For single-material meshes, treat index 0 as the only valid slot
            if (index === 0) {
                mesh.material = material;
            }
        }

        material.userData = {
            ...material.userData,
            materialSettings: object.userData.materialSettings as IMaterialSettingsMap | IMaterialSettings | undefined,
        };

        void updateDynamicTexturesForMaterial(material, settings, context);
    });
};

export const applyTextureOverridesToObject = (
    object: THREE.Object3D,
    overrides: Partial<Record<keyof IMaterialSettingsTextures, string>>,
    context?: ReturnType<typeof useAssetResolutionContext>["context"] | null,
): IMaterialSettingsMap | IMaterialSettings | undefined => {
    const overrideEntries = Object.entries(overrides).filter(([, value]) => typeof value === "string" && value);
    if (overrideEntries.length === 0) {
        return object.userData.materialSettings as IMaterialSettingsMap | IMaterialSettings | undefined;
    }

    const existingSettings = object.userData.materialSettings as IMaterialSettingsMap | IMaterialSettings | undefined;

    if (isMaterialSettingsMap(existingSettings)) {
        const updatedMap = Object.fromEntries(
            Object.entries(existingSettings).map(([pathKey, settings]) => {
                const nextSettings = cloneMaterialSettings(settings);
                for (const [textureKey, value] of overrideEntries) {
                    nextSettings.textures[textureKey as keyof IMaterialSettingsTextures] = value;
                }
                return [pathKey, nextSettings];
            }),
        );

        object.userData.materialSettings = updatedMap;
        applyMaterialSettingsToObject(object, updatedMap, context);
        return updatedMap;
    }

    const nextSettings = existingSettings && "textures" in existingSettings
        ? cloneMaterialSettings(existingSettings)
        : createDefaultMaterialSettings(getFirstMaterialFromObject(object));

    for (const [textureKey, value] of overrideEntries) {
        nextSettings.textures[textureKey as keyof IMaterialSettingsTextures] = value;
    }

    object.userData.materialSettings = nextSettings;
    applyMaterialSettingsToObject(object, nextSettings, context);
    return nextSettings;
};

export const applyMaterialValueOverridesToObject = (
    object: THREE.Object3D,
    overrides: {
        color?: string;
        opacity?: number;
        metalness?: number;
        roughness?: number;
        tileAmountX?: number;
        tileAmountY?: number;
        panningSpeedX?: number;
        panningSpeedY?: number;
    },
    context?: ReturnType<typeof useAssetResolutionContext>["context"] | null,
): IMaterialSettingsMap | IMaterialSettings | undefined => {
    const hasOverrides = Object.values(overrides).some(value => value !== undefined);
    if (!hasOverrides) {
        return object.userData.materialSettings as IMaterialSettingsMap | IMaterialSettings | undefined;
    }

    const applyOverrides = (settings: IMaterialSettings): IMaterialSettings => {
        const nextSettings = cloneMaterialSettings(settings);

        if (overrides.tileAmountX !== undefined) {
            nextSettings.tileAmountX = overrides.tileAmountX;
        }
        if (overrides.tileAmountY !== undefined) {
            nextSettings.tileAmountY = overrides.tileAmountY;
        }
        if (overrides.panningSpeedX !== undefined) {
            nextSettings.panningSpeedX = overrides.panningSpeedX;
        }
        if (overrides.panningSpeedY !== undefined) {
            nextSettings.panningSpeedY = overrides.panningSpeedY;
        }
        if (overrides.color !== undefined) {
            nextSettings.texturesSettings.color = overrides.color;
        }
        if (overrides.opacity !== undefined) {
            nextSettings.texturesSettings.opacity = overrides.opacity;
            nextSettings.texturesSettings.useBaseAlpha = overrides.opacity < 1;
        }
        if (overrides.metalness !== undefined) {
            nextSettings.texturesSettings.metallic = overrides.metalness;
        }
        if (overrides.roughness !== undefined) {
            nextSettings.texturesSettings.roughness = overrides.roughness;
        }

        return nextSettings;
    };

    const existingSettings = object.userData.materialSettings as IMaterialSettingsMap | IMaterialSettings | undefined;

    if (isMaterialSettingsMap(existingSettings)) {
        const updatedMap = Object.fromEntries(
            Object.entries(existingSettings).map(([pathKey, settings]) => [pathKey, applyOverrides(settings)]),
        );

        object.userData.materialSettings = updatedMap;
        applyMaterialSettingsToObject(object, updatedMap, context);
        return updatedMap;
    }

    const nextSettings = applyOverrides(
        existingSettings && "textures" in existingSettings
            ? existingSettings
            : createDefaultMaterialSettings(getFirstMaterialFromObject(object)),
    );

    object.userData.materialSettings = nextSettings;
    applyMaterialSettingsToObject(object, nextSettings, context);
    return nextSettings;
};

/**
 * Replace all references to `oldMat` with `newMat` across every mesh under `root`.
 * When the material was modified in-place (oldMat === newMat), falls back to
 * updating only the specific mesh/index slot.
 * @param root
 * @param oldMat
 * @param newMat
 * @param fallbackMesh
 * @param fallbackIndex
 */
const replaceMaterialInObject = (
    root: THREE.Object3D,
    oldMat: THREE.Material,
    newMat: THREE.Material,
    fallbackMesh: THREE.Mesh | THREE.SkinnedMesh,
    fallbackIndex: number,
) => {
    if (newMat !== oldMat) {
        root.traverse(child => {
            if (!(child instanceof THREE.Mesh || child instanceof THREE.SkinnedMesh)) return;
            if (Array.isArray(child.material)) {
                const materials = child.material;
                let replaced = false;
                let newMaterials: THREE.Material[] | undefined;

                for (let i = 0; i < materials.length; i++) {
                    if (materials[i] === oldMat) {
                        if (!newMaterials) {
                            newMaterials = materials.slice();
                        }
                        newMaterials[i] = newMat;
                        replaced = true;
                    }
                }

                if (replaced && newMaterials) {
                    child.material = newMaterials;
                }
            } else if (child.material === oldMat) {
                child.material = newMat;
            }
        });
    } else {
        if (Array.isArray(fallbackMesh.material)) {
            const materials = fallbackMesh.material.slice();
            materials[fallbackIndex] = newMat;
            fallbackMesh.material = materials;
        } else {
            fallbackMesh.material = newMat;
        }
    }
};

/**
 * Apply material settings to a single material
 * @param mat - The material to modify
 * @param settings - The settings to apply
 * @returns The modified or replaced material
 */
const applySettingsToMaterial = (mat: THREE.Material, settings: IMaterialSettings): THREE.Material => {
    const {textures, texturesSettings, isDoubleSided, materialType} = settings;

    // Store original textures before any modifications
    const originalTextures: Record<string, THREE.Texture | null> = {};
    const matWithMaps = mat as MaterialWithMaps;
    originalTextures.map = matWithMaps.map ?? null;
    originalTextures.aoMap = matWithMaps.aoMap ?? null;
    originalTextures.roughnessMap = matWithMaps.roughnessMap ?? null;
    originalTextures.metalnessMap = matWithMaps.metalnessMap ?? null;
    originalTextures.normalMap = matWithMaps.normalMap ?? null;
    originalTextures.emissiveMap = matWithMaps.emissiveMap ?? null;
    originalTextures.specularMap = matWithMaps.specularMap ?? null;

    let newMat = mat;
    const needsSpecular = materialType === MATERIAL_TYPES.SPECULAR;
    const needsMetallic = materialType === MATERIAL_TYPES.METALLIC;
    const needsPbr = materialType === MATERIAL_TYPES.PBR;
    const isSpecular = mat instanceof THREE.MeshPhongMaterial;
    const isMetallic = mat instanceof THREE.MeshStandardMaterial;
    const isPbr = mat instanceof THREE.MeshPhysicalMaterial;

    if (needsSpecular && !isSpecular || needsMetallic && !isMetallic || needsPbr && !isPbr) {
        newMat = createMaterialForType(materialType);
        // copy common props
        newMat.name = mat.name;
        newMat.opacity = mat.opacity;
        newMat.transparent = mat.transparent;
        newMat.blending = mat.blending;
        newMat.depthTest = mat.depthTest;
        newMat.depthWrite = mat.depthWrite;
        // color and other params are set below from settings
        const matWithAlphaTest = mat as {alphaTest?: number};
        if (typeof matWithAlphaTest.alphaTest === "number") {
            (newMat as {alphaTest?: number}).alphaTest = matWithAlphaTest.alphaTest;
        }
        newMat.userData = {...mat.userData};
        mat.dispose?.();
    }

    newMat.side = isDoubleSided ? THREE.DoubleSide : THREE.FrontSide;

    if (newMat instanceof THREE.MeshStandardMaterial || newMat instanceof THREE.MeshPhysicalMaterial) {
        (
            [
                ["base", "map"],
                ["ambient", "aoMap"],
                ["roughness", "roughnessMap"],
                ["metallic", "metalnessMap"],
                ["normal", "normalMap"],
                ["emissive", "emissiveMap"],
            ] as Array<[keyof IMaterialSettingsTextures, TextureTargetKey]>
        ).forEach(([mapKey, targetKey]) =>
            applyOrClearMap({
                material: newMat,
                mapKey,
                targetKey,
                textures,
                settings,
                originalTexture: originalTextures[targetKey],
            }),
        );
        newMat.opacity = texturesSettings.opacity;
        newMat.transparent = texturesSettings.useBaseAlpha;
        newMat.depthWrite = !newMat.transparent;
        (newMat as MaterialWithMaps).color?.set(texturesSettings.color);
        (newMat as MaterialWithMaps).metalness = texturesSettings.metallic;
        (newMat as MaterialWithMaps).roughness = texturesSettings.roughness;
        (newMat as MaterialWithMaps).aoMapIntensity = texturesSettings.ao;
        (newMat as MaterialWithMaps).normalScale?.setScalar(texturesSettings.normalScale ?? texturesSettings.strength);
        (newMat as MaterialWithMaps).emissiveIntensity =
            texturesSettings.emissiveIntensity ?? texturesSettings.strength;
        if (texturesSettings.emissiveColor) {
            (newMat as MaterialWithMaps).emissive?.set(texturesSettings.emissiveColor);
        }
        if (newMat instanceof THREE.MeshPhysicalMaterial) {
            newMat.specularIntensity = texturesSettings.specularIntensity ?? texturesSettings.strength;
            if (texturesSettings.specularColor) {
                newMat.specularColor.set(texturesSettings.specularColor);
            }
        }
    } else if (newMat instanceof THREE.MeshPhongMaterial) {
        (
            [
                ["base", "map"],
                ["specular", "specularMap"],
                ["normal", "normalMap"],
            ] as Array<[keyof IMaterialSettingsTextures, TextureTargetKey]>
        ).forEach(([mapKey, targetKey]) =>
            applyOrClearMap({
                material: newMat,
                mapKey,
                targetKey,
                textures,
                settings,
                originalTexture: originalTextures[targetKey],
            }),
        );
        newMat.opacity = texturesSettings.opacity;
        newMat.transparent = texturesSettings.useBaseAlpha;
        newMat.depthWrite = !newMat.transparent;
        (newMat as MaterialWithMaps).color?.set(texturesSettings.color);
        (newMat as MaterialWithMaps).specular?.set(texturesSettings.specularColor ?? texturesSettings.color);
        if (texturesSettings.specularIntensity !== undefined) {
            newMat.shininess = texturesSettings.specularIntensity * 30;
        }
    } else if (newMat instanceof THREE.MeshBasicMaterial) {
        applyOrClearMap({
            material: newMat,
            mapKey: "base",
            targetKey: "map",
            textures,
            settings,
            originalTexture: originalTextures.map,
        });
        newMat.opacity = texturesSettings.opacity;
        newMat.transparent = texturesSettings.useBaseAlpha;
        newMat.depthWrite = !newMat.transparent;
        (newMat as MaterialWithMaps).color?.set(texturesSettings.color);
    }

    newMat.needsUpdate = true;
    return newMat;
};

export const applyMaterialSettingsToSpecificMaterial = (
    object: THREE.Object3D,
    settings: IMaterialSettings | IMaterialSettingsMap | undefined,
    pathKey: string,
    context?: ReturnType<typeof useAssetResolutionContext>["context"] | null,
) => {
    if (!settings) return;

    // Handle both legacy format and new map format
    let targetSettings: IMaterialSettings | undefined;

    // Check if it's a map format (has string keys that look like paths)
    const settingsKeys = Object.keys(settings);
    const isMapFormat = settingsKeys.some(key => key.includes("::"));

    if (isMapFormat) {
        const settingsMap = settings as IMaterialSettingsMap;
        targetSettings = settingsMap[pathKey];
        if (!targetSettings) {
            console.warn(
                `Could not find settings for pathKey ${pathKey} in map. Available keys:`,
                Object.keys(settingsMap),
            );
            return;
        }
    } else {
        // Legacy format - use directly
        targetSettings = settings as IMaterialSettings;
    }

    const found = findMaterialByPathKey(object, pathKey);
    if (!found) {
        console.warn(`Could not find material for pathKey ${pathKey} in object:`, object.name || object.uuid);
        return;
    }
    const {material, mesh, index} = found;

    const newMaterial = applySettingsToMaterial(material, targetSettings);
    replaceMaterialInObject(object, material, newMaterial, mesh, index);
    newMaterial.needsUpdate = true;
    newMaterial.userData = {
        ...newMaterial.userData,
        materialSettings: object.userData.materialSettings as IMaterialSettingsMap | IMaterialSettings | undefined,
    };

    void updateDynamicTexturesForMaterial(newMaterial, targetSettings, context);
};
