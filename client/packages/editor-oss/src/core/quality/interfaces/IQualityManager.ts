/**
 * Core quality management interface following SOLID principles
 */

export interface IQualityLevel {
    name: string;
    value: number; // 0-1 normalized quality value
    displayName: string;
    description: string;
}

export interface IQualityPreset {
    id: string;
    name: string;
    displayName: string;
    description?: string;
    settings: IQualitySettings;
}

// Right now, we support only
// rendering: {
//     pixelRatio: number;
//     postProcessing: boolean;
// }

export interface IQualitySettings {
    // Rendering Quality
    rendering: {
        pixelRatio: number;
        shadowQuality: 'none' | 'low' | 'medium' | 'high' | 'ultra';
        antialiasing: 'none' | 'fxaa' | 'smaa' | 'taa' | 'msaa';
        antialiasingQuality: 'low' | 'medium' | 'high';
        postProcessing: boolean;
        ssao: boolean;
        ssaoQuality: 'low' | 'medium' | 'high';
        reflections: boolean;
        reflectionQuality: 'low' | 'medium' | 'high';
        bloom: boolean;
        bloomQuality: 'low' | 'medium' | 'high';
        volumetricLighting: boolean;
        ambientOcclusion: boolean;
        textureQuality: 'low' | 'medium' | 'high' | 'ultra';
        textureAnisotropy: number;
        lodBias: number;
        maxLights: number;
        /** @deprecated No module or consumer reads this field */
        useInstancing: boolean;
    };

    // Physics Quality
    physics: {
        updateRate: number; // Hz
        substeps: number;
        maxStepsPerFrame: number;
        /** Constraint solver iterations per fixed substep (Ammo/Rapier). */
        solverIterations?: number;
    };

    // Behavior Quality
    behavior: {
        updateRate: number; // Hz
        maxConcurrentBehaviors: number;
        /** @deprecated No module or consumer reads this field */
        aiUpdateRate: number;
        /** @deprecated No module or consumer reads this field */
        aiLodDistance: number;
        /** @deprecated No module or consumer reads this field */
        particleQuality: 'low' | 'medium' | 'high';
        /** @deprecated No module or consumer reads this field */
        maxParticles: number;
    };

    scene: {
        viewDistance: number;
        lodDistances: number[];
        /** @deprecated Preset data only; no runtime hard cap enforces this field */
        maxDrawCalls: number;
        /** Runtime-only InstancedMesh density target for generated content. */
        maxTriangles: number;
        cullingAggressiveness: number;
        /** @deprecated No module or consumer reads this field */
        dynamicBatching: boolean;
        /** @deprecated No module or consumer reads this field */
        staticBatching: boolean;
        /** @deprecated No module or consumer reads this field */
        occlusionCulling: boolean;
    };

    // Runtime budget coordination. Optional so existing presets can keep
    // inheriting device-derived defaults.
    runtimeBudget?: {
        enabled?: boolean;
        managedTextureTargetMB?: number;
        mobileManagedTextureTargetMB?: number;
        desktopManagedTextureTargetMB?: number;
        warningRatio?: number;
        criticalRatio?: number;
        recoveryRatio?: number;
    };

    /** @deprecated No module or consumer reads these network fields */
    network: {
        updateRate: number;
        interpolationQuality: 'low' | 'medium' | 'high';
        predictionQuality: 'low' | 'medium' | 'high';
        maxPlayers: number;
    };

    // Retired frame-scheduler metadata retained for saved-scene/API compatibility.
    scheduler: {
        enabled: boolean;
        frameBudgetMs: number;
        fixedTimestepHz: number;
        maxFixedStepsPerFrame: number;
        spatialGridCellSize: number;
        renderPressureThreshold: number;
        deltaTimePressureThreshold: number;
    };
}

export interface IPerformanceMetrics {
    fps: number;
    frameTime: number;
    cpuTime: number;
    gpuTime: number;
    drawCalls: number;
    triangles: number;
    textureMemory: number;
    geometryMemory: number;
    totalMemory: number;
    networkLatency?: number;
    batteryLevel?: number;
    thermalState?: 'nominal' | 'fair' | 'serious' | 'critical';
}

export interface IQualityModule {
    name: string;
    initialize(settings: IQualitySettings): Promise<void>;
    applySettings(settings: IQualitySettings): Promise<void>;
    getMetrics(): Partial<IPerformanceMetrics>;
    dispose(): void;
}

export interface IQualityChangeEvent {
    previousSettings: IQualitySettings;
    newSettings: IQualitySettings;
    reason: 'manual' | 'auto' | 'performance' | 'thermal' | 'battery' | 'network';
    timestamp: number;
}

export interface IQualityManager {
    // Core functionality
    initialize(): Promise<void>;
    dispose(): void;

    // Settings management
    getCurrentSettings(): IQualitySettings;
    /** Returns user-configured settings WITHOUT runtime rendering overrides. */
    getConfiguredSettings(): IQualitySettings;
    setSettings(settings: Partial<IQualitySettings>, options?: { persist?: boolean }): Promise<void>;
    setRuntimeRenderingOverride(override: Partial<IQualitySettings['rendering']> | null): void;
    applyPreset(presetId: string, options?: { persist?: boolean }): Promise<void>;
    getPresets(): IQualityPreset[];
    createCustomPreset(name: string, settings: IQualitySettings): IQualityPreset;

    // Performance monitoring
    getPerformanceMetrics(): IPerformanceMetrics;

    // Module management
    registerModule(module: IQualityModule): void;
    unregisterModule(moduleName: string): void;

    // Events
    on(event: 'qualityChanged', callback: (event: IQualityChangeEvent) => void): void;
    off(event: 'qualityChanged', callback: (event: IQualityChangeEvent) => void): void;

    // Device capabilities
    detectDeviceCapabilities(): Promise<IQualitySettings>;
    getRecommendedSettings(): IQualitySettings;

    // Persistence
    saveSettings(): Promise<void>;
    loadSettings(): Promise<void>;
}
