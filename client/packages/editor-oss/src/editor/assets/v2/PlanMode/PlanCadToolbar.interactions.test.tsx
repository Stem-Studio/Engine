import {afterEach, describe, expect, it, vi} from "vitest";
import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import type {ReactNode} from "react";
import * as THREE from "three";

import global from "@stem/editor-oss/global";
import {PlanCadToolbar} from "./PlanCadToolbar";
import {
    createDefaultPlanCadData,
    createPlanCadWall,
    findPlanCadNodeObjectById,
    findPlanCadRoot,
    syncPlanCadScene,
} from "./planCadEditorBridge";

vi.mock("../common/Tooltip", () => ({
    Tooltip: ({children}: {children: ReactNode}) => <>{children}</>,
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
    const scene = new THREE.Scene();
    scene.userData.snapping = {grid: {enabled: true, increment: 1}};
    const sceneHelpers = new THREE.Scene();
    const handlers = new Map<string, (...args: any[]) => void>();
    const app = {
        isPlaying: false,
        disableClickEvents: false,
        editor: {
            scene,
            sceneHelpers,
            gpuPickNum: 0,
            computeIntersectPoint: vi.fn(() => new THREE.Vector3()),
            execute: vi.fn(async command => command.execute?.()),
            addObject: vi.fn((object: THREE.Object3D, parent?: THREE.Object3D) => {
                (parent ?? scene).add(object);
            }),
            select: vi.fn(),
        },
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

function activateGroupedTool(groupId: string, toolId: string) {
    fireEvent.click(screen.getByTestId(`plan-cad-group-${groupId}`));
    fireEvent.click(screen.getByTestId(`plan-cad-tool-${toolId}`));
}

function installViewportRaycastHarness(app: ReturnType<typeof installFakeApp>) {
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

    const camera = new THREE.OrthographicCamera(-4, 4, 2.25, -2.25, 0.1, 50);
    camera.position.set(0, 10, 0);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    (app.editor as any).orthCamera = camera;

    return viewport;
}

function installPerspectiveViewportRaycastHarness(app: ReturnType<typeof installFakeApp>) {
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

    const camera = new THREE.PerspectiveCamera(60, 640 / 360, 0.1, 100);
    camera.position.set(0, 10, 10);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    (app.editor as any).camera = camera;
    (app.editor as any).view = "perspective";

    return viewport;
}

async function installSyncedWall(app: ReturnType<typeof installFakeApp>) {
    const data = createPlanCadWall(
        createDefaultPlanCadData(),
        {x: -2, z: 0},
        {x: 2, z: 0},
    );
    app.editor.scene.userData.planCad = data;
    await syncPlanCadScene(app.editor as any, {force: true});
    const root = findPlanCadRoot(app.editor.scene);
    const wallObject = findPlanCadNodeObjectById(root, data.selectedNodeId);
    expect(wallObject).toBeTruthy();
    expect(wallObject?.userData.isRuntimeOnly).toBe(true);
    expect(wallObject?.userData.isPlanCadManaged).toBe(true);
    return wallObject!;
}

describe("PlanCadToolbar interactions", () => {
    afterEach(() => {
        cleanup();
        global.app = null;
        delete (window as any).logger;
        vi.restoreAllMocks();
    });

    it("activates a tool on pointer down before the browser click target can drift", async () => {
        installFakeApp();
        render(<PlanCadToolbar />);

        expect(screen.getByTestId("plan-cad-tool-select")).toHaveAttribute("aria-label", "Select BIM tool (V)");
        expect(screen.getByTestId("plan-cad-group-structure")).toHaveAttribute(
            "aria-label",
            "Structure BIM tools: Wall (1), Room (2), Zone (3)",
        );

        activateGroupedTool("openings", "door");
        await waitFor(() => {
            expect(screen.getByTestId("plan-cad-tool-door")).toHaveAttribute("aria-pressed", "true");
        });

        fireEvent.click(screen.getByTestId("plan-cad-group-openings"));
        fireEvent.pointerDown(screen.getByTestId("plan-cad-tool-window"), {
            button: 0,
            isPrimary: true,
        });

        await waitFor(() => {
            expect(screen.getByTestId("plan-cad-tool-door")).toHaveAttribute("aria-pressed", "false");
            expect(screen.getByTestId("plan-cad-tool-window")).toHaveAttribute("aria-pressed", "true");
        });
    });

    it("closes BIM Plan and clears active drafting state", async () => {
        installFakeApp();
        const onClose = vi.fn();
        render(<PlanCadToolbar onClose={onClose} />);

        activateGroupedTool("structure", "wall");
        await waitFor(() => {
            expect(screen.getByTestId("plan-cad-tool-wall")).toHaveAttribute("aria-pressed", "true");
        });

        fireEvent.click(screen.getByTestId("plan-cad-close"));

        await waitFor(() => {
            expect(screen.getByTestId("plan-cad-tool-select")).toHaveAttribute("aria-pressed", "true");
        });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("does not add an opening when no wall target exists", async () => {
        const app = installFakeApp();
        render(<PlanCadToolbar />);

        activateGroupedTool("openings", "door");
        await waitFor(() => {
            expect(screen.getByTestId("plan-cad-tool-door")).toHaveAttribute("aria-pressed", "true");
        });

        await act(async () => {
            app.emit("raycast.PlanCadToolbar", {point: new THREE.Vector3(2, 0, 2), object: null}, {preventDefault: vi.fn()});
        });

        expect(screen.queryByTestId("plan-cad-measurement")).toBeNull();
        expect(app.editor.scene.userData.planCad).toBeUndefined();
    });

    it("cancels a wall draft with Escape and returns to select", async () => {
        const app = installFakeApp();
        render(<PlanCadToolbar />);

        activateGroupedTool("structure", "wall");
        await waitFor(() => {
            expect(screen.getByTestId("plan-cad-tool-wall")).toHaveAttribute("aria-pressed", "true");
        });

        await act(async () => {
            app.emit("raycast.PlanCadToolbar", {point: new THREE.Vector3(0, 0, 0), object: null}, {preventDefault: vi.fn(), planCadCommit: true});
            await Promise.resolve();
        });
        expect(screen.getByText("Wall start")).toBeInTheDocument();

        fireEvent.keyDown(window, {key: "Escape"});
        await waitFor(() => {
            expect(screen.queryByText("Wall start")).not.toBeInTheDocument();
            expect(screen.getByTestId("plan-cad-tool-select")).toHaveAttribute("aria-pressed", "true");
        });
    });

    it("cancels a wall draft from the toolbar without creating a wall", async () => {
        const app = installFakeApp();
        render(<PlanCadToolbar />);

        activateGroupedTool("structure", "wall");
        await waitFor(() => {
            expect(screen.getByTestId("plan-cad-tool-wall")).toHaveAttribute("aria-pressed", "true");
        });

        await act(async () => {
            app.emit("raycast.PlanCadToolbar", {point: new THREE.Vector3(0, 0, 0), object: null}, {preventDefault: vi.fn(), planCadCommit: true});
            await Promise.resolve();
        });
        expect(screen.getByText("Wall start")).toBeInTheDocument();

        fireEvent.click(screen.getByTestId("plan-cad-cancel-draft"));

        await waitFor(() => {
            expect(screen.queryByText("Wall start")).not.toBeInTheDocument();
            expect(screen.getByTestId("plan-cad-tool-select")).toHaveAttribute("aria-pressed", "true");
        });
        expect(app.editor.scene.userData.planCad).toBeUndefined();
    });

    it("finishes room polygons with Enter", async () => {
        const app = installFakeApp();
        render(<PlanCadToolbar />);

        activateGroupedTool("structure", "room");
        await waitFor(() => {
            expect(screen.getByTestId("plan-cad-tool-room")).toHaveAttribute("aria-pressed", "true");
        });

        await act(async () => {
            app.emit("raycast.PlanCadToolbar", {point: new THREE.Vector3(0, 0, 0), object: null}, {preventDefault: vi.fn(), planCadCommit: true});
            app.emit("raycast.PlanCadToolbar", {point: new THREE.Vector3(4, 0, 0), object: null}, {preventDefault: vi.fn(), planCadCommit: true});
            app.emit("raycast.PlanCadToolbar", {point: new THREE.Vector3(4, 0, 3), object: null}, {preventDefault: vi.fn(), planCadCommit: true});
            await Promise.resolve();
        });

        fireEvent.keyDown(window, {key: "Enter"});

        await waitFor(() => {
            const slabs = Object.values(app.editor.scene.userData.planCad.nodes).filter(
                (node: any): node is {type: "slab"; points: unknown[]} => node.type === "slab",
            );
            expect(slabs[0]?.points).toHaveLength(3);
        });
    });

    it("finishes a room draft on double click without adding another point", async () => {
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
        app.editor.computeIntersectPoint
            .mockReturnValueOnce(new THREE.Vector3(0, 0, 0))
            .mockReturnValueOnce(new THREE.Vector3(4, 0, 0))
            .mockReturnValueOnce(new THREE.Vector3(4, 0, 3));

        render(<PlanCadToolbar />);
        activateGroupedTool("structure", "room");
        await waitFor(() => {
            expect(screen.getByTestId("plan-cad-tool-room")).toHaveAttribute("aria-pressed", "true");
        });

        for (const [clientX, clientY] of [[80, 120], [180, 120], [180, 220]]) {
            await act(async () => {
                viewport.dispatchEvent(pointerViewportEvent("pointerdown", {
                    button: 0,
                    clientX,
                    clientY,
                    bubbles: true,
                    cancelable: true,
                }));
                document.dispatchEvent(pointerViewportEvent("pointerup", {
                    button: 0,
                    clientX,
                    clientY,
                    bubbles: true,
                    cancelable: true,
                }));
                await Promise.resolve();
            });
        }

        await act(async () => {
            viewport.dispatchEvent(pointerViewportEvent("pointerdown", {
                button: 0,
                clientX: 200,
                clientY: 240,
                detail: 2,
                bubbles: true,
                cancelable: true,
            }));
            document.dispatchEvent(pointerViewportEvent("pointerup", {
                button: 0,
                clientX: 200,
                clientY: 240,
                detail: 2,
                bubbles: true,
                cancelable: true,
            }));
            await Promise.resolve();
        });

        await waitFor(() => {
            const slabs = Object.values(app.editor.scene.userData.planCad.nodes).filter(
                (node: any): node is {type: "slab"; points: unknown[]} => node.type === "slab",
            );
            expect(slabs[0]?.points).toHaveLength(3);
        });
        expect(app.editor.computeIntersectPoint).toHaveBeenCalledTimes(3);
        viewport.remove();
    });

    it("explains why polygon finish is disabled before three points", async () => {
        const app = installFakeApp();
        render(<PlanCadToolbar />);

        activateGroupedTool("structure", "room");
        await waitFor(() => {
            expect(screen.getByTestId("plan-cad-tool-room")).toHaveAttribute("aria-pressed", "true");
        });

        await act(async () => {
            app.emit("raycast.PlanCadToolbar", {point: new THREE.Vector3(0, 0, 0), object: null}, {preventDefault: vi.fn(), planCadCommit: true});
            app.emit("raycast.PlanCadToolbar", {point: new THREE.Vector3(4, 0, 0), object: null}, {preventDefault: vi.fn(), planCadCommit: true});
            await Promise.resolve();
        });

        const finishButton = screen.getByTestId("plan-cad-finish-polygon");
        expect(finishButton).toBeDisabled();
        expect(finishButton).toHaveAttribute("title", "Add at least 3 points to finish this polygon.");
    });

    it("labels interchange actions and surfaces malformed import errors", async () => {
        const app = installFakeApp();
        const error = vi.fn();
        (window as any).logger = {error};
        render(<PlanCadToolbar />);

        fireEvent.click(screen.getByTestId("plan-cad-interchange"));

        expect(screen.getByTestId("plan-cad-export-json")).toHaveTextContent("Export Plan JSON");
        expect(screen.getByTestId("plan-cad-export-dxf")).toHaveTextContent("Export DXF (walls & polygons)");
        expect(screen.getByTestId("plan-cad-export-ifc")).toHaveTextContent("Export IFC (basic)");
        expect(screen.getByTestId("plan-cad-import-json")).toHaveTextContent("Import Plan JSON");
        expect(screen.getByTestId("plan-cad-import-dxf")).toHaveTextContent("Import DXF (walls & polygons)");
        expect(screen.getByTestId("plan-cad-import-ifc")).toHaveTextContent("Import IFC (basic)");

        fireEvent.click(screen.getByTestId("plan-cad-import-json"));
        const file = new File(["not-json"], "bad-plan.json", {type: "application/json"});

        await act(async () => {
            fireEvent.change(screen.getByTestId("plan-cad-import-input"), {
                target: {files: [file]},
            });
            await Promise.resolve();
        });

        await waitFor(() => {
            expect(screen.getByTestId("plan-cad-interchange-status")).toHaveTextContent(
                "Plan JSON import failed",
            );
        });
        expect(app.editor.scene.userData.planCad).toBeUndefined();
        expect(error).toHaveBeenCalledWith(
            "[BIMCAD] Plan import failed",
            expect.objectContaining({
                format: "Plan JSON",
                error: expect.any(String),
            }),
        );
    }, 120000);

    it("shows a part footprint preview while hovering", async () => {
        const app = installFakeApp();
        render(<PlanCadToolbar />);

        activateGroupedTool("objects", "part");
        await waitFor(() => {
            expect(screen.getByTestId("plan-cad-tool-part")).toHaveAttribute("aria-pressed", "true");
        });

        await act(async () => {
            app.emit("gpuPick.PlanCadToolbar", {point: new THREE.Vector3(2, 0, 2)});
        });

        expect(app.editor.sceneHelpers.children.some(child => child.userData.isPlanCadPreview)).toBe(true);
    });

    it("creates chained walls from viewport click fallback events", async () => {
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
        app.editor.computeIntersectPoint
            .mockReturnValueOnce(new THREE.Vector3(0, 0, 0))
            .mockReturnValueOnce(new THREE.Vector3(4, 0, 0))
            .mockReturnValueOnce(new THREE.Vector3(4, 0, 3));

        render(<PlanCadToolbar />);

        activateGroupedTool("structure", "wall");
        await waitFor(() => {
            expect(screen.getByTestId("plan-cad-tool-wall")).toHaveAttribute("aria-pressed", "true");
        });

        await act(async () => {
            viewport.dispatchEvent(pointerViewportEvent("pointerdown", {
                button: 0,
                clientX: 80,
                clientY: 120,
                bubbles: true,
                cancelable: true,
            }));
            document.dispatchEvent(pointerViewportEvent("pointerup", {
                button: 0,
                clientX: 80,
                clientY: 120,
                bubbles: true,
                cancelable: true,
            }));
            await Promise.resolve();
        });

        await act(async () => {
            viewport.dispatchEvent(pointerViewportEvent("pointerdown", {
                button: 0,
                clientX: 180,
                clientY: 120,
                bubbles: true,
                cancelable: true,
            }));
            document.dispatchEvent(pointerViewportEvent("pointerup", {
                button: 0,
                clientX: 180,
                clientY: 120,
                bubbles: true,
                cancelable: true,
            }));
            await Promise.resolve();
        });

        await waitFor(() => {
            const walls = Object.values(app.editor.scene.userData.planCad.nodes).filter(
                (node: any): node is {type: "wall"} => node.type === "wall",
            );
            expect(walls).toHaveLength(1);
        });

        expect(screen.getByText("Wall start")).toBeInTheDocument();

        await act(async () => {
            viewport.dispatchEvent(pointerViewportEvent("pointerdown", {
                button: 0,
                clientX: 180,
                clientY: 220,
                bubbles: true,
                cancelable: true,
            }));
            document.dispatchEvent(pointerViewportEvent("pointerup", {
                button: 0,
                clientX: 180,
                clientY: 220,
                bubbles: true,
                cancelable: true,
            }));
            await Promise.resolve();
        });

        await waitFor(() => {
            const walls = Object.values(app.editor.scene.userData.planCad.nodes).filter(
                (node: any): node is {
                    type: "wall";
                    start: {x: number; z: number};
                    end: {x: number; z: number};
                } => node.type === "wall",
            );
            expect(walls).toHaveLength(2);
            expect(
                walls.some(
                    wall =>
                        wall.start.x === 4 &&
                        wall.start.z === 0 &&
                        wall.end.x === 4 &&
                        wall.end.z === 3,
                ),
            ).toBe(true);
        });

        viewport.remove();
    });

    it("drafts structure points on the plan plane instead of perspective scene obstructions", async () => {
        const app = installFakeApp();
        const viewport = installPerspectiveViewportRaycastHarness(app);
        const obstruction = new THREE.Mesh(
            new THREE.BoxGeometry(6, 6, 6),
            new THREE.MeshBasicMaterial(),
        );
        obstruction.position.set(0, 5, 5);
        app.editor.scene.add(obstruction);

        render(<PlanCadToolbar />);
        activateGroupedTool("structure", "wall");
        await waitFor(() => {
            expect(screen.getByTestId("plan-cad-tool-wall")).toHaveAttribute("aria-pressed", "true");
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

        await act(async () => {
            viewport.dispatchEvent(pointerViewportEvent("pointerdown", {
                button: 0,
                clientX: 420,
                clientY: 180,
                bubbles: true,
                cancelable: true,
            }));
            document.dispatchEvent(pointerViewportEvent("pointerup", {
                button: 0,
                clientX: 420,
                clientY: 180,
                bubbles: true,
                cancelable: true,
            }));
            await Promise.resolve();
        });

        await waitFor(() => {
            const walls = Object.values(app.editor.scene.userData.planCad.nodes).filter(
                (node: any): node is {type: "wall"; start: {x: number; z: number}} => node.type === "wall",
            );
            expect(walls).toHaveLength(1);
            expect(walls[0]?.start.z).toBeCloseTo(0, 5);
        });
        expect(app.editor.computeIntersectPoint).not.toHaveBeenCalled();
        viewport.remove();
    });

    it("selects generated BIM structures from viewport select hits", async () => {
        const app = installFakeApp();
        const viewport = installViewportRaycastHarness(app);
        const obstruction = new THREE.Mesh(
            new THREE.BoxGeometry(6, 1, 6),
            new THREE.MeshBasicMaterial(),
        );
        obstruction.position.set(0, 6, 0);
        app.editor.scene.add(obstruction);
        const wallObject = await installSyncedWall(app);

        render(<PlanCadToolbar />);

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

        expect(app.editor.select).toHaveBeenCalledWith(wallObject);
        viewport.remove();
    });

    it("adds an opening when viewport raycast hits a generated wall", async () => {
        const app = installFakeApp();
        const viewport = installViewportRaycastHarness(app);
        await installSyncedWall(app);

        render(<PlanCadToolbar />);
        activateGroupedTool("openings", "door");
        await waitFor(() => {
            expect(screen.getByTestId("plan-cad-tool-door")).toHaveAttribute("aria-pressed", "true");
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
            const walls = Object.values(app.editor.scene.userData.planCad.nodes).filter(
                (node: any): node is {type: "wall"; openings: unknown[]} => node.type === "wall",
            );
            expect(walls[0]?.openings).toHaveLength(1);
        });
        expect(screen.queryByTestId("plan-cad-measurement")).toBeNull();
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

        render(<PlanCadToolbar />);
        activateGroupedTool("structure", "wall");
        await waitFor(() => {
            expect(screen.getByTestId("plan-cad-tool-wall")).toHaveAttribute("aria-pressed", "true");
        });

        const animationFrames = installAnimationFrameQueue();
        app.editor.computeIntersectPoint.mockClear();

        await act(async () => {
            viewport.dispatchEvent(pointerViewportEvent("pointermove", {
                clientX: 80,
                clientY: 90,
                bubbles: true,
                cancelable: true,
            }));
            viewport.dispatchEvent(pointerViewportEvent("pointermove", {
                clientX: 120,
                clientY: 130,
                bubbles: true,
                cancelable: true,
            }));
            viewport.dispatchEvent(pointerViewportEvent("pointermove", {
                clientX: 160,
                clientY: 170,
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
            {x: 160, y: 170},
            app.editor.sceneHelpers,
        );

        viewport.remove();
    });

    it("adds an opening to a wall after switching tools", async () => {
        const app = installFakeApp();
        render(<PlanCadToolbar />);

        activateGroupedTool("structure", "wall");
        await waitFor(() => {
            expect(screen.getByTestId("plan-cad-tool-wall")).toHaveAttribute("aria-pressed", "true");
        });

        await act(async () => {
            app.emit("raycast.PlanCadToolbar", {point: new THREE.Vector3(0, 0, 0), object: null}, {preventDefault: vi.fn(), planCadCommit: true});
            await Promise.resolve();
        });
        await waitFor(() => {
            expect(screen.getByText("Wall start")).toBeInTheDocument();
        });

        await act(async () => {
            app.emit("raycast.PlanCadToolbar", {point: new THREE.Vector3(4, 0, 0), object: null}, {preventDefault: vi.fn(), planCadCommit: true});
            await Promise.resolve();
        });

        await waitFor(() => {
            const walls = Object.values(app.editor.scene.userData.planCad.nodes).filter(
                (node: any): node is {type: "wall"; openings: unknown[]} => node.type === "wall",
            );
            expect(walls).toHaveLength(1);
        });

        activateGroupedTool("openings", "door");
        await waitFor(() => {
            expect(screen.getByTestId("plan-cad-tool-door")).toHaveAttribute("aria-pressed", "true");
        });

        await act(async () => {
            app.emit("raycast.PlanCadToolbar", {point: new THREE.Vector3(2, 0, 0.1), object: null}, {preventDefault: vi.fn(), planCadCommit: true});
            await Promise.resolve();
        });

        await waitFor(() => {
            const walls = Object.values(app.editor.scene.userData.planCad.nodes).filter(
                (node: any): node is {type: "wall"; openings: unknown[]} => node.type === "wall",
            );
            expect(walls[0]?.openings).toHaveLength(1);
        });
    });
});
