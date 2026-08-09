import {afterEach, describe, expect, it, vi} from "vitest";

import {createProgressiveYieldController} from "./progressiveYield";

describe("createProgressiveYieldController", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("yields when the batch limit is reached", async () => {
        const yieldToFrame = vi.fn(async () => {});
        const maybeYield = createProgressiveYieldController(
            {
                batchSize: 3,
                frameBudgetMs: 1_000_000,
                yieldToFrame,
            },
            {
                batchSize: 10,
                frameBudgetMs: 4,
            },
        );

        await maybeYield();
        await maybeYield();
        expect(yieldToFrame).not.toHaveBeenCalled();

        await maybeYield();
        expect(yieldToFrame).toHaveBeenCalledTimes(1);
    });

    it("yields when the frame budget elapses before the batch limit is reached", async () => {
        let now = 0;
        vi.spyOn(performance, "now").mockImplementation(() => now);
        const yieldToFrame = vi.fn(async () => {});
        const maybeYield = createProgressiveYieldController(
            {
                batchSize: 10,
                frameBudgetMs: 4,
                yieldToFrame,
            },
            {
                batchSize: 32,
                frameBudgetMs: 8,
            },
        );

        await maybeYield();
        expect(yieldToFrame).not.toHaveBeenCalled();

        now = 5;
        await maybeYield();
        expect(yieldToFrame).toHaveBeenCalledTimes(1);

        await maybeYield();
        expect(yieldToFrame).toHaveBeenCalledTimes(1);
    });

    it("supports forced yields and falls back for invalid numeric options", async () => {
        const yieldToFrame = vi.fn(async () => {});
        const maybeYield = createProgressiveYieldController(
            {
                batchSize: 0,
                frameBudgetMs: Number.NaN,
                yieldToFrame,
            },
            {
                batchSize: 2,
                frameBudgetMs: 1_000_000,
            },
        );

        await maybeYield();
        expect(yieldToFrame).not.toHaveBeenCalled();

        await maybeYield();
        expect(yieldToFrame).toHaveBeenCalledTimes(1);

        await maybeYield(true);
        expect(yieldToFrame).toHaveBeenCalledTimes(2);
    });
});
