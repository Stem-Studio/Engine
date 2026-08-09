import {AMFLoader as ThreeAMFLoader} from "three/addons/loaders/AMFLoader.js";

import BaseLoader from "./BaseLoader";

/**
 * AMFLoader
 *
 */
class AMFLoader extends BaseLoader {
    constructor() {
        super();
    }

    load(url) {
        return new Promise(resolve => {
            const loader = new ThreeAMFLoader();
            loader.load(
                url,
                group => {
                    resolve(group);
                },
                undefined,
                () => {
                    resolve(null);
                },
            );
        });
    }
}

export default AMFLoader;
