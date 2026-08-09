import {Object3D} from "three";
import {NRRDLoader as ThreeNRRDLoader} from "three/addons/loaders/NRRDLoader.js";

import BaseLoader from "./BaseLoader";

/**
 * NRRDLoader
 *
 */
class NRRDLoader extends BaseLoader {
    constructor() {
        super();
    }

    load(url) {
        return new Promise(resolve => {
            const loader = new ThreeNRRDLoader();
            loader.load(
                url,
                volume => {
                    const obj = new Object3D();

                    const sliceX = volume.extractSlice("x", Math.floor(volume.RASDimensions[0] / 2));
                    obj.add(sliceX.mesh);

                    const sliceY = volume.extractSlice("y", Math.floor(volume.RASDimensions[1] / 2));
                    obj.add(sliceY.mesh);

                    const sliceZ = volume.extractSlice("z", Math.floor(volume.RASDimensions[2] / 4));
                    obj.add(sliceZ.mesh);

                    resolve(obj);
                },
                undefined,
                () => {
                    resolve(null);
                },
            );
        });
    }
}

export default NRRDLoader;
