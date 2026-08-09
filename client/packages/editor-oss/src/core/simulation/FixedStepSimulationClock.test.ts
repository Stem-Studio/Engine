import {describe, expect, it} from "vitest";

import {FixedStepSimulationClock} from "./FixedStepSimulationClock";

const expectNear = (actual: number, expected: number) =>
    expect(actual).toBeCloseTo(expected, 10);

describe("FixedStepSimulationClock", () => {
    it("steps once per 60 Hz frame without accumulating overstep", () => {
        const clock = new FixedStepSimulationClock({fixedHz: 60, maxStepsPerFrame: 3});

        for (let i = 0; i < 120; i++) {
            const frame = clock.advance(1 / 60);
            expect(frame.fixedStepCount).toBe(1);
            expectNear(frame.interpolationAlpha, 0);
            expectNear(frame.fixedOverstep, 0);
        }
    });

    it("steps twice per 30 Hz render frame", () => {
        const clock = new FixedStepSimulationClock({fixedHz: 60, maxStepsPerFrame: 3});
        const frame = clock.advance(1 / 30);

        expect(frame.fixedStepCount).toBe(2);
        expect(frame.droppedSteps).toBe(0);
        expectNear(frame.interpolationAlpha, 0);
    });

    it("bounds low-FPS catch-up and reports discarded whole steps", () => {
        const clock = new FixedStepSimulationClock({
            fixedHz: 60,
            maxStepsPerFrame: 3,
            maxFrameDeltaSeconds: 1,
        });
        const frame = clock.advance(0.1);

        expect(frame.fixedStepCount).toBe(3);
        expect(frame.droppedSteps).toBe(3);
        expectNear(frame.droppedTime, 3 / 60);
        expectNear(frame.fixedOverstep, 0);
    });

    it("clamps a tab spike and accounts for both clamp and catch-up loss", () => {
        const clock = new FixedStepSimulationClock({
            fixedHz: 60,
            maxStepsPerFrame: 3,
            maxFrameDeltaSeconds: 0.25,
        });
        const frame = clock.advance(1);

        expect(frame.deltaTime).toBe(0.25);
        expect(frame.fixedStepCount).toBe(3);
        expect(frame.droppedSteps).toBe(12);
        expectNear(frame.droppedTime, 0.95);
        expectNear(frame.totalDroppedTime, 0.95);
    });

    it("retains only fractional overstep and exposes interpolation alpha", () => {
        const clock = new FixedStepSimulationClock({fixedHz: 60});
        const frame = clock.advance(1 / 40);

        expect(frame.fixedStepCount).toBe(1);
        expectNear(frame.fixedOverstep, 1 / 120);
        expectNear(frame.interpolationAlpha, 0.5);
    });

    it("resets remainder across pause or visibility changes", () => {
        const clock = new FixedStepSimulationClock({fixedHz: 60});
        expect(clock.advance(1 / 120).interpolationAlpha).toBeCloseTo(0.5);

        clock.reset();
        const frame = clock.advance(1 / 120);

        expect(frame.fixedStepCount).toBe(0);
        expectNear(frame.interpolationAlpha, 0.5);
    });

    it("resets an old-rate remainder when fixed Hz changes", () => {
        const clock = new FixedStepSimulationClock({fixedHz: 60});
        clock.advance(1 / 120);
        clock.configure({fixedHz: 30});

        const frame = clock.advance(1 / 60);
        expect(frame.fixedStepCount).toBe(0);
        expectNear(frame.interpolationAlpha, 0.5);
        expectNear(frame.fixedDeltaTime, 1 / 30);
    });

    it("sanitizes invalid deltas and configuration", () => {
        const clock = new FixedStepSimulationClock({
            fixedHz: Number.NaN,
            maxStepsPerFrame: 0,
            maxFrameDeltaSeconds: Number.POSITIVE_INFINITY,
        });

        expect(clock.advance(Number.NaN).fixedStepCount).toBe(0);
        expect(clock.advance(-1).fixedStepCount).toBe(0);
        expect(clock.advance(1 / 60).fixedStepCount).toBe(1);
    });

    it("hard-bounds hostile saved-scene timing values", () => {
        const clock = new FixedStepSimulationClock({
            fixedHz: Number.MAX_VALUE,
            maxStepsPerFrame: Number.MAX_SAFE_INTEGER,
            maxFrameDeltaSeconds: Number.MAX_VALUE,
        });

        const frame = clock.advance(1);

        expect(frame.fixedDeltaTime).toBe(1 / 240);
        expect(frame.fixedStepCount).toBe(16);
        expect(frame.droppedSteps).toBe(224);
        expect(Number.isFinite(frame.interpolationAlpha)).toBe(true);
        expect(Number.isFinite(frame.droppedTime)).toBe(true);
    });
});
