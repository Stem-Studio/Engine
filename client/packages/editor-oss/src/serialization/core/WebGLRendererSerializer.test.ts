import {afterEach, describe, expect, it, vi} from "vitest";

vi.mock("three", () => {
    class WebGLRenderer {
        autoClear = true;
        autoClearColor = true;
        autoClearDepth = true;
        autoClearStencil = true;
        autoUpdateScene = true;
        clippingPlanes = [];
        localClippingEnabled = false;
        shadowMap = {
            autoUpdate: true,
            enabled: false,
            type: 0,
        };
        sortObjects = true;
        toneMapping = 0;
        toneMappingExposure = 1;

        constructor(_options?: unknown) {}
    }

    return {WebGLRenderer};
});

import WebGLRendererSerializer from "./WebGLRendererSerializer";

describe("WebGLRendererSerializer", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("does not write renderer fields removed from modern Three.js", () => {
        const stringify = vi.spyOn(JSON, "stringify");
        const renderer = {
            autoClear: true,
            autoClearColor: true,
            autoClearDepth: true,
            autoClearStencil: true,
            autoUpdateScene: true,
            clippingPlanes: [],
            gammaFactor: 2,
            localClippingEnabled: false,
            physicallyCorrectLights: false,
            shadowMap: {
                autoUpdate: true,
                enabled: false,
                type: 0,
            },
            sortObjects: true,
            toneMapping: 0,
            toneMappingExposure: 1,
        };

        const json = new WebGLRendererSerializer().toJSON(renderer);

        expect(stringify).not.toHaveBeenCalled();
        expect(json).not.toHaveProperty("gammaFactor");
        expect(json).not.toHaveProperty("physicallyCorrectLights");
        expect(json).not.toHaveProperty("autoUpdateScene");
    });

    it("ignores legacy renderer fields while loading old scene json", () => {
        const renderer = {
            autoClear: true,
            autoClearColor: true,
            autoClearDepth: true,
            autoClearStencil: true,
            autoUpdateScene: true,
            clippingPlanes: [],
            gammaFactor: 2,
            localClippingEnabled: false,
            physicallyCorrectLights: false,
            shadowMap: {
                autoUpdate: true,
                enabled: false,
                type: 0,
            },
            sortObjects: true,
            toneMapping: 0,
            toneMappingExposure: 1,
        };

        const result = new WebGLRendererSerializer().fromJSON(
            {
                autoUpdateScene: false,
                gammaFactor: 1.8,
                physicallyCorrectLights: true,
                toneMappingExposure: 2,
            },
            renderer,
        );

        expect(result.toneMappingExposure).toBe(2);
        expect(result).not.toHaveProperty("gammaFactor");
        expect(result).not.toHaveProperty("physicallyCorrectLights");
        expect(result).not.toHaveProperty("autoUpdateScene");
    });
});
