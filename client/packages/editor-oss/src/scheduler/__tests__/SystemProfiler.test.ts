import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {SystemProfiler} from "../SystemProfiler";

function makeDeadline(): IdleDeadline {
    return {
        didTimeout: false,
        timeRemaining: () => 5,
    } as IdleDeadline;
}

function recordSample(
    profiler: SystemProfiler,
    instanceUuid: string,
    systemId: string,
    elapsedMs: number,
): void {
    vi.spyOn(performance, "now").mockReturnValueOnce(1000);
    profiler.beginMeasure(instanceUuid);
    vi.spyOn(performance, "now").mockReturnValueOnce(1000 + elapsedMs);
    profiler.endMeasure(instanceUuid, systemId);
}

describe("SystemProfiler", () => {
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
        vi.restoreAllMocks();
        globalThis.requestIdleCallback = originalRequestIdleCallback;
        globalThis.cancelIdleCallback = originalCancelIdleCallback;
    });

    it("returns the top systems by average execution time without requiring a full metrics sort", () => {
        const profiler = new SystemProfiler();
        profiler.enable();

        recordSample(profiler, "slow", "slow-system", 30);
        recordSample(profiler, "fast", "fast-system", 5);
        recordSample(profiler, "medium", "medium-system", 15);

        expect(profiler.getTopSystems(2).map(metric => metric.systemId)).toEqual([
            "slow-system",
            "medium-system",
        ]);
    });

    it("computes summary totals and the default top five in one pass", () => {
        const profiler = new SystemProfiler();
        profiler.enable();

        for (let i = 0; i < 7; i++) {
            recordSample(profiler, `uuid-${i}`, `system-${i}`, i + 1);
        }

        const summary = profiler.getSummary();

        expect(summary.totalTimeMs).toBe(28);
        expect(summary.topSystems.map(metric => metric.systemId)).toEqual([
            "system-6",
            "system-5",
            "system-4",
            "system-3",
            "system-2",
        ]);
    });

    it("normalizes non-positive and non-finite top limits to an empty result", () => {
        const profiler = new SystemProfiler();
        profiler.enable();
        recordSample(profiler, "only", "only-system", 10);

        expect(profiler.getTopSystems(0)).toEqual([]);
        expect(profiler.getTopSystems(-1)).toEqual([]);
        expect(profiler.getTopSystems(Number.NaN)).toEqual([]);
    });

    it("allocates the idle queue only for deferred summaries", () => {
        const profiler = new SystemProfiler();

        expect((profiler as unknown as {idleQueue: unknown}).idleQueue).toBeNull();

        profiler.enable();
        recordSample(profiler, "only", "only-system", 10);
        expect((profiler as unknown as {idleQueue: unknown}).idleQueue).toBeNull();

        profiler.deferredSummary();

        expect((profiler as unknown as {idleQueue: unknown}).idleQueue).not.toBeNull();
        expect(globalThis.requestIdleCallback).toHaveBeenCalledTimes(1);

        idleCallbacks[0]!(makeDeadline());

        expect(profiler.getLastSummary()?.totalTimeMs).toBe(10);
        profiler.dispose();
        expect((profiler as unknown as {idleQueue: unknown}).idleQueue).toBeNull();
    });
});
