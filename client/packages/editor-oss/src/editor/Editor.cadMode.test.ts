import {describe, expect, it} from "vitest";
import * as THREE from "three";

import {
    removedObjectContainsCADEditedObject,
    resetCADModeState,
    restoreCADTransformControls,
} from "./cad/removeGuards";

describe("Editor Mesh CAD mode", () => {
    it("detects removal of the edited mesh", () => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());

        expect(removedObjectContainsCADEditedObject(mesh, mesh.uuid)).toBe(true);
    });

    it("detects removal of a parent that contains the edited mesh", () => {
        const group = new THREE.Group();
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        group.add(mesh);

        expect(removedObjectContainsCADEditedObject(group, mesh.uuid)).toBe(true);
    });

    it("ignores unrelated removals and missing CAD targets", () => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        const unrelated = new THREE.Group();

        expect(removedObjectContainsCADEditedObject(unrelated, mesh.uuid)).toBe(false);
        expect(removedObjectContainsCADEditedObject(mesh, null)).toBe(false);
    });

    it("resets CAD mode state and restores gizmo visibility on exit", () => {
        const transformControls = {visible: false};
        const mutableEditorState = {
            cadMode: true,
            cadEditedObjectUuid: "mesh-1",
            cadSelectionMode: "face" as const,
            cadSelectionShape: "lasso" as const,
            cadAxisConstraint: ["x" as const],
            cadTool: "extrude" as const,
        };

        resetCADModeState(mutableEditorState);
        restoreCADTransformControls({transformControls});

        expect(mutableEditorState.cadMode).toBe(false);
        expect(mutableEditorState.cadEditedObjectUuid).toBeNull();
        expect(mutableEditorState.cadSelectionMode).toBe("object");
        expect(mutableEditorState.cadSelectionShape).toBe("box");
        expect(mutableEditorState.cadAxisConstraint).toEqual(["x", "y", "z"]);
        expect(mutableEditorState.cadTool).toBe("select");
        expect(transformControls.visible).toBe(true);
    });
});
