/**
 * Behavior System Types for Behavior Scripts
 * This file is imported as a raw string for Monaco Editor IntelliSense
 */

// Augment THREE namespace with types not included in three-subset.d.ts
declare namespace THREE {
    interface Texture {
        uuid: string;
        name: string;
        image: any;
        dispose(): void;
    }
}

/** Wrapper object exposing a Three.js Object3D via _internal.three */
interface GameObject {
    _internal: { three: THREE.Object3D };
    [key: string]: any;
}

/**
 * Global data store shared among all behaviors.
 * Maximum 128 keys allowed. Reset when game starts.
 */
interface StemStore {
    /**
     * Get a value from the global store
     * @param key - The key to retrieve
     * @returns The value or undefined if not found
     */
    get<T = unknown>(key: string): T | undefined;

    /**
     * Set a value in the global store
     * @param key - The key to set
     * @param value - The value to store
     * @throws Error if max keys limit (128) would be exceeded
     */
    set<T = unknown>(key: string, value: T): void;

    /**
     * Check if a key exists in the global store
     * @param key - The key to check
     * @returns true if the key exists
     */
    has(key: string): boolean;

    /**
     * Delete a key from the global store
     * @param key - The key to delete
     * @returns true if the key was deleted
     */
    delete(key: string): boolean;

    /**
     * Get all keys in the global store
     * @returns Array of all keys
     */
    keys(): string[];

    /**
     * Get the number of keys in the global store
     */
    readonly size: number;
}

interface StemViewportSafeArea {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
    insetLeft: number;
    insetTop: number;
    insetRight: number;
    insetBottom: number;
}

interface StemViewport {
    /** Safe runtime viewport bounds in window coordinates. */
    getSafeArea(): StemViewportSafeArea;
}

/**
 * Erth interface providing access to game subsystems.
 * Access via this.erth in behavior scripts.
 */
interface StemEngineInterface {
    /**
     * Global data store shared among all behaviors.
     * Maximum 128 keys allowed. Reset when game starts.
     *
     * @example
     * // Store a value
     * this.erth.store.set("playerScore", 100);
     *
     * // Retrieve a value
     * const score = this.erth.store.get<number>("playerScore");
     *
     * // Check if key exists
     * if (this.erth.store.has("playerScore")) { ... }
     */
    store: StemStore;

    /** Measured visible runtime viewport for overlay-safe DOM and screen-space UI. */
    viewport: StemViewport;

    /** Asset subsystem for loading images, audio, video, and models from the asset library */
    asset: {
        image: {
            createTexture(assetRef: {assetId: string; revisionId: string}): Promise<THREE.Texture>;
            getUrl(assetRef: {assetId: string; revisionId: string}): Promise<string>;
            findByName(name: string): Promise<{assetId: string; revisionId: string} | null>;
        };
        audio: {
            getUrl(assetRef: {assetId: string; revisionId: string}): Promise<string>;
            findByName(name: string): Promise<{assetId: string; revisionId: string} | null>;
        };
        video: {
            getUrl(assetRef: {assetId: string; revisionId: string}): Promise<string>;
            findByName(name: string): Promise<{assetId: string; revisionId: string} | null>;
        };
        model: {
            preload(assetRef: {assetId: string; revisionId: string}): Promise<void>;
            createInstance(assetRef: {assetId: string; revisionId: string}): Promise<any>;
            unload(assetRef: {assetId: string; revisionId: string}): void;
            findByName(name: string): Promise<{assetId: string; revisionId: string} | null>;
        };
        stem: {
            preload(assetRef: {assetId: string; revisionId: string}): Promise<void>;
            createInstance(assetRef: {assetId: string; revisionId: string}): Promise<any>;
            unload(assetRef: {assetId: string; revisionId: string}): void;
            findByName(name: string): Promise<{assetId: string; revisionId: string} | null>;
        };
    };
}

interface BehaviorThrottleConfig {
    throttlePriority: number;
    enableFrustumCulling: boolean;
    enableDistanceThrottling: boolean;
    requiresConsistentUpdates: boolean;
}

type WorkerRuntime = "play" | "editor";

interface Behavior {
    /** The object that owns this behavior */
    readonly target: THREE.Object3D;
    /** Alias for target — the game object this behavior is attached to */
    readonly gameObject: THREE.Object3D;
    /** Behavior ID, example: "behavior.animation" */
    readonly id: string;
    /** Unique UUID per instance */
    readonly uuid: string;
    /** Behavior attributes. Foreign behavior instances expose this as read-only. */
    readonly attributes: Record<string, any>;
    /** Indicates if the behavior is paused */
    isPaused: boolean;
    /** Performance optimization configuration */
    throttleConfig: BehaviorThrottleConfig;
    /**
     * Erth interface providing access to game subsystems.
     * Use this.erth.store to access the global data store.
     */
    readonly erth: StemEngineInterface;

    /**
     * Called when the behavior is instantiated, target is not set yet.
     * If this function returns a promise, other behaviors will wait for it to resolve.
     * @param game - GameManager instance
     */
    init(game: GameManager): void | Promise<void>;

    /** Called when the behavior is disposed */
    dispose(): void;

    /**
     * Called every frame to update the behavior
     * @param deltaTime - Time elapsed since last frame in seconds
     */
    update(deltaTime: number): void;

    /**
     * Compatibility hook for older fixed-update-only behaviors.
     * The active runtime currently invokes this from the variable frame loop
     * when separate fixed stages are unavailable; do not use it for
     * deterministic timing until the fixed-step scheduler is re-enabled.
     * @param fixedDeltaTime - Current frame delta in seconds in compatibility mode
     */
    fixedUpdate?(fixedDeltaTime: number): void;

    /**
     * Read a single attribute value at runtime
     * @param key - The attribute key to read
     * @returns The current attribute value
     */
    getAttribute(key: string): any;

    /**
     * Request a change to an attribute value. Goes through the behavior system's change pipeline.
     * @param key - The attribute key to change
     * @param value - The new value
     * @param options - Optional: { sync: boolean } for synchronous changes
     * @returns A result indicating whether the change was accepted
     */
    requestAttributeChange(key: string, value: any, options?: { sync?: boolean }): Promise<{ accepted: boolean; key: string; value?: any; previousValue?: any }> | { accepted: boolean; key: string; value?: any; previousValue?: any };

    /**
     * Find a single behavior by type ID or display name on this object or a specific target
     * @param id - The behavior type ID or display name to search for
     * @param target - Optional target object (defaults to this object)
     * @returns The first matching behavior or null
     */
    findBehavior(id: string, target?: THREE.Object3D): Behavior | null;

    /**
     * Find all behaviors of a type across the entire scene by type ID or display name
     * @param id - The behavior type ID or display name to search for
     * @returns Array of matching behaviors
     */
    findBehaviors(id: string): Behavior[];

    /**
     * Called when the behavior is added to an object, target is set and you can access the object.
     * If this function returns a promise, the behavior will not be added until the promise is resolved.
     * @deprecated This method is deprecated in favor of onStart
     */
    onAdded?(): void | Promise<void>;

    /**
     * Called when the behavior is removed from an object.
     * @deprecated This method is deprecated, use onStop instead.
     */
    onRemoved?(): void;

    /** Called when the behavior is started */
    onStart(): void | Promise<void>;

    /** Called when the behavior is stopped */
    onStop(): void;

    /** Called when behavior is paused */
    onPaused(): void;

    /** Called when behavior is resumed */
    onResumed(): void;

    /** Called when the game is started or resumed */
    onReset(): void;

    /** Called when attributes are updated */
    onAttributesUpdated(): void;

    /**
     * Called when MP state got updated in GameManager.storage
     * @param key - State key
     * @param value - State value
     */
    onStateUpdated(key: string, value: string | undefined): void;

    /**
     * Called BEFORE an attribute change is applied. Return false to reject the change.
     * @param key - The attribute key being changed
     * @param newValue - The proposed new value
     * @param oldValue - The current value
     * @param requester - The behavior that requested the change, or null
     * @returns false to reject the change, true or void to accept
     */
    onAttributeChangeRequested?(key: string, newValue: any, oldValue: any, requester: Behavior | null): boolean;

    /**
     * Called AFTER an attribute change is applied.
     * @param key - The attribute key that changed
     * @param newValue - The new value
     * @param oldValue - The previous value
     */
    onAttributeChanged?(key: string, newValue: any, oldValue: any): void;

    /**
     * Called when an event is received
     * @param msg - Event message
     * @param data - Event data
     */
    onEvent(msg: string, data: any): void;

    /** Called once when the worker is initialized */
    workerInit?(initData: any): void;

    /** Cooperative task that runs inside the worker */
    workerTask?(): void | Promise<void>;

    /** Called when the main thread sends a message to the worker */
    workerOnMessage?(type: string, data: any): void;

    /** Called when the worker is about to be disposed */
    workerDispose?(): void;

    /** Called on the main thread when the worker posts a message back */
    onWorkerMessage?(type: string, data: any): void;

    /**
     * Returns init data for the worker. The runtime indicates whether the worker
     * was started from play mode or editor mode.
     */
    getWorkerInitData?(runtime: WorkerRuntime): any;

    // Editor specific methods

    /**
     * Called when the behavior is added to the editor
     * @param editor - Editor instance
     */
    onEditorAdded?(editor: any): void;

    /**
     * Called when the behavior is removed from the editor
     * Beware its not called when editor is disposed, like when you switch to game mode
     */
    onEditorRemoved?(): void;

    /**
     * Called when the editor is disposed, called when you switch to game mode or close the editor
     * Clean up any resources or listeners you added in onEditorAdded
     */
    onEditorDispose?(): void;

    /** Called when the editor is updated */
    onEditorUpdate?(): void;

    /** Called when the editor panel is shown */
    onEditorPanelShown?(): void;

    /** Called when the editor panel is hidden */
    onEditorPanelHidden?(): void;

    /** Called when the editor attributes are updated */
    onEditorAttributesUpdated?(): void;

    /**
     * Called when a custom button defined in behavior.json is clicked in the editor panel
     * @param action - The button action ID
     */
    onEditorButtonClicked?(action: string): void;

    /**
     * Called when an event is received in the editor mode
     * @param msg - Event message
     * @param data - Event data
     */
    onEditorEvent?(msg: string, data: any): void;

    /** Storage for bound event listeners to prevent memory leaks */
    _boundListeners?: Record<string, EventListener>;

    /** Index signature to allow dynamic properties */
    [key: string]: any;
}

// GameManager Interface
interface GameManager {
    /** Physics instance */
    physics?: IPhysics;
    /** Player object */
    player?: THREE.Object3D | null;
    /** THREE.js scene */
    scene?: THREE.Scene;
    /** THREE.js camera */
    camera?: THREE.Camera;
    /** Current score */
    score: number;
    /** Current lives */
    lives: number;
    /** Current health */
    health: number;

    /** Check if game is over */
    isGameOver(): boolean;
    /** Check if player is winner */
    isWinner(): boolean;
    /** Check if game is started */
    isGameStarted(): boolean;

    /** Safe runtime viewport bounds in window coordinates. */
    getViewportSafeArea(): StemViewportSafeArea;

    /** Add object to scene */
    addObject(object: THREE.Object3D, parent?: THREE.Object3D): Promise<void>;
    /** Remove object from scene */
    removeObject(object: THREE.Object3D): void;
    /** Clone object with all behaviors */
    cloneObject(sourceObject: THREE.Object3D): THREE.Object3D | null;

    /** Play sound by ID */
    playSound(soundId: string): void;
    /** Stop sound by ID */
    stopSound(soundId: string): void;

    /** Behavior manager for querying/controlling behaviors */
    behaviorManager?: BehaviorManager;
    /** Lambda manager for querying/controlling lambda instances */
    lambdaManager?: LambdaManager;
}

/**
 * Target argument for BehaviorManager methods. Accepts either the raw
 * `THREE.Object3D` or a `GameObject` wrapper — the manager unwraps `GameObject`
 * via `_internal.three` automatically. Pass `this.gameObject` directly from a
 * behavior; no need to dig into `_internal.three`.
 */
type BehaviorTarget = THREE.Object3D | GameObject;

// BehaviorManager Interface
interface BehaviorManager {
    /** Get all active behaviors */
    getBehaviors(): readonly Behavior[];
    /** Get behaviors by type ID or display name */
    getBehaviorsById(id: string): Behavior[];
    /** Get behaviors attached to a specific object (raw Object3D or GameObject wrapper) */
    getTargetBehaviors(target: BehaviorTarget): Behavior[];
    /** Get behaviors on a target by type ID or display name (raw Object3D or GameObject wrapper) */
    getTargetBehaviorsById(target: BehaviorTarget, id: string): Behavior[];
    /** Get a behavior by UUID */
    getBehaviorByUUID(uuid: string): Behavior | null;
    /** Send event to behaviors on an object (raw Object3D or GameObject wrapper) */
    sendEventToObjectBehaviors(target: BehaviorTarget, event: string, eventData?: any): void;
    /** Pause all behaviors on an object */
    pauseObjectBehaviors(object: THREE.Object3D): void;
    /** Resume all behaviors on an object */
    resumeObjectBehaviors(object: THREE.Object3D): void;
}

// LambdaManager Interface
interface LambdaManager {
    /** Create a new lambda instance */
    createInstance(lambdaId: string, options?: { uuid?: string; attributes?: Record<string, any> }): Promise<Lambda | null>;
    /** Destroy a lambda instance */
    destroyInstance(instanceId: string): void;
    /** Get instance by UUID */
    getInstance(instanceId: string): Lambda | null;
    /** Get all instances of a lambda type */
    getInstancesByType(lambdaId: string): Lambda[];
    /** Register an object with a lambda instance */
    registerObject(instanceId: string, target: THREE.Object3D, componentData?: Record<string, any>): boolean;
    /** Deregister an object from a lambda instance */
    deregisterObject(instanceId: string, target: THREE.Object3D): void;
    /** Get lambdas associated with an object */
    getObjectLambdas(target: THREE.Object3D): Lambda[];
    /** Send event to all lambdas on an object */
    sendEventToObjectLambdas(target: THREE.Object3D, event: string, eventData?: any): void;
}
