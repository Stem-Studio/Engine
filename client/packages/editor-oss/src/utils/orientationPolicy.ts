import {DetectDevice} from "./DetectDevice";

export type DeviceOrientation = "portrait" | "landscape";

export type OrientationPolicy =
    | "any"
    | "preferPortrait"
    | "preferLandscape"
    | "requirePortrait"
    | "requireLandscape";

/**
 * Playground's supported mobile workspace is landscape-only. Keep the
 * historical values in the type so old local scenes still deserialize, but
 * normalize every value at the runtime boundary instead of allowing a stale
 * scene setting to reopen the unsupported portrait path.
 */
export const DEFAULT_ORIENTATION_POLICY: OrientationPolicy = "requireLandscape";

export const normalizeOrientationPolicy = (_policy: unknown): OrientationPolicy =>
    "requireLandscape";

export const getCurrentDeviceOrientation = (): DeviceOrientation => {
    if (typeof window === "undefined") return "landscape";
    return window.innerHeight >= window.innerWidth ? "portrait" : "landscape";
};

export const getOrientationTarget = (policy: OrientationPolicy): DeviceOrientation | null => {
    return normalizeOrientationPolicy(policy) === "requireLandscape" ? "landscape" : null;
};

export const isOrientationRequired = (policy: OrientationPolicy): boolean =>
    normalizeOrientationPolicy(policy) === "requireLandscape";

export const shouldApplyOrientationPolicy = (policy: OrientationPolicy): boolean =>
    normalizeOrientationPolicy(policy) !== "any" && DetectDevice.isMobile();

export const doesOrientationMatchPolicy = (
    policy: OrientationPolicy,
    currentOrientation: DeviceOrientation = getCurrentDeviceOrientation(),
): boolean => {
    const target = getOrientationTarget(policy);
    if (!target) return true;
    return target === currentOrientation;
};

export const requestOrientationLock = async (policy: OrientationPolicy): Promise<boolean> => {
    const target = getOrientationTarget(policy);
    if (!target || typeof window === "undefined") return false;

    const orientationApi = window.screen?.orientation as ScreenOrientation | undefined;
    if (!orientationApi || typeof orientationApi.lock !== "function") return false;

    try {
        await orientationApi.lock(target);
        return true;
    } catch {
        return false;
    }
};
