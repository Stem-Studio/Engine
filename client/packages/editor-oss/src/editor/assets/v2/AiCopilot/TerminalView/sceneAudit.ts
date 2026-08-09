import type { Object3D, Scene } from "three";

import { traverseObjectDepthFirst } from "@stem/editor-oss/utils/SceneTraverser";

export type SceneAuditLight = {
  type: string;
  name: string;
  intensity: number;
  visible: boolean;
  parent: string | null;
};

export type SceneObjectAudit = {
  objectNames: string[];
  visibleObjectNames: string[];
  renderableNames: string[];
  visibleRenderableNames: string[];
  objectCount: number;
  visibleObjectCount: number;
  renderableCount: number;
  visibleRenderableCount: number;
  meshCount: number;
  visibleMeshCount: number;
  lights: SceneAuditLight[];
};

const RENDERABLE_TYPES = new Set([
  "Mesh",
  "SkinnedMesh",
  "InstancedMesh",
  "Sprite",
  "Line",
  "LineSegments",
  "Points",
]);
const MESH_TYPES = new Set(["Mesh", "SkinnedMesh", "InstancedMesh"]);

const getObjectLabel = (object: Object3D): string =>
  object.name || `${object.type || "Object3D"}:${object.uuid || "unknown"}`;

export const collectSceneObjectAudit = (scene: Scene): SceneObjectAudit => {
  const audit: SceneObjectAudit = {
    objectNames: [],
    visibleObjectNames: [],
    renderableNames: [],
    visibleRenderableNames: [],
    objectCount: 0,
    visibleObjectCount: 0,
    renderableCount: 0,
    visibleRenderableCount: 0,
    meshCount: 0,
    visibleMeshCount: 0,
    lights: [],
  };
  const hierarchyVisibility = new WeakMap<Object3D, boolean>();

  traverseObjectDepthFirst(scene, (object) => {
    audit.objectCount++;
    if (object.name) audit.objectNames.push(object.name);

    const light = object as Object3D & {
      isLight?: boolean;
      intensity?: number;
    };
    if (light.isLight) {
      audit.lights.push({
        type: light.type,
        name: light.name,
        intensity: light.intensity ?? 0,
        visible: light.visible,
        parent: light.parent
          ? light.parent.name || light.parent.type || null
          : null,
      });
    }

    const visible =
      object.visible !== false &&
      (object.parent ? hierarchyVisibility.get(object.parent) !== false : true);
    hierarchyVisibility.set(object, visible);
    if (visible) {
      audit.visibleObjectCount++;
      audit.visibleObjectNames.push(getObjectLabel(object));
    }

    if (MESH_TYPES.has(object.type)) {
      audit.meshCount++;
      if (visible) audit.visibleMeshCount++;
    }
    if (RENDERABLE_TYPES.has(object.type)) {
      audit.renderableCount++;
      audit.renderableNames.push(getObjectLabel(object));
      if (visible) {
        audit.visibleRenderableCount++;
        audit.visibleRenderableNames.push(getObjectLabel(object));
      }
    }
  });

  return audit;
};
