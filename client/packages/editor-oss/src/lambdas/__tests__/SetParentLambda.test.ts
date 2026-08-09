import {Matrix4, Object3D, Scene, Vector3} from "three";
import {describe, expect, it, vi} from "vitest";

import type GameManager from "@stem/editor-oss/behaviors/game/GameManager";
import SetParentLambda from "../packs/setParent/SetParentLambda";

describe("SetParentLambda", () => {
    it("preserves world transform without cloning the parent matrix", () => {
        const scene = new Scene();
        const parent = new Object3D();
        const object = new Object3D();
        const before = new Vector3();
        const after = new Vector3();

        parent.position.set(10, 0, 0);
        object.position.set(1, 2, 3);
        scene.add(parent);
        scene.add(object);
        scene.updateMatrixWorld(true);
        object.getWorldPosition(before);

        const lambda = new SetParentLambda("setParent", {});
        lambda.init({
            scene,
            getObjectByUUID: (uuid: string) => scene.getObjectByProperty("uuid", uuid) ?? null,
        } as GameManager);
        lambda._registerObject(object, {
            parentUUID: parent.uuid,
            keepWorldTransform: true,
        });

        const cloneSpy = vi.spyOn(Matrix4.prototype, "clone");
        try {
            lambda.apply(1 / 60);
            expect(cloneSpy).not.toHaveBeenCalled();
        } finally {
            cloneSpy.mockRestore();
        }

        scene.updateMatrixWorld(true);
        object.getWorldPosition(after);

        expect(parent.children).toContain(object);
        expect(after.distanceTo(before)).toBeLessThan(0.000001);
    });
});
