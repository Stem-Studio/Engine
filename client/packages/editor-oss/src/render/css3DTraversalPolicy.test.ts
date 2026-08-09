import {describe, expect, it} from "vitest";

import {shouldCollectCSS3DTraversal} from "./css3DTraversalPolicy";

describe("shouldCollectCSS3DTraversal", () => {
    it("collects every frame while CSS3D objects are present", () => {
        expect(shouldCollectCSS3DTraversal(true, 101, 100, 1_000)).toBe(true);
    });

    it("throttles empty-scene scans until the configured interval elapses", () => {
        expect(shouldCollectCSS3DTraversal(false, 999, 0, 1_000)).toBe(false);
        expect(shouldCollectCSS3DTraversal(false, 1_000, 0, 1_000)).toBe(true);
    });

    it("treats invalid intervals as immediate polling", () => {
        expect(shouldCollectCSS3DTraversal(false, 10, 10, Number.NaN)).toBe(true);
        expect(shouldCollectCSS3DTraversal(false, 10, 10, -1)).toBe(true);
    });
});
