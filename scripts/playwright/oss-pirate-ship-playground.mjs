#!/usr/bin/env node
/**
 * End-to-end (PLAYGROUND + FILESYSTEM storage): import the Pirate Ship Battle
 * Royal stemscript into a fresh project, save to the File System Access (folder)
 * store, reload through the playground dashboard, enter Play, START GAME, then
 * STOP play — auditing the console for the three regressions reported against
 * this game:
 *
 *   1. `Image derivative missing dataUrl` — OceanSurface's PIR_Water base map
 *      never resolves because `fetchAssetImageDerivative` lacked the revision
 *      data-URL fallback that OSS (no integrated CDN) depends on. Fixed in
 *      editor-oss/.../hooks/assets.ts.
 *   2. The OceanSurface texture not being applied (the visible symptom of #1).
 *   3. `this._stopWakeSound is not a function` — thrown from the ShipController
 *      behavior's dispose() (and onReset) because the method was never defined,
 *      aborting that ship's teardown when play mode stops. Fixed in the game's
 *      behaviors/ShipController.yaml. Only surfaces on STOP, so the test must
 *      enter Play and then exit back to Edit to exercise BehaviorManager.dispose.
 *
 * Storage: filesystem (OPFS-backed File System Access store), matching the
 * reporter's setup. No directory picker — each context gets its own OPFS
 * partition seeded with a "stem-fs" handle (same trick as oss-all-games-playground).
 *
 * Source folder: GAME_FOLDER (defaults to the fixed Games-StemScript copy).
 * Prereq: `bun run dev` on PLAYWRIGHT_BASE_URL (default localhost:5173).
 * Set HEADED=1 to watch. Report → scripts/playwright/oss-pirate-ship-playground-output/.
 */
import {chromium} from "playwright";
import {writeFileSync, mkdirSync, readFileSync, readdirSync, statSync, existsSync} from "node:fs";
import {dirname, resolve, basename, join} from "node:path";
import {fileURLToPath} from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "oss-pirate-ship-playground-output");
mkdirSync(outDir, {recursive: true});

const baseUrl = (process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5173").replace(/\/$/, "");
const headed = process.env.HEADED === "1";
const gameFolder = process.env.GAME_FOLDER || "/Users/n/erth/Games-StemScript/Pirate-Ship-Battle-Royal-v1.0";

function walkFiles(root) {
    const out = [];
    const recurse = (dir, prefix) => {
        for (const entry of readdirSync(dir)) {
            if (entry === ".DS_Store") continue;
            const abs = join(dir, entry);
            const rel = prefix ? `${prefix}/${entry}` : entry;
            if (statSync(abs).isDirectory()) recurse(abs, rel);
            else out.push({name: rel, abs});
        }
    };
    recurse(root, "");
    return out;
}

function mimeFor(name) {
    const l = name.toLowerCase();
    if (l.endsWith(".gltf")) return "model/gltf+json";
    if (l.endsWith(".glb")) return "model/gltf-binary";
    if (l.endsWith(".png")) return "image/png";
    if (l.endsWith(".jpg") || l.endsWith(".jpeg")) return "image/jpeg";
    if (l.endsWith(".webp")) return "image/webp";
    if (l.endsWith(".mp3")) return "audio/mpeg";
    if (l.endsWith(".wav")) return "audio/wav";
    if (l.endsWith(".ogg")) return "audio/ogg";
    if (l.endsWith(".yaml") || l.endsWith(".yml")) return "application/x-yaml";
    if (l.endsWith(".json")) return "application/json";
    if (l.endsWith(".md") || l.endsWith(".txt") || l.endsWith(".stemscript")) return "text/plain";
    return "application/octet-stream";
}

const report = {baseUrl, gameFolder, mode: "playground", storeMode: "filesystem", startedAt: new Date().toISOString(), steps: [], consoleErrors: [], pageErrors: [], assetErrors: [], migrationLogs: [], assertions: {}};
const failures = [];
function logStep(name, status = "ok", details = {}) {
    report.steps.push({name, status, details, t: new Date().toISOString()});
    const tag = status === "ok" ? "✓" : status === "warn" ? "⚠" : "✗";
    console.log(`${tag} ${name}${Object.keys(details).length ? ` — ${JSON.stringify(details).slice(0, 240)}` : ""}`);
}
function assert(name, cond, detail) {
    report.assertions[name] = {pass: !!cond, detail};
    if (cond) console.log(`✓ assert: ${name}`);
    else { console.log(`✗ assert: ${name} — ${detail ?? ""}`); failures.push(name); }
}

// Regression signatures for the three reported exceptions.
const DERIVATIVE_RE = /Image derivative missing dataUrl/i;
const WAKESOUND_RE = /_stopWakeSound is not a function/i;
const DISPOSE_RE = /Error during behavior dispose/i;
// Texture / asset-load failures surface as warnings, so the exception filter
// would miss them; track separately.
const ASSET_FAIL_RE = /No data URL found for|missing dataUrl|Failed to load texture|Cannot fetch asset|not being applied as a texture/i;

assert("game-folder-exists", existsSync(gameFolder), gameFolder);
if (failures.length) { writeFileSync(resolve(outDir, "report.json"), JSON.stringify(report, null, 2)); process.exit(1); }

const files = walkFiles(gameFolder);
const scriptFile = files.find(f => f.name.toLowerCase().endsWith(".stemscript"));
assert("script-file-found", !!scriptFile, `no .stemscript in ${gameFolder}`);
if (!scriptFile) { writeFileSync(resolve(outDir, "report.json"), JSON.stringify(report, null, 2)); process.exit(1); }
const scriptContent = readFileSync(scriptFile.abs, "utf8");
const folderFiles = files.filter(f => f !== scriptFile)
    .map(f => ({name: f.name, mime: mimeFor(f.name), data: readFileSync(f.abs).toString("base64")}));
logStep("read pirate-ship folder", "ok", {files: files.length, script: basename(scriptFile.name)});

const browser = await chromium.launch({headless: !headed});
const ctx = await browser.newContext({viewport: {width: 1440, height: 900}});
const page = await ctx.newPage();
page.on("console", m => {
    const t = m.text();
    if (m.type() === "error") report.consoleErrors.push({text: t.slice(0, 400), location: m.location()});
    if (ASSET_FAIL_RE.test(t)) report.assetErrors.push(t.slice(0, 300));
    // OSS must never run legacy behavior migration — it mints duplicate
    // behavior assets every load. Any [LegacyBehaviorMigration] Migrat* line
    // is a regression of the !IS_OSS gate in Editor.onSceneLoaded.
    if (/\[LegacyBehaviorMigration\]\s+(Migrat|Updat)/i.test(t)) report.migrationLogs.push(t.slice(0, 300));
});
page.on("pageerror", e => report.pageErrors.push({message: e.message, stack: e.stack?.slice(0, 2000)}));

// Seed the File System Access (folder) store via OPFS so no directory picker is
// needed. Must run on the origin before the navigation that boots the editor —
// rehydrateProjectStore reads the persistence mode + handle from here.
const bootstrapFilesystemStore = async (p) => {
    await p.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        try { await root.removeEntry("stem-fs", {recursive: true}); } catch { /* first run */ }
        const fsRoot = await root.getDirectoryHandle("stem-fs", {create: true});
        await new Promise((res, rej) => {
            const req = indexedDB.open("stemstudio-fs-handle", 1);
            req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains("handles")) db.createObjectStore("handles"); };
            req.onsuccess = () => { const tx = req.result.transaction("handles", "readwrite"); tx.objectStore("handles").put(fsRoot, "project-dir"); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); };
            req.onerror = () => rej(req.error);
        });
        localStorage.setItem("stemstudio.persistence.mode", "filesystem");
        localStorage.setItem("stemstudio.bootstrap.complete", "true");
    });
};

const dismissBootstrap = async () => {
    const bs = page.locator('[aria-labelledby="oss-bootstrap-title"]').first();
    if (await bs.count() && await bs.isVisible().catch(() => false)) {
        await bs.locator('button:has-text("Browser storage")').first().click({timeout: 3000}).catch(() => {});
        await bs.locator('button:has-text("Continue")').first().click({timeout: 5000}).catch(() => {});
        await page.waitForSelector('[aria-labelledby="oss-bootstrap-title"]', {state: "detached", timeout: 5000}).catch(() => {});
        await page.waitForTimeout(400);
    }
};
const dismissTutorial = async () => {
    const gotIt = page.locator('button:has-text("Got It")').first();
    if (await gotIt.count() && await gotIt.isVisible().catch(() => false)) {
        await gotIt.click({timeout: 3000}).catch(() => {});
        await page.waitForTimeout(300);
    }
};

// The batch-import dialog ("Import Assets (N required)") only appears when an
// import could NOT auto-resolve. In a headless run nobody clicks it, so it
// hangs runScript forever. A clean import (all files resolved) never shows it.
// We assert it does NOT appear; if it ever does, that's a real auto-resolution
// failure — record it (so the run fails loudly) and dismiss it so the harness
// doesn't hang for 20 minutes instead of reporting the problem.
const batchImportDialogAppeared = async () =>
    page.evaluate(() => /Import Assets \(/.test(document.body?.innerText || "")).catch(() => false);
const dismissBatchImportDialogIfPresent = async () => {
    if (!(await batchImportDialogAppeared())) return false;
    // Skip All → continue the script; the skipped imports show up in failCount.
    const skip = page.locator('button:has-text("Skip All")').first();
    if (await skip.count() && await skip.isVisible().catch(() => false)) {
        await skip.click({timeout: 3000, force: true}).catch(() => {});
    } else {
        await page.keyboard.press("Escape").catch(() => {});
    }
    await page.waitForTimeout(500);
    return true;
};

try {
    // === Activate playground mode, then seed the filesystem store. ===
    await page.goto(baseUrl + "/dashboard?mode=playground", {waitUntil: "domcontentloaded", timeout: 30000});
    await page.waitForLoadState("networkidle", {timeout: 15000}).catch(() => {});
    await dismissBootstrap();
    const playgroundActive = await page.evaluate(() => { try { return window.sessionStorage.getItem("stem.playgroundMode") === "1"; } catch { return false; } });
    assert("playground-mode-active", playgroundActive, "stem.playgroundMode sessionStorage flag not set");
    await bootstrapFilesystemStore(page);
    logStep("filesystem (OPFS) store bootstrapped", "ok");

    // === Boot a fresh project (flags persist via sessionStorage / localStorage). ===
    await page.goto(baseUrl + "/create/project", {waitUntil: "domcontentloaded", timeout: 30000});
    await page.waitForLoadState("networkidle", {timeout: 15000}).catch(() => {});
    await dismissBootstrap();
    await page.waitForTimeout(6000);
    await dismissTutorial();
    const fsMode = await page.evaluate(() => { try { return window.localStorage.getItem("stemstudio.persistence.mode"); } catch { return null; } });
    assert("filesystem-store-selected", fsMode === "filesystem", `persistence.mode=${fsMode}`);
    assert("editor-mounted", /\/create\/project/.test(page.url()), `URL: ${page.url()}`);

    // === Open Copilot so `__stemRunScript` is exposed (allowed in playground). ===
    const copilotBtn = page.locator('[data-testid="actionbar-copilot"]').first();
    const cBox = await copilotBtn.boundingBox().catch(() => null);
    if (cBox) await page.mouse.click(cBox.x + cBox.width / 2, cBox.y + cBox.height / 2);
    else await copilotBtn.click({timeout: 3000, force: true}).catch(() => {});
    await page.waitForTimeout(2000);
    const hookPresent = await page.evaluate(() => typeof window.__stemRunScript === "function");
    assert("run-script-hook-exposed", hookPresent, "window.__stemRunScript not exposed");
    if (!hookPresent) throw new Error("no stemRunScript");

    // === Run the import. ===
    // Fire WITHOUT awaiting the whole import inside evaluate: that would block
    // this flow and, if the batch-import dialog ever opened, hang forever. We
    // poll for completion and dismiss the dialog if it appears.
    const execStartUrl = page.url();
    try {
        await page.evaluate(({content, fileList}) => {
            window.__stemRunScriptDone = null;
            window.__stemRunScriptSummary = null;
            window.__stemRunScript(content, fileList).then(
                summary => { window.__stemRunScriptDone = "ok"; window.__stemRunScriptSummary = summary ?? null; },
                err => { window.__stemRunScriptDone = String(err && err.message ? err.message : err); },
            );
        }, {content: scriptContent, fileList: folderFiles});
    } catch (e) {
        logStep("exec fire detached (likely navigation)", "warn", {error: e.message.slice(0, 120)});
    }
    // Poll until the run resolves (a full game import takes a few minutes).
    let importDialogSeen = false;
    const importDeadline = Date.now() + 15 * 60 * 1000;
    let execResult = null;
    while (Date.now() < importDeadline) {
        execResult = await page.evaluate(() => window.__stemRunScriptDone ?? null).catch(() => null);
        if (execResult) break;
        if (await dismissBatchImportDialogIfPresent()) importDialogSeen = true;
        await page.waitForTimeout(3000);
    }
    await page.waitForLoadState("networkidle", {timeout: 60000}).catch(() => {});
    await dismissTutorial();
    const execOk = execResult === "ok" || page.url() !== execStartUrl;
    assert("exec-completed", execOk, execResult ?? "no completion signal (timed out)");
    // The dialog must NOT have appeared — if it did, an import failed to
    // auto-resolve (the exact bug that hung this game's import headlessly).
    assert("no-batch-import-dialog", !importDialogSeen,
        "batch-import dialog appeared — an import failed to auto-resolve");

    // The import must be COMPLETE, not merely "finished". A non-zero failCount
    // means at least one command (including an unresolved asset import) failed —
    // exactly the silent-skip class of bug (skybox_day.glb) we refuse to let
    // masquerade as a clean import.
    const runSummary = await page.evaluate(() => window.__stemRunScriptSummary ?? null).catch(() => null);
    report.runSummary = runSummary;
    assert("import-no-failed-commands", !!runSummary && runSummary.failCount === 0,
        `summary=${JSON.stringify(runSummary)}`);

    // The skybox is an imported model object; assert it actually landed in the
    // scene rather than being silently dropped during resolution.
    const sceneAudit = await page.evaluate(() => (window.__stemGetScene ? window.__stemGetScene() : null)).catch(() => null);
    const objectNames = sceneAudit?.objectNames ?? [];
    report.importedObjectCount = objectNames.length;
    assert("skybox-object-present", objectNames.some(n => /skybox/i.test(n)),
        `no object matching /skybox/ in ${objectNames.length} objects`);
    // A real game import lands many models — guard against an empty/partial scene.
    assert("scene-has-models", (sceneAudit?.meshCount ?? 0) > 0, `meshCount=${sceneAudit?.meshCount ?? 0}`);

    await page.screenshot({path: resolve(outDir, "01-after-import.png")}).catch(() => {});

    // No "Image derivative missing dataUrl" while the OceanSurface base map loads.
    const importDerivativeErrors = report.consoleErrors.filter(e => DERIVATIVE_RE.test(e.text));
    assert("no-derivative-errors-during-import", importDerivativeErrors.length === 0,
        `${importDerivativeErrors.length}: ${importDerivativeErrors[0]?.text.slice(0, 200) ?? ""}`);

    // === Save to the filesystem store via AppMenu. ===
    await page.locator('[data-testid="topnav-app-menu"]').first().click({timeout: 3000, force: true}).catch(() => {});
    await page.waitForTimeout(400);
    const save = page.locator("text=Save Project").first();
    if (await save.isVisible().catch(() => false)) {
        await save.click({timeout: 3000}).catch(() => {});
        // OPFS saves write asset files then the manifest LAST; reloading before
        // the "Saved" toast loses assets. Wait generously for it.
        await page.locator("text=/^Saved$/").first().waitFor({state: "visible", timeout: 180000}).catch(() => {});
        await page.waitForTimeout(1500);
    }
    const sceneId = (page.url().match(/\/create\/project\/([^/?#]+)/) || [])[1] || null;
    assert("scene-id-resolved", !!sceneId, `URL: ${page.url()}`);

    // === Reload through the playground dashboard (the folder-store load path). ===
    await page.goto(baseUrl + "/dashboard?mode=playground", {waitUntil: "domcontentloaded", timeout: 20000}).catch(() => {});
    await page.waitForLoadState("networkidle", {timeout: 15000}).catch(() => {});
    await dismissBootstrap();
    await page.waitForTimeout(2000);
    const reloadMarkIdx = report.consoleErrors.length; // ignore pre-reload errors

    if (sceneId) {
        const card = page.locator(`[data-scene-id="${sceneId}"]`).first();
        // Folder store project list can take a moment to rehydrate from OPFS.
        await card.waitFor({state: "attached", timeout: 30000}).catch(() => {});
        assert("imported-project-listed", (await card.count()) > 0, `data-scene-id="${sceneId}" not found`);
        if (await card.count()) {
            await card.click({timeout: 5000}).catch(() => {});
            await page.waitForLoadState("networkidle", {timeout: 30000}).catch(() => {});
            await dismissBootstrap();
            await page.waitForSelector("canvas", {timeout: 30000}).catch(() => {});
            await dismissTutorial();
            await page.waitForTimeout(8000);
            await page.screenshot({path: resolve(outDir, "02-reloaded-playground.png")}).catch(() => {});
            assert("canvas-visible-on-reload", await page.locator("canvas").first().isVisible().catch(() => false), "no canvas after reload");

            const reloadDerivativeErrors = report.consoleErrors.slice(reloadMarkIdx).filter(e => DERIVATIVE_RE.test(e.text));
            assert("no-derivative-errors-after-reload", reloadDerivativeErrors.length === 0,
                `${reloadDerivativeErrors.length}: ${reloadDerivativeErrors[0]?.text.slice(0, 200) ?? ""}`);
        }
    }

    // === Enter Play and START GAME. ===
    const playMarkIdx = report.consoleErrors.length;
    const playBtn = page.locator('[data-testid="topnav-play"]').first();
    let entered = false;
    if (await playBtn.isVisible().catch(() => false)) {
        await playBtn.click({timeout: 3000, force: true}).catch(() => {});
        const dontSave = page.locator("button", {hasText: /don['’]t\s*save/i}).first();
        if (await dontSave.count() && await dontSave.isVisible().catch(() => false)) { await dontSave.click({timeout: 3000}).catch(() => {}); await page.waitForTimeout(500); }
        await page.waitForTimeout(3000);
        const startGame = page.locator("#startGameBtn").first();
        try {
            await startGame.waitFor({state: "visible", timeout: 20000});
            await page.waitForFunction(() => { const b = document.getElementById("startGameBtn"); return b && !b.disabled && b.getAttribute("aria-disabled") !== "true"; }, {timeout: 20000});
            await startGame.click({timeout: 5000, force: true});
            logStep("clicked START GAME", "ok");
        } catch (e) { logStep("START GAME never became clickable (may auto-start)", "warn", {error: String(e).slice(0, 160)}); }
        if (process.env.PROBE_INPUT === "1") {
            const beforeInput = await page.evaluate(() => {
                const app = window.app || globalThis.app;
                return {
                    matchStarted: !!app?.game?.scene?.userData?._matchStarted,
                    forward: app?.game?.inputManager?.getMotion?.("forward") ?? null,
                    turn: app?.game?.inputManager?.getMotion?.("turn") ?? null,
                };
            }).catch(error => ({error: String(error?.message || error)}));
            await page.keyboard.down("w");
            await page.waitForTimeout(250);
            const heldInput = await page.evaluate(() => {
                const app = window.app || globalThis.app;
                return {
                    matchStarted: !!app?.game?.scene?.userData?._matchStarted,
                    forward: app?.game?.inputManager?.getMotion?.("forward") ?? null,
                    turn: app?.game?.inputManager?.getMotion?.("turn") ?? null,
                };
            }).catch(error => ({error: String(error?.message || error)}));
            await page.keyboard.up("w");
            report.inputProbe = {beforeInput, heldInput};
            logStep("probed ship keyboard input", "ok", report.inputProbe);
        }
        entered = true;
        await page.waitForTimeout(10000);
        await page.screenshot({path: resolve(outDir, "03-play.png")}).catch(() => {});
    } else {
        logStep("Play button not visible — skipping play audit", "warn");
        failures.push("play-button-missing");
    }
    assert("entered-play", entered, "could not enter play mode");

    // No texture errors while playing (OceanSurface base map must be live).
    const playDerivativeErrors = report.consoleErrors.slice(playMarkIdx).filter(e => DERIVATIVE_RE.test(e.text));
    assert("no-derivative-errors-in-play", playDerivativeErrors.length === 0,
        `${playDerivativeErrors.length}: ${playDerivativeErrors[0]?.text.slice(0, 200) ?? ""}`);

    // === STOP play (Edit) — this is what triggers BehaviorManager.dispose and
    //     surfaced `this._stopWakeSound is not a function` on ShipController. ===
    if (entered) {
        const stopMarkIdx = report.consoleErrors.length;
        const editBtn = page.locator('button:has-text("Edit")').first();
        if (await editBtn.isVisible().catch(() => false)) {
            await editBtn.click({timeout: 3000, force: true}).catch(() => {});
        } else {
            // Fall back to the Play/Stop toggle.
            await playBtn.click({timeout: 3000, force: true}).catch(() => {});
        }
        await page.waitForTimeout(5000);
        await page.screenshot({path: resolve(outDir, "04-after-stop.png")}).catch(() => {});

        const stopErrors = report.consoleErrors.slice(stopMarkIdx);
        const wakeErrors = stopErrors.filter(e => WAKESOUND_RE.test(e.text));
        const disposeErrors = stopErrors.filter(e => DISPOSE_RE.test(e.text));
        if (wakeErrors.length || disposeErrors.length) {
            writeFileSync(resolve(outDir, "dispose-errors.json"), JSON.stringify({wakeErrors, disposeErrors}, null, 2));
        }
        assert("no-stopWakeSound-error-on-stop", wakeErrors.length === 0,
            `${wakeErrors.length}: ${wakeErrors[0]?.text.slice(0, 200) ?? ""}`);
        assert("no-behavior-dispose-errors-on-stop", disposeErrors.length === 0,
            `${disposeErrors.length}: ${disposeErrors[0]?.text.slice(0, 200) ?? ""}`);
    }

    // === Whole-run audit: the two concrete regression strings must never appear. ===
    const allDerivative = report.consoleErrors.filter(e => DERIVATIVE_RE.test(e.text));
    const allWake = report.consoleErrors.filter(e => WAKESOUND_RE.test(e.text));
    assert("no-derivative-errors-overall", allDerivative.length === 0, `${allDerivative.length}`);
    assert("no-stopWakeSound-errors-overall", allWake.length === 0, `${allWake.length}`);
    report.assetErrors = [...new Set(report.assetErrors)].slice(0, 20);
    if (report.assetErrors.length) writeFileSync(resolve(outDir, "asset-errors.json"), JSON.stringify(report.assetErrors, null, 2));
    assert("no-asset-load-failures", report.assetErrors.length === 0,
        `${report.assetErrors.length}: ${report.assetErrors[0]?.slice(0, 200) ?? ""}`);
    assert("no-uncaught-page-errors", report.pageErrors.length === 0,
        `${report.pageErrors.length}: ${report.pageErrors[0]?.message?.slice(0, 200) ?? ""}`);
    report.migrationLogs = [...new Set(report.migrationLogs)];
    assert("no-legacy-migration-in-oss", report.migrationLogs.length === 0,
        `${report.migrationLogs.length}: ${report.migrationLogs[0]?.slice(0, 200) ?? ""}`);
} catch (e) {
    logStep("FATAL", "error", {error: e.message, stack: e.stack?.slice(0, 600)});
    failures.push("fatal:" + e.message);
} finally {
    report.finishedAt = new Date().toISOString();
    report.failures = failures;
    writeFileSync(resolve(outDir, "report.json"), JSON.stringify(report, null, 2));
    console.log(`\n=== Report (pirate-ship, playground + filesystem) ===`);
    console.log(`Console errors:  ${report.consoleErrors.length}`);
    console.log(`Page errors:     ${report.pageErrors.length}`);
    console.log(`Asset errors:    ${report.assetErrors.length}`);
    console.log(`Migration logs:  ${report.migrationLogs.length}`);
    console.log(`Assertions:      ${Object.values(report.assertions).filter(a => a.pass).length}/${Object.keys(report.assertions).length} passed`);
    console.log(`Output dir:      ${outDir}`);
    await browser.close();
    if (failures.length > 0) { console.error(`\nFAIL: ${failures.length} failed: ${failures.join(", ")}`); process.exit(1); }
    console.log("\nPASS");
}
