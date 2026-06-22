// Imports could be optimized by:
// 1. Grouping related imports together
// 2. Only importing used types from THREE
// 3. Consider splitting into smaller modules to reduce bundle size

import {createElement} from "react";
import {createRoot} from "react-dom/client";
import Stats from "stats-gl";
import {PerspectiveCamera, OrthographicCamera, Scene, Clock, Timer, Group} from "three";
import * as THREE from "three";
import {RectAreaLightTexturesLib} from "three/addons/lights/RectAreaLightTexturesLib.js";
import {TransformControls} from "three/examples/jsm/controls/TransformControls.js";
import {CSS3DRenderer} from "three/examples/jsm/renderers/CSS3DRenderer.js";
import {DirectionalLightNode, RectAreaLightNode, WebGPUBackend, WebGPURenderer} from "three/webgpu";
import {BatchedRenderer} from "three.quarks";

import {AssetType, getAsset, getAssetRevision, getSceneAssets} from "@stem/network/api/asset";
import type {
    DomainSceneDto as GetSceneResponse,
    DomainSceneMetadataDto as SceneMetadata,
} from "@stem/network/api/client/api";
import {checkIsSceneCollaborator, loadScene as apiLoadScene} from "@stem/network/api/scene";
import {migrateSceneThumbnailIfNeeded} from "@stem/network/api/scene/thumbnail";
import {getScene as getSceneV2} from "@stem/network/api/scene/v2";
import AppRuntime from "@web-shared/AppRuntime";
import {AssetInstanceManager} from "@stem/editor-oss/asset-management/AssetInstanceManager";
import {AssetLoader} from "@stem/editor-oss/asset-management/AssetLoader";
import {setAssetResolutionContext} from "@stem/editor-oss/asset-management/AssetResolutionContext";
import {BehaviorLoadingService} from "./behaviors/BehaviorLoadingService";
import GameManager from "./behaviors/game/GameManager";
import {applyCameraProjectionSettings} from "./camera/cameraSettings";
import {AnimationController} from "./controls/AnimationController";
import {AnimationGraphController} from "./controls/AnimationGraphController";
import {AudioController} from "./controls/AudioController";
import {CameraControl} from "./controls/CameraControl";
import ControlsManager from "./controls/ControlsManager";
import {VRMExpressionController} from "./controls/VRMExpressionController";
import {DeviceCapabilityDetector, QualitySystemIntegration} from "./core/quality";
import type {RuntimeContext} from "./core/RuntimeContext";
import {SceneAssetSource} from "@stem/editor-oss/asset-management/SceneAssetSource";
import type Editor from "./editor/Editor";
import type ObjectOutliner from "./editor/effects/ObjectOutliner";
import type {StemEditorMetadata} from "./editor/stem-editor/saveStemEditor";
import EventDispatcher from "@stem/editor-oss/event/EventDispatcher";
import global from "./global";
import Helpers from "@stem/editor-oss/helper/Helpers";
import i18n from "@stem/editor-oss/i18n/config";
import {ExtendedDirectionalLight} from "@stem/editor-oss/light/ExtendedDirectionalLight";
import SimpleMultiplayerCollaborativeClient from "./multiplayer/worker/SimpleMultiplayerCollaborativeClient";
import PackageManager from "./package/PackageManager";
import {IPhysics, PhysicsEngineType} from "./physics/common/types";
import {preloadPhysics} from "./physics/preloadPhysics";
import {GAME_GRAVITY_DEFAULT} from "./constants/game";
import AiWorldControl from "@web-shared/player/component/AiWorldControl";
import PlayerAudio from "@web-shared/player/component/PlayerAudio";
import PlayerEvent from "@web-shared/player/component/PlayerEvent";
import PlayerLoadMask from "@web-shared/player/component/PlayerLoadMask";
import PlayerPhysics2 from "@web-shared/player/component/PlayerPhysics2";
import WebVR from "@web-shared/player/component/WebVR";
import {PlayerSession} from "@web-shared/player/PlayerSession";
import {PlaymodeDebugCamera} from "./playmode-inspector/PlaymodeDebugCamera";
import {capturePlaymodeSnapshot, PlaymodeSnapshot, restorePlaymodeSnapshot} from "./playmode-inspector/playmodeSnapshot";
import {deserializePrefab} from "@stem/editor-oss/prefab/serialization";
import {setPrefabId, unlockPrefab} from "@stem/editor-oss/prefab/util";
import {ensureRenderableMeshNormals} from "./render/ensureRenderableMeshNormals";
import type EffectRenderer from "./render/EffectRenderer";
import {findSceneHelpersRoot, getOrCreateDynamicRoot, getOrCreateSceneHelpersRoot} from "@stem/editor-oss/scene/dynamicRoots";
import {SceneConfig} from "@stem/editor-oss/scene/SceneConfig";
import {loadScene} from "@stem/editor-oss/scene/util";
import {createSchedulerFromConfig} from "./scheduler";
import type {FrameOrchestrator} from "./scheduler";
import Converter from "./serialization/Converter.js";
import {showToast} from "@stem/editor-oss/showToast";
import ApplicationAuthStore from "./userManagement/editorProfile/ApplicationAuthStore";
import {DetectDevice} from "./utils/DetectDevice";
import type {DrawcallPanelManager} from "./utils/DrawcallPanelManager";
import type EnvironmentSettingsManager from "./utils/EnvironmentSettingsManager";
import {THREE_GetGifTexture} from "./utils/GifTexture";
import {LoadingManager, LoadingMessages} from "./utils/LoadingManager";
import {MemoryMonitor} from "./utils/MemoryMonitor";
import MeshUtils, {patchMesh} from "./utils/MeshUtils";
import type {RamPanelManager} from "./utils/RamPanelManager";
import {SceneLoadProfiler} from "./utils/SceneLoadProfiler";
import {findObjectsInRectangle} from "./utils/SelectionUtils";
import Storage from "./utils/Storage";
import {getViewportSafeArea, type ViewportSafeArea} from "./utils/viewportSafeArea";

// TODO: Move RectAreaLightTexturesLib initialization to appropriate place
RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());

const {t} = i18n;

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
export type {ViewportSafeArea} from "./utils/viewportSafeArea";

// Application have a lot of responsibilities, which can lead to high complexity and low maintainability.
// Consider splitting responsibilities to different classes or modules (e.g., SceneManager, ModeManager, etc.)
export class EngineRuntime extends AppRuntime implements RuntimeContext {
    static isSandboxViewer() {
        return window.location.pathname.indexOf("/sandbox/") !== -1;
    }

    private viewportSafeAreaElements = new Map<string, HTMLElement>();

    // Make sure that we have clear interfaces instead of using field directly to assign values
    // This will help reduce complexity and improve maintainability

    // Consider making some of these properties private/protected
    // Add type annotations for better type safety

    private _mode: ApplicationMode = ApplicationMode.IDLE;
    get mode(): ApplicationMode {
        return this._mode;
    }

    viewport: HTMLElement | undefined;
    width: number;
    height: number;
    storage: Storage;
    debug: boolean;
    packageManager: PackageManager;
    require: any; // Type 'any' should be avoided
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

    //Three.js related properties
    converter = new (Converter as any)();
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
    rendererCSS: CSS3DRenderer = new CSS3DRenderer();
    renderer: WebGPURenderer = this.createWebGPURenderer();
    effectRenderer: EffectRenderer | null = null;
    batchedRenderer = new BatchedRenderer();
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
            return;
        }
        this.viewportSafeAreaElements.delete(id);
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

    private clock = new THREE.Clock(false);
    private frameTimer = new Timer();
    private delta = 0;
    private interval = 1 / 60;
    private scheduledFrameSeq = 0;
    private lastScheduledFrameTs: number | null = null;
    private legacyAnimationLoopCallback: (() => void) | null = null;
    private scheduledRenderCallback: ((clock: Clock, deltaTime: number) => void) | null = null;

    private qualitySystem: QualitySystemIntegration | null = null;
    private frameOrchestrator: FrameOrchestrator | null = null;
    public environmentManager: EnvironmentSettingsManager | null = null;
    public loadingManager: LoadingManager;

    // Promise chain that ensures calls to setMode are executed in order
    private setModePromise = Promise.resolve();
    private _rendererInitPromise: Promise<void> | null = null;
    private _recreateRendererPromise: Promise<void> | null = null;
    private _lastForceWebGLSetting: boolean | undefined;
    private _forceWebGLFallback = false;

    get isWebGLFallback(): boolean {
        return this._forceWebGLFallback;
    }

    constructor(container: HTMLElement, options: any) {
        super(container, options);

        global.app = this;
        global.three$1 = THREE;
        // TEMP debug: mirror the engine onto window so it can be inspected from
        // the browser console (`global` is a module export, not window.app).
        // Lets us read e.g. `app.scene.userData._matchStarted`. Remove later.
        (window as unknown as {app?: unknown}).app = this;

        this.viewport = undefined;
        this.width = this.container.clientWidth;
        this.height = this.container.clientHeight;

        this.scene.name = "AppScene";
        getOrCreateDynamicRoot(this.scene);

        this.storage = new Storage();
        this.debug = (!!this.storage.get("debug") && !this.options.isPlayModeOnly) || false;

        this.packageManager = new PackageManager();
        this.require = this.packageManager.require.bind(this.packageManager);

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
                const webgpuRenderer = this.createWebGPURenderer();
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
                    const fallbackRenderer = this.createWebGPURenderer(true);
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
                    showToast({type: "info", title: "WebGPU unavailable, using WebGL fallback."});

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
                    showToast({
                        body: i18n.t("app.renderer.initFailed") || "Renderer initialization failed. Please reload the page.",
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
        console.info("[APP] Starting Application...");
        this.viewport = viewport;

        const width = this.viewport?.clientWidth;
        const height = this.viewport?.clientHeight;

        if (width && height) {
            this.orthCamera = new THREE.OrthographicCamera(-width / 4, width / 4, height / 4, -height / 4, 0.1, 512);
            // Ensure perspective camera aspect matches current viewport (previously used window inner sizes at construction)
            if (this.camera) {
                const newAspect = width / height;
                if (Math.abs(this.camera.aspect - newAspect) > 0.0001) {
                    this.camera.aspect = newAspect;
                    this.camera.updateProjectionMatrix();
                }
            }
        }

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

        this.renderer = this.createWebGPURenderer();
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
            this.helpers = new Helpers();
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

                const fallbackRenderer = this.createWebGPURenderer(true);
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
                showToast({type: "info", title: "WebGPU unavailable, using WebGL fallback."});
            } catch (fallbackErr) {
                console.error("[APP] WebGL fallback also failed:", fallbackErr);
                showToast({type: "error", title: "Failed to initialize WebGPU renderer."});
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

        // Basic debug info to help diagnose blank screen issues
        const winDebug = window as unknown as {DEBUG_APP_RENDER?: boolean};
        if (winDebug.DEBUG_APP_RENDER === undefined) {
            winDebug.DEBUG_APP_RENDER = true;
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

    stop(): void {
        console.info("[APP] Stopping Application...");
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
            this.scene.traverse(object => {
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
        this.editor?.stop();
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
    async setMode(mode: ApplicationMode) {
        this.setModePromise = this.setModePromise.then(async () => {
            if (this._mode === mode) {
                console.warn(`[APP] Cannot change to the same application mode: ${mode as any}`);
                return;
            }

            const previousMode = this._mode;
            this._mode = mode;

            console.info(`[APP] Changing application mode from ${previousMode} to ${mode as any}`);

            try {
                await this.exitMode(previousMode);
            } catch (error) {
                console.error(`[APP] Failed to exit mode ${previousMode}:`, error);
                return;
            }

            try {
                await this.enterMode(mode);
            } catch (error) {
                console.error(`[APP] Failed to enter mode ${mode}:`, error);
                return;
            }
        });

        return this.setModePromise;
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
                this.memoryMonitor = new MemoryMonitor(this.renderer as unknown as THREE.WebGLRenderer);
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
        console.info("[APP] Animation Loop Started");
        this.delta = 0;
        this.on("animate.Application", this.animate.bind(this));
        this.resumePlayer();
    }

    stopAnimationLoop() {
        console.info("[APP] Animation Loop Stopped");
        //this.renderer?.setAnimationLoop(null);
        this.removeAnimationListener();
        this.pausePlayer();
    }

    // TODO: its not clear why addPhysicsObject and removePhysicsObject are also adding/removing objects from the scene
    // rename or refactor these methods to clarify their purpose
    addPhysicsObject(object: THREE.Object3D) {
        this.scene.add(object);
        void this.physics?.addObject(object);
    }

    removePhysicsObject(object: THREE.Object3D) {
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
        const payloadUrl = this.assetLoader.getRevisionUrl(scene.asset.id, revision.id) ?? revision.dataUrl;
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
                showToast({
                    type: "error",
                    title: "Collaborative Mode Access Denied",
                    body: "You do not have permission to join this collaborative session. Please contact the scene owner for access.",
                });

                return Promise.reject(new Error("User is not a collaborator for this scene."));
            }
        } catch (error) {
            console.error("Error checking collaborator status:", error);
            showToast({
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
        if (this._rendererInitPromise) {
            await this._rendererInitPromise;
        }

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
            if (this.options.isPlayModeOnly) {
                SceneLoadProfiler.begin("physicsPreload");
                const {engine, gravity} = Converter.getPhysicsSettings(sceneData?.data);
                preloadPhysics(
                    (engine as PhysicsEngineType | undefined) ?? PhysicsEngineType.Ammo,
                    Number(gravity ?? GAME_GRAVITY_DEFAULT),
                );
                SceneLoadProfiler.end("physicsPreload");
            }

            this.loadingManager.nextStage(LoadingMessages.CREATING_OBJECTS);
            SceneLoadProfiler.begin("loadScene");
            const sceneObject = await loadScene({
                server: this.options.server,
                camera: this.camera,
                domWidth: this.renderer.domElement.width,
                domHeight: this.renderer.domElement.height,
                assetLoader: this.assetLoader ?? undefined,
                sceneData,
            });
            SceneLoadProfiler.end("loadScene");

            if (!sceneObject?.scene) {
                showToast({
                    type: "error",
                    title: "Failed to load scene object.",
                });
                throw new Error("Failed to load scene object.");
            }

            ensureRenderableMeshNormals(sceneObject.scene);

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

            ensureRenderableMeshNormals(this.scene);
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

        if (!editor.sceneID) {
            throw new Error("[setUpLocalScene] Scene ID is not set.");
        }

        editor.assetSource = new SceneAssetSource(editor.sceneID);
        ensureRenderableMeshNormals(this.scene);
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
            this.scene.fog = new THREE.Fog(color, near, far);
        } else if (type === "exp" && density !== undefined) {
            this.scene.fog = new THREE.FogExp2(color, density);
        }
    }

    private async exitMode(mode: ApplicationMode) {
        console.info(`[APP][TRACE] exitMode start: ${mode}`);
        switch (mode) {
            case ApplicationMode.EDIT:
                this.stopEditMode();
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

    private createWebGPURenderer(overrideForceWebGL?: boolean): WebGPURenderer {
        const forceWebGL = !true;
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

        if (!renderer.library.lightNodes.has(ExtendedDirectionalLight)) {
            renderer.library.addLight(DirectionalLightNode, ExtendedDirectionalLight);
        }
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

                //

                this.set(pipeline, {
                    programGPU,
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

        this.editor?.start();

        this.editor.selectionHelpers.forEach(helper => {
            this.sceneHelpers.add(helper);
        });
        this.editor.gpuPickNum = this.storage.hoverEnabled ? 1 : 0;

        this.enableEditorCameraControls("edit");
        this.editor.component?.showUI();
        this.call("resize", this);
        await this.environmentManager?.applyEnvironmentSettings();
        this.editor?.controls?.loadCamera();
    }

    private stopEditMode(): void {
        if (!this.editor) {
            console.error("[APP] Editor is not initialized, cannot stop edit mode.");
            return;
        }

        this.editor.stop();
        this.clearModes();
    }

    private async startPlayMode(): Promise<void> {
        // this.setShowGrid(false);

        const isSandbox = !!this.editor?.isSandbox;
        if (!isSandbox && !this.options.isPlayModeOnly) {
            await this.multiplayerClient?.terminate();
            this.multiplayerClient = null;
        }
        this.playerSession = new PlayerSession(this);

        try {
            // Launch-time quality setup: device profile + optional scene preset.
            // This runs once during player init (no adaptive runtime quality).
            await this.qualitySystem?.initialize(this);
            const launchSettings = await this.qualitySystem?.preparePlayerLaunchQuality(
                this.editor?.scene?.userData,
            );
            const schedulerEnabled = !!launchSettings?.scheduler?.enabled;
            if (launchSettings) {
                this.physics?.configureQuality(
                    launchSettings.physics.updateRate,
                    launchSettings.physics.substeps,
                    launchSettings.scheduler.maxFixedStepsPerFrame,
                    schedulerEnabled,
                );
            }

            await this.startPlayer();

            // Re-wire quality modules to the fresh runtime instances created
            // by startPlayer (fixes stale refs on play → stop → play cycles).
            this.qualitySystem?.rewireModules(this);

            // Runtime objects now exist, push selected launch settings to scheduler/lambda systems.
            this.qualitySystem?.syncRuntimeSettings();

            // Create FrameOrchestrator if quality settings enable the scheduler
            const selectedSettings = launchSettings ?? this.qualitySystem?.getQualityManager().getCurrentSettings();
            const schedulerConfig = selectedSettings?.scheduler;
            if (schedulerConfig?.enabled) {
                const fixedHz = selectedSettings?.physics.updateRate ?? schedulerConfig.fixedTimestepHz;
                const behaviorUpdateMode =
                    this.editor?.scene?.userData?.scheduler?.behaviorUpdateMode === "fixed" ? "fixed" : "variable";

                const bundle = createSchedulerFromConfig(
                    this,
                    {
                        ...schedulerConfig,
                        fixedTimestepHz: fixedHz,
                    },
                    {
                        enableFixedRateUpdates: behaviorUpdateMode === "fixed",
                        scheduleRender: true,
                    },
                );
                this.frameOrchestrator = bundle.orchestrator;
                // Deferred spatial-grid wiring (lambdaManager may not be ready yet at factory time)
                if (this.game?.lambdaManager?.scheduler) {
                    this.game.lambdaManager.scheduler.setSpatialGrid(bundle.spatialGrid);
                }
                this.stopScheduledAnimationLoop();
                this.startScheduledAnimationLoop();
            } else {
                // When isPlayModeOnly, appStart() skipped startScheduledAnimationLoop() to
                // avoid wasting CPU rendering invisible frames during scene load. Start it now.
                if (this.options.isPlayModeOnly) {
                    this.startScheduledAnimationLoop();
                }
            }

            this.call("resize", this);
            this.editor?.component?.hideUI();
            this.unmask();
        } catch (error) {
            await this.stopPlayer();
            console.error("There was an error starting the player", error);
            throw error;
        }
    }

    private async stopPlayMode() {
        await this.stopPlayer();
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
        this.editor?.start();
        await this.startPlayMode(); // TODO: should be different from play mode
    }

    private async stopSandboxMode() {
        this.editor?.stop();
        await this.stopPlayer();
        this.clearModes();
    }

    private initCamera(): void {
        this.camera.name = t("DefaultCamera");
        this.camera.userData.cameraData = this.editor?.getDefaultCameraData();
        // Cameras should never cast or receive shadows
        this.camera.castShadow = false;
        this.camera.receiveShadow = false;
        this.orthCamera.castShadow = false;
        this.orthCamera.receiveShadow = false;
    }

    private initAnimationLoop(isFirst = true) {
        if (isFirst) {
            this.startAnimationLoop();
        }

        requestAnimationFrame(() => {
            const deltaTime = this.clock.getDelta();
            this.delta += deltaTime;
            if (this.delta > this.interval) {
                this.stopAnimationLoop();
            } else {
                this.initAnimationLoop(false);
            }
        });
    }

    private removeAnimationListener(): void {
        this.on("animate.Application", null);
    }

    private async startPlayer(): Promise<void> {
        // Snapshot pre-play state so the inspector can revert mutations on stop.
        // Captured before any play-time side effect runs.
        if (this.editor) {
            try {
                this.playmodeSnapshot = capturePlaymodeSnapshot(this.scene);
            } catch (err) {
                console.warn("[Playmode Inspector] Failed to capture snapshot", err);
                this.playmodeSnapshot = null;
            }
        }

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
        this.playerMask.show();
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

        // Backstop preload: covers paths that didn't go through setUpScene
        // (e.g. play mode entered without a fresh scene load). When worker mode
        // applies and a preload already happened, this is a no-op (the worker
        // is stashed and will be adopted by `PhysicsProxy.start()`).
        const physicsEngine = this.scene.userData?.physics?.engine as PhysicsEngineType | undefined;
        const gravity =
            this.scene.userData?.physics?.gravity ?? this.scene.userData?.game?.gravity ?? GAME_GRAVITY_DEFAULT;
        preloadPhysics(physicsEngine ?? PhysicsEngineType.Ammo, Number(gravity));

        this.scene.traverse(obj => {
            this.updateObjectVisibility(obj, true);
        });

        const savedFog = this.scene.userData.savedFog;

        if (!this.scene.fog && !!savedFog) {
            if (savedFog.type === "linear") {
                this.scene.fog = new THREE.Fog(savedFog.color, savedFog.near, savedFog.far);
            } else if (savedFog.type === "exp") {
                this.scene.fog = new THREE.FogExp2(savedFog.color, savedFog.density);
            }
        }

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
            SceneLoadProfiler.begin("physicsCreate");
            physics = await this.physics.create(
                this.editor!.sceneID!,
                this.scene,
                isMultiplayer,
                maxMultiplayerClientsPerRoom,
            );
            SceneLoadProfiler.end("physicsCreate");
        } catch (err) {
            console.error("Physics failed to start", err);
            throw err;
        }

        this.call("init", this);
        applyCameraProjectionSettings(this.camera, CameraControl.getCameraOptions(this.camera));
        this.loadingManager.nextStage(LoadingMessages.LOADING_ASSETS);

        try {
            SceneLoadProfiler.begin("playerSystemsCreate");
            const promise1 = this.playerEvent?.create(this.scene, this.camera, this.renderer, this.scripts);
            //const promise2 = this.control?.create(physics, this.scene, this.camera, this.renderer, this);
            const promise3 = this.audio?.create(this.scene, this.camera, this.renderer);
            //let promise7 = this.webvr.create(this.scene, this.camera, this.renderer);
            await Promise.all([promise1, promise3]);
            SceneLoadProfiler.end("playerSystemsCreate");
        } catch (err) {
            console.error("Player failed to start", err);
            throw err;
        }

        try {
            SceneLoadProfiler.begin("aiWorldControlCreate");
            await this.aiWorldControl?.create(this.scene, this.camera, this.renderer, this.editor?.sceneID, this);
            SceneLoadProfiler.end("aiWorldControlCreate");
        } catch (err) {
            console.error("AiWorldControl failed to start", err);
            throw err;
        }

        this.isPlaying = true;

        try {
            SceneLoadProfiler.begin("gameCreate");
            await this.game.create(
                physics,
                this.physics,
                this.physics.multiplayerState!,
                this,
                this.animationControl!,
                this.animationGraphControl!,
                this.audioControl!,
                useInstancing,
                isMultiplayer,
                this.animations,
            );
            SceneLoadProfiler.end("gameCreate");

            // Pre-compile all material render pipelines now that the scene is
            // fully built (behaviors have created their geometry/materials in
            // init), but before the animation loop starts. Without this, each
            // unique material compiles its WGSL/GLSL pipeline lazily the first
            // frame it is rendered — so a game with many distinct materials
            // (e.g. tinyskies' globe villages / landmarks / monuments) streams
            // shader compiles in as the camera reveals new objects mid-play,
            // producing periodic main-thread stalls ("jank every few frames").
            // compileAsync folds that one-time cost into the play-start load
            // (covered by the loading overlay) instead. Best-effort; a compile
            // failure must never block entering play.
            try {
                const r = this.renderer as unknown as {
                    hasInitialized?: () => boolean;
                    compileAsync?: (scene: unknown, camera: unknown) => Promise<unknown>;
                };
                if (this.scene && this.camera && r?.compileAsync && (r.hasInitialized?.() ?? true)) {
                    SceneLoadProfiler.begin("precompileShaders");
                    await r.compileAsync(this.scene, this.camera);
                    SceneLoadProfiler.end("precompileShaders");
                }
            } catch (e) {
                console.warn("[Application] shader pre-compile failed (non-fatal):", e);
            }

            this.playerEvent?.init();
            this.clock.start();
            this.playerEvent?.start();
            this.animationControl?.start(this.game);
            this.animationGraphControl?.start(this.game);
            this.audioControl?.start(this.game);
            this.vrmExpressionControl?.start(this.game);
            this.initAnimationLoop();
            void this.showStats();
            this.showMemoryStats();

            this.call("playerStarted", null);
            console.debug("Player Started");

            console.debug("🎮 [Application] Creating HUD...");

            this.game.hud?.create(!this.game.isEnabled || !this.game.scene);

            console.debug("🎮 [Application] Setting up camera options...");
            const cameraOptions = CameraControl.getCameraOptions(this.camera);
            this.disableClickEvents = !!cameraOptions?.usePointerLock || !isSandbox;

            console.debug("🎮 [Application] Handling HUD visibility...");
            if (this.editor?.showHUD) {
                this.playerMask.hide();
            }

            // Hold the loading overlay until the first frame has actually
            // rendered. That first render is where any not-yet-warmed material
            // pipelines compile (a multi-second block on material-heavy scenes).
            // Completing loading before it dismisses the overlay onto a frozen
            // game canvas; waiting two animation frames keeps the loading screen
            // up across the compile so the hand-off reads as "loading" rather
            // than a hang. Bounded so a stalled rAF can never wedge startup.
            await new Promise<void>(resolve => {
                if (typeof requestAnimationFrame !== "function") {
                    resolve();
                    return;
                }
                let done = false;
                const finish = () => {
                    if (done) return;
                    done = true;
                    resolve();
                };
                requestAnimationFrame(() => requestAnimationFrame(finish));
                setTimeout(finish, 8000);
            });

            this.loadingManager.completeLoading();
            console.debug("🎮 [Application] ✅ startPlayer completed successfully");
        } catch (err: any) {
            console.error("❌ [Application] startPlayer failed at:", err?.message || err);
            console.error("❌ [Application] Full error:", err);
            throw err;
        }
    }

    async stopPlayer() {
        if (!this.isPlaying && !this.isPaused) {
            return;
        }

        try {
            this.effectRenderer?.showOriginalMeshes();
        } catch (err) {
            console.warn("[BatchManager] Failed to restore original meshes during play teardown", err);
        }

        // Flip runtime flags immediately so edit/remix interaction is not blocked
        // by stale play-state checks while async teardown is still running.
        this.isPlaying = false;
        this.isPaused = false;

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
                        object.traverse(child => {
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

        this.scene.traverse(obj => {
            this.updateObjectVisibility(obj, false);
        });

        this.setUpFog();

        this.playerMask.show();

        if (this.editor?.isSandbox === false) {
            if (restoredInMemory) {
                this.call("sceneGraphChanged", this.editor);
            } else {
                this.editor.reverseTraverseSceneObjects(object => {
                    this.editor!.removeObject(object);

                    MeshUtils.dispose(object);
                });

                await this.restoreSceneState();

                this.editor.traverseSceneObjects(object => {
                    this.call("objectAdded", this.editor, object);
                });
            }
        }

        this.effectRenderer?.initializeBatchManager?.(this.scene);

        this.playerMask.hide();

        //global.app.setAutoSave(this.autoSaveState);
        // NOTE: game.reset() tears down the HUD DOM root via `this.hud?.clear()`,
        // so the `hud-view-container` created in startPlayer is removed here.
        this.game?.reset();

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
        this.clock.stop();
        this.frameTimer.reset();
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
                showToast({
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
                // Re-create AssetLoader for the scene restore
                const [, sceneData] = await Promise.all([this.seedAssetLoader(sceneID), apiLoadScene(sceneID)]);

                const result = await loadScene({
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
                    ensureRenderableMeshNormals(result.scene);
                    await this.editor?.setScene(result.scene, true);
                    this.call("sceneGraphChanged", this);
                    console.info("[APP][TRACE] emitting restartRenderer from restoreSceneState");
                    this.call("restartRenderer", this);
                    this.call("sceneLoaded", this);
                }
            } catch (error) {
                console.error("Failed to restore scene state:", error);
                showToast({
                    type: "error",
                    title: "Failed to restore scene state.",
                });
            }
        }
    }

    private animate(clock: Clock, deltaTime: number): void {
        if (!this.isPlaying) {
            return;
        }

        if (this.frameOrchestrator) {
            // Pipeline-stage path: orchestrator drives quality, physics, behaviors,
            // lambdas, animation, animation graph, audio, AI world, picker, and playerEvent
            // via registered adapters.
            try {
                this.frameOrchestrator.tick(deltaTime);
            } catch (error) {
                console.warn("[APP] Handled exception in FrameOrchestrator.tick(); skipping this frame tick.", error);
            }
            // this.vrmExpressionControl?.update(clock, deltaTime);
            // this.webvr?.update();
        } else {
            // Legacy sequential path (scheduler disabled in quality settings)
            this.aiWorldControl?.update(clock, deltaTime);
            this.animationControl?.update();
            this.animationGraphControl?.update(clock, deltaTime);
            this.audioControl?.update();
            // this.vrmExpressionControl?.update(clock, deltaTime);
            this.physics?.update(deltaTime);
            // this.webvr?.update();
            this.game?.update(clock, deltaTime);
            this.playerEvent?.update(clock, deltaTime);
        }
        this.delta = this.delta % this.interval;
    }

    shouldScheduleFrameRendering(): boolean {
        return this.frameOrchestrator?.isRenderSchedulingEnabled() ?? false;
    }

    scheduleFrameRendering(renderFrame: () => void): void {
        if (this.frameOrchestrator) {
            this.frameOrchestrator.scheduleRender(renderFrame);
            return;
        }
        renderFrame();
    }

    setLegacyAnimationLoopCallback(animationCallback: (() => void) | null): void {
        this.legacyAnimationLoopCallback = animationCallback;
    }

    setScheduledRenderCallback(renderCallback: ((clock: Clock, deltaTime: number) => void) | null): void {
        this.scheduledRenderCallback = renderCallback;
    }

    runScheduledRender(clock: Clock, deltaTime: number): void {
        this.scheduledRenderCallback?.(clock, deltaTime);
    }

    private dispatchScheduledAnimationFrame = (): void => {
        const frameNow = performance.now();
        this.frameTimer.update();
        const deltaTime = this.frameTimer.getDelta();
        const frameGapMs =
            this.lastScheduledFrameTs === null ? null : Math.max(0, frameNow - this.lastScheduledFrameTs);
        this.lastScheduledFrameTs = frameNow;
        this.scheduledFrameSeq++;

        const shouldTraceReplay = Boolean((globalThis as any).__TRACE_FRAME_REPLAY__);
        if (shouldTraceReplay) {
            console.debug("[ReplayTrace][ApplicationFrame]", {
                frame: this.scheduledFrameSeq,
                deltaTimeMs: deltaTime * 1000,
                frameGapMs,
                isPlaying: this.isPlaying,
                hasScheduler: !!this.frameOrchestrator,
                scheduleRender: this.shouldScheduleFrameRendering(),
            });

            if (frameGapMs !== null && frameGapMs < 4) {
                console.warn(
                    "[ReplayTrace][ApplicationFrame] Suspiciously short frame gap; possible duplicate animation loop dispatch.",
                    {frame: this.scheduledFrameSeq, frameGapMs, deltaTimeMs: deltaTime * 1000},
                );
            }
        }
        this.call("animate", this, this.clock, deltaTime);
    };

    startScheduledAnimationLoop(): void {
        if (this.frameOrchestrator?.isRenderSchedulingEnabled()) {
            void this.renderer.setAnimationLoop(null);
            this.frameTimer.reset();
            this.lastScheduledFrameTs = null;
            this.scheduledFrameSeq = 0;
            this.frameOrchestrator.startAnimationLoop(this.dispatchScheduledAnimationFrame);
            return;
        }
        void this.renderer.setAnimationLoop(this.legacyAnimationLoopCallback);
    }

    stopScheduledAnimationLoop(): void {
        if (this.frameOrchestrator?.isRenderSchedulingEnabled()) {
            this.frameOrchestrator.stopAnimationLoop();
        }
        void this.renderer.setAnimationLoop(null);
    }

    private clearModes(): void {
        console.info("[APP] Clear Application...");
        this.event.reset();
        this.removeAnimationListener();
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
        this.frameOrchestrator?.dispose();
        this.frameOrchestrator = null;
        this.startScheduledAnimationLoop();
        this.playerSession?.dispose();
        this.playerSession = null;
        if (this.memoryMonitor) {
            this.memoryMonitor.dispose();
            this.memoryMonitor = null;
        }
    }

    enableEditorCameraControls(mode: "edit" | "play" = this.isPlaying || this.isPaused ? "play" : "edit"): void {
        if (!this.editor) {
            showToast({
                type: "error",
                title: "Editor is not initialized, cannot enable controls.",
            });
            return;
        }

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
            LEFT: appInPlayMode ? THREE.MOUSE.ROTATE : null,
            MIDDLE: THREE.MOUSE.PAN,
            RIGHT: THREE.MOUSE.ROTATE,
        };

        controls.touches = {
            ONE: THREE.TOUCH.PAN,
            TWO: THREE.TOUCH.DOLLY_ROTATE,
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
                .map((point: THREE.Vector2) => `${point.x},${point.y}`)
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
            controls.selectionStart = new THREE.Vector2(event.clientX, event.clientY);
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

    selectObjectsInRectangle = (start: THREE.Vector2, end: THREE.Vector2) => {
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
            showToast({
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

    private async parseGifTextures(scene: THREE.Scene) {
        const promises: Promise<void>[] = [];

        scene.traverse(n => {
            if (n instanceof THREE.Mesh) {
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
            if (scene && !scene.getObjectByName(GLOBAL_BEHAVIOR_HOST)) {
                const globalHost = new THREE.Object3D();
                globalHost.name = GLOBAL_BEHAVIOR_HOST;
                scene.add(globalHost);
                this.call("objectChanged", this.editor, scene);
            }
            void this.environmentManager?.initializeFromScene();
            if (this.editor.sceneID) {
                this.setupMultiplayerClient(this.editor.sceneID, this.scene);
            }

            // Annotations round-trip through THREE.ObjectLoader as plain
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
            }
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

    // DO NOT DELETE - usefull for testing Discord integration
    /*private async redirectToGameForDiscord() {
        if (window.location.pathname.indexOf("/play/") === -1) {
            try {
                const clientId = window.location.host.split(".")[0];
                // getSceneIDByClientID may be provided elsewhere; provide runtime guard
                const sceneID =
                    typeof (window as any).getSceneIDByClientID === "function"
                        ? await (window as any).getSceneIDByClientID(clientId)
                        : undefined;
                if (sceneID) {
                    const url = new URL(window.location.href);
                    url.pathname = `/play/${sceneID}/`;

                    window.location.href = url.toString();
                } else {
                    console.error("[APP] Scene ID not found for Discord integration.");
                }
            } catch (error) {
                console.error("[APP] Error redirecting to game for Discord integration:", error);
                showToast({
                    type: "error",
                    title: "Failed to redirect to game for Discord integration.",
                });
            }
        }
    }*/
    private setupMultiplayerClient(sceneID: string, scene: Scene) {
        if (this.multiplayerClient) {
            console.warn("Multiplayer client is already initialized.");
            return;
        }

        if (
            this.editor?.isCollaborative &&
            !this.isPlaying &&
            !this.options.isPlayModeOnly &&
            this.isCollaborativeUser !== false
        ) {
            this.multiplayerClient = new SimpleMultiplayerCollaborativeClient(
                this.userId!,
                this.editor.maxCollaboratorsInRoom,
                sceneID,
                scene,
                null,
                null,
                false,
            );
            void this.multiplayerClient.start();
        }
    }

    private updateObjectVisibility(obj: THREE.Object3D, playerStarted: boolean) {
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
