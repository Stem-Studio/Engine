import {BoxGeometry, Mesh, MeshBasicMaterial, Object3D} from "three";
import {describe, expect, it, vi} from "vitest";

import HideObjectLambda from "../packs/hideObject/HideObjectLambda";
import SetBehaviorEnabledLambda from "../packs/setBehaviorEnabled/SetBehaviorEnabledLambda";
import SetMaterialLambda from "../packs/setMaterial/SetMaterialLambda";
import ShowObjectLambda from "../packs/showObject/ShowObjectLambda";

function addDeepObjectChain(root: Object3D, depth = 12_000): Object3D {
    let current = root;

    for (let i = 0; i < depth; i++) {
        const child = new Object3D();
        current.add(child);
        current = child;
    }

    return current;
}

describe("built-in lambda hierarchy traversal", () => {
    it("hides and shows deep child hierarchies without recursive Object3D.traverse", () => {
        const root = new Object3D();
        const leaf = addDeepObjectChain(root);
        const traverseSpy = vi.spyOn(root, "traverse");

        const hide = new HideObjectLambda("hideObject", {});
        hide._registerObject(root, {includeChildren: true});
        hide.update(1 / 60);

        expect(root.visible).toBe(false);
        expect(leaf.visible).toBe(false);

        const show = new ShowObjectLambda("showObject", {});
        show._registerObject(root, {includeChildren: true});
        show.update(1 / 60);

        expect(root.visible).toBe(true);
        expect(leaf.visible).toBe(true);
        expect(traverseSpy).not.toHaveBeenCalled();
    });

    it("applies material changes to deep child meshes without recursive Object3D.traverse", () => {
        const root = new Object3D();
        const leaf = addDeepObjectChain(root);
        const material = new MeshBasicMaterial({color: "#ffffff"});
        const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
        leaf.add(mesh);
        const traverseSpy = vi.spyOn(root, "traverse");

        const lambda = new SetMaterialLambda("setMaterial", {});
        lambda._registerObject(root, {
            includeChildren: true,
            color: "#123456",
            opacity: 0.5,
        });
        lambda.update(1 / 60);

        expect(material.color.getHexString()).toBe("123456");
        expect(material.opacity).toBe(0.5);
        expect(material.transparent).toBe(true);
        expect(traverseSpy).not.toHaveBeenCalled();
    });

    it("toggles behaviors on deep children without recursive Object3D.traverse", () => {
        const root = new Object3D();
        const leaf = addDeepObjectChain(root);
        const behavior = {
            id: "target-behavior",
            uuid: "behavior-uuid",
            enabled: true,
            attributesData: {},
        };
        leaf.userData.behaviors = [behavior];
        const traverseSpy = vi.spyOn(root, "traverse");

        const lambda = new SetBehaviorEnabledLambda("setBehaviorEnabled", {});
        lambda._registerObject(root, {
            includeChildren: true,
            behaviorRef: "target-behavior",
            enabled: false,
        });
        lambda.update(1 / 60);

        expect(behavior.enabled).toBe(false);
        expect(traverseSpy).not.toHaveBeenCalled();
    });
});
