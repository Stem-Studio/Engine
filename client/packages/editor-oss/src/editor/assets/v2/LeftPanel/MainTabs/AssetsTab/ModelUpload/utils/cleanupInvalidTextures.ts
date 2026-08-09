import * as THREE from "three";
import type { Object3D } from "three";
import { findObjectDepthFirst } from "@stem/editor-oss/utils/SceneTraverser";
import {
  createProgressiveYieldController,
  type ProgressiveYieldOptions,
} from "@stem/editor-oss/utils/progressiveYield";

// Import the default texture - Vite will handle the path correctly
// eslint-disable-next-line import/no-unresolved
import defaultTexturePath from "/assets/textures/default-placeholder.png";

// Cached default texture instance
let cachedDefaultTexture: THREE.Texture | null = null;
let textureLoadPromise: Promise<THREE.Texture> | null = null;

const DETECT_TEXTURE_SLOTS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "emissiveMap",
  "aoMap",
  "bumpMap",
  "displacementMap",
  "alphaMap",
  "specularMap",
] as const;
const CLEANUP_TEXTURE_SLOTS = [
  ...DETECT_TEXTURE_SLOTS,
  "envMap",
  "lightMap",
] as const;
type CleanupTextureSlot = (typeof CLEANUP_TEXTURE_SLOTS)[number];
type TextureSlotMaterial = THREE.Material &
  Partial<Record<CleanupTextureSlot, THREE.Texture | null>>;
type GenericTextureImage = {
  width?: number;
  height?: number;
  data?: ArrayLike<unknown>;
};

export type CleanupInvalidTexturesOptions = ProgressiveYieldOptions;

/**
 * Loads and caches the default placeholder texture.
 */
const ensureDefaultTextureLoaded = (): Promise<THREE.Texture> => {
  if (cachedDefaultTexture) {
    return Promise.resolve(cachedDefaultTexture);
  }

  if (textureLoadPromise) {
    return textureLoadPromise;
  }

  textureLoadPromise = new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      defaultTexturePath,
      (texture) => {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        cachedDefaultTexture = texture;
        resolve(texture);
      },
      undefined,
      (error) => {
        textureLoadPromise = null;
        console.error(
          "[cleanupInvalidTextures] Failed to load default texture:",
          error,
        );
        reject(error);
      },
    );
  });

  return textureLoadPromise;
};

const getInvalidTextureReason = (texture: THREE.Texture): string | null => {
  if ((texture as THREE.CompressedTexture).isCompressedTexture) return null;
  if (!texture.image) return "no image data";

  const image = texture.image as GenericTextureImage;
  if (
    typeof HTMLImageElement !== "undefined" &&
    image instanceof HTMLImageElement
  ) {
    return image.naturalWidth === 0 || image.naturalHeight === 0
      ? `HTMLImageElement failed to load (naturalWidth=${image.naturalWidth}, naturalHeight=${image.naturalHeight}, src=${image.src?.substring(0, 50)})`
      : null;
  }
  if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) {
    return image.width === 0 || image.height === 0
      ? "ImageBitmap has zero dimensions"
      : null;
  }
  if (image.width !== undefined && image.height !== undefined) {
    return image.width === 0 || image.height === 0
      ? "image has zero dimensions"
      : null;
  }
  if (!image.data || image.data.length === 0) {
    return "unknown image type with no data";
  }
  return null;
};

/**
 * Analyzes UV coordinates of a mesh to get the UV range.
 * Returns { uRange, vRange } representing how far UVs extend beyond 0-1.
 * @param mesh
 */
const analyzeUVRange = (
  mesh: THREE.Mesh,
): { uRange: number; vRange: number } => {
  const geometry = mesh.geometry;
  const uvAttr = geometry?.getAttribute("uv");

  if (!uvAttr) {
    return { uRange: 1, vRange: 1 };
  }

  let minU = Infinity,
    maxU = -Infinity;
  let minV = Infinity,
    maxV = -Infinity;

  for (let i = 0; i < uvAttr.count; i++) {
    const u = uvAttr.getX(i);
    const v = uvAttr.getY(i);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }

  const uRange = maxU - minU;
  const vRange = maxV - minV;

  return { uRange: Math.max(uRange, 0.001), vRange: Math.max(vRange, 0.001) };
};

/**
 * Creates a clone of the default texture with repeat settings based on UV coordinates.
 * This ensures the texture tiles properly regardless of the mesh's UV layout.
 * @param mesh
 */
const createTextureForMesh = (mesh: THREE.Mesh): THREE.Texture | null => {
  if (!cachedDefaultTexture) return null;

  const texture = cachedDefaultTexture.clone();
  texture.needsUpdate = true;

  // Analyze actual UV coordinates to determine proper repeat values
  const { uRange, vRange } = analyzeUVRange(mesh);

  // Calculate aspect ratio of UVs to prevent stretching
  // We want the texture to tile with equal size in both directions
  const uvAspect = uRange / vRange;

  // Base number of tiles we want (adjustable for tile density)
  const baseTiles = 4;

  let repeatX: number;
  let repeatY: number;

  if (uvAspect > 1) {
    // UVs are wider than tall - need more X repeats
    repeatX = Math.max(1, Math.round(baseTiles * uvAspect));
    repeatY = baseTiles;
  } else {
    // UVs are taller than wide - need more Y repeats
    repeatX = baseTiles;
    repeatY = Math.max(1, Math.round(baseTiles / uvAspect));
  }

  texture.repeat.set(repeatX, repeatY);

  return texture;
};

/**
 * Detects whether a model has any invalid/missing textures without modifying it.
 * Returns true if any material has a texture slot with missing or failed-to-load image data.
 * @param model
 */
export const detectMissingTextures = (model: Object3D): boolean => {
  return (
    findObjectDepthFirst(model, (child) => {
      if (!(child instanceof THREE.Mesh) || !child.material) return false;

      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      for (const mat of materials) {
        for (const slot of DETECT_TEXTURE_SLOTS) {
          const tex = mat[slot];
          if (!tex) continue;
          if (getInvalidTextureReason(tex)) return true;
        }

        if (!mat.map && child.geometry) {
          const uvAttr = child.geometry.getAttribute("uv");
          if (uvAttr && uvAttr.count > 0) return true;
        }
      }
      return false;
    }) !== null
  );
};

/**
 * Cleans up invalid textures from a model.
 * FBX files often reference external textures that fail to load,
 * causing rendering issues and GLTFExporter crashes.
 *
 * Invalid diffuse/color map textures are replaced with a default
 * placeholder texture. Other texture types are removed.
 *
 * @param model
 * @returns Promise resolving to true if any invalid textures were found and handled
 */
export const cleanupInvalidTextures = async (
  model: Object3D,
  options: CleanupInvalidTexturesOptions = {},
): Promise<boolean> => {
  const invalidTextureActions: Array<{
    mesh: THREE.Mesh;
    material: TextureSlotMaterial;
    slot: CleanupTextureSlot;
    replaceWithDefault: boolean;
  }> = [];
  const queuedSlotsByMaterial = new WeakMap<THREE.Material, Set<string>>();
  const maybeYield = createProgressiveYieldController(options, {
    batchSize: 2048,
    frameBudgetMs: 8,
  });
  const stack: Object3D[] = [model];

  while (stack.length > 0) {
    const child = stack.pop()!;
    if (child instanceof THREE.Mesh && child.material) {
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      for (const material of materials) {
        const mat = material as TextureSlotMaterial;
        for (const slot of CLEANUP_TEXTURE_SLOTS) {
          const tex = mat[slot];
          if (!tex) continue;
          const reason = getInvalidTextureReason(tex);
          if (!reason) continue;

          let queuedSlots = queuedSlotsByMaterial.get(material);
          if (!queuedSlots) {
            queuedSlots = new Set();
            queuedSlotsByMaterial.set(material, queuedSlots);
          }
          if (queuedSlots.has(slot)) continue;
          queuedSlots.add(slot);
          console.warn(
            `[cleanupInvalidTextures] Found invalid texture in "${slot}": ${reason}`,
          );
          invalidTextureActions.push({
            mesh: child,
            material: mat,
            slot,
            replaceWithDefault: slot === "map",
          });
        }
      }
    }

    for (let i = child.children.length - 1; i >= 0; i--) {
      const descendant = child.children[i];
      if (descendant) stack.push(descendant);
    }
    await maybeYield();
  }

  const needsDefaultTexture = invalidTextureActions.some(
    (action) => action.replaceWithDefault,
  );
  if (needsDefaultTexture && !cachedDefaultTexture) {
    try {
      await ensureDefaultTextureLoaded();
    } catch (error) {
      console.error(
        "[cleanupInvalidTextures] Could not load default texture:",
        error,
      );
    }
  }

  for (const action of invalidTextureActions) {
    if (action.replaceWithDefault) {
      // Replace diffuse map with default placeholder texture
      const defaultTex = createTextureForMesh(action.mesh);
      if (defaultTex) {
        action.material[action.slot] = defaultTex;
      } else {
        action.material[action.slot] = null;
        console.warn(
          `[cleanupInvalidTextures] Default texture not available, removed "${action.slot}"`,
        );
      }
    } else {
      // Remove other texture types (normal, roughness, etc.)
      action.material[action.slot] = null;
    }

    // Mark material as needing update for the changes to take effect
    action.material.needsUpdate = true;
  }

  return invalidTextureActions.length > 0;
};
