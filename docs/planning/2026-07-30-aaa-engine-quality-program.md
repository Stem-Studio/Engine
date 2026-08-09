# AAA Web Engine Quality Program

Date: 2026-07-30; current-state refresh: 2026-08-02

## Objective and scope

Raise the web engine toward a measurable AAA-quality, Roblox-class creator and
runtime standard: responsive at gameplay scale, trustworthy under authoring,
and capable of shipping varied games from the local Playground workflow.

The active release target is **Playground mode**. Local project persistence,
scene import, Edit/Play routing, renderer startup, Ammo/Rapier physics, creator
tools, and landscape-only mobile authoring are in scope. Remote scene/API mode
is not deployed and is not a fallback or valid QA path. Portrait exposes only a
rotate-device gate.

No slice is accepted because a control or preset exists in isolation. It must be
wired to the live runtime, measurable, covered by focused tests, and reviewed
at the surface where a game developer uses it.

The durable evidence index is the [AAA current evidence inventory](../../.omo/evidence/aaa-current-evidence-inventory-2026-08-02.md).

## Current verified state

| Area | Current result | Evidence / review |
| --- | --- | --- |
| Playground startup and rendering | Headed TinySkies and 100 Cars Play/refresh runs are nonblank, use WebGPU where available, report no browser/page/request errors, and meet the current local frame gate. TinySkies reveal completeness is now bounded: a production-preview refresh reached 652/652 reveal targets with the controller inactive. The fresh TinySkies rerun records `startPlayerTotal=1728ms`, `rendererWarmup=538ms`, `firstRenderHandshake=0ms`, refresh P95 `18.6ms`, and zero dropped simulation steps. | [Startup performance evidence](../../.omo/evidence/threejs-startup-performance-2026-08-02.md), [fresh TinySkies rerun](../../.omo/evidence/tinyskies-headed-rerun-2026-08-02.md), [reveal completeness](../../.omo/evidence/tinyskies-reveal-completeness-2026-08-02.md) |
| Play/Stop lifecycle | Production `build/public` now completes ten forced-GC TinySkies Play → Edit → Play cycles with a flat 131,000,000-byte heap sample, clean script resources, and no hidden runtime owners after Stop. The older dev-server heap growth remains a tooling/allocation diagnostic; repeated post-Stop GPU/browser settlement is low-priority follow-up. | [Production memory-cycle evidence](../../.omo/evidence/tinyskies-production-memory-cycles-2026-08-02.md), [Play/Edit fast path](../../.omo/evidence/tinyskies-play-edit-fastpath-2026-08-02.md), [dev-server diagnostic](../../.omo/evidence/tinyskies-memory-cycles-2026-08-02.md) |
| Canonical Play/refresh routing | Local Playground preserves the scene slug and `/edit`/`/play` mode across refresh. | [Canonical route evidence](../../.omo/evidence/playground-route-canonical-2026-08-02.md) |
| Representative game matrix | Production Playground import → Play → Edit is green at landscape `844×390` for TinySkies, 100 Cars, populated Pirate Ship, and 3D Chess. Pirate keyboard movement is live; the exact `mpvjt7g7` Pirate file is an empty placeholder and is excluded from gameplay quality claims. | [Landscape game verification](../../.omo/evidence/game-verification-landscape-2026-08-02.md) |
| Physics runtime | Ammo and Rapier remain the only supported backends. Static terrain now has a validated heightfield contract and collision coverage; Ammo uses native Bullet heightfields, while the installed Rapier WASM transparently falls back to a static terrain mesh because its raw heightfield export traps. Worker debug drawing is opt-in and transferable; solver quality is selected by presets, reaches both live worker and main-thread backends, and now has a shared resting-stack behavior gate. Native Rapier heightfields and deeper constraint/projectile equivalence remain open. | [Physics reload evidence](../../.omo/evidence/physics-ammo-memory-growth-2026-08-02.md), [terrain conformance](../../.omo/evidence/physics-terrain-heightfield-2026-08-02.md), [solver runtime evidence](../../.omo/evidence/physics-solver-runtime-quality-2026-08-05.md), [solver behavior evidence](../../.omo/evidence/physics-solver-behavior-2026-08-05.md), [physics cut inventory](./2026-07-30-physics-engine-cut-inventory.md) |
| Material persistence | Empty, malformed, metadata-only, and default-white Quick Build entries are repaired to visible authored materials. Latest release scenario: 200 meshes, 1,200 material entries, `emptyCount=0`. | [Material reload evidence](../../.omo/evidence/material-entry-reload-2026-08-02.md) |
| Production-preview Play smoke | Durable local `build/public` TinySkies import → Play at 1440×900 is nonblank with `ERRORS []`, `FAILED []`, and 0 empty model references. | [Production-preview evidence](../../.omo/evidence/production-preview-tinyskies-2026-08-02.md) |
| Runtime shadow attribution and budget | 100 Cars attribution identifies `TrackRuntimeRoot` as the dominant runtime-only shadow source. The fallback-only automatic policy now caps runtime-dominated CSM shadow submissions at 100k estimated triangles, preserves authored/player casters, skips WebGPU, and restores disabled runtime casters when fallback eligibility disappears. Default scenes remain unchanged. | [Shadow attribution and opt-in budget evidence](../../.omo/evidence/100-cars-shadow-caster-attribution-2026-08-03.md), [automatic fallback policy](../../.omo/evidence/automatic-fallback-runtime-shadow-policy-2026-08-03.md), [cap tuning evidence](../../.omo/evidence/automatic-fallback-shadow-cap-tuning-2026-08-05.md), [restoration evidence](../../.omo/evidence/automatic-fallback-shadow-restoration-2026-08-05.md) |
| Runtime main-pass triangle budget | A scene-opt-in, fallback-only whole-unit budget retained 198,501/462,975 estimated runtime triangles at a 200k cap and improved the refreshed 100 Cars fallback stress sample from 533.3 ms to 191.7 ms frame P95. Direct Play → Edit → Play restored runtime visibility and browser/request errors stayed clean. All sampled frames still exceeded 33ms, so this remains a mitigation experiment, not a default policy. | [Main-pass triangle budget evidence](../../.omo/evidence/100-cars-runtime-main-triangle-budget-2026-08-03.md) |
| Quick Build workflow | Compact landscape rail, status feedback, utility drawer, grouped tools, variants, brushes, and 13 placement tools are live. The final 844×390 headed smoke has 64 assertions and zero failures; independent visual review is APPROVE. | [Toolbar evidence](../../.omo/evidence/quick-build-toolbar-ui-2026-08-02.md), [visual review](../../.omo/evidence/quick-build-clone-fidelity.md) |
| Quick Build keyboard/focus | Grouped menus enter focus on open, support roving arrow/Home/End navigation, and restore focus to the trigger on Escape. | [Keyboard/focus evidence](../../.omo/evidence/quick-build-keyboard-focus-2026-08-02.md) |
| Input reliability | Current Playground input regression coverage is recorded; pirate-ship and TinySkies interaction paths remain part of the representative-game matrix. | [Input evidence](../../.omo/evidence/input-regression-2026-08-02.md) |
| Mobile orientation contract | Playground/editor mobile support is explicitly landscape-only. Legacy `any` and portrait scene values normalize to `requireLandscape`, and the settings surface exposes only the supported landscape choice. | [Landscape policy evidence](../../.omo/evidence/mobile-landscape-policy-2026-08-02.md) |
| Quality allocation hygiene | The renderer quality module applies the live pixel ratio directly and no longer allocates an unconsumed dynamic-resolution target for mobile/low-ratio presets. | [Rendering quality target cleanup](../../.omo/evidence/rendering-quality-target-cleanup-2026-08-04.md) |
| Quality API contract | Retired auto-quality and performance-monitoring no-op methods plus unconsumed renderer-config/effect query storage are removed from the supported quality surface; explicit presets, pixel ratio, shadow policy, max-lights integration, metrics, and render-pressure overrides remain live. | [Quality API surface cleanup](../../.omo/evidence/quality-api-surface-cleanup-2026-08-04.md) |
| Play-mode diagnostics | Performance monitor is available without authored HUD and reports frame cadence, simulation drops, renderer calls/triangles, resource counts, pixel ratio, and draw-buffer size. | [Play-mode renderer diagnostics](../../.omo/evidence/performance-overlay-renderer-diagnostics-2026-08-05.md) |
| Static runtime batching hot path | Publish-mode meshes marked `isStatic` retain structural-change detection while skipping repeated full batch/material/transform reconciliation; dynamic and editor-mode meshes retain the prior behavior. No numeric frame-time win is claimed until a static-heavy runtime fixture enables batching. | [Static publish-mode batching hot path](../../.omo/evidence/static-publish-batch-hot-path-2026-08-04.md) |
| Render submission attribution | Opt-in substage tracing shows direct renderer submission, not scene synchronization or batching, is the current 100 Cars steady-state owner. A conservative CSM placement cache is covered and retained without a standalone frame-time claim. | [Render substage attribution](../../.omo/evidence/render-substage-attribution-2026-08-04.md) |
| Hosted Playground release gate | PASS: GitHub Pages now serves the Playground and dashboard directory entrypoints with HTTP 200; live iframe mount and browser/request error gate pass after the focused `main` deployment fix. | [Hosted Playground deployment gate](../../.omo/evidence/hosted-playground-deploy-gate-2026-08-04.md), [load smoke](../../.omo/evidence/playground-load-smoke-2026-08-05.md) |
| Empty-scene CSS3D submission | Optional CSS3D DOM rendering is gated by the cached presence of CSS3D objects; discovery and populated-scene behavior remain intact. | [Empty-scene CSS3D render gate](../../.omo/evidence/css3d-empty-scene-render-gate-2026-08-04.md) |

These are verified slices, not proof that the complete AAA target is finished.
The current gate review keeps the remaining requirements explicit. | [Gate review](../../.omo/evidence/tinyskies-current-gate-review-2026-08-02.md)

## Representative Playground gates

| Fixture / surface | Current verdict | Remaining qualification |
| --- | --- | --- |
| TinySkies, headed 1440×900 | PASS: nonblank Play/refresh, hidden startup mask, zero browser errors, frame P95 `17.6ms`; progressive reveal is bounded to complete. | Real-device/mobile framebuffer and smoothness during forced reveal completion remain open. |
| TinySkies, production preview 844×390 landscape | PASS for browser-emulated landscape smoke: nonblank Play, `ERRORS []`, `FAILED []`, startup `1918ms`. | Physical-device WebGPU, refresh-cycle, and mobile frame-pacing gates remain open. |
| 100 Cars, headed 1440×900 | PASS for current interactive WebGPU Play/refresh capture: six render calls, 107,865 triangles, approximately 60 FPS, frame P95 `18.7ms`. Production-preview Play smoke is also durable with `ERRORS []`, `FAILED []`. | Authored `TrackManager` stress, repeated memory plateau, and full decorative reveal remain open. |
| Quick Build, headed 844×390 landscape | PASS: lane bounds `x=360..776`, primary controls stay inside the lane, utility drawer opens without action-rail overlap, all 13 placements render. | Deeper keyboard/focus menu coverage remains open. |
| 3D Chess and Pirate Ship Battle Royal | Imported fixtures are part of the local verification set. | A durable current artifact for every multi-fixture run must be recorded before claiming a matrix-wide release pass. |

Historical WebGL/headless throttling captures must remain labelled diagnostic;
they cannot contradict the current headed WebGPU result without a matching
device/backend scope. A browser screenshot in `/tmp` is useful during a run but
is not durable release evidence until it is copied or summarized in `.omo/evidence`.

## Release requirements

### Runtime performance

- 60-FPS desktop target: P95 ≤ 18.5 ms, P99 ≤ 25 ms, fewer than 1% of frames
  over 33 ms.
- Landscape mobile/high target: P95 ≤ 20 ms, P99 ≤ 28 ms, fewer than 1% over
  40 ms; low-power 30-FPS fallback has its own 35/45/66 ms limits.
- Report engine cadence, skipped/dropped frames, CPU phases, draw calls,
  triangles, geometries, textures, effective DPR, physics backlog, and quality
  transitions—not only browser RAF.
- Demonstrate a stable forced-GC memory plateau across ten Play/Stop cycles.

### Simulation and physics

- One bounded fixed-step clock owns physics and fixed gameplay updates; dropped
  time and worker backlog are observable.
- Ammo and Rapier share conformance for bodies, triggers, raycasts, characters,
  sleeping, removal, deterministic order, vehicles, joints, CCD, and static
  terrain collision.
- Remaining quality work is honest and explicit: a native Rapier heightfield
  WASM upgrade, deeper solver-quality behavior, and backend-specific
  tuning.

### Rendering

- Tone mapping/output conversion happens exactly once.
- Post-processing skips unnecessary normals/roughness/SSR work.
- Environment maps use correct reflection mapping and color space.
- Every quality-preset field has a live consumer; aspirational fields are cut.
- Desktop and landscape mobile reference scenes receive screenshot-level harsh
  visual review at gameplay scale.

### Creator trust and workflow

- Save state exposes truthful `Unsaved`, `Saving`, `Saved`, and `Failed` states;
  autosave is coalesced and only marks success after scene/assets persist. The
  TopNav also reconciles resolved-but-skipped local saves from live watermarks,
  so read-only/Copilot-preview guards cannot strand the UI in `Saving`.
- Play → Edit restores local Playground state without remote requests.
- Import, export, playable build, and publish remain separate accurately named
  operations.
- Validation links errors to the affected object, behavior, file, and line.
- Startup diagnostics identify blocking authored hooks and point authors to
  `this.erth.runtime.processInBatches()` and `yieldToFrame(true)`.

### Editor experience

- Primary actions and hierarchy remain readable at 1280×720, 1440×900, and
  1920×1080 without clipped critical controls.
- Landscape-only mobile authoring targets 844×390 and safe-area variants.
- Focus, keyboard, screen-reader, pointer, and touch paths are verified for all
  high-frequency interactions.
- Performance information is available inside Play mode without DevTools.

## Current open inventory

1. **Performance:** profile the remaining dev-server heap growth as a tooling
  diagnostic; capture real
  mobile framebuffer/WebGPU measurements; split or replace the authored 100
  Cars `TrackManager` startup builder; run matched-frame and physical-device
  validation for the opt-in `runtimeShadowBudget` and
  `runtimeMainTriangleBudget` experiments before enabling any in shipped
  fixtures.
2. **Rendering:** qualify the smoothness cost and visual quality of the bounded
   reveal completion, plus broader screenshot comparisons on representative
   fixtures.
3. **Physics:** native Rapier heightfield support and deeper solver-quality
   behavior comparisons. Non-dynamic mass normalization, shared
   preset-selected solver-iteration controls, and a resting-stack behavior gate
   now cover both Ammo and Rapier across main-thread and worker paths; native
   heightfield and deeper constraint/projectile behavior gates remain open.
4. **Workflow:** unified save/recovery status and durable multi-fixture evidence;
   grouped Quick Build keyboard/focus behavior is now covered.
5. **Documentation:** every current-state claim must point to an existing
   checked-in artifact; historical records must be labelled and never used as a
   current release gate.

## Retain, consolidate, remove

**Retain and connect:** WebGPU-first rendering with WebGL fallback; Ammo and
Rapier; physics-worker backpressure; cooperative startup APIs; asset derivatives,
KTX2, Meshopt, batching, instancing, runtime LOD, resource ownership, texture
residency, render-pressure diagnostics, local Playground persistence, and the
existing behavior validation infrastructure.

**Consolidate:** frame/render/simulation telemetry; startup/reveal/mutation
diagnostics; DPR/quality/post-processing control; project/scene/place naming;
save/dirty/autosave/recovery state; and import preview/routing.

**Remove when no live consumer is proven:** aspirational preset fields, independent RAF
profiler loops, duplicate defaults, misleading autosave/build/runtime claims,
remote-scene fallbacks in Playground, and portrait editor workspace behavior.

## Execution discipline

Every implementation slice needs focused tests, a real Playground measurement,
and an independent code or visual review appropriate to the requirement. A
rejected slice returns to implementation with its review evidence attached.
This document records the current state only; historical plans remain useful
context but cannot silently promote an unverified claim into a PASS.
