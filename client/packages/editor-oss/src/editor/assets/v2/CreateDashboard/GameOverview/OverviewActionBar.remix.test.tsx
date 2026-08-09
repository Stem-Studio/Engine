import {render, screen} from "@testing-library/react";
import {beforeEach, describe, expect, it, vi} from "vitest";

import {OverviewActionBar} from "./OverviewActionBar";
import type {FileData} from "../../types/file";

const mocks = vi.hoisted(() => ({
    navigate: vi.fn(),
    updateScene: vi.fn(),
    getScene: vi.fn(),
    saveTemplateIds: vi.fn(),
    publishScene: vi.fn(),
    unpublishScene: vi.fn(),
    addLikedGame: vi.fn(),
    createTrackedShareUrl: vi.fn(),
    showToast: vi.fn(),
    trackProductEvent: vi.fn(),
    openEditorRoute: vi.fn(),
    redirectToLogin: vi.fn(),
    ajaxPost: vi.fn(),
    auth: {
        isAdmin: false,
        isAuthorized: true,
        setDbUser: vi.fn(),
        handleGetLikedGames: vi.fn(),
    },
}));

vi.mock("react-router-dom", () => ({
    useNavigate: () => mocks.navigate,
}));

vi.mock("@stem/network/api/rewards", () => ({
    createTrackedShareUrl: (...args: unknown[]) => mocks.createTrackedShareUrl(...args),
}));

vi.mock("@stem/network/api/scene/v2", () => ({
    getScene: (...args: unknown[]) => mocks.getScene(...args),
    updateScene: (...args: unknown[]) => mocks.updateScene(...args),
}));

vi.mock("@stem/network/api/templates/hooks", () => ({
    useTemplateIds: () => ({data: [], isLoading: false}),
    useSetTemplateIds: () => ({mutateAsync: mocks.saveTemplateIds, isPending: false}),
}));

vi.mock("@stem/network/api/updateUser", () => ({
    addLikedGame: (...args: unknown[]) => mocks.addLikedGame(...args),
}));

vi.mock("../../../../../context/AppGlobalContext", () => ({
    useAppGlobalContext: () => ({openSceneHistoryModal: vi.fn()}),
}));

vi.mock("../../../../../context/AuthorizationContext", () => ({
    useAuthorizationContext: () => mocks.auth,
}));

vi.mock("../../../../../context/HomepageContext", () => ({
    useHomepageContext: () => ({setShouldRefreshDashboard: vi.fn()}),
}));

vi.mock("../../../../../global", () => ({
    default: {
        app: {
            on: vi.fn(),
        },
    },
}));

vi.mock("../../../../../showToast", () => ({
    showToast: (...args: unknown[]) => mocks.showToast(...args),
}));

vi.mock("../../../../../utils/Ajax", () => ({
    default: {
        post: (...args: unknown[]) => mocks.ajaxPost(...args),
    },
}));

vi.mock("../../../../../utils/authRedirect", () => ({
    redirectToLogin: (...args: unknown[]) => mocks.redirectToLogin(...args),
}));

vi.mock("../../../../../utils/productAnalytics", () => ({
    PRODUCT_ANALYTICS_EVENTS: {
        GAME_PLAY_CLICKED: "game_play_clicked",
        GAME_LIKE_CLICKED: "game_like_clicked",
        GAME_SHARE_CLICKED: "game_share_clicked",
    },
    trackProductEvent: (...args: unknown[]) => mocks.trackProductEvent(...args),
}));

vi.mock("../../../../../utils/UrlUtils", () => ({
    backendUrlFromPath: (path: string) => path,
}));

vi.mock("../../../../../v2/pages/editorHandoff", () => ({
    openEditorRoute: (...args: unknown[]) => mocks.openEditorRoute(...args),
}));

vi.mock("../../../../../v2/pages/links", () => ({
    generateProjectLink: (sceneId?: string) => sceneId ? `/project/${sceneId}` : "/project",
    getGameUrl: (sceneId: string) => `/play/${sceneId}`,
}));

vi.mock("../../../../asset-management/hooks/publish", () => ({
    usePublishScene: () => ({mutateAsync: mocks.publishScene}),
    useUnpublishScene: () => ({mutateAsync: mocks.unpublishScene}),
}));

const createScene = (overrides: Partial<FileData> = {}): FileData => ({
    ID: "scene-1",
    publishRevisionId: "",
    AssetID: "asset-1",
    UserID: "owner-1",
    Name: "Test Game",
    Description: "",
    PlayCount: 0,
    RemixCount: 0,
    Tags: "",
    Thumbnail: "",
    Url: "",
    UpdateTime: "2026-05-08T00:00:00Z",
    IsSandbox: false,
    IsPublished: true,
    IsPublic: true,
    IsCloneable: false,
    ...overrides,
});

describe("OverviewActionBar in the OSS build", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.auth.isAdmin = false;
        mocks.auth.isAuthorized = true;
        Object.assign(document.head, {
            appendChild: vi.fn(),
            insertBefore: vi.fn(),
            removeChild: vi.fn(),
            querySelector: vi.fn(),
            querySelectorAll: vi.fn(() => []),
        });
        globalThis.IntersectionObserver = vi.fn(function MockIntersectionObserver() {
            return {
                disconnect: vi.fn(),
                observe: vi.fn(),
                unobserve: vi.fn(),
                takeRecords: vi.fn(() => []),
            };
        }) as unknown as typeof IntersectionObserver;
    });

    it("does not render hosted remix UI for a non-cloneable scene", () => {
        mocks.auth.isAdmin = true;

        render(
            <OverviewActionBar
                scene={createScene()}
                canEdit
                isOwner={false}
                onSceneUpdate={vi.fn()}
            />,
        );

        expect(screen.queryByTestId("overview-remix")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", {name: /remix/i})).not.toBeInTheDocument();
    });

    it("does not render hosted remix UI even when scene metadata is cloneable", () => {
        render(
            <OverviewActionBar
                scene={createScene({IsCloneable: true})}
                canEdit={false}
                isOwner={false}
                onSceneUpdate={vi.fn()}
            />,
        );

        expect(screen.queryByTestId("overview-remix")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", {name: /remix/i})).not.toBeInTheDocument();
    });
});
