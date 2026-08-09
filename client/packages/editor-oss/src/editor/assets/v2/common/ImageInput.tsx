import styled from "styled-components";

import {flexCenter, regularFont} from "../../../../assets/style";

interface Props {
    placeholder: string;
    id: string;
    label: string;
    value: string;
    setValue: (value: string) => void;
    className?: string;
    disabled?: boolean;
}

export const ImageInput = ({value, setValue, className, disabled, label, id, placeholder}: Props) => {
    return (
        <Wrapper>
            <label htmlFor={id}>{label}</label>
            <StyledInput
                className={`${className} CommonInput`}
                type="text"
                value={value}
                onChange={e => setValue(e.target.value)}
                disabled={!!disabled}
                id={id}
                placeholder={placeholder}
            />
        </Wrapper>
    );
};

const StyledInput = styled.input`
    width: 269px;
    height: 109px;
    border: none;
    border-radius: 6px;
    background-color: var(--theme-container-secondary-dark);
    font-size: 32px;
    color: var(--theme-font-main-selected-color);
    ${flexCenter};
`;

const Wrapper = styled.div`
    label {
        display: block;
        ${regularFont("s")};
        margin-left: 14px;
        margin-bottom: 5px;
    }
`;
