import {describe, expect, it, vi} from "vitest";

import {RuntimeFrameTelemetry} from "./RuntimeFrameTelemetry";

describe("RuntimeFrameTelemetry", () => {
    it("reports the engine's actual 30 fps render cadence", () => {
        const telemetry = new RuntimeFrameTelemetry(120, 0);

        for (let frame = 1; frame <= 90; frame++) {
            telemetry.recordRenderedFrame(frame * (1000 / 30), 8, 1000 / 30);
        }

        const snapshot = telemetry.getSnapshot();
        expect(snapshot.renderedFrames).toBe(90);
        expect(snapshot.sampleCount).toBe(90);
        expect(snapshot.fpsEma).toBeCloseTo(30, 4);
        expect(snapshot.frameTimeEmaMs).toBeCloseTo(1000 / 30, 4);
        expect(snapshot.frameTimeP95Ms).toBeCloseTo(1000 / 30, 3);
        expect(snapshot.frameTimeP99Ms).toBeCloseTo(1000 / 30, 3);
    });

    it("counts scheduler skips separately from rendered frames", () => {
        const telemetry = new RuntimeFrameTelemetry(16, 0);

        telemetry.recordSkippedFrame("frame-cap", 1);
        telemetry.recordSkippedFrame("frame-cap", 2);
        telemetry.recordSkippedFrame("script-import", 3);
        telemetry.recordRenderedFrame(34, 7, 1000 / 30);

        expect(telemetry.getSnapshot()).toEqual(expect.objectContaining({
            renderedFrames: 1,
            skippedFrames: 3,
            skippedByReason: expect.objectContaining({
                "frame-cap": 2,
                "script-import": 1,
            }),
        }));
    });

    it("publishes at a bounded cadence while pressure consumers receive each rendered frame", () => {
        const telemetry = new RuntimeFrameTelemetry(16, 250);
        const snapshots = vi.fn();
        const pressure = vi.fn();
        telemetry.subscribe(snapshots, false);
        telemetry.subscribeToPressure(pressure);

        for (let frame = 0; frame < 10; frame++) {
            telemetry.recordRenderedFrame(frame * 16.67, 5, 16.67);
        }

        expect(pressure).toHaveBeenCalledTimes(10);
        expect(snapshots).toHaveBeenCalledTimes(1);
    });

    it("keeps only a fixed-size rolling percentile window", () => {
        const telemetry = new RuntimeFrameTelemetry(8, 0);

        for (let frame = 1; frame <= 16; frame++) {
            telemetry.recordRenderedFrame(frame * 10, 2, frame);
        }

        const snapshot = telemetry.getSnapshot();
        expect(snapshot.sampleCount).toBe(8);
        expect(snapshot.frameTimeP95Ms).toBe(16);
        expect(snapshot.frameTimeP99Ms).toBe(16);
    });

    it("publishes bounded catch-up and dropped simulation metrics", () => {
        const telemetry = new RuntimeFrameTelemetry(8, 0);

        telemetry.recordSimulationFrame(3, 4, 4 / 60, 9, 0.25);
        telemetry.recordRenderedFrame(100, 4, 100);

        expect(telemetry.getSnapshot()).toEqual(expect.objectContaining({
            lastSimulationFixedSteps: 3,
            lastSimulationDroppedSteps: 4,
            lastSimulationDroppedTimeMs: 1000 * 4 / 60,
            totalSimulationDroppedSteps: 9,
            totalSimulationDroppedTimeMs: 250,
        }));
    });
});
