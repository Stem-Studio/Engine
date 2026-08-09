import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import {
  buildStructuredSceneSummary,
  calculateSerializedSize,
  canAddObject,
  estimateSizeWithNewObject,
  formatSizeInfo,
} from "./prompt";

describe("prompt context sizing", () => {
  it("updates a known serialized array size without reserializing prior objects", () => {
    const current = [{ name: "one" }, 'quoted " value'];
    const next = { name: "three", values: [1, 2, 3] };
    const currentSize = calculateSerializedSize(current);

    expect(estimateSizeWithNewObject(current, next, currentSize)).toBe(
      JSON.stringify([...current, next]).length,
    );
    expect(estimateSizeWithNewObject(current, undefined, currentSize)).toBe(
      JSON.stringify([...current, undefined]).length,
    );
  });

  it("rejects an unserializable object instead of treating its size as zero", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;

    expect(canAddObject([], circular, 2)).toBe(false);
  });

  it("reports token estimates from character count rather than digit count", () => {
    expect(formatSizeInfo(250).tokens).toBe(100);
  });
});

describe("buildStructuredSceneSummary", () => {
  it("summarizes deep scenes without Three's recursive traversal", () => {
    const traverseSpy = vi.spyOn(THREE.Object3D.prototype, "traverse");
    const scene = new THREE.Scene();
    let parent: THREE.Object3D = scene;
    for (let i = 0; i < 12_000; i++) {
      const child = new THREE.Object3D();
      if (i === 4_000) child.userData.behaviors = ["move", "jump"];
      if (i === 8_000) child.userData.physics = { enabled: true };
      parent.add(child);
      parent = child;
    }

    const summary = buildStructuredSceneSummary(scene, parent);

    expect(summary?.rootCount).toBe(1);
    expect(summary?.totalObjectCount).toBe(12_000);
    expect(summary?.behaviorCount).toBe(2);
    expect(summary?.physicsCount).toBe(1);
    expect(summary?.selectedObjects[0]?.uuid).toBe(parent.uuid);
    expect(summary?.topObjectTypes[0]).toEqual({
      type: "Object3D",
      count: 12_000,
    });
    expect(traverseSpy).not.toHaveBeenCalled();
  });
});
