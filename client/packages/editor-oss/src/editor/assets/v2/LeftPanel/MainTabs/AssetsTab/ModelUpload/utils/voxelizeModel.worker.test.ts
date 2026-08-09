import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  buildVoxelGeometry,
  voxelizeInWorker,
  type VoxelColorSample,
} from "./voxelizeModel.worker";

const sample = (r: number, g: number, b: number): VoxelColorSample => ({
  r,
  g,
  b,
  count: 1,
});
const key = (x: number, y: number, z: number, resolution: number): number =>
  x + resolution * (y + resolution * z);

describe("voxelizeModel worker core", () => {
  it("emits direct typed geometry and removes only genuinely shared faces", () => {
    const resolution = 4;
    const voxels = new Map<number, VoxelColorSample>([
      [key(1, 1, 1, resolution), sample(1, 0, 0)],
      [key(2, 1, 1, resolution), sample(0, 1, 0)],
    ]);

    const full = buildVoxelGeometry(
      voxels,
      resolution,
      new THREE.Vector3(),
      1,
      false,
    );
    const culled = buildVoxelGeometry(
      voxels,
      resolution,
      new THREE.Vector3(),
      1,
      true,
    );

    expect(full.positions).toHaveLength(12 * 4 * 3);
    expect(full.colors).toHaveLength(12 * 4 * 3);
    expect(full.indices).toHaveLength(12 * 6);
    expect(culled.positions).toHaveLength(10 * 4 * 3);
    expect(culled.indices).toHaveLength(10 * 6);
  });

  it("does not alias out-of-bounds neighbor keys to valid edge voxels", () => {
    const resolution = 4;
    const voxels = new Map<number, VoxelColorSample>([
      [key(0, 1, 0, resolution), sample(1, 1, 1)],
      [key(3, 0, 0, resolution), sample(1, 1, 1)],
    ]);

    const culled = buildVoxelGeometry(
      voxels,
      resolution,
      new THREE.Vector3(),
      1,
      true,
    );

    expect(culled.indices).toHaveLength(12 * 6);
  });

  it("uses per-mesh BVH raycasting without modifying Three's global prototype", () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const position = geometry.getAttribute("position");
    const originalRaycast = THREE.Mesh.prototype.raycast;

    const result = voxelizeInWorker({
      meshes: [
        {
          positions: new Float32Array(position.array),
          indices: new Uint32Array(geometry.index!.array),
          materialColor: { r: 1, g: 1, b: 1 },
          matrix: new THREE.Matrix4().toArray(),
        },
      ],
      resolution: 2,
      removeHiddenFaces: true,
      bbox: {
        min: { x: -0.5, y: -0.5, z: -0.5 },
        max: { x: 0.5, y: 0.5, z: 0.5 },
      },
    });

    expect(THREE.Mesh.prototype.raycast).toBe(originalRaycast);
    expect(result.positions.length).toBeGreaterThan(0);
    expect(result.indices.length).toBeGreaterThan(0);
    geometry.dispose();
  });
});
