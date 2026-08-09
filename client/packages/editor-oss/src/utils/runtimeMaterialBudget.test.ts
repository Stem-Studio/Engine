import {Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Scene, BoxGeometry, Texture, PerspectiveCamera} from "three";
import {describe, expect, it, vi} from "vitest";

import {
    applyRuntimeMaterialBudget,
    applyRuntimeMaterialBudgetProgressive,
    restoreRuntimeMaterialBudget,
} from "./runtimeMaterialBudget";

type TestStandardNodeMaterial = Omit<MeshStandardMaterial, "colorNode" | "emissiveNode"> & {
    isMeshStandardNodeMaterial?: boolean;
    emissiveNode?: unknown;
    colorNode?: unknown;
};

type TestBasicNodeMaterial = Omit<MeshBasicMaterial, "emissiveNode"> & {
    isMeshStandardNodeMaterial?: boolean;
    emissiveNode?: unknown;
};

function makeRuntimeMesh(material: TestStandardNodeMaterial): Mesh {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
    mesh.userData.isRuntimeOnly = true;
    return mesh;
}

function addRuntimeAtDeepLeaf(scene: Scene, object: Mesh, depth = 512): void {
    const root = new Group();
    root.userData.isRuntimeOnly = true;
    let parent = root;
    for (let i = 0; i < depth; i++) {
        const child = new Group();
        parent.add(child);
        parent = child;
    }
    parent.add(object);
    scene.add(root);
}

describe("runtimeMaterialBudget", () => {
    it("strips and restores decorative emissive nodes on runtime MeshStandardNodeMaterial", () => {
        const scene = new Scene();
        const material = new MeshStandardMaterial({color: 0x668844}) as TestStandardNodeMaterial;
        material.isMeshStandardNodeMaterial = true;
        material.emissiveNode = {kind: "rim"};
        const mesh = makeRuntimeMesh(material);
        scene.add(mesh);
        const initialVersion = material.version;

        const stats = applyRuntimeMaterialBudget(scene);

        expect(stats.enabled).toBe(true);
        expect(stats.materialsVisited).toBe(1);
        expect(stats.materialsSimplified).toBe(1);
        expect(stats.materialsDowngraded).toBe(2);
        expect(material.emissiveNode).toBeNull();
        expect(material.version).toBe(initialVersion + 1);
        expect(mesh.material).not.toBe(material);
        expect(mesh.material).toBeInstanceOf(MeshBasicMaterial);
        expect((mesh.material as MeshBasicMaterial).userData.runtimeMaterialBudgetDowngradedFromNodeMaterial)
            .toBe(true);
        expect((mesh.material as MeshBasicMaterial).userData.runtimeMaterialBudgetDowngradedFromStandardMaterial)
            .toBe(true);

        restoreRuntimeMaterialBudget(scene);

        expect(mesh.material).toBe(material);
        expect(material.emissiveNode).toEqual({kind: "rim"});
        expect(material.version).toBe(initialVersion + 2);
    });

    it("progressively applies the same material budget while yielding", async () => {
        const scene = new Scene();
        const material = new MeshStandardMaterial({color: 0x668844}) as TestStandardNodeMaterial;
        material.isMeshStandardNodeMaterial = true;
        material.emissiveNode = {kind: "progressive-rim"};
        const mesh = makeRuntimeMesh(material);
        scene.add(mesh);
        let yields = 0;

        const stats = await applyRuntimeMaterialBudgetProgressive(scene, {
            batchSize: 1,
            frameBudgetMs: 0,
            yieldToFrame: async () => {
                yields++;
            },
        });

        expect(yields).toBeGreaterThan(0);
        expect(stats.enabled).toBe(true);
        expect(stats.materialsVisited).toBe(1);
        expect(stats.materialsSimplified).toBe(1);
        expect(stats.materialsDowngraded).toBe(2);
        expect(material.emissiveNode).toBeNull();
        expect(mesh.material).toBeInstanceOf(MeshBasicMaterial);

        restoreRuntimeMaterialBudget(scene);

        expect(mesh.material).toBe(material);
        expect(material.emissiveNode).toEqual({kind: "progressive-rim"});
    });

    it("does not simplify authored objects or opted-out runtime materials", () => {
        const scene = new Scene();
        const authoredMaterial = new MeshStandardMaterial() as TestStandardNodeMaterial;
        authoredMaterial.isMeshStandardNodeMaterial = true;
        authoredMaterial.emissiveNode = "authored";
        scene.add(new Mesh(new BoxGeometry(1, 1, 1), authoredMaterial));

        const optedOutMaterial = new MeshStandardMaterial() as TestStandardNodeMaterial;
        optedOutMaterial.isMeshStandardNodeMaterial = true;
        optedOutMaterial.emissiveNode = "runtime";
        optedOutMaterial.userData.disableRuntimeMaterialBudget = true;
        scene.add(makeRuntimeMesh(optedOutMaterial));

        const stats = applyRuntimeMaterialBudget(scene);

        expect(stats.materialsVisited).toBe(1);
        expect(stats.materialsSimplified).toBe(0);
        expect(stats.materialsDowngraded).toBe(0);
        expect(authoredMaterial.emissiveNode).toBe("authored");
        expect(optedOutMaterial.emissiveNode).toBe("runtime");
    });

    it("descends through authored parents to simplify nested runtime children", () => {
        const scene = new Scene();
        const authoredRoot = new Group();
        const runtimeChildRoot = new Group();
        runtimeChildRoot.userData.isRuntimeOnly = true;

        const material = new MeshStandardMaterial({color: 0x668844}) as TestStandardNodeMaterial;
        material.isMeshStandardNodeMaterial = true;
        material.emissiveNode = {kind: "nested-rim"};
        runtimeChildRoot.add(new Mesh(new BoxGeometry(1, 1, 1), material));
        authoredRoot.add(runtimeChildRoot);
        scene.add(authoredRoot);

        const stats = applyRuntimeMaterialBudget(scene);

        expect(stats.materialsVisited).toBe(1);
        expect(stats.materialsSimplified).toBe(1);
        expect(stats.materialsDowngraded).toBe(2);
        expect(material.emissiveNode).toBeNull();
    });

    it("applies and restores through deep hierarchies without Three's recursive traverse", () => {
        const scene = new Scene();
        const material = new MeshStandardMaterial({color: 0x668844}) as TestStandardNodeMaterial;
        material.isMeshStandardNodeMaterial = true;
        material.emissiveNode = {kind: "deep-rim"};
        const mesh = makeRuntimeMesh(material);
        addRuntimeAtDeepLeaf(scene, mesh);
        const traverseSpy = vi.spyOn(scene, "traverse");

        const stats = applyRuntimeMaterialBudget(scene);

        expect(stats.materialsVisited).toBe(1);
        expect(stats.materialsSimplified).toBe(1);
        expect(mesh.material).toBeInstanceOf(MeshBasicMaterial);

        restoreRuntimeMaterialBudget(scene);

        expect(mesh.material).toBe(material);
        expect(material.emissiveNode).toEqual({kind: "deep-rim"});
        expect(traverseSpy).not.toHaveBeenCalled();
    });

    it("deduplicates shared materials and honors scene-level disable", () => {
        const scene = new Scene();
        scene.userData.rendering = {
            runtimeMaterialBudget: {enabled: false},
        };
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const material = new MeshStandardMaterial() as TestStandardNodeMaterial;
        material.isMeshStandardNodeMaterial = true;
        material.emissiveNode = "shared";
        root.add(new Mesh(new BoxGeometry(1, 1, 1), material));
        root.add(new Mesh(new BoxGeometry(1, 1, 1), material));
        scene.add(root);

        const disabledStats = applyRuntimeMaterialBudget(scene);
        expect(disabledStats.enabled).toBe(false);
        expect(disabledStats.materialsVisited).toBe(0);
        expect(disabledStats.materialsDowngraded).toBe(0);
        expect(material.emissiveNode).toBe("shared");

        scene.userData.rendering.runtimeMaterialBudget.enabled = true;
        const enabledStats = applyRuntimeMaterialBudget(scene);
        expect(enabledStats.materialsVisited).toBe(1);
        expect(enabledStats.materialsSimplified).toBe(1);
        expect(enabledStats.materialsDowngraded).toBe(2);
        expect(material.emissiveNode).toBeNull();
    });

    it("shares equivalent simple runtime materials and restores the original assignments", () => {
        const scene = new Scene();
        scene.userData.rendering = {
            runtimeMaterialBudget: {
                downgradeSimpleStandardMaterials: false,
            },
        };
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const firstMaterial = new MeshStandardMaterial({color: 0x224466, roughness: 0.75});
        const secondMaterial = new MeshStandardMaterial({color: 0x224466, roughness: 0.75});
        const firstMesh = new Mesh(new BoxGeometry(1, 1, 1), firstMaterial);
        const secondMesh = new Mesh(new BoxGeometry(1, 1, 1), secondMaterial);
        root.add(firstMesh, secondMesh);
        scene.add(root);

        const stats = applyRuntimeMaterialBudget(scene);

        expect(stats.materialsShared).toBe(1);
        expect(stats.materialShareGroups).toBe(1);
        expect(secondMesh.material).toBe(firstMesh.material);

        restoreRuntimeMaterialBudget(scene);

        expect(firstMesh.material).toBe(firstMaterial);
        expect(secondMesh.material).toBe(secondMaterial);
    });

    it("can disable equivalent runtime material sharing", () => {
        const scene = new Scene();
        scene.userData.rendering = {
            runtimeMaterialBudget: {
                downgradeSimpleStandardMaterials: false,
                shareEquivalentRuntimeMaterials: false,
            },
        };
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const firstMaterial = new MeshStandardMaterial({color: 0x224466, roughness: 0.75});
        const secondMaterial = new MeshStandardMaterial({color: 0x224466, roughness: 0.75});
        const firstMesh = new Mesh(new BoxGeometry(1, 1, 1), firstMaterial);
        const secondMesh = new Mesh(new BoxGeometry(1, 1, 1), secondMaterial);
        root.add(firstMesh, secondMesh);
        scene.add(root);

        const stats = applyRuntimeMaterialBudget(scene);

        expect(stats.materialsShared).toBe(0);
        expect(secondMesh.material).toBe(secondMaterial);
    });

    it("does not share UI-camera descendant materials by default", () => {
        const scene = new Scene();
        const uiCamera = new PerspectiveCamera();
        uiCamera.userData.isRuntimeOnly = true;
        const firstMaterial = new MeshBasicMaterial({color: 0xffffff});
        const secondMaterial = new MeshBasicMaterial({color: 0xffffff});
        const firstMesh = new Mesh(new BoxGeometry(1, 1, 1), firstMaterial);
        const secondMesh = new Mesh(new BoxGeometry(1, 1, 1), secondMaterial);
        uiCamera.add(firstMesh, secondMesh);
        scene.add(uiCamera);

        const stats = applyRuntimeMaterialBudget(scene);

        expect(stats.materialsShared).toBe(0);
        expect(firstMesh.material).toBe(firstMaterial);
        expect(secondMesh.material).toBe(secondMaterial);
    });

    it("does not share runtime materials with textures, custom userData, or explicit sharing opt-outs", () => {
        const scene = new Scene();
        scene.userData.rendering = {
            runtimeMaterialBudget: {
                downgradeSimpleStandardMaterials: false,
                shareEquivalentRuntimeMaterials: true,
            },
        };
        const root = new Group();
        root.userData.isRuntimeOnly = true;

        const texturedA = new MeshStandardMaterial({color: 0x224466, map: new Texture()});
        const texturedB = new MeshStandardMaterial({color: 0x224466, map: new Texture()});
        const customUserDataA = new MeshStandardMaterial({color: 0x668844});
        const customUserDataB = new MeshStandardMaterial({color: 0x668844});
        customUserDataA.userData.scriptKey = "a";
        customUserDataB.userData.scriptKey = "a";
        const optedOutA = new MeshStandardMaterial({color: 0x884466});
        const optedOutB = new MeshStandardMaterial({color: 0x884466});
        optedOutB.userData.disableRuntimeMaterialSharing = true;

        const texturedMeshA = new Mesh(new BoxGeometry(1, 1, 1), texturedA);
        const texturedMeshB = new Mesh(new BoxGeometry(1, 1, 1), texturedB);
        const customMeshA = new Mesh(new BoxGeometry(1, 1, 1), customUserDataA);
        const customMeshB = new Mesh(new BoxGeometry(1, 1, 1), customUserDataB);
        const optedOutMeshA = new Mesh(new BoxGeometry(1, 1, 1), optedOutA);
        const optedOutMeshB = new Mesh(new BoxGeometry(1, 1, 1), optedOutB);
        root.add(texturedMeshA, texturedMeshB, customMeshA, customMeshB, optedOutMeshA, optedOutMeshB);
        scene.add(root);

        const stats = applyRuntimeMaterialBudget(scene);

        expect(stats.materialsShared).toBe(0);
        expect(texturedMeshA.material).toBe(texturedA);
        expect(texturedMeshB.material).toBe(texturedB);
        expect(customMeshA.material).toBe(customUserDataA);
        expect(customMeshB.material).toBe(customUserDataB);
        expect(optedOutMeshA.material).toBe(optedOutA);
        expect(optedOutMeshB.material).toBe(optedOutB);
    });

    it("restores distinct original node materials after equivalent downgraded materials are shared", () => {
        const scene = new Scene();
        scene.userData.rendering = {
            runtimeMaterialBudget: {shareEquivalentRuntimeMaterials: true},
        };
        const root = new Group();
        root.userData.isRuntimeOnly = true;
        const firstMaterial = new MeshStandardMaterial({color: 0x668844}) as TestStandardNodeMaterial;
        const secondMaterial = new MeshStandardMaterial({color: 0x668844}) as TestStandardNodeMaterial;
        firstMaterial.isMeshStandardNodeMaterial = true;
        secondMaterial.isMeshStandardNodeMaterial = true;
        const firstMesh = new Mesh(new BoxGeometry(1, 1, 1), firstMaterial);
        const secondMesh = new Mesh(new BoxGeometry(1, 1, 1), secondMaterial);
        root.add(firstMesh, secondMesh);
        scene.add(root);

        const stats = applyRuntimeMaterialBudget(scene);

        expect(stats.materialsDowngraded).toBe(4);
        expect(stats.materialsShared).toBe(1);
        expect(firstMesh.material).toBeInstanceOf(MeshBasicMaterial);
        expect(firstMesh.material).not.toBe(firstMaterial);
        expect(secondMesh.material).toBe(firstMesh.material);

        restoreRuntimeMaterialBudget(scene);

        expect(firstMesh.material).toBe(firstMaterial);
        expect(secondMesh.material).toBe(secondMaterial);
    });

    it("downgrades and restores simple runtime standard materials to basic materials", () => {
        const scene = new Scene();
        scene.userData.rendering = {
            runtimeMaterialBudget: {downgradeSimpleStandardMaterials: true},
        };
        const material = new MeshStandardMaterial({
            color: 0x224466,
            opacity: 0.5,
            transparent: true,
        });
        material.userData.scriptKey = "decorative-runtime-material";
        const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
        mesh.userData.isRuntimeOnly = true;
        scene.add(mesh);

        const stats = applyRuntimeMaterialBudget(scene);

        expect(stats.materialsVisited).toBe(1);
        expect(stats.materialsDowngraded).toBe(1);
        expect(mesh.material).toBeInstanceOf(MeshBasicMaterial);
        const downgraded = mesh.material as unknown as MeshBasicMaterial;
        expect(downgraded.color.getHex()).toBe(0x224466);
        expect(downgraded.opacity).toBe(0.5);
        expect(downgraded.transparent).toBe(true);
        expect(downgraded.userData.scriptKey).toBe("decorative-runtime-material");
        expect(downgraded.userData.runtimeMaterialBudgetDowngradedFromStandardMaterial).toBe(true);

        restoreRuntimeMaterialBudget(scene);

        expect(mesh.material).toBe(material);
    });

    it("can preserve simple runtime standard materials when batchable material preservation is enabled", () => {
        const scene = new Scene();
        scene.userData.rendering = {
            runtimeMaterialBudget: {
                preserveBatchableStandardMaterials: true,
            },
        };
        const material = new MeshStandardMaterial({color: 0x224466});
        const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
        mesh.userData.isRuntimeOnly = true;
        scene.add(mesh);

        const stats = applyRuntimeMaterialBudget(scene);

        expect(stats.materialsVisited).toBe(1);
        expect(stats.materialsDowngraded).toBe(0);
        expect(mesh.material).toBe(material);

        restoreRuntimeMaterialBudget(scene);

        expect(mesh.material).toBe(material);
    });

    it("downgrades simple runtime standard materials by default when dynamic batching is disabled", () => {
        const scene = new Scene();
        scene.userData.rendering = {
            batching: {enableDynamic: false},
        };
        const material = new MeshStandardMaterial({color: 0x224466});
        const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
        mesh.userData.isRuntimeOnly = true;
        scene.add(mesh);

        const stats = applyRuntimeMaterialBudget(scene);

        expect(stats.materialsVisited).toBe(1);
        expect(stats.materialsDowngraded).toBe(1);
        expect(mesh.material).toBeInstanceOf(MeshBasicMaterial);

        restoreRuntimeMaterialBudget(scene);

        expect(mesh.material).toBe(material);
    });

    it("can opt into basic materials for simplified runtime standard node materials", () => {
        const scene = new Scene();
        scene.userData.rendering = {
            runtimeMaterialBudget: {downgradeSimpleStandardMaterials: true},
        };
        const material = new MeshStandardMaterial({color: 0x668844}) as TestStandardNodeMaterial;
        material.isMeshStandardNodeMaterial = true;
        material.emissiveNode = {kind: "rim"};
        const mesh = makeRuntimeMesh(material);
        scene.add(mesh);

        const stats = applyRuntimeMaterialBudget(scene);

        expect(stats.materialsSimplified).toBe(1);
        expect(stats.materialsDowngraded).toBe(2);
        expect(mesh.material).toBeInstanceOf(MeshBasicMaterial);
        expect((mesh.material as MeshBasicMaterial).userData.runtimeMaterialBudgetDowngradedFromNodeMaterial)
            .toBe(true);
        expect((mesh.material as MeshBasicMaterial).userData.runtimeMaterialBudgetDowngradedFromStandardMaterial)
            .toBe(true);

        restoreRuntimeMaterialBudget(scene);

        expect(mesh.material).toBe(material);
        expect(material.emissiveNode).toEqual({kind: "rim"});
    });

    it("does not downgrade runtime node materials with custom shader nodes", () => {
        const scene = new Scene();
        const material = new MeshStandardMaterial({color: 0x668844}) as TestStandardNodeMaterial;
        material.isMeshStandardNodeMaterial = true;
        material.colorNode = {kind: "gradient"};
        const mesh = makeRuntimeMesh(material);
        scene.add(mesh);

        const stats = applyRuntimeMaterialBudget(scene);

        expect(stats.materialsVisited).toBe(1);
        expect(stats.materialsSimplified).toBe(0);
        expect(stats.materialsDowngraded).toBe(0);
        expect(mesh.material).toBe(material);
    });

    it("can keep simple runtime node materials when downgrade is disabled", () => {
        const scene = new Scene();
        scene.userData.rendering = {
            runtimeMaterialBudget: {downgradeSimpleStandardNodeMaterials: false},
        };
        const material = new MeshStandardMaterial({color: 0x668844}) as TestStandardNodeMaterial;
        material.isMeshStandardNodeMaterial = true;
        const mesh = makeRuntimeMesh(material);
        scene.add(mesh);

        const stats = applyRuntimeMaterialBudget(scene);

        expect(stats.materialsVisited).toBe(1);
        expect(stats.materialsSimplified).toBe(0);
        expect(stats.materialsDowngraded).toBe(0);
        expect(mesh.material).toBe(material);
    });

    it("leaves non-standard node and basic materials alone", () => {
        const scene = new Scene();
        scene.userData.rendering = {
            runtimeMaterialBudget: {downgradeSimpleStandardMaterials: false},
        };
        const standard = new MeshStandardMaterial() as TestStandardNodeMaterial;
        standard.emissiveNode = "not-node-standard";
        scene.add(makeRuntimeMesh(standard));

        const basic = new MeshBasicMaterial() as TestBasicNodeMaterial;
        basic.isMeshStandardNodeMaterial = false;
        basic.emissiveNode = "basic-node-effect";
        const basicMesh = new Mesh(new BoxGeometry(1, 1, 1), basic);
        basicMesh.userData.isRuntimeOnly = true;
        scene.add(basicMesh);

        const stats = applyRuntimeMaterialBudget(scene);

        expect(stats.materialsVisited).toBe(2);
        expect(stats.materialsSimplified).toBe(0);
        expect(stats.materialsDowngraded).toBe(0);
        expect(standard.emissiveNode).toBe("not-node-standard");
        expect(basic.emissiveNode).toBe("basic-node-effect");
    });
});
