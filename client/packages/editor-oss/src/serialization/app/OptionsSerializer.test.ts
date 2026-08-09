import {afterEach, describe, expect, it, vi} from "vitest";

import OptionsSerializer from "./OptionsSerializer";

const makeOptions = (overrides: Record<string, unknown> = {}) => {
    const defaultValues = {
        server: "https://source.example",
        sceneType: "Empty",
        shadowMapType: 2,
        shadowRadius: 1,
        shadowBlurSamples: 8,
        gammaFactor: 2,
        hueRotate: 0,
        saturate: 1,
        brightness: 1,
        blur: 0,
        contrast: 1,
        grayscale: 0,
        invert: 0,
        sepia: 0,
        enablePhysics: true,
        enableVR: false,
        vrSetting: {
            cameraPosX: 0,
            cameraPosY: 0,
            cameraPosZ: 0,
            cameraRotateX: 0,
            cameraRotateY: 0,
            cameraRotateZ: 0,
        },
    };

    return {
        ...defaultValues,
        defaultValues,
        ...overrides,
    };
};

describe("OptionsSerializer", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("omits defaults without stringifying every option", () => {
        const stringify = vi.spyOn(JSON, "stringify");
        const options = makeOptions({
            vrSetting: {
                cameraPosX: 0,
                cameraPosY: 0,
                cameraPosZ: 0,
                cameraRotateX: 0,
                cameraRotateY: 0,
                cameraRotateZ: 0,
            },
        });

        const json = new OptionsSerializer().toJSON(options) as any;

        expect(stringify).not.toHaveBeenCalled();
        expect(json.server).toBe("https://source.example");
        expect(json.sceneType).toBeUndefined();
        expect(json.vrSetting).toBeUndefined();
        expect(json.defaultValues).toBeUndefined();
    });

    it("serializes live non-default options and drops retired renderer fields", () => {
        const options = makeOptions({
            gammaFactor: 1.8,
            hueRotate: 45,
            enableVR: true,
            vrSetting: {
                cameraPosX: 1,
                cameraPosY: 2,
                cameraPosZ: 3,
                cameraRotateX: 0.1,
                cameraRotateY: 0.2,
                cameraRotateZ: 0.3,
            },
        });

        const json = new OptionsSerializer().toJSON(options) as any;

        expect(json.gammaFactor).toBeUndefined();
        expect(json.hueRotate).toBe(45);
        expect(json.enableVR).toBe(true);
        expect(json.vrSetting).toEqual({
            cameraPosX: 1,
            cameraPosY: 2,
            cameraPosZ: 3,
            cameraRotateX: 0.1,
            cameraRotateY: 0.2,
            cameraRotateZ: 0.3,
        });
    });

    it("ignores metadata and retired/no-load fields when reading legacy option JSON", () => {
        const options = new OptionsSerializer().fromJSON({
            metadata: {generator: "OptionsSerializer"},
            server: "https://legacy.example",
            isPlayModeOnly: true,
            gammaFactor: 1.8,
            enableVR: true,
            brightness: 1.25,
        }) as any;

        expect(options).toEqual({
            enableVR: true,
            brightness: 1.25,
        });
    });
});
