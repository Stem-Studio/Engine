#!/usr/bin/env node
/**
 * OSS File System Access project-store roundtrip smoke.
 *
 * Uses OPFS as a picker-free File System Access directory handle, creates a
 * scratch project, saves it, verifies a `.stemscript.json` file was written,
 * then reopens the project from the dashboard and checks the editor scene
 * restores visible mesh content.
 *
 * Requires `bun run dev` on :5173. Set HEADED=1 to watch.
 */
import {chromium} from "playwright";
import {mkdirSync, writeFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "oss-filesystem-roundtrip-output");
mkdirSync(outDir, {recursive: true});

const baseUrl = (process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5173").replace(/\/$/, "");
const headed = process.env.HEADED === "1";
const fsFolderName = "stem-fs-roundtrip";

const report = {
    baseUrl,
    startedAt: new Date().toISOString(),
    assertions: {},
    steps: [],
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
};
const failures = [];

function logStep(name, status = "ok", details = {}) {
    report.steps.push({name, status, details, t: new Date().toISOString()});
    const tag = status === "ok" ? "✓" : status === "warn" ? "⚠" : "✗";
    console.log(`${tag} ${name}${Object.keys(details).length ? ` — ${JSON.stringify(details).slice(0, 200)}` : ""}`);
}

function assert(name, condition, detail = "") {
    report.assertions[name] = {pass: !!condition, detail};
    console.log(`${condition ? "✓" : "✗"} assert: ${name}${detail ? ` — ${detail}` : ""}`);
    if (!condition) failures.push(name);
}

const browser = await chromium.launch({headless: !headed});
const page = await (await browser.newContext({viewport: {width: 1440, height: 900}, serviceWorkers: "block"})).newPage();

page.on("console", m => {
    if (m.type() === "error") report.consoleErrors.push({text: m.text(), location: m.location()});
});
page.on("pageerror", e => report.pageErrors.push({message: e.message, stack: e.stack?.slice(0, 2000)}));
page.on("requestfailed", r => report.failedRequests.push({url: r.url(), method: r.method(), failure: r.failure()?.errorText}));
page.on("response", r => {
    const url = r.url();
    if (r.status() >= 400 && url.startsWith(baseUrl) && !/\/api\/AI\//.test(url)) {
        report.failedRequests.push({url, method: r.request().method(), status: r.status()});
    }
});

async function dismissOSSBootstrapModal() {
    const modal = page.locator('[aria-labelledby="oss-bootstrap-title"]').first();
    if ((await modal.count()) && (await modal.isVisible().catch(() => false))) {
        await modal.locator('button:has-text("Browser storage")').first().click({timeout: 3000, force: true}).catch(() => {});
        await modal.locator('button:has-text("Continue")').first().click({timeout: 5000, force: true}).catch(() => {});
        await page.waitForSelector('[aria-labelledby="oss-bootstrap-title"]', {state: "detached", timeout: 5000}).catch(() => {});
        await page.waitForTimeout(500);
        logStep("bootstrap modal dismissed before filesystem setup");
    }
}

async function dismissTutorialModal() {
    const gotIt = page.locator('button:has-text("Got It")').first();
    if ((await gotIt.count()) && (await gotIt.isVisible().catch(() => false))) {
        await gotIt.click({timeout: 3000}).catch(() => {});
        await page.waitForTimeout(300);
        logStep("tutorial dismissed");
    }
}

async function bootstrapFilesystemStore() {
    await page.evaluate(async (folderName) => {
        const root = await navigator.storage.getDirectory();
        try {
            await root.removeEntry(folderName, {recursive: true});
        } catch {
            // First run or already clean.
        }
        const fsRoot = await root.getDirectoryHandle(folderName, {create: true});
        await new Promise((resolve, reject) => {
            const req = indexedDB.open("stemstudio-fs-handle", 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains("handles")) db.createObjectStore("handles");
            };
            req.onsuccess = () => {
                const tx = req.result.transaction("handles", "readwrite");
                tx.objectStore("handles").put(fsRoot, "project-dir");
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            };
            req.onerror = () => reject(req.error);
        });
        localStorage.setItem("stemstudio.persistence.mode", "filesystem");
        localStorage.setItem("stemstudio.bootstrap.complete", "true");
    }, fsFolderName);
    logStep("filesystem OPFS handle persisted", "ok", {folder: fsFolderName});
}

async function inspectFilesystemProject(sceneId) {
    return page.evaluate(async ({folderName, id}) => {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle(folderName);
        const files = [];
        for await (const [name, handle] of dir.entries()) {
            if (handle.kind !== "file") continue;
            const file = await handle.getFile();
            files.push({name, size: file.size, text: await file.text()});
        }
        const projectFile = files.find(file => file.name.endsWith(".stemscript.json") && file.name.includes(`.${id}.`));
        if (!projectFile) return {files: files.map(({name, size}) => ({name, size})), project: null};
        const parsed = JSON.parse(projectFile.text);
        return {
            files: files.map(({name, size}) => ({name, size})),
            project: {
                id: parsed?.meta?.id,
                sceneJsonLength: typeof parsed?.sceneJson === "string" ? parsed.sceneJson.length : -1,
                hasCube: typeof parsed?.sceneJson === "string" && /cube/i.test(parsed.sceneJson),
            },
        };
    }, {folderName: fsFolderName, id: sceneId});
}

async function sceneMeshCount() {
    return page.evaluate(() => {
        const app = window.app || globalThis.app;
        const scene = app?.editor?.scene;
        if (!scene) return -1;
        let count = 0;
        scene.traverse(object => {
            if (object?.isMesh) count += 1;
        });
        return count;
    }).catch(() => -1);
}

try {
    await page.goto(baseUrl + "/dashboard", {waitUntil: "domcontentloaded", timeout: 30000});
    await page.waitForLoadState("networkidle", {timeout: 15000}).catch(() => {});
    await dismissOSSBootstrapModal();
    await bootstrapFilesystemStore();

    await page.goto(baseUrl + "/create/project", {waitUntil: "domcontentloaded", timeout: 30000});
    await page.waitForLoadState("networkidle", {timeout: 30000}).catch(() => {});
    await page.waitForTimeout(9000);
    await dismissTutorialModal();
    await page.screenshot({path: resolve(outDir, "01-editor-mounted.png")}).catch(() => {});

    const mode = await page.evaluate(() => localStorage.getItem("stemstudio.persistence.mode")).catch(() => null);
    assert("filesystem-mode-selected", mode === "filesystem", `persistence.mode=${mode}`);
    assert("editor-canvas-visible", await page.locator("canvas").first().isVisible().catch(() => false), "canvas missing");

    const libraryTab = page.locator('[data-testid="leftpanel-tab-library"]').first();
    if (await libraryTab.isVisible().catch(() => false)) {
        await libraryTab.click({timeout: 3000, force: true}).catch(() => {});
        await page.waitForTimeout(500);
    }
    const cubeIcon = page.locator('[data-testid="icon-item-cube"]').first();
    if (await cubeIcon.isVisible().catch(() => false)) {
        await cubeIcon.click({timeout: 3000, force: true}).catch(() => {});
        await page.waitForTimeout(1000);
        logStep("cube added");
    }

    const sceneId = (page.url().match(/\/create\/project\/([^/?#]+)/) || [])[1] || null;
    assert("scene-id-extracted", !!sceneId, page.url());
    assert("mesh-added-before-save", await sceneMeshCount() >= 1, "no mesh after cube add");

    await page.locator('[data-testid="topnav-app-menu"]').first().click({timeout: 3000, force: true}).catch(() => {});
    await page.waitForTimeout(400);
    const saveItem = page.locator("text=Save Project").first();
    assert("save-project-menu-visible", await saveItem.isVisible().catch(() => false), "Save Project not visible");
    if (await saveItem.isVisible().catch(() => false)) {
        await saveItem.click({timeout: 3000}).catch(() => {});
        await page.locator("text=/^Saved$/").first().waitFor({state: "visible", timeout: 30000}).catch(() => {});
        await page.waitForTimeout(1000);
        logStep("project saved to filesystem store");
    }

    if (sceneId) {
        const fsState = await inspectFilesystemProject(sceneId);
        logStep("filesystem project inspected", "ok", fsState);
        assert("filesystem-project-file-written", !!fsState.project, JSON.stringify(fsState.files));
        assert("filesystem-project-id-matches", fsState.project?.id === sceneId, `file id=${fsState.project?.id}`);
        assert("filesystem-scene-json-written", (fsState.project?.sceneJsonLength ?? -1) > 1000, `sceneJson=${fsState.project?.sceneJsonLength}`);
    }

    await page.goto(baseUrl + "/dashboard", {waitUntil: "domcontentloaded", timeout: 20000}).catch(() => {});
    await page.waitForLoadState("networkidle", {timeout: 15000}).catch(() => {});
    await page.waitForTimeout(2500);
    await page.screenshot({path: resolve(outDir, "02-dashboard.png")}).catch(() => {});

    if (sceneId) {
        const card = page.locator(`[data-scene-id="${sceneId}"]`).first();
        await card.waitFor({state: "attached", timeout: 30000}).catch(() => {});
        assert("saved-project-listed", (await card.count()) > 0, `sceneId=${sceneId}`);
        if (await card.count()) {
            const editButton = card.locator('[data-testid="game-card-edit"]').first();
            if (await editButton.isVisible().catch(() => false)) {
                await editButton.click({timeout: 5000, force: true}).catch(() => {});
            } else {
                await card.click({timeout: 5000, force: true}).catch(() => {});
            }
            await page.waitForLoadState("networkidle", {timeout: 30000}).catch(() => {});
            await page.waitForSelector("canvas", {timeout: 30000}).catch(() => {});
            await page.waitForTimeout(8000);
            await dismissTutorialModal();
        }
    }

    await page.screenshot({path: resolve(outDir, "03-reopened-editor.png")}).catch(() => {});
    assert("url-after-reopen-is-create", /\/create\/project\//.test(page.url()), page.url());
    assert("canvas-visible-after-reopen", await page.locator("canvas").first().isVisible().catch(() => false), "canvas missing after reopen");
    assert("mesh-restored-after-reopen", await sceneMeshCount() >= 1, `meshCount=${await sceneMeshCount()}`);

    const offending = report.failedRequests.filter(r => /\/api\//.test(r.url) && !/\/api\/AI\//.test(r.url));
    assert("no-integrated-api-failures", offending.length === 0, offending.map(r => r.url).join(", "));
} catch (error) {
    console.log(`✗ FATAL — ${error instanceof Error ? error.message : String(error)}`);
    failures.push(`fatal:${error instanceof Error ? error.message : String(error)}`);
} finally {
    writeFileSync(resolve(outDir, "report.json"), JSON.stringify({...report, finishedAt: new Date().toISOString()}, null, 2));
    await browser.close();
    if (failures.length) {
        console.error(`\nFAIL: ${failures.join(", ")}`);
        process.exit(1);
    }
    console.log("\nPASS: OSS filesystem project roundtrip succeeded.");
}
