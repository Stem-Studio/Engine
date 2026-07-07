import {afterEach, describe, expect, it, vi} from "vitest";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import type {ReactNode} from "react";
import * as THREE from "three";

import global from "@stem/editor-oss/global";
import {CADActionBarControls} from "./CADActionBarControls";

vi.mock("../common", () => ({
    Tooltip: ({children}: {children: ReactNode}) => <>{children}</>,
}));

vi.mock("../common/NumericInput", () => ({
    NumericInput: ({value}: {value: number}) => <input aria-label="CAD numeric value" readOnly value={value} />,
}));

type TestCadSelectionMode = "object" | "vertex" | "edge" | "face";

type TestCadController = {
    selectedEdgeIds: Set<number>;
    selectedVertexIds: Set<number>;
    selectedFaceIds: Set<number>;
    getSelectedEdgeLength: ReturnType<typeof vi.fn<() => number | null>>;
};

type TestEditor = {
    scene: THREE.Scene;
    selected: THREE.Object3D | THREE.Object3D[] | null;
    cadMode: boolean;
    cadEditedObjectUuid: string | null;
    cadEditedObject: THREE.Mesh | null;
    cadSelectionMode: TestCadSelectionMode;
    cadSelectionShape: string;
    cadTool: string;
    cadAxisConstraint: string[];
    cadController: TestCadController;
    getCADSupport: ReturnType<typeof vi.fn<() => {supported: boolean; reason: string | null}>>;
    enterCADMode: ReturnType<typeof vi.fn<(mesh: THREE.Mesh) => boolean>>;
    exitCADMode: ReturnType<typeof vi.fn<() => void>>;
    setCADSelectionMode: ReturnType<typeof vi.fn<(mode: TestCadSelectionMode) => void>>;
    setCADSelectionShape: ReturnType<typeof vi.fn<(shape: string) => void>>;
    setCADTool: ReturnType<typeof vi.fn<(tool: string) => void>>;
    setCADAxisConstraint: ReturnType<typeof vi.fn<(axes: string[]) => void>>;
    applyCADExtrude: ReturnType<typeof vi.fn<(amount: number) => boolean>>;
    applyCADInset: ReturnType<typeof vi.fn<(amount: number) => boolean>>;
    applyCADBevel: ReturnType<typeof vi.fn<(amount: number) => boolean>>;
    applyCADEdgeLength: ReturnType<typeof vi.fn<(length: number) => boolean>>;
    applyCADEdgeBevel: ReturnType<typeof vi.fn<(width: number, steps: number, profile: string) => boolean>>;
};

function installFakeApp() {
    const scene = new THREE.Scene();
    scene.userData.cadTools = {enabled: true};
    const selectedMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    scene.add(selectedMesh);
    const handlers = new Map<string, (...args: unknown[]) => void>();

    const emitCad = (name: string) => {
        handlers.get(`${name}.CADActionBarControls`)?.();
    };

    let editor: TestEditor;
    editor = {
        scene,
        selected: selectedMesh,
        cadMode: false,
        cadEditedObjectUuid: null,
        get cadEditedObject() {
            return editor.cadEditedObjectUuid === selectedMesh.uuid ? selectedMesh : null;
        },
        cadSelectionMode: "object",
        cadSelectionShape: "box",
        cadTool: "select",
        cadAxisConstraint: ["x", "y", "z"],
        cadController: {
            selectedEdgeIds: new Set(),
            selectedVertexIds: new Set(),
            selectedFaceIds: new Set(),
            getSelectedEdgeLength: vi.fn(() => null),
        },
        getCADSupport: vi.fn(() => ({supported: true, reason: null})),
        enterCADMode: vi.fn((mesh: THREE.Mesh) => {
            editor.cadMode = true;
            editor.cadEditedObjectUuid = mesh.uuid;
            editor.cadSelectionMode = "vertex";
            editor.cadTool = "move";
            emitCad("cadModeChanged");
            emitCad("cadSelectionModeChanged");
            emitCad("cadToolChanged");
            return true;
        }),
        exitCADMode: vi.fn(() => {
            editor.cadMode = false;
            editor.cadEditedObjectUuid = null;
            editor.cadSelectionMode = "object";
            editor.cadTool = "select";
            emitCad("cadModeChanged");
        }),
        setCADSelectionMode: vi.fn((mode: TestCadSelectionMode) => {
            editor.cadSelectionMode = mode;
            emitCad("cadSelectionModeChanged");
        }),
        setCADSelectionShape: vi.fn((shape: string) => {
            editor.cadSelectionShape = shape;
            emitCad("cadSelectionShapeChanged");
        }),
        setCADTool: vi.fn((tool: string) => {
            editor.cadTool = tool;
            if (tool === "extrude" || tool === "inset" || tool === "bevel") {
                editor.cadSelectionMode = "face";
                editor.cadController.selectedFaceIds = new Set([1]);
                emitCad("cadSelectionModeChanged");
            }
            emitCad("cadToolChanged");
        }),
        setCADAxisConstraint: vi.fn((axes: string[]) => {
            editor.cadAxisConstraint = axes;
            emitCad("cadAxisConstraintChanged");
        }),
        applyCADExtrude: vi.fn(() => true),
        applyCADInset: vi.fn(() => true),
        applyCADBevel: vi.fn(() => true),
        applyCADEdgeLength: vi.fn(() => true),
        applyCADEdgeBevel: vi.fn(() => true),
    };

    const app = {
        editor,
        on: vi.fn((key: string, handler: ((...args: unknown[]) => void) | null) => {
            if (handler) handlers.set(key, handler);
            else handlers.delete(key);
        }),
        call: vi.fn(),
    };
    global.app = app as unknown as typeof global.app;
    return {app, editor, selectedMesh};
}

function setEditingMesh(
    editor: TestEditor,
    selectedMesh: THREE.Mesh,
    options: {
        selectionMode?: "vertex" | "edge" | "face";
        tool?: string;
        selectedEdges?: number[];
        selectedFaces?: number[];
    } = {},
) {
    editor.cadMode = true;
    editor.cadEditedObjectUuid = selectedMesh.uuid;
    editor.cadSelectionMode = options.selectionMode ?? "vertex";
    editor.cadTool = options.tool ?? "move";
    editor.cadController.selectedEdgeIds = new Set(options.selectedEdges ?? []);
    editor.cadController.selectedFaceIds = new Set(options.selectedFaces ?? []);
}

async function chooseSurfaceOperation(operation: "extrude" | "inset" | "bevel") {
    fireEvent.click(screen.getByTestId("mesh-cad-menu-surfaceOperation"));
    fireEvent.click(await screen.findByTestId(`mesh-cad-option-${operation}`));
}

describe("CADActionBarControls", () => {
    afterEach(() => {
        cleanup();
        global.app = null;
    });

    it("enters Mesh CAD edit mode and applies a face extrusion", async () => {
        const {editor, selectedMesh} = installFakeApp();

        render(<CADActionBarControls forceVisible allowAutoVisible={false} />);

        fireEvent.click(screen.getByTestId("mesh-cad-edit-mode"));

        await waitFor(() => {
            expect(editor.enterCADMode).toHaveBeenCalledWith(selectedMesh);
            expect(screen.getByTestId("mesh-cad-menu-surfaceOperation")).not.toBeDisabled();
        });

        await chooseSurfaceOperation("extrude");

        await waitFor(() => {
            expect(editor.setCADTool).toHaveBeenCalledWith("extrude");
            expect(screen.getByTestId("mesh-cad-apply-operation")).not.toBeDisabled();
        });

        fireEvent.click(screen.getByTestId("mesh-cad-apply-operation"));

        expect(editor.applyCADExtrude).toHaveBeenCalledWith(0.25);
    });

    it("keeps Mesh CAD visible but disables edit mode when no mesh is selected", () => {
        const {editor} = installFakeApp();
        editor.selected = null;

        render(<CADActionBarControls forceVisible allowAutoVisible={false} />);

        const editMode = screen.getByTestId("mesh-cad-edit-mode");
        expect(editMode).toBeDisabled();

        fireEvent.click(editMode);

        expect(editor.enterCADMode).not.toHaveBeenCalled();
    });

    it("applies Mesh CAD inset and face bevel operations", async () => {
        const {editor, selectedMesh} = installFakeApp();
        setEditingMesh(editor, selectedMesh, {
            selectionMode: "face",
            tool: "move",
            selectedFaces: [1],
        });

        render(<CADActionBarControls forceVisible allowAutoVisible={false} />);

        await chooseSurfaceOperation("inset");
        await waitFor(() => {
            expect(screen.getByTestId("mesh-cad-apply-operation")).not.toBeDisabled();
        });
        fireEvent.click(screen.getByTestId("mesh-cad-apply-operation"));
        expect(editor.applyCADInset).toHaveBeenCalledWith(0.25);

        await chooseSurfaceOperation("bevel");
        await waitFor(() => {
            expect(screen.getByTestId("mesh-cad-apply-operation")).not.toBeDisabled();
        });
        fireEvent.click(screen.getByTestId("mesh-cad-apply-operation"));
        expect(editor.applyCADBevel).toHaveBeenCalledWith(0.25);
    });

    it("keeps CAD dropdowns bound to the edited mesh if normal selection changes", async () => {
        const {editor, selectedMesh} = installFakeApp();
        setEditingMesh(editor, selectedMesh, {
            selectionMode: "vertex",
            tool: "move",
        });
        editor.selected = new THREE.DirectionalLight();

        render(<CADActionBarControls forceVisible allowAutoVisible={false} />);

        expect(screen.getByTestId("mesh-cad-menu-selectionMode")).not.toBeDisabled();

        fireEvent.click(screen.getByTestId("mesh-cad-menu-selectionMode"));
        fireEvent.click(await screen.findByTestId("mesh-cad-option-edge"));

        expect(editor.setCADSelectionMode).toHaveBeenCalledWith("edge");
    });

    it("toggles Mesh CAD axis constraints", async () => {
        const {editor, selectedMesh} = installFakeApp();
        setEditingMesh(editor, selectedMesh, {
            selectionMode: "vertex",
            tool: "move",
        });

        render(<CADActionBarControls forceVisible allowAutoVisible={false} />);

        fireEvent.click(screen.getByTestId("mesh-cad-axis-menu"));
        fireEvent.click(await screen.findByTestId("mesh-cad-axis-x"));

        expect(editor.setCADAxisConstraint).toHaveBeenCalledWith(["y", "z"]);

        fireEvent.click(await screen.findByTestId("mesh-cad-axis-all"));

        expect(editor.setCADAxisConstraint).toHaveBeenCalledWith(["x", "y", "z"]);
    });

    it("applies Mesh CAD edge length and edge bevel controls", async () => {
        const {editor, selectedMesh} = installFakeApp();
        setEditingMesh(editor, selectedMesh, {
            selectionMode: "edge",
            tool: "move",
            selectedEdges: [1],
        });
        editor.cadController.getSelectedEdgeLength = vi.fn(() => 2.5);

        render(<CADActionBarControls forceVisible allowAutoVisible={false} />);

        await waitFor(() => {
            expect(screen.getByTestId("mesh-cad-apply-edge-length")).not.toBeDisabled();
        });
        fireEvent.click(screen.getByTestId("mesh-cad-apply-edge-length"));
        expect(editor.applyCADEdgeLength).toHaveBeenCalledWith(2.5);

        fireEvent.click(screen.getByTestId("mesh-cad-apply-edge-bevel"));
        expect(editor.applyCADEdgeBevel).toHaveBeenCalledWith(0.25, 1, "flat");
    });

    it("explains why Mesh CAD edge actions are disabled without an edge selection", () => {
        const {editor, selectedMesh} = installFakeApp();
        setEditingMesh(editor, selectedMesh, {
            selectionMode: "edge",
            tool: "move",
            selectedEdges: [],
        });

        render(<CADActionBarControls forceVisible allowAutoVisible={false} />);

        const resizeButton = screen.getByTestId("mesh-cad-apply-edge-length");
        const bevelButton = screen.getByTestId("mesh-cad-apply-edge-bevel");

        expect(resizeButton).toBeDisabled();
        expect(resizeButton).toHaveAttribute("title", "Select at least one edge first.");
        expect(resizeButton).toHaveAccessibleName(
            "Apply Mesh CAD edge length disabled: Select at least one edge first.",
        );
        expect(bevelButton).toBeDisabled();
        expect(bevelButton).toHaveAttribute("title", "Select at least one edge first.");
        expect(bevelButton).toHaveAccessibleName(
            "Apply Mesh CAD edge bevel disabled: Select at least one edge first.",
        );
    });

    it("explains why Mesh CAD apply is disabled without a face selection", async () => {
        const {editor, selectedMesh} = installFakeApp();
        setEditingMesh(editor, selectedMesh, {
            selectionMode: "face",
            tool: "extrude",
            selectedFaces: [],
        });

        render(<CADActionBarControls forceVisible allowAutoVisible={false} />);

        const applyButton = screen.getByTestId("mesh-cad-apply-operation");
        expect(applyButton).toBeDisabled();
        expect(applyButton).toHaveAttribute("title", "Select at least one face to apply Extrude.");
    });

    it("closes Mesh CAD and exits edit mode", async () => {
        const {editor, selectedMesh} = installFakeApp();
        editor.cadMode = true;
        editor.cadEditedObjectUuid = selectedMesh.uuid;
        editor.cadSelectionMode = "vertex";
        editor.cadTool = "move";
        const onClose = vi.fn();

        render(<CADActionBarControls forceVisible allowAutoVisible={false} onClose={onClose} />);

        fireEvent.click(screen.getByTestId("mesh-cad-close"));

        expect(editor.exitCADMode).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });
});
