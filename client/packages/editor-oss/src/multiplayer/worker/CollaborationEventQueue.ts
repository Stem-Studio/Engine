export type EventPriority = "high" | "normal" | "low";

const PRIORITY_ORDER: Record<EventPriority, number> = {
    high: 0,
    normal: 1,
    low: 2,
};

export type QueuedEvent = {
    id: string;
    type: string;
    uuid: string;
    payload: unknown;
    priority: EventPriority;
    timestamp: number;
    handler: () => Promise<void> | void;
};

const DEFAULT_MAX_SIZE = 10_000;

export class CollaborationEventQueue {
    private processing: Map<string, Promise<void>> = new Map();
    private pending: Map<string, QueuedEvent[]> = new Map();
    private pendingCount = 0;
    private drainScheduled = false;
    private drainTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly maxSize: number;
    private readonly drainDelayMs: number;

    constructor(maxSize: number = DEFAULT_MAX_SIZE, drainDelayMs: number = 0) {
        this.maxSize = maxSize;
        this.drainDelayMs = drainDelayMs;
    }

    enqueue(event: QueuedEvent): void {
        let queue = this.pending.get(event.uuid);
        if (!queue) {
            queue = [];
            this.pending.set(event.uuid, queue);
        }

        const previousLength = queue.length;
        this.applyDeduplication(queue, event);
        this.pendingCount += queue.length - previousLength;

        if (this.pendingCount > this.maxSize) {
            this.evictOldest();
        }

        this.scheduleDrain();
    }

    isProcessing(uuid: string): boolean {
        return this.processing.has(uuid);
    }

    isIdle(): boolean {
        return this.processing.size === 0 && this.pendingCount === 0;
    }

    hasPending(uuid: string): boolean {
        const queue = this.pending.get(uuid);
        return !!queue && queue.length > 0;
    }

    removePending(uuid: string): void {
        const queue = this.pending.get(uuid);
        if (queue) {
            this.pendingCount -= queue.length;
        }
        this.pending.delete(uuid);
    }

    clear(): void {
        this.pending.clear();
        this.pendingCount = 0;
        if (this.drainTimer !== null) {
            clearTimeout(this.drainTimer);
            this.drainTimer = null;
        }
        this.drainScheduled = false;
    }

    get stats(): {pending: number; processing: number} {
        return {
            pending: this.pendingCount,
            processing: this.processing.size,
        };
    }

    private applyDeduplication(queue: QueuedEvent[], incoming: QueuedEvent): void {
        if (incoming.priority === "high") {
            // Remove is highest priority — drop all pending add/update for this UUID
            queue.length = 0;
            queue.push(incoming);
            return;
        }

        if (incoming.priority === "normal") {
            // Update — replace existing pending update (last-write-wins), keep removes
            const removeIndex = queue.findIndex(e => e.priority === "high");
            if (removeIndex !== -1) {
                // There's a pending remove — incoming update after remove means replace (keep both, remove first by priority)
                queue.push(incoming);
                return;
            }
            const updateIndex = queue.findIndex(e => e.priority === "normal");
            if (updateIndex !== -1) {
                queue[updateIndex] = incoming;
            } else {
                queue.push(incoming);
            }
            return;
        }

        // Add (low priority)
        const removeIndex = queue.findIndex(e => e.priority === "high");
        if (removeIndex !== -1) {
            // remove + add = replace → drop the remove, enqueue as update
            queue.splice(removeIndex, 1);
            incoming = {...incoming, priority: "normal"};
        }
        queue.push(incoming);
    }

    private scheduleDrain(): void {
        if (this.drainDelayMs > 0) {
            this.drainScheduled = true;
            if (this.drainTimer !== null) {
                clearTimeout(this.drainTimer);
            }
            this.drainTimer = setTimeout(() => {
                this.drainTimer = null;
                this.drain();
            }, this.drainDelayMs);
            return;
        }

        if (this.drainScheduled) return;
        this.drainScheduled = true;
        void Promise.resolve().then(() => this.drain());
    }

    private drain(): void {
        this.drainScheduled = false;

        const uuidsToProcess: string[] = [];
        for (const [uuid, queue] of this.pending.entries()) {
            if (queue.length > 0 && !this.processing.has(uuid)) {
                uuidsToProcess.push(uuid);
            }
        }

        for (const uuid of uuidsToProcess) {
            this.processNext(uuid);
        }
    }

    private processNext(uuid: string): void {
        const queue = this.pending.get(uuid);
        if (!queue || queue.length === 0) {
            this.pending.delete(uuid);
            return;
        }

        const event = this.takeNextEvent(queue);
        this.pendingCount -= 1;
        if (queue.length === 0) {
            this.pending.delete(uuid);
        }

        const promise = Promise.resolve(event.handler())
            .catch((err: unknown) => {
                console.error(`[CollaborationEventQueue] Error processing event ${event.type} for ${uuid}:`, err);
            })
            .then(() => {
                this.processing.delete(uuid);
                if (this.hasPending(uuid)) {
                    this.processNext(uuid);
                }
            });

        this.processing.set(uuid, promise);
    }

    private takeNextEvent(queue: QueuedEvent[]): QueuedEvent {
        let nextIndex = 0;
        let nextEvent = queue[0]!;
        let nextPriority = PRIORITY_ORDER[nextEvent.priority];

        for (let i = 1; i < queue.length; i++) {
            const candidate = queue[i]!;
            const candidatePriority = PRIORITY_ORDER[candidate.priority];
            if (
                candidatePriority < nextPriority ||
                (candidatePriority === nextPriority && candidate.timestamp < nextEvent.timestamp)
            ) {
                nextIndex = i;
                nextEvent = candidate;
                nextPriority = candidatePriority;
            }
        }

        for (let i = nextIndex + 1; i < queue.length; i++) {
            queue[i - 1] = queue[i]!;
        }
        queue.length -= 1;

        return nextEvent;
    }

    private evictOldest(): void {
        let oldestTimestamp = Infinity;
        let oldestUuid: string | null = null;
        let oldestIndex = -1;

        for (const [uuid, queue] of this.pending.entries()) {
            for (let i = 0; i < queue.length; i++) {
                const event = queue[i];
                if (event && event.timestamp < oldestTimestamp) {
                    oldestTimestamp = event.timestamp;
                    oldestUuid = uuid;
                    oldestIndex = i;
                }
            }
        }

        if (oldestUuid !== null && oldestIndex !== -1) {
            const queue = this.pending.get(oldestUuid)!;
            const evicted = queue.splice(oldestIndex, 1)[0]!;
            this.pendingCount -= 1;
            console.warn(
                `[CollaborationEventQueue] Queue limit reached (${this.maxSize}), evicting oldest event: ${evicted.type} for ${oldestUuid}`,
            );
            if (queue.length === 0) {
                this.pending.delete(oldestUuid);
            }
        }
    }
}
