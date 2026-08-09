import { BufferAttribute, Mesh, Object3D, Vector3 } from "three";

import {
    traverseObjectDepthFirst,
    traverseObjectVisibleDepthFirst,
    updateObjectMatrixWorldDepthFirst,
} from "@stem/editor-oss/utils/SceneTraverser";
import type { SerializableGeometry } from "./hull/HullCompute";

const DEFAULT_USER_SHAPE_SCALE = { x: 1, y: 1, z: 1 } as const;

/**
 * Extract serializable geometry data from Object3D for worker processing.
 * This function traverses the object hierarchy and extracts vertex positions
 * and indices from all meshes, applying world transforms.
 */
export class GeometryExtractor {
    /**
     * Extract geometry data from an object and its children
     * 
     * @param object - The Three.js object to extract geometry from
     * @param excludeHiddenObjects - Whether to skip hidden objects
     * @param userShapeScale - Additional scale to apply to the geometry
     * @param userShapeScale.x
     * @param userShapeScale.y
     * @param userShapeScale.z
     * @returns Array of serializable geometry data
     */
    static extractGeometries(
        object: Object3D,
        excludeHiddenObjects: boolean = false,
        userShapeScale: { x: number; y: number; z: number } = DEFAULT_USER_SHAPE_SCALE,
    ): SerializableGeometry[] {
        const geometries: SerializableGeometry[] = [];

        const parent = object.parent;
        if (parent) {
            object.parent = null;
        }

        const prevPositionX = object.position.x;
        const prevPositionY = object.position.y;
        const prevPositionZ = object.position.z;
        const prevRotationX = object.rotation.x;
        const prevRotationY = object.rotation.y;
        const prevRotationZ = object.rotation.z;
        const prevRotationOrder = object.rotation.order;
        const prevScaleX = object.scale.x;
        const prevScaleY = object.scale.y;
        const prevScaleZ = object.scale.z;

        try {
            // Set to identity with only scale applied
            object.position.set(0, 0, 0);
            object.rotation.set(0, 0, 0);
            object.scale.multiply(userShapeScale);
            updateObjectMatrixWorldDepthFirst(object, true);

            // Extract geometry from all meshes
            const vertex = new Vector3();
            const traverseFn = (child: Object3D) => {
                if ((child as Mesh).isMesh && (child as Mesh).geometry) {
                    const mesh = child as Mesh;
                    const geometry = mesh.geometry;
                    const positionAttribute = geometry.getAttribute("position");

                    if (!positionAttribute || positionAttribute.count === 0) {
                        return;
                    }

                    // Extract positions with world transform
                    const positions = new Float32Array(positionAttribute.count * 3);

                    for (let i = 0; i < positionAttribute.count; i++) {
                        // Get vertex position
                        mesh.getVertexPosition(i, vertex);

                        // Apply mesh world transform
                        vertex.applyMatrix4(mesh.matrixWorld);

                        positions[i * 3] = vertex.x;
                        positions[i * 3 + 1] = vertex.y;
                        positions[i * 3 + 2] = vertex.z;
                    }

                    // Extract indices if available
                    let indices: Uint32Array | null = null;
                    const indexAttribute = geometry.getIndex();
                    if (indexAttribute) {
                        indices = new Uint32Array(indexAttribute.array as ArrayLike<number>);
                    }

                    geometries.push({ positions, indices });
                }
            };

            if (excludeHiddenObjects) {
                traverseObjectVisibleDepthFirst(object, traverseFn);
            } else {
                traverseObjectDepthFirst(object, traverseFn);
            }
        } finally {
            object.position.set(prevPositionX, prevPositionY, prevPositionZ);
            object.rotation.set(prevRotationX, prevRotationY, prevRotationZ, prevRotationOrder);
            object.scale.set(prevScaleX, prevScaleY, prevScaleZ);

            if (parent) {
                object.parent = parent;
            }
        }

        return geometries;
    }

    /**
     * Convert a BufferAttribute to a typed array suitable for worker transfer
     * @param attribute
     */
    static convertBufferAttribute(attribute: BufferAttribute): Float32Array | Uint32Array {
        if (attribute.array instanceof Float32Array || attribute.array instanceof Uint32Array) {
            return attribute.array.slice(); // Create a copy
        }

        // Convert to Float32Array if needed
        return new Float32Array(attribute.array);
    }
}
