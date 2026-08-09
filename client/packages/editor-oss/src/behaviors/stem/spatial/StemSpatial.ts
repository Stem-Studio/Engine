/**
 * Author-facing spatial-query API. Today exposes Three.js's bundled `Octree`
 * for collision detection against scene geometry — the most common need in
 * a 3D engine. The façade is namespaced so additional spatial structures
 * (kd-tree, BVH, generic AABB index) can land alongside it without
 * disturbing the existing surface.
 *
 * Octree builds itself from a Three.js Group / scene; it doesn't take
 * arbitrary insert/remove. Use it when you have static (or rebuilt-each-
 * frame) world geometry and need fast capsule/sphere/ray queries against
 * it. For dynamic per-entity AABB queries, roll a small lookup or wait for
 * a future `erth.spatial.aabb` add-on.
 */

import type {Box3, Ray, Sphere, Vector3} from "three";
import type {Capsule} from "three/addons/math/Capsule.js";

/** Result of a sphere/capsule overlap test. */
export interface SpatialIntersection {
    /** World-space position of the deepest contact. */
    position: Vector3;
    /** Surface normal at the contact point. */
    normal: Vector3;
    /** How far the query primitive overlaps the world geometry. */
    depth: number;
}

/** Result of a ray cast against the octree. */
export interface SpatialRayHit {
    /** Distance along the ray to the first hit. */
    distance: number;
    /** World-space position where the ray meets the surface. */
    position: Vector3;
    /** Hit triangle's three vertex positions. */
    triangle: [Vector3, Vector3, Vector3];
}

export interface OctreeHandle {
    /**
     * Rebuild the octree from a Three.js scene/group. Walks every Mesh
     * descendant and indexes its geometry. Call again after the world
     * geometry changes.
     */
    fromGroup(group: import("three").Object3D): OctreeHandle;
    /**
     * Cast a ray against the indexed geometry. Returns the nearest hit, or
     * `null` when the ray misses everything.
     */
    rayCast(ray: Ray): SpatialRayHit | null;
    /**
     * Test a sphere against the indexed geometry. Returns the deepest
     * overlap or `null` when there's no contact.
     */
    intersectSphere(sphere: Sphere): SpatialIntersection | null;
    /**
     * Test a capsule against the indexed geometry. Returns the deepest
     * overlap or `null`. Capsules are the standard player/character
     * collider in this engine.
     */
    intersectCapsule(capsule: Capsule): SpatialIntersection | null;
    /** AABB of every triangle currently indexed (read-only). */
    getBox(): Box3;
}

export interface StemSpatial {
    /**
     * Build a new empty octree. Returns a Promise — the THREE.Octree addon
     * is loaded lazily on first call so the engine bundle stays small.
     * After `await`, populate via `fromGroup(group)` and the handle's other
     * methods are sync.
     */
    octree(): Promise<OctreeHandle>;
}
