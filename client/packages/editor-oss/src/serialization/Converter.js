import * as THREE from "three";

import OptionsSerializer from "./app/OptionsSerializer";
import ScriptSerializer from "./app/ScriptSerializer";
import AudioListenerSerializer from "./audio/AudioListenerSerializer";
import AudioSerializer from "./audio/AudioSerializer";
import BaseSerializer from "./BaseSerializer";

// core
import global from "@web-shared/global";
import CamerasSerializer from "./camera/CamerasSerializer";
import BoneSerializer from "./core/BoneSerializer";
import GroupSerializer from "./core/GroupSerializer";
import MeshSerializer from "./core/MeshSerializer";
import {ModelSerializer} from "./core/ModelSerializer";
import Object3DSerializer from "./core/Object3DSerializer";
import {PrefabSerializer} from "./core/PrefabSerializer";
import SceneSerializer from "./core/SceneSerializer";
import ServerObject from "./core/ServerObject";
import SpriteSerializer from "./core/SpriteSerializer";

// app

// camera

// light
import TerrainSerializer from "./core/TerrainSerializer";
import AmbientLightSerializer from "./light/AmbientLightSerializer";
import DirectionalLightSerializer from "./light/DirectionalLightSerializer";
import HemisphereLightSerializer from "./light/HemisphereLightSerializer";
import PointLightSerializer from "./light/PointLightSerializer";
import RectAreaLightSerializer from "./light/RectAreaLightSerializer";
import SpotLightSerializer from "./light/SpotLightSerializer";

// audio

// objects
import CatmullRomCurveSerializer from "./line/CatmullRomCurveSerializer";
import CubicBezierCurveSerializer from "./line/CubicBezierCurveSerializer";
import EllipseCurveSerializer from "./line/EllipseCurveSerializer";
import LineCurveSerializer from "./line/LineCurveSerializer";
import QuadraticBezierCurveSerializer from "./line/QuadraticBezierCurveSerializer";
import FireSerializer from "./objects/FireSerializer";
import {getAssetResolutionContext} from '@web-shared/asset-management/AssetResolutionContext';
import {isModelAssetInstance} from '@web-shared/model/util';
import {isPrefab, isPrefabUnlocked} from "@web-shared/prefab/util";
import {getOrCreateDynamicRoot, getOrCreateSceneHelpersRoot} from "@web-shared/scene/dynamicRoots";
import CustomShapeSerializer from "./objects/CustomShapeSerializer";
import CustomTubeSerializer from "./objects/CustomTubeSerializer";
import PointMarkerSerializer from "./objects/mark/PointMarkerSerializer";
import ParticleEmitterSerializer from "./objects/ParticleEmitterSerializer";
import PerlinTerrainSerializer from "./objects/PerlinTerrainSerializer";
import SmokeSerializer from "./objects/SmokeSerializer";
import UnscaledTextSerializer from "./objects/text/UnscaledTextSerializer";
import Text3DSerializer from "./objects/Text3DSerializer";
import MirrorSerializer from "./objects/MirrorSerializer";
import WaterSerializer from "./objects/WaterSerializer";
import CustomShape from "../object/geometry/CustomShape";
import CustomTube from "../object/geometry/CustomTube";
import {DetectDevice} from "@web-shared/utils/DetectDevice";
import {SceneLoadProfiler} from "@web-shared/utils/SceneLoadProfiler";
import {NoDeserializeSerializers} from "../core/noDeserializeSerializers";
import {getPhysicsSettingsFromSceneJson} from "../core/scenePhysicsSettings";
import {isParticleEmitterObject} from "../utils/vfxObjectUtils";

// Device-adaptive deserialization batch size, in items per batch.
// Smaller batches on mobile yield to the main thread more often (better responsiveness,
// less memory pressure). Desktop uses larger batches for higher throughput.
//
// Earlier this was byte-based (CONVERTER_BATCH_SIZE), but most serializers
// don't write userData.FileSize, so the default fell back to 10 MB and the
// 12 MB budget collapsed into singleton batches. Trace 2026-05-04 showed
// 1046 batches of 1 item each, with ~4 ms of clamped setTimeout(0) between
// every batch — ~4.2 s of dead time on a 4.8 s converterParse. Counting items
// is the simple correct primitive; we may later switch to "N in flight".
const CONVERTER_BATCH_COUNT = DetectDevice.isMobile() ? 16 : 32;

function isThenable(value) {
    return value && typeof value.then === "function";
}

function isText3DObject(obj) {
    return Boolean(obj?.isMesh && obj.geometry?.type === "TextGeometry" && obj.userData?.textConfig);
}

// objects/text

// mark

// line

export {NoDeserializeSerializers};

// Serializer metadata historically used `constructor.name`. Production
// minifiers shorten those names (for example SceneSerializer → "Sn"), which
// makes a saved Playground scene impossible to hydrate after a hard reload.
// Recover the canonical serializer from the serialized object shape when an
// old/minified generator is encountered.
const CANONICAL_GENERATORS = new Set([
    "SceneSerializer", "ModelSerializer", "PrefabSerializer", "TerrainSerializer", "ServerObject",
    "GroupSerializer", "MeshSerializer", "SpriteSerializer", "AmbientLightSerializer",
    "DirectionalLightSerializer", "HemisphereLightSerializer", "PointLightSerializer",
    "RectAreaLightSerializer", "SpotLightSerializer", "AudioSerializer", "FireSerializer",
    "SmokeSerializer", "BoneSerializer", "ParticleEmitterSerializer", "PerlinTerrainSerializer",
    "WaterSerializer", "MirrorSerializer", "LineCurveSerializer", "CatmullRomCurveSerializer",
    "QuadraticBezierCurveSerializer", "CubicBezierCurveSerializer", "EllipseCurveSerializer",
    "Object3DSerializer", "UnscaledTextSerializer", "PointMarkerSerializer", "CustomShapeSerializer",
    "CustomTubeSerializer", "Text3DSerializer", "OptionsSerializer", "CamerasSerializer",
]);

const canonicalGeneratorFor = (json) => {
    const generator = json?.metadata?.generator;
    if (typeof generator === "string" && CANONICAL_GENERATORS.has(generator)) return generator;
    if (typeof json?.modelId === "string") return "ModelSerializer";
    // The Scene serializer intentionally omits default Object3D properties,
    // including `type`; its persisted child-index is the stable discriminator.
    if (Array.isArray(json?.userData?.children)) return "SceneSerializer";

    switch (json?.type) {
        case "Scene": return "SceneSerializer";
        case "Group": return "GroupSerializer";
        case "Mesh": return "MeshSerializer";
        case "Sprite": return "SpriteSerializer";
        case "AmbientLight": return "AmbientLightSerializer";
        case "DirectionalLight": return "DirectionalLightSerializer";
        case "HemisphereLight": return "HemisphereLightSerializer";
        case "PointLight": return "PointLightSerializer";
        case "RectAreaLight": return "RectAreaLightSerializer";
        case "SpotLight": return "SpotLightSerializer";
        case "Audio": return "AudioSerializer";
        case "Bone": return "BoneSerializer";
        case "Object3D": return "Object3DSerializer";
        default:
            // Plain Object3D serializers also omit their default `type`, but
            // retain a UUID. This catches minified BaseSerializer names while
            // leaving option/script metadata (which has no UUID) untouched.
            return typeof json?.uuid === "string" ? "Object3DSerializer" : generator;
    }
};

const TYPES_TO_OMIT = ["LineSegments"];

/**
 * Scene Serialization/Deserialization Class
 * Handles the conversion of 3D scenes and objects to and from JSON format
 */
class Converter extends BaseSerializer {
    /**
     * Creates a new Converter instance
     * @param {Object} physics - Physics engine instance (optional)
     * @param {boolean} convertServerObjUrls - Whether to force absolute URLs for server objects
     */

    constructor(physics = null, convertServerObjUrls = false) {
        super();
        this.physics = physics;
        this.convertServerObjUrls = convertServerObjUrls;
        this.dynamicGroup = null;
    }

    /**
     * Read physics settings from an unparsed scene JSON without doing the full
     * converter parse. Used by callers that need to start engine WASM preload
     * before `fromJson` runs (e.g. spawning the physics worker in parallel
     * with `converterParse`).
     *
     * Falls back to the legacy `userData.game.gravity` location for older
     * scenes where gravity wasn't yet stored under `userData.physics`.
     *
     * @param {Array} jsons - The unparsed scene data array (the same shape `fromJson` accepts)
     * @returns {{engine: string | undefined, gravity: number | undefined}}
     */
    static getPhysicsSettings(jsons) {
        return getPhysicsSettingsFromSceneJson(jsons);
    }

    /**
     * Converts the application state to JSON
     * @param {Object} obj - Object to be serialized
     * @param {Object} obj.options - Configuration information
     * @param {THREE.Camera} obj.camera - Camera instance
     * @param {Array} obj.scripts - List of scripts
     * @param {THREE.Scene} obj.scene - Scene instance
     * @returns {any[]} JSON data
     */
    toJSON({options, camera, scripts, scene}) {
        const list = [];

        // Configuration
        const configJson = options ? new OptionsSerializer().toJSON(options) : null;
        list.push(configJson);

        // Camera
        const cameraJson = camera ? new CamerasSerializer().toJSON(camera) : null;
        list.push(cameraJson);

        // Scripts
        const scriptsJson = scripts ? new ScriptSerializer().toJSON(scripts) : null;
        scriptsJson?.forEach(n => {
            list.push(n);
        });

        // Audio Listener
        const audioListener = camera?.children.filter(n => n instanceof THREE.AudioListener)[0];
        if (audioListener) {
            const audioListenerJson = new AudioListenerSerializer().toJSON(audioListener);
            list.push(audioListenerJson);
        }

        // Convert scene to JSON
        const children = []; // Store hierarchy structure in scene for scene loading restoration

        this.traverse(scene, children, list, options, false);

        const filteredList = list.filter(n => n !== null); // Temporary fix for null values
        const sceneJson = filteredList.filter(n => n.uuid === scene.uuid)[0];

        if (sceneJson) {
            sceneJson.userData = sceneJson.userData || {};
            sceneJson.userData.children = children;
        } else {
            console.warn(`Converter: no scene json with id ${scene.uuid}`);
        }

        return filteredList;
    }

    /**
     * Converts a 3D object to JSON
     * @param {THREE.Object3D} obj - 3D object to convert
     * @param {Object} children - Child structure
     * @param {Array} list - JSON list
     * @param {Object} options - Configuration information
     * @param {Boolean} isServerObject - Whether this is an internal model component
     */
    serializeObject(obj, options, isServerObject) {
        let json = null;

        if (isPrefab(obj) && !isPrefabUnlocked(obj)) {
            json = new PrefabSerializer().toJSON(obj);
        } else if (obj.userData?.modelId) {
            json = new ModelSerializer().toJSON(obj);
        } else if (obj.userData?.Terrain === true) {
            json = new TerrainSerializer(this.convertServerObjUrls).toJSON(obj);
        } else if (obj.userData?.Server === true) {
            // Server object
            isServerObject = true;
            json = new ServerObject(this.convertServerObjUrls).toJSON(obj);
        } else if (obj.userData?.type === "Fire") {
            // Fire effect
            json = new FireSerializer().toJSON(obj);
        } else if (obj.userData?.type === "Smoke") {
            // Smoke effect
            json = new SmokeSerializer().toJSON(obj);
        } else if (isParticleEmitterObject(obj)) {
            // Particle emitter
            json = new ParticleEmitterSerializer().toJSON(obj);
        } else if (obj.userData?.type === "PerlinTerrain") {
            // Perlin terrain
            json = new PerlinTerrainSerializer().toJSON(obj);
        } else if (obj.userData?.type === "Water") {
            json = new WaterSerializer().toJSON(obj);
        } else if (obj.userData?.type === "Mirror") {
            json = new MirrorSerializer().toJSON(obj);
        } else if (obj.userData?.type === "LineCurve") {
            json = new LineCurveSerializer().toJSON(obj);
        } else if (obj.userData?.type === "CatmullRomCurve") {
            json = new CatmullRomCurveSerializer().toJSON(obj);
        } else if (obj.userData?.type === "QuadraticBezierCurve") {
            json = new QuadraticBezierCurveSerializer().toJSON(obj);
        } else if (obj.userData?.type === "CubicBezierCurve") {
            json = new CubicBezierCurveSerializer().toJSON(obj);
        } else if (obj.userData?.type === "EllipseCurve") {
            json = new EllipseCurveSerializer().toJSON(obj);
        } else if (isText3DObject(obj)) {
            // CRITICAL: Text3D must be checked BEFORE userData.type checks and BEFORE THREE.Mesh!
            // This ensures Text3D objects are always serialized with Text3DSerializer
            json = new Text3DSerializer().toJSON(obj, {
                saveMaterial: options?.saveMaterial === false && isServerObject ? false : true,
            });
        } else if (obj.userData?.type === "pointMarker") {
            json = new PointMarkerSerializer().toJSON(obj);
        } else if (obj instanceof THREE.Scene) {
            json = new SceneSerializer().toJSON(obj);
        } else if (obj instanceof THREE.Group) {
            json = new GroupSerializer().toJSON(obj);
        } else if (obj instanceof CustomShape) {
            // CustomShape must be checked before THREE.Mesh since it extends Mesh
            json = new CustomShapeSerializer().toJSON(obj, {
                saveMaterial: options?.saveMaterial === false && isServerObject ? false : true,
            });
        } else if (obj instanceof CustomTube) {
            // CustomTube must be checked before THREE.Mesh since it extends Mesh
            json = new CustomTubeSerializer().toJSON(obj, {
                saveMaterial: options?.saveMaterial === false && isServerObject ? false : true,
            });
        } else if (obj instanceof THREE.Mesh) {
            // If options.saveMaterial is false, don't save internal model materials
            json = new MeshSerializer().toJSON(obj, {
                saveMaterial: options?.saveMaterial === false && isServerObject ? false : true,
            });
        } else if (obj instanceof THREE.Sprite) {
            json = new SpriteSerializer().toJSON(obj);
        } else if (obj instanceof THREE.AmbientLight) {
            json = new AmbientLightSerializer().toJSON(obj);
        } else if (obj instanceof THREE.DirectionalLight) {
            json = new DirectionalLightSerializer().toJSON(obj);
        } else if (obj instanceof THREE.HemisphereLight) {
            json = new HemisphereLightSerializer().toJSON(obj);
        } else if (obj instanceof THREE.PointLight) {
            json = new PointLightSerializer().toJSON(obj);
        } else if (obj instanceof THREE.RectAreaLight) {
            json = new RectAreaLightSerializer().toJSON(obj);
        } else if (obj instanceof THREE.SpotLight) {
            json = new SpotLightSerializer().toJSON(obj);
        } else if (obj instanceof THREE.Audio) {
            json = new AudioSerializer().toJSON(obj);
        } else if (obj instanceof THREE.Bone) {
            json = new BoneSerializer().toJSON(obj);
        } else if (obj instanceof THREE.Object3D) {
            json = new Object3DSerializer().toJSON(obj);
        }

        return json;
    }

    traverse(obj, children, list, options, isServerObject) {
        const stack = [{object: obj, children, isServerObject}];

        while (stack.length > 0) {
            const frame = stack.pop();
            if (!frame?.object) continue;

            const current = frame.object;
            if (current.userData?.isRuntimeOnly) {
                // Skip objects generated at runtime.
                continue;
            }

            const currentIsServerObject = frame.isServerObject || current.userData?.Server === true;
            const json = this.serializeObject(current, options, currentIsServerObject);

            if (json) {
                list.push(json);
            } else {
                console.warn(`Converter: No ${current.constructor.name} Serializer.`);
            }

            // 1. For prefab instances, do not serialize children
            if (isPrefab(current) && !isPrefabUnlocked(current)) {
                continue;
            }

            // 2. For model asset instances, do not serialize children
            if (isModelAssetInstance(current)) {
                continue;
            }

            // 3. For server models (ServerObject), if saveChild is not set, don't save internal model information
            if (current.userData?.Server === true && !options?.saveChild) {
                this.queueSerializableChildren(current, frame.children, stack, currentIsServerObject);
                continue;
            }

            // 4. If obj.userData.type is not empty, it's a built-in type and its children should not be serialized
            if (current.children && current.userData?.type === undefined) {
                this.queueSerializableChildren(current, frame.children, stack, currentIsServerObject);
            }
        }

        return list;
    }

    queueSerializableChildren(parent, children, stack, isServerObject) {
        const frames = [];
        for (let i = 0; i < parent.children.length; i++) {
            const child = parent.children[i];
            if (child.userData?.isRuntimeOnly) continue;

            const childChildren = [];
            children.push({
                uuid: child.uuid,
                children: childChildren,
            });
            frames.push({
                object: child,
                children: childChildren,
                isServerObject,
            });
        }

        for (let i = frames.length - 1; i >= 0; i--) {
            stack.push(frames[i]);
        }
    }

    /**
     * Deserializes a scene from JSON
     * @param {Array} jsons - JSON objects (list)
     * @param {Object} options - Configuration options
     * @param {String} options.server - Server address for downloading models, textures, and other resources
     * @param {Object | undefined} options.assetResolutionContext - Context for resolving asset IDs
     * @param {Object | undefined} options.assetLoader - AssetLoader instance for efficient model loading
     * @param {THREE.Camera} options.camera - Old camera instance
     * @param {Number} options.domWidth - Canvas width
     * @param {Number} options.domHeight - Canvas height
     * @returns {Promise} JSON data
     */
    fromJson(jsons, options) {
        // Normalize legacy/minified serializer names before any generator
        // lookup. This keeps production bundles reload-compatible with
        // scenes serialized by a minified build.
        jsons = Array.isArray(jsons)
            ? jsons.map(json => {
                  const generator = canonicalGeneratorFor(json);
                  return generator && generator !== json?.metadata?.generator
                      ? {...json, metadata: {...json.metadata, generator}}
                      : json;
              })
            : jsons;
        const obj = {
            options: null,
            camera: null,
            renderer: null,
            scripts: null,
            svg: {html: ""},
            scene: null,

            // Configuration options
            oldCamera: options.camera,
            server: options.server, // Current server option for displaying scene data across different servers
            assetResolutionContext: options.assetResolutionContext,
            assetLoader: options.assetLoader,
            domWidth: options.domWidth || 1422,
            domHeight: options.domHeight || 715,
        };

        // Build a generator lookup map to avoid repeated O(n) scans
        const byGenerator = new Map();
        for (const n of jsons) {
            if (!n.metadata?.generator) continue;
            const gen = n.metadata.generator;
            if (!byGenerator.has(gen)) {
                byGenerator.set(gen, []);
            }
            byGenerator.get(gen).push(n);
        }

        // Configuration
        const optionsJson = byGenerator.get("OptionsSerializer")?.[0];
        if (optionsJson) {
            obj.options = new OptionsSerializer().fromJSON(optionsJson);
        } else {
            console.warn(`Converter: No config info in the scene.`);
        }

        // Camera — generator name contains "CameraSerializer"
        const cameraJson = jsons.find(n => n.metadata?.generator?.indexOf("CameraSerializer") > -1);
        if (cameraJson) {
            obj.camera = new CamerasSerializer().fromJSON(cameraJson);
        } else {
            console.warn(`Converter: No camera info in the scene.`);
        }

        // 1. When loading a scene with camera parameters, use the editor's built-in camera
        // 2. During playback, if no camera parameters are provided, use the newly generated camera
        if (!obj.oldCamera) {
            obj.oldCamera = obj.camera;
        } else if (!obj.camera) {
            obj.camera = obj.oldCamera;
        }

        // Scripts
        const scriptJsons = byGenerator.get("ScriptSerializer");
        if (scriptJsons) {
            obj.scripts = new ScriptSerializer().fromJSON(scriptJsons);
        }

        // Audio Listener
        const audioListenerJson = byGenerator.get("AudioListenerSerializer")?.[0];
        let audioListener;
        if (audioListenerJson) {
            audioListener = new AudioListenerSerializer().fromJSON(audioListenerJson);
        }
        if (!audioListener) {
            console.warn(`Converter: No AudioListener in the scene.`);
            audioListener = new THREE.AudioListener();
        }
        obj.audioListener = audioListener;
        obj.camera.add(audioListener);

        return new Promise(resolve => {
            this.parse(jsons, obj).then(scene => {
                obj.scene = scene;

                // Reuse or create runtime-only roots.
                const dynamicGroup = getOrCreateDynamicRoot(obj.scene);
                getOrCreateSceneHelpersRoot(obj.scene);

                // Add lights only once per dynamicGroup instance
                if (!dynamicGroup.userData.lightsInitialized) {
                    const ambient = new THREE.AmbientLight(0xffffff, 1.0);
                    ambient.name = "AmbientLight";
                    ambient.userData.isRuntimeOnly = true;
                    ambient.userData.isSelectable = false;
                    dynamicGroup.add(ambient);

                    const hemisphere = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
                    hemisphere.name = "HemisphereLight";
                    hemisphere.userData.isRuntimeOnly = true;
                    hemisphere.userData.isSelectable = false;
                    dynamicGroup.add(hemisphere);

                    dynamicGroup.userData.lightsInitialized = true;
                }

                // Runtime flags
                dynamicGroup.userData.isStemObject = false;
                dynamicGroup.userData.isRuntimeOnly = true;
                dynamicGroup.userData.isSelectable = false;

                // Store reference
                this.dynamicGroup = dynamicGroup;

                resolve(obj);
            });
        });
    }

    /**
     * Converts JSON to scene
     * @param {Array} jsons - List of deserialized objects
     * @param {Object} options - Configuration information
     * @returns {Object} JSON data
     */
    parse(jsons, options) {
        let sceneJson = jsons.find(n => canonicalGeneratorFor(n) === "SceneSerializer");
        if (!sceneJson) {
            console.warn(`Converter: No scene info in the scene.`);
            const scene = new THREE.Scene();
            scene.name = 'ConverterEmptyScene';
            return Promise.resolve(scene);
        }

        let scene = new SceneSerializer().fromJSON(sceneJson, undefined, options);
        let children = sceneJson.userData.children;

        let parts = [scene];
        let serverParts = [];

        const MAX_BATCH_COUNT = CONVERTER_BATCH_COUNT;
        // Skip the post-batch yield when the batch did less than this much
        // wall-clock work. setTimeout(0) clamps to ~4 ms in Chrome, so without
        // a gate a stream of trivial sync serializers spends ~4 ms idle
        // between every batch. The 8 ms threshold matches a 120 Hz frame
        // budget — yield only when this batch alone could plausibly cause a
        // dropped frame.
        const YIELD_THRESHOLD_MS = 8;

        const processInBatches = async (promises) => {
            let index = 0;
            let batchSeq = 0;

            while (index < promises.length) {
                const batchStart = index;
                const batchEnd = Math.min(index + MAX_BATCH_COUNT, promises.length);
                const batchPromises = promises.slice(batchStart, batchEnd);
                index = batchEnd;

                global.app.loadingManager?.updateStageProgress(index / promises.length);

                const stage = `converterBatch-${batchSeq}-[${batchStart}..${index - 1}]`;
                SceneLoadProfiler.begin(stage);
                const t0 = performance.now();
                await Promise.all(batchPromises);
                const elapsed = performance.now() - t0;
                SceneLoadProfiler.end(stage);
                batchSeq++;

                // Yield to the main thread only when this batch did meaningful
                // work — see YIELD_THRESHOLD_MS comment above.
                if (index < promises.length && elapsed >= YIELD_THRESHOLD_MS) {
                    await new Promise(r => setTimeout(r, 0));
                }
            }
        };

        let promises = jsons.map((n) => {
            const generator = n.metadata.generator;

            if (TYPES_TO_OMIT.includes(n.type)) {
                return Promise.resolve();
            }

            try {
                return this.deserializeObject(n, options, parts, serverParts)?.promise ?? Promise.resolve();
            } catch (err) {
                console.error(`Error processing generator`, generator, err);
                return Promise.resolve();
            }
        });

        return new Promise(resolve => {
            processInBatches(promises).then(() => {
                SceneLoadProfiler.begin("converterParseScene");
                this.parseScene(scene, children, parts, serverParts, options);
                SceneLoadProfiler.end("converterParseScene");
                resolve(scene);
            });
        });
    }

    async deserializeObjectFromArray(jsons, options, parts = [], serverParts = []) {
        jsons = Array.isArray(jsons)
            ? jsons.map(json => {
                  const generator = canonicalGeneratorFor(json);
                  return generator && generator !== json?.metadata?.generator
                      ? {...json, metadata: {...json.metadata, generator}}
                      : json;
              })
            : jsons;
        const data = jsons.map(n => this.deserializeObject(n, options, parts, serverParts));
        const promises = data.map(n => n.promise);
        await Promise.all(promises);
        const objects = data.map(n => n.serverObjects[n.serverObjects?.length - 1] || n.object || null);
        this.parseScene(objects[0], [], parts, serverParts, options);
        return objects[0];
    }

    deserializeObject(n, options, parts = [], serverParts = []) {
        const generator = canonicalGeneratorFor(n);
        if (generator && generator !== n?.metadata?.generator) {
            n = {...n, metadata: {...n.metadata, generator}};
        }
        let promise;
        if (options.options?.server) {
            options.server = options.options.server;
        }

        // The asset revision context is needed to deserialize the prefab.
        // First try to get it from the options. If it doesn't exist, try to
        // get it from the scene. The scene should be parts[0].
        let assetResolutionContext = options.assetResolutionContext;
        if (!assetResolutionContext) {
            const scene = parts[0];
            if (scene instanceof THREE.Scene) {
                assetResolutionContext = getAssetResolutionContext(scene);
            }
        }

        assetResolutionContext = assetResolutionContext || {};

        if (generator === "PrefabSerializer") {
            promise = SceneLoadProfiler.time("converterSerializer-Prefab", new Promise(resolve => {
                new PrefabSerializer()
                    .fromJSON(n, undefined, { ...options, assetResolutionContext })
                    .then(obj => {
                        serverParts.push(obj);
                        resolve();
                    })
                    .catch(err => {
                        console.error("PrefabSerializer.fromJSON failed: ", err);
                        resolve(); // Resolve promise even on error to continue
                    });
            }));
        } else if (generator === "ModelSerializer") {
            promise = SceneLoadProfiler.time("converterSerializer-Model", new Promise(resolve => {
                new ModelSerializer()
                    .fromJSON(n, undefined, { ...options, assetResolutionContext })
                    .then(obj => {
                        serverParts.push(obj);
                        resolve();
                    })
                    .catch(err => {
                        console.error("ModelSerializer.fromJSON failed: ", err);
                        resolve(); // Resolve promise even on error to continue
                    });
            }));
        } else if (generator === "TerrainSerializer") {
            promise = SceneLoadProfiler.time("converterSerializer-Terrain", new Promise(resolve => {
                new TerrainSerializer(false, this.physics)
                    .fromJSON(n, undefined, options)
                    .then(obj => {
                        parts.push(obj);
                        resolve();
                    })
                    .catch(e => {
                        console.error("TerrainSerializer.fromJSON failed: " + e);
                        resolve(); // Resolve promise even on error to continue
                    });
            }));
        } else if (generator === "ServerObject") {
            parts.push(new Object3DSerializer().fromJSON(n));
            promise = SceneLoadProfiler.time("converterSerializer-ServerObject", new Promise(resolve => {
                new ServerObject()
                    .fromJSON(n, undefined, options)
                    .then(obj => {
                        if (obj) {
                            if (!options.options?.saveChild) {
                                serverParts.push(obj);
                            } else {
                                this.traverseServerObject(obj, serverParts);
                            }
                        } else {
                            console.warn(`Converter: ${n.uuid} loaded failed.`);
                        }
                        resolve();
                    })
                    .catch(e => {
                        console.error(`ServerObject fromJSON failed: ${n.uuid}: ${e}`);
                        resolve();
                    });
            }));
        } else if (NoDeserializeSerializers.indexOf(generator) > -1) {
            // Do nothing for these types
            promise = Promise.resolve();
        } else if (generator === "GroupSerializer") {
            parts.push(new GroupSerializer().fromJSON(n));
            promise = Promise.resolve();
        } else if (generator === "SceneSerializer") {
            parts.push(new SceneSerializer().fromJSON(n, undefined, options));
            promise = Promise.resolve();
        } else if (generator === "MeshSerializer") {
            const mesh = new MeshSerializer().fromJSON(n, undefined, options);
            if (isThenable(mesh)) {
                promise = SceneLoadProfiler.time("converterSerializer-Mesh", mesh
                    .then(obj => {
                        if (obj) parts.push(obj);
                    })
                    .catch(err => {
                        console.error("Failed to deserialize Mesh:", err);
                    }));
            } else {
                parts.push(mesh);
                promise = Promise.resolve();
            }
        } else if (generator === "SpriteSerializer") {
            parts.push(new SpriteSerializer().fromJSON(n, undefined, options));
            promise = Promise.resolve();
        } else if (generator === "AmbientLightSerializer") {
            parts.push(new AmbientLightSerializer().fromJSON(n));
            promise = Promise.resolve();
        } else if (generator === "DirectionalLightSerializer") {
            parts.push(new DirectionalLightSerializer().fromJSON(n));
            promise = Promise.resolve();
        } else if (generator === "HemisphereLightSerializer") {
            parts.push(new HemisphereLightSerializer().fromJSON(n));
            promise = Promise.resolve();
        } else if (generator === "PointLightSerializer") {
            parts.push(new PointLightSerializer().fromJSON(n));
            promise = Promise.resolve();
        } else if (generator === "RectAreaLightSerializer") {
            parts.push(new RectAreaLightSerializer().fromJSON(n));
            promise = Promise.resolve();
        } else if (generator === "SpotLightSerializer") {
            parts.push(new SpotLightSerializer().fromJSON(n));
            promise = Promise.resolve();
        } else if (generator === "AudioSerializer") {
            parts.push(new AudioSerializer().fromJSON(n, undefined, options));
            promise = Promise.resolve();
        } else if (generator === "FireSerializer") {
            parts.push(new FireSerializer().fromJSON(n, undefined, options));
            promise = Promise.resolve();
        } else if (generator === "SmokeSerializer") {
            parts.push(new SmokeSerializer().fromJSON(n, undefined, options));
            promise = Promise.resolve();
        } else if (generator === "BoneSerializer") {
            parts.push(new BoneSerializer().fromJSON(n));
            promise = Promise.resolve();
        } else if (generator === "ParticleEmitterSerializer") {
            promise = SceneLoadProfiler.time("converterSerializer-ParticleEmitter", new ParticleEmitterSerializer()
                .fromJSON(n, undefined, options)
                .then(obj => {
                    if (obj) parts.push(obj);
                })
                .catch(err => {
                    console.error("Failed to deserialize ParticleEmitter:", err);
                }));
        } else if (generator === "PerlinTerrainSerializer") {
            parts.push(new PerlinTerrainSerializer().fromJSON(n));
            promise = Promise.resolve();
        } else if (generator === "WaterSerializer") {
            parts.push(new WaterSerializer().fromJSON(n, undefined, options));
            promise = Promise.resolve();
        } else if (generator === "MirrorSerializer") {
            parts.push(new MirrorSerializer().fromJSON(n));
            promise = Promise.resolve();
        } else if (generator === "LineCurveSerializer") {
            parts.push(new LineCurveSerializer().fromJSON(n));
            promise = Promise.resolve();
        } else if (generator === "CatmullRomCurveSerializer") {
            parts.push(new CatmullRomCurveSerializer().fromJSON(n));
            promise = Promise.resolve();
        } else if (generator === "QuadraticBezierCurveSerializer") {
            parts.push(new QuadraticBezierCurveSerializer().fromJSON(n));
            promise = Promise.resolve();
        } else if (generator === "CubicBezierCurveSerializer") {
            parts.push(new CubicBezierCurveSerializer().fromJSON(n));
            promise = Promise.resolve();
        } else if (generator === "EllipseCurveSerializer") {
            parts.push(new EllipseCurveSerializer().fromJSON(n));
            promise = Promise.resolve();
        } else if (generator === "Object3DSerializer") {
            parts.push(new Object3DSerializer().fromJSON(n));
            promise = Promise.resolve();
        } else if (generator === "UnscaledTextSerializer") {
            parts.push(
                new UnscaledTextSerializer().fromJSON(n, undefined, {
                    domWidth: options.domWidth,
                    domHeight: options.domHeight,
                }),
            );
            promise = Promise.resolve();
        } else if (generator === "PointMarkerSerializer") {
            parts.push(
                new PointMarkerSerializer().fromJSON(n, undefined, {
                    domWidth: options.domWidth,
                    domHeight: options.domHeight,
                }),
            );
            promise = Promise.resolve();
        } else if (generator === "CustomShapeSerializer") {
            parts.push(new CustomShapeSerializer().fromJSON(n, undefined, options.server));
            promise = Promise.resolve();
        } else if (generator === "CustomTubeSerializer") {
            parts.push(new CustomTubeSerializer().fromJSON(n, undefined, options.server));
            promise = Promise.resolve();
        } else if (generator === "Text3DSerializer") {
            // Text3DSerializer is async (loads fonts), so handle as promise
            promise = SceneLoadProfiler.time("converterSerializer-Text3D", new Text3DSerializer()
                .fromJSON(n, undefined, options.server)
                .then(obj => {
                    if (obj) parts.push(obj);
                })
                .catch(err => {
                    console.error("Failed to deserialize Text3D:", err);
                }));
        } else {
            console.warn(`Converter: No Deserializer with ${generator}.`);
            promise = Promise.resolve();
        }

        return {
            promise: promise,
            get object() {
                return parts[parts.length - 1];
            },
            serverObjects: serverParts,
        };
    }

    /**
     * Rebuilds the scene hierarchy based on the children array or parts and serverParts arrays.
     * @param {THREE.Object3D} scene - The root object (usually the scene)
     * @param {Array} children - Array of child objects
     * @param {Array} parts - Array of deserialized THREE.js objects
     * @param {Array} serverParts - Array of server model objects
     * @param {Object} options - Configuration information
     */
    parseScene(scene, children, parts, serverParts, options) {
        if (children && children.length > 0) {
            // If children exist, use the children array to rebuild the scene hierarchy
            this.parseSceneBasedOnChildrenArr(
                scene,
                children,
                parts,
                serverParts,
                options,
                this.createSceneLookupMaps(parts, serverParts),
            );
        } else {
            // If no children, use the parts and serverParts arrays to rebuild the scene
            this.parseSceneBasedOnParts(scene, parts, serverParts);
        }
    }

    createSceneLookupMaps(parts, serverParts) {
        const serverPartsMap = new Map();
        const partsMap = new Map();

        serverParts.forEach(obj => {
            if (obj?.uuid) {
                serverPartsMap.set(obj.uuid, obj);
            }
        });

        parts.forEach(obj => {
            if (obj?.uuid) {
                partsMap.set(obj.uuid, obj);
            }
        });

        return {serverPartsMap, partsMap};
    }

    /**
     * Rebuilds the scene hierarchy by assigning children to their parents using parts and serverParts arrays.
     * @param {THREE.Object3D} scene - The root object (usually the scene)
     * @param {Array} parts - Array of deserialized THREE.js objects
     * @param {Array} serverParts - Array of server model objects
     */
    parseSceneBasedOnParts(scene, parts, serverParts) {
        // 1. Clear all children from parts to avoid duplicates
        parts.forEach(obj => {
            if (obj && obj.children && obj.children.length) {
                for (let i = obj.children.length - 1; i >= 0; i--) {
                    obj.remove(obj.children[i]);
                }
            }
        });

        // 2. Replace objects in parts with their full versions from serverParts by UUID
        const serverMap = new Map();
        serverParts.forEach(obj => {
            if (obj && obj.uuid) serverMap.set(obj.uuid, obj);
        });

        for (let i = 0; i < parts.length; i++) {
            const obj = parts[i];
            if (obj && obj.uuid && serverMap.has(obj.uuid)) {
                parts[i] = serverMap.get(obj.uuid);
            }
        }

        // 3. Add any serverParts not already in parts
        const partsUuids = new Set(parts.map(obj => obj && obj.uuid).filter(Boolean));
        serverParts.forEach(obj => {
            if (obj && obj.uuid && !partsUuids.has(obj.uuid)) {
                parts.push(obj);
            }
        });

        // 4. Build a map of uuid -> object for fast lookup
        const uuidMap = new Map();
        parts.forEach(obj => {
            if (obj && obj.uuid) {
                uuidMap.set(obj.uuid, obj);
            }
        });

        // 5. Assign children to their parents
        parts.forEach(obj => {
            if (!obj || !obj.parentUuid) return;
            const parentObj = uuidMap.get(obj.parentUuid);
            if (!parentObj) return;
            if (parentObj === obj) return;
            if (obj.type === "Scene" && parentObj.type === "Scene") return;
            parentObj.add(obj);
        });

        // 6. Attach root-level objects to the parent (scene)
        parts.forEach(obj => {
            if (!obj) return;
            if (!obj.parentUuid || !uuidMap.has(obj.parentUuid)) {
                if (obj !== scene && obj.type !== "Scene") {
                    scene.add(obj);
                }
            }
        });
    }

    /**
     * New scene assembly method
     * @param {THREE.Object3D} parent - Parent component
     * @param {Array} children - Child components
     * @param {Array} parts - Parts obtained from deserialized JSON
     * @param {Array} serverParts - Components decomposed from server model
     * @param {Object} options - Configuration information
     * @description Since only the materials of server models are serialized, server model components are prioritized for scene construction, and serialized materials are used to replace server materials.
     */
    parseSceneBasedOnChildrenArr(parent, children, parts, serverParts, options, lookupMaps) {
        // Build UUID lookup maps once per parse. Large scenes commonly recurse
        // through thousands of children, so rebuilding the same maps at every
        // level turns hierarchy assembly into avoidable O(depth * objects) work.
        const maps = lookupMaps || this.createSceneLookupMaps(parts, serverParts);
        const {serverPartsMap, partsMap} = maps;
        const stack = [{parent, children}];

        while (stack.length > 0) {
            const frame = stack.pop();
            if (!frame) continue;
            const childFrames = [];

            frame.children.forEach(child => {
                if (!child) {
                    console.warn('Converter: Skipping null/undefined child in children array');
                    return;
                }
                let obj = serverPartsMap.get(child.uuid);
                let isServerObject = false;

                if (obj) {
                    // Server component
                    isServerObject = true;
                    // Save internal model components
                    let obj1 = partsMap.get(child.uuid);

                    if (obj1) {
                        obj.name = obj1.name;
                        obj.position.copy(obj1.position);
                        obj.rotation.copy(obj1.rotation);
                        obj.scale.copy(obj1.scale);
                        obj.visible = obj1.visible;
                    } else {
                        console.warn(`Converter: The components of ServerObject ${child.uuid} is not serialized.`);
                    }
                } else {
                    obj = partsMap.get(child.uuid);
                }

                if (!obj) {
                    console.warn(`Converter: no element with uuid ${child.uuid}.`);
                    return;
                }

                frame.parent.add(obj);

                // 1. For server models (ServerObject), only save internal model options when saveChild is not false
                if ((isServerObject && options.options?.saveChild !== false || !isServerObject) && child.children?.length) {
                    childFrames.push({parent: obj, children: child.children});
                }
            });

            for (let i = childFrames.length - 1; i >= 0; i--) {
                stack.push(childFrames[i]);
            }
        }
    }

    /**
     * Decomposes a server model into components and removes child components
     * @param {THREE.Object3D} obj - Object3D instance
     * @param {Array} list - List to store components
     */
    traverseServerObject(obj, list) {
        list.push(obj);

        while (obj.children && obj.children.length) {
            let child = obj.children[0];
            obj.remove(child);
            this.traverseServerObject(child, list);
        }
    }

    /**
     * Converts JSON to a scene as a group
     * @param {Array} jsons - JSON objects
     * @param {Object} options - Configuration options
     * @returns {Promise} Promise that resolves with the scene object
     */
    sceneAsGroupFromJson(jsons, options) {
        let obj = {
            options: null,
            scene: null,
            server: options.server,
            domWidth: options.domWidth || 1422,
            domHeight: options.domHeight || 715,
        };

        // Configuration
        let optionsJson = jsons.filter(n => n.metadata && n.metadata.generator === "OptionsSerializer")[0];
        if (optionsJson) {
            obj.options = new OptionsSerializer().fromJSON(optionsJson);
        } else {
            console.warn(`Converter: No config info in the scene.`);
        }

        return this.parseAsGroup(jsons, obj).then(scene => {
            obj.scene = scene;
            return obj;
        });
    }

    /**
     * Parses JSON and converts it to a group
     * @param {Array} jsons - JSON objects
     * @param {Object} options - Configuration options
     * @returns {Promise} Promise that resolves with the group
     */
    parseAsGroup(jsons, options) {
        let sceneJson = jsons.find(n => n.metadata && n.metadata.generator === "SceneSerializer");

        let scene = new THREE.Group();
        let children = null;
        if (sceneJson) {
            scene.name = sceneJson.userData.Name;
            children = sceneJson.userData.children;
        }

        let parts = [scene];
        let serverParts = [];

        const MAX_BATCH_COUNT = CONVERTER_BATCH_COUNT;
        const YIELD_THRESHOLD_MS = 8;

        const processInBatches = async (promises) => {
            let index = 0;

            while (index < promises.length) {
                const batchEnd = Math.min(index + MAX_BATCH_COUNT, promises.length);
                const batchPromises = promises.slice(index, batchEnd);
                index = batchEnd;

                const t0 = performance.now();
                await Promise.all(batchPromises);
                const elapsed = performance.now() - t0;

                if (index < promises.length && elapsed >= YIELD_THRESHOLD_MS) {
                    await new Promise(r => setTimeout(r, 0));
                }
            }
        };

        let promises = jsons.map((n) => {
            const generator = n.metadata.generator;

            try {
                return this.deserializeObject(n, options, parts, serverParts)?.promise ?? Promise.resolve();
            } catch (err) {
                console.error(`Error processing generator`, generator, err);
                return Promise.resolve();
            }
        });

        return new Promise(resolve => {
            processInBatches(promises).then(() => {
                this.parseScene(scene, children, parts, serverParts, options);
                resolve(scene);
            });
        });
    }

    /**
     * Creates a deep clone of a scene
     * @param {THREE.Scene} originalScene - The scene to clone
     * @param {Object} options - Configuration options
     * @param {Object} options.options - Scene options
     * @param {THREE.Camera} options.camera - Camera instance
     * @param {Array} options.scripts - List of scripts
     * @param {String} options.server - Server address
     * @returns {Promise<THREE.Scene>} Promise that resolves with the cloned scene
     */
    cloneScene(originalScene, options = {}) {
        const json = this.toJSON({
            scene: originalScene,
            options: options.options || {},
            camera: options.camera,
            scripts: options.scripts || [],
            server: options.server,
        });

        return this.fromJson(json, {
            camera: options.camera,
            server: options.server,
            domWidth: options.domWidth,
            domHeight: options.domHeight,
        }).then(result => result.scene);
    }
}

export default Converter;
