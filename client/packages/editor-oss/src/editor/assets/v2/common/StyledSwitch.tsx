import type {ChangeEvent, CSSProperties} from "react";
import styled from "styled-components";

import StringUtils from "@stem/editor-oss/utils/StringUtils";

type Props = {
    checked: boolean | string;
    onChange: (e: ChangeEvent<HTMLInputElement | undefined>) => void;
    style?: CSSProperties;
    disabled?: boolean;
    ariaLabel?: string;
    dataTestId?: string;
};

export const StyledSwitch = ({checked, onChange, style, disabled, ariaLabel, dataTestId}: Props) => {
    return (
        <Switch style={style}
            $disabled={disabled}
            className="SwitchComponent"
            data-testid={dataTestId}
        >
            <input
                type="checkbox"
                checked={StringUtils.parseBoolean(checked?.toString()) ?? false}
                onChange={onChange}
                disabled={disabled}
                aria-label={ariaLabel}
            />
            <Slider className="slider round" />
        </Switch>
    );
};

const Switch = styled.label<{$disabled?: boolean}>`
    position: relative;
    display: inline-block;
    width: 32px;
    height: 16px;

    ${({$disabled}) =>
        $disabled &&
        `
        opacity: 0.4;
 cursor: not-allowed;
 * {
     cursor: not-allowed !important;
 }
    `};

    input {
        opacity: 0;
        width: 0;
        height: 0;
    }

    input:not(:checked) + .slider {
        background-color: var(--theme-grey-bg-secondary);
    }

    input:not(:checked) + .slider:before {
        background-color: #5b6178;
    }

    input:checked + .slider:before {
        -webkit-transform: translate(16px, -50%);
        -ms-transform: translate(16px, -50%);
        transform: translate(16px, -50%);
        background-color: #fafafa;
    }
`;

const Slider = styled.span`
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: #4F46E5;
    -webkit-transition: 0.4s;
    transition: 0.4s;
    border-radius: 13px;

    &:before {
        position: absolute;
        content: "";
        height: 16px;
        width: 16px;
        left: 0px;
        top: 50%;
        transform: translateY(-50%);
        background-color: white;
        -webkit-transition: 0.4s;
        transition: 0.4s;
        border-radius: 50%;
    }
`;
