import type {StemSpatial, OctreeHandle, SpatialIntersection, SpatialRayHit} from "./StemSpatial";

// Cached library promise so the dynamic import only fires once. The Octree
// addon ships with `three` but is only meaningful when a behavior actually
// builds an octree, so it lives in its own chunk and loads on demand.
type OctreeModule = typeof import("three/addons/math/Octree.js");
let _libPromise: Promise<OctreeModule> | null = null;
const loadLib = (): Promise<OctreeModule> => {
    if (!_libPromise) _libPromise = import("three/addons/math/Octree.js");
    return _libPromise;
};

const adaptIntersection = (
    raw: {position: import("three").Vector3; normal: import("three").Vector3; depth: number} | false | null | undefined,
): SpatialIntersection | null => {
    if (!raw) return null;
    return {position: raw.position, normal: raw.normal, depth: raw.depth};
};

const adaptRayHit = (
    raw:
        | {distance: number; position: import("three").Vector3; triangle: import("three").Vector3[]}
        | false
        | null
        | undefined,
): SpatialRayHit | null => {
    if (!raw) return null;
    return {
        distance: raw.distance,
        position: raw.position,
        triangle: [raw.triangle[0]!, raw.triangle[1]!, raw.triangle[2]!],
    };
};

const wrap = (octree: import("three/addons/math/Octree.js").Octree): OctreeHandle => {
    const handle: OctreeHandle = {
        fromGroup(group) {
            octree.fromGraphNode(group);
            return handle;
        },
        rayCast(ray) {
            return adaptRayHit(octree.rayIntersect(ray) as any);
        },
        intersectSphere(sphere) {
            return adaptIntersection(octree.sphereIntersect(sphere) as any);
        },
        intersectCapsule(capsule) {
            return adaptIntersection(octree.capsuleIntersect(capsule) as any);
        },
        getBox() {
            return octree.box!;
        },
    };
    return handle;
};

export const createSpatialInterface = (): StemSpatial => {
    return {
        async octree(): Promise<OctreeHandle> {
            const {Octree} = await loadLib();
            return wrap(new Octree());
        },
    };
};
