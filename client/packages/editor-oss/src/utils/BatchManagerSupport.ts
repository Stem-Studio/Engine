import * as THREE from "three";
import {NoColorSpace, NearestFilter, RenderTarget} from "three";

import BatchManager from "./BatchManager";

let _cachedBatchManagerSupport: boolean | undefined;
let _probePromise: Promise<boolean> | undefined;

function publishBatchSupportDiagnostic(stage: string, data: Record<string, unknown> = {}) {
    const diagnostics = globalThis as typeof globalThis & {
        __STEM_BATCH_SUPPORT_DIAG_ENABLED__?: boolean;
        __STEM_BATCH_SUPPORT_DIAG__?: unknown;
        __STEM_BATCH_SUPPORT_DIAG_HISTORY__?: unknown[];
    };
    if (diagnostics.__STEM_BATCH_SUPPORT_DIAG_ENABLED__ === true) {
        const entry = {stage, ...data};
        diagnostics.__STEM_BATCH_SUPPORT_DIAG__ = entry;
        const history = diagnostics.__STEM_BATCH_SUPPORT_DIAG_HISTORY__ ?? [];
        history.push(entry);
        // Keep the gated probe trace bounded; this function is called from the
        // render loop after the one-time probe has settled. Preserve the first
        // probe stages because the tail is otherwise dominated by cached
        // render-loop reads before the harness samples the result.
        if (history.length > 64) history.splice(16, history.length - 64);
        diagnostics.__STEM_BATCH_SUPPORT_DIAG_HISTORY__ = history;
    }
}

function elapsedSince(startedAt: number): number {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    return Math.max(0, Math.round((now - startedAt) * 10) / 10);
}

/**
 * Synchronous accessor with lazy async probe. Returns the last known result,
 * kicking off a one-time async test on first call. Subsequent calls will
 * return the cached value once ready.
 * @returns {boolean} last known support value (updates asynchronously)
 */
export function isBatchManagerSupported(): boolean {
    if (_cachedBatchManagerSupport !== undefined) {
        publishBatchSupportDiagnostic("cached", {supported: _cachedBatchManagerSupport});
        return _cachedBatchManagerSupport;
    }
    if (!_probePromise) {
        publishBatchSupportDiagnostic("probe-scheduled");
        _probePromise = _probeBatchManagerSupport();
    }
    _cachedBatchManagerSupport = false;
    publishBatchSupportDiagnostic("probe-pending", {supported: false});
    return _cachedBatchManagerSupport;
}

/**
 * Explicit async probe for callers that can await.
 * @returns {Promise<boolean>} resolves to true when batching is supported
 */
export async function isBatchManagerSupportedAsync(): Promise<boolean> {
    if (_probePromise) return _probePromise;
    if (_cachedBatchManagerSupport !== undefined) {
        publishBatchSupportDiagnostic("cached", {supported: _cachedBatchManagerSupport});
        return _cachedBatchManagerSupport;
    }
    publishBatchSupportDiagnostic("probe-scheduled");
    _probePromise = _probeBatchManagerSupport();
    return _probePromise;
}

/**
 * Internal: perform an offscreen WebGPU render to validate BatchManager path.
 * @returns {Promise<boolean>} true if 100 boxes with unique colors are rendered correctly via batched path
 */
async function _probeBatchManagerSupport(): Promise<boolean> {
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    publishBatchSupportDiagnostic("probe-start");
    try {
        // Avoid importing/initializing a WebGPURenderer on WebGL-only devices.
        // In Chromium without an adapter, renderer.init() can monopolize the
        // main thread for tens of seconds while the editor is trying to paint.
        const gpu = typeof navigator !== "undefined" ? navigator.gpu : undefined;
        if (!gpu || typeof gpu.requestAdapter !== "function") {
            publishBatchSupportDiagnostic("probe-no-gpu", {durationMs: elapsedSince(startedAt)});
            _cachedBatchManagerSupport = false;
            return false;
        }
        const adapter = await gpu.requestAdapter();
        if (!adapter) {
            publishBatchSupportDiagnostic("probe-no-adapter", {durationMs: elapsedSince(startedAt)});
            _cachedBatchManagerSupport = false;
            return false;
        }
        publishBatchSupportDiagnostic("adapter-ready", {durationMs: elapsedSince(startedAt)});

        const {WebGPURenderer} = await import("three/webgpu");
        const canvas = document.createElement("canvas");
        const size = 64;
        canvas.width = size;
        canvas.height = size;

        const renderer = new WebGPURenderer({canvas});
        await renderer.init();
        publishBatchSupportDiagnostic("renderer-ready", {durationMs: elapsedSince(startedAt)});

        const scene = new THREE.Scene();
        scene.name = "BatchManagerProbeScene";
        const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
        camera.position.set(0, 0, 10);
        camera.lookAt(0, 0, 0);

        const boxes: THREE.Mesh[] = [];
        const boxSize = 0.8;
        const spacing = 1.0;
        const gridSize = 10;
        const colors: number[] = [];

        for (let i = 0; i < 100; i++) {
            const hue = i / 100 * 360;
            const color = new THREE.Color().setHSL(hue / 360, 1.0, 0.5);
            colors.push(color.getHex());

            const box = new THREE.Mesh(
                new THREE.BoxGeometry(boxSize, boxSize, boxSize),
                new THREE.MeshBasicMaterial({color: color.getHex()}),
            );

            const row = Math.floor(i / gridSize);
            const col = i % gridSize;
            box.position.set(
                (col - gridSize / 2 + 0.5) * spacing,
                (row - gridSize / 2 + 0.5) * spacing,
                0,
            );

            boxes.push(box);
            scene.add(box);
        }

        scene.updateMatrixWorld(true);

        try {
            const bm = new BatchManager(scene);
            bm.batchSceneMeshes();
            publishBatchSupportDiagnostic("batch-scene-ready", {durationMs: elapsedSince(startedAt)});
        } catch (err) {
            publishBatchSupportDiagnostic("batch-scene-failed", {durationMs: elapsedSince(startedAt), error: String(err)});
            console.error("[BatchManagerSupport] BatchManager failed:", err);
            try {
                renderer.dispose();
            } catch {
                // ignore
            }
            _cachedBatchManagerSupport = false;
            return false;
        }

        // Render into a dedicated render target
        const target = new RenderTarget(size, size, {minFilter: NearestFilter, magFilter: NearestFilter});
        target.texture.colorSpace = NoColorSpace;

        renderer.setSize(size, size, false);
        
        renderer.setRenderTarget(null);
        renderer.setClearColor(0xffffff, 1);
        await renderer.clear();
        await renderer.render(scene, camera);
        
        renderer.setRenderTarget(target);
        await renderer.clear();
        await renderer.render(scene, camera);

        const data = await renderer.readRenderTargetPixelsAsync(target, 0, 0, size, size);
        const pixels =
            data && data.length
                ? data instanceof Uint8Array
                    ? data
                    : new Uint8Array(data)
                : new Uint8Array(4 * size * size);

        const foundColors = new Set<string>();
        for (let i = 0; i < pixels.length; i += 4) {
            const r = pixels[i] ?? 0;
            const g = pixels[i + 1] ?? 0;
            const b = pixels[i + 2] ?? 0;
            if (r >= 255 && g >= 255 && b >= 255) continue;
            const colorKey = `${r},${g},${b}`;
            foundColors.add(colorKey);
        }

        const colorThreshold = 100;
        const colorsFound = foundColors.size >= colorThreshold;
        publishBatchSupportDiagnostic("probe-colors", {
            durationMs: elapsedSince(startedAt),
            colors: foundColors.size,
            threshold: colorThreshold,
            supported: colorsFound,
        });
        console.log(`[BatchManagerSupport] Found ${foundColors.size}/${colorThreshold} colors. ${colorsFound ? "PASSED" : "FAILED"}`);

        try {
            target.dispose();
        } catch {
            // ignore
        }
        try {
            for (const box of boxes) {
                box.geometry.dispose();
                if (Array.isArray(box.material)) {
                    box.material.forEach(m => m.dispose());
                } else {
                    box.material.dispose();
                }
            }
        } catch {
            // ignore
        }
        try {
            renderer.setRenderTarget(null);
            renderer.dispose();
        } catch {
            // ignore
        }

        _cachedBatchManagerSupport = colorsFound;
        publishBatchSupportDiagnostic("probe-complete", {durationMs: elapsedSince(startedAt), supported: colorsFound});
        return _cachedBatchManagerSupport;
    } catch (err) {
        publishBatchSupportDiagnostic("probe-failed", {durationMs: elapsedSince(startedAt), error: String(err)});
        console.error("[BatchManagerSupport] Probe failed with error:", err);
        _cachedBatchManagerSupport = false;
        return false;
    }
}
