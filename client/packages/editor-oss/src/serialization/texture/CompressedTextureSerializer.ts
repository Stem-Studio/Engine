import { CompressedTexture } from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

import TextureSerializer from "./TextureSerializer";
import global from '@stem/editor-oss/global';

type TextureJSON = {
    metadata?: unknown;
    image?: { width: number; height: number };
    userData?: Record<string, string>;
    mipmaps?: Array<{ data: string; width: number; height: number }>;
    [key: string]: unknown;
};

const base64EncodeUint8Array = (uint8Array: { length: number; [index: number]: number }) => {
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
        binary += String.fromCharCode(uint8Array[i]!);
    }
    return btoa(binary);
};

const base64ToUint8Array = (base64: string) => {
    const binaryStr = atob(base64);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
    }
    return bytes;
};

/**
 * CompressedTextureSerializer
 */
class CompressedTextureSerializer extends TextureSerializer {
    private readonly defaultTexture = new CompressedTexture([], 0, 0);

    constructor(private readonly convertServerObjUrls = false) {
        super();
    }

    toJSON(obj: CompressedTexture) {
        const json = super.toJSON(obj, this.defaultTexture) as TextureJSON;

        json.image = { ...obj.image };
        json.userData = { ...obj.userData };

        // CompressedTextures store Uint8Array texture data in the mipmaps
        // property. We need to either reference the original texture asset URL
        // or encode the texture data as base64 and store it inline. We do one
        // of those things below.
        delete json.mipmaps;

        if (obj.userData.Url) {
            // If there is a texture URL, use it instead of storing the texture
            // data inline.
            if (this.convertServerObjUrls && !json.userData.Url!.startsWith("http")) {
                json.userData.Url = location.origin + obj.userData.Url;
            } else {
                json.userData.Url = obj.userData.Url;
            }
        } else if (obj.mipmaps) {
            // Encode the texture data as base64 and store it inline.
            json.mipmaps = [];
            for (const mipmap of obj.mipmaps || []) {
                json.mipmaps.push({
                    data: base64EncodeUint8Array(mipmap.data),
                    width: mipmap.width,
                    height: mipmap.height,
                });
            }
        }

        return json;
    }

    fromJSON(json: any, parent: CompressedTexture | undefined, options: { server?: string }) {
        const texture = parent || new CompressedTexture([], 0, 0);
        const server = options.server || '';

        if (json.userData.Url) {
            const url = json.userData.Url.startsWith("http")
                ? json.userData.Url
                : server + json.userData.Url;

            if (url.endsWith(".ktx2")) {
                const renderer = global?.app?.renderer;
                if (!renderer) {
                    console.warn(`Renderer unavailable for KTX2 support: ${url}`);
                    return texture;
                }

                const loader = new KTX2Loader()
                    .setTranscoderPath(`/assets/js/basis/`)
                    .detectSupport(renderer);
                
                loader.load(
                    url,
                    (loadedTexture) => {
                        // Because this method needs to return a
                        // CompressedTexture synchronously, we need to copy the
                        // properties from the loaded texture to the texture we
                        // previously returned.
                        // TODO: in the future, we all fromJSON methods should
                        // return promises.
                        texture.mipmaps = loadedTexture.mipmaps;
                        texture.needsUpdate = true;
                    },
                    undefined,
                    (error) => {
                        console.warn(`Error loading compressed texture: ${url}`, error);
                    },
                );
            } else {
                console.warn(`Unsupported texture format: ${url}`);
            }
        } else {
            if (json.mipmaps) {
                texture.mipmaps = [];
                for (const mipmap of json.mipmaps) {
                    texture.mipmaps.push({
                        data: base64ToUint8Array(mipmap.data),
                        width: mipmap.width,
                        height: mipmap.height,
                    });
                }
            } else {
                texture.mipmaps = [];
            }
        }

        texture.image = {
            width: json.image.width,
            height: json.image.height,
        };

        // Read other properties from JSON, but ignore image and mipmaps since
        // we've already set them above.
        const jsonNoMipmaps = {
            ...json,
            mipmaps: undefined,
            image: undefined,
        };

        super.fromJSON(jsonNoMipmaps, texture, options);

        if (json.userData) {
            texture.userData = { ...json.userData };
        }

        return texture;
    }
}

export default CompressedTextureSerializer;
