import {TDSLoader as ThreeTDSLoader} from "three/addons/loaders/TDSLoader.js";

import BaseLoader from "./BaseLoader";

/**
 * 3DS loader facade.
 *
 * Keeps the editor's legacy loader contract while delegating parsing to the
 * maintained Three.js addon implementation.
 */
class TDSLoader extends BaseLoader {
    constructor() {
        super();
    }

    load(url, options) {
        const path = url.startsWith("blob:") || url.startsWith("http") || url.startsWith("https")
            ? url
            : (this.server || "") + url;

        return new Promise((resolve, reject) => {
            const loader = new ThreeTDSLoader();
            loader.load(
                path,
                group => {
                    group.userData.type = "3DS";
                    group.userData.url = url;
                    group.userData.options = options;

                    resolve(group);
                },
                undefined,
                error => {
                    console.warn(`TDSLoader: ${url} loading failed.`, error);
                    reject(error);
                },
            );
        });
    }
}

export default TDSLoader;
