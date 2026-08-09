import {render, screen} from "@testing-library/react";
import {beforeEach, describe, expect, it, vi} from "vitest";

import type {GetSceneResponse} from "@stem/network/api/scene/v2";

import {PlayerTopNav} from "./PlayerTopNav";
import global from "@stem/editor-oss/global";

vi.mock("@stem/network/api/scene", () => ({
    fetchRemixesOfScene: vi.fn(),
}));

vi.mock("@stem/network/api/scene/v2", () => ({
    forkScene: vi.fn(),
}));

vi.mock("@stem/network/api/rewards", () => ({
    createTrackedShareUrl: vi.fn(),
}));

vi.mock("../../../showToast", () => ({
    showToast: vi.fn(),
}));

vi.mock("../editorHandoff", () => ({
    openEditorRoute: vi.fn(),
}));

vi.mock("../links", () => ({
    generateProjectLink: (sceneId?: string) => sceneId ? `/project/${sceneId}` : "/project",
    getGameUrl: (sceneId: string) => `/play/${sceneId}`,
}));

const createScene = (overrides: Record<string, unknown> = {}) => ({
    id: "scene-1",
    name: "Playable Game",
    userId: "owner-1",
    isCloneable: true,
    isPublished: true,
    alias: null,
    ...overrides,
});

describe("PlayerTopNav", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.assign(document.head, {
            appendChild: vi.fn(),
            insertBefore: vi.fn(),
            removeChild: vi.fn(),
            querySelector: vi.fn(),
            querySelectorAll: vi.fn(() => []),
        });
    });

    it("keeps Play selected and omits the editor-entry action", () => {
        render(<PlayerTopNav scene={createScene() as unknown as GetSceneResponse} viewerId="viewer-1" />);

        expect(screen.getByTitle("You're playing this game")).toHaveTextContent("Play");
        expect(screen.queryByText("Open in Stem Studio")).not.toBeInTheDocument();
    });

    it("registers the player host chrome as a viewport safe-area occluder", () => {
        const registerViewportSafeAreaElement = vi.fn();
        global.app = {registerViewportSafeAreaElement} as never;

        const view = render(<PlayerTopNav scene={createScene() as unknown as GetSceneResponse} viewerId="viewer-1" />);

        expect(registerViewportSafeAreaElement).toHaveBeenCalledWith(
            "player-top-nav",
            expect.any(HTMLElement),
        );
        view.unmount();
        expect(registerViewportSafeAreaElement).toHaveBeenLastCalledWith("player-top-nav", null);
        global.app = null;
    });

    it("hides Remix for a non-remixable game when the viewer is not the owner", () => {
        render(<PlayerTopNav scene={createScene({isCloneable: false}) as unknown as GetSceneResponse} viewerId="viewer-1" />);

        expect(screen.queryByText("Remix")).not.toBeInTheDocument();
    });

    it("hides Remix for non-owners when cloneable permission is missing", () => {
        render(<PlayerTopNav scene={createScene({isCloneable: undefined}) as unknown as GetSceneResponse} viewerId="viewer-1" />);

        expect(screen.queryByText("Remix")).not.toBeInTheDocument();
    });

    // The "shows Remix for cloneable games" test was removed — remix is a
    // hosted-backend feature, so it never applies here.

    it("shows Edit for owners even when the cloneable flag is off", () => {
        render(<PlayerTopNav scene={createScene({isCloneable: false}) as unknown as GetSceneResponse} viewerId="owner-1" />);

        expect(screen.getByText("Edit")).toBeInTheDocument();
        expect(screen.queryByText("Remix")).not.toBeInTheDocument();
    });
});
