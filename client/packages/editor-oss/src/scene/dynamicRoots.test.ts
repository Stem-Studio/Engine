import {Group, Object3D, Scene} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import {
    DYNAMIC_ROOT_NAME,
    getOrCreateDynamicRoot,
    getOrCreateSceneHelpersRoot,
    SCENE_HELPERS_ROOT_NAME,
    syncSceneHelperSubtreeLayers,
} from "./dynamicRoots";

function addDeepChain(root: Object3D, depth = 12_000): Object3D {
    let cursor = root;
    for (let i = 0; i < depth; i++) {
        const child = new Object3D();
        cursor.add(child);
        cursor = child;
    }
    return cursor;
}

describe("dynamicRoots", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("creates stable dynamic and scene helper roots", () => {
        const scene = new Scene();

        const dynamicRoot = getOrCreateDynamicRoot(scene);
        const helperRoot = getOrCreateSceneHelpersRoot(scene);

        expect(dynamicRoot).toBeInstanceOf(Group);
        expect(dynamicRoot.name).toBe(DYNAMIC_ROOT_NAME);
        expect(dynamicRoot.userData.isRuntimeOnly).toBe(true);
        expect(helperRoot).toBeInstanceOf(Group);
        expect(helperRoot.name).toBe(SCENE_HELPERS_ROOT_NAME);
        expect(helperRoot.parent).toBe(dynamicRoot);
        expect(helperRoot.userData.isSceneHelperRoot).toBe(true);
        expect(getOrCreateSceneHelpersRoot(scene)).toBe(helperRoot);
    });

    it("marks deep scene helper subtrees without recursive Object3D traversal", () => {
        const root = new Group();
        const leaf = addDeepChain(root);
        const traverse = vi.spyOn(Object3D.prototype, "traverse").mockImplementation(() => {
            throw new Error("recursive traversal should not be used");
        });

        syncSceneHelperSubtreeLayers(root);

        expect(root.userData.isRuntimeOnly).toBe(true);
        expect(root.userData.isSelectable).toBe(false);
        expect(root.userData.isSceneHelper).toBe(true);
        expect(leaf.userData.isRuntimeOnly).toBe(true);
        expect(leaf.userData.isSelectable).toBe(false);
        expect(leaf.userData.isSceneHelper).toBe(true);
        expect(traverse).not.toHaveBeenCalled();
    });
});
