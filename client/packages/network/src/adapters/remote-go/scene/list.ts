import {OSS_LOCAL_USER_ID} from "@web-shared/ossUser";
import type {FileData} from "@stem/editor-oss/editor/assets/v2/types/file";

export interface PaginatedScenesResponse {
    Scenes: FileData[];
    TotalCount: number;
    Page: number;
    Limit: number;
    HasMore: boolean;
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

function emptyPaginatedScenesResponse(params?: FetchScenesParams): PaginatedScenesResponse {
    return {
        Scenes: [],
        TotalCount: 0,
        Page: params?.page ?? 1,
        Limit: params?.limit ?? 20,
        HasMore: false,
    };
}

export async function fetchMyScenes(params?: FetchScenesParams): Promise<PaginatedScenesResponse> {
    try {
        const {getProjectStore, ensureProjectStoreRehydrated} = await import("@stem/editor-oss/persistence");
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

export async function fetchArchivedScenes(params?: FetchScenesParams): Promise<PaginatedScenesResponse> {
    return emptyPaginatedScenesResponse(params);
}

export async function fetchCollaborativeScenes(params?: FetchScenesParams): Promise<PaginatedScenesResponse> {
    return emptyPaginatedScenesResponse(params);
}

export async function fetchPublishedScenes(params?: FetchScenesParams): Promise<PaginatedScenesResponse> {
    return emptyPaginatedScenesResponse(params);
}

export async function fetchRemixesOfScene(
    _sceneId: string,
    params?: FetchScenesParams,
): Promise<PaginatedScenesResponse> {
    return emptyPaginatedScenesResponse(params);
}

export async function fetchTopPicksScenes(): Promise<FileData[]> {
    return [];
}
