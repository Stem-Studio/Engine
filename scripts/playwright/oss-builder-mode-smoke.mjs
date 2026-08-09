#!/usr/bin/env node
/**
 * OSS Builder Studio mode smoke.
 *
 * Verifies that the shared editor can be opened directly in Quick Build mode
 * without implicitly enabling the separate CAD/BIM tooling.
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "oss-builder-mode-smoke-output");
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
  pageErrors: [],
  failedRequests: [],
};
const failures = [];

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

async function verifyBuilderMode(path, label, screenshotName) {
  const browser = await chromium.launch({ headless: !headed });
  const page = await (
    await browser.newContext({ viewport, isMobile: mobileViewport, hasTouch: mobileViewport })
  ).newPage();
  page.on("pageerror", (e) =>
    report.pageErrors.push({
      label,
      message: e.message,
      stack: e.stack?.slice(0, 2000),
    }),
  );
  page.on("requestfailed", (r) => {
    const failure = r.failure()?.errorText;
    // Route teardown and HMR commonly abort an in-flight local module fetch;
    // it is not a product failure unless the browser reports a real network
    // error.
    if (failure === "net::ERR_ABORTED") return;
    report.failedRequests.push({
      label,
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
        label,
        url: r.url(),
        method: r.request().method(),
        status: r.status(),
      });
    }
  });

  try {
    await page.goto(`${baseUrl}${path}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page
      .waitForLoadState("networkidle", { timeout: 15000 })
      .catch(() => {});
    await dismissBootstrap(page);
    await page.waitForTimeout(8000);
    await dismissTutorial(page);

    assert(
      `${label}: Quick Build opens by default`,
      await page
        .locator('[data-testid="quick-build-toolbar"]')
        .first()
        .isVisible()
        .catch(() => false),
    );
    const groundToolSelected = await page
      .locator('[data-testid="quick-build-tool-ground"][aria-pressed="true"]')
      .first()
      .isVisible()
      .catch(() => false);
    const terrainGroupSelected = await page
      .locator('[data-testid="quick-build-group-terrain"][aria-pressed="true"]')
      .first()
      .isVisible()
      .catch(() => false);
    assert(
      `${label}: default stamp tool is placement-ready`,
      groundToolSelected || terrainGroupSelected,
    );
    assert(
      `${label}: BIM Plan is not auto-enabled by builder mode`,
      !(await page
        .locator('[data-testid="actionbar-plan-cad"]')
        .first()
        .isVisible()
        .catch(() => false)),
    );
    await page
      .screenshot({ path: resolve(outDir, screenshotName), fullPage: true })
      .catch(() => {});
  } catch (error) {
    failures.push(`${label}: exception: ${error.message}`);
    console.error(error);
  } finally {
    await browser.close();
  }
}

const builderScenarios = (
  process.env.BUILDER_PATHS ||
  "/create/project?builder=1|server editor|server-builder.png,/create/project?mode=playground&builder=1|playground editor|playground-builder.png"
)
  .split(",")
  .map((entry) => entry.split("|"))
  .filter(([path, label, screenshot]) => path && label && screenshot);
for (const [path, label, screenshot] of builderScenarios) {
  await verifyBuilderMode(path, label, screenshot);
}

const localFailures = report.failedRequests.filter((item) =>
  item.url?.startsWith(baseUrl),
);
assert(
  "no failed local non-AI requests",
  localFailures.length === 0,
  JSON.stringify(localFailures).slice(0, 500),
);
writeFileSync(resolve(outDir, "report.json"), JSON.stringify(report, null, 2));

if (failures.length) {
  console.error(`\nFAILED: ${failures.length} assertion(s)`);
  process.exit(1);
}

console.log("\noss builder mode smoke: PASS");
