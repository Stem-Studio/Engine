import type {QuaternionLike, Vector3Like} from "three";

import {
    CollisionBehavior,
    CollisionShape,
    FixedJointOptions,
    HingeJointOptions,
    PointToPointJointOptions,
    VehicleData,
    VehicleInput,
    VehicleOptions,
    PhysicsDebugRenderData,
} from './common/types';

export interface CollisionEvent {
    type1: 'rigidBody' | 'characterController';
    uuid1: string;
    group1: number;

    type2: 'rigidBody' | 'characterController';
    uuid2: string;
    group2: number;

    /** Indicates whether the collision started or ended */
    started: boolean;

    /** World-space contact point (optional, available for character-controller collisions) */
    contactPoint?: { x: number; y: number; z: number };

    /** World-space contact normal (optional, points from body1 toward body2) */
    contactNormal?: { x: number; y: number; z: number };
}

export type CollisionCallback = (event: CollisionEvent) => void;

export enum RigidBodyType {
    Dynamic = 'dynamic',
    Kinematic = 'kinematic',
    Static = 'static',
}

export interface RigidBodyOptions {
    mass?: number;
    friction?: number;
    restitution?: number;
    linearDamping?: number;
    angularDamping?: number;

    /** Bitmask specifying the collision group(s) of the rigid body */
    collisionGroup?: number;

    /** Bitmask specifying which collision groups the rigid body collides with */
    collisionMask?: number;

    /** Initial world position — avoids post-creation move for static bodies */
    position?: {x: number; y: number; z: number};

    /** Initial world rotation — avoids post-creation move for static bodies */
    quaternion?: {x: number; y: number; z: number; w: number};

    /** Enable continuous collision detection for fast-moving dynamic bodies. */
    ccd?: boolean;
    /** Allow idle dynamic bodies to sleep; enabled by default for performance. */
    allowSleep?: boolean;
    /** CCD motion threshold in world units; Rapier maps this to soft-CCD prediction distance. */
    ccdMotionThreshold?: number;
    /** Bullet swept-sphere radius in world units; Rapier includes it in soft-CCD prediction distance. */
    ccdSweptSphereRadius?: number;
}

export interface PhysicsEngine {
    /** The duration of a single physics step */
    stepDuration: number;

    ////////////////////////////////////////////////////////////////////////////
    // Lifecycle methods
    ////////////////////////////////////////////////////////////////////////////

    /**
     * Disposes of the physics engine and releases any resources.
     * 
     * @remarks
     * The physics engine should not be used after calling this method.
     */
    dispose(): void;

    ////////////////////////////////////////////////////////////////////////////
    // World methods
    ////////////////////////////////////////////////////////////////////////////

    /** Returns the acceleration due to gravity. */
    getGravity(): number;

    /** Update the bounded constraint-solver quality without recreating the world. */
    setSolverIterations?(solverIterations: number): void;
    
    /**
     * Steps the physics simulation.
     * 
     * @param onCollision A function to call when a collision occurs.
     */
    simulate(onCollision?: CollisionCallback): void;

    /**
     * Pauses the physics simulation.
     * 
     * @remarks
     * The physics simulation can be resumed by calling the {@link resume}
     * method. Any calls to {@link simulate} while the physics engine is paused
     * will be ignored.
     */
    pause(): void;

    /**
     * Resumes the physics simulation.
     * 
     * @remarks
     * The physics simulation can be paused by calling the {@link pause}
     * method. Any calls to {@link simulate} while the physics engine is paused
     * will be ignored.
     */
    resume(): void;

    /** Returns a copy of the current collision wireframe when debug drawing is enabled. */
    getDebugRenderData?(): PhysicsDebugRenderData | null;

    ////////////////////////////////////////////////////////////////////////////
    // Rigid body methods
    ////////////////////////////////////////////////////////////////////////////

    /**
     * Adds a rigid body to the physics engine.
     *
     * @param uuid - The UUID of the rigid body
     * @param shapeUuid - The UUID of the collision shape to use for the rigid body
     * @param type - The type of the rigid body ('static', 'dynamic', or 'kinematic')
     * @param options - Additional options for the rigid body (e.g., mass, friction)
     * 
     * @remarks
     * The collision shape with the given `shapeUuid` must have been added
     * previously using the {@link addShape} method.
     */
    addRigidBody(
        uuid: string,
        shapeUuid: string,
        type: RigidBodyType,
        options?: RigidBodyOptions,
    ): void;
    
    /**
     * Removes a rigid body from the physics engine.
     *
     * @param uuid - The UUID of the rigid body to remove
     */
    removeRigidBody(uuid: string): void;

    /**
     * Indicates whether a rigid body with the given UUID exists.
     * 
     * @param uuid - The UUID of the rigid body to check
     * @returns `true` if a rigid body with the given UUID exists, `false`
     * otherwise.
     */
    hasRigidBody(uuid: string): boolean;

    /**
     * Returns an iterator over the UUIDs of all rigid bodies in the physics
     * engine.
     * 
     * @returns An iterator over the UUIDs of all rigid bodies in the physics
     * engine
     */
    rigidBodyUuids(): IterableIterator<string>;
    
    applyImpulseToRigidBody(uuid: string, impulse: Vector3Like, relativePosition?: Vector3Like): void;

    getRigidBodyLinearVelocity(uuid: string): Vector3Like | null;
    getRigidBodyAngularVelocity(uuid: string): Vector3Like | null;
    getRigidBodyPosition(uuid: string): Vector3Like | null;
    getRigidBodyRotation(uuid: string): QuaternionLike | null;

    /**
     * Get the UUID of the collision shape used by the given rigid body.
     * 
     * @param uuid - The UUID of the rigid body
     * @returns The UUID of the collision shape used by the rigid body, or
     * `null` if no such rigid body exists.
     */
    getRigidBodyShapeUuid(uuid: string): string | null;

    getRigidBodyType(uuid: string): RigidBodyType | null;
    setRigidBodyCollisionBehavior(uuid: string, behavior: CollisionBehavior): void;
    setRigidBodyCollisionMasks(uuid: string, collisionGroup: number, collisionMask: number): void;
    setRigidBodyAngularVelocity(uuid: string, velocity: Vector3Like): void;
    setRigidBodyLinearVelocity(uuid: string, velocity: Vector3Like): void;
    setRigidBodyPosition(uuid: string, position: Vector3Like): void;
    setRigidBodyRotation(uuid: string, quaternion: QuaternionLike): void;
    setRigidBodyLinearDamping(uuid: string, damping: number): void;
    setRigidBodyAngularDamping(uuid: string, damping: number): void;
    setRigidBodyRotationLock(uuid: string, lock: { x: boolean; y: boolean; z: boolean }): void;

    /**
     * Scale the collision shape of a rigid body.
     *
     * @remarks
     * This method scales the collision shape associated with a rigid body.
     *
     * Note: Non-uniform scaling may not work correctly for all shape types
     * (e.g., spheres and capsules). Use uniform scaling when possible.
     * 
     * Scaling may not be supported for all shape types. For example, scaling of
     * convex and concave hulls may not be supported, depending on the
     * underlying physics engine.
     *
     * @param uuid - The UUID of the rigid body
     * @param scale - The scale factors for each axis
     */
    setRigidBodyScale(uuid: string, scale: Vector3Like): void;

    /**
     * Replace the collision shape used by a rigid body.
     *
     * @remarks
     * This method preserves the body's position, rotation, velocity, and other
     * properties while replacing its collision shape. The new shape must have
     * been added previously using the {@link addShape} method.
     *
     * The old shape's reference count is decremented, potentially freeing it
     * if no other bodies use it.
     *
     * @param uuid - The UUID of the rigid body
     * @param newShapeUuid - The UUID of the new collision shape
     */
    setRigidBodyShape(uuid: string, newShapeUuid: string): void;

    ////////////////////////////////////////////////////////////////////////////
    // Shape methods
    ////////////////////////////////////////////////////////////////////////////

    /**
     * Adds a collision shape to the physics engine.
     * 
     * @remarks
     * If a shape with the given UUID already exists, this method does nothing.
     * This includes shapes that have been marked for removal but are still in
     * use by a rigid body.
     * 
     * The shape can be associated with any number of rigid bodies using the
     * {@link addRigidBody} method.
     * 
     * The shape can be marked for removal using the {@link removeShape} method.
     * 
     * @param uuid - The UUID of the collision shape
     * @param collisionShape - The collision shape to add
     * @param autoRemove 
     */
    addShape(uuid: string, collisionShape: CollisionShape): void;

    /**
     * Marks a collision shape for removal.
     * 
     * @remarks
     * If no shape with the given UUID exists, this method does nothing.
     * 
     * If the shape is associated with any rigid bodies, the shape will not be
     * removed until all rigid bodies using the shape have been removed.
     * 
     * @param uuid - The UUID of the collision shape to remove
     */
    removeShape(uuid: string): void;

    /**
     * Indicates whether a collision shape with the given UUID exists.
     * 
     * @remarks
     * If a shape with the given UUID has been marked for removal but is still
     * in use by a rigid body, this method returns `true`.
     * 
     * @param uuid - The UUID of the collision shape to check
     */
    hasShape(uuid: string): boolean;

    ////////////////////////////////////////////////////////////////////////////
    // Character controller methods
    ////////////////////////////////////////////////////////////////////////////
    addCharacterController(uuid: string, shapeUuid: string): void;
    removeCharacterController(uuid: string): void;
    hasCharacterController(uuid: string): boolean;
    characterControllerUuids(): IterableIterator<string>;
    getCharacterControllerLinearVelocity(uuid: string): Vector3Like | null;
    getCharacterControllerPosition(uuid: string): Vector3Like | null;
    getCharacterControllerRotation(uuid: string): QuaternionLike | null;
    isCharacterControllerOnGround(uuid: string): boolean;
    setCharacterControllerCollisionBehavior(uuid: string, behavior: CollisionBehavior): void;
    setCharacterControllerMaxSlope(uuid: string, maxSlope: number): void;
    setCharacterControllerPosition(uuid: string, position: Vector3Like): void;
    setCharacterControllerRotation(uuid: string, quaternion: QuaternionLike): void;
    setCharacterControllerStepHeight(uuid: string, stepHeight: number): void;

    /**
     * Set the continuous gravitational acceleration the engine applies to
     * this character. Units: meters/second². For standard Earth-like
     * gravity, pass `(0, -9.8, 0)`. Each engine integrates this into its
     * character controller's internal vertical velocity every step;
     * callers should NOT integrate gravity themselves on top.
     */
    setCharacterControllerGravity(uuid: string, gravity: Vector3Like): void;

    /**
     * Set the character's caller-supplied walk velocity — the motion
     * the controller receives each step on top of engine-integrated
     * gravity, jump, and impulse. Units: meters/second. All three
     * components (x/y/z) are honored; callers use the y component for
     * platform carry or other externally-driven vertical motion.
     */
    setCharacterControllerWalkVelocity(uuid: string, velocity: Vector3Like): void;

    /**
     * Trigger a jump on the character. Sets the character's internal
     * vertical velocity to `jumpSpeed` (meters/second, positive = upward)
     * if the character is currently on the ground. Returns true if the
     * jump was accepted, false if the character was airborne or already
     * jumping.
     */
    jumpCharacterController(uuid: string, jumpSpeed: number): boolean;

    /**
     * Apply an instantaneous velocity impulse to the character's
     * engine-owned vertical velocity. Units: meters/second. Unlike
     * `jumpCharacterController`, this always applies, regardless of
     * whether the character is grounded — used by jump pads and other
     * airborne velocity injections. Only the y component is used today.
     */
    applyImpulseToCharacterController(uuid: string, impulse: Vector3Like): void;

    ////////////////////////////////////////////////////////////////////////////
    // Vehicle methods
    ////////////////////////////////////////////////////////////////////////////
    addVehicle(vehicleUuid: string, spec: VehicleData, options: VehicleOptions): void;
    removeVehicle(vehicleUuid: string): void;
    hasVehicle(vehicleUuid: string): boolean;
    vehicleUuids(): IterableIterator<string>;
    setVehicleInput(vehicleUuid: string, input: VehicleInput): void;
    getVehicleChassisPosition(vehicleUuid: string): Vector3Like | null;
    getVehicleChassisRotation(vehicleUuid: string): QuaternionLike | null;
    getVehicleWheelTransform(vehicleUuid: string, wheelIndex: number): {position: Vector3Like; rotation: QuaternionLike} | null;
    getVehicleWheelCount(vehicleUuid: string): number;

    ////////////////////////////////////////////////////////////////////////////
    // Joint methods
    ////////////////////////////////////////////////////////////////////////////
    addFixedJoint(options: FixedJointOptions): void;
    addHingeJoint(options: HingeJointOptions): void;
    addPointToPointJoint(options: PointToPointJointOptions): void;
    removeJoint(uuidA: string, uuidB: string): void;
}

export const DEFAULT_CHARACTER_CONTROLLER_COLLISION_GROUP = 2;
export const DEFAULT_CHARACTER_CONTROLLER_COLLISION_MASK = 0xffff;
export const DEFAULT_CHARACTER_CONTROLLER_MAX_SLOPE = 60 * Math.PI / 180;
export const DEFAULT_CHARACTER_CONTROLLER_STEP_HEIGHT = 0.5;
/**
 * How far below a character's current position an engine may probe to snap
 * them back to the ground when they drift airborne (e.g., walking down a
 * ramp faster than stepDown can track). Reusing the step height keeps the
 * snap as strong as the controller's native stepping capability.
 */
export const DEFAULT_CHARACTER_CONTROLLER_SNAP_DISTANCE = DEFAULT_CHARACTER_CONTROLLER_STEP_HEIGHT;

export const DEFAULT_GRAVITY = -9.81;

export const DEFAULT_RIGID_BODY_FRICTION = 0.5;
export const DEFAULT_RIGID_BODY_MASS = 0.0;
export const DEFAULT_RIGID_BODY_RESTITUTION = 0.5;
export const DEFAULT_RIGID_BODY_LINEAR_DAMPING = 0.0;
export const DEFAULT_RIGID_BODY_ANGULAR_DAMPING = 0.0;
export const DEFAULT_RIGID_BODY_COLLISION_GROUP = 1;
export const DEFAULT_RIGID_BODY_COLLISION_MASK = 0xffff;
export const DEFAULT_RIGID_BODY_CCD_MOTION_THRESHOLD = 0.5;
export const DEFAULT_RIGID_BODY_CCD_SWEPT_SPHERE_RADIUS = 0.2;

export const DEFAULT_STEP_DURATION = 1 / 60;
