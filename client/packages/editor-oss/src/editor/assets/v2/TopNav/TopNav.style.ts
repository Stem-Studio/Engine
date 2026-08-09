import styled from "styled-components";

import {flexCenter, regularFont} from "../../../../assets/style";
import {EDITOR_TOP_NAV_HEIGHT} from "@stem/editor-oss/types/editor";

export const StyledNav = styled.nav`
    position: fixed;
    /* Host chrome must remain above body-level game HUDs. Runtime-authored
       overlays are intentionally untrusted and may use high z-index values. */
    z-index: 10000;
    top: 0;
    left: 0;
    right: 0;
    width: 100%;
    height: ${EDITOR_TOP_NAV_HEIGHT};
    background: var(--theme-workspace-surface);

    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--theme-workspace-space-sm);
    padding-top: calc(var(--theme-workspace-space-sm) + env(safe-area-inset-top, 0px));

    button:focus-visible {
        outline: 2px solid var(--theme-workspace-focus);
        outline-offset: 2px;
    }

    .compact-save {
        display: none;
    }

    @media (max-width: 960px) {
        height: calc(${EDITOR_TOP_NAV_HEIGHT} + env(safe-area-inset-top, 0px));
        gap: var(--theme-workspace-space-compact);
        padding-inline:
            max(var(--theme-workspace-space-sm), env(safe-area-inset-left, 0px))
            max(var(--theme-workspace-space-sm), env(safe-area-inset-right, 0px));

        .compact-save {
            display: inline-flex;
            width: auto;
            min-width: 60px;
            height: var(--theme-workspace-touch-target);
        }

        .workspace-panel-toggles {
            display: flex;
            align-items: center;
            flex: 0 0 auto;
            gap: var(--theme-workspace-space-xs);
            height: var(--theme-workspace-touch-target);
        }
    }

    @media (max-width: 960px) and (max-height: 480px) and (orientation: landscape) {
        gap: 2px;
        padding-inline: max(2px, env(safe-area-inset-left, 0px)) max(2px, env(safe-area-inset-right, 0px));

        .compact-save {
            min-width: 48px;
            padding-inline: 6px;
        }

        .workspace-panel-toggles {
            gap: 2px;
        }
    }
`;

export const WorkspaceHeaderGroup = styled.div`
    display: flex;
    align-items: center;
    gap: var(--theme-workspace-space-input);
    min-width: 0;

    @media (max-width: 960px) {
        flex: 1 1 auto;
        gap: var(--theme-workspace-space-xs);
        overflow: hidden;

        .stem-logo-btn {
            display: none;
        }
    }

    @media (max-width: 960px) and (max-height: 480px) and (orientation: landscape) {
        gap: 2px;
    }
`;

export const WorkspaceProjectInput = styled.div`
    width: min(260px, 24vw);
    min-width: 160px;
    height: 32px;
    display: flex;
    align-items: center;
    padding: 0 var(--theme-workspace-space-md);
    border-radius: var(--theme-workspace-control-radius);
    border: 1px solid var(--theme-workspace-control-border);
    background: var(--theme-overlay-white-5);
    color: var(--theme-workspace-text);
    font-size: 13px;
    line-height: 1;
    overflow: hidden;

    @media (max-width: 960px) {
        width: auto;
        min-width: 0;
        max-width: 180px;
        flex: 1 1 auto;
        height: var(--theme-workspace-touch-target);
    }

    @media (max-width: 960px) and (max-height: 480px) and (orientation: landscape) {
        max-width: 128px;
        padding-inline: 8px;
    }
`;

export const WorkspaceMeta = styled.div`
    display: flex;
    align-items: center;
    gap: var(--theme-workspace-space-sm);
    color: var(--theme-workspace-text-muted);
    font-family: "Source Code Pro", monospace;
    font-size: 11px;
    white-space: nowrap;

    @media (max-width: 960px) {
        display: none;
    }
`;

export const WorkspaceVersionChip = styled.button<{$preview?: boolean}>`
    height: 32px;
    display: inline-flex;
    align-items: center;
    gap: var(--theme-workspace-space-sm);
    padding: 0 10px;
    border: 1px solid ${({$preview}) => $preview ? "var(--theme-workspace-selected-border)" : "var(--theme-workspace-control-border)"};
    border-radius: var(--theme-workspace-control-radius);
    background: ${({$preview}) => $preview ? "var(--theme-workspace-selected-bg)" : "var(--theme-overlay-white-5)"};
    color: var(--theme-workspace-text);
    font-family: "Source Code Pro", monospace;
    font-size: 12px;
    cursor: default;
`;

export const WorkspaceSaved = styled.div`
    display: flex;
    align-items: center;
    gap: var(--theme-workspace-space-sm);
    color: var(--theme-workspace-text-muted);
`;

export const LeftSide = styled.div`
    font-weight: 400;
    font-size: var(--theme-font-size-s);
    color: var(--theme-workspace-text);
    width: 240px;

    @media (max-width: 960px) {
        width: auto;
        min-width: 0;
        flex: 1 1 auto;

        .stem-logo-btn {
            display: none;
        }
    }

    .go-back-icon {
        padding: 2px;
        width: 24px;
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
`;

export const SceneNameWrapper = styled.div`
    overflow: hidden;
    white-space: nowrap;
    display: inline-block;
    max-width: 180px;
    flex-grow: 1;
    text-align: center;
    position: relative;
    cursor: pointer;
    .space {
        width: 24px;
    }
`;

export const Middle = styled.div`
    ${flexCenter};
    background: var(--theme-grey-bg);
    padding: 2px;
    border-radius: var(--theme-workspace-control-radius);
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);

    @media (max-width: 960px) {
        position: static;
        transform: none;
        flex: 0 0 auto;
    }
`;
export const Right = styled.div`
    ${flexCenter};

    @media (max-width: 960px) {
        flex: 0 0 auto;

        > :not(.compact-save) {
            display: none;
        }
    }
`;

export const EditorButton = styled.button<{$isBlue: boolean; $disabled?: boolean}>`
    width: 78px;
    height: 28px;
    box-sizing: border-box;
    border: 0;
    padding: 0 12px;
    border-radius: 8px;
    background: ${({$isBlue}) => ($isBlue ? "var(--theme-workspace-action)" : "transparent")};
    color: var(--theme-workspace-text);
    ${regularFont("s")};
    font-weight: var(--theme-font-medium-plus);
    cursor: ${({$disabled}) => $disabled ? "not-allowed" : "pointer"};
    opacity: ${({$disabled}) => $disabled ? 0.45 : 1};
    display: inline-flex;
    align-items: center;
    justify-content: center;
    appearance: none;
    user-select: none;

    &:disabled {
        pointer-events: none;
    }

    &:focus-visible {
        outline: 2px solid var(--theme-workspace-focus);
        outline-offset: 2px;
    }

    @media (max-width: 960px) {
        width: 58px;
        height: var(--theme-workspace-touch-target);
        padding: 0 10px;
    }

    @media (max-width: 960px) and (max-height: 480px) and (orientation: landscape) {
        width: 48px;
        padding-inline: 6px;
    }
`;

export const NavIconButton = styled.button`
    width: 24px;
    height: 24px;
    flex: 0 0 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: var(--theme-workspace-control-radius);
    background: transparent;
    cursor: pointer;

    &:hover {
        background: var(--theme-workspace-control-hover);
    }

    img {
        width: 24px;
        height: 24px;
    }

    @media (max-width: 960px) {
        width: var(--theme-workspace-touch-target);
        height: var(--theme-workspace-touch-target);
        flex-basis: var(--theme-workspace-touch-target);
    }
`;

export const WorkspacePanelButton = styled.button<{$active: boolean}>`
    min-width: var(--theme-workspace-touch-target);
    height: var(--theme-workspace-touch-target);
    border: 1px solid ${({$active}) => $active ? "var(--theme-workspace-selected-border)" : "var(--theme-workspace-control-border)"};
    border-radius: var(--theme-workspace-control-radius);
    padding: 0 10px;
    background: ${({$active}) => $active ? "var(--theme-workspace-selected-bg)" : "transparent"};
    color: var(--theme-workspace-text);
    font-size: 12px;
    cursor: pointer;

    .panel-label-short {
        display: none;
    }

    @media (min-width: 961px) {
        display: none;
    }

    @media (max-width: 600px) {
        width: var(--theme-workspace-touch-target);
        padding: 0;

        .panel-label-full {
            display: none;
        }

        .panel-label-short {
            display: inline;
        }
    }

`;

export const CompactOnly = styled.div`
    display: none;

    @media (max-width: 960px) {
        display: contents;
    }
`;

export const RenameInput = styled.input`
    ${regularFont("s")};
    font-weight: var(--theme-font-medium-plus);
    color: var(--theme-workspace-text);
    border: none;
    background: transparent;
    outline: none;
    width: 150px;
    border-bottom: 1px solid var(--theme-font-unselected-color);
    padding-bottom: 4px;
    margin-bottom: -4px;
`;
