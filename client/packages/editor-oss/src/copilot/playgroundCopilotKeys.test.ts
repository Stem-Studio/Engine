import {beforeEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => ({
    store: {
        all: vi.fn(),
    },
}));

vi.mock("../ai", () => ({
    getBYOKKeyStore: () => mocks.store,
}));

import {
    clearCopilotChatKeyHandoff,
    getCopilotModelSelectionSync,
    hasCopilotKeysSync,
    prepareCopilotChatKeyHandoff,
    refreshCopilotKeysMarker,
    resolveCopilotChatKeyChoice,
    resolveCopilotChatKeys,
    setCopilotModelSelection,
} from "./playgroundCopilotKeys";

describe("playgroundCopilotKeys", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearCopilotChatKeyHandoff();
        window.localStorage.clear();
        window.sessionStorage.clear();
    });

    it("resolves a single chat key with the provider default model", async () => {
        mocks.store.all.mockResolvedValue({openai: "sk-openai"});

        const keys = await resolveCopilotChatKeys();
        const choice = await resolveCopilotChatKeyChoice();

        expect(keys).toEqual([{provider: "openai", apiKey: "sk-openai", model: "gpt-5.5"}]);
        expect(choice).toEqual({kind: "ready", key: keys[0], keys});
    });

    it("requires an explicit model selection when multiple chat keys exist", async () => {
        mocks.store.all.mockResolvedValue({
            anthropic: "sk-anthropic",
            openai: "sk-openai",
        });

        const choice = await resolveCopilotChatKeyChoice();

        expect(choice.kind).toBe("needs-selection");
        expect(choice.keys.map(key => key.provider)).toEqual(["anthropic", "openai"]);
    });

    it("uses the selected provider and per-provider model override", async () => {
        mocks.store.all.mockResolvedValue({
            anthropic: "sk-anthropic",
            openai: "sk-openai",
        });

        setCopilotModelSelection("openai", "gpt-5.1-codex");

        const choice = await resolveCopilotChatKeyChoice();

        expect(getCopilotModelSelectionSync()).toEqual({provider: "openai", model: "gpt-5.5"});
        expect(choice.kind).toBe("ready");
        if (choice.kind === "ready") {
            expect(choice.key).toEqual({provider: "openai", apiKey: "sk-openai", model: "gpt-5.5"});
        }
    });

    it("marks the playground copilot ready when any chat key exists", async () => {
        mocks.store.all.mockResolvedValue({
            anthropic: "sk-anthropic",
            openai: "sk-openai",
        });

        const ready = await refreshCopilotKeysMarker();

        expect(ready).toBe(true);
        expect(hasCopilotKeysSync()).toBe(true);
    });

    it("clears the playground copilot ready marker when chat keys are wiped", async () => {
        mocks.store.all.mockResolvedValueOnce({anthropic: "sk-anthropic"});
        await refreshCopilotKeysMarker();
        expect(hasCopilotKeysSync()).toBe(true);

        mocks.store.all.mockResolvedValueOnce({});
        const ready = await refreshCopilotKeysMarker();

        expect(ready).toBe(false);
        expect(hasCopilotKeysSync()).toBe(false);
    });

    it("uses a prepared route handoff when the encrypted store is locked after navigation", async () => {
        const handoffStorageKey = "stem.playground.copilot.routeKeyHandoff";
        mocks.store.all.mockResolvedValueOnce({openai: "sk-openai"});

        const prepared = await prepareCopilotChatKeyHandoff();

        expect(prepared).toBe(true);
        expect(window.sessionStorage.getItem(handoffStorageKey)).toContain("sk-openai");

        mocks.store.all.mockResolvedValueOnce({});
        const ready = await refreshCopilotKeysMarker();

        expect(ready).toBe(true);
        expect(hasCopilotKeysSync()).toBe(true);
        expect(window.sessionStorage.getItem(handoffStorageKey)).toContain("sk-openai");

        mocks.store.all.mockResolvedValueOnce({});
        const choice = await resolveCopilotChatKeyChoice();

        expect(choice.kind).toBe("ready");
        if (choice.kind === "ready") {
            expect(choice.key).toEqual({provider: "openai", apiKey: "sk-openai", model: "gpt-5.5"});
        }
        expect(window.sessionStorage.getItem(handoffStorageKey)).toBeNull();
    });
});
