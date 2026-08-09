import {cleanup, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => ({
    capabilities: vi.fn(),
    clearCopilotChatKeyHandoff: vi.fn(),
    clearProviderKey: vi.fn(),
    hasPassphrase: vi.fn(),
    isUnlocked: vi.fn(),
    keyStoreAll: vi.fn(),
    prepareCopilotChatKeyHandoff: vi.fn(),
    refreshCopilotKeysMarker: vi.fn(),
    setProviderKey: vi.fn(),
}));

vi.mock("../../../../../../ai", () => ({
    getAIBackend: () => ({
        capabilities: mocks.capabilities,
        clearProviderKey: mocks.clearProviderKey,
        setProviderKey: mocks.setProviderKey,
    }),
    getBYOKKeyStore: () => ({
        all: mocks.keyStoreAll,
        hasPassphrase: mocks.hasPassphrase,
        isUnlocked: mocks.isUnlocked,
    }),
}));

vi.mock("../../../../../../copilot/playgroundCopilotKeys", () => ({
    clearCopilotChatKeyHandoff: mocks.clearCopilotChatKeyHandoff,
    prepareCopilotChatKeyHandoff: mocks.prepareCopilotChatKeyHandoff,
    refreshCopilotKeysMarker: mocks.refreshCopilotKeysMarker,
}));

import {BYOKKeysPanel} from "./BYOKKeysPanel";

const capabilitiesWithAnthropicEnv = {
    buildMode: "oss",
    providers: {
        anthropic: {status: "ready", source: "env"},
        openai: {status: "missing-key", source: ""},
        meshy: {status: "missing-key", source: ""},
        elevenlabs: {status: "missing-key", source: ""},
        anythingworld: {status: "missing-key", source: ""},
        gemini: {status: "missing-key", source: ""},
        tripo: {status: "missing-key", source: ""},
    },
};

const providerRow = (label: string) => {
    const labelElement = screen.getByText(label).closest("div");
    if (!labelElement) throw new Error(`Missing provider row for ${label}`);
    return within(labelElement);
};

describe("BYOKKeysPanel", () => {
    beforeEach(() => {
        mocks.capabilities.mockResolvedValue(capabilitiesWithAnthropicEnv);
        mocks.keyStoreAll.mockResolvedValue({});
        mocks.hasPassphrase.mockResolvedValue(false);
        mocks.isUnlocked.mockReturnValue(true);
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it("uses backend capabilities by default", async () => {
        render(<BYOKKeysPanel />);

        await waitFor(() => {
            expect(providerRow("Anthropic (Claude)").getByText("ready")).toBeInTheDocument();
        });
        expect(screen.getByText("from server environment")).toBeInTheDocument();
        expect(mocks.capabilities).toHaveBeenCalledWith(true);
    });

    it("ignores backend env readiness in local status mode", async () => {
        render(<BYOKKeysPanel statusMode="local" />);

        await waitFor(() => {
            expect(providerRow("Anthropic (Claude)").getByText("missing")).toBeInTheDocument();
        });
        expect(screen.queryByText("from server environment")).not.toBeInTheDocument();
        expect(mocks.capabilities).not.toHaveBeenCalled();
    });

    it("reports local browser keys as ready in local status mode", async () => {
        mocks.keyStoreAll.mockResolvedValue({anthropic: "sk-local"});

        render(<BYOKKeysPanel statusMode="local" />);

        await waitFor(() => {
            expect(providerRow("Anthropic (Claude)").getByText("ready")).toBeInTheDocument();
        });
        expect(screen.getByText("saved in this browser")).toBeInTheDocument();
    });
});
