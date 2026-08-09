import type {Object3D} from "three";

import MeshUtils from "../../utils/MeshUtils";
import {resolvePlanCadSelectionTarget} from "../../utils/PlanCadSelectionMetadata";

export function resolveSelectionTargetFromPickHit(object: Object3D | null | undefined): Object3D | null {
    if (!object) {
        return null;
    }

    if (object.userData?.object) {
        return object.userData.object;
    }

    if (object.parent?.userData?.isSingleChildModel) {
        return object.parent;
    }

    const planCadTarget = resolvePlanCadSelectionTarget(object);
    if (planCadTarget) {
        return planCadTarget;
    }

    return MeshUtils.partToMesh(object);
}
