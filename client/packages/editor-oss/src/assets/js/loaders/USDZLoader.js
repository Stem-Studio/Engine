import {USDLoader} from "three/addons/loaders/USDLoader.js";

import BaseLoader from "./BaseLoader";

/**
 * USD/USDZ loader facade.
 *
 * The public editor path remains USDZLoader for compatibility, while parsing
 * delegates to Three's maintained USDLoader, which supports USD, USDA, USDC,
 * and USDZ archives.
 */
class USDZLoader extends BaseLoader {
    constructor() {
        super();
    }

    load(url, options) {
        const path = url.startsWith("blob:") || url.startsWith("http") || url.startsWith("https")
            ? url
            : (this.server || "") + url;

        return new Promise((resolve, reject) => {
            const loader = new USDLoader();
            loader.load(
                path,
                group => {
                    group.userData.type = "USDZ";
                    group.userData.url = url;
                    group.userData.options = options;

                    resolve(group);
                },
                undefined,
                error => {
                    console.warn(`USDZLoader: ${url} loading failed.`, error);
                    reject(error);
                },
            );
        });
    }
}

export default USDZLoader;
