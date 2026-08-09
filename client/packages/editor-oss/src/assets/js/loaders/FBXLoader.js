import {LoadingManager} from "three";
import {FBXLoader as FBXLoaderImpl} from "three/addons/loaders/FBXLoader.js";

import BaseLoader from "./BaseLoader";
import {traverseObjectDepthFirst} from "../../../utils/SceneTraverser";

/**
 * FBXLoader
 *
 */
class FBXLoader extends BaseLoader {
    constructor() {
        super();
        this.loadingManager = new LoadingManager();

        // Track failed texture URLs to provide fallback
        this.failedTextureUrls = new Set();

        // Handle texture loading errors gracefully
        this.loadingManager.onError = (url) => {
            console.warn(`[FBXLoader] Failed to load resource: ${url}`);
            this.failedTextureUrls.add(url);
        };

        this.loader = new FBXLoaderImpl(this.loadingManager);
    }

    load(url) {
        return new Promise(resolve => {
            console.log(`[FBXLoader] Loading FBX from: ${url}`);
            this.loader.load(
                url,
                obj3d => {
                    console.log(`[FBXLoader] FBX loaded successfully, failed textures: ${this.failedTextureUrls.size}`);
                    obj3d._obj = obj3d;
                    obj3d._root = obj3d;

                    // Mark that this model had texture loading issues
                    if (this.failedTextureUrls.size > 0) {
                        obj3d.userData.hadTextureLoadingErrors = true;
                        obj3d.userData.failedTextureCount = this.failedTextureUrls.size;
                    }

                    // Check vertexColors consistency
                    this.checkVertexColorsConsistency(obj3d);

                    // MISHA: disable animation scripts (animations are done by the player controller and other behaviors)
                    /* if (obj3d.animations && obj3d.animations.length > 0) {
                        Object.assign(obj3d.userData, {
                            animNames: obj3d.animations.map(n => n.name),
                            scripts: [{
                                id: null,
                                name: `${options.Name}${_t('Animation')}`,
                                type: 'javascript',
                                source: this.createScripts(options.Name),
                                uuid: THREE.MathUtils.generateUUID()
                            }]
                        });
                    } */

                    resolve(obj3d);
                },
                undefined,
                (error) => {
                    console.error(`[FBXLoader] ❌ CRITICAL ERROR loading FBX:`, error);
                    resolve(null);
                },
            );
        });
    }

    checkVertexColorsConsistency(obj3d) {
        traverseObjectDepthFirst(obj3d, child => {
            if (child.isMesh) {
                const geometry = child.geometry;
                let materials = child.material;
                const hasColorAttr = !!(geometry && geometry.attributes && geometry.attributes.color);
                if (!Array.isArray(materials)) materials = [materials];
                materials = materials.map(mat => {
                    if (mat && "vertexColors" in mat) {
                        const usesVertexColors = mat.vertexColors;
                        if (usesVertexColors && !hasColorAttr || !usesVertexColors && hasColorAttr) {
                            const newMat = mat.clone();
                            newMat.vertexColors = hasColorAttr;
                            return newMat;
                        }
                    }
                    return mat;
                });

                child.material = Array.isArray(child.material) ? materials : materials[0];
            }
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

export default FBXLoader;
