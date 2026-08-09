#!/usr/bin/env node
// Parametrized import diagnostic. Isolates WHERE the import cost is.
//   KEEP=""              -> strip ALL `behavior attach` lines (imports-only)
//   KEEP="globeVisual,…" -> keep only attaches whose behaviorId ends with one of these
//   KEEP="*"             -> full script unchanged
//   PLAY=1                -> defaults to KEEP="*" unless KEEP is explicitly supplied
//   MP=0                 -> force `game settings ... isMultiplayer=false`
//   SKIP_MODELS=1        -> strip model imports/placements for behavior startup probes
//   PLAY_WAIT_MS=20000   -> bounded wait after Play dispatch before collecting startup timings
//   PLAY_EXIT_AFTER_STARTUP=1 -> collect startup timings then skip play-loop metrics
//   EVAL_TIMEOUT_MS=3000 -> timeout for post-start page.evaluate diagnostics
//   RUNTIME_REVEAL_DEBUG=1 -> enable runtimeSceneReveal long-frame attribution logs before Play
//   RUNTIME_REVEAL_DEBUG_LIMIT=64 -> number of reveal long-frame attribution logs to keep
//   RUNTIME_REVEAL_TARGET_GAP_MS=N -> force play-mode runtime reveal target frame gap
//   RUNTIME_REVEAL_COOLDOWN_FRAMES=N -> force play-mode runtime reveal max cooldown frames
//   RUNTIME_REVEAL_BATCH_SIZE=N -> force play-mode runtime reveal batch size
//   RUNTIME_REVEAL_BATCH_WEIGHT=N -> force play-mode runtime reveal batch weight budget
//   RUNTIME_REVEAL_PRECOMPILE=0|1 -> force play-mode runtime reveal compileAsync off/on
//   RUNTIME_REVEAL_PROGRESSIVE_INSTANCED=0|1 -> force progressive InstancedMesh reveal counts off/on
//   RUNTIME_REVEAL_PROGRESSIVE_INSTANCED_UPLOADS=0|1 -> force staged InstancedMesh buffer uploads off/on
//   RUNTIME_REVEAL_RAMP_INSTANCED_FIRST=0|1 -> force legacy ramp-before-next-object reveal ordering off/on
//   RUNTIME_REVEAL_INSTANCED_TRIANGLE_BUDGET=N -> force per-frame submitted-triangle budget for instanced reveal count ramps
//   RUNTIME_MATERIAL_BUDGET=0|1 -> force play-mode runtime material budget off/on before Play
//   RUNTIME_MATERIAL_SHARING=0|1 -> force equivalent simple runtime material sharing off/on before Play
//   RUNTIME_INSTANCING_TOTAL_TRIANGLES=N -> force play-mode total instanced submitted-triangle budget
//   RUNTIME_INSTANCING_MESH_TRIANGLES=N -> force play-mode per-instanced-mesh submitted-triangle budget
//   CLICK_METHOD=mouse -> dispatch a low-level mouse click at the Play button center
//   APP_EVENT_PROFILE=1 -> collect opt-in per-callback app event timings
//   BEHAVIOR_PROFILE=1 -> enable the runtime behavior profiler during Play
//   LAMBDA_PROFILE=1 -> enable the runtime lambda profiler during Play
//   TIMER_PROFILE=1 -> trace long opt-in setTimeout/setInterval callbacks
//   PERF_GATE=1 -> fail when startup or steady-state frame budgets regress
// Reports wall-clock for each phase and whether the tab crashed.
import {chromium} from "playwright";
import {readFileSync, readdirSync, statSync, writeFileSync} from "node:fs";
import {join} from "node:path";

const ROOT = "/Users/n/erth/Games-StemScript/tinyskies";
const baseUrl = process.env.BASE_URL || "http://localhost:5173";
const BUDGET_MS = parseInt(process.env.BUDGET_MIN ?? "8", 10) * 60 * 1000;
// A Play-mode probe must execute authored behavior attachments. Keep the
// imports-only mode available explicitly with KEEP="" for cost isolation.
const KEEP = process.env.KEEP !== undefined
    ? process.env.KEEP.trim()
    : process.env.PLAY === "1"
        ? "*"
        : "";
const MP = process.env.MP ?? "1";
const SKIP_MODELS = process.env.SKIP_MODELS === "1";
const PLAY_WAIT_MS = parseInt(process.env.PLAY_WAIT_MS ?? "20000", 10);
const PLAY_CLICK_TIMEOUT_MS = parseInt(process.env.PLAY_CLICK_TIMEOUT_MS ?? "3000", 10);
const PLAY_EXIT_AFTER_STARTUP = process.env.PLAY_EXIT_AFTER_STARTUP === "1";
const EVAL_TIMEOUT_MS = parseInt(process.env.EVAL_TIMEOUT_MS ?? "3000", 10);
const viewport = (() => {
    const raw = process.env.VIEWPORT || "1440x900";
    const match = raw.match(/^(\d+)x(\d+)$/i);
    if (!match) throw new Error(`VIEWPORT must be WIDTHxHEIGHT, received ${raw}`);
    return {width: Number(match[1]), height: Number(match[2])};
})();
const RUNTIME_REVEAL_DEBUG = process.env.RUNTIME_REVEAL_DEBUG === "1";
const RUNTIME_REVEAL_DEBUG_LIMIT = parseInt(process.env.RUNTIME_REVEAL_DEBUG_LIMIT ?? "64", 10);
const RUNTIME_REVEAL_TARGET_GAP_MS = process.env.RUNTIME_REVEAL_TARGET_GAP_MS;
const RUNTIME_REVEAL_COOLDOWN_FRAMES = process.env.RUNTIME_REVEAL_COOLDOWN_FRAMES;
const RUNTIME_REVEAL_BATCH_SIZE = process.env.RUNTIME_REVEAL_BATCH_SIZE;
const RUNTIME_REVEAL_BATCH_WEIGHT = process.env.RUNTIME_REVEAL_BATCH_WEIGHT;
const RUNTIME_REVEAL_PRECOMPILE = process.env.RUNTIME_REVEAL_PRECOMPILE;
const RUNTIME_REVEAL_PROGRESSIVE_INSTANCED = process.env.RUNTIME_REVEAL_PROGRESSIVE_INSTANCED;
const RUNTIME_REVEAL_PROGRESSIVE_INSTANCED_UPLOADS = process.env.RUNTIME_REVEAL_PROGRESSIVE_INSTANCED_UPLOADS;
const RUNTIME_REVEAL_RAMP_INSTANCED_FIRST = process.env.RUNTIME_REVEAL_RAMP_INSTANCED_FIRST;
const RUNTIME_REVEAL_INSTANCED_TRIANGLE_BUDGET = process.env.RUNTIME_REVEAL_INSTANCED_TRIANGLE_BUDGET;
const RUNTIME_MATERIAL_BUDGET = process.env.RUNTIME_MATERIAL_BUDGET;
const RUNTIME_MATERIAL_SHARING = process.env.RUNTIME_MATERIAL_SHARING;
const RUNTIME_INSTANCING_TOTAL_TRIANGLES = process.env.RUNTIME_INSTANCING_TOTAL_TRIANGLES;
const RUNTIME_INSTANCING_MESH_TRIANGLES = process.env.RUNTIME_INSTANCING_MESH_TRIANGLES;
const APP_EVENT_PROFILE = process.env.APP_EVENT_PROFILE === "1";
const BEHAVIOR_PROFILE = process.env.BEHAVIOR_PROFILE === "1";
const LAMBDA_PROFILE = process.env.LAMBDA_PROFILE === "1";
const TIMER_PROFILE = process.env.TIMER_PROFILE === "1";
const PLAY_STOP_CYCLES = Math.max(0, Number(process.env.PLAY_STOP_CYCLES || 0));
const FORCE_GC = process.env.FORCE_GC === "1";
const PROFILE_STOP = process.env.PROFILE_STOP === "1";
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
if (SKIP_MODELS) {
    scriptContent = scriptContent.split("\n").filter(line => !/^\s*(import|place)\s+model\b/.test(line)).join("\n");
}

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
const rec = (tag, text) => {
    const entry = `[${rel()}s] ${tag} ${text}`;
    lines.push(entry);
    if (process.env.LIVE_LOG === "1") console.log(entry);
};

function profileCallFrameLabel(callFrame) {
    const url = callFrame?.url || "";
    const file = url ? url.split("/").slice(-1)[0] : "(runtime)";
    const line = Number.isFinite(callFrame?.lineNumber) ? callFrame.lineNumber + 1 : 0;
    return `${callFrame?.functionName || "(anon)"} @ ${file}:${line}`;
}

function topProfileSelfTime(profile, limit = 25) {
    const nodes = new Map();
    for (const node of profile?.nodes || []) {
        nodes.set(node.id, node);
    }

    const samples = profile?.samples || [];
    const timeDeltas = profile?.timeDeltas || [];
    const selfMs = new Map();
    let totalMs = 0;

    for (let i = 0; i < samples.length; i++) {
        const node = nodes.get(samples[i]);
        if (!node) continue;
        const deltaMs = Number.isFinite(timeDeltas[i]) && timeDeltas[i] > 0
            ? timeDeltas[i] / 1000
            : 1;
        const label = profileCallFrameLabel(node.callFrame);
        selfMs.set(label, (selfMs.get(label) || 0) + deltaMs);
        totalMs += deltaMs;
    }

    return [...selfMs.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([label, ms]) => ({label, ms, pct: totalMs > 0 ? (100 * ms) / totalMs : 0}));
}

async function stopAndRecordStartupProfile(cdp, tag = "STARTPROF") {
    if (!cdp) return;
    try {
        const prof = await cdp.send("Profiler.stop");
        const profilePath = `/tmp/tinyskies-diag-${LABEL}-${tag.toLowerCase()}.cpuprofile`;
        writeFileSync(profilePath, JSON.stringify(prof.profile));
        rec(tag, `saved=${profilePath}`);
        for (const entry of topProfileSelfTime(prof.profile, 25)) {
            rec(tag, `${entry.ms.toFixed(1)}ms ${entry.pct.toFixed(1)}% ${entry.label}`);
        }
    } catch (error) {
        rec(tag, `failed=${String(error?.message || error).slice(0, 160)}`);
    } finally {
        await cdp.detach().catch(() => {});
    }
}

const browser = await chromium.launch({
    headless: process.env.HEADED !== "1",
    args: [
        ...(process.env.HEADED === "1" ? ["--ignore-gpu-blocklist", "--enable-gpu", "--enable-unsafe-webgpu"] : []),
        ...(FORCE_GC ? ["--js-flags=--expose-gc"] : []),
    ],
});
const ctx = await browser.newContext({bypassCSP: true, viewport});
const page = await ctx.newPage();
rec("VIEWPORT", JSON.stringify(viewport));
await page.addInitScript(() => {
    const install = () => {
        const app = window.app || globalThis.app;
        if (!app || app.__diagLoopTraceWrapped) return;
        app.__diagLoopTrace = [];
        const record = name => app.__diagLoopTrace.push({name, t: Math.round(performance.now()), renderer: app.renderer?.constructor?.name, appliedRenderer: app.appliedAnimationLoopRenderer === app.renderer, appliedCallback: app.appliedAnimationLoopCallback !== null, legacyCallback: app.legacyAnimationLoopCallback !== null, stack: new Error().stack?.split("\n").slice(2, 5)});
        for (const name of ["startScheduledAnimationLoop", "stopScheduledAnimationLoop", "setLegacyAnimationLoopCallback"]) {
            const original = app[name];
            if (typeof original !== "function") continue;
            app[name] = function(...args) { record(name); return original.apply(this, args); };
        }
        app.__diagLoopTraceWrapped = true;
    };
    setInterval(install, 50);
});
let crashed = false;
page.on("crash", () => { crashed = true; rec("CRASH", "page crashed"); });
const errCounts = {};
const NOISE = /URLModifier|TSL: Vertex attribute|deprecat|ResizeObserver|\[Violation\]|WebGLProgram: Shader Error/i;
const KEEPMSG = /import|behavior|hang|skip|revis|dedup|fail|createAsset|getAsset|AssetLoader|loadModel|ModelLoader|No suitable|Behavior|ScriptImport|PlayStartupTiming|RenderEvent|Long animation frame|BatchManager|RuntimeInstancingBudget|RuntimeMaterialBudget|RuntimeSceneReveal|__stemRunScript/i;
page.on("console", m => {
    const tx = m.text();
    if (m.type() === "error") { const k = tx.slice(0, 80); errCounts[k] = (errCounts[k] || 0) + 1; }
    if (!NOISE.test(tx) && (m.type() === "error" || KEEPMSG.test(tx))) {
        const limit = tx.includes("[RuntimeSceneReveal] Long frame after reveal batch") ? 1200 : 220;
        rec(m.type().toUpperCase().slice(0, 4), tx.slice(0, limit));
    }
});
page.on("pageerror", e => rec("PAGEERR", (e.message || String(e)).slice(0, 200)));

const dismiss = async () => {
    for (const t of ["Browser storage", "Continue", "Got it", "Skip", "Start from scratch"]) {
        const b = page.locator(`button:has-text("${t}")`).first();
        if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
    }
};

const evalWithTimeout = async (label, fn, fallback, timeoutMs = 2000) => {
    const result = await Promise.race([
        page.evaluate(fn).then(
            value => ({type: "value", value}),
            error => ({type: "error", error}),
        ),
        new Promise(resolve => setTimeout(() => resolve({type: "timeout"}), timeoutMs)),
    ]);
    if (result.type === "timeout") {
        rec("EVALTIMEOUT", `${label} after ${timeoutMs}ms`);
        return fallback;
    }
    if (result.type === "error") {
        return fallback;
    }
    return result.value;
};

const installStartupResponsivenessMonitor = () => {
    window.__startFrames = [];
    window.__startFrameEvents = [];
    window.__startLongTasks = [];
    window.__STEM_CAPTURE_RENDER_FRAME_HISTORY__ = true;
    window.__STEM_RENDER_FRAME_HISTORY__ = [];
    window.__STEM_RUNTIME_REVEAL_FRAME_HISTORY__ = [];
    window.__startMonitorStart = performance.now();
    window.__startFrameRecording = true;
    window.__startFrameStopAt = null;
    window.__startFrameMonitorToken = (window.__startFrameMonitorToken || 0) + 1;
    const token = window.__startFrameMonitorToken;
    window.__startFrameLast = window.__startMonitorStart;

    try {
        window.__startLongTaskObserver?.disconnect?.();
    } catch {}
    window.__startLongTaskObserver = null;
    if (typeof PerformanceObserver === "function") {
        try {
            const observer = new PerformanceObserver(list => {
                if (window.__startFrameRecording === false || window.__startFrameMonitorToken !== token) return;
                for (const entry of list.getEntries()) {
                    const startedAt = entry.startTime;
                    const duration = entry.duration;
                    window.__startLongTasks.push({
                        name: entry.name,
                        entryType: entry.entryType,
                        startedAt,
                        endedAt: startedAt + duration,
                        duration,
                        sinceStart: startedAt - window.__startMonitorStart,
                        attribution: Array.from(entry.attribution || []).map(item => ({
                            name: item.name,
                            entryType: item.entryType,
                            containerType: item.containerType,
                            containerName: item.containerName,
                            containerId: item.containerId,
                            containerSrc: item.containerSrc,
                        })),
                    });
                }
            });
            observer.observe({entryTypes: ["longtask"]});
            window.__startLongTaskObserver = observer;
        } catch {}
    }

    window.__stopStartFrameMonitor = () => {
        const n = performance.now();
        if (window.__startFrameRecording !== false) {
            const last = window.__startFrameLast || n;
            const gap = n - last;
            if (gap >= 0) {
                window.__startFrames.push(gap);
                if (gap > 50) {
                    window.__startFrameEvents.push({
                        gap,
                        startedAt: last,
                        endedAt: n,
                        sinceStart: n - window.__startMonitorStart,
                    });
                }
            }
        }
        window.__startFrameRecording = false;
        window.__startFrameStopAt = n;
        window.__STEM_CAPTURE_RENDER_FRAME_HISTORY__ = false;
        try {
            window.__startLongTaskObserver?.disconnect?.();
        } catch {}
        return {
            frames: [...(window.__startFrames || [])],
            events: [...(window.__startFrameEvents || [])],
            longTasks: [...(window.__startLongTasks || [])],
            stoppedAt: n,
        };
    };

    const tick = () => {
        if (window.__startFrameRecording === false || window.__startFrameMonitorToken !== token) return;
        const n = performance.now();
        const last = window.__startFrameLast || window.__startMonitorStart;
        const gap = n - last;
        window.__startFrames.push(gap);
        if (gap > 50) {
            window.__startFrameEvents.push({
                gap,
                startedAt: last,
                endedAt: n,
                sinceStart: n - window.__startMonitorStart,
            });
        }
        window.__startFrameLast = n;
        if (window.__startFrames.length < 3000) {
            requestAnimationFrame(tick);
        } else {
            window.__startFrameRecording = false;
            window.__startFrameStopAt = n;
            window.__STEM_CAPTURE_RENDER_FRAME_HISTORY__ = false;
            try {
                window.__startLongTaskObserver?.disconnect?.();
            } catch {}
        }
    };
    requestAnimationFrame(tick);
};

try {
    const attachCount = (scriptContent.match(/^\s*behavior\s+attach\b/gm) || []).length;
    rec("CFG", `LABEL=${LABEL} KEEP="${KEEP}" MP=${MP} SKIP_MODELS=${SKIP_MODELS ? "1" : "0"} PLAY_WAIT_MS=${PLAY_WAIT_MS} PLAY_CLICK_TIMEOUT_MS=${PLAY_CLICK_TIMEOUT_MS} EVAL_TIMEOUT_MS=${EVAL_TIMEOUT_MS} EXIT_AFTER_STARTUP=${PLAY_EXIT_AFTER_STARTUP ? "1" : "0"} RUNTIME_REVEAL_DEBUG=${RUNTIME_REVEAL_DEBUG ? "1" : "0"} RUNTIME_REVEAL_DEBUG_LIMIT=${RUNTIME_REVEAL_DEBUG_LIMIT} RUNTIME_REVEAL_TARGET_GAP_MS=${RUNTIME_REVEAL_TARGET_GAP_MS ?? "default"} RUNTIME_REVEAL_COOLDOWN_FRAMES=${RUNTIME_REVEAL_COOLDOWN_FRAMES ?? "default"} RUNTIME_REVEAL_BATCH_SIZE=${RUNTIME_REVEAL_BATCH_SIZE ?? "default"} RUNTIME_REVEAL_BATCH_WEIGHT=${RUNTIME_REVEAL_BATCH_WEIGHT ?? "default"} RUNTIME_REVEAL_PRECOMPILE=${RUNTIME_REVEAL_PRECOMPILE ?? "default"} RUNTIME_REVEAL_PROGRESSIVE_INSTANCED=${RUNTIME_REVEAL_PROGRESSIVE_INSTANCED ?? "default"} RUNTIME_REVEAL_PROGRESSIVE_INSTANCED_UPLOADS=${RUNTIME_REVEAL_PROGRESSIVE_INSTANCED_UPLOADS ?? "default"} RUNTIME_REVEAL_RAMP_INSTANCED_FIRST=${RUNTIME_REVEAL_RAMP_INSTANCED_FIRST ?? "default"} RUNTIME_REVEAL_INSTANCED_TRIANGLE_BUDGET=${RUNTIME_REVEAL_INSTANCED_TRIANGLE_BUDGET ?? "default"} RUNTIME_MATERIAL_BUDGET=${RUNTIME_MATERIAL_BUDGET ?? "default"} RUNTIME_MATERIAL_SHARING=${RUNTIME_MATERIAL_SHARING ?? "default"} RUNTIME_INSTANCING_TOTAL_TRIANGLES=${RUNTIME_INSTANCING_TOTAL_TRIANGLES ?? "default"} RUNTIME_INSTANCING_MESH_TRIANGLES=${RUNTIME_INSTANCING_MESH_TRIANGLES ?? "default"} attaches=${attachCount} files=${folderFiles.length}`);
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

    const phaseTimings = await page.evaluate(() => window.__stemImportPhaseTimings || []).catch(() => []);
    const byPhase = {};
    for (const t of phaseTimings) {
        const key = `${t.type}:${t.phase}`;
        (byPhase[key] ||= {n: 0, ms: 0, fail: 0});
        byPhase[key].n++;
        byPhase[key].ms += t.ms;
        if (!t.success) byPhase[key].fail++;
    }
    rec("PHASES", `byPhase=${JSON.stringify(byPhase)}`);
    const slowPhases = [...phaseTimings].sort((a, b) => b.ms - a.ms).slice(0, 15);
    for (const t of slowPhases) rec("PHASE", `${t.ms}ms ${t.type}:${t.phase} "${t.label}" ok=${t.success} ${t.success ? "" : t.message}`);

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
            return {
                objs,
                names,
                sceneID: ed?.sceneID ?? null,
                sceneName: ed?.sceneName ?? null,
            };
        }).catch(() => ({objs: -1, names: []}));
        rec("STEP", `scene objects=${counts.objs} sceneID=${counts.sceneID ?? "null"} sceneName=${counts.sceneName ?? "null"}`);
        const localProjects = await page.evaluate(async () => {
            try {
                const db = await new Promise((resolve, reject) => {
                    const req = indexedDB.open("stemstudio-projects", 2);
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });
                const tx = db.transaction("projects", "readonly");
                const rows = await new Promise((resolve, reject) => {
                    const req = tx.objectStore("projects").getAll();
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });
                const assetTx = db.transaction("assets", "readonly");
                const assetRows = await new Promise((resolve, reject) => {
                    const req = assetTx.objectStore("assets").getAll();
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });
                return rows.map(row => {
                    let rootCount = null;
                    let sceneRootNames = [];
                    let visibleFalseCount = null;
                    let meshLikeCount = null;
                    let modelRefCount = null;
                    let modelRefs = [];
                    try {
                        const parsed = JSON.parse(row?.sceneJson ?? "null");
                        rootCount = Array.isArray(parsed) ? parsed.length : (parsed && typeof parsed === "object" ? Object.keys(parsed).length : 0);
                        sceneRootNames = Array.isArray(parsed)
                            ? parsed.slice(0, 12).map(entry => entry?.name ?? entry?.type ?? "(unnamed)")
                            : [];
                        if (Array.isArray(parsed)) {
                            let all = [];
                            const visit = value => {
                                if (!value || typeof value !== "object") return;
                                if (Array.isArray(value)) { for (const child of value) visit(child); return; }
                                all.push(value);
                                visit(value.object);
                                visit(value.children);
                            };
                            visit(parsed);
                            visibleFalseCount = all.filter(entry => entry?.visible === false).length;
                            meshLikeCount = all.filter(entry => /mesh|points|line|sprite/i.test(String(entry?.type ?? entry?.object?.type ?? ""))).length;
                            const refs = all.filter(entry => typeof entry?.modelId === "string").map(entry => entry.modelId);
                            modelRefCount = refs.length;
                            modelRefs = refs.slice(0, 12);
                        }
                    } catch {}
                    const projectAssets = assetRows.filter(asset => asset?.projectId === row?.meta?.id);
                    return {
                        id: row?.meta?.id,
                        name: row?.meta?.name,
                        bytes: row?.sceneJson?.length ?? 0,
                        rootCount,
                        sceneRootNames,
                        visibleFalseCount,
                        meshLikeCount,
                        modelRefCount,
                        modelRefs,
                        assetCount: projectAssets.length,
                        assetTypes: projectAssets.reduce((out, asset) => { out[asset?.asset?.type ?? "?"] = (out[asset?.asset?.type ?? "?"] ?? 0) + 1; return out; }, {}),
                        modelAssetIds: projectAssets.filter(asset => asset?.asset?.type === "model").map(asset => asset?.asset?.assetId).slice(0, 12),
                    };
                });
            } catch (error) {
                return {error: String(error)};
            }
        }).catch(error => ({error: String(error)}));
        rec("LOCAL_PROJECTS", JSON.stringify(localProjects));
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
            const physicsState = await page.evaluate(async () => {
                const s = globalThis[Symbol.for("stem.physicsEngineFactoryState")];
                const pending = Symbol("pending");
                const status = s?.workerCache?.promise
                    ? await Promise.race([
                        s.workerCache.promise.then(handle => ({
                            resolved: true,
                            ready: handle.isReady?.() ?? null,
                        })),
                        new Promise(resolve => setTimeout(() => resolve(pending), 10)),
                    ])
                    : null;
                return {
                    exists: !!s,
                    active: s?.activeEngineType ?? null,
                    cacheType: s?.workerCache?.type ?? null,
                    hasPromise: !!s?.workerCache?.promise,
                    status: status === pending ? "pending" : status,
                };
            }).catch(() => null);
            rec("PHYSSTATE", JSON.stringify(physicsState));
            const playErrs = [];
            page.on("console", m => { if (m.type() === "error" && !NOISE.test(m.text())) playErrs.push(m.text().slice(0, 160)); });
            const playBtn = page.locator('[data-testid="topnav-play"]').first();
            const playButtonState = await playBtn.evaluate(button => ({
                visible: !!(button.offsetWidth || button.offsetHeight || button.getClientRects().length),
                disabled: !!button.disabled,
                ariaDisabled: button.getAttribute("aria-disabled"),
                text: button.textContent?.trim() || "",
            })).catch(() => null);
            rec("PLAYBUTTON", JSON.stringify(playButtonState));
            if (await playBtn.isVisible().catch(() => false)) {
                if (
                    RUNTIME_REVEAL_DEBUG ||
                    RUNTIME_REVEAL_TARGET_GAP_MS ||
                    RUNTIME_REVEAL_COOLDOWN_FRAMES ||
                    RUNTIME_REVEAL_BATCH_SIZE ||
                    RUNTIME_REVEAL_BATCH_WEIGHT ||
                    RUNTIME_REVEAL_PRECOMPILE === "0" ||
                    RUNTIME_REVEAL_PRECOMPILE === "1" ||
                    RUNTIME_REVEAL_PROGRESSIVE_INSTANCED === "0" ||
                    RUNTIME_REVEAL_PROGRESSIVE_INSTANCED === "1" ||
                    RUNTIME_REVEAL_PROGRESSIVE_INSTANCED_UPLOADS === "0" ||
                    RUNTIME_REVEAL_PROGRESSIVE_INSTANCED_UPLOADS === "1" ||
                    RUNTIME_REVEAL_RAMP_INSTANCED_FIRST === "0" ||
                    RUNTIME_REVEAL_RAMP_INSTANCED_FIRST === "1" ||
                    RUNTIME_REVEAL_INSTANCED_TRIANGLE_BUDGET
                ) {
                    const revealDebugState = await page.evaluate((config) => {
                        const scene = (window.app || globalThis.app)?.scene;
                        if (!scene) return {ok: false, reason: "missing-scene"};
                        scene.userData ||= {};
                        scene.userData.rendering ||= {};
                        scene.userData.rendering.runtimeSceneReveal ||= {};
                        const reveal = scene.userData.rendering.runtimeSceneReveal;
                        if (config.debug) {
                            reveal.debugLongFrames = true;
                            reveal.debugLongFrameLimit = Number.isFinite(config.debugLimit)
                                ? config.debugLimit
                                : 64;
                        }
                        if (config.precompile === "0" || config.precompile === "1") {
                            reveal.precompile = config.precompile === "1";
                        }
                        if (config.progressiveInstanced === "0" || config.progressiveInstanced === "1") {
                            reveal.progressiveInstancedCounts = config.progressiveInstanced === "1";
                        }
                        if (config.progressiveInstancedUploads === "0" || config.progressiveInstancedUploads === "1") {
                            reveal.progressiveInstancedUploads = config.progressiveInstancedUploads === "1";
                        }
                        if (config.rampInstancedFirst === "0" || config.rampInstancedFirst === "1") {
                            reveal.rampInstancedCountsBeforeContinuingReveal = config.rampInstancedFirst === "1";
                        }
                        const numericEntries = [
                            ["targetFrameGapMs", config.targetFrameGapMs],
                            ["longFrameCooldownFrames", config.longFrameCooldownFrames],
                            ["batchSize", config.batchSize],
                            ["batchWeightBudget", config.batchWeightBudget],
                            ["instancedCountTriangleBudget", config.instancedCountTriangleBudget],
                        ];
                        for (const [key, rawValue] of numericEntries) {
                            const value = Number(rawValue);
                            if (Number.isFinite(value) && value > 0) {
                                reveal[key] = value;
                            }
                        }
                        return {ok: true, runtimeSceneReveal: scene.userData.rendering.runtimeSceneReveal};
                    }, {
                        debug: RUNTIME_REVEAL_DEBUG,
                        debugLimit: RUNTIME_REVEAL_DEBUG_LIMIT,
                        precompile: RUNTIME_REVEAL_PRECOMPILE,
                        progressiveInstanced: RUNTIME_REVEAL_PROGRESSIVE_INSTANCED,
                        progressiveInstancedUploads: RUNTIME_REVEAL_PROGRESSIVE_INSTANCED_UPLOADS,
                        rampInstancedFirst: RUNTIME_REVEAL_RAMP_INSTANCED_FIRST,
                        targetFrameGapMs: RUNTIME_REVEAL_TARGET_GAP_MS,
                        longFrameCooldownFrames: RUNTIME_REVEAL_COOLDOWN_FRAMES,
                        batchSize: RUNTIME_REVEAL_BATCH_SIZE,
                        batchWeightBudget: RUNTIME_REVEAL_BATCH_WEIGHT,
                        instancedCountTriangleBudget: RUNTIME_REVEAL_INSTANCED_TRIANGLE_BUDGET,
                    }).catch(error => ({ok: false, reason: String(error?.message || error)}));
                    rec("REVEALCFG", JSON.stringify(revealDebugState));
                }
                if (
                    RUNTIME_MATERIAL_BUDGET === "0" ||
                    RUNTIME_MATERIAL_BUDGET === "1" ||
                    RUNTIME_MATERIAL_SHARING === "0" ||
                    RUNTIME_MATERIAL_SHARING === "1"
                ) {
                    const materialBudgetState = await page.evaluate((config) => {
                        const scene = (window.app || globalThis.app)?.scene;
                        if (!scene) return {ok: false, reason: "missing-scene"};
                        scene.userData ||= {};
                        scene.userData.rendering ||= {};
                        scene.userData.rendering.runtimeMaterialBudget ||= {};
                        if (config.enabled === "0" || config.enabled === "1") {
                            scene.userData.rendering.runtimeMaterialBudget.enabled = config.enabled === "1";
                        }
                        if (config.sharing === "0" || config.sharing === "1") {
                            scene.userData.rendering.runtimeMaterialBudget.shareEquivalentRuntimeMaterials = config.sharing === "1";
                        }
                        return {ok: true, runtimeMaterialBudget: scene.userData.rendering.runtimeMaterialBudget};
                    }, {
                        enabled: RUNTIME_MATERIAL_BUDGET,
                        sharing: RUNTIME_MATERIAL_SHARING,
                    }).catch(error => ({ok: false, reason: String(error?.message || error)}));
                    rec("MATBUDGETCFG", JSON.stringify(materialBudgetState));
                }
                if (RUNTIME_INSTANCING_TOTAL_TRIANGLES || RUNTIME_INSTANCING_MESH_TRIANGLES) {
                    const instancingBudgetState = await page.evaluate(({total, perMesh}) => {
                        const scene = (window.app || globalThis.app)?.scene;
                        if (!scene) return {ok: false, reason: "missing-scene"};
                        scene.userData ||= {};
                        scene.userData.rendering ||= {};
                        scene.userData.rendering.instancingBudget ||= {};
                        const config = scene.userData.rendering.instancingBudget;
                        const totalValue = Number(total);
                        const perMeshValue = Number(perMesh);
                        if (Number.isFinite(totalValue) && totalValue > 0) {
                            config.maxTotalSubmittedTriangles = totalValue;
                        }
                        if (Number.isFinite(perMeshValue) && perMeshValue > 0) {
                            config.maxSubmittedTrianglesPerMesh = perMeshValue;
                        }
                        return {ok: true, instancingBudget: config};
                    }, {
                        total: RUNTIME_INSTANCING_TOTAL_TRIANGLES,
                        perMesh: RUNTIME_INSTANCING_MESH_TRIANGLES,
                    }).catch(error => ({ok: false, reason: String(error?.message || error)}));
                    rec("INSTBUDGETCFG", JSON.stringify(instancingBudgetState));
                }
                let startCdp = null;
                if (process.env.PROFILE_START === "1") {
                    startCdp = await page.context().newCDPSession(page);
                    await startCdp.send("Profiler.enable");
                    await startCdp.send("Profiler.setSamplingInterval", {interval: 300});
                    await startCdp.send("Profiler.start");
                }
                const installPlayStartMonitor = () => page.evaluate(installStartupResponsivenessMonitor).catch(() => {});
                const installAppEventProfiler = () => APP_EVENT_PROFILE
                    ? page.evaluate(() => {
                        globalThis.__STEM_APP_EVENT_PROFILE__ = {
                            enabled: true,
                            types: ["animate", "beforeRender", "afterRender"],
                            events: {},
                        };
                    }).catch(() => {})
                    : Promise.resolve();
                await installAppEventProfiler();
                const installTimerProfiler = () => TIMER_PROFILE
                    ? page.evaluate(() => {
                        if (globalThis.__stemTimerProfilerInstalled) return;
                        globalThis.__stemTimerProfilerInstalled = true;
                        globalThis.__stemTimerProfile = [];
                        const wrapTimer = (name, original) => function(callback, delay, ...args) {
                            if (typeof callback !== "function") {
                                return original.call(this, callback, delay, ...args);
                            }
                            const scheduledAt = performance.now();
                            const stack = new Error().stack || "";
                            const wrapped = (...callbackArgs) => {
                                const startedAt = performance.now();
                                try {
                                    return callback(...callbackArgs);
                                } finally {
                                    const duration = performance.now() - startedAt;
                                    if (duration >= 20) {
                                        globalThis.__stemTimerProfile.push({
                                            name,
                                            delay: Number(delay) || 0,
                                            duration,
                                            scheduledAt,
                                            startedAt,
                                            callbackName: callback.name || "anonymous",
                                            stack: stack.split("\\n").slice(0, 8).join("\\n"),
                                        });
                                    }
                                }
                            };
                            return original.call(this, wrapped, delay, ...args);
                        };
                        globalThis.setTimeout = wrapTimer("setTimeout", globalThis.setTimeout);
                        globalThis.setInterval = wrapTimer("setInterval", globalThis.setInterval);
                    }).catch(() => {})
                    : Promise.resolve();
                await installTimerProfiler();
                if (BEHAVIOR_PROFILE || LAMBDA_PROFILE) {
                    await page.evaluate(({behavior, lambda}) => {
                        globalThis.__stemProfileBehavior = behavior;
                        globalThis.__stemProfileLambda = lambda;
                    }, {behavior: BEHAVIOR_PROFILE, lambda: LAMBDA_PROFILE}).catch(() => {});
                }
                const enableBehaviorProfiler = () => BEHAVIOR_PROFILE || LAMBDA_PROFILE
                    ? page.evaluate(() => {
                        const enable = () => {
                            const app = window.app || globalThis.app;
                            const behaviorProfiler = app?.game?.behaviorManager?.profiler;
                            const lambdaProfiler = app?.game?.lambdaManager?.profiler;
                            const behaviorReady = !globalThis.__stemProfileBehavior || !!behaviorProfiler;
                            const lambdaReady = !globalThis.__stemProfileLambda || !!lambdaProfiler;
                            if (!behaviorReady || !lambdaReady) return false;
                            behaviorProfiler?.reset?.();
                            lambdaProfiler?.reset?.();
                            behaviorProfiler?.enable?.();
                            lambdaProfiler?.enable?.();
                            return true;
                        };
                        if (enable()) return;
                        clearInterval(globalThis.__stemBehaviorProfilerPoll);
                        globalThis.__stemBehaviorProfilerPoll = setInterval(() => {
                            if (enable()) clearInterval(globalThis.__stemBehaviorProfilerPoll);
                        }, 16);
                    }).catch(() => {})
                    : Promise.resolve();
                await enableBehaviorProfiler();
                let directPlayResult = null;
                if (process.env.DIRECT_PLAY === "1") {
                    const monitorStartedAt = Date.now();
                    await installPlayStartMonitor();
                    rec("PLAYCLICK", `monitorInstall=${Date.now() - monitorStartedAt}ms`);
                    const directStartedAt = Date.now();
                    await page.evaluate(() => {
                        const app = window.app || globalThis.app;
                        window.__directPlayDone = null;
                        Promise.resolve(app?.setMode?.("play")).then(
                            () => { window.__directPlayDone = {ok: true}; },
                            e => { window.__directPlayDone = {ok: false, err: String(e?.message || e)}; },
                        );
                    }).catch(() => {});
                    rec("PLAYCLICK", `directSetModeDispatch=${Date.now() - directStartedAt}ms`);
                } else {
                    const clickStartedAt = Date.now();
                    if (process.env.CLICK_METHOD === "mouse") {
                        const box = await playBtn.boundingBox().catch(() => null);
                        if (box) {
                            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
                        }
                    } else {
                        await playBtn.click({timeout: PLAY_CLICK_TIMEOUT_MS, force: true}).catch(() => {});
                    }
                    rec("PLAYCLICK", `clickPromise=${Date.now() - clickStartedAt}ms`);
                    const dontSave = page.locator("button", {hasText: /don['’]t\s*save/i}).first();
                    if (await dontSave.isVisible().catch(() => false)) {
                        const dontSaveStartedAt = Date.now();
                        await dontSave.click().catch(() => {});
                        rec("PLAYCLICK", `dontSaveClick=${Date.now() - dontSaveStartedAt}ms`);
                    }
                    // Measure UI responsiveness DURING the play-start build: sample rAF
                    // gaps. If the build blocks the main thread, there's one multi-second
                    // gap; if it yields progressively, gaps stay small.
                    const monitorStartedAt = Date.now();
                    await installPlayStartMonitor();
                    rec("PLAYCLICK", `monitorInstall=${Date.now() - monitorStartedAt}ms`);
                }
                const playWaitStartedAt = Date.now();
                if (process.env.DIRECT_PLAY === "1") {
                    await new Promise(resolve => setTimeout(resolve, PLAY_WAIT_MS));
                    directPlayResult = await evalWithTimeout("directPlayDone", () => window.__directPlayDone, null, EVAL_TIMEOUT_MS);
                    rec("PLAYWAIT", `directDone=${JSON.stringify(directPlayResult)} waited=${Date.now() - playWaitStartedAt}ms`);
                } else {
                    await page.waitForTimeout(PLAY_WAIT_MS);
                    rec("PLAYWAIT", `waited=${Date.now() - playWaitStartedAt}ms`);
                }
                if (process.env.PROBE_INPUT === "1") {
                    const beforeInput = await page.evaluate(() => {
                        const app = window.app || globalThis.app;
                        return {
                            hBefore: !!app?.game?.inputManager?.getAction?.("h"),
                            wBefore: app?.game?.inputManager?.getMotion?.("forward") ?? null,
                        };
                    }).catch(error => ({error: String(error?.message || error)}));
                    await page.keyboard.down("h");
                    await page.waitForTimeout(120);
                    const heldInput = await page.evaluate(() => {
                        const app = window.app || globalThis.app;
                        return {
                            hHeld: !!app?.game?.inputManager?.getAction?.("h"),
                            wHeld: app?.game?.inputManager?.getMotion?.("forward") ?? null,
                        };
                    }).catch(error => ({error: String(error?.message || error)}));
                    await page.keyboard.up("h");
                    await page.waitForTimeout(500);
                    await page.screenshot({path: `/tmp/tinyskies-diag-${LABEL}-input-after-h.png`}).catch(() => {});
                    rec("INPUTPROBE", JSON.stringify({beforeInput, heldInput}));
                }
                const startupSnapshot = await evalWithTimeout("stopStartFrameMonitor", () => {
                    if (typeof window.__stopStartFrameMonitor === "function") {
                        return window.__stopStartFrameMonitor();
                    }
                    return {
                        frames: window.__startFrames || [],
                        events: window.__startFrameEvents || [],
                        longTasks: window.__startLongTasks || [],
                        stoppedAt: performance.now(),
                    };
                }, {frames: [], events: [], longTasks: [], stoppedAt: null}, EVAL_TIMEOUT_MS);
                const sf = Array.isArray(startupSnapshot?.frames) ? startupSnapshot.frames : [];
                const sMax = Math.max(0, ...sf); const sLong = sf.filter(f => f > 100).length;
                rec("STARTUP", `playStart rAF frames=${sf.length} maxGap=${sMax.toFixed(0)}ms gaps>100ms=${sLong}`);
                const playStartTimings = await evalWithTimeout("playStartTimings", () => window.__stemPlayStartTimings || [], [], EVAL_TIMEOUT_MS);
                if (APP_EVENT_PROFILE) {
                    const appEventProfile = await evalWithTimeout(
                        "appEventProfile",
                        () => globalThis.__STEM_APP_EVENT_PROFILE__?.events || {},
                        {},
                        EVAL_TIMEOUT_MS,
                    );
                    rec("APPEVENTPROFILE", JSON.stringify(Object.values(appEventProfile)
                        .sort((a, b) => (b.totalMs || 0) - (a.totalMs || 0))
                        .slice(0, 40)));
                }
                if (BEHAVIOR_PROFILE) {
                    const behaviorProfile = await evalWithTimeout(
                        "behaviorProfile",
                        () => {
                            const profiler = (window.app || globalThis.app)?.game?.behaviorManager?.profiler;
                            return {
                                summary: profiler?.getSummary?.() || null,
                                metrics: profiler?.getMetrics?.() || [],
                            };
                        },
                        {summary: null, metrics: []},
                        EVAL_TIMEOUT_MS,
                    );
                    const metrics = Array.isArray(behaviorProfile?.metrics) ? behaviorProfile.metrics : [];
                    rec("BEHAVIORPROFILE", JSON.stringify({
                        summary: behaviorProfile?.summary || null,
                        top: [...metrics].sort((a, b) => (b.maxExecutionTimeMs || 0) - (a.maxExecutionTimeMs || 0)).slice(0, 40),
                    }));
                }
                if (LAMBDA_PROFILE) {
                    const lambdaProfile = await evalWithTimeout(
                        "lambdaProfile",
                        () => {
                            const profiler = (window.app || globalThis.app)?.game?.lambdaManager?.profiler;
                            return {
                                summary: profiler?.getSummary?.() || null,
                                metrics: profiler?.getMetrics?.() || [],
                            };
                        },
                        {summary: null, metrics: []},
                        EVAL_TIMEOUT_MS,
                    );
                    const metrics = Array.isArray(lambdaProfile?.metrics) ? lambdaProfile.metrics : [];
                    rec("LAMBDAPROFILE", JSON.stringify({
                        summary: lambdaProfile?.summary || null,
                        top: [...metrics].sort((a, b) => (b.maxExecutionTimeMs || 0) - (a.maxExecutionTimeMs || 0)).slice(0, 40),
                    }));
                }
                if (TIMER_PROFILE) {
                    const timerProfile = await evalWithTimeout(
                        "timerProfile",
                        () => globalThis.__stemTimerProfile || [],
                        [],
                        EVAL_TIMEOUT_MS,
                    );
                    rec("TIMERPROFILE", JSON.stringify([...timerProfile]
                        .sort((a, b) => (b.duration || 0) - (a.duration || 0))
                        .slice(0, 40)));
                }
                if (process.env.PERF_GATE === "1") {
                    const timing = phase => playStartTimings.find(entry => entry.phase === phase)?.ms ?? null;
                    const telemetry = await evalWithTimeout(
                        "runtimeFrameTelemetryForPerfGate",
                        () => globalThis.__STEM_RUNTIME_FRAME_TELEMETRY__?.() || null,
                        null,
                        EVAL_TIMEOUT_MS,
                    );
                    const maxStartMs = parseInt(process.env.PERF_GATE_MAX_START_MS ?? "3500", 10);
                    const maxWarmupMs = parseInt(process.env.PERF_GATE_MAX_WARMUP_MS ?? "2000", 10);
                    const maxFrameP95Ms = parseInt(process.env.PERF_GATE_MAX_FRAME_P95_MS ?? "25", 10);
                    const maxStartupGapMs = parseInt(process.env.PERF_GATE_MAX_STARTUP_GAP_MS ?? "250", 10);
                    const checks = {
                        startPlayerTotal: {value: timing("startPlayerTotal"), max: maxStartMs},
                        rendererWarmup: {value: timing("rendererWarmup"), max: maxWarmupMs},
                        frameTimeP95Ms: {value: telemetry?.frameTimeP95Ms ?? null, max: maxFrameP95Ms},
                        startupMaxGapMs: {value: sMax, max: maxStartupGapMs},
                    };
                    const failures = Object.entries(checks)
                        .filter(([, check]) => typeof check.value !== "number" || check.value > check.max)
                        .map(([name, check]) => `${name}=${check.value}ms>${check.max}ms`);
                    rec("PERF_GATE", JSON.stringify({pass: failures.length === 0, checks, failures}));
                    if (failures.length > 0) process.exitCode = 1;
                }
                const startupGapEvents = Array.isArray(startupSnapshot?.events) ? startupSnapshot.events : [];
                const startupLongTasks = Array.isArray(startupSnapshot?.longTasks) ? startupSnapshot.longTasks : [];
                for (const event of [...startupGapEvents].sort((a, b) => (b.gap || 0) - (a.gap || 0)).slice(0, 12)) {
                    rec("STARTUPGAP", `${Math.round(event.gap || 0)}ms at +${Math.round(event.sinceStart || 0)}ms interval=${Math.round(event.startedAt || 0)}-${Math.round(event.endedAt || 0)}`);
                }
                for (const task of [...startupLongTasks].sort((a, b) => (b.duration || 0) - (a.duration || 0)).slice(0, 12)) {
                    const attribution = Array.isArray(task.attribution) && task.attribution.length > 0
                        ? task.attribution
                            .slice(0, 3)
                            .map(item => item.name || item.containerName || item.containerSrc || item.entryType || "?")
                            .join("|")
                        : "none";
                    rec(
                        "LONGTASK",
                        `${Math.round(task.duration || 0)}ms at +${Math.round(task.sinceStart || 0)}ms interval=${Math.round(task.startedAt || 0)}-${Math.round(task.endedAt || 0)} attr=${attribution}`,
                    );
                }
                const renderDiagnostics = await evalWithTimeout("renderDiagnostics", () => window.__STEM_RENDER_FRAME_DIAGNOSTICS__ || null, null, EVAL_TIMEOUT_MS);
                rec("RENDERDIAG", JSON.stringify(renderDiagnostics));
                const batchDiagnostics = await evalWithTimeout("batchDiagnostics", () => {
                    const effectRenderer = (window.app || globalThis.app)?.effectRenderer;
                    const batchManager = effectRenderer?.batchManager;
                    const stats = batchManager?.getBatchStats?.() || [];
                    const scene = (window.app || globalThis.app)?.scene;
                    const meshSummary = {
                        total: 0,
                        visible: 0,
                        canBatch: 0,
                        instanced: 0,
                        customTsl: 0,
                        noPosition: 0,
                        userDisabled: 0,
                        unaligned: 0,
                        nonStandardMaterial: 0,
                        materialTypes: {},
                        geometryTypes: {},
                    };
                    const instancedMeshes = [];
                    const customTslKeys = [
                        "colorNode",
                        "opacityNode",
                        "normalNode",
                        "emissiveNode",
                        "positionNode",
                        "metalnessNode",
                        "roughnessNode",
                        "clearcoatNormalNode",
                        "backdropNode",
                        "backdropAlphaNode",
                        "fragmentNode",
                        "vertexNode",
                        "outputNode",
                        "receivedShadowNode",
                    ];
                    const hasCustomTsl = material => {
                        if (!material || material.userData?.batchManagerGeneratedTSL === true || material.isNodeMaterial !== true) {
                            return false;
                        }
                        return customTslKeys.some(key => material[key] != null);
                    };
                    const estimateTriangleCount = geometry => {
                        const indexCount = geometry?.index?.count;
                        if (Number.isFinite(indexCount) && indexCount > 0) return Math.floor(indexCount / 3);
                        const positionCount = geometry?.getAttribute?.("position")?.count;
                        return Number.isFinite(positionCount) && positionCount > 0 ? Math.floor(positionCount / 3) : 0;
                    };
                    scene?.traverse?.(object => {
                        if (!object?.isMesh) return;
                        meshSummary.total++;
                        if (object.visible) meshSummary.visible++;
                        if (object.isInstancedMesh) meshSummary.instanced++;
                        const geometry = object.geometry;
                        const material = object.material;
                        const materialEntries = Array.isArray(material) ? material : [material];
                        const firstMaterial = materialEntries[0];
                        const materialType = firstMaterial?.type || "unknown";
                        const customTsl = materialEntries.some(hasCustomTsl);
                        meshSummary.materialTypes[materialType] = (meshSummary.materialTypes[materialType] || 0) + 1;
                        const geometryType = geometry?.type || "unknown";
                        meshSummary.geometryTypes[geometryType] = (meshSummary.geometryTypes[geometryType] || 0) + 1;
                        if (!geometry?.getAttribute?.("position")) meshSummary.noPosition++;
                        if (object.userData?.isBatchable === false) meshSummary.userDisabled++;
                        if (materialEntries.some(entry => entry && entry.isMeshStandardMaterial !== true)) {
                            meshSummary.nonStandardMaterial++;
                        }
                        if (customTsl) meshSummary.customTsl++;
                        if (object.isInstancedMesh) {
                            const instanceCount = Number.isFinite(object.count) ? object.count : 0;
                            const geometryTriangles = estimateTriangleCount(geometry);
                            instancedMeshes.push({
                                name: object.name || object.parent?.name || `mesh-${object.id}`,
                                visible: !!object.visible,
                                instanceCount,
                                geometryTriangles,
                                submittedTriangles: instanceCount * geometryTriangles,
                                geometryType,
                                materialType,
                                customTsl,
                            });
                        }
                        for (const attrName in geometry?.attributes || {}) {
                            const attr = geometry.attributes[attrName];
                            if ((attr?.itemSize ?? 0) * (attr?.array?.BYTES_PER_ELEMENT ?? 0) % 4 !== 0) {
                                meshSummary.unaligned++;
                                break;
                            }
                        }
                        if (batchManager?.canBatch?.(object)) meshSummary.canBatch++;
                    });
                    return {
                        effectReady: !!effectRenderer?.ready,
                        batchEnabled: !!effectRenderer?.batchEnabled,
                        hasBatchManager: !!batchManager,
                        trackedSceneMeshes: batchManager?.sceneMeshes?.length ?? null,
                        trackedBatchableMeshes: batchManager?.meshDataMap?.size ?? null,
                        meshSummary,
                        instancedTop: instancedMeshes
                            .sort((a, b) => (b.submittedTriangles || 0) - (a.submittedTriangles || 0))
                            .slice(0, 12),
                        batchCount: stats.length,
                        batchedGeometryCount: stats.reduce((sum, stat) => sum + (stat.geometryCount || 0), 0),
                        batchedVertexCount: stats.reduce((sum, stat) => sum + (stat.usedVertexCount || 0), 0),
                        top: stats
                            .map(stat => ({
                                key: stat.batchKey,
                                geometryCount: stat.geometryCount,
                                usedVertexCount: stat.usedVertexCount,
                                usedIndexCount: stat.usedIndexCount,
                            }))
                            .sort((a, b) => (b.usedVertexCount || 0) - (a.usedVertexCount || 0))
                            .slice(0, 8),
                    };
                }, null, EVAL_TIMEOUT_MS);
                rec("BATCHDIAG", JSON.stringify(batchDiagnostics));
                const revealDiagnostics = await evalWithTimeout("runtimeRevealDiagnostics", () => {
                    const app = window.app || globalThis.app;
                    const scene = app?.scene;
                    const controller = app?.runtimeSceneRevealController;
                    const stats = controller?.stats ? {...controller.stats} : null;
                    let hiddenRuntimeRenderables = 0;
                    let visibleRuntimeRenderables = 0;
                    scene?.traverse?.(object => {
                        let runtime = false;
                        let current = object;
                        while (current) {
                            if (current.userData?.isRuntimeOnly === true) {
                                runtime = true;
                                break;
                            }
                            current = current.parent;
                        }
                        if (!runtime || !(object?.isMesh || object?.isPoints || object?.isLine || object?.isSprite)) {
                            return;
                        }
                        if (object.visible) visibleRuntimeRenderables++;
                        else hiddenRuntimeRenderables++;
                    });
                    return {
                        active: scene?.userData?._runtimeSceneRevealActive === true,
                        stats,
                        hiddenRuntimeRenderables,
                        visibleRuntimeRenderables,
                    };
                }, null, EVAL_TIMEOUT_MS);
                rec("REVEALSTATS", JSON.stringify(revealDiagnostics));
                const materialDiagnostics = await evalWithTimeout("materialDiagnostics", () => {
                    const scene = (window.app || globalThis.app)?.scene;
                    const runtimeRootName = object => {
                        let current = object;
                        let name = "(authored)";
                        while (current) {
                            if (current.userData?.isRuntimeOnly && current.name) name = current.name;
                            current = current.parent;
                        }
                        return name;
                    };
                    const materialEntries = material => Array.isArray(material) ? material : [material];
                    const materialSlotCounts = new Map();
                    const materialSamples = new Map();
                    const byRoot = {};
                    let slots = 0;
                    let downgradedSlots = 0;
                    scene?.traverse?.(object => {
                        if (!object?.isMesh && !object?.isPoints && !object?.isLine && !object?.isSprite) return;
                        const root = runtimeRootName(object);
                        byRoot[root] ||= {slots: 0, unique: new Set(), downgradedSlots: 0, types: {}};
                        for (const material of materialEntries(object.material)) {
                            if (!material) continue;
                            slots++;
                            byRoot[root].slots++;
                            byRoot[root].unique.add(material.uuid || material.id || String(slots));
                            const type = material.type || "unknown";
                            byRoot[root].types[type] = (byRoot[root].types[type] || 0) + 1;
                            const key = material.uuid || material.id || `${type}:${slots}`;
                            materialSlotCounts.set(key, (materialSlotCounts.get(key) || 0) + 1);
                            if (!materialSamples.has(key)) {
                                materialSamples.set(key, {
                                    type,
                                    root,
                                    name: material.name || "",
                                    downgraded: material.userData?.runtimeMaterialBudgetDowngradedFromNodeMaterial === true,
                                });
                            }
                            if (material.userData?.runtimeMaterialBudgetDowngradedFromNodeMaterial === true) {
                                downgradedSlots++;
                                byRoot[root].downgradedSlots++;
                            }
                        }
                    });
                    const topRoots = Object.entries(byRoot)
                        .map(([root, value]) => ({
                            root,
                            slots: value.slots,
                            unique: value.unique.size,
                            reusedSlots: value.slots - value.unique.size,
                            downgradedSlots: value.downgradedSlots,
                            types: value.types,
                        }))
                        .sort((a, b) => b.slots - a.slots)
                        .slice(0, 14);
                    const topReuse = [...materialSlotCounts.entries()]
                        .filter(([, count]) => count > 1)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 12)
                        .map(([key, count]) => ({count, ...materialSamples.get(key)}));
                    return {
                        slots,
                        uniqueMaterials: materialSlotCounts.size,
                        reusedSlots: slots - materialSlotCounts.size,
                        sharedMaterialGroups: [...materialSlotCounts.values()].filter(count => count > 1).length,
                        downgradedSlots,
                        topRoots,
                        topReuse,
                    };
                }, null, EVAL_TIMEOUT_MS);
                rec("MATERIALDIAG", JSON.stringify(materialDiagnostics));
                const customTslDiagnostics = await evalWithTimeout("customTslDiagnostics", () => {
                    const scene = (window.app || globalThis.app)?.scene;
                    const customTslKeys = [
                        "colorNode",
                        "opacityNode",
                        "normalNode",
                        "emissiveNode",
                        "positionNode",
                        "metalnessNode",
                        "roughnessNode",
                        "clearcoatNormalNode",
                        "backdropNode",
                        "backdropAlphaNode",
                        "fragmentNode",
                        "vertexNode",
                        "outputNode",
                        "receivedShadowNode",
                    ];
                    const materialEntries = material => Array.isArray(material) ? material : [material];
                    const activeNodeKeys = material => {
                        if (!material || material.userData?.batchManagerGeneratedTSL === true || material.isNodeMaterial !== true) {
                            return [];
                        }
                        return customTslKeys.filter(key => material[key] != null);
                    };
                    const runtimeRootName = object => {
                        let current = object;
                        let name = "(other)";
                        while (current) {
                            if (current.userData?.isRuntimeOnly && current.name) name = current.name;
                            current = current.parent;
                        }
                        return name;
                    };
                    const byRoot = {};
                    const byType = {};
                    const byKeys = {};
                    const samples = [];
                    scene?.traverse?.(object => {
                        if (!object?.isMesh) return;
                        const entries = materialEntries(object.material);
                        for (const material of entries) {
                            const keys = activeNodeKeys(material);
                            if (keys.length === 0) continue;
                            const root = runtimeRootName(object);
                            const type = material?.type || "unknown";
                            const keyName = keys.join("+");
                            byRoot[root] = (byRoot[root] || 0) + 1;
                            byType[type] = (byType[type] || 0) + 1;
                            byKeys[keyName] = (byKeys[keyName] || 0) + 1;
                            if (samples.length < 16) {
                                samples.push({
                                    root,
                                    object: object.name || object.parent?.name || object.uuid,
                                    type,
                                    keys,
                                    visible: !!object.visible,
                                });
                            }
                        }
                    });
                    const sortEntries = record => Object.entries(record).sort((a, b) => b[1] - a[1]);
                    return {
                        byRoot: sortEntries(byRoot).slice(0, 12),
                        byType: sortEntries(byType),
                        byKeys: sortEntries(byKeys),
                        samples,
                    };
                }, null, EVAL_TIMEOUT_MS);
                rec("CUSTOMTSL", JSON.stringify(customTslDiagnostics));
                const measures = await evalWithTimeout("performanceMeasures", () =>
                    performance.getEntriesByType("measure").filter(m => /scene-|precompile|gameCreate|physics/i.test(m.name))
                        .map(m => [m.name, Math.round(m.duration)]).sort((a, b) => b[1] - a[1]).slice(0, 14)
                , [], EVAL_TIMEOUT_MS);
                rec("STAGES", JSON.stringify(measures));
                const playByPhase = {};
                for (const t of playStartTimings) {
                    const bucket = playByPhase[t.phase] ||= {n: 0, ms: 0, fail: 0};
                    bucket.n++;
                    bucket.ms += t.ms || 0;
                    if (!t.success) bucket.fail++;
                }
                rec("PLAYPHASES", JSON.stringify(playByPhase));
                const slowPlayPhases = [...playStartTimings].sort((a, b) => (b.ms || 0) - (a.ms || 0)).slice(0, 18);
                for (const t of slowPlayPhases) rec("PLAYPHASE", `${t.ms}ms ${t.phase} ok=${t.success} ${t.success ? "" : t.message}`);
                const adoptions = await evalWithTimeout("editorPreviewAdoptions", () => window.__stemEditorPreviewAdoptions || [], [], EVAL_TIMEOUT_MS);
                rec("ADOPTIONS", JSON.stringify({count: adoptions.length, recent: adoptions.slice(-16)}));
                const playBehaviorTimings = await evalWithTimeout("playBehaviorTimings", () => window.__stemPlayBehaviorTimings || [], [], EVAL_TIMEOUT_MS);
                const slowBehaviorStarts = [...playBehaviorTimings].sort((a, b) => (b.ms || 0) - (a.ms || 0)).slice(0, 18);
                for (const t of slowBehaviorStarts) rec("PLAYBHV", `${Math.round(t.ms || 0)}ms ${t.label || t.id} on ${t.target || "?"}`);
                const behaviorPhaseTimings = await evalWithTimeout("playBehaviorPhaseTimings", () => window.__stemPlayBehaviorPhaseTimings || [], [], EVAL_TIMEOUT_MS);
                const behaviorPhasesByName = Object.create(null);
                for (const t of behaviorPhaseTimings) {
                    const bucket = behaviorPhasesByName[t.phase] ||= {n: 0, ms: 0, fail: 0};
                    bucket.n++;
                    bucket.ms += t.ms || 0;
                    if (!t.success) bucket.fail++;
                }
                rec("PLAYBHVPHASES", JSON.stringify(behaviorPhasesByName));
                const slowBehaviorPhases = [...behaviorPhaseTimings].sort((a, b) => (b.ms || 0) - (a.ms || 0)).slice(0, 24);
                for (const t of slowBehaviorPhases) {
                    rec("PLAYBHVPHASE", `${Math.round(t.ms || 0)}ms ${t.phase} ${t.id || "?"} on ${t.target || "?"} ok=${t.success}`);
                }
                const playClickTimings = await evalWithTimeout("playClickTimings", () => window.__stemPlayClickTimings || [], [], EVAL_TIMEOUT_MS);
                const clickByPhase = {};
                for (const t of playClickTimings) {
                    const bucket = clickByPhase[t.phase] ||= {n: 0, ms: 0, fail: 0};
                    bucket.n++;
                    bucket.ms += t.ms || 0;
                    if (!t.success) bucket.fail++;
                }
                rec("CLICKPHASES", JSON.stringify(clickByPhase));
                const slowClickPhases = [...playClickTimings].sort((a, b) => (b.ms || 0) - (a.ms || 0)).slice(0, 14);
                for (const t of slowClickPhases) rec("CLICKPHASE", `${t.ms}ms ${t.phase} ok=${t.success} ${t.success ? "" : t.message}`);
                const modeTimings = await evalWithTimeout("modeTimings", () => window.__stemModeTimings || [], [], EVAL_TIMEOUT_MS);
                const renderFrameHistory = await evalWithTimeout(
                    "renderFrameHistory",
                    () => window.__STEM_RENDER_FRAME_HISTORY__ || [],
                    [],
                    EVAL_TIMEOUT_MS,
                );
                const revealFrameHistory = await evalWithTimeout(
                    "revealFrameHistory",
                    () => window.__STEM_RUNTIME_REVEAL_FRAME_HISTORY__ || [],
                    [],
                    EVAL_TIMEOUT_MS,
                );
                const renderFrameLabel = frame => {
                    const breakdown = frame?.renderBreakdown || {};
                    const sectionEntries = Object.entries(breakdown)
                        .filter(([key, value]) => key !== "totalMs" && typeof value === "number")
                        .sort((a, b) => b[1] - a[1]);
                    const topSection = sectionEntries[0]
                        ? `${sectionEntries[0][0]}=${Math.round(sectionEntries[0][1])}ms`
                        : "section=?";
                    return `renderFrame:${Math.round(frame?.totalMs || 0)}ms:${topSection}`;
                };
                const revealFrameLabel = frame =>
                    `revealFrame:${Math.round(frame?.durationMs || 0)}ms:${frame?.action || "?"}:revealed=${frame?.revealedDelta || 0}:deferred=${frame?.deferredDelta || 0}`;
                const longTaskLabel = task => {
                    const attribution = Array.isArray(task?.attribution) && task.attribution.length > 0
                        ? task.attribution
                            .slice(0, 2)
                            .map(item => item.name || item.containerName || item.containerSrc || item.entryType || "?")
                            .join("|")
                        : "none";
                    return `longTask:${Math.round(task?.duration || 0)}ms:${attribution}`;
                };
                const timingIntervals = [
                    ...playStartTimings.map(t => ({kind: "play", ...t})),
                    ...modeTimings.map(t => ({kind: "mode", ...t})),
                    ...renderFrameHistory.map(t => ({
                        kind: "render",
                        phase: renderFrameLabel(t),
                        startedAt: t.startedAt,
                        endedAt: t.endedAt,
                        ms: t.totalMs,
                        success: true,
                    })),
                    ...revealFrameHistory.map(t => ({
                        kind: "reveal",
                        phase: revealFrameLabel(t),
                        startedAt: t.startedAt,
                        endedAt: t.endedAt,
                        ms: t.durationMs,
                        success: true,
                    })),
                    ...startupLongTasks.map(t => ({
                        kind: "longtask",
                        phase: longTaskLabel(t),
                        startedAt: t.startedAt,
                        endedAt: t.endedAt,
                        ms: t.duration,
                        success: true,
                    })),
                ].filter(t => Number.isFinite(t.startedAt) && Number.isFinite(t.endedAt));
                for (const event of [...startupGapEvents].sort((a, b) => (b.gap || 0) - (a.gap || 0)).slice(0, 8)) {
                    const gapStart = event.startedAt || 0;
                    const gapEnd = event.endedAt || gapStart;
                    const overlaps = timingIntervals
                        .map(t => ({
                            timing: t,
                            overlap: Math.max(0, Math.min(gapEnd, t.endedAt) - Math.max(gapStart, t.startedAt)),
                        }))
                        .filter(entry => entry.overlap > 0)
                        .sort((a, b) => b.overlap - a.overlap)
                        .slice(0, 4)
                        .map(entry => `${entry.timing.kind}:${entry.timing.phase}:${Math.round(entry.overlap)}ms`);
                    rec("STARTUPGAPATTR", `${Math.round(event.gap || 0)}ms +${Math.round(event.sinceStart || 0)}ms ${overlaps.join(", ") || "unattributed"}`);
                }
                const slowRenderFrames = [...renderFrameHistory]
                    .sort((a, b) => (b.totalMs || 0) - (a.totalMs || 0))
                    .slice(0, 12);
                for (const frame of slowRenderFrames) {
                    rec(
                        "RENDERFRAME",
                        `${Math.round(frame.totalMs || 0)}ms mode=${frame.mode || "?"} playing=${!!frame.isPlaying} reveal=${!!frame.runtimeSceneRevealActive} ${renderFrameLabel(frame)}`,
                    );
                }
                const slowRevealFrames = [...revealFrameHistory]
                    .sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0))
                    .slice(0, 12);
                for (const frame of slowRevealFrames) {
                    rec(
                        "REVEALFRAME",
                        `${Math.round(frame.durationMs || 0)}ms action=${frame.action || "?"} gap=${Math.round(frame.frameGapMs || 0)}ms revealed=${frame.revealedDelta || 0} deferred=${frame.deferredDelta || 0} active=${!!frame.active}`,
                    );
                }
                const modeByPhase = {};
                for (const t of modeTimings) {
                    const key = `${t.mode}:${t.phase}`;
                    const bucket = modeByPhase[key] ||= {n: 0, ms: 0, fail: 0};
                    bucket.n++;
                    bucket.ms += t.ms || 0;
                    if (!t.success) bucket.fail++;
                }
                rec("MODEPHASES", JSON.stringify(modeByPhase));
                const slowModePhases = [...modeTimings].sort((a, b) => (b.ms || 0) - (a.ms || 0)).slice(0, 14);
                for (const t of slowModePhases) rec("MODEPHASE", `${t.ms}ms ${t.mode}:${t.phase} ok=${t.success} ${t.success ? "" : t.message}`);
                if (PLAY_EXIT_AFTER_STARTUP) {
                    if (startCdp) {
                        await stopAndRecordStartupProfile(startCdp, "STARTPROF");
                        startCdp = null;
                    }
                    rec("PLAY", "exit-after-startup");
                    const playObjs = await evalWithTimeout("playObjectCount", () => {
                        const sc = (window.app || globalThis.app)?.scene; let n = 0; try { sc?.traverse?.(() => n++); } catch {} return n;
                    }, -1, EVAL_TIMEOUT_MS);
                    rec("PLAY", `play scene objects=${playObjs} playErrors=${[...new Set(playErrs)].length}`);
                    for (const e of [...new Set(playErrs)].slice(0, 12)) rec("PLAYERR", e);
                } else {
                if (startCdp) {
                    await stopAndRecordStartupProfile(startCdp, "STARTPROF");
                    startCdp = null;
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
                    const profilePath = `/tmp/tinyskies-diag-${LABEL}-playloop.cpuprofile`;
                    writeFileSync(profilePath, JSON.stringify(prof.profile));
                    rec("PROF", `saved=${profilePath}`);
                    for (const entry of topProfileSelfTime(prof.profile, 25)) {
                        rec("PROF", `${entry.ms.toFixed(1)}ms ${entry.pct.toFixed(1)}% ${entry.label}`);
                    }
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
                const sceneVisualState = await page.evaluate(() => {
                    const app = window.app || globalThis.app;
                    const scene = app?.scene;
                    const camera = app?.camera;
                    const meshes = [];
                    const visibleObjects = [];
                    try {
                        scene?.traverse?.(object => {
                            if (object.visible) {
                                visibleObjects.push({name: object.name || "(unnamed)", type: object.type});
                            }
                            if (object.isMesh || object.isPoints || object.isLine) {
                                const position = object.geometry?.attributes?.position;
                                meshes.push({
                                    name: object.name || "(unnamed)",
                                    type: object.type,
                                    visible: !!object.visible,
                                    vertices: position?.count ?? 0,
                                    drawCount: object.geometry?.drawRange?.count ?? null,
                                    material: (() => {
                                        const material = Array.isArray(object.material) ? object.material[0] : object.material;
                                        return material ? {
                                            type: material.type,
                                            visible: material.visible !== false,
                                            opacity: material.opacity,
                                            transparent: !!material.transparent,
                                            side: material.side,
                                        } : null;
                                    })(),
                                    bounds: object.geometry?.boundingSphere ? {
                                        center: {
                                            x: object.geometry.boundingSphere.center.x,
                                            y: object.geometry.boundingSphere.center.y,
                                            z: object.geometry.boundingSphere.center.z,
                                        },
                                        radius: object.geometry.boundingSphere.radius,
                                    } : null,
                                    position: object.position ? {
                                        x: object.position.x,
                                        y: object.position.y,
                                        z: object.position.z,
                                    } : null,
                                });
                            }
                        });
                    } catch {}
                    return {
                        mode: app?.mode ?? null,
                        isPlaying: !!app?.isPlaying,
                        effectSceneMatches: app?.effectRenderer?.scene === scene,
                        camera: camera ? {
                            position: {x: camera.position.x, y: camera.position.y, z: camera.position.z},
                            rotation: {x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z},
                            near: camera.near,
                            far: camera.far,
                        } : null,
                        visibleObjectCount: visibleObjects.length,
                        visibleObjects: visibleObjects.slice(0, 20),
                        meshes,
                    };
                }).catch(() => null);
                rec("SCENEVIS", JSON.stringify(sceneVisualState));
                for (const e of [...new Set(playErrs)].slice(0, 12)) rec("PLAYERR", e);
                if (PLAY_STOP_CYCLES > 0) {
                    const cycleResults = [];
                    const transition = async mode => page.evaluate(requestedMode => {
                        const app = window.app || globalThis.app;
                        try {
                            const transitionOptions = requestedMode === "edit" ? {editorSavePolicy: "discard"} : undefined;
                            const result = app?.setMode?.(requestedMode, transitionOptions);
                            result?.catch?.(() => {});
                            return {ok: true, mode: app?.mode ?? null, isPlaying: !!app?.isPlaying, isModeTransitioning: !!app?.isModeTransitioning};
                        } catch (error) {
                            return {ok: false, error: String(error?.message || error), mode: app?.mode ?? null, isPlaying: !!app?.isPlaying};
                        }
                    }, mode).catch(error => ({ok: false, error: String(error?.message || error)}));
                    const snapshot = async collectHeap => page.evaluate(async collect => {
                        if (collect && typeof globalThis.gc === "function") {
                            globalThis.gc();
                            await new Promise(resolve => setTimeout(resolve, 0));
                        }
                        const app = window.app || globalThis.app;
                        let objects = 0;
                        try { app?.scene?.traverse?.(() => { objects += 1; }); } catch {}
                        return {
                            mode: app?.mode ?? null,
                            isPlaying: !!app?.isPlaying,
                            isModeTransitioning: !!app?.isModeTransitioning,
                            objects,
                            usedJSHeapSize: performance.memory?.usedJSHeapSize ?? null,
                            gcAvailable: typeof globalThis.gc === "function",
                            scriptResourceDiagnostics: globalThis.__STEM_SCRIPT_RESOURCE_DIAGNOSTICS__?.() ?? null,
                            playerSessionPresent: !!app?.playerSession,
                            gamePresent: !!app?.game,
                            physicsPresent: !!app?.physics,
                            fixedStepListenerPhysics: !!app?.fixedStepListenerPhysics,
                            pendingWorkerSimulationFrame: !!app?.pendingWorkerSimulationFrame,
                            activeSimulationFrameContext: !!app?.activeSimulationFrameContext,
                            modeTimings: globalThis.__stemModeTimings ?? [],
                        };
                    }, collectHeap).catch(error => ({error: String(error?.message || error)}));
                    const waitForMode = async mode => {
                        const startedAt = Date.now();
                        const deadline = Date.now() + 30000;
                        let lastState = null;
                        while (Date.now() < deadline) {
                            const state = await page.evaluate(expectedMode => {
                                const app = window.app || globalThis.app;
                                return {
                                    mode: app?.mode ?? null,
                                    isPlaying: !!app?.isPlaying,
                                    isModeTransitioning: !!app?.isModeTransitioning,
                                    ready: app?.mode === expectedMode && !app?.isModeTransitioning && (expectedMode !== "play" || app?.isPlaying === true),
                                };
                            }, mode).catch(() => ({ready: false}));
                            lastState = state;
                            if (state.ready) {
                                if (Date.now() - startedAt > 1000) {
                                    rec("MODE_WAIT", JSON.stringify({expected: mode, elapsedMs: Date.now() - startedAt, state}));
                                }
                                return state;
                            }
                            await page.waitForTimeout(250);
                        }
                        rec("MODE_WAIT_TIMEOUT", JSON.stringify({expected: mode, lastState}));
                        return false;
                    };
                    let editBaseline = null;
                    for (let cycle = 1; cycle <= PLAY_STOP_CYCLES; cycle += 1) {
                        let stopCdp = null;
                        if (PROFILE_STOP) {
                            stopCdp = await page.context().newCDPSession(page).catch(() => null);
                            if (stopCdp) {
                                await stopCdp.send("Profiler.enable").catch(() => {});
                                await stopCdp.send("Profiler.setSamplingInterval", {interval: 100}).catch(() => {});
                                await stopCdp.send("Profiler.start").catch(() => {});
                            }
                        }
                        const stopped = await transition("edit");
                        const stoppedReady = await waitForMode("edit");
                        if (stopCdp) {
                            try {
                                const prof = await stopCdp.send("Profiler.stop");
                                const profilePath = `/tmp/tinyskies-diag-${LABEL}-cycle-${cycle}-stop.cpuprofile`;
                                writeFileSync(profilePath, JSON.stringify(prof.profile));
                                rec("STOPPROF", `saved=${profilePath}`);
                                for (const entry of topProfileSelfTime(prof.profile, 20)) {
                                    rec("STOPPROF", `${entry.ms.toFixed(1)}ms ${entry.pct.toFixed(1)}% ${entry.label}`);
                                }
                            } catch (error) {
                                rec("STOPPROF", `failed=${String(error?.message || error).slice(0, 160)}`);
                            }
                            await stopCdp.detach().catch(() => {});
                        }
                        const afterStop = await snapshot(FORCE_GC);
                        if (!editBaseline) editBaseline = afterStop.scriptResourceDiagnostics?.scopes ?? null;
                        const resourceCounts = afterStop.scriptResourceDiagnostics ?? {};
                        const resourcesClean =
                            (editBaseline == null || resourceCounts.scopes === editBaseline) &&
                            resourceCounts.timeouts === 0 && resourceCounts.intervals === 0 &&
                            resourceCounts.animationFrames === 0 && resourceCounts.listeners === 0 &&
                            resourceCounts.audioNodes === 0 && resourceCounts.audioContexts === 0;
                        const restarted = await transition("play");
                        const restartedReady = await waitForMode("play");
                        await page.waitForTimeout(Number(process.env.CYCLE_PLAY_WAIT_MS || 900));
                        const afterPlay = await snapshot(false);
                        const rendered = afterPlay.objects >= 200 && afterPlay.isPlaying === true;
                        const result = {
                            cycle,
                            stopped: stopped.ok && stoppedReady && afterStop.mode === "edit" && afterStop.isPlaying === false,
                            resourcesClean,
                            restarted: restarted.ok && restartedReady && rendered,
                            stoppedTransition: stopped,
                            restartedTransition: restarted,
                            afterStop,
                            afterPlay,
                        };
                        cycleResults.push(result);
                        rec("CYCLE", JSON.stringify({cycle, stopped: result.stopped, resourcesClean, restarted: result.restarted, heapAfterStop: afterStop.usedJSHeapSize, heapAfterPlay: afterPlay.usedJSHeapSize, modeTimings: afterStop.modeTimings, scriptResourceDiagnosticsAfterStop: afterStop.scriptResourceDiagnostics}));
                        if (!result.stopped || !resourcesClean || !result.restarted) process.exitCode = 1;
                    }
                    rec("CYCLE_SUMMARY", JSON.stringify({requested: PLAY_STOP_CYCLES, completed: cycleResults.length, editBaselineScopes: editBaseline, allPassed: cycleResults.length === PLAY_STOP_CYCLES && cycleResults.every(result => result.stopped && result.resourcesClean && result.restarted), gcAvailable: cycleResults[0]?.afterStop?.gcAvailable ?? false}));
                }
                if (process.env.VERIFY_REFRESH === "1") {
                    const refreshUrl = page.url();
                    await page.reload({waitUntil: "domcontentloaded", timeout: 30000});
                    await page.waitForLoadState("networkidle", {timeout: 20000}).catch(() => {});
                    await page.waitForSelector("canvas", {timeout: 30000});
                    const installRefreshLoopTrace = () => page.evaluate(() => {
                        const app = window.app || globalThis.app;
                        if (!app) return false;
                        if (app.__diagLoopTraceWrapped) return true;
                        app.__diagLoopTrace = [];
                        const record = name => app.__diagLoopTrace.push({name, t: Math.round(performance.now()), renderer: app.renderer?.constructor?.name, appliedRenderer: app.appliedAnimationLoopRenderer === app.renderer, appliedCallback: app.appliedAnimationLoopCallback !== null, legacyCallback: app.legacyAnimationLoopCallback !== null, stack: new Error().stack?.split("\n").slice(2, 5)});
                        for (const name of ["startScheduledAnimationLoop", "stopScheduledAnimationLoop", "setLegacyAnimationLoopCallback"]) {
                            const original = app[name];
                            if (typeof original !== "function") continue;
                            app[name] = function(...args) { record(name); return original.apply(this, args); };
                        }
                        app.__diagLoopTraceWrapped = true;
                        return true;
                    }).catch(() => false);
                    for (let attempt = 0; attempt < 30 && !(await installRefreshLoopTrace()); attempt++) {
                        await page.waitForTimeout(200);
                    }
                    await page.waitForTimeout(parseInt(process.env.REFRESH_WAIT_MS ?? "10000", 10));
                    const refreshState = await page.evaluate(() => {
                        const app = window.app || globalThis.app;
                        const canvas = document.querySelector("canvas");
                        let objects = 0;
                        const hiddenMeshes = [];
                        const topLevelChildren = [];
                        const modelObjects = [];
                        try { app?.scene?.traverse?.(() => objects++); } catch {}
                        try {
                            for (const child of app?.scene?.children ?? []) {
                                if (topLevelChildren.length < 30) topLevelChildren.push({name: child.name, type: child.type, visible: child.visible, childCount: child.children?.length ?? 0});
                            }
                            app?.scene?.traverse?.(object => {
                                if (object.userData?.modelId && modelObjects.length < 12) modelObjects.push({name: object.name, modelId: object.userData.modelId, type: object.type, childCount: object.children?.length ?? 0, visible: object.visible});
                            });
                        } catch {}
                        try {
                            app?.scene?.traverse?.(object => {
                                if ((object.isMesh || object.isPoints || object.isLine || object.isSprite) && object.visible === false && hiddenMeshes.length < 20) {
                                    hiddenMeshes.push({name: object.name || "(unnamed)", type: object.type, parent: object.parent?.name || null, userData: Object.keys(object.userData || {}).filter(key => /runtime|import|batch|asset/i.test(key))});
                                }
                            });
                        } catch {}
                        const sceneProbe = globalThis.__stemGetScene?.() ?? null;
                        const batchRoot = app?.effectRenderer?.batchManager?.getBatchRoot?.();
                        let batchObjects = 0;
                        let visibleBatchObjects = 0;
                        try {
                            batchRoot?.traverse?.(object => {
                                if (object !== batchRoot && (object.isMesh || object.isPoints || object.isLine || object.isSprite)) {
                                    batchObjects++;
                                    if (object.visible) visibleBatchObjects++;
                                }
                            });
                        } catch {}
                        return {
                            url: location.href,
                            mode: app?.mode ?? null,
                            isPlaying: !!app?.isPlaying,
                            animationListenerRegistered: !!app?.animationListenerRegistered,
                            animationLoopAttached: app?.appliedAnimationLoopRenderer === app?.renderer && app?.appliedAnimationLoopCallback !== null,
                            renderRunning: app?.event?.events?.find(e => e?.constructor?.name === "RenderEvent")?.running ?? null,
                            camera: app?.camera?.position?.toArray?.() ?? null,
                            objects,
                            editorSceneID: app?.editor?.sceneID ?? null,
                            editorSceneName: app?.editor?.sceneName ?? null,
                            probe: sceneProbe ? {
                                objectCount: sceneProbe.objectCount,
                                meshCount: sceneProbe.meshCount,
                                visibleObjectCount: sceneProbe.visibleObjectCount,
                                visibleMeshCount: sceneProbe.visibleMeshCount,
                                assetCount: sceneProbe.assetCount,
                            } : null,
                            batch: {batchObjects, visibleBatchObjects, batchEnabled: app?.effectRenderer?.batchEnabled ?? null},
                            hiddenMeshes,
                            topLevelChildren,
                            modelObjects,
                            reveal: {
                                active: app?.scene?.userData?._runtimeSceneRevealActive ?? null,
                                pending: app?.scene?.userData?._runtimeSceneRevealPending ?? null,
                                controllerStats: app?.runtimeSceneRevealController?.stats ?? null,
                            },
                            canvas: canvas ? [canvas.width, canvas.height] : null,
                        };
                    }).catch(error => ({error: String(error)}));
                    await page.screenshot({path: `/tmp/tinyskies-diag-${LABEL}-refresh-play.png`}).catch(() => {});
                    rec("REFRESH", `url=${refreshUrl} state=${JSON.stringify(refreshState)}`);
                    const refreshHealthy = refreshState.mode === "play" &&
                        refreshState.isPlaying === true &&
                        (refreshState.objects ?? 0) >= 200 &&
                        (refreshState.probe?.visibleObjectCount ?? 0) >= 20 &&
                        refreshState.editorSceneID;
                    rec("REFRESH_ASSERT", JSON.stringify({ok: !!refreshHealthy, objects: refreshState.objects, visibleObjects: refreshState.probe?.visibleObjectCount ?? 0}));
                    if (!refreshHealthy) process.exitCode = 1;
                    rec("REFRESH_LOOP_TRACE", JSON.stringify(await page.evaluate(() => globalThis.app?.__diagLoopTrace || [])));
                }
                }
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
