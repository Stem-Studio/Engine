import type {ProjectStore} from "./ProjectStore";
import type {
    ListProjectsOptions,
    ListProjectsResult,
    ProjectBody,
    ProjectMeta,
    StoredAsset,
} from "./types";

/**
 * RemoteProjectStore wraps a remote Scene API behind the ProjectStore
 * interface. It is retained as an adapter point for forks that provide a
 * server-backed project store.
 *
 * The implementation is intentionally injected via `RemoteProjectStoreDeps`
 * rather than importing a concrete Scene API directly.
 */

export interface RemoteSceneListItem {
    ID: string;
    Name: string;
    UpdateTime: string;
    CreateTime?: string;
    Thumbnail?: string;
}

export interface RemoteSceneListResult {
    Scenes: RemoteSceneListItem[];
    Page: number;
    HasMore: boolean;
    TotalCount: number;
}

export interface RemoteSceneLoadResult {
    data: unknown;
    metadata?: {Name?: string; UpdateTime?: string; CreateTime?: string; Thumbnail?: string} | unknown;
}

export interface RemoteProjectStoreDeps {
    fetchScenes(params: {page: number; limit: number; search?: string}): Promise<RemoteSceneListResult>;
    loadScene(id: string): Promise<RemoteSceneLoadResult>;
    saveScene(body: ProjectBody): Promise<ProjectMeta>;
    deleteScene(id: string): Promise<void>;
}

const itemToMeta = (s: RemoteSceneListItem): ProjectMeta => ({
    id: s.ID,
    name: s.Name,
    updatedAt: s.UpdateTime,
    createdAt: s.CreateTime ?? s.UpdateTime,
    thumbnailUrl: s.Thumbnail,
});

export class RemoteProjectStore implements ProjectStore {
    readonly kind = "remote" as const;

    constructor(private readonly deps: RemoteProjectStoreDeps) {}

    async list(options: ListProjectsOptions = {}): Promise<ListProjectsResult> {
        const page = Math.max(1, options.page ?? 1);
        const limit = Math.max(1, options.limit ?? 40);
        const result = await this.deps.fetchScenes({page, limit, search: options.search});
        return {
            projects: result.Scenes.map(itemToMeta),
            page: result.Page,
            hasMore: result.HasMore,
            totalCount: result.TotalCount,
        };
    }

    async load(id: string): Promise<ProjectBody> {
        const remote = await this.deps.loadScene(id);
        const meta = (remote.metadata ?? {}) as {Name?: string; UpdateTime?: string; CreateTime?: string; Thumbnail?: string};
        return {
            meta: {
                id,
                name: meta.Name ?? "Untitled",
                updatedAt: meta.UpdateTime ?? new Date().toISOString(),
                createdAt: meta.CreateTime ?? meta.UpdateTime ?? new Date().toISOString(),
                thumbnailUrl: meta.Thumbnail,
            },
            sceneJson: typeof remote.data === "string" ? remote.data : JSON.stringify(remote.data),
        };
    }

    async save(body: ProjectBody): Promise<ProjectMeta> {
        return this.deps.saveScene(body);
    }

    async delete(id: string): Promise<void> {
        await this.deps.deleteScene(id);
    }

    async exportToBlob(id: string): Promise<Blob> {
        const body = await this.load(id);
        return new Blob([JSON.stringify(body, null, 2)], {type: "application/json"});
    }

    async importFromBlob(blob: Blob): Promise<ProjectMeta> {
        const text = await blob.text();
        const parsed = JSON.parse(text) as ProjectBody;
        if (!parsed?.sceneJson) throw new Error("Imported file is not a valid .stemscript project");
        return this.save(parsed);
    }

    // Remote asset services own their own asset persistence. These satisfy
    // the ProjectStore interface for remote-backed implementations.
    async saveAssets(_projectId: string, _assets: StoredAsset[]): Promise<void> {
        // no-op: remote asset service owns asset persistence
    }

    async loadAssets(_projectId: string): Promise<StoredAsset[]> {
        return [];
    }
}
