# Builder and CAD mode follow-ups

> **Status: Superseded.**
> This foundation was carried into the
> [Builder/CAD production-hardening plan](./2026-07-06-builder-cad-production-hardening.md).
> Retain this file as the earlier decision record.

## Commercial acceptance bar

Do not call builder, CAD, or BIM work complete unless all of these are true:

- The feature is reachable from the production editor UI through the intended
  gate or switch.
- The primary user action creates or edits visible scene output in a normal empty
  project.
- Mutations use the editor command/history path, not hidden side effects.
- Created objects are selectable and expose meaningful property controls.
- Silent no-op states either become impossible or surface clear disabled states.
- Focused unit/component tests cover the core behavior, and TypeScript passes.
- A browser/editor smoke test is added when the route/auth fixture exists.

## Immediate builder follow-ups

- [x] Add an original quick-build toolbar for fast object stamping.
- [x] Add click-to-grow refinement for simple stamps.
- [x] Add quick-build scene stats.
- [x] Add duplicate-stamp cleanup.
- [x] Add static internal-mesh freeze for quick-build assets.
- [x] Add terrain/path adjacency refresh so nearby tiles update as users paint.
- [x] Add brush radius/line/rectangle placement modes.
- [x] Add a preview ghost and placement validation before committing commands.
- [x] Add a batch bake/export path for repeated quick-build stamps once the UX is proven.
- [x] Add optional runtime texture packs that are discovered from
      `/vendor/texture-packs/manifest.json` instead of being bundled into source.
- [x] Add a separate deployment target for copying Tiny World Builder textures with
      their own AGPL license/notice files.

## Pascal-inspired CAD/BIM track

Reference: https://github.com/pascalorg/editor, MIT licensed. We can borrow
patterns more directly than AGPL projects, but should still keep the StemStudio
implementation idiomatic and attribute substantial code if copied.

Ideas to adapt for a special StemStudio Plan/CAD mode:

- [x] Add typed architectural node data: site, building, level, wall, slab, ceiling,
      roof, zone, guide, scan, and item.
- [x] Store architectural data as a flat node dictionary with parent references,
      not only as nested Three.js scene objects.
- [x] Add dirty-node geometry systems so wall/slab/roof/item geometry regenerates
      only when edited nodes change.
- [x] Add a scene registry from architectural node ID to Object3D for fast lookup,
      selection, focusing, and system updates without broad scene traversal.
- [x] Add floor-plan core node factories: wall, slab polygon, zone polygon, guide
      image, scan reference, and placed item.
- [x] Add BIM-friendly parameters for walls, slabs, ceilings, roofs, doors, windows,
      and placed parts: thickness, height, elevation, level, material, and tags.
- [x] Add hierarchical selection: site -> building -> level -> zone -> wall/item,
      with per-depth hover/click behavior.
- [x] Add level display modes: stacked, exploded, solo/current floor, and ghosted
      context floors.
- [x] Add placement validation via a spatial grid: can-place-on-floor,
      can-place-on-wall, slab elevation lookup, collision checks, and snap lines.
- [x] Add wall generation with mitered joins and door/window cutouts.
- [x] Add slab/ceiling/roof generation from editable polygons.
- [x] Add CAD camera presets and 2D/3D toggles: plan view, elevation view,
      isometric, walk-through.
- [x] Add import/export bridges after data shape stabilizes: JSON first, then IFC/DXF
      investigation.

Implemented core location:

- `client/packages/editor-oss/src/editor/assets/v2/QuickBuild/*`
- `client/packages/editor-oss/src/editor/assets/v2/PlanMode/planCadCore.ts`
- `client/packages/editor-oss/src/editor/assets/v2/PlanMode/planCadEditorBridge.ts`
- `client/packages/editor-oss/src/editor/assets/v2/PlanMode/PlanCadToolbar.tsx`
- `client/packages/editor-oss/src/editor/assets/v2/PlanMode/PlanCadPropertiesSection.tsx`
- `client/packages/editor-oss/src/editor/assets/v2/PlanMode/planCadInterchange.ts`
- `client/packages/editor-oss/src/editor/assets/v2/PlanMode/planCadCore.test.ts`
- `client/packages/editor-oss/src/editor/assets/v2/PlanMode/planCadInterchange.test.ts`
- `client/packages/editor-oss/src/editor/assets/v2/PlanMode/PlanCadPropertiesSection.test.tsx`
- `client/packages/editor-oss/src/editor/assets/v2/builderToolbars.test.tsx`
- `scripts/copy-tiny-world-builder-textures.mjs`
- `scripts/playwright/oss-builder-mode-smoke.mjs`
- `scripts/playwright/oss-builder-tools-ux-smoke.mjs`
- `scripts/playwright/oss-plan-cad-smoke.mjs`

Optional texture-pack deployment:

- Run `npm run textures:tiny-world` before build/deploy when the deployment is
  intended to include Tiny World Builder textures.
- The generated files are written under `client/public/vendor/texture-packs/` and
  are intentionally ignored by git so the third-party asset payload and license
  stay separate from the product source tree.
- The Quick Build toolbar discovers deployed packs at runtime and shows compatible
  texture presets for the active stamp type.

Texture/rendering TODOs:

- [ ] Investigate the broken/checkerboard texture rendering seen on stamped
      wall/building surfaces. Verify whether the artifact is missing texture
      payload, bad UVs, color-space setup, texture atlas addressing, or fallback
      material behavior.
- [ ] Evaluate `pascalorg/editor` textures as a replacement/default texture
      source only after confirming the exact asset license, attribution
      requirements, and redistribution terms. If compatible, add them through
      the runtime texture-pack path with license/notice files rather than
      copying untracked assets directly into source.
- [ ] Add a plain-color or embedded permissive fallback for Quick Build/BIM
      surfaces so missing optional texture packs do not render as broken
      checkerboards.
- [ ] Add a visual regression for the large patchwork/checkerboard artifact seen
      on wall/BIM surfaces before switching texture sources.

Remaining productization after the core foundation:

- [x] Wire Plan/CAD into a visible StemStudio actionbar entry behind the CAD beta
      project setting.
- [x] Add viewport drawing controls for walls, polygon rooms/zones,
      door/window openings, and floor-placed parts.
- [x] Persist Plan/CAD node state through editor commands via scene `userData`
      plus generated scene objects.
- [x] Build right-panel BIM property editors for selected walls, slabs, and parts.
- [x] Add editor-bridge and toolbar-affordance tests so the controls and node
      mutations are covered.
- [x] Add Playwright editor smoke coverage for real canvas clicks on the local
      OSS editor route, including CAD switch, actionbar, wall creation, BIM panel,
      and Plan/CAD stats assertions.
- [x] Add a Builder Studio entry mode (`/create/project?builder=1`) that opens
      Quick Build by default, enables Plan/CAD, and also works with playground
      mode through `/create/project?mode=playground&builder=1`.
- [x] Expand room/zone drawing from rectangle tools to arbitrary polygon editing.
- [x] Add supported IFC/DXF interchange after unit, layer, material, and semantic
      mappings are defined: lossless Stem Plan/CAD payload round-trip, semantic
      IFC entity export, and basic DXF wall/polygon geometry import fallback.
- [x] Add reusable BIM part catalogs beyond the current desk/sofa/cabinet starter
      presets, grouped into furniture, casework, fixtures, and MEP.
- [x] Render BIM parts as deterministic procedural model groups with source
      metadata, not as anonymous placeholder boxes, while preserving a future
      external model source hook.
- [x] Add snap-assisted Plan/CAD drafting feedback: wall length/angle, polygon
      area/perimeter, opening wall targets, no-wall opening guardrails, and part
      footprint previews.

## Guardrails

- Keep game-world quick build and Plan/CAD mode separate at the UI level. Quick
  Build should stay fast and playful; Plan/CAD should be precise and parameterized.
- Use the existing command/history/collaboration path for all mutations.
- Keep geometry generation deterministic from node data so saved projects remain
  portable and reviewable.
- Do not block the current quick-build rollout on CAD/BIM scope.
