import {QueryClient, useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {useEffect, useState} from "react";

import {
    createAssetRelease,
    createAssetRevisionWithData as rawCreateAssetRevisionWithData,
    getAsset as rawGetAsset,
    getAssetRevisions,
    GetSceneAssetsOptions,
    getSceneAssets,
    createAssetDerivativeWithData,
    getMyAssets,
    GetMyAssetsOptions,
    getAssetReleases as rawGetAssetReleases,
    getAssetRevision as rawGetAssetRevision,
    getAssetRevisionData as rawGetAssetRevisionData,
    GetAssetRevisionOptions,
    getAssetDerivatives,
    AssetDerivativeType,
    AssetResponseType,
    GetAssetRevisionsOptions,
    GetAssetReleasesOptions,
    CreateAssetWithDataParams,
    CreateAssetRevisionWithDataParams,
    createAssetWithData as rawCreateAssetWithData,
    updateAsset,
    GetAssetsOptions,
    getAssets,
    createAssetRevision as rawCreateAssetRevision,
    Asset,
    AssetRevision,
} from "@stem/network/api/asset";
import type {DomainAssetType} from "@stem/network/api/client/api";
import {useAssetResolutionContext} from "@stem/editor-oss/context/AssetResolutionContext";
import {useAssetSource} from "@stem/editor-oss/context/AssetSourceContext";
import global from "@stem/editor-oss/global";
import {queryClient as defaultQueryClient} from "@web-shared/queryClient";
import type {AssetSource} from "../AssetSource";

export const assetKeys = {
    all: ["assets"] as const,

    // -------- Asset lists ----------
    lists: () => [...assetKeys.all, "list"] as const,
    list: (options?: GetAssetsOptions) =>
        options ? ([...assetKeys.lists(), {options}] as const) : assetKeys.lists(),

    myLists: () => [...assetKeys.lists(), "my"] as const,
    myList: (options?: GetMyAssetsOptions) =>
        options ? ([...assetKeys.myLists(), {options}] as const) : assetKeys.myLists(),

    sceneLists: (sceneId: string) => [...assetKeys.lists(), "scene", sceneId] as const,
    sceneList: (sceneId: string, options?: GetSceneAssetsOptions) =>
        options ? ([...assetKeys.sceneLists(sceneId), {options}] as const) : assetKeys.sceneLists(sceneId),

    stemLists: (stemAssetId: string) => [...assetKeys.lists(), "stem", stemAssetId] as const,
    stemList: (stemAssetId: string, options?: GetSceneAssetsOptions) =>
        options ? ([...assetKeys.stemLists(stemAssetId), {options}] as const) : assetKeys.stemLists(stemAssetId),

    // -------- Asset details ----------
    details: () => [...assetKeys.all, "detail"] as const,
    detail: (assetId: string) => [...assetKeys.details(), assetId] as const,

    // -------- Derivatives ----------
    allDerivatives: (assetId: string) => [...assetKeys.all, "derivatives", assetId] as const,
    derivativeLists: (assetId: string) => [...assetKeys.allDerivatives(assetId), "list"] as const,

    // -------- Releases ----------
    allReleases: (assetId: string) => [...assetKeys.all, "releases", assetId] as const,
    releaseLists: (assetId: string) => [...assetKeys.allReleases(assetId), "list"] as const,
    releaseList: (assetId: string, options?: GetAssetReleasesOptions) =>
        options
            ? ([...assetKeys.releaseLists(assetId), {options}] as const)
            : ([...assetKeys.releaseLists(assetId)] as const),

    // -------- Revisions ----------
    allRevisions: (assetId: string) => [...assetKeys.all, "revisions", assetId] as const,
    revisionLists: (assetId: string) => [...assetKeys.allRevisions(assetId), "list"] as const,
    revisionList: (assetId: string, options?: GetAssetRevisionsOptions) =>
        options
            ? ([...assetKeys.revisionLists(assetId), {options}] as const)
            : ([...assetKeys.revisionLists(assetId)] as const),
    revisionDetails: (assetId: string) => [...assetKeys.allRevisions(assetId), "detail"] as const,
    revisionDetail: (assetId: string, revisionId: string, options?: GetAssetRevisionOptions) =>
        options
            ? ([...assetKeys.revisionDetails(assetId), revisionId, {options}] as const)
            : ([...assetKeys.revisionDetails(assetId), revisionId] as const),
    revisionDatas: (assetId: string) => [...assetKeys.allRevisions(assetId), "data"] as const,
    revisionData: (assetId: string, revisionId: string, responseType: keyof AssetResponseType) =>
        [...assetKeys.revisionDatas(assetId), revisionId, responseType] as const,
};

/**
 * Full query key for the active editor context's asset list. Branches on
 * `source.kind` so scene and stem lists share the `assetKeys.lists()` umbrella
 * — mutations that invalidate or patch under `assetKeys.lists()` automatically
 * reach both.
 * @param source The currently active AssetSource (scene or stem).
 * @param options Query options (types, includeDerivatives, etc.) folded into the key.
 * @returns A React Query key scoped to the current editor context.
 */
const editorListKey = (source: AssetSource, options?: GetSceneAssetsOptions) =>
    source.kind === "scene"
        ? assetKeys.sceneList(source.id, options)
        : assetKeys.stemList(source.id, options);

/**
 * Invalidation-scope key for all asset lists under the current editor
 * context. Use for `invalidateQueries({queryKey: editorListsKey(source)})`
 * after a mutation that could affect every list variant for this scene/stem.
 * @param source The currently active AssetSource (scene or stem).
 * @returns A React Query key that matches every list variant for this context.
 */
const editorListsKey = (source: AssetSource) =>
    source.kind === "scene" ? assetKeys.sceneLists(source.id) : assetKeys.stemLists(source.id);

/**
 * Merge an updated asset into a cached one, preserving include-gated fields.
 * @param cached - The existing cached asset
 * @param updated - The freshly returned asset from the API
 */
const mergeAssetForCache = (cached: Asset, updated: Asset): Asset => ({
    ...cached,
    ...updated,
    thumbnailUrl: updated.thumbnailUrl ?? cached.thumbnailUrl,
    latestRelease: updated.latestRelease ?? cached.latestRelease,
    derivatives: updated.derivatives ?? cached.derivatives,
    revisionId: updated.revisionId ?? cached.revisionId,
});

/**
 * Patch an asset in-place across the detail cache and all list caches.
 * @param queryClient - The React Query client
 * @param assetId - The asset to patch
 * @param patch - Fields to merge into the cached asset
 */
const patchAssetInCaches = (
    queryClient: QueryClient,
    assetId: string,
    patch: Partial<Asset>,
) => {
    queryClient.setQueryData<Asset>(assetKeys.detail(assetId), (old) => {
        if (!old) return old;
        return {...old, ...patch};
    });
    queryClient.setQueriesData<{assets: Asset[]}>(
        {queryKey: assetKeys.lists()},
        (old) => {
            if (!old?.assets) return old;
            const idx = old.assets.findIndex((a) => a.id === assetId);
            if (idx === -1) return old;
            const assets = [...old.assets];
            assets[idx] = {...assets[idx]!, ...patch};
            return {...old, assets};
        },
    );
};

export type CreateAssetParams = CreateAssetWithDataParams & {
    assetSource?: AssetSource;
    /** For batch imports: add dependency context immediately, but defer objectChanged to the batch flush. */
    deferAssetSourceSceneSync?: boolean;
};

/**
 * Creates an asset, updates caches, and fires events.
 *
 * When an AssetSource is provided, the asset is created through the source
 * (which handles adding it as a dependency for the current editing context).
 * When no source is provided, the asset is created standalone.
 * @param params
 */
export const createAsset = async (params: CreateAssetParams): Promise<Asset> => {
    const {assetSource, deferAssetSourceSceneSync, ...assetParams} = params;

    const asset = assetSource
        ? await assetSource.createAsset(
            deferAssetSourceSceneSync
                ? {...assetParams, deferSceneSync: true}
                : assetParams,
        )
        : await rawCreateAssetWithData(assetParams);

    // Seed the detail cache so subsequent fetches are instant
    defaultQueryClient.setQueryData(assetKeys.detail(asset.id), asset);

    // Invalidate list queries
    void defaultQueryClient.invalidateQueries({queryKey: assetKeys.lists()});

    if (assetSource) {
        void defaultQueryClient.invalidateQueries({queryKey: editorListsKey(assetSource)});
    }

    global.app?.call("sceneAssetChanged", null);
    return asset;
};

/**
 * Creates a new asset revision and updates caches.
 *
 * @param params - Revision creation parameters (same as raw API)
 * @returns The created revision
 */
export const createAssetRevision = async (params: CreateAssetRevisionWithDataParams): Promise<AssetRevision> => {
    const revision = await rawCreateAssetRevisionWithData(params);

    // Patch headRevisionId and updateTime in detail + list caches
    patchAssetInCaches(defaultQueryClient, revision.assetId, {
        headRevisionId: revision.id,
        updateTime: revision.createTime,
    });

    // Invalidate revision list queries
    void defaultQueryClient.invalidateQueries({queryKey: assetKeys.revisionLists(revision.assetId)});

    return revision;
};

/**
 * Add dependencies via the current AssetSource (scene or stem).
 * The AssetSource implementation handles updating the resolution context.
 */
export const useAddEditorDependencies = () => {
    const queryClient = useQueryClient();
    const assetSource = useAssetSource();

    return useMutation({
        mutationFn: (newDependencies: Record<string, string>) => {
            if (!assetSource) throw new Error("No asset source available");
            return assetSource.addDependencies(newDependencies);
        },
        onSuccess: () => {
            if (assetSource) {
                queryClient.invalidateQueries({queryKey: editorListsKey(assetSource)}).catch(console.error);
            }
        },
    });
};

/**
 * Remove dependencies via the current AssetSource (scene or stem).
 * The AssetSource implementation handles updating the resolution context.
 */
export const useRemoveEditorDependencies = () => {
    const queryClient = useQueryClient();
    const assetSource = useAssetSource();

    return useMutation({
        mutationFn: (assetIds: string[]) => {
            if (!assetSource) throw new Error("No asset source available");
            return assetSource.removeDependencies(assetIds);
        },
        onSuccess: () => {
            if (assetSource) {
                queryClient.invalidateQueries({queryKey: editorListsKey(assetSource)}).catch(console.error);
            }
        },
    });
};

export const useAsset = (assetId: string) => {
    return useQuery({
        queryKey: assetKeys.detail(assetId),
        queryFn: () => rawGetAsset(assetId),
    });
};

export const useAssetRevisions = (assetId: string, options?: GetAssetRevisionsOptions) => {
    // Enable certain options by default to reduce the number of unique queries
    // and improve cache hit rates.
    const cacheFriendlyOptions = {
        ...options,

        // Always include the release
        includeRelease: true,
    };

    return useQuery({
        queryKey: assetKeys.revisionList(assetId, cacheFriendlyOptions),
        queryFn: () => getAssetRevisions(assetId, cacheFriendlyOptions),
        enabled: !!assetId,
    });
};

export const useCreateAssetWithData = () => {
    const assetSource = useAssetSource();
    return useMutation({
        mutationFn: (params: CreateAssetWithDataParams) =>
            createAsset({...params, assetSource: assetSource ?? undefined}),
    });
};

export const useCreateAssetDerivativeWithData = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: createAssetDerivativeWithData,
        onSuccess: ({assetId}) => {
            // There should be a new derivative for the asset
            queryClient.invalidateQueries({queryKey: assetKeys.derivativeLists(assetId)}).catch(console.error);
        },
    });
};

export const useCreateAssetRelease = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: createAssetRelease,
        onSuccess: ({assetId, revisionId}) => {
            // There should be a new release for the asset
            queryClient.invalidateQueries({queryKey: assetKeys.releaseLists(assetId)}).catch(console.error);
            // There will now be release information on the asset ("latestRelease")
            queryClient.invalidateQueries({queryKey: assetKeys.detail(assetId)}).catch(console.error);
            // There will now be release information on the revision
            queryClient
                .invalidateQueries({queryKey: assetKeys.revisionDetail(assetId, revisionId)})
                .catch(console.error);
            queryClient.invalidateQueries({queryKey: assetKeys.revisionLists(assetId)}).catch(console.error);
        },
    });
};

export const useCreateAssetRevision = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: rawCreateAssetRevision,
        onSuccess: (revision) => {
            // Patch headRevisionId and updateTime in detail + list caches
            patchAssetInCaches(queryClient, revision.assetId, {
                headRevisionId: revision.id,
                updateTime: revision.createTime,
            });
            // There should be a new revision for the asset
            queryClient.invalidateQueries({queryKey: assetKeys.revisionLists(revision.assetId)}).catch(console.error);
        },
    });
};

export const useCreateAssetRevisionWithData = () => {
    return useMutation({
        mutationFn: createAssetRevision,
    });
};

export const useGetAsset = () => {
    const queryClient = useQueryClient();
    return (assetId: string) => getAsset(queryClient, assetId);
};

const ASSET_DETAIL_STALE_TIME = 30_000;

export const getAsset = async (queryClient: QueryClient, assetId: string) => {
    return queryClient.fetchQuery({
        queryKey: assetKeys.detail(assetId),
        queryFn: () => rawGetAsset(assetId),
        staleTime: ASSET_DETAIL_STALE_TIME,
    });
};

type RefreshAssetOptions = {
    /** Refresh the asset's derivatives */
    refreshDerivatives?: boolean;

    /** Refresh lists that the asset is in */
    refreshLists?: boolean;

    /** Refresh the asset's revisions */
    refreshRevisions?: boolean;
};

export const refreshAsset = (
    queryClient: QueryClient,
    assetId: string,
    options: RefreshAssetOptions = {},
) => {
    return Promise.all([
        queryClient.invalidateQueries({queryKey: assetKeys.detail(assetId)}),
        ...options.refreshDerivatives
            ? [queryClient.invalidateQueries({queryKey: assetKeys.derivativeLists(assetId)})]
            : [],
        ...options.refreshLists
            ? [queryClient.invalidateQueries({queryKey: assetKeys.lists()})]
            : [],
        ...options.refreshRevisions
            ? [queryClient.invalidateQueries({queryKey: assetKeys.revisionLists(assetId)})]
            : [],
    ]);
};

export const useGetAssetReleases = () => {
    const queryClient = useQueryClient();
    return (assetId: string, options?: GetAssetReleasesOptions) => getAssetReleases(queryClient, assetId, options);
};

export const getAssetReleases = async (
    queryClient: QueryClient,
    assetId: string,
    options: GetAssetReleasesOptions = {},
) => {
    return queryClient.fetchQuery({
        queryKey: assetKeys.releaseList(assetId, options),
        queryFn: () => rawGetAssetReleases(assetId, options),
    });
};

export const useGetAssetRevision = () => {
    const queryClient = useQueryClient();
    return (assetId: string, revisionId: string, options?: GetAssetRevisionOptions) =>
        getAssetRevision(queryClient, assetId, revisionId, options);
};

export const getAssetRevision = async (
    queryClient: QueryClient,
    assetId: string,
    revisionId: string,
    options: GetAssetRevisionOptions = {},
) => {
    // Enable certain options by default to reduce the number of unique queries
    // and improve cache hit rates.
    const cacheFriendlyOptions = {
        ...options,

        // Always include the release
        includeRelease: true,
    };

    return queryClient.fetchQuery({
        queryKey: assetKeys.revisionDetail(assetId, revisionId, cacheFriendlyOptions),
        queryFn: () => rawGetAssetRevision(assetId, revisionId, cacheFriendlyOptions),
    });
};

export const useGetAssetRevisionData = () => {
    const queryClient = useQueryClient();
    return (assetId: string, revisionId: string, responseType: keyof AssetResponseType = "json") =>
        getAssetRevisionData(queryClient, assetId, revisionId, responseType);
};

export const getAssetRevisionData = async (
    queryClient: QueryClient,
    assetId: string,
    revisionId: string,
    responseType: keyof AssetResponseType = "json",
) => {
    return queryClient.fetchQuery({
        queryKey: assetKeys.revisionData(assetId, revisionId, responseType),
        queryFn: () => rawGetAssetRevisionData(assetId, revisionId, responseType),
        // Never expire unless explicitly invalidated
        staleTime: Number.POSITIVE_INFINITY,
    });
};

/**
 * Hook for fetching assets accessible to the current user with pagination support.
 *
 * @param options - Options for filtering and pagination
 * @param options.owner - Filter by owner: 'me' (user's assets only) or 'all' (user's + released assets)
 * @param options.types - Optional array of asset types to filter by
 * @param options.page - Page number (default: 1)
 * @param options.limit - Number of items per page (default: 20, max: 100)
 * @param options.sort - Sort order for update time: 'asc' or 'desc' (default: 'desc')
 * @returns Query result with assets, totalCount, page, and limit
 *
 * @example
 * ```tsx
 * const [page, setPage] = useState(1);
 * const { data, isLoading } = useListAssets({ page, limit: 20 });
 *
 * // Access pagination info
 * const totalPages = Math.ceil((data?.totalCount ?? 0) / (data?.limit ?? 20));
 * ```
 */
export const useListAssets = (options: GetAssetsOptions) => {
    return useQuery({
        queryKey: assetKeys.list(options),
        queryFn: () => getAssets(options),
    });
};

export const useListMyAssets = (options: GetMyAssetsOptions) => {
    return useQuery({
        queryKey: assetKeys.myList(options),
        queryFn: () => getMyAssets(options),
    });
};

// Build cache-friendly options that normalize defaults so different callers
// share the same React Query cache entry. `types` is stripped — callers
// filter client-side via `select` so one cache entry serves every type
// filter variant.
const buildEditorAssetQueryOptions = (options?: GetSceneAssetsOptions) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const {types, ...rest} = options || {};
    return {
        // Default values that can be overridden by callers
        includeDerivatives: false,
        includeDerivativeDataUrl: false,

        // Overrides
        ...rest,

        // Default values that shouldn't be overridden
        includeThumbnails: true,
        includeLatestRelease: true,
    };
};

export type ListSceneAssetsOptions = GetSceneAssetsOptions & {
    enabled?: boolean;
};

export type ListEditorAssetsOptions = {
    types?: DomainAssetType[];
    enabled?: boolean;
    includeDerivatives?: boolean;
    includeDerivativeDataUrl?: boolean;
    includeThumbnails?: boolean;
    includeLatestRelease?: boolean;
};

/**
 * Query available assets from the current editing context (scene or stem).
 * Uses the AssetSource from React context for discovery, so callers don't
 * need to know whether the backing source is a scene or a stem.
 *
 * Falls back to disabled when no AssetSource is provided.
 * @param options
 */
export const useListEditorAssets = (options: ListEditorAssetsOptions = {}) => {
    const assetSource = useAssetSource();
    const {enabled = true, types} = options;
    const cacheFriendlyOptions = buildEditorAssetQueryOptions(options);

    return useQuery({
        queryKey: assetSource ? editorListKey(assetSource, cacheFriendlyOptions) : ["editorAssets", "none"],
        queryFn: () => assetSource!.getAssets(cacheFriendlyOptions),
        enabled: enabled && !!assetSource,
        // Filter by types client-side so callers with different type
        // filters share one cache entry.
        select: types?.length
            ? (data: {assets: Asset[]}) => ({...data, assets: data.assets.filter((a: Asset) => types.includes(a.type))})
            : undefined,
    });
};

export const useListSceneAssets = (sceneId: string, options: ListSceneAssetsOptions = {}) => {
    const {enabled, types} = options;
    const cacheFriendlyOptions = buildEditorAssetQueryOptions(options);

    return useQuery({
        queryKey: assetKeys.sceneList(sceneId, cacheFriendlyOptions),
        queryFn: () => getSceneAssets(sceneId, cacheFriendlyOptions),
        enabled,
        // Filter by types client-side
        select: types?.length
            ? (data) => ({...data, assets: data.assets.filter((a: any) => types.includes(a.type))})
            : undefined,
    });
};

const EDITOR_ASSETS_STALE_TIME = 30_000;

/**
 * Imperative counterpart to `useListEditorAssets`. Fetches assets for the
 * given editor context (scene or stem) and caches under the shared
 * editor-list key. Use from non-React call sites (behavior attribute
 * converters, importer tooling) that have access to an `AssetSource`.
 */
export const listEditorAssets = async (
    queryClient: QueryClient,
    source: AssetSource,
    options?: GetSceneAssetsOptions,
) => {
    const cacheFriendlyOptions = buildEditorAssetQueryOptions(options);

    const data = await queryClient.fetchQuery({
        queryKey: editorListKey(source, cacheFriendlyOptions),
        queryFn: () => source.getAssets(cacheFriendlyOptions),
        staleTime: EDITOR_ASSETS_STALE_TIME,
    });

    // Filter by types client-side
    if (options?.types?.length) {
        return {...data, assets: data.assets.filter((a: any) => options.types!.includes(a.type))};
    }

    return data;
};

export const useUpdateAsset = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: updateAsset,
        onSuccess: (asset) => {
            // Update detail cache with the full response
            queryClient.setQueryData(assetKeys.detail(asset.id), asset);
            // Patch the asset in all list caches, preserving include-gated fields
            queryClient.setQueriesData<{assets: Asset[]}>(
                {queryKey: assetKeys.lists()},
                (old) => {
                    if (!old?.assets) return old;
                    const idx = old.assets.findIndex((a) => a.id === asset.id);
                    if (idx === -1) return old;
                    const assets = [...old.assets];
                    assets[idx] = mergeAssetForCache(assets[idx]!, asset);
                    return {...old, assets};
                },
            );
        },
    });
};

export const fetchAssetImageDerivative = async (
    assetId: string,
    revisionId?: string,
    context?:
        | ReturnType<typeof useAssetResolutionContext>["context"]
        | Readonly<{
              readonly logicalIdToAssetId?: Readonly<Record<string, string>>;
              readonly assetIdToRevisionId?: Readonly<Record<string, string>>;
          }>
        | null,
): Promise<string> => {
    if (!assetId) throw new Error("No assetId provided");
    const resolvedRevisionId = revisionId || context?.assetIdToRevisionId?.[assetId];
    if (!resolvedRevisionId) throw new Error("Cannot resolve revision ID");

    const derivatives = await getAssetDerivatives(assetId, resolvedRevisionId, {includeDataUrl: true});
    const imageDerivative = derivatives.find(d => d.type === AssetDerivativeType.Image);

    if (imageDerivative?.dataUrl) return imageDerivative.dataUrl;

    // No image derivative — fall back to the revision's inline data URL, the
    // same fallback AssetLoader.getImageDataUrl uses. This is the *only* path
    // that works locally: there is no hosted CDN, so getAssetDerivatives
    // always returns [] and the image bytes live inline as a data: URL on the
    // synthesized revision record. (It also covers server-backed cases where a
    // derivative simply hasn't been generated yet.) Without this, textures
    // resolved through this fallback — e.g. an OceanSurface base map whose
    // revision id isn't in the resolution context, so materialUtils skips the
    // assetLoader path — never render.
    const revision = await getAssetRevision(defaultQueryClient, assetId, resolvedRevisionId, {
        includeDataUrl: true,
    });
    if (revision?.dataUrl) return revision.dataUrl;

    throw new Error("Image derivative missing dataUrl");
};

export const useAssetImageDerivative = (assetId?: string, revisionId?: string) => {
    const {context} = useAssetResolutionContext();
    const [url, setUrl] = useState<string | undefined>(undefined);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<unknown>(undefined);

    useEffect(() => {
        if (!assetId) return;

        let isMounted = true;

        setIsLoading(true);
        setError(undefined);

        fetchAssetImageDerivative(assetId, revisionId, context)
            .then(dataUrl => {
                if (isMounted) setUrl(dataUrl);
            })
            .catch(err => {
                console.error(err);
                if (isMounted) setError(err);
            })
            .finally(() => {
                if (isMounted) setIsLoading(false);
            });

        return () => {
            isMounted = false;
        };
    }, [assetId, revisionId, context]);

    return {url, isLoading, error};
};

/**
 * Seed the revision data cache so subsequent reads are instant.
 * @param queryClient - The React Query client
 * @param assetId - The asset to seed data for
 * @param revisionId - The revision to seed data for
 * @param responseType - The response type key (e.g. "json")
 * @param data - The data to cache
 */
export const seedAssetRevisionData = (
    queryClient: QueryClient,
    assetId: string,
    revisionId: string,
    responseType: keyof AssetResponseType,
    data: AssetResponseType[typeof responseType],
) => {
    queryClient.setQueryData(
        assetKeys.revisionData(assetId, revisionId, responseType),
        data,
    );
};

export const refreshEditorAssets = (queryClient: QueryClient, source: AssetSource) => {
    return queryClient.invalidateQueries({queryKey: editorListsKey(source)});
};
