import { Mesh, Object3D } from "three";

import { traverseObjectDepthFirst } from "@stem/editor-oss/utils/SceneTraverser";

export const getModelPolygonCount = (model: Object3D) => {
  let polygonCount = 0;

  traverseObjectDepthFirst(model, (child) => {
    if (child instanceof Mesh) {
      const geometry = child.geometry;
      const position = geometry.getAttribute("position");
      if (!position) return;
      polygonCount += geometry.index
        ? geometry.index.count / 3
        : position.count / 3;
    }
  });

  return polygonCount;
};
