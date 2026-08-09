# Behavior System

BehaviorBase lifecycle, behavior.json schema, attribute types, throttling, runtime context, and type reference.

> **Authoritative type source:** `stem-types.d.ts` (auto-generated from the engine source). See also `ai/claude/typefiles/de-shadow-editor/web/src/behaviors/Behavior.ts`.

## Lifecycle

```
constructor(target, id, options)
  -> init(game)                  // GameManager injected; can be async
  -> onStart()                   // Target is set; can be async
  -> update(deltaTime)           // Every frame (variable timestep)
  -> fixedUpdate(fixedDeltaTime) // Fixed timestep (physics-safe, see below)
  -> onPaused()                  // When behavior is paused
  -> onResumed()                 // When behavior is resumed
  -> onReset()                   // When game restarts
  -> onStop()                    // When removed from object
  -> dispose()                   // Final cleanup
```

### Core Lifecycle Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `init(game)` | `(game: GameManager) => void \| Promise<void>` | Called when the behavior is instantiated. Target is **not** set yet. If a Promise is returned, other behaviors wait for it to resolve. |
| `onStart()` | `() => void \| Promise<void>` | Called when the behavior is added to an object. Target is set and accessible. If a Promise is returned, the behavior is not considered added until it resolves. |
| `update(deltaTime)` | `(deltaTime: number) => void` | Called every frame with variable timestep. `deltaTime` is seconds since last frame. Throttling is handled automatically by BehaviorManager based on `throttleConfig`. |
| `fixedUpdate(fixedDeltaTime)` | `(fixedDeltaTime: number) => void` | Called by the authoritative fixed-step clock for physics-dependent logic (similar to Godot's `_physics_process`). Each due step runs physics, collision processing, fixed behaviors, then fixed lambdas. The active quality policy supplies the rate (normally 60 Hz on desktop) and bounds catch-up work. A behavior that implements only `fixedUpdate()` is not also invoked through the variable compatibility path while fixed stages are active. **Optional** -- implement only for deterministic or physics-coupled gameplay; keep camera, UI, animation, and VFX presentation in `update()`. |
| `onPaused()` | `() => void` | Called when the behavior is paused. |
| `onResumed()` | `() => void` | Called when the behavior is resumed. |
| `onReset()` | `() => void` | Called when the game is started or resumed (restart). |
| `onStop()` | `() => void` | Called when the behavior is removed from an object. |
| `dispose()` | `() => void` | Final cleanup when the behavior is destroyed. |

### Event and Attribute Callbacks

| Method | Signature | Description |
|--------|-----------|-------------|
| `onEvent(msg, data)` | `(msg: string, data: any) => void` | EventBus message received. |
| `onAttributesUpdated()` | `() => void` | Called when attributes are bulk-updated externally. |
| `onAttributeChangeRequested(key, newValue, oldValue, requester)` | `(key: string, newValue: any, oldValue: any, requester: Behavior \| null) => boolean` | **Optional hook.** Called before an attribute change is applied. Return `false` to reject the change. `requester` is the behavior that requested the change, or `null` if the change came from outside the behavior system. |
| `onAttributeChanged(key, newValue, oldValue)` | `(key: string, newValue: any, oldValue: any) => void` | **Optional hook.** Notified after an attribute was successfully changed (granular, per-key). |
| `onStateUpdated(key, value)` | `(key: string, value: string \| undefined) => void` | Called when multiplayer state is updated in `GameManager.storage`. |
| `onEditorButtonClicked(action)` | `(action: string) => void` | **Optional hook.** Called when a button in the editor panel is clicked. The `action` string corresponds to the `action` field defined on a `button`-type attribute in `behavior.json`. |

### Editor-Only Callbacks

These methods are only called when the behavior is running inside the editor (not at game runtime):

| Method | Signature | Description |
|--------|-----------|-------------|
| `onEditorAdded(editor)` | `(editor: Editor) => void` | Behavior added to the editor. |
| `onEditorRemoved()` | `() => void` | Behavior removed from the editor. **Not** called when the editor is disposed (e.g., switching to game mode). |
| `onEditorDispose()` | `() => void` | Editor is disposed (switching to game mode or closing). Clean up resources or listeners added in `onEditorAdded`. |
| `onEditorUpdate()` | `() => void` | Editor update tick. |
| `onEditorPanelShown()` | `() => void` | Editor panel for this behavior is shown. |
| `onEditorPanelHidden()` | `() => void` | Editor panel for this behavior is hidden. |
| `onEditorAttributesUpdated()` | `() => void` | Editor attributes changed. |
| `onEditorEvent(msg, data)` | `(msg: string, data: any) => void` | Event received in editor mode. |

### Deprecated Methods

| Method | Replacement | Notes |
|--------|-------------|-------|
| `onAdded()` | `onStart()` | Was called when behavior was added to an object. |
| `onRemoved()` | `onStop()` | Was called when behavior was removed from an object. |

## Constructor and BehaviorOptions

```typescript
constructor(target: Object3D, id: string, options: BehaviorOptions)
```

The `BehaviorOptions` interface:

```typescript
interface BehaviorOptions {
    gameObject: GameObject;   // GameObject wrapper for the target
    erth?: ErthInterface;     // Erth subsystem access (see below)
    uuid?: string;            // UUID for this instance (auto-generated if omitted)
    attributes?: Record<string, any>;  // Attribute overrides
    throttleConfig?: BehaviorThrottleConfig;  // Performance config overrides
}
```

## ErthInterface and `this.erth`

`BehaviorBase` exposes an optional `erth` property (`this.erth`) of type `ErthInterface`. This provides access to engine subsystems shared across all behaviors.

```typescript
interface ErthInterface {
    store: ErthStore;           // Global data store (128-key limit, reset on game start)
    camera: ErthCamera;         // Camera access
    scene: ErthScene;           // Scene object management
    asset: ErthAsset;           // Asset loading (model, image, audio, video, stem)
    ai: ErthAI;                 // AI 3D model generation
    combat: ErthCombat;         // WC3-inspired damage/armor system
    team: ErthTeam;             // Faction/team queries
    pool: ErthPool;             // Object pooling
    object: ErthObject;         // Three.js -> GameObject conversion
    behaviors: ErthBehaviors;   // Cross-behavior queries and attribute changes
    lambdas: ErthLambdas;       // Lambda instance access
}

interface ErthStore {
    get<T = unknown>(key: string): T | undefined;   // Get a value
    set<T = unknown>(key: string, value: T): void;   // Set a value (max 128 keys)
    has(key: string): boolean;                        // Check if key exists
    delete(key: string): boolean;                     // Delete a key
    keys(): string[];                                 // All keys
    readonly size: number;                            // Number of keys
}
```

**Usage example:**
```typescript
// Store a value accessible to all behaviors
this.erth.store.set("playerScore", 100);

// Retrieve it from another behavior
const score = this.erth.store.get<number>("playerScore");
```

The store is reset when the game starts. Maximum 128 keys allowed.

### Erth API Surface

| Path | Description |
|------|-------------|
| `erth.store.get(key)` / `set(key, value)` / `has(key)` / `delete(key)` / `keys()` / `size` | Global data store (128-key limit, reset on game start) |
| `erth.camera.position` / `quaternion` / `fov` / `near` / `far` / `lookAt(x, y, z)` | Camera access |
| `erth.scene.addObject(gameObject, parent?)` | Add a `GameObject` to the scene -> `Promise<void>` (async; always `await`) |
| `erth.ai.gen.generate3dModel(params)` | Generate 3D models with AI |
| `erth.asset.image.createTexture(assetRef)` | Load image as texture -> `Promise<THREE.Texture>` |
| `erth.asset.image.getUrl(assetRef)` | Resolve image asset URL -> `Promise<string>` |
| `erth.asset.image.findByName(name)` | Find image asset by name -> `Promise<AssetRef \| null>` |
| `erth.asset.model.createInstance(assetRef)` | Instantiate model asset -> `Promise<GameObject>` |
| `erth.asset.model.createFromUrl(params)` | Import model from URL -> `Promise<Asset>` |
| `erth.asset.model.preload(assetRef)` / `unload(assetRef)` | Preload or release model |
| `erth.asset.model.findByName(name)` | Find model asset by name -> `Promise<AssetRef \| null>` |
| `erth.asset.audio.getUrl(assetRef)` | Get audio URL -> `Promise<string>`. Also accepts `{ name: "SoundName" }` |
| `erth.asset.audio.findByName(name)` | Find audio asset by name -> `Promise<AssetRef \| null>` |
| `erth.asset.video.getUrl(assetRef)` | Get video URL -> `Promise<string>`. Also accepts `{ name: "VideoName" }` |
| `erth.asset.video.findByName(name)` | Find video asset by name -> `Promise<AssetRef \| null>` |
| `erth.asset.stem.createInstance(assetRef)` | Instantiate prefab/stem -> `Promise<GameObject>` |
| `erth.asset.stem.preload(assetRef)` / `unload(assetRef)` | Preload or release prefab/stem |
| `erth.asset.stem.findByName(name)` | Find prefab/stem asset by name -> `Promise<AssetRef \| null>` |
| `erth.asset.createAssetRelease(params)` | Create asset release |
| `erth.asset.getAssetDerivatives(params)` | Get asset derivatives |
| `erth.asset.getMyAssets(options?)` | List the current user's assets |
| `erth.behaviors.find(target, id)` | Find behavior on an object |
| `erth.behaviors.findAll(id)` | Find all behaviors of a type |
| `erth.behaviors.findOnObject(target)` | Get all behaviors attached to one object |
| `erth.behaviors.getAttribute(behavior, key)` | Read another behavior's attribute |
| `erth.behaviors.requestChange(behavior, key, value, options?)` | Request attribute change on another behavior |
| `erth.lambdas.getInstance(instanceId)` | Get lambda instance |
| `erth.lambdas.getInstancesByType(lambdaId)` | Get all lambda instances of a type |
| `erth.lambdas.registerObject(instanceId, target, componentData?)` | Attach object to lambda |
| `erth.lambdas.deregisterObject(instanceId, target)` | Detach object from lambda |
| `erth.lambdas.getObjectLambdas(target)` | Get lambdas currently affecting an object |
| `erth.combat.calculateDamage(attacker, target)` | Calculate damage -> `DamageResult` |
| `erth.combat.applyDamage(target, damage)` | Apply damage -> `boolean` (true if killed) |
| `erth.combat.regenerateHealth(unit, deltaTime)` | Regenerate health per second |
| `erth.combat.getAttackPriority(unit)` | Targeting priority based on armor type |
| `erth.combat.selectBestTarget(attackerPos, targets)` | Pick best target |
| `erth.combat.getDamageEffectiveness(damageType, armorType)` | Damage multiplier |
| `erth.team.isEnemy(a, b)` / `isFriendly(a, b)` | Team relationship |
| `erth.team.canAttack(attacker, target, friendlyFire?)` | Attack permission check |
| `erth.team.findNearestEnemy(unit, allUnits, maxRange?)` | Nearest enemy |
| `erth.team.getEnemiesInRange(unit, allUnits, range)` | Enemies in range |
| `erth.pool.create(config)` | Create object pool. Config: `{ create, reset, initialSize?, maxSize? }` |
| `erth.object.createFromThreeObject(object3d)` | Wrap raw Three.js object as `GameObject` |

### The `this.gameObject` Interface

| Property/Method | Description |
|----------------|-------------|
| `gameObject.position` | `Vector3` position |
| `gameObject.rotation` | `Quaternion` rotation |
| `gameObject.scale` | `Vector3` scale |
| `gameObject.visible` | `boolean` visibility |
| `gameObject.physics.configure(settings)` | Configure physics body |
| `gameObject.physics.getSettings()` | Get current physics settings |
| `gameObject.physics.getBody()` | Get rigid body handle |

#### `RigidBodyHandle` (from `gameObject.physics.getBody()`)

Obtained after an object has been added to the scene with physics enabled. Returns `null` if physics is not enabled.

| Method | Description |
|--------|-------------|
| `body.uuid` | Read-only UUID of the physics body |
| `body.applyImpulse(impulse, relativePosition?)` | Apply an instantaneous impulse (`{x, y, z}`) |
| `body.setVelocity(velocity)` | Set linear velocity (`{x, y, z}`) |
| `body.setCollisionBehavior(behavior)` | `"regular"` or `"ghost"` collision mode |
| `body.remove()` | Remove the body from physics simulation |

#### `PhysicsSettings` (for `gameObject.physics.configure(settings)`)

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `enabled` | boolean | false | Enable physics simulation |
| `bodyType` | string | `"static"` | `"static"`, `"dynamic"`, or `"kinematic"` |
| `shape` | string | `"box"` | `"box"`, `"sphere"`, `"capsule"`, `"convexHull"`, `"concaveHull"` |
| `mass` | number | 0 | Mass in kg (dynamic bodies only) |
| `friction` | number | 0 | Surface friction (0-1) |
| `restitution` | number | 0 | Bounciness (0-1) |
| `rollingFriction` | number | 0 | Rolling friction coefficient |
| `spinningFriction` | number | 0 | Spinning friction coefficient |
| `material` | string | `"ground"` | Surface material for audio/effects |
| `climbable` | boolean | false | Whether the player can climb this object |
| `rotationLock` | object | — | `{ x?: boolean, y?: boolean, z?: boolean }` |
| `shapeOffset` | Vector3 | — | Offset collision shape from object origin |
| `shapeScale` | Vector3 | — | Scale collision shape relative to object |
| `excludeHiddenObjects` | boolean | false | Exclude hidden children from collision shape computation |
| `shapeDimensions` | object | — | Manual shape sizing for box/sphere/capsule |

> Notes:
> - Script-side physics uses `bodyType`; command-side tooling may use other names internally.
> - `concaveHull` is the runtime trimesh collider for static environment geometry.

## BehaviorThrottleConfig

Explicit performance optimization configuration for each behavior instance. Defined on `BehaviorBase` with these defaults:

```typescript
interface BehaviorThrottleConfig {
    throttlePriority: BehaviorThrottlePriority;  // Default: MEDIUM
    enableFrustumCulling: boolean;               // Default: true
    enableDistanceThrottling: boolean;            // Default: true
    requiresConsistentUpdates: boolean;           // Default: false
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `throttlePriority` | `BehaviorThrottlePriority` | `MEDIUM` | How aggressively the behavior is throttled (see Priority Levels below). |
| `enableFrustumCulling` | `boolean` | `true` | When `true`, the behavior may be skipped if its target object is outside the camera frustum. |
| `enableDistanceThrottling` | `boolean` | `true` | When `true`, the behavior's update rate is reduced based on distance from the camera. |
| `requiresConsistentUpdates` | `boolean` | `false` | When `true`, the behavior will not be throttled even if culling/distance rules would otherwise skip it. Useful for behaviors that must tick every frame regardless of visibility. |

Can be set in `behavior.json` or overridden per-instance via `BehaviorOptions.throttleConfig`.

### Priority Levels

| Priority | Throttle behavior | Use case |
|----------|-------------------|----------|
| `CRITICAL` | Never throttled | Player movement, core mechanics |
| `HIGH` | Rarely throttled | AI, interactions, NPC |
| `MEDIUM` | Moderate throttling | Animations, effects, platforms |
| `LOW` | Aggressive throttling | Ambient, consumables |
| `MINIMAL` | Most aggressive | Debug, metrics |

## AttributeChangeOptions and AttributeChangeResult

These interfaces support the programmatic attribute change flow via `requestAttributeChange()`.

```typescript
interface AttributeChangeOptions {
    sync?: boolean;  // default: false (async). When true, the change is applied synchronously.
}

interface AttributeChangeResult {
    accepted: boolean;       // Whether the change was accepted
    key: string;             // The attribute key that was changed
    value?: any;             // The new value (if accepted)
    previousValue?: any;     // The previous value (if accepted)
}
```

**Flow:** A behavior calls `this.requestAttributeChange(key, value, options?)`. If the target behavior implements `onAttributeChangeRequested()`, that hook is invoked. If it returns `false`, the change is rejected and `accepted` will be `false` in the result. If accepted, `onAttributeChanged()` is called on the target behavior.

## behavior.json Schema

```json
{
  "id": "myBehavior",
  "name": "My Behavior",
  "isScript": false,
  "description": "What this behavior does",
  "author": ".erth",
  "tags": ["motion", "interactive"],
  "main": "MyBehavior.ts",
  "version": "1.0.0",
  "dependencies": {},
  "debugOnly": false,
  "isHidden": false,
  "isSingleton": false,
  "priority": 0,
  "isThrottlingLocked": false,
  "visibilityConditions": [],
  "throttleConfig": {},
  "objectSettings": {},
  "attributeTemplates": {},
  "attributes": {}
}
```

### Field Reference

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (e.g., `"animation"`) |
| `name` | string | Display name in editor |
| `isScript` | boolean | Script-based behavior flag |
| `main` | string | Entry point file |
| `tags` | string[] | Categorization for search/filter |
| `version` | string | Semver |
| `debugOnly` | boolean | Only visible in debug builds |
| `isHidden` | boolean | Hidden from behavior picker |
| `isSingleton` | boolean | Only one instance per scene |
| `priority` | number | Execution order (-999 = highest) |
| `isThrottlingLocked` | boolean | Prevent throttle config changes |
| `objectSettings` | object | Default physics/transform for attached objects |
| `attributeTemplates` | object | Reusable attribute groups |

## Attribute Types

Defined in `BehaviorAttributeType` enum:

| Type | Default | Notes |
|------|---------|-------|
| `boolean` | `true/false` | Checkbox |
| `number` | number | Optional `min`, `max` |
| `slider` | number | Requires `min`, `max`, `step` |
| `string` | string | Optional `isColumnMultiLine: true` for textarea |
| `vector2` | `[x, y]` | Two-component |
| `vector3` | `[x, y, z]` | Three-component |
| `enum` | string | Requires `options: [{label, value}]` or `autoFill` |
| `object` | `null` | Scene object reference |
| `prefab` | `null` | Prefab/stem reference |
| `modelAsset` | `null` | 3D model reference |
| `image` | `null` | Image upload |
| `imageAsset` | `null` | Image asset reference |
| `audioAsset` | `null` | Audio asset reference |
| `video` | `null` | Video reference |
| `videoAsset` | `null` | Video asset reference |
| `group` | object | Nested attributes; supports `array: true` for repeatable groups |
| `objectBehaviors` | `null` | Object + behavior pair; supports `defaultToSelf`, `filterByAttributes` |
| `separator` | --- | Visual divider (no value) |
| `label` | --- | Section heading (no value) |
| `button` | --- | Action button; requires `action`, `buttonText`. Triggers `onEditorButtonClicked(action)`. |
| `modelPreview` | string | 3D model preview thumbnail; uses `urlField`, `size` |

### Attribute Examples

```json
// Number with range
"speed": { "name": "Speed", "type": "number", "default": 5, "min": 0, "max": 100 }

// Enum with auto-fill
"animation": { "name": "Animation", "type": "enum", "autoFill": "object.animations", "searchFor": ["idle"], "default": "" }

// Group (nested)
"volumeOptions": {
  "name": "Volume Options", "type": "group",
  "attributes": {
    "damageAmount": { "name": "Damage", "type": "number", "default": 20 }
  }
}

// ObjectBehaviors with filter
"then_object": {
  "name": "Then Object", "type": "objectBehaviors",
  "defaultToSelf": true,
  "filterByAttributes": { "startOnTrigger": true }
}

// Conditional visibility
"urlLink": { "name": "URL", "type": "string", "visibleIf": { "billboardMode": ["YouTube Video", "Webpage"] } }

// Button (triggers onEditorButtonClicked)
"resetBtn": { "name": "Reset", "type": "button", "action": "reset", "buttonText": "Reset All" }
```

## AutoFill Options

| Value | Populates from |
|-------|---------------|
| `object.animations` | Object's animation clip list |
| `resources.videos` | Video library |
| `resources.sounds` | Sound library |
| `resources.images` | Image library |
| `resources.npcs` | NPC profile list |

Optional `searchFor: ["keyword"]` filters results by name match.

## Visibility Conditions

### Attribute-level (`visibleIf`)
Show/hide attributes based on other attribute values:
```json
"visibleIf": { "mode": "advanced" }           // equals
"visibleIf": { "mode": ["option1", "option2"] } // any of (OR)
```

### Behavior-level (`visibilityConditions`)
Show/hide entire behavior in editor based on object state:
```json
"visibilityConditions": [
  { "key": "_obj.animations.length", "condition": "isGreater", "value": 0 }
]
```

Supported conditions: `isEqual`, `isGreater`, `isLess`, `contains`

## Throttle Config (behavior.json)

```json
"throttleConfig": {
  "throttlePriority": "MEDIUM",
  "enableFrustumCulling": true,
  "enableDistanceThrottling": true,
  "requiresConsistentUpdates": false
}
```

See the [BehaviorThrottleConfig](#behaviorthrottleconfig) section above for field descriptions and defaults.

## Runtime Context

Inside a behavior method, the following properties are available on `this`:

```typescript
this.target          // Object3D this behavior is attached to
this.id              // Behavior ID (e.g., "erth.ai.animation")
this.uuid            // Unique instance UUID
this.attributes      // Config values from behavior.json defaults + overrides
                     //   DEPRECATED: use getAttribute(key) instead
this.isPaused        // Pause state
this.gameObject      // GameObject wrapper for the target Object3D
this.erth            // ErthInterface (optional) — access to shared subsystems (see above)
this.throttleConfig  // BehaviorThrottleConfig for this instance

// Via init(game):
game.scene           // THREE.Scene
game.camera          // Active camera
game.player          // Player Object3D
game.physics         // IPhysics engine
game.inputManager    // InputManager for keyboard/gamepad bindings
game.pointerEventManager // Pointer/touch event manager
game.animationController
game.animationGraphController
game.audioController
game.cameraControl   // ICameraControl
game.objectPicker    // IObjectPicker
game.behaviorManager
game.lambdaManager
game.prefabManager
game.collisionDetector
game.hud             // HUDManager
game.discord         // Discord integration
game.aiWorldController // AI World Controller
game.multiplayerState  // IMultiplayerState (MP sync)

// GameManager utility methods:
game.addObject(object, parent?)    // Add object to scene with behaviors + physics
game.removeObject(object)          // Remove object and clean up
game.cloneObject(sourceObject)     // Deep-clone with behaviors and userData
game.playSound(soundId)            // Play sound by ID
game.stopSound(soundId)            // Stop sound by ID
game.isGameStarted()               // Check if game is running
game.isGameOver()                  // Check if game ended
game.score                         // Current score
game.lives                         // Current lives
game.health                        // Current health
```

### Helper Methods (BehaviorBase)

These methods are provided by `BehaviorBase` and available on `this` in any behavior that extends it:

```typescript
// Read a single attribute value by key
this.getAttribute(key: string): any

// Request an attribute change on this behavior.
// May be rejected if onAttributeChangeRequested() returns false.
// Returns AttributeChangeResult (sync or async depending on options.sync).
this.requestAttributeChange(
    key: string,
    value: any,
    options?: AttributeChangeOptions
): Promise<AttributeChangeResult> | AttributeChangeResult

// Legacy helpers from BehaviorBase.
// For copilot-authored script behaviors, prefer erth.behaviors APIs instead.
this.findBehavior(id: string, target?: Object3D): Behavior | null
this.findBehaviors(id: string): Behavior[]
```

> For custom script behaviors written through the copilot, prefer `this.erth.behaviors.find(...)` and `this.erth.behaviors.findAll(...)`. The legacy helpers rely on `this.game` and conflict with the required closure pattern.

## Functions That DO NOT Exist

| Wrong (does not exist) | Correct alternative |
|------------------------|---------------------|
| `this.sendMessage(target, msg, data)` | `game.behaviorManager.sendEventToObjectBehaviors(target, msg, data)` |
| `this.onMessage(msg, callback)` | Define `this.onEvent = function(msg, data) { ... }` |
| `this.object3D` | `this.target` |
| `this.broadcast(msg, data)` | Loop targets and call `sendEventToObjectBehaviors()` |
| `this.getScene()` | `game.scene` |
| `this.getPlayer()` | `game.player` |

## Forbidden Patterns

These patterns regularly cause runtime failures or validator warnings. Treat them as blocking unless you have a very specific reason and can justify the exception.

- `[CRITICAL]` Do not use `this.config.attributes` in behavior code. Use `this.attributes` or `this.getAttribute(key)`.
- `[CRITICAL]` Do not use `this.THREE` or `this.game.THREE`. `THREE` is injected directly.
- `[CRITICAL]` Do not use `THREE.ShaderMaterial` or `THREE.RawShaderMaterial`. Use NodeMaterial + `THREE.TSL`.
- `[CRITICAL]` Do not use `EventBus.send()`. Use `game.behaviorManager.sendEventToObjectBehaviors(...)`.
- `[CRITICAL]` Do not use `this.findBehavior()` / `this.findBehaviors()` in copilot-authored script behaviors. Use `this.erth.behaviors.find(...)` / `findAll(...)`.
- `[CRITICAL]` Do not name the init parameter `game`. Use `_game` so it does not shadow the closure variable.
- `[CRITICAL]` Do not write `this.init = function() {}` with no parameter. `init` receives the game instance.
- `[CRITICAL]` Do not use raw DOM listeners for standard movement/input when `game.inputManager` already covers the action.
- `[CRITICAL]` Do not hardcode asset names when an asset attribute should be exposed.
- `[WARN]` Do not use `var`. Use `let` / `const`.
- `[WARN]` Do not use `self = this` or pass `this` around as `self`. Capture what you need via closure variables.
- `[WARN]` Do not store shared cross-system state directly on `this`. Use `erth.store`.
- `[WARN]` Do not manually manage physics bodies if `gameObject.physics` or engine physics helpers already cover the use case.

## Inter-Behavior Communication: When to Use What

| Mechanism | Direction | Scope | Use When |
|-----------|-----------|-------|----------|
| `erth.store.set(key, value)` / `.get(key)` | Any -> Any | Global | Shared state read by multiple systems every frame |
| `game.behaviorManager.sendEventToObjectBehaviors(target, msg, data)` | One -> one object | Targeted | One-shot events such as pickup, damage, door opened |
| `erth.behaviors.getAttribute(behavior, key)` / `requestChange(...)` | One -> one behavior | Direct | Read or mutate another behavior's configured attribute |
| Behavior attributes | Editor -> behavior | Per-instance | Authoring-time config tuned in the editor or attach config |

Decision flow:
1. Value set in editor and mostly static -> attribute
2. Shared runtime state polled by many systems -> `erth.store`
3. One-shot event to a known object -> behavior event
4. Need to inspect or mutate another behavior instance -> `erth.behaviors.*`

## Closure Pattern (CRITICAL for Script Behaviors)

Custom script behaviors created through `add_behavior` must store the game reference through a closure variable, not on `this`.

Correct pattern:

```javascript
let game;

this.init = function(_game) {
  game = _game;
};

this.onStart = function() {
  // this.target is available here
};

this.update = function(deltaTime) {
  // use game.camera, game.scene, game.inputManager, etc.
};

this.dispose = function() {
  // cleanup
};
```

Wrong pattern:

```javascript
this.init = function(game) {
  this.game = game;
};
```

Why the closure pattern matters:
- avoids shadowing bugs
- keeps script behavior code aligned with the validator
- avoids legacy helper paths that assume `this.game`
- makes shared helpers easier to write without rebinding `this`

## Asset Attribute Types

Use asset attributes whenever a behavior needs external content chosen by the user or by attach-time config.

| Type | Runtime Value | Typical Use |
|------|---------------|-------------|
| `imageAsset` | `AssetRef` | Color maps, normal maps, UI textures |
| `modelAsset` | `AssetRef` | Enemy/player/prop models |
| `audioAsset` | `AssetRef` | SFX or music clips |
| `videoAsset` | `AssetRef` | Video surfaces or billboards |
| `prefab` | `AssetRef` | Prefab/stem instancing |

Rules:
- read the value from `this.attributes`
- pass it into the matching `erth.asset.*` method
- do not hardcode scene-specific asset IDs in behavior code

## Key Distinction: add_behavior vs attach_behavior

- **`add_behavior`** -- Creates a behavior definition (registers code + metadata in the engine)
- **`attach_behavior`** -- Binds an existing behavior definition to a specific Object3D with config
