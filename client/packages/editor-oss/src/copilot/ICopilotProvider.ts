import type {RequestPermissionResponse} from "@agentclientprotocol/sdk";

import type {ACPEvent, ACPEventType, ConnectionState} from "../agent/types/ACPTypes";
import type {CommandExecutionResult} from "../agent/CommandsExecutor";

/**
 * Listener signature for events emitted by the copilot provider.
 */
export type CopilotEventHandler = (event: ACPEvent) => void;

/**
 * ICopilotProvider is the seam between the editor UI and any copilot
 * implementation. Forks can ship their own provider, for example a thin
 * wrapper around a locally hosted LLM, by registering with
 * `setCopilotProvider()`.
 *
 * The surface is deliberately narrow — only what the three editor-oss call
 * sites (EditorComponent.tsx, AiCopilot.tsx, utils/interaction.ts) actually
 * touch. Wider implementation details such as prompt-pack policy, transport,
 * tool tracing, and JSON-RPC framing stay private to the implementation.
 *
 * Key handling rule:
 *
 *   The provider owns its own session lifecycle and authentication. Editor
 *   code never knows whether the underlying transport is ACP, HTTP, or
 *   something else — it asks the provider to `connect()`, then drives it
 *   via `prompt()` / `executeCommand()` and listens via `on()`.
 */
export interface ICopilotProvider {
    /**
     * Whether the provider is currently replaying session updates after a
     * load (suppressing UI side-effects). The AiCopilot UI peeks at this
     * to decide whether to update its session-seq counter.
     */
    readonly isSuppressingSessionUpdates: boolean;

    /** Open the transport. Idempotent on the implementation side. */
    connect(isRetry?: boolean): Promise<void>;

    /** Close the transport and tear down listeners. */
    disconnect(): void;

    /** True iff the transport is healthy. */
    isConnected(): boolean;

    /** Coarse state machine the UI uses for the "connecting…" indicator. */
    getConnectionState(): ConnectionState;

    /** Abort the in-flight prompt / task. No-op if nothing is running. */
    cancelCurrentTask(): Promise<void>;

    /** Send a free-form prompt to the agent. Returns the final agent text. */
    prompt(promptText: string, context?: Record<string, unknown>): Promise<string>;

    /**
     * Invoke a structured ACP command (typically used to confirm an
     * interactive selection or replay a tool-use turn).
     */
    executeCommand(method: string, params: Record<string, unknown>): Promise<CommandExecutionResult>;

    /** Create a fresh session. Returns the session ID. */
    createSession(): Promise<string>;

    /** Resume a prior session. */
    loadSession(sessionId: string): Promise<void>;

    /**
     * The session ID for the current turn. Newer callers should prefer
     * `getSessionId()` — `getCurrentSessionId()` exists for backward
     * compatibility with legacy AiCopilot code paths.
     */
    getCurrentSessionId(): string | null;
    getSessionId(): string | null;

    /**
     * Resolve a pending permission request. Called when the user accepts
     * or denies an `permissionRequested` event.
     */
    respondToPermissionRequest(requestId: string, response: RequestPermissionResponse): void;

    /** True iff the executor has interactive results waiting for the user. */
    hasPendingInteractiveResults(): boolean;

    /**
     * Resolve an interactive result with the user's selection and the
     * resulting command outputs. Returns true if the resolution unblocked
     * an in-flight prompt; false if nothing was waiting on it.
     */
    submitInteractiveSelectionResolution(
        resolution: import("../agent/types/ACPTypes").InteractiveSelectionResolution,
    ): boolean;

    /** True iff the given interactive ID is currently waiting on the user. */
    checkPendingInteractiveResult(id: string): boolean;

    /** Subscribe to a typed ACP event. */
    on(eventType: ACPEventType, handler: CopilotEventHandler): void;
}
