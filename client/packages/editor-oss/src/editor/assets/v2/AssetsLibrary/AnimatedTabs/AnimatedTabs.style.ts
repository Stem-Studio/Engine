import styled from "styled-components";

import {flexCenter} from "../../../../../assets/style";

export const TabContainer = styled.div`
    display: flex;
    padding: 5px;
    border-radius: 12px;
    position: relative;
    width: auto;
    column-gap: 8px;

    @media (max-width: 960px) {
        flex: 1 0 max-content;
    }

    @media (max-width: 600px) {
        width: max-content;
        min-width: 100%;
        padding: 2px;
        column-gap: 2px;
    }
`;

export const TabButton = styled.button<{$active: boolean}>`
    position: relative;
    z-index: 1;
    background: none;
    border: none;
    cursor: pointer;
    pointer-events: all;
    transition: color 0.3s ease;
    color: ${({$active}) => $active ? "var(--theme-font-main-selected-color)" : "var(--theme-font-unselected-color)"};

    font-size: 12px;
    font-weight: var(--theme-font-medium);
    white-space: nowrap;

    height: 32px;
    min-width: 48px;
    padding: 8px 12px;
    border-radius: 8px;
    ${flexCenter};
    column-gap: 4px;

    &:disabled {
        cursor: not-allowed !important;
        color: #ffffff4d;
        padding: 0;
    }

    @media (max-width: 960px) {
        height: 44px;
        min-width: 60px;
        padding: 8px 10px;
    }

    @media (max-width: 600px) {
        height: 44px;
        min-width: 64px;
        padding: 8px 10px;
    }
`;

/**
 * ActiveTab — the sliding pill behind the currently-selected tab.
 *
 * Uses CSS transition for left/width tween (replaces the framer-motion
 * spring animation we had here before). The easing is a cubic-bezier tuned
 * to approximate the prior spring feel (stiffness 180, damping 20). The
 * inbound "wiggle" animation from framer was dropped — it was decorative
 * and not load-bearing.
 */
export const ActiveTab = styled.div`
    position: absolute;
    top: 5px;
    bottom: 5px;
    border-radius: 8px;
    background: var(--theme-grey-bg-tertiary-button);
    z-index: 0;
    height: 32px;
    transition:
        left 0.32s cubic-bezier(0.32, 0.72, 0.28, 1),
        width 0.32s cubic-bezier(0.32, 0.72, 0.28, 1);

    @media (max-width: 960px) {
        height: 44px;
    }

    @media (max-width: 600px) {
        top: 2px;
        bottom: 2px;
        height: 44px;
    }
`;
