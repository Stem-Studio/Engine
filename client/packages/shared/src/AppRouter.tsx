import {lazy, Suspense, useEffect, type ReactNode} from "react";
import {createBrowserRouter, Navigate, RouterProvider} from "react-router-dom";

import global from "./global";
import {LocalizationObserver} from "./i18n/LocalizationObserver";
import {RouteErrorBoundary} from "./RouteErrorBoundary";
import {ROUTES} from "./routes";

const CreateDashboard = lazy(() =>
    import("@stem/editor-oss/editor/assets/v2/CreateDashboard/CreateDashboard").then(m => ({default: m.CreateDashboard})),
);
const About = lazy(() => import("./v2/pages/About/About").then(m => ({default: m.About})));
const ContactUs = lazy(() => import("./v2/pages/ContactUs/ContactUs").then(m => ({default: m.ContactUs})));
const Create = lazy(() => import("./v2/pages/Create/Create").then(m => ({default: m.Create})));
const Player = lazy(() => import("./v2/pages/Player/Player").then(m => ({default: m.Player})));
const SearchResults = lazy(() =>
    import("./v2/pages/SearchResults/SearchResults").then(m => ({default: m.SearchResults})),
);
const StemEditor = lazy(() =>
    import("./v2/pages/StemEditor/StemEditor").then(m => ({default: m.StemEditor})),
);
const TermsAndPolicy = lazy(() =>
    import("./v2/pages/TermsAndPolicy/TermsAndPolicy").then(m => ({default: m.TermsAndPolicy})),
);
export const AppRouter = () => {
    const app = global?.app;
    const container = app?.container;

    const routerFutureSettings = {
        v7_startTransition: true,
        v7_fetcherPersist: true,
        v7_normalizeFormMethod: true,
        v7_partialHydration: true,
        v7_relativeSplatPath: true,
        v7_skipActionErrorRevalidation: true,
    };

    const noLocalize = (element: ReactNode) => <div data-no-localize="true">{element}</div>;
    const dashboardRedirect = <Navigate to={ROUTES.DASHBOARD} replace />;
    const withRouteErrorBoundary = <T extends {element: ReactNode}>(routes: T[]) =>
        routes.map(route => ({
            ...route,
            errorElement: <RouteErrorBoundary />,
        }));

    const router = createBrowserRouter(
        withRouteErrorBoundary([
            {
                path: ROUTES.SEARCH_RESULTS,
                element: <SearchResults />,
            },
            {
                path: ROUTES.VIEW_MORE,
                element: <SearchResults />,
            },
            {
                path: ROUTES.SETTINGS,
                element: <CreateDashboard />,
            },
            {
                path: ROUTES.DASHBOARD,
                element: <CreateDashboard />,
            },
            {
                path: ROUTES.MY_AVATARS,
                element: <CreateDashboard />,
            },
            {
                path: ROUTES.MY_AVATARS_NEW,
                element: <CreateDashboard />,
            },
            {
                path: ROUTES.MY_AVATARS_EDIT,
                element: <CreateDashboard />,
            },
            {
                path: ROUTES.PLAY,
                element: <Player />,
            },
            {
                path: ROUTES.LOGIN,
                element: dashboardRedirect,
            },
            {
                path: ROUTES.SIGN_UP,
                element: dashboardRedirect,
            },
            {
                path: ROUTES.REGISTER,
                element: dashboardRedirect,
            },
            {
                path: ROUTES.WAITLIST,
                element: dashboardRedirect,
            },
            {
                path: ROUTES.FORGOT_PASSWORD,
                element: dashboardRedirect,
            },
            {
                path: ROUTES.CREATE_PROJECT,
                element: <Create />,
            },
            {
                path: ROUTES.CREATE_PROJECT_WITH_ID,
                element: <Create />,
            },
            {
                path: ROUTES.CREATE_PROJECT_WITH_MODE,
                element: <Create />,
            },
            {
                path: ROUTES.CREATE_PROJECT_WITH_SCENE_MODE,
                element: <Create />,
            },
            {
                path: ROUTES.REMIX,
                element: <CreateDashboard />,
            },
            {
                path: ROUTES.DISCOVER,
                element: <CreateDashboard />,
            },
            {
                path: ROUTES.BROWSE,
                element: <CreateDashboard />,
            },
            {
                path: ROUTES.STEM_EDITOR,
                element: <StemEditor />,
            },
            {
                path: ROUTES.TERMS_OF_SERVICE,
                element: noLocalize(<TermsAndPolicy />),
            },
            {
                path: ROUTES.PRIVACY_POLICY,
                element: noLocalize(<TermsAndPolicy privacyPolicy />),
            },
            {
                path: ROUTES.THIRD_PARTY_ATTRIBUTIONS,
                element: noLocalize(<TermsAndPolicy attributions />),
            },
            {
                path: ROUTES.ABOUT,
                element: <About />,
            },
            {
                path: ROUTES.CONTACT_US,
                element: <ContactUs />,
            },
            {
                path: ROUTES.ADMIN_PANEL,
                element: dashboardRedirect,
            },
            {
                path: ROUTES.GAME_OVERVIEW,
                element: <CreateDashboard />,
            },
            {
                path: ROUTES.HOME,
                element: <CreateDashboard />,
            },
            {
                path: "*",
                element: <CreateDashboard />,
            },
        ]),
        {
            future: routerFutureSettings as any,
        },
    );

    useEffect(() => {
        if (!container) return;

        const handleContextMenu = (event: MouseEvent) => {
            const contextMenuPathsToBlock: string[] = [
                ROUTES.CREATE_PROJECT,
                ROUTES.CREATE_PROJECT_WITH_ID,
                ROUTES.CREATE_PROJECT_WITH_MODE,
                ROUTES.CREATE_PROJECT_WITH_SCENE_MODE,
                "/stem-editor",
            ];
            if (contextMenuPathsToBlock.some(path => window.location.pathname.includes(path))) {
                event.preventDefault();
                app?.call("contextmenu", null, event);
            } else {
                event.stopPropagation();
            }
        };

        container.addEventListener("contextmenu", handleContextMenu);
        document.addEventListener("contextmenu", handleContextMenu);

        return () => {
            container.removeEventListener("contextmenu", handleContextMenu);
            document.removeEventListener("contextmenu", handleContextMenu);
        };
    }, [container, window.location.pathname]);

    return (
        <Suspense fallback={null}>
            <LocalizationObserver />
            <RouterProvider router={router} />
        </Suspense>
    );
};
