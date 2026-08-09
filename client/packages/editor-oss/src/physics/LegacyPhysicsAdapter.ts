import {Object3D, Quaternion, Vector3, type QuaternionLike, type Vector3Like} from "three";

import { COLLISION_TYPE } from '@stem/editor-oss/types/editor';
import { CommonData, CollisionShape, IPlayerOptions, CollisionRegistration, CollisionFlag, IDispatcher, CollisionBehavior, VehicleInput, VehicleOptions, VehicleSpec, TerrainData, PhysicsDebugRenderData } from './common/types';
import {terrainDataToHeightfieldShape} from './common/heightfield';
import PhysicsBase from './PhysicsBase';
import { CollisionEvent, PhysicsEngine, RigidBodyOptions, RigidBodyType } from './PhysicsEngine';

const DEFAULT_PLAYER_GRAVITY = -10.0;
const DEFAULT_PLAYER_JUMP_HEIGHT = 1.0;
const DEFAULT_PLAYER_MAX_SLOPE = 60; // degrees
const DEFAULT_PLAYER_STEP_HEIGHT = 0.5;
const UNIT_SCALE: Vector3Like = { x: 1, y: 1, z: 1 };

/** Converts player speed (units/s) × massRatio into impulse magnitude (~1.5% of speed). */
const PUSH_SPEED_TO_IMPULSE = 0.015;
/** Minimum impulse — ensures a perceptible push. */
const PUSH_IMPULSE_MIN = 0.01;
/** Maximum impulse — prevents objects flying away. */
const PUSH_IMPULSE_MAX = 0.12;
/** Minimum player speed (units/s) to trigger any push. */
const PUSH_MIN_PLAYER_SPEED = 0.05;
/** How much contactDamping reduces impulse (at most 50% reduction when damping=1). */
const PUSH_DAMPING_FACTOR = 0.5;
/** Near-zero epsilon for direction vector length checks. */
const PUSH_DIRECTION_EPSILON = 0.000001;
/** Minimum friction before applying off-center spin impulse. */
const PUSH_FRICTION_THRESHOLD = 0.01;

/** Maximum horizontal reach of the character kick. */
const KICK_RADIUS = 2.5;
/** Keep the kick directional while still forgiving at close range. */
const KICK_CONE_DOT = Math.cos(Math.PI * 0.39);
/** Ignore bodies well above or below the character's foot reach. */
const KICK_VERTICAL_REACH = 1.75;
/** Preserve a useful impulse at the edge of the reach volume. */
const KICK_EDGE_FALLOFF = 0.25;
/** Small lift makes a kick readable without turning it into a jump pad. */
const KICK_VERTICAL_SCALE = 0.12;
const KICK_DISTANCE_EPSILON_SQ = 0.000001;

const RIGID_BODY_TYPE_MAP = {
    [CollisionFlag.DYNAMIC]: RigidBodyType.Dynamic,
    [CollisionFlag.STATIC]: RigidBodyType.Static,
    [CollisionFlag.KINEMATIC]: RigidBodyType.Kinematic,
} as const;

interface Player {
    gravity: number;
    jumpSpeed: number;
    isJumping: boolean;
    pushObjects: boolean;
    pushImpulse: number;
    pushVerticalScale: number;
    readonly walkVelocity: { x: number; y: number; z: number; };
}

interface VehicleVisualData {
    chassisVisualUuid: string;
    wheelVisualUuids: string[];
}

interface ContactPair {
    uuid1: string;
    uuid2: string;
}

/**
 * Adapts a `PhysicsEngine` implementation to the legacy `PhysicsBase` /
 * `IPhysics` interface that the rest of the codebase was built against.
 *
 * `PhysicsBase` / `IPhysics` is the older surface. It bundles many concerns
 * into one interface: rigid bodies, character controllers, players (with
 * jump/push/walk/gravity state), vehicles, joints, collision listeners,
 * substepping, debug drawing, multiplayer-specific state (`isMultiplayer`,
 * `addOtsShiftVector`, `setCurrentAnimation`) — all adjacent to the raw
 * physics primitives. It also carries a number of rough edges:
 *
 * - Deprecated methods still in the contract (`addTerrain`, `setScale`).
 * - Three.js `Object3D` references leak through the API, coupling physics
 *   to the scene graph instead of pure data.
 * - Internal caches exposed as public methods (`getDynamicBodyObject`,
 *   `getKinematicBodyObjects`).
 * - Results come back out-of-band via an `IDispatcher` rather than as
 *   return values, which makes control flow hard to follow and test.
 * - Naming drift (`addCapsuleShape` vs. `addBox`/`addSphere`; `setOrigin`
 *   instead of `setPosition`; `shapeUuuid` typo in `addBody`).
 * - No-op defaults on the base (`kickNearbyObjects`) that quietly hide
 *   unimplemented contracts.
 *
 * The newer `PhysicsEngine` interface is deliberately smaller and
 * data-oriented: add/remove bodies and shapes, set/get transforms and
 * velocities, step. No players, no collision registrations, no Three.js
 * objects, no dispatcher — just primitive operations with plain data in
 * and out.
 *
 * This class is the bridge between the two. It owns everything that lives
 * above the primitive layer: player state (gravity, jump, vertical
 * velocity, push impulses), substepping and the time accumulator,
 * collision-listener routing, and dispatcher fan-out. Engine
 * implementations (Ammo and Rapier) stay focused on primitives;
 * behavior that is genuinely cross-engine lives here.
 *
 * Call sites: `PhysicsEngineFactory.createLegacyPhysicsAdapter` is the
 * canonical entry point. Used by `PhysicsWorker` and `PlayerPhysics2`.
 */
export class LegacyPhysicsAdapter extends PhysicsBase {
    private timeAccumulator = 0;
    private subStepDuration = 1 / 60;
    private maxSubSteps = 4;

    private readonly playerSpeedAdjustment = { x: 0, y: 0, z: 0 };
    private readonly pushDirection = new Vector3();
    private readonly kickOrigin = new Vector3();
    private readonly kickForward = new Vector3();
    private readonly kickToTarget = new Vector3();
    private readonly kickImpulseVector = new Vector3();
    private readonly kickRotation = new Quaternion();
    private readonly collisionHandler = (event: CollisionEvent): void => {
        this.handleCollision(event);
    };

    private readonly players = new Map<string, Player>();

    private readonly collisionListeners = new Map<string, CollisionRegistration[]>();
    private readonly collidableUuids = new Set<string>();

    /** Active contacts indexed by their canonical first and second UUID. */
    private readonly contactPairs = new Map<string, Map<string, ContactPair>>();

    private readonly vehicleVisualData = new Map<string, VehicleVisualData>();

    constructor(private readonly engine: PhysicsEngine, private readonly dispatcher: IDispatcher) {
        super(false, false, true); // isMultiplayer, isWorker, isLocal
    }

    getGravity(): number {
        return this.engine.getGravity();
    }

    setSolverIterations(solverIterations: number): void {
        this.engine.setSolverIterations?.(solverIterations);
    }

    start(): Promise<void> {
        this.dispatcher.onReady();
        return Promise.resolve();
    }

    terminate(): void {
        this.engine.dispose();
        this.players.clear();
        this.collisionListeners.clear();
        this.collidableUuids.clear();
        this.contactPairs.clear();
        this.vehicleVisualData.clear();
        this.clearTrackedObjects();
    }

    simulate(deltaTime: number): void {
        this.timeAccumulator += deltaTime;
        this.engine.stepDuration = this.subStepDuration;

        for (let i = 0; i < this.maxSubSteps && this.timeAccumulator >= this.subStepDuration; i++) {
            this.engine.simulate(this.collisionHandler);

            for (const uuid of this.players.keys()) {
                this.simulatePlayerPostStep(uuid);
            }

            this.pruneContactPairs();
            this.dispatchCollisionEvents();
            this.timeAccumulator -= this.subStepDuration;
        }

        // Keep the accumulator in the range [0, subStepDuration * maxSubSteps].
        this.timeAccumulator %= this.subStepDuration * this.maxSubSteps;

        for (const uuid of this.engine.rigidBodyUuids()) {
            if (this.engine.getRigidBodyType(uuid) !== RigidBodyType.Dynamic) {
                continue;
            }

            const position = this.engine.getRigidBodyPosition(uuid) || { x: 0, y: 0, z: 0 };
            const roation = this.engine.getRigidBodyRotation(uuid) || { x: 0, y: 0, z: 0, w: 1 };
            const linVel = this.engine.getRigidBodyLinearVelocity(uuid);
            // Keep adapter tests and older injected engine doubles tolerant of
            // the optional angular getter while Ammo/Rapier both provide it.
            const angularVel = typeof this.engine.getRigidBodyAngularVelocity === "function"
                ? this.engine.getRigidBodyAngularVelocity(uuid)
                : null;
            const motionState = linVel
                ? {
                    linearVelocity: linVel,
                    angularVelocity: angularVel ?? undefined,
                    onGround: false,
                }
                : undefined;
            this.dispatcher.onBodyUpdate(uuid, position, roation, UNIT_SCALE, deltaTime, motionState);
        }

        for (const uuid of this.engine.characterControllerUuids()) {
            const player = this.players.get(uuid);
            const position = this.engine.getCharacterControllerPosition(uuid) || { x: 0, y: 0, z: 0 };
            const roation = this.engine.getCharacterControllerRotation(uuid) || { x: 0, y: 0, z: 0, w: 1 };
            const linearVelocity = this.engine.getCharacterControllerLinearVelocity(uuid) || { x: 0, y: 0, z: 0 };
            const onGround = this.engine.isCharacterControllerOnGround(uuid) || false;
            this.dispatcher.onBodyUpdate(uuid, position, roation, UNIT_SCALE, deltaTime, { linearVelocity, onGround: onGround && !player?.isJumping });
        }

        {
            const vehiclePhysics = this.engine;
            for (const vehicleUuid of vehiclePhysics.vehicleUuids()) {
                const visualData = this.vehicleVisualData.get(vehicleUuid);
                if (!visualData) continue;

                const chassisPos = vehiclePhysics.getVehicleChassisPosition(vehicleUuid);
                const chassisRot = vehiclePhysics.getVehicleChassisRotation(vehicleUuid);
                if (chassisPos && chassisRot) {
                    this.dispatcher.onBodyUpdate(visualData.chassisVisualUuid, chassisPos, chassisRot, UNIT_SCALE, deltaTime);
                }

                const wheelCount = vehiclePhysics.getVehicleWheelCount(vehicleUuid);
                for (let i = 0; i < wheelCount; i++) {
                    const wheelUuid = visualData.wheelVisualUuids[i];
                    if (!wheelUuid) continue;
                    const wt = vehiclePhysics.getVehicleWheelTransform(vehicleUuid, i);
                    if (wt) {
                        this.dispatcher.onBodyUpdate(wheelUuid, wt.position, wt.rotation, UNIT_SCALE, deltaTime);
                    }
                }
            }
        }
    }

    pause(): void {
        this.engine.pause();
    }

    resume(): void {
        this.engine.resume();
    }

    initDebug(): Object3D | null {
        return (this.engine as any).initDebug?.() ?? null;
    }

    getDebugRenderData(): PhysicsDebugRenderData | null {
        return this.engine.getDebugRenderData?.() ?? null;
    }

    ping(): Promise<void> {
        return Promise.resolve();
    }

    addBody(object: Object3D, shapeUuuid: string, data: CommonData): void {
        const options = {
            mass: data.mass,
            friction: data.friction,
            restitution: data.restitution,
            linearDamping: data.damping?.linear,
            angularDamping: data.damping?.angular,
            position: data.position,
            quaternion: data.quaternion,
            ccd: data.ccd === true,
            allowSleep: data.allowSleep !== false,
        };

        const collisionFlag = this.getCollisionFlag(data.mass, data.collision_flag || CollisionFlag.DYNAMIC);
        const rigidBodyType = RIGID_BODY_TYPE_MAP[collisionFlag]!;

        // A backend may reject an unsupported concave body at the primitive
        // boundary.  Do not mark it as a local dynamic/kinematic object or
        // issue follow-up transform calls when that happens.  This keeps the
        // legacy adapter's bookkeeping consistent for direct callers as well
        // as for the normal PhysicsUtil path.
        if (this.engine.hasRigidBody(data.uuid)) {
            console.warn("LegacyPhysicsAdapter.addBody: rigid body already exists", data.uuid);
            return;
        }

        this.engine.addRigidBody(data.uuid, shapeUuuid, rigidBodyType, options);
        if (!this.engine.hasRigidBody(data.uuid)) {
            return;
        }
        this.engine.setRigidBodyPosition(data.uuid, data.position);
        this.engine.setRigidBodyRotation(data.uuid, data.quaternion);

        // Apply non-unity scale
        if (data.scale && (data.scale.x !== 1 || data.scale.y !== 1 || data.scale.z !== 1)) {
            this.engine.setRigidBodyScale(data.uuid, data.scale);
        }

        if (data.rotationLock) {
            this.engine.setRigidBodyRotationLock(data.uuid, data.rotationLock);
        }

        super.addObject(data.uuid, data.mass, collisionFlag, object);
    }

    addTerrain(object: Object3D | null, data: TerrainData): void {
        if (this.engine.hasRigidBody(data.uuid)) {
            console.warn("LegacyPhysicsAdapter.addTerrain: rigid body already exists", data.uuid);
            return;
        }

        const shape = terrainDataToHeightfieldShape(data);
        this.engine.addShape(data.uuid, shape);
        if (!this.engine.hasShape(data.uuid)) {
            return;
        }

        const position = {
            x: data.position.x + shape.offset.x,
            y: data.position.y + shape.offset.y,
            z: data.position.z + shape.offset.z,
        };
        const options: RigidBodyOptions = {
            mass: 0,
            friction: data.friction,
            restitution: data.restitution,
            position,
            quaternion: data.quaternion,
        };

        this.engine.addRigidBody(data.uuid, data.uuid, RigidBodyType.Static, options);
        if (!this.engine.hasRigidBody(data.uuid)) {
            this.engine.removeShape(data.uuid);
            return;
        }

        const scale = data.scale ?? {x: 1, y: 1, z: 1};
        if (scale.x !== 1 || scale.y !== 1 || scale.z !== 1) {
            this.engine.setRigidBodyScale(data.uuid, scale);
        }
        if (object) {
            super.addObject(data.uuid, 0, CollisionFlag.STATIC, object);
        }
    }

    remove(uuid: string): void {
        // Remove requests are allowed to race backend creation/teardown. A
        // rejected shape (for example a dynamic concave hull) or an event
        // that arrived after the worker already disposed the body leaves no
        // primitive to remove. Avoid forwarding that normal idempotent
        // cleanup path to the backend, where it would produce one warning per
        // object and drown out actionable physics diagnostics.
        if (this.engine.hasRigidBody(uuid)) {
            this.engine.removeRigidBody(uuid);
        }
        super.removeObject(uuid);
    }

    removePrefab(uuid: string): void {
        this.remove(uuid);
    }

    addShape(uuid: string, collisionShape: CollisionShape): void {
        this.engine.addShape(uuid, collisionShape);
    }

    removeShape(uuid: string): void {
        this.engine.removeShape(uuid);
    }

    hasShape(uuid: string): boolean {
        return this.engine.hasShape(uuid);
    }

    setRigidBodyShape(uuid: string, newShapeUuid: string): void {
        this.engine.setRigidBodyShape(uuid, newShapeUuid);
    }

    applyImpulseToRigidBody(uuid: string, impulse: Vector3Like, relativePosition: Vector3Like): void {
        this.engine.applyImpulseToRigidBody(uuid, impulse, relativePosition);
    }

    applyCentralImpulse(uuid: string, impulse: Vector3): void {
        this.engine.applyImpulseToRigidBody(uuid, impulse);
    }

    /**
     * Applies a directional kick to nearby dynamic rigid bodies.
     *
     * The legacy API only carries the character UUID and impulse magnitude;
     * the adapter resolves the character-controller (or rigid-body) pose and
     * performs the small broad-phase query over primitive body UUIDs. Keeping
     * this here means Ammo and Rapier receive identical gameplay semantics and
     * worker callers do not depend on Three.js object references.
     */
    kickNearbyObjects(uuid: string, kickImpulse: number): void {
        const magnitude = Number(kickImpulse);
        if (!Number.isFinite(magnitude) || magnitude <= 0) {
            return;
        }

        const origin = this.engine.getCharacterControllerPosition(uuid) ?? this.engine.getRigidBodyPosition(uuid);
        if (!origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.y) || !Number.isFinite(origin.z)) {
            return;
        }

        const rotation = this.engine.getCharacterControllerRotation(uuid) ?? this.engine.getRigidBodyRotation(uuid);
        if (!rotation) {
            return;
        }

        this.kickOrigin.set(origin.x, origin.y, origin.z);
        this.kickRotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
        this.kickForward.set(0, 0, 1).applyQuaternion(this.kickRotation);
        this.kickForward.y = 0;
        if (this.kickForward.lengthSq() < KICK_DISTANCE_EPSILON_SQ) {
            return;
        }
        this.kickForward.normalize();

        const radiusSq = KICK_RADIUS * KICK_RADIUS;
        for (const targetUuid of this.engine.rigidBodyUuids()) {
            if (targetUuid === uuid || this.engine.getRigidBodyType(targetUuid) !== RigidBodyType.Dynamic) {
                continue;
            }

            const target = this.engine.getRigidBodyPosition(targetUuid);
            if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y) || !Number.isFinite(target.z)) {
                continue;
            }

            const verticalDelta = target.y - this.kickOrigin.y;
            if (Math.abs(verticalDelta) > KICK_VERTICAL_REACH) {
                continue;
            }

            this.kickToTarget.set(target.x - this.kickOrigin.x, 0, target.z - this.kickOrigin.z);
            const distanceSq = this.kickToTarget.lengthSq();
            if (distanceSq > radiusSq) {
                continue;
            }

            // A body occupying the character's origin is still a valid kick
            // target; use facing direction instead of an undefined radial one.
            const distance = Math.sqrt(distanceSq);
            const facingDot = distanceSq > KICK_DISTANCE_EPSILON_SQ
                ? this.kickToTarget.dot(this.kickForward) / distance
                : 1;
            if (facingDot < KICK_CONE_DOT) {
                continue;
            }

            const distanceFalloff = distance >= KICK_RADIUS ? 0 : 1 - distance / KICK_RADIUS;
            const scaledMagnitude = magnitude * (KICK_EDGE_FALLOFF + (1 - KICK_EDGE_FALLOFF) * distanceFalloff);
            this.kickImpulseVector.copy(this.kickForward).multiplyScalar(scaledMagnitude);
            this.kickImpulseVector.y = scaledMagnitude * KICK_VERTICAL_SCALE;
            this.engine.applyImpulseToRigidBody(targetUuid, this.kickImpulseVector);
        }
    }

    setOrigin(uuid: string, position: Vector3Like): void {
        if (this.engine.hasRigidBody(uuid)) {
            this.engine.setRigidBodyPosition(uuid, position);
        } else if (this.engine.hasCharacterController(uuid)) {
            this.engine.setCharacterControllerPosition(uuid, position);
        }
    }

    setRotation(uuid: string, quaternion: QuaternionLike): void {
        if (this.engine.hasRigidBody(uuid)) {
            this.engine.setRigidBodyRotation(uuid, quaternion);
        } else if (this.engine.hasCharacterController(uuid)) {
            this.engine.setCharacterControllerRotation(uuid, quaternion);
        }
    }

    setScale(uuid: string, scale: Vector3Like): void {
        this.engine.setRigidBodyScale(uuid, scale);
    }

    setAngularVelocity(uuid: string, velocity: Vector3) {
        this.engine.setRigidBodyAngularVelocity(uuid, velocity);
    }

    setLinearVelocity(uuid: string, velocity: Vector3): void {
        this.engine.setRigidBodyLinearVelocity(uuid, velocity);
    }

    getLinearVelocity(uuid: string): Vector3Like | null {
        return this.engine.getRigidBodyLinearVelocity(uuid);
    }

    getAngularVelocity(uuid: string): Vector3Like | null {
        return this.engine.getRigidBodyAngularVelocity(uuid);
    }

    setLinearDamping(uuid: string, damping: number): void {
        this.engine.setRigidBodyLinearDamping(uuid, damping);
    }

    setAngularDamping(uuid: string, damping: number): void {
        this.engine.setRigidBodyAngularDamping(uuid, damping);
    }

    addPlayerObject(uuid: string, useController: boolean, options?: IPlayerOptions): Promise<Object3D | null> {
        const shapeUuid = this.engine.getRigidBodyShapeUuid(uuid);
        if (!shapeUuid) {
            // A failed player setup must not leave a prior player entry alive.
            // Keep the existing rejection for callers that supplied an unknown
            // rigid body, but do not attempt any controller or body operations.
            this.players.delete(uuid);
            console.warn("addPlayerObject: failed to find player shape", uuid);
            return Promise.reject(new Error("Failed to find player shape"));
        }

        // Get the current rigid body position and rotation
        const position = this.engine.getRigidBodyPosition(uuid) || { x: 0, y: 0, z: 0 };
        const rotation = this.engine.getRigidBodyRotation(uuid) || { x: 0, y: 0, z: 0, w: 1 };

        // TODO: handle collider scale

        this.engine.addCharacterController(uuid, shapeUuid);
        // Character-controller creation is intentionally a no-op for unsupported
        // shapes (for example, concave hulls).  Only configure and replace the
        // rigid body after the backend confirms that the controller exists.
        // This preserves the original rigid body and avoids stale player state
        // when a controller is rejected.
        if (!this.engine.hasCharacterController(uuid)) {
            this.players.delete(uuid);
            return Promise.reject(new Error("Failed to add character controller"));
        }
        this.engine.setCharacterControllerPosition(uuid, position);
        this.engine.setCharacterControllerRotation(uuid, rotation);

        const gravity = options?.playerGravity ?? this.engine.getGravity() ?? DEFAULT_PLAYER_GRAVITY;
        const maxSlope = options?.maxSlope ?? DEFAULT_PLAYER_MAX_SLOPE;
        const stepHeight = options?.stepHeight ?? DEFAULT_PLAYER_STEP_HEIGHT;
        this.engine.setCharacterControllerMaxSlope(uuid, maxSlope * Math.PI / 180);
        this.engine.setCharacterControllerStepHeight(uuid, stepHeight);
        this.engine.setCharacterControllerGravity(uuid, { x: 0, y: gravity, z: 0 });

        // Calculate jump speed based on jump height and gravity
        const jumpHeight = options?.jumpHeight ?? DEFAULT_PLAYER_JUMP_HEIGHT;
        const jumpSpeed = Math.sqrt(2 * Math.abs(gravity) * jumpHeight);

        this.engine.removeRigidBody(uuid);

        this.players.set(uuid, {
            gravity,
            jumpSpeed,
            isJumping: false,
            pushObjects: options?.pushObjects ?? true,
            pushImpulse: Math.max(0, options?.pushImpulse ?? 1),
            pushVerticalScale: options?.pushVerticalScale ?? 0,
            walkVelocity: { x: 0, y: 0, z: 0 },
        });

        return Promise.resolve(null);
    }

    removePlayerObject(uuid: string): void {
        this.engine.removeCharacterController(uuid);
        this.players.delete(uuid);
    }

    movePlayerObject(uuid: string, walkDirection: Vector3, jump: boolean): void {
        const player = this.players.get(uuid);
        if (!player) {
            console.warn("movePlayerObject: failed to find player", uuid);
            return;
        }

        const deltaTime = 1.0 / 60.0;
        // Fold platform carry (from setPlayerSpeedAdjustment) into the
        // velocity we hand to the engine. Matches AmmoPhysics.ts's
        // walkDirection + speedAdjustment pattern — no separate
        // engine-side platform channel.
        player.walkVelocity.x = (walkDirection.x + this.playerSpeedAdjustment.x) / deltaTime;
        player.walkVelocity.y = (walkDirection.y + this.playerSpeedAdjustment.y) / deltaTime;
        player.walkVelocity.z = (walkDirection.z + this.playerSpeedAdjustment.z) / deltaTime;

        this.engine.setCharacterControllerWalkVelocity(uuid, player.walkVelocity);

        if (jump && !player.isJumping) {
            const accepted = this.engine.jumpCharacterController(uuid, player.jumpSpeed);
            if (accepted) {
                player.isJumping = true;
            }
        }
    }

    setPlayerGravity(uuid: string, acceleration: Vector3Like): void {
        const player = this.players.get(uuid);
        if (!player) {
            console.warn("setPlayerGravity: failed to find player", uuid);
            return;
        }

        // TODO: Currently only the Y component is used
        player.gravity = acceleration.y;
        this.engine.setCharacterControllerGravity(uuid, { x: 0, y: acceleration.y, z: 0 });
    }

    setPlayerPosition(uuid: string, position: Vector3): void {
        this.engine.setCharacterControllerPosition(uuid, position);
    }

    setPlayerSpeedAdjustment(uuid: string, speedAdjustment: Vector3): void {
        // Stash the adjustment; movePlayerObject folds it into the next
        // velocity it hands to the engine. `uuid` is currently ignored —
        // the adjustment applies globally, matching legacy behavior.
        this.playerSpeedAdjustment.x = speedAdjustment.x;
        this.playerSpeedAdjustment.y = speedAdjustment.y;
        this.playerSpeedAdjustment.z = speedAdjustment.z;
    }

    applyImpulseToPlayer(uuid: string, impulse: Vector3): void {
        if (!this.players.has(uuid)) {
            console.warn("applyImpulseToPlayer: failed to find player", uuid);
            return;
        }

        this.engine.applyImpulseToCharacterController(uuid, impulse);
    }

    addVehicleObject(vehicleUuid: string, spec: VehicleSpec, options: VehicleOptions): Promise<void> {
        // VehicleSpec extends VehicleData, so it's assignable to the
        // engine's addVehicle parameter; the engine only sees the
        // pure-data fields.
        this.engine.addVehicle(vehicleUuid, spec, options);

        // Track visual objects for transform dispatch
        if (spec.chassisObject) {
            super.addObject(spec.chassisObjectUuid, 1, CollisionFlag.DYNAMIC, spec.chassisObject);
        }
        for (const wheel of spec.wheels) {
            if (wheel.wheelObject && wheel.wheelObjectUuid) {
                super.addObject(wheel.wheelObjectUuid, 1, CollisionFlag.DYNAMIC, wheel.wheelObject);
            }
        }

        this.vehicleVisualData.set(vehicleUuid, {
            chassisVisualUuid: spec.chassisObjectUuid,
            wheelVisualUuids: spec.wheels.map(w => w.wheelObjectUuid ?? ""),
        });

        return Promise.resolve();
    }

    removeVehicleObject(vehicleUuid: string): void {
        const visualData = this.vehicleVisualData.get(vehicleUuid);
        if (visualData) {
            super.removeObject(visualData.chassisVisualUuid);
            for (const wheelUuid of visualData.wheelVisualUuids) {
                if (wheelUuid) super.removeObject(wheelUuid);
            }
            this.vehicleVisualData.delete(vehicleUuid);
        }

        this.engine.removeVehicle(vehicleUuid);
    }

    moveVehicleObject(vehicleUuid: string, input: VehicleInput): void {
        this.engine.setVehicleInput(vehicleUuid, input);
    }

    addCollidableObject(uuid: string): void {
        this.collidableUuids.add(uuid);
    }

    removeCollidableObject(uuid: string): void {
        this.collidableUuids.delete(uuid);
    }

    detectCollisionsForObject(uuid: string, listener: CollisionRegistration, enable: boolean): void {
        if (enable) {
            let arr = this.collisionListeners.get(uuid);
            if (!arr) {
                arr = [];
                this.collisionListeners.set(uuid, arr);
            }
            arr.push(listener);
        } else {
            const arr = this.collisionListeners.get(uuid);
            if (arr) {
                if (listener.id) {
                    let writeIndex = 0;
                    for (let readIndex = 0; readIndex < arr.length; readIndex++) {
                        const registeredListener = arr[readIndex]!;
                        if (registeredListener.id !== listener.id) {
                            arr[writeIndex++] = registeredListener;
                        }
                    }
                    arr.length = writeIndex;
                    if (arr.length === 0) {
                        this.collisionListeners.delete(uuid);
                    }
                } else {
                    this.collisionListeners.delete(uuid);
                }
            }
        }
    }

    setCollisionBehavior(uuid: string, behavior: CollisionBehavior): void {
        if (this.engine.hasRigidBody(uuid)) {
            this.engine.setRigidBodyCollisionBehavior(uuid, behavior);
        } else if (this.engine.hasCharacterController(uuid)) {
            this.engine.setCharacterControllerCollisionBehavior(uuid, behavior);
        }
    }

    setCurrentAnimation(/* uuid: string, animation: string */): void {
        // Not implemented
    }

    addOtsShiftVector(): void {
        // Not implemented
    }

    addFixedJoint(
        collisionEnabled: boolean,
        uuidA: string,
        uuidB: string,
        vec3PivotB: Vector3,
        vec4RotationB: QuaternionLike,
    ): void {
        this.engine.addFixedJoint({
            collisionEnabled,
            uuidA,
            uuidB,
            pivotB: vec3PivotB,
            rotationB: vec4RotationB,
        });
    }

    addHingeJoint(
        collisionEnabled: boolean,
        uuidA: string,
        uuidB: string,
        hingeAxis: Vector3Like,
        relPos: Vector3Like,
        relRotation: QuaternionLike,
        angularLimitEnabled: boolean,
        angularLimit: Vector3Like,
        motorEnabled: boolean,
        motorSpeed: number,
        motorTorque: number,
    ): void {
        this.engine.addHingeJoint({
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
            motorTorque,
        });
    }

    addPoint2PointJoint(
        collisionEnabled: boolean,
        uuidA: string,
        vec3PivotA: Vector3,
        uuidB: string,
        vec3PivotB: Vector3,
    ): void {
        this.engine.addPointToPointJoint({
            collisionEnabled,
            uuidA,
            pivotA: vec3PivotA,
            uuidB,
            pivotB: vec3PivotB,
        });
    }

    removeJoint(uuidA: string, uuidB: string): void {
        this.engine.removeJoint(uuidA, uuidB);
    }

    private dispatchCollisionEvents(): void {
        for (const pairsBySecondUuid of this.contactPairs.values()) {
            for (const {uuid1, uuid2} of pairsBySecondUuid.values()) {
                this.dispatchCollision(uuid1, uuid2);
            }
        }
    }

    private dispatchCollision(uuid1: string, uuid2: string): void {
        this.dispatchCollisionPass(uuid1, uuid2);
        this.dispatchCollisionPass(uuid2, uuid1);
    }

    private dispatchCollisionPass(sourceUuid: string, targetUuid: string): void {
        const listeners = this.collisionListeners.get(sourceUuid);
        if (!listeners?.length) {
            return;
        }

        for (let i = 0; i < listeners.length; i++) {
            const listener = listeners[i]!;
            switch (listener.type) {
                case COLLISION_TYPE.WITH_PLAYER:
                    if (!this.players.has(targetUuid)) {
                        continue;
                    }
                    break;

                case COLLISION_TYPE.WITH_COLLIDABLE_OBJECTS:
                    if (!this.collidableUuids.has(targetUuid)) {
                        continue;
                    }
                    break;
            }

            this.dispatcher.onCollision(sourceUuid, listener.id);
        }
    }

    private handleCollision(event: CollisionEvent): void {
        const {uuid1, uuid2, started} = event;
        const firstUuid = uuid1 <= uuid2 ? uuid1 : uuid2;
        const secondUuid = uuid1 <= uuid2 ? uuid2 : uuid1;
        if (started) {
            let pairsBySecondUuid = this.contactPairs.get(firstUuid);
            if (!pairsBySecondUuid) {
                pairsBySecondUuid = new Map();
                this.contactPairs.set(firstUuid, pairsBySecondUuid);
            }
            pairsBySecondUuid.set(secondUuid, {uuid1, uuid2});
            this.applyCharacterPushImpulse(event);
        } else {
            const pairsBySecondUuid = this.contactPairs.get(firstUuid);
            pairsBySecondUuid?.delete(secondUuid);
            if (pairsBySecondUuid?.size === 0) {
                this.contactPairs.delete(firstUuid);
            }
        }
    }

    private applyCharacterPushImpulse(event: CollisionEvent): void {
        let characterUuid: string | null = null;
        let rigidBodyUuid: string | null = null;

        if (event.type1 === "characterController" && event.type2 === "rigidBody") {
            characterUuid = event.uuid1;
            rigidBodyUuid = event.uuid2;
        } else if (event.type2 === "characterController" && event.type1 === "rigidBody") {
            characterUuid = event.uuid2;
            rigidBodyUuid = event.uuid1;
        }

        if (!characterUuid || !rigidBodyUuid) {
            return;
        }

        const player = this.players.get(characterUuid);
        if (!player?.pushObjects) {
            return;
        }

        if (this.engine.getRigidBodyType(rigidBodyUuid) !== RigidBodyType.Dynamic) {
            return;
        }

        const playerSpeed = Math.hypot(player.walkVelocity.x, player.walkVelocity.z);
        if (playerSpeed < PUSH_MIN_PLAYER_SPEED) {
            return;
        }

        const rigidBodyPosition = this.engine.getRigidBodyPosition(rigidBodyUuid);
        if (!rigidBodyPosition) {
            return;
        }

        // PRIMARY: player's walk velocity direction
        const pushDirection = this.pushDirection.set(player.walkVelocity.x, 0, player.walkVelocity.z);

        // FALLBACK: center-to-center
        if (pushDirection.lengthSq() < PUSH_DIRECTION_EPSILON) {
            const playerPosition = this.engine.getCharacterControllerPosition(characterUuid);
            if (!playerPosition) {
                return;
            }
            pushDirection.set(
                rigidBodyPosition.x - playerPosition.x, 0,
                rigidBodyPosition.z - playerPosition.z,
            );
            if (pushDirection.lengthSq() < PUSH_DIRECTION_EPSILON) {
                return;
            }
        }

        pushDirection.normalize();

        // Relative velocity: don't push objects already moving away
        const targetVel = this.engine.getRigidBodyLinearVelocity(rigidBodyUuid);
        const relSpeed = targetVel
            ? playerSpeed - (targetVel.x * pushDirection.x + targetVel.z * pushDirection.z)
            : playerSpeed;
        if (relSpeed <= 0) {
            return;
        }

        // Read material properties from the target object's userData
        const targetObject = this.getDynamicBodyObject(rigidBodyUuid);
        const physicsData = targetObject?.userData?.physics;
        const friction = Math.max(0, Math.min(1, Number(physicsData?.friction) || 0.5));
        const restitution = Math.max(0, Math.min(1, Number(physicsData?.restitution) || 0.5));
        const contactDamping = Math.max(0, Math.min(1, Number(physicsData?.contactDamping) || 0.2));

        const playerMass = this.getObjectMass(characterUuid);
        const rigidBodyMass = this.getObjectMass(rigidBodyUuid);
        const massRatio = playerMass / Math.max(playerMass + rigidBodyMass, 0.0001);
        const pushImpulseScale = Math.max(0, player.pushImpulse);
        const baseMagnitude = Math.min(PUSH_IMPULSE_MAX, Math.max(PUSH_IMPULSE_MIN, relSpeed * massRatio * PUSH_SPEED_TO_IMPULSE)) * pushImpulseScale;

        // Material damping reduces overall impulse
        const magnitude = baseMagnitude * (1 - contactDamping * PUSH_DAMPING_FACTOR);
        if (magnitude <= 0) {
            return;
        }

        // Bounce from contact normal, scaled by restitution + character vertical scale
        const contactNormal = event.contactNormal;
        const bounceY = contactNormal ? contactNormal.y * magnitude * (restitution + player.pushVerticalScale) : 0;

        const impulse = {
            x: pushDirection.x * magnitude,
            y: bounceY,
            z: pushDirection.z * magnitude,
        };

        // Friction-scaled spin: interpolate between center and contact point
        const contactPoint = event.contactPoint;
        if (contactPoint && friction > PUSH_FRICTION_THRESHOLD) {
            // For Rapier, applyImpulseAtPoint accepts a world-space point
            const worldPoint = {
                x: rigidBodyPosition.x + (contactPoint.x - rigidBodyPosition.x) * friction,
                y: rigidBodyPosition.y + (contactPoint.y - rigidBodyPosition.y) * friction,
                z: rigidBodyPosition.z + (contactPoint.z - rigidBodyPosition.z) * friction,
            };
            this.engine.applyImpulseToRigidBody(rigidBodyUuid, impulse, worldPoint);
        } else {
            this.engine.applyImpulseToRigidBody(rigidBodyUuid, impulse);
        }
    }

    private getObjectMass(uuid: string): number {
        const object = this.getDynamicBodyObject(uuid);
        const rawMass = Number(object?.userData?.physics?.mass);
        return Number.isFinite(rawMass) && rawMass > 0 ? rawMass : 1;
    }

    private pruneContactPairs() {
        // Prune contact pairs where one or both objects have been removed
        for (const [firstUuid, pairsBySecondUuid] of this.contactPairs) {
            for (const [secondUuid, {uuid1, uuid2}] of pairsBySecondUuid) {
                const exists1 = this.engine.hasRigidBody(uuid1) || this.engine.hasCharacterController(uuid1);
                const exists2 = this.engine.hasRigidBody(uuid2) || this.engine.hasCharacterController(uuid2);
                if (!exists1 || !exists2) {
                    pairsBySecondUuid.delete(secondUuid);
                }
            }
            if (pairsBySecondUuid.size === 0) {
                this.contactPairs.delete(firstUuid);
            }
        }
    }

    private simulatePlayerPostStep(uuid: string): void {
        const player = this.players.get(uuid);
        if (!player) {
            console.warn("simulatePlayerPostStep: failed to find player", uuid);
            return;
        }

        // Clear the animation-side jumping flag once the engine reports
        // the character is back on the ground. The engine owns the
        // vertical-velocity state now; we just mirror the landing
        // transition so the dispatcher can gate onGround reporting.
        if (player.isJumping && this.engine.isCharacterControllerOnGround(uuid)) {
            player.isJumping = false;
        }
    }
}
