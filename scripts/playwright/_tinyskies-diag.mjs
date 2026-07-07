#!/usr/bin/env node
// Parametrized import diagnostic. Isolates WHERE the import cost is.
//   KEEP=""              -> strip ALL `behavior attach` lines (imports-only)
//   KEEP="globeVisual,…" -> keep only attaches whose behaviorId ends with one of these
//   KEEP="*"             -> full script unchanged
//   MP=0                 -> force `game settings ... isMultiplayer=false`
// Reports wall-clock for each phase and whether the tab crashed.
import {chromium} from "playwright";
import {readFileSync, readdirSync, statSync, writeFileSync} from "node:fs";
import {join} from "node:path";

const ROOT = "/Users/n/erth/Games-StemScript/tinyskies";
const baseUrl = "http://localhost:5173";
const BUDGET_MS = parseInt(process.env.BUDGET_MIN ?? "8", 10) * 60 * 1000;
const KEEP = (process.env.KEEP ?? "").trim();
const MP = process.env.MP ?? "1";
const LABEL = process.env.LABEL || (KEEP === "*" ? "full" : KEEP === "" ? "imports-only" : "subset");
const LOG = `/tmp/tinyskies-diag-${LABEL}.log`;

function walk(dir, prefix = "") {
    const out = [];
    for (const e of readdirSync(dir)) {
        if (e === ".DS_Store" || e === ".git") continue;
        const abs = join(dir, e), rel = prefix ? `${prefix}/${e}` : e;
        if (statSync(abs).isDirectory()) out.push(...walk(abs, rel));
        else out.push({name: rel, abs});
    }
    return out;
}
const mimeFor = n => n.endsWith(".glb") ? "model/gltf-binary" : n.endsWith(".png") ? "image/png"
    : n.endsWith(".json") ? "application/json" : n.endsWith(".js") ? "text/javascript"
    : n.endsWith(".yaml") || n.endsWith(".yml") ? "text/yaml" : "text/plain";

const files = walk(ROOT);
const scriptFile = files.find(f => f.name.endsWith(".stemscript"));
const folderFiles = files.filter(f => f !== scriptFile)
    .map(f => ({name: f.name, mime: mimeFor(f.name), data: readFileSync(f.abs).toString("base64")}));

let scriptContent = readFileSync(scriptFile.abs, "utf8");
if (KEEP !== "*") {
    const keepSet = KEEP === "" ? [] : KEEP.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    scriptContent = scriptContent.split("\n").filter(line => {
        const a = line.match(/^\s*behavior\s+attach\b.*behaviorId="?([^"\s]+)"?/);
        if (a) { const id = a[1].toLowerCase(); return keepSet.some(k => id.endsWith("." + k) || id.endsWith(k) || id === k); }
        // When a specific KEEP set is given, also skip importing behaviors not in it.
        const imp = line.match(/^\s*import\s+behavior\b.*filepath="?([^"\s]+)"?/);
        if (imp && keepSet.length) { const fp = imp[1].toLowerCase(); return keepSet.some(k => fp.includes(k)); }
        return true;
    }).join("\n");
}
if (MP === "0") scriptContent = scriptContent.replace(/isMultiplayer=true/g, "isMultiplayer=false");

// IMPORT_LIMIT=N keeps only the first N `import behavior` lines (fast probe).
const IMPORT_LIMIT = parseInt(process.env.IMPORT_LIMIT ?? "0", 10);
if (IMPORT_LIMIT > 0) {
    let seen = 0;
    scriptContent = scriptContent.split("\n").filter(line => {
        if (/^\s*import\s+behavior\b/.test(line)) { seen++; return seen <= IMPORT_LIMIT; }
        return true;
    }).join("\n");
}

const t0 = Date.now();
const lines = [];
const rel = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(7);
const rec = (tag, text) => lines.push(`[${rel()}s] ${tag} ${text}`);

const browser = await chromium.launch({
    headless: process.env.HEADED !== "1",
    args: process.env.HEADED === "1"
        ? ["--ignore-gpu-blocklist", "--enable-gpu", "--enable-unsafe-webgpu"]
        : [],
});
const ctx = await browser.newContext({bypassCSP: true});
const page = await ctx.newPage();
let crashed = false;
page.on("crash", () => { crashed = true; rec("CRASH", "page crashed"); });
const errCounts = {};
const NOISE = /URLModifier|TSL: Vertex attribute|deprecat|ResizeObserver|\[Violation\]|WebGLProgram: Shader Error/i;
const KEEPMSG = /import|behavior|hang|skip|revis|dedup|fail|createAsset|getAsset|Behavior|ScriptImport|__stemRunScript/i;
page.on("console", m => {
    const tx = m.text();
    if (m.type() === "error") { const k = tx.slice(0, 80); errCounts[k] = (errCounts[k] || 0) + 1; }
    if (!NOISE.test(tx) && (m.type() === "error" || KEEPMSG.test(tx))) rec(m.type().toUpperCase().slice(0, 4), tx.slice(0, 220));
});
page.on("pageerror", e => rec("PAGEERR", (e.message || String(e)).slice(0, 200)));

const dismiss = async () => {
    for (const t of ["Browser storage", "Continue", "Got it", "Skip", "Start from scratch"]) {
        const b = page.locator(`button:has-text("${t}")`).first();
        if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
    }
};

try {
    const attachCount = (scriptContent.match(/^\s*behavior\s+attach\b/gm) || []).length;
    rec("CFG", `LABEL=${LABEL} KEEP="${KEEP}" MP=${MP} attaches=${attachCount} files=${folderFiles.length}`);
    await page.goto(baseUrl + "/dashboard?mode=playground", {waitUntil: "domcontentloaded", timeout: 30000});
    await page.waitForLoadState("networkidle", {timeout: 15000}).catch(() => {});
    await dismiss();
    await page.goto(baseUrl + "/create/project", {waitUntil: "domcontentloaded", timeout: 30000});
    await page.waitForLoadState("networkidle", {timeout: 15000}).catch(() => {});
    await dismiss();
    await page.waitForTimeout(6000);
    await dismiss();
    await page.locator('[data-testid="actionbar-copilot"]').first().click({timeout: 5000, force: true}).catch(() => {});
    await page.waitForTimeout(2000);
    const hook = await page.evaluate(() => typeof window.__stemRunScript === "function");
    rec("STEP", `hook=${hook}`);
    if (!hook) throw new Error("no hook");

    rec("STEP", "import START");
    await page.evaluate(({content, fileList}) => {
        window.__d = null;
        window.__stemRunScript(content, fileList).then(
            s => { window.__d = {ok: true, summary: s}; },
            e => { window.__d = {ok: false, err: String(e && e.message ? e.message : e)}; });
    }, {content: scriptContent, fileList: folderFiles}).catch(() => {});

    let res = null;
    const deadline = Date.now() + BUDGET_MS;
    while (Date.now() < deadline && !crashed) {
        res = await page.evaluate(() => window.__d).catch(() => null);
        if (res) break;
        await page.waitForTimeout(2000);
    }
    rec("STEP", `import DONE resolved=${!!res} crashed=${crashed} ${JSON.stringify(res)}`);

    const timings = await page.evaluate(() => window.__stemImportTimings || []).catch(() => []);
    // group by type with totals; list slowest individual imports
    const byType = {};
    for (const t of timings) { (byType[t.type] ||= {n: 0, ms: 0, fail: 0}); byType[t.type].n++; byType[t.type].ms += t.ms; if (!t.success) byType[t.type].fail++; }
    rec("TIMINGS", `byType=${JSON.stringify(byType)}`);
    const slow = [...timings].sort((a, b) => b.ms - a.ms).slice(0, 10);
    for (const t of slow) rec("SLOW", `${t.ms}ms ${t.type} "${t.label}" ok=${t.success} ${t.success ? "" : t.message}`);
    const fails = timings.filter(t => !t.success);
    for (const t of fails) rec("IMPFAIL", `${t.type} "${t.label}" :: ${t.message}`);

    const cmds = await page.evaluate(() => window.__stemCmdTimings || []).catch(() => []);
    const slowCmds = [...cmds].sort((a, b) => b.ms - a.ms).slice(0, 15);
    for (const c of slowCmds) rec("CMD", `${c.ms}ms ${c.cmd} ok=${c.ok} :: ${c.raw}`);

    const bhv = await page.evaluate(() => window.__stemBhvTimings || {}).catch(() => ({}));
    rec("BHVSPLIT", JSON.stringify(Object.fromEntries(Object.entries(bhv).map(([k, v]) => [k, Math.round(v)]))));

    if (!crashed) {
        const counts = await page.evaluate(() => {
            const ed = (window.app || globalThis.app)?.editor;
            let objs = 0; const names = [];
            try { (ed?.scene)?.traverse?.(o => { objs++; if (o.name && names.length < 50) names.push(o.name); }); } catch {}
            return {objs, names};
        }).catch(() => ({objs: -1, names: []}));
        rec("STEP", `scene objects=${counts.objs}`);
        rec("STEP", `names: ${[...new Set(counts.names)].join(", ")}`);
        // Scrape terminal error entries (runScript addEntry "Line N: ...").
        const termErrs = await page.evaluate(() => {
            const out = [];
            for (const el of document.querySelectorAll("body *")) {
                const t = el.childElementCount === 0 ? (el.textContent || "") : "";
                if (/^Line \d+:/.test(t.trim())) out.push(t.trim().slice(0, 200));
            }
            return [...new Set(out)].slice(0, 40);
        }).catch(() => []);
        for (const e of termErrs) rec("TERMERR", e);
        await page.screenshot({path: `/tmp/tinyskies-diag-${LABEL}.png`}).catch(() => {});

        if (process.env.PLAY === "1") {
            const playErrs = [];
            page.on("console", m => { if (m.type() === "error" && !NOISE.test(m.text())) playErrs.push(m.text().slice(0, 160)); });
            const playBtn = page.locator('[data-testid="topnav-play"]').first();
            if (await playBtn.isVisible().catch(() => false)) {
                let startCdp = null;
                if (process.env.PROFILE_START === "1") {
                    startCdp = await page.context().newCDPSession(page);
                    await startCdp.send("Profiler.enable");
                    await startCdp.send("Profiler.setSamplingInterval", {interval: 300});
                    await startCdp.send("Profiler.start");
                }
                await playBtn.click({timeout: 3000, force: true}).catch(() => {});
                const dontSave = page.locator("button", {hasText: /don['’]t\s*save/i}).first();
                if (await dontSave.isVisible().catch(() => false)) { await dontSave.click().catch(() => {}); }
                // Measure UI responsiveness DURING the play-start build: sample rAF
                // gaps. If the build blocks the main thread, there's one multi-second
                // gap; if it yields progressively, gaps stay small.
                await page.evaluate(() => {
                    window.__startFrames = []; let last = performance.now();
                    const tick = () => { const n = performance.now(); window.__startFrames.push(n - last); last = n; if (window.__startFrames.length < 3000) requestAnimationFrame(tick); };
                    requestAnimationFrame(tick);
                }).catch(() => {});
                await page.waitForTimeout(12000);
                const sf = await page.evaluate(() => window.__startFrames || []).catch(() => []);
                const sMax = Math.max(0, ...sf); const sLong = sf.filter(f => f > 100).length;
                rec("STARTUP", `playStart rAF frames=${sf.length} maxGap=${sMax.toFixed(0)}ms gaps>100ms=${sLong}`);
                const measures = await page.evaluate(() =>
                    performance.getEntriesByType("measure").filter(m => /scene-|precompile|gameCreate|physics/i.test(m.name))
                        .map(m => [m.name, Math.round(m.duration)]).sort((a, b) => b[1] - a[1]).slice(0, 14)
                ).catch(() => []);
                rec("STAGES", JSON.stringify(measures));
                if (startCdp) {
                    const prof = await startCdp.send("Profiler.stop");
                    const nodes = new Map(); for (const n of prof.profile.nodes) nodes.set(n.id, n);
                    const self = new Map();
                    for (const id of prof.profile.samples) { const n = nodes.get(id); if (!n) continue; const cf = n.callFrame;
                        const key = `${cf.functionName || "(anon)"} @ ${(cf.url || "").split("/").slice(-1)[0]}:${cf.lineNumber}`;
                        self.set(key, (self.get(key) || 0) + 1); }
                    const tot = prof.profile.samples.length || 1;
                    for (const [k, c] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22)) rec("STARTPROF", `${(100 * c / tot).toFixed(1)}% ${k}`);
                    await startCdp.detach().catch(() => {});
                }
                const start = page.locator("#startGameBtn").first();
                if (await start.isVisible().catch(() => false)) { await start.click({force: true}).catch(() => {}); rec("PLAY", "clicked START"); }
                await page.waitForTimeout(4000);
                // CPU profile of the play loop to find per-frame jank.
                if (process.env.PROFILE === "1") {
                    const cdp = await page.context().newCDPSession(page);
                    await cdp.send("Profiler.enable");
                    await cdp.send("Profiler.setSamplingInterval", {interval: 200});
                    await cdp.send("Profiler.start");
                    // also measure rAF frame deltas in-page
                    await page.evaluate(() => {
                        window.__frames = [];
                        let last = performance.now();
                        const tick = () => {
                            const n = performance.now(); window.__frames.push(n - last); last = n;
                            if (window.__frames.length < 600) requestAnimationFrame(tick);
                        };
                        requestAnimationFrame(tick);
                    });
                    await page.waitForTimeout(8000);
                    const prof = await cdp.send("Profiler.stop");
                    // aggregate self-time by function (id->node), using sample counts
                    const nodes = new Map();
                    for (const n of prof.profile.nodes) nodes.set(n.id, n);
                    const self = new Map();
                    for (const id of prof.profile.samples) {
                        const n = nodes.get(id); if (!n) continue;
                        const cf = n.callFrame;
                        const key = `${cf.functionName || "(anon)"} @ ${(cf.url || "").split("/").slice(-1)[0]}:${cf.lineNumber}`;
                        self.set(key, (self.get(key) || 0) + 1);
                    }
                    const totalSamples = prof.profile.samples.length || 1;
                    const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
                    for (const [k, c] of top) rec("PROF", `${(100 * c / totalSamples).toFixed(1)}% ${k}`);
                    const frames = await page.evaluate(() => window.__frames || []);
                    const long = frames.filter(f => f > 20).length;
                    const max = Math.max(0, ...frames);
                    const avg = frames.reduce((a, b) => a + b, 0) / (frames.length || 1);
                    rec("FRAMES", `n=${frames.length} avg=${avg.toFixed(1)}ms max=${max.toFixed(1)}ms long(>20ms)=${long}`);
                    // long-frame timeline: index + ms, to see if big stalls recur
                    const longList = frames.map((f, i) => [i, f]).filter(([, f]) => f > 20)
                        .map(([i, f]) => `#${i}:${f.toFixed(0)}ms`).join(" ");
                    rec("LONGFRAMES", longList || "(none)");
                }
                // Render metrics + per-behavior-root mesh/material breakdown.
                const metrics = await page.evaluate(() => {
                    const app = window.app || globalThis.app;
                    const r = app?.renderer;
                    const info = r?.info ? {
                        calls: r.info.render?.calls, tris: r.info.render?.triangles,
                        geometries: r.info.memory?.geometries, textures: r.info.memory?.textures,
                        programs: r.info.programs?.length,
                    } : null;
                    // group meshes by nearest named ancestor (the behavior root group)
                    const sc = app?.scene; const byRoot = {}; const mats = new Set(); let inst = 0, mesh = 0;
                    const rootName = (o) => { let p = o; while (p) { if (p.name && /^tinyskies|Globe|Plane|Starfield|Aurora|GodRays|FloatingLanterns|MeteorShower|Contrails|BoostRings|SkyGremlins|VehicleSwitcher|Progression|PackageQuest|RemotePlayers|ControlsHud|PaintballManager|DayNightCycle/.test(p.name)) return p.name; p = p.parent; } return "(other)"; };
                    const matByRoot = {};
                    try { sc?.traverse?.(o => {
                        if (o.isInstancedMesh) { inst++; return; }
                        if (o.isMesh) { mesh++; const rn = rootName(o); byRoot[rn] = (byRoot[rn] || 0) + 1;
                            const m = o.material; (Array.isArray(m) ? m : [m]).forEach(x => { if (x) { mats.add(x.uuid); (matByRoot[rn] ||= new Set()).add(x.uuid); } }); }
                    }); } catch {}
                    const matRoots = Object.entries(matByRoot).map(([k, v]) => [k, v.size]).sort((a,b)=>b[1]-a[1]).slice(0, 12);
                    var matRootsOut = matRoots;
                    // sample names for "(other)" meshes to identify them
                    var otherSample = [];
                    try { sc?.traverse?.(o => {
                        if (o.isMesh && !o.isInstancedMesh && rootName(o) === "(other)" && otherSample.length < 25) {
                            otherSample.push(`${o.name || "?"}<${o.parent?.name || "?"}<${o.parent?.parent?.name || "?"}`);
                        }
                    }); } catch {}
                    const topRoots = Object.entries(byRoot).sort((a,b)=>b[1]-a[1]).slice(0, 18);
                    return {info, instancedMeshes: inst, individualMeshes: mesh, uniqueMaterials: mats.size, topRoots, matRoots: matRootsOut, otherSample};
                }).catch(() => null);
                rec("METRICS", JSON.stringify(metrics?.info));
                rec("MESHES", `instanced=${metrics?.instancedMeshes} individual=${metrics?.individualMeshes} uniqueMaterials=${metrics?.uniqueMaterials}`);
                rec("BYROOT", JSON.stringify(metrics?.topRoots));
                rec("MATBYROOT", JSON.stringify(metrics?.matRoots));
                rec("OTHER", JSON.stringify(metrics?.otherSample));
                await page.waitForTimeout(2000);
                await page.screenshot({path: `/tmp/tinyskies-diag-${LABEL}-play.png`}).catch(() => {});
                const playObjs = await page.evaluate(() => {
                    const sc = (window.app || globalThis.app)?.scene; let n = 0; try { sc?.traverse?.(() => n++); } catch {} return n;
                }).catch(() => -1);
                rec("PLAY", `play scene objects=${playObjs} playErrors=${[...new Set(playErrs)].length}`);
                for (const e of [...new Set(playErrs)].slice(0, 12)) rec("PLAYERR", e);
            } else rec("PLAY", "no play button");
        }
    }
} catch (e) {
    rec("FATAL", (e.message || String(e)).slice(0, 200));
} finally {
    rec("ERRORS", JSON.stringify(errCounts));
    writeFileSync(LOG, lines.join("\n"));
    console.log(lines.join("\n"));
    await browser.close().catch(() => {});
}
