# StemStudio Engine — Agent Guide

This file is for code-modifying agents working inside the StemStudio Engine
open-source repository. It is intentionally a router and an architecture map,
not a tutorial. Treat the code as the source of truth; this guide tells you
where to look and what rules to honour.

## Core rules

1. Search before you write. Reuse existing code and patterns.
2. Ask clarifying questions when scope or product intent is ambiguous.
3. Build a short plan in `docs/planning/` before non-trivial changes, then
   implement against it.
4. Keep changes small and local. Pause before large or breaking edits.
5. Read the relevant code before editing it.
6. Prefer the code as the source of truth — when docs disagree, fix the docs.
7. Update affected docs after a change.
8. Dispose Three.js resources you create: geometries, materials, textures,
   render targets, listeners.
9. Run the right verification before declaring work done. Never use
   `eslint --fix`.

## What this build is

A browser-based 3D editor and runtime built on Three.js with a React UI, a
behavior system, an ECS-style lambda layer, Ammo.js / Rapier physics, a
Colyseus multiplayer sidecar, and a Go AI proxy that forwards calls to the
user's own provider keys (BYOK).

Projects persist locally — IndexedDB by default, or a real folder via the
File System Access API. There is no hosted backend in this build: no
authentication, no cloud project store, no telemetry. Every feature you
see in the UI runs against local state or against a service the user
explicitly configured.

## Architecture at a glance

```text
client/packages/
  editor-oss/         The editor: scene tree, viewport, behaviors,
                      lambdas, physics adapters, scheduler, rendering,
                      asset loading, serialization, the Copilot panel,
                      runtime UIKit/HUD.
  copilot/            Provider-agnostic copilot interfaces and a basic
                      chat panel for forks. Editor-oss reaches the
                      provider through ICopilotProvider — no concrete
                      provider is bundled in this build by default.
  network/            HTTP/WS adapters. The remote-go adapter in here is
                      the only thing that talks to the AI server. Other
                      paths read/write the local ProjectStore directly.
  shared/             Cross-package types, build-mode flags, queryClient,
                      Sentry, AppContainer shell.
  play/               The Player-only runtime — the entry point a built
                      game uses when it ships standalone.
  marketing/          Marketing pages used by the dashboard shell.

server/               Go HTTP/WS server. The AI subset (`cmd/ai-server`)
                      is the only binary that ships here — it proxies AI
                      provider calls using the BYOK keys.

stemstudio-multiplayer/  Colyseus server. Auto-started by `bun run dev`.
stemstudio-copilot/      Optional ACP/MCP bridge for forks that want
                         Claude Code-style tool use.

docs/                  Engine subsystem docs and planning.
scripts/               Build, export, and Playwright smokes.
```

`__BUILD_MODE__` is fixed to `oss` in this build, and the `IS_OSS` /
`IS_INTEGRATED` flags in `@web-shared/buildMode` flow from that. Code that
checks `IS_OSS` is the seam where this build deliberately diverges from
features that would require a hosted backend — auth, cloud asset storage,
telemetry, hosted multiplayer. Keep those gates intact when refactoring.

## Persistence

Project bodies (`{meta, sceneJson, ...}`) flow through the
`ProjectStore` interface in `client/packages/editor-oss/src/persistence/`:

- `IndexedDBProjectStore` — default; one row per project keyed by ID.
- `FileSystemProjectStore` — writes `<name>.<id>.stemscript.json` files
  into a folder the user picked via `showDirectoryPicker`. The picked
  handle persists in IndexedDB (`fsHandleStore.ts`) so subsequent reloads
  reattach without re-prompting on Chromium.

`projectStoreFactory.ts` is the singleton boundary. The OSS first-run
modal (`OSSBootstrapModal.tsx`) and the dashboard banners
(`OpenFolderBanner.tsx`, `ReconnectFolderBanner.tsx`) are the only
surfaces that swap the active store at runtime; everything else reads
through `getProjectStore()`.

When you add a new feature that needs to write data, route it through
`ProjectStore` — do not invent a parallel storage path.

## Behaviors

- Base type and lifecycle live in
  `client/packages/editor-oss/src/behaviors/Behavior.ts`.
- Behaviors register through `BehaviorTypeRegistry`. Saved scenes embed
  the per-instance config in `scene.userData.behaviorConfigs`. Built-in
  behaviors are referenced by id only; full configs hydrate from the
  in-process registry on load.
- Reach the engine from inside a behavior via `this.erth.*` and
  `this.gameObject`. Old `EventBus` and `this.target` style code is
  deprecated.
- **Editor lifecycle hooks run without `init()`.** `onEditorAdded`,
  `onEditorAttributesUpdated`, and `onEditorUpdate` fire in the editor
  (e.g. at import/attach time) where `init(game)` is never called. A
  common bug class: a behavior caches `const erth = this.erth` (or
  `game`) _only_ inside `init()`, then dereferences that module-local in
  an editor hook — yielding `Cannot read properties of undefined (reading
'asset')` and silently failing to load textures/assets. Always read
  engine handles from `this.erth` / `this.gameObject` directly, or
  re-derive the locals at the top of _every_ lifecycle entry point —
  never assume `init()` already ran. Note `this.gameObject` exposes
  `uuid`/`position`/`rotation`/`scale`/`visible`/`physics`/`_internal.three`
  only — there is **no** `gameObject.game`; in the editor `game` is
  typically `undefined`, so guard any `game.renderer.*` access.
- Lifecycle docs, catalog, and authoring guide: `docs/built-in-behaviors.md`.

## Lambdas (ECS)

`client/packages/editor-oss/src/lambdas/` — archetype-driven systems on
top of behaviors. Use when you need batched, dependency-scheduled work.
See `docs/lambdas.md` for the architecture internals.

## Scheduler, rendering, quality

Frame orchestration is in `client/packages/editor-oss/src/scheduler/`,
post-processing and pipeline in `render/`, adaptive quality in
`core/quality/`. The scheduler drives lambdas every frame; do not call
lambda systems directly.

## Physics

Two engines, one adapter surface:
`client/packages/editor-oss/src/physics/` plus the per-behavior glue in
`behaviors/stem/physics/`. Memory management for Ammo and shape-system
conventions are non-obvious — read the physics helper / `PhysicsSettings` /
`RigidBodyHandle` sections of `docs/gameobject-and-game-manager-api.md` and the
code itself before touching either.

## Editor UI

React tree under `editor-oss/src/editor/`. The dashboard, scene tree,
viewport, asset panels, and copilot panel all live here. UI components
that need the engine read `global.app?.editor?.*`; defensive optional
chaining is the convention because the engine boots after the React
shell.

## AI

This build has an optional, provider-agnostic AI surface and a Go AI
proxy that fronts the BYOK keys.

- `editor-oss/src/copilot/ICopilotProvider.ts` is the seam. The build
  ships with no concrete provider; an OSS fork can register one through
  `setCopilotProviderFactory`. When no provider is registered the
  Copilot panel hides itself.
- The Go AI server (`server/cmd/ai-server`) is what the editor's
  `network/adapters/remote-go` calls. It accepts BYOK keys from env or
  the dashboard's BYOK panel and proxies to Anthropic / OpenAI / Meshy /
  Tripo / Rodin / ElevenLabs / Anything World. **It is not a hosted
  service** — it runs on the user's machine.
- Inline `exec` and the script-tool import pipeline
  (`editor-oss/src/agent/script-tool/`) work without any AI provider.
- The dashboard exposes "Import stemscript folder" which stages a folder
  via sessionStorage, navigates to a fresh project, and runs the same
  `exec` flow to materialize a saved project.

## Multiplayer

`stemstudio-multiplayer/` is a Colyseus server. `bun run dev` boots it as
a sidecar. Client code lives in
`client/packages/editor-oss/src/multiplayer/`. The room schema is shared
across the wire; touching either side without thinking about both will
diverge them.

## Build modes

This build is OSS-only. The original codebase ships in two flavours from
the same tree (integrated + OSS); only the OSS slice was exported here.
Code paths gated on `IS_OSS === true` are always-on in this build, and
the corresponding integrated-only files are absent from the tree.

When you add a feature that would require a hosted backend (account
management, hosted scene library, telemetry), gate it behind a new
local-config flag or surface it through the existing BYOK pattern.
**Do not** add hosted-backend URLs to the source.

## Verification

Pick the narrowest meaningful check; broaden if risk justifies it.

```bash
bun run typecheck
bun run lint
bun run test          # Vitest (jsdom). NOT `bun test` — that runs Bun's
                      # native runner, which lacks the jsdom env and fails.
bun run vite-build
bun run build-server   # builds the Go AI proxy

# End-to-end smokes — require `bun run dev` running on :5173
node scripts/playwright/oss-smoke.mjs
node scripts/playwright/oss-filesystem-roundtrip.mjs
node scripts/playwright/oss-open-folder-banner.mjs
node scripts/playwright/oss-import-3dchess.mjs
node scripts/playwright/oss-builder-mode-smoke.mjs
node scripts/playwright/oss-builder-tools-ux-smoke.mjs
node scripts/playwright/oss-plan-cad-smoke.mjs
```

The smokes cover the engine round-trip:

- IndexedDB persistence: dashboard → save → reload → play.
- File System Access mode: pick folder → save → reload → list.
- Open-folder banner: bootstrap with IDB, swap to filesystem mid-session.
- Stemscript folder import: 3D chess folder → exec → saved project.
- Builder Studio: Quick Build, Mesh CAD, and BIM Plan actionbar/tool flows.

If you change anything that those smokes touch (the persistence layer,
the dashboard shell, the AiCopilot panel mount, the script-tool import
pipeline, or Builder Studio), re-run the relevant listed smokes. They are fast.

## Planning convention

Plans go under `docs/planning/YYYY-MM-DD-short-topic.md`. Keep them
short: goal, assumptions or open questions, affected files,
implementation steps, validation steps. Use Markdown checkboxes (`- [ ]`)
so the plan doubles as a progress tracker. Always include a
`Manual code review` checkbox in the Validation section.

If during implementation you discover the plan is incomplete, extend the
plan first (add the missing checkboxes), then continue. Don't silently
drift.

## Stop and confirm

Pause and ask before:

- changing the persistence layer or save/load semantics;
- changing scheduler, render, or multiplayer semantics without clear
  local precedent;
- removing or refactoring `IS_OSS` gates;
- changing build scripts or deployment paths;
- introducing a new external service dependency;
- making a change that spans unrelated subsystems.

## Doc index

| You're touching...                   | Read first                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Behaviors / game logic               | `behaviors/Behavior.ts`, then `docs/built-in-behaviors.md`                                                                |
| Lambdas / ECS                        | `lambdas/`, then `docs/lambdas.md`                                                                                        |
| Import packs / reusable scripts      | `editor/scripts/builtinPacks/`, then `docs/import-packs.md`                                                               |
| Runtime / engine API (`this.stem.*`) | `EngineRuntime.ts`, then `docs/runtime-api.md`                                                                            |
| GameObject / GameManager API         | `object/`, `behaviors/game/GameManager.ts`, then `docs/gameobject-and-game-manager-api.md`                                |
| Scheduler / frame loop / quality     | `scheduler/`, `core/quality/`, then `docs/scheduler-and-editor-settings.md`                                               |
| Physics                              | `physics/`, `behaviors/stem/physics/`, then `docs/gameobject-and-game-manager-api.md` (PhysicsSettings / RigidBodyHandle) |
| Quick Build / builder stamps         | `editor/assets/v2/QuickBuild/`, then `docs/quick-build.md`                                                                |
| BIM Plan / Plan CAD                  | `editor/assets/v2/PlanMode/`, then `docs/plan-cad.md`                                                                     |
| Builder Studio release gate          | `editor/assets/v2/ActionBar/`, `QuickBuild/`, `PlanMode/`, then `docs/builder-studio-release-gate.md`                     |
| Editor UI / import / camera          | `editor/`, `controls/`, `serialization/` (no dedicated doc)                                                               |
| Runtime UI / HUD / UIKit             | `behaviors/uikit/`, `behaviors/hud/`, then `docs/uikit-api.md`                                                            |
| Multiplayer                          | `multiplayer/`, `multiplayer/worker/`, then `docs/multiplayer.md`                                                         |
| AI integration (client)              | `copilot/`, `agent/`, `server/server/controllers/tools/ai/`                                                               |
| AI server (Go)                       | `server/cmd/ai-server/`, `server/server/server.go`, then `docs/architecture.md`                                           |
| BYOK / provider keys                 | `docs/byok.md`                                                                                                            |
| Persistence                          | `persistence/`, then `docs/server-side-storage.md`                                                                        |
| Scene serialization                  | `object/`, `serialization/`, then `docs/architecture.md`                                                                  |
| Three.js conventions                 | `EngineRuntime.ts`, `render/` (no dedicated doc)                                                                          |
| Exporting a game                     | `scripts/`, then `docs/exporting-a-game.md`                                                                               |
| Art budgets                          | `blog/docs/assets/10-art-specs.md`                                                                                        |

## Axis conventions

- World axes: Y up, +X right, +Z toward the default editor camera. Three.js
  standard.
- Engine forward (character runtime / generated controllers): **-Z**.
- Mixamo assets face **+Z** by default — the `character` behavior's
  `invertForwardDirection` attribute is the 180° fix for stock Mixamo.
- BlazePose → Three.js conversion: `Vector3(lm.x, -lm.y, -lm.z)` (only Y
  and Z flipped, X stays). See `assets/js/animations/poseFit.ts`.

<!-- dgc-policy-v11 -->

# Dual-Graph Context Policy

This project uses a local dual-graph MCP server for efficient context retrieval.

## MANDATORY: Always follow this order

1. **Call `graph_continue` first** — before any file exploration, grep, or code reading.

2. **If `graph_continue` returns `needs_project=true`**: call `graph_scan` with the
   current project directory (`pwd`). Do NOT ask the user.

3. **If `graph_continue` returns `skip=true`**: project has fewer than 5 files.
   Do NOT do broad or recursive exploration. Read only specific files if their names
   are mentioned, or ask the user what to work on.

4. **Read `recommended_files`** using `graph_read` — **one call per file**.
   - `graph_read` accepts a single `file` parameter (string). Call it separately for each
     recommended file. Do NOT pass an array or batch multiple files into one call.
   - `recommended_files` may contain `file::symbol` entries (e.g. `src/auth.ts::handleLogin`).
     Pass them verbatim to `graph_read(file: "src/auth.ts::handleLogin")` — it reads only
     that symbol's lines, not the full file.
   - Example: if `recommended_files` is `["src/auth.ts::handleLogin", "src/db.ts"]`,
     call `graph_read(file: "src/auth.ts::handleLogin")` and `graph_read(file: "src/db.ts")`
     as two separate calls (they can be parallel).

5. **Check `confidence` and obey the caps strictly:**
   - `confidence=high` -> Stop. Do NOT grep or explore further.
   - `confidence=medium` -> If recommended files are insufficient, call `fallback_rg`
     at most `max_supplementary_greps` time(s) with specific terms, then `graph_read`
     at most `max_supplementary_files` additional file(s). Then stop.
   - `confidence=low` -> Call `fallback_rg` at most `max_supplementary_greps` time(s),
     then `graph_read` at most `max_supplementary_files` file(s). Then stop.

## Token Usage

A `token-counter` MCP is available for tracking live token usage.

- To check how many tokens a large file or text will cost **before** reading it:
  `count_tokens({text: "<content>"})`
- To log actual usage after a task completes (if the user asks):
  `log_usage({input_tokens: <est>, output_tokens: <est>, description: "<task>"})`
- To show the user their running session cost:
  `get_session_stats()`

Live dashboard URL is printed at startup next to "Token usage".

## Rules

- Do NOT use `rg`, `grep`, or bash file exploration before calling `graph_continue`.
- Do NOT do broad/recursive exploration at any confidence level.
- `max_supplementary_greps` and `max_supplementary_files` are hard caps - never exceed them.
- Do NOT dump full chat history.
- Do NOT call `graph_retrieve` more than once per turn.
- After edits, call `graph_register_edit` with the changed files. Use `file::symbol` notation (e.g. `src/auth.ts::handleLogin`) when the edit targets a specific function, class, or hook.

## Context Store

Whenever you make a decision, identify a task, note a next step, fact, or blocker during a conversation, call `graph_add_memory`.

**To add an entry:**

```
graph_add_memory(type="decision|task|next|fact|blocker", content="one sentence max 15 words", tags=["topic"], files=["relevant/file.ts"])
```

**Do NOT write context-store.json directly** — always use `graph_add_memory`. It applies pruning and keeps the store healthy.

**Rules:**

- Only log things worth remembering across sessions (not every minor detail)
- `content` must be under 15 words
- `files` lists the files this decision/task relates to (can be empty)
- Log immediately when the item arises — not at session end

## Session End

When the user signals they are done (e.g. "bye", "done", "wrap up", "end session"), proactively update `CONTEXT.md` in the project root with:

- **Current Task**: one sentence on what was being worked on
- **Key Decisions**: bullet list, max 3 items
- **Next Steps**: bullet list, max 3 items

Keep `CONTEXT.md` under 20 lines total. Do NOT summarize the full conversation — only what's needed to resume next session.
