
import {PCFSoftShadowMap} from "three";

import Config from "../config";

/**
 * Configuration options
 *
 * @param options Configuration options
 */
interface VRSetting {
    cameraPosX: number;
    cameraPosY: number;
    cameraPosZ: number;
    cameraRotateX: number;
    cameraRotateY: number;
    cameraRotateZ: number;
}

export interface ApplicationPropsOptions {
    server?: string;
    sceneType?: string;
    enableCache?: boolean;
    isPlayModeOnly?: boolean; // Whether the application is in play mode only
    saveChild?: boolean;
    saveMaterial?: boolean;
    shadowMapType?: number;
    shadowRadius?: number;
    shadowBlurSamples?: number;
    /** @deprecated Three.js no longer uses renderer.gammaFactor; retained as a no-op input for API compatibility. */
    gammaFactor?: number;
    hueRotate?: number;
    saturate?: number;
    brightness?: number;
    blur?: number;
    contrast?: number;
    grayscale?: number;
    invert?: number;
    sepia?: number;
    enablePhysics?: boolean;
    enableVR?: boolean;
    vrSetting?: VRSetting;
}

class ApplicationProps {
    server: string;
    sceneType: string;
    enableCache: boolean;
    isPlayModeOnly: boolean;
    saveChild: boolean;
    saveMaterial: boolean;
    shadowMapType: number;
    shadowRadius: number;
    shadowBlurSamples: number;
    /** @deprecated Three.js no longer uses renderer.gammaFactor; retained as a no-op input for API compatibility. */
    gammaFactor: number;
    hueRotate: number;
    saturate: number;
    brightness: number;
    blur: number;
    contrast: number;
    grayscale: number;
    invert: number;
    sepia: number;
    enablePhysics: boolean;
    enableVR: boolean;
    vrSetting: VRSetting;
    defaultValues = {
        server: Config.server_host,
        sceneType: "Empty",
        enableCache: false,
        saveChild: false,
        saveMaterial: false,
        shadowMapType: PCFSoftShadowMap,
        shadowRadius: 1,
        shadowBlurSamples: 8,
        gammaFactor: 2.0,
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

    constructor(options: ApplicationPropsOptions = {}) {
        // Server configuration
        this.server = options.server ?? this.defaultValues.server;

        this.sceneType = options.sceneType ?? this.defaultValues.sceneType;

        this.enableCache = options.enableCache ?? this.defaultValues.enableCache;
        this.isPlayModeOnly = options.isPlayModeOnly ?? false;
        this.saveChild = options.saveChild ?? this.defaultValues.saveChild;

        // Save internal sub-component materials of the model
        this.saveMaterial = options.saveMaterial ?? this.defaultValues.saveMaterial;

        // Shadow configuration
        this.shadowMapType = options.shadowMapType ?? this.defaultValues.shadowMapType;
        this.shadowRadius = options.shadowRadius ?? this.defaultValues.shadowRadius;
        this.shadowBlurSamples = options.shadowBlurSamples ?? this.defaultValues.shadowBlurSamples;
        this.gammaFactor = options.gammaFactor ?? this.defaultValues.gammaFactor;

        // Filters
        this.hueRotate = options.hueRotate ?? this.defaultValues.hueRotate;
        this.saturate = options.saturate ?? this.defaultValues.saturate;
        this.brightness = options.brightness ?? this.defaultValues.brightness;
        this.blur = options.blur ?? this.defaultValues.blur;
        this.contrast = options.contrast ?? this.defaultValues.contrast;
        this.grayscale = options.grayscale ?? this.defaultValues.grayscale;
        this.invert = options.invert ?? this.defaultValues.invert;
        this.sepia = options.sepia ?? this.defaultValues.sepia;

        // Physics engine
        this.enablePhysics = options.enablePhysics ?? this.defaultValues.enablePhysics; // Enable physics engine

        // VR
        this.enableVR = options.enableVR ?? this.defaultValues.enableVR;
        this.vrSetting = options.vrSetting ?? this.defaultValues.vrSetting;
    }
}

export default ApplicationProps;
