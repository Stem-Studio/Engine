export type DebouncedSaveCoordinatorOptions = {
    debounceMs: number;
    retryMs: number;
    isDirty: () => boolean;
    save: () => Promise<void>;
    /** Invalidate an active persistence operation when the user discards. */
    onDiscard?: () => void;
};

/**
 * Coalesces bursts of editor mutations into one save and guarantees that its
 * save callback never overlaps itself. A failed save leaves the caller's dirty
 * marker untouched and schedules a retry.
 */
export class DebouncedSaveCoordinator {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private inFlight: Promise<void> | null = null;
    private queuedWhileSaving = false;
    private discardRequested = false;

    constructor(private readonly options: DebouncedSaveCoordinatorOptions) {}

    markDirty(): void {
        this.discardRequested = false;
        if (this.inFlight) {
            this.queuedWhileSaving = true;
            return;
        }
        this.schedule(this.options.debounceMs);
    }

    cancelPending(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    async flush(): Promise<void> {
        this.discardRequested = false;
        this.cancelPending();

        if (this.inFlight) {
            this.queuedWhileSaving = true;
            return this.inFlight;
        }
        if (!this.options.isDirty()) return;

        let succeeded = false;
        const operation = this.options.save();
        this.inFlight = operation;
        try {
            await operation;
            succeeded = true;
        } finally {
            if (this.inFlight === operation) this.inFlight = null;
            const needsFollowUp = this.queuedWhileSaving || this.options.isDirty();
            this.queuedWhileSaving = false;
            if (needsFollowUp && !this.discardRequested) {
                this.schedule(succeeded ? this.options.debounceMs : this.options.retryMs);
            }
        }
    }

    /**
     * Flush every dirty generation, including edits queued while an earlier
     * generation was in flight. Lifecycle callers use this before disposing
     * the scene so a successful return means there is no pending local write.
     */
    async flushFully(): Promise<void> {
        this.discardRequested = false;
        for (;;) {
            this.cancelPending();
            await this.flush();
            this.cancelPending();
            if (!this.inFlight && !this.queuedWhileSaving && !this.options.isDirty()) return;
        }
    }

    /**
     * Cancel all not-yet-started generations. An already active durable write
     * cannot be revoked, so wait for it to settle before returning and suppress
     * the queued follow-up.
     */
    async discardPending(): Promise<void> {
        this.discardRequested = true;
        this.cancelPending();
        this.queuedWhileSaving = false;
        // A durable browser write cannot be force-cancelled by the coordinator.
        // Give the persistence layer a synchronous invalidation hook instead of
        // blocking editor teardown behind serialization or IndexedDB/FS I/O.
        // The save path checks this token before committing, so Don't Save is
        // deterministic even when autosave started just before the click.
        this.options.onDiscard?.();
        this.cancelPending();
        this.queuedWhileSaving = false;
    }

    private schedule(delayMs: number): void {
        this.cancelPending();
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.flush().catch(() => {
                // The save path already reports the failure to the UI. The
                // coordinator keeps the scene dirty and schedules the retry.
            });
        }, delayMs);
    }
}
