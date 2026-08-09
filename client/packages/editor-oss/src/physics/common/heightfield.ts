import {BodyShapeType, HeightfieldShape, TerrainData} from "./types";

export interface NormalizedHeightfield {
    rows: number;
    columns: number;
    heightSamples: Float32Array;
    offset: {x: number; y: number; z: number};
    scale: {x: number; y: number; z: number};
}

/**
 * Validate and normalize the shared heightfield contract before it reaches a
 * native backend. Keeping this conversion backend-neutral prevents Ammo and
 * Rapier from silently disagreeing about sample counts or dimensions.
 */
export function normalizeHeightfieldShape(shape: HeightfieldShape): NormalizedHeightfield {
    const rows = shape.rows ?? shape.sampleCount;
    const columns = shape.columns ?? shape.sampleCount;

    if (!Number.isInteger(rows) || rows < 2 || !Number.isInteger(columns) || columns < 2) {
        throw new Error(`Heightfield requires at least a 2x2 sample grid (received ${rows}x${columns})`);
    }

    const expectedLength = rows * columns;
    if (shape.heightSamples.length !== expectedLength) {
        throw new Error(
            `Heightfield sample count mismatch: expected ${expectedLength}, received ${shape.heightSamples.length}`,
        );
    }

    const heightSamples = new Float32Array(expectedLength);
    for (let i = 0; i < expectedLength; i++) {
        const sample = shape.heightSamples[i]!;
        if (!Number.isFinite(sample)) {
            throw new Error(`Heightfield sample ${i} is not finite`);
        }
        heightSamples[i] = sample;
    }

    const finiteOr = (value: number, fallback: number): number => Number.isFinite(value) ? value : fallback;
    return {
        rows,
        columns,
        heightSamples,
        offset: {
            x: finiteOr(shape.offset?.x, 0),
            y: finiteOr(shape.offset?.y, 0),
            z: finiteOr(shape.offset?.z, 0),
        },
        scale: {
            x: finiteOr(shape.scale?.x, 1),
            y: finiteOr(shape.scale?.y, 1),
            z: finiteOr(shape.scale?.z, 1),
        },
    };
}

/** Build a native-shape payload from the legacy TerrainData event. */
export function terrainDataToHeightfieldShape(data: TerrainData): HeightfieldShape {
    return {
        type: BodyShapeType.HEIGHTFIELD,
        rows: data.terrainDepth,
        columns: data.terrainWidth,
        sampleCount: data.terrainWidth,
        heightSamples: Array.from(data.heightData),
        offset: {x: 0, y: 0, z: 0},
        scale: {
            x: data.terrainWidthExtents ?? data.terrainWidth,
            y: 1,
            z: data.terrainDepthExtents ?? data.terrainDepth,
        },
    };
}
