#!/usr/bin/env node
import {chromium} from "playwright";
import {Jimp} from "jimp";
import {readFileSync, readdirSync, mkdirSync} from "node:fs";
import {join, resolve} from "node:path";

const baseUrl = (process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:5176").replace(/\/$/, "");
// A built preview cannot serve Vite source-module URLs. Treat the durable
// production preview port as production even when callers omit the explicit
// flag, so the diagnostic never regresses into a false dynamic-import failure.
const productionImport = process.env.PRODUCTION_IMPORT === "1" || /:5185(?:\/|$)/.test(baseUrl);
const root = process.env.PROJECT_ROOT || "/Volumes/ORICO/Stem Studio - OSS/stemstudio-projects";
const projectPath = process.env.PROJECT_FILE || join(root, "100_cars.oss-mpvb34uz-qlkl9p.stemscript.json");
const assetDir = process.env.ASSET_DIR || join(root, "oss-mpvb34uz-qlkl9p");
// Keep the imported scene URL readable for every fixture in the Playground
// matrix. TinySkies was the original default, but hard-coding its slug makes
// the probe misleading when it exercises other locally persisted games.
const sceneSlug = process.env.SCENE_SLUG || "tinyskies";
const assetFolderName = assetDir.split("/").filter(Boolean).at(-1) || "project-assets";
const out = process.env.OUT || "/tmp/100cars-playwright";
const headed = process.env.HEADED === "1";
const perfGate = process.env.PERF_GATE === "1";
const viewport = (() => {
    const raw = process.env.VIEWPORT || "1440x900";
    const match = raw.match(/^(\d+)x(\d+)$/i);
    if (!match) throw new Error(`VIEWPORT must be WIDTHxHEIGHT, received ${raw}`);
    return {width: Number(match[1]), height: Number(match[2])};
})();
mkdirSync(out, {recursive: true});

const mimeFor = name => {
    const l = name.toLowerCase();
    if (l.endsWith(".glb")) return "model/gltf-binary";
    if (l.endsWith(".png")) return "image/png";
    if (l.endsWith(".ogg")) return "audio/ogg";
    if (l.endsWith(".json")) return "application/json";
    return "application/octet-stream";
};
let project = readFileSync(projectPath);
if (process.env.SHADOW_DIAG_RUNTIME_BUDGET === "1") {
    try {
        const parsedProject = JSON.parse(project.toString("utf8"));
        const sceneEntries = JSON.parse(parsedProject.sceneJson);
        const scene = sceneEntries.find(entry => entry?.metadata?.generator === "SceneSerializer");
        scene.userData ??= {};
        scene.userData.rendering ??= {};
        scene.userData.rendering.runtimeShadowBudget = {
            enabled: true,
            maxTriangles: Number(process.env.SHADOW_DIAG_RUNTIME_BUDGET_TRIANGLES || 300000),
            maxMeshes: Number(process.env.SHADOW_DIAG_RUNTIME_BUDGET_MESHES || 0),
        };
        parsedProject.sceneJson = JSON.stringify(sceneEntries);
        project = Buffer.from(JSON.stringify(parsedProject));
    } catch (error) {
        console.log("SHADOW_RUNTIME_BUDGET_PROJECT_PATCH", JSON.stringify({error: String(error)}));
    }
}
if (process.env.MAIN_TRIANGLE_DIAG_RUNTIME_BUDGET === "1" && process.env.MATCHED_TRIANGLE_CAPTURE !== "1") {
    try {
        const parsedProject = JSON.parse(project.toString("utf8"));
        const sceneEntries = JSON.parse(parsedProject.sceneJson);
        const scene = sceneEntries.find(entry => entry?.metadata?.generator === "SceneSerializer");
        scene.userData ??= {};
        scene.userData.rendering ??= {};
        scene.userData.rendering.runtimeMainTriangleBudget = {
            enabled: true,
            fallbackOnly: true,
            maxTriangles: Number(process.env.MAIN_TRIANGLE_DIAG_RUNTIME_BUDGET_TRIANGLES || 300000),
        };
        parsedProject.sceneJson = JSON.stringify(sceneEntries);
        project = Buffer.from(JSON.stringify(parsedProject));
    } catch (error) {
        console.log("MAIN_TRIANGLE_RUNTIME_BUDGET_PROJECT_PATCH", JSON.stringify({error: String(error)}));
    }
}
if (process.env.DISABLE_AUTOMATIC_SHADOW_BUDGET === "1") {
    try {
        const parsedProject = JSON.parse(project.toString("utf8"));
        const sceneEntries = JSON.parse(parsedProject.sceneJson);
        const scene = sceneEntries.find(entry => entry?.metadata?.generator === "SceneSerializer");
        scene.userData ??= {};
        scene.userData.rendering ??= {};
        scene.userData.rendering.runtimeShadowBudget = {enabled: false};
        parsedProject.sceneJson = JSON.stringify(sceneEntries);
        project = Buffer.from(JSON.stringify(parsedProject));
    } catch (error) {
        console.log("DISABLE_AUTOMATIC_SHADOW_BUDGET_PROJECT_PATCH", JSON.stringify({error: String(error)}));
    }
}
if (process.env.RUNTIME_REVEAL_DIAG === "1") {
    try {
        const parsedProject = JSON.parse(project.toString("utf8"));
        const sceneEntries = JSON.parse(parsedProject.sceneJson);
        const scene = sceneEntries.find(entry => entry?.metadata?.generator === "SceneSerializer");
        scene.userData ??= {};
        scene.userData.rendering ??= {};
        const revealConfig = {
            enabled: true,
            initialRevealBatchSize: Number(process.env.RUNTIME_REVEAL_INITIAL_BATCH_SIZE || 24),
            initialRevealWeightBudget: Number(process.env.RUNTIME_REVEAL_INITIAL_WEIGHT_BUDGET || 48),
            targetFrameGapMs: Number(process.env.RUNTIME_REVEAL_TARGET_FRAME_GAP_MS || 16),
            maxRevealDurationMs: Number(process.env.RUNTIME_REVEAL_MAX_DURATION_MS || 12000),
            includeStaticSceneRenderables: true,
            includeRuntimeSceneRenderables: true,
        };
        if (process.env.RUNTIME_REVEAL_BATCH_SIZE) {
            revealConfig.batchSize = Number(process.env.RUNTIME_REVEAL_BATCH_SIZE);
        }
        if (process.env.RUNTIME_REVEAL_BATCH_WEIGHT_BUDGET) {
            revealConfig.batchWeightBudget = Number(process.env.RUNTIME_REVEAL_BATCH_WEIGHT_BUDGET);
        }
        scene.userData.rendering.runtimeSceneReveal = revealConfig;
        parsedProject.sceneJson = JSON.stringify(sceneEntries);
        project = Buffer.from(JSON.stringify(parsedProject));
    } catch (error) {
        console.log("RUNTIME_REVEAL_DIAG_PROJECT_PATCH", JSON.stringify({error: String(error)}));
    }
}
let projectManifestName = "assets.json";
try {
    const parsedProject = JSON.parse(project.toString("utf8"));
    const configuredManifest = parsedProject?.meta?.extra?.assetManifest;
    if (typeof configuredManifest === "string" && configuredManifest.trim()) {
        projectManifestName = configuredManifest.trim();
    }
} catch {
    // The application will report malformed project JSON; keep the diagnostic
    // bundle construction deterministic so it can still capture that failure.
}
const files = [{name: projectPath.split("/").pop(), mime: "application/json", data: project.toString("base64")}];
for (const name of readdirSync(assetDir)) {
    if (name === "assets.json" || name === projectManifestName) {
        files.push({name: `${assetFolderName}/${name}`, mime: "application/json", data: readFileSync(join(assetDir, name)).toString("base64")});
        continue;
    }
    files.push({name: `${assetFolderName}/${name}`, mime: mimeFor(name), data: readFileSync(join(assetDir, name)).toString("base64")});
}

const browserArgs = [
    ...(process.env.WEBGPU === "1" ? ["--ignore-gpu-blocklist", "--enable-gpu", "--enable-unsafe-webgpu"] : []),
    // Keep fallback-only diagnostics honest even on machines where Playwright
    // exposes a WebGPU adapter by default. This disables the WebGPU feature
    // without disabling the WebGL renderer used by the production fallback.
    ...(process.env.FORCE_WEBGL === "1" ? ["--disable-features=WebGPU"] : []),
    ...(process.env.FORCE_GC === "1" ? ["--js-flags=--expose-gc"] : []),
];
const browser = await chromium.launch({headless: !headed, args: browserArgs});
const ctx = await browser.newContext({viewport, deviceScaleFactor: 1});
const page = await ctx.newPage();
if (process.env.PASS_DIAG === "1") {
    await page.addInitScript(maxFrames => {
        globalThis.__STEM_PASS_DIAG_MAX_FRAMES__ = maxFrames;
    }, Math.max(1, Number(process.env.PASS_DIAG_FRAMES || 1)));
}
if (process.env.RENDER_SUBSTAGE_DIAG === "1") {
    await page.addInitScript(() => {
        globalThis.__STEM_RENDER_SUBSTAGE_DIAG_ENABLED__ = true;
    });
}
if (process.env.BATCH_TIMELINE === "1") {
    await page.addInitScript(() => {
        globalThis.__STEM_BATCH_SUPPORT_DIAG_ENABLED__ = true;
    });
}
console.log("VIEWPORT", JSON.stringify(viewport));
if (process.env.SKIP_WEBGL_FENCE === "1") {
    await page.addInitScript(() => {
        try {
            if (globalThis.WebGLRenderingContext?.prototype?.finish) {
                globalThis.WebGLRenderingContext.prototype.finish = function() {};
            }
            if (globalThis.WebGL2RenderingContext?.prototype?.finish) {
                globalThis.WebGL2RenderingContext.prototype.finish = function() {};
            }
        } catch {}
    });
}
const logs = [], errors = [], failed = [];
page.on("console", m => {
    const location = m.location?.();
    const suffix = location?.url ? ` @ ${location.url}` : "";
    logs.push(`[${m.type()}] ${m.text()}${suffix}`);
    if (m.type() === "error") errors.push(`${m.text()}${suffix}`);
});
page.on("pageerror", e => errors.push(`[pageerror] ${e.message}`));
page.on("requestfailed", r => failed.push(`${r.method()} ${r.url()} ${r.failure()?.errorText || ""}`));
if (process.env.TRACE_WASM === "1") {
    page.on("request", r => {
        if (/ammo|wasm/i.test(r.url())) console.log("WASM_REQUEST", JSON.stringify({method: r.method(), url: r.url()}));
    });
    page.on("response", r => {
        if (/ammo|wasm/i.test(r.url())) console.log("WASM_RESPONSE", JSON.stringify({status: r.status(), url: r.url(), contentType: r.headers()["content-type"] || ""}));
    });
}
if (process.env.TRACE_MODES === "1") {
    page.on("framenavigated", frame => { if (frame === page.mainFrame()) console.log("NAVIGATION", frame.url()); });
}

const bootstrap = async () => {
    await page.evaluate(async () => {
        localStorage.setItem("stemstudio.persistence.mode", "indexeddb");
        localStorage.setItem("stemstudio.bootstrap.complete", "true");
        try { sessionStorage.setItem("stem.playgroundMode", "1"); } catch {}
    });
};
const dismiss = async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
        const modal = page.locator('[aria-labelledby="oss-bootstrap-title"]').first();
        if (await modal.count() && await modal.isVisible().catch(() => false)) {
            await modal.locator('button:has-text("Browser storage")').click().catch(() => {});
            await modal.locator('button:has-text("Continue")').click().catch(() => {});
        }
        const got = page.getByRole("button", {name: /Got It/i}).first();
        if (await got.count() && await got.isVisible().catch(() => false)) await got.click({force: true}).catch(() => {});
        const close = page.locator('button[aria-label="Close"], [role="dialog"] button').filter({has: page.locator("svg")}).first();
        if (await close.count() && await close.isVisible().catch(() => false)) await close.click({force: true}).catch(() => {});
        await page.waitForTimeout(300);
        const blocking = page.getByRole("button", {name: /Got It/i}).first();
        if (!(await blocking.count()) || !(await blocking.isVisible().catch(() => false))) break;
    }
};
const importProjectBundleThroughPicker = async () => {
    // Production bundles do not expose Vite's source module URLs, so exercise
    // the same File System Access path a creator uses from the dashboard.
    // The picker is replaced only inside this QA page with an in-memory folder
    // handle; the application still performs the real import/persistence path.
    await page.evaluate(payload => {
        const makeFile = entry => {
            const bytes = Uint8Array.from(atob(entry.data), c => c.charCodeAt(0));
            const file = new File([bytes], entry.name.split("/").pop(), {type: entry.mime});
            Object.defineProperty(file, "webkitRelativePath", {value: entry.name, configurable: true});
            return file;
        };
        const files = payload.files.map(makeFile);
        const makeDirectory = (name, entries) => {
            const directory = {kind: "directory", name, __entries: entries};
            directory.entries = async function*() {
                for (const [entryName, entry] of directory.__entries) yield [entryName, entry];
            };
            return directory;
        };
        const rootEntries = [];
        for (const file of files) {
            const parts = file.webkitRelativePath.split("/");
            const leaf = parts.pop();
            let entries = rootEntries;
            for (const part of parts) {
                let directory = entries.find(([entryName, entry]) => entryName === part)?.[1];
                if (!directory) {
                    directory = makeDirectory(part, []);
                    entries.push([part, directory]);
                }
                entries = directory.__entries || (directory.__entries = []);
            }
            entries.push([leaf, {kind: "file", name: leaf, getFile: async () => file}]);
        }
        const root = makeDirectory("project", rootEntries);
        Object.defineProperty(window, "showDirectoryPicker", {configurable: true, value: async () => root});
    }, {files});
    await page.getByTestId("import-stemscript-button").dispatchEvent("click");
    try {
        await page.waitForURL(/\/create\/project\/[^/]+/, {timeout: 60000});
    } catch (error) {
        console.log("PRODUCTION_IMPORT_STATE", JSON.stringify({
            url: page.url(),
            body: (await page.locator("body").innerText().catch(() => "")).slice(-1200),
            error: String(error),
        }));
        throw error;
    }
    const projectId = new URL(page.url()).pathname.split("/").filter(Boolean).at(-1);
    return {meta: {id: projectId}, importedVia: "dashboard-file-system-picker"};
};
const installModeTrace = async () => {
    if (process.env.TRACE_MODES !== "1") return false;
    return page.evaluate(() => {
    const app = globalThis.app;
    if (!app || app.__diagModeTraceWrapped) return false;
    app.__diagModeCalls = [];
    app.__diagRouteCalls = [];
    const originalReplaceState = window.history.replaceState.bind(window.history);
    if (!window.history.__diagReplaceWrapped) {
        window.history.replaceState = (state, title, url) => {
            app.__diagRouteCalls.push({url: String(url), mode: app.mode, isPlaying: app.isPlaying, at: Math.round(performance.now()), stack: new Error().stack?.split("\n").slice(1, 5)});
            return originalReplaceState(state, title, url);
        };
        window.history.__diagReplaceWrapped = true;
    }
    const original = app.setMode?.bind(app);
    if (typeof original !== "function") return false;
    app.setMode = (...args) => {
        const entry = {
            requested: args[0],
            options: args[1],
            beforeMode: app.mode,
            beforePlaying: app.isPlaying,
            url: location.href,
            at: Math.round(performance.now()),
            stack: new Error().stack?.split("\n").slice(1, 5),
        };
        app.__diagModeCalls.push(entry);
        const result = original(...args);
        if (result && typeof result.then === "function") {
            return result.then(value => {
                entry.afterMode = app.mode;
                entry.afterPlaying = app.isPlaying;
                entry.doneAt = Math.round(performance.now());
                return value;
            }, error => {
                entry.afterMode = app.mode;
                entry.afterPlaying = app.isPlaying;
                entry.doneAt = Math.round(performance.now());
                entry.error = String(error);
                throw error;
            });
        }
        entry.afterMode = app.mode;
        entry.afterPlaying = app.isPlaying;
        entry.doneAt = Math.round(performance.now());
        return result;
    };
    app.__diagModeTraceWrapped = true;
    app.__diagWrappedSetMode = app.setMode;
    return true;
    }).catch(() => false);
};
const installMaterialDiag = async () => {
    if (process.env.MATERIAL_DIAG !== "1") return false;
    return page.evaluate(() => {
        const app = globalThis.app;
        const renderer = app?.renderer;
        const renderOwner = typeof app?.effectRenderer?.render === "function" ? app.effectRenderer : renderer;
        if (!renderOwner || typeof renderOwner.render !== "function") return false;
        if (renderOwner.__stemMaterialDiagWrapped) return true;
        const originalRender = renderOwner.render;
        let captured = false;
        const capture = () => {
            const scene = app.scene;
            const materials = new Map();
            const materialTypes = new Map();
            let meshes = 0;
            let visibleMeshes = 0;
            let materialSlots = 0;
            let estimatedTriangles = 0;
            scene?.traverse?.(object => {
                if (!object?.isMesh) return;
                meshes += 1;
                if (object.visible) visibleMeshes += 1;
                const geometry = object.geometry;
                const indexCount = geometry?.index?.count ?? geometry?.attributes?.position?.count ?? 0;
                estimatedTriangles += Math.floor(indexCount / 3);
                const slots = Array.isArray(object.material) ? object.material : [object.material];
                for (const material of slots) {
                    if (!material) continue;
                    materialSlots += 1;
                    const uuid = material.uuid ?? material.id ?? material.type;
                    const entry = materials.get(uuid) ?? {type: material.type ?? material.constructor?.name ?? "unknown", meshes: 0, visibleMeshes: 0};
                    entry.meshes += 1;
                    if (object.visible) entry.visibleMeshes += 1;
                    materials.set(uuid, entry);
                    const type = entry.type;
                    materialTypes.set(type, (materialTypes.get(type) ?? 0) + 1);
                }
            });
            const info = renderer.info;
            globalThis.__STEM_MATERIAL_DIAG__ = {
                capturedAt: Math.round(performance.now()),
                mode: app.mode,
                isPlaying: app.isPlaying,
                meshes,
                visibleMeshes,
                materialSlots,
                uniqueMaterials: materials.size,
                materialTypes: Object.fromEntries([...materialTypes.entries()].sort((a, b) => b[1] - a[1])),
                topMaterials: [...materials.values()].sort((a, b) => b.meshes - a.meshes).slice(0, 12),
                estimatedTriangles,
                rendererInfo: info?.render ? {
                    calls: Number.isFinite(info.render.calls) ? info.render.calls : null,
                    triangles: Number.isFinite(info.render.triangles) ? info.render.triangles : null,
                    points: Number.isFinite(info.render.points) ? info.render.points : null,
                    lines: Number.isFinite(info.render.lines) ? info.render.lines : null,
                } : null,
            };
        };
        const wrappedRender = function(...args) {
            const result = originalRender.apply(this, args);
            if (!captured && app.mode === "play" && app.isPlaying === true) {
                captured = true;
                try { capture(); } catch (error) { globalThis.__STEM_MATERIAL_DIAG__ = {error: String(error)}; }
            }
            return result;
        };
        wrappedRender.__stemMaterialDiagWrapped = true;
        renderOwner.render = wrappedRender;
        renderOwner.__stemMaterialDiagWrapped = true;
        return true;
    }).catch(() => false);
};
const installPassDiag = async () => {
    if (process.env.PASS_DIAG !== "1") return false;
    return page.evaluate(() => {
        const app = globalThis.app;
        const renderer = app?.renderer;
        const effectRenderer = app?.effectRenderer;
        if (!renderer || typeof renderer.render !== "function" || !effectRenderer || typeof effectRenderer.render !== "function") return false;
        if (effectRenderer.__stemPassDiagWrapped) return true;
        const trace = globalThis.__STEM_PASS_DIAG__ = {
            captured: false,
            active: false,
            calls: [],
            frame: null,
            frames: [],
            maxFrames: Math.max(1, Number(globalThis.__STEM_PASS_DIAG_MAX_FRAMES__ || 1)),
        };
        const readInfo = () => {
            const info = renderer.info?.render;
            if (!info) return null;
            return {
                calls: Number.isFinite(info.calls) ? info.calls : null,
                triangles: Number.isFinite(info.triangles) ? info.triangles : null,
                points: Number.isFinite(info.points) ? info.points : null,
                lines: Number.isFinite(info.lines) ? info.lines : null,
            };
        };
        const diffInfo = (before, after) => {
            if (!before || !after) return null;
            return Object.fromEntries(Object.keys(after).map(key => [key,
                Number.isFinite(before[key]) && Number.isFinite(after[key]) ? Math.max(0, after[key] - before[key]) : null,
            ]));
        };
        const sceneSummary = scene => ({
            name: scene?.name || null,
            type: scene?.type || scene?.constructor?.name || null,
            roots: scene?.children?.slice?.(0, 12).map?.(child => ({name: child.name || null, type: child.type || child.constructor?.name || null, children: child.children?.length ?? 0})) ?? [],
        });
        const originalRendererRender = renderer.render;
        renderer.render = function(...args) {
            const scene = args[0];
            const before = readInfo();
            const startedAt = performance.now();
            let result;
            try {
                result = originalRendererRender.apply(this, args);
            } catch (error) {
                if (trace.active) trace.calls.push({error: String(error), scene: sceneSummary(scene), durationMs: Math.round(performance.now() - startedAt)});
                throw error;
            }
            const after = readInfo();
            if (trace.active) {
                let target = null;
                try {
                    target = renderer.getRenderTarget?.()?.constructor?.name || null;
                } catch {}
                trace.calls.push({
                    scene: sceneSummary(scene),
                    camera: args[1]?.type || args[1]?.constructor?.name || null,
                    target,
                    durationMs: Math.round(performance.now() - startedAt),
                    rendererDelta: diffInfo(before, after),
                    rendererAfter: after,
                });
            }
            return result;
        };
        const originalEffectRender = effectRenderer.render;
        const finishFrame = startedAt => {
            trace.active = false;
            const frame = {
                startedAt: Math.round(startedAt),
                endedAt: Math.round(performance.now()),
                durationMs: Math.round(performance.now() - startedAt),
                calls: trace.calls.slice(),
                rendererInfo: readInfo(),
            };
            trace.frames.push(frame);
            trace.frame ??= frame;
            trace.captured = trace.frames.length >= trace.maxFrames;
        };
        effectRenderer.render = function(...args) {
            const captureFrame = trace.frames.length < trace.maxFrames && app.mode === "play" && app.isPlaying === true;
            const startedAt = performance.now();
            if (captureFrame) {
                trace.active = true;
                trace.calls = [];
            }
            try {
                const result = originalEffectRender.apply(this, args);
                if (captureFrame && result && typeof result.then === "function") {
                    return result.finally(() => finishFrame(startedAt));
                }
                if (captureFrame) finishFrame(startedAt);
                return result;
            } catch (error) {
                if (captureFrame) finishFrame(startedAt);
                throw error;
            }
        };
        effectRenderer.__stemPassDiagWrapped = true;
        return true;
    }).catch(() => false);
};
const capture = async (label, target = page) => {
    const screenshotPath = resolve(out, `${label}.png`);
    await target.screenshot({path: screenshotPath}).catch(() => {});
    if (process.env.LIGHT_CAPTURE === "1") {
        const sceneStats = await target.evaluate(() => {
            const app = globalThis.app;
            const scene = app?.editor?.scene || app?.scene;
            let objects = 0;
            let meshes = 0;
            let visibleObjects = 0;
            let visibleMeshes = 0;
            let modelRefs = 0;
            let emptyModelRefs = 0;
            scene?.traverse?.(object => {
                objects += 1;
                if (object.visible) visibleObjects += 1;
                if (object.isMesh) {
                    meshes += 1;
                    if (object.visible) visibleMeshes += 1;
                }
                const modelId = object.userData?.modelId;
                if (!modelId) return;
                modelRefs += 1;
                if (!object.isMesh && !object.children?.some?.(child => child.isMesh)) emptyModelRefs += 1;
            });
            const canvas = document.querySelector("canvas");
            return {
                url: location.href,
                mode: app?.mode ?? null,
                isPlaying: app?.isPlaying ?? null,
                isModeTransitioning: app?.isModeTransitioning ?? null,
                canvas: canvas ? {width: canvas.width, height: canvas.height, css: [canvas.clientWidth, canvas.clientHeight]} : null,
                objects,
                meshes,
                visibleObjects,
                visibleMeshes,
                modelRefs,
                emptyModelRefs,
                runtimeReveal: {
                    active: scene?.userData?._runtimeSceneRevealActive ?? null,
                    pending: scene?.userData?._runtimeSceneRevealPending ?? null,
                    stats: app?.runtimeSceneRevealController?.stats ?? null,
                },
                mask: (() => {
                    const mask = app?.playerMask?.container;
                    return mask ? {display: getComputedStyle(mask).display, mode: mask.dataset.maskMode} : null;
                })(),
                renderer: {
                    constructor: app?.renderer?.constructor?.name ?? null,
                    backend: app?.renderer?.backend?.constructor?.name ?? null,
                    isWebGPU: app?.renderer?.backend?.isWebGPUBackend === true,
                    navigatorGpu: "gpu" in navigator,
                },
            };
        }).catch(error => ({error: String(error)}));
        let screenshotPixels = null;
        try {
            const image = await Jimp.read(screenshotPath);
            const left = Math.floor(image.width * 0.05);
            const right = Math.ceil(image.width * 0.95);
            const top = Math.floor(image.height * 0.55);
            const bottom = Math.ceil(image.height * 0.85);
            const colors = new Set();
            let min = 255;
            let max = 0;
            let nonBackground = 0;
            let samples = 0;
            image.scan(left, top, Math.max(1, right - left), Math.max(1, bottom - top), function(_x, _y, index) {
                const red = this.bitmap.data[index];
                const green = this.bitmap.data[index + 1];
                const blue = this.bitmap.data[index + 2];
                min = Math.min(min, red, green, blue);
                max = Math.max(max, red, green, blue);
                colors.add(`${red >> 4}:${green >> 4}:${blue >> 4}`);
                if (red + green + blue > 120) nonBackground += 1;
                samples += 1;
            });
            const uniqueColors = colors.size;
            const gradientDiversity = uniqueColors >= 32 && max - min >= 48;
            screenshotPixels = {
                width: image.width,
                height: image.height,
                min,
                max,
                uniqueColors,
                nonBackground,
                samples,
                gradientDiversity,
                visualDiversity: uniqueColors >= 12 && max - min >= 48,
                rendered: nonBackground > Math.max(8, samples * 0.002),
            };
        } catch (error) {
            screenshotPixels = {error: String(error)};
        }
        return {
            ...sceneStats,
            screenshotPixels,
        };
    }
    const screenshotPixels = await (async () => {
        try {
            const image = await Jimp.read(screenshotPath);
            const canvas = await target.locator("canvas").boundingBox().catch(() => null);
            const left = Math.max(0, Math.floor((canvas?.x ?? 0) + (canvas?.width ?? image.width) * 0.05));
            const right = Math.min(image.width, Math.ceil((canvas?.x ?? 0) + (canvas?.width ?? image.width) * 0.95));
            const top = Math.max(0, Math.floor((canvas?.y ?? 0) + (canvas?.height ?? image.height) * 0.55));
            const bottom = Math.min(image.height, Math.ceil((canvas?.y ?? 0) + (canvas?.height ?? image.height) * 0.85));
            let min = 255, max = 0, sum = 0, nonBackground = 0, samples = 0;
            let edgeSamples = 0, edges = 0, previousLuminance = null;
            const uniqueColors = new Set();
            const tileColumns = 4;
            const tileRows = 3;
            const tileStats = Array.from({length: tileColumns * tileRows}, () => ({
                colors: new Set(),
                min: 255,
                max: 0,
            }));
            image.scan(left, top, Math.max(1, right - left), Math.max(1, bottom - top), function(_x, _y, idx) {
                const red = this.bitmap.data[idx], green = this.bitmap.data[idx + 1], blue = this.bitmap.data[idx + 2];
                const luminance = red + green + blue;
                min = Math.min(min, red, green, blue); max = Math.max(max, red, green, blue);
                sum += luminance; samples++;
                if (luminance > 120) nonBackground++;
                uniqueColors.add(`${red >> 4}:${green >> 4}:${blue >> 4}`);
                const tileColumn = Math.min(tileColumns - 1, Math.max(0, Math.floor(((_x - left) / Math.max(1, right - left)) * tileColumns)));
                const tileRow = Math.min(tileRows - 1, Math.max(0, Math.floor(((_y - top) / Math.max(1, bottom - top)) * tileRows)));
                const tile = tileStats[tileRow * tileColumns + tileColumn];
                tile.colors.add(`${red >> 4}:${green >> 4}:${blue >> 4}`);
                tile.min = Math.min(tile.min, red, green, blue);
                tile.max = Math.max(tile.max, red, green, blue);
                if (previousLuminance !== null) {
                    edgeSamples++;
                    if (Math.abs(luminance - previousLuminance) >= 54) edges++;
                }
                previousLuminance = luminance;
            });
            const edgeRatio = edgeSamples ? edges / edgeSamples : 0;
            const tileCoverage = tileStats.map(tile => ({
                uniqueColors: tile.colors.size,
                range: tile.max - tile.min,
                diverse: tile.colors.size >= 12 && tile.max - tile.min >= 48,
            }));
            const diverseTileCount = tileCoverage.filter(tile => tile.diverse).length;
            // Smoothly shaded worlds (sky/ocean/aurora scenes) can be richly
            // rendered without producing many hard luminance edges. Accept a
            // high-color, wide-range gradient as a second path while keeping
            // the original edge path for structured geometry. Require diverse
            // coverage in at least three tiles so a colorful HUD/logo cannot
            // make an otherwise flat or blank world pass. The known flat
            // obstruction capture had only 21 quantized colors and remains
            // rejected by both paths.
            const gradientDiversity = uniqueColors.size >= 32 && (max - min) >= 48;
            const visualDiversity = uniqueColors.size >= 12 && diverseTileCount >= 3 && (edgeRatio >= 0.01 || gradientDiversity);
            const requireVisualDiversity = process.env.VISUAL_DIVERSITY_GATE === "1";
            return {width: image.width, height: image.height, crop: {left, top, right, bottom}, min, max, mean: samples ? sum / (samples * 3) : 0, nonBackground, samples, uniqueColors: uniqueColors.size, edgeRatio, gradientDiversity, diverseTileCount, tileCoverage, visualDiversity, rendered: nonBackground > Math.max(8, samples * 0.002) && (!requireVisualDiversity || visualDiversity)};
        } catch (error) {
            return {error: String(error)};
        }
    })();
    return target.evaluate(screenshotPixels => {
        const canvas = document.querySelector("canvas");
        const app = globalThis.app;
        let pixels = null;
        if (canvas) {
            try {
                const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
                if (gl) {
                    const w = Math.min(canvas.width, 128), h = Math.min(canvas.height, 128);
                    const x = Math.max(0, Math.floor((canvas.width - w) / 2)), y = Math.max(0, Math.floor((canvas.height - h) / 2));
                    const p = new Uint8Array(w * h * 4); gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, p);
                    let min = 255, max = 0, sum = 0, nonzero = 0;
                    for (let i = 0; i < p.length; i += 4) { min = Math.min(min, p[i], p[i+1], p[i+2]); max = Math.max(max, p[i], p[i+1], p[i+2]); sum += p[i] + p[i+1] + p[i+2]; if (p[i] || p[i+1] || p[i+2]) nonzero++; }
                    pixels = {w, h, min, max, mean: sum / (w * h * 3), nonzero, bytes: p.length};
                }
            } catch (e) { pixels = {error: String(e)}; }
        }
        let objects = 0, meshes = 0, visibleObjects = 0, visibleMeshes = 0;
        const scene = app?.editor?.scene || app?.scene;
        const runtimeScene = app?.scene;
        const assetCache = app?.assetLoader?.assetCache;
        const resolutionContext = scene?.userData?.assetResolutionContext;
        const modelRefs = [];
        const emptyModelRefs = [];
        scene?.traverse?.(o => { objects++; if (o.visible) visibleObjects++; if (o.isMesh) { meshes++; if (o.visible) visibleMeshes++; } });
        scene?.traverse?.(o => {
            const modelId = o.userData?.modelId;
            if (!modelId) return;
            modelRefs.push(modelId);
            if (!o.isMesh && !o.children?.some?.(child => child.isMesh)) emptyModelRefs.push(modelId);
        });
        const effectScene = app?.effectScene;
        const mask = app?.playerMask?.container;
        const camera = app?.camera;
        let savedCamera = null;
        try { const all = JSON.parse(localStorage.getItem("savedCameras") || "{}"); savedCamera = app?.editor?.sceneID ? all[app.editor.sceneID] || null : null; } catch {}
        let behaviors = null;
        try { behaviors = app?.game?.behaviorManager?.getBehaviors?.().map(b => ({id: b.id, name: b.constructor?.name, target: b.gameObject ? {name: b.gameObject.name, position: b.gameObject.position?.toArray?.()} : null, ready: b._ready, paused: b._paused})); } catch {}
        let runtimeFrameTelemetry = null;
        try { runtimeFrameTelemetry = globalThis.__STEM_RUNTIME_FRAME_TELEMETRY__?.() || null; } catch {}
        const renderFrameDiagnostics = globalThis.__STEM_RENDER_FRAME_DIAGNOSTICS__ ?? null;
        const renderFrameHistory = Array.isArray(globalThis.__STEM_RENDER_FRAME_HISTORY__)
            ? globalThis.__STEM_RENDER_FRAME_HISTORY__.slice(-20)
            : [];
        const renderSubstageDiagnostics = globalThis.__STEM_RENDER_SUBSTAGE_DIAGNOSTICS__ ?? null;
        const physics = app?.physics;
        const physicsImpl = physics?.physics;
        const gamePhysics = app?.game?.physics;
        const player = app?.game?.player;
        let physicsOwnership = null;
        if (player && physics) {
            let dynamicOwner = null;
            try {
                dynamicOwner = physics.getDynamicBodyObject?.(player.uuid) ?? null;
            } catch (error) {
                dynamicOwner = {error: String(error)};
            }
            physicsOwnership = {
                playerUuid: player.uuid,
                dynamicOwnerUuid: dynamicOwner?.uuid ?? null,
                dynamicOwnerIsPlayer: dynamicOwner === player,
                physicsEnabled: !!player.userData?.physics?.enabled,
                ctype: player.userData?.physics?.ctype ?? null,
                dynamicKeys: Array.from(physics?.dynamicObjects?.keys?.() ?? []).slice(0, 20),
                implementationDynamicKeys: Array.from(physicsImpl?.dynamicObjects?.keys?.() ?? []).slice(0, 20),
                gamePhysicsName: gamePhysics?.constructor?.name ?? null,
                gamePhysicsDynamicOwnerUuid: gamePhysics?.getDynamicBodyObject?.(player.uuid)?.uuid ?? null,
                gamePhysicsDynamicKeys: Array.from(gamePhysics?.dynamicObjects?.keys?.() ?? []).slice(0, 20),
                gamePhysicsImplementationDynamicKeys: Array.from(gamePhysics?.physics?.dynamicObjects?.keys?.() ?? []).slice(0, 20),
            };
        }
        const scriptResourceDiagnostics = globalThis.__STEM_SCRIPT_RESOURCE_DIAGNOSTICS__?.() ?? null;
        const animation = app?.renderer?._animation;
        const animationLoop = animation ? {
            requestId: animation._requestId ?? null,
            hasCallback: typeof animation._animationLoop === "function",
            hasContext: !!animation._context,
            contextType: animation._context?.constructor?.name || typeof animation._context,
        } : null;
        const renderEvent = app?.event?.events?.find(e => e?.constructor?.name === "RenderEvent");
        const Three = globalThis.THREE;
        const cameraDirection = camera && Three ? camera.getWorldDirection(new Three.Vector3()).toArray() : null;
        const meshSummary = [];
        scene?.traverse?.(o => {
            if (!o.isMesh || !o.visible || meshSummary.length >= 40) return;
            const box = Three ? new Three.Box3().setFromObject(o) : null;
            const center = box && !box.isEmpty() ? box.getCenter(new Three.Vector3()).toArray() : null;
            const size = box && !box.isEmpty() ? box.getSize(new Three.Vector3()).toArray() : null;
            const material = Array.isArray(o.material) ? o.material[0] : o.material;
            meshSummary.push({name: o.name, position: o.position?.toArray?.(), center, size, material: material?.constructor?.name, materialFlags: {standard: material?.isMeshStandardMaterial, node: material?.isNodeMaterial, basic: material?.isMeshBasicMaterial}, gameVisibility: o.userData?.gameVisibility, isRuntimeOnly: o.userData?.isRuntimeOnly});
        });
        const countScene = targetScene => {
            let count = 0;
            targetScene?.traverse?.(() => { count += 1; });
            return count;
        };
        const countMeshes = targetScene => {
            let count = 0;
            targetScene?.traverse?.(o => { if (o.isMesh) count += 1; });
            return count;
        };
        return {url: location.href, canvas: canvas ? {width: canvas.width, height: canvas.height, css: [canvas.clientWidth, canvas.clientHeight]} : null, pixels, screenshotPixels, objects, meshes, visibleObjects, visibleMeshes, editorSceneObjects: countScene(app?.editor?.scene), editorSceneMeshes: countMeshes(app?.editor?.scene), gameSceneObjects: countScene(app?.game?.scene), gameSceneMeshes: countMeshes(app?.game?.scene), runtimeSceneObjects: countScene(runtimeScene), runtimeSceneMeshes: countMeshes(runtimeScene), assetCacheEntries: assetCache?.size ?? null, assetCacheKeys: assetCache ? Array.from(assetCache.keys()).slice(0, 12) : null, resolutionContextEntries: resolutionContext?.assetIdToRevisionId ? Object.keys(resolutionContext.assetIdToRevisionId).length : 0, modelRefs: modelRefs.length, emptyModelRefs: emptyModelRefs.length, rootChildren: scene?.children?.slice?.(0, 20).map?.(child => ({name: child.name, type: child.type, modelId: child.userData?.modelId, children: child.children?.length})) ?? [], effectSceneMatches: !!(effectScene && effectScene === scene), mode: app?.mode, editorMode: app?.editor?.mode, isPlaying: app?.isPlaying, animationListenerRegistered: !!app?.animationListenerRegistered, animationLoopAttached: app?.appliedAnimationLoopRenderer === app?.renderer && app?.appliedAnimationLoopCallback !== null, lastRenderedFrameAt: app?.lastRenderedFrameAt, renderEvent: renderEvent ? {running: renderEvent.running, pauseDepth: renderEvent.pauseDepth, lastFrameTime: renderEvent.lastFrameTime, lastRenderBreakdown: renderEvent.lastRenderBreakdown, lastRendererFrameInfo: renderEvent.lastRendererFrameInfo} : null, runtimeFrameTelemetry, renderFrameDiagnostics, renderFrameHistory, renderSubstageDiagnostics, playBehaviorTimings: globalThis.__stemPlayBehaviorTimings ?? [], playBehaviorPhaseTimings: globalThis.__stemPlayBehaviorPhaseTimings ?? [], revealFrameHistory: globalThis.__STEM_RUNTIME_REVEAL_FRAME_HISTORY__ ?? [], animationLoop, renderer: app?.renderer?.constructor?.name, backend: app?.renderer?.backend?.constructor?.name, camera: camera ? {position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), direction: cameraDirection, near: camera.near, far: camera.far} : null, savedCamera, sceneID: app?.editor?.sceneID, sceneUserData: {runtimeSceneReveal: scene?.userData?.rendering?.runtimeSceneReveal, revealActive: scene?.userData?._runtimeSceneRevealActive, revealPending: scene?.userData?._runtimeSceneRevealPending}, revealStats: app?.runtimeSceneRevealController?.stats, meshSummary, behaviorNames: app?.game?.behaviorNames, behaviors, player: player ? {name: player.name, position: player.position?.toArray?.()} : null, physicsOwnership, physics: physics ? {name: physics.constructor?.name, useWorker: !!physics.useWorker, pendingWorkerFrame: !!app?.pendingWorkerSimulationFrame, activeFrame: !!app?.activeSimulationFrameContext, worker: !!physics.worker, implementationName: physicsImpl?.constructor?.name, implementationIsWorker: physicsImpl?.isWorker?.(), workerReady: physicsImpl?.isReady?.()} : null, scriptResourceDiagnostics, startGame: !!document.querySelector("#startGameBtn"), mask: mask ? {display: getComputedStyle(mask).display, mode: mask.dataset.maskMode, text: mask.textContent?.trim().slice(0, 120)} : null};
    }, screenshotPixels).catch(e => ({error: String(e)}));
};
const runMatchedTriangleCapture = async () => {
    if (process.env.MATCHED_TRIANGLE_CAPTURE !== "1") return null;
    if (productionImport) {
        return {skipped: true, reason: "production-preview cannot dynamically import the diagnostic utility"};
    }
    const settle = await page.evaluate(async () => {
        const app = globalThis.app;
        if (!app?.scene) return {error: "scene unavailable"};
        app.stopAnimationLoop?.();
        await new Promise(resolve => setTimeout(resolve, 100));
        app.effectRenderer?.render?.();
        return {mode: app.mode, isPlaying: app.isPlaying, isPaused: app.isPaused};
    }).catch(error => ({error: String(error)}));
    const baseline = await capture("matched-baseline");
    const budget = await page.evaluate(async maxTriangles => {
        const app = globalThis.app;
        if (!app?.scene) return {error: "scene unavailable"};
        app.scene.userData ??= {};
        app.scene.userData.rendering ??= {};
        app.scene.userData.rendering.runtimeMainTriangleBudget = {
            enabled: true,
            fallbackOnly: true,
            maxTriangles,
        };
        const mod = await import("/packages/editor-oss/src/utils/runtimeMainTriangleBudget.ts");
        const stats = mod.applyRuntimeMainTriangleBudget(app.scene, {
            isWebGPU: app.renderer?.backend?.isWebGPUBackend === true,
            camera: app.camera,
        });
        app.effectRenderer?.render?.();
        return stats;
    }, Number(process.env.MAIN_TRIANGLE_DIAG_RUNTIME_BUDGET_TRIANGLES || 200000)).catch(error => ({error: String(error)}));
    const budgetFrame = await capture("matched-budget");
    const imageStats = await (async () => {
        try {
            const before = await Jimp.read(resolve(out, "matched-baseline.png"));
            const after = await Jimp.read(resolve(out, "matched-budget.png"));
            const width = Math.min(before.width, after.width);
            const height = Math.min(before.height, after.height);
            let absoluteError = 0;
            let changedPixels = 0;
            const total = width * height * 4;
            for (let y = 0; y < height; y += 1) {
                for (let x = 0; x < width; x += 1) {
                    const index = (y * before.width + x) * 4;
                    const afterIndex = (y * after.width + x) * 4;
                    let pixelChanged = false;
                    for (let channel = 0; channel < 3; channel += 1) {
                        const delta = Math.abs(before.bitmap.data[index + channel] - after.bitmap.data[afterIndex + channel]);
                        absoluteError += delta;
                        pixelChanged ||= delta > 8;
                    }
                    if (pixelChanged) changedPixels += 1;
                }
            }
            return {width, height, normalizedMae: absoluteError / Math.max(1, width * height * 3 * 255), changedPixelRatio: changedPixels / Math.max(1, width * height), totalChannels: total};
        } catch (error) {
            return {error: String(error)};
        }
    })();
    return {settle, baseline, budget, budgetFrame, imageStats};
};
const runMatchedShadowCapture = async () => {
    if (process.env.MATCHED_SHADOW_CAPTURE !== "1") return null;
    if (productionImport) {
        return {skipped: true, reason: "production-preview cannot dynamically import the diagnostic utility"};
    }
    const settle = await page.evaluate(async () => {
        const app = globalThis.app;
        if (!app?.scene) return {error: "scene unavailable"};
        app.stopAnimationLoop?.();
        await new Promise(resolve => setTimeout(resolve, 100));
        app.effectRenderer?.render?.();
        return {
            mode: app.mode,
            isPlaying: app.isPlaying,
            camera: app.camera ? {
                position: app.camera.position.toArray(),
                quaternion: app.camera.quaternion.toArray(),
            } : null,
        };
    }).catch(error => ({error: String(error)}));
    const baseline = await capture("matched-shadow-baseline");
    const budget = await page.evaluate(async maxTriangles => {
        const app = globalThis.app;
        if (!app?.scene) return {error: "scene unavailable"};
        const scene = app.scene;
        const mod = await import("/packages/editor-oss/src/utils/runtimeShadowBudget.ts");
        return mod.applyRuntimeShadowBudget(scene, {
            force: true,
            maxTriangles,
        });
    }, Number(process.env.SHADOW_DIAG_RUNTIME_BUDGET_TRIANGLES || 300000)).catch(error => ({error: String(error)}));
    await page.evaluate(() => globalThis.app?.effectRenderer?.render?.()).catch(() => {});
    const budgetFrame = await capture("matched-shadow-budget");
    const imageStats = await (async () => {
        try {
            const before = await Jimp.read(resolve(out, "matched-shadow-baseline.png"));
            const after = await Jimp.read(resolve(out, "matched-shadow-budget.png"));
            const width = Math.min(before.width, after.width);
            const height = Math.min(before.height, after.height);
            let absoluteError = 0;
            let changedPixels = 0;
            for (let y = 0; y < height; y += 1) {
                for (let x = 0; x < width; x += 1) {
                    const beforeIndex = (y * before.width + x) * 4;
                    const afterIndex = (y * after.width + x) * 4;
                    let pixelChanged = false;
                    for (let channel = 0; channel < 3; channel += 1) {
                        const delta = Math.abs(before.bitmap.data[beforeIndex + channel] - after.bitmap.data[afterIndex + channel]);
                        absoluteError += delta;
                        pixelChanged ||= delta > 8;
                    }
                    if (pixelChanged) changedPixels += 1;
                }
            }
            return {
                width,
                height,
                normalizedMae: absoluteError / Math.max(1, width * height * 3 * 255),
                changedPixelRatio: changedPixels / Math.max(1, width * height),
            };
        } catch (error) {
            return {error: String(error)};
        }
    })();
    const restored = await page.evaluate(async () => {
        const app = globalThis.app;
        if (!app?.scene) return {error: "scene unavailable"};
        const mod = await import("/packages/editor-oss/src/utils/runtimeShadowBudget.ts");
        mod.restoreRuntimeShadowBudget(app.scene);
        let authoredChanged = 0;
        let runtimeCasting = 0;
        app.scene.traverse?.(object => {
            if (!object?.isMesh) return;
            let current = object;
            let runtimeOnly = false;
            while (current) {
                if (current.userData?.isRuntimeOnly === true) {
                    runtimeOnly = true;
                    break;
                }
                current = current.parent;
            }
            if (runtimeOnly && object.castShadow === true) runtimeCasting += 1;
            if (!runtimeOnly && object.userData?.runtimeShadowBudgetOriginalCastShadow !== undefined) authoredChanged += 1;
        });
        return {authoredChanged, runtimeCasting};
    }).catch(error => ({error: String(error)}));
    return {settle, baseline, budget, budgetFrame, imageStats, restored};
};

const dashboardPath = productionImport
    ? "/packages/editor/editor.html?mode=playground"
    : "/dashboard?mode=playground";
await page.goto(`${baseUrl}${dashboardPath}`, {waitUntil: "domcontentloaded", timeout: 30000});
await page.waitForLoadState("networkidle", {timeout: 15000}).catch(() => {});
await dismiss(); await bootstrap();
const importResult = productionImport
    ? await importProjectBundleThroughPicker()
    : await page.evaluate(async payload => {
        const files = payload.files.map(f => {
            const bytes = Uint8Array.from(atob(f.data), c => c.charCodeAt(0));
            return new File([bytes], f.name.split("/").pop(), {type: f.mime});
        });
        // A project with sidecar assets is represented by a root project file
        // and a sibling asset folder (the layout produced by the local store).
        Object.defineProperty(files[0], "webkitRelativePath", {value: files[0].name});
        for (let i = 1; i < files.length; i++) Object.defineProperty(files[i], "webkitRelativePath", {value: payload.files[i].name});
        const mod = await import("/packages/editor-oss/src/persistence/projectBundleImport.ts");
        return mod.importProjectBundleFiles(files);
    }, {files, assetFolderName});
console.log("IMPORT", JSON.stringify(importResult));
const id = importResult.meta.id;
if (process.env.EDITOR_FROM_IMPORT !== "1") {
    await page.goto(`${baseUrl}/dashboard?mode=playground`, {waitUntil: "domcontentloaded", timeout: 30000});
    await page.waitForLoadState("networkidle", {timeout: 20000}).catch(() => {}); await dismiss();
}
if (process.env.DIRECT_FROM_IMPORT === "1") {
    if (process.env.PERF_OVERLAY_ASSERT === "1") {
        await page.evaluate(() => localStorage.setItem("performanceOverlayVisible", "true"));
    }
    await page.goto(`${baseUrl}/create/project/${id}/play?mode=playground&scene=${sceneSlug}`, {waitUntil: "domcontentloaded", timeout: 30000});
    await installModeTrace();
    await page.waitForLoadState("networkidle", {timeout: 20000}).catch(() => {});
    await page.waitForSelector("canvas", {timeout: 30000});
    if (process.env.PERF_OVERLAY_ASSERT === "1") {
        // The Play HUD owns the performance overlay. Exercise its real event
        // path after the imported scene reaches the player route and verify
        // that renderer counters are visible without opening DevTools.
        await page.evaluate(() => {
            window.dispatchEvent(new CustomEvent("togglePerformanceOverlay", {detail: {visible: true}}));
        });
        await page.waitForTimeout(750);
        const rendererDiagnostics = page.locator('[data-testid="renderer-diagnostics"]');
        let overlayVisible = await rendererDiagnostics.count() > 0 && await rendererDiagnostics.isVisible().catch(() => false);
        if (!overlayVisible) {
            await page.evaluate(() => window.dispatchEvent(new CustomEvent("togglePerformanceOverlay", {detail: {visible: true}})));
            await page.waitForTimeout(750);
            overlayVisible = await rendererDiagnostics.count() > 0 && await rendererDiagnostics.isVisible().catch(() => false);
        }
        const rendererText = overlayVisible ? await rendererDiagnostics.innerText() : "";
        console.log("PERF_OVERLAY", JSON.stringify({overlayVisible, rendererText: rendererText.slice(0, 400)}));
        if (!overlayVisible) {
            throw new Error("Performance overlay renderer diagnostics did not mount in Play mode");
        }
    }
    if (process.env.MATERIAL_DIAG === "1") {
        for (let attempt = 0; attempt < 40; attempt += 1) {
            if (await installMaterialDiag()) break;
            await page.waitForTimeout(100);
        }
    }
    if (process.env.PASS_DIAG === "1") {
        for (let attempt = 0; attempt < 40; attempt += 1) {
            if (await installPassDiag()) break;
            await page.waitForTimeout(100);
        }
    }
    if (process.env.SHADOW_DIAG_RUNTIME_BUDGET === "1" && !productionImport) {
        const budget = await page.evaluate(async ({maxTriangles, maxMeshes}) => {
            const scene = globalThis.app?.scene;
            if (!scene) return {error: "scene unavailable"};
            scene.userData ??= {};
            scene.userData.rendering ??= {};
            scene.userData.rendering.runtimeShadowBudget = {
                enabled: true,
                maxTriangles,
                maxMeshes,
            };
            const mod = await import("/packages/editor-oss/src/utils/runtimeShadowBudget.ts");
            return mod.applyRuntimeShadowBudget(scene);
        }, {
            maxTriangles: Number(process.env.SHADOW_DIAG_RUNTIME_BUDGET_TRIANGLES || 300000),
            maxMeshes: Number(process.env.SHADOW_DIAG_RUNTIME_BUDGET_MESHES || 0),
        }).catch(error => ({error: String(error)}));
        console.log("SHADOW_RUNTIME_BUDGET", JSON.stringify(budget));
    }
    if (process.env.MAIN_TRIANGLE_DIAG_RUNTIME_BUDGET === "1" && !productionImport && process.env.MATCHED_TRIANGLE_CAPTURE !== "1") {
        const budget = await page.evaluate(async maxTriangles => {
            const scene = globalThis.app?.scene;
            if (!scene) return {error: "scene unavailable"};
            scene.userData ??= {};
            scene.userData.rendering ??= {};
            scene.userData.rendering.runtimeMainTriangleBudget = {
                enabled: true,
                fallbackOnly: true,
                maxTriangles,
            };
            const mod = await import("/packages/editor-oss/src/utils/runtimeMainTriangleBudget.ts");
            return mod.applyRuntimeMainTriangleBudget(scene, {
                isWebGPU: globalThis.app?.renderer?.backend?.isWebGPUBackend === true,
                camera: globalThis.app?.camera,
            });
        }, Number(process.env.MAIN_TRIANGLE_DIAG_RUNTIME_BUDGET_TRIANGLES || 300000)).catch(error => ({error: String(error)}));
        console.log("MAIN_TRIANGLE_RUNTIME_BUDGET", JSON.stringify(budget));
    }
    if (process.env.TRACE_LOOP === "1") {
        await page.evaluate(() => {
            const g = globalThis;
            const trace = g.__STEM_LOOP_DIAG__ = g.__STEM_LOOP_DIAG__ || {events: [], callbacks: 0, firstCallbackAt: null, lastCallbackAt: null, longTasks: []};
            try {
                new PerformanceObserver(list => {
                    for (const entry of list.getEntries()) trace.longTasks.push({start: Math.round(entry.startTime), duration: Math.round(entry.duration), name: entry.name, attribution: entry.attribution?.map(item => ({name: item.name, containerType: item.containerType, containerName: item.containerName}))});
                }).observe({type: "longtask", buffered: true});
            } catch {}
            const record = (name, extra = {}) => trace.events.push({name, t: Math.round(performance.now()), ...extra});
            const app = g.app;
            if (app && !app.__diagLoopWrapped) {
                const wrap = (owner, name, callbackTransform) => {
                    const original = owner?.[name];
                    if (typeof original !== "function" || original.__diagLoopWrapped) return;
                    const wrapped = function(...args) {
                        record(name, {args: name === "setLegacyAnimationLoopCallback" ? {hasCallback: typeof args[0] === "function"} : undefined});
                        if (callbackTransform) args = callbackTransform(args);
                        return original.apply(this, args);
                    };
                    wrapped.__diagLoopWrapped = true;
                    owner[name] = wrapped;
                };
                wrap(app, "startScheduledAnimationLoop");
                wrap(app, "startAnimationLoop");
                wrap(app, "setLegacyAnimationLoopCallback");
                const renderer = app.renderer;
                if (renderer) {
                    const originalSetAnimationLoop = renderer.setAnimationLoop;
                    if (typeof originalSetAnimationLoop === "function" && !originalSetAnimationLoop.__diagLoopWrapped) {
                        const wrappedSetAnimationLoop = function(callback) {
                            record("renderer.setAnimationLoop", {hasCallback: typeof callback === "function"});
                            const tracedCallback = typeof callback === "function" ? (...cbArgs) => {
                                const now = performance.now();
                                trace.callbacks += 1;
                                trace.firstCallbackAt ??= Math.round(now);
                                trace.lastCallbackAt = Math.round(now);
                                const renderEvent = app.event?.events?.find(e => e?.constructor?.name === "RenderEvent");
                                record("renderer.animationCallback", {callback: trace.callbacks, running: renderEvent?.running, pauseDepth: renderEvent?.pauseDepth, appMode: app.mode, isPlaying: app.isPlaying});
                                const callbackStart = performance.now();
                                try {
                                    return callback.apply(this, cbArgs);
                                } finally {
                                    record("renderer.animationCallbackEnd", {callback: trace.callbacks, duration: Math.round(performance.now() - callbackStart)});
                                }
                            } : callback;
                            return originalSetAnimationLoop.call(this, tracedCallback);
                        };
                        wrappedSetAnimationLoop.__diagLoopWrapped = true;
                        renderer.setAnimationLoop = wrappedSetAnimationLoop;
                    }
                }
                const renderEvent = app.event?.events?.find(e => e?.constructor?.name === "RenderEvent");
                if (renderEvent) {
                    const originalRun = renderEvent.runAnimationLoop;
                    if (typeof originalRun === "function" && !originalRun.__diagLoopWrapped) {
                        const wrappedRun = function(...args) {
                            record("RenderEvent.runAnimationLoop", {running: this.running, pauseDepth: this.pauseDepth});
                            return originalRun.apply(this, args);
                        };
                        wrappedRun.__diagLoopWrapped = true;
                        renderEvent.runAnimationLoop = wrappedRun;
                    }
                }
                app.__diagLoopWrapped = true;
                record("traceInstalled", {mode: app.mode, isPlaying: app.isPlaying, rendererInitialized: app.renderer?.hasInitialized?.()});
            }
        }).catch(() => {});
    }
    if (process.env.CAPTURE_STARTUP_FRAMES === "1") {
        await page.evaluate(() => {
            globalThis.__STEM_CAPTURE_RENDER_FRAME_HISTORY__ = true;
            globalThis.__STEM_RENDER_FRAME_HISTORY__ = [];
        });
    }
    if (process.env.PROFILE_BEHAVIORS === "1") {
        await page.evaluate(async () => {
            const profilerModule = await import("/packages/editor-oss/src/scheduler/SystemProfiler.ts");
            profilerModule.behaviorProfiler.reset();
            profilerModule.behaviorProfiler.enable();
        }).catch(() => {});
    }
    if (process.env.PROFILE_RUNTIME_BEHAVIORS === "1") {
        await page.evaluate(() => {
            const manager = globalThis.app?.game?.behaviorManager;
            const behaviors = manager?.getBehaviors?.() ?? [];
            const behaviorNames = globalThis.app?.game?.behaviorNames ?? {};
            const metrics = globalThis.__STEM_RUNTIME_BEHAVIOR_PROFILE__ = {
                capturedAt: Math.round(performance.now()),
                behaviors: [],
            };
            for (const behavior of behaviors) {
                if (!behavior || behavior.__stemRuntimeBehaviorProfileWrapped) continue;
                const metric = {
                    id: behavior.id ?? behavior.constructor?.name ?? "unknown",
                    label: behaviorNames[behavior.id] ?? behavior.id ?? behavior.constructor?.name ?? "unknown",
                    uuid: behavior.uuid ?? null,
                    target: behavior.gameObject?.name ?? null,
                    update: {calls: 0, totalMs: 0, maxMs: 0},
                    fixedUpdate: {calls: 0, totalMs: 0, maxMs: 0},
                };
                for (const phase of ["update", "fixedUpdate"]) {
                    const original = behavior[phase];
                    if (typeof original !== "function") continue;
                    const wrapped = function(...args) {
                        const startedAt = performance.now();
                        try {
                            return original.apply(this, args);
                        } finally {
                            const elapsed = performance.now() - startedAt;
                            const row = metric[phase];
                            row.calls += 1;
                            row.totalMs += elapsed;
                            row.maxMs = Math.max(row.maxMs, elapsed);
                        }
                    };
                    wrapped.__stemRuntimeBehaviorProfileWrapped = true;
                    behavior[phase] = wrapped;
                }
                behavior.__stemRuntimeBehaviorProfileWrapped = true;
                metrics.behaviors.push(metric);
            }
        }).catch(() => {});
    }
    if (process.env.PROFILE_STAGES === "1") {
        await page.evaluate(() => {
            const app = globalThis.app;
            const samples = globalThis.__STEM_STAGE_PROFILE__ = {};
            const longTasks = globalThis.__STEM_LONGTASK_PROFILE__ = [];
            try {
                new PerformanceObserver(list => {
                    for (const entry of list.getEntries()) {
                        longTasks.push({start: Math.round(entry.startTime), duration: Math.round(entry.duration)});
                    }
                }).observe({type: "longtask", buffered: true});
            } catch {}
            const wrap = (owner, name) => {
                const original = owner?.[name];
                if (typeof original !== "function" || original.__stemStageProfileWrapped) return;
                const wrapped = function(...args) {
                    const start = performance.now();
                    try { return original.apply(this, args); }
                    finally {
                        const item = samples[name] ??= {calls: 0, totalMs: 0, maxMs: 0};
                        const elapsed = performance.now() - start;
                        item.calls += 1; item.totalMs += elapsed; item.maxMs = Math.max(item.maxMs, elapsed);
                    }
                };
                wrapped.__stemStageProfileWrapped = true;
                owner[name] = wrapped;
            };
            wrap(app, "animate");
            const originalCall = app?.call;
            if (typeof originalCall === "function" && !originalCall.__stemStageProfileWrapped) {
                const wrappedCall = function(event, ...args) {
                    const start = performance.now();
                    try { return originalCall.call(this, event, ...args); }
                    finally {
                        const key = `event:${String(event)}`;
                        const item = samples[key] ??= {calls: 0, totalMs: 0, maxMs: 0};
                        const elapsed = performance.now() - start;
                        item.calls += 1; item.totalMs += elapsed; item.maxMs = Math.max(item.maxMs, elapsed);
                    }
                };
                wrappedCall.__stemStageProfileWrapped = true;
                app.call = wrappedCall;
            }
            wrap(app.game, "update");
            wrap(app.game, "fixedUpdate");
            wrap(app.physics, "fixedUpdate");
            const renderEvent = app?.event?.events?.find(e => e?.constructor?.name === "RenderEvent");
            wrap(renderEvent, "animate");
            wrap(app.batchedRenderer, "update");
            wrap(app.effectRenderer, "render");
            wrap(app.renderer, "render");
            wrap(app.aiWorldControl, "update");
            wrap(app.animationControl, "update");
            wrap(app.animationGraphControl, "update");
            wrap(app.audioControl, "update");
            wrap(app.playerEvent, "update");
        }).catch(() => {});
    }
    await page.waitForTimeout(Number(process.env.PLAY_WAIT_MS || 12000));
    if (process.env.CAPTURE_SETTLED_PASS === "1" && process.env.PASS_DIAG === "1") {
        await page.evaluate(async () => {
            const render = globalThis.app?.effectRenderer?.render?.bind(globalThis.app.effectRenderer);
            if (render) await render();
        }).catch(() => {});
    }
    if (process.env.SHADOW_DIAG_RUNTIME_BUDGET === "1" && !productionImport) {
        const budget = await page.evaluate(async () => {
            const scene = globalThis.app?.scene;
            if (!scene) return {error: "scene unavailable"};
            const mod = await import("/packages/editor-oss/src/utils/runtimeShadowBudget.ts");
            return mod.applyRuntimeShadowBudget(scene);
        }).catch(error => ({error: String(error)}));
        console.log("SHADOW_RUNTIME_BUDGET_AFTER_WAIT", JSON.stringify(budget));
    }
    if (process.env.MAIN_TRIANGLE_DIAG_RUNTIME_BUDGET === "1" && !productionImport && process.env.MATCHED_TRIANGLE_CAPTURE !== "1") {
        const budget = await page.evaluate(async () => {
            const scene = globalThis.app?.scene;
            if (!scene) return {error: "scene unavailable"};
            const mod = await import("/packages/editor-oss/src/utils/runtimeMainTriangleBudget.ts");
            return mod.applyRuntimeMainTriangleBudget(scene, {
                isWebGPU: globalThis.app?.renderer?.backend?.isWebGPUBackend === true,
                camera: globalThis.app?.camera,
            });
        }).catch(error => ({error: String(error)}));
        console.log("MAIN_TRIANGLE_RUNTIME_BUDGET_AFTER_WAIT", JSON.stringify(budget));
    }
    if (process.env.SHADOW_DIAG_DISABLE_RUNTIME === "1") {
        console.log("SHADOW_DIAG_DISABLE_RUNTIME", JSON.stringify(await page.evaluate(rootFilter => {
            const scene = globalThis.app?.scene;
            let changed = 0;
            let triangles = 0;
            const isRuntime = object => {
                let current = object;
                while (current) {
                    if (current.userData?.isRuntimeOnly === true) return true;
                    current = current.parent;
                }
                return false;
            };
            scene?.traverse?.(object => {
                if (!object?.isMesh || !object.castShadow || !isRuntime(object)) return;
                let root = object;
                while (root.parent && root.parent !== scene) root = root.parent;
                if (rootFilter && root.name !== rootFilter) return;
                const geometry = object.geometry;
                const base = geometry?.index?.count || geometry?.attributes?.position?.count || 0;
                const count = object.isInstancedMesh ? object.count || 0 : 1;
                triangles += Math.round(base * count / 3);
                object.castShadow = false;
                changed += 1;
            });
            return {rootFilter: rootFilter || null, changed, triangles};
        }, process.env.SHADOW_DIAG_ROOT || "").catch(error => ({error: String(error)}))));
    }
    if (process.env.TRACK_STRESS === "1") {
        const stressDurationMs = Math.max(1000, Number(process.env.STRESS_WAIT_MS || 5000));
        const stressX = Number(process.env.STRESS_X || Math.max(1, viewport.width - 96));
        const stressY = Number(process.env.STRESS_Y || 78);
        await page.evaluate(durationMs => {
            const g = globalThis;
            const trace = g.__STEM_TRACK_STRESS__ = {startedAt: performance.now(), durationMs, frames: [], longTasks: [], done: false};
            try {
                new PerformanceObserver(list => {
                    for (const entry of list.getEntries()) trace.longTasks.push({start: entry.startTime, duration: entry.duration});
                }).observe({type: "longtask", buffered: true});
            } catch {}
            let previous = performance.now();
            const sample = now => {
                trace.frames.push(now - previous);
                previous = now;
                if (now - trace.startedAt < trace.durationMs) requestAnimationFrame(sample);
                else trace.done = true;
            };
            requestAnimationFrame(sample);
        }, stressDurationMs).catch(() => {});
        await page.mouse.click(stressX, stressY);
        await page.waitForTimeout(stressDurationMs);
        const stress = await page.evaluate(() => {
            const trace = globalThis.__STEM_TRACK_STRESS__ || {};
            const frames = Array.isArray(trace.frames) ? trace.frames.filter(value => Number.isFinite(value) && value > 0) : [];
            const longTasks = Array.isArray(trace.longTasks) ? trace.longTasks : [];
            const percentile = (values, quantile) => {
                if (!values.length) return null;
                const sorted = [...values].sort((a, b) => a - b);
                return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))];
            };
            let objects = 0;
            let meshes = 0;
            globalThis.app?.scene?.traverse?.(object => {
                objects += 1;
                if (object.isMesh) meshes += 1;
            });
            const taskDurations = longTasks.map(entry => entry.duration).filter(Number.isFinite);
            const instancer = globalThis.app?.effectRenderer?.runtimeMeshInstancer;
            const runtimeSample = [];
            let runtimeVisible = 0;
            const runtimeGeometryIds = new Set();
            const runtimeMaterialIds = new Set();
            const npcGeometryCounts = new Map();
            globalThis.app?.scene?.traverse?.(object => {
                if (object.userData?.isRuntimeOnly === true && object.isMesh === true) {
                    if (object.visible) runtimeVisible += 1;
                    if (object.geometry?.uuid) runtimeGeometryIds.add(object.geometry.uuid);
                    if (!Array.isArray(object.material) && object.material?.uuid) runtimeMaterialIds.add(object.material.uuid);
                    if (object.parent?.parent?.name === "NpcTrafficRuntimeRoot" || object.parent?.name === "NpcTrafficRuntimeRoot") {
                        const key = object.geometry?.uuid ?? "none";
                        npcGeometryCounts.set(key, (npcGeometryCounts.get(key) ?? 0) + 1);
                    }
                    if (runtimeSample.length < 8) runtimeSample.push({name: object.name, visible: object.visible, ctor: object.constructor?.name, material: Array.isArray(object.material) ? "array" : object.material?.constructor?.name, materialType: object.material?.type, color: object.material?.color?.getHexString?.() ?? null, map: object.material?.map?.uuid ?? null, normalMap: object.material?.normalMap?.uuid ?? null, geometry: object.geometry?.uuid ?? null, isInstanced: object.isInstancedMesh === true});
                }
            });
            return {
                durationMs: trace.durationMs ?? null,
                frames: frames.length,
                frameP50Ms: percentile(frames, 0.5),
                frameP95Ms: percentile(frames, 0.95),
                frameMaxMs: frames.length ? Math.max(...frames) : null,
                over33Ms: frames.filter(value => value > 33.3).length,
                longTasks: taskDurations.length,
                longTaskP95Ms: percentile(taskDurations, 0.95),
                longTaskMaxMs: taskDurations.length ? Math.max(...taskDurations) : null,
                objects,
                meshes,
                instancing: instancer?.getStats?.(meshes) ?? null,
                instancingState: {
                    appMode: globalThis.app?.mode ?? null,
                    appIsPlaying: globalThis.app?.isPlaying ?? null,
                    hasEffectRenderer: !!globalThis.app?.effectRenderer,
                    renderer: globalThis.app?.effectRenderer?.renderer?.constructor?.name ?? null,
                    revealActive: globalThis.app?.scene?.userData?._runtimeSceneRevealActive ?? null,
                    instancerGroups: instancer?.groups?.length ?? null,
                    instancerSources: instancer?.sourceVisibility?.size ?? null,
                    runtimeVisible,
                    runtimeGeometryCount: runtimeGeometryIds.size,
                    runtimeMaterialCount: runtimeMaterialIds.size,
                    npcGeometryMaxCount: Math.max(0, ...npcGeometryCounts.values()),
                    npcGeometryGroups: npcGeometryCounts.size,
                    runtimeSample,
                },
                done: trace.done === true,
            };
        }).catch(error => ({error: String(error)}));
        console.log("TRACK_STRESS", JSON.stringify({click: {x: stressX, y: stressY}, ...stress}));
    }
    if (process.env.PRINT_TOP_OBJECTS === "1") {
        const topObjects = await page.evaluate(() => {
            const scene = globalThis.app?.scene;
            const rows = [];
            scene?.traverse?.(object => {
                if (!object.isMesh && !object.isInstancedMesh) return;
                const geometry = object.geometry;
                const base = geometry?.index?.count || geometry?.attributes?.position?.count || 0;
                const count = object.isInstancedMesh ? object.count || 0 : 1;
                rows.push({name: object.name, parent: object.parent?.name, uuid: object.uuid, visible: object.visible, runtime: object.userData?.isRuntimeOnly, tris: Math.round(base * count / 3), position: object.position?.toArray?.(), material: Array.isArray(object.material) ? object.material[0]?.type : object.material?.type});
            });
            return {top: rows.sort((a, b) => b.tris - a.tris).slice(0, 80), named: rows.filter(row => row.name).slice(0, 160)};
        }).catch(e => ({error: String(e)}));
        console.log("TOP_OBJECTS", JSON.stringify(topObjects));
    }
    const directFromImportState = await capture("02-play");
    console.log("PLAY", JSON.stringify(directFromImportState));
    if (process.env.RENDER_SUBSTAGE_DIAG === "1") {
        console.log("RENDER_SUBSTAGE", JSON.stringify(directFromImportState?.renderSubstageDiagnostics ?? null));
    }
    if (process.env.VISUAL_DIVERSITY_GATE === "1" && directFromImportState?.screenshotPixels?.visualDiversity !== true) {
        console.error("VISUAL_DIVERSITY_GATE_FAILED", JSON.stringify({label: "02-play", screenshotPixels: directFromImportState?.screenshotPixels ?? null}));
        process.exitCode = 1;
    }
    if (process.env.BATCH_TIMELINE === "1") {
        const timeline = await page.evaluate(async () => {
            const samples = [];
            const adapterProbe = await globalThis.navigator?.gpu?.requestAdapter?.().then(adapter => adapter ? {
                available: true,
                maxSampledTexturesPerShaderStage: adapter.limits?.maxSampledTexturesPerShaderStage ?? null,
            } : {available: false}).catch(error => ({available: false, error: String(error)}));
            const read = () => {
                const effectRenderer = globalThis.app?.effectRenderer;
                return {
                    webgpuAvailable: !!globalThis.navigator?.gpu,
                    webgpuRequestAdapter: typeof globalThis.navigator?.gpu?.requestAdapter === "function",
                    batchEnabled: effectRenderer?.batchEnabled ?? null,
                    batchManager: !!effectRenderer?.batchManager,
                    batchStats: effectRenderer?.batchManager?.getBatchStats?.() ?? null,
                };
            };
            samples.push({atMs: 0, ...read()});
            for (const atMs of [250, 750, 1500, 3000]) {
                await new Promise(resolve => setTimeout(resolve, atMs - (samples.at(-1)?.atMs ?? 0)));
                samples.push({atMs, ...read()});
            }
            return {
                adapterProbe,
                samples,
                supportDiagnostic: globalThis.__STEM_BATCH_SUPPORT_DIAG__ ?? null,
                supportDiagnosticHistory: globalThis.__STEM_BATCH_SUPPORT_DIAG_HISTORY__ ?? [],
            };
        }).catch(error => ({error: String(error)}));
        console.log("BATCH_TIMELINE", JSON.stringify(timeline));
        console.log("BATCH_SUPPORT_LOGS", JSON.stringify(logs.filter(entry => entry.includes("BatchManagerSupport"))));
    }
    if (process.env.MATERIAL_DIAG === "1") {
        console.log("MATERIALDIAG", JSON.stringify(await page.evaluate(() => globalThis.__STEM_MATERIAL_DIAG__ ?? null).catch(error => ({error: String(error)}))));
    }
    if (process.env.PASS_DIAG === "1") {
        console.log("PASSDIAG", JSON.stringify(await page.evaluate(() => {
            const app = globalThis.app;
            const csm = [];
            let shadowMeshes = 0;
            let meshes = 0;
            let shadowNodeLights = null;
            let shadowNodeCascades = null;
            const shadowRoots = new Map();
            const topShadowCasters = [];
            const mainTriangleUnits = new Map();
            const topMainTriangleUnits = [];
            const triangleCount = object => {
                const geometry = object?.geometry;
                const base = geometry?.index?.count || geometry?.attributes?.position?.count || 0;
                const instances = object?.isInstancedMesh ? object.count || 0 : 1;
                return Math.round(base * instances / 3);
            };
            const materialType = object => Array.isArray(object?.material)
                ? object.material.map(material => material?.type || "?").join(",")
                : object?.material?.type || "?";
            const runtimeUnitFor = object => {
                const chain = [];
                let current = object;
                while (current && current !== app?.scene) {
                    chain.push(current);
                    current = current.parent;
                }
                chain.push(app?.scene);
                chain.reverse();
                const root = chain[1] || object;
                // Use the first logical child beneath a runtime root. This keeps
                // track cells/NPC clones as budgetable visual units instead of
                // collapsing an entire runtime subsystem into one toggle.
                const unit = chain.length <= 3
                    ? chain.at(-1) || root
                    : chain[Math.min(3, Math.max(1, chain.length - 2))] || root;
                return {root, unit, path: chain.slice(1).map(node => node?.name || node?.type || "(unnamed)")};
            };
            const isVisibleInScene = object => {
                let current = object;
                while (current && current !== app?.scene) {
                    if (current.visible === false) return false;
                    current = current.parent;
                }
                return true;
            };
            const distanceClassFor = unit => {
                const camera = app?.camera;
                if (!camera?.position || typeof unit?.getWorldPosition !== "function") return "unknown";
                try {
                    const unitPosition = unit.getWorldPosition(unit.position.clone());
                    const cameraPosition = camera.getWorldPosition?.(camera.position.clone()) ?? camera.position;
                    const distance = unitPosition.distanceTo(cameraPosition);
                    return distance < 12 ? "near" : distance < 35 ? "mid" : "far";
                } catch {
                    return "unknown";
                }
            };
            const isHeroLike = object => {
                let current = object;
                while (current) {
                    const name = String(current.name || "").toLowerCase();
                    const tags = current.userData?.tags;
                    if (name === "player" || name === "hero" || name.includes("player") ||
                        (Array.isArray(tags) && tags.some(tag => ["player", "hero"].includes(String(tag).toLowerCase())))) {
                        return true;
                    }
                    current = current.parent;
                }
                return false;
            };
            const shadowRowFor = object => {
                let current = object;
                let root = object;
                let runtimeOnly = false;
                const path = [];
                while (current) {
                    if (current.userData?.isRuntimeOnly === true) runtimeOnly = true;
                    if (current.name) path.push(current.name);
                    if (current.parent === app?.scene) {
                        root = current;
                        break;
                    }
                    current = current.parent;
                }
                return {
                    name: object.name || "(unnamed)",
                    root: root?.name || root?.type || "scene",
                    runtimeOnly,
                    triangles: triangleCount(object),
                    material: materialType(object),
                    path: path.reverse().slice(-5),
                };
            };
            app?.scene?.traverse?.(object => {
                if (object?.isMesh) {
                    meshes += 1;
                    if (object.visible && isVisibleInScene(object)) {
                        const {root, unit, path} = runtimeUnitFor(object);
                        let runtimeOnly = false;
                        let current = object;
                        while (current) {
                            if (current.userData?.isRuntimeOnly === true) {
                                runtimeOnly = true;
                                break;
                            }
                            current = current.parent;
                        }
                        if (runtimeOnly) {
                            const key = `${root?.uuid || "scene"}|${unit?.uuid || object.uuid}`;
                            const aggregate = mainTriangleUnits.get(key) ?? {
                                root: root?.name || root?.type || "scene",
                                unit: unit?.name || unit?.type || "(unnamed)",
                                runtimeOnly: true,
                                meshes: 0,
                                triangles: 0,
                                materials: new Map(),
                                distanceClass: distanceClassFor(unit),
                                preserve: isHeroLike(unit) || unit?.userData?.runtimeMainPreserve === true,
                                disable: unit?.userData?.disableRuntimeMainTriangleBudget === true,
                                path,
                            };
                            aggregate.meshes += 1;
                            aggregate.triangles += triangleCount(object);
                            aggregate.materials.set(materialType(object), (aggregate.materials.get(materialType(object)) ?? 0) + 1);
                            mainTriangleUnits.set(key, aggregate);
                            topMainTriangleUnits.push({
                                root: aggregate.root,
                                unit: aggregate.unit,
                                triangles: triangleCount(object),
                                material: materialType(object),
                                distanceClass: aggregate.distanceClass,
                                preserve: aggregate.preserve,
                                disable: aggregate.disable,
                                path: aggregate.path,
                            });
                        }
                    }
                    if (object.castShadow) {
                        shadowMeshes += 1;
                        const row = shadowRowFor(object);
                        topShadowCasters.push(row);
                        const key = `${row.root}|${row.runtimeOnly ? "runtime" : "authored"}`;
                        const aggregate = shadowRoots.get(key) ?? {
                            root: row.root,
                            runtimeOnly: row.runtimeOnly,
                            meshes: 0,
                            triangles: 0,
                            materials: new Map(),
                        };
                        aggregate.meshes += 1;
                        aggregate.triangles += row.triangles;
                        aggregate.materials.set(row.material, (aggregate.materials.get(row.material) ?? 0) + 1);
                        shadowRoots.set(key, aggregate);
                    }
                }
                for (const behavior of object?.userData?.behaviors ?? []) {
                    if (behavior?.id === "csm") csm.push({object: object.name, behavior});
                }
                if (object?.isDirectionalLight && object.name === "Directional Light") {
                    shadowNodeLights = object.shadow?.shadowNode?.lights?.length ?? null;
                    shadowNodeCascades = object.shadow?.shadowNode?.cascades ?? null;
                }
            });
            const renderer = app?.renderer;
            return {
                pass: globalThis.__STEM_PASS_DIAG__ ?? null,
                csm,
                shadowNodeLights,
                shadowNodeCascades,
                meshes,
                shadowMeshes,
                runtimeMainTriangles: [...mainTriangleUnits.values()].reduce((sum, row) => sum + row.triangles, 0),
                mainTriangleUnits: [...mainTriangleUnits.values()]
                    .map(row => ({...row, materials: Object.fromEntries(row.materials)}))
                    .sort((a, b) => b.triangles - a.triangles),
                topMainTriangleUnits: topMainTriangleUnits.sort((a, b) => b.triangles - a.triangles).slice(0, 80),
                shadowRoots: [...shadowRoots.values()]
                    .map(row => ({...row, materials: Object.fromEntries(row.materials)}))
                    .sort((a, b) => b.triangles - a.triangles),
                topShadowCasters: topShadowCasters.sort((a, b) => b.triangles - a.triangles).slice(0, 40),
                rendererFlags: {
                    isWebGPURenderer: renderer?.isWebGPURenderer ?? null,
                    isWebGPU: renderer?.isWebGPU ?? null,
                    backendIsWebGPU: renderer?.backend?.isWebGPUBackend ?? null,
                    constructor: renderer?.constructor?.name ?? null,
                },
            };
        }).catch(error => ({error: String(error)}))));
        console.log("PASSDIAG_SUMMARY", JSON.stringify(await page.evaluate(() => {
            const trace = globalThis.__STEM_PASS_DIAG__;
            return trace?.frames?.map?.(frame => ({
                durationMs: frame.durationMs,
                passes: frame.calls?.map?.(call => ({scene: call.scene?.name ?? null, camera: call.camera, rendererDelta: call.rendererDelta})),
                rendererInfo: frame.rendererInfo,
            })) ?? null;
        }).catch(error => ({error: String(error)}))));
    }
    if (process.env.SHADOW_DIAG_RUNTIME_BUDGET === "1") {
        console.log("SHADOW_RUNTIME_BUDGET_LOGS", JSON.stringify(logs.filter(entry => entry.includes("RuntimeShadowBudget"))));
    }
    if (process.env.MAIN_TRIANGLE_DIAG_RUNTIME_BUDGET === "1") {
        console.log("MAIN_TRIANGLE_RUNTIME_BUDGET_LOGS", JSON.stringify(logs.filter(entry => entry.includes("RuntimeMainTriangleBudget"))));
    }
    if (process.env.SKIP_BATCH_DIAG !== "1") {
        console.log("BATCH_DIAG", JSON.stringify(await page.evaluate(() => {
            const effectRenderer = globalThis.app?.effectRenderer;
            const manager = effectRenderer?.batchManager;
            return {
                batchEnabled: effectRenderer?.batchEnabled ?? null,
                batchManager: !!manager,
                stats: manager?.getBatchStats?.() ?? null,
                rendererInfo: globalThis.app?.renderer?.info ?? null,
            };
        }).catch(e => ({error: String(e)}))));
    }
    const directFromImportTimings = await page.evaluate(() => globalThis.__stemPlayStartTimings || []).catch(e => ({error: String(e)}));
    console.log("PLAY_TIMINGS_SUMMARY", JSON.stringify(Object.fromEntries((Array.isArray(directFromImportTimings) ? directFromImportTimings : []).filter(entry => ["gameCreate", "autoStart:gameStart", "runtimeMaterialBudgetPrewarm", "runtimeInstancingBudgetPrewarm", "rendererWarmup", "rendererWarmupPath", "firstRenderHandshakePath", "firstRenderHandshake", "startPlayerTotal", "autoStart:preGameStartPaint", "autoStart:initialRuntimeSceneReveal"].includes(entry.phase)).map(entry => [entry.phase, entry.phase.endsWith("Path") ? entry.message ?? entry.ms : entry.ms ?? entry.message]))));
    console.log("PLAY_TIMINGS_ALL", JSON.stringify((Array.isArray(directFromImportTimings) ? directFromImportTimings : []).map(entry => ({phase: entry.phase, ms: entry.ms, startedAt: entry.startedAt, endedAt: entry.endedAt, message: entry.message}))));
    if (process.env.PROFILE_BEHAVIORS === "1") {
        console.log("BEHAVIOR_PROFILE", JSON.stringify(await page.evaluate(async () => {
            const profilerModule = await import("/packages/editor-oss/src/scheduler/SystemProfiler.ts");
            return profilerModule.behaviorProfiler.getMetrics().sort((a, b) => b.avgExecutionTimeMs - a.avgExecutionTimeMs).slice(0, 12);
        }).catch(e => ({error: String(e)}))));
    }
    if (process.env.PROFILE_RUNTIME_BEHAVIORS === "1") {
        console.log("RUNTIME_BEHAVIOR_PROFILE", JSON.stringify(await page.evaluate(() => {
            const profile = globalThis.__STEM_RUNTIME_BEHAVIOR_PROFILE__;
            return profile ? {
                capturedAt: profile.capturedAt,
                behaviors: profile.behaviors
                    .sort((a, b) => (b.update.totalMs + b.fixedUpdate.totalMs) - (a.update.totalMs + a.fixedUpdate.totalMs))
                    .slice(0, 24),
            } : null;
        }).catch(e => ({error: String(e)}))));
        console.log("SLOW_BEHAVIOR_INIT_WARNINGS", JSON.stringify(logs.filter(entry => entry.includes("Slow behavior init"))));
    }
    if (process.env.PROFILE_STAGES === "1") {
        console.log("STAGE_PROFILE", JSON.stringify(await page.evaluate(() => globalThis.__STEM_STAGE_PROFILE__ || null).catch(e => ({error: String(e)}))));
        console.log("LONGTASK_PROFILE", JSON.stringify(await page.evaluate(() => globalThis.__STEM_LONGTASK_PROFILE__ || null).catch(e => ({error: String(e)}))));
    }
    await page.waitForTimeout(Number(process.env.POST_DIAG_WAIT_MS ?? process.env.PLAY_WAIT_MS ?? 12000));
    if (process.env.FREEZE_BEFORE_CAPTURE === "1") {
        await page.evaluate(async () => {
            const app = globalThis.app;
            app?.stopAnimationLoop?.();
            await new Promise(resolve => setTimeout(resolve, 100));
            app?.effectRenderer?.render?.();
        }).catch(() => {});
    }
    if (process.env.MATCHED_TRIANGLE_CAPTURE === "1") {
        console.log("MATCHED_TRIANGLE_CAPTURE", JSON.stringify(await runMatchedTriangleCapture()));
    }
    if (process.env.MATCHED_SHADOW_CAPTURE === "1") {
        console.log("MATCHED_SHADOW_CAPTURE", JSON.stringify(await runMatchedShadowCapture()));
    }
    const directPlayStopCycles = Math.max(0, Number(process.env.PLAY_STOP_CYCLES || 0));
    if (directPlayStopCycles > 0) {
        const cycleResults = [];
        const readDirectCycleState = async (collectHeap = false) => page.evaluate(async collect => {
            if (collect && typeof globalThis.gc === "function") {
                globalThis.gc();
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            const app = globalThis.app;
            return {
                url: location.href,
                mode: app?.mode ?? null,
                isPlaying: app?.isPlaying ?? null,
                isModeTransitioning: app?.isModeTransitioning ?? false,
                sceneID: app?.editor?.sceneID ?? null,
                sceneObjects: (() => {
                    let count = 0;
                    app?.scene?.traverse?.(() => { count += 1; });
                    return count;
                })(),
                shadowState: (() => {
                    let meshes = 0;
                    let castShadow = 0;
                    let runtimeMeshes = 0;
                    let runtimeCastShadow = 0;
                    app?.scene?.traverse?.(object => {
                        if (!object?.isMesh) return;
                        meshes += 1;
                        if (object.castShadow) castShadow += 1;
                        let current = object;
                        let runtimeOnly = false;
                        while (current) {
                            if (current.userData?.isRuntimeOnly === true) {
                                runtimeOnly = true;
                                break;
                            }
                            current = current.parent;
                        }
                        if (runtimeOnly) {
                            runtimeMeshes += 1;
                            if (object.castShadow) runtimeCastShadow += 1;
                        }
                    });
                    return {meshes, castShadow, runtimeMeshes, runtimeCastShadow};
                })(),
                mainTriangleState: (() => {
                    let hiddenUnits = 0;
                    let hiddenRuntimeMeshes = 0;
                    let runtimeMeshes = 0;
                    app?.scene?.traverse?.(object => {
                        if (object?.userData?.runtimeMainTriangleBudgetHidden === true) hiddenUnits += 1;
                        if (!object?.isMesh) return;
                        let current = object;
                        let runtimeOnly = false;
                        while (current) {
                            if (current.userData?.isRuntimeOnly === true) {
                                runtimeOnly = true;
                                break;
                            }
                            current = current.parent;
                        }
                        if (runtimeOnly) {
                            runtimeMeshes += 1;
                            if (!object.visible) hiddenRuntimeMeshes += 1;
                        }
                    });
                    return {hiddenUnits, runtimeMeshes, hiddenRuntimeMeshes};
                })(),
                hiddenRuntimeOwners: {
                    fixedStepListenerPhysics: !!app?.fixedStepListenerPhysics,
                    pendingWorkerSimulationFrame: !!app?.pendingWorkerSimulationFrame,
                    activeSimulationFrameContext: !!app?.activeSimulationFrameContext,
                },
                scriptResourceDiagnostics: globalThis.__STEM_SCRIPT_RESOURCE_DIAGNOSTICS__?.() ?? null,
                gcAvailable: typeof globalThis.gc === "function",
                usedJSHeapSize: performance.memory?.usedJSHeapSize ?? null,
                totalJSHeapSize: performance.memory?.totalJSHeapSize ?? null,
            };
        }, collectHeap).catch(error => ({error: String(error)}));
        const waitForDirectMode = async expectedMode => {
            const deadline = Date.now() + 30000;
            let lastState = null;
            while (Date.now() < deadline) {
                lastState = await readDirectCycleState(false);
                if (lastState.mode === expectedMode && lastState.isModeTransitioning === false &&
                    (expectedMode !== "play" || lastState.isPlaying === true)) {
                    return lastState;
                }
                await page.waitForTimeout(250);
            }
            return lastState;
        };
        for (let cycle = 1; cycle <= directPlayStopCycles; cycle += 1) {
            const stopTransition = await page.evaluate(() => {
                const app = globalThis.app;
                try {
                    const result = app?.setMode?.("edit", {editorSavePolicy: "discard"});
                    result?.catch?.(() => {});
                    return {ok: true};
                } catch (error) {
                    return {ok: false, error: String(error)};
                }
            }).catch(error => ({ok: false, error: String(error)}));
            const stopState = await waitForDirectMode("edit");
            const afterStop = await readDirectCycleState(process.env.FORCE_GC === "1");
            const playTransition = await page.evaluate(() => {
                const app = globalThis.app;
                try {
                    const result = app?.setMode?.("play");
                    result?.catch?.(() => {});
                    return {ok: true};
                } catch (error) {
                    return {ok: false, error: String(error)};
                }
            }).catch(error => ({ok: false, error: String(error)}));
            const playState = await waitForDirectMode("play");
            await page.waitForTimeout(Number(process.env.CYCLE_PLAY_WAIT_MS || 900));
            const afterPlay = await readDirectCycleState(process.env.FORCE_GC === "1");
            const diagnostics = afterStop.scriptResourceDiagnostics;
            const resourcesClean = !diagnostics || (
                diagnostics.timeouts === 0 && diagnostics.intervals === 0 &&
                diagnostics.animationFrames === 0 && diagnostics.listeners === 0 &&
                diagnostics.audioNodes === 0 && diagnostics.audioContexts === 0
            );
            const shadowRestored = !!afterStop?.shadowState && !!stopState?.shadowState &&
                afterStop.shadowState.meshes === stopState.shadowState.meshes &&
                afterStop.shadowState.castShadow === stopState.shadowState.castShadow &&
                afterStop.shadowState.runtimeMeshes === stopState.shadowState.runtimeMeshes &&
                afterStop.shadowState.runtimeCastShadow === stopState.shadowState.runtimeCastShadow;
            const mainTriangleRestored = !!afterStop?.mainTriangleState &&
                afterStop.mainTriangleState.hiddenUnits === 0;
            const stopped = stopTransition.ok && stopState?.mode === "edit" &&
                stopState?.isPlaying === false && stopState?.isModeTransitioning === false;
            const restarted = playTransition.ok && playState?.mode === "play" &&
                playState?.isPlaying === true && playState?.isModeTransitioning === false &&
                afterPlay?.sceneObjects > 0;
            const result = {cycle, stopped, resourcesClean, shadowRestored, mainTriangleRestored, restarted, afterStop, afterPlay};
            cycleResults.push(result);
            console.log("DIRECT_CYCLE", JSON.stringify({
                cycle,
                stopped,
                resourcesClean,
                shadowRestored,
                mainTriangleRestored,
                restarted,
                heapAfterStop: afterStop.usedJSHeapSize,
                heapAfterPlay: afterPlay.usedJSHeapSize,
                sceneObjectsAfterStop: afterStop.sceneObjects,
                sceneObjectsAfterPlay: afterPlay.sceneObjects,
                shadowStateAfterStop: afterStop.shadowState,
                mainTriangleStateAfterStop: afterStop.mainTriangleState,
                hiddenRuntimeOwnersAfterStop: afterStop.hiddenRuntimeOwners,
            }));
            if (!stopped || !resourcesClean || !shadowRestored || !mainTriangleRestored || !restarted) {
                process.exitCode = 1;
                break;
            }
        }
        console.log("DIRECT_CYCLE_SUMMARY", JSON.stringify({
            requested: directPlayStopCycles,
            completed: cycleResults.length,
            allPassed: cycleResults.length === directPlayStopCycles &&
                cycleResults.every(result => result.stopped && result.resourcesClean && result.shadowRestored && result.mainTriangleRestored && result.restarted),
            gcAvailable: cycleResults[0]?.afterStop?.gcAvailable ?? false,
            heapAfterStop: cycleResults.map(result => result.afterStop?.usedJSHeapSize ?? null),
            heapAfterPlay: cycleResults.map(result => result.afterPlay?.usedJSHeapSize ?? null),
        }));
    }
    if (process.env.SKIP_REFRESH === "1") {
        const directVisualReady = process.env.LIGHT_CAPTURE === "1"
            ? directFromImportState?.canvas !== null
            : directFromImportState?.screenshotPixels?.rendered === true;
        if (
            directFromImportState?.mode !== "play" ||
            directFromImportState?.isPlaying !== true ||
            directFromImportState?.mask?.display !== "none" ||
            !directVisualReady ||
            (process.env.LIGHT_CAPTURE !== "1" && (
                Number(directFromImportState?.objects) <= 0 ||
                Number(directFromImportState?.meshes) <= 0 ||
                Number(directFromImportState?.emptyModelRefs) > 0
            ))
        ) {
            console.error("DIRECT_PLAY_STATE_INVALID", JSON.stringify(directFromImportState));
            process.exitCode = 1;
        }
        const observedFailed = failed.slice();
        const aborted = observedFailed.filter(entry => entry.includes("net::ERR_ABORTED"));
        const actionableFailed = observedFailed.filter(entry => !entry.includes("net::ERR_ABORTED"));
        console.log("ERRORS", JSON.stringify(errors.slice(0, 40)));
        console.log("FAILED", JSON.stringify(actionableFailed.slice(0, 20)));
        console.log("ABORTED", JSON.stringify(aborted.slice(0, 20)));
        await browser.close();
        process.exit(errors.length || actionableFailed.length || process.exitCode ? 1 : 0);
    }
    await page.reload({waitUntil: "domcontentloaded", timeout: 30000});
    await page.waitForLoadState("networkidle", {timeout: 20000}).catch(() => {});
    await page.waitForSelector("canvas", {timeout: 30000});
    await dismiss();
    await page.waitForTimeout(Number(process.env.REFRESH_WAIT_MS || 12000));
    const refreshedPlayState = await capture("03-refresh-play");
    console.log("REFRESH_PLAY", JSON.stringify(refreshedPlayState));
    if (process.env.RENDER_SUBSTAGE_DIAG === "1") {
        console.log("REFRESH_RENDER_SUBSTAGE", JSON.stringify(refreshedPlayState?.renderSubstageDiagnostics ?? null));
    }
    if (process.env.VISUAL_DIVERSITY_GATE === "1" && refreshedPlayState?.screenshotPixels?.visualDiversity !== true) {
        console.error("VISUAL_DIVERSITY_GATE_FAILED", JSON.stringify({label: "03-refresh-play", screenshotPixels: refreshedPlayState?.screenshotPixels ?? null}));
        process.exitCode = 1;
    }
    if (process.env.TRACE_LOOP === "1") console.log("LOOP_DIAG", JSON.stringify(await page.evaluate(() => globalThis.__STEM_LOOP_DIAG__ || null).catch(e => ({error: String(e)}))));
    if (process.env.CAPTURE_STARTUP_FRAMES === "1") console.log("STARTUP_FRAME_HISTORY", JSON.stringify(await page.evaluate(() => globalThis.__STEM_RENDER_FRAME_HISTORY__ || []).catch(e => ({error: String(e)}))));
    const observedFailed = failed.slice();
    const aborted = observedFailed.filter(entry => entry.includes("net::ERR_ABORTED"));
    const actionableFailed = observedFailed.filter(entry => !entry.includes("net::ERR_ABORTED"));
    console.log("ERRORS", JSON.stringify(errors.slice(0, 40)));
    console.log("FAILED", JSON.stringify(actionableFailed.slice(0, 20)));
    console.log("ABORTED", JSON.stringify(aborted.slice(0, 20)));
    await browser.close();
    process.exit(errors.length || actionableFailed.length ? 1 : 0);
}

if (process.env.QUICK_BUILD_FOCUS_DIAG === "1") {
    await page.goto(`${baseUrl}/create/project/${id}/edit?mode=playground&scene=${sceneSlug}&builder=1`, {waitUntil: "domcontentloaded", timeout: 30000});
    await page.waitForLoadState("networkidle", {timeout: 20000}).catch(() => {});
    const group = page.locator('[data-testid="quick-build-group-nature"]').first();
    await group.waitFor({state: "visible", timeout: 30000});
    await group.focus();
    const before = await page.evaluate(() => ({active: document.activeElement?.getAttribute("data-testid"), groups: document.querySelectorAll('[data-testid^="quick-build-group-"]').length}));
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(250);
    const down = await page.evaluate(() => {
        const menu = document.querySelector('[data-testid="quick-build-menu-nature"]');
        const items = Array.from(menu?.querySelectorAll('[role="menuitemradio"]') ?? []);
        const first = items[0];
        return {
            active: document.activeElement?.getAttribute("data-testid"),
            role: document.activeElement?.getAttribute("role"),
            expanded: document.querySelector('[data-testid="quick-build-group-nature"]')?.getAttribute("aria-expanded"),
            itemCount: items.length,
            firstTestId: first?.getAttribute("data-testid"),
            firstTabIndex: first?.getAttribute("tabindex"),
            menuVisibility: menu ? getComputedStyle(menu).visibility : null,
            menuPointerEvents: menu ? getComputedStyle(menu).pointerEvents : null,
            menuClass: menu?.className,
            menuHtml: menu?.outerHTML?.slice(0, 400),
            matchedMenuRules: menu
              ? Array.from(document.styleSheets).flatMap((sheet) => {
                  try {
                    return Array.from(sheet.cssRules ?? [])
                      .filter((rule) => {
                        if (!rule.selectorText) return false;
                        try {
                          return menu.matches(rule.selectorText);
                        } catch {
                          return false;
                        }
                      })
                      .map((rule) => ({
                        selector: rule.selectorText,
                        cssText: rule.cssText.slice(0, 600),
                      }));
                  } catch {
                    return [];
                  }
                })
              : [],
          };
      });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    const closed = await page.evaluate(() => ({active: document.activeElement?.getAttribute("data-testid"), expanded: document.querySelector('[data-testid="quick-build-group-nature"]')?.getAttribute("aria-expanded")}));
    console.log("QUICK_BUILD_FOCUS_DIAG", JSON.stringify({before, down, closed, errors: logs.filter(entry => /TypeError|ReferenceError|Unhandled|Uncaught/i.test(entry)).slice(0, 10)}));
      const focusPassed = down.role === "menuitemradio" && closed.active === "quick-build-group-nature";
      await browser.close();
      process.exit(focusPassed ? 0 : 1);
}
if (process.env.EDITOR_FROM_IMPORT === "1") {
    await page.goto(`${baseUrl}/create/project/${id}/edit?mode=playground&scene=${sceneSlug}`, {waitUntil: "domcontentloaded", timeout: 30000});
} else {
    const card = page.locator(`[data-scene-id="${id}"]`).first();
    await card.waitFor({state: "attached", timeout: 30000});
    await card.click({timeout: 5000});
}
await page.waitForLoadState("networkidle", {timeout: 30000}).catch(() => {});
await page.waitForSelector("canvas", {timeout: 30000});
await page.waitForTimeout(Number(process.env.EDITOR_WAIT_MS || 12000)); await dismiss();
if (process.env.PRINT_SHADOW_STATE === "1") {
    const shadowState = await page.evaluate(() => {
        const scene = globalThis.app?.editor?.scene || globalThis.app?.scene;
        const lights = [];
        scene?.traverse?.(object => {
            if (!object?.isDirectionalLight) return;
            const node = object.shadow?.shadowNode;
            lights.push({
                name: object.name,
                castShadow: object.castShadow,
                cascades: Number.isFinite(node?.cascades) ? node.cascades : null,
                shadowNodeType: node?.constructor?.name ?? null,
                mapSize: [object.shadow?.mapSize?.width ?? null, object.shadow?.mapSize?.height ?? null],
            });
        });
        return {mode: globalThis.app?.mode ?? null, lights};
    }).catch(error => ({error: String(error)}));
    console.log("SHADOW_STATE_EDITOR", JSON.stringify(shadowState));
}
    if (process.env.PRINT_TOP_OBJECTS === "1") {
        const topObjectsEditor = await page.evaluate(() => {
            const scene = globalThis.app?.editor?.scene || globalThis.app?.scene;
            const rows = [];
            scene?.traverse?.(object => {
                if (!object?.isMesh && !object?.isInstancedMesh) return;
                const geometry = object.geometry;
                const base = geometry?.index?.count || geometry?.attributes?.position?.count || 0;
                const count = object.isInstancedMesh ? object.count || 0 : 1;
                const path = [];
                let current = object;
                while (current && current !== scene) {
                    if (current.name) path.unshift(current.name);
                    current = current.parent;
                }
                rows.push({name: object.name, parent: object.parent?.name, instanced: object.isInstancedMesh === true, count, tris: Math.round(base * count / 3), path});
            });
            const aggregate = new Map();
            for (const row of rows) {
                const key = row.path.join("/") || "(scene)";
                const entry = aggregate.get(key) ?? {path: row.path, meshes: 0, instances: 0, tris: 0};
                entry.meshes += 1; entry.instances += row.count; entry.tris += row.tris; aggregate.set(key, entry);
            }
            return {top: rows.sort((a, b) => b.tris - a.tris).slice(0, 80), aggregate: [...aggregate.values()].sort((a, b) => b.tris - a.tris).slice(0, 80), totalTriangles: rows.reduce((sum, row) => sum + row.tris, 0)};
        }).catch(error => ({error: String(error)}));
        console.log("TOP_OBJECTS_EDITOR", JSON.stringify(topObjectsEditor));
    }
    console.log("EDITOR", JSON.stringify(await capture("01-editor")));
if (process.env.EDITOR_CHURN_CYCLES === "1") {
    const cycles = Math.max(1, Number(process.env.EDITOR_CHURN_COUNT || 4));
    const editorUrl = page.url();
    const readEditorChurnState = async (label) => page.evaluate(({label}) => {
        const app = globalThis.app;
        const editor = app?.editor;
        const scene = editor?.scene || app?.scene;
        let objects = 0;
        let meshes = 0;
        scene?.traverse?.(object => {
            objects += 1;
            if (object.isMesh) meshes += 1;
        });
        const loader = app?.assetLoader;
        const instanceManager = app?.assetInstanceManager;
        const memory = performance.memory;
        return {
            label,
            url: location.href,
            mode: app?.mode ?? null,
            isPlaying: app?.isPlaying ?? null,
            heapUsed: Number.isFinite(memory?.usedJSHeapSize) ? memory.usedJSHeapSize : null,
            heapTotal: Number.isFinite(memory?.totalJSHeapSize) ? memory.totalJSHeapSize : null,
            objects,
            meshes,
            rendererMemory: app?.renderer?.info?.memory ? {
                geometries: app.renderer.info.memory.geometries ?? null,
                textures: app.renderer.info.memory.textures ?? null,
            } : null,
            assetCache: loader?.assetCache?.size ?? null,
            textureCache: loader?.textureCache?.size ?? null,
            revisionCache: loader?.revisionCache?.size ?? null,
            templateCache: instanceManager?.templateCache?.size ?? null,
            pendingLoads: instanceManager?.pendingLoads?.size ?? null,
            behaviorPlugins: editor?.behaviorPluginManager?.behaviorPlugins?.size ?? null,
        };
    }, {label}).catch(error => ({label, error: String(error)}));
    const churn = [];
    churn.push(await readEditorChurnState("baseline"));
    for (let cycle = 1; cycle <= cycles; cycle += 1) {
        await page.reload({waitUntil: "domcontentloaded", timeout: 30000}).catch(() => {});
        await page.waitForLoadState("networkidle", {timeout: 30000}).catch(() => {});
        await page.waitForSelector("canvas", {timeout: 30000}).catch(() => {});
        await page.waitForTimeout(Number(process.env.EDITOR_CHURN_WAIT_MS || 6000));
        await page.evaluate(() => globalThis.gc?.()).catch(() => {});
        await page.waitForTimeout(250);
        churn.push(await readEditorChurnState(`cycle-${cycle}`));
    }
    const numeric = churn.filter(entry => Number.isFinite(entry.heapUsed));
    const firstHeap = numeric[0]?.heapUsed ?? null;
    const lastHeap = numeric.at(-1)?.heapUsed ?? null;
    const heapDelta = firstHeap !== null && lastHeap !== null ? lastHeap - firstHeap : null;
    const stableScene = churn.slice(1).every(entry => entry.mode === "edit" && entry.objects > 0 && entry.meshes > 0);
    const boundedGrowth = heapDelta === null || heapDelta <= Math.max(8_000_000, (firstHeap ?? 0) * 0.1);
    console.log("EDITOR_CHURN", JSON.stringify({requested: cycles, completed: churn.length - 1, stableScene, boundedGrowth, heapDelta, states: churn}));
    await browser.close();
    process.exit(stableScene && boundedGrowth && errors.length === 0 ? 0 : 1);
}
if (process.env.CAPTURE_STARTUP_FRAMES === "1") {
    await page.evaluate(() => {
        globalThis.__STEM_CAPTURE_RENDER_FRAME_HISTORY__ = true;
        globalThis.__STEM_RENDER_FRAME_HISTORY__ = [];
    });
}
const play = page.locator('[data-testid="topnav-play"]').first();
console.log("PLAY_VISIBLE", await play.isVisible().catch(() => false));
if (process.env.DIRECT_PLAY === "1") {
    await page.goto(page.url().replace(/\/edit(?=\?)/, "/play"), {waitUntil: "domcontentloaded", timeout: 30000});
    await installModeTrace();
    await page.waitForLoadState("networkidle", {timeout: 20000}).catch(() => {});
    await page.waitForSelector("canvas", {timeout: 30000});
    if (process.env.TRACE_LOOP === "1") {
        await page.evaluate(() => {
            const g = globalThis;
            const trace = g.__STEM_LOOP_DIAG__ = g.__STEM_LOOP_DIAG__ || {events: [], callbacks: 0, firstCallbackAt: null, lastCallbackAt: null, longTasks: []};
            try {
                new PerformanceObserver(list => {
                    for (const entry of list.getEntries()) trace.longTasks.push({start: Math.round(entry.startTime), duration: Math.round(entry.duration), name: entry.name, attribution: entry.attribution?.map(item => ({name: item.name, containerType: item.containerType, containerName: item.containerName}))});
                }).observe({type: "longtask", buffered: true});
            } catch {}
            const record = (name, extra = {}) => trace.events.push({name, t: Math.round(performance.now()), ...extra});
            const app = g.app;
            if (app && !app.__diagLoopWrapped) {
                const wrap = (owner, name, callbackTransform) => {
                    const original = owner?.[name];
                    if (typeof original !== "function" || original.__diagLoopWrapped) return;
                    const wrapped = function(...args) {
                        record(name, {args: name === "setLegacyAnimationLoopCallback" ? {hasCallback: typeof args[0] === "function"} : undefined});
                        if (callbackTransform) args = callbackTransform(args);
                        return original.apply(this, args);
                    };
                    wrapped.__diagLoopWrapped = true;
                    owner[name] = wrapped;
                };
                wrap(app, "startScheduledAnimationLoop");
                wrap(app, "startAnimationLoop");
                wrap(app, "setLegacyAnimationLoopCallback");
                const renderer = app.renderer;
                if (renderer) {
                    const originalSetAnimationLoop = renderer.setAnimationLoop;
                    if (typeof originalSetAnimationLoop === "function" && !originalSetAnimationLoop.__diagLoopWrapped) {
                        const wrappedSetAnimationLoop = function(callback) {
                            record("renderer.setAnimationLoop", {hasCallback: typeof callback === "function"});
                            const tracedCallback = typeof callback === "function" ? (...cbArgs) => {
                                const now = performance.now();
                                trace.callbacks += 1;
                                trace.firstCallbackAt ??= Math.round(now);
                                trace.lastCallbackAt = Math.round(now);
                                const renderEvent = app.event?.events?.find(e => e?.constructor?.name === "RenderEvent");
                                record("renderer.animationCallback", {callback: trace.callbacks, running: renderEvent?.running, pauseDepth: renderEvent?.pauseDepth, appMode: app.mode, isPlaying: app.isPlaying});
                                const callbackStart = performance.now();
                                try {
                                    return callback.apply(this, cbArgs);
                                } finally {
                                    record("renderer.animationCallbackEnd", {callback: trace.callbacks, duration: Math.round(performance.now() - callbackStart)});
                                }
                            } : callback;
                            return originalSetAnimationLoop.call(this, tracedCallback);
                        };
                        wrappedSetAnimationLoop.__diagLoopWrapped = true;
                        renderer.setAnimationLoop = wrappedSetAnimationLoop;
                    }
                }
                const renderEvent = app.event?.events?.find(e => e?.constructor?.name === "RenderEvent");
                if (renderEvent) {
                    const originalRun = renderEvent.runAnimationLoop;
                    if (typeof originalRun === "function" && !originalRun.__diagLoopWrapped) {
                        const wrappedRun = function(...args) {
                            record("RenderEvent.runAnimationLoop", {running: this.running, pauseDepth: this.pauseDepth});
                            return originalRun.apply(this, args);
                        };
                        wrappedRun.__diagLoopWrapped = true;
                        renderEvent.runAnimationLoop = wrappedRun;
                    }
                }
                app.__diagLoopWrapped = true;
                record("traceInstalled", {mode: app.mode, isPlaying: app.isPlaying, rendererInitialized: app.renderer?.hasInitialized?.()});
            }
        }).catch(() => {});
    }
    if (process.env.CAPTURE_STARTUP_FRAMES === "1") {
        await page.evaluate(() => {
            globalThis.__STEM_CAPTURE_RENDER_FRAME_HISTORY__ = true;
            globalThis.__STEM_RENDER_FRAME_HISTORY__ = [];
        });
    }
    await page.waitForTimeout(Number(process.env.PLAY_WAIT_MS || 12000));
    if (process.env.PRINT_SHADOW_STATE === "1") {
        const shadowState = await page.evaluate(() => {
            const scene = globalThis.app?.scene;
            const lights = [];
            scene?.traverse?.(object => {
                if (!object?.isDirectionalLight) return;
                const node = object.shadow?.shadowNode;
                lights.push({
                    name: object.name,
                    castShadow: object.castShadow,
                    cascades: Number.isFinite(node?.cascades) ? node.cascades : null,
                    shadowNodeType: node?.constructor?.name ?? null,
                    mapSize: [object.shadow?.mapSize?.width ?? null, object.shadow?.mapSize?.height ?? null],
                });
            });
            return {mode: globalThis.app?.mode ?? null, lights};
        }).catch(error => ({error: String(error)}));
        console.log("SHADOW_STATE_PLAY", JSON.stringify(shadowState));
    }
    if (process.env.FREEZE_BEFORE_CAPTURE === "1") {
        await page.evaluate(async () => {
            const app = globalThis.app;
            app?.stopAnimationLoop?.();
            await new Promise(resolve => setTimeout(resolve, 100));
            app?.effectRenderer?.render?.();
        }).catch(() => {});
    }
    if (process.env.MATCHED_TRIANGLE_CAPTURE === "1") {
        console.log("MATCHED_TRIANGLE_CAPTURE", JSON.stringify(await runMatchedTriangleCapture()));
    }
    if (process.env.PRINT_TOP_OBJECTS === "1") {
        const topObjectsDirect = await page.evaluate(() => {
            const scene = globalThis.app?.scene;
            const rows = [];
            scene?.traverse?.(object => {
                if (!object?.isMesh && !object?.isInstancedMesh) return;
                const geometry = object.geometry;
                const base = geometry?.index?.count || geometry?.attributes?.position?.count || 0;
                const count = object.isInstancedMesh ? object.count || 0 : 1;
                let current = object;
                let runtimeOnly = false;
                const path = [];
                while (current && current !== scene) {
                    if (current.userData?.isRuntimeOnly === true) runtimeOnly = true;
                    if (current.name) path.unshift(current.name);
                    current = current.parent;
                }
                rows.push({
                    name: object.name,
                    parent: object.parent?.name,
                    runtime: runtimeOnly,
                    instanced: object.isInstancedMesh === true,
                    count,
                    tris: Math.round(base * count / 3),
                    path,
                });
            });
            const aggregate = new Map();
            for (const row of rows) {
                const key = row.path.join("/") || "(scene)";
                const entry = aggregate.get(key) ?? {path: row.path, meshes: 0, instances: 0, tris: 0, runtime: row.runtime};
                entry.meshes += 1;
                entry.instances += row.count;
                entry.tris += row.tris;
                aggregate.set(key, entry);
            }
            return {
                top: rows.sort((a, b) => b.tris - a.tris).slice(0, 80),
                aggregate: [...aggregate.values()].sort((a, b) => b.tris - a.tris).slice(0, 80),
                totalTriangles: rows.reduce((sum, row) => sum + row.tris, 0),
            };
        }).catch(error => ({error: String(error)}));
        console.log("TOP_OBJECTS_DIRECT", JSON.stringify(topObjectsDirect));
    }
    const directPlayState = await capture("02-play");
    console.log("PLAY", JSON.stringify(directPlayState));
    if (process.env.VISUAL_DIVERSITY_GATE === "1" && directPlayState?.screenshotPixels?.visualDiversity !== true) {
        console.error("VISUAL_DIVERSITY_GATE_FAILED", JSON.stringify({label: "02-play", screenshotPixels: directPlayState?.screenshotPixels ?? null}));
        process.exitCode = 1;
    }
    console.log("BATCH_DIAG", JSON.stringify(await page.evaluate(() => {
        const effectRenderer = globalThis.app?.effectRenderer;
        const manager = effectRenderer?.batchManager;
        return {
            batchEnabled: effectRenderer?.batchEnabled ?? null,
            batchManager: !!manager,
            stats: manager?.getBatchStats?.() ?? null,
            rendererInfo: globalThis.app?.renderer?.info ?? null,
        };
    }).catch(e => ({error: String(e)}))));
    console.log("RENDER_DIAG", JSON.stringify(await page.evaluate(() => ({
        latest: globalThis.__STEM_RENDER_FRAME_DIAGNOSTICS__ || null,
        history: Array.isArray(globalThis.__STEM_RENDER_FRAME_HISTORY__)
            ? globalThis.__STEM_RENDER_FRAME_HISTORY__.slice(-20)
            : [],
    })).catch(e => ({error: String(e)}))));
    if (process.env.TRACE_MODES === "1") {
        console.log("MODE_TRACE", JSON.stringify(await page.evaluate(() => globalThis.app?.__diagModeCalls || []).catch(e => ({error: String(e)}))));
        console.log("ROUTE_TRACE", JSON.stringify(await page.evaluate(() => globalThis.app?.__diagRouteCalls || []).catch(e => ({error: String(e)}))));
    }
    if (process.env.CAPTURE_STARTUP_FRAMES === "1") {
        console.log("STARTUP_FRAME_HISTORY", JSON.stringify(await page.evaluate(() => globalThis.__STEM_RENDER_FRAME_HISTORY__ || []).catch(e => ({error: String(e)}))));
    }
    if (process.env.TRACE_LOOP === "1") {
        console.log("LOOP_DIAG", JSON.stringify(await page.evaluate(() => globalThis.__STEM_LOOP_DIAG__ || null).catch(e => ({error: String(e)}))));
    }
    const directPlayTimings = await page.evaluate(() => globalThis.__stemPlayStartTimings || []).catch(e => ({error: String(e)}));
    console.log("PLAY_TIMINGS_SUMMARY", JSON.stringify(Object.fromEntries((Array.isArray(directPlayTimings) ? directPlayTimings : []).filter(entry => ["gameCreate", "autoStart:gameStart", "runtimeMaterialBudgetPrewarm", "runtimeInstancingBudgetPrewarm", "rendererWarmup", "rendererWarmupPath", "firstRenderHandshakePath", "firstRenderHandshake", "startPlayerTotal"].includes(entry.phase)).map(entry => [entry.phase, entry.phase.endsWith("Path") ? entry.message ?? entry.ms : entry.ms ?? entry.message]))));
    if (perfGate) {
        const phase = name => (Array.isArray(directPlayTimings) ? directPlayTimings : []).find(entry => entry.phase === name)?.ms ?? null;
        const maxStartMs = parseInt(process.env.PERF_GATE_MAX_START_MS ?? "3500", 10);
        const maxWarmupMs = parseInt(process.env.PERF_GATE_MAX_WARMUP_MS ?? "2000", 10);
        const maxFrameP95Ms = parseInt(process.env.PERF_GATE_MAX_FRAME_P95_MS ?? "25", 10);
        const checks = {
            startPlayerTotal: {value: phase("startPlayerTotal"), max: maxStartMs},
            rendererWarmup: {value: phase("rendererWarmup"), max: maxWarmupMs},
            frameTimeP95Ms: {value: directPlayState?.runtimeFrameTelemetry?.frameTimeP95Ms ?? null, max: maxFrameP95Ms},
        };
        const failures = Object.entries(checks)
            .filter(([, check]) => typeof check.value !== "number" || check.value > check.max)
            .map(([name, check]) => `${name}=${check.value}ms>${check.max}ms`);
        console.log("PERF_GATE", JSON.stringify({pass: failures.length === 0, checks, failures}));
        if (failures.length > 0) process.exitCode = 1;
    }
    if (directPlayState.mode !== "play" || directPlayState.isPlaying !== true || directPlayState.mask?.display !== "none" || directPlayState.screenshotPixels?.rendered !== true) {
        console.error("DIRECT_PLAY_STATE_INVALID", JSON.stringify(directPlayState));
        process.exitCode = 1;
    }
    const playStopCycles = Math.max(0, Number(process.env.PLAY_STOP_CYCLES || 0));
    if (playStopCycles > 0) {
        const cycleResults = [];
        const readCycleState = (collectHeap = false) => page.evaluate(async ({collect, productionImport}) => {
            if (collect && typeof globalThis.gc === "function") {
                globalThis.gc();
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            return {
                url: location.href,
                mode: globalThis.app?.mode ?? null,
                isPlaying: globalThis.app?.isPlaying ?? null,
                isModeTransitioning: globalThis.app?.isModeTransitioning ?? false,
                sceneID: globalThis.app?.editor?.sceneID ?? null,
                sceneName: globalThis.app?.editor?.sceneName ?? null,
                isSandbox: globalThis.app?.editor?.isSandbox ?? null,
                playgroundQuery: new URLSearchParams(location.search).get("mode"),
                sessionPlayground: sessionStorage.getItem("stem.playgroundMode"),
                // Built previews do not expose Vite source modules. Keep the
                // production lifecycle probe self-contained so diagnostics do
                // not create false MIME errors by importing .ts paths.
                helperPlayground: productionImport
                    ? sessionStorage.getItem("stem.playgroundMode") === "1"
                    : await import("/packages/shared/src/playgroundMode.ts").then(mod => mod.isPlaygroundMode()).catch(() => null),
                playerSessionPresent: !!globalThis.app?.playerSession,
                gamePresent: !!globalThis.app?.game,
                physicsPresent: !!globalThis.app?.physics,
                hiddenRuntimeOwners: {
                    fixedStepListenerPhysics: !!globalThis.app?.fixedStepListenerPhysics,
                    pendingWorkerSimulationFrame: !!globalThis.app?.pendingWorkerSimulationFrame,
                    activeSimulationFrameContext: !!globalThis.app?.activeSimulationFrameContext,
                    gameTopicSubscriptions: productionImport
                        ? null
                        : await import("/packages/editor-oss/src/behaviors/event/EventBus.ts")
                            .then(({default: EventBus}) => {
                                const topicTokens = EventBus.instance?.topicTokens;
                                return topicTokens instanceof Map
                                    ? (topicTokens.get("game")?.size ?? 0)
                                    : null;
                            })
                            .catch(() => null),
                    scriptResourceDiagnostics: globalThis.__STEM_SCRIPT_RESOURCE_DIAGNOSTICS__?.() ?? null,
                },
                sceneChildren: globalThis.app?.scene?.children?.length ?? null,
                sceneObjects: (() => {
                    let count = 0;
                    globalThis.app?.scene?.traverse?.(() => { count += 1; });
                    return count;
                })(),
                maskDisplay: globalThis.app?.playerMask?.container
                    ? getComputedStyle(globalThis.app.playerMask.container).display
                    : null,
                gcAvailable: typeof globalThis.gc === "function",
                usedJSHeapSize: performance.memory?.usedJSHeapSize ?? null,
                totalJSHeapSize: performance.memory?.totalJSHeapSize ?? null,
            };
        }, {collect: collectHeap, productionImport}).catch(error => ({error: String(error)}));
        for (let cycle = 1; cycle <= playStopCycles; cycle += 1) {
            const edit = page.locator('[data-testid="topnav-edit"]').first();
            if (!(await edit.isVisible().catch(() => false))) {
                process.exitCode = 1;
                cycleResults.push({cycle, error: "edit-button-not-visible", state: await readCycleState()});
                break;
            }
            const editBox = await edit.boundingBox();
            if (!editBox) {
                process.exitCode = 1;
                cycleResults.push({cycle, error: "edit-button-no-layout-box"});
                break;
            }
            const editDescriptors = await page.locator('[data-testid="topnav-edit"]').evaluateAll(elements => elements.map(element => ({
                text: element.textContent?.trim(),
                display: getComputedStyle(element).display,
                visibility: getComputedStyle(element).visibility,
                rect: element.getBoundingClientRect().toJSON(),
                parent: element.parentElement?.className || null,
                ancestor: element.closest("nav")?.className || null,
            })));
            console.log("EDIT_TARGETS", JSON.stringify(editDescriptors));
            if (process.env.TRACE_MODES === "1") console.log("BEFORE_STOP", JSON.stringify(await readCycleState()));
            await page.mouse.click(editBox.x + editBox.width / 2, editBox.y + editBox.height / 2);
            const stopStartedAt = Date.now();
            let afterStop = await readCycleState();
            for (let attempt = 0; attempt < 40; attempt += 1) {
                if (afterStop.mode === "edit" && afterStop.isPlaying === false && afterStop.isModeTransitioning === false) break;
                await page.waitForTimeout(250);
                afterStop = await readCycleState();
            }
            if (afterStop.mode !== "edit" || afterStop.isPlaying !== false || afterStop.isModeTransitioning !== false || !/\/edit(?:\?|$)/.test(afterStop.url)) {
                process.exitCode = 1;
                cycleResults.push({cycle, error: "stop-state-invalid", afterStop});
                break;
            }
            if (process.env.FORCE_GC === "1") afterStop = await readCycleState(true);
            if (process.env.REFRESH_AFTER_STOP === "1") {
                await page.reload({waitUntil: "domcontentloaded", timeout: 30000});
                await page.waitForLoadState("networkidle", {timeout: 20000}).catch(() => {});
                await page.waitForSelector("canvas", {timeout: 30000});
                await dismiss();
                await page.waitForTimeout(Number(process.env.EDIT_REFRESH_WAIT_MS || 3500));
                const refreshedEditState = await readCycleState();
                const refreshedEditVisual = await capture(`cycle-${cycle}-edit-refresh`);
                afterStop.refreshedEdit = {
                    ...refreshedEditState,
                    screenshotPixels: refreshedEditVisual.screenshotPixels,
                    renderer: refreshedEditVisual.renderer,
                    backend: refreshedEditVisual.backend,
                };
                if (refreshedEditState.mode !== "edit" || refreshedEditState.isPlaying !== false || refreshedEditState.isModeTransitioning !== false ||
                    !/\/edit(?:\?|$)/.test(refreshedEditState.url) || refreshedEditVisual.screenshotPixels?.rendered !== true) {
                    process.exitCode = 1;
                    cycleResults.push({cycle, error: "edit-refresh-invalid", afterStop});
                    break;
                }
            }
            const playAgain = page.locator('[data-testid="topnav-play"]').first();
            const playBox = await playAgain.boundingBox();
            if (!playBox) {
                process.exitCode = 1;
                cycleResults.push({cycle, error: "play-button-no-layout-box", afterStop});
                break;
            }
            await page.mouse.click(playBox.x + playBox.width / 2, playBox.y + playBox.height / 2);
            for (let attempt = 0; attempt < 160; attempt += 1) {
                const state = await readCycleState();
                if (state.mode === "play" && state.isPlaying === true && state.isModeTransitioning === false && state.maskDisplay === "none" && /\/play(?:\?|$)/.test(state.url)) {
                    const visual = await capture(`cycle-${cycle}-play`);
                    const settledState = process.env.FORCE_GC === "1" ? await readCycleState(true) : state;
                    const afterPlay = {
                        ...settledState,
                        screenshotPixels: visual.screenshotPixels,
                        renderer: visual.renderer,
                        backend: visual.backend,
                    };
                    if (afterPlay.screenshotPixels?.rendered !== true) {
                        process.exitCode = 1;
                        cycleResults.push({cycle, error: "play-visual-invalid", stopMs: Date.now() - stopStartedAt, afterStop, afterPlay});
                    } else {
                        cycleResults.push({cycle, stopMs: Date.now() - stopStartedAt, afterStop, afterPlay});
                    }
                    break;
                }
                await page.waitForTimeout(250);
                if (attempt === 159) {
                    process.exitCode = 1;
                    cycleResults.push({cycle, error: "play-state-timeout", afterStop, state});
                }
            }
        }
        console.log("PLAY_STOP_CYCLES", JSON.stringify({requested: playStopCycles, completed: cycleResults.filter(entry => !entry.error).length, cycles: cycleResults}));
        if (process.env.TRACE_MODES === "1") {
            console.log("MODE_TRACE_AFTER_CYCLE", JSON.stringify(await page.evaluate(() => globalThis.app?.__diagModeCalls || []).catch(e => ({error: String(e)}))));
            console.log("ROUTE_TRACE_AFTER_CYCLE", JSON.stringify(await page.evaluate(() => globalThis.app?.__diagRouteCalls || []).catch(e => ({error: String(e)}))));
        }
    }
    const observedFailed = failed.slice();
    const aborted = observedFailed.filter(entry => entry.includes("net::ERR_ABORTED"));
    const actionableFailed = observedFailed.filter(entry => !entry.includes("net::ERR_ABORTED"));
    console.log("ERRORS", JSON.stringify(errors.slice(0, 40)));
    console.log("FAILED", JSON.stringify(actionableFailed.slice(0, 20)));
    console.log("ABORTED", JSON.stringify(aborted.slice(0, 20)));
    await browser.close();
    process.exit(errors.length || actionableFailed.length || process.exitCode ? 1 : 0);
}
await page.evaluate(() => {
    const app = globalThis.app;
    if (!app || app.__diagSetModeWrapped) return;
    const original = app.setMode.bind(app);
    app.__diagSetModeCalls = [];
    app.setMode = (...args) => {
        app.__diagSetModeCalls.push({mode: args[0], options: args[1], stack: new Error().stack});
        return original(...args);
    };
    app.__diagSetModeWrapped = true;
});
if (process.env.TRACE_STOP === "1") {
    await page.evaluate(() => {
        const app = globalThis.app;
        const editor = app?.editor;
        if (!app || !editor || editor.__diagStopWrapped) return;
        app.__diagStopTrace = [];
        const record = (name, phase, extra = {}) => {
            const item = {name, phase, t: Math.round(performance.now()), ...extra};
            app.__diagStopTrace.push(item);
            console.log(`[STOPTRACE] ${name}:${phase} ${JSON.stringify(extra)}`);
        };
        const wrap = (owner, name) => {
            const original = owner?.[name];
            if (typeof original !== "function" || original.__diagWrapped) return;
            const wrapped = function(...args) {
                record(name, "start");
                const started = performance.now();
                let result;
                try { result = original.apply(this, args); } catch (error) {
                    record(name, "throw", {ms: Math.round(performance.now() - started), error: String(error)});
                    throw error;
                }
                if (!result || typeof result.then !== "function") {
                    record(name, "done", {ms: Math.round(performance.now() - started)});
                    return result;
                }
                return result.then(value => {
                    record(name, "done", {ms: Math.round(performance.now() - started)});
                    return value;
                }, error => {
                    record(name, "reject", {ms: Math.round(performance.now() - started), error: String(error)});
                    throw error;
                });
            };
            wrapped.__diagWrapped = true;
            owner[name] = wrapped;
        };
        for (const name of ["stop", "syncSceneBehaviorConfigs", "clearAndAddObjectsBehaviorPlugins", "setBehaviorPluginUpdateLoopActive"]) wrap(editor, name);
        for (const name of ["clear", "setEditorUpdateLoopActive", "setRuntimeUpdateLoopActive"]) wrap(editor.behaviorPluginManager, name);
        for (const name of ["cancelPending", "discardPending", "flush", "flushFully"]) wrap(editor.localAutoSave, name);
        const originalCall = app.call?.bind(app);
        if (originalCall) app.call = (event, ...args) => { record(`call:${event}`, "invoke"); return originalCall(event, ...args); };
        editor.__diagStopWrapped = true;
    });
}
// Keep the real React action path. A low-level mouse mode is useful for
// diagnosing whether a heavy editor frame is starving Playwright's
// actionability wait without changing the browser event itself.
if (process.env.CLICK_METHOD === "mouse") {
    const box = await play.boundingBox();
    if (!box) throw new Error("Play button has no layout box");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
} else {
    await play.click({timeout: 30000, force: true});
}
console.log("AFTER_PLAY_CLICK", JSON.stringify(await page.evaluate(() => ({url: location.href, buttons: [...document.querySelectorAll('button')].map(b => ({text: b.textContent?.trim(), visible: !!(b.offsetWidth || b.offsetHeight || b.getClientRects().length)})).filter(b => b.visible).slice(-20), body: document.body.innerText.slice(-1200)})).catch(e => ({error: String(e)}))));
// The mode transition may yield while the heavy scene is being torn down;
// keep polling for the save-policy prompt instead of racing it immediately.
    for (let i = 0; i < Number(process.env.SAVE_POLL_ITERATIONS || 240); i++) {
    const transitionState = await page.evaluate(() => ({
        mode: globalThis.app?.mode ?? null,
        isPlaying: globalThis.app?.isPlaying ?? false,
        isModeTransitioning: globalThis.app?.isModeTransitioning ?? false,
        url: location.href,
    })).catch(() => null);
    // A clean scene has no save-policy dialog. In that case the real mode
    // transition can complete while this poll is waiting; do not burn the
    // entire 60-second prompt budget and make the cycle runner look hung.
    if (
        transitionState?.mode === "play" &&
        transitionState.isPlaying === true &&
        transitionState.isModeTransitioning === false &&
        /\/play(?:\?|$)/.test(transitionState.url)
    ) {
        break;
    }
    const candidates = [
        page.getByRole("button", {name: /don't\s*save/i}).first(),
        page.locator("button").filter({hasText: /don't\s*save/i}).first(),
    ];
        let clickedSavePolicy = false;
        for (const dontSave of candidates) {
            if (await dontSave.count() && await dontSave.isVisible().catch(() => false)) {
                if (i === 0 || process.env.TRACE_SAVE_POLICY === "1") {
                    console.log("SAVE_POLICY_VISIBLE", JSON.stringify({attempt: i, count: await dontSave.count(), text: await dontSave.textContent().catch(() => "")}));
                }
                await dontSave.click({force: true, timeout: 5000}).catch(() => {});
                await page.waitForTimeout(300);
            if (await dontSave.isVisible().catch(() => false)) {
                await page.evaluate(() => {
                    const button = [...document.querySelectorAll("button")].find(candidate => /don't\s*save/i.test(candidate.textContent || ""));
                    button?.click();
                }).catch(() => {});
                await page.waitForTimeout(300);
            }
            // The editor teardown is asynchronous; the confirmation button
            // can remain mounted while the scene is being discarded. Treat a
            // successful click as handled and let the route/state assertions
            // below verify that teardown completed.
            clickedSavePolicy = true;
            break;
            }
        }
    if (clickedSavePolicy) break;
    await page.waitForTimeout(250);
}
console.log("AFTER_SAVE_PROMPT_POLL", JSON.stringify(await page.evaluate(() => ({url: location.href, mode: globalThis.app?.mode, isPlaying: globalThis.app?.isPlaying, buttons: [...document.querySelectorAll('button')].map(b => b.textContent?.trim()).filter(Boolean).slice(-20), body: document.body.innerText.slice(-1200)})).catch(e => ({error: String(e)}))));
if (process.env.TRACE_STOP === "1") console.log("MID_STOP_TRACE", JSON.stringify(await page.evaluate(() => globalThis.app?.__diagStopTrace || []).catch(e => ({error: String(e)}))));
    await page.waitForTimeout(Number(process.env.PLAY_WAIT_MS || 12000));
if (process.env.TRACK_STRESS === "1") {
    const stressDurationMs = Math.max(1000, Number(process.env.STRESS_WAIT_MS || 5000));
    const stressX = Number(process.env.STRESS_X || Math.max(1, viewport.width - 96));
    const stressY = Number(process.env.STRESS_Y || 78);
    await page.evaluate(() => {
        const g = globalThis;
        const trace = g.__STEM_TRACK_STRESS__ = {startedAt: performance.now(), frames: [], longTasks: [], done: false};
        try {
            new PerformanceObserver(list => {
                for (const entry of list.getEntries()) {
                    trace.longTasks.push({start: entry.startTime, duration: entry.duration});
                }
            }).observe({type: "longtask", buffered: true});
        } catch {}
        let previous = performance.now();
        const sample = now => {
            trace.frames.push(now - previous);
            previous = now;
            if (now - trace.startedAt < trace.durationMs) {
                requestAnimationFrame(sample);
            } else {
                trace.done = true;
            }
        };
        trace.durationMs = 5000;
        requestAnimationFrame(sample);
    }).catch(() => {});
    await page.mouse.click(stressX, stressY);
    await page.waitForTimeout(stressDurationMs);
    const stress = await page.evaluate(() => {
        const trace = globalThis.__STEM_TRACK_STRESS__ || {};
        const frames = Array.isArray(trace.frames) ? trace.frames.filter(value => Number.isFinite(value) && value > 0) : [];
        const longTasks = Array.isArray(trace.longTasks) ? trace.longTasks : [];
        const percentile = (values, quantile) => {
            if (!values.length) return null;
            const sorted = [...values].sort((a, b) => a - b);
            return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))];
        };
        const scene = globalThis.app?.scene;
        let objects = 0;
        let meshes = 0;
        scene?.traverse?.(object => {
            objects += 1;
            if (object.isMesh) meshes += 1;
        });
        return {
            durationMs: trace.durationMs ?? null,
            frames: frames.length,
            frameP50Ms: percentile(frames, 0.5),
            frameP95Ms: percentile(frames, 0.95),
            frameMaxMs: frames.length ? Math.max(...frames) : null,
            over33Ms: frames.filter(value => value > 33.3).length,
            longTasks: longTasks.length,
            longTaskP95Ms: percentile(longTasks.map(entry => entry.duration).filter(Number.isFinite), 0.95),
            longTaskMaxMs: longTasks.length ? Math.max(...longTasks.map(entry => entry.duration)) : null,
            objects,
            meshes,
            instancing: globalThis.app?.effectRenderer?.runtimeMeshInstancer?.getStats?.(meshes) ?? null,
            done: trace.done === true,
        };
    }).catch(error => ({error: String(error)}));
    console.log("TRACK_STRESS", JSON.stringify({click: {x: stressX, y: stressY}, ...stress}));
}
    if (process.env.MATCHED_TRIANGLE_CAPTURE === "1") {
        console.log("MATCHED_TRIANGLE_CAPTURE", JSON.stringify(await runMatchedTriangleCapture()));
    }
    const playState = await capture("02-play");
console.log("PLAY", JSON.stringify(playState));
if (process.env.HUD_SAFE_AREA_PROBE === "1") {
    const hudSafeArea = await page.evaluate(() => {
        const rect = element => {
            const box = element?.getBoundingClientRect?.();
            return box ? {left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height} : null;
        };
        const ships = document.getElementById("ships-remaining");
        const edit = document.querySelector('[data-testid="topnav-edit"]');
        const nav = edit?.closest("nav") ?? document.querySelector("nav");
        const shipsRect = rect(ships);
        const navRect = rect(nav);
        const intersects = !!shipsRect && !!navRect &&
            shipsRect.left < navRect.right && shipsRect.right > navRect.left &&
            shipsRect.top < navRect.bottom && shipsRect.bottom > navRect.top;
        return {ships: shipsRect, hostNav: navRect, intersects, zIndex: ships ? getComputedStyle(ships).zIndex : null};
    }).catch(error => ({error: String(error)}));
    console.log("HUD_SAFE_AREA", JSON.stringify(hudSafeArea));
    if (hudSafeArea.intersects === true) {
        console.error("HUD_SAFE_AREA_INVALID", JSON.stringify(hudSafeArea));
        process.exitCode = 1;
    }
}
if (process.env.MATERIAL_DIAG === "1") {
    console.log("MATERIALDIAG", JSON.stringify(await page.evaluate(() => globalThis.__STEM_MATERIAL_DIAG__ ?? null).catch(error => ({error: String(error)}))));
}
if (process.env.INPUT_PROBE === "1") {
    const readInputState = () => page.evaluate(() => {
        const app = globalThis.app;
        const player = app?.game?.player;
        const controls = app?.game?.inputManager ?? app?.inputManager ?? app?.input ?? null;
        const scene = app?.game?.scene;
        return {
            player: player ? {
                name: player.name,
                position: player.position?.toArray?.() ?? null,
                quaternion: player.quaternion?.toArray?.() ?? null,
            } : null,
            matchStarted: scene?.userData?._matchStarted ?? null,
            input: controls ? {
                constructor: controls.constructor?.name ?? null,
                motions: Object.fromEntries(["forward", "turn", "lateral"].map(name => [name, controls.getMotion?.(name) ?? null])),
                actions: Object.fromEntries(["fire", "sprint", "jump"].map(name => [name, controls.getAction?.(name) ?? null])),
                keys: controls.keys ? Object.keys(controls.keys).slice(0, 20) : null,
            } : null,
        };
    }).catch(error => ({error: String(error)}));
    const beforeInput = await readInputState();
    await page.evaluate(() => {
        const root = globalThis;
        root.__stemInputProbeEvents = [];
        const record = (event) => {
            root.__stemInputProbeEvents.push({type: event.type, code: event.code, key: event.key, defaultPrevented: event.defaultPrevented});
        };
        document.addEventListener("keydown", record, true);
        document.addEventListener("keyup", record, true);
        root.__stemInputProbeCleanup = () => {
            document.removeEventListener("keydown", record, true);
            document.removeEventListener("keyup", record, true);
        };
    });
    await page.keyboard.down("w");
    await page.waitForTimeout(250);
    const duringForward = await readInputState();
    await page.waitForTimeout(450);
    await page.keyboard.up("w");
    await page.keyboard.down("a");
    await page.waitForTimeout(250);
    const duringTurn = await readInputState();
    await page.waitForTimeout(150);
    await page.keyboard.up("a");
    await page.keyboard.press("Space");
    await page.waitForTimeout(400);
    const afterInput = await readInputState();
    const inputEvents = await page.evaluate(() => {
        globalThis.__stemInputProbeCleanup?.();
        return globalThis.__stemInputProbeEvents ?? [];
    });
    console.log("INPUT_PROBE", JSON.stringify({before: beforeInput, duringForward, duringTurn, after: afterInput, events: inputEvents}));
    const beforePosition = beforeInput?.player?.position;
    const afterPosition = afterInput?.player?.position;
    const moved = Array.isArray(beforePosition) && Array.isArray(afterPosition)
        && beforePosition.some((value, index) => Math.abs(value - afterPosition[index]) > 0.001);
    if (!moved) {
        console.error("INPUT_PROBE_INVALID", JSON.stringify({before: beforeInput, after: afterInput}));
        process.exitCode = 1;
    }
}
const playTimings = await page.evaluate(() => globalThis.__stemPlayStartTimings || []).catch(e => ({error: String(e)}));
console.log("PLAY_TIMINGS", JSON.stringify(playTimings));
    console.log("PLAY_TIMINGS_SUMMARY", JSON.stringify(Object.fromEntries((Array.isArray(playTimings) ? playTimings : []).filter(entry => ["gameCreate", "autoStart:gameStart", "runtimeMaterialBudgetPrewarm", "runtimeInstancingBudgetPrewarm", "rendererWarmup", "rendererWarmupPath", "firstRenderHandshakePath", "firstRenderHandshake", "startPlayerTotal"].includes(entry.phase)).map(entry => [entry.phase, entry.phase.endsWith("Path") ? entry.message ?? entry.ms : entry.ms ?? entry.message]))));
const playVisualReady = process.env.LIGHT_CAPTURE === "1"
    ? playState.canvas !== null
    : playState.screenshotPixels?.rendered === true;
if (playState.mode !== "play" || playState.isPlaying !== true || (!process.env.LIGHT_CAPTURE && playState.mask?.display !== "none") || !playVisualReady) {
    console.error("PLAY_STATE_INVALID", JSON.stringify(playState));
    process.exitCode = 1;
}
if (process.env.PLAY_TO_EDIT === "1") {
    const edit = page.locator('[data-testid="topnav-edit"]').first();
    const editBox = await edit.boundingBox().catch(() => null);
    if (!editBox) {
        console.error("PLAY_TO_EDIT_INVALID", JSON.stringify({error: "edit-button-no-layout-box", url: page.url()}));
        process.exitCode = 1;
    } else {
        await page.mouse.click(editBox.x + editBox.width / 2, editBox.y + editBox.height / 2);
        let state = null;
        for (let attempt = 0; attempt < 200; attempt += 1) {
            state = await page.evaluate(() => ({
                url: location.href,
                mode: globalThis.app?.mode ?? null,
                isPlaying: globalThis.app?.isPlaying ?? null,
                isModeTransitioning: globalThis.app?.isModeTransitioning ?? null,
            })).catch(() => null);
            if (state?.mode === "edit" && state.isPlaying === false && state.isModeTransitioning === false && /\/edit(?:\?|$)/.test(state.url)) break;
            await page.waitForTimeout(250);
        }
        await page.waitForTimeout(Number(process.env.EDIT_AFTER_PLAY_WAIT_MS || 4000));
        const editState = await capture("03-play-to-edit");
        const transitionState = await page.evaluate(() => ({
            url: location.href,
            mode: globalThis.app?.mode ?? null,
            isPlaying: globalThis.app?.isPlaying ?? null,
            isModeTransitioning: globalThis.app?.isModeTransitioning ?? null,
            editorSceneObjects: (() => { let count = 0; globalThis.app?.editor?.scene?.traverse?.(() => { count += 1; }); return count; })(),
            editorSceneMeshes: (() => { let count = 0; globalThis.app?.editor?.scene?.traverse?.(o => { if (o.isMesh) count += 1; }); return count; })(),
            runtimeSceneObjects: (() => { let count = 0; globalThis.app?.scene?.traverse?.(() => { count += 1; }); return count; })(),
            runtimeSceneMeshes: (() => { let count = 0; globalThis.app?.scene?.traverse?.(o => { if (o.isMesh) count += 1; }); return count; })(),
            animationLoopAttached: globalThis.app?.appliedAnimationLoopRenderer === globalThis.app?.renderer && globalThis.app?.appliedAnimationLoopCallback !== null,
        })).catch(error => ({error: String(error)}));
        console.log("PLAY_TO_EDIT", JSON.stringify({settled: state, transitionState, visual: editState}));
        const editVisualReady = process.env.LIGHT_CAPTURE === "1"
            ? editState.canvas !== null
            : editState.screenshotPixels?.rendered === true;
        if (transitionState?.mode !== "edit" || transitionState.isPlaying !== false || transitionState.isModeTransitioning !== false || !editVisualReady) {
            console.error("PLAY_TO_EDIT_INVALID", JSON.stringify({transitionState, visual: editState}));
            process.exitCode = 1;
        }
    }
}
console.log("TRACE", JSON.stringify(logs.filter(line => /APP|Play|play|Save|save|mode/i.test(line)).slice(-120)));
console.log("MODE_CALLS", JSON.stringify(await page.evaluate(() => globalThis.app?.__diagSetModeCalls || [])));
if (process.env.TRACE_STOP === "1") console.log("STOP_TRACE", JSON.stringify(await page.evaluate(() => globalThis.app?.__diagStopTrace || [])));
console.log("ERRORS", JSON.stringify(errors.slice(0, 40)));
const abortedRequests = failed.filter(entry => entry.includes("ERR_ABORTED"));
const actionableRequests = failed.filter(entry => !entry.includes("ERR_ABORTED"));
console.log("FAILED", JSON.stringify(actionableRequests.slice(0, 20)));
console.log("ABORTED", JSON.stringify(abortedRequests.slice(0, 20)));
if (actionableRequests.length > 0) process.exitCode = 1;
if (process.env.VERIFY_REFRESH === "1") {
    const refreshPage = process.env.REFRESH_NEW_PAGE === "1" ? await ctx.newPage() : page;
    if (refreshPage === page) {
        await page.reload({waitUntil: "domcontentloaded", timeout: 30000});
        await page.waitForLoadState("networkidle", {timeout: 20000}).catch(() => {});
        await page.waitForSelector("canvas", {timeout: 30000});
    } else {
        await refreshPage.goto(page.url(), {waitUntil: "domcontentloaded", timeout: 30000});
        await refreshPage.waitForLoadState("networkidle", {timeout: 20000}).catch(() => {});
        await refreshPage.waitForSelector("canvas", {timeout: 30000});
    }
    await refreshPage.evaluate(() => {
        const app = globalThis.app;
        if (!app || app.__diagLoopTraceWrapped) return;
        app.__diagLoopTrace = [];
        const record = name => {
            app.__diagLoopTrace.push({name, t: Math.round(performance.now()), renderer: app.renderer?.constructor?.name, appliedRenderer: app.appliedAnimationLoopRenderer === app.renderer, appliedCallback: app.appliedAnimationLoopCallback !== null});
        };
        for (const name of ["startScheduledAnimationLoop", "stopScheduledAnimationLoop", "setLegacyAnimationLoopCallback"]) {
            const original = app[name];
            if (typeof original !== "function") continue;
            app[name] = function(...args) { record(name); return original.apply(this, args); };
        }
        const originalCall = app.call.bind(app);
        app.call = (event, ...args) => { if (/restartRenderer|pauseRender|resumeRender|sceneLoaded|playerStarted|appStarted|appStart/.test(String(event))) record(`call:${event}`); return originalCall(event, ...args); };
        app.__diagLoopTraceWrapped = true;
    });
    await refreshPage.waitForTimeout(Number(process.env.REFRESH_WAIT_MS || 12000));
    await dismiss();
    const refreshPlayState = await capture("03-refresh-play", refreshPage);
    console.log("REFRESH_PLAY", JSON.stringify(refreshPlayState));
    if (process.env.VISUAL_DIVERSITY_GATE === "1" && refreshPlayState?.screenshotPixels?.visualDiversity !== true) {
        console.error("VISUAL_DIVERSITY_GATE_FAILED", JSON.stringify({label: "03-refresh-play", screenshotPixels: refreshPlayState?.screenshotPixels ?? null}));
        process.exitCode = 1;
    }
    if (refreshPlayState.mode !== "play" || refreshPlayState.isPlaying !== true || refreshPlayState.mask?.display !== "none" || refreshPlayState.screenshotPixels?.rendered !== true) {
        console.error("REFRESH_PLAY_STATE_INVALID", JSON.stringify(refreshPlayState));
        process.exitCode = 1;
    }
    console.log("LOOP_TRACE", JSON.stringify(await refreshPage.evaluate(() => globalThis.app?.__diagLoopTrace || [])));
    console.log("REFRESH_TRACE", JSON.stringify(logs.filter(line => /startPlayer|Player Started|Animation Loop|playerStarted|loadingComplete|firstRenderHandshake|Failed|ERROR|Error|Behavior|GameManager|Camera/i.test(line)).slice(-180)));
    if (process.env.TRACE_REFRESH === "1") {
        for (let i = 0; i < 6; i++) {
            await page.waitForTimeout(2000);
            console.log(`REFRESH_SAMPLE_${i + 1}`, JSON.stringify(await capture(`04-refresh-${i + 1}`)));
        }
    }
}
await page.evaluate(() => { const c = document.querySelector("canvas"); if (c) c.setAttribute("data-diag-capture", "true"); });
await browser.close();
