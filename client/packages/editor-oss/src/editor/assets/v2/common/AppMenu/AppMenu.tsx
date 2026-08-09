import React, {useEffect, useRef, useState} from "react";
import {useOnClickOutside} from "usehooks-ts";

import {Container, MenuItem} from "./AppMenu.style";
import {LogLevelPicker} from "./LogLevelPicker";
import {Shortcut} from "./Shortcut/Shortcut";
import {saveScene} from "@stem/network/api/scene";
import {setSceneAiPromptMode} from "@stem/network/api/scene/thumbnail";
import {useAppGlobalContext, useAuthorizationContext} from "@stem/editor-oss/context";
import EngineRuntime from "@stem/editor-oss/EngineRuntime";
import global from "@stem/editor-oss/global";
import {showToast} from "@stem/editor-oss/showToast";
import {Checkbox} from "../../../../../ui/common/Checkbox";
import {exportSceneToJson, exportSceneToSTL} from "@stem/editor-oss/utils/ExportUtils";
import {Separator} from "../../RightPanel/common/Separator";

export enum APP_MENU_ITEM {
    EXPORT_SCENE_SOURCE = "Export Scene Source (.json)",
    EXPORT_STL = "Export to STL (3d print)",
    ADVANCED_MODE = "Advanced Mode",
    GAME_DEBUG = "Log View",
    LOG_LEVEL = "Log Level",
    UNDO = "Undo",
    REDO = "Redo",
    CUT = "Cut",
    COPY = "Copy",
    PASTE = "Paste",
    DUPLICATE = "Duplicate",
}
const isMac = /Mac/i.test(navigator.userAgent);
const mainKey = isMac ? "⌘" : "ctrl";

type AppMenuItemConfig = {
    title: APP_MENU_ITEM;
    divider?: boolean;
    checkbox?: boolean;
    shortcut?: string;
    disabled?: boolean;
    ownerOnly?: boolean;
};

const MENU_ITEMS: AppMenuItemConfig[] = [
    {title: APP_MENU_ITEM.EXPORT_SCENE_SOURCE},
    {title: APP_MENU_ITEM.EXPORT_STL, divider: true},
    {title: APP_MENU_ITEM.ADVANCED_MODE, checkbox: true, divider: true},
    {title: APP_MENU_ITEM.GAME_DEBUG, divider: true},
    ...(process.env.REACT_APP_ALLOW_LOG_OVERRIDE === "true"
        ? [{title: APP_MENU_ITEM.LOG_LEVEL, divider: true}]
        : []),
    {title: APP_MENU_ITEM.UNDO, divider: true, shortcut: `${mainKey}Z`},
    {title: APP_MENU_ITEM.REDO, shortcut: `${mainKey}⇧Z`},
    {title: APP_MENU_ITEM.CUT, shortcut: `${mainKey}X`, disabled: true, divider: true},
    {title: APP_MENU_ITEM.COPY, shortcut: `${mainKey}C`},
    {title: APP_MENU_ITEM.PASTE, shortcut: `${mainKey}V`},
    {title: APP_MENU_ITEM.DUPLICATE, shortcut: `${mainKey}D`, divider: true},
];

interface Props {
    close: () => void;
    userMenuButtonRef: React.MutableRefObject<HTMLButtonElement | SVGSVGElement | null>;
    rightSide?: boolean;
}

export const AppMenu = ({close, userMenuButtonRef, rightSide}: Props) => {
    const {dbUser, isAdmin} = useAuthorizationContext();
    const app = global.app as EngineRuntime;
    const isSandbox = app?.editor?.isSandbox;
    const {advancedMode, setAdvancedMode} = useAppGlobalContext();
    const userMenuRef = useRef<HTMLDivElement | null>(null);
    const checkboxAdvancedModeRef = useRef<HTMLInputElement | null>(null);
    const [isProjectOwner, setIsProjectOwner] = useState(false);
    const [showLogLevelPicker, setShowLogLevelPicker] = useState(false);

    useOnClickOutside(
        [userMenuRef as React.MutableRefObject<HTMLElement>, userMenuButtonRef as React.MutableRefObject<HTMLElement>],
        close,
    );

    const handleMenuItemClick = async (item: APP_MENU_ITEM) => {
        switch (item) {
            case APP_MENU_ITEM.EXPORT_SCENE_SOURCE:
                await exportSceneToJson();
                break;
            case APP_MENU_ITEM.EXPORT_STL:
                console.log("Export STL menu item clicked");
                await exportSceneToSTL();
                console.log("Export STL completed");
                break;
            case APP_MENU_ITEM.GAME_DEBUG:
                if (!app) return;
                app.editor?.component?.openGameDebugPanel();
                break;
            case APP_MENU_ITEM.LOG_LEVEL:
                setShowLogLevelPicker(prev => !prev);
                return;
            case APP_MENU_ITEM.UNDO:
                if (!app) return;
                app.editor?.undo();
                break;
            case APP_MENU_ITEM.REDO:
                if (!app) return;
                app.editor?.redo();
                break;
            case APP_MENU_ITEM.COPY:
                if (!app) return;
                if (!app.editor?.selected) {
                    return showToast({type: "warning", title: "No object selected."});
                }
                await app.editor.copy();
                showToast({type: "success", title: "Copied!"});
                break;
            case APP_MENU_ITEM.PASTE:
                if (!app) return;
                app.editor?.paste();
                showToast({type: "success", title: "Pasted!"});
                break;
            case APP_MENU_ITEM.DUPLICATE:
                if (!app) return;
                if (!app.editor?.selected) {
                    return showToast({type: "warning", title: "No object selected."});
                }
                await app.editor.duplicateObject();
                showToast({type: "success", title: "Duplicated!"});
                break;
            case APP_MENU_ITEM.ADVANCED_MODE:
                setAdvancedMode(prev => {
                    const next = !prev;
                    // Flipping advancedMode ON while the scene is in
                    // AiPromptMode reverts it to a regular project: clear
                    // the flag server-side and locally so future opens
                    // respect the user's advancedMode preference.
                    if (
                        next
                        && app?.editor?.aiPromptMode
                        && app.editor.sceneID
                        && app.editor.sceneName
                    ) {
                        setSceneAiPromptMode(
                            app.editor.sceneID,
                            app.editor.sceneName,
                            false,
                        ).catch(err => {
                            console.warn("[AppMenu] Failed to clear AiPromptMode", err);
                        });
                        app.editor.aiPromptMode = false;
                    }
                    return next;
                });
                break;

            default:
                break;
        }
        // Close the menu after any selection. LOG_LEVEL is the one exception —
        // it toggles an inline sub-picker and returns above, so we never reach
        // here for it.
        close();
    };

    const handleSaveScene = async () => {
        if (!app?.editor?.sceneName) {
            showToast({type: "warning", title: "Scene name is required."});
            return;
        }

        app.editor?.component?.handleLoading(true);
        await saveScene(true);
        close();
    };

    useEffect(() => {
        if (!app || !app.editor) return;
        const projectUserId = app.editor.projectUserId;
        const userId = dbUser?.id;
        setIsProjectOwner(projectUserId === userId);
        app.on("clear.AppMenu", () => {
            setIsProjectOwner(app.editor?.projectUserId === dbUser?.id);
        });
        return () => {
            app.on("clear.AppMenu", null);
        };
    }, [app, dbUser]);

    return (
        <Container ref={userMenuRef}
            $right={rightSide}
        >
            <MenuItem onClick={handleSaveScene}>Save Project</MenuItem>
            {MENU_ITEMS.map(({title, divider, disabled, shortcut, checkbox, ownerOnly}, index) => {
                if (ownerOnly && !isProjectOwner && !isAdmin) return;
                if (title === APP_MENU_ITEM.EXPORT_SCENE_SOURCE && !isAdmin && !isProjectOwner && !app.editor?.isCloneable)
                    return;
                let checkedValue;
                let refProp;

                if (title === APP_MENU_ITEM.ADVANCED_MODE) {
                    checkedValue = advancedMode;
                    refProp = checkboxAdvancedModeRef;
                }

                return (
                    <div key={index}
                        style={{width: "100%"}}
                    >
                        {divider && <Separator margin="8px 0" />}
                        <MenuItem
                            key={index}
                            $disabled={!!disabled}
                            onClick={() => disabled ? undefined : handleMenuItemClick(title)}
                        >
                            {checkbox ? 
                                <>
                                    {title}{" "}
                                    <Checkbox
                                        checked={checkedValue ?? false}
                                        customId={title}
                                        readOnly
                                        refProp={refProp}
                                        invisible
                                    />
                                </>
                             : shortcut ? 
                                <>
                                    {title} <Shortcut shortcut={shortcut} />
                                </>
                             : 
                                title
                            }
                        </MenuItem>
                        {title === APP_MENU_ITEM.LOG_LEVEL && showLogLevelPicker && (
                            <LogLevelPicker onClose={() => setShowLogLevelPicker(false)} />
                        )}
                    </div>
                );
            })}
        </Container>
    );
};
