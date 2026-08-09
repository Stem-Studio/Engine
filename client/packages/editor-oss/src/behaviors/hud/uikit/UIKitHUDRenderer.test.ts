import * as THREE from "three";
import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";

// --- Mocks (must be defined before imports) ---

const {
    mockFullscreenAdd,
    mockFullscreenRemove,
    mockFullscreenDispose,
    mockFullscreenSetProperties,
    mockFullscreenUpdate,
    mockFullscreenRemoveFromParent,
    mockScreenDispose,
    mockScreenContainer,
    mockScreenUpdate,
    mockScreenShowBanner,
} = vi.hoisted(() => ({
    mockFullscreenAdd: vi.fn(),
    mockFullscreenRemove: vi.fn(),
    mockFullscreenDispose: vi.fn(),
    mockFullscreenSetProperties: vi.fn(),
    mockFullscreenUpdate: vi.fn(),
    mockFullscreenRemoveFromParent: vi.fn(),
    mockScreenDispose: vi.fn(),
    mockScreenContainer: {},
    mockScreenUpdate: vi.fn(),
    mockScreenShowBanner: vi.fn(),
}));
let mockFullscreenParent: any = null;

vi.mock("@ni2khanna/uikit", () => ({
    Fullscreen: class {
        add = mockFullscreenAdd;
        remove = mockFullscreenRemove;
        dispose = mockFullscreenDispose;
        setProperties = mockFullscreenSetProperties;
        update = mockFullscreenUpdate;
        removeFromParent = mockFullscreenRemoveFromParent;
        get parent() { return mockFullscreenParent; }
        children: unknown[] = [];
    },
    clearFontCache: vi.fn(),
}));

vi.mock("./fonts", () => ({
    HUD_UIKIT_FONT_FAMILIES: {},
}));

vi.mock("./screens/UIKitStartMenu", () => ({
    UIKitStartMenu: class {
        container = mockScreenContainer;
        dispose = mockScreenDispose;
    },
}));

vi.mock("./screens/UIKitInGameMenu", () => ({
    UIKitInGameMenu: class {
        container = mockScreenContainer;
        dispose = mockScreenDispose;
    },
}));

vi.mock("./screens/UIKitGameHUD", () => ({
    UIKitGameHUD: class {
        container = mockScreenContainer;
        dispose = mockScreenDispose;
        update = mockScreenUpdate;
        showBanner = mockScreenShowBanner;
    },
}));

vi.mock("../../../global", () => ({
    default: {
        app: {
            editor: {isSandbox: false, showHUD: true},
            on: vi.fn(),
            call: vi.fn(),
        },
    },
}));

vi.mock("../../../editor/assets/v2/HUD/HUDView/getGameSounds", () => ({
    getSoundsFromUI: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../event/EventBus", () => ({
    default: {
        instance: {
            send: vi.fn(),
            subscribe: vi.fn(),
            unsubscribe: vi.fn(),
        },
    },
}));

const {mockUIKitPointerEventsUpdate} = vi.hoisted(() => ({
    mockUIKitPointerEventsUpdate: vi.fn(),
}));

vi.mock("../../uikit/UIKitPointerEvents", () => ({
    default: {
        initialize: vi.fn(),
        registerRoot: vi.fn(),
        unregisterRoot: vi.fn(),
        update: mockUIKitPointerEventsUpdate,
        deinitialize: vi.fn(),
        isActive: vi.fn().mockReturnValue(true),
        getRootCount: vi.fn().mockReturnValue(1),
    },
}));

import {UIKitHUDRenderer} from "./UIKitHUDRenderer";

// --- Helpers ---

function makeScene(gameUI?: Record<string, any>): THREE.Scene {
    const scene = new THREE.Scene();
    if (gameUI) {
        scene.userData.gameUI = gameUI;
    }
    return scene;
}

function makeGameManager(scene: THREE.Scene): any {
    const camera = new THREE.PerspectiveCamera();
    const uiCamera = camera.clone();
    return {
        renderer: {} as any,
        camera,
        uiCamera,
        scene,
        score: 0,
        maxScore: 500,
        health: 100,
        initialHealth: 100,
        lives: 3,
        initialLives: 3,
        time_remaining: "00:00:00",
        playerWeapons: [],
        pickedWeaponOrItem: undefined,
        isWinner: () => false,
        isGameOver: () => false,
    };
}

// --- Tests ---

describe("UIKitHUDRenderer", () => {
    let scene: THREE.Scene;
    let game: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockFullscreenParent = new THREE.PerspectiveCamera();

        // Stub window for DOM APIs used by UIKitHUDRenderer (keydown listener)
        (globalThis as any).window = {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        };

        // Keep RAF mocked to verify the renderer does not start its own loop.
        (globalThis as any).requestAnimationFrame = vi.fn().mockReturnValue(1);
        (globalThis as any).cancelAnimationFrame = vi.fn();

        scene = makeScene({
            gameStartMenu: {title: "Test Game"},
            inGameMenu: {title: "Paused"},
            gameHUD: {showScore: true},
        });
        game = makeGameManager(scene);
    });

    afterEach(() => {
        delete (globalThis as any).window;
        vi.restoreAllMocks();
    });

    it("constructs and binds events", () => {
        const renderer = new UIKitHUDRenderer(scene, game);
        expect(renderer).toBeDefined();
        expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled();
    });

    it("show() with emptyHUD returns early", () => {
        const renderer = new UIKitHUDRenderer(scene, game);
        renderer.show(true);
        // No state transition should happen - fullscreen properties should not be set
        expect(mockFullscreenSetProperties).not.toHaveBeenCalled();
    });

    it("show() transitions to START_MENU for normal mode", () => {
        const renderer = new UIKitHUDRenderer(scene, game);
        renderer.show();
        // Should set properties for overlay state
        expect(mockFullscreenSetProperties).toHaveBeenCalledWith(
            expect.objectContaining({opacity: "75%", pointerEvents: "auto"}),
        );
    });

    it("dispose() cleans up resources", () => {
        const renderer = new UIKitHUDRenderer(scene, game);
        renderer.dispose();
        expect(mockFullscreenDispose).toHaveBeenCalled();
        expect(globalThis.cancelAnimationFrame).not.toHaveBeenCalled();
    });

    it("dispose() can be called multiple times safely", () => {
        const renderer = new UIKitHUDRenderer(scene, game);
        renderer.dispose();
        expect(() => renderer.dispose()).not.toThrow();
    });

    it("update() calls UIKitPointerEvents.update()", () => {
        const renderer = new UIKitHUDRenderer(scene, game);
        renderer.update(0.016);
        expect(mockUIKitPointerEventsUpdate).toHaveBeenCalledWith(0.016);
    });

    it("reattaches the fullscreen root when it is parented to a non-camera", () => {
        const renderer = new UIKitHUDRenderer(scene, game);
        const addToUICamera = vi.fn(() => {
            mockFullscreenParent = game.uiCamera;
            return game.uiCamera;
        });
        game.uiCamera.add = addToUICamera;
        mockFullscreenParent = new THREE.Scene();

        renderer.update(0.016);

        expect(addToUICamera).toHaveBeenCalled();
        expect(mockFullscreenUpdate).toHaveBeenCalledWith(0.016);
    });

    it("suppresses transient fullscreen camera errors during update", () => {
        const renderer = new UIKitHUDRenderer(scene, game);
        mockFullscreenParent = game.uiCamera;
        mockFullscreenUpdate.mockImplementationOnce(() => {
            throw new Error("fullscreen can only be added to a camera");
        });

        expect(() => renderer.update(0.016)).not.toThrow();
        expect(mockUIKitPointerEventsUpdate).not.toHaveBeenCalled();
    });
});
