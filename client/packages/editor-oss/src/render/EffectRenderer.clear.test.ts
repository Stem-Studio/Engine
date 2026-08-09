import {describe, expect, it, vi} from "vitest";

import EffectRenderer from "./EffectRenderer";

const renderSubstageGlobals = globalThis as typeof globalThis & {
    __STEM_RENDER_SUBSTAGE_DIAG_ENABLED__?: boolean;
    __STEM_RENDER_SUBSTAGE_DIAGNOSTICS__?: {
        sampleCount: number;
        latest?: {phases?: Record<string, number>};
    };
};

function createRendererHarness({ready}: {ready: boolean}) {
    const renderer = Object.create(EffectRenderer.prototype) as EffectRenderer;
    const clear = vi.fn();
    const renderPipeline = {render: vi.fn()};

    Object.assign(renderer, {
        ready,
        scene: {background: null, userData: {}},
        camera: {},
        renderer: {
            clear,
            getPixelRatio: vi.fn(() => 1),
            toneMapping: 0,
            toneMappingExposure: 1,
        },
        renderPipeline: ready ? renderPipeline : null,
        _lastToneMapping: 0,
        _lastToneMappingExposure: 1,
        _canvasSize: {w: 1280, h: 720},
        batchEnabled: false,
        batchManager: null,
        sparkLighting: null,
        ensureSparkRuntimeIfNeeded: vi.fn(),
        isRuntimeSceneRevealActive: vi.fn(() => false),
        shouldSyncCSS3DObjects: vi.fn(() => false),
        updateSceneMatricesForRender: vi.fn(() => false),
        resize: vi.fn(),
        updateBatches: vi.fn(),
        shouldRenderCSS3D: vi.fn(() => false),
        _standardRender: vi.fn(),
    });

    return {renderer, clear, renderPipeline};
}

describe("EffectRenderer frame clearing", () => {
    afterEach(() => {
        delete renderSubstageGlobals.__STEM_RENDER_SUBSTAGE_DIAG_ENABLED__;
        delete renderSubstageGlobals.__STEM_RENDER_SUBSTAGE_DIAGNOSTICS__;
    });

    it("clears null-background scenes before fallback rendering", () => {
        const {renderer, clear} = createRendererHarness({ready: false});

        renderer.render();

        expect(clear).toHaveBeenCalledTimes(1);
        expect(renderer._standardRender).toHaveBeenCalledTimes(1);
    });

    it("clears null-background scenes before post-processing", () => {
        const {renderer, clear, renderPipeline} = createRendererHarness({ready: true});

        renderer.render();

        expect(clear).toHaveBeenCalledTimes(1);
        expect(renderPipeline.render).toHaveBeenCalledTimes(1);
    });

    it("keeps render-substage tracing opt-in and records the pipeline phase", () => {
        const {renderer, renderPipeline} = createRendererHarness({ready: true});
        renderSubstageGlobals.__STEM_RENDER_SUBSTAGE_DIAG_ENABLED__ = true;

        renderer.render();

        expect(renderPipeline.render).toHaveBeenCalledTimes(1);
        expect(renderSubstageGlobals.__STEM_RENDER_SUBSTAGE_DIAGNOSTICS__?.sampleCount).toBe(1);
        expect(renderSubstageGlobals.__STEM_RENDER_SUBSTAGE_DIAGNOSTICS__?.latest?.phases?.pipelineRender)
            .toBeGreaterThanOrEqual(0);

        delete renderSubstageGlobals.__STEM_RENDER_SUBSTAGE_DIAG_ENABLED__;
        renderer.render();
        expect(renderSubstageGlobals.__STEM_RENDER_SUBSTAGE_DIAGNOSTICS__?.sampleCount).toBe(1);
    });
});
