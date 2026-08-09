import {
    ImageBitmapLoader,
    Texture,
} from "three";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import {texture as textureNode} from "three/tsl";

import { resolveAssetUrl } from "./AssetDownloadUtils";

/**
 * Global texture resolution context for handling uploaded textures.
 * GLTFLoaderExtended registers its fileBlobMap here before loading,
 * and getTextureBufferAndBlob uses it to resolve texture URLs.
 */
export interface TextureResolutionContext {
    fileBlobMap: Map<string, Blob>;
    rootPath: string;
    modelBaseName: string;
}

// Active texture resolution context (set by GLTFLoaderExtended during load)
let activeTextureContext: TextureResolutionContext | null = null;

/**
 * Set the active texture resolution context.
 * Call this before loading a model that has textures in a fileBlobMap.
 * @param context
 */
export function setTextureResolutionContext(context: TextureResolutionContext | null): void {
    activeTextureContext = context;
}

/**
 * Get the current texture resolution context.
 */
export function getTextureResolutionContext(): TextureResolutionContext | null {
    return activeTextureContext;
}

// Extend THREE.Texture to hold usage counts
declare module "three" {
    interface Texture {
        _usedTimes: number;
        _cacheKey?: string;
        _cacheMap?: Map<string, Promise<Texture>>;
    }
}

// HACK: monkey-patch TextureNode to allow setting null/undefined value after creation. It is not expected
// behavior, because node builder has to remove the node from the shader graph it there is no texture assigned.
// TODO: create a PR to three.js to support this use case natively and create a small test case
const activeTextureNodePrototype = Object.getPrototypeOf(textureNode(new Texture()));
const originalDescriptor = Object.getOwnPropertyDescriptor(activeTextureNodePrototype, "value");
Object.defineProperty(activeTextureNodePrototype, "value", {
    get: originalDescriptor!.get,
    set: function ( value ) {

        if ( !value ) return;

        if ( this.referenceNode ) {

            this.referenceNode.value = value;

        } else {

            this._value = value;

        }

    },

} );

/**
 * Patches Three.js texture loaders to deduplicate textures by content hash,
 * track shared usage counts, and ensure safe disposal of shared textures.
 * 
 * This function addresses the complexity of managing GPU resources efficiently
 * by implementing a caching mechanism based on SHA-256 hashing of texture data.
 * It overrides loader methods to prevent redundant texture loading and ensures
 * that textures are safely disposed of when no longer in use.
 * 
 * It's magic outside of Hogwarts. AI cannot do it for sure
 */
export function patchTextureLoaders(): void {

    // Compute SHA-256 hex digest of an ArrayBuffer
    /**
     *
     * @param buffer
     */
    async function hashBuffer(buffer: ArrayBuffer): Promise<string> {
        const digest = await crypto.subtle.digest("SHA-256", buffer);
        return Array.from(new Uint8Array(digest))
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");
    }

    // Capture original loader methods
    const originalKTX2LoaderLoad = KTX2Loader.prototype.load;
    const originalImageBitmapLoaderLoad = ImageBitmapLoader.prototype.load;

    // Wrap Texture.dispose to decrement usage and fire 'dispose' when count reaches zero, removing from cache
    Texture.prototype.dispose = function (): void {
        this._usedTimes = (this._usedTimes || 1) - 1;
        if (this._usedTimes <= 0) {
            // notify Three.js to release GPU resources
            this.dispatchEvent({ type: 'dispose' } as any);
            // remove from cache if present
            if (this._cacheKey && this._cacheMap) {
                this._cacheMap.delete(this._cacheKey);
            }
        }
    };

    // Generic cache override for any loader.prototype.load
    /**
     *
     * @param proto
     * @param originalLoadFn
     * @param getBufferAndBlob
     * @param getLoadUrl
     */
    function overrideLoaderCache(
        proto: any,
        originalLoadFn: any,
        getBufferAndBlob: (url: string) => Promise<{ buffer: ArrayBuffer; blob: Blob }>,
        getLoadUrl: (blob: Blob, url?: string) => string,
    ): void {
        const cacheMap = new Map<string, Promise<Texture>>();

        proto.load = function(url: string, onLoad?: any, onProgress?: any, onError?: any): any {
            // CRITICAL: Use LoadingManager's URL modifier if available
            // This allows GLTFLoaderExtended to intercept texture URLs and resolve them from fileBlobMap
            const resolvedUrl = this.manager?.resolveURL ? this.manager.resolveURL(url) : url;

            getBufferAndBlob(resolvedUrl)
                .then(({ buffer, blob }) => hashBuffer(buffer).then(key => ({ buffer, blob, key })))
                .then(({ blob, key }) => {
                    if (!cacheMap.has(key)) {
                        const loadUrl = getLoadUrl(blob, url);
                        let promise: Promise<Texture>;
                        if (proto === ImageBitmapLoader.prototype) {
                            promise = new Promise<Texture>((resolve, reject) => {
                                originalLoadFn.call(this, loadUrl,
                                    (bitmap: ImageBitmap) => {
                                        const tex = new Texture(bitmap);
                                        tex.needsUpdate = true;
                                        tex._usedTimes = 1;
                                        resolve(tex);
                                        URL.revokeObjectURL(loadUrl);
                                    },
                                    onProgress,
                                    reject,
                                );
                            });
                        } else {
                            promise = new Promise<Texture>((resolve, reject) => {
                                originalLoadFn.call(this, loadUrl,
                                    (tex: Texture) => {
                                        tex._usedTimes = 1;
                                        resolve(tex);
                                        URL.revokeObjectURL(loadUrl);
                                    },
                                    onProgress,
                                    reject,
                                );
                            });
                        }
                        // attach cache metadata
                        promise = promise.then((tex: Texture) => {
                            tex._cacheKey = key;
                            tex._cacheMap = cacheMap;
                            return tex;
                        });
                        cacheMap.set(key, promise);
                    }
                    const entry = cacheMap.get(key);
                    entry!.then((tex: Texture) => {
                        tex._usedTimes++;
                        if (onLoad) onLoad(tex);
                    }).catch((err: unknown) => onError && onError(err));
                })
                .catch((err: unknown) => onError && onError(err));
            return this;
        };
    }

    // Shared fetch helper for textures that resolves asset IDs to download URLs
    const getTextureBufferAndBlob = async (url: string) => {
        // Check if we have an active texture context with fileBlobMap
        const context = activeTextureContext;
        if (context && context.fileBlobMap.size > 0) {
            // Try to resolve from fileBlobMap using various strategies
            const blob = resolveTextureFromContext(url, context);
            if (blob) {
                const buffer = await blob.arrayBuffer();
                return { buffer, blob };
            }
        }

        // If URL is already a valid blob URL (proper format without path components),
        // fetch it directly without going through resolveAssetUrl which would mangle it
        if (url.startsWith('blob:') && !url.includes('/Textures/') && !url.includes('/textures/')) {
            // This is a proper blob URL like blob:http://localhost:5173/abc123-uuid
            return fetch(url)
                .then(res => res.blob())
                .then(blob => blob.arrayBuffer().then(buffer => ({ buffer, blob })));
        }

        // For malformed blob URLs with paths (like blob:http://localhost:5173/Textures/colormap.png),
        // we cannot fetch them. If we reach here without context resolution, it's an error.
        if (url.startsWith('blob:')) {
            console.warn(`[TextureUtils] Cannot resolve blob URL: ${url} — texture will be skipped`);
            throw new Error(`Texture unavailable: ${url}`);
        }

        const resolvedUrl = await resolveAssetUrl(url, 'image');
        return fetch(resolvedUrl)
            .then(res => res.blob())
            .then(blob => blob.arrayBuffer().then(buffer => ({ buffer, blob })));
    };

    /**
     * Try to resolve a texture URL from the active context's fileBlobMap
     * @param url
     * @param context
     */
    function resolveTextureFromContext(url: string, context: TextureResolutionContext): Blob | null {
        const { fileBlobMap, rootPath } = context;

        // Extract the relative path from the URL
        // URL might be: "blob:http://localhost:5173/Textures/colormap.png" or "Textures/colormap.png"
        let relativePath = url;

        // Strip blob URL prefix if present
        if (url.startsWith('blob:')) {
            // Extract path after the origin: blob:http://localhost:5173/Textures/colormap.png -> Textures/colormap.png
            const match = url.match(/^blob:[^/]+\/\/[^/]+\/(.+)$/);
            if (match) {
                relativePath = match[1]!;
            }
        }

        // Remove leading ./ or /
        relativePath = relativePath.replace(/^\.?\//, '');

        // Strategy 1: Direct lookup
        if (fileBlobMap.has(relativePath)) {
            return fileBlobMap.get(relativePath)!;
        }

        // Strategy 2: With rootPath prefix
        if (rootPath) {
            const withRoot = `${rootPath}/${relativePath}`;
            if (fileBlobMap.has(withRoot)) {
                return fileBlobMap.get(withRoot)!;
            }
        }

        // Strategy 3: Filename only (for flat file uploads)
        const fileName = relativePath.split('/').pop() || relativePath;
        if (fileBlobMap.has(fileName)) {
            return fileBlobMap.get(fileName)!;
        }

        // Strategy 4: Case-insensitive filename match
        const fileNameLower = fileName.toLowerCase();
        for (const [path, blob] of fileBlobMap.entries()) {
            const pathFileName = path.split('/').pop()?.toLowerCase() || '';
            if (pathFileName === fileNameLower) {
                return blob;
            }
        }

        // Strategy 5: Partial name match (texture filename contains or is contained by requested)
        const requestedBaseName = fileName.replace(/\.[^/.]+$/, '').toLowerCase();
        for (const [path, blob] of fileBlobMap.entries()) {
            const ext = path.split('.').pop()?.toLowerCase();
            if (!['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tga', 'gif'].includes(ext || '')) continue;

            const pathBaseName = path.split('/').pop()?.replace(/\.[^/.]+$/, '').toLowerCase() || '';
            if (pathBaseName.includes(requestedBaseName) || requestedBaseName.includes(pathBaseName)) {
                return blob;
            }
        }

        // Strategy 6: Any texture file if only one exists
        const textureFiles = Array.from(fileBlobMap.entries()).filter(([path]) => {
            const ext = path.split('.').pop()?.toLowerCase();
            return ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tga', 'gif'].includes(ext || '');
        });
        if (textureFiles.length === 1) {
            return textureFiles[0]![1];
        }

        return null;
    }
    const getTextureLoadUrl = (blob: Blob) => URL.createObjectURL(blob);

    // Override KTX2Loader.load using shared fetch helper
    overrideLoaderCache(
        KTX2Loader.prototype,
        originalKTX2LoaderLoad,
        getTextureBufferAndBlob,
        (_blob, url) => url!,
    );

    // Override TextureLoader and ImageBitmapLoader
    // NOTE: temporarily disabled TextureLoader override due to issues with custom usage of TextureLoader
    // overrideLoaderCache(
    //     TextureLoader.prototype,
    //     originalTextureLoaderLoad,
    //     getTextureBufferAndBlob,
    //     getTextureLoadUrl
    // );

    overrideLoaderCache(
        ImageBitmapLoader.prototype,
        originalImageBitmapLoaderLoad,
        getTextureBufferAndBlob,
        getTextureLoadUrl,
    );

    // Prevent GLTFLoader from mistaking ImageBitmapLoader.load returns ImageBitmap because now it returns Texture
    Object.defineProperty(ImageBitmapLoader.prototype, "isImageBitmapLoader", {
        get() { return false; },
        set() { /* no-op */ },
        configurable: true,
    });
}
