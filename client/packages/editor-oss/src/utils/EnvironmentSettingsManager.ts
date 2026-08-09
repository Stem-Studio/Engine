import {
    NoToneMapping,
    LinearToneMapping,
    ReinhardToneMapping,
    CineonToneMapping,
    ACESFilmicToneMapping,
    type ToneMapping,
    AmbientLight,
    HemisphereLight,
    Fog,
    FogExp2,
    Color,
    TextureLoader,
    EquirectangularReflectionMapping,
    SRGBColorSpace,
    CanvasTexture,
    Scene,
    Texture,
    LinearFilter,
    LinearMipmapLinearFilter,
    CubeTexture,
    MathUtils,
} from "three";
import {EXRLoader} from "three/addons/loaders/EXRLoader.js";
import {HDRLoader} from "three/addons/loaders/HDRLoader.js";
import {
    screenUV,
    equirectUV,
    texture as textureNode,
    cubeTexture,
    vec2,
    dot,
    mix,
    float,
    uniform,
    color as colorNode,
    positionWorld,
    positionView,
    smoothstep,
    fog,
} from "three/tsl";
import type {WebGPURenderer} from "three/webgpu";

import {normalizeBackgroundGradient, normalizeShadowMapType} from "./renderingSettingsNormalization";
import {cloneJsonCompatible, jsonCompatibleEquals} from "./cloneJsonCompatible";
import {AssetType, getSceneAssets} from "@stem/network/api/asset";
import type {AssetRef} from "@stem/editor-oss/asset-management/AssetRef";
import type Editor from "../editor/Editor";
import {getOrCreateDynamicRoot} from "@stem/editor-oss/scene/dynamicRoots";
import {findObjectByNameDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";
import type {RenderingSettings} from "../types/GameSettingsTypes";

// Fallback types since they are not exported from three/tsl
interface Node {
    [key: string]: any;
}

interface UniformNode<T> extends Node {
    value: T;
}

type SceneWithNodes = Scene & {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fogNode: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    backgroundNode: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    environmentNode: any;
};

type HeightFogFalloff = NonNullable<RenderingSettings["fog"]["heightFalloff"]>;

export class EnvironmentSettingsManager {
    private editor: Editor;
    private currentBackgroundSettings: {
        config: NonNullable<RenderingSettings["background"]>;
        scene: Scene;
        fogType?: string;
    } | null = null;
    private currentAmbientSettings: {config: NonNullable<RenderingSettings["ambient"]>; scene: Scene} | null = null;
    private currentHemisphereSettings: {config: NonNullable<RenderingSettings["hemisphere"]>; scene: Scene} | null =
        null;
    private currentFogSettings: {config: NonNullable<RenderingSettings["fog"]>; scene: Scene} | null = null;
    private currentToneMappingSettings: {
        config: NonNullable<RenderingSettings["toneMapping"]>;
        renderer: WebGPURenderer;
    } | null = null;
    private currentShadowMapType: {type: RenderingSettings["shadowMapType"]; renderer: WebGPURenderer} | null = null;
    private generatedGradientTexture: Texture | null = null;

    private fogUniforms: {
        color: UniformNode<Color>;
        minHeight: UniformNode<number>;
        maxHeight: UniformNode<number>;
        near: UniformNode<number>;
        far: UniformNode<number>;
        density: UniformNode<number>;
    } | null = null;

    private cachedFogNodesByFalloff: Partial<Record<HeightFogFalloff, Node>> = {};

    constructor(editor: Editor) {
        this.editor = editor;
    }

    private isLikelyUrlOrPath(value: string): boolean {
        const trimmed = value.trim();
        if (!trimmed) {
            return false;
        }

        return (
            /^(https?:|data:|blob:|file:|\/|\.\.?\/)/i.test(trimmed) ||
            trimmed.includes("/") ||
            /\.(hdr|exr|ktx2?|png|jpe?g|gif|webp|avif|bmp|svg)(?:[?#].*)?$/i.test(trimmed)
        );
    }

    private async getSceneImageAssetRefsByName(): Promise<Map<string, AssetRef>> {
        const sceneId = this.editor.sceneID;
        if (!sceneId) {
            return new Map();
        }

        const {assets} = await getSceneAssets(sceneId, {types: [AssetType.Image]});
        const refsByName = new Map<string, AssetRef>();

        for (const asset of assets) {
            const revisionId = asset.revisionId || asset.headRevisionId;
            if (!asset.name || !revisionId) {
                continue;
            }

            refsByName.set(asset.name.toLowerCase(), {assetId: asset.id, revisionId});
        }

        return refsByName;
    }

    private async resolveBackgroundImageSource(
        source?: string,
        assetRef?: AssetRef,
        sceneImageAssetRefsByName?: Map<string, AssetRef>,
    ): Promise<{url: string; format?: string; assetRef?: AssetRef}> {
        const engine = this.editor.engine;

        if (assetRef && engine?.assetLoader) {
            const {url, format} = await engine.assetLoader.getImageDataUrl(assetRef);
            return {url, format, assetRef};
        }

        const trimmed = source?.trim() || "";
        if (!trimmed) {
            throw new Error("Background image source cannot be empty.");
        }

        if (this.isLikelyUrlOrPath(trimmed)) {
            return {url: trimmed};
        }

        const namedAssetRef = sceneImageAssetRefsByName?.get(trimmed.toLowerCase());
        if (!namedAssetRef || !engine?.assetLoader) {
            return {url: trimmed};
        }

        const {url, format} = await engine.assetLoader.getImageDataUrl(namedAssetRef);
        return {url, format, assetRef: namedAssetRef};
    }

    public async applyEnvironmentSettings(): Promise<void> {
        if (!this.editor) {
            console.warn("EnvironmentSettingsManager: Editor or App not initialized");
            return;
        }

        const scene = this.editor.scene;
        const renderer = this.editor.renderer;
        const rendering = this.editor.rendering;

        if (!scene || !rendering) {
            console.warn("EnvironmentSettingsManager: Scene or rendering settings not available");
            return;
        }

        try {
            // Save settings to editor.rendering (for synchronization with panels)
            this.editor.rendering = {...rendering};

            this.applyAmbientSettings(scene, rendering);
            this.applyHemisphereSettings(scene, rendering);
            this.applyFogSettings(scene, rendering);
            await this.applyBackgroundSettings(scene, rendering);
            this.applyToneMappingSettings(renderer, rendering);
            this.applyShadowSettings(renderer, rendering);
        } catch (error) {
            console.error("EnvironmentSettingsManager: Error applying environment settings:", error);
        }
    }

    public async updateEnvironmentSettings(updates: Partial<RenderingSettings>): Promise<void> {
        if (!this.editor) {
            console.warn("EnvironmentSettingsManager: Editor not initialized");
            return;
        }

        this.editor.rendering = {
            ...this.editor.rendering,
            ...updates,
        };

        this.mirrorRenderingToSceneUserData();
        await this.applyEnvironmentSettings();
    }

    public async initializeFromScene(): Promise<void> {
        if (!this.editor || !this.editor.scene) {
            console.warn("EnvironmentSettingsManager: Editor or scene not available");
            return;
        }

        // Scene JSON persists rendering under `scene.userData.rendering`. Local storage
        // doesn't carry editor.rendering through the API metadata path, so
        // SceneConfig resets it to defaults on every load. Hydrate from the
        // scene's own userData before applying, otherwise saved background,
        // ambient, fog, etc. would silently revert.
        const persisted = this.editor.scene.userData?.rendering as
            | Partial<RenderingSettings>
            | undefined;
        if (persisted && typeof persisted === "object") {
            this.editor.rendering = {
                ...this.editor.rendering,
                ...persisted,
            };
        }

        if (this.editor.rendering) {
            await this.applyEnvironmentSettings();
        }
    }

    private mirrorRenderingToSceneUserData(): void {
        const scene = this.editor?.scene;
        const rendering = this.editor?.rendering;
        if (!scene || !rendering) return;
        scene.userData = scene.userData || {};
        // Deep clone so later in-place mutations on either side don't alias.
        scene.userData.rendering = cloneJsonCompatible(rendering);
    }

    private getDynamicGroup(scene: Scene) {
        return getOrCreateDynamicRoot(scene);
    }

    private getEffectiveFogSettings(
        scene: Scene,
        fogSettings?: RenderingSettings["fog"],
    ): RenderingSettings["fog"] | null {
        if (!fogSettings) {
            return null;
        }

        if ((scene.userData.fogEditorVisibility ?? true) === false) {
            return {...fogSettings, type: "none"};
        }

        return fogSettings;
    }

    private updateHeightFogUniforms(fogSettings: RenderingSettings["fog"]): void {
        const fogColor = new Color(fogSettings.color);
        const minHeight = fogSettings.heightMin ?? 50.0;
        const maxHeight = fogSettings.heightMax ?? 150.0;
        const near = fogSettings.near ?? 100.0;
        const far = fogSettings.far ?? 650.0;
        const density = fogSettings.density ?? 0.011;

        if (!this.fogUniforms) {
            this.fogUniforms = {
                color: uniform(fogColor.clone()),
                minHeight: uniform(minHeight),
                maxHeight: uniform(maxHeight),
                near: uniform(near),
                far: uniform(far),
                density: uniform(density),
            };
            return;
        }

        this.fogUniforms.color.value.copy(fogColor);
        this.fogUniforms.minHeight.value = minHeight;
        this.fogUniforms.maxHeight.value = maxHeight;
        this.fogUniforms.near.value = near;
        this.fogUniforms.far.value = far;
        this.fogUniforms.density.value = density;
    }

    private clearHeightFogNodeCache(): void {
        this.cachedFogNodesByFalloff = {};
    }

    private getHexString(value: string): string {
        return new Color(value).getHexString();
    }

    private applyAmbientSettings(scene: Scene, rendering: RenderingSettings): void {
        if (!rendering.ambient) return;

        const {color, intensity} = rendering.ambient;
        const prev = this.currentAmbientSettings;

        const shouldReload =
            !prev || prev.scene !== scene || prev.config.color !== color || prev.config.intensity !== intensity;

        if (!shouldReload) return;
        this.currentAmbientSettings = {
            config: cloneJsonCompatible(rendering.ambient) as RenderingSettings["ambient"],
            scene,
        };

        const group = this.getDynamicGroup(scene);
        let ambient = findObjectByNameDepthFirst(group, "AmbientLight") as AmbientLight | null;

        if (!ambient) {
            ambient = new AmbientLight(color, intensity);
            ambient.name = "AmbientLight";
            group.add(ambient);
        }

        ambient.color.set(color);
        ambient.intensity = intensity;
        ambient.userData.isSelectable = false;
        ambient.position.set(1e9, 1e9, 1e9);
    }

    private applyHemisphereSettings(scene: Scene, rendering: RenderingSettings): void {
        if (!rendering.hemisphere) return;

        const {skyColor, groundColor, intensity} = rendering.hemisphere;
        const prev = this.currentHemisphereSettings;
        const shouldReload =
            !prev ||
            prev.scene !== scene ||
            prev.config.skyColor !== skyColor ||
            prev.config.groundColor !== groundColor ||
            prev.config.intensity !== intensity;

        if (!shouldReload) return;
        this.currentHemisphereSettings = {
            config: cloneJsonCompatible(rendering.hemisphere) as RenderingSettings["hemisphere"],
            scene,
        };

        const group = this.getDynamicGroup(scene);
        let hemisphere = findObjectByNameDepthFirst(group, "HemisphereLight") as HemisphereLight | null;

        if (!hemisphere) {
            hemisphere = new HemisphereLight(skyColor, groundColor, intensity);
            hemisphere.name = "HemisphereLight";
            group.add(hemisphere);
        }

        hemisphere.color.set(skyColor);
        hemisphere.groundColor.set(groundColor);
        hemisphere.intensity = intensity;
        hemisphere.userData.isSelectable = false;
        hemisphere.position.set(1e9, 1e9, 1e9);
    }

    private applyFogSettings(scene: Scene, rendering: RenderingSettings): void {
        const sceneWithNodes = scene as SceneWithNodes;
        const fogSettings = this.getEffectiveFogSettings(scene, rendering.fog);
        if (!fogSettings) return;

        const {type, color, near, far, density, heightMin, heightMax, heightFalloff} = fogSettings;

        const prev = this.currentFogSettings;
        const sceneChanged = !prev || prev.scene !== scene;
        const shouldReload =
            !prev ||
            sceneChanged ||
            prev.config.type !== type ||
            prev.config.color !== color ||
            prev.config.near !== near ||
            prev.config.far !== far ||
            prev.config.density !== density ||
            prev.config.heightMin !== heightMin ||
            prev.config.heightMax !== heightMax ||
            prev.config.heightFalloff !== heightFalloff;

        if (!shouldReload) return;

        const appliedConfig = cloneJsonCompatible(fogSettings) as NonNullable<RenderingSettings["fog"]>;

        this.currentFogSettings = {
            config: appliedConfig,
            scene,
        };

        if (sceneChanged) {
            this.clearHeightFogNodeCache();
        }

        if (type === "none") {
            scene.fog = null;
            sceneWithNodes.fogNode = null;
            this.clearHeightFogNodeCache();
        } else if (type === "linear" && near !== undefined && far !== undefined) {
            if (scene.fog instanceof Fog) {
                scene.fog.color.set(color);
                scene.fog.near = near;
                scene.fog.far = far;
            } else {
                scene.fog = new Fog(color, near, far);
            }
            sceneWithNodes.fogNode = null;
            this.clearHeightFogNodeCache();
        } else if (type === "exp" && density !== undefined) {
            if (scene.fog instanceof FogExp2) {
                scene.fog.color.set(color);
                scene.fog.density = density;
            } else {
                scene.fog = new FogExp2(color, density);
            }
            sceneWithNodes.fogNode = null;
            this.clearHeightFogNodeCache();
        } else if (type === "height") {
            this.updateHeightFogUniforms(fogSettings);
            const fogUniforms = this.fogUniforms;

            if (!fogUniforms) {
                return;
            }

            const falloffType: HeightFogFalloff = heightFalloff ?? "linear";
            const cachedFogNode = this.cachedFogNodesByFalloff[falloffType];

            if (!sceneChanged && cachedFogNode) {
                sceneWithNodes.fogNode = cachedFogNode;
                scene.fog = null;
                return;
            }

            const heightFactor = smoothstep(fogUniforms.minHeight as any, fogUniforms.maxHeight as any, positionWorld.y);
            const heightDensity = heightFactor.oneMinus();

            let distanceDensity: any;

            if (falloffType === "exp") {
                const dist = positionView.length();
                const expFactor = (dist as any).mul(fogUniforms.density as any).negate().exp();
                distanceDensity = float(1.0).sub(expFactor);
            } else {
                const fogRange = (fogUniforms.far as any).sub(fogUniforms.near as any);
                const dist = positionView.length();
                distanceDensity = (dist as any).sub(fogUniforms.near as any).div(fogRange).clamp();
            }

            const activeDensity = heightDensity.mul(distanceDensity);
            const fogNode = fog(colorNode(fogUniforms.color as any), activeDensity);

            sceneWithNodes.fogNode = fogNode;
            this.cachedFogNodesByFalloff[falloffType] = fogNode;
            scene.fog = null;
        } else {
            sceneWithNodes.fogNode = null;
            this.clearHeightFogNodeCache();
        }
    }

    private async applyBackgroundSettings(scene: Scene, rendering: RenderingSettings): Promise<void> {
        const sceneWithNodes = scene as SceneWithNodes;
        if (!rendering.background) {
            // New scene's metadata declared no background — explicitly reset to
            // the editor's default. Without this, the previous scene's
            // `scene.background` (the editor reuses a single THREE.Scene
            // instance) bleeds into the freshly-loaded scene.
            if (scene.background instanceof Texture) {
                scene.background.dispose();
            }
            if (scene.environment instanceof Texture) {
                scene.environment.dispose();
            }
            scene.background = new Color(0x27272a);
            scene.environment = null;
            sceneWithNodes.backgroundNode = null;
            sceneWithNodes.environmentNode = null;
            this.currentBackgroundSettings = null;
            return;
        }

        const backgroundWithAssets = rendering.background as RenderingSettings["background"] & {
            textureAsset?: AssetRef;
            cubemapAssets?: Array<AssetRef | undefined>;
        };
        const {type, color, texture, cubemap, rotation, intensity, blurriness, gradient, gradientMode} =
            rendering.background;
        const textureAsset: AssetRef | undefined = backgroundWithAssets.textureAsset;
        const cubemapAssets: Array<AssetRef | undefined> = backgroundWithAssets.cubemapAssets || [];
        // A `blob:` object URL only lives for the session that created it. Older
        // scenes persisted such URLs as the background texture; on reload they
        // are revoked and unfetchable. When there's no AssetRef to recover from,
        // treat the texture as absent so we fall back to a plain background
        // instead of throwing "Failed to load texture: blob:…".
        const usableTexture =
            typeof texture === "string" && texture.startsWith("blob:") && !textureAsset ? undefined : texture;
        if (usableTexture !== texture) {
            console.warn(
                "EnvironmentSettingsManager: ignoring stale blob: background texture with no asset reference " +
                    "(re-set the scene background to restore it).",
            );
        }
        const currentRotation = rotation ?? 0;
        const currentIntensity = intensity ?? 1;
        const currentBlurriness = blurriness ?? 0;
        const effectiveFogSettings = this.getEffectiveFogSettings(scene, rendering.fog);
        const effectiveFogType = effectiveFogSettings?.type;

        // Apply rotation and intensity
        scene.backgroundRotation.y = currentRotation;
        // Environment uses opposite rotation so reflections/light from the environment map
        // visually match the rotated background instead of appearing mirrored.
        scene.environmentRotation.y = -currentRotation;
        scene.backgroundIntensity = currentIntensity;
        scene.environmentIntensity = currentIntensity;
        scene.backgroundBlurriness = currentBlurriness;

        // Check if we need to reload resources
        const prev = this.currentBackgroundSettings;

        let hasSceneBgColorChanged = false;
        if (prev) {
            const bg = prev.scene.background;

            if (bg instanceof Color) {
                hasSceneBgColorChanged = this.getHexString(rendering.background.color) !== bg.getHexString();
            }
        }

        const shouldReload =
            !prev ||
            hasSceneBgColorChanged ||
            prev.scene !== scene ||
            prev.config.type !== type ||
            (type === "Color" && prev.config.color !== color) ||
            (type === "Texture" &&
                (prev.config.texture !== texture ||
                    !jsonCompatibleEquals(prev.config.textureAsset, textureAsset))) ||
            (type === "Cubemap" &&
                (!jsonCompatibleEquals(prev.config.cubemap, cubemap) ||
                    !jsonCompatibleEquals(prev.config.cubemapAssets, cubemapAssets))) ||
            (type === "Gradient" && (prev.config.gradient !== gradient || prev.config.gradientMode !== gradientMode)) ||
            (effectiveFogType === "height") !== (prev.fogType === "height");

        if (!shouldReload) {
            this.currentBackgroundSettings = {
                config: cloneJsonCompatible(rendering.background) as RenderingSettings["background"],
                scene,
                fogType: effectiveFogType,
            };
            return;
        }

        // Dispose previously generated gradient texture to prevent memory leaks
        if (this.generatedGradientTexture) {
            this.generatedGradientTexture.dispose();
            this.generatedGradientTexture = null;
        }

        this.currentBackgroundSettings = {
            config: cloneJsonCompatible(rendering.background) as RenderingSettings["background"],
            scene,
            fogType: effectiveFogType,
        };

        if (type === "Color" || !type || (type === "Texture" && !usableTexture && !textureAsset)) {
            if (scene.background instanceof Texture) {
                scene.background.dispose();
            }
            if (scene.environment instanceof Texture) {
                scene.environment.dispose();
            }
            scene.background = new Color(color);
            scene.environment = null;

            const bgNode = colorNode(new Color(color));
            if (effectiveFogSettings?.type === "height") {
                this.applyFogToBackground(scene, bgNode, effectiveFogSettings);
            } else {
                sceneWithNodes.backgroundNode = null;
            }
            sceneWithNodes.environmentNode = bgNode;
        } else if (type === "Texture" && (usableTexture || textureAsset)) {
            if (effectiveFogType !== "height") {
                sceneWithNodes.backgroundNode = null;
            }
            const resolvedTexture = await this.resolveBackgroundImageSource(usableTexture, textureAsset);
            const ext = (resolvedTexture.format || resolvedTexture.url.split(".").pop()?.toLowerCase())?.toLowerCase();
            const engine = this.editor.engine;

            const setupTexture = (tex: Texture) => {
                if (scene.background instanceof Texture) {
                    scene.background.dispose();
                }
                if (scene.environment instanceof Texture && scene.environment !== scene.background) {
                    scene.environment.dispose();
                }

                tex.mapping = EquirectangularReflectionMapping;

                scene.background = tex;
                scene.environment = tex;

                const bgNode = textureNode(tex, equirectUV());
                if (effectiveFogSettings?.type === "height") {
                    this.applyFogToBackground(scene, bgNode, effectiveFogSettings);
                } else {
                    sceneWithNodes.backgroundNode = null;
                }
                sceneWithNodes.environmentNode = bgNode;

                scene.backgroundIntensity = currentIntensity;
                scene.environmentIntensity = currentIntensity;
                scene.backgroundBlurriness = currentBlurriness;
            };

            if (resolvedTexture.assetRef && ext !== "hdr" && ext !== "exr" && engine?.assetLoader) {
                const tex = await engine.assetLoader.createTexture(resolvedTexture.assetRef);
                if (ext !== "ktx2") {
                    tex.colorSpace = SRGBColorSpace;
                }
                setupTexture(tex);
            } else {
                await new Promise<void>((resolve, reject) => {
                    if (ext === "hdr") {
                    new HDRLoader().load(
                        resolvedTexture.url,
                        tex => {
                            tex.needsUpdate = true;
                            setupTexture(tex);
                            resolve();
                        },
                        undefined,
                        err => {
                            reject(err instanceof Error ? err : new Error(`Failed to load HDR texture: ${resolvedTexture.url}`));
                        },
                    );
                    } else if (ext === "exr") {
                    new EXRLoader().load(
                        resolvedTexture.url,
                        tex => {
                            tex.needsUpdate = true;
                            setupTexture(tex);
                            resolve();
                        },
                        undefined,
                        err => {
                            reject(err instanceof Error ? err : new Error(`Failed to load EXR texture: ${resolvedTexture.url}`));
                        },
                    );
                    } else {
                    new TextureLoader().load(
                        resolvedTexture.url,
                        tex => {
                            tex.colorSpace = SRGBColorSpace;
                            setupTexture(tex);
                            resolve();
                        },
                        undefined,
                        err => {
                            reject(err instanceof Error ? err : new Error(`Failed to load texture: ${resolvedTexture.url}`));
                        },
                    );
                    }
                });
            }
        } else if (type === "Cubemap" && (cubemap || cubemapAssets)) {
            if (effectiveFogType !== "height") {
                sceneWithNodes.backgroundNode = null;
            }
            const cubemapSources = cubemap || ["", "", "", "", "", ""];
            const cubemapAssetSources: Array<AssetRef | undefined> = cubemapAssets;

            if (
                cubemapSources.length === 6 &&
                Array.from(
                    {length: 6},
                    (_, index) => Boolean(cubemapSources[index]) || cubemapAssetSources[index] !== undefined,
                ).every(Boolean)
            ) {
                const engine = this.editor.engine;
                const sceneImageAssetRefsByName = await this.getSceneImageAssetRefsByName();
                const resolvedFaces = await Promise.all(
                    cubemapSources.map((face, index) =>
                        this.resolveBackgroundImageSource(face, cubemapAssetSources[index], sceneImageAssetRefsByName),
                    ),
                );

                const faceTextures = await Promise.all(
                    resolvedFaces.map(async face => {
                        if (face.assetRef && engine?.assetLoader) {
                            return engine.assetLoader.createTexture(face.assetRef);
                        }

                        return new TextureLoader().loadAsync(face.url);
                    }),
                );

                const tex = new CubeTexture(faceTextures.map(faceTexture => faceTexture.image));
                tex.colorSpace = SRGBColorSpace;
                tex.needsUpdate = true;

                if (scene.background instanceof Texture) {
                    scene.background.dispose();
                }
                if (scene.environment instanceof Texture && scene.environment !== scene.background) {
                    scene.environment.dispose();
                }

                scene.background = tex;
                scene.environment = tex;
                scene.backgroundIntensity = currentIntensity;
                scene.environmentIntensity = currentIntensity;
                scene.backgroundBlurriness = currentBlurriness;

                const bgNode = cubeTexture(tex, positionWorld);
                if (effectiveFogSettings?.type === "height") {
                    this.applyFogToBackground(scene, bgNode, effectiveFogSettings);
                } else {
                    sceneWithNodes.backgroundNode = null;
                }
                sceneWithNodes.environmentNode = bgNode;

                for (const faceTexture of faceTextures) {
                    faceTexture.dispose();
                }
            }
        } else if (type === "Gradient") {
            if (scene.background instanceof Texture) {
                scene.background.dispose();
            }
            if (scene.environment instanceof Texture && scene.environment !== scene.background) {
                scene.environment.dispose();
            }
            this.applyGradientSettings(scene, rendering.background);
        }

        scene.backgroundIntensity = currentIntensity;
        scene.backgroundBlurriness = currentBlurriness;
    }

    private applyFogToBackground(scene: Scene, bgNode: Node | null, fogSettings: RenderingSettings["fog"]) {
        const sceneWithNodes = scene as SceneWithNodes;
        if (!fogSettings || fogSettings.type !== "height" || !bgNode) {
            (sceneWithNodes as any).backgroundNode = bgNode as any;
            if (!bgNode && sceneWithNodes.backgroundNode) (sceneWithNodes as any).backgroundNode = null;
            return;
        }

        // Determine fog color source (from uniforms when available, otherwise from fog settings)
        let fogColorNodeValue: any;

        if (this.fogUniforms) {
            fogColorNodeValue = colorNode(this.fogUniforms.color as any);
        } else {
            const {color: fogColorHex} = fogSettings;
            const fogColorVal = new Color(fogColorHex);
            fogColorNodeValue = colorNode(uniform(fogColorVal) as any);
        }

        const dirY = positionWorld.normalize().y;
        const skyFogFactor = smoothstep(float(-0.1), float(0.5), dirY);
        const skyFogDensity = skyFogFactor.oneMinus();

        const mixed = mix(bgNode as any, fogColorNodeValue, skyFogDensity);
        (sceneWithNodes as any).backgroundNode = mixed as any;
    }

    private applyGradientSettings(scene: Scene, background: NonNullable<RenderingSettings["background"]>): void {
        const sceneWithNodes = scene as SceneWithNodes;
        const gradientConfig = normalizeBackgroundGradient(background.gradient);
        const {gradientMode, intensity, blurriness} = background;
        const currentIntensity = intensity ?? 1;
        const currentBlurriness = blurriness ?? 0;

        if (gradientConfig) {
            // Determine Gradient Type and Parameters
            let isGradient = false;
            let isRadial = false;
            let angle = 0; // Default 0deg (Bottom -> Top)
            let stopTokens: string[] = [];

            // Helper to parse comma-separated values respecting parentheses
            const parseCommaSeparated = (str: string) => {
                const result: string[] = [];
                let buf = "";
                let pLevel = 0;
                for (let i = 0; i < str.length; i++) {
                    const char = str[i];
                    if (char === "(") pLevel++;
                    if (char === ")") pLevel--;
                    if (char === "," && pLevel === 0) {
                        result.push(buf.trim());
                        buf = "";
                    } else {
                        buf += char;
                    }
                }
                if (buf.trim()) result.push(buf.trim());
                return result;
            };

            const cleanConfig = gradientConfig.trim();
            const linearPrefix = "linear-gradient(";
            const radialPrefix = "radial-gradient(";
            let innerContent = "";

            if (cleanConfig.toLowerCase().startsWith(linearPrefix)) {
                isGradient = true;
                innerContent = cleanConfig.substring(linearPrefix.length, cleanConfig.lastIndexOf(")"));
            } else if (cleanConfig.toLowerCase().startsWith(radialPrefix)) {
                isGradient = true;
                isRadial = true;
                innerContent = cleanConfig.substring(radialPrefix.length, cleanConfig.lastIndexOf(")"));
            }

            if (isGradient && innerContent) {
                stopTokens = parseCommaSeparated(innerContent);
                if (stopTokens.length > 0) {
                    const first = stopTokens[0]!.toLowerCase().trim();
                    let isConfig = false;

                    if (!isRadial) {
                        if (first.match(/^(-?[\d.]+)(deg|rad|turn)$/) || first.startsWith("to ")) {
                            isConfig = true;
                            const angleMatch = first.match(/^(-?[\d.]+)(deg|rad|turn)$/);
                            if (angleMatch && angleMatch[1]) {
                                let val = parseFloat(angleMatch[1]);
                                const unit = angleMatch[2];
                                if (unit === "rad") val = (val * 180) / Math.PI;
                                if (unit === "turn") val = val * 360;
                                angle = val;
                            } else if (first.startsWith("to ")) {
                                const dir = first.slice(3).trim(); // remove "to "
                                const hasTop = dir.includes("top");
                                const hasBottom = dir.includes("bottom");
                                const hasLeft = dir.includes("left");
                                const hasRight = dir.includes("right");

                                // Map CSS-like directions to angles (0deg = top, then clockwise)
                                if (hasTop && hasRight) {
                                    angle = 45;
                                } else if (hasBottom && hasRight) {
                                    angle = 135;
                                } else if (hasBottom && hasLeft) {
                                    angle = 225;
                                } else if (hasTop && hasLeft) {
                                    angle = 315;
                                } else if (hasTop) {
                                    angle = 0;
                                } else if (hasRight) {
                                    angle = 90;
                                } else if (hasBottom) {
                                    angle = 180;
                                } else if (hasLeft) {
                                    angle = 270;
                                }
                            }
                        }
                    } else {
                        if (
                            first.includes("circle") ||
                            first.includes("ellipse") ||
                            first.startsWith("at ") ||
                            first.includes("closest-") ||
                            first.includes("farthest-")
                        ) {
                            isConfig = true;
                        }
                    }

                    if (isConfig) {
                        stopTokens.shift();
                    }
                }
            }

            if (isGradient) {
                // Parse Stops
                const stops: {color: string; pos: number | null}[] = [];

                stopTokens.forEach(token => {
                    const match = token.match(/(.*?)\s+(\d+(\.\d+)?)%$/);
                    if (match && match[1] && match[2]) {
                        stops.push({color: match[1].trim(), pos: parseFloat(match[2]) / 100});
                    } else {
                        // No percentage found
                        stops.push({color: token.trim(), pos: null});
                    }
                });

                if (stops.length > 0) {
                    const firstStop = stops[0];
                    if (firstStop && firstStop.pos === null) firstStop.pos = 0;

                    const lastStop = stops[stops.length - 1];
                    if (lastStop && lastStop.pos === null) lastStop.pos = 1;

                    let lastPosIndex = 0;
                    for (let i = 1; i < stops.length; i++) {
                        const currentStop = stops[i];
                        if (currentStop && currentStop.pos !== null) {
                            const startStop = stops[lastPosIndex];
                            const endStop = currentStop;

                            if (startStop && endStop && startStop.pos !== null && endStop.pos !== null) {
                                const startPos = startStop.pos;
                                const endPos = endStop.pos;
                                const steps = i - lastPosIndex;
                                for (let j = 1; j < steps; j++) {
                                    const target = stops[lastPosIndex + j];
                                    if (target) {
                                        target.pos = startPos + (endPos - startPos) * (j / steps);
                                    }
                                }
                            }
                            lastPosIndex = i;
                        }
                    }
                }

                // Create Texture
                const canvas = document.createElement("canvas");
                canvas.width = 1;
                canvas.height = 256;
                const ctx = canvas.getContext("2d");
                if (ctx) {
                    const grad = ctx.createLinearGradient(0, canvas.height, 0, 0);

                    stops.forEach(stop => {
                        if (stop) {
                            try {
                                grad.addColorStop(Math.max(0, Math.min(1, stop.pos || 0)), stop.color);
                            } catch {
                                // Ignore
                            }
                        }
                    });

                    ctx.fillStyle = grad;
                    ctx.fillRect(0, 0, 1, 256);

                    if (gradientMode === "3d") {
                        const size = 256;
                        const gradientData = ctx.getImageData(0, 0, 1, 256).data;

                        const getGradientColor = (yNorm: number) => {
                            // Map -1..1 to 0..1
                            const t = Math.max(0, Math.min(1, (yNorm + 1) / 2));
                            const idx = Math.floor(t * 255);
                            const offset = idx * 4;
                            return {
                                r: gradientData[offset] || 0,
                                g: gradientData[offset + 1] || 0,
                                b: gradientData[offset + 2] || 0,
                                a: gradientData[offset + 3] || 255,
                            };
                        };

                        const textures = [];
                        for (let i = 0; i < 6; i++) {
                            const c = document.createElement("canvas");
                            c.width = size;
                            c.height = size;
                            const cx = c.getContext("2d");
                            if (!cx) {
                                textures.push(c);
                                continue;
                            }

                            const imgData = cx.createImageData(size, size);
                            const data = imgData.data;

                            // Face indices: 0:px, 1:nx, 2:py(top), 3:ny(bot), 4:pz, 5:nz
                            const isYFace = i === 2 || i === 3;
                            // For PY(2), world Y is +1. For NY(3), world Y is -1.
                            // For others, world Y comes from texture v coordinate.

                            for (let y = 0; y < size; y++) {
                                // v goes from 1.0 (top) to -1.0 (bottom)
                                const v = 1.0 - (2.0 * y) / (size - 1);

                                for (let x = 0; x < size; x++) {
                                    // u goes from -1.0 (left) to 1.0 (right)
                                    const u = (2.0 * x) / (size - 1) - 1.0;

                                    // Calculate 3D direction vector length
                                    // All faces are at distance 1 from center in one axis, and u,v in others.
                                    // So dist^2 = 1^2 + u^2 + v^2
                                    const dist = Math.sqrt(1 + u * u + v * v);

                                    let yComp = 0;
                                    if (isYFace) {
                                        // Top or Bottom Face
                                        yComp = (i === 2 ? 1 : -1) / dist;
                                    } else {
                                        // Side Faces (PX, NX, PZ, NZ)
                                        // Local v maps to World Y
                                        yComp = v / dist;
                                    }

                                    const col = getGradientColor(-yComp);
                                    const pIdx = (y * size + x) * 4;
                                    data[pIdx] = col.r;
                                    data[pIdx + 1] = col.g;
                                    data[pIdx + 2] = col.b;
                                    data[pIdx + 3] = col.a ?? 255;
                                }
                            }
                            cx.putImageData(imgData, 0, 0);
                            textures.push(c);
                        }

                        const cubeTex = new CubeTexture(textures);
                        this.generatedGradientTexture = cubeTex;

                        cubeTex.colorSpace = SRGBColorSpace;
                        cubeTex.generateMipmaps = true;
                        cubeTex.minFilter = LinearMipmapLinearFilter;
                        cubeTex.magFilter = LinearFilter;
                        cubeTex.needsUpdate = true;

                        scene.background = cubeTex;
                        scene.environment = cubeTex;

                        const bgNode = cubeTexture(cubeTex, positionWorld);
                        if (this.currentFogSettings?.config.type === "height") {
                            this.applyFogToBackground(scene, bgNode, this.currentFogSettings.config);
                        } else {
                            sceneWithNodes.backgroundNode = null;
                        }

                        sceneWithNodes.environmentNode = bgNode;
                    } else {
                        scene.background = null;
                        scene.environment = null;

                        const texture = new CanvasTexture(canvas);
                        this.generatedGradientTexture = texture;
                        texture.colorSpace = SRGBColorSpace;
                        texture.minFilter = LinearFilter;
                        texture.magFilter = LinearFilter;
                        texture.generateMipmaps = false;

                        // Construct TSL Node
                        let uvNode;

                        if (isRadial) {
                            const center = vec2(0.5, 0.5);
                            const dist = screenUV.sub(center).length().mul(2.0);
                            uvNode = dist;
                        } else {
                            // Linear with angle
                            const rad = MathUtils.degToRad(angle);
                            const dirX = Math.sin(rad);
                            const dirY = Math.cos(rad);

                            const flippedUV = vec2(screenUV.x, float(1.0).sub(screenUV.y));

                            // Project screenUV - 0.5 onto direction vector
                            const projected = dot(flippedUV.sub(vec2(0.5)), vec2(dirX, dirY));

                            // Map -0.5..0.5 to 0..1
                            uvNode = projected.add(0.5);
                        }

                        const finalNode = textureNode(texture, vec2(0.5, uvNode));
                        sceneWithNodes.backgroundNode = finalNode;
                        sceneWithNodes.environmentNode = null;
                    }
                }
            } else {
                // Fallback to solid color if string is just a color
                sceneWithNodes.backgroundNode = null;
                scene.background = new Color(gradientConfig);
                sceneWithNodes.environmentNode = colorNode(new Color(gradientConfig));
            }
        } else {
            // No gradient config
            sceneWithNodes.backgroundNode = null;
            scene.background = new Color(0x222222);
            sceneWithNodes.environmentNode = colorNode(new Color(0x222222));
        }
        scene.backgroundIntensity = currentIntensity;
        scene.environmentIntensity = currentIntensity;
        scene.backgroundBlurriness = currentBlurriness;
    }

    private applyToneMappingSettings(renderer: WebGPURenderer | null, rendering: RenderingSettings): void {
        if (!renderer || !rendering.toneMapping) return;

        const {type, exposure} = rendering.toneMapping;
        const prev = this.currentToneMappingSettings;
        const shouldReload =
            !prev || prev.renderer !== renderer || prev.config.type !== type || prev.config.exposure !== exposure;

        if (!shouldReload) return;
        this.currentToneMappingSettings = {
            config: cloneJsonCompatible(rendering.toneMapping) as RenderingSettings["toneMapping"],
            renderer,
        };

        let mapping: number = NoToneMapping;
        switch (type) {
            case "Linear":
                mapping = LinearToneMapping;
                break;
            case "Reinhard":
                mapping = ReinhardToneMapping;
                break;
            case "Cineon":
                mapping = CineonToneMapping;
                break;
            case "ACESFilmic":
                mapping = ACESFilmicToneMapping;
                break;
            default:
                mapping = NoToneMapping;
        }

        renderer.toneMapping = mapping as ToneMapping;
        renderer.toneMappingExposure = exposure;
    }

    private applyShadowSettings(renderer: WebGPURenderer | null, rendering: RenderingSettings): void {
        if (!renderer) return;

        const currentShadowMapType =
            rendering.shadowMapType === undefined
                ? undefined
                : normalizeShadowMapType(rendering.shadowMapType);
        if (currentShadowMapType === undefined) return;

        const prev = this.currentShadowMapType;
        const shouldReload = !prev || prev.renderer !== renderer || prev.type !== currentShadowMapType;

        if (!shouldReload) return;
        this.currentShadowMapType = {
            type: currentShadowMapType,
            renderer,
        };

        renderer.shadowMap.type = currentShadowMapType as import("three").ShadowMapType;
    }
}

export default EnvironmentSettingsManager;
