import {showToast} from "@web-shared/showToast";
import Ajax from "@web-shared/utils/Ajax";
import {backendUrlFromPath} from "@web-shared/utils/UrlUtils";

export interface IGameMapping {
    id?: string;
    GameID: string;
    Slug: string;
    owner_id: string;
    DiscordAppId?: string;
    created_at: string;
    updated_at: string;
    created_by: string;
}

export interface IGameMappingResponse {
    success: boolean;
    message?: string;
    mapping?: IGameMapping;
}

/** Shape of an HTTP error thrown by the Ajax helper. */
interface IHttpError {
    response?: {
        status?: number;
        data?: string;
    };
}

export interface ISlugCheckResponse {
    exists: boolean;
    valid: boolean;
    message?: string;
}

export interface IGameMappingRequest {
    GameID: string;
    Slug?: string;
    DiscordAppId?: string;
}

/**
 * Check if a slug is already taken and if it's valid
 * @param slug
 */
export const checkSlugExists = async (slug: string): Promise<ISlugCheckResponse | null> => {
    try {
        const url = backendUrlFromPath(`/api/game-mapping/check?slug=${encodeURIComponent(slug)}`);
        const response = await Ajax.get({url});

        if (response?.status === 200) {
            return response.data;
        } else {
            showToast({type: "error", title: "Failed to check slug availability"});
            return null;
        }
    } catch (error) {
        console.error("Error checking slug:", error);
        showToast({type: "error", title: "Error checking slug availability"});
        return null;
    }
};

/**
 * Get the mapping for a specific game
 * @param gameId
 */
export const getGameMapping = async (_gameId: string): Promise<IGameMapping | null> => {
    return null;
};

/**
 * Create a new game mapping
 * @param GameID
 * @param Slug
 * @param gameId
 * @param slug
 * @param discord_client_id
 */
export const createGameMapping = async (
    gameId: string,
    slug?: string,
    discord_client_id?: string,
): Promise<IGameMappingResponse | null> => {
    try {
        const url = backendUrlFromPath(`/api/game-mapping/create`);
        const data: IGameMappingRequest = {
            GameID: gameId,
            ...slug ? {Slug: slug.toLowerCase()} : {},
            ...discord_client_id ? {DiscordAppId: discord_client_id} : {},
        };

        const response = await Ajax.post({
            url,
            data: JSON.stringify(data),
            msgBodyType: "json",
        });

        if (response?.status === 200) {
            showToast({type: "success", title: "Slug created successfully"});
            return response.data;
        } else {
            const errorMessage = response?.data?.message || "Failed to create mapping";
            showToast({type: "error", title: errorMessage});
            return null;
        }
    } catch (error) {
        console.error("Error creating game mapping:", error);
        let errorMessage = "Error creating game mapping";
        const httpError = error as IHttpError;

        if (httpError.response?.status === 403) {
            errorMessage = "You don't have permission to create mappings for this game";
        } else if (httpError.response?.status === 409) {
            errorMessage = httpError.response.data || "Slug is already taken";
        } else if (httpError.response?.status === 400) {
            errorMessage = httpError.response.data || "Invalid request";
        }

        showToast({type: "error", title: errorMessage});
        return null;
    }
};

/**
 * Update an existing game mapping
 * @param gameId
 * @param slug
 * @param discord_client_id
 */
export const updateGameMapping = async (
    gameId: string,
    slug?: string,
    discord_client_id?: string,
): Promise<IGameMappingResponse | null> => {
    try {
        const url = backendUrlFromPath(`/api/game-mapping/update?gameId=${encodeURIComponent(gameId)}`);
        const data: IGameMappingRequest = {
            GameID: gameId,
            ...slug ? {Slug: slug.toLowerCase()} : {},
            ...discord_client_id ? {DiscordAppId: discord_client_id} : {},
        };

        const response = await Ajax.put({
            url,
            data: JSON.stringify(data),
            msgBodyType: "json",
        });

        if (response?.status === 200) {
            showToast({type: "success", title: "Slug updated successfully"});
            return response.data;
        } else {
            const errorMessage = response?.data?.message || "Failed to update mapping";
            showToast({type: "error", title: errorMessage});
            return null;
        }
    } catch (error) {
        console.error("Error updating game mapping:", error);
        let errorMessage = "Error updating game mapping";
        const httpError = error as IHttpError;

        if (httpError.response?.status === 403) {
            errorMessage = "You don't have permission to update this mapping";
        } else if (httpError.response?.status === 409) {
            errorMessage = httpError.response.data || "Slug is already taken";
        } else if (httpError.response?.status === 404) {
            errorMessage = "Game mapping not found";
        } else if (httpError.response?.status === 400) {
            errorMessage = httpError.response.data || "Invalid request";
        }

        showToast({type: "error", title: errorMessage});
        return null;
    }
};

/**
 * Delete a game mapping
 * @param gameId
 */
export const deleteGameMapping = async (gameId: string): Promise<boolean> => {
    try {
        const url = backendUrlFromPath(`/api/game-mapping/delete?gameId=${encodeURIComponent(gameId)}`);
        const response = await Ajax.ajaxDelete({url});

        if (response?.status === 200) {
            showToast({type: "success", title: "Slug deleted successfully"});
            return true;
        } else {
            showToast({type: "error", title: "Failed to delete mapping"});
            return false;
        }
    } catch (error) {
        console.error("Error deleting game mapping:", error);
        let errorMessage = "Error deleting game mapping";
        const httpError = error as IHttpError;

        if (httpError.response?.status === 403) {
            errorMessage = "You don't have permission to delete this mapping";
        } else if (httpError.response?.status === 404) {
            errorMessage = "Game mapping not found";
        }

        showToast({type: "error", title: errorMessage});
        return false;
    }
};
