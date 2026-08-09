#!/usr/bin/env node
/**
 * OSS Plan/CAD editor smoke.
 *
 * Drives the real editor route and canvas click stack:
 *   1. Open /create/project and dismiss the OSS storage bootstrap if present.
 *   2. Enable CAD Tools (beta) from Project Settings.
 *   3. Add a cube so the sandbox actionbar is visible.
 *   4. Open Plan/CAD from the actionbar.
 *   5. Use the Wall tool and click the canvas twice.
 *   6. Assert a Plan/CAD model exists, BIM properties appear, and no local API
 *      request failed.
 *
 * Requires a running OSS dev server. Set PLAYWRIGHT_BASE_URL if not using :5173.
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "oss-plan-cad-smoke-output");
mkdirSync(outDir, { recursive: true });

const baseUrl = (
  process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5173"
).replace(/\/$/, "");
const headed = process.env.HEADED === "1";
const report = {
  baseUrl,
  startedAt: new Date().toISOString(),
  steps: [],
  assertions: {},
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
};
const failures = [];

function logStep(name, status = "ok", details = {}) {
  report.steps.push({ name, status, details, t: new Date().toISOString() });
  console.log(
    `${status === "ok" ? "✓" : "✗"} ${name}${Object.keys(details).length ? ` — ${JSON.stringify(details)}` : ""}`,
  );
}

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
    logStep("bootstrap modal dismissed");
  }
}

async function dismissTutorial(page) {
  const gotIt = page.locator('button:has-text("Got It")').first();
  if ((await gotIt.count()) && (await gotIt.isVisible().catch(() => false))) {
    await gotIt.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(300);
    logStep("tutorial dismissed");
  }
}

async function openBimPlanFromCadMenu(page) {
  const cadToolsButton = page
    .locator('[data-testid="actionbar-cad-tools"]')
    .first();
  assert(
    "CAD tools actionbar menu button visible",
    await cadToolsButton.isVisible().catch(() => false),
  );
  await clickLocatorOrDom(cadToolsButton);
  const planCadOption = page
    .locator('[data-testid="actionbar-plan-cad"]')
    .first();
  assert(
    "BIM Plan menu option visible",
    await planCadOption.isVisible().catch(() => false),
  );
  await clickLocatorOrDom(planCadOption);
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

async function selectPlanCadTool(page, id) {
  const shortcuts = {
    select: "v",
    wall: "1",
    room: "2",
    zone: "3",
    door: "4",
    window: "5",
    part: "6",
  };
  const shortcut = shortcuts[id];
  if (!shortcut) throw new Error(`No BIM Plan shortcut for ${id}`);
  await page.keyboard.press(shortcut);
  await page.waitForFunction(
    (toolId) =>
      [...document.querySelectorAll(`[data-testid="plan-cad-tool-${toolId}"]`)]
        .some((element) => element.getAttribute("aria-pressed") === "true"),
    id,
    { timeout: 5000 },
  );
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
        generatedWallObjects: 0,
        internalSceneObjects: 0,
      };
      if (!scene) return counts;

      if (data?.nodes) {
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
      }

      scene.traverse((object) => {
        if (object.userData?.isPlanCadRoot) counts.rootName = object.name;
        if (object.userData?.planNodeType === "wall")
          counts.generatedWallObjects++;
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
      generatedWallObjects: 0,
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

async function waitForNoPlanCadData(page, label) {
  const deadline = Date.now() + 10000;
  let counts = await planCadSceneCounts(page);
  while (Date.now() < deadline) {
    counts = await planCadSceneCounts(page);
    if (
      !counts.rootName &&
      counts.wall === 0 &&
      counts.slab === 0 &&
      counts.zone === 0 &&
      counts.item === 0 &&
      counts.generatedWallObjects === 0
    ) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const cleared =
    !counts.rootName &&
    counts.wall === 0 &&
    counts.slab === 0 &&
    counts.zone === 0 &&
    counts.item === 0 &&
    counts.generatedWallObjects === 0;
  assert(label, cleared, `counts=${JSON.stringify(counts)}`);
  return counts;
}

async function clickLocatorOrDom(locator, timeout = 5000) {
  const visible = await locator
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
  if (!visible) {
    await locator.click({ timeout, force: true, noWaitAfter: true });
    return;
  }
  const clicked = await locator
    .evaluate((element) => {
      if (!(element instanceof HTMLElement)) return;
      element.scrollIntoView({ block: "center", inline: "center" });
      const rect = element.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;
      for (const eventName of [
        "pointerdown",
        "mousedown",
        "pointerup",
        "mouseup",
        "click",
      ]) {
        const EventCtor = eventName.startsWith("pointer")
          ? window.PointerEvent
          : window.MouseEvent;
        element.dispatchEvent(
          new EventCtor(eventName, {
            bubbles: true,
            cancelable: true,
            button: 0,
            buttons: eventName.endsWith("down") ? 1 : 0,
            clientX,
            clientY,
          }),
        );
      }
      return true;
    })
    .catch(() => false);
  if (clicked) {
    return;
  }
  await locator.click({ timeout, force: true, noWaitAfter: true });
}

async function dispatchTreeContextMenu(locator, timeout = 5000) {
  const handle = await locator.elementHandle({ timeout });
  if (!handle) throw new Error("Tree row handle unavailable");
  await handle.evaluate((element) => {
    if (!(element instanceof HTMLElement)) return;
    const rect = element.getBoundingClientRect();
    const clientX = rect.left + Math.min(24, rect.width / 2);
    const clientY = rect.top + rect.height / 2;
    element.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX,
        clientY,
      }),
    );
    element.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        buttons: 2,
        clientX,
        clientY,
      }),
    );
  });
}

const browser = await chromium.launch({ headless: !headed });
const page = await (
  await browser.newContext({ viewport: { width: 1440, height: 900 } })
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
  await page
    .waitForLoadState("networkidle", { timeout: 15000 })
    .catch(() => {});
  await dismissBootstrap(page);
  await page.waitForTimeout(8000);
  await dismissTutorial(page);
  await page
    .screenshot({ path: resolve(outDir, "01-editor.png") })
    .catch(() => {});

  const canvas = page.locator("canvas").first();
  assert("editor canvas visible", await canvas.isVisible().catch(() => false));

  await clickLocatorOrDom(
    page.locator('[data-testid="leftpanel-tab-project"]').first(),
  );
  await clickLocatorOrDom(page.locator("text=Project Settings").first());
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
    await clickLocatorOrDom(cadSwitch);
  }
  await page.waitForTimeout(500);
  assert(
    "CAD tools switch checked",
    await cadCheckbox.isChecked().catch(() => false),
  );
  logStep("CAD tools enabled");

  await clickLocatorOrDom(
    page.locator('[data-testid="leftpanel-tab-library"]').first(),
  );
  await clickLocatorOrDom(
    page.locator('[data-testid="icon-item-cube"]').first(),
  );
  await page.waitForTimeout(1000);
  logStep("cube added to reveal actionbar");

  await openBimPlanFromCadMenu(page);
  await page
    .locator('[data-testid="plan-cad-toolbar"]')
    .first()
    .waitFor({ timeout: 5000 });
  assert(
    "BIM Plan structure group visible",
    await page
      .locator('[data-testid="plan-cad-group-structure"]')
      .first()
      .isVisible()
      .catch(() => false),
  );
  assert(
    "BIM Plan openings group visible",
    await page
      .locator('[data-testid="plan-cad-group-openings"]')
      .first()
      .isVisible()
      .catch(() => false),
  );
  assert(
    "BIM Plan objects group visible",
    await page
      .locator('[data-testid="plan-cad-group-objects"]')
      .first()
      .isVisible()
      .catch(() => false),
  );
  await assertToolbarButtonLayout(
    page,
    [
      "plan-cad-tool-select",
      "plan-cad-group-structure",
      "plan-cad-group-openings",
      "plan-cad-group-objects",
      "plan-cad-interchange",
    ],
    "BIM Plan",
  );
  await selectPlanCadTool(page, "wall");
  await page.waitForTimeout(300);

  const box = await canvas.boundingBox();
  assert("canvas has bounds", !!box, JSON.stringify(box));
  if (box) {
    const firstPoint = {
      x: box.x + box.width * 0.42,
      y: box.y + box.height * 0.55,
    };
    const secondPoint = {
      x: box.x + box.width * 0.58,
      y: box.y + box.height * 0.55,
    };
    await page.mouse.move(firstPoint.x, firstPoint.y);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.up();
    await page.waitForTimeout(600);
    await page.mouse.move(secondPoint.x, secondPoint.y, { steps: 8 });
    await page.waitForTimeout(120);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.up();
    await page.waitForTimeout(1200);
  }
  await page
    .screenshot({ path: resolve(outDir, "02-plan-cad-wall.png") })
    .catch(() => {});

  const bimProperties = page
    .locator('[data-testid="plan-cad-properties"]')
    .first();
  assert(
    "BIM properties visible after wall creation",
    (await bimProperties.isVisible().catch(() => false)) &&
      /Wall|BIM/.test(await bimProperties.innerText().catch(() => "")) &&
      /Height/.test(await bimProperties.innerText().catch(() => "")),
  );

  const counts = await waitForPlanCadCount(
    page,
    "wall",
    1,
    "BIM Plan wall node created",
  );
  assert(
    "BIM Plan root is named clearly",
    counts.rootName === "BIM Plan",
    JSON.stringify(counts),
  );
  assert(
    "BIM Plan hides semantic scene containers",
    counts.internalSceneObjects === 0,
    JSON.stringify(counts),
  );
  const wallTextureSummary = await page.evaluate(() => {
    const app = window.app || globalThis.app;
    const scene = app?.editor?.scene;
    const summary = { wallMeshes: 0, texturedWallMeshes: 0, textureNames: [] };
    scene?.traverse((object) => {
      if (object.userData?.planNodeType !== "wall") return;
      object.traverse((child) => {
        if (!child.isMesh) return;
        summary.wallMeshes++;
        const map = Array.isArray(child.material)
          ? child.material.find((material) => material?.map)?.map
          : child.material?.map;
        if (map) {
          summary.texturedWallMeshes++;
          summary.textureNames.push(map.name ?? "");
        }
      });
    });
    return summary;
  });
  assert(
    "BIM Plan wall uses BIM texture map",
    wallTextureSummary.texturedWallMeshes > 0,
    JSON.stringify(wallTextureSummary),
  );

  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+Z" : "Control+Z",
  );
  await page.waitForTimeout(600);
  const undoCounts = await planCadSceneCounts(page);
  assert(
    "BIM Plan undo removes wall data and generated geometry",
    undoCounts.wall === 0 && undoCounts.generatedWallObjects === 0,
    JSON.stringify(undoCounts),
  );

  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+Shift+Z" : "Control+Y",
  );
  await page.waitForTimeout(800);
  const redoCounts = await waitForPlanCadCount(
    page,
    "wall",
    1,
    "BIM Plan redo restores wall data and generated geometry",
  );
  assert(
    "BIM Plan redo restores generated wall geometry",
    redoCounts.generatedWallObjects >= 1,
    JSON.stringify(redoCounts),
  );
  assert(
    "BIM Plan redo keeps root metadata valid",
    redoCounts.rootName === "BIM Plan",
    JSON.stringify(redoCounts),
  );

  const rootUuid = await page.evaluate(() => {
    const app = window.app || globalThis.app;
    const scene = app?.editor?.scene;
    let uuid = null;
    scene?.traverse((object) => {
      if (!uuid && object.userData?.isPlanCadRoot) uuid = object.uuid;
    });
    return uuid;
  });
  assert("BIM Plan root uuid available for outliner delete", !!rootUuid);

  await clickLocatorOrDom(
    page.locator('[data-testid="leftpanel-tab-project"]').first(),
  );
  const rootTreeItem = page.locator(`li[value="${rootUuid}"]`).first();
  assert(
    "BIM Plan root visible in project outliner",
    await rootTreeItem.isVisible().catch(() => false),
  );
  await page.evaluate(() => {
    const app = window.app || globalThis.app;
    globalThis.__PLAN_CAD_DELETE_TRACE__ = [];
    const trace = globalThis.__PLAN_CAD_DELETE_TRACE__;
    if (!app?.editor || app.__planCadDeleteTraceInstalled) return;
    app.__planCadDeleteTraceInstalled = true;
    const planSummary = (object) => ({
      isPlanCadRoot: object?.userData?.isPlanCadRoot === true,
      isPlanCadManaged: object?.userData?.isPlanCadManaged === true,
      planNodeId: object?.userData?.planNodeId ?? null,
      planNodeType: object?.userData?.planNodeType ?? null,
      planCadNodeCount: object?.userData?.planCad?.nodeCount ?? null,
    });
    const originalRemoveObject = app.editor.removeObject?.bind(app.editor);
    if (originalRemoveObject) {
      app.editor.removeObject = (object) => {
        trace.push({
          event: "editor.removeObject",
          name: object?.name,
          type: object?.type,
          parentName: object?.parent?.name ?? null,
          plan: planSummary(object),
        });
        return originalRemoveObject(object);
      };
    }
    const originalExecute = app.editor.execute?.bind(app.editor);
    if (originalExecute) {
      app.editor.execute = (command, ...args) => {
        trace.push({
          event: "editor.execute",
          commandType: command?.type,
          commandName: command?.name,
          objectName: command?.object?.name,
          objectType: command?.object?.type,
          plan: planSummary(command?.object),
        });
        return originalExecute(command, ...args);
      };
    }
    const originalCall = app.call?.bind(app);
    if (originalCall) {
      app.call = (eventName, ...args) => {
        if (
          eventName === "objectRemoved" ||
          eventName === "objectChanged" ||
          eventName === "planCadChanged"
        ) {
          const object = args[1] ?? args[0];
          trace.push({
            event: `app.call:${eventName}`,
            objectName: object?.name,
            objectType: object?.type,
            plan: planSummary(object),
          });
        }
        return originalCall(eventName, ...args);
      };
    }
  });
  await rootTreeItem.hover({ timeout: 5000, force: true }).catch(() => {});
  await dispatchTreeContextMenu(rootTreeItem);
  await clickLocatorOrDom(page.locator("text=Delete").last());
  await page.waitForTimeout(600);
  logStep("BIM Plan outliner delete trace", "ok", {
    trace: await page.evaluate(() => globalThis.__PLAN_CAD_DELETE_TRACE__ ?? []),
  });
  await waitForNoPlanCadData(
    page,
    "BIM Plan outliner delete clears data and generated root",
  );
  await page.evaluate(() => {
    const app = window.app || globalThis.app;
    app?.call?.("historyChanged", app.editor);
    app?.call?.("objectChanged", app.editor, app.editor?.scene);
    app?.call?.("sceneLoaded", app.editor);
  });
  await page.waitForTimeout(600);
  await waitForNoPlanCadData(
    page,
    "BIM Plan outliner delete does not resurrect after sync events",
  );

  const closeButton = page.locator('[data-testid="plan-cad-close"]').first();
  if (await closeButton.isVisible().catch(() => false)) {
    await clickLocatorOrDom(closeButton);
    await page.waitForTimeout(300);
  }
  assert(
    "BIM Plan toolbar closes or is already closed",
    !(await page
      .locator('[data-testid="plan-cad-toolbar"]')
      .first()
      .isVisible()
      .catch(() => false)),
  );
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

console.log("\noss plan/cad smoke: PASS");
