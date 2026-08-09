---
name: stemstudio-physics
description: Physics enable/disable/configuration workflows for Studio 3D objects. Use for collision shape selection, body type setup, material tuning, and batch physics changes.
---

# StemStudio Physics

Use this skill for object-level physics configuration and verification.

## Start Here

If you know the genre, look up the row in `~/.claude/stemstudio-docs/physics-system.md` "Physics Defaults by Genre" before configuring objects — it tells you the right gravity, body types, shapes, and presets in one place. Then inspect the target object via `stemstudio-scene` and choose one of:

```bash
python scripts/set_physics_engine.py --type ammo --gravity -9.81
python scripts/enable_physics.py --target "Cube"
python scripts/disable_physics.py --target "Sphere"
python scripts/set_physics.py --target "Ball" --config '{"enabled":true,"shape":"sphere","mass":5.0,"ctype":"Dynamic","bounciness_preset":"Rubber"}'
```

**Casing matters:**
- `ctype`: PascalCase (`"Static"` / `"Dynamic"` / `"Kinematic"`) — runtime requires this; lowercase is silently broken.
- `shape`: lowercase (`"box"` / `"sphere"` / `"capsule"` / `"convexHull"` / `"concaveHull"`).
- `bounciness_preset` / `collision_material`: label as in the preset table (`"Rubber"`, `"Slippery Ground"` with the space, `"Custom"`).
- **`bodyType` is NOT a field** — use `ctype`. `bodyType` is silently ignored.

**Use `bounciness_preset` instead of hand-tuning:** setting one preset fills `restitution`/`friction`/`contactStiffness`/`contactDamping` from the engine-tuned table. See `~/.claude/stemstudio-docs/physics-system.md` "Material & Bounciness Presets".

## Critical Workflows

### Set scene engine and gravity

Engine choice is **scene-level** — every physics-enabled object in the scene shares the same engine. Set it before configuring object physics. Takes effect at next scene load; existing bodies keep running under whichever engine was active when the scene loaded.

```bash
python scripts/set_physics_engine.py --type ammo                  # default; widest feature coverage
python scripts/set_physics_engine.py --type rapier --gravity -9.81
```

| Engine | Status | Notes |
|--------|--------|-------|
| `ammo` | Default, most mature | Widest feature coverage (vehicles, character controller, joints) |
| `rapier` | Stable | Alternative backend with rigid bodies, vehicles, character controllers, and joints |

Gravity is on the Y axis; negative = down (Earth-like is `-9.81`). Omit `--gravity` to leave the scene's current value unchanged.

**Coordinate convention for forces, impulses, and velocities** — Three.js right-handed: +X right, +Y up, **-Z forward**. World-space vectors passed to `setLinearVelocity`, `applyCentralImpulse`, `applyImpulseToPlayer`, and `movePlayerObject` follow this convention: positive Y lifts, negative Y is "down with gravity", and a unit `(0, 0, -1)` impulse pushes an object forward in world space. For object-local forward, multiply `(0, 0, -1)` by the object's world quaternion. See `~/.claude/stemstudio-docs/architecture.md` "Coordinate Convention".

### Enable or disable physics

```bash
python scripts/enable_physics.py --target "Crate"
python scripts/disable_physics.py --target "GhostTrigger"
```

### Configure a single object

```bash
# Bouncy ball — preset fills restitution/friction/contactStiffness/contactDamping
python scripts/set_physics.py --target "Ball" --config '{"enabled":true,"shape":"sphere","mass":5,"ctype":"Dynamic","bounciness_preset":"Rubber","collision_material":"Rubber"}'

# Static level geometry
python scripts/set_physics.py --target "Ground" --config '{"enabled":true,"shape":"concaveHull","mass":0,"ctype":"Static","bounciness_preset":"Concrete","collision_material":"Concrete"}'

# Player capsule with locked rotation
python scripts/set_physics.py --target "Player" --config '{"enabled":true,"shape":"capsule","mass":1,"ctype":"Dynamic","rotationLock":{"x":true,"y":false,"z":true}}'
```

### Batch operations

ALWAYS use batch scripts for 2+ objects:

```bash
python scripts/batch_enable_physics.py --targets "Box1" "Box2" "Box3"
python scripts/batch_disable_physics.py --targets "Temp1" "Temp2"
python scripts/batch_set_physics.py --targets "Enemy1" "Enemy2" --config '{"ctype":"Dynamic","mass":5,"friction":0.5}'
```

Use `--operations` when each object needs different config.

## Adding Objects with Physics via Behaviors

Use these `game` methods inside behavior code to programmatically create, configure, and remove objects with physics:

```typescript
interface PhysicsConfig {
    // required
    enabled: boolean;
    // required
    shape: "btBoxShape" | "btSphereShape" | "btConcaveHullShape" | "btConvexHullShape" | "btCapsuleShape";

    /** The collision shape's local position relative to the object */
    anchorOffset?: { x: number; y: number; z: number };
    /** The collision shape's scale, relative to the object */
    anchorScale?: { x: number; y: number; z: number };
    /** User-supplied shape offset that is applied to anchorOffset */
    userShapeOffset?: { x: number; y: number; z: number };
    /** User-supplied shape scale that is applied to anchorScale */
    userShapeScale?: { x: number; y: number; z: number };

    // required for dynamic objects (ctype="Dynamic")
    mass: number;
    inertia: { x: number; y: number; z: number };

    restitution: number;      // 0 = no bounce, 1 = perfectly elastic
    friction: number;         // 0 = no friction, 1 = maximum friction
    rollingFriction: number;  // 0 = no rolling friction, 1 = maximum rolling friction
    spinningFriction: number; // 0 = no spinning friction, 1 = maximum spinning friction
    contactStiffness: number; // 0 = no contact stiffness, 1 = maximum contact stiffness
    contactDamping: number;   // 0 = no contact damping, 1 = maximum contact damping

    /**
     * Required — collision type
     * - "Dynamic": Fully simulated by physics engine (forces, gravity, collisions). For debris, balls, active characters.
     * - "Static": Immovable, does not react to forces. For floors, walls, scenery. Performance-efficient.
     * - "Kinematic": Moves via script/animation, behaves as infinite mass. Does not fall under gravity but pushes dynamic objects. For moving platforms, elevators.
     */
    ctype: "Static" | "Dynamic" | "Kinematic";

    rotationLock?: { x: boolean; y: boolean; z: boolean };

    climbable: boolean;

    // required
    type: "rigidBody";
}

/**
 * Sets the physics configuration for an object.
 * Call this before addObject() to configure physics before the object enters the scene.
 */
game.setPhysicsConfig(object: Object3D, config: PhysicsConfig): void;

/**
 * Adds an object to the scene and enables physics for it.
 * @param parent - Optional parent object. Defaults to the scene root.
 */
game.addObject(object: Object3D, parent?: Object3D): void;

/**
 * Removes an object from the scene, including its behaviors and physics.
 * Recursively removes behaviors and physics for all children.
 */
game.removeObject(object: THREE.Object3D): void;
```

### Example: Spawning a physics-enabled object from a behavior

```javascript
// Inside a behavior method (e.g., onCollision, update, etc.)
const box = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xff4400 })
);
box.position.set(0, 5, 0);

game.setPhysicsConfig(box, {
    enabled: true,
    type: "rigidBody",
    shape: "btBoxShape",
    ctype: "Dynamic",
    mass: 1,
    inertia: { x: 0, y: 0, z: 0 },
    restitution: 0.3,
    friction: 0.6,
    rollingFriction: 0.1,
    spinningFriction: 0.1,
    contactStiffness: 100000,
    contactDamping: 100,
    climbable: false,
});

game.addObject(box); // adds to scene root with physics active
```

### Example: Removing an object

```javascript
// Remove a previously added object and clean up its physics/behaviors
game.removeObject(targetObject);
```

## Physics API for Behaviors

These methods are available via `game.physics` inside behavior code:

```javascript
// Velocity
game.physics.setLinearVelocity(uuid, velocity);
game.physics.setAngularVelocity(uuid, velocity);

// Forces and impulses
game.physics.applyCentralImpulse(uuid, impulse);
game.physics.applyImpulseToRigidBody(uuid, impulse, relativePosition?);

// Player helpers
game.physics.addPlayerObject(uuid, useController, options?);
game.physics.movePlayerObject(uuid, walkDirection, jump);
game.physics.setPlayerPosition(uuid, position);
game.physics.applyImpulseToPlayer(uuid, impulse);

// Explicitly add or remove object from physics simulation
game.physics.add(object);
game.physics.remove(uuid);
```

## Routing Guidance

Use this skill for:
- body type selection
- collision shape choice
- mass, friction, restitution, and damping
- simple physics presets

Do not use this skill for:
- runtime physics API coding in behaviors without also loading `stemstudio-game-engine`
- scene building unrelated to physics

## Verification

After configuration, verify through scene/object inspection and, when needed, play-mode testing.

Do not assume a physics change worked just because the command returned successfully.

## When To Read More

- Need body types, collision shapes, or physics semantics: `~/.claude/stemstudio-docs/physics-system.md`
- Need exact enum names or type contracts: `~/.claude/stemstudio-types/stem-types.d.ts`
- Need exact registry names referenced by surrounding systems: `~/.claude/stemstudio-types/stem-events-registry.json`

## Common Mistakes

- configuring many objects one-by-one instead of batching
- using the wrong body type for the gameplay need
- treating physics config as behavior logic
- skipping verification after a config change
- **using `bodyType` instead of `ctype`** — `bodyType` is silently ignored
- **using lowercase ctype** (`"static"` / `"dynamic"`) — runtime requires PascalCase per `CollisionType` enum
- **using uppercase shape strings** (`"BOX"` / `"SPHERE"`) — runtime requires lowercase friendly names or the internal `bt*Shape` form
- hand-tuning `restitution` / `friction` / `contactStiffness` / `contactDamping` when `bounciness_preset` would fill them from the engine-tuned table
- skipping the genre-defaults lookup and inventing values per object

## See Also

- `stemstudio-scene`
- `stemstudio-objects`
- `stemstudio-game-engine`
- `stemstudio-behaviors`
