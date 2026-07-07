import {useCallback} from "react";

import {useGetScriptRevisionData} from "./scripts";
import {saveScene} from "@stem/network/api/scene";
import {resolveAssetRevisionId} from "@stem/editor-oss/asset-management/AssetResolutionContext";
import {useAssetResolutionContext} from "@stem/editor-oss/context/AssetResolutionContext";
import global from "@stem/editor-oss/global";
import {updateSceneScriptRevision} from "../util";

export interface UpdateSceneScriptRevisionOptions {
    /** If provided, skips fetching from API. */
    code?: string;
}

/**
 * Hook for applying a script revision to the current scene. Mirrors
 * `useApplySceneBehaviorRevision` and `useApplySceneLambdaRevision`.
 *
 * Fetches the revision's code (when not provided), pins the revision via
 * `updateSceneScriptRevision`, and triggers `saveScene` when collaborative
 * so other clients pick up the change.
 */
export const useApplySceneScriptRevision = () => {
    const getScriptRevisionData = useGetScriptRevisionData();
    const {context} = useAssetResolutionContext();

    return useCallback(
        async (
            assetId: string,
            revisionId: string,
            options: UpdateSceneScriptRevisionOptions = {},
        ): Promise<void> => {
            const app = global.app;
            if (!app) return;

            const oldRevisionId = resolveAssetRevisionId(assetId, context);
            if (oldRevisionId === revisionId && !options.code) return;

            const code = options.code ?? (await getScriptRevisionData(assetId, revisionId)).code;

            await updateSceneScriptRevision({assetId, revisionId, code});

            if (app.editor?.isCollaborative) {
                await saveScene(false, false);
            }
        },
        [getScriptRevisionData, context],
    );
};
