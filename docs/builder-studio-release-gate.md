# Builder Studio Release Gate

Builder Studio ships with Quick Build visible by default and Model/Plan behind the per-project **Enable CAD & BIM tools (beta)** toggle.

## Launch Configuration

- Build: Quick Build GA surface, ActionBar Build control visible by default.
- Model: Mesh CAD beta surface, available only when `scene.userData.cadTools.enabled` is true.
- Plan: BIM Plan beta surface, available only when `scene.userData.cadTools.enabled` is true.
- Optional Tiny World Builder texture payloads: opt-in only through `ENABLE_TINY_WORLD_TEXTURES=1`.

## Beta Exit Criteria

- BIM Plan undo/redo, save/load, scene-tree delete, and direct managed-object changes keep `scene.userData.planCad` and generated geometry in sync.
- BIM Plan property edits are coalesced so a numeric drag creates one user-level change instead of per-frame history spam.
- Plan rebuild performance is acceptable on a 200-wall scene, including selection retention and no stale generated objects.
- Quick Build, Mesh CAD, and BIM Plan are covered by component/unit tests plus the three Playwright smokes:
  - `bun run test:e2e:filesystem-roundtrip`
  - `bun run test:e2e:builder-mode`
  - `bun run test:e2e:builder-tools` (includes toolbar layout sweeps at 1440x900, 1280x800, and 1024x640)
  - `bun run test:e2e:plan-cad`
- Quick Build and BIM Plan docs are updated with shortcuts, persistence expectations, selectors, licensing, and known limitations.
- A representative BIM Plan IFC export parsed successfully with IfcOpenShell 0.8.5 on 2026-07-07; see `docs/plan-cad.md` for entity counts.

## Required Verification

- `bun run typecheck`
- `bun run lint`
- `bun run test`
- `bun run vite-build`
- `bun run test:e2e` with `bun run dev` already running on :5173
- Manual editor pass: Quick Build stamp/paint/erase, Mesh CAD enter/exit, BIM Plan two-room draft with wall/opening/slab/item, save/reload, undo/redo.
