 
import I18n from "i18next";

import {showToast} from "@web-shared/showToast";
import Ajax from "@web-shared/utils/Ajax";
import {backendUrlFromPath} from "@web-shared/utils/UrlUtils";


// --- Discord User Management ---
// Discord types
export interface DiscordUser {
    id: string;
    username: string;
    discriminator: string;
    avatar: string;
    bot?: boolean;
    system?: boolean;
    mfa_enabled?: boolean;
    locale?: string;
    verified?: boolean;
    email?: string;
    flags?: number;
    premium_type?: number;
}

export interface DiscordRelationship {
    id: string;
    type: number;
    user: DiscordUser;
}

export interface DiscordGuild {
    id: string;
    name: string;
    icon: string;
    owner: boolean;
    permissions: string;
    features: string[];
}

export interface DiscordChannel {
    id: string;
    type: number;
    guild_id?: string;
    position?: number;
    name?: string;
}

export interface DiscordActivity {
    name: string;
    type: number;
}

export interface updateDiscordStatusRequest {
    status: string;
    activities?: DiscordActivity[];
    since?: number | null;
    afk: boolean;
}

/**
 *
 * @param discordToken
 */
export async function getDiscordUser(discordToken: string): Promise<DiscordUser | null> {
    try {
        const response = await Ajax.post({
            url: backendUrlFromPath("/api/discord/user"),

            needAuthorization: false,
            data: {
                token: discordToken,
            },
        });

        const obj = response?.data;
        if (obj.Code !== 200) {
            showToast({type: "warning", body: I18n.t(obj.Msg)});
            return null;
        }

        return obj.Data as DiscordUser;
    } catch (error) {
        showToast({type: "error", title: "Failed to fetch Discord user"});
        console.error("Error fetching Discord user:", error);
        return null;
    }
}

// Get user's friends list
/**
 *
 * @param discordToken
 */
export async function getDiscordFriends(discordToken: string): Promise<DiscordRelationship[]> {
    try {
        const response = await Ajax.post({
            url: backendUrlFromPath("/api/discord/friends"),

            needAuthorization: false,
            data: {
                token: discordToken,
            },
        });

        const obj = response?.data;
        if (obj.Code !== 200) {
            showToast({type: "warning", body: I18n.t(obj.Msg)});
            return [];
        }

        return obj.Data as DiscordRelationship[];
    } catch (error) {
        showToast({type: "error", title: "Failed to fetch Discord friends"});
        console.error("Error fetching Discord friends:", error);
        return [];
    }
}

// Get user's guilds
/**
 *
 * @param discordToken
 */
export async function getDiscordGuilds(discordToken: string): Promise<DiscordGuild[]> {
    try {
        const response = await Ajax.post({
            url: backendUrlFromPath("/api/discord/guilds"),

            needAuthorization: false,
            data: {
                token: discordToken,
            },
        });

        const obj = response?.data;
        if (obj.Code !== 200) {
            showToast({type: "warning", body: I18n.t(obj.Msg)});
            return [];
        }

        return obj.Data as DiscordGuild[];
    } catch (error) {
        showToast({type: "error", title: "Failed to fetch Discord guilds"});
        console.error("Error fetching Discord guilds:", error);
        return [];
    }
}

// Get channels for a specific guild
/**
 *
 * @param discordToken
 * @param guildId
 */
export async function getDiscordGuildChannels(discordToken: string, guildId: string): Promise<DiscordChannel[]> {
    try {
        const response = await Ajax.post({
            url: backendUrlFromPath(`/api/discord/guild/${guildId}/channels`),

            needAuthorization: false,
            data: {
                token: discordToken,
            },
        });

        const obj = response?.data;
        if (obj.Code !== 200) {
            showToast({type: "warning", body: I18n.t(obj.Msg)});
            return [];
        }

        return obj.Data as DiscordChannel[];
    } catch (error) {
        showToast({type: "error", title: "Failed to fetch guild channels"});
        console.error("Error fetching guild channels:", error);
        return [];
    }
}

// Send a message to a Discord channel
/**
 *
 * @param discordToken
 * @param channelId
 * @param content
 */
export async function sendDiscordMessage(discordToken: string, channelId: string, content: string): Promise<boolean> {
    try {
        const response = await Ajax.post({
            url: backendUrlFromPath("/api/discord/message"),

            needAuthorization: false,
            data: {
                token: discordToken,
                channelId,
                content,
            },
        });

        const obj = response?.data;
        if (obj.Code !== 200) {
            showToast({type: "warning", body: I18n.t(obj.Msg)});
            return false;
        }

        showToast({type: "success", body: "Message sent successfully"});
        return true;
    } catch (error) {
        showToast({type: "error", title: "Failed to send Discord message"});
        console.error("Error sending Discord message:", error);
        return false;
    }
}

// Update user status (Note: This might require gateway connection)
/**
 *
 * @param discordToken
 * @param statusData
 */
export async function updateDiscordStatus(
    discordToken: string,
    statusData: updateDiscordStatusRequest,
): Promise<boolean> {
    try {
        const response = await Ajax.post({
            url: backendUrlFromPath("/api/discord/status"),
            msgBodyType: "json",
            needAuthorization: false,
            data: JSON.stringify({
                token: discordToken,
                ...statusData,
            }),
        });

        const obj = response?.data;
        if (obj.Code === 501) {
            // Not implemented - status updates require gateway
            showToast({
                type: "info",
                body: "Status updates require Discord bot gateway connection",
            });
            return false;
        }

        if (obj.Code !== 200) {
            showToast({type: "warning", body: I18n.t(obj.Msg)});
            return false;
        }

        return true;
    } catch (error) {
        showToast({type: "error", title: "Failed to update Discord status"});
        console.error("Error updating Discord status:", error);
        return false;
    }
}

// Helper function to check if user is guild owner
/**
 *
 * @param discordToken
 * @param guildId
 */
export async function isGuildOwner(discordToken: string, guildId: string): Promise<boolean> {
    const guilds = await getDiscordGuilds(discordToken);
    const guild = guilds.find(g => g.id === guildId);
    return guild?.owner || false;
}

// Helper function to check if user has admin permissions
/**
 *
 * @param discordToken
 * @param guildId
 */
export async function hasAdminPermissions(discordToken: string, guildId: string): Promise<boolean> {
    const guilds = await getDiscordGuilds(discordToken);
    const guild = guilds.find(g => g.id === guildId);

    if (!guild) return false;

    // Check if owner
    if (guild.owner) return true;

    // Check admin permission bit (0x8)
    const permissions = BigInt(guild.permissions);
    const ADMINISTRATOR = BigInt(0x8);

    return (permissions & ADMINISTRATOR) === ADMINISTRATOR;
}
// --- END Discord User Management ---

// --- Discord Keys Management and Authentication ---

interface ApiResponse<T> {
    Code: number;
    Data: T;
    Msg?: string;
}

interface AuthResponseData {
    user: IDiscordUser;
    custom_token: string;
    refresh_token: string;
    id_token: string;
    expires_in: number;
    access_token: string;
}

interface CheckKeysResponseData {
    configured: boolean;
}

interface GetClientIDResponseData {
    clientID: string;
}

interface GetSceneIDResponseData {
    sceneID: string;
}

export interface IDiscordUser {
    avatarUrl: string;
    avatar?: string;
    displayName: string;
    username: string;
    id: string;
    email: string;
    discriminator: number;
}

export interface DiscordSignInResponse {
    user: IDiscordUser;
    access_token: string;
    custom_token: string;
    refresh_token: string;
    id_token: string;
    expires_in: number;
}

export const authenticateWithCode = async (
    code: string,
    redirect_uri?: string,
    sceneID?: string,
    appLogin?: boolean,
): Promise<DiscordSignInResponse> => {
    try {
        const params = new URLSearchParams({
            code,
            redirectUri: redirect_uri ?? process.env.REACT_ENGINE_DISCORD_REDIRECT_URI!,
            sceneID: sceneID || "", // Optional sceneID to get keys for a specific scene
            appLogin: appLogin ? appLogin.toString() : "false", // Optional appLogin to pick app over game discord authentication
        });

        const endpoint = backendUrlFromPath("/api/Discord/AuthCodeLogin") || "/api/Discord/AuthCodeLogin";
        const response = await fetch(endpoint, {
            method: "POST",
            headers: {"Content-Type": "application/x-www-form-urlencoded"},
            body: params,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`AuthCodeLogin failed: ${errorText}`);
        }

        const json = (await response.json()) as ApiResponse<AuthResponseData>;
        if (json.Code !== 200) {
            throw new Error(`Error in AuthCodeLogin response: ${JSON.stringify(json)}`);
        }

        const {user, custom_token, refresh_token, id_token, expires_in, access_token} = json.Data;

        return {
            user,
            custom_token,
            refresh_token,
            id_token,
            expires_in,
            access_token,
        };
    } catch (error) {
        console.error("Error during Discord authentication with code:", error);
        throw error;
    }
};

export const authenticateWithRefreshToken = async (
    refreshToken: string,
    sceneID?: string,
): Promise<DiscordSignInResponse> => {
    try {
        const params = new URLSearchParams({
            refreshToken,
            sceneID: sceneID || "", // Optional sceneID to get keys for a specific scene
        });
        const endpoint = backendUrlFromPath("/api/Discord/RefreshTokenLogin") || "/api/Discord/RefreshTokenLogin";
        const response = await fetch(endpoint, {
            method: "POST",
            headers: {"Content-Type": "application/x-www-form-urlencoded"},
            body: params,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`RefreshTokenLogin failed: ${errorText}`);
        }
        const json = (await response.json()) as ApiResponse<AuthResponseData>;
        if (json.Code !== 200) {
            throw new Error(`Error in RefreshTokenLogin response: ${JSON.stringify(json)}`);
        }

        const {user, custom_token, refresh_token, id_token, expires_in, access_token} = json.Data;

        return {
            user,
            custom_token,
            refresh_token,
            id_token,
            expires_in,
            access_token,
        };
    } catch (error) {
        console.error("Error during Discord authentication with refresh token:", error);
        throw error;
    }
};

export const checkKeys = async (_sceneID: string): Promise<boolean> => {
    return false;
};

export const saveKeys = async (clientId: string, clientSecret: string, sceneID: string): Promise<void> => {
    try {
        const data = {
            clientId,
            clientSecret,
            sceneID,
        };
        const endpoint = backendUrlFromPath("/api/Discord/SaveKeys") || "/api/Discord/SaveKeys";
        const response = await Ajax.post({url: endpoint, data: JSON.stringify(data), msgBodyType: "json"});

        if (!response?.data) {
            throw new Error(`DiscordSaveKeys failed`);
        }

        const responseData = response.data as ApiResponse<void>;
        if (responseData.Code !== 200) {
            throw new Error(`DiscordSaveKeys failed: ${responseData.Msg}`);
        }
    } catch (error) {
        console.error("Error saving Discord keys:", error);
        throw error;
    }
};

export const getClientID = async (sceneID: string): Promise<string> => {
    try {
        const params = new URLSearchParams({
            sceneID,
        });
        const endpoint = backendUrlFromPath("/api/Discord/GetClientID") || "/api/Discord/GetClientID";
        const response = await fetch(`${endpoint}?${params}`, {
            method: "GET",
            headers: {"Content-Type": "application/x-www-form-urlencoded"},
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`DiscordGetClientID failed: ${errorText}`);
        }

        const json = (await response.json()) as ApiResponse<GetClientIDResponseData>;
        if (json.Code !== 200) {
            throw new Error(`Error in DiscordGetClientID response: ${JSON.stringify(json)}`);
        }

        return json.Data.clientID;
    } catch (error) {
        console.error("Error getting Discord client ID:", error);
        throw error;
    }
};

export const getSceneIDByClientID = async (clientID: string): Promise<string> => {
    try {
        const params = new URLSearchParams({
            clientID,
        });
        const endpoint = backendUrlFromPath("/api/Discord/GetSceneID") || "/api/Discord/GetSceneID";
        const response = await Ajax.get({url: `${endpoint}?${params}`, needAuthorization: false});

        if (!response?.data) {
            throw new Error(`GetSceneID failed: No response data`);
        }

        const responseData = response.data as ApiResponse<GetSceneIDResponseData>;
        if (responseData.Code !== 200) {
            throw new Error(`GetSceneID failed: ${responseData.Msg}`);
        }

        return responseData.Data.sceneID;
    } catch (error) {
        console.error("Error getting scene by Discord client ID:", error);
        throw error;
    }
};

export const deleteKeys = async (sceneID: string): Promise<void> => {
    try {
        const params = new URLSearchParams({
            sceneID,
        });
        const endpoint = backendUrlFromPath("/api/Discord/DeleteKeys") || "/api/Discord/DeleteKeys";
        const response = await Ajax.ajaxDelete({url: `${endpoint}?${params}`});

        if (!response?.data) {
            throw new Error(`DeleteDiscordKeys failed: No response data`);
        }

        const responseData = response.data as ApiResponse<{deletedCount: number}>;
        if (responseData.Code !== 200) {
            throw new Error(`DeleteDiscordKeys failed: ${responseData.Msg}`);
        }
    } catch (error) {
        console.error("Error deleting Discord keys:", error);
        throw error;
    }
};
// --- END Discord Keys Management and Authentication ---
