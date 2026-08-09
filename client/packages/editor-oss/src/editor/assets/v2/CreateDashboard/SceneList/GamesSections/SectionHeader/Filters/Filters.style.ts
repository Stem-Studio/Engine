import styled from "styled-components";

import {flexCenter} from "../../../../../../../../assets/style";

export const FilterControl = styled.div`
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
`;

export const FilterButton = styled.button<{$active?: boolean}>`
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1px solid ${({$active}) => ($active ? "rgba(248, 250, 252, 0.28)" : "transparent")};
    border-radius: 4px;
    background: ${({$active}) => ($active ? "rgba(248, 250, 252, 0.08)" : "transparent")};
    color: #f8fafc;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    appearance: none;
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease;

    img {
        width: 20px;
        height: 20px;
        display: block;
        object-fit: contain;
        pointer-events: none;
    }

    &:hover {
        border-color: rgba(248, 250, 252, 0.24);
        background: rgba(248, 250, 252, 0.08);
    }

    &:focus-visible {
        outline: 2px solid rgba(248, 250, 252, 0.42);
        outline-offset: 2px;
    }
`;

export const FiltersList = styled.div`
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    z-index: 1000;

    width: 192px;
    padding: 6px;

    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 2px;

    border-radius: 8px;
    border: 1px solid rgba(248, 250, 252, 0.12);
    background: var(--theme-container-secondary-dark, #151827);
    box-shadow: 0 14px 34px rgba(0, 0, 0, 0.34);
`;

export const CheckboxWrapper = styled.div`
    ${flexCenter};
    justify-content: space-between;
    width: 100%;
    padding: 8px;
`;

export const OptionLabel = styled.div`
    color: var(--theme-font-unselected-tertiary-color);
    text-align: center;
    font-size: 12px;
`;
