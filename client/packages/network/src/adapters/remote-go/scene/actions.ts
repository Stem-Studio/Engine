import {OSS_LOCAL_USER_ID} from "@web-shared/ossUser";
import type {DomainSceneDto, HandlerUpdateSceneRequest} from "../client/api";

export type CloneSceneOptions = {
    name?: string;
    initialPollInterval?: number;
    maxPollInterval?: number;
    timeout?: number;
};

export type CloneSceneResult = {
    newSceneId: string;
    newSceneName: string;
};

export type ForkSceneOptions = {
    name?: string;
};

export type ForkSceneResult = {
    newSceneId: string;
    newSceneName: string;
};

const createLocalId = (prefix: string) => {
    const cryptoObj = (globalThis as {crypto?: {randomUUID?: () => string}}).crypto;
    return cryptoObj?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const localSceneDto = (sceneId: string, params: Partial<HandlerUpdateSceneRequest> = {}): DomainSceneDto => {
    const now = new Date().toISOString();
    return {
        id: sceneId,
        name: params.name ?? "Local scene",
        description: params.description ?? "",
        thumbnail: params.thumbnail ?? "",
        tags: typeof params.tags === "string" ? params.tags : "",
        userId: OSS_LOCAL_USER_ID,
        createTime: now,
        updateTime: now,
        assetsCount: params.assetsCount ?? 0,
        contentRating: params.contentRating ?? "",
        isAssetPack: params.isAssetPack ?? false,
        isCloneable: params.isCloneable ?? false,
        isCollaborative: params.isCollaborative ?? false,
        isPublic: false,
        isPublished: false,
        isSandbox: params.isSandbox ?? false,
        isTopPick: params.isTopPick ?? false,
        majorVersion: 1,
        minorVersion: 0,
        asset: {
            id: `oss-scene-asset-${sceneId}`,
            revision: {
                    id: `oss-scene-rev-${sceneId}`,
                    metadata: {
                    isMultiplayer: false,
                    lockedItems: "",
                    maxCollaboratorsInRoom: 0,
                    maxMultiplayerClientsPerRoom: 0,
                    multiplayerAutoJoin: false,
                    rendering: {},
                    showHud: true,
                    showMemoryStats: false,
                    showStats: false,
                    useAvatar: false,
                    useInstancing: false,
                    vfxOnMobile: false,
                    voiceChatEnabled: false,
                },
            },
        },
    } as DomainSceneDto;
};

/**
 * Fork a scene synchronously.
 *
 * Creates a new scene that references the same released asset revisions as
 * the source. The user must own the source scene OR the source must be
 * published with isCloneable=true and have all transitive dependencies
 * released.
 */
export const forkScene = async (
    sceneId: string,
    options: ForkSceneOptions = {},
): Promise<ForkSceneResult> => {
    void sceneId;
    return {
        newSceneId: createLocalId("oss-scene"),
        newSceneName: options.name ?? "",
    };
};

/**
 * Clone a scene asynchronously.
 *
 * This function initiates an async clone operation and polls for completion.
 */
export const cloneScene = async (
    sceneId: string,
    options: CloneSceneOptions = {},
): Promise<CloneSceneResult> => {
    void sceneId;
    void options.initialPollInterval;
    void options.maxPollInterval;
    void options.timeout;
    return {
        newSceneId: createLocalId("oss-scene"),
        newSceneName: options.name ?? "",
    };
};

/**
 * Update scene-level properties (name, description, flags, etc.).
 * Only provided fields are updated (partial update via PATCH).
 */
export const updateScene = async (
    sceneId: string,
    params: HandlerUpdateSceneRequest,
): Promise<DomainSceneDto> => {
    return localSceneDto(sceneId, params);
};
