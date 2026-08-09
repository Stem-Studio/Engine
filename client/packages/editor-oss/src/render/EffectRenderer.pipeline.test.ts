import {
    ACESFilmicToneMapping,
    NoToneMapping,
    PerspectiveCamera,
    Scene,
    SRGBColorSpace,
} from "three";
import {
    RenderOutputNode,
    type MRTNode,
    type PassNode,
    type RenderPipeline,
} from "three/webgpu";
import {afterEach, describe, expect, it} from "vitest";

import EffectRenderer, {
    getPostProcessingPrepassRequirements,
    normalizePostProcessingConfig,
} from "./EffectRenderer";

const builtRenderers: EffectRenderer[] = [];

type PipelineNodes = {
    prePass: PassNode | null;
    scenePass: PassNode | null;
};

function getPipelineNodes(renderer: EffectRenderer): PipelineNodes {
    return renderer.nodes as unknown as PipelineNodes;
}

function requirePrePass(renderer: EffectRenderer): PassNode {
    const prePass = getPipelineNodes(renderer).prePass;
    expect(prePass).not.toBeNull();
    if (prePass === null) {
        throw new Error("Expected the post-processing pipeline to construct a prepass.");
    }
    return prePass;
}

function requireMRT(renderer: EffectRenderer): MRTNode {
    const mrt = requirePrePass(renderer).getMRT();
    expect(mrt).not.toBeNull();
    if (mrt === null) {
        throw new Error("Expected the post-processing prepass to configure MRT outputs.");
    }
    return mrt;
}

function requireRenderPipeline(renderer: EffectRenderer): RenderPipeline {
    const pipeline = renderer.renderPipeline as RenderPipeline | null;
    expect(pipeline).not.toBeNull();
    if (pipeline === null) {
        throw new Error("Expected the post-processing pipeline to be constructed.");
    }
    return pipeline;
}

function buildPipeline(postProcessing: Record<string, unknown>) {
    const effectRenderer = new EffectRenderer();
    effectRenderer.scene = new Scene();
    effectRenderer.scene.userData.postProcessing = postProcessing;
    effectRenderer.camera = new PerspectiveCamera();
    effectRenderer.renderer = {
        toneMapping: NoToneMapping,
        toneMappingExposure: 1,
        outputColorSpace: SRGBColorSpace,
    };
    effectRenderer._createNodePipeline();
    builtRenderers.push(effectRenderer);
    return effectRenderer;
}

describe("EffectRenderer post-processing prepass requirements", () => {
    afterEach(() => {
        for (const renderer of builtRenderers.splice(0)) {
            renderer.renderPipeline?.dispose();
            const nodes = getPipelineNodes(renderer);
            nodes.prePass?.renderTarget.dispose();
            nodes.scenePass?.renderTarget.dispose();
        }
    });

    it("normalizes empty and explicitly disabled settings to no active effects", () => {
        const empty = normalizePostProcessingConfig({});
        expect(empty.ao.enabled).toBe(false);
        expect(empty.outline.enabled).toBe(false);
        expect(new EffectRenderer().shouldUsePostProcessingPipeline(empty)).toBe(false);

        const disabled = normalizePostProcessingConfig({
            enabled: false,
            ao: {enabled: true},
            bloom: {enabled: true},
        });
        expect(disabled.ao.enabled).toBe(false);
        expect(disabled.bloom.enabled).toBe(false);
        expect(new EffectRenderer().shouldUsePostProcessingPipeline(disabled)).toBe(false);
    });

    it("keeps an explicit partial bloom config color-only", () => {
        const normalized = normalizePostProcessingConfig({
            bloom: {enabled: true, strength: 0.4},
        });

        expect(normalized.bloom.enabled).toBe(true);
        expect(normalized.ao.enabled).toBe(false);
        expect(normalized.outline.enabled).toBe(false);
        expect(getPostProcessingPrepassRequirements(normalized).depth).toBe(false);

        const renderer = buildPipeline({bloom: {enabled: true, strength: 0.4}});
        expect(renderer.nodes.bloomPass).not.toBeNull();
        expect(renderer.nodes.aoPass).toBeNull();
        expect(renderer.nodes.prePass).toBeNull();
    });

    it("does not request geometry inputs for color-only effects", () => {
        expect(getPostProcessingPrepassRequirements({
            bloom: {enabled: true},
            lut: {enabled: true},
            film: {enabled: true},
            chromaticAberration: {enabled: true},
            outline: {enabled: true},
        })).toEqual({
            depth: false,
            normal: false,
            ssrMask: false,
            roughness: false,
        });
    });

    it("requests only depth for depth of field", () => {
        expect(getPostProcessingPrepassRequirements({
            dof: {enabled: true},
        })).toEqual({
            depth: true,
            normal: false,
            ssrMask: false,
            roughness: false,
        });

        const renderer = buildPipeline({dof: {enabled: true}});
        const mrt = requireMRT(renderer);
        expect(renderer.nodes.prePass).not.toBeNull();
        expect(mrt.has("normal")).toBe(false);
        expect(mrt.has("ssrMask")).toBe(false);
        expect(mrt.has("roughness")).toBe(false);
    });

    it("requests depth and normals for ambient occlusion", () => {
        expect(getPostProcessingPrepassRequirements({
            ao: {enabled: true},
        })).toEqual({
            depth: true,
            normal: true,
            ssrMask: false,
            roughness: false,
        });

        const renderer = buildPipeline({ao: {enabled: true}});
        const mrt = requireMRT(renderer);
        expect(renderer.nodes.aoPass).not.toBeNull();
        expect(mrt.has("normal")).toBe(true);
        expect(mrt.has("ssrMask")).toBe(false);
        expect(mrt.has("roughness")).toBe(false);
    });

    it("only requests roughness for blurred SSR", () => {
        expect(getPostProcessingPrepassRequirements({
            ssr: {enabled: true, blur: false},
        })).toEqual({
            depth: true,
            normal: true,
            ssrMask: true,
            roughness: false,
        });
        expect(getPostProcessingPrepassRequirements({
            ssr: {enabled: true, blur: true},
        })).toEqual({
            depth: true,
            normal: true,
            ssrMask: true,
            roughness: true,
        });

        const unblurred = buildPipeline({ssr: {enabled: true, blur: false}});
        const unblurredMrt = requireMRT(unblurred);
        expect(unblurredMrt.has("normal")).toBe(true);
        expect(unblurredMrt.has("ssrMask")).toBe(true);
        expect(unblurredMrt.has("roughness")).toBe(false);

        const blurred = buildPipeline({ssr: {enabled: true, blur: true}});
        const blurredMrt = requireMRT(blurred);
        expect(blurredMrt.has("normal")).toBe(true);
        expect(blurredMrt.has("ssrMask")).toBe(true);
        expect(blurredMrt.has("roughness")).toBe(true);
    });

    it("delegates the sole final tone and color transform to RenderPipeline", () => {
        const noToneMapping = buildPipeline({bloom: {enabled: true}});
        const pipeline = requireRenderPipeline(noToneMapping);
        expect(pipeline.outputColorTransform).toBe(true);
        // The effect chain itself must remain in working color space. The
        // public RenderPipeline flag adds the sole RenderOutputNode at render.
        expect(pipeline.outputNode).not.toBeInstanceOf(RenderOutputNode);

        noToneMapping.renderer.toneMapping = ACESFilmicToneMapping;
        noToneMapping.renderer.toneMappingExposure = 1.25;
        noToneMapping.updatePipelineOutput();

        expect(pipeline.outputColorTransform).toBe(true);
        expect(pipeline.outputNode).not.toBeInstanceOf(RenderOutputNode);
        expect(noToneMapping.renderer.toneMapping).toBe(ACESFilmicToneMapping);
        expect(noToneMapping.renderer.toneMappingExposure).toBe(1.25);
    });
});
