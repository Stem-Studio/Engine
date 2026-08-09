/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import React, {useCallback, useEffect, useLayoutEffect, useRef, useState} from "react";
import {RxShare2} from "react-icons/rx";
import {useNavigate} from "react-router-dom";
import {ClipLoader} from "react-spinners";

import {ActionBar, ActionButton, AdminBadge, FixedActionBar} from "./GameOverview.style";
import {createTrackedShareUrl} from "@stem/network/api/rewards";
import {getScene, updateScene} from "@stem/network/api/scene/v2";
import {useSetTemplateIds, useTemplateIds} from "@stem/network/api/templates/hooks";
import {addLikedGame} from "@stem/network/api/updateUser";
import {ROUTES} from "@web-shared/routes";
import {isPlaygroundMode} from "@web-shared/playgroundMode";
import {useAppGlobalContext} from "@stem/editor-oss/context/AppGlobalContext";
import {useAuthorizationContext} from "@stem/editor-oss/context/AuthorizationContext";
import {useHomepageContext} from "@stem/editor-oss/context/HomepageContext";
import global from "@stem/editor-oss/global";
import {showToast} from "@stem/editor-oss/showToast";
import Ajax from "@stem/editor-oss/utils/Ajax";
import {redirectToLogin} from "@stem/editor-oss/utils/authRedirect";
import {PRODUCT_ANALYTICS_EVENTS, trackProductEvent} from "@stem/editor-oss/utils/productAnalytics";
import {backendUrlFromPath} from "@stem/editor-oss/utils/UrlUtils";
import {openEditorRoute} from "../../../../../v2/pages/editorHandoff";
import {generateProjectLink, getGameUrl} from "../../../../../v2/pages/links";
import {
    type ScenePublishStateUpdatedPayload,
    usePublishScene,
    useUnpublishScene,
} from "../../../../asset-management/hooks/publish";
import {prepareEditCurrentGameCopilotEntry} from "../../AiCopilot/copilotWorkspaceEntry";
import adminBadgeIcon from "../../icons/admin.svg";
import {FileData} from "../../types/file";
import archiveIcon from "../icons/archive.svg";
import checkedIcon from "../../RightPanel/icons/checked.svg";
import editIcon from "../icons/edit.svg";
import eyeClosedIcon from "../icons/eye-closed.svg";
import eyeOpenIcon from "../icons/eye-open.svg";
import heartOutlineIcon from "../icons/heart-outline.svg";
import playIcon from "../icons/play.svg";
import publishedStatusIcon from "../icons/published-status.svg";
import versionIcon from "../icons/time.svg";
import topPickIcon from "../icons/top-pick.svg";
import unpublishedStatusIcon from "../icons/unpublished-status.svg";

interface OverviewActionBarProps {
    scene: FileData;
    canEdit: boolean;
    isOwner: boolean;
    onSceneUpdate: (scene: FileData) => void;
}

/**
 * Button visibility matrix:
 *
 * | Button      | Owner/Creator | Collaborator | Admin (not owner) | Player/Visitor |
 * |-------------|---------------|--------------|-------------------|----------------|
 * | Play        | ✓ if playable | ✓ if playable| ✓ if playable     | ✓ if playable  |
 * | Edit        | ✓             | ✓            | ✓                 | ✗              |
 * | Publish     | ✓ if unpublished | ✗         | ✓ if unpublished  | ✗              |
 * | Unpublish   | ✓ if published| ✗            | ✓ if published    | ✗              |
 * | Public      | ✓ if published| ✗            | ✓ if published    | ✗              |
 * | Archive     | ✓             | ✗            | ✓                 | ✗              |
 * | Version     | ✓             | ✓            | ✓                 | ✗              |
 * | Top Pick    | ✗             | ✗            | ✓ if published    | ✗              |
 * | Likes       | ✓             | ✓            | ✓                 | ✓              |
 * | Share       | ✓             | ✓            | ✓                 | ✓              |
 * | Admin badge | ✗             | ✗            | ✓                 | ✗              |
 * @param root0
 * @param root0.scene
 * @param root0.canEdit
 * @param root0.isOwner
 * @param root0.onSceneUpdate
 */
export const OverviewActionBar = ({scene, canEdit, isOwner, onSceneUpdate}: OverviewActionBarProps) => {
    const navigate = useNavigate();
    const {isAdmin, isAuthorized, setDbUser, handleGetLikedGames} = useAuthorizationContext();
    const {setShouldRefreshDashboard} = useHomepageContext();
    const {openSceneHistoryModal} = useAppGlobalContext();
    const publishMutation = usePublishScene();
    const unpublishMutation = useUnpublishScene();
    const {data: templateIds = [], isLoading: isLoadingTemplateIds} = useTemplateIds();
    const {mutateAsync: saveTemplateIds, isPending: isSavingTemplateIds} = useSetTemplateIds();

    const [isPublic, setIsPublic] = useState(!!scene.IsPublic);
    const [isPublished, setIsPublished] = useState(!!scene.IsPublished);
    const [isTopPick, setIsTopPick] = useState(!!scene.IsTopPick);
    const [loadingAction, setLoadingAction] = useState<string | null>(null);
    const [isOffScreen, setIsOffScreen] = useState(false);
    const barRef = useRef<HTMLDivElement>(null);
    const [fixedBarStyle, setFixedBarStyle] = useState<React.CSSProperties>({});
    const isPlayground = isPlaygroundMode();
    const isOwnerOrAdmin = isOwner || isAdmin;
    const isTemplate = templateIds.includes(scene.ID);
    const canMarkAsTemplate = isPublished && isPublic && scene.IsCloneable === true;
    // A scene is playable whenever it is published — and owners can always
    // launch their own games (including unpublished drafts) so they can
    // preview changes before publishing. IsPublic gates whether the scene's
    // contents can be inspected in read-only mode, not whether the game can
    // be launched — see DOT-7545.
    const isPlayable = isPublished || isOwner;

    const applyScenePatch = useCallback(
        (patch: Partial<FileData>) => {
            const updatedScene = {...scene, ...patch};
            if (patch.IsPublished !== undefined) {
                setIsPublished(!!patch.IsPublished);
            }
            if (patch.IsPublic !== undefined) {
                setIsPublic(!!patch.IsPublic);
            }
            if (patch.IsTopPick !== undefined) {
                setIsTopPick(!!patch.IsTopPick);
            }
            onSceneUpdate(updatedScene);
        },
        [onSceneUpdate, scene],
    );

    useEffect(() => {
        const el = barRef.current;
        if (!el) return;

        // Find the scrollable ancestor (RightSideContainer uses overflow-y: auto)
        let scrollParent: HTMLElement | null = el.parentElement;
        while (scrollParent) {
            const overflow = getComputedStyle(scrollParent).overflowY;
            if (overflow === "auto" || overflow === "scroll") break;
            scrollParent = scrollParent.parentElement;
        }

        const observer = new IntersectionObserver(
            (entries) => setIsOffScreen(!entries[0]?.isIntersecting),
            {root: scrollParent, threshold: 0},
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    useLayoutEffect(() => {
        const el = barRef.current;
        if (!el || !isOffScreen) return;

        const updateFixedBarPosition = () => {
            const rect = el.getBoundingClientRect();
            if (!rect.width) return;

            setFixedBarStyle({
                left: `${rect.left}px`,
                width: `${rect.width}px`,
                bottom: "0px",
            });
        };

        updateFixedBarPosition();

        const resizeObserver = new ResizeObserver(() => updateFixedBarPosition());
        resizeObserver.observe(el);
        window.addEventListener("resize", updateFixedBarPosition);

        return () => {
            resizeObserver.disconnect();
            window.removeEventListener("resize", updateFixedBarPosition);
        };
    }, [isOffScreen]);

    useEffect(() => {
        setIsPublic(!!scene.IsPublic);
        setIsPublished(!!scene.IsPublished);
        setIsTopPick(!!scene.IsTopPick);
    }, [scene.IsPublic, scene.IsPublished, scene.IsTopPick]);

    // Keep a stable ref to the patch callback so the subscription below
    // does not thrash on every render (applyScenePatch is re-created every
    // time the `scene` prop changes, and `onSceneUpdate` is a new arrow
    // function on each parent render).
    const applyScenePatchRef = useRef(applyScenePatch);
    useEffect(() => {
        applyScenePatchRef.current = applyScenePatch;
    }, [applyScenePatch]);

    // Sync publish state when another surface (e.g. SceneRevisionsModal) publishes or unpublishes this scene.
    useEffect(() => {
        const app = global.app;
        if (!app) return;
        const sceneId = scene.ID;
        app.on("scenePublishStateUpdated.OverviewActionBar", (data: ScenePublishStateUpdatedPayload) => {
            if (!data?.sceneId || data.sceneId !== sceneId) return;
            applyScenePatchRef.current({
                IsPublished: data.isPublished,
                IsPublic: data.isPublic,
                publishRevisionId: data.publishRevisionId ?? "",
            });
        });
        return () => {
            app.on("scenePublishStateUpdated.OverviewActionBar", null);
        };
    }, [scene.ID]);

    const handlePlay = () => {
        trackProductEvent(PRODUCT_ANALYTICS_EVENTS.GAME_PLAY_CLICKED, {
            scene_id: scene.ID,
            source: "game_overview",
        });
        if (!isAuthorized) {
            redirectToLogin(navigate, `/play/${scene.ID}`, "game_overview_play");
            return;
        }
        window.open(getGameUrl(scene.ID, ""), "_blank");
    };

    // DOT-7545 Gap #3: non-owners of an IsPublic scene land in read-only
    // inspection mode. Owners, collaborators and admins always open with
    // full edit access (canEdit is already gated upstream).
    const canOpenReadOnly = !canEdit && !!isPublic && isAuthorized;

    const handleEdit = () => {
        const isPhone = window.matchMedia("(max-width: 480px)").matches
            || window.matchMedia("(max-height: 480px) and (orientation: landscape)").matches;

        if (isPhone) {
            screen.orientation?.lock?.("landscape").catch(() => {});
            showToast({type: "info", title: "The editor works best on tablets and desktop devices."});
        }

        prepareEditCurrentGameCopilotEntry(scene);
        openEditorRoute(generateProjectLink(scene.ID, {readOnly: canOpenReadOnly}));
    };

    const handleUnpublish = async () => {
        setLoadingAction("unpublish");
        try {
            await unpublishMutation.mutateAsync({sceneId: scene.ID, sceneAssetId: scene.AssetID ?? undefined});
            applyScenePatch({IsPublished: false, IsPublic: false, publishRevisionId: ""});
            setShouldRefreshDashboard(true);
            showToast({type: "success", title: "Game unpublished"});
        } catch {
            showToast({type: "error", title: "Failed to unpublish"});
        } finally {
            setLoadingAction(null);
        }
    };

    const handlePublish = async () => {
        setLoadingAction("publish");
        try {
            const headScene = await getScene(scene.ID, {revision: "head"});
            const headRevisionId = headScene.asset?.revision?.id;

            if (!headRevisionId) {
                showToast({type: "error", title: "Cannot publish: no revision available."});
                return;
            }

            const publishedScene = await publishMutation.mutateAsync({
                sceneId: scene.ID,
                revisionId: headRevisionId,
                sceneAssetId: scene.AssetID ?? headScene.asset?.id ?? undefined,
                options: {isPublic},
            });
            applyScenePatch({
                IsPublished: true,
                IsPublic: publishedScene.isPublic,
                publishRevisionId: publishedScene.publishRevisionId ?? headRevisionId,
            });
            setShouldRefreshDashboard(true);
            showToast({type: "success", title: "Game published"});
        } catch (error) {
            showToast({
                type: "error",
                title: "Failed to publish",
                body: error instanceof Error ? error.message : "Please try again.",
            });
        } finally {
            setLoadingAction(null);
        }
    };

    const handleTogglePublic = () => {
        if (!isPublished) return;
        const newValue = !isPublic;
        setLoadingAction("visibility");
        void Ajax.post({
            url: backendUrlFromPath(`/api/Scene/Edit`),
            data: {
                Name: scene.Name,
                ID: scene.ID,
                IsPublic: newValue,
            },
            msgBodyType: "multipart",
        })
            .then(response => {
                if (response?.data.Code === 200) {
                    applyScenePatch({IsPublic: newValue});
                    setShouldRefreshDashboard(true);
                } else {
                    showToast({type: "error", body: response?.data.Msg});
                }
            })
            .finally(() => setLoadingAction(null));
    };

    const handleLike = async (e: React.MouseEvent) => {
        e.stopPropagation();
        trackProductEvent(PRODUCT_ANALYTICS_EVENTS.GAME_LIKE_CLICKED, {
            scene_id: scene.ID,
            source: "game_overview",
        });
        if (!isAuthorized) {
            redirectToLogin(navigate, undefined, "game_overview_like");
            return;
        }
        setLoadingAction("like");
        const res = await addLikedGame(scene.ID, setDbUser, () =>
            navigate(ROUTES.LOGIN, {state: {from: location.pathname}}),
        );
        await handleGetLikedGames();
        if (res) {
            onSceneUpdate({...scene, Likes: res.likes});
            setShouldRefreshDashboard(true);
        }
        setLoadingAction(null);
    };

    const handleShare = () => {
        trackProductEvent(PRODUCT_ANALYTICS_EVENTS.GAME_SHARE_CLICKED, {
            scene_id: scene.ID,
            source: "game_overview",
        });
        if (!isAuthorized) {
            redirectToLogin(navigate, undefined, "game_overview_share");
            return;
        }
        if (!isPublished) {
            showToast({type: "error", title: "Publish your game first to share a play link"});
            return;
        }

        const gameUrl = getGameUrl(scene.ID, "");
        void createTrackedShareUrl(scene.ID, gameUrl, {creatorUserId: scene.UserID, channel: "dashboard_overview"})
            .then(url => navigator.clipboard.writeText(url))
            .then(
                () => showToast({type: "success", title: "Copied to clipboard!"}),
                () => showToast({type: "error", title: "Failed to copy link"}),
            );
    };

    const handleArchive = () => {
        setLoadingAction("archive");
        void Ajax.post({
            url: backendUrlFromPath(`/api/Scene/Delete?ID=${scene.ID}`),
        })
            .then(response => {
                const obj = response?.data;
                if (obj.Code === 200) {
                    applyScenePatch({IsArchived: true});
                    setShouldRefreshDashboard(true);
                    showToast({type: "success", title: "Game archived"});
                } else {
                    showToast({type: "error", body: obj.Msg});
                }
            })
            .finally(() => setLoadingAction(null));
    };

    const handleUnarchive = () => {
        setLoadingAction("unarchive");
        void Ajax.post({
            url: backendUrlFromPath(`/api/Scene/Unarchive`),
            data: {ID: scene.ID},
            msgBodyType: "multipart",
        })
            .then(response => {
                if (response?.data.Code === 200) {
                    applyScenePatch({IsArchived: false});
                    setShouldRefreshDashboard(true);
                    showToast({type: "success", title: "Game unarchived"});
                } else {
                    showToast({type: "error", body: response?.data.Msg});
                }
            })
            .finally(() => setLoadingAction(null));
    };

    const handleVersion = () => {
        openSceneHistoryModal({
            assetID: scene.AssetID ?? undefined,
            scene,
        });
    };

    // Admin-only top pick toggle. The server gates the IsTopPick field to
    // admins in SceneService.UpdateScene, so non-admin callers would get a
    // silent drop — we hide the button entirely instead of relying on that.
    const handleToggleTopPick = async () => {
        const newValue = !isTopPick;
        setLoadingAction("topPick");
        try {
            await updateScene(scene.ID, {isTopPick: newValue});
            applyScenePatch({IsTopPick: newValue});
            setShouldRefreshDashboard(true);
            showToast({type: "success", title: newValue ? "Marked as top pick" : "Removed from top picks"});
        } catch {
            showToast({type: "error", title: "Failed to update top pick"});
        } finally {
            setLoadingAction(null);
        }
    };

    const handleMakeTemplate = async () => {
        if (!isAdmin) return;
        if (!isTemplate && !canMarkAsTemplate) {
            showToast({type: "error", title: "Publish your game, make it public, and enable cloning first"});
            return;
        }

        setLoadingAction("template");
        try {
            const nextTemplateIds = isTemplate
                ? templateIds.filter(templateId => templateId !== scene.ID)
                : Array.from(new Set([...templateIds, scene.ID]));
            await saveTemplateIds(nextTemplateIds);
            setShouldRefreshDashboard(true);
            showToast({type: "success", title: isTemplate ? "Game removed from templates" : "Game marked as a template"});
        } catch (error) {
            showToast({
                type: "error",
                title: error instanceof Error ? error.message : "Failed to update template status",
            });
        } finally {
            setLoadingAction(null);
        }
    };

    const renderButtons = () => (
        <>
            {(canEdit || canOpenReadOnly) && !scene.IsArchived && (
                <ActionButton $variant="secondary" customIcon={editIcon} onClick={handleEdit}>
                    {canEdit ? "Edit" : "Inspect"}
                </ActionButton>
            )}
            {isPlayable && !isPlayground && (
                <ActionButton
                    $variant="primary"
                    customIcon={playIcon}
                    onClick={handlePlay}
                    data-testid="overview-play"
                >
                    Play
                </ActionButton>
            )}
            {isOwnerOrAdmin &&
                (scene.IsArchived ? (
                    <ActionButton
                        $variant="secondary"
                        customIcon={archiveIcon}
                        onClick={handleUnarchive}
                        disabled={loadingAction === "unarchive"}
                    >
                        Unarchive
                    </ActionButton>
                ) : (
                    <ActionButton
                        $variant="secondary"
                        customIcon={archiveIcon}
                        onClick={handleArchive}
                        disabled={loadingAction === "archive"}
                    >
                        Archive
                    </ActionButton>
                ))}
            {canEdit && (
                <ActionButton
                    $variant="secondary"
                    customIcon={versionIcon}
                    onClick={handleVersion}
                >
                    Version
                </ActionButton>
            )}
            {isAdmin && isPublished && (
                <ActionButton
                    $variant={isTopPick ? "primary" : "secondary"}
                    customIcon={topPickIcon}
                    onClick={() => void handleToggleTopPick()}
                    disabled={loadingAction === "topPick"}
                >
                    {loadingAction === "topPick" ? (
                        <ClipLoader loading size={14} color="#fff" />
                    ) : (
                        <>{isTopPick ? "Top Pick" : "Mark Top Pick"}</>
                    )}
                </ActionButton>
            )}
            {isAdmin && (
                <ActionButton
                    $variant={isTemplate ? "secondary" : "primary"}
                    customIcon={isTemplate ? checkedIcon : undefined}
                    onClick={() => void handleMakeTemplate()}
                    disabled={
                        isLoadingTemplateIds ||
                        isSavingTemplateIds ||
                        loadingAction === "template" ||
                        (!isTemplate && !canMarkAsTemplate)
                    }
                >
                    {loadingAction === "template" ? (
                        <ClipLoader loading size={14} color={isTemplate ? "#0284c7" : "#fff"} />
                    ) : (
                        <>{isTemplate ? "Template" : "Make Template"}</>
                    )}
                </ActionButton>
            )}
            {!isPlayground && (
                <>
                    <ActionButton
                        $variant="secondary"
                        customIcon={heartOutlineIcon}
                        onClick={e => void handleLike(e)}
                        disabled={loadingAction === "like"}
                    >
                        {loadingAction === "like" ? (
                            <ClipLoader loading size={14} color="#0284c7" />
                        ) : (
                            scene.Likes ?? 0
                        )}
                    </ActionButton>
                    <ActionButton $variant="secondary" className="shareActionButton" onClick={handleShare}>
                        <RxShare2 size={16} aria-hidden="true" focusable="false" />
                        {scene.ShareCount ?? 0}
                    </ActionButton>
                </>
            )}
            {isAdmin && !isOwner && (
                <AdminBadge>
                    <img src={adminBadgeIcon} alt="admin" />
                    Admin Mode
                </AdminBadge>
            )}
        </>
    );

    return (
        <>
            <ActionBar ref={barRef}>
                {renderButtons()}
            </ActionBar>
            {isOffScreen && <FixedActionBar style={fixedBarStyle}>{renderButtons()}</FixedActionBar>}
        </>
    );
};
