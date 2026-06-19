/**
 * AI provider identity. Names match the keys returned by the backend's
 * /api/AI/Capabilities endpoint.
 */
export type AIProvider =
    | "anthropic"
    | "openai"
    | "meshy"
    | "elevenlabs"
    | "anythingworld"
    | "gemini"
    | "tripo"
    | "rodin";

export type ProviderStatus = "ready" | "missing-key";
export type ProviderSource = "env" | "byok-session" | "";

export interface ProviderCapability {
    status: ProviderStatus;
    source: ProviderSource;
}

export interface AICapabilities {
    buildMode: "integrated" | "oss";
    providers: Record<AIProvider, ProviderCapability>;
}

export interface AIRequestOptions {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    headers?: Record<string, string>;
    body?: unknown;
    signal?: AbortSignal;
}

export interface AIResponse<T = unknown> {
    ok: boolean;
    status: number;
    data: T;
}
