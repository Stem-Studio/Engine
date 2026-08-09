import type { Object3D } from "three";

import { DYNAMIC_ROOT_NAME } from "@stem/editor-oss/scene/dynamicRoots";
import {
    containsPlanCadSelectionMetadata,
    hasPlanCadSelectionMetadata,
} from "@stem/editor-oss/utils/PlanCadSelectionMetadata";

export function shouldIncludeProjectTreeObject(object: Object3D) {
    if (object.name === DYNAMIC_ROOT_NAME) return false;
    if (object.userData?.isPlanCadGeneratedChild === true) return false;
    const hasPlanCadMetadata =
        hasPlanCadSelectionMetadata(object) ||
        containsPlanCadSelectionMetadata(object);
    if (object.userData?.isRuntimeOnly && !hasPlanCadMetadata) {
        return false;
    }
    return true;
}
