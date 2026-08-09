# Rapier backend

Rapier is one of the two supported physics backends in the Playground runtime.
The other supported backend is Ammo. Backend selection is stored in
`scene.userData.physics.engine` as `"rapier"` or `"ammo"`; there is no optional
third-engine or availability-selector layer.

## Runtime entrypoint

The canonical factory is `PhysicsEngineFactory`. It initializes Rapier lazily,
creates a backend-neutral `PhysicsEngine`, and shares the same contract used by
Ammo:

```ts
import {PhysicsEngineFactory} from "../PhysicsEngineFactory";
import {PhysicsEngineType} from "../common/types";
import {RigidBodyType} from "../PhysicsEngine";

const physics = await PhysicsEngineFactory.create(PhysicsEngineType.Rapier, {
    gravity: -9.81,
    solverIterations: 4,
});

physics.addShape(shapeUuid, collisionShape);
physics.addRigidBody(objectUuid, shapeUuid, RigidBodyType.Dynamic, {mass: 1});
physics.simulate();
```

`PhysicsEngineFactory.preload(PhysicsEngineType.Rapier)` and
`PhysicsEngineFactory.preloadWorker(PhysicsEngineType.Rapier, gravity)` are the
supported warm-up paths. The worker path is selected by the shared preload
policy; callers should not construct Rapier worlds directly.

Rapier uses four bounded constraint-solver iterations by default on normal
30–60 Hz fixed steps. `solverIterations` may be set from 1 through 8; values
outside that range are clamped. Large manually selected timesteps use one
iteration to preserve the established integration behavior. Ammo ignores this
Rapier-specific option.

## Supported capabilities

Rapier implements the same required `PhysicsEngine` contract as Ammo:

- rigid bodies, impulses, damping, collision masks, and shape replacement;
- sleeping for idle dynamic bodies by default, with `allowSleep: false` for
  continuously driven gameplay objects;
- primitive, convex-hull, and static concave-hull collision shapes;
- static heightfields when the bundled WASM export is available; otherwise a
  validated static triangulated terrain fallback is selected once per browser
  realm and reused for subsequent heightfields;
- kinematic character controllers with gravity, slope, snap, and step-height
  settings;
- collision callbacks and raycasts;
- fixed, hinge, and point-to-point joints;
- raycast vehicles and wheel transforms;
- debug geometry through `initDebug()`.

Dynamic and kinematic concave hulls are rejected by the shared physics policy.
Use static geometry, an explicit convex hull, or compound primitive colliders
for movable objects.

The current pinned `@dimforge/rapier3d-compat` WASM build exposes the
`Heightfield` JavaScript wrapper but traps from `rawshape_heightfield`. The
backend therefore probes the native path once and records the fallback mode;
terrain import remains deterministic without repeating a WASM exception for
each terrain shape. Upgrade the bundled Rapier WASM before promoting native
heightfield-specific performance claims.

## Ownership and cleanup

`PhysicsEngineFactory.create()` owns backend initialization. Call
`physics.dispose()` when the runtime ends; the factory tears down a cached WASM
module when switching between Ammo and Rapier. Do not retain Rapier `World`,
`RigidBody`, or `Collider` instances outside the backend implementation.

## Verification

The backend conformance entrypoint is
[`RapierPhysics.test.ts`](./RapierPhysics.test.ts). Shared vehicle, joint,
character-controller, collision-policy, and worker tests are run against both
retained backends. Keep this file aligned with `PhysicsEngine.ts` and the
Ammo/Rapier-only inventory; do not document APIs such as
`createRapierPhysicsWorld`, `RapierIntegration`, or `isRapierAvailable`, which
are not part of this repository.
