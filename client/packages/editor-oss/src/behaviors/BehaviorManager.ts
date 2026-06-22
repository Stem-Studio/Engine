import {Object3D} from "three";

import global from "@stem/editor-oss/global";
import {
    BehaviorBase,
    Behavior,
    BehaviorOptions,
    BehaviorThrottleConfig,
    AttributeChangeOptions,
    AttributeChangeResult,
    unwrapBehavior,
} from "./Behavior";
import {behaviorProfiler} from "./BehaviorProfiler";
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
    private behaviorClasses: Map<string, any> = new Map();
    private behaviors: Behavior[] = [];
    private isProcessing: boolean = false;
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
        if (behaviorNames) this.behaviorNames = behaviorNames;
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
        if (name) this.behaviorNames.set(id, name);
        if (workerConfig) {
            this.behaviorWorkerConfigs.set(id, workerConfig);
        } else {
            this.behaviorWorkerConfigs.delete(id);
        }
    }

    async createBehavior(target: BehaviorTarget, id: string, options: CreateBehaviorOptions = {}): Promise<Behavior | null> {
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
            ...options,
            erth: this.erth,
            gameObject: createGameObject(rawTarget, this.game),
            attributes: this.getAttributesForBehavior(id, options.attributes),
            throttleConfig: options.throttleConfig ?? {...this.game.scene?.userData?.behaviorsSettings},
        };

        // Reclassify static objects: if this target was marked scene-static at load time,
        // re-enable matrix updates now that it has a behavior attached.
        if (rawTarget.userData._isSceneStatic) {
            rawTarget.matrixAutoUpdate = true;
            rawTarget.matrixWorldAutoUpdate = true;
            delete rawTarget.userData._isSceneStatic;
        }

        const behavior = new behaviorClass(rawTarget, id, behaviorOptions) as BehaviorBase;

        try {
            const initResult = behavior.init(this.game);

            try {
                await Promise.resolve(initResult);
                await this.startBehavior(behavior);
                this.initBehaviorWorker(behavior);
                return behavior;
            } catch (error) {
                console.error(
                    `[BehaviorManager] Failed to initialize behavior ${this.formatBehaviorId(behavior.id)}:`,
                    error,
                );
                this.cleanupBehavior(behavior);
                return null;
            }
        } catch (error) {
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
        behaviors.forEach(behavior => {
            this.stopBehavior(behavior);
        });
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
        return this.behaviors.filter(b => b instanceof type) as T[];
    }

    private resolveBehaviorIds(query: string): string[] {
        if (
            this.behaviorClasses.has(query) ||
            this.behaviorConfigAttributes.has(query) ||
            this.behaviors.some(behavior => behavior.id === query)
        ) {
            return [query];
        }

        const normalizedQuery = query.trim().toLowerCase();
        if (!normalizedQuery) {
            return [];
        }

        const matchedIds: string[] = [];
        for (const [id, name] of this.behaviorNames.entries()) {
            if (name.trim().toLowerCase() === normalizedQuery) {
                matchedIds.push(id);
            }
        }

        return matchedIds;
    }

    getBehaviorsById(id: string): Behavior[] {
        const resolvedIds = this.resolveBehaviorIds(id);
        if (resolvedIds.length === 0) {
            return [];
        }

        const idSet = new Set(resolvedIds);
        return this.behaviors.filter(b => idSet.has(b.id));
    }

    getTargetBehaviors(target: BehaviorTarget): Behavior[] {
        const rawTarget = unwrapTarget(target);
        if (!rawTarget) return [];
        return this.behaviors.filter(b => b.target === rawTarget);
    }

    getTargetBehaviorsById(target: BehaviorTarget, id: string): Behavior[] {
        const rawTarget = unwrapTarget(target);
        if (!rawTarget) return [];
        const resolvedIds = this.resolveBehaviorIds(id);
        if (resolvedIds.length === 0) {
            return [];
        }

        const idSet = new Set(resolvedIds);
        return this.behaviors.filter(b => b.target === rawTarget && idSet.has(b.id));
    }

    getBehaviorByUUID(uuid: string): Behavior | null {
        return this.behaviors.find(b => b.uuid === uuid) || null;
    }

    retargetObjectBehaviors(targetUUID: string, newTarget: Object3D) {
        this.behaviors
            .filter(b => b.target?.uuid === targetUUID)
            .forEach(behavior => {
                behavior.setTarget(newTarget);
            });
    }

    private async startBehavior(behavior: Behavior): Promise<void> {
        if (this.isProcessing) {
            this.queueCommand(BehaviorCommandType.START, behavior);
            return;
        }

        // slow but safe
        if (this.behaviors.includes(behavior)) {
            console.warn(
                `[BehaviorManager] Behavior ${this.formatBehaviorId(behavior.id)} already exists, skipping add`,
            );
            return Promise.resolve();
        }

        try {
            await this.handleBehaviorStart(behavior);
            this.behaviors.push(behavior);
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
    }

    update(deltaTime: number, context?: FrameContext): void {
        this.isProcessing = true;
        // Use orchestrator's frameCount when available, otherwise increment local counter
        if (context?.frameCount !== undefined) {
            this.frameCount = context.frameCount;
        } else {
            this.frameCount++;
        }

        // Wire spatial grid to throttler for O(1) distance lookups
        if (context?.spatialGrid !== this.lastSpatialGrid) {
            this.lastSpatialGrid = context?.spatialGrid ?? null;
            this.throttler?.setSpatialGrid?.(context?.spatialGrid ?? null);
        }

        // Update adaptive throttle scaling before processing behaviors
        this.throttler?.beginFrame?.();

        const frameBudgetMs = context?.frameDeadline != null ? context.frameDeadline - performance.now() : Infinity;
        const frameStart = performance.now();
        const behaviors = this.behaviors;

        for (let i = 0; i < behaviors.length; i++) {
            const behavior = behaviors[i]!;
            try {
                if (this.shouldUpdateBehavior(behavior, deltaTime)) {
                    const effectiveDelta = deltaTime + (behavior._accumulatedDelta ?? 0);
                    behavior._accumulatedDelta = 0;
                    behaviorProfiler.beginMeasure(behavior.uuid);
                    behavior.update(effectiveDelta);
                    behaviorProfiler.endMeasure(behavior.uuid, behavior.id);
                } else {
                    // Accumulate skipped time so next update can catch up smoothly
                    behavior._accumulatedDelta = (behavior._accumulatedDelta ?? 0) + deltaTime;
                }
            } catch (error) {
                console.error(
                    `[BehaviorManager] Error during behavior update for ${this.formatBehaviorId(behavior.id)}:`,
                    error,
                );
            }

            // Check frame budget every 8 behaviors to avoid performance.now() overhead
            if (i % 8 === 7 && performance.now() - frameStart > frameBudgetMs) {
                break;
            }
        }

        this.isProcessing = false;
        this.processCommandQueue();
        this.processAttributeChangeQueue();
    }

    /**
     * Generator version of update() for time-sliced execution.
     * Yields every 8 behaviors so TimeSliceRunner can suspend when
     * frame budget is exhausted and resume next frame.
     * @param deltaTime
     * @param context
     */
    // Declared as a generator so callers can iterate it for cooperative
    // scheduling. The current implementation completes synchronously
    // (the deadline bailout `break`s out of the inner loop) but the
    // Generator return type is part of the public contract.
    // eslint-disable-next-line require-yield
    *updateSliced(deltaTime: number, context?: FrameContext): Generator {
        this.isProcessing = true;
        try {
            // Use orchestrator's frameCount when available, otherwise increment local counter
            if (context?.frameCount !== undefined) {
                this.frameCount = context.frameCount;
            } else {
                this.frameCount++;
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

            // Update adaptive throttle scaling before processing behaviors
            this.throttler?.beginFrame?.();

            const behaviors = this.behaviors;
            const len = behaviors.length;
            if (len === 0) {
                return;
            }

            // --- Hot prefix: critical/player-attached behaviors always run in stable order ---
            const hot: Behavior[] = [];
            const tail: Behavior[] = [];
            for (let i = 0; i < len; i++) {
                const behavior = behaviors[i]!;
                const isHot =
                    behavior.throttleConfig?.requiresConsistentUpdates ||
                    (behavior.target && behavior.target === this.game.player);
                (isHot ? hot : tail).push(behavior);
            }

            for (const behavior of hot) {
                try {
                    if (this.shouldUpdateBehavior(behavior, deltaTime)) {
                        const effectiveDelta = deltaTime + (behavior._accumulatedDelta ?? 0);
                        behavior._accumulatedDelta = 0;
                        behaviorProfiler.beginMeasure(behavior.uuid);
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
                        behaviorProfiler.endMeasure(behavior.uuid, behavior.id);
                    } else {
                        behavior._accumulatedDelta = (behavior._accumulatedDelta ?? 0) + deltaTime;
                    }
                } catch (error) {
                    console.error(
                        `[BehaviorManager] Error during behavior update for ${this.formatBehaviorId(behavior.id)}:`,
                        error,
                    );
                }
            }

            // --- Tail: every behavior is visited; throttler decides skip/update proportionally ---
            const deadline = context?.frameDeadline ?? Infinity;
            for (let tailIndex = 0; tailIndex < tail.length; tailIndex++) {
                const behavior = tail[tailIndex]!;
                try {
                    if (this.shouldUpdateBehavior(behavior, deltaTime)) {
                        const effectiveDelta = deltaTime + (behavior._accumulatedDelta ?? 0);
                        behavior._accumulatedDelta = 0;
                        behaviorProfiler.beginMeasure(behavior.uuid);
                        behavior.update(effectiveDelta);
                        behaviorProfiler.endMeasure(behavior.uuid, behavior.id);
                    } else {
                        behavior._accumulatedDelta = (behavior._accumulatedDelta ?? 0) + deltaTime;
                    }
                } catch (error) {
                    console.error(`[BehaviorManager] Error during behavior update for ${this.formatBehaviorId(behavior.id)}:`, error);
                }
                // Safety-net deadline bailout: throttler handles proportional reduction,
                // but if we still exceed the frame budget, bail out early.
                if ((tailIndex & 7) === 7 && performance.now() >= deadline) {
                    // Accumulate skipped delta for remaining tail behaviors
                    for (let j = tailIndex + 1; j < tail.length; j++) {
                        tail[j]!._accumulatedDelta = (tail[j]!._accumulatedDelta ?? 0) + deltaTime;
                    }
                    break;
                }
            }
        } finally {
            this.isProcessing = false;
            void this.processCommandQueue();
            this.processAttributeChangeQueue();
        }
    }

    /**
     * Fixed-timestep update for behaviors that implement fixedUpdate().
     * Used by FixedBehaviorSystemAdapter.
     * @param fixedDeltaTime
     * @param context
     */
    fixedUpdate(fixedDeltaTime: number, _context?: FrameContext): void {
        this.isProcessing = true;
        try {
            const behaviors = this.behaviors;
            for (let i = 0; i < behaviors.length; i++) {
                const behavior = behaviors[i]!;
                if (behavior.isPaused) continue;

                // Fast-path: most behaviors only implement update() — not the
                // optional fixedUpdate() hook. Skip them silently. (Previously
                // this warned once per behavior, but with the fixed-rate
                // scheduler on a behavior-heavy scene that is dozens of
                // console.warn-with-stack-trace calls at play start, which —
                // especially with DevTools open — measurably stalls startup for
                // no benefit. Not implementing an optional hook is normal.)
                if (typeof behavior.fixedUpdate !== "function") continue;

                try {
                    behaviorProfiler.beginMeasure(behavior.uuid);
                    behavior.fixedUpdate(fixedDeltaTime);
                    behaviorProfiler.endMeasure(behavior.uuid, behavior.id);
                } catch (error) {
                    console.error(
                        `[BehaviorManager] Error during behavior fixedUpdate for ${this.formatBehaviorId(behavior.id)}:`,
                        error,
                    );
                }
            }
        } finally {
            this.isProcessing = false;
            this.processCommandQueue();
            this.processAttributeChangeQueue();
        }
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
        const throttlingConfig = this.game.scene?.userData?.game?.behaviorThrottling;
        if (throttlingConfig && throttlingConfig.throttlingEnabled === false) {
            return true;
        }

        // Check via throttler
        const throttleResult = this.throttler.shouldUpdateBehavior(
            behavior,
            this.game.camera,
            this.frameCount,
            deltaTime,
        );
        return !!throttleResult.shouldUpdate;
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

    // TODO: reset is not well defined, how and when to call and use it?
    reset(): void {
        this.isProcessing = true;
        this.behaviors.forEach(behavior => {
            try {
                behavior.onReset();
            } catch (error) {
                console.error(
                    `[BehaviorManager] Error during behavior reset for ${this.formatBehaviorId(behavior.id)}:`,
                    error,
                );
            }
        });
        this.isProcessing = false;

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
        while (this.attributeChangeQueue.length > 0) {
            const req = this.attributeChangeQueue.shift()!;
            const result = this.processAttributeChange(req.target, req.key, req.value, req.requester);
            req.resolve(result);
        }
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
        const targetBehaviors = this.getTargetBehaviors(target).filter(b => !exceptIds.includes(b.id));
        targetBehaviors.forEach(behavior => {
            try {
                const result: any = behavior.onEvent(event, eventData);
                if (result instanceof Promise) {
                    void result.catch(error => {
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
        });
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

    private async handleBehaviorStart(behavior: Behavior): Promise<void> {
        const transformSnapshot = this.captureTransformSnapshot(behavior.target);
        try {
            this.addEventListeners(behavior);

            if (behavior.onAdded) {
                const key = `onAdded:${behavior.id}`;
                if (!BehaviorManager._deprecationWarnings.has(key)) {
                    console.warn(
                        `[BehaviorManager] onAdded is deprecated, use onStart instead for ${this.formatBehaviorId(behavior.id)}`,
                    );
                    BehaviorManager._deprecationWarnings.add(key);
                }
                await behavior.onAdded();
            } else {
                await behavior.onStart();
            }

            if (!this.hasFiniteTransform(behavior.target)) {
                this.restoreTransformSnapshot(behavior.target, transformSnapshot);
                console.error(
                    `[BehaviorManager] Restored invalid transform written during onAdded/onStart for ${this.formatBehaviorId(behavior.id)} (target: ${behavior.target.uuid})`,
                );
            }
        } catch (error) {
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
            return Promise.resolve();
        }

        await Promise.all(
            this.commandQueue.map((command: BehaviorCommand) => {
                switch (command.type) {
                    case BehaviorCommandType.START:
                        return this.startBehavior(command.behavior);
                    case BehaviorCommandType.STOP:
                        this.stopBehavior(command.behavior);
                        return Promise.resolve();
                    default:
                        console.warn(`[BehaviorManager] Unknown command type: ${command.type}`);
                        return Promise.resolve();
                }
            }),
        );
        this.commandQueue = [];
    }

    /**
     * Recursively cleanup behaviors for an object and all its children
     * This ensures proper behavior cleanup when objects are deleted
     * Note: Editor is responsible for plugin cleanup to follow SRP
     * @param object
     * @param game
     */
    cleanupBehaviorsForObjectAndChildren(object: Object3D, game?: GameManager): void {
        // Clean up behaviors for this object
        const behaviors = object.userData?.behaviors;
        if (behaviors && Array.isArray(behaviors)) {
            // Create a copy of the behaviors array to avoid modification during iteration
            const behaviorsCopy = [...behaviors];

            behaviorsCopy.forEach(behaviorData => {
                try {
                    // Remove behavior from runtime (GameManager)
                    game?.removeBehaviorByUUID(behaviorData.uuid);
                    console.log(
                        `[BehaviorManager] Cleaned up behavior "${behaviorData.id}" (${behaviorData.uuid}) from deleted object "${object.name}"`,
                    );
                } catch (error) {
                    console.error(
                        `[BehaviorManager] Error cleaning up behavior "${behaviorData.id}" (${behaviorData.uuid}):`,
                        error,
                    );
                }
            });

            // Clear the behaviors array
            object.userData.behaviors = [];
        }

        // Clean up lambda components for this object
        if (object.userData?.lambdaComponents && Array.isArray(object.userData.lambdaComponents)) {
            game?.lambdaManager?.deregisterObjectFromAll(object);
            object.userData.lambdaComponents = [];
        }

        // Recursively clean up behaviors for all children
        object.children.forEach(child => {
            this.cleanupBehaviorsForObjectAndChildren(child, game);
        });
    }
}

export default BehaviorManager;
