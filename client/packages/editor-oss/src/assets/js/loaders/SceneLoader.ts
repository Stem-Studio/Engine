import { Object3D, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, Texture } from "three";

import global from "../../../global";
import Converter from "../../../serialization/Converter";
import Ajax from "../../../utils/Ajax";
import {THREE_GetGifTexture} from "../../../utils/GifTexture";
import {traverseObjectDepthFirst} from "../../../utils/SceneTraverser";


interface TextureWithGif extends Texture {
    gifUrl?: string;
}

class SceneLoader {
    constructor() {}

    private hasGifUrl(texture: Texture): texture is TextureWithGif {
        return 'gifUrl' in texture && typeof (texture as TextureWithGif).gifUrl === 'string';
    }

    private async processGifTexture(material: Material): Promise<void> {
        const materialWithMap = material as MeshBasicMaterial | MeshStandardMaterial;
        if (materialWithMap.map && this.hasGifUrl(materialWithMap.map) && materialWithMap.map.gifUrl) {
            materialWithMap.map = await THREE_GetGifTexture(materialWithMap.map.gifUrl);
        }
    }

    private async processSceneGifTextures(root: Object3D): Promise<void> {
        const materials = new Set<Material>();
        traverseObjectDepthFirst(root, object => {
            const material = (object as Mesh).material;
            if (Array.isArray(material)) {
                for (let i = 0; i < material.length; i++) {
                    const entry = material[i];
                    if (entry) materials.add(entry);
                }
            } else if (material) {
                materials.add(material);
            }
        });

        await Promise.all(Array.from(materials, material => this.processGifTexture(material)));
    }

    async fetchScene(url: string): Promise<unknown> {
        try {
            const res = await Ajax.get({
                url,
            });
            
            if (res?.data.Code) {
                return res.data.Code === 200 ? res.data.Data : undefined;
            }
            
            return res?.data;
        } catch (error: unknown) {
            console.error("Fetching scene error:", error instanceof Error ? error.message : error);
            return undefined;
        }
    }

    async load(url: string, callback?: (obj: Object3D) => void): Promise<Object3D | undefined> {
        try {
            const data = await this.fetchScene(url);
            const converter = new (Converter as any)();
            const obj = await converter.sceneAsGroupFromJson(data, {
                server: global.app?.options.server,
                domWidth: global.app?.editor?.renderer.domElement.width ?? 800,
                domHeight: global.app?.editor?.renderer.domElement.height ?? 600,
            });

            await this.processSceneGifTextures(obj.scene);

            if (callback) {
                callback(obj.scene);
            }

            return obj.scene;
        } catch (error: unknown) {
            console.error("loading scene in Scene Loader error:", error instanceof Error ? error.message : error);
        }
    }
}

export default SceneLoader;
