import type {Object3D} from "three";

function hasPlanCadNameFallback(object: Object3D | null | undefined): boolean {
    const name = object?.name?.trim();
    return !!name && (name === "BIM" || name.startsWith("BIM "));
}

export function hasOwnPlanCadSelectionMetadata(object: Object3D | null | undefined): boolean {
    if (object?.type === "Scene") return false;

    const userData = object?.userData;
    if (!userData) return false;
    const planCadMetadata = userData.planCad;

    return (
        userData.isPlanCadManaged === true ||
        userData.isPlanCadRoot === true ||
        userData.isPlanCadExternalModel === true ||
        userData.isPlanCadExternalModelChild === true ||
        userData.isPlanCadGeneratedChild === true ||
        typeof userData.planNodeId === "string" ||
        typeof userData.planNodeType === "string" ||
        typeof userData.planCadOwnerNodeId === "string" ||
        typeof userData.planCadOwnerNodeType === "string" ||
        userData.managedBy === "BIM Plan" ||
        userData.sceneTreeBadge === "BIM" ||
        hasPlanCadNameFallback(object) ||
        planCadMetadata !== undefined
    );
}

export function hasPlanCadSelectionMetadata(object: Object3D | null | undefined): boolean {
    let current = object;

    while (current) {
        if (hasOwnPlanCadSelectionMetadata(current)) return true;
        current = current.parent;
    }

    return false;
}

export function containsPlanCadSelectionMetadata(object: Object3D | null | undefined): boolean {
    if (!object || object.type === "Scene") return false;

    const stack = [object];
    while (stack.length > 0) {
        const current = stack.pop();
        if (!current) continue;
        if (hasOwnPlanCadSelectionMetadata(current)) return true;
        for (let i = 0; i < current.children.length; i++) {
            stack.push(current.children[i]!);
        }
    }

    return false;
}

export function resolvePlanCadSelectionTarget(
    object: Object3D | null | undefined,
    scene?: Object3D | null,
): Object3D | null {
    let current = object;
    let fallback: Object3D | null = null;

    while (current) {
        if (scene && current === scene) break;

        const userData = current.userData;
        const isSelectionRoot =
            userData?.isPlanCadRoot === true ||
            typeof userData?.planNodeId === "string";

        if (isSelectionRoot) {
            return current;
        }

        if (
            !fallback &&
            hasOwnPlanCadSelectionMetadata(current) &&
            userData?.isPlanCadExternalModel !== true &&
            userData?.isPlanCadExternalModelChild !== true
        ) {
            fallback = current;
        }

        current = current.parent;
    }

    return fallback;
}
