import {describe, expect, it, vi} from "vitest";
import * as THREE from "three";

import {createQuickBuildObject} from "./quickBuildObjects";
import {
    analyzeQuickBuildScene,
    collectQuickBuildObjects,
    collectQuickBuildStaticTargets,
    collectQuickBuildLiveBatchObjects,
    createQuickBuildBakedBatch,
    createQuickBuildExportPayload,
    findAnyQuickBuildObjectAtPoint,
    findQuickBuildObjectAtPoint,
    findQuickBuildDuplicateGroups,
    findNearestQuickBuildObjectNearPoint,
    getPlaceableQuickBuildPoints,
    getQuickBuildBrushPoints,
    getQuickBuildPlacementCandidates,
    getQuickBuildDuplicateRemovalTargets,
    rebuildQuickBuildLiveBatch,
    clearQuickBuildLiveBatches,
    refreshQuickBuildAdjacency,
} from "./quickBuildSceneTools";

describe("quickBuildSceneTools", () => {
    it("collects quick build roots from a scene", () => {
        const scene = new THREE.Scene();
        const tree = createQuickBuildObject("tree");
        const house = createQuickBuildObject("house");
        scene.add(tree, house, new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));

        expect(collectQuickBuildObjects(scene)).toEqual([tree, house]);
    });

    it("finds duplicate stamps on the same snapped footprint", () => {
        const scene = new THREE.Scene();
        const first = createQuickBuildObject("ground");
        const second = createQuickBuildObject("ground");
        const nearbyTree = createQuickBuildObject("tree");
        first.position.set(0.04, 0, 0.04);
        second.position.set(0.42, 0, 0.39);
        second.userData.quickBuild = {kind: "ground", level: 3};
        nearbyTree.position.set(0.1, 0, 0.1);
        scene.add(first, second, nearbyTree);

        const groups = findQuickBuildDuplicateGroups(scene, 1);
        const group = groups[0];

        expect(groups).toHaveLength(1);
        expect(group?.kind).toBe("ground");
        expect(group?.keep).toBe(second);
        expect(group?.remove).toEqual([first]);
        expect(getQuickBuildDuplicateRemovalTargets(scene, 1)).toEqual([first]);
    });

    it("analyzes quick build scene cost", () => {
        const scene = new THREE.Scene();
        const rock = createQuickBuildObject("rock");
        const house = createQuickBuildObject("house");
        scene.add(rock, house);

        const stats = analyzeQuickBuildScene(scene);

        expect(stats.objectCount).toBe(2);
        expect(stats.meshCount).toBeGreaterThan(1);
        expect(stats.triangleCount).toBeGreaterThan(0);
        expect(stats.materialCount).toBe(stats.meshCount);
        expect(stats.duplicateCount).toBe(0);
        expect(stats.staticEligibleCount).toBe(2);
        expect(stats.bakedBatchCount).toBe(0);
    });

    it("collects objects that can be frozen as static", () => {
        const tree = createQuickBuildObject("tree");
        tree.children[0]!.matrixAutoUpdate = false;

        const targets = collectQuickBuildStaticTargets([tree]);

        expect(targets).not.toContain(tree);
        expect(targets).not.toContain(tree.children[0]);
        expect(targets).toContain(tree.children[1]!);
    });

    it("creates radius, line, and rectangle brush footprints", () => {
        const origin = new THREE.Vector3(0.2, 0, 0.4);
        const anchor = new THREE.Vector3(-1, 0, -1);

        expect(getQuickBuildBrushPoints(origin, 1, {mode: "radius", radius: 1})).toHaveLength(5);
        expect(getQuickBuildBrushPoints(origin, 1, {mode: "line", anchor}).map(point => point.toArray())).toEqual([
            [-1, 0, -1],
            [0, 0, 0],
        ]);
        expect(getQuickBuildBrushPoints(origin, 1, {mode: "rectangle", anchor})).toHaveLength(4);
    });

    it("filters invalid placements for occupied footprints", () => {
        const scene = new THREE.Scene();
        const first = createQuickBuildObject("ground");
        first.position.set(0, 0, 0);
        scene.add(first);

        const points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0)];

        expect(getPlaceableQuickBuildPoints(scene, "ground", points, 1).map(point => point.toArray())).toEqual([
            [1, 0, 0],
        ]);
        expect(getPlaceableQuickBuildPoints(scene, "tree", points, 1).map(point => point.toArray())).toEqual([
            [0, 0, 0],
            [1, 0, 0],
        ]);
        expect(getPlaceableQuickBuildPoints(scene, "rock", points, 1).map(point => point.toArray())).toEqual([
            [0, 0, 0],
            [1, 0, 0],
        ]);
        expect(findQuickBuildObjectAtPoint(scene, "ground", new THREE.Vector3(0, 0, 0), 1)).toBe(first);
        expect(findQuickBuildObjectAtPoint(scene, "tree", new THREE.Vector3(0, 0, 0), 1)).toBeNull();
        expect(findQuickBuildObjectAtPoint(scene, "rock", new THREE.Vector3(0, 0, 0), 1)).toBeNull();
    });

    it("places structures and fence segments at sub-tile resolution", () => {
        const scene = new THREE.Scene();
        const ground = createQuickBuildObject("ground");
        scene.add(ground);

        expect(getPlaceableQuickBuildPoints(scene, "house", [new THREE.Vector3(0.6, 0, 0.6)], 4)
            .map(point => point.toArray())).toEqual([[0.5, 0, 0.5]]);
        expect(getPlaceableQuickBuildPoints(scene, "fence", [new THREE.Vector3(1.2, 0, 0.4)], 4)
            .map(point => point.toArray())).toEqual([[1, 0, 0]]);
        expect(getPlaceableQuickBuildPoints(scene, "ground", [new THREE.Vector3(2.1, 0, 0.4)], 4)
            .map(point => point.toArray())).toEqual([[4, 0, 0]]);
    });

    it("allows structures over terrain but rejects overlapping structure footprints", () => {
        const scene = new THREE.Scene();
        const ground = createQuickBuildObject("ground");
        const house = createQuickBuildObject("house");
        house.position.set(0.5, 0, 0.5);
        scene.add(ground, house);

        const candidates = getQuickBuildPlacementCandidates(scene, "house", [
            new THREE.Vector3(0.9, 0, 0.6),
            new THREE.Vector3(4, 0, 0),
        ], 4);

        expect(candidates[0]).toMatchObject({valid: false, reason: "overlap"});
        expect(candidates[1]).toMatchObject({valid: true});
        expect(findQuickBuildObjectAtPoint(scene, "house", new THREE.Vector3(0.6, 0, 0.6), 4)).toBe(house);
        expect(findAnyQuickBuildObjectAtPoint(scene, new THREE.Vector3(0.6, 0, 0.6), 4)).toBe(house);
    });

    it("does not treat stackable props in the same cell as duplicate cleanup targets", () => {
        const scene = new THREE.Scene();
        const first = createQuickBuildObject("tree");
        const second = createQuickBuildObject("tree");
        first.position.set(0, 0, 0);
        second.position.set(0.2, 0, 0.2);
        scene.add(first, second);

        expect(findQuickBuildDuplicateGroups(scene, 1)).toEqual([]);
        expect(getQuickBuildDuplicateRemovalTargets(scene, 1)).toEqual([]);
    });

    it("finds the nearest quick build object inside the erase tolerance", () => {
        const scene = new THREE.Scene();
        const ground = createQuickBuildObject("ground");
        const water = createQuickBuildObject("water");
        ground.position.set(0, 0, 0);
        water.position.set(4, 0, 0);
        scene.add(ground, water);

        expect(findNearestQuickBuildObjectNearPoint(scene, new THREE.Vector3(1.9, 0, 0), 4)).toBe(ground);
        expect(findNearestQuickBuildObjectNearPoint(scene, new THREE.Vector3(3.1, 0, 0), 4)).toBe(water);
        expect(findNearestQuickBuildObjectNearPoint(scene, new THREE.Vector3(8, 0, 0), 4)).toBeNull();
    });

    it("refreshes path adjacency and visible arms", () => {
        const scene = new THREE.Scene();
        const center = createQuickBuildObject("path");
        const east = createQuickBuildObject("path");
        const south = createQuickBuildObject("path");
        east.position.set(1, 0, 0);
        south.position.set(0, 0, 1);
        scene.add(center, east, south);

        const updates = refreshQuickBuildAdjacency(scene, 1);
        const centerMetadata = center.userData.quickBuild;

        expect(updates).toHaveLength(3);
        expect(centerMetadata.connections).toMatchObject({north: false, east: true, south: true, west: false});

        const eastArm = center.children.find(child => child.userData.quickBuildPart === "path-east");
        const southArm = center.children.find(child => child.userData.quickBuildPart === "path-south");
        const westArm = center.children.find(child => child.userData.quickBuildPart === "path-west");
        expect(eastArm?.visible).toBe(true);
        expect(southArm?.visible).toBe(true);
        expect(westArm?.visible).toBe(false);
    });

    it("does not auto-connect fences like path terrain", () => {
        const scene = new THREE.Scene();
        const center = createQuickBuildObject("fence");
        const east = createQuickBuildObject("fence");
        const south = createQuickBuildObject("fence");
        east.position.set(1, 0, 0);
        south.position.set(0, 0, 1);
        scene.add(center, east, south);

        const updates = refreshQuickBuildAdjacency(scene, 1);

        expect(updates).toEqual([]);
        expect(center.userData.quickBuild.connections).toBeUndefined();
        expect(center.children.every(child => child.visible)).toBe(true);
    });

    it("creates export payloads for visible quick build objects", () => {
        const scene = new THREE.Scene();
        const house = createQuickBuildObject("house", {variantId: "house-cabin"});
        const hiddenRock = createQuickBuildObject("rock");
        hiddenRock.visible = false;
        house.position.set(2, 0, 3);
        scene.add(house, hiddenRock);

        const payload = createQuickBuildExportPayload(scene);

        expect(payload.schema).toBe("stem.quickBuild.v1");
        expect(payload.counts.house).toBe(1);
        expect(payload.counts.rock).toBe(0);
        expect(payload.objects).toHaveLength(1);
        expect(payload.objects[0]?.position).toEqual([2, 0, 3]);
        expect(payload.objects[0]?.variantId).toBe("house-cabin");
    });

    it("exports counts for the expanded quick build palette", () => {
        const scene = new THREE.Scene();
        for (const kind of ["sand", "stone", "bridge", "farm", "fence", "bush", "lamp"] as const) {
            scene.add(createQuickBuildObject(kind));
        }

        const payload = createQuickBuildExportPayload(scene);

        expect(payload.counts.sand).toBe(1);
        expect(payload.counts.stone).toBe(1);
        expect(payload.counts.bridge).toBe(1);
        expect(payload.counts.farm).toBe(1);
        expect(payload.counts.fence).toBe(1);
        expect(payload.counts.bush).toBe(1);
        expect(payload.counts.lamp).toBe(1);
    });

    it("creates a baked instanced batch from visible quick build objects", () => {
        const scene = new THREE.Scene();
        const first = createQuickBuildObject("tree");
        const second = createQuickBuildObject("tree");
        second.position.set(1, 0, 0);
        scene.add(first, second);

        const baked = createQuickBuildBakedBatch(scene);

        expect(baked?.userData.isQuickBuildBake).toBe(true);
        expect(baked?.userData.isStemObject).toBe(true);
        expect(baked?.userData.isSelectable).toBe(true);
        expect(baked?.userData.editorVisibility).toBe(false);
        expect(baked?.userData.gameVisibility).toBe(true);
        expect(baked?.visible).toBe(false);
        expect(baked?.userData.quickBuildBake.objectCount).toBe(2);
        expect(baked?.children.every(child => (child as THREE.InstancedMesh).isInstancedMesh)).toBe(true);
    });

    it("rebuilds a non-selectable live instanced batch and restores source mesh visibility", () => {
        const scene = new THREE.Scene();
        const path = createQuickBuildObject("path");
        const tree = createQuickBuildObject("tree");
        tree.position.set(1, 0, 0);
        scene.add(path, tree);

        const visibleSourceMeshesBefore = path.children.concat(tree.children).filter(child => child.visible);
        const live = rebuildQuickBuildLiveBatch(scene);

        expect(live?.userData.isRuntimeOnly).toBe(true);
        expect(live?.userData.isQuickBuildLiveBatch).toBe(true);
        expect(live?.userData.isSelectable).toBe(false);
        expect(live?.visible).toBe(true);
        expect(live?.children.every(child => (child as THREE.InstancedMesh).isInstancedMesh)).toBe(true);
        expect(visibleSourceMeshesBefore.every(child => child.visible === false)).toBe(true);
        expect(collectQuickBuildLiveBatchObjects(scene)).toHaveLength(1);

        const stats = analyzeQuickBuildScene(scene);
        expect(stats.liveBatchCount).toBe(1);
        expect(stats.liveInstanceCount).toBeGreaterThan(0);

        expect(clearQuickBuildLiveBatches(scene)).toBe(1);
        expect(collectQuickBuildLiveBatchObjects(scene)).toEqual([]);
        expect(visibleSourceMeshesBefore.every(child => child.visible === true)).toBe(true);
        expect(path.children.find(child => child.userData.quickBuildPart === "path-north")?.visible).toBe(false);
    });

    it("shares source resources for live batches without disposing editable meshes", () => {
        const scene = new THREE.Scene();
        const tree = createQuickBuildObject("tree");
        scene.add(tree);

        const sourceMesh = tree.children.find((child): child is THREE.Mesh => (child as THREE.Mesh).isMesh);
        expect(sourceMesh).toBeTruthy();
        const sourceMaterial = sourceMesh!.material as THREE.Material;
        const geometryDispose = vi.spyOn(sourceMesh!.geometry, "dispose");
        const materialDispose = vi.spyOn(sourceMaterial, "dispose");

        const live = rebuildQuickBuildLiveBatch(scene);
        const liveMesh = live?.children.find((child): child is THREE.InstancedMesh =>
            (child as THREE.InstancedMesh).isInstancedMesh,
        );

        expect(liveMesh).toBeTruthy();
        expect(liveMesh!.geometry).toBe(sourceMesh!.geometry);
        expect(liveMesh!.material).toBe(sourceMesh!.material);
        expect(liveMesh!.userData.quickBuildBatchOwnsResources).toBe(false);

        clearQuickBuildLiveBatches(scene);

        expect(geometryDispose).not.toHaveBeenCalled();
        expect(materialDispose).not.toHaveBeenCalled();
        expect(sourceMesh!.visible).toBe(true);
    });
});
