// @vitest-environment jsdom
import {beforeEach, describe, expect, it, vi} from "vitest";

describe("firebase index", () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it("returns null service exports", async () => {
        const firebase = await import("./index");
        expect(firebase.auth).toBeNull();
        expect(firebase.db).toBeNull();
        expect(firebase.analytics).toBeNull();
        expect(firebase.default).toBeNull();
    });
});
