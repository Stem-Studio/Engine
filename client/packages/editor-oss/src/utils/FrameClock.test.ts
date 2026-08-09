import {afterEach, describe, expect, it, vi} from "vitest";

import {FrameClock} from "./FrameClock";

describe("FrameClock", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("preserves Clock-style autostart and delta behavior", () => {
        const now = vi.spyOn(performance, "now");
        now.mockReturnValue(1000);
        const clock = new FrameClock();

        expect(clock.getDelta()).toBe(0);
        expect(clock.running).toBe(true);
        expect(clock.elapsedTime).toBe(0);

        now.mockReturnValue(1016);
        expect(clock.getDelta()).toBeCloseTo(0.016);
        expect(clock.elapsedTime).toBeCloseTo(0.016);

        clock.stop();
        now.mockReturnValue(1100);
        expect(clock.getDelta()).toBe(0);
        expect(clock.running).toBe(false);
        expect(clock.autoStart).toBe(false);
    });
});
