import {afterEach, describe, expect, it, vi} from "vitest";

import {createProgressiveYieldController} from "../../utils/progressiveYield";
import {
    PLAY_START_PAINT_YIELD_MAX_DELAY_MS,
    yieldPlayStartToPaint,
} from "./playStartYield";

describe("yieldPlayStartToPaint", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("waits for a normal animation frame and a following task", async () => {
        vi.useFakeTimers();
        let frameCallback: FrameRequestCallback | undefined;
        const cancelAnimationFrame = vi.fn();
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            frameCallback = callback;
            return 41;
        }));
        vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
        const resolved = vi.fn();

        const pending = yieldPlayStartToPaint().then(resolved);
        expect(resolved).not.toHaveBeenCalled();

        frameCallback?.(16);
        await Promise.resolve();
        expect(resolved).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(0);
        await pending;

        expect(resolved).toHaveBeenCalledTimes(1);
        expect(cancelAnimationFrame).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("uses the bounded fallback when animation frames are stalled", async () => {
        vi.useFakeTimers();
        const requestAnimationFrame = vi.fn(() => 73);
        const cancelAnimationFrame = vi.fn();
        vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
        vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
        const resolved = vi.fn();

        const pending = yieldPlayStartToPaint().then(resolved);
        await vi.advanceTimersByTimeAsync(PLAY_START_PAINT_YIELD_MAX_DELAY_MS - 1);
        expect(resolved).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        await pending;

        expect(resolved).toHaveBeenCalledTimes(1);
        expect(cancelAnimationFrame).toHaveBeenCalledOnce();
        expect(cancelAnimationFrame).toHaveBeenCalledWith(73);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("ignores a cancelled frame callback after the fallback wins", async () => {
        vi.useFakeTimers();
        let frameCallback: FrameRequestCallback | undefined;
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            frameCallback = callback;
            return 99;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());
        const resolved = vi.fn();

        const pending = yieldPlayStartToPaint().then(resolved);
        await vi.advanceTimersByTimeAsync(PLAY_START_PAINT_YIELD_MAX_DELAY_MS);
        await pending;

        frameCallback?.(500);
        await vi.runAllTimersAsync();

        expect(resolved).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("lets progressive initialization continue under stalled animation frames", async () => {
        vi.useFakeTimers();
        vi.stubGlobal("requestAnimationFrame", vi.fn(() => 7));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());
        const maybeYield = createProgressiveYieldController(
            {
                batchSize: 1,
                frameBudgetMs: 1_000,
                yieldToFrame: yieldPlayStartToPaint,
            },
            {
                batchSize: 1,
                frameBudgetMs: 1_000,
            },
        );
        const initialized: number[] = [];

        const initialization = (async () => {
            for (let index = 0; index < 3; index++) {
                initialized.push(index);
                await maybeYield();
            }
        })();

        expect(initialized).toEqual([0]);
        await vi.advanceTimersByTimeAsync(PLAY_START_PAINT_YIELD_MAX_DELAY_MS);
        expect(initialized).toEqual([0, 1]);
        await vi.advanceTimersByTimeAsync(PLAY_START_PAINT_YIELD_MAX_DELAY_MS);
        expect(initialized).toEqual([0, 1, 2]);
        await vi.advanceTimersByTimeAsync(PLAY_START_PAINT_YIELD_MAX_DELAY_MS);
        await initialization;

        expect(vi.getTimerCount()).toBe(0);
    });
});
