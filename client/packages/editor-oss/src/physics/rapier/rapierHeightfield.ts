import Rapier from "@dimforge/rapier3d-compat";

import type {NormalizedHeightfield} from "../common/heightfield";

export type RapierHeightfieldMode = "unknown" | "native" | "trimesh";

export interface RapierHeightfieldDiagnostics {
    mode: RapierHeightfieldMode;
    /** Concise native-probe failure, or null when native support is active/unknown. */
    fallbackReason: string | null;
}

/**
 * Rapier names the heightfield matrix axes differently from the shared
 * terrain payload: rows subdivide local X and columns subdivide local Z.
 * The editor's normalized payload is intentionally expressed in the mesh's
 * natural order (rows along Z, columns along X) so the Ammo/TriMesh paths can
 * consume it directly. Keep the axis conversion in one small, testable helper
 * at the native Rapier boundary. The sample buffer itself remains contiguous:
 * shared Z rows with X columns are already Rapier's column-major order once
 * the dimensions are swapped.
 */
export function getRapierHeightfieldGridDimensions(heightfield: Pick<NormalizedHeightfield, "rows" | "columns">): {
    rows: number;
    columns: number;
} {
    return {
        rows: heightfield.columns,
        columns: heightfield.rows,
    };
}

let heightfieldMode: RapierHeightfieldMode = "unknown";
let fallbackWarningLogged = false;
let heightfieldFallbackReason: string | null = null;

/**
 * The compatibility bundle currently exposes Heightfield in its JS surface,
 * but its bundled WASM may still trap from rawshape_heightfield. Keep the
 * capability decision at module scope so a scene with many terrain shapes
 * pays for one probe rather than one exception per shape.
 */
export function getRapierHeightfieldMode(): RapierHeightfieldMode {
    return heightfieldMode;
}

/** Pull-only capability state for physics diagnostics and release probes. */
export function getRapierHeightfieldDiagnostics(): RapierHeightfieldDiagnostics {
    return {
        mode: heightfieldMode,
        fallbackReason: heightfieldFallbackReason,
    };
}

/** Reset the capability cache for deterministic backend conformance tests. */
export function resetRapierHeightfieldModeForTests(): void {
    heightfieldMode = "unknown";
    fallbackWarningLogged = false;
    heightfieldFallbackReason = null;
}

export function createRapierHeightfieldShape(heightfield: NormalizedHeightfield): Rapier.Shape {
    if (heightfieldMode !== "trimesh") {
        try {
            const grid = getRapierHeightfieldGridDimensions(heightfield);
            const nativeHeightfield = new Rapier.Heightfield(
                grid.rows,
                grid.columns,
                heightfield.heightSamples,
                new Rapier.Vector3(
                    heightfield.scale.x,
                    heightfield.scale.y,
                    heightfield.scale.z,
                ),
                Rapier.HeightFieldFlags.FIX_INTERNAL_EDGES,
            );

            // Probe the actual WASM constructor. Some compatibility builds
            // instantiate the JS wrapper successfully but trap at intoRaw().
            const rawShape = nativeHeightfield.intoRaw();
            rawShape.free();
            heightfieldMode = "native";
            return nativeHeightfield;
        } catch (error) {
            heightfieldMode = "trimesh";
            heightfieldFallbackReason = error instanceof Error
                ? `${error.name}: ${error.message}`
                : String(error);
            if (!fallbackWarningLogged) {
                fallbackWarningLogged = true;
                console.warn(
                    "Rapier native heightfields unavailable; using a static triangulated terrain fallback",
                    heightfieldFallbackReason,
                );
            }
        }
    }

    return createRapierHeightfieldTriMesh(heightfield);
}

/** Build a static mesh with the same sampled surface and authored extents. */
export function createRapierHeightfieldTriMesh(heightfield: NormalizedHeightfield): Rapier.Shape {
    const vertexArray = new Float32Array(heightfield.rows * heightfield.columns * 3);
    for (let row = 0; row < heightfield.rows; row++) {
        for (let column = 0; column < heightfield.columns; column++) {
            const sampleIndex = row * heightfield.columns + column;
            const vertexIndex = sampleIndex * 3;
            vertexArray[vertexIndex] = (column / (heightfield.columns - 1) - 0.5) * heightfield.scale.x;
            vertexArray[vertexIndex + 1] = heightfield.heightSamples[sampleIndex]! * heightfield.scale.y;
            vertexArray[vertexIndex + 2] = (row / (heightfield.rows - 1) - 0.5) * heightfield.scale.z;
        }
    }

    const indexArray = new Uint32Array((heightfield.rows - 1) * (heightfield.columns - 1) * 6);
    let indexOffset = 0;
    for (let row = 0; row < heightfield.rows - 1; row++) {
        for (let column = 0; column < heightfield.columns - 1; column++) {
            const topLeft = row * heightfield.columns + column;
            const topRight = topLeft + 1;
            const bottomLeft = topLeft + heightfield.columns;
            const bottomRight = bottomLeft + 1;
            indexArray[indexOffset++] = topLeft;
            indexArray[indexOffset++] = bottomLeft;
            indexArray[indexOffset++] = topRight;
            indexArray[indexOffset++] = topRight;
            indexArray[indexOffset++] = bottomLeft;
            indexArray[indexOffset++] = bottomRight;
        }
    }
    // Match the native Heightfield's internal-edge treatment. Without this
    // flag, a probe or character crossing a grid seam can receive alternating
    // triangle normals and visibly snag on otherwise smooth terrain.
    return new Rapier.TriMesh(
        vertexArray,
        indexArray,
        Rapier.TriMeshFlags.FIX_INTERNAL_EDGES,
    );
}
