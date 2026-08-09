import {Material, Mesh, MeshBasicMaterial, Object3D, Scene, SphereGeometry, Vector3} from "three";
import {traverseObjectDepthFirst} from "./SceneTraverser";
export interface GeometricSnapSettings {
    snapToVertex: boolean;
    snapToEdge: boolean;
    snapToFace: boolean;
    snapDistance: number;
    visualFeedback: boolean;
}

export interface SnapResult {
    position: Vector3;
    type: "vertex" | "edge" | "face";
    target: Object3D;
    normal?: Vector3;
}

/**
 * GeometricSnapHelper - Provides vertex/edge/face snapping for object transforms
 *
 * Phase 4 MVP: Vertex snapping only
 * Phase 5: Edge and face snapping
 */
export class GeometricSnapHelper {
    private static readonly EMPTY_VERTICES = new Float32Array(0);

    private scene: Scene;
    private sceneHelpers: Object3D;
    private settings: GeometricSnapSettings;
    private snapIndicator: Mesh | null = null;
    private vertexCache: Map<string, Float32Array> = new Map();
    private cacheTimestamps: Map<string, number> = new Map();
    private excludedObjects: Set<Object3D> = new Set();
    private closestVertexPosition = new Vector3();
    private readonly vertexScratch = new Vector3();
    private readonly meshWorldSphereCenter = new Vector3();
    private readonly CACHE_MAX_SIZE = 100;
    private readonly CACHE_INVALIDATION_TIME = 5000; // 5 seconds

    constructor(
        scene: Scene,
        sceneHelpers: Object3D,
        settings: GeometricSnapSettings,
    ) {
        this.scene = scene;
        this.sceneHelpers = sceneHelpers;
        this.settings = settings;

        if (settings.visualFeedback) {
            this.createSnapIndicator();
        }
    }

    /**
     * Update snap settings
     * @param settings
     */
    updateSettings(settings: GeometricSnapSettings): void {
        this.settings = settings;

        if (settings.visualFeedback && !this.snapIndicator) {
            this.createSnapIndicator();
        } else if (!settings.visualFeedback && this.snapIndicator) {
            this.hideSnapIndicator();
        }
    }

    /**
     * Find the closest snap target for a given position
     * @param position
     * @param excludeObjects
     */
    findSnapTarget(
        position: Vector3,
        excludeObjects: Object3D[],
    ): SnapResult | null {
        let closestSnap: SnapResult | null = null;
        let minDistanceSq = this.settings.snapDistance * this.settings.snapDistance;

        // Priority: vertex > edge > face (MVP: vertex only)

        // 1. Vertex snapping
        if (this.settings.snapToVertex) {
            const vertexSnap = this.findClosestVertex(position, excludeObjects);
            if (vertexSnap && vertexSnap.distanceSq < minDistanceSq) {
                closestSnap = {
                    position: vertexSnap.position,
                    type: "vertex",
                    target: vertexSnap.object,
                };
                minDistanceSq = vertexSnap.distanceSq;
            }
        }

        // 2. Edge snapping (Phase 5 - not implemented yet)
        // if (this.settings.snapToEdge && !closestSnap) {
        //     const edgeSnap = this.findClosestEdge(position, excludeObjects);
        //     if (edgeSnap && edgeSnap.distance < minDistance) {
        //         closestSnap = {
        //             position: edgeSnap.position,
        //             type: "edge",
        //             target: edgeSnap.object,
        //         };
        //         minDistance = edgeSnap.distance;
        //     }
        // }

        // 3. Face snapping (Phase 5 - not implemented yet)
        // if (this.settings.snapToFace && !closestSnap) {
        //     const faceSnap = this.findClosestFace(position, excludeObjects);
        //     if (faceSnap && faceSnap.distance < minDistance) {
        //         closestSnap = {
        //             position: faceSnap.position,
        //             type: "face",
        //             target: faceSnap.object,
        //             normal: faceSnap.normal,
        //         };
        //     }
        // }

        // Update visual feedback
        if (closestSnap && this.settings.visualFeedback) {
            this.showSnapIndicator(closestSnap.position, closestSnap.type);
        } else if (this.settings.visualFeedback) {
            this.hideSnapIndicator();
        }

        return closestSnap;
    }

    /**
     * Find the closest vertex within snap distance
     * @param position
     * @param excludeObjects
     */
    private findClosestVertex(
        position: Vector3,
        excludeObjects: Object3D[],
    ): { position: Vector3; distanceSq: number; object: Object3D } | null {
        let closestObject: Object3D | null = null;
        let closestDistanceSq = 0;
        let minDistSq = this.settings.snapDistance * this.settings.snapDistance;
        const excludedObjects = this.buildExcludedObjectSet(excludeObjects);

        traverseObjectDepthFirst(this.scene, (object) => {
            // Skip excluded objects and non-mesh objects
            if (excludedObjects.has(object) || !(object instanceof Mesh)) {
                return;
            }

            // Skip gizmos and helpers
            if (object.userData?.tag === "gizmo" || object.name?.includes("Helper")) {
                return;
            }

            const mesh = object as Mesh;
            const geometry = mesh.geometry;

            if (!geometry || !geometry.attributes.position) {
                return;
            }

            if (!this.meshMayContainSnapTarget(mesh, position, minDistSq)) {
                return;
            }

            // Get or compute vertices
            const vertices = this.getWorldVertices(mesh);

            // Check each vertex from the packed xyz cache.
            for (let i = 0; i < vertices.length; i += 3) {
                const x = vertices[i]!;
                const y = vertices[i + 1]!;
                const z = vertices[i + 2]!;
                const dx = position.x - x;
                const dy = position.y - y;
                const dz = position.z - z;
                const distSq = dx * dx + dy * dy + dz * dz;
                if (distSq < minDistSq) {
                    minDistSq = distSq;
                    closestDistanceSq = distSq;
                    closestObject = mesh;
                    this.closestVertexPosition.set(x, y, z);
                }
            }
        });

        return closestObject
            ? {
                position: this.closestVertexPosition.clone(),
                distanceSq: closestDistanceSq,
                object: closestObject,
            }
            : null;
    }

    private buildExcludedObjectSet(excludeObjects: Object3D[]): Set<Object3D> {
        this.excludedObjects.clear();

        for (let i = 0, l = excludeObjects.length; i < l; i++) {
            const object = excludeObjects[i];
            if (!object) {
                continue;
            }
            traverseObjectDepthFirst(object, (child) => {
                this.excludedObjects.add(child);
            });
        }

        return this.excludedObjects;
    }

    private meshMayContainSnapTarget(mesh: Mesh, position: Vector3, maxDistanceSq: number): boolean {
        const geometry = mesh.geometry;
        if (!geometry) {
            return false;
        }

        if (geometry.boundingSphere === null) {
            geometry.computeBoundingSphere();
        }

        if (!geometry.boundingSphere) {
            return true;
        }

        this.meshWorldSphereCenter.copy(geometry.boundingSphere.center).applyMatrix4(mesh.matrixWorld);
        const e = mesh.matrixWorld.elements;
        const scaleXSq = e[0]! * e[0]! + e[1]! * e[1]! + e[2]! * e[2]!;
        const scaleYSq = e[4]! * e[4]! + e[5]! * e[5]! + e[6]! * e[6]!;
        const scaleZSq = e[8]! * e[8]! + e[9]! * e[9]! + e[10]! * e[10]!;
        const maxScaleSq = Math.max(scaleXSq, scaleYSq, scaleZSq);
        const radiusSq = geometry.boundingSphere.radius * geometry.boundingSphere.radius * maxScaleSq;
        const conservativeDistanceSq = 2 * radiusSq + 2 * maxDistanceSq;
        return position.distanceToSquared(this.meshWorldSphereCenter) <= conservativeDistanceSq;
    }

    /**
     * Get world-space vertices for a mesh (with caching)
     * @param mesh
     */
    private getWorldVertices(mesh: Mesh): Float32Array {
        const cacheKey = mesh.uuid;
        const now = Date.now();

        // Check cache validity
        const cachedTimestamp = this.cacheTimestamps.get(cacheKey);
        if (
            cachedTimestamp &&
            now - cachedTimestamp < this.CACHE_INVALIDATION_TIME &&
            this.vertexCache.has(cacheKey)
        ) {
            return this.vertexCache.get(cacheKey)!;
        }

        // Compute vertices
        const geometry = mesh.geometry;
        const positionAttribute = geometry.attributes.position;
        if (!positionAttribute) {
            return GeometricSnapHelper.EMPTY_VERTICES;
        }
        const vertices = new Float32Array(positionAttribute.count * 3);
        const vertex = this.vertexScratch;

        for (let i = 0; i < positionAttribute.count; i++) {
            vertex.fromBufferAttribute(positionAttribute, i);
            vertex.applyMatrix4(mesh.matrixWorld);
            const offset = i * 3;
            vertices[offset] = vertex.x;
            vertices[offset + 1] = vertex.y;
            vertices[offset + 2] = vertex.z;
        }

        // Update cache
        this.vertexCache.set(cacheKey, vertices);
        this.cacheTimestamps.set(cacheKey, now);

        // Limit cache size
        if (this.vertexCache.size > this.CACHE_MAX_SIZE) {
            // Remove oldest entry
            const oldestKey = this.cacheTimestamps.keys().next().value;
            if (oldestKey !== undefined) {
                this.vertexCache.delete(oldestKey);
                this.cacheTimestamps.delete(oldestKey);
            }
        }

        return vertices;
    }

    /**
     * Create visual indicator for snap points
     */
    private createSnapIndicator(): void {
        const geometry = new SphereGeometry(0.15, 8, 8);
        const material = new MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.7,
            depthTest: false,
        });

        this.snapIndicator = new Mesh(geometry, material);
        this.snapIndicator.visible = false;
        this.snapIndicator.userData.tag = "gizmo";
        this.snapIndicator.name = "SnapIndicator";
        this.sceneHelpers.add(this.snapIndicator);
    }

    /**
     * Show snap indicator at position with color based on type
     * @param position
     * @param type
     */
    private showSnapIndicator(
        position: Vector3,
        type: "vertex" | "edge" | "face",
    ): void {
        if (!this.snapIndicator) return;

        // Color code by type
        const colors = {
            vertex: 0x00ff00, // green
            edge: 0x0000ff, // blue
            face: 0xff00ff, // magenta
        };

        (this.snapIndicator.material as MeshBasicMaterial).color.setHex(
            colors[type],
        );
        this.snapIndicator.position.copy(position);
        this.snapIndicator.visible = true;
    }

    /**
     * Hide snap indicator
     */
    private hideSnapIndicator(): void {
        if (this.snapIndicator) {
            this.snapIndicator.visible = false;
        }
    }

    /**
     * Clear vertex cache (call when objects transform)
     */
    clearCache(): void {
        this.vertexCache.clear();
        this.cacheTimestamps.clear();
    }

    /**
     * Invalidate cache for specific object
     * @param object
     */
    invalidateObject(object: Object3D): void {
        traverseObjectDepthFirst(object, (child) => {
            this.vertexCache.delete(child.uuid);
            this.cacheTimestamps.delete(child.uuid);
        });
    }

    /**
     * Clean up resources
     */
    dispose(): void {
        this.clearCache();

        if (this.snapIndicator) {
            this.snapIndicator.geometry.dispose();
            (this.snapIndicator.material as Material).dispose();
            this.sceneHelpers.remove(this.snapIndicator);
            this.snapIndicator = null;
        }
    }
}
