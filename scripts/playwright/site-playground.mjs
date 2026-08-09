#!/usr/bin/env node
/**
 * Public-site /playground smoke.
 *
 * Verifies:
 *   - /playground renders the site chrome (top bar with "Playground mode" pill)
 *   - the top bar does not expose internal builder query-param entry points
 *   - the iframe src points at the standalone app shell with mode=playground
 *   - inside the iframe, the editor app shell mounts (PublicAppContainerLite)
 *   - <html data-playground-mode="true"> is set inside the iframe document
 *   - the OSS bootstrap modal is hidden in playground mode (CSS rule)
 *   - settings-style surfaces marked data-playground-hide are not visible
 */
import {chromium} from "playwright";
import {writeFileSync, mkdirSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "site-playground-output");
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
const runtimeErrors = [];
const routeStatuses = new Map();
page.on("console", message => {
    if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`);
});
page.on("pageerror", error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on("requestfailed", request => runtimeErrors.push(`request: ${request.url()} ${request.failure()?.errorText || ""}`));
page.on("response", response => {
    const pathname = new URL(response.url()).pathname;
    if (pathname === "/playground" || pathname === "/dashboard" || pathname === "/dashboard/index.html" || pathname === "/shell.html") {
        routeStatuses.set(pathname, response.status());
    }
    if (response.status() >= 400) runtimeErrors.push(`response: ${response.status()} ${response.url()}`);
});

try {
    const cleanRouteResponse = await page.goto(`${baseUrl}/playground`, {waitUntil: "domcontentloaded", timeout: 20000});
    assert(
        "clean playground route returns HTTP success",
        (cleanRouteResponse?.status() ?? routeStatuses.get("/playground") ?? 0) < 400,
        `status=${cleanRouteResponse?.status() ?? routeStatuses.get("/playground") ?? "missing"}`,
    );

    const playgroundResponse = await page.goto(`${baseUrl}/playground/index.html`, {waitUntil: "domcontentloaded", timeout: 20000});

    assert(
        "playground route returns HTTP success",
        (playgroundResponse?.status() ?? routeStatuses.get("/playground") ?? 0) < 400,
        `status=${playgroundResponse?.status() ?? routeStatuses.get("/playground") ?? "missing"}`,
    );

    await page.waitForSelector(".playground-page", {timeout: 5000});

    const pillVisible = await page.locator(".playground-bar .pill").first().isVisible();
    assert("playground mode pill visible", pillVisible);

    const builderCount = await page.locator('a:has-text("Builder Studio")').count();
    assert(
        "playground hides Builder Studio query entry",
        builderCount === 0,
        `count=${builderCount}`,
    );

    const iframeEl = page.locator(".playground-frame");
    const src = await iframeEl.getAttribute("src");
    assert(
        "iframe targets app shell with playground mode flag",
        typeof src === "string" && /\/shell\.html\?(?:.*&)?mode=playground/.test(src),
        src ?? "",
    );

    // Wait for the iframe to load + react to mount.
    const frame = page.frameLocator(".playground-frame");
    // The app shell renders inside #container — wait up to 25s; first-load
    // of the editor bundle is heavy in dev.
    await frame.locator("#container, [data-app-router-root]").first().waitFor({state: "attached", timeout: 25000});

    let playgroundAttr = null;
    const attrDeadline = Date.now() + 10000;
    while (Date.now() < attrDeadline) {
        playgroundAttr = await page
            .locator(".playground-frame")
            .evaluate((el) =>
                el instanceof HTMLIFrameElement
                    ? el.contentDocument?.documentElement?.dataset?.playgroundMode ?? null
                    : null,
            );
        if (playgroundAttr === "true") break;
        await page.waitForTimeout(150);
    }
    assert(
        'iframe document has data-playground-mode="true"',
        playgroundAttr === "true",
        `attr=${playgroundAttr ?? "null"}`,
    );

    const bootstrapVisible = await page
        .locator(".playground-frame")
        .evaluate((el) => {
            if (!(el instanceof HTMLIFrameElement)) return null;
            const doc = el.contentDocument;
            if (!doc) return null;
            const modal = doc.querySelector("[data-oss-bootstrap-modal]");
            if (!modal) return false;
            const style = (doc.defaultView ?? window).getComputedStyle(modal);
            return style.display !== "none";
        });
    assert(
        "OSS bootstrap modal hidden in playground mode",
        bootstrapVisible === false || bootstrapVisible === null,
        `visible=${bootstrapVisible}`,
    );

    const hiddenCount = await page
        .locator(".playground-frame")
        .evaluate((el) => {
            if (!(el instanceof HTMLIFrameElement)) return -1;
            const doc = el.contentDocument;
            if (!doc) return -1;
            const all = doc.querySelectorAll("[data-playground-hide]");
            let visible = 0;
            all.forEach((node) => {
                if (!(node instanceof HTMLElement)) return;
                const style = (doc.defaultView ?? window).getComputedStyle(node);
                if (style.display !== "none") visible += 1;
            });
            return visible;
        });
    assert(
        "no data-playground-hide elements rendered",
        hiddenCount === 0 || hiddenCount === -1,
        `visible=${hiddenCount}`,
    );
    // The editor shell may create an auxiliary about:blank frame (for
    // dialogs/portals). Select the actual dashboard iframe by its route so
    // this smoke cannot report a false blank-scene failure.
    const embeddedFrame = page.frames().find(frame =>
        frame !== page.mainFrame() && /\/dashboard(?:\/(?:index\.html)?)?\?/.test(frame.url()),
    ) ?? page.frames().find(frame => frame !== page.mainFrame() && frame.url() !== "about:blank");
    await page.waitForTimeout(Number(process.env.FRAME_CONTENT_WAIT_MS || 12000));
    const dashboardBodyText = await embeddedFrame?.locator("body").innerText().catch(() => "") || "";
    const dashboardContent = /My Projects/.test(dashboardBodyText) &&
        /Import project file|IMPORT STEMSCRIPT|Open project folder/.test(dashboardBodyText);
    assert(
        "dashboard app content mounts inside playground iframe",
        dashboardContent === true,
        `frame=${embeddedFrame?.url() ?? "missing"}; body=${dashboardBodyText.slice(0, 160)}; errors=${runtimeErrors.slice(0, 3).join(" | ")}`,
    );
    const embeddedPath = embeddedFrame ? new URL(embeddedFrame.url()).pathname : "";
    const embeddedRouteStatus = embeddedPath === "/shell.html"
        ? await page.request.get(embeddedFrame.url(), {timeout: 10000}).then(response => response.status()).catch(() => 0)
        : (routeStatuses.get("/dashboard/index.html") ?? routeStatuses.get("/dashboard") ?? 0);
    assert(
        "embedded app-shell route returns HTTP success",
        embeddedRouteStatus > 0 && embeddedRouteStatus < 400,
        `path=${embeddedPath || "missing"}; status=${embeddedRouteStatus || "missing"}`,
    );
} catch (e) {
    failures.push(`exception: ${e.message}`);
    console.error(e);
} finally {
    writeFileSync(resolve(outDir, "report.json"), JSON.stringify(report, null, 2));
    await page.screenshot({path: resolve(outDir, "playground.png"), fullPage: true}).catch(() => {});
    await browser.close();
}

if (failures.length) {
    console.error(`\nFAILED: ${failures.length} assertion(s)`);
    process.exit(1);
}
console.log("\nsite playground smoke: PASS");
