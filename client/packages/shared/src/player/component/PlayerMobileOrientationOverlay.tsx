import {t} from "i18next";
import React, {useEffect, useState} from "react";

import * as S from "./PlayerMobileOrientationOverlay.style";
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
} from "../../utils/orientationPolicy";

interface Props {
    policy?: OrientationPolicy;
    enabled?: boolean;
}

export const PlayerMobileOrientationOverlay: React.FC<Props> = ({
    policy = DEFAULT_ORIENTATION_POLICY,
    enabled = true,
}) => {
    const effectivePolicy = normalizeOrientationPolicy(policy);
    const [currentOrientation, setCurrentOrientation] = useState(getCurrentDeviceOrientation);

    useEffect(() => {
        if (!enabled || !shouldApplyOrientationPolicy(effectivePolicy)) return;

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
    }, [enabled, effectivePolicy]);

    if (!enabled || !shouldApplyOrientationPolicy(effectivePolicy) || doesOrientationMatchPolicy(effectivePolicy, currentOrientation)) {
        return null;
    }

    const target = getOrientationTarget(effectivePolicy);
    const subtitle = target === "portrait"
        ? isOrientationRequired(effectivePolicy)
            ? t("This experience requires portrait mode.")
            : t("This experience works best in portrait mode.")
        : isOrientationRequired(effectivePolicy)
            ? t("This experience requires landscape mode.")
            : t("This experience works best in landscape mode.");

    return (
        <S.Overlay>
            <RotateIcon />
            <S.Title>{t("Please Rotate Your Device")}</S.Title>
            <S.Subtitle>{subtitle}</S.Subtitle>
        </S.Overlay>
    );
};

const RotateIcon: React.FC = () => (
    <svg
        width="64"
        height="64"
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
    >
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
