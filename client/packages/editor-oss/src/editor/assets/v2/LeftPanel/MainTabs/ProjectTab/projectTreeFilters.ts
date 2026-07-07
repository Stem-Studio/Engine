import { DYNAMIC_ROOT_NAME } from "@stem/editor-oss/scene/dynamicRoots";

type ProjectTreeObjectLike = {
    name?: string;
    userData?: {
        isRuntimeOnly?: unknown;
        isPlanCadManaged?: unknown;
    };
};

export function shouldIncludeProjectTreeObject(object: ProjectTreeObjectLike) {
    if (object.name === DYNAMIC_ROOT_NAME) return false;
    if (object.userData?.isRuntimeOnly && object.userData?.isPlanCadManaged !== true) {
        return false;
    }
    return true;
}
