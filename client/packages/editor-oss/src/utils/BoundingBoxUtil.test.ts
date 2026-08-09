import { Box3, Mesh, Object3D, SphereGeometry, BoxGeometry, MeshBasicMaterial, Vector3 } from 'three';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import BoundingBoxUtil from '../utils/BoundingBoxUtil';

const createMesh = (geometry: BoxGeometry | SphereGeometry, position: [number, number, number], visible = true) => {
  const mesh = new Mesh(geometry, new MeshBasicMaterial());
  mesh.position.set(...position);
  mesh.visible = visible;
  mesh.updateMatrixWorld(true);
  return mesh;
};

const createDeepHierarchyWithLeafMesh = (depth = 12000) => {
  const root = new Object3D();
  let cursor = root;

  for (let i = 0; i < depth; i++) {
    const child = new Object3D();
    cursor.add(child);
    cursor = child;
  }

  const leaf = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  cursor.add(leaf);

  return {root, leaf};
};

describe('BoundingBoxUtil', () => {
  let root: Object3D;

  beforeEach(() => {
    root = new Object3D();
  });

  describe('getBox()', () => {
    it('can write into a caller-provided target and clears stale extents', () => {
      const mesh = createMesh(new BoxGeometry(2, 4, 6), [1, 2, 3]);
      const target = new Box3(
        new Vector3(-100, -100, -100),
        new Vector3(100, 100, 100),
      );
      root.add(mesh);
      root.updateMatrixWorld(true);

      const box = BoundingBoxUtil.getBox(root, false, target);

      expect(box).toBe(target);
      expect(box.min.x).toBeCloseTo(0);
      expect(box.min.y).toBeCloseTo(0);
      expect(box.min.z).toBeCloseTo(0);
      expect(box.max.x).toBeCloseTo(2);
      expect(box.max.y).toBeCloseTo(4);
      expect(box.max.z).toBeCloseTo(6);
    });

    it('computes deeply nested boxes without Three recursive traversal', () => {
      const {root: deepRoot} = createDeepHierarchyWithLeafMesh();
      const traverseSpy = vi.spyOn(deepRoot, 'traverse');
      const traverseVisibleSpy = vi.spyOn(deepRoot, 'traverseVisible');

      const box = BoundingBoxUtil.getBox(deepRoot, false);

      expect(box.min.x).toBeCloseTo(-0.5);
      expect(box.max.x).toBeCloseTo(0.5);
      expect(traverseSpy).not.toHaveBeenCalled();
      expect(traverseVisibleSpy).not.toHaveBeenCalled();
    });

    it('uses iterative visible traversal when skipping invisible objects', () => {
      const visibleMesh = createMesh(new BoxGeometry(1, 1, 1), [0, 0, 0], true);
      const hiddenParent = new Object3D();
      const hiddenMesh = createMesh(new BoxGeometry(1, 1, 1), [10, 0, 0], true);
      hiddenParent.visible = false;
      hiddenParent.add(hiddenMesh);
      root.add(visibleMesh, hiddenParent);
      root.updateMatrixWorld(true);
      const traverseSpy = vi.spyOn(root, 'traverse');
      const traverseVisibleSpy = vi.spyOn(root, 'traverseVisible');

      const box = BoundingBoxUtil.getBox(root, true);

      expect(box.min.x).toBeCloseTo(-0.5);
      expect(box.max.x).toBeCloseTo(0.5);
      expect(traverseSpy).not.toHaveBeenCalled();
      expect(traverseVisibleSpy).not.toHaveBeenCalled();
    });

    it('should compute bounding box including invisible children when skipInvisible is false', () => {
      const visibleBox = new BoxGeometry(1, 1, 1);
      const invisibleBox = new BoxGeometry(1, 1, 1);
      const mesh1 = createMesh(visibleBox, [0, 0, 0], true);
      const mesh2 = createMesh(invisibleBox, [2, 0, 0], false);

      root.add(mesh1, mesh2);
      root.updateMatrixWorld(true);

      const box = BoundingBoxUtil.getBox(root, false);
      expect(box.min.x).toBeCloseTo(-0.5);
      expect(box.max.x).toBeCloseTo(2.5);
    });

    it('should skip invisible children when skipInvisible is true', () => {
      const visibleBox = new BoxGeometry(1, 1, 1);
      const invisibleBox = new BoxGeometry(1, 1, 1);
      const mesh1 = createMesh(visibleBox, [0, 0, 0], true);
      const mesh2 = createMesh(invisibleBox, [2, 0, 0], false);

      root.add(mesh1, mesh2);
      root.updateMatrixWorld(true);

      const box = BoundingBoxUtil.getBox(root, true);
      expect(box.min.x).toBeCloseTo(-0.5);
      expect(box.max.x).toBeCloseTo(0.5);
    });
  });

  describe('updateAndGetBox()', () => {
    it('updates transforms and computes deeply nested boxes in one iterative pass', () => {
      const parent = new Object3D();
      const {root: deepRoot, leaf} = createDeepHierarchyWithLeafMesh();
      parent.position.x = 10;
      leaf.position.x = 2;
      parent.add(deepRoot);
      parent.updateMatrixWorld(false);

      const box = BoundingBoxUtil.updateAndGetBox(deepRoot);

      expect(box.min.x).toBeCloseTo(11.5);
      expect(box.max.x).toBeCloseTo(12.5);
    });
  });

  describe('getBoxWithoutTransform()', () => {
    it('should ignore transforms when computing bounding box', () => {
      const mesh = createMesh(new BoxGeometry(1, 1, 1), [10, 0, 0]);
      root.add(mesh);
      root.position.set(100, 0, 0);
      root.updateMatrixWorld(true);

      const box = BoundingBoxUtil.getBoxWithoutTransform(root, false);
      expect(box.min.x).toBeCloseTo(9.5);
      expect(box.max.x).toBeCloseTo(10.5);
    });

    it('restores parent, transform, and dirty world matrices after measuring a local box', () => {
      const parent = new Object3D();
      const child = createMesh(new BoxGeometry(1, 1, 1), [2, 0, 0]);
      root.add(child);
      parent.add(root);
      root.position.set(10, 20, 30);
      root.rotation.set(0.1, 0.2, 0.3);
      root.scale.set(2, 3, 4);
      parent.updateMatrixWorld(true);
      root.matrixWorldNeedsUpdate = false;
      child.matrixWorldNeedsUpdate = false;

      const target = new Box3();

      const box = BoundingBoxUtil.getBoxWithoutTransform(root, false, target);

      expect(box).toBe(target);
      expect(box.min.x).toBeCloseTo(1.5);
      expect(box.max.x).toBeCloseTo(2.5);
      expect(root.parent).toBe(parent);
      expect(parent.children).toContain(root);
      expect(root.position.toArray()).toEqual([10, 20, 30]);
      expect(root.rotation.x).toBeCloseTo(0.1);
      expect(root.rotation.y).toBeCloseTo(0.2);
      expect(root.rotation.z).toBeCloseTo(0.3);
      expect(root.scale.toArray()).toEqual([2, 3, 4]);
      expect(root.matrixWorldNeedsUpdate).toBe(true);
      expect(child.matrixWorldNeedsUpdate).toBe(true);
    });

    it('restores deeply nested local boxes without Three recursive traversal', () => {
      const {root: deepRoot} = createDeepHierarchyWithLeafMesh();
      deepRoot.position.set(10, 20, 30);
      const traverseSpy = vi.spyOn(deepRoot, 'traverse');
      const traverseVisibleSpy = vi.spyOn(deepRoot, 'traverseVisible');

      const box = BoundingBoxUtil.getBoxWithoutTransform(deepRoot, false);

      expect(box.min.x).toBeCloseTo(-0.5);
      expect(box.max.x).toBeCloseTo(0.5);
      expect(deepRoot.position.toArray()).toEqual([10, 20, 30]);
      expect(traverseSpy).not.toHaveBeenCalled();
      expect(traverseVisibleSpy).not.toHaveBeenCalled();
    });
  });

  describe('getRadius()', () => {
    it('should compute scaled bounding sphere radius', () => {
      const mesh = createMesh(new SphereGeometry(1, 8, 8), [0, 0, 0]);
      mesh.scale.set(2, 2, 2);
      mesh.updateMatrixWorld(true);

      const radius = BoundingBoxUtil.getRadius(mesh, false);
      expect(radius).toBeCloseTo(2);
    });

    it('unions child mesh spheres for group-based models', () => {
      const left = createMesh(new SphereGeometry(1, 8, 8), [-3, 0, 0]);
      const right = createMesh(new SphereGeometry(1, 8, 8), [3, 0, 0]);
      root.add(left, right);
      root.updateMatrixWorld(true);

      expect(BoundingBoxUtil.getRadius(root)).toBeCloseTo(4);
    });

    it('computes deep hierarchy radii without recursive Three traversal', () => {
      const {root: deepRoot, leaf} = createDeepHierarchyWithLeafMesh();
      leaf.geometry.computeBoundingSphere();
      const traverseSpy = vi.spyOn(Object3D.prototype, 'traverse').mockImplementation(() => {
        throw new Error('recursive traversal must not be used');
      });
      const matrixSpy = vi.spyOn(Object3D.prototype, 'updateMatrixWorld').mockImplementation(() => {
        throw new Error('recursive matrix update must not be used');
      });

      try {
        const radius = BoundingBoxUtil.getRadiusWithoutTransform(deepRoot);

        expect(radius).toBeCloseTo(Math.sqrt(3) / 2);
        expect(traverseSpy).not.toHaveBeenCalled();
        expect(matrixSpy).not.toHaveBeenCalled();
      } finally {
        traverseSpy.mockRestore();
        matrixSpy.mockRestore();
      }
    });

    it('should return 0 for invisible object if skipInvisible is true', () => {
      const mesh = createMesh(new SphereGeometry(1, 8, 8), [0, 0, 0], false);

      const radius = BoundingBoxUtil.getRadius(mesh, true);
      expect(radius).toBe(0);
    });
  });

  describe('getRadiusWithoutTransform()', () => {
    it('should ignore transform when computing radius', () => {
      const mesh = createMesh(new SphereGeometry(1, 8, 8), [10, 0, 0]);
      mesh.scale.set(3, 3, 3);

      const radius = BoundingBoxUtil.getRadiusWithoutTransform(mesh, false);
      expect(radius).toBeCloseTo(1);
    });
  });

  describe('getCapsule()', () => {
    it('should compute capsule from bounding box', () => {
      const mesh = createMesh(new BoxGeometry(1, 4, 1), [0, 0, 0]);
      root.add(mesh);
      root.updateMatrixWorld(true);

      const capsule = BoundingBoxUtil.getCapsule(root, false);
      expect(capsule.radius).toBeCloseTo(0.5);
      expect(capsule.height).toBeCloseTo(4 - 2 * 0.5);
      expect(capsule.center.y).toBeCloseTo(0);
    });

    it('returns finite zero dimensions for geometry-less objects', () => {
      expect(BoundingBoxUtil.getCapsule(new Object3D())).toEqual({
        radius: 0,
        height: 0,
        center: {x: 0, y: 0, z: 0},
      });
    });

    it('never returns a negative cylinder height for flat wide geometry', () => {
      const mesh = createMesh(new BoxGeometry(4, 1, 4), [0, 0, 0]);

      const capsule = BoundingBoxUtil.getCapsule(mesh);

      expect(capsule.radius).toBeCloseTo(2);
      expect(capsule.height).toBe(0);
    });
  });

  describe('getCapsuleWithoutTransform()', () => {
    it('should ignore transforms when computing capsule', () => {
      const mesh = createMesh(new BoxGeometry(2, 6, 2), [10, 0, 0]);
      root.add(mesh);
      root.position.set(50, 0, 0);
      root.updateMatrixWorld(true);

      const capsule = BoundingBoxUtil.getCapsuleWithoutTransform(root, false);
      expect(capsule.radius).toBeCloseTo(1);
      expect(capsule.height).toBeCloseTo(4);
      expect(capsule.center.x).toBeCloseTo(10);
    });
  });

  describe('calculateObjectsCenter()', () => {
    it('should compute center from multiple objects with geometry', () => {
      const mesh1 = createMesh(new BoxGeometry(1, 1, 1), [-2, 0, 0]);
      const mesh2 = createMesh(new BoxGeometry(1, 1, 1), [2, 0, 0]);

      const center = BoundingBoxUtil.calculateObjectsCenter([mesh1, mesh2]);
      expect(center.x).toBeCloseTo(0);
    });

    it('should compute center from objects with no geometry', () => {
      const empty = new Object3D();
      empty.position.set(3, 0, 0);
      empty.updateMatrixWorld(true);

      const center = BoundingBoxUtil.calculateObjectsCenter([empty]);
      expect(center.x).toBeCloseTo(3);
    });

    it('can write the center into a caller-provided target', () => {
      const mesh = createMesh(new BoxGeometry(1, 1, 1), [5, 0, 0]);
      const target = new Vector3();

      const center = BoundingBoxUtil.calculateObjectsCenter([mesh], target);

      expect(center).toBe(target);
      expect(target.x).toBeCloseTo(5);
    });

    it('should reuse a scratch world-position target for geometry-less objects', () => {
      const emptyA = new Object3D();
      const emptyB = new Object3D();
      const worldPositionTargets: unknown[] = [];
      emptyA.position.set(1, 0, 0);
      emptyB.position.set(3, 0, 0);
      emptyA.updateMatrixWorld(true);
      emptyB.updateMatrixWorld(true);

      const originalGetWorldPosition = Object3D.prototype.getWorldPosition;
      vi.spyOn(emptyA, 'getWorldPosition').mockImplementation(function (this: Object3D, target) {
        worldPositionTargets.push(target);
        return originalGetWorldPosition.call(this, target);
      });
      vi.spyOn(emptyB, 'getWorldPosition').mockImplementation(function (this: Object3D, target) {
        worldPositionTargets.push(target);
        return originalGetWorldPosition.call(this, target);
      });

      const center = BoundingBoxUtil.calculateObjectsCenter([emptyA, emptyB]);

      expect(center.x).toBeCloseTo(2);
      expect(worldPositionTargets).toHaveLength(2);
      expect(worldPositionTargets[0]).toBe(worldPositionTargets[1]);
    });

    it('updates deeply nested object centers without Three recursive matrix updates', () => {
      const {root: deepRoot} = createDeepHierarchyWithLeafMesh();
      const updateMatrixWorldSpy = vi.spyOn(Object3D.prototype, 'updateMatrixWorld');

      try {
        const center = BoundingBoxUtil.calculateObjectsCenter([deepRoot]);

        expect(center.x).toBeCloseTo(0);
        expect(updateMatrixWorldSpy).not.toHaveBeenCalled();
      } finally {
        updateMatrixWorldSpy.mockRestore();
      }
    });
  });
});
