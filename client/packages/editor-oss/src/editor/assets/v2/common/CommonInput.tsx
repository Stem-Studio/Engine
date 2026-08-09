import styled from "styled-components";

import {regularFont} from "../../../../assets/style";

interface Props {
    placeholder: string;
    id: string;
    label: string;
    value: string;
    setValue: (value: string) => void;
    className?: string;
    disabled?: boolean;
    toLowercase?: boolean;
    isNumeric?: boolean;
}

export const CommonInput = ({
    value,
    setValue,
    className,
    disabled,
    label,
    id,
    placeholder,
    toLowercase,
    isNumeric,
}: Props) => {
    const handleKeyDown = (event: any) => {
        if (!/[\d.-]|Backspace/.test(event.key)) {
            event.preventDefault();
        }
    };
    const numericPattern = "-?[0-9]*[.,]?[0-9]*";
    return (
        <Wrapper disabled={!!disabled}>
            <label htmlFor={id}>{label}</label>
            <StyledInput
                className={`${className} CommonInput`}
                type="text"
                inputMode={isNumeric ? "decimal" : "text"}
                value={value}
                onChange={e => toLowercase ? setValue(e.target.value.toLowerCase()) : setValue(e.target.value)}
                disabled={!!disabled}
                id={id}
                placeholder={placeholder}
                onKeyDown={isNumeric ? handleKeyDown : undefined}
                pattern={isNumeric ? numericPattern : undefined}
            />
        </Wrapper>
    );
};

const StyledInput = styled.input`
    width: 269px;
    height: 36px;
    border: none;
    border-radius: 6px;
    background-color: var(--theme-container-secondary-dark);
    ${regularFont("s")};
    color: var(--theme-font-main-selected-color);
    padding: 0 14px;
`;

const Wrapper = styled.div<{disabled: boolean}>`
    ${({disabled}) =>
        disabled &&
        `
    opacity: 0.5;
    `}
    label {
        display: block;
        ${regularFont("s")};
        margin-left: 14px;
        margin-bottom: 5px;
    }
`;
