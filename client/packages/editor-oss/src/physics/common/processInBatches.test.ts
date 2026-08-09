import { describe, expect, it, vi } from "vitest";

import { processInBatches } from "./processInBatches";

describe("processInBatches", () => {
    it("processes every item exactly once", async () => {
        const seen: number[] = [];

        await processInBatches({
            items: [1, 2, 3, 4, 5],
            batchSize: 2,
            concurrency: 2,
            processItem: async item => {
                seen.push(item);
            },
        });

        expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    });

    it("invokes batch completion callback with cumulative progress", async () => {
        const onBatchComplete = vi.fn();

        await processInBatches({
            items: [10, 20, 30, 40, 50],
            batchSize: 2,
            concurrency: 1,
            processItem: async () => {},
            onBatchComplete,
            yieldBetweenBatches: false,
        });

        expect(onBatchComplete).toHaveBeenCalledTimes(3);
        expect(onBatchComplete).toHaveBeenNthCalledWith(1, 2, 5);
        expect(onBatchComplete).toHaveBeenNthCalledWith(2, 4, 5);
        expect(onBatchComplete).toHaveBeenNthCalledWith(3, 5, 5);
    });

    it("passes stable indexes across batch boundaries", async () => {
        const seen: Array<[string, number]> = [];

        await processInBatches({
            items: ["a", "b", "c", "d", "e"],
            batchSize: 2,
            concurrency: 2,
            processItem: async (item, index) => {
                seen.push([item, index]);
            },
            yieldBetweenBatches: false,
        });

        expect(seen.sort((a, b) => a[1] - b[1])).toEqual([
            ["a", 0],
            ["b", 1],
            ["c", 2],
            ["d", 3],
            ["e", 4],
        ]);
    });

    it("respects concurrency limits within each batch", async () => {
        let inFlight = 0;
        let maxInFlight = 0;

        await processInBatches({
            items: [1, 2, 3, 4, 5, 6],
            batchSize: 6,
            concurrency: 3,
            processItem: async () => {
                inFlight++;
                maxInFlight = Math.max(maxInFlight, inFlight);
                await new Promise(resolve => setTimeout(resolve, 1));
                inFlight--;
            },
            yieldBetweenBatches: false,
        });

        expect(maxInFlight).toBeLessThanOrEqual(3);
    });

    it("uses scheduler.yield when yielding between batches is enabled", async () => {
        const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "scheduler");
        const schedulerYield = vi.fn(async () => {});

        Object.defineProperty(globalThis, "scheduler", {
            configurable: true,
            value: {yield: schedulerYield},
        });

        try {
            await processInBatches({
                items: [1, 2, 3],
                batchSize: 1,
                concurrency: 1,
                processItem: () => {},
            });
        } finally {
            if (originalDescriptor) {
                Object.defineProperty(globalThis, "scheduler", originalDescriptor);
            } else {
                Reflect.deleteProperty(globalThis, "scheduler");
            }
        }

        expect(schedulerYield).toHaveBeenCalledTimes(2);
    });
});
