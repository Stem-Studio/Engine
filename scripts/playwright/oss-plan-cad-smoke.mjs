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
  await clickVisible(cadToolsButton);
  const planCadOption = page
    .locator('[data-testid="actionbar-plan-cad"]')
    .first();
  assert(
    "BIM Plan menu option visible",
    await planCadOption.isVisible().catch(() => false),
  );
  await clickVisible(planCadOption);
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
  const groups = {
    wall: "structure",
    room: "structure",
    zone: "structure",
    door: "openings",
    window: "openings",
    part: "objects",
  };
  const groupId = groups[id];
  if (groupId) {
    await page
      .locator(`[data-testid="plan-cad-group-${groupId}"]`)
      .first()
      .click({ timeout: 5000, force: true, noWaitAfter: true });
  }
  const tool = page.locator(`[data-testid="plan-cad-tool-${id}"]`).first();
  await tool.waitFor({ state: "visible", timeout: 5000 });
  await tool.click({ timeout: 5000, force: true, noWaitAfter: true });
}

async function clickVisible(locator, timeout = 10000) {
  await locator.waitFor({ state: "visible", timeout });
  await locator.click({ timeout, force: true, noWaitAfter: true });
}

async function openCompactHierarchyPanel(page) {
  if (!mobileViewport) return;
  const hierarchyToggle = page.locator('[data-testid="topnav-toggle-hierarchy"]').first();
  if (!(await hierarchyToggle.isVisible().catch(() => false))) return;
  if ((await hierarchyToggle.getAttribute("aria-expanded")) !== "true") {
    await clickVisible(hierarchyToggle, 5000);
  }
  await page
    .locator('[data-testid="leftpanel-tab-project"]')
    .first()
    .waitFor({ state: "visible", timeout: 5000 });
  await page.waitForFunction(() => {
    const panel = document.querySelector('[aria-label="Project hierarchy and library"]');
    const rect = panel?.getBoundingClientRect();
    return !!rect && rect.left >= -1 && rect.right > 0;
  }, undefined, {timeout: 5000});
  logStep("compact hierarchy panel opened");
}

async function openCompactInspectorPanel(page) {
  if (!mobileViewport) return;
  const inspectorToggle = page.locator('[data-testid="topnav-toggle-inspector"]').first();
  if (!(await inspectorToggle.isVisible().catch(() => false))) return;
  if ((await inspectorToggle.getAttribute("aria-expanded")) !== "true") {
    await clickVisible(inspectorToggle, 5000);
  }
  await page
    .locator('[data-testid="cad-tools-toggle"]')
    .first()
    .waitFor({state: "visible", timeout: 5000});
  logStep("compact inspector panel opened");
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
  await page
    .screenshot({ path: resolve(outDir, "01-editor.png") })
    .catch(() => {});

  const canvas = page.locator("canvas").first();
  assert("editor canvas visible", await canvas.isVisible().catch(() => false));

  await openCompactHierarchyPanel(page);
  await page
    .locator('[data-testid="leftpanel-tab-project"]')
    .first()
    .click({ timeout: 5000, force: true });
  await page
    .locator("text=Project Settings")
    .first()
    .click({ timeout: 5000, force: true });
  await openCompactInspectorPanel(page);
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
  assert(
    "CAD tools switch checked",
    await cadCheckbox.isChecked().catch(() => false),
  );
  logStep("CAD tools enabled");

  await openCompactHierarchyPanel(page);
  await clickVisible(page.locator('[data-testid="leftpanel-tab-library"]').first());
  await clickVisible(page.locator('[data-testid="icon-item-cube"]').first(), 15000);
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
    const clickY = mobileViewport ? 0.82 : 0.55;
    const clickX1 = mobileViewport ? 0.52 : 0.42;
    const clickX2 = mobileViewport ? 0.72 : 0.58;
    await page.mouse.click(box.x + box.width * clickX1, box.y + box.height * clickY);
    await page.waitForTimeout(250);
    await page.mouse.click(box.x + box.width * clickX2, box.y + box.height * clickY);
    await page.waitForTimeout(1200);
  }
  await page
    .screenshot({ path: resolve(outDir, "02-plan-cad-wall.png") })
    .catch(() => {});

  if (mobileViewport) {
    const inspectorToggle = page.locator('[data-testid="topnav-toggle-inspector"]').first();
    for (let attempt = 0; attempt < 2; attempt++) {
      if ((await inspectorToggle.getAttribute("aria-expanded")) === "true") break;
      await clickVisible(inspectorToggle, 5000);
      await page.waitForTimeout(200);
    }
    await page
      .locator('aside[aria-label="Inspector"]')
      .first()
      .waitFor({state: "visible", timeout: 5000})
      .catch(() => {});
    await page.waitForTimeout(250);
    await page
      .screenshot({path: resolve(outDir, "02-plan-cad-wall-inspector.png")})
      .catch(() => {});
  }

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

  await page
    .locator('[data-testid="plan-cad-close"]')
    .first()
    .click({ timeout: 5000, force: true });
  await page.waitForTimeout(300);
  assert(
    "BIM Plan toolbar closes",
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
