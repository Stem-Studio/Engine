import { describe, it, expect } from 'vitest';

import { createObjectPool } from '../ObjectPool';

describe('ObjectPool', () => {
    /**
     *
     * @param opts
     * @param opts.initialSize
     * @param opts.maxSize
     */
    function makePool(opts?: { initialSize?: number; maxSize?: number }) {
        return createObjectPool<{ value: number }>({
            create: () => ({ value: 0 }),
            reset: (item) => { item.value = 0; },
            initialSize: opts?.initialSize ?? 0,
            maxSize: opts?.maxSize ?? 1024,
        });
    }

    it('should create and retrieve objects', () => {
        const pool = makePool();
        const obj = pool.get();
        expect(obj).toBeDefined();
        expect(obj.value).toBe(0);
    });

    it('should reuse released objects', () => {
        const pool = makePool();
        const obj1 = pool.get();
        obj1.value = 42;
        pool.release(obj1);

        const obj2 = pool.get();
        // After release, reset should have been called
        expect(obj2.value).toBe(0);
        // Should be the same reference
        expect(obj2).toBe(obj1);
    });

    it('should track stats correctly', () => {
        const pool = makePool();
        expect(pool.getStats()).toEqual({ total: 0, available: 0, inUse: 0 });

        const a = pool.get();
        pool.get();
        expect(pool.getStats().inUse).toBe(2);
        expect(pool.getStats().total).toBe(2);

        pool.release(a);
        expect(pool.getStats().inUse).toBe(1);
        expect(pool.getStats().available).toBe(1);
    });

    it('should preallocate objects', () => {
        const pool = makePool();
        pool.preallocate(5);
        const stats = pool.getStats();
        expect(stats.total).toBe(5);
        expect(stats.available).toBe(5);
        expect(stats.inUse).toBe(0);
    });

    it('should respect initialSize', () => {
        const pool = makePool({ initialSize: 3 });
        const stats = pool.getStats();
        expect(stats.total).toBe(3);
        expect(stats.available).toBe(3);
    });

    it('should not preallocate beyond maxSize', () => {
        const pool = makePool({ maxSize: 3 });
        pool.preallocate(10);
        expect(pool.getStats().total).toBe(3);
    });

    it('should not retain overflow allocations beyond maxSize', () => {
        const pool = makePool({ maxSize: 2 });
        const a = pool.get();
        const b = pool.get();
        const overflow = pool.get();

        expect(pool.getStats()).toEqual({ total: 2, available: 0, inUse: 2 });

        pool.release(overflow);
        expect(pool.getStats()).toEqual({ total: 2, available: 0, inUse: 2 });

        pool.release(a);
        pool.release(b);
        expect(pool.getStats()).toEqual({ total: 2, available: 2, inUse: 0 });
    });

    it('should ignore duplicate releases', () => {
        const pool = makePool({ maxSize: 2 });
        const item = pool.get();

        pool.release(item);
        pool.release(item);

        expect(pool.getStats()).toEqual({ total: 1, available: 1, inUse: 0 });
    });

    it('should clear the pool', () => {
        const pool = makePool({ initialSize: 5 });
        pool.get();
        pool.clear();
        expect(pool.getStats()).toEqual({ total: 0, available: 0, inUse: 0 });
    });
});
