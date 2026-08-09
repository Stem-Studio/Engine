import {t} from "i18next";
import React, {useEffect, useState} from "react";

import * as S from "./MobilePortraitOverlay.style";
import {
    DEFAULT_ORIENTATION_POLICY,
    doesOrientationMatchPolicy,
    getCurrentDeviceOrientation,
    getOrientationTarget,
    isOrientationRequired,
    normalizeOrientationPolicy,
    type OrientationPolicy,
    requestOrientationLock,
    shouldApplyOrientationPolicy,
} from "@stem/editor-oss/utils/orientationPolicy";

interface Props {
    policy?: OrientationPolicy;
    enabled?: boolean;
    applyOnNarrowViewport?: boolean;
    onBlockingChange?: (blocked: boolean) => void;
}

export const shouldBlockOrientation = (
    policy: OrientationPolicy,
    enabled: boolean,
    currentOrientation: ReturnType<typeof getCurrentDeviceOrientation>,
    applyOnNarrowViewport = false,
): boolean => {
    if (!enabled) return false;
    const compactViewportApplies =
        applyOnNarrowViewport &&
        typeof window !== "undefined" &&
        window.matchMedia("(max-width: 600px)").matches;
    const policyApplies = shouldApplyOrientationPolicy(policy) || compactViewportApplies;
    return policyApplies && !doesOrientationMatchPolicy(policy, currentOrientation);
};

export const MobileOrientationOverlay: React.FC<Props> = ({
    policy = DEFAULT_ORIENTATION_POLICY,
    enabled = true,
    applyOnNarrowViewport = false,
    onBlockingChange,
}) => {
    const effectivePolicy = normalizeOrientationPolicy(policy);
    const [currentOrientation, setCurrentOrientation] = useState(getCurrentDeviceOrientation);
    const blocked = shouldBlockOrientation(effectivePolicy, enabled, currentOrientation, applyOnNarrowViewport);

    useEffect(() => {
        if (!enabled || (!shouldApplyOrientationPolicy(effectivePolicy) && !applyOnNarrowViewport)) return;

        const updateOrientationState = () => {
            setCurrentOrientation(getCurrentDeviceOrientation());
        };

        const relockOrientation = () => {
            void requestOrientationLock(effectivePolicy).finally(updateOrientationState);
        };

        const orientationQuery = window.matchMedia("(orientation: portrait)");
        const handleMediaChange = () => {
            updateOrientationState();
            relockOrientation();
        };
        const handleResize = () => updateOrientationState();
        const handleFullscreenChange = () => relockOrientation();

        updateOrientationState();
        relockOrientation();

        if (typeof orientationQuery.addEventListener === "function") {
            orientationQuery.addEventListener("change", handleMediaChange);
        } else {
            orientationQuery.addListener(handleMediaChange);
        }
        window.addEventListener("resize", handleResize);
        document.addEventListener("fullscreenchange", handleFullscreenChange);

        return () => {
            if (typeof orientationQuery.removeEventListener === "function") {
                orientationQuery.removeEventListener("change", handleMediaChange);
            } else {
                orientationQuery.removeListener(handleMediaChange);
            }
            window.removeEventListener("resize", handleResize);
            document.removeEventListener("fullscreenchange", handleFullscreenChange);
        };
    }, [applyOnNarrowViewport, enabled, effectivePolicy]);

    useEffect(() => {
        onBlockingChange?.(blocked);
    }, [blocked, onBlockingChange]);

    if (!blocked) return null;

    const target = getOrientationTarget(effectivePolicy);
    const subtitle = target === "portrait"
        ? isOrientationRequired(effectivePolicy)
            ? t("This experience requires portrait mode.")
            : t("This experience works best in portrait mode.")
        : isOrientationRequired(effectivePolicy)
            ? t("This experience requires landscape mode.")
            : t("This experience works best in landscape mode.");

    return (
        <S.Overlay
            role="dialog"
            aria-modal="true"
            aria-labelledby="orientation-gate-title"
            aria-describedby="orientation-gate-description"
        >
            <S.IconShell aria-hidden="true">
                <RotateIcon />
            </S.IconShell>
            <S.Title id="orientation-gate-title">{t("Please Rotate Your Device")}</S.Title>
            <S.Subtitle id="orientation-gate-description">{subtitle}</S.Subtitle>
        </S.Overlay>
    );
};

export const MobilePortraitOverlay = MobileOrientationOverlay;

const RotateIcon: React.FC = () => (
    <svg
        width="64"
        height="64"
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
    >
        {/* Phone outline rotated to landscape hint */}
        <rect
            x="10"
            y="16"
            width="24"
            height="36"
            rx="3"
            stroke="white"
            strokeWidth="2.5"
            fill="none"
            transform="rotate(-30 22 34)"
        />
        {/* Curved arrow */}
        <path
            d="M44 14 C52 20, 54 32, 48 42"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
        />
        <polyline
            points="48,36 48,42 54,42"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
        />
    </svg>
);
