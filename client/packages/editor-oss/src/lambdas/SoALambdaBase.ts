import type { Object3D } from "three";

import type { LambdaOptions } from "./Lambda";
import { LambdaBase } from "./LambdaBase";
import { ComponentStore, type ComponentFieldSchema } from "@stem/editor-oss/scheduler/data/ComponentStore";

type ComponentTypedArray = Float32Array | Int32Array | Uint8Array;

/**
 * SoA-aware lambda base class. Stores component data in contiguous
 * TypedArrays via ComponentStore for cache-friendly iteration,
 * while keeping the Map<Object3D, Record> in sync for backward compat
 * (getComponentData, setComponentData, onObjectAdded, etc.).
 *
 * Subclasses override `updateSoA(dt)` and iterate TypedArrays directly
 * using `this.store` and `this.store.count`.
 */
export abstract class SoALambdaBase extends LambdaBase {
    protected store: ComponentStore;
    private _soaSchema: ComponentFieldSchema[];
    private syncFieldArraysScratch: Array<ComponentTypedArray | undefined> = [];

    /** Per-entity visibility mask built once per frame. 0 = skip, 1-3 = throttle multiplier. */
    protected _visibilityMask: Uint8Array | null = null;

    constructor(id: string, options: LambdaOptions, schema: ComponentFieldSchema[]) {
        super(id, options);
        this._soaSchema = schema;
        this.store = new ComponentStore(schema);
    }

    // Override _registerObject to dual-write into ComponentStore
    _registerObject(target: Object3D, componentData: Record<string, any>): void {
        // Let LambdaBase handle Map write + matrixAutoUpdate + criticality caching
        super._registerObject(target, componentData);

        // Mirror into SoA store using object uuid as entity key
        if (!this.store.hasEntity(target.uuid)) {
            this.store.addEntity(target.uuid, target, componentData);
        } else {
            this.store.setEntityData(target.uuid, componentData);
            this.syncComponentDataToStore(target.uuid, componentData);
        }
    }

    // Override _deregisterObject to dual-remove from ComponentStore
    _deregisterObject(target: Object3D): void {
        this.store.removeEntity(target.uuid);
        super._deregisterObject(target);
    }

    // Override setComponentData to keep SoA in sync
    setComponentData(target: Object3D, key: string, value: any): void {
        super.setComponentData(target, key, value);
        if (typeof value === "number") {
            this.store.setFieldValue(target.uuid, key, value);
        }
    }

    /**
     * Override update() to build visibility mask before SoA iteration.
     * Subclasses no longer need to override update() — just implement updateSoA().
     * @param deltaTime
     */
    update(deltaTime: number = 0.016): void {
        this.buildVisibilityMask();
        this.updateSoA(deltaTime);
    }

    /**
     * Pre-pass: build per-entity visibility mask using LambdaScheduler.shouldProcess().
     * Mask values: 0 = skip this frame, 1-3 = process with dt multiplier.
     * When scheduler/camera unavailable, mask is null (subclasses treat as "process all").
     */
    private buildVisibilityMask(): void {
        const scheduler = this._game?.lambdaManager?.scheduler;
        const camera = this._game?.camera;
        if (!scheduler || !camera) { this._visibilityMask = null; return; }

        const count = this.store.count;
        if (count === 0) { this._visibilityMask = null; return; }

        if (!this._visibilityMask || this._visibilityMask.length < count) {
            this._visibilityMask = new Uint8Array(Math.max(count, 64));
        }
        const objects = this.store.getObjectRefs();
        for (let i = 0; i < count; i++) {
            const obj = objects[i];
            if (!obj) { this._visibilityMask[i] = 0; continue; }
            const critical = obj.userData?._isCritical ?? false;
            this._visibilityMask[i] = scheduler.shouldProcess(obj, camera, i, critical);
        }
    }

    dispose(): void {
        this._visibilityMask = null;
        this.syncFieldArraysScratch.length = 0;
        this.store.dispose();
        super.dispose();
    }

    /**
     * Subclasses implement this to iterate SoA TypedArrays directly.
     * Called by update() with the effective delta time.
     */
    protected abstract updateSoA(deltaTime: number): void;

    private syncComponentDataToStore(uuid: string, componentData: Record<string, any>): void {
        for (const field of this._soaSchema) {
            const value = componentData[field.name];
            this.store.setFieldValue(uuid, field.name, typeof value === "number" ? value : field.default ?? 0);
        }
    }

    /**
     * Syncs SoA field values back to the Map records after SoA iteration.
     * Call this at the end of updateSoA() for fields that external code
     * reads via getComponentData (e.g., velocity values modified by drag).
     * @param fields
     */
    protected syncSoAToMap(fields: readonly string[]): void {
        const count = this.store.count;
        const arrays = this.syncFieldArraysScratch;
        arrays.length = fields.length;
        for (let f = 0; f < fields.length; f++) {
            arrays[f] = this.store.getField(fields[f]!);
        }

        const dataRefs = this.store.getDataRefs();
        for (let i = 0; i < count; i++) {
            const data = dataRefs[i];
            if (!data) continue;
            for (let f = 0; f < fields.length; f++) {
                const arr = arrays[f];
                if (arr) data[fields[f]!] = arr[i]!;
            }
        }
    }
}
