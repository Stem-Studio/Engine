import {describe, expect, it} from "vitest";

import {RollingMaxWindow} from "../RollingMaxWindow";

describe("RollingMaxWindow", () => {
    it("tracks the max sample inside the fixed-size window", () => {
        const window = new RollingMaxWindow(3, 1);

        expect(window.push(2)).toBe(2);
        expect(window.push(5)).toBe(5);
        expect(window.push(4)).toBe(5);
        expect(window.size).toBe(3);
    });

    it("recomputes max only when the evicted sample was the max", () => {
        const window = new RollingMaxWindow(3, 1);

        window.push(10);
        window.push(3);
        window.push(2);

        expect(window.push(4)).toBe(4);
        expect(window.max).toBe(4);
    });

    it("keeps the max when a lower non-max sample is evicted", () => {
        const window = new RollingMaxWindow(3, 1);

        window.push(2);
        window.push(10);
        window.push(3);

        expect(window.push(4)).toBe(10);
        expect(window.max).toBe(10);
    });

    it("clears back to the configured floor", () => {
        const window = new RollingMaxWindow(2, 1);

        window.push(20);
        window.clear();

        expect(window.size).toBe(0);
        expect(window.max).toBe(1);
    });

    it("uses the floor for non-finite samples", () => {
        const window = new RollingMaxWindow(2, 1);

        expect(window.push(Number.NaN)).toBe(1);
        expect(window.push(3)).toBe(3);
    });
});
