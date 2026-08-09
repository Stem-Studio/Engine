import {useTranslation} from "react-i18next";
import styled from "styled-components";

import {loginButtonCommonCss} from "./LoginPage.style";
import discordIconPurple from "../../assets/discord-purple.svg";
import discordIcon from "../../assets/discord-white.svg";
import {DISCORD_LINK} from "../constants";

type DiscordButtonType = "join" | "login";

interface DiscordButtonProps {
    $white?: boolean;
    $width?: string;
    $fontSize?: string;
    type: DiscordButtonType;
    signup?: boolean;
}

export const DiscordButton: React.FC<DiscordButtonProps> = ({$white, $width, $fontSize, type}) => {
    const {t} = useTranslation();

    if (type !== "join" || !DISCORD_LINK) return null;

    return (
        <StyledDiscordButton
            id="discordButton"
            className="DiscordButton"
            onClick={() => window.open(DISCORD_LINK, "_blank")}
            $fontSize={$fontSize}
            $white={$white}
            $width={$width}
            data-testid="discord-join-button"
        >
            {$white ? (
                <img
                    src={discordIconPurple}
                    alt=""
                    className="icon"
                />
            ) : (
                <img
                    src={discordIcon}
                    alt=""
                    className="icon"
                />
            )}
            {t("Join our Discord")}
        </StyledDiscordButton>
    );
};

const StyledDiscordButton = styled.button<Pick<DiscordButtonProps, "$white" | "$width" | "$fontSize">>`
    ${loginButtonCommonCss};
    background-color: ${({$white}) => ($white ? "#fff" : "#5865f2")} !important;
    ${({$width}) => ($width ? `width: ${$width}` : "width: 100%")};
    text-align: center;
    column-gap: 8px;
    border: none;
    white-space: nowrap;
    transition: all 0.2s;
    cursor: pointer;
    color: ${({$white}) => ($white ? "#3F3F46" : "#f8fafccc")};
    ${({$fontSize}) => $fontSize && `font-size: ${$fontSize}`};

    &:hover {
        transform: translateY(-1px);
        background-color: ${({$white}) => ($white ? "#f4f4f5" : "#4752c4")} !important;
    }

    &:active {
        transform: translateY(0);
    }

    .icon {
        width: 31px;
    }
`;
