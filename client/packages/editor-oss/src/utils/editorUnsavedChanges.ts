type SceneUserData = {
    lastEditTime?: number | string;
    lastSaveTime?: number | string;
};

export type EditorSaveStatus = "Unsaved" | "Saving" | "Saved" | "Failed";

export const toEditorTimestamp = (value: number | string | undefined) => {
    if (value === undefined) {
        return null;
    }

    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
};

/**
 *
 * @param sceneUserData
 */
export function editorHasUnsavedChanges(sceneUserData?: SceneUserData | null) {
    if (!sceneUserData?.lastEditTime) {
        return false;
    }

    const lastEditTime = toEditorTimestamp(sceneUserData.lastEditTime);
    if (lastEditTime === null) {
        return false;
    }

    const lastSaveTime = toEditorTimestamp(sceneUserData.lastSaveTime) ?? lastEditTime - 60_000;

    return lastEditTime > lastSaveTime;
}

export function getEditorSaveStatus(sceneUserData?: SceneUserData | null): EditorSaveStatus {
    if (editorHasUnsavedChanges(sceneUserData)) return "Unsaved";
    return sceneUserData?.lastSaveTime ? "Saved" : "Unsaved";
}

/**
 * Resolve the status after a save request settles. Some local save guards
 * intentionally resolve without emitting `sceneSaved` (read-only inspection
 * and temporary Copilot previews), so callers must reconcile from the live
 * scene rather than assuming every resolved promise means "Saved".
 */
export async function reconcileEditorSaveStatus(
    save: () => Promise<unknown>,
    readSceneUserData: () => SceneUserData | null | undefined,
): Promise<EditorSaveStatus> {
    try {
        await save();
        return getEditorSaveStatus(readSceneUserData());
    } catch {
        return "Failed";
    }
}
