#!/usr/bin/env node
/**
 * Generate local patch bundles for the Builder/CAD hardening PR split.
 *
 * This is intentionally non-destructive: it reads the current worktree and
 * writes patch files under docs/planning/pr-split-patches without staging,
 * committing, stashing, or changing branches.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const outDir = join(repoRoot, "docs/planning/pr-split-patches");
mkdirSync(outDir, { recursive: true });

const buckets = [
  {
    id: "00-direct-copilot-test-fix",
    title: "DirectCopilot Test Baseline Fix",
    paths: [
      "client/packages/editor-oss/src/copilot/DirectCopilotProvider.test.ts",
    ],
  },
  {
    id: "01-behavior-packs",
    title: "Behavior Pack Refactors",
    paths: [
      "client/packages/editor-oss/src/behaviors/BehaviorData.ts",
      "client/packages/editor-oss/src/behaviors/collisions/CollisionDetector.ts",
      "client/packages/editor-oss/src/behaviors/collisions/CollisionDetector.test.ts",
      "client/packages/editor-oss/src/behaviors/packs/consumable/ConsumableBehavior.ts",
      "client/packages/editor-oss/src/behaviors/packs/consumable/ConsumableBehavior.test.ts",
      "client/packages/editor-oss/src/behaviors/packs/enemy/EnemyBehavior.ts",
      "client/packages/editor-oss/src/behaviors/packs/enemy/EnemyBehavior.test.ts",
      "client/packages/editor-oss/src/behaviors/packs/enemy/behavior.json",
      "client/packages/editor-oss/src/behaviors/packs/jointFixed/FixedJointBehavior.ts",
      "client/packages/editor-oss/src/behaviors/packs/jointFixed/FixedJointBehavior.test.ts",
      "client/packages/editor-oss/src/behaviors/packs/jointHinge/HingeJointBehavior.ts",
      "client/packages/editor-oss/src/behaviors/packs/jointHinge/HingeJointBehavior.test.ts",
      "client/packages/editor-oss/src/behaviors/packs/jointPoint2Point/Point2PointJointBehavior.ts",
      "client/packages/editor-oss/src/behaviors/packs/jointPoint2Point/Point2PointJointBehavior.test.ts",
      "client/packages/editor-oss/src/behaviors/packs/jumppad/JumppadBehavior.ts",
      "client/packages/editor-oss/src/behaviors/packs/jumppad/JumppadBehavior.test.ts",
      "client/packages/editor-oss/src/behaviors/packs/shop/ShopBehavior.ts",
      "client/packages/editor-oss/src/behaviors/packs/shop/ShopBehavior.test.ts",
      "client/packages/editor-oss/src/behaviors/packs/spawnpoint/SpawnPointBehavior.ts",
      "client/packages/editor-oss/src/behaviors/packs/spawnpoint/SpawnPointBehavior.test.ts",
      "client/packages/editor-oss/src/behaviors/packs/spawnpoint/behavior.json",
      "client/packages/editor-oss/src/behaviors/packs/teleport/TeleportBehavior.ts",
      "client/packages/editor-oss/src/behaviors/packs/teleport/TeleportBehavior.test.ts",
      "client/packages/editor-oss/src/behaviors/packs/tween/TweenAnimationBehavior.ts",
      "client/packages/editor-oss/src/behaviors/packs/tween/TweenAnimationBehavior.test.ts",
      "client/packages/editor-oss/src/behaviors/packs/video_billboard/VideoBillboardBehavior.ts",
      "client/packages/editor-oss/src/behaviors/packs/video_billboard/VideoSource.ts",
      "client/packages/editor-oss/src/behaviors/packs/video_billboard/behavior.json",
      "client/packages/editor-oss/src/behaviors/packs/volume/VolumeBehavior.ts",
      "client/packages/editor-oss/src/behaviors/packs/volume/VolumeBehavior.test.ts",
      "client/packages/editor-oss/src/behaviors/packs/volume/behavior.json",
      "client/packages/editor-oss/src/editor/behaviors/BehaviorDataFactory.ts",
      "client/packages/editor-oss/src/editor/behaviors/BehaviorDataFactory.test.ts",
      "client/packages/editor-oss/src/editor/behaviors/BehaviorDataManager.ts",
      "client/packages/editor-oss/src/editor/behaviors/hooks/behaviors.ts",
      "client/packages/editor-oss/src/editor/scripts/hooks/useApplySceneScriptRevision.ts",
      "client/packages/editor-oss/src/editor/assets/v2/AssetsLibrary/BehaviorCreator/AttributesSection/SingleAttribute.tsx",
      "client/packages/editor-oss/src/editor/assets/v2/AssetsLibrary/RevisionSection/RevisionList.tsx",
      "client/packages/editor-oss/src/editor/assets/v2/BehaviorEditor/KeybindingsPanel.tsx",
      "client/packages/editor-oss/src/editor/assets/v2/RightPanel/behaviors/helpers/AiAssistantTest.tsx",
      "client/packages/editor-oss/src/serialization/schema/BehaviorDataSchema.ts",
      "client/packages/editor-oss/src/userManagement/playerProfile/game-service-controllers/MobileGameServiceIdentity.ts",
      "client/packages/editor-oss/src/userManagement/playerProfile/game-service-controllers/MobileGameServiceIdentity.test.ts",
      "client/packages/editor-oss/src/userManagement/playerProfile/game-service-controllers/MobileGameServicesController.ts",
    ],
  },
  {
    id: "02-quick-build",
    title: "Quick Build Tools",
    paths: [
      "client/packages/editor-oss/src/editor/assets/v2/QuickBuild",
      "client/packages/editor-oss/src/editor/assets/v2/common/builderToolbar/index.ts",
      "client/packages/editor-oss/src/editor/assets/v2/common/docsUrl.ts",
      "client/packages/editor-oss/src/editor/assets/v2/builderToolbars.test.tsx",
      "client/packages/editor-oss/src/editor/assets/v2/materials/materialUtils.ts",
      "client/packages/editor-oss/src/editor/assets/v2/materials/materialUtils.test.ts",
      "client/packages/editor-oss/src/command/MultiCmdsCommand.d.ts",
      "client/packages/editor-oss/src/utils/BatchManager.ts",
      "docs/quick-build.md",
      "scripts/copy-tiny-world-builder-textures.mjs",
      "scripts/playwright/oss-builder-mode-smoke.mjs",
      "scripts/playwright/oss-builder-tools-ux-smoke.mjs",
    ],
  },
  {
    id: "03-mesh-cad",
    title: "Mesh CAD Action Bar",
    paths: [
      "client/packages/editor-oss/src/editor/Editor.ts",
      "client/packages/editor-oss/src/editor/Editor.cadMode.test.ts",
      "client/packages/editor-oss/src/editor/cad/removeGuards.ts",
      "client/packages/editor-oss/src/editor/assets/v2/ActionBar/CADActionBarControls.tsx",
      "client/packages/editor-oss/src/editor/assets/v2/ActionBar/CADActionBarControls.test.tsx",
      "client/packages/editor-oss/src/editor/assets/v2/ActionBar/icons/CADIcons.tsx",
      "client/packages/editor-oss/src/command/AddObjectCommand.d.ts",
      "client/packages/editor-oss/src/command/AddObjectCommand.js",
      "client/packages/editor-oss/src/command/RemoveObjectCommand.d.ts",
      "client/packages/editor-oss/src/command/objects/Add3dObjectCommand.ts",
      "client/packages/editor-oss/src/event/DispatchCompat.test.ts",
      "client/packages/editor-oss/src/event/EventList.js",
      "client/packages/editor-oss/src/event/picking/pickTargetUtils.test.ts",
    ],
  },
  {
    id: "04-bim-plan",
    title: "BIM Plan",
    paths: [
      "client/packages/editor-oss/src/editor/assets/v2/PlanMode",
      "client/packages/editor-oss/src/editor/assets/v2/RightPanel/RightPanel.tsx",
      "client/packages/editor-oss/src/editor/assets/v2/RightPanel/common/DangerButton.tsx",
      "client/packages/editor-oss/src/editor/assets/v2/RightPanel/common/PanelChipButton.tsx",
      "client/packages/editor-oss/src/editor/assets/v2/RightPanel/common/PanelTextLine.tsx",
      "client/packages/editor-oss/src/editor/assets/v2/RightPanel/common/PanelCheckbox.tsx",
      "client/packages/editor-oss/src/editor/assets/v2/common/StyledSwitch.tsx",
      "client/packages/editor-oss/src/editor/assets/v2/RightPanel/panels/ProjectSettings/CADToolsSection.tsx",
      "client/packages/editor-oss/src/editor/assets/v2/RightPanel/panels/ProjectSettings/constants.ts",
      "docs/plan-cad.md",
      "scripts/playwright/oss-plan-cad-smoke.mjs",
    ],
  },
  {
    id: "05-docs-site-misc",
    title: "Builder Studio Docs, Site, And Misc Wiring",
    paths: [
      ".gitignore",
      "CLAUDE.md",
      "README.md",
      "client/packages/site/src/routes/Playground.tsx",
      "client/packages/site/src/styles/globals.css",
      "docs/architecture.md",
      "docs/assets/builder-studio",
      "docs/builder-studio-release-gate.md",
      "docs/planning/2026-06-28-builder-and-cad-mode-followups.md",
      "docs/planning/2026-07-06-builder-cad-production-hardening.md",
      "docs/planning/2026-07-07-builder-cad-pr-create-handoff.md",
      "docs/planning/2026-07-07-builder-cad-pr-split-manifest.md",
      "scripts/build-builder-cad-pr-split-patches.mjs",
      "scripts/playwright/oss-builder-release-scenario.mjs",
      "scripts/playwright/oss-filesystem-roundtrip.mjs",
      "scripts/playwright/oss-smoke.mjs",
      "scripts/playwright/site-landing.mjs",
      "scripts/playwright/site-nav.mjs",
      "scripts/playwright/site-playground.mjs",
      "skills-lock.json",
    ],
  },
  {
    id: "90-shared-hunk-required",
    title: "Shared Files Requiring Hunk-Level Split",
    paths: [
      "package.json",
      "client/packages/editor-oss/src/editor/assets/v2/ActionBar/ActionBar.tsx",
      "client/packages/editor-oss/src/editor/assets/v2/ActionBar/ActionBar.style.ts",
      "client/packages/editor-oss/src/editor/assets/v2/ActionBar/ActionBar.builderModes.test.tsx",
      "client/packages/editor-oss/src/editor/assets/v2/ActionBar/icons/ActionBarIcons.tsx",
      "client/packages/editor-oss/src/editor/assets/v2/RightPanel/panels/ProjectSettings/GameSettings.tsx",
    ],
  },
  {
    id: "99-owner-decision",
    title: "Owner Decision Bucket",
    paths: [
      "client/packages/editor-oss/src/editor/asset-management/hooks/useReplaceAsset.ts",
      "client/packages/editor-oss/src/editor/asset-management/hooks/useReplaceAsset.test.ts",
      "client/packages/editor-oss/src/editor/assets/v2/CreateDashboard/DashboardLayout/SideNavigation/SideNavigation.tsx",
      "client/packages/editor-oss/src/editor/assets/v2/LeftPanel/MainTabs/AssetsTab/SubTabs/AiModelsTab.tsx",
      "client/packages/editor-oss/src/editor/assets/v2/LeftPanel/MainTabs/AssetsTab/SubTabs/AiNpcsTab.tsx",
      "client/packages/editor-oss/src/editor/assets/v2/LeftPanel/MainTabs/AssetsTab/SubTabs/MiscTab.tsx",
      "client/packages/editor-oss/src/editor/assets/v2/LeftPanel/MainTabs/ProjectTab/ProjectTab.tsx",
      "client/packages/editor-oss/src/editor/assets/v2/OSSBootstrapModal/OSSBootstrapModal.tsx",
      "client/packages/editor-oss/src/editor/assets/v2/RightPanel/sections/LightingSection.tsx",
      "client/packages/editor-oss/src/editor/assets/v2/RightPanel/sections/PhysicsSection.tsx",
      "client/packages/editor-oss/src/editor/assets/v2/RightPanel/sections/v2/PhysicsSection.tsx",
      "client/packages/editor-oss/src/editor/assets/v2/common/InfoCard/StemVersionPicker/StemVersionPicker.tsx",
      "client/packages/editor-oss/src/editor/lambdas/hooks/lambdas.ts",
      "client/packages/editor-oss/src/event/TransformControlsEvent.js",
      "client/packages/editor-oss/src/global.ts",
      "client/packages/editor-oss/src/physics/PhysicsUtil.ts",
      "client/packages/editor-oss/src/physics/PhysicsUtil.test.ts",
      "client/packages/editor-oss/src/serialization/core/PrefabSerializer.ts",
      "client/packages/editor-oss/src/serialization/core/PrefabSerializer.test.ts",
      "scripts/playwright/_tinyskies-diag.mjs",
    ],
  },
];

function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 200,
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

function gitOutput(args) {
  const result = runGit(args);
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${result.stderr}`);
  }
  return result.stdout;
}

function listUntracked() {
  return gitOutput(["ls-files", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean);
}

function pathMatches(path, candidate) {
  return candidate === path || candidate.startsWith(`${path}/`);
}

function trackedDiff(paths) {
  const result = runGit(["diff", "--binary", "--", ...paths]);
  if (result.status !== 0) {
    throw new Error(`git diff failed:\n${result.stderr}`);
  }
  return result.stdout;
}

function untrackedDiff(file) {
  const result = runGit(["diff", "--no-index", "--binary", "--", "/dev/null", file]);
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git diff --no-index failed for ${file}:\n${result.stderr}`);
  }
  return result.stdout
    .replaceAll("a/dev/null", "a/" + file)
    .replaceAll("b/" + file, "b/" + file);
}

const untrackedFiles = listUntracked();
const assignedUntracked = new Set();
const summary = [];

for (const bucket of buckets) {
  const matchingUntracked = untrackedFiles.filter((file) =>
    bucket.paths.some((path) => pathMatches(path, file)),
  );
  matchingUntracked.forEach((file) => assignedUntracked.add(file));

  const parts = [
    `# ${bucket.title}`,
    `# Generated from current worktree by ${fileURLToPath(import.meta.url).slice(repoRoot.length + 1)}`,
    "",
    trackedDiff(bucket.paths),
    ...matchingUntracked.map(untrackedDiff),
  ].filter((part) => part.length > 0);

  const content = `${parts.join("\n")}\n`;
  const outPath = join(outDir, `${bucket.id}.patch`);
  writeFileSync(outPath, content);
  summary.push({
    id: bucket.id,
    title: bucket.title,
    file: outPath.slice(repoRoot.length + 1),
    pathCount: bucket.paths.length,
    untrackedCount: matchingUntracked.length,
    bytes: Buffer.byteLength(content),
  });
}

const unassignedUntracked = untrackedFiles.filter(
  (file) =>
    !assignedUntracked.has(file) &&
    !file.startsWith("docs/planning/pr-split-patches/"),
);

writeFileSync(
  join(outDir, "00-summary.json"),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      repoRoot,
      buckets: summary,
      unassignedUntracked,
    },
    null,
    2,
  )}\n`,
);

console.log(`Wrote ${summary.length} patch bundles to ${outDir}`);
if (unassignedUntracked.length) {
  console.log("Unassigned untracked files:");
  for (const file of unassignedUntracked) console.log(`- ${file}`);
}
