import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {ComponentDataPool} from "../ComponentDataPool";

function makeDeadline(): IdleDeadline {
    return {
        didTimeout: false,
        timeRemaining: () => 5,
    } as IdleDeadline;
}

describe("ComponentDataPool", () => {
    const originalRequestIdleCallback = globalThis.requestIdleCallback;
    const originalCancelIdleCallback = globalThis.cancelIdleCallback;
    let idleCallbacks: Array<(deadline: IdleDeadline) => void>;

    beforeEach(() => {
        ComponentDataPool.dispose();
        idleCallbacks = [];
        (globalThis as any).requestIdleCallback = vi.fn((callback: (deadline: IdleDeadline) => void) => {
            idleCallbacks.push(callback);
            return idleCallbacks.length;
        });
        (globalThis as any).cancelIdleCallback = vi.fn();
    });

    afterEach(() => {
        ComponentDataPool.dispose();
        globalThis.requestIdleCallback = originalRequestIdleCallback;
        globalThis.cancelIdleCallback = originalCancelIdleCallback;
    });

    it("does not allocate the idle queue for synchronous acquire and release", () => {
        const data = ComponentDataPool.acquire("lambda", {speed: 1});
        ComponentDataPool.release("lambda", data);

        expect((ComponentDataPool as unknown as {idleQueue: unknown}).idleQueue).toBeNull();
    });

    it("removes stale fields when reusing pooled records", () => {
        const data = ComponentDataPool.acquire("lambda", {speed: 1});
        data.stale = "old object";
        ComponentDataPool.release("lambda", data);

        const next = ComponentDataPool.acquire("lambda", {speed: 2});

        expect(next).toEqual({speed: 2});
    });

    it("allocates the idle queue only when warm-up is scheduled", () => {
        ComponentDataPool.scheduleWarmUp("lambda", {speed: 1}, 2);

        expect((ComponentDataPool as unknown as {idleQueue: unknown}).idleQueue).not.toBeNull();
        expect(globalThis.requestIdleCallback).toHaveBeenCalledTimes(1);

        idleCallbacks[0]!(makeDeadline());

        const pool = (ComponentDataPool as unknown as {
            pools: Map<string, Array<Record<string, unknown>>>;
        }).pools.get("lambda");
        expect(pool).toHaveLength(2);
    });
});
