import {
    EquirectangularReflectionMapping,
    NoToneMapping,
    Scene,
    SRGBColorSpace,
    Texture,
} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import type {RenderingSettings} from "../types/GameSettingsTypes";
import {cloneJsonCompatible} from "./cloneJsonCompatible";
import EnvironmentSettingsManager from "./EnvironmentSettingsManager";

function makeRendering(overrides: Partial<RenderingSettings> = {}): RenderingSettings {
    return {
        shadowMapType: 1,
        ambient: {color: "#ffffff", intensity: 0.5},
        hemisphere: {skyColor: "#ffffff", groundColor: "#888888", intensity: 0.25},
        fog: {type: "linear", color: "#aaaaaa", near: 5, far: 150, density: 0.011},
        background: {
            type: "Color",
            color: "#27272a",
            textureAsset: {assetId: "texture", revisionId: "rev-1"},
            cubemap: ["px", "nx", "py", "ny", "pz", "nz"],
            cubemapAssets: [{assetId: "px", revisionId: "rev-1"}, undefined],
            rotation: 0,
            intensity: 1,
            blurriness: 0,
        },
        toneMapping: {type: "None", exposure: 1},
        ...overrides,
    };
}

describe("EnvironmentSettingsManager", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("mirrors rendering settings without JSON stringifying or aliasing config", () => {
        const stringify = vi.spyOn(JSON, "stringify");
        const scene = new Scene();
        const rendering = makeRendering();
        const manager = new EnvironmentSettingsManager({scene, rendering} as any);

        (manager as any).mirrorRenderingToSceneUserData();

        expect(stringify).not.toHaveBeenCalled();
        expect(scene.userData.rendering).toEqual(cloneJsonCompatible(rendering));
        expect(scene.userData.rendering).not.toBe(rendering);
        expect(scene.userData.rendering.background).not.toBe(rendering.background);

        rendering.background.textureAsset!.assetId = "changed";
        expect(scene.userData.rendering.background.textureAsset.assetId).toBe("texture");
    });

    it("caches light, fog, and tone mapping settings without JSON stringify", () => {
        const stringify = vi.spyOn(JSON, "stringify");
        const scene = new Scene();
        const renderer = {toneMapping: NoToneMapping, toneMappingExposure: 0, shadowMap: {type: 0}};
        const rendering = makeRendering();
        const manager = new EnvironmentSettingsManager({scene, renderer, rendering} as any);

        (manager as any).applyAmbientSettings(scene, rendering);
        (manager as any).applyHemisphereSettings(scene, rendering);
        (manager as any).applyFogSettings(scene, rendering);
        (manager as any).applyToneMappingSettings(renderer, rendering);

        expect(stringify).not.toHaveBeenCalled();
        expect((manager as any).currentAmbientSettings.config).toEqual(rendering.ambient);
        expect((manager as any).currentAmbientSettings.config).not.toBe(rendering.ambient);
        expect((manager as any).currentHemisphereSettings.config).toEqual(rendering.hemisphere);
        expect((manager as any).currentFogSettings.config).toEqual(rendering.fog);
        expect((manager as any).currentToneMappingSettings.config).toEqual(rendering.toneMapping);
    });

    it("compares cached background asset config without JSON stringify", async () => {
        const stringify = vi.spyOn(JSON, "stringify");
        const scene = new Scene();
        const rendering = makeRendering({
            background: {
                type: "Texture",
                color: "#000000",
                texture: "background.png",
                textureAsset: {assetId: "texture", revisionId: "rev-1"},
                rotation: 0.25,
                intensity: 0.8,
                blurriness: 0.1,
            },
            fog: {type: "none", color: "#aaaaaa"},
        });
        const manager = new EnvironmentSettingsManager({scene, rendering} as any);
        (manager as any).currentBackgroundSettings = {
            config: {
                ...rendering.background,
                textureAsset: {...rendering.background.textureAsset},
            },
            scene,
            fogType: "none",
        };

        await (manager as any).applyBackgroundSettings(scene, rendering);

        expect(stringify).not.toHaveBeenCalled();
        expect((manager as any).currentBackgroundSettings.config).toEqual(rendering.background);
        expect((manager as any).currentBackgroundSettings.config).not.toBe(rendering.background);
        expect((manager as any).currentBackgroundSettings.config.textureAsset).not.toBe(rendering.background.textureAsset);
    });

    it("uses reflection mapping and sRGB for LDR equirectangular environments", async () => {
        const scene = new Scene();
        const texture = new Texture();
        const rendering = makeRendering({
            background: {
                type: "Texture",
                color: "#000000",
                textureAsset: {assetId: "texture", revisionId: "rev-1"},
                rotation: 0,
                intensity: 1,
                blurriness: 0,
            },
            fog: {type: "none", color: "#aaaaaa"},
        });
        const editor = {
            scene,
            rendering,
            engine: {
                assetLoader: {
                    getImageDataUrl: vi.fn().mockResolvedValue({url: "environment.png", format: "png"}),
                    createTexture: vi.fn().mockResolvedValue(texture),
                },
            },
        };
        const manager = new EnvironmentSettingsManager(editor as any);

        await (manager as any).applyBackgroundSettings(scene, rendering);

        expect(scene.background).toBe(texture);
        expect(scene.environment).toBe(texture);
        expect(texture.mapping).toBe(EquirectangularReflectionMapping);
        expect(texture.colorSpace).toBe(SRGBColorSpace);
    });

    it("marks assembled cubemaps as sRGB", async () => {
        const scene = new Scene();
        const rendering = makeRendering({
            background: {
                type: "Cubemap",
                color: "#000000",
                cubemap: ["", "", "", "", "", ""],
                cubemapAssets: Array.from({length: 6}, (_, index) => ({
                    assetId: `face-${index}`,
                    revisionId: "rev-1",
                })),
                rotation: 0,
                intensity: 1,
                blurriness: 0,
            },
            fog: {type: "none", color: "#aaaaaa"},
        });
        const createTexture = vi.fn().mockImplementation(async () => {
            const face = new Texture();
            face.image = {width: 1, height: 1};
            return face;
        });
        const manager = new EnvironmentSettingsManager({
            scene,
            rendering,
            engine: {
                assetLoader: {
                    createTexture,
                    getImageDataUrl: vi.fn().mockResolvedValue({url: "face.png", format: "png"}),
                },
            },
        } as any);

        await (manager as any).applyBackgroundSettings(scene, rendering);

        expect(createTexture).toHaveBeenCalledTimes(6);
        expect((scene.environment as Texture).colorSpace).toBe(SRGBColorSpace);
        expect(scene.background).toBe(scene.environment);
    });
});
