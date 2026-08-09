import { KMZLoader as ThreeKMZLoader } from "three/addons/loaders/KMZLoader.js";

import BaseLoader from "./BaseLoader";

/**
 * KMZLoader
 *
 */
class KMZLoader extends BaseLoader {
    constructor() {
        super();
    }

    load(url) {
        return new Promise(resolve => {
            var loader = new ThreeKMZLoader();

            loader.load(
                url,
                collada => {
                    var obj3d = collada.scene;
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

export default KMZLoader;
