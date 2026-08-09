/**
 * CodeEditorShell — thin scene-level wrapper around CodeEditor.
 *
 * Equivalent to what SceneBehaviorCreator was for BehaviorCreatorModal:
 * provides the sceneId and wires up useUpdateSceneBehaviorRevision so that
 * saved behaviors are registered back into the scene's runtime registries.
 */
import {useCallback} from "react";

import {saveScene} from "@stem/network/api/scene";

import {CodeEditor} from "./CodeEditor";
import type {InitialSelection, CodeEditorPopoutPayload} from "./types";
import type {InitialDrafts} from "./hooks/useCodeEditorState";
import {useUpdateSceneBehaviorRevision} from "../../../../behaviors/hooks/behaviors";
import type {SaveCompleteInfo} from "../BehaviorCreator/hooks";

const persistOssBehaviorEdit = async () => {
    try {
        await saveScene(false, false);
    } catch (err) {
        console.error("[CodeEditorShell] failed to persist behavior edit to ProjectStore", err);
    }
};

export interface CodeEditorShellProps {
    sceneId: string;
    initialSelection?: InitialSelection;
    initialDrafts?: InitialDrafts;
    onClose: () => void;
    onPopOut?: (payload?: CodeEditorPopoutPayload) => void;
    onPin?: () => void;
    isPinned?: boolean;
    onDirtyChange?: (dirty: boolean) => void;
    onCreateKindConsumed?: () => void;
    onRestoreInline?: () => void;
}

export const CodeEditorShell: React.FC<CodeEditorShellProps> = ({
    sceneId,
    initialSelection,
    initialDrafts,
    onClose,
    onPopOut,
    onPin,
    isPinned,
    onDirtyChange,
    onCreateKindConsumed,
    onRestoreInline,
}) => {
    const updateSceneBehaviorRevision = useUpdateSceneBehaviorRevision();

    const handleSaveComplete = useCallback(
        async ({assetId, revisionId, code, config}: SaveCompleteInfo) => {
            await updateSceneBehaviorRevision(assetId, revisionId, {code, config});
            await persistOssBehaviorEdit();
        },
        [updateSceneBehaviorRevision],
    );

    const handleSaveAllComplete = useCallback(
        async (infos: SaveCompleteInfo[]) => {
            for (const {assetId, revisionId, code, config} of infos) {
                await updateSceneBehaviorRevision(assetId, revisionId, {code, config});
            }
            // Persist once after all in-memory updates rather than per behavior.
            await persistOssBehaviorEdit();
        },
        [updateSceneBehaviorRevision],
    );

    return (
        <CodeEditor
            sceneId={sceneId}
            initialSelection={initialSelection}
            initialDrafts={initialDrafts}
            onClose={onClose}
            onPopOut={onPopOut}
            onPin={onPin}
            isPinned={isPinned}
            onDirtyChange={onDirtyChange}
            onSaveComplete={handleSaveComplete}
            onSaveAllComplete={handleSaveAllComplete}
            onCreateKindConsumed={onCreateKindConsumed}
            onRestoreInline={onRestoreInline}
        />
    );
};
