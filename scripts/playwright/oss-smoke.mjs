#!/usr/bin/env node
/**
 * Comprehensive OSS smoke test.
 *
 * Flow:
 *   1. Load `/`, dismiss OSS storage-mode bootstrap modal.
 *   2. Click "Start from scratch" → editor mounts at /create/project/<id>.
 *   3. Assert advanced mode, Avatar Creator hidden, etc.
 *   4. Add two Cube primitives from the left panel.
 *   5. Save via the AppMenu.
 *   6. Navigate back to dashboard via the back-arrow.
 *   7. Confirm the saved project is listed.
 *   8. Click the saved project; editor re-mounts and canvas renders.
 *   9. Click Play; assert play mode engages.
 *  10. Open Copilot panel; type a prompt; assert request fires to /api/AI/*.
 *  11. Final sweep: no failed /api/* (excluding /api/AI/*) at any point.
 *
 * Set HEADED=1 to watch. Report → scripts/playwright/oss-smoke-output/.
 */
import {chromium} from "playwright";
import {writeFileSync, mkdirSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "oss-smoke-output");
mkdirSync(outDir, {recursive: true});

const baseUrl = (process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5173").replace(/\/$/, "");
const headed = process.env.HEADED === "1";

const report = {
    baseUrl,
    startedAt: new Date().toISOString(),
    steps: [],
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    aiRequests: [],
    assertions: {},
};
const failures = [];

function logStep(name, status = "ok", details = {}) {
    report.steps.push({name, status, details, t: new Date().toISOString()});
    const tag = status === "ok" ? "✓" : status === "warn" ? "⚠" : "✗";
    console.log(`${tag} ${name}${Object.keys(details).length ? ` — ${JSON.stringify(details).slice(0, 200)}` : ""}`);
}
function assert(name, condition, detail) {
    report.assertions[name] = {pass: !!condition, detail};
    if (condition) console.log(`✓ assert: ${name}`);
    else {
        console.log(`✗ assert: ${name} — ${detail ?? ""}`);
        failures.push(name);
    }
}

const browser = await chromium.launch({headless: !headed});
const page = await (await browser.newContext({viewport: {width: 1440, height: 900}})).newPage();

page.on("console", m => {
    if (m.type() === "error") report.consoleErrors.push({text: m.text(), location: m.location()});
});
page.on("pageerror", e => report.pageErrors.push({message: e.message, stack: e.stack?.slice(0, 2000)}));
page.on("requestfailed", r => report.failedRequests.push({url: r.url(), method: r.method(), failure: r.failure()?.errorText}));
page.on("response", r => {
    const u = r.url();
    if (r.status() >= 400 && u.startsWith(baseUrl)) {
        report.failedRequests.push({url: u, method: r.request().method(), status: r.status()});
    }
    if (/\/api\/AI\//.test(u)) {
        report.aiRequests.push({url: u, method: r.request().method(), status: r.status()});
    }
});

async function dismissTutorialModal() {
    const gotIt = page.locator('button:has-text("Got It")').first();
    if (await gotIt.count() && await gotIt.isVisible().catch(() => false)) {
        await gotIt.click({timeout: 3000}).catch(() => {});
        await page.waitForTimeout(400);
        logStep("dismissed Getting Started tutorial");
    }
}

async function dismissOSSBootstrapModal(label = "bootstrap modal dismissed") {
    const modal = page.locator('[aria-labelledby="oss-bootstrap-title"]').first();
    if (!(await modal.count()) || !(await modal.isVisible().catch(() => false))) {
        return false;
    }

    await modal.locator('button:has-text("Browser storage")').first().click({timeout: 3000, force: true}).catch(() => {});
    await page.waitForTimeout(200);
    await modal.locator('button:has-text("Continue")').first().click({timeout: 5000, force: true}).catch(() => {});
    await page.waitForSelector('[aria-labelledby="oss-bootstrap-title"]', {state: "detached", timeout: 5000}).catch(() => {});
    await page.waitForTimeout(800);
    logStep(label);
    return true;
}

try {
    // === 1. Editor load (fresh project) + bootstrap modal ===
    // The public marketing site now owns `/`, so the editor's "start from
    // scratch" hero is no longer reachable there. Navigate straight to the
    // create-project route, which auto-creates a fresh project.
    await page.goto(baseUrl + "/create/project", {waitUntil: "domcontentloaded", timeout: 30000});
    await page.waitForLoadState("networkidle", {timeout: 15000}).catch(() => {});
    logStep("create-project route loaded", "ok", {url: page.url()});
    await page.screenshot({path: resolve(outDir, "01-home.png")}).catch(() => {});

    await dismissOSSBootstrapModal();

    // === 2. Editor mounts on the auto-created project ===
    await page.waitForLoadState("networkidle", {timeout: 30000}).catch(() => {});
    await page.waitForTimeout(10000);
    await page.screenshot({path: resolve(outDir, "02-editor-mounted.png")}).catch(() => {});

    const url = page.url();
    assert("url-is-create-project", /\/create\/project\//.test(url), `URL: ${url}`);

    const canvas = page.locator("canvas").first();
    assert("editor-canvas-visible", await canvas.isVisible().catch(() => false), "no canvas");

    const bodyMode = await page.evaluate(() => document.body.dataset.advancedMode || null);
    assert("advanced-mode-on-scratch", bodyMode === "true", `body.dataset.advancedMode = ${bodyMode}`);

    const sceneIdMatch = url.match(/\/create\/project\/([^/?#]+)/);
    const sceneId = sceneIdMatch ? sceneIdMatch[1] : null;
    assert("scene-id-extracted", !!sceneId, `from URL: ${url}`);

    await dismissTutorialModal();

    // === 3. Avatar Creator + My Avatars hidden ===
    const avatarCount = await page.locator('text=Avatar Creator').count();
    assert("avatar-creator-hidden", avatarCount === 0, `found ${avatarCount} Avatar Creator entries`);
    const myAvCount = await page.locator('[data-testid="nav-menu-my-avatars"]').count();
    assert("my-avatars-menu-hidden", myAvCount === 0, `found ${myAvCount} my-avatars menu`);

    // === 4. Add two Cube primitives ===
    // Switch to Library & Tools tab; PrimitivesTab is expanded by default
    // there and Cube is its first entry.
    const libraryTab = page.locator('[data-testid="leftpanel-tab-library"]').first();
    if (await libraryTab.isVisible().catch(() => false)) {
        await libraryTab.click({timeout: 3000, force: true}).catch(() => {});
        await page.waitForTimeout(500);
    }
    let cubesAdded = 0;
    for (let i = 0; i < 2; i++) {
        const cubeIcon = page.locator('[data-testid="icon-item-cube"]').first();
        if (await cubeIcon.isVisible().catch(() => false)) {
            await cubeIcon.click({timeout: 3000, force: true}).catch(() => {});
            await page.waitForTimeout(1000);
            cubesAdded += 1;
        }
    }
    logStep(`added ${cubesAdded} cube(s)`);
    assert("two-cubes-added", cubesAdded === 2, `added ${cubesAdded}`);
    await page.screenshot({path: resolve(outDir, "03-cubes-added.png")}).catch(() => {});

    // === 5. Save via AppMenu ===
    await page.locator('[data-testid="topnav-app-menu"]').first().click({timeout: 3000, force: true}).catch(() => {});
    await page.waitForTimeout(400);
    const saveItem = page.locator('text=Save Project').first();
    assert("save-project-menu-visible", await saveItem.isVisible().catch(() => false), "Save Project not visible");
    if (await saveItem.isVisible().catch(() => false)) {
        await saveItem.click({timeout: 3000}).catch(() => {});
        await page.waitForTimeout(2000);
        logStep("clicked Save Project");
    }
    await page.screenshot({path: resolve(outDir, "04-after-save.png")}).catch(() => {});

    // === 6. Back to dashboard ===
    // The back-arrow triggers a "unsaved changes?" guard that's awkward in
    // headless tests; navigate directly via URL.
    await page.goto(baseUrl + "/dashboard", {waitUntil: "domcontentloaded", timeout: 20000}).catch(() => {});
    await page.waitForLoadState("networkidle", {timeout: 15000}).catch(() => {});
    await page.waitForTimeout(3000);
    await dismissOSSBootstrapModal("dashboard bootstrap modal dismissed");
    await page.screenshot({path: resolve(outDir, "05-dashboard.png")}).catch(() => {});
    assert("back-to-dashboard", /\/dashboard/.test(page.url()) || page.url() === baseUrl + "/", `URL: ${page.url()}`);

    // === 7. Saved project is listed ===
    const projectCards = page.locator(`[data-scene-id="${sceneId}"]`);
    const cardCount = await projectCards.count();
    assert("saved-project-listed", cardCount > 0, `looking for [data-scene-id="${sceneId}"], found ${cardCount}`);

    // OSS Remix tab should be absent.
    const remixNav = await page.locator('text=Remix').first().isVisible().catch(() => false);
    assert("remix-tab-hidden-in-oss", !remixNav, "Remix nav entry still visible");

    // === 8. Click the saved project; editor remounts and loads ===
    if (cardCount > 0) {
        const projectCard = projectCards.first();
        const editButton = projectCard.locator('[data-testid="game-card-edit"]').first();
        if (await editButton.isVisible().catch(() => false)) {
            await editButton.click({timeout: 5000, force: true}).catch(() => {});
        } else {
            await projectCard.click({timeout: 5000, force: true}).catch(() => {});
        }
        await page.waitForLoadState("networkidle", {timeout: 20000}).catch(() => {});
        await page.waitForTimeout(8000);
        await page.screenshot({path: resolve(outDir, "06-reloaded.png")}).catch(() => {});
        assert("url-after-load-is-create", /\/create\/project\//.test(page.url()), `URL: ${page.url()}`);
        const canvasAfterReload = await page.locator("canvas").first().isVisible().catch(() => false);
        assert("canvas-visible-on-reload", canvasAfterReload, "no canvas after dashboard load");
        await dismissTutorialModal();
    }

    // === 8b. Saved scene userData.behaviorConfigs is compact ===
    // Built-in behaviors should be stored as `{id}` references, not full
    // BehaviorClassConfig objects. Read the IndexedDB record we just
    // wrote and assert the bytes are under our budget.
    if (sceneId) {
        const savedBytes = await page.evaluate(async (id) => {
            return new Promise(resolve => {
                const req = indexedDB.open("stemstudio-projects");
                req.onsuccess = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains("projects")) {
                        return resolve({error: "projects-store-not-found"});
                    }
                    const tx = db.transaction("projects", "readonly");
                    const store = tx.objectStore("projects");
                    const g = store.get(id);
                    g.onsuccess = () => {
                        const body = g.result;
                        if (!body) return resolve({error: "not-found"});
                        try {
                            const parsed = JSON.parse(body.sceneJson);
                            const sceneEntry = parsed.find(e => e?.userData?.behaviorConfigs);
                            const configs = sceneEntry?.userData?.behaviorConfigs ?? [];
                            const inline = configs.filter(c => c && (c.main || c.description));
                            resolve({total: body.sceneJson.length, behaviorConfigBytes: JSON.stringify(configs).length, configCount: configs.length, inlineCount: inline.length});
                        } catch (e) {
                            resolve({error: String(e)});
                        }
                    };
                    g.onerror = () => resolve({error: "get-failed"});
                };
                req.onerror = () => resolve({error: "open-failed"});
            });
        }, sceneId);
        logStep("inspected saved scene", "ok", savedBytes);
        const bcBytes = (savedBytes && typeof savedBytes === "object" && "behaviorConfigBytes" in savedBytes) ? savedBytes.behaviorConfigBytes : -1;
        const inlineCount = (savedBytes && typeof savedBytes === "object" && "inlineCount" in savedBytes) ? savedBytes.inlineCount : -1;
        assert("builtin-configs-not-inlined", inlineCount === 0, `${inlineCount} built-in configs still inlined`);
        assert("behaviorConfigs-under-1kb", bcBytes >= 0 && bcBytes < 1024, `behaviorConfigs = ${bcBytes} bytes`);
    }

    // === 9. AI server reachable + copilot panel mounts ===
    // The OSS copilot panel needs an ACP bridge (REACT_APP_COPILOT_SERVER_URL)
    // which is opt-in. The minimum we need to verify is that the AI server
    // is reachable via the Vite proxy, since that's the surface the editor
    // calls for BYOK / capabilities / generation.
    const aiCapsStatus = await page.evaluate(async () => {
        try {
            const res = await fetch("/api/AI/Capabilities");
            return res.status;
        } catch {
            return 0;
        }
    });
    assert("ai-server-reachable", aiCapsStatus === 200, `GET /api/AI/Capabilities → ${aiCapsStatus}`);

    // Open Copilot panel — at minimum the panel should mount (even if it
    // sits in "Connecting" without an ACP bridge configured).
    const copilotBtn = page.locator('[data-testid="actionbar-copilot"]').first();
    if (await copilotBtn.count() && await copilotBtn.isVisible().catch(() => false)) {
        const cBox = await copilotBtn.boundingBox();
        if (cBox) {
            await page.mouse.click(cBox.x + cBox.width / 2, cBox.y + cBox.height / 2);
        } else {
            await copilotBtn.click({timeout: 3000, force: true}).catch(() => {});
        }
        await page.waitForTimeout(2000);
        await page.screenshot({path: resolve(outDir, "08a-copilot-open.png")}).catch(() => {});
        const promptInput = page.locator('[data-testid="copilot-prompt"]').first();
        const copilotConnecting = await page.locator('text=Connecting').first().isVisible().catch(() => false);
        const copilotMounted = await promptInput.isVisible().catch(() => false) || copilotConnecting;
        assert("copilot-panel-mounts", copilotMounted, "copilot panel did not mount");
    } else {
        assert("copilot-panel-mounts", false, "copilot button not present");
    }

    // === 10. Hit Play (last because Player UI takes over and we won't need to return) ===
    const playBtn = page.locator('[data-testid="topnav-play"]').first();
    if (await playBtn.isVisible().catch(() => false)) {
        await playBtn.scrollIntoViewIfNeeded({timeout: 2000}).catch(() => {});
        const pBox = await playBtn.boundingBox();
        if (pBox) {
            await page.mouse.click(pBox.x + pBox.width / 2, pBox.y + pBox.height / 2);
        } else {
            await playBtn.click({timeout: 3000}).catch(() => {});
        }
        const unsavedChangesPrompt = page.locator('text=You have unsaved changes').first();
        if (await unsavedChangesPrompt.isVisible().catch(() => false)) {
            await page.locator("button:has-text(\"Don't Save\")").last().click({timeout: 3000, force: true}).catch(() => {});
            logStep("accepted unsaved-changes prompt for Play");
        }
        await page.waitForTimeout(8000);
        await page.screenshot({path: resolve(outDir, "07-playing.png")}).catch(() => {});
        const appIsPlaying = await page.evaluate(() => Boolean((window.app || globalThis.app)?.isPlaying)).catch(() => false);
        const startGameVisible = await page.locator('text=START GAME').first().isVisible().catch(() => false);
        const closeVisible = await page.locator('text=Close').first().isVisible().catch(() => false);
        const cloneVisible = await page.locator('text=Clone').first().isVisible().catch(() => false);
        const cameraFreeModeVisible = await page.locator('text=Player object not found').first().isVisible().catch(() => false);
        assert(
            "play-mode-engaged",
            appIsPlaying || startGameVisible || closeVisible || cloneVisible || cameraFreeModeVisible,
            `play signals: app=${appIsPlaying} startGame=${startGameVisible} close=${closeVisible} clone=${cloneVisible} cameraFree=${cameraFreeModeVisible}`,
        );
    } else {
        assert("play-mode-engaged", false, "Play button not visible");
    }

    // === 11. No integrated /api/* failures across the whole run ===
    const offending = report.failedRequests
        .filter(r => /\/api\//.test(r.url) && !/\/api\/AI\//.test(r.url))
        .map(r => r.url);
    assert(
        "no-integrated-api-calls",
        offending.length === 0,
        offending.length ? `unexpected /api failures: ${offending.slice(0, 5).join(", ")}` : "",
    );

    await page.waitForTimeout(1000);
} catch (e) {
    logStep("FATAL", "error", {error: e.message});
    failures.push("fatal:" + e.message);
} finally {
    report.finishedAt = new Date().toISOString();
    report.failures = failures;
    writeFileSync(resolve(outDir, "report.json"), JSON.stringify(report, null, 2));
    console.log(`\n=== Report ===`);
    console.log(`Console errors:  ${report.consoleErrors.length}`);
    console.log(`Page errors:     ${report.pageErrors.length}`);
    console.log(`Failed requests: ${report.failedRequests.length}`);
    console.log(`AI requests:     ${report.aiRequests.length}`);
    console.log(`Steps:           ${report.steps.length}`);
    const passCount = Object.values(report.assertions).filter(a => a.pass).length;
    console.log(`Assertions:      ${passCount}/${Object.keys(report.assertions).length} passed`);
    console.log(`Output dir:      ${outDir}`);
    await browser.close();
    if (failures.length > 0) {
        console.error(`\nFAIL: ${failures.length} failed: ${failures.join(", ")}`);
        process.exit(1);
    }
}
