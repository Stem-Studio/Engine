import {MTLLoader as MTLLoaderImpl} from "three/addons/loaders/MTLLoader.js";
import {OBJLoader as OBJLoaderImpl} from "three/addons/loaders/OBJLoader.js";

import BaseLoader from "./BaseLoader";

/**
 * OBJLoader
 *
 */
class OBJLoader extends BaseLoader {
    constructor() {
        super();
    }

    load(url) {
        return new Promise(resolve => {
            var objLoader = new OBJLoaderImpl();
            var mtlLoader = new MTLLoaderImpl();

            //in DB: url[0] - obj, url[1] - mtl
            var promise = new Promise(resolve1 => {
                mtlLoader.load(
                    url[1],
                    obj => {
                        resolve1(obj);
                    },
                    undefined,
                    () => {
                        resolve1(null);
                    },
                );
            });

            promise.then(mtl => {
                if (mtl) {
                    mtl.preload();
                    objLoader.setMaterials(mtl);
                }

                objLoader.load(
                    url[0],
                    obj => {
                        resolve(obj);
                    },
                    undefined,
                    e => {
                        console.error("ERROR: Failed to load .obj model: " + e);
                        resolve(null);
                    },
                );
            });
        });
    }
}

export default OBJLoader;
