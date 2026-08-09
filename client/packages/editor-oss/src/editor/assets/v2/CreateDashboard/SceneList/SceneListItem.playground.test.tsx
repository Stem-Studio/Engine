import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {MemoryRouter} from "react-router";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import type {FileData} from "../../types/file";
import {SceneListItem} from "./SceneListItem";

const mocks = vi.hoisted(() => ({
    isPlayground: true,
    openEditorRoute: vi.fn(),
    trackProductEvent: vi.fn(),
}));

vi.mock("@stem/editor-oss/mode/buildMode", () => ({
    IS_OSS: true,
}));

vi.mock("@web-shared/playgroundMode", () => ({
    isPlaygroundMode: () => mocks.isPlayground,
}));

vi.mock("@stem/editor-oss/context/AuthorizationContext", () => ({
    useAuthorizationContext: () => ({
        dbUser: {id: "user-1", username: "Designer"},
        isAuthorized: true,
    }),
}));

vi.mock("@stem/editor-oss/services", () => ({
    getThumbnail: () => "",
}));

vi.mock("@stem/editor-oss/showToast", () => ({
    showToast: vi.fn(),
}));

vi.mock("@stem/editor-oss/utils/authRedirect", () => ({
    redirectToLogin: vi.fn(),
}));

vi.mock("@stem/editor-oss/utils/productAnalytics", () => ({
    PRODUCT_ANALYTICS_EVENTS: {
        CREATE_BLANK_STARTED: "create_blank_started",
        GAME_CARD_OPENED: "game_card_opened",
        GAME_EDIT_CLICKED: "game_edit_clicked",
        GAME_PLAY_CLICKED: "game_play_clicked",
        GAME_REMIX_CLICKED: "game_remix_clicked",
    },
    trackProductEvent: (...args: unknown[]) => mocks.trackProductEvent(...args),
}));

vi.mock("@stem/network/api/scene/actions", () => ({
    forkScene: vi.fn(),
}));

vi.mock("../../../../../v2/pages/editorHandoff", () => ({
    openEditorRoute: (...args: unknown[]) => mocks.openEditorRoute(...args),
}));

vi.mock("../../../../../v2/pages/links", () => ({
    generatePlaygroundSceneLink: (id: string, name: string, mode: "edit" | "play") =>
        `/create/project/${id}/${mode}?mode=playground&scene=${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    generateProjectLink: (id: string) => `/project/${id}`,
    getGameUrl: (id: string) => `/play/${id}`,
}));

vi.mock("../../common/ProgressiveImage/ProgressiveImage", () => ({
    ProgressiveImage: ({alt, src}: {alt: string; src: string}) => (
        <img
            alt={alt}
            src={src}
        />
    ),
}));

const createItem = (): FileData => ({
    AssetID: null,
    Description: "A local playground project",
    ID: "scene-1",
    IsPublished: false,
    IsSandbox: false,
    Likes: 4,
    Name: "Crystal Dash",
    PlayCount: 7,
    RemixCount: 0,
    ShareCount: 2,
    Tags: "",
    Thumbnail: "",
    UpdateTime: "2026-06-01T00:00:00.000Z",
    Url: "",
    UserID: "user-1",
    publishRevisionId: "",
});

describe("SceneListItem playground actions", () => {
    beforeEach(() => {
        cleanup();
        mocks.isPlayground = true;
        mocks.openEditorRoute.mockReset();
        mocks.trackProductEvent.mockReset();
        vi.spyOn(window, "open").mockImplementation(() => null);
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it("shows Play on playground dashboard project cards and opens the local player route", () => {
        render(
            <MemoryRouter initialEntries={["/dashboard"]}>
                <SceneListItem
                    item={createItem()}
                    routeKind="dashboard"
                />
            </MemoryRouter>,
        );

        expect(screen.getByTestId("game-card-edit")).toBeInTheDocument();
        expect(screen.getByTestId("game-card-play")).toBeInTheDocument();
        expect(screen.queryByLabelText("likes")).not.toBeInTheDocument();

        fireEvent.click(screen.getByTestId("game-card-play"));

        expect(window.open).toHaveBeenCalledWith(
            "/create/project/scene-1/play?mode=playground&scene=crystal-dash",
            "_blank",
        );
    });
});
