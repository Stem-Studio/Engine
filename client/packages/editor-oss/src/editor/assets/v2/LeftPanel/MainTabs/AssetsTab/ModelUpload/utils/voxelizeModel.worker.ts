/// <reference no-default-lib="true"/>
/// <reference lib="webworker" />
import * as THREE from "three";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";

// Interfaces for worker message data
interface MeshData {
  positions: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  vertexColors?: Float32Array;
  indices?: Uint32Array;
  materialColor: { r: number; g: number; b: number };
  textureData?: {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  };
  matrix: number[]; // 4x4 transformation matrix
}

interface VoxelizeRequest {
  meshes: MeshData[];
  resolution: number;
  removeHiddenFaces?: boolean;
  bbox: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
}

interface VoxelizeResponse {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

export interface VoxelColorSample {
  r: number;
  g: number;
  b: number;
  count: number;
}

const FACE_DEFINITIONS = [
  {
    neighbor: [1, 0, 0],
    vertices: [
      [1, -1, 1],
      [1, -1, -1],
      [1, 1, -1],
      [1, 1, 1],
    ],
  },
  {
    neighbor: [-1, 0, 0],
    vertices: [
      [-1, -1, -1],
      [-1, -1, 1],
      [-1, 1, 1],
      [-1, 1, -1],
    ],
  },
  {
    neighbor: [0, 1, 0],
    vertices: [
      [-1, 1, 1],
      [1, 1, 1],
      [1, 1, -1],
      [-1, 1, -1],
    ],
  },
  {
    neighbor: [0, -1, 0],
    vertices: [
      [-1, -1, -1],
      [1, -1, -1],
      [1, -1, 1],
      [-1, -1, 1],
    ],
  },
  {
    neighbor: [0, 0, 1],
    vertices: [
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ],
  },
  {
    neighbor: [0, 0, -1],
    vertices: [
      [1, -1, -1],
      [-1, -1, -1],
      [-1, 1, -1],
      [1, 1, -1],
    ],
  },
] as const;

const encodeVoxelKey = (
  ix: number,
  iy: number,
  iz: number,
  resolution: number,
): number => ix + resolution * (iy + resolution * iz);

const decodeVoxelKey = (
  key: number,
  resolution: number,
): [number, number, number] => {
  const ix = key % resolution;
  const yz = (key - ix) / resolution;
  const iy = yz % resolution;
  return [ix, iy, (yz - iy) / resolution];
};

export const buildVoxelGeometry = (
  voxelColorMap: ReadonlyMap<number, VoxelColorSample>,
  resolution: number,
  bboxMin: THREE.Vector3,
  voxelSize: number,
  removeHiddenFaces: boolean,
): VoxelizeResponse => {
  const hasVoxel = (ix: number, iy: number, iz: number): boolean =>
    ix >= 0 &&
    ix < resolution &&
    iy >= 0 &&
    iy < resolution &&
    iz >= 0 &&
    iz < resolution &&
    voxelColorMap.has(encodeVoxelKey(ix, iy, iz, resolution));

  let faceCount = 0;
  for (const key of voxelColorMap.keys()) {
    const [ix, iy, iz] = decodeVoxelKey(key, resolution);
    for (const face of FACE_DEFINITIONS) {
      if (
        !removeHiddenFaces ||
        !hasVoxel(
          ix + face.neighbor[0],
          iy + face.neighbor[1],
          iz + face.neighbor[2],
        )
      ) {
        faceCount++;
      }
    }
  }

  const positions = new Float32Array(faceCount * 4 * 3);
  const colors = new Float32Array(faceCount * 4 * 3);
  const indices = new Uint32Array(faceCount * 6);
  const halfSize = voxelSize / 2;
  let vertexOffset = 0;
  let indexOffset = 0;

  for (const [key, colorData] of voxelColorMap) {
    const [ix, iy, iz] = decodeVoxelKey(key, resolution);
    const x = bboxMin.x + (ix + 0.5) * voxelSize;
    const y = bboxMin.y + (iy + 0.5) * voxelSize;
    const z = bboxMin.z + (iz + 0.5) * voxelSize;
    const r = colorData.r / colorData.count;
    const g = colorData.g / colorData.count;
    const b = colorData.b / colorData.count;

    for (const face of FACE_DEFINITIONS) {
      if (
        removeHiddenFaces &&
        hasVoxel(
          ix + face.neighbor[0],
          iy + face.neighbor[1],
          iz + face.neighbor[2],
        )
      ) {
        continue;
      }

      const firstVertex = vertexOffset / 3;
      for (const vertex of face.vertices) {
        positions[vertexOffset] = x + vertex[0] * halfSize;
        positions[vertexOffset + 1] = y + vertex[1] * halfSize;
        positions[vertexOffset + 2] = z + vertex[2] * halfSize;
        colors[vertexOffset] = r;
        colors[vertexOffset + 1] = g;
        colors[vertexOffset + 2] = b;
        vertexOffset += 3;
      }
      indices[indexOffset] = firstVertex;
      indices[indexOffset + 1] = firstVertex + 1;
      indices[indexOffset + 2] = firstVertex + 2;
      indices[indexOffset + 3] = firstVertex;
      indices[indexOffset + 4] = firstVertex + 2;
      indices[indexOffset + 5] = firstVertex + 3;
      indexOffset += 6;
    }
  }

  return { positions, colors, indices };
};

// Main voxelization function in worker
export const voxelizeInWorker = (
  request: VoxelizeRequest,
): VoxelizeResponse => {
  const { meshes, resolution, bbox, removeHiddenFaces } = request;
  const bboxMin = new THREE.Vector3(bbox.min.x, bbox.min.y, bbox.min.z);
  const bboxMax = new THREE.Vector3(bbox.max.x, bbox.max.y, bbox.max.z);
  const size = bboxMax.clone().sub(bboxMin);
  const maxDim = Math.max(size.x, size.y, size.z);
  if (
    !Number.isInteger(resolution) ||
    resolution <= 0 ||
    !Number.isFinite(maxDim) ||
    maxDim <= 0
  ) {
    throw new Error(
      "Voxelization requires a positive resolution and non-empty bounds",
    );
  }
  const voxelSize = maxDim / resolution;

  // Recreate Three.js meshes from transferred data
  // Following andstor/voxelizer approach: keep materials with texture maps
  const threeMeshes: THREE.Mesh[] = [];
  const geometryCache = new Map<ArrayBufferLike, THREE.BufferGeometry>();
  const meshTextures = new Map<
    string,
    { width: number; height: number; data: Uint8ClampedArray }
  >();

  for (const meshData of meshes) {
    let geometry = geometryCache.get(meshData.positions.buffer);
    if (!geometry) {
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(meshData.positions, 3),
      );

      if (meshData.normals) {
        geometry.setAttribute(
          "normal",
          new THREE.BufferAttribute(meshData.normals, 3),
        );
      }
      if (meshData.uvs) {
        geometry.setAttribute("uv", new THREE.BufferAttribute(meshData.uvs, 2));
      }
      if (meshData.vertexColors) {
        geometry.setAttribute(
          "color",
          new THREE.BufferAttribute(meshData.vertexColors, 3),
        );
      }
      if (meshData.indices) {
        geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
      }

      (geometry as THREE.BufferGeometry & { boundsTree?: MeshBVH }).boundsTree =
        new MeshBVH(geometry);
      geometryCache.set(meshData.positions.buffer, geometry);
    }

    const materialColor = new THREE.Color(
      meshData.materialColor.r,
      meshData.materialColor.g,
      meshData.materialColor.b,
    );
    const material = new THREE.MeshBasicMaterial({
      color: materialColor,
      side: THREE.DoubleSide,
    });

    // Create a dummy texture map if we have texture data
    // This makes the raycaster compute intersection.uv automatically
    if (meshData.textureData) {
      const textureData = new Uint8Array(meshData.textureData.data.buffer);
      const dataTexture = new THREE.DataTexture(
        textureData,
        meshData.textureData.width,
        meshData.textureData.height,
        THREE.RGBAFormat,
      );
      dataTexture.needsUpdate = true;
      material.map = dataTexture;

      // Store texture data with UUID for lookup (like andstor/voxelizer)
      meshTextures.set(dataTexture.uuid, meshData.textureData);
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.raycast = acceleratedRaycast;

    // Apply transformation matrix
    mesh.matrix.fromArray(meshData.matrix);
    mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.updateMatrixWorld(true);

    threeMeshes.push(mesh);
  }

  // Voxel color map
  const voxelColorMap = new Map<number, VoxelColorSample>();

  const addColorSample = (key: number, color: THREE.Color) => {
    const existing = voxelColorMap.get(key);
    if (existing) {
      existing.r += color.r;
      existing.g += color.g;
      existing.b += color.b;
      existing.count += 1;
    } else {
      voxelColorMap.set(key, { r: color.r, g: color.g, b: color.b, count: 1 });
    }
  };

  // BVH-accelerated raycasting voxelization
  const raycaster = new THREE.Raycaster();
  const intersections: THREE.Intersection[] = [];
  const rayOrigin = new THREE.Vector3();
  const sampledUv = new THREE.Vector2();
  const sampledColor = new THREE.Color();
  const texelColor = new THREE.Color();

  // Helper to get texel color using nearest-neighbor sampling (like andstor/voxelizer)
  const getTexelColor = (
    uv: THREE.Vector2,
    uuid: string,
    target: THREE.Color,
  ): THREE.Color => {
    const texData = meshTextures.get(uuid);
    if (!texData) {
      return target.setRGB(1, 1, 1);
    }

    const pixels = texData.data;
    const x = Math.min(
      texData.width - 1,
      Math.max(0, Math.floor(uv.x * texData.width)),
    );
    const y = Math.min(
      texData.height - 1,
      Math.max(0, Math.floor(uv.y * texData.height)),
    );
    const index = (y * texData.width + x) * 4;

    return target.setRGB(
      (pixels[index] ?? 0) / 255,
      (pixels[index + 1] ?? 0) / 255,
      (pixels[index + 2] ?? 0) / 255,
    );
  };

  // Helper function to extract color from intersection
  // Directly adapted from andstor/voxelizer ColorExtractor.getColorAtIntersect
  const getIntersectionColor = (
    intersection: THREE.Intersection,
    mesh: THREE.Mesh,
    target: THREE.Color,
  ): THREE.Color => {
    target.setRGB(1, 1, 1);
    const material = mesh.material as THREE.MeshBasicMaterial;

    // Sample texture if UV is available (raycaster provides this when material has map)
    if (intersection.uv && material.map) {
      sampledUv.copy(intersection.uv);
      if (!Number.isNaN(sampledUv.x) && !Number.isNaN(sampledUv.y)) {
        material.map.transformUv(sampledUv);
        target.multiply(
          getTexelColor(sampledUv, material.map.uuid, texelColor),
        );
      }
    }

    return target.multiply(material.color);
  };

  // Multi-point sampling offsets (center + 4 corners for better color capture)
  const sampleOffsets = [
    { dx: 0.5, dy: 0.5 }, // center
    { dx: 0.25, dy: 0.25 }, // corner 1
    { dx: 0.75, dy: 0.25 }, // corner 2
    { dx: 0.25, dy: 0.75 }, // corner 3
    { dx: 0.75, dy: 0.75 }, // corner 4
  ];

  // Cast rays from 6 directions for complete surface coverage
  const directions = [
    { dir: new THREE.Vector3(0, -1, 0), axis: "y", positive: false }, // Top to bottom
    { dir: new THREE.Vector3(0, 1, 0), axis: "y", positive: true }, // Bottom to top
    { dir: new THREE.Vector3(-1, 0, 0), axis: "x", positive: false }, // Right to left
    { dir: new THREE.Vector3(1, 0, 0), axis: "x", positive: true }, // Left to right
    { dir: new THREE.Vector3(0, 0, -1), axis: "z", positive: false }, // Front to back
    { dir: new THREE.Vector3(0, 0, 1), axis: "z", positive: true }, // Back to front
  ];

  for (const { dir, axis, positive } of directions) {
    for (let i = 0; i < resolution; i++) {
      for (let j = 0; j < resolution; j++) {
        // Multi-point sampling within each voxel cell
        for (const { dx, dy } of sampleOffsets) {
          // Set up ray origin and coordinate mapping based on direction
          if (axis === "y") {
            const x = bboxMin.x + (i + dx) * voxelSize;
            const z = bboxMin.z + (j + dy) * voxelSize;
            const y = positive ? bboxMin.y - 1 : bboxMax.y + 1;
            rayOrigin.set(x, y, z);
          } else if (axis === "x") {
            const y = bboxMin.y + (i + dx) * voxelSize;
            const z = bboxMin.z + (j + dy) * voxelSize;
            const x = positive ? bboxMin.x - 1 : bboxMax.x + 1;
            rayOrigin.set(x, y, z);
          } else {
            // axis === 'z'
            const x = bboxMin.x + (i + dx) * voxelSize;
            const y = bboxMin.y + (j + dy) * voxelSize;
            const z = positive ? bboxMin.z - 1 : bboxMax.z + 1;
            rayOrigin.set(x, y, z);
          }

          raycaster.set(rayOrigin, dir);
          intersections.length = 0;
          raycaster.intersectObjects(threeMeshes, false, intersections);

          // Consider the first 2-3 intersections for better color capture
          const maxIntersections = Math.min(3, intersections.length);
          for (let k = 0; k < maxIntersections; k++) {
            const intersection = intersections[k];
            if (!intersection) continue;
            const intersectedMesh = intersection.object as THREE.Mesh;
            let ix = i;
            let iy = i;
            let iz = j;
            if (axis === "y") {
              iy = Math.floor(
                (rayOrigin.y + dir.y * intersection.distance - bboxMin.y) /
                  voxelSize,
              );
            } else if (axis === "x") {
              ix = Math.floor(
                (rayOrigin.x + dir.x * intersection.distance - bboxMin.x) /
                  voxelSize,
              );
            } else {
              iy = j;
              iz = Math.floor(
                (rayOrigin.z + dir.z * intersection.distance - bboxMin.z) /
                  voxelSize,
              );
            }

            if (
              ix >= 0 &&
              ix < resolution &&
              iy >= 0 &&
              iy < resolution &&
              iz >= 0 &&
              iz < resolution
            ) {
              getIntersectionColor(intersection, intersectedMesh, sampledColor);
              addColorSample(
                encodeVoxelKey(ix, iy, iz, resolution),
                sampledColor,
              );
            }
          }
        }
      }
    }
  }

  // Clean up meshes
  for (const geometry of geometryCache.values()) geometry.dispose();
  for (const mesh of threeMeshes) (mesh.material as THREE.Material).dispose();

  return buildVoxelGeometry(
    voxelColorMap,
    resolution,
    bboxMin,
    voxelSize,
    Boolean(removeHiddenFaces),
  );
};

// Worker message handler
if (
  typeof WorkerGlobalScope !== "undefined" &&
  globalThis instanceof WorkerGlobalScope
) {
  globalThis.addEventListener(
    "message",
    (event: MessageEvent<VoxelizeRequest>) => {
      try {
        const result = voxelizeInWorker(event.data);

        // Transfer buffers for zero-copy performance
        postMessage(result, [
          result.positions.buffer,
          result.colors.buffer,
          result.indices.buffer,
        ]);
      } catch (error) {
        postMessage({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );
}
