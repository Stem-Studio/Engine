/**
 * Object pool for lambda component data records.
 * Eliminates GC pressure from per-object allocation in registerObject().
 *
 * Usage:
 *   const data = ComponentDataPool.acquire(lambdaId, defaults);
 *   // ... use data ...
 *   ComponentDataPool.release(lambdaId, data);
 */
import { IdleWorkQueue } from "./IdleWorkQueue";

export class ComponentDataPool {
    private static pools: Map<string, Array<Record<string, unknown>>> = new Map();
    private static poolSizes: Map<string, number> = new Map();
    private static idleQueue: IdleWorkQueue | null = null;

    /**
     * Pre-allocate pooled objects to avoid cold-start allocation.
     * @param lambdaId
     * @param defaults
     * @param count
     */
    static warmUp(lambdaId: string, defaults: Record<string, unknown>, count: number = 50): void {
        const pool = this.getPool(lambdaId);
        for (let i = 0; i < count; i++) {
            pool.push({ ...defaults });
        }
        this.poolSizes.set(lambdaId, count);
    }

    /**
     * Get a component data object, reset to defaults.
     * @param lambdaId
     * @param defaults
     */
    static acquire(lambdaId: string, defaults: Record<string, unknown>): Record<string, unknown> {
        const pool = this.getPool(lambdaId);
        if (pool.length > 0) {
            const obj = pool.pop()!;
            for (const key in obj) {
                if (!(key in defaults)) {
                    delete obj[key];
                }
            }
            for (const key in defaults) {
                obj[key] = defaults[key];
            }
            return obj;
        }
        return { ...defaults };
    }

    /**
     * Return a component data object to the pool for reuse.
     * @param lambdaId
     * @param data
     */
    static release(lambdaId: string, data: Record<string, unknown>): void {
        const pool = this.getPool(lambdaId);
        const maxSize = this.poolSizes.get(lambdaId) ?? 100;
        if (pool.length < maxSize) {
            pool.push(data);
        }
    }

    /**
     * Schedule pool warm-up during browser idle time to avoid blocking scene load.
     * @param lambdaId
     * @param defaults
     * @param count
     */
    static scheduleWarmUp(lambdaId: string, defaults: Record<string, unknown>, count: number = 50): void {
        this.getIdleQueue().schedule(() => this.warmUp(lambdaId, defaults, count));
    }

    private static getIdleQueue(): IdleWorkQueue {
        if (!this.idleQueue) {
            this.idleQueue = new IdleWorkQueue();
        }
        return this.idleQueue;
    }

    private static getPool(lambdaId: string): Array<Record<string, unknown>> {
        let pool = this.pools.get(lambdaId);
        if (!pool) {
            pool = [];
            this.pools.set(lambdaId, pool);
        }
        return pool;
    }

    static dispose(): void {
        this.idleQueue?.dispose();
        this.idleQueue = null;
        this.pools.clear();
        this.poolSizes.clear();
    }
}
