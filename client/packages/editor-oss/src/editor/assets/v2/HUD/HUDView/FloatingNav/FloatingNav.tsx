import {useEffect, useRef} from "react";
import {useTranslation} from "react-i18next";
import {useNavigate} from "react-router-dom";
import {toast} from "toastywave";

import {AppVersion} from "./AppVersion/AppVersion";
import {StyledNav, LeftSide, EditorButton, Middle, Right, MenuButton} from "./FloatingNav.style";
import {createTrackedShareUrl} from "@stem/network/api/rewards";
import EventBus from "../../../../../../behaviors/event/EventBus";
import {useAppGlobalContext} from "@stem/editor-oss/context";
import EngineRuntime, {ApplicationMode} from "@stem/editor-oss/EngineRuntime";
import global from "@stem/editor-oss/global";
import {useFullscreen} from "@stem/editor-oss/hooks/useFullscreen";
import {ROUTES} from "@web-shared/routes";
import {IFRAME_MESSAGES} from "@stem/editor-oss/types/editor";
import {getGameUrl, syncPlaygroundSceneRoute} from "../../../../../../v2/pages/links";
import {Section} from "../../../common/Section";
import {TopMenu} from "../../../RightPanel/common/TopMenu/TopMenu";
import {SceneName} from "../../../TopNav/SceneName";
import arrowLeftIcon from "../icons/arrow-left.svg";
import arrowUp from "../icons/arrow-up-tray.svg";

interface Props {
    setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
    isPlaying: boolean;
}

export const FloatingNav = ({setIsPlaying, isPlaying}: Props) => {
    const {t} = useTranslation();
    const app = global.app as EngineRuntime;
    const navRef = useRef<HTMLElement | null>(null);
    const navigate = useNavigate();
    const {slug} = useAppGlobalContext();
    const {exitFullscreen} = useFullscreen();

    const isSandbox = !!app.editor?.isSandbox;

    useEffect(() => {
        app?.registerViewportSafeAreaElement("editor-floating-nav", navRef.current);
        return () => {
            app?.registerViewportSafeAreaElement("editor-floating-nav", null);
        };
    }, [app]);

    const handleGameClose = () => {
        setIsPlaying(false);
    };

    const stopPlayingSession = async () => {
        if (app.isModeTransitioning || (!isPlaying && !app.isPlaying && app.mode !== ApplicationMode.PLAY)) return;
        const syncEditRoute = () => syncPlaygroundSceneRoute(app.editor?.sceneID, app.editor?.sceneName, "edit");
        // Publish the edit route before progressive teardown so refresh cannot
        // replay the stale `/play` URL while the stop promise is draining.
        syncEditRoute();
        exitFullscreen();
        await app.setMode(ApplicationMode.EDIT);
        handleGameClose();
        EventBus.instance.send("game.stop");
        // setMode emits playerStopped while the floating nav is still mounted.
        // Sync after the stop notification and once more on the next frame so
        // any lifecycle listener cannot restore the stale `/play` URL.
        syncEditRoute();
        requestAnimationFrame(syncEditRoute);
    };

    const handleStop = (e?: any) => {
        e?.preventDefault();
        void stopPlayingSession();
    };

    const handleOpenGamesLibrary = async () => {
        if (isPlaying) {
            await stopPlayingSession();
        }

        try {
            await app.editor?.checkForUnsavedChanges(t("All unsaved data will be lost. Are you sure?"));
        } catch {
            return;
        }

        void navigate(ROUTES.DASHBOARD);
    };

    useEffect(() => {
        const handleMessage = (event: any) => {
            const message = event.data;
            if (message === IFRAME_MESSAGES.GAME_CLOSED) {
                handleGameClose();
            } else if (message === IFRAME_MESSAGES.GAME_STARTED || message === IFRAME_MESSAGES.GAME_RESUMED) {
                // Game started/resumed - playcoin granting removed
            } else if (message === IFRAME_MESSAGES.GAME_PAUSED || message === IFRAME_MESSAGES.GAME_ENDED) {
                // Game paused/ended - playcoin granting removed
            } else if (message === IFRAME_MESSAGES.GAME_PLAYER_ERROR) {
                handleGameClose();
                toast.error(t("Failed to find player object. Check your settings"));
            } else if (message === IFRAME_MESSAGES.GAME_MULTIPLAYER_ERROR) {
                handleGameClose();
                toast.error(t("Multiplayer server failed."));
            }
        };

        window.addEventListener("message", handleMessage);

        return () => {
            window.removeEventListener("message", handleMessage);
        };
    }, []);

    const copyURL = () => {
        if (!app.editor) return;
        let url;
        if (app.editor.isPublished && app.editor.sceneID) {
            url = getGameUrl(app.editor.sceneID, slug) || window.location.href;
        } else {
            url = window.location.href;
        }
        void createTrackedShareUrl(app.editor.sceneID || "", url, {
            creatorUserId: app.editor.projectUserId,
            channel: "floating_nav",
        })
            .then(trackedUrl => navigator.clipboard.writeText(trackedUrl))
            .then(() => toast.success(t("URL copied to clipboard!")))
            .catch(() => toast.error(t("Failed to copy link")));
    };

    return (
        <>
            <StyledNav ref={navRef} data-stem-host-chrome="true">
                <LeftSide>
                    <Section $gap="4px"
                        $direction="row"
                        $width="100%"
                        $align="center"
                    >
                        <MenuButton>
                            <img
                                style={{cursor: "pointer"}}
                                src={arrowLeftIcon}
                                alt={t("Go back")}
                                onClick={isSandbox ? handleOpenGamesLibrary : handleStop}
                                className="go-back-icon icon"
                            />
                        </MenuButton>
                        <SceneName />
                        <MenuButton>
                            <img
                                style={{cursor: "pointer"}}
                                src={arrowUp}
                                alt={t("Copy scene URL")}
                                onClick={copyURL}
                                className="go-back-icon icon"
                            />
                        </MenuButton>
                    </Section>
                </LeftSide>
                <Middle>
                    <EditorButton $isBlue={isPlaying}>{t("Play")}</EditorButton>
                    <EditorButton
                        $isBlue={!isPlaying}
                        title={t("Edit this game")}
                        aria-disabled={app.isModeTransitioning}
                        onClick={handleStop}
                        data-testid="topnav-edit"
                    >
                        {t("Edit")}
                    </EditorButton>
                </Middle>
                <Right>
                    <TopMenu inGameUI />
                </Right>
            </StyledNav>
            <AppVersion />
        </>
    );
};
