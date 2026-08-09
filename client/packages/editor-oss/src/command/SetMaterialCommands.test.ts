import * as THREE from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import global from "../global";
import {SetMaterialRangeCommand} from "./SetMaterialRangeCommand";
import {SetMaterialTextureCommand} from "./materials/SetMaterialTextureCommand";
import {SetMaterialVectorCommand} from "./SetMaterialVectorCommand";

vi.mock("i18next", () => ({
    t: (key: string) => key,
}));

vi.mock("toastywave", () => ({
    toast: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));

const createEditor = (material: Record<string, any>) => ({
    getObjectMaterial: vi.fn(() => material),
    objectByUuid: vi.fn(),
    signals: {
        objectChanged: {dispatch: vi.fn()},
        materialChanged: {dispatch: vi.fn()},
    },
});

function addDeepObjectChain(root: THREE.Object3D, depth = 12_000): THREE.Object3D {
    let current = root;

    for (let i = 0; i < depth; i++) {
        const child = new THREE.Object3D();
        current.add(child);
        current = child;
    }

    return current;
}

afterEach(() => {
    global.app = null;
    vi.restoreAllMocks();
});

describe("material commands", () => {
    it("constructs vector commands through the command editor reference", () => {
        const material = {offset: new THREE.Vector2(1, 2)};
        const editor = createEditor(material);
        global.app = {editor} as any;
        const object = new THREE.Object3D();
        object.name = "MaterialTarget";

        const command = new SetMaterialVectorCommand(object, "offset", [3, 4]);

        command.execute();
        expect(material.offset.toArray()).toEqual([3, 4]);
        expect(editor.signals.materialChanged.dispatch).toHaveBeenCalledWith(object, -1);

        command.undo();
        expect(material.offset.toArray()).toEqual([1, 2]);
    });

    it("constructs range commands from the selected material attribute", () => {
        const material = {range: [0.25, 0.75], needsUpdate: false};
        const editor = createEditor(material);
        global.app = {editor} as any;
        const object = new THREE.Object3D();
        object.name = "MaterialTarget";

        const command = new SetMaterialRangeCommand(object, "range", 0.1, 0.9);

        command.execute();
        expect(material.range).toEqual([0.1, 0.9]);
        expect(material.needsUpdate).toBe(true);
        expect(editor.signals.objectChanged.dispatch).toHaveBeenCalledWith(object);
        expect(editor.signals.materialChanged.dispatch).toHaveBeenCalledWith(object, -1);

        command.undo();
        expect(material.range).toEqual([0.25, 0.75]);
    });

    it("restores texture materials through deep hierarchies without recursive traversal", () => {
        const root = new THREE.Group();
        const leaf = addDeepObjectChain(root);
        const originalMaterial = new THREE.MeshBasicMaterial({color: 0xff0000});
        const replacementMaterial = new THREE.MeshBasicMaterial({color: 0x00ff00});
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(), replacementMaterial);
        leaf.add(mesh);
        root.userData.materialSettings = {changed: true};

        const command = new SetMaterialTextureCommand(root, "asset-id", "textures", "Texture", "polyhaven") as any;
        command.originalMaterials.set(mesh, originalMaterial);
        command.originalMaterialSettings = {restored: true};
        const traverseSpy = vi.spyOn(root, "traverse");

        const result = command.undo();

        expect(result).toMatchObject({status: "success"});
        expect(mesh.material).toBe(originalMaterial);
        expect(root.userData.materialSettings).toEqual({restored: true});
        expect(traverseSpy).not.toHaveBeenCalled();
    });
});
