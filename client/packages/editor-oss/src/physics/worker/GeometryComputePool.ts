import * as Comlink from "comlink";
import GeometryWorkerConstructor from "./GeometryWorker.ts?worker";
import type { GeometryWorkerAPI } from "./GeometryWorker";
import type { SerializableGeometry } from "../hull/HullCompute";
import {getGeometryWorkerPoolSize, setGeometryWorkerPoolSize} from "./GeometryComputePoolConfig";

export {setGeometryWorkerPoolSize};

interface PoolEntry {
    worker: Worker;
    proxy: Comlink.Remote<GeometryWorkerAPI>;
}

/**
 * Pool of geometry workers for parallel computation of hull vertices.
 * Uses Comlink proxies — each call returns a promise directly.
 */
export class GeometryComputePool {
    private entries: PoolEntry[] = [];
    private availableEntries: PoolEntry[] = [];
    private taskQueue: Array<() => void> = [];
    private taskQueueHead = 0;
    private maxWorkers: number;

    constructor(maxWorkers: number = navigator.hardwareConcurrency || 4) {
        this.maxWorkers = Math.min(maxWorkers, 8); // Cap at 8 workers
    }

    /**
     * Initialize the worker pool
     */
    async initialize(): Promise<void> {
        for (let i = 0; i < this.maxWorkers; i++) {
            const worker = new GeometryWorkerConstructor();
            const proxy = Comlink.wrap<GeometryWorkerAPI>(worker);
            const entry: PoolEntry = { worker, proxy };
            this.entries.push(entry);
            this.availableEntries.push(entry);
        }
        console.log(`GeometryComputePool: initialized with ${this.maxWorkers} workers`);
    }

    /**
     * Terminate all workers and clear pending tasks
     */
    terminate(): void {
        for (const entry of this.entries) {
            entry.proxy[Comlink.releaseProxy]();
            entry.worker.terminate();
        }
        this.entries = [];
        this.availableEntries = [];
        this.taskQueue = [];
        this.taskQueueHead = 0;
    }

    /**
     * Submit a task to compute convex hull vertices
     */
    computeConvexHull(
        geometries: SerializableGeometry[],
        simplifyFactor: number = 0.7,
        userShapeScale: { x: number; y: number; z: number } = { x: 1, y: 1, z: 1 },
    ): Promise<number[]> {
        return this.runOnWorker(async (proxy) => {
            const result = await proxy.computeConvexHull(geometries, simplifyFactor, userShapeScale);
            return result.vertices;
        });
    }

    /**
     * Submit a task to compute concave hull vertices
     */
    computeConcaveHull(
        geometries: SerializableGeometry[],
        userShapeScale: { x: number; y: number; z: number } = { x: 1, y: 1, z: 1 },
    ): Promise<{ vertices: number[][]; indices: number[][] }> {
        return this.runOnWorker(async (proxy) => {
            const result = await proxy.computeConcaveHull(geometries, userShapeScale);
            return {
                vertices: result.verticesArray,
                indices: result.indicesArray,
            };
        });
    }

    private runOnWorker<T>(fn: (proxy: Comlink.Remote<GeometryWorkerAPI>) => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const execute = () => {
                const entry = this.availableEntries.pop()!;
                fn(entry.proxy)
                    .then(resolve, reject)
                    .finally(() => {
                        this.availableEntries.push(entry);
                        this.processQueue();
                    });
            };

            if (this.availableEntries.length > 0) {
                execute();
            } else {
                this.taskQueue.push(execute);
            }
        });
    }

    private processQueue(): void {
        while (this.taskQueueHead < this.taskQueue.length && this.availableEntries.length > 0) {
            const task = this.taskQueue[this.taskQueueHead++]!;
            task();
        }

        if (this.taskQueueHead === this.taskQueue.length) {
            this.taskQueue.length = 0;
            this.taskQueueHead = 0;
        } else if (this.taskQueueHead > 1024 && this.taskQueueHead * 2 >= this.taskQueue.length) {
            this.taskQueue.splice(0, this.taskQueueHead);
            this.taskQueueHead = 0;
        }
    }

    /**
     * Get current pool statistics
     */
    getStats(): {
        totalWorkers: number;
        busyWorkers: number;
        availableWorkers: number;
        queuedTasks: number;
        pendingTasks: number;
    } {
        const busyCount = this.entries.length - this.availableEntries.length;
        return {
            totalWorkers: this.entries.length,
            busyWorkers: busyCount,
            availableWorkers: this.availableEntries.length,
            queuedTasks: this.taskQueue.length - this.taskQueueHead,
            pendingTasks: busyCount,
        };
    }
}

// Singleton instance
let poolInstance: GeometryComputePool | null = null;

/**
 * Get the singleton geometry compute pool instance
 */
export function getGeometryComputePool(): GeometryComputePool {
    if (!poolInstance) {
        const workerCount = getGeometryWorkerPoolSize() ?? (navigator.hardwareConcurrency || 4);
        poolInstance = new GeometryComputePool(workerCount);
        poolInstance.initialize();
    }
    return poolInstance;
}

/**
 * Terminate the singleton geometry compute pool
 */
export function terminateGeometryComputePool(): void {
    if (poolInstance) {
        poolInstance.terminate();
        poolInstance = null;
    }
}
