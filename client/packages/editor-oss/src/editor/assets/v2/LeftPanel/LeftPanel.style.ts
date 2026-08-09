import styled from "styled-components";

import {flexCenter} from "../../../../assets/style";
import {EDITOR_TOP_NAV_HALF_HEIGHT, EDITOR_TOP_NAV_HEIGHT, PANEL_FULL_HEIGHT} from "@stem/editor-oss/types/editor";

export const LEFT_PANEL_WIDTH = 244;

export const Container = styled.aside<{$drawerMode?: boolean; $isOpen?: boolean}>`
    box-sizing: border-box;
    position: fixed;
    z-index: 100;
    left: 12px;
    top: 50%;
    transform: translateY(calc(-50% + ${EDITOR_TOP_NAV_HALF_HEIGHT}));
    width: ${LEFT_PANEL_WIDTH}px;
    height: ${PANEL_FULL_HEIGHT};
    max-height: ${PANEL_FULL_HEIGHT};
    background: var(--theme-workspace-surface);
    border: 1px solid var(--theme-workspace-border);
    border-radius: var(--theme-workspace-panel-radius);
    padding: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: center;
    color: var(--theme-font-main-selected-color);
    z-index: 100;
    overflow: hidden;
    transition: transform 180ms ease, opacity 180ms ease;

    div,
    span,
    button {
        box-sizing: border-box;
    }

    .panel-tabs {
        display: flex;
        flex: 1;
        min-width: 0;
        gap: var(--theme-workspace-space-xs);
    }

    .panel-close {
        width: var(--theme-workspace-touch-target);
        height: var(--theme-workspace-touch-target);
        flex: 0 0 var(--theme-workspace-touch-target);
        border: 0;
        border-radius: var(--theme-workspace-control-radius);
        background: transparent;
        color: var(--theme-workspace-text);
        font-size: 24px;
        cursor: pointer;
    }

    button:focus-visible {
        outline: 2px solid var(--theme-workspace-focus);
        outline-offset: 2px;
    }

    @media (max-width: 960px) {
        top: calc(${EDITOR_TOP_NAV_HEIGHT} + env(safe-area-inset-top, 0px));
        left: 0;
        bottom: 0;
        width: min(360px, 88vw);
        height: auto;
        max-height: none;
        border-radius: 0 var(--theme-workspace-panel-radius) var(--theme-workspace-panel-radius) 0;
        transform: ${({$isOpen}) => $isOpen ? "translateX(0)" : "translateX(-105%)"};
        opacity: ${({$isOpen}) => $isOpen ? 1 : 0};
        pointer-events: ${({$isOpen}) => $isOpen ? "auto" : "none"};
        box-shadow: var(--theme-workspace-drawer-shadow);
    }

    @media (max-width: 600px), (max-width: 960px) and (max-height: 600px) {
        .ProjectTab [role="button"][tabindex="0"] {
            min-width: var(--theme-workspace-touch-target);
            min-height: var(--theme-workspace-touch-target);
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }

        .ProjectTab [role="button"][tabindex="0"] .infoIcon-tooltip {
            width: 16px;
            height: 16px;
        }
    }

    @media (max-width: 600px) {
        width: 100vw;
        border-radius: 0;
    }
`;

export const BorderedWrapper = styled.div<{
    height?: string;
    $isHeader?: boolean;
}>`
    display: flex;
    width: 100%;
    padding: 0 var(--theme-workspace-space-sm);
    height: ${({height}) => height || "40px"};
    min-height: ${({height}) => height || "40px"};
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--theme-container-divider);
    gap: var(--theme-workspace-space-xs);
    font-weight: var(--theme-font-medium-plus);
    font-size: var(--theme-font-size-s);

    ${({$isHeader}) =>
        $isHeader &&
        `
    border-top-left-radius: 16px;
    border-top-right-radius: 16px;
  `}

    > div {
        > span {
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            display: inline-block;
            max-width: 150px;
        }
    }

    .go-back-icon {
        padding: 2px;
    }

    .go-back-icon,
    .menuIcon {
        cursor: pointer;
        border-radius: var(--theme-workspace-control-radius);
        transition: 0.3s;
        &:hover {
            background-color: var(--theme-workspace-control-hover);
        }
    }

    .panelTitle,
    .tabTitle {
        font-weight: var(--theme-font-medium-plus);
        font-size: 16px;
        line-height: 16px;
        color: var(--theme-workspace-text);
    }

    .tabTitle {
        font-size: 12px;
    }
`;

export const TabButton = styled.button<{$isActive?: boolean}>`
    width: 100%;
    height: 32px;
    border-radius: var(--theme-workspace-control-radius);
    ${flexCenter};
    transition: all 0.2s;
    cursor: pointer;
    font-size: var(--theme-font-size-s);
    font-weight: var(--theme-font-medium-plus);
    color: var(--theme-workspace-text);
    border: 0;
    padding: 0 var(--theme-workspace-space-sm);
    background: transparent;

    &:hover {
        background: var(--theme-container-divider);
    }

    ${({$isActive}) =>
        $isActive &&
        `
    background: var(--theme-container-divider);
  `}

    @media (max-width: 960px) {
        min-height: var(--theme-workspace-touch-target);
    }
`;
