import type {AIBackend} from "./AIBackend";
import type {AICapabilities, AIProvider, AIRequestOptions, AIResponse} from "./types";

const PROVIDERS: AIProvider[] = [
    "anthropic",
    "openai",
    "meshy",
    "elevenlabs",
    "anythingworld",
    "gemini",
    "tripo",
];

/**
 * Placeholder AIBackend implementation. Returns deterministic empty / error
 * responses without performing any network calls. Used for:
 *
 *   - **Tests** — drop-in stub via `setAIBackend(new NullAIBackend())`.
 *   - **Local editor without an AI server** — when the user hasn't booted the
 *     ai-server (or doesn't want to), the editor still loads and AI panels
 *     show a "configure a key / start the AI server" CTA instead of throwing
 *     network errors on every request.
 *   - **Storybook / preview environments** — pages render without live AI.
 *
 * Every `request()` call rejects with a deterministic error message so
 * callers' error paths execute predictably. `capabilities()` reports every
 * provider as missing-key. Key setters succeed silently but no-op.
 *
 * Pair with `HttpAIBackend` via `aiBackendFactory` — production paths use
 * `HttpAIBackend`; tests / no-server contexts use this one.
 */
export class NullAIBackend implements AIBackend {
    async capabilities(): Promise<AICapabilities> {
        const providers = Object.fromEntries(
            PROVIDERS.map(p => [p, {status: "missing-key" as const, source: "" as const}]),
        ) as AICapabilities["providers"];
        return {buildMode: "oss", providers};
    }

    async setProviderKey(_provider: AIProvider, _key: string): Promise<boolean> {
        return false;
    }

    async clearProviderKey(_provider: AIProvider): Promise<void> {
        // no-op
    }

    async request<T = unknown>(path: string, _options?: AIRequestOptions): Promise<AIResponse<T>> {
        const message = `AIBackend is not configured. Tried to call ${path}. Start the ai-server (\`bun run dev-ai-server\`) or register a real AIBackend via setAIBackend().`;
        return {
            ok: false,
            status: 503,
            data: {error: message} as unknown as T,
        };
    }

    async requestStream(path: string, _options?: AIRequestOptions): Promise<Response> {
        return new Response(
            JSON.stringify({
                error: `AIBackend is not configured. Tried to stream ${path}.`,
            }),
            {status: 503, headers: {"Content-Type": "application/json"}},
        );
    }
}
