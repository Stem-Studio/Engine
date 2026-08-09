import { Object3D } from 'three';

import type { Behavior, AttributeChangeOptions, AttributeChangeResult } from '../Behavior';
import { StemAI } from './ai/StemAI';
import { StemAsset } from './asset/StemAsset';
import { StemBehaviorTree } from './behaviorTree/StemBehaviorTree';
import { StemCamera } from './camera/StemCamera';
import { StemCombat } from './combat/StemCombat';
import { StemEvents } from './events/StemEvents';
import { StemFsm } from './fsm/StemFsm';
import { StemObject } from './object/StemObject';
import { StemPool } from './pool/StemPool';
import { StemScene } from './scene/StemScene';
import { StemSpatial } from './spatial/StemSpatial';
import { StemStore } from './store/StemStore';
import { StemTeam } from './team/StemTeam';
import { StemTween } from './tween/StemTween';
import type { Lambda } from '../../lambdas/Lambda';
import type {ViewportSafeArea} from '../../utils/viewportSafeArea';

export interface StemViewport {
    /**
     * Safe viewport rect in window coordinates.
     * Useful for DOM overlays or UI projection that must avoid host chrome.
     */
    getSafeArea(): ViewportSafeArea;
}

export interface StemRuntimeProcessInBatchesOptions {
    batchSize?: number;
    frameBudgetMs?: number;
    signal?: AbortSignal;
}

export interface StemRuntime {
    /**
     * Cooperatively yield startup or heavy runtime work back to the browser.
     *
     * Long-running generated behaviors should call this from async build loops:
     *
     *     await this.stem.runtime.yieldToFrame(true);
     *
     * Pass `true` to force a paint opportunity immediately after an expensive
     * operation.
     */
    yieldToFrame(force?: boolean): Promise<void>;

    /**
     * Process iterable startup/runtime work in cooperative chunks so the
     * browser can paint between batches.
     *
     *     await this.erth.runtime.processInBatches(items, async (item) => {
     *         buildItem(item);
     *     });
     *
     * The runtime can only yield between callbacks; one long synchronous
     * callback or loop still blocks JavaScript until it returns.
     */
    processInBatches<T>(
        items: Iterable<T>,
        process: (item: T, index: number) => void | Promise<void>,
        options?: StemRuntimeProcessInBatchesOptions,
    ): Promise<void>;
}

/**
 * Lambda ECS system access for behaviors.
 * Provides methods to query, register, and deregister objects with lambda instances.
 */
export interface StemLambdas {
    /**
     * Get a lambda instance by its instance ID.
     *
     * @param instanceId - The unique instance ID of the lambda
     * @returns The lambda instance, or null if not found
     */
    getInstance(instanceId: string): Lambda | null;

    /**
     * Get all lambda instances of a given type.
     *
     * @param lambdaId - The lambda type ID to filter by
     * @returns Array of matching lambda instances
     */
    getInstancesByType(lambdaId: string): Lambda[];

    /**
     * Register a 3D object with a lambda instance.
     *
     * @param instanceId - The lambda instance ID to register with
     * @param target - The 3D object to register
     * @param componentData - Optional initial component data for the object
     * @returns True if registration succeeded
     */
    registerObject(instanceId: string, target: Object3D, componentData?: Record<string, any>): boolean;

    /**
     * Deregister a 3D object from a lambda instance.
     *
     * @param instanceId - The lambda instance ID to deregister from
     * @param target - The 3D object to deregister
     */
    deregisterObject(instanceId: string, target: Object3D): void;

    /**
     * Get all lambda instances associated with a 3D object.
     *
     * @param target - The 3D object to query
     * @returns Array of lambda instances registered to the object
     */
    getObjectLambdas(target: Object3D): Lambda[];
}

/**
 * Behavior query and attribute access for cross-behavior communication.
 */
export interface StemBehaviors {
    /**
     * Find a specific behavior on a target object by behavior ID.
     *
     * @param target - The 3D object to search
     * @param id - The behavior type ID to find
     * @returns The behavior instance, or null if not found
     */
    find(target: Object3D, id: string): Behavior | null;

    /**
     * Find all behavior instances of a given type across the scene.
     *
     * @param id - The behavior type ID to find
     * @returns Array of matching behavior instances
     */
    findAll(id: string): Behavior[];

    /**
     * Find all behaviors attached to a target object.
     *
     * @param target - The 3D object to query
     * @returns Array of behavior instances on the object
     */
    findOnObject(target: Object3D): Behavior[];

    /**
     * Get the current value of a behavior attribute.
     *
     * @param behavior - The behavior instance to read from
     * @param key - The attribute key
     * @returns The attribute value
     */
    getAttribute(behavior: Behavior, key: string): any;

    /**
     * Request a change to a behavior attribute.
     *
     * @param behavior - The behavior instance to modify
     * @param key - The attribute key to change
     * @param value - The new value
     * @param options - Optional change options (e.g., source, skip validation)
     * @returns The result of the change request
     */
    requestChange(behavior: Behavior, key: string, value: any, options?: AttributeChangeOptions): Promise<AttributeChangeResult> | AttributeChangeResult;
}

/**
 * Top-level API surface exposed to behaviors via `this.stemEngine` (or the
 * backward-compatible `this.erth` alias). Provides access to all engine
 * subsystems for game logic.
 *
 * Prefer the `StemEngineInterface` name in new code. `StemEngineInterface` is
 * exported as a deprecation alias below — existing user-authored behaviors
 * that type-annotate `erth: StemEngineInterface` keep working unchanged.
 */
export interface StemEngineInterface {
    /** AI generation services (3D models, images). */
    ai: StemAI;
    /** Asset loading, instancing, and management. */
    asset: StemAsset;
    /** Camera position, orientation, and projection control. */
    camera: StemCamera;
    /** 3D object creation from Three.js objects. */
    object: StemObject;
    /** Measured visible runtime viewport for overlay-safe DOM and screen-space UI. */
    viewport: StemViewport;
    /** Runtime scheduling helpers for cooperative heavy work. */
    runtime: StemRuntime;
    /** Scene graph manipulation (adding objects). */
    scene: StemScene;
    /**
     * Global data store shared among all behaviors.
     * Maximum 128 keys allowed. Reset when game starts.
     */
    store: StemStore;
    /** Damage calculation and combat utilities. */
    combat: StemCombat;
    /** Team affiliation and enemy/friendly checks. */
    team: StemTeam;
    /** Generic object pooling for reusable instances. */
    pool: StemPool;
    /** Lambda ECS system query and registration. */
    lambdas: StemLambdas;
    /** Cross-behavior discovery and attribute access. */
    behaviors: StemBehaviors;
    /**
     * Tween animations. Engine-ticked, so authors don't have to call
     * `update()` themselves. Time inputs are in SECONDS (engine convention),
     * not milliseconds.
     */
    tween: StemTween;
    /**
     * Finite state machines (XState v5 under the hood). Supports flat,
     * hierarchical, and parallel states with guards, actions, and context.
     */
    fsm: StemFsm;
    /**
     * Behavior trees for NPC AI. Wraps mistreevous; takes a JSON tree
     * definition (or MDSL string) and an agent. Action / condition lookup
     * is by method name on the agent — no eval.
     */
    behaviorTree: StemBehaviorTree;
    /**
     * Spatial queries. Today: octree against scene geometry for capsule /
     * sphere / ray collision detection. Future: AABB index, BVH, etc.
     */
    spatial: StemSpatial;
    /**
     * Subscription wrapper for engine-emitted events (login, orientation,
     * lambda triggers, character motion / state, gameServices auth, …).
     * Returns an idempotent teardown function; capture it and call it from
     * `dispose()` / `onStop()`. Use `onEvent` +
     * `behaviorManager.sendEventToObjectBehaviors` for behavior-to-behavior
     * dispatch — `events.on` is engine-only.
     */
    events: StemEvents;
}
