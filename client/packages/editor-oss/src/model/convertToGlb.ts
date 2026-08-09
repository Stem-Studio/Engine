import I18n from "i18next";
import { AnimationClip, BufferAttribute, Group, Mesh, Object3D, Scene } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import * as WebGLTextureUtils from "three/addons/utils/WebGLTextureUtils.js";

import { showToast } from '../showToast';
import { ModelUtils, optimizeGlbFile } from '../utils/ModelUtils';
import { cloneObject } from '../utils/ObjectUtils';
import {traverseObjectDepthFirst} from "../utils/SceneTraverser";

const applyTextureFixes = (model: Object3D) => {
  let foundInvalidTexture = false;

  traverseObjectDepthFirst(model, child => {
      const isMesh = child instanceof Mesh && child.isMesh;
      if (!isMesh) {
          return;
      }
      
      const geom = child.geometry;

      // Apply geometry fix only for FBX models
      if (geom && model.userData?.sourceFormat === 'FBX') {
          for (const key in geom.attributes) {
              const attr = geom.attributes[key];
              const stride = attr.itemSize * attr.array.BYTES_PER_ELEMENT;

              if (stride % 4 !== 0) {
                  console.warn(`[saveAsGLB] Attribute ${key} has invalid stride (${stride}), fixing...`, attr);
              }

              if (!(attr.array instanceof Float32Array)) {
                  try {
                      const newArray = new Float32Array(attr.array);
                      geom.setAttribute(key, new BufferAttribute(newArray, attr.itemSize, attr.normalized));
                  } catch (err) {
                      console.warn(`[saveAsGLB] Failed to convert ${key}, removing.`, err);
                      geom.deleteAttribute(key);
                  }
              }

              const newAttr = geom.attributes[key];
              if (newAttr) {
                  const newStride = newAttr.itemSize * newAttr.array.BYTES_PER_ELEMENT;
                  if (newStride % 4 !== 0) {
                      console.warn(`[saveAsGLB] Removing ${key} with stride ${newStride}`);
                      geom.deleteAttribute(key);
                  }
              }
          }

          if (geom.attributes.color && geom.attributes.color.itemSize < 3) {
              console.warn(`[saveAsGLB] Removing invalid color attribute`);
              geom.deleteAttribute("color");
          }
      }

      // Fix textures
      if (child.material) {
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          materials.forEach((mat) => {
              ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap", "bumpMap", "displacementMap", "alphaMap", "specularMap", "envMap", "lightMap"].forEach((key) => {
                  const tex = mat[key];
                  if (tex) {
                      if (tex.isCompressedTexture) {
                          // Compressed textures are valid — GLTFExporter will decompress
                      } else if (!tex.image) {
                          foundInvalidTexture = true;
                          console.warn(`[Pipeline] applyTextureFixes: REMOVING ${key} on material "${mat.name}" (mesh "${child.name}") — no image data`);
                          mat[key] = null;
                      } else {
                          // Check for failed image loads - use naturalWidth/naturalHeight for HTMLImageElement
                          // as width/height are CSS dimensions that may not reflect actual image data
                          const img = tex.image;
                          const isHTMLImage = img instanceof HTMLImageElement;
                          const isImageBitmap = typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap;

                          let width = 0;
                          let height = 0;

                          if (isHTMLImage) {
                              width = img.naturalWidth;
                              height = img.naturalHeight;
                          } else if (isImageBitmap) {
                              width = img.width;
                              height = img.height;
                          } else if (img.width !== undefined && img.height !== undefined) {
                              width = img.width;
                              height = img.height;
                          }

                          if (width === 0 || height === 0) {
                              foundInvalidTexture = true;
                              console.warn(`[Pipeline] applyTextureFixes: REMOVING ${key} on material "${mat.name}" (mesh "${child.name}") — width=${width}, height=${height}`);
                              mat[key] = null;
                          }
                      }
                  }
              });
          });
      }
  });

  return !foundInvalidTexture;
};

const createExportScene = (model: Object3D) => {
    const exportScene = new Scene();
    exportScene.name = "ExportScene";

    if (model instanceof Group) {
        exportScene.add(...model.children);
        exportScene.name = model.name;
        exportScene.position.copy(model.position);
        exportScene.rotation.copy(model.rotation);
        exportScene.quaternion.copy(model.quaternion);
        exportScene.scale.copy(model.scale);
        exportScene.matrix.copy(model.matrix);
        exportScene.matrixWorld.copy(model.matrixWorld);
        exportScene.animations = model.animations;
        exportScene.userData = model.userData;
    } else {
        exportScene.add(model);
    }
    
    if (!applyTextureFixes(exportScene)) {
        showToast({
            type: "warning",
            title: "Some textures are invalid",
            body: "Removed to continue upload.",
        });
    }

    return exportScene;
};

type ConvertToGlbOptions = {
    simplifyModel?: boolean;
    compressModel?: boolean;
    compressTextures?: boolean;
    maxTextureSize?: number;
};

const isAbortError = (error: unknown): boolean =>
    error instanceof DOMException && error.name === "AbortError";

export const convertToGlb = async (
    model: Object3D,
    abortSignal: AbortSignal,
    options: ConvertToGlbOptions = {},
) => {
    // This function produces side effects on the model, so we need to clone it
    const modelClone = cloneObject(model);
    const exportScene = createExportScene(modelClone);

    // Log pre-export texture state for debugging
    traverseObjectDepthFirst(exportScene, (child: Object3D) => {
        if (!(child instanceof Mesh)) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of materials) {
            if (!mat) continue;
            const texSlots = ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap"]
                .filter(k => (mat)[k])
                .map(k => {
                    const tex = (mat)[k];
                    const img = tex?.image;
                    const w = img?.naturalWidth ?? img?.width ?? 0;
                    const h = img?.naturalHeight ?? img?.height ?? 0;
                    return `${k}(${w}x${h})`;
                });
            if (texSlots.length > 0) {
                console.warn(`[Pipeline] convertToGlb: mesh="${child.name}" mat="${mat.name}" textures=[${texSlots.join(', ')}]`);
            }
        }
    });

    const exporter = new GLTFExporter();
    exporter.setTextureUtils(WebGLTextureUtils);

    const result = await new Promise((resolve, reject) => {
        exporter.parse(exportScene, resolve, reject, {
            trs: true,
            binary: true,
            animations: (modelClone as {_obj?: {animations?: AnimationClip[]}; animations?: AnimationClip[]})._obj?.animations
                || (modelClone as {animations?: AnimationClip[]}).animations,
        });
    });

    abortSignal.throwIfAborted();

    let arrayBuffer = result as ArrayBuffer;

    if (options.simplifyModel) {
        try {
            arrayBuffer = (await ModelUtils.simplifyModel(arrayBuffer, false, () => {
                throw new Error("Failed to simplify model");
            })) as ArrayBuffer;
        } catch (err) {
            if (isAbortError(err)) throw err;
            console.warn("[Pipeline] simplifyModel failed, continuing with un-simplified GLB", err);
            showToast({type: "warning", title: I18n.t("Could not simplify model"), body: "Uploading source GLB instead."});
        }

        abortSignal.throwIfAborted();
    }

    if (options.compressModel) {
        try {
            arrayBuffer = (await ModelUtils.compressModel(arrayBuffer, {isJSON: false}, () => {
                throw new Error("Failed to compress model");
            })) as ArrayBuffer;
        } catch (err) {
            if (isAbortError(err)) throw err;
            console.warn("[Pipeline] compressModel failed, continuing with uncompressed GLB", err);
            showToast({type: "warning", title: I18n.t("Could not compress model"), body: "Uploading source GLB instead."});
        }

        abortSignal.throwIfAborted();
    }

    if (options.compressTextures || options.maxTextureSize !== undefined) {
        try {
            arrayBuffer = await optimizeGlbFile(arrayBuffer, {
                compressTextures: options.compressTextures,
                maxTextureSize: options.maxTextureSize,
            });

            abortSignal.throwIfAborted();
        } catch (err) {
            if (isAbortError(err)) throw err;
            console.warn("[Pipeline] optimizeGlbFile failed, continuing with previous GLB buffer", err);
            showToast({type: "warning", title: I18n.t("Could not compress textures"), body: "Uploading source GLB instead."});
        }
    }

    return arrayBuffer;
};
