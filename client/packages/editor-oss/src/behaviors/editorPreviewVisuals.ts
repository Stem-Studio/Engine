import type {Object3D} from "three";

import type {Behavior} from "./Behavior";
import {traverseObjectDepthFirst} from "../utils/SceneTraverser";

export const EDITOR_PREVIEW_ROOT_KEY = "__stemEditorPreviewRoot";
export const EDITOR_PREVIEW_BEHAVIOR_UUID_KEY = "__stemEditorPreviewBehaviorUuid";
export const EDITOR_PREVIEW_BEHAVIOR_ID_KEY = "__stemEditorPreviewBehaviorId";
export const EDITOR_PREVIEW_ADOPTED_KEY = "__stemEditorPreviewAdoptedByRuntime";

const isRuntimeOnlyObject = (object: Object3D): boolean => object.userData?.isRuntimeOnly === true;

export function markEditorPreviewRoot(root: Object3D, behavior: Pick<Behavior, "uuid" | "id">): void {
    if (!isRuntimeOnlyObject(root)) {
        return;
    }

    root.userData[EDITOR_PREVIEW_ROOT_KEY] = true;
    root.userData[EDITOR_PREVIEW_BEHAVIOR_UUID_KEY] = behavior.uuid;
    root.userData[EDITOR_PREVIEW_BEHAVIOR_ID_KEY] = behavior.id;
}

export function markNewEditorPreviewRoots(
    target: Object3D,
    behavior: Pick<Behavior, "uuid" | "id">,
    previousChildren: ReadonlySet<Object3D>,
): void {
    for (let i = 0; i < target.children.length; i++) {
        const child = target.children[i];
        if (child && !previousChildren.has(child)) {
            markEditorPreviewRoot(child, behavior);
        }
    }
}

export function findEditorPreviewRootForBehavior(
    parent: Object3D,
    behavior: Pick<Behavior, "uuid" | "id">,
): Object3D | null {
    for (let i = 0; i < parent.children.length; i++) {
        const child = parent.children[i];
        if (
            child?.userData?.[EDITOR_PREVIEW_ROOT_KEY] === true &&
            child.userData?.[EDITOR_PREVIEW_BEHAVIOR_UUID_KEY] === behavior.uuid
        ) {
            return child;
        }
    }

    return null;
}

export function collectParticleEmitterObjects(root: Object3D): Object3D[] {
    const emitters: Object3D[] = [];
    traverseObjectDepthFirst(root, child => {
        if ((child as Object3D & {system?: unknown}).system) {
            emitters.push(child);
        }
    });
    return emitters;
}
