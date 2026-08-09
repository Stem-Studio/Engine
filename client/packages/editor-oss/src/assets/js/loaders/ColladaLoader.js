import * as THREE from "three";
import { ColladaLoader as ThreeColladaLoader } from "three/addons/loaders/ColladaLoader.js";

import BaseLoader from "./BaseLoader";
import {traverseObjectDepthFirst} from "../../../utils/SceneTraverser";

/**
 * ColladaLoader
 *
 */
class ColladaLoader extends BaseLoader {
    constructor() {
        super();
    }

    load(url, options) {
        return new Promise(resolve => {
            var loader = new ThreeColladaLoader();

            loader.load(
                url,
                collada => {
                    var dae = collada.scene;

                    traverseObjectDepthFirst(dae, child => {
                        if (child instanceof THREE.Mesh) {
                            child.material.flatShading = true;
                        }
                        if (child.isSkinnedMesh) {
                            child.frustumCulled = false;
                        }
                    });

                    if (isNaN(dae.scale.x) || isNaN(dae.scale.y) || isNaN(dae.scale.z)) {
                        dae.scale.x = dae.scale.y = dae.scale.z = 10.0;
                        dae.updateMatrix();
                    }

                    dae._obj = collada;
                    dae._root = dae;

                    if (collada.animations && collada.animations.length > 0) {
                        Object.assign(dae.userData, {
                            animNames: collada.animations.map(n => n.name),
                            scripts: [
                                {
                                    id: null,
                                    name: `${options.Name}${_t("Animation")}`,
                                    type: "javascript",
                                    source: this.createScripts(options.Name),
                                    uuid: THREE.MathUtils.generateUUID(),
                                },
                            ],
                        });
                    }

                    resolve(dae);
                },
                undefined,
                () => {
                    resolve(null);
                },
            );
        });
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
}

export default ColladaLoader;
