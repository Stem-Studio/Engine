import {
    BufferAttribute,
    BufferGeometry,
    DynamicDrawUsage,
    LineBasicMaterial,
    LineSegments,
    MathUtils,
    Object3D,
    Vector3,
    type QuaternionLike,
    type Vector3Like,
} from "three";

import {
    BoxData,
    CapsuleData,
    CollisionBehavior,
    CollisionRegistration,
    CollisionShape,
    CommonData,
    ConcaveHullData,
    ConvexHullData,
    IDispatcher,
    IPlayerOptions,
    SphereData,
    TerrainData,
    CollisionFlag,
    VehicleData,
    VehicleInput,
    VehicleOptions,
    VehicleSpec,
} from "../common/types";
import {
    BatchObjectUpdate,
    BatchUpdateEvent,
    BodyUpdate,
    BodyUpdateBatchEvent,
    PHYSICS_EVENTS,
    PhysicsDebugFrameEvent,
} from "../common/events";
import PhysicsBase from "../PhysicsBase";
import type {PreloadedPhysicsWorker} from "../PhysicsEngineFactory";
import {SceneLoadProfiler} from "@stem/editor-oss/utils/SceneLoadProfiler";
import {isConcaveHullBodyTypeSupported} from "../common/physicsConfig";

export default class PhysicsProxy extends PhysicsBase {
    /** Maximum simulate dt the worker is allowed to consume in one step. Surplus is dropped → physics goes slow-mo under sustained load instead of letting the message queue grow. */
    private static readonly MAX_DT = 0.1;

    private workerHandler: Worker | null = null;
    private workerReady = false;
    public otsShiftVector: Vector3;

    private speedAdjustment = new Vector3();

    private pingCallbacks = new Map<string, (value: void) => void>();

    private objectUpdates: Record<string, BatchObjectUpdate> = {};

    private shapeUuids = new Set<string>();
    /** Shape kind metadata lets the worker proxy reject unsupported bodies before local bookkeeping. */
    private shapeTypes = new Map<string, CollisionShape["type"]>();
    private velocityCache = new Map<string, Vector3Like>();
    private angularVelocityCache = new Map<string, Vector3Like>();
    /** Maps vehicleUuid -> visual object UUIDs registered in dynamicObjects */
    private vehicleVisualUuids = new Map<string, string[]>();
    private debugGeometry: BufferGeometry | null = null;
    private debugMaterial: LineBasicMaterial | null = null;
    private debugMesh: LineSegments | null = null;

    // True between posting SIMULATE and receiving SIMULATE_DONE. While busy, atomic events
    // queue locally and per-uuid latest-wins state coalesces; we don't grow the worker's queue.
    private workerBusy = false;
    private pendingSimulateDt = 0;
    private pendingAtomic: Array<any> = [];
    private static readonly AUTHORITATIVE_QUEUE_CAPACITY = 32;
    private readonly authoritativeStepDeltas = new Float64Array(PhysicsProxy.AUTHORITATIVE_QUEUE_CAPACITY);
    private readonly authoritativeStepSubsteps = new Uint8Array(PhysicsProxy.AUTHORITATIVE_QUEUE_CAPACITY);
    private authoritativeQueueHead = 0;
    private authoritativeQueueCount = 0;
    private authoritativeStepInFlight = false;
    private cancelAuthoritativeCompletion = false;

    // Per-uuid latest-wins buffers for high-frequency events. Flushed once per simulate().
    private pendingPlayerMoves = new Map<string, { direction: Vector3Like; jump: boolean }>();
    private pendingVehicleMoves = new Map<string, VehicleInput>();
    private pendingPlayerGravity = new Map<string, Vector3Like>();
    private pendingPlayerPosition = new Map<string, Vector3Like>();
    private pendingLinearVelocity = new Map<string, Vector3Like>();
    private pendingAngularVelocity = new Map<string, Vector3Like>();
    private pendingLinearDamping = new Map<string, number>();
    private pendingAngularDamping = new Map<string, number>();
    private pendingCollisionBehavior = new Map<string, CollisionBehavior>();

    private clampCount = 0;
    private lastClampLogAt = 0;

    constructor(
        private readonly dispatcher: IDispatcher,
        private readonly gravity: number,
        private readonly preloaded: PreloadedPhysicsWorker,
    ) {
        super(false, true, false);
        this.workerHandler = null;
        this.workerReady = false;
        this.otsShiftVector = new Vector3(0, 0, 0);
    }

    // API
    start(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            // Adopt the worker handed over by `PhysicsEngineFactory.takeWorker`.
            // It already received START and is loading (or has loaded) its
            // engine WASM; we just attach handlers and wait for READY.
            this.workerHandler = this.preloaded.worker;
            this.workerHandler.onmessage = this.handleWorkerMessages;
            this.workerHandler.onerror = (error) => {
                console.error("Physics worker error:", error);
                reject(new Error(`Physics worker crashed: ${error.message}`));
            };
            this.workerHandler.onmessageerror = (error) => {
                console.error("Physics worker message error:", error);
            };
            console.log("Physics worker adopted");
            this.preloaded.onReady(() => {
                this.markWorkerReady();
                resolve();
            });
        });
    }

    terminate() {
        // Worker is going away; bypass back-pressure. Detach handlers before
        // terminating so a late message cannot retain this proxy through the
        // worker event target, then clear every latest-wins/authoritative map
        // that may still reference scene objects or callback closures.
        const worker = this.workerHandler;
        if (worker) {
            try {
                worker.postMessage({event: PHYSICS_EVENTS.TERMINATE});
            } catch {
                // The worker may already be closed during a failed startup.
            }
            worker.onmessage = null;
            worker.onerror = null;
            worker.onmessageerror = null;
            worker.terminate();
        }
        this.workerHandler = null;
        this.workerReady = false;
        this.workerBusy = false;
        this.pendingSimulateDt = 0;
        this.pendingAtomic.length = 0;
        this.authoritativeQueueHead = 0;
        this.authoritativeQueueCount = 0;
        this.authoritativeStepInFlight = false;
        this.cancelAuthoritativeCompletion = true;
        this.pingCallbacks.clear();
        this.objectUpdates = {};
        this.shapeUuids.clear();
        this.shapeTypes.clear();
        this.velocityCache.clear();
        this.angularVelocityCache.clear();
        this.vehicleVisualUuids.clear();
        this.debugGeometry?.dispose();
        this.debugGeometry = null;
        this.debugMaterial?.dispose();
        this.debugMaterial = null;
        this.debugMesh?.removeFromParent();
        this.debugMesh = null;
        this.pendingPlayerMoves.clear();
        this.pendingVehicleMoves.clear();
        this.pendingPlayerGravity.clear();
        this.pendingPlayerPosition.clear();
        this.pendingLinearVelocity.clear();
        this.pendingAngularVelocity.clear();
        this.pendingLinearDamping.clear();
        this.pendingAngularDamping.clear();
        this.pendingCollisionBehavior.clear();
        this.clearTrackedObjects();
    }

    simulate(deltaTime: number) {
        if (this.workerBusy) {
            this.pendingSimulateDt = Math.min(this.pendingSimulateDt + deltaTime, PhysicsProxy.MAX_DT);
            return;
        }

        this.flushLatestWins();

        const batchUpdate: BatchUpdateEvent = {
            event: PHYSICS_EVENTS.BATCH.UPDATE,
            objects: this.objectUpdates,
        };
        this.workerHandler?.postMessage(batchUpdate);
        this.objectUpdates = {};

        let dt = this.pendingSimulateDt + deltaTime;
        if (dt > PhysicsProxy.MAX_DT) {
            dt = PhysicsProxy.MAX_DT;
            this.clampCount++;
        }
        this.pendingSimulateDt = 0;

        this.workerHandler?.postMessage({event: PHYSICS_EVENTS.SIMULATE, deltaTime: dt});
        this.workerBusy = true;

        this.maybeLogClamp();
    }

    /**
     * Queues a fixed step without merging it with neighboring steps. The
     * worker acknowledges every entry independently.
     */
    simulateFixedStep(deltaTime: number, substeps: number): boolean {
        const safeDeltaTime = Number.isFinite(deltaTime) && deltaTime > 0
            ? Math.min(deltaTime, PhysicsProxy.MAX_DT)
            : 0;
        if (safeDeltaTime <= 0) return false;
        const safeSubsteps = Math.min(16, Math.max(1, Math.floor(substeps || 1)));

        if (!this.workerBusy) {
            this.dispatchAuthoritativeFixedStep(safeDeltaTime, safeSubsteps);
            return true;
        }
        if (this.authoritativeQueueCount >= PhysicsProxy.AUTHORITATIVE_QUEUE_CAPACITY) {
            return false;
        }

        const tail = (
            this.authoritativeQueueHead + this.authoritativeQueueCount
        ) % PhysicsProxy.AUTHORITATIVE_QUEUE_CAPACITY;
        this.authoritativeStepDeltas[tail] = safeDeltaTime;
        this.authoritativeStepSubsteps[tail] = safeSubsteps;
        this.authoritativeQueueCount++;
        return true;
    }

    pause() {
        this.authoritativeQueueCount = 0;
        this.authoritativeQueueHead = 0;
        if (this.authoritativeStepInFlight) {
            this.cancelAuthoritativeCompletion = true;
        }
        this.postAtomic({event: PHYSICS_EVENTS.PAUSE});
    }

    resume() {
        this.postAtomic({event: PHYSICS_EVENTS.RESUME});
    }

    ping(): Promise<void> {
        return new Promise<void>((resolve) => {
            const pingId = MathUtils.generateUUID();
            this.pingCallbacks.set(pingId, resolve);
            this.postAtomic({event: PHYSICS_EVENTS.PING, id: pingId});
        });
    }

    getGravity(): number {
        return this.gravity;
    }

    addFixedJoint(collisionEnabled: boolean, uuidA: string, uuidB: string, vec3PivotB: Vector3, vec4RotationB: QuaternionLike): void {
        this.postAtomic({
            event: PHYSICS_EVENTS.ADD.CONSTRAINT.FIXED,
            collisionEnabled,
            uuidA,
            uuidB,
            vec3PivotB,
            vec4RotationB
        });
    }

    addHingeJoint(collisionEnabled: boolean, uuidA: string, uuidB: string,
                  hingeAxis: Vector3Like, relPos: Vector3Like, relRotation: QuaternionLike,
                  angularLimitEnabled: boolean, angularLimit: Vector3Like,
                  motorEnabled: boolean, motorSpeed: number, motorTorque: number): void {
        this.postAtomic({
            event: PHYSICS_EVENTS.ADD.CONSTRAINT.HINGE,
            collisionEnabled,
            uuidA,
            uuidB,
            hingeAxis,
            relPos,
            relRotation,
            angularLimitEnabled,
            angularLimit,
            motorEnabled,
            motorSpeed,
            motorTorque
        });
    }

    addPoint2PointJoint(collisionEnabled: boolean, uuidA: string, vec3PivotA: Vector3, uuidB: string, vec3PivotB: Vector3): void {
        this.postAtomic({
            event: PHYSICS_EVENTS.ADD.CONSTRAINT.P2P,
            collisionEnabled,
            uuidA,
            uuidB,
            vec3PivotA,
            vec3PivotB
        });
    }

    removeJoint(uuidA: string, uuidB: string): void {
        this.postAtomic({
            event: PHYSICS_EVENTS.REMOVE.CONSTRAINT,
            uuidA,
            uuidB
        });
    }

    setAngularVelocity(uuid: string, velocity: Vector3) {
        this.pendingAngularVelocity.set(uuid, {x: velocity.x, y: velocity.y, z: velocity.z});
    }

    setLinearVelocity(uuid: string, velocity: Vector3) {
        this.pendingLinearVelocity.set(uuid, {x: velocity.x, y: velocity.y, z: velocity.z});
    }

    applyCentralImpulse(uuid: string, impulse: Vector3) {
        this.postAtomic({
            event: PHYSICS_EVENTS.APPLY.CENTRAL_IMPULSE,
            uuid,
            x: impulse.x,
            y: impulse.y,
            z: impulse.z,
        });
    }

    setOrigin(uuid: string, position: Vector3Like) {
        let update = this.objectUpdates[uuid];
        if (!update) {
            update = { position: null, quaternion: null, scale: null };
            this.objectUpdates[uuid] = update;
        }

        update.position = { x: position.x, y: position.y, z: position.z };
    }

    setRotation(uuid: string, quaternion: QuaternionLike) {
        let update = this.objectUpdates[uuid];
        if (!update) {
            update = { position: null, quaternion: null, scale: null };
            this.objectUpdates[uuid] = update;
        }

        update.quaternion = { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w };
    }

    setScale(uuid: string, scale: Vector3Like): void {
        let update = this.objectUpdates[uuid];
        if (!update) {
            update = { position: null, quaternion: null, scale: null };
            this.objectUpdates[uuid] = update;
        }

        update.scale = { x: scale.x, y: scale.y, z: scale.z };
    }

    setSolverIterations(solverIterations: number): void {
        this.postAtomic({
            event: PHYSICS_EVENTS.SET.SOLVER_ITERATIONS,
            solverIterations,
        });
    }

    setPlayerGravity(uuid: string, gravity: Vector3Like) {
        if (!uuid || uuid === "") {
            console.warn("PhysicsProxy: setPlayerGravity called with empty UUID, ignoring");
            return;
        }
        this.pendingPlayerGravity.set(uuid, {x: gravity.x, y: gravity.y, z: gravity.z});
    }

    setPlayerPosition(uuid: string, position: Vector3): void {
        if (!uuid || uuid === "") {
            console.warn("PhysicsProxy: setPlayerPosition called with empty UUID, ignoring");
            return;
        }
        this.pendingPlayerPosition.set(uuid, {x: position.x, y: position.y, z: position.z});
    }

    private addObjectAndPostEvent<DataT extends CommonData>(object: Object3D, event: string, data: DataT) {
        data.collision_flag = super.addObject(data.uuid, data.mass, data.collision_flag!, object);
        this.postAtomic({event, ...data});
    }

    addShape(uuid: string, collisionShape: CollisionShape) {
        this.postAtomic({
            event: PHYSICS_EVENTS.ADD.SHAPE,
            uuid,
            shape: collisionShape,
        });
        this.shapeUuids.add(uuid);
        this.shapeTypes.set(uuid, collisionShape.type);
    }

    removeShape(uuid: string) {
        this.postAtomic({
            event: PHYSICS_EVENTS.REMOVE.SHAPE,
            uuid,
        });
        this.shapeUuids.delete(uuid);
        this.shapeTypes.delete(uuid);
    }

    hasShape(uuid: string): boolean {
        return this.shapeUuids.has(uuid);
    }

    setRigidBodyShape(uuid: string, newShapeUuid: string): void {
        if (!uuid || uuid === "" || !newShapeUuid || newShapeUuid === "") {
            console.warn("PhysicsProxy.setRigidBodyShape: body and shape UUIDs are required");
            return;
        }
        if (!this.shapeUuids.has(newShapeUuid)) {
            console.warn(`PhysicsProxy.setRigidBodyShape: shape not found ${newShapeUuid}`);
            return;
        }
        this.postAtomic({
            event: PHYSICS_EVENTS.SET.SHAPE,
            uuid,
            newShapeUuid,
        });
    }

    addBody(object: Object3D, shapeUuid: string, data: CommonData): void {
        const effectiveCollisionFlag = this.getCollisionFlag(
            data.mass,
            data.collision_flag ?? CollisionFlag.DYNAMIC,
        );
        if (!isConcaveHullBodyTypeSupported(this.shapeTypes.get(shapeUuid), effectiveCollisionFlag)) {
            console.warn(
                `PhysicsProxy.addBody: rejected ${effectiveCollisionFlag} body "${data.uuid}" with concave hull shape "${shapeUuid}". ` +
                'Ammo/Rapier support concave hulls only for Static bodies; use ctype "Static" with mass <= 0, ConvexHull, or compound primitive colliders.',
            );
            return;
        }
        data.collision_flag = super.addObject(data.uuid, data.mass, data.collision_flag!, object);
        this.addObjectAndPostEvent(object, PHYSICS_EVENTS.ADD.BODY, {...data, shapeUuid});
    }

    addBox(object: Object3D, data: BoxData) {
        this.addObjectAndPostEvent(object, PHYSICS_EVENTS.ADD.BOX, data);
    }

    addSphere(object: Object3D, data: SphereData) {
        this.addObjectAndPostEvent(object, PHYSICS_EVENTS.ADD.SPHERE, data);
    }

    addConcaveHull(object: Object3D, data: ConcaveHullData) {
        const effectiveCollisionFlag = this.getCollisionFlag(data.mass, data.collision_flag!);
        if (effectiveCollisionFlag === CollisionFlag.DYNAMIC || effectiveCollisionFlag === CollisionFlag.KINEMATIC) {
            console.warn(
                `PhysicsProxy.addConcaveHull: rejected ${effectiveCollisionFlag} body "${data.uuid}". ` +
                'Ammo/Rapier support concave hulls only for Static bodies; use ctype "Static" with mass <= 0, ConvexHull, or compound primitive colliders.',
            );
            return;
        }
        this.addObjectAndPostEvent(object, PHYSICS_EVENTS.ADD.CONCAVEHULL, data);
    }

    addConvexHull(object: Object3D, data: ConvexHullData) {
        this.addObjectAndPostEvent(object, PHYSICS_EVENTS.ADD.CONVEXHULL, data);
    }

    addCapsuleShape(object: Object3D, data: CapsuleData) {
        this.addObjectAndPostEvent(object, PHYSICS_EVENTS.ADD.CAPSULE, data);
    }

    addTerrain(object: Object3D, data: TerrainData) {
        this.addObjectAndPostEvent(object, PHYSICS_EVENTS.ADD.TERRAIN, data);
    }

    remove(uuid: string) {
        this.dropPendingFor(uuid);
        this.postAtomic({event: PHYSICS_EVENTS.REMOVE.RIGID_BODY, uuid});
        super.removeObject(uuid);
    }

    removePrefab(uuid: string): void {
        this.remove(uuid);
    }

    //character / player

    addPlayerObject(uuid: string, useController: boolean, options?: IPlayerOptions): Promise<Object3D | null> {
        if (!uuid || uuid === "") {
            console.warn("PhysicsProxy: addPlayerObject called with empty UUID, ignoring");
            return Promise.resolve(null);
        }
        this.postAtomic({
            event: PHYSICS_EVENTS.PLAYER.ADD,
            uuid,
            useController,
            options,
        });
        return Promise.resolve(null);
    }

    removePlayerObject(uuid: string): void {
        if (!uuid || uuid === "") {
            console.warn("PhysicsProxy: removePlayerObject called with empty UUID, ignoring");
            return;
        }
        this.dropPendingFor(uuid);
        this.postAtomic({event: PHYSICS_EVENTS.PLAYER.REMOVE, uuid});
    }

    movePlayerObject(uuid: string, walkDirection: Vector3, jump: boolean): void {
        if (!uuid || uuid === "") {
            console.warn("PhysicsProxy: movePlayerObject called with empty UUID, ignoring");
            return;
        }
        this.pendingPlayerMoves.set(uuid, {
            direction: {
                x: walkDirection.x + this.speedAdjustment.x,
                y: walkDirection.y + this.speedAdjustment.y,
                z: walkDirection.z + this.speedAdjustment.z,
            },
            jump,
        });
    }

    addVehicleObject(vehicleUuid: string, spec: VehicleSpec, options: VehicleOptions): Promise<void> {
        // Register visual meshes locally so BODY.UPDATE events can find them
        const visualUuids: string[] = [];
        if (spec.chassisObject) {
            this.addObject(spec.chassisObjectUuid, 1, CollisionFlag.DYNAMIC, spec.chassisObject);
            visualUuids.push(spec.chassisObjectUuid);
        }
        for (const wheel of spec.wheels) {
            if (wheel.wheelObject && wheel.wheelObjectUuid) {
                this.addObject(wheel.wheelObjectUuid, 1, CollisionFlag.DYNAMIC, wheel.wheelObject);
                visualUuids.push(wheel.wheelObjectUuid);
            }
        }
        if (visualUuids.length > 0) {
            this.vehicleVisualUuids.set(vehicleUuid, visualUuids);
        }

        // Strip non-serializable Object3D refs before posting to worker
        const serializableSpec: VehicleData = {
            chassisObjectUuid: spec.chassisObjectUuid,
            chassis: spec.chassis,
            wheels: spec.wheels.map(({ name, isFront, radius, width, connection, wheelObjectUuid }) => ({
                name, isFront, radius, width, connection, wheelObjectUuid,
            })),
        };
        this.postAtomic({
            event: PHYSICS_EVENTS.VEHICLE.ADD,
            uuid: vehicleUuid,
            spec: serializableSpec,
            options,
        });
        return Promise.resolve();
    }

    removeVehicleObject(vehicleUuid: string): void {
        const visualUuids = this.vehicleVisualUuids.get(vehicleUuid);
        if (visualUuids) {
            for (const uuid of visualUuids) {
                this.removeObject(uuid);
            }
            this.vehicleVisualUuids.delete(vehicleUuid);
        }
        this.dropPendingFor(vehicleUuid);
        this.postAtomic({
            event: PHYSICS_EVENTS.VEHICLE.REMOVE,
            uuid: vehicleUuid,
        });
    }

    moveVehicleObject(vehicleUuid: string, input: VehicleInput): void {
        this.pendingVehicleMoves.set(vehicleUuid, input);
    }

    setPlayerSpeedAdjustment(uuid: string, speedAdjustment: Vector3) {
        this.speedAdjustment = speedAdjustment;
    }

    addOtsShiftVector(otsShiftVector: Vector3) {
        this.otsShiftVector = otsShiftVector;
    }

    applyImpulseToRigidBody (uuid: string, impulse: Vector3, relativePosition: Vector3) {
        if (!uuid || uuid === "") {
            console.warn("PhysicsProxy: applyImpulse called with empty UUID, ignoring");
            return;
        }
        this.postAtomic({
            event: PHYSICS_EVENTS.APPLY.IMPULSE_TO_RIGIDBODY,
            uuid,
            impulse: { x: impulse.x, y: impulse.y, z: impulse.z },
            relativePosition: { x: relativePosition.x, y: relativePosition.y, z: relativePosition.z },
        });
    }

    applyImpulseToPlayer(uuid: string, impulse: Vector3) {
        if (!uuid || uuid === "") {
            console.warn("PhysicsProxy: applyImpulseToPlayer called with empty UUID, ignoring");
            return;
        }
        this.postAtomic({
            event: PHYSICS_EVENTS.PLAYER.APPLY_IMPULSE,
            uuid,
            impulse: {x: impulse.x, y: impulse.y, z: impulse.z},
        });
    }

    kickNearbyObjects(uuid: string, kickImpulse: number): void {
        if (!uuid || uuid === "") {
            console.warn("PhysicsProxy: kickNearbyObjects called with empty UUID, ignoring");
            return;
        }
        this.postAtomic({event: PHYSICS_EVENTS.APPLY.KICK_NEARBY_OBJECTS, uuid, kickImpulse});
    }

    setCurrentAnimation(/* uuid: string, animation: string */): void {
        //noop
    }

    //collisions

    addCollidableObject(uuid: string): void {
        this.postAtomic({event: PHYSICS_EVENTS.COLLISION.ADD.OBJECT, uuid});
    }

    removeCollidableObject(uuid: string): void {
        this.postAtomic({event: PHYSICS_EVENTS.COLLISION.REMOVE.OBJECT, uuid});
    }

    detectCollisionsForObject(uuid: string, registration: CollisionRegistration, enable: boolean): void {
        this.postAtomic({
            event: PHYSICS_EVENTS.COLLISION.DETECT,
            uuid,
            registration: registration.id,
            type: registration.type,
            enable,
        });
    }

    setCollisionBehavior(uuid: string, behavior: CollisionBehavior): void {
        this.pendingCollisionBehavior.set(uuid, behavior);
    }

    getLinearVelocity(uuid: string): Vector3Like | null {
        return this.velocityCache.get(uuid) || null;
    }

    getAngularVelocity(uuid: string): Vector3Like | null {
        return this.angularVelocityCache.get(uuid) || null;
    }

    setLinearDamping(uuid: string, damping: number): void {
        this.pendingLinearDamping.set(uuid, damping);
    }

    setAngularDamping(uuid: string, damping: number): void {
        this.pendingAngularDamping.set(uuid, damping);
    }

    //end of API

    /**
     * Post an atomic (non-coalescible, ordered) event. Buffers if the worker is mid-simulate;
     * otherwise posts immediately so non-busy workers see no extra latency.
     */
    private postAtomic(message: any): void {
        if (this.workerBusy) {
            this.pendingAtomic.push(message);
        } else {
            this.workerHandler?.postMessage(message);
        }
    }

    /**
     * Drop any pending per-uuid latest-wins state. Called when an object is removed so we
     * don't post stale velocity/move state for an object the worker no longer knows about.
     */
    private dropPendingFor(uuid: string): void {
        this.pendingPlayerMoves.delete(uuid);
        this.pendingVehicleMoves.delete(uuid);
        this.pendingPlayerGravity.delete(uuid);
        this.pendingPlayerPosition.delete(uuid);
        this.pendingLinearVelocity.delete(uuid);
        this.pendingAngularVelocity.delete(uuid);
        this.pendingLinearDamping.delete(uuid);
        this.pendingAngularDamping.delete(uuid);
        this.pendingCollisionBehavior.delete(uuid);
        this.velocityCache.delete(uuid);
        this.angularVelocityCache.delete(uuid);
        delete this.objectUpdates[uuid];
    }

    private flushLatestWins(): void {
        for (const [uuid, {direction, jump}] of this.pendingPlayerMoves) {
            this.workerHandler?.postMessage({
                event: PHYSICS_EVENTS.PLAYER.MOVE,
                uuid,
                direction,
                jump,
            });
        }
        this.pendingPlayerMoves.clear();

        for (const [uuid, input] of this.pendingVehicleMoves) {
            this.workerHandler?.postMessage({
                event: PHYSICS_EVENTS.VEHICLE.MOVE,
                uuid,
                input,
            });
        }
        this.pendingVehicleMoves.clear();

        for (const [uuid, gravity] of this.pendingPlayerGravity) {
            this.workerHandler?.postMessage({
                event: PHYSICS_EVENTS.PLAYER.SET_GRAVITY,
                uuid,
                x: gravity.x,
                y: gravity.y,
                z: gravity.z,
            });
        }
        this.pendingPlayerGravity.clear();

        for (const [uuid, position] of this.pendingPlayerPosition) {
            this.workerHandler?.postMessage({
                event: PHYSICS_EVENTS.PLAYER.SET_POSITION,
                uuid,
                position: {x: position.x, y: position.y, z: position.z},
            });
        }
        this.pendingPlayerPosition.clear();

        for (const [uuid, velocity] of this.pendingLinearVelocity) {
            this.workerHandler?.postMessage({
                event: PHYSICS_EVENTS.SET.LINEAR_VELOCITY,
                uuid,
                x: velocity.x,
                y: velocity.y,
                z: velocity.z,
            });
        }
        this.pendingLinearVelocity.clear();

        for (const [uuid, velocity] of this.pendingAngularVelocity) {
            this.workerHandler?.postMessage({
                event: PHYSICS_EVENTS.SET.ANGULAR_VELOCITY,
                uuid,
                x: velocity.x,
                y: velocity.y,
                z: velocity.z,
            });
        }
        this.pendingAngularVelocity.clear();

        for (const [uuid, value] of this.pendingLinearDamping) {
            this.workerHandler?.postMessage({
                event: PHYSICS_EVENTS.SET.LINEAR_DAMPING,
                uuid,
                value,
            });
        }
        this.pendingLinearDamping.clear();

        for (const [uuid, value] of this.pendingAngularDamping) {
            this.workerHandler?.postMessage({
                event: PHYSICS_EVENTS.SET.ANGULAR_DAMPING,
                uuid,
                value,
            });
        }
        this.pendingAngularDamping.clear();

        for (const [uuid, behavior] of this.pendingCollisionBehavior) {
            this.workerHandler?.postMessage({
                event: PHYSICS_EVENTS.SET.COLLISION_BEHAVIOR,
                uuid,
                behavior,
            });
        }
        this.pendingCollisionBehavior.clear();
    }

    private flushPendingAtomic(): void {
        for (const message of this.pendingAtomic) {
            this.workerHandler?.postMessage(message);
        }
        this.pendingAtomic.length = 0;
    }

    private dispatchAuthoritativeFixedStep(deltaTime: number, substeps: number): void {
        this.flushLatestWins();
        const batchUpdate: BatchUpdateEvent = {
            event: PHYSICS_EVENTS.BATCH.UPDATE,
            objects: this.objectUpdates,
        };
        this.workerHandler?.postMessage(batchUpdate);
        this.objectUpdates = {};
        this.workerHandler?.postMessage({
            event: PHYSICS_EVENTS.SIMULATE,
            deltaTime,
            substeps,
            authoritativeFixedStep: true,
        });
        this.workerBusy = true;
        this.authoritativeStepInFlight = true;
    }

    private dispatchNextAuthoritativeFixedStep(): void {
        if (this.workerBusy || this.authoritativeQueueCount <= 0) return;
        const head = this.authoritativeQueueHead;
        const deltaTime = this.authoritativeStepDeltas[head]!;
        const substeps = this.authoritativeStepSubsteps[head]!;
        this.authoritativeQueueHead = (head + 1) % PhysicsProxy.AUTHORITATIVE_QUEUE_CAPACITY;
        this.authoritativeQueueCount--;
        this.dispatchAuthoritativeFixedStep(deltaTime, substeps);
    }

    /** Reports MAX_DT clamp events at most once a second. Clamps mean the engine can't keep
     *  up with real-time and physics is running in slow-motion — actionable signal. */
    private maybeLogClamp(): void {
        if (this.clampCount === 0) return;
        const now = Date.now();
        if (now - this.lastClampLogAt > 1000) {
            console.warn(`PhysicsProxy: simulate dt clamped to ${PhysicsProxy.MAX_DT * 1000}ms ${this.clampCount}× (last 1s) — engine cannot keep up with real-time`);
            this.clampCount = 0;
            this.lastClampLogAt = now;
        }
    }

    private handleWorkerMessages = (msg: MessageEvent) => {
        let {data} = msg;
        switch (data.event) {
            case PHYSICS_EVENTS.READY:
                this.markWorkerReady();
                break;
            case PHYSICS_EVENTS.SIMULATE_DONE:
                this.workerBusy = false;
                try {
                    if (
                        data.authoritativeFixedStep === true &&
                        this.authoritativeStepInFlight &&
                        !this.cancelAuthoritativeCompletion
                    ) {
                        this.dispatcher.onSimulationComplete?.(data.deltaTime);
                    }
                } catch (error) {
                    console.error("PhysicsProxy: fixed-step completion listener failed", error);
                } finally {
                    this.authoritativeStepInFlight = false;
                    this.cancelAuthoritativeCompletion = false;
                    this.flushPendingAtomic();
                    this.dispatchNextAuthoritativeFixedStep();
                }
                break;
            case PHYSICS_EVENTS.DEBUG.FRAME:
                this.applyDebugFrame(data as PhysicsDebugFrameEvent);
                break;
            case PHYSICS_EVENTS.BODY.UPDATE: {
                // Compatibility fallback for workers from before body-update batching.
                this.dispatchBodyUpdate(data as BodyUpdate);
                break;
            }
            case PHYSICS_EVENTS.BODY.UPDATE_BATCH: {
                const {updates} = data as BodyUpdateBatchEvent;
                for (const update of updates) {
                    this.dispatchBodyUpdate(update);
                }
                break;
            }
            case PHYSICS_EVENTS.PONG: {
                const {id, stats} = data as {id: string; stats?: Record<string, {count: number; totalMs: number}>};
                if (stats) {
                    for (const [event, stat] of Object.entries(stats)) {
                        // Bucket name: shorten "physics:add:box" → "workerEvent-add:box"
                        const short = event.replace(/^physics:/, "");
                        SceneLoadProfiler.accumulate(`workerEvent-${short}`, stat.totalMs, stat.count);
                    }
                }
                const callback = this.pingCallbacks.get(id);
                if (callback) {
                    callback();
                    this.pingCallbacks.delete(id);
                } else {
                    console.warn("PONG received but no callback set");
                }
                break;
            }
            case PHYSICS_EVENTS.COLLISION.DETECTED: {
                const {uuid, listenerId} = data;
                this.dispatcher.onCollision(uuid, listenerId);
                break;
            }
            default:
                //console.warn("Unsupported event from worker: ", data.event);
                break;
        }
    };

    private markWorkerReady(): void {
        if (this.workerReady) {
            return;
        }
        this.workerReady = true;
        this.dispatcher.onReady();
    }

    private dispatchBodyUpdate({uuid, position, quaternion, scale, motionState, dt}: BodyUpdate): void {
        if (motionState?.linearVelocity) {
            this.velocityCache.set(uuid, motionState.linearVelocity);
        } else {
            this.velocityCache.delete(uuid);
        }
        if (motionState?.angularVelocity) {
            this.angularVelocityCache.set(uuid, motionState.angularVelocity);
        } else {
            this.angularVelocityCache.delete(uuid);
        }
        this.dispatcher.onBodyUpdate(uuid, position, quaternion, scale, dt, motionState);
    }

    initDebug(): Object3D {
        if (!this.debugMesh) {
            this.debugGeometry = new BufferGeometry();
            this.debugGeometry.setAttribute(
                "position",
                new BufferAttribute(new Float32Array(0), 3).setUsage(DynamicDrawUsage),
            );
            this.debugGeometry.setAttribute(
                "color",
                new BufferAttribute(new Float32Array(0), 4).setUsage(DynamicDrawUsage),
            );
            this.debugMaterial = new LineBasicMaterial({vertexColors: true});
            this.debugMesh = new LineSegments(this.debugGeometry, this.debugMaterial);
            this.debugMesh.frustumCulled = false;
        }
        this.postAtomic({event: PHYSICS_EVENTS.DEBUG.ENABLE});
        return this.debugMesh;
    }

    private applyDebugFrame({vertices, colors, drawCount}: PhysicsDebugFrameEvent): void {
        if (!this.debugGeometry) return;
        const safeDrawCount = Number.isFinite(drawCount)
            ? Math.max(0, Math.min(Math.floor(drawCount), Math.floor(vertices.length / 3)))
            : 0;
        this.debugGeometry.setAttribute(
            "position",
            new BufferAttribute(vertices, 3).setUsage(DynamicDrawUsage),
        );
        const colorItemSize = safeDrawCount > 0 && colors.length % safeDrawCount === 0
            ? Math.max(3, Math.min(4, colors.length / safeDrawCount))
            : 4;
        this.debugGeometry.setAttribute(
            "color",
            new BufferAttribute(colors, colorItemSize).setUsage(DynamicDrawUsage),
        );
        this.debugGeometry.setDrawRange(0, safeDrawCount);
    }
}
