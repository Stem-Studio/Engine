# Builder/CAD PR Split Manifest

Prepared on 2026-07-07 from branch `tinyskies-playground-port`.

This manifest turns the remaining branch-hygiene items from
`2026-07-06-builder-cad-production-hardening.md` into concrete split buckets.
It does not claim the PRs exist yet. The review branches are published to
`origin`, but `gh`/`hub` and GitHub API credentials are not installed in this
environment, so opening the PR records still needs a GitHub-capable environment.
The exact commands and compare URLs are recorded in
`2026-07-07-builder-cad-pr-create-handoff.md`.

Local patch bundles were generated with:

```bash
node scripts/build-builder-cad-pr-split-patches.mjs
```

Outputs:

```text
docs/planning/pr-split-patches/00-summary.json
docs/planning/pr-split-patches/00-direct-copilot-test-fix.patch
docs/planning/pr-split-patches/01-behavior-packs.patch
docs/planning/pr-split-patches/02-quick-build.patch
docs/planning/pr-split-patches/03-mesh-cad.patch
docs/planning/pr-split-patches/04-bim-plan.patch
docs/planning/pr-split-patches/05-docs-site-misc.patch
docs/planning/pr-split-patches/90-shared-hunk-required.patch
docs/planning/pr-split-patches/99-owner-decision.patch
```

Sanity check performed: all generated patch bundles pass `git apply --check`
against a temporary clean worktree at `HEAD`.

## Required Base Validation For Every PR

Run these on each split branch before opening or updating the PR:

```bash
bun run typecheck
bun run lint
bun run test
bun run vite-build
```

Add the PR-specific smoke/tests below where listed.

## PR 0: DirectCopilot Test Baseline Fix

Suggested branch: `builder-hardening/direct-copilot-test-fix`

Branch status: created and published at `96c47c6` with commit message
`Fix DirectCopilot test app stub`.

Compare URL:
`https://github.com/Stem-Studio/Engine/compare/main...builder-hardening/direct-copilot-test-fix`

Purpose: isolate the pre-existing DirectCopilot test stub failure so the
behavior-pack PR can run the full base validation without carrying an unrelated
red test.

Files:

```text
client/packages/editor-oss/src/copilot/DirectCopilotProvider.test.ts
```

Validation:

- `NODE_OPTIONS=--max-old-space-size=8192 bun run typecheck` passed.
- `bun run lint` passed with 0 errors and 2827 existing warnings.
- `bun run test` passed: 231 test files passed, 2572 tests passed, 162 skipped.
- `BUILD_MODE=oss bunx --bun vite build` passed.

Path-level patch bundle:
`docs/planning/pr-split-patches/00-direct-copilot-test-fix.patch`.

## PR 1: Behavior Pack Refactors

Suggested branch: `builder-hardening/behavior-packs`

Local branch status: created at `a11f63b` with commit message
`Split behavior pack refactors`. Scoped validation passed on that branch:
38 behavior-related test files passed, 305 tests passed, 1 skipped.
Broader local validation on that branch:

- `NODE_OPTIONS=--max-old-space-size=8192 bun run typecheck` passed.
- `bun run lint` passed with 0 errors and 2864 existing warnings.
- `BUILD_MODE=oss bunx --bun vite build` passed.
- `bun run test` failed on the unrelated existing
  `DirectCopilotProvider.test.ts` assertion.

Stacked validation branch: `builder-hardening/behavior-packs-with-baseline` at
`3c5055d`, based on `builder-hardening/direct-copilot-test-fix`. Full local
base validation passed on that branch:

- `NODE_OPTIONS=--max-old-space-size=8192 bun run typecheck` passed.
- `bun run lint` passed with 0 errors and 2864 existing warnings.
- `bun run test` passed: 245 test files passed, 2603 tests passed, 162 skipped.
- `BUILD_MODE=oss bunx --bun vite build` passed.

Remote branch is published; PR creation is still pending.

Compare URL:
`https://github.com/Stem-Studio/Engine/compare/builder-hardening/direct-copilot-test-fix...builder-hardening/behavior-packs-with-baseline`

Purpose: split behavior-pack refactors and tests away from Builder/CAD so they
can be reviewed and reverted independently.

Files:

```text
client/packages/editor-oss/src/behaviors/BehaviorData.ts
client/packages/editor-oss/src/behaviors/collisions/CollisionDetector.ts
client/packages/editor-oss/src/behaviors/collisions/CollisionDetector.test.ts
client/packages/editor-oss/src/behaviors/packs/consumable/ConsumableBehavior.ts
client/packages/editor-oss/src/behaviors/packs/consumable/ConsumableBehavior.test.ts
client/packages/editor-oss/src/behaviors/packs/enemy/EnemyBehavior.ts
client/packages/editor-oss/src/behaviors/packs/enemy/EnemyBehavior.test.ts
client/packages/editor-oss/src/behaviors/packs/enemy/behavior.json
client/packages/editor-oss/src/behaviors/packs/jointFixed/FixedJointBehavior.ts
client/packages/editor-oss/src/behaviors/packs/jointFixed/FixedJointBehavior.test.ts
client/packages/editor-oss/src/behaviors/packs/jointHinge/HingeJointBehavior.ts
client/packages/editor-oss/src/behaviors/packs/jointHinge/HingeJointBehavior.test.ts
client/packages/editor-oss/src/behaviors/packs/jointPoint2Point/Point2PointJointBehavior.ts
client/packages/editor-oss/src/behaviors/packs/jointPoint2Point/Point2PointJointBehavior.test.ts
client/packages/editor-oss/src/behaviors/packs/jumppad/JumppadBehavior.ts
client/packages/editor-oss/src/behaviors/packs/jumppad/JumppadBehavior.test.ts
client/packages/editor-oss/src/behaviors/packs/shop/ShopBehavior.ts
client/packages/editor-oss/src/behaviors/packs/shop/ShopBehavior.test.ts
client/packages/editor-oss/src/behaviors/packs/spawnpoint/SpawnPointBehavior.ts
client/packages/editor-oss/src/behaviors/packs/spawnpoint/SpawnPointBehavior.test.ts
client/packages/editor-oss/src/behaviors/packs/spawnpoint/behavior.json
client/packages/editor-oss/src/behaviors/packs/teleport/TeleportBehavior.ts
client/packages/editor-oss/src/behaviors/packs/teleport/TeleportBehavior.test.ts
client/packages/editor-oss/src/behaviors/packs/tween/TweenAnimationBehavior.ts
client/packages/editor-oss/src/behaviors/packs/tween/TweenAnimationBehavior.test.ts
client/packages/editor-oss/src/behaviors/packs/video_billboard/VideoBillboardBehavior.ts
client/packages/editor-oss/src/behaviors/packs/video_billboard/VideoSource.ts
client/packages/editor-oss/src/behaviors/packs/video_billboard/behavior.json
client/packages/editor-oss/src/behaviors/packs/volume/VolumeBehavior.ts
client/packages/editor-oss/src/behaviors/packs/volume/VolumeBehavior.test.ts
client/packages/editor-oss/src/behaviors/packs/volume/behavior.json
client/packages/editor-oss/src/editor/behaviors/BehaviorDataFactory.ts
client/packages/editor-oss/src/editor/behaviors/BehaviorDataFactory.test.ts
client/packages/editor-oss/src/editor/behaviors/BehaviorDataManager.ts
client/packages/editor-oss/src/editor/behaviors/hooks/behaviors.ts
client/packages/editor-oss/src/editor/scripts/hooks/useApplySceneScriptRevision.ts
client/packages/editor-oss/src/editor/assets/v2/AssetsLibrary/BehaviorCreator/AttributesSection/SingleAttribute.tsx
client/packages/editor-oss/src/editor/assets/v2/AssetsLibrary/RevisionSection/RevisionList.tsx
client/packages/editor-oss/src/editor/assets/v2/BehaviorEditor/KeybindingsPanel.tsx
client/packages/editor-oss/src/editor/assets/v2/RightPanel/behaviors/helpers/AiAssistantTest.tsx
client/packages/editor-oss/src/serialization/schema/BehaviorDataSchema.ts
client/packages/editor-oss/src/userManagement/playerProfile/game-service-controllers/MobileGameServiceIdentity.ts
client/packages/editor-oss/src/userManagement/playerProfile/game-service-controllers/MobileGameServiceIdentity.test.ts
client/packages/editor-oss/src/userManagement/playerProfile/game-service-controllers/MobileGameServicesController.ts
```

Extra validation:

```bash
BUILD_MODE=oss bunx --bun vitest run \
  client/packages/editor-oss/src/behaviors \
  client/packages/editor-oss/src/editor/behaviors \
  client/packages/editor-oss/src/userManagement/playerProfile/game-service-controllers/MobileGameServiceIdentity.test.ts
```

Path-level patch bundle:
`docs/planning/pr-split-patches/01-behavior-packs.patch`.

## PR 2: Quick Build Tools

Suggested branch: `builder-hardening/quick-build`

Local path-bucket branch status: created as
`builder-hardening/quick-build-paths` at `bb47f48` with commit message
`Split Quick Build path bucket`. This branch contains the path-level bundle
only; the shared `ActionBar.tsx` and `package.json` hunks still need
hunk-level assignment before this becomes the final review PR.

Stacked review branch status: created as
`builder-hardening/quick-build-stacked` at `cb4910b`, based on
`builder-hardening/behavior-packs-with-baseline`. This branch assigns the
Quick Build shared hunks by adding a Quick-only ActionBar stage, shared
ActionBar styles/icons, and Quick-stage package scripts.

Remote branch is published. Compare URL:
`https://github.com/Stem-Studio/Engine/compare/builder-hardening/behavior-packs-with-baseline...builder-hardening/quick-build-stacked`

Full local base validation passed on that branch:

- `NODE_OPTIONS=--max-old-space-size=8192 bun run typecheck` passed.
- `bun run lint` passed with 0 errors and 2893 existing warnings.
- `bun run test` passed: 251 test files passed, 2676 tests passed, 162 skipped
  across the split package-script phases.
- `BUILD_MODE=oss bunx --bun vite build` passed.

Purpose: Quick Build object registry, placement, batching, texture packs, docs,
and the Quick Build smoke.

Files:

```text
client/packages/editor-oss/src/editor/assets/v2/QuickBuild/
client/packages/editor-oss/src/editor/assets/v2/common/builderToolbar/index.ts
client/packages/editor-oss/src/editor/assets/v2/common/docsUrl.ts
client/packages/editor-oss/src/editor/assets/v2/builderToolbars.test.tsx
client/packages/editor-oss/src/editor/assets/v2/materials/materialUtils.ts
client/packages/editor-oss/src/editor/assets/v2/materials/materialUtils.test.ts
client/packages/editor-oss/src/command/MultiCmdsCommand.d.ts
client/packages/editor-oss/src/utils/BatchManager.ts
docs/quick-build.md
scripts/copy-tiny-world-builder-textures.mjs
scripts/playwright/oss-builder-mode-smoke.mjs
scripts/playwright/oss-builder-tools-ux-smoke.mjs
```

Hunk-level dependencies:

- `ActionBar.tsx` contains Quick Build mode wiring but also Mesh CAD and BIM
  wiring. Stage only Quick Build hunks for this PR.
- `package.json` contains Quick Build smoke scripts and broader validation
  script changes. Stage only Quick Build script hunks here.
- Path-level patch bundle:
  `docs/planning/pr-split-patches/02-quick-build.patch`.

Extra validation:

```bash
BUILD_MODE=oss bunx --bun vitest run \
  client/packages/editor-oss/src/editor/assets/v2/QuickBuild \
  client/packages/editor-oss/src/editor/assets/v2/builderToolbars.test.tsx
bun run test:e2e:builder-mode
bun run test:e2e:builder-tools
```

## PR 3: Mesh CAD Action Bar

Suggested branch: `builder-hardening/mesh-cad-actionbar`

Local path-bucket branch status: created as
`builder-hardening/mesh-cad-paths` at `50410ed` with commit message
`Split Mesh CAD path bucket`. This branch contains the path-level bundle only;
the shared `ActionBar.tsx` hunks and the `TransformControlsEvent.js`
owner decision still need review before this becomes the final review PR.

Stacked review branch status: created as
`builder-hardening/mesh-cad-stacked` at `f621ed5`, based on
`builder-hardening/quick-build-stacked`. This branch assigns the Mesh CAD
shared ActionBar hunks with a two-mode Quick/Mesh ActionBar and Mesh-only
ActionBar tests.

Remote branch is published. Compare URL:
`https://github.com/Stem-Studio/Engine/compare/builder-hardening/quick-build-stacked...builder-hardening/mesh-cad-stacked`

Full local base validation passed on that branch:

- Targeted Mesh validation passed: 5 test files, 32 tests.
- `NODE_OPTIONS=--max-old-space-size=8192 bun run typecheck` passed.
- `bun run lint` passed with 0 errors and 2893 existing warnings.
- `bun run test` passed across the split package-script phases: 254 test
  files passed, 2700 tests passed, 162 skipped.
- `BUILD_MODE=oss bunx --bun vite build` passed.

Purpose: Mesh CAD action bar controls, icons, CAD mode/editor guards, and tests.

Files:

```text
client/packages/editor-oss/src/editor/Editor.ts
client/packages/editor-oss/src/editor/Editor.cadMode.test.ts
client/packages/editor-oss/src/editor/cad/removeGuards.ts
client/packages/editor-oss/src/editor/assets/v2/ActionBar/CADActionBarControls.tsx
client/packages/editor-oss/src/editor/assets/v2/ActionBar/CADActionBarControls.test.tsx
client/packages/editor-oss/src/editor/assets/v2/ActionBar/icons/CADIcons.tsx
client/packages/editor-oss/src/command/AddObjectCommand.d.ts
client/packages/editor-oss/src/command/AddObjectCommand.js
client/packages/editor-oss/src/command/RemoveObjectCommand.d.ts
client/packages/editor-oss/src/command/objects/Add3dObjectCommand.ts
client/packages/editor-oss/src/event/DispatchCompat.test.ts
client/packages/editor-oss/src/event/EventList.js
client/packages/editor-oss/src/event/picking/pickTargetUtils.test.ts
```

Hunk-level dependencies:

- `ActionBar.tsx` imports/renders Mesh CAD entry points but also contains Quick
  Build and BIM changes. Stage only Mesh CAD hunks here.
- `TransformControlsEvent.js` is large and risky. It is not included in the
  Mesh CAD stacked branch; keep it in the out-of-scope infrastructure bucket
  unless a reviewer explicitly asks for it.
- Path-level patch bundle:
  `docs/planning/pr-split-patches/03-mesh-cad.patch`.

Extra validation:

```bash
BUILD_MODE=oss bunx --bun vitest run \
  client/packages/editor-oss/src/editor/Editor.cadMode.test.ts \
  client/packages/editor-oss/src/editor/assets/v2/ActionBar/CADActionBarControls.test.tsx \
  client/packages/editor-oss/src/event/DispatchCompat.test.ts \
  client/packages/editor-oss/src/event/picking/pickTargetUtils.test.ts
bun run test:e2e:builder-release
```

## PR 4: BIM Plan

Suggested branch: `builder-hardening/bim-plan`

Local path-bucket branch status: created as
`builder-hardening/bim-plan-paths` at `3d04666` with commit message
`Split BIM Plan path bucket`. This branch contains the path-level bundle only;
the shared `ActionBar.tsx`, `package.json`, and `GameSettings.tsx` hunks still
need hunk-level assignment before this becomes the final review PR.

Stacked review branch status: created as
`builder-hardening/bim-plan-stacked` at `1a108c8`, based on
`builder-hardening/mesh-cad-stacked`. This branch assigns the BIM/Plan
ActionBar hunks, `test:e2e:plan-cad`, and the `StyledSwitch` accessibility/test
hook needed by the Plan settings controls.

Remote branch is published. Compare URL:
`https://github.com/Stem-Studio/Engine/compare/builder-hardening/mesh-cad-stacked...builder-hardening/bim-plan-stacked`

Full local validation passed on that branch:

- Targeted BIM validation passed: 8 test files, 71 tests.
- `NODE_OPTIONS=--max-old-space-size=8192 bun run typecheck` passed.
- `bun run lint` passed with 0 errors and 2931 existing warnings.
- `bun run test` passed across the split package-script phases: 261 test
  files passed, 2761 tests passed, 162 skipped.
- `BUILD_MODE=oss bunx --bun vite build` passed.
- `bun run test:e2e:plan-cad` passed.

Purpose: Plan/CAD data model, generated geometry bridge, properties, import and
export, docs, settings, and smokes.

Files:

```text
client/packages/editor-oss/src/editor/assets/v2/PlanMode/
client/packages/editor-oss/src/editor/assets/v2/RightPanel/RightPanel.tsx
client/packages/editor-oss/src/editor/assets/v2/RightPanel/common/DangerButton.tsx
client/packages/editor-oss/src/editor/assets/v2/RightPanel/common/PanelChipButton.tsx
client/packages/editor-oss/src/editor/assets/v2/RightPanel/common/PanelTextLine.tsx
client/packages/editor-oss/src/editor/assets/v2/common/StyledSwitch.tsx
client/packages/editor-oss/src/editor/assets/v2/RightPanel/common/PanelCheckbox.tsx
client/packages/editor-oss/src/editor/assets/v2/RightPanel/panels/ProjectSettings/CADToolsSection.tsx
client/packages/editor-oss/src/editor/assets/v2/RightPanel/panels/ProjectSettings/GameSettings.tsx
client/packages/editor-oss/src/editor/assets/v2/RightPanel/panels/ProjectSettings/constants.ts
docs/plan-cad.md
scripts/playwright/oss-plan-cad-smoke.mjs
```

Hunk-level dependencies:

- `ActionBar.tsx` contains BIM/Plan mode entry points but also Quick Build and
  Mesh CAD wiring. Stage only BIM/Plan hunks here.
- `package.json` contains the `test:e2e:plan-cad` script plus later aggregate
  e2e wiring. Stage only the Plan/CAD script hunk here; aggregate wiring lands
  in PR 5.
- Path-level patch bundle:
  `docs/planning/pr-split-patches/04-bim-plan.patch`.

Extra validation:

```bash
BUILD_MODE=oss bunx --bun vitest run \
  client/packages/editor-oss/src/editor/assets/v2/PlanMode \
  client/packages/editor-oss/src/editor/assets/v2/ActionBar/ActionBar.builderModes.test.tsx
bun run test:e2e:plan-cad
```

Path-level patch bundle:
`docs/planning/pr-split-patches/05-docs-site-misc.patch`.

## Shared Hunk-Level Bundle

Suggested handling: split these files by hunk into PRs 2-5 rather than opening
this as a standalone PR.

Local bucket branch status: created as `builder-hardening/shared-hunks` at
`e85cc47` with commit message `Split shared hunk bucket`. This is evidence and
a staging aid, not a recommended standalone PR.

Patch bundle:

```text
docs/planning/pr-split-patches/90-shared-hunk-required.patch
```

Files:

```text
package.json
client/packages/editor-oss/src/editor/assets/v2/ActionBar/ActionBar.tsx
client/packages/editor-oss/src/editor/assets/v2/ActionBar/ActionBar.style.ts
client/packages/editor-oss/src/editor/assets/v2/ActionBar/ActionBar.builderModes.test.tsx
client/packages/editor-oss/src/editor/assets/v2/ActionBar/icons/ActionBarIcons.tsx
client/packages/editor-oss/src/editor/assets/v2/RightPanel/panels/ProjectSettings/GameSettings.tsx
```

## PR 5: Builder Studio Docs, Site, And Misc Wiring

Suggested branch: `builder-hardening/docs-site-misc`

Local path-bucket branch status: created as
`builder-hardening/docs-site-misc-paths` at `20f6c71` with commit message
`Split docs site misc path bucket`. This branch contains the path-level bundle
only; package-script aggregation and shared release-smoke hunks still need
hunk-level assignment after the feature PRs are finalized.

Stacked review branch status: created as
`builder-hardening/docs-site-misc-stacked`, based on
`builder-hardening/bim-plan-stacked`. Docs-only/smoke-script amendments may
move this branch head; it remains the docs/site aggregation branch and does not
change the validated runtime feature code.

Remote branch is published. Compare URL:
`https://github.com/Stem-Studio/Engine/compare/builder-hardening/bim-plan-stacked...builder-hardening/docs-site-misc-stacked`

Full local validation passed on that branch:

- `NODE_OPTIONS=--max-old-space-size=8192 bun run typecheck` passed.
- `bun run lint` passed with 0 errors and 2931 existing warnings.
- `bun run test` passed across the split package-script phases: 261 test
  files passed, 2761 tests passed, 162 skipped.
- `BUILD_MODE=oss bunx --bun vite build` passed.
- `bun run test:e2e` passed.
- `bun run test:e2e:site` passed after fixing stale landing/nav smoke
  assertions.
- `bun run test:e2e:builder-release` passed.

Purpose: launch-facing documentation, site styling, dashboard/playground polish,
and package-script aggregation after the feature PRs land.

Files:

```text
.gitignore
CLAUDE.md
README.md
client/packages/site/src/routes/Playground.tsx
client/packages/site/src/styles/globals.css
docs/architecture.md
docs/assets/builder-studio/
docs/builder-studio-release-gate.md
docs/planning/2026-06-28-builder-and-cad-mode-followups.md
docs/planning/2026-07-06-builder-cad-production-hardening.md
docs/planning/2026-07-07-builder-cad-pr-create-handoff.md
docs/planning/2026-07-07-builder-cad-pr-split-manifest.md
package.json
scripts/playwright/oss-filesystem-roundtrip.mjs
scripts/playwright/oss-builder-release-scenario.mjs
scripts/playwright/oss-smoke.mjs
scripts/playwright/site-landing.mjs
scripts/playwright/site-nav.mjs
scripts/playwright/site-playground.mjs
skills-lock.json
```

Hunk-level dependencies:

- `package.json` contains package-script aggregation and is staged here after
  the feature PR scripts have landed.

Extra validation:

```bash
bun run test:e2e
bun run test:e2e:site
bun run test:e2e:builder-release
```

## Owner-Decision Bucket

These files are changed in the current worktree but do not clearly belong to
one of the five plan PRs. Resolution as of the stacked split: keep these out of
the Builder/CAD PR stack and route them to separate infrastructure/editor PRs,
or drop diagnostic-only files. The only owner-bucket item required by the
feature stack, `StyledSwitch.tsx`, moved to PR 4.

Local bucket branch status: superseded by
`builder-hardening/owner-decision-minus-baseline` at `87fdced` with commit
message `Split owner decision bucket without baseline fix`. This is evidence
for triage only; it is not a recommended Builder/CAD review PR.

Patch bundle:

```text
docs/planning/pr-split-patches/99-owner-decision.patch
```

```text
client/packages/editor-oss/src/editor/asset-management/hooks/useReplaceAsset.ts
client/packages/editor-oss/src/editor/asset-management/hooks/useReplaceAsset.test.ts
client/packages/editor-oss/src/editor/assets/v2/CreateDashboard/DashboardLayout/SideNavigation/SideNavigation.tsx
client/packages/editor-oss/src/editor/assets/v2/LeftPanel/MainTabs/AssetsTab/SubTabs/AiModelsTab.tsx
client/packages/editor-oss/src/editor/assets/v2/LeftPanel/MainTabs/AssetsTab/SubTabs/AiNpcsTab.tsx
client/packages/editor-oss/src/editor/assets/v2/LeftPanel/MainTabs/AssetsTab/SubTabs/MiscTab.tsx
client/packages/editor-oss/src/editor/assets/v2/LeftPanel/MainTabs/ProjectTab/ProjectTab.tsx
client/packages/editor-oss/src/editor/assets/v2/OSSBootstrapModal/OSSBootstrapModal.tsx
client/packages/editor-oss/src/editor/assets/v2/RightPanel/sections/LightingSection.tsx
client/packages/editor-oss/src/editor/assets/v2/RightPanel/sections/PhysicsSection.tsx
client/packages/editor-oss/src/editor/assets/v2/RightPanel/sections/v2/PhysicsSection.tsx
client/packages/editor-oss/src/editor/assets/v2/common/InfoCard/StemVersionPicker/StemVersionPicker.tsx
client/packages/editor-oss/src/editor/lambdas/hooks/lambdas.ts
client/packages/editor-oss/src/event/TransformControlsEvent.js
client/packages/editor-oss/src/global.ts
client/packages/editor-oss/src/physics/PhysicsUtil.ts
client/packages/editor-oss/src/physics/PhysicsUtil.test.ts
client/packages/editor-oss/src/scheduler/CommandBuffer.ts
client/packages/editor-oss/src/scheduler/__tests__/CommandBuffer.test.ts
client/packages/editor-oss/src/serialization/core/PrefabSerializer.ts
client/packages/editor-oss/src/serialization/core/PrefabSerializer.test.ts
scripts/playwright/_tinyskies-diag.mjs
```

Recommended handling:

1. Move unrelated fixes to separate small PRs.
2. Keep `TransformControlsEvent.js` out of Mesh CAD unless review proves it is
   required for selection/transform correctness.
3. Drop diagnostic-only files such as `_tinyskies-diag.mjs` unless a reviewer
   explicitly asks for them.

## Split Execution Notes

- Use hunk-level staging for `ActionBar.tsx`, `package.json`, and
  `GameSettings.tsx`; path-level staging will mix unrelated feature tracks.
- Create PRs in the order listed above so later branches can rebase on earlier
  shared toolbar/settings work.
- Re-run the base validation and each PR-specific validation after rebasing.
- Remote branches are published to `origin`.
- Actual PR record creation remains pending because this environment has no
  `gh`, no `hub`, and no GitHub API token.
