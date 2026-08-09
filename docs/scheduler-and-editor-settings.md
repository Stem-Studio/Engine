# Scheduler and Editor Performance Settings

> **Current deployment scope:** these instructions target local **Playground
> mode**. Remote scene APIs are not deployed and must not be used as a load,
> save, Play, Edit, or QA fallback. Mobile authoring is **landscape-only**;
> portrait shows the rotate-device gate rather than an interactive workspace.

Most scene-wide controls live in the **Project** tab. That tab is the map for
project metadata, editor preferences, runtime performance, default scene
lighting, cameras, and scene-level objects such as the default directional
light.

![Project tab settings map](./assets/editor-project-tab-map.png)

Use these entries as the main navigation points:

| Project tab entry | What it controls |
|---|---|
| Project Settings | Project metadata, editor snapping/units, physics defaults, game rules, HUD/display, player settings, multiplayer, and developer tools. |
| Rendering & Performance | Quality presets, scheduler, rendering switches, physics runtime toggles, behavior throttling, profiling, LOD, and splat settings. |
| Default Scene | Scene-wide ambient light, hemisphere light, fog, background, tone mapping, and shadow defaults. |
| DefaultCamera | Camera object transform and camera-specific settings. |
| Directional Light | The default sun/key light object, including directional-light behavior, shadow casting, and shadow quality. |

---

## Project settings

![Project Settings panel](./assets/project-settings-overview.png)

**Project Settings** is the broad project-authoring panel. It mixes scene
metadata with editor workflow preferences and game runtime defaults:

| Section | Settings |
|---|---|
| Project Details | Name, description, content rating, thumbnail image, tags, and server-backed slug/publishing metadata when available. |
| Snapping | Grid snapping, snap resolution, rotation snapping, snap angle presets, scale snapping, geometric snapping, play-mode snapping, and snap priority. |
| CAD, units, and measurement | CAD tools, unit system, display unit, angle units, bounding-box mode, and color palette. |
| Physics | Default physics engine and gravity stored under `scene.userData.physics`. Runtime physics toggles such as sleeping and workers live in Rendering & Performance. |
| Level Rules | Max score, player lives, and time limit stored with `scene.userData.game`. |
| HUD & Display | Standard HUD panel toggle, HUD renderer, HUD customization entry point, orientation policy, orbit controls, SceneTraverser, and mobile VFX toggle. |
| Player Settings | Avatar/player defaults for play mode. |
| Multiplayer | Multiplayer, collaboration, room/client limits, auto-join, and voice chat options. |
| Developer Tools | Production mode, game project mode, Play-mode Inspector, Compartments, and first-time-experience reset. |

Project Settings answers "what kind of project is this and how should the
editor/play mode behave?" Rendering & Performance answers "how should the
runtime spend frame time?"

---

## Rendering and performance

![Rendering and Performance panel](./assets/scheduler-settings-overview.png)

The **Rendering & Performance** panel is the runtime tuning panel. It contains:

| Section | Settings |
|---|---|
| Quality Presets | Target-device policy records; only a subset of their rendering, physics, view-distance, culling, and LOD fields have live consumers. |
| Rendering | Dynamic batching, mesh instancing, batching-data reset, post-processing, and retained renderer-compatibility fields. |
| Physics | Physics sleeping and multi-threaded physics worker. |
| Behavior Performance | Off-screen optimization, distance optimization, consistent updates, priority, distance thresholds, and throttle factors. |
| Budget Inspector | Runtime budget visibility for avatars, plots, textures, and hot rows. |
| Lambda Explorer | Play-mode profiling for lambda instances, waves, entity counts, and timings. |
| LOD / developer tools | Batch LOD generation, root transform policy, performance overlay, memory overlay, debug mode, and splat/Spark renderer controls. |

These controls affect how the runtime spends each frame, which systems are
allowed to skip work, and which diagnostics are visible while you tune a
project.

---

## Runtime update loop

Play mode uses the unified `EngineRuntime` loop. Each rendered frame advances
one authoritative fixed-step clock zero or more times, then runs variable
presentation work once. Every due fixed step runs physics, collision
processing, fixed behaviors, and fixed lambdas in that order. Variable behavior
and lambda updates, animation, audio, AI, player events, and render callbacks
remain part of the rendered-frame path.

Retired `FrameOrchestrator` scheduler metadata may still exist in old scenes and
quality presets, but it is normalized off at launch. It does not create a
second staged runtime.

The active runtime still uses:

- One bounded fixed-step accumulator for physics and fixed gameplay.
- Behavior throttling for off-screen, distant, or lower-priority scripts.
- Lambda scheduling for dependency waves, frame budgets, distance checks, and
  profiling.
- Budget and memory inspectors for runtime diagnostics.

---

## Quality presets

Quality presets bundle intended rendering, physics, behavior, network, and
scene-budget targets by device class. The registry is broader than the current
runtime integration: selecting a preset does not prove that every recorded
field has a live consumer.

![Quality presets](./assets/scheduler-quality-presets.png)

Current behavior:

- Preset selection records the policy settings.
- The rendering-quality module contains application paths for pixel ratio and
  shadow mode when it is connected to the active renderer.
- The pressure policy contains resolution/effect overrides, but documentation
  must not assume the active frame loop is feeding that policy without runtime
  verification.
- The active quality policy drives the authoritative fixed-step physics rate
  and maximum fixed steps per rendered frame.
- Anti-aliasing type, texture-quality scale, cascade count, reflection,
  volumetric-lighting, maximum-light, batching, view-distance, LOD-distance,
  culling, and network fields are not all applied end to end today. Several are
  stored configuration or are owned by separate scene systems. Solver quality,
  CCD, and sleep policy now have explicit runtime consumers; the former
  `maxActiveBodies`/body-cap field was removed from the quality schema and
  built-in presets because neither active backend had a safe shared consumer.

Treat a preset as a starting policy record. Verify the actual pixel ratio,
shadow/effect state, renderer statistics, physics cadence, and frame time in
Play mode before claiming a quality tier is active.

---

## Authoritative fixed simulation

The retired staged scheduler controls remain hidden, but the runtime now owns
one fixed-step simulation clock. It clamps frame spikes, bounds catch-up, and
runs each due step in this order: physics, collision processing, fixed
behaviors, then fixed lambdas. The active quality policy supplies the physics
update rate and maximum fixed steps per rendered frame; older scheduler fields
remain accepted as a saved-scene fallback.

`update(deltaTime)` still runs once per rendered frame. When fixed stages are
active, a fixed-only script is not also invoked by the variable compatibility
path. `FrameContext.interpolationAlpha` and `fixedOverstep` expose the
remaining fractional step for render interpolation, while dropped step/time
metrics make bounded catch-up visible in runtime telemetry.

Worker physics preserves the same logical order asynchronously: fixed steps
are queued without merging, each step retains its authored substeps, and its
collision/behavior/lambda stages run only after that step's worker
acknowledgement. Rendering may present the most recently completed state while
the worker is processing its bounded backlog.

Older scenes may still contain this metadata:

```jsonc
{
  "userData": {
    "scheduler": {
      "enabled": true,
      "behaviorUpdateMode": "fixed" // or "variable"
    }
  }
}
```

The active quality profile still carries lower-level scheduler fields such as
`frameBudgetMs`, `fixedTimestepHz`, `maxFixedStepsPerFrame`,
`spatialGridCellSize`, `renderPressureThreshold`, and
`deltaTimePressureThreshold` for saved-scene and API compatibility. Launch
normalizes `scheduler.enabled` to `false`.

---

## Physics stepping, yielding, and catch-up

The runtime has two catch-up mechanisms that are easy to confuse:

| Mechanism | What it does |
|---|---|
| Authoritative fixed-step accumulator | Buffers elapsed render time, clamps spikes, and runs zero or more complete physics → collision → fixed behavior → fixed lambda steps. Catch-up is bounded; excess whole steps and time are reported instead of replaying an unbounded backlog. Worker steps are queued without merging and complete their fixed gameplay work after the matching acknowledgement. |
| Throttle catch-up | Behaviors that are skipped by throttling accumulate skipped `deltaTime`; the next update receives an effective delta that includes that skipped time. Lambda `processObjects()` does the same with the callback `dt` by multiplying by the throttle factor. |

For normal editor-authored behavior and lambda code, do not rely on returning a
generator from `update()` as a resume mechanism. Keep per-frame work bounded,
use `processObjects()` for lambda iteration, split long jobs across frames with
your own state machine, or move pure computation into a background worker.

The frame context reports `interpolationAlpha` / `fixedOverstep` from the
authoritative accumulator. Use those values only for render-facing smoothing;
gameplay state changes belong in `fixedUpdate()`.

---

## Rendering and physics controls

Rendering controls manage draw-call and renderer compatibility choices:

| Setting | Stored at | Notes |
|---|---|---|
| Enable Dynamic Batching | `scene.userData.rendering.batching.enableDynamic` | Rebuilds batching state when toggled. |
| Mesh Instancing Optimization | editor setting | Reduces repeated mesh draw overhead when suitable. |
| Editor Preview Instancing Budget | `scene.userData.rendering.editorPreviewInstancingBudget` | Caps only behavior-generated `isRuntimeOnly` instanced meshes while editing; authored meshes and Play counts are restored unchanged. Defaults to 750,000 total submitted triangles and 250,000 per mesh. |
| Editor Preview Geometry Budget | `scene.userData.rendering.editorPreviewGeometryBudget` | Reversibly simplifies eligible single-material imported model meshes while editing; original geometry is restored before Play. Defaults to 180,000 total preview triangles, 30,000 per mesh, and a 24,000-triangle source-size guard. Larger authored meshes are skipped until the worker decimator lands. |
| Editor Shadow Budget | `scene.userData.rendering.editorShadowBudget` | Caps cascaded-shadow preview work while editing; authored CSM cascade counts are restored in Play. Defaults to two cascades when CSM is authored with more. |
| Clear Batching Data | runtime action | Clears current batching stats/debug data. |
| Force WebGL | `scene.userData.rendering.forceWebGL` | Live compatibility path. The runtime prefers WebGPU, but can request Three.js's WebGL backend and automatically retries with it when WebGPU initialization fails. |
| Force WebGL for VFX | `scene.userData.rendering.forceWebGLForVFX` | Requests the VFX compatibility path. Verify effects individually because renderer-specific post-processing may be reduced or unavailable. |

Physics controls:

| Setting | Stored at | Notes |
|---|---|---|
| Enable Physics Sleeping | `scene.userData.physicsSleepingEnabled` | Lets inactive bodies sleep until woken. |
| Multi-threaded Physics | `scene.userData.physicsUseWorker` | Runs heavier physics work in a worker where supported. |

Post-processing and shadow sections expose renderer-specific quality controls.
Use them after choosing a quality preset so you are tuning from a known baseline.

### Editor preview instancing budget

Procedural behavior previews can create substantially more instances than the
editor needs to communicate layout. The engine therefore applies a temporary
budget to visible instanced meshes marked `userData.isRuntimeOnly === true`.
The cap changes only `InstancedMesh.count`, preserves the original instance
buffers, and restores the full count before Play starts. Terrain allocators keep
a separate logical instance count, so preview capping cannot corrupt chunk
add/remove bookkeeping. This keeps authoring responsive without silently
changing runtime fidelity.

Scenes that need a different preview policy can set:

```ts
scene.userData.rendering.editorPreviewInstancingBudget = {
  enabled: true,
  maxTotalSubmittedTriangles: 1_000_000,
  maxSubmittedTrianglesPerMesh: 250_000,
  minInstancesPerMesh: 1,
};
```

Set `enabled: false` for a scene whose editor preview must always show every
procedural instance. This is an editor-only setting; runtime instancing uses
the separate `instancingBudget` policy.

### Editor shadow budget

Cascaded shadow maps are valuable in Play but disproportionately expensive in
an editor preview, where they can multiply the cost of every authored mesh.
When a directional light uses the CSM behavior, editor preview defaults to two
cascades while keeping the authored cascade count for Play. Configure or opt
out per scene:

```ts
scene.userData.rendering.editorShadowBudget = {
  enabled: true,
  maxCascades: 2,
};
```

Set `enabled: false` to inspect the full authored shadow cascade layout while
editing. This policy never changes the saved CSM attributes or runtime shadow
quality.

### Editor preview geometry budget

Imported model previews can contain far more vertex detail than the editor
camera can resolve. The editor may temporarily simplify single-material model
meshes that exceed the preview thresholds. The original `BufferGeometry` stays
owned by the mesh and is restored before Play, scene save, or editor teardown.
Meshes with material groups, multiple materials, morph targets, or an explicit
opt-out are left untouched.

```ts
scene.userData.rendering.editorPreviewGeometryBudget = {
  enabled: true,
  maxTotalTriangles: 180_000,
  maxTrianglesPerMesh: 30_000,
  minTriangles: 8_000,
  simplifyRatio: 0.45,
  maxSourceTriangles: 24_000,
};
```

This setting is editor-only. Runtime and Play always use the authored model
geometry and asset LOD policy.

---

## Behavior performance controls

![Behavior performance controls](./assets/scheduler-behavior-performance.png)

The **Behavior Performance** section configures throttling for behavior updates:

| Setting | Effect |
|---|---|
| Off Screen Optimization | Allows off-screen behaviors to update less often. |
| Distance-Based Optimization | Allows far behaviors to update less often. |
| Force Consistent Updates | Keeps updates consistent when throttling would cause visible/gameplay issues. |
| Update Priority | Marks behaviors as critical/high/medium/low/minimal for scheduler decisions. |
| Mid/Far Distance Threshold | Distances where throttle tiers begin. |
| Mid/Far Throttle Factor | How aggressively non-critical behaviors are skipped at those tiers. |

These values are stored in `scene.userData.behaviorThrottlingConfig` and also
update the running game config when Play mode is active.

Use critical/high priority for player controllers, combat resolution, and logic
that must stay frame-accurate. Use lower priorities for ambient props, distant
NPC polish, idle effects, and visual-only behaviors.

---

## Budget and lambda profiling

![Budget inspector and Lambda Explorer](./assets/scheduler-lambda-explorer.png)

The **Budget Inspector** surfaces runtime budget state for avatars, plots,
textures, and hot rows. Use it when a scene is spending too much memory or when
runtime budget coordination is shedding work.

The **Lambda Explorer** is disabled by default. Enable it in Play mode to see:

- Active lambda instance count.
- Dependency wave count.
- Entity count per lambda instance.
- Average and maximum execution time per lambda.

This is the fastest way to find a lambda that should be converted to
`processObjects()`, split into smaller systems, or moved partially into a worker.

---

## LOD, developer tools, and splats

The same panel includes tools that affect performance but are not scheduler
settings:

| Section | What it configures |
|---|---|
| LOD Generation | Batch model LOD settings and optimized model generation. |
| Scene Root Transform Policy | Whether runtime auto-resets, warns about, or ignores non-identity scene root transforms. Stored in `scene.userData.rendering.rootTransformPolicy`. |
| Performance Statistics Overlay | Runtime frame diagnostics while playing. |
| Memory Statistics Overlay | Runtime memory diagnostics while playing. |
| Debug Mode | Development-only diagnostics through `app.debug` / storage. |
| Gaussian Splats / Spark Renderer Options | Splat culling, sort, LOD, and Spark renderer tuning stored under `scene.userData.rendering.splat` and related Spark options. |

Turn overlays on only while profiling; leave them off for normal authoring and
published play.

---

## Default Scene settings

![Default Scene settings](./assets/default-scene-settings.png)

The **Default Scene** entry edits scene-wide environment settings rather than a
single mesh:

| Section | What it controls |
|---|---|
| Ambient Lighting | Global flat light color and intensity. Use sparingly; high values flatten form and make shadows less useful. |
| Hemisphere Lighting | Sky color, ground color, and intensity for simple outdoor-style fill lighting. |
| Fog | Scene fog mode and related fog parameters when enabled. |
| Scene Background | Color, equirectangular texture, cubemap, or gradient backdrop. Texture/cubemap modes also expose rotation, intensity, and blurriness. |
| Tone Mapping | Tone mapping operator and exposure. Use this after lighting is close; it affects final brightness and contrast. |
| Shadows | Real-time shadow toggle and shadow map type. Shadow map type changes require a reload. |

These settings are serialized through the scene rendering/environment data, so
they travel with saved projects and scene exports.

---

## Directional Light settings and behaviors

![Directional Light settings](./assets/directional-light-settings.png)

The default **Directional Light** is the scene's sun/key light object. Select it
from the Project tab to edit both its transform and light-specific controls:

| Setting | Use it for |
|---|---|
| Transform | Position and rotation determine the light direction and helper placement. Directional lights are effectively infinitely far away; direction matters more than distance. |
| Unity-style | Uses a Unity-like directional light workflow for scenes or imported content that expect that convention. |
| Cast Shadow | Enables real-time shadows from this light. Keep this enabled on the main sun/key light and limit other shadow-casting lights. |
| Color / Intensity | Controls the key-light tint and brightness. |
| Shadow Map Resolution | Shadow texture size. Higher values improve detail but cost GPU memory and render time. |
| Shadow Camera Distance | Coverage area for directional shadows. Smaller coverage gives sharper shadows. |
| Shadow Bias / Normal Bias | Fine tuning for acne, peter-panning, and shimmer. Use tiny values. |
| Shadow Radius / Blur Samples | Softness controls for supported shadow map types. |

Use the **Behaviors** tab on the directional light when the light should follow
a target, react to triggers, or simulate a day-night cycle. The `dayNightCycle`
behavior is the built-in starting point for animated sun direction and time of
day. Keep static lighting in the Properties tab; use behaviors only when light
state changes during play.

---

## Playground vs server-backed revision control

The playground/local storage path keeps projects local and latest-only for asset
edits. Behavior, lambda, script import, and setting changes resolve to the
current local version so iteration is simple.

A server-backed install adds full revision history through `ProjectStore`,
`AssetSource`, and the `@stem/network` revision endpoints. In that mode, each
save can create an immutable scene or asset revision, history panels can diff
and roll back, and published players can stay pinned to a release while editors
continue working on head.

See [`server-side-storage.md`](./server-side-storage.md) for the backend
interfaces behind that version-control model.

---

## Recommended workflow

1. Pick the closest quality-policy record, then verify which settings the live
   runtime applied.
2. Use `fixedUpdate(fixedDeltaTime)` for physics-coupled deterministic gameplay
   and `update(deltaTime)` for per-render animation, camera, UI, and VFX.
3. Tune behavior throttling before hand-optimizing individual scripts.
4. Use Lambda Explorer in Play mode when many objects share the same logic.
5. Use Budget Inspector and overlays to confirm the bottleneck before lowering
   visual quality.
6. Save behavior, lambda, and import assets through the editor or designer so
   revisions and dependencies stay pinned correctly.
