import { MathUtils, Object3D, Scene } from "three";

import { getNPCList, NPCBackendData } from "@stem/network/api/npc";
import { AssetResolutionContext, getAssetResolutionContext } from "@stem/editor-oss/asset-management/AssetResolutionContext";
import type { AssetSource } from "../asset-management/AssetSource";

// Legacy asset data format from old API endpoints
interface LegacyAssetData {
    ID: string;
    Name: string;
    Url: string;
    [key: string]: any;
}

export class BehaviorContextProvider {
    constructor() { }

    /**
     * Fetches behavior context with resources loaded directly from the API.
     * Uses React Query cache for asset data, ensuring cache is invalidated when new assets are uploaded.
     * @param object
     * @param scene
     * @param sceneId
     * @param assetSource Active editor asset source (scene or stem). Required
     *   for attribute converters to populate dropdowns in stem-editor mode;
     *   legacy callers may pass null during early-boot paths.
     */
    async getBehaviorContext(
        object: Object3D | null,
        scene: Scene,
        sceneId: string | null,
        assetSource: AssetSource | null,
    ): Promise<BehaviorContext> {
        const resources = sceneId
            ? await this.fetchResourcesFromAPI()
            : this.getEmptyResourcesContext();

        return {
            scene: this.getSceneContext(scene, sceneId, assetSource),
            object: object ? this.getSceneObjectContext(object) : null,
            resources,
            random: this.getRandomContext(),
        };
    }

    private async fetchResourcesFromAPI(): Promise<EngineResourcesContext> {
        try {
            const [videosData, npcsData] = await Promise.all([
                // Legacy API for videos
                this.fetchLegacyAssets("Video").catch(() => []),
                // NPC API
                getNPCList().catch(() => []),
            ]);

            return {
                sounds: [],
                models: [],
                images: [],
                videos: this.formatLegacyAssets(videosData),
                npcs: this.formatNPCs(npcsData),
            };
        } catch (error) {
            console.error("[BehaviorContextProvider] Failed to fetch resources:", error);
            return this.getEmptyResourcesContext();
        }
    }

    /**
     * Fetches assets from legacy API endpoints (e.g., /api/Video/List)
     * @param assetType
     */
    private async fetchLegacyAssets(assetType: string): Promise<LegacyAssetData[]> {
        void assetType;
        return [];
    }

    /**
     * Formats legacy assets to URL array
     * @param assets
     */
    private formatLegacyAssets(assets: LegacyAssetData[]): string[] {
        return assets.map(asset => asset.Url).filter(Boolean);
    }

    /**
     * Formats NPC data to label/value pairs
     * @param npcs
     */
    private formatNPCs(npcs: NPCBackendData[]): { label: string; value: string }[] {
        return npcs.map(npc => ({
            label: npc.Name,
            value: npc.ID,
        }));
    }

    private getEmptyResourcesContext(): EngineResourcesContext {
        return {
            sounds: [],
            models: [],
            videos: [],
            images: [],
            npcs: [],
        };
    }

    private getSceneContext(scene: Scene, sceneId: string | null, assetSource: AssetSource | null): SceneContext {
        return {
            sceneId,
            assetSource,
            objects: this.getSceneObjects(scene),
            assetResolutionContext: getAssetResolutionContext(scene),
        };
    }

    private getSceneObjectContext(object: Object3D): SceneObjectContext {
        return {
            uuid: object.uuid,
            name: object.name,
            animations: this.getAnimationNames(object),
            assetResolutionContext: getAssetResolutionContext(object, true),
        };
    }

    private getRandomContext() {
        return {
            uuid: () => MathUtils.generateUUID(),
        };
    }

    private getSceneObjects(scene: Scene): string[] {
        const res: string[] = [];
        for (const object of scene.children) {
            res.push(object.name);
        }
        return res;
    }

    private getAnimationNames(object: Object3D): string[] {
        const objectAnimations = (object as any)?._obj?.animations;
        const animations: string[] = [];
        if (objectAnimations) {
            for (const animation of objectAnimations) {
                animations.push(animation.name);
            }
        }

        return animations;
    }
}

export type BehaviorContext = {
    scene: SceneContext;
    object: SceneObjectContext | null;
    resources: EngineResourcesContext;
    random: RandomContext;
    [key: string]: any;
};

export type SceneContext = {
    sceneId: string | null;
    assetSource: AssetSource | null;
    objects: string[]; //TODO: how do we get UUID instead of name ?
    assetResolutionContext: AssetResolutionContext | null;
};

export type SceneObjectContext = {
    uuid: string;
    name: string;
    animations: string[];
    assetResolutionContext: AssetResolutionContext | null;
};

export type EngineResourcesContext = {
    sounds: string[];
    models: string[];
    videos: string[];
    images: string[];
    npcs: { label: string; value: string }[];
};

export type RandomContext = {
    uuid: () => string;
};
