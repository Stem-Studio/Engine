import {MeshoptDecoder} from "meshoptimizer";
import {Group, LoaderUtils, LoadingManager, Material, Mesh, MeshStandardMaterial, Texture, TextureLoader} from "three";
import {DRACOLoader} from "three/addons/loaders/DRACOLoader.js";
import {GLTFLoader, GLTFParser} from "three/addons/loaders/GLTFLoader.js";
import {KTX2Loader} from "three/addons/loaders/KTX2Loader.js";

import {EARTHAnimationGraphLoaderPlugin} from "../../../animation/extensions/EARTHAnimationGraphLoaderPlugin";
import {LoadedAtlas} from "../../../atlas/types";
import {applyAtlasToObject} from "../../../atlas/UVRemapper";
import global from "../../../global";
import {TextureOverrides, TextureRef, findTexture, getBaseName, isTextureFile} from "../../../texture/TextureMapping";
import {traverseObjectDepthFirst} from "../../../utils/SceneTraverser";
import {setTextureResolutionContext} from "../../../utils/TextureUtils";

/**
 * GLTFLoader
 *
 */
class GLTFLoaderExtended {
    private loadingManager = new LoadingManager();

    private createLoader() {
        const dracoLoader = new DRACOLoader(this.loadingManager)
            .setDecoderPath(`/assets/js/draco/gltf/`);

        const ktxLoader = new KTX2Loader(this.loadingManager)
            .setTranscoderPath(`/assets/js/basis/`);

        const renderer = global.app?.renderer;
        if (renderer) {
            try {
                ktxLoader.detectSupport(renderer);
            } catch {
                // Renderer backend not initialized — skip KTX2 compression detection
            }
        }
        
        const loader = new GLTFLoader(this.loadingManager)
            .setCrossOrigin("anonymous")
            .setDRACOLoader(dracoLoader)
            .setKTX2Loader(ktxLoader)
            .setMeshoptDecoder(MeshoptDecoder);

        loader.register((parser: GLTFParser) => new EARTHAnimationGraphLoaderPlugin(parser));
        
        return { loader, dispose: () => {
            loader.setKTX2Loader(null);
            dracoLoader.dispose();
            ktxLoader.dispose();
        }};
    }

    parseGlb(data: ArrayBuffer) {
        const { loader, dispose } = this.createLoader();

        return new Promise<Group>((resolve, reject) => {
            loader.parse(
                data,
                "",
                result => {
                    const obj3d = result.scene;

                    (obj3d as Group & {_obj?: typeof result; _root?: Group})._obj = result;
                    (obj3d as Group & {_obj?: typeof result; _root?: Group})._root = result.scene;

                    traverseObjectDepthFirst(obj3d, child => {
                        if (child instanceof Mesh && child.geometry) {
                            child.geometry.computeBoundingBox();
                        }
                    });

                    setTextureResolutionContext(null);
                    resolve(obj3d);
                    dispose();
                },
                (error: unknown) => {
                    setTextureResolutionContext(null);
                    const message = error instanceof Error ? error.message
                        : typeof error === 'string' ? error
                        : 'Unknown error';
                    reject(new Error(`Failed to parse GLB: ${message}`));
                    dispose();
                },
            );
        });
    }

    load(
        url: string,
        rootPath: string,
        assetMap: Map<string, Blob>,
        atlasData?: LoadedAtlas,
        textureOverrides?: TextureOverrides,
    ) {
        const baseURL = LoaderUtils.extractUrlBase(url);
        const blobURLs: string[] = [];
        const modelBaseName = getBaseName(url);
        const hasTextureCandidates = Array.from(assetMap.keys()).some(path => isTextureFile(path));

        // CRITICAL: Set global texture resolution context for TextureUtils
        // This allows the patched ImageBitmapLoader to resolve textures from our fileBlobMap
        if (assetMap.size > 0) {
            setTextureResolutionContext({
                fileBlobMap: assetMap,
                rootPath: rootPath,
                modelBaseName: modelBaseName,
            });
        }

        this.loadingManager.setURLModifier((requestedUrl) => {
            // Don't intercept the main model URL — only redirect sub-resource requests
            // (textures, .bin buffers). The main URL is already a valid blob URL.
            if (requestedUrl === url) {
                return requestedUrl;
            }

            // Convert data: URIs (embedded buffers/textures in JSON .gltf files) to blob
            // URLs. fetch() can fail on large data: URIs in some environments.
            if (requestedUrl.startsWith('data:')) {
                try {
                    const commaIndex = requestedUrl.indexOf(',');
                    const header = requestedUrl.slice(0, commaIndex);
                    const base64Data = requestedUrl.slice(commaIndex + 1);
                    const mimeMatch = header.match(/^data:([^;]+)/);
                    const mimeType = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
                    const binary = atob(base64Data);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) {
                        bytes[i] = binary.charCodeAt(i);
                    }
                    const blob = new Blob([bytes], { type: mimeType });
                    const blobURL = URL.createObjectURL(blob);
                    blobURLs.push(blobURL);
                    return blobURL;
                } catch {
                    // Fall through to normal resolution if data: URI conversion fails
                }
            }

            // Construct the normalized URL by joining rootPath with the relative texture path
            // rootPath might be empty (root level) or a directory like "myFolder" (no trailing slash)
            const relativePath = decodeURI(requestedUrl)
                .replace(baseURL, "")
                .replace(/^(\.?\/)/, "");

            // Join paths properly: if rootPath exists, add "/" separator
            const normalizedURL = rootPath
                ? `${rootPath}/${relativePath}`
                : relativePath;

            // First try direct lookup
            const blob = assetMap.get(normalizedURL);
            if (blob) {
                const blobURL = URL.createObjectURL(blob);
                blobURLs.push(blobURL);
                return blobURL;
            }

            // Use fallback texture matching only when loose texture files are
            // actually present. Raw self-contained GLBs can request embedded
            // texture identifiers; running the fallback search for those emits
            // noisy miss logs and burns time without any possible match.
            if (hasTextureCandidates) {
                const found = findTexture(normalizedURL, assetMap, rootPath, modelBaseName);
                if (found) {
                    const blobURL = URL.createObjectURL(found.blob);
                    blobURLs.push(blobURL);
                    return blobURL;
                }
            }

            return requestedUrl;
        });

        const { loader, dispose } = this.createLoader();

        return new Promise<Group>((resolve, reject) => {
            loader.load(
                url,
                result => {
                    const obj3d = result.scene;

                    (obj3d as Group & {_obj?: typeof result; _root?: Group})._obj = result;
                    (obj3d as Group & {_obj?: typeof result; _root?: Group})._root = result.scene;

                    // Compute bounding boxes for all geometries
                    traverseObjectDepthFirst(obj3d, child => {
                        if (child instanceof Mesh && child.geometry) {
                            child.geometry.computeBoundingBox();
                        }
                    });

                    // Clear texture resolution context now that model is loaded
                    setTextureResolutionContext(null);

                    // Priority: Atlas > TextureOverrides > Embedded
                    if (atlasData) {
                        // Apply atlas (replaces all textures with atlas)
                        this.applyAtlas(obj3d, atlasData).then(() => {
                            this.cleanupBlobUrls(blobURLs);
                            resolve(obj3d);
                            dispose();
                        });
                    } else if (textureOverrides && Object.keys(textureOverrides).length > 0) {
                        // Apply texture overrides (replaces specific texture slots)
                        this.applyTextureOverrides(obj3d, textureOverrides).then(() => {
                            this.cleanupBlobUrls(blobURLs);
                            resolve(obj3d);
                            dispose();
                        });
                    } else {
                        this.cleanupBlobUrls(blobURLs);
                        resolve(obj3d);
                        dispose();
                    }
                },
                undefined,
                (error: unknown) => {
                    // Clear texture resolution context on error
                    setTextureResolutionContext(null);
                    this.cleanupBlobUrls(blobURLs);
                    const message = error instanceof Error ? error.message
                        : typeof error === 'string' ? error
                        : 'Unknown error';
                    console.error("[GLTFLoaderExtended] GLTF load error:", error);
                    reject(new Error(`Failed to load GLTF: ${message}`));
                    dispose();
                },
            );
        });
    }

    /**
     * Clean up blob URLs to prevent memory leaks
     * @param blobURLs
     */
    private cleanupBlobUrls(blobURLs: string[]): void {
        for (const blobURL of blobURLs) {
            URL.revokeObjectURL(blobURL);
        }
    }

    /**
     * Apply atlas texture and UV remapping to loaded model
     * @param object
     * @param atlasData
     */
    private async applyAtlas(object: Group, atlasData: LoadedAtlas): Promise<void> {
        const { config, textureBlob } = atlasData;

        // Load atlas texture
        const blobUrl = URL.createObjectURL(textureBlob);
        const textureLoader = new TextureLoader();

        return new Promise((resolve) => {
            textureLoader.load(
                blobUrl,
                (atlasTexture) => {
                    URL.revokeObjectURL(blobUrl);

                    // Apply UV remapping based on mesh/material names matching atlas regions
                    applyAtlasToObject(object, config);

                    // Apply atlas texture to all meshes with UVs
                    traverseObjectDepthFirst(object, child => {
                        if (!(child instanceof Mesh)) return;

                        const mesh = child as Mesh;
                        const hasUVs = mesh.geometry?.hasAttribute('uv');
                        if (!hasUVs) return;

                        const materials = Array.isArray(mesh.material)
                            ? mesh.material
                            : [mesh.material];

                        for (let i = 0; i < materials.length; i++) {
                            const material = materials[i];

                            if (material instanceof MeshStandardMaterial) {
                                // Apply atlas texture (replaces existing or adds new)
                                material.map = atlasTexture;
                                material.needsUpdate = true;
                            } else if (material && 'map' in material) {
                                // Handle other material types that support map
                                (material as Material & {map: Texture | null}).map = atlasTexture;
                                material.needsUpdate = true;
                            }
                        }
                    });

                    // Store atlas data in userData for later reference
                    object.userData.atlasData = atlasData;
                    resolve();
                },
                undefined,
                () => {
                    URL.revokeObjectURL(blobUrl);
                    console.warn("GLTFLoaderExtended: Failed to load atlas texture");
                    resolve();
                },
            );
        });
    }

    /**
     * Apply texture overrides to loaded model (PBR maps)
     * This replaces specific texture slots on ALL materials (not just MeshStandardMaterial)
     * Works with embedded GLB textures by replacing them after load
     * @param object
     * @param overrides
     */
    private async applyTextureOverrides(object: Group, overrides: TextureOverrides): Promise<void> {
        const textureLoader = new TextureLoader();
        const loadedTextures: Map<string, Texture> = new Map();
        const pendingTextures: Map<string, Promise<Texture>> = new Map();
        const blobUrls: string[] = [];

        // Helper to load a texture from a TextureRef
        const loadTextureFromRef = async (ref: TextureRef): Promise<Texture> => {
            // Check if already loaded
            if (loadedTextures.has(ref.path)) {
                return loadedTextures.get(ref.path)!;
            }

            const pendingTexture = pendingTextures.get(ref.path);
            if (pendingTexture) {
                return pendingTexture;
            }

            const blobUrl = URL.createObjectURL(ref.blob);
            blobUrls.push(blobUrl);

            const texturePromise = new Promise<Texture>((resolve, reject) => {
                textureLoader.load(
                    blobUrl,
                    (texture) => {
                        loadedTextures.set(ref.path, texture);
                        resolve(texture);
                    },
                    undefined,
                    (error) => {
                        console.warn(`GLTFLoaderExtended: Failed to load texture ${ref.path}:`, error);
                        reject(error);
                    },
                );
            }).finally(() => {
                pendingTextures.delete(ref.path);
            });

            pendingTextures.set(ref.path, texturePromise);
            return texturePromise;
        };

        try {
            // Pre-load all textures in parallel
            const texturePromises: Promise<void>[] = [];
            const textureMap: Map<keyof TextureOverrides, Texture> = new Map();

            for (const [key, ref] of Object.entries(overrides) as [keyof TextureOverrides, TextureRef | undefined][]) {
                if (ref) {
                    texturePromises.push(
                        loadTextureFromRef(ref).then(texture => {
                            textureMap.set(key, texture);
                        }),
                    );
                }
            }

            await Promise.all(texturePromises);

            if (textureMap.size === 0) {
                console.warn("GLTFLoaderExtended: No textures were loaded for override");
                return;
            }

            // Track processed materials to avoid double-dispose when meshes share materials.
            // Without this, the second mesh iteration disposes the NEW texture we just assigned.
            const processedMaterials = new Set<Material>();

            // Apply textures to all meshes - handle ANY material type with a 'map' property
            traverseObjectDepthFirst(object, child => {
                if (!(child instanceof Mesh)) return;

                const mesh = child as Mesh;
                const materials = Array.isArray(mesh.material)
                    ? mesh.material
                    : [mesh.material];

                for (const material of materials) {
                    if (!material) continue;
                    if (processedMaterials.has(material)) continue;
                    processedMaterials.add(material);

                    // Handle MeshStandardMaterial with full PBR support
                    if (material instanceof MeshStandardMaterial) {
                        if (textureMap.has('map')) {
                            const newTex = textureMap.get('map')!;
                            if (material.map) {
                                newTex.flipY = material.map.flipY;
                                newTex.colorSpace = material.map.colorSpace;
                            }
                            material.map?.dispose();
                            material.map = newTex;
                        }
                        if (textureMap.has('normalMap')) {
                            const newTex = textureMap.get('normalMap')!;
                            if (material.normalMap) {
                                newTex.flipY = material.normalMap.flipY;
                                newTex.colorSpace = material.normalMap.colorSpace;
                            }
                            material.normalMap?.dispose();
                            material.normalMap = newTex;
                        }
                        if (textureMap.has('roughnessMap')) {
                            const newTex = textureMap.get('roughnessMap')!;
                            if (material.roughnessMap) {
                                newTex.flipY = material.roughnessMap.flipY;
                                newTex.colorSpace = material.roughnessMap.colorSpace;
                            }
                            material.roughnessMap?.dispose();
                            material.roughnessMap = newTex;
                        }
                        if (textureMap.has('metalnessMap')) {
                            const newTex = textureMap.get('metalnessMap')!;
                            if (material.metalnessMap) {
                                newTex.flipY = material.metalnessMap.flipY;
                                newTex.colorSpace = material.metalnessMap.colorSpace;
                            }
                            material.metalnessMap?.dispose();
                            material.metalnessMap = newTex;
                        }
                        if (textureMap.has('aoMap')) {
                            const newTex = textureMap.get('aoMap')!;
                            if (material.aoMap) {
                                newTex.flipY = material.aoMap.flipY;
                                newTex.colorSpace = material.aoMap.colorSpace;
                            }
                            material.aoMap?.dispose();
                            material.aoMap = newTex;
                        }
                        if (textureMap.has('emissiveMap')) {
                            const newTex = textureMap.get('emissiveMap')!;
                            if (material.emissiveMap) {
                                newTex.flipY = material.emissiveMap.flipY;
                                newTex.colorSpace = material.emissiveMap.colorSpace;
                            }
                            material.emissiveMap?.dispose();
                            material.emissiveMap = newTex;
                        }
                        if (textureMap.has('displacementMap')) {
                            const newTex = textureMap.get('displacementMap')!;
                            if (material.displacementMap) {
                                newTex.flipY = material.displacementMap.flipY;
                                newTex.colorSpace = material.displacementMap.colorSpace;
                            }
                            material.displacementMap?.dispose();
                            material.displacementMap = newTex;
                        }
                        if (textureMap.has('alphaMap')) {
                            const newTex = textureMap.get('alphaMap')!;
                            if (material.alphaMap) {
                                newTex.flipY = material.alphaMap.flipY;
                                newTex.colorSpace = material.alphaMap.colorSpace;
                            }
                            material.alphaMap?.dispose();
                            material.alphaMap = newTex;
                            material.transparent = true;
                        }
                        material.needsUpdate = true;
                    }
                    // Handle any other material type that has a 'map' property (MeshBasicMaterial, MeshPhongMaterial, etc.)
                    else if ('map' in material && textureMap.has('map')) {
                        const mat = material as Material & {map: (Texture & {dispose?: () => void}) | null};
                        const newTex = textureMap.get('map')!;
                        if (mat.map) {
                            newTex.flipY = mat.map.flipY;
                            newTex.colorSpace = mat.map.colorSpace;
                        }
                        mat.map?.dispose?.();
                        mat.map = newTex;
                        mat.needsUpdate = true;
                    }
                }
            });

            // Store overrides info in userData
            object.userData.textureOverrides = Object.fromEntries(
                Array.from(textureMap.entries()).map(([key]) => [key, true]),
            );
        } catch (error) {
            console.warn("GLTFLoaderExtended: Error applying texture overrides:", error);
        } finally {
            // Clean up blob URLs
            for (const url of blobUrls) {
                URL.revokeObjectURL(url);
            }
        }
    }
}

export default GLTFLoaderExtended;
