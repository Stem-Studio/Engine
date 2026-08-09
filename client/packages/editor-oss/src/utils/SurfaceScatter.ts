import * as THREE from "three";
import {MeshSurfaceSampler} from "three/addons/math/MeshSurfaceSampler.js";

/**
 * Options for a single scatter operation.
 */
export interface ScatterOptions {
    /** Number of instances to place. Minimum 1. */
    count: number;
    /** Random seed for reproducibility. Default 0. */
    seed?: number;
    /** When true, instances orient their local +Y to the surface normal. */
    alignToNormal?: boolean;
    /** Uniform scale applied to every instance. Default 1. */
    scale?: number;
    /** Optional random scale jitter as a multiplier on `scale`, in [1-jitter, 1+jitter]. Default 0. */
    scaleJitter?: number;
    /** Optional random rotation (radians) around the instance's up axis. Default 0. */
    rotationJitter?: number;
}

/**
 * Mulberry32-style seeded RNG. Cheap, stable across runs, suitable for
 * reproducible scatter distributions without pulling a dep.
 */
function seededRandom(seed: number): () => number {
    let state = seed | 0;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Build an InstancedMesh by scattering `source` across the surface of `target`.
 *
 * Why InstancedMesh (not BatchedMesh or a Group of meshes):
 *  - Single scene-tree node regardless of instance count — 10k grass blades
 *    don't flood the object tree.
 *  - First-class in three.js; serializes through ObjectLoader natively, so
 *    scatter results round-trip through our standard scene save/load and
 *    through the collaboration sync pipeline without custom code.
 *  - Our engine's BatchManager will still apply to it during rendering if
 *    the source geometry + material qualify.
 *
 * The returned mesh inherits `source.material` and `source.geometry`. The
 * caller is responsible for adding it to the scene via the normal command
 * path (typically `AddObjectCommand`) so undo/redo + collab sync work.
 */
export function scatterOnSurface(
    source: THREE.Mesh,
    target: THREE.Mesh,
    options: ScatterOptions,
): THREE.InstancedMesh {
    const count = Math.max(1, Math.floor(options.count));
    const seed = options.seed ?? 0;
    const alignToNormal = options.alignToNormal ?? true;
    const baseScale = options.scale ?? 1;
    const scaleJitter = options.scaleJitter ?? 0;
    const rotationJitter = options.rotationJitter ?? 0;

    if (!source.geometry || !source.geometry.attributes.position) {
        throw new Error("SurfaceScatter: source mesh has no valid geometry");
    }
    if (!target.geometry || !target.geometry.attributes.position) {
        throw new Error("SurfaceScatter: target mesh has no valid geometry");
    }

    target.updateMatrixWorld(true);

    // MeshSurfaceSampler uses vertex weights optionally — skip for v1 (uniform
    // area-weighted sampling from triangle geometry).
    const sampler = new MeshSurfaceSampler(target).build();

    // Re-seed MeshSurfaceSampler's internal Math.random path by injecting a
    // seeded RNG. The sampler calls its own random(), so we patch that for
    // this scope via a temporary override on the sampler instance.
    const rng = seededRandom(seed);
    (sampler as any).randomFunction = rng;

    const mesh = new THREE.InstancedMesh(source.geometry, source.material, count);
    mesh.name = `Scatter (${source.name || "prop"}) × ${count}`;
    mesh.userData.type = "SurfaceScatter";
    mesh.userData.scatterParams = {
        sourceUuid: source.uuid,
        targetUuid: target.uuid,
        count,
        seed,
        alignToNormal,
        scale: baseScale,
        scaleJitter,
        rotationJitter,
    };

    const position = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const spinQuaternion = new THREE.Quaternion();
    const scaleVec = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < count; i++) {
        sampler.sample(position, alignToNormal ? normal : undefined);

        // Transform sampled point from target-local to world space so the
        // scatter mesh can sit at origin while still landing on the target's
        // surface. We then store world-space transforms in the InstancedMesh.
        position.applyMatrix4(target.matrixWorld);

        if (alignToNormal) {
            // Surface normal is in target-local space; transform to world.
            normal.transformDirection(target.matrixWorld).normalize();
            quaternion.setFromUnitVectors(up, normal);
        } else {
            quaternion.identity();
        }

        if (rotationJitter > 0) {
            const spin = (rng() * 2 - 1) * rotationJitter;
            spinQuaternion.setFromAxisAngle(
                alignToNormal ? normal : up,
                spin,
            );
            quaternion.multiply(spinQuaternion);
        }

        const s = scaleJitter > 0
            ? baseScale * (1 + (rng() * 2 - 1) * scaleJitter)
            : baseScale;
        scaleVec.set(s, s, s);

        matrix.compose(position, quaternion, scaleVec);
        mesh.setMatrixAt(i, matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();

    return mesh;
}
