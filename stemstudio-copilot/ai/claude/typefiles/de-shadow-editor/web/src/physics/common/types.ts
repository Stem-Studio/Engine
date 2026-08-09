import {Object3D, Vector3} from "three";
import {QuaternionLike, Vector3Like} from "three/webgpu";

import {COLLISION_TYPE} from "../../types/editor";

export type CollisionData = {
    uuid: string;
    listenerId: string;
};

export interface ICollisionSource {
    //consumeCollisionUpdates(out: CollisionData[]): void;
    addCollisionListener(listener: (collision: CollisionData) => void): void;
}

export enum CollisionBehavior {
    /** Does not respond to collisions but triggers callbacks */
    Ghost = 'ghost',

    /** Responds to collisions and triggers callbacks */
    Regular = 'regular',
}

/**
 * Options for `addFixedJoint`. Welds two bodies so B's frame is held
 * fixed relative to A.
 */
export interface FixedJointOptions {
    /** Whether the two bodies continue to collide through the joint. */
    collisionEnabled: boolean;
    uuidA: string;
    uuidB: string;
    /** B's origin expressed in A's local frame. */
    pivotB: Vector3Like;
    /** B's rotation expressed in A's local frame. */
    rotationB: QuaternionLike;
}

/**
 * Options for `addHingeJoint` (aka revolute joint). Rotates around
 * `hingeAxis` in A's local frame; optionally constrained to an angular
 * range and optionally driven by a motor.
 */
export interface HingeJointOptions {
    collisionEnabled: boolean;
    uuidA: string;
    uuidB: string;
    /** Hinge axis in A's local frame. */
    hingeAxis: Vector3Like;
    /** B's origin expressed in A's local frame. */
    relPos: Vector3Like;
    /** B's rotation expressed in A's local frame. */
    relRotation: QuaternionLike;
    angularLimitEnabled: boolean;
    /** `(min, max)` in degrees packed into x/y; z is ignored. */
    angularLimit: Vector3Like;
    motorEnabled: boolean;
    /** Target angular speed in radians/second. */
    motorSpeed: number;
    /** Maximum torque the motor can apply. Units are engine-specific. */
    motorTorque: number;
}

/**
 * Options for `addPointToPointJoint` (aka ball-socket joint). Keeps
 * two pivot points coincident while allowing free rotation.
 */
export interface PointToPointJointOptions {
    collisionEnabled: boolean;
    uuidA: string;
    /** Pivot in A's local frame. */
    pivotA: Vector3Like;
    uuidB: string;
    /** Pivot in B's local frame. */
    pivotB: Vector3Like;
}

export interface IPhysics {
    //physics type
    isMultiplayer(): boolean;
    isWorker(): boolean;
    isLocal(): boolean;
    // world
    getGravity(): number;
    //local cache
    addObject(uuid: string, mass: number, collisionFlag: CollisionFlag, object: Object3D): CollisionFlag;
    removeObject(uuid: string): void;
    getDynamicBodyObject(uuid: string): Object3D | undefined;
    getKinematicBodyObjects(): Map<string, Object3D>;
    //generic
    start(): Promise<void>;
    terminate(): void;
    simulate(deltaTime: number): void;
    pause(): void;
    resume(): void;
    initDebug(): Object3D | null;
    ping(): Promise<void>; //checks that physics has processed all events and ready for more
    //joints
    addFixedJoint(collisionEnabled: boolean, uuidA: string, uuidB: string, vec3PivotB: Vector3, vec4RotationB: QuaternionLike): void;
    addHingeJoint(collisionEnabled: boolean, uuidA: string, uuidB: string,
                  hingeAxis: Vector3Like, relPos: Vector3Like, relRotation: QuaternionLike,
                  angularLimitEnabled: boolean, angularLimit: Vector3Like,
                  motorEnabled: boolean, motorSpeed: number, motorTorque: number): void;
    addPoint2PointJoint(collisionEnabled: boolean, uuidA: string, vec3PivotA: Vector3, uuidB: string, vec3PivotB: Vector3): void;
    removeJoint(uuidA: string, uuidB: string): void;
    //objects
    add(object: Object3D): void;
    remove(uuid: string): void;
    //rigid bodies
    addBody(object: Object3D | null, shapeUuuid: string, data: CommonData): void;
    addBox(object: Object3D | null, data: BoxData): void;
    addSphere(object: Object3D | null, data: SphereData): void;
    addConcaveHull(object: Object3D | null, data: ConcaveHullData): void;
    addConvexHull(object: Object3D | null, data: ConvexHullData): void;
    addCapsuleShape(object: Object3D | null, data: CapsuleData): void;
    /** @deprecated */
    addModel(object: Object3D | null, data: ModelData): void;
    /** @deprecated */
    addTerrain(object: Object3D | null, data: TerrainData): void;
    removePrefab(uuid: string): void;
    //shapes
    addShape(uuid: string, collisionShape: CollisionShape): void;
    removeShape(uuid: string): void;
    hasShape(uuid: string): boolean;
    setRigidBodyShape(uuid: string, newShapeUuid: string): void;
    //force, velocity, etc
    applyCentralImpulse(uuid: string, impulse: Vector3): void;
    //rotation, position
    setOrigin(uuid: string, position: Vector3Like): void;
    setRotation(uuid: string, quaternion: QuaternionLike): void;
    /** @deprecated */
    setScale(uuid: string, scale: Vector3Like): void;
    applyImpulseToRigidBody(uuid: string, impulse: Vector3, relativePosition: Vector3): void;
    setAngularVelocity(uuid: string, velocity: Vector3): void;
    setLinearVelocity(uuid: string, velocity: Vector3): void;
    getLinearVelocity(uuid: string): Vector3Like | null;
    getAngularVelocity(uuid: string): Vector3Like | null;
    setLinearDamping(uuid: string, damping: number): void;
    setAngularDamping(uuid: string, damping: number): void;
    //character
    addPlayerObject(uuid: string, useController: boolean, options?: IPlayerOptions): Promise<Object3D | null>;
    removePlayerObject(uuid: string): void;
    movePlayerObject(uuid: string, walkDirection: Vector3, jump: boolean): void;
    setPlayerGravity(uuid: string, acceleration: Vector3Like): void;
    setPlayerSpeedAdjustment(uuid: string, speedAdjustment: Vector3): void;
    setPlayerPosition(uuid: string, position: Vector3): void;
    applyImpulseToPlayer(uuid: string, impulse: Vector3): void;
    //vehicle
    addVehicleObject(vehicleUuid: string, spec: VehicleSpec, options: VehicleOptions): Promise<void>;
    removeVehicleObject(vehicleUuid: string): void;
    moveVehicleObject(vehicleUuid: string, input: VehicleInput): void;
    //collisions
    addCollidableObject(uuid: string): void;
    removeCollidableObject(uuid: string): void;
    detectCollisionsForObject(uuid: string, registration: CollisionRegistration, enable: boolean): void;
    setCollisionBehavior(uuid: string, behavior: CollisionBehavior): void;
    kickNearbyObjects(uuid: string, kickImpulse: number): void;
    //MP specific
    setCurrentAnimation(uuid: string, animation: string): void;
    addOtsShiftVector(otsShiftVector: Vector3): void;
}

export interface IPlayerOptions {
    playerGravity: number;
    jumpHeight: number;
    stepHeight: number;
    maxSlope: number;
    pushObjects?: boolean;
    pushImpulse?: number;
    pushVerticalScale?: number;
    kickObjects?: boolean;
    kickImpulse?: number;
}

export interface VehicleInput {
    throttle: number;
    steer: number;
    brake: number;
}

// Pure data — no Three.js references. Used by the engine-facing
// `VehiclePhysics.addVehicle` API and anywhere the spec has to cross
// a worker `postMessage` boundary.
export interface VehicleWheelData {
    name: string;
    isFront: boolean;
    radius: number;
    width: number;
    connection: {x: number; y: number; z: number};
    wheelObjectUuid?: string;
}

export interface VehicleData {
    chassisObjectUuid: string;
    chassis: {
        halfExtents: {x: number; y: number; z: number};
        centerOffset: {x: number; y: number; z: number};
        initialTransform: {
            position: {x: number; y: number; z: number};
            quaternion: {x: number; y: number; z: number; w: number};
        };
    };
    wheels: VehicleWheelData[];
}

// Legacy spec used by `IPhysics.addVehicleObject` and exposed to
// user-authored behavior scripts via the BehaviorEditor type
// surface. Extends the pure-data shape with optional Three.js
// references so the adapter can register visuals with
// `PhysicsBase.addObject`.
export interface VehicleWheelSpec extends VehicleWheelData {
    wheelObject?: Object3D;
}

export interface VehicleSpec extends VehicleData {
    chassisObject?: Object3D;
    wheels: VehicleWheelSpec[];
}

export interface VehicleOptions {
    mass: number;
    suspensionStiffness: number;
    suspensionDamping: number;
    suspensionCompression: number;
    suspensionRestLength: number;
    rollInfluence: number;
    wheelFriction: number;
    maxEngineForce: number;
    maxBrakeForce: number;
    maxSteerAngle: number;
    throttleDeadzone: number;
    steerDeadzone: number;
}

export interface CollisionRegistration {
    id: string;
    type: COLLISION_TYPE;
}

export type ObjectMotionState = {
    onGround: boolean;
    linearVelocity: Vector3Like;
    angularVelocity?: Vector3Like;
}

export interface IDispatcher {
    onReady(): void;
    onBodyUpdate(
        uuid: string,
        position: Vector3Like,
        rotation: QuaternionLike,
        scale: Vector3Like,
        dt: number,
        motionState?: ObjectMotionState
    ): void;
    onCollision(uuid: string, listenerId: string): void;
}

export enum BodyShapeType {
    BOX = "btBoxShape",
    SPHERE = "btSphereShape",
    CAPSULE = "btCapsuleShape",
    CONVEX_HULL = "btConvexHullShape",
    CONCAVE_HULL = "btConcaveHullShape",
    HEIGHTFIELD = "btHeightfieldTerrainShape",
}

//from AmmoJS
export const COLLISION_FLAGS = {
    CF_DYNAMIC_OBJECT: 0,
    CF_STATIC_OBJECT: 1,
    CF_KINEMATIC_OBJECT: 2,
};

export enum CollisionFlag {
    DYNAMIC = COLLISION_FLAGS.CF_DYNAMIC_OBJECT,
    KINEMATIC = COLLISION_FLAGS.CF_KINEMATIC_OBJECT,
    STATIC = COLLISION_FLAGS.CF_STATIC_OBJECT,
}

export const COLLISION_MAP = new Map([
    ["Dynamic", CollisionFlag.DYNAMIC],
    ["Kinematic", CollisionFlag.KINEMATIC],
    ["Static", CollisionFlag.STATIC],
]);

export type CommonData = {
    uuid: string;
    template: string; //template uuid
    name: string;
    position: {x: number; y: number; z: number};
    quaternion: {x: number; y: number; z: number; w: number};
    scale: {x: number; y: number; z: number};
    mass: number;
    restitution?: number;
    friction: number;
    rollingFriction: number;
    spinningFriction: number;
    contactStiffness: number;
    contactDamping: number;
    damping?: {linear: number; angular: number};
    collision_flag?: CollisionFlag;
    rotationLock?: { x: boolean; y: boolean; z: boolean };
};

export type BoxData = CommonData & BoxShape;

export type SphereData = CommonData & SphereShape;

export type ModelData = CommonData & {
    vertices: number[][];
    matrices: number[][];
    indexes: number[][];
    scale: {x: number; y: number; z: number};
};

export type TerrainData = CommonData & {
    terrainWidth: number;
    terrainDepth: number;
    terrainMinHeight: number;
    terrainMaxHeight: number;
    heightData: Float32Array;
    terrainWidthExtents?: number;
    terrainDepthExtents?: number;
};

export type ConvexHullData = CommonData & ConvexHullShape;

export type ConcaveHullData = CommonData & ConcaveHullShape;

export type CapsuleData = CommonData & CapsuleShape;

export interface BoxShape {
    type: BodyShapeType.BOX;
    width: number;
    height: number;
    length: number;
}

export interface CapsuleShape {
    type: BodyShapeType.CAPSULE;
    radius: number;
    height: number;
}

export interface SphereShape {
    type: BodyShapeType.SPHERE;
    radius: number;
    // TODO: support anchorOffset for sphere colliders
}

export interface ConvexHullShape {
    type: BodyShapeType.CONVEX_HULL;
    vertices: number[];
}

export interface ConcaveHullShape {
    type: BodyShapeType.CONCAVE_HULL;
    vertices: number[][];
    indexes: number[][];
}

export interface HeightfieldShape {
    type: BodyShapeType.HEIGHTFIELD;
    sampleCount: number;
    heightSamples: number[];
    offset: {x: number; y: number; z: number};
    scale: {x: number; y: number; z: number};
}

export type CollisionShape =
    | BoxShape
    | SphereShape
    | ConvexHullShape
    | ConcaveHullShape
    | CapsuleShape
    | HeightfieldShape;

export const DEFAULT_SCALE = {x: 1, y: 1, z: 1};

export enum PhysicsEngineType {
    Ammo = "ammo",
    Rapier = "rapier",
}

export const isPhysicsEngineType = (value: unknown): value is PhysicsEngineType =>
    Object.values(PhysicsEngineType).includes(value as PhysicsEngineType);
