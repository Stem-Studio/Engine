import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { collectSceneObjectAudit } from "./sceneAudit";

describe("collectSceneObjectAudit", () => {
  it("computes inherited visibility in one iterative deep-scene pass", () => {
    const traverseSpy = vi.spyOn(THREE.Object3D.prototype, "traverse");
    const scene = new THREE.Scene();
    let parent: THREE.Object3D = scene;
    for (let i = 0; i < 12_000; i++) {
      const child =
        i === 11_999
          ? new THREE.Mesh(
              new THREE.BufferGeometry(),
              new THREE.MeshBasicMaterial(),
            )
          : new THREE.Object3D();
      if (i === 6_000) child.visible = false;
      parent.add(child);
      parent = child;
    }

    const audit = collectSceneObjectAudit(scene);

    expect(audit.objectCount).toBe(12_001);
    expect(audit.visibleObjectCount).toBe(6_001);
    expect(audit.meshCount).toBe(1);
    expect(audit.visibleMeshCount).toBe(0);
    expect(audit.renderableCount).toBe(1);
    expect(audit.visibleRenderableCount).toBe(0);
    expect(traverseSpy).not.toHaveBeenCalled();
  });

  it("preserves light diagnostics", () => {
    const scene = new THREE.Scene();
    const light = new THREE.DirectionalLight(0xffffff, 2.5);
    light.name = "Sun";
    scene.add(light);

    expect(collectSceneObjectAudit(scene).lights).toEqual([
      {
        type: "DirectionalLight",
        name: "Sun",
        intensity: 2.5,
        visible: true,
        parent: "Scene",
      },
    ]);
  });
});
