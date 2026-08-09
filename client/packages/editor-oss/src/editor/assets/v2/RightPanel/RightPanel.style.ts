import styled from "styled-components";

import {flexCenter, regularFont} from "../../../../assets/style";

export const Container = styled.div`
    position: relative;
    width: 100%;
    height: 100%;
    background: var(--theme-workspace-surface);
    border: 1px solid var(--theme-workspace-border);
    border-radius: var(--theme-workspace-panel-radius);
    padding: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: center;
    color: var(--theme-font-main-selected-color);
    box-shadow: none;

    .panel-close {
        position: absolute;
        z-index: 20;
        top: 2px;
        right: 4px;
        width: var(--theme-workspace-touch-target);
        height: var(--theme-workspace-touch-target);
        border: 0;
        border-radius: var(--theme-workspace-control-radius);
        background: color-mix(in srgb, var(--theme-workspace-surface) 88%, transparent);
        color: var(--theme-workspace-text);
        font-size: 24px;
        cursor: pointer;
    }

    button:focus-visible {
        outline: 2px solid var(--theme-workspace-focus);
        outline-offset: 2px;
    }

    @media (max-width: 960px) {
        border-radius: var(--theme-workspace-panel-radius) 0 0 var(--theme-workspace-panel-radius);
        box-shadow: var(--theme-workspace-drawer-shadow-left);
    }

    @media (max-width: 600px) {
        border-radius: 0;
    }

    @media (max-width: 600px), (max-width: 960px) and (max-height: 600px) {
        input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),
        select,
        textarea,
        button:not(.panel-close),
        [role="button"],
        a {
            min-height: var(--theme-workspace-touch-target);
        }

        button,
        [role="button"] {
            min-width: var(--theme-workspace-touch-target);
        }

        select,
        input:not([type="checkbox"]):not([type="radio"]):not([type="range"]) {
            padding-block: 8px;
        }
    }

    .common-text {
        font-size: var(--theme-font-size-s);
        font-weight: var(--theme-font-regular);
        color: var(--theme-font-unselected-color);
        line-height: 120%;
        text-align: left;
    }

    .white-bold {
        font-weight: var(--theme-font-medium);
        color: var(--theme-font-main-selected-color);
    }
`;

export const BorderedWrapper = styled.div<{
    height?: string;
    $isHeader?: boolean;
}>`
    display: flex;
    width: 100%;
    padding: var(--theme-workspace-space-sm);
    height: ${({height}) => height || "auto"};
    min-height: ${({height}) => height || "48px"};
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
`;

export const Label = styled.div<{$regular?: boolean; $isGray?: boolean; $withIcon?: boolean; $disabled?: boolean}>`
    ${regularFont("s")};
    font-weight: ${({$regular}) => $regular ? "var(--theme-font-regular)" : "var(--theme-font-medium-plus)"};
    margin-bottom: 8px;
    color: ${({$isGray}) => $isGray ? "var(--theme-font-unselected-color)" : "var(--theme-font-main-selected-color)"};

    ${({$withIcon}) =>
        $withIcon &&
        `
    ${flexCenter};
    justify-content: space-between;
    width: 100%;
    .icon {
        width: 18px;
        cursor: pointer;
    }
    `}
`;

export const PanelContentWrapper = styled.div<{$isBehaviorOpen: boolean}>`
    width: 100%;
    // padding bottom should be same as top + editor button height
    padding: var(--theme-workspace-space-md) var(--theme-workspace-space-sm);
    height: 100%;
    overflow: auto;
`;

export const PanelSectionTitle = styled.div<{$margin?: string}>`
    ${regularFont("s")};
    font-weight: var(--theme-font-medium-plus);
    text-align: left;
    ${({$margin}) => $margin && `margin: ${$margin}`}
`;

export const PanelSectionTitleSecondary = styled(PanelSectionTitle)`
    font-weight: var(--theme-font-regular);
    color: var(--theme-font-unselected-color);
`;

export const Instruction = styled.div`
    width: 100%;
    height: 63px;
    margin: 0 auto;
    border-radius: var(--theme-workspace-control-radius);
    background: var(--theme-editor-box-bg);
    padding: var(--theme-workspace-space-input) var(--theme-workspace-space-snug);
    .text {
        ${regularFont("s")};
        color: var(--theme-font-unselected-tertiary-color);
    }
    .text:first-child {
        margin-bottom: 12px;
    }
`;

export const SectionWrapper = styled.div`
    display: flex;
    justify-content: flex-start;
    align-items: flex-start;
    flex-direction: column;
    row-gap: var(--theme-workspace-space-md);
`;
