import {Object3D, Scene} from "three";
import {describe, expect, it, vi} from "vitest";

import {BehaviorContextProvider} from "./BehaviorContextProvider";

describe("BehaviorContextProvider", () => {
    it("lists direct scene objects without traversing deep descendants", async () => {
        const scene = new Scene();
        const direct = new Object3D();
        direct.name = "Direct";
        scene.add(direct);

        let cursor = direct;
        for (let i = 0; i < 12_000; i++) {
            const child = new Object3D();
            child.name = `Nested ${i}`;
            cursor.add(child);
            cursor = child;
        }

        const traverseSpy = vi.spyOn(scene, "traverse");

        const context = await new BehaviorContextProvider().getBehaviorContext(null, scene, null, null);

        expect(traverseSpy).not.toHaveBeenCalled();
        expect(context.scene.objects).toEqual(["Direct"]);
    });
});
