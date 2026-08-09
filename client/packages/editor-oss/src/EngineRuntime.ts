import {Fog, FogExp2, Group, InstancedMesh, Line, MOUSE, Mesh, Object3D, OrthographicCamera, PerspectiveCamera, Points, Scene, Sprite, TOUCH, Timer, Vector2} from "three";
import type {Clock, WebGLRenderer} from "three";
import {createElement} from "react";
import {createRoot} from "react-dom/client";
import Stats from "stats-gl";
import type {TransformControls} from "three/addons/controls/TransformControls.js";
import type {CSS3DRenderer} from "three/addons/renderers/CSS3DRenderer.js";
import type {WebGPUBackend, WebGPURenderer} from "three/webgpu";
import type {BatchedRenderer as QuarksBatchedRenderer} from "three.quarks";

import {AssetType, getAsset, getAssetRevision, getSceneAssets} from "@stem/network/api/asset";
import type {
    DomainSceneDto as GetSceneResponse,
    DomainSceneMetadataDto as SceneMetadata,
} from "@stem/network/api/client/api";
import {checkIsSceneCollaborator, loadScene as apiLoadScene} from "@stem/network/api/scene";
import {migrateSceneThumbnailIfNeeded} from "@stem/network/api/scene/thumbnail";
import {getScene as getSceneV2} from "@stem/network/api/scene/v2";
import AppRuntime from "@web-shared/AppRuntime";
import {isPlaygroundMode} from "@web-shared/playgroundMode";
import {AssetInstanceManager} from "@stem/editor-oss/asset-management/AssetInstanceManager";
import {AssetLoader} from "@stem/editor-oss/asset-management/AssetLoader";
import {setAssetResolutionContext} from "@stem/editor-oss/asset-management/AssetResolutionContext";
import {BehaviorLoadingService} from "./behaviors/BehaviorLoadingService";
import type GameManager from "./behaviors/game/GameManager";
import {yieldPlayStartToPaint} from "./behaviors/game/playStartYield";
import {applyCameraProjectionSettings} from "./camera/cameraSettings";
import type {AnimationController} from "./controls/AnimationController";
import type {AnimationGraphController} from "./controls/AnimationGraphController";
import type {AudioController} from "./controls/AudioController";
import {CameraControl} from "./controls/CameraControl";
import {VRMExpressionController} from "./controls/VRMExpressionController";
import {DeviceCapabilityDetector} from "./core/quality/DeviceCapabilityDetector";
import type {QualitySystemIntegration} from "./core/quality/QualitySystemIntegration";
import type {RuntimeContext} from "./core/RuntimeContext";
import {runtimeFrameTelemetry} from "./core/performance/RuntimeFrameTelemetry";
import {
    FixedStepSimulationClock,
    type FixedStepSimulationClockConfig,
} from "./core/simulation/FixedStepSimulationClock";
import {SceneAssetSource} from "@stem/editor-oss/asset-management/SceneAssetSource";
import type Editor from "./editor/Editor";
import type {EditorStopSavePolicy} from "./editor/Editor";
import type ObjectOutliner from "./editor/effects/ObjectOutliner";
import type {StemEditorMetadata} from "./editor/stem-editor/saveStemEditor";
import EventDispatcher from "@stem/editor-oss/event/EventDispatcher";
import global from "./global";
import type Helpers from "@stem/editor-oss/helper/Helpers";
import type SimpleMultiplayerCollaborativeClient from "./multiplayer/worker/SimpleMultiplayerCollaborativeClient";
import PackageManager from "./package/PackageManager";
import {IPhysics, isPhysicsEngineType, PhysicsEngineType} from "./physics/common/types";
import {GAME_GRAVITY_DEFAULT} from "./constants/game";
import type AiWorldControl from "@web-shared/player/component/AiWorldControl";
import type PlayerAudio from "@web-shared/player/component/PlayerAudio";
import type PlayerEvent from "@web-shared/player/component/PlayerEvent";
import PlayerLoadMask from "@web-shared/player/component/PlayerLoadMask";
import type PlayerPhysics2 from "@web-shared/player/component/PlayerPhysics2";
import type WebVR from "@web-shared/player/component/WebVR";
import type {PlayerSession} from "@web-shared/player/PlayerSession";
import {isScriptImportInProgress} from "@stem/editor-oss/agent/script-tool/scriptImportActivity";
import {PlaymodeDebugCamera} from "./playmode-inspector/PlaymodeDebugCamera";
import {capturePlaymodeSnapshotAsync, PlaymodeSnapshot, restorePlaymodeSnapshot} from "./playmode-inspector/playmodeSnapshot";
import {setPrefabId, unlockPrefab} from "@stem/editor-oss/prefab/metadata";
import {ensureRenderableMeshNormalsProgressive} from "./render/ensureRenderableMeshNormals";
import type EffectRenderer from "./render/EffectRenderer";
import {findSceneHelpersRoot, getOrCreateDynamicRoot, getOrCreateSceneHelpersRoot} from "@stem/editor-oss/scene/dynamicRoots";
import {loadSceneRestorePayload} from "@stem/editor-oss/scene/loadSceneRestorePayload";
import {SceneConfig} from "@stem/editor-oss/scene/SceneConfig";
import type {FrameContext} from "@stem/editor-oss/scheduler/types";
import {getPhysicsSettingsFromSceneJson} from "./core/scenePhysicsSettings";
import type {ToastMessageProps} from "@stem/editor-oss/showToast";
import ApplicationAuthStore from "./userManagement/editorProfile/ApplicationAuthStore";
import {DetectDevice} from "./utils/DetectDevice";
import type {DrawcallPanelManager} from "./utils/DrawcallPanelManager";
import type EnvironmentSettingsManager from "./utils/EnvironmentSettingsManager";
import {THREE_GetGifTexture} from "./utils/GifTexture";
import {FrameClock} from "./utils/FrameClock";
import {LoadingManager, LoadingMessages} from "./utils/LoadingManager";
import {MemoryMonitor} from "./utils/MemoryMonitor";
import MeshUtils, {patchMesh} from "./utils/MeshUtils";
import type {RamPanelManager} from "./utils/RamPanelManager";
import {createProgressiveYieldController} from "./utils/progressiveYield";
import {SceneLoadProfiler} from "./utils/SceneLoadProfiler";
import {findObjectByNameDepthFirst, findObjectDepthFirst, traverseObjectDepthFirst} from "./utils/SceneTraverser";
import {findObjectsInRectangle} from "./utils/SelectionUtils";
import Storage from "./utils/Storage";
import {
    applyRuntimeInstancingBudgetProgressive,
    restoreRuntimeInstancingBudget,
} from "./utils/runtimeInstancingBudget";
import {
    applyRuntimeMaterialBudgetProgressive,
    restoreRuntimeMaterialBudget,
} from "./utils/runtimeMaterialBudget";
import {
    applyAutomaticFallbackRuntimeShadowBudget,
    applyRuntimeShadowBudget,
    restoreRuntimeShadowBudget,
} from "./utils/runtimeShadowBudget";
import {
    applyRuntimeMainTriangleBudget,
    restoreRuntimeMainTriangleBudget,
} from "./utils/runtimeMainTriangleBudget";
import {
    clearRuntimeSceneRevealPending,
    markRuntimeSceneRevealPending,
    prepareRuntimeSceneReveal,
    type RuntimeSceneRevealController,
} from "./utils/runtimeSceneReveal";
import {getViewportSafeArea, type ViewportSafeArea} from "./utils/viewportSafeArea";
import {RuntimeOverlaySafeAreaCoordinator} from "./utils/runtimeOverlaySafeArea";

const RUNTIME_REVEAL_CUSTOM_TSL_MATERIAL_KEYS = [
    "colorNode",
    "opacityNode",
    "normalNode",
    "emissiveNode",
    "positionNode",
    "metalnessNode",
    "roughnessNode",
    "fragmentNode",
    "vertexNode",
    "outputNode",
];

export enum ApplicationMode {
    EDIT = "edit",
    PLAY = "play",
    SANDBOX = "sandbox",
    IDLE = "idle", // mode when the application is not in edit or play mode,
}

export const GLOBAL_BEHAVIOR_HOST = "GlobalBehaviorsHost";
export const MOBILE_TOUCH_CONTROLS_BEHAVIOR_ID = "touchControls";
export const CASCADED_SHADOWS_MAP_BEHAVIOR_ID = "csm";
export const TERRAIN_BEHAVIOR_ID = "terrain";
export const CESIUM_BEHAVIOR_ID = "cesium";
export const SPAWN_POINT_BEHAVIOR_ID = "spawnpoint";
export const VOLUME_BEHAVIOR_ID = "volume";
export const GENERIC_SOUND_BEHAVIOR_ID = "genericSound";
export const IMAGE_BILLBOARD_BEHAVIOR_ID = "image_billboard";
export const VIDEO_BILLBOARD_BEHAVIOR_ID = "video_billboard";
export const BILLBOARD_BEHAVIOR_ID = "billboard";
export const CHARACTER_BEHAVIOR_ID = "character";
export const ENEMY_BEHAVIOR_ID = "enemy";
export const NPC_BEHAVIOR_ID = "npc";
export const AI_NPC_BEHAVIOR_ID = "aiNpc";
export type {ViewportSafeArea} from "./utils/viewportSafeArea";

const DEFAULT_RUNTIME_INSTANCING_TRIANGLE_BUDGET = 300_000;
const DEFAULT_RUNTIME_INSTANCING_MESH_TRIANGLE_BUDGET = 75_000;
const EDITOR_PHYSICS_PRELOAD_DELAY_MS = 5_000;
const EDITOR_PLAYER_RUNTIME_PRELOAD_DELAY_MS = 10_000;

type BatchedRendererLike = Object3D & {
    addSystem(system: unknown): void;
    deleteSystem(system: unknown): void;
    setDepthTexture(depthTexture: unknown): void;
    updateSystem(system: unknown): void;
    update(delta?: number): void;
};

async function preloadPhysicsEngine(
    engineType: PhysicsEngineType,
    gravity: number,
    solverIterations?: number,
): Promise<void> {
    const [{preloadPhysics}] = await Promise.all([
        import("@web-shared/physics/preloadPhysics"),
        import("@web-shared/physics/PhysicsEngineFactory"),
        import("@web-shared/physics/worker/PhysicsProxy"),
    ]);
    await preloadPhysics(engineType, gravity, solverIterations);
}

type PlayerSessionModule = typeof import("@web-shared/player/PlayerSession");

let playerSessionModulePromise: Promise<PlayerSessionModule> | null = null;
let playerRuntimeModulesPromise: Promise<void> | null = null;

function loadPlayerSessionModule(): Promise<PlayerSessionModule> {
    if (!playerSessionModulePromise) {
        playerSessionModulePromise = import("@web-shared/player/PlayerSession").catch(error => {
            playerSessionModulePromise = null;
            throw error;
        });
    }
    return playerSessionModulePromise;
}

function preloadPlayerRuntimeModules(): Promise<void> {
    if (!playerRuntimeModulesPromise) {
        playerRuntimeModulesPromise = loadPlayerSessionModule()
            .then(async () => {
                const {preloadGameManagerRuntimeModules} = await import("@web-shared/behaviors/game/GameManager");
                await preloadGameManagerRuntimeModules();
            })
            .catch(error => {
                playerRuntimeModulesPromise = null;
                throw error;
            });
    }
    return playerRuntimeModulesPromise;
}

type ThreeWebGPUModule = typeof import("three/webgpu");

let threeWebGPUModulePromise: Promise<ThreeWebGPUModule> | null = null;

function loadThreeWebGPU(): Promise<ThreeWebGPUModule> {
    if (!threeWebGPUModulePromise) {
        threeWebGPUModulePromise = import("three/webgpu");
    }
    return threeWebGPUModulePromise;
}

type ShowToastModule = typeof import("@stem/editor-oss/showToast");

let showToastModulePromise: Promise<ShowToastModule> | null = null;

function loadShowToastModule(): Promise<ShowToastModule> {
    if (!showToastModulePromise) {
        showToastModulePromise = import("@stem/editor-oss/showToast");
    }
    return showToastModulePromise;
}

function showRuntimeToast(props: ToastMessageProps): void {
    void loadShowToastModule().then(({showToast}) => showToast(props));
}

type PlayStartTimingEntry = {
    phase: string;
    ms: number;
    success: boolean;
    message?: string;
    startedAt?: number;
    endedAt?: number;
};

type ModeTimingEntry = {
    mode: ApplicationMode;
    phase: string;
    ms: number;
    success: boolean;
    message?: string;
    startedAt?: number;
    endedAt?: number;
};

const PLAY_START_SLOW_TIMING_LOG_THRESHOLD_MS = 500;
const PLAY_START_RUNTIME_BUDGET_BATCH_SIZE = 256;
const PLAY_START_RUNTIME_BUDGET_FRAME_MS = 8;

const getPlayStartTimingRoot = () => globalThis as typeof globalThis & {
    __stemPlayStartTimings?: PlayStartTimingEntry[];
    __stemPlayStartActivePhases?: Array<{phase: string; startedAt: number}>;
};

const resetPlayStartTimings = (): void => {
    const root = getPlayStartTimingRoot();
    root.__stemPlayStartTimings = [];
    root.__stemPlayStartActivePhases = [];
};

const pushPlayStartPhase = (phase: string, startedAt: number): void => {
    const root = getPlayStartTimingRoot();
    root.__stemPlayStartActivePhases ??= [];
    root.__stemPlayStartActivePhases.push({phase, startedAt});
};

const popPlayStartPhase = (phase: string, startedAt: number): void => {
    const phases = getPlayStartTimingRoot().__stemPlayStartActivePhases;
    if (!phases?.length) return;
    const index = phases.findIndex(entry => entry.phase === phase && entry.startedAt === startedAt);
    if (index >= 0) phases.splice(index, 1);
};

const recordPlayStartTiming = (entry: PlayStartTimingEntry): void => {
    const root = getPlayStartTimingRoot();
    root.__stemPlayStartTimings ??= [];
    root.__stemPlayStartTimings.push(entry);
    if (!entry.success || entry.ms >= PLAY_START_SLOW_TIMING_LOG_THRESHOLD_MS) {
        console.debug(
            `[PlayStartupTiming] ${entry.phase} ${entry.ms}ms ok=${entry.success}` +
                (entry.message ? ` ${entry.message}` : ""),
        );
    }
};

const timePlayStartPhase = async <T>(phase: string, task: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    pushPlayStartPhase(phase, start);
    try {
        const result = await task();
        const end = performance.now();
        recordPlayStartTiming({phase, ms: Math.round(end - start), success: true, startedAt: start, endedAt: end});
        return result;
    } catch (error) {
        const end = performance.now();
        recordPlayStartTiming({
            phase,
            ms: Math.round(end - start),
            success: false,
            message: error instanceof Error ? error.message : String(error),
            startedAt: start,
            endedAt: end,
        });
        throw error;
    } finally {
        popPlayStartPhase(phase, start);
    }
};

const timePlayStartSync = <T>(phase: string, task: () => T): T => {
    const start = performance.now();
    pushPlayStartPhase(phase, start);
    try {
        const result = task();
        const end = performance.now();
        recordPlayStartTiming({phase, ms: Math.round(end - start), success: true, startedAt: start, endedAt: end});
        return result;
    } catch (error) {
        const end = performance.now();
        recordPlayStartTiming({
            phase,
            ms: Math.round(end - start),
            success: false,
            message: error instanceof Error ? error.message : String(error),
            startedAt: start,
            endedAt: end,
        });
        throw error;
    } finally {
        popPlayStartPhase(phase, start);
    }
};

const getModeTimingRoot = () => globalThis as typeof globalThis & {
    __stemModeTimings?: ModeTimingEntry[];
};

const resetModeTimings = (): void => {
    getModeTimingRoot().__stemModeTimings = [];
};

const recordModeTiming = (entry: ModeTimingEntry): void => {
    const root = getModeTimingRoot();
    root.__stemModeTimings ??= [];
    root.__stemModeTimings.push(entry);
};

const timeModePhase = async <T>(mode: ApplicationMode, phase: string, task: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    try {
        const result = await task();
        const end = performance.now();
        recordModeTiming({mode, phase, ms: Math.round(end - start), success: true, startedAt: start, endedAt: end});
        return result;
    } catch (error) {
        const end = performance.now();
        recordModeTiming({
            mode,
            phase,
            ms: Math.round(end - start),
            success: false,
            message: error instanceof Error ? error.message : String(error),
            startedAt: start,
            endedAt: end,
        });
        throw error;
    }
};

type I18nModule = typeof import("@stem/editor-oss/i18n/config");

let i18nModulePromise: Promise<I18nModule> | null = null;

function loadI18nModule(): Promise<I18nModule> {
    if (!i18nModulePromise) {
        i18nModulePromise = import("@stem/editor-oss/i18n/config");
    }
    return i18nModulePromise;
}

async function translateRuntime(key: string, fallback: string): Promise<string> {
    try {
        const {default: i18n} = await loadI18nModule();
        return i18n.t(key) || fallback;
    } catch (error) {
        console.warn(`[EngineRuntime] Failed to load i18n for "${key}":`, error);
        return fallback;
    }
}

class LazyBatchedRenderer extends Group implements BatchedRendererLike {
    private readonly pendingSystems = new Set<unknown>();
    private depthTexture: unknown = null;

    constructor(private readonly requestRealRenderer: () => void) {
        super();
        this.name = "BatchedRenderer";
        (this as {type: string}).type = "BatchedRenderer";
    }

    addSystem(system: unknown): void {
        this.pendingSystems.add(system);
        if (system && typeof system === "object") {
            (system as {_renderer?: unknown})._renderer = this;
        }
        this.requestRealRenderer();
    }

    deleteSystem(system: unknown): void {
        this.pendingSystems.delete(system);
        if (system && typeof system === "object" && (system as {_renderer?: unknown})._renderer === this) {
            (system as {_renderer?: unknown})._renderer = null;
        }
    }

    setDepthTexture(depthTexture: unknown): void {
        this.depthTexture = depthTexture;
        this.requestRealRenderer();
    }

    updateSystem(system: unknown): void {
        this.pendingSystems.add(system);
        this.requestRealRenderer();
    }

    update(): void {
        if (this.pendingSystems.size > 0) {
            this.requestRealRenderer();
        }
    }

    drainPendingSystems(): unknown[] {
        const systems = Array.from(this.pendingSystems);
        this.pendingSystems.clear();
        return systems;
    }

    getPendingDepthTexture(): unknown {
        return this.depthTexture;
    }
}

// Application have a lot of responsibilities, which can lead to high complexity and low maintainability.
// Consider splitting responsibilities to different classes or modules (e.g., SceneManager, ModeManager, etc.)
export class EngineRuntime extends AppRuntime implements RuntimeContext {
    static isSandboxViewer() {
        return window.location.pathname.indexOf("/sandbox/") !== -1;
    }

    private viewportSafeAreaElements = new Map<string, HTMLElement>();
    private readonly runtimeOverlaySafeAreaCoordinator: RuntimeOverlaySafeAreaCoordinator;

    // Make sure that we have clear interfaces instead of using field directly to assign values
    // This will help reduce complexity and improve maintainability

    // Consider making some of these properties private/protected
    // Add type annotations for better type safety

    private _mode: ApplicationMode = ApplicationMode.IDLE;
    /**
     * A Play → Edit transition must rebuild editor behavior previews before
     * its first restored frame. Local Playground normally defers that work to
     * keep the initial editor responsive, but reusing the runtime scene after
     * Play can leave authored preview geometry (for example a generated chess
     * board) absent from the editor surface.
     */
    private restoreEditorPreviewOnModeEntry = false;
    get mode(): ApplicationMode {
        return this._mode;
    }

    /**
     * True while a mode transition is active or queued.
     *
     * `mode` and `isPlaying` intentionally flip early during teardown so the
     * renderer and route can begin their handoff. UI must still treat that
     * interval as busy; otherwise a user can click Play while Stop is restoring
     * the editor and enqueue a second transition against a half-restored scene.
     */
    private modeTransitionPending = 0;
    get isModeTransitioning(): boolean {
        return (this.modeTransitionPending ?? 0) > 0;
    }

    viewport: HTMLElement | undefined;
    width: number;
    height: number;
    storage: Storage;
    debug: boolean;
    private _packageManager: PackageManager | null = null;
    require: (names: unknown) => Promise<any>;
    helpers: Helpers | null = null;
    editor: Editor | null;
    /** Convenience accessor — returns the editor's SceneConfig (or null if editor is not initialized). */
    get sceneConfig(): SceneConfig | null {
        return this.editor?.sceneConfig ?? null;
    }

    ui!: React.ReactElement;
    stats: Stats | null = null;
    drawcallPanelManager: DrawcallPanelManager | null = null;
    ramPanelManager: RamPanelManager | null = null;
    memoryMonitor: MemoryMonitor | null = null;
    disableClickEvents = false;
    authManager = new ApplicationAuthStore();

    /** Root asset ID for the current edit scope (stem editor). Sent as X-Root-Asset-Id header. */
    rootAssetId: string | null = null;
    /** Signed asset token for non-owner access to the root asset. Sent as X-Asset-Token header. */
    assetToken: string | null = null;
    multiplayerClient: SimpleMultiplayerCollaborativeClient | null = null;
    private multiplayerClientSetupPromise: Promise<void> | null = null;

    //Three.js related properties
    converter: any | null = null;
    private converterPromise: Promise<any> | null = null;
    private extendedDirectionalLightSupportPromise: Promise<void> | null = null;
    private rectAreaLightSupportPromise: Promise<void> | null = null;
    private _scene: Scene = new Scene();
    get scene(): Scene {
        return this._scene;
    }
    set scene(nextScene: Scene) {
        if (this._scene === nextScene) {
            return;
        }

        const previousScene = this._scene;
        const previousHelperRoot = findSceneHelpersRoot(previousScene);

        this._scene = nextScene;
        this._scene.matrixWorldAutoUpdate = false;
        getOrCreateDynamicRoot(this._scene);

        if (previousHelperRoot) {
            const nextHelperRoot = getOrCreateSceneHelpersRoot(this._scene);
            nextHelperRoot.visible = previousHelperRoot.visible;

            // Move editor helper objects to the new active scene so scene recreation
            // does not strand gizmos/grid on the previous helper root.
            while (previousHelperRoot.children.length > 0) {
                nextHelperRoot.add(previousHelperRoot.children[0]!);
            }
        }
    }
    assetLoader: AssetLoader = new AssetLoader({
        getRenderer: () => this.renderer,
    });
    behaviorLoadingService: BehaviorLoadingService = new BehaviorLoadingService(true, this.assetLoader);
    assetInstanceManager: AssetInstanceManager = new AssetInstanceManager(this.assetLoader);
    get sceneHelpers(): Group {
        return getOrCreateSceneHelpersRoot(this.scene);
    }
    camera: PerspectiveCamera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 100000);
    orthCamera: OrthographicCamera = new OrthographicCamera();
    rendererCSS: CSS3DRenderer = null as unknown as CSS3DRenderer;
    renderer: WebGPURenderer = null as unknown as WebGPURenderer;
    effectRenderer: EffectRenderer | null = null;
    batchedRenderer: BatchedRendererLike = new LazyBatchedRenderer(() => {
        void this.ensureBatchedRenderer();
    });
    private batchedRendererPromise: Promise<BatchedRendererLike> | null = null;
    transformControls: TransformControls | null = null;
    objectOutliner: ObjectOutliner | null = null;
    scripts: any = [];
    animations: any = [];

    // Player
    playerSession: PlayerSession | null = null;
    vrmExpressionControl: VRMExpressionController = new VRMExpressionController(this); // has to be created on app creation

    // --- Backward-compatible accessors for play-mode subsystems ---
    get game(): GameManager | null {
        return this.playerSession?.game ?? null;
    }
    get playerEvent(): PlayerEvent | null {
        return this.playerSession?.playerEvent ?? null;
    }

    getViewportSafeArea(): ViewportSafeArea {
        return getViewportSafeArea(this.viewport, Array.from(this.viewportSafeAreaElements.values()));
    }

    registerViewportSafeAreaElement(id: string, element: HTMLElement | null): void {
        if (!id) return;
        if (element) {
            this.viewportSafeAreaElements.set(id, element);
            this.runtimeOverlaySafeAreaCoordinator.start();
            this.runtimeOverlaySafeAreaCoordinator.refresh();
            return;
        }
        this.viewportSafeAreaElements.delete(id);
        this.runtimeOverlaySafeAreaCoordinator.refresh();
    }
    get aiWorldControl(): AiWorldControl | null {
        return this.playerSession?.aiWorldControl ?? null;
    }
    get animationControl(): AnimationController | null {
        return this.playerSession?.animationControl ?? null;
    }
    get animationGraphControl(): AnimationGraphController | null {
        return this.playerSession?.animationGraphControl ?? null;
    }
    get audioControl(): AudioController | null {
        return this.playerSession?.audioControl ?? null;
    }
    get audio(): PlayerAudio | null {
        return this.playerSession?.audio ?? null;
    }
    get physics(): PlayerPhysics2 | null {
        return this.playerSession?.physics ?? null;
    }
    get webvr(): WebVR | null {
        return this.playerSession?.webvr ?? null;
    }

    playerMask: PlayerLoadMask = new PlayerLoadMask(this);

    isPlaying = false;
    isPaused = false;
    private runtimeStartupActive = false;
    isCameraLocked = false;
    viewportDisposed = false;
    isGameMenuOpen = false;

    // Play-mode inspector: snapshot of pre-play state for revert-on-stop, plus optional free-fly debug camera
    private playmodeSnapshot: PlaymodeSnapshot | null = null;
    playmodeDebugCamera: PlaymodeDebugCamera | null = null;

    /** Pre-play snapshot used by the inspector for both revert-on-stop and the changes-summary report. */
    getPlaymodeSnapshot(): PlaymodeSnapshot | null {
        return this.playmodeSnapshot;
    }

    private clock = new FrameClock(false);
    private frameTimer = new Timer();
    private simulationClock = new FixedStepSimulationClock();
    private activeSimulationFrameContext: FrameContext | null = null;
    private pendingWorkerSimulationFrame: {
        clock: Clock;
        variableDeltaTime: number;
        frameContext: FrameContext;
        remainingFixedSteps: number;
        deferredCompletedFixedSteps: number;
    } | null = null;
    private fixedStepListenerPhysics: PlayerPhysics2 | null = null;
    private completedWorkerFixedStepsSinceTelemetry = 0;
    private workerDroppedFixedSteps = 0;
    private workerDroppedSimulationTime = 0;
    private completeWorkerFixedStep(fixedDeltaTime: number): void {
        const pendingFrame = this.pendingWorkerSimulationFrame;
        if (!this.isPlaying || !this.game || !pendingFrame) return;

        pendingFrame.frameContext.fixedDeltaTime = fixedDeltaTime;
        this.game.fixedUpdate(fixedDeltaTime, pendingFrame.frameContext);
        this.completedWorkerFixedStepsSinceTelemetry++;

        pendingFrame.remainingFixedSteps -= 1;
        if (pendingFrame.remainingFixedSteps > 0) return;

        // A worker ACK is the ordering barrier: all fixed gameplay for this
        // frame must complete before variable gameplay sees the same context.
        for (let i = 0; i < pendingFrame.deferredCompletedFixedSteps; i += 1) {
            this.game.fixedUpdate(pendingFrame.frameContext.fixedDeltaTime, pendingFrame.frameContext);
        }
        this.pendingWorkerSimulationFrame = null;
        this.activeSimulationFrameContext = pendingFrame.frameContext;
        this.runVariableSimulationStages(
            pendingFrame.clock,
            pendingFrame.variableDeltaTime,
            pendingFrame.frameContext,
        );
    }
    private readonly handleWorkerFixedStepComplete = (fixedDeltaTime: number): void => {
        this.completeWorkerFixedStep(fixedDeltaTime);
    };
    private legacyAnimationLoopCallback: (() => void) | null = null;
    private appliedAnimationLoopRenderer: WebGPURenderer | null = null;
    private appliedAnimationLoopCallback: (() => void) | null = null;
    private animationLoopListener: ((clock: Clock, deltaTime: number) => void) | null = null;
    private animationListenerRegistered = false;
    private scenePhysicsPreloadSignature: string | null = null;
    private scenePhysicsPreloadTimer: ReturnType<typeof setTimeout> | null = null;
    private playerSessionPreloadTimer: ReturnType<typeof setTimeout> | null = null;
    private runtimeSceneRevealController: RuntimeSceneRevealController | null = null;
    private runtimeRevealPrecompileKeys = new WeakMap<object, Set<string>>();
    private postStartupRuntimeBudgetToken = 0;
    private runtimeMaterialBudgetAppliedScene: Scene | null = null;
    private runtimeInstancingBudgetAppliedScene: Scene | null = null;
    private runtimeShadowBudgetAppliedScene: Scene | null = null;
    private runtimeMainTriangleBudgetAppliedScene: Scene | null = null;
    private runtimeStartupWarmupRendered = false;
    /** Monotonic timestamp of the last completed renderer pass. */
    lastRenderedFrameAt = 0;

    private qualitySystem: QualitySystemIntegration | null = null;
    public environmentManager: EnvironmentSettingsManager | null = null;
    public loadingManager: LoadingManager;

    // Promise chain that ensures calls to setMode are executed in order
    private setModePromise = Promise.resolve();
    private _startPromise: Promise<void> | null = null;
    private _rendererInitPromise: Promise<void> | null = null;
    private _recreateRendererPromise: Promise<void> | null = null;
    private _lastForceWebGLSetting: boolean | undefined;
    private _forceWebGLFallback = false;

    /**
     * True while the Play/Sandbox startup handshake is constructing runtime
     * systems and warming the first visible frame. Adaptive render-pressure
     * changes must not resize the drawing buffer during this window.
     */
    isRuntimeStartupActive(): boolean {
        return this.runtimeStartupActive;
    }

    get isWebGLFallback(): boolean {
        return this._forceWebGLFallback;
    }

    get packageManager(): PackageManager {
        if (this._packageManager === null) {
            this._packageManager = new PackageManager();
        }

        return this._packageManager;
    }

    set packageManager(packageManager: PackageManager) {
        this._packageManager = packageManager;
    }

    constructor(container: HTMLElement, options: any) {
        super(container, options);

        global.app = this;
        // Expose the active runtime for browser-console inspection and
        // Playwright smoke diagnostics; app code should use the module global.
        (window as unknown as {app?: unknown}).app = this;

        this.runtimeOverlaySafeAreaCoordinator = new RuntimeOverlaySafeAreaCoordinator({
            getSafeArea: () => this.getViewportSafeArea(),
        });

        this.viewport = undefined;
        this.width = this.container.clientWidth;
        this.height = this.container.clientHeight;

        this.scene.name = "AppScene";
        getOrCreateDynamicRoot(this.scene);

        this.storage = new Storage();
        this.debug = (!!this.storage.get("debug") && !this.options.isPlayModeOnly) || false;

        this.require = names => this.packageManager.require(names);

        this.event = new EventDispatcher();
        this.call = this.event.call.bind(this.event);
        this.on = this.event.on.bind(this.event);
        this.off = this.event.off.bind(this.event);

        this.editor = null;
        this.loadingManager = new LoadingManager(this);

        // NOTE: disable auto update of a world matrix because we do it in RenderEvent.animate
        this.scene.matrixWorldAutoUpdate = false;
        (this.batchedRenderer as any).name = "BatchedRenderer";

        this.initCamera();
    }

    private async ensureConverter(): Promise<any> {
        if (this.converter) {
            return this.converter;
        }

        if (!this.converterPromise) {
            this.converterPromise = import("./serialization/Converter.js")
                .then(({default: ConverterClass}) => {
                    this.converter = new (ConverterClass as any)();
                    return this.converter;
                })
                .finally(() => {
                    this.converterPromise = null;
                });
        }

        return this.converterPromise;
    }

    async ensureBatchedRenderer(): Promise<QuarksBatchedRenderer> {
        if (!(this.batchedRenderer instanceof LazyBatchedRenderer)) {
            return this.batchedRenderer as unknown as QuarksBatchedRenderer;
        }

        if (!this.batchedRendererPromise) {
            const placeholder = this.batchedRenderer;
            this.batchedRendererPromise = import("three.quarks")
                .then(({BatchedRenderer}) => {
                    if (!(this.batchedRenderer instanceof LazyBatchedRenderer)) {
                        return this.batchedRenderer;
                    }

                    const renderer = new BatchedRenderer() as unknown as BatchedRendererLike;
                    renderer.name = placeholder.name || "BatchedRenderer";
                    (renderer as {type: string}).type = "BatchedRenderer";
                    renderer.userData = {
                        ...placeholder.userData,
                    };
                    renderer.position.copy(placeholder.position);
                    renderer.quaternion.copy(placeholder.quaternion);
                    renderer.scale.copy(placeholder.scale);
                    renderer.layers.mask = placeholder.layers.mask;
                    renderer.visible = placeholder.visible;
                    renderer.renderOrder = placeholder.renderOrder;

                    const parent = placeholder.parent;
                    const insertIndex = parent ? parent.children.indexOf(placeholder) : -1;
                    if (parent) {
                        placeholder.removeFromParent();
                        parent.add(renderer);
                        if (insertIndex >= 0) {
                            const currentIndex = parent.children.indexOf(renderer);
                            if (currentIndex >= 0 && currentIndex !== insertIndex) {
                                parent.children.splice(currentIndex, 1);
                                parent.children.splice(Math.min(insertIndex, parent.children.length), 0, renderer);
                            }
                        }
                    }

                    this.batchedRenderer = renderer;
                    this.configureBatchedRenderer();

                    const depthTexture = placeholder.getPendingDepthTexture();
                    if (depthTexture) {
                        renderer.setDepthTexture(depthTexture);
                    }
                    for (const system of placeholder.drainPendingSystems()) {
                        renderer.addSystem(system);
                    }

                    return renderer;
                })
                .finally(() => {
                    this.batchedRendererPromise = null;
                });
        }

        return this.batchedRendererPromise as Promise<QuarksBatchedRenderer>;
    }

    private objectTreeHas(object: Object3D, predicate: (object: Object3D) => boolean): boolean {
        return findObjectDepthFirst(object, predicate) !== null;
    }

    private async objectTreeHasProgressive(
        object: Object3D,
        predicate: (object: Object3D) => boolean,
    ): Promise<boolean> {
        const maybeYield = createProgressiveYieldController(
            {yieldToFrame: () => this.yieldToNextPaint()},
            {
                batchSize: PLAY_START_RUNTIME_BUDGET_BATCH_SIZE,
                frameBudgetMs: PLAY_START_RUNTIME_BUDGET_FRAME_MS,
            },
        );
        const stack: Object3D[] = [object];

        while (stack.length > 0) {
            const child = stack.pop();
            if (!child) continue;

            if (predicate(child)) {
                return true;
            }

            for (let i = child.children.length - 1; i >= 0; i--) {
                const nested = child.children[i];
                if (nested) stack.push(nested);
            }

            await maybeYield();
        }

        return false;
    }

    private sceneHasExtendedDirectionalLight(scene: Scene): boolean {
        return this.objectTreeHas(scene, object => (object as any)?.isExtendedDirectionalLight === true);
    }

    private sceneHasRectAreaLight(scene: Scene): boolean {
        return this.objectTreeHas(scene, object => (object as any)?.isRectAreaLight === true);
    }

    private ensureExtendedDirectionalLightSupport(): Promise<void> {
        if (!this.extendedDirectionalLightSupportPromise) {
            this.extendedDirectionalLightSupportPromise = Promise.all([
                import("@stem/editor-oss/light/ExtendedDirectionalLight"),
                loadThreeWebGPU(),
            ])
                .then(([{ExtendedDirectionalLight}, {DirectionalLightNode}]) => {
                    const renderer = this.renderer;
                    // Scene/object setup can race renderer creation in the
                    // Playground editor. Rendering support is retried by the
                    // normal renderer-ready path; never turn that race into
                    // an uncaught null-renderer startup error.
                    if (!renderer) {
                        this.extendedDirectionalLightSupportPromise = null;
                        return;
                    }
                    const nodeLibrary = renderer.library as unknown as {
                        getLightNodeClass?: (lightClass: unknown) => unknown;
                        lightNodes?: WeakMap<object, unknown>;
                        addLight?: (lightNodeClass: unknown, lightClass: unknown) => void;
                    };
                    const lightClass = ExtendedDirectionalLight as unknown as object;
                    const hasExtendedDirectionalLight =
                        nodeLibrary.getLightNodeClass?.(ExtendedDirectionalLight) != null ||
                        nodeLibrary.lightNodes?.has(lightClass) === true;
                    if (!hasExtendedDirectionalLight) {
                        nodeLibrary.addLight?.(DirectionalLightNode, ExtendedDirectionalLight);
                    }
                })
                .catch(error => {
                    this.extendedDirectionalLightSupportPromise = null;
                    throw error;
                });
        }

        return this.extendedDirectionalLightSupportPromise;
    }

    private ensureRectAreaLightSupport(): Promise<void> {
        if (!this.rectAreaLightSupportPromise) {
            this.rectAreaLightSupportPromise = Promise.all([
                import("three/addons/lights/RectAreaLightTexturesLib.js"),
                loadThreeWebGPU(),
            ])
                .then(([{RectAreaLightTexturesLib}, {RectAreaLightNode}]) => {
                    RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());
                })
                .catch(error => {
                    this.rectAreaLightSupportPromise = null;
                    throw error;
                });
        }

        return this.rectAreaLightSupportPromise;
    }

    async ensureObjectRenderingSupport(object: Object3D): Promise<void> {
        const tasks: Array<Promise<void>> = [];
        if (this.objectTreeHas(object, child => (child as any)?.isExtendedDirectionalLight === true)) {
            tasks.push(this.ensureExtendedDirectionalLightSupport());
        }
        if (this.objectTreeHas(object, child => (child as any)?.isRectAreaLight === true)) {
            tasks.push(this.ensureRectAreaLightSupport());
        }
        if (tasks.length > 0) {
            await Promise.all(tasks);
        }
    }

    private async ensureSceneRenderingSupport(scene: Scene): Promise<void> {
        const tasks: Array<Promise<void>> = [];
        if (this.sceneHasExtendedDirectionalLight(scene)) {
            tasks.push(this.ensureExtendedDirectionalLightSupport());
        }
        if (this.sceneHasRectAreaLight(scene)) {
            tasks.push(this.ensureRectAreaLightSupport());
        }
        if (tasks.length > 0) {
            await Promise.all(tasks);
        }
    }

    private async loadSceneFromData(params: any): Promise<any> {
        const [converter, {loadScene: loadSceneData}] = await Promise.all([
            this.ensureConverter(),
            import("@stem/editor-oss/scene/util"),
        ]);

        return loadSceneData({
            ...params,
            converter,
        });
    }

    /**
     * Async initialization — must be called after construction.
     * Dynamically imports editor-only modules when not in player mode.
     */
    async init(): Promise<void> {
        const options = this.options;
        const isPlayerShell = options.isPlayModeOnly || EngineRuntime.isSandboxViewer();

        if (isPlayerShell) {
            const [{PlayerSceneHost}, {default: EnvironmentSettingsManagerClass}] = await Promise.all([
                import("@web-shared/player/PlayerSceneHost"),
                import("./utils/EnvironmentSettingsManager"),
            ]);
            this.editor = new PlayerSceneHost(this) as unknown as Editor;
            this.environmentManager = new EnvironmentSettingsManagerClass(this.editor);
        } else {
            // Editor routes load the full editor class lazily so the player
            // shell can stay out of editor UI and editor lifecycle modules.
            const [{default: EditorClass}, {default: EnvironmentSettingsManagerClass}] = await Promise.all([
                import("./editor/Editor"),
                import("./utils/EnvironmentSettingsManager"),
            ]);
            this.editor = new EditorClass(this);
            this.environmentManager = new EnvironmentSettingsManagerClass(this.editor);
        }

        // Re-initialize camera data now that the active scene host is available.
        this.camera.userData.cameraData = this.editor.getDefaultCameraData();

        // Dynamically import the appropriate React root component.
        // Player needs `useAuthorizationContext` for its ownership gate, so the
        // play-mode-only / sandbox-viewer paths must wrap it in
        // `AuthorizationContextProvider` even though they bypass
        // `PublicAppContainer`. Without the wrapper, Player.tsx:42 reads the
        // `null!` default and crashes during render.
        const root = createRoot(this.container);
        if (!isPlayerShell) {
            const {AppContainer} = await import("@web-shared/AppContainer");
            this.ui = createElement(AppContainer);
        } else {
            const [{Player}, {default: AuthorizationContextProvider}] = await Promise.all([
                import("./v2/pages/Player/Player"),
                import("@stem/editor-oss/context/AuthorizationContext"),
            ]);
            this.ui = createElement(AuthorizationContextProvider, null, createElement(Player));
        }
        root.render(this.ui);

        this.listenForSceneLoaded();

        const {QualitySystemIntegration} = await import("./core/quality/QualitySystemIntegration");
        this.qualitySystem = QualitySystemIntegration.getInstance();
        void this.qualitySystem.initialize(this);

        if (typeof document !== "undefined") {
            this.frameTimer.connect(document);
        }
    }

    private handleContextLost = (e: any) => {
        e.preventDefault?.();

        // Per the WebGPU spec, device.lost reasons are "unknown" or "destroyed".
        // "destroyed" indicates that the underlying device was intentionally destroyed
        // (e.g. via device.destroy() when tearing down/recreating the renderer). In that
        // case we do not want to trigger recreateRenderer() again, to avoid redundant
        // work or potential recreate loops.
        if (e.reason === "destroyed") {
            return;
        }

        console.warn("[APP] Device lost, recreating renderer...", e);
        void this.recreateRenderer();
    };

    private async recreateRenderer() {
        // Guard against concurrent recreateRenderer calls by reusing a single in-flight promise.
        if (this._recreateRendererPromise) {
            return this._recreateRendererPromise;
        }

        const recreatePromise = (async () => {
            // Cleanup existing renderer
            if (this.renderer) {
                this.renderer.domElement.removeEventListener("webglcontextlost", this.handleContextLost);
                this.renderer.dispose();
                this.renderer.domElement.remove();
                if (this.renderer.isWebGPURenderer) {
                    try {
                        (this.renderer.backend as any)?.device?.destroy();
                    } catch (err) {
                        console.warn("[APP] Error while destroying WebGPU device during renderer recreation:", err);
                    }
                }
            }

            const width = this.viewport?.clientWidth || window.innerWidth;
            const height = this.viewport?.clientHeight || window.innerHeight;

            // First, try to recreate the WebGPU renderer.
            try {
                const webgpuRenderer = await this.createWebGPURenderer();
                this.renderer = webgpuRenderer;
                if (this.game) {
                    this.game.setRenderer(webgpuRenderer);
                }

                const canvas = webgpuRenderer.domElement;

                if (this.rendererCSS && canvas) {
                    this.rendererCSS.domElement.appendChild(canvas);
                }

                if (width && height) {
                    webgpuRenderer.setSize(width, height);
                }

                this.configureBatchedRenderer();

                await webgpuRenderer.init();
                patchMesh(webgpuRenderer);

                if ((webgpuRenderer.backend as WebGPUBackend).isWebGPUBackend) {
                    (webgpuRenderer.backend as WebGPUBackend & {device: GPUDevice}).device.lost.then(this.handleContextLost);
                }

                this.call("resize", this);
                console.info("[APP][TRACE] emitting restartRenderer from recreateRenderer (webgpu)");
                this.call("restartRenderer", this);
                return;
            } catch (err) {
                console.warn("[APP] WebGPU re-init failed, attempting WebGL fallback:", err);

                try {
                    const fallbackRenderer = await this.createWebGPURenderer(true);
                    this.renderer = fallbackRenderer;
                    if (this.editor) {
                        this.editor.renderer = fallbackRenderer;
                    }
                    if (this.game) {
                        this.game.setRenderer(fallbackRenderer);
                    }

                    const fallbackCanvas = fallbackRenderer.domElement;
                    if (this.rendererCSS && fallbackCanvas) {
                        this.rendererCSS.domElement.appendChild(fallbackCanvas);
                    }

                    if (width && height) {
                        fallbackRenderer.setSize(width, height);
                    }

                    this.configureBatchedRenderer();

                    await fallbackRenderer.init();
                    patchMesh(fallbackRenderer);

                    this._forceWebGLFallback = true;
                    showRuntimeToast({type: "info", title: "WebGPU unavailable, using WebGL fallback."});

                    this.call("resize", this);
                    console.info("[APP][TRACE] emitting restartRenderer from recreateRenderer (webgl fallback)");
                    this.call("restartRenderer", this);
                    return;
                } catch (fallbackErr) {
                    console.error("[APP] WebGL fallback also failed:", fallbackErr);
                    // At this point, rendering is unavailable; notify the user.
                    this.renderer = null as any;
                    if (this.editor) {
                        (this.editor as any).renderer = null;
                    }
                    if (this.game) {
                        this.game.setRenderer(undefined);
                    }
                    showRuntimeToast({
                        body: await translateRuntime(
                            "app.renderer.initFailed",
                            "Renderer initialization failed. Please reload the page.",
                        ),
                        type: "error",
                    });
                }
            }
        })();

        this._rendererInitPromise = recreatePromise;
        this._recreateRendererPromise = recreatePromise;
        try {
            await recreatePromise;
        } finally {
            this._recreateRendererPromise = null;
        }
    }

    async start(viewport?: HTMLElement): Promise<void> {
        if (this._startPromise) {
            await this._startPromise;
            return;
        }

        const startPromise = this.startApplication(viewport);
        this._startPromise = startPromise;
        try {
            await startPromise;
        } finally {
            if (this._startPromise === startPromise) {
                this._startPromise = null;
            }
        }
    }

    private async startApplication(viewport?: HTMLElement): Promise<void> {
        console.info("[APP] Starting Application...");
        this.viewport = viewport;

        const width = this.viewport?.clientWidth;
        const height = this.viewport?.clientHeight;

        if (width && height) {
            this.orthCamera = new OrthographicCamera(-width / 4, width / 4, height / 4, -height / 4, 0.1, 512);
            // Ensure perspective camera aspect matches current viewport (previously used window inner sizes at construction)
            if (this.camera) {
                const newAspect = width / height;
                if (Math.abs(this.camera.aspect - newAspect) > 0.0001) {
                    this.camera.aspect = newAspect;
                    this.camera.updateProjectionMatrix();
                }
            }
        }

        const {CSS3DRenderer} = await import("three/addons/renderers/CSS3DRenderer.js");
        this.rendererCSS = new CSS3DRenderer();
        if (width && height) {
            this.rendererCSS.setSize(width, height);
        }

        const wrapper = this.rendererCSS.domElement.getElementsByTagName("div")[0];
        if (wrapper) {
            wrapper.style.position = "absolute";
            wrapper.style.top = "0";
            wrapper.style.left = "0";
            wrapper.style.zIndex = "2";
        }

        // TODO: refactor Application lifecycle management
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer.domElement.remove();

            if (this.renderer.isWebGPURenderer) {
                (this.renderer.backend as any)?.device?.destroy();
            }
        }

        this.renderer = await this.createWebGPURenderer();
        if (this.game) {
            this.game.setRenderer(this.renderer);
        }

        const canvas = this.renderer.domElement;

        if (canvas) {
            this.rendererCSS.domElement.appendChild(canvas);
        }
        this.viewport?.appendChild(this.rendererCSS.domElement);

        if (width && height) {
            this.renderer.setSize(width, height);
        }

        this.event.start();

        if (!this.options.isPlayModeOnly) {
            const {default: HelpersClass} = await import("@stem/editor-oss/helper/Helpers");
            this.helpers = new HelpersClass();
            this.helpers.start();
        }

        this.configureBatchedRenderer();

        const renderer = this.renderer;

        try {
            this._rendererInitPromise = this.renderer.init() as unknown as Promise<void>;

            await this._rendererInitPromise;

            patchMesh(renderer);
            const backend = renderer.backend as WebGPUBackend | null | undefined;
            if (backend?.isWebGPUBackend) {
                (backend as WebGPUBackend & {device: GPUDevice}).device.lost.then(this.handleContextLost);
            }
        } catch (err) {
            console.warn("[APP] WebGPU init failed, attempting WebGL fallback:", err);

            try {
                // Dispose the failed renderer and its canvas
                renderer.dispose();
                renderer.domElement.remove();

                const fallbackRenderer = await this.createWebGPURenderer(true);
                this.renderer = fallbackRenderer;
                if (this.editor) {
                    this.editor.renderer = fallbackRenderer;
                }
                if (this.game) {
                    this.game.setRenderer(fallbackRenderer);
                }

                const fallbackCanvas = fallbackRenderer.domElement;
                if (this.rendererCSS && fallbackCanvas) {
                    this.rendererCSS.domElement.appendChild(fallbackCanvas);
                }

                if (width && height) {
                    fallbackRenderer.setSize(width, height);
                }

                this.configureBatchedRenderer();

                this._rendererInitPromise = fallbackRenderer.init() as unknown as Promise<void>;
                await this._rendererInitPromise;

                patchMesh(fallbackRenderer);
                this._forceWebGLFallback = true;
                showRuntimeToast({type: "info", title: "WebGPU unavailable, using WebGL fallback."});
            } catch (fallbackErr) {
                console.error("[APP] WebGL fallback also failed:", fallbackErr);
                showRuntimeToast({type: "error", title: "Failed to initialize WebGPU renderer."});
                throw fallbackErr;
            }
        }

        this.viewportDisposed = false;
        this.call("appStart", this);
        this.call("appStarted", this);

        // In Play mode, don't start the animation loop until we've finished
        // loading the scene. We display a loading screen until then, so
        // rendered frames are not visible and simply consume CPU time.
        if (!this.options.isPlayModeOnly) {
            this.startScheduledAnimationLoop();
        }

        this.call("resize", this);

        // Basic debug info to help diagnose blank screen issues.
        const winDebug = window as unknown as {DEBUG_APP_RENDER?: boolean};
        if (winDebug.DEBUG_APP_RENDER === true) {
            console.groupCollapsed("[APP][DEBUG] Initial Render State");
            console.debug("Renderer:", this.renderer.constructor.name);
            console.debug("Renderer Size:", this.renderer.domElement.width, this.renderer.domElement.height);
            console.debug("Pixel Ratio:", (this.renderer as any).getPixelRatio?.() ?? window.devicePixelRatio);
            console.debug("Scene Children Count:", this.scene.children.length);
            console.debug("Camera Position:", this.camera.position.toArray());
            console.debug("Camera Aspect:", this.camera.aspect);
            console.debug("Camera FOV:", (this.camera as any).fov);
            console.debug("AutoClear:", this.renderer.autoClear);
            console.debug("ShadowMap Enabled:", (this.renderer as any).shadowMap?.enabled);
            console.groupEnd();
        }
    }

    private async waitForNextFrame(): Promise<void> {
        await new Promise<void>(resolve => {
            const raf = globalThis.requestAnimationFrame;
            if (typeof raf === "function") {
                raf(() => resolve());
                return;
            }
            setTimeout(resolve, 16);
        });
    }

    private async ensureRendererReady(): Promise<void> {
        const startedAt = performance.now();
        const maxWaitMs = 15000;

        while (performance.now() - startedAt < maxWaitMs) {
            if (this._startPromise) {
                await this._startPromise;
            }
            if (this._rendererInitPromise) {
                await this._rendererInitPromise;
            }
            const renderer = this.renderer as (WebGPURenderer & {hasInitialized?: () => boolean}) | null;
            if (renderer && renderer.hasInitialized?.() !== false) {
                return;
            }

            if (!this._startPromise && !this._rendererInitPromise && !this.viewport && !this.renderer) {
                break;
            }

            await this.waitForNextFrame();
        }

        throw new Error("Renderer is not initialized. EngineRuntime.start(viewport) must complete before loading a scene.");
    }

    async stop(): Promise<void> {
        console.info("[APP] Stopping Application...");

        // Persistence is a lifecycle barrier: do not clear scene objects,
        // assets, or renderers until every dirty local generation is durable.
        await this.editor?.stop({savePolicy: "flush"});

        this.viewportDisposed = true;

        // Synchronously exit the current mode instead of fire-and-forget async setMode,
        // which would race with the scene/renderer disposal below and leave stale
        // isPlaying/isPaused flags that break the next session's sceneLoaded handler.
        this._mode = ApplicationMode.IDLE;
        this.isPlaying = false;
        this.isPaused = false;
        this.setModePromise = Promise.resolve();
        this.clearModes();

        this.event.stop();
        this.helpers?.stop();
        this.helpers = null;

        // Dispose of all geometries and materials in the scenes
        if (this.scene) {
            traverseObjectDepthFirst(this.scene, object => {
                MeshUtils.dispose(object);
            });
            this.scene.clear();
        }

        // Dispose renderers
        if (this.renderer) {
            // Temporary disable dispose to investigate issues with re-initialization
            this.renderer.dispose();
            this.renderer.domElement.remove();
        }

        if (this.rendererCSS) {
            if (this.rendererCSS.domElement) {
                this.rendererCSS.domElement.remove();
            }

            this.rendererCSS = null as any;
        }

        this.editor?.clear();
        void this.multiplayerClient?.terminate();
        this.multiplayerClient = null;

        // Clear AssetLoader cache (keep instance alive for next session)
        this.assetLoader.clear();
        this.assetInstanceManager.dispose();
        this.frameTimer.dispose();
    }

    canSetMode(mode: ApplicationMode): boolean {
        return !(this.options.isPlayModeOnly && mode !== ApplicationMode.PLAY);
    }

    /**
     * Transition to a new application mode.
     *
     * @remarks
     * This method is asynchronous and returns a promise that resolves when the
     * transition is complete.
     *
     * Calls to this method are executed serially, even if the promises returned
     * by the previous calls are not yet resolved.
     *
     * @param mode - The new application mode
     * @returns A promise that resolves when the transition is complete.
     */
    async setMode(mode: ApplicationMode, options?: {editorSavePolicy?: EditorStopSavePolicy}) {
        if (mode === ApplicationMode.PLAY) {
            resetModeTimings();
        }
        this.modeTransitionPending = (this.modeTransitionPending ?? 0) + 1;
        const requestedAt = performance.now();
        recordModeTiming({mode, phase: "setModeCalled", ms: 0, success: true});
        const transition = this.setModePromise.then(async () => {
            const modeTotalStart = performance.now();
            recordModeTiming({mode, phase: "setModeQueueWait", ms: Math.round(modeTotalStart - requestedAt), success: true});
            if (mode === ApplicationMode.PLAY && isScriptImportInProgress()) {
                console.info("[APP] Play mode blocked while script import is in progress.");
                showRuntimeToast({
                    type: "info",
                    title: "Import in progress",
                    body: "Wait for the import to finish before entering Play.",
                });
                recordModeTiming({mode, phase: "scriptImportGuard", ms: Math.round(performance.now() - modeTotalStart), success: false});
                return;
            }

            if (this._mode === mode) {
                console.warn(`[APP] Cannot change to the same application mode: ${mode as any}`);
                recordModeTiming({mode, phase: "sameModeGuard", ms: Math.round(performance.now() - modeTotalStart), success: false});
                return;
            }

            const previousMode = this._mode;
            const resumeEditTransitionRender =
                previousMode === ApplicationMode.PLAY && mode === ApplicationMode.EDIT
                    ? this.pauseRenderForModeTransition()
                    : null;
            this.restoreEditorPreviewOnModeEntry = previousMode === ApplicationMode.PLAY && mode === ApplicationMode.EDIT;
            this._mode = mode;

            console.info(`[APP] Changing application mode from ${previousMode} to ${mode as any}`);

            try {
                await timeModePhase(mode, `exitMode:${previousMode}`, () =>
                    this.exitMode(previousMode, options?.editorSavePolicy ?? "flush"),
                );
            } catch (error) {
                resumeEditTransitionRender?.();
                this._mode = previousMode;
                console.error(`[APP] Failed to exit mode ${previousMode}:`, error);
                recordModeTiming({
                    mode,
                    phase: "setModeTotal",
                    ms: Math.round(performance.now() - modeTotalStart),
                    success: false,
                    message: error instanceof Error ? error.message : String(error),
                });
                throw error;
            }

            try {
                await timeModePhase(mode, `enterMode:${mode}`, () => this.enterMode(mode));
            } catch (error) {
                resumeEditTransitionRender?.();
                console.error(`[APP] Failed to enter mode ${mode}:`, error);
                recordModeTiming({
                    mode,
                    phase: "setModeTotal",
                    ms: Math.round(performance.now() - modeTotalStart),
                    success: false,
                    message: error instanceof Error ? error.message : String(error),
                });
                this._mode = previousMode;
                throw error;
            }

            if (resumeEditTransitionRender) {
                // The restored frame is the handoff boundary for Edit. Keep
                // the wait bounded so a compositor failure cannot deadlock a
                // transition, but do not expose the editor before a real frame
                // has had a chance to present.
                const localPlaygroundScene = !!(
                    this.editor?.sceneID?.startsWith("oss-") ||
                    this.scene?.userData?.sceneId?.startsWith?.("oss-")
                );
                const localPlaygroundSession = isPlaygroundMode() && localPlaygroundScene;
                const editFrameHandshakeTimeoutMs = this.editor?.isSandbox === true || localPlaygroundSession ? 3000 : 8000;
                // Do not resolve the mode transition until the restored scene
                // has submitted one real editor frame. In local Playground the
                // previous fire-and-forget path exposed the Edit UI while a
                // heavy scene was still rebuilding, which looked like a blank
                // or partially loaded editor after Play → Edit.
                const didRender = await this.waitForRestoredEditFrameAfterResume(
                    resumeEditTransitionRender,
                    editFrameHandshakeTimeoutMs,
                );
                if (!didRender) {
                    console.warn(
                        "[APP] Timed out waiting for the first restored Edit frame.",
                    );
                }
            }

            recordModeTiming({
                mode,
                phase: "setModeTotal",
                ms: Math.round(performance.now() - modeTotalStart),
                success: true,
            });
        });
        // Keep the internal serializer usable after a rejected transition,
        // while returning the real rejection to the initiating caller.
        this.setModePromise = transition
            .catch(() => undefined)
            .finally(() => {
                this.modeTransitionPending = Math.max(0, (this.modeTransitionPending ?? 1) - 1);
            });
        return transition;
    }

    async showStats() {
        if (this.editor?.showStats && (this.mode === ApplicationMode.PLAY || this.mode === ApplicationMode.SANDBOX)) {
            await this.initializeStats();
            // if (!this.drawcallPanelManager) {
            //     this.drawcallPanelManager = new DrawcallPanelManager(this.stats, this.renderer, 40);
            // }
            if (this.stats) {
                if (!this.ramPanelManager) {
                    const {RamPanelManager} = await import("./utils/RamPanelManager");
                    this.ramPanelManager = new RamPanelManager(this.stats, 40);
                }
                Object.assign(this.stats.dom.style, {
                    display: "block",
                });
                // this.drawcallPanelManager.start();
                this.ramPanelManager.start();
            }
        }
    }

    async initializeStats() {
        if (!this.stats) {
            this.stats = new Stats({
                // trackGPU: true,
                trackHz: true,
                // trackCPT: true,
                logsPerSecond: 4,
                graphsPerSecond: 30,
                samplesLog: 40,
                samplesGraph: 10,
                precision: 2,
                horizontal: true,
                minimal: false,
                mode: 1,
            });

            document.body.appendChild(this.stats.dom);
            Object.assign(this.stats.dom.style, {
                position: "fixed",
                top: "140px",
                left: "20px",
                zIndex: "100000",
                display: "none",
            });
        }

        await this.stats.init(this.renderer);
        this.stats.begin();
        // @ts-expect-error patchThreeWebGPU is missing from stats-gl typings
        this.stats.patchThreeWebGPU(this.renderer);
    }

    hideStats() {
        if (!this.stats?.dom?.style) return;
        Object.assign(this.stats?.dom?.style, {
            display: "none",
        });

        if (this.drawcallPanelManager) {
            this.drawcallPanelManager.stop();
            this.drawcallPanelManager.reset();
        }
        if (this.ramPanelManager) {
            this.ramPanelManager.stop();
            this.ramPanelManager.reset();
        }
        this.stats?.end();
    }

    showMemoryStats() {
        if (
            this.editor?.showMemoryStats &&
            (this.mode === ApplicationMode.PLAY || this.mode === ApplicationMode.SANDBOX)
        ) {
            if (!this.memoryMonitor) {
                this.memoryMonitor = new MemoryMonitor(this.renderer as unknown as WebGLRenderer);
            }

            this.memoryMonitor.start();
        }
    }

    hideMemoryStats() {
        if (this.memoryMonitor) {
            this.memoryMonitor.stop();
        }
    }

    // TODO: somehow character is controlling this, remove this dependency, character should not control application state
    startAnimationLoop() {
        if (!this.animationListenerRegistered) {
            console.info("[APP] Animation Loop Started");
            this.animationLoopListener ??= this.animate.bind(this);
            this.on("animate.Application", this.animationLoopListener);
            this.animationListenerRegistered = true;
        }
        this.resumePlayer();
    }

    stopAnimationLoop() {
        console.info("[APP] Animation Loop Stopped");
        this.removeAnimationListener();
        this.pausePlayer();
    }

    // TODO: its not clear why addPhysicsObject and removePhysicsObject are also adding/removing objects from the scene
    // rename or refactor these methods to clarify their purpose
    addPhysicsObject(object: Object3D) {
        this.scene.add(object);
        void this.physics?.addObject(object);
    }

    removePhysicsObject(object: Object3D) {
        this.scene.remove(object);
        this.physics?.removeObject(object);
    }

    clearScene() {
        const editor = this.editor;

        if (!editor) {
            console.error("Editor is not initialized.");
            return Promise.reject(new Error("Editor is not initialized."));
        }

        editor.sceneConfig.clear();
        this.behaviorLoadingService.clearSceneConfigsCache();
    }

    /**
     * Fetch the scene payload from the best available source: cached CDN URL,
     * signed dataUrl from the v2 getScene response, or the legacy load endpoint.
     *
     * @param scene - The v2 getScene response containing asset backing info and optional dataUrl
     * @param meta - The scene's per-revision metadata (dependencies, logicalIdToAssetId)
     * @param sceneId - The scene's MongoDB document ID, used as fallback for the legacy load endpoint
     * @returns The deserialized scene data and metadata in the legacy `{data, metadata}` format
     */
    private fetchScenePayload(
        scene: GetSceneResponse,
        meta: SceneMetadata,
        sceneId: string,
    ): Promise<{data: any; metadata: any}> {
        const revision = scene.asset.revision;
        // Playground scenes are backed by the local ProjectStore and expose a
        // fresh data URL for every load. Do not consult AssetLoader's durable
        // revision URL cache for these synthetic `oss-*` revisions: that cache
        // is designed for signed CDN URLs and can outlive a scene instance,
        // causing a refresh to deserialize an older/default payload while the
        // ProjectStore still contains the imported scene. Remote scenes retain
        // the cache-first path for CDN reuse.
        const isLocalPlaygroundScene = scene.id.startsWith("oss-") || scene.asset.id.startsWith("oss-asset-oss-");
        const payloadUrl = isLocalPlaygroundScene
            ? revision.dataUrl
            : this.assetLoader.getRevisionUrl(scene.asset.id, revision.id) ?? revision.dataUrl;
        if (payloadUrl) {
            return fetch(payloadUrl)
                .then(r => r.json())
                .then(data => ({
                    data,
                    metadata: {
                        Dependencies: meta.dependencies,
                        LogicalIDToAssetID: meta.logicalIdToAssetId,
                    },
                }));
        }
        return apiLoadScene(sceneId);
    }

    private seedAssetLoader(sceneId: string): Promise<void> {
        // Clear stale cache from previous scene
        this.assetLoader.clear();

        // Seed in background
        return getSceneAssets(sceneId, {
            includeDerivatives: true,
            includeDerivativeDataUrl: true,
            types: [AssetType.Model, AssetType.Image],
        })
            .then(response => {
                this.assetLoader.seedFromAssets(response.assets);
            })
            .catch(error => {
                console.warn(
                    "[Application] Failed to seed AssetLoader, model loading will use per-asset fallback:",
                    error,
                );
            });
    }

    private async checkCollaborationStatus(projectId: string, isPublished: boolean): Promise<void> {
        try {
            const isCollaborator = await checkIsSceneCollaborator(projectId);
            this.isCollaborativeUser = isCollaborator;

            if (!isCollaborator && !isPublished) {
                showRuntimeToast({
                    type: "error",
                    title: "Collaborative Mode Access Denied",
                    body: "You do not have permission to join this collaborative session. Please contact the scene owner for access.",
                });

                return Promise.reject(new Error("User is not a collaborator for this scene."));
            }
        } catch (error) {
            console.error("Error checking collaborator status:", error);
            showRuntimeToast({
                type: "error",
                title: "Unable to join collaborative session.",
                body: "An error occurred while checking your collaborator status. Please try again later.",
            });
            return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
    }

    async setUpScene(
        projectID: string,
        options: {prefetchedScene?: GetSceneResponse; revisionId?: string} = {},
    ): Promise<void> {
        await this.ensureRendererReady();

        const {prefetchedScene, revisionId} = options;
        const editor = this.editor;

        if (!editor) {
            console.error("Editor is not initialized.");
            throw new Error("Editor is not initialized.");
        }

        try {
            this.mask();
            // Pause the editor render loop while the loading mask covers the
            // canvas. Rendering empty/partial frames during the ~5 s
            // `converterParse` is wasted GPU/CPU. Play mode never started the
            // loop in `appStart`, so the call is a no-op there.
            this.stopScheduledAnimationLoop();
            this.loadingManager.startLoading();
            this.loadingManager.nextStage(LoadingMessages.LOADING_SCENE);
            const scene =
                prefetchedScene ??
                (await getSceneV2(projectID, {
                    includeDerivatives: true,
                    includeDerivativeDataUrl: true,
                    revisionId,
                }));
            const {asset} = scene;
            const revision = asset.revision;
            const meta = revision.metadata;
            editor.sceneConfig.loadFromMetadata(scene);
            editor.assetSource = new SceneAssetSource(editor.sceneID!);

            // Seed the scene asset + derivatives into AssetLoader so that
            // subsequent lookups (e.g. getBehaviorBundleUrl) hit cache.
            this.assetLoader.seedFromAssets([
                {
                    id: asset.id,
                    revisionId: revision.id,
                    format: "json",
                    derivatives: revision.derivatives,
                    dataUrl: revision.dataUrl,
                    dataUrlExpiresAt: revision.expiresAt,
                },
            ]);

            // Kick off behavior bundle fetch as early as possible to overlap with
            // scene deserialization, editor.setScene(), and physics preload.
            const sceneAssetId = editor.sceneAssetId;
            if (this.options.isPlayModeOnly && sceneAssetId && revision.id) {
                this.behaviorLoadingService.prefetchBehaviorBundle(sceneAssetId, revision.id);
            }
            this?.call("clear");
            SceneLoadProfiler.start();

            const payloadPromise = this.fetchScenePayload(scene, meta, editor.sceneID!);

            // Seed AssetLoader cache so it is populated before deserialization starts.
            const seedAssetPromise = this.seedAssetLoader(editor.sceneID!);

            // TODO: we shouldn't even need to do this. Permission checks should
            // be done on the server when accessing the scene.
            // In play mode, collaborative client is never started, so skip the access check.
            const collaboratorPromise =
                scene.isCollaborative && !this.options.isPlayModeOnly
                    ? this.checkCollaborationStatus(projectID, scene.isPublished)
                    : Promise.resolve(true);

            SceneLoadProfiler.begin("fetchScene");
            const [, , sceneData] = await Promise.all([seedAssetPromise, collaboratorPromise, payloadPromise]);
            SceneLoadProfiler.end("fetchScene");

            // Start physics WASM download as early as we know the engine type —
            // before the long `loadScene` (~5 s `converterParse`). When the
            // worker path applies, this spawns the worker so its WASM fetch
            // overlaps with deserialization. `preloadPhysics` is idempotent.
            const preloadScenePhysics = async () => {
                SceneLoadProfiler.begin("physicsPreload");
                const {engine, gravity} = getPhysicsSettingsFromSceneJson(sceneData?.data);
                try {
                    await preloadPhysicsEngine(
                        isPhysicsEngineType(engine) ? engine : PhysicsEngineType.Ammo,
                        Number(gravity ?? GAME_GRAVITY_DEFAULT),
                    );
                } finally {
                    SceneLoadProfiler.end("physicsPreload");
                }
            };

            if (this.options.isPlayModeOnly) {
                await preloadScenePhysics();
            } else {
                void preloadScenePhysics();
            }

            this.loadingManager.nextStage(LoadingMessages.CREATING_OBJECTS);
            SceneLoadProfiler.begin("loadScene");
            const sceneObject = await this.loadSceneFromData({
                server: this.options.server,
                camera: this.camera,
                domWidth: this.renderer.domElement.width,
                domHeight: this.renderer.domElement.height,
                assetLoader: this.assetLoader ?? undefined,
                sceneData,
            });
            SceneLoadProfiler.end("loadScene");

            if (!sceneObject?.scene) {
                showRuntimeToast({
                    type: "error",
                    title: "Failed to load scene object.",
                });
                throw new Error("Failed to load scene object.");
            }

            await this.ensureRenderableMeshNormalsForScene(sceneObject.scene, "normalizeLoadedSceneNormals");
            await this.ensureSceneRenderingSupport(sceneObject.scene);

            if (sceneObject.camera) {
                this.copyCameraState(sceneObject.camera as PerspectiveCamera);
            }

            // Lazy migration: backfill Thumbnail from userData.game.bannerImage for old scenes
            const gameUserData = sceneObject.scene?.userData?.game as Record<string, unknown> | undefined;
            const bannerImage = gameUserData?.bannerImage as string | undefined;
            if (editor.sceneID && editor.sceneName) {
                void migrateSceneThumbnailIfNeeded(editor.sceneID, editor.sceneName, editor.sceneThumbnail, bannerImage);
            }
            // Clean up bannerImage from userData so it doesn't persist on next save
            if (gameUserData && "bannerImage" in gameUserData) {
                delete gameUserData.bannerImage;
            }

            // Clean up stale sceneMetadata from userData — MongoDB is the source of truth
            if (sceneObject.scene?.userData?.sceneMetadata) {
                delete sceneObject.scene.userData.sceneMetadata;
            }

            this.loadingManager.nextStage(LoadingMessages.LOADING_ASSETS);

            // Start GIF texture loading in parallel - scene displays first, GIFs apply when ready
            SceneLoadProfiler.begin("setScene");
            await Promise.all([editor.setScene(sceneObject.scene), this.parseGifTextures(sceneObject.scene)]);
            SceneLoadProfiler.end("setScene");

            if (sceneObject.options) {
                Object.assign(this.options, sceneObject.options);
                this.call("optionsChanged", this);
            }

            if (sceneObject.scripts) {
                Object.assign(this.scripts, sceneObject.scripts);
                this.call("scriptChanged", this);
            }

            if (sceneObject.animations) {
                Object.assign(this.animations, sceneObject.animations);
                this.call("animationChanged", this);
            }

            this.loadingManager.nextStage(LoadingMessages.FINALIZING);
            this.call("sceneGraphChanged", this);
            this.call("sceneLoaded", this);
            this.loadingManager.completeLoading();

            if (editor.isSandbox && !this.isPlaying) {
                void this.setMode(ApplicationMode.SANDBOX);
            }

            this.setUpFog();
            this.editor?.controls?.loadCamera();
            applyCameraProjectionSettings(this.camera, CameraControl.getCameraOptions(this.camera));
            SceneLoadProfiler.summary();
        } catch (error: unknown) {
            console.error("Error setting up scene:", error);
            throw error instanceof Error ? error : new Error(String(error));
        } finally {
            if (!this.options.isPlayModeOnly) {
                this.unmask();
                // Restart the editor render loop we paused at the top of
                // `setUpScene`. In play mode, `startPlayer` is responsible
                // for starting the loop, so we leave it alone here.
                this.startScheduledAnimationLoop();
            }
        }
    }

    /**
     * Set up the stem editor for the given stem asset ID.
     *
     * Loads the stem's head revision into a minimal temporary scene (not
     * backed by a database document). The stem's dependency context is
     * promoted to the scene root so that asset resolution works without a
     * scene ID.
     *
     * @param stemAssetId - The asset ID of the stem to edit
     * @param options - Optional configuration
     * @param options.assetToken - Signed asset token for non-owner access
     */
    async setUpStemEditor(stemAssetId: string, options?: {assetToken?: string}): Promise<void> {
        if (this._rendererInitPromise) {
            await this._rendererInitPromise;
        }

        const editor = this.editor;
        if (!editor) {
            throw new Error("[StemEditor] Editor is not initialized.");
        }

        // Set the root asset scope and token BEFORE any API calls so that
        // getAssetsApiClient() includes the headers on the initial requests.
        this.rootAssetId = stemAssetId;
        this.assetToken = options?.assetToken ?? null;

        try {
            this.mask();
            this.loadingManager.startLoading();
            this.loadingManager.nextStage(LoadingMessages.LOADING_SCENE);

            // Fetch stem asset metadata to get head revision ID
            const stemAsset = await getAsset(stemAssetId);
            const headRevisionId = stemAsset.headRevisionId;
            if (!headRevisionId) {
                throw new Error(`[StemEditor] Stem ${stemAssetId} has no head revision.`);
            }

            // Set the scene name and owner from the stem asset so UI elements
            // (title, save guard in TopMenu) work correctly.
            editor.sceneName = stemAsset.name || "Stem Editor";
            editor.projectUserId = stemAsset.userId;

            // Fetch the head revision with dependencies, metadata, and data URL
            const stemRevision = await getAssetRevision(stemAssetId, headRevisionId, {
                includeDependencies: true,
                includeMetadata: true,
                includeDataUrl: true,
            });

            if (!stemRevision.dataUrl) {
                throw new Error(`[StemEditor] No data URL for stem ${stemAssetId}:${headRevisionId}`);
            }

            this.call("clear");

            // Build the asset resolution context from the stem's dependencies
            const dependencies = stemRevision.dependencies || {};
            const logicalIdToAssetId = (stemRevision.metadata?.logicalAssetIdMap || {}) as Record<string, string>;

            // Fetch the stem payload
            this.loadingManager.nextStage(LoadingMessages.CREATING_OBJECTS);
            const stemPayload = await fetch(stemRevision.dataUrl).then(r => r.text());

            // Create a minimal scene using the empty scene template
            editor.createEmptyScene();

            // Promote the stem's dependency context to the scene root,
            // including the stem's own ID so that unlockPrefab can resolve it.
            setAssetResolutionContext(this.scene, {
                assetIdToRevisionId: {
                    ...dependencies,
                    [stemAssetId]: headRevisionId,
                },
                logicalIdToAssetId,
            });

            // Deserialize the stem into the scene
            const {deserializePrefab} = await import("@stem/editor-oss/prefab/serialization");
            const stemInstance = await deserializePrefab(stemPayload, {
                assetIdToRevisionId: dependencies,
                logicalIdToAssetId,
            });

            // Add the stem instance to the scene before unlocking, so that
            // unlockPrefab can inherit the scene root's AssetResolutionContext
            // (which contains the stem's own ID → revision mapping).
            setPrefabId(stemInstance, stemAssetId);
            this.scene.add(stemInstance);
            unlockPrefab(stemInstance);

            // Store stem editor metadata on the scene as a marker that this
            // scene is in stem-editor mode. The stem's current revision lives
            // on the scene's AssetResolutionContext (set above).
            this.scene.userData.stemEditor = {
                assetId: stemAssetId,
            };

            // Set the asset source for the stem editor. This is used by
            // addBackendBehaviorsToScene, loadBackendLambdaConfigs, and
            // React UI components (via AssetSourceContext) for asset discovery.
            // It reads dependencies from the scene root's local context.
            this.loadingManager.nextStage(LoadingMessages.LOADING_ASSETS);
            const {StemAssetSource} = await import("./editor/asset-management/AssetSource");
            editor.assetSource = new StemAssetSource(stemAssetId);

            await this.ensureRenderableMeshNormalsForScene(this.scene, "normalizeStemEditorSceneNormals");
            await this.ensureSceneRenderingSupport(this.scene);
            await editor.setScene(this.scene);

            this.loadingManager.nextStage(LoadingMessages.FINALIZING);
            this.call("sceneGraphChanged", this);
            this.call("sceneLoaded", this);
            this.loadingManager.completeLoading();

            this.setUpFog();
            editor.controls?.loadCamera();
            applyCameraProjectionSettings(this.camera, CameraControl.getCameraOptions(this.camera));
        } catch (error: unknown) {
            console.error("[StemEditor] Error setting up stem editor:", error);
            throw error instanceof Error ? error : new Error(String(error));
        } finally {
            this.unmask();
        }
    }

    /**
     * Finalize setup for a scene that is already loaded in memory (e.g.,
     * created locally via a template). Sets the asset source, runs
     * setScene, and emits sceneLoaded.
     */
    async setUpLocalScene(): Promise<void> {
        const editor = this.editor;
        if (!editor) {
            throw new Error("[setUpLocalScene] Editor is not initialized.");
        }

        await this.ensureRendererReady();

        if (!editor.sceneID) {
            throw new Error("[setUpLocalScene] Scene ID is not set.");
        }

        editor.assetSource = new SceneAssetSource(editor.sceneID);
        await this.ensureRenderableMeshNormalsForScene(this.scene, "normalizeLocalSceneNormals");
        await this.ensureSceneRenderingSupport(this.scene);
        await editor.setScene(this.scene, undefined, true);
        this.call("sceneLoaded", this);
    }

    private setUpFog() {
        if (!this.editor) return console.error("Can't setup fog. No editor object available");

        const fogSettings = this.editor.rendering.fog;
        if (!fogSettings || fogSettings.type === "none") {
            this.scene.fog = null;
            return;
        }
        const fogVisibility = this.scene.userData?.fogEditorVisibility ?? true;
        if (!fogVisibility) {
            this.scene.fog = null;
            return;
        }

        const {type, color, near, far, density} = fogSettings;
        if (type === "linear" && near !== undefined && far !== undefined) {
            this.scene.fog = new Fog(color, near, far);
        } else if (type === "exp" && density !== undefined) {
            this.scene.fog = new FogExp2(color, density);
        }
    }

    private async exitMode(mode: ApplicationMode, editorSavePolicy: EditorStopSavePolicy) {
        console.info(`[APP][TRACE] exitMode start: ${mode}`);
        switch (mode) {
            case ApplicationMode.EDIT:
                await this.stopEditMode(editorSavePolicy);
                break;
            case ApplicationMode.PLAY:
                await this.stopPlayMode();
                break;
            case ApplicationMode.SANDBOX:
                await this.stopSandboxMode();
                break;
            case ApplicationMode.IDLE:
                break;
            default:
                console.warn(`Cannot exit unknown application mode: ${mode as any}`);
                return;
        }
        console.info(`[APP][TRACE] emitting appModeExited: ${mode}`);
        this.call("appModeExited", this, mode);
    }

    private async enterMode(mode: ApplicationMode) {
        console.info(`[APP][TRACE] enterMode start: ${mode}`);
        switch (mode) {
            case ApplicationMode.EDIT:
                await this.startEditMode();
                break;
            case ApplicationMode.PLAY:
                await this.startPlayMode();
                break;
            case ApplicationMode.SANDBOX:
                await this.startSandboxMode();
                break;
            case ApplicationMode.IDLE:
                // No specific action for idle mode
                break;
            default:
                console.warn(`Cannot enter unknown application mode: ${mode as any}`);
                return;
        }

        console.info(`[APP][TRACE] emitting appModeEntered: ${mode}`);
        this.call("appModeEntered", this, mode);
    }

    private async createWebGPURenderer(overrideForceWebGL?: boolean): Promise<WebGPURenderer> {
        const {WebGPURenderer} = await loadThreeWebGPU();
        let forceWebGL = overrideForceWebGL ?? this.getRendererSettings().forceWebGL;

        // Three's WebGPURenderer can fall back to WebGL, but letting it probe
        // an unavailable adapter first adds a multi-second startup stall and
        // repeats the probe whenever the renderer is recreated. Playground
        // sessions on WebGL-only devices should select the WebGL backend up
        // front while retaining the same renderer/material API.
        if (!forceWebGL && typeof navigator !== "undefined") {
            const gpu = (navigator as Navigator & {gpu?: GPU}).gpu;
            if (!gpu?.requestAdapter) {
                forceWebGL = true;
            } else {
                try {
                    forceWebGL = !(await gpu.requestAdapter());
                } catch {
                    forceWebGL = true;
                }
            }
        }
        const useTransparentCanvas = !!(
            this.editor?.scene?.userData?.cesium?.enabled || this.scene?.userData?.cesium?.enabled
        );

        // Determine AA from device profile (GPU tier + pixel ratio)
        const detector = new DeviceCapabilityDetector();
        const antialias = detector.shouldEnableAntialias();

        // NOTE: !!! We intentionally don't await init here; initialization
        // is performed lazily in start() where the renderer is used !!!
        const renderer = new WebGPURenderer({
            antialias,
            // preserveDrawingBuffer: false,
            powerPreference: "high-performance",
            forceWebGL,
            alpha: useTransparentCanvas,
        });
        (renderer as any).name = "MainWebGPURenderer";

        renderer.setPixelRatio(DetectDevice.isMobile() ? 1 : window.devicePixelRatio);
        const canvas = renderer.domElement;
        canvas.style.backgroundColor = useTransparentCanvas ? "transparent" : "";

        canvas.style.position = "absolute";
        canvas.style.top = "0";
        canvas.style.left = "0";

        renderer.setClearColor(0x000000, useTransparentCanvas ? 0 : 1);
        renderer.shadowMap.enabled = true;
        (renderer.shadowMap as any).autoUpdate = true;
        (renderer.shadowMap as any).needsUpdate = true;

        renderer.autoClear = false;

        const backend = renderer.backend as any;

        // HACK: Override _completeCompile to log shader program errors only once per unique pipeline code
        // It improves performance while loading scenes with many objects using the same material/shaders
        if (backend.isWebGLBackend) {
            const _linkedPipelines = new Set<string>();
            // eslint-disable-next-line @typescript-eslint/no-this-alias -- inner function needs its own dynamic `this` (the backend); we capture EngineRuntime to read `app.debug`.
            const app = this;

            backend._completeCompile = function _completeCompile(renderObject: any, pipeline: any) {
                const pipelineCode = pipeline.fragmentProgram.code + pipeline.vertexProgram.code;

                const {state, gl} = this;
                const pipelineData = this.get(pipeline);
                const {programGPU, fragmentShader, vertexShader} = pipelineData;

                if (
                    app.debug &&
                    !_linkedPipelines.has(pipelineCode) &&
                    gl.getProgramParameter(programGPU, gl.LINK_STATUS) === false
                ) {
                    this._logProgramError(programGPU, fragmentShader, vertexShader);
                } else {
                    _linkedPipelines.add(pipelineCode);
                }

                state.useProgram(programGPU);

                // Bindings

                const bindings = renderObject.getBindings();

                this._setupBindings(bindings, programGPU);

                this.set(pipeline, {
                    programGPU,
                    // `Pipelines.isReady()` checks this field before allowing
                    // the backend to draw. Keep it in sync with Three's
                    // WebGLBackend implementation; omitting it leaves every
                    // product render pipeline permanently pending.
                    pipeline: programGPU,
                });
            };

            renderer.domElement.addEventListener("webglcontextlost", this.handleContextLost);
        }

        return renderer;
    }

    getRendererSettings(): {forceWebGL: boolean; forceWebGLForVFX: boolean} {
        const rendering = this.editor?.scene?.userData?.rendering;
        return {
            forceWebGL: rendering?.forceWebGL || false,
            forceWebGLForVFX: rendering?.forceWebGLForVFX ?? true,
        };
    }

    checkAndRecreateRenderer(): void {
        const currentSetting = this.getRendererSettings().forceWebGL;
        if (this._lastForceWebGLSetting !== undefined && this._lastForceWebGLSetting !== currentSetting) {
            void this.recreateRenderer();
        }
        this._lastForceWebGLSetting = currentSetting;
    }

    // MODES

    private async startEditMode(): Promise<void> {
        if (this.options.isPlayModeOnly) {
            console.error("[APP] Player mode only. Cannot initialize edit mode.");
            return;
        }

        if (!this.editor) {
            console.error("[APP] Editor is not initialized, cannot start edit mode.");
            return;
        }

        const localPlaygroundScene = !!(
            this.editor.sceneID?.startsWith("oss-") ||
            this.scene?.userData?.sceneId?.startsWith?.("oss-")
        );
        const deferEditorBehaviorActivation =
            isPlaygroundMode() && localPlaygroundScene && !this.restoreEditorPreviewOnModeEntry;
        this.restoreEditorPreviewOnModeEntry = false;
        const editorPreviewReady = this.editor.start({
            deferBehaviorActivation: deferEditorBehaviorActivation,
        });

        this.editor.selectionHelpers.forEach(helper => {
            this.sceneHelpers.add(helper);
        });
        this.editor.gpuPickNum = this.storage.hoverEnabled ? 1 : 0;

        await this.enableEditorCameraControls("edit");
        this.editor.component?.showUI();
        this.call("resize", this);
        await this.environmentManager?.applyEnvironmentSettings();
        this.editor?.controls?.loadCamera();
        await editorPreviewReady;
    }

    private async stopEditMode(savePolicy: EditorStopSavePolicy): Promise<void> {
        if (!this.editor) {
            console.error("[APP] Editor is not initialized, cannot stop edit mode.");
            return;
        }

        await this.editor.stop({
            preserveBehaviorPreviewRoots: this._mode === ApplicationMode.PLAY,
            savePolicy,
        });
        this.clearModes();
    }

    private async startPlayMode(): Promise<void> {
        // this.setShowGrid(false);

        const resumePlayTransitionRender = this.pauseRenderForModeTransition();
        const isSandbox = !!this.editor?.isSandbox;
        try {
            if (!isSandbox && !this.options.isPlayModeOnly) {
                await this.multiplayerClient?.terminate();
                this.multiplayerClient = null;
            }
            SceneLoadProfiler.begin("playerSessionLoad");
            const {PlayerSession: PlayerSessionClass} = await loadPlayerSessionModule();
            SceneLoadProfiler.end("playerSessionLoad");

            SceneLoadProfiler.begin("playerSessionConstruct");
            this.playerSession = new PlayerSessionClass(this);
            SceneLoadProfiler.end("playerSessionConstruct");

            // Launch-time quality setup: device profile + optional scene preset.
            // This runs once during player init (no adaptive runtime quality).
            await this.qualitySystem?.initialize(this);
            const launchSettings = await this.qualitySystem?.preparePlayerLaunchQuality(
                this.editor?.scene?.userData,
            );
            if (launchSettings) {
                this.configureSimulationQuality(launchSettings);
            }

            this.editor?.restoreScriptImportPreviewReveal();
            await this.startPlayer({resumeRenderBeforeFirstFrame: resumePlayTransitionRender});

            // Re-wire quality modules to the fresh runtime instances created
            // by startPlayer (fixes stale refs on play → stop → play cycles).
            this.qualitySystem?.rewireModules(this);

            // Runtime objects now exist, push selected launch settings to live systems.
            this.qualitySystem?.syncRuntimeSettings();

            // Play-only mode delays the render loop until the scene is visible.
            if (this.options.isPlayModeOnly) {
                this.startScheduledAnimationLoop();
            }

            this.call("resize", this);
            this.editor?.component?.hideUI();
            this.unmask();
            resumePlayTransitionRender();
        } catch (error) {
            resumePlayTransitionRender();
            await this.stopPlayer({clearStartupMask: true});
            console.error("There was an error starting the player", error);
            throw error;
        }
    }

    private pauseRenderForModeTransition(): () => void {
        if (this.options.isPlayModeOnly) {
            return () => {};
        }

        let resumed = false;
        try {
            this.call("pauseRender", this);
        } catch {
            return () => {};
        }

        return () => {
            if (resumed) return;
            resumed = true;
            try {
                this.call("resumeRender", this);
            } catch {
                /* render resume is best-effort during mode transitions */
            }
        };
    }

    private async stopPlayMode() {
        await this.stopPlayer({
            preserveRenderedFrame: this.mode === ApplicationMode.EDIT,
        });
        this.clearModes();
    }

    async restartPlayMode(options?: {beforeStart?: () => void | Promise<void>}) {
        if (this.mode !== ApplicationMode.PLAY && !this.isPlaying && !this.isPaused) {
            await options?.beforeStart?.();
            await this.setMode(ApplicationMode.PLAY);
            return;
        }

        await this.stopPlayMode();
        await options?.beforeStart?.();
        await this.startPlayMode();
    }

    private async startSandboxMode() {
        await this.editor?.start();
        await this.startPlayMode(); // TODO: should be different from play mode
    }

    private async stopSandboxMode() {
        await this.editor?.stop({savePolicy: "flush"});
        await this.stopPlayer();
        this.clearModes();
    }

    private initCamera(): void {
        this.camera.name = "DefaultCamera";
        this.camera.userData.cameraData = this.editor?.getDefaultCameraData();
        // Cameras should never cast or receive shadows
        this.camera.castShadow = false;
        this.camera.receiveShadow = false;
        this.orthCamera.castShadow = false;
        this.orthCamera.receiveShadow = false;
    }

    private removeAnimationListener(): void {
        if (!this.animationListenerRegistered) return;
        this.on("animate.Application", null);
        this.animationListenerRegistered = false;
    }

    private getLaunchPhysicsMaxSteps(launchSettings: {
        physics?: {maxStepsPerFrame?: number};
        scheduler?: {maxFixedStepsPerFrame?: number};
    }): number {
        return launchSettings.physics?.maxStepsPerFrame ??
            launchSettings.scheduler?.maxFixedStepsPerFrame ??
            3;
    }

    private sceneUsesBehaviorIdProgressive(scene: Scene | Object3D, behaviorId: string): Promise<boolean> {
        return this.objectTreeHasProgressive(scene, object => {
            const behaviors = object.userData?.behaviors;
            return Array.isArray(behaviors) && behaviors.some(behavior => behavior?.id === behaviorId);
        });
    }

    private getCurrentScenePhysicsPreloadConfig(): {
        engine: PhysicsEngineType;
        gravity: number;
        signature: string;
    } | null {
        const scene = this.editor?.scene ?? this.scene;
        if (!scene) {
            return null;
        }

        const configuredEngine = scene.userData?.physics?.engine;
        const engine = isPhysicsEngineType(configuredEngine)
            ? configuredEngine
            : PhysicsEngineType.Ammo;
        const gravity = Number(scene.userData?.physics?.gravity ?? scene.userData?.game?.gravity ?? GAME_GRAVITY_DEFAULT);

        return {
            engine,
            gravity,
            signature: `${scene.uuid}:${engine}:${gravity}`,
        };
    }

    private scheduleCurrentScenePhysicsPreload(reason: string): void {
        if (this.isPlaying || this.isPaused || this.options.isPlayModeOnly) {
            return;
        }

        const config = this.getCurrentScenePhysicsPreloadConfig();
        if (!config || config.signature === this.scenePhysicsPreloadSignature) {
            return;
        }

        this.scenePhysicsPreloadSignature = config.signature;
        if (this.scenePhysicsPreloadTimer) {
            clearTimeout(this.scenePhysicsPreloadTimer);
        }

        this.scenePhysicsPreloadTimer = setTimeout(() => {
            this.scenePhysicsPreloadTimer = null;
            console.debug(`[EngineRuntime] Preloading physics for editor scene after ${reason}`);
            void preloadPhysicsEngine(config.engine, config.gravity);
        }, EDITOR_PHYSICS_PRELOAD_DELAY_MS);
    }

    private schedulePlayerSessionPreload(reason: string): void {
        if (this.isPlaying || this.isPaused || this.options.isPlayModeOnly) {
            return;
        }
        if (playerRuntimeModulesPromise) {
            return;
        }

        if (this.playerSessionPreloadTimer) {
            clearTimeout(this.playerSessionPreloadTimer);
        }

        this.playerSessionPreloadTimer = setTimeout(() => {
            this.playerSessionPreloadTimer = null;
            if (this.isPlaying || this.isPaused || this.options.isPlayModeOnly) {
                return;
            }
            if (playerRuntimeModulesPromise) {
                return;
            }
            console.debug(`[EngineRuntime] Preloading player runtime modules after ${reason}`);
            void preloadPlayerRuntimeModules().catch(error => {
                console.warn("[EngineRuntime] Player runtime preload failed", error);
            });
        }, EDITOR_PLAYER_RUNTIME_PRELOAD_DELAY_MS);
    }

    private createRuntimeRevealCompileProxy(object: Object3D): Object3D | null {
        const renderable = object as Object3D & {
            castShadow?: boolean;
            count?: number;
            frustumCulled?: boolean;
            geometry?: any;
            instanceColor?: any;
            isInstancedMesh?: boolean;
            isLine?: boolean;
            isMesh?: boolean;
            isPoints?: boolean;
            isSprite?: boolean;
            instanceMatrix?: any;
            morphTexture?: any;
            material?: any;
            receiveShadow?: boolean;
        };
        if (!renderable.material) {
            return null;
        }

        let proxy: Object3D | null = null;
        try {
            if (renderable.isInstancedMesh === true && renderable.geometry) {
                const compileCount =
                    typeof renderable.count === "number" && Number.isFinite(renderable.count) && renderable.count > 0
                        ? Math.max(1, Math.floor(renderable.count))
                        : 1;
                const instancedProxy = new InstancedMesh(renderable.geometry, renderable.material, compileCount);
                if (renderable.instanceMatrix) {
                    instancedProxy.instanceMatrix = renderable.instanceMatrix;
                }
                instancedProxy.instanceColor = renderable.instanceColor ?? null;
                instancedProxy.morphTexture = renderable.morphTexture ?? null;
                instancedProxy.count = compileCount;
                proxy = instancedProxy;
            } else if (renderable.isMesh === true && renderable.geometry) {
                proxy = new Mesh(renderable.geometry, renderable.material);
            } else if (renderable.isPoints === true && renderable.geometry) {
                proxy = new Points(renderable.geometry, renderable.material);
            } else if (renderable.isLine === true && renderable.geometry) {
                proxy = new Line(renderable.geometry, renderable.material);
            } else if (renderable.isSprite === true) {
                proxy = new Sprite(renderable.material);
            } else {
                proxy = object.clone(false);
            }
        } catch {
            return null;
        }

        proxy.name = `${object.name || object.uuid}:runtime-reveal-compile-proxy`;
        proxy.visible = true;
        proxy.layers.mask = object.layers.mask;
        proxy.matrixAutoUpdate = false;
        proxy.matrix.copy(object.matrixWorld);
        proxy.matrixWorld.copy(object.matrixWorld);
        proxy.updateMatrixWorld(true);
        proxy.userData = {};

        const proxyRenderable = proxy as Object3D & {
            castShadow?: boolean;
            frustumCulled?: boolean;
            receiveShadow?: boolean;
        };
        proxyRenderable.castShadow = renderable.castShadow === true;
        proxyRenderable.receiveShadow = renderable.receiveShadow === true;
        if ("frustumCulled" in proxyRenderable) {
            proxyRenderable.frustumCulled = false;
        }

        return proxy;
    }

    private getRuntimeRevealPrecompileKey(object: Object3D): {material: object; key: string} | null {
        const renderable = object as Object3D & {
            geometry?: {
                attributes?: Record<string, {itemSize?: number; normalized?: boolean}>;
                index?: unknown;
                morphAttributes?: Record<string, unknown[]>;
            };
            isInstancedMesh?: boolean;
            material?: unknown;
            morphTargetInfluences?: unknown;
            skeleton?: unknown;
        };
        if (Array.isArray(renderable.material)) {
            return null;
        }
        const material = renderable.material;
        if (!material || typeof material !== "object") {
            return null;
        }

        const geometry = renderable.geometry;
        const attributes = geometry?.attributes
            ? Object.entries(geometry.attributes)
                .map(([name, attribute]) => `${name}:${attribute?.itemSize ?? "?"}:${attribute?.normalized === true ? 1 : 0}`)
                .sort()
                .join(",")
            : "none";
        const morphAttributes = geometry?.morphAttributes
            ? Object.entries(geometry.morphAttributes)
                .map(([name, values]) => `${name}:${Array.isArray(values) ? values.length : 0}`)
                .sort()
                .join(",")
            : "none";
        const key = [
            object.type,
            renderable.isInstancedMesh === true ? "instanced" : "single",
            geometry?.index ? "indexed" : "nonindexed",
            renderable.morphTargetInfluences ? "morph" : "nomorph",
            renderable.skeleton ? "skinned" : "noskin",
            attributes,
            morphAttributes,
        ].join("|");

        return {material, key};
    }

    private hasRuntimeRevealPrecompileKey(precompileKey: {material: object; key: string}): boolean {
        const existingKeys = this.runtimeRevealPrecompileKeys.get(precompileKey.material);
        return existingKeys?.has(precompileKey.key) === true;
    }

    private rememberRuntimeRevealPrecompileKey(precompileKey: {material: object; key: string}): void {
        const existingKeys = this.runtimeRevealPrecompileKeys.get(precompileKey.material);
        if (existingKeys) {
            existingKeys.add(precompileKey.key);
            return;
        }
        const nextKeys = new Set<string>([precompileKey.key]);
        this.runtimeRevealPrecompileKeys.set(precompileKey.material, nextKeys);
    }

    private shouldPrecompileRuntimeRevealObject(object: Object3D): boolean {
        const renderable = object as Object3D & {
            isInstancedMesh?: boolean;
            material?: unknown;
        };
        const material = renderable.material;
        if (!material) {
            return false;
        }
        if (renderable.isInstancedMesh === true || Array.isArray(material)) {
            return true;
        }
        if (typeof material !== "object") {
            return false;
        }

        const record = material as Record<string, unknown>;
        if (record.isNodeMaterial === true) {
            return true;
        }
        if (RUNTIME_REVEAL_CUSTOM_TSL_MATERIAL_KEYS.some(key => record[key] != null)) {
            return true;
        }

        return record.type !== "MeshBasicMaterial";
    }

    private async precompileRuntimeRevealBatch(objects: Object3D[]): Promise<void> {
        const renderer = this.renderer as (WebGPURenderer & {
            compileAsync?: (object: Object3D, camera: PerspectiveCamera | OrthographicCamera, targetScene?: Scene) => Promise<void>;
        }) | null;
        if (
            !renderer ||
            typeof renderer.compileAsync !== "function" ||
            !this.camera ||
            !this.scene
        ) {
            return;
        }

        for (const object of objects) {
            if (!this.shouldPrecompileRuntimeRevealObject(object)) {
                continue;
            }
            const precompileKey = this.getRuntimeRevealPrecompileKey(object);
            if (precompileKey && this.hasRuntimeRevealPrecompileKey(precompileKey)) {
                continue;
            }
            const proxy = this.createRuntimeRevealCompileProxy(object);
            if (!proxy) {
                continue;
            }
            await renderer.compileAsync(proxy, this.camera, this.scene);
            if (precompileKey) {
                this.rememberRuntimeRevealPrecompileKey(precompileKey);
            }
        }
    }

    /**
     * Warm the renderer while the startup mask still owns the surface. The
     * first Play render can otherwise pay for every visible NodeMaterial and
     * shadow/post-processing pipeline at once, producing a multi-second GPU
     * frame even though authored JavaScript has already yielded.
     */
    private async warmRendererForFirstFrame(): Promise<boolean> {
        const renderer = this.renderer as (WebGPURenderer & {
            compileAsync?: (
                scene: Scene,
                camera: PerspectiveCamera | OrthographicCamera,
            ) => Promise<void>;
            backend?: WebGPUBackend & {
                isWebGLBackend?: boolean;
                device?: {
                    queue?: {
                        onSubmittedWorkDone?: () => Promise<void>;
                    };
                };
            };
        }) | null;
        const warmupPath = {
            hasRenderer: !!renderer,
            hasCompileAsync: typeof renderer?.compileAsync === "function",
            hasEffectRenderer: !!this.effectRenderer,
        };
        if (
            !renderer ||
            !this.camera ||
            !this.scene
        ) {
            recordPlayStartTiming({
                phase: "rendererWarmupPath",
                ms: 0,
                success: false,
                message: JSON.stringify(warmupPath),
            });
            return false;
        }

        let warmed = false;
        if (typeof renderer.compileAsync === "function") {
            await timePlayStartPhase("rendererWarmup:compileAsync", async () => {
                try {
                    await renderer.compileAsync!(this.scene!, this.camera!);
                    warmed = true;
                } catch (error) {
                    // WebGLBackend may reject compileAsync while its normal
                    // render path remains valid. Continue to the masked
                    // render below.
                    console.debug("[EngineRuntime] Renderer compile warmup skipped", error);
                }
            });
        }

        let renderSubmitted = false;
        await timePlayStartPhase("rendererWarmup:render", async () => {
            try {
                if (this.effectRenderer && typeof this.effectRenderer.render === "function") {
                    this.effectRenderer.render();
                    renderSubmitted = true;
                } else {
                    renderer.render(this.scene!, this.camera!);
                    renderSubmitted = true;
                }
            } catch (error) {
                console.debug("[EngineRuntime] Renderer warmup render skipped", error);
            }
        });

        // WebGPU render() submits command buffers synchronously, but shader and
        // pipeline work can continue on the device after the call returns. If
        // the first live frame starts before that work settles, the browser can
        // block the animation loop for several seconds. Keep that wait behind
        // the startup mask and only use the API when the active backend exposes
        // it; WebGL fallbacks use the context fence below instead.
        let queueSettled = false;
        let webglSettled = false;
        const onSubmittedWorkDone = renderer.backend?.device?.queue?.onSubmittedWorkDone;
        await timePlayStartPhase("rendererWarmup:fence", async () => {
            if (renderSubmitted && typeof onSubmittedWorkDone === "function") {
                try {
                    await onSubmittedWorkDone.call(renderer.backend.device?.queue);
                    queueSettled = true;
                } catch (error) {
                    console.debug("[EngineRuntime] Renderer queue warmup wait skipped", error);
                }
            } else if (renderSubmitted && renderer.backend?.isWebGLBackend === true) {
                // The Playground frequently uses Three's WebGL fallback in
                // environments without WebGPU. WebGL has no queue promise, but a
                // finish() fence gives the same masked-start guarantee and keeps
                // the first animation frame from inheriting driver work.
                try {
                    const context = (typeof renderer.getContext === "function" ? renderer.getContext() : null) as {
                        finish?: () => void;
                    } | null;
                    if (typeof context?.finish === "function") {
                        context.finish();
                        webglSettled = true;
                    }
                } catch (error) {
                    console.debug("[EngineRuntime] WebGL warmup fence skipped", error);
                }
            }
        });
        const hasCompletionFence = typeof onSubmittedWorkDone === "function" || renderer.backend?.isWebGLBackend === true;
        warmed = renderSubmitted && (queueSettled || webglSettled || !hasCompletionFence);

        this.runtimeStartupWarmupRendered = warmed;
        recordPlayStartTiming({
            phase: "rendererWarmupPath",
            ms: 0,
            success: warmed,
            message: JSON.stringify({...warmupPath, renderSubmitted, queueSettled, webglSettled, warmed}),
        });
        return warmed;
    }

    private async startPlayer(options?: {resumeRenderBeforeFirstFrame?: () => void}): Promise<void> {
        resetPlayStartTimings();
        // Runtime performance diagnostics are scoped to the active Play
        // session. Editor compositing and masked startup/warmup frames should
        // not skew the interactive frame-time percentiles or pressure policy.
        runtimeFrameTelemetry.reset();
        this.runtimeRevealPrecompileKeys = new WeakMap<object, Set<string>>();
        this.runtimeStartupActive = true;
        const playStartTotalStart = performance.now();
        this.runtimeStartupWarmupRendered = false;
        let firstRenderHandshakePromise: Promise<void> | undefined;
        let renderResumedBeforeFirstFrame = false;
        const resumeRenderBeforeFirstFrame = () => {
            if (renderResumedBeforeFirstFrame) {
                return;
            }
            renderResumedBeforeFirstFrame = true;
            options?.resumeRenderBeforeFirstFrame?.();
        };
        const configuredPhysicsEngine = this.scene.userData?.physics?.engine;
        const physicsEngine = isPhysicsEngineType(configuredPhysicsEngine)
            ? configuredPhysicsEngine
            : PhysicsEngineType.Ammo;
        const gravity =
            this.scene.userData?.physics?.gravity ?? this.scene.userData?.game?.gravity ?? GAME_GRAVITY_DEFAULT;
        void preloadPhysicsEngine(
            physicsEngine,
            Number(gravity),
            this.qualitySystem?.getQualityManager().getCurrentSettings().physics.solverIterations,
        );

        // Playground uses an in-memory revert for every Play session. This keeps
        // the high-frequency Play → Edit loop local and bounded instead of
        // reloading the entire ProjectStore scene (and every model/material)
        // during stop. The inspector also needs the snapshot for its diff view;
        // deployed remote/API sessions retain the serialized restore path until
        // their lifecycle contract is explicitly upgraded.
        const localPlaygroundScene = !!(
            this.editor?.sceneID?.startsWith("oss-") ||
            this.scene?.userData?.sceneId?.startsWith?.("oss-")
        );
        const shouldCapturePlaymodeSnapshot = !!(
            this.editor &&
            ((isPlaygroundMode() && localPlaygroundScene) ||
                this.editor.isSandbox === true ||
                this.scene.userData?.playmodeInspectorEnabled ||
                this.editor.scene?.userData?.playmodeInspectorEnabled)
        );
        if (shouldCapturePlaymodeSnapshot) {
            await timePlayStartPhase("playmodeSnapshotCapture", async () => {
                try {
                    SceneLoadProfiler.begin("playmodeSnapshotCapture");
                    this.playmodeSnapshot = await capturePlaymodeSnapshotAsync(this.scene);
                } catch (err) {
                    console.warn("[Playmode Inspector] Failed to capture snapshot", err);
                    this.playmodeSnapshot = null;
                } finally {
                    SceneLoadProfiler.end("playmodeSnapshotCapture");
                }
            });
        } else {
            this.playmodeSnapshot = null;
            recordPlayStartTiming({phase: "playmodeSnapshotSkipped", ms: 0, success: true});
        }

        timePlayStartSync("loadingManagerStart", () => {
            this.loadingManager.startLoading([
                {name: "playerInit", message: LoadingMessages.STARTING_PLAYER, weight: 0.15},
                {name: "physics", message: LoadingMessages.INITIALIZING_PHYSICS, weight: 0.25},
                {name: "loadBehaviors", message: LoadingMessages.LOADING_BEHAVIORS, weight: 0.15},
                {name: "loadLambdas", message: LoadingMessages.LOADING_LAMBDAS, weight: 0.15},
                {name: "systems", message: LoadingMessages.LOADING_ASSETS, weight: 0.1},
                {name: "initBehaviors", message: LoadingMessages.INITIALIZING_BEHAVIORS, weight: 0.1},
                {name: "initLambdas", message: LoadingMessages.INITIALIZING_LAMBDAS, weight: 0.05},
                {name: "finalize", message: LoadingMessages.FINALIZING, weight: 0.05},
            ]);
            this.call("playerInit", null);
            // Keep the first runtime frame readable while authored startup
            // work yields. The mask still blocks input and readiness remains
            // owned by the first-render handshake, but the scene is not hidden
            // behind an opaque black spinner during long creator scripts.
            this.playerMask.show({revealScene: true, message: "Preparing your world"});
        });
        await timePlayStartPhase("loadingMaskFirstPaint", () => this.yieldToNextPaint());
        const isMultiplayer = !!this.editor?.isMultiplayer;
        const maxMultiplayerClientsPerRoom = this.editor?.maxMultiplayerClientsPerRoom || 4;
        const useInstancing = !!this.editor?.useInstancing;
        const isSandbox = !!this.editor?.isSandbox;

        //FIXME: remove physics reference from Scene loader and create Terrain physics in addObjects()

        if (!this.game) {
            throw new Error("GameManager is not initialized, cannot start player.");
        }

        if (!this.physics) {
            console.error("Physics is not initialized, cannot start player.");
            throw new Error("Physics is not initialized, cannot start player.");
        }
        const game = this.game;
        const physicsManager = this.physics;

        // Backstop preload: covers paths that didn't go through setUpScene
        // (e.g. play mode entered without a fresh scene load). When worker mode
        // applies and a preload already happened, this is a no-op (the worker
        // is stashed and will be adopted by `PhysicsProxy.start()`).
        await timePlayStartPhase("showSceneObjects", () =>
            this.traverseSceneObjectsProgressively(obj => {
                this.updateObjectVisibility(obj, true);
            }),
        );

        const savedFog = this.scene.userData.savedFog;

        timePlayStartSync("restoreFog", () => {
            if (!this.scene.fog && !!savedFog) {
                if (savedFog.type === "linear") {
                    this.scene.fog = new Fog(savedFog.color, savedFog.near, savedFog.far);
                } else if (savedFog.type === "exp") {
                    this.scene.fog = new FogExp2(savedFog.color, savedFog.density);
                }
            }
        });

        // Ensure behavior config loading is in flight (may already be started by setUpScene).
        const sceneConfig = this.editor?.sceneConfig;
        const assetSource = this.editor?.assetSource;
        if (assetSource) {
            this.behaviorLoadingService
                .loadSceneConfigs(this.scene, {
                    assetSource,
                    assetId: sceneConfig?.sceneAssetId ?? undefined,
                })
                .catch(err => console.error("Failed to load scene behavior configs", err));
        }

        this.loadingManager.nextStage(LoadingMessages.INITIALIZING_PHYSICS);
        let physics: IPhysics;
        try {
            physics = await timePlayStartPhase("physicsCreate", async () => {
                SceneLoadProfiler.begin("physicsCreate");
                try {
                    return await physicsManager.create(
                        this.editor!.sceneID!,
                        this.scene,
                        isMultiplayer,
                        maxMultiplayerClientsPerRoom,
                    );
                } finally {
                    SceneLoadProfiler.end("physicsCreate");
                }
            });
        } catch (err) {
            console.error("Physics failed to start", err);
            recordPlayStartTiming({
                phase: "startPlayerTotal",
                ms: Math.round(performance.now() - playStartTotalStart),
                success: false,
                message: err instanceof Error ? err.message : String(err),
            });
            throw err;
        }
        await timePlayStartPhase("postPhysicsPaint", () => this.yieldToNextPaint());

        timePlayStartSync("runtimeInit", () => {
            this.call("init", this);
            applyCameraProjectionSettings(this.camera, CameraControl.getCameraOptions(this.camera));
            this.loadingManager.nextStage(LoadingMessages.LOADING_ASSETS);
        });

        try {
            await timePlayStartPhase("playerSystemsCreate", async () => {
                SceneLoadProfiler.begin("playerSystemsCreate");
                try {
                    const promise1 = this.playerEvent?.create(this.scene, this.camera, this.renderer, this.scripts);
                    //const promise2 = this.control?.create(physics, this.scene, this.camera, this.renderer, this);
                    const promise3 = this.audio?.create(this.scene, this.camera, this.renderer);
                    //let promise7 = this.webvr.create(this.scene, this.camera, this.renderer);
                    await Promise.all([promise1, promise3]);
                } finally {
                    SceneLoadProfiler.end("playerSystemsCreate");
                }
            });
        } catch (err) {
            console.error("Player failed to start", err);
            recordPlayStartTiming({
                phase: "startPlayerTotal",
                ms: Math.round(performance.now() - playStartTotalStart),
                success: false,
                message: err instanceof Error ? err.message : String(err),
            });
            throw err;
        }
        await timePlayStartPhase("postPlayerSystemsPaint", () => this.yieldToNextPaint());

        const sceneUsesAiNpc = await timePlayStartPhase(
            "detectAiNpcBehavior",
            () => this.sceneUsesBehaviorIdProgressive(this.scene, AI_NPC_BEHAVIOR_ID),
        );
        if (sceneUsesAiNpc) {
            try {
                await timePlayStartPhase("aiWorldControlCreate", async () => {
                    SceneLoadProfiler.begin("aiWorldControlCreate");
                    try {
                        await this.aiWorldControl?.create(this.scene, this.camera, this.renderer, this.editor?.sceneID, this);
                    } finally {
                        SceneLoadProfiler.end("aiWorldControlCreate");
                    }
                });
            } catch (err) {
                console.error("AiWorldControl failed to start", err);
                recordPlayStartTiming({
                    phase: "startPlayerTotal",
                    ms: Math.round(performance.now() - playStartTotalStart),
                    success: false,
                    message: err instanceof Error ? err.message : String(err),
                });
                throw err;
            }
        } else {
            console.debug("[EngineRuntime] Skipping AI world control startup; scene has no AI NPC behavior");
            recordPlayStartTiming({phase: "aiWorldControlSkipped", ms: 0, success: true});
        }
        await timePlayStartPhase("postAiWorldPaint", () => this.yieldToNextPaint());

        this.isPlaying = true;

        try {
            await timePlayStartPhase("gameCreate", async () => {
                SceneLoadProfiler.begin("gameCreate");
                try {
                    await game.create(
                        physics,
                        physicsManager,
                        physicsManager.multiplayerState!,
                        this,
                        this.animationControl!,
                        this.animationGraphControl!,
                        this.audioControl!,
                        useInstancing,
                        isMultiplayer,
                        this.animations,
                    );
                } finally {
                    SceneLoadProfiler.end("gameCreate");
                }
            });

            await timePlayStartPhase("postGameCreatePaint", () => this.yieldToNextPaint());

            const emptyHUD = !game.isEnabled || !game.scene;
            const shouldAutoStartGameplay = emptyHUD || isSandbox || !this.editor?.showHUD;

            timePlayStartSync("runtimeSystemsStart", () => {
                this.playerEvent?.init();
                this.clock.start();
                this.playerEvent?.start();
                this.animationControl?.start(game);
                this.animationGraphControl?.start(game);
                this.audioControl?.start(game);
                this.vrmExpressionControl?.start(game);
                if (!shouldAutoStartGameplay) {
                    this.startAnimationLoop();
                    void this.showStats();
                    this.showMemoryStats();
                }
            });

            timePlayStartSync("playerStartedEvent", () => {
                this.call("playerStarted", null);
                console.debug("Player Started");
            });

            console.debug("🎮 [Application] Creating HUD...");

            timePlayStartSync("hudCreate", () => {
                game.hud?.create(emptyHUD);
            });

            if (shouldAutoStartGameplay) {
                await timePlayStartPhase("autoStartGameplay", async () => {
                    await timePlayStartPhase("autoStart:showMemoryStats", () => this.showStats());
                    await timePlayStartPhase("autoStart:preGameStartPaint", () => this.yieldToNextPaint());
                    markRuntimeSceneRevealPending(this.scene);
                    await timePlayStartPhase("autoStart:gameStart", () => game.startGame());
                    recordPlayStartTiming({
                        phase: "autoStart:runtimeBudgetsDeferred",
                        ms: 0,
                        success: true,
                        message: "post-first-frame-only-for-budgets-not-prewarmed",
                    });
                    // Material budgeting is a runtime quality optimization, not
                    // an authored scene requirement. Apply it while the loading
                    // mask is still active: replacing material programs after
                    // the first live frame creates a measurable gameplay hitch.
                    // Instancing remains pre-warmed below because it bounds the
                    // first submitted geometry and shadow work.
                    try {
                        await timePlayStartPhase("runtimeMaterialBudgetPrewarm", async () => {
                            const stats = await applyRuntimeMaterialBudgetProgressive(this.scene, {
                                batchSize: PLAY_START_RUNTIME_BUDGET_BATCH_SIZE,
                                frameBudgetMs: PLAY_START_RUNTIME_BUDGET_FRAME_MS,
                                yieldToFrame: () => this.yieldToNextPaint(),
                            });
                            this.runtimeMaterialBudgetAppliedScene = this.scene;
                            if (stats.materialsSimplified > 0 || stats.materialsDowngraded > 0 || stats.materialsShared > 0) {
                                console.debug("[RuntimeMaterialBudget] Prewarmed", stats);
                            }
                        });
                    } catch (error) {
                        this.runtimeMaterialBudgetAppliedScene = null;
                        console.debug("[EngineRuntime] Runtime material prewarm skipped", error);
                    }
                    try {
                        await timePlayStartPhase("runtimeInstancingBudgetPrewarm", async () => {
                            const stats = await this.applyRuntimeInstancingBudget(this.scene);
                            this.runtimeInstancingBudgetAppliedScene = this.scene;
                            if (stats.meshesCapped > 0) {
                                console.debug("[RuntimeInstancingBudget] Prewarmed", stats);
                            }
                        });
                    } catch (error) {
                        // Instancing budgeting is a quality optimization, never
                        // a reason to fail entering Play mode.
                        this.runtimeInstancingBudgetAppliedScene = null;
                        console.debug("[EngineRuntime] Runtime instancing prewarm skipped", error);
                    }
                    try {
                        await timePlayStartPhase("runtimeShadowBudgetPrewarm", async () => {
                            const backend = this.renderer?.backend as WebGPUBackend | null | undefined;
                            const explicitPolicy = this.scene.userData?.rendering?.runtimeShadowBudget?.enabled === true;
                            const stats = explicitPolicy
                                ? applyRuntimeShadowBudget(this.scene)
                                : applyAutomaticFallbackRuntimeShadowBudget(this.scene, {
                                    isWebGPU: backend?.isWebGPUBackend === true,
                                });
                            this.runtimeShadowBudgetAppliedScene = stats.enabled ? this.scene : null;
                            if (stats.meshesDisabled > 0) {
                                console.debug("[RuntimeShadowBudget] Prewarmed", stats);
                            }
                        });
                    } catch (error) {
                        this.runtimeShadowBudgetAppliedScene = null;
                        console.debug("[EngineRuntime] Runtime shadow prewarm skipped", error);
                    }
                    try {
                        await timePlayStartPhase("runtimeMainTriangleBudgetPrewarm", async () => {
                            const backend = this.renderer?.backend as WebGPUBackend | null | undefined;
                            const stats = applyRuntimeMainTriangleBudget(this.scene, {
                                isWebGPU: backend?.isWebGPUBackend === true,
                                camera: this.camera,
                            });
                            this.runtimeMainTriangleBudgetAppliedScene = this.scene;
                            if (stats.unitsDisabled > 0) {
                                console.debug(`[RuntimeMainTriangleBudget] Prewarmed ${JSON.stringify(stats)}`);
                            }
                        });
                    } catch (error) {
                        this.runtimeMainTriangleBudgetAppliedScene = null;
                        console.debug("[EngineRuntime] Runtime main triangle prewarm skipped", error);
                    }
                    timePlayStartSync("autoStart:prepareRuntimeSceneReveal", () => {
                        this.prepareRuntimeSceneRevealForPlayStart();
                    });
                    await timePlayStartPhase("autoStart:initialRuntimeSceneReveal", async () => {
                        await this.runtimeSceneRevealController?.revealInitialFrame();
                    });
                    // Keep both render loops paused through authored startup,
                    // initial scene reveal, and pipeline warmup. The loading
                    // mask remains visible until the first post-start render
                    // handshake, so no synchronous scene mutation competes
                    // with the first expensive GPU pass.
                    await timePlayStartPhase("rendererWarmup", () => this.warmRendererForFirstFrame());
                    // Arm the listener before resuming the render loop. On a
                    // fast backend the first frame can be delivered before a
                    // listener created after startAnimationLoop() is attached,
                    // forcing the full timeout despite a successful render.
                    // When progressive reveal is disabled, the masked warmup
                    // submits the full authored/runtime scene. Require one
                    // live frame before hiding the mask so a deferred driver
                    // compile cannot become a visible black/stutter frame.
                    const requiresLiveFirstFrame =
                        this.runtimeSceneRevealController?.stats.enabled === false;
                    firstRenderHandshakePromise = this.runtimeStartupWarmupRendered && !requiresLiveFirstFrame
                        ? Promise.resolve()
                        : this.waitForFirstRenderedFrameAfterPaint();
                    timePlayStartSync("resumeRenderForProgressiveStart", resumeRenderBeforeFirstFrame);
                    timePlayStartSync("autoStart:startAnimationLoop", () => {
                        this.startAnimationLoop();
                    });
                    recordPlayStartTiming({
                        phase: "autoStart:precompileShadersSkipped",
                        ms: 0,
                        success: true,
                        message: "deferred",
                    });
                    recordPlayStartTiming({
                        phase: "autoStart:postGameStartPaintSkipped",
                        ms: 0,
                        success: true,
                        message: "covered-by-first-render-handshake",
                    });
                });
            } else {
                await timePlayStartPhase("rendererWarmup", () => this.warmRendererForFirstFrame());
                firstRenderHandshakePromise = this.runtimeStartupWarmupRendered
                    ? Promise.resolve()
                    : this.waitForFirstRenderedFrameAfterPaint();
                timePlayStartSync("resumeRenderBeforeFirstFrame", resumeRenderBeforeFirstFrame);
                recordPlayStartTiming({phase: "autoStartGameplaySkipped", ms: 0, success: true});
            }

            console.debug("🎮 [Application] Setting up camera options...");
            timePlayStartSync("cameraOptions", () => {
                const cameraOptions = CameraControl.getCameraOptions(this.camera);
                this.disableClickEvents = !!cameraOptions?.usePointerLock || !isSandbox;
            });

            // A completed masked warmup render is already a valid first frame:
            // WebGPU waits for queue completion and WebGL uses a finish fence.
            // Do not add a second animation-frame wait here; Chromium can defer
            // the first live callback while the renderer loop is being resumed,
            // which otherwise leaves a valid scene hidden behind the mask.
            await this.completePlayerStartupLoadingAfterFirstRender(firstRenderHandshakePromise);
            timePlayStartSync("startRuntimeSceneReveal", () => {
                const controller = this.runtimeSceneRevealController;
                if (!controller || controller.stats.hiddenObjects === 0) {
                    return;
                }
                controller.start();
                console.debug("[RuntimeSceneReveal] Started", controller.stats);
            });
            timePlayStartSync("schedulePostStartupRuntimeBudgets", () => {
                this.schedulePostStartupRuntimeBudgets();
            });
            recordPlayStartTiming({
                phase: "startPlayerTotal",
                ms: Math.round(performance.now() - playStartTotalStart),
                success: true,
            });
            this.runtimeStartupActive = false;
            this.runtimeStartupWarmupRendered = false;
            console.debug("🎮 [Application] ✅ startPlayer completed successfully");
        } catch (err: any) {
            this.runtimeStartupActive = false;
            console.error("❌ [Application] startPlayer failed at:", err?.message || err);
            console.error("❌ [Application] Full error:", err);
            try {
                this.on("beforeRender.RuntimeSceneReveal", null);
                clearRuntimeSceneRevealPending(this.scene);
                this.runtimeSceneRevealController?.restore();
                this.runtimeSceneRevealController = null;
                restoreRuntimeMaterialBudget(this.scene);
                this.runtimeMaterialBudgetAppliedScene = null;
                restoreRuntimeInstancingBudget(this.scene);
                this.runtimeInstancingBudgetAppliedScene = null;
                restoreRuntimeShadowBudget(this.scene);
                this.runtimeShadowBudgetAppliedScene = null;
                restoreRuntimeMainTriangleBudget(this.scene);
                this.runtimeMainTriangleBudgetAppliedScene = null;
            } catch (restoreError) {
                console.warn("[EngineRuntime] Failed to restore runtime render budgets after play startup failure", restoreError);
            }
            recordPlayStartTiming({
                phase: "startPlayerTotal",
                ms: Math.round(performance.now() - playStartTotalStart),
                success: false,
                message: err instanceof Error ? err.message : String(err),
            });
            throw err;
        }
    }

    private isPostStartupRuntimeBudgetCurrent(scene: Scene, token: number): boolean {
        return this.postStartupRuntimeBudgetToken === token && this.scene === scene && this.isPlaying;
    }

    private schedulePostStartupRuntimeBudgets(): void {
        if (!this.scene) {
            return;
        }

        const scene = this.scene;
        const token = ++this.postStartupRuntimeBudgetToken;
        void this.runPostStartupRuntimeBudgets(scene, token).catch(error => {
            if (this.isPostStartupRuntimeBudgetCurrent(scene, token)) {
                console.warn("[EngineRuntime] Post-start runtime budgets failed", error);
            }
        });
    }

    private async runPostStartupRuntimeBudgets(scene: Scene, token: number): Promise<void> {
        await this.yieldToNextPaint();
        if (!this.isPostStartupRuntimeBudgetCurrent(scene, token)) {
            return;
        }

        if (this.runtimeMaterialBudgetAppliedScene !== scene) {
            await timePlayStartPhase("postStart:runtimeMaterialBudget", async () => {
                const stats = await applyRuntimeMaterialBudgetProgressive(scene, {
                    batchSize: PLAY_START_RUNTIME_BUDGET_BATCH_SIZE,
                    frameBudgetMs: PLAY_START_RUNTIME_BUDGET_FRAME_MS,
                    yieldToFrame: () => this.yieldToNextPaint(),
                });
                this.runtimeMaterialBudgetAppliedScene = scene;
                if (stats.materialsSimplified > 0 || stats.materialsDowngraded > 0 || stats.materialsShared > 0) {
                    console.debug("[RuntimeMaterialBudget] Applied", stats);
                }
            });
        }
        if (!this.isPostStartupRuntimeBudgetCurrent(scene, token)) {
            return;
        }

        if (this.runtimeInstancingBudgetAppliedScene !== scene) {
            await timePlayStartPhase("postStart:runtimeInstancingBudget", async () => {
                const stats = await this.applyRuntimeInstancingBudget(scene);
                this.runtimeInstancingBudgetAppliedScene = scene;
                if (stats.meshesCapped > 0) {
                    console.debug("[RuntimeInstancingBudget] Applied", stats);
                }
            });
        }
        if (!this.isPostStartupRuntimeBudgetCurrent(scene, token)) {
            return;
        }
        const runtimeShadowBudgetExplicit = scene.userData?.rendering?.runtimeShadowBudget?.enabled === true;
        const runtimeShadowBudgetOptedOut = scene.userData?.rendering?.runtimeShadowBudget?.enabled === false;
        const runtimeShadowBudgetFallbackCandidate = !runtimeShadowBudgetExplicit
            && !runtimeShadowBudgetOptedOut
            && (this.renderer?.backend as WebGPUBackend | null | undefined)?.isWebGPUBackend !== true;
        if (runtimeShadowBudgetExplicit || runtimeShadowBudgetFallbackCandidate) {
            await timePlayStartPhase("postStart:runtimeShadowBudget", async () => {
                const backend = this.renderer?.backend as WebGPUBackend | null | undefined;
                const stats = runtimeShadowBudgetExplicit
                    ? applyRuntimeShadowBudget(scene)
                    : applyAutomaticFallbackRuntimeShadowBudget(scene, {
                        isWebGPU: backend?.isWebGPUBackend === true,
                    });
                this.runtimeShadowBudgetAppliedScene = stats.enabled ? scene : null;
                if (stats.meshesDisabled > 0) {
                    console.debug("[RuntimeShadowBudget] Applied", stats);
                }
            });
            if (runtimeShadowBudgetExplicit || this.runtimeShadowBudgetAppliedScene === scene) {
                // Runtime-only builders may append meshes after the first live
                // frame. Re-evaluate once off the startup critical path so the
                // cap covers bounded growth without adding a render-loop
                // observer or mutating authored scenes.
                await new Promise<void>(resolve => setTimeout(resolve, 750));
                if (!this.isPostStartupRuntimeBudgetCurrent(scene, token)) {
                    return;
                }
                await timePlayStartPhase("postStart:runtimeShadowBudgetStabilize", async () => {
                    const backend = this.renderer?.backend as WebGPUBackend | null | undefined;
                    const stats = runtimeShadowBudgetExplicit
                        ? applyRuntimeShadowBudget(scene)
                        : applyAutomaticFallbackRuntimeShadowBudget(scene, {
                            isWebGPU: backend?.isWebGPUBackend === true,
                        });
                    this.runtimeShadowBudgetAppliedScene = stats.enabled ? scene : null;
                    if (stats.meshesDisabled > 0) {
                        console.debug("[RuntimeShadowBudget] Stabilized", stats);
                    }
                });
            }
        }
        if (!this.isPostStartupRuntimeBudgetCurrent(scene, token)) {
            return;
        }
        const runtimeMainTriangleBudgetEnabled = scene.userData?.rendering?.runtimeMainTriangleBudget?.enabled === true;
        if (runtimeMainTriangleBudgetEnabled) {
            await timePlayStartPhase("postStart:runtimeMainTriangleBudget", async () => {
                const backend = this.renderer?.backend as WebGPUBackend | null | undefined;
                const stats = applyRuntimeMainTriangleBudget(scene, {
                    isWebGPU: backend?.isWebGPUBackend === true,
                    camera: this.camera,
                });
                this.runtimeMainTriangleBudgetAppliedScene = scene;
                if (stats.unitsDisabled > 0) {
                    console.debug(`[RuntimeMainTriangleBudget] Applied ${JSON.stringify(stats)}`);
                }
            });
            await new Promise<void>(resolve => setTimeout(resolve, 750));
            if (!this.isPostStartupRuntimeBudgetCurrent(scene, token)) {
                return;
            }
            await timePlayStartPhase("postStart:runtimeMainTriangleBudgetStabilize", async () => {
                const backend = this.renderer?.backend as WebGPUBackend | null | undefined;
                const stats = applyRuntimeMainTriangleBudget(scene, {
                    isWebGPU: backend?.isWebGPUBackend === true,
                    camera: this.camera,
                });
                this.runtimeMainTriangleBudgetAppliedScene = scene;
                if (stats.unitsDisabled > 0) {
                    console.debug(`[RuntimeMainTriangleBudget] Stabilized ${JSON.stringify(stats)}`);
                }
            });
        }
    }

    private applyRuntimeInstancingBudget(scene: Scene) {
        const qualitySettings = this.qualitySystem?.getQualityManager().getCurrentSettings();
        const qualityTriangleBudget = qualitySettings?.scene?.maxTriangles;
        const runtimeInstancingTriangleBudget =
            typeof qualityTriangleBudget === "number" &&
            Number.isFinite(qualityTriangleBudget) &&
            qualityTriangleBudget > 0
                ? Math.min(qualityTriangleBudget, DEFAULT_RUNTIME_INSTANCING_TRIANGLE_BUDGET)
                : DEFAULT_RUNTIME_INSTANCING_TRIANGLE_BUDGET;
        return applyRuntimeInstancingBudgetProgressive(scene, {
            maxTotalSubmittedTriangles: runtimeInstancingTriangleBudget,
            maxSubmittedTrianglesPerMesh: Math.min(
                runtimeInstancingTriangleBudget,
                DEFAULT_RUNTIME_INSTANCING_MESH_TRIANGLE_BUDGET,
            ),
            batchSize: PLAY_START_RUNTIME_BUDGET_BATCH_SIZE,
            frameBudgetMs: PLAY_START_RUNTIME_BUDGET_FRAME_MS,
            yieldToFrame: () => this.yieldToNextPaint(),
        });
    }

    private prepareRuntimeSceneRevealForPlayStart(): RuntimeSceneRevealController {
        this.runtimeSceneRevealController?.restore();
        const revealConfig = this.scene.userData?.rendering?.runtimeSceneReveal ?? {};
        // Runtime reveal remains scene-configurable. Large legacy Playground
        // scenes on the WebGL fallback also get a bounded default ramp because
        // submitting every lazy material program in one frame can monopolize
        // the browser; explicit scene settings always take precedence.
        const hasExplicitRevealConfig = Object.keys(revealConfig).length > 0;
        // Playground scenes may generate a large runtime scene during behavior
        // startup, so a default post-mask reveal cannot size itself from the
        // authored scene alone. Keep it opt-in for Playground; authored scene
        // configuration remains the supported way to request progressive reveal.
        const revealEnabledByDefault = false;
        const rendererBackend = (this.renderer as WebGPURenderer & {
            backend?: {isWebGLBackend?: boolean};
        } | null)?.backend;
        let renderableCount = 0;
        let sceneObjectCount = 0;
        this.scene.traverse(object => {
            sceneObjectCount++;
            if (
                (object as {isMesh?: boolean; isPoints?: boolean; isLine?: boolean; isSprite?: boolean}).isMesh ||
                (object as {isPoints?: boolean}).isPoints ||
                (object as {isLine?: boolean}).isLine ||
                (object as {isSprite?: boolean}).isSprite
            ) {
                renderableCount++;
            }
        });
        // WebGL fallbacks compile node/material programs lazily. Large legacy
        // Playground scenes otherwise submit every program in one first live
        // frame, which can monopolize the browser for several seconds. Stage
        // only genuinely large fallback scenes; authored reveal settings still
        // take precedence and small scenes retain their original behavior.
        const useWebGLFallbackReveal =
            rendererBackend?.isWebGLBackend === true &&
            !hasExplicitRevealConfig &&
            !isPlaygroundMode() &&
            this.editor?.isSandbox !== true &&
            renderableCount > 512;
        // Once a default scene is very large, a post-mask visibility stream
        // creates a long tail of shader/material submissions. Keep the whole
        // scene visible through the masked warmup instead; explicit authored
        // reveal settings still take precedence below.
        const useWebGLFallbackRevealForScene =
            useWebGLFallbackReveal && renderableCount <= 1024;
        const skipDefaultRevealForLargeScene =
            !hasExplicitRevealConfig && (
                (revealEnabledByDefault && (renderableCount > 256 || sceneObjectCount > 256)) ||
                (!revealEnabledByDefault && rendererBackend?.isWebGLBackend === true && renderableCount > 1024)
            );
        const instancedCountTriangleBudget = typeof revealConfig.instancedCountTriangleBudget === "number"
            ? revealConfig.instancedCountTriangleBudget
            // Keep WebGL reveal ramps deliberately small. The full instance
            // buffer is already uploaded during the masked warmup; smaller
            // count steps prevent one post-reveal draw from monopolizing a
            // frame on mobile/driver-backed WebGL.
            : rendererBackend?.isWebGLBackend === true
                ? 128
                : undefined;
        const controller = prepareRuntimeSceneReveal(this.scene, {
            enabled: !skipDefaultRevealForLargeScene &&
                (useWebGLFallbackRevealForScene || (revealEnabledByDefault || hasExplicitRevealConfig) && revealConfig.enabled !== false),
            batchSize: useWebGLFallbackRevealForScene ? 4 : revealConfig.batchSize,
            batchWeightBudget: useWebGLFallbackRevealForScene ? 4 : revealConfig.batchWeightBudget,
            targetFrameGapMs: revealConfig.targetFrameGapMs,
            longFrameCooldownFrames: revealConfig.longFrameCooldownFrames,
            initialRevealBatchSize: useWebGLFallbackRevealForScene ? 12 : revealConfig.initialRevealBatchSize,
            initialRevealWeightBudget: useWebGLFallbackRevealForScene ? 24 : revealConfig.initialRevealWeightBudget,
            maxCooldownDelayMs: useWebGLFallbackRevealForScene
                ? 0
                : revealConfig.maxCooldownDelayMs,
            // Chromium's WebGL fallback can report a long callback gap while
            // the GPU is still draining the previous visibility submission.
            // Do not let that gap exponentially enlarge the next reveal batch;
            // a bounded authored-order stream keeps heavy legacy scenes
            // interactive instead of creating another submission spike.
            maxAdaptiveFrameBatchMultiplier: useWebGLFallbackRevealForScene
                ? 1
                : revealConfig.maxAdaptiveFrameBatchMultiplier,
            maxRevealDurationMs: revealConfig.maxRevealDurationMs,
            debugLongFrames: revealConfig.debugLongFrames,
            debugLongFrameLimit: revealConfig.debugLongFrameLimit,
            progressiveInstancedCounts: revealConfig.progressiveInstancedCounts,
            // Keep staged instance-buffer uploads explicit until the first-frame
            // density gate proves the visual result is acceptable. Playground
            // scenes can opt in per scene without changing player defaults.
            progressiveInstancedUploads: revealConfig.progressiveInstancedUploads,
            maxInstancedRampFrames: revealConfig.maxInstancedRampFrames,
            rampInstancedCountsBeforeContinuingReveal:
                revealConfig.rampInstancedCountsBeforeContinuingReveal,
            orderByWeight: useWebGLFallbackRevealForScene ? false : revealConfig.orderByWeight !== false,
            instancedInitialCount: revealConfig.instancedInitialCount,
            instancedCountTriangleBudget,
            includeStaticSceneRenderables: revealConfig.includeStaticSceneRenderables !== false,
            // Keep runtime-only reveal behavior explicit and backwards
            // compatible. The fallback renderer still stages these objects by
            // default; an authored scene may opt out after measuring its own
            // masked-warmup cost with `includeRuntimeSceneRenderables: false`.
            includeRuntimeSceneRenderables: revealConfig.includeRuntimeSceneRenderables !== false,
            staticSceneTriangleThreshold: revealConfig.staticSceneTriangleThreshold ?? 256,
            includeCameraRuntimeRenderables: revealConfig.includeCameraRuntimeRenderables === true,
            precompileRevealBatch: revealConfig.precompile === true
                ? objects => this.precompileRuntimeRevealBatch(objects)
                : undefined,
            precompileRevealBatchNeedsSummary: false,
            yieldBeforePrecompile: true,
        });
        this.runtimeSceneRevealController = controller;
        this.on("beforeRender.RuntimeSceneReveal", () => {
            this.runtimeSceneRevealController?.beforeRender();
        });
        if (controller.stats.hiddenObjects > 0) {
            console.debug("[RuntimeSceneReveal] Prepared", controller.stats);
        }
        return controller;
    }

    private clearPlayerLoadMaskAfterStartupFailure(): void {
        try {
            this.playerMask?.hide();
        } catch (err) {
            console.warn("[EngineRuntime] Failed to clear player load mask after play startup failure", err);
        }
        try {
            this.loadingManager?.completeLoading();
        } catch (err) {
            console.warn("[EngineRuntime] Failed to complete loading manager after play startup failure", err);
        }
    }

    private async completePlayerStartupLoadingAfterFirstRender(
        firstRenderHandshakePromise?: Promise<void>,
    ): Promise<void> {
        recordPlayStartTiming({
            phase: "firstRenderHandshakePath",
            ms: 0,
            success: this.runtimeStartupWarmupRendered,
            message: JSON.stringify({
                warmupRendered: this.runtimeStartupWarmupRendered,
                hasPrearmedPromise: !!firstRenderHandshakePromise,
            }),
        });
        await timePlayStartPhase(
            "firstRenderHandshake",
            () => this.runtimeStartupWarmupRendered
                ? Promise.resolve()
                : firstRenderHandshakePromise ?? this.waitForFirstRenderedFrameAfterPaint(),
        );

        recordPlayStartTiming({
            phase: "schedulePlayShaderWarmupSkipped",
            ms: 0,
            success: true,
            message: "removed",
        });

        console.debug("🎮 [Application] Handling HUD visibility...");
        timePlayStartSync("loadingComplete", () => {
            // The mask belongs to the runtime startup handshake, not to HUD
            // visibility. Play-only and HUD-disabled sessions must clear it as
            // well once a real frame has rendered.
            this.playerMask.hide();
        this.loadingManager.completeLoading();
        });
        this.runtimeStartupWarmupRendered = false;
    }

    async stopPlayer(options?: {preserveRenderedFrame?: boolean; clearStartupMask?: boolean}) {
        this.runtimeStartupActive = false;
        this.runtimeStartupWarmupRendered = false;
        // Detach the worker completion callback before any early-return path
        // (including a failed startup) can leave the old PlayerPhysics2 alive.
        this.clearPhysicsFixedStepListener();
        if (!this.isPlaying && !this.isPaused) {
            // PlayerSession is constructed before startPlayer flips isPlaying.
            // If startup fails during that window, the old early return left
            // its listeners, worker, and partially-created GameManager alive.
            // Dispose the failed session even though no playable loop started.
            this.disposePlayerSession("after startup failure");
            if (options?.clearStartupMask) {
                this.clearPlayerLoadMaskAfterStartupFailure();
            }
            return;
        }

        const localPlaygroundScene = !!(
            this.editor?.sceneID?.startsWith("oss-") ||
            this.scene?.userData?.sceneId?.startsWith?.("oss-")
        );

        try {
            this.effectRenderer?.showOriginalMeshes();
        } catch (err) {
            console.warn("[BatchManager] Failed to restore original meshes during play teardown", err);
        }
        try {
            this.on("beforeRender.RuntimeSceneReveal", null);
            clearRuntimeSceneRevealPending(this.scene);
            this.runtimeSceneRevealController?.restore();
            this.runtimeSceneRevealController = null;
        } catch (err) {
            console.warn("[RuntimeSceneReveal] Failed to restore hidden runtime objects during play teardown", err);
        }
        try {
            restoreRuntimeInstancingBudget(this.scene);
            this.runtimeInstancingBudgetAppliedScene = null;
        } catch (err) {
            console.warn("[RuntimeInstancingBudget] Failed to restore instanced mesh counts during play teardown", err);
        }
        try {
            restoreRuntimeMaterialBudget(this.scene);
            this.runtimeMaterialBudgetAppliedScene = null;
        } catch (err) {
            console.warn("[RuntimeMaterialBudget] Failed to restore material nodes during play teardown", err);
        }
        try {
            restoreRuntimeShadowBudget(this.scene);
            this.runtimeShadowBudgetAppliedScene = null;
        } catch (err) {
            console.warn("[RuntimeShadowBudget] Failed to restore runtime shadow state during play teardown", err);
        }
        try {
            restoreRuntimeMainTriangleBudget(this.scene);
            this.runtimeMainTriangleBudgetAppliedScene = null;
        } catch (err) {
            console.warn("[RuntimeMainTriangleBudget] Failed to restore runtime visibility during play teardown", err);
        }
        this.postStartupRuntimeBudgetToken++;

        // Flip runtime flags immediately so edit/remix interaction is not blocked
        // by stale play-state checks while async teardown is still running.
        this.isPlaying = false;
        this.isPaused = false;
        this.pendingWorkerSimulationFrame = null;

        // Silence game audio up front so the user hears no leftover music while
        // the rest of the async teardown (scene revert, behavior dispose, etc.)
        // is still running.
        this.audioControl?.stopAll();
        this.game?.clearSounds();

        // Tear down the inspector's free-fly camera and revert any inspector edits
        // (transforms + behavior attribute data) before the scene goes back to edit mode.
        if (this.playmodeDebugCamera?.active) {
            this.playmodeDebugCamera.detach();
        }
        let restoredInMemory = false;
        if (this.playmodeSnapshot) {
            try {
                restorePlaymodeSnapshot(this.scene, this.playmodeSnapshot, {
                    removeExtraObject: object => {
                        this.game?.disposeObject(object);
                        traverseObjectDepthFirst(object, child => {
                            MeshUtils.dispose(child);
                        });
                        object.removeFromParent();
                    },
                });
                restoredInMemory = true;
            } catch (err) {
                console.warn("[Playmode Inspector] Failed to restore snapshot", err);
            }
            this.playmodeSnapshot = null;
        }

        await this.traverseSceneObjectsProgressively(obj => {
            this.updateObjectVisibility(obj, false);
        });

        this.setUpFog();

        if (!options?.preserveRenderedFrame) {
            this.playerMask.show();
        }

        if (this.editor?.isSandbox === false || (isPlaygroundMode() && localPlaygroundScene)) {
            if (restoredInMemory) {
                this.call("sceneGraphChanged", this.editor);
            } else {
                this.editor?.reverseTraverseSceneObjects(object => {
                    this.editor?.removeObject(object);

                    MeshUtils.dispose(object);
                });

                await this.restoreSceneState();

                this.editor?.traverseSceneObjects(object => {
                    this.call("objectAdded", this.editor, object);
                });
            }
        }

        // Local Playground restores the authored object identities from the
        // in-memory snapshot. Rebuilding the WebGPU batch manager synchronously
        // here forces a full editor pipeline recompile and can leave the page
        // unresponsive for many seconds after the mode promise has resolved.
        // Keep the warm manager attached; its normal scene-mesh revision pass
        // reconciles additions/removals on the next interactive frame. Remote
        // and serialized restore paths retain the conservative rebuild.
        if (!localPlaygroundScene) {
            this.effectRenderer?.initializeBatchManager?.(this.scene);
        }

        if (!options?.preserveRenderedFrame) {
            this.playerMask.hide();
        }

        //global.app.setAutoSave(this.autoSaveState);
        // PlayerSession owns GameManager, physics, audio, and event resources.
        // Dispose it before resolving Stop so a transient Play → Edit window
        // cannot retain the old session through EngineRuntime getters.
        this.disposePlayerSession("after play teardown");

        this.clock.stop();

        this.hideStats();
        this.hideMemoryStats();

        this.call("playerStopped", null);
    }

    /**
     * Toggle the play-mode free-fly debug camera. While active, the in-game
     * camera control is paused and OrbitControls drives `this.camera`. The
     * game continues running normally; only the rendered viewpoint changes.
     * Returns the new active state.
     */
    togglePlaymodeFreeCamera(): boolean {
        if (!this.isPlaying) return false;
        const domElement = (this.renderer as any)?.domElement as HTMLElement | undefined;
        if (!domElement) return false;

        if (!this.playmodeDebugCamera) {
            this.playmodeDebugCamera = new PlaymodeDebugCamera(this.camera, domElement);
        }

        if (this.playmodeDebugCamera.active) {
            this.playmodeDebugCamera.detach();
            this.on("beforeRender.PlaymodeDebugCamera", null);
            return false;
        }

        this.playmodeDebugCamera.attach(this.game);
        this.on("beforeRender.PlaymodeDebugCamera", () => {
            this.playmodeDebugCamera?.update();
        });
        return true;
    }

    private pausePlayer() {
        if (!this.isPlaying) {
            return;
        }
        this.isPlaying = false;
        this.isPaused = true;
        this.pendingWorkerSimulationFrame = null;
        this.clock.stop();
        this.frameTimer.reset();
        this.simulationClock.reset();
        this.physics?.pause();
    }

    private resumePlayer() {
        if (this.isPlaying) {
            return;
        }
        this.isPlaying = true;
        this.isPaused = false;
        this.clock.start();
        this.frameTimer.reset();
        this.simulationClock.reset();
        if (this.physics) {
            this.physics.resume();
        }
    }

    private copyCameraState(sourceCamera: PerspectiveCamera) {
        Object.assign(this.camera.userData, sourceCamera.userData);
        this.camera.fov = sourceCamera.fov;
        this.camera.near = sourceCamera.near;
        this.camera.far = sourceCamera.far;

        // Derive aspect from the current viewport rather than the serialized camera
        const rendererDom = (this as any).renderer?.domElement;
        if (rendererDom) {
            const width = rendererDom.clientWidth || rendererDom.width;
            const height = rendererDom.clientHeight || rendererDom.height;
            if (width > 0 && height > 0) {
                this.camera.aspect = width / height;
            }
        }
        this.camera.up.set(0, 1, 0);
        this.camera.position.copy(sourceCamera.position);
        this.camera.quaternion.copy(sourceCamera.quaternion);

        this.camera.updateProjectionMatrix();
    }

    private async restoreSceneState() {
        // Stem editor: reload the stem from its head revision. Matches the
        // scene-editor behavior of re-fetching from the server on play stop,
        // which means unsaved stem edits are lost here (same as normal scenes).
        const stemMeta = this.scene.userData?.stemEditor as StemEditorMetadata | undefined;
        if (stemMeta) {
            try {
                await this.setUpStemEditor(stemMeta.assetId);
                this.call("restartRenderer", this);
            } catch (error) {
                console.error("Failed to restore stem editor state:", error);
                showRuntimeToast({
                    type: "error",
                    title: "Failed to restore stem editor state.",
                });
            }
            return;
        }

        // TODO: there is an asymmetry here between the scene editor and the
        // stem editor. The scene editor is doing a lightweight restore of the
        // scene data, while the stem editor is doing a full restore of the stem
        // data. Should we do the same for the stem editor? Is the scene restore
        // actually restoring everything that it should?
        const sceneID = this.editor?.sceneID;
        if (sceneID) {
            try {
                // Re-create AssetLoader and reload the durable ProjectStore
                // snapshot. The OSS v2 adapter returns a local data URL; using
                // the legacy load endpoint here would issue a remote Go request
                // and fail for browser-local project ids.
                const sceneData = await loadSceneRestorePayload(sceneID);
                await this.seedAssetLoader(sceneID);

                const result = await this.loadSceneFromData({
                    camera: this.camera,
                    server: this.options?.server,
                    domWidth: this.renderer?.domElement?.width,
                    domHeight: this.renderer?.domElement?.height,
                    assetLoader: this.assetLoader ?? undefined,
                    sceneData,
                });

                if (result?.camera) {
                    this.copyCameraState(result.camera as PerspectiveCamera);
                }
                if (result?.scene) {
                    await this.ensureRenderableMeshNormalsForScene(result.scene, "normalizeRestoredSceneNormals");
                    await this.ensureSceneRenderingSupport(result.scene);
                    await this.editor?.setScene(result.scene, true);
                    this.call("sceneGraphChanged", this);
                    console.info("[APP][TRACE] emitting restartRenderer from restoreSceneState");
                    this.call("restartRenderer", this);
                    this.call("sceneLoaded", this);
                }
            } catch (error) {
                console.error("Failed to restore scene state:", error);
                showRuntimeToast({
                    type: "error",
                    title: "Failed to restore scene state.",
                });
            }
        }
    }

    private runVariableSimulationStages(clock: Clock, variableDeltaTime: number, frameContext: FrameContext | null): void {
        this.aiWorldControl?.update(clock, variableDeltaTime);
        this.animationControl?.update(variableDeltaTime);
        this.animationGraphControl?.update(clock, variableDeltaTime);
        this.audioControl?.update();
        this.game?.update(clock, variableDeltaTime, frameContext ?? undefined);
        this.playerEvent?.update(clock, variableDeltaTime);
    }

    private animate(clock: Clock, deltaTime: number): void {
        if (!this.isPlaying) {
            return;
        }

        // Worker physics owns the fixed/variable ordering until its ACKs have
        // drained. Do not mutate a frame context or advance the simulation
        // clock again while that authoritative frame is still pending.
        if (this.pendingWorkerSimulationFrame) return;

        const simulationFrame = this.simulationClock.advance(deltaTime);
        const variableDeltaTime = simulationFrame.deltaTime;
        const frameContext = this.game?.beginSimulationFrame(variableDeltaTime, simulationFrame) ?? null;
        this.activeSimulationFrameContext = frameContext;
        this.ensurePhysicsFixedStepListener();

        // Apply completed worker samples once, then preserve the authoritative
        // fixed order for every bounded catch-up step.
        this.physics?.beginSimulationFrame(variableDeltaTime);
        let completedFixedSteps = this.completedWorkerFixedStepsSinceTelemetry;
        this.completedWorkerFixedStepsSinceTelemetry = 0;
        let droppedWorkerStepsThisFrame = 0;
        let pendingWorkerFixedSteps = 0;
        let deferredCompletedFixedSteps = 0;
        let workerStepPending = false;
        for (let stepIndex = 0; stepIndex < simulationFrame.fixedStepCount; stepIndex++) {
            const result = this.physics?.fixedUpdate(simulationFrame.fixedDeltaTime) ?? "completed";
            if (result === "completed") {
                if (workerStepPending) {
                    deferredCompletedFixedSteps++;
                } else {
                    this.game?.fixedUpdate(simulationFrame.fixedDeltaTime, frameContext ?? undefined);
                    completedFixedSteps++;
                }
            } else if (result === "dropped") {
                droppedWorkerStepsThisFrame++;
            } else if (result === "pending") {
                workerStepPending = true;
                pendingWorkerFixedSteps++;
            }
        }
        this.workerDroppedFixedSteps += droppedWorkerStepsThisFrame;
        this.workerDroppedSimulationTime +=
            droppedWorkerStepsThisFrame * simulationFrame.fixedDeltaTime;
        runtimeFrameTelemetry.recordSimulationFrame(
            completedFixedSteps,
            simulationFrame.droppedSteps + droppedWorkerStepsThisFrame,
            simulationFrame.droppedTime +
                droppedWorkerStepsThisFrame * simulationFrame.fixedDeltaTime,
            simulationFrame.totalDroppedSteps + this.workerDroppedFixedSteps,
                simulationFrame.totalDroppedTime + this.workerDroppedSimulationTime,
        );

        if (pendingWorkerFixedSteps > 0 && frameContext) {
            this.pendingWorkerSimulationFrame = {
                clock,
                variableDeltaTime,
                frameContext,
                remainingFixedSteps: pendingWorkerFixedSteps,
                deferredCompletedFixedSteps,
            };
            return;
        }

        this.runVariableSimulationStages(clock, variableDeltaTime, frameContext);
    }

    /**
     * Applies current launch/runtime quality to the single simulation clock
     * and physics substep policy. Legacy scheduler metadata is accepted only
     * as a fallback for older saved scenes.
     */
    configureSimulationQuality(settings: {
        physics?: {
            updateRate?: number;
            substeps?: number;
            maxStepsPerFrame?: number;
            solverIterations?: number;
        };
        scheduler?: {
            fixedTimestepHz?: number;
            maxFixedStepsPerFrame?: number;
        };
    }): void {
        const fixedHz = settings.physics?.updateRate ?? settings.scheduler?.fixedTimestepHz ?? 60;
        const maxStepsPerFrame =
            this.getLaunchPhysicsMaxSteps(settings);
        const config: FixedStepSimulationClockConfig = {
            fixedHz,
            maxStepsPerFrame,
        };
        this.simulationClock.configure(config);
        const solverIterations = settings.physics?.solverIterations;
        if (solverIterations === undefined) {
            this.physics?.configureQuality(
                this.simulationClock.getFixedHz(),
                settings.physics?.substeps ?? 1,
                this.simulationClock.getMaxStepsPerFrame(),
                true,
            );
        } else {
            this.physics?.configureQuality(
                this.simulationClock.getFixedHz(),
                settings.physics?.substeps ?? 1,
                this.simulationClock.getMaxStepsPerFrame(),
                true,
                true,
                solverIterations,
            );
        }
        this.ensurePhysicsFixedStepListener();
    }

    /** Drops stale wall-clock remainder after visibility and lifecycle gaps. */
    resetSimulationClock(): void {
        this.simulationClock.reset();
    }

    private ensurePhysicsFixedStepListener(): void {
        const physics = this.physics;
        if (physics === this.fixedStepListenerPhysics) return;
        this.fixedStepListenerPhysics?.setFixedStepCompletionListener(null);
        physics?.setFixedStepCompletionListener(this.handleWorkerFixedStepComplete);
        this.fixedStepListenerPhysics = physics;
    }

    private clearPhysicsFixedStepListener(): void {
        this.fixedStepListenerPhysics?.setFixedStepCompletionListener(null);
        this.fixedStepListenerPhysics = null;
        this.pendingWorkerSimulationFrame = null;
        this.activeSimulationFrameContext = null;
        this.completedWorkerFixedStepsSinceTelemetry = 0;
        this.workerDroppedFixedSteps = 0;
        this.workerDroppedSimulationTime = 0;
    }

    /** Release the current Play-session owner exactly once. */
    private disposePlayerSession(reason: string): void {
        const session = this.playerSession;
        this.playerSession = null;
        if (!session) return;
        try {
            session.dispose();
        } catch (err) {
            console.warn(`[EngineRuntime] Failed to dispose player session ${reason}`, err);
        }
    }

    shouldScheduleFrameRendering(): boolean {
        return false;
    }

    scheduleFrameRendering(renderFrame: () => void): void {
        renderFrame();
    }

    setLegacyAnimationLoopCallback(animationCallback: (() => void) | null): void {
        if (this.legacyAnimationLoopCallback === animationCallback) return;

        this.legacyAnimationLoopCallback = animationCallback;

        // A renderer restart can clear the applied callback before RenderEvent
        // is able to publish its callback again. Re-attach whenever this
        // renderer is still the applied owner, even if the previous callback
        // was explicitly cleared. The old `!== null` guard left route-refresh
        // Play sessions with a live app listener but no WebGPU animation loop.
        if (this.renderer && this.appliedAnimationLoopRenderer === this.renderer) {
            this.startScheduledAnimationLoop();
        }
    }

    setScheduledRenderCallback(_renderCallback: ((clock: Clock, deltaTime: number) => void) | null): void {
        // Compatibility no-op: the retired staged scheduler no longer owns render work.
    }

    runScheduledRender(_clock: Clock, _deltaTime: number): void {
        // Compatibility no-op: RenderEvent invokes the active renderer directly.
    }

    startScheduledAnimationLoop(): void {
        const renderer = this.renderer;
        if (!renderer) {
            this.appliedAnimationLoopRenderer = null;
            this.appliedAnimationLoopCallback = null;
            return;
        }

        if (
            this.appliedAnimationLoopRenderer === renderer &&
            this.appliedAnimationLoopCallback === this.legacyAnimationLoopCallback
        ) {
            return;
        }

        renderer.setAnimationLoop(this.legacyAnimationLoopCallback);
        this.appliedAnimationLoopRenderer = renderer;
        this.appliedAnimationLoopCallback = this.legacyAnimationLoopCallback;
    }

    stopScheduledAnimationLoop(): void {
        const renderer = this.renderer;
        if (!renderer) {
            this.appliedAnimationLoopRenderer = null;
            this.appliedAnimationLoopCallback = null;
            return;
        }

        if (this.appliedAnimationLoopRenderer === renderer && this.appliedAnimationLoopCallback === null) {
            return;
        }

        renderer.setAnimationLoop(null);
        this.appliedAnimationLoopRenderer = renderer;
        this.appliedAnimationLoopCallback = null;
    }

    private clearModes(): void {
        console.info("[APP] Clear Application...");
        this.event.reset();
        this.removeAnimationListener();
        this.clearPhysicsFixedStepListener();
        this.disableClickEvents = false;

        // Clean up editor resources
        if (this.editor) {
            this.editor.selectionHelpers.forEach(helper => {
                this.sceneHelpers.remove(helper);
            });
            this.disableEditorEditorControls();
            this.editor.gpuPickNum = 0;
        }
        this.vrmExpressionControl.dispose();
        this.stopScheduledAnimationLoop();
        this.startScheduledAnimationLoop();
        this.disposePlayerSession("during mode cleanup");
        if (this.memoryMonitor) {
            this.memoryMonitor.dispose();
            this.memoryMonitor = null;
        }
        this.drawcallPanelManager?.dispose();
        this.drawcallPanelManager = null;
        this.ramPanelManager?.dispose();
        this.ramPanelManager = null;
    }

    async enableEditorCameraControls(mode: "edit" | "play" = this.isPlaying || this.isPaused ? "play" : "edit"): Promise<void> {
        if (!this.editor) {
            showRuntimeToast({
                type: "error",
                title: "Editor is not initialized, cannot enable controls.",
            });
            return;
        }

        const {default: ControlsManager} = await import("./controls/ControlsManager");
        this.editor.controls = new ControlsManager(this.camera, this.viewport);
        this.editor.controls.initCameraPosition();
        const controls = this.editor.controls.current?.controls;

        if (!controls) {
            console.warn("[enableEditorCameraControls] No controls found");
            return;
        }

        const appInPlayMode = mode === "play";
        const DRAG_THRESHOLD = 3; // px

        // --- Standard controls setup ---
        controls.mouseButtons = {
            LEFT: appInPlayMode ? MOUSE.ROTATE : null,
            MIDDLE: MOUSE.PAN,
            RIGHT: MOUSE.ROTATE,
        };

        controls.touches = {
            ONE: TOUCH.PAN,
            TWO: TOUCH.DOLLY_ROTATE,
        };

        // --- Selection Box helpers ---
        const createSelectionBox = () => {
            if (!controls.selectionBoxDiv) {
                controls.selectionBoxDiv = document.createElement("div");
                Object.assign(controls.selectionBoxDiv.style, {
                    position: "absolute",
                    border: "1px dashed #00f",
                    backgroundColor: "rgba(0,0,255,0.1)",
                    pointerEvents: "none",
                    width: "0px",
                    height: "0px",
                });
                document.body.appendChild(controls.selectionBoxDiv);
            }
        };

        const createSelectionLasso = () => {
            if (!controls.selectionLassoSvg) {
                controls.selectionLassoSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                controls.selectionLassoPolyline = document.createElementNS("http://www.w3.org/2000/svg", "polygon");

                Object.assign(controls.selectionLassoSvg.style, {
                    position: "fixed",
                    left: "0px",
                    top: "0px",
                    width: "100vw",
                    height: "100vh",
                    pointerEvents: "none",
                    overflow: "visible",
                    zIndex: "9999",
                    display: "none",
                });

                controls.selectionLassoSvg.setAttribute("width", "100%");
                controls.selectionLassoSvg.setAttribute("height", "100%");
                controls.selectionLassoSvg.appendChild(controls.selectionLassoPolyline);
                document.body.appendChild(controls.selectionLassoSvg);
            }

            controls.selectionLassoSvg.style.display = "block";
            controls.selectionLassoPolyline.setAttribute("fill", "rgba(251,146,60,0.12)");
            controls.selectionLassoPolyline.setAttribute("stroke", "#fb923c");
            controls.selectionLassoPolyline.setAttribute("stroke-width", "1.5");
        };

        const updateSelectionBox = () => {
            const minX = Math.min(controls.selectionStart.x, controls.selectionEnd.x);
            const minY = Math.min(controls.selectionStart.y, controls.selectionEnd.y);
            const width = Math.abs(controls.selectionEnd.x - controls.selectionStart.x);
            const height = Math.abs(controls.selectionEnd.y - controls.selectionStart.y);

            // Green window: dragging to left, Blue window: dragging to right
            const leftToRight = controls.selectionEnd.x > controls.selectionStart.x;
            controls.selectionBoxDiv.style.borderColor = leftToRight ? "#00f" : "#0f0";
            controls.selectionBoxDiv.style.backgroundColor = leftToRight ? "rgba(0,0,255,0.1)" : "rgba(0,255,0,0.1)";

            Object.assign(controls.selectionBoxDiv.style, {
                left: `${minX}px`,
                top: `${minY}px`,
                width: `${width}px`,
                height: `${height}px`,
            });
        };

        const resetSelectionBox = () => {
            if (controls.selectionBoxDiv) {
                Object.assign(controls.selectionBoxDiv.style, {
                    width: "0px",
                    height: "0px",
                    left: "0px",
                    top: "0px",
                });
            }
        };

        const updateSelectionLasso = () => {
            if (!controls.selectionLassoPolyline) {
                return;
            }

            const points = [...(controls.selectionPath || []), controls.selectionEnd]
                .map((point: Vector2) => `${point.x},${point.y}`)
                .join(" ");
            controls.selectionLassoPolyline.setAttribute("points", points);
        };

        const resetSelectionLasso = () => {
            if (controls.selectionLassoPolyline) {
                controls.selectionLassoPolyline.setAttribute("points", "");
            }

            if (controls.selectionLassoSvg) {
                controls.selectionLassoSvg.style.display = "none";
            }

            controls.selectionPath = [];
        };

        // --- Pointer events ---
        const onPointerDown = (event: PointerEvent) => {
            if (this.disableClickEvents) return;
            if (event.button !== 0 || this.isPlaying || this.isPaused) return;
            if (this.transformControls?.dragging) return;
            if (this.editor?.cadMode && this.editor.cadController?.isTransformDragging()) return;

            const isCADSelection = !!this.editor?.cadMode;
            // In object mode keep Ctrl/Cmd drag selection. In CAD edit mode allow plain drag selection.
            if (!isCADSelection && !event.ctrlKey && !event.metaKey) return;

            controls.isDraggingSelection = false;
            controls.isSelecting = true;
            controls.selectionAdditive = !!event.shiftKey;
            controls.selectionShape = isCADSelection ? this.editor?.cadSelectionShape || "box" : "box";
            controls.selectionStart = new Vector2(event.clientX, event.clientY);
            controls.selectionEnd = controls.selectionStart.clone();
            controls.selectionPath = [controls.selectionStart.clone()];
        };

        const onPointerMove = (event: PointerEvent) => {
            if (this.disableClickEvents) return;
            if (!controls.isSelecting || this.isPlaying || this.isPaused) return;
            if (this.transformControls?.dragging) return;
            if (this.editor?.cadMode && this.editor.cadController?.isTransformDragging()) return;

            const dx = event.clientX - controls.selectionStart.x;
            const dy = event.clientY - controls.selectionStart.y;

            if (!controls.isDraggingSelection && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
                controls.isDraggingSelection = true;
                if (controls.selectionShape === "lasso") {
                    createSelectionLasso();
                } else {
                    createSelectionBox();
                }
            }

            if (controls.isDraggingSelection) {
                controls.selectionEnd.set(event.clientX, event.clientY);
                if (controls.selectionShape === "lasso") {
                    const lastPoint = controls.selectionPath?.[controls.selectionPath.length - 1];
                    if (!lastPoint || lastPoint.distanceTo(controls.selectionEnd) > 4) {
                        controls.selectionPath.push(controls.selectionEnd.clone());
                    }
                    updateSelectionLasso();
                } else {
                    updateSelectionBox();
                }
                event.preventDefault();
            }
        };

        const onPointerUp = (event: PointerEvent) => {
            if (this.disableClickEvents) return;
            if (event.button !== 0 || !controls.isSelecting || this.isPlaying || this.isPaused) return;
            if (this.transformControls?.dragging) return;

            if (controls.isDraggingSelection) {
                if (this.editor?.cadMode && this.viewport) {
                    const camera = this.editor.view === "perspective" ? this.editor.camera : this.editor.orthCamera;
                    if (controls.selectionShape === "lasso") {
                        this.editor.cadController.selectInScreenLasso(
                            [...(controls.selectionPath || [controls.selectionStart]), controls.selectionEnd.clone()],
                            camera,
                            this.viewport,
                            !!controls.selectionAdditive,
                        );
                    } else {
                        this.editor.cadController.selectInScreenRectangle(
                            controls.selectionStart,
                            controls.selectionEnd,
                            camera,
                            this.viewport,
                            !!controls.selectionAdditive,
                        );
                    }
                } else {
                    this.selectObjectsInRectangle(controls.selectionStart, controls.selectionEnd);
                }
                resetSelectionBox();
                resetSelectionLasso();
            }

            controls.isSelecting = false;
            controls.isDraggingSelection = false;
            controls.selectionAdditive = false;
            controls.selectionShape = "box";
        };

        controls.domElement.addEventListener("pointerdown", onPointerDown);
        controls.domElement.addEventListener("pointermove", onPointerMove);
        controls.domElement.addEventListener("pointerup", onPointerUp);
    }

    selectObjectsInRectangle = (start: Vector2, end: Vector2) => {
        if (this.disableClickEvents) return;
        if (!this.editor || !this.editor.scene || !this.viewport) return;

        const rect = this.viewport.getBoundingClientRect();
        const found = findObjectsInRectangle({
            scene: this.editor.scene,
            camera: this.camera,
            viewport: {left: rect.left, top: rect.top, width: rect.width, height: rect.height},
            start,
            end,
            app: this,
        });

        if (found.length > 0) {
            this.editor.select(found);
        } else {
            console.debug("No objects selected.");
        }
    };

    disableEditorEditorControls(): void {
        if (!this.editor) {
            showRuntimeToast({
                type: "error",
                title: "Editor is not initialized, cannot disable controls.",
            });
            return;
        }
        this.editor.controls?.disable();
        this.editor.controls?.dispose();
        this.editor.controls = null;
    }

    // Consider adding a loading state manager
    private mask(isAuto: boolean = true): void {
        this.call("showMask", this, true, isAuto);
    }

    private unmask(): void {
        this.call("showMask", this, false);
    }

    // Logging could use a proper logging service

    private async parseGifTextures(scene: Scene) {
        const promises: Promise<void>[] = [];

        traverseObjectDepthFirst(scene, n => {
            if (n instanceof Mesh) {
                if (n.material instanceof Array) {
                    n.material.forEach(m => {
                        if (m.map && m.map.gifUrl) {
                            promises.push(
                                (async () => {
                                    m.map = await THREE_GetGifTexture(m.map.gifUrl);
                                })(),
                            );
                        }
                    });
                } else if ((n as any).material?.map?.gifUrl) {
                    promises.push(
                        (async () => {
                            (n as any).material.map = await THREE_GetGifTexture((n as any).material.map.gifUrl);
                        })(),
                    );
                }
            }
        });

        await Promise.all(promises);
    }

    private listenForSceneLoaded() {
        this.on("sceneLoaded.Application", () => {
            if (!this.editor) return;
            this.checkAndRecreateRenderer();
            console.info(
                `[APP] sceneLoaded handler: isSandbox=${this.editor.isSandbox}, isPlaying=${this.isPlaying}, mode=${this._mode}`,
            );
            if (this.editor.isSandbox && !this.isPlaying) {
                void this.setMode(ApplicationMode.SANDBOX);
            }
            const scene = this.editor.scene;
            if (scene && !findObjectByNameDepthFirst(scene, GLOBAL_BEHAVIOR_HOST)) {
                const globalHost = new Object3D();
                globalHost.name = GLOBAL_BEHAVIOR_HOST;
                scene.add(globalHost);
                this.call("objectChanged", this.editor, scene);
            }
            void this.environmentManager?.initializeFromScene();
            if (this.editor.sceneID) {
                void this.setupMultiplayerClient(this.editor.sceneID, this.scene);
            }
            this.scheduleCurrentScenePhysicsPreload("sceneLoaded");
            this.schedulePlayerSessionPreload("sceneLoaded");

            // Annotations round-trip through ObjectLoader as plain
            // Groups — rehydrate class identity so setPoints/setText/label
            // computation still works after a scene reload.
            void import("./object/annotation").then(({rehydrateAnnotations}) => {
                if (this.editor?.scene) rehydrateAnnotations(this.editor.scene);
            });

            const defaults = this.editor.getDefaultCameraData();
            this.camera.fov = defaults.cameraFOV;
            this.camera.near = defaults.cameraNear || 0.1;
            this.camera.far = defaults.cameraFar || 100000;
            this.camera.updateProjectionMatrix();

            // Validate scene light count against quality profile
            if (scene) {
                this.qualitySystem?.validateSceneLights(scene);
            }
        });

        this.on("objectChanged.Application", (_source: unknown, object: any) => {
            if (object === this.editor?.scene) {
                this.checkAndRecreateRenderer();
                this.scheduleCurrentScenePhysicsPreload("scene objectChanged");
                this.schedulePlayerSessionPreload("scene objectChanged");
            }
        });

        this.on("sceneGraphChanged.ApplicationPhysicsPreload", () => {
            this.scheduleCurrentScenePhysicsPreload("sceneGraphChanged");
            this.schedulePlayerSessionPreload("sceneGraphChanged");
        });
    }

    private configureBatchedRenderer() {
        if (this.batchedRenderer) {
            this.batchedRenderer.userData.isRuntimeOnly = true;
            this.batchedRenderer.userData.isSelectable = false;
        } else {
            console.warn("[APP] Batched Renderer is not initialized.");
        }
    }

    private async setupMultiplayerClient(sceneID: string, scene: Scene): Promise<void> {
        if (this.multiplayerClient || this.multiplayerClientSetupPromise) {
            console.warn("Multiplayer client is already initialized.");
            return;
        }

        const shouldStartCollaborativeClient =
            this.editor?.isCollaborative &&
            !this.isPlaying &&
            !this.options.isPlayModeOnly &&
            this.isCollaborativeUser !== false;

        if (!shouldStartCollaborativeClient) {
            return;
        }

        this.multiplayerClientSetupPromise = import("./multiplayer/worker/SimpleMultiplayerCollaborativeClient")
            .then(async ({default: SimpleMultiplayerCollaborativeClientClass}) => {
                if (this.multiplayerClient) {
                    return;
                }

                const multiplayerClient = new SimpleMultiplayerCollaborativeClientClass(
                    this.userId!,
                    this.editor!.maxCollaboratorsInRoom,
                    sceneID,
                    scene,
                    null,
                    null,
                    false,
                );
                this.multiplayerClient = multiplayerClient;
                await multiplayerClient.start();
            })
            .catch(error => {
                this.multiplayerClient = null;
                console.error("[APP] Failed to start collaborative multiplayer client:", error);
                showRuntimeToast({
                    type: "error",
                    title: "Unable to join collaborative session.",
                    body: "The multiplayer client failed to start. Please try reloading the scene.",
                });
            })
            .finally(() => {
                this.multiplayerClientSetupPromise = null;
            });

        await this.multiplayerClientSetupPromise;
    }

    private yieldToNextPaint(): Promise<void> {
        return yieldPlayStartToPaint();
    }

    private waitForFirstRenderedFrameAfterPaint(timeoutMs = 8000): Promise<void> {
        return new Promise<void>(resolve => {
            const eventName = "afterRender.PlayStartupFirstFrame";
            const armedAt = performance.now();
            let done = false;
            let timeoutId: ReturnType<typeof setTimeout> | null = null;
            let pollId: ReturnType<typeof setTimeout> | null = null;

            const finish = () => {
                if (done) return;
                done = true;
                if (timeoutId !== null) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                if (pollId !== null) {
                    clearTimeout(pollId);
                    pollId = null;
                }
                this.on(eventName, null);
                resolve();
            };

            this.on(eventName, () => {
                this.on(eventName, null);
                setTimeout(finish, 0);
            });

            const checkRenderedFrame = () => {
                if (this.lastRenderedFrameAt >= armedAt) {
                    finish();
                    return;
                }
                if (!done) {
                    pollId = setTimeout(checkRenderedFrame, 16);
                }
            };

            timeoutId = setTimeout(finish, timeoutMs);
            checkRenderedFrame();
        });
    }

    private waitForRestoredEditFrameAfterResume(
        resumeRender: () => void,
        timeoutMs = 8000,
    ): Promise<boolean> {
        return new Promise<boolean>(resolve => {
            const eventName = "afterRender.EditTransitionFirstFrame";
            const armedAt = performance.now();
            let done = false;
            let timeoutId: ReturnType<typeof setTimeout> | null = null;
            let pollId: ReturnType<typeof setTimeout> | null = null;

            const finish = (didRender: boolean) => {
                if (done) return;
                done = true;
                if (timeoutId !== null) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                if (pollId !== null) {
                    clearTimeout(pollId);
                    pollId = null;
                }
                this.on(eventName, null);
                if (didRender) {
                    this.call("editSceneFirstFrameReady", this, {
                        mode: ApplicationMode.EDIT,
                    });
                }
                resolve(didRender);
            };

            this.on(eventName, () => {
                this.on(eventName, null);
                // Let the successfully rendered frame reach the compositor
                // before resolving the mode transition to UI callers.
                setTimeout(() => finish(true), 0);
            });

            // The event can be missed during renderer handoff (for example if
            // a backend emits afterRender while listeners are being rewired).
            // RenderEvent publishes this monotonic marker after the GPU pass;
            // polling it closes that race without waiting for the full timeout.
            const checkRenderedFrame = () => {
                if (this.lastRenderedFrameAt >= armedAt) {
                    finish(true);
                    return;
                }
                if (!done) {
                    pollId = setTimeout(checkRenderedFrame, 16);
                }
            };

            timeoutId = setTimeout(() => finish(false), timeoutMs);
            resumeRender();
            checkRenderedFrame();
        });
    }

    private async ensureRenderableMeshNormalsForScene(scene: Scene, profilerLabel: string): Promise<void> {
        SceneLoadProfiler.begin(profilerLabel);
        try {
            const stats = await ensureRenderableMeshNormalsProgressive(scene, {
                yieldToFrame: () => this.yieldToNextPaint(),
            });
            if (stats.normalsComputed > 0 || stats.failed > 0) {
                console.debug("[Application] Normalized scene mesh normals", stats);
            }
        } finally {
            SceneLoadProfiler.end(profilerLabel);
        }
    }

    private async traverseSceneObjectsProgressively(callback: (object: Object3D) => void): Promise<void> {
        const frameBudgetMs = 8;
        const objectBatchSize = 250;
        const now = () =>
            typeof performance !== "undefined" && typeof performance.now === "function"
                ? performance.now()
                : Date.now();
        let sliceStart = now();
        let processedThisSlice = 0;
        const stack: Object3D[] = [this.scene];

        while (stack.length > 0) {
            const object = stack.pop();
            if (!object) continue;

            callback(object);

            for (let i = object.children.length - 1; i >= 0; i--) {
                const child = object.children[i];
                if (child) stack.push(child);
            }

            processedThisSlice += 1;
            if (processedThisSlice >= objectBatchSize || now() - sliceStart >= frameBudgetMs) {
                await this.yieldToNextPaint();
                processedThisSlice = 0;
                sliceStart = now();
            }
        }
    }

    private updateObjectVisibility(obj: Object3D, playerStarted: boolean) {
        // Initialize defaults if not set
        if (obj.userData.gameVisibility === undefined) {
            obj.userData.gameVisibility = obj.visible; // Default to visible in game
        }
        if (obj.userData.editorVisibility === undefined) {
            // Default editorVisibility to same as gameVisibility
            obj.userData.editorVisibility = obj.userData.gameVisibility;
        }

        if (playerStarted) {
            // Play mode: only show if gameVisibility is true
            obj.visible = obj.userData.gameVisibility;
        } else {
            // Edit mode: show if editorVisibility is true
            obj.visible = obj.userData.editorVisibility;
        }
    }
}

export default EngineRuntime;
