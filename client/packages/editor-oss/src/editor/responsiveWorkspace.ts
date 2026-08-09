export const COMPACT_WORKSPACE_QUERY = "(max-width: 960px)";

export type CompactWorkspacePanel = "hierarchy" | "inspector" | null;

export const toggleCompactWorkspacePanel = (
    current: CompactWorkspacePanel,
    requested: Exclude<CompactWorkspacePanel, null>,
): CompactWorkspacePanel => current === requested ? null : requested;

export const resolveCompactWorkspaceShortcut = (
    current: CompactWorkspacePanel,
    key: string,
    altKey: boolean,
): {handled: boolean; panel: CompactWorkspacePanel} => {
    if (key === "Escape" && current) return {handled: true, panel: null};
    if (altKey && key === "1") {
        return {handled: true, panel: toggleCompactWorkspacePanel(current, "hierarchy")};
    }
    if (altKey && key === "2") {
        return {handled: true, panel: toggleCompactWorkspacePanel(current, "inspector")};
    }
    return {handled: false, panel: current};
};
