import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { getModelPolygonCount } from "./getModelPolygonCount";
import { prepareVoxelizationRequest } from "./voxelizeModel";

describe("prepareVoxelizationRequest", () => {
  it("extracts interleaved attributes and bounds in one iterative deep-tree pass", async () => {
    const traverseSpy = vi.spyOn(THREE.Object3D.prototype, "traverse");
    const updateMatrixWorldSpy = vi.spyOn(
      THREE.Object3D.prototype,
      "updateMatrixWorld",
    );
    const interleaved = new THREE.InterleavedBuffer(
      new Float32Array([0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
      5,
    );
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.InterleavedBufferAttribute(interleaved, 3, 0),
    );
    geometry.setAttribute(
      "uv",
      new THREE.InterleavedBufferAttribute(interleaved, 2, 3),
    );
    geometry.setIndex([0, 1, 2]);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color: 0x336699 }),
    );
    mesh.position.set(2, 3, 4);

    const root = new THREE.Group();
    let parent: THREE.Object3D = root;
    for (let i = 0; i < 12_000; i++) {
      const child = new THREE.Object3D();
      parent.add(child);
      parent = child;
    }
    parent.add(mesh);

    const request = await prepareVoxelizationRequest(root, 16, true, {
      batchSize: Number.MAX_SAFE_INTEGER,
      frameBudgetMs: Number.MAX_SAFE_INTEGER,
    });

    expect(request.meshes).toHaveLength(1);
    expect([...request.meshes[0]!.positions]).toEqual([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
    ]);
    expect([...request.meshes[0]!.uvs!]).toEqual([0, 0, 1, 0, 0, 1]);
    expect([...request.meshes[0]!.indices!]).toEqual([0, 1, 2]);
    expect(request.bbox).toEqual({
      min: { x: 2, y: 3, z: 4 },
      max: { x: 3, y: 4, z: 4 },
    });
    expect(getModelPolygonCount(root)).toBe(1);
    expect(traverseSpy).not.toHaveBeenCalled();
    expect(updateMatrixWorldSpy).not.toHaveBeenCalled();
  });

  it("rejects invalid resolutions before starting model work", async () => {
    await expect(
      prepareVoxelizationRequest(new THREE.Group(), 0, true),
    ).rejects.toThrow("Voxel resolution must be a positive integer");
  });

  it("expands instanced meshes while sharing extracted geometry buffers", async () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const instancedMesh = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshBasicMaterial(),
      2,
    );
    instancedMesh.position.x = 2;
    instancedMesh.setMatrixAt(0, new THREE.Matrix4());
    instancedMesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(10, 0, 0));

    const request = await prepareVoxelizationRequest(instancedMesh, 16, true, {
      batchSize: Number.MAX_SAFE_INTEGER,
      frameBudgetMs: Number.MAX_SAFE_INTEGER,
    });

    expect(request.meshes).toHaveLength(2);
    expect(request.meshes[0]!.positions).toBe(request.meshes[1]!.positions);
    expect(request.meshes[0]!.indices).toBe(request.meshes[1]!.indices);
    expect(request.meshes[0]!.matrix[12]).toBe(2);
    expect(request.meshes[1]!.matrix[12]).toBe(12);
    expect(request.bbox.min.x).toBeCloseTo(1.5);
    expect(request.bbox.max.x).toBeCloseTo(12.5);
  });
});
