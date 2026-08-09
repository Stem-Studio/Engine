import type {DomainAssetType} from "../client/api";

/**
 * In-memory local asset registry.
 *
 * The local runtime has no hosted asset service: every `create*` call synthesizes an
 * asset record whose payload is an inline `data:` URL. The synthesized URL
 * *is* the asset's storage — but a caller that only kept the asset id (e.g.
 * the script-import pipeline, which does `createModelWithData()` then
 * `loadModel(asset.id)`) has no way to recover that URL, and the local
 * `getAsset`/`getAssetRevision` branches used to return `dataUrl: undefined`.
 * That made `AssetLoader.getModelDataUrl` throw "No data URL found", so
 * imported models never reached the scene.
 *
 * Keeping the synthesized records here — keyed by both asset id and revision
 * id — lets the local read paths return the real payload. Entries live for the
 * session; the data is also serialized inline into the scene JSON on save, so
 * a reloaded project is self-contained without this registry.
 */
export type OssAssetRecord = {
    assetId: string;
    revisionId: string;
    type: DomainAssetType;
    format: string;
    name: string;
    contentType?: string;
    metadata?: Record<string, unknown>;
    dataUrl?: string;
    /**
     * Inline thumbnail derivative as a `data:` URL. There is no derivative
     * service in this repository, so we attach the thumbnail bytes directly to
     * the parent asset record. The read paths (`getAsset`, `getSceneAssets`)
     * surface it as `thumbnailUrl` and the AssetsList <img src> renders inline.
     */
    thumbnailDataUrl?: string;
    /**
     * Scene/project id this asset was created for, when known. Set for
     * scene-scoped assets (models, images, audio imported into a scene) so
     * the persistence layer can save/restore a project's assets. Absent for
     * non-scene assets (e.g. behavior bundles, which persist inline in the
     * scene JSON instead).
     */
    projectId?: string;
};

export type OssAssetRegistry = Map<string, OssAssetRecord>;

const OSS_ASSET_REGISTRY_GLOBAL_KEY = "__STEM_OSS_ASSET_REGISTRY__";

type OssAssetRegistryGlobal = typeof globalThis & {
    [OSS_ASSET_REGISTRY_GLOBAL_KEY]?: OssAssetRegistry;
};

export const createOssAssetRegistry = (): OssAssetRegistry => new Map<string, OssAssetRecord>();

const getGlobalOssAssetRegistry = (): OssAssetRegistry => {
    const host = globalThis as OssAssetRegistryGlobal;
    if (!host[OSS_ASSET_REGISTRY_GLOBAL_KEY]) {
        host[OSS_ASSET_REGISTRY_GLOBAL_KEY] = createOssAssetRegistry();
    }
    return host[OSS_ASSET_REGISTRY_GLOBAL_KEY];
};

let activeOssAssetRegistry: OssAssetRegistry = getGlobalOssAssetRegistry();

export const getOssAssetRegistry = (): OssAssetRegistry => activeOssAssetRegistry;

export const setOssAssetRegistry = (registry: OssAssetRegistry): void => {
    activeOssAssetRegistry = registry;
    (globalThis as OssAssetRegistryGlobal)[OSS_ASSET_REGISTRY_GLOBAL_KEY] = registry;
};

export const resetOssAssetRegistryForTests = (): void => {
    const registry = createOssAssetRegistry();
    setOssAssetRegistry(registry);
};

/** Record a synthesized local asset so the read paths can recover its payload. */
export const registerOssAsset = (record: OssAssetRecord): void => {
    const ossAssetRegistry = getOssAssetRegistry();
    ossAssetRegistry.set(record.assetId, record);
    ossAssetRegistry.set(record.revisionId, record);
};

/**
 * Attach a thumbnail data URL to an existing synthesized local asset record without
 * clobbering its other fields. Used by the local branch of
 * `createAssetDerivativeWithData` when a server-backed path would have
 * created a Thumbnail derivative. No-op (with a warning) when the parent
 * asset isn't in the registry — that would indicate the caller wrote a
 * derivative for an asset created outside the local synth path.
 */
export const setOssAssetThumbnail = (assetId: string, thumbnailDataUrl: string): void => {
    const ossAssetRegistry = getOssAssetRegistry();
    const existing = ossAssetRegistry.get(assetId);
    if (!existing) {
        console.warn(`[ossAssetRegistry] setOssAssetThumbnail: no record for ${assetId}`);
        return;
    }
    existing.thumbnailDataUrl = thumbnailDataUrl;
    // Both the assetId-keyed and revisionId-keyed entries point at the
    // same object reference, so mutating one is enough.
};

/** Look up a synthesized local asset by either its asset id or revision id. */
export const lookupOssAsset = (idOrRevisionId: string): OssAssetRecord | undefined =>
    getOssAssetRegistry().get(idOrRevisionId);

/**
 * Drop a synthesized local asset from the registry (both its asset-id and
 * revision-id keys). Used by behavior-import de-duplication to collapse
 * surplus same-named behavior records down to a single latest one — local storage has no
 * revision history, so duplicates created by earlier imports are pure noise.
 * After removal the record no longer surfaces in `getOssAssetsForProject`, so it
 * drops out of the asset list and is not re-persisted on the next project save.
 */
export const unregisterOssAsset = (assetId: string): void => {
    const ossAssetRegistry = getOssAssetRegistry();
    const record = ossAssetRegistry.get(assetId);
    ossAssetRegistry.delete(assetId);
    if (record?.revisionId) ossAssetRegistry.delete(record.revisionId);
};

/**
 * Every synthesized local asset created for a given project, de-duplicated.
 * Used by the persistence layer to write a project's binary assets to the
 * ProjectStore so they survive a reload.
 */
export const getOssAssetsForProject = (projectId: string): OssAssetRecord[] => {
    const ossAssetRegistry = getOssAssetRegistry();
    const seen = new Set<string>();
    const out: OssAssetRecord[] = [];
    for (const record of ossAssetRegistry.values()) {
        if (record.projectId !== projectId) continue;
        if (seen.has(record.assetId)) continue;
        seen.add(record.assetId);
        out.push(record);
    }
    return out;
};
