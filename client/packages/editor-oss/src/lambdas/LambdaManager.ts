import { Object3D } from "three";

import { ComponentDataPool } from "./ComponentDataPool";
import type {
    Lambda,
    LambdaAttributeChangeOptions,
    LambdaAttributeChangeResult,
    LambdaConfig,
    LambdaConstructor,
    LambdaOptions,
} from "./Lambda";
import { unwrapLambda } from "./Lambda";
import { LambdaBase } from "./LambdaBase";
import { lambdaProfiler } from "@stem/editor-oss/scheduler/SystemProfiler";
import type { LambdaQueryDescriptor } from "./LambdaQueryRegistry";
import { LambdaQueryRegistry } from "./LambdaQueryRegistry";
import { LambdaScheduler } from "./LambdaScheduler";
import type GameManager from "@stem/editor-oss/behaviors/game/GameManager";
import type { FrameContext } from "@stem/editor-oss/scheduler/types";
import FusedPhysicsLambda, { FUSABLE_LAMBDA_IDS, FUSED_PHYSICS_ID } from "./packs/fusedPhysics/FusedPhysicsLambda";

const isPromiseLike = <T = unknown>(value: unknown): value is PromiseLike<T> =>
    !!value &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as {then?: unknown}).then === "function";

interface AttributeChangeRequest {
    target: Lambda;
    key: string;
    value: any;
    requester: Lambda | null;
    resolve: (result: LambdaAttributeChangeResult) => void;
}

interface LambdaConfigMetadata {
    hasDependencyMetadata: boolean;
    readComponents: readonly string[];
    writeComponents: readonly string[];
    writeComponentSet: ReadonlySet<string>;
    defaultComponentData: Record<string, any>;
}

interface LambdaRegistrationSnapshot {
    target: Object3D;
    data: Record<string, any>;
}

interface LambdaInstanceSnapshot {
    uuid: string;
    attributes: Record<string, any>;
    registrations: LambdaRegistrationSnapshot[];
}

type LambdaInstanceCreationOptions = LambdaOptions & {
    yieldToFrame?: () => Promise<void>;
};

const EMPTY_COMPONENT_LIST: readonly string[] = [];
const EMPTY_COMPONENT_SET: ReadonlySet<string> = new Set();
const EMPTY_COMPONENT_DATA: Record<string, any> = {};

export class LambdaManager {
    private lambdaClasses: Map<string, LambdaConstructor> = new Map();
    private lambdaConfigs: Map<string, LambdaConfig> = new Map();
    private lambdaConfigMetadata: Map<string, LambdaConfigMetadata> = new Map();
    private instances: Map<string, Lambda> = new Map();
    private cachedInstanceList: Lambda[] | null = null;
    private cachedFixedUpdateInstanceList: Lambda[] | null = null;
    private instancesByType: Map<string, Set<Lambda>> = new Map();
    // Reverse lookup: Object3D -> Set of instance IDs it belongs to
    private objectLambdaMap: Map<Object3D, Set<string>> = new Map();
    private game: GameManager;
    public scheduler: LambdaScheduler;
    /** Cached dependency waves — invalidated on instance add/remove */
    private _cachedWaves: Lambda[][] | null = null;
    /** True while EngineRuntime supplies authoritative fixed stages. */
    public fixedUpdatesEnabled: boolean = false;
    private queryRegistry = new LambdaQueryRegistry();
    /** Singleton fused physics instance (created on demand) */
    private fusedPhysicsInstance: FusedPhysicsLambda | null = null;
    /** Tracks objects migrated to fused instance: "originalInstanceId:targetUUID" → fusedInstanceId */
    private fusedObjectRedirects: Map<string, string> = new Map();
    private attributeChangeQueue: AttributeChangeRequest[] = [];
    private variableUpdateResumeWaveIndex = 0;
    private variableUpdateResumeInstanceIndex = 0;
    private preparedSchedulerFrameCount = -1;
    private scratchObjectArchetypeTypeIds: string[] = [];

    constructor(game: GameManager) {
        this.game = game;
        this.scheduler = new LambdaScheduler();
    }

    // --- Type registration (during scene load) ---

    registerLambdaClass(id: string, config: LambdaConfig, cls: LambdaConstructor): void {
        if (this.lambdaClasses.has(id)) {
            console.error(`[LambdaManager] Lambda type "${id}" already registered`);
            return;
        }
        console.log(`[LambdaManager] Registering lambda class: "${id}"`);
        this.lambdaClasses.set(id, cls);
        this.lambdaConfigs.set(id, config);
        this.cacheLambdaConfigMetadata(id, config);
    }

    unregisterLambdaClass(id: string): void {
        this.lambdaClasses.delete(id);
        this.lambdaConfigs.delete(id);
        this.lambdaConfigMetadata.delete(id);
    }

    hasLambdaClass(id: string): boolean {
        return this.lambdaClasses.has(id);
    }

    // --- Instance lifecycle ---

    async createInstance(lambdaId: string, options?: LambdaInstanceCreationOptions): Promise<Lambda | null> {
        const cls = this.lambdaClasses.get(lambdaId);
        if (!cls) {
            console.error(`[LambdaManager] Lambda class "${lambdaId}" not found`);
            return null;
        }

        const {yieldToFrame, ...lambdaOptions} = options ?? {};
        const maybeYieldToFrame = async (): Promise<void> => {
            if (yieldToFrame) {
                await yieldToFrame();
            }
        };

        console.log(`[LambdaManager] Creating instance of "${lambdaId}" (uuid: will be assigned)`);
        await maybeYieldToFrame();
        const instance = new cls(lambdaId, lambdaOptions);

        try {
            await maybeYieldToFrame();
            await Promise.resolve(instance.init(this.game));
            await maybeYieldToFrame();
            this.instances.set(instance.uuid, instance);
            this.indexInstance(instance);
            this.invalidateWaves();
            console.log(`[LambdaManager] Instance created: "${lambdaId}" (uuid: ${instance.uuid})`);
            return instance;
        } catch (error) {
            console.error(`[LambdaManager] Failed to init lambda "${lambdaId}":`, error);
            try {
                instance.dispose();
            } catch {
                // swallow disposal errors during cleanup
            }
            return null;
        }
    }

    destroyInstance(instanceId: string): void {
        const instance = this.instances.get(instanceId);
        if (!instance) return;

        while (instance.registeredObjects.size > 0) {
            const obj = instance.registeredObjects.keys().next().value;
            if (!obj) break;
            this.deregisterObject(instanceId, obj);
        }

        try {
            instance.dispose();
        } catch (error) {
            console.error(`[LambdaManager] Error disposing lambda "${instanceId}":`, error);
        }
        this.instances.delete(instanceId);
        this.unindexInstance(instance);
        this.invalidateWaves();
    }

    destroyInstancesByType(lambdaId: string): void {
        for (const instance of this.getInstancesByType(lambdaId)) {
            this.destroyInstance(instance.uuid);
        }
    }

    getInstance(instanceId: string): Lambda | null {
        return this.instances.get(instanceId) ?? null;
    }

    getInstancesByType(lambdaId: string): Lambda[] {
        const bucket = this.instancesByType.get(lambdaId);
        return bucket ? Array.from(bucket) : [];
    }

    getAllInstances(): Lambda[] {
        return [...this.getInstanceList()];
    }

    forEachRegisteredObject(callback: (object: Object3D) => void): void {
        for (const [object, instanceIds] of this.objectLambdaMap) {
            if (instanceIds.size > 0) {
                callback(object);
            }
        }
    }

    getConfig(lambdaId: string): LambdaConfig | null {
        return this.lambdaConfigs.get(lambdaId) ?? null;
    }

    getAllConfigs(): LambdaConfig[] {
        return Array.from(this.lambdaConfigs.values());
    }

    updateConfig(lambdaId: string, config: LambdaConfig): void {
        this.lambdaConfigs.set(lambdaId, config);
        this.cacheLambdaConfigMetadata(lambdaId, config);
        this.invalidateWaves();
    }

    requestAttributeChange(
        target: Lambda,
        key: string,
        value: any,
        requester: Lambda | null,
        options?: LambdaAttributeChangeOptions,
    ): Promise<LambdaAttributeChangeResult> | LambdaAttributeChangeResult {
        const actualTarget = unwrapLambda(target);
        const actualRequester = unwrapLambda(requester);

        if (!actualTarget) {
            return {
                accepted: false,
                key,
                value: undefined,
                previousValue: undefined,
            };
        }

        if (options?.sync) {
            return this.processAttributeChange(actualTarget, key, value, actualRequester);
        }

        return new Promise<LambdaAttributeChangeResult>(resolve => {
            this.attributeChangeQueue.push({
                target: actualTarget,
                key,
                value,
                requester: actualRequester,
                resolve,
            });
        });
    }

    async reloadLambdaClass(id: string, config: LambdaConfig, cls: LambdaConstructor): Promise<void> {
        const existingInstances = this.getInstancesByType(id);
        const snapshots: LambdaInstanceSnapshot[] = [];

        for (let i = 0; i < existingInstances.length; i++) {
            snapshots.push(this.captureReloadSnapshot(existingInstances[i]!));
        }

        for (let i = 0; i < existingInstances.length; i++) {
            this.destroyInstance(existingInstances[i]!.uuid);
        }

        this.lambdaClasses.set(id, cls);
        this.lambdaConfigs.set(id, config);
        this.cacheLambdaConfigMetadata(id, config);
        this.invalidateWaves();

        for (let i = 0; i < snapshots.length; i++) {
            const snapshot = snapshots[i]!;
            const instance = await this.createInstance(id, {
                uuid: snapshot.uuid,
                attributes: {...snapshot.attributes},
            });
            if (!instance) continue;

            for (let registrationIndex = 0; registrationIndex < snapshot.registrations.length; registrationIndex++) {
                const registration = snapshot.registrations[registrationIndex]!;
                this.registerObject(
                    instance.uuid,
                    registration.target,
                    this.cloneComponentDataForReload(registration.data),
                );
            }
        }
    }

    // --- Object registration (called from behaviors or editor) ---

    registerObject(instanceId: string, target: Object3D, componentData?: Record<string, any>): boolean {
        const instance = this.instances.get(instanceId);
        if (!instance) {
            console.error(`[LambdaManager] Instance "${instanceId}" not found`);
            return false;
        }

        const defaults = this.getDefaultComponentData(instance.id);
        const usedPooledData = componentData === undefined;
        const data = componentData ?? ComponentDataPool.acquire(instance.id, defaults);

        try {
            (instance as LambdaBase)._registerObject(target, data);
        } catch (error) {
            console.error(`[LambdaManager] Error registering object with "${instanceId}":`, error);
            if (usedPooledData) {
                ComponentDataPool.release(instance.id, data);
            }
            return false;
        }

        // Update reverse lookup
        if (!this.objectLambdaMap.has(target)) {
            this.objectLambdaMap.set(target, new Set());
        }
        this.objectLambdaMap.get(target)!.add(instanceId);
        this.refreshObjectArchetype(target);

        // Auto-fuse: if object now has 2+ physics lambdas, migrate to fused instance
        if (FUSABLE_LAMBDA_IDS.has(instance.id)) {
            this.tryFuseObject(target);
        }

        return true;
    }

    deregisterObject(instanceId: string, target: Object3D): void {
        // Check if this object was migrated to the fused instance
        const redirectKey = `${instanceId}:${target.uuid}`;
        const fusedId = this.fusedObjectRedirects.get(redirectKey);
        if (fusedId) {
            const fused = this.instances.get(fusedId);
            if (fused) {
                try {
                    (fused as LambdaBase)._deregisterObject(target);
                } catch (error) {
                    console.error(`[LambdaManager] Error deregistering from fused "${fusedId}":`, error);
                }
                this.removeObjectLambdaMapping(target, fusedId);
            }
            this.fusedObjectRedirects.delete(redirectKey);
            this.refreshObjectArchetype(target);
            return;
        }

        const instance = this.instances.get(instanceId);
        if (!instance) return;

        try {
            (instance as LambdaBase)._deregisterObject(target);
        } catch (error) {
            console.error(`[LambdaManager] Error deregistering from "${instanceId}":`, error);
        }
        this.removeObjectLambdaMapping(target, instanceId);
        this.refreshObjectArchetype(target);
    }

    deregisterObjectFromAll(target: Object3D): void {
        const instanceIds = this.objectLambdaMap.get(target);
        if (!instanceIds) return;

        while (instanceIds.size > 0) {
            const id = instanceIds.values().next().value;
            if (!id) break;
            this.deregisterObject(id, target);
        }
        this.objectLambdaMap.delete(target);
        this.queryRegistry.removeObject(target);
    }

    // --- Query ---

    getObjectLambdas(target: Object3D): Lambda[] {
        const ids = this.objectLambdaMap.get(target);
        if (!ids) return [];
        const lambdas: Lambda[] = [];
        for (const id of ids) {
            const instance = this.instances.get(id);
            if (instance) {
                lambdas.push(instance);
            }
        }
        return lambdas;
    }

    /**
     * Cross-lambda query: find objects matching a combination of lambda types
     * @param descriptor
     */
    query(descriptor: LambdaQueryDescriptor): Object3D[] {
        return this.queryRegistry.query(descriptor);
    }

    /**
     * Sets component data on the effective instance for a target object.
     * Handles fusion redirects: if the object was migrated to the fused instance,
     * the data is forwarded there instead of the original instance.
     * @param instanceId
     * @param target
     * @param key
     * @param value
     */
    setObjectComponentData(instanceId: string, target: Object3D, key: string, value: any): void {
        const redirectKey = `${instanceId}:${target.uuid}`;
        const fusedId = this.fusedObjectRedirects.get(redirectKey);
        const effectiveInstance = fusedId
            ? this.instances.get(fusedId)
            : this.instances.get(instanceId);
        effectiveInstance?.setComponentData(target, key, value);
    }

    private processAttributeChange(
        target: Lambda,
        key: string,
        value: any,
        requester: Lambda | null,
    ): LambdaAttributeChangeResult {
        const oldValue = target.attributes[key];
        const accepted = target.onAttributeChangeRequested?.(key, value, oldValue, requester) !== false;

        if (accepted) {
            target.attributes[key] = value;
            this.updateLambdaInstanceAttributes(target);
            target.onAttributeChanged?.(key, value, oldValue);
            try {
                target.onAttributesUpdated?.();
            } catch (error) {
                console.error(`[LambdaManager] Error during lambda onAttributesUpdated for "${target.id}":`, error);
            }
        }

        return {accepted, key, value: accepted ? value : oldValue, previousValue: oldValue};
    }

    private processAttributeChangeQueue(): void {
        for (let i = 0; i < this.attributeChangeQueue.length; i++) {
            const req = this.attributeChangeQueue[i]!;
            req.resolve(this.processAttributeChange(req.target, req.key, req.value, req.requester));
        }
        this.attributeChangeQueue.length = 0;
    }

    private updateLambdaInstanceAttributes(target: Lambda): void {
        const userData = this.game.scene?.userData as
            | {
                  lambdaInstances?: Array<{instanceId: string; attributes: Record<string, any>}>;
                  projectLambdaInstances?: Array<{instanceId: string; attributes: Record<string, any>}>;
              }
            | undefined;
        if (!userData) return;

        const nextAttributes = {...target.attributes};
        const updateEntries = (entries?: Array<{instanceId: string; attributes: Record<string, any>}>) => {
            const entry = entries?.find(item => item.instanceId === target.uuid);
            if (entry) {
                entry.attributes = nextAttributes;
            }
        };

        updateEntries(userData.lambdaInstances);
        updateEntries(userData.projectLambdaInstances);
    }

    // --- Send events to lambdas associated with an object ---

    sendEventToObjectLambdas(target: Object3D, event: string, eventData?: any): void {
        const lambdas = this.getObjectLambdas(target);
        for (const lambda of lambdas) {
            try {
                const result: any = lambda.onEvent(event, eventData);
                if (isPromiseLike(result)) {
                    void Promise.resolve(result).catch(error => {
                        console.error(`[LambdaManager] Error during onEvent for lambda "${lambda.id}":`, error);
                    });
                }
            } catch (error) {
                console.error(`[LambdaManager] Error during onEvent for lambda "${lambda.id}":`, error);
            }
        }
    }

    // --- Per-frame update ---

    /**
     * Prepares shared scheduling/culling state before authoritative fixed
     * stages. The following variable update reuses this preparation.
     */
    beginSimulationFrame(context: FrameContext): void {
        this.fixedUpdatesEnabled = context.fixedUpdatesEnabled;
        this.scheduler.beginFrame(context);
        this.preparedSchedulerFrameCount = context.frameCount;
    }

    /**
     * Call apply() on every live instance, organized by dependency waves
     * @param deltaTime
     * @param context
     */
    update(deltaTime: number, context?: FrameContext): void {
        if (typeof context?.fixedUpdatesEnabled === "boolean") {
            this.fixedUpdatesEnabled = context.fixedUpdatesEnabled;
        }

        if (this.instances.size === 0) {
            this.processAttributeChangeQueue();
            return;
        }

        if (!context || this.preparedSchedulerFrameCount !== context.frameCount) {
            this.scheduler.beginFrame(context);
        }
        this.preparedSchedulerFrameCount = -1;
        const waves = this.buildWaves();
        const deadline = context?.frameDeadline ?? Infinity;
        const hasFiniteDeadline = Number.isFinite(deadline);
        const profilingEnabled = lambdaProfiler.isEnabled();
        if (!hasFiniteDeadline) {
            this.variableUpdateResumeWaveIndex = 0;
            this.variableUpdateResumeInstanceIndex = 0;
            for (const wave of waves) {
                for (const instance of wave) {
                    this.applyVariableInstance(instance, deltaTime, profilingEnabled);
                }
            }
            this.processAttributeChangeQueue();
            return;
        }

        let processed = 0;
        const total = this.instances.size;
        let waveIndex = this.normalizeWaveIndex(waves, this.variableUpdateResumeWaveIndex);
        let instanceIndex = this.normalizeInstanceIndex(waves, waveIndex, this.variableUpdateResumeInstanceIndex);

        while (processed < total) {
            const wave = waves[waveIndex];
            if (!wave || wave.length === 0) {
                waveIndex = this.nextWaveIndex(waves, waveIndex);
                instanceIndex = 0;
                continue;
            }

            const instance = wave[instanceIndex];
            if (instance) {
                this.applyVariableInstance(instance, deltaTime, profilingEnabled);
                processed++;
            }

            instanceIndex++;
            if (instanceIndex >= wave.length) {
                waveIndex = this.nextWaveIndex(waves, waveIndex);
                instanceIndex = 0;
            }

            if ((processed & 7) === 0 && performance.now() >= deadline) {
                this.variableUpdateResumeWaveIndex = waveIndex;
                this.variableUpdateResumeInstanceIndex = instanceIndex;
                this.processAttributeChangeQueue();
                return;
            }
        }
        this.variableUpdateResumeWaveIndex = 0;
        this.variableUpdateResumeInstanceIndex = 0;
        this.processAttributeChangeQueue();
    }

    /**
     * Fixed-timestep update for lambdas that implement fixedUpdate().
     * Kept for legacy runtime callers and lambda API compatibility.
     * @param fixedDeltaTime
     * @param context
     */
    fixedUpdate(fixedDeltaTime: number, _context?: FrameContext): void {
        if (this.instances.size === 0) {
            this.processAttributeChangeQueue();
            return;
        }
        const profilingEnabled = lambdaProfiler.isEnabled();
        const instances = this.getFixedUpdateInstanceList();
        if (instances.length === 0) {
            this.processAttributeChangeQueue();
            return;
        }

        // Fixed simulation work is never deadline-throttled or resumed from a
        // cursor. Deferring one lambda to a later fixed step violates
        // deterministic exactly-once semantics and dependency ordering.
        for (let index = 0; index < instances.length; index++) {
            const instance = instances[index]!;
            this.applyFixedInstance(instance, fixedDeltaTime, profilingEnabled);
        }
        this.processAttributeChangeQueue();
    }

    private applyVariableInstance(instance: Lambda, deltaTime: number, profilingEnabled: boolean): void {
        if (profilingEnabled) {
            lambdaProfiler.beginMeasure(instance.uuid);
        }
        try {
            instance.apply(deltaTime);
        } catch (error) {
            console.error(`[LambdaManager] Error in apply for lambda "${instance.id}":`, error);
        }
        if (profilingEnabled) {
            lambdaProfiler.endMeasure(instance.uuid, instance.id, instance.entityCount);
        }
    }

    private applyFixedInstance(instance: Lambda, fixedDeltaTime: number, profilingEnabled: boolean): void {
        if (profilingEnabled) {
            lambdaProfiler.beginMeasure(instance.uuid);
        }
        try {
            (instance as LambdaBase).fixedApply(fixedDeltaTime);
        } catch (error) {
            console.error(`[LambdaManager] Error in fixedUpdate for lambda "${instance.id}":`, error);
        }
        if (profilingEnabled) {
            lambdaProfiler.endMeasure(instance.uuid, instance.id, instance.entityCount);
        }
    }

    private normalizeWaveIndex(waves: Lambda[][], waveIndex: number): number {
        if (waves.length === 0 || !Number.isFinite(waveIndex)) {
            return 0;
        }
        return Math.min(Math.max(0, Math.trunc(waveIndex)), waves.length - 1);
    }

    private normalizeInstanceIndex(waves: Lambda[][], waveIndex: number, instanceIndex: number): number {
        const wave = waves[waveIndex];
        if (!wave || wave.length === 0 || !Number.isFinite(instanceIndex)) {
            return 0;
        }
        return Math.min(Math.max(0, Math.trunc(instanceIndex)), wave.length - 1);
    }

    private nextWaveIndex(waves: Lambda[][], waveIndex: number): number {
        return waves.length > 0 ? (waveIndex + 1) % waves.length : 0;
    }

    /**
     * Read-only view of the current dependency waves, for debugging / inspector UIs.
     * Do not mutate the returned arrays.
     * @returns Waves in execution order — instances within wave[i] run before wave[i+1].
     */
    getWaves(): readonly Lambda[][] {
        return this.buildWaves();
    }

    /**
     * Builds parallel execution waves from lambda instance read/write declarations.
     * Lambdas within the same wave have no overlapping write→read dependencies.
     * Falls back to single wave when no read/write metadata is declared.
     */
    private buildWaves(): Lambda[][] {
        if (this._cachedWaves !== null) return this._cachedWaves;
        const all = this.getInstanceList() as Lambda[];
        let hasDependencyMetadata = false;
        for (let instanceIndex = 0; instanceIndex < all.length; instanceIndex++) {
            const instance = all[instanceIndex]!;
            if (!hasDependencyMetadata && this.hasDependencyMetadata(instance.id)) {
                hasDependencyMetadata = true;
            }
        }
        if (all.length <= 1) {
            this._cachedWaves = [all];
            return this._cachedWaves;
        }
        if (!hasDependencyMetadata) {
            this._cachedWaves = [all];
            return this._cachedWaves;
        }

        // Build write/read indexes between lambda instances.
        const componentWriters = new Map<string, Lambda[]>();
        const componentReaders = new Map<string, Lambda[]>();
        const uuidToInstance = new Map<string, Lambda>();
        for (const inst of all) {
            const metadata = this.lambdaConfigMetadata.get(inst.id);
            uuidToInstance.set(inst.uuid, inst);
            const writes = metadata?.writeComponents ?? EMPTY_COMPONENT_LIST;
            const reads = metadata?.readComponents ?? EMPTY_COMPONENT_LIST;

            for (const component of writes) {
                let writers = componentWriters.get(component);
                if (!writers) {
                    writers = [];
                    componentWriters.set(component, writers);
                }
                writers.push(inst);
            }
            for (const component of reads) {
                let readers = componentReaders.get(component);
                if (!readers) {
                    readers = [];
                    componentReaders.set(component, readers);
                }
                readers.push(inst);
            }
        }

        // Compute in-degree: edge A→B if A writes something B reads
        const adj = new Map<string, Set<string>>();
        const inDegree = new Map<string, number>();
        for (const inst of all) {
            adj.set(inst.uuid, new Set());
            inDegree.set(inst.uuid, 0);
        }

        const addEdge = (from: string, to: string): void => {
            const edges = adj.get(from)!;
            if (edges.has(to)) return;
            edges.add(to);
            inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
        };

        for (const [component, readers] of componentReaders) {
            const writers = componentWriters.get(component);
            if (!writers) continue;
            for (const writer of writers) {
                for (const reader of readers) {
                    if (writer.uuid === reader.uuid) continue;
                    // Edge writer→reader, but skip if the reader also writes the
                    // same component. These are peers resolved by registration order.
                    const readerWrites = this.lambdaConfigMetadata.get(reader.id)?.writeComponentSet
                        ?? EMPTY_COMPONENT_SET;
                    if (readerWrites.has(component)) continue;
                    addEdge(writer.uuid, reader.uuid);
                }
            }
        }

        // BFS by layer
        const waves: Lambda[][] = [];
        const scheduledIds = new Set<string>();
        let frontier = all.filter(i => inDegree.get(i.uuid) === 0);
        while (frontier.length > 0) {
            waves.push(frontier);
            const next: Lambda[] = [];
            for (const inst of frontier) {
                scheduledIds.add(inst.uuid);
                for (const nid of adj.get(inst.uuid) ?? []) {
                    const deg = inDegree.get(nid)! - 1;
                    inDegree.set(nid, deg);
                    if (deg === 0) next.push(uuidToInstance.get(nid)!);
                }
            }
            frontier = next;
        }

        // Detect unscheduled lambdas (stuck in dependency cycle)
        if (scheduledIds.size < all.length) {
            const missing: Lambda[] = [];
            for (const instance of all) {
                if (!scheduledIds.has(instance.uuid)) {
                    missing.push(instance);
                }
            }
            console.warn(
                `[LambdaManager] ${missing.length} lambda(s) stuck in dependency cycle, appending to last wave:`,
                missing.map(i => i.id).join(", "),
            );
            // Append stuck lambdas to a final wave so they still execute
            waves.push(missing);
        }

        this._cachedWaves = waves;
        return waves;
    }

    private hasDependencyMetadata(lambdaId: string): boolean {
        return this.lambdaConfigMetadata.get(lambdaId)?.hasDependencyMetadata === true;
    }

    // --- Cleanup ---

    /** Destroy all instances but keep registered lambda classes/configs for reuse between play cycles */
    dispose(): void {
        while (this.instances.size > 0) {
            const id = this.instances.keys().next().value;
            if (!id) break;
            this.destroyInstance(id);
        }
        this._cachedWaves = null;
        this.cachedInstanceList = null;
        this.fusedPhysicsInstance = null;
        this.fusedObjectRedirects.clear();
        this.instancesByType.clear();
        this.objectLambdaMap.clear();
        this.queryRegistry.clearArchetypes();
        this.resetUpdateResumeCursors();
        this.scheduler.dispose();
        ComponentDataPool.dispose();
        lambdaProfiler.dispose();
    }

    /** Full teardown - clears everything including registered classes */
    fullDispose(): void {
        this.dispose();
        this.lambdaClasses.clear();
        this.lambdaConfigs.clear();
        this.lambdaConfigMetadata.clear();
        this.queryRegistry.dispose();
    }

    /** Access profiler for debugging — call lambdaManager.profiler to inspect */
    get profiler() {
        return lambdaProfiler;
    }

    // --- Helpers ---

    private indexInstance(instance: Lambda): void {
        let bucket = this.instancesByType.get(instance.id);
        if (!bucket) {
            bucket = new Set();
            this.instancesByType.set(instance.id, bucket);
        }
        bucket.add(instance);
    }

    private unindexInstance(instance: Lambda): void {
        const bucket = this.instancesByType.get(instance.id);
        if (!bucket) {
            return;
        }

        bucket.delete(instance);
        if (bucket.size === 0) {
            this.instancesByType.delete(instance.id);
        }
    }

    private getInstanceList(): readonly Lambda[] {
        if (!this.cachedInstanceList) {
            this.cachedInstanceList = Array.from(this.instances.values());
        }
        return this.cachedInstanceList;
    }

    private getFixedUpdateInstanceList(): readonly Lambda[] {
        if (this.cachedFixedUpdateInstanceList) {
            return this.cachedFixedUpdateInstanceList;
        }

        const fixedInstances: Lambda[] = [];
        const waves = this.buildWaves();
        for (let waveIndex = 0; waveIndex < waves.length; waveIndex++) {
            const wave = waves[waveIndex]!;
            for (let instanceIndex = 0; instanceIndex < wave.length; instanceIndex++) {
                const instance = wave[instanceIndex]!;
                if (typeof instance.fixedUpdate === "function") {
                    fixedInstances.push(instance);
                }
            }
        }

        this.cachedFixedUpdateInstanceList = fixedInstances;
        return fixedInstances;
    }

    private invalidateInstanceList(): void {
        this.cachedInstanceList = null;
        this.cachedFixedUpdateInstanceList = null;
    }

    private invalidateWaves(): void {
        this.invalidateInstanceList();
        this._cachedWaves = null;
        this.resetUpdateResumeCursors();
    }

    private captureReloadSnapshot(instance: Lambda): LambdaInstanceSnapshot {
        const registrations: LambdaRegistrationSnapshot[] = [];

        for (const [target, data] of instance.registeredObjects) {
            registrations.push({
                target,
                data: this.cloneComponentDataForReload(data),
            });
        }

        return {
            uuid: instance.uuid,
            attributes: {...instance.attributes},
            registrations,
        };
    }

    private cloneComponentDataForReload(data: Record<string, any>): Record<string, any> {
        const clone: Record<string, any> = {};

        for (const key in data) {
            if (key === "_isCritical" || !Object.prototype.hasOwnProperty.call(data, key)) {
                continue;
            }
            clone[key] = data[key];
        }

        return clone;
    }

    private mergeComponentDataForFusion(target: Record<string, any>, data: Record<string, any>): void {
        for (const key in data) {
            if (key === "_isCritical" || !Object.prototype.hasOwnProperty.call(data, key)) {
                continue;
            }
            target[key] = data[key];
        }
    }

    private mergeLambdaAttributesForFusion(target: Record<string, any>, attributes: Record<string, any>): void {
        for (const key in attributes) {
            if (!Object.prototype.hasOwnProperty.call(attributes, key)) {
                continue;
            }
            target[key] = attributes[key];
        }
    }

    private cacheLambdaConfigMetadata(lambdaId: string, config: LambdaConfig): void {
        const schema = config.componentSchema;
        const schemaKeys = schema ? Object.keys(schema) : EMPTY_COMPONENT_LIST;
        const readComponents = config.readComponents ? [...config.readComponents] : schemaKeys;
        const writeComponents = config.writeComponents ? [...config.writeComponents] : schemaKeys;
        const defaultComponentData: Record<string, any> = {};

        if (schema) {
            for (const key of schemaKeys) {
                const entry = schema[key];
                if (entry && typeof entry === "object" && "default" in entry) {
                    defaultComponentData[key] = (entry as { default: any }).default;
                }
            }
        }

        this.lambdaConfigMetadata.set(lambdaId, {
            hasDependencyMetadata:
                schemaKeys.length > 0 ||
                (config.readComponents?.length ?? 0) > 0 ||
                (config.writeComponents?.length ?? 0) > 0,
            readComponents,
            writeComponents,
            writeComponentSet: writeComponents.length > 0 ? new Set(writeComponents) : EMPTY_COMPONENT_SET,
            defaultComponentData,
        });
    }

    private resetUpdateResumeCursors(): void {
        this.variableUpdateResumeWaveIndex = 0;
        this.variableUpdateResumeInstanceIndex = 0;
    }

    private refreshObjectArchetype(target: Object3D): void {
        const instanceIds = this.objectLambdaMap.get(target);
        if (!instanceIds || instanceIds.size === 0) {
            this.queryRegistry.removeObject(target);
            return;
        }
        const typeIds = this.scratchObjectArchetypeTypeIds;
        typeIds.length = 0;
        try {
            for (const iid of instanceIds) {
                const inst = this.instances.get(iid);
                if (inst) typeIds.push(inst.id);
            }
            this.queryRegistry.setArchetype(target, typeIds);
        } finally {
            typeIds.length = 0;
        }
    }

    private removeObjectLambdaMapping(target: Object3D, instanceId: string): void {
        const instanceIds = this.objectLambdaMap.get(target);
        if (!instanceIds) return;
        instanceIds.delete(instanceId);
        if (instanceIds.size === 0) {
            this.objectLambdaMap.delete(target);
        }
    }

    private getDefaultComponentData(lambdaId: string): Record<string, any> {
        return this.lambdaConfigMetadata.get(lambdaId)?.defaultComponentData ?? EMPTY_COMPONENT_DATA;
    }

    // --- Physics fusion ---

    /**
     * If an object is registered with 2+ fusable physics lambdas,
     * migrate it to the single-pass FusedPhysicsLambda and deregister
     * from the individual instances.
     * @param target
     */
    private tryFuseObject(target: Object3D): void {
        const instanceIds = this.objectLambdaMap.get(target);
        if (!instanceIds || instanceIds.size < 2) return;

        // Collect physics instances for this object
        const physicsEntries: { id: string; instanceId: string; data: Record<string, any> }[] = [];
        for (const iid of instanceIds) {
            const inst = this.instances.get(iid);
            if (!inst || !FUSABLE_LAMBDA_IDS.has(inst.id)) continue;
            const data = inst.getComponentData(target);
            if (data) {
                physicsEntries.push({ id: inst.id, instanceId: iid, data });
            }
        }

        if (physicsEntries.length < 2) return;

        // Already fused?
        if (this.fusedPhysicsInstance && instanceIds.has(this.fusedPhysicsInstance.uuid)) return;

        // Merge component data from all physics lambdas (later entries override earlier)
        const merged: Record<string, any> = {};
        for (const entry of physicsEntries) {
            this.mergeComponentDataForFusion(merged, entry.data);
        }

        // Merge attributes from individual instances for gravity values
        const mergedAttrs: Record<string, any> = {};
        for (const entry of physicsEntries) {
            const inst = this.instances.get(entry.instanceId);
            if (inst) {
                this.mergeLambdaAttributesForFusion(mergedAttrs, inst.attributes);
            }
        }

        // Get or create the fused instance
        const fused = this.getOrCreateFusedInstance(mergedAttrs);
        if (!fused) return;

        // Deregister from individual physics instances and record redirects
        for (const entry of physicsEntries) {
            (this.instances.get(entry.instanceId) as LambdaBase)?._deregisterObject(target);
            instanceIds.delete(entry.instanceId);
            // Record redirect so external code using the original instanceId gets forwarded
            this.fusedObjectRedirects.set(`${entry.instanceId}:${target.uuid}`, fused.uuid);
        }

        // Register with fused instance
        (fused as LambdaBase)._registerObject(target, merged);
        instanceIds.add(fused.uuid);
        this.refreshObjectArchetype(target);
    }

    private getOrCreateFusedInstance(attributes: Record<string, any>): FusedPhysicsLambda | null {
        if (this.fusedPhysicsInstance) return this.fusedPhysicsInstance;

        try {
            const fused = new FusedPhysicsLambda(FUSED_PHYSICS_ID, { attributes });
            void fused.init(this.game);
            this.instances.set(fused.uuid, fused);
            this.indexInstance(fused);
            this.invalidateWaves();
            this.fusedPhysicsInstance = fused;
            console.log(`[LambdaManager] Created fused physics instance (uuid: ${fused.uuid})`);
            return fused;
        } catch (error) {
            console.error("[LambdaManager] Failed to create fused physics instance:", error);
            return null;
        }
    }
}
