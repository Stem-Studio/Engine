import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => ({
    byokKeysPanel: vi.fn(),
    getCopilotModelSelectionSync: vi.fn(),
    resolveCopilotChatKeys: vi.fn(),
    setCopilotModelSelection: vi.fn(),
}));

vi.mock("../../../../copilot/playgroundCopilotKeys", () => ({
    COPILOT_KEYS_CHANGED_EVENT: "stem:playground-copilot-keys-changed",
    COPILOT_MODEL_OPTIONS: {
        anthropic: [{label: "Claude Sonnet 4.5", model: "claude-sonnet-4-5-20250929"}],
        openai: [{label: "GPT-5.5 High", model: "gpt-5.5"}],
        gemini: [{label: "Gemini 2.5 Flash", model: "gemini-2.5-flash"}],
    },
    getCopilotModelSelectionSync: mocks.getCopilotModelSelectionSync,
    resolveCopilotChatKeys: mocks.resolveCopilotChatKeys,
    setCopilotModelSelection: mocks.setCopilotModelSelection,
}));

vi.mock("../CreateDashboard/SettingsPage/BYOKKeysPanel/BYOKKeysPanel", () => ({
    BYOKKeysPanel: (props: {statusMode?: "backend" | "local"}) => {
        mocks.byokKeysPanel(props);
        return <div data-testid="byok-keys-panel" />;
    },
}));

import {AiKeysModal} from "./AiKeysModal";

describe("AiKeysModal", () => {
    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it("uses local key readiness for playground copilot settings", () => {
        mocks.getCopilotModelSelectionSync.mockReturnValue(null);
        mocks.resolveCopilotChatKeys.mockResolvedValue([]);

        render(<AiKeysModal onClose={vi.fn()} />);

        expect(screen.getByTestId("byok-keys-panel")).toBeInTheDocument();
        expect(mocks.byokKeysPanel.mock.calls[0]?.[0]).toEqual({statusMode: "local"});
    });

    it("lets the user choose a copilot model when multiple chat keys are configured", async () => {
        mocks.getCopilotModelSelectionSync.mockReturnValue(null);
        mocks.resolveCopilotChatKeys.mockResolvedValue([
            {provider: "openai", apiKey: "sk-openai", model: "gpt-5.5"},
            {provider: "gemini", apiKey: "sk-gemini", model: "gemini-2.5-flash"},
        ]);

        render(<AiKeysModal onClose={vi.fn()} />);

        const select = await screen.findByLabelText("Copilot model");
        fireEvent.change(select, {target: {value: "openai:gpt-5.5"}});

        expect(mocks.setCopilotModelSelection).toHaveBeenCalledWith("openai", "gpt-5.5");
    });
});
