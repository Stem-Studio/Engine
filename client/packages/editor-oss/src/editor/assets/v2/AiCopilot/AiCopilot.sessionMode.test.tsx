import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("./AiCopilot.styles", () => {
    const cleanProps = (props: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(props).filter(([key]) => !key.startsWith("$")));
    const div = ({children, ...props}: any) => <div {...cleanProps(props)}>{children}</div>;
    const span = ({children, ...props}: any) => <span {...cleanProps(props)}>{children}</span>;
    const button = ({children, ...props}: any) => <button {...cleanProps(props)}>{children}</button>;
    const textarea = (props: any) => <textarea {...cleanProps(props)} />;
    const img = (props: any) => <img {...cleanProps(props)} />;

    return {
        AiMessages: div,
        AttachedObjectChip: div,
        AttachedObjectsList: div,
        AttachmentChip: div,
        CloseBtn: img,
        ConnectionAttemptText: div,
        ConnectionStatusContainer: div,
        ConnectionStatusIcon: div,
        ConnectionStatusMessage: div,
        ConnectionStatusTitle: div,
        Container: div,
        HeaderButtonsContainer: div,
        HeaderContainer: div,
        InputWrapper: div,
        InsufficientCreditsNotice: div,
        InsufficientCreditsSubtext: div,
        MessageAttachments: div,
        ObjectName: span,
        PermissionButton: button,
        PermissionButtons: div,
        PermissionContainer: div,
        PermissionMessage: div,
        PlaygroundProcessingBanner: div,
        ProcessingMainText: div,
        ProcessingStatusContainer: div,
        ProcessingSubText: div,
        Prompt: textarea,
        RemoveButton: button,
        ResetBt: button,
        RetryButton: button,
        SubmitButton: button,
        SuggestedObjectChip: div,
    };
});

const mocks = vi.hoisted(() => ({
    advancedMode: true,
    appGlobal: {app: null as any},
    isPlayground: false,
    provider: null as any,
    setAdvancedMode: vi.fn(),
    refreshAiCredits: vi.fn(),
    getAiCreditsConfig: vi.fn(),
    showToast: vi.fn(),
}));

vi.mock("@stem/editor-oss/mode/buildMode", () => ({
    BUILD_MODE: "oss",
    IS_INTEGRATED: false,
    IS_OSS: true,
}));

vi.mock("@web-shared/playgroundMode", () => ({
    isPlaygroundMode: () => mocks.isPlayground,
}));

vi.mock("@stem/editor-oss/global", () => ({
    default: mocks.appGlobal,
}));

vi.mock("@stem/editor-oss/EngineRuntime", () => ({
    default: class EngineRuntime {},
    ApplicationMode: {EDIT: "edit", PLAY: "play"},
}));

vi.mock("@stem/editor-oss/context", () => ({
    useAppGlobalContext: () => ({
        advancedMode: mocks.advancedMode,
        setAdvancedMode: mocks.setAdvancedMode,
    }),
    useAuthorizationContext: () => ({
        aiCredits: 100,
        dbUser: {id: "user-1"},
        isAdmin: false,
        refreshAiCredits: mocks.refreshAiCredits,
    }),
}));

vi.mock("@stem/editor-oss/showToast", () => ({
    showToast: (...args: unknown[]) => mocks.showToast(...args),
}));

vi.mock("@stem/editor-oss/agent/utils/serialization", () => ({
    serializeObjectSummaryForPrompt: () => ({}),
}));

vi.mock("@stem/network/api/user", () => ({
    getAiCreditsConfig: (...args: unknown[]) => mocks.getAiCreditsConfig(...args),
}));

vi.mock("../../../../copilot", () => ({
    getCopilotProvider: () => mocks.provider,
}));

vi.mock("../common/ResizableWrapper/ResizableWrapper", () => ({
    ResizableWrapper: ({children, style}: any) => (
        <div
            data-testid="resizable-wrapper"
            style={style}
        >
            {children}
        </div>
    ),
}));

vi.mock("./AiKeysModal", () => ({
    AiKeysModal: () => <div data-testid="ai-keys-modal" />,
}));

vi.mock("./InteractiveResults/InteractiveResults", () => ({
    InteractiveResults: () => <div data-testid="interactive-results" />,
}));

vi.mock("./TerminalView/TerminalView", () => ({
    TerminalView: () => <div data-testid="terminal-view" />,
}));

vi.mock("./TerminalView/TerminalView.styles", () => ({
    TerminalBadge: ({children}: any) => <span>{children}</span>,
}));

vi.mock("./TerminalView/useTerminal", () => ({
    useTerminal: () => ({
        clear: vi.fn(),
        entries: [],
        execute: vi.fn().mockResolvedValue(undefined),
        isExecuting: false,
    }),
}));

vi.mock("../CreditsBar/CreditsBar", () => ({
    CreditsBar: () => <div data-testid="credits-bar" />,
}));

import {AiCopilot} from "./AiCopilot";

type ProviderMock = {
    cancelCurrentTask: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    createSession: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    getCurrentSessionId: ReturnType<typeof vi.fn>;
    getSessionId: ReturnType<typeof vi.fn>;
    isConnected: ReturnType<typeof vi.fn>;
    loadSession: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    prompt: ReturnType<typeof vi.fn>;
    emitTestEvent: (eventType: string, data?: Record<string, unknown>) => void;
};

const createProvider = (): ProviderMock => {
    const listeners = new Map<string, Array<(event: {type: string; data?: Record<string, unknown>}) => void>>();

    return {
        cancelCurrentTask: vi.fn().mockResolvedValue(undefined),
        checkPendingInteractiveResult: vi.fn(() => false),
        connect: vi.fn().mockResolvedValue(undefined),
        createSession: vi.fn().mockResolvedValue("new-session"),
        disconnect: vi.fn(),
        emitTestEvent: (eventType: string, data: Record<string, unknown> = {}) => {
            for (const handler of listeners.get(eventType) ?? []) {
                handler({type: eventType, data});
            }
        },
        executeCommand: vi.fn().mockResolvedValue({success: true}),
        getConnectionState: vi.fn(() => "connected"),
        getCurrentSessionId: vi.fn(() => null),
        getSessionId: vi.fn(() => "current-session"),
        hasPendingInteractiveResults: vi.fn(() => false),
        isConnected: vi.fn(() => true),
        isSuppressingSessionUpdates: false,
        loadSession: vi.fn().mockResolvedValue(undefined),
        on: vi.fn((eventType: string, handler: (event: {type: string; data?: Record<string, unknown>}) => void) => {
            const current = listeners.get(eventType) ?? [];
            current.push(handler);
            listeners.set(eventType, current);
        }),
        prompt: vi.fn().mockResolvedValue(undefined),
        respondToPermissionRequest: vi.fn(),
        submitInteractiveSelectionResolution: vi.fn(() => false),
    } as unknown as ProviderMock;
};

const createApp = () => ({
    call: vi.fn(),
    editor: {
        aiPromptMode: false,
        assetSource: null,
        objectByUuid: vi.fn(),
        scene: {traverse: vi.fn(), userData: {}},
        sceneID: "scene-1",
        sceneName: "Scene 1",
        select: vi.fn(),
        selected: null,
    },
    isPaused: false,
    isPlaying: false,
    on: vi.fn(),
    scene: {traverse: vi.fn(), userData: {}},
    setMode: vi.fn().mockResolvedValue(undefined),
});

const renderCopilot = () =>
    render(
        <AiCopilot
            isOpen
            setIsOpen={vi.fn()}
        />,
    );

describe("AiCopilot session mode startup", () => {
    beforeEach(() => {
        cleanup();
        localStorage.clear();
        sessionStorage.clear();
        mocks.advancedMode = true;
        mocks.isPlayground = false;
        mocks.appGlobal.app = createApp();
        mocks.provider = createProvider();
        mocks.setAdvancedMode.mockReset();
        mocks.refreshAiCredits.mockReset();
        mocks.refreshAiCredits.mockResolvedValue(100);
        mocks.getAiCreditsConfig.mockReset();
        mocks.getAiCreditsConfig.mockResolvedValue({CreditsRefreshRate: 604800});
        mocks.showToast.mockReset();
        HTMLElement.prototype.scrollTo = vi.fn();
    });

    afterEach(() => {
        cleanup();
    });

    it("starts a fresh local session in playground without server history or preview workflow UI", async () => {
        mocks.isPlayground = true;

        renderCopilot();

        await waitFor(() => expect(mocks.provider.createSession).toHaveBeenCalledOnce());

        expect(mocks.provider.loadSession).not.toHaveBeenCalled();
        expect(screen.queryByText("Loading session")).not.toBeInTheDocument();
        expect(screen.getByText("Keys")).toBeInTheDocument();
        expect(screen.queryByText("History")).not.toBeInTheDocument();
        expect(screen.queryByTestId("copilot-activity-feed")).not.toBeInTheDocument();
        expect(screen.queryByTestId("copilot-version-timeline")).not.toBeInTheDocument();
    });

    it("renders thinking and tool workflow as collapsible process details", async () => {
        mocks.isPlayground = true;

        renderCopilot();

        await waitFor(() => expect(mocks.provider.createSession).toHaveBeenCalledOnce());

        act(() => {
            mocks.provider.emitTestEvent("agentThinking", {
                message: "Generating StemScript for the live scene...",
            });
        });

        await waitFor(() => {
            const processDetails = screen.getByTestId("copilot-process-details");
            expect(processDetails.textContent).toContain("Thinking and workflow");
            expect(processDetails.textContent).toContain("Generating StemScript for the live scene");
        });

        act(() => {
            mocks.provider.emitTestEvent("toolCall", {toolCall: {title: "Inspect scene"}});
            mocks.provider.emitTestEvent("toolCallUpdate", {
                line: "list objects filter=Player",
                index: 0,
                total: 1,
            });
        });

        await waitFor(() => {
            const processText = screen
                .getAllByTestId("copilot-process-details")
                .map(element => element.textContent ?? "")
                .join("\n");
            expect(processText).toContain("Inspect scene");
            expect(processText).toContain("list objects filter=Player");
        });
    });

    it("does not render blank transcript rows for empty agent chunks", async () => {
        mocks.isPlayground = true;

        const {container} = renderCopilot();

        await waitFor(() => expect(mocks.provider.createSession).toHaveBeenCalledOnce());

        act(() => {
            mocks.provider.emitTestEvent("agentMessage", {
                message: "   ",
            });
            mocks.provider.emitTestEvent("agentThinking", {
                message: "   ",
            });
        });

        expect(container.querySelector(".message-agent")).not.toBeInTheDocument();
        expect(screen.queryByTestId("copilot-process-details")).not.toBeInTheDocument();
    });

    it("shows the playground browser-running banner only while chat prompt is processing", async () => {
        mocks.isPlayground = true;

        renderCopilot();

        await waitFor(() => expect(mocks.provider.createSession).toHaveBeenCalledOnce());

        expect(screen.queryByTestId("copilot-playground-processing-banner")).not.toBeInTheDocument();

        act(() => {
            mocks.provider.emitTestEvent("promptStarted", {
                prompt: "make a game",
            });
        });

        await waitFor(() => {
            expect(screen.getByTestId("copilot-playground-processing-banner").textContent).toContain(
                "COPILOT IS RUNNING IN THE BROWSER",
            );
        });

        act(() => {
            mocks.provider.emitTestEvent("promptCompleted");
        });

        await waitFor(() => {
            expect(screen.queryByTestId("copilot-playground-processing-banner")).not.toBeInTheDocument();
        });
    });

    it("surfaces OpenAI stream progress in the playground processing status", async () => {
        mocks.isPlayground = true;

        renderCopilot();

        await waitFor(() => expect(mocks.provider.createSession).toHaveBeenCalledOnce());

        act(() => {
            mocks.provider.emitTestEvent("promptStarted", {
                prompt: "make a game",
            });
            mocks.provider.emitTestEvent("toolCall", {toolCall: {title: "Stream OpenAI response"}});
            mocks.provider.emitTestEvent("toolCallUpdate", {
                line: "OpenAI stream active (text=2.1K chars, reasoning=8.3K chars, events=4)",
            });
        });

        await waitFor(() => {
            expect(screen.getByText(
                "OpenAI stream active (text=2.1K chars, reasoning=8.3K chars, events=4)",
            )).toBeInTheDocument();
        });
    });

    it("starts a fresh local session in non-playground OSS mode without server history", async () => {
        mocks.isPlayground = false;

        renderCopilot();

        await waitFor(() => expect(mocks.provider.createSession).toHaveBeenCalledOnce());

        expect(mocks.provider.loadSession).not.toHaveBeenCalled();
        expect(screen.queryByText("Loading session")).not.toBeInTheDocument();
        expect(screen.queryByText("History")).not.toBeInTheDocument();
        expect(screen.queryByText("Keys")).not.toBeInTheDocument();
    });

    it.each([
        ["playground", true],
        ["non-playground", false],
    ])("removes preview, version, and task workflow from %s workspace mode", async (_label, isPlayground) => {
        mocks.advancedMode = false;
        mocks.isPlayground = isPlayground;

        renderCopilot();

        await waitFor(() => expect(mocks.provider.createSession).toHaveBeenCalledOnce());

        expect(screen.queryByTestId("copilot-activity-feed")).not.toBeInTheDocument();
        expect(screen.queryByTestId("copilot-version-timeline")).not.toBeInTheDocument();
        expect(screen.queryByTestId("copilot-confirmation-card")).not.toBeInTheDocument();
        expect(mocks.provider.on).not.toHaveBeenCalledWith("commandWillExecute", expect.any(Function));
        expect(mocks.appGlobal.app.call).not.toHaveBeenCalled();
    });

    it.each(["/version", "/publish"])("passes %s through as a regular prompt", async command => {
        mocks.advancedMode = false;
        mocks.isPlayground = true;

        renderCopilot();

        await waitFor(() => expect(mocks.provider.createSession).toHaveBeenCalledOnce());

        fireEvent.change(screen.getByTestId("copilot-prompt"), {target: {value: command}});
        const generateButton = screen.getByTitle("Generate");
        await waitFor(() => expect(generateButton).not.toBeDisabled());
        fireEvent.click(generateButton);

        await waitFor(() => expect(mocks.provider.prompt).toHaveBeenCalledWith(command, expect.any(Object)));
        expect(screen.queryByText("Version and publish actions are not available in this Copilot mode."))
            .not.toBeInTheDocument();
    });
});
