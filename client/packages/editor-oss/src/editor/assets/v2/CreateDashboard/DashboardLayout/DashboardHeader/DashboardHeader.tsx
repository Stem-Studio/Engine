import {useEffect, useRef, useState, type ReactNode} from "react";
import {
    HiOutlineBars3,
    HiOutlineArrowRightOnRectangle,
    HiOutlineCheck,
    HiOutlineChevronDown,
    HiOutlineCog6Tooth,
    HiOutlineFolder,
    HiOutlineQuestionMarkCircle,
    HiOutlineSparkles,
    HiOutlineUserCircle,
    HiOutlineXMark,
} from "react-icons/hi2";
import {TbDeviceGamepad2} from "react-icons/tb";
import {useTranslation} from "react-i18next";
import {useLocation, useNavigate, useSearchParams} from "react-router-dom";
import {useMediaQuery} from "usehooks-ts";

import remixStatIcon from "../../icons/remix-stat.svg";

import {
    DesktopRightItems,
    HeaderWrapper,
    RightSide,
    Logo,
    LoginButton,
    IconButton,
    HeaderTopRow,
    MobileDrawer,
    MobileDrawerAction,
    MobileDrawerBackdrop,
    MobileDrawerHeader,
    MobileDrawerNav,
    MobileDrawerSection,
    MobileMenuTrigger,
    NavLink,
    PrimaryNav,
    MyProjectsSplit,
    MyProjectsSplitInner,
    MyProjectsMain,
    MyProjectsChevron,
    MyProjectsMenu,
    MyProjectsMenuItem,
    NavDivider,
} from "./DashboardHeader.style";
import {ROUTES} from "@web-shared/routes";
import {useAppGlobalContext} from "@stem/editor-oss/context/AppGlobalContext";
import {useAuthorizationContext} from "@stem/editor-oss/context/AuthorizationContext";
import {Avatar} from "../../../Avatar/Avatar";
import {Tooltip} from "../../../common/Tooltip";
import logo from "../../../HUD/HUDView/FloatingNav/AppVersion/stem-studio-alpha.png";
import {PAGES} from "../../constants";
import {trackNavigationClick} from "@stem/editor-oss/utils/productAnalytics";

const DASHBOARD_FTUE_SEARCH_PARAM = "dashboard-ftue";
const DASHBOARD_GUIDE_ROUTES = new Set<string>([
    ROUTES.HOME,
    ROUTES.DASHBOARD,
    ROUTES.MY_AVATARS,
    ROUTES.BROWSE,
    ROUTES.DISCOVER,
    ROUTES.REMIX,
    ROUTES.SETTINGS,
    ROUTES.ADMIN_PANEL,
]);

const RemixNavIcon = () => (
    <img
        src={remixStatIcon}
        alt=""
        aria-hidden="true"
    />
);

type NavItem = {
    label: PAGES;
    displayLabel: string;
    route: string;
    renderIcon: () => ReactNode;
};

const NAV_ITEMS: NavItem[] = [
    {
        label: PAGES.DASHBOARD,
        displayLabel: PAGES.DASHBOARD,
        route: ROUTES.HOME,
        renderIcon: () => <HiOutlineSparkles />,
    },
    {
        label: PAGES.REMIX,
        displayLabel: PAGES.REMIX,
        route: ROUTES.REMIX,
        renderIcon: () => <RemixNavIcon />,
    },
    {
        label: PAGES.BROWSE,
        displayLabel: "Browse Games",
        route: ROUTES.BROWSE,
        renderIcon: () => <TbDeviceGamepad2 />,
    },
];

// In the local app, the meaningful surfaces are Create (home) and My Projects.
// They render with the same text-link styling as Create — no buttons, no
// chips. Remix / Browse / community feeds require a remote gallery service
// and are dropped.
const OSS_NAV_ITEMS: NavItem[] = [
    {
        label: PAGES.DASHBOARD,
        displayLabel: PAGES.DASHBOARD,
        route: ROUTES.HOME,
        renderIcon: () => <HiOutlineSparkles />,
    },
    {
        label: PAGES.PROJECTS,
        displayLabel: PAGES.PROJECTS,
        route: ROUTES.DASHBOARD,
        renderIcon: () => <HiOutlineFolder />,
    },
];
const PHONE_HEADER_QUERY = "(max-width: 720px)";

export const DashboardHeader = () => {
    const {t} = useTranslation();
    const {isAuthorized, dbUser, isAdmin} = useAuthorizationContext();
    const {activePage} = useAppGlobalContext();
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();
    const isPhoneHeader = useMediaQuery(PHONE_HEADER_QUERY);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [myProjectsMenuOpen, setMyProjectsMenuOpen] = useState(false);
    const myProjectsSplitRef = useRef<HTMLDivElement>(null);

    const handleOpenGuide = () => {
        const nextSearchParams = new URLSearchParams(searchParams);
        nextSearchParams.set(DASHBOARD_FTUE_SEARCH_PARAM, "true");
        setSearchParams(nextSearchParams, {replace: true});
    };

    const handleLoginClick = () => {
        const loginEndpoint = process.env.REACT_APP_LOGIN_ENDPOINT;
        trackNavigationClick(ROUTES.LOGIN, "header_sign_in");
        if (loginEndpoint) {
            window.location.href = loginEndpoint;
            return;
        }
        window.location.assign(ROUTES.LOGIN);
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!(e.metaKey || e.ctrlKey)) return;
            if (e.key !== "k" && e.key !== "K") return;
            const input = document.querySelector<HTMLInputElement>(".searchInput");
            if (!input) return;
            e.preventDefault();
            input.focus();
            input.select();
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, []);

    useEffect(() => {
        setMobileMenuOpen(false);
    }, [location.pathname, location.search]);

    useEffect(() => {
        if (!mobileMenuOpen) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setMobileMenuOpen(false);
            }
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [mobileMenuOpen]);

    const navigateToCreate = () => {
        const destination = ROUTES.HOME;
        trackNavigationClick(destination, "header_logo");
        navigate(destination);
    };
    const handleMyProjectsClick = () => {
        trackNavigationClick(ROUTES.DASHBOARD, "header_my_projects");
        if (!isAuthorized) {
            navigate(ROUTES.LOGIN, {state: {from: ROUTES.DASHBOARD}});
            return;
        }
        navigate(ROUTES.DASHBOARD);
    };
    const handleMyAvatarsClick = () => {
        trackNavigationClick(ROUTES.MY_AVATARS, "header_my_avatars");
        if (!isAuthorized) {
            navigate(ROUTES.LOGIN, {state: {from: ROUTES.MY_AVATARS}});
            return;
        }
        navigate(ROUTES.MY_AVATARS);
    };
    const isAvatarsActive = activePage === PAGES.AVATARS;
    const isProjectsActive = activePage === PAGES.PROJECTS;
    const handleMainSplitClick = () => {
        if (isAvatarsActive) {
            handleMyAvatarsClick();
        } else {
            handleMyProjectsClick();
        }
    };

    useEffect(() => {
        if (!myProjectsMenuOpen) return;
        const handlePointerDown = (event: MouseEvent) => {
            if (!myProjectsSplitRef.current) return;
            if (myProjectsSplitRef.current.contains(event.target as Node)) return;
            setMyProjectsMenuOpen(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setMyProjectsMenuOpen(false);
        };
        document.addEventListener("mousedown", handlePointerDown);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("mousedown", handlePointerDown);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [myProjectsMenuOpen]);

    useEffect(() => {
        setMyProjectsMenuOpen(false);
    }, [location.pathname]);
    const showGuideButton = isAuthorized && DASHBOARD_GUIDE_ROUTES.has(location.pathname);
    const normalizedActivePage = activePage === PAGES.DISCOVER ? PAGES.BROWSE : activePage;
    const navSource = OSS_NAV_ITEMS;
    const visibleNavItems = isPhoneHeader
        ? navSource.filter(({label}) => label === PAGES.DASHBOARD || label === PAGES.BROWSE || label === PAGES.PROJECTS)
        : navSource;
    const isVisibleNavActive = (label: PAGES) => {
        if (normalizedActivePage === label) return true;
        if (!isPhoneHeader) return false;

        return label === PAGES.BROWSE && normalizedActivePage !== PAGES.DASHBOARD && normalizedActivePage !== PAGES.BROWSE;
    };
    const navigateFromDrawer = (route: string, source: string) => {
        trackNavigationClick(route, source);
        navigate(route);
        setMobileMenuOpen(false);
    };
    const openGuideFromDrawer = () => {
        handleOpenGuide();
        setMobileMenuOpen(false);
    };
    const canShowAdmin = isAuthorized && !!dbUser && isAdmin;

    return (
        <HeaderWrapper $sticky>
            <HeaderTopRow>
                <Logo onClick={navigateToCreate}>
                    <img
                        src={logo}
                        alt="StemStudio"
                    />
                </Logo>

                <PrimaryNav aria-label="Primary navigation">
                    {visibleNavItems.map(({label, displayLabel, route, renderIcon}) => {
                        const active = isVisibleNavActive(label);
                        const targetRoute = route;

                        return (
                            <NavLink
                                key={`${label}-${route}`}
                                onClick={() => {
                                    trackNavigationClick(targetRoute, `header_${label.toLowerCase()}`);
                                    navigate(targetRoute);
                                }}
                                $active={active}
                                aria-current={active ? "page" : undefined}
                                data-testid={`nav-${label.toLowerCase()}`}
                            >
                                {renderIcon()}
                                <span>{displayLabel}</span>
                            </NavLink>
                        );
                    })}
                </PrimaryNav>

                <RightSide>
                    <DesktopRightItems>
                        {isAuthorized ? (
                            <>
                                {showGuideButton && (
                                    <Tooltip
                                        text={t("Guide")}
                                        triggerWidth="56px"
                                        triggerHeight="56px"
                                        padding="3px 12px"
                                    >
                                        <IconButton
                                            onClick={handleOpenGuide}
                                            aria-label={t("Open guide")}
                                        >
                                            <HiOutlineQuestionMarkCircle />
                                        </IconButton>
                                    </Tooltip>
                                )}
                                {canShowAdmin && (
                                    <IconButton
                                        onClick={() => navigate(ROUTES.ADMIN_PANEL)}
                                        aria-label={t("Admin panel")}
                                        $active={activePage === PAGES.ADMIN_PANEL}
                                        data-testid="nav-admin"
                                    >
                                        <HiOutlineCog6Tooth />
                                    </IconButton>
                                )}
                            </>
                        ) : (
                            <>
                                <NavDivider />
                                <LoginButton
                                    onClick={handleLoginClick}
                                    data-testid="nav-sign-in"
                                >
                                    {t("Sign in")}
                                </LoginButton>
                            </>
                        )}
                    </DesktopRightItems>
                    <MobileMenuTrigger
                        type="button"
                        onClick={() => setMobileMenuOpen(true)}
                        aria-label={t("Open menu")}
                        aria-expanded={mobileMenuOpen}
                        data-testid="mobile-menu-open"
                    >
                        <HiOutlineBars3 />
                    </MobileMenuTrigger>
                </RightSide>
            </HeaderTopRow>
            <MobileDrawerBackdrop
                type="button"
                aria-hidden="true"
                $open={mobileMenuOpen}
                onClick={() => setMobileMenuOpen(false)}
            />
            <MobileDrawer
                $open={mobileMenuOpen}
                aria-hidden={!mobileMenuOpen}
                data-testid="mobile-menu-drawer"
            >
                <MobileDrawerHeader>
                    <img
                        src={logo}
                        alt="StemStudio"
                    />
                    <button
                        type="button"
                        onClick={() => setMobileMenuOpen(false)}
                        aria-label={t("Close menu")}
                    >
                        <HiOutlineXMark />
                    </button>
                </MobileDrawerHeader>
                <MobileDrawerNav aria-label="Menu navigation">
                    <MobileDrawerSection>
                        {OSS_NAV_ITEMS.map(({label, displayLabel, route, renderIcon}) => (
                            <MobileDrawerAction
                                key={`mobile-${label}-${route}`}
                                type="button"
                                onClick={() => navigateFromDrawer(route, `mobile_menu_${label.toLowerCase()}`)}
                                $active={normalizedActivePage === label}
                                data-testid={`mobile-menu-${label.toLowerCase()}`}
                            >
                                {renderIcon()}
                                <span>{displayLabel}</span>
                            </MobileDrawerAction>
                        ))}
                    </MobileDrawerSection>
                    <MobileDrawerSection>
                        {isAuthorized ? (
                            <>
                                {showGuideButton && (
                                    <MobileDrawerAction
                                        type="button"
                                        onClick={openGuideFromDrawer}
                                    >
                                        <HiOutlineQuestionMarkCircle />
                                        <span>{t("Guide")}</span>
                                    </MobileDrawerAction>
                                )}
                                {canShowAdmin && (
                                    <MobileDrawerAction
                                        type="button"
                                        onClick={() => navigateFromDrawer(ROUTES.ADMIN_PANEL, "mobile_menu_admin")}
                                        $active={normalizedActivePage === PAGES.ADMIN_PANEL}
                                        data-testid="mobile-menu-admin"
                                    >
                                        <HiOutlineCog6Tooth />
                                        <span>{t("Admin")}</span>
                                    </MobileDrawerAction>
                                )}
                                <MobileDrawerAction
                                    type="button"
                                    onClick={() => navigateFromDrawer(ROUTES.SETTINGS, "mobile_menu_settings")}
                                    $active={normalizedActivePage === PAGES.SETTINGS}
                                >
                                    <HiOutlineCog6Tooth />
                                    <span>{t("Settings")}</span>
                                </MobileDrawerAction>
                            </>
                        ) : (
                            <MobileDrawerAction
                                type="button"
                                onClick={() => {
                                    setMobileMenuOpen(false);
                                    handleLoginClick();
                                }}
                            >
                                <HiOutlineArrowRightOnRectangle />
                                <span>{t("Sign in")}</span>
                            </MobileDrawerAction>
                        )}
                    </MobileDrawerSection>
                </MobileDrawerNav>
            </MobileDrawer>
        </HeaderWrapper>
    );
};
