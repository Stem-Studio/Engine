import styled, {css} from "styled-components";

const flexCenter = css`
    display: flex;
    justify-content: center;
    align-items: center;
`;

const regularFont = (size: "xs" | "s") => css`
    font-size: var(--theme-font-size-${size});
    font-weight: var(--theme-font-regular);
    line-height: 120%;
    color: var(--theme-font-main-selected-color);
`;

export const Overlay = styled.div`
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(6px);
    z-index: 1500;
    ${flexCenter};
`;

export const Container = styled.div`
    width: 720px;
    max-width: 95vw;
    background: #2a2d35;
    border-radius: 20px;
    box-shadow: 0 6px 28px rgba(0, 0, 0, 0.45);
    padding: 28px 28px 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
`;

export const Title = styled.h1`
    margin: 0;
    font-weight: 700;
    font-size: 22px;
    color: #ffffff;
`;

export const Subtitle = styled.p`
    ${regularFont("s")};
    margin: 0;
    color: #9ba2ae;
    line-height: 1.5;
`;

export const Options = styled.div`
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;

    @media only screen and (max-width: 640px) {
        grid-template-columns: 1fr;
    }
`;

export const OptionCard = styled.button<{$selected?: boolean; $disabled?: boolean}>`
    border: 1px solid ${({$selected}) => ($selected ? "#5b9dff" : "#3e424c")};
    background: ${({$selected}) => ($selected ? "#34394a" : "#363940")};
    color: inherit;
    border-radius: 12px;
    padding: 18px;
    text-align: left;
    cursor: ${({$disabled}) => ($disabled ? "not-allowed" : "pointer")};
    opacity: ${({$disabled}) => ($disabled ? 0.55 : 1)};
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: border-color 0.12s, background 0.12s;

    &:hover {
        ${({$disabled}) =>
            !$disabled &&
            css`
                border-color: #5b9dff;
            `};
    }
`;

export const OptionTitle = styled.div`
    font-weight: 700;
    font-size: 16px;
    color: #ffffff;
`;

export const OptionDescription = styled.div`
    ${regularFont("xs")};
    color: #9ba2ae;
    line-height: 1.4;
`;

export const OptionTag = styled.div<{$tone?: "info" | "warning"}>`
    align-self: flex-start;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 2px 8px;
    border-radius: 999px;
    color: ${({$tone}) => ($tone === "warning" ? "#ffd773" : "#9bd0ff")};
    background: ${({$tone}) => ($tone === "warning" ? "rgba(255, 215, 115, 0.12)" : "rgba(155, 208, 255, 0.12)")};
`;

export const Footer = styled.div`
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-top: 4px;
`;

export const FooterNote = styled.div`
    ${regularFont("xs")};
    color: #6e7682;
`;

export const PrimaryButton = styled.button<{$disabled?: boolean}>`
    background: ${({$disabled}) => ($disabled ? "#3a3f49" : "#5b9dff")};
    color: ${({$disabled}) => ($disabled ? "#6e7682" : "#ffffff")};
    border: none;
    border-radius: 8px;
    padding: 10px 22px;
    font-weight: 600;
    font-size: 14px;
    cursor: ${({$disabled}) => ($disabled ? "not-allowed" : "pointer")};
`;

export const ErrorText = styled.div`
    ${regularFont("xs")};
    color: #ff8b8b;
    margin-top: 4px;
`;
