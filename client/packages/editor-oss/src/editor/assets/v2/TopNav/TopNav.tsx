import I18n from "i18next";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import { SceneName } from "./SceneName";
import { StemEditorTitle } from "./StemEditorTitle";
import {
    StyledNav,
    LeftSide,
    EditorButton,
    Middle,
    Right,
    WorkspaceHeaderGroup,
    WorkspaceMeta,
    WorkspaceProjectInput,
    WorkspaceSaved,
    WorkspaceVersionChip,
    WorkspacePanelButton,
    NavIconButton,
    CompactOnly,
} from "./TopNav.style";
import { saveScene } from "@stem/network/api/scene";
import EngineRuntime, { ApplicationMode } from "@stem/editor-oss/EngineRuntime";
import {ROUTES} from "@web-shared/routes";
import {isScriptImportInProgress, subscribeScriptImportActivity} from "@stem/editor-oss/agent/script-tool/scriptImportActivity";
import { useAppGlobalContext, useAuthorizationContext } from "@stem/editor-oss/context";
import { isStemEditor } from "../../../../editor/stem-editor/isStemEditor";
import global from "@stem/editor-oss/global";
import { useFullscreen } from "@stem/editor-oss/hooks/useFullscreen";
import { useMobileZoomLock } from "@stem/editor-oss/hooks/useMobileZoomLock";
import { showToast } from "@stem/editor-oss/showToast";
import {syncPlaygroundSceneRoute} from "@stem/editor-oss/v2/pages/links";
import {
    editorHasUnsavedChanges,
    getEditorSaveStatus,
    reconcileEditorSaveStatus,
    type EditorSaveStatus,
} from "@stem/editor-oss/utils/editorUnsavedChanges";
import {useCopilotPreview} from "../CopilotWorkspace/CopilotPreviewContext";
import { AppMenu } from "../common/AppMenu/AppMenu";
import { Section } from "../common/Section";
import { FloatingNav } from "../HUD/HUDView/FloatingNav/FloatingNav";
import arrowLeftIcon from "../icons/arrow-left.svg";
import stemLogo from "../icons/stem-logo.svg";
import { MenuIcon } from "../LeftPanel/MenuIcon";
import { AppVersion } from "../RightPanel/common/TopMenu/AppVersion";
import { TopMenu } from "../RightPanel/common/TopMenu/TopMenu";

type Props = {
    playerStarted: boolean;
    workspaceMode?: boolean;
    showWorkspacePanelToggles?: boolean;
    activeWorkspacePanel?: "hierarchy" | "inspector" | null;
    onToggleHierarchy?: () => void;
    onToggleInspector?: () => void;
};

type PlayClickTimingEntry = {
    phase: string;
    ms: number;
    success: boolean;
    message?: string;
};

const getPlayClickTimingRoot = () => globalThis as typeof globalThis & {
    __stemPlayClickTimings?: PlayClickTimingEntry[];
};

const resetPlayClickTimings = (): void => {
    getPlayClickTimingRoot().__stemPlayClickTimings = [];
};

const recordPlayClickTiming = (entry: PlayClickTimingEntry): void => {
    const root = getPlayClickTimingRoot();
    root.__stemPlayClickTimings ??= [];
    root.__stemPlayClickTimings.push(entry);
};

const timePlayClickSync = <T,>(phase: string, task: () => T): T => {
    const start = performance.now();
    try {
        const result = task();
        recordPlayClickTiming({phase, ms: Math.round(performance.now() - start), success: true});
        return result;
    } catch (error) {
        recordPlayClickTiming({
            phase,
            ms: Math.round(performance.now() - start),
            success: false,
            message: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
};

const timePlayClickPhase = async <T,>(phase: string, task: () => Promise<T> | T): Promise<T> => {
    const start = performance.now();
    try {
        const result = await task();
        recordPlayClickTiming({phase, ms: Math.round(performance.now() - start), success: true});
        return result;
    } catch (error) {
        recordPlayClickTiming({
            phase,
            ms: Math.round(performance.now() - start),
            success: false,
            message: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
};

export const TopNav = ({
    playerStarted,
    workspaceMode = false,
    showWorkspacePanelToggles = false,
    activeWorkspacePanel = null,
    onToggleHierarchy,
    onToggleInspector,
}: Props) => {
    // Fallback when the engine hasn't initialized yet (route mounted before
    // EngineRuntime is ready, common when the dashboard route
    // doesn't pre-instantiate the engine). Returns an empty object whose
    // `.editor` etc. are `undefined`, so `app.editor?.x` short-circuits
    // safely instead of throwing on `null.editor`.
    const app = (global.app ?? {}) as EngineRuntime;
    const navRef = useRef<HTMLElement | null>(null);
    const navigatingAwayRef = useRef(false);
    const location = useLocation();
    const editorRouteRef = useRef(`${location.pathname}${location.search}${location.hash}`);
    const isPlayingRef = useRef(playerStarted);

    const { dbUser } = useAuthorizationContext();
    const { sceneRevisionModalSceneData } = useAppGlobalContext();
    const sceneRevisionModalOpenRef = useRef(!!sceneRevisionModalSceneData);

    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [showAppVersion, setShowAppVersion] = useState(false);
    const userMenuButtonRef = useRef<SVGSVGElement | null>(null);
    const [isPlaying, setIsPlaying] = useState(playerStarted);
    const [scriptImportBusy, setScriptImportBusy] = useState(isScriptImportInProgress);
    const [saveStatus, setSaveStatus] = useState<EditorSaveStatus>(() =>
        getEditorSaveStatus(app.editor?.scene?.userData),
    );
    const stemEditorMode = global.app ? isStemEditor(app.editor?.scene) : false;
    const { enterFullscreen, exitFullscreen } = useFullscreen();
    const copilotPreview = useCopilotPreview();

    useMobileZoomLock(isPlaying);

    useEffect(() => {
        setIsPlaying(playerStarted);
    }, [playerStarted]);

    useEffect(() => {
        const runtime = global.app;
        runtime?.registerViewportSafeAreaElement("editor-top-nav", navRef.current);
        return () => {
            runtime?.registerViewportSafeAreaElement("editor-top-nav", null);
        };
    }, []);

    useEffect(() => {
        isPlayingRef.current = isPlaying;
    }, [isPlaying]);

    useEffect(() => subscribeScriptImportActivity(setScriptImportBusy), []);

    useEffect(() => {
        if (!global.app) return;

        const updateFromScene = () => {
            setSaveStatus(getEditorSaveStatus(app.editor?.scene?.userData));
        };
        app.on("objectChanged.TopNavSaveStatus", () => setSaveStatus("Unsaved"));
        app.on("objectAdded.TopNavSaveStatus", () => setSaveStatus("Unsaved"));
        app.on("objectRemoved.TopNavSaveStatus", () => setSaveStatus("Unsaved"));
        app.on("editorDirtyStateChanged.TopNavSaveStatus", () => setSaveStatus("Unsaved"));
        app.on("sceneSaveStart.TopNavSaveStatus", () => setSaveStatus("Saving"));
        app.on("sceneSaved.TopNavSaveStatus", updateFromScene);
        app.on("sceneSaveFailed.TopNavSaveStatus", () => setSaveStatus("Failed"));
        app.on("sceneLoaded.TopNavSaveStatus", updateFromScene);

        updateFromScene();
        return () => {
            app.on("objectChanged.TopNavSaveStatus", null);
            app.on("objectAdded.TopNavSaveStatus", null);
            app.on("objectRemoved.TopNavSaveStatus", null);
            app.on("editorDirtyStateChanged.TopNavSaveStatus", null);
            app.on("sceneSaveStart.TopNavSaveStatus", null);
            app.on("sceneSaved.TopNavSaveStatus", null);
            app.on("sceneSaveFailed.TopNavSaveStatus", null);
            app.on("sceneLoaded.TopNavSaveStatus", null);
        };
    }, [app]);

    useEffect(() => {
        editorRouteRef.current = `${location.pathname}${location.search}${location.hash}`;
    }, [location.hash, location.pathname, location.search]);

    const dbUserRef = useRef(dbUser);

    useEffect(() => {
        dbUserRef.current = dbUser;
        app.userId = dbUser?.id || null;
    }, [dbUser]);

    const handleCloseMenu = () => {
        setIsMenuOpen(false);
    };

    const navigateToGamesLibrary = async () => {
        try {
            await app.editor?.checkForUnsavedChanges("All unsaved data will be lost. Are you sure?");
        } catch {
            return;
        }

        // Close all open code editors and popouts before navigating.
        try {
            app.editor?.component?.closeCodeEditor();
            app.editor?.component?.restoreAllPopouts();
        } catch {
            showToast({ type: "error", title: "This module is no longer available as the project has been closed." });
        }

        navigatingAwayRef.current = true;
        window.location.replace(ROUTES.DASHBOARD);
    };

    const handleOpenGamesLibrary = async () => {
        await navigateToGamesLibrary();
    };

    const getUnsavedChanges = () => {
        const editor = app.editor;
        if (!editor) return;
        return editorHasUnsavedChanges(editor.scene.userData);
    };

    const handlePlay = async (e: any) => {
        resetPlayClickTimings();
        const playClickTotalStart = performance.now();
        e.preventDefault();
        if (isPlaying || app?.isModeTransitioning || !app || !app.editor) {
            recordPlayClickTiming({phase: "guard", ms: Math.round(performance.now() - playClickTotalStart), success: false});
            return;
        }
        const editor = app.editor;
        let editorSavePolicy: "flush" | "discard" = "flush";
        if (scriptImportBusy || isScriptImportInProgress()) {
            showToast({
                type: "info",
                title: "Import in progress",
                body: "Wait for the import to finish before entering Play.",
            });
            recordPlayClickTiming({phase: "scriptImportGuard", ms: Math.round(performance.now() - playClickTotalStart), success: false});
            return;
        }
        timePlayClickSync("saveCamera", () => {
            editor.controls?.saveCamera();
        });

        let releaseLocalAutoSave: ((options?: {schedule?: boolean}) => void) | undefined;
        if (!editor.isSandbox && editor.projectUserId === app.userId) {
            let shouldSaveScene = false;
            let shouldProceedWithoutSaving = false;
            let shouldAbortPlay = false;
            releaseLocalAutoSave = editor.suspendLocalAutoSave();
            try {
                await timePlayClickPhase("checkForUnsavedChanges", () =>
                    editor.checkForUnsavedChanges("You have unsaved changes in the editor. All unsaved data will be lost if you proceed. Are you sure?",
                        () => {
                            shouldSaveScene = true;
                        },
                        () => {
                            shouldProceedWithoutSaving = true;
                            editorSavePolicy = "discard";
                        },
                        "Save",
                        "Don't Save",
                        () => {
                            shouldAbortPlay = true;
                        },
                    ),
                );
                if (shouldSaveScene) {
                    await timePlayClickPhase("saveScene", () => saveScene());
                }
            } catch {
                // Don't Save should proceed to play; close actions should abort.
                if (shouldAbortPlay || !shouldProceedWithoutSaving) {
                    releaseLocalAutoSave({schedule: true});
                    recordPlayClickTiming({phase: "unsavedChangesAbort", ms: Math.round(performance.now() - playClickTotalStart), success: false});
                    return;
                }
                recordPlayClickTiming({phase: "unsavedChangesProceedWithoutSaving", ms: 0, success: true});
            }
        } else {
            recordPlayClickTiming({phase: "unsavedChangesSkipped", ms: 0, success: true});
        }

        timePlayClickSync("enterFullscreen", enterFullscreen);

        try {
            await timePlayClickPhase("setMode", () =>
                app.setMode(ApplicationMode.PLAY, {editorSavePolicy}),
            );
            releaseLocalAutoSave?.({schedule: false});
            syncPlaygroundSceneRoute(editor.sceneID, editor.sceneName, "play");
        } catch (error) {
            releaseLocalAutoSave?.({schedule: true});
            exitFullscreen();
            showToast({
                type: "error",
                title: "Could not enter Play",
                body: error instanceof Error ? error.message : "Local changes could not be finalized.",
            });
            recordPlayClickTiming({
                phase: "setModeFailed",
                ms: Math.round(performance.now() - playClickTotalStart),
                success: false,
            });
            return;
        }
        timePlayClickSync("setIsPlaying", () => {
            setIsPlaying(true);
        });
        recordPlayClickTiming({
            phase: "handlePlayTotal",
            ms: Math.round(performance.now() - playClickTotalStart),
            success: true,
        });
    };

    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (navigatingAwayRef.current) return;

            const hasUnsavedChanges = getUnsavedChanges();

            if (hasUnsavedChanges && !app.editor?.isCollaborative) {
                const confirmationMessage = I18n.t("All unsaved data will be lost. Are you sure?");
                e.preventDefault();
                e.returnValue = confirmationMessage;
                return confirmationMessage;
            }
        };

        window.addEventListener("beforeunload", handleBeforeUnload);

        return () => {
            window.removeEventListener("beforeunload", handleBeforeUnload);
        };
    }, [app?.editor]);

    useEffect(() => {
        sceneRevisionModalOpenRef.current = !!sceneRevisionModalSceneData;
    }, [sceneRevisionModalSceneData]);

    useEffect(() => {
        const handlePopState = async () => {
            if (navigatingAwayRef.current) return;

            // When the version history modal is open, popstate is handled by
            // AppGlobalContext (which pushed the history entry). Skip here so
            // we don't show the unsaved-changes confirm dialog.
            if (sceneRevisionModalOpenRef.current) return;

            // In active non-sandbox play mode, browser Back exits to edit
            // mode and restores the current editor route. Sandbox scenes use
            // the same dashboard exit behavior as the visible back control.
            const isSandboxScene = !!app.editor?.isSandbox;
            const isActiveNonSandboxPlay =
                !isSandboxScene && (isPlayingRef.current || app.isPlaying || app.mode === ApplicationMode.PLAY);
            if (isActiveNonSandboxPlay) {
                window.history.pushState(null, "", editorRouteRef.current);
                exitFullscreen();
                await app.setMode(ApplicationMode.EDIT);
                setIsPlaying(false);
                const syncEditRoute = () => syncPlaygroundSceneRoute(app.editor?.sceneID, app.editor?.sceneName, "edit");
                syncEditRoute();
                requestAnimationFrame(syncEditRoute);
                return;
            }

            await navigateToGamesLibrary();
            if (!navigatingAwayRef.current) window.history.pushState(null, "", editorRouteRef.current);
        };

        window.addEventListener("popstate", handlePopState);

        return () => {
            window.removeEventListener("popstate", handlePopState);
        };
    }, []);

    if (isPlaying && !workspaceMode) return <FloatingNav setIsPlaying={setIsPlaying}
        isPlaying={isPlaying}
                          />;

    const logoButton = (
        <button
            onClick={() => setShowAppVersion(prev => !prev)}
            className="reset-css stem-logo-btn"
            style={{ height: "24px", cursor: "pointer" }}
        >
            {/* TODO(playground): replace this compact top-nav logo asset; the embedded red ALPHA badge reads like a stray download-icon background in playground. */}
            <img
                src={stemLogo}
                style={{ height: "100%" }}
                alt="Stem Studio"
            />
        </button>
    );

    const handleStopPlay = async () => {
        if (!app || app.isModeTransitioning || (!isPlaying && !app.isPlaying && app.mode !== ApplicationMode.PLAY)) return;
        const syncEditRoute = () => syncPlaygroundSceneRoute(app.editor?.sceneID, app.editor?.sceneName, "edit");
        // Commit the user-visible route before the potentially expensive scene
        // teardown. setMode flips its runtime state early but resolves only
        // after progressive restoration has completed.
        syncEditRoute();
        exitFullscreen();
        await app.setMode(ApplicationMode.EDIT);
        setIsPlaying(false);
        syncEditRoute();
        requestAnimationFrame(syncEditRoute);
    };

    const handleSave = async () => {
        if (!app.editor || saveStatus === "Saving") return;
        setSaveStatus("Saving");
        const nextStatus = await reconcileEditorSaveStatus(
            () => saveScene(true),
            () => app.editor?.scene?.userData,
        );
        setSaveStatus(nextStatus);
    };

    const playRemixButtons = (
        <Middle>
            <EditorButton $isBlue={isPlaying}
                $disabled={scriptImportBusy}
                type="button"
                disabled={scriptImportBusy}
                onClick={handlePlay}
                data-testid="topnav-play"
                aria-disabled={scriptImportBusy || app.isModeTransitioning}
                title={scriptImportBusy ? "Import in progress" : app.isModeTransitioning ? "Mode transition in progress" : undefined}
            >
                Play
            </EditorButton>
            <EditorButton $isBlue={!isPlaying}
                type="button"
                onClick={handleStopPlay}
                data-testid="topnav-edit"
            >
                Edit
            </EditorButton>
        </Middle>
    );

    const panelToggles = showWorkspacePanelToggles ? (
        <div className="workspace-panel-toggles"
            aria-label="Workspace panels"
        >
            <WorkspacePanelButton
                type="button"
                onClick={onToggleHierarchy}
                aria-label="Toggle hierarchy"
                aria-expanded={activeWorkspacePanel === "hierarchy"}
                aria-pressed={activeWorkspacePanel === "hierarchy"}
                aria-keyshortcuts="Alt+1"
                title="Hierarchy (Alt+1)"
                $active={activeWorkspacePanel === "hierarchy"}
                data-testid="topnav-toggle-hierarchy"
            >
                <span className="panel-label-full">Hierarchy</span>
                <span className="panel-label-short"
                    aria-hidden="true"
                >H</span>
            </WorkspacePanelButton>
            <WorkspacePanelButton
                type="button"
                onClick={onToggleInspector}
                aria-label="Toggle inspector"
                aria-expanded={activeWorkspacePanel === "inspector"}
                aria-pressed={activeWorkspacePanel === "inspector"}
                aria-keyshortcuts="Alt+2"
                title="Inspector (Alt+2)"
                $active={activeWorkspacePanel === "inspector"}
                data-testid="topnav-toggle-inspector"
            >
                <span className="panel-label-full">Inspector</span>
                <span className="panel-label-short"
                    aria-hidden="true"
                >I</span>
            </WorkspacePanelButton>
        </div>
    ) : null;

    if (stemEditorMode) {
        return (
            <StyledNav ref={navRef} data-stem-host-chrome="true">
                <LeftSide>
                    <Section $gap="4px"
                        $direction="row"
                        $width="auto"
                        $align="center"
                    >
                        <StemEditorTitle />
                    </Section>
                </LeftSide>
                {playRemixButtons}
                <Right>
                    <TopMenu />
                </Right>
            </StyledNav>
        );
    }

    if (workspaceMode) {
        const versionLabel = copilotPreview.isPreviewActive
            ? copilotPreview.previewLabel
            : "Local Project";
        const saveLabel = copilotPreview.isPreviewActive
            ? "Temporary Preview"
            : saveStatus;

        return (
            <StyledNav ref={navRef} data-stem-host-chrome="true">
                {showAppVersion && <AppVersion close={() => setShowAppVersion(false)} />}
                <WorkspaceHeaderGroup>
                    <NavIconButton
                        type="button"
                        onClick={handleOpenGamesLibrary}
                        aria-label="Back to projects"
                        data-testid="topnav-back-to-dashboard"
                    >
                        <img src={arrowLeftIcon}
                            alt=""
                        />
                    </NavIconButton>
                    {logoButton}
                    <WorkspaceProjectInput>
                        <SceneName />
                    </WorkspaceProjectInput>
                    <MenuIcon
                        isMenuOpen={isMenuOpen}
                        setIsMenuOpen={setIsMenuOpen}
                        userMenuButtonRef={userMenuButtonRef}
                    />
                </WorkspaceHeaderGroup>
                {panelToggles}
                <CompactOnly>{playRemixButtons}</CompactOnly>
                <WorkspaceMeta>
                    <WorkspaceVersionChip $preview={copilotPreview.isPreviewActive}>
                        {versionLabel}
                    </WorkspaceVersionChip>
                    <WorkspaceSaved>
                        <span>Status:</span>
                        <span>{saveLabel}</span>
                    </WorkspaceSaved>
                </WorkspaceMeta>
                <Right>
                    <EditorButton className="compact-save"
                        $isBlue={false}
                        type="button"
                        onClick={handleSave}
                        disabled={saveStatus === "Saving"}
                        $disabled={saveStatus === "Saving"}
                    >
                        {saveStatus === "Saving" ? "Saving" : "Save"}
                    </EditorButton>
                    <TopMenu />
                </Right>
                {isMenuOpen && <AppMenu close={handleCloseMenu}
                    userMenuButtonRef={userMenuButtonRef}
                               />}
            </StyledNav>
        );
    }

    if (!global.app) return null;
    return (
        <StyledNav ref={navRef} data-stem-host-chrome="true">
            {showAppVersion && <AppVersion close={() => setShowAppVersion(false)} />}
            <LeftSide>
                <Section $gap="4px"
                    $direction="row"
                    $width="auto"
                    $align="center"
                >
                    <NavIconButton
                        type="button"
                        onClick={handleOpenGamesLibrary}
                        aria-label="Back to projects"
                        data-testid="topnav-back-to-dashboard"
                    >
                        <img src={arrowLeftIcon}
                            alt=""
                        />
                    </NavIconButton>
                    {logoButton}
                    <SceneName />
                    <MenuIcon
                        isMenuOpen={isMenuOpen}
                        setIsMenuOpen={setIsMenuOpen}
                        userMenuButtonRef={userMenuButtonRef}
                    />
                </Section>
            </LeftSide>
            {panelToggles}
            {playRemixButtons}
            <Right>
                <EditorButton className="compact-save"
                    $isBlue={false}
                    type="button"
                    onClick={handleSave}
                    disabled={saveStatus === "Saving"}
                    $disabled={saveStatus === "Saving"}
                >
                    {saveStatus === "Saving" ? "Saving" : "Save"}
                </EditorButton>
                <TopMenu />
            </Right>
            {isMenuOpen && <AppMenu close={handleCloseMenu}
                userMenuButtonRef={userMenuButtonRef}
                           />}
        </StyledNav>
    );
};
