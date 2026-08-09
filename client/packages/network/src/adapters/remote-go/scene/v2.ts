import global from "@web-shared/global";
import {OSS_LOCAL_USER_ID} from "@web-shared/ossUser";
import {Asset, dataToBase64, registerOssAsset} from "../asset";
import type {DomainAssetType, HandlerCreateAssetTokenResponse, HandlerCreateRevisionRequest, HandlerCreateSceneRequest, DomainSceneDto} from "../client/api";
import type {SceneSettings} from "./index";
import {
    cloneScene,
    forkScene,
    updateScene,
    type CloneSceneOptions,
    type CloneSceneResult,
    type ForkSceneOptions,
    type ForkSceneResult,
} from "./actions";
export type {DomainSceneDto as GetSceneResponse} from "../client/api";
export type {HandlerCreateAssetTokenResponse as AssetTokenResponse} from "../client/api";
export {
    cloneScene,
    forkScene,
    updateScene,
};
export type {
    CloneSceneOptions,
    CloneSceneResult,
    ForkSceneOptions,
    ForkSceneResult,
};

export type GetSceneOptions = {
    includeDerivatives?: boolean;
    includeDerivativeDataUrl?: boolean;
    /**
     * Which revision to load: "head" or "published". Omit for the default
     * role-based selection (head for contributors, published pin for
     * viewers). Used by the play link to force the published
     * revision so owners see what players see.
     */
    revision?: "head" | "published";
    /** Load a specific revision by ID, bypassing the role-based selection. */
    revisionId?: string;
};

/**
 * Fetches scene metadata, dataUrl, and optionally derivatives from the v2 scene API.
 *
 * @param sceneId - ID of the scene to fetch
 * @param options - Controls which optional fields are included in the response
 * @param options.includeDerivatives - Include the scene's asset derivatives
 * @param options.includeDerivativeDataUrl - Include signed CDN URLs for each derivative
 * @param options.revision - Force "head" or "published" revision selection
 * @returns The scene response, including metadata and (if requested) derivatives and dataUrl
 * @throws Error with `.status` set if the API returns a non-200 status
 */
export const getScene = async (sceneId: string, options: GetSceneOptions = {}): Promise<DomainSceneDto> => {
    void options;
    return loadSceneFromProjectStore(sceneId);
};

/**
 * Local scene load. Reads the project body from the local `ProjectStore`
 * (IndexedDB or File System Access) and synthesizes the `DomainSceneDto`
 * shape the editor expects, encoding the serialized scene as a `data:` URL
 * on `revision.dataUrl`. The downstream `fetchScenePayload` then fetches it
 * via `fetch(...)` exactly as it would a cloud-signed dataUrl, so the rest
 * of the load pipeline is unchanged.
 *
 * Remote DTOs can carry fields for galleries, ownership checks, and
 * collaborators. We only populate what `setUpScene` actually reads; the rest
 * are stamped with safe defaults. If a future change in `setUpScene` reads
 * more fields, extend the body here rather than re-introducing a
 * `/api/scene/<id>` round-trip.
 */
async function loadSceneFromProjectStore(sceneId: string): Promise<DomainSceneDto> {
    // Imported lazily to keep this network adapter free of editor-oss
    // direct dependencies; the persistence factory only resolves when the
    // local bootstrap has registered a backend.
    const {getProjectStore, ensureProjectStoreRehydrated} = await import("@stem/editor-oss/persistence");
    // Make sure the chosen backend (File System Access vs IndexedDB) is
    // resolved before reading. The Player route doesn't run the dashboard's
    // bootstrap effect, so without this it would read the lazy IndexedDB
    // fallback and report a filesystem project as "not found".
    await ensureProjectStoreRehydrated();
    const store = getProjectStore();
    let body;
    try {
        body = await store.load(sceneId);
    } catch (err) {
        // The store throws plain `Error("Project X not found...")`. The
        // editor's `isSceneInaccessibleError` detects missing scenes by
        // `status === 404`, so surface a stable shape here. Without this the
        // Create page treats the failure as a generic load error and
        // reattempts, leaving the user stuck on a half-loaded scene instead
        // of being routed back to the dashboard.
        const wrapped = new Error(
            err instanceof Error ? err.message : `Project ${sceneId} not found`,
        ) as Error & {status?: number; cause?: unknown};
        wrapped.status = 404;
        wrapped.cause = err;
        throw wrapped;
    }

    // Re-seed the in-memory local asset registry from the project's persisted
    // binary assets so model/image/audio references in the scene JSON
    // resolve. The registry is module-level and empty after a page reload;
    // this restores it before the scene is deserialized.
    try {
        const assets = await store.loadAssets(sceneId);
        for (const a of assets) {
            const mime = a.contentType
                || (a.format === "json" ? "application/json" : "application/octet-stream");
            const thumbMime = a.thumbnailContentType || "image/png";
            const thumbnailDataUrl = a.thumbnailData
                ? `data:${thumbMime};base64,${a.thumbnailData}`
                : undefined;
            registerOssAsset({
                assetId: a.assetId,
                revisionId: a.revisionId,
                type: a.type as DomainAssetType,
                format: a.format,
                name: a.name,
                contentType: a.contentType,
                metadata: a.metadata,
                dataUrl: `data:${mime};base64,${a.data}`,
                thumbnailDataUrl,
                projectId: sceneId,
            });
        }
    } catch (err) {
        console.warn("[scene/v2] failed to restore project assets", err);
    }

    const sceneJsonBase64 = (() => {
        try {
            // btoa(unescape(encodeURIComponent(...))) handles non-ASCII content.
            return btoa(unescape(encodeURIComponent(body.sceneJson)));
        } catch {
            return btoa(body.sceneJson);
        }
    })();
    const dataUrl = `data:application/json;base64,${sceneJsonBase64}`;
    const now = body.meta.updatedAt || new Date().toISOString();

    // Local storage persists the asset resolution context *inside* the scene JSON
    // (`scene.userData.assetResolutionContext`), not in separate metadata
    // fields like the cloud backend. The loader (`scene/util.ts loadScene`)
    // treats any truthy `dependencies` metadata as authoritative and
    // discards the scene's own `userData.assetResolutionContext`. Handing it
    // empty objects therefore wipes the real dependency map on every reload,
    // so model/behavior asset refs fail to resolve (untextured models).
    // Extract the persisted context here and surface it as metadata so the
    // loader rebuilds the correct map.
    let ossDependencies: Record<string, string> = {};
    let ossLogicalIdToAssetId: Record<string, string> = {};
    // `showHud` (and the other game flags) live in the persisted scene's
    // `userData.game`, not in separate metadata. Default to OFF — the HUD is
    // opt-in (see SceneConfig.showHUD = false). Hardcoding `true` here made the
    // HUD appear on every reload regardless of the project's actual setting.
    let ossShowHud = false;
    try {
        const parsed = JSON.parse(body.sceneJson) as Record<string, unknown>;
        for (const part of Object.values(parsed)) {
            const userData = (part as {userData?: {
                assetResolutionContext?: {
                    assetIdToRevisionId?: Record<string, string>;
                    logicalIdToAssetId?: Record<string, string>;
                };
                game?: {showHUD?: boolean};
            }})?.userData;
            const ctx = userData?.assetResolutionContext;
            if (ctx) {
                ossDependencies = ctx.assetIdToRevisionId ?? ossDependencies;
                ossLogicalIdToAssetId = ctx.logicalIdToAssetId ?? ossLogicalIdToAssetId;
            }
            if (typeof userData?.game?.showHUD === "boolean") {
                ossShowHud = userData.game.showHUD;
            }
            if (ctx) break;
        }
    } catch (err) {
        console.warn("[scene/v2] failed to extract asset resolution context from scene JSON", err);
    }
    return {
        id: sceneId,
        name: body.meta.name ?? "Untitled",
        alias: "",
        allowAnonymousFirebase: false,
        asset: {
            id: `oss-asset-${sceneId}`,
            revision: {
                id: `oss-rev-${sceneId}`,
                dataUrl,
                derivatives: [],
                expiresAt: undefined,
                metadata: {
                    dependencies: ossDependencies,
                    isMultiplayer: false,
                    lockedItems: "",
                    logicalIdToAssetId: ossLogicalIdToAssetId,
                    maxCollaboratorsInRoom: 0,
                    maxMultiplayerClientsPerRoom: 0,
                    multiplayerAutoJoin: false,
                    rendering: {} as never,
                    showHud: ossShowHud,
                    showMemoryStats: false,
                    showStats: false,
                    useAvatar: false,
                    useInstancing: false,
                    vfxOnMobile: false,
                    voiceChatEnabled: false,
                },
            },
        } as never,
        assetsCount: 0,
        contentRating: "",
        createTime: body.meta.createdAt ?? now,
        description: "",
        isAssetPack: false,
        isCloneable: false,
        isCollaborative: false,
        isPublic: false,
        isPublished: false,
        isSandbox: false,
        isTopPick: false,
        majorVersion: 0,
        minorVersion: 0,
        tags: "",
        thumbnail: body.meta.thumbnailUrl ?? "",
        updateTime: now,
        userId: OSS_LOCAL_USER_ID,
    };
}

function createSyntheticSceneDto(sceneId: string): DomainSceneDto {
    const now = new Date().toISOString();
    return {
        id: sceneId,
        name: "Local scene",
        alias: "",
        allowAnonymousFirebase: false,
        asset: {
            id: `oss-asset-${sceneId}`,
            revision: {
                id: `oss-rev-${sceneId}`,
                derivatives: [],
                expiresAt: undefined,
                metadata: {
                    dependencies: {},
                    isMultiplayer: false,
                    lockedItems: "",
                    logicalIdToAssetId: {},
                    maxCollaboratorsInRoom: 0,
                    maxMultiplayerClientsPerRoom: 0,
                    multiplayerAutoJoin: false,
                    rendering: {} as never,
                    showHud: false,
                    showMemoryStats: false,
                    showStats: false,
                    useAvatar: false,
                    useInstancing: false,
                    vfxOnMobile: false,
                    voiceChatEnabled: false,
                },
            },
        } as never,
        assetsCount: 0,
        contentRating: "",
        createTime: now,
        description: "",
        isAssetPack: false,
        isCloneable: false,
        isCollaborative: false,
        isPublic: false,
        isPublished: false,
        isSandbox: false,
        isTopPick: false,
        majorVersion: 0,
        minorVersion: 0,
        tags: "",
        thumbnail: "",
        updateTime: now,
        userId: OSS_LOCAL_USER_ID,
    };
}

export type CreateSceneAssetOptions = {
    description?: string;
    dependencies?: Record<string, string>;
    metadata?: Record<string, object>;
};
export type CreateSceneAssetParams = {
    sceneId: string;
    type: DomainAssetType;
    format: string;
    contentType: string;
    name: string;
    description?: string;
    revisionDescription?: string;
    uploadId?: string;
    data?: string; // base64-encoded (alternative to uploadId)
    options?: CreateSceneAssetOptions;
};

export const createSceneAsset = async ({
    sceneId,
    type,
    format,
    contentType,
    name,
    description,
    revisionDescription,
    uploadId,
    data,
    options = {},
}: CreateSceneAssetParams): Promise<Asset> => {
    void revisionDescription;
    void uploadId;
    const synthetic = synthOSSAsset({type, format, name, description, data, sceneId, contentType, metadata: options.metadata});
    global.app?.call("assetAdded", null, {assetId: synthetic.id});
    return synthetic;
};

function synthOSSAsset(params: {type: DomainAssetType; format: string; name: string; description?: string; data?: string; sceneId?: string; contentType?: string; metadata?: Record<string, unknown>}): Asset {
    const id = `oss-asset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const revisionId = `oss-rev-${id}`;
    const now = new Date().toISOString();
    let dataUrl: string | undefined;
    if (typeof params.data === "string" && params.data.length > 0) {
        // params.data is already base64-encoded — wrap it as a data: URL so
        // downstream consumers that fetch revision.dataUrl can decode it.
        const mime = params.format === "json" ? "application/json" : (params.contentType || "application/octet-stream");
        dataUrl = `data:${mime};base64,${params.data}`;
    }
    registerOssAsset({
        assetId: id,
        revisionId,
        type: params.type,
        format: params.format,
        name: params.name,
        contentType: params.contentType,
        metadata: params.metadata,
        dataUrl,
        projectId: params.sceneId,
    });
    return {
        id,
        type: params.type,
        format: params.format,
        name: params.name,
        description: params.description,
        createTime: now,
        updateTime: now,
        userId: OSS_LOCAL_USER_ID,
        headRevisionId: revisionId,
        revision: {id: revisionId, dataUrl, derivatives: [], expiresAt: undefined},
    } as unknown as Asset;
}

export type CreateSceneAssetWithDataParams = {
    sceneId: string;
    type: DomainAssetType;
    name: string;
    data: string | ArrayBuffer | Blob | ReadableStream;
    format: string;
    contentType: string;
    options?: CreateSceneAssetOptions;
    contentEncoding?: string;
};

/**
 * Convenience function for creating an asset with the given data.
 * Uses inline data for small payloads (<=1 MB) to avoid 3 HTTP round-trips.
 *
 * @param params - Parameters for creating the asset
 * @param params.sceneId - ID of the scene
 * @param params.type - Type of the asset
 * @param params.name - Name of the asset
 * @param params.format - Format of the data (e.g., "glb")
 * @param params.contentType - Content type of the data
 * @param params.data - Data to upload
 * @param params.options - Additional options for asset creation
 * @param params.contentEncoding - Encoding of the data
 * @returns Promise resolving to the created asset
 */
export const createSceneAssetWithData = async ({
    sceneId,
    type,
    name,
    format,
    contentType,
    data,
    options = {},
    contentEncoding,
}: CreateSceneAssetWithDataParams) => {
    console.log("[createSceneAssetWithData] Starting:", {
        sceneId,
        type,
        name,
        format,
        contentType,
        contentEncoding,
        dataSize: data instanceof Blob ? data.size : data instanceof ArrayBuffer ? data.byteLength : "unknown",
    });

    void contentEncoding;
    const base64 = await dataToBase64(data as string | ArrayBuffer | Blob);
    console.log("[createSceneAssetWithData] Using inline data path");
    const asset = await createSceneAsset({
        sceneId,
        type,
        format,
        contentType,
        name,
        description: options.description,
        data: base64,
        options,
    });
    const app = global.app as any;
    if (app?.editor?.isAssetPack) {
        const data = [{assetId: asset.id, revisionId: asset.headRevisionId}];
        app.call("autoCreateAssetReleases", data, data);
    }

    return asset;
};

export const removeAssetsFromScene = async (sceneId: string, assetIds: string[]) => {
    void sceneId;
    assetIds.forEach(assetId => {
        global.app?.call("assetRemoved", null, {assetId});
    });
};

export const updateSceneDependencies = async (sceneId: string, dependencies: Record<string, string>) => {
    void sceneId;
    return {dependencies};
};

export type SceneRevisionChangedAssetCapture = {
    assetId: string;
    revisionId?: string;
    kind?: string;
};

export type SceneRevisionValidationCapture = {
    id: string;
    label: string;
    status: string;
    detail?: string;
};

export type SceneRevisionCapture = {
    id: string;
    sceneId: string;
    revisionId: string;
    name?: string;
    summary?: string;
    source?: string;
    baseRevisionId?: string;
    restoredFromRevisionId?: string;
    previewId?: string;
    affectedSystems?: string[];
    changedAssets?: SceneRevisionChangedAssetCapture[];
    validation?: SceneRevisionValidationCapture[];
    userId?: string;
    createTime: string;
    updateTime: string;
};

export type UpsertSceneRevisionCaptureRequest = {
    name?: string;
    summary?: string;
    source?: string;
    baseRevisionId?: string;
    restoredFromRevisionId?: string;
    previewId?: string;
    affectedSystems?: string[];
    changedAssets?: SceneRevisionChangedAssetCapture[];
    validation?: SceneRevisionValidationCapture[];
};

export const listSceneRevisionCaptures = async (sceneId: string): Promise<SceneRevisionCapture[]> => {
    void sceneId;
    return [];
};

export const upsertSceneRevisionCapture = async (
    sceneId: string,
    revisionId: string,
    request: UpsertSceneRevisionCaptureRequest,
): Promise<SceneRevisionCapture> => {
    const timestamp = new Date().toISOString();
    return {
        id: `oss-capture-${revisionId}`,
        sceneId,
        revisionId,
        ...request,
        createTime: timestamp,
        updateTime: timestamp,
    };
};

/**
 * Publish a scene by pinning the asset revision id players will load.
 *
 * Optionally also lists the scene in the public gallery via `isPublic`. Omit
 * the option to leave the gallery listing state unchanged — useful for
 * re-publishing a scene that's already public without forcing the caller to
 * repeat the flag.
 *
 * @param sceneId - ID of the scene to publish
 * @param revisionId - The asset revision id to pin as the published revision
 * @param options
 * @param options.isPublic - Optional public-gallery listing toggle
 * @returns The updated scene DTO with the new publishRevisionId
 */
export const publishScene = async (
    sceneId: string,
    revisionId: string,
    options: {isPublic?: boolean} = {},
): Promise<DomainSceneDto> => {
    const scene = await loadSceneFromProjectStore(sceneId).catch(() => createSyntheticSceneDto(sceneId));
    return {
        ...scene,
        isPublished: true,
        isPublic: options.isPublic ?? scene.isPublic,
        publishRevisionId: revisionId,
        updateTime: new Date().toISOString(),
    };
};

/**
 * Unpublish a scene. Clears the pinned publish revision, the legacy
 * `isPublished` flag, and `isPublic` (because a scene without a playable
 * pinned revision cannot remain in the public gallery — the
 * Public ⇒ Published invariant).
 *
 * @param sceneId - ID of the scene to unpublish
 * @returns The updated scene DTO
 */
export const unpublishScene = async (sceneId: string): Promise<DomainSceneDto> => {
    const scene = await loadSceneFromProjectStore(sceneId).catch(() => createSyntheticSceneDto(sceneId));
    return {
        ...scene,
        isPublished: false,
        isPublic: false,
        publishRevisionId: "",
        updateTime: new Date().toISOString(),
    };
};

// ---------------------------------------------------------------------------
// Scene save endpoints (v2): uploadId-based save flow
// ---------------------------------------------------------------------------

export type CreateSceneRequest = Omit<HandlerCreateSceneRequest, "uploadId"> & {name: string};

/**
 * Maps the legacy PascalCase {@link SceneSettings} shape onto the v2 createScene
 * request body. Pure shape conversion — no I/O, no publish directive.
 *
 * Drops fields that have no v2 equivalent or that belong to a different flow:
 * - `IsPublic` / `IsPublished` — handled separately via {@link publishScene}
 * - `ID` — new scenes don't carry an upstream id
 * - `MajorVersion` / `MinorVersion` — defaulted server-side
 * - `ProductionMode` / `CompartmentsEnabled` — live in scene userData, not scene-level
 * - `AssetsCount` — legacy type quirk (boolean vs the v2 number)
 *
 * @param settings - Legacy SceneSettings (typically embedded in an exported scene JSON)
 * @param name - Scene name (required by v2; passed separately so callers can provide a fallback)
 * @returns The v2 createScene request body, ready to pass to {@link createScene}
 */
export const sceneSettingsToCreateRequest = (
    settings: SceneSettings,
    name: string,
): CreateSceneRequest => {
    const tags = Array.isArray(settings.Tags) ? settings.Tags.join(", ") : undefined;
    return {
        name,
        alias: settings.Alias,
        allowAnonymousFirebase: settings.AllowAnonymousFirebase,
        dependencies: settings.Dependencies,
        description: settings.Description,
        isAssetPack: settings.IsAssetPack,
        isCloneable: settings.IsCloneable,
        isCollaborative: settings.IsCollaborative,
        isMultiplayer: settings.IsMultiplayer,
        isSandbox: settings.IsSandbox,
        isTopPick: settings.IsTopPick,
        lockedItems: settings.LockedItems,
        maxCollaboratorsInRoom: settings.MaxCollaboratorsInRoom,
        maxMultiplayerClientsPerRoom: settings.MaxMultiplayerClientsPerRoom,
        multiplayerAutoJoin: settings.MultiplayerAutoJoin,
        rendering: settings.Rendering,
        showHUD: settings.ShowHUD,
        showStats: settings.ShowStats,
        tags,
        thumbnail: settings.Thumbnail,
        useAvatar: settings.UseAvatar,
        useInstancing: settings.UseInstancing,
        vfxOnMobile: settings.VFXOnMobile,
        voiceChatEnabled: settings.VoiceChatEnabled,
    };
};

/**
 * Creates a new scene from a serialized JSON payload.
 * Uploads the payload first, then calls POST /api/scene.
 * @param serializedPayload - Serialized scene JSON string
 * @param params - Scene metadata (name is required; uploadId is injected automatically)
 * @returns The created scene's id, alias, and publishedTime
 */
export const createScene = async (
    serializedPayload: string,
    params: Omit<HandlerCreateSceneRequest, "uploadId"> & {name: string},
): Promise<DomainSceneDto> => {
    void serializedPayload;
    const id = `oss-scene-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
        ...createSyntheticSceneDto(id),
        name: params.name,
        alias: params.alias ?? "",
        description: params.description ?? "",
        thumbnail: params.thumbnail ?? "",
        tags: params.tags ?? "",
        isAssetPack: params.isAssetPack ?? false,
        isCloneable: params.isCloneable ?? false,
        isCollaborative: params.isCollaborative ?? false,
        isSandbox: params.isSandbox ?? false,
        isTopPick: params.isTopPick ?? false,
        publishedTime: undefined,
    };
};

export type CreateSceneRevisionOptions = Omit<HandlerCreateRevisionRequest, "uploadId"> & {
    /**
     * If true, retry once with a fresh parent revision on 409 Conflict. Safe for
     * concurrent save races because the server re-reads the head revision on each
     * request, and the uploadId can be reused (the server copies the blob, doesn't
     * consume it).
     */
    retryOnConflict?: boolean;
};

/**
 * Creates a new revision for an existing asset-backed scene.
 * Uploads the payload first, then calls POST /api/scene/:sceneId/revision.
 *
 * @param sceneId - ID of the scene to create a revision for
 * @param serializedPayload - Serialized scene JSON string
 * @param options - Scene metadata and optional retryOnConflict flag (uploadId is injected automatically)
 * @returns The new revisionId and publishedTime
 */
export const createSceneRevision = async (
    sceneId: string,
    serializedPayload: string,
    options: CreateSceneRevisionOptions,
): Promise<DomainSceneDto> => {
    void serializedPayload;
    void options;
    const revisionId = `oss-rev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const scene = createSyntheticSceneDto(sceneId);
    return {
        ...scene,
        asset: {
            ...scene.asset,
            revision: {
                ...scene.asset.revision,
                id: revisionId,
            },
        },
        publishedTime: undefined,
    };
};

/**
 * Mint a short-lived asset token granting scoped access to an asset and its
 * direct dependencies. The caller must be a scene contributor, and the asset
 * must be a direct dependency of the scene owned by the scene owner.
 *
 * @param sceneId - The scene that justifies the access grant
 * @param assetId - The root asset the token authorizes access to
 * @returns The signed token and its expiry
 */
export const createAssetToken = async (sceneId: string, assetId: string): Promise<HandlerCreateAssetTokenResponse> => {
    void sceneId;
    void assetId;
    return {};
};
