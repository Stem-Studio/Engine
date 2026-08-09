import {Scene} from "three";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

const hoisted = vi.hoisted(() => ({
    append: vi.fn((node: Node) => document.body.appendChild(node)),
    clearLoadedSounds: vi.fn(),
    createRoot: vi.fn(),
    loadSounds: vi.fn(),
    playSound: vi.fn(),
    render: vi.fn(),
    stopSound: vi.fn(),
    unmount: vi.fn(),
}));

vi.mock("react-dom/client", () => ({
    createRoot: hoisted.createRoot,
}));

vi.mock("@tanstack/react-query", () => ({
    QueryClientProvider: ({children}: {children: unknown}) => children,
}));

vi.mock("@stem/editor-oss/EngineRuntime", () => ({
    default: class EngineRuntime {},
}));

vi.mock("@stem/editor-oss/context/SceneAssetResolutionContext", () => ({
    SceneAssetResolutionProvider: ({children}: {children: unknown}) => children,
}));

vi.mock("@stem/editor-oss/editor/assets/v2/HUD/HUDView/HUDView", () => ({
    HUDView: () => null,
}));

vi.mock("@stem/editor-oss/editor/assets/v2/HUD/HUDView/services", () => ({
    getZIndexWithinHUD: vi.fn(() => 1010),
    HUD_Z_INDEX: {HUDBase: 1000},
}));

vi.mock("@stem/editor-oss/global", () => ({
    default: {
        app: {
            container: {
                append: hoisted.append,
            },
        },
    },
}));

vi.mock("@web-shared/queryClient", () => ({
    queryClient: {},
}));

vi.mock("./SoundManager", () => ({
    SoundManager: class {
        loadSounds = hoisted.loadSounds;
        clearLoadedSounds = hoisted.clearLoadedSounds;
        playSound = hoisted.playSound;
        stopSound = hoisted.stopSound;
    },
}));

import HUDManager from "./HUDManager";

describe("HUDManager", () => {
    beforeEach(() => {
        hoisted.createRoot.mockReturnValue({
            render: hoisted.render,
            unmount: hoisted.unmount,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = "";
        for (const mock of Object.values(hoisted)) {
            mock.mockReset();
        }
    });

    it("removes the exact popstate handler registered during create", () => {
        const addEventListener = vi.spyOn(window, "addEventListener");
        const removeEventListener = vi.spyOn(window, "removeEventListener");
        const manager = new HUDManager(new Scene());

        manager.create();
        manager.clear();

        const addCalls = addEventListener.mock.calls as unknown as Array<[string, EventListenerOrEventListenerObject]>;
        const handler = addCalls.find(call => call[0] === "popstate")?.[1];
        expect(handler).toEqual(expect.any(Function));
        expect(removeEventListener).toHaveBeenCalledWith("popstate", handler);
        expect(hoisted.unmount).toHaveBeenCalledOnce();
        expect(hoisted.clearLoadedSounds).toHaveBeenCalled();
        expect(document.getElementById("hud-view-container")).toBeNull();
    });

    it("clears the previous HUD root before recreating", () => {
        const addEventListener = vi.spyOn(window, "addEventListener");
        const removeEventListener = vi.spyOn(window, "removeEventListener");
        const manager = new HUDManager(new Scene());

        manager.create();
        const addCalls = addEventListener.mock.calls as unknown as Array<[string, EventListenerOrEventListenerObject]>;
        const firstHandler = addCalls.find(call => call[0] === "popstate")?.[1];
        manager.create(true);

        expect(hoisted.createRoot).toHaveBeenCalledTimes(2);
        expect(hoisted.unmount).toHaveBeenCalledOnce();
        expect(removeEventListener).toHaveBeenCalledWith("popstate", firstHandler);
        expect(document.querySelectorAll("#hud-view-container")).toHaveLength(1);
        expect(addCalls.filter(call => call[0] === "popstate")).toHaveLength(2);
    });

    it("delegates sound controls to SoundManager", () => {
        const manager = new HUDManager(new Scene());
        const sounds = [{id: "s1", url: "sound.mp3", loop: false, volume: 1, soundType: "play-now" as const}];

        manager.loadSounds(sounds);
        manager.playSound("s1");
        manager.stopSound("s1");
        manager.clearSounds();

        expect(hoisted.loadSounds).toHaveBeenCalledWith(sounds);
        expect(hoisted.playSound).toHaveBeenCalledWith("s1");
        expect(hoisted.stopSound).toHaveBeenCalledWith("s1");
        expect(hoisted.clearLoadedSounds).toHaveBeenCalled();
    });
});
