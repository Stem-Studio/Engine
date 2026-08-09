import * as THREE from "three";

import { updateObjectMatrixWorldDepthFirst } from "@stem/editor-oss/utils/SceneTraverser";
import {
  createProgressiveYieldController,
  type ProgressiveYieldOptions,
} from "@stem/editor-oss/utils/progressiveYield";

import VoxelizeWorker from "./voxelizeModel.worker.ts?worker";

// Interfaces for worker communication
export interface MeshData {
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
  matrix: number[];
}

export interface VoxelizeRequest {
  meshes: MeshData[];
  resolution: number;
  removeHiddenFaces: boolean;
  bbox: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
}

interface VoxelizeResponse {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  error?: string;
}

type VoxelMaterial = THREE.Material & {
  color?: THREE.Color;
  emissive?: THREE.Color;
  map?: THREE.Texture;
};

/**
 * Extract texture data as Uint8ClampedArray for transfer to worker
 * @param material - The material to extract texture data from
 * @returns Texture data or undefined if no texture
 */
const extractTextureData = (
  material: THREE.Material,
): { width: number; height: number; data: Uint8ClampedArray } | undefined => {
  const mat = material as VoxelMaterial;

  if (!mat.map?.image) {
    return undefined;
  }

  try {
    const img = mat.map.image;

    // Check if it's a valid drawable type for OffscreenCanvasRenderingContext2D.drawImage()
    const isValidDrawable =
      (typeof HTMLImageElement !== "undefined" &&
        img instanceof HTMLImageElement) ||
      (typeof HTMLCanvasElement !== "undefined" &&
        img instanceof HTMLCanvasElement) ||
      (typeof HTMLVideoElement !== "undefined" &&
        img instanceof HTMLVideoElement) ||
      (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap) ||
      (typeof OffscreenCanvas !== "undefined" &&
        img instanceof OffscreenCanvas) ||
      (typeof VideoFrame !== "undefined" && img instanceof VideoFrame);

    if (!isValidDrawable) {
      return undefined;
    }

    const width = "width" in img ? img.width : 256;
    const height = "height" in img ? img.height : 256;

    if (!width || !height) {
      return undefined;
    }

    // Create an offscreen canvas to extract pixel data
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      return undefined;
    }

    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, width, height);

    return {
      width,
      height,
      data: imageData.data,
    };
  } catch (error) {
    console.warn("Failed to extract texture data:", error);
    return undefined;
  }
};

/**
 * Extract color from material
 * @param material
 */
const getMaterialColor = (material: THREE.Material): THREE.Color => {
  const mat = material as VoxelMaterial;

  if (mat.color && mat.color instanceof THREE.Color) {
    return mat.color.clone();
  }

  if (mat.emissive && mat.emissive instanceof THREE.Color) {
    const emissive = mat.emissive.clone();
    if (emissive.r > 0 || emissive.g > 0 || emissive.b > 0) {
      return emissive;
    }
  }

  return new THREE.Color(1, 1, 1);
};

const copyAttribute = (
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  itemSize: number,
): Float32Array => {
  const output = new Float32Array(attribute.count * itemSize);
  for (let i = 0; i < attribute.count; i++) {
    const offset = i * itemSize;
    output[offset] = attribute.getX(i);
    if (itemSize > 1) output[offset + 1] = attribute.getY(i);
    if (itemSize > 2) output[offset + 2] = attribute.getZ(i);
    if (itemSize > 3) output[offset + 3] = attribute.getW(i);
  }
  return output;
};

const copyIndex = (index: THREE.BufferAttribute): Uint32Array => {
  const output = new Uint32Array(index.count);
  for (let i = 0; i < index.count; i++) output[i] = index.getX(i);
  return output;
};

export const prepareVoxelizationRequest = async (
  model: THREE.Object3D,
  resolution: number,
  removeHiddenFaces: boolean,
  options: ProgressiveYieldOptions = {},
): Promise<VoxelizeRequest> => {
  if (!Number.isInteger(resolution) || resolution <= 0) {
    throw new RangeError("Voxel resolution must be a positive integer");
  }

  updateObjectMatrixWorldDepthFirst(model, true);
  const meshes: MeshData[] = [];
  const bbox = new THREE.Box3();
  const meshBounds = new THREE.Box3();
  const instanceMatrix = new THREE.Matrix4();
  const instanceWorldMatrix = new THREE.Matrix4();
  const stack: THREE.Object3D[] = [model];
  const maybeYield = createProgressiveYieldController(options, {
    batchSize: 256,
    frameBudgetMs: 8,
  });

  while (stack.length > 0) {
    const child = stack.pop()!;
    if (child instanceof THREE.Mesh && child.geometry) {
      const geometry = child.geometry;
      const position = geometry.getAttribute("position");
      if (position) {
        const boundedObject = child as THREE.Mesh & {
          boundingBox?: THREE.Box3 | null;
          computeBoundingBox?: () => void;
        };
        let localBounds: THREE.Box3 | null | undefined;
        if (boundedObject.boundingBox !== undefined) {
          if (boundedObject.boundingBox === null) {
            boundedObject.computeBoundingBox?.();
          }
          localBounds = boundedObject.boundingBox;
        } else {
          if (!geometry.boundingBox) geometry.computeBoundingBox();
          localBounds = geometry.boundingBox;
        }
        if (localBounds && !localBounds.isEmpty()) {
          meshBounds.copy(localBounds).applyMatrix4(child.matrixWorld);
          bbox.union(meshBounds);
        }

        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material];
        const material = materials[0];
        if (material) {
          const normal = geometry.getAttribute("normal");
          const uv = geometry.getAttribute("uv");
          const color = geometry.getAttribute("color");
          const materialColor = getMaterialColor(material);
          const meshData = {
            positions: copyAttribute(position, 3),
            normals: normal ? copyAttribute(normal, 3) : undefined,
            uvs: uv ? copyAttribute(uv, 2) : undefined,
            vertexColors: color ? copyAttribute(color, 3) : undefined,
            indices: geometry.index ? copyIndex(geometry.index) : undefined,
            materialColor: {
              r: materialColor.r,
              g: materialColor.g,
              b: materialColor.b,
            },
            textureData: extractTextureData(material),
          };

          if (child instanceof THREE.InstancedMesh) {
            for (let i = 0; i < child.count; i++) {
              child.getMatrixAt(i, instanceMatrix);
              instanceWorldMatrix.multiplyMatrices(
                child.matrixWorld,
                instanceMatrix,
              );
              meshes.push({
                ...meshData,
                matrix: instanceWorldMatrix.toArray(),
              });
              await maybeYield();
            }
          } else {
            meshes.push({ ...meshData, matrix: child.matrixWorld.toArray() });
          }
        }
      }
    }

    for (let i = child.children.length - 1; i >= 0; i--) {
      const descendant = child.children[i];
      if (descendant) stack.push(descendant);
    }
    await maybeYield();
  }

  if (meshes.length === 0 || bbox.isEmpty()) {
    throw new Error("No meshes found in model");
  }

  return {
    meshes,
    resolution,
    removeHiddenFaces,
    bbox: {
      min: { x: bbox.min.x, y: bbox.min.y, z: bbox.min.z },
      max: { x: bbox.max.x, y: bbox.max.y, z: bbox.max.z },
    },
  };
};

/**
 * Voxelizes a 3D model using BVH-accelerated raycast algorithm in a Web Worker
 *
 * This prevents UI blocking by offloading the CPU-intensive voxelization to a background thread.
 *
 * Algorithm (based on andstor/voxelizer):
 * 1. Extract geometry, materials, and texture data from the model
 * 2. Transfer data to worker thread
 * 3. Worker builds BVH (Bounding Volume Hierarchy) for each mesh - O(n log n)
 * 4. Worker casts rays through 3D grid with BVH acceleration - O(resolution² × log(triangles))
 * 5. Worker counts intersections: odd = inside, even = outside
 * 6. Returns merged geometry with vertex colors
 *
 * BVH acceleration reduces raycast from O(triangles) to O(log(triangles)) per ray!
 * This makes it 10-100x faster than naive raycasting.
 *
 * Reference: https://github.com/andstor/voxelizer
 *
 * @param model - The Three.js Object3D to voxelize
 * @param resolution - The voxel resolution (higher = more detail, recommended 16-48)
 * @param removeHiddenFaces - Whether to remove hidden faces (internal voxels)
 * @returns A promise that resolves to a new Three.js Mesh with voxelized geometry
 */
export const voxelizeModel = async (
  model: THREE.Object3D,
  resolution: number = 32,
  removeHiddenFaces: boolean = true,
): Promise<THREE.Object3D> => {
  const request = await prepareVoxelizationRequest(
    model,
    resolution,
    removeHiddenFaces,
  );
  const { meshes } = request;

  // Create and execute worker
  return new Promise<THREE.Object3D>((resolve, reject) => {
    const worker = new VoxelizeWorker();

    worker.onmessage = (event: MessageEvent<VoxelizeResponse>) => {
      worker.terminate();

      if (event.data.error) {
        reject(new Error(event.data.error));
        return;
      }

      const { positions, colors, indices } = event.data;

      // Reconstruct geometry from worker response
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3),
      );
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

      if (indices.length > 0) {
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      }
      geometry.computeVertexNormals();

      // Create material that uses vertex colors
      const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.7,
        metalness: 0.3,
        flatShading: true,
      });

      const voxelMesh = new THREE.Mesh(geometry, material);
      voxelMesh.name = "VoxelizedModel";

      resolve(voxelMesh);
    };

    worker.onerror = (error) => {
      worker.terminate();
      reject(new Error(`Voxelization worker error: ${error.message}`));
    };

    // Collect all transferable buffers
    const transferables: Transferable[] = [];
    const transferredBuffers = new Set<ArrayBuffer>();
    const addTransferable = (buffer: ArrayBufferLike): void => {
      if (!(buffer instanceof ArrayBuffer) || transferredBuffers.has(buffer)) {
        return;
      }
      transferredBuffers.add(buffer);
      transferables.push(buffer);
    };
    meshes.forEach((mesh) => {
      addTransferable(mesh.positions.buffer);
      if (mesh.normals) addTransferable(mesh.normals.buffer);
      if (mesh.uvs) addTransferable(mesh.uvs.buffer);
      if (mesh.vertexColors) addTransferable(mesh.vertexColors.buffer);
      if (mesh.indices) addTransferable(mesh.indices.buffer);
      if (mesh.textureData) addTransferable(mesh.textureData.data.buffer);
    });

    // Send work to worker with transferable buffers for zero-copy performance
    worker.postMessage(request, transferables);
  });
};
