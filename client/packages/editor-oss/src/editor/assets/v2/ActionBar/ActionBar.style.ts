import styled, {keyframes, css} from "styled-components";

import {buttonReset, flexCenter, regularFont} from "../../../../assets/style";

export const Container = styled.div`
    position: absolute;
    z-index: 100;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    width: auto;
    height: 48px;
    padding: var(--theme-workspace-space-sm);
    ${flexCenter};
    column-gap: var(--theme-workspace-space-sm);
    border-radius: var(--theme-workspace-panel-radius);
    border: 1px solid var(--theme-workspace-border);
    background: var(--theme-workspace-surface-raised);
    pointer-events: all;

    @media (max-width: 960px) {
        z-index: 90;
        bottom: max(8px, env(safe-area-inset-bottom, 0px));
        max-width: calc(100vw - 16px);
        height: 60px;
        padding: var(--theme-workspace-space-sm);
        column-gap: var(--theme-workspace-space-xs);
        overflow-x: auto;
        justify-content: flex-start;
    }

    /* Keep the lower play path clear on supported mobile landscape. The rail
     * remains thumb-reachable, preserves 44px controls, and yields to the
     * higher-z-index Inspector drawer when that panel is open. */
    @media (max-width: 960px) and (max-height: 480px) and (orientation: landscape) {
        top: calc(48px + max(6px, env(safe-area-inset-top, 0px)));
        right: max(6px, env(safe-area-inset-right, 0px));
        bottom: max(6px, env(safe-area-inset-bottom, 0px));
        left: auto;
        transform: none;
        width: calc(var(--theme-workspace-touch-target) + 8px);
        max-width: calc(var(--theme-workspace-touch-target) + 8px);
        height: auto;
        padding: 4px;
        flex-direction: column;
        row-gap: 4px;
        column-gap: 0;
        border-radius: 14px;
        overflow-x: hidden;
        overflow-y: auto;
        overscroll-behavior: contain;
        scrollbar-width: thin;
        justify-content: flex-start;
    }
`;

export const ActionButton = styled.button<{
    $isSelected?: boolean;
    $isBlue?: boolean;
    $isPink?: boolean;
    $isActive?: boolean;
}>`
    ${buttonReset};
    width: 32px;
    height: 32px;
    border-radius: var(--theme-workspace-control-radius);
    background: transparent;
    color: var(--theme-workspace-text);

    ${({$isPink}) => $isPink && "background: var(--theme-container-main-pink);"}
    ${({$isBlue}) => $isBlue && "background: var(--theme-container-main-blue);"}
    ${({$isActive}) => $isActive && "background: var(--theme-workspace-action);"}
    ${({$isSelected}) => $isSelected && "background: var(--theme-grey-bg-secondary-button);"}

    &:disabled {
        cursor: not-allowed !important;
    }

    ${({$isPink}) => $isPink && "border-top: 1px solid var(--theme-container-main-pink-border);"}
    ${({$isBlue}) => $isBlue && "border-bottom: 1px solid var(--theme-container-main-blue-border);"}
    img {
        width: auto;
        height: auto;
    }

    &:hover {
        background: var(--theme-workspace-action-hover);
    }

    &:focus-visible {
        outline: 2px solid var(--theme-workspace-focus);
        outline-offset: 2px;
    }

    @media (max-width: 960px) {
        width: var(--theme-workspace-touch-target);
        min-width: var(--theme-workspace-touch-target);
        height: var(--theme-workspace-touch-target);
    }

    @media (max-width: 960px) and (max-height: 480px) and (orientation: landscape) {
        min-height: var(--theme-workspace-touch-target);
        flex: 0 0 var(--theme-workspace-touch-target);
    }
`;

export const BuildSplitControl = styled.div<{$isSelected?: boolean}>`
    display: inline-flex;
    align-items: center;
    height: 32px;
    border-radius: var(--theme-workspace-control-radius);
    overflow: hidden;
    background: ${({$isSelected}) => $isSelected ? "var(--theme-grey-bg-secondary-button)" : "transparent"};
    border: 1px solid ${({$isSelected}) => $isSelected ? "var(--theme-workspace-control-border)" : "transparent"};

    @media (max-width: 960px) {
        height: var(--theme-workspace-touch-target);
    }

    @media (max-width: 960px) and (max-height: 480px) and (orientation: landscape) {
        width: var(--theme-workspace-touch-target);
        height: calc(var(--theme-workspace-touch-target) * 2);
        min-height: calc(var(--theme-workspace-touch-target) * 2);
        flex-direction: column;
        flex: 0 0 calc(var(--theme-workspace-touch-target) * 2);
    }
`;

export const BuildPrimaryButton = styled(ActionButton)`
    border-radius: 0;
    border: 0;
    width: 36px;

    @media (max-width: 960px) {
        width: 44px;
    }

    @media (max-width: 960px) and (max-height: 480px) and (orientation: landscape) {
        height: var(--theme-workspace-touch-target);
        flex: 0 0 var(--theme-workspace-touch-target);
    }
`;

export const BuildMenuButton = styled(ActionButton)<{$isOpen?: boolean}>`
    width: 24px;
    border-radius: 0;
    border: 0;
    border-left: 1px solid var(--theme-workspace-border);
    background: ${({$isOpen}) => $isOpen ? "var(--theme-overlay-white-8)" : "transparent"};

    @media (max-width: 960px) {
        width: var(--theme-workspace-touch-target);
    }

    @media (max-width: 960px) and (max-height: 480px) and (orientation: landscape) {
        height: var(--theme-workspace-touch-target);
        flex: 0 0 var(--theme-workspace-touch-target);
        border-left: 0;
        border-top: 1px solid var(--theme-workspace-border);
    }
`;

export const InputWrapper = styled.div`
    position: relative;
    width: 69px;
    height: 32px;
    .zoomInput {
        background-color: var(--theme-grey-bg);
        color: var(--theme-workspace-text);
        width: 100%;
        padding-left: 30px;
        height: 32px;
    }

    .zoomIcon {
        position: absolute;
        left: 8px;
        top: 50%;
        transform: translateY(-50%);
        width: 12px;
        height: 12px;
        z-index: 1;
    }

    .percentage {
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        ${regularFont("s")};
    }
`;

export const Separator = styled.div`
    width: 1px;
    height: 48px;
    background: var(--theme-container-divider);

    @media (max-width: 960px) and (max-height: 480px) and (orientation: landscape) {
        width: 32px;
        height: 1px;
        min-height: 1px;
    }
`;

const pulse = keyframes`
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
`;

const glow = keyframes`
    0%, 100% { box-shadow: 0 0 4px 1px currentColor; }
    50% { box-shadow: 0 0 8px 3px currentColor; }
`;

export const CollaborationIndicator = styled.div<{$status: "connected" | "connecting" | "disconnected"}>`
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 4px;
    cursor: default;
`;

export const CollaborationDot = styled.div<{$status: "connected" | "connecting" | "disconnected"}>`
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    ${({$status}) => {
        switch ($status) {
            case "connected":
                return css`
                    background: var(--theme-green);
                    color: var(--theme-green);
                    animation: ${glow} 2s ease-in-out infinite;
                `;
            case "connecting":
                return css`
                    background: var(--theme-workspace-connection-warning);
                    color: var(--theme-workspace-connection-warning);
                    animation: ${pulse} 1s ease-in-out infinite;
                    box-shadow: 0 0 4px 1px currentColor;
                `;
            case "disconnected":
                return css`
                    background: var(--theme-color-error-strong);
                    color: var(--theme-color-error-strong);
                    box-shadow: 0 0 4px 1px currentColor;
                `;
        }
    }}
`;

export const ErrorBadge = styled.div`
    position: absolute;
    top: -5px;
    right: -5px;
    background-color: var(--theme-color-error-strong);
    color: var(--theme-workspace-text);
    border-radius: 50%;
    width: 16px;
    height: 16px;
    font-size: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    pointer-events: none;
`;

export const DebugButtonWrapper = styled.div`
    position: relative;
`;

export const MenuOverlay = styled.div`
    position: fixed;
    inset: 0;
    z-index: 9999;
`;

export const MenuPopover = styled.div`
    position: fixed;
    z-index: 10000;
    min-width: 160px;
    background: var(--theme-dialog-bg);
    border: 1px solid var(--theme-workspace-control-border);
    border-radius: var(--theme-workspace-control-radius);
    box-shadow: var(--theme-dialog-shadow);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
`;

export const MenuItem = styled.button`
    ${buttonReset};
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    cursor: pointer;
    font-size: 12px;
    color: var(--theme-font-unselected-secondary-color);
    text-align: left;
    &:hover {
        background: var(--theme-workspace-control-hover);
    }

    &:disabled {
        cursor: not-allowed;
        opacity: 0.58;
    }

    &:disabled:hover {
        background: transparent;
    }
`;

export const MenuItemText = styled.span`
    display: flex;
    flex: 1;
    min-width: 0;
    flex-direction: column;
    gap: 2px;
`;

export const MenuItemLabel = styled.span`
    color: var(--theme-workspace-text);
    font-size: 12px;
    line-height: 1.2;
`;

export const MenuItemDescription = styled.span`
    color: var(--theme-font-unselected-color);
    font-size: 10px;
    line-height: 1.2;
`;

export const MenuItemBadge = styled.span`
    margin-left: auto;
    border-radius: 999px;
    border: 1px solid var(--theme-workspace-control-border);
    padding: 1px 5px;
    color: var(--theme-font-unselected-secondary-color);
    font-size: 9px;
    line-height: 1.2;
`;
