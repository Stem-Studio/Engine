# StemStudio Architecture

Engine overview, tech stack, module map, and key subsystems.

## Tech Stack

### Frontend (Browser)
- **React** 19.2 + **TypeScript** 5.9
- **Three.js** 0.182 (WebGPU renderer)
- **Vite** 7.3 (bundler)
- **three.quarks** — GPU particle system
- **@dimforge/rapier3d-compat** 0.19 — physics (primary)
- **Ammo.js** — physics (legacy, Bullet WASM)
- **@pixiv/three-vrm** — VRM avatar support
- **TanStack Query** v5 — server state
- **Framer Motion** / **Tween.js** — animation
- **Electron** — desktop builds

### Backend (Go 1.24)
- **MongoDB** — primary database
- **Redis** — caching
- **Negroni** + **httptreemux** — HTTP server
- **Firebase** — auth provider
- **AWS S3** — asset storage

### Project Runtime
- **Node** >= 20, **Bun** >= 1.1

## Key Modules

### EngineRuntime (`web/src/EngineRuntime.ts`)
Editor/player runtime accessed via `global.app` on engine-backed routes. Owns the render loop and top-level engine systems.

| Property | Type | Description |
|----------|------|-------------|
| `scene` | `THREE.Scene` | Active 3D scene |
| `sceneHelpers` | `THREE.Scene` | Editor gizmos/outlines overlay |
| `camera` | `PerspectiveCamera` | Active perspective camera |
| `renderer` | `WebGPURenderer` | Primary renderer |
| `rendererCSS` | `CSS3DRenderer` | UI overlay layer |
| `editor` | `Editor` | Editor instance (edit mode) |
| `game` | `GameManager` | Runtime instance (play mode) |
| `physics` | `IPhysics` | Physics engine |
| `audio` | `AudioController` | Audio system |
| `mode` | `ApplicationMode` | `EDIT`, `PLAY`, `SANDBOX`, `IDLE` |
| `storage` | `Storage` | Persistent localStorage wrapper |
| `event` | `EventDispatcher` | App-level events (d3-dispatch) |

Key methods: `start()`, `setMode()`, `setUpScene()`, `animate()`, `startPlayer()`, `stopPlayer()`

### Editor (`web/src/editor/Editor.ts`, ~2400 lines)
Scene/object management, command execution, behavior editing.

Key methods: `addObject()`, `removeObject()`, `select()`, `deselect()`, `clone()`, `group()`, `addBehavior()`, `removeBehavior()`

### GameManager (`web/src/behaviors/game/GameManager.ts`)
Runtime scene simulation — behavior/lambda execution, game loop, input, HUD.

| Property | Description |
|----------|-------------|
| `engine` | EngineRuntime reference |
| `app` | Deprecated compatibility alias for `engine` |
| `player` | Active player Object3D |
| `behaviorManager` | Behavior lifecycle manager |
| `lambdaManager` | ECS lambda system |
| `prefabManager` | Prefab instantiation |
| `animationController` | Blended animation playback |
| `animationGraphController` | Animation state graph transitions |
| `audioController` | Audio system |
| `collisionDetector` | Collision callbacks |
| `state` | `GAME_STATE` enum |
| `score`, `lives`, `health` | Game state values |

### BehaviorManager (`web/src/behaviors/BehaviorManager.ts`)
Behavior lifecycle, attribute management, throttling. See [behavior-system.md](behavior-system.md).

## Coordinate Convention

StemStudio uses the standard Three.js right-handed coordinate system:

- **+X right, -X left**
- **+Y up, -Y down** (gravity is `-9.81` on Y)
- **-Z forward (away from camera), +Z back (toward camera)**

This applies to world transforms, world-space velocities/forces, camera direction (`-Z` is the camera's local forward), and the `forward` motion axis read by InputManager. Local-space forward for any oriented object is `(0, 0, -1)` rotated by that object's quaternion. See `stemstudio-input-manager/SKILL.md` for the canonical motion-axis rule and `commands-reference.md` for axis mapping in object commands.

## Scene Graph

Standard Three.js `Object3D` hierarchy. Engine-specific data lives in `userData`:

```
object.userData = {
  behaviors: BehaviorData[],          // { id, uuid, attributes, enabled }
  lambdaComponents: LambdaComponentData[],  // ECS components
  physics: PhysicsConfig,             // Shape, mass, friction, ctype
  prefabId?: string,                  // Prefab source ID
  locked?: boolean,                   // Prefab lock state
  isVFXParent?: boolean,              // VFX container marker
  spawnpoint?: boolean,               // Spawn point marker
}
```

## Global State

```typescript
// web/src/global.ts
interface GlobalType {
  app: EngineRuntime | AppRuntime | null; // Shared runtime singleton
}
// Access: global.app.scene, global.app.editor, global.app.camera
```

**App-level events** (d3-dispatch): `app.call("eventName", ctx, ...args)` / `app.on("eventName", cb)`

Common events: `"historyChanged"`, `"sceneLoaded"`, `"selectionChanged"`, `"objectChanged"`

## Editor Command System (Undo/Redo)

Command pattern with `History` managing `undos[]` / `redos[]` stacks. Updatable commands merge within 500ms.

| Command | Purpose |
|---------|---------|
| `AddObjectCommand` | Add object to scene |
| `RemoveObjectCommand` | Remove object |
| `MoveObjectCommand` | Translate (updatable) |
| `SetPositionCommand` | Absolute position (updatable) |
| `SetRotationCommand` | Set rotation (updatable) |
| `SetScaleCommand` | Set scale (updatable) |
| `SetMaterialCommand` | Assign material |
| `SetMaterialColorCommand` | Change material color |
| `AttachBehaviorCommand` | Add behavior to object |
| `DetachBehaviorCommand` | Remove behavior |
| `MultiCmdsCommand` | Batch multiple commands |

Usage: `await app.editor.history.execute(new AddObjectCommand(mesh, parent), "Add Cube")`

## Runtime Loop

The editor and player use the legacy sequential runtime loop. Fixed-rate
behavior and lambda hooks are driven from that loop when enabled; the retired
staged scheduler pipeline is no longer part of the runtime surface.

Features: frame budget management, time-slicing, dependency graph scheduling, background tab throttling, spatial grid frustum culling.

## Module Map (`web/src/`)

| Directory | Purpose |
|-----------|---------|
| `agent/` | AI copilot integration (handlers, commands) |
| `animation/` | Animation controllers, graphs, VRM |
| `api/` | REST client (auto-generated from Swagger) |
| `asset-management/` | Asset resolution, caching, dependencies |
| `behaviors/` | Behavior system, manager, packs |
| `command/` | Undo/redo command classes |
| `controls/` | Camera/input/animation/vehicle controllers |
| `editor/` | Main editor, behavior UI |
| `lambdas/` | ECS lambda system |
| `object/` | Object types (geometry, lights, particles, terrain) |
| `physics/` | Physics engines (Ammo, Rapier) |
| `player/` | Player runtime (controls, HUD, audio) |
| `controls/VehicleControls.ts` | Vehicle physics controller (Ammo.js vehicles) |
| `controls/AnimationController.ts` | Blended animation playback |
| `controls/AnimationGraphController.ts` | Animation state graph transitions |
| `prefab/` | Prefab serialization/instantiation |
| `render/` | Rendering pipeline, post-processing |
| `scheduler/` | Frame orchestration, time-slicing |
| `serialization/` | Scene/object serialization |
| `ui/` | React UI components |
