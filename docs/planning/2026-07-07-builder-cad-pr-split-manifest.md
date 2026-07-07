# Builder/CAD PR Split Manifest

Prepared on 2026-07-07 from branch `tinyskies-playground-port`.

This manifest turns the remaining branch-hygiene items from
`2026-07-06-builder-cad-production-hardening.md` into concrete split buckets.
It does not claim the PRs exist yet. `gh` is not installed in this environment,
so remote PR creation still needs a GitHub-capable environment.

Local patch bundles were generated with:

```bash
node scripts/build-builder-cad-pr-split-patches.mjs
```

Outputs:

```text
docs/planning/pr-split-patches/00-summary.json
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

## PR 1: Behavior Pack Refactors

Suggested branch: `builder-hardening/behavior-packs`

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
scripts/playwright/oss-builder-release-scenario.mjs
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
bun run test:e2e:builder-release
```

## PR 3: Mesh CAD Action Bar

Suggested branch: `builder-hardening/mesh-cad-actionbar`

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
- `TransformControlsEvent.js` is large and risky. Review whether its changes
  are strictly required for Mesh CAD selection/transform behavior before
  including it in this PR; otherwise move it to an infrastructure PR.
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

Purpose: Plan/CAD data model, generated geometry bridge, properties, import and
export, docs, settings, and smokes.

Files:

```text
client/packages/editor-oss/src/editor/assets/v2/PlanMode/
client/packages/editor-oss/src/editor/assets/v2/RightPanel/RightPanel.tsx
client/packages/editor-oss/src/editor/assets/v2/RightPanel/common/DangerButton.tsx
client/packages/editor-oss/src/editor/assets/v2/RightPanel/common/PanelChipButton.tsx
client/packages/editor-oss/src/editor/assets/v2/RightPanel/common/PanelTextLine.tsx
client/packages/editor-oss/src/editor/assets/v2/RightPanel/common/PanelCheckbox.tsx
client/packages/editor-oss/src/editor/assets/v2/RightPanel/panels/ProjectSettings/CADToolsSection.tsx
client/packages/editor-oss/src/editor/assets/v2/RightPanel/panels/ProjectSettings/GameSettings.tsx
client/packages/editor-oss/src/editor/assets/v2/RightPanel/panels/ProjectSettings/constants.ts
docs/plan-cad.md
scripts/playwright/oss-plan-cad-smoke.mjs
scripts/playwright/oss-builder-release-scenario.mjs
```

Hunk-level dependencies:

- `ActionBar.tsx` contains BIM/Plan mode entry points but also Quick Build and
  Mesh CAD wiring. Stage only BIM/Plan hunks here.
- `package.json` contains the `test:e2e:plan-cad` script and release smoke
  script. Stage only Plan/CAD hunks here.
- Path-level patch bundle:
  `docs/planning/pr-split-patches/04-bim-plan.patch`.

Extra validation:

```bash
BUILD_MODE=oss bunx --bun vitest run \
  client/packages/editor-oss/src/editor/assets/v2/PlanMode \
  client/packages/editor-oss/src/editor/assets/v2/ActionBar/ActionBar.builderModes.test.tsx
bun run test:e2e:plan-cad
bun run test:e2e:builder-release
```

Path-level patch bundle:
`docs/planning/pr-split-patches/05-docs-site-misc.patch`.

## Shared Hunk-Level Bundle

Suggested handling: split these files by hunk into PRs 2-5 rather than opening
this as a standalone PR.

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
scripts/playwright/oss-builder-release-scenario.mjs
```

## PR 5: Builder Studio Docs, Site, And Misc Wiring

Suggested branch: `builder-hardening/docs-site-misc`

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
docs/planning/2026-07-07-builder-cad-pr-split-manifest.md
package.json
scripts/playwright/oss-filesystem-roundtrip.mjs
scripts/playwright/oss-smoke.mjs
scripts/playwright/site-playground.mjs
skills-lock.json
```

Extra validation:

```bash
bun run test:e2e
bun run test:e2e:site
bun run test:e2e:builder-release
```

## Owner-Decision Bucket

These files are changed in the current worktree but do not clearly belong to
one of the five plan PRs. Assign each before creating final PRs:

Patch bundle:

```text
docs/planning/pr-split-patches/99-owner-decision.patch
```

```text
client/packages/editor-oss/src/copilot/DirectCopilotProvider.test.ts
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
client/packages/editor-oss/src/editor/assets/v2/common/StyledSwitch.tsx
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

1. Move required shared infrastructure into the feature PR that first needs it.
2. Move unrelated fixes to separate small PRs.
3. Drop diagnostic-only files unless a reviewer explicitly asks for them.

## Split Execution Notes

- Use hunk-level staging for `ActionBar.tsx`, `package.json`, and
  `GameSettings.tsx`; path-level staging will mix unrelated feature tracks.
- Create PRs in the order listed above so later branches can rebase on earlier
  shared toolbar/settings work.
- Re-run the base validation and each PR-specific validation after rebasing.
- Actual remote PR creation remains pending because this environment has no
  `gh` executable.
