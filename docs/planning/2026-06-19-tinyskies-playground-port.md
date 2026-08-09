# TinySkies → StemStudio playground port (run + extend fidelity)

> **Status: Historical; partially superseded for the current release scope
> (2026-07-30).**
> Local Playground import and editor **Play** remain useful validation scenarios,
> but they must be re-scoped under the
> [AAA Web Engine Quality Program](./2026-07-30-aaa-engine-quality-program.md).
> The current headed WebGPU Play/refresh gate is recorded in
> [startup performance evidence](../../.omo/evidence/threejs-startup-performance-2026-08-02.md)
> and [the current gate review](../../.omo/evidence/tinyskies-current-gate-review-2026-08-02.md).
> The checked-in evidence set is indexed in the
> [current AAA evidence inventory](../../.omo/evidence/aaa-current-evidence-inventory-2026-08-02.md).
> The standalone `/play/<id>` target below is deferred and is not a current
> acceptance path while remote scene/API deployment is unavailable. The
> original two-target requirements remain below as historical evidence.

Goal: make the existing tinyskies port (`/Users/n/erth/Games-StemScript/tinyskies`)
import and run in playground mode (editor **Play** + standalone **/play/<id>**),
then extend the deliberately-capped systems toward fuller source fidelity.
Source game: "GlobeFly" — fly a biplane around a procedural globe + paintball.

Scope decision (user): **Run first, then extend fidelity. Both play targets.**

## Diagnosis (done)

- The port is mature: 41 behaviors, 7 GLB models, 5 shared `@import` scripts,
  6 FDRs. Its own FDR/source-map docs are **stale** (they describe caps that
  have since been un-capped; the requirements doc's "all Implemented" is closer).
- **Root cause of "doesn't work in playground":** the shared-scripts feature
  (`import script` + `@import "name" as X;`) is gated behind
  `isScriptsEnabled()` = `REACT_APP_SCRIPTS_ENABLED === "true"`, which is **unset
  everywhere** in the repo (dev + build). With scripts off, every behavior that
  `@import`s a helper (`terrain`, `spherical-math`, `biplane-mesh`,
  `vehicle-meshes`, `uikit-dual-mode`) fails to import →
  `Unable to resolve import "terrain" as T`. All 41 behaviors collapse; the
  imported scene is just the 7 hidden models. This affects **6 shipped games**
  (2048, drop7, island-defense, machine-arena, sky-bomber, tinyskies).
- Proven via instrumented import probe: with scripts off, `behavior {n:10, fail:10}`,
  no `script` imports run. With scripts on, `script {fail:0}`, `behavior {fail:0}`.

## Fix 1 — enable shared scripts in OSS (DONE, verify)

- `client/packages/editor-oss/src/utils/featureFlags.ts`: `isScriptsEnabled()`
  now returns `IS_OSS || env`. Scripts are a first-class OSS authoring feature
  (docs/import-packs.md, the stemscript-folder import pipeline); only Stripe is
  hard-gated off in OSS. Integrated keeps the env opt-in.
- [x] Behaviors import (failCount 11 → 1; the 1 is the cosmetic `scene thumbnail`).
- [x] Core subset (globe/biplane/flight/camera/paintball/day-night/controls-hud)
      imports and **plays with zero console errors** — biplane flies over the
      terrain globe, chase cam tracks. (screenshot: /tmp/tinyskies-diag-core-play.png)
- [ ] Full 41-behavior import completes and plays (verifying).
- [ ] `/play/<id>` of the saved project runs.

## Fix 2 — import performance (one-time cost, but blocks the smoke + UX)

Even with scripts on, import is slow: model ~12s each (7≈90s), behavior ~7s each
(41≈300s), script ~4s each. Full import ≈ 8–12 min. It's a one-time cost (the
saved scene reloads fast), but the playground smoke's import-wait window is
~126s, so it would save a partial scene. Targets:
- [ ] Model load: each 130 KB GLB takes ~12s via `[AssetLoader] No suitable
      derivative … fetching revision` + a 6-strategy `[TextureMapping] findTexture
      ALL STRATEGIES FAILED` storm. Investigate; likely a quick win.
- [ ] Per-behavior import ~7s: profile `createBehavior` /
      `updateSceneBehaviorRevision` path.
- [ ] If residual slowness remains, bump the heavy-game import-wait in
      `scripts/playwright/oss-all-games-playground.mjs`.

## Fix 3 — cosmetic: `scene thumbnail` → `POST /api/Scene/Edit` 404 in OSS

`thumbnail.ts` hits the integrated server endpoint; should be a no-op / local in OSS.

## Phase 2 — extend fidelity (after it runs)

Re-derive the real gap vs source `/Users/n/erth/tinyskies/client/src` (docs are
stale). Known un-ported source systems: HUD (1890 LOC), AudioManager, FlagSystem
(MP hot-potato), MoonThreat (fail state), OceanFish, Braziers, Volcano,
SkyJellyfish, BirdFlock, RainOverlay (weather), UpgradeManager/LevelUpCards,
PilotAvatar, Campsite, multiplayer Lobby + RemotePlayerNameLabels + paintball relay.
Break into per-system subtasks once the gap map is complete.

## Validation

- [ ] `bun run typecheck`, `bun run lint` (NOT eslint --fix)
- [ ] `bun run test` (Vitest) — featureFlags / scriptImports tests still green
- [x] Current headed WebGPU Playground Play/refresh gate passes; see the current evidence above. The older `oss-all-games-playground.mjs` checklist remains historical.
- [ ] `/play/<id>` loads the saved project and runs
- [ ] Re-run the other 5 script-using games' smoke (the flag change affects them)
- [ ] **Manual code review**
- [ ] Remove temp diagnostics: `__stemImportTimings` (useTerminal.ts),
      `scripts/playwright/_tinyskies-diag.mjs`
