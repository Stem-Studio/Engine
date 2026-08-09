/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */

import { MeshoptDecoder } from "meshoptimizer";
import * as THREE from "three";
import { LoadingManager } from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { acceleratedRaycast, MeshBVH } from "three-mesh-bvh";

import BaseLoader from "./BaseLoader";
import { EARTHAnimationGraphLoaderPlugin } from "../../../animation/extensions/EARTHAnimationGraphLoaderPlugin";
import global from "../../../global";
import { DetectDevice } from '../../../utils/DetectDevice';
import { loadGLTFWithAssetResolution } from "../../../utils/LoaderWrappers";
import MeshUtils from "../../../utils/MeshUtils";
import {traverseObjectDepthFirst} from "../../../utils/SceneTraverser";
import GLTFLoaderExtended from "./GLTFLoaderExtended";

const GEOMETRY_CACHE = new Map();
const TEXTURE_CACHE = new Map();

THREE.Mesh.prototype.raycast = acceleratedRaycast;

const SHARED_LOADER_RELEASE_DELAY_MS = 10000;

const MAX_MOBILE_MIPMAP_RESOLUTION = 128;

const HARDWARE_CONCURRENCY = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
const MAX_WORKERS = Math.max(1, Math.min(8, HARDWARE_CONCURRENCY));
const DRACO_WORKER_LIMIT = Math.min(2, Math.max(1, MAX_WORKERS - 1));
const KTX2_WORKER_LIMIT = Math.min(2, Math.max(1, MAX_WORKERS - 1));

let sharedDracoLoader = null;
let sharedKTX2Loader = null;
let dracoUsers = 0;
let ktxUsers = 0;
let dracoDisposeTimer = null;
let ktxDisposeTimer = null;

const clearLoaderTimer = (timer) => {
    if (timer) {
        clearTimeout(timer);
    }
};

const initSharedDracoLoader = (loadingManager) => {
    const loader = new DRACOLoader(loadingManager);
    loader.setDecoderPath(`/assets/js/draco/gltf/`);
    loader.setWorkerLimit(DRACO_WORKER_LIMIT);
    loader.preload?.();
    return loader;
};

const disposeSharedDracoLoader = () => {
    sharedDracoLoader?.dispose?.();
    sharedDracoLoader = null;
};

const scheduleDracoDispose = () => {
    if (dracoUsers > 0 || sharedDracoLoader === null) return;
    clearLoaderTimer(dracoDisposeTimer);
    dracoDisposeTimer = setTimeout(() => {
        disposeSharedDracoLoader();
        dracoDisposeTimer = null;
    }, SHARED_LOADER_RELEASE_DELAY_MS);
};

const acquireDracoLoader = (loadingManager) => {
    clearLoaderTimer(dracoDisposeTimer);
    dracoDisposeTimer = null;
    if (!sharedDracoLoader) {
        sharedDracoLoader = initSharedDracoLoader(loadingManager);
    }
    dracoUsers += 1;
    return sharedDracoLoader;
};

const releaseDracoLoader = () => {
    if (dracoUsers <= 0) return;
    dracoUsers -= 1;
    if (dracoUsers === 0) {
        scheduleDracoDispose();
    }
};

const initSharedKTX2Loader = (loadingManager) => {
    const loader = new KTX2Loader(loadingManager).setTranscoderPath(`/assets/js/basis/`);
    loader.setWorkerLimit(KTX2_WORKER_LIMIT);
    return loader;
};

const disposeSharedKTX2Loader = () => {
    sharedKTX2Loader?.dispose?.();
    sharedKTX2Loader = null;
};

const scheduleKTXDispose = () => {
    if (ktxUsers > 0 || sharedKTX2Loader === null) return;
    clearLoaderTimer(ktxDisposeTimer);
    ktxDisposeTimer = setTimeout(() => {
        disposeSharedKTX2Loader();
        ktxDisposeTimer = null;
    }, SHARED_LOADER_RELEASE_DELAY_MS);
};

const acquireKTX2Loader = (loadingManager, renderer) => {
    clearLoaderTimer(ktxDisposeTimer);
    ktxDisposeTimer = null;
    if (!sharedKTX2Loader) {
        sharedKTX2Loader = initSharedKTX2Loader(loadingManager);
    }
    if (renderer) {
        sharedKTX2Loader.detectSupport(renderer);
    }
    ktxUsers += 1;
    return sharedKTX2Loader;
};

const releaseKTX2Loader = () => {
    if (ktxUsers <= 0) return;
    ktxUsers -= 1;
    if (ktxUsers === 0) {
        scheduleKTXDispose();
    }
};

const WM_GEOM_USED = new WeakMap(); // BufferGeometry -> number
const WM_GEOM_CACHE_MAP = new WeakMap(); // BufferGeometry -> Map<string, BufferGeometry>
const WM_GEOM_CACHE_KEYS = new WeakMap(); // BufferGeometry -> Set<string>

const WM_TEX_USED = new WeakMap(); // Texture -> number
const WM_TEX_CACHE_MAP = new WeakMap(); // Texture -> Map<string, Texture>
const WM_TEX_CACHE_KEYS = new WeakMap(); // Texture -> Set<string>
const WS_TEX_HOOKED = new WeakSet(); // Texture

const __erthDecRefGeometry = (geom) => {
    const current = WM_GEOM_USED.get(geom) ?? 1;
    const next = current - 1;
    WM_GEOM_USED.set(geom, next);
    if (next <= 0) {
        const cmap = WM_GEOM_CACHE_MAP.get(geom);
        const ckeys = WM_GEOM_CACHE_KEYS.get(geom);
        if (cmap && ckeys) {
            try { for (const k of ckeys) cmap.delete(k); } catch (e) { void e; }
            ckeys.clear?.();
        }
        WM_GEOM_CACHE_MAP.delete(geom);
        WM_GEOM_CACHE_KEYS.delete(geom);
        THREE.EventDispatcher.prototype.dispatchEvent.call(geom, { type: 'dispose' });
    }
};

THREE.BufferGeometry.prototype.dispose = function () {
    __erthDecRefGeometry(this);
};

const getIndexPath = (object) => {
    const indices = [];
    let current = object;
    while (current && current.parent) {
        const parent = current.parent;
        const idx = parent.children.indexOf(current);
        indices.push(idx);
        current = parent;
    }
    indices.reverse();
    return indices.join("/");
};

const applyGeometryCache = (urlKey, scene) => {
    if (!scene) return;

    const existing = GEOMETRY_CACHE.get(urlKey);
    const urlCache = existing instanceof Map ? existing : new Map();
    if (!existing) {
        GEOMETRY_CACHE.set(urlKey, urlCache);
    }

    const meshNodes = [];
    const skinnedGeometries = new Set();
    traverseObjectDepthFirst(scene, (node) => {
        if (!MeshUtils.isMesh(node)) return;
        meshNodes.push(node);
        if (node.isSkinnedMesh && node.geometry) {
            skinnedGeometries.add(node.geometry);
        }
    });

    for (let i = 0; i < meshNodes.length; i++) {
        const obj = meshNodes[i];
        // NOTE: do not reuse/cache geometry for SkinnedMesh
        if (obj.isSkinnedMesh) continue;
        const mesh = obj;
        if (!mesh.geometry) continue;
        const nodePath = getIndexPath(obj);
        const cached = urlCache.get(nodePath);
        let sharedGeometry = mesh.geometry;
        if (cached) {
            if (cached !== mesh.geometry) {
                const toDispose = mesh.geometry;
                const used = WM_GEOM_USED.get(cached) ?? 0;
                WM_GEOM_USED.set(cached, used + 1);
                let keys = WM_GEOM_CACHE_KEYS.get(cached);
                if (!(keys instanceof Set)) {
                    keys = new Set();
                    WM_GEOM_CACHE_KEYS.set(cached, keys);
                }
                keys.add(nodePath);
                mesh.geometry = cached;
                sharedGeometry = cached;
                toDispose.dispose?.();
            }
        } else {
            const geometry = mesh.geometry;
            const used = WM_GEOM_USED.get(geometry) ?? 0;
            WM_GEOM_USED.set(geometry, used + 1);
            WM_GEOM_CACHE_MAP.set(geometry, urlCache);
            let keys = WM_GEOM_CACHE_KEYS.get(geometry);
            if (!(keys instanceof Set)) {
                keys = new Set();
                WM_GEOM_CACHE_KEYS.set(geometry, keys);
            }
            keys.add(nodePath);
            urlCache.set(nodePath, geometry);
            sharedGeometry = geometry;
        }

        if (skinnedGeometries.has(sharedGeometry)) {
            continue;
        }

        if (sharedGeometry.getAttribute?.("position")) {
            sharedGeometry.computeBoundingBox?.();
        }

        if (!sharedGeometry.boundsTree && sharedGeometry.getAttribute?.("position")) {
            sharedGeometry.boundsTree = new MeshBVH(sharedGeometry);
        }
    }
};
const getMaterialTextures = (material) => {
    const slots = [
        'map', 'normalMap', 'metalnessMap', 'roughnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'specularMap',
        'displacementMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'iridescenceMap',
        'iridescenceThicknessMap', 'sheenColorMap', 'sheenRoughnessMap', 'transmissionMap', 'thicknessMap',
        'anisotropyMap', 'envMap',
    ];
    const out = [];
    for (const s of slots) {
        const value = Reflect.get(material, s);
        if (value && typeof value === 'object' && value.isTexture) {
            out.push({ slot: s, tex: value });
        }
    }
    return out;
};
const applyTextureCache = (urlKey, scene) => {
    if (!scene) return;
    const existing = TEXTURE_CACHE.get(urlKey);
    const urlCache = existing instanceof Map ? existing : new Map();
    if (!existing) TEXTURE_CACHE.set(urlKey, urlCache);

    traverseObjectDepthFirst(scene, (node) => {
        const obj = node;
        if (!MeshUtils.isMesh(obj)) return;
        const mesh = obj;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const nodePath = getIndexPath(obj);
        materials.forEach((mat, idx) => {
            if (!mat) return;
            const textures = getMaterialTextures(mat);
            for (const { slot, tex } of textures) {
                const texture = tex;
                const key = `${nodePath}:${idx}:${slot}`;
                const cached = urlCache.get(key);
                if (cached) {
                    if (cached !== texture) {
                        const used = WM_TEX_USED.get(cached) ?? 0;
                        WM_TEX_USED.set(cached, used + 1);
                        Reflect.set(mat, slot, cached);
                        texture.dispose?.();
                    }
                } else {
                    const cur = WM_TEX_USED.get(texture) ?? 0;
                    let keys = WM_TEX_CACHE_KEYS.get(texture);
                    if (!(keys instanceof Set)) {
                        keys = new Set();
                        WM_TEX_CACHE_KEYS.set(texture, keys);
                    }
                    if (!keys.has(key)) {
                        WM_TEX_USED.set(texture, cur + 1);
                        keys.add(key);
                    }
                    WM_TEX_CACHE_MAP.set(texture, urlCache);
                    if (!WS_TEX_HOOKED.has(texture)) {
                        texture.addEventListener('dispose', (ev) => {
                            const t = ev.target;
                            const cmap = WM_TEX_CACHE_MAP.get(t);
                            const ckeys = WM_TEX_CACHE_KEYS.get(t);
                            if (cmap && ckeys) {
                                try { for (const k of ckeys) cmap.delete(k); } catch (e) { void e; }
                                ckeys.clear?.();
                            }
                            WM_TEX_CACHE_MAP.delete(t);
                            WM_TEX_CACHE_KEYS.delete(t);
                        });
                        WS_TEX_HOOKED.add(texture);
                    }
                    urlCache.set(key, texture);
                }
            }
        });
    });
};
const dropMipmapsToMaxSize = (texture, maxSize, visited) => {
  if (!texture || visited.has(texture)) return;
  visited.add(texture);

  const mips = texture.mipmaps;
  if (!mips || mips.length <= 1) return;

  // Drop highest mips until within size
  while (mips.length > 1 &&
        (mips[0].width > maxSize || mips[0].height > maxSize)) {
    console.warn(`Dropping mip level: `, { texture, width: mips[0].width, height: mips[0].height });
    mips.shift();
  }

  // Compute max allowed mip count for WebGPU
  const base = mips[0];
  const maxMipCount = Math.floor(Math.log2(Math.max(base.width, base.height))) + 1;

  if (mips.length > maxMipCount) {
    console.warn(`Trimming extra mip levels: kept ${maxMipCount}, got ${mips.length}`);
    mips.length = maxMipCount; // truncate tail
  }

  // Update texture size
  texture.image.width = base.width;
  texture.image.height = base.height;

  if (!texture.isCompressedTexture) {
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;

    if (base.data) {
      texture.image = {
        data: base.data,
        width: base.width,
        height: base.height,
      };
    }
  }

  texture.needsUpdate = true;
};
const dropMipmapsInObject = (root, maxSize) => {
  const visited = new Set();

  traverseObjectDepthFirst(root, (obj) => {
    if (!obj.material) return;

    const materials = Array.isArray(obj.material)
      ? obj.material
      : [obj.material];

    for (const mat of materials) {
      for (const key in mat) {
        const value = mat[key];

        // Single texture
        if (value instanceof THREE.Texture) {
          dropMipmapsToMaxSize(value, maxSize, visited);
        }

        // Arrays of textures (e.g., uniform arrays)
        if (Array.isArray(value)) {
          for (const v of value) {
            if (v instanceof THREE.Texture) {
              dropMipmapsToMaxSize(v, maxSize, visited);
            }
          }
        }
      }
    }
  });
};

/**
 * GLTFLoader
 *
 */
class _GLTFLoader extends BaseLoader {
    constructor() {
        super();
        this._dracoAcquired = false;
        this._ktxAcquired = false;
        this.loadingManager = new LoadingManager();
        this.loader = new GLTFLoader(this.loadingManager);
        this.dracoLoader = acquireDracoLoader(this.loadingManager);
        this._dracoAcquired = true;
        const renderer = global?.app?.renderer ?? null;
        this.ktxLoader = acquireKTX2Loader(this.loadingManager, renderer);
        this._ktxAcquired = true;
        this.loader.setCrossOrigin("anonymous");
        this.loader.setDRACOLoader(this.dracoLoader);
        this.loader.setKTX2Loader(this.ktxLoader);
        this.loader.setMeshoptDecoder(MeshoptDecoder);
        const anyLoader = this.loader;
        if (anyLoader && typeof anyLoader.register === "function") {
            anyLoader.register((parser) => new EARTHAnimationGraphLoaderPlugin(parser));
        }
    }

    async load(url, options = {}) {
        const fileBlobMap = options?.fileBlobMap;
        if (fileBlobMap && typeof fileBlobMap.size === "number" && fileBlobMap.size > 0) {
            try {
                const obj3d = await new GLTFLoaderExtended().load(
                    url,
                    options.rootPath || "",
                    fileBlobMap,
                    options.atlasData,
                    options.textureOverrides,
                );

                applyGeometryCache(url, obj3d);
                applyTextureCache(url, obj3d);

                if (DetectDevice.isMobile()) {
                    dropMipmapsInObject(obj3d, MAX_MOBILE_MIPMAP_RESOLUTION);
                }

                return obj3d;
            } catch (error) {
                console.error("Failed to load GLTF:", error);
                console.error("GLTF URL:", url);
                return null;
            }
        }

        try {
            const resolvedUrl = await loadGLTFWithAssetResolution(url);

            return new Promise(resolve => {
                this.loader.load(
                    resolvedUrl,
                    result => {
                        var obj3d = result.scene;
                        result.parser = null;
                        obj3d._obj = result;
                        obj3d._root = result.scene;

                        applyGeometryCache(url, obj3d);
                        applyTextureCache(url, obj3d);

                        if (DetectDevice.isMobile()) {
                            dropMipmapsInObject(obj3d, MAX_MOBILE_MIPMAP_RESOLUTION);
                        }

                        resolve(obj3d);
                    },
                    undefined,
                    (error) => {
                        console.error("Failed to load GLTF:", error);
                        console.error("GLTF URL:", resolvedUrl);
                        // Check if error contains information about the file content
                        if (error.message && error.message.includes("Unsupported asset")) {
                            console.error("The downloaded file is not a valid GLTF 2.0 file. It may be an error page, corrupted, or the URL has expired.");
                        }
                        resolve(null);
                    },
                );
            });
        } catch (error) {
            console.error("Failed to resolve GLTF asset:", error);
            return new Promise(resolve => {
                this.loader.load(
                    url,
                    result => {
                        var obj3d = result.scene;
                        result.parser = null;
                        obj3d._obj = result;
                        obj3d._root = result.scene;

                        applyGeometryCache(url, obj3d);
                        applyTextureCache(url, obj3d);

                        if (DetectDevice.isMobile()) {
                            dropMipmapsInObject(obj3d, MAX_MOBILE_MIPMAP_RESOLUTION);
                        }

                        resolve(obj3d);
                    },
                    undefined,
                    (error) => {
                        console.error("Failed to load GLTF:", error);
                        console.error("GLTF URL:", url);
                        // Check if error contains information about the file content
                        if (error.message && error.message.includes("Unsupported asset")) {
                            console.error("The downloaded file is not a valid GLTF 2.0 file. It may be an error page, corrupted, or the URL has expired.");
                        }
                        resolve(null);
                    },
                );
            });
        }
    }

    createScripts(name) {
        return (
            `var mesh = this.getObjectByName('${name}');\n\n` +
            `var obj = mesh._obj;\n\n` +
            `var root = mesh._root;\n\n` +
            `var mixer = new THREE.AnimationMixer(root);\n\n` +
            `mixer.clipAction(obj.animations[0]).play();\n\n` +
            `function update(clock, deltaTime) { \n    mixer.update(deltaTime); \n}`
        );
    }

    dispose() {
        if (this.loader) {
            this.loader.setKTX2Loader(null);
            this.loader.setDRACOLoader(null);
        }
        if (this._dracoAcquired) {
            releaseDracoLoader();
            this._dracoAcquired = false;
        }
        if (this._ktxAcquired) {
            releaseKTX2Loader();
            this._ktxAcquired = false;
        }
        this.loader = null;
        this.dracoLoader = null;
        this.ktxLoader = null;
        this.loadingManager = null;
    }
}

export default _GLTFLoader;
