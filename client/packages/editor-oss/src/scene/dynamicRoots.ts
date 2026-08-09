import {Group, type Object3D, type Scene} from "three";

import {traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";

/** Canonical runtime-only scene root for dynamic, non-serialized objects. */
export const DYNAMIC_ROOT_NAME = "[Dynamic]";
/** Nested helper root under the dynamic root used for editor-only helper objects. */
export const SCENE_HELPERS_ROOT_NAME = "SceneHelpers";

/**
 * Applies runtime-only flags used by editor and serialization filters.
 * @param object Root object to tag as runtime-only.
 * @returns Nothing.
 */
function markRuntimeRoot(object: Object3D): void {
    object.userData.isRuntimeOnly = true;
    object.userData.isSelectable = false;
    object.userData.isStemObject = false;
}

/**
 * Resets a root transform back to identity.
 * @param object Root object to normalize.
 * @returns Nothing.
 */
function resetRootTransform(object: Object3D): void {
    object.position.set(0, 0, 0);
    object.rotation.set(0, 0, 0);
    object.scale.set(1, 1, 1);
    object.updateMatrix();
    object.updateMatrixWorld(true);
}

/**
 * Returns the canonical dynamic root for a scene, creating it when absent.
 * @param scene Scene that owns runtime-only dynamic objects.
 * @returns Dynamic root group.
 */
export function getOrCreateDynamicRoot(scene: Scene): Group {
    let root = scene.children.find(child => child.name === DYNAMIC_ROOT_NAME && child instanceof Group) as
        | Group
        | undefined;

    if (!root) {
        root = new Group();
        root.name = DYNAMIC_ROOT_NAME;
        scene.add(root);
    }

    markRuntimeRoot(root);
    resetRootTransform(root);

    return root;
}

/**
 * Returns the helper subgroup stored under the scene dynamic root, if present.
 * @param scene Scene to inspect.
 * @returns Helper root when found, otherwise `undefined`.
 */
export function findSceneHelpersRoot(scene: Scene): Group | undefined {
    const dynamicRoot = scene.children.find(child => child.name === DYNAMIC_ROOT_NAME && child instanceof Group) as
        | Group
        | undefined;

    if (!dynamicRoot) {
        return undefined;
    }

    return dynamicRoot.children.find(
        child => child.name === SCENE_HELPERS_ROOT_NAME && child instanceof Group,
    ) as Group | undefined;
}

/**
 * Ensures the editor helper subgroup exists under the scene dynamic root.
 * @param scene Scene that owns helper objects.
 * @returns Helper root group.
 */
export function getOrCreateSceneHelpersRoot(scene: Scene): Group {
    const dynamicRoot = getOrCreateDynamicRoot(scene);

    let helperRoot = findSceneHelpersRoot(scene);

    if (!helperRoot) {
        helperRoot = new Group();
        helperRoot.name = SCENE_HELPERS_ROOT_NAME;
        dynamicRoot.add(helperRoot);
    }

    markRuntimeRoot(helperRoot);
    helperRoot.userData.isSceneHelperRoot = true;
    resetRootTransform(helperRoot);
    syncSceneHelperSubtreeLayers(helperRoot);

    return helperRoot;
}

/**
 * Marks a helper subtree as runtime-only, non-selectable, and helper-owned.
 * @param root Root object whose subtree should be tagged.
 * @returns Nothing.
 */
export function syncSceneHelperSubtreeLayers(root: Object3D): void {
    traverseObjectDepthFirst(root, object => {
        object.userData.isRuntimeOnly = true;
        object.userData.isSelectable = false;
        object.userData.isSceneHelper = true;
    });
}
