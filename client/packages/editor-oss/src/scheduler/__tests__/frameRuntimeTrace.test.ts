import { afterEach, describe, expect, it } from "vitest";

import {
    getFrameRuntimeTraceStore,
    isFrameRuntimeTraceEnabled,
    recordFrameRuntimeTrace,
} from "../debug/frameRuntimeTrace.js";

describe("frameRuntimeTrace", () => {
    afterEach(() => {
        delete (globalThis as any).__TRACE_FRAME_RUNTIME__;
        getFrameRuntimeTraceStore().clear();
    });

    it("does not record when tracing is disabled", () => {
        recordFrameRuntimeTrace({ kind: "physics-step", value: 1 });

        expect(getFrameRuntimeTraceStore().events).toHaveLength(0);
        expect(isFrameRuntimeTraceEnabled("physics-step")).toBe(false);
    });

    it("records matching events when tracing is enabled", () => {
        (globalThis as any).__TRACE_FRAME_RUNTIME__ = { filters: ["physics-*"], maxEvents: 4 };

        recordFrameRuntimeTrace({ kind: "physics-step", stepCounter: 1 });
        recordFrameRuntimeTrace({ kind: "render-frame", frame: 1 });

        const store = getFrameRuntimeTraceStore();
        expect(isFrameRuntimeTraceEnabled("physics-step")).toBe(true);
        expect(store.events).toHaveLength(1);
        expect(store.events[0]?.kind).toBe("physics-step");
        expect(store.lastByKind["physics-step"]?.stepCounter).toBe(1);
    });

    it("trims the ring buffer to the configured size", () => {
        (globalThis as any).__TRACE_FRAME_RUNTIME__ = { maxEvents: 2 };

        recordFrameRuntimeTrace({ kind: "runtime-frame", frameCount: 1 });
        recordFrameRuntimeTrace({ kind: "runtime-frame", frameCount: 2 });
        recordFrameRuntimeTrace({ kind: "runtime-frame", frameCount: 3 });

        const store = getFrameRuntimeTraceStore();
        expect(store.events).toHaveLength(2);
        // Circular buffer: newest entries overwrite oldest in-place
        const frameCounts = store.events.map((e: any) => e.frameCount).sort();
        expect(frameCounts).toEqual([2, 3]);
        expect(store.dropped).toBe(1);
    });
});
