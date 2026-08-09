import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import { ConvexHull } from "three/addons/math/ConvexHull.js";
import { SimplifyModifier } from "three/addons/modifiers/SimplifyModifier.js";

export interface SerializableGeometry {
    positions: Float32Array;
    indices: Uint32Array | null;
}

function vertexKey(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
}

/**
 * Unified hull computation and geometry simplification logic.
 * Used by both main thread and workers to avoid code duplication.
 * 
 * Contains:
 * - Geometry simplification (SimplifyModifier)
 * - Convex hull computation (ConvexHull)
 * - Concave hull computation (raw geometry)
 */
export class HullCompute {
    /**
     * Simplify geometries using SimplifyModifier.
     * 
     * @param geometries - Array of serializable geometries
     * @param simplifyFactor - Factor to simplify (0-1), 0 = no simplification
     * @returns Array of simplified BufferGeometry objects
     */
    static simplifyGeometries(
        geometries: SerializableGeometry[],
        simplifyFactor: number,
    ): BufferGeometry[] {
        const simplified: BufferGeometry[] = [];
        const simplifyModifier = new SimplifyModifier();

        geometries.forEach(geomData => {
            const geometry = new BufferGeometry();
            
            const positionAttribute = new BufferAttribute(geomData.positions, 3);
            geometry.setAttribute("position", positionAttribute);
            
            if (geomData.indices) {
                geometry.setIndex(new BufferAttribute(geomData.indices, 1));
            }

            let finalGeometry = geometry;

            if (simplifyFactor > 0) {
                try {
                    const targetCount = Math.floor(positionAttribute.count * simplifyFactor);
                    finalGeometry = simplifyModifier.modify(geometry, targetCount);
                    
                    // Fallback to original if simplification failed
                    if (finalGeometry.getAttribute("position").count === 0) {
                        finalGeometry = geometry;
                    }
                } catch {
                    // Keep original geometry on error
                    finalGeometry = geometry;
                }
            }

            simplified.push(finalGeometry);
        });

        return simplified;
    }
    /**
     * Compute convex hull vertices from simplified geometries.
     * 
     * @param geometries - Array of BufferGeometry objects
     * @param userShapeScale - Scale to apply to vertices
     * @param userShapeScale.x
     * @param userShapeScale.y
     * @param userShapeScale.z
     * @returns Flat array of vertices [x1, y1, z1, x2, y2, z2, ...]
     */
    static convexHull(
        geometries: BufferGeometry[],
        userShapeScale: { x: number; y: number; z: number },
    ): number[] {
        const points: Vector3[] = [];
        const seenPoints = new Set<string>();

        geometries.forEach(geometry => {
            const positionAttribute = geometry.getAttribute("position");
            for (let i = 0; i < positionAttribute.count; i++) {
                const x = positionAttribute.getX(i) * userShapeScale.x;
                const y = positionAttribute.getY(i) * userShapeScale.y;
                const z = positionAttribute.getZ(i) * userShapeScale.z;
                const key = vertexKey(x, y, z);

                if (!seenPoints.has(key)) {
                    seenPoints.add(key);
                    points.push(new Vector3(x, y, z));
                }
            }
        });

        const hull = new ConvexHull().setFromPoints(points);
        const vertices: number[] = [];
        const uniqueVertices = new Set<string>();

        // Extract unique vertices from hull faces
        hull.faces.forEach(face => {
            let edge = face.edge;
            do {
                const point = edge.head().point;
                const key = vertexKey(point.x, point.y, point.z);
                if (!uniqueVertices.has(key)) {
                    uniqueVertices.add(key);
                    vertices.push(point.x, point.y, point.z);
                }
                edge = edge.next;
            } while (edge !== face.edge);
        });

        return vertices;
    }

    /**
     * Compute concave hull vertices and indices from geometries.
     * 
     * @param geometries - Array of BufferGeometry objects
     * @param userShapeScale - Scale to apply to vertices
     * @param userShapeScale.x
     * @param userShapeScale.y
     * @param userShapeScale.z
     * @returns Object with vertices and indices arrays
     */
    static concaveHull(
        geometries: BufferGeometry[],
        userShapeScale: { x: number; y: number; z: number },
    ): { verticesArray: number[][]; indicesArray: number[][] } {
        const verticesArray: number[][] = [];
        const indicesArray: number[][] = [];

        geometries.forEach(geometry => {
            const positionAttribute = geometry.getAttribute("position");
            const currentVertices: number[] = [];

            // Extract and scale vertices
            for (let i = 0; i < positionAttribute.count; i++) {
                currentVertices.push(
                    positionAttribute.getX(i) * userShapeScale.x,
                    positionAttribute.getY(i) * userShapeScale.y,
                    positionAttribute.getZ(i) * userShapeScale.z,
                );
            }

            // Extract indices
            const currentIndices: number[] = [];
            const indexAttribute = geometry.getIndex();
            if (indexAttribute) {
                for (let i = 0; i < indexAttribute.count; i++) {
                    currentIndices.push(indexAttribute.getX(i));
                }
            }

            verticesArray.push(currentVertices);
            indicesArray.push(currentIndices);
        });

        return { verticesArray, indicesArray };
    }

}
