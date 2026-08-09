import BaseEvent from "./BaseEvent";
import global from "../global";
import {
    hasNonIdentityTransform,
    resetRootTransform,
    resolveRootTransformPolicy,
} from "./renderRootTransformPolicy";
import {ExtendedDirectionalLight} from "../light/ExtendedDirectionalLight";
import {DetectDevice} from "../utils/DetectDevice";
import {FrameClock} from "../utils/FrameClock";
import {traverseObjectDepthFirst} from "../utils/SceneTraverser";
import {isScriptImportInProgress} from "../agent/script-tool/scriptImportActivity";
import {
    installRuntimeFrameTelemetryDiagnostics,
    runtimeFrameTelemetry,
} from "../core/performance/RuntimeFrameTelemetry";
import {installRuntimeSubsystemDiagnostics} from "../core/performance/RuntimeSubsystemDiagnostics";

const LONG_ANIMATION_FRAME_WARNING_MS = 50;
const LONG_ANIMATION_FRAME_WARNING_INTERVAL_MS = 2000;
const EDIT_LONG_FRAME_RECOVERY_THRESHOLD_MS = 120;
const EDIT_LONG_FRAME_RECOVERY_MIN_MS = 250;
const EDIT_LONG_FRAME_RECOVERY_MAX_MS = 1500;

function createRenderBreakdown() {
    return {
        rootTransformMs: 0,
        rendererSetupMs: 0,
        beforeRenderMs: 0,
        lightUpdateMs: 0,
        batchedRendererMs: 0,
        effectRenderMs: 0,
        afterRenderMs: 0,
        shadowSyncMs: 0,
        statsMs: 0,
        totalMs: 0,
    };
}

function resetRenderBreakdown(breakdown) {
    breakdown.rootTransformMs = 0;
    breakdown.rendererSetupMs = 0;
    breakdown.beforeRenderMs = 0;
    breakdown.lightUpdateMs = 0;
    breakdown.batchedRendererMs = 0;
    breakdown.effectRenderMs = 0;
    breakdown.afterRenderMs = 0;
    breakdown.shadowSyncMs = 0;
    breakdown.statsMs = 0;
    breakdown.totalMs = 0;
    return breakdown;
}

function createRendererFrameInfo() {
    return {calls: 0, triangles: 0, points: 0, lines: 0};
}

/**
 * Render Event
 *
 */
class RenderEvent extends BaseEvent {
    constructor() {
        super();
        this.clock = new FrameClock();
        this.clock.start();

        this.running = true;
        this.lastFrameTime = 0;
        this.maxFPS = DetectDevice.isMobile() ? 30 : 60;
        this.frameInterval = 1000 / this.maxFPS;

        this.animate = this.animate.bind(this);
        this.runAnimationLoop = this.runAnimationLoop.bind(this);
        this.createRenderer = this.createRenderer.bind(this);
        this.onViewChanged = this.onViewChanged.bind(this);
        this.onRendererRestart = this.onRendererRestart.bind(this);
        this.handleOutlineObjects = this.handleOutlineObjects.bind(this);
        this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
        this.app = global.app;
        this.prevUseShadows = null;
        this.prevShadowMapType = -1;
        this.outlinedObjects = [];
        this.didWarnRootTransformOwnership = false;
        this.rootTransformPolicyCache = null;
        this.rendererCreatePromise = null;
        this.rendererCreateToken = 0;
        this.lastLongAnimationFrameWarningTime = 0;
        this.lastAnimationFrameDiagnostics = null;
        this.lastRenderBreakdown = null;
        this.lastRendererFrameInfo = null;
        // Diagnostics consumers read this reused object without allocating or
        // traversing the scene every frame.
        if (this.app) {
            this.app.lastRendererFrameInfo = null;
        }
        this.renderBreakdownScratch = createRenderBreakdown();
        this.rendererInfoBeforeScratch = createRendererFrameInfo();
        this.rendererInfoAfterScratch = createRendererFrameInfo();
        this.rendererFrameInfoScratch = createRendererFrameInfo();
        this.pauseDepth = 0;
        this.longFrameRecoveryUntil = 0;
        installRuntimeFrameTelemetryDiagnostics();
        installRuntimeSubsystemDiagnostics();
    }

    start() {
        this.running = true;
        this.app.setLegacyAnimationLoopCallback(this.runAnimationLoop);
        this.app.on(`viewChanged.${this.id}`, this.onViewChanged);
        this.app.on(`restartRenderer.${this.id}`, this.onRendererRestart);
        this.app.on(`outlineObjects.${this.id}`, this.handleOutlineObjects);
        this.app.on(`pauseRender.${this.id}`, this.handlePauseRender);
        this.app.on(`resumeRender.${this.id}`, this.handleResumeRender);
        // Listen for postProcessing changes and forward them to the active renderer
        this.app.on(`sceneLoaded.${this.id}`, this.createRenderer);
        this.app.on(`postProcessingChanged.${this.id}`, this.handlePostProcessingChanged);

        document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }

    handlePostProcessingChanged = scene => {
        try {
            const pp = scene?.userData?.postProcessing || {};
            if (this.renderer) {
                this.renderer.updatePostProcessingFromScene(pp);
            } else {
                // If renderer not initialized, recreate it so new settings are applied
                void this.createRenderer();
            }
        } catch (e) {
            console.warn("postProcessingChanged handler failed", e);
        }
    };

    stop() {
        this.running = false;
        this.rendererCreateToken += 1;
        this.rendererCreatePromise = null;
        this.app.stopScheduledAnimationLoop();
        this.app.setLegacyAnimationLoopCallback(null);
        this.app.on(`viewChanged.${this.id}`, null);
        this.app.on(`restartRenderer.${this.id}`, null);
        this.app.on(`outlineObjects.${this.id}`, null);
        this.app.on(`pauseRender.${this.id}`, null);
        this.app.on(`resumeRender.${this.id}`, null);
        this.app.on(`sceneLoaded.${this.id}`, null);
        this.app.on(`postProcessingChanged.${this.id}`, null);
        if (this.app) {
            this.app.lastRendererFrameInfo = null;
        }

        document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    }

    reset() {}

    getRootTransformPolicy() {
        const rendering = this.app.editor?.scene?.userData?.rendering;
        const scenePolicy = rendering?.rootTransformPolicy;
        const urlSearch = globalThis?.location?.search ?? "";
        const cache = this.rootTransformPolicyCache;

        if (cache && cache.scenePolicy === scenePolicy && cache.urlSearch === urlSearch) {
            return cache.policy;
        }

        const policy = resolveRootTransformPolicy(rendering, urlSearch);
        this.rootTransformPolicyCache = {
            scenePolicy,
            urlSearch,
            policy,
        };
        return policy;
    }

    runAnimationLoop() {
        if (this.app.options.sceneType === "GIS" || !this.running) return;

        const now = performance.now();
        if (!this.app.renderer.hasInitialized()) {
            runtimeFrameTelemetry.recordSkippedFrame("renderer-unavailable", now);
            return;
        }
        if (this.shouldSkipForLongFrameRecovery(now)) {
            runtimeFrameTelemetry.recordSkippedFrame("long-frame-recovery", now);
            return;
        }
        if (this.shouldSkipForScriptImport()) {
            this.lastFrameTime = now;
            this.clock.getDelta();
            runtimeFrameTelemetry.recordSkippedFrame("script-import", now);
            return;
        }

        const elapsed = now - this.lastFrameTime;

        if (elapsed < this.frameInterval) {
            runtimeFrameTelemetry.recordSkippedFrame("frame-cap", now);
            return;
        }
        this.lastFrameTime = now - elapsed % this.frameInterval;

        const deltaTime = this.clock.getDelta();

        const frameStart = performance.now();
        this.app.call("animate", this, this.clock, deltaTime);
        const appAnimateEnd = performance.now();
        this.lastRenderBreakdown = null;
        const didRender = this.animate(this.clock, deltaTime);
        const frameEnd = performance.now();
        // Startup/warmup frames run behind the loading mask and may include
        // one-off shader or post-processing compilation. Keep them in the
        // render-history diagnostics, but exclude them from the interactive
        // Play-session telemetry ring and pressure controller.
        const runtimeStartupActive = this.app?.isRuntimeStartupActive?.() === true;
        if (didRender && !runtimeStartupActive) {
            runtimeFrameTelemetry.recordRenderedFrame(
                frameEnd,
                this.lastRenderBreakdown?.totalMs ?? frameEnd - appAnimateEnd,
                deltaTime * 1000,
            );
        } else {
            runtimeFrameTelemetry.recordSkippedFrame("renderer-unavailable", frameEnd);
        }
        this.reportLongAnimationFrame({
            frameEnd,
            totalMs: frameEnd - frameStart,
            appAnimateMs: appAnimateEnd - frameStart,
            renderEventMs: frameEnd - appAnimateEnd,
            deltaTime,
        });
    }

    animate(clock = this.clock, deltaTime = this.clock.getDelta()) {
        if (this.app.options.sceneType === "GIS" || !this.running || !this.app.renderer.hasInitialized()) return false;

        const {camera, scene} = this.app;
        const breakdown = resetRenderBreakdown(this.renderBreakdownScratch);
        const renderStart = performance.now();
        let sectionStart = renderStart;

        const rootsAreDirty = hasNonIdentityTransform(scene);
        if (rootsAreDirty) {
            const policy = this.getRootTransformPolicy();
            if (policy === "auto-reset") {
                // Legacy behavior kept as default for backward compatibility.
                resetRootTransform(scene);
            } else if (policy === "warn-only" && !this.didWarnRootTransformOwnership) {
                this.didWarnRootTransformOwnership = true;
                console.warn(
                    "[RenderEvent] Scene root transform is non-identity. rootTransformPolicy=warn-only keeps transforms unchanged.",
                );
            } else if (policy === "ignore" && this.didWarnRootTransformOwnership) {
                // Reset warning state when explicitly ignoring this check.
                this.didWarnRootTransformOwnership = false;
            }
        }
        breakdown.rootTransformMs = performance.now() - sectionStart;

        // Scene matrices are updated by SceneTraverser inside EffectRenderer.render().
        scene.matrixWorldAutoUpdate = false;

        // this.app.renderer.clear();
        // Check if renderer has changed (e.g. context loss/restore)
        if (!this.renderer || this.renderer.renderer && this.renderer.renderer !== this.app.renderer) {
            sectionStart = performance.now();
            void this.createRenderer();
            breakdown.rendererSetupMs = performance.now() - sectionStart;
            breakdown.totalMs = performance.now() - renderStart;
            this.lastRenderBreakdown = breakdown;
            return false;
        }

        // The retired staged scheduler no longer wraps render work, so run the
        // render body directly and avoid allocating a callback every frame.
        // this.app.renderer.clear();
        sectionStart = performance.now();
        this.app.call("beforeRender", this, clock, deltaTime);
        breakdown.beforeRenderMs = performance.now() - sectionStart;

        // Update directional lights that support Unity-style
        sectionStart = performance.now();
        if (ExtendedDirectionalLight?.instances?.size) {
            for (const light of ExtendedDirectionalLight.instances) {
                if (light.parent) {
                    light.updateLight(camera);
                }
            }
        }
        breakdown.lightUpdateMs = performance.now() - sectionStart;

        sectionStart = performance.now();
        this.app.batchedRenderer.update(deltaTime);
        breakdown.batchedRendererMs = performance.now() - sectionStart;

        // Ensure camera matrices are not updated while rendering
        // We already update them :point_up:
        // TODO: refactor render pipeline
        camera.matrixWorldAutoUpdate = false;
        camera.matrixAutoUpdate = false;

        try {
            sectionStart = performance.now();
            const hasRendererInfoBefore = this.captureRendererInfoSnapshot(this.rendererInfoBeforeScratch);
            this.renderer.render();
            const hasRendererInfoAfter = this.captureRendererInfoSnapshot(this.rendererInfoAfterScratch);
            this.lastRendererFrameInfo = hasRendererInfoAfter
                ? this.setRendererInfoDelta(
                    this.rendererFrameInfoScratch,
                    hasRendererInfoBefore ? this.rendererInfoBeforeScratch : null,
                    this.rendererInfoAfterScratch,
                )
                : null;
            if (this.app) {
                this.app.lastRendererFrameInfo = this.lastRendererFrameInfo;
            }
            breakdown.effectRenderMs = performance.now() - sectionStart;
        } finally {
            // Restore autoUpdates
            camera.matrixWorldAutoUpdate = true;
            camera.matrixAutoUpdate = true;
        }

        // Publish a direct completion marker for the Play-start handshake.
        // The namespaced afterRender event remains the public compatibility
        // hook, while this monotonic timestamp closes the race where the first
        // frame is rendered before a listener is attached or dispatch wiring is
        // replaced during renderer handoff.
        this.app.lastRenderedFrameAt = performance.now();
        sectionStart = performance.now();
        this.app.call("afterRender", this, clock, deltaTime);
        breakdown.afterRenderMs = performance.now() - sectionStart;

        sectionStart = performance.now();
        const currentShadows = this.app.editor.useShadows;
        const currentShadowMapType = this.app.editor.rendering.shadowMapType;
        if (this.prevUseShadows !== currentShadows || this.prevShadowMapType !== currentShadowMapType) {
            this.prevUseShadows = currentShadows;
            this.prevShadowMapType = currentShadowMapType;
            if (this.app.renderer.shadowMap) {
                this.app.renderer.shadowMap.enabled = currentShadows;
                this.app.renderer.shadowMap.type = currentShadowMapType;
                this.app.renderer.shadowMap.needsUpdate = true;
            }

            traverseObjectDepthFirst(this.app.scene, child => {
                if (child.isMesh && child.material) {
                    const materials = child.material;
                    if (Array.isArray(materials)) {
                        for (const material of materials) {
                            material.needsUpdate = true;
                        }
                    } else {
                        materials.needsUpdate = true;
                    }
                }
            });
        }
        breakdown.shadowSyncMs = performance.now() - sectionStart;

        const isAggregatingStats = this.app.stats?.dom.style.display !== "none";
        if (isAggregatingStats) {
            sectionStart = performance.now();
            this.app.stats?.update();
            breakdown.statsMs = performance.now() - sectionStart;
        }
        breakdown.totalMs = performance.now() - renderStart;
        this.lastRenderBreakdown = breakdown;
        return true;
    }

    reportLongAnimationFrame({frameEnd, totalMs, appAnimateMs, renderEventMs, deltaTime}) {
        this.updateLongFrameRecovery(frameEnd, totalMs);

        const shouldCaptureFrameHistory = globalThis.__STEM_CAPTURE_RENDER_FRAME_HISTORY__ === true;
        const isLongFrame = totalMs >= LONG_ANIMATION_FRAME_WARNING_MS;
        if (!isLongFrame && !shouldCaptureFrameHistory) {
            return;
        }

        const rendererInfo = this.app.renderer?.info;
        const diagnostics = {
            startedAt: this.roundFrameMetric(frameEnd - totalMs),
            endedAt: this.roundFrameMetric(frameEnd),
            totalMs: this.roundFrameMetric(totalMs),
            isLongFrame,
            appAnimateMs: this.roundFrameMetric(appAnimateMs),
            renderEventMs: this.roundFrameMetric(renderEventMs),
            deltaTimeMs: this.roundFrameMetric(deltaTime * 1000),
            mode: this.app?.mode,
            isPlaying: this.app?.isPlaying === true,
            runtimeSceneRevealActive: this.app?.scene?.userData?._runtimeSceneRevealActive === true,
            renderBreakdown: this.roundFrameBreakdown(this.lastRenderBreakdown),
            renderer: rendererInfo
                ? {
                    calls: rendererInfo.render?.calls,
                    triangles: rendererInfo.render?.triangles,
                    points: rendererInfo.render?.points,
                    lines: rendererInfo.render?.lines,
                    geometries: rendererInfo.memory?.geometries,
                    textures: rendererInfo.memory?.textures,
                }
                : null,
            rendererFrame: this.lastRendererFrameInfo ? {...this.lastRendererFrameInfo} : null,
        };

        this.lastAnimationFrameDiagnostics = diagnostics;
        globalThis.__STEM_RENDER_FRAME_DIAGNOSTICS__ = diagnostics;
        const frameHistory = Array.isArray(globalThis.__STEM_RENDER_FRAME_HISTORY__)
            ? globalThis.__STEM_RENDER_FRAME_HISTORY__
            : [];
        frameHistory.push(diagnostics);
        if (frameHistory.length > 120) {
            frameHistory.splice(0, frameHistory.length - 120);
        }
        globalThis.__STEM_RENDER_FRAME_HISTORY__ = frameHistory;

        if (!isLongFrame || frameEnd - this.lastLongAnimationFrameWarningTime < LONG_ANIMATION_FRAME_WARNING_INTERVAL_MS) {
            return;
        }

        this.lastLongAnimationFrameWarningTime = frameEnd;
        console.warn("[RenderEvent] Long animation frame", diagnostics);
    }

    shouldSkipForLongFrameRecovery(now) {
        return now < this.longFrameRecoveryUntil && this.isEditModeRendering();
    }

    shouldSkipForScriptImport() {
        return this.isEditModeRendering() && isScriptImportInProgress();
    }

    isEditModeRendering() {
        return !this.app?.isPlaying && this.app?.mode !== "play" && this.app?.mode !== "sandbox";
    }

    updateLongFrameRecovery(frameEnd, totalMs) {
        if (!this.isEditModeRendering() || totalMs < EDIT_LONG_FRAME_RECOVERY_THRESHOLD_MS) {
            return;
        }

        const recoveryMs = Math.min(
            EDIT_LONG_FRAME_RECOVERY_MAX_MS,
            Math.max(EDIT_LONG_FRAME_RECOVERY_MIN_MS, totalMs),
        );
        this.longFrameRecoveryUntil = Math.max(this.longFrameRecoveryUntil, frameEnd + recoveryMs);
    }

    roundFrameBreakdown(breakdown) {
        if (!breakdown) {
            return null;
        }

        return Object.fromEntries(
            Object.entries(breakdown).map(([key, value]) => [key, this.roundFrameMetric(value)]),
        );
    }

    roundFrameMetric(value) {
        return Math.round(value * 10) / 10;
    }

    getRendererInfoSnapshot() {
        const snapshot = createRendererFrameInfo();
        if (!this.captureRendererInfoSnapshot(snapshot)) {
            return null;
        }
        return snapshot;
    }

    captureRendererInfoSnapshot(target) {
        const rendererInfo = this.app.renderer?.info;
        if (!rendererInfo) {
            return false;
        }

        target.calls = rendererInfo.render?.calls ?? 0;
        target.triangles = rendererInfo.render?.triangles ?? 0;
        target.points = rendererInfo.render?.points ?? 0;
        target.lines = rendererInfo.render?.lines ?? 0;
        return true;
    }

    getRendererInfoDelta(before, after) {
        if (!after) {
            return null;
        }
        if (!before) {
            return after;
        }

        return this.setRendererInfoDelta(createRendererFrameInfo(), before, after);
    }

    setRendererInfoDelta(target, before, after) {
        target.calls = this.rendererInfoCounterDelta(before?.calls, after.calls);
        target.triangles = this.rendererInfoCounterDelta(before?.triangles, after.triangles);
        target.points = this.rendererInfoCounterDelta(before?.points, after.points);
        target.lines = this.rendererInfoCounterDelta(before?.lines, after.lines);
        return target;
    }

    rendererInfoCounterDelta(before, after) {
        const value = after - (before ?? 0);
        return value >= 0 ? value : after;
    }

    createRenderer() {
        if (this.rendererCreatePromise) {
            return this.rendererCreatePromise;
        }

        const token = this.rendererCreateToken;
        const promise = this.createRendererAsync(token).finally(() => {
            if (this.rendererCreatePromise === promise) {
                this.rendererCreatePromise = null;
            }
        });
        this.rendererCreatePromise = promise;
        return promise;
    }

    async createRendererAsync(token) {
        const {scene, sceneHelpers, camera, renderer, rendererCSS} = this.app;
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
            this.app.effectRenderer = null;
        }
        this.lastRendererFrameInfo = null;
        if (this.app) {
            this.app.lastRendererFrameInfo = null;
        }

        // Initialise shadow tracking from the CURRENT scene/editor state and
        // configure the renderer's shadow map up-front. Previously these were
        // reset to sentinels (null / -1), so the first animate() frame after
        // every (re)create saw a spurious "shadow changed" and marked EVERY
        // material needsUpdate — a full pipeline recompile on the first play
        // frame for no reason. Seeding the real values lets materials compile
        // once (already shadow-correct); only a genuine later shadow toggle
        // takes the recompile path.
        this.prevUseShadows = this.app.editor?.useShadows ?? false;
        this.prevShadowMapType = this.app.editor?.rendering?.shadowMapType ?? -1;
        if (renderer?.shadowMap) {
            renderer.shadowMap.enabled = this.prevUseShadows;
            if (this.prevShadowMapType >= 0) renderer.shadowMap.type = this.prevShadowMapType;
            renderer.shadowMap.needsUpdate = true;
        }

        try {
            const {default: EffectRenderer} = await import("../render/EffectRenderer");
            if (token !== this.rendererCreateToken) {
                return;
            }

            this.renderer = new EffectRenderer();
            this.app.effectRenderer = this.renderer;
            this.renderer.create(scene, camera, renderer, rendererCSS, sceneHelpers);
            if (this.outlinedObjects) {
                this.renderer.setOutlinedObjects(this.outlinedObjects);
            }
        } catch (err) {
            console.warn("[RenderEvent] Post-processing unavailable, rendering without effects:", err);
            // EffectRenderer stays in degraded mode — render() falls through to _standardRender()
        }
    }

    onViewChanged() {
        void this.createRenderer();
    }

    onRendererRestart() {
        this.rendererCreateToken += 1;
        this.rendererCreatePromise = null;
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
            this.app.effectRenderer = null;
        }

        // Ensure shadow state is pushed again after renderer restart.
        this.prevUseShadows = null;
        this.prevShadowMapType = -1;

        this.app.stopScheduledAnimationLoop();
        setTimeout(() => {
            this.app.startScheduledAnimationLoop();
            void this.createRenderer();
        }, 50);
    }

    handleOutlineObjects(objects) {
        this.outlinedObjects = objects || [];
        if (this.renderer) {
            this.renderer.setOutlinedObjects(this.outlinedObjects);
        }
    }

    handlePauseRender = () => {
        if (this.pauseDepth === 0) {
            this.resetFrameTiming();
        }
        this.pauseDepth += 1;
        this.running = false;
    };

    handleResumeRender = () => {
        this.pauseDepth = Math.max(0, this.pauseDepth - 1);
        this.running = this.pauseDepth === 0;
        if (this.running) {
            this.resetFrameTiming();
        }
    };

    handleVisibilityChange() {
        if (document.hidden) {
            console.log("App moved to background - pausing render loop");
            this.handlePauseRender();
        } else {
            console.log("App moved to foreground - resuming render loop");
            this.handleResumeRender();
        }
    }

    resetFrameTiming() {
        this.app.resetSimulationClock?.();
        this.clock.getDelta();
        this.lastFrameTime = performance.now();
    }

    destroy() {
        this.stop();
        this.rendererCreateToken += 1;
        this.rendererCreatePromise = null;
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
            this.app.effectRenderer = null;
        }
    }
}

export default RenderEvent;
