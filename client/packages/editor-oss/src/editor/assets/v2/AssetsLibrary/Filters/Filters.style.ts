import styled from "styled-components";

import {FILTER_MARGIN} from "../AssetsLibrary.style";

export const Row = styled.div<{$isFullScreen: boolean}>`
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: ${({$isFullScreen}) => ($isFullScreen ? "calc(100% - 340px)" : "100%")};
    padding: 0 20px;
    margin-top: ${FILTER_MARGIN};
    padding-bottom: 10px;

    @media (max-width: 960px) {
        width: 100%;
        min-height: 54px;
        padding: 0 8px 10px;
        gap: 8px;
    }
`;
export const FlexWrapper = styled.div`
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: 8px;

    .StyledCombobox {
        width: 100px;
    }

    label {
        color: var(--theme-font-unselected-tertiary-color);
        font-size: 12px;
    }
`;
