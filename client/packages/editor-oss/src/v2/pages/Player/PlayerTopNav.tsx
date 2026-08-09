import {useEffect, useRef} from "react";

import {createTrackedShareUrl} from "@stem/network/api/rewards";
import type {GetSceneResponse} from "@stem/network/api/scene/v2";
import {ROUTES} from "@web-shared/routes";
import {showToast} from "../../../showToast";
import type EngineRuntime from "@stem/editor-oss/EngineRuntime";
import global from "@stem/editor-oss/global";
import {openEditorRoute} from "../editorHandoff";
import {generateProjectLink, getGameUrl} from "../links";
import {
    IconButton,
    LeftSide,
    Middle,
    NavButton,
    SceneNameWrapper,
    StyledNav,
} from "./PlayerTopNav.style";

interface PlayerTopNavProps {
    scene: GetSceneResponse | null;
    /** Database id of the viewer; null/empty for anonymous viewers. */
    viewerId: string | null | undefined;
}

export const PlayerTopNav = ({scene, viewerId}: PlayerTopNavProps) => {
    const navRef = useRef<HTMLElement | null>(null);
    const sceneName = scene?.name ?? "";
    const sceneId = scene?.id ?? "";
    // Local projects are editable by the current user. `viewerId` remains part
    // of the component API for compatibility with hosted forks.
    void viewerId;
    const canEdit = !!scene;

    useEffect(() => {
        const runtime = global.app as EngineRuntime | undefined;
        runtime?.registerViewportSafeAreaElement("player-top-nav", navRef.current);
        return () => {
            runtime?.registerViewportSafeAreaElement("player-top-nav", null);
        };
    }, []);

    const handleBack = () => {
        window.location.href = ROUTES.DASHBOARD;
    };

    const handleEditClick = () => {
        if (!sceneId) return;
        openEditorRoute(generateProjectLink(sceneId));
    };

    const handleShare = async () => {
        if (!sceneId) return;

        try {
            const baseUrl = getGameUrl(sceneId, scene?.alias || null) || window.location.href;
            const shareUrl = scene?.isPublished
                ? await createTrackedShareUrl(sceneId, baseUrl, {
                    creatorUserId: scene.userId,
                    channel: "player_top_bar",
                })
                : baseUrl;
            await navigator.clipboard.writeText(shareUrl);
            showToast({type: "success", title: "Share link copied"});
        } catch {
            showToast({type: "error", title: "Failed to copy share link"});
        }
    };

    return (
        <>
            <StyledNav ref={navRef} data-stem-host-chrome="true">
                <LeftSide>
                    <IconButton
                        type="button"
                        title="Back to dashboard"
                        aria-label="Back to dashboard"
                        onClick={handleBack}
                    >
                        <BackIcon />
                    </IconButton>
                    <SceneNameWrapper title={sceneName}>{sceneName}</SceneNameWrapper>
                </LeftSide>
                <Middle>
                    <NavButton $active title="You're playing this game">
                        Play
                    </NavButton>
                    <NavButton
                        disabled={!sceneId}
                        onClick={() => void handleShare()}
                        title="Copy share link"
                    >
                        Share
                    </NavButton>
                    {canEdit && (
                        <NavButton onClick={handleEditClick} title="Edit this game">
                            Edit
                        </NavButton>
                    )}
                </Middle>
            </StyledNav>
        </>
    );
};

const BackIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path
            d="M15 18l-6-6 6-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </svg>
);
