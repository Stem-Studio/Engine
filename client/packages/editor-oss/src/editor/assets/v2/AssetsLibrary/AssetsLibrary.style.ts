import styled from "styled-components";

import {flexCenter, regularFont} from "../../../../assets/style";

const NAV_HEIGHT = "56px";
const FILTER_HEIGHT = "34px";
export const FILTER_MARGIN = "10px";
export const LIBRARY_HEIGHT = "500px";

export const Wrapper = styled.div<{$isFullScreen?: boolean}>`
    position: relative;
    z-index: 101;

    background-color: var(--theme-container-main-dark);
    border: 1px solid var(--theme-grey-bg);
    border-radius: 16px;

    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: flex-start;
    pointer-events: all;
    color: white;

    transition:
        width 0.3s ease,
        height 0.3s ease;
    ${({$isFullScreen}) =>
        $isFullScreen
            ? `
        width: 100vw;
        height: 100vh;
        `
            : `
        width: 800px;
    height: ${LIBRARY_HEIGHT};
    `}

    @media (max-width: 600px) {
        width: 100vw;
        height: 100dvh;
        border-radius: 0;
    }
`;

export const Nav = styled.div`
    width: 100%;
    height: ${NAV_HEIGHT};
    padding: 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--theme-grey-bg);

    @media (max-width: 960px) {
        height: 64px;
        min-height: 64px;
        padding: 5px 8px;
        gap: 4px;

        > div:first-child {
            min-width: 0;
            flex: 1 1 auto;
            overflow-x: auto;
            overflow-y: hidden;
        }

        .library-nav-actions {
            min-width: 220px;
            flex: 0 1 260px;
        }

        .library-nav-actions > div:first-child {
            width: auto !important;
            min-width: 100px;
            height: 44px;
            flex: 1 1 auto;
        }

        .library-window-actions {
            flex: 0 0 auto;
        }

        .library-window-actions button {
            width: 44px;
            height: 44px;
            border-radius: 8px;
        }
    }

    @media (max-width: 600px) {
        height: 112px;
        min-height: 112px;
        padding: 6px 8px;
        flex-direction: column;
        align-items: stretch;
        gap: 4px;

        > div:first-child {
            width: 100%;
            overflow-x: auto;
            overflow-y: hidden;
        }

        .library-nav-actions {
            width: 100%;
            min-width: 0;
            justify-content: space-between;
        }

        .library-nav-actions > div:first-child {
            width: auto !important;
            min-width: 0;
            flex: 1 1 auto;
        }

        .library-window-actions {
            flex: 0 0 auto;
        }

        .library-window-actions button {
            width: 44px;
            height: 44px;
            border-radius: 8px;
        }
    }
`;

export const InfoContainer = styled.div<{$filtersRendered: boolean}>`
    width: 340px;
    height: 100%;
    flex-shrink: 0;
    border-left: 1px solid var(--theme-container-divider);
    padding: 19px 42px;
    position: relative;

    ${({$filtersRendered}) =>
        $filtersRendered &&
        `
        height: calc(45px + 100%);
        margin-top: -44px;
        `}

    .label {
        color: var(--theme-font-unselected-tertiary-color);
        font-size: 12px;
    }

    .infoCard {
        top: 60px;
        left: 42px;
        right: unset;
        transform: unset;
        background: var(--theme-grey-bg);
        height: auto;
        max-height: calc(100% - 60px - 19px); // 100 - top value - padding
    }

    @media only screen and (max-width: 1279px) {
        padding: 19px 16px;
        width: 298px;
        .infoCard {
            left: 16px;
        }
    }

    @media (max-width: 960px) {
        display: none;
    }
`;

export const AssetsContainaer = styled.div`
    flex-grow: 1;
    padding: 10px 20px 20px 20px;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-start;
    row-gap: 20px;

    .StyledSceneList {
        grid-template-columns: repeat(auto-fill, minmax(108px, 1fr));
        padding: 0;
        grid-gap: 19px;
    }

    .SceneImage {
        border-radius: 8px 8px 0 0;
        aspect-ratio: 108 / 107;
    }
    .SceneDetailsWrapper {
        margin-top: -8px;
        background: #1a1d30;
        padding: 9px 8px;
        border-radius: 0 0 8px 8px;
        .textContainer {
            padding: 0;
        }
    }
    .SceneName {
        font-size: var(--theme-font-size-extra-small);
        font-weight: 700;
        color: #fff;
    }
    .EditedText {
        height: 11px;
        font-size: 10px;
        color: var(--theme-font-unselected-tertiary-color);
    }

    @media (max-width: 600px) {
        padding: 8px;
        row-gap: 12px;
        min-width: 0;
    }
`;

export const FlexWrapper = styled.div<{$gap?: string}>`
    ${flexCenter};
    ${({$gap}) => $gap && `gap: ${$gap}`};
`;

export const MainFlexWrapper = styled.div<{$filtersRendered: boolean}>`
    ${flexCenter};
    width: 100%;
    height: calc(100% - ${NAV_HEIGHT});
    ${({$filtersRendered}) =>
        $filtersRendered && `height: calc(100% - ${NAV_HEIGHT} - ${FILTER_HEIGHT} - ${FILTER_MARGIN});`}

    @media (max-width: 960px) {
        height: calc(100% - 64px);
        ${({$filtersRendered}) =>
            $filtersRendered && `height: calc(100% - 64px - 54px - ${FILTER_MARGIN});`}
        min-height: 0;
    }

    @media (max-width: 600px) {
        height: calc(100% - 112px);
        ${({$filtersRendered}) =>
            $filtersRendered && `height: calc(100% - 112px - ${FILTER_HEIGHT} - ${FILTER_MARGIN});`}
        min-height: 0;
    }
`;

export const IconButton = styled.button`
    background: #2a2e42 !important;
    border-top: 1px solid #353952 !important;
    width: 24px;
    height: 24px;
    padding: 4px;
    border-radius: 8px;
    ${flexCenter};
    img.deleteIcon,
    .revisionsIcon {
        width: 16px;
    }

    @media (max-width: 600px), (max-width: 960px) and (max-height: 600px) {
        width: 44px;
        height: 44px;
        padding: 10px;
    }
`;

export const LibraryTopInfo = styled.div`
    height: 24px;
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;

    .libName {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        display: inline-block;
        max-width: 120px;
    }
`;

export const Divider = styled.div`
    background: var(--theme-grey-bg);
    height: 1px;
    width: 100%;
    flex-shrink: 0;
`;

export const EmptyListMessage = styled.div`
    ${regularFont("s")};
    text-align: center;
    width: 100%;
`;
