import {PaginationWrapper, StyledPaginationButton} from "./SectionHeader.style";
import arrowIcon from "../../../icons/arrow-down.svg";

export const PaginationButton = ({
    label,
    onClick,
    isBottom = false,
    iconDirection = "down",
}: {
    label: string;
    onClick: () => void;
    isBottom?: boolean;
    iconDirection?: "up" | "down";
}) => {
    return (
        <PaginationWrapper $isBottom={isBottom}>
            <StyledPaginationButton
                className="reset-css"
                onClick={onClick}
            >
                {label}
                <img
                    src={arrowIcon}
                    alt=""
                    style={iconDirection === "up" ? {transform: "rotate(180deg)"} : undefined}
                />
            </StyledPaginationButton>
        </PaginationWrapper>
    );
};
