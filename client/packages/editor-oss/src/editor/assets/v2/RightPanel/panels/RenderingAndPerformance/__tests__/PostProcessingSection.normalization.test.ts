import {describe, expect, it} from "vitest";

import {normalizePostProcessingConfig} from "../../../../../../../render/postprocessing/normalizePostProcessingConfig";

describe("PostProcessingSection control normalization", () => {
    it("shows untouched AO and outline controls disabled", () => {
        const controls = normalizePostProcessingConfig({});

        expect(controls.ao.enabled).toBe(false);
        expect(controls.outline.enabled).toBe(false);
    });

    it("inherits defaults only for the serialized feature", () => {
        const controls = normalizePostProcessingConfig({
            bloom: {enabled: true, strength: 0.6},
        });

        expect(controls.bloom.enabled).toBe(true);
        expect(controls.bloom.strength).toBe(0.6);
        expect(controls.bloom.radius).toBeTypeOf("number");
        expect(controls.ao.enabled).toBe(false);
        expect(controls.outline.enabled).toBe(false);
    });

    it("keeps a parameter-only serialized feature's enable default", () => {
        const controls = normalizePostProcessingConfig({
            ao: {samples: 16},
        });

        expect(controls.ao.enabled).toBe(true);
        expect(controls.ao.samples).toBe(16);
        expect(controls.outline.enabled).toBe(false);
    });
});
