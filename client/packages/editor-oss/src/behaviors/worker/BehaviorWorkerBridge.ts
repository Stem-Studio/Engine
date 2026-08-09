import * as Comlink from "comlink";

import type {Behavior} from "../Behavior";
import type {BehaviorWorkerAPI} from "./types";

const MAX_BEHAVIOR_WORKERS = 16;
let activeWorkerCount = 0;

/**
 * Per-bridge construction options.
 *
 * - `raw: true` skips the Comlink wrap and routes raw `postMessage` /
 *   `onmessage` between the worker and the behavior. The worker source must
 *   NOT call `Comlink.expose()` in raw mode — it just listens via
 *   `self.onmessage` and posts via `self.postMessage({ type, data })`. Use
 *   raw mode when the worker is a self-contained file (e.g. shipped as a
 *   `script` asset and loaded via `erth.asset.script.getUrl()`).
 * - `raw: false` (default) preserves the original Comlink-wrapped behavior:
 *   the worker calls `Comlink.expose(api)` matching `BehaviorWorkerAPI`.
 */
export interface BehaviorWorkerBridgeOptions {
    raw?: boolean;
}

export class BehaviorWorkerBridge {
    private worker: Worker | null = null;
    private behavior: Behavior;
    private label: string;
    private raw: boolean;
    private comlinkProxy: Comlink.Remote<BehaviorWorkerAPI> | null = null;

    /**
     * Override hook used by `BehaviorWorkerPool` to intercept incoming raw
     * messages so the pool can mark this worker free before forwarding the
     * payload to the user's `onWorkerMessage`. When unset, the bridge calls
     * `behavior.onWorkerMessage` directly. Has no effect in Comlink mode.
     */
    public onRawMessage?: (type: string, data: any) => void;

    /** True when the worker was successfully created and is running */
    get isActive(): boolean {
        return this.worker !== null;
    }

    constructor(behavior: Behavior, label?: string, options?: BehaviorWorkerBridgeOptions) {
        this.behavior = behavior;
        this.label = label ?? behavior.id;
        this.raw = !!options?.raw;
    }

    /**
     * Create a worker from a `() => Worker` constructor and (in non-raw mode)
     * wrap it with Comlink. The worker must call `Comlink.expose(api)` where
     * api implements BehaviorWorkerAPI in non-raw mode; in raw mode it just
     * uses `self.postMessage` / `self.onmessage`.
     */
    init(WorkerConstructor: new () => Worker): boolean {
        if (activeWorkerCount >= MAX_BEHAVIOR_WORKERS) {
            console.warn(`[BehaviorWorker] Max worker limit (${MAX_BEHAVIOR_WORKERS}) reached, skipping worker for ${this.label}`);
            return false;
        }

        try {
            this.worker = new WorkerConstructor();
            if (this.raw) {
                this.worker.onmessage = (e: MessageEvent) => {
                    const msg = e.data;
                    if (!msg || typeof msg.type !== "string") return;
                    try {
                        if (this.onRawMessage) {
                            this.onRawMessage(msg.type, msg.data);
                        } else {
                            this.behavior.onWorkerMessage?.(msg.type, msg.data);
                        }
                    } catch (err) {
                        console.error(`[BehaviorWorker] Error in onWorkerMessage for ${this.label}:`, err);
                    }
                };
            } else {
                this.comlinkProxy = Comlink.wrap<BehaviorWorkerAPI>(this.worker);
            }
            activeWorkerCount++;
            return true;
        } catch (e) {
            console.error(`[BehaviorWorker] Failed to create worker for ${this.label}:`, e);
            this.cleanup();
            return false;
        }
    }

    sendInit(initData: any): void {
        if (this.raw) {
            // Raw workers receive init data as a regular `_init` message and
            // can ignore it if they don't care.
            this.worker?.postMessage({type: "_init", data: initData});
            return;
        }
        if (!this.comlinkProxy) return;
        this.comlinkProxy.setOnPostToMain(
            Comlink.proxy((type: string, data: any) => {
                try {
                    this.behavior.onWorkerMessage?.(type, data);
                } catch (err) {
                    console.error(`[BehaviorWorker] Error in onWorkerMessage for ${this.label}:`, err);
                }
            }),
        );
        this.comlinkProxy.init(initData).catch(err => {
            console.error(`[BehaviorWorker] Error initializing worker for ${this.label}:`, err);
        });
    }

    sendStart(): void {
        if (this.raw) {
            this.worker?.postMessage({type: "_start", data: null});
            return;
        }
        if (!this.comlinkProxy) return;
        this.comlinkProxy.start().catch(err => {
            console.error(`[BehaviorWorker] Error in worker for ${this.label}:`, err);
        });
    }

    sendStop(): void {
        if (this.raw) {
            this.worker?.postMessage({type: "_stop", data: null});
            return;
        }
        this.comlinkProxy?.stop();
    }

    sendMessage(type: string, data: any): void {
        if (this.raw) {
            this.worker?.postMessage({type, data});
            return;
        }
        this.comlinkProxy?.sendMessage(type, data);
    }

    dispose(): void {
        if (this.raw) {
            if (this.worker) {
                this.worker.onmessage = null;
                this.worker.terminate();
            }
        } else {
            if (this.comlinkProxy) {
                this.comlinkProxy.dispose().catch(() => { /* worker may already be terminated */ });
                this.comlinkProxy[Comlink.releaseProxy]();
                this.comlinkProxy = null;
            }
            if (this.worker) {
                this.worker.terminate();
            }
        }
        this.cleanup();
    }

    private cleanup(): void {
        if (this.worker) {
            activeWorkerCount = Math.max(0, activeWorkerCount - 1);
            this.worker = null;
        }
        this.comlinkProxy = null;
        this.onRawMessage = undefined;
    }
}

/** Visible for testing — returns the current active worker count */
export function getActiveWorkerCount(): number {
    return activeWorkerCount;
}

/** Visible for testing — resets the active worker count */
export function resetActiveWorkerCount(): void {
    activeWorkerCount = 0;
}
