#!/usr/bin/env node
/**
 * Builder Studio release scenario smoke.
 *
 * Covers the long release-gate scenario from
 * docs/planning/2026-07-06-builder-cad-production-hardening.md:
 * - BIM Plan: 2 rooms, 8 walls, 2 openings, slab, 3 parts, property edits,
 *   20 undo/redo operations, save/reload, DXF/IFC export, DXF re-import.
 * - Quick Build: 200 terrain stamps with texture metadata, duplicate cleanup,
 *   bake, save/reload.
 * - Mesh CAD: cube extrude/inset/bevel operations, undo, exit.
 *
 * Requires a running OSS dev server. Set PLAYWRIGHT_BASE_URL if not using :5173.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "oss-builder-release-scenario-output");
mkdirSync(outDir, { recursive: true });

const baseUrl = (
  process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5173"
).replace(/\/$/, "");
const headed = process.env.HEADED === "1";
const failures = [];
const report = {
  baseUrl,
  startedAt: new Date().toISOString(),
  assertions: {},
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
};

function assert(name, condition, detail = "") {
  report.assertions[name] = { pass: !!condition, detail };
  console.log(
    `${condition ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) failures.push(name);
}

async function waitForEditor(page) {
  await page.waitForFunction(
    () => {
      const app = window.app || globalThis.app;
      return !!app?.editor?.scene;
    },
    { timeout: 30000 },
  );
}

async function dismissBootstrap(page) {
  const modal = page.locator('[aria-labelledby="oss-bootstrap-title"]').first();
  if ((await modal.count()) && (await modal.isVisible().catch(() => false))) {
    await modal
      .locator('button:has-text("Browser storage")')
      .first()
      .click({ timeout: 3000 })
      .catch(() => {});
    await modal
      .locator('button:has-text("Continue")')
      .first()
      .click({ timeout: 5000 })
      .catch(() => {});
    await page
      .waitForSelector('[aria-labelledby="oss-bootstrap-title"]', {
        state: "detached",
        timeout: 5000,
      })
      .catch(() => {});
  }
}

async function dismissTutorial(page) {
  const gotIt = page.locator('button:has-text("Got It")').first();
  if ((await gotIt.count()) && (await gotIt.isVisible().catch(() => false))) {
    await gotIt.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
}

async function enableCadTools(page) {
  await page
    .locator('[data-testid="leftpanel-tab-project"]')
    .first()
    .click({ timeout: 5000, force: true });
  await page
    .locator("text=Project Settings")
    .first()
    .click({ timeout: 5000, force: true });
  const cadToggle = page.locator('[data-testid="cad-tools-toggle"]').first();
  const cadSwitch = page.locator('[data-testid="cad-tools-switch"]').first();
  const cadCheckbox = page
    .locator('[data-testid="cad-tools-switch"] input[type="checkbox"]')
    .first();
  assert(
    "cad beta toggle visible",
    await cadToggle.isVisible().catch(() => false),
  );
  if (!(await cadCheckbox.isChecked().catch(() => false))) {
    await cadSwitch.click({ timeout: 5000, force: true });
  }
  await page.waitForTimeout(500);
  assert("cad tools enabled", await cadCheckbox.isChecked().catch(() => false));
}

async function addCube(page) {
  await page
    .locator('[data-testid="leftpanel-tab-library"]')
    .first()
    .click({ timeout: 5000, force: true })
    .catch(() => {});
  await page
    .locator('[data-testid="icon-item-cube"]')
    .first()
    .click({ timeout: 5000, force: true });
  await page.waitForTimeout(1000);
  const cube = await page.evaluate(() => {
    const app = window.app || globalThis.app;
    let count = 0;
    let target = app?.editor?.selected?.isMesh ? app.editor.selected : null;
    app?.editor?.scene?.traverse((object) => {
      if (object?.isMesh && object.visible !== false) {
        count++;
        if (
          !target &&
          !object.userData?.quickBuildPart &&
          !object.userData?.isPlanCadManaged &&
          !object.userData?.planNodeId
        ) {
          target = object;
        }
      }
    });
    if (target) {
      target.name = "Builder Release CAD Cube";
      target.userData.builderReleaseCadTarget = true;
    }
    return { meshCount: count, targetName: target?.name ?? null };
  });
  assert(
    "cube added for Mesh CAD",
    cube.meshCount > 0 && cube.targetName === "Builder Release CAD Cube",
    JSON.stringify(cube),
  );
}

async function saveProject(page, label) {
  const result = await page.evaluate(async () => {
    const { saveScene } = await import(
      "/packages/network/src/adapters/remote-go/scene/index.ts"
    );
    const app = window.app || globalThis.app;
    const editor = app?.editor;
    if (!app || !editor) return { saved: false, sceneId: null };

    const savedEvent = new Promise((resolve) => {
      app.on?.("sceneSaved.BuilderReleaseScenario", (_source, saved) => {
        resolve({ saved: true, sceneId: saved?.id ?? editor.sceneID ?? null });
      });
      app.on?.("sceneSaveFailed.BuilderReleaseScenario", () => {
        resolve({ saved: false, sceneId: editor.sceneID ?? null });
      });
    });
    await saveScene(true, true);
    const result = await Promise.race([
      savedEvent,
      new Promise((resolve) =>
        setTimeout(
          () => resolve({ saved: false, sceneId: editor.sceneID ?? null }),
          30000,
        ),
      ),
    ]);
    app.on?.("sceneSaved.BuilderReleaseScenario", null);
    app.on?.("sceneSaveFailed.BuilderReleaseScenario", null);
    return result;
  });
  assert(
    `${label}: project saved`,
    result.saved === true && typeof result.sceneId === "string",
    JSON.stringify(result),
  );
  await page.waitForTimeout(1200);
  return result.sceneId;
}

async function reloadProject(page, label, sceneId) {
  if (sceneId) {
    await page.goto(`${baseUrl}/create/project/${sceneId}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
  } else {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  }
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await dismissBootstrap(page);
  await dismissTutorial(page);
  await waitForEditor(page);
  assert(`${label}: editor reloaded`, /\/create\/project/.test(page.url()), page.url());
}

async function buildPlanScenario(page) {
  return page.evaluate(async () => {
    const bridge = await import(
      "/packages/editor-oss/src/editor/assets/v2/PlanMode/planCadEditorBridge.ts"
    );
    const interchange = await import(
      "/packages/editor-oss/src/editor/assets/v2/PlanMode/planCadInterchange.ts"
    );
    const app = window.app || globalThis.app;
    const editor = app?.editor;
    if (!editor?.scene) throw new Error("editor unavailable");
    const emit = (message) => console.log(`[builder-release] ${message}`);
    const smokeEditor = {
      scene: editor.scene,
      select: editor.select?.bind(editor),
      execute: (command, optionalName) =>
        editor.history?.execute(command, optionalName) ?? command.execute(),
      addObject: async (object, parent) => {
        (parent ?? editor.scene).add(object);
      },
      removeObject: (object) => {
        object.parent?.remove(object);
      },
    };

    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const timeout = (label) =>
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`${label} timed out`)), 5000);
      });
    const countPlan = (data) => {
      const counts = { wall: 0, slab: 0, zone: 0, item: 0, opening: 0 };
      for (const node of Object.values(data?.nodes ?? {})) {
        if (node.type === "wall") {
          counts.wall++;
          counts.opening += Array.isArray(node.openings)
            ? node.openings.length
            : 0;
        }
        if (node.type === "slab") counts.slab++;
        if (node.type === "zone") counts.zone++;
        if (node.type === "item") counts.item++;
      }
      return counts;
    };

    let data = null;
    const wallIds = [];
    const commits = [];
    const commit = async (next, label) => {
      data = next;
      const didCommit = await Promise.race([
        bridge.commitPlanCadSceneData(smokeEditor, data),
        timeout(label),
      ]);
      if (!didCommit) throw new Error(`commit failed: ${label}`);
      commits.push(label);
      if (commits.length % 5 === 0 || commits.length === 20) {
        emit(`BIM Plan committed ${commits.length}/20 steps`);
      }
      await wait(35);
    };

    const wallSegments = [
      [{ x: 0, z: 0 }, { x: 4, z: 0 }],
      [{ x: 4, z: 0 }, { x: 4, z: 4 }],
      [{ x: 4, z: 4 }, { x: 0, z: 4 }],
      [{ x: 0, z: 4 }, { x: 0, z: 0 }],
      [{ x: 5, z: 0 }, { x: 9, z: 0 }],
      [{ x: 9, z: 0 }, { x: 9, z: 4 }],
      [{ x: 9, z: 4 }, { x: 5, z: 4 }],
      [{ x: 5, z: 4 }, { x: 5, z: 0 }],
    ];
    for (const [index, [start, end]] of wallSegments.entries()) {
      await commit(bridge.createPlanCadWall(data, start, end), `wall-${index}`);
      wallIds.push(data.selectedNodeId);
    }

    await commit(
      bridge.addPlanCadOpening(data, { x: 2, z: 0 }, "door", wallIds[0]),
      "door",
    );
    await commit(
      bridge.addPlanCadOpening(data, { x: 7, z: 0 }, "window", wallIds[4]),
      "window",
    );
    await commit(
      bridge.createPlanCadPolygonSlab(data, [
        { x: 0, z: 0 },
        { x: 9, z: 0 },
        { x: 9, z: 4 },
        { x: 0, z: 4 },
      ]),
      "slab",
    );
    await commit(
      bridge.createPlanCadPolygonZone(data, [
        { x: 0.2, z: 0.2 },
        { x: 3.8, z: 0.2 },
        { x: 3.8, z: 3.8 },
        { x: 0.2, z: 3.8 },
      ]),
      "room-zone-1",
    );
    await commit(
      bridge.createPlanCadPolygonZone(data, [
        { x: 5.2, z: 0.2 },
        { x: 8.8, z: 0.2 },
        { x: 8.8, z: 3.8 },
        { x: 5.2, z: 3.8 },
      ]),
      "room-zone-2",
    );
    for (const [preset, point] of [
      ["desk", { x: 1.2, z: 1.2 }],
      ["sofa", { x: 6.2, z: 1.2 }],
      ["cabinet", { x: 7.8, z: 3.0 }],
    ]) {
      await commit(
        bridge.createPlanCadPart(data, point, { partPresetId: preset }),
        `part-${preset}`,
      );
    }

    await commit(
      bridge.updatePlanCadNodeData(data, wallIds[0], { height: 3.2 }),
      "wall-height",
    );
    await commit(
      bridge.updatePlanCadNodeData(data, wallIds[1], { thickness: 0.24 }),
      "wall-thickness",
    );
    await commit(
      bridge.updatePlanCadNodeData(data, wallIds[4], { material: "partition" }),
      "wall-material",
    );
    await commit(
      bridge.updatePlanCadNodeData(data, wallIds[5], { height: 2.8 }),
      "wall-height-2",
    );

    emit("BIM Plan exporting DXF/IFC");
    const finalCounts = countPlan(data);
    const dxf = interchange.exportPlanCadDxf(data);
    const ifc = interchange.exportPlanCadIfc(data);
    emit("BIM Plan importing DXF");
    const imported = interchange.importPlanCadDxf(dxf);
    const importCounts = countPlan(imported);

    emit("BIM Plan undo loop start");
    for (let i = 0; i < 20; i++) {
      editor.history?.undo();
      await wait(45);
      if ((i + 1) % 5 === 0 || i === 19) {
        emit(`BIM Plan undo ${i + 1}/20`);
      }
    }
    const afterUndo = bridge.getPlanCadSceneData(editor.scene);

    emit("BIM Plan redo loop start");
    for (let i = 0; i < 20; i++) {
      await editor.history?.redo();
      await wait(45);
      if ((i + 1) % 5 === 0 || i === 19) {
        emit(`BIM Plan redo ${i + 1}/20`);
      }
    }
    const afterRedo = bridge.getPlanCadSceneData(editor.scene);
    data = afterRedo;

    emit("BIM Plan committing imported DXF data");
    await Promise.race([
      bridge.commitPlanCadSceneData(smokeEditor, imported),
      timeout("dxf-import-commit"),
    ]);
    data = imported;
    app.call?.("objectChanged", editor, editor.scene);

    return {
      commits: commits.length,
      finalCounts,
      importCounts,
      afterUndoCounts: afterUndo ? countPlan(afterUndo) : null,
      afterRedoCounts: afterRedo ? countPlan(afterRedo) : null,
      dxfLength: dxf.length,
      ifcLength: ifc.length,
      importedSelectedNodeId: imported.selectedNodeId ?? null,
    };
  });
}

async function getPlanCounts(page) {
  return page.evaluate(() => {
    const app = window.app || globalThis.app;
    const data = app?.editor?.scene?.userData?.planCad;
    const counts = { wall: 0, slab: 0, zone: 0, item: 0, opening: 0 };
    for (const node of Object.values(data?.nodes ?? {})) {
      if (node.type === "wall") {
        counts.wall++;
        counts.opening += Array.isArray(node.openings)
          ? node.openings.length
          : 0;
      }
      if (node.type === "slab") counts.slab++;
      if (node.type === "zone") counts.zone++;
      if (node.type === "item") counts.item++;
    }
    return counts;
  });
}

async function buildQuickBuildScenario(page) {
  return page.evaluate(async () => {
    const objects = await import(
      "/packages/editor-oss/src/editor/assets/v2/QuickBuild/quickBuildObjects.ts"
    );
    const tools = await import(
      "/packages/editor-oss/src/editor/assets/v2/QuickBuild/quickBuildSceneTools.ts"
    );
    const app = window.app || globalThis.app;
    const editor = app?.editor;
    const scene = editor?.scene;
    if (!scene) throw new Error("editor scene unavailable");

    const texture = {
      presetId: "release-scenario-terrain",
      label: "Release Scenario Terrain",
      url: "/vendor/texture-packs/manifest.json",
      license: "custom",
      attribution: "Release scenario smoke",
    };

    for (let z = 0; z < 10; z++) {
      for (let x = 0; x < 20; x++) {
        const stamp = objects.createQuickBuildObject("ground");
        stamp.position.set(x, 0, z + 7);
        stamp.userData.quickBuildTexture = texture;
        scene.add(stamp);
      }
    }
    const duplicate = objects.createQuickBuildObject("ground");
    duplicate.position.set(0, 0, 7);
    scene.add(duplicate);

    const beforeCleanup = tools.analyzeQuickBuildScene(scene);
    for (const target of tools.getQuickBuildDuplicateRemovalTargets(scene)) {
      target.parent?.remove(target);
    }
    const afterCleanup = tools.analyzeQuickBuildScene(scene);
    const batch = tools.createQuickBuildBakedBatch(scene);
    if (batch) scene.add(batch);
    const afterBake = tools.analyzeQuickBuildScene(scene);
    app.call?.("objectChanged", editor, scene);

    return {
      beforeCleanup,
      afterCleanup,
      afterBake,
      batchName: batch?.name ?? null,
      texturedCount: tools
        .collectQuickBuildObjects(scene)
        .filter((object) => object.userData?.quickBuildTexture?.presetId === texture.presetId)
        .length,
    };
  });
}

async function getQuickBuildSummary(page) {
  return page.evaluate(async () => {
    const tools = await import(
      "/packages/editor-oss/src/editor/assets/v2/QuickBuild/quickBuildSceneTools.ts"
    );
    const app = window.app || globalThis.app;
    const scene = app?.editor?.scene;
    const analysis = tools.analyzeQuickBuildScene(scene);
    const materialSummary = {meshCount: 0, emptyCount: 0, materialEntryCount: 0, materialTypeCounts: {}};
    for (const object of tools.collectQuickBuildObjects(scene)) {
      object.traverse?.((child) => {
        if (!child?.isMesh) return;
        materialSummary.meshCount++;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          materialSummary.materialEntryCount++;
          if (!material || typeof material !== "object" || !material.type) {
            materialSummary.emptyCount++;
            return;
          }
          materialSummary.materialTypeCounts[material.type] =
            (materialSummary.materialTypeCounts[material.type] || 0) + 1;
        }
      });
    }
    return {
      objectCount: analysis.objectCount,
      duplicateCount: analysis.duplicateCount,
      bakedBatchCount: analysis.bakedBatchCount,
      texturedCount: tools
        .collectQuickBuildObjects(scene)
        .filter((object) => object.userData?.quickBuildTexture)
        .length,
      materialSummary,
    };
  });
}

async function runMeshCadScenario(page) {
  return page.evaluate(async () => {
    const app = window.app || globalThis.app;
    const editor = app?.editor;
    if (!editor?.scene) return { ok: false, reason: "editor unavailable" };

    const meshes = [];
    editor.scene.traverse((object) => {
      if (
        object?.isMesh &&
        object.visible !== false &&
        object.geometry?.getAttribute?.("position") &&
        !object.userData?.quickBuildPart
      ) {
        meshes.push(object);
      }
    });
    const mesh =
      meshes.find((object) => object.userData?.builderReleaseCadTarget) ??
      meshes.find((object) =>
        /cube|box/i.test(`${object.name || ""} ${object.parent?.name || ""}`),
      ) ?? meshes[0];
    if (!mesh) return { ok: false, reason: "mesh unavailable" };

    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    editor.select?.(mesh, true);
    const beforeVertices = mesh.geometry.getAttribute("position")?.count ?? 0;
    editor.enterCADMode?.(mesh);

    const currentMeshData = () =>
      editor.cadController?.meshData ?? mesh.userData?.meshData;
    const firstFaceId = () => {
      const faces = currentMeshData()?.faces;
      const entry = faces instanceof Map ? Array.from(faces.keys())[0] : Object.keys(faces ?? {})[0];
      const id = Number(entry);
      return Number.isFinite(id) ? id : null;
    };
    const selectFace = () => {
      const id = firstFaceId();
      if (id === null) return false;
      editor.setCADSelectionMode?.("face");
      editor.cadController.selectedFaceIds.clear();
      editor.cadController.selectedEdgeIds.clear();
      editor.cadController.selectedFaceIds.add(id);
      return true;
    };
    const firstBevelableEdgeId = () => {
      const edges = currentMeshData()?.edges;
      const entries =
        edges instanceof Map ? Array.from(edges.entries()) : Object.entries(edges ?? {});
      const entry = entries.find(([, candidate]) => {
        const faceCount =
          candidate?.faceIds instanceof Set
            ? candidate.faceIds.size
            : Array.isArray(candidate?.faceIds)
              ? candidate.faceIds.length
              : 1;
        return faceCount > 0 && faceCount <= 2;
      });
      const id = Number(entry?.[0] ?? entry?.[1]?.id);
      return Number.isFinite(id) ? id : null;
    };
    const selectEdge = () => {
      const id = firstBevelableEdgeId();
      if (id === null) return false;
      editor.setCADSelectionMode?.("edge");
      editor.cadController.selectedFaceIds.clear();
      editor.cadController.selectedEdgeIds.clear();
      editor.cadController.selectedEdgeIds.add(id);
      return true;
    };

    const refreshCadMode = async () => {
      editor.exitCADMode?.();
      await wait(60);
      editor.select?.(mesh, true);
      editor.enterCADMode?.(mesh);
      await wait(60);
    };
    const undoLatestCadEdit = async () => {
      editor.history?.undo();
      await wait(160);
      await refreshCadMode();
    };

    const extrudeApplied = selectFace() && editor.applyCADExtrude?.(0.25) === true;
    await wait(160);
    const afterExtrudeVertices = mesh.geometry.getAttribute("position")?.count ?? 0;
    await undoLatestCadEdit();

    const insetApplied = selectFace() && editor.applyCADInset?.(0.04) === true;
    await wait(160);
    const afterInsetVertices = mesh.geometry.getAttribute("position")?.count ?? 0;
    await undoLatestCadEdit();

    const faceBevelApplied = selectFace() && editor.applyCADBevel?.(0.035) === true;
    let edgeBevelApplied = false;
    if (!faceBevelApplied) {
      edgeBevelApplied = selectEdge() && editor.applyCADEdgeBevel?.(0.035, 1, "flat") === true;
    }
    await wait(160);
    const afterBevelVertices = mesh.geometry.getAttribute("position")?.count ?? 0;
    await undoLatestCadEdit();
    const afterUndoVertices = mesh.geometry.getAttribute("position")?.count ?? 0;
    editor.exitCADMode?.();

    return {
      ok:
        extrudeApplied &&
        insetApplied &&
        (faceBevelApplied || edgeBevelApplied) &&
        afterExtrudeVertices !== beforeVertices &&
        afterInsetVertices !== beforeVertices &&
        afterBevelVertices !== beforeVertices &&
        afterUndoVertices === beforeVertices,
      beforeVertices,
      afterExtrudeVertices,
      afterInsetVertices,
      afterBevelVertices,
      afterUndoVertices,
      extrudeApplied,
      insetApplied,
      faceBevelApplied,
      edgeBevelApplied,
      bevelApplied: faceBevelApplied || edgeBevelApplied,
      cadMode: editor.cadMode === true,
    };
  });
}

const browser = await chromium.launch({ headless: !headed });
const page = await (
  await browser.newContext({ viewport: { width: 1440, height: 900 } })
).newPage();

page.on("console", (m) => {
  const text = m.text();
  if (text.startsWith("[builder-release]")) console.log(text);
  if (m.type() === "error")
    report.consoleErrors.push({ text, location: m.location() });
});
page.on("pageerror", (e) =>
  report.pageErrors.push({
    message: e.message,
    stack: e.stack?.slice(0, 2000),
  }),
);
page.on("requestfailed", (r) =>
  report.failedRequests.push({
    url: r.url(),
    method: r.method(),
    failure: r.failure()?.errorText,
  }),
);
page.on("response", (r) => {
  if (
    r.status() >= 400 &&
    r.url().startsWith(baseUrl) &&
    !/\/api\/AI\//.test(r.url())
  ) {
    report.failedRequests.push({
      url: r.url(),
      method: r.request().method(),
      status: r.status(),
    });
  }
});

try {
  await page.goto(`${baseUrl}/create/project`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(5000);
  await dismissBootstrap(page);
  await dismissTutorial(page);
  await waitForEditor(page);
  assert("editor canvas visible", await page.locator("canvas").first().isVisible().catch(() => false));

  await enableCadTools(page);
  await addCube(page);

  console.log("running BIM Plan release scenario");
  const plan = await buildPlanScenario(page);
  assert("BIM Plan committed 20 edit steps", plan.commits === 20, JSON.stringify(plan));
  assert(
    "BIM Plan has 2 rooms, 8 walls, 2 openings, slab, 3 parts",
    plan.finalCounts.wall === 8 &&
      plan.finalCounts.opening === 2 &&
      plan.finalCounts.slab === 1 &&
      plan.finalCounts.zone === 2 &&
      plan.finalCounts.item === 3,
    JSON.stringify(plan.finalCounts),
  );
  assert("BIM Plan 20 undo clears plan data", plan.afterUndoCounts === null, JSON.stringify(plan.afterUndoCounts));
  assert(
    "BIM Plan 20 redo restores plan data",
    plan.afterRedoCounts?.wall === 8 &&
      plan.afterRedoCounts?.opening === 2 &&
      plan.afterRedoCounts?.item === 3,
    JSON.stringify(plan.afterRedoCounts),
  );
  assert(
    "BIM Plan exports DXF and IFC",
    plan.dxfLength > 1000 && plan.ifcLength > 1000,
    `dxf=${plan.dxfLength} ifc=${plan.ifcLength}`,
  );
  assert(
    "BIM Plan DXF re-import preserves counts",
    plan.importCounts.wall === 8 &&
      plan.importCounts.opening === 2 &&
      plan.importCounts.slab === 1 &&
      plan.importCounts.zone === 2 &&
      plan.importCounts.item === 3,
    JSON.stringify(plan.importCounts),
  );

  console.log("saving BIM Plan release scenario");
  const planSceneId = await saveProject(page, "plan scenario");
  await reloadProject(page, "plan scenario", planSceneId);
  const planAfterReload = await getPlanCounts(page);
  assert(
    "BIM Plan survives save/reload",
    planAfterReload.wall === 8 &&
      planAfterReload.opening === 2 &&
      planAfterReload.slab === 1 &&
      planAfterReload.zone === 2 &&
      planAfterReload.item === 3,
    JSON.stringify(planAfterReload),
  );

  console.log("running Quick Build release scenario");
  const quick = await buildQuickBuildScenario(page);
  assert(
    "Quick Build creates 200 terrain stamps",
    quick.afterCleanup.objectCount >= 200,
    JSON.stringify(quick.afterCleanup),
  );
  assert(
    "Quick Build duplicate cleanup removes duplicate",
    quick.beforeCleanup.duplicateCount > 0 &&
      quick.afterCleanup.duplicateCount === 0,
    `before=${quick.beforeCleanup.duplicateCount} after=${quick.afterCleanup.duplicateCount}`,
  );
  assert(
    "Quick Build texture metadata applied",
    quick.texturedCount >= 200,
    `textured=${quick.texturedCount}`,
  );
  assert(
    "Quick Build bake creates runtime batch",
    quick.afterBake.bakedBatchCount >= 1,
    JSON.stringify(quick.afterBake),
  );

  console.log("saving Quick Build release scenario");
  const quickBuildSceneId = await saveProject(page, "quick build scenario");
  await reloadProject(page, "quick build scenario", quickBuildSceneId);
  const quickAfterReload = await getQuickBuildSummary(page);
  assert(
    "Quick Build survives save/reload",
    quickAfterReload.objectCount >= 200 &&
      quickAfterReload.duplicateCount === 0 &&
      quickAfterReload.bakedBatchCount >= 1 &&
      quickAfterReload.texturedCount >= 200 &&
      quickAfterReload.materialSummary?.meshCount >= 200 &&
      quickAfterReload.materialSummary?.emptyCount === 0,
    JSON.stringify(quickAfterReload),
  );

  console.log("running Mesh CAD release scenario");
  const mesh = await runMeshCadScenario(page);
  assert("Mesh CAD extrude/inset/bevel then undo/exit", mesh.ok === true && mesh.cadMode === false, JSON.stringify(mesh));

  await page
    .screenshot({ path: resolve(outDir, "final.png"), fullPage: true })
    .catch(() => {});
} catch (error) {
  failures.push(`exception: ${error.message}`);
  console.error(error);
} finally {
  const localFailures = report.failedRequests.filter(
    (item) =>
      item.url?.startsWith(baseUrl) && item.failure !== "net::ERR_ABORTED",
  );
  assert(
    "no failed local non-AI requests",
    localFailures.length === 0,
    JSON.stringify(localFailures).slice(0, 500),
  );
  writeFileSync(
    resolve(outDir, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}

if (failures.length) {
  console.error(`\nFAILED: ${failures.length} assertion(s)`);
  process.exit(1);
}

console.log("\noss builder release scenario: PASS");
