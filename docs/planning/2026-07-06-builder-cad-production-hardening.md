# Builder / CAD / BIM production hardening plan

Date: 2026-07-06
Branch: `tinyskies-playground-port` (uncommitted work)
Predecessor: `docs/planning/2026-06-28-builder-and-cad-mode-followups.md` (all items
checked; this plan is the productization pass on top of that foundation).

## Goal

Take the three new build surfaces — **Quick Build** (fast stamping), **Mesh CAD**
("CAD without BIM": vertex/edge/face modeling via `editor.enterCADMode`), and
**BIM Plan** ("CAD for BIM": typed architectural node graph) — from
feature-complete to production grade across six axes: correctness/functionality,
UX, information architecture, visual design, performance, and operational
support (docs, licensing, flags, tests, release process).

## Current state (what exists, verified in code)

| Surface | Entry | Core files |
|---|---|---|
| Quick Build | ActionBar brush button (always visible); `?builder=1\|quick\|build\|builder` | `editor/assets/v2/QuickBuild/QuickBuildToolbar.tsx` (2,323 ln), `quickBuildObjects.ts`, `quickBuildSceneTools.ts`, `quickBuildTexturePacks.ts` |
| Mesh CAD | ActionBar "CAD Tools" menu → "Mesh CAD", gated by `Enable CAD tools` project setting; `?builder=cad` | `editor/assets/v2/ActionBar/CADActionBarControls.tsx` (1,325 ln), `editor/Editor.ts` CAD-mode API |
| BIM Plan | ActionBar "CAD Tools" menu → "BIM Plan", same gate; `?builder=plan\|bim` | `editor/assets/v2/PlanMode/PlanCadToolbar.tsx` (1,433 ln), `planCadCore.ts`, `planCadEditorBridge.ts`, `planCadGuides.ts`, `planCadInterchange.ts`, `PlanCadPropertiesSection.tsx` |

Supporting pieces: `ActionBar.tsx` mode wiring + `getBuilderStudioMode()` URL
param; `RightPanel.tsx:642` mounts `PlanCadPropertiesSection` for any selection;
`CADToolsSection.tsx` project-settings toggle; three Playwright smokes
(`test:e2e:builder-mode`, `test:e2e:builder-tools`, `test:e2e:plan-cad`);
`scripts/copy-tiny-world-builder-textures.mjs` + `/vendor/texture-packs/`
runtime discovery; unit/component tests beside each module.

Persistence model: BIM Plan state lives in
`scene.userData[PLAN_CAD_SCENE_USER_DATA_KEY]` (flat node dict) and is
committed via `SetValueCommand(scene, "userData", …)`, after which
`rebuildPlanCadRootObject` tears down and regenerates **all** children of the
`PLAN_CAD_ROOT_NAME` group. Quick Build objects are ordinary scene objects with
`userData` metadata, placed via `AddObjectCommand`/`MultiCmdsCommand`.

Also riding this branch (separate concern, see Workstream G):
behavior-pack refactors + new unit tests (ShopBehavior rewrite from
`userData.behaviors` to typed `attributes`, Enemy/SpawnPoint/Volume/
VideoBillboard/joints updates), `MobileGameServiceIdentity`, `useReplaceAsset`
changes, LightingSection/PhysicsSection edits, playground responsive CSS.
63 modified files (+1,563/−806) plus ~50 untracked files.

## Assumptions and open questions

- Assumption: OSS build only; no telemetry, no hosted backend. All "support"
  work is local-first (debug logs, docs, smokes).
- Assumption: desktop Chromium is the primary target; touch support is a
  P2 stretch, not a launch blocker (confirm — playground got mobile CSS, so
  mobile users will reach the editor).
- Open: should Quick Build stay ungated (GA) while Mesh CAD / BIM Plan stay
  behind the CAD beta toggle? Plan assumes **yes** (matches current code).
- Open: is multi-level (multi-storey) editing in scope for this release, or is
  the single auto-created site/building/level enough? Plan assumes single-level
  ships now with the level UI as fast-follow (C4).
- Open: collaboration semantics for plan edits (whole-userData blob writes
  clobber concurrent editors). Plan assumes documented limitation, not a fix.

---

## Workstream A — Correctness and architecture (P0, do first)

These are the defects that make the current build not production-safe.

### A1. Undo/redo desyncs BIM Plan visuals from data — [ ] fix

`commitPlanCadData` (`PlanCadToolbar.tsx:144`) and
`PlanCadPropertiesSection.commitData` execute `SetValueCommand` and then
imperatively call `rebuildPlanCadRootObject`. Undo (Ctrl+Z) restores the old
`scene.userData` **without** re-running the rebuild, so the generated meshes no
longer match the node data; redo compounds it. The next unrelated commit then
"resurrects" the undone state.

- [x] Write a failing test first: execute a wall creation, `editor.history.undo()`,
      assert the plan root has no wall object and `getPlanCadSceneData` matches.
- [x] Fix by resyncing in one place: subscribe (in `planCadEditorBridge` or a
      small `usePlanCadSync` hook mounted by `ActionBar`) to the editor history
      events (`historyChanged` / undo/redo signal — check `command/History.js`
      for the exact event) and on every history step, if
      `scene.userData[PLAN_CAD_SCENE_USER_DATA_KEY]` differs from the root's
      `userData.planCad.nodeCount`/hash, run `rebuildPlanCadRootObject` +
      `app.call("planCadChanged", …)`.
- [x] Alternative if history has no usable event: replace the
      SetValueCommand+manual-rebuild pattern with a dedicated
      `PlanCadMutationCommand` whose `execute()`/`undo()` both set userData AND
      rebuild. This is the cleaner end state; pick it if the event route is
      fragile.
- [x] Same treatment for `PlanCadPropertiesSection.commitData` (currently a
      second copy of the commit logic — extract a single shared
      `commitPlanCadSceneData(editor, data)` helper into
      `planCadEditorBridge.ts` and use it from both call sites).

Acceptance: undo/redo across wall/slab/zone/opening/part create, property
edit, and node delete always leaves generated geometry consistent with node
data; new unit test + a smoke assertion in `oss-plan-cad-smoke.mjs`.

### A2. Single source of truth for plan geometry on save/load — [ ] decide + enforce

The plan root's generated children are real scene objects; unless the
`AddObjectCommand(root, undefined, null, true, true)` flags exclude them, they
serialize into `sceneJson` alongside the node dict — two sources of truth that
can diverge (stale meshes after schema changes, doubled file size).

- [x] Investigate what those two boolean args to `AddObjectCommand` mean
      (`command/AddObjectCommand.js`) and what actually lands in a saved
      project (save a plan scene through `ProjectStore`, inspect JSON).
- [x] Enforce: generated children are **not** serialized (e.g.
      `object.userData.excludeFromSerialization` or the repo's existing
      equivalent — search `serialization/` for the established flag); on scene
      load, detect `PLAN_CAD_SCENE_USER_DATA_KEY` and rebuild the root from
      data (`sceneLoaded` listener in the same sync module as A1).
- [x] If exclusion is not feasible with current serializer, do the reverse
      consistently: always regenerate on load, overwriting whatever children
      were saved (rebuild is already idempotent), and document the file-size
      cost.
- [x] Add a persistence round-trip test: create wall + slab + part → save via
      `ProjectStore` → reload → assert node dict intact, geometry regenerated,
      selection restorable. Extend `oss-plan-cad-smoke.mjs` with a
      reload step (pattern exists in `oss-filesystem-roundtrip.mjs`).

Acceptance: byte-size of saved scene does not grow with generated meshes (or
documented otherwise); reload never shows stale geometry.

### A3. Scene-tree edits can orphan/resurrect plan nodes — [ ] guard

A user can delete or move a generated wall mesh in the scene tree; the node
dict still holds it, and the next rebuild resurrects it (or crashes on a moved
parent). Symmetric problem: deleting the plan root object leaves the userData
blob behind.

- [x] On `objectRemoved`/`objectChanged` for objects carrying
      `userData.planNodeId`, either (a) mirror the change into the node dict via
      the shared commit helper, or (b) block the edit and surface "Managed by
      BIM Plan — edit in Plan mode" (repo precedent: how CAD mode locks its
      target object). Pick (b) for launch — cheaper and safer; (a) is a
      fast-follow.
- [x] Deleting the plan root via scene tree must also strip
      `PLAN_CAD_SCENE_USER_DATA_KEY` (single command group so undo restores both).
- [x] Lock generated children against transform gizmo dragging (they are
      regenerated from data; direct transforms are silently lost). Editor
      likely has a `locked`/non-selectable convention — reuse it, keep
      click-to-select working for the properties panel.

Acceptance: no sequence of scene-tree operations can make node data and scene
objects disagree; tests cover delete-child, delete-root, transform-child.

### A4. Mode state machine for the four surfaces — [ ] refactor

`ActionBar.tsx` juggles `showQuickBuild`/`showMeshCad`/`showPlanCad`/
`showCadModeMenu` with manual cross-resets in three separate handlers
(`selectCadMode`, Quick Build onClick, `applyBuilderMode`), plus
`didApplyBuilderModeRef`. Exclusivity bugs are one edit away, and Editor's own
`cadMode` flag is a fifth copy of the truth.

- [x] Introduce a single `builderMode: "none" | "quick" | "mesh-cad" | "bim-plan"`
      state (reducer or tiny context in `editor/assets/v2/ActionBar/` — no new
      global store; match repo idioms). All entry points (buttons, menu, URL
      param, `Escape`, `onClose`, CAD-toggle-off) dispatch transitions; the
      transition function owns `exitMeshCadMode()` and menu closing.
- [x] Keep the existing `data-testid`s and behavior; `ActionBar.builderModes.test.tsx`
      and `builderToolbars.test.tsx` should pass with minimal edits — extend
      them with transition-matrix cases (quick→plan, plan→mesh, mesh→quick,
      setting-disabled-while-open, URL-param + toggle interplay).
- [x] Persist last-used builder mode per project (scene userData or
      localStorage keyed by project id) so reopening a "builder" project
      restores the toolbar — small but big returning-user win.

Acceptance: one reducer owns mode; impossible to have two toolbars open;
tests enumerate transitions.

### A5. Typing and lint debt in new code — [ ] clean

- [x] `ActionBar.tsx` opens with six `eslint-disable` lines and casts commands
      `new (SetValueCommand as any)(…)`. Type `command/Commands` exports (or
      add a typed wrapper `executeCommands(editor, …)` in one place) so new
      builder code doesn't need `as any`; remove the blanket disables from the
      files this branch touches (do NOT run `eslint --fix`; fix by hand).
- [x] `(app.editor as any)` reads of `scene.userData.snapping` etc. — add a
      typed accessor in `editor/assets/v2/RightPanel/panels/ProjectSettings/constants.ts`
      (`getSnappingSettings(scene)`) used by ActionBar, QuickBuild, PlanCad.

Acceptance: `bun run lint` and `bun run typecheck` pass with the disables
removed from touched files.

---

## Workstream B — UX (P0 items block launch; P1 fast-follow)

### B1. Discoverability and first-run (P0)

- [x] The three modes are icon-only buttons/menu items with hover tooltips.
      Add a one-time coach mark or empty-state hint: when Quick Build opens
      with an empty scene, show a dismissible strip in the toolbar ("Click the
      ground to stamp — 1-9 switch tools, R rotates, Esc exits"). Same for BIM
      Plan ("Click twice to draw a wall; double-click to finish a room").
      Persist dismissal in localStorage. Reuse the tutorial/dismissal pattern
      from the OSS bootstrap/tutorial modals (see smoke `dismissTutorial`).
- [x] "CAD Tools" gate: when `Enable CAD tools` is off, the menu button simply
      doesn't exist — users can't discover the feature. Show the button in a
      disabled state with tooltip "Enable CAD tools in Project Settings" OR add
      an "Enable…" affordance in the menu itself. (Follow-ups doc's own bar:
      "silent no-op states either become impossible or surface clear disabled
      states" — the hidden button violates the spirit of that.)
- [x] `Escape` exits the active builder mode consistently (Quick Build
      currently has keydown handling for tools; ensure Esc: first cancels a
      draft/preview, second closes the toolbar; same for Plan; Mesh CAD
      already has close semantics via `exitCADMode`).
- [x] Add a close ("×") button on the Quick Build toolbar mirroring the Plan
      toolbar's `handleClose` and Mesh CAD's close — three surfaces, one
      affordance.

### B2. Drafting interactions — BIM Plan (P0/P1)

- [x] Undo affordance while drafting: show "Backspace removes last polygon
      point" in the measurement strip while a polygon draft is active (the
      handler exists; make it discoverable). (P1)
- [x] Properties panel commit storm: `NumericInputRow` drag fires
      `commit` per tick → one `SetValueCommand` + full rebuild **per drag
      frame** and a history entry each. Debounce commits (commit on drag end /
      blur; live-preview by mutating the generated object directly during the
      drag, then one command). This is both UX (history spam — 40 undo steps
      from one slider drag) and perf (A6/E1). (P0)
- [x] Delete in `PlanCadPropertiesSection` has no confirmation and deletes
      subtree (walls lose openings silently). Add an inline confirm (two-step
      button, repo pattern search: `RevisionList`/asset delete flows) and say
      what cascades ("Delete wall and 2 openings?"). (P1)
- [x] Units: all plan inputs hard-code `unit="m"` while the editor has
      `UnitsSettings` (ActionBar already branches snap labels on it). Route
      `formatPlanMeters`/`formatPlanArea` and the properties `unit` prop
      through `UnitsSettings`. (P1)
- [x] Wall drawing chain mode: after committing a wall, keep the endpoint as
      the next wall's start (standard CAD behavior; today every wall needs two
      clicks from scratch — verify, and if already chained, expose the state in
      the anchor pill). (P1)

### B3. Drafting interactions — Quick Build (P1)

- [x] Drag-to-paint: verify continuous stamping while holding mouse down with
      brush modes; if placement is click-only, add hold-and-drag painting with
      the existing occupancy checks (the `handleMouseMove`/`handleMouseUp`
      scaffolding is present).
- [x] Show active-tool shortcut hints in tooltips (`formatQuickBuildShortcut`
      exists; ensure every `ToolButton` renders `aria-label` + shortcut).
- [x] Register Quick Build / Plan shortcuts in `EDITOR_KEYBINDINGS` so the
      Keyboard Shortcuts panel (`KeybindingsPanel`) documents them; today the
      toolbars own private keydown handlers invisible to the shortcuts panel.
- [x] Eraser/select feedback: hovering with erase tool should highlight the
      doomed stamp (outline or tint) before click.

### B4. Viewport-input robustness (P1/P2)

- [x] Both toolbars attach `mousedown/mousemove/mouseup` (6 handlers each) —
      convert to pointer events (`pointerdown` etc.) so pen and touch work and
      capture semantics are saner; keep behavior identical for mouse. (P1)
- [x] Touch: two-finger orbit vs one-finger stamp needs an explicit decision on
      touch devices; minimum viable: suppress stamping on multi-touch and honor
      `touch-action` on the toolbar. (P2)
- [x] `getCadModeMenuPosition`/`getCopilotMenuPosition` hard-code estimated
      popover heights (88px). Measure after mount (layout effect + transform)
      or reuse an existing anchored-popover util; menus currently jump/clip
      near screen edges. (P2)

### B5. Cross-cutting copy and affordances (P1)

- [x] Help button opens `https://docs.${window.location.hostname}` — broken on
      localhost/IP/preview deploys. Point at the real docs route (`/docs` in
      the site package) with an env override.
- [x] Empty texture-pack state: `TexturePackStatus` has
      loading/unavailable/error — verify each renders a distinct, helpful UI
      (e.g. "No texture packs deployed — run npm run textures:tiny-world"
      only in dev; in prod just hide the select when `unavailable`).
- [x] Disabled-state audit: every button that can no-op (Finish polygon with
      <3 points, Apply with no CAD selection, Bake with 0 stamps) must render
      `disabled` + tooltip reason. The smokes' `isPressed` helpers make these
      cheap to assert — add assertions per control.

---

## Workstream C — Information architecture (P1)

### C1. Naming and terminology — [ ] unify

One feature, five names today: "CAD Tools" (menu), "Mesh CAD", "BIM Plan"
(menu items), "Enable CAD tools" (setting), `PlanMode`/`planCad`/`plan-cad`
(code/test ids), plus URL aliases `1|true|quick|build|builder|plan|cad|bim`.

- [x] Decide the user-facing vocabulary once. Recommendation:
      **Build** (Quick Build), **Model** (Mesh CAD), **Plan** (BIM Plan),
      grouped under one "Build tools" concept; settings toggle becomes
      "Enable CAD & BIM tools (beta)" with a "beta" chip in the menu.
- [x] Trim `BUILDER_MODE_PARAM_VALUES` to the documented set
      (`quick|cad|plan`, keep `1` as alias for quick) and document in
      `docs/` (see G2). Keep old aliases parsing for compat but don't document.
- [x] Keep code names as-is (renames churn tests for zero user value), but fix
      test-id drift: `actionbar-cad-tools` vs `plan-cad-*` vs `mesh-cad-*` is
      fine; just freeze them as a contract in the docs so smokes stay stable.

### C2. Where the modes live — [ ] restructure the ActionBar cluster

Quick Build sits as a sibling of Help/Shortcuts/Camera; Mesh CAD and BIM Plan
hide inside a popover menu on a separate button. Users perceive three peer
modes with wildly different prominence.

- [x] Collapse to a single "Build" split-button/segmented control in the
      ActionBar: click = last-used mode, chevron = menu of all three (with the
      CAD-gated two disabled+explained when the toggle is off). This also
      simplifies A4's state machine surface.
- [x] Selected-state must be visible on the collapsed control (icon swap +
      active tint), since the toolbars render as separate floating strips.

### C3. Right-panel placement of BIM properties — [ ] tighten

- [x] `RightPanel.tsx:642` renders `PlanCadPropertiesSection` for every
      selected object (it self-hides via node lookup). Gate the mount on
      plan-mode-active OR selected-object-is-plan-node to avoid the per-selection
      `getPlanCadSceneData` scan in ordinary editing (also a perf micro-win).
- [x] Rename the section title from "BIM" to the node type ("Wall", "Slab",
      "Desk — BIM part") and show the breadcrumb (Level 1 › Zone A › Wall) using
      the parent chain — the flat node dict makes this cheap.
- [x] Openings are listed as a count ("2 openings") with no way to select or
      edit one. Minimum: clickable list of openings selecting the opening node;
      editable width/height/sill fields (types exist in `PlanWallOpening`).

### C4. Level/building structure UI — [ ] verify, then expose (fast-follow)

`planCadCore` models site→building→level and display modes
(stacked/exploded/solo/ghosted) but the toolbar exposes (verify) only drawing
tools + parts + camera presets.

- [x] Verify what `PlanCadToolbar` utility buttons expose today (display mode?
      level switch?). If absent: add a compact level picker (active level
      dropdown + "Add level" + display-mode cycle) in the Plan toolbar's
      utility group, writing through the shared commit helper (A1).
- [x] `activeLevelId` already persists in the data; ensure new walls/slabs
      parent to the active level (they hard-code the first level today —
      verify in `createPlanCadWall`).

### C5. Scene-tree presentation — [ ] label

- [x] Plan root and generated children show up with raw names in the scene
      tree. Give them icons/labels consistent with node types and visually mark
      them as managed/locked (ties into A3). Quick Build stamps similarly get a
      small stamp badge (they already carry metadata for the tree to key on).

---

## Workstream D — Visual design (P1)

### D1. Extract a shared builder-toolbar kit — [ ] dedupe

`QuickBuildToolbar` (30 styled components) and `PlanCadToolbar` (24) contain
a near-identical copy set: `Toolbar`, `ModeLabel`, `ToolsCluster`,
`ToolButton`, `ToolLabel`, `ToolMenuGroup/Button/Chevron/Sheet/Item/Icon/
Text/Label/Shortcut`, `Swatch`, `PanelDivider`, `AnchorPill` — already
drifting (shortcut styling differs). `CADActionBarControls` has a third
family (`CadButton`, `CadMenuSheet`, …).

- [x] Create `editor/assets/v2/common/builderToolbar/` exporting the shared
      primitives (Toolbar shell, tool button, grouped tool menu, divider,
      status pill, measurement strip). Port both toolbars onto it; port the Cad*
      menu family where it matches. Pure refactor — pixel-compare via the
      existing layout smoke (`assertToolbarButtonLayout`) before/after.
- [x] Replace `PlanCadPropertiesSection`'s inline-styled `MetricLine`/
      `DeleteButton` with panel commons (`NumericInputRow` siblings live in
      `RightPanel/common/`; add a `DangerButton` there if none exists).

### D2. Token and theme alignment — [ ] audit

- [x] New surfaces hard-code colors (`#9ca3af`, `rgba(239,68,68,…)`, per-tool
      `$color` hex). Map to the editor's existing palette/vars (check
      `ActionBar.style.ts` and RightPanel styles for the canonical tokens);
      keep per-tool accent colors but define them once in the kit.
- [x] Icons: ActionBar mixes SVG assets (camera, bug, magicAI) with
      react-icons (TbBrush, VscTools, TbHome2); `CADActionBarControls` defines
      12 bespoke inline SVG icons. Normalize new entries to one system
      (recommend: keep the bespoke SVG set, move to `ActionBar/icons/`, drop
      react-icons from these files to avoid a second icon language and cut
      bundle variance).

### D3. Accessibility pass — [ ] complete

Partial aria exists (21 attrs in QuickBuild, 15 in Plan, 3 in Mesh CAD).

- [x] Every tool button: `aria-pressed`, `aria-label` with shortcut,
      focus-visible ring (styled-components kit gives this for free once, D1).
- [x] Tool menu sheets (`ToolMenuSheet`) and the CAD mode popover: keyboard
      operability (arrow keys optional, but Tab/Escape/Enter mandatory), focus
      return to trigger on close, `role="menu"/"menuitem"` on the portal menus
      in `ActionBar` (MenuPopover currently has none).
- [x] Color-only signals (preview ghost validity green/red, active dots):
      add a secondary channel (icon or text in the measurement strip).
- [x] Contrast-check the toolbar text styles (11px gray-on-dark labels in the
      metric lines are likely below AA).

---

## Workstream E — Performance (P0 for E1/E2, else P1)

### E1. Incremental plan rebuild (P0)

`rebuildPlanCadRootObject` clears + disposes + recreates **every** node object
on every commit, then runs `processDirtyPlanNodes` over freshly-created (all
dirty) nodes — the dirty system exists but is bypassed. At a few hundred
walls this is per-click geometry churn, GC pressure, and (with TSL/WebGPU
materials) recompile risk — the same failure class as the tinyskies material
compile stalls already fought on this branch.

- [x] Maintain a persistent `PlanSceneRegistry` + state on the root (module-level
      map keyed by root uuid, or stored via closure in the sync module from A1).
      On commit, diff old→new node dicts (adds/removes/changes by shallow
      compare — nodes are plain data), mutate only affected objects, and run
      `processDirtyPlanNodes` on precisely those. Keep `rebuildPlanCadRootObject`
      as the cold-start/load path.
- [x] Preserve object identity across edits so selection, A3 locks, and the
      registry survive; only dispose geometries/materials that actually changed
      (walls share materials — confirm `planCadCore` reuses a material cache;
      add one if not: one material per (type, material tag), disposed only on
      root teardown).
- [x] Add a perf guard test: 200-wall scene, single property edit must touch
      <5 objects (assert via registry instrumentation), and a smoke-level
      timing budget (<16ms commit on the CI machine is unrealistic; assert
      object-churn counts instead — deterministic).

### E2. Commit-path costs (P0, pairs with B2 debounce)

- [x] `SetValueCommand(scene, "userData", {...spread})` clones the whole scene
      userData (which also carries `behaviorConfigs` for the entire project)
      per edit and stores both copies in history. Measure; if heavy, scope the
      command to the plan key only (a `SetSceneUserDataKeyCommand` — small,
      typed, and undo-friendly) rather than the whole blob.
- [x] History growth: cap/coalesce plan edits (drag = one entry, B2). Verify
      history serialization (if any) doesn't balloon saved projects.

### E3. Hover/raycast paths (P1)

- [x] Quick Build `handleMouseMove` raycasts + updates preview per mouse move
      event; coalesce to one per animation frame (store last event, process in
      `requestAnimationFrame`; both toolbars share this via the D1 kit or a
      `useViewportPointer` hook). Same for Plan toolbar's move handler.
- [x] `getPointerQuickBuildHit` raycasts against the whole scene — restrict to
      the ground/stamp layers via raycast layers or a candidates list from
      `collectQuickBuildObjects` (already exists; reuse its cache between
      frames within a stroke).
- [x] Scene stats (`analyzeQuickBuildScene`, full traverse) recompute on every
      `objectChanged` via `scheduleRefresh` — confirm the existing debounce
      window (≥250ms) and skip recompute entirely while the toolbar is closed.

### E4. Placement batches and events (P1)

- [x] Large brush strokes execute one `MultiCmdsCommand` of N `AddObjectCommand`s
      — verify whether each Add fires `objectAdded` (scene-tree re-render per
      object). If so, add a batch signal (the repo already has
      `BatchManager` — this branch touches it) so the tree re-renders once per
      stroke.
- [x] Adjacency refresh + live-batch rebuild per stroke: confirm
      `refreshQuickBuildAdjacency`/`rebuildQuickBuildLiveBatch` run at most
      once per stroke (not per object), and that bake batches dispose replaced
      geometry.

### E5. Asset loading (P2)

- [x] Texture packs: manifest fetched with `cache: "no-store"` on every
      toolbar open; cache the parsed index in-memory per session, and drop
      `no-store` (the deploy script can version the URL). Cache loaded
      `THREE.Texture`s by URL and dispose on preset switch (one `dispose()` in
      the file today — audit the ownership).
- [x] Preview ghosts: `disposePreviewObject` exists — audit every early-return
      path in `updatePreview` (`previewKeyRef` changes) actually disposes; add
      a leak test with `renderer.info` counts in the ux smoke.

---

## Workstream F — Functionality completion (P1/P2)

### F1. Interchange honesty (P1)

`planCadInterchange.ts` (385 lines) is a hand-rolled DXF/IFC subset. That is
fine as an MVP but must not present as full IFC/DXF support.

- [x] Label the UI/export actions "IFC (basic)" / "DXF (walls & polygons)";
      docs list exactly which entities survive (walls, slabs, zones; openings?
      parts?) and the unit/axis conventions (`PLAN_CAD_INTERCHANGE_UNITS`).
- [x] Round-trip property tests: export→import→export is a fixpoint for the
      supported subset (extend `planCadInterchange.test.ts` with
      generated scenes, not just fixtures).
- [x] Validate one exported IFC against an external checker once (manual step,
      record result in docs); fix flagrant schema violations only.
- [x] Import guardrails: malformed DXF/IFC must produce a user-visible error
      (toast/panel), never a silent empty import or throw to console.

### F2. Quick Build content depth (P2)

- [x] Variant/tool registry sanity: shortcuts 1–9 vs more tools than digits —
      define overflow behavior (cycling groups is fine; document it).
- [x] Bake/export UX: baking is destructive-ish (freezes stamps) — ensure it's
      one undoable command group and the toolbar shows baked-batch count with
      an "unbake" (delete batch, restore live stamps) if cheap; else document
      one-way with confirm.

### F3. Mesh CAD polish (P1)

- [x] The rewritten `CADActionBarControls` menus (selection actions, axis
      pills, extrude/inset/bevel, edge length) — verify each control against a
      real mesh in the ux smoke (extrude is covered; add inset, bevel, axis
      constraint, edge-length apply).
- [x] Entering Mesh CAD with nothing selected: define the state (auto-prompt
      "select a mesh", or disable entry) — the smoke adds a cube first, which
      hints the empty state is unhandled.
- [x] Exiting Mesh CAD must always restore gizmo/selection state even if the
      edited object was deleted mid-session (defensive `exitCADMode` test).

### F4. Behavior-pack changes riding this branch (P1 — verify & split)

ShopBehavior was substantially rewritten (typed `attributes`, DOM-based shop
menu, prefab preloading); Enemy/SpawnPoint/Volume/VideoBillboard/joints got
smaller updates + new test files; `MobileGameServiceIdentity` is new.

- [x] Run the full behavior test suite; eyeball ShopBehavior's DOM injection
      (`document.body.appendChild(menu)`) for cleanup on behavior dispose and
      for player-mode-only mounting (editor lifecycle hooks run without
      `init()` — CLAUDE.md's known bug class; verify every new editor hook
      reads `this.erth` directly).
- [ ] These changes are unrelated to builder/CAD — split into their own PR
      (see G1) with their own verification (behavior smoke in a real scene).

---

## Workstream G — Support & production readiness

### G1. Branch hygiene and PR strategy (P0, before any of the above merges)

The working tree mixes at least four independent tracks on a branch named for
a different feature (`tinyskies-playground-port`).

Status note (2026-07-07): split manifest prepared in
`docs/planning/2026-07-07-builder-cad-pr-split-manifest.md`, including exact
path buckets, branch names, PR-specific validation commands, and generated
patch bundles under `docs/planning/pr-split-patches/`. The patch bundles pass
`git apply --check` against a temporary clean worktree at `HEAD`. Actual remote
PR creation is still pending because this environment does not have `gh`
installed, and the shared files (`ActionBar.tsx`, `package.json`,
`GameSettings.tsx`) still need hunk-level staging into the target PRs.

- [ ] Split into reviewable PRs, in this order:
      1. Behavior-pack refactors + tests (F4) — independent.
      2. Quick Build (QuickBuild/* + ActionBar quick-build wiring + its smokes
         + texture script).
      3. Mesh CAD ActionBar rework (CADActionBarControls + Editor.ts CAD API
         touches).
      4. BIM Plan (PlanMode/* + RightPanel + CADToolsSection + plan smoke).
      5. Site/playground CSS + misc (Playground.tsx, globals.css, .gitignore,
         package.json scripts).
      Workstreams A–E then land as follow-up PRs against those.
- [ ] Each PR runs: `bun run typecheck`, `bun run lint`, `bun run test`,
      `bun run vite-build`, plus the relevant smokes (below).

### G2. Documentation (P0 for launch)

- [x] `docs/quick-build.md`: concepts (stamps, variants, brushes, adjacency,
      bake, texture packs incl. AGPL deployment step), shortcuts table, URL
      params, test-id contract for the smokes.
- [x] `docs/plan-cad.md`: node model (mirror of `planCadCore` types), the
      userData persistence contract (`PLAN_CAD_SCENE_USER_DATA_KEY`, schema
      version + migration policy — **define one now**: `data.schema` exists;
      write the "unknown newer schema → read-only + warn" rule before v1 data
      escapes), interchange support matrix (F1), known limitations
      (single-level UI, collaboration clobber, no touch).
- [x] Update `CLAUDE.md` doc-index table with both files; update
      `docs/architecture.md` if it enumerates editor subsystems.
- [x] `README`/site docs: one screenshot-driven "Builder Studio" section
      (`/create/project?builder=1` entry).

### G3. Licensing and attribution (P0 — legal, cheap)

- [x] Tiny World Builder textures (AGPL): verify
      `copy-tiny-world-builder-textures.mjs` writes LICENSE/NOTICE next to the
      payload under `client/public/vendor/texture-packs/` and that the UI's
      pack metadata (`QuickBuildTexturePackLicense`) surfaces attribution
      (tooltip or docs link). Confirm the AGPL payload stays out of the default
      build (it does — gitignored + opt-in script; state that explicitly in docs).
- [x] Pascal editor (MIT) inspiration for PlanMode: add the attribution note
      in `planCadCore.ts` header and `docs/plan-cad.md` per the follow-ups
      doc's own rule ("attribute substantial code if copied") — verify whether
      any code was ported closely enough to require it.

### G4. Failure surfaces and logging (P1)

- [x] `logQuickBuild` / `logPlanCad` / `logBuilderMode` are debug-gated —
      good. Sweep for remaining bare `console.*` in the new files (3 found)
      and route through the logger.
- [x] Every `await editor.execute(...)` and fetch in the new surfaces needs a
      user-visible failure path (the GameDebugPanel error badge already
      aggregates logger errors — ensure failures log at ERROR so the badge
      catches them, and add toasts only where the user must react).

### G5. Test matrix consolidation (P1)

Existing: unit tests beside every module, component tests for toolbars/
ActionBar modes, three smokes wired as npm scripts. Add:

- [x] Undo/redo suite (A1) and persistence round-trip (A2) — the two blind spots.
- [x] Error-path tests: texture manifest 404/malformed (unit), DXF/IFC import
      garbage (unit), plan commit failure (editor.execute rejection).
- [x] Viewport-size sweep in the ux smoke: run `assertToolbarButtonLayout` at
      1280×800 and 1024×640 (current smoke asserts desktop only) — catches
      toolbar overflow regressions from D1.
- [x] Add the three builder smokes to whatever CI/pre-merge script runs
      `test:e2e` today (they're npm scripts but confirm they're in the
      verification docs/CI path; also add them to CLAUDE.md's smoke list).

### G6. Release gating (P0)

- [x] Ship config: Quick Build GA (visible by default), Mesh CAD + BIM Plan
      behind the existing per-project `Enable CAD tools` toggle labeled beta
      (C1). No new hosted dependencies (texture packs are self-hosted vendor
      files — compliant with the OSS build rules).
- [x] Define the beta exit-criteria checklist (A1–A3 fixed, E1 landed, G2
      docs published, smokes green 10 consecutive runs) in this file and tick
      before removing the beta label.

---

## Sequencing

| Phase | Contents | Outcome |
|---|---|---|
| 0 (immediately) | G1 PR split; G3 licensing check | Reviewable, legally clean branch |
| 1 (correctness) | A1 undo sync, A2 save/load truth, A3 scene-tree guards, B2 commit debounce, E2 command scope | Data model is trustworthy |
| 2 (architecture) | A4 mode reducer, A5 typing, E1 incremental rebuild, E3/E4 hover+batch | Scales to real scenes |
| 3 (UX/IA) | B1 discoverability, B3, B5, C1–C3, D1 kit, D3 a11y | Feels like one product |
| 4 (fast-follow) | C4 levels UI, C5 tree labels, D2 tokens, E5 caching, F1–F3, B4 pointer/touch | Beta → GA candidate |
| Continuous | G2 docs, G4 logging, G5 tests grow with each phase | Supportable |

## Validation

- [x] `bun run typecheck`
- [x] `bun run lint` (no new disables; never `eslint --fix`)
- [x] `bun run test` (Vitest; includes all QuickBuild/PlanMode/ActionBar suites)
- [x] `bun run vite-build`
- [x] With `bun run dev` on :5173:
  - [x] `node scripts/playwright/oss-builder-mode-smoke.mjs`
  - [x] `node scripts/playwright/oss-builder-tools-ux-smoke.mjs`
  - [x] `node scripts/playwright/oss-plan-cad-smoke.mjs`
  - [x] `node scripts/playwright/oss-smoke.mjs` and
        `oss-filesystem-roundtrip.mjs` (persistence layer is touched by A2)
- [x] `bun run test:e2e:builder-release` (automates the release scenario below:
      BIM Plan edit/history/interchange/persistence, Quick Build
      duplicate-cleanup/bake/persistence, Mesh CAD operation/undo/exit checks)
- [x] Manual scenario pass: build a 2-room plan (8 walls, 2 openings, slab,
      3 parts) → property edits → 20× undo → 20× redo → save → reload → export
      IFC+DXF → re-import DXF; then Quick Build: 200-stamp terrain with brush,
      texture preset, duplicate cleanup, bake → save/reload; then Mesh CAD:
      cube → extrude/inset/bevel each once → undo all → exit.
- [x] Manual code review: local readiness pass on 2026-07-07; `git diff --check`
      clean, targeted scan found no `react-icons` imports in ActionBar/CAD
      files and no unexpected debug leftovers in the Builder/CAD touch set.
