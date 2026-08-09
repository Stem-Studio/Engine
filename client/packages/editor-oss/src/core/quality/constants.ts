/**
 * Constants for the quality system
 */

// Performance targets
export const DEFAULT_TARGET_FPS = 60;
export const MIN_TARGET_FPS = 30;
export const MAX_TARGET_FPS = 144;

// Update rates (Hz)
export const PHYSICS_UPDATE_RATES = {
    ULTRA: 120,
    HIGH: 60,
    MEDIUM: 30,
    LOW: 20,
    PERFORMANCE: 15,
} as const;

export const BEHAVIOR_UPDATE_RATES = {
    CRITICAL: 60,
    HIGH: 30,
    MEDIUM: 15,
    LOW: 5,
    MINIMAL: 2,
} as const;

// LOD distances (meters)
export const DEFAULT_LOD_DISTANCES = [0, 50, 150, 300];
export const DEFAULT_VIEW_DISTANCE = 500;
export const MIN_VIEW_DISTANCE = 100;
export const MAX_VIEW_DISTANCE = 2000;

// Quality scaling factors
export const RESOLUTION_SCALE_FACTORS = {
    ULTRA: 1.0,
    HIGH: 0.9,
    MEDIUM: 0.75,
    LOW: 0.6,
    PERFORMANCE: 0.5,
} as const;

export const PARTICLE_QUALITY_MULTIPLIERS = {
    ULTRA: 1.0,
    HIGH: 0.75,
    MEDIUM: 0.5,
    LOW: 0.25,
    PERFORMANCE: 0.1,
} as const;

// Performance thresholds
export const FPS_THRESHOLDS = {
    CRITICAL: 20,
    LOW: 30,
    MEDIUM: 45,
    HIGH: 55,
} as const;

export const THERMAL_STATE_VALUES = {
    NOMINAL: 0,
    FAIR: 1,
    SERIOUS: 2,
    CRITICAL: 3,
} as const;

// Memory limits (MB)
export const MEMORY_LIMITS = {
    TEXTURE: {
        ULTRA: 2048,
        HIGH: 1024,
        MEDIUM: 512,
        LOW: 256,
        PERFORMANCE: 128,
    },
    GEOMETRY: {
        ULTRA: 1024,
        HIGH: 512,
        MEDIUM: 256,
        LOW: 128,
        PERFORMANCE: 64,
    },
} as const;

// Timing constants (ms)
export const QUALITY_ADJUSTMENT_COOLDOWN = 2000;
export const PERFORMANCE_SAMPLE_INTERVAL = 100;
export const AUTO_QUALITY_UPDATE_INTERVAL = 1000;

// IndexedDB constants
export const QUALITY_DB_NAME = 'QualitySystemDB';
export const QUALITY_DB_VERSION = 1;
export const STORAGE_KEY_PREFIX = 'stemstudio_quality_';

// Shadow map resolutions
export const SHADOW_MAP_SIZES = {
    ULTRA: 4096,
    HIGH: 2048,
    MEDIUM: 1024,
    LOW: 512,
    NONE: 0,
} as const;

// Texture anisotropy levels
export const ANISOTROPY_LEVELS = {
    ULTRA: 16,
    HIGH: 8,
    MEDIUM: 4,
    LOW: 2,
    PERFORMANCE: 1,
} as const;

/**
 * Quality System Constants
 */

import type { IQualitySettings } from './interfaces/IQualityManager';

/**
 * Performance monitoring intervals and thresholds
 */
export const PERFORMANCE_CONSTANTS = {
    // FPS monitoring
    FPS_SAMPLE_WINDOW: 10,
    FPS_UPDATE_INTERVAL: 100, // ms
    
    // Memory monitoring
    MEMORY_UPDATE_INTERVAL: 5000, // ms
    MEMORY_WARNING_THRESHOLD: 500, // MB
    MEMORY_CRITICAL_THRESHOLD: 800, // MB
    
    // CPU monitoring
    CPU_SAMPLE_COUNT: 60,
    CPU_WARNING_THRESHOLD: 80, // percentage
    
    // Draw calls and triangles
    MAX_DRAW_CALLS_WARNING: 3000,
    MAX_TRIANGLES_WARNING: 5000000,
} as const;

/**
 * Auto-quality adjustment parameters
 */
export const AUTO_QUALITY_CONSTANTS = {
    // Target FPS thresholds
    TARGET_FPS_TOLERANCE: 5,
    MIN_FPS_THRESHOLD_RATIO: 0.7, // 70% of target FPS
    MAX_FPS_THRESHOLD_RATIO: 1.2, // 120% of target FPS
    
    // Adjustment timing
    ADJUSTMENT_COOLDOWN: 5000, // ms
    STABILITY_CHECK_WINDOW: 2000, // ms
    MIN_SAMPLES_FOR_ADJUSTMENT: 30,
    
    // Quality step adjustments
    QUALITY_STEP_SIZE: 0.1,
    MIN_PIXEL_RATIO: 0.5,
    MAX_PIXEL_RATIO: 1.0,
    
    // Stability thresholds
    FPS_STABILITY_THRESHOLD: 5, // Standard deviation
    FRAME_TIME_STABILITY_THRESHOLD: 3, // ms
} as const;

/**
 * LOD system constants
 */
export const LOD_CONSTANTS = {
    // Update intervals
    LOD_UPDATE_INTERVAL: 100, // ms
    
    // Spatial hashing
    SPATIAL_HASH_CELL_SIZE: 100, // World units
    
    // LOD levels
    MAX_LOD_LEVELS: 4,
    DEFAULT_LOD_DISTANCES: [0, 50, 150, 300],
    
    // Culling
    FRUSTUM_CULLING_MARGIN: 1.1, // 10% margin
} as const;

/**
 * Device capability tiers
 */
export const DEVICE_TIERS = {
    // GPU scores (0-100)
    HIGH_END_GPU_SCORE: 80,
    MID_RANGE_GPU_SCORE: 50,
    LOW_END_GPU_SCORE: 20,
    
    // Memory thresholds (MB)
    HIGH_END_MEMORY: 8192,
    MID_RANGE_MEMORY: 4096,
    LOW_END_MEMORY: 2048,
    
    // CPU core counts
    HIGH_END_CORES: 8,
    MID_RANGE_CORES: 4,
    LOW_END_CORES: 2,
} as const;

/**
 * Quality preset names
 */
export const QUALITY_PRESET_NAMES = {
    ULTRA: 'ultra',
    HIGH: 'high',
    MEDIUM: 'medium',
    LOW: 'low',
    PERFORMANCE: 'performance',
} as const;

/**
 * Storage keys for persistence
 */
export const STORAGE_KEYS = {
    QUALITY_SETTINGS: 'stemstudio_quality_settings',
    DEVICE_CAPABILITIES: 'stemstudio_device_capabilities',
    PERFORMANCE_HISTORY: 'stemstudio_performance_history',
    USER_PREFERENCES: 'stemstudio_quality_preferences',
} as const;

/**
 * Default quality settings
 */
export const DEFAULT_QUALITY_SETTINGS: IQualitySettings = {
    rendering: {
        pixelRatio: 1.0,
        shadowQuality: 'medium',
        antialiasing: 'fxaa',
        antialiasingQuality: 'medium',
        postProcessing: true,
        ssao: false,
        ssaoQuality: 'low',
        reflections: false,
        reflectionQuality: 'low',
        bloom: true,
        bloomQuality: 'medium',
        volumetricLighting: false,
        ambientOcclusion: false,
        textureQuality: 'medium',
        textureAnisotropy: 4,
        lodBias: 0,
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
        particleQuality: 'medium',
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
        interpolationQuality: 'medium',
        predictionQuality: 'medium',
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
};

/**
 * Quality adjustment factors
 */
export const QUALITY_FACTORS = {
    // Pixel ratio steps
    PIXEL_RATIO_STEPS: [0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
    
    // Shadow quality progression
    SHADOW_QUALITY_LEVELS: ['none', 'low', 'medium', 'high', 'ultra'] as const,
    SHADOW_MAP_SIZES: [256, 512, 1024, 2048, 4096],
    
    // Texture quality scales
    TEXTURE_QUALITY_SCALES: {
        low: 0.25,
        medium: 0.5,
        high: 0.75,
        ultra: 1.0,
    },
    
    // Update rate ranges
    MIN_UPDATE_RATE: 15,
    MAX_UPDATE_RATE: 120,
    
    // Particle count ranges
    MIN_PARTICLES: 100,
    MAX_PARTICLES: 10000,
} as const;

/**
 * Platform-specific defaults
 */
export const PLATFORM_DEFAULTS = {
    desktop: {
        defaultPreset: 'high',
        targetFPS: 60,
    },
    mobile: {
        defaultPreset: 'low',
        targetFPS: 30,
    },
    tablet: {
        defaultPreset: 'medium',
        targetFPS: 30,
    },
} as const;

/**
 * Debug and logging constants
 */
export const DEBUG_CONSTANTS = {
    ENABLE_PERFORMANCE_OVERLAY: false,
    LOG_QUALITY_CHANGES: true,
    LOG_PERFORMANCE_METRICS: false,
    PERFORMANCE_LOG_INTERVAL: 5000, // ms
} as const;
