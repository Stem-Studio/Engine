/**
 * Schedules non-critical work during browser idle time via requestIdleCallback.
 * Use for: metrics collection, cache cleanup, prefetching, pool tuning.
 *
 * Falls back to setTimeout on Safari (no requestIdleCallback support).
 */

interface IdleTask {
    callback: () => void;
    priority: number;
}

export class IdleWorkQueue {
    private queue: IdleTask[] = [];
    private queueHead = 0;
    private callbackId: number | null = null;
    private isProcessing = false;

    schedule(callback: () => void, priority: number = 0): void {
        this.insertTask({ callback, priority });
        if (this.callbackId === null && !this.isProcessing) {
            this.scheduleProcessing();
        }
    }

    private insertTask(task: IdleTask): void {
        for (let i = this.queueHead; i < this.queue.length; i++) {
            if (this.queue[i]!.priority < task.priority) {
                this.queue.splice(i, 0, task);
                return;
            }
        }
        this.queue.push(task);
    }

    private scheduleProcessing(): void {
        if (typeof requestIdleCallback === "function") {
            this.callbackId = requestIdleCallback(
                (deadline) => this.process(deadline),
                { timeout: 1000 },
            );
        } else {
            // Safari fallback — simulate ~5ms of idle time
            this.callbackId = setTimeout(() => {
                this.process({ timeRemaining: () => 5, didTimeout: false });
            }, 16) as unknown as number;
        }
    }

    private process(deadline: IdleDeadline): void {
        this.callbackId = null;
        this.isProcessing = true;

        try {
            while (this.queueHead < this.queue.length && deadline.timeRemaining() > 1) {
                const task = this.queue[this.queueHead++]!;
                try {
                    task.callback();
                } catch (e) {
                    console.error("[IdleWorkQueue] Task error:", e);
                }
            }

            this.compactQueue();
        } finally {
            this.isProcessing = false;
        }

        if (this.queueHead < this.queue.length) {
            this.scheduleProcessing();
        }
    }

    private compactQueue(): void {
        if (this.queueHead === 0) {
            return;
        }

        if (this.queueHead >= this.queue.length) {
            this.queue.length = 0;
        } else {
            this.queue.splice(0, this.queueHead);
        }
        this.queueHead = 0;
    }

    dispose(): void {
        if (this.callbackId !== null) {
            if (typeof cancelIdleCallback === "function") {
                cancelIdleCallback(this.callbackId);
            } else {
                clearTimeout(this.callbackId);
            }
            this.callbackId = null;
        }
        this.queue = [];
        this.queueHead = 0;
        this.isProcessing = false;
    }
}
