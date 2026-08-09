import {afterEach, describe, expect, it, vi} from "vitest";

import {
    beginScriptImportActivity,
    isScriptImportInProgress,
    resetScriptImportActivityForTests,
    subscribeScriptImportActivity,
} from "./scriptImportActivity";

describe("scriptImportActivity", () => {
    afterEach(() => {
        resetScriptImportActivityForTests();
    });

    it("tracks import activity until the returned end callback runs", () => {
        expect(isScriptImportInProgress()).toBe(false);

        const end = beginScriptImportActivity();

        expect(isScriptImportInProgress()).toBe(true);

        end();

        expect(isScriptImportInProgress()).toBe(false);
    });

    it("keeps activity true until all overlapping imports finish", () => {
        const endFirst = beginScriptImportActivity();
        const endSecond = beginScriptImportActivity();

        endFirst();

        expect(isScriptImportInProgress()).toBe(true);

        endSecond();

        expect(isScriptImportInProgress()).toBe(false);
    });

    it("notifies subscribers and ignores duplicate end calls", () => {
        const listener = vi.fn();
        const unsubscribe = subscribeScriptImportActivity(listener);
        const end = beginScriptImportActivity();

        end();
        end();
        unsubscribe();

        expect(listener.mock.calls.map(([inProgress]) => inProgress)).toEqual([false, true, false]);
    });
});
