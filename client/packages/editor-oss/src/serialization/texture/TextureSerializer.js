import * as THREE from "three";

import {resolveAssetId, resolveAssetRevisionId} from "@web-shared/asset-management/AssetResolutionContext";
import {fetchAssetImageDerivative} from "@stem/editor-oss/editor/asset-management/hooks/assets";
import {DetectDevice} from "@web-shared/utils/DetectDevice";
import BaseSerializer from "../BaseSerializer";

// Platform-adaptive concurrency limiter for texture image loads.
// iOS has tighter memory constraints; desktop browsers can handle more parallel loads.
const MAX_CONCURRENT_IMAGE_LOADS = DetectDevice.isMobile() ? 4 : 20;
let activeImageLoads = 0;
const imageLoadQueue = [];
let imageLoadQueueHead = 0;

/**
 *
 * @param loadFn
 */
function enqueueImageLoad(loadFn) {
    return new Promise((resolve, reject) => {
        imageLoadQueue.push({ loadFn, resolve, reject });
        processImageLoadQueue();
    });
}

/**
 *
 */
function processImageLoadQueue() {
    while (activeImageLoads < MAX_CONCURRENT_IMAGE_LOADS && imageLoadQueueHead < imageLoadQueue.length) {
        const { loadFn, resolve, reject } = imageLoadQueue[imageLoadQueueHead++];
        activeImageLoads++;
        loadFn()
            .then(resolve)
            .catch(reject)
            .finally(() => {
                activeImageLoads--;
                processImageLoadQueue();
            });
    }
    compactImageLoadQueueIfNeeded();
}

function compactImageLoadQueueIfNeeded() {
    if (imageLoadQueueHead === 0) return;
    if (imageLoadQueueHead >= imageLoadQueue.length) {
        imageLoadQueue.length = 0;
        imageLoadQueueHead = 0;
    } else if (imageLoadQueueHead >= 1024 && imageLoadQueueHead * 2 >= imageLoadQueue.length) {
        imageLoadQueue.splice(0, imageLoadQueueHead);
        imageLoadQueueHead = 0;
    }
}

/**
 * Resolve image URL via AssetLoader (cached, deduplicated) or fall back to
 * fetchAssetImageDerivative (individual API call).
 * @param assetId
 * @param revisionId
 * @param assetLoader - AssetLoader instance (from Converter options), if available.
 */
function resolveImageUrl(assetId, revisionId, assetLoader) {
    if (assetLoader) {
        return assetLoader.getImageDataUrl({ assetId, revisionId }).then(r => r.url);
    }
    return fetchAssetImageDerivative(assetId, revisionId);
}

const properties = [
    "anisotropy",
    "center",
    "encoding",
    "flipY",
    "format",
    "generateMipmaps",
    "magFilter",
    "mapping",
    "matrixAutoUpdate",
    "minFilter",
    "mipmaps",
    "name",
    "offset",
    "premultiplyAlpha",
    "repeat",
    "rotation",
    "type",
    "unpackAlignment",
    "uuid",
    "userData",
    "wrapS",
    "wrapT",
    "isTexture",
    "needsUpdate",
];

const DEFAULT_TEXTURE = new THREE.Texture();

function hasEquals(value) {
    return value && typeof value.equals === "function";
}

function isPlainObject(value) {
    return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

function valuesEqual(value, defaultValue) {
    if (value === defaultValue) {
        return true;
    }

    if (defaultValue !== undefined && defaultValue !== null && hasEquals(value)) {
        return value.equals(defaultValue);
    }

    if (Array.isArray(value) && Array.isArray(defaultValue)) {
        if (value.length !== defaultValue.length) {
            return false;
        }
        for (let i = 0; i < value.length; i++) {
            if (!valuesEqual(value[i], defaultValue[i])) {
                return false;
            }
        }
        return true;
    }

    if (isPlainObject(value) && isPlainObject(defaultValue)) {
        const keys = Object.keys(value);
        const defaultKeys = Object.keys(defaultValue);
        if (keys.length !== defaultKeys.length) {
            return false;
        }
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (!Object.prototype.hasOwnProperty.call(defaultValue, key) || !valuesEqual(value[key], defaultValue[key])) {
                return false;
            }
        }
        return true;
    }

    return false;
}

class TextureSerializer extends BaseSerializer {
    toJSON(obj, defaultTexture) {
        const texture = defaultTexture ? defaultTexture : DEFAULT_TEXTURE;
        const json = super.toJSON(obj);

        for (let i = 0; i < properties.length; i++) {
            const key = properties[i];
            if (valuesEqual(obj[key], texture[key])) {
                delete json[key];
            } else if (obj[key] instanceof THREE.Vector2 && obj[key].x !== null && obj[key].y !== null) {
                json[key] = obj[key].toArray();
            } else {
                json[key] = obj[key];
            }
        }

        if (json.userData && json.userData.revisionID) {
            delete json.userData.revisionID;
        }

        if (obj.image && !obj.userData?.imageId) {
            json.image = this.serializeImage(obj.image);
        }

        return json;
    }

    fromJSON(json, parent, options) {
        const opts = options ?? {};
        const server = opts.server || options;
        const context = opts.assetResolutionContext;
        const skipImage = opts.skipImage ?? false;
        const onload = options?.onload;

        const obj = parent || new THREE.Texture();

        Object.keys(json).forEach(key => {
            if (key === "image" && !skipImage) {
                const image = this.deserializeImage(json.image, server);

                if (image instanceof HTMLImageElement && !image.complete) {
                    image.onload = () => {
                        this.handleOnLoad(obj, image, onload);
                    };
                } else {
                    obj.image = image;
                }

                if (obj.image instanceof HTMLVideoElement) {
                    obj.needsUpdate = false;

                    const markReady = () => {
                        if (obj.image.videoWidth > 0 && obj.image.videoHeight > 0) {
                            obj.needsUpdate = true;
                            obj.image.removeEventListener("canplay", markReady);
                            obj.image.removeEventListener("loadeddata", markReady);
                        }
                    };

                    obj.image.addEventListener("canplay", markReady);
                    obj.image.addEventListener("loadeddata", markReady);
                }
            } else if (key === "center" || key === "offset" || key === "repeat") {
                obj[key].fromArray(json[key]);
            } else {
                obj[key] = json[key];
            }
        });

        if (!(obj instanceof THREE.VideoTexture)) {
            obj.needsUpdate = true;
        }

        // Migrate old format (assetID + revisionID) to imageId
        if (obj.userData && obj.userData.assetID && !obj.userData.imageId) {
            obj.userData.imageId = obj.userData.assetID;
            delete obj.userData.assetID;
            delete obj.userData.revisionID;
        }

        if (!obj.image || obj.userData?.imageId) {
            // NOTE: we first set a placeholder image to avoid issues with three.js requiring texture.image to be set
            const canvas = document.createElement("canvas");
            canvas.width = 1;
            canvas.height = 1;
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            obj.image = canvas;

            if (obj.userData?.imageId) {
                const assetId = resolveAssetId(obj.userData?.imageId, options.assetResolutionContext);
                const revisionId = resolveAssetRevisionId(assetId, context);

                if (revisionId) {
                    // Use AssetLoader (cached) when available, otherwise fall back to API call.
                    // Concurrency-limited image load avoids memory pressure on mobile.
                    resolveImageUrl(assetId, revisionId, opts.assetLoader)
                        .then(url => {
                            return enqueueImageLoad(() => new Promise((resolve, reject) => {
                                const img = new Image();
                                img.crossOrigin = "anonymous";

                                img.onload = () => {
                                    this.handleOnLoad(obj, img, onload);
                                    resolve();
                                };

                                img.onerror = error => {
                                    console.error("Failed to load texture image for asset", obj.userData?.imageId, error);
                                    onload?.(obj);
                                    reject(new Error(`Failed to load texture image for asset ${obj.userData?.imageId}`));
                                };

                                img.src = url;
                            }));
                        })
                        .catch(console.error);
                }
            }
        }

        return obj;
    }

    handleOnLoad(obj, image, onload) {
        obj.image = image;
        obj.needsUpdate = true;

        if (onload) {
            const clonedObj = obj.clone();
            // Ensure asset metadata in userData is preserved on the cloned texture
            clonedObj.userData = {...obj.userData};
            onload(clonedObj);
        }
    }

    serializeImage(image) {
        if (image instanceof HTMLImageElement) {
            return {
                tagName: "img",
                src: this.imageToRelativePath(image.src),
                width: image.width,
                height: image.height,
                crossOrigin: image.crossOrigin || null,
            };
        } else if (image instanceof HTMLCanvasElement) {
            return {
                tagName: "canvas",
                src: this.imageToRelativePath(image.toDataURL()),
                width: image.width,
                height: image.height,
            };
        } else if (
            image instanceof ImageBitmap ||
            typeof OffscreenCanvas !== "undefined" && image instanceof OffscreenCanvas
        ) {
            const width = image.width;
            const height = image.height;
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(image, 0, 0);
            return {tagName: "canvas", src: this.imageToRelativePath(canvas.toDataURL()), width: width, height: height};
        } else if (image instanceof HTMLVideoElement) {
            const width = image.videoWidth;
            const height = image.videoHeight;
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(image, 0, 0);
            return {tagName: "canvas", src: this.imageToRelativePath(canvas.toDataURL()), width: width, height: height};
        } else if (image instanceof ImageData) {
            const canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            const ctx = canvas.getContext("2d");
            ctx.putImageData(image, 0, 0);
            return {
                tagName: "canvas",
                src: this.imageToRelativePath(canvas.toDataURL()),
                width: image.width,
                height: image.height,
            };
        }
        return null;
    }

    deserializeImage(json) {
        if (!json) return null;
        //  VideoTexture
        if (typeof json === "object" && json.tagName === "video") {
            const video = document.createElement("video");
            video.src = json.src;
            video.autoplay = true;
            video.loop = true;
            video.muted = true;
            video.crossOrigin = "anonymous";
            return video;
        }

        if (json.tagName === "img") {
            const img = new Image();
            // ensure we request images with CORS to avoid tainting canvases used by WebGL
            // default to 'anonymous' when a crossOrigin was not serialized
            if (json.crossOrigin !== undefined && json.crossOrigin !== null) {
                img.crossOrigin = json.crossOrigin;
            } else {
                img.crossOrigin = "anonymous";
            }
            img.src = json.src;
            img.width = json.width;
            img.height = json.height;
            return img;
        } else if (json.tagName === "canvas") {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            const img = new Image();
            // load the data URL into an Image; data URLs are same-origin so crossOrigin is not needed
            img.crossOrigin = null;
            img.src = json.src;
            img.onload = () => {
                canvas.width = img.width;
                canvas.height = img.height;
                ctx.drawImage(img, 0, 0);
            };
            return canvas;
        }
        return null;
    }

    imageToRelativePath(source) {
        const origin = typeof window !== "undefined" && window.location ? window.location.origin : "";
        if (source.startsWith(origin)) {
            return source.substring(origin.length);
        }
        return source;
    }
}

export default TextureSerializer;
