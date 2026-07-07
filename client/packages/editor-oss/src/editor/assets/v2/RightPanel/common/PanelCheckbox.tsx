import styled from "styled-components";

import {flexCenter} from "../../../../../assets/style";
import {Checkbox} from "../../../../../ui/common/Checkbox";
import {MarqueeLabel} from "../../common/MarqueeLabel";
import {StyledSwitch} from "../../common/StyledSwitch";
import {Tooltip} from "../../common/Tooltip";
import {Label} from "../RightPanel.style";

interface Props {
    text?: string;
    checked: boolean;
    onChange: (e: React.ChangeEvent<HTMLInputElement | undefined>) => void;
    isLocked?: boolean;
    v2?: boolean;
    regular?: boolean;
    isGray?: boolean;
    white?: boolean;
    height?: string;
    disabled?: boolean;
    id?: string;
    lockedReason?: string;
    // Optional inline tooltip next to the label
    tooltipText?: string;
    tooltipWidth?: string;
    dataTestId?: string;
    inputAriaLabel?: string;
    switchDataTestId?: string;
}

export const PanelCheckbox = ({
    text,
    checked,
    onChange,
    isLocked,
    v2,
    white,
    regular,
    isGray,
    disabled,
    id,
    height,
    lockedReason,
    tooltipText,
    tooltipWidth,
    dataTestId,
    inputAriaLabel,
    switchDataTestId,
}: Props) => {
    if (v2) {
        return (
            <Wrapper
                className="panelCheckboxWrapper"
                style={{margin: 0}}
                $height={height}
                title={(disabled || isLocked) && lockedReason ? lockedReason : undefined}
                data-testid={dataTestId}
            >
                {text &&
                    <div className="checkboxLabelWrapper"
                        style={{display: "flex", alignItems: "center", flex: 1, minWidth: 0}}
                    >
                        <MarqueeLabel>
                            <Label
                                $disabled={disabled}
                                $regular={regular}
                                $isGray={isGray}
                                style={{margin: 0}}
                                className="checkboxLabel"
                            >
                                {text}
                            </Label>
                        </MarqueeLabel>
                    </div>
                }
                <div style={{display: "flex", alignItems: "center", gap: 6, flexShrink: 0}}>
                    {tooltipText && <Tooltip text={tooltipText}
                        width={tooltipWidth || "320px"}
                                    />}
                    <StyledSwitch checked={checked}
                        onChange={onChange}
                        disabled={disabled || isLocked}
                        ariaLabel={inputAriaLabel || text}
                        dataTestId={switchDataTestId || (dataTestId ? `${dataTestId}-switch` : undefined)}
                    />
                </div>
            </Wrapper>
        );
    } else {
        return (
            <Wrapper title={(isLocked || disabled) && lockedReason ? lockedReason : undefined}
                $height={height}
                data-testid={dataTestId}
            >
                <span className="text"
                    style={white ? {color: "white"} : undefined}
                >
                    {text}
                </span>
                <div style={{display: "flex", alignItems: "center", gap: 6, flexShrink: 0}}>
                    {tooltipText && <Tooltip text={tooltipText}
                        width={tooltipWidth || "320px"}
                                    />}
                    <Checkbox
                        checked={checked}
                        onChange={onChange}
                        disabled={isLocked}
                        customId={id || text || "customId"}
                    />
                </div>
            </Wrapper>
        );
    }
};

const Wrapper = styled.div<{$height?: string}>`
    ${flexCenter};
    ${({$height}) => `height: ${$height}`};
    justify-content: space-between;
    width: 100%;
    margin-bottom: 12px;
    .text {
        font-size: var(--theme-font-size-s);
        font-weight: var(--theme-font-regular);
        color: var(--theme-font-unselected-color);
        line-height: 120%;
        text-align: left;
    }

    input,
    label {
        margin: 0;
    }
`;
