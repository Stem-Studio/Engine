import { Object3D } from "three";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { applyToObject3d, extractFromObject3d } from "./object3d";

function addDeepChain(root: Object3D, depth = 12_000): Object3D {
    let cursor = root;
    for (let i = 0; i < depth; i++) {
        const child = new Object3D();
        cursor.add(child);
        cursor = child;
    }
    return cursor;
}

describe("applyToObject3d", () => {
    let obj: Object3D;

    beforeEach(() => {
        obj = new Object3D();
    });

    it("should apply uuid, name, and parentUuid", () => {
        const json = {
            uuid: "123",
            name: "Test",
            parent: "parent-uuid",
        };

        applyToObject3d(obj, json);

        expect(obj.uuid).toBe("123");
        expect(obj.name).toBe("Test");
        expect((obj as any).parentUuid).toBe("parent-uuid");
    });

    it("should apply position, quaternion, and scale", () => {
        const json = {
            position: { x: 1, y: 2, z: 3 },
            quaternion: { x: 0, y: 0.5, z: 0, w: 1 },
            scale: { x: 2, y: 3, z: 4 },
        };

        applyToObject3d(obj, json as any);

        expect(obj.position.toArray()).toEqual([1, 2, 3]);
        expect(obj.quaternion.x).toBe(0);
        expect(obj.quaternion.y).toBe(0.5);
        expect(obj.scale.toArray()).toEqual([2, 3, 4]);
    });

    it("should apply visibility", () => {
        const json = { visible: false };

        applyToObject3d(obj, json as any);

        expect(obj.visible).toBe(false);
    });

    it("should propagate castShadow to mesh descendants", () => {
        const meshChild = new Object3D();
        (meshChild as any).isMesh = true;
        obj.add(meshChild);

        const json = { castShadow: true };

        applyToObject3d(obj, json as any);

        expect(obj.castShadow).toBe(true);
        expect(meshChild.castShadow).toBe(true);
    });

    it("should propagate receiveShadow to mesh descendants", () => {
        const meshChild = new Object3D();
        (meshChild as any).isMesh = true;
        obj.add(meshChild);

        const json = { receiveShadow: true };

        applyToObject3d(obj, json as any);

        expect(obj.receiveShadow).toBe(true);
        expect(meshChild.receiveShadow).toBe(true);
    });

    it("should apply shadow flags in deep hierarchies without Three recursive traversal", () => {
        const leaf = addDeepChain(obj);
        const meshChild = new Object3D();
        (meshChild as any).isMesh = true;
        leaf.add(meshChild);
        const traverse = vi.spyOn(obj, "traverse");

        applyToObject3d(obj, {castShadow: true, receiveShadow: true} as any);

        expect(traverse).not.toHaveBeenCalled();
        expect(obj.castShadow).toBe(true);
        expect(obj.receiveShadow).toBe(true);
        expect(meshChild.castShadow).toBe(true);
        expect(meshChild.receiveShadow).toBe(true);
    });

    it("should apply userData", () => {
        const json = { userData: { foo: 42 } };

        applyToObject3d(obj, json as any);

        expect(obj.userData).toEqual({ foo: 42 });
    });
});

describe("extractFromObject3d", () => {
    it("should extract all fields correctly", () => {
        const parent = new Object3D();
        parent.uuid = "parent-uuid";

        const obj = new Object3D();
        obj.uuid = "child-uuid";
        obj.name = "Child";
        obj.visible = false;
        obj.castShadow = true;
        obj.receiveShadow = false;
        obj.userData = { foo: "bar" };
        obj.position.set(1, 2, 3);
        obj.quaternion.set(0, 0.3, 0, 1);
        obj.scale.set(2, 2, 2);

        parent.add(obj);

        const result = extractFromObject3d(obj);

        expect(result.uuid).toBe("child-uuid");
        expect(result.name).toBe("Child");
        expect(result.parent).toBe("parent-uuid");
        expect(result.position).toEqual({ x: 1, y: 2, z: 3 });
        expect(result.quaternion).toEqual({ x: 0, y: 0.3, z: 0, w: 1 });
        expect(result.scale).toEqual({ x: 2, y: 2, z: 2 });
        expect(result.visible).toBe(false);
        expect(result.castShadow).toBe(true);
        expect(result.receiveShadow).toBe(false);
        expect(result.userData).toEqual({ foo: "bar" });
    });

    it("should round-trip apply → extract → apply", () => {
        const original = new Object3D();
        const json = {
            uuid: "abc",
            name: "Obj",
            parent: "p",
            position: { x: 5, y: 6, z: 7 },
            quaternion: { x: 1, y: 0, z: 0, w: 1 },
            scale: { x: 3, y: 3, z: 3 },
            visible: true,
            castShadow: true,
            receiveShadow: false,
            userData: { a: 1 },
        };

        applyToObject3d(original, json);

        const extracted = extractFromObject3d(original);
        const clone = new Object3D();
        clone.traverse = (cb: any) => cb(clone);

        applyToObject3d(clone, extracted);

        expect(extractFromObject3d(clone)).toEqual(extracted);
    });
});
