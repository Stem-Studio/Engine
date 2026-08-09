# StemStudio Tools & Libraries Reference

Reference documentation for specialized tools and behavior packs available in StemStudio: terrain generation, billboards, water, sky, navigation, and LOD.

## Terrain Systems

### Terrain (`terrain` behavior)

The current procedural terrain behavior is the hidden, singleton `terrain`
pack. It supports endless or bounded terrain, enhanced terrain and water
options, layered surface textures, placement controls, and physics integration.
Its schema is large and changes with the implementation; use the editor's
generated attribute UI rather than copying defaults from this guide.

Authoritative source:
[terrain `behavior.json`](../../../client/packages/editor-oss/src/behaviors/packs/terrain/behavior.json).

## Billboards

### Image Billboard (`image_billboard` behavior)

Displays image content using the current image-billboard behavior schema.
Authoritative source:
[image billboard `behavior.json`](../../../client/packages/editor-oss/src/behaviors/packs/image_billboard/behavior.json).

### Video Billboard (`video_billboard` behavior)

Displays video content using the current video-billboard behavior schema.
Authoritative source:
[video billboard `behavior.json`](../../../client/packages/editor-oss/src/behaviors/packs/video_billboard/behavior.json).

### Billboard (`billboard` behavior)

Provides the general billboard pack. Mode-specific fields and visibility
conditions come from the schema rather than this reference.
Authoritative source:
[billboard `behavior.json`](../../../client/packages/editor-oss/src/behaviors/packs/billboard/behavior.json).

## Water

Water is an editor asset primitive, not a behavior pack. The Assets panel
creates a `Water` mesh directly with a subdivided plane and WebGPU-compatible
TSL procedural waves. There is no water `behavior.json` or attachable water
attribute schema.

The current constructor surface is `size`, `segments`, `waterColor`,
`waveHeight`, and `waveSpeed`. The runtime object also exposes
`setWaterColor()`, `setWaveHeight()`, and `setWaveSpeed()`. Treat those source
APIs—not legacy reflection/refraction behavior fields—as authoritative:
[Water component](../../../client/packages/editor-oss/src/object/component/Water.js)
and
[editor creation helper](../../../client/packages/editor-oss/src/editor/assets/v2/LeftPanel/MainTabs/AssetsTab/SubTabs/primitivesHelpers.ts).

## Sky & Day/Night Cycle

### Skybox (`skybox` behavior)

The current skybox pack has no configurable attributes. It is an init-only
utility that prepares its target mesh hierarchy for use as a backdrop by
disabling physics and shadows and enabling material transparency. The schema
and embedded pack documentation are authoritative:
[skybox `behavior.json`](../../../client/packages/editor-oss/src/behaviors/packs/skybox/behavior.json).

### Day/Night Cycle (`dayNightCycle` behavior)

The current cycle behavior attaches to a directional light and exposes
enablement, initial time, rotation speed, and pause state. Use its schema for
the exact names, ranges, and defaults:
[day/night `behavior.json`](../../../client/packages/editor-oss/src/behaviors/packs/dayNightCycle/behavior.json).

## Navigation Mesh (NavMesh)

### NavMesh (`navmesh` behavior)

The singleton NavMesh behavior generates walkable navigation data for AI. Its
cell, agent, quality, detail, generation, filtering, and debug controls are
defined by the current schema:
[NavMesh `behavior.json`](../../../client/packages/editor-oss/src/behaviors/packs/navmesh/behavior.json).

### NavMesh Connection (`navmesh-connection` behavior)

Adds an off-mesh connection from its host object to a target object. Current
enablement, target, direction, radius, and visualization controls are defined
by the schema:
[NavMesh connection `behavior.json`](../../../client/packages/editor-oss/src/behaviors/packs/navmesh-connection/behavior.json).

## LOD (Level of Detail)

StemStudio's live runtime manages authored `THREE.LOD` groups that are inside
objects registered with the plot-budget system. The controller evaluates camera
distance and projected screen size, applies hysteresis, limits the number of
visible tier changes per frame, and scales authored thresholds under runtime
quality pressure. Culled plots do not spend their transition budget.

| Runtime behavior | Current semantics |
|----------|-------------|
| Authored levels | Each resident level object and its authored distance are registered without adding runtime metadata to serialized `userData`. |
| Transition budget | A bounded number of the highest-priority pending switches is applied per frame; remaining switches stay pending. |
| Hysteresis | A boundary band prevents rapid tier oscillation while the camera hovers near a threshold. |
| Quality pressure | The live plot-budget policy can scale authored LOD distances. |
| Residency | A missing target must fail open by keeping the current resident tier. The current live integration does not fetch or stream missing derivatives. |
| Fallback | If safe bounds/registration are unavailable, the authored `THREE.LOD` keeps its native update path. |
| Cleanup | Unregistering or clearing runtime management restores authored visibility, distances, and `autoUpdate`. |

### LOD Distance Levels

Distances are authored per `THREE.LOD`; there is no universal 10/30/60
contract or guaranteed triangle percentage. Use LOD0 for the full-detail
resident asset, then add genuinely cheaper resident objects at increasing
distances. Validate switching at gameplay camera scale and under the target
quality policy.

LOD generation tools and smooth cross-fade fields are not proof that runtime
mesh generation, derivative streaming, or fade transitions are active. Verify
the authored levels exist before relying on them. For scenes with many
instances of the same model, combine authored LOD with GPU instancing where the
asset path supports it.

Known compatibility note: managed switching uses the derived bounds-sphere
center and projected size, so offset geometry or non-default orthographic zoom
can switch at a different point than native `THREE.LOD.update(camera)`.

## Instancing

GPU instancing renders multiple copies of the same mesh in a single draw call.

| Setting | Location | Description |
|---------|----------|-------------|
| `useInstancing` | `scene.userData.game.useInstancing` | Enable/disable globally |

Best used with:
- Trees, rocks, and repeated environment props
- Collectible items (coins, gems)
- Any object placed many times with the same geometry

Enable via `set_rendering_settings` command:
```json
{ "useInstancing": true }
```

## Controllers

### AnimationController (`web/src/controls/AnimationController.ts`)

Manages blended animation playback for 3D objects. Supports weight-based animation mixing, speed control, fade durations, and pause/resume.

Key type:
```typescript
type BlendedAnimationParams = {
    name: string | THREE.AnimationClip;
    weight?: number;
    speed?: number;
    fadeDuration?: number;
};
```

Access via `game.animationController`:
- `playBlendedAnimations(object, blends[], playOnce?)` — Play weighted animation blend
- `updateBlendedAnimationWeights(object, weights)` — Update weights at runtime
- `pauseAnimations(object)` / `resumeAnimations(object)` — Pause/resume
- `stopAnimations(object)` — Stop and clean up

### AnimationGraphController (`web/src/controls/AnimationGraphController.ts`)

Manages complex animation state graphs with parameterized transitions between states.

Access via `game.animationGraphController`:
- `addAnimationGraph(graph, object)` — Register graph for an object
- `removeAnimationGraph(object)` — Remove graph
- `updateAnimationGraph(object, params)` — Transition state with fade in/out
- `update(delta)` — Frame update (called by game loop)

### VehicleControls (`web/src/controls/VehicleControls.ts`)

High-level vehicle controller integrating Ammo.js `btRaycastVehicle` with Three.js. Handles keyboard input, wheel mesh sync, suspension tuning, and throwable objects.

See [physics-system.md](physics-system.md#vehicle-physics) for the VehicleSpec, VehicleWheelSpec, VehicleInput, and VehicleOptions interfaces.

---

## Cascaded Shadow Maps (CSM)

The hidden `csm` behavior provides cascaded shadows and currently exposes fade,
distribution mode, cascade count, and light-margin controls.

Authoritative source:
[CSM `behavior.json`](../../../client/packages/editor-oss/src/behaviors/packs/csm/behavior.json).
