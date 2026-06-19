// Playground copilot key plumbing.
//
// In the public-site playground there is no Go AI server — the copilot talks
// to the AI provider directly from the browser using a key the visitor
// supplies via the BYOK panel. These helpers answer two questions:
//
//   1. `hasCopilotKeysSync()` — a *synchronous* "is a chat key configured?"
//      check, backed by a localStorage marker. The editor-mode resolver runs
//      synchronously on scene load and cannot await IndexedDB, so it reads the
//      marker instead. The marker is refreshed asynchronously at bootstrap and
//      whenever the BYOK panel saves/clears a key.
//   2. `resolveCopilotChatKey()` — the actual decrypted key + provider used to
//      make requests, read from the BYOK key store on demand. Prompt-created
//      projects use a one-navigation session handoff because `openEditorRoute`
//      reloads the app and loses the encrypted store's in-memory unlock.

import {getBYOKKeyStore} from "../ai";
import type {AIProvider} from "../ai";

/**
 * Providers that can back the playground copilot. Ordered for stable UI and
 * legacy fallback behavior.
 */
export type CopilotChatProvider = Extract<AIProvider, "anthropic" | "openai" | "gemini">;

export const CHAT_PROVIDERS: ReadonlyArray<CopilotChatProvider> = [
    "anthropic",
    "openai",
    "gemini",
];

const COPILOT_READY_MARKER = "stem.playground.copilotReady";
const COPILOT_SELECTED_PROVIDER = "stem.playground.copilot.selectedProvider";
const COPILOT_ROUTE_KEY_HANDOFF = "stem.playground.copilot.routeKeyHandoff";
const COPILOT_ROUTE_KEY_HANDOFF_TTL_MS = 15 * 60 * 1000;
export const COPILOT_KEYS_CHANGED_EVENT = "stem:playground-copilot-keys-changed";
export const OPENAI_COPILOT_MODEL = "gpt-5.5";
export const OPENAI_COPILOT_REASONING_EFFORT = "high";

export const COPILOT_DEFAULT_MODELS: Record<CopilotChatProvider, string> = {
    anthropic: "claude-sonnet-4-5-20250929",
    openai: OPENAI_COPILOT_MODEL,
    gemini: "gemini-2.5-flash",
};

export const COPILOT_MODEL_OPTIONS: Record<CopilotChatProvider, Array<{label: string; model: string}>> = {
    anthropic: [
        {label: "Claude Sonnet 4.5", model: "claude-sonnet-4-5-20250929"},
        {label: "Claude Sonnet 4", model: "claude-sonnet-4-20250514"},
        {label: "Claude Opus 4.5", model: "claude-opus-4-5-20251101"},
        {label: "Claude Haiku 4.5", model: "claude-haiku-4-5-20251001"},
    ],
    openai: [
        {label: "GPT-5.5 High", model: OPENAI_COPILOT_MODEL},
    ],
    gemini: [
        {label: "Gemini 2.5 Flash", model: "gemini-2.5-flash"},
        {label: "Gemini 2.5 Pro", model: "gemini-2.5-pro"},
        {label: "Gemini Flash Latest", model: "gemini-flash-latest"},
        {label: "Gemini 3 Flash Preview", model: "gemini-3-flash-preview"},
    ],
};

export type CopilotChatKey = {
    provider: CopilotChatProvider;
    apiKey: string;
    model: string;
};

type CopilotRouteKeyHandoff = CopilotChatKey & {
    expiresAt: number;
    version: 1;
};

let activeRouteHandoffKey: CopilotChatKey | null = null;

function getLocalStorage(): Storage | undefined {
    return typeof window === "undefined" ? undefined : window.localStorage;
}

function getSessionStorage(): Storage | undefined {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
}

function isCopilotChatProvider(value: unknown): value is CopilotChatProvider {
    return typeof value === "string" && CHAT_PROVIDERS.includes(value as CopilotChatProvider);
}

function normalizeRouteHandoff(value: unknown): CopilotChatKey | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Partial<CopilotRouteKeyHandoff>;
    if (record.version !== 1) return null;
    if (!isCopilotChatProvider(record.provider)) return null;
    if (typeof record.apiKey !== "string" || !record.apiKey.trim()) return null;
    if (typeof record.model !== "string" || !record.model.trim()) return null;
    if (typeof record.expiresAt !== "number" || record.expiresAt <= Date.now()) return null;
    return {
        provider: record.provider,
        apiKey: record.apiKey.trim(),
        model: normalizeProviderModel(record.provider, record.model),
    };
}

function readRouteHandoffKey(consume = true): CopilotChatKey | null {
    if (activeRouteHandoffKey) return activeRouteHandoffKey;

    const storage = getSessionStorage();
    if (!storage) return null;

    try {
        const raw = storage.getItem(COPILOT_ROUTE_KEY_HANDOFF);
        if (!raw) return null;

        const handoffKey = normalizeRouteHandoff(JSON.parse(raw));
        if (!handoffKey) {
            storage.removeItem(COPILOT_ROUTE_KEY_HANDOFF);
            return null;
        }

        if (consume) {
            // Consume the plaintext handoff into process memory. It should only
            // bridge the dashboard -> editor reload, not remain in storage.
            storage.removeItem(COPILOT_ROUTE_KEY_HANDOFF);
            activeRouteHandoffKey = handoffKey;
        }
        return handoffKey;
    } catch {
        try {
            storage.removeItem(COPILOT_ROUTE_KEY_HANDOFF);
        } catch {
            // Ignore storage failures.
        }
        return null;
    }
}

function writeRouteHandoffKey(key: CopilotChatKey): boolean {
    activeRouteHandoffKey = null;
    const storage = getSessionStorage();
    if (!storage) {
        activeRouteHandoffKey = key;
        return false;
    }

    try {
        const payload: CopilotRouteKeyHandoff = {
            ...key,
            expiresAt: Date.now() + COPILOT_ROUTE_KEY_HANDOFF_TTL_MS,
            version: 1,
        };
        storage.setItem(COPILOT_ROUTE_KEY_HANDOFF, JSON.stringify(payload));
        return true;
    } catch {
        activeRouteHandoffKey = key;
        return false;
    }
}

export function clearCopilotChatKeyHandoff(): void {
    activeRouteHandoffKey = null;
    const storage = getSessionStorage();
    if (!storage) return;
    try {
        storage.removeItem(COPILOT_ROUTE_KEY_HANDOFF);
    } catch {
        // Ignore storage failures.
    }
}

/**
 * Synchronous best-effort answer to "can the playground copilot run?". Reads
 * the localStorage marker written by `refreshCopilotKeysMarker()`. When the
 * marker has never been written (first load before the async refresh lands)
 * this returns `false`, which makes AI-prompt projects fall back to advanced
 * mode until a key is confirmed — the intended conservative default.
 */
export function hasCopilotKeysSync(): boolean {
    const storage = getLocalStorage();
    if (!storage) return false;
    try {
        return storage.getItem(COPILOT_READY_MARKER) === "1";
    } catch {
        return false;
    }
}

function notifyKeysChanged(): void {
    if (typeof window === "undefined") return;
    try {
        window.dispatchEvent(new Event(COPILOT_KEYS_CHANGED_EVENT));
    } catch {
        // Ignore environments that do not support Event construction.
    }
}

function writeMarker(ready: boolean): void {
    const storage = getLocalStorage();
    if (!storage) return;
    try {
        if (ready) storage.setItem(COPILOT_READY_MARKER, "1");
        else storage.removeItem(COPILOT_READY_MARKER);
    } catch {
        // Ignore storage failures (private mode, denied access, quota).
    }
}

function modelStorageKey(provider: CopilotChatProvider): string {
    return `stem.playground.copilot.${provider}Model`;
}

function normalizeProviderModel(provider: CopilotChatProvider, model: string | null | undefined): string {
    if (provider === "openai") {
        return OPENAI_COPILOT_MODEL;
    }
    return model?.trim() || COPILOT_DEFAULT_MODELS[provider];
}

function readProviderModel(provider: CopilotChatProvider): string {
    const storage = getLocalStorage();
    if (!storage) return COPILOT_DEFAULT_MODELS[provider];
    try {
        const override = storage.getItem(modelStorageKey(provider))?.trim();
        return normalizeProviderModel(provider, override);
    } catch {
        return COPILOT_DEFAULT_MODELS[provider];
    }
}

function readSelectedProvider(): CopilotChatProvider | null {
    const storage = getLocalStorage();
    if (!storage) return null;
    try {
        const provider = storage.getItem(COPILOT_SELECTED_PROVIDER);
        return CHAT_PROVIDERS.includes(provider as CopilotChatProvider)
            ? provider as CopilotChatProvider
            : null;
    } catch {
        return null;
    }
}

export function getCopilotModelSelectionSync(): {provider: CopilotChatProvider; model: string} | null {
    const provider = readSelectedProvider();
    return provider ? {provider, model: readProviderModel(provider)} : null;
}

export function setCopilotModelSelection(provider: CopilotChatProvider, model?: string): void {
    const storage = getLocalStorage();
    if (!storage) return;
    try {
        storage.setItem(COPILOT_SELECTED_PROVIDER, provider);
        const normalizedModel = normalizeProviderModel(provider, model);
        if (normalizedModel) {
            storage.setItem(modelStorageKey(provider), normalizedModel);
        }
    } catch {
        // Ignore storage failures.
    }
}

export type CopilotChatKeyChoice =
    | {kind: "none"; keys: []}
    | {kind: "ready"; key: CopilotChatKey; keys: CopilotChatKey[]}
    | {kind: "needs-selection"; keys: CopilotChatKey[]};

type ResolveCopilotChatKeysOptions = {
    includeHandoff?: boolean;
    consumeHandoff?: boolean;
};

/**
 * Resolve every chat-capable BYOK key currently available to the direct
 * playground copilot.
 */
export async function resolveCopilotChatKeys(
    options: ResolveCopilotChatKeysOptions = {},
): Promise<CopilotChatKey[]> {
    const store = getBYOKKeyStore();
    let keys: Partial<Record<AIProvider, string>>;
    if (store) {
        try {
            keys = await store.all();
        } catch {
            keys = {};
        }
    } else {
        keys = {};
    }
    const available: CopilotChatKey[] = [];
    for (const provider of CHAT_PROVIDERS) {
        const apiKey = keys[provider]?.trim();
        if (apiKey) available.push({provider, apiKey, model: readProviderModel(provider)});
    }
    if (available.length === 0 && options.includeHandoff !== false) {
        const handoffKey = readRouteHandoffKey(options.consumeHandoff !== false);
        if (handoffKey) available.push(handoffKey);
    }
    return available;
}

export async function resolveCopilotChatKeyChoice(
    options: ResolveCopilotChatKeysOptions = {},
): Promise<CopilotChatKeyChoice> {
    const keys = await resolveCopilotChatKeys(options);
    if (keys.length === 0) return {kind: "none", keys: []};
    if (keys.length === 1) return {kind: "ready", key: keys[0]!, keys};

    const selectedProvider = readSelectedProvider();
    const selectedKey = selectedProvider
        ? keys.find(key => key.provider === selectedProvider)
        : undefined;
    if (selectedKey) return {kind: "ready", key: selectedKey, keys};

    return {kind: "needs-selection", keys};
}

/**
 * Resolve the chat key to use for direct provider calls. Returns `null` when
 * no chat-capable key is configured, no route handoff is available for a
 * locked encrypted store, or multiple chat keys exist without a chosen copilot
 * model.
 */
export async function resolveCopilotChatKey(): Promise<CopilotChatKey | null> {
    const choice = await resolveCopilotChatKeyChoice();
    return choice.kind === "ready" ? choice.key : null;
}

/**
 * Stage the selected chat key for a dashboard -> editor hard navigation. This
 * is intentionally short-lived and consumed into memory on the editor page.
 */
export async function prepareCopilotChatKeyHandoff(): Promise<boolean> {
    const choice = await resolveCopilotChatKeyChoice({includeHandoff: false});
    if (choice.kind !== "ready") return false;
    writeMarker(true);
    return writeRouteHandoffKey(choice.key);
}

/**
 * Re-read the BYOK store and update the synchronous marker. Returns whether a
 * chat key is currently configured. Call at bootstrap and after any key
 * mutation.
 */
export async function refreshCopilotKeysMarker(): Promise<boolean> {
    const ready = (await resolveCopilotChatKeys({consumeHandoff: false})).length > 0;
    if (!ready) clearCopilotChatKeyHandoff();
    writeMarker(ready);
    notifyKeysChanged();
    return ready;
}
