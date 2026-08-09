import type {
    ListProjectsOptions,
    ListProjectsResult,
    ProjectBody,
    ProjectMeta,
    ProjectStoreKind,
    StoredAsset,
} from "./types";

/**
 * ProjectStore is the seam between the editor's save/load flows and any
 * project storage backend.
 *
 * Implementations:
 *   - RemoteProjectStore     ← HTTP-backed storage for self-hosted backends.
 *   - IndexedDBProjectStore  ← Default browser-local persistence.
 *   - FileSystemProjectStore ← Chromium-only. Project lives in a
 *                              user-picked folder as a `.stemscript` file.
 *
 * The interface is intentionally minimal. It does NOT cover community gallery,
 * collaborative sessions, share-link generation, archived/restored flows, or
 * hosted-gallery concepts. Those features are outside this repository's
 * open-source storage contract.
 */
export interface ProjectStore {
    readonly kind: ProjectStoreKind;

    list(options?: ListProjectsOptions): Promise<ListProjectsResult>;

    load(id: string): Promise<ProjectBody>;

    save(body: ProjectBody): Promise<ProjectMeta>;

    /**
     * Atomically publish a scene snapshot and its complete binary-asset set.
     * Local implementations must keep the previously loadable generation
     * intact until the new generation is durable.
     */
    commitProject?(body: ProjectBody, assets: StoredAsset[]): Promise<ProjectMeta>;

    delete(id: string): Promise<void>;

    /**
     * Serialize a project to a downloadable Blob (`.stemscript` format) for
     * export/share. All implementations support this so a user can move a
     * project between machines or share it as a file.
     */
    exportToBlob(id: string): Promise<Blob>;

    /**
     * Inverse of `exportToBlob`. Reads a `.stemscript` file (or compatible
     * JSON body) and creates a new project. Returns the new project's meta.
     */
    importFromBlob(blob: Blob): Promise<ProjectMeta>;

    /**
     * Persist the binary assets (models, images, audio) a project depends
     * on. Called after `save()`; replaces the project's stored asset set.
     * These payloads have no hosted asset service to live in, so the
     * project store is their only durable home.
     */
    saveAssets(projectId: string, assets: StoredAsset[]): Promise<void>;

    /**
     * Load every binary asset previously persisted for a project. Used on
     * scene load to re-seed the in-memory local asset registry so model /
     * image / audio references resolve.
     */
    loadAssets(projectId: string): Promise<StoredAsset[]>;
}
