import {describe, expect, it} from "vitest";

import {
    addPlanCadOpening,
    createDefaultPlanCadData,
    createPlanCadPart,
    createPlanCadPolygonSlab,
    createPlanCadPolygonZone,
    createPlanCadWall,
    PLAN_CAD_PART_CATALOGS,
    PLAN_CAD_PART_PRESETS,
} from "./planCadEditorBridge";
import {
    exportPlanCadDxf,
    exportPlanCadIfc,
    importPlanCadDxf,
    importPlanCadIfc,
    PLAN_CAD_DXF_LAYERS,
    PLAN_CAD_IFC_TYPES,
} from "./planCadInterchange";
import type {PlanItemNode, PlanSlabNode, PlanWallNode, PlanZoneNode} from "./planCadCore";

function getNodes<T>(data: {nodes: Record<string, any>}, type: string): T[] {
    return Object.values(data.nodes).filter(node => node.type === type) as T[];
}

describe("planCadInterchange", () => {
    function createInterchangePlan() {
        let data = createDefaultPlanCadData();
        data = createPlanCadWall(data, {x: 0, z: 0}, {x: 4, z: 0});
        data = addPlanCadOpening(data, {x: 2, z: 0}, "door");
        data = createPlanCadPolygonSlab(data, [
            {x: 0, z: 0},
            {x: 4, z: 0},
            {x: 4, z: 3},
            {x: 1, z: 4},
            {x: 0, z: 3},
        ]);
        data = createPlanCadPolygonZone(data, [
            {x: 0.5, z: 0.5},
            {x: 2, z: 0.5},
            {x: 2, z: 2},
            {x: 0.5, z: 2},
        ]);
        data = createPlanCadPart(data, {x: 1, z: 1}, {partPresetId: "toilet"});
        return data;
    }

    it("exports DXF with semantic layers and round-trips full Plan/CAD data", () => {
        const data = createInterchangePlan();
        const dxf = exportPlanCadDxf(data);
        const imported = importPlanCadDxf(dxf);
        const reimported = importPlanCadDxf(exportPlanCadDxf(imported));

        expect(dxf).toContain(PLAN_CAD_DXF_LAYERS.wall);
        expect(dxf).toContain(PLAN_CAD_DXF_LAYERS.slab);
        expect(dxf).toContain("STEM_PLAN_CAD_JSON");
        expect(reimported).toEqual(imported);
        expect(getNodes<PlanWallNode>(imported, "wall")[0]?.openings).toHaveLength(1);
        expect(getNodes<PlanSlabNode>(imported, "slab")[0]?.points).toHaveLength(5);
        expect(getNodes<PlanZoneNode>(imported, "zone")[0]?.points).toHaveLength(4);
        expect(getNodes<PlanItemNode>(imported, "item")[0]?.name).toBe("Toilet");
    });

    it("imports basic DXF wall and polygon geometry without embedded payload", () => {
        const dxf = [
            "0", "SECTION",
            "2", "ENTITIES",
            "0", "LINE",
            "8", PLAN_CAD_DXF_LAYERS.wall,
            "10", "0",
            "20", "0",
            "11", "5",
            "21", "0",
            "0", "LWPOLYLINE",
            "8", PLAN_CAD_DXF_LAYERS.slab,
            "90", "4",
            "70", "1",
            "10", "0",
            "20", "0",
            "10", "5",
            "20", "0",
            "10", "5",
            "20", "4",
            "10", "0",
            "20", "4",
            "0", "ENDSEC",
            "0", "EOF",
        ].join("\n");

        const imported = importPlanCadDxf(dxf);

        expect(getNodes<PlanWallNode>(imported, "wall")[0]?.end.x).toBe(5);
        expect(getNodes<PlanSlabNode>(imported, "slab")[0]?.points).toHaveLength(4);
    });

    it("exports IFC semantic entity types and round-trips full Plan/CAD data", () => {
        const data = createInterchangePlan();
        const ifc = exportPlanCadIfc(data);
        const imported = importPlanCadIfc(ifc);
        const reimported = importPlanCadIfc(exportPlanCadIfc(imported));

        expect(ifc).toContain("FILE_SCHEMA(('IFC4'))");
        expect(ifc).toContain(PLAN_CAD_IFC_TYPES.wall);
        expect(ifc).toContain(PLAN_CAD_IFC_TYPES.slab);
        expect(reimported).toEqual(imported);
        expect(getNodes<PlanWallNode>(imported, "wall")[0]?.openings).toHaveLength(1);
        expect(getNodes<PlanItemNode>(imported, "item")[0]?.tags).toContain("bathroom");
    });

    it("imports basic semantic IFC entities without an embedded Stem payload", () => {
        const ifc = [
            "ISO-10303-21;",
            "DATA;",
            "#1=IFCWALLSTANDARDCASE('wall_guid',$,'North Wall',$,$,$,$,$,$);",
            "#2=IFCSLAB('slab_guid',$,'Ground Slab',$,$,$,$,$,.FLOOR.);",
            "#3=IFCSPACE('space_guid',$,'Studio',$,$,$,$,$,$,$);",
            "#4=IFCFURNISHINGELEMENT('desk_guid',$,'Reception Desk',$,$,$,$,$);",
            "ENDSEC;",
            "END-ISO-10303-21;",
        ].join("\n");

        const imported = importPlanCadIfc(ifc);

        expect(getNodes<PlanWallNode>(imported, "wall")[0]?.name).toBe("North Wall");
        expect(getNodes<PlanSlabNode>(imported, "slab")[0]?.name).toBe("Ground Slab");
        expect(getNodes<PlanZoneNode>(imported, "zone")[0]?.name).toBe("Studio");
        expect(getNodes<PlanItemNode>(imported, "item")[0]?.name).toBe("Reception Desk");
        expect(getNodes<PlanItemNode>(imported, "item")[0]?.tags).toEqual(["ifc", "imported"]);
    });

    it("rejects malformed interchange files with no supported entities", () => {
        expect(() => importPlanCadDxf("0\nSECTION\n2\nENTITIES\n0\nEOF")).toThrow(
            "DXF import found no supported",
        );
        expect(() => importPlanCadIfc("ISO-10303-21;\nDATA;\nENDSEC;")).toThrow(
            "IFC import found no supported",
        );
    });

    it("rejects malformed embedded Plan/CAD payloads with a controlled error", () => {
        const malformedPayload = "STEM_PLAN_CAD_JSON %E0%A4%A";

        expect(() => importPlanCadDxf(`999\n${malformedPayload}\n0\nEOF`)).toThrow(
            "Plan/CAD import has a malformed embedded payload",
        );
        expect(() => importPlanCadIfc(`ISO-10303-21;\nDATA;\n/* ${malformedPayload} */\nENDSEC;`)).toThrow(
            "Plan/CAD import has a malformed embedded payload",
        );
    });

    it("ships a reusable categorized BIM part catalog", () => {
        expect(PLAN_CAD_PART_CATALOGS.map(category => category.id)).toEqual([
            "furniture",
            "casework",
            "fixtures",
            "mep",
        ]);
        expect(PLAN_CAD_PART_PRESETS.length).toBeGreaterThanOrEqual(12);
        expect(PLAN_CAD_PART_PRESETS.some(preset => preset.id === "electrical_panel")).toBe(true);
        expect(PLAN_CAD_PART_PRESETS.some(preset => preset.id === "toilet")).toBe(true);
        expect(PLAN_CAD_PART_PRESETS.every(preset => preset.source?.type === "procedural")).toBe(true);
        expect(PLAN_CAD_PART_PRESETS.every(preset => preset.source?.presetId === preset.id)).toBe(true);
        expect(PLAN_CAD_PART_PRESETS.every(preset => !!preset.source?.modelKind)).toBe(true);
    });
});
