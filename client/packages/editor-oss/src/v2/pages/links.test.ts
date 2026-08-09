import {describe, expect, it, afterEach} from "vitest";

import {_resetPlaygroundModeForTests} from "@web-shared/playgroundMode";
import {generatePlaygroundSceneLink, generateProjectLink, sceneNameSlug, syncPlaygroundSceneRoute} from "./links";

describe("generateProjectLink", () => {
    afterEach(() => {
        window.history.replaceState({}, "", "/");
        _resetPlaygroundModeForTests();
    });

    it("preserves an explicit Builder Studio mode through project creation", () => {
        window.history.replaceState({}, "", "/create/project?mode=playground&builder=1");

        expect(generateProjectLink("scene-123")).toBe("/create/project/scene-123?builder=1");
    });

    it("does not add a builder query to ordinary project links", () => {
        window.history.replaceState({}, "", "/dashboard");

        expect(generateProjectLink("scene-123")).toBe("/create/project/scene-123");
    });

    it("builds refreshable playground edit/play links with the scene slug in the query", () => {
        window.history.replaceState({}, "", "/dashboard?mode=playground");

        expect(sceneNameSlug("My Race Track! 🚗")).toBe("my-race-track");
        expect(generatePlaygroundSceneLink("scene-123", "My Race Track!", "edit"))
            .toBe("/create/project/scene-123/edit?mode=playground&scene=my-race-track");
        expect(generatePlaygroundSceneLink("scene-123", "My Race Track!", "play"))
            .toBe("/create/project/scene-123/play?mode=playground&scene=my-race-track");
    });

    it("normalizes legacy scene-segment links while replacing the mode", () => {
        window.history.replaceState({}, "", "/create/project/scene-123/my-race-track/play?mode=playground");
        let notifications = 0;
        const onRoute = () => { notifications++; };
        window.addEventListener("stem:playground-route", onRoute);

        syncPlaygroundSceneRoute("scene-123", "My Race Track!", "edit");

        expect(window.location.pathname).toBe("/create/project/scene-123/edit");
        expect(window.location.search).toBe("?mode=playground&scene=my-race-track");
        expect(notifications).toBe(1);
        window.removeEventListener("stem:playground-route", onRoute);
    });
});
