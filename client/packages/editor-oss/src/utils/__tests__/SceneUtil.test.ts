import {Object3D, Scene} from "three";
import {describe, expect, it, vi} from "vitest";

import {
    findAllObjects,
    getScene,
    isChildOfScene,
    someObject,
    traverseSceneDepthFirst,
} from "../SceneUtil";

function namedObject(name: string): Object3D {
    const object = new Object3D();
    object.name = name;
    return object;
}

describe("SceneUtil", () => {
    it("checks descendants breadth-first without shifting the queue", () => {
        const root = namedObject("root");
        const childA = namedObject("child-a");
        const childB = namedObject("child-b");
        const grandchild = namedObject("grandchild");
        root.add(childA, childB);
        childA.add(grandchild);

        const shiftSpy = vi.spyOn(Array.prototype, "shift");

        try {
            expect(someObject(root, object => object.name === "grandchild")).toBe(true);
            expect(someObject(root, object => object.name === "missing")).toBe(false);
            expect(shiftSpy).not.toHaveBeenCalled();
        } finally {
            shiftSpy.mockRestore();
        }
    });

    it("finds all matching objects in deep hierarchies without recursive traversal", () => {
        const root = namedObject("root");
        let cursor = root;
        for (let i = 0; i < 12_000; i++) {
            const child = namedObject(`child-${i}`);
            if (i === 100 || i === 11_999) {
                child.userData.pick = true;
            }
            cursor.add(child);
            cursor = child;
        }
        const traverse = vi.spyOn(root, "traverse");

        const matches = findAllObjects(root, object => object.userData.pick === true);

        expect(matches.map(object => object.name)).toEqual(["child-100", "child-11999"]);
        expect(traverse).not.toHaveBeenCalled();
    });

    it("traverses depth-first while preserving sibling order", () => {
        const root = namedObject("root");
        const childA = namedObject("child-a");
        const childB = namedObject("child-b");
        const grandchildA = namedObject("grandchild-a");
        const grandchildB = namedObject("grandchild-b");

        root.add(childA, childB);
        childA.add(grandchildA);
        childB.add(grandchildB);

        const visited: string[] = [];
        traverseSceneDepthFirst(root, object => {
            visited.push(object.name);
            return true;
        });

        expect(visited).toEqual(["root", "child-a", "grandchild-a", "child-b", "grandchild-b"]);
    });

    it("skips descendants when the callback returns false", () => {
        const root = namedObject("root");
        const childA = namedObject("child-a");
        const childB = namedObject("child-b");
        const grandchild = namedObject("grandchild");

        root.add(childA, childB);
        childA.add(grandchild);

        const visited: string[] = [];
        traverseSceneDepthFirst(root, object => {
            visited.push(object.name);
            return object !== childA;
        });

        expect(visited).toEqual(["root", "child-a", "child-b"]);
    });

    it("finds scene ownership and direct scene children", () => {
        const scene = new Scene();
        const child = namedObject("child");
        const grandchild = namedObject("grandchild");
        child.add(grandchild);
        scene.add(child);

        expect(getScene(grandchild)).toBe(scene);
        expect(isChildOfScene(child)).toBe(true);
        expect(isChildOfScene(grandchild)).toBe(false);
    });
});
