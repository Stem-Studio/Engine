import {Combobox} from "@headlessui/react";
import React from "react";
import styled from "styled-components";

import {regularFont} from "../../../../../assets/style";

export const StyledCombobox = styled.div`
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: center;
    position: relative;
    cursor: pointer;
    pointer-events: all;
`;

// Styled base input
const StyledComboboxInput = styled.input<{
    $disabled?: boolean;
    $customBgColor?: string;
    $customRadius?: string;
    $customColor?: string;
}>`
    padding: 6px 28px 6px 14px;
    width: 100%;
    height: 24px;
    border: none;
    border-radius: ${({$customRadius}) => ($customRadius ? $customRadius : "8px")};
    background-color: ${({$customBgColor}) => ($customBgColor ? $customBgColor : "var(--theme-grey-bg)")};
    ${regularFont("s")};
    color: var(--theme-font-input-color);
    color: ${({$customColor}) => ($customColor ? $customColor : "var(--theme-font-input-color)")};
    pointer-events: all;
    cursor: pointer;

    ${({$disabled}) =>
        $disabled &&
        `
    cursor: not-allowed;
    background-color: #3F3F46;
    color: #A1A1AA;
  `}

    @media (max-width: 600px), (max-width: 960px) and (max-height: 600px) {
        height: 44px;
        padding-block: 8px;
    }
`;

type ComboboxInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
    $disabled?: boolean;
    customBgColor?: string;
    customRadius?: string;
    customColor?: string;
    displayValue?: (item: string | number | readonly string[] | undefined) => string;
};

export const ComboboxInput = React.forwardRef<HTMLInputElement, ComboboxInputProps>(
    ({$disabled, customRadius, customBgColor, customColor, displayValue, ...props}, ref) => (
        <Combobox.Input
            as={StyledComboboxInput}
            ref={ref}
            $disabled={$disabled}
            $customBgColor={customBgColor}
            $customRadius={customRadius}
            $customColor={customColor}
            displayValue={displayValue}
            {...props}
        />
    ),
);
ComboboxInput.displayName = "ComboboxInput";

export const ComboboxButton = styled(Combobox.Button)<{$disabled?: boolean}>`
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    height: 24px;
    box-sizing: border-box;
    right: 4px;
    z-index: 5;
    background: transparent;
    color: #fff;
    cursor: ${({$disabled}) => ($disabled ? "not-allowed" : "pointer")};
    outline: none;
    border: none;
    pointer-events: all;
    display: flex;
    align-items: center;
    justify-content: center;

    @media (max-width: 600px), (max-width: 960px) and (max-height: 600px) {
        width: 44px;
        height: 44px;
        right: 0;
    }
`;

export const ComboboxOptions = styled(Combobox.Options)<{$disabled?: boolean; $onTop?: boolean}>`
    position: absolute;
    top: 28px;
    left: 0;
    width: 100%;
    background-color: #232323;
    border-radius: 0px;
    z-index: 10000 !important;
    padding: 4px;
    box-sizing: border-box;
    margin-top: 0;
    max-height: 200px;
    overflow: auto;
    pointer-events: all;

    white-space: normal;
    overflow-wrap: break-word;
    word-break: break-word;

${({$onTop}) =>
        $onTop &&
        ` 
bottom: 12px;
top: unset;
`}

    @media (max-width: 600px), (max-width: 960px) and (max-height: 600px) {
        top: 48px;
    }
`;

export const ComboboxOption = styled(Combobox.Option)<{$disabled?: boolean}>`
    width: calc(100% - 8px);
    margin: 0 auto;
    min-height: 24px;
    border: none;
    font-size: var(--theme-font-size-extra-small);
    font-weight: var(--theme-font-regular);
    color: var(--theme-font-input-color);
    line-height: 120%;
    padding: 2px 4px;
    list-style: none;
    overflow: hidden;
    text-overflow: ellipsis;
    box-sizing: border-box;
    transition: all 0.3s ease-in-out;
    cursor: pointer;
    pointer-events: all;

    &:hover {
        background-color: var(--theme-grey-bg-secondary);
        border-radius: 4px;
    }

    display: flex;
    align-items: center;

    @media (max-width: 600px), (max-width: 960px) and (max-height: 600px) {
        min-height: 44px;
        padding: 8px;
    }
`;
