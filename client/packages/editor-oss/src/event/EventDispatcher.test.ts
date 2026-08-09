import {afterEach, describe, expect, it, vi} from "vitest";

import global from "../global";
import EventDispatcher from "./EventDispatcher";

function createApp() {
    return {
        container: {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        },
    };
}

describe("EventDispatcher DOM lifecycle", () => {
    const previousApp = global.app;

    afterEach(() => {
        global.app = previousApp;
        vi.restoreAllMocks();
    });

    it("binds DOM listeners on start and removes the same listeners on stop", () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const documentAdd = vi.spyOn(document, "addEventListener").mockImplementation(() => {});
        const documentRemove = vi.spyOn(document, "removeEventListener").mockImplementation(() => {});
        const windowAdd = vi.spyOn(window, "addEventListener").mockImplementation(() => {});
        const windowRemove = vi.spyOn(window, "removeEventListener").mockImplementation(() => {});
        const dispatcher = new EventDispatcher();
        const event = {start: vi.fn(), stop: vi.fn(), reset: vi.fn()};
        (dispatcher as never as {events: typeof event[]}).events = [event];

        expect(app.container.addEventListener).not.toHaveBeenCalled();

        dispatcher.start();
        dispatcher.start();

        expect(event.start).toHaveBeenCalledTimes(2);
        expect(app.container.addEventListener).toHaveBeenCalledTimes(6);
        expect(documentAdd).toHaveBeenCalledTimes(4);
        expect(windowAdd).toHaveBeenCalledTimes(1);

        dispatcher.stop();

        expect(event.stop).toHaveBeenCalledTimes(1);
        expect(app.container.removeEventListener).toHaveBeenCalledTimes(6);
        expect(documentRemove).toHaveBeenCalledTimes(4);
        expect(windowRemove).toHaveBeenCalledTimes(1);
    });
});
