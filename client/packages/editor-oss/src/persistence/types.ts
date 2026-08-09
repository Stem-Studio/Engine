/**
 * Project save/load types used by the persistence abstraction.
 *
 * The shapes intentionally avoid coupling to FileData / PaginatedScenesResponse
 * (which are the wire shapes of the cloud Scene API). The HTTP-backed
 * implementation translates between the two so the rest of the editor can be
 * agnostic about storage mode.
 */

export type ProjectStoreKind = "remote" | "indexeddb" | "filesystem";

/**
 * Metadata only — no scene body. Used for listings.
 */
export interface ProjectMeta {
    id: string;
    name: string;
    updatedAt: string; // ISO8601
    createdAt: string;
    thumbnailUrl?: string;
    /** Optional storage-specific extras (cloud version, FS handle name, etc.). */
    extra?: Record<string, unknown>;
}

/**
 * Full project body. Shape mirrors the .stemscript on-disk format so a
 * loaded project from any backend is structurally interchangeable.
 */
export interface ProjectBody {
    meta: ProjectMeta;
    /**
     * Serialized scene JSON. Stored as a string to avoid re-parsing on
     * round trips through IndexedDB / FS, and to support large projects
     * without losing precision on nested numerics.
     */
    sceneJson: string;
    /**
     * Optional behavior / script asset bodies bundled with the project.
     * Map key is the asset id; value is the source. This is what makes the
     * project portable across machines without a behavior server.
     */
    bundledAssets?: Record<string, string>;
}

/**
 * A binary asset (model, image, audio) stored alongside a project.
 *
 * The local runtime has no hosted asset service: model/image/audio payloads are synthesized as
 * inline `data:` URLs that only live in memory. To make a saved project
 * reload-safe, those payloads are persisted next to the project body — in
 * IndexedDB for browser-storage projects, or in a `<projectId>/`
 * subdirectory for File System Access projects.
 *
 * Behavior / script assets are NOT stored here: they are small and already
 * embedded inline in the scene JSON (`scene.userData.behaviorConfigs`).
 */
export interface StoredAsset {
    /** Synthetic local asset id (e.g. `oss-asset-…`). */
    assetId: string;
    /** Head revision id for the asset (e.g. `oss-rev-…`). */
    revisionId: string;
    /** Asset type (`model`, `image`, `audio`, …). */
    type: string;
    /** Data format (e.g. `glb`, `png`, `ogg`). */
    format: string;
    /** Human-readable asset name. */
    name: string;
    /** MIME type of the payload, when known. */
    contentType?: string;
    /** Revision metadata needed to restore packaged assets. */
    metadata?: Record<string, unknown>;
    /** Base64-encoded payload bytes (no `data:` prefix). */
    data: string;
    /**
     * Base64-encoded thumbnail bytes (no `data:` prefix). Populated for
     * assets that have a generated preview tile (uploaded models, images,
     * stems). Absent when no thumbnail was attached.
     */
    thumbnailData?: string;
    /** MIME type of the thumbnail payload (e.g. `image/png`). */
    thumbnailContentType?: string;
}

export interface ListProjectsOptions {
    /** 1-based page index. Default 1. */
    page?: number;
    /** Items per page. Default 40. */
    limit?: number;
    /** Plain text search filter. Optional. */
    search?: string;
}

export interface ListProjectsResult {
    projects: ProjectMeta[];
    page: number;
    hasMore: boolean;
    totalCount: number;
}
