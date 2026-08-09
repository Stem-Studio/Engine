import {useEffect, useState} from "react";
import styled from "styled-components";
import * as THREE from "three";

import {AiAgentChat} from "./AiAgentChat/AiAgentChat";
import {FloatingNavGuestView} from "./FloatingNav/FloatingNavGuestView";
import {GameHUDView} from "./GameHUDView/GameHUDView";
import {PerformanceOverlay} from "./PerformanceOverlay/PerformanceOverlay";
import {getZIndexWithinHUD, HUD_Z_INDEX} from "./services";
import {InGameData} from "./types";
import {FTUEProvider} from "@stem/editor-oss/context/FTUEContext";
import {HUD_TABS} from "../HUDEditView/types";
import {GameStartView} from "./GameStartView/GameStartView";
import {InGameView} from "./InGameView/InGameView";
import {InGameLogin} from "../../../../../ui/common/InGameLogin/InGameLogin";
import {ActionBar} from "../../ActionBar/ActionBar";
import {CreateMenu} from "./SandboxMenus/CreateMenu/CreateMenu";
import {SelectedMenu} from "./SandboxMenus/SelectedMenu/SelectedMenu";
import EventBus from "../../../../../behaviors/event/EventBus";
import GameManager from "../../../../../behaviors/game/GameManager";
import EngineRuntime, {ApplicationMode} from "@stem/editor-oss/EngineRuntime";
import global from "@stem/editor-oss/global";
import {PlaymodeInspector} from "../../../../../playmode-inspector/ui/PlaymodeInspector";
import {Grid} from "../HUDEditView/GameStartMenu/GameStartMenu.style";

export enum HUD_ITEM {
    MENU = "menu",
    MAP = "map",
    INVENTORY = "inventory",
}

type Props = {
    emptyHUD: boolean;
};
export const HUDView = ({emptyHUD}: Props) => {
    const app = global.app as EngineRuntime;
    const agents = app?.game?.aiConversationManager?.aiAgents;
    const [showChat, setShowChat] = useState<boolean>(
        !!agents?.find((el: any) => el.behavior.attributes.show_text_chat),
    );
    const [loginRequested, setLoginRequested] = useState(false);
    const [loginReminderRequested, setLoginReminderRequested] = useState(false);
    const [isGuest, setIsGuest] = useState(false);

    const [view, setView] = useState<HUD_TABS | null>(HUD_TABS.GAME_START_MENU);
    const [noPauseMenu, setNoPauseMenu] = useState<boolean>(false);
    const [hudOpenedItem] = useState<HUD_ITEM | null>(null);
    const [bgImage, setBgImage] = useState<string>();
    const [selectedObj, setSelectedObj] = useState<THREE.Object3D | THREE.Object3D[] | null>(null);
    const [playmodeInspectorVisible, setPlaymodeInspectorVisible] = useState(false);
    const [gameData, setGameData] = useState<InGameData>({
        score: 0,
        maxScore: 0,
        health: 100,
        initialHealth: 100,
        currentLives: 0,
        totalLives: 0,
        isWinner: false,
        timeRemaining: "00:00:00",
        playerWeapons: [],
        pickedWeaponOrItem: undefined,
    });

    const handleShowChat = () => {
        const agents = app?.game?.aiConversationManager?.aiAgents;
        const showChat = !!agents?.find((el: any) => el.behavior.attributes.show_text_chat);
        setShowChat(showChat);
    };
    useEffect(() => {
        const update = (game: GameManager) => {
            const score = game.score;
            const currentLives = game.lives;
            setGameData(prev => ({
                score,
                currentLives,
                totalLives: prev.totalLives,
                health: game.health,
                initialHealth: prev.initialHealth,
                maxScore: prev.maxScore,
                isWinner: game.isWinner(),
                timeRemaining: prev.timeRemaining,
                playerWeapons: game.playerWeapons,
                pickedWeaponOrItem: game.pickedWeaponOrItem,
            }));
        };
        app?.on("gameUpdated.HUDView", update);
        return () => {
            app?.on("gameUpdated.HUDView", null);
        };
    }, []);

    useEffect(() => {
        const setGameDataValues = (game: GameManager) => {
            const score = game.score;
            const maxScore = game.maxScore;
            const currentLives = game.lives;
            const totalLives = game.initialLives;
            const initialHealth = game.initialHealth;
            const health = game.health;
            const isWinner = game.isWinner();
            const timeRemaining = game.time_remaining || "00:00:00";
            const playerWeapons = game.playerWeapons;
            const pickedWeaponOrItem = game.pickedWeaponOrItem;
            setGameData({
                score,
                maxScore,
                health,
                initialHealth,
                currentLives,
                totalLives,
                isWinner,
                timeRemaining,
                playerWeapons,
                pickedWeaponOrItem,
            });
        };
        app?.on("gameCreated.HUDView", (game: GameManager) => {
            setGameDataValues(game);
            handleShowChat();
        });
        app?.on("gameStarted.HUDView", (game: GameManager) => {
            handleShowChat();
            setGameDataValues(game);
            setView(null);
        });
        app?.on("gameTimerUpdate.HUDView", setGameDataValues);
        app?.on("gameLogin_requested.HUDView", () => setLoginRequested(true));
        app?.on("gameLogin_quit.HUDView", () => {
            setLoginRequested(false);
            setLoginReminderRequested(false);
        });
        app?.on("gameLogin_showReminder.HUDView", () => setLoginReminderRequested(true));
        return () => {
            app?.on("gameCreated.HUDView", null);
            app?.on("gameStarted.HUDView", null);
            app?.on("gameTimerUpdate.HUDView", null);
            app?.on("gameLogin_requested.HUDView", null);
            app?.on("gameLogin_quit.HUDView", null);
            app?.on("gameLogin_showReminder.HUDView", null);
        };
    }, []);

    useEffect(() => {
        const handleKeyDown = (event: any) => {
            if (event.key === "Escape") {
                if (!noPauseMenu) {
                    // Show the pause menu ONLY when HUD is enabled,
                    EventBus.instance.send("game.pause");
                    setView(HUD_TABS.IN_GAME_MENU);
                }
            }
        };

        if (!app?.editor?.isSandbox) {
            window.addEventListener("keydown", handleKeyDown);
        }
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [setView, noPauseMenu, app?.game]);

    useEffect(() => {
        const restart = (game: GameManager) => {
            if (game?.isGameOver()) {
                setView(HUD_TABS.GAME_HUD);
                setTimeout(() => {
                    setView(HUD_TABS.GAME_START_MENU);
                }, 5000);
                return;
            }

            if (!noPauseMenu) {
                setView(HUD_TABS.IN_GAME_MENU);
            } else {
                EventBus.instance.send("game.resume");
            }
        };
        const lockState = () => {
            setView(null);
        };
        app?.on("pauseGame.HUDView", restart);
        app?.on("lockEvent.HUDView", lockState);

        return () => {
            app?.on("pauseGame.HUDView", null);
            app?.on("lockEvent.HUDView", null);
        };
    }, [noPauseMenu]);

    useEffect(() => {
        if (view === null) {
            app?.call(`playingGame`);
        } else {
            app?.call(`stoppedPlayingGame`);
        }
    }, [view]);

    useEffect(() => {
        app.isGameMenuOpen = !!hudOpenedItem;
    }, [hudOpenedItem]);

    useEffect(() => {
        if (emptyHUD || app?.editor?.isSandbox || !app?.editor?.showHUD) {
            setNoPauseMenu(true);
            setView(null);
            setTimeout(() => {
                EventBus.instance.send("game.start");
                EventBus.instance.send("game.clear_sounds");
            }, 500);

            // Fullscreen disabled for mobile devices to prevent iOS notification
            // const deviceType = DetectDevice.getDeviceType();
            // if (deviceType === (DEVICE_TYPES.MOBILE as string)) {
            //     openFullScreen();
            // }
        }
    }, [emptyHUD, app?.editor?.isSandbox, app?.editor?.showHUD]);

    useEffect(() => {
        app?.on("gameStarted.HUDView", () => {
            const params = new URLSearchParams(window.location.search);
            const isFTUE = params.get("ftue") === "true";
            if (isFTUE) {
                setView(null);
            }
        });
        return () => {
            app?.on("gameStarted.HUDView", null);
        };
    }, [app, window.location.search]);

    useEffect(() => {
        const handleSelect = () => {
            const selected = app?.editor?.selected;
            setSelectedObj(selected || null);
        };

        app?.on("objectArraySelected.HUDView", handleSelect);
        app?.on("objectSelected.HUDView", () => {
            handleSelect();
            handleShowChat();
        });
        app?.on("objectChanged.HUDView", () => {
            handleSelect();
            handleShowChat();
        });
        app?.on("sceneUpdated.HUDView", handleShowChat);
        app?.on("agentRegistered.HUDView", handleShowChat);
        app?.on("agentUnregistered.HUDView", handleShowChat);
        return () => {
            app?.on("objectSelected.HUDView", null);
            app?.on("objectArraySelected.HUDView", null);
            app?.on("objectChanged.HUDView", null);
            app?.on("sceneUpdated.HUDView", null);
            app?.on("agentRegistered.HUDView", null);
            app?.on("agentUnregistered.HUDView", null);
        };
    }, []);

    useEffect(() => {
        app?.on("playmodeInspectorToggled.HUDView", (visible: boolean) => {
            setPlaymodeInspectorVisible(visible);
        });
        return () => {
            app?.on("playmodeInspectorToggled.HUDView", null);
        };
    }, [app]);

    const preventDefaults = (e: any) => {
        e.preventDefault();
        e.stopPropagation();
        return false;
    };

    useEffect(() => {
        if (app?.editor?.sceneName) {
            document.title = app?.editor?.sceneName;
        }
        if (app?.isPlaying) {
            document.addEventListener("contextmenu", preventDefaults, {passive: false});
            //document.body.classList.add('no-interaction');
        } else {
            document.removeEventListener("contextmenu", preventDefaults);
            //document.body.classList.remove('no-interaction');
        }

        return () => {
            document.removeEventListener("contextmenu", preventDefaults);
            //document.body.classList.remove('no-interaction');
        };
    }, [app?.isPlaying]);

    useEffect(() => {
        if (app?.editor?.sceneName) {
            document.title = app?.editor?.sceneName;
        }
    }, [app]);

    useEffect(() => {
        if (!isGuest) return;

        const timeoutId = setTimeout(
            () => {
                app.call("gameLogin_showReminder");
            },
            10 * 60 * 1000,
        ); // 10min in ms

        return () => clearTimeout(timeoutId);
    }, [isGuest]);

    const cleanupLoginPopup = () => {
        setLoginRequested(false);
        setLoginReminderRequested(false);
    };

    return (
        <FTUEProvider>
            {app?.editor?.showHUD &&
                <Wrapper
                    $grid={view === HUD_TABS.GAME_START_MENU || view === HUD_TABS.IN_GAME_MENU}
                    $bgImg={
                        !emptyHUD && view !== HUD_TABS.GAME_HUD && view !== null && !noPauseMenu ? bgImage : undefined
                    }
                    $bgColor={!emptyHUD && view !== null && !noPauseMenu}
                    $disableClick={view === HUD_TABS.GAME_HUD}
                    id="hud-wrapper"
                >
                    {app?.canSetMode(ApplicationMode.PLAY) && !app?.userId && <FloatingNavGuestView />}
                    {view === HUD_TABS.GAME_START_MENU &&
                        <GameStartView setView={setView}
                            setBgImage={setBgImage}
                            emptyHUD={emptyHUD}
                        />
                    }
                    {view === HUD_TABS.IN_GAME_MENU && !noPauseMenu &&
                        <InGameView setView={setView}
                            setBgImage={setBgImage}
                            emptyHUD={emptyHUD}
                        />
                    }

                    {(view === null || view === HUD_TABS.GAME_HUD) &&
                        <>
                            {showChat && <AiAgentChat />}
                            <GameHUDView
                                gameData={gameData}
                                isGameOver={view === HUD_TABS.GAME_HUD}
                                emptyHUD={emptyHUD}
                            />
                        </>
                    }
                </Wrapper>
            }

            {/* The performance monitor is an engine diagnostic, not authored
                game HUD. Keep it available in every Play session, including
                scenes that intentionally hide their HUD. It is collapsed by
                default and performs no polling until opened. */}
            <PerformanceOverlay />

            {(loginRequested || loginReminderRequested) &&
                <InGameLogin
                    isReminder={loginReminderRequested}
                    cleanupPopup={cleanupLoginPopup}
                    setIsGuest={setIsGuest}
                />
            }

            {app?.editor?.isSandbox && process.env.REACT_APP_FEATURE_FLAG_PLAY_MODE_MENU === "enabled" &&
                <>
                    <CreateMenu />
                    {selectedObj && !Array.isArray(selectedObj) && <SelectedMenu selectedObj={selectedObj} />}
                </>
            }

            {/* {!showChat && !isOtherExperience && view !== HUD_TABS.GAME_START_MENU && (
                <>
                    <Menu
                        setNoPauseMenu={setNoPauseMenu}
                        isOpen={hudOpenedItem === HUD_ITEM.MENU}
                        setIsOpen={setHudOpenedItem}
                    />
                    <Map isOpen={hudOpenedItem === HUD_ITEM.MAP} setIsOpen={setHudOpenedItem} />
                    <Inventory isOpen={hudOpenedItem === HUD_ITEM.INVENTORY} setIsOpen={setHudOpenedItem} />
                    <Playcoin />
                </>
            )} */}
            {app?.editor?.isSandbox && selectedObj && <ActionBar />}

            {!!(
                playmodeInspectorVisible ||
                app?.scene?.userData?.playmodeInspectorEnabled ||
                app?.editor?.scene?.userData?.playmodeInspectorEnabled
            ) && (
                <PlaymodeInspector />
            )}
        </FTUEProvider>
    );
};

const Wrapper = styled(Grid)<{
    $bgColor?: boolean;
    $grid?: boolean;
    $disableClick?: boolean;
}>`
    border-radius: 0;

    ${({$grid, $bgColor, $bgImg, $disableClick}) =>
        !$grid &&
        `

position: absolute;
top: 0;
left: 0;
right: 0;
bottom: 0;
padding-top: env(safe-area-inset-top, 24px);
padding-left: env(safe-area-inset-left, 10px);
padding-right: env(safe-area-inset-right, 10px);
padding-bottom: env(safe-area-inset-bottom, 0);
z-index: ${getZIndexWithinHUD(HUD_Z_INDEX.HUDBase, 10)};
box-sizing: border-box;
background-color: transparent;
pointer-events: none;
${$bgColor && `background-color: #000000bf;`}

${
    $bgImg &&
    `
background-image: url('${$bgImg}');
background-repeat: no-repeat;
background-size: cover;
background-position: center;
`
}

${($disableClick || !$bgImg) && `pointer-events: none;`}
`};
`;
