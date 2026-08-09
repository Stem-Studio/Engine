
import {Mesh, MeshBasicMaterial, MeshStandardMaterial, Group, TextureLoader} from "three";
import {PLYLoader as PLYLoaderImpl} from "three/addons/loaders/PLYLoader.js";

import BaseLoader from "./BaseLoader";
import {remapGeometryUVs, findRegionByName} from "../../../atlas/UVRemapper";
import {findTexture, getBaseName} from "../../../texture/TextureMapping";

/**
 * PLYLoader wrapper with texture support
 */
class PLYLoader extends BaseLoader {
    constructor() {
        super();
    }

    load(url, options) {
        // For blob URLs or absolute URLs, use them directly
        // For relative URLs, prepend server if available
        const path =
            url.startsWith("blob:") || url.startsWith("http") || url.startsWith("https")
                ? url
                : (this.server || "") + url;

        // Extract fileBlobMap, rootPath, atlasData, and textureOverrides from options
        const fileBlobMap = options?.fileBlobMap;
        const rootPath = options?.rootPath || "";
        const atlasData = options?.atlasData;
        const textureOverrides = options?.textureOverrides;

        return new Promise((resolve, reject) => {
            const loader = new PLYLoaderImpl();
            loader.load(
                path,
                geometry => {
                    // Check if geometry has texture coordinates
                    const hasUVs = geometry.hasAttribute("uv");
                    const hasColors = geometry.hasAttribute("color");

                    // Priority: Atlas > TextureOverrides > Name-based search > Vertex colors

                    // 1. Try atlas texture first if available
                    if (hasUVs && atlasData) {
                        this.loadAtlasTexture(url, geometry, atlasData)
                            .then(texture => {
                                const material = texture
                                    ? new MeshStandardMaterial({map: texture})
                                    : new MeshBasicMaterial({vertexColors: hasColors});

                                const mesh = new Mesh(geometry, material);
                                const group = new Group();
                                group.add(mesh);

                                group.userData.type = "PLY";
                                group.userData.url = url;
                                group.userData.options = options;
                                group.userData.atlasData = atlasData;

                                resolve(group);
                            })
                            .catch(error => {
                                console.warn(`PLYLoader: Failed to load atlas texture for ${url}, trying fallback.`, error);
                                this.loadWithTextureOverridesOrSearch(url, geometry, fileBlobMap, rootPath, hasColors, hasUVs, textureOverrides, options, resolve);
                            });
                    }
                    // 2. Try texture overrides or name-based search
                    else if (hasUVs && (textureOverrides || fileBlobMap)) {
                        this.loadWithTextureOverridesOrSearch(url, geometry, fileBlobMap, rootPath, hasColors, hasUVs, textureOverrides, options, resolve);
                    } else {
                        // No UVs or no textures available - use vertex colors or plain material
                        const material = new MeshBasicMaterial({vertexColors: hasColors});
                        const mesh = new Mesh(geometry, material);
                        const group = new Group();
                        group.add(mesh);

                        group.userData.type = "PLY";
                        group.userData.url = url;
                        group.userData.options = options;

                        resolve(group);
                    }
                },
                undefined,
                error => {
                    console.warn(`PLYLoader: ${url} loading failed.`, error);
                    reject(error);
                },
            );
        });
    }

    /**
     * Load with texture overrides or fall back to name-based search
     * @param url
     * @param geometry
     * @param fileBlobMap
     * @param rootPath
     * @param hasColors
     * @param hasUVs
     * @param textureOverrides
     * @param options
     * @param resolve
     */
    loadWithTextureOverridesOrSearch(url, geometry, fileBlobMap, rootPath, hasColors, hasUVs, textureOverrides, options, resolve) {
        // If we have texture overrides with a map, use it
        if (textureOverrides?.map) {
            this.loadTextureFromBlob(textureOverrides.map.blob, textureOverrides.map.path)
                .then(texture => {
                    const material = this.createMaterialWithTextures(texture, textureOverrides, hasColors);
                    const mesh = new Mesh(geometry, material);
                    const group = new Group();
                    group.add(mesh);

                    group.userData.type = "PLY";
                    group.userData.url = url;
                    group.userData.options = options;
                    group.userData.textureOverrides = textureOverrides;

                    console.log(`PLYLoader: Applied texture override for ${url}`);
                    resolve(group);
                })
                .catch(error => {
                    console.warn(`PLYLoader: Failed to load texture override, trying search.`, error);
                    this.loadTextureAndCreateMesh(url, geometry, fileBlobMap, rootPath, hasColors, options, resolve);
                });
        }
        // Otherwise fall back to name-based search
        else if (fileBlobMap) {
            this.loadTextureAndCreateMesh(url, geometry, fileBlobMap, rootPath, hasColors, options, resolve);
        } else {
            // No textures available
            const material = new MeshBasicMaterial({vertexColors: hasColors});
            const mesh = new Mesh(geometry, material);
            const group = new Group();
            group.add(mesh);

            group.userData.type = "PLY";
            group.userData.url = url;
            group.userData.options = options;

            resolve(group);
        }
    }

    /**
     * Load texture from a blob
     * @param blob
     * @param path
     */
    loadTextureFromBlob(blob, path) {
        return new Promise((resolve, reject) => {
            const blobUrl = URL.createObjectURL(blob);
            const textureLoader = new TextureLoader();

            textureLoader.load(
                blobUrl,
                texture => {
                    URL.revokeObjectURL(blobUrl);
                    console.log(`PLYLoader: Loaded texture from blob: ${path}`);
                    resolve(texture);
                },
                undefined,
                error => {
                    URL.revokeObjectURL(blobUrl);
                    reject(error);
                },
            );
        });
    }

    /**
     * Create MeshStandardMaterial with texture overrides (supports PBR maps)
     * @param diffuseTexture
     * @param textureOverrides
     * @param hasColors
     */
    createMaterialWithTextures(diffuseTexture, textureOverrides, hasColors) {
        const material = new MeshStandardMaterial({
            map: diffuseTexture,
            vertexColors: hasColors && !diffuseTexture,
        });

        // Note: For PLY files, we typically only use the diffuse map
        // but the infrastructure supports PBR if needed in the future

        return material;
    }

    /**
     * Try to find and load a texture file from the fileBlobMap
     * Uses the centralized findTexture function with multiple fallback strategies
     * @param plyUrl
     * @param fileBlobMap
     * @param rootPath
     */
    loadTexture(plyUrl, fileBlobMap, rootPath) {
        return new Promise((resolve, reject) => {
            // Extract the base filename without extension
            const fileName = plyUrl.split("/").pop() || "";
            const baseName = getBaseName(fileName);

            // Use the centralized findTexture function with fallback strategies
            const found = findTexture(baseName, fileBlobMap, rootPath, baseName);

            if (!found) {
                // No texture found - resolve with null
                resolve(null);
                return;
            }

            // Load the texture from blob
            const blobUrl = URL.createObjectURL(found.blob);
            const textureLoader = new TextureLoader();

            textureLoader.load(
                blobUrl,
                texture => {
                    URL.revokeObjectURL(blobUrl);
                    console.log(`PLYLoader: Loaded texture from ${found.path}`);
                    resolve(texture);
                },
                undefined,
                error => {
                    URL.revokeObjectURL(blobUrl);
                    console.warn(`PLYLoader: Failed to load texture from ${found.path}`, error);
                    reject(error);
                },
            );
        });
    }

    /**
     * Load atlas texture and remap UVs for the geometry
     * @param plyUrl
     * @param geometry
     * @param atlasData
     */
    loadAtlasTexture(plyUrl, geometry, atlasData) {
        return new Promise((resolve, reject) => {
            const { config, textureBlob } = atlasData;

            // Find region by PLY filename
            const fileName = plyUrl.split("/").pop() || "";
            const baseName = fileName.replace(/\.[^/.]+$/, "");
            const region = findRegionByName(baseName, config.regions);

            if (region) {
                // Remap UVs to atlas region
                remapGeometryUVs(geometry, region, config.width, config.height);
                console.log(`PLYLoader: Remapped UVs for region "${region.name}"`);
            }

            // Load atlas texture from blob
            const blobUrl = URL.createObjectURL(textureBlob);
            const textureLoader = new TextureLoader();

            textureLoader.load(
                blobUrl,
                texture => {
                    URL.revokeObjectURL(blobUrl);
                    console.log(`PLYLoader: Loaded atlas texture`);
                    resolve(texture);
                },
                undefined,
                error => {
                    URL.revokeObjectURL(blobUrl);
                    reject(error);
                },
            );
        });
    }

    /**
     * Helper to load texture and create mesh (extracted to reduce duplication)
     * @param url
     * @param geometry
     * @param fileBlobMap
     * @param rootPath
     * @param hasColors
     * @param options
     * @param resolve
     */
    loadTextureAndCreateMesh(url, geometry, fileBlobMap, rootPath, hasColors, options, resolve) {
        this.loadTexture(url, fileBlobMap, rootPath)
            .then(texture => {
                const material = texture
                    ? new MeshStandardMaterial({map: texture})
                    : new MeshBasicMaterial({vertexColors: hasColors});

                const mesh = new Mesh(geometry, material);
                const group = new Group();
                group.add(mesh);

                group.userData.type = "PLY";
                group.userData.url = url;
                group.userData.options = options;

                resolve(group);
            })
            .catch(error => {
                console.warn(`PLYLoader: Failed to load texture for ${url}, using fallback material.`, error);

                // Fallback to vertex colors or plain material
                const material = new MeshBasicMaterial({vertexColors: hasColors});
                const mesh = new Mesh(geometry, material);
                const group = new Group();
                group.add(mesh);

                group.userData.type = "PLY";
                group.userData.url = url;
                group.userData.options = options;

                resolve(group);
            });
    }
}

export default PLYLoader;
