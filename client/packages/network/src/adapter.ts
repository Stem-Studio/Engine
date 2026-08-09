export type BackendMode = "remote" | "local";

export type BackendEntrypoint = "editor" | "play";

export type BackendAdapter = {
    mode: BackendMode;
    entrypoint: BackendEntrypoint;
    server: string;
};

const BACKEND_MODE_QUERY_KEYS = ["backend", "adapter"];
const LOCAL_SERVER_QUERY_KEYS = ["localBackendUrl", "localServer"];
const BACKEND_MODE_STORAGE_KEY = "stem.backend.mode";
const PLAYGROUND_MODE_STORAGE_KEY = "stem.playgroundMode";

type BackendModeSource = "query" | "playground" | "storage" | "env" | "default";

type BackendModeResolution = {
    mode: BackendMode;
    source: BackendModeSource;
};

declare global {
    interface Window {
        __STEM_BACKEND_ADAPTER__?: BackendAdapter;
    }
}

const getBrowserWindow = (): Window | null => {
    return typeof window === "undefined" ? null : window;
};

const readStorage = (storage: "localStorage" | "sessionStorage", key: string): string | null => {
    const browserWindow = getBrowserWindow();
    if (!browserWindow) return null;

    try {
        return browserWindow[storage].getItem(key);
    } catch {
        // Storage is commonly denied in sandboxed iframes and privacy modes.
        return null;
    }
};

const writeStorage = (storage: "localStorage" | "sessionStorage", key: string, value: string): void => {
    const browserWindow = getBrowserWindow();
    if (!browserWindow) return;

    try {
        browserWindow[storage].setItem(key, value);
    } catch {
        // Selection must remain usable when storage is unavailable.
    }
};

const readQueryParam = (keys: string[]): string | null => {
    const browserWindow = getBrowserWindow();
    if (!browserWindow) return null;

    const params = new URLSearchParams(browserWindow.location.search);
    for (const key of keys) {
        const value = params.get(key)?.trim();
        if (value) return value;
    }
    return null;
};

const normalizeMode = (value?: string | null): BackendMode | null => {
    if (!value) return null;
    const normalized = value.toLowerCase();
    if (normalized === "local") return "local";
    if (normalized === "remote") return "remote";
    return null;
};

const readEnv = (key: "REACT_ENGINE_BACKEND_MODE" | "REACT_ENGINE_LOCAL_BACKEND_URL"): string | undefined => {
    return typeof process === "undefined" ? undefined : process.env?.[key];
};

const isPlaygroundSession = (): boolean => {
    const browserWindow = getBrowserWindow();
    if (!browserWindow) return false;

    const fromQuery = new URLSearchParams(browserWindow.location.search).get("mode") === "playground";
    if (fromQuery) {
        writeStorage("sessionStorage", PLAYGROUND_MODE_STORAGE_KEY, "1");
        return true;
    }
    return readStorage("sessionStorage", PLAYGROUND_MODE_STORAGE_KEY) === "1";
};

const resolveMode = (): BackendModeResolution => {
    const fromQuery = normalizeMode(readQueryParam(BACKEND_MODE_QUERY_KEYS));
    if (fromQuery) {
        writeStorage("localStorage", BACKEND_MODE_STORAGE_KEY, fromQuery);
        return {mode: fromQuery, source: "query"};
    }

    // Playground scenes live in the browser-backed ProjectStore. Do not let a
    // stale backend preference or deployment env silently route a Playground
    // session to scene APIs that are not deployed. A backend query parameter
    // above remains the deliberate escape hatch for supported deployments.
    if (isPlaygroundSession()) return {mode: "local", source: "playground"};

    const fromStorage = normalizeMode(readStorage("localStorage", BACKEND_MODE_STORAGE_KEY));
    if (fromStorage) return {mode: fromStorage, source: "storage"};

    const fromEnv = normalizeMode(readEnv("REACT_ENGINE_BACKEND_MODE"));
    if (fromEnv) return {mode: fromEnv, source: "env"};

    // OSS/browser-local is the safe no-configuration baseline. Remote scene
    // services are optional and must be selected explicitly.
    return {mode: "local", source: "default"};
};

const isLoopbackHostname = (hostname: string): boolean => {
    const normalized = hostname.toLowerCase();
    if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
    if (normalized === "[::1]" || normalized === "::1") return true;

    const ipv4 = normalized.split(".").map(part => Number(part));
    return ipv4.length === 4
        && ipv4.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
        && ipv4[0] === 127;
};

/**
 * Local backend URLs are an authentication boundary: API clients may attach
 * credentials to the selected origin. Accept only same-origin HTTP(S) URLs or
 * explicit loopback development servers. Protocol-relative URLs are rejected
 * even when they resolve to loopback so the scheme is always deliberate.
 */
const resolveSafeLocalServerCandidate = (candidate: string, browserWindow: Window | null): string | null => {
    if (!browserWindow || candidate.startsWith("//")) return null;

    try {
        const parsed = new URL(candidate, browserWindow.location.origin);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
        if (parsed.username || parsed.password) return null;
        if (parsed.origin === browserWindow.location.origin || isLoopbackHostname(parsed.hostname)) {
            return parsed.origin;
        }
    } catch {
        // Invalid URLs use the mode-appropriate safe fallback below.
    }

    return null;
};

const resolveLocalServerOrigin = (useNodeFallback: boolean): string => {
    const browserWindow = getBrowserWindow();
    const fromQuery = readQueryParam(LOCAL_SERVER_QUERY_KEYS);
    const fromEnv = readEnv("REACT_ENGINE_LOCAL_BACKEND_URL")?.trim();
    const candidate = fromQuery || fromEnv;

    if (candidate) {
        const safeOrigin = resolveSafeLocalServerCandidate(candidate, browserWindow);
        if (safeOrigin) return safeOrigin;
    }

    if (!browserWindow) return useNodeFallback ? "http://localhost:3030" : "";

    return useNodeFallback
        ? `${browserWindow.location.protocol}//${browserWindow.location.hostname}:3030`
        : browserWindow.location.origin;
};

export const createBackendAdapter = (entrypoint: BackendEntrypoint): BackendAdapter => {
    const resolution = resolveMode();
    const {mode} = resolution;
    const explicitLocalBackend = resolution.source === "query"
        || resolution.source === "storage"
        || resolution.source === "env";
    const server = mode === "local"
        ? resolveLocalServerOrigin(explicitLocalBackend)
        : (getBrowserWindow()?.location.origin ?? "");
    const adapter: BackendAdapter = {mode, entrypoint, server};
    const browserWindow = getBrowserWindow();
    if (browserWindow) browserWindow.__STEM_BACKEND_ADAPTER__ = adapter;
    return adapter;
};

export const getBackendAdapter = (): BackendAdapter | null => {
    return getBrowserWindow()?.__STEM_BACKEND_ADAPTER__ ?? null;
};

export const isLocalBackendMode = (): boolean => {
    const adapter = getBackendAdapter();
    if (adapter) return adapter.mode === "local";
    return resolveMode().mode === "local";
};
