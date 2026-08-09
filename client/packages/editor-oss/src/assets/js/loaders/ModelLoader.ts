import {AudioListener, BufferAttribute, BufferGeometry, Camera, Mesh, Object3D} from "three";
import {DRACOLoader} from "three/addons/loaders/DRACOLoader.js";
import type {Renderer} from "three/webgpu";

import BaseLoader from "./BaseLoader";
import BlendLoader from "./BlendLoader";
import ColladaLoader from "./ColladaLoader";
import FBXLoader from "./FBXLoader";
import GCodeLoader from "./GCodeLoader";
import _GLTFLoader from "./GLTFLoader";
import KMZLoader from "./KMZLoader";
import MD2Loader from "./MD2Loader";
import ObjectLoader from "./ObjectLoader";
import OBJLoader from "./OBJLoader";
import PCDLoader from "./PCDLoader";
import PDBLoader from "./PDBLoader";
import PLYLoader from "./PLYLoader";
import STLLoader from "./STLLoader";
import TDSLoader from "./TDSLoader";
import USDZLoader from "./USDZLoader";
import VRMLLoader from "./VRMLLoader";
import VRMLoader from "./VRMLoader";
import VTKLoader from "./VTKLoader";
import {urlToFile} from "../../../controls/AiWorldController/AiWorldController.utils";
import global from "../../../global";
import {isGaussianSplatObject, isGaussianSplatPlyUrl} from "../../../model/gaussianSplats";
import {DetectDevice} from "../../../utils/DetectDevice";
import {ImportUtils} from "../../../utils/ImportUtils";
import MeshUtils from "../../../utils/MeshUtils";
import {cloneObject} from "../../../utils/ObjectUtils";
import {PriorityTaskQueue} from "../../../utils/PriorityTaskQueue";
import {traverseObjectDepthFirst} from "../../../utils/SceneTraverser";
import {applyHumanoidAnimations} from "../animations/applyHumanoidAnimations";
import {loadHumanoidAnimations} from "../animations/loadHumanoidAnimations";

interface ModelLoaderOptions {
    Type?: string;
    ForceGaussianSplatPly?: boolean;
    EnableMorphing?: boolean;
    DisableReupload?: boolean;
    DisableDefaultPhysics?: boolean;
    Priority?: number;
    /** Stable cache key for deduplicating same asset/revision loads across signed URL changes */
    CacheKey?: string;
    /** File blob map for texture resolution (from ZIP expansion) */
    fileBlobMap?: Map<string, Blob>;
    /** Root path prefix for relative path resolution */
    rootPath?: string;
    /** Atlas data if atlas.json was detected */
    atlasData?: unknown;
    /** Texture overrides to apply (from loose texture files) */
    textureOverrides?: unknown;
}

interface ModelLoaderEnvironment {
    camera?: Camera;
    renderer?: Renderer;
    audioListener?: AudioListener;
    skipChildrenClear?: boolean;
    // Add any additional environment settings here if needed
}

const Loaders: Record<string, any> = {
    dae: ColladaLoader,
    fbx: FBXLoader,
    glb: _GLTFLoader,
    gltf: _GLTFLoader,
    kmz: KMZLoader,
    md2: MD2Loader,
    json: ObjectLoader,
    obj: OBJLoader,
    stl: STLLoader,
    vtk: VTKLoader,
    drc: DRACOLoader,
    gcode: GCodeLoader,
    pcd: PCDLoader,
    pdb: PDBLoader,
    vrm: VRMLoader,
    vrml: VRMLLoader,
    ply: PLYLoader,
    usd: USDZLoader,
    usda: USDZLoader,
    usdc: USDZLoader,
    usdz: USDZLoader,
    "3ds": TDSLoader,
    blend: BlendLoader,
};

const normalizedGeometries = new WeakSet<BufferGeometry>();
const MAX_MODEL_CACHE_ENTRIES = 64;

const loadSparkGaussianSplatLoader = async () => {
    const module = await import("./SparkGaussianSplatLoader");
    return module.default;
};

/**
 * ModelLoader
 *
 */
class ModelLoader extends BaseLoader {
    private static cache = new Map<string, Object3D>();
    private static pendingLoads = new Map<string, Promise<Object3D | null>>();

    // Reduce parallel loading on iOS devices to minimize memory pressure
    // iOS: 2 concurrent loads, Other platforms: 10 concurrent loads
    // (browsers allow 6 connections per host, but CDN models use different hosts)
    private static taskQueue = new PriorityTaskQueue(
        DetectDevice.isIOS() ? 2 : 10,
    );

    constructor() {
        super();
    }

    static clearCache(): void {
        ModelLoader.cache.clear();
        ModelLoader.pendingLoads.clear();
    }

    private static getCachedModel(cacheKey: string): Object3D | null {
        const cached = ModelLoader.cache.get(cacheKey);
        if (!cached) {
            return null;
        }

        ModelLoader.cache.delete(cacheKey);
        ModelLoader.cache.set(cacheKey, cached);
        return cached;
    }

    private static rememberCachedModel(cacheKey: string, obj: Object3D): void {
        if (ModelLoader.cache.has(cacheKey)) {
            ModelLoader.cache.delete(cacheKey);
        }

        ModelLoader.cache.set(cacheKey, obj);

        while (ModelLoader.cache.size > MAX_MODEL_CACHE_ENTRIES) {
            const oldestKey = ModelLoader.cache.keys().next().value;
            if (oldestKey === undefined) {
                break;
            }
            ModelLoader.cache.delete(oldestKey);
        }
    }

    async load(
        url: string,
        options?: ModelLoaderOptions,
        environment?: ModelLoaderEnvironment,
    ): Promise<Object3D | null> {
        if (options?.Type === undefined) {
            console.warn(`ModelLoader: no type parameters, and cannot load.`);
            return null;
        }

        const cacheKey = options?.CacheKey || url;
        let loadPromise: Promise<Object3D | null>;
        let reusedPendingLoad = false;

        const cached = ModelLoader.getCachedModel(cacheKey);
        if (cached) {
            loadPromise = Promise.resolve(cached);
        } else if (ModelLoader.pendingLoads.has(cacheKey)) {
            loadPromise = ModelLoader.pendingLoads.get(cacheKey)!;
            reusedPendingLoad = true;
        } else {
            loadPromise = ModelLoader.taskQueue
                .enqueue(() => this._load(url, options, environment), options?.Priority)
                .finally(() => {
                    ModelLoader.pendingLoads.delete(cacheKey);
                });
            ModelLoader.pendingLoads.set(cacheKey, loadPromise);
        }

        return loadPromise.then(async (obj) => {
            if (!obj) return null;

            if (isGaussianSplatObject(obj)) {
                // A shared pending gaussian-splat load cannot be reused directly:
                // adding the same Object3D to multiple parents reparents it, so only
                // the last restored scene instance survives. Materialize a fresh object
                // for each waiter while letting Spark's PackedSplats cache dedupe data.
                const instance = reusedPendingLoad
                    ? await this._load(url, options, environment)
                    : obj;

                if (!instance) {
                    return null;
                }

                this.processModel(instance, options, environment);
                instance.updateMatrixWorld(true);
                return instance;
            }

            const cloned = cloneObject(obj, {cloneMaterials: true});
            this.processModel(cloned, options, environment);
            cloned.updateMatrixWorld(true);
            return cloned;
        });
    }

    private processModel(
        obj: Object3D,
        options?: ModelLoaderOptions,
        environment?: ModelLoaderEnvironment,
    ) {
        // bug: Since the model may come with incorrect _children data, causing the loaded scene model to be displayed incompletely.
        // Therefore, when adding the model to the scene, clear the _children property.
        if (!environment?.skipChildrenClear) {
            delete obj.userData._children;
        }

        // Since the uuid changes every time the model is loaded, the uuid of the original model needs to be recorded, and it can only be recorded once.
        if (obj.children && !obj.userData._children) {
            obj.userData._children = []; // UUID hierarchy of the original model
            MeshUtils.traverseUUID(obj.children, obj.userData._children); // Record the uuid of each component of the most original model.
        }

        const stripMorphingForMobile = !options?.EnableMorphing && DetectDevice.isMobile();

        traverseObjectDepthFirst(obj, (child: Object3D) => {
            if (child.uuid === obj.uuid) {
                return;
            }

            this.normalizeGeometryAttributes(child);

            child.userData = child.userData || {};
            child.userData.isRuntimeOnly = true;

            if (stripMorphingForMobile && MeshUtils.isMesh(child)) {
                // Remove morph target state on mobile unless explicitly requested.
                if (child.morphTargetInfluences) delete child.morphTargetInfluences;
                if (child.morphTargetDictionary) delete child.morphTargetDictionary;
                if (child.geometry?.morphAttributes) {
                    child.geometry.morphAttributes = {};
                }
            }
        });

        if (!options?.DisableDefaultPhysics) {
            obj.userData.physics = obj.userData.physics || {
                enabled: true,
                type: "rigidBody",
                shape: "btBoxShape",
                mass: 0,
                inertia: {
                    x: 0,
                    y: 0,
                    z: 0,
                },
                restitution: 0,
                ctype: "Static",
            };
        }

        // Humanoid models carry only a flag in userData — the standard
        // locomotion clips (idle/walk/run/jump) are loaded from the bundled
        // Mixamo library at runtime so individual GLBs stay small. The
        // merge helper skips slots the model already covers, so per-model
        // animations win.
        if (obj.userData?.isHumanoid === true) {
            void loadHumanoidAnimations()
                .then(clips => {
                    if (clips.length) applyHumanoidAnimations(obj, clips);
                })
                .catch(err => {
                    console.warn("[ModelLoader] Failed to apply humanoid animations", err);
                });
        }
    }

    private async _load(
        url: string,
        options?: ModelLoaderOptions,
        environment?: ModelLoaderEnvironment,
    ): Promise<Object3D | null> {
        const cacheKey = options?.CacheKey || url;
        const type = options?.Type;

        if (type === undefined) {
            return null;
        }

        const server = global.app?.options.server;
        if (!options?.DisableReupload && url.startsWith("http") && server && !url.startsWith(server)) {
            try {
                url = await this.reuploadModel(url) || url;
                url = url.replace(server, "");
            } catch (error) {
                console.error(`ModelLoader: failed to reupload model from ${url}`, error);
            }
        }

        let LoaderCtor = Loaders[type];

        if (type === "spz") {
            LoaderCtor = await loadSparkGaussianSplatLoader();
        }

        if (type === "ply") {
            try {
                if (options?.ForceGaussianSplatPly || await isGaussianSplatPlyUrl(url)) {
                    LoaderCtor = await loadSparkGaussianSplatLoader();
                }
            } catch (error) {
                console.warn(`ModelLoader: failed to inspect PLY header for ${url}`, error);
            }
        }

        if (LoaderCtor === undefined) {
            console.warn(`ModelLoader: no ${type} loader.`);
            return Promise.resolve(null);
        }

        const newLoader = new LoaderCtor();
        return newLoader
            .load(url, options, environment)
            .then((obj: Object3D | null) => {
                if (!obj || !obj.userData) {
                    return null;
                }

                if (!isGaussianSplatObject(obj)) {
                    ModelLoader.rememberCachedModel(cacheKey, obj);
                }
                return obj;
            })
            .catch((error: unknown) => {
                console.warn(`ModelLoader: failed to load ${type} model from ${url}`, error);
                return null;
            })
            .finally(() => {
                newLoader.dispose();
            });
    }

    async reuploadModel(modelUrl: string): Promise<string | null> {
        const modelFile = await urlToFile(
            modelUrl,
            modelUrl.split("/").pop() || "model.glb",
            ImportUtils.getFileTypeFromUrl(modelUrl),
        );

        const filename = modelUrl.split("/").pop();
        const modelUploadResult = await ImportUtils.uploadModel(modelFile);
        if (modelUploadResult) {
            console.log(`[UPLOAD COMPLETE] ${filename} → Received URL: ${modelUploadResult.url}`);

            return modelUploadResult.url;
        } else {
            const errorMsg = `Model upload failed for: ${modelUrl.split("/").pop() || modelUrl} - no result returned from server`;
            console.error(errorMsg);
            throw new Error(errorMsg);
        }
    }

    private normalizeGeometryAttributes(child: Object3D) {
        if ((child as Mesh).isMesh && (child as Mesh).geometry) {
            const geometry = (child as Mesh).geometry;
            if (normalizedGeometries.has(geometry)) {
                return;
            }

            if (!geometry.boundingBox) {
                geometry.computeBoundingBox();
            }

            // if (attributes.skinIndex && !(attributes.skinIndex.array instanceof Float32Array)) {
            //     geometry.setAttribute(
            //         "skinIndex",
            //         new Float32BufferAttribute(Float32Array.from(attributes.skinIndex.array), attributes.skinIndex.itemSize),
            //     );
            // }

            // if (attributes.skinWeight && !(attributes.skinWeight.array instanceof Float32Array)) {
            //     const attribute = attributes.skinWeight;
            //     const array = Float32Array.from(attribute.array);
            //     if (attribute.normalized) {
            //         const scale = 1.0 / (attribute.array instanceof Uint8Array ? 255 : 65535);
            //         for (let i = 0; i < array.length; i++) array[i] *= scale;
            //     }
            //     geometry.setAttribute("skinWeight", new Float32BufferAttribute(array, attribute.itemSize));
            // }
            
            const geom = (child as any).geometry;
            for (const key in geom.attributes) {
                const attr = geom.attributes[key];

                if (attr.isInterleavedBufferAttribute) {
                    if (!attr.data || !attr.data.array) {
                        console.warn(`[ModelLoader] Invalid interleaved attribute '${key}', removing.`);
                        geom.deleteAttribute(key);
                        continue;
                    }

                    const interleaved = attr.data;
                    const array = interleaved.array;
                    const stride = interleaved.stride;
                    const offset = attr.offset;
                    const itemSize = attr.itemSize;
                    const count = interleaved.count;

                    const bytesPerElement = array.BYTES_PER_ELEMENT || 4;
                    const attributeStride = itemSize * bytesPerElement;

                    // Check if stride is multiple of 4 bytes. If not, we must upgrade to Float32.
                    const needsUpgrade = attributeStride % 4 !== 0;

                    let TypedArray: any = array.BYTES_PER_ELEMENT ? array.constructor : Float32Array;
                    let normalized = attr.normalized;

                    if (needsUpgrade) {
                        TypedArray = Float32Array;
                        normalized = false;
                        // Try Float16 if available and stride is valid (multiple of 4)
                        if (typeof Float16Array !== "undefined" && itemSize * 2 % 4 === 0) {
                            TypedArray = Float16Array;
                        }
                    }

                    const unpacked = new TypedArray(count * itemSize);

                    let divisor = 1;
                    if (needsUpgrade && attr.normalized) {
                        divisor =
                            array instanceof Int8Array
                                ? 127
                                : array instanceof Uint8Array
                                  ? 255
                                  : array instanceof Int16Array
                                    ? 32767
                                    : array instanceof Uint16Array
                                      ? 65535
                                      : array instanceof Uint32Array
                                        ? 4294967295
                                        : 1;
                    }

                    for (let i = 0; i < count; i++) {
                        const baseIndex = i * stride + offset;
                        for (let j = 0; j < itemSize; j++) {
                            let val = array[baseIndex + j];
                            if (needsUpgrade && attr.normalized) {
                                val /= divisor;
                            }
                            unpacked[i * itemSize + j] = val;
                        }
                    }

                    geom.setAttribute(key, new BufferAttribute(unpacked, itemSize, normalized));
                    continue;
                }

                // --- Non-interleaved attributes ---
                // Check for invalid stride (not multiple of 4 bytes)
                if (!attr.isInterleavedBufferAttribute && attr.array) {
                    const array = attr.array;
                    const itemSize = attr.itemSize;
                    const bytesPerElement = array.BYTES_PER_ELEMENT || 4;
                    const attributeStride = itemSize * bytesPerElement;

                    if (attributeStride % 4 !== 0) {
                        // Must upgrade to Float32 or Float16
                        let TypedArray: any = Float32Array;
                        if (typeof Float16Array !== "undefined" && itemSize * 2 % 4 === 0) {
                            TypedArray = Float16Array;
                        }

                        const count = attr.count;
                        const newArray = new TypedArray(count * itemSize);

                        let divisor = 1;
                        if (attr.normalized) {
                            divisor =
                                array instanceof Int8Array
                                    ? 127
                                    : array instanceof Uint8Array
                                      ? 255
                                      : array instanceof Int16Array
                                        ? 32767
                                        : array instanceof Uint16Array
                                          ? 65535
                                          : array instanceof Uint32Array
                                            ? 4294967295
                                            : 1;
                        }

                        for (let i = 0; i < count * itemSize; i++) {
                            let val = array[i];
                            if (attr.normalized) {
                                val /= divisor;
                            }
                            newArray[i] = val;
                        }

                        geom.setAttribute(key, new BufferAttribute(newArray, itemSize, false));
                    }
                }
            }

            normalizedGeometries.add(geometry);
        }
    }
}

export default ModelLoader;
