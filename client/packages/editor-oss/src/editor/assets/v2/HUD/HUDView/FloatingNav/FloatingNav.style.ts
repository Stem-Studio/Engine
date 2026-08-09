import styled, {css} from "styled-components";

import {flexCenter, regularFont} from "../../../../../../assets/style";
import {EDITOR_TOP_NAV_HEIGHT} from "@stem/editor-oss/types/editor";

/**
 * Shared floating-pill treatment used by other in-game HUD overlays (e.g. FTUE).
 * The play-mode top nav no longer uses this — it mirrors the edit-mode TopNav —
 * but it stays exported here because HUDEditView consumers still import it.
 */
export const floatingContainerStyle = css`
    ${flexCenter};
    column-gap: 4px;
    padding: 4px;
    background-color: #0000004a;
    backdrop-filter: blur(30px);
    border-radius: 27px;
`;

export const StyledNav = styled.nav`
    position: fixed;
    /* The active editor Play chrome is host UI. Keep it above body-level
       runtime HUDs, which are authored by the loaded game. */
    z-index: 10000;
    top: 0;
    left: 0;
    right: 0;
    width: 100%;
    height: ${EDITOR_TOP_NAV_HEIGHT};
    background: var(--theme-container-main-dark);

    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px;
`;

export const LeftSide = styled.div`
    font-weight: 400;
    font-size: var(--theme-font-size-s);
    color: #f8fafc;
    width: 240px;

    .go-back-icon {
        padding: 2px;
        width: 24px;
    }

    .go-back-icon,
    .menuIcon {
        cursor: pointer;
        border-radius: 8px;
        transition: 0.3s;
        &:hover {
            background-color: #262626;
        }
    }
`;

export const Middle = styled.div`
    ${flexCenter};
    background: var(--theme-grey-bg);
    padding: 2px;
    border-radius: 8px;
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
`;

export const Right = styled.div`
    ${flexCenter};
`;

export const EditorButton = styled.div<{$isBlue: boolean; $disabled?: boolean}>`
    width: 78px;
    height: 28px;
    border-top-width: 1px;
    padding: 8px 12px;
    border-radius: 8px;
    background: ${({$isBlue}) => $isBlue ? "#0284c7" : "transparent"};
    ${regularFont("s")};
    font-weight: var(--theme-font-medium-plus);
    cursor: ${({$disabled}) => $disabled ? "not-allowed" : "pointer"};
    opacity: ${({$disabled}) => $disabled ? 0.45 : 1};
    text-align: center;
`;

export const MenuButton = styled.button`
    padding: 0;
    margin: 0;
    box-sizing: border-box;
    border: none;
    background: none;
    cursor: pointer;

    width: 32px;
    height: 32px;
    flex-shrink: 0;
    flex-grow: 0;
    ${flexCenter};
`;

export const InGameButton = styled.button<{$background: string}>`
    box-sizing: border-box;
    width: 100%;
    padding: 8px 16px;
    height: 32px;
    margin: 0;
    border: none;
    border-radius: 16px;
    background: ${({$background}) => $background};
    cursor: pointer;
    ${regularFont("s")};
    font-weight: var(--theme-font-medium);
    color: white;
    pointer-events: all;
`;
