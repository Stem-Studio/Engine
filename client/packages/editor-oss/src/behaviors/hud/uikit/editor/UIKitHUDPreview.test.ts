import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";

// --- Mocks ---

const {
    mockRendererSetPixelRatio,
    mockRendererSetClearColor,
    mockRendererSetSize,
    mockRendererRender,
    mockRendererDispose,
    mockFullscreenAdd,
    mockFullscreenRemove,
    mockFullscreenDispose,
    mockFullscreenUpdate,
    mockScreenDispose,
    mockScreenUpdate,
    mockScreenContainer,
} = vi.hoisted(() => ({
    mockRendererSetPixelRatio: vi.fn(),
    mockRendererSetClearColor: vi.fn(),
    mockRendererSetSize: vi.fn(),
    mockRendererRender: vi.fn(),
    mockRendererDispose: vi.fn(),
    mockFullscreenAdd: vi.fn(),
    mockFullscreenRemove: vi.fn(),
    mockFullscreenDispose: vi.fn(),
    mockFullscreenUpdate: vi.fn(),
    mockScreenDispose: vi.fn(),
    mockScreenUpdate: vi.fn(),
    mockScreenContainer: {},
}));

vi.mock("three", () => ({
    WebGLRenderer: class {
        setPixelRatio = mockRendererSetPixelRatio;
        setClearColor = mockRendererSetClearColor;
        setSize = mockRendererSetSize;
        render = mockRendererRender;
        dispose = mockRendererDispose;
    },
    Scene: class {
        add = vi.fn();
        children: unknown[] = [];
    },
    PerspectiveCamera: class {
        position = {set: vi.fn()};
        aspect = 1;
        updateProjectionMatrix = vi.fn();
        add = vi.fn();
    },
}));

vi.mock("@ni2khanna/uikit", () => ({
    Fullscreen: class {
        add = mockFullscreenAdd;
        remove = mockFullscreenRemove;
        dispose = mockFullscreenDispose;
        update = mockFullscreenUpdate;
    },
    initNodeMaterials: vi.fn().mockResolvedValue(undefined),
    initGlyphNodeMaterials: vi.fn().mockResolvedValue(undefined),
    setDefaultRenderOrder: vi.fn(),
}));

vi.mock("@pmndrs/pointer-events", () => ({
    forwardHtmlEvents: vi.fn().mockReturnValue({
        update: vi.fn(),
        destroy: vi.fn(),
    }),
}));

vi.mock("../screens/UIKitStartMenu", () => ({
    UIKitStartMenu: class {
        container = mockScreenContainer;
        dispose = mockScreenDispose;
    },
}));

vi.mock("../screens/UIKitInGameMenu", () => ({
    UIKitInGameMenu: class {
        container = mockScreenContainer;
        dispose = mockScreenDispose;
    },
}));

vi.mock("../screens/UIKitGameHUD", () => ({
    UIKitGameHUD: class {
        container = mockScreenContainer;
        dispose = mockScreenDispose;
        update = mockScreenUpdate;
    },
}));

vi.mock("../fonts", () => ({
    HUD_UIKIT_FONT_FAMILIES: {},
}));

import {UIKitHUDPreview} from "./UIKitHUDPreview";
import {HUD_TABS} from "@stem/editor-oss/editor/assets/v2/HUD/HUDEditView/types";

// --- Helpers ---

function makeCanvas(): any {
    return {
        width: 800,
        height: 600,
        parentElement: {clientWidth: 800, clientHeight: 600},
        getContext: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        style: {},
    };
}

// --- Tests ---

describe("UIKitHUDPreview", () => {
    let canvas: HTMLCanvasElement;

    beforeEach(() => {
        vi.clearAllMocks();
        canvas = makeCanvas();
        (globalThis as any).window = {
            devicePixelRatio: 1,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        };
        (globalThis as any).requestAnimationFrame = vi.fn().mockReturnValue(1);
        (globalThis as any).cancelAnimationFrame = vi.fn();
    });

    afterEach(() => {
        delete (globalThis as any).window;
        vi.restoreAllMocks();
    });

    it("constructs with a canvas element", () => {
        const preview = new UIKitHUDPreview(canvas);
        expect(preview).toBeDefined();
    });

    it("updateScreen() queues update when not yet initialized", () => {
        const preview = new UIKitHUDPreview(canvas);
        // Before async init completes, updateScreen should queue without error
        preview.updateScreen(HUD_TABS.GAME_START_MENU, {
            startMenu: {title: "Test"} as any,
        });
    });

    it("dispose() cleans up renderer and animation", () => {
        const preview = new UIKitHUDPreview(canvas);
        expect(() => preview.dispose()).not.toThrow();
        expect(mockRendererDispose).toHaveBeenCalled();
    });

    it("dispose() can be called multiple times safely", () => {
        const preview = new UIKitHUDPreview(canvas);
        preview.dispose();
        expect(() => preview.dispose()).not.toThrow();
    });
});
