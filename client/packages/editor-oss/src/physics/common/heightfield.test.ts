import {describe, expect, it} from "vitest";

import {normalizeHeightfieldShape, terrainDataToHeightfieldShape} from "./heightfield";
import {BodyShapeType, TerrainData} from "./types";

describe("heightfield contract", () => {
    it("normalizes rectangular sample grids without changing authored values", () => {
        const normalized = normalizeHeightfieldShape({
            type: BodyShapeType.HEIGHTFIELD,
            rows: 2,
            columns: 3,
            sampleCount: 3,
            heightSamples: [0, 1, 2, 3, 4, 5],
            offset: {x: 0, y: 0, z: 0},
            scale: {x: 12, y: 2, z: 8},
        });

        expect(normalized.rows).toBe(2);
        expect(normalized.columns).toBe(3);
        expect(Array.from(normalized.heightSamples)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(normalized.scale).toEqual({x: 12, y: 2, z: 8});
    });

    it("rejects malformed grids before a native backend is called", () => {
        expect(() => normalizeHeightfieldShape({
            type: BodyShapeType.HEIGHTFIELD,
            rows: 2,
            columns: 2,
            sampleCount: 2,
            heightSamples: [0, 1, 2],
            offset: {x: 0, y: 0, z: 0},
            scale: {x: 1, y: 1, z: 1},
        })).toThrow(/sample count mismatch/);
    });

    it("preserves TerrainUtil's authored world extents", () => {
        const data = {
            uuid: "terrain",
            terrainWidth: 3,
            terrainDepth: 2,
            terrainWidthExtents: 30,
            terrainDepthExtents: 20,
            terrainMinHeight: -4,
            terrainMaxHeight: 6,
            heightData: new Float32Array([0, 1, 2, 3, 4, 5]),
        } as TerrainData;

        expect(terrainDataToHeightfieldShape(data)).toMatchObject({
            type: BodyShapeType.HEIGHTFIELD,
            rows: 2,
            columns: 3,
            scale: {x: 30, y: 1, z: 20},
        });
    });
});
