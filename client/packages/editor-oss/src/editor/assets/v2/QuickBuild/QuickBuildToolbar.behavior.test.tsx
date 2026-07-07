import {afterEach, describe, expect, it, vi} from "vitest";
import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import type {ReactNode} from "react";
import * as THREE from "three";

import global from "@stem/editor-oss/global";
import {createQuickBuildObject, createQuickBuildPreviewObject, QUICK_BUILD_CELL_SIZE} from "./quickBuildObjects";
import {collectQuickBuildBakeObjects, collectQuickBuildLiveBatchObjects} from "./quickBuildSceneTools";
import {clearQuickBuildTexturePackCaches} from "./quickBuildTexturePacks";
import {QuickBuildToolbar} from "./QuickBuildToolbar";
import {showToast} from "@stem/editor-oss/showToast";

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

vi.mock("../common/Tooltip", () => ({
    Tooltip: ({children}: {children: ReactNode}) => <>{children}</>,
}));

vi.mock("@stem/editor-oss/showToast", () => ({
    showToast: vi.fn(),
}));

function pointerViewportEvent(type: string, init: MouseEventInit & Partial<PointerEvent> = {}) {
    const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        ...init,
    });
    Object.defineProperties(event, {
        pointerId: {value: init.pointerId ?? 1},
        pointerType: {value: init.pointerType ?? "mouse"},
        isPrimary: {value: init.isPrimary ?? true},
    });
    return event as PointerEvent;
}

function installAnimationFrameQueue() {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    const requestAnimationFrame = vi
        .spyOn(window, "requestAnimationFrame")
        .mockImplementation(callback => {
            const frameId = nextFrameId++;
            frames.set(frameId, callback);
            return frameId;
        });
    const cancelAnimationFrame = vi
        .spyOn(window, "cancelAnimationFrame")
        .mockImplementation(frameId => {
            frames.delete(frameId);
        });

    return {
        requestAnimationFrame,
        cancelAnimationFrame,
        flushFrame: () => {
            const callbacks = Array.from(frames.values());
            frames.clear();
            for (const callback of callbacks) {
                callback(performance.now());
            }
        },
    };
}

function installFakeApp() {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        if (url.includes("manifest.json") && !url.includes("test.json")) {
            return {
                ok: quickBuildTextureMocks.index !== null,
                json: vi.fn(async () => quickBuildTextureMocks.index),
            } as unknown as Response;
        }
        return {
            ok: true,
            json: vi.fn(async () => quickBuildTextureMocks.pack),
        } as unknown as Response;
    }));
    vi.spyOn(THREE.TextureLoader.prototype, "load").mockImplementation(
        (_url, onLoad, _onProgress, onError) => {
            const texture = quickBuildTextureMocks.texture;
            if (texture) {
                onLoad?.(texture);
                return texture;
            }
            const error = new Error("No mocked Quick Build texture");
            onError?.(error as unknown as ProgressEvent<EventTarget>);
            return new THREE.Texture();
        },
    );
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

describe("QuickBuildToolbar behavior", () => {
    afterEach(() => {
        cleanup();
        clearQuickBuildTexturePackCaches();
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
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("applies a loaded texture preset to the selected Quick Build object", async () => {
        const app = installFakeApp();
        const ground = createQuickBuildObject("ground");
        app.editor.scene.add(ground);
        app.editor.selected = ground;
        quickBuildTextureMocks.texture = new THREE.Texture();
        quickBuildTextureMocks.index = {
            schema: "stem.quickBuildTexturePackIndex.v1",
            packs: [{id: "test", label: "Test", manifestUrl: "test.json", license: "custom"}],
        };
        quickBuildTextureMocks.pack = {
            schema: "stem.quickBuildTexturePack.v1",
            id: "test",
            label: "Test",
            license: "custom",
            presets: [
                {
                    id: "grass",
                    label: "Grass",
                    category: "terrain",
                    stampKinds: ["ground"],
                    url: "grass.png",
                    license: "custom",
                },
                {
                    id: "moss",
                    label: "Moss",
                    category: "terrain",
                    stampKinds: ["ground"],
                    url: "moss.png",
                    license: "custom",
                },
            ],
        };

        render(<QuickBuildToolbar />);

        fireEvent.click(screen.getByTestId("quick-build-tool-select"));
        await act(async () => {
            app.editor.select(ground);
            await Promise.resolve();
        });

        const select = await screen.findByTestId("quick-build-texture-preset");
        await waitFor(() => {
            expect(select).not.toBeDisabled();
            expect(screen.getByRole("option", {name: "Grass"})).toBeInTheDocument();
            expect(select).toHaveValue("grass");
            expect(screen.getByTestId("quick-build-texture-preview-image")).toHaveAttribute("src", expect.stringContaining("grass.png"));
        });
        expect(ground.userData.quickBuildTexture).toBeUndefined();

        fireEvent.change(select, {target: {value: "moss"}});

        await waitFor(() => {
            expect(ground.userData.quickBuildTexture).toMatchObject({presetId: "moss", label: "Moss"});
            expect(screen.getByTestId("quick-build-texture-preview-image")).toHaveAttribute("src", expect.stringContaining("moss.png"));
        });

        let texturedMaterialSlots = 0;
        ground.traverse(child => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh) return;
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            texturedMaterialSlots += materials.filter(
                material => (material as THREE.MeshStandardMaterial).map === quickBuildTextureMocks.texture,
            ).length;
        });
        expect(texturedMaterialSlots).toBe(1);
        expect(app.call).toHaveBeenCalledWith("objectChanged", app.editor, ground);
    });

    it("selects and previews a default texture for each active Quick Build tool", async () => {
        installFakeApp();
        quickBuildTextureMocks.index = {
            schema: "stem.quickBuildTexturePackIndex.v1",
            packs: [{id: "test", label: "Test", manifestUrl: "test.json", license: "custom"}],
        };
        quickBuildTextureMocks.pack = {
            schema: "stem.quickBuildTexturePack.v1",
            id: "test",
            label: "Test",
            license: "custom",
            presets: [
                {
                    id: "grass",
                    label: "Grass",
                    category: "terrain",
                    stampKinds: ["ground"],
                    url: "grass.png",
                    license: "custom",
                },
                {
                    id: "pavers",
                    label: "Pavers",
                    category: "path",
                    stampKinds: ["path"],
                    url: "pavers.png",
                    license: "custom",
                },
            ],
        };

        render(<QuickBuildToolbar />);

        const select = await screen.findByTestId("quick-build-texture-preset");
        await waitFor(() => {
            expect(select).toHaveValue("grass");
            expect(screen.getByTestId("quick-build-texture-preview-image")).toHaveAttribute("src", expect.stringContaining("grass.png"));
        });

        fireEvent.click(screen.getByTestId("quick-build-tool-path"));

        await waitFor(() => {
            expect(select).toHaveValue("pavers");
            expect(screen.getByTestId("quick-build-texture-preview-image")).toHaveAttribute("src", expect.stringContaining("pavers.png"));
        });
    });

    it("groups related stamp tools behind an upward-opening menu", () => {
        installFakeApp();

        render(<QuickBuildToolbar />);

        const natureGroup = screen.getByTestId("quick-build-group-nature");
        expect(natureGroup).toHaveAttribute("aria-expanded", "false");

        fireEvent.click(natureGroup);
        expect(natureGroup).toHaveAttribute("aria-expanded", "true");

        fireEvent.click(screen.getByTestId("quick-build-tool-tree"));
        expect(natureGroup).toHaveAttribute("aria-expanded", "false");
        expect(screen.getByTestId("quick-build-tool-tree")).toHaveAttribute("aria-pressed", "true");

        fireEvent.click(natureGroup);
        fireEvent.click(screen.getByTestId("quick-build-tool-bush-hedge"));
        expect(natureGroup).toHaveAttribute("aria-expanded", "false");
        expect(screen.getByTestId("quick-build-tool-bush-hedge")).toHaveAttribute("aria-pressed", "true");
    });

    it("places the selected procedural variant", async () => {
        const app = installFakeApp();

        render(<QuickBuildToolbar />);
        fireEvent.click(screen.getByTestId("quick-build-group-buildings"));
        fireEvent.click(screen.getByTestId("quick-build-tool-house-cabin"));

        await act(async () => {
            app.emit(
                "raycast.QuickBuildToolbar",
                {point: new THREE.Vector3(1, 0, 1), object: null},
                {preventDefault: vi.fn(), quickBuildCommit: true},
            );
            await Promise.resolve();
        });

        await waitFor(() => {
            const stamp = app.editor.scene.children.find((child: THREE.Object3D) => child.userData?.isQuickBuildObject);
            expect(stamp?.name).toBe("Quick Build Cabin");
            expect(stamp?.userData.quickBuild).toMatchObject({kind: "house", variantId: "house-cabin"});
        });
    });

    it("repairs hidden legacy Quick Build render state when the toolbar opens", async () => {
        const app = installFakeApp();
        const ground = createQuickBuildObject("ground");
        ground.visible = false;
        ground.userData.isBatchable = true;
        ground.userData.editorVisibility = false;
        const mesh = ground.children[0] as THREE.Mesh;
        mesh.userData.isBatchable = true;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach(material => {
            material.visible = false;
        });
        app.editor.scene.add(ground);

        render(<QuickBuildToolbar />);

        await waitFor(() => {
            expect(ground.visible).toBe(true);
            expect(ground.userData.isBatchable).toBe(false);
            expect(ground.userData.editorVisibility).toBe(true);
            expect(mesh.userData.isBatchable).toBe(false);
            expect(materials.every(material => material.visible)).toBe(true);
            expect(app.call).toHaveBeenCalledWith("objectChanged", app.editor, ground);
        });
    });

    it("uses the default selected texture for new Quick Build placements", async () => {
        const app = installFakeApp();
        quickBuildTextureMocks.texture = new THREE.Texture();
        quickBuildTextureMocks.index = {
            schema: "stem.quickBuildTexturePackIndex.v1",
            packs: [{id: "test", label: "Test", manifestUrl: "test.json", license: "custom"}],
        };
        quickBuildTextureMocks.pack = {
            schema: "stem.quickBuildTexturePack.v1",
            id: "test",
            label: "Test",
            license: "custom",
            presets: [
                {
                    id: "grass",
                    label: "Grass",
                    category: "terrain",
                    stampKinds: ["ground"],
                    url: "grass.png",
                    license: "custom",
                },
            ],
        };

        render(<QuickBuildToolbar />);

        await waitFor(() => {
            expect(screen.getByTestId("quick-build-texture-preset")).toHaveValue("grass");
        });
        await act(async () => {
            await Promise.resolve();
        });

        await act(async () => {
            app.emit(
                "raycast.QuickBuildToolbar",
                {point: new THREE.Vector3(0, 0, 0), object: null},
                {preventDefault: vi.fn(), quickBuildCommit: true},
            );
            await Promise.resolve();
        });

        await waitFor(() => {
            const stamp = app.editor.scene.children.find((child: THREE.Object3D) => child.userData?.isQuickBuildObject);
            expect(stamp?.userData.quickBuildTexture).toMatchObject({presetId: "grass", label: "Grass"});
        });
    });

    it("repaints an occupied same-kind cell with the selected texture instead of blocking", async () => {
        const app = installFakeApp();
        const ground = createQuickBuildObject("ground");
        app.editor.scene.add(ground);
        quickBuildTextureMocks.texture = new THREE.Texture();
        quickBuildTextureMocks.index = {
            schema: "stem.quickBuildTexturePackIndex.v1",
            packs: [{id: "test", label: "Test", manifestUrl: "test.json", license: "custom"}],
        };
        quickBuildTextureMocks.pack = {
            schema: "stem.quickBuildTexturePack.v1",
            id: "test",
            label: "Test",
            license: "custom",
            presets: [
                {
                    id: "grass",
                    label: "Grass",
                    category: "terrain",
                    stampKinds: ["ground"],
                    url: "grass.png",
                    license: "custom",
                },
            ],
        };

        render(<QuickBuildToolbar />);

        await waitFor(() => {
            expect(screen.getByTestId("quick-build-texture-preset")).toHaveValue("grass");
        });

        await act(async () => {
            app.emit(
                "raycast.QuickBuildToolbar",
                {point: new THREE.Vector3(0, 0, 0), object: ground.children[0]},
                {preventDefault: vi.fn(), quickBuildCommit: true},
            );
            await Promise.resolve();
        });

        await waitFor(() => {
            expect(app.editor.addObject).not.toHaveBeenCalled();
            expect(ground.userData.quickBuildTexture).toMatchObject({presetId: "grass", label: "Grass"});
            expect(app.call).toHaveBeenCalledWith("objectChanged", app.editor, ground);
        });
    });

    it("places a stamp from the viewport click fallback and registers it through the editor", async () => {
        const app = installFakeApp();
        const viewport = document.createElement("canvas");
        (viewport as any).getBoundingClientRect = vi.fn(() => ({
            x: 0,
            y: 0,
            left: 0,
            top: 0,
            right: 640,
            bottom: 360,
            width: 640,
            height: 360,
            toJSON: () => ({}),
        }));
        document.body.appendChild(viewport);
        (app as any).renderer = {domElement: viewport};

        render(<QuickBuildToolbar />);
        await act(async () => {
            await Promise.resolve();
        });

        await act(async () => {
            viewport.dispatchEvent(pointerViewportEvent("pointerdown", {
                button: 0,
                clientX: 120,
                clientY: 160,
                bubbles: true,
                cancelable: true,
            }));
            document.dispatchEvent(pointerViewportEvent("pointerup", {
                button: 0,
                clientX: 120,
                clientY: 160,
                bubbles: true,
                cancelable: true,
            }));
            await Promise.resolve();
        });

        await waitFor(() => {
            const stamp = app.editor.scene.children.find((child: THREE.Object3D) => child.userData?.isQuickBuildObject);
            expect(stamp).toBeTruthy();
            expect(app.editor.addObject).toHaveBeenCalledWith(stamp, undefined);
            expect(app.editor.select).not.toHaveBeenCalledWith(stamp, true);
            expect(app.editor.selected).toBeNull();
        });

        const stamp = app.editor.scene.children.find((child: THREE.Object3D) => child.userData?.isQuickBuildObject)!;

        await act(async () => {
            viewport.dispatchEvent(pointerViewportEvent("pointerdown", {
                button: 0,
                clientX: 120,
                clientY: 160,
                bubbles: true,
                cancelable: true,
            }));
            document.dispatchEvent(pointerViewportEvent("pointerup", {
                button: 0,
                clientX: 120,
                clientY: 160,
                bubbles: true,
                cancelable: true,
            }));
            await Promise.resolve();
        });

        await waitFor(() => {
            expect(app.editor.scene.children.filter((child: THREE.Object3D) => child.userData?.isQuickBuildObject)).toHaveLength(1);
            expect(stamp.userData.quickBuild.level).toBe(1);
            expect(app.editor.addObject).toHaveBeenCalledTimes(1);
        });

        viewport.remove();
    });

    it("coalesces viewport move preview raycasts to one animation frame", async () => {
        const app = installFakeApp();
        const viewport = document.createElement("canvas");
        (viewport as any).getBoundingClientRect = vi.fn(() => ({
            x: 0,
            y: 0,
            left: 0,
            top: 0,
            right: 640,
            bottom: 360,
            width: 640,
            height: 360,
            toJSON: () => ({}),
        }));
        document.body.appendChild(viewport);
        (app as any).renderer = {domElement: viewport};

        render(<QuickBuildToolbar />);
        await act(async () => {
            await Promise.resolve();
        });
        expect(app.editor.gpuPickNum).toBe(0);
        expect(app.on).not.toHaveBeenCalledWith("gpuPick.QuickBuildToolbar", expect.any(Function));

        const animationFrames = installAnimationFrameQueue();
        app.editor.computeIntersectPoint.mockClear();

        await act(async () => {
            viewport.dispatchEvent(pointerViewportEvent("pointermove", {
                clientX: 110,
                clientY: 120,
                bubbles: true,
                cancelable: true,
            }));
            viewport.dispatchEvent(pointerViewportEvent("pointermove", {
                clientX: 130,
                clientY: 140,
                bubbles: true,
                cancelable: true,
            }));
            viewport.dispatchEvent(pointerViewportEvent("pointermove", {
                clientX: 150,
                clientY: 160,
                bubbles: true,
                cancelable: true,
            }));
            await Promise.resolve();
        });

        expect(animationFrames.requestAnimationFrame).toHaveBeenCalledTimes(1);
        expect(app.editor.computeIntersectPoint).not.toHaveBeenCalled();

        await act(async () => {
            animationFrames.flushFrame();
            await Promise.resolve();
        });

        expect(app.editor.computeIntersectPoint).toHaveBeenCalledTimes(1);
        expect(app.editor.computeIntersectPoint).toHaveBeenCalledWith(
            {x: 150, y: 160},
            app.editor.sceneHelpers,
        );

        viewport.remove();
    });

    it("shows text placement status for ready and blocked preview cells", async () => {
        const app = installFakeApp();
        const ground = createQuickBuildObject("ground");
        app.editor.scene.add(ground);

        render(<QuickBuildToolbar />);
        await act(async () => {
            await Promise.resolve();
        });
        const placementStatus = screen.getByTestId("quick-build-placement-status");
        expect(placementStatus).toHaveAttribute("aria-hidden", "true");
        expect(placementStatus).toHaveTextContent("");

        await act(async () => {
            app.emit(
                "raycast.QuickBuildToolbar",
                {point: new THREE.Vector3(2, 0, 0), object: null},
                {preventDefault: vi.fn()},
            );
            await Promise.resolve();
        });

        await waitFor(() => {
            expect(placementStatus).toHaveAttribute("aria-hidden", "false");
            expect(placementStatus).toHaveTextContent("Ready 1 cell");
        });

        await act(async () => {
            app.emit(
                "raycast.QuickBuildToolbar",
                {point: new THREE.Vector3(0, 0, 0), object: null},
                {preventDefault: vi.fn()},
            );
            await Promise.resolve();
        });

        await waitFor(() => {
            expect(placementStatus).toHaveAttribute("aria-hidden", "false");
            expect(placementStatus).toHaveTextContent("Blocked occupied");
        });
    });

    it("skips an occupied terrain cell even when the raycast hits another quick build layer", async () => {
        const app = installFakeApp();
        const ground = createQuickBuildObject("ground");
        const secondGround = createQuickBuildObject("ground");
        app.editor.scene.add(ground, secondGround);

        render(<QuickBuildToolbar />);
        await act(async () => {
            await Promise.resolve();
        });
        fireEvent.click(screen.getByTestId("quick-build-tool-ground"));
        await waitFor(() => {
            expect(screen.getByTestId("quick-build-tool-ground")).toHaveAttribute("aria-pressed", "true");
        });

        await act(async () => {
            app.emit(
                "raycast.QuickBuildToolbar",
                {point: new THREE.Vector3(0, 0, 0), object: ground.children[0]},
                {preventDefault: vi.fn(), quickBuildCommit: true},
            );
            await Promise.resolve();
        });

        await waitFor(() => {
            expect(secondGround.userData.quickBuild.level).toBe(1);
            expect(app.editor.addObject).not.toHaveBeenCalled();
            expect(app.editor.select).not.toHaveBeenCalledWith(ground, expect.anything());
            expect(app.editor.select).not.toHaveBeenCalledWith(secondGround, expect.anything());
        });
    });

    it("allows stackable props to be placed more than once in the same cell", async () => {
        const app = installFakeApp();
        const tree = createQuickBuildObject("tree");
        app.editor.scene.add(tree);

        render(<QuickBuildToolbar />);
        await act(async () => {
            await Promise.resolve();
        });
        fireEvent.click(screen.getByTestId("quick-build-tool-tree"));
        await waitFor(() => {
            expect(screen.getByTestId("quick-build-tool-tree")).toHaveAttribute("aria-pressed", "true");
        });

        await act(async () => {
            app.emit(
                "raycast.QuickBuildToolbar",
                {point: new THREE.Vector3(0.2, 1.4, 0.2), object: tree.children[0]},
                {preventDefault: vi.fn(), quickBuildCommit: true},
            );
            await Promise.resolve();
        });

        await waitFor(() => {
            const trees = app.editor.scene.children.filter(
                (child: THREE.Object3D) => child.userData?.quickBuild?.kind === "tree",
            );
            expect(trees).toHaveLength(2);
            expect(app.editor.addObject).toHaveBeenCalledTimes(1);
            expect(trees[1]?.position.y).toBe(0);
            expect(trees[1]?.position.x).not.toBe(0);
            expect(trees[1]?.position.z).not.toBe(0);
        });
    });

    it("keeps stackable prop preview and committed placement aligned", async () => {
        const app = installFakeApp();

        render(<QuickBuildToolbar />);
        await act(async () => {
            await Promise.resolve();
        });
        fireEvent.click(screen.getByTestId("quick-build-tool-tree"));

        const hitPoint = new THREE.Vector3(0.2, 1.4, 0.2);
        await act(async () => {
            app.emit(
                "raycast.QuickBuildToolbar",
                {point: hitPoint, object: null},
                {preventDefault: vi.fn()},
            );
            await Promise.resolve();
        });

        const previewGroup = app.editor.sceneHelpers.children.find(
            (child: THREE.Object3D) => child.userData?.isQuickBuildPreview,
        );
        expect(previewGroup).toBeTruthy();
        const preview = previewGroup!.children[0]!;
        const previewPosition = preview.position.clone();

        await act(async () => {
            app.emit(
                "raycast.QuickBuildToolbar",
                {point: hitPoint, object: null},
                {preventDefault: vi.fn(), quickBuildCommit: true},
            );
            await Promise.resolve();
        });

        await waitFor(() => {
            const stamp = app.editor.scene.children.find(
                (child: THREE.Object3D) => child.userData?.quickBuild?.kind === "tree",
            );
            expect(stamp).toBeTruthy();
            expect(stamp!.position.x).toBeCloseTo(previewPosition.x, 5);
            expect(stamp!.position.z).toBeCloseTo(previewPosition.z, 5);
        });
    });

    it("rotates new stamps with the placement shortcut before committing", async () => {
        const app = installFakeApp();

        render(<QuickBuildToolbar />);
        await act(async () => {
            await Promise.resolve();
        });
        fireEvent.click(screen.getByTestId("quick-build-tool-house"));
        fireEvent.keyDown(window, {key: "r"});

        await waitFor(() => {
            expect(screen.getByTestId("quick-build-rotation-value")).toHaveTextContent("90deg");
        });

        await act(async () => {
            app.emit(
                "raycast.QuickBuildToolbar",
                {point: new THREE.Vector3(0, 0, 0), object: null},
                {preventDefault: vi.fn(), quickBuildCommit: true},
            );
            await Promise.resolve();
        });

        await waitFor(() => {
            const stamp = app.editor.scene.children.find(
                (child: THREE.Object3D) => child.userData?.quickBuild?.kind === "house",
            );
            expect(stamp).toBeTruthy();
            expect(stamp!.rotation.y).toBeCloseTo(Math.PI / 2, 5);
        });
    });

    it("places structures on the configured sub-tile snap instead of tile centers", async () => {
        const app = installFakeApp();

        render(<QuickBuildToolbar />);
        await act(async () => {
            await Promise.resolve();
        });
        fireEvent.click(screen.getByTestId("quick-build-tool-house"));

        await act(async () => {
            app.emit(
                "raycast.QuickBuildToolbar",
                {point: new THREE.Vector3(0.6, 0, 0.6), object: null},
                {preventDefault: vi.fn(), quickBuildCommit: true},
            );
            await Promise.resolve();
        });

        await waitFor(() => {
            const stamp = app.editor.scene.children.find(
                (child: THREE.Object3D) => child.userData?.quickBuild?.kind === "house",
            );
            expect(stamp).toBeTruthy();
            expect(stamp!.position.toArray()).toEqual([0.5, 0, 0.5]);
        });
    });

    it("uses a live instanced render cache while build tools are active and restores meshes in select mode", async () => {
        const app = installFakeApp();
        const first = createQuickBuildObject("tree");
        const second = createQuickBuildObject("tree");
        second.position.set(QUICK_BUILD_CELL_SIZE, 0, 0);
        app.editor.scene.add(first, second);

        render(<QuickBuildToolbar />);

        await waitFor(() => {
            expect(collectQuickBuildLiveBatchObjects(app.editor.scene)).toHaveLength(1);
            expect((first.children[0] as THREE.Mesh).visible).toBe(false);
            expect((second.children[0] as THREE.Mesh).visible).toBe(false);
        });

        fireEvent.click(screen.getByTestId("quick-build-tool-select"));

        await waitFor(() => {
            expect(collectQuickBuildLiveBatchObjects(app.editor.scene)).toHaveLength(0);
            expect((first.children[0] as THREE.Mesh).visible).toBe(true);
            expect((second.children[0] as THREE.Mesh).visible).toBe(true);
        });
    });

    it("places on the visible mesh hit instead of hiding stamps under existing objects", async () => {
        const app = installFakeApp();
        const viewport = document.createElement("canvas");
        (viewport as any).getBoundingClientRect = vi.fn(() => ({
            x: 0,
            y: 0,
            left: 0,
            top: 0,
            right: 640,
            bottom: 360,
            width: 640,
            height: 360,
            toJSON: () => ({}),
        }));
        document.body.appendChild(viewport);
        (app as any).renderer = {domElement: viewport};

        const camera = new THREE.PerspectiveCamera(55, 640 / 360, 0.1, 100);
        camera.position.set(0, 4, 6);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld(true);
        app.editor.camera = camera;

        const blocker = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
        blocker.position.set(0, 1, 0);
        app.editor.scene.add(blocker);
        app.editor.scene.updateMatrixWorld(true);

        render(<QuickBuildToolbar />);
        await act(async () => {
            await Promise.resolve();
        });

        await act(async () => {
            viewport.dispatchEvent(pointerViewportEvent("pointerdown", {
                button: 0,
                clientX: 320,
                clientY: 180,
                bubbles: true,
                cancelable: true,
            }));
            document.dispatchEvent(pointerViewportEvent("pointerup", {
                button: 0,
                clientX: 320,
                clientY: 180,
                bubbles: true,
                cancelable: true,
            }));
            await Promise.resolve();
        });

        await waitFor(() => {
            const stamp = app.editor.scene.children.find((child: THREE.Object3D) => child.userData?.isQuickBuildObject);
            expect(stamp).toBeTruthy();
            expect(stamp!.position.y).toBeGreaterThan(0);
        });

        viewport.remove();
    });

    it("ignores Quick Build preview helpers when resolving viewport placement", async () => {
        const app = installFakeApp();
        const viewport = document.createElement("canvas");
        (viewport as any).getBoundingClientRect = vi.fn(() => ({
            x: 0,
            y: 0,
            left: 0,
            top: 0,
            right: 640,
            bottom: 360,
            width: 640,
            height: 360,
            toJSON: () => ({}),
        }));
        document.body.appendChild(viewport);
        (app as any).renderer = {domElement: viewport};

        const camera = new THREE.PerspectiveCamera(55, 640 / 360, 0.1, 100);
        camera.position.set(0, 4, 6);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld(true);
        app.editor.camera = camera;

        const preview = createQuickBuildPreviewObject("ground");
        app.editor.scene.add(preview);
        app.editor.scene.updateMatrixWorld(true);

        render(<QuickBuildToolbar />);
        await act(async () => {
            await Promise.resolve();
        });

        await act(async () => {
            viewport.dispatchEvent(pointerViewportEvent("pointerdown", {
                button: 0,
                clientX: 320,
                clientY: 180,
                bubbles: true,
                cancelable: true,
            }));
            document.dispatchEvent(pointerViewportEvent("pointerup", {
                button: 0,
                clientX: 320,
                clientY: 180,
                bubbles: true,
                cancelable: true,
            }));
            await Promise.resolve();
        });

        await waitFor(() => {
            const realStamps = app.editor.scene.children.filter(
                (child: THREE.Object3D) => child.userData?.isQuickBuildObject === true,
            );
            expect(realStamps).toHaveLength(1);
            expect(realStamps[0]).not.toBe(preview);
            expect(app.editor.addObject).toHaveBeenCalledTimes(1);
        });

        viewport.remove();
    });

    it("uses Quick Build cell size for radius placement instead of transform grid snapping", async () => {
        const app = installFakeApp();
        app.editor.scene.userData.snapping.grid.increment = 0.25;

        render(<QuickBuildToolbar />);
        await act(async () => {
            await Promise.resolve();
        });

        fireEvent.click(screen.getByTestId("quick-build-brush-radius"));
        await waitFor(() => {
            expect(screen.getByTestId("quick-build-brush-radius")).toHaveAttribute("aria-pressed", "true");
        });

        await act(async () => {
            app.emit(
                "raycast.QuickBuildToolbar",
                {point: new THREE.Vector3(1.9, 0, 1.9), object: null},
                {preventDefault: vi.fn(), quickBuildCommit: true},
            );
            await Promise.resolve();
        });

        await waitFor(() => {
            const positions = app.editor.scene.children
                .filter((child: THREE.Object3D) => child.userData?.isQuickBuildObject)
                .map((child: THREE.Object3D) => `${child.position.x}:${child.position.z}`)
                .sort();
            expect(positions).toEqual([
                `${-QUICK_BUILD_CELL_SIZE}:0`,
                `0:${-QUICK_BUILD_CELL_SIZE}`,
                "0:0",
                `0:${QUICK_BUILD_CELL_SIZE}`,
                `${QUICK_BUILD_CELL_SIZE}:0`,
            ]);
            expect(app.editor.addObject).toHaveBeenCalledTimes(5);
        });

        const batchStartIndex = app.call.mock.calls.findIndex(
            ([eventName]) => eventName === "quickBuildBatchStarted",
        );
        const batchEndIndex = app.call.mock.calls.findIndex(
            ([eventName]) => eventName === "quickBuildBatchEnded",
        );
        expect(batchStartIndex).toBeGreaterThanOrEqual(0);
        expect(batchEndIndex).toBeGreaterThan(batchStartIndex);
        expect(app.call.mock.calls[batchStartIndex]?.[2]).toMatchObject({
            kind: "ground",
            count: 5,
        });
        expect(app.call.mock.calls[batchEndIndex]?.[2]).toMatchObject({
            kind: "ground",
            count: 5,
        });
    });

    it("switches to radius brush when the brush size control changes", async () => {
        installFakeApp();

        render(<QuickBuildToolbar />);
        await act(async () => {
            await Promise.resolve();
        });

        expect(screen.getByTestId("quick-build-brush-single")).toHaveAttribute("aria-pressed", "true");
        fireEvent.click(screen.getByLabelText("Increase quick build radius"));

        await waitFor(() => {
            expect(screen.getByTestId("quick-build-brush-radius")).toHaveAttribute("aria-pressed", "true");
            expect(screen.getByTestId("quick-build-radius-value")).toHaveTextContent("2");
        });
    });

    it("erases the Quick Build object in the clicked cell when the raycast misses the mesh", async () => {
        const app = installFakeApp();
        const ground = createQuickBuildObject("ground");
        ground.position.set(QUICK_BUILD_CELL_SIZE, 0, QUICK_BUILD_CELL_SIZE);
        app.editor.scene.add(ground);

        render(<QuickBuildToolbar />);
        await act(async () => {
            await Promise.resolve();
        });

        fireEvent.click(screen.getByTestId("quick-build-tool-erase"));
        await waitFor(() => {
            expect(screen.getByTestId("quick-build-tool-erase")).toHaveAttribute("aria-pressed", "true");
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
            expect(ground.parent).toBeNull();
            expect(app.editor.removeObject).toHaveBeenCalledWith(ground);
        });
    });

    it("highlights and restores the Quick Build erase hover target", async () => {
        const app = installFakeApp();
        const ground = createQuickBuildObject("ground");
        ground.position.set(QUICK_BUILD_CELL_SIZE, 0, QUICK_BUILD_CELL_SIZE);
        app.editor.scene.add(ground);
        let targetMesh: THREE.Mesh | null = null;
        ground.traverse((child) => {
            if (!targetMesh && (child as THREE.Mesh).isMesh) {
                targetMesh = child as THREE.Mesh;
            }
        });
        expect(targetMesh).not.toBeNull();
        const originalMaterial = targetMesh!.material;

        render(<QuickBuildToolbar />);
        await act(async () => {
            await Promise.resolve();
        });

        fireEvent.click(screen.getByTestId("quick-build-tool-erase"));
        await waitFor(() => {
            expect(screen.getByTestId("quick-build-tool-erase")).toHaveAttribute("aria-pressed", "true");
        });

        await act(async () => {
            app.emit(
                "raycast.QuickBuildToolbar",
                {point: new THREE.Vector3(2, 0, 3), object: null},
                {preventDefault: vi.fn()},
            );
            await Promise.resolve();
        });

        expect(ground.userData.quickBuildEraseHover).toBe(true);
        expect(targetMesh!.material).not.toBe(originalMaterial);

        await act(async () => {
            app.emit(
                "raycast.QuickBuildToolbar",
                {point: new THREE.Vector3(20, 0, 20), object: null},
                {preventDefault: vi.fn()},
            );
            await Promise.resolve();
        });

        expect(ground.userData.quickBuildEraseHover).toBeUndefined();
        expect(targetMesh!.material).toBe(originalMaterial);
    });

    it("does not place stamps from unmarked event-bus raycast previews", async () => {
        const app = installFakeApp();

        render(<QuickBuildToolbar />);
        await act(async () => {
            await Promise.resolve();
        });

        await act(async () => {
            app.emit(
                "raycast.QuickBuildToolbar",
                {point: new THREE.Vector3(2, 0, 3), object: null},
                {preventDefault: vi.fn()},
            );
            await Promise.resolve();
        });

        expect(app.editor.scene.children.some((child: THREE.Object3D) => child.userData?.isQuickBuildObject)).toBe(false);
        expect(app.editor.addObject).not.toHaveBeenCalled();
    });

    it("bakes runtime batches without hiding editable stamps and clears them", async () => {
        const app = installFakeApp();
        const tree = createQuickBuildObject("tree");
        const rock = createQuickBuildObject("rock");
        rock.position.set(2, 0, 0);
        app.editor.scene.add(tree, rock);

        render(<QuickBuildToolbar />);

        await waitFor(() => {
            expect(screen.getByTestId("quick-build-bake-batch")).not.toBeDisabled();
        });

        fireEvent.click(screen.getByTestId("quick-build-bake-batch"));

        await waitFor(() => {
            expect(collectQuickBuildBakeObjects(app.editor.scene)).toHaveLength(1);
            expect(tree.visible).toBe(true);
            expect(tree.userData.editorVisibility).toBe(true);
            expect(tree.userData.gameVisibility).toBe(false);
            expect(tree.userData.quickBuildRuntimeBakeUuid).toBeTruthy();
        });

        await waitFor(() => {
            expect(screen.getByTestId("quick-build-clear-bakes")).not.toBeDisabled();
        });
        fireEvent.click(screen.getByTestId("quick-build-clear-bakes"));

        await waitFor(() => {
            expect(collectQuickBuildBakeObjects(app.editor.scene)).toHaveLength(0);
            expect(tree.userData.gameVisibility).toBe(true);
            expect(tree.userData.quickBuildRuntimeBakeUuid).toBeUndefined();
            expect(rock.userData.gameVisibility).toBe(true);
        });
    });

    it("surfaces Quick Build bake command failures", async () => {
        const app = installFakeApp();
        const tree = createQuickBuildObject("tree");
        app.editor.scene.add(tree);
        app.editor.execute.mockRejectedValueOnce(new Error("history failed"));

        render(<QuickBuildToolbar />);

        await waitFor(() => {
            expect(screen.getByTestId("quick-build-bake-batch")).not.toBeDisabled();
        });
        fireEvent.click(screen.getByTestId("quick-build-bake-batch"));

        await waitFor(() => {
            expect(showToast).toHaveBeenCalledWith({
                type: "error",
                body: "Could not optimize Quick Build stamps for play.",
            });
        });
    });
});
