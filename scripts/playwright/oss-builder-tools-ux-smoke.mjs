#!/usr/bin/env node
/**
 * OSS builder tools UX smoke.
 *
 * This complements the narrower Plan/CAD wall smoke by checking that the visible
 * Quick Build and Plan/CAD controls are legible, selectable, and mutate the real
 * editor scene when their primary action implies scene output.
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "oss-builder-tools-ux-smoke-output");
mkdirSync(outDir, { recursive: true });

const baseUrl = (
  process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5173"
).replace(/\/$/, "");
const headed = process.env.HEADED === "1";
const viewport = (() => {
  const [width, height] = (process.env.VIEWPORT || "1440x900")
    .split("x")
    .map(Number);
  return Number.isFinite(width) && Number.isFinite(height)
    ? { width, height }
    : { width: 1440, height: 900 };
})();
const mobileViewport = viewport.width <= 900 && viewport.height <= 500;
const report = {
  baseUrl,
  startedAt: new Date().toISOString(),
  assertions: {},
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
};
const failures = [];
const toolbarLayoutViewports = process.env.VIEWPORT
  ? [viewport]
  : [
      { width: 1280, height: 800 },
      { width: 1024, height: 640 },
    ];

function assert(name, condition, detail = "") {
  report.assertions[name] = { pass: !!condition, detail };
  console.log(
    `${condition ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) failures.push(name);
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

async function clickCanvas(page, canvas, relX, relY) {
  const box = await getCanvasBox(page);
  assert("canvas has bounds", !!box, JSON.stringify(box));
  if (!box || box.width <= 0 || box.height <= 0) return;
  await page.mouse.click(box.x + box.width * relX, box.y + box.height * relY);
}

async function dispatchPlanViewportClick(page, relX, relY) {
  await page.evaluate(({relX, relY}) => {
    const app = window.app || globalThis.app;
    const viewport =
      app?.viewport ||
      app?.renderer?.domElement ||
      app?.editor?.renderer?.domElement ||
      document.getElementById("scene-container") ||
      document.querySelector("canvas");
    if (!(viewport instanceof HTMLElement)) return;
    const rect = viewport.getBoundingClientRect();
    const clientX = rect.left + rect.width * relX;
    const clientY = rect.top + rect.height * relY;
    const init = {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      button: 0,
      buttons: 1,
      pointerId: 91,
      pointerType: "touch",
      isPrimary: true,
    };
    viewport.dispatchEvent(new PointerEvent("pointerdown", init));
    viewport.dispatchEvent(new PointerEvent("pointerup", {...init, buttons: 0}));
  }, {relX, relY});
}

async function dispatchPlanViewportMove(page, relX, relY) {
  await page.evaluate(({relX, relY}) => {
    const app = window.app || globalThis.app;
    const viewport =
      app?.viewport ||
      app?.renderer?.domElement ||
      app?.editor?.renderer?.domElement ||
      document.getElementById("scene-container") ||
      document.querySelector("canvas");
    if (!(viewport instanceof HTMLElement)) return;
    const rect = viewport.getBoundingClientRect();
    viewport.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width * relX,
      clientY: rect.top + rect.height * relY,
      button: 0,
      buttons: 1,
      pointerId: 91,
      pointerType: "touch",
      isPrimary: true,
    }));
  }, {relX, relY});
}

async function getCanvasBox(page) {
  return page.evaluate(() => {
    const element = document.querySelector("canvas");
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  });
}

async function quickBuildSceneNumbers(page) {
  return page
    .evaluate(() => {
      const app = window.app || globalThis.app;
      const scene = app?.editor?.scene;
      if (!scene) return [];

      const roots = [];
      const duplicateKeys = new Set();
      let duplicateCount = 0;
      let meshCount = 0;
      scene.traverse((object) => {
        const metadata = object.userData?.quickBuild;
        if (metadata && object.visible !== false) {
          roots.push(object);
          const key = `${metadata.kind}:${Math.round(object.position.x * 1000) / 1000}:${Math.round(object.position.z * 1000) / 1000}`;
          if (duplicateKeys.has(key)) duplicateCount++;
          duplicateKeys.add(key);
        }
        if (object?.isMesh && object.visible !== false) {
          for (let current = object; current; current = current.parent) {
            if (current.userData?.quickBuild) {
              meshCount++;
              break;
            }
          }
        }
      });
      return [roots.length, meshCount, duplicateCount];
    })
    .catch(() => []);
}

async function waitForQuickBuildSceneCount(page, minimum, label) {
  const deadline = Date.now() + 10000;
  let numbers = [];
  while (Date.now() < deadline) {
    numbers = await quickBuildSceneNumbers(page);
    if ((numbers[0] ?? 0) >= minimum) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert(
    label,
    (numbers[0] ?? 0) >= minimum,
    `sceneStats=${JSON.stringify(numbers)}`,
  );
  return numbers;
}

async function clickControl(locator, timeout = 5000) {
  await locator
    .scrollIntoViewIfNeeded({ timeout: Math.min(timeout, 1000) })
    .catch(() => {});
  await locator
    .click({ timeout, force: true, noWaitAfter: true })
    .catch(async () => {
      const handle = await locator
        .elementHandle({ timeout: Math.min(timeout, 1000) })
        .catch(() => null);
      await handle?.evaluate((element) => {
        if (element instanceof HTMLElement) element.click();
      });
    });
}

async function dismissSceneSavedToast(page) {
  await page.mouse.move(100, 100);
  await page.evaluate(() => {
    const title = Array.from(document.querySelectorAll("*")).find(
      (element) => element.childElementCount === 0 && element.textContent?.trim() === "Scene Saved",
    );
    if (!title) return;
    let root = title.parentElement;
    for (let depth = 0; depth < 5 && root; depth++, root = root.parentElement) {
      const buttons = root.querySelectorAll("button");
      if (buttons.length > 0) {
        buttons[buttons.length - 1].click();
        return;
      }
    }
  }).catch(() => {});
  await page.waitForFunction(() => !Array.from(document.querySelectorAll("*"))
    .some((element) => element.childElementCount === 0 && element.textContent?.trim() === "Scene Saved"),
  undefined,
  {timeout: 8000}).catch(() => {});
}

async function isPressed(page, testId) {
  return page
    .evaluate((id) => {
      const element = document.querySelector(`[data-testid="${id}"]`);
      return element?.getAttribute("aria-pressed") === "true";
    }, testId)
    .catch(() => false);
}

async function waitForPressed(page, testId, label) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await isPressed(page, testId)) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert(label, await isPressed(page, testId));
  await page.waitForTimeout(100);
}

async function waitForAnyPressed(page, testIds, label) {
  const deadline = Date.now() + 3000;
  let ready = false;
  while (Date.now() < deadline) {
    for (const testId of testIds) {
      ready = await isPressed(page, testId);
      if (ready) break;
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert(label, ready);
  await page.waitForTimeout(100);
}

async function isQuickBuildToolActive(page, id) {
  return page
    .locator('[data-testid="quick-build-toolbar"]')
    .first()
    .getAttribute("data-active-tool")
    .then((value) => value === id)
    .catch(() => false);
}

async function waitForQuickBuildToolActive(page, id, label) {
  const groupId = quickBuildToolGroups[id];
  const deadline = Date.now() + 3000;
  let ready = false;
  while (Date.now() < deadline) {
    ready = await isQuickBuildToolActive(page, id);
    if (!ready) ready = await isPressed(page, `quick-build-tool-${id}`);
    if (!ready && groupId) {
      ready = await isPressed(page, `quick-build-group-${groupId}`);
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert(label, ready);
  await page.waitForTimeout(100);
}

const quickBuildToolGroups = {
  ground: "terrain",
  sand: "terrain",
  stone: "terrain",
  farm: "terrain",
  path: "paths",
  water: "paths",
  bridge: "paths",
  fence: "paths",
  tree: "nature",
  bush: "nature",
  rock: "nature",
  house: "buildings",
  lamp: "buildings",
};

async function selectQuickBuildTool(page, id, label, options = {}) {
  const groupId = quickBuildToolGroups[id];
  if (groupId) {
    await clickControl(
      page.locator(`[data-testid="quick-build-group-${groupId}"]`).first(),
    );
  }
  const button = page.locator(`[data-testid="quick-build-tool-${id}"]`).first();
  await clickControl(button);
  if (options.assertReady === false) {
    await page.waitForTimeout(100);
    return;
  }
  await waitForQuickBuildToolActive(page, id, label);
}

async function selectQuickBuildVariant(page, groupId, testId, label) {
  await clickControl(
    page.locator(`[data-testid="quick-build-group-${groupId}"]`).first(),
  );
  const button = page.locator(`[data-testid="${testId}"]`).first();
  await clickControl(button);
  await waitForPressed(page, testId, label);
}

const planCadToolGroups = {
  wall: "structure",
  room: "structure",
  zone: "structure",
  door: "openings",
  window: "openings",
  part: "objects",
};

async function selectPlanCadTool(page, id, label) {
  const groupId = planCadToolGroups[id];
  if (groupId) {
    await clickControl(
      page.locator(`[data-testid="plan-cad-group-${groupId}"]`).first(),
    );
  }
  const button = page.locator(`[data-testid="plan-cad-tool-${id}"]`).first();
  await clickControl(button);
  await waitForPressed(page, `plan-cad-tool-${id}`, label);
}

async function assertToolbarButtonLayout(page, ids, label) {
  const issues = await page.evaluate((toolIds) => {
    const rects = [];
    const problems = [];
    for (const id of toolIds) {
      const button = document.querySelector(`[data-testid="${id}"]`);
      if (!button) {
        problems.push(`${id}: missing`);
        continue;
      }
      const rect = button.getBoundingClientRect();
      if (rect.width < 28 || rect.height < 28) {
        problems.push(`${id}: too-small ${rect.width}x${rect.height}`);
      }
      const labelSpan = Array.from(button.querySelectorAll("span")).find(
        (span) => span.textContent?.trim(),
      );
      if (labelSpan && labelSpan.scrollWidth > labelSpan.clientWidth + 1) {
        problems.push(`${id}: label-overflow ${labelSpan.textContent?.trim()}`);
      }
      rects.push({
        id,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      });
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const overlaps =
          a.left < b.right &&
          a.right > b.left &&
          a.top < b.bottom &&
          a.bottom > b.top;
        if (overlaps) problems.push(`${a.id}/${b.id}: overlap`);
      }
    }
    return problems;
  }, ids);
  assert(
    `${label} toolbar buttons fit without overlap`,
    issues.length === 0,
    issues.join("; "),
  );
}

async function assertToolbarLayoutViewportSweep(page, ids, label) {
  const originalViewport = page.viewportSize();
  for (const viewport of toolbarLayoutViewports) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(250);
    await assertToolbarButtonLayout(
      page,
      ids,
      `${label} ${viewport.width}x${viewport.height}`,
    );
  }
  if (originalViewport) {
    await page.setViewportSize(originalViewport);
    await page.waitForTimeout(250);
  }
}

async function planCadSceneCounts(page) {
  return page
    .evaluate(() => {
      const app = window.app || globalThis.app;
      const scene = app?.editor?.scene;
      const data = scene?.userData?.planCad;
      const counts = {
        wall: 0,
        slab: 0,
        zone: 0,
        item: 0,
        opening: 0,
        rootName: null,
        internalSceneObjects: 0,
      };
      if (!scene || !data?.nodes) return counts;

      for (const node of Object.values(data.nodes)) {
        if (node?.type === "wall") {
          counts.wall++;
          counts.opening += Array.isArray(node.openings)
            ? node.openings.length
            : 0;
        }
        if (node?.type === "slab") counts.slab++;
        if (node?.type === "zone") counts.zone++;
        if (node?.type === "item") counts.item++;
      }

      scene.traverse((object) => {
        if (object.userData?.isPlanCadRoot) counts.rootName = object.name;
        if (
          ["site", "building", "level"].includes(object.userData?.planNodeType)
        ) {
          counts.internalSceneObjects++;
        }
      });
      return counts;
    })
    .catch(() => ({
      wall: 0,
      slab: 0,
      zone: 0,
      item: 0,
      opening: 0,
      rootName: null,
      internalSceneObjects: 0,
    }));
}

async function waitForPlanCadCount(page, key, minimum, label) {
  const deadline = Date.now() + 10000;
  let counts = await planCadSceneCounts(page);
  while (Date.now() < deadline) {
    counts = await planCadSceneCounts(page);
    if ((counts[key] ?? 0) >= minimum) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert(
    label,
    (counts[key] ?? 0) >= minimum,
    `counts=${JSON.stringify(counts)}`,
  );
  return counts;
}

async function assertDesktopToolbarBounds(page, testId, label) {
  const rect = await page
    .locator(`[data-testid="${testId}"]`)
    .first()
    .boundingBox();
  const viewport = page.viewportSize();
  if (!rect || !viewport || viewport.width < 1180) return;
  const clearsLeftPanel = rect.x >= 260;
  const clearsRightPanel = rect.x + rect.width <= viewport.width - 270;
  assert(
    `${label} toolbar clears desktop side panels`,
    clearsLeftPanel && clearsRightPanel,
    `rect=${JSON.stringify(rect)}, viewport=${JSON.stringify(viewport)}`,
  );
}

async function assertQuickBuildLandscapeLane(page) {
  const viewport = page.viewportSize();
  if (!viewport || viewport.width > 960 || viewport.height > 600) return;

  const bounds = await page.evaluate(() => {
    const toolbar = document.querySelector('[data-testid="quick-build-toolbar"]');
    const leftPanel = document.querySelector('[aria-label="Project hierarchy and library"]');
    const actionBar = document.querySelector('[data-testid="editor-action-bar"]');
    const rect = (element) => {
      const value = element?.getBoundingClientRect();
      return value
        ? {left: value.left, right: value.right, top: value.top, bottom: value.bottom, height: value.height}
        : null;
    };
    return {toolbar: rect(toolbar), leftPanel: rect(leftPanel), actionBar: rect(actionBar)};
  });
  const toolbar = bounds.toolbar;
  const leftPanel = bounds.leftPanel;
  const actionBar = bounds.actionBar;
  const clearsLeft = !leftPanel || toolbar?.left >= leftPanel.right - 1;
  const clearsRight = !actionBar || toolbar?.right <= actionBar.left + 1;
  const compact = !!toolbar && toolbar.height <= viewport.height * 0.15;
  assert(
    "Quick Build landscape rail stays in the playable center lane",
    !!toolbar && clearsLeft && clearsRight && compact,
    JSON.stringify(bounds),
  );
}

async function selectPressed(page, testId, label) {
  const button = page.locator(`[data-testid="${testId}"]`).first();
  await clickControl(button);
  await waitForPressed(page, testId, label);
}

async function openCompactPanel(page, panel, targetOverride) {
  if (!mobileViewport) return;
  const testId = panel === "hierarchy"
    ? "topnav-toggle-hierarchy"
    : "topnav-toggle-inspector";
  const toggle = page.locator(`[data-testid="${testId}"]`).first();
  if (!(await toggle.isVisible().catch(() => false))) return;
  for (let attempt = 0; attempt < 2; attempt++) {
    if ((await toggle.getAttribute("aria-expanded")) === "true") break;
    await clickControl(toggle);
    await page.waitForTimeout(200);
  }
  const target = targetOverride || (panel === "hierarchy"
    ? '[data-testid="leftpanel-tab-project"]'
    : '[data-testid="cad-tools-toggle"]');
  await page.locator(target).first().waitFor({state: "visible", timeout: 5000}).catch(() => {});
  if (panel === "hierarchy") {
    await page.waitForFunction(() => {
      const element = document.querySelector('[aria-label="Project hierarchy and library"]');
      const rect = element?.getBoundingClientRect();
      return !!rect && rect.left >= -1 && rect.right > 0;
    }, undefined, {timeout: 5000});
  }
}

async function enableCadTools(page) {
  await openCompactPanel(page, "hierarchy");
  await clickControl(
    page.locator('[data-testid="leftpanel-tab-project"]').first(),
  );
  await clickControl(page.locator("text=Project Settings").first());
  await openCompactPanel(page, "inspector");
  const cadToggle = page.locator('[data-testid="cad-tools-toggle"]').first();
  const cadSwitch = page.locator('[data-testid="cad-tools-switch"]').first();
  const cadCheckbox = page
    .locator('[data-testid="cad-tools-switch"] input[type="checkbox"]')
    .first();
  assert(
    "CAD beta toggle visible",
    await cadToggle.isVisible().catch(() => false),
  );
  if (!(await cadCheckbox.isChecked().catch(() => false))) {
    await clickControl(cadSwitch);
  }
  await page.waitForTimeout(500);
  assert("CAD tools enabled", await cadCheckbox.isChecked().catch(() => false));
}

async function addCubeForActionbar(page) {
  await openCompactPanel(page, "hierarchy");
  await clickControl(
    page.locator('[data-testid="leftpanel-tab-library"]').first(),
  );
  await clickControl(page.locator('[data-testid="icon-item-cube"]').first());
  await page.waitForTimeout(1000);
}

async function openBimPlanFromCadMenu(page) {
  const cadToolsButton = page
    .locator('[data-testid="actionbar-cad-tools"]')
    .first();
  assert(
    "CAD tools actionbar menu button visible",
    await cadToolsButton.isVisible().catch(() => false),
  );
  await clickControl(cadToolsButton);
  const meshCadOption = page
    .locator('[data-testid="actionbar-mesh-cad"]')
    .first();
  const planCadOption = page
    .locator('[data-testid="actionbar-plan-cad"]')
    .first();
  assert(
    "Mesh CAD menu option visible",
    await meshCadOption.isVisible().catch(() => false),
  );
  assert(
    "BIM Plan menu option visible",
    await planCadOption.isVisible().catch(() => false),
  );
  await clickControl(planCadOption);
}

async function verifyMeshCadFromCadMenu(page) {
  const quickBuildClose = page.locator('[data-testid="quick-build-close"]').first();
  if (await quickBuildClose.isVisible().catch(() => false)) {
    await clickControl(quickBuildClose);
    await page.waitForTimeout(300);
  }
  if (await page.locator('[data-testid="quick-build-toolbar"]').first().isVisible().catch(() => false)) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(300);
  }
  const cadToolsButton = page
    .locator('[data-testid="actionbar-cad-tools"]')
    .first();
  await cadToolsButton.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  assert(
    "CAD tools actionbar menu button visible for Mesh CAD",
    await cadToolsButton.isVisible().catch(() => false),
  );
  await clickControl(cadToolsButton);
  const meshCadOption = page
    .locator('[data-testid="actionbar-mesh-cad"]')
    .first();
  assert(
    "Mesh CAD menu option visible for open",
    await meshCadOption.isVisible().catch(() => false),
  );
  await clickControl(meshCadOption);
  const meshClose = page.locator('[data-testid="mesh-cad-close"]').first();
  assert(
    "Mesh CAD toolbar opens",
    await meshClose.isVisible().catch(() => false),
  );
  await assertDesktopToolbarBounds(page, "mesh-cad-toolbar", "Mesh CAD");

  const mutation = await page.evaluate(async () => {
    const app = window.app || globalThis.app;
    const editor = app?.editor;
    if (!editor?.scene) return { ok: false, reason: "editor unavailable" };

    const isQuickBuildObject = (object) => {
      for (let current = object; current; current = current.parent) {
        if (
          current.userData?.quickBuild ||
          current.userData?.quickBuildPart ||
          current.userData?.quickBuildBake ||
          current.userData?.quickBuildLiveBatch ||
          current.name?.startsWith?.("Quick Build")
        ) {
          return true;
        }
      }
      return false;
    };
    const candidates = [];
    editor.scene.traverse((object) => {
      if (
        object?.isMesh &&
        object.visible !== false &&
        object.geometry?.getAttribute?.("position") &&
        object.userData?.isRuntimeOnly !== true &&
        !isQuickBuildObject(object)
      ) {
        candidates.push(object);
      }
    });
    let mesh =
      editor.selected?.isMesh && !isQuickBuildObject(editor.selected)
        ? editor.selected
        : null;
    if (!mesh) {
      mesh =
        candidates.find((object) =>
          /cube|box/i.test(`${object.name || ""} ${object.parent?.name || ""}`),
        ) ||
        candidates.find(
          (object) =>
            (object.geometry.getAttribute("position")?.count ?? 0) <= 500,
        ) ||
        candidates[0] ||
        null;
    }
    if (!mesh) return { ok: false, reason: "mesh unavailable" };

    editor.select?.(mesh, true);
    const beforeVertices = mesh.geometry.getAttribute("position")?.count ?? 0;
    const entered = editor.enterCADMode?.(mesh);
    editor.setCADSelectionMode?.("face");
    const getEntries = (collection) => {
      if (Array.isArray(collection)) return collection;
      if (collection instanceof Map) return Array.from(collection.entries());
      if (collection && typeof collection === "object") {
        return Object.entries(collection);
      }
      return [];
    };
    const getFirstId = (collection) => {
      const entry = getEntries(collection)[0];
      if (!entry) return undefined;
      return Number(entry[0]);
    };
    const getEdgeIds = () => {
      const entries = getEntries(mesh.userData?.meshData?.edges);
      return entries
        .map(([id, edge]) => {
          const faceCount = Array.isArray(edge?.faceIds)
            ? edge.faceIds.length
            : edge?.faceIds?.size ?? 0;
          return { id: Number(id), faceCount };
        })
        .filter(({ id }) => Number.isFinite(id))
        .sort((a, b) => {
          const aBevelable = a.faceCount > 0 && a.faceCount <= 2;
          const bBevelable = b.faceCount > 0 && b.faceCount <= 2;
          if (aBevelable !== bBevelable) return aBevelable ? -1 : 1;
          return a.id - b.id;
        })
        .map(({ id }) => id);
    };
    const selectEdge = (edgeId) => {
      if (typeof edgeId !== "number" || Number.isNaN(edgeId)) return false;
      editor.setCADSelectionMode?.("edge");
      editor.cadController.selectedEdgeIds.clear();
      editor.cadController.selectedEdgeIds.add(edgeId);
      return true;
    };
    const selectFirstEdge = () => {
      const edgeId = getEdgeIds()[0];
      return selectEdge(edgeId);
    };
    const applyFirstSuccessfulEdgeBevel = () => {
      const edgeIds = getEdgeIds();
      for (const edgeId of edgeIds) {
        if (!selectEdge(edgeId)) continue;
        if (editor.applyCADEdgeBevel?.(0.025, 1, "flat") === true) {
          return { applied: true, attempts: edgeIds.indexOf(edgeId) + 1, edgeId };
        }
      }
      return { applied: false, attempts: edgeIds.length, edgeId: null };
    };
    const getFirstFaceId = () => {
      return getFirstId(mesh.userData?.meshData?.faces);
    };
    const selectFirstFace = () => {
      const faceId = getFirstFaceId();
      if (typeof faceId !== "number" || Number.isNaN(faceId)) return false;
      editor.setCADSelectionMode?.("face");
      editor.cadController.selectedFaceIds.clear();
      editor.cadController.selectedFaceIds.add(faceId);
      return true;
    };

    if (!selectFirstFace()) {
      return { ok: false, reason: "face id unavailable", beforeVertices };
    }

    editor.setCADTool?.("extrude");
    const applied = editor.applyCADExtrude?.(0.25);

    const insetReady = selectFirstFace();
    editor.setCADTool?.("inset");
    const insetApplied = insetReady && editor.applyCADInset?.(0.04) === true;

    const faceBevelReady = selectFirstFace();
    editor.setCADTool?.("bevel");
    const faceBevelApplied =
      faceBevelReady && editor.applyCADBevel?.(0.035) === true;

    editor.setCADAxisConstraint?.(["x"]);
    const axisApplied =
      Array.isArray(editor.cadAxisConstraint) &&
      editor.cadAxisConstraint.length === 1 &&
      editor.cadAxisConstraint[0] === "x";

    const edgeReady = selectFirstEdge();
    const edgeLengthBefore = edgeReady
      ? editor.cadController.getSelectedEdgeLength?.()
      : null;
    const edgeLengthApplied =
      edgeReady &&
      Number.isFinite(edgeLengthBefore) &&
      editor.applyCADEdgeLength?.(edgeLengthBefore * 1.05) === true;

    const edgeBevel = applyFirstSuccessfulEdgeBevel();
    const edgeBevelApplied = edgeBevel.applied;

    const deadline = Date.now() + 3000;
    let afterVertices = beforeVertices;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      afterVertices = mesh.geometry.getAttribute("position")?.count ?? 0;
      if (afterVertices !== beforeVertices) break;
    }

    editor.exitCADMode?.();
    return {
      ok:
        entered !== false &&
        applied === true &&
        insetApplied === true &&
        faceBevelApplied === true &&
        axisApplied === true &&
        edgeLengthApplied === true &&
        edgeBevelApplied === true &&
        afterVertices !== beforeVertices,
      beforeVertices,
      afterVertices,
      meshName: mesh.name,
      insetApplied,
      faceBevelApplied,
      axisApplied,
      edgeLengthApplied,
      edgeBevelApplied,
      edgeBevelAttempts: edgeBevel.attempts,
      edgeBevelEdgeId: edgeBevel.edgeId,
    };
  });
  assert(
    "Mesh CAD edit operations mutate selected mesh geometry",
    mutation?.ok === true,
    JSON.stringify(mutation),
  );

  await clickControl(meshClose);
  await meshClose.waitFor({state: "hidden", timeout: 2000}).catch(() => {});
  assert(
    "Mesh CAD toolbar closes",
    !(await page.locator('[data-testid="mesh-cad-toolbar"]').first().isVisible().catch(() => false)),
  );
}

const browser = await chromium.launch({ headless: !headed });
const page = await (
  await browser.newContext({ viewport, isMobile: mobileViewport, hasTouch: mobileViewport })
).newPage();

page.on("console", (m) => {
  if (m.type() === "error")
    report.consoleErrors.push({ text: m.text(), location: m.location() });
});
page.on("pageerror", (e) =>
  report.pageErrors.push({
    message: e.message,
    stack: e.stack?.slice(0, 2000),
  }),
);
page.on("requestfailed", (r) => {
  const failure = r.failure()?.errorText;
  if (failure === "net::ERR_ABORTED") return;
  report.failedRequests.push({
    url: r.url(),
    method: r.method(),
    failure,
  });
});
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
  await page
    .waitForLoadState("networkidle", { timeout: 15000 })
    .catch(() => {});
  await dismissBootstrap(page);
  await page.waitForTimeout(8000);
  await dismissTutorial(page);

  const canvas = page.locator("canvas").first();
  assert("editor canvas visible", await canvas.isVisible().catch(() => false));

  await enableCadTools(page);
  await addCubeForActionbar(page);

  const quickBuildButton = page
    .locator('[data-testid="actionbar-quick-build"]')
    .first();
  assert(
    "Quick Build actionbar button visible",
    await quickBuildButton.isVisible().catch(() => false),
  );

  await clickControl(quickBuildButton);
  await page
    .locator('[data-testid="quick-build-toolbar"]')
    .first()
    .waitFor({ timeout: 5000 });
  await assertDesktopToolbarBounds(page, "quick-build-toolbar", "Quick Build");
  await assertQuickBuildLandscapeLane(page);
  const textureState = await page
    .waitForFunction(
      () => {
        const select = document.querySelector(
          '[data-testid="quick-build-texture-preset"]',
        );
        const image = document.querySelector(
          '[data-testid="quick-build-texture-preview-image"]',
        );
        if (!(select instanceof HTMLSelectElement)) return null;
        if (select.disabled || !select.value) return null;
        const src = image?.getAttribute("src") || "";
        return src ? { value: select.value, src } : null;
      },
      null,
      { timeout: 10000 },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => null);
  assert(
    "Quick Build default texture selected",
    !!textureState?.value,
    JSON.stringify(textureState),
  );
  assert(
    "Quick Build texture preview visible",
    !!textureState?.src,
    JSON.stringify(textureState),
  );
  if (mobileViewport) {
    const utilityToggle = page
      .locator('[data-testid="quick-build-utilities-toggle"]')
      .first();
    assert(
      "Quick Build compact utilities toggle visible",
      await utilityToggle.isVisible().catch(() => false),
    );
    await clickControl(utilityToggle);
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="quick-build-utilities-toggle"]')
          ?.getAttribute("aria-expanded") === "true",
      null,
      { timeout: 3000 },
    );
    assert(
      "Quick Build compact utilities drawer opens",
      await utilityToggle.getAttribute("aria-expanded").then((value) => value === "true"),
    );
    const compactPrimaryBounds = await page.evaluate(() => {
      const toolbar = document.querySelector('[data-testid="quick-build-toolbar"]')?.getBoundingClientRect();
      const ids = [
        "quick-build-tool-select",
        "quick-build-tool-erase",
        "quick-build-group-terrain",
        "quick-build-group-paths",
        "quick-build-group-nature",
        "quick-build-group-buildings",
        "quick-build-utilities-toggle",
      ];
      const controls = ids.map((id) => {
        const rect = document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
        return rect ? {id, left: rect.left, right: rect.right} : null;
      }).filter(Boolean);
      return toolbar ? {
        toolbar: {left: toolbar.left, right: toolbar.right},
        controls,
      } : null;
    });
    const primaryFitsLane = !!compactPrimaryBounds && compactPrimaryBounds.controls.every(
      (control) => control.left >= compactPrimaryBounds.toolbar.left - 1 &&
        control.right <= compactPrimaryBounds.toolbar.right + 1,
    );
    assert(
      "Quick Build compact primary controls stay inside the playable lane",
      primaryFitsLane,
      JSON.stringify(compactPrimaryBounds),
    );
    await page
      .screenshot({path: resolve(outDir, "01-quick-build-utilities-open.png")})
      .catch(() => {});
  }
  const quickToolIds = [
    "select",
    "erase",
    "ground",
    "sand",
    "stone",
    "path",
    "water",
    "bridge",
    "farm",
    "fence",
    "tree",
    "bush",
    "rock",
    "house",
    "lamp",
  ];
  const quickVisibleIds = [
    "quick-build-tool-select",
    "quick-build-tool-erase",
    "quick-build-group-terrain",
    "quick-build-group-paths",
    "quick-build-group-nature",
    "quick-build-group-buildings",
  ];
  for (const id of quickVisibleIds) {
    assert(
      `Quick Build ${id} visible`,
      await page
        .locator(`[data-testid="${id}"]`)
        .first()
        .isVisible()
        .catch(() => false),
    );
  }
  await assertToolbarButtonLayout(page, quickVisibleIds, "Quick Build");
  await assertToolbarLayoutViewportSweep(page, quickVisibleIds, "Quick Build");
  for (const id of quickToolIds) {
    await selectQuickBuildTool(page, id, `Quick Build ${id} selects`);
  }
  for (const [groupId, testId, label] of [
    [
      "paths",
      "quick-build-tool-path-street",
      "Quick Build street variant selects",
    ],
    [
      "paths",
      "quick-build-tool-path-cobble",
      "Quick Build cobble variant selects",
    ],
    [
      "nature",
      "quick-build-tool-bush-hedge",
      "Quick Build hedge variant selects",
    ],
    [
      "nature",
      "quick-build-tool-bush-flowering",
      "Quick Build flowering shrub variant selects",
    ],
    [
      "buildings",
      "quick-build-tool-house-cabin",
      "Quick Build cabin variant selects",
    ],
    [
      "buildings",
      "quick-build-tool-house-townhouse",
      "Quick Build townhouse variant selects",
    ],
  ]) {
    await selectQuickBuildVariant(page, groupId, testId, label);
  }

  for (const id of ["single", "radius", "line", "rectangle"]) {
    const button = page
      .locator(`[data-testid="quick-build-brush-${id}"]`)
      .first();
    assert(
      `Quick Build ${id} brush visible`,
      await button.isVisible().catch(() => false),
    );
    await selectPressed(
      page,
      `quick-build-brush-${id}`,
      `Quick Build ${id} brush selects`,
    );
  }
  await selectPressed(
    page,
    "quick-build-brush-single",
    "Quick Build single brush reselects",
  );

  if (mobileViewport) {
    const utilityToggle = page
      .locator('[data-testid="quick-build-utilities-toggle"]')
      .first();
    await clickControl(utilityToggle);
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="quick-build-utilities-toggle"]')
          ?.getAttribute("aria-expanded") === "false",
      null,
      { timeout: 3000 },
    );
    await dispatchPlanViewportMove(page, 0.5, 0.5);
    const status = page.locator('[data-testid="quick-build-placement-status"]').first();
    const statusBox = await status.boundingBox().catch(() => null);
    assert(
      "Quick Build placement status is visible on landscape preview",
      !!statusBox && statusBox.width > 0 && statusBox.height > 0,
      `${JSON.stringify(statusBox)} ${await status.textContent().catch(() => "")}`,
    );
    await page.screenshot({path: resolve(outDir, "01-quick-build-placement-status.png")}).catch(() => {});
  }

  const stampPositions = mobileViewport
    ? [
        ["ground", 0.46, 0.18],
        ["sand", 0.51, 0.18],
        ["stone", 0.56, 0.18],
        ["path", 0.61, 0.18],
        ["water", 0.66, 0.18],
        ["bridge", 0.71, 0.18],
        ["farm", 0.76, 0.18],
        ["fence", 0.81, 0.18],
        ["tree", 0.51, 0.18],
        ["bush", 0.56, 0.18],
        ["rock", 0.61, 0.18],
        ["house", 0.76, 0.18],
        ["lamp", 0.84, 0.18],
      ]
    : [
        ["ground", 0.28, 0.42],
        ["sand", 0.34, 0.42],
        ["stone", 0.4, 0.42],
        ["path", 0.46, 0.42],
        ["water", 0.52, 0.42],
        ["bridge", 0.58, 0.42],
        ["farm", 0.64, 0.42],
        ["fence", 0.7, 0.42],
        ["tree", 0.34, 0.56],
        ["bush", 0.4, 0.56],
        ["rock", 0.46, 0.56],
        ["house", 0.76, 0.62],
        ["lamp", 0.84, 0.62],
      ];
  let expectedQuickObjects = 0;
  for (const [id, relX, relY] of stampPositions) {
    await selectQuickBuildTool(
      page,
      id,
      `Quick Build ${id} ready for placement`,
      {
        assertReady: false,
      },
    );
    await clickCanvas(page, canvas, relX, relY);
    expectedQuickObjects++;
    await waitForQuickBuildSceneCount(
      page,
      expectedQuickObjects,
      `Quick Build ${id} creates visible object`,
    );
  }
  await page
    .screenshot({ path: resolve(outDir, "01-quick-build.png") })
    .catch(() => {});

  if (process.env.QUICK_BUILD_ONLY !== "1") {
    await verifyMeshCadFromCadMenu(page);
    await openBimPlanFromCadMenu(page);
    await page
      .locator('[data-testid="plan-cad-toolbar"]')
      .first()
      .waitFor({ timeout: 5000 });
    await assertDesktopToolbarBounds(page, "plan-cad-toolbar", "BIM Plan");
    const planToolIds = [
      "select",
      "wall",
      "room",
      "zone",
      "door",
      "window",
      "part",
    ];
    const planVisibleIds = [
      "plan-cad-tool-select",
      "plan-cad-group-structure",
      "plan-cad-group-openings",
      "plan-cad-group-objects",
      "plan-cad-interchange",
    ];
    for (const id of planVisibleIds) {
      assert(
        `BIM Plan ${id} visible`,
        await page
          .locator(`[data-testid="${id}"]`)
          .first()
          .isVisible()
          .catch(() => false),
      );
    }
    await assertToolbarButtonLayout(page, planVisibleIds, "BIM Plan");
    await assertToolbarLayoutViewportSweep(page, planVisibleIds, "BIM Plan");
    for (const id of planToolIds) {
      await selectPlanCadTool(page, id, `BIM Plan ${id} selects`);
    }

    const planWallY = mobileViewport ? 0.82 : 0.56;
    const planWallX1 = mobileViewport ? 0.52 : 0.38;
    const planWallX2 = mobileViewport ? 0.72 : 0.62;
    await selectPlanCadTool(page, "wall", "BIM Plan wall ready for placement");
    if (mobileViewport) await dispatchPlanViewportClick(page, planWallX1, planWallY);
    else await clickCanvas(page, canvas, planWallX1, planWallY);
    {
      const box = await getCanvasBox(page);
      if (box) {
        if (mobileViewport) await dispatchPlanViewportMove(page, planWallX2, planWallY);
        else await page.mouse.move(box.x + box.width * planWallX2, box.y + box.height * planWallY);
        const measurement = page
          .locator('[data-testid="plan-cad-measurement"]')
          .first();
        await measurement.waitFor({ timeout: 3000 }).catch(() => {});
        const measurementText = await measurement.innerText().catch(() => "");
        assert(
          "BIM Plan wall shows live measurement while drafting",
          /\bLength\b.*\bm\b/.test(measurementText) &&
            /\bAngle\b/.test(measurementText),
          JSON.stringify(measurementText),
        );
      }
    }
    if (mobileViewport) await dispatchPlanViewportClick(page, planWallX2, planWallY);
    else await clickCanvas(page, canvas, planWallX2, planWallY);
    const wallCounts = await waitForPlanCadCount(
      page,
      "wall",
      1,
      "BIM Plan wall creates visible model",
    );
    assert(
      "BIM Plan root is named clearly",
      wallCounts.rootName === "BIM Plan",
      JSON.stringify(wallCounts),
    );
    assert(
      "BIM Plan hides semantic scene containers",
      wallCounts.internalSceneObjects === 0,
      JSON.stringify(wallCounts),
    );
    const bimProperties = page
      .locator('[data-testid="plan-cad-properties"]')
      .first();
    if (mobileViewport) {
      await page.waitForTimeout(500);
      await openCompactPanel(page, "inspector", 'aside[aria-label="Inspector"]');
      await page.waitForTimeout(250);
    }
    assert(
      "BIM properties panel visible after wall",
      (await bimProperties.isVisible().catch(() => false)) &&
        /(BIM|Wall)/.test(await bimProperties.innerText().catch(() => "")) &&
        /Height/.test(await bimProperties.innerText().catch(() => "")),
    );
    if (mobileViewport) {
      const inspectorToggle = page.locator('[data-testid="topnav-toggle-inspector"]').first();
      if ((await inspectorToggle.getAttribute("aria-expanded")) === "true") {
        await clickControl(inspectorToggle);
        await page.waitForTimeout(250);
      }
      // The save confirmation toast occupies the lower-right compact canvas
      // for its 2.5s lifetime. Let it dismiss before polygon/part placement so
      // pointer events reach the viewport instead of the toast surface.
      await page.mouse.move(100, 100);
      await page.waitForTimeout(2800);
      await dismissSceneSavedToast(page);
    }

    await selectPlanCadTool(page, "door", "BIM Plan door ready for placement");
    {
      const box = await getCanvasBox(page);
      if (box) {
        await page.mouse.move(
          box.x + box.width * (mobileViewport ? 0.58 : 0.48),
          box.y + box.height * planWallY,
        );
        const measurementText = await page
          .locator('[data-testid="plan-cad-measurement"]')
          .first()
          .innerText()
          .catch(() => "");
        assert(
          "BIM Plan door shows wall target before placement",
          /\bDoor on wall\b/.test(measurementText),
          JSON.stringify(measurementText),
        );
      }
    }
    if (mobileViewport) await dispatchPlanViewportClick(page, 0.58, planWallY);
    else await clickCanvas(page, canvas, 0.48, planWallY);
    await waitForPlanCadCount(
      page,
      "opening",
      1,
      "BIM Plan door creates opening",
    );

    await selectPlanCadTool(
      page,
      "window",
      "BIM Plan window ready for placement",
    );
    if (mobileViewport) await dispatchPlanViewportClick(page, 0.62, planWallY);
    else await clickCanvas(page, canvas, 0.54, planWallY);
    await waitForPlanCadCount(
      page,
      "opening",
      2,
      "BIM Plan window creates opening",
    );
    if (mobileViewport) {
      await page.mouse.move(100, 100);
      await page.waitForTimeout(2800);
    }
    if (mobileViewport) await dismissSceneSavedToast(page);

    await selectPlanCadTool(page, "room", "BIM Plan room ready for placement");
    if (mobileViewport) await dismissSceneSavedToast(page);
    const roomPoints = mobileViewport ? [
      [0.46, 0.82],
      [0.70, 0.82],
      [0.70, 0.92],
      [0.46, 0.92],
    ] : [
      [0.34, 0.42],
      [0.46, 0.42],
      [0.46, 0.52],
      [0.34, 0.52],
    ];
    for (const [relX, relY] of roomPoints) {
      if (mobileViewport) await dispatchPlanViewportClick(page, relX, relY);
      else await clickCanvas(page, canvas, relX, relY);
    }
    await page
      .locator('[data-testid="plan-cad-finish-polygon"]')
      .first()
      .dispatchEvent("click");
    await waitForPlanCadCount(
      page,
      "slab",
      1,
      "BIM Plan room polygon creates room",
    );

    await selectPlanCadTool(page, "zone", "BIM Plan zone ready for placement");
    const zonePoints = mobileViewport ? [
      [0.72, 0.82],
      [0.90, 0.82],
      [0.90, 0.92],
      [0.72, 0.92],
    ] : [
      [0.54, 0.42],
      [0.66, 0.42],
      [0.66, 0.52],
      [0.54, 0.52],
    ];
    for (const [relX, relY] of zonePoints) {
      if (mobileViewport) await dispatchPlanViewportClick(page, relX, relY);
      else await clickCanvas(page, canvas, relX, relY);
    }
    await page
      .locator('[data-testid="plan-cad-finish-polygon"]')
      .first()
      .dispatchEvent("click");
    await waitForPlanCadCount(
      page,
      "zone",
      1,
      "BIM Plan zone polygon creates zone",
    );
    if (mobileViewport) {
      await page.mouse.move(100, 100);
      await page.waitForTimeout(2800);
    }
    if (mobileViewport) await dismissSceneSavedToast(page);

    await selectPlanCadTool(
      page,
      "part",
      "BIM Plan object ready for placement",
    );
    {
      const box = await getCanvasBox(page);
      if (box) {
        await page.mouse.move(
          box.x + box.width * 0.72,
          box.y + box.height * (mobileViewport ? 0.84 : 0.56),
        );
        const measurementText = await page
          .locator('[data-testid="plan-cad-measurement"]')
          .first()
          .innerText()
          .catch(() => "");
        assert(
          "BIM Plan object shows footprint feedback before placement",
          /\bObject placement\b/.test(measurementText),
          JSON.stringify(measurementText),
        );
      }
    }
    if (mobileViewport) await dispatchPlanViewportClick(page, 0.72, 0.84);
    else await clickCanvas(page, canvas, 0.72, 0.56);
    await waitForPlanCadCount(
      page,
      "item",
      1,
      "BIM Plan object creates BIM item",
    );
    const partModel = await page.evaluate(() => {
      const app = window.app || globalThis.app;
      const scene = app?.editor?.scene;
      if (!scene) return null;
      let result = null;
      scene.traverse((object) => {
        if (result || object.userData?.planNodeType !== "item") return;
        result = {
          name: object.name,
          childCount: object.children.length,
          childNames: object.children.map((child) => child.name),
          source: object.userData?.planCad?.source ?? null,
        };
      });
      return result;
    });
    assert(
      "BIM Plan object creates procedural model children",
      partModel?.childCount > 1 && partModel?.source?.type === "procedural",
      JSON.stringify(partModel),
    );
    await page
      .screenshot({ path: resolve(outDir, "02-plan-cad.png") })
      .catch(() => {});
  }
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
  await page
    .screenshot({ path: resolve(outDir, "final.png"), fullPage: true })
    .catch(() => {});
  await browser.close();
}

if (failures.length) {
  console.error(`\nFAILED: ${failures.length} assertion(s)`);
  process.exit(1);
}

console.log("\noss builder tools ux smoke: PASS");
