import {describe, expect, it} from "vitest";

import {formatAssetCount} from "./projectAssetCount";

describe("formatAssetCount", () => {
    it("never exposes an undefined project asset count", () => {
        expect(formatAssetCount(undefined)).toBe("0 Assets");
        expect(formatAssetCount(null)).toBe("0 Assets");
        expect(formatAssetCount(7)).toBe("7 Assets");
    });
});
