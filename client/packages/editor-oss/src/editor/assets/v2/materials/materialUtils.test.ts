import * as THREE from "three";
import {describe, expect, it} from "vitest";

import {findMaterialByPathKey, generateMaterialPathKey} from "./materialUtils";

const makeNamedMesh = (name: string, material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
    mesh.name = name;
    return mesh;
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
});
