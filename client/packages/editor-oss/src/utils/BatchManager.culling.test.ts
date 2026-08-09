import {
  BoxGeometry,
  Frustum,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  SkinnedMesh,
  Sphere,
  Texture,
  type BatchedMesh,
} from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import global from "../global";
import BatchManager from "./BatchManager";

type BatchGroupInternals = {
  batchedMesh: BatchedMesh & { _multiDrawCount: number };
  meshes: Map<Mesh, unknown>;
  boundsDirty: boolean;
};

type BatchManagerInternals = {
  scene: Scene;
  meshDataMap: Map<
    Mesh,
    {
      batchGroup: BatchGroupInternals;
      meshData: { instanceId: number; geometryId: number };
    }
  >;
  refreshExternalSceneAnalysis(): void;
  addNewMeshesProgressively(limit: number, timeBudgetMs: number): boolean;
  retryableMeshes: Set<Mesh>;
  canBatch(mesh: Mesh): boolean;
  setSceneMeshes(meshes: Mesh[], sourceRevision?: number): void;
  updateBatchesForSceneChanges(): void;
  updateBatchedMeshes(): void;
  dispose(): void;
};

function createManager(): BatchManagerInternals {
  global.app = {
    options: { isPlayModeOnly: true },
  } as unknown as typeof global.app;
  return new BatchManager(new Scene()) as unknown as BatchManagerInternals;
}

function makeBatchPair(
  manager: BatchManagerInternals,
): [Mesh, Mesh, BatchGroupInternals] {
  const geometry = new BoxGeometry(1, 1, 1);
  const material = new MeshStandardMaterial();
  const first = new Mesh(geometry, material);
  const second = new Mesh(geometry, material);
  manager.scene.add(first, second);
  manager.scene.updateMatrixWorld(true);
  manager.setSceneMeshes([first, second], 1);
  manager.updateBatchesForSceneChanges();
  manager.updateBatchedMeshes();

  const group = manager.meshDataMap.get(first)?.batchGroup;
  expect(group).toBeDefined();
  return [first, second, group!];
}

describe("BatchManager culling and stable-scene reconciliation", () => {
  const previousApp = global.app;

  afterEach(() => {
    global.app = previousApp;
  });

  it("enables valid per-object and whole-batch frustum culling", () => {
    const manager = createManager();
    try {
      const [first, second, group] = makeBatchPair(manager);
      first.position.set(0, 0, -5);
      second.position.set(1_000, 0, -5);
      manager.scene.updateMatrixWorld(true);
      manager.updateBatchedMeshes();

      expect(group.batchedMesh.perObjectFrustumCulled).toBe(true);
      expect(group.batchedMesh.frustumCulled).toBe(true);
      expect(group.batchedMesh.sortObjects).toBe(false);

      const camera = new PerspectiveCamera(60, 1, 0.1, 100);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      const frustum = new Frustum().setFromProjectionMatrix(
        new Matrix4().multiplyMatrices(
          camera.projectionMatrix,
          camera.matrixWorldInverse,
        ),
      );
      const visibleEntry = manager.meshDataMap.get(first)!.meshData;
      const hiddenEntry = manager.meshDataMap.get(second)!.meshData;
      const visibleSphere = group.batchedMesh
        .getBoundingSphereAt(visibleEntry.geometryId, new Sphere())!
        .applyMatrix4(first.matrixWorld);
      const hiddenSphere = group.batchedMesh
        .getBoundingSphereAt(hiddenEntry.geometryId, new Sphere())!
        .applyMatrix4(second.matrixWorld);

      expect(frustum.intersectsSphere(visibleSphere)).toBe(true);
      expect(frustum.intersectsSphere(hiddenSphere)).toBe(false);
    } finally {
      manager.dispose();
    }
  });

  it("skips full reconciliation for stable static meshes in publish mode", () => {
    const manager = createManager();
    try {
      const root = new Object3D();
      root.userData.isStatic = true;
      const geometry = new BoxGeometry(1, 1, 1);
      const material = new MeshStandardMaterial();
      const mesh = new Mesh(geometry, material);
      const sibling = new Mesh(geometry, material);
      root.add(mesh, sibling);
      manager.scene.add(root);
      manager.scene.updateMatrixWorld(true);
      manager.setSceneMeshes([mesh, sibling], 1);
      manager.updateBatchesForSceneChanges();

      expect(manager.meshDataMap.has(mesh)).toBe(true);
      const canBatch = vi.spyOn(manager, "canBatch");
      manager.updateBatchedMeshes();

      expect(canBatch).not.toHaveBeenCalled();

      mesh.visible = false;
      manager.updateBatchedMeshes();
      expect(canBatch).toHaveBeenCalled();
      expect(manager.meshDataMap.has(mesh)).toBe(false);
    } finally {
      manager.dispose();
    }
  });

  it("keeps camera layers as separate batches with matching visibility masks", () => {
    const manager = createManager();
    try {
      const geometry = new BoxGeometry(1, 1, 1);
      const material = new MeshStandardMaterial();
      const layerZero = [
        new Mesh(geometry, material),
        new Mesh(geometry, material),
      ];
      const layerThree = [
        new Mesh(geometry, material),
        new Mesh(geometry, material),
      ];
      for (const mesh of layerThree) mesh.layers.set(3);
      const meshes = [...layerZero, ...layerThree];
      manager.scene.add(...meshes);
      manager.scene.updateMatrixWorld(true);
      manager.setSceneMeshes(meshes, 1);
      manager.updateBatchesForSceneChanges();
      manager.updateBatchedMeshes();

      const zeroBatch = manager.meshDataMap.get(layerZero[0]!)!.batchGroup
        .batchedMesh;
      const threeBatch = manager.meshDataMap.get(layerThree[0]!)!.batchGroup
        .batchedMesh;
      const layerZeroCamera = new PerspectiveCamera();
      const layerThreeCamera = new PerspectiveCamera();
      layerThreeCamera.layers.set(3);

      expect(zeroBatch).not.toBe(threeBatch);
      expect(zeroBatch.layers.mask).toBe(layerZero[0]!.layers.mask);
      expect(threeBatch.layers.mask).toBe(layerThree[0]!.layers.mask);
      expect(layerZeroCamera.layers.test(zeroBatch.layers)).toBe(true);
      expect(layerZeroCamera.layers.test(threeBatch.layers)).toBe(false);
      expect(layerThreeCamera.layers.test(zeroBatch.layers)).toBe(false);
      expect(layerThreeCamera.layers.test(threeBatch.layers)).toBe(true);

      layerZero[0]!.layers.set(5);
      manager.updateBatchedMeshes();
      const movedLayerBatch = manager.meshDataMap.get(layerZero[0]!)!.batchGroup
        .batchedMesh;

      expect(movedLayerBatch).not.toBe(zeroBatch);
      expect(movedLayerBatch.layers.mask).toBe(layerZero[0]!.layers.mask);
    } finally {
      manager.dispose();
    }
  });

  it("keeps authored transparent render orders in separate batches", () => {
    const manager = createManager();
    try {
      const geometry = new BoxGeometry(1, 1, 1);
      const material = new MeshStandardMaterial({
        transparent: true,
        opacity: 0.5,
      });
      const early = [
        new Mesh(geometry, material),
        new Mesh(geometry, material),
      ];
      const late = [new Mesh(geometry, material), new Mesh(geometry, material)];
      for (const mesh of early) mesh.renderOrder = 2;
      for (const mesh of late) mesh.renderOrder = 20;
      const meshes = [...early, ...late];
      manager.scene.add(...meshes);
      manager.scene.updateMatrixWorld(true);
      manager.setSceneMeshes(meshes, 1);
      manager.updateBatchesForSceneChanges();
      manager.updateBatchedMeshes();

      const earlyBatch = manager.meshDataMap.get(early[0]!)!.batchGroup
        .batchedMesh;
      const lateBatch = manager.meshDataMap.get(late[0]!)!.batchGroup
        .batchedMesh;

      expect(earlyBatch).not.toBe(lateBatch);
      expect(earlyBatch.renderOrder).toBe(2);
      expect(lateBatch.renderOrder).toBe(20);
      expect(earlyBatch.sortObjects).toBe(true);
      expect(lateBatch.sortObjects).toBe(true);

      early[0]!.renderOrder = 99;
      manager.updateBatchedMeshes();
      const reorderedBatch = manager.meshDataMap.get(early[0]!)!.batchGroup
        .batchedMesh;

      expect(reorderedBatch).not.toBe(earlyBatch);
      expect(reorderedBatch.renderOrder).toBe(99);
    } finally {
      manager.dispose();
    }
  });

  it("separates alpha-test pipelines and re-batches runtime alpha-test changes", () => {
    const manager = createManager();
    try {
      const geometry = new BoxGeometry(1, 1, 1);
      const lowCutout = new MeshStandardMaterial({ alphaTest: 0.1 });
      const highCutout = new MeshStandardMaterial({ alphaTest: 0.9 });
      const lowMeshes = [
        new Mesh(geometry, lowCutout),
        new Mesh(geometry, lowCutout),
      ];
      const highMeshes = [
        new Mesh(geometry, highCutout),
        new Mesh(geometry, highCutout),
      ];
      const meshes = [...lowMeshes, ...highMeshes];
      manager.scene.add(...meshes);
      manager.scene.updateMatrixWorld(true);
      manager.setSceneMeshes(meshes, 1);
      manager.updateBatchesForSceneChanges();
      manager.updateBatchedMeshes();

      const lowBatch = manager.meshDataMap.get(lowMeshes[0]!)!.batchGroup
        .batchedMesh;
      const highBatch = manager.meshDataMap.get(highMeshes[0]!)!.batchGroup
        .batchedMesh;
      expect(lowBatch).not.toBe(highBatch);
      expect((lowBatch.material as MeshStandardMaterial).alphaTest).toBe(0.1);
      expect((highBatch.material as MeshStandardMaterial).alphaTest).toBe(0.9);

      lowCutout.alphaTest = 0.6;
      manager.updateBatchedMeshes();
      const updatedBatch = manager.meshDataMap.get(lowMeshes[0]!)!.batchGroup
        .batchedMesh;

      expect(updatedBatch).not.toBe(lowBatch);
      expect((updatedBatch.material as MeshStandardMaterial).alphaTest).toBe(
        0.6,
      );
    } finally {
      manager.dispose();
    }
  });

  it("rejects AO materials and retries them after the AO map is cleared", () => {
    const manager = createManager();
    try {
      const geometry = new BoxGeometry(1, 1, 1);
      const material = new MeshStandardMaterial({ aoMap: new Texture() });
      const meshes = [
        new Mesh(geometry, material),
        new Mesh(geometry, material),
      ];
      manager.scene.add(...meshes);
      manager.scene.updateMatrixWorld(true);
      manager.setSceneMeshes(meshes, 1);
      manager.updateBatchesForSceneChanges();

      expect(manager.meshDataMap.size).toBe(0);
      expect(manager.retryableMeshes.has(meshes[0]!)).toBe(true);
      expect(manager.retryableMeshes.has(meshes[1]!)).toBe(true);

      material.aoMap = null;
      manager.updateBatchesForSceneChanges();
      manager.updateBatchedMeshes();

      expect(manager.meshDataMap.has(meshes[0]!)).toBe(true);
      expect(manager.meshDataMap.has(meshes[1]!)).toBe(true);
      expect(manager.retryableMeshes.has(meshes[0]!)).toBe(false);
      expect(manager.retryableMeshes.has(meshes[1]!)).toBe(false);
    } finally {
      manager.dispose();
    }
  });

  it("removes and retries retained textures after runtime UV state resets", () => {
    const manager = createManager();
    try {
      const geometry = new BoxGeometry(1, 1, 1);
      const map = new Texture();
      const material = new MeshStandardMaterial({ map });
      const meshes = [
        new Mesh(geometry, material),
        new Mesh(geometry, material),
      ];
      manager.scene.add(...meshes);
      manager.scene.updateMatrixWorld(true);
      manager.setSceneMeshes(meshes, 1);
      manager.updateBatchesForSceneChanges();
      manager.updateBatchedMeshes();
      expect(manager.meshDataMap.size).toBe(2);

      map.channel = 1;
      manager.updateBatchedMeshes();
      expect(manager.meshDataMap.size).toBe(0);
      expect(manager.retryableMeshes.size).toBe(2);

      map.channel = 0;
      manager.updateBatchesForSceneChanges();
      manager.updateBatchedMeshes();
      expect(manager.meshDataMap.size).toBe(2);

      map.offset.x = 0.25;
      manager.updateBatchedMeshes();
      expect(manager.meshDataMap.size).toBe(0);
      expect(manager.retryableMeshes.size).toBe(2);

      map.offset.set(0, 0);
      map.updateMatrix();
      manager.updateBatchesForSceneChanges();
      manager.updateBatchedMeshes();
      expect(manager.meshDataMap.size).toBe(2);
      expect(manager.retryableMeshes.size).toBe(0);
    } finally {
      manager.dispose();
    }
  });

  it("updates per-instance emissive intensity uniforms at runtime", () => {
    const manager = createManager();
    try {
      const geometry = new BoxGeometry(1, 1, 1);
      const material = new MeshStandardMaterial({
        emissive: 0x224466,
        emissiveIntensity: 1,
      });
      const meshes = [
        new Mesh(geometry, material),
        new Mesh(geometry, material),
      ];
      manager.scene.add(...meshes);
      manager.scene.updateMatrixWorld(true);
      manager.setSceneMeshes(meshes, 1);
      manager.updateBatchesForSceneChanges();
      manager.updateBatchedMeshes();
      const batchedMesh = manager.meshDataMap.get(meshes[0]!)!.batchGroup
        .batchedMesh as BatchedMesh & {
        setUniformAt?: (
          instanceId: number,
          name: string,
          value: number,
        ) => void;
      };
      const setUniformAt = vi.spyOn(batchedMesh, "setUniformAt");

      material.emissiveIntensity = 3;
      manager.updateBatchedMeshes();

      expect(setUniformAt).toHaveBeenCalledTimes(2);
      expect(setUniformAt).toHaveBeenCalledWith(
        expect.any(Number),
        "emissiveIntensity",
        3,
      );
    } finally {
      manager.dispose();
    }
  });

  it("refreshes the aggregate sphere after a dynamic instance moves", () => {
    const manager = createManager();
    try {
      const [, second, group] = makeBatchPair(manager);
      const before = group.batchedMesh.boundingSphere?.clone();
      expect(before).toBeInstanceOf(Sphere);

      second.position.set(100, 0, 0);
      manager.scene.updateMatrixWorld(true);
      manager.updateBatchedMeshes();

      const after = group.batchedMesh.boundingSphere;
      expect(group.boundsDirty).toBe(false);
      expect(after).toBeInstanceOf(Sphere);
      expect(after!.center.x + after!.radius).toBeGreaterThan(100);
      expect(after!.radius).toBeGreaterThan(before!.radius);
    } finally {
      manager.dispose();
    }
  });

  it("does not reconcile aggregate bounds for an unchanged batch", () => {
    const manager = createManager();
    try {
      const [, , group] = makeBatchPair(manager);
      const computeBoundingSphere = vi.spyOn(
        group.batchedMesh,
        "computeBoundingSphere",
      );

      manager.updateBatchedMeshes();

      expect(computeBoundingSphere).not.toHaveBeenCalled();
      expect(group.boundsDirty).toBe(false);
    } finally {
      manager.dispose();
    }
  });

  it("refreshes bounds and instance membership after a source mesh is removed", () => {
    const manager = createManager();
    try {
      const [first, second, group] = makeBatchPair(manager);
      second.position.set(100, 0, 0);
      manager.scene.updateMatrixWorld(true);
      manager.updateBatchedMeshes();
      const expandedRadius = group.batchedMesh.boundingSphere!.radius;

      manager.scene.remove(second);
      manager.setSceneMeshes([first], 2);
      manager.updateBatchesForSceneChanges();
      manager.updateBatchedMeshes();

      expect(manager.meshDataMap.has(second)).toBe(false);
      expect(group.meshes.size).toBe(1);
      expect(group.batchedMesh.boundingSphere!.radius).toBeLessThan(
        expandedRadius,
      );
    } finally {
      manager.dispose();
    }
  });

  it("excludes skeletal and morph animation while retaining movable ordinary meshes", () => {
    const manager = createManager();
    try {
      const geometry = new BoxGeometry(1, 1, 1);
      const material = new MeshStandardMaterial();
      const skinned = new SkinnedMesh(geometry, material);
      const morphed = new Mesh(geometry, material);
      morphed.morphTargetInfluences = [];
      const dynamicA = new Mesh(geometry, material);
      const dynamicB = new Mesh(geometry, material);

      expect(manager.canBatch(skinned)).toBe(false);
      expect(manager.canBatch(morphed)).toBe(false);
      expect(manager.canBatch(dynamicA)).toBe(true);

      manager.scene.add(dynamicA, dynamicB);
      manager.scene.updateMatrixWorld(true);
      manager.setSceneMeshes([dynamicA, dynamicB], 1);
      manager.updateBatchesForSceneChanges();
      manager.updateBatchedMeshes();
      const instanceId = manager.meshDataMap.get(dynamicA)!.meshData.instanceId;
      const batchedMesh =
        manager.meshDataMap.get(dynamicA)!.batchGroup.batchedMesh;

      dynamicA.position.x = 12;
      manager.scene.updateMatrixWorld(true);
      manager.updateBatchedMeshes();
      const matrix = dynamicA.matrixWorld.clone();
      batchedMesh.getMatrixAt(instanceId, matrix);

      expect(matrix.elements[12]).toBeCloseTo(12);
    } finally {
      manager.dispose();
    }
  });

  it("benchmarks only setSceneMeshes' O(1) revision fast path for an unchanged snapshot", () => {
    const manager = createManager();
    try {
      const geometry = new BoxGeometry(1, 1, 1);
      const material = new MeshStandardMaterial();
      const meshes = Array.from(
        { length: 10_000 },
        () => new Mesh(geometry, material),
      );
      manager.setSceneMeshes(meshes, 42);

      const refresh = vi.spyOn(manager, "refreshExternalSceneAnalysis");
      const progressive = vi.spyOn(manager, "addNewMeshesProgressively");
      for (let i = 0; i < 1_000; i++) {
        manager.setSceneMeshes(meshes, 42);
      }

      expect(refresh).not.toHaveBeenCalled();
      expect(progressive).not.toHaveBeenCalled();

      const revisionIterations = 100_000;
      const identityIterations = 100;
      const revisionStart = performance.now();
      for (let i = 0; i < revisionIterations; i++) {
        manager.setSceneMeshes(meshes, 42);
      }
      const revisionNsPerCall =
        ((performance.now() - revisionStart) * 1_000_000) / revisionIterations;

      const identityStart = performance.now();
      for (let i = 0; i < identityIterations; i++) {
        manager.setSceneMeshes(meshes);
      }
      const identityNsPerCall =
        ((performance.now() - identityStart) * 1_000_000) / identityIterations;

      console.info(
        `[BatchManager setSceneMeshes bench] unchanged 10k snapshot: revision=${revisionNsPerCall.toFixed(1)}ns/call, identity=${identityNsPerCall.toFixed(1)}ns/call (updateBatchedMeshes remains O(N))`,
      );
      expect(identityNsPerCall).toBeGreaterThan(revisionNsPerCall * 10);
    } finally {
      manager.dispose();
    }
  });
});
