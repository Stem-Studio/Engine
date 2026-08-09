import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QualityPresets } from "./QualityPresets";
import { QualitySystemIntegration } from "./QualitySystemIntegration";
import {runtimeFrameTelemetry} from "../performance/RuntimeFrameTelemetry";

/**
 *
 */
function createSettings() {
    const settings = JSON.parse(JSON.stringify(QualityPresets.getDefault().settings));
    settings.rendering.pixelRatio = 1;
    settings.rendering.shadowQuality = "high";
    settings.rendering.bloom = true;
    return settings;
}

let originalWindow: typeof globalThis.window | undefined;

/**
 *
 */
function createHarness() {
    const integration = new (QualitySystemIntegration as any)() as QualitySystemIntegration;
    const renderer = {
        updatePostProcessingFromScene: vi.fn(),
    };
    const scene = {
        userData: {
            postProcessing: {
                bloom: {
                    enabled: true,
                },
                outline: {
                    enabled: true,
                },
            },
        },
    };
    const currentSettings = createSettings();
    const qualityManager = {
        getCurrentSettings: vi.fn(() => currentSettings),
        setRuntimeRenderingOverride: vi.fn(),
    };

    (integration as any).qualityManager = qualityManager;
    (integration as any).initialized = true;
    (integration as any).scheduleRenderPressureTierApply = (tier: number) => {
        (integration as any).applyRenderPressureTier(tier);
    };
    (integration as any).engine = {
        game: { scene },
        editor: null,
        event: {
            events: [
                {
                    createRenderer: vi.fn(),
                    renderer,
                },
            ],
        },
    };

    return { integration, qualityManager, renderer, scene };
}

function addDeepObjectChain(root: THREE.Object3D, depth = 12_000): THREE.Object3D {
    let current = root;

    for (let i = 0; i < depth; i++) {
        const child = new THREE.Object3D();
        current.add(child);
        current = child;
    }

    return current;
}

beforeEach(() => {
    originalWindow = globalThis.window;
    (globalThis as any).window = {
        ...(originalWindow ?? {}),
        devicePixelRatio: originalWindow?.devicePixelRatio ?? 1,
    };
});

afterEach(() => {
    runtimeFrameTelemetry.reset();
    if (originalWindow === undefined) {
        delete (globalThis as any).window;
    } else {
        (globalThis as any).window = originalWindow;
    }
});

describe("QualitySystemIntegration render pressure policy", () => {
    it("feeds live render telemetry into the existing pressure policy", () => {
        const integration = new (QualitySystemIntegration as any)() as QualitySystemIntegration;
        const update = vi.fn();
        (integration as any).renderPressurePolicy = {update};

        (integration as any).connectRenderPressureTelemetry();
        runtimeFrameTelemetry.recordRenderedFrame(16.67, 7, 16.67);

        expect(update).toHaveBeenCalledWith(7, 16.67);
        (integration as any).unsubscribeRenderPressure();
    });

    it("does not react to transient render pressure during runtime startup", () => {
        const integration = new (QualitySystemIntegration as any)() as QualitySystemIntegration;
        const update = vi.fn();
        (integration as any).renderPressurePolicy = {update};
        (integration as any).engine = {
            isRuntimeStartupActive: () => true,
        };

        (integration as any).connectRenderPressureTelemetry();
        runtimeFrameTelemetry.recordRenderedFrame(1600, 120, 1600);

        expect(update).not.toHaveBeenCalled();
        (integration as any).unsubscribeRenderPressure();
    });

    it("waits for sustained pressure samples before changing quality", () => {
        const { integration, qualityManager } = createHarness();
        const policy = integration.createRenderPressurePolicy();

        for (let i = 0; i < 5; i++) {
            policy.update(40, 16);
        }

        expect(qualityManager.setRuntimeRenderingOverride).not.toHaveBeenCalled();
    });

    it("sheds bloom, outline and resolution at the highest pressure tier", () => {
        const { integration, qualityManager, renderer, scene } = createHarness();
        const policy = integration.createRenderPressurePolicy();

        for (let i = 0; i < 6; i++) {
            // signalMs=40, targetFrameMs≈16.67 → tier 4
            policy.update(40, 16);
        }

        expect(qualityManager.setRuntimeRenderingOverride).toHaveBeenCalledWith(
            expect.objectContaining({
                bloom: false,
                pixelRatio: 0.85,
            }),
        );
        expect(scene.userData.postProcessing.outline.enabled).toBe(false);
        expect(renderer.updatePostProcessingFromScene).toHaveBeenCalled();
    });

    it("caps desktop effective DPR under pressure at tier 3", () => {
        const { integration, qualityManager } = createHarness();
        const policy = integration.createRenderPressurePolicy();
        Object.defineProperty(window, "devicePixelRatio", {
            configurable: true,
            value: 2,
        });
        (integration as any).getDeviceCategory = () => "Desktop";

        for (let i = 0; i < 6; i++) {
            // signalMs=13, targetFrameMs≈16.67 → 13 > 16.67*0.7=11.67 → tier 2
            policy.update(13, 16);
        }

        expect(qualityManager.setRuntimeRenderingOverride).toHaveBeenCalledWith(
            expect.objectContaining({
                bloom: false,
            }),
        );
    });

    it("requires sustained recovery before restoring pressure overrides", () => {
        const { integration, qualityManager, renderer, scene } = createHarness();
        const policy = integration.createRenderPressurePolicy();

        for (let i = 0; i < 6; i++) {
            policy.update(40, 16);
        }
        qualityManager.setRuntimeRenderingOverride.mockClear();
        renderer.updatePostProcessingFromScene.mockClear();

        for (let i = 0; i < 7; i++) {
            policy.update(1, 1);
        }

        expect(qualityManager.setRuntimeRenderingOverride).not.toHaveBeenCalled();
        // Outline stays disabled during hysteresis
        expect(scene.userData.postProcessing.outline.enabled).toBe(false);

        policy.update(1, 1);

        expect(qualityManager.setRuntimeRenderingOverride).toHaveBeenCalledWith(null);
        // Outline restored after full recovery
        expect(scene.userData.postProcessing.outline.enabled).toBe(true);
        expect(scene.userData.postProcessing.bloom.enabled).toBe(true);
        expect(renderer.updatePostProcessingFromScene).toHaveBeenCalled();
    });

    it("resets recovery progress if pressure returns before hysteresis completes", () => {
        const { integration, qualityManager } = createHarness();
        const policy = integration.createRenderPressurePolicy();

        for (let i = 0; i < 6; i++) {
            policy.update(40, 16);
        }
        qualityManager.setRuntimeRenderingOverride.mockClear();

        for (let i = 0; i < 6; i++) {
            policy.update(1, 1);
        }

        for (let i = 0; i < 6; i++) {
            policy.update(40, 16);
        }

        for (let i = 0; i < 7; i++) {
            policy.update(1, 1);
        }

        expect(qualityManager.setRuntimeRenderingOverride).not.toHaveBeenCalled();
    });

    it("disables bloom at tier 1 without touching outline or shadows", () => {
        const { integration, qualityManager, renderer, scene } = createHarness();
        const policy = integration.createRenderPressurePolicy();

        for (let i = 0; i < 6; i++) {
            // signalMs=10.5, targetFrameMs≈16.67 → tier 1
            policy.update(10.5, 16);
        }

        expect(qualityManager.setRuntimeRenderingOverride).toHaveBeenCalledWith({
            bloom: false,
        });
        // Outline stays enabled at tier 1
        expect(scene.userData.postProcessing.outline.enabled).toBe(true);
        expect(scene.userData.postProcessing.bloom.enabled).toBe(false);
        expect(renderer.updatePostProcessingFromScene).toHaveBeenCalled();
    });

    it("disables bloom and outline at tier 2", () => {
        const { integration, qualityManager, renderer, scene } = createHarness();
        const policy = integration.createRenderPressurePolicy();

        for (let i = 0; i < 6; i++) {
            // signalMs=13, targetFrameMs≈16.67 → 13 > 16.67*0.7=11.67 → tier 2
            policy.update(13, 16);
        }

        expect(qualityManager.setRuntimeRenderingOverride).toHaveBeenCalledWith(
            expect.objectContaining({
                bloom: false,
            }),
        );
        expect(scene.userData.postProcessing.outline.enabled).toBe(false);
        expect(renderer.updatePostProcessingFromScene).toHaveBeenCalled();
    });
});

describe("QualitySystemIntegration launch scheduler compatibility", () => {
    it("accepts legacy scene scheduler metadata without enabling the retired frame orchestrator", async () => {
        const integration = new (QualitySystemIntegration as any)() as QualitySystemIntegration;
        const currentSettings = createSettings();
        currentSettings.scheduler.enabled = true;

        const qualityManager = {
            applyPreset: vi.fn(),
            detectDeviceCapabilities: vi.fn(async () => currentSettings),
            getCurrentSettings: vi.fn(() => currentSettings),
            setSettings: vi.fn(async (patch: any) => {
                if (patch.scheduler) {
                    currentSettings.scheduler = {
                        ...currentSettings.scheduler,
                        ...patch.scheduler,
                    };
                }
                return currentSettings;
            }),
        };

        (integration as any).qualityManager = qualityManager;
        (integration as any).getDeviceCategory = () => "Desktop";

        const result = await integration.preparePlayerLaunchQuality({
            scheduler: {
                enabled: true,
                behaviorUpdateMode: "fixed",
            },
        });

        expect(result.scheduler.enabled).toBe(false);
        expect(qualityManager.setSettings).toHaveBeenCalledWith(
            { scheduler: { enabled: false } },
            { persist: false },
        );
    });
});

describe("QualitySystemIntegration scene validation", () => {
    it("validates deep scene light counts without recursive Object3D traversal", () => {
        const integration = new (QualitySystemIntegration as any)() as QualitySystemIntegration;
        (integration as any).renderingModule = {
            getMaxLights: vi.fn(() => 1),
        };
        const scene = new THREE.Scene();
        const leaf = addDeepObjectChain(scene);
        leaf.add(new THREE.DirectionalLight());
        scene.add(new THREE.PointLight());
        scene.add(new THREE.AmbientLight());
        const traverseSpy = vi.spyOn(scene, "traverse");
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        expect(() => integration.validateSceneLights(scene)).not.toThrow();

        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Scene has 2 lights"));
        expect(traverseSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
        traverseSpy.mockRestore();
    });
});
