import {useEffect, useState} from "react";

import {GameDataType} from "@stem/editor-oss/context/HUDGameContext";
import global from "@stem/editor-oss/global";
import {isInputActive} from "../../../utils/isInputActive";
import {CustomBanner} from "../../HUDEditView/CustomBanner/CustomBanner";
import {CustomComponent} from "../../HUDEditView/CustomComponents/CustomComponents";
import {FTUE} from "../../HUDEditView/CustomComponents/FTUE/FTUE";
import {HelpComponent} from "../../HUDEditView/CustomComponents/Help/Help";
import {CustomMiniMap} from "../../HUDEditView/CustomMiniMap/CustomMiniMap";
import {CustomItemButton} from "../../HUDEditView/CutomItemButton/CustomItemButton";
import {ButtonsColumn, ButtonsRow, Grid} from "../../HUDEditView/GameHUD/GameHUD.style";
import {
    GAME_HUD_IDS,
    IBannerInterface,
    IComponentInterface,
    IItemButtonInterface,
    IMiniMapInterface,
    UI_ITEM_BUTTON_TYPES,
} from "../../HUDEditView/types";
import JoinRoom from "../JoinRoom";
import {InGameData} from "../types";

interface Props {
    gameData: InGameData;
    isGameOver: boolean;
    emptyHUD: boolean;
}

export const GameHUDView = ({gameData, isGameOver}: Props) => {
    const app = (global as any).app;

    const [gameUI, setGameUI] = useState<GameDataType>();
    const [weaponButtonsKeys, setWeaponButtonsKeys] = useState<(GAME_HUD_IDS | null)[]>();

    const scene = app.scene || app.editor?.scene;
    const editor = app.editor;

    useEffect(() => {
        if (scene?.userData?.gameUI?.gameHUD) {
            const data = scene.userData.gameUI.gameHUD as GameDataType;
            setGameUI(data);
        } else {
            setGameUI(undefined);
        }
    }, [scene]);

    useEffect(() => {
        if (gameUI) {
            setWeaponButtonsKeys(
                Array(5)
                    .fill(5)
                    .map((_, index) => {
                        const key = GAME_HUD_IDS[("ITEM_" + (index + 1)) as unknown as keyof typeof GAME_HUD_IDS];

                        const button = gameUI[key] as IItemButtonInterface;
                        if (button?.UITag === UI_ITEM_BUTTON_TYPES.WEAPON) {
                            return key;
                        } else {
                            return null;
                        }
                    })
                    .filter(key => key !== null),
            );
        }
    }, [gameUI]);

    useEffect(() => {
        const handleKeyDown = (e: any) => {
            let mode = null;

            switch (e.key) {
                case "1":
                    mode = "translate";
                    break;
                case "2":
                    mode = "rotate";
                    break;
                case "3":
                    mode = "scale";
                    break;
                default:
                    break;
            }

            if (mode && app?.editor && !isInputActive()) {
                app.call("changeMode", app.editor, mode);
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [app]);

    const canJoinRoom = editor?.isMultiplayer && editor?.roomId && editor.voiceChatEnabled;

    return (
        <>
            {gameUI ? 
                <Grid $fullWidth
                    style={{background: "transparent"}}
                >
                    {canJoinRoom && <JoinRoom roomId={editor.roomId} />}
                    {Array(3)
                        .fill(3)
                        .map((_, i) => {
                            const isCenter = i === 1;
                            const isRight = i === 2;
                            return (
                                <ButtonsColumn key={i}
                                    $isCenter={isCenter}
                                >
                                    {isCenter ? 
                                        <>
                                            <ButtonsRow $gap="66px"
                                                $isColumn
                                                style={{marginTop: "110px"}}
                                            >
                                                {isGameOver && 
                                                    <CustomBanner
                                                        customStyle={gameUI?.[GAME_HUD_IDS.BANNER] as IBannerInterface}
                                                        text={gameData.isWinner ? "You Won!" : "You Lose"}
                                                        width={"100%"}
                                                        height={"162px"}
                                                        id={(gameUI?.[GAME_HUD_IDS.BANNER] as string) || "game-hud-banner"}
                                                    />
                                                }
                                            </ButtonsRow>
                                        </>
                                     : 
                                        <>
                                            <ButtonsRow $gap="16px"
                                                $isColumn
                                            >
                                                {isRight && <FTUE width="240px"
                                                    height="205px"
                                                            />}
                                                {isRight && <HelpComponent />}
                                                {Array(2)
                                                    .fill(2)
                                                    .map((_, index) => {
                                                        const key =
                                                            i === 0
                                                                ? GAME_HUD_IDS[
                                                                      ("COMPONENT_LEFT_" +
                                                                          (index + 1)) as unknown as keyof typeof GAME_HUD_IDS
                                                                  ]
                                                                : GAME_HUD_IDS[
                                                                      ("COMPONENT_RIGHT_" +
                                                                          (index + 1)) as unknown as keyof typeof GAME_HUD_IDS
                                                                  ];
                                                        return (
                                                            <CustomComponent
                                                                customStyle={gameUI[key] as IComponentInterface}
                                                                width="100%"
                                                                maxWidth="285px"
                                                                height="27px"
                                                                gameData={gameData}
                                                                key={key}
                                                            />
                                                        );
                                                    })}
                                            </ButtonsRow>
                                            {isRight ? 
                                                <ButtonsRow $isWeapons>
                                                    {Array(5)
                                                        .fill(5)
                                                        .map((_, index) => {
                                                            const key =
                                                                GAME_HUD_IDS[
                                                                    ("ITEM_" +
                                                                        (index + 1)) as unknown as keyof typeof GAME_HUD_IDS
                                                                ];

                                                            return (
                                                                <CustomItemButton
                                                                    id={key}
                                                                    key={index}
                                                                    width="109px"
                                                                    height="109px"
                                                                    gameData={gameData}
                                                                    weaponIndex={
                                                                        weaponButtonsKeys && weaponButtonsKeys.indexOf(key)
                                                                    }
                                                                    itemKey={index + 1}
                                                                    amount={0}
                                                                    customStyle={gameUI?.[key] as IItemButtonInterface}
                                                                />
                                                            );
                                                        })}
                                                </ButtonsRow>
                                             : 
                                                <ButtonsRow $gap="16px"
                                                    $justify={i === 0 ? "flex-start" : "flex-end"}
                                                >
                                                    <CustomMiniMap
                                                        customStyle={
                                                            gameUI[
                                                                i === 0
                                                                    ? GAME_HUD_IDS.MINI_MAP_LEFT
                                                                    : GAME_HUD_IDS.MINI_MAP_RIGHT
                                                            ] as IMiniMapInterface
                                                        }
                                                        width="174px"
                                                        maxWidth="174px"
                                                        height="174px"
                                                    />
                                                </ButtonsRow>
                                            }
                                        </>
                                    }
                                </ButtonsColumn>
                            );
                        })}
                </Grid>
             : 
                <Grid $fullWidth>{canJoinRoom && <JoinRoom roomId={editor.roomId} />}</Grid>
            }
            
        </>
    );
};
