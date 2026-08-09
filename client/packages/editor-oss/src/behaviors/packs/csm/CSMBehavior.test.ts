import {describe, expect, it} from "vitest";

import {getEffectiveCsmCascades} from "./CSMBehavior";

describe("getEffectiveCsmCascades", () => {
    it("caps authored cascades only in editor preview", () => {
        expect(getEffectiveCsmCascades(3, true)).toBe(2);
        expect(getEffectiveCsmCascades(1, true)).toBe(1);
        expect(getEffectiveCsmCascades(3, false)).toBe(3);
    });

    it("honors an explicit scene budget and opt-out", () => {
        expect(getEffectiveCsmCascades(6, true, {maxCascades: 4})).toBe(4);
        expect(getEffectiveCsmCascades(6, true, {enabled: false, maxCascades: 1})).toBe(6);
    });

    it("normalizes invalid values to safe cascade counts", () => {
        expect(getEffectiveCsmCascades(undefined, true)).toBe(2);
        expect(getEffectiveCsmCascades(0, false)).toBe(3);
        expect(getEffectiveCsmCascades(4, true, {maxCascades: 0})).toBe(2);
    });
});
