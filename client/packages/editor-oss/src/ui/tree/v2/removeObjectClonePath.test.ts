import {Object3D} from "three";
import {describe, expect, it} from "vitest";

import {getChildIndexPath, getObjectByChildIndexPath} from "./removeObjectClonePath";

describe("removeObjectClonePath", () => {
    it("finds the matching clone child by hierarchy index without userData markers", () => {
        const root = new Object3D();
        const firstBranch = new Object3D();
        const secondBranch = new Object3D();
        const duplicateA = new Object3D();
        const duplicateB = new Object3D();
        duplicateA.name = "duplicate";
        duplicateB.name = "duplicate";
        duplicateA.userData.assetId = "same";
        duplicateB.userData.assetId = "same";
        firstBranch.add(duplicateA);
        secondBranch.add(duplicateB);
        root.add(firstBranch, secondBranch);

        const path = getChildIndexPath(root, duplicateB);
        const cloneRoot = root.clone(true);
        const cloneTarget = path ? getObjectByChildIndexPath(cloneRoot, path) : null;

        expect(path).toEqual([1, 0]);
        expect(cloneTarget).toBe(cloneRoot.children[1]!.children[0]);
        expect(cloneTarget?.name).toBe("duplicate");
        expect(JSON.stringify(root.userData)).not.toContain("__removalMarker");
        expect(JSON.stringify(duplicateB.userData)).not.toContain("__removalMarker");
    });

    it("returns null when the target is not below the root", () => {
        const root = new Object3D();
        const unrelated = new Object3D();

        expect(getChildIndexPath(root, unrelated)).toBeNull();
    });

    it("returns null when a clone no longer has the indexed child", () => {
        const root = new Object3D();
        const branch = new Object3D();
        const child = new Object3D();
        branch.add(child);
        root.add(branch);
        const path = getChildIndexPath(root, child);
        const cloneRoot = root.clone(true);
        cloneRoot.children[0]!.clear();

        expect(path).toEqual([0, 0]);
        expect(path ? getObjectByChildIndexPath(cloneRoot, path) : null).toBeNull();
    });
});
