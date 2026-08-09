import {describe, expect, it} from "vitest";

import {
    COMPACT_WORKSPACE_QUERY,
    resolveCompactWorkspaceShortcut,
    toggleCompactWorkspacePanel,
} from "./responsiveWorkspace";

describe("responsive workspace panels", () => {
    it("uses the compact breakpoint and keeps drawers mutually exclusive", () => {
        expect(COMPACT_WORKSPACE_QUERY).toBe("(max-width: 960px)");
        expect(toggleCompactWorkspacePanel(null, "hierarchy")).toBe("hierarchy");
        expect(toggleCompactWorkspacePanel("hierarchy", "inspector")).toBe("inspector");
        expect(toggleCompactWorkspacePanel("inspector", "inspector")).toBeNull();
    });

    it("maps predictable keyboard shortcuts and Escape to panel state", () => {
        expect(resolveCompactWorkspaceShortcut(null, "1", true)).toEqual({
            handled: true,
            panel: "hierarchy",
        });
        expect(resolveCompactWorkspaceShortcut("hierarchy", "2", true)).toEqual({
            handled: true,
            panel: "inspector",
        });
        expect(resolveCompactWorkspaceShortcut("inspector", "Escape", false)).toEqual({
            handled: true,
            panel: null,
        });
        expect(resolveCompactWorkspaceShortcut("hierarchy", "1", false)).toEqual({
            handled: false,
            panel: "hierarchy",
        });
    });
});
