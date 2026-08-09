import type {EditorStopSavePolicy} from "../editor/Editor";

import type {DebouncedSaveCoordinator} from "./DebouncedSaveCoordinator";

export class LocalAutosaveDirtyWatchdog {
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(
        private readonly shouldNotify: () => boolean,
        private readonly onDirty: () => void,
        private readonly intervalMs = 2_000,
    ) {}

    get isRunning(): boolean {
        return this.timer !== null;
    }

    start(): void {
        if (this.timer) return;
        this.timer = setInterval(() => {
            if (this.shouldNotify()) this.onDirty();
        }, this.intervalMs);
    }

    stop(): void {
        if (!this.timer) return;
        clearInterval(this.timer);
        this.timer = null;
    }
}

/**
 * Persistence barrier shared by Editor.stop and lifecycle regression tests.
 * A failed flush aborts the transition and guarantees the dirty watchdog is
 * running again before the rejection reaches EngineRuntime.
 */
export async function prepareLocalAutosaveForStop(options: {
    policy: EditorStopSavePolicy;
    coordinator: DebouncedSaveCoordinator;
    watchdog: LocalAutosaveDirtyWatchdog;
    hasDirtyChanges: () => boolean;
    setStopping: (stopping: boolean) => void;
}): Promise<void> {
    if (options.policy === "discard") {
        options.setStopping(true);
        options.watchdog.stop();
        await options.coordinator.discardPending();
        return;
    }

    if (options.hasDirtyChanges()) {
        try {
            await options.coordinator.flushFully();
        } catch (error) {
            options.setStopping(false);
            options.watchdog.start();
            throw error;
        }
    }

    options.setStopping(true);
    options.watchdog.stop();
}
