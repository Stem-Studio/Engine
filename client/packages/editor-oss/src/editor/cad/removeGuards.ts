import * as THREE from "three";

import type {CADAxisConstraint, CADSelectionMode, CADSelectionShape, CADTool} from "./types";

export interface CADModeStateTarget {
    cadMode: boolean;
    cadSelectionMode: CADSelectionMode;
    cadSelectionShape: CADSelectionShape;
    cadAxisConstraint: CADAxisConstraint[];
    cadTool: CADTool;
    cadEditedObjectUuid: string | null;
}

export interface CADTransformControlsHost {
    transformControls?: unknown | null;
}

export function removedObjectContainsCADEditedObject(
    object: THREE.Object3D,
    cadEditedObjectUuid: string | null,
): boolean {
    if (!cadEditedObjectUuid) {
        return false;
    }

    return object.uuid === cadEditedObjectUuid || Boolean(object.getObjectByProperty("uuid", cadEditedObjectUuid));
}

export function resetCADModeState(target: CADModeStateTarget) {
    target.cadMode = false;
    target.cadSelectionMode = "object";
    target.cadSelectionShape = "box";
    target.cadAxisConstraint = ["x", "y", "z"];
    target.cadTool = "select";
    target.cadEditedObjectUuid = null;
}

export function restoreCADTransformControls(host: CADTransformControlsHost | null | undefined) {
    const transformControls = host?.transformControls as {visible?: boolean} | null | undefined;
    if (!transformControls) return;
    transformControls.visible = true;
}
