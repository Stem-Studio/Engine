import {lazy, Suspense, useEffect, useMemo, useState} from "react";
import {HiOutlineBookOpen} from "react-icons/hi2";
import {TbDeviceGamepad2} from "react-icons/tb";
import {useLocation, useNavigate, useSearchParams} from "react-router-dom";

import {useTemplateIds} from "@stem/network/api/templates/hooks";
import {useAppGlobalContext} from "@stem/editor-oss/context/AppGlobalContext";
import {useAuthorizationContext} from "@stem/editor-oss/context/AuthorizationContext";
import {useHomepageContext} from "@stem/editor-oss/context/HomepageContext";
import global from "@stem/editor-oss/global";
import {ROUTES} from "@web-shared/routes";
import {trackPageView} from "@stem/editor-oss/utils/productAnalytics";
import {openEditorRoute} from "../../../../v2/pages/editorHandoff";
import {SearchInput} from "../common/SearchInput";
import scenePlaceholder from "../icons/stem-studio-project-placeholder.png";
import {FileData} from "../types/file";
import {PAGES} from "./constants";
import {
    BrowseSearchInputWrap,
    BrowseSearchSection,
    BrowseSearchTargetButton,
    BrowseSearchTargetControls,
    DiscoverEmptyMedia,
    DiscoverEmptyPlaceholder,
    DiscoverEmptyState,
    DiscoverEmptyText,
    DiscoverEmptyTitle,
    WidthWrapper,
} from "./CreateDashboard.style";
import {CreateDashboardView} from "./CreateDashboardView/CreateDashboardView";
import {DashboardFTUEModal, type DashboardFTUEAction} from "./DashboardFTUEModal/DashboardFTUEModal";
import searchIcon from "./DashboardLayout/DashboardHeader/icons/search.svg";
import {DashboardLayout} from "./DashboardLayout/DashboardLayout";
import {
    combineUniqueProjects,
    sortByMostRecentCreation,
    sortByMostRecentUpdate,
    sortProjectsByMetric,
} from "./projectSorting";
import {ImportStemscriptBanner} from "./ImportStemscriptBanner";
import {OpenFolderBanner} from "./OpenFolderBanner";
import {ReconnectFolderBanner} from "./ReconnectFolderBanner";
import {RemixDashboardView} from "./RemixDashboardView/RemixDashboardView";
import {CTABanners} from "./SceneList/CTABanners/CTABanners";
import {GamesSections} from "./SceneList/GamesSections/GamesSections";
import {TutorialsSearchSection} from "./TutorialsSearchSection/TutorialsSearchSection";
import {fetchPublishedScenes} from "@stem/network/api/scene/list";
// Keep dashboard theme tokens in the dashboard entry chunk. Lazy-loaded
// panels must not determine whether the shell receives its color variables.
import "../../../../ui/Config.css";

const AdminPanel = lazy(() => import("./AdminPanel/AdminPanel").then(module => ({default: module.AdminPanel})));
const GameOverview = lazy(() => import("./GameOverview/GameOverview").then(module => ({default: module.GameOverview})));
const MyAvatarsView = lazy(() => import("./MyAvatarsView/MyAvatarsView").then(module => ({default: module.MyAvatarsView})));
const SettingsPage = lazy(() => import("./SettingsPage/SettingsPage").then(module => ({default: module.SettingsPage})));

export interface IGamesSection {
    label: SECTION;
    scenes: FileData[];
    maxItems?: number;
    showSeeMore?: boolean;
    /** Server-side pagination controls from React Query infinite query */
    pagination?: {
        hasNextPage: boolean;
        isFetchingNextPage: boolean;
        fetchNextPage: () => void;
    };
}

export enum SECTION {
    PROJECTS = "Projects",
    TOP_PICKS = "Top Picks",
    USER_HISTORY = "My Projects",
    MOST_REMIXED = "Most Remixed",
    JUST_PUBLISHED = "Just Published",
    CONTINUE_PLAYING = "Continue Playing",
    COMMUNITY = "Community",
}

export type CommunityFilterType = "most_played" | "most_remixed" | "most_shared" | "most_hearted";
export type ProjectFilterType =
    | "created_by"
    | "creation_date"
    | "date_modified"
    | "shared"
    | "archived"
    | "plays"
    | "likes"
    | "remixed"
    | "shared_count";

const DASHBOARD_FTUE_STORAGE_KEY = "finishedDashboardFTUEUsers";
const DASHBOARD_FTUE_SEARCH_PARAM = "dashboard-ftue";
const AUTH_ROUTE_PATHS = new Set<string>([
    ROUTES.LOGIN,
    ROUTES.SIGN_UP,
    ROUTES.REGISTER,
    ROUTES.WAITLIST,
    ROUTES.FORGOT_PASSWORD,
]);
const BROWSE_SEARCH_DEBOUNCE_MS = 300;
const BROWSE_SEARCH_RESULT_LIMIT = 40;
const BROWSE_SEARCH_TAG_LIMIT = 6;

type BrowseSearchExternalTargets = {
    docs: boolean;
};

const resolvePageFromPath = (pathname: string) => {
    if (pathname === ROUTES.HOME) return PAGES.DASHBOARD;
    if (pathname === ROUTES.DASHBOARD) return PAGES.PROJECTS;
    if (
        pathname === ROUTES.MY_AVATARS ||
        pathname === ROUTES.MY_AVATARS_NEW ||
        pathname.startsWith("/my-avatars/edit/")
    ) {
        return PAGES.AVATARS;
    }
    if (pathname === ROUTES.BROWSE || pathname === ROUTES.DISCOVER) return PAGES.BROWSE;
    if (pathname === ROUTES.REMIX) return PAGES.REMIX;
    if (pathname === ROUTES.SETTINGS) return PAGES.SETTINGS;
    if (pathname === ROUTES.ADMIN_PANEL) return PAGES.ADMIN_PANEL;
    return undefined;
};

// Set to true to inject 50 dummy scenes into each Discover section for testing pagination/show-more.
const DEBUG_FILL_SECTIONS = false;

/**
 *
 * @param count
 * @param prefix
 */
function generateDummyScenes(count: number, prefix: string): FileData[] {
    return Array.from({length: count}, (_, i) => ({
        ID: `debug-${prefix}-${i}`,
        Name: `${prefix} Game ${i + 1}`,
        Thumbnail: "",
        Image: "",
        PlayCount: Math.floor(Math.random() * 10000),
        RemixCount: Math.floor(Math.random() * 500),
        ShareCount: Math.floor(Math.random() * 300),
        Likes: Math.floor(Math.random() * 2000),
        Tags: "",
        UpdateTime: new Date().toISOString(),
        IsPublic: true,
        IsCloneable: true,
        Version: 1,
        UserID: "debug-user",
    })) as unknown as FileData[];
}

const mergeUniqueScenes = (...groups: FileData[][]) => {
    const seen = new Set<string>();
    const merged: FileData[] = [];

    for (const group of groups) {
        for (const scene of group) {
            if (!scene?.ID || seen.has(scene.ID)) continue;
            seen.add(scene.ID);
            merged.push(scene);
        }
    }

    return merged;
};

const getBrowseSearchTagQuery = (query: string) => {
    const terms = query
        .split(/[,\s]+/)
        .map(term => term.trim().replace(/[^a-z0-9_-]/gi, ""))
        .filter(Boolean);

    return Array.from(new Set(terms)).slice(0, BROWSE_SEARCH_TAG_LIMIT).join(",");
};

export const CreateDashboard = () => {
    const homepageContext = useHomepageContext();

    const {
        myGames,
        shouldRefreshDashboard,
        setShouldRefreshDashboard,
        communityGames,
        topPicksGames,
        collaborativeGames,
        archivedGames,
        updateMyGames,
        updateArchivedGames,
        updateCollaborativeGames,
        updateCommunityGames,
        updateTopPicksGames,
        projectsFilter,
        communityFilter,
        search,
        setSearch,
        communityGamesSection,
    } = homepageContext;
    const app = global.app;
    const {isAuthorized, isInitializingAuth, dbUser, isWhitelisted, isAdmin} = useAuthorizationContext();
    const {setActivePage, activePage} = useAppGlobalContext();
    const userId = app?.userId;

    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();
    const tab = searchParams.get("tab");
    const shouldForceOpenDashboardFTUE = searchParams.get(DASHBOARD_FTUE_SEARCH_PARAM) === "true";
    const isGameOverviewRoute = location.pathname.startsWith("/game/");
    const isAdminRoute = location.pathname === ROUTES.ADMIN_PANEL;
    const isBrowseRoute = location.pathname === ROUTES.BROWSE || location.pathname === ROUTES.DISCOVER;
    const isPublicDashboardRoute = isBrowseRoute || location.pathname === ROUTES.REMIX || isGameOverviewRoute;
    const accessForbidden = isWhitelisted === false && isAuthorized && !isPublicDashboardRoute;
    const adminAccessForbidden =
        isAdminRoute && isAuthorized && !isInitializingAuth && isWhitelisted !== undefined && !!dbUser && !isAdmin;

    const [isDashboardFTUEVisible, setIsDashboardFTUEVisible] = useState(false);
    const [dashboardFTUEStep, setDashboardFTUEStep] = useState(0);
    const [remoteBrowseSearchGames, setRemoteBrowseSearchGames] = useState<FileData[]>([]);
    const [browseSearchExternalTargets, setBrowseSearchExternalTargets] = useState<BrowseSearchExternalTargets>({
        docs: false,
    });
    const getFinishedDashboardFTUEUsers = () =>
        JSON.parse(localStorage.getItem(DASHBOARD_FTUE_STORAGE_KEY) || "[]") as string[];

    const markDashboardFTUEFinished = () => {
        if (!userId) return;

        const finishedUsers = getFinishedDashboardFTUEUsers();
        if (finishedUsers.includes(userId)) return;

        localStorage.setItem(DASHBOARD_FTUE_STORAGE_KEY, JSON.stringify([...finishedUsers, userId]));
    };

    const removeErrorParam = () => {
        if (searchParams.has("tab")) {
            const nextSearchParams = new URLSearchParams(searchParams);
            nextSearchParams.delete("tab");
            // Must replace, not push — otherwise the `?tab=` cleanup inserts
            // an intermediate history entry between the dashboard and a
            // subsequent /game/:id navigation, and browser Back lands on the
            // same /game/:id URL instead of returning to the previous page.
            setSearchParams(nextSearchParams, {replace: true});
        }
    };

    const closeDashboardFTUE = () => {
        markDashboardFTUEFinished();
        setIsDashboardFTUEVisible(false);
        setDashboardFTUEStep(0);

        if (searchParams.has(DASHBOARD_FTUE_SEARCH_PARAM)) {
            const nextSearchParams = new URLSearchParams(searchParams);
            nextSearchParams.delete(DASHBOARD_FTUE_SEARCH_PARAM);
            setSearchParams(nextSearchParams, {replace: true});
        }
    };

    const toggleBrowseSearchExternalTarget = (target: keyof BrowseSearchExternalTargets) => {
        setBrowseSearchExternalTargets(prev => ({
            ...prev,
            [target]: !prev[target],
        }));
    };

    // DOT-7545: only honour the `?tab=` deep-link when explicitly provided.
    // Prior code unconditionally set activePage=DASHBOARD whenever `tab`
    // changed, which raced with the pathname-driven effect below and caused
    // activePage to bounce `undefined -> DASHBOARD -> DISCOVER` on /discover
    // refresh, triggering duplicate refetches and corrupting infinite-query
    // page ordering. activePage is now derived from pathname as the single
    // source of truth; this effect only runs when tab is present.
    useEffect(() => {
        if (isGameOverviewRoute) return;
        if (!tab) return;
        const key = tab.toLocaleUpperCase() as keyof typeof PAGES;
        if (PAGES[key]) {
            setActivePage(PAGES[key]);
        }
        removeErrorParam();
    }, [isGameOverviewRoute, tab]);

    useEffect(() => {
        if (!isAuthorized || !userId) return;

        if (shouldForceOpenDashboardFTUE) {
            setIsDashboardFTUEVisible(true);
            setDashboardFTUEStep(0);
            return;
        }

        const finishedUsers = getFinishedDashboardFTUEUsers();
        if (!finishedUsers.includes(userId)) {
            setIsDashboardFTUEVisible(true);
            setDashboardFTUEStep(0);
        }
    }, [isAuthorized, shouldForceOpenDashboardFTUE, userId]);

    const update = async ({force = false}: {force?: boolean} = {}) => {
        if (!isAuthorized) {
            return;
        }

        // Update based on active page to avoid unnecessary API calls
        switch (activePage) {
            case PAGES.DASHBOARD: {
                const promises = [
                    updateMyGames({force}),
                    updateCollaborativeGames({force}),
                    updateCommunityGames({force}),
                    updateTopPicksGames({force}),
                    updateArchivedGames({force}),
                ];

                await Promise.all(promises);
                break;
            }
            case PAGES.PROJECTS:
                await Promise.all([
                    updateMyGames({force}),
                    updateCollaborativeGames({force}),
                    updateArchivedGames({force}),
                ]);
                break;
            case PAGES.DISCOVER:
            case PAGES.REMIX:
                await Promise.all([
                    updateCommunityGames({force}),
                    updateTopPicksGames({force}),
                    updateMyGames({force}),
                    updateCollaborativeGames({force}),
                ]);
                break;
            default:
                break;
        }
    };

    const handleDashboardFTUEAction = (action: DashboardFTUEAction) => {
        markDashboardFTUEFinished();
        setIsDashboardFTUEVisible(false);

        if (searchParams.has(DASHBOARD_FTUE_SEARCH_PARAM)) {
            const nextSearchParams = new URLSearchParams(searchParams);
            nextSearchParams.delete(DASHBOARD_FTUE_SEARCH_PARAM);
            setSearchParams(nextSearchParams, {replace: true});
        }

        if (action === "community") {
            void navigate(ROUTES.BROWSE);
            return;
        }

        if (action === "collaborative") {
            void navigate(ROUTES.DASHBOARD);
            return;
        }

        if (action === "create") {
            openEditorRoute(ROUTES.CREATE_PROJECT, {autoCreate: true});
            return;
        }

        window.open(`https://docs.${window.location.hostname}`, "_blank");
    };

    // DOT-7545: removed the eager `useEffect(() => update(), [dbUser?.id,
    // isAuthorized, activePage])` that ran on every route/auth change.
    // It was racing with:
    //   - CreateDashboardView's recursive fetchNextPage cascade
    //   - The scenePublished invalidation handler in HomepageContext
    //   - Its own prior in-flight refetches when activePage bounced
    // Freshness is now driven entirely by React Query's native mechanisms
    // (initialPageParam, staleTime 10m, refetchInterval 10m) plus explicit
    // invalidations from the scenePublished / shouldRefreshDashboard /
    // archivedScenes event handlers below. `update()` is still callable by
    // mutation handlers that need an immediate refresh.

    useEffect(() => {
        if (!app) return;

        const handleArchivedScenesRefresh = () => {
            void updateArchivedGames({force: true});
        };

        app.on("fetchArchivedScenes.CreateDashboard", handleArchivedScenesRefresh);

        return () => {
            app.on("fetchArchivedScenes.CreateDashboard", null);
        };
    }, [app, updateArchivedGames]);

    useEffect(() => {
        if (shouldRefreshDashboard) {
            void update({force: true});
            setShouldRefreshDashboard(false);
        }
    }, [shouldRefreshDashboard]);

    useEffect(() => {
        if (location.pathname === ROUTES.DISCOVER) {
            void navigate(`${ROUTES.BROWSE}${location.search}${location.hash}`, {replace: true});
            return;
        }
        if (isInitializingAuth) return;
        if (isGameOverviewRoute) return;
        const pathname = window.location.pathname === ROUTES.DISCOVER ? ROUTES.BROWSE : window.location.pathname;
        if (AUTH_ROUTE_PATHS.has(pathname)) return;
        const page = resolvePageFromPath(pathname);
        if (isAuthorized) {
            setActivePage(page || PAGES.DASHBOARD);
        } else if (pathname === ROUTES.HOME || pathname === ROUTES.BROWSE || pathname === ROUTES.REMIX) {
            setActivePage(page || PAGES.DASHBOARD);
        } else {
            void navigate(ROUTES.HOME);
            setActivePage(PAGES.DASHBOARD);
        }
    }, [
        isGameOverviewRoute,
        location.hash,
        location.pathname,
        location.search,
        isInitializingAuth,
        isAuthorized,
        navigate,
        setActivePage,
    ]);

    useEffect(() => {
        if (accessForbidden) {
            void navigate(ROUTES.LOGIN);
        }
    }, [accessForbidden]);

    useEffect(() => {
        if (!adminAccessForbidden) return;

        setActivePage(PAGES.PROJECTS);
        void navigate(ROUTES.DASHBOARD, {replace: true});
    }, [adminAccessForbidden, navigate, setActivePage]);

    useEffect(() => {
        const query = search.trim();
        if (activePage !== PAGES.BROWSE || !query) {
            setRemoteBrowseSearchGames([]);
            return;
        }

        let cancelled = false;
        const timeoutId = window.setTimeout(() => {
            const tagQuery = getBrowseSearchTagQuery(query);

            void Promise.all([
                fetchPublishedScenes({
                    name: query,
                    limit: BROWSE_SEARCH_RESULT_LIMIT,
                    includeCloneableForAdmin: isAdmin,
                }),
                tagQuery
                    ? fetchPublishedScenes({
                          tags: tagQuery,
                          limit: BROWSE_SEARCH_RESULT_LIMIT,
                          includeCloneableForAdmin: isAdmin,
                      })
                    : Promise.resolve(null),
            ])
                .then(([nameResults, tagResults]) => {
                    if (cancelled) return;
                    setRemoteBrowseSearchGames(mergeUniqueScenes(nameResults.Scenes || [], tagResults?.Scenes || []));
                })
                .catch(error => {
                    if (cancelled) return;
                    console.error("[CreateDashboard] Browse search failed:", error);
                    setRemoteBrowseSearchGames([]);
                });
        }, BROWSE_SEARCH_DEBOUNCE_MS);

        return () => {
            cancelled = true;
            window.clearTimeout(timeoutId);
        };
    }, [activePage, isAdmin, search]);

    useEffect(() => {
        document.title = "StemStudio";
    }, []);

    useEffect(() => {
        if (isGameOverviewRoute) {
            trackPageView("game_overview", {path: location.pathname});
            return;
        }

        trackPageView(String(activePage || PAGES.DASHBOARD).toLowerCase(), {
            path: location.pathname,
            signed_in: isAuthorized,
        });
    }, [activePage, isAuthorized, isGameOverviewRoute, location.pathname]);

    const {data: resolvedTemplateIds = []} = useTemplateIds();
    const envTemplateIds = useMemo(() => {
        return (process.env.REACT_APP_PROJECT_TEMPLATES || "")
            .split(",")
            .map(id => id.trim())
            .filter(Boolean);
    }, []);
    const templateIds = useMemo(
        () => Array.from(new Set([...envTemplateIds, ...resolvedTemplateIds].map(id => String(id)))),
        [envTemplateIds, resolvedTemplateIds],
    );

    const recentlyViewed = useMemo(() => {
        if (!dbUser?.recentlyViewed?.length) return [];
        const projects = [...(communityGames || []), ...(myGames || []), ...(collaborativeGames || [])];
        const map = new Map(projects.map(p => [String(p.ID), p]));
        return dbUser.recentlyViewed
            .map((id: string) => map.get(String(id)))
            .filter((el): el is FileData => !!el && !templateIds.includes(String(el.ID)));
    }, [dbUser, communityGames, myGames, collaborativeGames, templateIds]);

    const sortedCommunityGames = useMemo(() => {
        // Defensive: /api/Scene/ListPublished already filters on the server,
        // but drop anything that isn't explicitly published before the card
        // renders so unpublished drafts can never leak into /discover.
        // Admins can additionally see cloneable games returned by the
        // admin-expanded community query so they can curate templates.
        const isAdminCloneableGame = (scene: FileData) => isAdmin && scene.IsCloneable === true;
        const games = [...(communityGames || [])]
            .filter(el => isAdminCloneableGame(el) || !templateIds.includes(String(el.ID)))
            .filter(el => el.IsPublished === true || isAdminCloneableGame(el));
        switch (communityFilter) {
            case "most_played":
                return games.sort((a, b) => (b.PlayCount ?? 0) - (a.PlayCount ?? 0));
            case "most_remixed":
                return games.sort((a, b) => (b.RemixCount ?? 0) - (a.RemixCount ?? 0));
            case "most_shared":
                return games.sort((a, b) => (b.ShareCount ?? 0) - (a.ShareCount ?? 0));
            case "most_hearted":
                return games.sort((a, b) => (b.Likes ?? 0) - (a.Likes ?? 0));
            default:
                return games;
        }
    }, [communityGames, communityFilter, isAdmin, templateIds]);

    const allProjects = useMemo(() => {
        const allUniqueProjects: FileData[] = [];
        const allCreatedOrSharedProjects: FileData[] = [];
        const seen = new Set<string>();
        const activeSeen = new Set<string>();

        for (const projectGroup of [myGames, collaborativeGames]) {
            for (const project of projectGroup || []) {
                if (activeSeen.has(project.ID)) continue;

                activeSeen.add(project.ID);
                allCreatedOrSharedProjects.push(project);
            }
        }

        for (const projectGroup of [myGames, collaborativeGames, archivedGames]) {
            for (const project of projectGroup || []) {
                if (seen.has(project.ID)) continue;

                seen.add(project.ID);
                allUniqueProjects.push(project);
            }
        }

        switch (projectsFilter) {
            case "created_by":
                return combineUniqueProjects(myGames, archivedGames).sort(sortByMostRecentCreation);
            case "creation_date":
                return [...allCreatedOrSharedProjects].sort(sortByMostRecentCreation);
            case "date_modified":
                return [...allCreatedOrSharedProjects].sort(sortByMostRecentUpdate);
            case "shared":
                return [...collaborativeGames].sort(sortByMostRecentUpdate);
            case "archived":
                return [...archivedGames].sort(sortByMostRecentUpdate);
            case "plays":
                return sortProjectsByMetric(allUniqueProjects, project => project.PlayCount ?? 0);
            case "likes":
                return sortProjectsByMetric(allUniqueProjects, project => project.Likes ?? 0);
            case "remixed":
                return sortProjectsByMetric(allUniqueProjects, project => project.RemixCount ?? 0);
            case "shared_count":
                return sortProjectsByMetric(allUniqueProjects, project => project.ShareCount ?? 0);
            default:
                return [...myGames].sort(sortByMostRecentCreation);
        }
    }, [myGames, collaborativeGames, archivedGames, projectsFilter]);

    const hasAnyProjects = useMemo(
        () => (myGames?.length ?? 0) + (collaborativeGames?.length ?? 0) + (archivedGames?.length ?? 0) > 0,
        [archivedGames, collaborativeGames, myGames],
    );

    const DISCOVER_SECTIONS: IGamesSection[] = useMemo(() => {
        const sections: IGamesSection[] = [];

        const debugContinue = DEBUG_FILL_SECTIONS ? generateDummyScenes(50, "Continue") : [];
        const debugTopPicks = DEBUG_FILL_SECTIONS ? generateDummyScenes(50, "TopPick") : [];
        const debugCommunity = DEBUG_FILL_SECTIONS ? generateDummyScenes(50, "Community") : [];

        // recentlyViewed is sourced from myGames + collaborativeGames, both of
        // which include unpublished drafts. Drop anything not published so a
        // user's own in-progress work never surfaces on /discover.
        const publishedRecentlyViewed = recentlyViewed.filter(el => el.IsPublished === true);
        const publishedTopPicks = topPicksGames.filter(el => el.IsPublished === true);

        if (DEBUG_FILL_SECTIONS || publishedRecentlyViewed.length > 0) {
            sections.push({
                label: SECTION.CONTINUE_PLAYING,
                scenes: [...publishedRecentlyViewed.slice(0, 5), ...debugContinue],
                maxItems: 5,
            });
        }

        sections.push({
            label: SECTION.TOP_PICKS,
            scenes: [...publishedTopPicks, ...debugTopPicks],
            maxItems: 10,
        });

        sections.push({
            label: SECTION.COMMUNITY,
            scenes: [
                ...(search.trim()
                    ? mergeUniqueScenes(sortedCommunityGames, remoteBrowseSearchGames)
                    : sortedCommunityGames),
                ...debugCommunity,
            ],
            maxItems: 5,
            showSeeMore: true,
            pagination: communityGamesSection,
        });

        return sections;
    }, [recentlyViewed, topPicksGames, sortedCommunityGames, search, remoteBrowseSearchGames, communityGamesSection]);

    const isDiscoverEmpty = useMemo(
        () => activePage === PAGES.BROWSE && DISCOVER_SECTIONS.every(section => section.scenes.length === 0),
        [activePage, DISCOVER_SECTIONS],
    );

    if (!homepageContext || accessForbidden || adminAccessForbidden) {
        return null;
    }

    if (isGameOverviewRoute) {
        return (
            <DashboardLayout>
                <Suspense fallback={null}>
                    <GameOverview key={location.pathname} />
                </Suspense>
            </DashboardLayout>
        );
    }

    const renderSearchControl = ({ariaLabel, placeholder}: {ariaLabel: string; placeholder: string}) => (
        <BrowseSearchSection
            role="search"
            aria-label={ariaLabel}
        >
            <BrowseSearchInputWrap>
                <SearchInput
                    onChange={setSearch}
                    value={search}
                    placeholder={placeholder}
                    width="100%"
                    alwaysOpen
                    height="48px"
                    customIcon={searchIcon}
                />
                <BrowseSearchTargetControls aria-label="Search targets">
                    <BrowseSearchTargetButton
                        type="button"
                        aria-label="Games search selected"
                        aria-pressed="true"
                        title="Games"
                        $selected
                        $locked
                    >
                        <TbDeviceGamepad2 aria-hidden="true" />
                    </BrowseSearchTargetButton>
                    <BrowseSearchTargetButton
                        type="button"
                        aria-label="Include docs search"
                        aria-pressed={browseSearchExternalTargets.docs}
                        title="Docs"
                        $selected={browseSearchExternalTargets.docs}
                        onClick={() => toggleBrowseSearchExternalTarget("docs")}
                    >
                        <HiOutlineBookOpen aria-hidden="true" />
                    </BrowseSearchTargetButton>
                </BrowseSearchTargetControls>
            </BrowseSearchInputWrap>
            <TutorialsSearchSection
                search={search}
                showDocs={browseSearchExternalTargets.docs}
            />
        </BrowseSearchSection>
    );

    return (
        <>
            {isDashboardFTUEVisible && (
                <DashboardFTUEModal
                    currentStep={dashboardFTUEStep}
                    onStepChange={setDashboardFTUEStep}
                    onClose={closeDashboardFTUE}
                    onAction={handleDashboardFTUEAction}
                />
            )}
            <DashboardLayout>
                {activePage === PAGES.SETTINGS && (
                    <Suspense fallback={null}>
                        <SettingsPage />
                    </Suspense>
                )}
                {activePage === PAGES.ADMIN_PANEL && (
                    <Suspense fallback={null}>
                        <AdminPanel />
                    </Suspense>
                )}
                {activePage !== PAGES.SETTINGS && activePage !== PAGES.ADMIN_PANEL && (
                    <WidthWrapper>
                        {isDiscoverEmpty ? (
                            <DiscoverEmptyState>
                                <DiscoverEmptyMedia>
                                    <DiscoverEmptyPlaceholder
                                        src={scenePlaceholder}
                                        alt=""
                                    />
                                </DiscoverEmptyMedia>
                                <DiscoverEmptyTitle>Loading New Worlds</DiscoverEmptyTitle>
                                <DiscoverEmptyText>
                                    Fresh games are on the way. Check back soon and be first to jump into what is next.
                                </DiscoverEmptyText>
                            </DiscoverEmptyState>
                        ) : (
                            <>
                                {activePage === PAGES.DASHBOARD ? (
                                    <>
                                        <ReconnectFolderBanner />
                                        <div
                                            style={{
                                                display: "flex",
                                                gap: 12,
                                                margin: "8px auto",
                                                padding: "0 16px",
                                                width: "100%",
                                                maxWidth: 1100,
                                                boxSizing: "border-box",
                                                justifyContent: "center",
                                            }}
                                        >
                                            <OpenFolderBanner />
                                            <ImportStemscriptBanner />
                                        </div>
                                        <CreateDashboardView
                                            hasAnyProjects={hasAnyProjects}
                                            projects={allProjects}
                                            view="create"
                                        />
                                    </>
                                ) : activePage === PAGES.PROJECTS ? (
                                    <>
                                        <ReconnectFolderBanner />
                                        <div
                                            style={{
                                                display: "flex",
                                                gap: 12,
                                                margin: "8px auto",
                                                padding: "0 16px",
                                                width: "100%",
                                                maxWidth: 1100,
                                                boxSizing: "border-box",
                                                justifyContent: "center",
                                            }}
                                        >
                                            <OpenFolderBanner />
                                            <ImportStemscriptBanner />
                                        </div>
                                        {renderSearchControl({
                                            ariaLabel: "Search projects",
                                            placeholder: "Search projects",
                                        })}
                                        <CreateDashboardView
                                            hasAnyProjects={hasAnyProjects}
                                            projects={allProjects}
                                            view="projects"
                                        />
                                    </>
                                ) : activePage === PAGES.REMIX ? (
                                    <RemixDashboardView />
                                ) : activePage === PAGES.AVATARS ? (
                                    <Suspense fallback={null}>
                                        <MyAvatarsView />
                                    </Suspense>
                                ) : (
                                    <>
                                        {activePage === PAGES.BROWSE && (
                                            <>
                                                <CTABanners
                                                    communityGames={communityGames}
                                                    onGameClick={game => {
                                                        void navigate(`/game/${game.ID}`, {
                                                            state: {returnTo: ROUTES.BROWSE},
                                                        });
                                                    }}
                                                />
                                                {renderSearchControl({
                                                    ariaLabel: "Search games",
                                                    placeholder: "Search games",
                                                })}
                                            </>
                                        )}
                                        {DISCOVER_SECTIONS.map(data => (
                                            <GamesSections
                                                sectionData={data}
                                                key={data.label}
                                                defaultExpanded={false}
                                            />
                                        ))}
                                    </>
                                )}
                            </>
                        )}
                    </WidthWrapper>
                )}
            </DashboardLayout>
        </>
    );
};
