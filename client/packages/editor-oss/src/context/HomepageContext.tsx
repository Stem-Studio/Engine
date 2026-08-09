import {useInfiniteQuery, useQueryClient} from "@tanstack/react-query";
import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";

import {useAppGlobalContext} from "./AppGlobalContext";
import {useAuthorizationContext} from "./AuthorizationContext";
import {getGames} from "@stem/network/api/getGames";
import {PAGES} from "../editor/assets/v2/CreateDashboard/constants";
import {
    fetchArchivedScenes,
    fetchCollaborativeScenes,
    fetchMyScenes,
    fetchPublishedScenes,
    fetchTopPicksScenes,
    type PaginatedScenesResponse,
} from "@stem/network/api/scene/list";
import {ROUTES} from "@web-shared/routes";
import type {CommunityFilterType, ProjectFilterType} from "../editor/assets/v2/CreateDashboard/CreateDashboard";
import {FileData} from "../editor/assets/v2/types/file";
import global from "../global";
import {useWindowPathname} from "../hooks/useWindowPathname";
import {isDashboardDataRoute} from "../utils/routeLoadGuards";
import {IBasicGameInterface} from "../v2/pages/types";

const STALE_TIME = 10 * 60 * 1000; // 10 minutes
const REFETCH_INTERVAL = 10 * 60 * 1000; // 10 minutes
const PAGE_SIZE = 20;

function readFilterFromUrl<T extends string>(name: string, fallback: T): T {
    if (typeof window === "undefined") return fallback;
    const value = new URLSearchParams(window.location.search).get(name);
    return (value as T) || fallback;
}

function writeFilterToUrl(name: string, value: string) {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get(name) === value) return;
    url.searchParams.set(name, value);
    window.history.replaceState(window.history.state, "", url.toString());
}

interface DashboardUpdateOptions {
    force?: boolean;
}

interface PaginatedSection {
    scenes: FileData[];
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    fetchNextPage: () => void;
}

interface HomepageContextValue {
    games: IBasicGameInterface[];
    fetchGames: () => void;
    setSearch: (search: string) => void;
    search: string;
    favoriteGames: IBasicGameInterface[];
    setFavoriteGames: React.Dispatch<React.SetStateAction<IBasicGameInterface[]>>;
    myGames: FileData[];
    setMyGames: React.Dispatch<React.SetStateAction<FileData[]>>;
    communityGames: FileData[];
    topPicksGames: FileData[];
    archivedGames: FileData[];
    collaborativeGames: FileData[];
    shouldRefreshDashboard: boolean;
    setShouldRefreshDashboard: React.Dispatch<React.SetStateAction<boolean>>;
    updateMyGames: (options?: DashboardUpdateOptions) => Promise<void>;
    updateArchivedGames: (options?: DashboardUpdateOptions) => Promise<void>;
    updateCollaborativeGames: (options?: DashboardUpdateOptions) => Promise<void>;
    updateCommunityGames: (options?: DashboardUpdateOptions) => Promise<void>;
    updateTopPicksGames: (options?: DashboardUpdateOptions) => Promise<void>;
    gamesFetched: boolean;
    setShowTemplatePanel: React.Dispatch<React.SetStateAction<boolean>>;
    showTemplatePanel: boolean;
    projectsFilter: ProjectFilterType;
    setProjectsFilter: React.Dispatch<React.SetStateAction<ProjectFilterType>>;
    communityFilter: CommunityFilterType;
    setCommunityFilter: React.Dispatch<React.SetStateAction<CommunityFilterType>>;
    // Paginated section accessors for infinite scroll
    myGamesSection: PaginatedSection;
    communityGamesSection: PaginatedSection;
    collaborativeGamesSection: PaginatedSection;
    archivedGamesSection: PaginatedSection;
}

export const HomepageContext = React.createContext<HomepageContextValue>(null!);
export const useHomepageContext = () => React.useContext(HomepageContext);

export interface HomepageContextProviderProps {
    children: React.ReactNode;
}

/**
 * Flatten all pages into a single sorted-by-UpdateTime array.
 * @param pages
 */
function flattenPages(pages: PaginatedScenesResponse[] | undefined): FileData[] {
    if (!pages) return [];
    const all = pages.flatMap(p => p.Scenes ?? []);
    return all.sort((a, b) => new Date(b.UpdateTime).getTime() - new Date(a.UpdateTime).getTime());
}

const HomepageContextProvider: React.FC<HomepageContextProviderProps> = ({children}) => {
    const {authToken, dbUser, isAuthorized, isInitializingAuth, isAdmin} = useAuthorizationContext();
    const {setMainLoaderState, activePage} = useAppGlobalContext();
    const queryClient = useQueryClient();
    const [games, setGames] = useState<IBasicGameInterface[]>([]);
    const [favoriteGames, setFavoriteGames] = useState<IBasicGameInterface[]>([]);
    const [search, setSearch] = useState("");
    const [shouldRefreshDashboard, setShouldRefreshDashboard] = useState(false);
    const [showTemplatePanel, setShowTemplatePanel] = useState(false);
    const pathname = useWindowPathname();
    const [projectsFilter, setProjectsFilter] = useState<ProjectFilterType>(
        () => readFilterFromUrl<ProjectFilterType>("projectsFilter", "date_modified"),
    );
    const [communityFilter, setCommunityFilter] = useState<CommunityFilterType>(
        () => readFilterFromUrl<CommunityFilterType>("communityFilter", "most_played"),
    );

    // Persist filter selections in the URL so a refresh reproduces the same
    // view. Gate on activePage (not pathname alone) because My Projects is now
    // the only surface that should write the project filter; Create at ROUTES.HOME
    // uses the prompt hero and should keep the URL clean. But ALSO require pathname
    // to be a dashboard-data route:
    // activePage defaults to PAGES.DASHBOARD for unknown pathnames
    // (AppGlobalContext.tsx:72), which causes the filter to leak into
    // unrelated routes like /play/:id on a fresh tab — the Player page would
    // pick up activePage=DASHBOARD at mount and this effect would rewrite the
    // URL to /play/:id?projectsFilter=….
    useEffect(() => {
        if (activePage !== PAGES.PROJECTS) return;
        if (!isDashboardDataRoute(pathname)) return;
        writeFilterToUrl("projectsFilter", projectsFilter);
    }, [activePage, projectsFilter, pathname]);

    useEffect(() => {
        if (activePage !== PAGES.BROWSE) return;
        if (!isDashboardDataRoute(pathname)) return;
        writeFilterToUrl("communityFilter", communityFilter);
    }, [activePage, communityFilter, pathname]);

    const userScope = dbUser?.id || "anonymous";
    const authReady = isAuthorized && !isInitializingAuth && !!authToken && !!dbUser?.id;
    const shouldAutoLoadDashboardData = authReady && isDashboardDataRoute(pathname);
    const isPublicGalleryRoute =
        pathname === ROUTES.BROWSE ||
        pathname === ROUTES.DISCOVER ||
        pathname === ROUTES.REMIX ||
        pathname.startsWith("/game/");
    const shouldLoadPublicGalleryData = !isInitializingAuth && isPublicGalleryRoute;
    const shouldLoadGalleryData = shouldAutoLoadDashboardData || shouldLoadPublicGalleryData;
    const includeAdminCloneableCommunity = authReady && isAdmin;

    const fetchGames = useCallback(async () => {
        if (!shouldLoadGalleryData) {
            setGames([]);
            return;
        }

        const response = await getGames();

        if (response) {
            setGames(response);
        }
    }, [shouldLoadGalleryData]);

    // --- Infinite queries for each scene list ---

    const myGamesQuery = useInfiniteQuery({
        queryKey: ["dashboard-scenes", "my", userScope],
        queryFn: ({pageParam}) => fetchMyScenes({page: pageParam, limit: PAGE_SIZE}),
        initialPageParam: 1,
        getNextPageParam: lastPage => (lastPage.HasMore ? lastPage.Page + 1 : undefined),
        staleTime: STALE_TIME,
        refetchInterval: shouldAutoLoadDashboardData ? REFETCH_INTERVAL : false,
        enabled: shouldAutoLoadDashboardData,
        retry: false,
    });

    const archivedGamesQuery = useInfiniteQuery({
        queryKey: ["dashboard-scenes", "archived", userScope],
        queryFn: ({pageParam}) => fetchArchivedScenes({page: pageParam, limit: PAGE_SIZE}),
        initialPageParam: 1,
        getNextPageParam: lastPage => (lastPage.HasMore ? lastPage.Page + 1 : undefined),
        staleTime: STALE_TIME,
        refetchInterval: shouldAutoLoadDashboardData ? REFETCH_INTERVAL : false,
        enabled: shouldAutoLoadDashboardData,
        retry: false,
    });

    const collaborativeGamesQuery = useInfiniteQuery({
        queryKey: ["dashboard-scenes", "collaborative", userScope],
        queryFn: ({pageParam}) => fetchCollaborativeScenes({page: pageParam, limit: PAGE_SIZE}),
        initialPageParam: 1,
        getNextPageParam: lastPage => (lastPage.HasMore ? lastPage.Page + 1 : undefined),
        staleTime: STALE_TIME,
        refetchInterval: shouldAutoLoadDashboardData ? REFETCH_INTERVAL : false,
        enabled: shouldAutoLoadDashboardData,
        retry: false,
    });

    const communityGamesQuery = useInfiniteQuery({
        queryKey: [
            "dashboard-scenes",
            "community",
            userScope,
            includeAdminCloneableCommunity ? "admin-cloneable" : "public",
        ],
        queryFn: ({pageParam}) =>
            fetchPublishedScenes({
                page: pageParam,
                limit: PAGE_SIZE,
                includeCloneableForAdmin: includeAdminCloneableCommunity,
            }),
        initialPageParam: 1,
        getNextPageParam: lastPage => (lastPage.HasMore ? lastPage.Page + 1 : undefined),
        staleTime: STALE_TIME,
        refetchInterval: shouldLoadGalleryData ? REFETCH_INTERVAL : false,
        enabled: shouldLoadGalleryData,
        retry: false,
    });

    // Top picks is not paginated (always max 4 items)
    const topPicksQuery = useInfiniteQuery({
        queryKey: ["dashboard-scenes", "top-picks", userScope],
        queryFn: async () => {
            const scenes = await fetchTopPicksScenes();
            return {
                Scenes: scenes,
                TotalCount: scenes.length,
                Page: 1,
                Limit: scenes.length,
                HasMore: false,
            };
        },
        initialPageParam: 1,
        getNextPageParam: () => undefined,
        staleTime: STALE_TIME,
        refetchInterval: shouldLoadGalleryData ? REFETCH_INTERVAL : false,
        enabled: shouldLoadGalleryData,
        retry: false,
    });

    // --- Flattened scene arrays for backward compatibility ---
    const myGames = useMemo(
        () => shouldAutoLoadDashboardData ? flattenPages(myGamesQuery.data?.pages) : [],
        [myGamesQuery.data, shouldAutoLoadDashboardData],
    );
    const archivedGames = useMemo(
        () => shouldAutoLoadDashboardData ? flattenPages(archivedGamesQuery.data?.pages) : [],
        [archivedGamesQuery.data, shouldAutoLoadDashboardData],
    );
    const collaborativeGames = useMemo(
        () => shouldAutoLoadDashboardData ? flattenPages(collaborativeGamesQuery.data?.pages) : [],
        [collaborativeGamesQuery.data, shouldAutoLoadDashboardData],
    );
    const topPicksGames = useMemo(
        () => shouldLoadGalleryData ? flattenPages(topPicksQuery.data?.pages) : [],
        [topPicksQuery.data, shouldLoadGalleryData],
    );

    const communityGamesRaw = useMemo(
        () => shouldLoadGalleryData ? flattenPages(communityGamesQuery.data?.pages) : [],
        [communityGamesQuery.data, shouldLoadGalleryData],
    );
    const communityGames = useMemo(
        () => communityGamesRaw.map(data => ({...data, DeleteEnabled: true, isCommunity: true})),
        [communityGamesRaw],
    );

    // Stable setter for myGames — no-op since data is managed by React Query now
    const setMyGames = useCallback(() => {
        // No-op: myGames is derived from React Query cache.
        // Callers that need to force refresh should use updateMyGames({force: true}).
    }, []);

    const gamesFetched = myGamesQuery.isFetched || !shouldAutoLoadDashboardData;

    useEffect(() => {
        if (shouldAutoLoadDashboardData || shouldLoadGalleryData) {
            return;
        }

        setGames([]);
        void queryClient.cancelQueries({queryKey: ["dashboard-scenes"]});
    }, [queryClient, shouldAutoLoadDashboardData, shouldLoadGalleryData]);

    // --- Update helpers (invalidate + refetch) ---
    const updateMyGames = useCallback(async (options?: DashboardUpdateOptions) => {
        if (!shouldLoadGalleryData) {
            return;
        }
        if (options?.force) {
            await queryClient.invalidateQueries({queryKey: ["dashboard-scenes", "my", userScope]});
        }
        await myGamesQuery.refetch();
    }, [queryClient, userScope, myGamesQuery]);

    const updateArchivedGames = useCallback(async (options?: DashboardUpdateOptions) => {
        if (!authReady) {
            return;
        }
        if (options?.force) {
            await queryClient.invalidateQueries({queryKey: ["dashboard-scenes", "archived", userScope]});
        }
        await archivedGamesQuery.refetch();
    }, [queryClient, userScope, archivedGamesQuery]);

    const updateCollaborativeGames = useCallback(async (options?: DashboardUpdateOptions) => {
        if (!authReady) {
            return;
        }
        if (options?.force) {
            await queryClient.invalidateQueries({queryKey: ["dashboard-scenes", "collaborative", userScope]});
        }
        await collaborativeGamesQuery.refetch();
    }, [queryClient, userScope, collaborativeGamesQuery]);

    const updateCommunityGames = useCallback(async (options?: DashboardUpdateOptions) => {
        if (!authReady) {
            return;
        }
        if (options?.force) {
            await queryClient.invalidateQueries({queryKey: ["dashboard-scenes", "community", userScope]});
        }
        await communityGamesQuery.refetch();
    }, [queryClient, communityGamesQuery, userScope, shouldLoadGalleryData]);

    const updateTopPicksGames = useCallback(async (options?: DashboardUpdateOptions) => {
        if (!shouldLoadGalleryData) {
            return;
        }
        if (options?.force) {
            await queryClient.invalidateQueries({queryKey: ["dashboard-scenes", "top-picks", userScope]});
        }
        await topPicksQuery.refetch();
    }, [queryClient, topPicksQuery, userScope, shouldLoadGalleryData]);

    // React Query holds community/my/top-picks pages for 10 min. When the
    // current user publishes or unpublishes a scene, force-invalidate those
    // caches so the change is visible immediately on the dashboard rather
    // than waiting for staleTime / refetchInterval (DOT-7545).
    //
    // NOTE: use the imported `global` module (web/src/global.ts) — NOT
    // `globalThis` — because the app attaches itself there (editor.index.ts
    // sets `global.app = app`). `globalThis.app` is undefined.
    //
    // IMPORTANT: the three `update*Games` callbacks depend on `useInfiniteQuery`
    // result objects which are fresh references on every render. Including
    // them in the effect deps would re-run subscribe/unsubscribe every render
    // and, more importantly, would re-register the handler mid-flight —
    // contributing to the dashboard flicker reported in DOT-7545 follow-up.
    // Instead, keep the callbacks in a ref and subscribe exactly once.
    const updateCommunityGamesRef = useRef(updateCommunityGames);
    const updateMyGamesRef = useRef(updateMyGames);
    const updateTopPicksGamesRef = useRef(updateTopPicksGames);
    useEffect(() => {
        updateCommunityGamesRef.current = updateCommunityGames;
        updateMyGamesRef.current = updateMyGames;
        updateTopPicksGamesRef.current = updateTopPicksGames;
    });
    // HomepageContextProvider mounts above the EngineRuntime in the React
    // tree, so `global.app` is often null on the first run of this effect.
    // The original implementation gave up at that point and never re-bound
    // even after the engine booted. Poll briefly for the engine to attach,
    // then subscribe. Stops polling either when bound or after ~10s of
    // failed attempts (engine genuinely absent — fine, the React Query
    // initial fetch still loads games; we just miss the publish refresh).
    useEffect(() => {
        let unsubscribe: (() => void) | undefined;
        let attempts = 0;
        const maxAttempts = 20;

        const handler = (_payload?: {sceneId?: string; action?: string}) => {
            void updateCommunityGamesRef.current({force: true});
            void updateMyGamesRef.current({force: true});
            void updateTopPicksGamesRef.current({force: true});
        };

        const tryBind = (): boolean => {
            const app = global.app;
            if (!app?.on) return false;
            app.on("scenePublished.HomepageContext", handler);
            unsubscribe = () => app.on?.("scenePublished.HomepageContext", null);
            return true;
        };

        if (tryBind()) return () => unsubscribe?.();

        const interval = window.setInterval(() => {
            attempts++;
            if (tryBind() || attempts >= maxAttempts) {
                window.clearInterval(interval);
            }
        }, 500);

        return () => {
            window.clearInterval(interval);
            unsubscribe?.();
        };
    }, []);

    // --- Paginated section accessors ---
    const myGamesSection: PaginatedSection = useMemo(
        () => ({
            scenes: myGames,
            hasNextPage: !!myGamesQuery.hasNextPage,
            isFetchingNextPage: myGamesQuery.isFetchingNextPage,
            fetchNextPage: () => void myGamesQuery.fetchNextPage(),
        }),
        [myGames, myGamesQuery.hasNextPage, myGamesQuery.isFetchingNextPage, myGamesQuery.fetchNextPage],
    );

    const communityGamesSection: PaginatedSection = useMemo(
        () => ({
            scenes: communityGames,
            hasNextPage: !!communityGamesQuery.hasNextPage,
            isFetchingNextPage: communityGamesQuery.isFetchingNextPage,
            fetchNextPage: () => void communityGamesQuery.fetchNextPage(),
        }),
        [
            communityGames,
            communityGamesQuery.hasNextPage,
            communityGamesQuery.isFetchingNextPage,
            communityGamesQuery.fetchNextPage,
        ],
    );

    const collaborativeGamesSection: PaginatedSection = useMemo(
        () => ({
            scenes: collaborativeGames,
            hasNextPage: !!collaborativeGamesQuery.hasNextPage,
            isFetchingNextPage: collaborativeGamesQuery.isFetchingNextPage,
            fetchNextPage: () => void collaborativeGamesQuery.fetchNextPage(),
        }),
        [
            collaborativeGames,
            collaborativeGamesQuery.hasNextPage,
            collaborativeGamesQuery.isFetchingNextPage,
            collaborativeGamesQuery.fetchNextPage,
        ],
    );

    const archivedGamesSection: PaginatedSection = useMemo(
        () => ({
            scenes: archivedGames,
            hasNextPage: !!archivedGamesQuery.hasNextPage,
            isFetchingNextPage: archivedGamesQuery.isFetchingNextPage,
            fetchNextPage: () => void archivedGamesQuery.fetchNextPage(),
        }),
        [
            archivedGames,
            archivedGamesQuery.hasNextPage,
            archivedGamesQuery.isFetchingNextPage,
            archivedGamesQuery.fetchNextPage,
        ],
    );

    useEffect(() => {
        setTimeout(() => {
            const isHomepage = location.pathname === ROUTES.HOME;
            if (isHomepage) {
                setMainLoaderState({visible: false, message: ""});
            }
        }, 400);
        if (isInitializingAuth || !dbUser) return;
        const isInitialLoading =
            !myGamesQuery.isFetched ||
            !archivedGamesQuery.isFetched ||
            !collaborativeGamesQuery.isFetched ||
            !communityGamesQuery.isFetched ||
            !topPicksQuery.isFetched;
        const isDashboard = location.pathname === ROUTES.DASHBOARD;
        setTimeout(() => {
            setMainLoaderState({visible: isInitialLoading && isDashboard, message: ""});
        }, 600);
    }, [
        myGamesQuery.isFetched,
        archivedGamesQuery.isFetched,
        collaborativeGamesQuery.isFetched,
        communityGamesQuery.isFetched,
        topPicksQuery.isFetched,
        setMainLoaderState,
        dbUser,
        isInitializingAuth,
    ]);

    return (
        <HomepageContext.Provider
            value={{
                games,
                fetchGames,
                setSearch,
                search,
                setFavoriteGames,
                favoriteGames,
                myGames,
                setMyGames,
                communityGames,
                topPicksGames,
                collaborativeGames,
                archivedGames,
                updateMyGames,
                updateArchivedGames,
                updateCollaborativeGames,
                updateCommunityGames,
                updateTopPicksGames,
                gamesFetched,
                shouldRefreshDashboard,
                setShouldRefreshDashboard,
                setShowTemplatePanel,
                showTemplatePanel,
                projectsFilter,
                setProjectsFilter,
                communityFilter,
                setCommunityFilter,
                myGamesSection,
                communityGamesSection,
                collaborativeGamesSection,
                archivedGamesSection,
            }}
        >
            {children}
        </HomepageContext.Provider>
    );
};

export default HomepageContextProvider;
