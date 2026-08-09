import {useTranslation} from "react-i18next";
import {useMediaQuery} from "usehooks-ts";

import {
    FOOTER_MOBILE_QUERY,
    InsideColumn,
    LeftColumn,
    MidColumn,
    MobileColumn,
    RightColumn,
    ShadowContainer,
    StyledFooter,
    MobileRow,
} from "./Footer.style";
import {ROUTES} from "@web-shared/routes";
import discord from "../assets/discord-grey.svg";
import stemStudioLogo from "../../editor/assets/v2/HUD/HUDView/FloatingNav/AppVersion/stem-studio-alpha.png";
import {Shadow} from "../common/Shadow/Shadow.style";
import {BLOG_LINK, DISCORD_LINK, FORUM_LINK} from "../pages/constants";

const COPYRIGHT_HOLDER = "StemStudio";

interface IColumns {
    label: string;
    options: {
        text: string;
        href: string;
        target?: string;
    }[];
}

export const Footer = () => {
    const {t} = useTranslation();
    const isMobile = useMediaQuery(FOOTER_MOBILE_QUERY);

    const playColumn: IColumns = {
        label: t("Play"),
        options: [],
    };
    const createColumn: IColumns = {label: t("Create"), options: [{text: t("Studio"), href: ROUTES.HOME}]};
    const communityColumn: IColumns = {
        label: t("Community"),
        options: [
            BLOG_LINK ? {text: t("Blog"), href: BLOG_LINK, target: "_blank"} : null,
            FORUM_LINK ? {text: t("Forum"), href: FORUM_LINK, target: "_blank"} : null,
        ].filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    };
    const companyColumn: IColumns = {
        label: t("Company"),
        options: [],
    };
    const legalColumn: IColumns = {
        label: t("Legal"),
        options: [{text: t("Open Source Licenses"), href: ROUTES.THIRD_PARTY_ATTRIBUTIONS}],
    };

    const INSIDE_COLUMNS: IColumns[] = [
        playColumn,
        createColumn,
        communityColumn,
        companyColumn,
        legalColumn,
    ].filter(col => col.options.length > 0);

    const MOBILE_INSIDE_COLUMNS: IColumns[][] = [
        [playColumn, createColumn],
        [communityColumn],
        [companyColumn, legalColumn],
    ].map(group => group.filter(col => col.options.length > 0))
     .filter(group => group.length > 0);

    const renderInsideColumn = ({label, options}: IColumns) => (
        <InsideColumn key={label}>
            <div className="label">{label}</div>
            {options.map(({text, href, target}) =>
                <Link text={text}
                    href={href}
                    target={target}
                    key={text}
                />,
            )}
        </InsideColumn>
    );

    return (
        <StyledFooter id="footer">
            <ShadowContainer>
                <Shadow $left
                    $bottom
                />
            </ShadowContainer>
            {isMobile ?
                <>
                    <MobileRow>
                        <img src={stemStudioLogo}
                            alt="StemStudio"
                            style={{height: 28}}
                        />
                        <DiscordButton />
                    </MobileRow>
                    <MidColumn $mobileGrid>
                        {MOBILE_INSIDE_COLUMNS.map((columns) =>
                            <MobileColumn key={columns.map(({label}) => label).join("-")}>
                                {columns.map(renderInsideColumn)}
                            </MobileColumn>,
                        )}
                    </MidColumn>
                    <MobileRow>
                        <span className="copyright">© {new Date().getFullYear()} {COPYRIGHT_HOLDER}</span>
                        <span className="copyright">{t("All Rights Reserved")}</span>
                    </MobileRow>
                </>
             :
                <>
                    <LeftColumn>
                        <img src={stemStudioLogo}
                            alt="StemStudio"
                            style={{height: 28}}
                        />
                        <span className="copyright">© {new Date().getFullYear()} {COPYRIGHT_HOLDER}</span>
                    </LeftColumn>
                    <MidColumn>
                        {INSIDE_COLUMNS.map(renderInsideColumn)}
                    </MidColumn>
                    <RightColumn>
                        <DiscordButton />
                        <span className="copyright">{t("All Rights Reserved")}</span>
                    </RightColumn>
                </>
            }
        </StyledFooter>
    );
};

interface LinkProps {
    text: string;
    href: string;
    target?: string;
}
const Link = ({text, href, target}: LinkProps) => {
    const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
        if (window.location.pathname === href) {
            e.preventDefault();
            const container = document.getElementById("container");
            container?.scrollTo({top: 0, behavior: "smooth"});
        }
    };

    return (
        <a
            className={href ? "option" : "option disabled"}
            href={href ? href : undefined}
            target={target}
            rel="noopener noreferrer"
            onClick={handleClick}
        >
            {text}
        </a>
    );
};

export const DiscordButton = () => {
    if (!DISCORD_LINK) return null;
    return (
        <button
            className="reset-css"
            onClick={() => {
                window.open(DISCORD_LINK, "_blank");
            }}
        >
            <img src={discord}
                alt="Discord"
            />
        </button>
    );
};
