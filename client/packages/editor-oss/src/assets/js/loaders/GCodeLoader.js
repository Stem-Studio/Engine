import { GCodeLoader as ThreeGCodeLoader } from "three/addons/loaders/GCodeLoader.js";

import BaseLoader from "./BaseLoader";

/**
 * GCodeLoader
 *
 */
class GCodeLoader extends BaseLoader {
    constructor() {
        super();
    }

    load(url) {

        return new Promise(resolve => {
            var loader = new ThreeGCodeLoader();

            loader.load(
                url,
                obj3d => {
                    resolve(obj3d);
                },
                undefined,
                () => {
                    resolve(null);
                },
            );
        });
    }
}

export default GCodeLoader;
