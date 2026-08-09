import React from "react";

import "./css/Editor.css";
import * as THREE from "three";
import {PiecewiseBezier} from "three.quarks";

import Editor from "./Editor";
import {getCopilotProvider} from "../copilot";
import {AssetVersion} from "@stem/network/api/asset";
import {DomainAssetDto} from "@stem/network/api/client/api";
import {NPCBackendData} from "@stem/network/api/npc";
import {CSGOperation} from "@stem/editor-oss/command/Commands";
import {RIGHT_PANEL_VERSIONS} from "@stem/editor-oss/context/appStateTypes";
import HUDGameContextProvider from "@stem/editor-oss/context/HUDGameContext";
import HUDInGameMenuContextProvider from "@stem/editor-oss/context/HUDInGameMenuContext";
import HUDStartGameMenuContextProvider from "@stem/editor-oss/context/HUDStartGameMenuContext";
import ModelAnimationCombinerContextProvider from "@stem/editor-oss/context/ModelAnimationCombinerContext";
import EngineRuntime, {ApplicationMode} from "@stem/editor-oss/EngineRuntime";
import global from "@stem/editor-oss/global";
import i18n from "@stem/editor-oss/i18n/config";
import {showToast} from "@stem/editor-oss/showToast";
import {LoadingAnimation} from "../ui/progress/LoadingAnimation";
import {IEditorUser} from "../v2/pages/types";
import {ActionBar} from "./assets/v2/ActionBar/ActionBar";
import {AiCopilot} from "./assets/v2/AiCopilot/AiCopilot";
import {AiNpcCreator} from "./assets/v2/AiNpcCreator/AiNpcCreator";
import {ModelAnimationCombiner} from "./assets/v2/AnimationCombiner/ModelAnimationCombiner";
import {AssetPublishConfirmationPopup} from "./assets/v2/AssetPublishConfirmationPopup/AssetPublishConfirmationPopup";
import {AssetsLibrary} from "./assets/v2/AssetsLibrary/AssetsLibrary";
import {CodeEditorShell} from "./assets/v2/AssetsLibrary/CodeEditor/CodeEditorShell";
import type {InitialSelection, CodeEditorPopoutPayload} from "./assets/v2/AssetsLibrary/CodeEditor/types";
import {RevisionListProps} from "./assets/v2/AssetsLibrary/RevisionSection/RevisionList";
import {RevisionPopup} from "./assets/v2/AssetsLibrary/RevisionSection/RevisionPopup";
import {UPLOAD_FILE_TYPE, UploadViewProps, UploadView} from "./assets/v2/AssetsLibrary/UploadView/UploadView";
const AvatarCreator = (() => null) as React.ComponentType<{mode: "user" | "game"}>;
import {PopoutEditorWindow, PopoutIndicator, PopoutEditorEntry} from "./assets/v2/BehaviorEditorPopout";
import {CollaboratorsModal} from "./assets/v2/CollaboratorsModal/CollaboratorsModal";
import {CSGOrderDialog} from "./assets/v2/common/CSGOrderDialog";
import {isDesktopDevice, openPopupWindow} from "./assets/v2/common/hooks/usePopoutWindow";
import {MobileOrientationOverlay} from "./assets/v2/common/MobilePortraitOverlay/MobilePortraitOverlay";
import {CopilotPreviewProvider} from "./assets/v2/CopilotWorkspace/CopilotPreviewContext";
import {CopilotWorkspaceControls} from "./assets/v2/CopilotWorkspace/CopilotWorkspaceControls";
import {GenerationJobsMonitor} from "./assets/v2/ContextMenu/Create/GenerationJobsMonitor";
import {DebuggerPopup} from "./assets/v2/DebuggerPopup";
import {FTUEModal} from "./assets/v2/FTUEModal/FTUEModal";
import {HUDEditView} from "./assets/v2/HUD/HUDEditView/HUDEditView";
import {LeftPanel} from "./assets/v2/LeftPanel/LeftPanel";
import {OldRevisionBanner} from "./assets/v2/OldRevisionBanner/OldRevisionBanner";
import {ReadOnlyBadge} from "./assets/v2/ReadOnlyBadge/ReadOnlyBadge";
import {BezierCurveEditorModal} from "./assets/v2/RightPanel/common/BezierCurveEditor/BezierCurveEditorModal";
import {MaterialInfo} from "./assets/v2/RightPanel/ModelEditorButtons/ModelEditorButtons";
import RightPanel from "./assets/v2/RightPanel/RightPanel";
import {StemPublishPanel} from "./assets/v2/StemPublishPanel/StemPublishPanel";
import {TopNav} from "./assets/v2/TopNav/TopNav";
import {VFXEditor} from "./assets/v2/VFXEditor/VFXEditor";
import {StemEditorModal} from "./stem-editor/StemEditorModal";
import {StemUpdatePrompt} from "./stem-editor/StemUpdatePrompt";
import {
    COMPACT_WORKSPACE_QUERY,
    type CompactWorkspacePanel,
    resolveCompactWorkspaceShortcut,
    toggleCompactWorkspacePanel as resolvePanelToggle,
} from "./responsiveWorkspace";

const FTUE_STORAGE_KEY = "erth-ftue-seen";
const CODE_EDITOR_PINNED_KEY = "erth-code-editor-pinned";
const CODE_EDITOR_WIDTH_KEY = "erth-code-editor-width";
const CODE_EDITOR_OPEN_KEY = "erth-code-editor-open";
const DEFAULT_PINNED_WIDTH = 50; // percent
const {t} = i18n;

interface IEditorComponentProps {
    setActiveRightPanel: (panel: RIGHT_PANEL_VERSIONS) => void;
    projectPhase: number;
    dbUser: IEditorUser | null;
    hasProjectID: boolean;
    isAdmin: boolean;
    /**
     * When false, hide the LeftPanel and RightPanel so the AI Copilot is the
     * only visible editor surface. Set false when the user enters via the
     * "Create with AI" flow; the "Advanced Mode" menu item flips it back true.
     */
    advancedMode: boolean;
}

interface IAssetPublishConfirmation {
    asset: DomainAssetDto;
    assetDefaultIcon?: string;
    publishNotice: string;
    newVersion: AssetVersion;
    newThumbnailFile?: File;
}

// ---------------------------------------------------------------------------
// Resizable pinned wrapper for the code editor
// ---------------------------------------------------------------------------

const PinnedCodeEditorWrapper: React.FC<{
    widthPercent: number;
    onWidthChange: (pct: number) => void;
    children: React.ReactNode;
}> = ({widthPercent, onWidthChange, children}) => {
    const containerRef = React.useRef<HTMLDivElement>(null);
    const dragging = React.useRef(false);

    const handleMouseDown = React.useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            dragging.current = true;
            const startX = e.clientX;
            const startPct = widthPercent;

            const onMove = (ev: MouseEvent) => {
                if (!dragging.current) return;
                const dx = startX - ev.clientX; // left handle, right-anchored: drag left = wider
                const newPct = Math.min(80, Math.max(15, startPct + (dx / window.innerWidth) * 100));
                onWidthChange(Math.round(newPct));
            };

            const onUp = () => {
                dragging.current = false;
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
            };

            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        },
        [widthPercent, onWidthChange],
    );

    return (
        <div
            ref={containerRef}
            style={{
                position: "fixed",
                top: 48, // below TopNav (EDITOR_TOP_NAV_HEIGHT)
                right: 0,
                width: `${widthPercent}%`,
                height: "calc(100% - 48px)",
                zIndex: 100,
                background: "var(--theme-container-main-bg)",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column" as const,
            }}
        >
            {/* Left-edge resize handle */}
            <div
                onMouseDown={handleMouseDown}
                style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: 5,
                    height: "100%",
                    cursor: "col-resize",
                    zIndex: 10,
                    borderLeft: "1px solid var(--theme-container-divider)",
                }}
            />
            <div style={{flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" as const}}>
                {children}
            </div>
        </div>
    );
};

class EditorComponent extends React.Component<IEditorComponentProps> {
    state = {
        maskText: t("Waiting..."),
        elements: [] as any[],
        playerStarted: false,
        isReady: false,
        libraryPanelOpened: true,
        HUDEditViewOpened: false,
        showLoding: false,
        showRightPanel: true,
        rightPanelWidth: parseInt(localStorage.getItem("right_panel_width") || "258", 10),
        isRightPanelVisible: false,
        showStemPublishPanel: false,
        stemPublishPanelData: null as DomainAssetDto | null,
        assetPublishConfirmation: null as IAssetPublishConfirmation | null,
        showAssetsLibrary: false,
        isUploadViewOpen: false,
        uploadViewProps: {
            uploadForScene: false,
            fileType: UPLOAD_FILE_TYPE.MODEL, // Default to model upload
        } as Omit<UploadViewProps, "closeUpload" | "closeView">,
        isBezierCurveEditorOpen: false,
        bezierCurveEditorProps: {
            bezierCurve: null as PiecewiseBezier | null,
            onChangeBezierCurve: () => {},
        },
        showUI: true,
        showModelAnimationCombiner: false,
        selectedMaterialInfo: null as MaterialInfo | null,
        showVFXEditor: false,
        showCodeEditor: false,
        codeEditorPinned: localStorage.getItem(CODE_EDITOR_PINNED_KEY) === "true",
        codeEditorPinnedWidth: parseInt(
            localStorage.getItem(CODE_EDITOR_WIDTH_KEY) || String(DEFAULT_PINNED_WIDTH),
            10,
        ),
        codeEditorOptions: {
            initialSelection: undefined as InitialSelection | undefined,
        },
        showCollaboratorsModal: false,
        showAiNpcCreator: false,
        editNpc: null as NPCBackendData | null,
        revisionData: null as null | RevisionListProps,
        showGameDebugPanel: false,
        popoutEditors: [] as PopoutEditorEntry[],
        showFTUE: false,
        showAiCopilot: false,
        showAvatarCreator: false,
        avatarCreatorMode: "game" as "user" | "game",
        aiCopilotWidth: parseInt(localStorage.getItem("ai_copilot_width") || "258", 10),
        stemEditorAssetId: null as string | null,
        stemEditorSceneId: null as string | null,
        pendingStemUpdate: null as {assetId: string; revisionId: string} | null,
        csgDialogData: null as {objects: THREE.Object3D[]; operation: CSGOperation} | null,
        cadModeActive: false,
        orientationBlocked:
            typeof window !== "undefined" &&
            window.matchMedia("(max-width: 600px)").matches &&
            window.innerHeight >= window.innerWidth,
        isCompactWorkspace: typeof window !== "undefined" && window.matchMedia(COMPACT_WORKSPACE_QUERY).matches,
        compactWorkspacePanel: null as CompactWorkspacePanel,
    };
    editor: Editor | null | undefined = null;
    popoutFocusCallbacks: Map<string, () => void> = new Map();
    pendingFTUE: boolean = false;
    aiFocusedInteractionLockApplied: boolean = false;
    compactWorkspaceMediaQuery: MediaQueryList | null = null;

    /**
     * Push the camera's projection so world origin lands at the center of
     * the *visible* viewport (the area not covered by the AI Copilot + Code
     * Editor) when in AI-focused mode. Uses camera.setViewOffset to render
     * as if the canvas were wider, with the actually-rendered sub-rectangle
     * offset to the right — the result is the scene's centerline shifts
     * left, matching the visible viewport's center.
     *
     * In Advanced Mode (or when the copilot / code editor aren't taking up
     * the right side), clears the offset so the camera re-centers normally.
     */
    private updateAIFocusedViewOffset = () => {
        const app = global.app as EngineRuntime | undefined;
        const cam = app?.camera;
        if (!cam || typeof cam.setViewOffset !== "function") return;

        const w = window.innerWidth;
        const h = window.innerHeight;

        // Advanced Mode and classic fullscreen play use the whole viewport.
        // Default workspace keeps Copilot visible beside the playable canvas,
        // so the offset remains active even while play mode is running.
        if (this.props.advancedMode) {
            if (cam.view?.enabled) cam.clearViewOffset();
            return;
        }

        // Right-occluded width = copilot width + its 12px right-gutter to
        // the code editor + the code editor's % width.
        const copilotPx = this.state.aiCopilotWidth;
        const codeEditorPx = this.state.showCodeEditor && this.state.codeEditorPinned
            ? (this.state.codeEditorPinnedWidth / 100) * w
            : 0;
        const gap = codeEditorPx > 0 ? 12 : 0;
        const occludedRight = copilotPx + gap + codeEditorPx;

        if (occludedRight <= 0) {
            if (cam.view?.enabled) cam.clearViewOffset();
            return;
        }

        // Shift projection so world origin appears at (w - occludedRight) / 2
        // in screen space — the center of the visible viewport strip.
        cam.setViewOffset(w + occludedRight, h, occludedRight, 0, w, h);
    };

    private applyAIFocusedSceneInteractionLock = () => {
        const app = global.app as EngineRuntime | undefined;
        if (!app?.editor || app.mode !== ApplicationMode.EDIT) {
            this.aiFocusedInteractionLockApplied = false;
            return;
        }

        const shouldLock = !this.props.advancedMode && !this.state.playerStarted;
        if (shouldLock) {
            if (!this.aiFocusedInteractionLockApplied) {
                app.editor.select(null);
            }
            app.disableClickEvents = true;
        } else if (this.aiFocusedInteractionLockApplied) {
            app.disableClickEvents = false;
        }

        this.aiFocusedInteractionLockApplied = shouldLock;
    };

    componentDidMount() {
        this.compactWorkspaceMediaQuery = window.matchMedia(COMPACT_WORKSPACE_QUERY);
        this.compactWorkspaceMediaQuery.addEventListener("change", this.handleCompactWorkspaceChange);
        this.handleCompactWorkspaceChange(this.compactWorkspaceMediaQuery);
        window.addEventListener("keydown", this.handleWorkspacePanelShortcut);

        const app = global.app as EngineRuntime | undefined;
        if (app) {
            this.editor = app.editor;

            if (this.editor) {
                this.editor.component = this;
            }
            app.on("appModeEntered.EditorComponentInteractionLock", this.applyAIFocusedSceneInteractionLock);
            void app.setMode(ApplicationMode.EDIT);

            this.setState({isReady: true});

            app.on("playerStarted.EditorComponent", () => {
                this.setState({
                    playerStarted: true,
                });
            });

            app.on("playerStopped.EditorComponent", () => {
                this.setState({
                    playerStarted: false,
                });
            });

            // Restore code editor if it was previously open. In non-advanced
            // mode the code editor is hidden by default — users open it via
            // the "Code" button in the AI Copilot header. If the user opened
            // it last session, this restore brings it back.
            if (localStorage.getItem(CODE_EDITOR_OPEN_KEY) === "true") {
                this.setState({showCodeEditor: true});
            }

            // Close code editor when CAD mode activates
            app.on("cadModeChanged.EditorComponent", (data: {enabled: boolean}) => {
                if (data.enabled) {
                    this.setState({cadModeActive: true, showCodeEditor: false});
                } else {
                    this.setState({cadModeActive: false});
                }
            });

            // Check for FTUE — defer until template panel is dismissed
            const hasSeenFTUE = localStorage.getItem(FTUE_STORAGE_KEY);
            if (!hasSeenFTUE) {
                if (this.props.projectPhase === 2 && !this.props.hasProjectID) {
                    this.pendingFTUE = true;
                } else {
                    this.setState({showFTUE: true});
                }
            }
        }
    }

    componentWillUnmount() {
        this.compactWorkspaceMediaQuery?.removeEventListener("change", this.handleCompactWorkspaceChange);
        window.removeEventListener("keydown", this.handleWorkspacePanelShortcut);
        const app = global.app as EngineRuntime | undefined;
        if (app) {
            const acpClient = getCopilotProvider();
            if (acpClient) {
                void acpClient.cancelCurrentTask();
                acpClient.disconnect();
            }
            app.on("playerStarted.EditorComponent", null);
            app.on("playerStopped.EditorComponent", null);
            app.on("cadModeChanged.EditorComponent", null);
            app.on("appModeEntered.EditorComponentInteractionLock", null);
            if (this.aiFocusedInteractionLockApplied && app.mode === ApplicationMode.EDIT) {
                app.disableClickEvents = false;
            }
        }
    }

    componentDidUpdate(prevProps: IEditorComponentProps, prevState: typeof this.state) {
        // Show deferred FTUE once template panel is dismissed
        if (this.pendingFTUE && prevProps.projectPhase === 2 && this.props.projectPhase !== 2) {
            this.pendingFTUE = false;
            this.setState({showFTUE: true});
        }

        // Check if any of the relevant panel states changed
        const prevAnyOpen = prevState.showModelAnimationCombiner || prevState.showVFXEditor;
        const currAnyOpen = this.state.showModelAnimationCombiner || this.state.showVFXEditor;

        if (prevAnyOpen !== currAnyOpen) {
            if (currAnyOpen) {
                global.app?.call("pauseRender");
            } else {
                global.app?.call("resumeRender");
            }
        }

        if (
            prevProps.advancedMode !== this.props.advancedMode ||
            prevState.playerStarted !== this.state.playerStarted
        ) {
            this.applyAIFocusedSceneInteractionLock();
        }
    }

    handleLoading = (show: boolean) => {
        this.setState({showLoding: show});
    };

    showLibraryPanel = (value: boolean) => {
        this.setState({
            libraryPanelOpened: value,
        });
    };

    handleCompactWorkspaceChange = (event: MediaQueryListEvent | MediaQueryList) => {
        this.setState({
            isCompactWorkspace: event.matches,
            compactWorkspacePanel: event.matches ? null : this.state.compactWorkspacePanel,
        });
    };

    toggleCompactWorkspacePanel = (panel: Exclude<CompactWorkspacePanel, null>) => {
        this.setState((previous: typeof this.state) => ({
            compactWorkspacePanel: resolvePanelToggle(previous.compactWorkspacePanel, panel),
        }));
    };

    closeCompactWorkspacePanel = () => {
        this.setState({compactWorkspacePanel: null});
    };

    handleOrientationBlockingChange = (blocked: boolean) => {
        if (blocked !== this.state.orientationBlocked) {
            this.setState({orientationBlocked: blocked});
        }
    };

    handleWorkspacePanelShortcut = (event: KeyboardEvent) => {
        if (!this.state.isCompactWorkspace || !this.props.advancedMode) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest("input, textarea, select, [contenteditable='true']")) return;

        const result = resolveCompactWorkspaceShortcut(
            this.state.compactWorkspacePanel,
            event.key,
            event.altKey,
        );
        if (result.handled) {
            event.preventDefault();
            this.setState({compactWorkspacePanel: result.panel});
        }
    };

    setPlayerStarted = (value: boolean) => {
        this.setState({
            playerStarted: value,
        });
    };

    showHUDEditView = (value: boolean) => {
        this.setState({
            HUDEditViewOpened: value,
        });
    };

    toggleUI = () => {
        this.setState({
            showUI: !this.state.showUI,
        });
    };

    hideUI = () => {
        if (!this.props.advancedMode) {
            this.setState({showUI: true});
            return;
        }
        this.setState({
            showUI: false,
        });
    };

    showUI = () => {
        this.setState({
            showUI: true,
        });
    };

    createElement(type: React.ElementType, props: Record<string, unknown>, children: React.ReactNode) {
        let ref = React.createRef();
        props.ref = ref;
        return React.createElement(type, props, children);
    }

    addElement(element: React.ReactElement, callback?: () => void) {
        let elements = this.state.elements;

        elements.push(element);

        this.setState({elements}, callback);
    }

    removeElement(element: unknown, callback?: () => void) {
        let elements = this.state.elements;

        let index = elements.findIndex(n => n === element || (n.ref && n.ref.current === element));

        if (index > -1) {
            elements.splice(index, 1);
        }

        this.setState({elements}, callback);
    }

    closeCodeEditor = () => {
        localStorage.setItem(CODE_EDITOR_OPEN_KEY, "false");
        this.setState({
            showCodeEditor: false,
            codeEditorOptions: {
                initialSelection: undefined,
            },
        });
    };

    togglePinCodeEditor = () => {
        if (!isDesktopDevice()) return; // split mode disabled on mobile
        this.setState((prev: typeof this.state) => {
            const newPinned = !prev.codeEditorPinned;
            localStorage.setItem(CODE_EDITOR_PINNED_KEY, String(newPinned));
            return {codeEditorPinned: newPinned};
        });
    };

    setPinnedWidth = (widthPercent: number) => {
        localStorage.setItem(CODE_EDITOR_WIDTH_KEY, String(widthPercent));
        this.setState({codeEditorPinnedWidth: widthPercent});
    };

    registerPopoutFocus = (id: string, focusFn: () => void) => {
        this.popoutFocusCallbacks.set(id, focusFn);
    };

    openCodeEditor = (initialSelection?: InitialSelection) => {
        if (this.state.cadModeActive) {
            showToast({type: "info", title: "Exit CAD mode to open the code editor"});
            return;
        }
        localStorage.setItem(CODE_EDITOR_OPEN_KEY, "true");
        this.setState({
            showCodeEditor: true,
            codeEditorOptions: {initialSelection},
        });
    };

    /**
     * Opens the code editor with the default non-advanced layout: pinned at
     * ~30% width alongside the AI Copilot. Used by the "Code" button in the
     * AI Copilot header when the editor is hidden by default.
     */
    openCodeEditorPinned = () => {
        if (this.state.cadModeActive) {
            showToast({type: "info", title: "Exit CAD mode to open the code editor"});
            return;
        }
        localStorage.setItem(CODE_EDITOR_OPEN_KEY, "true");
        localStorage.setItem(CODE_EDITOR_PINNED_KEY, "true");
        this.setState((prev: typeof this.state) => ({
            showCodeEditor: true,
            codeEditorPinned: true,
            codeEditorPinnedWidth: prev.codeEditorPinnedWidth > 40 ? 30 : prev.codeEditorPinnedWidth,
        }));
    };

    clearCreateKind = () => {
        this.setState((prev: typeof this.state) => {
            const sel = prev.codeEditorOptions.initialSelection;
            if (!sel?.createKind) return null; // no update needed
            const rest = {...sel};
            delete rest.createKind;
            return {codeEditorOptions: {initialSelection: rest}};
        });
    };

    openAiNpcCreator = (npc?: NPCBackendData | null) => {
        this.setState({
            showAiNpcCreator: true,
            editNpc: npc ?? null,
        });
    };

    closeAiNpcCreator = () => {
        this.setState({
            showAiNpcCreator: false,
            editNpc: null,
        });
    };

    openUploadView = (props: Omit<UploadViewProps, "closeUpload" | "closeView">) => {
        this.setState({
            isUploadViewOpen: true,
            uploadViewProps: props,
        });
    };

    closeUploadView = () => {
        this.setState({
            isUploadViewOpen: false,
        });
    };

    openBezierCurveEditor = (bezierCurve: PiecewiseBezier, onChangeBezierCurve: (value: PiecewiseBezier) => void) => {
        this.setState({
            isBezierCurveEditorOpen: true,
            bezierCurveEditorProps: {
                bezierCurve,
                onChangeBezierCurve,
            },
        });
    };

    closeBezierCurveEditor = () => {
        this.setState({
            isBezierCurveEditorOpen: false,
            bezierCurveEditorProps: {
                bezierCurve: null,
                onChangeBezierCurve: () => {},
            },
        });
    };

    showCollaboratorsModal = () => {
        this.setState({
            showCollaboratorsModal: true,
        });
    };

    openStemEditor = (assetId: string) => {
        const sceneId = this.editor?.sceneID ?? null;
        this.setState({stemEditorAssetId: assetId, stemEditorSceneId: sceneId});
    };

    closeStemEditor = () => {
        this.setState({stemEditorAssetId: null, stemEditorSceneId: null});
    };

    handleStemSaved = (assetId: string, revisionId: string) => {
        // Defer the "update instances?" prompt until the stem editor modal
        // closes. Latest save wins if the user saves multiple times.
        this.setState({pendingStemUpdate: {assetId, revisionId}});
        console.info(`[StemEditor] Stem ${assetId} saved as revision ${revisionId}`);
    };

    handleStemUpdatePromptDone = () => {
        this.setState({pendingStemUpdate: null});
    };

    showCSGDialog = (objects: THREE.Object3D[], operation: CSGOperation) => {
        this.setState({
            csgDialogData: {objects, operation},
        });
    };

    handleCSGConfirm = async (orderedObjects: THREE.Object3D[]) => {
        const {csgDialogData} = this.state;
        if (!this.editor || !csgDialogData) return;

        try {
            const {CSGCommand} = await import("@stem/editor-oss/command/Commands");
            const command = new CSGCommand(orderedObjects, csgDialogData.operation);
            await this.editor.execute(command);
        } catch (error) {
            console.error(`CSG ${csgDialogData.operation} operation failed:`, error);
            showToast({type: "error", title: `CSG operation failed: ${String(error)}`});
        } finally {
            this.setState({csgDialogData: null});
        }
    };

    handleCSGCancel = () => {
        this.setState({csgDialogData: null});
    };

    addPanelsVisibilityListener() {
        document.addEventListener("keydown", e => {
            const isMac = /Mac/i.test(navigator.userAgent);
            if ((isMac && e.metaKey && e.key === ".") || (!isMac && e.ctrlKey && e.key === ".")) {
                this.toggleUI();
            }
        });
    }

    // Revision

    openRevisionPopup = (data: RevisionListProps) => {
        this.setState({revisionData: data});
    };

    updatePopupRevisionId = (newRevisionID: string) => {
        this.setState({revisionData: {...this.state.revisionData, currentRevisionId: newRevisionID}});
    };

    closeRevisionPopup = () => {
        this.setState({revisionData: null});
    };

    // Debug panel

    openGameDebugPanel = () => {
        this.setState({showGameDebugPanel: true});
    };

    closeGameDebugPanel = () => {
        this.setState({showGameDebugPanel: false});
    };

    popOutCodeEditor = (payload?: CodeEditorPopoutPayload) => {
        // Open the popup synchronously inside the click handler so the
        // browser recognises the user-gesture and does not block it.
        const popupWindow = openPopupWindow("Stem Studio Code Editor");
        if (!popupWindow) {
            // Browser blocked the popup — keep the inline editor open.
            showToast({type: "error", title: "Popup blocked — please allow popups for this site."});
            return;
        }

        const id = `code-editor-${Date.now()}`;
        const entry: PopoutEditorEntry = {
            id,
            mode: "code-editor",
            title: "Stem Studio Code Editor",
            codeEditorProps: {
                sceneId: this.editor?.sceneID || "",
                initialSelection: payload?.initialSelection ?? this.state.codeEditorOptions.initialSelection,
            },
            popupWindow,
        };
        localStorage.setItem(CODE_EDITOR_PINNED_KEY, "false");
        this.setState({
            showCodeEditor: false,
            codeEditorPinned: false,
            popoutEditors: [...this.state.popoutEditors, entry],
        });
    };

    closePopoutEditor = (id: string) => {
        this.popoutFocusCallbacks.delete(id);
        this.setState({
            popoutEditors: this.state.popoutEditors.filter((e: PopoutEditorEntry) => e.id !== id),
        });
    };

    restoreAllPopouts = () => {
        this.popoutFocusCallbacks.clear();
        this.setState({popoutEditors: []});
    };

    showFTUEModal = () => {
        this.setState({showFTUE: true});
    };

    closeFTUE = () => {
        this.setState({showFTUE: false});
        localStorage.setItem(FTUE_STORAGE_KEY, "true");
    };

    // Publishing assets

    openStemPublishPanel = (stem: DomainAssetDto) => {
        this.setState({showStemPublishPanel: true, stemPublishPanelData: stem});
    };

    closeStemPublishPanel = () => {
        this.setState({showStemPublishPanel: false});
    };

    openAssetPublishConfirmation = (data: IAssetPublishConfirmation) => {
        this.setState({assetPublishConfirmation: data});
    };

    closeAssetPublishConfirmation = () => {
        this.setState({assetPublishConfirmation: null});
    };

    // Avatar creator

    openAvatarCreator = (mode: "user" | "game" = "game") => {
        this.setState({showAvatarCreator: true, avatarCreatorMode: mode});
    };

    closeAvatarCreator = () => {
        this.setState({showAvatarCreator: false});
    };

    // AI copilot

    openAiCopilot = () => {
        this.setState({showAiCopilot: true});
    };

    closeAiCopilot = () => {
        this.setState({showAiCopilot: false});
    };

    toggleAiCopilot = () => {
        this.setState({showAiCopilot: !this.state.showAiCopilot});
    };

    openAiCopilotTerminal = () => {
        this.setState({showAiCopilot: true}, () => {
            global.app?.call("copilotTerminal");
        });
    };

    setSelectedMaterialInfo = (value: MaterialInfo | null) => {
        this.setState({selectedMaterialInfo: value});
    };

    render() {
        const {
            playerStarted,
            showUI,
            showRightPanel,
            showStemPublishPanel,
            stemPublishPanelData,
            assetPublishConfirmation,
            HUDEditViewOpened,
            showAssetsLibrary,
            showModelAnimationCombiner,
            showVFXEditor,
            elements,
            showCollaboratorsModal,
            revisionData,
            showFTUE,
            showLoding,
            showAiCopilot,
            showAvatarCreator,
        } = this.state;

        // Hide the editor right panel when the AI copilot is open AND the code editor is pinned
        const effectiveShowRightPanel =
            showRightPanel && !(showAiCopilot && this.state.codeEditorPinned && this.state.showCodeEditor);

        // Width of the pinned code editor (0 when not pinned/not shown)
        const pinnedCEWidth =
            this.state.showCodeEditor && this.state.codeEditorPinned ? this.state.codeEditorPinnedWidth : 0;

        return (
            <HUDGameContextProvider>
                <HUDStartGameMenuContextProvider>
                    <HUDInGameMenuContextProvider>
                        <CopilotPreviewProvider app={global.app as EngineRuntime}>
                        <MobileOrientationOverlay
                            policy="requireLandscape"
                            applyOnNarrowViewport
                            onBlockingChange={this.handleOrientationBlockingChange}
                        />
                        <div
                            aria-hidden={this.state.orientationBlocked || undefined}
                            inert={this.state.orientationBlocked}
                            style={{display: "contents"}}
                        >
                        <TopNav
                            playerStarted={playerStarted}
                            workspaceMode={!this.props.advancedMode}
                            showWorkspacePanelToggles={this.props.advancedMode && this.state.isCompactWorkspace}
                            activeWorkspacePanel={this.state.compactWorkspacePanel}
                            onToggleHierarchy={() => this.toggleCompactWorkspacePanel("hierarchy")}
                            onToggleInspector={() => this.toggleCompactWorkspacePanel("inspector")}
                        />

                        <AiCopilot
                            isOpen={(showAiCopilot || !this.props.advancedMode) && showUI}
                            setIsOpen={value => this.setState({showAiCopilot: value})}
                            pinnedCodeEditorWidth={pinnedCEWidth}
                            onResize={width => this.setState({aiCopilotWidth: width})}
                            onOpenCodeEditor={!this.props.advancedMode ? this.openCodeEditorPinned : undefined}
                        />

                        {showAvatarCreator && (
                            <React.Suspense fallback={null}>
                                <AvatarCreator mode={this.state.avatarCreatorMode} />
                            </React.Suspense>
                        )}

                        {showUI && (
                            <>
                                <ReadOnlyBadge />
                                <OldRevisionBanner />
                                {!this.props.advancedMode && (
                                    <CopilotWorkspaceControls
                                        aiCopilotWidth={this.state.aiCopilotWidth}
                                        pinnedCodeEditorWidth={pinnedCEWidth}
                                    />
                                )}
                                {this.props.advancedMode && (
                                    <LeftPanel
                                        openAssetsLibrary={() => this.setState({showAssetsLibrary: true})}
                                        drawerMode={this.state.isCompactWorkspace}
                                        isOpen={!this.state.isCompactWorkspace || this.state.compactWorkspacePanel === "hierarchy"}
                                        onRequestClose={this.closeCompactWorkspacePanel}
                                    />
                                )}

                                {this.props.advancedMode && effectiveShowRightPanel && !showStemPublishPanel &&
                                    (!this.state.isCompactWorkspace || this.state.compactWorkspacePanel === "inspector") && (
                                    <RightPanel
                                        openUIPanel={() => this.showHUDEditView(true)}
                                        showModelAnimationCombiner={() =>
                                            this.setState({showModelAnimationCombiner: true})
                                        }
                                        onResize={width => this.setState({rightPanelWidth: width})}
                                        onVisibilityChange={visible => this.setState({isRightPanelVisible: visible})}
                                        pinnedCodeEditorWidth={pinnedCEWidth}
                                        aiCopilotOffsetRight={
                                            (showAiCopilot || !this.props.advancedMode) && showUI
                                                ? this.state.aiCopilotWidth
                                                : 0
                                        }
                                        drawerMode={this.state.isCompactWorkspace}
                                        onRequestClose={this.closeCompactWorkspacePanel}
                                    />
                                )}

                                {showStemPublishPanel && !!stemPublishPanelData && <StemPublishPanel />}
                                {!!assetPublishConfirmation && <AssetPublishConfirmationPopup />}

                                {showAssetsLibrary && (
                                    <AssetsLibrary close={() => this.setState({showAssetsLibrary: false})} />
                                )}

                                {this.state.isUploadViewOpen && (
                                    <UploadView
                                        closeView={() =>
                                            this.setState({
                                                isUploadViewOpen: false,
                                            })
                                        }
                                        closeUpload={() =>
                                            this.setState({
                                                isUploadViewOpen: false,
                                            })
                                        }
                                        {...this.state.uploadViewProps}
                                    />
                                )}

                                {/* Animation Combiner */}
                                {showModelAnimationCombiner && (
                                    <ModelAnimationCombinerContextProvider>
                                        <ModelAnimationCombiner
                                            onClose={() => this.setState({showModelAnimationCombiner: false})}
                                            model={this.editor?.selected as THREE.Object3D<THREE.Object3DEventMap>}
                                        />
                                    </ModelAnimationCombinerContextProvider>
                                )}

                                {/* Material Editor */}
                                {/* {showMaterialEditor && (
                                    <ModelAnimationCombinerContextProvider>
                                        <MaterialEditor
                                            materialInfo={this.state.selectedMaterialInfo}
                                            onClose={this.closeMaterialEditor}
                                        />
                                    </ModelAnimationCombinerContextProvider>
                                )} */}
                                {/* VFX Editor */}
                                {showVFXEditor && <VFXEditor onClose={() => this.setState({showVFXEditor: false})} />}

                                {/* HUD Edit View */}
                                {HUDEditViewOpened && <HUDEditView onClose={() => this.showHUDEditView(false)} />}

                                {this.state.showCodeEditor && !this.state.codeEditorPinned && (
                                    <CodeEditorShell
                                        sceneId={this.editor?.sceneID || ""}
                                        initialSelection={this.state.codeEditorOptions.initialSelection}
                                        onClose={this.closeCodeEditor}
                                        onPopOut={isDesktopDevice() ? this.popOutCodeEditor : undefined}
                                        onPin={isDesktopDevice() ? this.togglePinCodeEditor : undefined}
                                        isPinned={false}
                                        onCreateKindConsumed={this.clearCreateKind}
                                    />
                                )}

                                {this.state.showCodeEditor && this.state.codeEditorPinned && (
                                    <PinnedCodeEditorWrapper
                                        widthPercent={this.state.codeEditorPinnedWidth}
                                        onWidthChange={this.setPinnedWidth}
                                    >
                                        <CodeEditorShell
                                            sceneId={this.editor?.sceneID || ""}
                                            initialSelection={this.state.codeEditorOptions.initialSelection}
                                            onClose={this.closeCodeEditor}
                                            onPopOut={isDesktopDevice() ? this.popOutCodeEditor : undefined}
                                            onPin={isDesktopDevice() ? this.togglePinCodeEditor : undefined}
                                            isPinned
                                            onCreateKindConsumed={this.clearCreateKind}
                                        />
                                    </PinnedCodeEditorWrapper>
                                )}

                                {/* Popout editor windows */}
                                {this.state.popoutEditors.map(entry => (
                                    <PopoutEditorWindow
                                        key={entry.id}
                                        entry={entry}
                                        onClose={() => this.closePopoutEditor(entry.id)}
                                        onRegisterFocus={this.registerPopoutFocus}
                                        onRestoreInline={selection => {
                                            this.closePopoutEditor(entry.id);
                                            this.openCodeEditor(selection);
                                        }}
                                    />
                                ))}

                                {/* Debugger popup (auto-opens when breakpoints are active) */}
                                <DebuggerPopup />

                                {showCollaboratorsModal && (
                                    <CollaboratorsModal
                                        sceneId={this.editor?.sceneID || ""}
                                        close={() => this.setState({showCollaboratorsModal: false})}
                                    />
                                )}

                                {/* AI NPC Creator */}
                                {this.state.showAiNpcCreator && (
                                    <AiNpcCreator
                                        isOpen={this.state.showAiNpcCreator}
                                        onClose={this.closeAiNpcCreator}
                                        editNpc={this.state.editNpc}
                                    />
                                )}

                                {revisionData && (
                                    <RevisionPopup
                                        {...revisionData}
                                        onClose={this.closeRevisionPopup}
                                    />
                                )}

                                {/* Bezier Curve Editor */}
                                {this.state.isBezierCurveEditorOpen &&
                                    this.state.bezierCurveEditorProps.bezierCurve && (
                                        <BezierCurveEditorModal
                                            value={this.state.bezierCurveEditorProps.bezierCurve}
                                            onChange={this.state.bezierCurveEditorProps.onChangeBezierCurve}
                                            onClose={this.closeBezierCurveEditor}
                                            width={600}
                                            height={400}
                                        />
                                    )}

                                <ActionBar
                                    openGameDebugPanel={this.openGameDebugPanel}
                                    closeGameDebugPanel={this.closeGameDebugPanel}
                                    showGameDebugPanel={this.state.showGameDebugPanel}
                                    pinnedCodeEditorWidth={pinnedCEWidth}
                                    showCodeEditor={this.state.showCodeEditor}
                                />

                                <GenerationJobsMonitor sceneId={this.editor?.sceneID || ""} />

                                <PopoutIndicator
                                    editors={this.state.popoutEditors}
                                    onRestoreAll={this.restoreAllPopouts}
                                />

                                {/* CSG Order Dialog */}
                                {this.state.csgDialogData && (
                                    <CSGOrderDialog
                                        objects={this.state.csgDialogData.objects}
                                        operation={this.state.csgDialogData.operation}
                                        onConfirm={this.handleCSGConfirm}
                                        onCancel={this.handleCSGCancel}
                                    />
                                )}

                                {/* FTUE Modal */}
                                {showFTUE && <FTUEModal onClose={this.closeFTUE} />}

                                {/* Stem Editor Modal */}
                                {this.state.stemEditorAssetId && (
                                    <StemEditorModal
                                        assetId={this.state.stemEditorAssetId}
                                        sceneId={this.state.stemEditorSceneId ?? undefined}
                                        onClose={this.closeStemEditor}
                                        onStemSaved={this.handleStemSaved}
                                    />
                                )}

                                {/* Prompt to update scene instances after stem save */}
                                {this.state.pendingStemUpdate && !this.state.stemEditorAssetId && (
                                    <StemUpdatePrompt
                                        assetId={this.state.pendingStemUpdate.assetId}
                                        revisionId={this.state.pendingStemUpdate.revisionId}
                                        onDone={this.handleStemUpdatePromptDone}
                                    />
                                )}

                                {/* Loading Animation */}
                                <LoadingAnimation show={showLoding} />
                            </>
                        )}

                        {/* Dynamic Elements */}
                        {elements.map((n, i) => (
                            <div key={i}>{n}</div>
                        ))}
                        </div>
                        </CopilotPreviewProvider>
                    </HUDInGameMenuContextProvider>
                </HUDStartGameMenuContextProvider>
            </HUDGameContextProvider>
        );
    }
}

export default EditorComponent;
