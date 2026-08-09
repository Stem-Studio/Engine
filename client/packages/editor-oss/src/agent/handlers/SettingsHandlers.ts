import * as THREE from "three";
import {PCFShadowMap, PCFSoftShadowMap} from "three";

import {Asset, AssetType} from "@stem/network/api/asset";
import {updateSceneThumbnail} from "@stem/network/api/scene/thumbnail";
import {getAssetResolutionContext, resolveAssetRevisionId} from "../../asset-management/AssetResolutionContext";
import type {AssetRef} from "../../asset-management/AssetRef";
import EngineRuntime from "../../EngineRuntime";
import {
    normalizeBackgroundGradient,
    normalizeGradientMode,
    normalizeShadowMapType,
} from "../../utils/renderingSettingsNormalization";
import {cloneJsonCompatible} from "../../utils/cloneJsonCompatible";
import {findObjectByUuidOrNameDepthFirst} from "../../utils/SceneTraverser";
import {CommandResult} from "../types/ACPTypes";

// Default values matching the constants used in ProjectSettings
const DEFAULT_AMBIENT = {color: "#ffffff", intensity: 0};
const DEFAULT_HEMISPHERE = {skyColor: "#ffffff", groundColor: "#888888", intensity: 0};
const DEFAULT_FOG = {type: "none", color: "#aaaaaa", near: 5, far: 150, density: 0.011};
const DEFAULT_BACKGROUND = {
    type: "Color" as const,
    color: "#27272a",
    texture: "",
    cubemap: ["", "", "", "", "", ""] as [string, string, string, string, string, string],
    rotation: 0,
    intensity: 1,
    blurriness: 0,
    gradient: "linear-gradient(0deg, #3e4455 0%, #3e4455 65%, #4f576d 85%, #59677f 100%)",
    gradientMode: "2d" as const,
};
const DEFAULT_TONE_MAPPING = {type: "None", exposure: 1.0};
const DEFAULT_RENDERING = {
    shadowMapType: PCFShadowMap,
    ambient: {...DEFAULT_AMBIENT},
    hemisphere: {...DEFAULT_HEMISPHERE},
    fog: {...DEFAULT_FOG},
    background: {...DEFAULT_BACKGROUND},
    toneMapping: {...DEFAULT_TONE_MAPPING},
};

/**
 * Settings command handlers for CommandsRegistry.
 * Handles scene lighting, fog, background, tone mapping, post-processing,
 * camera settings, game settings, and rendering settings.
 *
 * Particle-system command reference is documented in:
 * docs/agent/settings-commands/particle-system/README.md
 */
export class SettingsHandlers {
    constructor(private engine: EngineRuntime) {}

    /**
     * Resolves a background image source to the value that should be PERSISTED
     * in the scene's rendering config: the original source string (a literal
     * URL/path, or the asset name) plus, when it names a scene image asset, the
     * stable {@link AssetRef} for that asset.
     *
     * Crucially this never returns a `blob:` object URL. The old code persisted
     * `URL.createObjectURL(blob)` as the background texture, which is the cause
     * of the "scene goes dark on reload" bug: object URLs are revoked when the
     * page reloads, so the saved background/environment texture could no longer
     * be fetched — the scene lost both its skybox and its image-based
     * environment lighting, and the loader logged "Failed to load texture:
     * blob:…". The AssetRef is what survives a reload;
     * {@link EnvironmentSettingsManager.applyBackgroundSettings} prefers it and
     * re-fetches the texture through the asset loader.
     */
    private async resolveImageAsset(source?: string): Promise<{value?: string; assetRef?: AssetRef}> {
        if (!source) return {value: source};
        if (
            source.startsWith("http://")
            || source.startsWith("https://")
            || source.startsWith("data:")
            || source.startsWith("blob:")
            || source.startsWith("/")
        ) {
            return {value: source};
        }

        const assetSource = this.engine.editor?.assetSource;
        if (!assetSource) {
            return {value: source};
        }

        const {assets} = await assetSource.getAssets({types: [AssetType.Image]});
        const match = assets?.find((asset: Asset) => asset.name.toLowerCase() === source.toLowerCase());
        if (!match) {
            return {value: source};
        }

        const context = getAssetResolutionContext(this.engine.scene);
        const revisionId = context ? resolveAssetRevisionId(match.id, context) : undefined;
        const finalRevisionId = revisionId || match.headRevisionId;
        // Keep the human-readable source (the asset name) as the persisted
        // `texture` value; the AssetRef is the durable handle used to re-fetch.
        return {value: source, assetRef: {assetId: match.id, revisionId: finalRevisionId}};
    }

    /**
     * Scene-level settings (lighting, fog, background, tone mapping, post-processing,
     * game rules, rendering flags) are stored on the scene document in the database.
     * In stem-editor mode there is no scene document — the scene is an ephemeral
     * in-memory container for editing a single stem — so these settings don't
     * persist and aren't meaningful. Return a specific error so the agent knows to
     * pivot rather than retry.
     * @param featureName Human-readable name of the setting being written.
     */
    private requireSceneMode(featureName: string): CommandResult | null {
        if (this.engine.editor?.assetSource?.kind === "stem") {
            return {
                status: "failed",
                message: `${featureName} is a scene-level setting and isn't available when editing a stem. These settings only apply to full scenes.`,
            };
        }
        return null;
    }

    async handleSetSceneLighting({
        ambient,
        hemisphere,
        shadows,
    }: {
        ambient?: {color?: string; intensity?: number};
        hemisphere?: {skyColor?: string; groundColor?: string; intensity?: number};
        shadows?: {enabled?: boolean; mapType?: unknown};
    }): Promise<CommandResult> {
        const stemGuard = this.requireSceneMode("Scene lighting");
        if (stemGuard) return stemGuard;

        const editor = this.engine.editor;
        const scene = editor?.scene;
        if (!scene) {
            return {status: "failed", message: "Editor scene not available"};
        }

        this.ensureGameAndRendering(scene);

        if (ambient) {
            const current = scene.userData.rendering.ambient || {...DEFAULT_AMBIENT};
            scene.userData.rendering.ambient = {
                color: ambient.color ?? current.color,
                intensity: ambient.intensity ?? current.intensity,
            };
        }

        if (hemisphere) {
            const current = scene.userData.rendering.hemisphere || {...DEFAULT_HEMISPHERE};
            scene.userData.rendering.hemisphere = {
                skyColor: hemisphere.skyColor ?? current.skyColor,
                groundColor: hemisphere.groundColor ?? current.groundColor,
                intensity: hemisphere.intensity ?? current.intensity,
            };
        }

        if (shadows) {
            if (shadows.enabled !== undefined) {
                scene.userData.game.useShadows = shadows.enabled;
            }
            if (shadows.mapType !== undefined) {
                scene.userData.rendering.shadowMapType = normalizeShadowMapType(
                    shadows.mapType,
                    scene.userData.rendering.shadowMapType,
                );
            }
        }

        await this.engine.environmentManager?.updateEnvironmentSettings({
            ambient: scene.userData.rendering.ambient,
            hemisphere: scene.userData.rendering.hemisphere,
            ...(shadows?.mapType !== undefined ? {shadowMapType: scene.userData.rendering.shadowMapType} : {}),
        });

        this.engine.call("objectChanged", editor, scene);

        return {
            status: "success",
            message: "Scene lighting updated successfully",
            data: {
                ambient: scene.userData.rendering.ambient,
                hemisphere: scene.userData.rendering.hemisphere,
                useShadows: scene.userData.game.useShadows,
                shadowMapType: scene.userData.rendering.shadowMapType,
            },
        };
    }

    async handleSetSceneFog({
        type,
        color,
        near,
        far,
        density,
    }: {
        type: string;
        color?: string;
        near?: number;
        far?: number;
        density?: number;
    }): Promise<CommandResult> {
        const stemGuard = this.requireSceneMode("Scene fog");
        if (stemGuard) return stemGuard;

        const editor = this.engine.editor;
        const scene = editor?.scene;
        if (!scene) {
            return {status: "failed", message: "Editor scene not available"};
        }

        this.ensureGameAndRendering(scene);

        const current = scene.userData.rendering.fog || {...DEFAULT_FOG};
        scene.userData.rendering.fog = {
            type: type ?? current.type,
            color: color ?? current.color,
            near: near ?? current.near,
            far: far ?? current.far,
            density: density ?? current.density,
        };

        await this.engine.environmentManager?.updateEnvironmentSettings({
            fog: scene.userData.rendering.fog,
        });

        this.engine.call("objectChanged", editor, scene);

        return {
            status: "success",
            message: "Scene fog updated successfully",
            data: scene.userData.rendering.fog,
        };
    }

    async handleSetSceneBackground({
        type,
        color,
        texture,
        cubemap,
        gradient,
        gradientMode,
        rotation,
        intensity,
        blurriness,
    }: {
        type: string;
        color?: string;
        texture?: string;
        cubemap?: string[];
        gradient?: unknown;
        gradientMode?: unknown;
        rotation?: number;
        intensity?: number;
        blurriness?: number;
    }): Promise<CommandResult> {
        const stemGuard = this.requireSceneMode("Scene background");
        if (stemGuard) return stemGuard;

        const editor = this.engine.editor;
        const scene = editor?.scene;
        if (!scene) {
            return {status: "failed", message: "Editor scene not available"};
        }

        this.ensureGameAndRendering(scene);

        const current = scene.userData.rendering.background || {...DEFAULT_BACKGROUND};
        const normalizedGradient = normalizeBackgroundGradient(gradient, current.gradient);
        const normalizedGradientMode = normalizeGradientMode(gradientMode, current.gradientMode);
        // Resolve to a displayable URL AND a stable AssetRef. The AssetRef is
        // what survives a reload (the `blob:` URL does not), so persisting it
        // keeps the skybox + environment lighting after the project is saved
        // and reopened.
        const resolvedTexture = texture ? await this.resolveImageAsset(texture) : undefined;
        const resolvedCubemap = cubemap
            ? await Promise.all(cubemap.map(face => this.resolveImageAsset(face)))
            : undefined;
        scene.userData.rendering.background = {
            ...current,
            type: type ?? current.type,
            color: color ?? current.color,
            texture: resolvedTexture?.value ?? current.texture,
            textureAsset: texture ? resolvedTexture?.assetRef : current.textureAsset,
            cubemap: resolvedCubemap
                ? (resolvedCubemap.map(face => face.value ?? "") as [string, string, string, string, string, string])
                : current.cubemap,
            cubemapAssets: resolvedCubemap
                ? resolvedCubemap.map(face => face.assetRef)
                : current.cubemapAssets,
            gradient: normalizedGradient,
            gradientMode: normalizedGradientMode,
            rotation: rotation ?? current.rotation,
            intensity: intensity ?? current.intensity,
            blurriness: blurriness ?? current.blurriness,
        };

        await this.engine.environmentManager?.updateEnvironmentSettings({
            background: scene.userData.rendering.background,
        });

        this.engine.call("objectChanged", editor, scene);

        return {
            status: "success",
            message: "Scene background updated successfully",
            data: scene.userData.rendering.background,
        };
    }

    async handleSetToneMapping({
        type,
        exposure,
    }: {
        type: string;
        exposure?: number;
    }): Promise<CommandResult> {
        const stemGuard = this.requireSceneMode("Tone mapping");
        if (stemGuard) return stemGuard;

        const editor = this.engine.editor;
        const scene = editor?.scene;
        if (!scene) {
            return {status: "failed", message: "Editor scene not available"};
        }

        this.ensureGameAndRendering(scene);

        const current = scene.userData.rendering.toneMapping || {...DEFAULT_TONE_MAPPING};
        scene.userData.rendering.toneMapping = {
            type: type ?? current.type,
            exposure: exposure ?? current.exposure,
        };

        await this.engine.environmentManager?.updateEnvironmentSettings({
            toneMapping: scene.userData.rendering.toneMapping,
        });

        this.engine.call("objectChanged", editor, scene);

        return {
            status: "success",
            message: "Tone mapping updated successfully",
            data: scene.userData.rendering.toneMapping,
        };
    }

    handleSetPostProcessing({
        ao,
        bloom,
        ssr,
        dof,
        outline,
    }: {
        ao?: Record<string, any>;
        bloom?: Record<string, any>;
        ssr?: Record<string, any>;
        dof?: Record<string, any>;
        outline?: Record<string, any>;
    }): CommandResult {
        const stemGuard = this.requireSceneMode("Post-processing");
        if (stemGuard) return stemGuard;

        const editor = this.engine.editor;
        const scene = editor?.scene;
        if (!scene) {
            return {status: "failed", message: "Editor scene not available"};
        }

        if (!scene.userData) {
            scene.userData = {};
        }

        const current = scene.userData.postProcessing || {};

        if (ao) current.ao = {...current.ao || {}, ...ao};
        if (bloom) current.bloom = {...current.bloom || {}, ...bloom};
        if (ssr) current.ssr = {...current.ssr || {}, ...ssr};
        if (dof) current.dof = {...current.dof || {}, ...dof};
        if (outline) current.outline = {...current.outline || {}, ...outline};

        scene.userData.postProcessing = current;

        this.engine.call("objectChanged", editor, scene);
        this.engine.call("postProcessingChanged", editor, scene);

        return {
            status: "success",
            message: "Post-processing settings updated successfully",
            data: scene.userData.postProcessing,
        };
    }

    handleSetCameraSettings({
        target,
        fov,
        near,
        far,
        cameraType,
        defaultDistance,
        minDistance,
        maxDistance,
        headHeight,
        axis,
        occlusionType,
    }: {
        target: string;
        fov?: number;
        near?: number;
        far?: number;
        cameraType?: string;
        defaultDistance?: number;
        minDistance?: number;
        maxDistance?: number;
        headHeight?: number;
        axis?: string;
        occlusionType?: string;
    }): CommandResult {
        const stemGuard = this.requireSceneMode("Camera settings");
        if (stemGuard) return stemGuard;

        const editor = this.engine.editor;
        if (!editor) {
            return {status: "failed", message: "Editor not available"};
        }

        const object = this.findObject(target);
        if (!object) {
            return {status: "failed", message: `Object not found: ${target}`};
        }

        if (!(object as any).isCamera) {
            return {
                status: "failed",
                message: `"${target}" is not a camera object. Use "DefaultCamera" or another camera in the scene.`,
            };
        }

        if (!object.userData) {
            object.userData = {};
        }

        const current = object.userData.cameraData || {};
        const config: Record<string, any> = {...current};

        if (fov !== undefined) config.cameraFOV = fov;
        if (near !== undefined) config.cameraNear = near;
        if (far !== undefined) config.cameraFar = far;
        if (cameraType !== undefined) config.cameraType = cameraType;
        if (defaultDistance !== undefined) config.cameraDefaultDistance = defaultDistance;
        if (minDistance !== undefined) config.cameraMinDistance = minDistance;
        if (maxDistance !== undefined) config.cameraMaxDistance = maxDistance;
        if (headHeight !== undefined) config.cameraHeadHeight = headHeight;
        if (axis !== undefined) config.cameraAxis = axis;
        if (occlusionType !== undefined) config.occlusionType = occlusionType;

        object.userData.cameraData = config;

        // Apply projection settings directly to the camera (matches CameraPanel behavior)
        const cam = object as THREE.PerspectiveCamera;
        if (cam.isPerspectiveCamera) {
            let projChanged = false;
            if (config.cameraFOV !== undefined && cam.fov !== config.cameraFOV) {
                cam.fov = config.cameraFOV;
                projChanged = true;
            }
            if (config.cameraNear !== undefined && cam.near !== config.cameraNear) {
                cam.near = config.cameraNear;
                projChanged = true;
            }
            if (config.cameraFar !== undefined && cam.far !== config.cameraFar) {
                cam.far = config.cameraFar;
                projChanged = true;
            }
            if (projChanged) {
                cam.updateProjectionMatrix();
            }
        }

        this.engine.call("objectChanged", editor, object);

        return {
            status: "success",
            message: `Camera settings updated on "${object.name}" successfully`,
            data: object.userData.cameraData,
        };
    }

    handleGetCameraSettings({target}: {target: string}): CommandResult {
        const object = this.findObject(target);
        if (!object) {
            return {status: "failed", message: `Object not found: ${target}`, data: null};
        }

        if (!(object as any).isCamera) {
            return {
                status: "failed",
                message: `"${target}" is not a camera object. Use "DefaultCamera" or another camera in the scene.`,
                data: null,
            };
        }

        const camera = object as THREE.Camera & Partial<THREE.PerspectiveCamera>;
        const cameraData = object.userData?.cameraData || {};

        return {
            status: "success",
            message: `Camera settings for "${object.name || target}" retrieved successfully`,
            data: {
                uuid: object.uuid,
                name: object.name,
                type: object.type,
                fov: cameraData.cameraFOV ?? camera.fov,
                near: cameraData.cameraNear ?? camera.near,
                far: cameraData.cameraFar ?? camera.far,
                cameraType: cameraData.cameraType,
                defaultDistance: cameraData.cameraDefaultDistance,
                minDistance: cameraData.cameraMinDistance,
                maxDistance: cameraData.cameraMaxDistance,
                headHeight: cameraData.cameraHeadHeight,
                axis: cameraData.cameraAxis,
                occlusionType: cameraData.occlusionType,
                projection: {
                    fov: camera.fov,
                    near: camera.near,
                    far: camera.far,
                    aspect: camera.aspect,
                },
                cameraData: this.clonePlainValue(cameraData),
            },
        };
    }

    handleSetGameSettings({
        isGame,
        enabled,
        lives,
        maxScore,
        timer,
        useAvatar,
        isMultiplayer,
        showHUD,
        isSandbox,
        voiceChatEnabled,
    }: {
        isGame?: boolean;
        enabled?: boolean;
        lives?: number;
        maxScore?: number;
        timer?: number;
        useAvatar?: boolean;
        isMultiplayer?: boolean;
        showHUD?: boolean;
        isSandbox?: boolean;
        voiceChatEnabled?: boolean;
    }): CommandResult {
        const stemGuard = this.requireSceneMode("Game settings (HUD, lives, multiplayer, etc.)");
        if (stemGuard) return stemGuard;

        const editor = this.engine.editor;
        const scene = editor?.scene;
        if (!scene) {
            return {status: "failed", message: "Editor scene not available"};
        }

        this.ensureGameAndRendering(scene, {defaultGameEnabled: true});
        const game = scene.userData.game;

        const nextIsGame = isGame ?? enabled;
        if (nextIsGame !== undefined) game.isGame = nextIsGame;
        if (lives !== undefined) game.lives = lives;
        if (maxScore !== undefined) game.maxScore = maxScore;
        if (timer !== undefined) game.timer = timer;
        if (useAvatar !== undefined) game.useAvatar = useAvatar;
        if (isMultiplayer !== undefined) game.isMultiplayer = isMultiplayer;
        if (showHUD !== undefined) game.showHUD = showHUD;
        if (isSandbox !== undefined) game.isSandbox = isSandbox;
        if (voiceChatEnabled !== undefined) game.voiceChatEnabled = voiceChatEnabled;

        this.engine.call("objectChanged", editor, scene);

        return {
            status: "success",
            message: "Game settings updated successfully",
            data: {
                isGame: game.isGame,
                lives: game.lives,
                maxScore: game.maxScore,
                timer: game.timer,
                useAvatar: game.useAvatar,
                isMultiplayer: game.isMultiplayer,
                showHUD: game.showHUD,
                isSandbox: game.isSandbox,
                voiceChatEnabled: game.voiceChatEnabled,
            },
        };
    }

    handleSetProjectTitle({title}: {title: string}): CommandResult {
        const stemGuard = this.requireSceneMode("Project title");
        if (stemGuard) return stemGuard;

        const editor = this.engine.editor;
        if (!editor) {
            return {status: "failed", message: "Editor not available"};
        }

        editor.sceneName = title;
        this.engine.call("sceneNameUpdated");
        this.engine.call("objectChanged", editor, editor.scene);

        return {
            status: "success",
            message: `Project title set to "${title}"`,
            data: {title},
        };
    }

    /**
     * Set the scene's Thumbnail metadata field from an image asset already
     * declared in the scene library. The image must have been imported earlier
     * via `import image name="<name>" filepath="..."` so the asset exists in
     * the scene's asset list.
     *
     * Resolves the image asset by name → fetches its signed CDN URL via
     * AssetLoader.getImageDataUrl → calls updateSceneThumbnail(sceneId, sceneName, url)
     * which PATCHes the Thumbnail field on the scene record. Also writes the
     * URL into SceneConfig.sceneThumbnail so the editor reflects it immediately.
     *
     * Returns failure (does not throw) when:
     *   - in stem mode (no scene record to mutate)
     *   - sceneID/sceneName not yet assigned (scene unsaved)
     *   - `name` parameter missing
     *   - asset with that name not found in the scene library
     */
    async handleSetSceneThumbnail({name}: {name?: string}): Promise<CommandResult> {
        const stemGuard = this.requireSceneMode("Set scene thumbnail");
        if (stemGuard) return stemGuard;

        const editor = this.engine.editor;
        if (!editor) {
            return {status: "failed", message: "Editor not available"};
        }
        const sceneId = editor.sceneID;
        const sceneName = editor.sceneName;
        if (!sceneId || !sceneName) {
            return {
                status: "failed",
                message: "Cannot set scene thumbnail: scene ID/name not assigned (save the scene first).",
            };
        }
        if (!name) {
            return {
                status: "failed",
                message: "set_scene_thumbnail requires `name` — the image asset name to use as the thumbnail.",
            };
        }

        const assetSource = editor.assetSource;
        if (!assetSource) {
            return {status: "failed", message: "No asset source available for image lookup."};
        }

        const {assets} = await assetSource.getAssets({types: [AssetType.Image]});
        const match = assets?.find((a: Asset) => a.name.toLowerCase() === name.toLowerCase());
        if (!match) {
            return {
                status: "failed",
                message: `Image asset "${name}" not found in scene library — declare it first with \`import image name="${name}" filepath="..."\`.`,
            };
        }

        const ref = {assetId: match.id, revisionId: match.revisionId || match.headRevisionId};

        let url: string;
        try {
            const result = await this.engine.assetLoader.getImageDataUrl(ref);
            url = result.url;
        } catch (e) {
            return {
                status: "failed",
                message: `Failed to resolve image URL for asset "${name}": ${e instanceof Error ? e.message : String(e)}`,
            };
        }

        try {
            await updateSceneThumbnail(sceneId, sceneName, url);
        } catch (e) {
            return {
                status: "failed",
                message: `Failed to update scene thumbnail metadata: ${e instanceof Error ? e.message : String(e)}`,
            };
        }

        // Reflect the change locally so the editor UI updates without a reload.
        if (editor.sceneConfig) {
            editor.sceneConfig.sceneThumbnail = url;
        }

        return {
            status: "success",
            message: `Scene thumbnail set from image asset "${match.name}".`,
            data: {thumbnailUrl: url, assetName: match.name},
        };
    }

    /**
     * Toggle the scene-level SES compartment sandbox for behavior/lambda scripts.
     * Writes scene.userData.compartmentsEnabled. Disabled by default (DOT-7463).
     * Takes effect at next scene load. Accepts boolean, "on"/"off", or "true"/"false".
     * @param root0
     * @param root0.enabled
     */
    handleSetSceneCompartments({enabled}: {enabled: unknown}): CommandResult {
        const editor = this.engine.editor;
        const scene = editor?.scene;
        if (!scene) {
            return {status: "failed", message: "Editor scene not available"};
        }

        let coerced: boolean | null = null;
        if (typeof enabled === "boolean") {
            coerced = enabled;
        } else if (typeof enabled === "string") {
            const lower = enabled.trim().toLowerCase();
            if (lower === "on" || lower === "true" || lower === "1") coerced = true;
            else if (lower === "off" || lower === "false" || lower === "0") coerced = false;
        }

        if (coerced === null) {
            return {
                status: "failed",
                message: `Invalid compartments value "${String(enabled)}": must be on/off or true/false.`,
            };
        }

        scene.userData.compartmentsEnabled = coerced;
        this.engine.call("objectChanged", editor, scene);

        return {
            status: "success",
            message: `Scene compartments ${coerced ? "enabled" : "disabled"} (takes effect on next scene load)`,
            data: {compartmentsEnabled: coerced},
        };
    }

    async handleSetRenderingSettings({
        useShadows,
        useInstancing,
        shadowMapType,
        usePhysicsWorker,
    }: {
        useShadows?: boolean;
        useInstancing?: boolean;
        shadowMapType?: unknown;
        usePhysicsWorker?: boolean;
    }): Promise<CommandResult> {
        const stemGuard = this.requireSceneMode("Rendering settings");
        if (stemGuard) return stemGuard;

        const editor = this.engine.editor;
        const scene = editor?.scene;
        if (!scene) {
            return {status: "failed", message: "Editor scene not available"};
        }

        this.ensureGameAndRendering(scene);
        const game = scene.userData.game;
        const normalizedShadowMapType =
            shadowMapType !== undefined
                ? normalizeShadowMapType(shadowMapType, scene.userData.rendering.shadowMapType)
                : undefined;

        if (useShadows !== undefined) game.useShadows = useShadows;
        if (useInstancing !== undefined) game.useInstancing = useInstancing;
        if (normalizedShadowMapType !== undefined) scene.userData.rendering.shadowMapType = normalizedShadowMapType;
        if (usePhysicsWorker !== undefined) game.usePhysicsWorker = usePhysicsWorker;

        if (normalizedShadowMapType !== undefined) {
            await this.engine.environmentManager?.updateEnvironmentSettings({
                shadowMapType: scene.userData.rendering.shadowMapType,
            });
        }

        this.engine.call("objectChanged", editor, scene);

        return {
            status: "success",
            message: "Rendering settings updated successfully",
            data: {
                useShadows: game.useShadows,
                useInstancing: game.useInstancing,
                shadowMapType: scene.userData.rendering.shadowMapType,
                usePhysicsWorker: game.usePhysicsWorker,
            },
        };
    }

    handleGetSceneSetting({category = "all"}: {category?: string}): CommandResult {
        const editor = this.engine.editor;
        const scene = editor?.scene;
        if (!scene) {
            return {status: "failed", message: "Editor scene not available", data: null};
        }

        this.ensureGameAndRendering(scene);

        const normalizedCategory = category.trim().toLowerCase();
        const game = scene.userData?.game || {};
        const rendering = scene.userData?.rendering || {};
        const postProcessing = scene.userData?.postProcessing || {};
        let data: Record<string, any>;

        switch (normalizedCategory) {
            case "lighting":
                data = {
                    ambient: rendering.ambient || DEFAULT_AMBIENT,
                    hemisphere: rendering.hemisphere || DEFAULT_HEMISPHERE,
                    useShadows: game.useShadows ?? false,
                    shadowMapType: rendering.shadowMapType ?? PCFSoftShadowMap,
                };
                break;
            case "fog":
                data = rendering.fog || DEFAULT_FOG;
                break;
            case "background":
                data = rendering.background || DEFAULT_BACKGROUND;
                break;
            case "tonemapping":
            case "toneMapping":
            case "tone_mapping":
                data = rendering.toneMapping || DEFAULT_TONE_MAPPING;
                break;
            case "postprocessing":
            case "postProcessing":
            case "post_processing":
                data = postProcessing;
                break;
            case "outline":
            case "bloom":
            case "ao":
            case "dof":
                data = postProcessing[normalizedCategory] || {};
                break;
            case "game":
                data = {
                    isGame: game.isGame ?? game.enabled ?? false,
                    lives: game.lives ?? 0,
                    maxScore: game.maxScore ?? 0,
                    timer: game.timer ?? 0,
                    useAvatar: game.useAvatar ?? false,
                    isMultiplayer: game.isMultiplayer ?? false,
                    showHUD: game.showHUD ?? false,
                    isSandbox: game.isSandbox ?? false,
                    voiceChatEnabled: game.voiceChatEnabled ?? false,
                };
                break;
            case "rendering":
                data = {
                    useShadows: game.useShadows ?? false,
                    useInstancing: game.useInstancing ?? false,
                    shadowMapType: rendering.shadowMapType ?? PCFSoftShadowMap,
                    usePhysicsWorker: game.usePhysicsWorker ?? false,
                };
                break;
            case "physics":
                data = this.clonePlainValue(scene.userData?.physics || {});
                break;
            case "compartments":
                data = {compartmentsEnabled: scene.userData?.compartmentsEnabled ?? false};
                break;
            case "project":
                data = {title: editor.sceneName};
                break;
            case "all": {
                const allResult = this.handleGetEditorSettings({category: "all"});
                data = {
                    ...(allResult.data || {}),
                    physics: scene.userData?.physics || {},
                    compartments: {compartmentsEnabled: scene.userData?.compartmentsEnabled ?? false},
                    project: {title: editor.sceneName},
                };
                break;
            }
            default:
                return {
                    status: "failed",
                    message:
                        `Unknown scene setting category: ${category}. Valid: lighting, fog, background, toneMapping, postProcessing, outline, bloom, ao, dof, game, rendering, physics, compartments, project, all`,
                    data: null,
                };
        }

        return {
            status: "success",
            message: `Scene setting "${category}" retrieved successfully`,
            data,
        };
    }

    handleGetEditorSettings({
        category = "all",
    }: {
        category?: string;
    }): CommandResult {
        const editor = this.engine.editor;
        const scene = editor?.scene;
        if (!scene) {
            return {status: "failed", message: "Editor scene not available"};
        }

        this.ensureGameAndRendering(scene);

        const game = scene.userData?.game || {};
        const rendering = scene.userData?.rendering || {};
        let data: Record<string, any>;

        switch (category) {
            case "lighting":
                data = {
                    ambient: rendering.ambient || DEFAULT_AMBIENT,
                    hemisphere: rendering.hemisphere || DEFAULT_HEMISPHERE,
                    useShadows: game.useShadows ?? false,
                    shadowMapType: rendering.shadowMapType ?? PCFSoftShadowMap,
                };
                break;
            case "fog":
                data = rendering.fog || DEFAULT_FOG;
                break;
            case "background":
                data = rendering.background || DEFAULT_BACKGROUND;
                break;
            case "toneMapping":
                data = rendering.toneMapping || DEFAULT_TONE_MAPPING;
                break;
            case "postProcessing":
                data = scene.userData?.postProcessing || {};
                break;
            case "game":
                data = {
                    isGame: game.isGame ?? game.enabled ?? false,
                    lives: game.lives ?? 0,
                    maxScore: game.maxScore ?? 0,
                    timer: game.timer ?? 0,
                    useAvatar: game.useAvatar ?? false,
                    isMultiplayer: game.isMultiplayer ?? false,
                    showHUD: game.showHUD ?? false,
                    isSandbox: game.isSandbox ?? false,
                    voiceChatEnabled: game.voiceChatEnabled ?? false,
                };
                break;
            case "rendering":
                data = {
                    useShadows: game.useShadows ?? false,
                    useInstancing: game.useInstancing ?? false,
                    shadowMapType: rendering.shadowMapType ?? PCFSoftShadowMap,
                    usePhysicsWorker: game.usePhysicsWorker ?? false,
                };
                break;
            case "all":
                data = {
                    lighting: {
                        ambient: rendering.ambient || DEFAULT_AMBIENT,
                        hemisphere: rendering.hemisphere || DEFAULT_HEMISPHERE,
                        useShadows: game.useShadows ?? false,
                        shadowMapType: rendering.shadowMapType ?? PCFSoftShadowMap,
                    },
                    fog: rendering.fog || DEFAULT_FOG,
                    background: rendering.background || DEFAULT_BACKGROUND,
                    toneMapping: rendering.toneMapping || DEFAULT_TONE_MAPPING,
                    postProcessing: scene.userData?.postProcessing || {},
                    game: {
                        isGame: game.isGame ?? game.enabled ?? false,
                        lives: game.lives ?? 0,
                        maxScore: game.maxScore ?? 0,
                        timer: game.timer ?? 0,
                        useAvatar: game.useAvatar ?? false,
                        isMultiplayer: game.isMultiplayer ?? false,
                        showHUD: game.showHUD ?? false,
                        isSandbox: game.isSandbox ?? false,
                        voiceChatEnabled: game.voiceChatEnabled ?? false,
                    },
                    rendering: {
                        useShadows: game.useShadows ?? false,
                        useInstancing: game.useInstancing ?? false,
                        shadowMapType: rendering.shadowMapType ?? PCFSoftShadowMap,
                        usePhysicsWorker: game.usePhysicsWorker ?? false,
                    },
                };
                break;
            default:
                return {
                    status: "failed",
                    message: `Unknown category: ${category}. Valid: lighting, fog, background, toneMapping, postProcessing, game, rendering, all`,
                };
        }

        return {
            status: "success",
            message: `Editor settings for "${category}" retrieved successfully`,
            data,
        };
    }

    private ensureGameAndRendering(
        scene: THREE.Object3D,
        options: {defaultGameEnabled?: boolean} = {},
    ): void {
        if (!scene.userData) scene.userData = {};
        const currentGame =
            scene.userData.game && typeof scene.userData.game === "object"
                ? scene.userData.game
                : {};
        const {enabled: legacyEnabled, ...gameSettings} = currentGame;
        scene.userData.game = {
            ...gameSettings,
            uuid: gameSettings.uuid || THREE.MathUtils.generateUUID(),
            isGame: gameSettings.isGame ?? legacyEnabled ?? options.defaultGameEnabled ?? false,
            lives: gameSettings.lives ?? 3,
            maxScore: gameSettings.maxScore ?? 500,
            timer: gameSettings.timer ?? 200,
        };
        if (!scene.userData.rendering) {
            scene.userData.rendering = {...DEFAULT_RENDERING};
        }

        const rendering = scene.userData.rendering;
        rendering.shadowMapType = normalizeShadowMapType(rendering.shadowMapType, DEFAULT_RENDERING.shadowMapType);

        const currentBackground = rendering.background || {...DEFAULT_BACKGROUND};
        rendering.background = {
            ...DEFAULT_BACKGROUND,
            ...currentBackground,
            gradient: normalizeBackgroundGradient(currentBackground.gradient, DEFAULT_BACKGROUND.gradient),
            gradientMode: normalizeGradientMode(currentBackground.gradientMode, DEFAULT_BACKGROUND.gradientMode),
        };
    }

    private findObject(identifier: string): THREE.Object3D | null {
        const defaultCamera = this.engine.camera;
        if (
            defaultCamera &&
            (defaultCamera.uuid === identifier || defaultCamera.name === identifier || identifier === "DefaultCamera")
        ) {
            return defaultCamera;
        }

        const scene = this.engine.editor?.scene;
        if (!scene) return null;
        return findObjectByUuidOrNameDepthFirst(scene, identifier);
    }

    private clonePlainValue<T>(value: T): T {
        if (value === undefined || value === null) {
            return value;
        }

        try {
            return cloneJsonCompatible(value);
        } catch {
            return value;
        }
    }
}
