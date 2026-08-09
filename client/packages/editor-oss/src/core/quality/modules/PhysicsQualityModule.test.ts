import {describe, expect, it, vi} from "vitest";

import {QualityPresets} from "../QualityPresets";
import type {IPhysics} from "@stem/editor-oss/physics/common/types";
import {PhysicsQualityModule} from "./PhysicsQualityModule";

describe("PhysicsQualityModule", () => {
    it("applies fixed-step settings to adapters that own the accumulator", async () => {
        const configureQuality = vi.fn();
        const physics = {configureQuality} as unknown as IPhysics;
        const module = new PhysicsQualityModule();
        const settings = QualityPresets.getPreset("high")!.settings;

        module.setPhysics(physics);
        await module.applySettings(settings);

        expect(configureQuality).toHaveBeenCalledWith(
            settings.physics.updateRate,
            settings.physics.substeps,
            settings.physics.maxStepsPerFrame,
            true,
            true,
            settings.physics.solverIterations,
        );
    });

    it("defers the policy until the physics adapter is connected", async () => {
        const configureQuality = vi.fn();
        const physics = {configureQuality} as unknown as IPhysics;
        const module = new PhysicsQualityModule();
        const settings = QualityPresets.getPreset("mobile")!.settings;

        await module.applySettings(settings);
        expect(configureQuality).not.toHaveBeenCalled();

        module.setPhysics(physics);
        await Promise.resolve();

        expect(configureQuality).toHaveBeenCalledWith(
            settings.physics.updateRate,
            settings.physics.substeps,
            settings.physics.maxStepsPerFrame,
            true,
            true,
            settings.physics.solverIterations,
        );
    });
});
