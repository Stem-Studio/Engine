import axios from "axios";

import EngineRuntime from "@web-shared/EngineRuntime";
import {auth} from "@web-shared/firebase";
import global from "@web-shared/global";
import {AssetsApi, JobsApi, ScenesApi} from "./client/api";
import {Configuration} from "./client/configuration";
import {isInDiscordEnvironment} from "@web-shared/userManagement/playerProfile/discordEnvironment";
import {baseApiUrl} from "@web-shared/utils/UrlUtils";

/**
 * Get a fresh auth token, refreshing if expired.
 * Firebase's getIdToken() returns cached token if valid, or refreshes if expired.
 * @returns A Promise that resolves to the auth token, or undefined if no token
 * is available.
 */
const getAuthTokenAsync = async (): Promise<string | undefined> => {
    const user = auth?.currentUser;

    // Get token from Firebase
    if (user) {
        try {
            const token = await user.getIdToken();
            return `Bearer ${token}`;
        } catch (err) {
            console.warn("[API Client] Failed to get Firebase token:", err);
        }
    }

    // Fallback to cached token if Firebase user not available (e.g., Discord in-app).
    const app = global.app as EngineRuntime | undefined | null;
    const cachedToken = app?.authManager?.getAuthToken();
    if (cachedToken) {
        return `Bearer ${cachedToken}`;
    }

    // In published links, no token is available.
    return undefined;
};

// Create axios instance with auth interceptor
const createAxiosWithAuth = () => {
    const instance = axios.create();

    // Add request interceptor to inject Authorization and proxy headers
    instance.interceptors.request.use(async config => {
        // Skip if Authorization header is already set
        if (config.headers?.Authorization) {
            return config;
        }

        const token = await getAuthTokenAsync();
        if (token) {
            config.headers = config.headers || {};
            config.headers.Authorization = token;
        }

        // When running inside a proxied environment (e.g., Discord), send
        // proxy-base headers so the backend can remap presigned URLs.
        // The env vars contain just the path prefix (e.g., "/.proxy/stem-assets");
        // we prepend the current origin so the backend gets a full base URL.
        if (isInDiscordEnvironment()) {
            const origin = `${window.location.protocol}//${window.location.host}`;
            const getProxyPath = process.env.REACT_APP_ASSET_GET_PROXY_BASE;
            const putProxyPath = process.env.REACT_APP_ASSET_PUT_PROXY_BASE;
            if (getProxyPath) {
                config.headers = config.headers || {};
                config.headers["X-Asset-Get-Proxy-Base"] = `${origin}${getProxyPath}`;
            }
            if (putProxyPath) {
                config.headers = config.headers || {};
                config.headers["X-Asset-Put-Proxy-Base"] = `${origin}${putProxyPath}`;
            }
        }

        return config;
    });

    return instance;
};

// Shared axios instance with auth interceptor
const axiosWithAuth = createAxiosWithAuth();

// Assets can be accessed in two contexts: scene or user. Permissions are based
// on the context. "scene" is the default context.
export enum AccessContext {
    Scene = "scene",
    User = "user",
}

export type ApiClientOptions = {
    context?: AccessContext;
};

/**
 * Get a client for the Stem Studio Assets API.
 *
 * @param options - Optional options for the API client.
 * @returns An instance of the API client.
 */
export const getAssetsApiClient = (options: ApiClientOptions = {}) => {
    const app = global.app as EngineRuntime | undefined | null;
    const context = options.context || AccessContext.Scene;
    const sceneId = context === AccessContext.Scene ? app?.editor?.sceneID : undefined;
    const headers: Record<string, string> = {};
    if (sceneId) {
        headers["X-Scene-Id"] = sceneId;
    }

    const rootAssetId = app?.rootAssetId;
    if (rootAssetId) {
        headers["X-Root-Asset-Id"] = rootAssetId;
    }

    const assetToken = app?.assetToken;
    if (assetToken) {
        headers["X-Asset-Token"] = assetToken;
    }

    const configuration = new Configuration({
        basePath: baseApiUrl(),
        baseOptions: {
            headers,
        },
    });

    // Use axios instance with auth interceptor to ensure Authorization header
    // is sent for all requests (including endpoints without security annotations)
    return new AssetsApi(configuration, undefined, axiosWithAuth);
};

/**
 * Get a client for the Stem Studio Scenes API.
 *
 * @returns An instance of the API client.
 */
export const getScenesApiClient = () => {
    const configuration = new Configuration({
        basePath: baseApiUrl(),
    });

    // Use axios instance with auth interceptor
    return new ScenesApi(configuration, undefined, axiosWithAuth);
};


/**
 * Get a client for the Stem Studio Jobs API.
 *
 * @returns An instance of the API client.
 */
export const getJobsApiClient = () => {
    const configuration = new Configuration({
        basePath: baseApiUrl(),
    });

    // Use axios instance with auth interceptor
    return new JobsApi(configuration, undefined, axiosWithAuth);
};
