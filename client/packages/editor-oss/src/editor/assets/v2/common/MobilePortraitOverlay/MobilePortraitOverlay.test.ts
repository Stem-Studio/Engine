import {afterEach, describe, expect, it, vi} from "vitest";

import {shouldBlockOrientation} from "./MobilePortraitOverlay";
import {DetectDevice} from "@stem/editor-oss/utils/DetectDevice";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("MobileOrientationOverlay gate", () => {
    it("blocks a compact portrait viewport for the landscape-only editor", () => {
        vi.spyOn(DetectDevice, "isMobile").mockReturnValue(false);
        vi.stubGlobal("matchMedia", vi.fn(() => ({matches: true})));
        expect(shouldBlockOrientation("requireLandscape", true, "portrait", true)).toBe(true);
        expect(shouldBlockOrientation("requireLandscape", true, "landscape", true)).toBe(false);
    });

    it("does not apply the compact fallback outside the phone breakpoint", () => {
        vi.spyOn(DetectDevice, "isMobile").mockReturnValue(false);
        vi.stubGlobal("matchMedia", vi.fn(() => ({matches: false})));
        expect(shouldBlockOrientation("requireLandscape", true, "portrait", true)).toBe(false);
    });
});
