import {PCFShadowMap, Vector2} from "three";

import {createScene, createSceneRevision, publishScene, unpublishScene, updateScene} from "./v2";
import {isAssetRef, type AssetRef} from "@web-shared/asset-management/AssetRef";
import {emptyAssetResolutionContext, getAssetResolutionContext} from "@web-shared/asset-management/AssetResolutionContext";
import {
    getActiveCopilotPreviewPersistence,
    isCopilotPreviewSceneSaveBlocked,
} from "@web-shared/agent/copilotPreviewPersistence";
import {FileData} from "@stem/editor-oss/editor/assets/v2/types/file";
import type Editor from "@stem/editor-oss/editor/Editor";
import global from "@web-shared/global";
import {OSS_LOCAL_USER_ID} from "@web-shared/ossUser";
import {showToast} from "@web-shared/showToast";
import type {HUDRendererMode, RenderingSettings} from "@web-shared/types/GameSettingsTypes";
import Ajax from "@web-shared/utils/Ajax";
import {
    normalizeBackgroundGradient,
    normalizeGradientMode,
    normalizeShadowMapType,
} from "@web-shared/utils/renderingSettingsNormalization";
import TimeUtils from "@web-shared/utils/TimeUtils";
import {backendUrlFromPath} from "@web-shared/utils/UrlUtils";
import {isNoChangesError} from "../asset";
import {getSceneSaveHandler, setSceneSaveHandler, type SceneSaveHandler} from "./saveHandler";

export {setSceneSaveHandler};
export type {SceneSaveHandler};

export interface RenderingSettingsAPI {
    ShadowMapType?: number;
    Ambient?: {Color: string; Intensity: number};
    Hemisphere?: {SkyColor: string; GroundColor: string; Intensity: number};
    Fog?: {Type: string; Color: string; Near?: number; Far?: number; Density?: number};
    Background?: {
        Type?: string;
        Color: string;
        Texture?: string;
        TextureAsset?: AssetRef;
        Cubemap?: string[];
        CubemapAssets?: Array<AssetRef | null>;
        Gradient?: string;
        GradientMode?: string;
        Rotation?: number;
        Intensity?: number;
        Blurriness?: number;
    };
    ToneMapping?: {Type: string; Exposure: number};
}

export interface SceneSettings {
    ID?: string;
    Name?: string;
    Alias?: string;
    LockedItems?: string;
    Thumbnail?: string;
    IsMultiplayer?: boolean;
    MultiplayerAutoJoin?: boolean;
    MaxMultiplayerClientsPerRoom?: number;
    IsSandbox?: boolean;
    IsCollaborative?: boolean;
    MaxCollaboratorsInRoom?: number;
    AssetsCount?: boolean;
    ShowHUD?: boolean;
    HUDRenderer?: HUDRendererMode;
    ShowStats?: boolean;
    UseInstancing?: boolean;
    VoiceChatEnabled?: boolean;
    IsAssetPack?: boolean;
    IsTopPick?: boolean;
    IsPublic?: boolean;
    IsCloneable?: boolean;
    IsPublished?: boolean;
    Description?: string;
    Tags?: string[];
    Rendering?: RenderingSettingsAPI;
    UseAvatar?: boolean;
    AllowAnonymousFirebase?: boolean;
    VFXOnMobile?: boolean;
    ProductionMode?: boolean;
    CompartmentsEnabled?: boolean;
    MajorVersion?: number;
    MinorVersion?: number;
    // A map from asset ID -> revision ID
    Dependencies?: Record<string, string>;
}

export interface PaginatedScenesResponse {
    Scenes: FileData[];
    TotalCount: number;
    Page: number;
    Limit: number;
    HasMore: boolean;
}

function emptyPaginatedScenesResponse(params?: FetchScenesParams): PaginatedScenesResponse {
    return {
        Scenes: [],
        TotalCount: 0,
        Page: params?.page ?? 1,
        Limit: params?.limit ?? 20,
        HasMore: false,
    };
}

export interface FetchScenesParams {
    page?: number;
    limit?: number;
    name?: string;
    tags?: string;
    includeCloneableForAdmin?: boolean;
    cloneableOnly?: boolean;
    remixesOnly?: boolean;
    sort?: "recent" | "most_remixed" | "most_played" | "recent_remixes";
}

export interface SceneSaveOptions {
    isPublic?: boolean;
    isCloneable?: boolean;
    isPublished?: boolean;
    onError?: () => void;
    onSuccess?: () => void;
}

const getBackgroundAssetRefs = (background: RenderingSettings["background"] | undefined): AssetRef[] => {
    if (!background) {
        return [];
    }

    const backgroundWithAssets = background as RenderingSettings["background"] & {
        textureAsset?: AssetRef;
        cubemapAssets?: Array<AssetRef | undefined>;
    };
    const refs: AssetRef[] = [];

    const textureAsset = backgroundWithAssets.textureAsset;
    if (textureAsset && isAssetRef(textureAsset)) {
        refs.push(textureAsset);
    }

    if (Array.isArray(backgroundWithAssets.cubemapAssets)) {
        for (const face of backgroundWithAssets.cubemapAssets) {
            if (isAssetRef(face)) {
                refs.push(face);
            }
        }
    }

    return refs;
};

const mergeAssetDependencies = (
    baseDependencies: Record<string, string> | undefined,
    assetRefs: readonly AssetRef[],
): Record<string, string> => {
    const merged = {...(baseDependencies || {})};

    for (const {assetId, revisionId} of assetRefs) {
        merged[assetId] = revisionId;
    }

    return merged;
};

/**
 * Retrieves a scene by ID
 * @param sceneId
 * @param isAlias
 */
export async function getScene(sceneId: string): Promise<any> {
    try {
        const params = `ID=${sceneId}`;
        const response = await Ajax.get({
            url: backendUrlFromPath(`/api/Scene/Get?${params}`),
            needAuthorization: false,
        });
        if (response?.data.Code === 200) {
            const sceneData = response?.data.Data;
            return sceneData;
        } else {
            const statusCode = response?.data?.Code;
            const message = response?.data?.Msg || "Request failed.";
            const sceneError = new Error(message) as Error & {status?: number};
            sceneError.status = Number.isFinite(statusCode) ? statusCode : undefined;
            throw sceneError;
        }
    } catch (error) {
        console.error("Request failed.", error);
        if (error instanceof Error) {
            throw error;
        }
        throw new Error("Request failed.");
    }
}

/**
 * Retrieves multiple scenes by their IDs
 * @param sceneIds
 */
export async function getSceneBatch(sceneIds: string[]): Promise<any> {
    try {
        const response = await Ajax.post({
            url: backendUrlFromPath(`/api/Scene/GetBatch`),
            data: JSON.stringify({
                IDs: sceneIds,
            }),
            msgBodyType: "json",
            needAuthorization: false,
        });

        if (response?.data.Code !== 200) {
            throw new Error(response?.data.Msg);
        }

        return response?.data.Data;
    } catch (error) {
        throw new Error((error instanceof Error ? error.message : "") || "Failed to get scenes");
    }
}

/**
 * Retrieves stats for starters
 */
export async function getStartersStats(): Promise<{blankProjectCount: number; sandboxStarterCount: number}> {
    return {blankProjectCount: 0, sandboxStarterCount: 0};
}

/**
 * Increases starter remix count
 * @param starterType
 */

type StarterType = "BlankProject" | "SandboxStarter";
/**
 *
 * @param starterType
 */
export async function updateStarterStats(starterType: StarterType): Promise<any> {
    void starterType;
    return null;
}

/**
 *
 * @param createThumbnail
 * @param _createThumbnail
 * @param shouldShowToast
 */
export const saveScene = async (_createThumbnail: boolean = false, shouldShowToast: boolean = true): Promise<void> => {
    const sceneSaveHandler = getSceneSaveHandler();
    if (sceneSaveHandler) {
        await sceneSaveHandler(_createThumbnail, shouldShowToast);
        return;
    }
    void _createThumbnail;
    const app = global.app;
    const editor = app?.editor;

    // Assign a local UUID to editor.sceneID so callers can navigate to
    // /create/project/<id>. Persistence is handled by the active ProjectStore.
    if (editor) {
        if (!editor.sceneID) {
            const cryptoObj = (globalThis as { crypto?: {randomUUID?: () => string} }).crypto;
            editor.sceneID =
                cryptoObj?.randomUUID?.() ??
                `oss-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        }
        editor.onSaveScene?.();
        return;
    }

    app?.call(`sceneSaveFailed`);
    showToast({type: "error", title: "Request failed."});
};

/**
 * Scene-level properties for PATCH /api/scene/:sceneId.
 * @param thumbnailUrl
 * @param options
 * @param editor
 */
const buildSceneUpdateParams = (
    thumbnailUrl: string,
    options: {isAssetPack?: boolean; isTopPick?: boolean; isPublic?: boolean; isCloneable?: boolean} | undefined,
    editor: Editor,
) => ({
    name: editor?.sceneName ?? "",
    thumbnail: thumbnailUrl || undefined,
    isAssetPack: options?.isAssetPack ?? !!editor?.isAssetPack,
    isTopPick: options?.isTopPick ?? !!editor?.isTopPick,
    isPublic: options?.isPublic ?? !!editor?.isPublic,
    isCloneable: options?.isCloneable ?? !!editor?.isCloneable,
    isSandbox: editor?.isSandbox,
    isCollaborative: editor?.isCollaborative,
    allowAnonymousFirebase: editor?.allowAnonymousFirebase,
    description: editor?.description,
    tags: JSON.stringify(editor?.tags),
    contentRating: editor?.contentRating,
    assetsCount: editor.assetsCount,
});

/**
 * Revision-level metadata for POST /api/scene/:sceneId/revision.
 * @param editor
 */
const buildRevisionMetadata = (editor: Editor) => ({
    lockedItems: editor?.sceneLockedItems ? editor?.sceneLockedItems.join(",") : "",
    isMultiplayer: editor?.isMultiplayer,
    vfxOnMobile: editor?.VFXOnMobile,
    multiplayerAutoJoin: editor?.multiplayerAutoJoin,
    maxMultiplayerClientsPerRoom: editor?.maxMultiplayerClientsPerRoom,
    maxCollaboratorsInRoom: editor?.maxCollaboratorsInRoom,
    showHud: editor?.showHUD,
    hudRenderer: editor?.hudRenderer,
    showStats: editor?.showStats,
    showMemoryStats: editor?.showMemoryStats,
    useInstancing: editor?.useInstancing,
    voiceChatEnabled: editor?.voiceChatEnabled,
    rendering: renderingEditorToApi(editor?.rendering),
    useAvatar: editor?.useAvatar,
});

/**
 * Combined params for createScene (which takes everything in one call).
 * @param thumbnailUrl
 * @param options
 * @param editor
 * @param dependencies
 */
const buildCreateSceneParams = (
    thumbnailUrl: string,
    options: {isAssetPack?: boolean; isTopPick?: boolean; isCloneable?: boolean} | undefined,
    editor: Editor,
    dependencies: Record<string, string>,
) => {
    const initialThumbnail = thumbnailUrl || editor?.sceneThumbnail || "";
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const {isPublic: _isPublic, ...rest} = buildSceneUpdateParams(initialThumbnail, options, editor);
    return {
        ...rest,
        alias: editor?.sceneAlias ?? undefined,
        ...buildRevisionMetadata(editor),
        dependencies,
    };
};

const buildLegacySceneFields = (
    thumbnailUrl: string,
    options:
        | {isAssetPack?: boolean; isTopPick?: boolean; isPublic?: boolean; isCloneable?: boolean; isPublished?: boolean}
        | undefined,
    editor: Editor,
    dependencies: Record<string, string>,
    assetResolutionContext: ReturnType<typeof getAssetResolutionContext>,
) => ({
    Name: editor?.sceneName,
    Alias: editor?.sceneAlias,
    LockedItems: editor?.sceneLockedItems ? editor?.sceneLockedItems.join(",") : "",
    Thumbnail: thumbnailUrl || editor?.sceneThumbnail,
    IsMultiplayer: editor?.isMultiplayer,
    VFXOnMobile: editor?.VFXOnMobile,
    MultiplayerAutoJoin: editor?.multiplayerAutoJoin,
    MaxMultiplayerClientsPerRoom: editor?.maxMultiplayerClientsPerRoom,
    IsSandbox: editor?.isSandbox,
    IsCollaborative: editor?.isCollaborative,
    MaxCollaboratorsInRoom: editor?.maxCollaboratorsInRoom,
    ShowHUD: editor?.showHUD,
    HUDRenderer: editor?.hudRenderer,
    ShowStats: editor?.showStats,
    ShowMemoryStats: editor?.showMemoryStats,
    UseInstancing: editor?.useInstancing,
    VoiceChatEnabled: editor?.voiceChatEnabled,
    Rendering: renderingEditorToApi(editor?.rendering),
    UseAvatar: editor?.useAvatar,
    AllowAnonymousFirebase: editor?.allowAnonymousFirebase,
    IsAssetPack: options?.isAssetPack ?? !!editor?.isAssetPack,
    IsTopPick: options?.isTopPick ?? !!editor?.isTopPick,
    IsPublic: options?.isPublic ?? !!editor?.isPublic,
    IsCloneable: options?.isCloneable ?? !!editor?.isCloneable,
    IsPublished: options?.isPublished ?? !!editor?.isPublished,
    Description: editor?.description,
    Tags: JSON.stringify(editor?.tags),
    ContentRating: editor?.contentRating,
    AssetsCount: editor.assetsCount,
    Dependencies: JSON.stringify(dependencies),
    LogicalIDToAssetID: JSON.stringify(assetResolutionContext?.logicalIdToAssetId || {}),
});

/**
 *
 * @param thumbnailUrl
 * @param options
 * @param options.isAssetPack
 * @param options.IsTopPick
 * @param options.isTopPick
 * @param options.isPublic
 * @param options.isCloneable
 * @param options.onError
 * @param options.onSuccess
 * @param shouldShowToast
 */
export const commitSaveScene = async (
    thumbnailUrl: string,
    options?: {
        isAssetPack?: boolean;
        isTopPick?: boolean;
        isPublic?: boolean;
        isCloneable?: boolean;
        onError?: () => void;
        onSuccess?: () => void;
    },
    shouldShowToast: boolean = true,
): Promise<void> => {
    const app = global.app;
    const editor = app?.editor;

    if (!editor) {
        app?.call(`sceneSaveFailed`);
        showToast({type: "error", title: "Request failed."});
        return;
    }

    if (isCopilotPreviewSceneSaveBlocked()) {
        const preview = getActiveCopilotPreviewPersistence();
        console.warn("commitSaveScene: ignored — Copilot temporary preview is active", preview);
        app?.call("copilotPreviewSaveBlocked", null, preview);
        return;
    }

    app.scene.userData.lastSaveTime = TimeUtils.getServerUTCTime();

    const {default: Converter} = await import("@web-shared/serialization/Converter");
    const experience = new (Converter as any)().toJSON({
        options: app.options,
        camera: app?.camera,
        scripts: app?.scripts,
        scene: app?.scene,
    });

    const assetResolutionContext = app?.scene ? getAssetResolutionContext(app?.scene) : emptyAssetResolutionContext;
    const backgroundAssetRefs = getBackgroundAssetRefs(editor?.rendering?.background);
    const dependencies = mergeAssetDependencies(assetResolutionContext?.assetIdToRevisionId, backgroundAssetRefs);
    const serializedPayload = JSON.stringify(experience);

    try {
        const sceneId = editor?.sceneID;
        const isAssetBacked = !!editor?.sceneAssetId;
        let newSceneId: string | undefined;
        let newAlias: string | undefined;

        if (sceneId && isAssetBacked) {
            // Asset-backed scene: PATCH scene props, then POST new revision.
            //
            // Retry on 409 so concurrent save races (e.g. autosave + manual save, or
            // background workers) resolve transparently with a fresh parent revision.
            //
            // Capture the new head revision id from the revision response so
            // the editor's local state reflects the post-save head — used by
            // the divergence indicator and the publish flow.
            const sceneUpdateParams = buildSceneUpdateParams(thumbnailUrl, options, editor);
            await updateScene(sceneId, sceneUpdateParams);
            const revisionResult = await createSceneRevision(sceneId, serializedPayload, {
                metadata: buildRevisionMetadata(editor),
                dependencies,
                retryOnConflict: true,
            });
            if (revisionResult.asset?.revision?.id) {
                editor.sceneRevisionId = revisionResult.asset.revision.id;
            }
        } else if (sceneId && !isAssetBacked) {
            // Legacy scene: fall back to old /api/Scene/Save endpoint
            const legacyPayload = {
                ID: sceneId,
                Data: serializedPayload,
                ...buildLegacySceneFields(thumbnailUrl, options, editor, dependencies, assetResolutionContext),
            };
            const response = await Ajax.post({
                url: backendUrlFromPath(`/api/Scene/Save`),
                msgBodyType: "multipart",
                data: legacyPayload,
            });
            if (response?.data.Code !== 200) {
                throw new Error(response?.data.Msg || "Request failed");
            }
            if (response?.data.ID) {
                newSceneId = response.data.ID;
            }
            newAlias = response?.data.Data?.alias ?? "";
        } else {
            const createParams = buildCreateSceneParams(thumbnailUrl, options, editor, dependencies);
            const result = await createScene(serializedPayload, createParams);
            newSceneId = result.id;
            newAlias = result.alias;
            editor.sceneThumbnail = result.thumbnail ?? editor.sceneThumbnail;
            // Update the editor's local state from the create response so the
            // next save routes through the modern asset-backed path instead of
            // falling through to the legacy /api/Scene/Save endpoint.
            if (result.asset?.id) {
                editor.sceneAssetId = result.asset.id;
            }
            if (result.asset?.revision?.id) {
                editor.sceneRevisionId = result.asset.revision.id;
            }
            if (result.publishRevisionId !== undefined) {
                editor.publishRevisionId = result.publishRevisionId ?? "";
            }
        }

        if (newSceneId) {
            editor.sceneID = newSceneId;
            // In the import-and-play-immediately flow (stemscript builds the
            // scene in place, save fires, user hits Play without a reload
            // hop), no later setUpScene/setUpLocalScene runs to populate
            // editor.assetSource. GameManager.loadBackendLambdas then
            // dereferences undefined. Populate it here so downstream systems
            // can trust it after a successful save.
            if (!editor.assetSource) {
                const {SceneAssetSource} = await import("@stem/editor-oss/editor/asset-management/AssetSource");
                editor.assetSource = new SceneAssetSource(newSceneId);
            }
        }
        if (newAlias !== undefined) {
            editor.sceneAlias = newAlias;
        }

        options?.onSuccess?.();
        app.call(`sceneSaved`, null, {showToast: shouldShowToast});
    } catch (err) {
        // "No changes" from the server means the scene is already at head — treat as success.
        // Can happen when saving a scene that hasn't been modified since the last revision.
        if (isNoChangesError(err)) {
            options?.onSuccess?.();
            app.call(`sceneSaved`, null, {showToast: shouldShowToast});
            if (shouldShowToast) {
                showToast({type: "info", title: "No changes to save"});
            }
            return;
        }

        options?.onError?.();
        app.call(`sceneSaveFailed`);
        const message = (err instanceof Error ? err.message : "") || "Request failed.";
        showToast({
            type: "error",
            title: "Error!",
            body: message,
            duration: 5000,
        });
    }
};

/**
 * Publish or unpublish the currently-loaded scene.
 *
 * Publishing pins the scene's current head revision as the publicly playable
 * revision. It does NOT create a new revision — the user is responsible for
 * saving any in-flight editor changes (via the regular Save button) first.
 * The divergence indicator in the Publish panel surfaces the gap between
 * the saved head and the published pin.
 *
 * Unpublishing clears the pin and the public-gallery listing. Also no
 * revision is created.
 *
 * Metadata toggles passed in options (isAssetPack, isTopPick, isCloneable)
 * are persisted via a separate PATCH so the panel's switches take effect in
 * the same click. isPublic is intentionally NOT included in the metadata
 * PATCH — for publish it's written atomically by the publish call, and for
 * unpublish the unpublish call clears it.
 *
 * @param action - "publish" or "unpublish"
 * @param options - Optional flags for the publish/unpublish call and panel-level metadata
 * @param options.isPublic - For publish: also set the public-gallery listing
 * @param options.isAssetPack - Asset pack flag (admin only)
 * @param options.isTopPick - Top pick flag (admin only)
 * @param options.isCloneable - Cloneable flag
 * @param options.onSuccess - Called when both the metadata PATCH and the publish call succeed
 * @param options.onError - Called on any failure
 */
export const publishCurrentScene = async (
    action: "publish" | "unpublish",
    options: {
        isPublic?: boolean;
        isAssetPack?: boolean;
        isTopPick?: boolean;
        isCloneable?: boolean;
        onSuccess?: () => void;
        onError?: () => void;
    } = {},
): Promise<void> => {
    const app = global.app;
    const editor = app?.editor;
    const sceneId = editor?.sceneID;
    if (!editor || !sceneId) {
        showToast({type: "warning", title: "Please open a scene first."});
        options.onError?.();
        return;
    }

    // Step 1: PATCH metadata toggles (admin flags + cloneable) so panel
    // switches take effect. isPublic is omitted intentionally — see fn doc.
    try {
        await updateScene(sceneId, {
            isAssetPack: options.isAssetPack,
            isTopPick: options.isTopPick,
            isCloneable: options.isCloneable,
        });
    } catch (err) {
        const message = (err instanceof Error ? err.message : undefined) ?? "Failed to save settings.";
        showToast({type: "error", title: message});
        options.onError?.();
        return;
    }

    // Step 2: call the publish or unpublish endpoint.
    try {
        if (action === "publish") {
            const headRevisionId = editor.sceneRevisionId;
            if (!headRevisionId) {
                showToast({
                    type: "error",
                    title: "Cannot publish: no revision available. Save the scene first.",
                });
                options.onError?.();
                return;
            }
            const publishOptions = options.isPublic !== undefined ? {isPublic: options.isPublic} : {};
            const result = await publishScene(sceneId, headRevisionId, publishOptions);
            editor.publishRevisionId = result.publishRevisionId ?? headRevisionId;
            editor.isPublished = true;
            if (options.isPublic !== undefined) {
                editor.isPublic = options.isPublic;
            }
            const [{emitScenePublishStateUpdated}, {REWARD_EVENT_TYPES, trackRewardEvent}] = await Promise.all([
                import("@stem/editor-oss/editor/asset-management/hooks/publish"),
                import("../rewards"),
            ]);
            // No direct assetId on Editor; the event payload still reaches
            // TopMenu / version modal subscribers.
            emitScenePublishStateUpdated(sceneId, undefined, result);
            void trackRewardEvent({
                eventType: REWARD_EVENT_TYPES.GAME_PUBLISHED,
                sceneId,
                creatorUserId: editor.projectUserId,
                idempotencyKey: `${REWARD_EVENT_TYPES.GAME_PUBLISHED}:${sceneId}:${editor.publishRevisionId}`,
                metadata: {
                    isPublic: editor.isPublic,
                },
            }).catch(() => {});
            // Notify React Query listeners (HomepageContext) to refetch
            // community / my-games / top-picks so the newly published scene
            // appears immediately without waiting for staleTime (DOT-7545).
            app.call("scenePublished", null, {sceneId, action: "publish"});
            showToast({type: "success", title: "Scene published!"});
        } else {
            const publishRevisionId = editor.publishRevisionId || "legacy";
            const result = await unpublishScene(sceneId);
            editor.publishRevisionId = "";
            editor.isPublished = false;
            editor.isPublic = false;
            const [{emitScenePublishStateUpdated}, {REWARD_EVENT_TYPES, trackRewardEvent}] = await Promise.all([
                import("@stem/editor-oss/editor/asset-management/hooks/publish"),
                import("../rewards"),
            ]);
            // No direct assetId on Editor; the event payload still reaches
            // TopMenu / version modal subscribers.
            emitScenePublishStateUpdated(sceneId, undefined, result);
            void trackRewardEvent({
                eventType: REWARD_EVENT_TYPES.GAME_UNPUBLISHED,
                sceneId,
                creatorUserId: editor.projectUserId,
                idempotencyKey: `${REWARD_EVENT_TYPES.GAME_UNPUBLISHED}:${sceneId}:${publishRevisionId}`,
            }).catch(() => {});
            app.call("scenePublished", null, {sceneId, action: "unpublish"});
            showToast({type: "success", title: "Scene unpublished."});
        }
        options.onSuccess?.();
    } catch (err) {
        const verb = action === "publish" ? "publish" : "unpublish";
        const message = (err instanceof Error ? err.message : undefined) ?? "Please try again.";
        showToast({
            type: "error",
            title: `Failed to ${verb}`,
            body: message,
            duration: 5000,
        });
        options.onError?.();
    }
};

let currentScreenShotPromise: Promise<File | undefined> | null = null;
/**
 *
 */
export async function createSceneScreenShot(): Promise<File | undefined> {
    if (currentScreenShotPromise) {
        return currentScreenShotPromise;
    }

    const app = global.app;
    const renderer = app?.renderer;
    const camera = app?.camera;
    if (camera && renderer) {
        try {
            app?.game?.cameraControl?.pause();
            const currentCameraPosition = camera?.position.clone();
            const currentCameraRotation = camera?.rotation.clone();

            if (app.editor?.isSandbox) {
                camera.position.set(50, 20, 50);
                if (app.game?.player) {
                    camera.lookAt(
                        app.game.player.position.x,
                        app.game.player.position.y + 10,
                        app.game.player.position.z,
                    );
                } else {
                    camera.lookAt(0, 10, 0);
                }
            }

            // Wait for the camera to update and the renderer to draw
            app.sceneHelpers.visible = false;
            currentScreenShotPromise = new Promise<File | undefined>((resolve, reject) => {
                void (async () => {
                    try {
                        let dataUrl: string;

                        // Always render to an offscreen RenderTarget and read pixels (works for WebGPU/WebGL)
                        // CHECK: if we should use some standard size
                        const width = 1024;
                        const height = 1024;
                        const [{RenderTarget, LinearFilter}, {default: UtilsConverter}] = await Promise.all([
                            import("three/webgpu"),
                            import("@web-shared/utils/Converter"),
                        ]);

                        const renderTarget = new RenderTarget(width, height, {
                            minFilter: LinearFilter,
                            magFilter: LinearFilter,
                            depthBuffer: true,
                            stencilBuffer: false,
                        });

                        const prevRenderTarget = renderer.getRenderTarget();
                        const prevVrEnabled = renderer.xr?.enabled;
                        const prevSize = renderer.getSize(new Vector2());
                        const prevPixelRatio = renderer.getPixelRatio();

                        try {
                            if (renderer.xr) {
                                renderer.xr.enabled = false;
                            }

                            renderer.setRenderTarget(renderTarget);
                            renderer.setPixelRatio(1);
                            renderer.setSize(width, height, false);
                            renderer.clear(true, true, true);
                            renderer.render(app.scene, camera);

                            // Read pixels (WebGPU uses async API)
                            let pixels: Uint8Array;
                            let flipY = true; // WebGL readPixels is bottom-left origin
                            const rAny = renderer;
                            if (typeof rAny.readRenderTargetPixelsAsync === "function") {
                                const data = await rAny.readRenderTargetPixelsAsync(renderTarget, 0, 0, width, height);
                                pixels = data instanceof Uint8Array ? data : new Uint8Array(data as unknown as ArrayBuffer);
                                // WebGPU CopyTextureToBuffer is top-left origin; do not flip
                                flipY = (renderer.backend as any).isWebGLBackend;
                            } else if (typeof (renderer as any).readRenderTargetPixels === "function") {
                                const tmp = new Uint8Array(width * height * 4);
                                (renderer as any).readRenderTargetPixels(renderTarget, 0, 0, width, height, tmp);
                                pixels = tmp;
                                flipY = true;
                            } else {
                                throw new Error("Renderer does not support reading pixels from RenderTarget.");
                            }

                            const tmpCanvas = document.createElement("canvas");
                            tmpCanvas.width = width;
                            tmpCanvas.height = height;
                            const tmpCtx = tmpCanvas.getContext("2d");

                            if (!tmpCtx) {
                                throw new Error("Unable to get 2D context for thumbnail creation.");
                            }

                            const imageData = tmpCtx.createImageData(width, height);
                            const exposure = renderer.toneMappingExposure ?? 1.0;

                            // Determine source row stride to handle WebGPU bytesPerRow padding
                            const bytesPerPixel = 4;
                            const tightBytesPerRow = width * bytesPerPixel;
                            const alignedBytesPerRow = Math.ceil(tightBytesPerRow / 256) * 256;
                            let sourceStride = tightBytesPerRow;
                            let lastRowStride = tightBytesPerRow;

                            if (pixels.length !== width * height * bytesPerPixel) {
                                // Common cases returned by WebGPU implementations:
                                // 1) (height - 1) * aligned + tight
                                // 2) height * aligned (fully padded)
                                const expectedTrimmed = (height - 1) * alignedBytesPerRow + tightBytesPerRow;
                                const expectedFull = height * alignedBytesPerRow;
                                if (pixels.length === expectedTrimmed || pixels.length === expectedFull) {
                                    sourceStride = alignedBytesPerRow;
                                    lastRowStride = pixels.length - (height - 1) * sourceStride;
                                } else if (height > 1) {
                                    const inferredStride = Math.ceil((pixels.length - tightBytesPerRow) / (height - 1));
                                    if (inferredStride % 256 === 0 && inferredStride >= tightBytesPerRow) {
                                        sourceStride = inferredStride;
                                        lastRowStride = pixels.length - (height - 1) * sourceStride;
                                    } else {
                                        sourceStride = tightBytesPerRow;
                                        lastRowStride = tightBytesPerRow;
                                    }
                                }
                            }

                            /**
                             * Converts linear color channel in [0,1] to sRGB in [0,1]
                             * @param c
                             * @returns number
                             */
                            function linearToSRGB(c: number) {
                                if (c <= 0.0031308) return 12.92 * c;
                                return 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
                            }

                            for (let y = 0; y < height; y++) {
                                const sy = flipY ? height - y - 1 : y;
                                const rowBase = sy * sourceStride;
                                const rowLimit = rowBase + (sy === height - 1 ? lastRowStride : sourceStride);
                                for (let x = 0; x < width; x++) {
                                    const srcIndex = rowBase + x * 4;
                                    const dstIndex = (y * width + x) * 4;
                                    if (srcIndex + 3 >= rowLimit || srcIndex + 3 >= pixels.length) {
                                        imageData.data[dstIndex] = 0;
                                        imageData.data[dstIndex + 1] = 0;
                                        imageData.data[dstIndex + 2] = 0;
                                        imageData.data[dstIndex + 3] = 0;
                                        continue;
                                    }

                                    const r0 = pixels[srcIndex] ?? 0;
                                    const g0 = pixels[srcIndex + 1] ?? 0;
                                    const b0 = pixels[srcIndex + 2] ?? 0;
                                    const a0 = pixels[srcIndex + 3] ?? 255;

                                    const rLin = Math.min(1, (r0 / 255) * exposure);
                                    const gLin = Math.min(1, (g0 / 255) * exposure);
                                    const bLin = Math.min(1, (b0 / 255) * exposure);

                                    const r = Math.round(Math.min(255, Math.max(0, linearToSRGB(rLin) * 255)));
                                    const g = Math.round(Math.min(255, Math.max(0, linearToSRGB(gLin) * 255)));
                                    const b = Math.round(Math.min(255, Math.max(0, linearToSRGB(bLin) * 255)));

                                    imageData.data[dstIndex] = r;
                                    imageData.data[dstIndex + 1] = g;
                                    imageData.data[dstIndex + 2] = b;
                                    imageData.data[dstIndex + 3] = a0;
                                }
                            }

                            tmpCtx.putImageData(imageData, 0, 0);
                            dataUrl = tmpCanvas.toDataURL("image/jpeg", 1.0);
                        } finally {
                            renderer.setRenderTarget(prevRenderTarget);
                            renderer.setPixelRatio(prevPixelRatio);
                            renderer.setSize(prevSize.x, prevSize.y, false);
                            if (renderer.xr) {
                                renderer.xr.enabled = prevVrEnabled;
                            }
                            renderTarget.dispose();
                        }

                        const file = (UtilsConverter as any).dataURLtoFile(dataUrl, (TimeUtils as any).getDateTime());

                        if (app.editor?.isSandbox) {
                            camera.position.copy(currentCameraPosition);
                            camera.rotation.copy(currentCameraRotation);
                        }

                        resolve(file);
                    } catch (e) {
                        if (app.editor?.isSandbox) {
                            camera.position.copy(currentCameraPosition);
                            camera.rotation.copy(currentCameraRotation);
                        }
                        reject(e instanceof Error ? e : new Error(String(e)));
                    }
                })();
            });
            app.sceneHelpers.visible = true;

            const result = currentScreenShotPromise;
            currentScreenShotPromise = null;
            return result;
        } catch (e) {
            throw e instanceof Error ? e : new Error(String(e));
        } finally {
            app?.game?.cameraControl?.resume();
        }
    }
}

/**
 *
 * @param sceneId
 * @param majorVersion
 * @param minorVersion
 */
export async function loadScene(
    sceneId: string,
    majorVersion?: number,
    minorVersion?: number,
): Promise<{
    data: any;
    metadata: any;
}> {
    try {
        let url = `/api/Server/Scene/Load?ID=${sceneId}`;
        if (majorVersion !== undefined && minorVersion !== undefined) {
            url += `&v=${majorVersion}.${minorVersion}`;
        }
        const response = await Ajax.get({
            url: backendUrlFromPath(url),
            needAuthorization: false,
        });

        if (response?.data.Code === 200) {
            return {
                data: response.data.Data,
                metadata: response.data.Metadata,
            };
        } else {
            const statusCode = response?.data?.Code;
            const message = response?.data?.Msg || "Request failed.";
            const sceneError = new Error(message) as Error & {status?: number};
            sceneError.status = Number.isFinite(statusCode) ? statusCode : undefined;
            throw sceneError;
        }
    } catch (error) {
        console.error("Failed to load game", error);
        if (error instanceof Error) {
            throw error;
        }
        throw new Error("Request failed.");
    }
}

/**
 * Converts a Rendering object from API (PascalCase keys, optional) to editor.rendering (camelCase, required, with defaults)
 * @param rendering
 */
export function renderingApiToEditor(rendering: RenderingSettingsAPI): RenderingSettings {
    const backgroundGradient =
        rendering?.Background?.Gradient ||
        (!rendering?.Background?.Type
            ? "linear-gradient(0deg, #3e4455 0%, #3e4455 65%, #4f576d 85%, #59677f 100%)"
            : undefined);

    return {
        shadowMapType: normalizeShadowMapType(rendering?.ShadowMapType, PCFShadowMap),
        ambient: rendering?.Ambient
            ? {color: rendering.Ambient.Color, intensity: rendering.Ambient.Intensity}
            : {color: "#ffffff", intensity: 0},
        hemisphere: rendering?.Hemisphere
            ? {
                  skyColor: rendering.Hemisphere.SkyColor,
                  groundColor: rendering.Hemisphere.GroundColor,
                  intensity: rendering.Hemisphere.Intensity,
              }
            : {skyColor: "#c1e0fe", groundColor: "#e5e695", intensity: 3},
        fog: rendering?.Fog
            ? {
                  type: rendering.Fog.Type,
                  color: rendering.Fog.Color,
                  near: rendering.Fog.Near,
                  far: rendering.Fog.Far,
                  density: rendering.Fog.Density,
              }
            : {type: "none", color: "#aaaaaa"},
        background: rendering?.Background
            ? {
                  type: (rendering.Background.Type as any) || "Gradient",
                  color: rendering.Background.Color,
                  texture: rendering.Background.Texture,
                  textureAsset: rendering.Background.TextureAsset,
                  cubemap: rendering.Background.Cubemap as [string, string, string, string, string, string],
                  cubemapAssets: rendering.Background.CubemapAssets?.map(face => face || undefined),
                  gradient: normalizeBackgroundGradient(backgroundGradient),
                  gradientMode: normalizeGradientMode(rendering.Background.GradientMode, "2d"),
                  rotation: rendering.Background.Rotation,
                  intensity: rendering.Background.Intensity,
                  blurriness: rendering.Background.Blurriness,
              }
            : {
                  type: "Gradient",
                  color: "#27272a",
                  gradient: "linear-gradient(0deg, #3e4455 0%, #3e4455 65%, #4f576d 85%, #59677f 100%)",
                  gradientMode: "2d",
              },
        toneMapping: rendering?.ToneMapping
            ? {type: rendering.ToneMapping.Type, exposure: rendering.ToneMapping.Exposure}
            : {type: "None", exposure: 1.0},
    };
}

/**
 * Converts editor.rendering (camelCase, required) to API Rendering (PascalCase, optional)
 * @param rendering
 */
export function renderingEditorToApi(rendering: RenderingSettings | undefined): RenderingSettingsAPI {
    if (!rendering) {
        return {};
    }

    return {
        ShadowMapType: normalizeShadowMapType(rendering.shadowMapType, PCFShadowMap),
        Ambient: rendering.ambient
            ? {Color: rendering.ambient.color, Intensity: rendering.ambient.intensity}
            : undefined,
        Hemisphere: rendering.hemisphere
            ? {
                  SkyColor: rendering.hemisphere.skyColor,
                  GroundColor: rendering.hemisphere.groundColor,
                  Intensity: rendering.hemisphere.intensity,
              }
            : undefined,
        Fog: rendering.fog
            ? {
                  Type: rendering.fog.type,
                  Color: rendering.fog.color,
                  Near: rendering.fog.near,
                  Far: rendering.fog.far,
                  Density: rendering.fog.density,
              }
            : undefined,
        Background: rendering.background
            ? {
                  Type: rendering.background.type,
                  Color: rendering.background.color,
                  Texture: rendering.background.texture,
                  TextureAsset: rendering.background.textureAsset,
                  Cubemap: rendering.background.cubemap,
                  CubemapAssets: rendering.background.cubemapAssets?.map(face => (isAssetRef(face) ? face : null)),
                  Gradient: normalizeBackgroundGradient(rendering.background.gradient),
                  GradientMode: normalizeGradientMode(rendering.background.gradientMode, "2d"),
                  Rotation: rendering.background.rotation,
                  Intensity: rendering.background.intensity,
                  Blurriness: rendering.background.blurriness,
              }
            : undefined,
        ToneMapping: rendering.toneMapping
            ? {Type: rendering.toneMapping.type, Exposure: rendering.toneMapping.exposure}
            : undefined,
    };
}

/**
 * Retrieves collaborators for a scene by ID
 * @param sceneId
 */
export async function getSceneCollaborators(sceneId: string): Promise<string[]> {
    void sceneId;
    return [];
}

/**
 * Adds a collaborator to a scene
 * @param sceneId
 * @param email
 */
export async function addSceneCollaborator(sceneId: string, email: string): Promise<void> {
    void sceneId;
    void email;
}

/**
 * Removes a collaborator from a scene
 * @param sceneId
 * @param email
 */
export async function removeSceneCollaborator(sceneId: string, email: string): Promise<void> {
    void sceneId;
    void email;
}

/**
 * Checks if the current user is a collaborator on a scene
 * @param sceneId
 */
export async function checkIsSceneCollaborator(sceneId: string): Promise<boolean> {
    void sceneId;
    return false;
}

/**
 * Fetches list of scenes owned by the current user
 * @param params
 */
export async function fetchMyScenes(params?: FetchScenesParams): Promise<PaginatedScenesResponse> {
    try {
        const {getProjectStore, ensureProjectStoreRehydrated} = await import("@stem/editor-oss/persistence");
        // Wait for the persistence backend to resolve. After a browser
        // "back" reloads the dashboard, this query can otherwise race
        // rehydration and read the empty IndexedDB fallback instead of
        // the user's File System Access folder, so no games show.
        await ensureProjectStoreRehydrated();
        const result = await getProjectStore().list({
            limit: params?.limit ?? 100,
            cursor: params?.page && params.page > 1 ? String(params.page) : undefined,
        } as never);
        const projects = (result as {projects: Array<{id: string; name: string; updatedAt?: string; createdAt?: string; thumbnailUrl?: string}>}).projects ?? [];
        return {
            Scenes: projects.map(p => ({
                ID: p.id,
                Name: p.name,
                UpdateTime: p.updatedAt ?? p.createdAt ?? new Date().toISOString(),
                CreateTime: p.createdAt ?? new Date().toISOString(),
                Thumbnail: p.thumbnailUrl ?? "",
                UserID: OSS_LOCAL_USER_ID,
            } as never)),
            TotalCount: projects.length,
            Page: params?.page ?? 1,
            Limit: params?.limit ?? 100,
            HasMore: false,
        };
    } catch (e) {
        console.warn("[fetchMyScenes] failed to read ProjectStore", e);
        return emptyPaginatedScenesResponse(params);
    }
}

/**
 * Fetches list of scenes that were remixed from a given scene
 * @param sceneId - The original scene ID to find remixes of
 * @param params
 */
export async function fetchRemixesOfScene(
    sceneId: string,
    params?: FetchScenesParams,
): Promise<PaginatedScenesResponse> {
    void sceneId;
    return emptyPaginatedScenesResponse(params);
}

/**
 * Fetches list of archived scenes owned by the current user
 * @param params
 */
export async function fetchArchivedScenes(params?: FetchScenesParams): Promise<PaginatedScenesResponse> {
    return emptyPaginatedScenesResponse(params);
}

/**
 * Fetches list of scenes where the current user is a collaborator
 * @param params
 */
export async function fetchCollaborativeScenes(params?: FetchScenesParams): Promise<PaginatedScenesResponse> {
    return emptyPaginatedScenesResponse(params);
}

/**
 * Fetches list of published (community) scenes
 * @param params
 */
export async function fetchPublishedScenes(params?: FetchScenesParams): Promise<PaginatedScenesResponse> {
    return emptyPaginatedScenesResponse(params);
}
/**
 * Fetches list of top picks scenes (not paginated)
 */
export async function fetchTopPicksScenes(): Promise<FileData[]> {
    return [];
}
/**
 * Fetches list of asset packs scenes for library
 * @param params
 */
export async function fetchAssetPacks(params?: FetchScenesParams): Promise<PaginatedScenesResponse> {
    return emptyPaginatedScenesResponse(params);
}
