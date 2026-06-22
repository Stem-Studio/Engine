import {Clock} from "three";

import BaseEvent from "./BaseEvent";
import global from "../global";
import {
    hasNonIdentityTransform,
    resetRootTransform,
    resolveRootTransformPolicy,
} from "./renderRootTransformPolicy";
import {ExtendedDirectionalLight} from "../light/ExtendedDirectionalLight";
import EffectRenderer from "../render/EffectRenderer";
import {DetectDevice} from "../utils/DetectDevice";

/**
 * Render Event
 *
 */
class RenderEvent extends BaseEvent {
    constructor() {
        super();
        this.clock = new Clock();
        this.clock.start();

        this.running = true;
        this.lastFrameTime = 0;
        this.maxFPS = DetectDevice.isMobile() ? 30 : 60;
        this.frameInterval = 1000 / this.maxFPS;

        this.animate = this.animate.bind(this);
        this.runAnimationLoop = this.runAnimationLoop.bind(this);
        this.createRenderer = this.createRenderer.bind(this);
        this.onViewChanged = this.onViewChanged.bind(this);
        this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
        this.app = global.app;
        this.prevUseShadows = null;
        this.prevShadowMapType = -1;
        this.outlinedObjects = [];
        this.didWarnRootTransformOwnership = false;
    }

    start() {
        this.running = true;
        this.app.setLegacyAnimationLoopCallback(this.runAnimationLoop);
        this.app.setScheduledRenderCallback(this.animate);
        this.app.on(`viewChanged.${this.id}`, this.onViewChanged);
        this.app.on(`restartRenderer.${this.id}`, this.onRendererRestart.bind(this));
        this.app.on("outlineObjects", this.handleOutlineObjects.bind(this));
        this.app.on("pauseRender", this.handlePauseRender);
        this.app.on("resumeRender", this.handleResumeRender);
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
        this.app.stopScheduledAnimationLoop();
        this.app.setLegacyAnimationLoopCallback(null);
        this.app.setScheduledRenderCallback(null);
        this.app.on(`viewChanged.${this.id}`, null);
        this.app.on(`restartRenderer.${this.id}`, null);
        this.app.on("pauseRender", null);
        this.app.on("resumeRender", null);
        this.app.on(`sceneLoaded.${this.id}`, null);
        this.app.on(`postProcessingChanged.${this.id}`, null);

        document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    }

    reset() {}

    runAnimationLoop() {
        if (this.app.options.sceneType === "GIS" || !this.running || !this.app.renderer.hasInitialized()) return;

        const now = performance.now();
        const elapsed = now - this.lastFrameTime;

        if (elapsed < this.frameInterval) return;
        this.lastFrameTime = now - elapsed % this.frameInterval;

        const deltaTime = this.clock.getDelta();

        this.app.call("animate", this, this.clock, deltaTime);

        if (!this.app.shouldScheduleFrameRendering()) {
            this.animate(this.clock, deltaTime);
        }
    }

    animate(clock = this.clock, deltaTime = this.clock.getDelta()) {
        if (this.app.options.sceneType === "GIS" || !this.running || !this.app.renderer.hasInitialized()) return;

        const {camera, scene} = this.app;

        const rootsAreDirty = hasNonIdentityTransform(scene);
        if (rootsAreDirty) {
            const policy = resolveRootTransformPolicy(
                this.app.editor?.scene?.userData?.rendering,
                globalThis?.location?.search,
            );
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

        // Scene matrices are updated by SceneTraverser inside EffectRenderer.render().
        scene.matrixWorldAutoUpdate = false;

        // this.app.renderer.clear();
        // Check if renderer has changed (e.g. context loss/restore)
        if (!this.renderer || this.renderer.renderer && this.renderer.renderer !== this.app.renderer) {
            void this.createRenderer();
            return;
        }

        this.app.scheduleFrameRendering(() => {
            // this.app.renderer.clear();
            this.app.call("beforeRender", this, clock, deltaTime);

            // Update directional lights that support Unity-style
            if (ExtendedDirectionalLight?.instances?.size) {
                for (const light of ExtendedDirectionalLight.instances) {
                    if (light.parent) {
                        light.updateLight(camera);
                    }
                }
            }

            this.app.batchedRenderer.update(deltaTime);

            // Ensure camera matrices are not updated while rendering
            // We already update them :point_up:
            // TODO: refactor render pipeline
            camera.matrixWorldAutoUpdate = false;
            camera.matrixAutoUpdate = false;

            try {
                this.renderer.render();
            } finally {
                // Restore autoUpdates
                camera.matrixWorldAutoUpdate = true;
                camera.matrixAutoUpdate = true;
            }

            this.app.call("afterRender", this, clock, deltaTime);

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

                this.app.scene.traverse(child => {
                    if (child.isMesh && child.material) {
                        const materials = Array.isArray(child.material) ? child.material : [child.material];
                        materials.forEach(mat => {
                            mat.needsUpdate = true;
                        });
                    }
                });
            }

            const isAggregatingStats = this.app.stats?.dom.style.display !== "none";
            if (isAggregatingStats) {
                this.app.stats?.update();
            }
        });
    }

    createRenderer() {
        const {scene, sceneHelpers, camera, renderer, rendererCSS} = this.app;
        if (this.renderer) {
            this.renderer.dispose();
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

        this.renderer = new EffectRenderer();
        this.app.effectRenderer = this.renderer;

        try {
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
        this.running = false;
    };

    handleResumeRender = () => {
        this.running = true;
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

    destroy() {
        this.stop();
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
            this.app.effectRenderer = null;
        }
    }
}

export default RenderEvent;
