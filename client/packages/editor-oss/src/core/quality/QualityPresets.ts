import type { IQualityPreset } from './interfaces/IQualityManager';

/**
 * Industry-standard quality presets for different performance tiers
 */
export class QualityPresets {
    private static presets: Map<string, IQualityPreset> = new Map();

    static {
        // Initialize built-in presets
        QualityPresets.initializePresets();
    }

    /**
     * Get a preset for a specific lane and rung index.
     * Returns undefined if the lane preset doesn't exist.
     * @param lanePresetId
     */
    public static getPresetForLane(lanePresetId: string): IQualityPreset | undefined {
        return this.presets.get(lanePresetId);
    }

    private static initializePresets(): void {
        // Ultra Quality - For high-end desktop GPUs
        this.addPreset({
            id: 'ultra',
            name: 'ultra',
            displayName: 'Ultra',
            settings: {
                rendering: {
                    pixelRatio: 1.0,
                    shadowQuality: 'ultra',
                    antialiasing: 'taa',
                    antialiasingQuality: 'high',
                    postProcessing: true,
                    ssao: true,
                    ssaoQuality: 'high',
                    reflections: true,
                    reflectionQuality: 'high',
                    bloom: true,
                    bloomQuality: 'high',
                    volumetricLighting: true,
                    ambientOcclusion: true,
                    textureQuality: 'ultra',
                    textureAnisotropy: 16,
                    lodBias: 0,
                    maxLights: 32,
                    useInstancing: true,
                },
                physics: {
                    updateRate: 60,
                    substeps: 1,
                    maxStepsPerFrame: 3,
                    solverIterations: 8,
                },
                behavior: {
                    updateRate: 60,
                    maxConcurrentBehaviors: 200,
                    aiUpdateRate: 30,
                    aiLodDistance: 200,
                    particleQuality: 'high',
                    maxParticles: 10000,
                },
                scene: {
                    viewDistance: 1000,
                    lodDistances: [50, 150, 300, 500],
                    maxDrawCalls: 5000,
                    maxTriangles: 10000000,
                    cullingAggressiveness: 0.8,
                    dynamicBatching: true,
                    staticBatching: true,
                    occlusionCulling: true,
                },
                network: {
                    updateRate: 60,
                    interpolationQuality: 'high',
                    predictionQuality: 'high',
                    maxPlayers: 100,
                },
                scheduler: {
                    enabled: false,
                    frameBudgetMs: 14,
                    fixedTimestepHz: 60,
                    maxFixedStepsPerFrame: 3,
                    spatialGridCellSize: 25,
                    renderPressureThreshold: 0.7,
                    deltaTimePressureThreshold: 1.5,
                },
            },
        });

        // High Quality - For mid-range desktop GPUs
        this.addPreset({
            id: 'high',
            name: 'high',
            displayName: 'High',
            settings: {
                rendering: {
                    pixelRatio: 1.0,
                    shadowQuality: 'high',
                    antialiasing: 'smaa',
                    antialiasingQuality: 'medium',
                    postProcessing: true,
                    ssao: true,
                    ssaoQuality: 'medium',
                    reflections: true,
                    reflectionQuality: 'medium',
                    bloom: true,
                    bloomQuality: 'medium',
                    volumetricLighting: false,
                    ambientOcclusion: true,
                    textureQuality: 'high',
                    textureAnisotropy: 8,
                    lodBias: 0,
                    maxLights: 16,
                    useInstancing: true,
                },
                physics: {
                    updateRate: 60,
                    substeps: 1,
                    maxStepsPerFrame: 3,
                    solverIterations: 6,
                },
                behavior: {
                    updateRate: 60,
                    maxConcurrentBehaviors: 100,
                    aiUpdateRate: 20,
                    aiLodDistance: 150,
                    particleQuality: 'medium',
                    maxParticles: 5000,
                },
                scene: {
                    viewDistance: 750,
                    lodDistances: [40, 120, 240, 400],
                    maxDrawCalls: 3000,
                    maxTriangles: 5000000,
                    cullingAggressiveness: 0.85,
                    dynamicBatching: true,
                    staticBatching: true,
                    occlusionCulling: true,
                },
                network: {
                    updateRate: 60,
                    interpolationQuality: 'medium',
                    predictionQuality: 'medium',
                    maxPlayers: 50,
                },
                scheduler: {
                    enabled: false,
                    frameBudgetMs: 14,
                    fixedTimestepHz: 60,
                    maxFixedStepsPerFrame: 3,
                    spatialGridCellSize: 25,
                    renderPressureThreshold: 0.6,
                    deltaTimePressureThreshold: 1.35,
                },
            },
        });

        // Medium Quality - For integrated graphics and lower-end GPUs
        this.addPreset({
            id: 'medium',
            name: 'medium',
            displayName: 'Medium',
            settings: {
                rendering: {
                    pixelRatio: 0.9,
                    shadowQuality: 'medium',
                    antialiasing: 'fxaa',
                    antialiasingQuality: 'low',
                    postProcessing: true,
                    ssao: false,
                    ssaoQuality: 'low',
                    reflections: false,
                    reflectionQuality: 'low',
                    bloom: true,
                    bloomQuality: 'low',
                    volumetricLighting: false,
                    ambientOcclusion: false,
                    textureQuality: 'medium',
                    textureAnisotropy: 4,
                    lodBias: 1,
                    maxLights: 8,
                    useInstancing: true,
                },
                physics: {
                    updateRate: 30,
                    substeps: 1,
                    maxStepsPerFrame: 3,
                    solverIterations: 4,
                },
                behavior: {
                    updateRate: 30,
                    maxConcurrentBehaviors: 50,
                    aiUpdateRate: 10,
                    aiLodDistance: 100,
                    particleQuality: 'low',
                    maxParticles: 2000,
                },
                scene: {
                    viewDistance: 500,
                    lodDistances: [30, 90, 180, 300],
                    maxDrawCalls: 1500,
                    maxTriangles: 2000000,
                    cullingAggressiveness: 0.9,
                    dynamicBatching: true,
                    staticBatching: true,
                    occlusionCulling: false,
                },
                network: {
                    updateRate: 30,
                    interpolationQuality: 'low',
                    predictionQuality: 'low',
                    maxPlayers: 25,
                },
                scheduler: {
                    enabled: false,
                    frameBudgetMs: 14,
                    fixedTimestepHz: 30,
                    maxFixedStepsPerFrame: 3,
                    spatialGridCellSize: 30,
                    renderPressureThreshold: 0.5,
                    deltaTimePressureThreshold: 1.25,
                },
            },
        });

        // Low Quality - For mobile devices and very low-end hardware
        this.addPreset({
            id: 'low',
            name: 'low',
            displayName: 'Low',
            settings: {
                rendering: {
                    pixelRatio: 0.75,
                    shadowQuality: 'low',
                    antialiasing: 'none',
                    antialiasingQuality: 'low',
                    postProcessing: false,
                    ssao: false,
                    ssaoQuality: 'low',
                    reflections: false,
                    reflectionQuality: 'low',
                    bloom: false,
                    bloomQuality: 'low',
                    volumetricLighting: false,
                    ambientOcclusion: false,
                    textureQuality: 'low',
                    textureAnisotropy: 2,
                    lodBias: 2,
                    maxLights: 4,
                    useInstancing: false,
                },
                physics: {
                    updateRate: 30,
                    substeps: 1,
                    maxStepsPerFrame: 2,
                    solverIterations: 3,
                },
                behavior: {
                    updateRate: 20,
                    maxConcurrentBehaviors: 25,
                    aiUpdateRate: 5,
                    aiLodDistance: 50,
                    particleQuality: 'low',
                    maxParticles: 500,
                },
                scene: {
                    viewDistance: 250,
                    lodDistances: [20, 60, 120, 200],
                    maxDrawCalls: 500,
                    maxTriangles: 500000,
                    cullingAggressiveness: 0.95,
                    dynamicBatching: true,
                    staticBatching: false,
                    occlusionCulling: false,
                },
                network: {
                    updateRate: 20,
                    interpolationQuality: 'low',
                    predictionQuality: 'low',
                    maxPlayers: 10,
                },
                scheduler: {
                    enabled: false,
                    frameBudgetMs: 12,
                    fixedTimestepHz: 30,
                    maxFixedStepsPerFrame: 2,
                    spatialGridCellSize: 40,
                    renderPressureThreshold: 0.4,
                    deltaTimePressureThreshold: 1.1,
                },
            },
        });

        // Performance Mode - Minimum quality for maximum FPS
        this.addPreset({
            id: 'performance',
            name: 'performance',
            displayName: 'Performance',
            settings: {
                rendering: {
                    pixelRatio: 0.7,
                    shadowQuality: 'none',
                    antialiasing: 'none',
                    antialiasingQuality: 'low',
                    postProcessing: false,
                    ssao: false,
                    ssaoQuality: 'low',
                    reflections: false,
                    reflectionQuality: 'low',
                    bloom: false,
                    bloomQuality: 'low',
                    volumetricLighting: false,
                    ambientOcclusion: false,
                    textureQuality: 'low',
                    textureAnisotropy: 1,
                    lodBias: 3,
                    maxLights: 2,
                    useInstancing: false,
                },
                physics: {
                    updateRate: 30,
                    substeps: 1,
                    maxStepsPerFrame: 2,
                    solverIterations: 2,
                },
                behavior: {
                    updateRate: 15,
                    maxConcurrentBehaviors: 10,
                    aiUpdateRate: 2,
                    aiLodDistance: 25,
                    particleQuality: 'low',
                    maxParticles: 100,
                },
                scene: {
                    viewDistance: 100,
                    lodDistances: [10, 30, 60, 100],
                    maxDrawCalls: 200,
                    maxTriangles: 100000,
                    cullingAggressiveness: 0.99,
                    dynamicBatching: false,
                    staticBatching: false,
                    occlusionCulling: false,
                },
                network: {
                    updateRate: 15,
                    interpolationQuality: 'low',
                    predictionQuality: 'low',
                    maxPlayers: 5,
                },
                scheduler: {
                    enabled: false,
                    frameBudgetMs: 10,
                    fixedTimestepHz: 30,
                    maxFixedStepsPerFrame: 2,
                    spatialGridCellSize: 50,
                    renderPressureThreshold: 0.3,
                    deltaTimePressureThreshold: 1.0,
                },
            },
        });

        // Mobile Optimized - Aggressive optimizations for mobile devices
        this.addPreset({
            id: 'mobile',
            name: 'mobile',
            displayName: 'Mobile Optimized',
            settings: {
                rendering: {
                    pixelRatio: 0.7,
                    shadowQuality: 'none',
                    antialiasing: 'none',
                    antialiasingQuality: 'low',
                    postProcessing: false,
                    ssao: false,
                    ssaoQuality: 'low',
                    reflections: false,
                    reflectionQuality: 'low',
                    bloom: false,
                    bloomQuality: 'low',
                    volumetricLighting: false,
                    ambientOcclusion: false,
                    textureQuality: 'low',
                    textureAnisotropy: 1,
                    lodBias: 5,
                    maxLights: 2,
                    useInstancing: false,
                },
                physics: {
                    updateRate: 30,
                    substeps: 1,
                    maxStepsPerFrame: 2,
                    solverIterations: 2,
                },
                behavior: {
                    updateRate: 10,
                    maxConcurrentBehaviors: 10,
                    aiUpdateRate: 2,
                    aiLodDistance: 20,
                    particleQuality: 'low',
                    maxParticles: 100,
                },
                scene: {
                    viewDistance: 50,
                    lodDistances: [5, 15, 30, 50],
                    maxDrawCalls: 100,
                    maxTriangles: 25000,
                    cullingAggressiveness: 0.99,
                    dynamicBatching: true,
                    staticBatching: false,
                    occlusionCulling: false,
                },
                network: {
                    updateRate: 10,
                    interpolationQuality: 'low',
                    predictionQuality: 'low',
                    maxPlayers: 5,
                },
                scheduler: {
                    enabled: false,
                    frameBudgetMs: 10,
                    fixedTimestepHz: 30,
                    maxFixedStepsPerFrame: 2,
                    spatialGridCellSize: 50,
                    renderPressureThreshold: 0.3,
                    deltaTimePressureThreshold: 1.0,
                },
            },
        });

        // iOS Optimized - Memory-focused optimizations for iOS devices (iPhone/iPad)
        // Inherits from Medium preset but adjusts key memory-intensive settings
        const mediumPreset = this.presets.get('medium')!;
        this.addPreset({
            id: 'ios',
            name: 'ios',
            displayName: 'iOS Optimized',
            settings: {
                ...mediumPreset.settings,
                rendering: {
                    ...mediumPreset.settings.rendering,
                    pixelRatio: 0.75,
                    textureQuality: 'low',     // Reduced from 'medium' → saves ~75% texture memory
                },
                behavior: {
                    ...mediumPreset.settings.behavior,
                    maxParticles: 1000,        // Reduced from 2000 → saves 50% particle memory
                },
            },
        });

        // --- Lane-specific presets for adaptive quality ---
        this.initializeLanePresets();
    }

    private static initializeLanePresets(): void {
        const ultra = this.presets.get('ultra')!;
        const high = this.presets.get('high')!;
        const medium = this.presets.get('medium')!;
        const low = this.presets.get('low')!;
        const iosBase = this.presets.get('ios')!;

        // Desktop discrete: balanced → high → ultra
        this.addPreset({ id: 'desktop_balanced', name: 'desktop_balanced', displayName: 'Desktop Balanced', settings: { ...medium.settings } });
        this.addPreset({ id: 'desktop_high', name: 'desktop_high', displayName: 'Desktop High', settings: { ...high.settings } });
        this.addPreset({ id: 'desktop_ultra', name: 'desktop_ultra', displayName: 'Desktop Ultra', settings: { ...ultra.settings } });

        // Apple Silicon: balanced → high → ultra
        this.addPreset({
            id: 'apple_silicon_balanced', name: 'apple_silicon_balanced', displayName: 'Apple Silicon Balanced',
            settings: { ...medium.settings, rendering: { ...medium.settings.rendering, pixelRatio: 1.0 } },
        });
        this.addPreset({
            id: 'apple_silicon_high', name: 'apple_silicon_high', displayName: 'Apple Silicon High',
            settings: { ...high.settings, rendering: { ...high.settings.rendering, pixelRatio: 1.0 } },
        });
        this.addPreset({
            id: 'apple_silicon_ultra', name: 'apple_silicon_ultra', displayName: 'Apple Silicon Ultra',
            settings: { ...ultra.settings, rendering: { ...ultra.settings.rendering, pixelRatio: 1.0 } },
        });

        // iOS: balanced → high
        this.addPreset({
            id: 'ios_balanced', name: 'ios_balanced', displayName: 'iOS Balanced',
            settings: { ...iosBase.settings, rendering: { ...iosBase.settings.rendering, pixelRatio: 0.75 } },
        });
        this.addPreset({
            id: 'ios_high', name: 'ios_high', displayName: 'iOS High',
            settings: { ...iosBase.settings },
        });

        // Android: balanced → high
        this.addPreset({
            id: 'android_balanced', name: 'android_balanced', displayName: 'Android Balanced',
            settings: { ...low.settings, rendering: { ...low.settings.rendering, pixelRatio: 0.5 } },
        });
        this.addPreset({
            id: 'android_high', name: 'android_high', displayName: 'Android High',
            settings: { ...medium.settings, rendering: { ...medium.settings.rendering, pixelRatio: 0.75 } },
        });
    }

    private static addPreset(preset: IQualityPreset): void {
        this.presets.set(preset.id, preset);
    }

    public static getPreset(id: string): IQualityPreset | undefined {
        return this.presets.get(id);
    }

    public static getAllPresets(): IQualityPreset[] {
        return Array.from(this.presets.values());
    }

    public static getDefault(): IQualityPreset {
        return this.presets.get('medium')!;
    }

    public static getPresetForDevice(deviceScore: number): IQualityPreset {
        // Device score is 0-1, where 1 is the best
        if (deviceScore >= 0.8) return this.presets.get('ultra')!;
        if (deviceScore >= 0.6) return this.presets.get('high')!;
        if (deviceScore >= 0.4) return this.presets.get('medium')!;
        if (deviceScore >= 0.2) return this.presets.get('low')!;
        return this.presets.get('performance')!;
    }
}
