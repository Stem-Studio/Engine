/**
 * Unified deferred command buffer.
 * Replaces BehaviorManager.commandQueue and LambdaBase._pendingOps
 * with a single buffer flushed at stage boundaries.
 */

export type DeferredCommand =
    | { type: "add"; target: string; system: string; data?: unknown }
    | { type: "remove"; target: string; system: string }
    | { type: "custom"; callback: () => void };

export interface DeferredCommandHandler {
    add?(target: string, data?: unknown): void;
    remove?(target: string): void;
}

export class CommandBuffer {
    private commands: DeferredCommand[] = [];
    private handlers = new Map<string, DeferredCommandHandler>();
    private hasWarnedUnwiredCommands = false;

    push(cmd: DeferredCommand): void {
        this.commands.push(cmd);
    }

    registerHandler(system: string, handler: DeferredCommandHandler): void {
        this.handlers.set(system, handler);
    }

    unregisterHandler(system: string): void {
        this.handlers.delete(system);
    }

    /**
     * Execute and clear all queued commands.
     * Called by FrameOrchestrator at stage boundaries.
     */
    flush(): void {
        if (this.commands.length === 0) return;

        const batch = this.commands;
        this.commands = [];
        let droppedUnwiredCommands = 0;

        for (const cmd of batch) {
            if (cmd.type === "custom") {
                try {
                    cmd.callback();
                } catch (e) {
                    console.error("[CommandBuffer] Error executing command:", e);
                }
                continue;
            }

            const handler = this.handlers.get(cmd.system);
            const commandHandler = cmd.type === "add" ? handler?.add : handler?.remove;

            if (!commandHandler) {
                droppedUnwiredCommands++;
                continue;
            }

            try {
                if (cmd.type === "add") {
                    commandHandler.call(handler, cmd.target, cmd.data);
                } else {
                    commandHandler.call(handler, cmd.target);
                }
            } catch (e) {
                console.error(`[CommandBuffer] Error executing ${cmd.type} command for system "${cmd.system}":`, e);
            }
        }

        if (droppedUnwiredCommands > 0 && !this.hasWarnedUnwiredCommands) {
            console.warn(
                `[CommandBuffer] Dropped ${droppedUnwiredCommands} add/remove command(s) because no handlers are registered.`,
            );
            this.hasWarnedUnwiredCommands = true;
        }
    }

    get pending(): number {
        return this.commands.length;
    }

    dispose(): void {
        this.commands = [];
        this.handlers.clear();
        this.hasWarnedUnwiredCommands = false;
    }
}
