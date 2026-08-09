import {describe, expect, it, vi} from "vitest";
import {Object3D, Vector3} from "three";

import SceneTraverser, {
    findObjectByNameDepthFirst,
    findObjectByUuidDepthFirst,
    findObjectByUuidOrNameDepthFirst,
    findObjectDepthFirst,
    traverseObjectDepthFirst,
    traverseObjectDepthFirstWithConsumers,
    traverseObjectReversePostOrder,
    traverseObjectVisibleDepthFirst,
    updateObjectMatrixWorldDepthFirst,
    type TraversalHandler,
} from "./SceneTraverser";

function getWorldPosition(object: Object3D): Vector3 {
    return new Vector3().setFromMatrixPosition(object.matrixWorld);
}

function namedObject(name: string): Object3D {
    const object = new Object3D();
    object.name = name;
    return object;
}

describe("SceneTraverser", () => {
    it("keeps consumer descendant pruning independent during a shared walk", () => {
        const root = namedObject("root");
        const plotRoot = namedObject("plot-root");
        const nestedPlot = namedObject("nested-plot");
        const textureChild = namedObject("texture-child");
        plotRoot.add(nestedPlot);
        root.add(plotRoot, textureChild);

        const plotVisited: string[] = [];
        const textureVisited: string[] = [];
        traverseObjectDepthFirstWithConsumers(root, [
            node => {
                plotVisited.push(node.name);
                return node !== plotRoot;
            },
            node => {
                textureVisited.push(node.name);
                return true;
            },
        ]);

        expect(plotVisited).toEqual(["root", "plot-root", "texture-child"]);
        expect(textureVisited).toEqual(["root", "plot-root", "nested-plot", "texture-child"]);
    });

    it("walks deeply nested shared consumer trees without recursive traversal", () => {
        const root = namedObject("root");
        let cursor = root;
        for (let i = 0; i < 12000; i++) {
            const child = namedObject(`child-${i}`);
            cursor.add(child);
            cursor = child;
        }
        const traverse = vi.spyOn(root, "traverse");
        let visited = 0;

        expect(() => traverseObjectDepthFirstWithConsumers(root, [() => {
            visited++;
            return true;
        }])).not.toThrow();

        expect(visited).toBe(12001);
        expect(traverse).not.toHaveBeenCalled();
    });

    it("traverses object hierarchies depth-first without recursive stack growth", () => {
        const root = namedObject("root");
        const childA = namedObject("child-a");
        const childB = namedObject("child-b");
        const grandChild = namedObject("grand-child");
        childA.add(grandChild);
        root.add(childA, childB);

        const visited: string[] = [];
        traverseObjectDepthFirst(root, object => visited.push(object.name));

        expect(visited).toEqual(["root", "child-a", "grand-child", "child-b"]);
    });

    it("can exclude the root during depth-first traversal", () => {
        const root = namedObject("root");
        const childA = namedObject("child-a");
        const childB = namedObject("child-b");
        root.add(childA, childB);

        const visited: string[] = [];
        traverseObjectDepthFirst(root, object => visited.push(object.name), {includeRoot: false});

        expect(visited).toEqual(["child-a", "child-b"]);
    });

    it("finds the first matching object depth-first without scanning later siblings", () => {
        const root = namedObject("root");
        const childA = namedObject("child-a");
        const childB = namedObject("child-b");
        const grandChild = namedObject("grand-child");
        childA.add(grandChild);
        root.add(childA, childB);
        const visited: string[] = [];

        const found = findObjectDepthFirst(root, object => {
            visited.push(object.name);
            return object === grandChild;
        });

        expect(found).toBe(grandChild);
        expect(visited).toEqual(["root", "child-a", "grand-child"]);
    });

    it("finds deeply nested objects without recursive stack growth", () => {
        const root = namedObject("root");
        let cursor = root;
        for (let i = 0; i < 12000; i++) {
            const child = namedObject(`find-child-${i}`);
            cursor.add(child);
            cursor = child;
        }

        expect(() => findObjectDepthFirst(root, object => object === cursor)).not.toThrow();
        expect(findObjectDepthFirst(root, object => object === cursor)).toBe(cursor);
    });

    it("finds deeply nested objects by UUID without Three recursive lookup", () => {
        const root = namedObject("root");
        let cursor = root;
        for (let i = 0; i < 12000; i++) {
            const child = namedObject(`uuid-child-${i}`);
            cursor.add(child);
            cursor = child;
        }
        const getObjectByProperty = vi.spyOn(root, "getObjectByProperty").mockImplementation(() => {
            throw new Error("recursive property lookup should not be used");
        });
        const traverse = vi.spyOn(root, "traverse").mockImplementation(() => {
            throw new Error("recursive traversal should not be used");
        });

        expect(findObjectByUuidDepthFirst(root, cursor.uuid)).toBe(cursor);
        expect(getObjectByProperty).not.toHaveBeenCalled();
        expect(traverse).not.toHaveBeenCalled();
    });

    it("finds deeply nested objects by name without Three recursive lookup", () => {
        const root = namedObject("root");
        let cursor = root;
        for (let i = 0; i < 12000; i++) {
            const child = namedObject(`name-child-${i}`);
            cursor.add(child);
            cursor = child;
        }
        cursor.name = "target-by-name";
        const getObjectByName = vi.spyOn(root, "getObjectByName").mockImplementation(() => {
            throw new Error("recursive name lookup should not be used");
        });
        const traverse = vi.spyOn(root, "traverse").mockImplementation(() => {
            throw new Error("recursive traversal should not be used");
        });

        expect(findObjectByNameDepthFirst(root, "target-by-name")).toBe(cursor);
        expect(getObjectByName).not.toHaveBeenCalled();
        expect(traverse).not.toHaveBeenCalled();
    });

    it("resolves identifiers by UUID first and then by name", () => {
        const root = namedObject("root");
        const named = namedObject("shared-identifier");
        const uuidMatch = namedObject("uuid-match");
        root.add(named, uuidMatch);

        expect(findObjectByUuidOrNameDepthFirst(root, uuidMatch.uuid)).toBe(uuidMatch);
        expect(findObjectByUuidOrNameDepthFirst(root, "shared-identifier")).toBe(named);
        expect(findObjectByUuidOrNameDepthFirst(root, "missing")).toBeNull();
    });

    it("preserves UUID precedence over an earlier depth-first name match in one traversal", () => {
        const root = namedObject("root");
        const earlyNameMatch = namedObject("shared-identifier");
        const uuidMatch = namedObject("uuid-match");
        Object.defineProperty(uuidMatch, "uuid", {
            configurable: true,
            value: "shared-identifier",
        });
        root.add(earlyNameMatch, uuidMatch);

        expect(findObjectByUuidOrNameDepthFirst(root, "shared-identifier")).toBe(uuidMatch);
    });

    it("scans a name-only hierarchy once", () => {
        const root = namedObject("root");
        const target = namedObject("target-by-name");
        root.add(target);
        const children = root.children;
        const childrenRead = vi.fn(() => children);
        Object.defineProperty(root, "children", {
            configurable: true,
            get: childrenRead,
        });

        expect(findObjectByUuidOrNameDepthFirst(root, "target-by-name")).toBe(target);
        expect(childrenRead).toHaveBeenCalledTimes(1);
    });

    it("traverses visible object hierarchies and prunes hidden subtrees", () => {
        const root = namedObject("root");
        const visibleChild = namedObject("visible-child");
        const hiddenChild = namedObject("hidden-child");
        const hiddenGrandChild = namedObject("hidden-grand-child");
        const laterVisibleChild = namedObject("later-visible-child");
        hiddenChild.visible = false;
        hiddenChild.add(hiddenGrandChild);
        root.add(visibleChild, hiddenChild, laterVisibleChild);

        const visited: string[] = [];
        traverseObjectVisibleDepthFirst(root, object => visited.push(object.name));

        expect(visited).toEqual(["root", "visible-child", "later-visible-child"]);
    });

    it("traverses reverse sibling postorder without recursive stack growth", () => {
        const root = namedObject("root");
        const childA = namedObject("child-a");
        const childB = namedObject("child-b");
        const grandChildA = namedObject("grand-child-a");
        const grandChildB = namedObject("grand-child-b");
        childA.add(grandChildA, grandChildB);
        root.add(childA, childB);

        const visited: string[] = [];
        traverseObjectReversePostOrder(root, object => visited.push(object.name));

        expect(visited).toEqual(["child-b", "grand-child-b", "grand-child-a", "child-a", "root"]);
    });

    it("can exclude the root during reverse sibling postorder traversal", () => {
        const root = namedObject("root");
        const childA = namedObject("child-a");
        const childB = namedObject("child-b");
        root.add(childA, childB);

        const visited: string[] = [];
        traverseObjectReversePostOrder(root, object => visited.push(object.name), {includeRoot: false});

        expect(visited).toEqual(["child-b", "child-a"]);
    });

    it("walks deeply nested hierarchies with standalone helpers", () => {
        const root = namedObject("root");
        let cursor = root;
        for (let i = 0; i < 12000; i++) {
            const child = namedObject(`child-${i}`);
            cursor.add(child);
            cursor = child;
        }

        let lastDepthFirst = "";
        let lastReverse = "";

        expect(() => traverseObjectDepthFirst(root, object => {
            lastDepthFirst = object.name;
        })).not.toThrow();
        expect(() => traverseObjectReversePostOrder(root, object => {
            lastReverse = object.name;
        })).not.toThrow();
        expect(lastDepthFirst).toBe("child-11999");
        expect(lastReverse).toBe("root");
    });

    it("walks deeply nested visible hierarchies with standalone helper", () => {
        const root = namedObject("root");
        let cursor = root;
        for (let i = 0; i < 12000; i++) {
            const child = namedObject(`visible-child-${i}`);
            cursor.add(child);
            cursor = child;
        }

        let lastVisible = "";

        expect(() => traverseObjectVisibleDepthFirst(root, object => {
            lastVisible = object.name;
        })).not.toThrow();
        expect(lastVisible).toBe("visible-child-11999");
    });

    it("updates deeply nested matrices with standalone helper", () => {
        const root = new Object3D();
        let cursor = root;
        for (let i = 0; i < 12000; i++) {
            const child = new Object3D();
            child.position.x = 1;
            cursor.add(child);
            cursor = child;
        }

        expect(() => updateObjectMatrixWorldDepthFirst(root, true)).not.toThrow();
        expect(getWorldPosition(cursor).x).toBe(12000);
    });

    it("updates invisible descendants with standalone matrix helper", () => {
        const root = new Object3D();
        const hiddenParent = new Object3D();
        const child = new Object3D();
        hiddenParent.visible = false;
        hiddenParent.position.set(2, 0, 0);
        child.position.set(3, 0, 0);
        hiddenParent.add(child);
        root.add(hiddenParent);

        updateObjectMatrixWorldDepthFirst(root, true);

        expect(getWorldPosition(child).distanceTo(new Vector3(5, 0, 0))).toBeLessThan(1e-15);
    });

    it("keeps boolean update calls compatible and collects handler results", () => {
        const root = new Object3D();
        const child = new Object3D();
        root.add(child);
        const handler: TraversalHandler = {
            test: vi.fn(node => node === child),
            results: [],
        };
        const traverser = new SceneTraverser(root);
        traverser.addHandler(handler);

        traverser.update(true);

        expect(handler.test).toHaveBeenCalledWith(root);
        expect(handler.test).toHaveBeenCalledWith(child);
        expect(handler.results).toEqual([child]);
    });

    it("preserves depth-first traversal order with iterative traversal", () => {
        const root = new Object3D();
        root.name = "root";
        const childA = new Object3D();
        childA.name = "child-a";
        const grandChild = new Object3D();
        grandChild.name = "grand-child";
        const childB = new Object3D();
        childB.name = "child-b";
        childA.add(grandChild);
        root.add(childA, childB);

        const visited: string[] = [];
        const traverser = new SceneTraverser(root);
        traverser.addHandler({
            test: (node: Object3D) => {
                visited.push(node.name);
                return false;
            },
            results: [],
        });

        traverser.update();

        expect(visited).toEqual(["root", "child-a", "grand-child", "child-b"]);
    });

    it("updates deeply nested hierarchies without recursive stack growth", () => {
        const root = new Object3D();
        let cursor = root;
        for (let i = 0; i < 12000; i++) {
            const child = new Object3D();
            child.position.x = 1;
            cursor.add(child);
            cursor = child;
        }

        const traverser = new SceneTraverser(root);

        expect(() => traverser.update()).not.toThrow();
        expect(getWorldPosition(cursor).x).toBe(12000);
    });

    it("updates matrices without running handlers when collection is disabled", () => {
        const root = new Object3D();
        const parent = new Object3D();
        const child = new Object3D();
        child.position.set(1, 0, 0);
        parent.add(child);
        root.add(parent);
        root.updateMatrixWorld(true);

        const handler: TraversalHandler = {
            test: vi.fn(() => true),
            results: [child],
        };
        const traverser = new SceneTraverser(root);
        traverser.addHandler(handler);

        parent.position.set(5, 0, 0);
        traverser.update({collectHandlers: false});

        expect(handler.test).not.toHaveBeenCalled();
        expect(handler.results).toEqual([]);
        expect(getWorldPosition(child).distanceTo(new Vector3(6, 0, 0))).toBeLessThan(1e-15);
    });

    it("changes handler revisions only when ordered result identities change", () => {
        const root = new Object3D();
        const first = new Object3D();
        const second = new Object3D();
        first.userData.collect = true;
        second.userData.collect = true;
        root.add(first, second);
        const handler: TraversalHandler = {
            test: node => node.userData.collect === true,
            results: [],
        };
        const traverser = new SceneTraverser(root);
        traverser.addHandler(handler);

        traverser.update();
        const initialRevision = handler.revision;
        traverser.update();

        expect(handler.results).toEqual([first, second]);
        expect(handler.revision).toBe(initialRevision);

        first.userData.collect = false;
        traverser.update();

        expect(handler.results).toEqual([second]);
        expect(handler.revision).toBe((initialRevision ?? 0) + 1);
    });

    it("still honors skip roots during matrix-only traversal", () => {
        const root = new Object3D();
        const skippedRoot = new Object3D();
        const skippedChild = new Object3D();
        skippedChild.position.set(1, 0, 0);
        skippedRoot.add(skippedChild);
        root.add(skippedRoot);
        root.updateMatrixWorld(true);

        const traverser = new SceneTraverser(root);
        traverser.addSkipRoot(skippedRoot);

        skippedRoot.position.set(5, 0, 0);
        traverser.update({collectHandlers: false});

        expect(getWorldPosition(skippedChild).distanceTo(new Vector3(1, 0, 0))).toBeLessThan(1e-15);
    });
});
