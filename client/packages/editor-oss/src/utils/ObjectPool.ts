export interface ObjectPoolConfig<T> {
    create: () => T;
    reset: (item: T) => void;
    initialSize?: number;
    maxSize?: number;
}

export interface ObjectPool<T> {
    get(): T;
    release(item: T): void;
    preallocate(count: number): void;
    clear(): void;
    getStats(): { total: number; available: number; inUse: number };
}

/**
 *
 * @param config
 */
export function createObjectPool<T>(config: ObjectPoolConfig<T>): ObjectPool<T> {
    const { create, reset, initialSize = 0, maxSize = 1024 } = config;
    const pool: T[] = [];
    const trackedInUse = new Set<T>();
    let totalCreated = 0;

    /**
     *
     */
    function allocateOne(): T {
        totalCreated++;
        return create();
    }

    // Pre-fill pool
    for (let i = 0; i < initialSize; i++) {
        pool.push(allocateOne());
    }

    return {
        get(): T {
            if (pool.length > 0) {
                const item = pool.pop()!;
                trackedInUse.add(item);
                return item;
            }
            if (totalCreated < maxSize) {
                const item = allocateOne();
                trackedInUse.add(item);
                return item;
            }
            // Over maxSize — still create but don't track for pool return
            return create();
        },

        release(item: T): void {
            reset(item);
            if (trackedInUse.delete(item) && pool.length < maxSize) {
                pool.push(item);
            }
        },

        preallocate(count: number): void {
            for (let i = 0; i < count; i++) {
                if (totalCreated >= maxSize) break;
                pool.push(allocateOne());
            }
        },

        clear(): void {
            pool.length = 0;
            trackedInUse.clear();
            totalCreated = 0;
        },

        getStats() {
            return {
                total: totalCreated,
                available: pool.length,
                inUse: trackedInUse.size,
            };
        },
    };
}
