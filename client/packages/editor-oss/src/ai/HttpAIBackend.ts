import type {AIBackend} from "./AIBackend";
import type {BYOKKeyStore} from "./BYOKKeyStore";
import type {AICapabilities, AIProvider, AIRequestOptions, AIResponse} from "./types";

const CAPABILITIES_PATH = "/api/AI/Capabilities";
const CONFIGURE_KEYS_PATH = "/api/AI/ConfigureKeys";

/**
 * Header forwarded to the backend when a BYOK key is available for the
 * provider targeted by a request. The server resolves precedence: env-supplied
 * keys always win, BYOK falls back.
 */
const BYOK_HEADER = "X-BYOK-Key";
const BYOK_PROVIDER_HEADER = "X-BYOK-Provider";

export interface HttpAIBackendOptions {
    /** BYOK key store. Optional for callers that do not support client keys. */
    keyStore?: BYOKKeyStore;
    /**
     * Override base server resolver. Defaults to `window.location.origin +
     * path`, which is the correct value when the editor and AI server share
     * an origin.
     */
    resolveUrl?: (path: string) => string;
}

const defaultResolveUrl = (path: string): string => {
    if (/^https?:\/\//i.test(path)) return path;
    if (typeof window !== "undefined" && window.location?.origin) {
        return `${window.location.origin}${path.startsWith("/") ? path : `/${path}`}`;
    }
    return path;
};

/**
 * Default AIBackend implementation. Talks to the local Go ai-server on the
 * `/api/AI/*` endpoints.
 */
export class HttpAIBackend implements AIBackend {
    private capabilitiesCache: AICapabilities | undefined;
    private capabilitiesPromise: Promise<AICapabilities> | undefined;

    constructor(private readonly options: HttpAIBackendOptions = {}) {}

    private resolveUrl(path: string): string {
        if (this.options.resolveUrl) return this.options.resolveUrl(path);
        return defaultResolveUrl(path);
    }

    async capabilities(forceRefresh = false): Promise<AICapabilities> {
        if (!forceRefresh && this.capabilitiesCache) return this.capabilitiesCache;
        if (this.capabilitiesPromise) return this.capabilitiesPromise;
        this.capabilitiesPromise = (async () => {
            const url = this.resolveUrl(CAPABILITIES_PATH);
            const res = await fetch(url, {method: "GET", credentials: "include"});
            if (!res.ok) throw new Error(`AI capabilities query failed: ${res.status}`);
            const parsed = (await res.json()) as AICapabilities;
            this.capabilitiesCache = parsed;
            return parsed;
        })();
        try {
            return await this.capabilitiesPromise;
        } finally {
            this.capabilitiesPromise = undefined;
        }
    }

    async setProviderKey(provider: AIProvider, key: string): Promise<boolean> {
        const trimmed = key.trim();
        if (!trimmed) return false;
        if (!this.options.keyStore) return false;
        await this.options.keyStore.set(provider, trimmed);
        try {
            const url = this.resolveUrl(CONFIGURE_KEYS_PATH);
            const res = await fetch(url, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                credentials: "include",
                body: JSON.stringify({provider, key: trimmed}),
            });
            // Force capabilities refresh next time.
            this.capabilitiesCache = undefined;
            return res.ok;
        } catch {
            // Storing client-side succeeded; server-side push may have failed
            // because the configure-keys endpoint may be unavailable in older servers.
            // The X-BYOK-Key header on subsequent requests still carries it.
            return true;
        }
    }

    async clearProviderKey(provider: AIProvider): Promise<void> {
        await this.options.keyStore?.delete(provider);
        this.capabilitiesCache = undefined;
        try {
            const url = this.resolveUrl(CONFIGURE_KEYS_PATH);
            await fetch(url, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                credentials: "include",
                body: JSON.stringify({provider, key: ""}),
            });
        } catch {
            // Local deletion is still authoritative for direct BYOK-header
            // requests. Keep clear idempotent when the server is unavailable.
        }
    }

    private async dispatch(path: string, options: AIRequestOptions): Promise<Response> {
        const url = this.resolveUrl(path);
        const method = options.method ?? (options.body !== undefined ? "POST" : "GET");

        // Body-shape detection. FormData / Blob / ReadableStream / typed-array
        // bodies are passed through verbatim and we do NOT set Content-Type —
        // the browser sets it automatically (incl. the multipart boundary).
        // For everything else we JSON-serialize and set Content-Type: json.
        const body = options.body;
        const isStreamingBody =
            body instanceof FormData ||
            (typeof Blob !== "undefined" && body instanceof Blob) ||
            (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) ||
            body instanceof ArrayBuffer ||
            ArrayBuffer.isView(body);
        const isString = typeof body === "string";

        const headers: Record<string, string> = {
            ...(isStreamingBody ? {} : {"Content-Type": "application/json"}),
            ...(options.headers ?? {}),
        };

        const targetProvider = headers[BYOK_PROVIDER_HEADER] as AIProvider | undefined;
        if (targetProvider && this.options.keyStore) {
            const stored = await this.options.keyStore.get(targetProvider);
            if (stored && !headers[BYOK_HEADER]) {
                headers[BYOK_HEADER] = stored;
            }
        }

        return fetch(url, {
            method,
            headers,
            credentials: "include",
            signal: options.signal,
            body:
                body === undefined
                    ? undefined
                    : isStreamingBody || isString
                        ? (body as BodyInit)
                        : JSON.stringify(body),
        });
    }

    async request<T = unknown>(path: string, options: AIRequestOptions = {}): Promise<AIResponse<T>> {
        const res = await this.dispatch(path, options);
        let data: T;
        const contentType = res.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
            data = (await res.json()) as T;
        } else {
            data = (await res.text()) as unknown as T;
        }
        return {ok: res.ok, status: res.status, data};
    }

    async requestStream(path: string, options: AIRequestOptions = {}): Promise<Response> {
        return this.dispatch(path, options);
    }
}
