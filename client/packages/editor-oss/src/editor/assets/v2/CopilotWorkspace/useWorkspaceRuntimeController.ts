import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";

import { saveScene } from "@stem/network/api/scene";
import EventBus from "../../../../behaviors/event/EventBus";
import EngineRuntime, { ApplicationMode } from "@stem/editor-oss/EngineRuntime";
import { showToast } from "@stem/editor-oss/showToast";
import { traverseObjectDepthFirst } from "@stem/editor-oss/utils/SceneTraverser";
import {
  getWorkspaceCameraProfile,
  type WorkspaceCameraProfile,
} from "./workspaceCameraProfile";

export type WorkspaceCameraMode = "player" | "free";
export type WorkspaceInteractionMode = "play" | "inspect" | "edit";
export type WorkspaceStatusState =
  | "starting-playtest"
  | "pausing-playtest"
  | "resuming-playtest"
  | "returning-to-edit"
  | "restarting-current-version"
  | "inspect-playtest"
  | "preparing-preview"
  | "applying-temporary-changes"
  | "preview-ready"
  | "preview-failed"
  | "new-version-created-restarting"
  | "playtest-ready";

export type WorkspaceStatusTone = "busy" | "ready" | "info";

export type WorkspaceStatus = {
  state: WorkspaceStatusState;
  tone: WorkspaceStatusTone;
  title: string;
  detail: string;
};

export type DebugMetrics = {
  fps: number;
  entityCount: number;
  multiplayerState: string;
  physicsState: string;
};

type UseWorkspaceRuntimeControllerArgs = {
  app: EngineRuntime;
};

export type WorkspacePlaytestState = "editing" | "playing" | "paused";

export type WorkspaceRuntimeState = {
  playtestState: WorkspacePlaytestState;
  playtestActive: boolean;
  playing: boolean;
  paused: boolean;
};

const WORKSPACE_STATUS_COPY: Record<
  WorkspaceStatusState,
  Omit<WorkspaceStatus, "state">
> = {
  "starting-playtest": {
    tone: "busy",
    title: "Starting playtest...",
    detail: "Loading the current confirmed scene into the runtime.",
  },
  "pausing-playtest": {
    tone: "info",
    title: "Playtest paused",
    detail: "Runtime simulation is paused; the current version is unchanged.",
  },
  "resuming-playtest": {
    tone: "busy",
    title: "Resuming playtest...",
    detail: "Gameplay input and physics are returning to the canvas.",
  },
  "returning-to-edit": {
    tone: "busy",
    title: "Returning to edit mode...",
    detail: "Stopping the runtime and restoring editor controls.",
  },
  "restarting-current-version": {
    tone: "busy",
    title: "Restarting current version...",
    detail:
      "Reloading the current confirmed scene from its playtest start state.",
  },
  "inspect-playtest": {
    tone: "info",
    title: "Inspecting playtest",
    detail:
      "Gameplay keeps running while the play-mode inspector is available.",
  },
  "preparing-preview": {
    tone: "busy",
    title: "Preparing preview...",
    detail:
      "Copilot is preparing a temporary branch without replacing the confirmed version.",
  },
  "applying-temporary-changes": {
    tone: "busy",
    title: "Applying temporary changes...",
    detail: "The game may reload while the preview branch is applied.",
  },
  "preview-ready": {
    tone: "ready",
    title: "Preview ready",
    detail: "Test this temporary version before accepting or rejecting it.",
  },
  "preview-failed": {
    tone: "info",
    title: "Preview failed",
    detail: "The Copilot task failed before a temporary preview was ready.",
  },
  "new-version-created-restarting": {
    tone: "busy",
    title: "New version created. Restarting game...",
    detail: "The accepted version is loading from the confirmed revision.",
  },
  "playtest-ready": {
    tone: "ready",
    title: "Playtest ready",
    detail: "The game is running in the main canvas.",
  },
};

const countSceneObjects = (app: EngineRuntime): number => {
  let count = 0;
  if (app.scene) traverseObjectDepthFirst(app.scene, () => count++);
  return count;
};

const readDebugMetrics = (app: EngineRuntime, fps: number): DebugMetrics => ({
  fps,
  entityCount: countSceneObjects(app),
  multiplayerState: app.editor?.isMultiplayer
    ? app.multiplayerClient
      ? "connected"
      : "enabled"
    : "off",
  physicsState: app.physics
    ? app.isPaused
      ? "paused"
      : app.isPlaying
        ? "running"
        : "ready"
    : "inactive",
});

export const getWorkspaceRuntimeState = (
  app: Pick<EngineRuntime, "isPlaying" | "isPaused">,
): WorkspaceRuntimeState => {
  const paused = !!app.isPaused;
  const playing = !!app.isPlaying && !paused;
  const playtestState: WorkspacePlaytestState = paused
    ? "paused"
    : playing
      ? "playing"
      : "editing";

  return {
    playtestState,
    playtestActive: playtestState !== "editing",
    playing,
    paused,
  };
};

const createStatus = (state: WorkspaceStatusState): WorkspaceStatus => ({
  state,
  ...WORKSPACE_STATUS_COPY[state],
});

const enableWorkspaceGameMode = (app: EngineRuntime): void => {
  const scene = app.editor?.scene ?? app.scene;
  if (!scene) return;

  scene.userData.game = {
    ...(scene.userData.game || {}),
    enabled: true,
  };
};

export const useWorkspaceRuntimeController = ({
  app,
}: UseWorkspaceRuntimeControllerArgs) => {
  const [cameraMode, setCameraMode] = useState<WorkspaceCameraMode>("player");
  const [interactionMode, setInteractionMode] =
    useState<WorkspaceInteractionMode>("edit");
  const [debugOpen, setDebugOpen] = useState(false);
  const [runtimeState, setRuntimeState] = useState<WorkspaceRuntimeState>(() =>
    getWorkspaceRuntimeState(app),
  );
  const [status, setStatus] = useState<WorkspaceStatus | null>(null);
  const [metrics, setMetrics] = useState<DebugMetrics>(() =>
    readDebugMetrics(app, 0),
  );
  const [actionPending, setActionPending] = useState(false);
  const [cameraProfile, setCameraProfile] = useState<WorkspaceCameraProfile>(
    () => getWorkspaceCameraProfile(app.camera?.userData?.cameraData),
  );
  const statusTimerRef = useRef<number | null>(null);
  const inspectPointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());

  const clearStatusTimer = useCallback(() => {
    if (statusTimerRef.current === null) return;
    window.clearTimeout(statusTimerRef.current);
    statusTimerRef.current = null;
  }, []);

  const clearStatus = useCallback(() => {
    clearStatusTimer();
    setStatus(null);
  }, [clearStatusTimer]);

  useEffect(() => {
    enableWorkspaceGameMode(app);
  }, [app]);

  const refreshCameraProfile = useCallback(() => {
    setCameraProfile(
      getWorkspaceCameraProfile(app.camera?.userData?.cameraData),
    );
  }, [app]);

  const syncRuntimeState = useCallback(() => {
    const nextRuntimeState = getWorkspaceRuntimeState(app);
    setRuntimeState(nextRuntimeState);

    if (nextRuntimeState.playtestActive) {
      setInteractionMode((current) => (current === "edit" ? "play" : current));
    } else {
      setInteractionMode("edit");
      setDebugOpen(false);
    }

    if (app.playmodeDebugCamera?.active) {
      setCameraMode("free");
    } else if (!nextRuntimeState.playtestActive) {
      setCameraMode("player");
    }

    refreshCameraProfile();
  }, [app, refreshCameraProfile]);

  const showStatus = useCallback(
    (state: WorkspaceStatusState, autoHideMs?: number) => {
      clearStatusTimer();
      setStatus(createStatus(state));
      if (autoHideMs) {
        statusTimerRef.current = window.setTimeout(() => {
          setStatus(null);
          statusTimerRef.current = null;
        }, autoHideMs);
      }
    },
    [clearStatusTimer],
  );

  useEffect(() => clearStatusTimer, [clearStatusTimer]);

  useEffect(() => {
    const handleWorkspaceStatusRequested = (payload?: {
      state?: WorkspaceStatusState;
      autoHideMs?: number;
    }) => {
      if (!payload?.state) return;
      showStatus(payload.state, payload.autoHideMs);
    };

    app.on(
      "workspaceStatusRequested.CopilotWorkspaceControls",
      handleWorkspaceStatusRequested,
    );

    return () => {
      app.on("workspaceStatusRequested.CopilotWorkspaceControls", null);
    };
  }, [app, showStatus]);

  useEffect(() => {
    app.on("playerStarted.CopilotWorkspaceControls", syncRuntimeState);
    app.on("playerStopped.CopilotWorkspaceControls", syncRuntimeState);
    app.on("appModeEntered.CopilotWorkspaceControls", syncRuntimeState);
    app.on("sceneLoaded.CopilotWorkspaceControls", syncRuntimeState);
    syncRuntimeState();

    return () => {
      app.on("playerStarted.CopilotWorkspaceControls", null);
      app.on("playerStopped.CopilotWorkspaceControls", null);
      app.on("appModeEntered.CopilotWorkspaceControls", null);
      app.on("sceneLoaded.CopilotWorkspaceControls", null);
    };
  }, [app, syncRuntimeState]);

  useEffect(() => {
    if (!runtimeState.playtestActive && debugOpen) {
      setDebugOpen(false);
    }
  }, [debugOpen, runtimeState.playtestActive]);

  useEffect(() => {
    if (!debugOpen) return;

    let frameCount = 0;
    let lastSample = performance.now();
    let lastFps = 0;
    let frameId = 0;

    const tick = (now: number) => {
      frameCount += 1;
      if (now - lastSample >= 1000) {
        lastFps = Math.round((frameCount * 1000) / (now - lastSample));
        frameCount = 0;
        lastSample = now;
        setMetrics(readDebugMetrics(app, lastFps));
      }
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    setMetrics(readDebugMetrics(app, lastFps));

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [app, debugOpen]);

  useEffect(() => {
    if (!runtimeState.playing) return;

    const freeCameraActive = !!app.playmodeDebugCamera?.active;
    if (cameraProfile.secondaryAction !== "free-camera") return;

    if (cameraMode === "free" && !freeCameraActive) {
      app.togglePlaymodeFreeCamera();
    }
    if (cameraMode === "player" && freeCameraActive) {
      app.togglePlaymodeFreeCamera();
    }
  }, [app, cameraMode, cameraProfile.secondaryAction, runtimeState.playing]);

  useEffect(() => {
    const playtestActive = runtimeState.playtestActive;
    const canvas = app.renderer?.domElement as HTMLElement | undefined;
    if (!playtestActive || interactionMode !== "inspect" || !canvas) return;

    const pickRuntimeObject = (event: PointerEvent) => {
      const scene = app.game?.scene ?? app.scene;
      if (!scene) return;

      const rect = canvas.getBoundingClientRect();
      mouseRef.current.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycasterRef.current.setFromCamera(mouseRef.current, app.camera);
      const hit = raycasterRef.current
        .intersectObjects(scene.children, true)
        .find(
          (intersection) =>
            intersection.object.visible &&
            intersection.object.userData?.gameVisibility !== false,
        );
      const object = hit?.object ?? null;

      if (object) {
        app.editor?.select(object, true);
        app.call("playmodeInspectorObjectSelected", app, object);
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      inspectPointerDownRef.current = { x: event.clientX, y: event.clientY };
      event.preventDefault();
      event.stopPropagation();
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0 || !inspectPointerDownRef.current) return;
      const start = inspectPointerDownRef.current;
      inspectPointerDownRef.current = null;
      event.preventDefault();
      event.stopPropagation();
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5)
        return;
      pickRuntimeObject(event);
    };

    canvas.addEventListener("pointerdown", onPointerDown, true);
    canvas.addEventListener("pointerup", onPointerUp, true);

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown, true);
      canvas.removeEventListener("pointerup", onPointerUp, true);
      inspectPointerDownRef.current = null;
    };
  }, [app, interactionMode, runtimeState.playtestActive]);

  const releaseGameplayInputForInspect = useCallback(() => {
    const runtimeScene = app.game?.scene ?? app.scene;
    if (runtimeScene) {
      runtimeScene.userData.playmodeInspectorEnabled = true;
    }

    document.exitPointerLock?.();
    const cameraControl = app.game?.cameraControl;
    cameraControl?.unlockPointerLock?.();
    cameraControl?.pause?.();
    app.transformControls?.detach?.();
    app.disableClickEvents = false;
    app.call("playmodeInspectorToggled", app, true);
  }, [app]);

  const returnToPlayInteractionMode = useCallback(() => {
    if (!runtimeState.playtestActive) return;

    if (app.playmodeDebugCamera?.active) {
      app.togglePlaymodeFreeCamera();
    }
    const runtimeScene = app.game?.scene ?? app.scene;
    if (runtimeScene) {
      runtimeScene.userData.playmodeInspectorEnabled = false;
    }
    const cameraControl = app.game?.cameraControl;
    cameraControl?.resume?.();
    app.disableClickEvents = true;
    app.call("playmodeInspectorToggled", app, false);
    setCameraMode("player");
    setInteractionMode("play");
    showStatus("playtest-ready", 1200);
  }, [app, runtimeState.playtestActive, showStatus]);

  const startOrTogglePlaytest = useCallback(async () => {
    if (actionPending) return;

    if (runtimeState.paused) {
      showStatus("resuming-playtest");
      app.startAnimationLoop();
      syncRuntimeState();
      EventBus.instance.send("game.resume");
      showStatus("playtest-ready", 1400);
      return;
    }

    if (runtimeState.playing) {
      showStatus("pausing-playtest", 1400);
      app.stopAnimationLoop();
      syncRuntimeState();
      EventBus.instance.send("game.pause");
      return;
    }

    setActionPending(true);
    showStatus("starting-playtest");

    try {
      enableWorkspaceGameMode(app);

      app.editor?.controls?.saveCamera();

      if (!app.editor?.isSandbox && app.editor?.projectUserId === app.userId) {
        let shouldSaveScene = false;
        let shouldProceedWithoutSaving = false;
        let shouldAbortPlay = false;
        const releaseLocalAutoSave = app.editor.suspendLocalAutoSave();
        try {
          await app.editor?.checkForUnsavedChanges(
            "You have unsaved changes in the editor. All unsaved data will be lost if you proceed. Are you sure?",
            () => {
              shouldSaveScene = true;
            },
            () => {
              shouldProceedWithoutSaving = true;
            },
            "Save",
            "Don't Save",
            () => {
              shouldAbortPlay = true;
            },
          );
          if (shouldSaveScene) {
            await saveScene();
          }
        } catch {
          if (shouldAbortPlay || !shouldProceedWithoutSaving) {
            releaseLocalAutoSave();
            clearStatus();
            return;
          }
        }

        try {
          await app.setMode(ApplicationMode.PLAY, {
            editorSavePolicy: shouldProceedWithoutSaving ? "discard" : "flush",
          });
          releaseLocalAutoSave({schedule: false});
        } catch (error) {
          releaseLocalAutoSave();
          throw error;
        }
      } else {
        await app.setMode(ApplicationMode.PLAY);
      }

      syncRuntimeState();
      refreshCameraProfile();
      app.disableClickEvents = true;
      setInteractionMode("play");
      showStatus("playtest-ready", 1400);
    } catch (error) {
      console.error("[CopilotWorkspace] Failed to start playtest", error);
      showToast({ type: "error", title: "Failed to start playtest" });
      clearStatus();
    } finally {
      setActionPending(false);
    }
  }, [
    actionPending,
    app,
    clearStatus,
    refreshCameraProfile,
    runtimeState.paused,
    runtimeState.playing,
    showStatus,
    syncRuntimeState,
  ]);

  const restartCurrentVersion = useCallback(async () => {
    if (actionPending) return;

    setActionPending(true);
    showStatus("restarting-current-version");

    try {
      enableWorkspaceGameMode(app);
      await app.restartPlayMode({
        beforeStart: () => enableWorkspaceGameMode(app),
      });
      syncRuntimeState();
      refreshCameraProfile();
      app.disableClickEvents = true;
      setInteractionMode("play");
      showStatus("playtest-ready", 1400);
    } catch (error) {
      console.error(
        "[CopilotWorkspace] Failed to restart current version",
        error,
      );
      showToast({ type: "error", title: "Failed to restart current version" });
      clearStatus();
    } finally {
      setActionPending(false);
    }
  }, [
    actionPending,
    app,
    clearStatus,
    refreshCameraProfile,
    showStatus,
    syncRuntimeState,
  ]);

  const enterInspectMode = useCallback(() => {
    if (!runtimeState.playtestActive) return;

    releaseGameplayInputForInspect();
    setInteractionMode("inspect");
    showStatus("inspect-playtest", 1600);
  }, [releaseGameplayInputForInspect, runtimeState.playtestActive, showStatus]);

  const returnToEditMode = useCallback(async () => {
    if (actionPending) return;

    setActionPending(true);
    showStatus("returning-to-edit");

    try {
      if (runtimeState.playtestActive) {
        if (app.playmodeDebugCamera?.active) {
          app.togglePlaymodeFreeCamera();
        }
        await app.setMode(ApplicationMode.EDIT);
      }
      syncRuntimeState();
      setCameraMode("player");
      setInteractionMode("edit");
      setDebugOpen(false);
      clearStatus();
      EventBus.instance.send("game.stop");
    } catch (error) {
      console.error("[CopilotWorkspace] Failed to return to edit mode", error);
      showToast({ type: "error", title: "Failed to return to edit mode" });
      clearStatus();
    } finally {
      setActionPending(false);
    }
  }, [
    actionPending,
    app,
    clearStatus,
    runtimeState.playtestActive,
    showStatus,
    syncRuntimeState,
  ]);

  const setNextCameraMode = useCallback(
    (mode: WorkspaceCameraMode) => {
      if (mode === "player") {
        setCameraMode("player");
        if (app.playmodeDebugCamera?.active) {
          app.togglePlaymodeFreeCamera();
        }
        if (runtimeState.playtestActive) {
          returnToPlayInteractionMode();
        }
        return;
      }

      if (!runtimeState.playtestActive) return;

      if (cameraProfile.secondaryAction !== "free-camera") {
        releaseGameplayInputForInspect();
        setInteractionMode("inspect");
        showStatus("inspect-playtest", 1600);
        return;
      }

      const freeCameraActive = !!app.playmodeDebugCamera?.active;
      if (!freeCameraActive) {
        app.togglePlaymodeFreeCamera();
        releaseGameplayInputForInspect();
        setCameraMode("free");
        setInteractionMode("inspect");
        showStatus("inspect-playtest", 1600);
        return;
      }

      returnToPlayInteractionMode();
    },
    [
      app,
      cameraProfile.secondaryAction,
      releaseGameplayInputForInspect,
      returnToPlayInteractionMode,
      runtimeState.playtestActive,
      showStatus,
    ],
  );

  return {
    actionPending,
    cameraMode,
    cameraProfile,
    debugOpen,
    interactionMode,
    metrics,
    runtimeState,
    enterInspectMode,
    returnToPlayInteractionMode,
    returnToEditMode,
    status,
    restartCurrentVersion,
    setDebugOpen,
    setInteractionMode,
    setNextCameraMode,
    startOrTogglePlaytest,
  };
};
