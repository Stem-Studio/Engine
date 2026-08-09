import type {Behavior} from "../Behavior";
import {BehaviorWorkerBridge} from "./BehaviorWorkerBridge";

/**
 * Pool of `BehaviorWorkerBridge`s sharing one constructor, fed by a single
 * job queue. Designed for behaviors whose workload parallelizes naturally
 * (chunked terrain generation, scatter pre-pass, pathfinding sectors, etc.)
 * and whose worker source is a self-contained file using raw `postMessage`
 * (typically a `script` asset loaded via `erth.asset.script.getUrl()`).
 *
 * Each bridge in the pool wires its raw-message handler back to this pool
 * so the pool can mark the bridge free before forwarding the payload to the
 * behavior's `onWorkerMessage`. The behavior calls `pool.sendMessage(type,
 * data)` to enqueue work; the pool dispatches to a free bridge or queues
 * until one frees up.
 *
 * Comlink mode is intentionally not supported here — Comlink's request/reply
 * pattern is naturally 1:1 and benefits little from a pool. Use a single
 * `BehaviorWorkerBridge` for Comlink workloads.
 */
export class BehaviorWorkerPool {
    private bridges: BehaviorWorkerBridge[] = [];
    private behavior: Behavior;
    private label: string;
    private count: number;
    private busy: Set<number> = new Set();
    private queue: Array<{type: string; data: unknown}> = [];
    private queueHead = 0;

    constructor(behavior: Behavior, label: string, options: {count: number}) {
        this.behavior = behavior;
        this.label = label;
        this.count = Math.max(1, options.count);
    }

    /** True once at least one bridge has been initialized. */
    get isActive(): boolean {
        return this.bridges.length > 0;
    }

    /** Number of workers in the pool. */
    get size(): number {
        return this.bridges.length;
    }

    /**
     * Construct `count` workers from the supplied constructor. Returns true
     * if every worker was created successfully; on partial failure, all
     * already-created bridges are torn down before returning false.
     */
    init(WorkerConstructor: new () => Worker): boolean {
        for (let i = 0; i < this.count; i++) {
            const bridge = new BehaviorWorkerBridge(this.behavior, `${this.label}:${i}`, {raw: true});
            const success = bridge.init(WorkerConstructor);
            if (!success) {
                for (const b of this.bridges) b.dispose();
                this.bridges = [];
                return false;
            }
            const bridgeIndex = this.bridges.length;
            bridge.onRawMessage = (type: string, data: unknown) => {
                // Free this bridge BEFORE forwarding to user code, so a follow-up
                // `sendMessage` from inside `onWorkerMessage` can dispatch to it.
                this.busy.delete(bridgeIndex);
                this.drainQueue();
                try {
                    this.behavior.onWorkerMessage?.(type, data);
                } catch (err) {
                    console.error(`[BehaviorWorkerPool] Error in onWorkerMessage for ${this.label}:`, err);
                }
            };
            this.bridges.push(bridge);
        }
        return true;
    }

    sendInit(initData: unknown): void {
        for (const b of this.bridges) b.sendInit(initData);
    }

    sendStart(): void {
        for (const b of this.bridges) b.sendStart();
    }

    sendStop(): void {
        for (const b of this.bridges) b.sendStop();
    }

    /**
     * Enqueue a job for the pool. Dispatched immediately to a free bridge,
     * or queued if all bridges are busy. Drains in FIFO order.
     */
    sendMessage(type: string, data: unknown): void {
        const idx = this.findFree();
        if (idx === -1) {
            this.queue.push({type, data});
            return;
        }
        const bridge = this.bridges[idx];
        if (!bridge) return;
        this.busy.add(idx);
        bridge.sendMessage(type, data);
    }

    dispose(): void {
        for (const b of this.bridges) b.dispose();
        this.bridges = [];
        this.busy.clear();
        this.queue = [];
        this.queueHead = 0;
    }

    private findFree(): number {
        for (let i = 0; i < this.bridges.length; i++) {
            if (!this.busy.has(i)) return i;
        }
        return -1;
    }

    private drainQueue(): void {
        while (this.queueHead < this.queue.length) {
            const idx = this.findFree();
            if (idx === -1) {
                this.compactQueueIfNeeded();
                return;
            }
            const job = this.queue[this.queueHead++]!;
            const bridge = this.bridges[idx];
            if (!bridge) {
                this.compactQueueIfNeeded();
                return;
            }
            this.busy.add(idx);
            bridge.sendMessage(job.type, job.data);
        }

        this.compactQueueIfNeeded();
    }

    private compactQueueIfNeeded(): void {
        if (this.queueHead >= this.queue.length) {
            this.queue.length = 0;
            this.queueHead = 0;
        } else if (this.queueHead >= 1024 && this.queueHead * 2 >= this.queue.length) {
            this.queue.splice(0, this.queueHead);
            this.queueHead = 0;
        }
    }
}
