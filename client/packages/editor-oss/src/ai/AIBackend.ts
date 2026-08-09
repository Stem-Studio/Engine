import type {AICapabilities, AIProvider, AIRequestOptions, AIResponse} from "./types";

/**
 * AIBackend is the seam between the editor and any AI provider surface.
 *
 * The default implementation talks to the local ai-server. The interface is
 * intentionally narrow — it exposes:
 *
 *   - `capabilities()` so the editor can learn which providers have keys
 *     configured and decide which UI to gate behind a BYOK prompt.
 *   - `request<T>()` as a thin escape hatch so existing call sites can be
 *     migrated incrementally onto the abstraction without forcing a complete
 *     surface freeze. Once enough call sites migrate, this method narrows
 *     into typed per-feature methods (`generateText`, `generateImage`, etc.).
 *
 * Key handling rule (BYOK):
 *
 *   When a user has supplied a BYOK key for some provider, the backend
 *   implementation forwards it as the `X-BYOK-Key` header on requests that
 *   target that provider. Env-supplied keys on the server always take
 *   precedence over BYOK keys — the server decides. The editor never makes
 *   provider-selection decisions on the client.
 */
export interface AIBackend {
    /**
     * Returns the per-provider readiness map. Editor uses this to enable AI
     * features and gate ones whose providers are missing keys.
     */
    capabilities(forceRefresh?: boolean): Promise<AICapabilities>;

    /**
     * Set a BYOK key for a provider. The key is forwarded to the backend on
     * subsequent requests via the `X-BYOK-Key` header. Returns `true` when the
     * server acknowledges the key.
     *
     * Returns `false` if no client-side key store is available.
     */
    setProviderKey(provider: AIProvider, key: string): Promise<boolean>;

    /**
     * Clear a stored BYOK key for a provider. Both client-side and server-side
     * state are reset.
     */
    clearProviderKey(provider: AIProvider): Promise<void>;

    /**
     * Low-level escape hatch used by features that have not yet migrated to a
     * typed method on this interface. The `path` argument is the backend path
     * starting with `/api/AI/...`. Body and method default to JSON POST.
     */
    request<T = unknown>(path: string, options?: AIRequestOptions): Promise<AIResponse<T>>;

    /**
     * Streaming variant — returns the raw `Response` so callers can pipe
     * `response.body` (a `ReadableStream`) directly. Used for endpoints
     * like `/api/AI/TextToVoice` that stream audio chunks. The BYOK
     * provider header is forwarded the same way as `request()`.
     */
    requestStream(path: string, options?: AIRequestOptions): Promise<Response>;
}
