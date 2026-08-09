import {beforeEach, describe, expect, it, vi} from "vitest";

import {GeometryComputePool} from "./GeometryComputePool";

const mocks = vi.hoisted(() => {
    class MockWorker {
        terminate = vi.fn();
    }

    return {
        releaseProxy: Symbol.for("Comlink.releaseProxy"),
        wrap: vi.fn(),
        MockWorker,
    };
});

vi.mock("comlink", () => ({
    wrap: mocks.wrap,
    releaseProxy: mocks.releaseProxy,
}));

vi.mock("./GeometryWorker.ts?worker", () => ({
    default: mocks.MockWorker,
}));

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return {promise, resolve, reject};
}

describe("GeometryComputePool", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("drains queued tasks without shifting and reports only unscheduled queued work", async () => {
        const first = deferred<{vertices: number[]}>();
        const second = deferred<{vertices: number[]}>();
        const third = deferred<{vertices: number[]}>();
        const proxy = {
            computeConvexHull: vi.fn()
                .mockReturnValueOnce(first.promise)
                .mockReturnValueOnce(second.promise)
                .mockReturnValueOnce(third.promise),
            [mocks.releaseProxy]: vi.fn(),
        };
        mocks.wrap.mockReturnValue(proxy);
        const pool = new GeometryComputePool(1);
        await pool.initialize();

        const firstResult = pool.computeConvexHull([]);
        const secondResult = pool.computeConvexHull([]);
        const thirdResult = pool.computeConvexHull([]);
        const queue = (pool as any).taskQueue as Array<() => void>;
        const shiftSpy = vi.spyOn(queue, "shift");

        expect(proxy.computeConvexHull).toHaveBeenCalledTimes(1);
        expect(pool.getStats()).toMatchObject({
            busyWorkers: 1,
            availableWorkers: 0,
            queuedTasks: 2,
        });

        first.resolve({vertices: [1]});
        await expect(firstResult).resolves.toEqual([1]);
        await vi.waitFor(() => expect(proxy.computeConvexHull).toHaveBeenCalledTimes(2));

        expect(shiftSpy).not.toHaveBeenCalled();
        expect(pool.getStats()).toMatchObject({
            busyWorkers: 1,
            availableWorkers: 0,
            queuedTasks: 1,
        });

        second.resolve({vertices: [2]});
        await expect(secondResult).resolves.toEqual([2]);
        await vi.waitFor(() => expect(proxy.computeConvexHull).toHaveBeenCalledTimes(3));

        expect(shiftSpy).not.toHaveBeenCalled();
        expect(pool.getStats()).toMatchObject({
            busyWorkers: 1,
            availableWorkers: 0,
            queuedTasks: 0,
        });

        third.resolve({vertices: [3]});
        await expect(thirdResult).resolves.toEqual([3]);
        await vi.waitFor(() => expect(pool.getStats().busyWorkers).toBe(0));

        expect(shiftSpy).not.toHaveBeenCalled();
        expect(pool.getStats()).toMatchObject({
            busyWorkers: 0,
            availableWorkers: 1,
            queuedTasks: 0,
        });

        pool.terminate();
        expect(proxy[mocks.releaseProxy]).toHaveBeenCalledTimes(1);
    });
});
