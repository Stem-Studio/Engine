import {chunk} from "lodash";

import global from "@web-shared/global";
import {OSS_LOCAL_USER_ID} from "@web-shared/ossUser";
import {withRetry} from "@web-shared/utils/retry";
import type {ApiClientOptions} from "../client";
import type {
    DomainAssetType,
    DomainDerivativeType,
    DerivativeCreateAssetDerivativeRequest,
    ImportsImportItem,
    DomainAssetDto,
    DomainAssetRevisionDto,
    DomainAssetImportJobDto,
    DomainAssetImportDto,
    DomainAssetDerivativeDto,
    DomainAssetReleaseDto,
} from "../client/api";
import {
    getOssAssetsForProject,
    lookupOssAsset,
    registerOssAsset,
    setOssAssetThumbnail,
} from "./registry";

export {
    createOssAssetRegistry,
    getOssAssetRegistry,
    getOssAssetsForProject,
    lookupOssAsset,
    registerOssAsset,
    resetOssAssetRegistryForTests,
    setOssAssetRegistry,
    setOssAssetThumbnail,
    unregisterOssAsset,
} from "./registry";
export type {OssAssetRecord, OssAssetRegistry} from "./registry";

export type Asset = DomainAssetDto;

export type AssetDerivative = DomainAssetDerivativeDto;

export type AssetImport = DomainAssetImportDto;

export type AssetImportItem = ImportsImportItem;

export type AssetImportJob = DomainAssetImportJobDto;

export type AssetRelease = DomainAssetReleaseDto;

const DomainAssetTypeValue = {
    AssetTypeAnimation: "animation",
    AssetTypeAudio: "audio",
    AssetTypeBehavior: "behavior",
    AssetTypeScript: "script",
    AssetTypeImage: "image",
    AssetTypeLambda: "lambda",
    AssetTypeModel: "model",
    AssetTypeNpc: "npc",
    AssetTypePrefab: "prefab",
    AssetTypeQuarks: "quarks",
    AssetTypeScene: "scene",
    AssetTypeVideo: "video",
    AssetTypeFile: "file",
} as const satisfies Record<string, DomainAssetType>;

const DomainDerivativeTypeValue = {
    DerivativeTypeAudio: "audio",
    DerivativeTypeBehaviorBundle: "behaviorBundle",
    DerivativeTypeImage: "image",
    DerivativeTypeModel: "model",
    DerivativeTypeThumbnail: "thumbnail",
} as const satisfies Record<string, DomainDerivativeType>;

const syntheticAssetImports = new Map<string, AssetImport>();

export type AssetRevision = DomainAssetRevisionDto;

export type CreateAssetOptions = {
    description?: string;
    revisionDescription?: string;
    dependencies?: Record<string, string>;
    metadata?: Record<string, any>;
    tags?: string[];
};

export type GetAssetDerivativeOptions = {
    apiClientOptions?: ApiClientOptions;
    includeDataUrl?: boolean;
};

export type GetAssetDerivativesOptions = GetAssetDerivativeOptions;

export type CreateAssetDerivativeWithDataParams = {
    assetId: string;
    revisionId: string;
    type: DomainDerivativeType;
    format: string;
    contentType: string;
    data: string | ArrayBuffer | Blob | ReadableStream;
    metadata: Record<string, any>;
    lodLevel?: number;
    contentEncoding?: string;
};

export type CreateAssetWithDataParams = {
    type: DomainAssetType;
    name: string;
    data: string | ArrayBuffer | Blob | ReadableStream;
    format: string;
    contentType: string;
    options?: CreateAssetOptions;
    contentEncoding?: string;
};

export type CreateAssetRevisionParams = {
    assetId: string;
    parentRevisionId: string;
    uploadId?: string;
    data?: string; // base64-encoded (alternative to uploadId)
    contentType?: string; // required when using data
    format?: string;
    options?: CreateAssetRevisionOptions;
};

export type CreateAssetRevisionWithDataParams = {
    assetId: string;
    parentRevisionId: string;
    data: string | ArrayBuffer | Blob | ReadableStream;
    format: string;
    contentType: string;
    options?: CreateAssetRevisionOptions;
    contentEncoding?: string;
};

export type CreateAssetReleaseParams = {
    assetId: string;
    revisionId: string;
    version: AssetVersion;
    description: string;
};

export type CreateAssetRevisionOptions = {
    description?: string;
    dependencies?: Record<string, string>;
    metadata?: Record<string, any>;
};

export type GetAssetOptions = {
    apiClientOptions?: ApiClientOptions;
    includeThumbnails?: boolean;
    includeLatestRelease?: boolean;
};

export type GetAssetsOptions = {
    includeLatestRelease?: boolean;
    includeThumbnails?: boolean;
    owner?: "me" | "all";
    released?: "all" | "true" | "false";
    types?: DomainAssetType[];
    tags?: string[];
    page?: number;
    limit?: number;
    sort?: "asc" | "desc";
};

export type GetAssetsResponse = {
    assets: Asset[];
    totalCount: number;
    page: number;
    limit: number;
};

export type GetAssetReleasesOptions = {
    limit?: number;
};

export type GetAssetRevisionDataOptions = {
    apiClientOptions?: ApiClientOptions;
};

export type GetAssetRevisionOptions = {
    includeDataUrl?: boolean;
    includeDependencies?: boolean;
    includeMetadata?: boolean;
    includeRelease?: boolean;
};

export type GetAssetRevisionsOptions = GetAssetRevisionOptions;

export type GetAssetRevisionsResponse = {
    revisions: AssetRevision[];
};

export type GetSceneAssetsOptions = {
    includeDerivatives?: boolean;
    includeDerivativeDataUrl?: boolean;
    includeLatestRelease?: boolean;
    includeThumbnails?: boolean;
    types?: DomainAssetType[];
};

export type GetMyAssetsOptions = {
    apiClientOptions?: ApiClientOptions;
    includeLatestRelease?: boolean;
    tags?: string[];
    includeThumbnails?: boolean;
    types?: DomainAssetType[];
};

export type UpdateAssetParams = {
    assetId: string;
    name?: string;
    description?: string;
    tags?: string[];
    isForkable?: boolean;
    moderationStatus?: string;
};

export const AssetType = {
    Animation: DomainAssetTypeValue.AssetTypeAnimation,
    Audio: DomainAssetTypeValue.AssetTypeAudio,
    Behavior: DomainAssetTypeValue.AssetTypeBehavior,
    Script: DomainAssetTypeValue.AssetTypeScript,
    Image: DomainAssetTypeValue.AssetTypeImage,
    Model: DomainAssetTypeValue.AssetTypeModel,
    Npc: DomainAssetTypeValue.AssetTypeNpc,
    Prefab: DomainAssetTypeValue.AssetTypePrefab,
    Quarks: DomainAssetTypeValue.AssetTypeQuarks,
    Video: DomainAssetTypeValue.AssetTypeVideo,
    File: DomainAssetTypeValue.AssetTypeFile,
    Lambda: DomainAssetTypeValue.AssetTypeLambda,
    Scene: DomainAssetTypeValue.AssetTypeScene,
    // Aliases for semantic clarity (map to existing types)
    Avatar: DomainAssetTypeValue.AssetTypeModel, // Avatars are 3D models with avatar metadata
    Texture: DomainAssetTypeValue.AssetTypeImage, // Textures are images
    Screenshot: DomainAssetTypeValue.AssetTypeImage, // Screenshots are images
} as const;

export const AssetDerivativeType = {
    BehaviorBundle: DomainDerivativeTypeValue.DerivativeTypeBehaviorBundle,
    Image: DomainDerivativeTypeValue.DerivativeTypeImage,
    Model: DomainDerivativeTypeValue.DerivativeTypeModel,
    Thumbnail: DomainDerivativeTypeValue.DerivativeTypeThumbnail,
    Audio: DomainDerivativeTypeValue.DerivativeTypeAudio,
} as const;

export type AssetVersion = {
    major: number;
    minor: number;
    patch: number;
};

// All model formats supported by the API
export enum ModelFormat {
    Blend = "blend",
    Dae = "dae",
    Fbx = "fbx",
    Glb = "glb",
    Gltf = "gltf",
    Obj = "obj",
    Ply = "ply",
    Spz = "spz",
    Stl = "stl",
    Threeds = "3ds",
    Usd = "usd",
    Usda = "usda",
    Usdc = "usdc",
    Usdz = "usdz",
    Vrm = "vrm",
}

export const SUPPORTED_MODEL_FORMATS: readonly ModelFormat[] = Object.values(ModelFormat);

export const SUPPORTED_MODEL_FORMATS_REGEX = new RegExp(`\\.(${SUPPORTED_MODEL_FORMATS.join("|")})$`, "i");

export const SUPPORTED_MODEL_CONTENT_TYPES: Record<ModelFormat, [string, ...string[]]> = {
    [ModelFormat.Blend]: ["application/x-blender"],
    [ModelFormat.Dae]: ["application/vnd.collada+xml"],
    [ModelFormat.Fbx]: ["application/octet-stream", "text/plain"],
    [ModelFormat.Glb]: ["model/gltf-binary"],
    [ModelFormat.Gltf]: ["model/gltf+json"],
    [ModelFormat.Obj]: ["model/obj"],
    [ModelFormat.Ply]: ["text/plain", "application/octet-stream"],
    [ModelFormat.Spz]: ["application/octet-stream"],
    [ModelFormat.Stl]: ["model/stl"],
    [ModelFormat.Threeds]: ["application/x-3ds"],
    [ModelFormat.Usd]: ["application/usd", "application/octet-stream"],
    [ModelFormat.Usda]: ["application/usda", "text/plain", "application/octet-stream"],
    [ModelFormat.Usdc]: ["application/usdc", "application/octet-stream"],
    [ModelFormat.Usdz]: ["model/vnd.usdz+zip"],
    [ModelFormat.Vrm]: ["model/gltf+json", "model/gltf-binary"],
};

export type AssetResponseType = {
    arraybuffer: ArrayBuffer;
    blob: Blob;
    json: any;
    text: string;
};

type ResponseError = {
    response?: {
        status?: number;
        data?: unknown;
    };
};

export const INLINE_DATA_MAX_BYTES = 1_048_576; // 1 MB

/**
 * Compress data using gzip.
 * @param data - Data to compress
 * @returns Compressed data as a Blob
 */
export const gzipData = async (data: string | ArrayBuffer | Blob | ReadableStream): Promise<Blob> => {
    if (typeof CompressionStream === "undefined") {
        throw new Error("gzip compression requires CompressionStream support");
    }

    const source = typeof ReadableStream !== "undefined" && data instanceof ReadableStream
        ? data
        : (data instanceof Blob ? data : new Blob([data as BlobPart])).stream();
    const stream = source.pipeThrough(new CompressionStream("gzip"));
    return new Response(stream).blob();
};

export const prepareUploadData = async (
    data: string | ArrayBuffer | Blob | ReadableStream,
    contentEncoding?: string,
): Promise<{data: string | ArrayBuffer | Blob | ReadableStream; contentEncoding?: string}> => {
    if (!contentEncoding) {
        return {data};
    }

    if (contentEncoding !== "gzip") {
        return {data, contentEncoding};
    }

    if (typeof CompressionStream === "undefined") {
        console.warn("[asset upload] CompressionStream unavailable; uploading uncompressed data.");
        return {data};
    }

    return {data: await gzipData(data), contentEncoding};
};

/**
 * Returns byte length of data, or null if unknowable (ReadableStream).
 * @param data - Data to check
 * @returns Byte length, or null
 */
export const getDataByteLength = (
    data: string | ArrayBuffer | Blob | ReadableStream,
): number | null => {
    if (data instanceof ArrayBuffer) return data.byteLength;
    if (data instanceof Blob) return data.size;
    if (typeof data === "string") return new Blob([data]).size;
    return null; // ReadableStream — unknown size
};

/**
 * Convert data to a base64 string.
 * @param data - Data to convert
 * @returns Base64 string
 */
export const dataToBase64 = async (
    data: string | ArrayBuffer | Blob,
): Promise<string> => {
    let buffer: ArrayBuffer;
    if (data instanceof ArrayBuffer) {
        buffer = data;
    } else if (data instanceof Blob) {
        buffer = await data.arrayBuffer();
    } else {
        buffer = new TextEncoder().encode(data).buffer;
    }
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    const chunks: string[] = [];
    for (let i = 0; i < bytes.length; i += chunkSize) {
        chunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
    }
    return btoa(chunks.join(""));
};

export type CreateAssetParams = {
    type: DomainAssetType;
    format: string;
    contentType: string;
    name: string;
    uploadId?: string;
    data?: string; // base64-encoded (alternative to uploadId)
    options?: CreateAssetOptions;
};

export const createAsset = async ({
    type,
    format,
    contentType,
    name,
    uploadId,
    data,
    options = {},
}: CreateAssetParams): Promise<Asset> => {
    void uploadId;
    const id = `oss-asset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const revisionId = `oss-rev-${id}`;
    const now = new Date().toISOString();
    let dataUrl: string | undefined;
    if (typeof data === "string" && data.length > 0) {
        const mime = format === "json" ? "application/json" : (contentType || "application/octet-stream");
        dataUrl = `data:${mime};base64,${data}`;
    }
    // Tag the record with the current scene id so project-scoped reads and
    // persistence can recover it without any remote asset service.
    const projectId = global.app?.editor?.sceneID ?? undefined;
    registerOssAsset({assetId: id, revisionId, type, format, name, contentType, metadata: options.metadata, dataUrl, projectId});
    return {
        id,
        type,
        format,
        contentType,
        name,
        description: options.description ?? options.revisionDescription ?? "",
        createTime: now,
        updateTime: now,
        userId: OSS_LOCAL_USER_ID,
        headRevisionId: revisionId,
        sceneIds: projectId ? [projectId] : [],
        revision: {id: revisionId, dataUrl, derivatives: [], expiresAt: undefined},
    } as unknown as Asset;
};

export const createAssetDerivative = async (
    assetId: string,
    revisionId: string,
    request: DerivativeCreateAssetDerivativeRequest,
): Promise<AssetDerivative> => {
    const now = new Date().toISOString();
    return {
        id: `oss-deriv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        assetId,
        revisionId,
        type: request.type as DomainDerivativeType,
        format: request.format,
        contentType: "",
        metadata: request.metadata ?? {},
        createTime: now,
        ...(request.lodLevel !== undefined ? {lodLevel: request.lodLevel} : {}),
    } as AssetDerivative;
};

export const createAssetImport = async (items: AssetImportItem[]): Promise<AssetImport> => {
    const now = new Date().toISOString();
    const id = `oss-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const assetImport: AssetImport = {
        id,
        userId: OSS_LOCAL_USER_ID,
        createTime: now,
        updateTime: now,
        jobs: items.map((item, index) => ({
            id: `${id}-job-${index}`,
            importId: id,
            referenceId: item.referenceId ?? String(index),
            status: "completed",
            createTime: now,
            updateTime: now,
        })),
    };
    syntheticAssetImports.set(id, assetImport);
    return assetImport;
};

export const createAssetRelease = async ({
    assetId,
    revisionId,
    version,
    description,
}: CreateAssetReleaseParams): Promise<AssetRelease> => {
    return {
        assetId,
        revisionId,
        description,
        versionMajor: version.major,
        versionMinor: version.minor,
        versionPatch: version.patch,
        userId: OSS_LOCAL_USER_ID,
        createTime: new Date().toISOString(),
    };
};

export type ForkAssetParams = {
    /** The asset id to fork from. */
    assetId: string;
    /** The revision id to fork from. Required by the backend. */
    revisionId: string;
    /** Optional name for the new fork; defaults to the source name on the server. */
    name?: string;
};

export type ForkAssetResult = {
    /** The id of the newly forked asset. */
    assetId: string;
    /** The head revision id on the new fork. */
    revisionId: string;
};

export const forkAsset = async ({assetId, revisionId, name}: ForkAssetParams): Promise<ForkAssetResult> => {
    const source = lookupOssAsset(revisionId) ?? lookupOssAsset(assetId);
    const newAssetId = `oss-asset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newRevisionId = `oss-rev-${newAssetId}`;
    if (source) {
        registerOssAsset({
            ...source,
            assetId: newAssetId,
            revisionId: newRevisionId,
            name: name ?? source.name,
            projectId: global.app?.editor?.sceneID ?? source.projectId,
        });
    }
    return {assetId: newAssetId, revisionId: newRevisionId};
};

export const createAssetRevision = async ({
    assetId,
    parentRevisionId,
    uploadId,
    data,
    contentType,
    format,
    options = {},
}: CreateAssetRevisionParams): Promise<AssetRevision> => {
    void uploadId;
    // The local runtime has no revision history; it reuses the asset's stable
    // head revision id and overwrites the registry record in place.
    const existing = lookupOssAsset(assetId);
    const id = existing?.revisionId ?? `oss-rev-${assetId}`;
    let dataUrl: string | undefined;
    if (typeof data === "string" && data.length > 0) {
        const mime = format === "json" ? "application/json" : (contentType || "application/octet-stream");
        dataUrl = `data:${mime};base64,${data}`;
    }
    registerOssAsset({
        assetId,
        revisionId: id,
        type: existing?.type ?? ("model" as DomainAssetType),
        format: format ?? existing?.format ?? "",
        name: existing?.name ?? assetId,
        contentType: contentType ?? existing?.contentType,
        metadata: options.metadata ?? existing?.metadata,
        dataUrl,
        thumbnailDataUrl: existing?.thumbnailDataUrl,
        projectId: existing?.projectId ?? global.app?.editor?.sceneID ?? undefined,
    });
    global.app?.call("assetChanged", null, {assetId});
    return {
        id,
        assetId,
        parentId: parentRevisionId,
        dataUrl,
        derivatives: [],
        expiresAt: undefined,
        createTime: new Date().toISOString(),
        updateTime: new Date().toISOString(),
    } as unknown as AssetRevision;
};

export const createAssetUpload = async (contentType: string, contentEncoding?: string) => {
    void contentType;
    void contentEncoding;
    const id = `oss-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {upload: {id}, uploadUrl: ""} as never;
};

export const getAsset = async (assetId: string, options: GetAssetOptions = {}): Promise<Asset> => {
    void options;
    const record = lookupOssAsset(assetId);
    const now = new Date().toISOString();
    if (record) {
        return {
            id: record.assetId,
            type: record.type,
            format: record.format,
            contentType: record.contentType,
            createTime: now,
            updateTime: now,
            userId: OSS_LOCAL_USER_ID,
            headRevisionId: record.revisionId,
            name: record.name,
            description: "",
            sceneIds: record.projectId ? [record.projectId] : [],
            thumbnailUrl: record.thumbnailDataUrl,
            revision: {id: record.revisionId, dataUrl: record.dataUrl, derivatives: [], expiresAt: undefined},
        } as never;
    }
    return {
        id: assetId,
        type: "scene",
        format: "json",
        createTime: now,
        updateTime: now,
        userId: OSS_LOCAL_USER_ID,
        headRevisionId: `oss-rev-${assetId}`,
        name: "local",
        description: "",
        sceneIds: [],
        revision: {id: `oss-rev-${assetId}`, dataUrl: undefined, derivatives: [], expiresAt: undefined},
    } as never;
};

export const getAssets = async (options: GetAssetsOptions = {}): Promise<GetAssetsResponse> => {
    void options;
    return {
        assets: [],
        totalCount: 0,
        page: options.page ?? 1,
        limit: options.limit ?? 20,
    };
};

export const getAssetDerivative = async (
    assetId: string,
    revisionId: string,
    derivativeId: string,
    options: GetAssetDerivativeOptions = {},
): Promise<AssetDerivative> => {
    void options;
    const now = new Date().toISOString();
    return {
        id: derivativeId,
        assetId,
        revisionId,
        type: DomainDerivativeTypeValue.DerivativeTypeImage,
        format: "",
        contentType: "",
        metadata: {},
        createTime: now,
    };
};

export const getAssetDerivatives = async (
    assetId: string,
    revisionId: string,
    options: GetAssetDerivativesOptions = {},
): Promise<AssetDerivative[]> => {
    void assetId;
    void revisionId;
    void options;
    return [];
};

export const getAssetImport = async (importId: string): Promise<AssetImport> => {
    const now = new Date().toISOString();
    return syntheticAssetImports.get(importId) ?? {
        id: importId,
        userId: OSS_LOCAL_USER_ID,
        createTime: now,
        updateTime: now,
        jobs: [],
    };
};

export const getAssetReleases = async (
    assetId: string,
    options: GetAssetReleasesOptions = {},
): Promise<AssetRelease[]> => {
    void assetId;
    void options;
    return [];
};

export const getAssetRevision = async (
    assetId: string,
    revisionId: string,
    options: GetAssetRevisionOptions = {},
): Promise<AssetRevision> => {
    void options;
    const record = lookupOssAsset(revisionId) ?? lookupOssAsset(assetId);
    return {
        id: revisionId,
        assetId,
        dataUrl: record?.dataUrl,
        format: record?.format,
        contentType: record?.contentType,
        metadata: record?.metadata,
        derivatives: [],
        expiresAt: undefined,
    } as unknown as AssetRevision;
};

export const getAssetRevisionData = async <T extends keyof AssetResponseType = "json">(
    assetId: string,
    revisionId: string,
    responseType: T,
    options: GetAssetRevisionDataOptions = {},
): Promise<AssetResponseType[T]> => {
    void options;
    const record = lookupOssAsset(revisionId) ?? lookupOssAsset(assetId);
    if (record?.dataUrl) {
        try {
            const res = await fetch(record.dataUrl);
            if (responseType === "blob") return (await res.blob()) as never;
            if (responseType === "arraybuffer") return (await res.arrayBuffer()) as never;
            if (responseType === "text") return (await res.text()) as never;
            return (await res.json()) as never;
        } catch {
            // Fall through to the empty-shape default below.
        }
    }
    if (responseType === "blob") return new Blob([]) as never;
    if (responseType === "arraybuffer") return new ArrayBuffer(0) as never;
    if (responseType === "text") return "" as never;
    return {} as never;
};

export const getAssetRevisions = async (
    assetId: string,
    options: GetAssetRevisionsOptions = {},
): Promise<GetAssetRevisionsResponse> => {
    void assetId;
    void options;
    return {revisions: []};
};

export const getMyAssets = async (options: GetMyAssetsOptions = {}): Promise<{assets: Asset[]}> => {
    void options;
    return {assets: []};
};

export const getSceneAssets = async (
    sceneId: string,
    options: GetSceneAssetsOptions = {},
): Promise<{assets: Asset[]}> => {
    const now = new Date().toISOString();
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    const wantTypes = options?.types;
    const assets = getOssAssetsForProject(sceneId)
        .filter(r => !wantTypes?.length || wantTypes.includes(r.type))
        .map(r => ({
            id: r.assetId,
            type: r.type,
            format: r.format,
            name: r.name,
            description: "",
            contentType: r.contentType,
            sceneIds: [sceneId],
            createTime: now,
            updateTime: now,
            userId: OSS_LOCAL_USER_ID,
            headRevisionId: r.revisionId,
            revisionId: r.revisionId,
            dataUrl: r.dataUrl,
            dataUrlExpiresAt: r.dataUrl ? farFuture : undefined,
            thumbnailUrl: r.thumbnailDataUrl,
            revision: {id: r.revisionId, dataUrl: r.dataUrl, derivatives: [], expiresAt: undefined},
        }));
    return {assets: assets as unknown as Asset[]};
};

export const updateAsset = async ({
    assetId,
    name,
    description,
    tags,
    isForkable,
    moderationStatus,
}: UpdateAssetParams): Promise<Asset> => {
    void description;
    void tags;
    void isForkable;
    void moderationStatus;
    const record = lookupOssAsset(assetId);
    if (record && name) {
        record.name = name;
    }
    return getAsset(assetId);
};

export const uploadAssetData = async (
    uploadUrl: string,
    data: string | ArrayBuffer | Blob | ReadableStream,
    contentType: string,
    contentEncoding?: string,
) => {
    void uploadUrl;
    void data;
    void contentType;
    void contentEncoding;
};

/**
 * Convenience function for creating an asset with the given data.
 * Uses inline data for small payloads (<=1 MB) to avoid 3 HTTP round-trips.
 *
 * @param params - Parameters for creating the asset
 * @param params.type - Type of the asset
 * @param params.name - Name of the asset
 * @param params.format - Format of the data (e.g., "glb")
 * @param params.contentType - Content type of the data
 * @param params.data - Data to upload
 * @param params.options - Additional options for asset creation
 * @param params.contentEncoding - Encoding of the data
 * @returns Promise resolving to the created asset
 */
export const createAssetWithData = async ({
    type,
    name,
    format,
    contentType,
    data,
    options = {},
    contentEncoding,
}: CreateAssetWithDataParams) => {
    void contentEncoding;
    const base64 = await dataToBase64(data as string | ArrayBuffer | Blob);
    return createAsset({type, format, contentType, name, data: base64, options});
};

export const createAssetDerivativeWithData = async ({
    assetId,
    revisionId,
    type,
    format,
    contentType,
    data,
    metadata,
    lodLevel,
    contentEncoding,
}: CreateAssetDerivativeWithDataParams) => {
    void contentEncoding;
    const now = new Date().toISOString();
    if (type === DomainDerivativeTypeValue.DerivativeTypeThumbnail && data) {
        try {
            const mime = contentType
                || (format ? `image/${format}` : "image/png");
            const base64 = await dataToBase64(data as string | ArrayBuffer | Blob);
            setOssAssetThumbnail(assetId, `data:${mime};base64,${base64}`);
        } catch (err) {
            console.warn("[createAssetDerivativeWithData] thumbnail encode failed", err);
        }
    }
    return {
        id: `oss-deriv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        assetId,
        revisionId,
        type,
        format,
        contentType,
        metadata,
        lodLevel,
        createTime: now,
        updateTime: now,
    } as unknown as AssetDerivative;
};

/**
 * Convenience function for creating an asset revision with the given data.
 * Uses inline data for small payloads (<=1 MB) to avoid 3 HTTP round-trips.
 *
 * @param params - Parameters for creating the asset revision
 * @param params.assetId - ID of the asset
 * @param params.parentRevisionId - ID of the parent revision
 * @param params.data - Data to upload
 * @param params.format - Format of the data (e.g., "glb", "mp3")
 * @param params.contentType - Content type of the data
 * @param params.options - Additional options for asset revision creation
 * @param params.contentEncoding - Encoding of the data
 * @returns Promise resolving to the committed asset revision
 */
export const createAssetRevisionWithData = async ({
    assetId,
    parentRevisionId,
    data,
    format,
    contentType,
    options = {},
    contentEncoding,
}: CreateAssetRevisionWithDataParams) => {
    void contentEncoding;
    const base64 = await dataToBase64(data as string | ArrayBuffer | Blob);
    return createAssetRevision({
        assetId,
        parentRevisionId,
        data: base64,
        contentType,
        format,
        options,
    });
};

/**
 * Import asset data in batches.
 *
 * @remarks
 * This is a convenience function for importing assets in batches. The function
 * returns a promise resolving to the completed asset imports. They may have
 * succeeded or failed.
 *
 * @param assets - The assets to import
 * @param batchSize - The batch size (max 100)
 * @param onProgress - Optional callback for progress updates (completed, total)
 * @param pollConcurrency - Max number of concurrent import/poll pipelines
 * @returns A promise resolving to the completed asset import jobs.
 */
export const batchImportAssets = async (
    assets: AssetImportItem[],
    batchSize: number = 100,
    onProgress?: (completed: number, total: number) => void,
    pollConcurrency: number = 5,
) => {
    const safeBatchSize = Math.max(1, Math.min(100, batchSize));
    const safePollConcurrency = Math.max(1, pollConcurrency);
    const chunks = chunk(assets, safeBatchSize);
    const total = chunks.length;
    let completedCount = 0;

    // Process batches with bounded concurrency; local imports complete
    // immediately but keep the batching API stable for callers.
    const results = await processWithConcurrencyLimit(
        chunks,
        safePollConcurrency,
        async (chunkItems): Promise<AssetImportJob[]> => {
            const assetImport = await withRetry(() => createAssetImport(chunkItems), {
                operationName: "createAssetImport",
            });
            const finishedImport = await withRetry(() => waitForAssetImport(assetImport.id), {
                operationName: "waitForAssetImport",
            });
            completedCount++;
            onProgress?.(completedCount, total);
            return finishedImport.jobs;
        },
    );

    return results.flat();
};

/**
 * Wait for the specified asset import to complete.
 *
 * @param importId - ID of the asset import
 * @param pollIntervalMs - Interval in milliseconds to poll the import status
 * @returns A promise resolving to the completed asset import.
 */
export const waitForAssetImport = async (importId: string, pollIntervalMs: number = 1000) => {
    void pollIntervalMs;
    return getAssetImport(importId);
};

export const processWithConcurrencyLimit = async <T, R>(
    items: T[],
    concurrencyLimit: number,
    processor: (item: T) => Promise<R>,
): Promise<R[]> => {
    if (items.length === 0) {
        return [];
    }

    const results: Array<R | undefined> = new Array(items.length);
    const maxWorkers = Math.max(1, Math.min(concurrencyLimit, items.length));
    let currentIndex = 0;

    const runNext = async (): Promise<void> => {
        while (currentIndex < items.length) {
            const index = currentIndex++;
            results[index] = await processor(items[index]!);
        }
    };

    await Promise.all(Array.from({length: maxWorkers}, () => runNext()));
    return results as R[];
};

export const isNoChangesError = (error: unknown): boolean => {
    if (isStatusError(error) && error.statusCode === 400) {
        const msg = getErrorMessage(error.body);
        return msg?.toLocaleLowerCase().includes("no changes") ?? false;
    }

    const responseError = error as ResponseError;
    return responseError.response?.status === 400
        && (getErrorMessage(responseError.response.data)?.toLocaleLowerCase().includes("no changes") ?? false);
};

/**
 * Checks whether the given error is a 409 Conflict response.
 * Handles both internal StatusError instances and response-shaped request errors.
 *
 * @param error - The error to check
 * @returns true if the error represents a 409 Conflict
 */
export const isConflictError = (error: unknown): boolean => {
    if (isStatusError(error) && error.statusCode === 409) {
        return true;
    }
    return (error as ResponseError).response?.status === 409;
};

interface StatusError extends Error {
    statusCode: number;
    body: unknown;
}

const isStatusError = (error: unknown): error is StatusError => {
    return error instanceof Error && typeof (error as StatusError).statusCode === "number";
};

const getErrorMessage = (body: unknown): string | null => {
    if (!body || typeof body !== "object") {
        return null;
    }

    const msg = (body as {msg?: unknown}).msg;
    return typeof msg === "string" ? msg : null;
};
