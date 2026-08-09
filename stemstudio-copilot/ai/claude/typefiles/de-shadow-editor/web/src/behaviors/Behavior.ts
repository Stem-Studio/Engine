import {MathUtils, Object3D} from "three";

import {ErthInterface} from "./erth/ErthInterface";
import Editor from "../editor/Editor";
import {GameObject} from './erth/core/GameObject';
import GameManager from "./game/GameManager";
import {BehaviorThrottlePriority} from "./performance/interfaces/IThrottleStrategy";
import type {BehaviorWorkerBridge} from "./worker/BehaviorWorkerBridge";
import type {BehaviorWorkerPool} from "./worker/BehaviorWorkerPool";

export type WorkerRuntime = "play" | "editor";
export const RAW_BEHAVIOR_SYMBOL = Symbol("rawBehavior");

const readonlyValueProxyCache = new WeakMap<object, unknown>();

const createReadonlyValueView = <T>(value: T): T => {
    if (typeof value !== "object" || value === null) {
        return value;
    }

    const cached = readonlyValueProxyCache.get(value as object) as T | undefined;
    if (cached) {
        return cached;
    }

    const proxy = new Proxy(value as object, {
        get(target, prop, receiver) {
            return createReadonlyValueView(Reflect.get(target, prop, receiver));
        },
        set() {
            return true;
        },
        deleteProperty() {
            return true;
        },
        defineProperty() {
            return true;
        },
        setPrototypeOf() {
            return false;
        },
    });

    readonlyValueProxyCache.set(value as object, proxy);
    return proxy as T;
};

const foreignBehaviorViewCache = new WeakMap<Behavior, Behavior>();

export const unwrapBehavior = <T extends Behavior | null | undefined>(behavior: T): T =>
    (((behavior as any)?.[RAW_BEHAVIOR_SYMBOL] as T | undefined) ?? behavior);

export const createForeignBehaviorView = (behavior: Behavior, requester?: Behavior | null): Behavior => {
    if (!behavior || behavior === requester) {
        return behavior;
    }

    const cached = foreignBehaviorViewCache.get(behavior);
    if (cached) {
        return cached;
    }

    const proxy = new Proxy(behavior, {
        get(target, prop) {
            if (prop === RAW_BEHAVIOR_SYMBOL) {
                return target;
            }
            if (prop === "attributes") {
                return createReadonlyValueView(target.attributes);
            }

            const value = Reflect.get(target, prop, target);
            return typeof value === "function" ? value.bind(target) : value;
        },
        set(target, prop, value) {
            if (prop === "attributes") {
                return true;
            }

            return Reflect.set(target, prop, value, target);
        },
    }) as Behavior;

    foreignBehaviorViewCache.set(behavior, proxy);
    return proxy;
};

export interface BehaviorThrottleConfig {
    throttlePriority: BehaviorThrottlePriority;
    enableFrustumCulling: boolean;
    enableDistanceThrottling: boolean;
    requiresConsistentUpdates: boolean;
    /** When true and object is off-screen, skip update entirely (not just throttled). Default false. */
    skipWhenInvisible?: boolean;
}

export interface AttributeChangeOptions {
    sync?: boolean;  // default: false (async)
}

export interface AttributeChangeResult {
    accepted: boolean;
    key: string;
    value?: any;
    previousValue?: any;
}

export interface BehaviorOptions {
    gameObject: GameObject;
    erth: ErthInterface;
    uuid?: string;
    attributes?: Record<string, any>;
    throttleConfig?: BehaviorThrottleConfig;
}

export type BehaviorConstructor = new (
    target: Object3D,
    id: string,
    options: BehaviorOptions
) => Behavior;

export interface Behavior {
    // The object that owns this behavior
    target: Object3D;
    setTarget(newTarget: Object3D): void;
    readonly gameObject: GameObject;
    readonly id: string; // example: "behavior.animation"
    readonly uuid: string; // unique uuid per instance
    /**
     * @deprecated Use getAttribute(key) instead. Direct attribute access will be removed in a future version.
     */
    readonly attributes: Record<string, any>;
    isPaused: boolean; // indicates if the behavior is paused

    // Explicit performance optimization configuration
    throttleConfig: BehaviorThrottleConfig;

    // Called when the behavior is instantiated, target is not set yet
    // If this function returns a promise, other behaviors will wait for it to resolve
    init(game: GameManager): void | Promise<void>;
    // Called when the behavior is disposed
    dispose(): void;

    // Called every frame to update the behavior (variable timestep)
    update(deltaTime: number): void;

    /**
     * Called at fixed timestep for physics-dependent logic (similar to Godot's _physics_process).
     * Runs from the legacy runtime loop when fixed-rate behavior updates are enabled.
     * The default fixed timestep is 60Hz unless the runtime overrides it.
     * Behaviors that need deterministic physics interaction should implement this method.
     * @param fixedDeltaTime - Fixed timestep in seconds (e.g., 1/60 = 0.0167s at 60Hz)
     */
    fixedUpdate?(fixedDeltaTime: number): void;

    /**
     * Called when the behavior is added to an object, target is set and you can access the object.
     * If this function returns a promise, the behavior will not be added until the promise is resolved.
     * @deprecated This method is deprecated in favor of `onStart`
     */
    onAdded?(): void | Promise<void>;

    /**
     * Called when the behavior is removed from an object.
     * @deprecated This method is deprecated, use `onStop` instead.
     */
    onRemoved?(): void;

    onStart(): void | Promise<void>; // TODO: call it after all behaviors are loaded
    onStop(): void;

    // Called when behavior is paused
    onPaused(): void;

    // Called when behavior is resumed
    onResumed(): void;

    // Called when the game is started or resumed
    onReset(): void;

    // Called when attributes are updated
    onAttributesUpdated(): void;

    // Read a single attribute by key
    getAttribute(key: string): any;

    // Request an attribute change on this behavior
    requestAttributeChange(key: string, value: any, options?: AttributeChangeOptions): Promise<AttributeChangeResult> | AttributeChangeResult;

    // Find a behavior by id on a target object (defaults to same object)
    findBehavior(id: string, target?: Object3D): Behavior | null;

    // Find all behaviors of a type in the scene
    findBehaviors(id: string): Behavior[];

    // Optional hook: accept/reject incoming attribute change requests. Return false to reject.
    onAttributeChangeRequested?(key: string, newValue: any, oldValue: any, requester: Behavior | null): boolean;

    // Optional hook: notified after an attribute was changed (granular, per-key)
    onAttributeChanged?(key: string, newValue: any, oldValue: any): void;

    // Called when MP state got updated in GameManager.storage
    onStateUpdated(key: string, value: string | undefined): void;

    // Called when an event is received (can be sync, async, or a generator)
    onEvent(msg: string, data: any): void | Promise<void> | Generator;

    // Worker class constructor. Two acceptable shapes:
    //  - Vite `?worker` import — a constructor that builds a Worker bundled at
    //    engine build time. Pair with the default Comlink-based bridge.
    //  - A plain `() => new Worker(url)` factory pointing at a `script` asset
    //    URL fetched via `erth.asset.script.getUrl()`. Pair with
    //    `workerOptions: { raw: true }` for raw `postMessage` worker sources.
    // Set in `init()` (the engine reads this after `init()` resolves) or pass
    // via `registerBehaviorClass(...workerConfig)` for engine-bundled behaviors.
    workerClass?: new () => Worker;

    /** Per-behavior worker options. `raw: true` skips Comlink wrapping. */
    workerOptions?: {
        raw?: boolean;
    };

    /**
     * Pool of N workers driven by one behavior. Set in `init()` to spawn a
     * pool instead of a single bridge. Requires raw mode (Comlink doesn't
     * pool naturally). When set, `postToWorker(type, data)` routes through
     * the pool's free-worker dispatcher.
     */
    workerPool?: {
        count: number;
    };

    // Main thread worker communication
    onWorkerMessage?(type: string, data: any): void;
    postToWorker?(type: string, data: any): void;
    getWorkerInitData?(runtime: WorkerRuntime): any;

    // Internal worker bridge instance (single-worker mode)
    _workerBridge?: BehaviorWorkerBridge;

    // Internal worker pool instance (set when workerPool.count > 1)
    _workerPool?: BehaviorWorkerPool;

    // Editor specific methods

    // Called when the behavior is added to the editor
    onEditorAdded?(editor: Editor): void;

    // Called when the behavior is removed from the editor
    // Beware its not called when editor is disposed, like when you switch to game mode
    onEditorRemoved?(): void;

    // Called when the editor is disposed, called when you switch to game mode or close the editor
    // Clean up any resources or listeners you added in onEditorAdded
    onEditorDispose?(): void;
    
    // Called when the editor is updated
    onEditorUpdate?(): void;

    // Called when the editor panel is shown
    onEditorPanelShown?(): void;

    // Called when the editor panel is hidden
    onEditorPanelHidden?(): void;

    // Called when the editor attributes are updated
    onEditorAttributesUpdated?(): void;

    // Called when a button in the editor panel is clicked
    onEditorButtonClicked?(action: string): void;

    // Called when an event is received in the editor mode
    onEditorEvent?(msg: string, data: any): void;

    // Storage for bound event listeners to prevent memory leaks
    _boundListeners?: Record<string, EventListener>;

    // Used to pass input methods to the behavior
    // TODO: remove this and find a better way to pass input methods to the behavior
    [key: string]: any;
}

export class BehaviorBase implements Behavior {
    readonly erth: ErthInterface;
    readonly gameObject: GameObject;
    target: Object3D; // in MP scenarios we may replace the target
    readonly id: string;
    readonly uuid: string;
    readonly attributes: Record<string, any>;
    public throttleConfig: BehaviorThrottleConfig = {
        throttlePriority: BehaviorThrottlePriority.MEDIUM,
        enableFrustumCulling: true,
        enableDistanceThrottling: true,
        requiresConsistentUpdates: false,
    };

    // TODO: user should not able to change this directly, because onPaused/resumed will not be called
    isPaused: boolean = false; // indicates if the behavior is paused

    /** Accumulated deltaTime from throttle-skipped frames — passed on next update for smooth catch-up */
    _accumulatedDelta: number = 0;

    constructor(target: Object3D, id: string, options: BehaviorOptions) {
        this.erth = options.erth;
        this.gameObject = options.gameObject;
        this.target = target;
        this.id = id;
        this.uuid = options.uuid || MathUtils.generateUUID();
        this.attributes = options.attributes || {};
        if (options.throttleConfig) {
            this.throttleConfig = {
                ...this.throttleConfig,
                ...options.throttleConfig,
            };
        }
    }

    [key: string]: any;
    onStateUpdated(key: string, value: string | undefined): void {}

    init(game: GameManager): void | Promise<void> {
        (this as any)._behaviorBaseGame = game;
    }

    dispose(): void {}
    // Throttling is handled automatically by BehaviorManager based on throttlePriority
    update(deltaTime: number): void {}

    setTarget(newTarget: Object3D): void {
        this.target = newTarget;
    }

    onStart(): void | Promise<void> {}
    onStop(): void {}

    onPaused(): void {}
    onResumed(): void {}
    onReset(): void {}
    onEvent(msg: string, data: any): void | Promise<void> | Generator {}
    onAttributesUpdated(): void {}

    // Main thread worker communication
    onWorkerMessage(type: string, data: any): void {}
    postToWorker(type: string, data: any): void {
        if (this._workerPool) {
            this._workerPool.sendMessage(type, data);
        } else {
            this._workerBridge?.sendMessage(type, data);
        }
    }
    getWorkerInitData(runtime: WorkerRuntime): any {
        return {runtime};
    }

    getAttribute(key: string): any {
        return this.attributes[key];
    }

    /** Returns the GameManager instance (set via init or subclass) */
    private _getGame(): GameManager {
        return (this as any)._behaviorBaseGame ?? (this as any).game;
    }

    requestAttributeChange(key: string, value: any, options?: AttributeChangeOptions): Promise<AttributeChangeResult> | AttributeChangeResult {
        return this._getGame().behaviorManager!.requestAttributeChange(this, key, value, null, options);
    }

    findBehavior(id: string, target?: Object3D): Behavior | null {
        const t = target ?? this.target;
        const results = this._getGame().behaviorManager!.getTargetBehaviorsById(t, id);
        return results[0] ? createForeignBehaviorView(results[0], this) : null;
    }

    findBehaviors(id: string): Behavior[] {
        return this._getGame().behaviorManager!.getBehaviorsById(id).map(behavior => createForeignBehaviorView(behavior, this));
    }
}
