import * as THREE from "three";
import {describe, expect, it, vi} from "vitest";

import {
    applyMaterialSettingsToObject,
    applyMaterialSettingsToSpecificMaterial,
    createDefaultMaterialSettings,
    findMaterialByPathKey,
    generateMaterialPathKey,
} from "./materialUtils";

const makeNamedMesh = (name: string, material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
    mesh.name = name;
    return mesh;
};

const addDeepChain = (root: THREE.Object3D, depth = 12_000): THREE.Object3D => {
    let current = root;

    for (let i = 0; i < depth; i++) {
        const child = new THREE.Object3D();
        child.name = `Node${i}`;
        current.add(child);
        current = child;
    }

    return current;
};

describe("materialUtils path keys", () => {
    it("resolves generated keys after the root object is renamed", () => {
        const root = new THREE.Group();
        root.name = "OriginalRoot";
        const branch = new THREE.Group();
        branch.name = "Branch";
        const material = new THREE.MeshBasicMaterial();
        const mesh = makeNamedMesh("Panel", material);

        root.add(branch);
        branch.add(mesh);

        const key = generateMaterialPathKey(mesh, 0, root);
        root.name = "RenamedRoot";

        expect(findMaterialByPathKey(root, key)?.material).toBe(material);
    });

    it("keeps legacy named-root keys working after root rename", () => {
        const root = new THREE.Group();
        root.name = "RenamedRoot";
        const branch = new THREE.Group();
        branch.name = "Branch";
        const material = new THREE.MeshBasicMaterial();
        const mesh = makeNamedMesh("Panel", material);

        root.add(branch);
        branch.add(mesh);

        expect(findMaterialByPathKey(root, "OriginalRoot///Branch///Panel::0")?.material).toBe(material);
    });

    it("does not resolve to a sibling whose path is only a string suffix match", () => {
        const root = new THREE.Group();
        const suffixBranch = new THREE.Group();
        suffixBranch.name = "ll";
        const targetBranch = new THREE.Group();
        targetBranch.name = "Wall";

        const suffixMaterial = new THREE.MeshBasicMaterial();
        const targetMaterial = new THREE.MeshBasicMaterial();
        suffixBranch.add(makeNamedMesh("Panel", suffixMaterial));
        targetBranch.add(makeNamedMesh("Panel", targetMaterial));
        root.add(suffixBranch);
        root.add(targetBranch);

        expect(findMaterialByPathKey(root, "root///Wall///Panel::0")?.material).toBe(targetMaterial);
    });

    it("resolves generated keys in deep hierarchies without recursive Object3D traversal", () => {
        const root = new THREE.Group();
        const leaf = addDeepChain(root);
        const material = new THREE.MeshBasicMaterial();
        const mesh = makeNamedMesh("Panel", material);
        leaf.add(mesh);

        const pathKey = generateMaterialPathKey(mesh, 0, root);
        const traverseSpy = vi.spyOn(root, "traverse");
        const result = findMaterialByPathKey(root, pathKey);

        expect(result?.material).toBe(material);
        expect(result?.mesh).toBe(mesh);
        expect(result?.index).toBe(0);
        expect(traverseSpy).not.toHaveBeenCalled();
        traverseSpy.mockRestore();
    });

    it("applies legacy material settings through deep hierarchies without recursive traversal", () => {
        const root = new THREE.Group();
        const leaf = addDeepChain(root);
        const material = new THREE.MeshPhongMaterial({opacity: 1});
        const mesh = makeNamedMesh("Panel", material);
        leaf.add(mesh);

        const settings = createDefaultMaterialSettings(material);
        settings.texturesSettings.opacity = 0.42;
        settings.texturesSettings.useBaseAlpha = true;

        const traverseSpy = vi.spyOn(root, "traverse");
        applyMaterialSettingsToObject(root, settings);

        expect((mesh.material as THREE.Material).opacity).toBe(0.42);
        expect((mesh.material as THREE.Material).transparent).toBe(true);
        expect(Object.keys(root.userData.materialSettings)).toHaveLength(1);
        expect(traverseSpy).not.toHaveBeenCalled();
        traverseSpy.mockRestore();
    });

    it("replaces shared specific materials in deep hierarchies without recursive traversal", () => {
        const root = new THREE.Group();
        const leaf = addDeepChain(root);
        const sharedMaterial = new THREE.MeshPhongMaterial();
        const targetMesh = makeNamedMesh("Target", sharedMaterial);
        const sharedMesh = makeNamedMesh("Shared", sharedMaterial);
        leaf.add(targetMesh);
        root.add(sharedMesh);

        const pathKey = generateMaterialPathKey(targetMesh, 0, root);
        const settings = createDefaultMaterialSettings(new THREE.MeshPhysicalMaterial());
        const traverseSpy = vi.spyOn(root, "traverse");

        applyMaterialSettingsToSpecificMaterial(root, settings, pathKey);

        expect(targetMesh.material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
        expect(sharedMesh.material).toBe(targetMesh.material);
        expect(traverseSpy).not.toHaveBeenCalled();
        traverseSpy.mockRestore();
    });
});
