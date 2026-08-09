// Auto-generated Stem Studio type bundle
// Generated: 2026-05-16T04:57:33.055Z
// Source: /Users/n/erth/de-shadow-editor/stemstudio-copilot/ai/claude/typefiles/de-shadow-editor/web/src

// ---- INTERFACES ----
// -- physics/common/types.ts --
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
export enum CollisionFlag {
    DYNAMIC = COLLISION_FLAGS.CF_DYNAMIC_OBJECT,
    KINEMATIC = COLLISION_FLAGS.CF_KINEMATIC_OBJECT,
    STATIC = COLLISION_FLAGS.CF_STATIC_OBJECT,
}
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
export enum PhysicsEngineType {
    Ammo = "ammo",
    Rapier = "rapier",
}
export const isPhysicsEngineType: (value: unknown) => value is PhysicsEngineType;

// -- physics/common/events.ts --
export const SIMPLE_EVENTS = {
    ADD: {
        OBJECT: "simple:add:object",
        CHILD: "simple:add:child",
    },
    REMOVE: {
        OBJECT: "simple:rm:object",
        CHILD: "simple:remove:child",
        BEHAVIOR_DATA: "simple:remove:behavior:data",
    },
    UPDATE: {
        OBJECT: "simple:update:object",
    },
    SET: {
        BEHAVIOR_DATA: "simple:set:behavior:data",
        COLLISION_BEHAVIOR: "simple:set:collision:behavior",
        PLAYER: {
            OBJECT: "simple:set:player:object",
            DATA: "simple:set:player:data",
        },
    },
    CHAT: {
        MESSAGE: "simple:chat:message",
    },
    DISCONNECT_CLIENTS: "simple:disconnect:clients",
    HEARTBEAT: "simple:heartbeat",
};
export const SNAPSHOT_EVENTS = {
    REQUEST: "snapshot:request",
    RESPONSE: "snapshot:response",
    SYNC: {
        CHECK_REQUEST: "snapshot:sync:check_request",
        CHECK_RESPONSE: "snapshot:sync:check_response",
    },
    UPDATE: {
        OBJECT: "snapshot:update:object",
        OBJECT_USER_DATA: "snapshot:update:object:user_data",
        SCENE_CHILDREN: "snapshot:update:scene:children",
    },
    ADD: {
        OBJECT: "snapshot:add:object",
    },
    REMOVE: {
        OBJECT: "snapshot:remove:object",
    },
};
export const ASSET_EVENTS = {
    ADD: "asset:add",
    REMOVE: "asset:remove",
    UPDATE: "asset:update",
};
export const BEHAVIOR_EVENTS = {
    REGISTER: {
        BEHAVIOR: "behavior:register:behavior",
        SCRIPT: "behavior:register:script",
    },
    UNREGISTER: {
        BEHAVIOR: "behavior:unregister:behavior",
        SCRIPT: "behavior:unregister:script",
    },
    UPDATE: {
        BEHAVIOR: "behavior:update:behavior",
        SCRIPT: "behavior:update:script",
    },
};
export const LAMBDA_EVENTS = {
    REGISTER: "lambda:register",
    UNREGISTER: "lambda:unregister",
    UPDATE: "lambda:update",
};
export const PHYSICS_EVENTS = {
    TERMINATE: "physics:terminate",
    READY: "physics:ready",
    START: "physics:start",
    SIMULATE: "physics:simulate",
    UPDATE: "physics:update",
    PAUSE: "physics:pause",
    RESUME: "physics:resume",
    PING: "physics:ping",
    PONG: "physics:pong",

    ADD: {
        BODY: "physics:add:body",
        BOX: "physics:add:box",
        VEHICLE: "physics:add:vehicle",
        MODEL: "physics:add:model",
        PLAYER: "physics:add:player",
        SPHERE: "physics:add:sphere",
        TERRAIN: "physics:add:terrain",
        CONVEXHULL: "physics:add:convexhull",
        CONCAVEHULL: "physics:add:concavehull",
        CAPSULE: "physics:add:capsule",
        SHAPE: "physics:add:shape",
        CONSTRAINT: {
            FIXED: "physics:add:constraint:fixed",
            P2P: "physics:add:constraint:p2p",
            HINGE: "physics:add:constraint:hinge",
        },
    } as const,

    REMOVE: {
        RIGID_BODY: "physics:remove:rigid_body",
        SHAPE: "physics:remove:shape",
        CONSTRAINT: "physics:remove:constraint",
    } as const,

    APPLY: {
        CENTRAL_IMPULSE: "physics:apply:central_impulse",
        IMPULSE_TO_RIGIDBODY: "physics:apply:impulse_to_rigidbody",
    } as const,

    SET: {
        ORIGIN: "physics:set:origin",
        ROTATION: "physics:set:rotation",
        SCALE: "physics:set:scale",
        ANGULAR_VELOCITY: "physics:set:angular_velocity",
        LINEAR_VELOCITY: "physics:set:linear_velocity",
        COLLISION_BEHAVIOR: "physics:set:collision_behavior",
        LINEAR_DAMPING: "physics:set:linear_damping",
        ANGULAR_DAMPING: "physics:set:angular_damping",
    } as const,

    BODY: {
        UPDATE: "physics:body:update",
    } as const,

    PLAYER: {
        ADD: "physics:player:add",
        READY: "physics:player:ready",
        REMOVE: "physics:player:remove",
        MOVE: "physics:player:move",
        APPLY_IMPULSE: "physics:player:apply_impulse",
        SET_GRAVITY: "physics:player:set_gravity",
        SET_POSITION: "physics:player:set_position",
    } as const,

    VEHICLE: {
        ADD: "physics:vehicle:add",
        REMOVE: "physics:vehicle:remove",
        MOVE: "physics:vehicle:move",
    } as const,

    COLLISION: {
        DETECTED: "physics:collision:detected",
        DETECT: "physics:collision:detect",
        ADD: {
            OBJECT: "physics:collision:add:object",
        } as const,
        REMOVE: {
            OBJECT: "physics:collision:remove:object",
        } as const,
    } as const,

    ANIMATION: {
        SET: "physics:animation:set",
    } as const,

    BATCH: {
        UPDATE: "physics:batch:update",
    } as const,
} as const;
export interface BatchObjectUpdate {
    position: Vector3Like | null;
    quaternion: QuaternionLike | null;
    scale: Vector3Like | null;
}
export interface BatchUpdateEvent {
    event: typeof PHYSICS_EVENTS.BATCH.UPDATE;
    objects: Record<string, BatchObjectUpdate>;
}
export interface AddShapeEvent {
    uuid: string;
    shape: CollisionShape;
}
export interface RemoveShapeEvent {
    uuid: string;
}
export interface AddBodyEvent extends CommonData {
    shapeUuid: string;
}
export interface SetCollisionBehaviorEvent {
    uuid: string;
    behavior: CollisionBehavior;
}

// -- types/editor.ts --
// 100svh - padding 2x12px - nav height

export enum GAME_STATE {
    NOT_STARTED = 0,
    STARTED,
    FINISHED, //automatically switches to NOT_STARTED
    PAUSED,
}
export enum OBJECT_INTERACTION_OPTIONS {
    PICKUP_DROP = "Pickup and Drop",
    PUSH_PULL = "Push and Pull",
}
export enum NPC_MOVEMENT_TYPES {
    STANDING = "Standing",
    ROAM = "Roam",
}
export enum NPC_TYPES {
    WAITER = "Waiter",
    FIREMAN = "Fireman",
    DOCTOR = "Doctor",
    SOLDIER = "Soldier",
    BAKER = "Baker",
    POLICEMAN = "Policeman",
    FARMER = "Farmer",
    SCIENTIST = "Scientist",
    TEACHER = "Teacher",
    ARTIST = "Artist",
    ENGINEER = "Engineer",
    NURSE = "Nurse",
    DRIVER = "Driver",
    SOLDIER_ELITE = "Elite Soldier",
    JOCK = "Jock",
    MERCHANT = "Merchant",
    GUARD = "Guard",
    COOK = "Cook",
    STUDENT = "Student",
    PAINTER = "Painter",
}
export enum SPRITE_TYPES {
    TWO_D = "2D",
    THREE_D = "3D",
    ANIMATED = "ANIMATED", // Example additional type
}
export enum ANIMATION_TYPES {
    REPEAT = "Repeat",
    LOOP = "Loop",
    PLAY_ONCE = "Play Once",
}
export enum PROP_ANIMATION_TYPES {
    LOOP = "Loop",
    PLAY_ONCE = "Play Once",
}
export enum EASE_TYPES {
    LINEAR = "linear",
    QUAD_IN = "quadIn",
    QUAD_OUT = "quadOut",
    QUAD_IN_OUT = "quadInOut",
    CUBIC_IN = "cubicIn",
    CUBIC_OUT = "cubicOut",
    CUBIC_IN_OUT = "cubicInOut",
    QUART_IN = "quartIn",
    QUART_OUT = "quartOut",
    QUART_IN_OUT = "quartInOut",
    QUINT_IN = "quintIn",
    QUINT_OUT = "quintOut",
    QUINT_IN_OUT = "quintInOut",
    SINE_IN = "sineIn",
    SINE_OUT = "sineOut",
    SINE_IN_OUT = "sineInOut",
    BACK_IN = "backIn",
    BACK_OUT = "backOut",
    BACK_IN_OUT = "backInOut",
    CIRC_IN = "circIn",
    CIRC_OUT = "circOut",
    CIRC_IN_OUT = "circInOut",
    BOUNCE_IN = "bounceIn",
    BOUNCE_OUT = "bounceOut",
    BOUNCE_IN_OUT = "bounceInOut",
    ELASTIC_IN = "elasticIn",
    ELASTIC_OUT = "elasticOut",
    ELASTIC_IN_OUT = "elasticInOut",
}
export enum CUSTOM_BLOCK_VOLUME_TYPES {
    BLOCK_ENEMIES = "Block Enemies",
    BLOCK_THROWABLE = "Block Throwables",
    BLOCK_CHARACTERS = "Block Characters",
}
export enum ENEMY_TYPES {
    AGGRESIVE = "Aggressive",
    DEFENSIVE = "Defensive",
    PATROLS = "Patrols",
    CUSTOM = "Custom",
}
export enum PLATFORM_RESPAWN_TYPES {
    LOOP = "Loop",
    REPEAT = "Respawn",
    PLAY_ONCE = "Play Once",
}
export enum SPAWNPOINT_TYPES {
    CLONE = "Clone",
    MOVE = "Move",
}
export enum RANDOMIZED_SPAWNER_TYPES {
    CLONE = "Clone",
    MOVE = "Move",
}
export enum WEAPON_TYPES {
    MACHINE_GUN = "Machine Gun",
    SUB_MACHINE_GUN = "Sub Machine Gun",
    RIFLE = "Rifle",
    SNIPER_RIFLE = "Sniper Rifle",
    SCIFI_SNIPER_RIFLE = "SciFi Sniper Rifle",
    SHOT_GUN = "Shot Gun",
    PISTOL = "Pistol",
    BOW = "Bow",
    HANDS = "Hands",
    SWORD = "Sword",
    KNIFE = "Knife",
    STAFF = "Staff",
    GRENADE = "Grenade",
    BUTTON_PRESS = "Button Press",
}
export enum INVENTORY_TYPES {
    PRIMARY = "Primary",
    SECONDARY = "Secondary",
    MELEE = "Melee",
    THROWABLE = "Throwable",
    CONSUMABLE = "Consumable",
    WEAPON = "Weapon",
    WEAPON_AMMO = "Weapon Ammo",
}
export interface BehaviorInterface {
    enabled: boolean;
    id: string;
    // type: OBJECT_TYPES;
    customName?: string;
}
export interface CharacterOptionsInterface {
    playerGravity: number;
    sceneModels: any;
    selectedModelUUID: string;
    selectedModel: any;
    animationNames: any;
    walkAnimation: string;
    runAnimation: string;
    jumpAnimation: string;
    idleAnimation: string;
    fallAnimation: string;
    crouchAnimation: string;
    dieAnimation: string;
    climbAnimation: string;
    invertForwardDirection: boolean;
    groundDeceleration: number;
    groundAcceleration: number;
    airDeceleration: number;
    airAcceleration: number;
    walkSpeed: number;
    runSpeed: number;
    jumpHeight: number;
    stepHeight: number;
    pushObjects: boolean;
    pushImpulse: number;
    pushVerticalScale: number;
    kickObjects: boolean;
    kickImpulse: number;
    kickAnimation: string;
    climbSpeed: number;
    canClimb?: boolean;
    cameraDefaultDistance: number;
    cameraMinDistance: number;
    cameraMaxDistance: number;
    cameraFov: number;
    health: number;
    lookSpeed: number;
    useAutoForward: boolean;
    maxSlope: number;
    shield: number;
    jumpStrength: number;
}
export interface SoundPropInterface {
    id: string;
    name: string;
    url: string;
}
export interface ModelPropInterface {
    id: string;
    name: string;
    url: string;
}
export enum INVENTORY_UI_CONTAINERS {
    MAIN = "main-game-ui-container",
    MAIN_ACTIVE = "selected-object-container",
    ICONS = "inventory-container",
    ACTIVE_OBJECT = "active-object-container",
    AMMO = "ammo-container-2",
    SECTION_PREFIX = "inv-cat-",
    IMAGE_PREFIX = "inv-img-container-",
    ICON_PREFIX = "inv-icon-",
    AMMO_COUNT = "weapon-ammo-count",
}
export enum RESPAWN_TYPES {
    ONCE = "Once",
    CAN_RESPAWN = "Can Respawn",
}
export enum HARVEST_TYPES {
    HIT = "Hit",
    PRESS_E_KEY = "Press E Key",
}
export enum PROCEDURAL_PLANT_TYPES {
    GRASS = "Grass",
    FLOWER = "Flower",
    CAT_TAIL = "Cat Tail",
    SHRUB = "Shrub",
    TREE = "Tree",
    MOSS = "Moss",
}
export enum PROCEDURAL_TERRAIN_TYPES {
    //TODO think about how we can add logic for scaling of the
    MOUNTAINS = "Mountains", //height maps to generate example CANYON or MOUNTAINS with AI
    VALLEY = "Valleys",
    PLAIN = "Plains",
    HILLS = "Hills",
    DESERT = "Desert",
    SWAMP = "Swamp",
    COASTLINE = "Coastline",
    FOREST = "Forest",
    JUNGLE = "Jungle",
    TUNDRA = "Tundra",
    SAVANNAH = "Savannah",
    CANYON = "Canyon",
    PLATEAU = "Plateau",
    WETLANDS = "Wetlands",
    GLACIER = "Glacier",
    MEADOW = "Meadow",
    STEPPE = "Steppe",
    BADLANDS = "Badlands",
    ARCHIPELAGO = "Archipelago",
}
export type HarvestInitiatorType = HARVEST_TYPES.HIT | HARVEST_TYPES.PRESS_E_KEY;
export type RespawnType = RESPAWN_TYPES.ONCE | RESPAWN_TYPES.CAN_RESPAWN;
export enum CAMERA_OBJECT_INTERACTION {
    TRANSPARENT = "Transparent",
    ZOOM = "Zoom",
}
export interface CameraData {
    type: "Camera";
    cameraType: CAMERA_TYPES; // Possible values here: "First Person", "3rd Person", "Top Down", "Side Scroller"
    cameraEffect: CAMERA_EFFECTS; // Possible values here: Pixel, Bokeh, RGB, None
    cameraHeadHeight?: number; // this option can only be valid if cameraType is set to "First Person"
    playerCollisionBox?: number; // this option can only be valid if cameraType is set to "First Person"
    cameraDefaultDistance?: number; // this option can only be valid if cameraType is set to "3rd Person" or "Top Down"
    cameraMinDistance?: number; // this option can only be valid if cameraType is set to "3rd Person" or "Top Down"
    cameraMaxDistance?: number; // this option can only be valid if cameraType is set to "3rd Person" or "Top Down"
    cameraFOV: number;
    cameraNear?: number;
    cameraFar?: number;
    usePointerLock: boolean;
    cameraAngle?: number; // this option can only be valid if cameraType is set to "3rd Person" or "Top Down"
    cameraAxis?: number; // this option can only be valid if cameraType is set to "Side Scroller"
    objectInteraction: CAMERA_OBJECT_INTERACTION; // Possible values here: "Transparent" or "Zoom"
    // Camera follow behavior settings
    enableCameraFollowBehavior?: boolean; // enable/disable camera follow behavior (default: false)
    cameraBackViewTolerance?: number; // degrees of Y-axis tolerance before returning to back view (default: 90)
    cameraBackViewReturnSpeed?: number; // seconds to return to back view (default: 0.5)
    cameraFrontViewFlipSpeed?: number; // seconds for quick turn detection (default: 0.3)
    cameraFrontViewFlipAngle?: number; // degrees for front view flip threshold (default: 90)
    cameraFrontViewFlipTransitionSpeed?: number; // seconds to transition between front/back view (default: 0.3)
    occlusionType?: OCCLUSION_TYPES; // type of occlusion behavior (default: Distance)
}
export interface ProceduralPlantBehaviorInterface {
    // type: OBJECT_TYPES.PROCEDURAL_PLANT;
    plantType: PROCEDURAL_PLANT_TYPES.GRASS;
    id: string;
    enabled: boolean;
    numberOfPlants: number;
    windDirectionX: number;
    windDirectionY: number;
    windDirectionZ: number;
    windStrength: number;
    windSpeed: number;
    alphaImage: string;
    diffuseImage: string;
    plantWidth: number;
    plantHeight: number;
    horizontalSegments: number;
    verticalSegments: number;
    isAnimated: boolean;
}
export interface ProceduralTerrainBehaviorInterface {
    // type: OBJECT_TYPES.PROCEDURAL_TERRAIN;
    terrainType: PROCEDURAL_TERRAIN_TYPES.MOUNTAINS;
    id: string;
    enabled: boolean;
    perlinNoiseScale: number;
    perlinNoiseImage: string;
    terrainWidth: number;
    terrainLength: number;
    terrainSegments: number;
}
export interface PropAnimationBehaviorInterface extends BehaviorInterface {
    // type: OBJECT_TYPES.PROP_ANIMATION; // value here is a string "Prop Animation"
    animationType: PROP_ANIMATION_TYPES; // possible options here: "Loop", "Play Once"
    propAnimation: string; // name of the animation
    animationSpeed: number; // animation speed
    startOnTrigger: boolean; // start animation on trigger
}
export interface IfConditionInterface {
    id: string;
    player_touches: boolean;
    object_touches: boolean;
    pressE: boolean;
    objectUUID?: string; // only set when object_touches is selected
}
export interface TriggerBehaviorInterface extends BehaviorInterface {
    // type: OBJECT_TYPES.TRIGGER; // value here is a string "Trigger"
    if_condition: IfConditionInterface[]; // array of conditions that must be met to trigger this behavior
    if_operator?: "and" | "or";
    else_condition: boolean;
    then_activate: boolean;
    else_activate: boolean;
    then_object: string;
    else_object: string;
    delay: number; // delay in seconds
    then_behaviors_on_trigger: Array<{key: any; value: boolean}>; // for example ["Animation": true] - true means it is waiting for the trigger to start/stop, false means this trigger has no effect on it
    else_behaviors_on_trigger: Array<{key: any; value: boolean}>; // for example ["Animation": true] - true means it is waiting for the trigger to start/stop, false means this trigger has no effect on it
}
export enum SCENE_LAYERS {
    TERRAIN_OBJECTS_LAYER = 101,
}
export enum TRIGGER_ACTIVATION_TYPES {
    PLAYER_TOUCHES = "player_touches",
    OBJECT_TOUCHES = "object_touches",
    PRESS_E = "pressE",
    PRESS_F = "pressF",
    ON_ENTER = "on_enter",
    ON_EXIT = "on_exit",
    WHILE_INSIDE = "while_inside",
    KEY_BUTTON_PRESSED = "key_button_pressed",
    TIMER_ELAPSED = "timer_elapsed",
    DISTANCE_COMPARE = "distance_compare",
    HAS_TAG_TEAM_FACTION = "has_tag_team_faction",
    VARIABLE_COMPARE = "variable_compare",
    BEHAVIOR_STATE = "behavior_state",
    ANIMATION_EVENT_REACHED = "animation_event_reached",
    LINE_OF_SIGHT = "line_of_sight",
    RANDOM_CHANCE = "random_chance",
    COOLDOWN_READY = "cooldown_ready",
    ON_INTERACT = "on_interact",
    OBJECT_STATE_COMPARE = "object_state_compare",
    TIME_WINDOW = "time_window",
    MULTIPLAYER_ROLE = "multiplayer_role",
    PHYSICS_COLLISION_EVENT = "physics_collision_event",
    AI_PROXIMITY = "ai_proximity",
}
export enum CONSUMABLE_TYPES {
    INSTANT = "INSTANT",
    PRESS_E = "PRESS E",
    BUTTON_PRESS = "Button Press",
}
export enum DEVICE_TYPES {
    MOBILE = "Mobile",
    DESKTOP = "Desktop",
}
export enum OPERATING_SYSTEM_TYPES {
    MAC_OS = "macOS",
    WINDOWS_OS = "Windows",
    ANDROID_OS = "Android",
    I_OS = "iOS",
    LINUX_OS = "Linux",
}
export enum MOVEMENT_STATES {
    FORWARD = "Forward",
    STRAIGHT_FORWARD = "Straight Forward",
    BACKWARD = "Backward",
    STRAIGHT_BACKWARD = "Straight Backward",
    STOPPED = "Stopped",
    RIGHT = "Right",
    LEFT = "Left",
    FORWARD_LEFT = "Forward Left",
    FORWARD_RIGHT = "Forward Right",
    BACKWARD_LEFT = "Backward Left",
    BACKWARD_RIGHT = "BackWwrd Right",
    JUMP_RIGHT = "Jump Right",
    JUMP_LEFT = "Jump Left",
}
export enum MOBILE_BUTTON_ACTION_UI_STATES {
    SHOW = "Show",
    HIDE = "Hide",
    MOBILE_BUTTON_ACTION_CONTAINER_CLASS_NAME = ".character-state-control-button",
}
export enum MOBILE_JOYSTICK_CONTROL_UI {
    MOBILE_JOYSTICK_CONTROL_NAME = "character-joystick-control",
}
export enum PHYSICS_PROXY_UI {
    PHYSICS_MESSAGE_ELEMENT = "physics-loading-message",
}
//TODO: move to types.ts
export enum COLLISION_TYPE {
    UNKNOWN = -1,
    WITH_PLAYER,
    WITH_COLLIDABLE_OBJECTS,
    WITH_ENEMY,
}
export interface ICollisionSettings {
    disposable: boolean;
    playerCollision: boolean;
    enemyCollision: boolean;
    throwableCollision: boolean;
    canReappear: boolean;
}
export interface ITransformValue {
    x: number;
    y: number;
    z: number;
}
export enum TRANSFORMATION_OPTIONS {
    POSITION,
    ROTATION,
    SCALE,
    SIZE,
}
export enum TRANSFORM_CONTROLS_MODE {
    TRANSLATE = "translate",
    ROTATE = "rotate",
    SCALE = "scale",
}
export enum WEAPON_AIMERS {
    AIMER_SCREEN_ZINDEX = 998,
}
export interface WeaponBehaviorInterface extends BehaviorInterface {
    // type: OBJECT_TYPES.WEAPON; // Value is a string "Weapon"
    inventoryType: INVENTORY_TYPES;
    weaponName: string;
    ui_tag: string;
    weaponStarting: boolean;
    uiImage: string;
    weaponType: WEAPON_TYPES;
    weaponDamage: number;
    weaponAimerZindex: number;
    weaponClipAmount: number;
    weaponFireSpeed: number;
    weaponReloadSpeed: number;
    weaponScopeZoom: number;
    aimerUIImage: string;
    aimerUIImageName: string;
    weaponShowHUDAimerInGame: boolean;
    weaponPreviewHUDAimer: boolean;
    weaponHUDAimerSize: number;
    VFXSmallEffect: boolean;
    VFXMediumEffect: boolean;
    VFXBigEffect: boolean;
    VFXLaserEffect: boolean;
    VFXCartoonyEffect: boolean;
    weaponAutoReload: boolean;
    position_x: number;
    position_y: number;
    position_z: number;
    rotation_x: number;
    rotation_y: number;
    rotation_z: number;
    selectedWeaponAmmoName: string;
    weaponAmmoVisible: boolean;
    weaponSelectedCharacterBone: string;
    weaponScale: number;
    weaponMuzzleFlashBrightness: number;
    weaponMuzzleSmokeDensity: number;
    weaponMuzzleSmokeSize: number;
    weaponMuzzleSmokeLife: number;
    weaponMuzzleSmokeOpacity: number;
}
export interface AiNPCBehaviorInterface extends BehaviorInterface {
    // type: OBJECT_TYPES.AI_NPC; // Value is a string "AI NPC"
    name: string;
    voice_id: string;
    range: number;
    active_in_voice_chat: boolean;
    show_text_chat: boolean;
    bio: string;
    lore: string;
    adjectives: string[];
    social_media_posts: string;
    interests: string[];
    response_style: string;
    miscellaneous: string;
    roamDistance: number;
}
export interface BillboardBehaviorInterface {
    id: string;
    // type: OBJECT_TYPES.BILLBOARD; // Value is a string "Billboard"
    billboardMode: BILLBOARD_TYPES; // type of the billboard: video or file, values: "Webpage", "Image" or "YouTube Video"
    loop?: boolean;
    twoSided?: boolean;
    transparent?: boolean;
    faceCamera?: boolean;
    assetFile?: string; // uploaded asset url
    urlLink?: string; // video or webpage url
}
export enum CUSTOM_VOLUME_TYPES {
    LEVEL_CHANGER = "Level Changer",
    CUSTOM = "Custom",
}
export enum BILLBOARD_TYPES {
    WEB = "Webpage",
    YT_VIDEO = "YouTube Video",
    IMAGE = "Image",
}
export enum SHADER_EFFECTS {
    BOKEH = "Bokeh Effect",
    PIXEL = "Pixel Effect",
    RGB = "RGB",
    NONE = "None",
}
export enum CAMERA_EFFECTS {
    BOKEH = "Bokeh",
    PIXEL = "Pixel",
    RGB = "RGB",
    NONE = "None",
}
export enum OCCLUSION_TYPES {
    DISTANCE = "Distance",
    TRANSPARENCY = "Transparency",
}
//Disable some cameras while continuing re-factor
export enum CAMERA_TYPES {
    FIRST_PERSON = "First Person",
    THIRD_PERSON = "Third Person",
    FORTNITE = "FortNite",
    TOP_DOWN = "Top Down",
    SIDE_SCROLLER = "Side Scroller",
    VEHICLE = "Vehicle",
    SPECTATOR = "Spectator",
    FIXED = "Fixed",
    NONE = "NONE",
}
export enum CAMERA_TYPES_NEW {
    THIRD_PERSON = "Third Person",
    FIRST_PERSON = "First Person",
    TOP_DOWN = "Top Down",
    SIDE_SCROLLER = "Side Scroller",
}
export enum WEAPON_EFFECTS {
    GUN_MUZZLE_FLASH_PLANE_NAME = "gun_muzzle_flash_plane",
    WEAPON_HUD_AIMER_IMG_NAME = "weapon-hud-aimer-",
}
export enum MATERIAL_TYPES {
    SPECULAR = "specular",
    METALLIC = "metallic",
    PBR = "PBR",
}
export enum SHADER_EFFECTS_PROPS {
    BOKEH = "bokeh",
    PIXEL = "pixel",
    RGB = "rgbShift",
    NONE = "none",
}
//physics

export enum COLLISION_MATERIAL_TYPE {
    CUSTOM = "Custom",
    METAL = "Metal",
    DIRT = "Dirt",
    GROUND = "Ground",
    PLASTIC = "Plastic",
    SNOW = "Snow",
    WOOD = "Wood",
    CONCRETE = "Concrete",
    MUD = "Mud",
    ICE = "Ice",
    SLIME = "Slime",
    WATER = "Water",
    SLIPPERY_GROUND = "Slippery ground",
    RUBBER = "Rubber",
    SAND = "Sand",
}
export interface ILightState {
    label?: string;
    show: boolean;
    showColor?: boolean;
    color?: string;
    showIntensity?: boolean;
    intensity?: number;
    showDistance?: boolean;
    showDecay?: boolean;
    distance?: number;
    decay?: number;
    showAngle?: boolean;
    showPenumbra?: boolean;
    angle?: number;
    penumbra?: number;
    showSkyColor?: boolean;
    showGroundColor?: boolean;
    skyColor?: string;
    groundColor?: string;
    showWidth?: boolean;
    showHeight?: boolean;
    showCastShadow?: boolean;
    castShadow?: boolean;
    width?: number;
    height?: number;
    startOnTrigger?: boolean;
    showTarget?: boolean;
    target?: THREE.Object3D<THREE.Object3DEventMap>;
    showShadowParams?: boolean;
    shadowMapSize?: number;
    shadowCameraNear?: number;
    shadowCameraFar?: number;
    shadowBias?: number;
    shadowNormalBias?: number;
    shadowFocus?: number;
    shadowCameraWidth?: number;
    shadowCameraHeight?: number;
    shadowRadius?: number;
    shadowBlurSamples?: number;
    isUnityStyle?: boolean;
    showUnityStyle?: boolean;
}
// messages
export interface ITransformMessageData {
    x: number;
    y: number;
    z: number;
}
export interface ISoundSettings {
    id: string;
    url: string;
    loop: boolean;
    volume: number;
    soundType: "play-now" | "menu-background" | "" | "play-preview";
}
export enum IFRAME_MESSAGES {
    GAME_STARTED = "gameStarted",
    GAME_RESUMED = "gameResumed",
    GAME_PAUSED = "gamePaused",
    GAME_ENDED = "gameEnded",
    GAME_CLOSED = "gameClosed",
    GAME_CLOSE_AND_SAVE = "gameCloseAndSave",
    GAME_CREATED = "gameCreated",
    GAME_PLAYER_ERROR = "gamePlayerError",
    GAME_ERROR = "gameError",
    GAME_MULTIPLAYER_ERROR = "gameMultiplayerError",
    PLAYER_ADDED_LISTENER = "playerAddedListener",
    HEALTH_UPDATE = "healthUpdate",
}
export type RigidBodyType = "rigidBody";
export interface BehaviorThrottlingConfig {
    /** Distance squared beyond which behaviors are considered "far" and get throttled (default: 50*50 = 2500) */
    farDistanceSq?: number;

    /** Distance squared beyond which behaviors are considered "very far" and get heavily throttled (default: 100*100 = 10000) */
    veryFarDistanceSq?: number;

    /** Throttling factor for far objects - update every Nth frame (default: 3) */
    farThrottleFactor?: number;

    /** Throttling factor for very far objects - update every Nth frame (default: 10) */
    veryFarThrottleFactor?: number;

    /** Whether to enable frustum culling for behaviors (default: true) */
    enableFrustumCulling?: boolean;

    /** Whether to enable distance-based throttling (default: true) */
    enableDistanceThrottling?: boolean;

    /** Whether to enable performance monitoring and reporting (default: false) */
    enablePerformanceReporting?: boolean;

    /** Whether to enable behavior throttling globally - when false, ALL behaviors update every frame (default: true) */
    throttlingEnabled?: boolean;
}

// -- behaviors/event/EventBus.ts --
type EventBusPriority = "engine" | "game";
interface EventBusSubscribeOptions {
    priority?: EventBusPriority;
}
interface EventBusSubscription {
    topic: string;
    priority: EventBusPriority;
    handler: (data: any) => void;
}
declare class EventBus {
  static instance: EventBus;
  reset(): void;
  unsubscribe(tokenOrTopic: string): void;
  subscribe(topic: string, callback: (msg: string, data: any) => void, options: EventBusSubscribeOptions): string;
  send(topic: string, data: any): void;
}
export enum BEHAVIOR_EVENTS {
    DAY_NIGHT_CYCLE = "DayNightCycle",
}
export enum IN_GAME_EVENTS {
    GAME_LIVES_INC = "game.lives.inc",
    GAME_LIVES_DEC = "game.lives.dec",
    GAME_HEALTH_INC = "game.health.inc",
    GAME_HEALTH_DEC = "game.health.dec",
    GAME_SCORE_INC = "game.score.inc",
    GAME_SCORE_DEC = "game.score.dec",
    GAME_TIME_INC = "game.time.inc",
    GAME_TIME_DEC = "game.time.dec",
    GAME_LOGIN_SUCCESS = "game.loginSuccess",
    // Enemy events
    ENEMY_SPAWNED = "enemy.spawned",
    ENEMY_DIED = "enemy.died",
    ENEMY_GOT_HIT = "enemy.got.hit",
    ENEMY_STATE_CHANGED = "enemy.state.changed",
    ENEMY_PLAYER_DETECTED = "enemy.player.detected",
    ENEMY_PLAYER_LOST = "enemy.player.lost",
    ENEMY_ATTACK_STARTED = "enemy.attack.started",
    ENEMY_ATTACK = "enemy.attack",
    ENEMY_ATTACK_ENDED = "enemy.attack.ended",
    // Player events
    CHARACTER_IDLE = "character.motion.none",
    CHARACTER_ACTION_FALL_BACK = "character.action.fall_back",
    CHARACTER_ACTION_DEAD = "character.action.dead",
    CHARACTER_MOTION_START = "character.motion_start",
    CHARACTER_MOTION = "character.motion",
    CHARACTER_MOTION_END = "character.motion_end",
    CHARACTER_MOTION_WALK_START = "character.motion.walk_start",
    CHARACTER_MOTION_WALK = "character.motion.walk",
    CHARACTER_MOTION_WALK_END = "character.motion.walk_end",
    CHARACTER_MOTION_RUN_START = "character.motion.run_start",
    CHARACTER_MOTION_RUN = "character.motion.run",
    CHARACTER_MOTION_RUN_END = "character.motion.run_end",
    CHARACTER_ACTION_JUMP_START = "character.action.jump_start",
    CHARACTER_ACTION_JUMP = "character.action.jump",
    CHARACTER_ACTION_LAND = "character.action.land",
    CHARACTER_ACTION_CLIMB_START = "character.action.climb_start",
    CHARACTER_ACTION_CLIMB = "character.action.climb",
    CHARACTER_ACTION_CLIMB_END = "character.action.climb_end",
    CHARACTER_ACTION_CROUCH_START = "character.action.crouch_start",
    CHARACTER_ACTION_CROUCH = "character.action.crouch",
    CHARACTER_ACTION_CROUCH_END = "character.action.crouch_end",
    CHARACTER_ACTION_FALL_START = "character.action.fall_start",
    CHARACTER_ACTION_FALL = "character.action.fall",
    CHARACTER_ACTION_FALL_END = "character.action.fall_end",
    CHARACTER_ACTION_INTERACT = "character.action.interact",
    // Animation control events
    CHARACTER_ANIMATION_TRIGGER = "character.animation.trigger",
    CHARACTER_ANIMATION_STOP = "character.animation.stop",
    CHARACTER_ANIMATION_COMPLETE = "character.animation.complete",
    // Consumable events
    CONSUMABLE_IN_RANGE = "consumable.in.range",
    CONSUMABLE_NOT_IN_RANGE = "consumable.not.in.range",
    CONSUMABLE_COLLECTED = "consumable.collected",
    CONSUMABLE_COLLIDED = "consumable.collided",
    // Jumppad events
    JUMPPAD_ACTIVATED = "jumppad.activated",
    // Platform events
    PLATFORM_ACTIVATED = "platform.activated",
    PLATFORM_MOVING = "platform.moving",
    PLATFORM_DEACTIVATED = "platform.deactivated",
    // Volume events
    VOLUME_ACTIVATED = "volume.activated",
    // Randomized Spawner events
    RANDOMIZED_SPAWNER_ACTIVATED = "randomized.spawner.activated",
    // Spawn events
    SPAWN_ACTIVATED = "spawner.activated",
    // Teleport events
    TELEPORT_ACTIVATED = "teleport.activated",
    // NPC events
    NPC_INTERACTION_STARTED = "npc.interaction.started",
    NPC_INTERACTION_ENDED = "npc.interaction.ended",
    NPC_ACTION_STARTED = "npc.action.started",
    NPC_ACTION_ENDED = "npc.action.ended",
}

// -- behaviors/Behavior.ts --
export type WorkerRuntime = "play" | "editor";
export interface BehaviorThrottleConfig {
    throttlePriority: BehaviorThrottlePriority;
    enableFrustumCulling: boolean;
    enableDistanceThrottling: boolean;
    requiresConsistentUpdates: boolean;
    /** When true and object is off-screen, skip update entirely (not just throttled). Default false. */
    skipWhenInvisible?: boolean;
}
export interface AttributeChangeOptions {
    sync?: boolean;  // default: false (async)
}
export interface AttributeChangeResult {
    accepted: boolean;
    key: string;
    value?: any;
    previousValue?: any;
}
export interface BehaviorOptions {
    gameObject: GameObject;
    erth: ErthInterface;
    uuid?: string;
    attributes?: Record<string, any>;
    throttleConfig?: BehaviorThrottleConfig;
}
export type BehaviorConstructor = new (
    target: Object3D,
    id: string,
    options: BehaviorOptions
) => Behavior;
export interface Behavior {
    // The object that owns this behavior
    target: Object3D;
    setTarget(newTarget: Object3D): void;
    readonly gameObject: GameObject;
    readonly id: string; // example: "behavior.animation"
    readonly uuid: string; // unique uuid per instance
    /**
     * @deprecated Use getAttribute(key) instead. Direct attribute access will be removed in a future version.
     */
    readonly attributes: Record<string, any>;
    isPaused: boolean; // indicates if the behavior is paused

    // Explicit performance optimization configuration
    throttleConfig: BehaviorThrottleConfig;

    // Called when the behavior is instantiated, target is not set yet
    // If this function returns a promise, other behaviors will wait for it to resolve
    init(game: GameManager): void | Promise<void>;
    // Called when the behavior is disposed
    dispose(): void;

    // Called every frame to update the behavior (variable timestep)
    update(deltaTime: number): void;

    /**
     * Called at fixed timestep for physics-dependent logic (similar to Godot's _physics_process).
     * Runs from the legacy runtime loop when fixed-rate behavior updates are enabled.
     * The default fixed timestep is 60Hz unless the runtime overrides it.
     * Behaviors that need deterministic physics interaction should implement this method.
     * @param fixedDeltaTime - Fixed timestep in seconds (e.g., 1/60 = 0.0167s at 60Hz)
     */
    fixedUpdate?(fixedDeltaTime: number): void;

    /**
     * Called when the behavior is added to an object, target is set and you can access the object.
     * If this function returns a promise, the behavior will not be added until the promise is resolved.
     * @deprecated This method is deprecated in favor of `onStart`
     */
    onAdded?(): void | Promise<void>;

    /**
     * Called when the behavior is removed from an object.
     * @deprecated This method is deprecated, use `onStop` instead.
     */
    onRemoved?(): void;

    onStart(): void | Promise<void>; // TODO: call it after all behaviors are loaded
    onStop(): void;

    // Called when behavior is paused
    onPaused(): void;

    // Called when behavior is resumed
    onResumed(): void;

    // Called when the game is started or resumed
    onReset(): void;

    // Called when attributes are updated
    onAttributesUpdated(): void;

    // Read a single attribute by key
    getAttribute(key: string): any;

    // Request an attribute change on this behavior
    requestAttributeChange(key: string, value: any, options?: AttributeChangeOptions): Promise<AttributeChangeResult> | AttributeChangeResult;

    // Find a behavior by id on a target object (defaults to same object)
    findBehavior(id: string, target?: Object3D): Behavior | null;

    // Find all behaviors of a type in the scene
    findBehaviors(id: string): Behavior[];

    // Optional hook: accept/reject incoming attribute change requests. Return false to reject.
    onAttributeChangeRequested?(key: string, newValue: any, oldValue: any, requester: Behavior | null): boolean;

    // Optional hook: notified after an attribute was changed (granular, per-key)
    onAttributeChanged?(key: string, newValue: any, oldValue: any): void;

    // Called when MP state got updated in GameManager.storage
    onStateUpdated(key: string, value: string | undefined): void;

    // Called when an event is received (can be sync, async, or a generator)
    onEvent(msg: string, data: any): void | Promise<void> | Generator;

    // Worker class constructor. Two acceptable shapes:
    //  - Vite `?worker` import — a constructor that builds a Worker bundled at
    //    engine build time. Pair with the default Comlink-based bridge.
    //  - A plain `() => new Worker(url)` factory pointing at a `script` asset
    //    URL fetched via `erth.asset.script.getUrl()`. Pair with
    //    `workerOptions: { raw: true }` for raw `postMessage` worker sources.
    // Set in `init()` (the engine reads this after `init()` resolves) or pass
    // via `registerBehaviorClass(...workerConfig)` for engine-bundled behaviors.
    workerClass?: new () => Worker;

    /** Per-behavior worker options. `raw: true` skips Comlink wrapping. */
    workerOptions?: {
        raw?: boolean;
    };

    /**
     * Pool of N workers driven by one behavior. Set in `init()` to spawn a
     * pool instead of a single bridge. Requires raw mode (Comlink doesn't
     * pool naturally). When set, `postToWorker(type, data)` routes through
     * the pool's free-worker dispatcher.
     */
    workerPool?: {
        count: number;
    };

    // Main thread worker communication
    onWorkerMessage?(type: string, data: any): void;
    postToWorker?(type: string, data: any): void;
    getWorkerInitData?(runtime: WorkerRuntime): any;

    // Internal worker bridge instance (single-worker mode)
    _workerBridge?: BehaviorWorkerBridge;

    // Internal worker pool instance (set when workerPool.count > 1)
    _workerPool?: BehaviorWorkerPool;

    // Editor specific methods

    // Called when the behavior is added to the editor
    onEditorAdded?(editor: Editor): void;

    // Called when the behavior is removed from the editor
    // Beware its not called when editor is disposed, like when you switch to game mode
    onEditorRemoved?(): void;

    // Called when the editor is disposed, called when you switch to game mode or close the editor
    // Clean up any resources or listeners you added in onEditorAdded
    onEditorDispose?(): void;
    
    // Called when the editor is updated
    onEditorUpdate?(): void;

    // Called when the editor panel is shown
    onEditorPanelShown?(): void;

    // Called when the editor panel is hidden
    onEditorPanelHidden?(): void;

    // Called when the editor attributes are updated
    onEditorAttributesUpdated?(): void;

    // Called when a button in the editor panel is clicked
    onEditorButtonClicked?(action: string): void;

    // Called when an event is received in the editor mode
    onEditorEvent?(msg: string, data: any): void;

    // Storage for bound event listeners to prevent memory leaks
    _boundListeners?: Record<string, EventListener>;

    // Used to pass input methods to the behavior
    // TODO: remove this and find a better way to pass input methods to the behavior
    [key: string]: any;
}
declare class BehaviorBase implements Behavior {
  readonly erth: ErthInterface;
  readonly gameObject: GameObject;
  target: Object3D;
  readonly id: string;
  readonly uuid: string;
  readonly attributes: Record<string, any>;
  throttleConfig: BehaviorThrottleConfig;
  isPaused: boolean;
  _accumulatedDelta: number;
  onStateUpdated(key: string, value: string | undefined): void;
  init(game: GameManager): void | Promise<void>;
  dispose(): void;
  update(deltaTime: number): void;
  setTarget(newTarget: Object3D): void;
  onStart(): void | Promise<void>;
  onStop(): void;
  onPaused(): void;
  onResumed(): void;
  onReset(): void;
  onEvent(msg: string, data: any): void | Promise<void> | Generator;
  onAttributesUpdated(): void;
  onWorkerMessage(type: string, data: any): void;
  postToWorker(type: string, data: any): void;
  getWorkerInitData(runtime: WorkerRuntime): any;
  getAttribute(key: string): any;
  requestAttributeChange(key: string, value: any, options?: AttributeChangeOptions): Promise<AttributeChangeResult> | AttributeChangeResult;
  findBehavior(id: string, target?: Object3D): Behavior | null;
  findBehaviors(id: string): Behavior[];
}

// -- behaviors/game/GameManager.ts --
export interface IControl {
    attachPlayerObject(player: Object3D, characterOptions: CharacterOptionsInterface): Promise<void>;
}
declare class GameManager {
  static TOPIC: any;
  engine: EngineRuntime;
  sceneConfig: SceneConfig | null;
  readonly app: EngineRuntime;
  isEnabled: any;
  initialLives: any;
  initialHealth: any;
  maxScore: any;
  state: any;
  score: any;
  lives: any;
  health: any;
  pickedWeaponOrItem: THREE.Object3D;
  playerWeapons: THREE.Object3D[];
  ajax: any;
  inputManager: InputManager<PlayerActions>;
  pointerEventManager: PointerEventManager;
  physics: IPhysics;
  player: THREE.Object3D | null;
  uiCamera: THREE.Camera;
  readonly scene: THREE.Scene;
  readonly sceneHelpers: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: WebGPURenderer;
  animationController: AnimationController;
  animationGraphController: AnimationGraphController;
  audioController: AudioController;
  cameraControl: ICameraControl;
  objectPicker: IObjectPicker;
  multiplayerState: IMultiplayerState;
  discord: DiscordService;
  aiWorldController: AiWorldController;
  loginData: GameLoginData | null;
  hud: HUDManager;
  gameTimer: number;
  time_remaining: string;
  timerRunning: any;
  timerRemainingTime: number;
  playerStartingPosition: THREE.Vector3;
  instancer: Instancer;
  collisionDetector: CollisionDetector;
  behaviorFileLoader: BehaviorFileLoader;
  lambdaFileLoader: LambdaFileLoader;
  lambdaScriptInjector: LambdaScriptInjector;
  behaviorScriptInjector: BehaviorScriptInjector;
  behaviorManager: BehaviorManager;
  lambdaManager: LambdaManager;
  prefabManager: PrefabManager;
  isMultiplayer: boolean;
  tweenAnimations: any[];
  tweenGroupRef: {current: import("@tweenjs/tween.js").Group | null};
  behaviorScripts: Record<string, string>;
  behaviorNames: Record<string, string>;
  lambdaScripts: Record<string, string>;
  lambdaScriptRevisions: Record<string, {assetId: string; revisionId: string}>;
  aiConversationManager: AIConversationManager | null;
  cameraMinDistance: number;
  cameraMaxDistance: number;
  cameraFOV: number;
  cameraNear: number;
  cameraFar: number;
  cameraHeadHeight: number;
  config: any;
  cameraType: CAMERA_TYPES;
  getUnifiedGameServices(): UnifiedGameServicesController | null;
  setRenderer(renderer: THREE.WebGLRenderer | WebGPURenderer | null | undefined): void;
  isGameOver(): void;
  isWinner(): void;
  isGameStarted(): void;
  async create(physics: IPhysics, collisionSource: ICollisionSource, multiplayerState: IMultiplayerState, ctx: RuntimeContext, animationController: AnimationController, animationGraphController: AnimationGraphController, audioController: AudioController, useInstancing: boolean, isMultiplayer: boolean, tweenAnimations: any[]): void;
  async setupGamePlayerAccount(): void;
  setPlayer(player: Object3D | null | undefined): void;
  useAvatar(): void;
  getUserId(): void;
  getUserData(): IUser | null;
  hideLoginPopup(): void;
  showLoginPopup(): void;
  showLoginReminderPopup(): void;
  async getAvatar(): Promise<ModelData>;
  getAllBehaviorsFromObject(target: THREE.Object3D, behaviorToTargetMap: Map<string, Object3D>): BehaviorData[];
  addAllBehaviorsFromObject(target: THREE.Object3D): Promise<void>[];
  removeAllBehaviorsForObject(target: THREE.Object3D): void;
  loadSounds(sounds: ISoundSettings[]): void;
  playSound(soundId: string): void;
  stopSound(soundId: string): void;
  clearSounds(): void;
  reset(): void;
  async onMessage(topic: string, data: any): void;
  update(clock: any, delta: number): void;
  getTrackedObjects(): Map<string, THREE.Object3D>;
  handleTimeUpdate(topic: string, subs: string[], data: any): void;
  handleScoreUpdate(topic: string, subs: string[], data: any): void;
  async addBehaviorToObject(target: THREE.Object3D, behaviorId: string, behaviorOptions?: CreateBehaviorOptions): Promise<Behavior>;
  removeBehaviorByUUID(uuid: string): Behavior | null;
  updateBehaviorAttributes(uuid: string, updatedProperties: Record<string, any>): Behavior | null;
  async ensureLambdaClassLoaded({
        lambdaId,
        assetId,
        revisionId,
        config,
        code,
        forceReload = false,
    }: {
        lambdaId: string;
        assetId?: string;
        revisionId?: string;
        config?: LambdaConfig;
        code?: string;
        forceReload?: boolean;
    }): Promise<boolean>;
  setPhysicsConfig(object: Object3D, config: PhysicsConfig): void;
  async addObject(object: THREE.Object3D, parent?: THREE.Object3D): Promise<void>;
  removeObject(object: THREE.Object3D): void;
  cloneObject(sourceObject: THREE.Object3D): THREE.Object3D | null;
  async initializeObject(object: THREE.Object3D): Promise<void>;
  disposeObject(object: THREE.Object3D): void;
  pauseObject(object: THREE.Object3D, pauseChildren: boolean): void;
  resumeObject(object: THREE.Object3D, resumeChildren: boolean): void;
  playBlendedAnimations(object: THREE.Object3D, blends: BlendedAnimationParams[], playOnce?: boolean): void;
  updateBlendedAnimationWeights(object: THREE.Object3D, weights: {[name: string]: number}): void;
}

// -- editor/assets/v2/CodeEditor/types/lambda.d.ts --
/**
 * Lambda System Types for Lambda Scripts
 * This file is imported as a raw string for Monaco Editor IntelliSense
 */

interface Lambda {
    /** Lambda type ID */
    readonly id: string;
    /** Unique instance UUID */
    readonly uuid: string;
    /** Instance attributes */
    readonly attributes: Record<string, any>;
    /** Map of registered objects to their component data */
    readonly registeredObjects: ReadonlyMap<THREE.Object3D, Record<string, any>>;
    /** Number of registered objects */
    readonly entityCount: number;

    /** Called when the lambda instance is created. Access game via this._game after init. */
    init(game: GameManager): void | Promise<void>;
    /** Called when the lambda is destroyed */
    dispose(): void;
    /** Called every frame — override this instead of apply() */
    update(deltaTime?: number): void;
    /** Called when an object is registered with this lambda */
    onObjectAdded(target: THREE.Object3D, componentData: Record<string, any>): void;
    /** Called when an object is deregistered */
    onObjectRemoved(target: THREE.Object3D): void;
    /** Called when an event is sent to this lambda */
    onEvent(msg: string, data: any): void;

    /** Get component data for a registered object */
    getComponentData(target: THREE.Object3D): Record<string, any> | null;
    /** Set a component data field for a registered object */
    setComponentData(target: THREE.Object3D, key: string, value: any): void;
}

// -- editor/assets/v2/CodeEditor/types/uikit.d.ts --
/**
 * UIKit Types for Behavior Scripts
 * This file is imported as a raw string for Monaco Editor IntelliSense
 *
 * UIKit library for building 3D user interfaces with Three.js and yoga layout.
 * Components extend THREE.Mesh and can be added to any Object3D.
 *
 * @example
 * ```javascript
 * const container = new UIKit.Container({
 *     width: 300,
 *     height: 200,
 *     backgroundColor: 0x333333,
 *     borderRadius: 8
 * });
 * this.target.add(container);
 *
 * const text = new UIKit.Text({ text: 'Hello World', fontSize: 24 });
 * container.add(text);
 * ```
 */

declare const UIKit: {
    /**
     * Container component - the main building block for layouts.
     * Supports flexbox layout via yoga-layout.
     */
    Container: new (properties?: {
        width?: number;
        height?: number;
        backgroundColor?: number;
        backgroundOpacity?: number;
        borderRadius?: number;
        borderWidth?: number;
        borderColor?: number;
        padding?: number;
        paddingTop?: number;
        paddingBottom?: number;
        paddingLeft?: number;
        paddingRight?: number;
        margin?: number;
        flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
        justifyContent?: 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly';
        alignItems?: 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline';
        gap?: number;
        overflow?: 'visible' | 'hidden' | 'scroll';
        pointerEvents?: 'auto' | 'none';
        hover?: object;
        active?: object;
        onClick?: () => void;
        onPointerEnter?: () => void;
        onPointerLeave?: () => void;
        [key: string]: any;
    }) => THREE.Mesh & {
        update(delta: number): void;
        dispose(): void;
        add(...objects: THREE.Object3D[]): any;
        setProperties(properties: object): void;
    };

    /**
     * Text component for rendering text in 3D space.
     */
    Text: new (properties?: {
        text?: string;
        fontSize?: number;
        fontWeight?: number | 'normal' | 'bold';
        color?: number;
        opacity?: number;
        textAlign?: 'left' | 'center' | 'right';
        verticalAlign?: 'top' | 'center' | 'bottom';
        letterSpacing?: number;
        lineHeight?: number;
        maxLines?: number;
        [key: string]: any;
    }) => THREE.Mesh & {
        update(delta: number): void;
        dispose(): void;
        setProperties(properties: object): void;
    };

    /**
     * Image component for displaying images.
     */
    Image: new (properties?: {
        src?: string;
        width?: number;
        height?: number;
        objectFit?: 'fill' | 'contain' | 'cover';
        borderRadius?: number;
        opacity?: number;
        [key: string]: any;
    }) => THREE.Mesh & {
        update(delta: number): void;
        dispose(): void;
        setProperties(properties: object): void;
    };

    /**
     * Input component for text input.
     */
    Input: new (properties?: {
        value?: string;
        placeholder?: string;
        fontSize?: number;
        color?: number;
        backgroundColor?: number;
        borderRadius?: number;
        padding?: number;
        onValueChange?: (value: string) => void;
        [key: string]: any;
    }) => THREE.Mesh & {
        update(delta: number): void;
        dispose(): void;
        setProperties(properties: object): void;
    };

    /**
     * Fullscreen component - camera-facing UI that fills the viewport.
     */
    Fullscreen: new (renderer: any, properties?: {
        distanceToCamera?: number;
        [key: string]: any;
    }) => THREE.Mesh & {
        update(delta: number): void;
        dispose(): void;
        add(...objects: THREE.Object3D[]): any;
        setProperties(properties: object): void;
    };

    /**
     * Content component for scrollable content areas.
     */
    Content: new (properties?: object) => THREE.Mesh & {
        update(delta: number): void;
        dispose(): void;
        setProperties(properties: object): void;
    };

    /**
     * SVG component for rendering SVG graphics.
     */
    Svg: new (properties?: {
        src?: string;
        width?: number;
        height?: number;
        color?: number;
        [key: string]: any;
    }) => THREE.Mesh & {
        update(delta: number): void;
        dispose(): void;
        setProperties(properties: object): void;
    };

    /**
     * Video component for displaying video.
     */
    Video: new (properties?: {
        src?: string;
        width?: number;
        height?: number;
        autoplay?: boolean;
        loop?: boolean;
        [key: string]: any;
    }) => THREE.Mesh & {
        update(delta: number): void;
        dispose(): void;
        setProperties(properties: object): void;
    };

    // Utility exports
    setPreferredColorScheme: (scheme: 'light' | 'dark' | 'system') => void;
    getPreferredColorScheme: () => 'light' | 'dark' | 'system';
    isDarkMode: () => boolean;
};
/**
 * UIKit Pointer Events - Lazy initialization for UIKit interactions.
 * Only activates when UIKit roots exist, avoiding performance overhead.
 *
 * Reference counted - safe for multiple behaviors to use simultaneously.
 *
 * @example
 * ```javascript
 * // In init():
 * UIKitPointerEvents.initialize(game);
 *
 * // Create UI:
 * const ui = new UIKit.Container({ width: 200, height: 100 });
 * this.target.add(ui);
 * UIKitPointerEvents.registerRoot(ui);
 *
 * // In update():
 * UIKitPointerEvents.update(deltaTime);
 *
 * // In dispose():
 * UIKitPointerEvents.unregisterRoot(ui);
 * ui.dispose();
 * UIKitPointerEvents.deinitialize();
 * ```
 */
declare const UIKitPointerEvents: {
    /**
     * Initialize with GameManager. Call once in your behavior's init().
     * Reference counted - pair with deinitialize() in dispose().
     * @param game - The GameManager instance
     */
    initialize: (game: GameManager) => void;

    /**
     * Decrement init reference count. Call in your behavior's dispose().
     * Full cleanup occurs when ref count reaches 0 AND no roots exist.
     */
    deinitialize: () => void;

    /**
     * Register a UIKit component as a root.
     * Pointer events are enabled when the first root is registered.
     * @param component - The UIKit component (Container, Fullscreen, etc.)
     */
    registerRoot: (component: any) => void;

    /**
     * Unregister a UIKit root. Pointer events disabled when last root is removed.
     * @param component - The UIKit component to unregister
     */
    unregisterRoot: (component: any) => void;

    /**
     * Update pointer events and all UIKit roots. Call in your update() loop.
     * @param deltaTime - Time since last frame in seconds
     */
    update: (deltaTime?: number) => void;

    /**
     * Force cleanup - bypasses reference counting. Use sparingly.
     */
    forceDispose: () => void;

    /**
     * Check if pointer events system is active.
     */
    isActive: () => boolean;

    /**
     * Get number of active UIKit roots.
     */
    getRootCount: () => number;

    /**
     * Get current initialization reference count.
     */
    getInitRefCount: () => number;

    /**
     * Check if system is initialized (has game reference).
     */
    isInitialized: () => boolean;
};

// -- controls/AnimationController.ts --
export type BlendedAnimationParams = {
    name: string | THREE.AnimationClip;
    weight?: number;
    speed?: number;
    fadeDuration?: number;
};
export type StoredAnimationData = {
    mixer: THREE.AnimationMixer;
    speed: number;
    actions: THREE.AnimationAction[];
    blends: BlendedAnimationParams[];
    paused: boolean;
    onComplete?: () => void;
    //DEPRECATED: for backward compatibility only
    clip?: THREE.AnimationClip;
    action?: THREE.AnimationAction;
};
declare class AnimationController {
  game: GameManager | null;
  animations: StoredAnimationData[];
  requestAnimationFrameId: number;
  clock: THREE.Clock;
  gameStarted: boolean;
  start: any;
  playAnimation: any;
  playCustomAnimation: any;
  getMixer: any;
  static getCurrentAnimationParams(object: THREE.Object3D): BlendedAnimationParams[] | undefined;
  stopAnimation: any;
  setAnimationPaused: any;
  update: any;
  stop: any;
  dispose: any;
  playBlendedAnimations: any;
  updateBlendedAnimationWeights: any;
}

// -- controls/AnimationGraphController.ts --
export type AnimationGraphData = {
    graph: AnimationGraph;
    object: Object3D;
};
declare class AnimationGraphController {
  game: GameManager | null;
  graphs: AnimationGraphData[];
  clock: Clock;
  gameStarted: boolean;
  start: any;
  addGraph: any;
  playGraphState: any;
  setParameter: any;
  stopGraph: any;
  update: any;
  dispose: any;
}

// -- controls/VehicleControls.ts --
declare class VehicleControls implements IControl {
  chatActivated: boolean;
  physics: IPhysics;
  scene: Scene;
  camera: Camera;
  domElement: HTMLElement;
  player: Object3D;
  animations: any[];
  mixer: AnimationMixer | null;
  actions: any;
  currentAction: string | undefined;
  game: GameManager;
  walkDirection: any;
  rotateAngle: any;
  rotateQuarternion: any;
  isPhysicsEnabled: any;
  bbox: any;
  vec: any;
  updateVehicle: () => void;
  time: number;
  keysPressed: Record<string, boolean>;
  gamePaused: any;
  CameraControl: CameraControl | null;
  jumpCount: any;
  lastJumpTime: any;
  jump_strength: number;
  jump_duration: number;
  jumpStrength: number;
  playerGravity: number;
  cameraMINDistance: number;
  cameraMAXDistance: number;
  newAction: string | undefined;
  isJumping: boolean;
  spaceBarCooldown: boolean;
  isStopped: boolean;
  muzzle_flash: boolean;
  laser_effect: boolean;
  vehicle_selected_throwable: Object3D | undefined;
  vehicle_throwable_weight: number | undefined;
  vehicle_throwable_powerLevel: number | undefined;
  vehicle_throwable_bounceEffect: number | undefined;
  vehicle_throwable_aimer: number | undefined;
  vehicle_throwable_aimerGuide: string | undefined;
  vehicle_throwableVisible: string | undefined;
  vehicle_throwable_scale: number | undefined;
  vehicle_throwableMass: string | undefined;
  vehicle_throwableSpeed: number | undefined;
  vehicle_throwableLife: number | undefined;
  vehicle_throwableFriction: number | undefined;
  vehicle_throwableRestitution: number | undefined;
  vehicle_throwableInertia: number | undefined;
  throwables: THREE.Object3D[];
  throwableRigidBodies: any;
  playerFallingBack: boolean;
  playerIsDead: boolean;
  create(): Promise<VehicleControls>;
  init(): Promise<void>;
  getPlayerObject(): Object3D;
  disposeThrowable(throwableMesh: any): void;
  initializeActions(): {};
  animate: any;
  update: any;
  stopAnimation: any;
  setPlayerFallBack(): void;
  setPlayerIsDead(): void;
  resetKeysPressed(): void;
  dispose(): void;
  setOptionsFromCamera(): void;
  async initVehicle(leftFront: string, rightFront: string, leftRear: string, rightRear: string): void;
}

// ---- AICONTROLLER ----
// -- controls/AiWorldController/AiWorldController.types.ts --
export enum AI_OPERATION {
    DECISION_PROMPT = "decision_prompt",
    COMMANDS_PROMPT = "commands_prompt",
    ENHANCE_MODEL_PROMPT = "enhance_model_prompt",
    ENHANCE_IMAGE_PROMPT = "enhance_image_prompt",
    GENERATE_STEPS_PROMPT = "generate_steps_prompt",
    SEARCH_TAGS_PROMPT = "search_tags_prompt",
    EDIT_CODE_PROMPT = "edit_code_prompt",
}
export enum GENERATION_STEPS {
    ENCHANCE_PROMPT = "Enchancing prompt",
    GENERATE_IMAGE = "Generating image",
    REMOVE_BACKGROUND = "Removing background",
    UPLOAD_IMAGE = "Uploading image",
    GENERATING_MODEL = "Generating model",
    ANIMATING_MODEL = "Animating model",
    UPLOADING_MODEL = "Uploading model",
    ADDING_MODEL_TO_SCENE = "Adding model to scene",
}
export type GenerationStep = {
    step: string;
    function: string;
    parameters: any;
    description: string;
};
export enum GENERATION_STEPS_FUNCTIONS {
    ENCHANCE_PROMPT = "enchancePrompt",
    GENERATE_MODEL = "generate3dObject",
    ATTACH_BEHAVIORS = "attachBehaviors",
    MODIFY_MODEL = "modifyModelByCopilot",
}
export enum IMAGE_TYPES {
    CHARACTER = "Character",
    OBJECT = "Object",
    BACKDROP = "Backdrop",
    SKYBOX = "Skybox",
}
export enum TEXTURE_QUALITY {
    STANDARD = "standard",
    DETAILED = "detailed",
}
export enum MODEL_VERSION {
    V_25 = "v2.5-20250123",
    V_20 = "v2.0-20240919",
    V_14 = "v1.4-20240625",
}
export type AISearchTagsResponse = {
    tags: string[];
    width: number;
    height: number;
    followUpMessage: string;
};
export type ModelsSearchResponse = {
    NameResults: any[];
    TagResults: any[];
};
export type ExternalAssetsSearchResponse = {
    success: boolean;
    message: string;
    assets: any[];
    query: string;
};
export type AIResponse = {
    name: string;
    prompt: string;
    width: number;
    height: number;
    story: string;
    tags: string[];
    traits: string[];
    ai_agent_prompt: string;
    animations: string[];
};
//AI responses

export interface IAiTransformResponse {
    scale?: ITransformMessageData;
    rotation?: ITransformMessageData;
    position?: ITransformMessageData;
}
export interface IAiBehaviorsResponse {
    attach?: any[];
    detach?: any[];
    update?: (Partial<any> & Pick<any, "type">)[];
}
export interface IAiTextureResponse {
    prompt: string;
    twoSided: boolean;
    transparent: boolean;
}
export interface IAiResponse {
    modelUUID: string;
    name: string;
    transform?: IAiTransformResponse;
    behaviors?: IAiBehaviorsResponse;
    texture?: IAiTextureResponse;
}
export interface IAiAssistantResponse {
    assistantResponse: IAiResponse[];
}
export type AICodeEditResponse = {
    code: string;
    message: string;
};
export enum AI_DECISION_TYPE {
    CONVERSATION = "Conversation",
    COMMANDS = "Commands",
}
export type AiDecisionPromptResponse = {
    decision: AI_DECISION_TYPE;
};
export enum COMMANDS {
    ADD_OBJECT = "AddObject",
    REMOVE_OBJECT = "RemoveObject",
    SET_POSITION = "SetPosition",
    SET_ROTATION = "SetRotation",
    SET_SCALE = "SetScale",
    SET_MATERIAL_COLOR = "SetMaterialColor",
    SET_MATERIAL_VALUE = "SetMaterialValue",
    SET_GEOMETRY = "SetGeometry",
    MUTLI_CMDS = "MultiCmds",
    ATTACH_BEHAVIOR = "AttachBehavior",
    DETACH_BEHAVIOR = "DetachBehavior",
    UPDATE_BEHAVIOR = "UpdateBehavior",
    GENERATE_3D_OBJECT = "Generate3dObject",
    ADD_3D_OBJECT = "Add3dObject",
    GENERATE_ERTH_MODEL = "GenerateErthModel",
    SET_MATERIAL_TEXTURE = "SetMaterialTexture",
    COMPLETE = "Complete",
    // AI contextual commands
    GET_PLAYER_DATA = "GetPlayerData",
    GET_SCENE_DATA = "GetSceneData",
    GET_SELECTED_OBJECT_DATA = "GetSelectedObjectData",
    GET_OBJECT_DATA = "GetObjectData",
    GET_LOOK_AT_POINT = "GetLookAtPoint",
    GET_SEARCH_RESULTS = "GetSearchResults",
    GET_BEHAVIORS_CONFIG = "GetBehaviorsConfig",
}
export enum AI_AGENT_MODE {
    EDITOR = "editor",
    SANDBOX_GENERATION = "sandbox_generation",
}
export type AiCommand = {
    type: COMMANDS;
    params: any;
    requiresUserConfirmation?: boolean;
};
export type AiCommandsResponse = {
    response: string;
    threadId?: string;
    commands: AiCommand;
};
export type AiAgentRequest = {
    userMessage: string;
    params: {
        sceneData?: string;
        playerData?: string;
        selectedObjectData?: string;
        objectData?: string;
        behaviorConfig?: string;
        playerWidth?: string;
        playerHeight?: string;
        docs?: string;
        starterCode?: string;
        lookAtPointData?: string;
        searchResults?: string;
    };
};
export type PendingCommandData = {
    aiCommand: AiCommand | null;
    command: unknown;
    aiAgentRequest: AiAgentRequest | null;
};
export type CommandExecutionResult = {
    mainCommand: unknown;
    newCommands: AiCommand | null;
    response: string;
    allCommands: unknown[];
    pendingConfirmation?: PendingCommandData; // Command pending confirmation
};
export type RiggingMetadata = {
    isRigged: boolean;
    riggedWith?: string; // e.g., "meshy", "tripo"
    topology?: string; // e.g., "biped", "quadruped"
};

// -- controls/AiWorldController/docs.ts --


// ---- EVENT REGISTRY ----

type KnownEventTopics =
  | "DayNightCycle" |
  | "character.action.climb" |
  | "character.action.climb_end" |
  | "character.action.climb_start" |
  | "character.action.crouch" |
  | "character.action.crouch_end" |
  | "character.action.crouch_start" |
  | "character.action.dead" |
  | "character.action.fall" |
  | "character.action.fall_back" |
  | "character.action.fall_end" |
  | "character.action.fall_start" |
  | "character.action.interact" |
  | "character.action.jump" |
  | "character.action.jump_start" |
  | "character.action.land" |
  | "character.animation.complete" |
  | "character.animation.stop" |
  | "character.animation.trigger" |
  | "character.motion" |
  | "character.motion.none" |
  | "character.motion.run" |
  | "character.motion.run_end" |
  | "character.motion.run_start" |
  | "character.motion.walk" |
  | "character.motion.walk_end" |
  | "character.motion.walk_start" |
  | "character.motion_end" |
  | "character.motion_start" |
  | "consumable.collected" |
  | "consumable.collided" |
  | "consumable.in.range" |
  | "consumable.not.in.range" |
  | "device.orientation" |
  | "enemy.attack" |
  | "enemy.attack.ended" |
  | "enemy.attack.started" |
  | "enemy.died" |
  | "enemy.got.hit" |
  | "enemy.player.detected" |
  | "enemy.player.lost" |
  | "enemy.spawned" |
  | "enemy.state.changed" |
  | "game.health.dec" |
  | "game.health.inc" |
  | "game.lives.dec" |
  | "game.lives.inc" |
  | "game.loginSuccess" |
  | "game.pause" |
  | "game.score.dec" |
  | "game.score.inc" |
  | "game.time.dec" |
  | "game.time.inc" |
  | "gameCloseAndSave" |
  | "gameClosed" |
  | "gameCreated" |
  | "gameEnded" |
  | "gameError" |
  | "gameMultiplayerError" |
  | "gamePaused" |
  | "gamePlayerError" |
  | "gameResumed" |
  | "gameServices.authenticated" |
  | "gameStarted" |
  | "healthUpdate" |
  | "jumppad.activated" |
  | "npc.action.ended" |
  | "npc.action.started" |
  | "npc.interaction.ended" |
  | "npc.interaction.started" |
  | "platform.activated" |
  | "platform.deactivated" |
  | "platform.moving" |
  | "playerAddedListener" |
  | "randomized.spawner.activated" |
  | "spawner.activated" |
  | "teleport.activated" |
  | "volume.activated";
