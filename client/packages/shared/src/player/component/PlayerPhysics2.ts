import {Object3D, Quaternion, Scene, Vector3, type QuaternionLike, type Vector3Like} from "three";

import PlayerComponent from "./PlayerComponent";
import PlayerLoadMask from "./PlayerLoadMask";
import EngineRuntime from "../../EngineRuntime";
import type {IMultiplayerState} from "../../behaviors/state/IMultiplayerState";
import {GAME_GRAVITY_DEFAULT} from "../../constants/game";
import { processInBatches } from "../../physics/common/processInBatches";
import {
    CollisionBehavior,
    CollisionData,
    ICollisionSource,
    IDispatcher,
    IPhysics,
    isPhysicsEngineType,
    ObjectMotionState,
    PhysicsEngineType,
} from "../../physics/common/types";
import {PhysicsEngineFactory} from "../../physics/PhysicsEngineFactory";
import {PhysicsRuntimeUtil} from "../../physics/PhysicsRuntimeUtil";
import {PhysicsUtil} from "../../physics/PhysicsUtil";
import {shouldUsePhysicsWorker} from "../../physics/preloadPhysics";
import type {PhysicsWrapper} from "../../physics/simple/PhysicsWrapper";
import {setGeometryWorkerPoolSize} from "../../physics/worker/GeometryComputePoolConfig";
import PhysicsProxy from "../../physics/worker/PhysicsProxy";
import {isFrameRuntimeTraceEnabled, recordFrameRuntimeTrace} from "@stem/editor-oss/scheduler/debug/frameRuntimeTrace";
import {DetectDevice} from "../../utils/DetectDevice";
import {getObjectTemplateFromScene} from "../../utils/ObjectUtils";
import {SceneLoadProfiler} from "../../utils/SceneLoadProfiler";
import {DEFAULT_SOLVER_ITERATIONS, normalizeSolverIterations} from "@stem/editor-oss/physics/common/physicsConfig";

const PHYSICS_COLLECTION_BATCH_SIZE = 512;
const PHYSICS_COLLECTION_FRAME_BUDGET_MS = 8;
const MIN_PHYSICS_UPDATE_RATE_HZ = 1;
const MAX_PHYSICS_UPDATE_RATE_HZ = 240;
const MAX_PHYSICS_SUBSTEPS = 16;
const MAX_PHYSICS_STEPS_PER_FRAME = 16;

type UpdateData = {
    receivedAtPerf: number;
    uuid: string;
    position: Vector3Like;
    rotation: QuaternionLike;
    scale: Vector3Like;
    stepDurationMs: number;
    motionState?: ObjectMotionState;
};

type ExtrapolationBlendSource = {
    previous: UpdateData;
    current: UpdateData;
};

type UpdatesData = {
    previous: UpdateData | null;
    current: UpdateData | null;
    blendSource: ExtrapolationBlendSource | null;
};

type UpdateApplySummary = {
    appliedCount: number;
    interpolatedCount: number;
    oldestPendingAgeMs: number | null;
    newestPendingAgeMs: number | null;
    maxInterpolationProgress: number | null;
    pendingAfterApply: number;
};

type PhysicsTraceSnapshot = {
    schedulerDriven: boolean;
    pendingUpdates: number;
    bodyUpdatesSinceLastApply: number;
    lastDeltaTimeMs: number;
    lastAppliedCount: number;
    lastInterpolatedCount: number;
    lastPendingBeforeApply: number;
    lastOldestPendingAgeMs: number | null;
    lastNewestPendingAgeMs: number | null;
    lastMaxInterpolationProgress: number | null;
    lastBodyUpdateAgeMs: number | null;
    lastAppliedAgeMs: number | null;
    stepCounter: number;
};

type PhysicsObjectDistance = {
    object: Object3D;
    distanceSq: number;
};

type PhysicsSceneCallback = (target: Object3D) => void;
type PhysicsCallbackHost = EngineRuntime & {
    addPhysicsObject?: PhysicsSceneCallback;
    removePhysicsObject?: PhysicsSceneCallback;
    addPhysicsObjectBody?: PhysicsSceneCallback;
    removePhysicsObjectBody?: PhysicsSceneCallback;
};

export type PhysicsFixedStepResult = "completed" | "pending" | "dropped";

function createUpdateApplySummary(): UpdateApplySummary {
    return {
        appliedCount: 0,
        interpolatedCount: 0,
        oldestPendingAgeMs: null,
        newestPendingAgeMs: null,
        maxInterpolationProgress: null,
        pendingAfterApply: 0,
    };
}

const nowForPhysicsCollection = (): number =>
    typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();

const yieldPhysicsCollectionToPaint = (): Promise<void> =>
    new Promise(resolve => {
        const finish = () => setTimeout(() => resolve(), 0);
        if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(() => finish());
        } else {
            finish();
        }
    });

export default class PlayerPhysics2 extends PlayerComponent implements ICollisionSource {
    private static readonly USE_ASYNC_PHYSICS_LOADING = true;
    // Device-adaptive: fewer workers on mobile to reduce memory pressure from parallel geometry computation.
    private static readonly MAX_GEOMETRY_WORKERS = DetectDevice.isMobile() ? 2 : Math.min(8, Math.max(4, navigator.hardwareConcurrency || 4));
    private static readonly LOAD_CONCURRENCY = DetectDevice.isMobile() ? 2 : 4;
    
    private isMultiplayer = false;
    private maxMultiplayerClientsPerRoom = 4;
    private useWorker: boolean;
    private physics: IPhysics | null;
    /** Backend selected for the current play session, used to gate legacy script bindings. */
    private engineType: PhysicsEngineType = PhysicsEngineType.Ammo;
    private scene!: Scene;
    private disposed = false;
    private readonly callbackHost: PhysicsCallbackHost;
    private previousAddPhysicsObject?: PhysicsSceneCallback;
    private previousRemovePhysicsObject?: PhysicsSceneCallback;
    private previousRemovePhysicsObjectBody?: PhysicsSceneCallback;
    private previousAddPhysicsObjectBody?: PhysicsSceneCallback;
    private installedAddPhysicsObject?: PhysicsSceneCallback;
    private installedRemovePhysicsObject?: PhysicsSceneCallback;
    private installedRemovePhysicsObjectBody?: PhysicsSceneCallback;
    private installedAddPhysicsObjectBody?: PhysicsSceneCallback;
    private updates = new Map<string, UpdatesData>();
    private pendingUpdateCount = 0;
    private positionAuxA = new Vector3();
    private positionAuxB = new Vector3();
    private positionAuxC = new Vector3();
    private scaleAuxA = new Vector3();
    private scaleAuxB = new Vector3();
    private scaleAuxC = new Vector3();
    private physicsObjectWorldPosition = new Vector3();
    private physicsObjectDistanceScratch: PhysicsObjectDistance[] = [];
    private physicsObjectsScratch: Object3D[] = [];
    private physicsCollectionStackScratch: Object3D[] = [];
    private updateOrderScratch: string[] = [];
    private sortedUpdateOrderScratch: string[] = [];
    private updateDependencyStackScratch: string[] = [];
    private updateDependenciesScratch = new Map<string, string | null>();
    private updateVisitedScratch = new Set<string>();
    private updateDynamicObjectsScratch = new Map<string, Object3D>();
    private updateApplySummaryScratch = createUpdateApplySummary();
    private quaternionAuxA = new Quaternion();
    private quaternionAuxB = new Quaternion();
    private quaternionAuxC = new Quaternion();
    private quaternionAuxD = new Quaternion();
    private collisionListener?: (collision: CollisionData) => void;
    private mask: PlayerLoadMask;
    private qualityUpdateRateHz: number | null = null;
    private qualitySubsteps = 1;
    private qualityMaxStepsPerFrame = 3;
    private qualitySolverIterations = DEFAULT_SOLVER_ITERATIONS;
    private physicsAccumulator = 0;
    private unifiedFixedStepEnabled = false;
    private fixedStepCompletionListener: ((fixedDeltaTime: number) => void) | null = null;
    private extrapolationEnabled = true;
    private traceBodyUpdatesSinceLastApply = 0;

    /**
     * Returns the backend selected for the active play session.
     *
     * Player scripts still receive the historical `Ammo` parameter for
     * compatibility, but it must be absent when Rapier is active. Keeping the
     * selection here avoids inferring the backend from private adapter fields
     * or a stale global WASM singleton.
     */
    getPhysicsEngineType(): PhysicsEngineType {
        return this.engineType;
    }
    private traceLastBodyUpdatePerfTime: number | null = null;
    private traceLastAppliedPerfTime: number | null = null;
    private traceStepCounter = 0;
    private traceSnapshot: PhysicsTraceSnapshot = {
        schedulerDriven: false,
        pendingUpdates: 0,
        bodyUpdatesSinceLastApply: 0,
        lastDeltaTimeMs: 0,
        lastAppliedCount: 0,
        lastInterpolatedCount: 0,
        lastPendingBeforeApply: 0,
        lastOldestPendingAgeMs: null,
        lastNewestPendingAgeMs: null,
        lastMaxInterpolationProgress: null,
        lastBodyUpdateAgeMs: null,
        lastAppliedAgeMs: null,
        stepCounter: 0,
    };

    multiplayerState: IMultiplayerState | null = null;

    constructor(engine: EngineRuntime) {
        super(engine);
        this.callbackHost = this.app as unknown as PhysicsCallbackHost;
        this.mask = new PlayerLoadMask(engine);
        this.useWorker = shouldUsePhysicsWorker();
        this.physics = null;
        this.previousAddPhysicsObject = this.callbackHost.addPhysicsObject;
        this.previousRemovePhysicsObject = this.callbackHost.removePhysicsObject;
        this.previousRemovePhysicsObjectBody = this.callbackHost.removePhysicsObjectBody;
        this.previousAddPhysicsObjectBody = this.callbackHost.addPhysicsObjectBody;
        //FIXME: move to a separate PhysicsUtils class
        this.installedAddPhysicsObject = (target: Object3D) => {
            this.scene.add(target);
            this.addObject(target);
        };
        this.installedRemovePhysicsObject = (target: Object3D) => {
            this.scene.remove(target);
            if (PhysicsRuntimeUtil.isPhysicsEnabled(target)) {
                this.physics?.remove(target.uuid);
            }
        };
        this.installedRemovePhysicsObjectBody = (target: Object3D) => {
            if (PhysicsRuntimeUtil.isPhysicsEnabled(target)) {
                this.physics?.remove(target.uuid);
            }
        };
        this.installedAddPhysicsObjectBody = (target: Object3D) => {
            if (PhysicsRuntimeUtil.isPhysicsEnabled(target)) {
                this.addObject(target);
            }
        };
        this.callbackHost.addPhysicsObject = this.installedAddPhysicsObject;
        this.callbackHost.removePhysicsObject = this.installedRemovePhysicsObject;
        this.callbackHost.removePhysicsObjectBody = this.installedRemovePhysicsObjectBody;
        this.callbackHost.addPhysicsObjectBody = this.installedAddPhysicsObjectBody;
    }

    create(
        sceneId: string,
        scene: Scene,
        isMultiplayer: boolean,
        maxMultiplayerClientsPerRoom: number,
    ): Promise<IPhysics> {
        this.disposed = false;
        this.scene = scene;
        this.isMultiplayer = isMultiplayer;
        this.maxMultiplayerClientsPerRoom = maxMultiplayerClientsPerRoom;
        this.updates.clear();
        this.pendingUpdateCount = 0;
        return new Promise((resolve, reject) => {
            this.initPhysicsAndAddObjects(sceneId, scene)
                .then(physics => {
                    resolve(physics);
                })
                .catch(reject);
        });
    }

    /**
     * Apply launch-time physics quality settings.
     * Used across legacy and scheduler runtime modes.
     * @param updateRateHz
     * @param substeps
     * @param maxStepsPerFrame
     * @param schedulerDriven When true, EngineRuntime owns the sole fixed-step
     *   accumulator and invokes beginSimulationFrame()/fixedUpdate().
     * @param enableExtrapolation When false render-time extrapolation and
     *   extrapolation handoff blending are disabled.
     * @param solverIterations Constraint solver iterations for Ammo/Rapier.
     */
    configureQuality(
        updateRateHz: number,
        substeps: number,
        maxStepsPerFrame: number,
        schedulerDriven = false,
        enableExtrapolation = true,
        solverIterations = DEFAULT_SOLVER_ITERATIONS,
    ): void {
        this.qualityUpdateRateHz = Number.isFinite(updateRateHz) && updateRateHz > 0
            ? Math.min(MAX_PHYSICS_UPDATE_RATE_HZ, Math.max(MIN_PHYSICS_UPDATE_RATE_HZ, updateRateHz))
            : null;
        this.qualitySubsteps = Math.min(
            MAX_PHYSICS_SUBSTEPS,
            Math.max(1, Math.floor(substeps || 1)),
        );
        this.qualityMaxStepsPerFrame = Math.min(
            MAX_PHYSICS_STEPS_PER_FRAME,
            Math.max(1, Math.floor(maxStepsPerFrame || 3)),
        );
        this.qualitySolverIterations = normalizeSolverIterations(solverIterations);
        this.physics?.setSolverIterations?.(this.qualitySolverIterations);
        this.physicsAccumulator = 0;
        this.unifiedFixedStepEnabled = schedulerDriven;
        this.extrapolationEnabled = enableExtrapolation;
        this.traceSnapshot.schedulerDriven = schedulerDriven;
    }

    //ICollisionSource impl

    addCollisionListener(listener: (collision: CollisionData) => void) {
        this.collisionListener = listener;
    }

    //end of ICollisionSource impl

    async addObjects(): Promise<number> {
        const addedObjectCount = await this.addObjectsFromScene();
        // Physics wireframes are useful for editor diagnostics, but worker
        // sessions must opt in because each frame is copied across the worker
        // boundary. Normal Playground play sessions remain zero-overhead.
        if (!this.useWorker || this.app.debug === true) {
            const debugMesh = this.physics?.initDebug();
            if (debugMesh) {
                this.scene.add(debugMesh);
            }
        }
        return addedObjectCount;
    }

    addPhysicsObject(target: Object3D) {
        this.scene.add(target);
        void this.addObject(target);
    }

    // Device-adaptive: smaller batches on mobile reduce peak memory during physics init.
    private static readonly BATCH_SIZE = DetectDevice.isMobile() ? 3 : 6;

    async addObjectsFromScene(): Promise<number> {
        SceneLoadProfiler.begin("physicsCollect");
        let objectsToAdd: Object3D[];
        try {
            objectsToAdd = await this.collectPhysicsObjectsProgressively();
        } finally {
            SceneLoadProfiler.end("physicsCollect");
        }
        if (objectsToAdd.length === 0) return 0;

        if (PlayerPhysics2.USE_ASYNC_PHYSICS_LOADING) {
            setGeometryWorkerPoolSize(PlayerPhysics2.MAX_GEOMETRY_WORKERS);
        }

        SceneLoadProfiler.begin("physicsBatches");
        try {
            await this.processObjectsInBatches(objectsToAdd);
        } finally {
            SceneLoadProfiler.end("physicsBatches");
        }
        return objectsToAdd.length;
    }

    private collectPhysicsObjects(): Object3D[] {
        this.collectPhysicsObjectsSync();
        return this.finalizeCollectedPhysicsObjects();
    }

    private collectPhysicsObjectsSync(): void {
        const objects = this.physicsObjectDistanceScratch || (this.physicsObjectDistanceScratch = []);
        const cameraPos = this.app.camera.position;
        const tmpVec = this.physicsObjectWorldPosition || (this.physicsObjectWorldPosition = new Vector3());
        let count = 0;
        const stack = this.physicsCollectionStackScratch || (this.physicsCollectionStackScratch = []);
        stack.length = 0;
        stack.push(this.scene);

        while (stack.length > 0) {
            const obj = stack.pop();
            if (!obj) continue;

            const config = PhysicsRuntimeUtil.getPhysicsConfig(obj);
            if (config?.enabled && config.type === "rigidBody") {
                obj.getWorldPosition(tmpVec);
                let entry = objects[count];
                if (!entry) {
                    entry = {object: obj, distanceSq: 0};
                    objects[count] = entry;
                } else {
                    entry.object = obj;
                }
                entry.distanceSq = tmpVec.distanceToSquared(cameraPos);
                count++;
            }

            for (let i = obj.children.length - 1; i >= 0; i--) {
                const child = obj.children[i];
                if (child) stack.push(child);
            }
        }

        objects.length = count;
        stack.length = 0;
    }

    private async collectPhysicsObjectsProgressively(): Promise<Object3D[]> {
        const objects = this.physicsObjectDistanceScratch || (this.physicsObjectDistanceScratch = []);
        const cameraPos = this.app.camera.position;
        const tmpVec = this.physicsObjectWorldPosition || (this.physicsObjectWorldPosition = new Vector3());
        let count = 0;
        const stack = this.physicsCollectionStackScratch || (this.physicsCollectionStackScratch = []);
        stack.length = 0;
        stack.push(this.scene);
        let sliceStart = nowForPhysicsCollection();
        let processedThisSlice = 0;

        while (stack.length > 0) {
            const obj = stack.pop();
            if (!obj) continue;

            const config = PhysicsRuntimeUtil.getPhysicsConfig(obj);
            if (config?.enabled && config.type === "rigidBody") {
                obj.getWorldPosition(tmpVec);
                let entry = objects[count];
                if (!entry) {
                    entry = {object: obj, distanceSq: 0};
                    objects[count] = entry;
                } else {
                    entry.object = obj;
                }
                entry.distanceSq = tmpVec.distanceToSquared(cameraPos);
                count++;
            }

            for (let i = obj.children.length - 1; i >= 0; i--) {
                const child = obj.children[i];
                if (child) stack.push(child);
            }

            processedThisSlice++;
            if (
                processedThisSlice >= PHYSICS_COLLECTION_BATCH_SIZE ||
                nowForPhysicsCollection() - sliceStart >= PHYSICS_COLLECTION_FRAME_BUDGET_MS
            ) {
                await yieldPhysicsCollectionToPaint();
                sliceStart = nowForPhysicsCollection();
                processedThisSlice = 0;
            }
        }

        objects.length = count;
        stack.length = 0;
        return this.finalizeCollectedPhysicsObjects();
    }

    private finalizeCollectedPhysicsObjects(): Object3D[] {
        const objects = this.physicsObjectDistanceScratch || (this.physicsObjectDistanceScratch = []);
        objects.sort((a, b) => a.distanceSq - b.distanceSq);

        const result = this.physicsObjectsScratch || (this.physicsObjectsScratch = []);
        result.length = objects.length;
        for (let i = 0; i < objects.length; i++) {
            result[i] = objects[i]!.object;
        }
        return result;
    }

    private async processObjectsInBatches(objects: Object3D[]): Promise<void> {
        const useAsync = PlayerPhysics2.USE_ASYNC_PHYSICS_LOADING;
        const addMethod = useAsync ? (obj: Object3D) => this.addObject(obj) : (obj: Object3D) => this.addObjectSync(obj);
        await processInBatches({
            items: objects,
            batchSize: PlayerPhysics2.BATCH_SIZE,
            concurrency: PlayerPhysics2.LOAD_CONCURRENCY,
            processItem: addMethod,
            onBatchComplete: (loaded, total) => {
                this.app.loadingManager?.updateStageProgress(loaded / total);
            },
            yieldBetweenBatches: true,
        });
    }

    addPhysicsObjectBody(target: Object3D) {
        if (PhysicsRuntimeUtil.isPhysicsEnabled(target)) {
            void this.addObject(target);
        }
    }

    removePhysicsObjectBody(target: Object3D) {
        if (PhysicsRuntimeUtil.isPhysicsEnabled(target)) {
            this.physics?.remove(target.uuid);
        }
    }

    async addObject(object: Object3D): Promise<void> {
        const physicsConfig = PhysicsRuntimeUtil.getPhysicsConfig(object);
        if (!physicsConfig?.enabled || physicsConfig.type !== "rigidBody") {
            return;
        }
        object.updateMatrixWorld(true);
        const objectTemplate = getObjectTemplateFromScene(object, this.scene);
        await PhysicsUtil.addObjectShapeToPhysics(object, this.physics, objectTemplate);
    }

    async addObjectSync(object: Object3D): Promise<void> {
        const physicsConfig = PhysicsRuntimeUtil.getPhysicsConfig(object);
        if (!physicsConfig?.enabled || physicsConfig.type !== "rigidBody") {
            return;
        }
        object.updateMatrixWorld(true);
        const objectTemplate = getObjectTemplateFromScene(object, this.scene);
        // Use SYNC version for comparison
        await PhysicsUtil.addObjectShapeToPhysics(object, this.physics, objectTemplate, false);
    }

    removeObject(object: Object3D) {
        this.physics?.remove(object.uuid);
    }

    /** @deprecated */
    updateObjectCollisionShape(/* object: Object3D */) {}

    setCollisionBehavior(object: Object3D, behavior: CollisionBehavior) {
        this.physics?.setCollisionBehavior(object.uuid, behavior);
    }

    initPhysicsAndAddObjects(sceneId: string, scene: Scene): Promise<IPhysics> {
        const dispatcher: IDispatcher = {
            onReady: () => {},
            onBodyUpdate: (uuid, position, rotation, scale, dt, motionState) => {
                this.pushUpdateData(uuid, position, rotation, scale, dt, motionState);
            },
            onCollision: (uuid: string, listenerId: string) => {
                if (this.collisionListener) this.collisionListener({uuid, listenerId});
            },
            onSimulationComplete: fixedDeltaTime => {
                this.completeAuthoritativeFixedStep(fixedDeltaTime);
            },
        };

        return new Promise<IPhysics>((resolve, reject) => {
            this.mask.show();
            SceneLoadProfiler.begin("physicsInit");
            this.initPhysics(sceneId, scene, dispatcher)
                .then(async physics => {
                    if (this.disposed) {
                        physics.terminate();
                        throw new Error("PlayerPhysics2 disposed during physics startup");
                    }
                    SceneLoadProfiler.end("physicsInit");
                    this.physics = physics;
                    SceneLoadProfiler.begin("physicsAddObjects");
                    const addedObjectCount = await this.addObjects();
                    if (this.disposed) {
                        physics.terminate();
                        throw new Error("PlayerPhysics2 disposed during physics object collection");
                    }
                    SceneLoadProfiler.end("physicsAddObjects");
                    if (addedObjectCount === 0 && !this.isMultiplayer) {
                        this.mask.hide();
                        resolve(physics);
                        return;
                    }
                    SceneLoadProfiler.begin("physicsPing");
                    physics
                        .ping()
                        .then(() => {
                            SceneLoadProfiler.end("physicsPing");
                            if (this.isMultiplayer) {
                                import("../../physics/simple/PhysicsWrapper")
                                    .then(({PhysicsWrapper}) => {
                                        const physicsWrapper = new PhysicsWrapper(
                                            physics,
                                            this.app.userId,
                                            sceneId,
                                            this.scene,
                                            this.maxMultiplayerClientsPerRoom,
                                            dispatcher,
                                        );
                                        return physicsWrapper.start().then(() => physicsWrapper);
                                    })
                                    .then(physicsWrapper => {
                                        if (this.disposed) {
                                            physicsWrapper.terminate();
                                            throw new Error("PlayerPhysics2 disposed during multiplayer physics startup");
                                        }
                                        this.mask.hide();
                                        this.multiplayerState = (physicsWrapper as PhysicsWrapper).mpClient;
                                        //replace physics with the wrapper
                                        this.physics = physicsWrapper;
                                        resolve(physicsWrapper);
                                    })
                                    .catch(e => {
                                        console.error("MultiplayerClient: failed to start !", e);
                                        this.mask.hide();
                                        reject(e);
                                    });
                            } else {
                                this.mask.hide();
                                resolve(physics);
                            }
                        })
                        .catch(reject);
                })
                .catch(reject);
        });
    }

    async initPhysics(_sceneId: string, scene: Scene, dispatcher: IDispatcher): Promise<IPhysics> {
        let gravity = GAME_GRAVITY_DEFAULT;
        if (scene.userData.physics?.gravity !== undefined) {
            // Gravity is now stored in userData.physics
            gravity = Number(scene.userData.physics.gravity);
        } else if (scene.userData.game?.gravity !== undefined) {
            // Gravity was previously stored in userData.game
            gravity = Number(scene.userData.game.gravity);
        }

        let engineType = PhysicsEngineType.Ammo;
        if (isPhysicsEngineType(scene.userData.physics?.engine)) {
            engineType = scene.userData.physics.engine as PhysicsEngineType;
        }
        this.engineType = engineType;

        let physics: IPhysics | null = null;
        try {
            SceneLoadProfiler.begin("physicsTakeWorker");
            if (this.useWorker) {
                const preloadedWorker = await PhysicsEngineFactory.takeWorker(
                    engineType,
                    gravity,
                    this.qualitySolverIterations,
                );
                physics = new PhysicsProxy(dispatcher, gravity, preloadedWorker);
            } else {
                physics = await PhysicsEngineFactory.createLegacyPhysicsAdapter(engineType, dispatcher, {
                    gravity,
                    solverIterations: this.qualitySolverIterations,
                });
            }
            SceneLoadProfiler.end("physicsTakeWorker");

            SceneLoadProfiler.begin("physicsStart");
            await physics.start();
            SceneLoadProfiler.end("physicsStart");
            return physics;
        } catch (err) {
            // `physics` is assigned before start() so a worker/adapter that
            // fails during startup is still terminated. It is not assigned to
            // this.physics until initPhysicsAndAddObjects() receives it, so
            // normal PlayerPhysics2.dispose() cannot cover this failure window.
            if (physics) {
                try {
                    physics.terminate();
                } catch (cleanupError) {
                    console.warn("PlayerPhysics2: failed to terminate physics after startup failure", cleanupError);
                }
            }
            console.error("PlayerPhysics2: physics engine failed to start", err);
            throw err;
        } finally {
            this.mask.hide();
        }
    }

    /**
     * Applies completed physics samples once per rendered frame. This method
     * deliberately performs no simulation when the unified runtime clock is
     * active.
     */
    beginSimulationFrame(deltaTime: number): void {
        const physics = this.physics;
        const stepNow = performance.now();
        const pendingBeforeApply = this.getPendingUpdateCount();
        const shouldInterpolateDynamicObjects = this.isMultiplayer || this.useWorker;
        let applySummary: UpdateApplySummary;
        if (this.isMultiplayer) {
            this.multiplayerState?.update(deltaTime); //update remote objects
            applySummary = this.updateObjects(true, stepNow); //update local objects
        } else {
            applySummary = this.updateObjects(shouldInterpolateDynamicObjects, stepNow);
        }

        if (!physics) {
            this.updateTraceSnapshot(stepNow, deltaTime, pendingBeforeApply, applySummary);
            return;
        }
        this.updateTraceSnapshot(stepNow, deltaTime, pendingBeforeApply, applySummary);
    }

    /**
     * Simulates exactly one authoritative fixed step. EngineRuntime owns
     * catch-up and calls this before gameplay fixed stages.
     */
    fixedUpdate(fixedDeltaTime: number): PhysicsFixedStepResult {
        if (!this.physics) return "completed";
        this.syncKinematicBodies();
        return this.simulateStep(fixedDeltaTime);
    }

    setFixedStepCompletionListener(
        listener: ((fixedDeltaTime: number) => void) | null,
    ): void {
        this.fixedStepCompletionListener = listener;
    }

    /**
     * Commits a completed worker step before fixed gameplay observes the
     * scene, then captures gameplay-driven kinematic changes for the next
     * queued worker step.
     */
    private completeAuthoritativeFixedStep(fixedDeltaTime: number): void {
        this.updateObjects(false, performance.now());
        this.fixedStepCompletionListener?.(fixedDeltaTime);
        this.syncKinematicBodies();
    }

    /**
     * Legacy standalone callers remain safe. The internal accumulator is used
     * only when no EngineRuntime-owned fixed clock has been configured.
     */
    update(deltaTime: number) {
        this.beginSimulationFrame(deltaTime);
        if (!this.physics || this.unifiedFixedStepEnabled) {
            return;
        }

        if (this.qualityUpdateRateHz && this.qualityUpdateRateHz > 0) {
            const fixedStep = 1 / this.qualityUpdateRateHz;
            this.physicsAccumulator += deltaTime;

            let steps = 0;
            while (this.physicsAccumulator >= fixedStep && steps < this.qualityMaxStepsPerFrame) {
                this.fixedUpdate(fixedStep);
                this.physicsAccumulator -= fixedStep;
                steps++;
            }

            this.physicsAccumulator = Math.min(this.physicsAccumulator, fixedStep);
            return;
        }

        this.fixedUpdate(deltaTime);
    }

    private syncKinematicBodies(): void {
        const physics = this.physics;
        if (!physics) return;

        physics.getKinematicBodyObjects().forEach((object, uuid) => {
            PhysicsRuntimeUtil.calculatePhysicsPositionFromObject(
                object,
                this.positionAuxA,
                this.quaternionAuxA,
                this.scaleAuxA,
            );
            physics.setOrigin(uuid, this.positionAuxA);
            physics.setRotation(uuid, this.quaternionAuxA);
            // TODO: remove because setScale() is deprecated
            physics.setScale(uuid, this.scaleAuxA);
        });
    }

    private simulateStep(deltaTime: number): PhysicsFixedStepResult {
        const physics = this.physics;
        if (!physics) return "completed";

        if (physics.isWorker?.() === true && physics.simulateFixedStep) {
            return physics.simulateFixedStep(deltaTime, this.qualitySubsteps)
                ? "pending"
                : "dropped";
        }

        if (this.qualitySubsteps <= 1) {
            physics.simulate(deltaTime);
            return "completed";
        }

        const step = deltaTime / this.qualitySubsteps;
        for (let i = 0; i < this.qualitySubsteps; i++) {
            physics.simulate(step);
        }
        return "completed";
    }

    private pushUpdateData(
        uuid: string,
        position: Vector3Like,
        rotation: QuaternionLike,
        scale: Vector3Like,
        dt: number,
        motionState: ObjectMotionState | undefined,
    ) {
        let currentUpdate = this.updates.get(uuid);

        if (!currentUpdate) {
            currentUpdate = {
                previous: null,
                current: null,
                blendSource: null,
            };
        }

        const hadCurrentUpdate = currentUpdate.current != null;
        const receivedAtPerf = performance.now();
        const previousStepDurationMs = currentUpdate.current?.stepDurationMs ?? currentUpdate.previous?.stepDurationMs ?? 0;
        const stepDurationMs = Number.isFinite(dt) && dt > 0 ? dt * 1000 : previousStepDurationMs;

        if (currentUpdate.current) {
            currentUpdate.blendSource = this.createExtrapolationBlendSource(currentUpdate);
            currentUpdate.previous = this.createPreviousUpdateForIncomingSample(currentUpdate, receivedAtPerf);
        } else {
            currentUpdate.blendSource = null;
        }

        currentUpdate.current = {
            receivedAtPerf,
            uuid,
            position,
            rotation,
            scale,
            stepDurationMs,
            motionState,
        };

        this.updates.set(uuid, currentUpdate);
        if (!hadCurrentUpdate) {
            this.pendingUpdateCount = (this.pendingUpdateCount || 0) + 1;
        }
        this.traceBodyUpdatesSinceLastApply++;
        this.traceLastBodyUpdatePerfTime = receivedAtPerf;
    }

    private createExtrapolationBlendSource(data: UpdatesData): ExtrapolationBlendSource | null {
        if (!this.extrapolationEnabled) {
            return null;
        }

        const previous = data.previous;
        const current = data.current;

        if (!previous || !current) {
            return null;
        }

        return {previous, current};
    }

    private createPreviousUpdateForIncomingSample(data: UpdatesData, receivedAtPerf: number): UpdateData {
        const previous = data.previous;
        const current = data.current!;

        if (!previous || !this.extrapolationEnabled) {
            return current;
        }

        const stepDurationMs = current.stepDurationMs > 0 ? current.stepDurationMs : previous.stepDurationMs;
        const progressAtReceive = this.getUpdateProgressAtTime(previous, current, receivedAtPerf);

        if (progressAtReceive <= 1) {
            return current;
        }

        this.interpolateObjectPositionAndRotationInto(previous, current, progressAtReceive);

        return {
            receivedAtPerf,
            uuid: current.uuid,
            position: {
                x: this.positionAuxA.x,
                y: this.positionAuxA.y,
                z: this.positionAuxA.z,
            },
            rotation: {
                x: this.quaternionAuxA.x,
                y: this.quaternionAuxA.y,
                z: this.quaternionAuxA.z,
                w: this.quaternionAuxA.w,
            },
            scale: {
                x: this.scaleAuxA.x,
                y: this.scaleAuxA.y,
                z: this.scaleAuxA.z,
            },
            stepDurationMs,
            motionState: current.motionState,
        };
    }

    private getUpdateProgressAtTime(previous: UpdateData, current: UpdateData, frameNow: number): number {
        const stepDurationMs = current.stepDurationMs > 0 ? current.stepDurationMs : previous.stepDurationMs;
        return stepDurationMs > 0 ? Math.max(0, frameNow - current.receivedAtPerf) / stepDurationMs : 1;
    }

    private updateObject(object: Object3D, {current}: UpdatesData) {
        if (!current) {
            return;
        }

        PhysicsRuntimeUtil.updateObjectTransformFromPhysics(object, current.position, current.rotation, current.scale);

        this.updateMotionState(object, current);
    }

    private updateObjectWithInterpolation(object: Object3D, data: UpdatesData, frameNow = performance.now()): number {
        const previous = (data.previous || data.current)!;
        const current = (data.current || data.previous)!;
        const progress = this.getUpdateProgressAtTime(previous, current, frameNow);

        this.interpolateObjectPositionAndRotation(object, data, progress, frameNow);
        this.updateMotionState(object, current);

        if (data.blendSource && progress >= 1.01) {
            data.blendSource = null;
        }

        return progress;
    }

    private updateMotionState(object: Object3D, updateData: UpdateData) {
        if (!updateData || !updateData.motionState) {
            return;
        }

        object.userData.motionState = updateData.motionState;
    }

    /**
     * Computes the order in which physics objects should be updated to ensure
     * parents are processed before children.
     * 
     * @remarks
     * This implementation walks up from each object to find ancestor
     * dependencies rather than traversing the entire scene. This is based on
     * the assumption that physics objects make up a small portion of the scene
     * and that they typically have a small number of ancestors.
     * 
     * @param updateUuids List of physics object UUIDs
     * @returns List of physics object UUIDs in update order
     */
    private computeUpdateOrder(updateUuids: Iterable<string>): string[] {
        const originalOrder = this.updateOrderScratch || (this.updateOrderScratch = []);
        const dependsOn = this.updateDependenciesScratch || (this.updateDependenciesScratch = new Map<string, string | null>());
        const dynamicObjects = this.updateDynamicObjectsScratch || (this.updateDynamicObjectsScratch = new Map<string, Object3D>());
        originalOrder.length = 0;
        dependsOn.clear();
        dynamicObjects.clear();
        let hasParentDependency = false;

        for (const uuid of updateUuids) {
            originalOrder.push(uuid);
            const object = this.physics?.getDynamicBodyObject(uuid);
            if (!object) {
                continue;
            }
            dynamicObjects.set(uuid, object);

            // Walk up to find nearest ancestor that's also being updated
            let ancestor = object.parent;
            let parentPhysicsUuid: string | null = null;
            while (ancestor) {
                if (this.updates.has(ancestor.uuid)) {
                    parentPhysicsUuid = ancestor.uuid;
                    hasParentDependency = true;
                    break;
                }
                ancestor = ancestor.parent;
            }
            if (parentPhysicsUuid) {
                dependsOn.set(uuid, parentPhysicsUuid);
            }
        }

        if (!hasParentDependency) {
            return originalOrder;
        }

        // Topological sort: parents before children
        const updateOrder = this.sortedUpdateOrderScratch || (this.sortedUpdateOrderScratch = []);
        const visited = this.updateVisitedScratch || (this.updateVisitedScratch = new Set<string>());
        updateOrder.length = 0;
        visited.clear();

        for (const uuid of originalOrder) {
            this.appendUpdateWithDependencies(uuid, dependsOn, visited, updateOrder);
        }

        return updateOrder;
    }

    private appendUpdateWithDependencies(
        uuid: string,
        dependsOn: Map<string, string | null>,
        visited: Set<string>,
        updateOrder: string[],
    ): void {
        if (visited.has(uuid)) {
            return;
        }

        const stack = this.updateDependencyStackScratch || (this.updateDependencyStackScratch = []);
        stack.length = 0;

        let current: string | null | undefined = uuid;
        while (current && !visited.has(current)) {
            stack.push(current);
            current = dependsOn.get(current);
        }

        for (let i = stack.length - 1; i >= 0; i--) {
            const nextUuid = stack[i]!;
            if (visited.has(nextUuid)) {
                continue;
            }
            visited.add(nextUuid);
            updateOrder.push(nextUuid);
        }
    }

    private getPendingUpdateCount(): number {
        return this.pendingUpdateCount || 0;
    }

    private resetUpdateApplySummary(): UpdateApplySummary {
        const summary = this.updateApplySummaryScratch || (this.updateApplySummaryScratch = createUpdateApplySummary());
        summary.appliedCount = 0;
        summary.interpolatedCount = 0;
        summary.oldestPendingAgeMs = null;
        summary.newestPendingAgeMs = null;
        summary.maxInterpolationProgress = null;
        summary.pendingAfterApply = 0;
        return summary;
    }

    private updateObjects(interpolateDynamicObjects = false, frameNow = performance.now()): UpdateApplySummary {
        const summary = this.resetUpdateApplySummary();
        if (this.updates.size === 0) {
            this.pendingUpdateCount = 0;
            return summary;
        }

        const updateOrder = this.computeUpdateOrder(this.updates.keys());
        const dynamicObjects = this.updateDynamicObjectsScratch || (this.updateDynamicObjectsScratch = new Map<string, Object3D>());

        for (const uuid of updateOrder) {
            const data = this.updates.get(uuid)!;
            const dynamicObject = dynamicObjects.get(uuid);
            const receivedAtPerf = data.current?.receivedAtPerf ?? null;
            if (receivedAtPerf !== null) {
                const ageMs = Math.max(0, frameNow - receivedAtPerf);
                summary.oldestPendingAgeMs = summary.oldestPendingAgeMs === null ? ageMs : Math.max(summary.oldestPendingAgeMs, ageMs);
                summary.newestPendingAgeMs = summary.newestPendingAgeMs === null ? ageMs : Math.min(summary.newestPendingAgeMs, ageMs);
            }
            if (dynamicObject) {
                if (interpolateDynamicObjects) {
                    const progress = this.updateObjectWithInterpolation(dynamicObject, data, frameNow);
                    summary.interpolatedCount++;
                    summary.maxInterpolationProgress = summary.maxInterpolationProgress === null
                        ? progress
                        : Math.max(summary.maxInterpolationProgress, progress);
                } else {
                    this.updateObject(dynamicObject, data);
                }
                summary.appliedCount++;
            }

            if (interpolateDynamicObjects && dynamicObject && (data.current || data.previous)) {
                if (data.current) {
                    summary.pendingAfterApply++;
                }
            } else if (interpolateDynamicObjects) {
                this.updates.delete(uuid);
            }
        }

        if (!interpolateDynamicObjects) {
            this.updates.clear();
            this.pendingUpdateCount = 0;
        } else {
            this.pendingUpdateCount = summary.pendingAfterApply;
        }
        if (summary.appliedCount > 0) {
            this.traceLastAppliedPerfTime = frameNow;
        }

        return summary;
    }

    getTraceSnapshot(frameNow = performance.now()): PhysicsTraceSnapshot {
        return {
            ...this.traceSnapshot,
            pendingUpdates: this.getPendingUpdateCount(),
            bodyUpdatesSinceLastApply: this.traceBodyUpdatesSinceLastApply,
            lastBodyUpdateAgeMs: this.traceLastBodyUpdatePerfTime === null ? null : Math.max(0, frameNow - this.traceLastBodyUpdatePerfTime),
            lastAppliedAgeMs: this.traceLastAppliedPerfTime === null ? null : Math.max(0, frameNow - this.traceLastAppliedPerfTime),
        };
    }

    private updateTraceSnapshot(
        stepNow: number,
        deltaTime: number,
        pendingBeforeApply: number,
        applySummary: UpdateApplySummary,
    ): void {
        this.traceStepCounter++;
        const pendingAfterApply = applySummary.pendingAfterApply;
        const trace = this.traceSnapshot;
        trace.schedulerDriven = false;
        trace.pendingUpdates = pendingAfterApply;
        trace.bodyUpdatesSinceLastApply = this.traceBodyUpdatesSinceLastApply;
        trace.lastDeltaTimeMs = deltaTime * 1000;
        trace.lastAppliedCount = applySummary.appliedCount;
        trace.lastInterpolatedCount = applySummary.interpolatedCount;
        trace.lastPendingBeforeApply = pendingBeforeApply;
        trace.lastOldestPendingAgeMs = applySummary.oldestPendingAgeMs;
        trace.lastNewestPendingAgeMs = applySummary.newestPendingAgeMs;
        trace.lastMaxInterpolationProgress = applySummary.maxInterpolationProgress;
        trace.lastBodyUpdateAgeMs = this.traceLastBodyUpdatePerfTime === null ? null : Math.max(0, stepNow - this.traceLastBodyUpdatePerfTime);
        trace.lastAppliedAgeMs = this.traceLastAppliedPerfTime === null ? null : Math.max(0, stepNow - this.traceLastAppliedPerfTime);
        trace.stepCounter = this.traceStepCounter;

        if (
            (globalThis as {__TRACE_FRAME_RUNTIME__?: unknown}).__TRACE_FRAME_RUNTIME__ === undefined ||
            !isFrameRuntimeTraceEnabled("physics-step")
        ) {
            this.traceBodyUpdatesSinceLastApply = 0;
            return;
        }

        recordFrameRuntimeTrace({
            kind: "physics-step",
            schedulerDriven: false,
            deltaTimeMs: trace.lastDeltaTimeMs,
            pendingBeforeApply,
            pendingAfterApply,
            appliedCount: applySummary.appliedCount,
            interpolatedCount: applySummary.interpolatedCount,
            oldestPendingAgeMs: applySummary.oldestPendingAgeMs,
            newestPendingAgeMs: applySummary.newestPendingAgeMs,
            maxInterpolationProgress: applySummary.maxInterpolationProgress,
            bodyUpdatesSinceLastApply: this.traceBodyUpdatesSinceLastApply,
            lastBodyUpdateAgeMs: trace.lastBodyUpdateAgeMs,
            lastAppliedAgeMs: trace.lastAppliedAgeMs,
            stepCounter: this.traceStepCounter,
            kinematicBodyCount: this.physics?.getKinematicBodyObjects().size ?? 0,
        });

        this.traceBodyUpdatesSinceLastApply = 0;
    }

    private interpolateObjectPositionAndRotation(
        object: Object3D,
        data: UpdatesData,
        progress: number,
        frameNow: number,
    ) {
        const previous = (data.previous || data.current)!;
        const current = (data.current || data.previous)!;

        if (this.extrapolationEnabled && data.blendSource && progress < 1.01) {
            const blendProgress = Math.min(progress / 1.01, 1);
            const blendWeight = blendProgress * blendProgress * (3 - 2 * blendProgress);
            const extrapolatedProgress = this.getUpdateProgressAtTime(data.blendSource.previous, data.blendSource.current, frameNow);

            this.interpolateObjectPositionAndRotationInto(data.blendSource.previous, data.blendSource.current, extrapolatedProgress);
            this.positionAuxC.copy(this.positionAuxA);
            this.quaternionAuxD.copy(this.quaternionAuxA);
            this.scaleAuxB.copy(this.scaleAuxA);

            this.interpolateObjectPositionAndRotationInto(previous, current, progress);
            this.positionAuxB.copy(this.positionAuxA);
            this.quaternionAuxB.copy(this.quaternionAuxA);
            this.scaleAuxC.copy(this.scaleAuxA);

            this.positionAuxA.copy(this.positionAuxC).lerp(this.positionAuxB, blendWeight);
            this.quaternionAuxA.copy(this.quaternionAuxD).slerp(this.quaternionAuxB, blendWeight);
            this.scaleAuxA.copy(this.scaleAuxB).lerp(this.scaleAuxC, blendWeight);
        } else {
            this.interpolateObjectPositionAndRotationInto(previous, current, progress);
        }

        PhysicsRuntimeUtil.updateObjectTransformFromPhysics(object, this.positionAuxA, this.quaternionAuxA, this.scaleAuxA);
    }

    private interpolateObjectPositionAndRotationInto(
        previous: UpdateData,
        current: UpdateData,
        progress: number,
    ) {
        const stepDurationMs = current.stepDurationMs > 0 ? current.stepDurationMs : previous.stepDurationMs;
        const interpolationProgress = Math.min(progress, 1);
        const extrapolationTimeSeconds = this.extrapolationEnabled
            ? Math.max(0, progress - 1) * stepDurationMs / 1000
            : 0;

        this.positionAuxA.copy(previous.position).lerp(current.position, interpolationProgress);

        if (extrapolationTimeSeconds > 0) {
            if (current.motionState?.linearVelocity) {
                this.positionAuxB.copy(current.motionState.linearVelocity);
            } else if (stepDurationMs > 0) {
                this.positionAuxB.set(
                    current.position.x - previous.position.x,
                    current.position.y - previous.position.y,
                    current.position.z - previous.position.z,
                ).multiplyScalar(1000 / stepDurationMs);
            } else {
                this.positionAuxB.set(0, 0, 0);
            }

            this.positionAuxA.addScaledVector(this.positionAuxB, extrapolationTimeSeconds);
        }

        this.quaternionAuxB.copy(current.rotation);
        // slerp doesn't work with non quaternion objects
        this.quaternionAuxA.copy(previous.rotation).slerp(this.quaternionAuxB, interpolationProgress);

        if (extrapolationTimeSeconds > 0 && current.motionState?.angularVelocity) {
            this.positionAuxB.copy(current.motionState.angularVelocity);
            const angularSpeed = this.positionAuxB.length();

            if (angularSpeed > 0) {
                this.positionAuxB.multiplyScalar(1 / angularSpeed);
                this.quaternionAuxC.setFromAxisAngle(this.positionAuxB, angularSpeed * extrapolationTimeSeconds);
                this.quaternionAuxA.premultiply(this.quaternionAuxC).normalize();
            }
        }

        this.scaleAuxA.copy(previous.scale).lerp(current.scale, interpolationProgress);
    }

    pause() {
        this.physics?.pause();
    }

    resume() {
        if (this.physics?.resume) {
            this.physics?.resume();
        }
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;

        const restoreCallback = (
            key: "addPhysicsObject" | "removePhysicsObject" | "removePhysicsObjectBody" | "addPhysicsObjectBody",
            installed: PhysicsSceneCallback | undefined,
            previous: PhysicsSceneCallback | undefined,
        ) => {
            if (this.callbackHost[key] !== installed) return;
            if (previous) {
                this.callbackHost[key] = previous;
            } else {
                delete (this.callbackHost as unknown as Record<string, unknown>)[key];
            }
        };

        restoreCallback("addPhysicsObject", this.installedAddPhysicsObject, this.previousAddPhysicsObject);
        restoreCallback("removePhysicsObject", this.installedRemovePhysicsObject, this.previousRemovePhysicsObject);
        restoreCallback("removePhysicsObjectBody", this.installedRemovePhysicsObjectBody, this.previousRemovePhysicsObjectBody);
        restoreCallback("addPhysicsObjectBody", this.installedAddPhysicsObjectBody, this.previousAddPhysicsObjectBody);

        this.physics?.terminate();
        this.physics = null;
        this.updates.clear();
        this.pendingUpdateCount = 0;
        this.physicsAccumulator = 0;
        this.unifiedFixedStepEnabled = false;
        this.fixedStepCompletionListener = null;
        this.collisionListener = undefined;
        this.multiplayerState = null;
        this.physicsObjectDistanceScratch.length = 0;
        this.physicsObjectsScratch.length = 0;
        this.physicsCollectionStackScratch.length = 0;
        this.updateOrderScratch.length = 0;
        this.sortedUpdateOrderScratch.length = 0;
        this.updateDependencyStackScratch.length = 0;
        this.updateDependenciesScratch.clear();
        this.updateVisitedScratch.clear();
        this.updateDynamicObjectsScratch.clear();
        this.traceBodyUpdatesSinceLastApply = 0;
        this.traceLastBodyUpdatePerfTime = null;
        this.traceLastAppliedPerfTime = null;
        this.traceStepCounter = 0;
        this.traceSnapshot = {
            schedulerDriven: false,
            pendingUpdates: 0,
            bodyUpdatesSinceLastApply: 0,
            lastDeltaTimeMs: 0,
            lastAppliedCount: 0,
            lastInterpolatedCount: 0,
            lastPendingBeforeApply: 0,
            lastOldestPendingAgeMs: null,
            lastNewestPendingAgeMs: null,
            lastMaxInterpolationProgress: null,
            lastBodyUpdateAgeMs: null,
            lastAppliedAgeMs: null,
            stepCounter: 0,
        };
        this.scene = undefined as unknown as Scene;
    }
}
