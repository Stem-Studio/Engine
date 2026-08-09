/// <reference no-default-lib="true"/>
/// <reference lib="webworker" />
import {Vector3} from "three";

import {
    AddBodyEvent,
    AddShapeEvent,
    BatchUpdateEvent,
    PHYSICS_EVENTS,
    RemoveShapeEvent,
    SetCollisionBehaviorEvent,
} from "../common/events";
import {
    BoxData,
    CapsuleData,
    ConcaveHullData,
    ConvexHullData,
    IPhysics,
    SphereData,
    TerrainData,
} from "../common/types";
import {PhysicsEngineFactory} from "../PhysicsEngineFactory";
import Dispatcher from "./dispatcher";

interface WorkerEventStat {
    count: number;
    totalMs: number;
}

export class PhysicsWorker {
    private static readonly MAX_DEBUG_VERTICES = 100_000;
    private physics: IPhysics | null = null;
    private dispatcher = new Dispatcher();
    private requestAnimationFrameId = -1;
    private isPaused = false;
    private isStarting = false;
    private debugEnabled = false;
    /**
     * Per-event handler-time accumulator. Sent back to the main thread on
     * PING so `SceneLoadProfiler` can show which event types dominate the
     * worker queue. Cleared after every send.
     */
    private eventStats = new Map<string, WorkerEventStat>();

    private recordEventTime(event: string, ms: number): void {
        const existing = this.eventStats.get(event);
        if (existing) {
            existing.count += 1;
            existing.totalMs += ms;
        } else {
            this.eventStats.set(event, { count: 1, totalMs: ms });
        }
    }

    private drainStats(): Record<string, WorkerEventStat> {
        const out: Record<string, WorkerEventStat> = {};
        for (const [k, v] of this.eventStats) out[k] = v;
        this.eventStats.clear();
        return out;
    }

    onmessage = (msg: any) => {
        const { data } = msg;

        if (data.event === PHYSICS_EVENTS.PING) {
            const {id} = data;
            postMessage({event: PHYSICS_EVENTS.PONG, id: id, stats: this.drainStats()});
            return;
        }

        if (data.event === PHYSICS_EVENTS.START) {
            if (this.physics || this.isStarting) {
                console.log("PhysicsWorker: already started or starting.");
                return;
            }

            this.isStarting = true;

            PhysicsEngineFactory.createLegacyPhysicsAdapter(
                data.engineType,
                this.dispatcher,
                data.options,
            ).then((physics: IPhysics) => {
                return physics.start().then(() => {
                    console.log("PhysicsWorker: physics engine is started !", data.engineType);
                    this.physics = physics;
                });
            }).catch((err) => {
                console.error("PhysicsWorker: physics engine failed to start", err);
            }).finally(() => {
                this.isStarting = false;
            });
            return;
        }

        if (!this.physics) {
            console.log("PhysicsWorker: physics engine not started yet.");
            return;
        }

        // Handle all other events - wrap in try-catch to prevent worker crashes
        const t0 = performance.now();
        try {
        switch (data.event) {
            case PHYSICS_EVENTS.SIMULATE: {
                this.dispatcher.beginBodyUpdateBatch();
                try {
                    if (!this.isPaused) {
                        const {deltaTime} = data;
                        const substeps = Math.min(16, Math.max(1, Math.floor(data.substeps ?? 1)));
                        const substepDeltaTime = deltaTime / substeps;
                        for (let substep = 0; substep < substeps; substep++) {
                            this.physics.simulate(substepDeltaTime);
                        }
                    }
                } finally {
                    // Worker messages are delivered in post order, so the proxy always
                    // consumes this step's transforms before it clears back-pressure.
                    this.dispatcher.flushBodyUpdateBatch();
                    if (this.debugEnabled) {
                        const debug = this.physics.getDebugRenderData?.();
                        if (debug) {
                            const drawCount = Math.max(
                                0,
                                Math.min(
                                    PhysicsWorker.MAX_DEBUG_VERTICES,
                                    Math.floor(debug.drawCount),
                                    Math.floor(debug.vertices.length / 3),
                                ),
                            );
                            const colorItemSize = drawCount > 0 && debug.colors.length % debug.drawCount === 0
                                ? Math.max(3, Math.min(4, Math.floor(debug.colors.length / debug.drawCount)))
                                : 4;
                            const vertices = debug.vertices.slice(0, drawCount * 3);
                            const colors = debug.colors.slice(0, drawCount * colorItemSize);
                            postMessage({
                                event: PHYSICS_EVENTS.DEBUG.FRAME,
                                vertices,
                                colors,
                                drawCount,
                            }, [vertices.buffer, colors.buffer]);
                        }
                    }
                    // Always ack so the main-side back-pressure unblocks, including
                    // paused steps and engines that throw during a simulation.
                    postMessage({
                        event: PHYSICS_EVENTS.SIMULATE_DONE,
                        authoritativeFixedStep: data.authoritativeFixedStep === true,
                        deltaTime: data.deltaTime,
                    });
                }
                break;
            }

            case PHYSICS_EVENTS.DEBUG.ENABLE:
                this.physics.initDebug();
                this.debugEnabled = true;
                break;

            case PHYSICS_EVENTS.SET.SOLVER_ITERATIONS:
                this.physics.setSolverIterations?.(data.solverIterations);
                break;
            
            case PHYSICS_EVENTS.TERMINATE:
                this.physics.terminate();
                this.debugEnabled = false;
                cancelAnimationFrame(this.requestAnimationFrameId);
                break;

            case PHYSICS_EVENTS.PAUSE:
                this.isPaused = true;
                break;

            case PHYSICS_EVENTS.RESUME:
                this.isPaused = false;
                break;

            case PHYSICS_EVENTS.ADD.CONSTRAINT.FIXED: {
                const {collisionEnabled, uuidA, uuidB, vec3PivotB, vec4RotationB} = data;
                this.physics.addFixedJoint(collisionEnabled, uuidA, uuidB, vec3PivotB,
                    {x: vec4RotationB._x, y: vec4RotationB._y, z: vec4RotationB._z, w: vec4RotationB._w});
                break;
            }

            case PHYSICS_EVENTS.ADD.CONSTRAINT.P2P: {
                const { collisionEnabled, uuidA, uuidB, vec3PivotA, vec3PivotB} = data;
                this.physics.addPoint2PointJoint(collisionEnabled, uuidA, vec3PivotA, uuidB, vec3PivotB);
                break;
            }

            case PHYSICS_EVENTS.ADD.CONSTRAINT.HINGE: {
                const { collisionEnabled, uuidA, uuidB, hingeAxis, relPos, relRotation, angularLimitEnabled,
                    angularLimit, motorEnabled, motorSpeed, motorTorque } = data;
                this.physics.addHingeJoint(collisionEnabled, uuidA, uuidB, hingeAxis, relPos,
                    { x: relRotation._x, y: relRotation._y, z: relRotation._z, w: relRotation._w },
                    angularLimitEnabled, angularLimit, motorEnabled, motorSpeed, motorTorque);
                break;
            }

            case PHYSICS_EVENTS.REMOVE.CONSTRAINT: {
                const { uuidA, uuidB } = data;
                this.physics.removeJoint(uuidA, uuidB);
                break;
            }

            case PHYSICS_EVENTS.ADD.SHAPE: {
                const {uuid, shape} = data as AddShapeEvent;
                this.physics.addShape(uuid, shape);
                break;
            }

            case PHYSICS_EVENTS.REMOVE.SHAPE: {
                const {uuid} = data as RemoveShapeEvent;
                this.physics.removeShape(uuid);
                break;
            }

            case PHYSICS_EVENTS.ADD.BODY: {
                const {shapeUuid, ...commonData} = data as AddBodyEvent;
                this.physics.addBody(null, shapeUuid, commonData);
                break;
            }

            case PHYSICS_EVENTS.ADD.BOX:
                this.physics.addBox(null, data as BoxData);
                break;
            
            case PHYSICS_EVENTS.ADD.SPHERE:
                this.physics.addSphere(null, data as SphereData);
                break;
            
            case PHYSICS_EVENTS.ADD.CONCAVEHULL:
                this.physics.addConcaveHull(null, data as ConcaveHullData);
                break;
            
            case PHYSICS_EVENTS.ADD.CONVEXHULL:
                this.physics.addConvexHull(null, data as ConvexHullData);
                break;
            
            case PHYSICS_EVENTS.ADD.CAPSULE:
                this.physics.addCapsuleShape(null, data as CapsuleData);
                break;
            
            case PHYSICS_EVENTS.ADD.TERRAIN:
                this.physics.addTerrain(null, data as TerrainData);
                break;
            
            case PHYSICS_EVENTS.REMOVE.RIGID_BODY: {
                const {uuid} = data;
                this.physics.remove(uuid);
                break;
            }
            
            case PHYSICS_EVENTS.APPLY.CENTRAL_IMPULSE: {
                const {uuid, x, y, z} = data;
                this.physics.applyCentralImpulse(uuid, {x, y, z} as Vector3);
                break;
            }

            case PHYSICS_EVENTS.APPLY.IMPULSE_TO_RIGIDBODY: {
                const {uuid, impulse, relativePosition} = data;
                if (!uuid || uuid === "") {
                    console.warn("PhysicsWorker: PLAYER.BODY.APPLY_IMPULSE called with empty UUID, ignoring");
                    break;
                }
                this.physics.applyImpulseToRigidBody(uuid, impulse, relativePosition);
                break;
            }

            case PHYSICS_EVENTS.APPLY.KICK_NEARBY_OBJECTS:
                this.physics.kickNearbyObjects(data.uuid, Number(data.kickImpulse));
                break;

            case PHYSICS_EVENTS.SET.ORIGIN: {
                const {uuid, x, y, z} = data;
                this.physics.setOrigin(uuid, {x, y, z});
                break;
            }

            case PHYSICS_EVENTS.SET.ROTATION: {
                const {uuid, x, y, z, w} = data;
                this.physics.setRotation(uuid, {x, y, z, w});
                break;
            }

            case PHYSICS_EVENTS.SET.SCALE: {
                const {uuid, x, y, z} = data;
                this.physics.setScale(uuid, {x, y, z});
                break;
            }

            case PHYSICS_EVENTS.SET.SHAPE: {
                const {uuid, newShapeUuid} = data;
                this.physics.setRigidBodyShape(uuid, newShapeUuid);
                break;
            }

            case PHYSICS_EVENTS.SET.ANGULAR_VELOCITY: {
                const {uuid, x, y, z} = data;
                this.physics.setAngularVelocity(uuid, {x, y, z} as Vector3);
                break;
            }

            case PHYSICS_EVENTS.SET.LINEAR_VELOCITY: {
                const {uuid, x, y, z} = data;
                this.physics.setLinearVelocity(uuid, {x, y, z} as Vector3);
                break;
            }

            case PHYSICS_EVENTS.SET.COLLISION_BEHAVIOR: {
                const {uuid, behavior} = data as SetCollisionBehaviorEvent;
                this.physics.setCollisionBehavior(uuid, behavior);
                break;
            }

            case PHYSICS_EVENTS.SET.LINEAR_DAMPING: {
                const {uuid, value} = data;
                this.physics.setLinearDamping(uuid, value);
                break;
            }

            case PHYSICS_EVENTS.SET.ANGULAR_DAMPING: {
                const {uuid, value} = data;
                this.physics.setAngularDamping(uuid, value);
                break;
            }

            case PHYSICS_EVENTS.COLLISION.DETECT: {
                const {uuid, registration, type, enable} = data;
                this.physics.detectCollisionsForObject(uuid, {id: registration, type: type}, enable);
                break;
            }

            case PHYSICS_EVENTS.PLAYER.ADD: {
                const {uuid, useController, options} = data;
                // Guard against empty or invalid UUID
                if (!uuid || uuid === "") {
                    console.warn("PhysicsWorker: PLAYER.ADD called with empty UUID, ignoring");
                    break;
                }
                this.physics.addPlayerObject(uuid, useController, options);
                break;
            }

            case PHYSICS_EVENTS.PLAYER.REMOVE: {
                const {uuid} = data;
                // Guard against empty or invalid UUID
                if (!uuid || uuid === "") {
                    console.warn("PhysicsWorker: PLAYER.REMOVE called with empty UUID, ignoring");
                    break;
                }
                this.physics.removePlayerObject(uuid);
                break;
            }

            case PHYSICS_EVENTS.PLAYER.MOVE: {
                const {uuid, direction, jump} = data;
                // Guard against empty or invalid UUID
                if (!uuid || uuid === "") {
                    console.warn("PhysicsWorker: PLAYER.MOVE called with empty UUID, ignoring");
                    break;
                }
                this.physics.movePlayerObject(uuid, direction, jump);
                break;
            }

            case PHYSICS_EVENTS.PLAYER.SET_GRAVITY: {
                const {uuid, x, y, z} = data;
                // Guard against empty or invalid UUID
                if (!uuid || uuid === "") {
                    console.warn("PhysicsWorker: PLAYER.SET_GRAVITY called with empty UUID, ignoring");
                    break;
                }
                this.physics.setPlayerGravity(uuid, {x, y, z});
                break;
            }

            case PHYSICS_EVENTS.PLAYER.SET_POSITION: {
                const {uuid, position} = data;
                // Guard against empty or invalid UUID
                if (!uuid || uuid === "") {
                    console.warn("PhysicsWorker: PLAYER.SET_POSITION called with empty UUID, ignoring");
                    break;
                }
                this.physics.setPlayerPosition(uuid, position);
                break;
            }

            case PHYSICS_EVENTS.PLAYER.APPLY_IMPULSE: {
                const {uuid, impulse} = data;
                // Guard against empty or invalid UUID
                if (!uuid || uuid === "") {
                    console.warn("PhysicsWorker: PLAYER.APPLY_IMPULSE called with empty UUID, ignoring");
                    break;
                }
                this.physics.applyImpulseToPlayer(uuid, impulse);
                break;
            }

            case PHYSICS_EVENTS.VEHICLE.ADD: {
                const {uuid, spec, options} = data;
                this.physics.addVehicleObject(uuid, spec, options);
                break;
            }

            case PHYSICS_EVENTS.VEHICLE.REMOVE: {
                const {uuid} = data;
                this.physics.removeVehicleObject(uuid);
                break;
            }

            case PHYSICS_EVENTS.VEHICLE.MOVE: {
                const {uuid, input} = data;
                this.physics.moveVehicleObject(uuid, input);
                break;
            }

            case PHYSICS_EVENTS.COLLISION.ADD.OBJECT: {
                const {uuid} = data;
                this.physics.addCollidableObject(uuid);
                break;
            }

            case PHYSICS_EVENTS.COLLISION.REMOVE.OBJECT: {
                const {uuid} = data;
                this.physics.removeCollidableObject(uuid);
                break;
            }

            case PHYSICS_EVENTS.BATCH.UPDATE: {
                const batchUpdate = data as BatchUpdateEvent;
                for (const uuid of Object.keys(batchUpdate.objects)) {
                    const objectUpdate = batchUpdate.objects[uuid];
                    if (objectUpdate!.position) {
                        this.physics.setOrigin(uuid, objectUpdate!.position);
                    }
                    if (objectUpdate!.quaternion) {
                        this.physics.setRotation(uuid, objectUpdate!.quaternion);
                    }
                    if (objectUpdate!.scale) {
                        this.physics.setScale(uuid, objectUpdate!.scale);
                    }
                }
                break;
            }

            default:
                console.warn("PhysicsWorker: unsupported event: ", data.event);
                break;
        }
        } catch (error) {
            console.error("PhysicsWorker: Error processing event:", data.event, error);
            // Don't re-throw - we want the worker to continue running
        }
        this.recordEventTime(data.event, performance.now() - t0);
    };
}

const physicsWorker = new PhysicsWorker();
addEventListener(
    "message",
    function (e) {
        physicsWorker.onmessage(e);
    },
    false,
);
