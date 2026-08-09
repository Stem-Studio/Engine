
/**
 * Module: PackageManager.js
 * Purpose: Contains logic for package manager.
 */


import PackageList from "./PackageList";

const loaded = new Map();
const emptyPackageLoad = Promise.resolve([]);
let loaderModulesPromise = null;

function getLoaderModules() {
    if (loaderModulesPromise === null) {
        loaderModulesPromise = Promise.all([
            import("../utils/CssLoader"),
            import("../utils/JsLoader"),
        ]);
    }

    return loaderModulesPromise;
}

class PackageManager {
    /**
     *
     *
     * @param names
     * @returns {Promise} Promise
     */
    require(names) {
        names = Array.isArray(names) ? names : [names];

        if (PackageList.length === 0 || names.length === 0) {
            return emptyPackageLoad;
        }

        const promises = [];

        names.forEach(n => {
            if (loaded.has(n) && loaded.get(n).loading === true) {
                promises.push(loaded.get(n).promise);
            } else if (!loaded.has(n)) {
                var promise = Promise.all(promises).then(() => {
                    var packages = PackageList.filter(m => m.name === n);
                    if (packages.length === 0) {
                        return;
                    } else if (packages.length > 1) {
                        console.warn(`PackageManager: Package name ${n} duplicated.`);
                    }

                    var assets = [];

                    packages.forEach(m => {
                        assets.push.apply(assets, m.assets);
                    });

                    return this._load(assets).then(() => {
                        loaded.set(n, {
                            loading: false,
                            loaded: true,
                            promise: null,
                        });
                    });
                });
                loaded.set(n, {
                    loading: true,
                    loaded: false,
                    promise: promise,
                });
                promises.push(promise);
            }
        });

        return Promise.all(promises);
    }

    async _load(assets = []) {
        if (assets.length === 0) {
            return;
        }

        const [{default: CssLoader}, {default: JsLoader}] = await getLoaderModules();
        var cssLoader = new CssLoader();
        var jsLoader = new JsLoader();

        var promises = assets.map(n => {
            if (n.toLowerCase().endsWith(".css")) {
                return cssLoader.load(n);
            } else if (n.toLowerCase().endsWith(".js")) {
                return jsLoader.load(n);
            } else {
                console.warn(`PackageManager: unknown assets ${n}.`);
                return Promise.resolve();
            }
        });

        await Promise.all(promises);
        jsLoader.eval();
    }
}

export default PackageManager;
