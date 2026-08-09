import * as THREE from "three";
import {describe, expect, it, vi} from "vitest";

import {collectObjectSizeMap, deleteObjectSizesFromMap, writeObjectSizesToMap} from "./sceneSizeTracker";

function createDeepObjectTree(depth = 12_000): {root: THREE.Object3D; leaf: THREE.Object3D} {
    const root = new THREE.Object3D();
    let cursor = root;

    for (let i = 0; i < depth; i++) {
        const child = new THREE.Object3D();
        cursor.add(child);
        cursor = child;
    }

    return {root, leaf: cursor};
}

describe("sceneSizeTracker", () => {
    it("collects deep scene size maps without recursive traversal", () => {
        const {root, leaf} = createDeepObjectTree();
        const traverseSpy = vi.spyOn(root, "traverse");
        const calculateObjectSize = vi.fn((object: THREE.Object3D) => object.children.length + 1);

        const sizeMap = collectObjectSizeMap(root, calculateObjectSize, {includeRoot: false});

        expect(traverseSpy).not.toHaveBeenCalled();
        expect(sizeMap.has(root.uuid)).toBe(false);
        expect(sizeMap.get(leaf.uuid)).toBe(1);
        expect(sizeMap.size).toBe(12_000);
        expect(calculateObjectSize).toHaveBeenCalledTimes(12_000);
    });

    it("updates and deletes object subtree sizes without recursive traversal", () => {
        const {root, leaf} = createDeepObjectTree();
        const sizeMap = new Map<string, number>([["existing", 42]]);
        const traverseSpy = vi.spyOn(root, "traverse");
        const calculateObjectSize = vi.fn(() => 7);

        writeObjectSizesToMap(sizeMap, root, calculateObjectSize);

        expect(traverseSpy).not.toHaveBeenCalled();
        expect(sizeMap.get(root.uuid)).toBe(7);
        expect(sizeMap.get(leaf.uuid)).toBe(7);
        expect(sizeMap.get("existing")).toBe(42);

        deleteObjectSizesFromMap(sizeMap, root);

        expect(traverseSpy).not.toHaveBeenCalled();
        expect(sizeMap.has(root.uuid)).toBe(false);
        expect(sizeMap.has(leaf.uuid)).toBe(false);
        expect(sizeMap.get("existing")).toBe(42);
    });
});
