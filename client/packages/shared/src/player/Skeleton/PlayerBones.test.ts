import {Bone, Object3D} from "three";
import {describe, expect, it, vi} from "vitest";

import {PlayerBones} from "./PlayerBones";

describe("PlayerBones", () => {
    it("discovers deeply nested bones without Three recursive traversal", () => {
        const root = new Object3D();
        let cursor: Object3D = root;
        for (let i = 0; i < 12000; i++) {
            const child = new Object3D();
            cursor.add(child);
            cursor = child;
        }
        const hips = new Bone();
        hips.name = "mixamorigHips";
        cursor.add(hips);
        const traverseSpy = vi.spyOn(root, "traverse");

        const result = new PlayerBones(root).getPlayerBones();

        expect(result.bones).toEqual(["Hips"]);
        expect(result.hipsBone).toBe(hips);
        expect(traverseSpy).not.toHaveBeenCalled();
    });
});
