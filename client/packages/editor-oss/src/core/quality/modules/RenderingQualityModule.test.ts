import {describe, expect, it, vi} from "vitest";

import type EffectRenderer from "../../../render/EffectRenderer";
import type {IQualitySettings} from "../interfaces/IQualityManager";
import {QualityPresets} from "../QualityPresets";
import {RenderingQualityModule} from "./RenderingQualityModule";

function cloneSettings(settings: IQualitySettings): IQualitySettings {
    return JSON.parse(JSON.stringify(settings)) as IQualitySettings;
}

function makeRenderer() {
    const setPixelRatio = vi.fn();
    const renderer = {
        setPixelRatio,
        info: {
            memory: {textures: 0, geometries: 0},
            render: {calls: 0, triangles: 0},
        },
        shadowMap: {enabled: false, type: 0},
        capabilities: {getMaxAnisotropy: () => 8},
    };

    return {
        setPixelRatio,
        effectRenderer: {renderer} as unknown as EffectRenderer,
    };
}

describe("RenderingQualityModule", () => {
    it("applies a reduced pixel ratio without allocating an unused render target", async () => {
        const module = new RenderingQualityModule();
        const {effectRenderer, setPixelRatio} = makeRenderer();
        const settings = cloneSettings(QualityPresets.getPreset("mobile")!.settings);

        module.setRenderer(effectRenderer);
        await module.initialize(settings);

        expect(setPixelRatio).toHaveBeenCalledWith(settings.rendering.pixelRatio);
        expect(module.getDynamicResolutionScale()).toBe(settings.rendering.pixelRatio);
        expect((module as unknown as {renderTarget?: unknown}).renderTarget).toBeUndefined();
    });

    it("keeps the historical scale API as direct renderer pixel-ratio control", async () => {
        const module = new RenderingQualityModule();
        const {effectRenderer, setPixelRatio} = makeRenderer();

        module.setRenderer(effectRenderer);
        await module.initialize(cloneSettings(QualityPresets.getPreset("medium")!.settings));
        setPixelRatio.mockClear();

        module.setDynamicResolutionScale(0.6);

        expect(module.getDynamicResolutionScale()).toBe(0.6);
        expect(setPixelRatio).toHaveBeenCalledWith(0.6);
    });
});
