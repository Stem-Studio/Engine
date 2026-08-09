import {Camera, Group, MathUtils, Object3D, PerspectiveCamera, Quaternion, Scene, Vector3} from "three";
import type {WebGLRenderer} from "three";
import type {WebGPURenderer} from "three/webgpu";

import {AssetType, getAssetRevisionData} from "@stem/network/api/asset";
import {getImportRevisionMapFromScriptBundle, getLambdasFromScriptBundle} from "@stem/network/api/behavior";
import {updatePlayCount} from "@stem/network/api/getGames";
import {getLambdaRevisionData, getLambdasFromAssets, getLambdasListForScene} from "@stem/network/api/lambda";
import {emitRewardEvent, REWARD_EVENT_TYPES} from "@stem/network/api/rewards";
import {getDefaultUserAvatarModel} from "@stem/network/api/avatarCreator";
import EngineRuntime from "@stem/editor-oss/EngineRuntime";
import {AssetRef, assetRefKey} from "@stem/editor-oss/asset-management/AssetRef";
import {
    emptyAssetResolutionContext,
    getAssetResolutionContext,
    mergeAssetResolutionContexts,
    resolveAssetRevisionId,
} from "@stem/editor-oss/asset-management/AssetResolutionContext";
import {applyCameraProjectionSettings} from "../../camera/cameraSettings";
import type AiWorldController from "../../controls/AiWorldController/AiWorldController";
import {AnimationController, BlendedAnimationParams} from "../../controls/AnimationController";
import {AnimationGraphController} from "../../controls/AnimationGraphController";
import {AudioController} from "../../controls/AudioController";
import {CameraControl, ICameraControl} from "../../controls/CameraControl";
import {PlayerActions} from "../../controls/input/ActionTypes";
import {defaultBindings} from "../../controls/input/DefaultBindings";
import {InputManager} from "../../controls/input/InputManager";
import {PointerEventManager} from "../../controls/input/PointerEventManager";
import type {RuntimeContext} from "../../core/RuntimeContext";
import {breakpointManager, shouldShowDebuggerTooltip} from "../../editor/assets/v2/BehaviorEditor/breakpoints";
import {UniformSpatialGrid} from "../../scheduler/spatial/UniformSpatialGrid";
import type {FrameContext} from "../../scheduler/types";
import type {FixedStepSimulationFrame} from "../../core/simulation/FixedStepSimulationClock";
import {
    configurePlotBudgetManagerFromEngine,
    PlotBudgetManager,
} from "../../core/budget/PlotBudgetPolicy";
import {
    configureTextureResidencyManagerFromEngine,
    TextureResidencyManager,
} from "../../core/budget/TextureResidencyPolicy";
import {
    RuntimeBudgetCoordinator,
    type RuntimeBudgetManagers,
    type RuntimeBudgetSnapshot,
} from "../../core/budget/RuntimeBudgetCoordinator";
import type {AssetSource} from "@stem/editor-oss/asset-management/SceneAssetSource";
import {PhysicsConfig} from "../../physics/common/physicsConfig";
import type {LambdaComponentData, LambdaConfig} from "../../lambdas/Lambda";
import {LambdaFileLoader} from "../../lambdas/LambdaFileLoader";
import {LambdaManager} from "../../lambdas/LambdaManager";
import type LambdaScriptInjector from "../../lambdas/LambdaScriptInjector";
import {CollisionBehavior, ICollisionSource, IPhysics} from "../../physics/common/types";
import {PhysicsRuntimeUtil as PhysicsUtil} from "../../physics/PhysicsRuntimeUtil";
import {MultiplayerUtils} from "../../physics/simple/MultiplayerUtils";
import {PrefabManager} from "@stem/editor-oss/prefab/PrefabManager";
import {SceneConfig} from "@stem/editor-oss/scene/SceneConfig";
import {showToast} from "@stem/editor-oss/showToast";
import {isParticleEmitterObject, isVFXAutoStartEnabled} from "@stem/editor-oss/utils/vfxRuntime";
import {buildNameAwareScriptImportContext, loadScriptImportRevisionMap} from "../../script-runtime/scriptImportCore";
import {ensureRenderableMeshNormalsProgressive} from "../../render/ensureRenderableMeshNormals";
import {CAMERA_TYPES, CharacterOptionsInterface, GAME_STATE, IFRAME_MESSAGES, ISoundSettings} from "@stem/editor-oss/types/editor";
import type {GameLoginData} from "../../ui/common/InGameLogin/InGameLogin";
import type UnifiedGameServicesController from "../../userManagement/playerProfile/UnifiedGameServicesController";
import type {IUser} from "../../userManagement/types";
import type {GameServiceType} from "../../userManagement/utils/PlatformDetector";
import Ajax from "@stem/editor-oss/utils/Ajax";
import Instancer from "@stem/editor-oss/utils/Instancer";
import {LoadingMessages} from "@stem/editor-oss/utils/LoadingManager";
import {getLogger, LogLevel} from "@stem/editor-oss/utils/Logger";
import ObjectPicker, {IObjectPicker} from "@stem/editor-oss/utils/ObjectPicker";
import SceneObjectLookup from "@stem/editor-oss/utils/SceneObjectLookup";
import {createProgressiveYieldController} from "@stem/editor-oss/utils/progressiveYield";
import {setRuntimeUserDataValue} from "@stem/editor-oss/utils/userDataRuntime";
import {cloneObject} from "@stem/editor-oss/utils/ObjectUtils";
import {
    traverseObjectDepthFirst,
    traverseObjectDepthFirstWithConsumers,
} from "@stem/editor-oss/utils/SceneTraverser";
import {SceneLoadProfiler} from "@stem/editor-oss/utils/SceneLoadProfiler";
import TagUtil from "@stem/editor-oss/utils/TagUtil";
import {isRuntimeSceneRevealPendingOrActive} from "../../utils/runtimeSceneReveal";
import {Behavior} from "../Behavior";
import BehaviorClassConfig from "../BehaviorClassConfig";
import BehaviorData from "../BehaviorData";
import {BehaviorFileLoader} from "../BehaviorFileLoader";
import BehaviorManager, {CreateBehaviorOptions} from "../BehaviorManager";
import type BehaviorScriptInjector from "../BehaviorScriptInjector";
import CollisionDetector from "../collisions/CollisionDetector";
import EventBus, {IN_GAME_EVENTS} from "../event/EventBus";
import type {IHUDManager} from "../hud/IHUDManager";
import type AIConversationManager from "../packs/aiNpc/AiConversationManager";
import type {IMultiplayerState} from "../state/IMultiplayerState";
import {ensureUIKitRuntimeInitialized} from "../uikit/UIKitInitialization";
import {isLegacyBehaviorId} from "../util";
import type {ViewportSafeArea} from "../../utils/viewportSafeArea";
import type {DiscordService} from "../../userManagement/playerProfile/services/DiscordService";
import type {IQualitySettings} from "../../core/quality/interfaces/IQualityManager";
import {yieldPlayStartToPaint} from "./playStartYield";

type UIKitPointerEventsModule = typeof import("../uikit/UIKitPointerEvents");
type DiscordServiceModule = typeof import("../../userManagement/playerProfile/services/DiscordService");
type RuntimeQualityManagerLike = {
    on?: (event: "qualityChanged", callback: () => void) => void;
    off?: (event: "qualityChanged", callback: () => void) => void;
    getCurrentSettings?: () => IQualitySettings | null | undefined;
};

const DEFAULT_RUNTIME_FRAME_BUDGET_MS = 12;
const DEFAULT_RUNTIME_TARGET_FRAME_MS = 1000 / 60;
const RUNTIME_FRAME_PRESSURE_EMA_ALPHA = 0.125;
const PLAY_START_FRAME_BUDGET_MS = 4;
const PLAY_START_DISCOVERY_OBJECT_BATCH_SIZE = 32;
const PLAY_START_ADD_OBJECT_INITIALIZATION_BATCH_SIZE = 32;
const PLAY_START_BEHAVIOR_DISCOVERY_OBJECT_BATCH_SIZE = 128;
const PLAY_START_BEHAVIOR_CREATION_STEP_BATCH_SIZE = 16;
// A behavior that takes roughly half a 60 Hz frame is expensive enough to
// deserve an immediate paint before the next startup behavior. Cheaper
// behaviors remain under the progressive controller's normal batch/budget
// cadence, while behavior code can still explicitly call options.yieldToFrame.
const PLAY_START_SLOW_BEHAVIOR_THRESHOLD_MS = 8;
const PLAY_START_SCRIPT_CLASS_BATCH_SIZE = 1;
const PLAY_START_BEHAVIOR_RESET_BATCH_SIZE = 8;
const PLAY_START_SCENE_MUTATION_QUIESCENCE_IDLE_TIMEOUT_MS = 15_000;
const PLAY_START_YIELD_DEFAULTS = {
    batchSize: PLAY_START_DISCOVERY_OBJECT_BATCH_SIZE,
    frameBudgetMs: PLAY_START_FRAME_BUDGET_MS,
};
const PLAY_START_BEHAVIOR_DISCOVERY_YIELD_DEFAULTS = {
    batchSize: PLAY_START_BEHAVIOR_DISCOVERY_OBJECT_BATCH_SIZE,
    frameBudgetMs: PLAY_START_FRAME_BUDGET_MS,
};
const PLAY_START_BEHAVIOR_CREATION_YIELD_DEFAULTS = {
    // Behavior lifecycle ordering remains serial and priority-stable, but
    // startup is behind the loading mask. An 8 ms slice avoids scheduling a
    // paint for every small cluster of constructors while still yielding
    // before a full 60 Hz frame is monopolized. Explicit behavior-facing
    // yieldToFrame() calls remain forceful and are not coalesced.
    batchSize: PLAY_START_BEHAVIOR_CREATION_STEP_BATCH_SIZE * 2,
    frameBudgetMs: PLAY_START_FRAME_BUDGET_MS * 2,
};
const AI_NPC_BEHAVIOR_ID = "aiNpc";

const createPlayStartYieldController = () => createProgressiveYieldController(
    {yieldToFrame: yieldPlayStartToPaint},
    PLAY_START_YIELD_DEFAULTS,
);

const createPlayStartBehaviorDiscoveryYieldController = () => createProgressiveYieldController(
    {yieldToFrame: yieldPlayStartToPaint},
    PLAY_START_BEHAVIOR_DISCOVERY_YIELD_DEFAULTS,
);

const createPlayStartBehaviorCreationYieldController = () => createProgressiveYieldController(
    {yieldToFrame: yieldPlayStartToPaint},
    PLAY_START_BEHAVIOR_CREATION_YIELD_DEFAULTS,
);

async function waitForRuntimeSceneReveal(
    scene: Scene,
    shouldContinue: () => boolean,
): Promise<void> {
    while (isRuntimeSceneRevealPendingOrActive(scene) && shouldContinue()) {
        await yieldPlayStartToPaint();
    }
}

let uikitPointerEventsModule: UIKitPointerEventsModule | null = null;
let uikitPointerEventsPromise: Promise<UIKitPointerEventsModule> | null = null;

function loadUIKitPointerEvents(): Promise<UIKitPointerEventsModule> {
    if (uikitPointerEventsModule) {
        return Promise.resolve(uikitPointerEventsModule);
    }
    if (!uikitPointerEventsPromise) {
        uikitPointerEventsPromise = import("../uikit/UIKitPointerEvents").then(module => {
            uikitPointerEventsModule = module;
            return module;
        });
    }
    return uikitPointerEventsPromise;
}

function forceDisposeUIKitPointerEventsIfLoaded() {
    if (uikitPointerEventsModule) {
        uikitPointerEventsModule.default.forceDispose();
        return;
    }
    if (uikitPointerEventsPromise) {
        void uikitPointerEventsPromise.then(module => module.default.forceDispose());
    }
}

type BehaviorScriptInjectorModule = typeof import("../BehaviorScriptInjector");

let behaviorScriptInjectorModule: BehaviorScriptInjectorModule | null = null;
let behaviorScriptInjectorPromise: Promise<BehaviorScriptInjectorModule> | null = null;

function loadBehaviorScriptInjector(): Promise<BehaviorScriptInjectorModule> {
    if (behaviorScriptInjectorModule) {
        return Promise.resolve(behaviorScriptInjectorModule);
    }
    if (!behaviorScriptInjectorPromise) {
        behaviorScriptInjectorPromise = import("../BehaviorScriptInjector")
            .then(module => {
                behaviorScriptInjectorModule = module;
                return module;
            })
            .catch(error => {
                behaviorScriptInjectorPromise = null;
                throw error;
            });
    }
    return behaviorScriptInjectorPromise;
}

export async function preloadGameManagerRuntimeModules(): Promise<void> {
    await loadBehaviorScriptInjector();
}

function createOSSGameServicesController(): UnifiedGameServicesController {
    const controller = {
        async start() {},
        stop() {},
        async submitScore() {
            return false;
        },
        async unlockAchievement() {
            return false;
        },
        async showLeaderboards() {
            return false;
        },
        async showAchievements() {
            return false;
        },
        getActiveService() {
            return "none" as GameServiceType;
        },
        getActiveServiceName() {
            return "None";
        },
        getCurrentUser() {
            return null;
        },
        isAnyServiceAvailable() {
            return false;
        },
        isAuthenticated() {
            return false;
        },
        getIsInitialized() {
            return false;
        },
        isEmailPasswordEnabled() {
            return false;
        },
        isCrazyGamesEnabled() {
            return false;
        },
        getCrazyGamesController() {
            return null;
        },
        async authenticateWithEmailPassword() {
            return false;
        },
        async registerWithEmailPassword() {
            return false;
        },
        async linkAnonymousToEmailPassword() {
            return false;
        },
        async authenticateWithSteam() {
            return false;
        },
        async authenticateWithDiscord() {
            return false;
        },
        async authenticateWithCrazyGames() {
            return false;
        },
        canUpgradeAnonymousAccount() {
            return false;
        },
        getAvailableAccountUpgrades() {
            return [] as GameServiceType[];
        },
    };
    return controller as unknown as UnifiedGameServicesController;
}

function createLazyDiscordService(engine: EngineRuntime): DiscordService {
    let service: DiscordService | null = null;
    let servicePromise: Promise<DiscordService> | null = null;

    const loadService = (): Promise<DiscordService> => {
        if (service) return Promise.resolve(service);
        if (!servicePromise) {
            servicePromise = import("../../userManagement/playerProfile/services/DiscordService")
                .then((module: DiscordServiceModule) => {
                    service = new module.DiscordService();
                    return service;
                })
                .finally(() => {
                    servicePromise = null;
                });
        }
        return servicePromise;
    };

    return {
        isAuthenticated() {
            return !!engine.authManager?.getDiscordAccessToken();
        },
        setDiscordToken(token: string) {
            engine.authManager?.setDiscordAccessToken(token);
            if (service) service.setDiscordToken(token);
        },
        getCurrentUser(forceRefresh?: boolean) {
            return loadService().then(discord => discord.getCurrentUser(forceRefresh));
        },
        getUserGuilds(forceRefresh?: boolean) {
            return loadService().then(discord => discord.getUserGuilds(forceRefresh));
        },
        getUserFriends(forceRefresh?: boolean) {
            return loadService().then(discord => discord.getUserFriends(forceRefresh));
        },
        getGuildChannels(guildId: string) {
            return loadService().then(discord => discord.getGuildChannels(guildId));
        },
        sendMessage(channelId: string, content: string) {
            return loadService().then(discord => discord.sendMessage(channelId, content));
        },
        isGuildOwner(guildId: string) {
            return loadService().then(discord => discord.isGuildOwner(guildId));
        },
        hasAdminPermissions(guildId: string) {
            return loadService().then(discord => discord.hasAdminPermissions(guildId));
        },
        updateStatus(status: string, activity?: {name: string; type: number}) {
            return loadService().then(discord => discord.updateStatus(status, activity));
        },
    } as DiscordService;
}

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

interface RuntimeBehaviorBinding {
    behavior: BehaviorData;
    target: Object3D;
}

const WORLD_BEHAVIOR_STARTUP_OFFSET = -1_000_000;
const LATE_BEHAVIOR_STARTUP_OFFSET = 1_000_000;
const WORLD_BEHAVIOR_TAGS = new Set(["environment", "terrain", "world"]);

type SceneRuntimeFeatures = {
    usesBehaviorId: boolean;
    usesLambdas: boolean;
};

type PlayBehaviorTimingEntry = {
    id: string;
    label: string;
    target: string;
    ms: number;
};

type PlayStartupTimingEntry = {
    phase: string;
    ms: number;
    success: boolean;
    message?: string;
    startedAt?: number;
    endedAt?: number;
};

const PLAY_START_SLOW_TIMING_LOG_THRESHOLD_MS = 500;

const nowForPlayStartupTiming = (): number =>
    typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();

function recordPlayStartupTiming(entry: PlayStartupTimingEntry): void {
    const root = globalThis as typeof globalThis & {
        __stemPlayStartTimings?: PlayStartupTimingEntry[];
        __stemPlayStartupActivePhases?: Array<{phase: string; startedAt: number}>;
    };
    root.__stemPlayStartTimings ??= [];
    root.__stemPlayStartTimings.push(entry);
    if (!entry.success || entry.ms >= PLAY_START_SLOW_TIMING_LOG_THRESHOLD_MS) {
        console.debug(
            `[PlayStartupTiming] ${entry.phase} ${entry.ms}ms ok=${entry.success}` +
                (entry.message ? ` ${entry.message}` : ""),
        );
    }
}

function pushPlayStartupPhase(phase: string, startedAt: number): void {
    const root = globalThis as typeof globalThis & {
        __stemPlayStartupActivePhases?: Array<{phase: string; startedAt: number}>;
    };
    root.__stemPlayStartupActivePhases ??= [];
    root.__stemPlayStartupActivePhases.push({phase, startedAt});
}

function popPlayStartupPhase(phase: string, startedAt: number): void {
    const root = globalThis as typeof globalThis & {
        __stemPlayStartupActivePhases?: Array<{phase: string; startedAt: number}>;
    };
    const phases = root.__stemPlayStartupActivePhases;
    if (!phases?.length) return;
    const index = phases.findIndex(entry => entry.phase === phase && entry.startedAt === startedAt);
    if (index >= 0) phases.splice(index, 1);
}

async function timePlayStartupPhase<T>(phase: string, task: () => Promise<T> | T): Promise<T> {
    const startedAt = nowForPlayStartupTiming();
    pushPlayStartupPhase(phase, startedAt);
    try {
        const result = await task();
        const endedAt = nowForPlayStartupTiming();
        recordPlayStartupTiming({
            phase,
            ms: Math.round(endedAt - startedAt),
            success: true,
            startedAt,
            endedAt,
        });
        return result;
    } catch (error) {
        const endedAt = nowForPlayStartupTiming();
        recordPlayStartupTiming({
            phase,
            ms: Math.round(endedAt - startedAt),
            success: false,
            message: error instanceof Error ? error.message : String(error),
            startedAt,
            endedAt,
        });
        throw error;
    } finally {
        popPlayStartupPhase(phase, startedAt);
    }
}

function recordPlayBehaviorStartupTiming(entry: PlayBehaviorTimingEntry): void {
    const root = globalThis as typeof globalThis & {
        __stemBhvTimings?: Record<string, number>;
        __stemPlayBehaviorTimings?: PlayBehaviorTimingEntry[];
        __stemPlayBehaviorPhaseTimings?: unknown[];
    };
    root.__stemBhvTimings ??= {};
    root.__stemBhvTimings[entry.label] = (root.__stemBhvTimings[entry.label] ?? 0) + entry.ms;
    root.__stemPlayBehaviorTimings ??= [];
    root.__stemPlayBehaviorTimings.push(entry);
}

export function resetPlayBehaviorStartupTimings(): void {
    const root = globalThis as typeof globalThis & {
        __stemBhvTimings?: Record<string, number>;
        __stemPlayBehaviorTimings?: PlayBehaviorTimingEntry[];
        __stemPlayBehaviorPhaseTimings?: unknown[];
        __stemPlayBehaviorPhaseTimingsDropped?: number;
        __stemPlayStartupActivePhases?: Array<{phase: string; startedAt: number}>;
    };
    root.__stemBhvTimings = {};
    root.__stemPlayBehaviorTimings = [];
    root.__stemPlayBehaviorPhaseTimings = [];
    root.__stemPlayBehaviorPhaseTimingsDropped = 0;
    root.__stemPlayStartupActivePhases = [];
}

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
    pickedWeaponOrItem?: Object3D;
    playerWeapons: Object3D[] = [];

    //used by behaviors
    ajax = Ajax;
    inputManager: InputManager<PlayerActions>;
    pointerEventManager: PointerEventManager;
    physics?: IPhysics;
    player?: Object3D | null;
    uiCamera?: Camera;

    // Live reads through engine — never stale
    get scene(): Scene { return this.engine.scene; }
    get sceneHelpers(): Group { return this.engine.sceneHelpers; }
    get camera(): PerspectiveCamera { return this.engine.camera; }
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
    playerStartingPosition?: Vector3;
    /**
     * Player transforms are normally physics-authoritative. Custom game
     * behaviors may intentionally drive a dynamic rigid body by editing its
     * Object3D transform (for example a ship controller). Keep that contract
     * explicit so built-in character controllers are not fed their visual
     * pose back into the physics world.
     */
    private playerTransformOwnership: "script" | "controller" = "script";
    private readonly playerPhysicsPosition = new Vector3();
    private readonly playerPhysicsQuaternion = new Quaternion();
    private readonly playerPhysicsScale = new Vector3();
    private readonly playerPhysicsZeroVelocity = new Vector3();
    /** Last transform authored by a script-owned dynamic player. */
    private hasScriptDrivenPlayerTransform = false;
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
    private runtimeBudgetManagers?: RuntimeBudgetManagers;
    prefabManager?: PrefabManager;
    isMultiplayer: boolean = false;
    tweenAnimations?: any[];
    /**
     * Per-game Tween.js group ref ticked by the legacy runtime each frame. The
     * tween library loads lazily on first `erth.tween.to(...)` so the
     * engine bundle stays minimal; until then `current` is null.
     */
    tweenGroupRef?: {current: import("@tweenjs/tween.js").Group | null};
    behaviorScripts: Record<string, string> = {};
    behaviorNames: Record<string, string> = {};
    private behaviorStartupPriorityOffsets = new Map<string, number>();
    lambdaScripts: Record<string, string> = {};
    lambdaScriptRevisions: Record<string, {assetId: string; revisionId: string}> = {};
    private uikitInitPromise: Promise<void> | null = null;
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
    private startGamePromise: Promise<void> | null = null;
    private playStartupSceneMutationToken = 0;
    private playStartupSceneMutations = new Set<Promise<void>>();
    private playStartupSceneMutationRejectionCount = 0;
    private playStartupSceneMutationProgressToken = 0;
    private playStartupSceneMutationLastProgressAt = 0;
    private playStartupSceneMutationProgressCount = 0;
    private playStartupSceneMutationCancellation: {
        token: number;
        promise: Promise<"cancelled">;
        resolve: () => void;
    } | null = null;
    private unifiedGameServices: UnifiedGameServicesController | null = null;
    private aiWorldControllerPromise: Promise<AiWorldController> | null = null;
    private runtimeQualityManager: RuntimeQualityManagerLike | null = null;
    private runtimeBudgetPolicySignature: string | null = null;
    private runtimeYieldController = createPlayStartYieldController();
    private runtimeFrameCount = 0;
    private runtimeFrameAvgMs = DEFAULT_RUNTIME_TARGET_FRAME_MS;
    private runtimeFrameBudgetMs = DEFAULT_RUNTIME_FRAME_BUDGET_MS;
    private runtimeTargetFrameMs = DEFAULT_RUNTIME_TARGET_FRAME_MS;
    private runtimeDeltaPressureThreshold = 1.25;
    private deferredStartupOptimizationToken = 0;
    private deferredStartupOptimizationPromise: Promise<void> | null = null;
    private runtimeSpatialGrid: UniformSpatialGrid | null = null;
    private runtimeSpatialObjectIds = new Set<string>();
    private previousRuntimeSpatialObjectIds = new Set<string>();
    private runtimeSpatialTrackingGrid: UniformSpatialGrid | null = null;
    private runtimeSpatialTrackingIds: Set<string> | null = null;
    private runtimeSpatialTrackObjectCallback: ((object: Object3D | null | undefined) => void) | null = null;
    private runtimeFrameContext: FrameContext | null = null;
    private objectLookup?: SceneObjectLookup;
    private readonly handleRuntimeQualityChanged = () => {
        this.configureRuntimeBudgetManagersFromQuality();
    };

    public getUnifiedGameServices(): UnifiedGameServicesController | null {
        return this.unifiedGameServices;
    }

    public setRenderer(renderer: WebGLRenderer | WebGPURenderer | null | undefined): void {
        if (renderer) {
            this.objectPicker?.updateRenderer(renderer);
        }
    }

    private getRuntimeQualityManager(): RuntimeQualityManagerLike | null {
        return (this.engine as {qualityManager?: RuntimeQualityManagerLike} | null | undefined)?.qualityManager ?? null;
    }

    private configureRuntimeBudgetManagersFromQuality(): void {
        const settings = this.getRuntimeQualityManager()?.getCurrentSettings?.() ?? null;
        this.configureRuntimeFrameBudgetFromQuality(settings);
        if (this.runtimeBudgetCoordinator) {
            this.runtimeBudgetCoordinator.configureFromQuality(settings);
        }
        this.runtimeBudgetPolicySignature = null;
        this.configurePressureDrivenBudgetManagers(this.runtimeBudgetCoordinator?.getSnapshot?.(), true);
    }

    private getRuntimeBudgetPolicySignature(snapshot: Readonly<RuntimeBudgetSnapshot> | null | undefined): string | null {
        if (!snapshot) {
            return null;
        }
        return [
            snapshot.enabled ? "1" : "0",
            snapshot.pressure,
            snapshot.targetTextureBytes,
            snapshot.isMobile ? "1" : "0",
        ].join(":");
    }

    private configurePressureDrivenBudgetManagers(
        snapshot: Readonly<RuntimeBudgetSnapshot> | null | undefined,
        force = false,
    ): void {
        const signature = this.getRuntimeBudgetPolicySignature(snapshot);
        if (!force && signature && signature === this.runtimeBudgetPolicySignature) {
            return;
        }
        if (this.plotBudgetManager) {
            configurePlotBudgetManagerFromEngine(this.plotBudgetManager, this.engine);
        }
        if (this.textureResidencyManager) {
            configureTextureResidencyManagerFromEngine(this.textureResidencyManager, this.engine);
        }
        this.runtimeBudgetPolicySignature = signature;
    }

    private listenRuntimeQualityChanges(): void {
        this.unlistenRuntimeQualityChanges();
        const qualityManager = this.getRuntimeQualityManager();
        if (!qualityManager?.on) {
            return;
        }
        qualityManager.on("qualityChanged", this.handleRuntimeQualityChanged);
        this.runtimeQualityManager = qualityManager;
    }

    private unlistenRuntimeQualityChanges(): void {
        this.runtimeQualityManager?.off?.("qualityChanged", this.handleRuntimeQualityChanged);
        this.runtimeQualityManager = null;
    }

    public getViewportSafeArea(): ViewportSafeArea {
        return this.engine.getViewportSafeArea();
    }

    public getObjectByUUID(uuid: string | null | undefined): Object3D | null {
        return this.getObjectLookup().getByUuid(uuid);
    }

    public clearObjectLookupCache(): void {
        this.objectLookup?.clear();
    }

    private getObjectLookup(): SceneObjectLookup {
        this.objectLookup ??= new SceneObjectLookup(() => this.scene);
        return this.objectLookup;
    }

    private resetRuntimeYieldController(
        createController: () => (force?: boolean) => Promise<void> = createPlayStartYieldController,
    ): (force?: boolean) => Promise<void> {
        this.runtimeYieldController = createController();
        return this.runtimeYieldController;
    }

    public yieldRuntimeToFrame(force = false): Promise<void> {
        return this.runtimeYieldController(force);
    }

    private beginPlayStartupSceneMutationBarrier(): number {
        this.playStartupSceneMutationCancellation?.resolve();
        this.playStartupSceneMutationToken = (this.playStartupSceneMutationToken ?? 0) + 1;
        this.playStartupSceneMutations?.clear();
        this.playStartupSceneMutationRejectionCount = 0;
        const token = this.playStartupSceneMutationToken;
        this.playStartupSceneMutationProgressToken = token;
        this.playStartupSceneMutationLastProgressAt = nowForPlayStartupTiming();
        this.playStartupSceneMutationProgressCount = 1;
        let resolveCancellation!: () => void;
        const promise = new Promise<"cancelled">(resolve => {
            resolveCancellation = () => resolve("cancelled");
        });
        this.playStartupSceneMutationCancellation = {
            token,
            promise,
            resolve: resolveCancellation,
        };
        return this.playStartupSceneMutationToken;
    }

    private invalidatePlayStartupSceneMutationBarrier(): void {
        this.playStartupSceneMutationCancellation?.resolve();
        this.playStartupSceneMutationToken = (this.playStartupSceneMutationToken ?? 0) + 1;
        this.playStartupSceneMutations?.clear();
        this.playStartupSceneMutationRejectionCount = 0;
        this.playStartupSceneMutationProgressToken = 0;
        this.playStartupSceneMutationLastProgressAt = 0;
        this.playStartupSceneMutationProgressCount = 0;
        this.playStartupSceneMutationCancellation = null;
    }

    private isCurrentPlayStartupSceneMutationToken(token: number): boolean {
        return this.playStartupSceneMutationToken === token;
    }

    private touchPlayStartupSceneMutationProgress(token = this.playStartupSceneMutationToken): void {
        if (
            !this.isInitializing ||
            !this.isCurrentPlayStartupSceneMutationToken(token) ||
            this.playStartupSceneMutationProgressToken !== token
        ) {
            return;
        }
        this.playStartupSceneMutationLastProgressAt = nowForPlayStartupTiming();
        this.playStartupSceneMutationProgressCount += 1;
    }

    private trackPlayStartupSceneMutation(operation: Promise<void>, token: number): Promise<void> {
        this.playStartupSceneMutations ??= new Set();
        this.touchPlayStartupSceneMutationProgress(token);
        let trackedOperation: Promise<void>;
        trackedOperation = Promise.resolve(operation)
            .catch(error => {
                if (this.isCurrentPlayStartupSceneMutationToken(token)) {
                    this.playStartupSceneMutationRejectionCount =
                        (this.playStartupSceneMutationRejectionCount ?? 0) + 1;
                    console.warn("[GameManager] Startup scene mutation rejected:", error);
                }
                throw error;
            })
            .finally(() => {
                if (this.isCurrentPlayStartupSceneMutationToken(token)) {
                    this.playStartupSceneMutations?.delete(trackedOperation);
                    this.touchPlayStartupSceneMutationProgress(token);
                }
            });

        this.playStartupSceneMutations.add(trackedOperation);
        void trackedOperation.catch(() => {});
        return trackedOperation;
    }

    private async awaitPlayStartupSceneMutationQuiescence(token: number): Promise<void> {
        const startedAt = nowForPlayStartupTiming();
        let maxPending = this.playStartupSceneMutations?.size ?? 0;
        let passes = 0;
        let timedOut = false;
        const initialProgressCount = this.playStartupSceneMutationProgressToken === token
            ? this.playStartupSceneMutationProgressCount
            : 0;

        try {
            while (this.isCurrentPlayStartupSceneMutationToken(token)) {
                const now = nowForPlayStartupTiming();
                const lastProgressAt = this.playStartupSceneMutationProgressToken === token
                    ? this.playStartupSceneMutationLastProgressAt
                    : startedAt;
                const idleMs = Math.max(0, now - lastProgressAt);
                const remainingMs = PLAY_START_SCENE_MUTATION_QUIESCENCE_IDLE_TIMEOUT_MS - idleMs;
                if (remainingMs <= 0) {
                    timedOut = true;
                    break;
                }

                const pending = Array.from(this.playStartupSceneMutations ?? []);
                maxPending = Math.max(maxPending, pending.length);
                if (pending.length === 0) {
                    await Promise.resolve();
                    if ((this.playStartupSceneMutations?.size ?? 0) === 0) {
                        break;
                    }
                    continue;
                }

                passes += 1;
                const waitForPending = Promise.allSettled(pending).then(() => "settled" as const);
                let timeoutId: ReturnType<typeof setTimeout> | undefined;
                const timeout = new Promise<"timeout">(resolve => {
                    timeoutId = setTimeout(() => resolve("timeout"), Math.max(0, remainingMs));
                });
                const cancellation = this.playStartupSceneMutationCancellation?.token === token
                    ? this.playStartupSceneMutationCancellation.promise
                    : Promise.resolve("cancelled" as const);
                const result = await Promise.race([waitForPending, timeout, cancellation]);
                if (timeoutId !== undefined) {
                    clearTimeout(timeoutId);
                }
                if (result === "timeout") {
                    const idleAfterTimeout = nowForPlayStartupTiming() - (
                        this.playStartupSceneMutationProgressToken === token
                            ? this.playStartupSceneMutationLastProgressAt
                            : startedAt
                    );
                    if (idleAfterTimeout >= PLAY_START_SCENE_MUTATION_QUIESCENCE_IDLE_TIMEOUT_MS) {
                        timedOut = true;
                        break;
                    }
                    continue;
                }
                if (result === "cancelled") {
                    break;
                }
                await Promise.resolve();
            }
        } finally {
            const endedAt = nowForPlayStartupTiming();
            const cancelled = !this.isCurrentPlayStartupSceneMutationToken(token);
            const lastProgressAt = this.playStartupSceneMutationProgressToken === token
                ? this.playStartupSceneMutationLastProgressAt
                : startedAt;
            const progressCount = this.playStartupSceneMutationProgressToken === token
                ? Math.max(0, this.playStartupSceneMutationProgressCount - initialProgressCount)
                : 0;
            recordPlayStartupTiming({
                phase: "gameStart:sceneMutationQuiescence",
                ms: Math.round(endedAt - startedAt),
                success: !cancelled && !timedOut,
                message: `totalMs=${Math.round(endedAt - startedAt)} idleMs=${Math.round(Math.max(0, endedAt - lastProgressAt))}` +
                    ` progress=${progressCount} pendingMax=${maxPending}` +
                    ` rejected=${this.playStartupSceneMutationRejectionCount ?? 0} passes=${passes}` +
                    (cancelled ? " cancelled=true" : "") +
                    (timedOut
                        ? ` timedOut=true idleTimeoutMs=${PLAY_START_SCENE_MUTATION_QUIESCENCE_IDLE_TIMEOUT_MS}`
                        : ""),
                startedAt,
                endedAt,
            });
            if (timedOut && this.isCurrentPlayStartupSceneMutationToken(token)) {
                this.playStartupSceneMutations?.clear();
            }
        }
    }

    private configureRuntimeFrameBudgetFromQuality(settings?: IQualitySettings | null): void {
        const configuredBudget = settings?.scheduler?.frameBudgetMs;
        this.runtimeFrameBudgetMs = Number.isFinite(configuredBudget) && configuredBudget! > 0
            ? configuredBudget!
            : DEFAULT_RUNTIME_FRAME_BUDGET_MS;

        const fixedTimestepHz = settings?.scheduler?.fixedTimestepHz;
        this.runtimeTargetFrameMs = Number.isFinite(fixedTimestepHz) && fixedTimestepHz! > 0
            ? 1000 / fixedTimestepHz!
            : DEFAULT_RUNTIME_TARGET_FRAME_MS;

        const configuredThreshold = settings?.scheduler?.deltaTimePressureThreshold;
        this.runtimeDeltaPressureThreshold = Number.isFinite(configuredThreshold) && configuredThreshold! > 0
            ? configuredThreshold!
            : 1.25;
    }

    private getRuntimeFrameBudgetMs(): number {
        const schedulerBudget = (this.lambdaManager as {scheduler?: {frameBudgetMs?: number}} | null | undefined)
            ?.scheduler
            ?.frameBudgetMs;
        if (Number.isFinite(schedulerBudget) && schedulerBudget! > 0) {
            return schedulerBudget!;
        }

        return Number.isFinite(this.runtimeFrameBudgetMs) && this.runtimeFrameBudgetMs > 0
            ? this.runtimeFrameBudgetMs
            : DEFAULT_RUNTIME_FRAME_BUDGET_MS;
    }

    private ensureRuntimeSpatialGridState(): void {
        if (!this.runtimeSpatialGrid) {
            this.runtimeSpatialGrid = new UniformSpatialGrid();
        }
        if (!this.runtimeSpatialObjectIds) {
            this.runtimeSpatialObjectIds = new Set();
        }
        if (!this.previousRuntimeSpatialObjectIds) {
            this.previousRuntimeSpatialObjectIds = new Set();
        }
    }

    private resetRuntimeSpatialGrid(): void {
        this.runtimeSpatialGrid?.dispose();
        this.runtimeSpatialGrid = null;
        this.runtimeSpatialObjectIds?.clear();
        this.previousRuntimeSpatialObjectIds?.clear();
        this.runtimeSpatialTrackingGrid = null;
        this.runtimeSpatialTrackingIds = null;
    }

    private shouldTrackBehaviorSpatialTargets(): boolean {
        const behaviorThrottling = this.scene?.userData?.game?.behaviorThrottling;
        return (
            behaviorThrottling?.throttlingEnabled !== false &&
            behaviorThrottling?.enableDistanceThrottling !== false
        );
    }

    private createRuntimeFrameContext(
        deltaTime: number,
        simulationFrame?: Readonly<FixedStepSimulationFrame>,
    ): FrameContext {
        this.runtimeFrameCount = (this.runtimeFrameCount ?? 0) + 1;
        const frameStartTime = performance.now();
        const frameBudgetMs = this.getRuntimeFrameBudgetMs();
        const targetFrameMs = Number.isFinite(this.runtimeTargetFrameMs) && this.runtimeTargetFrameMs > 0
            ? this.runtimeTargetFrameMs
            : DEFAULT_RUNTIME_TARGET_FRAME_MS;
        const pressureThreshold = Number.isFinite(this.runtimeDeltaPressureThreshold) && this.runtimeDeltaPressureThreshold > 0
            ? this.runtimeDeltaPressureThreshold
            : 1.25;
        const deltaMs = Number.isFinite(deltaTime) && deltaTime > 0
            ? deltaTime * 1000
            : targetFrameMs;
        const previousFrameAvgMs = Number.isFinite(this.runtimeFrameAvgMs)
            ? this.runtimeFrameAvgMs
            : targetFrameMs;
        this.runtimeFrameAvgMs =
            previousFrameAvgMs + (deltaMs - previousFrameAvgMs) * RUNTIME_FRAME_PRESSURE_EMA_ALPHA;
        const underRenderPressure =
            deltaMs >= targetFrameMs * pressureThreshold ||
            this.runtimeFrameAvgMs >= targetFrameMs * pressureThreshold;
        const context = this.runtimeFrameContext ?? (this.runtimeFrameContext = {
            deltaTime,
            fixedDeltaTime: simulationFrame?.fixedDeltaTime ?? 1 / 60,
            frameCount: this.runtimeFrameCount,
            interpolationAlpha: simulationFrame?.interpolationAlpha ?? 1,
            fixedOverstep: simulationFrame?.fixedOverstep ?? 0,
            frameStartTime,
            frameDeadline: frameStartTime + frameBudgetMs,
            underRenderPressure,
            renderAvgMs: this.runtimeFrameAvgMs,
            spatialGrid: null,
            fixedUpdatesEnabled: simulationFrame !== undefined,
        });

        context.deltaTime = deltaTime;
        context.fixedDeltaTime = simulationFrame?.fixedDeltaTime ?? context.fixedDeltaTime;
        context.interpolationAlpha = simulationFrame?.interpolationAlpha ?? 1;
        context.fixedOverstep = simulationFrame?.fixedOverstep ?? 0;
        context.frameCount = this.runtimeFrameCount;
        context.frameStartTime = frameStartTime;
        context.frameDeadline = frameStartTime + frameBudgetMs;
        context.underRenderPressure = underRenderPressure;
        context.renderAvgMs = this.runtimeFrameAvgMs;
        context.spatialGrid = null;
        context.fixedUpdatesEnabled = simulationFrame !== undefined;
        context.fixedStepCount = simulationFrame?.fixedStepCount ?? 0;
        context.droppedFixedSteps = simulationFrame?.droppedSteps ?? 0;
        context.droppedSimulationTime = simulationFrame?.droppedTime ?? 0;
        context.totalDroppedSimulationTime = simulationFrame?.totalDroppedTime ?? 0;
        return context;
    }

    private getRuntimeSpatialTrackObjectCallback(): (object: Object3D | null | undefined) => void {
        return this.runtimeSpatialTrackObjectCallback ?? (
            this.runtimeSpatialTrackObjectCallback = this.trackRuntimeSpatialObject.bind(this)
        );
    }

    private trackRuntimeSpatialObject(object: Object3D | null | undefined): void {
        if (!object || !this.runtimeSpatialTrackingGrid || !this.runtimeSpatialTrackingIds) {
            return;
        }

        const id = object.uuid;
        if (this.runtimeSpatialTrackingIds.has(id)) {
            return;
        }

        this.runtimeSpatialTrackingIds.add(id);
        this.runtimeSpatialTrackingGrid.update(id, object);
    }

    private refreshRuntimeSpatialGrid(): UniformSpatialGrid | null {
        this.ensureRuntimeSpatialGridState();

        const grid = this.runtimeSpatialGrid!;
        const currentIds = this.runtimeSpatialObjectIds;
        const previousIds = this.previousRuntimeSpatialObjectIds;
        currentIds.clear();
        grid.beginFrame();
        this.runtimeSpatialTrackingGrid = grid;
        this.runtimeSpatialTrackingIds = currentIds;
        const trackObject = this.getRuntimeSpatialTrackObjectCallback();

        try {
            const shouldTrackBehaviorTargets = this.shouldTrackBehaviorSpatialTargets();
            const behaviorManager = this.behaviorManager as
                | (BehaviorManager & {
                    prepareFrameSpatialTargets?: (
                        callback: (object: Object3D | null | undefined) => void,
                        frameCount: number,
                        collectTargets?: boolean,
                    ) => void;
                    getBehaviors?: () => readonly Behavior[];
                })
                | undefined;
            if (behaviorManager?.prepareFrameSpatialTargets) {
                behaviorManager.prepareFrameSpatialTargets(
                    trackObject,
                    this.runtimeFrameCount,
                    shouldTrackBehaviorTargets,
                );
            } else if (shouldTrackBehaviorTargets) {
                const behaviors = behaviorManager?.getBehaviors?.() ?? [];
                for (const behavior of behaviors) {
                    if (behavior.throttleConfig?.enableDistanceThrottling !== false) {
                        trackObject(behavior.target);
                    }
                }
            }

            const lambdaManager = this.lambdaManager as
                | (LambdaManager & {forEachRegisteredObject?: (callback: (object: Object3D) => void) => void})
                | undefined;
            lambdaManager?.forEachRegisteredObject?.(trackObject);
        } finally {
            grid.endFrame();
            this.runtimeSpatialTrackingGrid = null;
            this.runtimeSpatialTrackingIds = null;
        }

        for (const staleId of previousIds) {
            if (!currentIds.has(staleId)) {
                grid.remove(staleId);
            }
        }

        this.previousRuntimeSpatialObjectIds = currentIds;
        this.runtimeSpatialObjectIds = previousIds;

        return currentIds.size > 0 ? grid : null;
    }

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
        this.discord = createLazyDiscordService(this.engine);
        this.unifiedGameServices = createOSSGameServicesController();
    }

    public async ensureAiWorldController(): Promise<AiWorldController> {
        if (this.aiWorldController) {
            return this.aiWorldController;
        }

        if (!this.aiWorldControllerPromise) {
            this.aiWorldControllerPromise = import("../../controls/AiWorldController/AiWorldController")
                .then(({default: AiWorldControllerClass}) => {
                    this.aiWorldController = new AiWorldControllerClass(this.engine, this.engine.scene, this.engine.camera);
                    return this.aiWorldController;
                })
                .finally(() => {
                    this.aiWorldControllerPromise = null;
                });
        }

        return this.aiWorldControllerPromise;
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

    private normalizeRuntimeGameSettings(scene: Scene): RuntimeGameSettings {
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
            uuid: typeof existing.uuid === "string" && existing.uuid ? existing.uuid : MathUtils.generateUUID(),
            isGame: (existing.isGame ?? _legacyEnabled) === true,
            lives: finiteNumber(existing.lives, this.initialLives),
            maxScore: finiteNumber(existing.maxScore, this.maxScore),
            timer: finiteNumber(existing.timer, 0),
        };

        scene.userData.game = gameSettings;
        return gameSettings;
    }

    private async detectSceneRuntimeFeatures(
        scene: Scene,
        behaviorId: string,
        yieldToFrame: () => Promise<void>,
    ): Promise<SceneRuntimeFeatures> {
        let usesBehaviorId = false;
        let usesLambdas = !!(
            (scene.userData?.lambdaInstances as unknown[] | undefined)?.length ||
            (scene.userData?.projectLambdaInstances as unknown[] | undefined)?.length
        );
        const maybeYield = createProgressiveYieldController(
            {yieldToFrame},
            PLAY_START_BEHAVIOR_DISCOVERY_YIELD_DEFAULTS,
        );
        const stack: Object3D[] = [scene];

        while (stack.length > 0 && (!usesBehaviorId || !usesLambdas)) {
            const object = stack.pop();
            if (!object) continue;

            if (!usesBehaviorId) {
                const behaviors = object.userData?.behaviors;
                usesBehaviorId = Array.isArray(behaviors) && behaviors.some(behavior => behavior?.id === behaviorId);
            }

            if (!usesLambdas) {
                const components = object.userData?.lambdaComponents;
                usesLambdas = Array.isArray(components) && components.length > 0;
            }

            for (let i = object.children.length - 1; i >= 0; i--) {
                const child = object.children[i];
                if (child) stack.push(child);
            }

            await maybeYield();
        }

        return {usesBehaviorId, usesLambdas};
    }

    private async findFirstObjectByTagProgressive(
        root: Object3D,
        tag: string | string[],
        yieldToFrame: () => Promise<void>,
    ): Promise<Object3D | null> {
        const tags = Array.isArray(tag) ? tag : [tag];
        const maybeYield = createProgressiveYieldController(
            {yieldToFrame},
            PLAY_START_BEHAVIOR_DISCOVERY_YIELD_DEFAULTS,
        );
        const stack: Object3D[] = [root];

        while (stack.length > 0) {
            const object = stack.pop();
            if (!object) continue;

            for (let i = 0; i < tags.length; i++) {
                if (TagUtil.hasTag(object, tags[i]!)) {
                    return object;
                }
            }

            for (let i = object.children.length - 1; i >= 0; i--) {
                const child = object.children[i];
                if (child) stack.push(child);
            }

            await maybeYield();
        }

        return null;
    }

    private findTaggedPlayerProgressive(): Promise<Object3D | null> {
        return this.findFirstObjectByTagProgressive(this.scene, ["player", "Player"], yieldPlayStartToPaint);
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
        const maybeYieldForGameCreate = this.resetRuntimeYieldController();
        const gameSettings = this.normalizeRuntimeGameSettings(scene);
        this.tweenAnimations = tweenAnimations;
        this.isMultiplayer = isMultiplayer;
        this.isEnabled = gameSettings.isGame;
        SceneLoadProfiler.begin("detectRuntimeFeatures");
        let runtimeFeatures: SceneRuntimeFeatures = {usesBehaviorId: false, usesLambdas: false};
        try {
            runtimeFeatures = await this.detectSceneRuntimeFeatures(
                scene,
                AI_NPC_BEHAVIOR_ID,
                () => maybeYieldForGameCreate(true),
            );
        } finally {
            SceneLoadProfiler.end("detectRuntimeFeatures");
        }
        const usesAiNpc = runtimeFeatures.usesBehaviorId;
        const aiWorldControllerPromise = usesAiNpc ? this.ensureAiWorldController() : null;
        if (this.app.editor?.hudRenderer !== "uikit") {
            const {default: HUDManager} = await import("../hud/HUDManager");
            this.hud = new HUDManager(scene);
        }
        if (usesAiNpc) {
            const {default: AIConversationManagerClass} = await import("../packs/aiNpc/AiConversationManager");
            this.aiConversationManager = new AIConversationManagerClass(this);
        } else {
            this.aiConversationManager = null;
        }
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
            await this.instancer.convertMeshesToInstancedMeshesProgressive(scene, {
                batchSize: PLAY_START_DISCOVERY_OBJECT_BATCH_SIZE,
                frameBudgetMs: PLAY_START_FRAME_BUDGET_MS,
                yieldToFrame: () => maybeYieldForGameCreate(true),
            });
            SceneLoadProfiler.end("convertToInstancedMesh");
        }

        SceneLoadProfiler.begin("setupRuntimeBudgetCoordinator");
        this.runtimeBudgetCoordinator = new RuntimeBudgetCoordinator();
        this.plotBudgetManager?.dispose();
        this.plotBudgetManager = undefined;
        this.textureResidencyManager?.dispose();
        this.textureResidencyManager = undefined;
        this.runtimeBudgetManagers = undefined;
        this.configureRuntimeBudgetManagersFromQuality();
        this.listenRuntimeQualityChanges();
        this.runtimeBudgetCoordinator.update(this.getRuntimeBudgetManagers());
        SceneLoadProfiler.end("setupRuntimeBudgetCoordinator");
        await maybeYieldForGameCreate();

        if (!this.isEnabled) {
            console.log("GameManager: scene is a 3D experience; initializing runtime without game services");
        }

        EventBus.instance.unsubscribe(GameManager.TOPIC);
        EventBus.instance.subscribe(GameManager.TOPIC, this.onMessage.bind(this));

        this.setGameListeners();
        this.setOrientationChangeListener();

        if (aiWorldControllerPromise) {
            SceneLoadProfiler.begin("aiWorldControllerInit");
            await aiWorldControllerPromise;
            SceneLoadProfiler.end("aiWorldControllerInit");
            await maybeYieldForGameCreate();
        } else {
            console.debug("[GameManager] Skipping AI world controller startup; scene has no AI NPC behavior");
        }

        this.initialLives = gameSettings.lives;
        this.maxScore = gameSettings.maxScore;

        SceneLoadProfiler.begin("cameraControlInit");
        this.pointerEventManager.initialize();
        //create camera control
        this.cameraControl = new CameraControl(scene, camera, this.pointerEventManager);
        SceneLoadProfiler.end("cameraControlInit");
        await maybeYieldForGameCreate();

        //connect to MP server - should be done before starting the behaviors
        if (this.sceneConfig?.multiplayerAutoJoin && this.multiplayerState) {
            SceneLoadProfiler.begin("multiplayerStart");
            await this.multiplayerState.start();
            const player = await this.onMultiplayerStarted();
            this.setPlayer(player);
            SceneLoadProfiler.end("multiplayerStart");
            await maybeYieldForGameCreate();
        }

        // Load behaviors — already in flight from EngineRuntime, cached in service
        this.engine.loadingManager?.nextStage(LoadingMessages.LOADING_BEHAVIORS);
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
        SceneLoadProfiler.begin("loadBehaviorsData");
        try {
            behaviorsData = await service.loadSceneConfigs(scene, {assetSource, assetId});
        } catch (error) {
            console.error("GameManager: Error loading behaviors data", error);
            throw new Error("Error loading behaviors data");
        } finally {
            SceneLoadProfiler.end("loadBehaviorsData");
        }
        await maybeYieldForGameCreate();

        const {configs, scripts} = behaviorsData;
        this.behaviorScripts = scripts;

        // Merge built-in default behavior packs (dayNightCycle, skybox, etc.)
        // so they are available in play mode even if not returned by the API
        SceneLoadProfiler.begin("mergeDefaultBehaviorConfigs");
        try {
            const defaultConfigs = await service.loadDefaultConfigs();
            const sceneConfigIds = new Set(configs.map(c => c.id));
            for (const def of defaultConfigs) {
                if (!sceneConfigIds.has(def.id)) {
                    configs.push(def);
                }
            }

            this.configureBehaviorStartupPriorityOffsets(configs);

            for (const c of configs) {
                if (c.name) this.behaviorNames[c.id] = c.name;
            }
        } finally {
            SceneLoadProfiler.end("mergeDefaultBehaviorConfigs");
        }
        await maybeYieldForGameCreate();

        this.behaviorFileLoader = service.getFileLoader();
        // User behavior modules can construct UIKit panels while loadClasses()
        // evaluates them. Bootstrap the lazy TSL/node-material dependencies
        // before importing the injector or evaluating any user code. This is
        // renderer-independent and therefore covers both WebGL and WebGPU play.
        SceneLoadProfiler.begin("initUIKitRuntime");
        try {
            await ensureUIKitRuntimeInitialized();
        } finally {
            SceneLoadProfiler.end("initUIKitRuntime");
        }
        await maybeYieldForGameCreate();

        SceneLoadProfiler.begin("behaviorScriptInjectorLoad");
        try {
            const {default: BehaviorScriptInjectorClass} = await loadBehaviorScriptInjector();
            this.behaviorScriptInjector = new BehaviorScriptInjectorClass();
        } finally {
            SceneLoadProfiler.end("behaviorScriptInjectorLoad");
        }
        await maybeYieldForGameCreate();
        this.collisionDetector = new CollisionDetector(physics, collisionSource);
        this.prefabManager = new PrefabManager(this.engine.assetInstanceManager);

        SceneLoadProfiler.begin("buildRuntimeScriptImportContext");
        let importContext;
        try {
            importContext = await this.buildRuntimeScriptImportContext(scene);
        } finally {
            SceneLoadProfiler.end("buildRuntimeScriptImportContext");
        }
        await maybeYieldForGameCreate();

        SceneLoadProfiler.begin("loadBehaviorClasses");
        let loadedClasses;
        try {
            loadedClasses = await service.loadClasses(configs, scripts, this.behaviorScriptInjector, {
                context: importContext,
                importRevisionMap: service.getBundledImportRevisionMap(),
                progress: {
                    batchSize: PLAY_START_SCRIPT_CLASS_BATCH_SIZE,
                    frameBudgetMs: PLAY_START_FRAME_BUDGET_MS,
                    yieldToFrame: () => maybeYieldForGameCreate(true),
                },
            });
        } finally {
            SceneLoadProfiler.end("loadBehaviorClasses");
        }
        await maybeYieldForGameCreate();

        try {
            if (this.app.editor?.hudRenderer === "uikit") {
                this.engine.loadingManager?.updateStageProgress(0.5);
                SceneLoadProfiler.begin("initUIKit");
                try {
                    await this.initUIKit();
                    const [{default: UIKitPointerEvents}, {default: UIKitHUDManager}] = await Promise.all([
                        loadUIKitPointerEvents(),
                        import("../hud/uikit/UIKitHUDManager"),
                    ]);
                    UIKitPointerEvents.forceDispose(); //reset UIKit events

                    // Now that UIKit globals (node materials, default render order)
                    // are initialized and `uiCamera` is in the scene, it is safe to
                    // construct the UIKit HUD. Doing this earlier causes the
                    // Fullscreen to render with renderOrder=0 and Z-fight everything.
                    this.hud = new UIKitHUDManager(scene, this);
                } finally {
                    SceneLoadProfiler.end("initUIKit");
                }
                await maybeYieldForGameCreate();
            }
            console.log("GameManager: loaded classes", loadedClasses);

            SceneLoadProfiler.begin("behaviorManagerInit");
            try {
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
            } finally {
                SceneLoadProfiler.end("behaviorManagerInit");
            }
            await maybeYieldForGameCreate();

            // Initialize Lambda system
            this.engine.loadingManager?.nextStage(LoadingMessages.LOADING_LAMBDAS);
            this.lambdaFileLoader ??= new LambdaFileLoader();
            this.lambdaManager ??= new LambdaManager(this);
            const loadLambdas = async () => {
                SceneLoadProfiler.begin("loadLambdas");
                try {
                    await Promise.all([
                        this.loadBuiltInLambdas(),
                        this.loadBackendLambdas(scene, assetSource, assetId),
                    ]);
                } finally {
                    SceneLoadProfiler.end("loadLambdas");
                }
            };
            if (runtimeFeatures.usesLambdas) {
                await this.ensureLambdaSystemInitialized();
                await loadLambdas();
                await maybeYieldForGameCreate();
            } else {
                console.debug("[GameManager] Skipping lambda class loading; scene has no lambda instances or components");
            }

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

    public ensureUICamera(): Camera {
        if (this.uiCamera) {
            if (!this.uiCamera.parent) {
                this.scene.add(this.uiCamera);
            }
            return this.uiCamera;
        }

        const uiCamera = this.camera.clone();
        uiCamera.name = "UICamera";
        let hasWarnedInvalidUICameraState = false;
        let projectionInitialized = false;
        let sourceUserData = this.camera.userData;
        let sourceAnimations = this.camera.animations;
        const sourceProjectionMatrix = this.camera.projectionMatrix.clone();

        const isFiniteNumber = (value: unknown): value is number =>
            typeof value === "number" && Number.isFinite(value);

        const hasFiniteTransform = (object: Object3D): boolean => {
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
            const sourceCamera = this.camera;
            if (!hasFiniteTransform(sourceCamera)) {
                if (!hasWarnedInvalidUICameraState) {
                    hasWarnedInvalidUICameraState = true;
                    console.warn("GameManager: skipping UI camera sync due to non-finite camera transform");
                }
                return;
            }

            uiCamera.rotation.order = sourceCamera.rotation.order;
            if (!uiCamera.position.equals(sourceCamera.position)) {
                uiCamera.position.copy(sourceCamera.position);
            }
            if (!uiCamera.quaternion.equals(sourceCamera.quaternion)) {
                uiCamera.quaternion.copy(sourceCamera.quaternion);
            }
            if (!uiCamera.scale.equals(sourceCamera.scale)) {
                uiCamera.scale.copy(sourceCamera.scale);
            }
            if (!uiCamera.up.equals(sourceCamera.up)) {
                uiCamera.up.copy(sourceCamera.up);
            }

            if (sourceCamera.pivot) {
                if (uiCamera.pivot) {
                    uiCamera.pivot.copy(sourceCamera.pivot);
                } else {
                    uiCamera.pivot = sourceCamera.pivot.clone();
                }
            } else {
                uiCamera.pivot = null;
            }

            uiCamera.matrixAutoUpdate = sourceCamera.matrixAutoUpdate;
            uiCamera.matrixWorldAutoUpdate = sourceCamera.matrixWorldAutoUpdate;
            if (!sourceCamera.matrixAutoUpdate && !uiCamera.matrix.equals(sourceCamera.matrix)) {
                uiCamera.matrix.copy(sourceCamera.matrix);
                uiCamera.matrixWorldNeedsUpdate = true;
            }
            if (!sourceCamera.matrixWorldAutoUpdate && !uiCamera.matrixWorld.equals(sourceCamera.matrixWorld)) {
                uiCamera.matrixWorld.copy(sourceCamera.matrixWorld);
                uiCamera.matrixWorldNeedsUpdate = true;
            }
            uiCamera.layers.mask = sourceCamera.layers.mask;
            uiCamera.visible = sourceCamera.visible;
            uiCamera.frustumCulled = sourceCamera.frustumCulled;
            uiCamera.renderOrder = sourceCamera.renderOrder;
            uiCamera.coordinateSystem = sourceCamera.coordinateSystem;

            if (sourceCamera.userData !== sourceUserData) {
                sourceUserData = sourceCamera.userData;
                uiCamera.userData = JSON.parse(JSON.stringify(sourceUserData));
            }
            if (sourceCamera.animations !== sourceAnimations) {
                sourceAnimations = sourceCamera.animations;
                uiCamera.animations.length = sourceAnimations.length;
                for (let i = 0; i < sourceAnimations.length; i++) {
                    uiCamera.animations[i] = sourceAnimations[i]!;
                }
            }

            if (!projectionInitialized || !sourceProjectionMatrix.equals(sourceCamera.projectionMatrix)) {
                projectionInitialized = true;
                sourceProjectionMatrix.copy(sourceCamera.projectionMatrix);

                uiCamera.fov = sourceCamera.fov;
                uiCamera.zoom = sourceCamera.zoom;
                uiCamera.focus = sourceCamera.focus;
                uiCamera.aspect = sourceCamera.aspect;
                uiCamera.filmGauge = sourceCamera.filmGauge;
                uiCamera.filmOffset = sourceCamera.filmOffset;
                if (sourceCamera.view) {
                    uiCamera.view ??= {...sourceCamera.view};
                    Object.assign(uiCamera.view, sourceCamera.view);
                } else {
                    uiCamera.view = null;
                }

                // TODO: use NDC space for UI elements and remove this hacky near adjustment
                const baseNear = isFiniteNumber(sourceCamera.near) ? sourceCamera.near : 0.1;
                const baseFar = isFiniteNumber(sourceCamera.far)
                    ? sourceCamera.far
                    : Math.max(baseNear + 1, 2000);
                const nextNear = Math.max(0.001, baseNear + 0.1);
                const nextFar = Math.max(nextNear + 0.001, baseFar);

                uiCamera.near = Math.min(nextNear, nextFar - 0.001);
                uiCamera.far = nextFar;
                uiCamera.updateProjectionMatrix();
            }
            uiCamera.name = "UICamera";
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

        return uiCamera;
    }

    public async initUIKit() {
        this.ensureUICamera();

        if (this.uikitInitPromise) {
            return this.uikitInitPromise;
        }

        this.uikitInitPromise = (async () => {
            await ensureUIKitRuntimeInitialized();
        })().catch(error => {
            this.uikitInitPromise = null;
            throw error;
        });

        return this.uikitInitPromise;
    }

    public async setupGamePlayerAccount(): Promise<void> {
        // Compatibility no-op: hosted account bootstrap is not part of the OSS runtime.
    }

    setPlayer(
        player: Object3D | null | undefined,
        options?: {controllerManaged?: boolean},
    ) {
        console.info("[GameManager]: setting player", player);
        this.player = player;
        this.playerTransformOwnership = options?.controllerManaged === true ? "controller" : "script";
        this.hasScriptDrivenPlayerTransform = false;
        if (player) {
            this.collisionDetector?.setPlayer(player);
            if (this.playerTransformOwnership === "script") {
                this.captureScriptDrivenPlayerTransform();
            }
        }
    }

    /** Capture the script-owned pose in physics space, including anchors. */
    private captureScriptDrivenPlayerTransform(): void {
        const player = this.player;
        if (!player || this.playerTransformOwnership !== "script" || !PhysicsUtil.isDynamicObject(player)) return;
        PhysicsUtil.calculatePhysicsPositionFromObject(
            player,
            this.playerPhysicsPosition,
            this.playerPhysicsQuaternion,
            this.playerPhysicsScale,
        );
        this.hasScriptDrivenPlayerTransform = true;
    }

    /** Restore the last authored pose before physics can apply a stale worker pose. */
    private restoreScriptDrivenPlayerTransform(): void {
        const player = this.player;
        const physics = this.physics;
        if (
            !player || !physics || this.playerTransformOwnership !== "script" ||
            !this.hasScriptDrivenPlayerTransform || !PhysicsUtil.isDynamicObject(player)
        ) return;
        PhysicsUtil.updateObjectTransformFromPhysics(
            player,
            this.playerPhysicsPosition,
            this.playerPhysicsQuaternion,
            this.playerPhysicsScale,
        );
        physics.setOrigin(player.uuid, this.playerPhysicsPosition);
        physics.setRotation(player.uuid, this.playerPhysicsQuaternion);
        physics.setScale(player.uuid, this.playerPhysicsScale);
        physics.setLinearVelocity(player.uuid, this.playerPhysicsZeroVelocity);
        physics.setAngularVelocity(player.uuid, this.playerPhysicsZeroVelocity);
    }

    /** Commit a script-authored pose after behavior startup/reset and before the first physics step. */
    private commitScriptDrivenPlayerTransform(): void {
        const player = this.player;
        const physics = this.physics;
        if (!player || !physics || this.playerTransformOwnership !== "script" || !PhysicsUtil.isDynamicObject(player)) {
            return;
        }
        this.captureScriptDrivenPlayerTransform();
        physics.setOrigin(player.uuid, this.playerPhysicsPosition);
        physics.setRotation(player.uuid, this.playerPhysicsQuaternion);
        physics.setScale(player.uuid, this.playerPhysicsScale);
        physics.setLinearVelocity(player.uuid, this.playerPhysicsZeroVelocity);
        physics.setAngularVelocity(player.uuid, this.playerPhysicsZeroVelocity);
        // A script-driven dynamic body must not be pushed by stale scene
        // boundary contacts while its controller owns the transform. The
        // controller still receives collision callbacks and can implement
        // gameplay-specific response explicitly.
        physics.setCollisionBehavior(player.uuid, CollisionBehavior.Ghost);
    }

    /**
     * Preserve the custom-player contract: a behavior can drive a dynamic
     * rigid body by editing its Object3D transform. The physics backend would
     * otherwise emit its last authoritative pose on the next frame and snap
     * the script-driven player back to its old position. Built-in character
     * controllers opt out via setPlayer(..., {controllerManaged: true}).
     */
    private syncScriptDrivenPlayerTransform(): void {
        const player = this.player;
        const physics = this.physics;
        if (!player || !physics || this.playerTransformOwnership !== "script") return;

        // Worker-backed physics intentionally does not expose its worker-side
        // Object3D map.  A script-owned player is still an explicit dynamic
        // rigid-body contract, so do not use a missing local map entry as
        // proof that the body is absent.  Built-in character controllers opt
        // out through `controllerManaged` above; kinematic players remain
        // physics-authoritative and must not be fed back through this path.
        if (!PhysicsUtil.isDynamicObject(player)) return;
        const dynamicOwner = physics.getDynamicBodyObject?.(player.uuid);
        if (dynamicOwner && dynamicOwner !== player) return;
        if (physics.getKinematicBodyObjects?.().has(player.uuid)) return;

        PhysicsUtil.calculatePhysicsPositionFromObject(
            player,
            this.playerPhysicsPosition,
            this.playerPhysicsQuaternion,
            this.playerPhysicsScale,
        );
        this.hasScriptDrivenPlayerTransform = true;
        physics.setOrigin(player.uuid, this.playerPhysicsPosition);
        physics.setRotation(player.uuid, this.playerPhysicsQuaternion);
        physics.setLinearVelocity(player.uuid, this.playerPhysicsZeroVelocity);
        physics.setAngularVelocity(player.uuid, this.playerPhysicsZeroVelocity);
    }

    useAvatar() {
        return this.sceneConfig?.useAvatar;
    }

    getUserId() {
        return this.engine.userId;
    }

    getUserData(): IUser | null {
        const userData = this.engine.authManager.getUserData();
        if (!userData || !userData.id || userData.id === "") {
            return null;
        }
        return userData;
    }

    hideLoginPopup() {
        this.engine.call("gameLogin_quit");
    }

    showLoginPopup() {
        this.engine.call("gameLogin_requested");
    }

    showLoginReminderPopup() {
        this.engine.call("gameLogin_showReminder");
    }

    /**
     * Resolve the player's default avatar into a ready-to-spawn Object3D.
     * Returns null if there's no default or resolution fails.
     *  - premade: loads the GLB via ModelLoader.
     *  - composed: assembles parts at runtime via composeUserAvatar.
     */
    async getAvatar(): Promise<Object3D | null> {
        const record = await getDefaultUserAvatarModel();
        if (!record) return null;

        if (record.type === "premade") {
            const {default: ModelLoader} = await import("../../assets/js/loaders/ModelLoader");
            const model = await new ModelLoader().load(record.url, {Type: record.format});
            return model ?? null;
        }

        if (record.type === "composed") {
            const {composeUserAvatar} = await import("../packs/character/runtime/composeUserAvatar");
            return composeUserAvatar({
                parts: record.parts,
                skinTone: record.skinTone,
                avatarStyle: record.avatarStyle,
            });
        }

        return null;
    }

    private async createBehaviorsFromScene(): Promise<void> {
        resetPlayBehaviorStartupTimings();

        const maybeYieldForPlayStart = this.resetRuntimeYieldController(createPlayStartBehaviorCreationYieldController);
        const maybeYieldForDiscovery = createPlayStartBehaviorDiscoveryYieldController();
        const logBehaviorInitDetails = this.shouldLogBehaviorInitDetails();
        if (logBehaviorInitDetails) {
            console.debug("[GameManager] Starting createBehaviorsFromScene...");
        }
        const allBehaviorsForDebug: BehaviorData[] | null = logBehaviorInitDetails ? [] : null;
        const debugBehaviorsByPriority: Map<number, BehaviorData[]> | null = logBehaviorInitDetails ? new Map() : null;
        const defaultPriority = 1000;
        const behaviorBindingsByPriority = new Map<number, RuntimeBehaviorBinding[]>();
        let totalBehaviors = 0;

        const collectObjectRuntimeHooks = (child: Object3D) => {
            if (MultiplayerUtils.isMultiplayerTemplate(child)) return;
            totalBehaviors += this.collectRuntimeBehaviorBindingsFromObject(
                child,
                behaviorBindingsByPriority,
                defaultPriority,
                allBehaviorsForDebug,
                debugBehaviorsByPriority,
            );
            // TODO: refactor Particles to proper behavior
            if (isParticleEmitterObject(child)) {
                const autoStart = isVFXAutoStartEnabled(child);
                if (autoStart) {
                    child.system?.restart?.();
                } else {
                    child.system?.stop?.();
                }
            }
        };

        collectObjectRuntimeHooks(this.scene);
        await maybeYieldForDiscovery();

        const stack: Object3D[] = [];
        for (let i = this.scene.children.length - 1; i >= 0; i--) {
            const child = this.scene.children[i];
            if (child) stack.push(child);
        }

        while (stack.length > 0) {
            const child = stack.pop();
            if (!child) continue;

            collectObjectRuntimeHooks(child);

            for (let i = child.children.length - 1; i >= 0; i--) {
                const nested = child.children[i];
                if (nested) stack.push(nested);
            }

            await maybeYieldForDiscovery();
        }

        if (logBehaviorInitDetails) {
            console.debug(`[GameManager] Found ${totalBehaviors} behaviors total`);
        }

        if (logBehaviorInitDetails && allBehaviorsForDebug && debugBehaviorsByPriority) {
            console.debug(
                `[GameManager] Behavior initialization details:`,
                this.formatBehaviorInitDetails(allBehaviorsForDebug, debugBehaviorsByPriority),
            );
        }

        //sort priorities (low to high - lower values execute first)
        const sortedPriorities = Array.from(behaviorBindingsByPriority.keys()).sort((a, b) => a - b);

        // Progressive init: a behavior's init()/onAdded can build geometry
        // synchronously. Keep priority ordering, but yield between expensive
        // units instead of stacking a whole priority group into one frame.
        const totalBehaviorProgress = totalBehaviors || 1;
        let processedBehaviors = 0;

        //TODO: in onAdded behaviors may add other behaviors, so we need to set BM.isProcessing = true here
        for (let i = 0; i < sortedPriorities.length; i++) {
            const priority = sortedPriorities[i];
            const bindings = behaviorBindingsByPriority.get(priority!)!;
            if (logBehaviorInitDetails) {
                console.debug(`[GameManager] Processing ${bindings.length} behaviors with priority ${priority}`);
            }

            for (let b = 0; b < bindings.length; b++) {
                const {behavior, target} = bindings[b]!;
                const options = {
                    uuid: behavior.uuid,
                    attributes: behavior.attributesData,
                    throttleConfig: behavior.throttleConfig,
                    // Keep the behavior-facing yield explicit and paint-safe,
                    // while lifecycle checkpoints use the normal progressive
                    // startup cadence. This prevents cheap behaviors from
                    // forcing multiple paints during construction without
                    // changing authored `await this.yield()` semantics.
                    yieldToFrame: () => maybeYieldForPlayStart(true),
                    startupYieldToFrame: () => maybeYieldForPlayStart(),
                };
                const behaviorTimingStart = performance.now();
                const behaviorLabel = this.behaviorManager?.formatBehaviorId(behavior.id) ?? behavior.id;
                let behaviorMs: number | undefined;

                try {
                    await this.addBehaviorToObject(target, behavior.id, options);
                    behaviorMs = performance.now() - behaviorTimingStart;
                    recordPlayBehaviorStartupTiming({
                        id: behavior.id,
                        label: behaviorLabel,
                        target: target.name || target.uuid,
                        ms: behaviorMs,
                    });
                    if (behaviorMs > 1000) {
                        console.warn(
                            `[GameManager] Slow play behavior startup: ${behaviorLabel} on ${target.name || target.uuid} took ${Math.round(behaviorMs)}ms`,
                        );
                    }
                    if (logBehaviorInitDetails) {
                        console.debug(
                            `[GameManager] ✓ Successfully added behavior "${behavior.id}" to object "${target.name}"`,
                        );
                    }
                } catch (error) {
                    console.error(
                        `[GameManager] ✗ Failed to add behavior ${behavior.id} to object ${target.name}:`,
                        error,
                    );
                }

                processedBehaviors += 1;
                this.engine.loadingManager?.updateStageProgress(Math.min(1, processedBehaviors / totalBehaviorProgress));
                // Let cheap behavior creation stay in normal progressive
                // batches. A genuinely slow behavior gets an immediate paint
                // so one expensive init cannot consume the next frame too.
                await maybeYieldForPlayStart(
                    behaviorMs !== undefined && behaviorMs >= PLAY_START_SLOW_BEHAVIOR_THRESHOLD_MS,
                );
            }
            if (logBehaviorInitDetails) {
                console.debug(`[GameManager] All behaviors with priority ${priority} initialized`);
            }
        }

        if (logBehaviorInitDetails) {
            console.debug("[GameManager] Finished createBehaviorsFromScene");
        }
    }

    private collectRuntimeBehaviorBindingsFromObject(
        target: Object3D,
        bindingsByPriority: Map<number, RuntimeBehaviorBinding[]>,
        defaultPriority: number,
        debugAllBehaviors?: BehaviorData[] | null,
        debugBehaviorsByPriority?: Map<number, BehaviorData[]> | null,
    ): number {
        const isCharacterChild = target.parent?.userData?.behaviors?.some((b: BehaviorData) => b.id === "character");
        if (isCharacterChild && this.isMultiplayer) {
            return 0;
        }

        const behaviorsData = target.userData?.behaviors as BehaviorData[] | undefined;
        if (!behaviorsData) return 0;

        let collected = 0;
        for (let i = 0; i < behaviorsData.length; i++) {
            const behavior = behaviorsData[i]!;
            if (!behavior.enabled) continue;

            const declaredPriority = behavior.priority ?? behavior.attributesData?.priority ?? defaultPriority;
            const priority = declaredPriority + (this.behaviorStartupPriorityOffsets?.get(behavior.id) ?? 0);
            let bindings = bindingsByPriority.get(priority);
            if (!bindings) {
                bindings = [];
                bindingsByPriority.set(priority, bindings);
            }
            bindings.push({behavior, target});

            if (debugAllBehaviors) {
                debugAllBehaviors.push(behavior);
            }
            if (debugBehaviorsByPriority) {
                let debugBehaviors = debugBehaviorsByPriority.get(priority);
                if (!debugBehaviors) {
                    debugBehaviors = [];
                    debugBehaviorsByPriority.set(priority, debugBehaviors);
                }
                debugBehaviors.push(behavior);
            }

            collected++;
        }

        return collected;
    }

    private configureBehaviorStartupPriorityOffsets(configs: readonly BehaviorClassConfig[]): void {
        this.behaviorStartupPriorityOffsets.clear();
        for (const config of configs) {
            const tags = Array.isArray(config.tags) ? config.tags : [];
            const isWorldBuilder = config.startupPhase === "world" || tags.some(tag =>
                WORLD_BEHAVIOR_TAGS.has(tag.toLowerCase())
            );
            if (isWorldBuilder) {
                this.behaviorStartupPriorityOffsets.set(config.id, WORLD_BEHAVIOR_STARTUP_OFFSET);
            } else if (config.startupPhase === "late") {
                this.behaviorStartupPriorityOffsets.set(config.id, LATE_BEHAVIOR_STARTUP_OFFSET);
            }
        }
    }

    private shouldLogBehaviorInitDetails(): boolean {
        return !!(
            this.engine?.debug ||
            this.scene?.userData?.rendering?.debugBehaviorStartup === true ||
            this.scene?.userData?.game?.debugBehaviorStartup === true
        );
    }

    private formatBehaviorInitDetails(
        allBehaviors: BehaviorData[],
        behaviorsByPriority: Map<number, BehaviorData[]>,
    ): {behaviors: string[]; priorities: string[]} {
        const behaviors: string[] = new Array(allBehaviors.length);
        for (let i = 0; i < allBehaviors.length; i++) {
            const behavior = allBehaviors[i]!;
            behaviors[i] = `${behavior.id} (${behavior.uuid})`;
        }

        const priorities: string[] = [];
        for (const [priority, priorityBehaviors] of behaviorsByPriority) {
            const behaviorIds = new Array<string>(priorityBehaviors.length);
            for (let i = 0; i < priorityBehaviors.length; i++) {
                behaviorIds[i] = priorityBehaviors[i]!.id;
            }
            priorities.push(`Priority ${priority}: [${behaviorIds.join(", ")}]`);
        }

        return {behaviors, priorities};
    }

    getAllBehaviorsFromObject(target: Object3D, behaviorToTargetMap: Map<string, Object3D>): BehaviorData[] {
        const behaviors: BehaviorData[] = [];
        const isCharacterChild = target.parent?.userData?.behaviors?.some((b: BehaviorData) => b.id === "character");
        if (isCharacterChild && this.isMultiplayer) {
            return behaviors;
        }

        const behaviorsData = target.userData?.behaviors as BehaviorData[] | undefined;
        if (!behaviorsData) {
            return behaviors;
        }

        for (let i = 0; i < behaviorsData.length; i++) {
            const behavior = behaviorsData[i]!;
            if (!behavior.enabled) continue;
            behaviorToTargetMap.set(behavior.uuid, target);
            behaviors.push(behavior);
        }
        return behaviors;
    }

    addAllBehaviorsFromObject(target: Object3D): Promise<void>[] {
        const promises: Promise<void>[] = [];
        const behaviorsData = target.userData?.behaviors as BehaviorData[];
        if (!behaviorsData) {
            return promises;
        }

        const maybeYieldForLiveAdd = createPlayStartYieldController();
        let previousBehaviorAdd: Promise<void> | null = null;

        for (const data of behaviorsData) {
            if (!data.enabled) {
                continue;
            }

            const addBehavior = async (): Promise<void> => {
                const options = {
                    uuid: data.uuid,
                    attributes: data.attributesData,
                    throttleConfig: data.throttleConfig,
                    yieldToFrame: () => maybeYieldForLiveAdd(true),
                    startupYieldToFrame: () => maybeYieldForLiveAdd(),
                };

                try {
                    await this.addBehaviorToObject(target, data.id, options);
                } catch (error) {
                    console.error(`[GameManager] Failed to add behavior ${data.id} to object ${target.name}:`, error);
                }

                await maybeYieldForLiveAdd();
            };

            const promise: Promise<void> = previousBehaviorAdd
                ? previousBehaviorAdd.then(addBehavior, addBehavior)
                : addBehavior();
            promises.push(promise);
            previousBehaviorAdd = promise.catch(() => {});
        }

        return promises;
    }

    private async addAllBehaviorsFromObjectProgressive(
        target: Object3D,
        yieldToFrame: () => Promise<void>,
        maybeYieldAfterBehavior: () => Promise<void> = yieldToFrame,
        startupYieldToFrame: () => Promise<void> = yieldToFrame,
    ): Promise<void> {
        const behaviorsData = target.userData?.behaviors as BehaviorData[] | undefined;
        if (!behaviorsData) {
            return;
        }

        for (const data of behaviorsData) {
            if (!data.enabled) {
                continue;
            }

            const options = {
                uuid: data.uuid,
                attributes: data.attributesData,
                throttleConfig: data.throttleConfig,
                yieldToFrame,
                startupYieldToFrame,
            };

            try {
                await this.addBehaviorToObject(target, data.id, options);
            } catch (error) {
                console.error(`[GameManager] Failed to add behavior ${data.id} to object ${target.name}:`, error);
            }

            await maybeYieldAfterBehavior();
        }
    }

    // this will not remove behavior data from the object, it will just remove behavior from the BehaviorManager
    removeAllBehaviorsForObject(target: Object3D): void {
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
        this.isInitializing = false;
        this.invalidatePlayStartupSceneMutationBarrier();
        this.deferredStartupOptimizationToken += 1;
        this.deferredStartupOptimizationPromise = null;
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
        this.runtimeBudgetManagers = undefined;
        this.runtimeBudgetCoordinator = undefined;
        this.runtimeBudgetPolicySignature = null;
        this.runtimeFrameCount = 0;
        this.runtimeFrameAvgMs = DEFAULT_RUNTIME_TARGET_FRAME_MS;
        this.runtimeFrameBudgetMs = DEFAULT_RUNTIME_FRAME_BUDGET_MS;
        this.runtimeTargetFrameMs = DEFAULT_RUNTIME_TARGET_FRAME_MS;
        this.runtimeDeltaPressureThreshold = 1.25;
        this.runtimeFrameContext = null;
        this.resetRuntimeSpatialGrid();
        this.unlistenRuntimeQualityChanges();
        this.prefabManager?.dispose();

        // Hard reset UIKit roots/pointer events across Play<->Remix transitions
        forceDisposeUIKitPointerEventsIfLoaded();
        this.unifiedGameServices?.stop();
        this.removeGameListeners();
        // `create()` subscribes a bound onMessage callback to the singleton
        // topic. Remove it during reset so the disposed GameManager cannot be
        // retained by EventBus between Play/Stop sessions.
        EventBus.instance.unsubscribe(GameManager.TOPIC);
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
        this.uikitInitPromise = null;

        this.behaviorScripts = {};
        this.behaviorNames = {};
        this.lambdaScripts = {};
        this.lambdaScriptRevisions = {};
        this.physics = undefined;
        this.multiplayerState = undefined;
        this.animationController = undefined;
        this.animationGraphController = undefined;
        this.audioController = undefined;
        this.aiWorldController = undefined;
        this.aiConversationManager = null;
        this.instancer = undefined;
        this.behaviorManager = undefined;
        this.lambdaManager = undefined;
        this.prefabManager = undefined;
        this.tweenAnimations = undefined;
        this.tweenGroupRef = undefined;
        this.player = undefined;
    }

    async startGame(): Promise<void> {
        if (this.state === GAME_STATE.STARTED) {
            return;
        }

        if (this.startGamePromise) {
            return this.startGamePromise;
        }

        const startGamePromise = this.startGameInternal();
        this.startGamePromise = startGamePromise;

        try {
            await startGamePromise;
        } catch (error) {
            this.isInitializing = false;
            this.invalidatePlayStartupSceneMutationBarrier();
            throw error;
        } finally {
            if (this.startGamePromise === startGamePromise) {
                this.startGamePromise = null;
            }
        }
    }

    private async startGameInternal(): Promise<void> {
        const logBehaviorInitDetails = this.shouldLogBehaviorInitDetails();
        if (logBehaviorInitDetails) {
            console.debug("GM: starting game, initializing behaviors...");
        }
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
        const playStartupSceneMutationToken = this.beginPlayStartupSceneMutationBarrier();

        // HUD/UI start events are dispatched synchronously, including from UIKit
        // pointer handling. Yield before heavy runtime startup so clicking Play
        // can paint its visual state before behavior/lambda creation begins.
        await timePlayStartupPhase("gameStart:preStartupPaint", () => yieldPlayStartToPaint());

        await this.maybeStartEditorDebugger();

        await timePlayStartupPhase("gameStart:initialEvents", () => {
            this.engine.call("gameUpdated", this, this);
            this.engine.call("gameInitialized", this, this);
        });

        // Detect "Player" tag BEFORE behaviors init so TriggerBehavior
        // and others can read game.player during onAdded/onStart.
        await timePlayStartupPhase("gameStart:findInitialPlayer", async () => {
            if (!this.player && this.scene) {
                const taggedPlayer = await this.findTaggedPlayerProgressive();
                if (taggedPlayer) {
                    this.setPlayer(taggedPlayer);
                }
            }
        });

        if (logBehaviorInitDetails) {
            console.debug("[GameManager] About to create lambda instances and behaviors progressively...");
        }
        this.engine.loadingManager?.nextStage(LoadingMessages.INITIALIZING_BEHAVIORS);
        const initializeRuntimeScene = async (): Promise<PromiseSettledResult<void>[]> => {
            const startupTasks: Array<{label: string; run: () => Promise<void>}> = [
                {label: "createLambdaInstancesFromScene", run: () => this.createLambdaInstancesFromScene()},
                {label: "createBehaviorsFromScene", run: () => this.createBehaviorsFromScene()},
            ];
            const results: PromiseSettledResult<void>[] = [];

            for (const {label, run} of startupTasks) {
                try {
                    await timePlayStartupPhase(`gameStart:${label}`, run);
                    results.push({status: "fulfilled", value: undefined});
                } catch (reason) {
                    results.push({status: "rejected", reason});
                }
                await yieldPlayStartToPaint();
            }

            return results;
        };

        const results = await initializeRuntimeScene();
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

        await this.awaitPlayStartupSceneMutationQuiescence(playStartupSceneMutationToken);
        if (!this.isInitializing || !this.isCurrentPlayStartupSceneMutationToken(playStartupSceneMutationToken)) {
            return;
        }

        this.state = GAME_STATE.STARTED;
        await timePlayStartupPhase("gameStart:countDown", () => {
            this.gameCountDown();
        });
        await yieldPlayStartToPaint();
        await timePlayStartupPhase("gameStart:behaviorReset", async () => {
            await this.behaviorManager?.resetProgressive({
                batchSize: PLAY_START_BEHAVIOR_RESET_BATCH_SIZE,
                frameBudgetMs: PLAY_START_FRAME_BUDGET_MS,
                yieldToFrame: yieldPlayStartToPaint,
            });
        });
        await this.awaitPlayStartupSceneMutationQuiescence(playStartupSceneMutationToken);
        if (!this.isInitializing || !this.isCurrentPlayStartupSceneMutationToken(playStartupSceneMutationToken)) {
            return;
        }
        // Behaviors may call setPlayer() and then author an initial pose during
        // onStart/onReset. Commit that final script-owned pose before the first
        // worker physics step so a stale authored body cannot teleport the
        // player to a previous scene position.
        this.commitScriptDrivenPlayerTransform();
        this.isInitializing = false;
        this.invalidatePlayStartupSceneMutationBarrier();

        // If no behavior set a player, check for "Player" tag
        await timePlayStartupPhase("gameStart:findFallbackPlayer", async () => {
            if (!this.player && this.scene) {
                const taggedPlayer = await this.findTaggedPlayerProgressive();
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
        });

        await timePlayStartupPhase("gameStart:startedEvents", () => {
            this.engine.call("gameStarted", this, this);
            window.parent.postMessage(IFRAME_MESSAGES.GAME_STARTED, "*");
            this.engine.call("gameUpdated", this, this);
            this.scheduleDeferredStartupOptimizations();
        });
        if (logBehaviorInitDetails) {
            console.debug("GM: all behaviors initialized, game started");
        }
    }

    private scheduleDeferredStartupOptimizations(): void {
        if (!this.scene || !this.runtimeBudgetCoordinator) {
            return;
        }

        const scene = this.scene;
        const token = ++this.deferredStartupOptimizationToken;
        const task = this.runDeferredStartupOptimizations(scene, token)
            .catch(error => {
                if (this.deferredStartupOptimizationToken === token) {
                    console.warn("[GameManager] Deferred startup optimization failed", error);
                }
            })
            .finally(() => {
                if (this.deferredStartupOptimizationPromise === task) {
                    this.deferredStartupOptimizationPromise = null;
                }
            });
        this.deferredStartupOptimizationPromise = task;
    }

    private isDeferredStartupOptimizationCurrent(scene: Scene, token: number): boolean {
        return (
            this.deferredStartupOptimizationToken === token &&
            this.scene === scene &&
            this.state === GAME_STATE.STARTED
        );
    }

    private async runDeferredStartupOptimizations(scene: Scene, token: number): Promise<void> {
        await yieldPlayStartToPaint();
        await yieldPlayStartToPaint();
        await waitForRuntimeSceneReveal(scene, () => this.isDeferredStartupOptimizationCurrent(scene, token));
        if (!this.isDeferredStartupOptimizationCurrent(scene, token)) {
            return;
        }

        SceneLoadProfiler.begin("deferredNormalizeBehaviorMeshNormals");
        try {
            const normalStats = await ensureRenderableMeshNormalsProgressive(scene, {
                batchSize: PLAY_START_DISCOVERY_OBJECT_BATCH_SIZE,
                frameBudgetMs: PLAY_START_FRAME_BUDGET_MS,
                yieldToFrame: () => yieldPlayStartToPaint(),
                shouldContinue: () => this.isDeferredStartupOptimizationCurrent(scene, token),
            });
            if (normalStats.normalsComputed > 0 || normalStats.failed > 0) {
                const totalComputeMs = Math.round(normalStats.totalComputeMs * 10) / 10;
                const maxComputeMs = Math.round(normalStats.maxComputeMs * 10) / 10;
                const computeSummary =
                    `computed=${normalStats.normalsComputed}` +
                    ` totalComputeMs=${totalComputeMs}` +
                    ` maxComputeMs=${maxComputeMs}` +
                    ` maxComputeVertices=${normalStats.maxComputeVertexCount}`;
                console.debug("[GameManager] Normalized behavior-generated mesh normals", computeSummary, {
                    ...normalStats,
                    totalComputeMs,
                    maxComputeMs,
                });
            }
        } finally {
            SceneLoadProfiler.end("deferredNormalizeBehaviorMeshNormals");
        }
        if (!this.isDeferredStartupOptimizationCurrent(scene, token)) {
            return;
        }

        SceneLoadProfiler.begin("deferredClassifyStaticEntities");
        try {
            await this.classifyStaticEntities(scene);
        } finally {
            SceneLoadProfiler.end("deferredClassifyStaticEntities");
        }
        if (!this.isDeferredStartupOptimizationCurrent(scene, token)) {
            return;
        }

        SceneLoadProfiler.begin("deferredSetupManagers");
        const plotBudgetManager = new PlotBudgetManager();
        const textureResidencyManager = new TextureResidencyManager();
        try {
            const maybeYield = createPlayStartYieldController();
            await plotBudgetManager.rebuildProgressive(scene, {
                batchSize: PLAY_START_DISCOVERY_OBJECT_BATCH_SIZE,
                frameBudgetMs: PLAY_START_FRAME_BUDGET_MS,
                yieldToFrame: () => maybeYield(true),
            });
            if (!this.isDeferredStartupOptimizationCurrent(scene, token)) {
                return;
            }

            await textureResidencyManager.rebuildProgressive(scene, {
                batchSize: PLAY_START_DISCOVERY_OBJECT_BATCH_SIZE,
                frameBudgetMs: PLAY_START_FRAME_BUDGET_MS,
                yieldToFrame: () => maybeYield(true),
            });
            if (!this.isDeferredStartupOptimizationCurrent(scene, token)) {
                return;
            }

            this.plotBudgetManager?.dispose();
            this.plotBudgetManager = plotBudgetManager;
            this.textureResidencyManager?.dispose();
            this.textureResidencyManager = textureResidencyManager;
            this.runtimeBudgetManagers = undefined;
            this.configureRuntimeBudgetManagersFromQuality();
            this.listenRuntimeQualityChanges();
            this.runtimeBudgetCoordinator?.update(this.getRuntimeBudgetManagers());
            console.debug("[GameManager] Deferred startup optimizations ready");
        } finally {
            SceneLoadProfiler.end("deferredSetupManagers");
            if (this.plotBudgetManager !== plotBudgetManager) {
                plotBudgetManager.dispose();
            }
            if (this.textureResidencyManager !== textureResidencyManager) {
                textureResidencyManager.dispose();
            }
        }
    }

    private async maybeStartEditorDebugger(): Promise<void> {
        if (this.engine.options.isPlayModeOnly) {
            recordPlayStartupTiming({phase: "editorDebuggerSkipped", ms: 0, success: true, message: "play-mode-only"});
            return;
        }

        const debugCheckStart = nowForPlayStartupTiming();
        const productionMode = this.engine.editor?.scene?.userData?.productionMode;
        const hasBreakpoints = breakpointManager.getTotalCount() > 0;
        recordPlayStartupTiming({
            phase: "editorDebuggerCheck",
            ms: Math.round(nowForPlayStartupTiming() - debugCheckStart),
            success: true,
            message: hasBreakpoints ? "breakpoints" : "no-breakpoints",
        });

        if (!hasBreakpoints || productionMode) {
            recordPlayStartupTiming({
                phase: "editorDebuggerSkipped",
                ms: 0,
                success: true,
                message: productionMode ? "production-mode" : "no-breakpoints",
            });
            return;
        }

        await timePlayStartupPhase("editorDebuggerLoad", async () => {
            const {debugSessionManager} = await import("@stem/editor-oss/editor/assets/v2/DebuggerPopup/DebugSessionManager");
            debugSessionManager.startSession();
            if (shouldShowDebuggerTooltip()) {
                showToast({type: "info", title: "Debugger active — press F12 to pause at breakpoints"});
            }
        });
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
            await this.startGame();
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
            this.isInitializing = false;
            this.invalidatePlayStartupSceneMutationBarrier();
            if (!this.engine.options.isPlayModeOnly) {
                const {debugSessionManager} = await import("@stem/editor-oss/editor/assets/v2/DebuggerPopup/DebugSessionManager");
                debugSessionManager.endSession();
            }
            this.objectPicker?.clear();
            this.behaviorManager?.dispose();
            this.lambdaManager?.dispose();
            this.prefabManager?.dispose();
            forceDisposeUIKitPointerEventsIfLoaded();
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

    /**
     * Opens one rendered simulation frame. Input is sampled before any fixed
     * step, and the returned context is reused by every fixed stage and the
     * single variable update for that frame.
     */
    beginSimulationFrame(
        delta: number,
        simulationFrame: Readonly<FixedStepSimulationFrame>,
    ): FrameContext | null {
        if (this.isInitializing || this.state !== GAME_STATE.STARTED) return null;
        this.restoreScriptDrivenPlayerTransform();
        this.inputManager?.update();
        if (this.scene?.userData && this.inputManager) {
            // Global input mirrors for behaviors that rely on scene-level key state.
            this.scene.userData.pressE = this.inputManager.getAction("use");
            this.scene.userData.pressF = this.inputManager.getAction("drop");
            this.scene.userData.pressP = this.inputManager.getAction("pull");
        }
        const context = this.createRuntimeFrameContext(delta, simulationFrame);
        context.spatialGrid = this.refreshRuntimeSpatialGrid();
        this.lambdaManager?.beginSimulationFrame?.(context);
        return context;
    }

    /**
     * Deterministic gameplay stage for one authoritative fixed step.
     * EngineRuntime invokes physics first, then this method preserves
     * collision -> behavior -> lambda ordering.
     */
    fixedUpdate(fixedDeltaTime: number, frameContext?: FrameContext): void {
        if (this.isInitializing || this.state !== GAME_STATE.STARTED) return;
        this.collisionDetector?.update();
        this.behaviorManager?.fixedUpdate(fixedDeltaTime, frameContext);
        this.lambdaManager?.fixedUpdate(fixedDeltaTime, frameContext);
        this.syncScriptDrivenPlayerTransform();
    }

    update(_clock: any, delta: number, preparedFrameContext?: FrameContext | null) {
        if (this.isInitializing) return;
        this.hud?.update?.(delta);
        if (this.state !== GAME_STATE.STARTED) return;
        // Legacy callers may not go through beginSimulationFrame; restore the
        // authored script-player pose before variable behavior updates there.
        this.restoreScriptDrivenPlayerTransform();
        // Legacy callers still get one safe variable frame. With no
        // authoritative simulation frame fixed-only compatibility fallback
        // remains enabled through fixedUpdatesEnabled=false.
        if (!preparedFrameContext) {
            this.inputManager?.update();
            if (this.scene?.userData && this.inputManager) {
                this.scene.userData.pressE = this.inputManager.getAction("use");
                this.scene.userData.pressF = this.inputManager.getAction("drop");
                this.scene.userData.pressP = this.inputManager.getAction("pull");
            }
            this.collisionDetector?.update();
        }
        const frameContext = preparedFrameContext ?? this.createRuntimeFrameContext(delta);
        let runtimeBudgetSnapshot: Readonly<RuntimeBudgetSnapshot> | null = null;
        if (this.runtimeBudgetCoordinator) {
            const updateOptions = this.getRuntimeBudgetManagers();
            runtimeBudgetSnapshot = this.runtimeBudgetCoordinator.updateForFrame
                ? this.runtimeBudgetCoordinator.updateForFrame(updateOptions, {
                    underRenderPressure: frameContext.underRenderPressure,
                    now: frameContext.frameStartTime,
                })
                : this.runtimeBudgetCoordinator.update(updateOptions, {
                    underRenderPressure: frameContext.underRenderPressure,
                    now: frameContext.frameStartTime,
                });
            this.configurePressureDrivenBudgetManagers(runtimeBudgetSnapshot);
        }
        if (!preparedFrameContext) {
            frameContext.spatialGrid = this.refreshRuntimeSpatialGrid();
        }
        this.behaviorManager?.update(delta, frameContext);
        this.lambdaManager?.update(delta, frameContext);
        this.syncScriptDrivenPlayerTransform();
        this.objectPicker?.update();
        if (this.plotBudgetManager) {
            this.plotBudgetManager.update(this.camera);
        }
        if (this.textureResidencyManager) {
            this.textureResidencyManager.update();
        }
    }

    private getRuntimeBudgetManagers(): RuntimeBudgetManagers {
        const managers = this.runtimeBudgetManagers ?? (this.runtimeBudgetManagers = {});
        if (this.textureResidencyManager) {
            managers.textureResidencyManager = this.textureResidencyManager;
        } else {
            delete managers.textureResidencyManager;
        }
        return managers;
    }

    /** Iterates Object3Ds registered with lambdas without allocating a Map. */
    forEachTrackedObject(callback: (uuid: string, object: Object3D) => void): void {
        if (!this.lambdaManager) return;
        this.lambdaManager.forEachRegisteredObject(object => callback(object.uuid, object));
    }

    /** Returns all Object3Ds registered with lambdas, keyed by uuid. Preserved for API compatibility. */
    getTrackedObjects(): Map<string, Object3D> {
        const result = new Map<string, Object3D>();
        this.forEachTrackedObject((uuid, object) => result.set(uuid, object));
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
    private async buildRuntimeScriptImportContext(scene: Scene = this.scene) {
        const sceneContext = getAssetResolutionContext(scene) || emptyAssetResolutionContext;
        const bundledContext = this.engine.behaviorLoadingService.getBundledImportResolutionContext();
        const context = mergeAssetResolutionContexts(sceneContext, bundledContext);
        return buildNameAwareScriptImportContext(this.engine.editor?.sceneID, context, {
            force: true,
            allowFetchFailure: true,
        });
    }

    private async registerAssetBehaviorClass(
        assetRef: AssetRef,
        yieldToFrame?: () => Promise<void>,
        startupYieldToFrame?: () => Promise<void>,
    ): Promise<void> {
        if (!this.behaviorManager) {
            console.error("[GameManager] BehaviorManager is not initialized. Cannot load behavior.");
            return;
        }
        const startupYield = startupYieldToFrame ?? yieldToFrame;
        const maybeYield = async (): Promise<void> => {
            if (startupYield) {
                await startupYield();
            }
        };

        // Don't load if already present
        const key = assetRefKey(assetRef);
        if (this.behaviorManager.hasBehaviorClass(key)) {
            return;
        }

        await maybeYield();
        const behavior = await getAssetRevisionData(assetRef.assetId, assetRef.revisionId, "json");
        await maybeYield();
        const config = JSON.parse(behavior.config) as BehaviorClassConfig;
        const code = behavior.code as string;
        const importContext = await this.buildRuntimeScriptImportContext();
        await maybeYield();
        const importRevisionMap = await loadScriptImportRevisionMap(code, importContext);
        await maybeYield();
        const behaviorClass = this.behaviorScriptInjector!.parse(key, code, config.name, {
            context: importContext,
            importRevisionMap,
        });
        await maybeYield();
        const workerConfig = config.worker ? {enabled: true} : undefined;
        this.behaviorManager?.registerBehaviorClass(key, config.attributes, behaviorClass, config.name, workerConfig);
    }

    async addBehaviorToObject(
        target: Object3D,
        behaviorId: string,
        behaviorOptions?: CreateBehaviorOptions,
    ): Promise<Behavior> {
        const logBehaviorInitDetails = this.shouldLogBehaviorInitDetails();
        if (logBehaviorInitDetails) {
            console.debug(
                `[GameManager] addBehaviorToObject called with behaviorId: "${behaviorId}", target: "${target.name || target.uuid}", options:`,
                behaviorOptions,
            );
        }

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
                        await this.registerAssetBehaviorClass(
                            assetRef,
                            behaviorOptions?.yieldToFrame,
                            behaviorOptions?.startupYieldToFrame,
                        );
                    }
                } else {
                    console.warn(
                        `[GameManager] Could not resolve revision ID for behavior "${behaviorId}", proceeding with base ID`,
                    );
                }
            }

            if (logBehaviorInitDetails) {
                console.debug(`[GameManager] BehaviorManager exists, calling createBehavior for "${behaviorKey}"`);
            }
            const behavior = await this.behaviorManager.createBehavior(target, behaviorKey, behaviorOptions);

            if (!behavior) {
                const error = new Error(`[GameManager] Failed to create behavior ${behaviorKey}`);
                console.error(`[GameManager] createBehavior returned null/undefined for "${behaviorKey}"`);
                return Promise.reject(error);
            }

            if (logBehaviorInitDetails) {
                console.debug(
                    `[GameManager] Successfully created behavior "${behaviorKey}" for object "${target.name || target.uuid}"`,
                );
            }

            // Check enableAtStart property and disable object if set to false
            const enableAtStart =
                typeof target.userData.enableAtStart === "boolean" ? target.userData.enableAtStart : true; // default to true if not set

            if (logBehaviorInitDetails) {
                console.debug(`[GameManager] Object "${target.name || target.uuid}" enableAtStart: ${enableAtStart}`);
            }
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

    private async ensureLambdaSystemInitialized(): Promise<void> {
        if (this.lambdaFileLoader && this.lambdaScriptInjector && this.lambdaManager) {
            return;
        }

        SceneLoadProfiler.begin("lambdaSystemInit");
        try {
            this.lambdaFileLoader ??= new LambdaFileLoader();

            if (!this.lambdaScriptInjector) {
                const {default: LambdaScriptInjectorClass} = await import("../../lambdas/LambdaScriptInjector");
                this.lambdaScriptInjector = new LambdaScriptInjectorClass();
            }

            this.lambdaManager ??= new LambdaManager(this);
        } finally {
            SceneLoadProfiler.end("lambdaSystemInit");
        }
    }

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
        scene: Scene,
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
        try {
            await this.ensureLambdaSystemInitialized();
        } catch (error) {
            console.error("[GameManager] Failed to initialize lambda system:", error);
            return false;
        }

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

        if (sceneLambdas.length === 0 && projectLambdas.length === 0) {
            console.log("[GameManager] createLambdaInstancesFromScene: 0 unique lambda type(s) to create");
            return;
        }

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

        const maybeYieldForPlayStart = this.resetRuntimeYieldController();
        let createdInstanceCount = 0;
        for (const data of byType.values()) {
            if (!data.enabled) continue;
            try {
                const instance = await this.lambdaManager.createInstance(data.lambdaId, {
                    uuid: data.instanceId,
                    attributes: data.attributes,
                    yieldToFrame: () => maybeYieldForPlayStart(true),
                });
                if (instance) {
                    createdInstanceCount++;
                }
            } catch (error) {
                console.error(`[GameManager] Failed to create lambda instance "${data.lambdaId}":`, error);
            }
            await maybeYieldForPlayStart();
        }

        if (createdInstanceCount === 0) return;

        // Register objects with their lambda components without monopolizing a frame on large scenes.
        const stack: Object3D[] = [this.scene];
        while (stack.length > 0) {
            const child = stack.pop();
            if (!child) continue;

            await this.registerLambdaComponentsForObjectProgressive(
                child,
                () => maybeYieldForPlayStart(true),
            );

            for (let i = child.children.length - 1; i >= 0; i--) {
                const nested = child.children[i];
                if (nested) stack.push(nested);
            }

            await maybeYieldForPlayStart();
        }
    }

    private registerLambdaComponentsForObject(object: Object3D): void {
        const components = object.userData?.lambdaComponents as LambdaComponentData[] | undefined;
        if (!components || !Array.isArray(components)) return;

        for (const comp of components) {
            this.registerLambdaComponentForObject(object, comp);
        }
    }

    private async registerLambdaComponentsForObjectProgressive(
        object: Object3D,
        yieldToFrame: () => Promise<void>,
    ): Promise<void> {
        const components = object.userData?.lambdaComponents as LambdaComponentData[] | undefined;
        if (!components || !Array.isArray(components)) return;

        for (const comp of components) {
            this.registerLambdaComponentForObject(object, comp);
            await yieldToFrame();
        }
    }

    private registerLambdaComponentForObject(object: Object3D, comp: LambdaComponentData): void {
        if (!comp.enabled) return;
        if (!comp.autoApply) return;
        if (!comp.instanceId) {
            console.warn(
                `[GameManager] Skipping lambda component "${comp.lambdaId}" on ${object.name || object.uuid} because it has no instanceId`,
            );
            return;
        }
        this.lambdaManager?.registerObject(comp.instanceId, object, comp.componentData);
    }

    //used by behaviors/copilot to set physics config to the object
    public setPhysicsConfig(object: Object3D, config: PhysicsConfig) {
        PhysicsUtil.setPhysicsConfig(object, config);
    }

    // add object to the scene or parent, add behaviors and physics if enabled
    // it will recursively add behaviors and physics for each child of the object
    addObject(object: Object3D, parent?: Object3D): Promise<void> {
        const operation = this.addObjectInternal(object, parent);
        if (!this.isInitializing) {
            return operation;
        }

        return this.trackPlayStartupSceneMutation(operation, this.playStartupSceneMutationToken);
    }

    private async addObjectInternal(object: Object3D, parent?: Object3D): Promise<void> {
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
        this.objectLookup?.registerTree(object);

        await this.initializeObject(object);
        const plotBudgetManager = this.plotBudgetManager;
        const textureResidencyManager = this.textureResidencyManager;
        if (plotBudgetManager || textureResidencyManager) {
            const consumers = [] as Array<(node: Object3D) => boolean>;
            // Plot discovery runs first so a newly marked plot root is visible
            // to texture discovery at the same node, preserving the existing
            // candidate short-circuiting and registration order.
            if (plotBudgetManager) {
                consumers.push(node => plotBudgetManager.registerObjectNode(node));
            }
            if (textureResidencyManager) {
                consumers.push(node => textureResidencyManager.registerObjectNode(node));
            }
            traverseObjectDepthFirstWithConsumers(object, consumers);
        }

        return Promise.resolve();
    }

    // remove object from the scene or parent, remove behaviors and physics if enabled
    // it will recursively remove behaviors and physics for each child of the object
    removeObject(object: Object3D): void {
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
        this.objectLookup?.unregisterTree(object);

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
    cloneObject(sourceObject: Object3D): Object3D | null {
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

    private handleObjectChanged = (_editor: any, object: Object3D) => {
        if (object === this.camera) {
            applyCameraProjectionSettings(this.camera, CameraControl.getCameraOptions(object));
        }

        if (this.cameraControl && object === this.cameraControl.camera) {
            this.cameraControl.updateCameraOptions();
        }
    };

    private handleGameInitialized = () => {
        if (!this.isInitializing) {
            this.engine.playerMask?.hide();
        }
    };

    private handleGameStarted = () => {
        if (!this.scene || !isRuntimeSceneRevealPendingOrActive(this.scene)) {
            this.engine.playerMask?.hide();
        }
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
                void this.engine.enableEditorCameraControls("play");
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
    async initializeObject(object: Object3D): Promise<void> {
        const startupMutationToken = this.playStartupSceneMutationToken;
        const touchStartupMutationProgress = () => {
            this.touchPlayStartupSceneMutationProgress(startupMutationToken);
        };
        touchStartupMutationProgress();
        const queue: Object3D[] = [object];
        const maybeYieldForInitialization = createProgressiveYieldController(
            {
                yieldToFrame: async () => {
                    await yieldPlayStartToPaint();
                    touchStartupMutationProgress();
                },
            },
            {
                batchSize: PLAY_START_ADD_OBJECT_INITIALIZATION_BATCH_SIZE,
                frameBudgetMs: PLAY_START_FRAME_BUDGET_MS,
            },
        );

        for (let queueHead = 0; queueHead < queue.length; queueHead++) {
            const current = queue[queueHead]!;
            touchStartupMutationProgress();

            // Runtime builders commonly add large numbers of leaf meshes that
            // carry no gameplay state. They do not need behavior/lambda/physics
            // initialization or pause handling; skipping the lifecycle loop
            // avoids several scheduler checkpoints per inert leaf while the
            // parent addObject operation still remains tracked by the startup
            // mutation barrier.
            const currentUserData = current.userData;
            const hasChildren = current.children.length > 0;
            const currentBehaviors = currentUserData?.behaviors as BehaviorData[] | undefined;
            const hasEnabledBehavior =
                Array.isArray(currentBehaviors) && currentBehaviors.some(behavior => behavior?.enabled === true);
            const hasLambdaComponents =
                Array.isArray(currentUserData?.lambdaComponents) && currentUserData.lambdaComponents.length > 0;
            const hasPhysics = PhysicsUtil.isPhysicsEnabled(current);
            if (!hasChildren && !hasEnabledBehavior && !hasLambdaComponents && !hasPhysics) {
                // Preserve the breadth-first traversal budget for large
                // behaviorless hierarchies. The controller only paints when
                // the batch/frame budget is exhausted, so this remains much
                // cheaper than entering the full lifecycle path while still
                // preventing one synchronous runtime build from monopolizing
                // the main thread.
                await maybeYieldForInitialization();
                continue;
            }

            // Behavior initialization already accounts for one progressive
            // work unit after every enabled behavior. Avoid charging the same
            // object a second time below: doing so halves the effective batch
            // size for runtime-added objects that carry behaviors, adding
            // redundant paint waits without changing the authored order.
            const yieldBehaviorToFrame = () => maybeYieldForInitialization(true);
            touchStartupMutationProgress();
            await this.addAllBehaviorsFromObjectProgressive(
                current,
                yieldBehaviorToFrame,
                () => maybeYieldForInitialization(),
                () => maybeYieldForInitialization(),
            );
            touchStartupMutationProgress();

            // Behaviors may author or update physics during startup. Keep this
            // check after behavior creation so runtime mutations retain the
            // established add-object semantics.
            // A behavior may enable physics during construction. Re-read the
            // authored/runtime state after behavior startup rather than using
            // the preflight value that only decides whether the inert-leaf
            // fast path is safe.
            const physicsEnabled = PhysicsUtil.isPhysicsEnabled(current);

            this.registerLambdaComponentsForObject(current);

            if (physicsEnabled) {
                touchStartupMutationProgress();
                await this.engine.physics?.addObject(current);
                touchStartupMutationProgress();
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

            // Objects without behaviors still need their own traversal budget.
            // Keep the object charge when physics or lambda registration adds
            // another potentially expensive mutation; behavior-only objects
            // were already charged by the progressive behavior loop above.
            if (!hasEnabledBehavior || physicsEnabled || hasLambdaComponents) {
                await maybeYieldForInitialization();
            }
            touchStartupMutationProgress();
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
    disposeObject(object: Object3D): void {
        traverseObjectDepthFirst(object, target => {
            this.removeAllBehaviorsForObject(target);

            if (PhysicsUtil.isPhysicsEnabled(target)) {
                this.engine.physics?.removeObject(target);
            }
        });
    }

    /**
     * Pauses the specified Object3D instance, optionally including all of its children.
     *
     * This method sets the `paused` flag in the object's `userData`, removes it from the physics simulation
     * if applicable, and pauses all associated behaviors. If `pauseChildren` is true, the method recursively
     * pauses all child objects as well.
     *
     * @param object - The Object3D to pause.
     * @param pauseChildren - Whether to recursively pause all child objects. Defaults to `true`.
     */
    pauseObject(object: Object3D, pauseChildren: boolean = true): void {
        const pauseSingleObject = (target: Object3D) => {
            // in sandbox mode the object can be paused by editor before it is initialized
            target.userData.paused = true;

            if (PhysicsUtil.isPhysicsEnabled(target)) {
                this.engine.physics?.removeObject(target);
            }

            this.behaviorManager!.pauseObjectBehaviors(target);
        };

        if (pauseChildren) {
            traverseObjectDepthFirst(object, pauseSingleObject);
        } else {
            pauseSingleObject(object);
        }
    }

    /**
     * Resumes the specified Object3D instance by unpausing it, re-adding it to the physics engine if applicable,
     * and resuming all associated behaviors. Optionally, this operation can be recursively applied to all child objects.
     *
     * @param object - The Object3D instance to resume.
     * @param resumeChildren - Whether to recursively resume all child objects. Defaults to true.
     */
    resumeObject(object: Object3D, resumeChildren: boolean = true): void {
        const resumeSingleObject = (target: Object3D) => {
            // in sandbox mode the object can be paused by editor before it is initialized
            target.userData.paused = false;

            if (PhysicsUtil.isPhysicsEnabled(target)) {
                this.engine.physics?.addObject(target);
            }

            this.behaviorManager!.resumeObjectBehaviors(target);
        };

        if (resumeChildren) {
            traverseObjectDepthFirst(object, resumeSingleObject);
        } else {
            resumeSingleObject(object);
        }
    }

    /**
     * Proxy to AnimationController's playBlendedAnimations
     * @param object
     * @param blends
     * @param playOnce
     */
    playBlendedAnimations(object: Object3D, blends: BlendedAnimationParams[], playOnce?: boolean) {
        this.animationController?.playBlendedAnimations(object, blends, playOnce);
    }

    /**
     * Proxy to AnimationController's updateBlendedAnimationWeights
     * @param object
     * @param weights
     */
    updateBlendedAnimationWeights(object: Object3D, weights: {[name: string]: number}) {
        this.animationController?.updateBlendedAnimationWeights(object, weights);
    }

    /**
     * Classify objects that are fully static at game start.
     * Static objects skip per-frame matrix updates and spatial grid tracking.
     * @param scene
     */
    private async classifyStaticEntities(scene: Scene): Promise<void> {
        const maybeYieldForStaticClassification = createPlayStartYieldController();
        let count = 0;
        const stack: Object3D[] = [scene];

        while (stack.length > 0) {
            const node = stack.pop();
            if (!node) continue;

            if (this.isSceneStatic(node)) {
                setRuntimeUserDataValue(node, "_isSceneStatic", true);
                node.matrixAutoUpdate = false;
                node.matrixWorldAutoUpdate = false;
                count++;
            }

            for (let i = node.children.length - 1; i >= 0; i--) {
                const child = node.children[i];
                if (child) stack.push(child);
            }

            await maybeYieldForStaticClassification();
        }

        if (count > 0 && this.shouldLogBehaviorInitDetails()) {
            console.debug(`[GameManager] Classified ${count} objects as scene-static`);
        }
    }

    private isSceneStatic(node: Object3D): boolean {
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
