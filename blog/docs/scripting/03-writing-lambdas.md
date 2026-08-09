---
title: Writing Lambdas
slug: writing-lambdas
description: A complete guide to writing custom lambdas in StemStudio, covering the lambda.json format, the LambdaBase lifecycle, per-object component data, and a full annotated bobbing example.
status: draft
audience: technical-creators
prerequisites: [scripting/01-behaviors-vs-lambdas, scripting/02-writing-behaviors]
---

# Writing Lambdas

A lambda is a shared system that batch-processes many objects at once. Where a behavior gives one object its own brain, a lambda gives many objects the same rule and processes them together in a single `apply()` call.

![Lambda component editor showing per-object data fields on multiple objects](images/Writing_Lambdas.PNG)

## What This Page Is For

Use this page when you need to:

- Create a custom lambda pack from scratch
- Understand the `lambda.json` config format
- Define scene-level attributes and per-object component schemas
- Implement the LambdaBase lifecycle
- Read and write component data at runtime
- Drive a lambda from a behavior
- Understand Auto Apply vs manual apply

## Lambda Pack Structure

Every lambda lives in a pack folder with two required files:

```
lambdas/packs/myLambda/
├── lambda.json        # Configuration, attributes, component schema
└── MyLambda.ts        # TypeScript class (default export)
```

The `lambda.json` defines the lambda's identity, scene-wide settings, and the per-object data schema. The TypeScript class implements the processing logic.

## The lambda.json Format

Here is a complete annotated `lambda.json`:

```json
{
    "id": "bobbing",
    "name": "Bobbing",
    "description": "Bobs registered objects up and down using a sine wave.",
    "author": "Your Name",
    "version": "1.0.0",
    "main": "BobbingLambda.ts",
    "tags": ["visual", "motion"],

    "attributes": {
        "globalSpeed": {
            "name": "Global Speed",
            "type": "number",
            "default": 1.0,
            "description": "Speed multiplier applied to all objects."
        }
    },

    "componentSchema": {
        "amplitude": {
            "name": "Amplitude",
            "type": "number",
            "default": 1.0,
            "min": 0,
            "description": "How far the object bobs from its starting position."
        },
        "frequency": {
            "name": "Frequency",
            "type": "number",
            "default": 2.0,
            "min": 0,
            "description": "How many bobs per second."
        },
        "axis": {
            "name": "Axis",
            "type": "enum",
            "options": [
                { "label": "Y (Up)", "value": "y" },
                { "label": "X (Right)", "value": "x" },
                { "label": "Z (Forward)", "value": "z" }
            ],
            "default": "y",
            "description": "Which axis the object bobs along."
        }
    }
}
```

### Top-Level Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `id` | Yes | `string` | Unique identifier. Do not change after publishing. |
| `name` | Yes | `string` | Display name in the editor |
| `description` | Recommended | `string` | One sentence: what it does and when to use it |
| `author` | Recommended | `string` | Creator name |
| `version` | Yes | `string` | Semantic version (`x.y.z`) |
| `main` | Yes | `string` | TypeScript file name (must use `export default`) |
| `tags` | Recommended | `string[]` | Search and filter tags |
| `attributes` | Yes | `Record<string, FieldMeta>` | Scene-level settings shared by all registered objects |
| `componentSchema` | Yes | `Record<string, FieldMeta>` | Per-object component data schema |
| `isCritical` | Optional | `boolean` | Default scheduler criticality for this lambda type |
| `readComponents` | Optional | `string[]` | Fields read at runtime (for dependency scheduling) |
| `writeComponents` | Optional | `string[]` | Fields written at runtime (for dependency scheduling) |

### attributes vs componentSchema

This is the most important distinction in lambda configuration:

- **attributes** are scene-level settings. One set of values shared by all objects in this lambda. Accessed via `this.attributes` in the class.
- **componentSchema** defines per-object data. Each registered object gets its own copy. Accessed via `getComponentData(target)`.

Think of it this way: `attributes` is the system's global configuration, and `componentSchema` is each object's individual settings.

### Field Types

| Type | Editor Control | Example |
|------|---------------|---------|
| `number` | Numeric input | `{ "type": "number", "default": 0, "min": 0, "max": 100 }` |
| `boolean` | Checkbox | `{ "type": "boolean", "default": false }` |
| `string` | Text input | `{ "type": "string", "default": "" }` |
| `enum` | Dropdown select | `{ "type": "enum", "options": [...], "default": "a" }` |

Each field must include `name`, `type`, and `default`. Numeric fields can add `min` and `max`. Enum fields must include `options` as an array of `{ "label": "...", "value": "..." }` objects.

You can also set `userVisible: false` to hide a field in the editor while keeping it available at runtime.

## The LambdaBase Lifecycle

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│   1. EDITOR TIME                                                 │
│      Creator adds lambda component to objects in the editor.     │
│      Per-object componentData stored in userData.                │
│                                                                  │
│   2. PLAY MODE STARTS                                            │
│      ┌──────────────────────────────────────────────────────┐    │
│      │ Lambda class loaded from pack                        │    │
│      │ Instance created: new MyLambda(id, options)          │    │
│      │ init(game) called                                    │    │
│      │                                                      │    │
│      │ For each object with this lambda component:          │    │
│      │   registerObject(target, componentData)              │    │
│      │   → target added to registeredObjects Map            │    │
│      │   → onObjectAdded(target, componentData) called      │    │
│      └──────────────────────────────────────────────────────┘    │
│                          │                                       │
│                          ▼                                       │
│   3. GAME LOOP (every frame)                                     │
│      ┌──────────────────────────────────────────────────────┐    │
│      │ Behavior calls lambda.apply(deltaTime)               │    │
│      │   → iterates ALL registered objects                  │    │
│      │   → applies logic using each object's componentData  │    │
│      │   → processes any pending register/deregister ops    │    │
│      │                                                      │    │
│      │ OR: update(deltaTime) called if Auto Apply is on     │    │
│      └──────────────────────────────────────────────────────┘    │
│                          │                                       │
│                          ▼                                       │
│   4. PLAY MODE STOPS                                             │
│      ┌──────────────────────────────────────────────────────┐    │
│      │ For each registered object:                          │    │
│      │   onObjectRemoved(target) called                     │    │
│      │ dispose() called                                     │    │
│      │   → registeredObjects cleared                        │    │
│      └──────────────────────────────────────────────────────┘    │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Lifecycle Methods Reference

| Method | When It Runs | Use It For |
|--------|-------------|------------|
| `init(game)` | Instance is created | One-time setup, caching references to GameManager |
| `onObjectAdded(target, componentData)` | An object registers with this lambda | Storing initial state (base positions, caches) |
| `apply(deltaTime)` | Called manually from a behavior's update | Processing all registered objects |
| `update(deltaTime)` | Called by apply internally, or by Auto Apply | The actual per-object processing logic |
| `onObjectRemoved(target)` | An object deregisters from this lambda | Cleaning up per-object state |
| `onEvent(msg, data)` | An event is received from behaviors or engine systems | Reacting to gameplay events |
| `fixedUpdate(fixedDeltaTime)` | Once per authoritative fixed simulation step, after fixed behaviors | Deterministic bulk gameplay and physics-coupled systems |
| `dispose()` | Play mode stops | Releasing all resources |

### The registeredObjects Map

Every lambda has an internal `registeredObjects` map:

```
Map<Object3D, Record<string, any>>
```

Each key is a Three.js object, and each value is that object's component data (the fields defined in `componentSchema`). When you iterate in `apply()`, you walk this map to process every registered object.

### getComponentData and setComponentData

Read an object's component data:

```ts
const data = this.getComponentData(target);
if (data) {
    console.log(data.amplitude, data.frequency, data.axis);
}
```

Write a single field:

```ts
this.setComponentData(target, "amplitude", 2.0);
```

Or mutate the data object directly (changes take effect on the next `apply()`):

```ts
const data = this.getComponentData(target);
if (data) {
    data.amplitude = 2.0;
}
```

### processObjects(deltaTime, callback, isCritical)

A convenience method for iterating registered objects with built-in error handling:

```ts
this.processObjects(deltaTime, (object, data, dt) => {
    object.position.y += data.speed * dt;
}, false);
```

## Auto Apply vs Manual Apply

Lambdas can run in two modes:

### Manual Apply (default)

A behavior explicitly calls `lambda.apply(deltaTime)` in its `update()` loop. This gives the behavior full control over when and whether the lambda runs:

```ts
update(deltaTime: number) {
    // Only apply when the game is in a specific state
    if (this.gameIsActive) {
        this.bobbingLambda?.apply(deltaTime);
    }
}
```

This is the standard pattern. It lets you control execution order, conditional execution, and timing.

### Auto Apply

When a lambda's `update(deltaTime)` method is implemented with processing logic, it runs automatically every frame without requiring a behavior to call `apply()`. The base `apply()` method calls `update()` internally:

```ts
// Inside LambdaBase.apply():
apply(deltaTime?: number): void {
    this._isApplying = true;
    try {
        this.update(deltaTime);
    } finally {
        this._isApplying = false;
        this._processPendingOps();
    }
}
```

Auto Apply is useful for lambdas that should always process their objects every frame without requiring orchestration from a behavior.

## Full Annotated Example: Bobbing Lambda

### lambda.json

```json
{
    "id": "bobbing",
    "name": "Bobbing",
    "description": "Bobs registered objects up and down using a sine wave.",
    "author": ".erth",
    "version": "1.0.0",
    "main": "BobbingLambda.ts",
    "tags": ["visual", "motion"],
    "attributes": {
        "globalSpeed": {
            "name": "Global Speed",
            "type": "number",
            "default": 1.0
        }
    },
    "componentSchema": {
        "amplitude": {
            "name": "Amplitude",
            "type": "number",
            "default": 1.0,
            "min": 0
        },
        "frequency": {
            "name": "Frequency",
            "type": "number",
            "default": 2.0,
            "min": 0
        },
        "axis": {
            "name": "Axis",
            "type": "enum",
            "options": [
                { "label": "Y (Up)", "value": "y" },
                { "label": "X (Right)", "value": "x" },
                { "label": "Z (Forward)", "value": "z" }
            ],
            "default": "y"
        }
    }
}
```

### BobbingLambda.ts

```ts
import { Object3D } from "three";
import { LambdaBase } from "../../LambdaBase";

export default class BobbingLambda extends LambdaBase {

    // ── Internal State ────────────────────────────────────────
    //
    // _time tracks the sine wave phase across frames.
    // _basePositions stores where each object started so we
    // can bob relative to its original position.

    private _time: number = 0;
    private _basePositions: Map<Object3D, number> = new Map();

    // ── Lifecycle ─────────────────────────────────────────────

    init(game: any): void {
        // Always call super.init to set up GameManager reference.
        super.init(game);
        this._time = 0;
    }

    onObjectAdded(target: Object3D, componentData: Record<string, any>): void {
        // When an object registers, record its starting position
        // on the selected axis so we bob relative to it.
        const axis = componentData.axis || "y";
        this._basePositions.set(
            target,
            target.position[axis as "x" | "y" | "z"]
        );
    }

    onObjectRemoved(target: Object3D): void {
        // Clean up the cached base position.
        this._basePositions.delete(target);
    }

    // ── Processing ────────────────────────────────────────────

    apply(deltaTime: number = 0.016): void {
        // 1. Set the guard flag. This queues any register/deregister
        //    calls made during iteration instead of modifying the map.
        this._isApplying = true;

        // Read the scene-wide speed multiplier.
        const globalSpeed = this.attributes.globalSpeed ?? 1.0;
        this._time += deltaTime * globalSpeed;

        // 2. Iterate every registered object.
        for (const [object, data] of this._registeredObjects) {
            try {
                // Read this object's per-object component data.
                const axis = (data.axis || "y") as "x" | "y" | "z";
                const amplitude = data.amplitude ?? 1.0;
                const frequency = data.frequency ?? 2.0;

                // Calculate the new position.
                const base = this._basePositions.get(object) ?? 0;
                const offset = Math.sin(this._time * frequency) * amplitude;
                object.position[axis] = base + offset;
            } catch (error) {
                // 3. Wrap per-object logic in try/catch so one bad
                //    object does not break the entire loop.
                console.error(`[BobbingLambda] Error:`, error);
            }
        }

        // 4. Clear the guard and process any queued operations.
        this._isApplying = false;
        this._processPendingOps();
    }

    // ── Cleanup ───────────────────────────────────────────────

    dispose(): void {
        this._basePositions.clear();
        this._time = 0;
        // Always call super.dispose to clear registeredObjects.
        super.dispose();
    }
}
```

### Driving It From a Behavior

```ts
import { BehaviorBase } from "../behaviors/Behavior";
import type { Lambda } from "../lambdas/Lambda";

export default class BobController extends BehaviorBase {
    private bobLambda: Lambda | null = null;

    async onStart() {
        // Find the bobbing lambda instance.
        const instances = this.erth?.lambdas.getInstancesByType("bobbing");
        this.bobLambda = instances?.[0] ?? null;
    }

    update(deltaTime: number) {
        // Call apply every frame to process all bobbing objects.
        this.bobLambda?.apply(deltaTime);
    }

    onStop() {
        this.bobLambda = null;
    }
}
```

### How It Works Together

1. In the editor, a creator attaches the "Bobbing" lambda component to several objects, setting different amplitudes and frequencies on each.
2. The creator attaches the `BobController` behavior to any object in the scene.
3. When play mode starts, the lambda instance is created and all objects are registered with their component data.
4. Every frame, the behavior calls `apply(deltaTime)`, which iterates all registered objects and updates their positions.
5. Each object bobs at its own amplitude and frequency, but they are all processed by one system in one loop.

## Rules for apply()

Every `apply()` implementation must follow these rules:

1. **Set `this._isApplying = true`** at the start
2. **Set `this._isApplying = false`** before calling `_processPendingOps()`
3. **Call `this._processPendingOps()`** at the end to flush queued register/deregister operations
4. **Wrap per-object logic in `try/catch`** so one bad object does not break the loop
5. **Export the class as `default`**

```ts
apply(deltaTime: number = 0.016): void {
    this._isApplying = true;           // 1

    for (const [object, data] of this._registeredObjects) {
        try {                          // 4
            // your logic here
        } catch (error) {
            console.error(`[MyLambda] Error:`, error);
        }
    }

    this._isApplying = false;          // 2
    this._processPendingOps();         // 3
}
```

### Command Queue Safety

During `apply()`, the registeredObjects map is being iterated. If a behavior calls `registerObject()` or `deregisterObject()` during this iteration, the operation is automatically queued in a pending operations list. After `apply()` finishes and calls `_processPendingOps()`, all queued operations are executed safely.

This means behaviors can register or deregister objects at any time, even inside callbacks triggered by a lambda's processing loop.

## Querying Lambdas From Behaviors

Inside any behavior, access lambdas via `this.erth.lambdas`:

### Finding Instances

| Method | Returns | Description |
|--------|---------|-------------|
| `getInstance(instanceId)` | `Lambda \| null` | Get a lambda by its instance UUID |
| `getInstancesByType(lambdaId)` | `Lambda[]` | Get all instances of a type (e.g. `"bobbing"`) |
| `getObjectLambdas(target)` | `Lambda[]` | Get all lambdas an object belongs to |

### Registering Objects at Runtime

| Method | Returns | Description |
|--------|---------|-------------|
| `registerObject(instanceId, target, componentData?)` | `boolean` | Add an object to a lambda with optional initial data |
| `deregisterObject(instanceId, target)` | `void` | Remove an object from a lambda |

Objects do not have to be set up in the editor. Behaviors can register and deregister objects dynamically:

```ts
// Register a newly spawned object
this.erth?.lambdas.registerObject(
    this.bobLambda.uuid,
    spawnedObject,
    { amplitude: 0.5, frequency: 3, axis: "y" }
);

// Deregister when the object is removed
this.erth?.lambdas.deregisterObject(
    this.bobLambda.uuid,
    removedObject
);
```

## Lambda Instance Properties

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Lambda type ID (e.g. `"bobbing"`) |
| `uuid` | `string` | Unique instance UUID |
| `attributes` | `Record<string, any>` | Scene-wide attributes from config |
| `registeredObjects` | `ReadonlyMap<Object3D, Record<string, any>>` | All registered objects and their data |
| `entityCount` | `number` | Number of registered objects |

## Data Storage

Lambda data lives in two places in the scene:

```
scene.userData.lambdaInstances[]       ← which lambda types are active
object.userData.lambdaComponents[]     ← per-object component data
```

Each entry in `lambdaComponents` looks like:

```ts
{
    lambdaId: "bobbing",           // which lambda type
    instanceId: "uuid-of-instance", // which runtime instance
    uuid: "uuid-of-component",     // unique ID for this attachment
    enabled: true,                  // can be toggled off
    componentData: {                // the actual per-object data
        amplitude: 1.0,
        frequency: 2.0,
        axis: "y"
    }
}
```

## Tips

- **Execution order matters.** If one lambda feeds data into another, call `apply()` in the correct order from your behavior.
- **Multiple instances.** You can have multiple instances of the same lambda type. Use `getInstancesByType()` to find the one you need.
- **Runtime registration.** Behaviors can call `registerObject()` and `deregisterObject()` at any time. Operations during `apply()` are safely queued.
- **Component data is mutable.** Write `data.vx = 10` directly. Changes take effect on the next `apply()`.
- **Dispose is automatic.** When play stops, all instances are disposed. Object deletion cleans up lambda components.
- **No overhead when idle.** If you do not call `apply()`, the lambda does nothing. Zero per-frame cost.

## What To Avoid

- Do not modify `this._registeredObjects` directly during `apply()`. Use the built-in queue.
- Do not forget to call `super.init(game)` and `super.dispose()`.
- Do not skip `_processPendingOps()` at the end of `apply()`.
- Do not skip the `try/catch` inside the iteration loop. One error should not break all objects.

## Global Scope

Lambda scripts have access to the following globals injected at runtime. These are the **only** supported globals -- do not rely on any others.

### THREE

The full [Three.js](https://threejs.org/) library. Use it for vectors, colors, math, geometry, materials, and anything else Three.js provides.

```ts
const dir = new THREE.Vector3(0, 1, 0);
const color = new THREE.Color(0xff0000);
const mat = new THREE.MeshStandardMaterial({ color });
```

### Physics (gameObject.physics)

The physics API is accessed through `gameObject.physics` on any `GameObject`. Use it to configure physics settings before adding an object to the scene, and to manipulate the physics body at runtime.

#### Configuring Physics

Call `configure()` **before** adding the object to the scene with `erth.scene.addObject()`:

```ts
gameObj.physics.configure({
    enabled: true,
    bodyType: "dynamic",     // "static" | "dynamic" | "kinematic"
    shape: "sphere",         // "box" | "sphere" | "capsule" | "convexHull" | "concaveHull"
    mass: 1,
    friction: 0.5,
    restitution: 0.8,        // bounciness (0-1)
    material: "metal",       // surface material for audio/effects
});
```

#### Runtime Physics (RigidBodyHandle)

After the object is in the scene, call `getBody()` to get a `RigidBodyHandle` for runtime manipulation:

```ts
const body = gameObj.physics.getBody();
if (body) {
    body.applyImpulse({ x: 0, y: 10, z: 0 });
    body.setVelocity({ x: 5, y: 0, z: 0 });
    body.setCollisionBehavior("ghost");  // "regular" or "ghost"
    body.remove();
}
```

| Method | Description |
|--------|-------------|
| `applyImpulse(impulse, relativePosition?)` | Apply an instantaneous impulse. Optional relative position for off-center forces. |
| `setVelocity(velocity)` | Set the linear velocity directly. |
| `setCollisionBehavior(behavior)` | `"regular"` (solid) or `"ghost"` (pass-through but detects collisions). |
| `remove()` | Remove this body from the physics simulation. |

### CSS3DObject / CSS3DSprite

Create HTML-based 3D elements that exist in the Three.js scene graph. Useful for labels, HUDs, and overlays that should track 3D positions.

```ts
const div = document.createElement("div");
div.textContent = "Hello";
const label = new CSS3DObject(div);
label.position.set(0, 2, 0);
```

### UIKit

A 3D UI component library for building in-world interfaces.

| Component | Description |
|-----------|-------------|
| `UIKit.Container` | Layout container for grouping UI elements |
| `UIKit.Text` | Text display |
| `UIKit.Image` | Image display |
| `UIKit.Input` | Text input field |
| `UIKit.Fullscreen` | Full-screen overlay container |
| `UIKit.Content` | Scrollable content area |
| `UIKit.Svg` | SVG element display |
| `UIKit.Video` | Video player element |

```ts
const panel = new UIKit.Container({
    width: 2,
    height: 1,
    backgroundColor: "#222222"
});
const label = new UIKit.Text({ content: "Score: 0", fontSize: 0.1 });
panel.add(label);
```

### UIKitPointerEvents

Reference-counted pointer event system for UIKit. Manages enabling/disabling pointer interactions across multiple consumers.

```ts
UIKitPointerEvents.enable();   // increment reference count
UIKitPointerEvents.disable();  // decrement reference count
```

### console

Standard console logging methods, safe to use inside lambda scripts:

```ts
console.log("Lambda applied");
console.warn("Unexpected value");
console.error("Something failed");
```

## Next Steps

- Read [Communication Patterns](04-communication-patterns.md) for store and inter-component messaging patterns.
- Browse the [Built-in Behaviors Reference](05-built-in-behaviors.md) to see what is already available.
