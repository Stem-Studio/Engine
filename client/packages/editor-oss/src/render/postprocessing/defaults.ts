// Centralized default values for post-processing settings (AO, Bloom, SSR, Outline)
// Keep these in sync across UI and render pipelines

export type AOSettings = {
    enabled: boolean;
    kernelRadius: number;
    resolutionScale: number;
    thickness: number;
    scale: number;
    samples: number;
};

export type BloomSettings = {
    enabled: boolean;
    strength: number;
    radius: number;
    threshold: number;
};

export type SSRSettings = {
    enabled: boolean;
    resolutionScale: number;
    maxDistance: number;
    thickness: number;
    opacity: number;
    quality: number;
    blur: boolean;
    blurQuality: number;
};

export type OutlineSettings = {
    enabled: boolean;
    edgeStrength: number;
    edgeGlow: number;
    edgeThickness: number;
    pulsePeriod: number;
    visibleEdgeColor: number;
    hiddenEdgeColor: number;
};

export type DofSettings = {
    enabled: boolean;
    focusDistance: number;
    focalLength: number;
    bokehScale: number;
};

/**
 * LUT (color-grading) settings. The LUT texture itself is not stored here —
 * it's loaded by the EffectRenderer via a URL or pre-loaded texture and
 * kept in the renderer's node state. These settings control how/whether
 * the pass runs. Separating texture-state from config means scene JSON
 * stays simple + lets us swap LUTs without touching the rest of the
 * post-processing chain.
 */
export type LutSettings = {
    enabled: boolean;
    /** Blend intensity 0..1 — 0 = no effect, 1 = full LUT. */
    intensity: number;
    /**
     * External URL of a `.cube` or `.3dl` file. Useful for referencing
     * hosted LUTs (e.g. a CDN-hosted preset library). Ignored when
     * `assetId` is set (asset-system reference takes precedence).
     */
    source: string;
    /**
     * Asset-system reference to an uploaded LUT file. Preferred over
     * `source` when present — EffectRenderer resolves the asset to a
     * signed download URL at render time. Empty = use `source` URL.
     */
    assetId: string;
};

/**
 * Film grain — classic film aesthetic overlay. Gameplay uses: cinematic
 * cutscenes, photo mode, horror/retro visual treatment.
 */
export type FilmSettings = {
    enabled: boolean;
    /** Grain strength 0..1. */
    intensity: number;
};

/**
 * Chromatic aberration — per-channel color fringing. Gameplay uses:
 * damage feedback (crank intensity on hit), teleport/warp flashes, drunk
 * or disoriented state effects.
 */
export type ChromaticAberrationSettings = {
    enabled: boolean;
    /** Per-channel offset strength. 0 = identity, ~0.01 subtle, ~0.05 heavy. */
    strength: number;
};

export type PostProcessingDefaults = {
    ao: AOSettings;
    bloom: BloomSettings;
    ssr: SSRSettings;
    outline: OutlineSettings;
    dof: DofSettings;
    lut: LutSettings;
    film: FilmSettings;
    chromaticAberration: ChromaticAberrationSettings;
};

export const POST_PROCESSING_DEFAULTS: PostProcessingDefaults = {
    ao: {
        enabled: true,
        kernelRadius: 0.25,
        resolutionScale: 1.0,
        thickness: 1.0,
        scale: 1.0,
        samples: 8,
    },
    bloom: {
        enabled: false,
        strength: 0.2,
        radius: 0.1,
        threshold: 0.85,
    },
    ssr: {
        enabled: false,
        resolutionScale: 0.25,
        maxDistance: 5.0,
        thickness: 0.1,
        opacity: 0.9,
        quality: 0.25,
        blur: false,
        blurQuality: 1,
    },
    outline: {
        enabled: true,
        edgeStrength: 1.5,
        edgeGlow: 0.0,
        edgeThickness: 1.0,
        pulsePeriod: 0.0,
        visibleEdgeColor: 0xffffff,
        hiddenEdgeColor: 0x4e3636,
    },
    dof: {
        enabled: false,
        focusDistance: 10.0,
        focalLength: 6.0,
        bokehScale: 1.0,
    },
    lut: {
        enabled: false,
        intensity: 1.0,
        source: "",
        assetId: "",
    },
    film: {
        enabled: false,
        intensity: 0.35,
    },
    chromaticAberration: {
        enabled: false,
        strength: 0.005,
    },
};

export default POST_PROCESSING_DEFAULTS;
