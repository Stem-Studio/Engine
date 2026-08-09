import BaseLoader from "./BaseLoader";

class UnsupportedLegacyLoader extends BaseLoader {
    constructor(loaderName) {
        super();
        this.loaderName = loaderName;
    }

    load(url) {
        console.warn(`${this.loaderName}: ${url} cannot be loaded because Three.js no longer provides ${this.loaderName}.`);
        return Promise.resolve(null);
    }
}

export default UnsupportedLegacyLoader;
