import {afterEach, describe, expect, it, vi} from "vitest";
import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import type {ReactNode} from "react";
import * as THREE from "three";

import global from "@stem/editor-oss/global";
import {QuickBuildToolbar} from "./QuickBuild/QuickBuildToolbar";

const quickBuildTextureMocks = vi.hoisted(() => ({
    index: null as any,
    pack: {
        schema: "stem.quickBuildTexturePack.v1",
        id: "empty",
        label: "Empty",
        license: "custom",
        source: "test",
        presets: [],
    } as any,
    texture: null as any,
}));

vi.mock("./common/Tooltip", () => ({
    Tooltip: ({children}: {children: ReactNode}) => <>{children}</>,
}));

vi.mock("@stem/editor-oss/showToast", () => ({
    showToast: vi.fn(),
}));

vi.mock("./QuickBuild/quickBuildTexturePacks", async importOriginal => {
    const actual = await importOriginal<typeof import("./QuickBuild/quickBuildTexturePacks")>();
    return {
        ...actual,
        loadQuickBuildTexturePackIndex: vi.fn(async () => quickBuildTextureMocks.index),
        loadQuickBuildTexturePack: vi.fn(async () => quickBuildTextureMocks.pack),
        loadQuickBuildTexture: vi.fn(async () => quickBuildTextureMocks.texture),
    };
});

function installFakeApp() {
    const scene = new THREE.Scene();
    scene.userData.snapping = {grid: {enabled: true, increment: 1}};
    const sceneHelpers = new THREE.Scene();
    const handlers = new Map<string, (...args: any[]) => void>();
    const editor: any = {
        scene,
        sceneHelpers,
        selected: null,
        gpuPickNum: 0,
        computeIntersectPoint: vi.fn(() => new THREE.Vector3()),
        execute: vi.fn(async command => command.execute?.()),
        addObject: vi.fn((object: THREE.Object3D, parent?: THREE.Object3D) => {
            (parent ?? scene).add(object);
        }),
        removeObject: vi.fn((object: THREE.Object3D) => {
            object.parent?.remove(object);
        }),
        moveObjectToPoint: vi.fn((object: THREE.Object3D, point: THREE.Vector3) => {
            object.position.copy(point);
        }),
        select: vi.fn((object: THREE.Object3D | null) => {
            editor.selected = object;
            handlers.get("objectSelected.QuickBuildToolbarSelection")?.(editor, object);
        }),
    };
    const app = {
        isPlaying: false,
        disableClickEvents: false,
        editor,
        on: vi.fn((key: string, handler: ((...args: any[]) => void) | null) => {
            if (handler) handlers.set(key, handler);
            else handlers.delete(key);
        }),
        emit: (key: string, ...args: any[]) => handlers.get(key)?.(...args),
        call: vi.fn(),
    };
    global.app = app as any;
    return app;
}

describe("builder toolbars", () => {
    afterEach(() => {
        cleanup();
        global.app = null;
        quickBuildTextureMocks.index = null;
        quickBuildTextureMocks.pack = {
            schema: "stem.quickBuildTexturePack.v1",
            id: "empty",
            label: "Empty",
            license: "custom",
            source: "test",
            presets: [],
        };
        quickBuildTextureMocks.texture = null;
    });

    it("renders Quick Build as labeled, meaningful tool actions", async () => {
        installFakeApp();

        render(<QuickBuildToolbar />);

        expect(screen.getByTestId("quick-build-tool-select")).toHaveAttribute("aria-label", "Select tool (V)");
        expect(screen.getByTestId("quick-build-tool-erase")).toHaveAttribute("aria-label", "Erase tool (E)");
        expect(screen.getByTestId("quick-build-group-terrain")).toHaveTextContent("Terrain");
        expect(screen.getByTestId("quick-build-group-paths")).toHaveTextContent("Routes");
        expect(screen.getByTestId("quick-build-group-nature")).toHaveTextContent("Nature");
        expect(screen.getByTestId("quick-build-group-buildings")).toHaveTextContent("Build");

        expect(screen.getByTestId("quick-build-tool-ground")).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByTestId("quick-build-texture-preset")).toBeInTheDocument();
        expect(screen.getByTestId("quick-build-texture-preset")).toBeDisabled();

        fireEvent.click(screen.getByTestId("quick-build-group-paths"));
        fireEvent.click(screen.getByTestId("quick-build-tool-water"));

        expect(screen.getByTestId("quick-build-tool-water")).toHaveAttribute("aria-pressed", "true");

        fireEvent.click(screen.getByTestId("quick-build-group-paths"));
        fireEvent.click(screen.getByTestId("quick-build-tool-path-street"));

        expect(screen.getByTestId("quick-build-tool-path-street")).toHaveAttribute("aria-pressed", "true");
    });

    it("places a visible Quick Build stamp from the default build tool", async () => {
        const app = installFakeApp();

        render(<QuickBuildToolbar />);
        await act(async () => {
            await Promise.resolve();
        });

        await act(async () => {
            app.emit(
                "raycast.QuickBuildToolbar",
                {point: new THREE.Vector3(2, 0, 3), object: null},
                {preventDefault: vi.fn(), quickBuildCommit: true},
            );
            await Promise.resolve();
        });

        await waitFor(() => {
            const stamp = app.editor.scene.children.find((child: THREE.Object3D) => child.userData?.isQuickBuildObject);
            expect(stamp).toBeTruthy();
            expect(stamp?.userData.isStemObject).toBe(true);
            expect(stamp?.userData.isSelectable).toBe(true);
            expect(stamp?.position.toArray()).toEqual([4, 0, 4]);
        });
    });

    it("activates Quick Build tools and brushes on pointer down", async () => {
        installFakeApp();

        render(<QuickBuildToolbar />);
        await act(async () => {
            await Promise.resolve();
        });

        fireEvent.click(screen.getByTestId("quick-build-group-paths"));
        fireEvent.pointerDown(screen.getByTestId("quick-build-tool-water"), {
            button: 0,
            isPrimary: true,
        });
        await waitFor(() => {
            expect(screen.getByTestId("quick-build-tool-water")).toHaveAttribute("aria-pressed", "true");
        });

        fireEvent.pointerDown(screen.getByTestId("quick-build-brush-radius"), {
            button: 0,
            isPrimary: true,
        });
        await waitFor(() => {
            expect(screen.getByTestId("quick-build-brush-radius")).toHaveAttribute("aria-pressed", "true");
        });
    });

});
