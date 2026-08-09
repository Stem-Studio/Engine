import {Object3D, Scene, Vector3} from "three";
import {describe, expect, it, vi} from "vitest";

import {PlayerSceneHost} from "./PlayerSceneHost";

function createHost(scene = new Scene()) {
    const batchedRenderer = new Object3D();
    Object.defineProperty(batchedRenderer, "type", {
        configurable: true,
        value: "BatchedRenderer",
    });
    const engine = {
        scene,
        camera: null,
        orthCamera: null,
        renderer: null,
        batchedRenderer,
    };

    return {
        batchedRenderer,
        engine,
        host: new PlayerSceneHost(engine as never),
    };
}

describe("PlayerSceneHost", () => {
    it("updates scene world matrices once and still updates target objects", async () => {
        const scene = new Scene();
        const parent = new Object3D();
        const child = new Object3D();
        const grandchild = new Object3D();
        const target = {updateMatrixWorld: vi.fn()};
        (child as {target?: typeof target}).target = target;
        parent.add(child);
        child.add(grandchild);
        scene.add(parent);
        const parentUpdate = vi.spyOn(parent, "updateMatrixWorld");
        const childUpdate = vi.spyOn(child, "updateMatrixWorld");
        const grandchildUpdate = vi.spyOn(grandchild, "updateMatrixWorld");
        const {batchedRenderer, host} = createHost();

        await host.setScene(scene);

        expect(scene.children).toContain(batchedRenderer);
        expect(scene.getObjectByName("GlobalBehaviorsHost")).toBeTruthy();
        expect(parentUpdate).toHaveBeenCalledTimes(1);
        expect(childUpdate).toHaveBeenCalledTimes(1);
        expect(grandchildUpdate).toHaveBeenCalledTimes(1);
        expect(target.updateMatrixWorld).toHaveBeenCalledTimes(1);
    });

    it("sets deeply nested scenes without Three recursive traversal", async () => {
        const scene = new Scene();
        let cursor: Object3D = scene;
        for (let i = 0; i < 12000; i++) {
            const child = new Object3D();
            child.position.x = 1;
            cursor.add(child);
            cursor = child;
        }
        const target = {updateMatrixWorld: vi.fn()};
        (cursor as {target?: typeof target}).target = target;
        const traverseSpy = vi.spyOn(scene, "traverse");
        const getObjectByPropertySpy = vi.spyOn(scene, "getObjectByProperty");
        const getObjectByNameSpy = vi.spyOn(scene, "getObjectByName");
        const {host} = createHost();

        await expect(host.setScene(scene)).resolves.toBeUndefined();

        expect(traverseSpy).not.toHaveBeenCalled();
        expect(getObjectByPropertySpy).not.toHaveBeenCalled();
        expect(getObjectByNameSpy).not.toHaveBeenCalled();
        expect(target.updateMatrixWorld).toHaveBeenCalledTimes(1);
        expect(new Vector3().setFromMatrixPosition(cursor.matrixWorld).x).toBe(12000);
    });

    it("reverse traverses without losing nodes when callbacks remove objects", () => {
        const scene = new Scene();
        scene.name = "scene";
        const a = new Object3D();
        a.name = "a";
        const a1 = new Object3D();
        a1.name = "a1";
        const a2 = new Object3D();
        a2.name = "a2";
        const b = new Object3D();
        b.name = "b";
        a.add(a1, a2);
        scene.add(a, b);
        const {host} = createHost(scene);
        const visited: string[] = [];

        host.reverseTraverseSceneObjects(object => {
            visited.push(object.name);
            if (object !== scene) {
                object.removeFromParent();
            }
        });

        expect(visited).toEqual(["b", "a2", "a1", "a", "scene"]);
        expect(scene.children).toHaveLength(0);
    });
});
