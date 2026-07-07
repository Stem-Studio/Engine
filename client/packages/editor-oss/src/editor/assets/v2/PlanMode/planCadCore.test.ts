import {describe, expect, it} from "vitest";
import * as THREE from "three";

import {
    applyPlanLevelDisplayMode,
    createPlanGuideToolNode,
    createPlanItemToolNode,
    createPlanNode,
    createPlanScanToolNode,
    createPlanSceneState,
    createPlanSlabToolNode,
    createPlanWallToolNode,
    createPlanZoneToolNode,
    exportPlanSceneJson,
    getPlanCameraPreset,
    getPlanInterchangeCapabilities,
    getPlanSelectionAtDepth,
    getPlanSelectionPath,
    importPlanSceneJson,
    insertPlanNode,
    PlanSceneRegistry,
    PlanSpatialGrid,
    processDirtyPlanNodes,
    serializePlanSceneState,
    updatePlanNode,
} from "./planCadCore";

describe("planCadCore", () => {
    function createBasicPlan() {
        const site = createPlanNode("site", {id: "site_a"});
        const building = createPlanNode("building", {id: "building_a", parentId: site.id});
        const level = createPlanNode("level", {id: "level_1", parentId: building.id, elevation: 0, height: 3, index: 0});
        const state = createPlanSceneState([site, building, level]);
        return {state, site, building, level};
    }

    it("stores typed architectural nodes in a flat hierarchy", () => {
        const {state, site, building, level} = createBasicPlan();
        const wall = createPlanWallToolNode(level.id, {x: 0, z: 0}, {x: 4, z: 0}, {id: "wall_a"});
        insertPlanNode(state, wall);

        expect(state.rootNodeIds).toEqual([site.id]);
        expect(state.nodes[site.id]?.children).toEqual([building.id]);
        expect(state.nodes[building.id]?.children).toEqual([level.id]);
        expect(state.nodes[level.id]?.children).toEqual([wall.id]);
        expect(state.nodes[wall.id]?.type).toBe("wall");
        expect(state.dirtyNodeIds.has(wall.id)).toBe(true);
    });

    it("registers objects by architectural node id and type", () => {
        const {level} = createBasicPlan();
        const registry = new PlanSceneRegistry();
        const object = new THREE.Group();

        registry.register(level, object);

        expect(registry.get(level.id)).toBe(object);
        expect(registry.getByType("level")).toEqual([object]);
        expect(object.userData.planNodeId).toBe(level.id);
    });

    it("processes dirty wall nodes with generated opening cutouts", () => {
        const {state, level} = createBasicPlan();
        const wall = createPlanWallToolNode(
            level.id,
            {x: 0, z: 0},
            {x: 6, z: 0},
            {
                id: "wall_cutout",
                openings: [{id: "door_a", kind: "door", t: 0.5, width: 1, sillHeight: 0, height: 2.1}],
            },
        );
        const joinedWall = createPlanWallToolNode(level.id, {x: 6, z: 0}, {x: 6, z: 3}, {id: "wall_joined"});
        insertPlanNode(state, wall);
        insertPlanNode(state, joinedWall);

        const registry = new PlanSceneRegistry();
        const object = new THREE.Group();
        const joinedObject = new THREE.Group();
        registry.register(wall, object);
        registry.register(joinedWall, joinedObject);

        const processed = processDirtyPlanNodes(state, registry);

        expect(processed.some(item => item.id === wall.id && item.updated)).toBe(true);
        expect(object.children.length).toBeGreaterThan(1);
        expect(object.userData.planCad.openingCount).toBe(1);
        expect(object.userData.planCad.miterJoints).toEqual([
            expect.objectContaining({end: "end", connectedWallId: joinedWall.id}),
        ]);
        expect(state.dirtyNodeIds.has(wall.id)).toBe(false);
    });

    it("generates slab and item geometry from node data", () => {
        const {state, level} = createBasicPlan();
        const slab = createPlanSlabToolNode(
            level.id,
            [
                {x: 0, z: 0},
                {x: 4, z: 0},
                {x: 4, z: 4},
                {x: 0, z: 4},
            ],
            {id: "slab_a"},
        );
        const item = createPlanItemToolNode(level.id, {
            id: "item_a",
            position: {x: 2, y: 0.2, z: 2},
            dimensions: {x: 1, y: 1, z: 1},
        });
        insertPlanNode(state, slab);
        insertPlanNode(state, item);

        const registry = new PlanSceneRegistry();
        const slabMesh = new THREE.Mesh();
        const itemObject = new THREE.Group();
        registry.register(slab, slabMesh);
        registry.register(item, itemObject);

        processDirtyPlanNodes(state, registry);

        expect((slabMesh.geometry as THREE.BufferGeometry).getAttribute("position").count).toBeGreaterThan(0);
        const proxyMesh = itemObject.children[0] as THREE.Mesh;
        expect((proxyMesh.geometry as THREE.BufferGeometry).getAttribute("position").count).toBeGreaterThan(0);
        expect(itemObject.position.toArray()).toEqual([2, 0.2, 2]);
        expect(proxyMesh.position.toArray()).toEqual([0, 0.5, 0]);
    });

    it("validates floor and wall placement with spatial checks", () => {
        const {state, level} = createBasicPlan();
        const slab = createPlanSlabToolNode(level.id, [
            {x: 0, z: 0},
            {x: 4, z: 0},
            {x: 4, z: 4},
            {x: 0, z: 4},
        ]);
        const wall = createPlanWallToolNode(level.id, {x: 0, z: 0}, {x: 4, z: 0}, {id: "wall_place"});
        const item = createPlanItemToolNode(level.id, {
            id: "item_existing",
            position: {x: 1, y: 0.2, z: 1},
            dimensions: {x: 1, y: 1, z: 1},
        });
        const wallItem = createPlanItemToolNode(level.id, {
            id: "item_wall",
            placement: "wall",
            wallId: wall.id,
            wallT: 0.5,
            dimensions: {x: 1, y: 1, z: 0.1},
        });
        insertPlanNode(state, slab);
        insertPlanNode(state, wall);
        insertPlanNode(state, item);
        insertPlanNode(state, wallItem);

        const grid = new PlanSpatialGrid(state);

        expect(grid.getSlabElevationAt(level.id, 2, 2)).toBeCloseTo(0.2);
        expect(grid.canPlaceOnFloor(level.id, {x: 3, y: 0, z: 3}, {x: 0.5, y: 1, z: 0.5})).toBe(true);
        expect(grid.canPlaceOnFloor(level.id, {x: 1, y: 0, z: 1}, {x: 1, y: 1, z: 1})).toBe(false);
        expect(grid.canPlaceOnWall(wall.id, 0.1, 1, {x: 0.5, y: 1, z: 0.1})).toBe(true);
        expect(grid.canPlaceOnWall(wall.id, 0.5, 1, {x: 1, y: 1, z: 0.1})).toBe(false);
        expect(grid.getSnapLines(level.id, {x: 4.05, z: 2}, 0.1)).toEqual(expect.arrayContaining([
            expect.objectContaining({axis: "x", value: 4, sourceNodeId: slab.id}),
            expect.objectContaining({axis: "x", value: 4, sourceNodeId: wall.id}),
        ]));
    });

    it("supports hierarchical selection and level display modes", () => {
        const {state, site, building, level} = createBasicPlan();
        const item = createPlanItemToolNode(level.id, {id: "item_select"});
        insertPlanNode(state, item);

        expect(getPlanSelectionPath(state, item.id).map(node => node.id)).toEqual([
            site.id,
            building.id,
            level.id,
            item.id,
        ]);
        expect(getPlanSelectionAtDepth(state, item.id, "level")?.id).toBe(level.id);

        const upperLevel = createPlanNode("level", {id: "level_2", parentId: building.id, elevation: 3, height: 3, index: 1});
        insertPlanNode(state, upperLevel);
        const registry = new PlanSceneRegistry();
        const lowerObject = new THREE.Group();
        const upperObject = new THREE.Group();
        registry.register(level, lowerObject);
        registry.register(upperLevel, upperObject);

        applyPlanLevelDisplayMode(state, registry, "exploded");
        expect(lowerObject.position.y).toBe(0);
        expect(upperObject.position.y).toBe(4);

        applyPlanLevelDisplayMode(state, registry, "solo", upperLevel.id);
        expect(lowerObject.visible).toBe(false);
        expect(upperObject.visible).toBe(true);
    });

    it("creates floor-plan tool nodes for walls, zones, guides, scans, and items", () => {
        const parentId = "level_tools";
        expect(createPlanWallToolNode(parentId, {x: 0, z: 0}, {x: 1, z: 0}).type).toBe("wall");
        expect(createPlanZoneToolNode(parentId, [{x: 0, z: 0}, {x: 1, z: 0}, {x: 0, z: 1}]).type).toBe("zone");
        expect(createPlanGuideToolNode(parentId, "guide.png").type).toBe("guide");
        expect(createPlanScanToolNode(parentId, {url: "scan.glb"}).type).toBe("scan");
        expect(createPlanItemToolNode(parentId, {tags: ["chair"]}).tags).toEqual(["chair"]);
    });

    it("exports and imports JSON with camera/interchange metadata available", () => {
        const {state, level} = createBasicPlan();
        updatePlanNode(state, level.id, {name: "Ground Floor"});

        const json = exportPlanSceneJson(state);
        const serialized = serializePlanSceneState(state);
        const imported = importPlanSceneJson(json);
        const preset = getPlanCameraPreset("plan", [1, 0, 2]);
        const capabilities = getPlanInterchangeCapabilities();

        expect(serialized.schema).toBe("stem.planCad.v1");
        expect(serialized.nodes[level.id]?.name).toBe("Ground Floor");
        expect(imported.nodes[level.id]?.name).toBe("Ground Floor");
        expect(imported.dirtyNodeIds.has(level.id)).toBe(true);
        expect(preset.projection).toBe("orthographic");
        expect(capabilities.json).toBe("ready");
        expect(capabilities.ifc).toBe("ready");
        expect(capabilities.dxf).toBe("ready");
    });
});
