import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";

import {
  ActionButton,
  BuildMenuButton,
  BuildPrimaryButton,
  BuildSplitControl,
  Container,
  CollaborationIndicator,
  CollaborationDot,
  MenuPopover,
  MenuItem,
  MenuItemBadge,
  MenuItemDescription,
  MenuItemLabel,
  MenuItemText,
  MenuOverlay,
  DebugButtonWrapper,
  ErrorBadge,
} from "./ActionBar.style";
import { CADActionBarControls } from "./CADActionBarControls";
import {
  CameraOrientationPanel,
  CameraOrientation,
} from "./CameraOrientationPanel";
import {
  BrushIcon,
  ChevronUpIcon,
  HomeIcon,
  ToolsIcon,
  type ActionBarIconComponent,
} from "./icons/ActionBarIcons";
import askIcon from "./icons/askIcon.svg";
import cameraIcon from "./icons/camera.svg";
import gridSnapIcon from "./icons/gridSnap.svg";
import { SnapConfigPanel } from "./SnapConfigPanel";
import { useCollaborationStatus } from "./useCollaborationStatus";
import { useAuthorizationContext } from "@stem/editor-oss/context";
import { RIGHT_PANEL_VERSIONS } from "@stem/editor-oss/context/appStateTypes";
import { Tooltip } from "../common/Tooltip";
import { getEditorDocsUrl } from "../common/docsUrl";
import bugIcon from "./icons/bug.svg";
import infoIcon from "./icons/infoIcon.svg";
import magicAI from "./icons/magic-ai.svg";
import type EngineRuntime from "@stem/editor-oss/EngineRuntime";
import global from "@stem/editor-oss/global";
import { getLogger, LogLevel } from "@stem/editor-oss/utils/Logger";
import {
  EDITOR_KEYBINDINGS,
  KeybindingsPanel,
} from "../BehaviorEditor/KeybindingsPanel";
import { GameDebugPanel, GameLog } from "../GameDebugPanel/GameDebugPanel";
import { installPlanCadSceneSync } from "../PlanMode/planCadEditorBridge";
import { PlanCadToolbar } from "../PlanMode/PlanCadToolbar";
import { QuickBuildToolbar } from "../QuickBuild/QuickBuildToolbar";
import { isCADToolsEnabled } from "../../../cad/settings";
import {
  DEFAULT_UNITS_SETTINGS,
  getSnappingSettings,
  getUnitsSettings,
  mergeSnappingSettings,
} from "../RightPanel/panels/ProjectSettings/constants";
import { SnappingSettings } from "../RightPanel/panels/ProjectSettings/SnappingSection";
import { UnitsSettings } from "../RightPanel/panels/ProjectSettings/UnitsSection";

const LONG_PRESS_DELAY = 500;
const MENU_VIEWPORT_MARGIN = 8;
const MENU_ANCHOR_GAP = 6;
const COPILOT_MENU_WIDTH = 160;
const BUILD_MENU_WIDTH = 240;
const DOCUMENTED_BUILDER_MODE_PARAM_VALUES = new Set([
  "1",
  "quick",
  "plan",
  "cad",
]);
const LEGACY_BUILDER_MODE_PARAM_VALUES = new Set([
  "true",
  "build",
  "builder",
  "bim",
]);
const BUILDER_MODE_STORAGE_PREFIX = "stem:builderMode:";

type BuilderMode = "none" | "quick" | "mesh-cad" | "bim-plan";
type ActiveBuilderMode = Exclude<BuilderMode, "none">;
type BuilderModeRequest =
  | ActiveBuilderMode
  | "none"
  | ((current: BuilderMode) => BuilderMode);
type BuilderModeReason =
  | "url"
  | "restore"
  | "toggle"
  | "menu"
  | "primary"
  | "close"
  | "cad-disabled";
type CameraControlsLike = {
  target?: THREE.Vector3;
  center?: THREE.Vector3;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
  update?: () => void;
  dispatchEvent?: (event: { type: "change" }) => void;
};
type ControlsManagerLike = {
  current?: {
    controls?: CameraControlsLike | null;
  } | null;
};

export { getEditorDocsUrl };

function getActiveCameraControls(
  editor?: { controls?: unknown } | null,
): CameraControlsLike | null {
  const controlsManager = editor?.controls as
    | ControlsManagerLike
    | null
    | undefined;
  return controlsManager?.current?.controls ?? null;
}

function getBuilderStudioMode(): ActiveBuilderMode | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search)
    .get("builder")
    ?.toLowerCase();
  if (
    !value ||
    (!DOCUMENTED_BUILDER_MODE_PARAM_VALUES.has(value) &&
      !LEGACY_BUILDER_MODE_PARAM_VALUES.has(value))
  )
    return null;
  if (value === "plan" || value === "bim") return "bim-plan";
  if (value === "cad") return "mesh-cad";
  return "quick";
}

function getBuilderModeStorageKey(scene?: THREE.Object3D | null) {
  return `${BUILDER_MODE_STORAGE_PREFIX}${scene?.uuid ?? "default"}`;
}

function isActiveBuilderMode(value: string | null): value is ActiveBuilderMode {
  return value === "quick" || value === "mesh-cad" || value === "bim-plan";
}

function readStoredBuilderMode(
  scene?: THREE.Object3D | null,
): ActiveBuilderMode | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(getBuilderModeStorageKey(scene));
    return isActiveBuilderMode(value) ? value : null;
  } catch {
    return null;
  }
}

function persistBuilderMode(
  scene: THREE.Object3D | null | undefined,
  mode: BuilderMode,
) {
  if (typeof window === "undefined" || mode === "none") return;
  try {
    window.localStorage.setItem(getBuilderModeStorageKey(scene), mode);
  } catch {
    // Storage can be unavailable in private contexts; builder mode still works without persistence.
  }
}

function logBuilderMode(stage: string, details?: Record<string, unknown>) {
  const logger = getLogger();
  const payload = details ? [details] : [];
  logger?.info?.(`[BuilderStudio] ${stage}`, ...payload);
}

function getAnchoredMenuPosition(
  anchor: HTMLElement | null,
  width: number,
  menuHeight = 0,
): CSSProperties {
  if (!anchor || typeof window === "undefined") return { top: 100, left: 100 };
  const rect = anchor.getBoundingClientRect();
  const spaceAbove = Math.max(
    0,
    rect.top - MENU_VIEWPORT_MARGIN - MENU_ANCHOR_GAP,
  );
  const spaceBelow = Math.max(
    0,
    window.innerHeight - rect.bottom - MENU_VIEWPORT_MARGIN - MENU_ANCHOR_GAP,
  );
  const canFitAbove = menuHeight > 0 && menuHeight <= spaceAbove;
  const canFitBelow = menuHeight > 0 && menuHeight <= spaceBelow;
  const placeAbove =
    menuHeight > 0
      ? (canFitAbove && !canFitBelow) ||
        (canFitAbove && canFitBelow && spaceAbove >= spaceBelow) ||
        (!canFitAbove && !canFitBelow && spaceAbove >= spaceBelow)
      : spaceAbove >= spaceBelow;
  const availableHeight = placeAbove ? spaceAbove : spaceBelow;
  const halfWidth = width / 2;
  const left = Math.min(
    Math.max(rect.left + rect.width / 2, MENU_VIEWPORT_MARGIN + halfWidth),
    Math.max(MENU_VIEWPORT_MARGIN + halfWidth, window.innerWidth - MENU_VIEWPORT_MARGIN - halfWidth),
  );

  return {
    top: placeAbove ? rect.top - MENU_ANCHOR_GAP : rect.bottom + MENU_ANCHOR_GAP,
    left,
    width,
    maxHeight: Math.max(0, availableHeight),
    transform: placeAbove ? "translate(-50%, -100%)" : "translateX(-50%)",
  };
}

const BUILDER_MODE_COPY: Record<
  ActiveBuilderMode,
  {
    label: string;
    description: string;
    shortcut: string;
    beta?: boolean;
    Icon: ActionBarIconComponent;
  }
> = {
  quick: {
    label: "Build",
    description: "Stamp terrain, props, and blockout pieces",
    shortcut: "Quick Build",
    Icon: BrushIcon,
  },
  "mesh-cad": {
    label: "Model",
    description: "Edit mesh vertices, edges, and faces",
    shortcut: "Mesh CAD",
    beta: true,
    Icon: ToolsIcon,
  },
  "bim-plan": {
    label: "Plan",
    description: "Draw walls, rooms, openings, and BIM parts",
    shortcut: "BIM Plan",
    beta: true,
    Icon: HomeIcon,
  },
};

const BUILDER_MENU_MODES: ActiveBuilderMode[] = [
  "quick",
  "mesh-cad",
  "bim-plan",
];

interface ActionBarProps {
  errorCount?: number;
  openGameDebugPanel?: () => void;
  closeGameDebugPanel?: () => void;
  showGameDebugPanel?: boolean;
  /** Width (%) of the pinned code editor; 0 when not pinned. */
  pinnedCodeEditorWidth?: number;
  /** True when the code editor is currently visible. */
  showCodeEditor?: boolean;
}

export const ActionBar = ({
  errorCount: propErrorCount,
  openGameDebugPanel = () => {},
  closeGameDebugPanel = () => {},
  showGameDebugPanel = false,
  pinnedCodeEditorWidth = 0,
}: ActionBarProps) => {
  const [showKeybindings, setShowKeybindings] = useState(false);
  const [builderMode, setBuilderMode] = useState<BuilderMode>("none");
  const builderModeRef = useRef<BuilderMode>("none");
  const keybindingsBtnRef = useRef<HTMLButtonElement>(null);
  const cadModeBtnRef = useRef<HTMLButtonElement>(null);
  const firstBuildMenuItemRef = useRef<HTMLButtonElement>(null);
  const firstCopilotMenuItemRef = useRef<HTMLButtonElement>(null);
  const gameDebugLogsRef = useRef<GameLog[]>([]);
  const [updateTrigger, setUpdateTrigger] = useState(0);
  const [maxLogs, setMaxLogs] = useState(500);
  const updateTimeoutRef = useRef<number | null>(null);
  const app = global.app as EngineRuntime;
  const didApplyBuilderModeRef = useRef(false);
  const collaborationStatus = useCollaborationStatus();
  const [cadToolsEnabled, setCadToolsEnabled] = useState(() =>
    isCADToolsEnabled(app.editor?.scene),
  );

  // Camera orientation state
  const [showCameraPanel, setShowCameraPanel] = useState(false);
  const [cameraOrientation, setCameraOrientation] =
    useState<CameraOrientation>("custom");
  const cameraBtnRef = useRef<HTMLButtonElement>(null);
  const isSettingCameraRef = useRef(false);

  // Copilot long-press menu state
  const [showCopilotMenu, setShowCopilotMenu] = useState(false);
  const [showCadModeMenu, setShowCadModeMenu] = useState(false);
  const copilotBtnRef = useRef<HTMLButtonElement>(null);
  const copilotMenuRef = useRef<HTMLDivElement>(null);
  const buildMenuRef = useRef<HTMLDivElement>(null);
  const [menuLayoutVersion, setMenuLayoutVersion] = useState(0);
  const longPressTimerRef = useRef<number | null>(null);
  const didLongPressRef = useRef(false);
  const authContext = useAuthorizationContext();
  const isAdmin = authContext?.isAdmin ?? false;

  // Snap config state
  const [showSnapPanel, setShowSnapPanel] = useState(false);
  const [snappingSettings, setSnappingSettings] =
    useState<SnappingSettings | null>(() =>
      getSnappingSettings(app.editor?.scene),
    );
  const [unitsSettings, setUnitsSettings] = useState<UnitsSettings>(() =>
    getUnitsSettings(app.editor?.scene),
  );
  const snapBtnRef = useRef<HTMLButtonElement>(null);
  const showQuickBuild = builderMode === "quick";
  const showMeshCad = builderMode === "mesh-cad";
  const showPlanCad = builderMode === "bim-plan";

  // Calculate error count from logs
  const errorCount = gameDebugLogsRef.current.filter(
    (log) => log.level === LogLevel.ERROR,
  ).length;
  const effectiveErrorCount =
    propErrorCount !== undefined ? propErrorCount : errorCount;

  const handleLog = useCallback(
    (level: LogLevel, args: GameLog["args"]) => {
      if (
        level === LogLevel.ERROR ||
        level === LogLevel.WARN ||
        level === LogLevel.INFO ||
        level === LogLevel.LOG
      ) {
        gameDebugLogsRef.current = [
          ...gameDebugLogsRef.current,
          { level, args, timestamp: Date.now() },
        ];

        if (gameDebugLogsRef.current.length > maxLogs) {
          gameDebugLogsRef.current = gameDebugLogsRef.current.slice(
            gameDebugLogsRef.current.length - maxLogs,
          );
        }

        if (showGameDebugPanel) {
          if (updateTimeoutRef.current) {
            window.clearTimeout(updateTimeoutRef.current);
          }
          updateTimeoutRef.current = window.setTimeout(() => {
            setUpdateTrigger((prev) => prev + 1);
            updateTimeoutRef.current = null;
          }, 100);
        }
      }
    },
    [maxLogs, showGameDebugPanel],
  );

  const handleClearLogs = () => {
    gameDebugLogsRef.current = [];
    setUpdateTrigger((prev) => prev + 1);
    app?.call("clearGameDebugLogs", app.editor?.component);
  };

  const handleSetMaxLogs = (newMaxLogs: number) => {
    setMaxLogs(newMaxLogs);
    localStorage.setItem("gameDebugPanel_maxLogs", newMaxLogs.toString());
  };

  const exitMeshCadMode = useCallback(() => {
    if (app.editor?.cadMode) {
      app.editor.exitCADMode();
    }
  }, [app]);

  const transitionBuilderMode = useCallback(
    (request: BuilderModeRequest, reason: BuilderModeReason) => {
      const current = builderModeRef.current;
      const next = typeof request === "function" ? request(current) : request;
      const scene = app.editor?.scene;

      setShowCadModeMenu(false);
      if (
        (next === "mesh-cad" || next === "bim-plan") &&
        !isCADToolsEnabled(scene)
      ) {
        logBuilderMode("CAD mode blocked", { mode: next, reason });
        return;
      }
      if (current === next) return;

      if (next !== "mesh-cad") {
        exitMeshCadMode();
      }

      builderModeRef.current = next;
      setBuilderMode(next);
      persistBuilderMode(scene, next);
      logBuilderMode("Builder mode changed", {
        from: current,
        to: next,
        reason,
      });
    },
    [app, exitMeshCadMode],
  );

  useEffect(() => {
    builderModeRef.current = builderMode;
  }, [builderMode]);

  useEffect(() => {
    const savedMaxLogs = localStorage.getItem("gameDebugPanel_maxLogs");
    if (savedMaxLogs) {
      setMaxLogs(parseInt(savedMaxLogs, 10));
    }
  }, []);

  useEffect(() => {
    getLogger()?.addListener(handleLog);

    return () => {
      getLogger()?.removeListener(handleLog);
      if (updateTimeoutRef.current) {
        window.clearTimeout(updateTimeoutRef.current);
      }
    };
  }, [handleLog]);

  useEffect(() => {
    const handlePlayerInit = () => {
      gameDebugLogsRef.current = [];
      setUpdateTrigger((prev) => prev + 1);
    };

    const handlePlayerStopped = () => {
      gameDebugLogsRef.current = [];
      setUpdateTrigger((prev) => prev + 1);
    };

    app.on("playerInit.ActionBar", handlePlayerInit);
    app.on("playerStopped.ActionBar", handlePlayerStopped);

    return () => {
      app.on("playerInit.ActionBar", null);
      app.on("playerStopped.ActionBar", null);
    };
  }, [app]);

  useEffect(() => installPlanCadSceneSync(app), [app]);

  useEffect(() => {
    const syncCadToolsEnabled = () => {
      const enabled = isCADToolsEnabled(app.editor?.scene);
      setCadToolsEnabled(enabled);
      if (!enabled) {
        transitionBuilderMode(
          (current) =>
            current === "mesh-cad" || current === "bim-plan" ? "none" : current,
          "cad-disabled",
        );
      }
    };

    app.on("cadToolsSettingsChanged.ActionBar", syncCadToolsEnabled);
    app.on("editorCleared.ActionBarCadTools", syncCadToolsEnabled);
    app.on(
      "objectChanged.ActionBarCadTools",
      (_source: unknown, object?: THREE.Object3D) => {
        if (!object || object === app.editor?.scene) syncCadToolsEnabled();
      },
    );
    syncCadToolsEnabled();

    return () => {
      app.on("cadToolsSettingsChanged.ActionBar", null);
      app.on("editorCleared.ActionBarCadTools", null);
      app.on("objectChanged.ActionBarCadTools", null);
    };
  }, [app, transitionBuilderMode]);

  useEffect(() => {
    const applyBuilderMode = () => {
      const scene = app.editor?.scene;
      if (!scene) return;

      const urlMode = didApplyBuilderModeRef.current
        ? null
        : getBuilderStudioMode();
      if (urlMode) {
        didApplyBuilderModeRef.current = true;
        transitionBuilderMode(urlMode, "url");
        return;
      }

      const storedMode = readStoredBuilderMode(scene);
      if (storedMode) {
        transitionBuilderMode(storedMode, "restore");
      }
    };

    applyBuilderMode();
    app.on("sceneLoaded.ActionBarBuilderMode", applyBuilderMode);
    return () => {
      app.on("sceneLoaded.ActionBarBuilderMode", null);
    };
  }, [app, transitionBuilderMode]);

  // Camera controls change detection — reset to "custom" on manual orbit
  useEffect(() => {
    const controls = getActiveCameraControls(app.editor);
    if (!controls) return;
    const onChange = () => {
      if (!isSettingCameraRef.current) {
        setCameraOrientation("custom");
      }
    };
    controls.addEventListener?.("change", onChange);
    return () => controls.removeEventListener?.("change", onChange);
  }, [app]);

  // Set camera to a preset orientation
  const handleCameraSelect = (orientation: CameraOrientation) => {
    const editor = app.editor;
    const camera = editor?.camera;
    const controls = getActiveCameraControls(editor);
    if (!camera || !controls) return;

    const positions: Record<string, [number, number, number]> = {
      default: [0, 10, 25],
      top: [0, 50, 0.001],
      side: [0, 5, 50],
    };
    const pos = positions[orientation];
    if (!pos) return;

    isSettingCameraRef.current = true;
    camera.position.set(pos[0], pos[1], pos[2]);
    // OrbitControls uses `target`; the legacy EditorControlsImpl uses `center`.
    const focusPoint = controls.target ?? controls.center;
    focusPoint?.set(0, 0, 0);
    camera.lookAt(0, 0, 0);
    controls.update?.();
    controls.dispatchEvent?.({ type: "change" });
    setCameraOrientation(orientation);
    requestAnimationFrame(() => {
      isSettingCameraRef.current = false;
    });
  };

  // Snapping settings listener
  useEffect(() => {
    app.on(
      "snappingSettingsChanged.ActionBar",
      (settings: SnappingSettings) => {
        setSnappingSettings(mergeSnappingSettings(settings));
      },
    );
    app.on("unitsSettingsChanged.ActionBar", (
      _editor: unknown,
      settings: UnitsSettings,
    ) => {
      setUnitsSettings(settings || DEFAULT_UNITS_SETTINGS);
    });
    return () => {
      app.on("snappingSettingsChanged.ActionBar", null);
      app.on("unitsSettingsChanged.ActionBar", null);
    };
  }, [app]);

  // Update snap increment from preset
  const handleSnapSelect = (value: number) => {
    const editor = app.editor;
    if (!editor?.scene) return;
    editor.scene.userData = editor.scene.userData || {};
    const currentSettings = getSnappingSettings(editor.scene);
    const updated: SnappingSettings = {
      ...currentSettings,
      grid: { ...currentSettings.grid, enabled: true, increment: value },
    };
    editor.scene.userData.snapping = updated;
    app.call("objectChanged", editor, editor.scene);
    app.call("snappingSettingsChanged", editor, updated);
  };

  const handleOpenSnapSettings = () => {
    const setActiveRightPanel =
      app.editor?.component?.props?.setActiveRightPanel;
    setActiveRightPanel?.(RIGHT_PANEL_VERSIONS.GameSettings);
    app.call("focusProjectSettingsSection", app.editor, "snapping");
  };

  const handleOpenCadSettings = useCallback(() => {
    const setActiveRightPanel =
      app.editor?.component?.props?.setActiveRightPanel;
    setActiveRightPanel?.(RIGHT_PANEL_VERSIONS.GameSettings);
    app.call("focusProjectSettingsSection", app.editor, "cadTools");
  }, [app]);

  const gridSnapEnabled = snappingSettings?.grid?.enabled ?? false;
  const gridSnapIncrement = snappingSettings?.grid?.increment ?? 1;
  const showMetricSnapLabels =
    !unitsSettings?.enabled ||
    ["meters", "centimeters", "millimeters"].includes(
      unitsSettings.currentUnit,
    );

  // Copilot button long-press handlers
  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleCopilotPointerDown = () => {
    if (!isAdmin) return;
    didLongPressRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      didLongPressRef.current = true;
      setShowCopilotMenu(true);
    }, LONG_PRESS_DELAY);
  };

  const handleCopilotPointerUp = () => {
    clearLongPress();
    if (!didLongPressRef.current) {
      app.editor?.component?.toggleAiCopilot();
    }
  };

  const handleCopilotPointerLeave = () => {
    clearLongPress();
  };

  const refreshMenuLayout = useCallback(() => {
    setMenuLayoutVersion((value) => value + 1);
  }, []);

  const getCopilotMenuPosition = useCallback(() => {
    return getAnchoredMenuPosition(
      copilotBtnRef.current,
      COPILOT_MENU_WIDTH,
      copilotMenuRef.current?.offsetHeight ?? 0,
    );
  }, [menuLayoutVersion]);

  const getCadModeMenuPosition = useCallback(() => {
    return getAnchoredMenuPosition(
      cadModeBtnRef.current,
      BUILD_MENU_WIDTH,
      buildMenuRef.current?.offsetHeight ?? 0,
    );
  }, [menuLayoutVersion]);

  const closeCopilotMenu = useCallback((restoreFocus = false) => {
    setShowCopilotMenu(false);
    if (restoreFocus) {
      requestAnimationFrame(() => copilotBtnRef.current?.focus());
    }
  }, []);

  const closeBuildMenu = useCallback((restoreFocus = false) => {
    setShowCadModeMenu(false);
    if (restoreFocus) {
      requestAnimationFrame(() => cadModeBtnRef.current?.focus());
    }
  }, []);

  const selectBuilderMenuMode = useCallback(
    (target: ActiveBuilderMode) => {
      if (
        (target === "mesh-cad" || target === "bim-plan") &&
        !cadToolsEnabled
      ) {
        handleOpenCadSettings();
        closeBuildMenu(true);
        return;
      }
      transitionBuilderMode(
        (current) => (current === target ? "none" : target),
        "menu",
      );
      closeBuildMenu(true);
    },
    [cadToolsEnabled, closeBuildMenu, handleOpenCadSettings, transitionBuilderMode],
  );

  const activatePrimaryBuildMode = useCallback(() => {
    transitionBuilderMode(
      (current) => (current === "quick" ? "none" : "quick"),
      "primary",
    );
  }, [transitionBuilderMode]);

  useEffect(() => {
    if (!showCadModeMenu) return;
    const frame = requestAnimationFrame(() => {
      firstBuildMenuItemRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [showCadModeMenu]);

  useEffect(() => {
    if (!showCopilotMenu) return;
    const frame = requestAnimationFrame(() => {
      firstCopilotMenuItemRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [showCopilotMenu]);

  useLayoutEffect(() => {
    if (!showCadModeMenu && !showCopilotMenu) return;
    const frame = requestAnimationFrame(refreshMenuLayout);
    window.addEventListener("resize", refreshMenuLayout);
    window.addEventListener("scroll", refreshMenuLayout, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", refreshMenuLayout);
      window.removeEventListener("scroll", refreshMenuLayout, true);
    };
  }, [refreshMenuLayout, showCadModeMenu, showCopilotMenu]);

  useEffect(() => {
    if (!showCadModeMenu) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeBuildMenu(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeBuildMenu, showCadModeMenu]);

  useEffect(() => {
    if (!showCopilotMenu) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCopilotMenu(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeCopilotMenu, showCopilotMenu]);

  return (
    <>
      <Container
        style={
          pinnedCodeEditorWidth > 0
            ? { left: `calc(50% - ${pinnedCodeEditorWidth / 2}%)` }
            : undefined
        }
      >
        <CADActionBarControls
          forceVisible={showMeshCad}
          allowAutoVisible={showMeshCad}
          onClose={() => transitionBuilderMode("none", "close")}
        />
        <Tooltip text="Help" height="auto">
          <ActionButton
            aria-label="Open help documentation"
            onClick={() => window.open(getEditorDocsUrl(), "_blank")}
          >
            <img src={askIcon} style={{ width: 18, height: 18 }} />
          </ActionButton>
        </Tooltip>
        <Tooltip text="Keyboard Shortcuts" height="auto">
          <ActionButton
            ref={keybindingsBtnRef}
            onClick={() => setShowKeybindings((v) => !v)}
          >
            <img src={infoIcon} />
          </ActionButton>
        </Tooltip>
        <BuildSplitControl $isSelected={builderMode !== "none"}>
          <Tooltip
            text="Build tools: Quick Build"
            height="auto"
          >
            <BuildPrimaryButton
              data-testid="actionbar-quick-build"
              $isSelected={showQuickBuild}
              aria-label="Open Quick Build"
              aria-pressed={showQuickBuild}
              onClick={activatePrimaryBuildMode}
            >
              <BrushIcon size={18} />
            </BuildPrimaryButton>
          </Tooltip>
          <Tooltip
            text={
              cadToolsEnabled
                ? "Build tools"
                : "Build tools - enable CAD & BIM tools in Project Settings"
            }
            height="auto"
          >
            <BuildMenuButton
              ref={cadModeBtnRef}
              data-testid="actionbar-cad-tools"
              $isOpen={showCadModeMenu}
              $isSelected={showMeshCad || showPlanCad}
              aria-label="Open build tools menu"
              aria-haspopup="menu"
              aria-expanded={showCadModeMenu}
              onClick={() => setShowCadModeMenu((v) => !v)}
            >
              <ChevronUpIcon size={14} />
            </BuildMenuButton>
          </Tooltip>
        </BuildSplitControl>

        <Tooltip text="Camera View" height="auto">
          <ActionButton
            ref={cameraBtnRef}
            $isSelected={showCameraPanel}
            onClick={() => setShowCameraPanel((v) => !v)}
          >
            <img src={cameraIcon} alt="" />
          </ActionButton>
        </Tooltip>
        {gridSnapEnabled && (
          <>
            <Tooltip text={`Grid Snap: ${gridSnapIncrement}`} height="auto">
              <ActionButton
                ref={snapBtnRef}
                $isSelected={showSnapPanel}
                onClick={() => setShowSnapPanel((v) => !v)}
              >
                <img src={gridSnapIcon} alt="" />
              </ActionButton>
            </Tooltip>
          </>
        )}

        <Tooltip text="Debug Console" height="auto">
          <DebugButtonWrapper>
            <ActionButton
              onClick={() =>
                showGameDebugPanel
                  ? closeGameDebugPanel()
                  : openGameDebugPanel()
              }
            >
              <img src={bugIcon} alt="debug" />
            </ActionButton>
            {effectiveErrorCount > 0 && (
              <ErrorBadge>
                {effectiveErrorCount > 99 ? "99+" : effectiveErrorCount}
              </ErrorBadge>
            )}
          </DebugButtonWrapper>
        </Tooltip>
        <Tooltip
          text={isAdmin ? "AI Copilot (hold for menu)" : "AI Copilot"}
          height="auto"
        >
          <ActionButton
            ref={copilotBtnRef}
            data-testid="actionbar-copilot"
            onPointerDown={handleCopilotPointerDown}
            onPointerUp={handleCopilotPointerUp}
            onPointerLeave={handleCopilotPointerLeave}
            onContextMenu={(e) => e.preventDefault()}
            $isActive={app.editor?.component?.state.showAiCopilot}
          >
            <img src={magicAI} alt="magic AI" />
          </ActionButton>
        </Tooltip>
        {collaborationStatus && (
          <>
            <Tooltip
              text={
                collaborationStatus === "connected"
                  ? "Collaborative - Connected"
                  : collaborationStatus === "connecting"
                    ? "Collaborative - Connecting..."
                    : "Collaborative - Disconnected"
              }
              height="auto"
            >
              <CollaborationIndicator $status={collaborationStatus}>
                <CollaborationDot $status={collaborationStatus} />
              </CollaborationIndicator>
            </Tooltip>
          </>
        )}
        {showKeybindings && (
          <KeybindingsPanel
            anchorRef={keybindingsBtnRef}
            onClose={() => setShowKeybindings(false)}
            bindings={EDITOR_KEYBINDINGS}
            title="Editor Shortcuts"
          />
        )}
        {showCameraPanel && (
          <CameraOrientationPanel
            anchorRef={cameraBtnRef}
            onClose={() => setShowCameraPanel(false)}
            onSelect={handleCameraSelect}
            activeOrientation={cameraOrientation}
          />
        )}
        {showSnapPanel && gridSnapEnabled && (
          <SnapConfigPanel
            anchorRef={snapBtnRef}
            onClose={() => setShowSnapPanel(false)}
            onSelect={handleSnapSelect}
            activeValue={gridSnapIncrement}
            showMetricLabels={showMetricSnapLabels}
            onOpenSettings={handleOpenSnapSettings}
          />
        )}
        {showCopilotMenu &&
          createPortal(
            <>
              <MenuOverlay onClick={() => closeCopilotMenu(true)} />
              <MenuPopover
                ref={copilotMenuRef}
                style={getCopilotMenuPosition()}
                role="menu"
                aria-label="AI Copilot tools"
              >
                <MenuItem
                  ref={firstCopilotMenuItemRef}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeCopilotMenu(true);
                    app.editor?.component?.openAiCopilotTerminal();
                  }}
                >
                  <ToolsIcon size={14} />
                  Script Tool
                </MenuItem>
              </MenuPopover>
            </>,
            document.body,
          )}
        {showCadModeMenu &&
          createPortal(
            <>
              <MenuOverlay onClick={() => closeBuildMenu(true)} />
              <MenuPopover
                ref={buildMenuRef}
                style={getCadModeMenuPosition()}
                role="menu"
                aria-label="Build tools"
              >
                {BUILDER_MENU_MODES.map((mode, index) => {
                  const item = BUILDER_MODE_COPY[mode];
                  const Icon = item.Icon;
                  const disabled =
                    (mode === "mesh-cad" || mode === "bim-plan") &&
                    !cadToolsEnabled;
                  const testId =
                    mode === "quick"
                      ? "actionbar-build-quick"
                      : mode === "mesh-cad"
                        ? "actionbar-mesh-cad"
                        : "actionbar-plan-cad";
                  return (
                    <MenuItem
                      key={mode}
                      ref={index === 0 ? firstBuildMenuItemRef : undefined}
                      type="button"
                      role="menuitem"
                      data-testid={testId}
                      disabled={disabled}
                      aria-pressed={builderMode === mode}
                      onClick={() => selectBuilderMenuMode(mode)}
                    >
                      <Icon size={14} />
                      <MenuItemText>
                        <MenuItemLabel>{item.label}</MenuItemLabel>
                        <MenuItemDescription>
                          {disabled
                            ? "Enable CAD & BIM tools in Project Settings"
                            : item.description}
                        </MenuItemDescription>
                      </MenuItemText>
                      {item.beta && <MenuItemBadge>beta</MenuItemBadge>}
                    </MenuItem>
                  );
                })}
                {!cadToolsEnabled && (
                  <MenuItem
                    type="button"
                    role="menuitem"
                    data-testid="actionbar-enable-cad-tools"
                    onClick={() => {
                      handleOpenCadSettings();
                      closeBuildMenu(true);
                    }}
                  >
                    <ToolsIcon size={14} />
                    <MenuItemText>
                      <MenuItemLabel>Enable CAD & BIM tools</MenuItemLabel>
                      <MenuItemDescription>
                        Opens Project Settings.
                      </MenuItemDescription>
                    </MenuItemText>
                  </MenuItem>
                )}
              </MenuPopover>
            </>,
            document.body,
          )}
      </Container>

      {showQuickBuild && (
        <QuickBuildToolbar
          pinnedCodeEditorWidth={pinnedCodeEditorWidth}
          onClose={() => transitionBuilderMode("none", "close")}
        />
      )}
      {showPlanCad && cadToolsEnabled && (
        <PlanCadToolbar
          pinnedCodeEditorWidth={pinnedCodeEditorWidth}
          onClose={() => transitionBuilderMode("none", "close")}
        />
      )}

      {showGameDebugPanel && (
        <GameDebugPanel
          logsRef={gameDebugLogsRef}
          updateTrigger={updateTrigger}
          onClose={closeGameDebugPanel}
          onClear={handleClearLogs}
          maxLogs={maxLogs}
          setMaxLogs={handleSetMaxLogs}
        />
      )}
    </>
  );
};
