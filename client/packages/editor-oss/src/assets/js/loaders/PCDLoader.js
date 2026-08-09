import { PCDLoader as ThreePCDLoader } from "three/addons/loaders/PCDLoader.js";

import BaseLoader from "./BaseLoader";

/**
 * PCDLoader
 *
 */
class PCDLoader extends BaseLoader {
    constructor() {
        super();
    }

    load(url) {

        return new Promise(resolve => {
            var loader = new ThreePCDLoader();
            loader.load(
                url,
                mesh => {
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

export default PCDLoader;
