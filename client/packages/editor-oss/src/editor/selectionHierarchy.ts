import type {Object3D} from "three";
import {containsPlanCadSelectionMetadata, hasPlanCadSelectionMetadata} from "../utils/PlanCadSelectionMetadata";

type CameraLikeObject = Object3D & {isCamera?: boolean};

export const isSceneHierarchyNode = (obj: Object3D): boolean => {
    if (obj.type === "Scene" || (obj as CameraLikeObject).isCamera) {
        return true;
    }

    if (obj.name === "[Dynamic]") {
        return false;
    }

    const hasPlanCadMetadata =
        hasPlanCadSelectionMetadata(obj) ||
        containsPlanCadSelectionMetadata(obj);

    if (obj.userData?.isRuntimeOnly && !hasPlanCadMetadata) {
        return false;
    }

    return Boolean(obj.userData?.isStemObject || obj.userData?.prefabId || hasPlanCadMetadata);
};

export const getPreferredDrillDownChild = (currentSelection: Object3D): Object3D => {
    const nextChild = currentSelection.children.find(child => isSceneHierarchyNode(child));
    return nextChild || currentSelection;
};

export const getPreferredDrillDownPathTarget = (path: Object3D[], currentSelection: Object3D): Object3D => {
    const nextNode = path.slice(1).find(node => isSceneHierarchyNode(node));
    return nextNode || currentSelection;
};
