import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {IdleWorkQueue} from "../IdleWorkQueue";

function makeDeadline(timeRemaining: () => number): IdleDeadline {
    return {
        didTimeout: false,
        timeRemaining,
    } as IdleDeadline;
}

describe("IdleWorkQueue", () => {
    const originalRequestIdleCallback = globalThis.requestIdleCallback;
    const originalCancelIdleCallback = globalThis.cancelIdleCallback;
    let idleCallbacks: Array<(deadline: IdleDeadline) => void>;

    beforeEach(() => {
        idleCallbacks = [];
        (globalThis as any).requestIdleCallback = vi.fn((callback: (deadline: IdleDeadline) => void) => {
            idleCallbacks.push(callback);
            return idleCallbacks.length;
        });
        (globalThis as any).cancelIdleCallback = vi.fn();
    });

    afterEach(() => {
        globalThis.requestIdleCallback = originalRequestIdleCallback;
        globalThis.cancelIdleCallback = originalCancelIdleCallback;
    });

    it("runs higher priority work first without shifting the queue", () => {
        const queue = new IdleWorkQueue();
        const order: string[] = [];

        queue.schedule(() => order.push("low-a"), 1);
        queue.schedule(() => order.push("high"), 10);
        queue.schedule(() => order.push("low-b"), 1);

        const internalQueue = (queue as any).queue as Array<unknown>;
        const shiftSpy = vi.spyOn(internalQueue, "shift");

        idleCallbacks[0]!(makeDeadline(() => 5));

        expect(order).toEqual(["high", "low-a", "low-b"]);
        expect(shiftSpy).not.toHaveBeenCalled();
        expect(internalQueue).toHaveLength(0);
    });

    it("keeps remaining work queued when idle budget runs out", () => {
        const queue = new IdleWorkQueue();
        const order: string[] = [];

        queue.schedule(() => order.push("first"));
        queue.schedule(() => order.push("second"));
        queue.schedule(() => order.push("third"));

        const internalQueue = (queue as any).queue as Array<unknown>;
        const shiftSpy = vi.spyOn(internalQueue, "shift");
        const remaining = [5, 0];

        idleCallbacks[0]!(makeDeadline(() => remaining.shift() ?? 0));

        expect(order).toEqual(["first"]);
        expect(shiftSpy).not.toHaveBeenCalled();
        expect(internalQueue).toHaveLength(2);
        expect(globalThis.requestIdleCallback).toHaveBeenCalledTimes(2);

        idleCallbacks[1]!(makeDeadline(() => 5));

        expect(order).toEqual(["first", "second", "third"]);
        expect(shiftSpy).not.toHaveBeenCalled();
        expect(internalQueue).toHaveLength(0);
    });

    it("drains work scheduled by a running task without scheduling a duplicate idle callback", () => {
        const queue = new IdleWorkQueue();
        const order: string[] = [];

        queue.schedule(() => {
            order.push("first");
            queue.schedule(() => order.push("inner-high"), 10);
        });
        queue.schedule(() => order.push("second"));

        idleCallbacks[0]!(makeDeadline(() => 5));

        expect(order).toEqual(["first", "inner-high", "second"]);
        expect(globalThis.requestIdleCallback).toHaveBeenCalledTimes(1);
    });
});
