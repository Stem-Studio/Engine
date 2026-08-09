import { describe, it, expect } from "vitest";

import { QualityPresets } from "./QualityPresets";

describe("QualityPresets", () => {
    it("should have all expected presets", () => {
        const presets = QualityPresets.getAllPresets();
        const ids = presets.map(p => p.id);
        expect(ids).toContain("ultra");
        expect(ids).toContain("high");
        expect(ids).toContain("medium");
        expect(ids).toContain("low");
        expect(ids).toContain("performance");
        expect(ids).toContain("mobile");
        expect(ids).toContain("ios");
    });

    it("mobile preset should be more aggressive than low preset", () => {
        const mobile = QualityPresets.getPreset("mobile")!;
        const low = QualityPresets.getPreset("low")!;

        expect(mobile.settings.rendering.pixelRatio).toBeLessThan(low.settings.rendering.pixelRatio);
        expect(mobile.settings.rendering.lodBias).toBeGreaterThan(low.settings.rendering.lodBias);
        expect(mobile.settings.scene.viewDistance).toBeLessThan(low.settings.scene.viewDistance);
        expect(mobile.settings.scene.maxDrawCalls).toBeLessThan(low.settings.scene.maxDrawCalls);
        expect(mobile.settings.scene.maxTriangles).toBeLessThan(low.settings.scene.maxTriangles);
    });

    it("mobile preset should have tuned values", () => {
        const mobile = QualityPresets.getPreset("mobile")!;

        expect(mobile.settings.rendering.pixelRatio).toBe(0.7);
        expect(mobile.settings.rendering.lodBias).toBe(5);
        expect(mobile.settings.behavior.maxConcurrentBehaviors).toBe(10);
        expect(mobile.settings.behavior.maxParticles).toBe(100);
        expect(mobile.settings.scene.viewDistance).toBe(50);
        expect(mobile.settings.scene.maxDrawCalls).toBe(100);
        expect(mobile.settings.scene.maxTriangles).toBe(25000);
    });

    it("iOS preset should exist and inherit from medium", () => {
        const ios = QualityPresets.getPreset("ios")!;
        const medium = QualityPresets.getPreset("medium")!;

        expect(ios).toBeDefined();
        expect(ios.settings.physics.updateRate).toBe(medium.settings.physics.updateRate);
        expect(ios.settings.network.updateRate).toBe(medium.settings.network.updateRate);
    });

    it("all presets should have required fields", () => {
        const presets = QualityPresets.getAllPresets();
        for (const preset of presets) {
            expect(preset.id).toBeTruthy();
            expect(preset.settings.rendering).toBeDefined();
            expect(preset.settings.physics).toBeDefined();
            expect(preset.settings.behavior).toBeDefined();
            expect(preset.settings.scene).toBeDefined();
            expect(preset.settings.network).toBeDefined();
            expect(preset.settings.scheduler).toBeDefined();
            expect(typeof preset.settings.rendering.pixelRatio).toBe("number");
            expect(typeof preset.settings.physics.updateRate).toBe("number");
            expect(typeof preset.settings.physics.maxStepsPerFrame).toBe("number");
            expect(preset.settings.physics.solverIterations).toBeGreaterThanOrEqual(1);
            expect(preset.settings.physics.solverIterations).toBeLessThanOrEqual(8);
            expect(typeof preset.settings.scene.viewDistance).toBe("number");
        }
    });

    it("presets default to the legacy sequential update loop", () => {
        const presets = QualityPresets.getAllPresets();
        for (const preset of presets) {
            expect(preset.settings.scheduler.enabled, `${preset.id} should keep the retired frame scheduler disabled`).toBe(false);
        }
    });

    it("default preset should be medium", () => {
        const defaultPreset = QualityPresets.getDefault();
        expect(defaultPreset.id).toBe("medium");
    });
});
