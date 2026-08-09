import * as THREE from "three";

import type {IQualitySettings} from "./interfaces/IQualityManager";
import {BehaviorQualityModule} from "./modules/BehaviorQualityModule";
import {PhysicsQualityModule} from "./modules/PhysicsQualityModule";
import {RenderingQualityModule} from "./modules/RenderingQualityModule";
import {QualityAssessmentController} from "./QualityAssessmentController";
import {QualityManager} from "./QualityManager";
import type {IEngineRuntimeWithQuality, IQualityChangeEventData} from "./types";
// TODO(@stem/editor-oss migration): cross-subsystem dependencies — these
// will migrate into editor-oss in follow-up sub-steps.
import type EngineRuntime from "@stem/editor-oss/EngineRuntime";
import type {IPhysics} from "@stem/editor-oss/physics/common/types";
import type EffectRenderer from "@stem/editor-oss/render/EffectRenderer";
import { DetectDevice } from "@stem/editor-oss/utils/DetectDevice";
import {traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";
import {runtimeFrameTelemetry} from "@stem/editor-oss/core/performance/RuntimeFrameTelemetry";

type RenderingSettings = IQualitySettings["rendering"];

export interface RenderPressurePolicy {
    update(renderAvgMs: number, deltaTimeMs: number): void;
}

class RenderPressurePolicyImpl implements RenderPressurePolicy {
    private currentTier = 0;
    private escalationFrames = 0;
    private recoveryFrames = 0;
    private framesSinceLastChange = 0;
    private readonly requiredEscalationFrames = 6;
    private readonly requiredRecoveryFrames = 8;
    private readonly minFramesBetweenTierChanges = 6;

    constructor(
        private readonly getTargetFrameMs: () => number,
        private readonly applyTier: (tier: number) => void,
    ) {}

    update(renderAvgMs: number, deltaTimeMs: number): void {
        this.framesSinceLastChange++;

        const targetFrameMs = this.getTargetFrameMs();
        const signalMs = Math.max(renderAvgMs, deltaTimeMs * 0.6);
        const nextTier = this.computeTier(signalMs, targetFrameMs);

        if (nextTier > this.currentTier) {
            this.escalationFrames++;
            this.recoveryFrames = 0;

            const cooledDown = this.framesSinceLastChange >= this.minFramesBetweenTierChanges;
            const reachedEscalationWindow = this.escalationFrames >= this.requiredEscalationFrames;
            if (!cooledDown || !reachedEscalationWindow) {
                return;
            }

            this.currentTier = nextTier;
            this.framesSinceLastChange = 0;
            this.escalationFrames = 0;
            this.applyTier(this.currentTier);
            return;
        }

        if (nextTier < this.currentTier) {
            this.escalationFrames = 0;
            const recoverThreshold = this.thresholdForTier(this.currentTier, targetFrameMs) * 0.75;
            if (signalMs < recoverThreshold) {
                this.recoveryFrames++;
                const cooledDown = this.framesSinceLastChange >= this.minFramesBetweenTierChanges;
                if (this.recoveryFrames >= this.requiredRecoveryFrames && cooledDown) {
                    this.currentTier = nextTier;
                    this.recoveryFrames = 0;
                    this.framesSinceLastChange = 0;
                    this.applyTier(this.currentTier);
                }
            } else {
                this.recoveryFrames = 0;
            }
            return;
        }

        this.escalationFrames = 0;
        this.recoveryFrames = 0;
    }

    private computeTier(signalMs: number, targetFrameMs: number): number {
        if (signalMs > targetFrameMs * 1.0) return 4;
        if (signalMs > targetFrameMs * 0.85) return 3;
        if (signalMs > targetFrameMs * 0.7) return 2;
        if (signalMs > targetFrameMs * 0.6) return 1;
        return 0;
    }

    private thresholdForTier(tier: number, targetFrameMs: number): number {
        switch (tier) {
            case 4: return targetFrameMs * 1.0;
            case 3: return targetFrameMs * 0.85;
            case 2: return targetFrameMs * 0.7;
            case 1: return targetFrameMs * 0.6;
            default: return 0;
        }
    }
}

/**
 * Integrates the quality system with the existing StemStudio runtime.
 * Init-only: detects device, determines settings, wires modules at startup.
 */
export class QualitySystemIntegration {
    private static instance: QualitySystemIntegration | null = null;
    private static readonly MAX_QUALITY_CHANGE_LOGS = 20;

    private qualityManager: QualityManager;
    private renderingModule: RenderingQualityModule;
    private physicsModule: PhysicsQualityModule;
    private behaviorModule: BehaviorQualityModule;

    private engine: EngineRuntime | null = null;
    private initialized = false;
    private initializationPromise: Promise<void> | null = null;

    // Track animation frame IDs for cleanup
    private pendingAnimationFrames: Set<number> = new Set();
    private resizeHandler: (() => void) | null = null;
    private assessmentController: QualityAssessmentController | null = null;
    private readonly renderingReconnectEvent = "restartRenderer.QualitySystemIntegration";
    private readonly renderPressurePolicy = new RenderPressurePolicyImpl(
        () => 1000 / this.getRenderTargetFPS(),
        (tier) => this.scheduleRenderPressureTierApply(tier),
    );
    private renderPressureBaseline: RenderingSettings | null = null;
    private pendingRenderPressureTier: number | null = null;
    private renderPressureRafId: number | null = null;
    private unsubscribeRenderPressure: (() => void) | null = null;
    private qualityChangeLogCount = 0;

    private constructor() {
        this.qualityManager = QualityManager.getInstance();
        this.renderingModule = new RenderingQualityModule();
        this.physicsModule = new PhysicsQualityModule();
        this.behaviorModule = new BehaviorQualityModule();
    }

    public static getInstance(): QualitySystemIntegration {
        if (!QualitySystemIntegration.instance) {
            QualitySystemIntegration.instance = new QualitySystemIntegration();
        }
        return QualitySystemIntegration.instance;
    }

    /**
     * Initialize the quality system with the runtime engine
     * @param engine
     */
    public async initialize(engine: EngineRuntime): Promise<void> {
        if (this.initialized) {
            // Mode transitions call initialize() again so the same singleton
            // can be used by edit and play. Initialization is idempotent;
            // repeating it is expected and must not look like a startup error.
            return;
        }
        if (this.initializationPromise) {
            await this.initializationPromise;
            return;
        }

        this.engine = engine;

        this.initializationPromise = (async () => {
            // Store references on the runtime instance for global access
            const engineWithQuality = engine as IEngineRuntimeWithQuality;
            engineWithQuality.qualityManager = this.qualityManager;

            // Register quality modules
            this.qualityManager.registerModule(this.renderingModule);
            this.qualityManager.registerModule(this.physicsModule);
            this.qualityManager.registerModule(this.behaviorModule);

            // Initialize quality manager after module registration so initial settings
            // are actually applied to module instances.
            await this.qualityManager.initialize();

            // Setup integrations
            this.setupRenderingIntegration();
            this.setupPhysicsIntegration();
            this.setupBehaviorIntegration();
            this.setupEventListeners();

            // Initialize adaptive quality controller
            this.initializeAssessmentController().catch(error => {
                console.warn("Failed to initialize quality assessment controller:", error);
            });

            this.initialized = true;
            console.log("Quality system initialized successfully");
        })();

        try {
            await this.initializationPromise;
        } catch (error) {
            console.error("Failed to initialize quality system:", error);
            throw error;
        } finally {
            this.initializationPromise = null;
        }
    }

    /**
     * Dispose the quality system
     */
    public dispose(): void {
        if (!this.initialized) return;

        this.qualityManager.setRuntimeRenderingOverride(null);
        this.restoreBloomFromBaseline();
        this.restoreOutlineFromBaseline();
        this.renderPressureBaseline = null;

        if (this.engine) {
            this.engine.on(this.renderingReconnectEvent, null);
        }

        // Cancel any pending animation frames
        this.pendingAnimationFrames.forEach(frameId => {
            cancelAnimationFrame(frameId);
        });
        this.pendingAnimationFrames.clear();

        // Remove window resize listener
        if (this.resizeHandler) {
            window.removeEventListener("resize", this.resizeHandler);
            this.resizeHandler = null;
        }
        if (this.renderPressureRafId !== null) {
            cancelAnimationFrame(this.renderPressureRafId);
            this.pendingAnimationFrames.delete(this.renderPressureRafId);
            this.renderPressureRafId = null;
        }
        this.pendingRenderPressureTier = null;
        this.unsubscribeRenderPressure?.();
        this.unsubscribeRenderPressure = null;

        // Dispose assessment controller
        if (this.assessmentController) {
            this.assessmentController.dispose();
            this.assessmentController = null;
        }

        // Dispose quality manager
        this.qualityManager.dispose();

        // Remove references from the runtime
        if (this.engine) {
            const engineWithQuality = this.engine as IEngineRuntimeWithQuality;
            delete engineWithQuality.qualityManager;
        }

        // Clean up
        this.engine = null;
        this.initialized = false;
        QualitySystemIntegration.instance = null;
    }

    private async initializeAssessmentController(): Promise<void> {
        const detector = (this.qualityManager as any).deviceDetector;
        if (!detector || typeof detector.detectDeviceLane !== 'function') return;

        try {
            const { lane, startPresetId } = await detector.detectDeviceLane();
            this.assessmentController = new QualityAssessmentController(
                this.qualityManager,
                lane,
                startPresetId,
            );
            console.log(`[Quality] Assessment controller initialized: lane=${lane}, start=${startPresetId}`);
        } catch (error) {
            console.warn("[Quality] Assessment controller init failed:", error);
        }
    }

    /**
     * Returns an alarm callback suitable for external runtime pressure monitors.
     * Forwards edge-detected pressure transitions to the assessment worker.
     */
    public getAlarmCallback(): ((type: string, negative: boolean) => void) | undefined {
        if (!this.assessmentController) return undefined;
        return (type: string, negative: boolean) => {
            this.assessmentController?.sendAlarm(type, negative);
        };
    }

    private setupRenderingIntegration(): void {
        if (!this.engine) return;

        // Create a promise that resolves when renderer is available
        const waitForRenderer = (): Promise<void> => {
            return new Promise((resolve, reject) => {
                let currentFrameId: number | null = null;

                const checkRenderer = () => {
                    // Clear previous frame ID if it exists
                    if (currentFrameId !== null) {
                        this.pendingAnimationFrames.delete(currentFrameId);
                        currentFrameId = null;
                    }

                    // Check if the runtime is still available
                    if (!this.engine) {
                        reject(new Error("EngineRuntime was disposed while waiting for renderer"));
                        return;
                    }

                    const effectRenderer = this.getEffectRendererFromDispatcher();
                    if (effectRenderer) {
                        this.renderingModule.setRenderer(effectRenderer);
                        console.log("Quality system: Rendering module connected");
                        resolve();
                    } else {
                        // Use requestAnimationFrame for more efficient checking
                        currentFrameId = requestAnimationFrame(checkRenderer);
                        this.pendingAnimationFrames.add(currentFrameId);
                    }
                };
                checkRenderer();
            });
        };

        // Initialize rendering integration
        waitForRenderer().catch(error => {
            console.error("Failed to initialize rendering integration:", error);
        });

        this.engine.on(this.renderingReconnectEvent, () => {
            const reconnectFrameId = requestAnimationFrame(() => {
                this.pendingAnimationFrames.delete(reconnectFrameId);
                const effectRenderer = this.getEffectRendererFromDispatcher();
                if (effectRenderer) {
                    this.renderingModule.setRenderer(effectRenderer);
                    console.log("Quality system: Rendering module reconnected after renderer restart");
                }
            });
            this.pendingAnimationFrames.add(reconnectFrameId);
        });
    }

    private setupPhysicsIntegration(): void {
        if (!this.engine) return;

        // Create a promise that resolves when physics is available
        const waitForPhysics = (): Promise<void> => {
            return new Promise((resolve, reject) => {
                let currentFrameId: number | null = null;

                const checkPhysics = () => {
                    // Clear previous frame ID if it exists
                    if (currentFrameId !== null) {
                        this.pendingAnimationFrames.delete(currentFrameId);
                        currentFrameId = null;
                    }

                    // Check if the runtime is still available
                    if (!this.engine) {
                        reject(new Error("EngineRuntime was disposed while waiting for physics"));
                        return;
                    }

                    const engineWithPhysics = this.engine as EngineRuntime & {physics?: IPhysics};
                    const physics = engineWithPhysics.physics;
                    if (physics) {
                        this.physicsModule.setPhysics(physics);
                        console.log("Quality system: Physics module connected");
                        resolve();
                    } else {
                        // Use requestAnimationFrame for more efficient checking
                        currentFrameId = requestAnimationFrame(checkPhysics);
                        this.pendingAnimationFrames.add(currentFrameId);
                    }
                };
                checkPhysics();
            });
        };

        // Initialize physics integration
        waitForPhysics().catch(error => {
            console.error("Failed to initialize physics integration:", error);
        });
    }

    private setupBehaviorIntegration(): void {
        if (!this.engine) return;

        // Create a promise that resolves when behavior manager is available
        const waitForBehaviorManager = (): Promise<void> => {
            return new Promise((resolve, reject) => {
                let currentFrameId: number | null = null;

                const checkBehaviorManager = () => {
                    // Clear previous frame ID if it exists
                    if (currentFrameId !== null) {
                        this.pendingAnimationFrames.delete(currentFrameId);
                        currentFrameId = null;
                    }

                    // Check if the runtime is still available
                    if (!this.engine) {
                        reject(new Error("EngineRuntime was disposed while waiting for behavior manager"));
                        return;
                    }

                    const behaviorManager = this.engine.game?.behaviorManager;
                    if (behaviorManager) {
                        this.behaviorModule.setBehaviorManager(behaviorManager);
                        console.log("Quality system: Behavior module connected");
                        resolve();
                    } else {
                        // Use requestAnimationFrame for more efficient checking
                        currentFrameId = requestAnimationFrame(checkBehaviorManager);
                        this.pendingAnimationFrames.add(currentFrameId);
                    }
                };
                checkBehaviorManager();
            });
        };

        // Initialize behavior integration
        waitForBehaviorManager().catch(error => {
            console.error("Failed to initialize behavior integration:", error);
        });
    }

    private setupEventListeners(): void {
        if (!this.engine) return;

        this.connectRenderPressureTelemetry();

        // Listen for quality changes and propagate to all systems
        this.qualityManager.on("qualityChanged", (event: IQualityChangeEventData) => {
            this.logQualityChange(event);
            this.propagateQualityChange(event);
        });

        // Listen for window resize (store handler for cleanup in dispose)
        this.resizeHandler = () => {
            const width = window.innerWidth;
            const height = window.innerHeight;

            // Notify rendering module
            const renderingModuleWithResize = this.renderingModule as Partial<{
                handleResize: (resizeWidth: number, resizeHeight: number) => void;
            }>;
            if (typeof renderingModuleWithResize.handleResize === "function") {
                renderingModuleWithResize.handleResize(width, height);
            }
        };
        window.addEventListener("resize", this.resizeHandler);
    }

    private connectRenderPressureTelemetry(): void {
        // The render loop is the sole source of frame timing. Feed its
        // allocation-light stream into the existing hysteresis policy instead
        // of creating a second polling loop or quality authority.
        this.unsubscribeRenderPressure?.();
        this.unsubscribeRenderPressure = runtimeFrameTelemetry.subscribeToPressure(
            (renderTimeEmaMs, frameTimeMs) => {
                // Startup frequently contains one-off shader compilation and
                // scene construction stalls. Applying a pixel-ratio override
                // in that window calls renderer.setSize() at the worst
                // possible time and turns the transient stall into another
                // long GPU frame. Wait for the first-render handshake and
                // runtime systems to finish before adaptive pressure reacts.
                const startupAwareEngine = this.engine as (EngineRuntime & {
                    isRuntimeStartupActive?: () => boolean;
                }) | null;
                if (startupAwareEngine?.isRuntimeStartupActive?.()) {
                    return;
                }
                this.renderPressurePolicy.update(renderTimeEmaMs, frameTimeMs);
            },
        );
    }

    private propagateQualityChange(event: IQualityChangeEventData): void {
        const settings = event.newSettings;

        // Update renderer immediately
        if (this.engine && this.engine.renderer) {
            const renderer = this.engine.renderer as { setPixelRatio: (value: number) => void };

            // Update pixel ratio
            if (settings.rendering.pixelRatio) {
                const targetPixelRatio = window.devicePixelRatio * settings.rendering.pixelRatio;
                renderer.setPixelRatio(targetPixelRatio);
            }
        }

        // The frame orchestrator runtime path has been retired; keep scheduler
        // settings accepted for compatibility and apply only the independent
        // LambdaScheduler budget knobs.
        if (settings.scheduler && event.reason !== "performance") {
            const fixedHz = settings.physics?.updateRate ?? settings.scheduler.fixedTimestepHz;

            const scheduler = this.engine?.game?.lambdaManager?.scheduler;
            if (scheduler && typeof scheduler.updateConfig === "function") {
                scheduler.updateConfig({
                    frameBudgetMs: settings.scheduler.frameBudgetMs,
                    targetFPS: fixedHz,
                });
            }
        }

        if (event.reason !== "performance") {
            this.engine?.configureSimulationQuality?.(settings);
        }
    }

    private logQualityChange(event: IQualityChangeEventData): void {
        if (this.qualityChangeLogCount >= QualitySystemIntegration.MAX_QUALITY_CHANGE_LOGS) {
            return;
        }

        const renderingDiff = this.describeSettingDiff(
            event.previousSettings.rendering,
            event.newSettings.rendering,
        );
        const schedulerDiff = this.describeSettingDiff(
            event.previousSettings.scheduler,
            event.newSettings.scheduler,
        );

        const segments = [`reason=${event.reason}`];
        if (renderingDiff.length > 0) {
            segments.push(`rendering=${renderingDiff.join(", ")}`);
        }
        if (schedulerDiff.length > 0 && event.reason !== "performance") {
            segments.push(`scheduler=${schedulerDiff.join(", ")}`);
        }
        if (segments.length === 1) {
            segments.push("effectiveDiff=none");
        }

        this.qualityChangeLogCount++;
        console.log(`[Quality] settings changed ${segments.join(" | ")}`);
    }

    private describeSettingDiff(
        previousSettings: Record<string, unknown>,
        nextSettings: Record<string, unknown>,
    ): string[] {
        const diffKeys = new Set([
            ...Object.keys(previousSettings),
            ...Object.keys(nextSettings),
        ]);

        return Array.from(diffKeys)
            .filter(key => previousSettings[key] !== nextSettings[key])
            .sort()
            .map(key => `${key}:${this.formatSettingValue(previousSettings[key])}->${this.formatSettingValue(nextSettings[key])}`);
    }

    private formatSettingValue(value: unknown): string {
        if (value === undefined) return "undefined";
        if (value === null) return "null";
        if (typeof value === "number") return Number.isInteger(value) ? `${value}` : value.toFixed(2);
        if (typeof value === "boolean") return value ? "on" : "off";
        return String(value);
    }

    /**
     * Re-wire quality modules to fresh runtime instances after a new play
     * session starts.  Fixes stale references when play → stop → play cycles
     * create new physics / game / renderer objects.
     * @param engine
     */
    public rewireModules(engine: EngineRuntime): void {
        this.engine = engine;

        // Rendering: effectRenderer may survive across sessions (managed by
        // RenderEvent), so only re-set when a new instance exists.
        const effectRenderer = this.getEffectRendererFromDispatcher();
        if (effectRenderer) {
            this.renderingModule.setRenderer(effectRenderer);
        }

        // Physics: PlayerPhysics2 is recreated each session.
        // The module expects IPhysics but only stores it — safe to skip if
        // the actual engine isn't created yet (configureQuality handles physics
        // settings directly on PlayerPhysics2).

        // Behavior: behaviorManager is recreated each session via GameManager.
        const behaviorManager = engine.game?.behaviorManager;
        if (behaviorManager) {
            this.behaviorModule.setBehaviorManager(behaviorManager);
        }
    }

    /**
     * Launch-time quality selection for player mode.
     * Chooses settings from device profile and optional scene preset mapping.
     * No adaptive/runtime auto-quality is used.
     * @param sceneUserData
     */
    public async preparePlayerLaunchQuality(sceneUserData?: Record<string, unknown>): Promise<IQualitySettings> {
        const category = this.getDeviceCategory();
        const qualityPresets = sceneUserData?.qualityPresets as Record<string, string> | undefined;
        const presetKey = qualityPresets?.[category];

        if (typeof presetKey === "string" && presetKey.length > 0) {
            await this.qualityManager.applyPreset(presetKey, { persist: false });
            console.log(`[Quality] Applied "${presetKey}" preset for ${category} device`);
        } else {
            const recommendedSettings = await this.qualityManager.detectDeviceCapabilities();
            await this.qualityManager.setSettings(recommendedSettings, { persist: false });
            console.log(`[Quality] Applied device profile for ${category} device`);
        }

        // Older scenes may still carry scheduler metadata. Keep accepting the
        // shape, but force the retired staged scheduler runtime path off.
        await this.qualityManager.setSettings(
            { scheduler: { enabled: false } } as any,
            { persist: false },
        );

        return this.qualityManager.getCurrentSettings();
    }

    /**
     * One-shot sync to push currently selected launch settings into live runtime
     * systems after player objects are created.
     */
    public syncRuntimeSettings(): void {
        const settings = this.qualityManager.getCurrentSettings();
        this.propagateQualityChange({
            previousSettings: settings,
            newSettings: settings,
            reason: "manual",
            timestamp: Date.now(),
        });
    }

    private applyRenderPressureTier(tier: number): void {
        if (tier <= 0) {
            this.qualityManager.setRuntimeRenderingOverride(null);
            this.restoreBloomFromBaseline();
            this.restoreOutlineFromBaseline();
            this.renderPressureBaseline = null;
            return;
        }

        const currentSettings = this.qualityManager.getCurrentSettings();
        if (!this.renderPressureBaseline) {
            this.renderPressureBaseline = { ...currentSettings.rendering };
        }

        const baseline = this.renderPressureBaseline;
        const renderingOverride: Partial<RenderingSettings> = {};

        // Tier 1+: disable bloom
        if (tier >= 1 && baseline.bloom) {
            renderingOverride.bloom = false;
            this.setBloomEnabled(false);
        } else {
            this.restoreBloomFromBaseline();
        }

        // Tier 2+: disable outline via scene postProcessing
        if (tier >= 2) {
            this.setOutlineEnabled(false);
        } else {
            this.restoreOutlineFromBaseline();
        }

        // Avoid changing shadow quality at runtime on WebGPU.
        // Recreating shadow depth resources mid-session has been causing
        // "Destroyed texture [ShadowDepthTexture] used in a submit" errors.

        // Tier 4: lower resolution scale
        const pressurePixelRatio = this.getRenderPressurePixelRatio(baseline.pixelRatio, tier);
        if (pressurePixelRatio !== null) {
            renderingOverride.pixelRatio = pressurePixelRatio;
        }

        this.qualityManager.setRuntimeRenderingOverride(renderingOverride);
    }

    private scheduleRenderPressureTierApply(tier: number): void {
        this.pendingRenderPressureTier = tier;

        if (this.renderPressureRafId !== null) {
            return;
        }

        const frameId = requestAnimationFrame(() => {
            this.pendingAnimationFrames.delete(frameId);
            this.renderPressureRafId = null;

            const pendingTier = this.pendingRenderPressureTier;
            this.pendingRenderPressureTier = null;
            if (pendingTier === null || !this.initialized) {
                return;
            }

            this.applyRenderPressureTier(pendingTier);
        });

        this.renderPressureRafId = frameId;
        this.pendingAnimationFrames.add(frameId);
    }

    private outlineBaselineEnabled: boolean | null = null;

    private bloomBaselineEnabled: boolean | null = null;

    private getRuntimePostProcessingScene(): {userData?: {postProcessing?: Record<string, any>}} | null {
        return (this.engine?.game?.scene || (this.engine as any)?.scene || null) as {
            userData?: {postProcessing?: Record<string, any>}
        } | null;
    }

    private setBloomEnabled(enabled: boolean): void {
        const scene = this.getRuntimePostProcessingScene();
        const bloom = scene?.userData?.postProcessing?.bloom;
        if (!bloom || typeof bloom !== "object") return;
        if (this.bloomBaselineEnabled === null) {
            this.bloomBaselineEnabled = bloom.enabled !== false;
        }
        if (bloom.enabled === enabled) return;
        bloom.enabled = enabled;
        const effectRenderer = this.getEffectRendererFromDispatcher();
        if (effectRenderer && scene?.userData?.postProcessing) {
            effectRenderer.updatePostProcessingFromScene(scene.userData.postProcessing);
        }
    }

    private restoreBloomFromBaseline(): void {
        if (this.bloomBaselineEnabled === null) return;
        this.setBloomEnabled(this.bloomBaselineEnabled);
        this.bloomBaselineEnabled = null;
    }

    private setOutlineEnabled(enabled: boolean): void {
        const scene = this.engine?.game?.scene;
        if (!scene?.userData?.postProcessing?.outline) return;
        // Save baseline on first disable
        if (this.outlineBaselineEnabled === null) {
            this.outlineBaselineEnabled = scene.userData.postProcessing.outline.enabled ?? true;
        }
        if (scene.userData.postProcessing.outline.enabled === enabled) return;
        scene.userData.postProcessing.outline.enabled = enabled;
        const effectRenderer = this.getEffectRendererFromDispatcher();
        if (effectRenderer) {
            effectRenderer.updatePostProcessingFromScene(scene.userData.postProcessing);
        }
    }

    private restoreOutlineFromBaseline(): void {
        if (this.outlineBaselineEnabled === null) return;
        const scene = this.engine?.game?.scene;
        if (!scene?.userData?.postProcessing?.outline) return;
        const restore = this.outlineBaselineEnabled;
        this.outlineBaselineEnabled = null;
        if (scene.userData.postProcessing.outline.enabled === restore) return;
        scene.userData.postProcessing.outline.enabled = restore;
        const effectRenderer = this.getEffectRendererFromDispatcher();
        if (effectRenderer) {
            effectRenderer.updatePostProcessingFromScene(scene.userData.postProcessing);
        }
    }

    private getRenderPressurePixelRatio(baselinePixelRatio: number, tier: number): number | null {
        if (tier < 2 || typeof window === "undefined") {
            return null;
        }

        const devicePixelRatio = Math.max(window.devicePixelRatio || 1, 1);
        const deviceCategory = this.getDeviceCategory();

        if (deviceCategory !== "Desktop") {
            return tier >= 4 ? Math.max(0.5, baselinePixelRatio * 0.85) : null;
        }

        const maxEffectivePixelRatio = tier >= 4
            ? 1.25
            : tier >= 3
                ? 1.5
                : 1.75;
        const pressureScale = tier >= 4 ? 0.85 : 1.0;
        const cappedPixelRatio = Math.min(
            baselinePixelRatio * pressureScale,
            maxEffectivePixelRatio / devicePixelRatio,
        );

        return Math.max(0.25, cappedPixelRatio);
    }

    private getDeviceCategory(): "Desktop" | "Mobile" | "iOS" {
        if (typeof navigator === "undefined") return "Desktop";

        const nav = navigator as Navigator & { platform?: string };
        const ua = navigator.userAgent;
        const isIOS = /iPad|iPhone|iPod/.test(ua) || (nav.platform === "MacIntel" && navigator.maxTouchPoints > 1);
        if (isIOS) return "iOS";

        const isMobile = /Android|webOS|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);
        return isMobile ? "Mobile" : "Desktop";
    }

    private getRenderTargetFPS(): number {
        return DetectDevice.isMobile() ? 30 : 60;
    }

    private getEffectRendererFromDispatcher(): EffectRenderer | null {
        if (!this.engine) return null;

        const dispatcher = this.engine.event as unknown as { events?: unknown[] };
        if (!Array.isArray(dispatcher.events)) return null;

        const renderEvent = dispatcher.events.find((eventCandidate) => {
            if (!eventCandidate || typeof eventCandidate !== "object") return false;
            const typedEvent = eventCandidate as { renderer?: unknown; createRenderer?: unknown };
            return typeof typedEvent.createRenderer === "function";
        }) as { renderer?: unknown } | undefined;

        if (!renderEvent?.renderer || typeof renderEvent.renderer !== "object") {
            return null;
        }

        return renderEvent.renderer as EffectRenderer;
    }

    // Public API

    /**
     * Get the quality manager instance.
     * @returns Quality manager singleton.
     */
    public getQualityManager(): QualityManager {
        return this.qualityManager;
    }

    /**
     * Get the current scheduler config from quality settings.
     * @returns Scheduler configuration object.
     */
    public getSchedulerConfig(): IQualitySettings['scheduler'] {
        return this.qualityManager.getCurrentSettings().scheduler;
    }

    public createRenderPressurePolicy(): RenderPressurePolicy {
        return this.renderPressurePolicy;
    }

    /**
     * Apply a quality preset
     * @param presetId
     */
    public async applyPreset(presetId: string): Promise<void> {
        await this.qualityManager.applyPreset(presetId);
    }

    /**
     * Warn if scene exceeds device-recommended light count.
     * @param scene
     */
    public validateSceneLights(scene: THREE.Scene): void {
        const maxLights = this.renderingModule.getMaxLights();
        let lightCount = 0;
        traverseObjectDepthFirst(scene, (obj) => {
            if (obj instanceof THREE.Light && !(obj instanceof THREE.AmbientLight)) {
                lightCount++;
            }
        });
        if (lightCount > maxLights) {
            console.warn(
                `[QualitySystem] Scene has ${lightCount} lights but device profile recommends max ${maxLights}. ` +
                    `Consider reducing lights for better performance on this device.`,
            );
        }
    }
}
