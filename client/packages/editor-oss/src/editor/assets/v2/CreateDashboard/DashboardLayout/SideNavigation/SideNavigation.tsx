import {useNavigate} from "react-router-dom";
import {useMediaQuery} from "usehooks-ts";

import discordLogo from "./icons/discord-logo.svg";
import xLogo from "./icons/x-logo.svg";
import ytLogo from "./icons/yt-logo.svg";
import {
    AdminPill,
    AdminPillLabel,
    BottomGroup,
    IconChip,
    List,
    Nav,
    NavLogo,
    ListItem,
    ListWrapper,
    Socials,
} from "./SideNavigation.style";
import {ROUTES} from "@web-shared/routes";
import {useAppGlobalContext} from "@stem/editor-oss/context/AppGlobalContext";
import {useAuthorizationContext} from "@stem/editor-oss/context/AuthorizationContext";
import {Avatar} from "../../../Avatar/Avatar";
import logo from "../../../HUD/HUDView/FloatingNav/AppVersion/stem-studio-alpha.png";
import {DASHBOARD_MENU, PAGES} from "../../constants";
import {getConfiguredSocialLinks} from "@stem/editor-oss/v2/pages/constants";
import {MOBILE_DASHBOARD_BREAKPOINT} from "../DashboardHeader/DashboardHeader.style";
import {getEditorDocsUrl} from "../../../common/docsUrl";

// Map env-configured channels to local logo assets. Channels with no env
// value are omitted from the list by `getConfiguredSocialLinks()`, so the
// row collapses gracefully when a deployment hasn't wired any social URLs.
const SOCIAL_LOGOS: Record<"discord" | "x" | "youtube", string> = {
    discord: discordLogo,
    x: xLogo,
    youtube: ytLogo,
};

type Props = {
    mobileOpen?: boolean;
    onClose?: () => void;
};

export const SideNavigation = ({mobileOpen = false, onClose}: Props) => {
    const {isAdmin, dbUser} = useAuthorizationContext();
    const {activePage} = useAppGlobalContext();
    const navigate = useNavigate();
    const isMobile = useMediaQuery(`(max-width: ${MOBILE_DASHBOARD_BREAKPOINT})`);
    const showAdminPill = isAdmin;

    const handleActivePage = async (label: PAGES) => {
        if (label === PAGES.TUTORIALS) {
            window.open(getEditorDocsUrl(), "_blank");
            onClose?.();
            return;
        }
        if (label === PAGES.LEARN) {
            window.open(getEditorDocsUrl(), "_blank");
            onClose?.();
            return;
        }
        if (label === PAGES.FORUM) {
            window.open(`https://forum.${window.location.hostname}`, "_blank");
            onClose?.();
            return;
        }
        const key = Object.keys(PAGES).find(key => PAGES[key as keyof typeof PAGES] === label);
        if (key) {
            await navigate(`${ROUTES[key as keyof typeof ROUTES]}`);
            onClose?.();
        }
    };

    const disabledItem = (label: string) =>
        label !== PAGES.DASHBOARD &&
        label !== PAGES.DISCOVER &&
        label !== PAGES.TUTORIALS &&
        label !== PAGES.ADMIN_PANEL &&
        label !== PAGES.SETTINGS &&
        label !== PAGES.LEARN &&
        label !== PAGES.FORUM;

    return (
        <Nav $mobileOpen={mobileOpen}>
            <NavLogo onClick={() => navigate(ROUTES.HOME)}>
                <img src={logo} alt="StemStudio" />
            </NavLogo>
            <ListWrapper>
                <List>
                    {DASHBOARD_MENU.map(({label, icon: Icon}) => (
                        <ListItem
                            $active={activePage === label}
                            key={label}
                            onClick={() => (disabledItem(label) ? undefined : handleActivePage(label))}
                            $disabled={disabledItem(label)}
                        >
                            <IconChip className="icon-chip">
                                <Icon className="icon" />
                            </IconChip>
                            {label}
                        </ListItem>
                    ))}
                </List>
                <BottomGroup>
                    {showAdminPill && (
                        <AdminPill
                            $active={activePage === PAGES.ADMIN_PANEL}
                            onClick={() => handleActivePage(PAGES.ADMIN_PANEL)}
                            aria-label="Admin panel"
                        >
                            <Avatar
                                name={dbUser?.username || dbUser?.name || undefined}
                                image={dbUser?.avatar || undefined}
                                size={28}
                            />
                            <AdminPillLabel>{PAGES.ADMIN_PANEL}</AdminPillLabel>
                        </AdminPill>
                    )}
                    {!isMobile && getConfiguredSocialLinks().length > 0 && (
                        <Socials>
                            {getConfiguredSocialLinks().map(({kind, url}) => (
                                <a
                                    key={kind}
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <img
                                        src={SOCIAL_LOGOS[kind]}
                                        alt={kind}
                                    />
                                </a>
                            ))}
                        </Socials>
                    )}
                </BottomGroup>
            </ListWrapper>
        </Nav>
    );
};
