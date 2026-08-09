import styled from "styled-components";

export const StyledNav = styled.nav`
    position: fixed;
    /* Keep the player host controls above body-level runtime HUD overlays. */
    z-index: 10000;
    top: 0;
    left: 0;
    right: 0;
    width: 100%;
    height: 48px;
    background: #171a21;
    color: #f8fafc;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px;
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.06);
`;

export const LeftSide = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    width: 240px;
`;

export const IconButton = styled.button`
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: #f8fafc;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;

    &:hover {
        background: #262b35;
    }
`;

export const SceneNameWrapper = styled.div`
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    max-width: 180px;
    min-width: 0;
    font-size: 13px;
`;

export const Middle = styled.div`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    background: #2a2f3a;
    padding: 2px;
    border-radius: 8px;
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
`;

export const Right = styled.div`
    width: 240px;
    display: flex;
    justify-content: flex-end;
`;

export const NavButton = styled.button<{$active?: boolean}>`
    width: 78px;
    height: 28px;
    border: 0;
    border-radius: 6px;
    background: ${({$active}) => $active ? "#0284c7" : "transparent"};
    color: #f8fafc;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0;
    cursor: pointer;

    &:disabled {
        cursor: not-allowed;
        opacity: 0.45;
    }
`;

export const ModalBackdrop = styled.div`
    position: fixed;
    inset: 0;
    z-index: 3000;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
`;

export const Modal = styled.div`
    width: min(460px, 100%);
    max-height: min(560px, calc(100vh - 32px));
    overflow: auto;
    border-radius: 8px;
    background: #171a21;
    color: #f8fafc;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
`;

export const ModalHeader = styled.div`
    padding: 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
`;

export const ModalTitle = styled.h2`
    margin: 0;
    font-size: 16px;
    font-weight: 700;
`;

export const RemixList = styled.div`
    display: grid;
    gap: 8px;
    padding: 12px;
`;

export const RemixButton = styled.button`
    border: 0;
    border-radius: 6px;
    background: #232833;
    color: #f8fafc;
    min-height: 44px;
    padding: 10px 12px;
    text-align: left;
    cursor: pointer;
    font-size: 13px;

    &:hover {
        background: #2d3442;
    }
`;

export const ModalActions = styled.div`
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px 16px;
`;

export const ActionButton = styled.button<{$primary?: boolean}>`
    border: 0;
    border-radius: 6px;
    background: ${({$primary}) => $primary ? "#0284c7" : "#2a2f3a"};
    color: #f8fafc;
    min-height: 32px;
    padding: 0 12px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;

    &:hover {
        filter: brightness(1.08);
    }
`;
