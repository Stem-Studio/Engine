import {VRMLoaderPlugin, VRMUtils} from "@pixiv/three-vrm";
import {MeshoptDecoder} from "meshoptimizer";
import * as THREE from "three";
import {GLTFLoader} from "three/addons/loaders/GLTFLoader.js";

import BaseLoader from "./BaseLoader";
import global from "../../../global";
import {traverseObjectDepthFirst} from "../../../utils/SceneTraverser";

/**
 * VRMLoader
 *
 */
class VRMLoader extends BaseLoader {
    constructor() {
        super();
    }

    load(url) {
        return new Promise(resolve => {
            const loader = new GLTFLoader();
            loader.register(parser => {
                return new VRMLoaderPlugin(parser);
            });
            loader.setMeshoptDecoder(MeshoptDecoder);
            loader.load(
                url,
                gltf => {
                    var material;
                    const vrm = gltf.userData.vrm;
                    VRMUtils.removeUnnecessaryVertices(gltf.scene);
                    // VRMLoader doesn't support VRM Unlit extension yet so
                    // converting all materials to MeshBasicMaterial here as workaround so far.
                    traverseObjectDepthFirst(vrm.scene, object => {
                        object.frustumCulled = false;
                        if (object.material) {
                            if (Array.isArray(object.material)) {
                                for (var i = 0, il = object.material.length; i < il; i++) {
                                    material = new THREE.MeshBasicMaterial();
                                    THREE.Material.prototype.copy.call(material, object.material[i]);
                                    material.color.copy(object.material[i].color);
                                    material.map = object.material[i].map;
                                    material.lights = false;
                                    material.skinning = object.material[i].skinning;
                                    material.morphTargets = object.material[i].morphTargets;
                                    material.morphNormals = object.material[i].morphNormals;
                                    object.material[i] = material;
                                }
                            } else {
                                material = new THREE.MeshBasicMaterial();
                                THREE.Material.prototype.copy.call(material, object.material);
                                material.color.copy(object.material.color);
                                material.map = object.material.map;
                                material.lights = false;
                                material.skinning = object.material.skinning;
                                material.morphTargets = object.material.morphTargets;
                                material.morphNormals = object.material.morphNormals;
                                object.material = material;
                            }
                        }
                    });

                    vrm.scene._obj = gltf;
                    vrm.scene._root = vrm.scene;
                    global.app?.vrmExpressionControl?.registerModel(vrm);

                    resolve(vrm.scene);
                },
                undefined,
                e => {
                    console.log(e);
                    resolve(null);
                },
            );
        });
    }
}

export default VRMLoader;
