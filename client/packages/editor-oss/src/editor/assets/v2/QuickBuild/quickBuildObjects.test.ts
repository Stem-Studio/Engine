import {describe, expect, it} from "vitest";
import * as THREE from "three";
import Converter from "@stem/editor-oss/serialization/Converter";

import {
    createQuickBuildObject,
    createQuickBuildPreviewObject,
    EMPTY_QUICK_BUILD_CONNECTIONS,
    findQuickBuildRoot,
    getEnhancedQuickBuildScale,
    getQuickBuildMetadata,
    getQuickBuildPlacementSnap,
    nextQuickBuildUserData,
    QUICK_BUILD_CELL_SIZE,
    QUICK_BUILD_MAX_LEVEL,
    QUICK_BUILD_TOP_FACE_MATERIAL_INDEX,
    repairQuickBuildRenderableState,
    snapQuickBuildPoint,
} from "./quickBuildObjects";
import type {QuickBuildStampKind} from "./quickBuildObjects";

describe("quickBuildObjects", () => {
    it("serializes authored material values for every generated mesh", () => {
        const object = createQuickBuildObject("ground");

        const parts = new Converter().traverse(object, [], [], {options: {}}, false) as any[];
        const meshes = parts.filter(part => part?.metadata?.generator === "MeshSerializer");
        expect(meshes.length).toBeGreaterThan(0);
        expect(meshes.every(mesh => {
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            return materials.length > 0 && materials.every((material: any) => material && Object.keys(material).length > 1);
        })).toBe(true);
        expect(meshes.some(mesh => {
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            return materials.some((material: any) => material?.color === 0x4f8f3a);
        })).toBe(true);
    });

    it("creates tagged quick build stamps", () => {
        const house = createQuickBuildObject("house");

        expect(house.name).toBe("Quick Build House");
        expect(getQuickBuildMetadata(house)).toEqual({
            kind: "house",
            level: 1,
            connections: EMPTY_QUICK_BUILD_CONNECTIONS,
        });
        expect(house.children.length).toBeGreaterThan(1);
        expect(house.userData.isStemObject).toBe(true);
        expect(house.userData.isSelectable).toBe(true);
        expect(house.userData.isBatchable).toBe(false);
        expect(house.userData.editorVisibility).toBe(true);
        expect(house.userData.gameVisibility).toBe(true);
    });

    it("creates the expanded city builder palette", () => {
        const kinds: QuickBuildStampKind[] = [
            "ground",
            "sand",
            "stone",
            "path",
            "water",
            "bridge",
            "farm",
            "fence",
            "tree",
            "bush",
            "rock",
            "house",
            "lamp",
        ];

        for (const kind of kinds) {
            const object = createQuickBuildObject(kind);
            expect(getQuickBuildMetadata(object)?.kind).toBe(kind);
            expect(object.children.length).toBeGreaterThan(0);
            expect(object.userData.isStemObject).toBe(true);
            expect(object.userData.isSelectable).toBe(true);
        }

        expect(createQuickBuildObject("bridge").children.some(child => child.userData.quickBuildPart === "bridge-rail")).toBe(true);
        expect(createQuickBuildObject("farm").children.some(child => child.name === "Crop Row")).toBe(true);
        expect(createQuickBuildObject("fence").children.some(child => child.userData.quickBuildPart === "fence-post")).toBe(true);
    });

    it("creates procedural variants for houses, streets, and shrubs", () => {
        const street = createQuickBuildObject("path", {variantId: "path-street"});
        const hedge = createQuickBuildObject("bush", {variantId: "bush-hedge"});
        const flowering = createQuickBuildObject("bush", {variantId: "bush-flowering"});
        const cabin = createQuickBuildObject("house", {variantId: "house-cabin"});
        const townhouse = createQuickBuildObject("house", {variantId: "house-townhouse"});

        expect(street.name).toBe("Quick Build Street");
        expect(getQuickBuildMetadata(street)).toMatchObject({kind: "path", level: 1, variantId: "path-street"});
        expect(street.children.some(child => child.userData.quickBuildPart === "street-curb")).toBe(true);

        expect(hedge.name).toBe("Quick Build Hedge");
        expect(getQuickBuildMetadata(hedge)).toMatchObject({kind: "bush", level: 1, variantId: "bush-hedge"});
        expect(hedge.children.length).toBeGreaterThan(1);

        expect(flowering.name).toBe("Quick Build Flowering");
        expect(getQuickBuildMetadata(flowering)).toMatchObject({kind: "bush", level: 1, variantId: "bush-flowering"});
        expect(flowering.children.length).toBeGreaterThan(createQuickBuildObject("bush").children.length);

        expect(cabin.name).toBe("Quick Build Cabin");
        expect(getQuickBuildMetadata(cabin)).toMatchObject({kind: "house", level: 1, variantId: "house-cabin"});
        expect(cabin.children.length).toBeGreaterThan(createQuickBuildObject("house").children.length);

        expect(townhouse.name).toBe("Quick Build Townhouse");
        expect(getQuickBuildMetadata(townhouse)).toMatchObject({kind: "house", level: 1, variantId: "house-townhouse"});
    });

    it("centers fence segments on their own placement line", () => {
        const fence = createQuickBuildObject("fence");

        expect(fence.children.length).toBeGreaterThan(1);
        expect(fence.children.every(child => Math.abs(child.position.z) < 0.001)).toBe(true);
        expect(fence.children.some(child => child.userData.quickBuildPart === "fence-rail-low")).toBe(true);
        expect(fence.children.some(child => child.userData.quickBuildPart === "fence-rail-high")).toBe(true);
    });

    it("uses smaller snap increments for structures and segment props", () => {
        expect(getQuickBuildPlacementSnap("ground", QUICK_BUILD_CELL_SIZE)).toBe(QUICK_BUILD_CELL_SIZE);
        expect(getQuickBuildPlacementSnap("path", QUICK_BUILD_CELL_SIZE)).toBe(QUICK_BUILD_CELL_SIZE);
        expect(getQuickBuildPlacementSnap("fence", QUICK_BUILD_CELL_SIZE)).toBe(1);
        expect(getQuickBuildPlacementSnap("house", QUICK_BUILD_CELL_SIZE)).toBe(0.5);
        expect(getQuickBuildPlacementSnap("tree", QUICK_BUILD_CELL_SIZE)).toBe(0.5);
    });

    it("repairs legacy centerline fence geometry to the line-centered segment", () => {
        const legacy = new THREE.Group();
        legacy.userData.quickBuild = {kind: "fence", level: 1};
        legacy.userData.isQuickBuildObject = true;
        const oldArm = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
        oldArm.userData.quickBuildPart = "fence-east";
        legacy.add(oldArm);

        expect(repairQuickBuildRenderableState(legacy)).toBe(true);

        expect(legacy.children.some(child => child.userData.quickBuildPart === "fence-east")).toBe(false);
        expect(legacy.children.some(child => child.userData.quickBuildPart === "fence-rail-low")).toBe(true);
        expect(legacy.children.every(child => Math.abs(child.position.z) < 0.001)).toBe(true);
    });

    it("repairs empty serialized material arrays after a scene reload", () => {
        const ground = createQuickBuildObject("ground");
        const mesh = ground.children.find(child => (child as THREE.Mesh).isMesh) as THREE.Mesh;
        mesh.material = [];

        expect(repairQuickBuildRenderableState(ground)).toBe(true);

        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        expect(materials.length).toBeGreaterThanOrEqual(6);
        expect(materials.every(material => material?.isMaterial === true)).toBe(true);
        expect(materials.every(material => material.visible === true)).toBe(true);
    });

    it("repairs metadata-only material entries after a scene reload", () => {
        const ground = createQuickBuildObject("ground");
        const mesh = ground.children.find(child => (child as THREE.Mesh).isMesh) as THREE.Mesh;
        mesh.material = [new THREE.MeshStandardMaterial()];

        expect(repairQuickBuildRenderableState(ground)).toBe(true);

        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const material = materials[0] as THREE.MeshStandardMaterial;
        expect(material?.color.getHex()).toBe(0x4f8f3a);
        expect(material?.roughness).toBe(0.9);
    });

    it("repairs null-slot MeshBasic fallbacks after a scene reload", () => {
        const ground = createQuickBuildObject("ground");
        const mesh = ground.children.find(child => (child as THREE.Mesh).isMesh) as THREE.Mesh;
        mesh.material = [new THREE.MeshBasicMaterial()];

        expect(repairQuickBuildRenderableState(ground)).toBe(true);

        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const material = materials[0] as THREE.MeshStandardMaterial;
        expect(material?.type).toBe("MeshStandardMaterial");
        expect(material?.color.getHex()).toBe(0x4f8f3a);
        expect(material?.roughness).toBe(0.9);
    });

    it("resolves a quick build root from a child mesh", () => {
        const tree = createQuickBuildObject("tree");
        const child = tree.children[0];

        expect(findQuickBuildRoot(child)).toBe(tree);
    });

    it("marks flat build pieces as top-face texture targets", () => {
        for (const kind of ["ground", "sand", "stone", "water", "farm", "path", "bridge", "fence"] as const) {
            const object = createQuickBuildObject(kind);
            const mesh = object.children.find(child => (child as THREE.Mesh).isMesh) as THREE.Mesh | undefined;

            expect(mesh).toBeDefined();
            expect(Array.isArray(mesh?.material)).toBe(true);
            expect(mesh?.userData.quickBuildTextureMaterialIndices).toEqual([QUICK_BUILD_TOP_FACE_MATERIAL_INDEX]);
            expect(mesh?.userData.isBatchable).toBe(false);
        }
    });

    it("snaps placement on x/z while preserving hit height", () => {
        const snapped = snapQuickBuildPoint(new THREE.Vector3(1.49, 2.25, -2.51), 1);

        expect(snapped.toArray()).toEqual([1, 2.25, -3]);
    });

    it("returns capped enhance scale and next metadata", () => {
        const rock = createQuickBuildObject("rock");
        const nextScale = getEnhancedQuickBuildScale(rock, "rock");
        const nextUserData = nextQuickBuildUserData(rock);

        expect(nextScale?.x).toBeGreaterThan(rock.scale.x);
        expect(nextUserData.quickBuild).toEqual({
            kind: "rock",
            level: 2,
            connections: EMPTY_QUICK_BUILD_CONNECTIONS,
        });
        expect(nextUserData.isStemObject).toBe(true);
        expect(nextUserData.isSelectable).toBe(true);
        expect(nextUserData.managedBy).toBe("Quick Build");
        expect(nextUserData.sceneTreeBadge).toBe("Build");
        expect(nextUserData.sceneTreeDescription).toBe("Quick Build stamp");

        rock.userData.quickBuild = {kind: "rock", level: QUICK_BUILD_MAX_LEVEL};
        expect(getEnhancedQuickBuildScale(rock, "rock")).toBeNull();
    });

    it("keeps preview objects out of normal editor selection", () => {
        const preview = createQuickBuildPreviewObject("ground");
        const previewMesh = preview.children.find(child => (child as THREE.Mesh).isMesh);

        expect(preview.userData.isQuickBuildPreview).toBe(true);
        expect(preview.userData.isQuickBuildObject).toBe(false);
        expect(preview.userData.isStemObject).toBe(false);
        expect(preview.userData.isSelectable).toBe(false);
        expect(getQuickBuildMetadata(preview)).toBeNull();
        expect(findQuickBuildRoot(preview)).toBeNull();
        expect(findQuickBuildRoot(previewMesh)).toBeNull();
    });
});
