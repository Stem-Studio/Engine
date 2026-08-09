import {afterEach, describe, expect, it, vi} from "vitest";
import {PerspectiveCamera, OrthographicCamera} from "three";

import global from "../global";
import ResizeEvent from "./ResizeEvent";

function createApp() {
    const viewport = document.createElement("div");
    Object.defineProperties(viewport, {
        clientWidth: {value: 640, configurable: true},
        clientHeight: {value: 360, configurable: true},
    });

    return {
        viewport,
        rendererCSS: {
            setSize: vi.fn(),
        },
        editor: {
            camera: new PerspectiveCamera(),
            orthCamera: new OrthographicCamera(-1, 1, 1, -1),
            renderer: {
                setSize: vi.fn(),
            },
        },
        on: vi.fn(),
    };
}

describe("ResizeEvent", () => {
    const previousApp = global.app;
    const previousResizeObserver = globalThis.ResizeObserver;
    const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
    const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;

    afterEach(() => {
        global.app = previousApp;
        globalThis.ResizeObserver = previousResizeObserver;
        globalThis.requestAnimationFrame = previousRequestAnimationFrame;
        globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
        vi.restoreAllMocks();
    });

    it("coalesces ResizeObserver work with requestAnimationFrame instead of an animate listener", () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const rafCallbacks: FrameRequestCallback[] = [];
        const cancelAnimationFrame = vi.fn();
        let resizeObserverCallback: ResizeObserverCallback = () => {
            throw new Error("ResizeObserver callback was not initialized");
        };
        const disconnect = vi.fn();
        const observe = vi.fn();

        globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
            rafCallbacks.push(callback);
            return rafCallbacks.length;
        });
        globalThis.cancelAnimationFrame = cancelAnimationFrame;
        class MockResizeObserver {
            constructor(callback: ResizeObserverCallback) {
                resizeObserverCallback = callback;
            }
            observe = observe;
            disconnect = disconnect;
        }
        globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

        const event = new ResizeEvent();

        event.start();
        event.start();

        expect(app.on).toHaveBeenCalledWith(`resize.${event.id}`, expect.any(Function));
        expect(app.on).not.toHaveBeenCalledWith("animate.ResizeEvent", expect.any(Function));
        expect(observe).toHaveBeenCalledTimes(1);
        expect(observe).toHaveBeenCalledWith(app.viewport);

        const notifyResize = resizeObserverCallback;
        notifyResize([], {} as ResizeObserver);
        notifyResize([], {} as ResizeObserver);

        expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(1);
        expect(app.editor.renderer.setSize).not.toHaveBeenCalled();

        rafCallbacks[0]?.(0);

        expect(app.editor.renderer.setSize).toHaveBeenCalledTimes(1);
        expect(app.editor.renderer.setSize).toHaveBeenCalledWith(640, 360);
        expect(app.rendererCSS.setSize).toHaveBeenCalledWith(640, 360);

        event.stop();

        expect(app.on).toHaveBeenCalledWith(`resize.${event.id}`, null);
        expect(app.on).not.toHaveBeenCalledWith("animate.ResizeEvent", null);
        expect(disconnect).toHaveBeenCalledTimes(1);
        expect(cancelAnimationFrame).not.toHaveBeenCalled();
    });

    it("cancels a pending observer flush when a manual resize applies immediately", () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const rafCallbacks: FrameRequestCallback[] = [];
        let resizeObserverCallback: ResizeObserverCallback = () => {
            throw new Error("ResizeObserver callback was not initialized");
        };

        globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
            rafCallbacks.push(callback);
            return 7;
        });
        globalThis.cancelAnimationFrame = vi.fn();
        class MockResizeObserver {
            constructor(callback: ResizeObserverCallback) {
                resizeObserverCallback = callback;
            }
            observe = vi.fn();
            disconnect = vi.fn();
        }
        globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

        const event = new ResizeEvent();

        event.start();
        resizeObserverCallback([], {} as ResizeObserver);
        event._onResizeEvent();
        rafCallbacks[0]?.(0);

        expect(globalThis.cancelAnimationFrame).toHaveBeenCalledWith(7);
        expect(app.editor.renderer.setSize).toHaveBeenCalledTimes(1);
    });
});
