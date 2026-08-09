import {useEffect, useRef, useState, type RefObject} from "react";
import styled from "styled-components";
import {useOnClickOutside} from "usehooks-ts";

import {Tooltip} from "./Tooltip";
import searchIconSmall from "../icons/search-icon-small.svg";
import searchIconWhite from "../icons/search-icon-white.svg";
import closeIcon from "../icons/x-mark.svg";

const Wrapper = styled.div<{
    $width?: string;
    $height?: string;
    $searchActive: boolean;
    $disabled?: boolean;
    $milky?: boolean;
}>`
    position: relative;
    box-sizing: border-box;
    ${({$searchActive}) => !$searchActive && `cursor: pointer;`};

    ${({$milky, $width, $searchActive}) =>
        $milky &&
        `
    background: var(--theme-container-milky);
    border-radius: 50%;
    width: 32px;
    height: 32px;
    &:hover {
        background: var(--theme-container-milky-hover);
    }
    ${
        $searchActive &&
        `
    width: ${$width};
    border-radius: 16px;
    &:hover {
        background: var(--theme-container-milky);
    }
    `
    };
    `};
    > input {
        width: ${({$width, $searchActive}) => (!$searchActive ? 0 : $width ? $width : "170px")};
        height: ${({$height}) => ($height ? $height : "32px")};
        border: none;
        box-sizing: border-box;
        border-radius: 8px;
        background: var(--theme-grey-bg);
        padding: 0 16px 0 32px;
        font-size: var(--theme-font-size-s);
        font-weight: var(--theme-font-regular);
        line-height: 120%;
        text-align: left;
        color: var(--theme-font-input-color);
        font-family: "Inter";
        &::placeholder {
            color: #a1a1aa;
        }
        opacity: ${props => (props.$searchActive ? 1 : 0)};
        pointer-events: ${props => (props.$searchActive ? "auto" : "none")};
        ${props => props.$disabled && "cursor: not-allowed"};

        ${({$milky}) =>
            $milky &&
            `
     background: transparent;
     color:#FAFAFA;
     font-weight: var(--theme-font-medium-plus);
     border-radius: 16px;
     &::placeholder {
        color: #d3d3d3;
    }
     `};
    }

    @media (max-width: 600px), (max-width: 960px) and (max-height: 600px) {
        min-width: 44px;
        min-height: 44px;

        > input {
            height: 44px;
        }
    }
`;

const IconWrapper = styled.div`
    position: absolute;
    top: 50%;
    left: 8px;
    transform: translateY(-50%);
    width: 16px !important;
    height: 16px;
    cursor: pointer;
`;

const CloseSearch = styled(IconWrapper)`
    left: calc(100% - 8px);
    transform: translate(-100%, -50%);
`;

type Props = {
    value: string;
    onChange: (value: string) => void;
    className?: string;
    width?: string;
    height?: string;
    placeholder?: string;
    alwaysOpen?: boolean;
    disabled?: boolean;
    milky?: boolean;
    customIcon?: string;
    onActiveSearchChange?: (arg: boolean) => void;
    tooltipText?: string;
};

export const SearchInput = ({
    value,
    onChange,
    className,
    width,
    height,
    placeholder,
    alwaysOpen,
    disabled,
    milky,
    onActiveSearchChange,
    customIcon,
    tooltipText,
}: Props) => {
    const [searchActive, setSearchActive] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useOnClickOutside(inputRef as unknown as RefObject<HTMLElement>, () => {
        if (alwaysOpen) return;
        setSearchActive(false);
        onActiveSearchChange?.(false);
    });

    useEffect(() => {
        if (searchActive && inputRef.current) {
            inputRef.current.focus();
        }
    }, [searchActive]);

    return (
        <Wrapper
            $milky={milky}
            $disabled={disabled}
            className={className}
            $width={width}
            $height={height}
            $searchActive={alwaysOpen !== undefined ? alwaysOpen : searchActive}
            onClick={() => {
                if (alwaysOpen) return;
                setSearchActive(true);
                onActiveSearchChange?.(true);
            }}
        >
            <IconWrapper className="searchIcon-inputArea">
                {tooltipText && !searchActive ? (
                    <Tooltip
                        text={tooltipText}
                        triggerWidth="32px"
                        triggerHeight="32px"
                        padding="3px 12px"
                    >
                        <img
                            src={milky ? searchIconWhite : searchIconSmall}
                            alt="search-icon-small"
                        />
                    </Tooltip>
                ) : (
                    <img
                        src={customIcon ? customIcon : milky ? searchIconWhite : searchIconSmall}
                        alt="search-icon-small"
                    />
                )}
            </IconWrapper>
            {searchActive && (
                <CloseSearch onClick={() => setSearchActive(false)}>
                    <img
                        src={closeIcon}
                        alt="search"
                    />
                </CloseSearch>
            )}
            <input
                readOnly={disabled}
                type="text"
                ref={inputRef}
                placeholder={placeholder || "Search"}
                value={value}
                onChange={e => onChange(e.target.value)}
                className="searchInput"
            />
        </Wrapper>
    );
};
