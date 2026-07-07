import {describe, expect, it} from "vitest";

import {
    collectPlanCadSnapCandidates,
    formatPlanArea,
    formatPlanMeters,
    getPlanCadOpeningPlacement,
    getPlanCadToolMeasurement,
    measurePlanPolygon,
    measurePlanSegment,
    snapPlanPointToGuides,
} from "./planCadGuides";
import {
    createDefaultPlanCadData,
    createPlanCadPart,
    createPlanCadPolygonSlab,
    createPlanCadWall,
} from "./planCadEditorBridge";

describe("planCadGuides", () => {
    it("formats plan lengths and areas in the active display units", () => {
        const feet = {enabled: true, currentUnit: "feet" as const};

        expect(formatPlanMeters(3.048, feet)).toBe("10.0 ft");
        expect(formatPlanArea(9.290304, feet)).toBe("100.0 sq ft");
        expect(formatPlanMeters(3.048, {enabled: false, currentUnit: "feet"})).toBe("3.05 m");
    });

    it("collects endpoints, midpoints, polygon vertices, centers, and object centers", () => {
        let data = createDefaultPlanCadData();
        data = createPlanCadWall(data, {x: 0, z: 0}, {x: 4, z: 0});
        data = createPlanCadPolygonSlab(data, [
            {x: 0, z: 0},
            {x: 4, z: 0},
            {x: 4, z: 3},
            {x: 0, z: 3},
        ]);
        data = createPlanCadPart(data, {x: 2, z: 1.5}, {partPresetId: "desk"});

        const candidates = collectPlanCadSnapCandidates(data);

        expect(candidates.some(candidate => candidate.kind === "endpoint" && candidate.point.x === 4)).toBe(true);
        expect(candidates.some(candidate => candidate.kind === "midpoint" && candidate.point.x === 2)).toBe(true);
        expect(candidates.some(candidate => candidate.kind === "vertex" && candidate.label === "Room vertex")).toBe(true);
        expect(candidates.some(candidate => candidate.kind === "center" && candidate.label === "Object center")).toBe(true);
    });

    it("snaps to the nearest guide candidate inside the threshold", () => {
        const data = createPlanCadWall(createDefaultPlanCadData(), {x: 0, z: 0}, {x: 4, z: 0});

        const endpoint = snapPlanPointToGuides(data, {x: 3.92, z: 0.05}, 0.2);
        const miss = snapPlanPointToGuides(data, {x: 3.6, z: 0.4}, 0.2);

        expect(endpoint.snap?.label).toBe("Wall endpoint");
        expect(endpoint.point).toEqual({x: 4, z: 0});
        expect(miss.snap).toBeNull();
        expect(miss.point).toEqual({x: 3.6, z: 0.4});
    });

    it("projects door and window placement onto nearby walls only", () => {
        const data = createPlanCadWall(createDefaultPlanCadData(), {x: 0, z: 0}, {x: 4, z: 0});

        const placement = getPlanCadOpeningPlacement(data, {x: 2, z: 0.2}, undefined, 0.5);
        const farAway = getPlanCadOpeningPlacement(data, {x: 2, z: 2}, undefined, 0.5);

        expect(placement?.point).toEqual({x: 2, z: 0});
        expect(placement?.offset).toBe(2);
        expect(placement?.angleRadians).toBe(0);
        expect(farAway).toBeNull();
    });

    it("measures wall segments and polygon drafts", () => {
        const segment = measurePlanSegment({x: 0, z: 0}, {x: 4, z: 0});
        const polygon = measurePlanPolygon([
            {x: 0, z: 0},
            {x: 4, z: 0},
            {x: 4, z: 3},
            {x: 0, z: 3},
        ]);

        expect(segment.length).toBe(4);
        expect(segment.angleRadians).toBe(0);
        expect(polygon.area).toBe(12);
        expect(polygon.perimeter).toBe(14);
    });

    it("builds concise tool measurements for wall and room placement", () => {
        const wall = getPlanCadToolMeasurement({
            tool: "wall",
            anchorPoint: {x: 0, z: 0},
            currentPoint: {x: 4, z: 0},
        });
        const room = getPlanCadToolMeasurement({
            tool: "room",
            polygonPoints: [
                {x: 0, z: 0},
                {x: 4, z: 0},
                {x: 4, z: 3},
            ],
            currentPoint: {x: 0, z: 3},
        });

        expect(wall?.primary).toBe("Length 4.00 m");
        expect(wall?.secondary).toBe("Angle 0 deg");
        expect(room?.primary).toBe("Area 12.0 sq m");
        expect(room?.secondary).toBe("Perimeter 14.0 m");
    });

    it("uses display units in tool measurements", () => {
        const feet = {enabled: true, currentUnit: "feet" as const};
        const wall = getPlanCadToolMeasurement({
            tool: "wall",
            anchorPoint: {x: 0, z: 0},
            currentPoint: {x: 3.048, z: 0},
            unitsSettings: feet,
        });
        const room = getPlanCadToolMeasurement({
            tool: "room",
            polygonPoints: [
                {x: 0, z: 0},
                {x: 3.048, z: 0},
                {x: 3.048, z: 3.048},
            ],
            currentPoint: {x: 0, z: 3.048},
            unitsSettings: feet,
        });

        expect(wall?.primary).toBe("Length 10.0 ft");
        expect(room?.primary).toBe("Area 100.0 sq ft");
        expect(room?.secondary).toBe("Perimeter 40.0 ft");
    });

    it("describes opening placement as valid only when a wall target exists", () => {
        const valid = getPlanCadToolMeasurement({
            tool: "door",
            currentPoint: {x: 2, z: 0},
            openingPlacement: {
                wallId: "wall_a",
                point: {x: 2, z: 0},
                t: 0.5,
                distance: 0,
                offset: 2,
                wallLength: 4,
                angleRadians: 0,
            },
        });
        const invalid = getPlanCadToolMeasurement({
            tool: "window",
            currentPoint: {x: 2, z: 2},
            openingPlacement: null,
        });

        expect(valid?.primary).toBe("Door on wall");
        expect(valid?.secondary).toBe("2.00 m from start");
        expect(invalid?.primary).toBe("Window needs wall");
        expect(invalid?.secondary).toBe("No wall near cursor");
    });
});
