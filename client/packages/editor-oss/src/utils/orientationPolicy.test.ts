import {describe, expect, it} from "vitest";

import {
    DEFAULT_ORIENTATION_POLICY,
    doesOrientationMatchPolicy,
    getOrientationTarget,
    isOrientationRequired,
    normalizeOrientationPolicy,
} from "./orientationPolicy";

describe("orientation policy", () => {
    it("defaults the Playground runtime to landscape-only mobile support", () => {
        expect(DEFAULT_ORIENTATION_POLICY).toBe("requireLandscape");
        expect(getOrientationTarget(DEFAULT_ORIENTATION_POLICY)).toBe("landscape");
        expect(isOrientationRequired(DEFAULT_ORIENTATION_POLICY)).toBe(true);
    });

    it.each([
        "any",
        "preferPortrait",
        "preferLandscape",
        "requirePortrait",
        "requireLandscape",
    ] as const)("normalizes legacy %s scenes to the supported landscape policy", policy => {
        expect(normalizeOrientationPolicy(policy)).toBe("requireLandscape");
        expect(getOrientationTarget(policy)).toBe("landscape");
        expect(doesOrientationMatchPolicy(policy, "portrait")).toBe(false);
        expect(doesOrientationMatchPolicy(policy, "landscape")).toBe(true);
    });
});
