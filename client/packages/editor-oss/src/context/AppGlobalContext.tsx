import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import type {Object3D} from "three";

import type {FileData} from "@stem/editor-oss/editor/assets/v2/types/file";

import type {IGameMapping} from "@stem/network/api/gameMapping";
import {PAGES} from "../editor/assets/v2/CreateDashboard/constants";
import global from "../global";
import i18n from "../i18n/config";
import type {SceneConfig} from "../scene/SceneConfig";
import {getGameUrl} from "../v2/pages/links";
import {estimateSceneObjectBytes} from "../utils/estimateSceneObjectBytes";
import {ActivePage, RIGHT_PANEL_VERSIONS} from "./appStateTypes";
import {ROUTES} from "@web-shared/routes";
import {isPlaygroundMode} from "@web-shared/playgroundMode";
import {hasCopilotKeysSync} from "../copilot/playgroundCopilotKeyMarker";
import {
    readInitialAdvancedModePreference,
    resolveAdvancedModePreferenceForProject,
    writeAdvancedModePreference,
} from "./advancedModeStorage";
import {collectObjectSizeMap, deleteObjectSizesFromMap, writeObjectSizesToMap} from "./sceneSizeTracker";

const SCENE_HISTORY_MODAL_STATE_KEY = "__sceneHistoryModal";

export interface AppGlobalContextValue {
    projectPhase: number;
    setProjectPhase: React.Dispatch<React.SetStateAction<number>>;
    behaviorCount: number;
    setBehaviorCount: React.Dispatch<React.SetStateAction<number>>;
    activePage: ActivePage;
    setActivePage: (page: PAGES | ROUTES) => void;
    /**
     * When false, the editor renders in AI-focused mode: the project outliner,
     * left library, and right panel are hidden so the AI Copilot is the only
     * surface. Flipped to false automatically when the user arrives via the
     * "Create with AI" flow (see AiCopilot bootstrap handling); the "Advanced
     * Mode" menu item flips it back to true to reveal all panels.
     *
     * Project-scoped for loaded scenes. A temporary session handoff is used
     * only while a brand-new project does not have a SceneID yet.
     */
    advancedMode: boolean;
    setAdvancedMode: React.Dispatch<React.SetStateAction<boolean>>;
    mainLoaderState: {visible: boolean; message: string};
    setMainLoaderState: React.Dispatch<React.SetStateAction<{visible: boolean; message: string}>>;
    setActiveRightPanel: React.Dispatch<React.SetStateAction<RIGHT_PANEL_VERSIONS>>;
    activeRightPanel: RIGHT_PANEL_VERSIONS;
    publishedURL: string;
    setPublishedURL: React.Dispatch<React.SetStateAction<string>>;
    sceneSize: {sizeMB: number; warning?: string} | null;
    objectSizeMap: Map<string, number>;
    slug: string | null;
    setSlug: React.Dispatch<React.SetStateAction<string | null>>;
    gameMapping: IGameMapping | null;
    setGameMapping: React.Dispatch<React.SetStateAction<IGameMapping | null>>;
    openSceneHistoryModal: (arg: IRevisionModalSceneData) => void;
    updatePublishedRevisionIDInHistoryModal: (publishedId: string) => void;
    closeSceneHistoryModal: () => void;
    sceneRevisionModalSceneData: IRevisionModalSceneData | undefined;
    isEditingOldRevision: boolean;
    setIsEditingOldRevision: React.Dispatch<React.SetStateAction<boolean>>;
}

interface IRevisionModalSceneData {
    assetID: string | undefined;
    scene: FileData | SceneConfig;
}

type SceneAwareApp = NonNullable<typeof global.app> & {
    scene?: Object3D;
    isPlaying?: boolean;
    editor?: {
        sceneID?: string;
        aiPromptMode?: boolean;
    };
};

export const AppGlobalContext = React.createContext<AppGlobalContextValue>(null!);
export const useAppGlobalContext = () => React.useContext(AppGlobalContext);

export interface AppGlobalContextProviderProps {
    children: React.ReactNode;
}

const AppGlobalContextProvider: React.FC<AppGlobalContextProviderProps> = ({children}) => {
    const [projectPhase, setProjectPhase] = useState(1);
    // Seed from the current URL so a refresh on e.g. /browse renders the
    // correct page immediately instead of flashing the default (dashboard)
    // view for one render while CreateDashboard's pathname-sync effect runs.
    const [activePage, setActivePage] = useState<ActivePage>(() => {
        if (typeof window === "undefined") return undefined;
        const pathname = window.location.pathname;
        if (pathname === ROUTES.HOME) return PAGES.DASHBOARD;
        if (pathname === ROUTES.DASHBOARD) return PAGES.PROJECTS;
        if (pathname === ROUTES.DISCOVER || pathname === ROUTES.BROWSE) return PAGES.BROWSE;
        if (pathname === ROUTES.REMIX) return PAGES.REMIX;
        if (pathname === ROUTES.SETTINGS) return PAGES.SETTINGS;
        if (pathname === ROUTES.ADMIN_PANEL) return PAGES.ADMIN_PANEL;
        return PAGES.DASHBOARD;
    });
    const [activeRightPanel, setActiveRightPanel] = useState<RIGHT_PANEL_VERSIONS>(RIGHT_PANEL_VERSIONS.GameSettings);
    const [mainLoaderState, setMainLoaderState] = useState({visible: true, message: ""});

    const [sceneRevisionModalSceneData, setSceneRevisionModalSceneData] = useState<IRevisionModalSceneData>();
    const [publishedURL, setPublishedURL] = useState("");
    const [behaviorCount, setBehaviorCount] = useState(0);
    const advancedModeSeed = readInitialAdvancedModePreference();
    const [advancedMode, setAdvancedMode] = useState<boolean>(advancedModeSeed);
    const advancedModeSceneIDRef = useRef<string | null>(null);
    const skipNextAdvancedModePersistRef = useRef<string | null>(null);
    const [sceneSize, setSceneSize] = useState<{sizeMB: number; warning?: string} | null>(null);
    const [objectSizeMap, setObjectSizeMap] = useState<Map<string, number>>(new Map());
    const [slug, setSlug] = useState<string | null>(null);
    const [gameMapping, setGameMapping] = useState<IGameMapping | null>(null);
    const [isEditingOldRevision, setIsEditingOldRevision] = useState(false);
    const sceneHistoryModalAddedToHistoryRef = useRef(false);
    const closingSceneHistoryViaUiRef = useRef(false);

    const app = global.app as SceneAwareApp | undefined;
    const editorSceneID = app?.editor?.sceneID;

    useEffect(() => {
        if (!editorSceneID) {
            advancedModeSceneIDRef.current = null;
            return;
        }
        const activeApp = global.app as SceneAwareApp | undefined;
        const editorAiPromptMode = activeApp?.editor?.aiPromptMode === true;

        const resolved = resolveAdvancedModePreferenceForProject({
            sceneID: editorSceneID,
            aiPromptMode: editorAiPromptMode,
            isPlayground: isPlaygroundMode(),
            hasCopilotKeys: hasCopilotKeysSync(),
        });
        advancedModeSceneIDRef.current = editorSceneID;
        skipNextAdvancedModePersistRef.current = editorSceneID;
        writeAdvancedModePreference(resolved.value, editorSceneID);
        setAdvancedMode(prev => {
            if (prev === resolved.value) {
                skipNextAdvancedModePersistRef.current = null;
                return prev;
            }
            return resolved.value;
        });
    }, [editorSceneID]);

    useEffect(() => {
        const sceneID = advancedModeSceneIDRef.current;
        if (sceneID && skipNextAdvancedModePersistRef.current === sceneID) {
            skipNextAdvancedModePersistRef.current = null;
            return;
        }
        writeAdvancedModePreference(advancedMode, sceneID);
    }, [advancedMode, editorSceneID]);

    const calculateObjectSize = useCallback((object: unknown): number => estimateSceneObjectBytes(object as never), []);

    const updateSceneSize = useCallback(() => {
        //console.log("Updating scene size...", objectSizeMap);
        const totalBytes = Array.from(objectSizeMap.values()).reduce((sum, size) => sum + size, 0);
        const sizeMB = +(totalBytes / 1048576).toFixed(2);

        if (sizeMB > 5) {
            setSceneSize({
                sizeMB,
                warning: i18n.t("⚠️ Scene size exceeds 5MB. Consider optimizing assets."),
            });
        } else {
            setSceneSize({sizeMB});
        }
    }, [objectSizeMap]);

    const initializeSceneSize = useCallback(() => {
        if (!app?.scene || app.isPlaying) return;

        const newSizeMap = collectObjectSizeMap(app.scene, calculateObjectSize, {includeRoot: false});

        setObjectSizeMap(newSizeMap);
    }, [calculateObjectSize]);

    const handleObjectAdded = useCallback(
        (object: Object3D) => {
            if (!app || !object?.uuid || app.isPlaying) return;

            setObjectSizeMap(prev => {
                const newMap = new Map(prev);
                writeObjectSizesToMap(newMap, object, calculateObjectSize);
                return newMap;
            });
        },
        [calculateObjectSize],
    );

    const handleObjectChanged = useCallback(
        (object: Object3D) => {
            if (!app || !object?.uuid || app.isPlaying) return;

            // Only traverse if this is an Object3D
            if (object.isObject3D) {
                setObjectSizeMap(prev => {
                    const newMap = new Map(prev);
                    writeObjectSizesToMap(newMap, object, calculateObjectSize);
                    return newMap;
                });
            }
        },
        [calculateObjectSize],
    );

    const handleObjectRemoved = useCallback((object: Object3D) => {
        if (!app || !object?.uuid || app.isPlaying) return;

        setObjectSizeMap(prev => {
            const newMap = new Map(prev);
            deleteObjectSizesFromMap(newMap, object);
            return newMap;
        });
    }, [app]);

    const openSceneHistoryModal = useCallback((arg: IRevisionModalSceneData) => {
        setSceneRevisionModalSceneData({assetID: arg.assetID, scene: arg.scene});
    }, []);
    const closeSceneHistoryModal = useCallback(() => {
        const currentHistoryState = window.history.state as Record<string, unknown> | null;

        if (sceneHistoryModalAddedToHistoryRef.current && currentHistoryState?.[SCENE_HISTORY_MODAL_STATE_KEY]) {
            closingSceneHistoryViaUiRef.current = true;
            sceneHistoryModalAddedToHistoryRef.current = false;
            window.history.back();
            return;
        }

        setSceneRevisionModalSceneData(undefined);
    }, []);
    const updatePublishedRevisionIDInHistoryModal = useCallback((updatedPublishedRevisionId: string) => {
        setSceneRevisionModalSceneData(prev => {
            if (!prev) return undefined;
            return {
                ...prev,
                scene: {...prev.scene, publishRevisionId: updatedPublishedRevisionId} as FileData | SceneConfig,
            };
        });
    }, []);

    useEffect(() => {
        if (!sceneRevisionModalSceneData) return;

        if (!sceneHistoryModalAddedToHistoryRef.current) {
            const currentHistoryState = window.history.state as Record<string, unknown> | null;
            window.history.pushState(
                {
                    ...(currentHistoryState ?? {}),
                    [SCENE_HISTORY_MODAL_STATE_KEY]: true,
                },
                "",
                window.location.href,
            );
            sceneHistoryModalAddedToHistoryRef.current = true;
        }

        const handlePopState = () => {
            sceneHistoryModalAddedToHistoryRef.current = false;

            if (closingSceneHistoryViaUiRef.current) {
                closingSceneHistoryViaUiRef.current = false;
            }
            setSceneRevisionModalSceneData(undefined);
        };

        window.addEventListener("popstate", handlePopState);

        return () => {
            window.removeEventListener("popstate", handlePopState);
        };
    }, [sceneRevisionModalSceneData]);

    useEffect(() => {
        if (!app) return;

        // Initialize scene size immediately if scene already exists
        if (app.scene) {
            initializeSceneSize();
        }

        // Initialize scene size when scene is loaded
        app.on("sceneLoaded.AppGlobalContext", initializeSceneSize);

        // Handle object events
        app.on("objectAdded.AppGlobalContext", handleObjectAdded);
        app.on("objectChanged.AppGlobalContext", handleObjectChanged);
        app.on("objectRemoved.AppGlobalContext", handleObjectRemoved);

        // Clear old-revision banner on save or scene teardown
        app.on("sceneSaved.AppGlobalContext", () => setIsEditingOldRevision(false));
        app.on("clear.AppGlobalContext", () => setIsEditingOldRevision(false));

        return () => {
            app.on("sceneLoaded.AppGlobalContext", null);
            app.on("objectAdded.AppGlobalContext", null);
            app.on("objectChanged.AppGlobalContext", null);
            app.on("objectRemoved.AppGlobalContext", null);
            app.on("sceneSaved.AppGlobalContext", null);
            app.on("clear.AppGlobalContext", null);
        };
    }, [app, initializeSceneSize, handleObjectAdded, handleObjectChanged, handleObjectRemoved]);

    // Update scene size whenever objectSizeMap changes
    useEffect(() => {
        updateSceneSize();
    }, [objectSizeMap]);

    useEffect(() => {
        if (editorSceneID) {
            const slugGameUrl = getGameUrl(editorSceneID, slug);
            const engineGameUrl = getGameUrl(editorSceneID, null);
            setPublishedURL(slug ? slugGameUrl : engineGameUrl);
        }
    }, [slug, editorSceneID]);

    useEffect(() => {
        setSlug(null);
        setGameMapping(null);
    }, [editorSceneID]);

    const contextValue = useMemo<AppGlobalContextValue>(
        () => ({
            projectPhase,
            setProjectPhase,
            activePage,
            setActivePage,
            behaviorCount,
            setBehaviorCount,
            advancedMode,
            setAdvancedMode,
            mainLoaderState,
            setMainLoaderState,
            setActiveRightPanel,
            activeRightPanel,
            publishedURL,
            setPublishedURL,
            sceneSize,
            objectSizeMap,
            slug,
            setSlug,
            gameMapping,
            setGameMapping,
            closeSceneHistoryModal,
            openSceneHistoryModal,
            sceneRevisionModalSceneData,
            updatePublishedRevisionIDInHistoryModal,
            isEditingOldRevision,
            setIsEditingOldRevision,
        }),
        [
            projectPhase,
            activePage,
            behaviorCount,
            advancedMode,
            mainLoaderState,
            activeRightPanel,
            publishedURL,
            sceneSize,
            objectSizeMap,
            slug,
            gameMapping,
            closeSceneHistoryModal,
            openSceneHistoryModal,
            sceneRevisionModalSceneData,
            updatePublishedRevisionIDInHistoryModal,
            isEditingOldRevision,
        ],
    );

    return <AppGlobalContext.Provider value={contextValue}>{children}</AppGlobalContext.Provider>;
};

export default AppGlobalContextProvider;
