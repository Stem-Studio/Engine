import {useState} from "react";

import {RevisionAction, RevisionItem} from "./RevisionItem";
import {AssetRevision, getAssetRevisionData} from "@stem/network/api/asset";
import {resolveAssetRevisionId} from "@stem/editor-oss/asset-management/AssetResolutionContext";
import {useAuthorizationContext} from "@stem/editor-oss/context";
import {useAssetResolutionContext} from "@stem/editor-oss/context/AssetResolutionContext";
import {ElementsUtils} from "@stem/editor-oss/utils/ElementsUtils";
import {useAsset, useAssetRevisions} from "../../../../asset-management/hooks/assets";
import {PublishPopup} from "../PublishSection/PublishPopup";
import {TextDiffModal} from "../TextDiffModal/TextDiffModal";

type PublishViewState = {
    assetId: string;
    revisionId: string;
    isOpen: boolean;
};

/**
 * Context passed to {@link RevisionListProps.getLoadActions} for each row,
 * so the caller can decide which actions (if any) to render on that revision.
 */
export type RevisionActionContext = {
    revision: AssetRevision;
    isCurrent: boolean;
    isLatest: boolean;
    /**
     * True when this revision is strictly older than the currently checked-out
     * revision (i.e. loading it would be a rollback). False for the current
     * row, for newer rows, and when no current revision is known.
     */
    isOlderThanCurrent: boolean;
};

/**
 * Props required for the logical behaviour of RevisionsSection.
 * Do not include UI/styling-related props here — define them separately.
 */
export interface RevisionListProps {
    assetId: string;

    /**
     * Optional current revision ID. If not provided, the scene revision ID will
     * be used.
     */
    currentRevisionId?: string;

    /**
     * Optional revision ID the scene is actually running, when distinct from
     * `currentRevisionId`. Only meaningful for the inline-Behavior-Creator
     * context where the editor view (`currentRevisionId`) and the scene's
     * checked-out revision can diverge. When set and different from
     * `currentRevisionId`, the matching row gets a `(Scene)` marker.
     */
    sceneRevisionId?: string;

    /**
     * Builds the action buttons (e.g. "Load", "Open in editor") shown on a
     * given revision row. Return an empty array to render no caller-supplied
     * actions on that row. Built-in Publish/Diff actions are still rendered
     * separately based on their own props.
     */
    getLoadActions?: (ctx: RevisionActionContext) => RevisionAction[];
    showDiffOption?: boolean;
}

/**
 * Prompts the user before applying an older revision to the scene. Calls
 * {@link onConfirm} immediately if no confirmation is needed, otherwise
 * shows a confirmation dialog first.
 *
 * @param revision the revision the user is about to load
 * @param isOlderThanCurrent whether loading would be a backward rollback
 * @param onConfirm callback invoked when the user confirms (or confirmation is unnecessary)
 */
export const confirmRevisionRollback = (
    revision: AssetRevision,
    isOlderThanCurrent: boolean,
    onConfirm: () => void,
): void => {
    if (!isOlderThanCurrent) {
        onConfirm();
        return;
    }
    const when = new Date(revision.createTime).toLocaleString();
    ElementsUtils.confirm({
        title: "Roll back revision?",
        content: `Roll back to the revision from ${when}? This will replace the version of this asset currently in your scene with an older one.`,
        onOK: onConfirm,
    });
};

export const RevisionList = ({
    assetId,
    currentRevisionId,
    sceneRevisionId,
    getLoadActions,
    showDiffOption,
}: RevisionListProps) => {
    const [isTextDiffOpen, setIsTextDiffOpen] = useState(false);
    const [oldText, setOldText] = useState("");
    const [newText, setNewText] = useState("");
    const [publishViewState, setPublishViewState] = useState<PublishViewState>({
        assetId: "",
        revisionId: "",
        isOpen: false,
    });

    const {dbUser} = useAuthorizationContext();

    const {data: asset} = useAsset(assetId);

    const {data: revisionsData} = useAssetRevisions(assetId, {
        includeRelease: true,
    });

    const {context: assetResolutionContext} = useAssetResolutionContext();
    const actualCurrentRevisionId = currentRevisionId || resolveAssetRevisionId(assetId, assetResolutionContext);

    const handleDiffClick = (event: React.MouseEvent, otherRevisionId: string) => {
        event.stopPropagation();
        event.preventDefault();

        if (!actualCurrentRevisionId) {
            return;
        }

        const promises = [actualCurrentRevisionId, otherRevisionId].map(async id => {
            const data = await getAssetRevisionData(assetId, id, "json");
            return data.code;
        });

        Promise.all(promises)
            .then(([oldText, newText]) => {
                setOldText(oldText);
                setNewText(newText);
                setIsTextDiffOpen(true);
            })
            .catch(console.error);
    };

    const handleDiffClose = () => {
        setIsTextDiffOpen(false);
    };

    const handlePublishClick = (event: React.MouseEvent, revisionId: string) => {
        setPublishViewState({assetId, revisionId, isOpen: true});
    };

    const handlePublishViewClose = () => {
        setPublishViewState({assetId: "", revisionId: "", isOpen: false});
    };

    if (!asset || !revisionsData) {
        return null;
    }

    const isAssetOwner = dbUser?.id === asset.userId;
    const latestRevisionId = revisionsData.revisions[0]?.id;
    // Revisions are returned newest-first, so a higher index = older.
    const currentIndex = revisionsData.revisions.findIndex(r => r.id === actualCurrentRevisionId);

    return (
        <>
            {revisionsData.revisions.map((revision, index) => {
                const isCurrent = revision.id === actualCurrentRevisionId;
                // Only mark a row as the scene revision when it's distinct from
                // the editor view — otherwise (Current) already covers it.
                const isSceneRevision =
                    !!sceneRevisionId &&
                    revision.id === sceneRevisionId &&
                    sceneRevisionId !== actualCurrentRevisionId;
                const loadActions = getLoadActions?.({
                    revision,
                    isCurrent,
                    isLatest: revision.id === latestRevisionId,
                    isOlderThanCurrent: currentIndex >= 0 && index > currentIndex,
                }) ?? [];
                return (
                    <RevisionItem
                        key={revision.id}
                        revision={revision}
                        isCurrentRevision={isCurrent}
                        isSceneRevision={isSceneRevision}
                        loadActions={loadActions}
                        showPublishButton={isAssetOwner && !revision.release}
                        onDiffClick={event => handleDiffClick(event, revision.id)}
                        onPublishClick={event => handlePublishClick(event, revision.id)}
                        showDiffOption={showDiffOption}
                    />
                );
            })}

            <TextDiffModal oldText={oldText}
                newText={newText}
                isOpen={isTextDiffOpen}
                onClose={handleDiffClose}
            />

            <PublishPopup
                assetId={publishViewState.assetId}
                revisionId={publishViewState.revisionId}
                isOpen={publishViewState.isOpen}
                onClose={handlePublishViewClose}
            />
        </>
    );
};
