// Open a game in the real /playground iframe, enter Play mode, and capture
// what renders + the full console during play.
import {chromium} from "playwright";
import {readdirSync, statSync, readFileSync, mkdirSync, existsSync} from "node:fs";
import {join, resolve, dirname} from "node:path";
import {fileURLToPath} from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "verify-playground-play-output");
mkdirSync(outDir, {recursive: true});
const baseUrl = (process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5173").replace(/\/$/, "");
const projectsDir = process.env.GAMES_ROOT
    || (existsSync("/Volumes/ORICO/Stem Studio - OSS/stemstudio-projects")
        ? "/Volumes/ORICO/Stem Studio - OSS/stemstudio-projects"
        : "/Users/n/Documents/stemstudio-projects");

const walk = (root, prefix = "") => readdirSync(root).flatMap(e => {
    if (e === ".DS_Store") return [];
    const abs = join(root, e);
    const rel = prefix ? `${prefix}/${e}` : e;
    return statSync(abs).isDirectory() ? walk(abs, rel) : [{path: rel, abs}];
});
const projectFiles = walk(projectsDir);
const targetId = process.env.TARGET_ID
    || projectFiles
        .map(file => file.path.match(/\.(oss-[^.]+)\.stemscript\.json$/)?.[1])
        .find(Boolean);
if (!targetId) throw new Error(`No .stemscript.json project found under ${projectsDir}; set TARGET_ID explicitly`);
const files = projectFiles.map(f => ({path: f.path, b64: readFileSync(f.abs).toString("base64")}));

const browser = await chromium.launch({headless: true});
const page = await (await browser.newContext({viewport: {width: 1440, height: 900}})).newPage();
const lines = [];
page.on("console", m => lines.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", e => lines.push(`[pageerror] ${e.message}`));

const ef = () => page.frames().find(f => f !== page.mainFrame() && /\/(dashboard|create|play)/.test(f.url())) || page.mainFrame();

try {
    await page.goto(`${baseUrl}/dashboard`, {waitUntil: "domcontentloaded", timeout: 30000});
    await page.waitForTimeout(2000);
    await page.evaluate(async ({files}) => {
        const root = await navigator.storage.getDirectory();
        try { await root.removeEntry("stem-fs", {recursive: true}); } catch {}
        const fsRoot = await root.getDirectoryHandle("stem-fs", {create: true});
        for (const f of files) {
            const parts = f.path.split("/");
            let dir = fsRoot;
            for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i], {create: true});
            const fh = await dir.getFileHandle(parts[parts.length - 1], {create: true});
            const w = await fh.createWritable();
            const bin = atob(f.b64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            await w.write(bytes); await w.close();
        }
        await new Promise((res, rej) => {
            const req = indexedDB.open("stemstudio-fs-handle", 1);
            req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains("handles")) db.createObjectStore("handles"); };
            req.onsuccess = () => { const tx = req.result.transaction("handles", "readwrite"); tx.objectStore("handles").put(fsRoot, "project-dir"); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); };
            req.onerror = () => rej(req.error);
        });
        localStorage.setItem("stemstudio.persistence.mode", "filesystem");
        localStorage.setItem("stemstudio.bootstrap.complete", "true");
    }, {files});

    // Open /playground, open the 2048 game.
    await page.goto(`${baseUrl}/playground`, {waitUntil: "domcontentloaded", timeout: 30000});
    await page.waitForTimeout(8000);
    let f = ef();
    const card = f.locator(`[data-scene-id="${targetId}"]`).first();
    if (await card.count()) {
        const eb = card.locator('text=/^edit$/i').first();
        if (await eb.count()) await eb.click({timeout: 5000}).catch(() => {});
        else await card.click({timeout: 5000}).catch(() => {});
    }
    await page.waitForTimeout(14000);
    f = ef();
    // Dismiss tutorial modal.
    const gotIt = f.locator('text=/got it/i').first();
    if (await gotIt.count() && await gotIt.isVisible().catch(() => false)) {
        await gotIt.click({timeout: 3000}).catch(() => {});
        await page.waitForTimeout(1500);
    }
    await page.screenshot({path: resolve(outDir, "1-editor.png")});

    // Enter Play mode — toolbar has Play / Share / Edit.
    lines.length = 0;
    f = ef();
    const playBtn = f.locator('button:has-text("Play"), [role="button"]:has-text("Play")').first();
    const anyPlay = f.locator('text=/^play$/i').first();
    if (await playBtn.count()) await playBtn.click({timeout: 5000}).catch(() => {});
    else if (await anyPlay.count()) await anyPlay.click({timeout: 5000}).catch(() => {});
    else console.log("!! no Play button found");
    await page.waitForTimeout(10000);
    await page.screenshot({path: resolve(outDir, "2-play.png")});

    // If a START GAME button appears, click it.
    f = ef();
    const startBtn = f.locator('text=/start game/i').first();
    if (await startBtn.count() && await startBtn.isVisible().catch(() => false)) {
        await startBtn.click({timeout: 4000}).catch(() => {});
        console.log("clicked START GAME");
        await page.waitForTimeout(7000);
    } else {
        console.log("no START GAME button visible in play");
    }
    await page.screenshot({path: resolve(outDir, "3-play-running.png")});

    console.log("=== console during play ===");
    const interesting = lines.filter(l => /behavior|Behavior|texture|Texture|asset|Asset|playMode|PLAY|sandbox|Sandbox|error|Error|fail|Fail|uikit|UIKit|2048/i.test(l));
    interesting.slice(0, 40).forEach(l => console.log("  " + l.slice(0, 220)));
    console.log("--- total console lines:", lines.length, "| pageerrors:", lines.filter(l => l.startsWith("[pageerror]")).length);
    console.log("Screenshots:", outDir);
} catch (e) {
    console.error("FATAL", e.message);
} finally {
    await browser.close();
}
