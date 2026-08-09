import * as THREE from "three";
import { VTKLoader as ThreeVTKLoader } from "three/addons/loaders/VTKLoader.js";

import BaseLoader from "./BaseLoader";

/**
 * VTKLoader
 *
 */
class VTKLoader extends BaseLoader {
    constructor() {
        super();
    }

    load(url) {
        return new Promise(resolve => {
            var loader = new ThreeVTKLoader();

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

export default VTKLoader;
