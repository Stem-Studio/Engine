import type {Texture} from 'three';
import {TextureLoader} from 'three';

import {AssetRef, assetRefKey} from './AssetRef';
import {SignedUrlCache} from './SignedUrlCache';
import {AssetDerivative, AssetDerivativeType, AssetRevision, getAsset, getAssetDerivatives, getAssetRevision} from '@stem/network/api/asset';
import {QualityManager} from '../core/quality/QualityManager';
import {
    isGpuResourceManaged,
    releaseGpuResourcesForOwner,
    retainGpuResources,
} from '../core/resources/GpuResourceOwnership';
import {getBestLodForPlatform} from '../model/lod';
import {DetectDevice} from '../utils/DetectDevice';

// Buffer time before URL expiration to trigger refresh (5 minutes)
const EXPIRATION_BUFFER_MS = 5 * 60 * 1000;

/** Renderer type that KTX2Loader can use (WebGLRenderer or WebGPURenderer) */
type KTX2CompatibleRenderer = {
    isWebGPURenderer?: boolean;
    capabilities?: {
        getMaxAnisotropy?: () => number;
    };
};
type KTX2LoaderInstance = InstanceType<typeof import('three/addons/loaders/KTX2Loader.js').KTX2Loader>;

export interface AssetLoaderOptions {
    /** Override automatic LOD level detection */
    preferredLodLevel?: number;
    /** Getter for renderer, used for KTX2 texture support. Called lazily when needed. */
    getRenderer?: () => KTX2CompatibleRenderer | null;
}

export interface AssetPrefetchOptions {
    /** Number of concurrent fetch operations */
    concurrency?: number;
    /** When true, ensure derivatives are available in cache */
    includeDerivatives?: boolean;
    /** Continue prefetching other assets if one fetch fails */
    continueOnError?: boolean;
}

export interface ModelDataUrlResult {
    /** The signed CDN URL for loading the model data */
    url: string;
    /** The format of the model (e.g., 'glb', 'gltf') */
    format: string;
    /** MIME type of the returned payload, when known */
    contentType?: string;
    /** The LOD level used, if a derivative was selected */
    lodLevel?: number;
    /** Immutable revision metadata when the original revision payload is used */
    metadata?: Record<string, unknown>;
}

export interface ImageDataUrlResult {
    /** The signed CDN URL for loading the image data */
    url: string;
    /** The format of the image (e.g., 'png', 'jpg') */
    format: string;
}

/** Minimal asset shape used by AssetLoader for caching and derivative resolution. */
export interface CachedAsset {
    id: string;
    revisionId?: string;
    format: string;
    contentType?: string;
    derivatives?: AssetDerivative[];
    /** Signed data URL for the revision payload. */
    dataUrl?: string;
    /** ISO expiry timestamp for dataUrl. */
    dataUrlExpiresAt?: string;
}

/**
 * AssetLoader manages asset metadata caching and provides efficient access to
 * asset data during scene loading.
 *
 * Key features:
 * - Caches asset metadata (with derivatives and signed URLs) by AssetRef (assetId + revisionId)
 * - Deduplicates concurrent requests for the same asset
 * - Selects appropriate model derivatives based on device capabilities
 * - Automatically refreshes derivative URLs when they expire
 * - Provides direct CDN URLs for efficient global access
 *
 * @example
 * ```typescript
 * // Create loader
 * const assetLoader = new AssetLoader();
 *
 * // Seed cache before scene load (optional but recommended)
 * const assets = await getSceneAssets(sceneId, { includeDerivatives: true, includeDerivativeDataUrl: true });
 * assetLoader.seedFromAssets(assets.assets);
 *
 * // Get model URL during deserialization
 * const result = await assetLoader.getModelDataUrl({ assetId, revisionId });
 * ```
 */
export class AssetLoader {
    private assetCache: Map<string, CachedAsset> = new Map();
    private pendingRequests: Map<string, Promise<CachedAsset>> = new Map();
    private revisionCache: Map<string, AssetRevision> = new Map();
    private pendingRevisionRequests: Map<string, Promise<AssetRevision>> = new Map();
    private pendingDerivativeRefresh: Map<string, Promise<AssetDerivative[]>> = new Map();
    private urlCache = new SignedUrlCache();
    // Signed URLs to use *after* a urlCache miss
    private nextUrls: Map<string, { url: string; expiresAt: string }> = new Map();
    private textureCache: Map<string, Texture> = new Map();
    private readonly textureCacheOwner = {};
    private textureLoader: TextureLoader = new TextureLoader();
    private ktx2Loader: KTX2LoaderInstance | null = null;
    private ktx2LoaderPromise: Promise<KTX2LoaderInstance> | null = null;
    private ktx2LoaderRenderer: KTX2CompatibleRenderer | null = null;
    private options: AssetLoaderOptions;

    /**
     * Creates a new AssetLoader instance.
     *
     * @param options - Configuration options for the loader
     */
    constructor(options: AssetLoaderOptions = {}) {
        this.options = options;
    }

    private derivativeUrlKey(d: AssetDerivative): string {
        return `d:${d.assetId}:${d.revisionId}:${d.id}`;
    }

    private revisionUrlKey(ref: AssetRef): string {
        return `r:${ref.assetId}:${ref.revisionId}`;
    }

    /**
     * Select the best derivative and resolve the signed URL through the tiered
     * cache (localStorage → nextUrls → network refresh).
     *
     * @param ref - The asset reference (assetId + revisionId)
     * @param derivatives - The asset's current derivatives (may be undefined if not yet fetched)
     * @param selectFn - Callback to pick the best derivative from a list
     * @returns The selected derivative with a valid URL, or null if none found
     */
    private async resolveDerivativeUrl(
        ref: AssetRef,
        derivatives: AssetDerivative[] | undefined,
        selectFn: (derivatives: AssetDerivative[]) => AssetDerivative | null,
    ): Promise<AssetDerivative | null> {
        // undefined means not fetched; empty array means none exist
        if (derivatives === undefined) {
            derivatives = await this.refreshAssetDerivatives(ref);
        }

        let derivative = selectFn(derivatives);

        if (derivative && this.isUrlExpired(derivative.expiresAt)) {
            // Tier 2: try "next" URL before hitting network
            const urlKey = this.derivativeUrlKey(derivative);
            const next = this.nextUrls.get(urlKey);
            if (next && !this.isUrlExpired(next.expiresAt)) {
                derivative.dataUrl = next.url;
                derivative.expiresAt = next.expiresAt;
                this.urlCache.set(urlKey, next.url, next.expiresAt);
                this.urlCache.flush();
                this.nextUrls.delete(urlKey);
            } else {
                // Tier 3: network refresh
                const freshDerivatives = await this.refreshAssetDerivatives(ref);
                derivative = selectFn(freshDerivatives);
            }
        }

        return derivative;
    }

    /**
     * Seed the cache from a batch of assets (e.g., from getSceneAssets()).
     * Call this before scene deserialization to avoid N+1 API requests.
     * Assets should include revisionId, derivatives with dataUrl and expiresAt fields.
     * Assets without a revisionId are skipped with a warning.
     *
     * @param assets - Array of assets to add to the cache
     */
    seedFromAssets(assets: CachedAsset[]): void {
        let seededCount = 0;
        for (const asset of assets) {
            if (!asset.revisionId) {
                console.warn(`[AssetLoader] Skipping asset ${asset.id} - no revisionId`);
                continue;
            }
            const key = assetRefKey({ assetId: asset.id, revisionId: asset.revisionId });
            this.assetCache.set(key, asset);
            seededCount++;

            // Seed revision data URL if provided
            if (asset.dataUrl && asset.dataUrlExpiresAt) {
                this.seedRevisionUrl(asset.id, asset.revisionId, asset.dataUrl, asset.dataUrlExpiresAt);
            }

            // Tiered URL caching for derivatives
            if (!asset.derivatives) {
                continue;
            }

            for (const derivative of asset.derivatives) {
                if (!derivative.dataUrl || !derivative.expiresAt) {
                    continue;
                }

                const urlKey = this.derivativeUrlKey(derivative);
                const cached = this.urlCache.get(urlKey);
                if (cached) {
                    // Tier 1 hit: use cached URL for HTTP cache benefit
                    // Store seed URL as tier 2 for when cached expires
                    this.nextUrls.set(urlKey, { url: derivative.dataUrl, expiresAt: derivative.expiresAt });
                    derivative.dataUrl = cached.url;
                    derivative.expiresAt = cached.expiresAt;
                } else {
                    // No cache hit: store seed URL in localStorage
                    this.urlCache.set(urlKey, derivative.dataUrl, derivative.expiresAt);
                }
            }
        }
        this.urlCache.flush();
        console.debug(`[AssetLoader] Seeded cache with ${seededCount} assets`);
    }

    /**
     * Seed the revision URL cache with a fresh signed URL.
     * If a URL for this revision is already cached, the existing URL is
     * preserved (so the browser's HTTP cache can be reused) and the fresh
     * URL is stored as a tier-2 backup in nextUrls for when the cached one
     * expires.
     *
     * @param assetId - The asset ID
     * @param revisionId - The revision ID
     * @param url - Fresh signed CDN URL for this revision
     * @param expiresAt - ISO expiry timestamp for the URL
     */
    seedRevisionUrl(assetId: string, revisionId: string, url: string, expiresAt: string): void {
        const urlKey = this.revisionUrlKey({ assetId, revisionId });
        const cached = this.urlCache.get(urlKey);
        if (cached) {
            // Preserve old URL for browser HTTP cache; store fresh one as backup
            this.nextUrls.set(urlKey, { url, expiresAt });
        } else {
            this.urlCache.set(urlKey, url, expiresAt);
            this.urlCache.flush();
        }
    }

    /**
     * Get the best available signed URL for an asset revision.
     * Returns the cached URL if still valid (preferred, for browser HTTP cache
     * continuity), otherwise falls back to the tier-2 nextUrls entry.
     *
     * @param assetId - The asset ID
     * @param revisionId - The revision ID
     * @returns A valid signed URL, or null if none is cached or all are expired
     */
    getRevisionUrl(assetId: string, revisionId: string): string | null {
        const urlKey = this.revisionUrlKey({ assetId, revisionId });
        const cached = this.urlCache.get(urlKey);
        if (cached && !this.isUrlExpired(cached.expiresAt)) {
            return cached.url;
        }
        const next = this.nextUrls.get(urlKey);
        return (next && !this.isUrlExpired(next.expiresAt)) ? next.url : null;
    }

    /**
     * Seed the derivative URL cache with a fresh signed URL.
     * Uses the same two-tier pattern as seedRevisionUrl.
     *
     * @param assetId - The asset ID the derivative belongs to
     * @param revisionId - The revision ID the derivative belongs to
     * @param derivativeId - The derivative's own ID
     * @param url - Fresh signed CDN URL for this derivative
     * @param expiresAt - ISO expiry timestamp for the URL
     */
    seedDerivativeUrl(assetId: string, revisionId: string, derivativeId: string, url: string, expiresAt: string): void {
        const urlKey = this.derivativeUrlKey({ assetId, revisionId, id: derivativeId } as AssetDerivative);
        const cached = this.urlCache.get(urlKey);
        if (cached) {
            this.nextUrls.set(urlKey, { url, expiresAt });
        } else {
            this.urlCache.set(urlKey, url, expiresAt);
            this.urlCache.flush();
        }
    }

    /**
     * Get the best available signed URL for a specific derivative.
     * Returns the cached URL if still valid, otherwise falls back to nextUrls.
     *
     * @param assetId - The asset ID the derivative belongs to
     * @param revisionId - The revision ID the derivative belongs to
     * @param derivativeId - The derivative's own ID
     * @returns A valid signed URL, or null if none is cached or all are expired
     */
    getDerivativeUrl(assetId: string, revisionId: string, derivativeId: string): string | null {
        const urlKey = this.derivativeUrlKey({ assetId, revisionId, id: derivativeId } as AssetDerivative);
        const cached = this.urlCache.get(urlKey);
        if (cached && !this.isUrlExpired(cached.expiresAt)) {
            return cached.url;
        }
        const next = this.nextUrls.get(urlKey);
        return (next && !this.isUrlExpired(next.expiresAt)) ? next.url : null;
    }

    /**
     * Check if an asset is already cached.
     *
     * @param ref - The asset reference (assetId + revisionId)
     * @returns True if the asset is in the cache, false otherwise
     */
    hasAsset(ref: AssetRef): boolean {
        return this.assetCache.has(assetRefKey(ref));
    }

    /**
     * Get an asset by reference. Returns cached data if available, otherwise fetches.
     * Concurrent requests for the same asset are deduplicated.
     *
     * @param ref - The asset reference (assetId + revisionId)
     * @returns Promise resolving to the asset metadata
     * @throws Error if the asset is not found
     */
    async getAsset(ref: AssetRef): Promise<CachedAsset> {
        const key = assetRefKey(ref);

        // Check cache first
        const cached = this.assetCache.get(key);
        if (cached) {
            return cached;
        }

        // Check if there's already a pending request
        const pending = this.pendingRequests.get(key);
        if (pending) {
            return pending;
        }

        // Fetch and cache
        const request = this.fetchAsset(ref);
        this.pendingRequests.set(key, request);

        try {
            const asset = await request;
            this.assetCache.set(key, asset);
            return asset;
        } finally {
            this.pendingRequests.delete(key);
        }
    }


    /**
     * Get an asset revision by reference. Returns cached data if available,
     * otherwise fetches from the network. Concurrent requests for the same
     * revision are deduplicated.
     *
     * Revision metadata (dependencies, etc.) is immutable and cached
     * permanently. The signed dataUrl is managed separately by SignedUrlCache
     * and refreshed when it expires.
     *
     * @param ref - The asset reference (assetId + revisionId) to load.
     * @returns Promise resolving to the asset revision (including data URL).
     */
    async getAssetRevision(ref: AssetRef): Promise<AssetRevision> {
        if (!ref.assetId || !ref.revisionId) {
            console.warn('[AssetLoader] getAssetRevision called with missing ref fields:', JSON.stringify(ref));
            throw new Error(`AssetLoader.getAssetRevision: missing assetId or revisionId (assetId=${ref.assetId}, revisionId=${ref.revisionId})`);
        }

        const key = assetRefKey(ref);
        const urlKey = this.revisionUrlKey(ref);

        // Metadata is immutable — if cached, just resolve a valid URL
        const cached = this.revisionCache.get(key);
        if (cached) {
            const cachedUrl = this.urlCache.get(urlKey);
            if (cachedUrl) {
                return { ...cached, dataUrl: cachedUrl.url };
            }
            // URL expired — fall through to re-fetch
        }

        // Dedup concurrent requests
        const pending = this.pendingRevisionRequests.get(key);
        if (pending) {
            return pending;
        }

        const request = this.fetchRevision(ref, key, urlKey);
        this.pendingRevisionRequests.set(key, request);
        try {
            return await request;
        } finally {
            this.pendingRevisionRequests.delete(key);
        }
    }

    private async fetchRevision(ref: AssetRef, key: string, urlKey: string): Promise<AssetRevision> {
        const revision = await getAssetRevision(ref.assetId, ref.revisionId, {
            includeDataUrl: true,
            includeDependencies: true,
            includeMetadata: true,
        });

        // Cache immutable metadata
        this.revisionCache.set(key, revision);

        // Prefer a previously cached URL so the browser's HTTP cache
        // can serve the asset data without re-downloading it.
        const cachedUrl = this.urlCache.get(urlKey);
        if (cachedUrl) {
            return { ...revision, dataUrl: cachedUrl.url };
        }

        // Cache the new URL with server-provided expiry
        if (revision.dataUrl && revision.expiresAt) {
            this.urlCache.set(urlKey, revision.dataUrl, revision.expiresAt);
            this.urlCache.flush();
        }

        return revision;
    }

    /**
     * Warm asset metadata cache ahead of use.
     * Useful for preloading template/streamed content to avoid request bursts.
     *
     * @param refs - Asset references to prefetch
     * @param options - Prefetch behavior configuration
     */
    async prefetchAssets(refs: AssetRef[], options: AssetPrefetchOptions = {}): Promise<void> {
        if (!refs.length) return;

        const uniqueRefs = new Map<string, AssetRef>();
        for (const ref of refs) {
            uniqueRefs.set(assetRefKey(ref), ref);
        }

        const queue = Array.from(uniqueRefs.values());
        const concurrency = Math.max(1, Math.floor(options.concurrency ?? 6));
        const includeDerivatives = options.includeDerivatives ?? false;
        const continueOnError = options.continueOnError ?? true;
        let cursor = 0;
        let firstError: unknown = null;

        const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
            while (cursor < queue.length) {
                const index = cursor++;
                const ref = queue[index]!;
                try {
                    const asset = await this.getAsset(ref);
                    if (includeDerivatives && asset.derivatives === undefined) {
                        await this.refreshAssetDerivatives(ref);
                    }
                } catch (error) {
                    if (!continueOnError) {
                        firstError = error;
                        return;
                    }
                    console.warn(`[AssetLoader] Prefetch failed for ${ref.assetId}`, error);
                }
            }
        });

        await Promise.all(workers);
        if (firstError) {
            throw firstError instanceof Error ? firstError : new Error(String(firstError));
        }
    }

    /**
     * Fetch an asset from the API.
     *
     * @param ref - The asset reference (assetId + revisionId)
     * @returns Promise resolving to the asset metadata
     * @throws Error if the asset is not found
     */
    private async fetchAsset(ref: AssetRef): Promise<CachedAsset> {
        const asset = await getAsset(ref.assetId);
        if (!asset) {
            throw new Error(`Asset not found: ${ref.assetId}`);
        }
        // Attach the revisionId to the asset for cache consistency
        return { ...asset, revisionId: ref.revisionId };
    }

    /**
     * Check if a derivative URL is expired or expiring soon.
     *
     * @param expiresAt - ISO date string of when the URL expires
     * @returns True if the URL is expired or will expire within the buffer period
     */
    private isUrlExpired(expiresAt: string | undefined): boolean {
        if (!expiresAt) {
            return true; // No expiration means we need to refresh
        }
        const expiry = new Date(expiresAt).getTime();
        return Date.now() > expiry - EXPIRATION_BUFFER_MS;
    }

    /**
     * Refresh derivatives for a specific asset. Fetches fresh signed URLs
     * and updates the cached asset. Deduplicates concurrent refresh requests
     * for the same asset/revision pair.
     *
     * @param ref - The asset reference (assetId + revisionId)
     * @returns Promise resolving to the refreshed derivatives
     */
    private async refreshAssetDerivatives(ref: AssetRef): Promise<AssetDerivative[]> {
        const key = assetRefKey(ref);

        // Check if there's already a pending refresh for this asset/revision
        const pending = this.pendingDerivativeRefresh.get(key);
        if (pending) {
            return pending;
        }

        console.debug(`[AssetLoader] Refreshing derivatives for ${ref.assetId}`);

        const request = (async () => {
            try {
                const derivatives = await getAssetDerivatives(ref.assetId, ref.revisionId, {
                    includeDataUrl: true,
                });

                // Update the cached asset with fresh derivatives
                const cachedAsset = this.assetCache.get(key);
                if (cachedAsset) {
                    this.assetCache.set(key, {
                        ...cachedAsset,
                        derivatives,
                    });
                }

                // Update signed URL cache with fresh URLs
                for (const derivative of derivatives) {
                    if (derivative.dataUrl && derivative.expiresAt) {
                        this.urlCache.set(this.derivativeUrlKey(derivative), derivative.dataUrl, derivative.expiresAt);
                    }
                }
                this.urlCache.flush();

                return derivatives;
            } finally {
                this.pendingDerivativeRefresh.delete(key);
            }
        })();

        this.pendingDerivativeRefresh.set(key, request);
        return request;
    }

    /**
     * Get the preferred LOD level for the current device.
     *
     * @returns The LOD level (1 for desktop, 2 for mobile, or the configured override)
     */
    getPreferredLodLevel(): number {
        if (this.options.preferredLodLevel !== undefined) {
            return this.options.preferredLodLevel;
        }
        return getBestLodForPlatform();
    }

    /**
     * Select the best model derivative for the current device.
     * Prioritizes exact LOD match, then falls back to the closest better quality LOD.
     *
     * @param derivatives - Array of asset derivatives to select from
     * @param targetLodLevel - Optional target LOD level (defaults to device preference)
     * @returns The selected derivative, or null if no suitable derivative is found
     */
    selectModelDerivative(
        derivatives: AssetDerivative[] | undefined,
        targetLodLevel?: number,
    ): AssetDerivative | null {
        if (!derivatives || derivatives.length === 0) {
            return null;
        }

        const modelDerivatives = derivatives.filter(
            d => d.type === AssetDerivativeType.Model,
        );

        if (modelDerivatives.length === 0) {
            return null;
        }

        const lodLevel = targetLodLevel ?? this.getPreferredLodLevel();

        // Try to find exact LOD match
        let selected = modelDerivatives.find(d => d.lodLevel === lodLevel);

        if (!selected && lodLevel !== 0) {
            // If preferred LOD not found, find the closest better quality LOD
            // (highest LOD level that is less than target)
            const betterLods = modelDerivatives.filter(
                d => (d.lodLevel ?? -1) < lodLevel,
            );
            if (betterLods.length > 0) {
                betterLods.sort((a, b) => (b.lodLevel ?? -1) - (a.lodLevel ?? -1));
                selected = betterLods[0];
            }
        }

        return selected ?? null;
    }

    /**
     * Get the data URL for loading a model.
     * Uses cached derivative metadata to select the best LOD and returns the
     * signed CDN URL directly. Automatically refreshes URLs if they're expired
     * or expiring soon.
     *
     * @param ref - The asset reference (assetId + revisionId)
     * @param options - Optional loading options
     * @param options.preferLod - Override the automatic LOD level selection
     * @returns Promise resolving to the data URL, format, and LOD level used
     * @throws Error if no data URL can be found for the model
     */
    async getModelDataUrl(
        ref: AssetRef,
        options: {preferLod?: number} = {},
    ): Promise<ModelDataUrlResult> {
        const asset = await this.getAsset(ref);
        const derivative = await this.resolveDerivativeUrl(
            ref, asset.derivatives, ds => this.selectModelDerivative(ds, options.preferLod),
        );

        if (derivative?.dataUrl) {
            console.debug(
                `[AssetLoader] Using LOD ${derivative.lodLevel} for model ${ref.assetId}`,
            );

            return {
                url: derivative.dataUrl,
                format: derivative.format,
                contentType: derivative.contentType,
                lodLevel: derivative.lodLevel,
            };
        }

        // Fallback: fetch revision data URL
        console.debug(
            `[AssetLoader] No suitable derivative for ${ref.assetId}, fetching revision`,
        );
        const revision = await this.getAssetRevision(ref);

        if (!revision?.dataUrl) {
            throw new Error(
                `No data URL found for model revision ${ref.assetId}/${ref.revisionId}`,
            );
        }

        return {
            url: revision.dataUrl,
            format: revision.format || asset.format,
            contentType: revision.contentType || asset.contentType,
            metadata: revision.metadata ?? undefined,
        };
    }

    /**
     * Get the preferred image quality level based on quality settings.
     *
     * @returns 0 for ultra/high, 1 for medium, 2 for low/performance
     */
    getPreferredImageQuality(): number {
        try {
            const settings = QualityManager.getInstance().getCurrentSettings();
            const qualityMap: Record<string, number> = {
                ultra: 0, high: 0, medium: 1, low: 2, performance: 2,
            };
            return qualityMap[settings.rendering.textureQuality] ?? (DetectDevice.isMobile() ? 2 : 1);
        } catch {
            return DetectDevice.isMobile() ? 2 : 1;
        }
    }

    /**
     * Select the best image derivative based on device capabilities.
     *
     * @param derivatives - Array of asset derivatives to select from
     * @param targetQuality - Optional target quality level (defaults to device preference)
     * @returns The selected derivative, or null if no suitable derivative is found
     */
    selectImageDerivative(
        derivatives: AssetDerivative[] | undefined,
        targetQuality?: number,
    ): AssetDerivative | null {
        if (!derivatives?.length) return null;

        const imageDerivatives = derivatives.filter(
            d => d.type === AssetDerivativeType.Image,
        );

        if (!imageDerivatives.length) return null;

        const quality = targetQuality ?? this.getPreferredImageQuality();

        // Find exact match or fall back to best available
        let selected = imageDerivatives.find(d => d.lodLevel === quality);
        if (!selected) {
            // Sort by quality (lodLevel) and pick closest
            imageDerivatives.sort((a, b) => (a.lodLevel ?? 0) - (b.lodLevel ?? 0));
            selected = imageDerivatives[0];
        }

        return selected ?? null;
    }

    /**
     * Get the data URL for loading an image asset.
     * Uses cached derivative metadata to select the best quality and returns the
     * signed CDN URL directly. Automatically refreshes URLs if they're expired.
     *
     * @param ref - The asset reference (assetId + revisionId)
     * @returns Promise resolving to the data URL and format
     * @throws Error if no data URL can be found for the image
     */
    async getImageDataUrl(ref: AssetRef): Promise<ImageDataUrlResult> {
        const asset = await this.getAsset(ref);
        const derivative = await this.resolveDerivativeUrl(
            ref, asset.derivatives, ds => this.selectImageDerivative(ds),
        );

        if (derivative?.dataUrl) {
            return {url: derivative.dataUrl, format: derivative.format};
        }

        // Fallback to revision data URL
        const revision = await this.getAssetRevision(ref);

        if (!revision?.dataUrl) {
            throw new Error(
                `No data URL found for image ${ref.assetId}/${ref.revisionId}`,
            );
        }

        return {url: revision.dataUrl, format: asset.format};
    }

    /**
     * Get the signed URL for a scene's behavior bundle derivative.
     *
     * @param ref - The scene asset reference (assetId + revisionId)
     * @returns The signed bundle URL, or null if no bundle derivative exists
     */
    async getBehaviorBundleUrl(ref: AssetRef): Promise<string | null> {
        const asset = await this.getAsset(ref);
        const derivative = await this.resolveDerivativeUrl(
            ref, asset.derivatives, ds => {
                if (!ds?.length) return null;
                return ds.find(d => d.type === AssetDerivativeType.BehaviorBundle) ?? null;
            },
        );
        return derivative?.dataUrl ?? null;
    }

    /**
     * Get or create the KTX2Loader. Lazily initialized on first use.
     * Recreates the loader if the renderer has changed (e.g., after context loss).
     * 
     * @returns A KTX2Loader instance
     */
    private async getKTX2Loader(): Promise<KTX2LoaderInstance> {
        const renderer = this.options.getRenderer?.();
        if (!renderer) {
            throw new Error(
                'KTX2 texture requested but no renderer available. ' +
                'Pass getRenderer in AssetLoader options to enable KTX2 support.',
            );
        }

        // Recreate loader if renderer has changed
        if (this.ktx2Loader && this.ktx2LoaderRenderer !== renderer) {
            this.ktx2Loader.dispose();
            this.ktx2Loader = null;
            this.ktx2LoaderPromise = null;
        }

        // Create loader if needed
        if (!this.ktx2Loader) {
            if (!this.ktx2LoaderPromise) {
                this.ktx2LoaderPromise = import('three/addons/loaders/KTX2Loader.js')
                    .then(({KTX2Loader}) => {
                        const loader = new KTX2Loader()
                            .setTranscoderPath('/assets/js/basis/')
                            .detectSupport(renderer as any);
                        this.ktx2Loader = loader;
                        this.ktx2LoaderRenderer = renderer;
                        return loader;
                    })
                    .finally(() => {
                        this.ktx2LoaderPromise = null;
                    });
            }
            return this.ktx2LoaderPromise;
        }

        return this.ktx2Loader;
    }

    /**
     * Load a texture from an image asset. Returns cached texture if available.
     * Supports standard image formats (PNG, JPG, etc.) and KTX2 compressed textures.
     * KTX2 support requires getRenderer to be passed in the constructor options.
     *
     * @param ref - The asset reference (assetId + revisionId)
     * @returns Promise resolving to the loaded Three.js Texture
     * @throws Error if KTX2 texture is requested but no renderer is available
     */
    async createTexture(ref: AssetRef): Promise<Texture> {
        const key = assetRefKey(ref);

        // Check cache
        const cached = this.textureCache.get(key);
        if (cached) {
            return cached;
        }

        // Get URL and format
        const {url, format} = await this.getImageDataUrl(ref);

        let texture: Texture;

        if (format === 'ktx2') {
            const ktx2Loader = await this.getKTX2Loader();
            texture = await ktx2Loader.loadAsync(url);
        } else {
            texture = await new Promise<Texture>((resolve, reject) => {
                this.textureLoader.load(url, resolve, undefined, reject);
            });
        }

        // Apply quality-determined anisotropy
        try {
            const settings = QualityManager.getInstance().getCurrentSettings();
            texture.anisotropy = settings.rendering.textureAnisotropy;
        } catch { /* use default */ }

        // Cache and return. Auto-evict on dispose so that the next
        // `createTexture(ref)` after a play→edit teardown (which calls
        // `MeshUtils.dispose` on every mesh, which in turn disposes every
        // material's texture slot) creates a fresh Texture instead of
        // handing back the now-dead one. Without this, repeated play/stop
        // cycles progressively replace live textures with disposed
        // references and meshes render untextured/blank.
        this.textureCache.set(key, texture);
        retainGpuResources(this.textureCacheOwner, [texture]);
        const onDispose = () => {
            texture.removeEventListener("dispose", onDispose);
            if (this.textureCache.get(key) === texture) {
                this.textureCache.delete(key);
            }
        };
        texture.addEventListener("dispose", onDispose);
        return texture;
    }

    /**
     * Clear all cached data and pending requests.
     */
    clear(): void {
        this.assetCache.clear();
        this.pendingRequests.clear();
        this.revisionCache.clear();
        this.pendingRevisionRequests.clear();
        this.pendingDerivativeRefresh.clear();

        // Note that we do not clear the urlCache or nextUrls cache. We want
        // these to persist between scenes, tabs, etc., because they are
        // lightweight and greatly improve asset caching.

        // Snapshot before disposing — each texture's dispose listener
        // mutates the cache, so iterating it live would skip entries.
        const cachedTextures = Array.from(this.textureCache.values());
        this.textureCache.clear();
        const released = releaseGpuResourcesForOwner(this.textureCacheOwner);
        for (const texture of cachedTextures) {
            if (!released.disposed.has(texture) && !isGpuResourceManaged(texture)) {
                texture.dispose();
            }
        }

        console.debug('[AssetLoader] Cache cleared');
    }

    /**
     * Dispose of the loader and release all resources.
     */
    dispose(): void {
        this.clear();

        // Dispose KTX2Loader
        if (this.ktx2Loader) {
            this.ktx2Loader.dispose();
            this.ktx2Loader = null;
            this.ktx2LoaderRenderer = null;
        }
    }
}
