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
    padding: 8px;
    ${flexCenter};
    column-gap: 8px;
    border-radius: 16px;
    border: 1px solid #ffffff1a;
    background: var(--theme-container-minor-dark);
    pointer-events: all;
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
    border-radius: 8px;
    background: transparent;
    color: white;

    ${({$isPink}) => $isPink && "background: #C702C7;"}
    ${({$isBlue}) => $isBlue && "background: var(--theme-container-main-blue);"}
    ${({$isActive}) => $isActive && "background: #0284C7;"}
    ${({$isSelected}) => $isSelected && "background: var(--theme-grey-bg-secondary-button);"}

    &:disabled {
        cursor: not-allowed !important;
    }

    ${({$isPink}) => $isPink && "border-top: 1px solid #E90EDE;"}
    ${({$isBlue}) => $isBlue && "border-bottom: 1px solid var(--theme-container-main-blue-border);"}
    img {
        width: auto;
        height: auto;
    }

    &:hover {
        background: #0284c7;
    }

    &:focus-visible {
        outline: 2px solid #93c5fd;
        outline-offset: 2px;
    }
`;

export const BuildSplitControl = styled.div<{$isSelected?: boolean}>`
    display: inline-flex;
    align-items: center;
    height: 32px;
    border-radius: 8px;
    overflow: auto;
    background: ${({$isSelected}) => $isSelected ? "var(--theme-grey-bg-secondary-button)" : "transparent"};
    border: 1px solid ${({$isSelected}) => $isSelected ? "#ffffff20" : "transparent"};
`;

export const BuildPrimaryButton = styled(ActionButton)`
    border-radius: 0;
    border: 0;
    width: 36px;
`;

export const BuildMenuButton = styled(ActionButton)<{$isOpen?: boolean}>`
    width: 24px;
    border-radius: 0;
    border: 0;
    border-left: 1px solid #ffffff1a;
    background: ${({$isOpen}) => $isOpen ? "#0284c7" : "transparent"};
`;

export const InputWrapper = styled.div`
    position: relative;
    width: 69px;
    height: 32px;
    .zoomInput {
        background-color: var(--theme-grey-bg);
        color: #fff;
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
                    background: #22c55e;
                    color: #22c55e;
                    animation: ${glow} 2s ease-in-out infinite;
                `;
            case "connecting":
                return css`
                    background: #eab308;
                    color: #eab308;
                    animation: ${pulse} 1s ease-in-out infinite;
                    box-shadow: 0 0 4px 1px currentColor;
                `;
            case "disconnected":
                return css`
                    background: #ef4444;
                    color: #ef4444;
                    box-shadow: 0 0 4px 1px currentColor;
                `;
        }
    }}
`;

export const ErrorBadge = styled.div`
    position: absolute;
    top: -5px;
    right: -5px;
    background-color: #ef4444;
    color: white;
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
    background: #1e1e1e;
    border: 1px solid #444;
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
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
    color: #ccc;
    text-align: left;
    &:hover {
        background: #2a2d2e;
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
    color: #e5e7eb;
    font-size: 12px;
    line-height: 1.2;
`;

export const MenuItemDescription = styled.span`
    color: #9ca3af;
    font-size: 10px;
    line-height: 1.2;
`;

export const MenuItemBadge = styled.span`
    margin-left: auto;
    border-radius: 999px;
    border: 1px solid #ffffff22;
    padding: 1px 5px;
    color: #cbd5e1;
    font-size: 9px;
    line-height: 1.2;
`;
