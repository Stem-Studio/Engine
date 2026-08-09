import {Object3D, PerspectiveCamera, Scene, Vector2} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

const {forwardHtmlEvents} = vi.hoisted(() => ({
    forwardHtmlEvents: vi.fn(() => ({update: vi.fn(), destroy: vi.fn()})),
}));

vi.mock("@pmndrs/pointer-events", () => ({
    forwardHtmlEvents,
}));

import * as UIKitPointerEvents from "./UIKitPointerEvents";

function createCanvas(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    return canvas;
}

function createGame() {
    return {
        scene: new Scene(),
        camera: new PerspectiveCamera(),
        uiCamera: new PerspectiveCamera(),
        renderer: {domElement: createCanvas()},
    };
}

function createFullscreenLikeRoot() {
    const root = new Object3D() as Object3D & {
        renderer: {getSize: (target: Vector2) => Vector2; domElement: HTMLCanvasElement};
        sizeX: {value: number};
        sizeY: {value: number};
        pixelSize: {value: number};
        update: (delta: number) => void;
        dispose: () => void;
        updateSpy: ReturnType<typeof vi.fn>;
    };
    root.renderer = {
        domElement: createCanvas(),
        getSize: target => target.set(800, 600),
    };
    root.sizeX = {value: 0};
    root.sizeY = {value: 0};
    root.pixelSize = {value: 0};
    const updateSpy = vi.fn(function (this: Object3D) {
        const parent = this.parent as PerspectiveCamera | null;
        if (parent?.isPerspectiveCamera !== true) {
            throw new Error("fullscreen can only be added to a camera");
        }
    });
    root.update = updateSpy as unknown as (delta: number) => void;
    root.dispose = vi.fn() as unknown as () => void;
    root.updateSpy = updateSpy;
    return root;
}

describe("UIKitPointerEvents fullscreen roots", () => {
    afterEach(() => {
        UIKitPointerEvents.forceDispose();
        document.body.innerHTML = "";
        vi.clearAllMocks();
    });

    it("parents detached fullscreen roots to the UI camera before update", () => {
        const game = createGame();
        const root = createFullscreenLikeRoot();

        UIKitPointerEvents.initialize(game);
        UIKitPointerEvents.registerRoot(root);

        expect(root.parent).toBe(game.uiCamera);
        expect(() => UIKitPointerEvents.update(1 / 60)).not.toThrow();
        expect(root.updateSpy).toHaveBeenCalled();
    });

    it("uses ensureUICamera when no cached UI camera is present", () => {
        const uiCamera = new PerspectiveCamera();
        const game = {
            scene: new Scene(),
            camera: new PerspectiveCamera(),
            ensureUICamera: vi.fn(() => uiCamera),
            renderer: {domElement: createCanvas()},
        };
        const root = createFullscreenLikeRoot();

        UIKitPointerEvents.initialize(game);
        UIKitPointerEvents.registerRoot(root);

        expect(game.ensureUICamera).toHaveBeenCalled();
        expect(root.parent).toBe(uiCamera);
        expect(() => UIKitPointerEvents.update(1 / 60)).not.toThrow();
    });

    it("does not reparent non-fullscreen UIKit roots", () => {
        const game = createGame();
        const worldParent = new Object3D();
        const root = new Object3D() as Object3D & {
            update: (delta: number) => void;
            dispose: () => void;
            updateSpy: ReturnType<typeof vi.fn>;
        };
        root.updateSpy = vi.fn();
        root.update = root.updateSpy as unknown as (delta: number) => void;
        root.dispose = vi.fn() as unknown as () => void;
        worldParent.add(root);

        UIKitPointerEvents.initialize(game);
        UIKitPointerEvents.registerRoot(root);
        UIKitPointerEvents.update(1 / 60);

        expect(root.parent).toBe(worldParent);
        expect(root.updateSpy).toHaveBeenCalled();
    });

    it("forwards bubbled UIKit clicks to legacy userData handlers", () => {
        const game = createGame();
        const root = createFullscreenLikeRoot();
        const button = new Object3D();
        const glyph = new Object3D();
        const onClick = vi.fn();
        button.userData.onClick = onClick;
        button.add(glyph);
        root.add(button);

        UIKitPointerEvents.initialize(game);
        UIKitPointerEvents.registerRoot(root);
        UIKitPointerEvents.registerRoot(root);

        const listeners = (root as Object3D & {
            _listeners?: Record<string, Array<(event: unknown) => void>>;
        })._listeners?.click;
        expect(listeners).toHaveLength(1);
        listeners?.[0]?.({target: glyph, nativeEvent: new PointerEvent("click")});

        expect(onClick).toHaveBeenCalledTimes(1);

        UIKitPointerEvents.unregisterRoot(root);
        expect((root as Object3D & {
            _listeners?: Record<string, Array<(event: unknown) => void>>;
        })._listeners?.click).toHaveLength(0);
    });
});
