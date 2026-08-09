import styled from "styled-components";

import {flexCenter} from "../../../../../assets/style";
import backIcon from "../icons/v2/back-big.svg";
import closeIcon from "../icons/v2/x-mark.svg";

interface Props {
    disabled?: boolean;
    onClick: () => void;
}

export const CloseButton = ({onClick}: Props) => {
    return (
        <Button onClick={onClick}>
            <img src={closeIcon}
                alt="close"
            />
        </Button>
    );
};

export const BackButton = ({onClick}: Props) => {
    return (
        <Button onClick={onClick}>
            <img src={backIcon}
                alt="back"
            />
        </Button>
    );
};

const Button = styled.div`
    display: inline-block;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--theme-container-milky);
    cursor: pointer;
    transition: 0.3s ease;
    ${flexCenter};
    flex-shrink: 0;

    &:hover {
        background: var(--theme-container-milky-hover);
    }
`;
