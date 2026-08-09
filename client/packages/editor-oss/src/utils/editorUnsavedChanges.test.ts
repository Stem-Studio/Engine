import { describe, expect, it } from "vitest";

import {editorHasUnsavedChanges, getEditorSaveStatus, reconcileEditorSaveStatus} from "./editorUnsavedChanges";

describe("editorHasUnsavedChanges", () => {
    it("returns true when the scene has edits after the last save", () => {
        expect(
            editorHasUnsavedChanges({
                lastEditTime: "2026-03-15T12:05:00.000Z",
                lastSaveTime: "2026-03-15T12:00:00.000Z",
            }),
        ).toBe(true);
    });

    it("returns false when the scene is already saved", () => {
        expect(
            editorHasUnsavedChanges({
                lastEditTime: "2026-03-15T12:00:00.000Z",
                lastSaveTime: "2026-03-15T12:05:00.000Z",
            }),
        ).toBe(false);
    });

    it("returns false before any edit has been recorded", () => {
        expect(
            editorHasUnsavedChanges({
                lastSaveTime: "2026-03-15T12:05:00.000Z",
            }),
        ).toBe(false);

        expect(editorHasUnsavedChanges()).toBe(false);
    });

    it("returns true when an edit exists but no save has been recorded", () => {
        expect(
            editorHasUnsavedChanges({
                lastEditTime: "2026-03-15T12:05:00.000Z",
            }),
        ).toBe(true);
    });
});

describe("getEditorSaveStatus", () => {
    it("reports an explicit status from persisted edit/save watermarks", () => {
        expect(getEditorSaveStatus()).toBe("Unsaved");
        expect(getEditorSaveStatus({lastSaveTime: 20})).toBe("Saved");
        expect(getEditorSaveStatus({lastEditTime: 30, lastSaveTime: 20})).toBe("Unsaved");
    });

    it("reconciles a skipped save from the live scene instead of assuming Saved", async () => {
        const status = await reconcileEditorSaveStatus(
            async () => undefined,
            () => ({lastEditTime: 30, lastSaveTime: 20}),
        );
        expect(status).toBe("Unsaved");
    });

    it("reports a rejected save as Failed", async () => {
        const status = await reconcileEditorSaveStatus(
            async () => { throw new Error("write failed"); },
            () => ({lastEditTime: 30, lastSaveTime: 20}),
        );
        expect(status).toBe("Failed");
    });
});
