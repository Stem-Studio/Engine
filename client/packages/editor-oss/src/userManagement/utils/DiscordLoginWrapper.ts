import * as discordApi from "@stem/network/api/discord";
import {IDiscordUser} from "@stem/network/api/discord";
import {getAuthProvider} from "../../auth";
import {getRemoteDocStore} from "../../data";
import ApplicationAuthStore from "../editorProfile/ApplicationAuthStore";
import {isInDiscordEnvironment} from "../playerProfile/discordEnvironment";
import {IUser} from "../types";

const unixSeconds = () => Math.floor(Date.now() / 1000);

export const discordAuthenticateWithCode = async (args: {
    authManager: ApplicationAuthStore;
    code: string;
    redirect_uri?: string;
    sceneID?: string;
    appLogin?: boolean;
}): Promise<discordApi.DiscordSignInResponse> => {
    const {code, redirect_uri, sceneID, authManager, appLogin} = args;
    try {
        const response = await discordApi.authenticateWithCode(code, redirect_uri, sceneID, appLogin);

        // Use the custom token to create a Firebase user (like other services)
        const firebaseUser = await loginWithCustomToken(response.custom_token, response.user);

        if (firebaseUser) {
            authManager.setUser(firebaseUser);
        }

        authManager.setDiscordRefreshToken(response.refresh_token, response.expires_in);
        authManager.setAuthToken(response.id_token);
        authManager.setTokenExpirationTime(response.expires_in);
        authManager.setUserName(response.user.username);
        authManager.setDiscordAccessToken(response.access_token);

        return response;
    } catch (error) {
        console.error("Error during Discord authentication with code:", error);
        authManager.setDiscordRefreshToken("", 0); // Clear token on error
        authManager.setAuthToken(null);
        authManager.setTokenExpirationTime(null);
        authManager.setDiscordAccessToken(null);

        throw error;
    }
};

export const discordAuthenticateWithRefreshToken = async (
    authManager: ApplicationAuthStore,
    sceneID?: string,
): Promise<discordApi.DiscordSignInResponse> => {
    try {
        const refreshToken = authManager.getDiscordRefreshToken();
        if (!refreshToken) {
            throw new Error("No Discord refresh token available");
        }

        const response = await discordApi.authenticateWithRefreshToken(refreshToken, sceneID);

        // Use the custom token to create a Firebase user (like other services)
        const firebaseUser = await loginWithCustomToken(response.custom_token, response.user);

        if (firebaseUser) {
            authManager.setUser(firebaseUser);
        }

        authManager.setDiscordRefreshToken(response.refresh_token, response.expires_in);
        authManager.setAuthToken(response.id_token);
        authManager.setTokenExpirationTime(response.expires_in);
        authManager.setUserName(response.user.username);
        authManager.setDiscordAccessToken(response.access_token);

        return response;
    } catch (error) {
        console.error("Error during Discord authentication with refresh token:", error);
        authManager.setDiscordRefreshToken("", 0); // Clear token on error
        authManager.setAuthToken(null);
        authManager.setTokenExpirationTime(null);
        authManager.setDiscordAccessToken(null);

        throw error;
    }
};

/**
 * Login with custom token and Discord user data
 * @param customToken
 * @param discordUser
 */
async function loginWithCustomToken(customToken: string, discordUser: IDiscordUser) {
    if (isInDiscordEnvironment()) {
        // No Firebase in the Discord embedded app — build IUser directly from Discord identity.
        return {
            id: discordUser.id,
            name: discordUser.displayName,
            username: discordUser.username,
            email: discordUser.email ?? null,
            avatar: discordUser.avatarUrl ?? null,
            platform: "firebase",
        } as IUser;
    }
    try {
        const authUser = await getAuthProvider().signInWithCustomToken(customToken);
        if (!authUser) {
            console.log("Cannot create user, authentication data is missing");
            return;
        }

        const store = getRemoteDocStore();
        let userData = await store.getDoc<{
            id: string;
            name?: string;
            username?: string;
            email?: string;
            avatar?: string;
        }>("users", authUser.uid);

        if (!userData) {
            const newUser = {
                id: authUser.uid,
                discordId: discordUser.id,
                name: discordUser.displayName,
                username: discordUser.username,
                email: discordUser.email,
                avatar: discordUser.avatarUrl,
                memberSince: unixSeconds(),
            };

            await store.setDoc("users", authUser.uid, newUser);
            userData = await store.getDoc<{
                id: string;
                name?: string;
                username?: string;
                email?: string;
                avatar?: string;
            }>("users", authUser.uid);
            console.log("New user data saved to remote store");
        } else {
            console.log("User already exists in remote store. Skipping user creation.");
        }

        if (!userData) {
            throw new Error("Failed to retrieve user data from remote store");
        }

        return {
            id: userData.id,
            firebaseId: authUser.uid,
            name: userData.name || "",
            username: userData.username || "",
            email: userData.email || "",
            avatar: userData.avatar || "",
        } as IUser;
    } catch (error) {
        console.error("An error occurred during the login process:", error);
    }
}
