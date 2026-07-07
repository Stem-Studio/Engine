#!/usr/bin/env node
/**
 * Public-site landing smoke.
 *
 * Verifies the buildwithstem.com landing page:
 *   - loads under five seconds with no page errors
 *   - hero copy and primary CTAs render
 *   - feature grid renders a healthy feature set
 *   - code showcase pane renders + the live preview canvas mounts a WebGL ctx
 *   - "Open Playground" CTA links to /playground
 *   - GitHub link is present and points at the OSS repo
 *
 * Requires `bun run dev` (or any build) serving the site on
 * http://localhost:5173. Override via PLAYWRIGHT_BASE_URL.
 *
 * Set HEADED=1 to watch. Report → scripts/playwright/site-landing-output/.
 */
import {chromium} from "playwright";
import {writeFileSync, mkdirSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "site-landing-output");
mkdirSync(outDir, {recursive: true});

const baseUrl = (process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5173").replace(/\/$/, "");
const headed = process.env.HEADED === "1";

const report = {
    baseUrl,
    startedAt: new Date().toISOString(),
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    assertions: {},
};
const failures = [];

function assert(name, condition, detail) {
    report.assertions[name] = {pass: !!condition, detail};
    console.log(`${condition ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!condition) failures.push(name);
}

const browser = await chromium.launch({headless: !headed});
const page = await (await browser.newContext({viewport: {width: 1440, height: 900}})).newPage();

page.on("console", (m) => {
    if (m.type() === "error") report.consoleErrors.push({text: m.text(), location: m.location()});
});
page.on("pageerror", (e) => report.pageErrors.push({message: e.message}));
page.on("response", (r) => {
    if (r.status() >= 400 && r.url().startsWith(baseUrl)) {
        report.failedRequests.push({url: r.url(), status: r.status()});
    }
});

try {
    const start = Date.now();
    await page.goto(`${baseUrl}/`, {waitUntil: "domcontentloaded", timeout: 15000});
    const loadMs = Date.now() - start;
    assert("landing loads under 5s", loadMs < 5000, `${loadMs}ms`);

    await page.waitForSelector(".hero h1", {timeout: 5000});

    const heroText = (await page.locator(".hero h1").innerText()) ?? "";
    assert("hero headline mentions browser", /browser/i.test(heroText), heroText);

    const ctaPlayground = await page.locator('a:has-text("Open the playground")').first().getAttribute("href");
    assert("hero CTA links to /playground", ctaPlayground === "/playground", `href=${ctaPlayground}`);

    const ctaGithub = await page.locator('a:has-text("Star on GitHub")').first().getAttribute("href");
    assert("hero CTA links to GitHub", typeof ctaGithub === "string" && ctaGithub.includes("github.com/"), ctaGithub ?? "");

    const featureCount = await page.locator(".feature").count();
    assert("feature grid shows feature set", featureCount >= 6, `count=${featureCount}`);

    const previewCanvas = page.locator(".preview-pane canvas");
    await previewCanvas.waitFor({timeout: 5000});
    const hasGl = await previewCanvas.evaluate((c) => {
        const canvas = c instanceof HTMLCanvasElement ? c : null;
        if (!canvas) return false;
        const ctx = canvas.getContext("webgl2") || canvas.getContext("webgl");
        return !!ctx;
    });
    assert("showcase canvas has WebGL context", hasGl);

    const footerGh = page.locator('.footer a[href*="github.com/"]').first();
    assert("footer includes GitHub link", (await footerGh.count()) > 0);

    assert("no page errors", report.pageErrors.length === 0, JSON.stringify(report.pageErrors).slice(0, 200));
    // Console errors can be noisy in dev (HMR, source maps). Only fail on
    // bulk errors that look like real problems.
    assert(
        "console error budget",
        report.consoleErrors.length < 8,
        `count=${report.consoleErrors.length}`,
    );
    assert("no failed requests", report.failedRequests.length === 0, JSON.stringify(report.failedRequests).slice(0, 200));
} catch (e) {
    failures.push(`exception: ${e.message}`);
    console.error(e);
} finally {
    writeFileSync(resolve(outDir, "report.json"), JSON.stringify(report, null, 2));
    await page.screenshot({path: resolve(outDir, "landing.png"), fullPage: true}).catch(() => {});
    await browser.close();
}

if (failures.length) {
    console.error(`\nFAILED: ${failures.length} assertion(s)\n` + failures.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
}
console.log("\nsite landing smoke: PASS");
