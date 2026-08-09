import { MathUtils, Object3D } from "three";

import { ComponentDataPool } from "./ComponentDataPool";
import type {
    Lambda,
    LambdaAttributeChangeOptions,
    LambdaAttributeChangeResult,
    LambdaComponentData,
    LambdaOptions,
} from "./Lambda";
import type GameManager from "@stem/editor-oss/behaviors/game/GameManager";
import {deleteRuntimeUserDataValue, setRuntimeUserDataValue} from "@stem/editor-oss/utils/userDataRuntime";

const SCENE_STATIC_USER_DATA_KEY = "_isSceneStatic";
const LAMBDA_REG_COUNT_USER_DATA_KEY = "_lambdaRegCount";

interface PendingOp {
    type: "add" | "remove";
    target: Object3D;
    data?: Record<string, any>;
}

export class LambdaBase implements Lambda {
    readonly id: string;
    readonly uuid: string;
    readonly attributes: Record<string, any>;

    protected _registeredObjects: Map<Object3D, Record<string, any>> = new Map();
    protected _game: GameManager | null = null;
    protected _isApplying: boolean = false;
    protected _pendingOps: PendingOp[] = [];
    private _debugLogged: boolean = false;
    private _processObjectsResumeIndex = 0;
    private _processObjectsIterator: Iterator<[Object3D, Record<string, any>]> | null = null;

    // Track which lambdas have been warned about missing fixedUpdate (to avoid spamming console)
    private static _fixedUpdateWarnings = new Set<string>();

    constructor(id: string, options: LambdaOptions) {
        this.id = id;
        this.uuid = options.uuid || MathUtils.generateUUID();
        this.attributes = options.attributes || {};
    }

    get registeredObjects(): ReadonlyMap<Object3D, Record<string, any>> {
        return this._registeredObjects;
    }

    get entityCount(): number {
        return this._registeredObjects.size;
    }

    // Lifecycle - override in subclass
    init(game: GameManager): void | Promise<void> {
        this._game = game;
    }

    dispose(): void {
        for (const [target, data] of this._registeredObjects) {
            this.releaseRegisteredObject(target, data, false);
        }
        this.resetProcessObjectsCursor();
        this._pendingOps = [];
    }

    apply(deltaTime?: number): void {
        this._isApplying = true;
        try {
            if (import.meta.env.DEV && !this._debugLogged && this._registeredObjects.size > 0) {
                this._debugLogged = true;
                console.log(`[LambdaBase] apply "${this.id}" — objects: ${this._registeredObjects.size}`);
            }
            this.runVariableUpdate(deltaTime);
        } finally {
            this._isApplying = false;
            this._processPendingOps();
        }
    }

    /**
     * Wrapper for fixedUpdate with _isApplying safety.
     * @param fixedDeltaTime
     */
    fixedApply(fixedDeltaTime: number): void {
        this._isApplying = true;
        try {
            if (typeof this.fixedUpdate === "function") {
                this.fixedUpdate(fixedDeltaTime);
            } else if (!LambdaBase._fixedUpdateWarnings.has(this.id)) {
                const configName = this._game?.lambdaManager?.getConfig(this.id)?.name;
                const label = configName ? `"${configName}" (${this.id.slice(0, 8)})` : `"${this.id}"`;
                console.warn(
                    `[Lambda] ${label} does not implement fixedUpdate(). ` +
                    `Skipping fixed-rate runtime update. For fixed-rate logic, implement fixedUpdate().`,
                );
                LambdaBase._fixedUpdateWarnings.add(this.id);
            }
        } finally {
            this._isApplying = false;
            this._processPendingOps();
        }
    }

    /**
     * Override this in subclasses for fixed timestep physics-dependent logic.
     * Called at a consistent rate (e.g., 60Hz) determined by quality settings.
     */
    fixedUpdate?(fixedDeltaTime: number): void;

    // Optimized iteration helper
    protected processObjects(
        deltaTime: number,
        callback: (object: Object3D, data: Record<string, any>, effectiveDeltaTime: number) => void,
        isCritical: boolean = false,
    ): void {
        // If not initialized yet
        if (!this._game || !this._game.lambdaManager) {
            for (const [object, data] of this._registeredObjects) {
                try {
                    callback(object, data, deltaTime);
                } catch (e) {
                    console.error(`[LambdaBase] Error processing object in ${this.id}:`, e);
                }
            }
            return;
        }

        const scheduler = this._game.lambdaManager.scheduler;
        const camera = this._game.camera;

        // Fallback checks
        if (!camera) {
            for (const [object, data] of this._registeredObjects) {
                try {
                    callback(object, data, deltaTime);
                } catch (e) {
                    console.error(`[LambdaBase] Error processing object in ${this.id}:`, e);
                }
            }
            return;
        }

        const deadline = scheduler.frameDeadline ?? Infinity;
        const hasFiniteDeadline = Number.isFinite(deadline);
        const BUDGET_CHECK_INTERVAL = 64;

        if (!hasFiniteDeadline) {
            this.resetProcessObjectsCursor();
            let index = 0;
            for (const [object, data] of this._registeredObjects) {
                this.processObjectEntry(object, data, deltaTime, callback, isCritical, scheduler, camera, index);
                index++;
            }
            return;
        }

        const total = this._registeredObjects.size;
        if (total === 0) {
            this.resetProcessObjectsCursor();
            return;
        }

        let iterator = this._processObjectsIterator;
        let index = this._processObjectsResumeIndex;
        if (!iterator) {
            iterator = this._registeredObjects.entries();
            index = 0;
        }

        let processed = 0;
        while (processed < total) {
            let next = iterator.next();
            if (next.done) {
                iterator = this._registeredObjects.entries();
                index = 0;
                next = iterator.next();
                if (next.done) {
                    break;
                }
            }

            const [object, data] = next.value;
            this.processObjectEntry(object, data, deltaTime, callback, isCritical, scheduler, camera, index);
            processed++;
            index++;
            if ((processed & (BUDGET_CHECK_INTERVAL - 1)) === 0 && performance.now() >= deadline) {
                this._processObjectsIterator = iterator;
                this._processObjectsResumeIndex = index;
                return;
            }
        }

        this.resetProcessObjectsCursor();
    }

    // Override this in subclasses instead of apply()
    update(_deltaTime?: number): void {
        // Subclass should override and iterate this._registeredObjects
    }

    private processObjectEntry(
        object: Object3D,
        data: Record<string, any>,
        deltaTime: number,
        callback: (object: Object3D, data: Record<string, any>, effectiveDeltaTime: number) => void,
        isCritical: boolean,
        scheduler: NonNullable<GameManager["lambdaManager"]>["scheduler"],
        camera: NonNullable<GameManager["camera"]>,
        index: number,
    ): void {
        // Use cached criticality (set at registration time) instead of per-frame Array.find() scans
        const componentCritical = data._isCritical ?? false;
        const effectiveCritical = isCritical || componentCritical;
        const multiplier = scheduler.shouldProcess(object, camera, index, effectiveCritical);

        if (multiplier <= 0) {
            return;
        }

        try {
            callback(object, data, deltaTime * multiplier);

            // Explicitly update matrix since matrixAutoUpdate is disabled
            object.updateMatrix();

            // Sync instanced mesh GPU matrix after position/rotation/scale changes
            if (object.userData.instanceData && this._game?.instancer) {
                this._game.instancer.updateInstancePosition(object);
            }
        } catch (e) {
            console.error(`[LambdaBase] Error processing object in ${this.id}:`, e);
        }
    }

    private runVariableUpdate(deltaTime?: number): void {
        // Fallback: when fixed updates are off and the lambda only implements fixedUpdate
        // (no custom update), call fixedUpdate so the creator's logic still runs.
        const fixedEnabled = this._game?.lambdaManager?.fixedUpdatesEnabled ?? true;
        if (
            !fixedEnabled &&
            typeof this.fixedUpdate === "function" &&
            this.update === LambdaBase.prototype.update
        ) {
            this.fixedUpdate(deltaTime ?? 0);
            return;
        }

        this.update(deltaTime);
    }

    onObjectAdded(_target: Object3D, _componentData: Record<string, any>): void { }

    onObjectRemoved(_target: Object3D): void { }

    onAttributesUpdated(): void {}

    onAttributeChangeRequested(_key: string, _newValue: any, _oldValue: any, _requester: Lambda | null): boolean {
        return true;
    }

    onAttributeChanged(_key: string, _newValue: any, _oldValue: any): void {}

    onEvent(_msg: string, _data: any): void | Promise<void> | Generator { }

    // Component data access (miniplex-style direct access)
    getComponentData(target: Object3D): Record<string, any> | null {
        return this._registeredObjects.get(target) ?? null;
    }

    setComponentData(target: Object3D, key: string, value: any): void {
        const data = this._registeredObjects.get(target);
        if (!data) return;
        const oldValue = data[key];
        if (oldValue === value) return;
        data[key] = value;
        try {
            this.onSet?.(target, key, value, oldValue);
        } catch (error) {
            console.error(`[LambdaBase] Error in onSet for "${this.id}":`, error);
        }
    }

    onSet?(target: Object3D, key: string, newValue: any, oldValue: any): void;

    requestAttributeChange(
        key: string,
        value: any,
        options?: LambdaAttributeChangeOptions,
    ): Promise<LambdaAttributeChangeResult> | LambdaAttributeChangeResult {
        if (!this._game?.lambdaManager) {
            return {
                accepted: false,
                key,
                value: this.attributes[key],
                previousValue: this.attributes[key],
            };
        }

        return this._game.lambdaManager.requestAttributeChange(this, key, value, null, options);
    }

    /**
     * Checks if this object has isCritical set on its lambda component.
     * Fallback chain: component.isCritical → lambda config isCritical → false
     * @param object
     */
    protected getComponentCriticality(object: Object3D): boolean {
        const components = object.userData?.lambdaComponents as LambdaComponentData[] | undefined;
        if (!components) return false;

        // Find the component for this lambda instance
        const component = components.find(c => c.instanceId === this.uuid);
        if (component?.isCritical !== undefined) {
            return component.isCritical;
        }

        // Fallback to lambda config default (if available via game manager)
        const config = this._game?.lambdaManager?.getConfig?.(this.id);
        return config?.isCritical ?? false;
    }

    private getLambdaRegistrationCount(target: Object3D): number {
        const rawCount = target.userData[LAMBDA_REG_COUNT_USER_DATA_KEY];
        return typeof rawCount === "number" && Number.isFinite(rawCount) ? Math.max(0, rawCount) : 0;
    }

    private setLambdaRegistrationCount(target: Object3D, count: number): void {
        if (count <= 0) {
            deleteRuntimeUserDataValue(target, LAMBDA_REG_COUNT_USER_DATA_KEY);
            return;
        }
        setRuntimeUserDataValue(target, LAMBDA_REG_COUNT_USER_DATA_KEY, count);
    }

    // Internal: register with command queue safety
    _registerObject(target: Object3D, componentData: Record<string, any>): void {
        if (this._isApplying) {
            this._pendingOps.push({ type: "add", target, data: componentData });
            return;
        }
        const previousData = this._registeredObjects.get(target);
        const wasRegistered = previousData !== undefined;
        const previousRegCount = this.getLambdaRegistrationCount(target);
        const previousMatrixAutoUpdate = target.matrixAutoUpdate;
        const previousMatrixWorldAutoUpdate = target.matrixWorldAutoUpdate;
        const hadSceneStaticMarker = Object.prototype.hasOwnProperty.call(target.userData, SCENE_STATIC_USER_DATA_KEY);
        const previousSceneStaticValue = target.userData[SCENE_STATIC_USER_DATA_KEY];

        // Reclassify static objects: re-enable matrix updates when a lambda is attached
        if (target.userData[SCENE_STATIC_USER_DATA_KEY]) {
            target.matrixWorldAutoUpdate = true;
            deleteRuntimeUserDataValue(target, SCENE_STATIC_USER_DATA_KEY);
        }
        // Cache criticality at registration to avoid per-frame Array.find() scans
        componentData._isCritical = this.getComponentCriticality(target);
        // Disable auto matrix recalculation — we call updateMatrix() explicitly after transforms change
        // Use ref count so matrixAutoUpdate is only restored when ALL lambdas deregister
        if (!wasRegistered) {
            this.setLambdaRegistrationCount(target, this.getLambdaRegistrationCount(target) + 1);
            target.matrixAutoUpdate = false;
        }
        this._registeredObjects.set(target, componentData);
        try {
            this.onObjectAdded(target, componentData);
        } catch (error) {
            if (wasRegistered) {
                this._registeredObjects.set(target, previousData!);
            } else {
                this._registeredObjects.delete(target);
                this.setLambdaRegistrationCount(target, previousRegCount);
                target.matrixAutoUpdate = previousMatrixAutoUpdate;
            }
            target.matrixWorldAutoUpdate = previousMatrixWorldAutoUpdate;
            if (hadSceneStaticMarker) {
                setRuntimeUserDataValue(target, SCENE_STATIC_USER_DATA_KEY, previousSceneStaticValue);
            } else {
                deleteRuntimeUserDataValue(target, SCENE_STATIC_USER_DATA_KEY);
            }
            throw error;
        }
        if (wasRegistered && previousData !== componentData) {
            ComponentDataPool.release(this.id, previousData!);
        }
        if (!wasRegistered) {
            this.resetProcessObjectsCursor();
        }
    }

    // Internal: deregister with command queue safety
    _deregisterObject(target: Object3D): void {
        if (this._isApplying) {
            this._pendingOps.push({ type: "remove", target });
            return;
        }
        const data = this._registeredObjects.get(target);
        if (data) {
            this.releaseRegisteredObject(target, data, true);
        }
    }

    private releaseRegisteredObject(target: Object3D, data: Record<string, any>, notifyRemoved: boolean): void {
        ComponentDataPool.release(this.id, data);
        this._registeredObjects.delete(target);
        this.resetProcessObjectsCursor();
        // Only restore matrixAutoUpdate when no lambdas manage this object
        const regCount = Math.max(0, this.getLambdaRegistrationCount(target) - 1);
        this.setLambdaRegistrationCount(target, regCount);
        if (regCount === 0) {
            target.matrixAutoUpdate = true;
        }
        if (notifyRemoved) {
            this.onObjectRemoved(target);
        }
    }

    // Process pending operations after apply() completes
    _processPendingOps(): void {
        if (this._pendingOps.length === 0) return;
        const ops = this._pendingOps;
        this._pendingOps = [];
        for (const op of ops) {
            if (op.type === "add") {
                this._registerObject(op.target, op.data!);
            } else {
                this._deregisterObject(op.target);
            }
        }
    }

    private resetProcessObjectsCursor(): void {
        this._processObjectsResumeIndex = 0;
        this._processObjectsIterator = null;
    }
}
