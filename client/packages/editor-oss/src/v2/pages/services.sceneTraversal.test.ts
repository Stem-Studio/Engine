import {Object3D, Scene} from "three";
import {describe, expect, it, vi} from "vitest";

import {getObjectNamesInScene, getSceneUniqueModels} from "./services";

describe("scene model services", () => {
    it("collects unique model metadata in one iterative pass while preserving result order", () => {
        const scene = new Scene();
        const first = new Object3D();
        first.userData = {ID: "model-a", Name: "first", ignored: "value"};
        const duplicate = new Object3D();
        duplicate.userData = {ID: "model-a", Name: "duplicate"};
        const second = new Object3D();
        second.userData = {ID: "model-b", Name: "second"};
        first.add(duplicate);
        scene.add(first, second);
        const traverseSpy = vi.spyOn(scene, "traverse");

        const models = getSceneUniqueModels(scene);

        expect(models.map(model => model.ID)).toEqual(["model-b", "model-a"]);
        expect(models[1]?.Name).toBe("first");
        expect(models[1]).not.toHaveProperty("ignored");
        expect(traverseSpy).not.toHaveBeenCalled();
    });

    it("collects names from deep hierarchies without Three's recursive traversal", () => {
        const scene = new Scene();
        let parent: Object3D = scene;
        for (let i = 0; i < 12_000; i++) {
            const child = new Object3D();
            child.name = `node-${i}`;
            parent.add(child);
            parent = child;
        }
        const traverseSpy = vi.spyOn(scene, "traverse");

        const names = getObjectNamesInScene(scene);

        expect(names.size).toBe(12_000);
        expect(names.has("node-11999")).toBe(true);
        expect(traverseSpy).not.toHaveBeenCalled();
    });
});
