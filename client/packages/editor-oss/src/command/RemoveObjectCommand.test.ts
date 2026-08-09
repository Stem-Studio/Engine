import * as THREE from "three";
import {CSS3DObject} from "three/addons/renderers/CSS3DRenderer.js";
import {afterEach, describe, expect, it, vi} from "vitest";

vi.mock("i18next", () => ({
    t: (key: string) => key,
}));

import global from "../global";
import {RemoveObjectCommand} from "./RemoveObjectCommand.js";

function createEditor(scene: THREE.Scene) {
    return {
        scene,
        selected: null as THREE.Object3D | null,
        addObject: vi.fn((object: THREE.Object3D, parent?: THREE.Object3D) => {
            (parent ?? scene).add(object);
        }),
        removeObject: vi.fn((object: THREE.Object3D) => {
            object.parent?.remove(object);
        }),
        select: vi.fn((object: THREE.Object3D | null) => {
            editor.selected = object;
        }),
        objectByUuid: vi.fn((uuid: string) => {
            let found: THREE.Object3D | undefined;
            const stack: THREE.Object3D[] = [scene];
            while (stack.length > 0) {
                const object = stack.pop()!;
                if (object.uuid === uuid) {
                    found = object;
                    break;
                }
                for (let i = object.children.length - 1; i >= 0; i--) {
                    const child = object.children[i];
                    if (child) stack.push(child);
                }
            }
            return found;
        }),
    };
}

let editor: ReturnType<typeof createEditor>;

afterEach(() => {
    (global as any).app = null;
    vi.restoreAllMocks();
});

describe("RemoveObjectCommand", () => {
    it("removes and restores deep object subtrees without recursive traversal", () => {
        const scene = new THREE.Scene();
        const parent = new THREE.Group();
        parent.name = "Parent";
        scene.add(parent);

        const root = new THREE.Group();
        root.name = "Root";
        parent.add(root);

        let cursor: THREE.Object3D = root;
        for (let i = 0; i < 12_000; i++) {
            const child = new THREE.Group();
            cursor.add(child);
            cursor = child;
        }

        const cssObject = new CSS3DObject(document.createElement("div"));
        root.add(cssObject);
        const traverseSpy = vi.spyOn(root, "traverse");
        editor = createEditor(scene);
        (global as any).app = {editor};

        const command = new RemoveObjectCommand(root);

        expect(command.execute()).toMatchObject({status: "success"});
        expect(traverseSpy).not.toHaveBeenCalled();
        expect(root.parent).toBeNull();
        expect(cssObject.parent).toBeNull();

        expect(command.undo()).toMatchObject({status: "success"});
        expect(root.parent).toBe(parent);
    });
});
