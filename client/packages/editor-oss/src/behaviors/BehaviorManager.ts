import {Object3D} from "three";

import global from "@stem/editor-oss/global";
import {
    BEHAVIOR_LIFECYCLE_HOOK_QUERY,
    BehaviorBase,
    Behavior,
    type BehaviorLifecycleHookName,
    BehaviorOptions,
    BehaviorThrottleConfig,
    AttributeChangeOptions,
    AttributeChangeResult,
    unwrapBehavior,
} from "./Behavior";
import {behaviorProfiler} from "../scheduler/SystemProfiler";
import type {FrameContext} from "../scheduler/types";
import {createGameObject} from "./stem/core/createGameObject";
import {createStemEngineInterface} from "./stem/createStemEngineInterface";
import {StemEngineInterface} from "./stem/StemEngineInterface";
import {GameObject} from "./stem/core/GameObject";
import {GlobalStore} from "./stem/store/GlobalStore";
import GameManager from "./game/GameManager";
import {IBehaviorThrottler, IThrottleConfig} from "./performance/interfaces/IThrottleStrategy";
import {ThrottleContainer, IThrottleContainer} from "./performance/ThrottleContainer";
import {BehaviorWorkerBridge} from "./worker/BehaviorWorkerBridge";
import {BehaviorWorkerPool} from "./worker/BehaviorWorkerPool";
import {deleteRuntimeUserDataValue} from "@stem/editor-oss/utils/userDataRuntime";
import {traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";
import {
    createProgressiveYieldController,
    type ProgressiveYieldOptions,
} from "@stem/editor-oss/utils/progressiveYield";
import {
    BehaviorUpdateErrorPolicy,
    type BehaviorUpdateErrorLogState,
    type TransientFullscreenRepairState,
} from "./BehaviorUpdateErrorPolicy";

const SCENE_STATIC_USER_DATA_KEY = "_isSceneStatic";
const DEFAULT_PROGRESS_BATCH_SIZE = 64;
const DEFAULT_PROGRESS_FRAME_BUDGET_MS = 8;
const STEM_PLAY_BEHAVIOR_PHASE_TIMING_CAP = 4096;
const SLOW_BEHAVIOR_INIT_WARNING_MS = 16;
const SLOW_BEHAVIOR_STARTUP_HOOK_WARNING_MS = 1000;
const SLOW_BEHAVIOR_STARTUP_HOOK_GUIDANCE =
    "Use this.erth.runtime.processInBatches(...) for large startup lists, or await this.erth.runtime.yieldToFrame(true) between manual batches that must guarantee a paint. The engine cannot preempt one long synchronous JavaScript callback.";

const isPromiseLike = <T = unknown>(value: unknown): value is PromiseLike<T> =>
    !!value &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as {then?: unknown}).then === "function";

function isCameraLike(value: unknown): boolean {
    if (!value || typeof value !== "object") {
        return false;
    }
    const camera = value as {isPerspectiveCamera?: boolean; isOrthographicCamera?: boolean};
    return camera.isPerspectiveCamera === true || camera.isOrthographicCamera === true;
}

type BehaviorCreationPhase = "constructor" | "init" | "start" | "worker";

interface BehaviorCreationPhaseTimingEntry {
    id: string;
    uuid?: string;
    target: string;
    phase: BehaviorCreationPhase;
    ms: number;
    success: boolean;
    message?: string;
}

export type BehaviorManagerProgressOptions = ProgressiveYieldOptions;

const nowForBehaviorCreationTiming = (): number =>
    typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();

function recordBehaviorCreationPhaseTiming(entry: BehaviorCreationPhaseTimingEntry): void {
    const root = globalThis as typeof globalThis & {
        __stemPlayBehaviorPhaseTimings?: BehaviorCreationPhaseTimingEntry[];
        __stemPlayBehaviorPhaseTimingsDropped?: number;
    };
    const timings = root.__stemPlayBehaviorPhaseTimings ??= [];
    if (timings.length < STEM_PLAY_BEHAVIOR_PHASE_TIMING_CAP) {
        timings.push(entry);
    } else {
        root.__stemPlayBehaviorPhaseTimingsDropped = (root.__stemPlayBehaviorPhaseTimingsDropped ?? 0) + 1;
    }
}

/**
 * BehaviorManager target type — accepts either the raw `THREE.Object3D` or a
 * `GameObject` wrapper. Several public APIs (`sendEventToObjectBehaviors`,
 * `getTargetBehaviors`, ...) used to silently fail when callers passed
 * `this.gameObject` (the recommended ergonomic surface) because the underlying
 * lookup uses strict-equality on the raw object. Accepting both shapes and
 * normalising via `unwrapTarget` keeps the docs ("prefer `gameObject`") aligned
 * with what actually works at runtime.
 */
export type BehaviorTarget = Object3D | GameObject;

/**
 * Returns the raw `THREE.Object3D` for a target argument, whether the caller
 * passed the raw object or a `GameObject` wrapper. The `GameObject` interface
 * (`erth/core/GameObject.ts`) exposes the underlying object via
 * `_internal.three` — see CLAUDE.md "Parenting — visual-only vs gameplay
 * object" for the canonical raw-access path.
 */
function unwrapTarget(target: BehaviorTarget | null | undefined): Object3D | null {
    if (!target) return null;
    if (target instanceof Object3D) return target;
    const wrapped = target;
    if (wrapped._internal && wrapped._internal.three) return wrapped._internal.three;
    return null;
}

export interface CreateBehaviorOptions {
    uuid?: string;
    attributes?: Record<string, any>;
    throttleConfig?: BehaviorThrottleConfig;
    /**
     * Internal startup scheduler hook. When omitted, the public behavior
     * yield hook is also used for lifecycle checkpoints for compatibility.
     */
    startupYieldToFrame?: () => Promise<void>;
    yieldToFrame?: () => Promise<void>;
}

// In case if user wants to add or remove behavior during update loop, we need to queue the command
type BehaviorCommand = {
    type: BehaviorCommandType;
    behavior: Behavior;
};

enum BehaviorCommandType {
    START,
    STOP,
}

interface AttributeChangeRequest {
    target: Behavior;
    key: string;
    value: any;
    requester: Behavior | null;
    resolve: (result: AttributeChangeResult) => void;
}

const BEHAVIOR_EVENT_LISTENERS = {
    mousedown: "onMouseDown",
    mouseup: "onMouseUp",
    mousemove: "onMouseMove",
    touchstart: "onTouchStart",
    touchend: "onTouchEnd",
    touchmove: "onTouchMove",
    wheel: "onMouseWheel",
    keydown: "onKeyDown",
    keyup: "onKeyUp",
    resize: "onResize",
};

class BehaviorManager {
    private behaviorConfigAttributes: Map<string, Record<string, any>> = new Map();
    private behaviorNames: Map<string, string> = new Map();
    private behaviorIdsByNormalizedName: Map<string, string[]> = new Map();
    private behaviorClasses: Map<string, any> = new Map();
    private behaviors: Behavior[] = [];
    // A scene object can own many behaviors (the TinySkies Globe is a good
    // example). Reusing the live GameObject view avoids allocating the same
    // physics façade and property closures once per behavior while preserving
    // the view's live position/rotation/scale/visibility semantics.
    private gameObjectsByTarget: WeakMap<Object3D, GameObject> = new WeakMap();
    private indexedBehaviorsRef: Behavior[] = this.behaviors;
    private indexedBehaviorCount: number = 0;
    private behaviorsByUuid: Map<string, Behavior> = new Map();
    private behaviorsById: Map<string, Set<Behavior>> = new Map();
    private behaviorsByTarget: Map<Object3D, Set<Behavior>> = new Map();
    private behaviorIndexedTargets: WeakMap<Behavior, Object3D> = new WeakMap();
    private behaviorOrder: WeakMap<Behavior, number> = new WeakMap();
    private behaviorMembership: WeakSet<Behavior> = new WeakSet();
    private nextBehaviorOrder: number = 0;
    private isProcessing: boolean = false;
    /** Prevent async behavior creation from resurrecting instances after teardown. */
    private disposed = false;
    private commandQueue: BehaviorCommand[] = [];
    private attributeChangeQueue: AttributeChangeRequest[] = [];
    game: GameManager;

    // Track which behaviors have already shown a given warning (to avoid spamming console)
    private static _deprecationWarnings = new Set<string>();

    // Dependency injection instead of singleton - industry standard approach
    private throttler: IBehaviorThrottler | null = null;
    private throttleContainer: IThrottleContainer;
    private erth: StemEngineInterface;
    private globalStore: GlobalStore;

    // Worker config per behavior id
    private behaviorWorkerConfigs: Map<string, { enabled: boolean; workerClass?: new () => Worker }> = new Map();

    // Performance tracking
    private frameCount: number = 0;
    private lastSpatialGrid: unknown = null; // track to avoid redundant setSpatialGrid calls
    private throttlingDisabledThisFrame: boolean = false;
    private hotBehaviorFlags: boolean[] = [];
    private hotBehaviorIndexes: number[] = [];
    private preparedHotBehaviorFrame = -1;
    private preparedHotBehaviorsRef: readonly Behavior[] | null = null;
    private preparedHotBehaviorCount = -1;
    private tailBehaviorResumeIndex: number = 0;
    private fixedUpdateBehaviors: Behavior[] | null = null;
    private fixedUpdateBehaviorsRef: Behavior[] | null = null;
    private fixedUpdateBehaviorSourceCount: number = -1;
    private behaviorUpdateErrorLogState: WeakMap<Behavior, BehaviorUpdateErrorLogState> = new WeakMap();
    private behaviorUpdateErrorBackoffCount = 0;
    private transientFullscreenRepairState: WeakMap<Behavior, TransientFullscreenRepairState> = new WeakMap();
    private behaviorUpdateErrorPolicy?: BehaviorUpdateErrorPolicy;

    constructor(
        game: GameManager,
        behaviorConfigAttributes: Map<string, Record<string, any>>,
        behaviorClasses: Map<string, any>,
        throttleContainer?: IThrottleContainer,
        behaviorNames?: Map<string, string>,
    ) {
        this.game = game;
        this.behaviorConfigAttributes = behaviorConfigAttributes;
        this.behaviorClasses = behaviorClasses;
        if (behaviorNames) {
            this.behaviorNames = behaviorNames;
            this.rebuildBehaviorNameIndex();
        }
        this.throttleContainer = throttleContainer || new ThrottleContainer();
        this.globalStore = new GlobalStore();
        this.erth = createStemEngineInterface(game, this.globalStore);

        // Configure throttling from scene data
        this.initializeThrottling();
    }

    getBehaviors(): readonly Behavior[] {
        return this.behaviors;
    }

    /**
     * Initialize throttling from scene userData using industry standard configuration
     */
    private initializeThrottling(): void {
        const throttlingConfig = this.game.scene?.userData?.game?.behaviorThrottling;
        this.throttler = this.throttleContainer.createBehaviorThrottler(throttlingConfig);
    }

    /**
     * Returns a human-readable label for a behavior id.
     * For script behaviors whose id is "assetId:revisionId", returns "name (shortId)" if a name is registered.
     * @param id
     */
    formatBehaviorId(id: string): string {
        const name = this.behaviorNames.get(id);
        if (name) {
            const short = id.includes(":") ? id.slice(0, 8) : id;
            return `"${name}" (${short})`;
        }
        return `"${id}"`;
    }

    /**
     * Indicates whether a behavior class with the given ID is registered.
     *
     * @param id - ID of the behavior class
     * @returns true if a behavior class with the given ID is registered, false
     * otherwise.
     */
    hasBehaviorClass(id: string): boolean {
        return this.behaviorClasses.has(id);
    }

    private getGameObject(target: Object3D): GameObject {
        // A few lightweight editor/test harnesses intentionally construct the
        // manager prototype without running the full constructor. Lazily
        // restore the cache in that case; normal instances still take the
        // allocation-free initialized path.
        this.gameObjectsByTarget ??= new WeakMap<Object3D, GameObject>();
        const cached = this.gameObjectsByTarget.get(target);
        if (cached) {
            return cached;
        }

        const gameObject = createGameObject(target, this.game);
        this.gameObjectsByTarget.set(target, gameObject);
        return gameObject;
    }

    /**
     * Dynamically register a behavior class.
     *
     * @param id - ID of the behavior class
     * @param behaviorConfigAttributes - Behavior config attributes
     * @param behaviorClass - Behavior class constructor
     * @param name - Optional human-readable name for logging
     * @param workerConfig
     * @param workerConfig.enabled
     * @param workerConfig.workerClass
     */
    registerBehaviorClass(
        id: string,
        behaviorConfigAttributes: Record<string, any>,
        behaviorClass: any,
        name?: string,
        workerConfig?: { enabled: boolean; workerClass?: new () => Worker },
    ): void {
        if (this.hasBehaviorClass(id)) {
            console.warn(
                `[BehaviorManager] Behavior class of id: ${this.formatBehaviorId(id)} already exists, overwriting`,
            );
        }

        this.behaviorClasses.set(id, behaviorClass);
        this.behaviorConfigAttributes.set(id, behaviorConfigAttributes);
        if (name) this.setBehaviorName(id, name);
        if (workerConfig) {
            this.behaviorWorkerConfigs.set(id, workerConfig);
        } else {
            this.behaviorWorkerConfigs.delete(id);
        }
    }

    async createBehavior(target: BehaviorTarget, id: string, options: CreateBehaviorOptions = {}): Promise<Behavior | null> {
        if (this.disposed) {
            return null;
        }
        const {yieldToFrame, startupYieldToFrame = yieldToFrame, ...creationOptions} = options;
        const maybeYieldToFrame = async (): Promise<void> => {
            if (startupYieldToFrame) {
                await startupYieldToFrame();
            }
        };
        const rawTarget = unwrapTarget(target);
        if (!rawTarget) {
            console.error(`[BehaviorManager] createBehavior: invalid target (not Object3D or GameObject)`);
            return Promise.resolve(null);
        }
        const behaviorClass = this.behaviorClasses.get(id);
        if (!behaviorClass) {
            console.error(`[BehaviorManager] Behavior class of id: "${id}" not found, cannot create behavior`);
            return Promise.resolve(null);
        }

        const behaviorOptions: BehaviorOptions = {
            ...creationOptions,
            erth: this.erth,
            gameObject: this.getGameObject(rawTarget),
            attributes: this.getAttributesForBehavior(id, creationOptions.attributes),
            throttleConfig: creationOptions.throttleConfig ?? {...this.game.scene?.userData?.behaviorsSettings},
            yieldToFrame,
        };

        // Reclassify static objects: if this target was marked scene-static at load time,
        // re-enable matrix updates now that it has a behavior attached.
        if (rawTarget.userData[SCENE_STATIC_USER_DATA_KEY]) {
            rawTarget.matrixAutoUpdate = true;
            rawTarget.matrixWorldAutoUpdate = true;
            deleteRuntimeUserDataValue(rawTarget, SCENE_STATIC_USER_DATA_KEY);
        }

        const targetLabel = rawTarget.name || rawTarget.uuid;
        let phaseStartedAt = nowForBehaviorCreationTiming();
        let behavior: BehaviorBase;
        await maybeYieldToFrame();
        if (this.disposed) {
            return null;
        }
        try {
            phaseStartedAt = nowForBehaviorCreationTiming();
            behavior = new behaviorClass(rawTarget, id, behaviorOptions) as BehaviorBase;
            recordBehaviorCreationPhaseTiming({
                id,
                uuid: behavior.uuid ?? creationOptions.uuid,
                target: targetLabel,
                phase: "constructor",
                ms: Math.round(nowForBehaviorCreationTiming() - phaseStartedAt),
                success: true,
            });
        } catch (error) {
            recordBehaviorCreationPhaseTiming({
                id,
                uuid: creationOptions.uuid,
                target: targetLabel,
                phase: "constructor",
                ms: Math.round(nowForBehaviorCreationTiming() - phaseStartedAt),
                success: false,
                message: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
        if (this.disposed) {
            this.handleBehaviorDispose(behavior);
            return null;
        }
        await maybeYieldToFrame();

        try {
            if (this.disposed) {
                this.handleBehaviorDispose(behavior);
                return null;
            }
            let currentPhase: BehaviorCreationPhase = "init";
            phaseStartedAt = nowForBehaviorCreationTiming();
            const initResult = behavior.init(this.game);

            try {
                await Promise.resolve(initResult);
                const initElapsedMs = Math.round(nowForBehaviorCreationTiming() - phaseStartedAt);
                recordBehaviorCreationPhaseTiming({
                    id,
                    uuid: behavior.uuid,
                    target: targetLabel,
                    phase: "init",
                    ms: initElapsedMs,
                    success: true,
                });
                if (initElapsedMs > SLOW_BEHAVIOR_INIT_WARNING_MS) {
                    console.warn(
                        `[BehaviorManager] Slow behavior init: ${this.formatBehaviorId(behavior.id)} on ${targetLabel} took ${initElapsedMs}ms. ${SLOW_BEHAVIOR_STARTUP_HOOK_GUIDANCE}`,
                    );
                }
                await maybeYieldToFrame();
                if (this.disposed) {
                    this.handleBehaviorDispose(behavior);
                    return null;
                }
                currentPhase = "start";
                phaseStartedAt = nowForBehaviorCreationTiming();
                await this.startBehavior(behavior, startupYieldToFrame);
                recordBehaviorCreationPhaseTiming({
                    id,
                    uuid: behavior.uuid,
                    target: targetLabel,
                    phase: "start",
                    ms: Math.round(nowForBehaviorCreationTiming() - phaseStartedAt),
                    success: true,
                });
                await maybeYieldToFrame();
                currentPhase = "worker";
                phaseStartedAt = nowForBehaviorCreationTiming();
                this.initBehaviorWorker(behavior);
                recordBehaviorCreationPhaseTiming({
                    id,
                    uuid: behavior.uuid,
                    target: targetLabel,
                    phase: "worker",
                    ms: Math.round(nowForBehaviorCreationTiming() - phaseStartedAt),
                    success: true,
                });
                return behavior;
            } catch (error) {
                recordBehaviorCreationPhaseTiming({
                    id,
                    uuid: behavior.uuid,
                    target: targetLabel,
                    phase: currentPhase,
                    ms: Math.round(nowForBehaviorCreationTiming() - phaseStartedAt),
                    success: false,
                    message: error instanceof Error ? error.message : String(error),
                });
                console.error(
                    `[BehaviorManager] Failed to initialize behavior ${this.formatBehaviorId(behavior.id)}:`,
                    error,
                );
                this.cleanupBehavior(behavior);
                return null;
            }
        } catch (error) {
            recordBehaviorCreationPhaseTiming({
                id,
                uuid: behavior.uuid,
                target: targetLabel,
                phase: "init",
                ms: Math.round(nowForBehaviorCreationTiming() - phaseStartedAt),
                success: false,
                message: error instanceof Error ? error.message : String(error),
            });
            console.error(
                `[BehaviorManager] Failed to initialize behavior ${this.formatBehaviorId(behavior.id)}:`,
                error,
            );
            this.cleanupBehavior(behavior);
            return Promise.resolve(null);
        }
    }

    destroyBehaviorFromObjectById(target: BehaviorTarget, id: string): void {
        const behaviors = this.getTargetBehaviorsById(target, id);
        for (let i = 0; i < behaviors.length; i++) {
            this.stopBehavior(behaviors[i]!);
        }
    }

    destroyBehavior(behavior: Behavior): void {
        this.stopBehavior(behavior);
    }

    private cleanupBehavior(behavior: Behavior): void {
        this.removeEventListeners(behavior);
        this.handleBehaviorDispose(behavior);
    }

    // get array of behavior using class type
    getBehaviorsOfType<T extends Behavior>(type: new () => T): T[] {
        const results: T[] = [];
        for (let i = 0; i < this.behaviors.length; i++) {
            const behavior = this.behaviors[i]!;
            if (behavior instanceof type) {
                results.push(behavior as T);
            }
        }
        return results;
    }

    private indexBehavior(behavior: Behavior, order = this.nextBehaviorOrder++): void {
        this.behaviorMembership.add(behavior);
        this.behaviorOrder.set(behavior, order);

        if (!this.behaviorsByUuid.has(behavior.uuid)) {
            this.behaviorsByUuid.set(behavior.uuid, behavior);
        }

        let idBucket = this.behaviorsById.get(behavior.id);
        if (!idBucket) {
            idBucket = new Set();
            this.behaviorsById.set(behavior.id, idBucket);
        }
        idBucket.add(behavior);

        this.addBehaviorToTargetIndex(behavior, behavior.target);
    }

    private unindexBehavior(behavior: Behavior): void {
        if (this.behaviorsByUuid.get(behavior.uuid) === behavior) {
            const replacement = this.behaviors.find(candidate => (
                candidate !== behavior && candidate.uuid === behavior.uuid
            ));
            if (replacement) {
                this.behaviorsByUuid.set(behavior.uuid, replacement);
            } else {
                this.behaviorsByUuid.delete(behavior.uuid);
            }
        }

        const idBucket = this.behaviorsById.get(behavior.id);
        if (idBucket) {
            idBucket.delete(behavior);
            if (idBucket.size === 0) {
                this.behaviorsById.delete(behavior.id);
            }
        }

        this.removeBehaviorFromTargetIndex(behavior, this.behaviorIndexedTargets.get(behavior) ?? behavior.target);
        this.behaviorIndexedTargets.delete(behavior);
        this.behaviorOrder.delete(behavior);
        this.behaviorMembership.delete(behavior);
    }

    private addBehaviorToTargetIndex(behavior: Behavior, target: Object3D | null | undefined): void {
        if (!target) {
            return;
        }

        let targetBucket = this.behaviorsByTarget.get(target);
        if (!targetBucket) {
            targetBucket = new Set();
            this.behaviorsByTarget.set(target, targetBucket);
        }
        targetBucket.add(behavior);
        this.behaviorIndexedTargets.set(behavior, target);
    }

    private removeBehaviorFromTargetIndex(behavior: Behavior, target: Object3D | null | undefined): void {
        if (!target) {
            return;
        }

        const targetBucket = this.behaviorsByTarget.get(target);
        if (!targetBucket) {
            return;
        }

        targetBucket.delete(behavior);
        if (targetBucket.size === 0) {
            this.behaviorsByTarget.delete(target);
        }
    }

    syncBehaviorTargetIndex(behavior: Behavior, previousTarget?: Object3D | null): void {
        this.ensureBehaviorIndexesCurrent();
        if (!this.behaviorsById.get(behavior.id)?.has(behavior)) {
            return;
        }

        const indexedTarget = this.behaviorIndexedTargets.get(behavior) ?? null;
        const nextTarget = behavior.target ?? null;
        if (indexedTarget === nextTarget) {
            return;
        }

        this.removeBehaviorFromTargetIndex(behavior, indexedTarget);
        if (previousTarget && previousTarget !== indexedTarget) {
            this.removeBehaviorFromTargetIndex(behavior, previousTarget);
        }
        this.addBehaviorToTargetIndex(behavior, nextTarget);
    }

    private markBehaviorIndexesCurrent(): void {
        this.indexedBehaviorsRef = this.behaviors;
        this.indexedBehaviorCount = this.behaviors.length;
    }

    private rebuildBehaviorIndexes(): void {
        this.behaviorsByUuid.clear();
        this.behaviorsById.clear();
        this.behaviorsByTarget.clear();
        this.behaviorIndexedTargets = new WeakMap();
        this.behaviorOrder = new WeakMap();
        this.behaviorMembership = new WeakSet();
        this.nextBehaviorOrder = 0;
        for (let i = 0; i < this.behaviors.length; i++) {
            this.indexBehavior(this.behaviors[i]!, i);
        }
        this.nextBehaviorOrder = this.behaviors.length;
        this.markBehaviorIndexesCurrent();
    }

    private ensureBehaviorIndexesCurrent(): void {
        if (
            this.indexedBehaviorsRef !== this.behaviors ||
            this.indexedBehaviorCount !== this.behaviors.length
        ) {
            this.rebuildBehaviorIndexes();
        }
    }

    private getBehaviorsForResolvedIds(resolvedIds: readonly string[]): Behavior[] {
        this.ensureBehaviorIndexesCurrent();

        if (resolvedIds.length === 0) {
            return [];
        }

        if (resolvedIds.length === 1) {
            const idBucket = this.behaviorsById.get(resolvedIds[0]!);
            return this.sortBehaviorsByManagerOrder(this.copyBehaviorSet(idBucket));
        }

        const candidates: Behavior[] = [];
        for (let i = 0; i < resolvedIds.length; i++) {
            const id = resolvedIds[i]!;
            const idBucket = this.behaviorsById.get(id);
            if (!idBucket) continue;
            for (const behavior of idBucket) {
                candidates.push(behavior);
            }
        }

        if (candidates.length === 0) {
            return [];
        }

        return this.sortBehaviorsByManagerOrder(candidates);
    }

    private sortBehaviorsByManagerOrder(behaviors: Behavior[]): Behavior[] {
        if (behaviors.length < 2) {
            return behaviors;
        }

        return behaviors.sort((a, b) => (
            (this.behaviorOrder.get(a) ?? 0) - (this.behaviorOrder.get(b) ?? 0)
        ));
    }

    private copyBehaviorSet(source: Set<Behavior> | undefined): Behavior[] {
        if (!source || source.size === 0) {
            return [];
        }

        const results: Behavior[] = new Array(source.size);
        let index = 0;
        for (const behavior of source) {
            results[index++] = behavior;
        }
        return results;
    }

    private isResolvedBehaviorId(id: string, resolvedIds: readonly string[]): boolean {
        for (let i = 0; i < resolvedIds.length; i++) {
            if (resolvedIds[i] === id) {
                return true;
            }
        }
        return false;
    }

    private resolveBehaviorIds(query: string): string[] {
        this.ensureBehaviorIndexesCurrent();

        if (
            this.behaviorClasses.has(query) ||
            this.behaviorConfigAttributes.has(query) ||
            this.behaviorsById.has(query)
        ) {
            return [query];
        }

        const normalizedQuery = this.normalizeBehaviorName(query);
        if (!normalizedQuery) {
            return [];
        }

        return this.behaviorIdsByNormalizedName.get(normalizedQuery) ?? [];
    }

    private normalizeBehaviorName(name: string): string {
        return name.trim().toLowerCase();
    }

    private rebuildBehaviorNameIndex(): void {
        this.behaviorIdsByNormalizedName.clear();
        this.behaviorNames.forEach((name, id) => this.indexBehaviorName(id, name));
    }

    private setBehaviorName(id: string, name: string): void {
        const previousName = this.behaviorNames.get(id);
        if (previousName) {
            this.unindexBehaviorName(id, previousName);
        }
        this.behaviorNames.set(id, name);
        this.indexBehaviorName(id, name);
    }

    private indexBehaviorName(id: string, name: string): void {
        const normalizedName = this.normalizeBehaviorName(name);
        if (!normalizedName) {
            return;
        }

        let ids = this.behaviorIdsByNormalizedName.get(normalizedName);
        if (!ids) {
            ids = [];
            this.behaviorIdsByNormalizedName.set(normalizedName, ids);
        }
        if (!ids.includes(id)) {
            ids.push(id);
        }
    }

    private unindexBehaviorName(id: string, name: string): void {
        const normalizedName = this.normalizeBehaviorName(name);
        if (!normalizedName) {
            return;
        }

        const ids = this.behaviorIdsByNormalizedName.get(normalizedName);
        if (!ids) {
            return;
        }

        const index = ids.indexOf(id);
        if (index !== -1) {
            ids.splice(index, 1);
        }
        if (ids.length === 0) {
            this.behaviorIdsByNormalizedName.delete(normalizedName);
        }
    }

    getBehaviorsById(id: string): Behavior[] {
        const resolvedIds = this.resolveBehaviorIds(id);
        return this.getBehaviorsForResolvedIds(resolvedIds);
    }

    getTargetBehaviors(target: BehaviorTarget): Behavior[] {
        const rawTarget = unwrapTarget(target);
        if (!rawTarget) return [];
        this.ensureBehaviorIndexesCurrent();

        const targetBucket = this.behaviorsByTarget.get(rawTarget);
        if (!targetBucket) {
            return [];
        }

        const results: Behavior[] = [];
        let hasStaleEntry = false;
        for (const behavior of targetBucket) {
            if (behavior.target === rawTarget) {
                results.push(behavior);
            } else {
                hasStaleEntry = true;
            }
        }

        if (!hasStaleEntry) {
            return this.sortBehaviorsByManagerOrder(results);
        }

        this.rebuildBehaviorIndexes();
        return this.sortBehaviorsByManagerOrder(this.copyBehaviorSet(this.behaviorsByTarget.get(rawTarget)));
    }

    getTargetBehaviorsById(target: BehaviorTarget, id: string): Behavior[] {
        const rawTarget = unwrapTarget(target);
        if (!rawTarget) return [];
        const resolvedIds = this.resolveBehaviorIds(id);
        if (resolvedIds.length === 0) {
            return [];
        }

        this.ensureBehaviorIndexesCurrent();
        const targetBucket = this.behaviorsByTarget.get(rawTarget);
        if (!targetBucket) {
            return [];
        }

        const results: Behavior[] = [];
        let hasStaleEntry = false;
        if (resolvedIds.length === 1) {
            const resolvedId = resolvedIds[0]!;
            const idBucket = this.behaviorsById.get(resolvedId);
            if (!idBucket) {
                return [];
            }

            const source = targetBucket.size <= idBucket.size ? targetBucket : idBucket;
            for (const behavior of source) {
                if (behavior.target === rawTarget && behavior.id === resolvedId) {
                    results.push(behavior);
                } else if (source === targetBucket && behavior.target !== rawTarget) {
                    hasStaleEntry = true;
                }
            }
        } else {
            for (const behavior of targetBucket) {
                if (behavior.target === rawTarget) {
                    if (this.isResolvedBehaviorId(behavior.id, resolvedIds)) {
                        results.push(behavior);
                    }
                } else {
                    hasStaleEntry = true;
                }
            }
        }

        if (hasStaleEntry) {
            this.rebuildBehaviorIndexes();
            return this.getTargetBehaviorsById(rawTarget, id);
        }

        return this.sortBehaviorsByManagerOrder(results);
    }

    getBehaviorByUUID(uuid: string): Behavior | null {
        this.ensureBehaviorIndexesCurrent();
        return this.behaviorsByUuid.get(uuid) ?? null;
    }

    retargetObjectBehaviors(targetUUID: string, newTarget: Object3D) {
        for (let i = 0; i < this.behaviors.length; i++) {
            const behavior = this.behaviors[i]!;
            if (behavior.target?.uuid !== targetUUID) {
                continue;
            }

            const previousTarget = behavior.target;
            behavior.setTarget(newTarget);
            this.syncBehaviorTargetIndex(behavior, previousTarget);
        }
    }

    private async startBehavior(behavior: Behavior, yieldToFrame?: () => Promise<void>): Promise<void> {
        if (this.disposed) {
            this.handleBehaviorDispose(behavior);
            return;
        }
        if (this.isProcessing) {
            this.queueCommand(BehaviorCommandType.START, behavior);
            return;
        }

        this.ensureBehaviorIndexesCurrent();
        if (this.behaviorMembership.has(behavior)) {
            console.warn(
                `[BehaviorManager] Behavior ${this.formatBehaviorId(behavior.id)} already exists, skipping add`,
            );
            return Promise.resolve();
        }

        try {
            await this.handleBehaviorStart(behavior, yieldToFrame);
            if (this.disposed) {
                this.handleBehaviorDispose(behavior);
                return;
            }
            this.behaviors.push(behavior);
            this.indexBehavior(behavior);
            this.markBehaviorIndexesCurrent();
            this.invalidateFixedUpdateBehaviorCache();
            this.tailBehaviorResumeIndex = 0;
        } catch (error) {
            console.error(`[BehaviorManager] Failed to add behavior ${this.formatBehaviorId(behavior.id)}:`, error);
            this.cleanupBehavior(behavior);
            throw error;
        }
    }

    private stopBehavior(behavior: Behavior): void {
        if (this.isProcessing) {
            this.queueCommand(BehaviorCommandType.STOP, behavior);
            return;
        }

        const index = this.behaviors.indexOf(behavior);
        if (index === -1) {
            console.warn(`[BehaviorManager] Behavior ${this.formatBehaviorId(behavior.id)} not found, cannot stop`);
            return;
        }

        this.handleBehaviorStop(behavior);
        this.handleBehaviorDispose(behavior);
        this.behaviors.splice(index, 1);
        this.unindexBehavior(behavior);
        this.markBehaviorIndexesCurrent();
        this.invalidateFixedUpdateBehaviorCache();
        this.tailBehaviorResumeIndex = 0;
    }

    update(deltaTime: number, context?: FrameContext): void {
        let throttlerFrameBegun = false;
        this.isProcessing = true;
        try {
            // Use orchestrator's frameCount when available, otherwise increment local counter
            if (context?.frameCount !== undefined) {
                this.frameCount = context.frameCount;
            } else {
                this.frameCount++;
            }

            const behaviors = this.behaviors;
            const len = behaviors.length;
            if (len === 0) {
                return;
            }

            // Wire spatial grid to throttler for O(1) distance lookups
            if (context?.spatialGrid !== this.lastSpatialGrid) {
                this.lastSpatialGrid = context?.spatialGrid ?? null;
                this.throttler?.setSpatialGrid?.(context?.spatialGrid ?? null);
            }

            // Feed orchestrator pressure into throttler so ALL behaviors get
            // proportionally reduced update rates instead of hard-cutting the tail.
            const pressureMultiplier = context?.underRenderPressure
                ? Math.min(4, 1 + Math.floor((context.renderAvgMs ?? 0) / 4))
                : 1;
            this.throttler?.setPressureMultiplier?.(pressureMultiplier);
            const throttlingConfig = this.game.scene?.userData?.game?.behaviorThrottling;
            this.throttlingDisabledThisFrame = throttlingConfig?.throttlingEnabled === false;

            // Update adaptive throttle scaling before processing behaviors
            this.throttler?.beginFrame?.(this.game.camera);
            throttlerFrameBegun = true;

            const profilingEnabled = behaviorProfiler.isEnabled();
            const hasPreparedHotBehaviors =
                context?.frameCount !== undefined &&
                this.preparedHotBehaviorFrame === context.frameCount &&
                this.preparedHotBehaviorsRef === behaviors &&
                this.preparedHotBehaviorCount === len;
            const hotBehaviorCount = hasPreparedHotBehaviors
                ? this.hotBehaviorIndexes.length
                : this.prepareHotBehaviorClassification(behaviors, len);
            this.preparedHotBehaviorFrame = -1;
            const hasHotBehaviors = hotBehaviorCount > 0;

            if (hasHotBehaviors) {
                // --- Hot prefix: critical/player-attached behaviors always run in stable order ---
                for (let i = 0; i < hotBehaviorCount; i++) {
                    const behavior = behaviors[this.hotBehaviorIndexes[i]!]!;
                    try {
                        this.updateBehavior(behavior, deltaTime, context, profilingEnabled);
                    } catch (error) {
                        this.reportBehaviorUpdateError(behavior, error);
                    }
                }
            }

            // --- Tail: every behavior is visited; throttler decides skip/update proportionally ---
            const deadline = context?.frameDeadline ?? Infinity;
            const hasFiniteDeadline = Number.isFinite(deadline);
            const tailCount = len - hotBehaviorCount;
            if (tailCount <= 0) {
                this.tailBehaviorResumeIndex = 0;
                return;
            }

            if (!hasFiniteDeadline) {
                this.tailBehaviorResumeIndex = 0;
                for (let i = 0; i < len; i++) {
                    if (hasHotBehaviors && this.hotBehaviorFlags[i]) {
                        continue;
                    }
                    this.updateTailBehavior(behaviors[i]!, deltaTime, context, profilingEnabled);
                }
                return;
            }

            const startIndex = this.normalizeTailBehaviorResumeIndex(behaviors, hasHotBehaviors);
            let index = startIndex;
            let tailProcessed = 0;

            while (tailProcessed < tailCount) {
                if (!hasHotBehaviors || !this.hotBehaviorFlags[index]) {
                    this.updateTailBehavior(behaviors[index]!, deltaTime, context, profilingEnabled);
                    tailProcessed++;
                    // Safety-net deadline bailout: throttler handles proportional reduction,
                    // but if we still exceed the frame budget, rotate the next frame to the
                    // skipped tail instead of repeatedly restarting from index zero.
                    if ((tailProcessed & 7) === 0 && performance.now() >= deadline) {
                        const nextIndex = (index + 1) % len;
                        this.tailBehaviorResumeIndex = this.findNextTailBehaviorIndex(
                            behaviors,
                            nextIndex,
                            hasHotBehaviors,
                        );
                        this.accumulateSkippedTailBehaviorDeltaCircular(
                            behaviors,
                            nextIndex,
                            tailCount - tailProcessed,
                            deltaTime,
                            hasHotBehaviors,
                        );
                        return;
                    }
                }

                index = (index + 1) % len;
            }

            this.tailBehaviorResumeIndex = 0;
        } finally {
            if (throttlerFrameBegun) {
                this.throttler?.endFrame?.();
            }
            this.isProcessing = false;
            this.processCommandQueue();
            this.processAttributeChangeQueue();
        }
    }

    private getUpdateErrorSignature(error: unknown): string {
        return this.getBehaviorUpdateErrorPolicy().getSignature(error);
    }

    private isSuppressedTransientUpdateError(signature: string, error?: unknown): boolean {
        return this.getBehaviorUpdateErrorPolicy().isSuppressedTransientError(signature, error);
    }

    private resolveFullscreenRepairCamera(): Object3D | null {
        const game = this.game as GameManager & {
            ensureUICamera?: () => Object3D;
            uiCamera?: Object3D;
        };

        try {
            const uiCamera = game.ensureUICamera?.();
            if (isCameraLike(uiCamera)) {
                return uiCamera;
            }
        } catch {
            // If the UI camera cannot be created yet, suppress this frame and
            // let the next update retry once startup has progressed.
        }

        const candidates = [
            game.uiCamera,
            game.camera,
            global.app?.camera,
        ];
        return candidates.find(isCameraLike) ?? null;
    }

    private repairTransientFullscreenRoots(behavior: Behavior): boolean {
        return this.getBehaviorUpdateErrorPolicy().repairTransientFullscreenRoots(behavior);
    }

    private shouldSkipBehaviorDueToRepeatedError(behavior: Behavior, phase: string): boolean {
        if ((this.behaviorUpdateErrorBackoffCount ?? 0) <= 0) return false;
        return this.getBehaviorUpdateErrorPolicy().shouldSkip(behavior, phase);
    }

    private clearBehaviorUpdateError(behavior: Behavior, phase: string): void {
        if ((this.behaviorUpdateErrorBackoffCount ?? 0) <= 0) return;
        this.getBehaviorUpdateErrorPolicy().clear(behavior, phase);
    }

    private reportBehaviorUpdateError(behavior: Behavior, error: unknown, phase = "update"): void {
        this.getBehaviorUpdateErrorPolicy().report(behavior, error, phase);
    }

    private getBehaviorUpdateErrorPolicy(): BehaviorUpdateErrorPolicy {
        this.behaviorUpdateErrorPolicy ??= new BehaviorUpdateErrorPolicy({
            getFrameCount: () => this.frameCount ?? 0,
            getErrorStates: () => {
                this.behaviorUpdateErrorLogState ??= new WeakMap();
                return this.behaviorUpdateErrorLogState;
            },
            getBackoffCount: () => this.behaviorUpdateErrorBackoffCount ?? 0,
            setBackoffCount: count => {
                this.behaviorUpdateErrorBackoffCount = count;
            },
            getFullscreenRepairStates: () => {
                this.transientFullscreenRepairState ??= new WeakMap();
                return this.transientFullscreenRepairState;
            },
            resolveFullscreenCamera: () => this.resolveFullscreenRepairCamera(),
            formatBehaviorId: id => this.formatBehaviorId(id),
        });
        return this.behaviorUpdateErrorPolicy;
    }

    /**
     * Fixed-timestep update for behaviors that implement fixedUpdate().
     * Kept for legacy runtime callers and behavior API compatibility.
     * @param fixedDeltaTime
     * @param context
     */
    fixedUpdate(fixedDeltaTime: number, _context?: FrameContext): void {
        this.isProcessing = true;
        try {
            const behaviors = this.getFixedUpdateBehaviors();
            const profilingEnabled = behaviorProfiler.isEnabled();
            for (let i = 0; i < behaviors.length; i++) {
                const behavior = behaviors[i]!;
                if (behavior.isPaused) continue;
                if (this.shouldSkipBehaviorDueToRepeatedError(behavior, "fixedUpdate")) continue;

                try {
                    if (profilingEnabled) {
                        behaviorProfiler.beginMeasure(behavior.uuid);
                    }
                    try {
                        behavior.fixedUpdate!(fixedDeltaTime);
                        this.clearBehaviorUpdateError(behavior, "fixedUpdate");
                    } finally {
                        if (profilingEnabled) {
                            behaviorProfiler.endMeasure(behavior.uuid, behavior.id);
                        }
                    }
                } catch (error) {
                    this.reportBehaviorUpdateError(behavior, error, "fixedUpdate");
                }
            }
        } finally {
            this.isProcessing = false;
            this.processCommandQueue();
            this.processAttributeChangeQueue();
        }
    }

    private getFixedUpdateBehaviors(): readonly Behavior[] {
        const behaviors = this.behaviors;
        if (
            this.fixedUpdateBehaviors &&
            this.fixedUpdateBehaviorsRef === behaviors &&
            this.fixedUpdateBehaviorSourceCount === behaviors.length
        ) {
            return this.fixedUpdateBehaviors;
        }

        const fixedBehaviors: Behavior[] = [];
        for (let i = 0; i < behaviors.length; i++) {
            const behavior = behaviors[i]!;
            if (typeof behavior.fixedUpdate === "function") {
                fixedBehaviors.push(behavior);
            }
        }

        this.fixedUpdateBehaviors = fixedBehaviors;
        this.fixedUpdateBehaviorsRef = behaviors;
        this.fixedUpdateBehaviorSourceCount = behaviors.length;
        return fixedBehaviors;
    }

    private invalidateFixedUpdateBehaviorCache(): void {
        this.fixedUpdateBehaviors = null;
        this.fixedUpdateBehaviorsRef = null;
        this.fixedUpdateBehaviorSourceCount = -1;
    }

    /**
     * Checks if the behavior should be updated in this frame
     * @param behavior
     * @param deltaTime
     */
    private shouldUpdateBehavior(behavior: Behavior, deltaTime: number): boolean {
        if (behavior.isPaused) {
            return false;
        }

        // Explicit behavior configuration
        if (behavior.throttleConfig?.requiresConsistentUpdates) {
            return true;
        }

        // Any behavior attached to the player should not be throttled
        if (behavior.target && behavior.target === this.game.player) {
            return true;
        }

        if (!this.game.camera || !this.throttler) {
            // No camera or throttler — update everything
            return true;
        }

        // Global throttling disable via config
        if (this.throttlingDisabledThisFrame) {
            return true;
        }

        // Check via throttler
        return this.throttler.shouldUpdateBehaviorFast
            ? this.throttler.shouldUpdateBehaviorFast(behavior, this.game.camera, this.frameCount, deltaTime)
            : !!this.throttler.shouldUpdateBehavior(behavior, this.game.camera, this.frameCount, deltaTime).shouldUpdate;
    }

    private isHotBehavior(behavior: Behavior): boolean {
        return !!(
            behavior.throttleConfig?.requiresConsistentUpdates ||
            (behavior.target && behavior.target === this.game.player)
        );
    }

    private prepareHotBehaviorClassification(behaviors: readonly Behavior[], len = behaviors.length): number {
        return this.prepareBehaviorClassificationAndSpatialTargets(behaviors, len);
    }

    private prepareBehaviorClassificationAndSpatialTargets(
        behaviors: readonly Behavior[],
        len: number,
        trackObject?: (object: Object3D | null | undefined) => void,
    ): number {
        const previousHotBehaviorCount = this.hotBehaviorIndexes.length;
        for (let i = 0; i < previousHotBehaviorCount; i++) {
            this.hotBehaviorFlags[this.hotBehaviorIndexes[i]!] = false;
        }

        let hotBehaviorCount = 0;

        for (let i = 0; i < len; i++) {
            const behavior = behaviors[i]!;
            if (this.isHotBehavior(behavior)) {
                this.hotBehaviorFlags[i] = true;
                this.hotBehaviorIndexes[hotBehaviorCount++] = i;
            }
            if (trackObject && behavior.throttleConfig?.enableDistanceThrottling !== false) {
                trackObject(behavior.target);
            }
        }

        this.hotBehaviorFlags.length = len;
        this.hotBehaviorIndexes.length = hotBehaviorCount;
        return hotBehaviorCount;
    }

    prepareFrameSpatialTargets(
        trackObject: (object: Object3D | null | undefined) => void,
        frameCount: number,
        collectTargets = true,
    ): void {
        const behaviors = this.behaviors;
        this.prepareBehaviorClassificationAndSpatialTargets(
            behaviors,
            behaviors.length,
            collectTargets ? trackObject : undefined,
        );
        this.preparedHotBehaviorFrame = frameCount;
        this.preparedHotBehaviorsRef = behaviors;
        this.preparedHotBehaviorCount = behaviors.length;
    }

    private updateBehavior(
        behavior: Behavior,
        deltaTime: number,
        context?: FrameContext,
        profilingEnabled = behaviorProfiler.isEnabled(),
    ): void {
        if (this.shouldSkipBehaviorDueToRepeatedError(behavior, "update")) {
            behavior._accumulatedDelta = 0;
            return;
        }

        if (!this.shouldUpdateBehavior(behavior, deltaTime)) {
            // Accumulate skipped time so next update can catch up smoothly
            behavior._accumulatedDelta = (behavior._accumulatedDelta ?? 0) + deltaTime;
            return;
        }

        const effectiveDelta = deltaTime + (behavior._accumulatedDelta ?? 0);
        behavior._accumulatedDelta = 0;
        if (profilingEnabled) {
            behaviorProfiler.beginMeasure(behavior.uuid);
        }
        try {
            // Fallback: when fixed updates are off and the behavior only implements fixedUpdate
            // (no custom update), call fixedUpdate so the creator's logic still runs.
            if (
                !context?.fixedUpdatesEnabled &&
                typeof behavior.fixedUpdate === "function" &&
                behavior.update === BehaviorBase.prototype.update
            ) {
                behavior.fixedUpdate(effectiveDelta);
            } else {
                behavior.update(effectiveDelta);
            }
            this.clearBehaviorUpdateError(behavior, "update");
        } finally {
            if (profilingEnabled) {
                behaviorProfiler.endMeasure(behavior.uuid, behavior.id);
            }
        }
    }

    private updateTailBehavior(
        behavior: Behavior,
        deltaTime: number,
        context: FrameContext | undefined,
        profilingEnabled: boolean,
    ): void {
        try {
            this.updateBehavior(behavior, deltaTime, context, profilingEnabled);
        } catch (error) {
            this.reportBehaviorUpdateError(behavior, error);
        }
    }

    private normalizeTailBehaviorResumeIndex(
        behaviors: readonly Behavior[],
        hasHotBehaviors = true,
    ): number {
        if (behaviors.length === 0) {
            return 0;
        }
        const startIndex = Number.isFinite(this.tailBehaviorResumeIndex)
            ? Math.min(Math.max(0, Math.trunc(this.tailBehaviorResumeIndex)), behaviors.length - 1)
            : 0;
        return this.findNextTailBehaviorIndex(behaviors, startIndex, hasHotBehaviors);
    }

    private findNextTailBehaviorIndex(
        behaviors: readonly Behavior[],
        startIndex: number,
        hasHotBehaviors = true,
    ): number {
        if (behaviors.length === 0) {
            return 0;
        }

        let index = ((Math.trunc(startIndex) % behaviors.length) + behaviors.length) % behaviors.length;
        for (let scanned = 0; scanned < behaviors.length; scanned++) {
            if (!hasHotBehaviors || !this.hotBehaviorFlags[index]) {
                return index;
            }
            index = (index + 1) % behaviors.length;
        }
        return 0;
    }

    private accumulateSkippedTailBehaviorDeltaCircular(
        behaviors: readonly Behavior[],
        startIndex: number,
        skippedTailCount: number,
        deltaTime: number,
        hasHotBehaviors = true,
    ): void {
        if (skippedTailCount <= 0 || behaviors.length === 0) {
            return;
        }

        let index = ((Math.trunc(startIndex) % behaviors.length) + behaviors.length) % behaviors.length;
        let skipped = 0;
        let scanned = 0;
        while (skipped < skippedTailCount && scanned < behaviors.length) {
            if (hasHotBehaviors && this.hotBehaviorFlags[index]) {
                index = (index + 1) % behaviors.length;
                scanned++;
                continue;
            }
            const behavior = behaviors[index]!;
            behavior._accumulatedDelta = (behavior._accumulatedDelta ?? 0) + deltaTime;
            skipped++;
            index = (index + 1) % behaviors.length;
            scanned++;
        }
    }

    /**
     * Gets current performance metrics from the throttler
     */
    getPerformanceMetrics() {
        return this.throttler ? this.throttler.getMetrics() : null;
    }

    /** Access profiler for debugging — call behaviorManager.profiler to inspect */
    get profiler() {
        return behaviorProfiler;
    }

    /**
     * Updates throttling configuration
     * @param config
     */
    updateThrottlingConfig(config: Partial<IThrottleConfig>): void {
        if (this.throttler) {
            this.throttler.configure(config);
        }
    }

    private resetBehavior(behavior: Behavior): boolean {
        if (!this.hasBehaviorLifecycleHook(behavior, "onReset")) {
            return false;
        }

        try {
            behavior.onReset();
        } catch (error) {
            console.error(
                `[BehaviorManager] Error during behavior reset for ${this.formatBehaviorId(behavior.id)}:`,
                error,
            );
        }

        return true;
    }

    private hasBehaviorLifecycleHook(behavior: Behavior, hookName: BehaviorLifecycleHookName): boolean {
        const hookQuery = behavior[BEHAVIOR_LIFECYCLE_HOOK_QUERY];
        if (typeof hookQuery === "function") {
            return hookQuery.call(behavior, hookName);
        }

        const hook = behavior[hookName];
        if (typeof hook !== "function") {
            return false;
        }

        return hook !== BehaviorBase.prototype[hookName as keyof BehaviorBase];
    }

    // TODO: reset is not well defined, how and when to call and use it?
    reset(): void {
        this.isProcessing = true;
        try {
            this.behaviors.forEach(behavior => {
                this.resetBehavior(behavior);
            });
        } finally {
            this.isProcessing = false;
        }

        this.processCommandQueue();
    }

    async resetProgressive(options: BehaviorManagerProgressOptions = {}): Promise<void> {
        const maybeYield = createProgressiveYieldController(options, {
            batchSize: DEFAULT_PROGRESS_BATCH_SIZE,
            frameBudgetMs: DEFAULT_PROGRESS_FRAME_BUDGET_MS,
        });

        this.isProcessing = true;
        try {
            for (let i = 0; i < this.behaviors.length; i++) {
                const behavior = this.behaviors[i]!;
                if (this.resetBehavior(behavior)) {
                    await maybeYield();
                }
            }
        } finally {
            this.isProcessing = false;
        }

        this.processCommandQueue();
    }

    /**
     * Clears the global store. Called when game starts (not on resume).
     */
    resetStore(): void {
        this.globalStore.clear();
    }

    /**
     * Request an attribute change on a behavior.
     * Async by default (queued), sync if options.sync is true.
     * @param target
     * @param key
     * @param value
     * @param requester
     * @param options
     */
    requestAttributeChange(
        target: Behavior,
        key: string,
        value: any,
        requester: Behavior | null,
        options?: AttributeChangeOptions,
    ): Promise<AttributeChangeResult> | AttributeChangeResult {
        const actualTarget = unwrapBehavior(target);
        const actualRequester = unwrapBehavior(requester);

        if (options?.sync) {
            return this.processAttributeChange(actualTarget, key, value, actualRequester);
        }

        return new Promise<AttributeChangeResult>(resolve => {
            this.attributeChangeQueue.push({target: actualTarget, key, value, requester: actualRequester, resolve});
        });
    }

    private processAttributeChange(
        target: Behavior,
        key: string,
        value: any,
        requester: Behavior | null,
    ): AttributeChangeResult {
        const oldValue = target.attributes[key];

        // Check with owner if they accept the change
        const accepted = target.onAttributeChangeRequested?.(key, value, oldValue, requester) !== false;

        if (accepted) {
            target.attributes[key] = value;
            this.updateObjectUserDataBehavior(target);
            target.onAttributeChanged?.(key, value, oldValue);
            try {
                target.onAttributesUpdated();
            } catch (error) {
                console.error(`[BehaviorManager] Error during behavior onAttributesUpdated for ${target.id}:`, error);
            }
        }

        return {accepted, key, value: accepted ? value : oldValue, previousValue: oldValue};
    }

    private processAttributeChangeQueue(): void {
        for (let i = 0; i < this.attributeChangeQueue.length; i++) {
            const req = this.attributeChangeQueue[i]!;
            const result = this.processAttributeChange(req.target, req.key, req.value, req.requester);
            req.resolve(result);
        }
        this.attributeChangeQueue.length = 0;
    }

    applyAttributesToBehavior(behavior: Behavior, attributes: Record<string, any>): void {
        const behaviorAttributes = behavior.attributes;

        // Apply all attributes directly, not just the ones in config
        // This ensures throttling attributes are preserved even if not in behavior config
        Object.keys(attributes).forEach(key => {
            const oldValue = behaviorAttributes[key];
            behaviorAttributes[key] = attributes[key];
            // Fire granular per-key notification
            try {
                behavior.onAttributeChanged?.(key, attributes[key], oldValue);
            } catch (error) {
                console.error(
                    `[BehaviorManager] Error during behavior onAttributeChanged for ${this.formatBehaviorId(behavior.id)}:`,
                    error,
                );
            }
        });

        // CRITICAL: Update the object's userData.behaviors for scene persistence
        this.updateObjectUserDataBehavior(behavior);

        try {
            behavior.onAttributesUpdated();
        } catch (error) {
            console.error(
                `[BehaviorManager] Error during behavior onAttributesUpdated for ${this.formatBehaviorId(behavior.id)}:`,
                error,
            );
        }
    }

    sendEventToObjectBehaviors(target: BehaviorTarget, event: string, eventData?: any, exceptIds: string[] = []): void {
        const targetBehaviors = this.getTargetBehaviors(target);
        const excludedIds = exceptIds.length > 3 ? new Set(exceptIds) : null;

        for (let i = 0; i < targetBehaviors.length; i++) {
            const behavior = targetBehaviors[i]!;
            if (excludedIds ? excludedIds.has(behavior.id) : exceptIds.includes(behavior.id)) {
                continue;
            }

            try {
                const result: any = behavior.onEvent(event, eventData);
                if (isPromiseLike(result)) {
                    void Promise.resolve(result).catch(error => {
                        console.error(
                            `[BehaviorManager] Error during behavior onEvent for ${this.formatBehaviorId(behavior.id)}:`,
                            error,
                        );
                    });
                }
            } catch (error) {
                console.error(
                    `[BehaviorManager] Error during behavior onEvent for ${this.formatBehaviorId(behavior.id)}:`,
                    error,
                );
            }
        }
    }

    private updateObjectUserDataBehavior(behavior: Behavior): void {
        const parentObject = behavior.parent;
        if (!parentObject || !parentObject.userData || !parentObject.userData.behaviors) {
            console.warn(
                "[BehaviorManager] Cannot update userData.behaviors - missing parent object or behaviors array",
            );
            return;
        }

        // Find the behavior in the object's userData.behaviors array
        const behaviorIndex = parentObject.userData.behaviors.findIndex((b: any) => b.uuid === behavior.uuid);
        if (behaviorIndex === -1) {
            console.warn("[BehaviorManager] Cannot find behavior ${behavior.uuid} in object userData.behaviors");
            return;
        }

        // Update the behavior data with current attributes
        const behaviorData = parentObject.userData.behaviors[behaviorIndex];

        // Merge the current attributes into the userData
        behaviorData.attributesData = {
            ...behaviorData.attributesData,
            ...behavior.attributes,
        };

        global.app?.call("objectChanged", null, parentObject); // Notify editor of the change
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.isProcessing = true;

        this.behaviors.forEach(behavior => {
            this.handleBehaviorStop(behavior);
        });

        this.behaviors.forEach(behavior => {
            this.handleBehaviorDispose(behavior);
        });

        this.isProcessing = false;
        this.processCommandQueue();
        this.behaviors = [];
        this.rebuildBehaviorIndexes();
        this.invalidateFixedUpdateBehaviorCache();
        this.tailBehaviorResumeIndex = 0;
        this.behaviorUpdateErrorLogState = new WeakMap();
        this.behaviorUpdateErrorBackoffCount = 0;
        this.gameObjectsByTarget = new WeakMap();
        this.globalStore.clear();

        // Clean up throttler
        if (this.throttler) {
            this.throttler.dispose();
            this.throttler = null;
        }
        behaviorProfiler.dispose();
    }

    pauseObjectBehaviors(object: Object3D): void {
        this.getTargetBehaviors(object).forEach(behavior => {
            this.pauseBehavior(behavior);
        });
    }

    pauseBehavior(behavior: Behavior): void {
        try {
            if (!behavior.isPaused) {
                behavior.isPaused = true;
                behavior.onPaused();
            }
        } catch (error) {
            console.error(
                `[BehaviorManager] Error during behavior pause for ${this.formatBehaviorId(behavior.id)}:`,
                error,
            );
        }
    }

    resumeObjectBehaviors(object: Object3D): void {
        this.getTargetBehaviors(object).forEach(behavior => {
            this.resumeBehavior(behavior);
        });
    }

    resumeBehavior(behavior: Behavior): void {
        try {
            if (behavior.isPaused) {
                behavior.isPaused = false;
                behavior.onResumed();
            }
        } catch (error) {
            console.error(
                `[BehaviorManager] Error during behavior resume for ${this.formatBehaviorId(behavior.id)}:`,
                error,
            );
        }
    }

    private async handleBehaviorStart(behavior: Behavior, yieldToFrame?: () => Promise<void>): Promise<void> {
        const transformSnapshot = this.captureTransformSnapshot(behavior.target);
        try {
            this.addEventListeners(behavior);
            await yieldToFrame?.();

            if (behavior.onAdded) {
                const key = `onAdded:${behavior.id}`;
                if (!BehaviorManager._deprecationWarnings.has(key)) {
                    console.warn(
                        `[BehaviorManager] onAdded is deprecated, use onStart instead for ${this.formatBehaviorId(behavior.id)}`,
                    );
                    BehaviorManager._deprecationWarnings.add(key);
                }
                const startAt = nowForBehaviorCreationTiming();
                await behavior.onAdded();
                const elapsedMs = nowForBehaviorCreationTiming() - startAt;
                if (elapsedMs > SLOW_BEHAVIOR_STARTUP_HOOK_WARNING_MS) {
                    console.warn(
                        `[BehaviorManager] Slow behavior onAdded: ${this.formatBehaviorId(behavior.id)} on ${behavior.target.name || behavior.target.uuid} took ${Math.round(elapsedMs)}ms. ${SLOW_BEHAVIOR_STARTUP_HOOK_GUIDANCE}`,
                    );
                }
            } else {
                const startAt = nowForBehaviorCreationTiming();
                await behavior.onStart();
                const elapsedMs = nowForBehaviorCreationTiming() - startAt;
                if (elapsedMs > SLOW_BEHAVIOR_STARTUP_HOOK_WARNING_MS) {
                    console.warn(
                        `[BehaviorManager] Slow behavior onStart: ${this.formatBehaviorId(behavior.id)} on ${behavior.target.name || behavior.target.uuid} took ${Math.round(elapsedMs)}ms. ${SLOW_BEHAVIOR_STARTUP_HOOK_GUIDANCE}`,
                    );
                }
            }

            if (!this.hasFiniteTransform(behavior.target)) {
                this.restoreTransformSnapshot(behavior.target, transformSnapshot);
                console.error(
                    `[BehaviorManager] Restored invalid transform written during onAdded/onStart for ${this.formatBehaviorId(behavior.id)} (target: ${behavior.target.uuid})`,
                );
            }
        } catch (error) {
            if (this.isSuppressedTransientUpdateError(this.getUpdateErrorSignature(error), error)) {
                this.repairTransientFullscreenRoots(behavior);
                return;
            }
            console.error(
                `[BehaviorManager] Error during behavior onAdded/onStart for ${this.formatBehaviorId(behavior.id)}:`,
                error,
            );
            return Promise.reject(error);
        }
    }

    private handleBehaviorStop(behavior: Behavior): void {
        // order matters
        this.removeEventListeners(behavior);
        behavior._workerBridge?.sendStop();
        behavior._workerPool?.sendStop();
        try {
            if (behavior.onRemoved) {
                const key = `onRemoved:${behavior.id}`;
                if (!BehaviorManager._deprecationWarnings.has(key)) {
                    console.warn(
                        `[BehaviorManager] onRemoved is deprecated, use onStop instead for ${this.formatBehaviorId(behavior.id)}`,
                    );
                    BehaviorManager._deprecationWarnings.add(key);
                }
                behavior.onRemoved();
            } else {
                behavior.onStop();
            }
        } catch (error) {
            console.error(
                `[BehaviorManager] Error during behavior onRemoved/onStop for ${this.formatBehaviorId(behavior.id)}:`,
                error,
            );
        }
    }

    private handleBehaviorDispose(behavior: Behavior): void {
        behavior._workerBridge?.dispose();
        behavior._workerPool?.dispose();
        try {
            behavior.dispose();
        } catch (error) {
            console.error(
                `[BehaviorManager] Error during behavior dispose for ${this.formatBehaviorId(behavior.id)}:`,
                error,
            );
        }
    }

    private initBehaviorWorker(behavior: Behavior): void {
        const registered = this.behaviorWorkerConfigs.get(behavior.id);

        // Two paths to opt in to a worker:
        //  1. Registration-time `workerConfig` passed to `registerBehaviorClass`
        //     (engine-bundled behaviors via Vite `?worker` import).
        //  2. Instance-level `behavior.workerClass` set inside async `init()`
        //     — the manager reads it after `init()` resolves (see
        //     `createBehavior`). Importer games use this path with a
        //     constructor that wraps `new Worker(scriptAssetUrl)`.
        const ctor = registered?.workerClass ?? behavior.workerClass;
        const enabled = registered ? registered.enabled : !!ctor;
        if (!enabled || !ctor) return;

        const label = this.formatBehaviorId(behavior.id);
        const opts = behavior.workerOptions ?? {};
        const raw = !!opts.raw;
        const poolCount = behavior.workerPool?.count ?? 0;

        if (poolCount > 1) {
            // Pool mode requires raw bridges (Comlink doesn't pool naturally).
            if (!raw) {
                console.warn(`[BehaviorManager] workerPool requires workerOptions.raw=true for ${label}; spawning pool with raw mode.`);
            }
            const pool = new BehaviorWorkerPool(behavior, label, {count: poolCount});
            let success = false;
            try {
                success = pool.init(ctor);
            } catch (e) {
                console.error(`[BehaviorManager] Worker pool init failed for ${label}:`, e);
            }
            if (success) {
                behavior._workerPool = pool;
                pool.sendInit(behavior.getWorkerInitData?.("play") ?? {runtime: "play"});
                pool.sendStart();
            }
            return;
        }

        const bridge = new BehaviorWorkerBridge(behavior, label, {raw});
        let success = false;
        try {
            success = bridge.init(ctor);
        } catch (e) {
            console.error(`[BehaviorManager] Worker init failed for ${label}:`, e);
        }

        if (success) {
            behavior._workerBridge = bridge;
            bridge.sendInit(behavior.getWorkerInitData?.("play") ?? {runtime: "play"});
            bridge.sendStart();
        }
    }

    private addEventListeners(behavior: Behavior): void {
        const dom = this.game?.renderer?.domElement;
        if (!dom) {
            return;
        }

        // Initialize bound listeners storage if not exists
        if (!behavior._boundListeners) {
            behavior._boundListeners = {};
        }

        Object.keys(BEHAVIOR_EVENT_LISTENERS).forEach(key => {
            const event = key as keyof typeof BEHAVIOR_EVENT_LISTENERS;
            const handler = BEHAVIOR_EVENT_LISTENERS[event];
            if (behavior[handler]) {
                // Store the bound function reference for later removal
                const listener = behavior[handler].bind(behavior) as EventListener;
                behavior._boundListeners![event] = listener;
                (dom as EventTarget).addEventListener(event, listener);
            }
        });
    }

    private removeEventListeners(behavior: Behavior): void {
        const dom = this.game?.renderer?.domElement;
        if (!dom) {
            return;
        }

        if (!behavior._boundListeners) {
            return;
        }

        Object.keys(BEHAVIOR_EVENT_LISTENERS).forEach(key => {
            const event = key as keyof typeof BEHAVIOR_EVENT_LISTENERS;
            const handler = BEHAVIOR_EVENT_LISTENERS[event];
            if (behavior[handler] && behavior._boundListeners![event]) {
                (dom as EventTarget).removeEventListener(event, behavior._boundListeners![event]);
                delete behavior._boundListeners![event];
            }
        });

        // Clean up the bound listeners object
        delete behavior._boundListeners;
    }

    private getAttributesForBehavior(id: string, attributes: Record<string, any> = {}): Record<string, any> {
        const behaviorConfigAttributes = this.behaviorConfigAttributes.get(id);
        if (!behaviorConfigAttributes) {
            console.warn(
                `[BehaviorManager] Behavior config attributes of id: "${id}" not found, returning passed attributes`,
            );
            return attributes || {};
        }

        this.checkForWrongAttributes(id, behaviorConfigAttributes, attributes);

        // Always use the passed attributes - editor is responsible for providing complete, converted data
        return attributes || {};
    }

    private checkForWrongAttributes(
        id: string,
        configAttributes: Record<string, any>,
        behaviorAttributes: Record<string, any>,
    ): void {
        Object.keys(behaviorAttributes).forEach(key => {
            if (configAttributes[key] === undefined) {
                console.warn(`[BehaviorManager] Attribute "${key}" not found in behavior config for id "${id}"`);
                return;
            }
        });
    }

    private queueCommand(type: BehaviorCommandType, behavior: Behavior): void {
        this.commandQueue.push({type, behavior});
    }

    private captureTransformSnapshot(target: Object3D) {
        return {
            position: target.position.clone(),
            rotation: target.rotation.clone(),
            scale: target.scale.clone(),
        };
    }

    private hasFiniteTransform(target: Object3D): boolean {
        return (
            Number.isFinite(target.position.x) &&
            Number.isFinite(target.position.y) &&
            Number.isFinite(target.position.z) &&
            Number.isFinite(target.rotation.x) &&
            Number.isFinite(target.rotation.y) &&
            Number.isFinite(target.rotation.z) &&
            Number.isFinite(target.scale.x) &&
            Number.isFinite(target.scale.y) &&
            Number.isFinite(target.scale.z)
        );
    }

    private restoreTransformSnapshot(
        target: Object3D,
        snapshot: ReturnType<BehaviorManager["captureTransformSnapshot"]>,
    ): void {
        target.position.copy(snapshot.position);
        target.rotation.copy(snapshot.rotation);
        target.scale.copy(snapshot.scale);
    }

    private async processCommandQueue(): Promise<void> {
        if (this.commandQueue.length === 0) {
            return;
        }

        const commands = this.commandQueue;
        this.commandQueue = [];

        for (let i = 0; i < commands.length; i++) {
            const command = commands[i]!;
            switch (command.type) {
                case BehaviorCommandType.START:
                    await this.startBehavior(command.behavior);
                    break;
                case BehaviorCommandType.STOP:
                    this.stopBehavior(command.behavior);
                    break;
                default:
                    console.warn(`[BehaviorManager] Unknown command type: ${command.type}`);
                    break;
            }
        }
    }

    /**
     * Recursively cleanup behaviors for an object and all its children
     * This ensures proper behavior cleanup when objects are deleted
     * Note: Editor is responsible for plugin cleanup to follow SRP
     * @param object
     * @param game
     */
    cleanupBehaviorsForObjectAndChildren(object: Object3D, game?: GameManager): void {
        traverseObjectDepthFirst(object, target => {
            const behaviors = target.userData?.behaviors;
            if (behaviors && Array.isArray(behaviors)) {
                // Create a copy of the behaviors array to avoid modification during iteration
                const behaviorsCopy = [...behaviors];

                behaviorsCopy.forEach(behaviorData => {
                    try {
                        // Remove behavior from runtime (GameManager)
                        game?.removeBehaviorByUUID(behaviorData.uuid);
                        console.log(
                            `[BehaviorManager] Cleaned up behavior "${behaviorData.id}" (${behaviorData.uuid}) from deleted object "${target.name}"`,
                        );
                    } catch (error) {
                        console.error(
                            `[BehaviorManager] Error cleaning up behavior "${behaviorData.id}" (${behaviorData.uuid}):`,
                            error,
                        );
                    }
                });

                // Clear the behaviors array
                target.userData.behaviors = [];
            }

            if (target.userData?.lambdaComponents && Array.isArray(target.userData.lambdaComponents)) {
                game?.lambdaManager?.deregisterObjectFromAll(target);
                target.userData.lambdaComponents = [];
            }
        });
    }
}

export default BehaviorManager;
