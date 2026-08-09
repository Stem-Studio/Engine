/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import React, {useEffect, useState} from "react";

import {fetchRemixesOfScene} from "@stem/network/api/scene/list";
import {isPlaygroundMode} from "@web-shared/playgroundMode";
import {useAuthorizationContext} from "@stem/editor-oss/context/AuthorizationContext";
import global from "@stem/editor-oss/global";
import {showToast} from "@stem/editor-oss/showToast";
import {ItemMenuText, RightClickMenu} from "../../../../../../ui/common/RightClickMenu/RightClickMenu";
import Ajax from "@stem/editor-oss/utils/Ajax";
import {backendUrlFromPath} from "@stem/editor-oss/utils/UrlUtils";
import {openEditorRoute} from "../../../../../../v2/pages/editorHandoff";
import {generateProjectLink, getGameUrl} from "../../../../../../v2/pages/links";
import {prepareRemixCopilotEntry} from "../../../AiCopilot/copilotWorkspaceEntry";
import {FileData} from "../../../types/file";
import archiveIcon from "../../icons/archive.svg";
import editIcon from "../../icons/edit.svg";
import publishIcon from "../../icons/global.svg";
import playIcon from "../../icons/play.svg";
import remixIcon from "../../icons/remix.svg";
import {SceneItemProps} from "../SceneDetailsPopup";
import {Button, FlexWrapper} from "../SceneDetailsPopup.style";
import {ShareScene} from "../ShareScene";

enum ButtonType {
    Public = "Public",
    Private = "Private",
    Archive = "Archive",
    Unarchive = "Unarchive",
    Duplicate = "Duplicate",
    Clone = "Clone",
    Versions = "Versions",
}

interface IButton {
    label: string;
    icon: string;
    action: (e: React.MouseEvent<HTMLSpanElement, MouseEvent>) => void;
    btnType: ButtonType;
}

interface ButtonProps extends SceneItemProps {
    isMyGame: boolean;
    onShowRemixPicker?: (data: {remixes: FileData[]; sceneName: string; onCreateNew: () => void}) => void;
}

export const ActionButtons = ({
    isMyGame,
    scene,
    reload,
    isCloneable,
    setShowLoading,
    openProject,
    onDelete,
    isCommunityGame,
    isOwnerSetted,
    setIsMenuOpen,
    onShowRemixPicker,
}: ButtonProps) => {
    const {isAdmin} = useAuthorizationContext();
    const app = global.app!;
    const [isPublic, setIsPublic] = useState(!!scene.IsPublic);
    const [ownerButtons, setOwnerButtons] = useState<IButton[]>([]);
    const [buttonIsLoading, setButtonIsLoading] = useState<ButtonType[]>([]);
    const [isRightClickMenuOpen, setIsRightClickMenuOpen] = useState(false);
    const [menuPosition, setMenuPosition] = useState<{x: number; y: number} | null>(null);
    const isPlayground = isPlaygroundMode();
    const handleRightClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        setIsRightClickMenuOpen(true);
        const x = event.clientX;
        const y = event.clientY;
        setMenuPosition({x, y});
    };

    const closeRightClickMenu = () => {
        setIsRightClickMenuOpen(false);
        setMenuPosition(null);
    };

    const cleanup = (buttonType: ButtonType) => {
        setButtonIsLoading(prev => prev.filter(el => el !== buttonType));
        reload?.();
    };

    const handleFork = async () => {
        setButtonIsLoading(prev => [...prev, ButtonType.Clone]);
        if (!setShowLoading || !reload) {
            return console.error("Missing props for remix: setShowLoading, reload");
        }
        setShowLoading(true);
        try {
            const {forkScene} = await import("@stem/network/api/scene/actions");
            const result = await forkScene(scene.ID);
            showToast({type: "success", title: "Starting a remix"});
            if (result?.newSceneId) {
                prepareRemixCopilotEntry({
                    newSceneId: result.newSceneId,
                    sourceScene: scene,
                });
                openEditorRoute(generateProjectLink(result.newSceneId));
            }
        } catch (error: unknown) {
            console.error("Error during remix:", error);
            showToast({type: "error", title: error instanceof Error ? error?.message : "Request failed."});
        } finally {
            cleanup(ButtonType.Clone);
        }
    };

    const handleRemix = async () => {
        // Skip remix picker for scenes without a RemixedFromSceneID — they are
        // originals (e.g. the default blank screen) and serve as the base of every
        // scene, so their remix list is unbounded and not useful.
        if (scene.RemixedFromSceneID) {
            try {
                const result = await fetchRemixesOfScene(scene.ID);
                const remixes = result?.Scenes || [];
                if (remixes.length > 0 && onShowRemixPicker) {
                    onShowRemixPicker({
                        remixes,
                        sceneName: scene.Name,
                        onCreateNew: () => void handleFork(),
                    });
                    return;
                }
            } catch {
                // On error, fall through to fork directly
            }
        }
        void handleFork();
    };

    const handleOpenNewTab = (event: React.MouseEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
        openProject?.(scene.ID, true);
    };

    const playPage = () => {
        window.open(getGameUrl(scene.ID, ""), "_blank");
    };

    const handleDelete = (e: React.MouseEvent<HTMLSpanElement, MouseEvent>) => {
        e.stopPropagation();
        setIsMenuOpen(false);
        if (onDelete) {
            onDelete(scene.ID);
        }
    };

    const handlePublic = () => {
        setButtonIsLoading(prev => [...prev, ButtonType.Public]);
        void Ajax.post({
            url: backendUrlFromPath(`/api/Scene/Edit`),
            data: {
                Name: scene.Name,
                ID: scene.ID,
                IsPublic: true,
            },
            msgBodyType: "multipart",
        })
            .then(response => {
                if (response?.data.Code === 200) {
                    app.call("sceneSaved");
                    setIsPublic(true);
                } else {
                    showToast({type: "error", body: response?.data.Msg});
                }
            })
            .finally(() => {
                cleanup(ButtonType.Public);
            });
    };

    const handlePrivate = () => {
        setButtonIsLoading(prev => [...prev, ButtonType.Private]);
        void Ajax.post({
            url: backendUrlFromPath(`/api/Scene/Edit`),
            data: {
                Name: scene.Name,
                ID: scene.ID,
                IsPublic: false,
            },
            msgBodyType: "multipart",
        })
            .then(response => {
                if (response?.data.Code === 200) {
                    app.call("sceneSaved");
                    setIsPublic(false);
                } else {
                    showToast({type: "error", body: response?.data.Msg});
                }
            })
            .finally(() => {
                cleanup(ButtonType.Private);
            });
    };

    const handleUnarchive = () => {
        setButtonIsLoading(prev => [...prev, ButtonType.Unarchive]);
        void Ajax.post({
            url: backendUrlFromPath(`/api/Scene/Unarchive`),
            data: {ID: scene.ID},
            msgBodyType: "multipart",
        })
            .then(response => {
                if (response?.data.Code !== 200) {
                    showToast({type: "error", body: response?.data.Msg});
                }
            })
            .finally(() => {
                cleanup(ButtonType.Unarchive);
                setIsMenuOpen(false);
            });
    };

    useEffect(() => {
        const canManagePublishState = (!isCommunityGame || isAdmin || !isOwnerSetted) && scene.IsPublished;
        const buttons: IButton[] = [];
        if (canManagePublishState) {
            buttons.push(
                !isPublic
                    ? {label: ButtonType.Public, icon: publishIcon, action: handlePublic, btnType: ButtonType.Public}
                    : {label: "Private", icon: publishIcon, action: handlePrivate, btnType: ButtonType.Private},
            );
        }

        if (onDelete) {
            buttons.push({label: "Archive", icon: archiveIcon, action: handleDelete, btnType: ButtonType.Archive});
        }

        buttons.push({
            label: "Duplicate",
            icon: remixIcon,
            action: () => void handleRemix(),
            btnType: ButtonType.Duplicate,
        });

        // buttons.push({
        //     label: "Versions",
        //     icon: clockIcon,
        //     action: () => openSceneHistoryModal({assetID: scene.AssetID || "unknown-scene-asset-id", scene: scene}),
        //     btnType: ButtonType.Versions,
        // });

        setOwnerButtons(buttons);
    }, [scene, isPublic, isCommunityGame, isAdmin, isOwnerSetted, onDelete]);

    return isMyGame ? (
        // Scene Owner Options
        <>
            <FlexWrapper>
                {!scene.IsArchived &&
                    ownerButtons.map(({icon, label, action, btnType}) => (
                        <Button
                            key={label}
                            customIcon={icon}
                            onClick={action}
                            style={{
                                background: "var(--theme-dialog-button-purple)",
                                flex: 1,
                            }}
                            disabled={!!buttonIsLoading.find(el => el === btnType)}
                        >
                            {label}
                        </Button>
                    ))}
            </FlexWrapper>

            <Button
                style={{
                    background: "var(--theme-dialog-button-purple-light)",
                    border: "1px solid var(--theme-dialog-button-purple-light-border)",
                    width: "100%",
                    marginTop: "12px",
                    fontSize: "16px",
                }}
                onContextMenu={handleRightClick}
                customIcon={scene.IsArchived ? archiveIcon : editIcon}
                onClick={() => (scene.IsArchived ? handleUnarchive() : openProject?.(scene.ID))}
            >
                {scene.IsArchived ? "Unarchive" : "Edit"}
                {isRightClickMenuOpen && menuPosition && (
                    <RightClickMenu
                        onClickoutsideCallback={closeRightClickMenu}
                        left={menuPosition.x}
                        top={menuPosition.y}
                    >
                        <ItemMenuText
                            onClick={handleOpenNewTab}
                            title="Open this project editor in a new tab"
                        >
                            Open in new tab
                        </ItemMenuText>
                    </RightClickMenu>
                )}
            </Button>
        </>
    ) : (
        // Non-owner Options
        <>
            <FlexWrapper>
                {isCloneable && (
                    <Button
                        style={{
                            background: "var(--theme-dialog-button-purple)",
                            width: "132px",
                        }}
                        customIcon={remixIcon}
                        onClick={() => void handleRemix()}
                    >
                        Remix
                    </Button>
                )}
                {scene.IsPublished && !isPlayground && (
                    <Button
                        style={{
                            background: "var(--theme-dialog-button-purple-green)",
                            border: "1px solid var(--theme-dialog-button-purple-green-border)",
                            width: isCloneable ? "168px" : "100%",
                            color: "#1C1C1C",
                        }}
                        customIcon={playIcon}
                        onClick={playPage}
                    >
                        Play
                    </Button>
                )}
                {!isPlayground && <ShareScene scene={scene} />}
            </FlexWrapper>
        </>
    );
};
