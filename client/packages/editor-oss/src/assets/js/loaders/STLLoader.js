import * as THREE from "three";
import { STLLoader as STLLoaderImpl } from 'three/addons/loaders/STLLoader.js';

import BaseLoader from "./BaseLoader";

/**
 * STLLoader
 *
 */
class STLLoader extends BaseLoader {
    constructor() {
        super();
    }

    load(url) {
        return new Promise(resolve => {
            var loader = new STLLoaderImpl();

            loader.load(
                url,
                geometry => {
                    var material = new THREE.MeshStandardMaterial();
                    var mesh = new THREE.Mesh(geometry, material);
                    resolve(mesh);
                },
                undefined,
                () => {
                    resolve(null);
                },
            );
        });
    }
}

export default STLLoader;
