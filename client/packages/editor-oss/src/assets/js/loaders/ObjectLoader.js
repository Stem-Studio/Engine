import * as THREE from "three";

import BaseLoader from "./BaseLoader";
import {traverseObjectDepthFirst} from "../../../utils/SceneTraverser";

/**
 * ObjectLoader - JSON File Loader
 * 
 * Loads 3D objects from JSON files and handles special cases like skinned meshes.
 */
class ObjectLoader extends BaseLoader {
    constructor() {
        super();
    }

    load(url, options) {
        return new Promise(resolve => {
            const loader = new THREE.ObjectLoader();

            loader.load(
                url,
                obj => {
                    const firstSkinnedMesh = this.prepareLoadedObject(obj);

                    if (
                        obj instanceof THREE.Scene &&
                        obj.children.length > 0 &&
                        obj.children[0] instanceof THREE.SkinnedMesh
                    ) {
                        resolve(this.loadSkinnedMesh(firstSkinnedMesh, options));
                    } else {
                        resolve(obj);
                    }
                },
                undefined,
                () => {
                    resolve(null);
                },
            );
        });
    }

    prepareLoadedObject(object) {
        if (!object?.isObject3D) {
            return null;
        }

        let firstSkinnedMesh = null;
        traverseObjectDepthFirst(object, child => {
            // Fix: JSON model files may contain Server: true metadata,
            // which can cause the same model to be downloaded twice.
            // Remove this metadata to prevent duplicate downloads.
            if (child.userData?.Server === true) {
                delete child.userData.Server;
                delete child.userData.Url;
            }

            if (!firstSkinnedMesh && child instanceof THREE.SkinnedMesh) {
                firstSkinnedMesh = child;
            }
        });

        return firstSkinnedMesh;
    }

    /**
     * Handle skinned mesh loading, including animation setup
     * @param {THREE.SkinnedMesh|null} mesh - The first skinned mesh in the loaded scene
     * @param {Object} options - Loading options including Name property
     * @returns {THREE.SkinnedMesh|null} The processed skinned mesh
     */
    loadSkinnedMesh(mesh, options = {}) {
        if (!mesh) {
            return null;
        }

        const animations = mesh.geometry?.animations;

        if (options.Name && animations && animations.length > 0) {
            const names = animations.map(n => n.name);

            const source1 = `var mesh = this.getObjectByName('${options.Name}');\nvar mixer = new THREE.AnimationMixer(mesh);\n\n`;

            const source2 = names
                .map(n => `var ${n}Animation = mixer.clipAction('${n}');`)
                .join("\n");

            const source3 = `\n${names[0]}Animation.play();\n\n`;

            const source4 = `function update(clock, deltaTime) { \n    mixer.update(deltaTime); \n}`;

            const source = source1 + source2 + source3 + source4;

            mesh.userData.scripts = [
                {
                    id: null,
                    name: `${options.Name}Animation`,
                    type: "javascript",
                    source: source,
                    uuid: THREE.MathUtils.generateUUID(),
                },
            ];
        }

        return mesh;
    }
}

export default ObjectLoader;
