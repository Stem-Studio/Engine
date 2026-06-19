import type {
    generateText as generateTextType,
    LanguageModel,
    streamText as streamTextType,
    SystemModelMessage,
} from "ai";

import {
    OPENAI_COPILOT_REASONING_EFFORT,
    type CopilotChatKey,
} from "./playgroundCopilotKeys";

export const PLAYGROUND_PROMPT_CACHE_KEY = "stemstudio-playground-copilot-v5";
export const PLAYGROUND_MAX_OUTPUT_TOKENS = 4096;
export const PLAYGROUND_OPENAI_MAX_OUTPUT_TOKENS = 128000;

export type PlaygroundLLMGenerateRequest = {
    key: CopilotChatKey;
    prompt: string;
    systemPrompt: string;
    knowledgePrompt: string;
    promptCacheKey?: string;
    maxOutputTokens?: number;
    signal?: AbortSignal;
    onStreamProgress?: (progress: PlaygroundLLMStreamProgress) => void;
};

export type PlaygroundLLMClient = {
    generateText(request: PlaygroundLLMGenerateRequest): Promise<string>;
};

export type PlaygroundLLMStreamProgress =
    | {type: "raw"}
    | {type: "reasoning"; delta: string}
    | {type: "text"; delta: string; source?: "openai-raw"};

type ProviderOptions = NonNullable<Parameters<typeof generateTextType>[0]["providerOptions"]>;

export function createPlaygroundLLMClient(fetchImpl: typeof fetch = fetch.bind(globalThis)): PlaygroundLLMClient {
    return {
        async generateText(request: PlaygroundLLMGenerateRequest): Promise<string> {
            const {generateText, streamText} = await import("ai");
            const model = await createLanguageModel(request.key, fetchImpl);
            const baseOptions = {
                model,
                system: buildSystemPrompt(request),
                prompt: request.prompt,
                maxOutputTokens: request.maxOutputTokens ?? getPlaygroundMaxOutputTokens(request.key),
                abortSignal: request.signal,
                maxRetries: 1,
                providerOptions: buildProviderOptions(request),
            };

            if (request.key.provider === "openai") {
                return streamOpenAIText(streamText, baseOptions, request);
            }

            const result = await generateText({
                ...baseOptions,
            });

            if (result.text.trim()) return result.text;
            throw new Error(
                `${request.key.provider} response did not include text content. ` +
                "The model may have exhausted its output budget during reasoning.",
            );
        },
    };
}

async function streamOpenAIText(
    streamText: typeof streamTextType,
    options: Parameters<typeof streamTextType>[0],
    request: PlaygroundLLMGenerateRequest,
): Promise<string> {
    const result = streamText({
        ...options,
        includeRawChunks: true,
    });
    let text = "";
    let rawText = "";
    let rawFinishReason: string | undefined;
    let rawFailureMessage: string | undefined;

    for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
            text += part.text;
            request.onStreamProgress?.({type: "text", delta: part.text});
        } else if (part.type === "reasoning-delta") {
            request.onStreamProgress?.({type: "reasoning", delta: part.text});
        } else if (part.type === "raw") {
            request.onStreamProgress?.({type: "raw"});
            const raw = getRecord(part.rawValue);
            const rawDelta = getOpenAIResponseTextDelta(raw);
            if (rawDelta) {
                rawText += rawDelta;
                request.onStreamProgress?.({type: "text", delta: rawDelta, source: "openai-raw"});
            }

            const completedText = getOpenAICompletedResponseText(raw);
            if (completedText) {
                const delta = completedText.startsWith(rawText)
                    ? completedText.slice(rawText.length)
                    : rawText.trim()
                        ? ""
                        : completedText;
                if (delta) {
                    rawText += delta;
                    request.onStreamProgress?.({type: "text", delta, source: "openai-raw"});
                }
            }

            rawFinishReason = getOpenAIResponseFinishReason(raw) ?? rawFinishReason;
            rawFailureMessage = getOpenAIResponseFailureMessage(raw) ?? rawFailureMessage;
        } else if (part.type === "error") {
            throw part.error instanceof Error ? part.error : new Error(String(part.error));
        }
    }

    if (text.trim()) return text;
    if (rawText.trim()) return rawText;
    if (rawFailureMessage) {
        throw new Error(`OpenAI response failed: ${rawFailureMessage}`);
    }
    throw new Error(
        `${request.key.provider} response did not include text content. ` +
        "The model may have exhausted its output budget during reasoning." +
        (rawFinishReason ? ` Finish reason: ${rawFinishReason}.` : ""),
    );
}

function getRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function getNestedRecord(value: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
    return getRecord(value?.[key]);
}

function getOpenAIResponseTextDelta(raw: Record<string, unknown> | null): string {
    if (raw?.type === "response.output_text.delta" && typeof raw.delta === "string") {
        return raw.delta;
    }
    return "";
}

function getOpenAICompletedResponseText(raw: Record<string, unknown> | null): string {
    if (raw?.type !== "response.completed" && raw?.type !== "response.incomplete") return "";

    const response = getNestedRecord(raw, "response");
    const output = Array.isArray(response?.output) ? response.output : [];
    const parts: string[] = [];

    for (const item of output) {
        const itemRecord = getRecord(item);
        const content = Array.isArray(itemRecord?.content) ? itemRecord.content : [];
        for (const contentItem of content) {
            const contentRecord = getRecord(contentItem);
            if (contentRecord?.type === "output_text" && typeof contentRecord.text === "string") {
                parts.push(contentRecord.text);
            }
        }
    }

    return parts.join("");
}

function getOpenAIResponseFinishReason(raw: Record<string, unknown> | null): string | undefined {
    if (raw?.type !== "response.completed" && raw?.type !== "response.incomplete" && raw?.type !== "response.failed") {
        return undefined;
    }

    const response = getNestedRecord(raw, "response");
    const incompleteDetails = getNestedRecord(response, "incomplete_details");
    return typeof incompleteDetails?.reason === "string" ? incompleteDetails.reason : undefined;
}

function getOpenAIResponseFailureMessage(raw: Record<string, unknown> | null): string | undefined {
    if (raw?.type !== "response.failed") return undefined;

    const response = getNestedRecord(raw, "response");
    const error = getNestedRecord(response, "error");
    if (typeof error?.message === "string") return error.message;
    return getOpenAIResponseFinishReason(raw);
}

export function getPlaygroundMaxOutputTokens(key: CopilotChatKey): number {
    return key.provider === "openai"
        ? PLAYGROUND_OPENAI_MAX_OUTPUT_TOKENS
        : PLAYGROUND_MAX_OUTPUT_TOKENS;
}

async function createLanguageModel(key: CopilotChatKey, fetchImpl: typeof fetch): Promise<LanguageModel> {
    switch (key.provider) {
        case "anthropic": {
            const {createAnthropic} = await import("@ai-sdk/anthropic");
            const anthropic = createAnthropic({
                apiKey: key.apiKey,
                fetch: fetchImpl,
                headers: {
                    "anthropic-dangerous-direct-browser-access": "true",
                },
            });
            return anthropic(key.model);
        }
        case "gemini": {
            const {createGoogleGenerativeAI} = await import("@ai-sdk/google");
            const google = createGoogleGenerativeAI({
                apiKey: key.apiKey,
                fetch: fetchImpl,
            });
            return google(key.model);
        }
        case "openai":
        default: {
            const {createOpenAI} = await import("@ai-sdk/openai");
            const openai = createOpenAI({
                apiKey: key.apiKey,
                fetch: fetchImpl,
            });
            return openai.responses(key.model);
        }
    }
}

function buildSystemPrompt(request: PlaygroundLLMGenerateRequest): string | SystemModelMessage[] {
    if (request.key.provider !== "anthropic") {
        return `${request.systemPrompt}\n\n${request.knowledgePrompt}`;
    }

    return [
        {
            role: "system",
            content: request.systemPrompt,
        },
        {
            role: "system",
            content: request.knowledgePrompt,
            providerOptions: {
                anthropic: {
                    cacheControl: {type: "ephemeral"},
                },
            },
        },
    ];
}

function buildProviderOptions(request: PlaygroundLLMGenerateRequest): ProviderOptions | undefined {
    if (request.key.provider === "openai") {
        return {
            openai: {
                promptCacheKey: request.promptCacheKey ?? PLAYGROUND_PROMPT_CACHE_KEY,
                reasoningEffort: OPENAI_COPILOT_REASONING_EFFORT,
            },
        };
    }

    if (request.key.provider === "gemini") {
        return {
            google: {
                structuredOutputs: true,
            },
        };
    }

    return undefined;
}
