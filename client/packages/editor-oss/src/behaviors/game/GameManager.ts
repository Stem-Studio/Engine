import {initGlyphNodeMaterials, initNodeMaterials, setDefaultRenderOrder} from "@ni2khanna/uikit";
import {Object3D} from "three";
import * as THREE from "three";
import {WebGPURenderer} from "three/webgpu";
import {ParticleEmitter, QuarksUtil} from "three.quarks";

import {AssetType, getAssetRevisionData} from "@stem/network/api/asset";
import {getImportRevisionMapFromScriptBundle, getLambdasFromScriptBundle} from "@stem/network/api/behavior";
import {updatePlayCount} from "@stem/network/api/getGames";
import {getLambdaRevisionData, getLambdasFromAssets, getLambdasListForScene} from "@stem/network/api/lambda";
import {emitRewardEvent, REWARD_EVENT_TYPES} from "@stem/network/api/rewards";
import {getDefaultUserAvatarModel} from "@stem/network/api/avatarCreator";
import ModelLoader from "../../assets/js/loaders/ModelLoader";
import {composeUserAvatar} from "../packs/character/runtime/composeUserAvatar";
import EngineRuntime from "@stem/editor-oss/EngineRuntime";
import {AssetRef, assetRefKey} from "@stem/editor-oss/asset-management/AssetRef";
import {
    emptyAssetResolutionContext,
    getAssetResolutionContext,
    mergeAssetResolutionContexts,
    resolveAssetRevisionId,
} from "@stem/editor-oss/asset-management/AssetResolutionContext";
import {applyCameraProjectionSettings} from "../../camera/cameraSettings";
import {RenderOrder} from "../../constants/RenderOrder";
import AiWorldController from "../../controls/AiWorldController/AiWorldController";
import {AnimationController, BlendedAnimationParams} from "../../controls/AnimationController";
import {AnimationGraphController} from "../../controls/AnimationGraphController";
import {AudioController} from "../../controls/AudioController";
import {CameraControl, ICameraControl} from "../../controls/CameraControl";
import {PlayerActions} from "../../controls/input/ActionTypes";
import {defaultBindings} from "../../controls/input/DefaultBindings";
import {InputManager} from "../../controls/input/InputManager";
import {PointerEventManager} from "../../controls/input/PointerEventManager";
import type {RuntimeContext} from "../../core/RuntimeContext";
import {
    configurePlotBudgetManagerFromEngine,
    PlotBudgetManager,
} from "../../core/budget/PlotBudgetPolicy";
import {
    configureTextureResidencyManagerFromEngine,
    TextureResidencyManager,
} from "../../core/budget/TextureResidencyPolicy";
import {
    configureRuntimeBudgetCoordinatorFromEngine,
    RuntimeBudgetCoordinator,
} from "../../core/budget/RuntimeBudgetCoordinator";
import type {AssetSource} from "@stem/editor-oss/asset-management/SceneAssetSource";
import {PhysicsConfig} from "../../physics/common/physicsConfig";
import {getRemoteDocStore} from "../../data";
import type {LambdaComponentData, LambdaConfig} from "../../lambdas/Lambda";
import {LambdaFileLoader} from "../../lambdas/LambdaFileLoader";
import {LambdaManager} from "../../lambdas/LambdaManager";
import LambdaScriptInjector from "../../lambdas/LambdaScriptInjector";
import {ICollisionSource, IPhysics} from "../../physics/common/types";
import {PhysicsUtil} from "../../physics/PhysicsUtil";
import {MultiplayerUtils} from "../../physics/simple/MultiplayerUtils";
import {PrefabManager} from "@stem/editor-oss/prefab/PrefabManager";
import {SceneConfig} from "@stem/editor-oss/scene/SceneConfig";
import {isVFXAutoStartEnabled} from "@stem/editor-oss/services";
import {showToast} from "@stem/editor-oss/showToast";
import {buildNameAwareScriptImportContext, loadScriptImportRevisionMap} from "../../script-runtime/scriptImports";
import {CAMERA_TYPES, CharacterOptionsInterface, GAME_STATE, IFRAME_MESSAGES, ISoundSettings} from "@stem/editor-oss/types/editor";
import {GameLoginData} from "../../ui/common/InGameLogin/InGameLogin";
import {DiscordService} from "../../userManagement/playerProfile/services/DiscordService";
import UnifiedGameServicesController, {
    UnifiedGameUser,
} from "../../userManagement/playerProfile/UnifiedGameServicesController";
import {IUser} from "../../userManagement/types";
import {GameServiceType} from "../../userManagement/utils/PlatformDetector";
import Ajax from "@stem/editor-oss/utils/Ajax";
import Instancer from "@stem/editor-oss/utils/Instancer";
import {LoadingMessages} from "@stem/editor-oss/utils/LoadingManager";
import {getLogger, LogLevel} from "@stem/editor-oss/utils/Logger";
import ObjectPicker, {IObjectPicker} from "@stem/editor-oss/utils/ObjectPicker";
import {cloneObject} from "@stem/editor-oss/utils/ObjectUtils";
import {SceneLoadProfiler} from "@stem/editor-oss/utils/SceneLoadProfiler";
import TagUtil from "@stem/editor-oss/utils/TagUtil";
import {Behavior} from "../Behavior";
import BehaviorClassConfig from "../BehaviorClassConfig";
import BehaviorData from "../BehaviorData";
import {BehaviorFileLoader} from "../BehaviorFileLoader";
import BehaviorManager, {CreateBehaviorOptions} from "../BehaviorManager";
import BehaviorScriptInjector from "../BehaviorScriptInjector";
import CollisionDetector from "../collisions/CollisionDetector";
import EventBus, {IN_GAME_EVENTS} from "../event/EventBus";
import HUDManager from "../hud/HUDManager";
import type {IHUDManager} from "../hud/IHUDManager";
import UIKitHUDManager from "../hud/uikit/UIKitHUDManager";
import AIConversationManager from "../packs/aiNpc/AiConversationManager";
import {IMultiplayerState} from "../state/IMultiplayerState";
import UIKitPointerEvents from "../uikit/UIKitPointerEvents";
import {isLegacyBehaviorId} from "../util";
import type {ViewportSafeArea} from "../../utils/viewportSafeArea";

export interface IControl {
    attachPlayerObject(player: Object3D, characterOptions: CharacterOptionsInterface): Promise<void>;
}

type RuntimeGameSettings = Record<string, any> & {
    uuid: string;
    isGame: boolean;
    lives: number;
    maxScore: number;
    timer: number;
};

class GameManager {
    static TOPIC = "game";

    engine: EngineRuntime;
    sceneConfig: SceneConfig | null;

    /** @deprecated Use `game.engine`. Kept for legacy generated behavior compatibility. */
    get app(): EngineRuntime { return this.engine; }

    //config
    isEnabled = false;
    initialLives = 3;
    initialHealth = 100;
    maxScore = 500;

    //current session
    state = GAME_STATE.NOT_STARTED;
    score = 0;
    lives = 0;
    health = 0;
    pickedWeaponOrItem?: THREE.Object3D;
    playerWeapons: THREE.Object3D[] = [];

    //used by behaviors
    ajax = Ajax;
    inputManager: InputManager<PlayerActions>;
    pointerEventManager: PointerEventManager;
    physics?: IPhysics;
    player?: THREE.Object3D | null;
    uiCamera?: THREE.Camera;

    // Live reads through engine — never stale
    get scene(): THREE.Scene { return this.engine.scene; }
    get sceneHelpers(): THREE.Group { return this.engine.sceneHelpers; }
    get camera(): THREE.PerspectiveCamera { return this.engine.camera; }
    get renderer(): WebGPURenderer { return this.engine.renderer; }
    animationController?: AnimationController;
    animationGraphController?: AnimationGraphController;
    audioController?: AudioController;
    cameraControl?: ICameraControl;
    objectPicker?: IObjectPicker;
    multiplayerState?: IMultiplayerState;
    discord: DiscordService;
    aiWorldController?: AiWorldController;

    // login data
    loginData: GameLoginData | null;

    //internal
    hud?: IHUDManager;
    gameTimer?: number = 0;
    time_remaining?: string = "00:00:00";
    timerRunning? = false;
    timerRemainingTime: number = 0;
    playerStartingPosition?: THREE.Vector3;
    instancer?: Instancer;
    collisionDetector?: CollisionDetector;
    behaviorFileLoader?: BehaviorFileLoader;
    lambdaFileLoader?: LambdaFileLoader;
    lambdaScriptInjector?: LambdaScriptInjector;
    behaviorScriptInjector?: BehaviorScriptInjector;
    behaviorManager?: BehaviorManager;
    lambdaManager?: LambdaManager;
    runtimeBudgetCoordinator?: RuntimeBudgetCoordinator;
    plotBudgetManager?: PlotBudgetManager;
    textureResidencyManager?: TextureResidencyManager;
    prefabManager?: PrefabManager;
    isMultiplayer: boolean = false;
    tweenAnimations?: any[];
    /**
     * Per-game Tween.js group ref ticked by the scheduler each frame. The
     * tween library loads lazily on first `erth.tween.to(...)` so the
     * engine bundle stays minimal; until then `current` is null and the
     * scheduler's TweenSystemAdapter is a no-op.
     */
    tweenGroupRef?: {current: import("@tweenjs/tween.js").Group | null};
    behaviorScripts: Record<string, string> = {};
    behaviorNames: Record<string, string> = {};
    lambdaScripts: Record<string, string> = {};
    lambdaScriptRevisions: Record<string, {assetId: string; revisionId: string}> = {};
    aiConversationManager: AIConversationManager | null = null;
    cameraMinDistance?: number;
    cameraMaxDistance?: number;
    cameraFOV?: number;
    cameraNear?: number;
    cameraFar?: number;
    cameraHeadHeight?: number;
    config: any = {};
    cameraType?: CAMERA_TYPES;
    private isInitializing = false;
    private unifiedGameServices: UnifiedGameServicesController | null = null;

    public getUnifiedGameServices(): UnifiedGameServicesController | null {
        return this.unifiedGameServices;
    }

    public setRenderer(renderer: THREE.WebGLRenderer | WebGPURenderer | null | undefined): void {
        if (renderer) {
            this.objectPicker?.updateRenderer(renderer);
        }
    }

    public getViewportSafeArea(): ViewportSafeArea {
        return this.engine.getViewportSafeArea();
    }

    /**
     * Handle unified game services authentication success
     * @param user - Authenticated user from unified game services
     */
    private handleGameServicesAuthenticated(user: any): void {
        console.log("🎮 [GameManager] Game service authenticated:", user.name, "via", user.platform);
        console.log("🎮 [GameManager] Authenticated user details:", {
            id: user.id?.slice(0, 8) + "..." || "none",
            name: user.name,
            service: user.service,
            platform: user.platform,
            hasAvatar: !!user.avatarUrl,
        });

        // Check if AuthManager has been updated with this user
        const authManagerUser = this.engine.authManager.getUserData();
        console.log("🎮 [GameManager] AuthManager sync check:", {
            authManagerHasUser: !!authManagerUser,
            authManagerUserId: authManagerUser?.id?.slice(0, 8) + "..." || "none",
            idsMatch: authManagerUser?.id === user.id,
        });

        // User is already set in ApplicationAuthStore by the controllers
        // This event allows GameManager to respond to authentication if needed
    }

    private static readonly MAX_OBJECTS_PER_INITIALIZATION = 10;
    // Tracks how many objects have been initialized in the current frame across ALL initializeObject calls
    private objectsInitializedThisFrame = 0;

    constructor(engine: EngineRuntime) {
        this.engine = engine;
        this.sceneConfig = engine.sceneConfig;
        this.loginData = null;
        //create input manager
        const keyBindings = defaultBindings();
        this.inputManager = new InputManager(keyBindings, document);
        this.inputManager.attach();
        this.pointerEventManager = new PointerEventManager();
        // Initialize animationGraphController
        this.animationGraphController = new AnimationGraphController();
        // Initialize Discord service
        this.discord = new DiscordService();
        // Initialize AI World Controller
        this.aiWorldController = new AiWorldController(engine, engine.scene, engine.camera);
        // Initialize unified game services
        console.log("🎮 [GameManager] Initializing UnifiedGameServicesController...");
        this.unifiedGameServices = new UnifiedGameServicesController(this.engine);
        console.log("🎮 [GameManager] UnifiedGameServicesController created, subscribing to auth events");
        // Subscribe to unified game services authentication events
        EventBus.instance.subscribe("gameServices.authenticated", this.handleGameServicesAuthenticated.bind(this));
    }

    //API

    isGameOver() {
        return this.state === GAME_STATE.FINISHED;
    }

    isWinner() {
        return this.isGameOver() && this.lives > 0;
    }

    isGameStarted() {
        return this.state === GAME_STATE.STARTED && !this.isInitializing;
    }

    //and of API

    private normalizeRuntimeGameSettings(scene: THREE.Scene): RuntimeGameSettings {
        if (!scene.userData) scene.userData = {};

        const existing =
            scene.userData.game && typeof scene.userData.game === "object"
                ? scene.userData.game
                : {};

        const finiteNumber = (value: unknown, fallback: number): number => {
            const numeric = Number(value);
            return Number.isFinite(numeric) ? numeric : fallback;
        };

        const {enabled: _legacyEnabled, ...existingGameSettings} = existing;
        const gameSettings: RuntimeGameSettings = {
            ...existingGameSettings,
            uuid: typeof existing.uuid === "string" && existing.uuid ? existing.uuid : THREE.MathUtils.generateUUID(),
            isGame: (existing.isGame ?? _legacyEnabled) === true,
            lives: finiteNumber(existing.lives, this.initialLives),
            maxScore: finiteNumber(existing.maxScore, this.maxScore),
            timer: finiteNumber(existing.timer, 0),
        };

        scene.userData.game = gameSettings;
        return gameSettings;
    }

    //call to start the new session
    async create(
        physics: IPhysics,
        collisionSource: ICollisionSource,
        multiplayerState: IMultiplayerState,
        ctx: RuntimeContext,
        animationController: AnimationController,
        animationGraphController: AnimationGraphController,
        audioController: AudioController,
        useInstancing: boolean,
        isMultiplayer: boolean,
        tweenAnimations: any[],
    ) {
        const {scene, camera, renderer} = ctx;
        const gameSettings = this.normalizeRuntimeGameSettings(scene);
        this.tweenAnimations = tweenAnimations;
        this.isMultiplayer = isMultiplayer;
        this.isEnabled = gameSettings.isGame;
        // HTML HUD can be constructed eagerly. UIKit HUD must wait until
        // `initUIKit()` has run — otherwise the Fullscreen is created before
        // UIKit node materials are loaded, before `setDefaultRenderOrder` is
        // applied, and before `uiCamera` exists. Without those, sibling
        // containers Z-fight against the scene (renderOrder=0) and against
        // each other (no UIKit depth ordering).
        if (this.app.editor?.hudRenderer !== "uikit") {
            this.hud = new HUDManager(scene);
        }
        this.aiConversationManager = new AIConversationManager(this);
        this.physics = physics;
        this.multiplayerState = multiplayerState;
        this.instancer = new Instancer();
        this.animationController = animationController;
        this.animationGraphController = animationGraphController;
        this.audioController = audioController;
        this.tweenAnimations = tweenAnimations;
        this.objectPicker = new ObjectPicker(renderer, scene, camera, ctx.viewport!.getBoundingClientRect());
        this.setRenderer(renderer);

        // convert static objects to instanced mesh
        if (useInstancing) {
            SceneLoadProfiler.begin("convertToInstancedMesh");
            this.instancer.convertMeshesToInstancedMeshes(scene);
            SceneLoadProfiler.end("convertToInstancedMesh");
        }

        // Classify truly static objects to skip per-frame matrix updates
        SceneLoadProfiler.begin("classifyStaticEntities");
        this.classifyStaticEntities(scene);
        SceneLoadProfiler.end("classifyStaticEntities");

        SceneLoadProfiler.begin("setupManagers");
        this.runtimeBudgetCoordinator = new RuntimeBudgetCoordinator();
        configureRuntimeBudgetCoordinatorFromEngine(this.runtimeBudgetCoordinator, this.engine);
        this.plotBudgetManager?.dispose();
        this.plotBudgetManager = new PlotBudgetManager(scene);
        configurePlotBudgetManagerFromEngine(this.plotBudgetManager, this.engine);
        this.textureResidencyManager?.dispose();
        this.textureResidencyManager = new TextureResidencyManager(scene);
        configureTextureResidencyManagerFromEngine(this.textureResidencyManager, this.engine);
        this.runtimeBudgetCoordinator.update({
            textureResidencyManager: this.textureResidencyManager,
        });
        SceneLoadProfiler.end("setupManagers");

        if (!this.isEnabled) {
            console.log("GameManager: scene is a 3D experience; initializing runtime without game services");
        }

        if (this.isEnabled) {
            SceneLoadProfiler.begin("setupGamePlayerAccount");
            await this.setupGamePlayerAccount();
            SceneLoadProfiler.end("setupGamePlayerAccount");
        }

        EventBus.instance.unsubscribe(GameManager.TOPIC);
        EventBus.instance.subscribe(GameManager.TOPIC, this.onMessage.bind(this));

        this.setGameListeners();
        this.setOrientationChangeListener();

        this.initialLives = gameSettings.lives;
        this.maxScore = gameSettings.maxScore;

        SceneLoadProfiler.begin("cameraControlInit");
        this.pointerEventManager.initialize();
        //create camera control
        this.cameraControl = new CameraControl(scene, camera, this.pointerEventManager);
        SceneLoadProfiler.end("cameraControlInit");

        //connect to MP server - should be done before starting the behaviors
        if (this.sceneConfig?.multiplayerAutoJoin && this.multiplayerState) {
            SceneLoadProfiler.begin("multiplayerStart");
            await this.multiplayerState.start();
            const player = await this.onMultiplayerStarted();
            this.setPlayer(player);
            SceneLoadProfiler.end("multiplayerStart");
        }

        // Load behaviors — already in flight from EngineRuntime, cached in service
        this.engine.loadingManager?.nextStage(LoadingMessages.LOADING_BEHAVIORS);
        SceneLoadProfiler.begin("loadBehaviorsData");
        const assetId = this.sceneConfig?.sceneAssetId ?? undefined;
        const assetSource = this.engine.editor?.assetSource;
        const service = this.engine.behaviorLoadingService;
        if (!assetSource) {
            // Unsaved / template / stem-ephemeral scenes don't have an
            // assetSource. Play mode should still work — loadSceneConfigs
            // handles the missing source by skipping the backend fetch and
            // relying on built-in packs + scene.userData behaviors.
            console.warn(
                "GameManager: editor.assetSource is not set; skipping backend behavior fetch. " +
                "Only built-in packs and scene-embedded behaviors will be available.",
            );
        }
        let behaviorsData;
        try {
            behaviorsData = await service.loadSceneConfigs(scene, {assetSource, assetId});
        } catch (error) {
            console.error("GameManager: Error loading behaviors data", error);
            throw new Error("Error loading behaviors data");
        }

        const {configs, scripts} = behaviorsData;
        this.behaviorScripts = scripts;

        // Merge built-in default behavior packs (dayNightCycle, skybox, etc.)
        // so they are available in play mode even if not returned by the API
        const defaultConfigs = await service.loadDefaultConfigs();
        const sceneConfigIds = new Set(configs.map(c => c.id));
        for (const def of defaultConfigs) {
            if (!sceneConfigIds.has(def.id)) {
                configs.push(def);
            }
        }

        for (const c of configs) {
            if (c.name) this.behaviorNames[c.id] = c.name;
        }

        this.behaviorFileLoader = service.getFileLoader();
        this.behaviorScriptInjector = new BehaviorScriptInjector();
        this.collisionDetector = new CollisionDetector(physics, collisionSource);
        this.prefabManager = new PrefabManager(this.engine.assetInstanceManager);

        const importContext = await this.buildRuntimeScriptImportContext(scene);

        const loadedClasses = await service.loadClasses(configs, scripts, this.behaviorScriptInjector, {
            context: importContext,
            importRevisionMap: service.getBundledImportRevisionMap(),
        });

        try {
            this.engine.loadingManager?.updateStageProgress(0.5);
            SceneLoadProfiler.begin("initUIKit");
            await this.initUIKit();
            UIKitPointerEvents.forceDispose(); //reset UIKIt events
            SceneLoadProfiler.end("initUIKit");

            // Now that UIKit globals (node materials, default render order)
            // are initialized and `uiCamera` is in the scene, it is safe to
            // construct the UIKit HUD. Doing this earlier causes the
            // Fullscreen to render with renderOrder=0 and Z-fight everything.
            if (this.app.editor?.hudRenderer === "uikit") {
                this.hud = new UIKitHUDManager(scene, this);
            }
            console.log("GameManager: loaded classes", loadedClasses);

            const behaviorConfigAttributes = new Map<string, Record<string, any>>();
            const behaviorNames = new Map<string, string>();
            for (const config of configs) {
                behaviorConfigAttributes.set(config.id, config.attributes);
                if (config.name) behaviorNames.set(config.id, config.name);
            }
            this.behaviorManager = new BehaviorManager(
                this,
                behaviorConfigAttributes,
                loadedClasses,
                undefined,
                behaviorNames,
            );

            // Register worker configs for behaviors that opt in
            for (const config of configs) {
                if (config.worker) {
                    this.behaviorManager.registerBehaviorClass(
                        config.id,
                        config.attributes,
                        loadedClasses.get(config.id),
                        config.name,
                        {enabled: true},
                    );
                }
            }

            // Initialize Lambda system
            this.engine.loadingManager?.nextStage(LoadingMessages.LOADING_LAMBDAS);
            this.lambdaFileLoader = new LambdaFileLoader();
            this.lambdaScriptInjector = new LambdaScriptInjector();
            this.lambdaManager = new LambdaManager(this);
            SceneLoadProfiler.begin("loadLambdas");
            await Promise.all([
                this.loadBuiltInLambdas(),
                this.loadBackendLambdas(scene, assetSource, assetId),
            ]);
            SceneLoadProfiler.end("loadLambdas");

            this.state = GAME_STATE.NOT_STARTED;
            this.lives = Number(this.initialLives);
            this.health = Number(this.initialHealth);
            this.score = 0;
            this.engine.call("gameCreated", this, this);
            window.parent.postMessage(IFRAME_MESSAGES.GAME_CREATED, "*");
            console.log("GameManager: game created");
        } catch (error) {
            console.error("GameManager: Error during game initialization:", error);
            throw error;
        }
    }

    private async onMultiplayerStarted(): Promise<Object3D | null | undefined> {
        let playerObject = null;
        for (const object of this.scene.children) {
            if (MultiplayerUtils.isMultiplayerTemplate(object)) {
                if (!playerObject) {
                    //add player to physics
                    playerObject = await this.physics?.addPlayerObject(object.uuid, false);
                    await this.physics?.ping(); // wait for the add player to complete
                    if (playerObject) {
                        TagUtil.removeTag(playerObject, ["player", "Player"]); // prevent duplicate-tag warnings
                    }
                    console.warn(`MP: adding tagged player object: ${object.uuid} -> ${playerObject?.uuid}`, playerObject);
                } else if (object !== playerObject) {
                    console.warn("MP: multiple objects has player tag", object.name, object.uuid);
                }
            }
        }
        return playerObject;
    }

    private async initUIKit() {
        //create UI camera
        const uiCamera = this.camera.clone();
        uiCamera.name = "UICamera";
        let hasWarnedInvalidUICameraState = false;

        const isFiniteNumber = (value: unknown): value is number =>
            typeof value === "number" && Number.isFinite(value);

        const hasFiniteTransform = (object: THREE.Object3D): boolean => {
            const {x: px, y: py, z: pz} = object.position;
            const {x: qx, y: qy, z: qz, w: qw} = object.quaternion;
            return (
                isFiniteNumber(px) &&
                isFiniteNumber(py) &&
                isFiniteNumber(pz) &&
                isFiniteNumber(qx) &&
                isFiniteNumber(qy) &&
                isFiniteNumber(qz) &&
                isFiniteNumber(qw)
            );
        };

        const syncUICamera = () => {
            if (!hasFiniteTransform(this.camera)) {
                if (!hasWarnedInvalidUICameraState) {
                    hasWarnedInvalidUICameraState = true;
                    console.warn("GameManager: skipping UI camera sync due to non-finite camera transform");
                }
                return;
            }

            uiCamera.copy(this.camera, false);

            // TODO: use NDC space for UI elements and remove this hacky near adjustment
            const baseNear = isFiniteNumber(this.camera.near) ? this.camera.near : 0.1;
            const baseFar = isFiniteNumber(this.camera.far) ? this.camera.far : Math.max(baseNear + 1, 2000);
            const nextNear = Math.max(0.001, baseNear + 0.1);
            const nextFar = Math.max(nextNear + 0.001, baseFar);

            uiCamera.near = Math.min(nextNear, nextFar - 0.001);
            uiCamera.far = nextFar;
            uiCamera.updateProjectionMatrix();
            uiCamera.name = "UICamera";
            // `Object3D.copy()` overwrites `userData` (deep-clones from source),
            // so re-apply the outliner-hide flag every sync. Without this it
            // would be cleared after the first render frame.
            uiCamera.userData.isRuntimeOnly = true;

            if (hasWarnedInvalidUICameraState) {
                hasWarnedInvalidUICameraState = false;
            }
        };

        syncUICamera();

        const originalUpdateMatrixWorld = uiCamera.updateMatrixWorld.bind(uiCamera);
        uiCamera.updateMatrixWorld = force => {
            syncUICamera();

            originalUpdateMatrixWorld(force);
        };

        // Keep this internal camera out of the scene outliner (mirrors the
        // editor's `Editor.ensureUICamera()` setup). `ProjectTab._parseData`
        // filters by `obj.userData.isRuntimeOnly`. Must be set before
        // `scene.add` so any concurrent outliner refresh sees it filtered.
        uiCamera.userData.isRuntimeOnly = true;
        this.uiCamera = uiCamera;
        this.scene.add(uiCamera);

        //init UIKIt materials
        await initNodeMaterials();
        await initGlyphNodeMaterials();
        setDefaultRenderOrder(RenderOrder.UI);

        //use custom event dispatcher
        // UIKitPointerEventsDispatcher.initialize(this.renderer!, this.uiCamera! as PerspectiveCamera, this.scene);
        // return UIKitPointerEventsDispatcher;
    }

    public async setupGamePlayerAccount() {
        // Initialize unified game services (handles Discord, Steam, Mobile services)
        console.log(`🎮 [GameManager] Starting unified game services...`);

        // Log scene ID that will be used
        const sceneId = this.sceneConfig?.sceneID;
        console.log(
            `🎮 [GameManager] App state: isPlaying=${this.engine.isPlaying}, userId=${this.engine.userId || "none"}, sceneId=${sceneId || "none"}`,
        );

        if (!sceneId) {
            console.warn(`🎮 [GameManager] No scene ID available, game services may not authenticate properly`);
        }

        try {
            await this.unifiedGameServices?.start();
            console.log(`🎮 [GameManager] ✅ Unified game services started successfully`);

            // Log final authentication state
            const currentUser = this.unifiedGameServices?.getCurrentUser();
            const activeService = this.unifiedGameServices?.getActiveService();
            console.log(`🎮 [GameManager] Post-start auth state:`, {
                hasUser: !!currentUser,
                userName: currentUser?.name || "none",
                activeService: activeService,
                isAuthenticated: this.unifiedGameServices?.isAuthenticated(),
            });
            this.updateRecentlyViewed(currentUser as UnifiedGameUser);
        } catch (error) {
            console.error(`🎮 [GameManager] ❌ Failed to start unified game services:`, error);
            console.error(`🎮 [GameManager] Error details:`, {
                message: (error as any)?.message,
                name: (error as any)?.name,
                stack: (error as any)?.stack,
            });
        }
    }

    private async updateRecentlyViewed(currentUser?: UnifiedGameUser) {
        if (!currentUser) return;

        try {
            const store = getRemoteDocStore();
            const data = await store.getDoc<{recentlyViewed?: string[]}>("users", currentUser.id);
            if (!data) return;

            const current = data.recentlyViewed || [];
            const sceneId = this.engine.editor?.sceneID;
            if (!sceneId) return;
            const updated = [sceneId, ...current.filter((id: string) => id !== sceneId)];

            await store.updateDoc("users", currentUser.id, {
                recentlyViewed: updated,
            });
        } catch (e) {
            console.error("Failed to update recently viewed:", e);
        }
    }

    setPlayer(player: Object3D | null | undefined) {
        console.info("[GameManager]: setting player", player);
        this.player = player;
        if (player) {
            this.collisionDetector?.setPlayer(player);
        }
    }

    useAvatar() {
        return this.sceneConfig?.useAvatar;
    }

    getUserId() {
        return this.engine.userId;
    }

    getUserData(): IUser | null {
        console.log("🎮 [GameManager] getUserData() - Starting");

        // Check UnifiedGameServices authentication state
        if (this.unifiedGameServices) {
            const unifiedUser = this.unifiedGameServices.getCurrentUser();
            const isAuthenticated = this.unifiedGameServices.isAuthenticated();
            const activeService = this.unifiedGameServices.getActiveService();

            console.log("🎮 [GameManager] UnifiedGameServices state:", {
                isAuthenticated,
                activeService,
                hasUnifiedUser: !!unifiedUser,
                unifiedUserName: unifiedUser?.name || "none",
                unifiedUserService: unifiedUser?.service || "none",
            });
        }

        const userData = this.engine.authManager.getUserData();

        console.log("🎮 [GameManager] Received user data from AuthManager:", {
            hasUserData: !!userData,
            id: userData?.id?.slice(0, 8) + "..." || "MISSING",
            username: userData?.username || "MISSING",
            email: userData?.email || "MISSING",
            name: userData?.name || "MISSING",
        });

        // Final safety check - should never happen with new architecture
        // but ensures game never crashes due to empty user
        if (!userData || !userData.id || userData.id === "") {
            console.log("🚨 [GameManager] Empty user detected - game will handle user authentication flow");

            // Log potential mismatch between UnifiedGameServices and AuthManager
            if (this.unifiedGameServices?.isAuthenticated()) {
                console.warn("🚨 [GameManager] WARNING: UnifiedGameServices has user but AuthManager doesn't!");
            }

            // Return null to let the game handle user authentication (e.g., email prompt)
            return null;
        }

        console.log("✅ [GameManager] Returning valid user data:", {
            id: userData.id.slice(0, 8) + "...",
            username: userData.username,
            name: userData.name,
        });

        return userData;
    }

    hideLoginPopup() {
        this.engine.call("gameLogin_quit");
    }

    showLoginPopup() {
        //if already logged in or running in Discord, Capacirtor, etc then just return the current user
        const user = this.unifiedGameServices?.getCurrentUser();
        if (
            this.unifiedGameServices?.getActiveService() === GameServiceType.DISCORD ||
            this.unifiedGameServices?.getActiveService() === GameServiceType.GAME_CENTER ||
            this.unifiedGameServices?.getActiveService() === GameServiceType.GOOGLE_PLAY
        ) {
            const userData: GameLoginData = {
                username: user?.name ?? "guest",
                email: user?.email ?? "",
                avatarUrl: user?.avatarUrl ?? "",
                provider: "email", //FIXME: replace with proper platform when game is updated
                token: null,
                isGuest: !user,
            };
            EventBus.instance.send(IN_GAME_EVENTS.GAME_LOGIN_SUCCESS, userData);
            return;
        }
        //otherwise show a login popup
        this.engine.call("gameLogin_requested");
    }

    showLoginReminderPopup() {
        this.engine.call("gameLogin_showReminder");
    }

    /**
     * Resolve the player's default avatar into a ready-to-spawn THREE.Object3D.
     * Returns null if there's no default or resolution fails.
     *  - premade: loads the GLB via ModelLoader.
     *  - composed: assembles parts at runtime via composeUserAvatar.
     */
    async getAvatar(): Promise<THREE.Object3D | null> {
        const record = await getDefaultUserAvatarModel();
        if (!record) return null;

        if (record.type === "premade") {
            const model = await new ModelLoader().load(record.url, {Type: record.format});
            return model ?? null;
        }

        if (record.type === "composed") {
            return composeUserAvatar({
                parts: record.parts,
                skinTone: record.skinTone,
                avatarStyle: record.avatarStyle,
            });
        }

        return null;
    }

    private async createBehaviorsFromScene(): Promise<void> {
        console.log("[GameManager] Starting createBehaviorsFromScene...");

        //transient behavior-target map, used just for the init flow
        const behaviorToTargetMap = new Map<string, THREE.Object3D>();
        //extract all behaviors on the scene
        const allBehaviors: BehaviorData[] = [];
        this.scene.traverse((child: THREE.Object3D) => {
            if (MultiplayerUtils.isMultiplayerTemplate(child)) return;
            allBehaviors.push(...this.getAllBehaviorsFromObject(child, behaviorToTargetMap));
            // TODO: refactor Particles to proper behavior
            if (child instanceof ParticleEmitter) {
                const autoStart = isVFXAutoStartEnabled(child);
                if (autoStart) {
                    QuarksUtil.restart(child);
                } else {
                    QuarksUtil.stop(child);
                }
            }
        });

        console.log(
            `[GameManager] Found ${allBehaviors.length} behaviors total:`,
            allBehaviors.map(b => `${b.id} (${b.uuid})`),
        );

        const defaultPriority = 1000;
        const behaviorsByPriority = new Map<number, BehaviorData[]>();
        allBehaviors.forEach(behavior => {
            const priority = behavior.priority || behavior.attributesData?.priority || defaultPriority;
            let behaviors = behaviorsByPriority.get(priority);
            if (!behaviors) {
                behaviors = [];
                behaviorsByPriority.set(priority, behaviors);
            }
            behaviors.push(behavior);
        });

        console.log(
            `[GameManager] Behaviors grouped by priority:`,
            Array.from(behaviorsByPriority.entries()).map(
                ([p, behaviors]) => `Priority ${p}: [${behaviors.map(b => b.id).join(", ")}]`,
            ),
        );

        //sort priorities (low to high - lower values execute first)
        const sortedPriorities = Array.from(behaviorsByPriority.keys()).sort((a, b) => a - b);

        // Progressive init: a behavior's init()/onAdded builds its geometry
        // synchronously. Running every behavior in a priority group back-to-back
        // (a single `Promise.all` over the whole group) blocks the main thread
        // for the entire world build — the loading overlay can't paint and the
        // UI appears frozen for seconds before play starts. Instead we process
        // behaviors in small batches and yield to the event loop between them,
        // so the browser paints the loading overlay and progress advances
        // smoothly. Priority ordering (low→high) and intra-group ordering are
        // preserved; same-priority behaviors are order-independent by design.
        const INIT_BATCH = 2;
        const totalBehaviors = allBehaviors.length || 1;
        let processedBehaviors = 0;
        const yieldToPaint = () =>
            new Promise<void>(resolve => {
                if (typeof requestAnimationFrame === "function") {
                    requestAnimationFrame(() => resolve());
                } else {
                    setTimeout(() => resolve(), 0);
                }
            });

        //TODO: in onAdded behaviors may add other behaviors, so we need to set BM.isProcessing = true here
        for (let i = 0; i < sortedPriorities.length; i++) {
            const priority = sortedPriorities[i];
            const behaviors = behaviorsByPriority.get(priority!)!;
            console.log(`[GameManager] Processing ${behaviors.length} behaviors with priority ${priority}`);

            for (let b = 0; b < behaviors.length; b += INIT_BATCH) {
                const batch = behaviors.slice(b, b + INIT_BATCH);
                const promises = batch.map(behavior => {
                    const target = behaviorToTargetMap.get(behavior.uuid)!;
                    const options = {
                        uuid: behavior.uuid,
                        attributes: behavior.attributesData,
                        throttleConfig: behavior.throttleConfig,
                    };
                    return this.addBehaviorToObject(target, behavior.id, options)
                        .then(() => {
                            console.debug(
                                `[GameManager] ✓ Successfully added behavior "${behavior.id}" to object "${target.name}"`,
                            );
                        })
                        .catch(error => {
                            console.error(
                                `[GameManager] ✗ Failed to add behavior ${behavior.id} to object ${target.name}:`,
                                error,
                            );
                        });
                });
                try {
                    await Promise.all(promises);
                } catch (error) {
                    console.error(`[GameManager] Failed to initialize a behavior batch (ignoring):`, error);
                }
                processedBehaviors += batch.length;
                this.engine.loadingManager?.updateStageProgress(Math.min(1, processedBehaviors / totalBehaviors));
                // Let the browser paint the loading overlay between batches.
                await yieldToPaint();
            }
            console.log(`[GameManager] All behaviors with priority ${priority} initialized`);
        }

        console.log("[GameManager] Finished createBehaviorsFromScene");
    }

    getAllBehaviorsFromObject(target: THREE.Object3D, behaviorToTargetMap: Map<string, Object3D>): BehaviorData[] {
        const isCharacterChild = target.parent?.userData?.behaviors?.some((b: BehaviorData) => b.id === "character");
        if (isCharacterChild && this.isMultiplayer) {
            // Skip behaviors on children of Character in multiplayer mode
            return [];
        }
        const behaviors: BehaviorData[] = [];
        const behaviorsData = target.userData?.behaviors as BehaviorData[];
        if (behaviorsData) {
            for (const behavior of behaviorsData) {
                if (behavior.enabled) {
                    behaviorToTargetMap.set(behavior.uuid, target);
                    behaviors.push(behavior);
                }
            }
        }
        return behaviors;
    }

    addAllBehaviorsFromObject(target: THREE.Object3D): Promise<void>[] {
        const promises: Promise<void>[] = [];
        const behaviorsData = target.userData?.behaviors as BehaviorData[];
        if (!behaviorsData) {
            return promises;
        }

        for (const data of behaviorsData) {
            if (!data.enabled) {
                continue;
            }
            const options = {
                uuid: data.uuid,
                attributes: data.attributesData,
                throttleConfig: data.throttleConfig,
            };
            const promise = this.addBehaviorToObject(target, data.id, options)
                .then(() => {})
                .catch(error => {
                    console.error(`[GameManager] Failed to add behavior ${data.id} to object ${target.name}:`, error);
                });
            promises.push(promise);
        }

        return promises;
    }

    // this will not remove behavior data from the object, it will just remove behavior from the BehaviorManager
    removeAllBehaviorsForObject(target: THREE.Object3D): void {
        if (!this.behaviorManager) {
            console.error("[GameManager] BehaviorManager is not initialized.");
            return;
        }

        const behaviorsData = target.userData?.behaviors as BehaviorData[];
        if (!behaviorsData) {
            return;
        }

        for (const data of behaviorsData) {
            if (!data.enabled) {
                continue;
            }
            const behavior = this.behaviorManager.getBehaviorByUUID(data.uuid);
            if (behavior) {
                this.behaviorManager.destroyBehavior(behavior);
                console.debug(
                    `[GameManager] Behavior "${data.id}" with uuid: "${data.uuid}" removed from object ${target.name}`,
                );
            } else {
                console.warn(`[GameManager] Behavior with uuid "${data.uuid}" not found on object ${target.name}`);
            }
        }
    }

    loadSounds(sounds: ISoundSettings[]) {
        this.hud?.loadSounds(sounds);
    }

    playSound(soundId: string) {
        this.hud?.playSound(soundId);
    }

    stopSound(soundId: string) {
        this.hud?.stopSound(soundId);
    }

    clearSounds() {
        this.hud?.clearSounds();
    }

    //called when Player stops
    reset() {
        this.endGameSession(false);
        this.hud?.clear();
        this.aiConversationManager?.dispose();
        if (this.scene) {
            this.instancer?.dispose(this.scene);
        }
        this.behaviorManager?.dispose();
        this.lambdaManager?.dispose();
        this.plotBudgetManager?.dispose();
        this.plotBudgetManager = undefined;
        this.textureResidencyManager?.dispose();
        this.textureResidencyManager = undefined;
        this.runtimeBudgetCoordinator = undefined;
        this.prefabManager?.dispose();

        // Hard reset UIKit roots/pointer events across Play<->Remix transitions
        UIKitPointerEvents.forceDispose();
        this.unifiedGameServices?.stop();
        EventBus.instance.unsubscribe("gameServices.authenticated");
        this.removeGameListeners();
        this.removeOrientationChangeListener();

        // Dispose owned subsystems that hold event listeners / GPU resources
        this.objectPicker?.dispose();
        this.objectPicker = undefined;
        this.cameraControl?.dispose();
        this.cameraControl = undefined;
        this.pointerEventManager.dispose();
        this.inputManager.dispose();

        // Remove uiCamera from scene to avoid orphaned object on next play
        if (this.uiCamera) {
            this.uiCamera.removeFromParent();
            this.uiCamera = undefined;
        }

        this.behaviorScripts = {};
        this.behaviorNames = {};
        this.lambdaScripts = {};
        this.lambdaScriptRevisions = {};
        this.player = undefined;
    }

    //update score, lives, etc and update state as needed
    async onMessage(topic: string, data: any) {
        console.log(`GM: onMessage: ${this.state} -> ${topic} -> ${data}`);
        let subs = topic.split(".");
        if (subs.length < 2) {
            console.warn(`GM: invalid message: ${topic}`);
            return;
        }

        let cmd = subs[1];

        if (cmd === "start") {
            console.log("GM: starting game, initializing behaviors...");
            const sceneId = this.sceneConfig?.sceneID;
            if (this.isEnabled && sceneId) {
                updatePlayCount(sceneId);
                if (this.engine.options.isPlayModeOnly) {
                    emitRewardEvent({eventType: REWARD_EVENT_TYPES.GAME_PLAYED, sceneId});
                }
            }
            this.lives = this.initialLives;
            this.health = this.initialHealth;
            this.score = 0;
            this.behaviorManager?.resetStore();

            this.isInitializing = true;

            // Auto-launch the editor debugger only inside editor play mode.
            if (!this.engine.options.isPlayModeOnly) {
                const [{debugSessionManager}, {shouldShowDebuggerTooltip}] = await Promise.all([
                    import("@stem/editor-oss/editor/assets/v2/DebuggerPopup/DebugSessionManager"),
                    import("@stem/editor-oss/editor/assets/v2/BehaviorEditor/breakpoints"),
                ]);
                if (debugSessionManager.shouldAutoLaunch()) {
                    debugSessionManager.startSession();
                    if (shouldShowDebuggerTooltip()) {
                        showToast({type: "info", title: "Debugger active — press F12 to pause at breakpoints"});
                    }
                }
            }

            this.engine.call("gameUpdated", this, this);
            this.engine.call("gameInitialized", this, this);

            // Detect "Player" tag BEFORE behaviors init so TriggerBehavior
            // and others can read game.player during onAdded/onStart.
            if (!this.player && this.scene) {
                const tagged = TagUtil.getObjectsByTag(this.scene, ["player", "Player"]);
                if (tagged.length > 0) {
                    this.setPlayer(tagged[0]);
                }
            }

            console.log("[GameManager] About to create lambda instances and behaviors in parallel...");
            this.engine.loadingManager?.nextStage(LoadingMessages.INITIALIZING_BEHAVIORS);
            Promise.allSettled([this.createLambdaInstancesFromScene(), this.createBehaviorsFromScene()]).then(
                results => {
                    const rejected = results
                        .map((result, index) => ({result, index}))
                        .filter(
                            (
                                entry,
                            ): entry is {
                                result: PromiseRejectedResult;
                                index: number;
                            } => entry.result.status === "rejected",
                        );

                    if (rejected.length > 0) {
                        const labels = ["createLambdaInstancesFromScene", "createBehaviorsFromScene"];
                        console.warn(
                            `[GameManager] Handled ${rejected.length} initialization rejection(s); continuing game start.`,
                            rejected.map(entry => ({
                                task: labels[entry.index] ?? `task-${entry.index}`,
                                reason: entry.result.reason,
                            })),
                        );
                    }

                    this.state = GAME_STATE.STARTED;
                    this.gameCountDown();
                    this.behaviorManager?.reset();
                    this.isInitializing = false;

                    // If no behavior set a player, check for "Player" tag
                    if (!this.player && this.scene) {
                        const tagged = TagUtil.getObjectsByTag(this.scene, ["player", "Player"]);
                        const taggedPlayer = tagged[0];
                        if (taggedPlayer) {
                            this.setPlayer(taggedPlayer);
                            // Skip cameraControl.start() when cameraType is NONE
                            // (a custom behavior controls the camera)
                            const camData = this.camera ? CameraControl.getCameraOptions(this.camera) : undefined;
                            if (camData?.cameraType !== CAMERA_TYPES.NONE) {
                                this.cameraControl?.start(taggedPlayer);
                            }
                        }
                    }

                    this.engine.call("gameStarted", this, this);
                    window.parent.postMessage(IFRAME_MESSAGES.GAME_STARTED, "*");
                    this.engine.call("gameUpdated", this, this);
                    console.log("GM: all behaviors initialized, game started");
                },
            );
            return;
        } else if (cmd === "resume") {
            this.state = GAME_STATE.STARTED;
            this.behaviorManager?.reset();
            this.physics?.resume();
            this.engine.call("gameResumed", this, this);
        } else if (cmd === "pause") {
            if (this.state !== GAME_STATE.FINISHED) {
                this.state = GAME_STATE.PAUSED;
                this.physics?.pause();
                window.parent.postMessage(IFRAME_MESSAGES.GAME_PAUSED, "*");
            }
        } else if (cmd === "stop") {
            if (!this.engine.options.isPlayModeOnly) {
                const {debugSessionManager} = await import("@stem/editor-oss/editor/assets/v2/DebuggerPopup/DebugSessionManager");
                debugSessionManager.endSession();
            }
            this.objectPicker?.clear();
            this.behaviorManager?.dispose();
            this.lambdaManager?.dispose();
            this.prefabManager?.dispose();
            UIKitPointerEvents.forceDispose();
            this.endGameSession();
        } else if (cmd === "score") {
            if (this.state !== GAME_STATE.STARTED) {
                console.warn(`GM: score update in a wrong state: ${topic} -> ${this.state}`);
                return;
            }
            this.handleScoreUpdate(topic, subs, data);
        } else if (cmd === "lives") {
            if (this.state !== GAME_STATE.STARTED) {
                console.warn(`GM: lives update in a wrong state: ${topic} -> ${this.state}`);
                return;
            }
            this.handleLivesUpdate(topic, subs, data);
        } else if (cmd === "health") {
            if (this.state !== GAME_STATE.STARTED) {
                console.warn(`GM: health update in a wrong state: ${topic} -> ${this.state}`);
                return;
            }
            this.handleHealthUpdate(topic, subs, data);
        } else if (cmd === "weapon") {
            this.handleWeaponUpdate(topic, subs, data);
        } else if (cmd === "loadSounds") {
            this.loadSounds(data);
        } else if (cmd === "playSound") {
            this.playSound(data);
        } else if (cmd === "stop_sound") {
            this.stopSound(data);
        } else if (cmd === "clear_sounds") {
            this.clearSounds();
        } else if (cmd === "time") {
            this.handleTimeUpdate(topic, subs, data);
        } else if (cmd === "loginSuccess") {
            this.loginData = data;
        } else {
            console.warn(`GM: unsupported message: ${topic}`);
            return;
        }
        this.engine.call("gameUpdated", this, this);
    }

    update(clock: any, delta: number) {
        if (this.state !== GAME_STATE.STARTED) return;
        this.inputManager?.update();
        if (this.scene?.userData && this.inputManager) {
            // Global input mirrors for behaviors that rely on scene-level key state.
            this.scene.userData.pressE = this.inputManager.getAction("use");
            this.scene.userData.pressF = this.inputManager.getAction("drop");
            this.scene.userData.pressP = this.inputManager.getAction("pull");
        }
        this.collisionDetector?.update();
        this.behaviorManager?.update(delta);
        this.lambdaManager?.update(delta);
        this.objectPicker?.update();
        if (this.runtimeBudgetCoordinator) {
            configureRuntimeBudgetCoordinatorFromEngine(this.runtimeBudgetCoordinator, this.engine);
            this.runtimeBudgetCoordinator.update({
                textureResidencyManager: this.textureResidencyManager,
            });
        }
        if (this.plotBudgetManager) {
            configurePlotBudgetManagerFromEngine(this.plotBudgetManager, this.engine);
            this.plotBudgetManager.update(this.camera);
        }
        if (this.textureResidencyManager) {
            configureTextureResidencyManagerFromEngine(this.textureResidencyManager, this.engine);
            this.textureResidencyManager.update();
        }
    }

    /** Returns all Object3Ds registered with lambdas, keyed by uuid. Used by SpatialGridSystem. */
    getTrackedObjects(): Map<string, THREE.Object3D> {
        const result = new Map<string, THREE.Object3D>();
        if (!this.lambdaManager) return result;
        for (const instance of this.lambdaManager.getAllInstances()) {
            for (const [obj] of instance.registeredObjects) {
                result.set(obj.uuid, obj);
            }
        }
        return result;
    }

    handleTimeUpdate(topic: string, subs: string[], data: any) {
        if (subs.length < 3) {
            console.warn(`GM: invalid time message: ${topic}`);
            return;
        }
        if (typeof data !== "number") {
            console.warn(`GM: invalid time data: ${topic} => ${data}`);
            data = Number(data);
            if (Number.isNaN(data)) {
                return;
            }
        }

        if (subs[2] === "dec") {
            console.log(`GM: time update: ${topic} => ${this.timerRemainingTime} -> ${this.timerRemainingTime - data}`);
            this.timerRemainingTime -= data;
            if (this.timerRemainingTime <= 0) {
                console.log("GM: time reached 0 - game over !");
                this.endGameSession();
            }
        } else if (subs[2] === "inc") {
            console.log(`GM: time update: ${topic} => ${this.timerRemainingTime} -> ${this.timerRemainingTime + data}`);
            this.timerRemainingTime += data;
        } else {
            console.warn(`GM: unsupported time update operation: ${topic}`);
            return;
        }
    }

    handleScoreUpdate(topic: string, subs: string[], data: any) {
        if (subs.length < 3) {
            console.warn(`GM: invalid score message: ${topic}`);
            return;
        }
        if (typeof data !== "number") {
            console.warn(`GM: invalid score data: ${topic} => ${data}`);
            data = Number(data);
            if (Number.isNaN(data)) {
                return;
            }
        }
        if (subs[2] === "inc") {
            console.log(`GM: score update: ${topic} => ${this.score} -> ${this.score + data}`);
            this.score += data;
            if (this.maxScore > 0 && this.score >= this.maxScore) {
                console.log(`GM: score reached ${this.maxScore} - game over !`);
                this.endGameSession();
            }
        } else if (subs[2] === "dec") {
            console.log(`GM: score update: ${topic} => ${this.score} -> ${this.score - data}`);
            if (this.score - data < 0) return;
            this.score -= data;
        } else {
            console.warn(`GM: unsupported score update operation: ${topic}`);
            return;
        }
    }

    private handleLivesUpdate(topic: string, subs: string[], data: any) {
        if (subs.length < 3) {
            console.warn(`GM: invalid lives message: ${topic}`);
            return;
        }
        if (typeof data !== "number") {
            console.warn(`GM: invalid lives data: ${topic} => ${data}`);
            return;
        }

        if (subs[2] === "dec") {
            console.log(`GM: lives update: ${topic} => ${this.lives} -> ${this.lives - data}`);
            this.lives -= data;
            if (this.initialLives > 0 && this.lives <= 0) {
                console.log("GM: lives reached 0 - game over !");
                this.endGameSession();
            }
        } else if (subs[2] === "inc") {
            console.log(`GM: lives update: ${topic} => ${this.lives} -> ${this.lives + data}`);
            this.lives += data;
        } else {
            console.warn(`GM: unsupported lives update operation: ${topic}`);
            return;
        }
    }

    private handleHealthUpdate(topic: string, subs: string[], data: any) {
        if (subs.length < 0) {
            console.warn(`GM: invalid Health message: ${topic}`);
            return;
        }
        if (typeof data !== "number") {
            console.warn(`GM: invalid Health data: ${topic} => ${data}`);
            return;
        }

        if (subs[2] === "dec") {
            console.log(`GM: health update: ${topic} => ${this.health} -> ${this.health - data}`);
            this.health -= data;

            if (this.initialHealth > 0 && this.health <= 0) {
                console.log("GM: health reached 0 - game over !");
                this.endGameSession();
            }
        } else if (subs[2] === "inc") {
            console.log(`GM: health update: ${topic} => ${this.health} -> ${this.health + data}`);
            this.health += data;
        } else {
            console.warn(`GM: unsupported health update operation: ${topic}`);
            return;
        }

        window.parent.postMessage(
            {
                type: IFRAME_MESSAGES.HEALTH_UPDATE,
                payload: this.health,
            },
            "*",
        );
    }

    private handleWeaponUpdate(topic: string, subs: string[], data: any) {
        if (subs.length < 3) {
            console.warn(`GM: invalid weapon update message: ${topic}`);
            return;
        }

        if (subs[2] === "pickup") {
            console.log(data);
            this.handleWeaponPickup(data);
        } else if (subs[2] === "drop") {
            this.handleWeaponDrop(data);
        }
    }

    private handleWeaponPickup(data: any) {
        this.playerWeapons.push(data);
        this.pickedWeaponOrItem = data; // to do add logic to pick current weapon
    }

    private handleWeaponDrop(data: any) {
        this.playerWeapons = this.playerWeapons.filter(w => w.name !== data.name);
    }

    private endGameSession(emitPauseEvent: boolean = true) {
        if (!this.isEnabled) return;
        if (!this.isGameOver()) {
            this.time_remaining = "00:00:00";
            this.playerWeapons = [];
            this.pickedWeaponOrItem = undefined;

            this.state = GAME_STATE.FINISHED;
            this.engine.call("gameEnded", this, this);
            window.parent.postMessage(IFRAME_MESSAGES.GAME_ENDED, "*");

            if (this.player && this.playerStartingPosition) {
                this.physics?.setPlayerPosition(this.player?.uuid, this.playerStartingPosition);
                this.player.position.copy(this.playerStartingPosition);
                if (this.player.userData && this.player.userData.physics && this.player.userData.physics.body) {
                    this.player.userData.physics.body = null;
                }
            }
            if (emitPauseEvent) {
                this.engine.call("pauseGame", this, this);
            }
        }
        this.engine.call("removeGunAimer", this, this);
    }

    private gameCountDown() {
        if (this.timerRunning) {
            return;
        }
        if (!this.engine?.editor) {
            return console.error("Cannot run the timer. Editor is null.");
        }
        const editor = this.engine.editor;
        this.gameTimer = editor.scene?.userData?.game?.timer || 0;
        this.timerRemainingTime = this.gameTimer || 0;
        let lives: number = editor?.scene?.userData?.game?.lives || 0;

        if (
            typeof this.gameTimer !== "undefined" &&
            this.gameTimer > 0 &&
            typeof this.lives !== "undefined" &&
            this.lives > 0
        ) {
            this.timerRunning = true;

            const timerInterval = setInterval(() => {
                if (typeof this.gameTimer !== "undefined") {
                    if (this.state === GAME_STATE.STARTED) {
                        this.timerRemainingTime = this.timerRemainingTime - 1;
                        if (this.timerRemainingTime >= 0) {
                            const hours = Math.floor(this.timerRemainingTime / 3600);
                            const minutes = Math.floor((this.timerRemainingTime % 3600) / 60);
                            const seconds = this.timerRemainingTime % 60;
                            const formattedTime = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
                            this.time_remaining = formattedTime;
                            this.engine.call("gameTimerUpdate", this, this);
                            this.scene.userData.gameTimeRemaining = this.time_remaining;
                        } else {
                            clearInterval(timerInterval);
                            this.timerRunning = false;
                            EventBus.instance.send(IN_GAME_EVENTS.GAME_LIVES_DEC, Number(lives));
                        }
                    } else if (this.state !== GAME_STATE.PAUSED) {
                        clearInterval(timerInterval);
                        this.timerRunning = false;
                    }
                }
            }, 1000);
        }
    }

    /**
     * Register a behavior class dynamically by loading a behavior asset.
     *
     * @remarks
     * This is needed for prefabs, because prefabs can reference behaviors that
     * are not part of the original scene.
     *
     * @param assetRef - The behavior asset reference
     * @returns A promise that resolves when the behavior class is registered
     */
    private async buildRuntimeScriptImportContext(scene: THREE.Scene = this.scene) {
        const sceneContext = getAssetResolutionContext(scene) || emptyAssetResolutionContext;
        const bundledContext = this.engine.behaviorLoadingService.getBundledImportResolutionContext();
        const context = mergeAssetResolutionContexts(sceneContext, bundledContext);
        return buildNameAwareScriptImportContext(this.engine.editor?.sceneID, context, {
            force: true,
            allowFetchFailure: true,
        });
    }

    private async registerAssetBehaviorClass(assetRef: AssetRef): Promise<void> {
        if (!this.behaviorManager) {
            console.error("[GameManager] BehaviorManager is not initialized. Cannot load behavior.");
            return;
        }

        // Don't load if already present
        const key = assetRefKey(assetRef);
        if (this.behaviorManager.hasBehaviorClass(key)) {
            return;
        }

        const behavior = await getAssetRevisionData(assetRef.assetId, assetRef.revisionId, "json");
        const config = JSON.parse(behavior.config) as BehaviorClassConfig;
        const code = behavior.code as string;
        const importContext = await this.buildRuntimeScriptImportContext();
        const importRevisionMap = await loadScriptImportRevisionMap(code, importContext);
        const behaviorClass = this.behaviorScriptInjector!.parse(key, code, config.name, {
            context: importContext,
            importRevisionMap,
        });
        const workerConfig = config.worker ? {enabled: true} : undefined;
        this.behaviorManager?.registerBehaviorClass(key, config.attributes, behaviorClass, config.name, workerConfig);
    }

    async addBehaviorToObject(
        target: THREE.Object3D,
        behaviorId: string,
        behaviorOptions?: CreateBehaviorOptions,
    ): Promise<Behavior> {
        console.debug(
            `[GameManager] addBehaviorToObject called with behaviorId: "${behaviorId}", target: "${target.name || target.uuid}", options:`,
            behaviorOptions,
        );

        try {
            if (!this.behaviorManager) {
                const error = new Error("[GameManager] BehaviorManager is not initialized");
                console.error("[GameManager] BehaviorManager is not initialized.");
                return Promise.reject(error);
            }

            // If this is a behavior asset (as opposed to a legacy behavior),
            // determine which revision to load based on the asset resolution
            // context.
            let behaviorKey = behaviorId;
            if (!isLegacyBehaviorId(behaviorId)) {
                const assetResolutionContext = getAssetResolutionContext(target, true);
                const revisionId = assetResolutionContext
                    ? resolveAssetRevisionId(behaviorId, assetResolutionContext)
                    : null;
                if (revisionId) {
                    const assetRef: AssetRef = {assetId: behaviorId, revisionId};
                    behaviorKey = assetRefKey(assetRef);

                    // If the behavior is not loaded, load it dynamically.
                    if (!this.behaviorManager.hasBehaviorClass(behaviorKey)) {
                        await this.registerAssetBehaviorClass(assetRef);
                    }
                } else {
                    console.warn(
                        `[GameManager] Could not resolve revision ID for behavior "${behaviorId}", proceeding with base ID`,
                    );
                }
            }

            console.debug(`[GameManager] BehaviorManager exists, calling createBehavior for "${behaviorKey}"`);
            const behavior = await this.behaviorManager.createBehavior(target, behaviorKey, behaviorOptions);

            if (!behavior) {
                const error = new Error(`[GameManager] Failed to create behavior ${behaviorKey}`);
                console.error(`[GameManager] createBehavior returned null/undefined for "${behaviorKey}"`);
                return Promise.reject(error);
            }

            console.debug(
                `[GameManager] Successfully created behavior "${behaviorKey}" for object "${target.name || target.uuid}"`,
            );

            // Check enableAtStart property and disable object if set to false
            const enableAtStart =
                typeof target.userData.enableAtStart === "boolean" ? target.userData.enableAtStart : true; // default to true if not set

            console.debug(`[GameManager] Object "${target.name || target.uuid}" enableAtStart: ${enableAtStart}`);
            if (!enableAtStart) {
                this.pauseObject(target, false); // Pause behaviors without cascading to children
            }
            return Promise.resolve(behavior);
        } catch (err) {
            console.error(
                `[GameManager] Error creating behavior "${behaviorId}" for object "${target.name || target.uuid}":`,
                err,
            );
            throw err;
        }
    }

    removeBehaviorByUUID(uuid: string): Behavior | null {
        if (!this.behaviorManager) {
            console.warn("[GameManager] BehaviorManager is not initialized.");
            return null;
        }

        const behavior = this.behaviorManager.getBehaviorByUUID(uuid);
        if (behavior) {
            try {
                this.behaviorManager.destroyBehavior(behavior);
                console.debug(`[GameManager] Behavior "${behavior.id}" with uuid: "${uuid}" removed`);
            } catch (err) {
                console.error(`[GameManager] Error removing behavior "${uuid}":`, err);
            }
        } else {
            console.warn(`[GameManager] Behavior with uuid "${uuid}" not found`);
        }
        return behavior;
    }

    updateBehaviorAttributes(uuid: string, updatedProperties: Record<string, any>): Behavior | null {
        if (!this.behaviorManager) {
            console.warn("[GameManager] BehaviorManager is not initialized.");
            return null;
        }

        const behavior = this.behaviorManager.getBehaviorByUUID(uuid);

        if (behavior) {
            try {
                this.behaviorManager.applyAttributesToBehavior(behavior, updatedProperties);
            } catch (err) {
                console.error(`[GameManager] Error updating behavior with uuid ${uuid}:`, err);
            }
        } else {
            console.warn(`[GameManager] Behavior with uuid ${uuid} not found`);
        }

        return behavior;
    }

    // --- Lambda system methods ---

    private async loadBuiltInLambdas(): Promise<void> {
        if (!this.lambdaFileLoader || !this.lambdaManager) return;

        try {
            const packs = await this.lambdaFileLoader.loadAllBuiltInPacks();
            for (const {config, cls} of packs) {
                this.lambdaManager.registerLambdaClass(config.id, config, cls);
                console.info(`[GameManager] Registered built-in lambda "${config.id}"`);
            }
        } catch (error) {
            console.error("[GameManager] Error loading built-in lambdas:", error);
        }
    }

    private async loadBackendLambdas(
        scene: THREE.Scene,
        assetSource: AssetSource | undefined,
        sceneAssetId?: string,
    ): Promise<void> {
        if (!this.lambdaManager || !this.lambdaScriptInjector) return;

        try {
            const bundledScript = sceneAssetId
                ? await this.engine.behaviorLoadingService.loadScriptBundle(sceneAssetId)
                : null;
            const bundledLambdas = getLambdasFromScriptBundle(bundledScript);
            // Without a bundled script or an assetSource there's nothing to
            // fetch. Mirror the tolerant behavior at the `loadSceneConfigs`
            // call site (line ~313) so unsaved / stem-ephemeral / post-save
            // pre-reload scenes don't crash here.
            if (!bundledLambdas && !assetSource) return;
            const lambdas = bundledLambdas
                || (
                    assetSource!.kind === "scene"
                        ? await getLambdasListForScene(assetSource!.id, scene)
                        : await assetSource!
                              .getAssets({types: [AssetType.Lambda]})
                              .then(({assets}) => getLambdasFromAssets(assets, scene))
                );
            if (!lambdas) return;
            const importContext = await this.buildRuntimeScriptImportContext(scene);
            const bundledImportRevisionMap = getImportRevisionMapFromScriptBundle(bundledScript);
            for (const lambda of lambdas) {
                if (this.lambdaManager.hasLambdaClass(lambda.Config.id)) continue;

                try {
                    this.lambdaScripts[lambda.Config.id] = lambda.Code;
                    const importRevisionMap = await loadScriptImportRevisionMap(
                        lambda.Code,
                        importContext,
                        bundledImportRevisionMap,
                    );
                    const cls = this.lambdaScriptInjector.parse(lambda.Config.id, lambda.Code, {
                        context: importContext,
                        importRevisionMap,
                    });
                    this.lambdaManager.registerLambdaClass(lambda.Config.id, lambda.Config, cls);
                    this.lambdaScriptRevisions[lambda.Config.id] = {
                        assetId: lambda.ID,
                        revisionId: lambda.RevisionID,
                    };
                    console.info(`[GameManager] Loaded backend lambda "${lambda.Config.id}"`);
                } catch (error) {
                    console.error(`[GameManager] Failed to parse lambda "${lambda.Config.id}":`, error);
                }
            }
        } catch (error) {
            console.error("[GameManager] Error loading backend lambdas:", error);
        }
    }

    public async ensureLambdaClassLoaded({
        lambdaId,
        assetId,
        revisionId,
        config,
        code,
        forceReload = false,
    }: {
        lambdaId: string;
        assetId?: string;
        revisionId?: string;
        config?: LambdaConfig;
        code?: string;
        forceReload?: boolean;
    }): Promise<boolean> {
        if (!this.lambdaManager || !this.lambdaScriptInjector) {
            return false;
        }

        const loadedRevision = this.lambdaScriptRevisions[lambdaId];
        const shouldReload =
            forceReload ||
            !this.lambdaManager.hasLambdaClass(lambdaId) ||
            (!!assetId && !!revisionId &&
                (!loadedRevision ||
                    loadedRevision.assetId !== assetId ||
                    loadedRevision.revisionId !== revisionId));

        if (!shouldReload) {
            if (config) {
                this.lambdaManager.updateConfig(lambdaId, config);
            }
            return true;
        }

        let resolvedConfig = config;
        let resolvedCode = code;

        if ((!resolvedConfig || !resolvedCode) && assetId && revisionId) {
            try {
                const revisionData = await getLambdaRevisionData(assetId, revisionId);
                resolvedConfig = resolvedConfig || revisionData.config;
                resolvedCode = resolvedCode || revisionData.code;
            } catch (error) {
                console.error(`[GameManager] Failed to load lambda revision "${lambdaId}":`, error);
                return this.lambdaManager.hasLambdaClass(lambdaId);
            }
        }

        if (!resolvedConfig || !resolvedCode) {
            return this.lambdaManager.hasLambdaClass(lambdaId);
        }

        try {
            this.lambdaScripts[lambdaId] = resolvedCode;
            const importContext = await this.buildRuntimeScriptImportContext();
            const importRevisionMap = await loadScriptImportRevisionMap(resolvedCode, importContext);
            const cls = this.lambdaScriptInjector.parse(lambdaId, resolvedCode, {
                context: importContext,
                importRevisionMap,
            });

            if (this.lambdaManager.hasLambdaClass(lambdaId)) {
                await this.lambdaManager.reloadLambdaClass(lambdaId, resolvedConfig, cls);
            } else {
                this.lambdaManager.registerLambdaClass(lambdaId, resolvedConfig, cls);
            }

            if (assetId && revisionId) {
                this.lambdaScriptRevisions[lambdaId] = {assetId, revisionId};
            }

            return true;
        } catch (error) {
            console.error(`[GameManager] Failed to parse/reload lambda "${lambdaId}":`, error);
            return false;
        }
    }

    private async createLambdaInstancesFromScene(): Promise<void> {
        console.log(
            `[GameManager] createLambdaInstancesFromScene called (lambdaManager=${!!this.lambdaManager}, scene=${!!this.scene})`,
        );
        if (!this.lambdaManager || !this.scene) return;

        // Merge scene-level and project-level instances, deduplicating by lambdaId.
        // Project-level entries take priority (they are the canonical source).
        const sceneLambdas =
            (this.scene.userData?.lambdaInstances as Array<{
                lambdaId: string;
                instanceId: string;
                enabled: boolean;
                attributes: Record<string, any>;
            }>) || [];
        const projectLambdas =
            (this.scene.userData?.projectLambdaInstances as Array<{
                lambdaId: string;
                instanceId: string;
                enabled: boolean;
                attributes: Record<string, any>;
            }>) || [];

        // One instance per lambdaId — project entries first, then scene entries fill gaps
        const byType = new Map<
            string,
            {lambdaId: string; instanceId: string; enabled: boolean; attributes: Record<string, any>}
        >();
        for (const data of projectLambdas) {
            if (!byType.has(data.lambdaId)) byType.set(data.lambdaId, data);
        }
        for (const data of sceneLambdas) {
            if (!byType.has(data.lambdaId)) byType.set(data.lambdaId, data);
        }

        console.log(`[GameManager] createLambdaInstancesFromScene: ${byType.size} unique lambda type(s) to create`);

        for (const data of byType.values()) {
            if (!data.enabled) continue;
            try {
                await this.lambdaManager.createInstance(data.lambdaId, {
                    uuid: data.instanceId,
                    attributes: data.attributes,
                });
            } catch (error) {
                console.error(`[GameManager] Failed to create lambda instance "${data.lambdaId}":`, error);
            }
        }

        // Register objects with their lambda components
        this.scene.traverse((child: THREE.Object3D) => {
            this.registerLambdaComponentsForObject(child);
        });
    }

    private registerLambdaComponentsForObject(object: THREE.Object3D): void {
        const components = object.userData?.lambdaComponents as LambdaComponentData[] | undefined;
        if (!components || !Array.isArray(components)) return;

        for (const comp of components) {
            if (!comp.enabled) continue;
            if (!comp.autoApply) continue;
            if (!comp.instanceId) {
                console.warn(
                    `[GameManager] Skipping lambda component "${comp.lambdaId}" on ${object.name || object.uuid} because it has no instanceId`,
                );
                continue;
            }
            this.lambdaManager?.registerObject(comp.instanceId, object, comp.componentData);
        }
    }

    //used by behaviors/copilot to set physics config to the object
    public setPhysicsConfig(object: Object3D, config: PhysicsConfig) {
        PhysicsUtil.setPhysicsConfig(object, config);
    }

    // add object to the scene or parent, add behaviors and physics if enabled
    // it will recursively add behaviors and physics for each child of the object
    async addObject(object: THREE.Object3D, parent?: THREE.Object3D): Promise<void> {
        if (!object || !this.scene) {
            console.warn("[GameManager] Cannot add object - invalid object or scene");
            return Promise.resolve();
        }

        // If parent is not provided, add to the scene
        if (!parent) {
            parent = this.scene;
        }

        if (object.parent && object.parent !== parent) {
            this.removeObject(object);
        }

        if (!object.parent) {
            parent.add(object);
        }

        await this.initializeObject(object);
        this.plotBudgetManager?.registerObjectTree(object);
        this.textureResidencyManager?.registerObjectTree(object);

        return Promise.resolve();
    }

    // remove object from the scene or parent, remove behaviors and physics if enabled
    // it will recursively remove behaviors and physics for each child of the object
    removeObject(object: THREE.Object3D): void {
        if (!object || !this.scene) {
            console.warn("[GameManager] Cannot remove object - invalid object or scene");
            return;
        }

        if (object.userData?.instanceData && this.instancer) {
            this.instancer.removeInstance(object);
        }

        // Remove behaviors from the object
        this.removeAllBehaviorsForObject(object);
        this.lambdaManager?.deregisterObjectFromAll(object);
        this.plotBudgetManager?.unregisterObjectTree(object);
        this.textureResidencyManager?.unregisterObjectTree(object);

        // Remove physics if enabled
        if (PhysicsUtil.isPhysicsEnabled(object)) {
            this.engine.physics?.removeObject(object);
        }

        // Remove the object from its parent
        if (object.parent) {
            object.parent.remove(object);
        } else {
            console.warn(`[GameManager] Object ${object.name || object.uuid} has no parent, cannot remove`);
        }

        this.disposeObject(object);
    }

    /**
     * Deep clones an Object3D with all behaviors, physics components, and userData recursively
     *
     * @param sourceObject - The Object3D to clone
     * @returns Promise<Object3D | null> - The cloned object or null if cloning failed
     */
    cloneObject(sourceObject: THREE.Object3D): THREE.Object3D | null {
        try {
            return cloneObject(sourceObject);
        } catch (error) {
            console.error("[GameManager] Error cloning object:", error);
            return null;
        }
    }

    private setGameListeners() {
        this.engine.on("gameInitialized.GameManager", this.handleGameInitialized);
        this.engine.on("gameStarted.GameManager", this.handleGameStarted);
        this.engine.on("pauseGame.GameManager", this.handleGamePaused);
        this.engine.on("gameEnded.GameManager", this.handleGameEnded);
        this.engine.on("gameResumed.GameManager", this.handleGameResumed);
        this.engine.on("objectChanged.GameManager", this.handleObjectChanged);
    }

    private removeGameListeners() {
        this.engine.on("gameInitialized.GameManager", null);
        this.engine.on("gameStarted.GameManager", null);
        this.engine.on("pauseGame.GameManager", null);
        this.engine.on("gameEnded.GameManager", null);
        this.engine.on("gameResumed.GameManager", null);
        this.engine.on("objectChanged.GameManager", null);

        Object.values(IN_GAME_EVENTS).forEach(event => {
            EventBus.instance.unsubscribe(event);
        });
    }

    private handleObjectChanged = (_editor: any, object: THREE.Object3D) => {
        if (object === this.camera) {
            applyCameraProjectionSettings(this.camera, CameraControl.getCameraOptions(object));
        }

        if (this.cameraControl && object === this.cameraControl.camera) {
            this.cameraControl.updateCameraOptions();
        }
    };

    private handleGameInitialized = () => {
        this.engine.playerMask?.hide();
    };

    private handleGameStarted = () => {
        this.engine.startAnimationLoop();
        this.state = GAME_STATE.STARTED;
        if (!this.player) {
            // When cameraType is NONE, a custom behavior controls the camera — skip orbit controls
            const camData = this.camera ? CameraControl.getCameraOptions(this.camera) : undefined;
            if (camData?.cameraType === CAMERA_TYPES.NONE) {
                console.info("-------cameraType=NONE, custom behavior controls camera");
                return;
            }

            // Check if orbit controls should be enabled (default to true for backward compatibility)
            const enableOrbitControls =
                typeof this.scene?.userData?.enableOrbitControls === "boolean"
                    ? this.scene.userData.enableOrbitControls
                    : true;

            if (enableOrbitControls) {
                console.warn("-------Player object not found, enabling camera free mode");
                // Only surface this hint in the editor. On /play/:id the user
                // is a player, not the creator — they can't act on the hint,
                // and it's noisy when launching a published game.
                if (
                    !this.engine.options.isPlayModeOnly
                    && getLogger()?.isLevelEnabled(LogLevel.INFO) !== false
                ) {
                    showToast({
                        type: "info",
                        title: "Player object not found. Enabling camera free mode.",
                    });
                }
                this.engine.enableEditorCameraControls("play");
            } else {
                console.info("-------Player object not found, orbit controls disabled by settings");
            }
        }
    };

    private handleGamePaused = () => {
        this.engine.stopAnimationLoop();
        this.state = GAME_STATE.PAUSED;
    };

    private handleGameEnded = () => {
        this.engine.stopAnimationLoop();
        this.state = GAME_STATE.FINISHED;
    };

    private handleGameResumed = () => {
        this.engine.startAnimationLoop();
        this.state = GAME_STATE.STARTED;
    };

    private setOrientationChangeListener() {
        (window as any).screen.orientation.addEventListener("change", this.handleOrientationChange);
    }

    private removeOrientationChangeListener() {
        (window as any).screen.orientation.removeEventListener("change", this.handleOrientationChange);
    }

    private handleOrientationChange = (event: Event) => {
        EventBus.instance.send("device.orientation", {
            type: (event.target as any).type,
            angle: (event.target as any).angle,
        });
    };

    /**
     * Initializes an Object3D for the game by adding all behaviors and physics components recursively.
     *
     * Note: This method does NOT add the object to the scene or its parent. It only initializes the object
     * for the game, including behaviors and physics. To add the object to the scene,
     * use addObject() method.
     *
     * Usually this method is called from editor in sandbox mode, because the object addition is handled by the editor
     * @param object - The Object3D to initialize.
     */
    async initializeObject(object: THREE.Object3D): Promise<void> {
        const queue: THREE.Object3D[] = [object];
        while (queue.length > 0) {
            this.objectsInitializedThisFrame++;
            if (this.objectsInitializedThisFrame >= GameManager.MAX_OBJECTS_PER_INITIALIZATION) {
                await new Promise<void>(resolve => {
                    requestAnimationFrame(() => {
                        this.objectsInitializedThisFrame = 0;
                        resolve();
                    });
                });
            }
            const current = queue.shift()!;

            const behaviorPromises = this.addAllBehaviorsFromObject(current);
            await Promise.all(behaviorPromises);

            this.registerLambdaComponentsForObject(current);

            if (PhysicsUtil.isPhysicsEnabled(current)) {
                await this.engine.physics?.addObject(current);
            }

            // Check enableAtStart property and disable object if set to false
            const enableAtStart =
                typeof current.userData.enableAtStart === "boolean" ? current.userData.enableAtStart : true; // default to true if not set

            if (!enableAtStart) {
                this.pauseObject(current, false); // Pause behaviors without cascading to children
            }

            // Respect paused flag after initialization (do not cascade here; each child will be processed separately)
            if (current.userData.paused) {
                this.pauseObject(current, false);
            }

            if (current.children && current.children.length) {
                for (const child of current.children) queue.push(child);
            }
        }
    }

    /**
     * Disposes of an Object3D's game-related resources, including behaviors and physics, recursively for all children.
     *
     * Note: This method does NOT remove the object from the scene or its parent. It only cleans up behaviors,
     * physics, and marks the object as not initialized for the game. To fully remove the object from the scene,
     * use removeObject().
     *
     * Usually this method is called from editor in sandbox mode, because the object removal is handled by the editor
     * @param object - The Object3D to dispose.
     */
    disposeObject(object: THREE.Object3D): void {
        // Clean up behaviors and physics for the object itself
        this.removeAllBehaviorsForObject(object);

        if (PhysicsUtil.isPhysicsEnabled(object)) {
            this.engine.physics?.removeObject(object);
        }

        // Recursively clean up child objects
        for (const child of object.children) {
            this.disposeObject(child);
        }
    }

    /**
     * Pauses the specified THREE.Object3D instance, optionally including all of its children.
     *
     * This method sets the `paused` flag in the object's `userData`, removes it from the physics simulation
     * if applicable, and pauses all associated behaviors. If `pauseChildren` is true, the method recursively
     * pauses all child objects as well.
     *
     * @param object - The THREE.Object3D to pause.
     * @param pauseChildren - Whether to recursively pause all child objects. Defaults to `true`.
     */
    pauseObject(object: THREE.Object3D, pauseChildren: boolean = true): void {
        // in sandbox mode the object can be paused by editor before it is initialized
        object.userData.paused = true;

        if (PhysicsUtil.isPhysicsEnabled(object)) {
            this.engine.physics?.removeObject(object);
        }

        this.behaviorManager!.pauseObjectBehaviors(object);

        if (pauseChildren) {
            for (const child of object.children) {
                this.pauseObject(child);
            }
        }
    }

    /**
     * Resumes the specified THREE.Object3D instance by unpausing it, re-adding it to the physics engine if applicable,
     * and resuming all associated behaviors. Optionally, this operation can be recursively applied to all child objects.
     *
     * @param object - The THREE.Object3D instance to resume.
     * @param resumeChildren - Whether to recursively resume all child objects. Defaults to true.
     */
    resumeObject(object: THREE.Object3D, resumeChildren: boolean = true): void {
        // in sandbox mode the object can be paused by editor before it is initialized
        object.userData.paused = false;

        if (PhysicsUtil.isPhysicsEnabled(object)) {
            this.engine.physics?.addObject(object);
        }

        this.behaviorManager!.resumeObjectBehaviors(object);

        if (resumeChildren) {
            for (const child of object.children) {
                this.resumeObject(child);
            }
        }
    }

    /**
     * Proxy to AnimationController's playBlendedAnimations
     * @param object
     * @param blends
     * @param playOnce
     */
    playBlendedAnimations(object: THREE.Object3D, blends: BlendedAnimationParams[], playOnce?: boolean) {
        this.animationController?.playBlendedAnimations(object, blends, playOnce);
    }

    /**
     * Proxy to AnimationController's updateBlendedAnimationWeights
     * @param object
     * @param weights
     */
    updateBlendedAnimationWeights(object: THREE.Object3D, weights: {[name: string]: number}) {
        this.animationController?.updateBlendedAnimationWeights(object, weights);
    }

    /**
     * Classify objects that are fully static at game start.
     * Static objects skip per-frame matrix updates and spatial grid tracking.
     * @param scene
     */
    private classifyStaticEntities(scene: THREE.Scene): void {
        let count = 0;
        scene.traverse((node: THREE.Object3D) => {
            if (this.isSceneStatic(node)) {
                node.userData._isSceneStatic = true;
                node.matrixAutoUpdate = false;
                node.matrixWorldAutoUpdate = false;
                count++;
            }
        });
        if (count > 0) {
            console.log(`[GameManager] Classified ${count} objects as scene-static`);
        }
    }

    private isSceneStatic(node: THREE.Object3D): boolean {
        if (!node.userData.isStemObject) return false;
        const physics = node.userData.physics as { type?: string } | undefined;
        if (physics && physics.type !== "static") return false;
        if ((node.userData.behaviors as unknown[] | undefined)?.length) return false;
        if ((node.userData.lambdaComponents as unknown[] | undefined)?.length) return false;
        if (node.userData.animation) return false;
        return true;
    }
}

export default GameManager;
