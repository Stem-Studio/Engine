import {Object3D, Vector3} from "three";
import {describe, expect, it, vi} from "vitest";

import {FrameWorldMatrixCache} from "./FrameWorldMatrixCache";

describe("FrameWorldMatrixCache.updateAutoMatrices", () => {
    it("updates current world transforms outside an explicit frame", () => {
        const parent = new Object3D();
        const child = new Object3D();
        parent.position.x = 5;
        child.position.x = 2;
        parent.add(child);
        const cache = new FrameWorldMatrixCache();

        cache.updateAutoMatrices(child);

        expect(new Vector3().setFromMatrixPosition(child.matrixWorld).x).toBeCloseTo(7);
    });

    it("updates shared ancestors once per active frame", () => {
        const root = new Object3D();
        const sharedParent = new Object3D();
        const first = new Object3D();
        const second = new Object3D();
        root.add(sharedParent);
        sharedParent.add(first, second);
        const parentUpdate = vi.spyOn(sharedParent, "updateMatrix");
        const cache = new FrameWorldMatrixCache();

        cache.beginFrame();
        cache.updateAutoMatrices(first);
        cache.updateAutoMatrices(second);
        cache.endFrame();

        expect(parentUpdate).toHaveBeenCalledTimes(1);
    });

    it("force-refreshes transforms changed after an earlier read in the same frame", () => {
        const parent = new Object3D();
        const child = new Object3D();
        child.position.x = 1;
        parent.add(child);
        const cache = new FrameWorldMatrixCache();

        cache.beginFrame();
        cache.updateAutoMatrices(child);
        parent.position.x = 10;
        cache.updateAutoMatrices(child, true);
        cache.endFrame();

        expect(new Vector3().setFromMatrixPosition(child.matrixWorld).x).toBeCloseTo(11);
    });

    it("propagates parent changes through children with manual local matrices", () => {
        const parent = new Object3D();
        const child = new Object3D();
        child.position.x = 2;
        child.updateMatrix();
        child.matrixAutoUpdate = false;
        parent.add(child);
        const cache = new FrameWorldMatrixCache();

        cache.beginFrame();
        cache.updateAutoMatrices(child);
        cache.endFrame();
        parent.position.x = 20;
        cache.beginFrame();
        cache.updateAutoMatrices(child);
        cache.endFrame();

        expect(new Vector3().setFromMatrixPosition(child.matrixWorld).x).toBeCloseTo(22);
    });
});
