import {Object3D} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import VisualEffectBehavior from "./VisualEffectBehavior";

function addDeepChain(root: Object3D, depth = 12_000): Object3D {
    let cursor = root;
    for (let i = 0; i < depth; i++) {
        const child = new Object3D();
        cursor.add(child);
        cursor = child;
    }
    return cursor;
}

describe("VisualEffectBehavior", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("discovers particle systems in deep hierarchies without recursive traversal", () => {
        const root = new Object3D();
        addDeepChain(root);
        const traverse = vi.spyOn(root, "traverse");
        const behavior = new VisualEffectBehavior(root, "visualEffect", {
            gameObject: {} as any,
            erth: {} as any,
        });

        expect(() => (behavior as any).processParticleSystems(root)).not.toThrow();
        expect(traverse).not.toHaveBeenCalled();
    });
});
