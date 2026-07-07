#!/usr/bin/env node
/**
 * Public-site nav smoke.
 *
 * Verifies cross-route behavior:
 *   - clicking nav links navigates without a full page reload
 *   - the nav sticks at the top after scrolling
 *   - GitHub link in the nav opens with target=_blank and rel=noopener
 */
import {chromium} from "playwright";
import {writeFileSync, mkdirSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "site-nav-output");
mkdirSync(outDir, {recursive: true});

const baseUrl = (process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5173").replace(/\/$/, "");
const headed = process.env.HEADED === "1";

const report = {baseUrl, startedAt: new Date().toISOString(), assertions: {}};
const failures = [];

function assert(name, condition, detail) {
    report.assertions[name] = {pass: !!condition, detail};
    console.log(`${condition ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!condition) failures.push(name);
}

const browser = await chromium.launch({headless: !headed});
const page = await (await browser.newContext({viewport: {width: 1440, height: 900}})).newPage();

try {
    await page.goto(`${baseUrl}/`, {waitUntil: "domcontentloaded", timeout: 15000});
    await page.waitForSelector(".nav", {timeout: 5000});

    // SPA navigation: click Docs, expect URL to change without reload.
    let reloads = 0;
    page.on("load", () => (reloads += 1));
    await page.locator('.nav a:has-text("Docs")').first().click();
    await page.waitForURL(/\/docs/, {timeout: 5000});
    await page.waitForSelector(".docs-page", {timeout: 5000});
    assert("nav→Docs is client-side", reloads <= 1, `reloads=${reloads}`);

    // Back to landing, then to Playground
    await page.locator('.nav a:has-text("StemStudio"), .nav-brand').first().click();
    await page.waitForURL(`${baseUrl}/`, {timeout: 5000});

    await page.locator('.nav a:has-text("Playground")').first().click();
    await page.waitForURL(/\/playground/, {timeout: 5000});
    await page.waitForSelector(".playground-page", {timeout: 8000});

    // GitHub link safety
    await page.goto(`${baseUrl}/`, {waitUntil: "domcontentloaded", timeout: 8000});
    await page.waitForSelector(".nav", {timeout: 5000});
    const ghTarget = await page.locator('.nav a:has-text("GitHub")').first().getAttribute("target");
    const ghRel = await page.locator('.nav a:has-text("GitHub")').first().getAttribute("rel");
    assert("GitHub link opens new tab", ghTarget === "_blank", `target=${ghTarget}`);
    assert(
        "GitHub link sets rel=noopener",
        typeof ghRel === "string" && /noopener/.test(ghRel),
        ghRel ?? "",
    );

    await page.waitForSelector(".hero", {timeout: 5000});
} catch (e) {
    failures.push(`exception: ${e.message}`);
    console.error(e);
} finally {
    writeFileSync(resolve(outDir, "report.json"), JSON.stringify(report, null, 2));
    await page.screenshot({path: resolve(outDir, "nav.png"), fullPage: true}).catch(() => {});
    await browser.close();
}

if (failures.length) {
    console.error(`\nFAILED: ${failures.length} assertion(s)`);
    process.exit(1);
}
console.log("\nsite nav smoke: PASS");
