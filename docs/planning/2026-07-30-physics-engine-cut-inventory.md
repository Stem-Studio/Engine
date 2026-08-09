# Physics engine cut inventory

Status: Current
Date: 2026-07-30
Owner: Unassigned
Last verified: 2026-08-04

Scope: the physics subsystem after removing Jolt and PhysX. This is an evidence-based cut list, not authorization to remove gameplay features.

## Executive recommendation

Make the cleanup in three passes:

1. ~~Delete proven dead code now.~~ Completed 2026-07-30.
2. Collapse capabilities that are no longer optional now that Ammo and Rapier both implement them.
3. Treat the legacy API/worker/multiplayer consolidation as a separate migration with compatibility tests.

The remaining physics subsystem is about 8,200 lines across its main abstractions, adapters, transport layers, utilities, and two backends. Most of that code is active. The largest avoidable cost is not a third backend anymore; it is maintaining two public physics APIs plus transport wrappers. The current 100 Cars startup profile measured `physicsCreate` at `6-9ms`, so physics creation is not the active startup bottleneck for that fixture; behavior startup and scene mutation quiescence are.

## Completed cut: proven dead

Implementation status verified on 2026-07-30:

| Candidate | Evidence | Implementation status |
| --- | --- | --- |
| `physics/PhysicsEngineBase.ts` | The file contained only `export {};` and had no consumers. | [x] Deleted 2026-07-30. |
| `physics/shapes/index.ts`, its shared re-export, and isolated tests | The 174-line “modern shape system” was only referenced by its own tests and the shared forwarding file. Production uses `BodyShapeType` and collision-shape types from `physics/common/types.ts`. | [x] Deleted 2026-07-30. |
| `useMultiplayerPhysicsEngine` branch | `PlayerPhysics2.create()` always assigned `false`; there was no assignment to `true`. The branch dynamically loaded `MultiplayerProxy`. | [x] Flag and unreachable branch deleted 2026-07-30. |
| `multiplayer/MultiplayerProxy.ts` and shared forwarding export | Its only production construction was inside the unreachable branch above. | [x] Deleted 2026-07-30. |
| `event/PhysicsEvent.js` and isolated tests | It was absent from `EventDispatcher.events`, had no production importer, forced itself disabled, and created a separate Ammo soft-body world. | [x] Deleted 2026-07-30. |
| `shared/player/component/physics/ThrowBallEvent.js` and isolated tests | It had no production consumer and constructed Ammo bodies directly. | [x] Deleted 2026-07-30. Reintroduce the gameplay feature only through the backend-neutral public physics API if needed. |
| `TerrainUtil.createRigidBody()` | The method had no consumer and directly constructed Ammo heightfields. | [x] Deleted 2026-07-30; the separate terrain serialization decision remains open. |
| Active `PhysicsWrapper` multiplayer path | `PhysicsWrapper` and `MultiplayerUtils` implement the live multiplayer path independently of the removed proxy branch. | [x] Retained and covered while removing the unreachable alternative. |

The pre-implementation estimate was roughly 1,200 lines plus the
`PlayerPhysics2` branch. Treat that number as planning history, not a
post-change measurement.

## Documentation and dead-surface cleanup verified 2026-08-04

| Candidate | Evidence | Implementation status |
| --- | --- | --- |
| `behaviors/collisions/CollisionDetector.world` and its Ammo type import | No read or write consumer existed; collision dispatch already uses the backend-neutral `IPhysics` interface. | [x] Removed 2026-08-02. |
| `physics/rapier/README.md` legacy API examples | The document described nonexistent `RapierIntegration`, `RapierPhysicsWorld`, and `isRapierAvailable` APIs, plus an Ammo fallback that is not the selected factory contract. | [x] Rewritten 2026-08-02 against `PhysicsEngineFactory` and the shared `PhysicsEngine` contract. |
| Local legacy `addModel` physics surface | The local adapter always threw `Method not implemented`; repository-wide audit found no local callers beyond its worker/event plumbing. | [x] Removed 2026-08-04 from the local `IPhysics` contract, adapter, worker transport, event table, payload type, and generated interface docs. The separate undeployed multiplayer copy remains explicitly qualified. See [removal evidence](../../.omo/evidence/legacy-addmodel-removal-2026-08-04.md). |

The remaining direct Ammo references are either the retained Ammo backend,
licensed runtime assets, or explicitly tracked compatibility debt such as the
raw Ammo argument passed to legacy player scripts. No removed backend name is
part of `PhysicsEngineType`, `PhysicsEngineFactory`, the scene-setting command,
or the supported documentation path.

The native Rapier terrain boundary was revalidated on 2026-08-04. Shared
terrain payloads keep rows along local Z and columns along local X, while
Rapier 3D heightfields define rows along X and columns along Z. The native
constructor now swaps those dimensions at the boundary; the Ammo and static
TriMesh paths remain unchanged. The installed compatibility WASM still traps
on `rawshape_heightfield`, so the runtime uses its cached TriMesh fallback and
native contact-quality replay remains open. See the [Rapier heightfield axis
conformance evidence](../../.omo/evidence/rapier-heightfield-axis-conformance-2026-08-04.md).

## Quality-control surface cleanup verified 2026-08-02

The quality preset schema now contains only physics controls with a live
consumer in the unified Playground runtime:

| Setting | Consumer | Decision |
| --- | --- | --- |
| `updateRate` | `EngineRuntime.configureSimulationQuality()` and the authoritative fixed-step clock | Retain. |
| `substeps` | `EngineRuntime.configureSimulationQuality()` and worker fixed-step dispatch | Retain. |
| `maxStepsPerFrame` | `FixedStepSimulationClock` catch-up bound | Retain. |
| `collisionQuality`, `maxActiveBodies`, `sleepThreshold`, `continuousCollisionDetection`, `asyncComputation` | No runtime consumer; they were only copied into presets and displayed in the preset detail popover. | Removed from the quality schema, built-in presets, and UI on 2026-08-02. Legacy persisted JSON is still tolerated by the spread-based loader, but is no longer surfaced or written by built-in presets. |

This keeps the quality panel honest: changing a displayed physics value now
changes the fixed-step runtime, rather than only changing metadata.

The same audit found two rendering preset fields with no live consumer:
`shadowMapSize` belongs to per-light scene settings, and the quality module's
`shadowCascades` calculation had no caller and never created cascade lights.
Both were removed from the quality schema, built-in presets, and preset detail
UI on 2026-08-02. Shadow quality/type, pixel ratio, post-processing effect
flags, texture quality/anisotropy, LOD bias, and max-light culling remain
exposed because they have active module consumers. Per-light shadow map size
continues through the Lighting panel and scene serialization.

Residual rendering-quality debt remains: `RenderingQualityModule` still stores
antialiasing, post-processing, and texture-quality configuration for its
integration surface, while the current runtime directly applies only the
pixel-ratio, shadow, texture-anisotropy, and max-light portions. Those fields
need a dedicated EffectRenderer integration audit before they can be called
fully live or removed; this slice intentionally does not make that larger
behavioral change.

## Simplify next: no longer optional with two engines

| Candidate | Evidence | Recommendation |
| --- | --- | --- |
| `VehiclePhysics` capability guard | Both `AmmoPhysicsEngine` and `RapierPhysicsEngine` implement `addVehicle`/`removeVehicle`. | [x] Vehicle methods are mandatory on the core `PhysicsEngine` contract; the optional `VehiclePhysics` type guard and adapter fallback were removed. |
| `JointPhysics` capability guard | Both retained engines implement fixed, hinge, and point-to-point joints. | [x] Joint methods are mandatory on the core `PhysicsEngine` contract; the optional `JointPhysics` type guard and adapter fallback were removed. |
| Capability-skipping test harness logic | Vehicle and joint tests previously allowed an engine to skip the feature. | [x] Shared vehicle/joint harnesses call the mandatory contract directly; Ammo and Rapier both pass. |
| Stale Rapier capability notes | Documentation claimed Rapier vehicles throw at runtime, while the implementation supports vehicles. | Corrected during the two-engine cleanup. |

This pass reduces conditional behavior and makes the two retained backends uphold one explicit contract.

## Startup scheduling inventory

This is adjacent to physics because physics creation is part of Play startup, but
the current evidence says scheduling and authored startup work are the larger
problem.

| Area | Status | Recommendation |
| --- | --- | --- |
| `this.erth.runtime.processInBatches()` | Implemented and reviewed as a public cooperative startup API. It yields between authored callback items and supports abort signals. | Retain and connect to authoring guidance, examples, and warnings. It is the preferred way to build large runtime object sets during startup. |
| `this.erth.runtime.yieldToFrame(true)` | Implemented before the batching helper and now documented as the manual paint-yield escape hatch. | Retain. Use directly only for custom phased work that cannot fit `processInBatches()`. |
| Runtime-added object startup cadence | `GameManager.initializeObject()` now avoids duplicate progressive-yield accounting for pure behavior-only objects while preserving the extra charge for physics/lambda registration. | Retain. This improves frame pacing for runtime additions; keep the measured Track Builder failure separate because the engine cannot preempt a synchronous authored loop. See [cadence evidence](../../.omo/evidence/startup-scheduler-cadence-2026-08-01.md). |
| Post-init scene-mutation registration | Plot-budget and texture-residency registration now use one iterative fan-out traversal with per-consumer candidate pruning; lookup remains a separate pre-init pass. | Retain. This removes redundant post-init subtree walks without changing authored initialization order. Validate against fresh desktop and 844x390 Playground profiles before attributing a startup improvement. See [shared traversal evidence](../../.omo/evidence/scene-mutation-shared-traversal-2026-08-01.md). |
| Playground startup mask / local persistence module | Runtime reveal now owns startup-mask completion after a real rendered frame and clears early-failure state. The optional File System Access class is static at the folder-picker surfaces, avoiding a Vite/HMR click-time dynamic-import race; the direct module endpoint remains healthy. | Retain. This is a local Playground correctness/resilience fix, not a physics-performance change. See [mask-fix evidence](../../.omo/evidence/black-canvas-mask-fix.md). |
| Slow behavior startup diagnostics | Implemented and reviewed. The warning names slow lifecycle hooks and points to the cooperative API. | Consolidate into a visible Play-start report with phase timings, not only console warnings. |
| Behavior editor async-startup validator | Implemented and reviewed. The 100 Cars Track Builder script is flagged for calling an async same-script startup builder without `await`. | Retain and broaden carefully only where AST-backed validation can identify actionable author fixes. |
| External 100 Cars `TrackManager` builder | Still monolithic in the external fixture. Current evidence records `TrackManager` at `3345-4286ms` and broader behavior startup at `7309-8378ms` in the v27/v28 profile artifacts. | Performance FAIL until the authored builder adopts cooperative batching or an engine-owned equivalent is proven. Do not claim engine startup success from API availability alone. |
| `physicsCreate` phase | Measured at `6ms` desktop and `9ms` landscape in the v27/v28 artifacts. | Retain current tracking, but do not prioritize physics creation for the next 100 Cars startup slice unless new profiles contradict the existing data. |
| Worker remove-event cleanup | The worker can receive a remove after a rejected or already-disposed body. The adapter now checks `hasRigidBody()` before forwarding and keeps local cleanup idempotent; the latest 100 Cars landscape run reduced missing-body warnings from 149 to 0. | Retain the guard and regression coverage. This removes diagnostic noise without hiding valid add/reject warnings. See [idempotent removal evidence](../../.omo/evidence/physics-idempotent-removal-2026-08-02.md). |

Evidence:
[cooperative startup implementation](../../.omo/evidence/cooperative-startup-runtime-api.md),
[code review](../../.omo/evidence/cooperative-startup-runtime-api-code-review.md),
[100 Cars startup profile QA](../../.omo/evidence/cars-trackmanager-startup-profile-qa.md),
and [visual review](../../.omo/evidence/cooperative-startup-harsh-visual-review.md).

## Retain for now: active and useful

| Area | Why it stays |
| --- | --- |
| Ammo and Rapier backend implementations | These are the two selected products. |
| `ShapeCache` | Used by both retained backends to share backend collision-shape resources safely. |
| Geometry extraction, hull computation, and geometry worker pool | Used by object physics and endless terrain; expensive mesh work belongs off the main thread. |
| `PhysicsRuntimeUtil` | Used by player, multiplayer, behaviors, and controls for runtime config and transforms. |
| `MotionStateHelper` | Used by character, platform, and jump-pad behaviors. |
| Physics debug drawing | Both retained engines implement `initDebug`; the player consumes it. |
| Worker physics path | Actively selected by device/environment checks and keeps simulation off the main thread. |
| Main-thread physics path | Still used on Windows, debug mode, unsupported-worker environments, and local tests. |
| `PhysicsWrapper` and `MultiplayerUtils` | They implement the active multiplayer path. |

## Discuss before cutting: architectural debt, not dead code

### Dual APIs: `IPhysics` and `PhysicsEngine`

`PhysicsEngine` is the backend-facing primitive contract. `IPhysics`/`PhysicsBase` is the older object-, worker-, and multiplayer-facing contract. `LegacyPhysicsAdapter` bridges them and is about 839 lines.

Recommendation: audit and narrow this boundary until a dedicated migration proves
all live consumers. Do not delete `LegacyPhysicsAdapter` merely because the
engine set is now Ammo/Rapier only. Removing it means rewriting `PhysicsProxy`,
`PhysicsWorker`, `PlayerPhysics2`, behavior-facing declarations, and
multiplayer wrappers around one canonical contract. The likely target should be
`PhysicsEngine` plus a separate transport/client interface, rather than making
the backend interface absorb worker concerns.

### Shared-package forwarding files

Many `client/packages/shared/src/physics/*` files only re-export editor-oss implementations. They look redundant but currently preserve `@web-shared` import compatibility.

Recommendation: retain until imports are migrated package-wide, then delete forwarding files in one mechanical pass.

### Legacy terrain utility

`utils/TerrainUtil.ts` still has a legacy serialized-terrain consumer, while the
canonical `LegacyPhysicsAdapter.addTerrain()` path now converts the payload into
the backend-neutral heightfield shape used by Ammo, Rapier, and the static
TriMesh fallback. The direct Ammo helper remains compatibility debt rather than
the active Playground creation path.

Recommendation: retain serialized terrain until its loader has a dedicated
cross-backend replay. Do not add new direct Ammo calls; route future terrain
features through `PhysicsEngine`/`LegacyPhysicsAdapter` and keep the existing
heightfield conformance evidence current.

### Physics quality controls

The quality UI/presets expose collision quality, maximum active bodies, sleep
threshold, continuous collision detection, asynchronous computation, timestep,
and substeps. Several of these values still have no backend consumer.

The authoritative-clock portion of this work is complete. In the unified
`EngineRuntime` path, one bounded fixed-step clock owns physics, collision
processing, fixed behaviors, and fixed lambdas. It reports clamped/dropped time,
uses the active quality policy's physics rate and catch-up limit, and preserves
the same logical step order through the worker acknowledgement queue. The
legacy `PlayerPhysics2` accumulator remains only for callers outside the unified
runtime path; it is not a second accumulator in the active Playground frame
loop. See the
[fixed-step evidence](../../.omo/evidence/fixed-step-simulation-clock-2026-07-30.md).

Recommendation: keep only controls with a tested live consumer in both Ammo and
Rapier. Solver iterations are now explicit and live for Rapier normal fixed
steps; CCD and sleep policy now have two-backend conformance evidence. The
former body-cap/max-active-bodies control was removed from the quality schema
and presets because neither active backend had a safe shared consumer. Retire the
non-unified compatibility accumulator only as part of the separately tested API
convergence.

### Worker/main-thread parity

The worker client presents the same broad interface as the main-thread adapter.
Angular velocity is now forwarded and cached with lifecycle cleanup, and shape
replacement now traverses the ordered worker event path. Debug drawing is still
not fully implemented on the worker path. See [worker motion-state parity evidence](../../.omo/evidence/physics-worker-motion-state-parity-2026-08-02.md) and [shape replacement evidence](../../.omo/evidence/physics-worker-shape-replacement-2026-08-02.md).

Recommendation: retain both execution paths only behind a mandatory parity
suite. Narrow the worker/client contract where parity is not intended instead of
silently returning `null`, undefined values, or warnings.

### Raw Ammo in user scripts

Legacy player events still expose a raw `Ammo` argument for saved Ammo
projects, but the compatibility binding is now gated by the active
`PhysicsEngineType`. A cached Ammo singleton is never exposed to Rapier after a
Play/Edit engine switch. The backend-neutral `physics` argument remains the
supported surface for new scripts.

Recommendation: retain the gated compatibility shim for existing saved
Playground projects and migrate new authoring/docs to the stable physics
facade. Removing the raw parameter remains a separately reviewed breaking
change, not a reason to leak backend state into Rapier.

### Dynamic concave collision

Decision (2026-08-01): retain static concave collision, and reject dynamic or
kinematic concave collision at every supported boundary. The authored-object
policy is enforced in `PhysicsUtil.addObjectShapeToPhysics()` before cache
lookup, hull extraction, worker dispatch, or either backend call. Ammo and
Rapier repeat the invariant in low-level `addRigidBody`, `setRigidBodyShape`,
and `addCharacterController`; the worker proxy rejects invalid direct
registrations before local bookkeeping. Effective body type follows runtime
mass semantics: positive mass is dynamic; zero/absent mass is static unless
explicitly kinematic.

Do not auto-convert rejected meshes to convex hulls. That would silently change
collision semantics and hide an authoring error. The author receives an
actionable message directing them to fixed `Static` geometry, an explicit
`ConvexHull`, or compound primitive colliders.

Character controllers are intentionally treated as kinematic for this policy;
standard player setup remains capsule/primitive based. Direct low-level shape
creation remains reusable after a rejected body, so an author can correct the
body type without rebuilding geometry.

Evidence:

- [shared body-type policy](../../client/packages/editor-oss/src/physics/common/physicsConfig.ts)
- [authored-object guard](../../client/packages/editor-oss/src/physics/PhysicsUtil.ts)
- [focused policy tests](../../client/packages/editor-oss/src/physics/PhysicsUtil.test.ts)
- [Ammo backend conformance entrypoint](../../client/packages/editor-oss/src/physics/ammo/AmmoPhysicsEngine.test.ts)
- [Rapier backend conformance entrypoint](../../client/packages/editor-oss/src/physics/rapier/RapierPhysics.test.ts)
- [Ammo backend](../../client/packages/editor-oss/src/physics/ammo/AmmoPhysicsEngine.ts)
- [Rapier backend](../../client/packages/editor-oss/src/physics/rapier/RapierPhysicsEngine.ts)
- [Playground landscape QA report](../../.omo/evidence/dynamic-concave-playground-qa/report.json)
- [Low-level conformance review](../../.omo/evidence/lowlevel-concave-policy-review-2026-08-01.md)
- [Low-level Playground QA report](../../.omo/evidence/lowlevel-concave-playground-qa/report.json)

The focused policy suite passes (74 tests), the Ammo/Rapier backend entrypoints
pass together (281 tests across 2 files), and typecheck passes. The authoritative
Playground QA report is **PASS**: both main-thread and worker landscape runs
enter Play with a visible canvas, exactly two expected warnings each
(`DynamicConcave` and `KinematicConcave`), and zero fatal messages, page errors,
or request failures. The fixture also records the static-positive-mass
normalization and the adversarial raw override coverage.

### Physics configuration normalization

`getPhysics.ts`, `physicsConfig.ts`, `PhysicsUtil`, and `PhysicsRuntimeUtil` split defaults, schema, geometry conversion, and transform logic. Some transform/config operations overlap, but all four areas have live consumers.

Recommendation: consolidate by responsibility rather than deleting wholesale:

- schema/defaults/normalization;
- geometry-to-collision-shape conversion;
- runtime object-transform synchronization.

## Proposed order

1. [x] Remove the proven-dead files and unreachable multiplayer engine.
   Completed and verified 2026-07-30; the active `PhysicsWrapper` path remains.
2. Keep the cooperative startup API and diagnostics wired into behavior author
   docs and Play-start reporting; do not treat API availability as proof that
   authored fixture startup is fixed.
3. [x] Make vehicles and joints mandatory in the core backend contract; both retained backends pass the shared suites.
4. Decide whether legacy terrain files must remain loadable.
5. [~] Add worker/main-thread and Ammo/Rapier conformance suites. Angular
   motion-state parity, shape replacement, focused CCD tunneling coverage, and
   full Ammo/Rapier/worker suites now pass; debug drawing, terrain, and a
   browser-authored projectile scenario remain.
6. [~] Establish one fixed-step owner and make quality controls truthful.
   The authoritative fixed-step owner, bounded Rapier solver default, and
   preset-selected solver propagation through worker/main-thread paths are
   complete; CCD and sleep controls now have two-backend conformance, while the
   former body-cap control is removed from presets. A shared two-body
   resting-stack behavior gate now covers both backends; the deterministic
   static terrain fallback now has internal-edge correction and shared
   asymmetric peak/position conformance, while native Rapier heightfields and
   deeper solver behavior comparisons remain open. See [solver
   runtime evidence](../../.omo/evidence/physics-solver-runtime-quality-2026-08-05.md)
   and [solver behavior evidence](../../.omo/evidence/physics-solver-behavior-2026-08-05.md).
7. Design the `IPhysics`/`PhysicsEngine` convergence as a separately reviewed
   audit/narrow migration.
8. Remove shared forwarding exports only after their import paths have been migrated.
