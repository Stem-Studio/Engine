import {
    POST_PROCESSING_DEFAULTS,
    type PostProcessingDefaults,
} from "./defaults";

type LoosePostProcessingConfig = Record<string, unknown>;

export type NormalizedPostProcessingConfig =
    LoosePostProcessingConfig &
    PostProcessingDefaults;

function asConfigRecord(value: unknown): LoosePostProcessingConfig {
    return value && typeof value === "object"
        ? value as LoosePostProcessingConfig
        : {};
}

function hasOwn(config: LoosePostProcessingConfig, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(config, key);
}

/**
 * Canonical scene post-processing normalization shared by runtime and editor UI.
 *
 * - Missing features are off.
 * - A serialized feature object inherits only that feature's parameter defaults.
 * - `enabled: true` at the root retains the legacy default stack.
 * - `enabled: false` at the root disables every feature.
 */
export function normalizePostProcessingConfig(
    postProcessing: unknown,
): NormalizedPostProcessingConfig {
    const source = asConfigRecord(postProcessing);
    const globallyDisabled = source.enabled === false;
    const legacyGlobalEnabled = source.enabled === true;

    const normalizeFeature = <K extends keyof PostProcessingDefaults>(
        key: K,
        fallbackKey?: string,
    ): PostProcessingDefaults[K] => {
        const hasPrimary = hasOwn(source, key);
        const hasFallback = fallbackKey !== undefined && hasOwn(source, fallbackKey);
        const supplied = hasPrimary
            ? source[key]
            : (hasFallback && fallbackKey !== undefined ? source[fallbackKey] : undefined);
        const suppliedConfig = asConfigRecord(supplied);
        const featureWasSupplied = hasPrimary || hasFallback;
        const defaults = POST_PROCESSING_DEFAULTS[key];

        return {
            ...defaults,
            ...suppliedConfig,
            enabled: globallyDisabled
                ? false
                : (featureWasSupplied || legacyGlobalEnabled
                    ? suppliedConfig.enabled ?? defaults.enabled
                    : false),
        } as PostProcessingDefaults[K];
    };

    return {
        ...source,
        ao: normalizeFeature("ao", "ssao"),
        bloom: normalizeFeature("bloom"),
        ssr: normalizeFeature("ssr"),
        outline: normalizeFeature("outline"),
        dof: normalizeFeature("dof"),
        lut: normalizeFeature("lut"),
        film: normalizeFeature("film"),
        chromaticAberration: normalizeFeature("chromaticAberration"),
    };
}

export default normalizePostProcessingConfig;
