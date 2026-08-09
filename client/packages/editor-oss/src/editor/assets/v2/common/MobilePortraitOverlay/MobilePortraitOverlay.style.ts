import styled from "styled-components";

import {flexCenter} from "../../../../../assets/style";

export const Overlay = styled.div`
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    min-height: 100vh;
    height: 100dvh;
    padding: max(32px, env(safe-area-inset-top, 0px)) max(24px, env(safe-area-inset-right, 0px))
        max(32px, env(safe-area-inset-bottom, 0px)) max(24px, env(safe-area-inset-left, 0px));
    background:
        radial-gradient(circle at 50% 34%, rgba(2, 132, 199, 0.2), transparent 34%),
        var(--theme-container-main-dark, #0b1020);
    z-index: 10001;
    ${flexCenter};
    flex-direction: column;
    gap: 16px;
`;

export const IconShell = styled.div`
    width: 96px;
    height: 96px;
    display: grid;
    place-items: center;
    border: 1px solid rgba(147, 197, 253, 0.28);
    border-radius: 24px;
    background: rgba(2, 132, 199, 0.12);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
`;

export const Title = styled.h2`
    color: #ffffff;
    font-size: 22px;
    font-weight: 600;
    margin: 0;
    text-align: center;
    line-height: 1.2;
`;

export const Subtitle = styled.p`
    color: rgba(255, 255, 255, 0.7);
    font-size: 14px;
    margin: 0;
    text-align: center;
    max-width: 320px;
    line-height: 1.5;
`;
