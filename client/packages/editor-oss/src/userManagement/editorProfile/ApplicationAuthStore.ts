import * as discordApi from "@stem/network/api/discord";
import {getAuthProvider} from "../../auth";
import {IUser} from "../types";

export type User = IUser;
export type {IUser};
export type UserData = IUser;

class ApplicationAuthStore {
    authToken: string | null = null;
    private discordAccessToken: string | null = null;
    private discordRefreshToken: string | null = null;
    private tokenExpirationTime: Date | null = null;
    private userName: string | null = null;
    private user: User | null = null;

    constructor() {
        this.loadDiscordRefreshToken();
    }

    private setCookie(name: string, value: string, expire_in: number): void {
        const expires = new Date(Date.now() + expire_in * 1000).toUTCString();
        document.cookie = `${name}=${value}; expires=${expires}; path=/; SameSite=Lax`;
    }

    private getCookie(name: string): string | null {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) {
            return parts.pop()?.split(";").shift() || null;
        }
        return null;
    }

    setAuthToken(token: string | null): void {
        this.authToken = token;
    }

    getAuthToken(): string | null {
        return this.authToken;
    }

    setDiscordAccessToken(token: string | null): void {
        this.discordAccessToken = token;
    }

    getDiscordAccessToken(): string | null {
        return this.discordAccessToken;
    }

    private loadDiscordRefreshToken(): void {
        this.discordRefreshToken = this.getCookie("discord_refresh_token");
    }

    setDiscordRefreshToken(token: string, expiresIn: number): void {
        this.setCookie("discord_refresh_token", token, expiresIn);
        this.discordRefreshToken = token;
    }

    getDiscordRefreshToken(): string | null {
        return this.discordRefreshToken;
    }

    setTokenExpirationTime(expiresIn: number | null): void {
        if (!expiresIn) {
            this.tokenExpirationTime = null;
            return;
        }
        const expirationTime = new Date(Date.now() + expiresIn * 1000);
        this.tokenExpirationTime = expirationTime;
    }

    getTokenExpirationTime(): Date | null {
        return this.tokenExpirationTime;
    }

    setUserName(name: string | null): void {
        this.userName = name;
    }

    getUserName(): string | null {
        return this.userName;
    }

    setUser(user: User | null): void {
        this.user = user;
    }

    getUser(): User | null {
        return this.user;
    }

    setUserAndToken(user: User | null, token: string | null): void {
        this.setUser(user);
        this.setAuthToken(token);
    }

    getUserData(): IUser | null {
        return this.getUser();
    }

    discordCheckKeys = async (sceneID: string): Promise<boolean> => {
        try {
            return await discordApi.checkKeys(sceneID);
        } catch (error) {
            console.error("Error checking Discord keys:", error);
            throw error;
        }
    };

    discordSaveKeys = async (clientId: string, clientSecret: string, sceneID: string): Promise<void> => {
        try {
            await discordApi.saveKeys(clientId, clientSecret, sceneID);
        } catch (error) {
            console.error("Error saving Discord keys:", error);
            throw error;
        }
    };

    discordGetClientID = async (sceneID: string): Promise<string> => {
        try {
            return await discordApi.getClientID(sceneID);
        } catch (error) {
            console.error("Error getting Discord client ID:", error);
            throw error;
        }
    };

    discordDeleteKeys = async (sceneID: string): Promise<void> => {
        try {
            await discordApi.deleteKeys(sceneID);
        } catch (error) {
            console.error("Error deleting Discord keys:", error);
            throw error;
        }
    };

    // Steam integration methods
    steamCheckKeys = async (_sceneID: string): Promise<boolean> => {
        return false;
    };

    steamSaveKeys = async (appId: string, apiKey: string, sceneID: string): Promise<void> => {
        try {
            const response = await fetch(`/api/Steam/SaveKeys`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${this.authToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    sceneID,
                    appId,
                    apiKey,
                }),
            });

            if (!response.ok) {
                const result = await response.json();
                throw new Error(result.msg || `Failed to save Steam keys: ${response.statusText}`);
            }
        } catch (error) {
            console.error("Error saving Steam keys:", error);
            throw error;
        }
    };

    steamDeleteKeys = async (sceneID: string): Promise<void> => {
        try {
            const response = await fetch(`/api/Steam/DeleteKeys?sceneID=${sceneID}`, {
                method: "DELETE",
                headers: {
                    Authorization: `Bearer ${this.authToken}`,
                    "Content-Type": "application/json",
                },
            });

            if (!response.ok) {
                const result = await response.json();
                throw new Error(result.msg || `Failed to delete Steam keys: ${response.statusText}`);
            }
        } catch (error) {
            console.error("Error deleting Steam keys:", error);
            throw error;
        }
    };

    steamGetAppID = async (sceneID: string): Promise<string> => {
        try {
            const response = await fetch(`/api/Steam/GetAppID?sceneID=${sceneID}`, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                },
            });

            if (response.ok) {
                const result = await response.json();
                return result.data?.appID || "";
            }
            return "";
        } catch (error) {
            console.error("Error getting Steam App ID:", error);
            return "";
        }
    };

    // CrazyGames integration methods
    crazyGamesCheckKeys = async (_sceneID: string): Promise<boolean> => {
        return false;
    };

    crazyGamesSaveKeys = async (gameId: string, gameSecret: string, sceneID: string): Promise<void> => {
        try {
            const response = await fetch(`/api/CrazyGames/SaveKeys`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${this.authToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    sceneID,
                    gameId,
                    gameSecret,
                }),
            });

            if (!response.ok) {
                const result = await response.json();
                throw new Error(result.msg || `Failed to save CrazyGames keys: ${response.statusText}`);
            }
        } catch (error) {
            console.error("Error saving CrazyGames keys:", error);
            throw error;
        }
    };

    crazyGamesDeleteKeys = async (sceneID: string): Promise<void> => {
        try {
            const response = await fetch(`/api/CrazyGames/DeleteKeys?sceneID=${sceneID}`, {
                method: "DELETE",
                headers: {
                    Authorization: `Bearer ${this.authToken}`,
                    "Content-Type": "application/json",
                },
            });

            if (!response.ok) {
                const result = await response.json();
                throw new Error(result.msg || `Failed to delete CrazyGames keys: ${response.statusText}`);
            }
        } catch (error) {
            console.error("Error deleting CrazyGames keys:", error);
            throw error;
        }
    };

    crazyGamesGetGameID = async (sceneID: string): Promise<string> => {
        try {
            const response = await fetch(`/api/CrazyGames/GetGameID?sceneID=${sceneID}`, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                },
            });

            if (response.ok) {
                const result = await response.json();
                return result.data?.gameID || "";
            }
            return "";
        } catch (error) {
            console.error("Error getting CrazyGames Game ID:", error);
            return "";
        }
    };

    /**
     * Check if the current user is anonymous
     */
    isAnonymous = (): boolean => {
        return getAuthProvider().getCurrentUser()?.isAnonymous || false;
    };

    /**
     * Check for existing Firebase authentication
     */
    checkExistingAuth = async (): Promise<IUser | null> => {
        const {checkPlayerExists} = await import("../playerProfile/game-service-controllers/GuestController");
        return await checkPlayerExists();
    };
}

export default ApplicationAuthStore;
