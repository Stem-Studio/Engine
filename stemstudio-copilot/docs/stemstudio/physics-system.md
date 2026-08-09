# Physics System

Ammo.js and Rapier3D physics — body shapes, collision types, joints, and character controller.

> **Authoritative type source:** `stem-types.d.ts` (generated from `web/src/physics/common/types.ts` and `web/src/physics/common/events.ts`)

## Engines

Two physics engines are available, selected via factory pattern. Engine choice is **scene-level** (`scene.userData.physics.engine`); all physics-enabled objects in a scene share the same engine instance.

| Engine | `engine` value | Status | Notes |
|--------|----------------|--------|-------|
| **Ammo (Bullet)** | `"ammo"` | Default, most mature | Widest feature coverage (vehicles, character controller, joints) |
| **Rapier** | `"rapier"` | Stable | Supports rigid bodies, vehicles, character controllers, and joints |

```typescript
enum PhysicsEngineType {
  Ammo   = "ammo",
  Rapier = "rapier",
}
```

Source: `web/src/physics/ammo/`, `web/src/physics/rapier/`
Factory: `web/src/physics/PhysicsEngineFactory.ts`

Set the engine via the `set_physics_engine` command (alias `physics engine <type> [gravity=<n>]`) or the editor's Project Settings panel. Both write `scene.userData.physics.engine` and round-trip cleanly through scene export.

## Body Shape Types

Defined in `web/src/physics/common/types.ts`:

```typescript
enum BodyShapeType {
  BOX          = "btBoxShape",
  SPHERE       = "btSphereShape",
  CAPSULE      = "btCapsuleShape",
  CONVEX_HULL  = "btConvexHullShape",
  CONCAVE_HULL = "btConcaveHullShape",
}
```

| Shape | Value | Use case |
|-------|-------|----------|
| BOX | `"btBoxShape"` | Boxes, walls, floors |
| SPHERE | `"btSphereShape"` | Balls, round objects |
| CAPSULE | `"btCapsuleShape"` | Characters, NPCs |
| CONVEX_HULL | `"btConvexHullShape"` | Irregular convex meshes |
| CONCAVE_HULL | `"btConcaveHullShape"` | Complex static geometry (triangle mesh) |

### Shape Data Types

Each shape carries geometry-specific data alongside `CommonData`:

```typescript
interface BoxShape {
  type: BodyShapeType.BOX;
  width: number;
  height: number;
  length: number;
}

interface SphereShape {
  type: BodyShapeType.SPHERE;
  radius: number;
}

interface CapsuleShape {
  type: BodyShapeType.CAPSULE;
  radius: number;
  height: number;
}

interface ConvexHullShape {
  type: BodyShapeType.CONVEX_HULL;
  vertices: number[];
}

interface ConcaveHullShape {
  type: BodyShapeType.CONCAVE_HULL;
  vertices: number[][];
  indexes: number[][];
}

type CollisionShape =
  | BoxShape
  | SphereShape
  | ConvexHullShape
  | ConcaveHullShape
  | CapsuleShape;
```

Composite data types for adding bodies:

| Type | Definition |
|------|------------|
| `BoxData` | `CommonData & BoxShape` |
| `SphereData` | `CommonData & SphereShape` |
| `CapsuleData` | `CommonData & CapsuleShape` |
| `ConvexHullData` | `CommonData & ConvexHullShape` |
| `ConcaveHullData` | `CommonData & ConcaveHullShape` |
| `ModelData` | `CommonData & { vertices, matrices, indexes, scale }` (deprecated) |
| `TerrainData` | `CommonData & { terrainWidth, terrainDepth, heightData, ... }` (deprecated) |

Legacy UI mapping (`web/src/editor/assets/v2/types/physics.ts`):
- `btBoxShape` -> "BoxShape"
- `btSphereShape` -> "SphereShape"
- `btCapsuleShape` -> "CapsuleShape"
- `btConvexHullShape` -> "ConvexHullShape"
- `btConcaveHullShape` -> "ConcaveHullShape"

## Collision Flags

```typescript
const COLLISION_FLAGS = {
  CF_DYNAMIC_OBJECT:   0,
  CF_STATIC_OBJECT:    1,
  CF_KINEMATIC_OBJECT: 2,
};

enum CollisionFlag {
  DYNAMIC   = 0,  // CF_DYNAMIC_OBJECT — mass > 0, affected by forces/gravity
  KINEMATIC = 2,  // CF_KINEMATIC_OBJECT — scripted motion, not affected by forces
  STATIC    = 1,  // CF_STATIC_OBJECT — mass = 0, immovable
}
```

String-to-flag mapping:

```typescript
const COLLISION_MAP = new Map([
  ["Dynamic",   CollisionFlag.DYNAMIC],
  ["Kinematic", CollisionFlag.KINEMATIC],
  ["Static",    CollisionFlag.STATIC],
]);
```

## Collision Types

Used for registering collision detection listeners:

```typescript
enum COLLISION_TYPE {
  UNKNOWN              = -1,
  WITH_PLAYER          = 0,
  WITH_COLLIDABLE_OBJECTS = 1,
  WITH_ENEMY           = 2,
}
```

Source: `web/src/types/editor.ts`

## Collision Behavior

```typescript
enum CollisionBehavior {
  Ghost   = 'ghost',    // No physics response, triggers callbacks only
  Regular = 'regular',  // Full physics response + callbacks
}
```

## CommonData (Rigid Body Config)

Passed when adding any physics body:

```typescript
type CommonData = {
  uuid: string;
  template: string;           // template uuid
  name: string;
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
  scale: { x: number; y: number; z: number };
  mass: number;
  restitution?: number;
  friction: number;
  rollingFriction: number;
  spinningFriction: number;
  contactStiffness: number;
  contactDamping: number;
  damping?: { linear: number; angular: number };
  collision_flag?: CollisionFlag;
  rotationLock?: { x: boolean; y: boolean; z: boolean };
};
```

## Physics Config (userData)

Stored in `object.userData.physics`:

```typescript
interface PhysicsConfig {
  enabled: boolean;
  shape: BodyShapeType;           // BOX, SPHERE, etc.
  mass: number;                   // 0 = static
  friction: number;               // 0-1
  restitution: number;            // Bounciness, 0-1
  rollingFriction: number;
  spinningFriction: number;
  contactStiffness: number;
  contactDamping: number;
  ctype: "Static" | "Dynamic" | "Kinematic";
  anchorOffset: { x, y, z };     // Shape offset from object origin
  anchorScale: { x, y, z };      // Shape scale relative to object
  userShapeOffset?: { x, y, z }; // User-supplied shape offset
  userShapeScale?: { x, y, z };  // User-supplied shape scale
  rotationLock?: { x, y, z };    // Lock rotation axes (boolean per axis)
  climbable: boolean;
  collision_material: string;     // Material preset name
  enable_preview: boolean;
}
```

## Collision Material Types

Pre-defined physics material tunings with restitution, friction, stiffness, and damping.

Source: `COLLISION_MATERIAL_TYPE` enum in `web/src/types/editor.ts` and `stem-events-registry.json`:

| Enum Key | Value |
|----------|-------|
| `CUSTOM` | `"Custom"` |
| `METAL` | `"Metal"` |
| `DIRT` | `"Dirt"` |
| `GROUND` | `"Ground"` |
| `PLASTIC` | `"Plastic"` |
| `SNOW` | `"Snow"` |
| `WOOD` | `"Wood"` |
| `CONCRETE` | `"Concrete"` |
| `MUD` | `"Mud"` |
| `ICE` | `"Ice"` |
| `SLIME` | `"Slime"` |
| `WATER` | `"Water"` |
| `SLIPPERY_GROUND` | `"Slippery ground"` |
| `RUBBER` | `"Rubber"` |
| `SAND` | `"Sand"` |

## Default Values

| Constant | Value |
|----------|-------|
| `DEFAULT_GRAVITY` | -9.81 |
| `DEFAULT_RIGID_BODY_MASS` | 0.0 |
| `DEFAULT_RIGID_BODY_FRICTION` | 0.5 |
| `DEFAULT_RIGID_BODY_RESTITUTION` | 0.5 |
| `DEFAULT_RIGID_BODY_LINEAR_DAMPING` | 0.0 |
| `DEFAULT_RIGID_BODY_ANGULAR_DAMPING` | 0.0 |
| `DEFAULT_STEP_DURATION` | 1/60 (60 FPS) |
| `DEFAULT_SCALE` | `{ x: 1, y: 1, z: 1 }` |

---

## IPhysics Interface (Complete API)

The `IPhysics` interface is the core abstraction implemented by both engines (Ammo.js and Rapier). All methods below are defined in `web/src/physics/common/types.ts` and mirrored in `stem-types.d.ts`.

### Engine Type Queries

```typescript
isMultiplayer(): boolean;
isWorker(): boolean;
isLocal(): boolean;
```

### World

```typescript
getGravity(): number;
```

### Lifecycle

```typescript
start(): Promise<void>;
terminate(): void;
simulate(deltaTime: number): void;
pause(): void;
resume(): void;
initDebug(): Object3D | null;
ping(): Promise<void>;  // checks that physics has processed all events and ready for more
```

### Local Cache (Object Tracking)

```typescript
addObject(uuid: string, mass: number, collisionFlag: CollisionFlag, object: Object3D): CollisionFlag;
removeObject(uuid: string): void;
getDynamicBodyObject(uuid: string): Object3D | undefined;
getKinematicBodyObjects(): Map<string, Object3D>;
```

### Adding Bodies

```typescript
addBody(object: Object3D, shapeUuid: string, data: CommonData): void;
addBox(object: Object3D, data: BoxData): void;
addSphere(object: Object3D, data: SphereData): void;
addCapsuleShape(object: Object3D, data: CapsuleData): void;
addConvexHull(object: Object3D, data: ConvexHullData): void;
addConcaveHull(object: Object3D, data: ConcaveHullData): void;
/** @deprecated */ addModel(object: Object3D, data: ModelData): void;
/** @deprecated */ addTerrain(object: Object3D, data: TerrainData): void;
remove(uuid: string): void;
removePrefab(uuid: string): void;
```

### Shape Management

```typescript
addShape(uuid: string, collisionShape: CollisionShape): void;
removeShape(uuid: string): void;
hasShape(uuid: string): boolean;
setRigidBodyShape(uuid: string, newShapeUuid: string): void;
```

### Forces, Velocity, and Transforms

```typescript
// Apply forces
applyCentralImpulse(uuid: string, impulse: Vector3): void;
applyImpulseToRigidBody(uuid: string, impulse: Vector3, relativePosition: Vector3): void;

// Set velocity
setLinearVelocity(uuid: string, velocity: Vector3): void;

// Set position and rotation
setOrigin(uuid: string, position: Vector3Like): void;
setRotation(uuid: string, quaternion: QuaternionLike): void;

// Set scale (deprecated)
/** @deprecated */ setScale(uuid: string, scale: Vector3Like): void;
```

### Collision Detection

```typescript
addCollidableObject(uuid: string): void;
removeCollidableObject(uuid: string): void;
detectCollisionsForObject(uuid: string, registration: CollisionRegistration, enable: boolean): void;
setCollisionBehavior(uuid: string, behavior: CollisionBehavior): void;
```

Where `CollisionRegistration` is:

```typescript
interface CollisionRegistration {
  id: string;
  type: COLLISION_TYPE;  // WITH_PLAYER, WITH_COLLIDABLE_OBJECTS, WITH_ENEMY
}
```

### Multiplayer-Specific

```typescript
setCurrentAnimation(uuid: string, animation: string): void;
addOtsShiftVector(otsShiftVector: Vector3): void;
```

---

## Joints (Constraints)

Three joint types connect two rigid bodies. All joint methods accept a `collisionEnabled` boolean to control whether the connected bodies collide with each other.

### Fixed Joint

Locks two bodies together with no relative movement:

```typescript
addFixedJoint(
  collisionEnabled: boolean,
  uuidA: string,
  uuidB: string,
  vec3PivotB: Vector3,          // pivot point on body B
  vec4RotationB: QuaternionLike // rotation offset on body B
): void;
```

### Hinge Joint

Allows rotation around a single axis (like a door or wheel):

```typescript
addHingeJoint(
  collisionEnabled: boolean,
  uuidA: string,
  uuidB: string,
  hingeAxis: Vector3Like,       // axis of rotation
  relPos: Vector3Like,          // relative position
  relRotation: QuaternionLike,  // relative rotation
  angularLimitEnabled: boolean, // enable angular limits
  angularLimit: Vector3Like,    // { x: lowerLimit, y: upperLimit, z: softness }
  motorEnabled: boolean,        // enable motor
  motorSpeed: number,           // motor target speed
  motorTorque: number           // motor max torque
): void;
```

### Point-to-Point Joint (Ball-Socket)

Allows free rotation around a shared pivot point:

```typescript
addPoint2PointJoint(
  collisionEnabled: boolean,
  uuidA: string,
  vec3PivotA: Vector3,  // pivot point on body A
  uuidB: string,
  vec3PivotB: Vector3   // pivot point on body B
): void;
```

### Remove Joint

```typescript
removeJoint(uuidA: string, uuidB: string): void;
```

---

## Character Controller (Player API)

The character controller manages player movement, gravity, and ground detection. These methods are part of `IPhysics`.

### Default Constants

- Step height: `0.5` units
- Max slope: `60` degrees (converted to radians internally)
- Player gravity: `-10.0`
- Jump height: `1.0`
- Collision group: `2`, Collision mask: `0xffff`

### IPlayerOptions

```typescript
interface IPlayerOptions {
  playerGravity: number;
  jumpHeight: number;
  maxSlope: number;
}
```

### Player Methods

```typescript
// Add a player object with optional kinematic character controller
addPlayerObject(uuid: string, useController: boolean, options?: IPlayerOptions): Promise<Object3D | null>;

// Remove a player object
removePlayerObject(uuid: string): void;

// Move player with walk direction vector and jump flag
movePlayerObject(uuid: string, walkDirection: Vector3, jump: boolean): void;

// Set player gravity acceleration
setPlayerGravity(uuid: string, acceleration: Vector3Like): void;

// Adjust player speed (multiplier per axis)
setPlayerSpeedAdjustment(uuid: string, speedAdjustment: Vector3): void;

// Teleport player to a position
setPlayerPosition(uuid: string, position: Vector3): void;

// Apply impulse to player
applyImpulseToPlayer(uuid: string, impulse: Vector3): void;
```

### Ammo.js Implementation Notes

Ammo.js creates a `btPairCachingGhostObject` + `btKinematicCharacterController` for player objects when `useController` is true.

---

## Dispatcher (Physics Callbacks)

The dispatcher receives updates from the physics engine:

```typescript
interface IDispatcher {
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
```

### ObjectMotionState

Provided in `onBodyUpdate` for bodies that support motion tracking:

```typescript
type ObjectMotionState = {
  onGround: boolean;
  linearVelocity: Vector3Like;
}
```

### CollisionData

```typescript
type CollisionData = {
  uuid: string;
  listenerId: string;
};

interface ICollisionSource {
  addCollisionListener(listener: (collision: CollisionData) => void): void;
}
```

---

## PHYSICS_EVENTS

All physics engine communication events, defined in `web/src/physics/common/events.ts`:

### Lifecycle Events

| Event | Value |
|-------|-------|
| `TERMINATE` | `"physics:terminate"` |
| `READY` | `"physics:ready"` |
| `START` | `"physics:start"` |
| `SIMULATE` | `"physics:simulate"` |
| `UPDATE` | `"physics:update"` |
| `PAUSE` | `"physics:pause"` |
| `RESUME` | `"physics:resume"` |
| `PING` | `"physics:ping"` |
| `PONG` | `"physics:pong"` |

### Add Events

| Event | Value |
|-------|-------|
| `ADD.BODY` | `"physics:add:body"` |
| `ADD.BOX` | `"physics:add:box"` |
| `ADD.SPHERE` | `"physics:add:sphere"` |
| `ADD.CAPSULE` | `"physics:add:capsule"` |
| `ADD.CONVEXHULL` | `"physics:add:convexhull"` |
| `ADD.CONCAVEHULL` | `"physics:add:concavehull"` |
| `ADD.VEHICLE` | `"physics:add:vehicle"` |
| `ADD.MODEL` | `"physics:add:model"` |
| `ADD.PLAYER` | `"physics:add:player"` |
| `ADD.TERRAIN` | `"physics:add:terrain"` |
| `ADD.SHAPE` | `"physics:add:shape"` |

### Constraint Events

| Event | Value |
|-------|-------|
| `ADD.CONSTRAINT.FIXED` | `"physics:add:constraint:fixed"` |
| `ADD.CONSTRAINT.P2P` | `"physics:add:constraint:p2p"` |
| `ADD.CONSTRAINT.HINGE` | `"physics:add:constraint:hinge"` |

### Remove Events

| Event | Value |
|-------|-------|
| `REMOVE.RIGID_BODY` | `"physics:remove:rigid_body"` |
| `REMOVE.SHAPE` | `"physics:remove:shape"` |
| `REMOVE.CONSTRAINT` | `"physics:remove:constraint"` |

### Apply Events (Forces/Impulses)

| Event | Value |
|-------|-------|
| `APPLY.CENTRAL_IMPULSE` | `"physics:apply:central_impulse"` |
| `APPLY.IMPULSE_TO_RIGIDBODY` | `"physics:apply:impulse_to_rigidbody"` |

### Set Events (Transform/State)

| Event | Value |
|-------|-------|
| `SET.ORIGIN` | `"physics:set:origin"` |
| `SET.ROTATION` | `"physics:set:rotation"` |
| `SET.SCALE` | `"physics:set:scale"` |
| `SET.LINEAR_VELOCITY` | `"physics:set:linear_velocity"` |
| `SET.COLLISION_BEHAVIOR` | `"physics:set:collision_behavior"` |

### Body Update Events

| Event | Value |
|-------|-------|
| `BODY.UPDATE` | `"physics:body:update"` |

### Player Events

| Event | Value |
|-------|-------|
| `PLAYER.ADD` | `"physics:player:add"` |
| `PLAYER.READY` | `"physics:player:ready"` |
| `PLAYER.REMOVE` | `"physics:player:remove"` |
| `PLAYER.MOVE` | `"physics:player:move"` |
| `PLAYER.APPLY_IMPULSE` | `"physics:player:apply_impulse"` |
| `PLAYER.SET_GRAVITY` | `"physics:player:set_gravity"` |
| `PLAYER.SET_POSITION` | `"physics:player:set_position"` |

### Collision Events

| Event | Value |
|-------|-------|
| `COLLISION.DETECTED` | `"physics:collision:detected"` |
| `COLLISION.DETECT` | `"physics:collision:detect"` |
| `COLLISION.ADD.OBJECT` | `"physics:collision:add:object"` |
| `COLLISION.REMOVE.OBJECT` | `"physics:collision:remove:object"` |

### Animation Events

| Event | Value |
|-------|-------|
| `ANIMATION.SET` | `"physics:animation:set"` |

### Batch Events

| Event | Value |
|-------|-------|
| `BATCH.UPDATE` | `"physics:batch:update"` |

### Event Data Interfaces

```typescript
interface BatchObjectUpdate {
  position: Vector3Like | null;
  quaternion: QuaternionLike | null;
  scale: Vector3Like | null;
}

interface BatchUpdateEvent {
  event: typeof PHYSICS_EVENTS.BATCH.UPDATE;
  objects: Record<string, BatchObjectUpdate>;
}

interface AddShapeEvent {
  uuid: string;
  shape: CollisionShape;
}

interface RemoveShapeEvent {
  uuid: string;
}

interface AddBodyEvent extends CommonData {
  shapeUuid: string;
}

interface SetCollisionBehaviorEvent {
  uuid: string;
  behavior: CollisionBehavior;
}
```

---

## Vehicle Physics

The vehicle system provides Ammo.js-based vehicle simulation with configurable chassis, wheels, suspension, and drive controls. Vehicles are managed through the `IPhysics` interface.

### Vehicle Types

```typescript
interface VehicleInput {
    throttle: number;   // -1 to 1 (reverse to forward)
    steer: number;      // -1 to 1 (left to right)
    brake: number;      // 0 to 1
}

interface VehicleWheelSpec {
    name: string;
    isFront: boolean;
    radius: number;
    width: number;
    connection: { x: number; y: number; z: number };
    wheelObjectUuid?: string;   // optional wheel mesh
    wheelObject?: Object3D;
}

interface VehicleSpec {
    chassisObjectUuid: string;
    chassisObject?: Object3D;
    chassis: {
        halfExtents: { x: number; y: number; z: number };
        centerOffset: { x: number; y: number; z: number };
        initialTransform: {
            position: { x: number; y: number; z: number };
            quaternion: { x: number; y: number; z: number; w: number };
        };
    };
    wheels: VehicleWheelSpec[];
}

interface VehicleOptions {
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
```

### Vehicle Methods (IPhysics)

```typescript
// Create a vehicle with chassis and wheel configuration
addVehicleObject(vehicleUuid: string, spec: VehicleSpec, options: VehicleOptions): Promise<void>;

// Remove a vehicle and clean up physics bodies
removeVehicleObject(vehicleUuid: string): void;

// Drive the vehicle each frame with throttle/steer/brake input
moveVehicleObject(vehicleUuid: string, input: VehicleInput): void;
```

### Vehicle Physics Events

| Event | Value |
|-------|-------|
| `ADD.VEHICLE` | `"physics:add:vehicle"` |

### VehicleControls

`VehicleControls` (`web/src/controls/VehicleControls.ts`) is the high-level controller that manages vehicle creation, keyboard input mapping, wheel mesh synchronization, and Ammo.js `btRaycastVehicle` integration. It handles suspension tuning, engine/brake force application, and per-wheel transform updates each frame.

---

## Agent Commands

| Command | Method | Required Params | Optional Params |
|---------|--------|-----------------|-----------------|
| `enable_physics` | POST | target | — |
| `disable_physics` | POST | target | — |
| `set_physics` | POST | target, config | — |
| `set_physics_engine` | POST | type | gravity |

The `config` object for `set_physics` accepts any `PhysicsConfig` property listed in §"Physics Config (userData)" above. Important casing rules:

- **`ctype`** uses `CollisionType` enum values: **PascalCase** `"Static"` / `"Dynamic"` / `"Kinematic"`. Runtime `COLLISION_MAP` (`web/src/physics/common/types.ts:281`) requires this exact casing — lowercase falls through to undefined `collision_flag`.
- **`shape`** uses lowercase friendly names (`"box"` / `"sphere"` / `"capsule"` / `"convexHull"` / `"concaveHull"`). Legacy `"trimesh"` → `"concaveHull"` and `"cylinder"` → `"capsule"` are remapped. The internal `Shape` enum form (`"btBoxShape"` etc.) also passes through.
- **`bounciness_preset`** and **`collision_material`** use the labels in the preset table below (e.g. `"Rubber"`, `"Slippery Ground"` with the space, `"Custom"`).
- **`bodyType` is NOT a field.** Use `ctype`. Older copilot scripts and one editor type alias use `bodyType`; both are wrong and silently ignored.

`set_physics_engine` writes `scene.userData.physics.engine` (and optionally `scene.userData.physics.gravity`). Takes effect at next scene load.

---

## Physics Defaults by Genre

Anchored on `bounciness_preset` (engine-tuned numbers) plus per-genre `ctype` / shape / gravity / pitfall guidance. Pick the preset row to get `restitution`/`friction`/`contactStiffness`/`contactDamping` for free, then override `mass` / `ctype` / `shape` / `rotationLock` per object. Recommendations, not validator-enforced.

| Genre | Gravity | Player `ctype` | Player shape | Env `ctype` | Env shape | Env preset | Player preset | Ball / projectile preset | Notable |
|---|---|---|---|---|---|---|---|---|---|
| platformer | -20 (range -50..-5) | Dynamic or Kinematic | capsule | Static | concaveHull | Concrete | Custom | — | rotationLock `{x:true,z:true}` on player; restitution 0 on platforms |
| endless-runner | -25 | Kinematic | capsule | Static | box | Concrete | Custom | — | direct position writes; chunked level streaming |
| fps-shooter | -9.81 | Dynamic | capsule | Static | concaveHull | Concrete | Custom | Metal (rocket) / Rubber (grenade) | hitscan via raycast; physics for projectiles only |
| fighting | -20 | Kinematic | capsule | Static | box | Concrete | Custom | — | knockback via `applyCentralImpulse`; arena walls Static |
| racing-kart | -9.81 | Kinematic (arcade) or Dynamic+vehicle (sim) | box (chassis) | Static | concaveHull | Ground (track) / Slippery Ground (drift) / Ice (hazard) | Custom | — | `addVehicleObject` not on Rapier; raycast ground OK for arcade |
| sports | -9.81 | Kinematic | capsule | Static | concaveHull | Ground | Custom | Rubber (ball) | dynamic ball; trigger zones for goal detection |
| action-adventure | -9.81 | Dynamic | capsule | Static | concaveHull | Ground / Wood | Custom | — | mixed environments; hinge joints on doors |
| collectathon | -9.81 | Dynamic | capsule | Static | concaveHull | Ground | Custom | — | trigger volumes (not physics) for pickups |
| horror | -9.81 | Dynamic | capsule (tight radius) | Static | concaveHull | Wood / Concrete | Custom | — | hinge joints on doors; physics objects sparingly |
| puzzle-exploration | -9.81 (or 0 for zero-G puzzles) | Kinematic | box or capsule | Static | box | Plastic / Wood | Custom | — | restitution 0 on most blocks |
| top-down-action | 0 (or low) | Kinematic | capsule | Static | box | Ground | Custom | — | gravity often disabled; physics for knockback only |
| tower-defense | -9.81 | n/a | — | Static | box | Ground | — | Metal (projectile) | only enemy bodies + projectile spheres |
| turn-based-strategy | 0 | n/a | — | Static | box | Ground | — | — | physics rarely needed |
| simulation-management | -9.81 | n/a | — | Static | concaveHull | Ground | — | — | physics largely cosmetic |
| survival-crafting | -9.81 | Dynamic | capsule | Static | concaveHull | Ground / Wood | Custom | — | dynamic resource nodes; trees concaveHull |
| roleplay-social | -9.81 | Dynamic | capsule | Static | concaveHull | Ground | Custom | — | low physics density; player + a few interactives |
| simulator-tycoon | -9.81 | n/a (or Dynamic if avatar) | capsule | Static | concaveHull | Ground / Concrete | Custom | — | physics for avatar movement; props mostly Static |

**Why "Custom" for the player preset:** `Custom` is the engine default (0.5 across all four numbers). Player tuning is gameplay-specific and usually wants the friction/restitution baked into the controller logic rather than the rigidbody. Leave the preset `Custom` and set `rotationLock: {x:true, y:false, z:true}` and any character-specific values explicitly.

**Why most environments are `Static`:** static bodies have `mass=0` and never move. They're cheap, deterministic, and the right choice for floors / walls / track geometry. Use `concaveHull` for geometry-precise collision; use `box` for simple convex environments.

These defaults are advisory, not validator-enforced. Tuning recommendations don't get mechanised because they vary by gameplay intent. The body-type-by-scenario decision matrix (Dynamic vs Kinematic vs Static) **is** correctness — see the importer's `physics-guide.md` §11 for the full matrix.

---

## Material & Bounciness Presets

Two related enums in the engine, both reachable via `set_physics ... config={...}`:

- **`bounciness_preset`** — string label that the engine maps to four numeric values (`restitution`, `friction`, `contactStiffness`, `contactDamping`). Set this and the engine fills the four numbers from `BOUNCINESS_PRESET_VALUES` (`web/src/editor/assets/v2/types/physics.ts:42`). Use this as the primary tuning lever.
- **`collision_material`** — label drawn from `COLLISION_MATERIAL_TYPE` (see "Collision Material Types" above). Functionally similar; preserved for editor parity.

Use the **same label** for both unless you have a specific reason to diverge.

### Preset table (engine-tuned)

Source: `web/src/editor/assets/v2/types/physics.ts:42` (`BOUNCINESS_PRESET_VALUES`).

| Preset (label string) | restitution | friction | contactStiffness | contactDamping | Use for |
|---|---|---|---|---|---|
| `Custom` | 0.5 | 0.5 | 0.5 | 0.25 | Default — matches engine fallback |
| `Metal` | 0.4 | 0.35 | 0.95 | 0.08 | Metallic surfaces, projectiles, vehicle chassis |
| `Dirt` | 0.15 | 0.7 | 0.3 | 0.45 | Dirt paths, gravel, unpaved ground |
| `Ground` | 0.2 | 0.55 | 0.5 | 0.3 | Generic outdoor terrain (default for level geometry) |
| `Plastic` | 0.45 | 0.3 | 0.55 | 0.2 | Toy / puzzle blocks, lightweight props |
| `Snow` | 0.05 | 0.15 | 0.1 | 0.7 | Snow surfaces — low friction, soft, no bounce |
| `Wood` | 0.35 | 0.45 | 0.7 | 0.25 | Wooden structures, doors, crates |
| `Concrete` | 0.25 | 0.65 | 0.9 | 0.15 | Walls, floors, urban environments |
| `Mud` | 0.0 | 0.8 | 0.05 | 0.95 | Mud — sticks; very high friction, no bounce |
| `Ice` | 0.3 | 0.03 | 0.85 | 0.1 | Ice surfaces — near-zero friction |
| `Slime` | 0.4 | 0.15 | 0.08 | 0.8 | Slime / goo — soft, sticky-ish |
| `Water` | 0.02 | 0.05 | 0.02 | 0.5 | Water (when treated as collidable) |
| `Slippery Ground` | 0.25 | 0.08 | 0.45 | 0.25 | Drift zones, oil slicks, ice patches on roads |
| `Rubber` | 0.85 | 0.9 | 0.35 | 0.35 | Bouncy balls, tires |
| `Sand` | 0.1 | 0.6 | 0.2 | 0.55 | Sand, beaches, deserts |

> Casing matters: the runtime stores the label literally. Use the casing in this table (`"Slippery Ground"` with the space, `"Custom"` not `"CUSTOM"`).

### Example: ball using `Rubber` preset

```bash
python scripts/set_physics.py --target Ball --config '{"enabled":true,"shape":"sphere","mass":1,"ctype":"Dynamic","bounciness_preset":"Rubber","collision_material":"Rubber"}'
```

This single command yields `restitution=0.85, friction=0.9, contactStiffness=0.35, contactDamping=0.35` — engine-tuned for a bouncy ball. No magic numbers.

> **Duplication note:** This table is mirrored in `stemstudio-importer/docs/domains/physics-guide.md` §17. Keep both in sync — engine source is authoritative.
