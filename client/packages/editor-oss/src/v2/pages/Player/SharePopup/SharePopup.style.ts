import styled from "styled-components";

import {absoluteCenter, flexCenter} from "../../../../assets/style";

// Local copy of the AvatarCreator ActionButton so SharePopup doesn't depend
// on the AvatarCreator module (which is a no-op compatibility shim here).
export const ActionButton = styled.button<{
    $background: string;
    $color: string;
    $widthAuto?: boolean;
    $disabled?: boolean;
}>`
    width: 104px;
    padding: 14px 32px;
    margin: 0;

    border: none;
    border-radius: 8px;

    font-size: 14px;
    font-weight: 700;
    color: ${({$color}) => $color};
    cursor: pointer;
    pointer-events: all;

    background: ${({$background}) => $background};

    ${({$widthAuto}) => $widthAuto && `width: auto; padding: 10px; flex-grow: 1;`};
    ${({$disabled}) => $disabled && `opacity: 0.5; cursor: not-allowed;`};
`;

export const Wrapper = styled.div`
    width: 505px;
    background: #141729;
    border-radius: 16px;
    padding: 16px;
    display: flex;
    justify-content: flex-start;
    align-items: flex-start;
    flex-direction: column;
    ${absoluteCenter};
    position: fixed;
    pointer-events: all;
`;

export const ModelPreview = styled.div<{$bgImg?: string}>`
    width: 100%;
    height: 228px;
    border-radius: 8px;
    background: var(--theme-grey-bg);
    background-image: url(${props => props.$bgImg});
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
    flex-shrink: 0;
`;

export const ShareSpace = styled.div`
    width: 100%;
    display: flex;
    align-items: center;
    column-gap: 8px;
    flex-shrink: 0;
`;

export const LinkBox = styled.div`
    width: 398px;
    height: 38px;
    margin: 20px 0 22px;
    background: var(--theme-grey-bg);
    border-radius: 8px;
    display: flex;
    padding: 4px 8px;
    align-items: center;
    user-select: text;

    color: #b2b2b9;
    font-size: 12px;
`;

export const GameDetails = styled.div`
    width: 100%;
    ${flexCenter};
    flex-direction: column;
    justify-content: flex-start;
    row-gap: 16px;
    flex-grow: 1;
`;

export const GameTitle = styled.div`
    color: #fff;
    text-align: center;
    font-size: 16px;
    font-weight: 600;
    width: 100%;
`;
export const AdditionalData = styled.div`
    color: #f8fafccc;
    text-align: center;
    font-size: 12px;
    width: 100%;
`;

export const Description = styled.div`
    max-width: 100%;
    flex-shrink: 0;
    color: #e9e9e9;
    font-size: 12px;
    line-height: 141%;
    max-height: 60px;
    min-height: 40px;
    text-align: center;
    p {
        padding: 0;
        margin: 0;
    }

    .language-javascript {
        max-width: 100%;
        white-space: pre-wrap;
        word-break: break-word;
    }
`;

export const ButtonsWrapper = styled.div`
    ${flexCenter};
    column-gap: 8px;
    width: 100%;
    padding-top: 16px;
    margin-top: 24px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    flex-shrink: 0;
`;
