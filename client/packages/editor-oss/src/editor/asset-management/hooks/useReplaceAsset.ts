import {useCallback} from "react";

import {useAddEditorDependencies, useRemoveEditorDependencies} from "./assets";
import {useChangeAssetRevision} from "./useChangeAssetRevision";
import {useChangeLambdaRevision} from "./useChangeLambdaRevision";
import {useChangeModelRevision} from "./useChangeModelRevision";
import {useChangePrefabRevision} from "./useChangePrefabRevision";
import {useChangeQuarksRevision} from "./useChangeQuarksRevision";
import {AssetType} from "@stem/network/api/asset";
import {getBehaviorRevisionData} from "@stem/network/api/behavior";
import {useAssetSource} from "@stem/editor-oss/context/AssetSourceContext";
import {BehaviorConfig} from "../../behaviors/BehaviorConfig";
import {updateSceneBehaviorRevision} from "../../behaviors/util";

export type ReplaceAssetParams = {
    /** The asset id currently referenced in the scene. */
    originalAssetId: string;
    /** The asset id to swap to (e.g. a fork id). */
    newAssetId: string;
    /** The revision id of newAssetId to pin in the scene. */
    newRevisionId: string;
    /** Asset type — used to dispatch to the right per-type swap helper. */
    assetType: (typeof AssetType)[keyof typeof AssetType];
    /**
     * UUIDs to skip during instance reload — typically the just-saved
     * instance whose in-memory content is the source of truth for the
     * new revision. Currently honored by the Prefab and Quarks cases;
     * other types ignore it (no caller has needed it yet).
     */
    excludeUuids?: string[];
};

/**
 * Hook that swaps every reference to one asset for another in the current
 * scene, plus the matching revision pin. Routes to the per-asset-type swap
 * helper based on assetType.
 *
 * Intentionally generic — fork-on-edit is one caller; future callers
 * (asset-library swap, asset-deletion-with-placeholder, migration tooling)
 * reuse the same dispatcher.
 *
 * Persistence: this hook persists the dependency change through the
 * standard editor mutation hooks (`useAddEditorDependencies` /
 * `useRemoveEditorDependencies`), which call AssetSource and invalidate
 * the editor list query. Without these calls the new asset would only
 * show up after a full scene save and the old asset would linger as a
 * stale dependency.
 *
 * Sits alongside useChangeAssetRevision, which handles "same id, new
 * revision". useReplaceAsset handles "new id + new revision".
 *
 * Reference-only assets — Image, Audio, Video, Animation, Npc, File, and
 * Script — are swapped through the generic AssetRef remapper in
 * useChangeAssetRevision. Scene object asset types still route through their
 * per-type helpers because they need instance reloads in addition to ref
 * remapping.
 */
export const useReplaceAsset = () => {
    const changeAssetRevision = useChangeAssetRevision();
    const changeModelRevision = useChangeModelRevision();
    const changePrefabRevision = useChangePrefabRevision();
    const changeLambdaRevision = useChangeLambdaRevision();
    const changeQuarksRevision = useChangeQuarksRevision();
    const addDependencies = useAddEditorDependencies();
    const removeDependencies = useRemoveEditorDependencies();
    const assetSource = useAssetSource();

    return useCallback(
        async ({
            originalAssetId,
            newAssetId,
            newRevisionId,
            assetType,
            excludeUuids,
        }: ReplaceAssetParams): Promise<void> => {
            // 1. Add the new asset to the active scene/stem dependency
            //    set BEFORE the in-memory swap. The mutation hook calls
            //    through to AssetSource (persists + pins revision in the
            //    resolution context) and invalidates the editor list
            //    query on success, so subsequent loaders see the new
            //    revision when they run.
            //
            //    Skipped when there's no active AssetSource — exercised in
            //    headless / standalone-editor contexts where dep tracking
            //    isn't applicable.
            if (assetSource) {
                await addDependencies.mutateAsync({[newAssetId]: newRevisionId});
            }

            switch (assetType) {
                case AssetType.Behavior: {
                    const {code, config} = await getBehaviorRevisionData(newAssetId, newRevisionId);
                    updateSceneBehaviorRevision({
                        assetId: originalAssetId,
                        revisionId: newRevisionId,
                        code,
                        config: config as BehaviorConfig,
                        newAssetId,
                    });
                    break;
                }
                case AssetType.Model:
                    await changeModelRevision(originalAssetId, newRevisionId, undefined, newAssetId);
                    break;
                case AssetType.Prefab:
                    await changePrefabRevision(originalAssetId, newRevisionId, newAssetId, excludeUuids);
                    break;
                case AssetType.Lambda:
                    await changeLambdaRevision(originalAssetId, newRevisionId, newAssetId);
                    break;
                case AssetType.Quarks:
                    await changeQuarksRevision(originalAssetId, newRevisionId, newAssetId, excludeUuids);
                    break;
                case AssetType.Image:
                case AssetType.Audio:
                case AssetType.Video:
                case AssetType.Animation:
                case AssetType.Npc:
                case AssetType.File:
                case AssetType.Script:
                    await changeAssetRevision(originalAssetId, newRevisionId, undefined, newAssetId);
                    break;
                default:
                    throw new Error(
                        `useReplaceAsset: asset type "${String(assetType)}" is not yet supported. ` +
                            `Add a per-type swap helper and extend this dispatcher.`,
                    );
            }

            // 2. Drop the old asset from the dependency set. Done last so
            //    a mid-flight failure leaves the new dep in place rather
            //    than orphaning the scene with neither asset attached.
            if (assetSource) {
                await removeDependencies.mutateAsync([originalAssetId]);
            }
        },
        [
            changeAssetRevision,
            changeModelRevision,
            changePrefabRevision,
            changeLambdaRevision,
            changeQuarksRevision,
            addDependencies,
            removeDependencies,
            assetSource,
        ],
    );
};
