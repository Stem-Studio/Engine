import seedrandom from "seedrandom/seedrandom.js";
import { describe, expect, it } from "vitest";

import { EndlessTerrainGridHeight } from "./EndlessTerrainGridHeight";
import { EndlessTerrainHeight } from "./EndlessTerrainHeight";
import { processPlacementTask, type TerrainPlacementTaskMessage } from "./TerrainPlacementWorker";

/**
 *
 * @param options
 */
function createExpectedHeightFn(options: TerrainPlacementTaskMessage["options"]) {
    const terrainHeight = new EndlessTerrainHeight(
        options.seed,
        options.maxHeight,
        options.waterPercentage,
    );
    const continuousHeight = options.useEnhancedTerrain
        ? terrainHeight.getEnhancedHeightFn()
        : terrainHeight.getHeightFn();
    const gridSpacing = options.chunkSize / options.chunkSegments;
    const gridOffset = (options.chunkSize / 2) % gridSpacing;

    return new EndlessTerrainGridHeight(continuousHeight, gridSpacing, gridOffset).getHeightFn();
}

/**
 *
 * @param options
 * @param chunkX
 * @param chunkZ
 * @param objectIndex
 */
function getObjectPosition(options: TerrainPlacementTaskMessage["options"], chunkX: number, chunkZ: number, objectIndex: number) {
    const rng = seedrandom(`${options.seed}:${chunkX}:${chunkZ}:${objectIndex}`);
    const rx = rng() - 0.5;
    const rz = rng() - 0.5;

    return {
        x: (chunkX + rx) * options.chunkSize,
        z: (chunkZ + rz) * options.chunkSize,
    };
}

/**
 *
 * @param options
 * @param chunkX
 * @param chunkZ
 * @param minHeight
 * @param maxHeight
 */
function findObjectIndexInHeightRange(
    options: TerrainPlacementTaskMessage["options"],
    chunkX: number,
    chunkZ: number,
    minHeight: number,
    maxHeight: number,
) {
    const heightFn = createExpectedHeightFn(options);

    for (let objectIndex = 0; objectIndex < 200; objectIndex++) {
        const { x, z } = getObjectPosition(options, chunkX, chunkZ, objectIndex);
        const y = heightFn(x, z);
        if (y >= minHeight && y <= maxHeight) {
            return { objectIndex, x, z, y };
        }
    }

    throw new Error(`Could not find object index in height range ${minHeight}..${maxHeight}`);
}

describe("TerrainPlacementWorker", () => {
    const baseOptions: TerrainPlacementTaskMessage["options"] = {
        chunkSize: 350,
        chunkSegments: 20,
        seed: 7,
        maxHeight: 200,
        grassMaxHeight: 7,
        rockMaxHeight: 39,
        treeDensity: 50,
        rockDensity: 50,
        useEnhancedTerrain: true,
        waterPercentage: 15,
        verticalOffset: 0,
    };

    it("preserves the existing ARC4 terrain sequence", () => {
        const rng = seedrandom("7:6:-4:0");

        expect([rng(), rng(), rng(), rng()]).toEqual([
            0.5565891732010092,
            0.3116485881235938,
            0.03311567342181757,
            0.04694432360374761,
        ]);
    });

    it("matches the enhanced grid height used by the renderer", () => {
        const chunkX = 6;
        const chunkZ = -4;
        const expected = findObjectIndexInHeightRange(baseOptions, chunkX, chunkZ, baseOptions.grassMaxHeight + 0.001, Number.POSITIVE_INFINITY);
        const result = processPlacementTask({
            taskId: "height-check",
            chunkX,
            chunkZ,
            generation: 1,
            start: expected.objectIndex,
            count: 1,
            totalInChunk: 1,
            options: baseOptions,
            terrainModels: [
                { minScale: 1, maxScale: 1, terrainOffset: 0, probability: 1, type: "rock" },
            ],
        });

        expect(result.modelIndices).toHaveLength(1);
        expect(result.matrices).toHaveLength(16);
        expect(result.matrices[13]).toBeCloseTo(expected.y, 5);
    });

    it("does not place rocks in grass areas", () => {
        const options = {
            ...baseOptions,
            useEnhancedTerrain: false,
        } satisfies TerrainPlacementTaskMessage["options"];
        const chunkX = 2;
        const chunkZ = -1;
        const expected = findObjectIndexInHeightRange(options, chunkX, chunkZ, 0, options.grassMaxHeight);
        const result = processPlacementTask({
            taskId: "grass-zone-check",
            chunkX,
            chunkZ,
            generation: 1,
            start: expected.objectIndex,
            count: 1,
            totalInChunk: 1,
            options,
            terrainModels: [
                { minScale: 1, maxScale: 1, terrainOffset: 0, probability: 0.5, type: "rock" },
                { minScale: 1, maxScale: 1, terrainOffset: 0, probability: 0.5, type: "plant" },
            ],
        });

        expect(result.modelIndices).toEqual(Int32Array.from([1]));
    });

    it("applies terrain offset in world units so objects sink into terrain regardless of scale", () => {
        const chunkX = 1;
        const chunkZ = 3;
        const expected = findObjectIndexInHeightRange(baseOptions, chunkX, chunkZ, baseOptions.grassMaxHeight + 0.001, Number.POSITIVE_INFINITY);
        const result = processPlacementTask({
            taskId: "terrain-offset-check",
            chunkX,
            chunkZ,
            generation: 1,
            start: expected.objectIndex,
            count: 1,
            totalInChunk: 1,
            options: baseOptions,
            terrainModels: [
                { minScale: 2, maxScale: 2, terrainOffset: 0.75, probability: 1, type: "rock" },
            ],
        });

        expect(result.modelIndices).toHaveLength(1);
        expect(result.matrices[13]).toBeCloseTo(expected.y - 0.75, 5);
    });
});
