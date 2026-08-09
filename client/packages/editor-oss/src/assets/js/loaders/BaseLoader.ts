import PackageManager from "../../../package/PackageManager";
import { patchTextureLoaders } from "../../../utils/TextureUtils";

patchTextureLoaders();

let ID = -1;

type PackageRequire = (names: unknown) => Promise<any>;

/**
 * BaseLoader
 *
 */
class BaseLoader {
    id: string;
    private _packageManager: PackageManager | null = null;
    require: PackageRequire;

    constructor() {
        this.id = `BaseLoader${ID--}`;
        this.require = names => this.packageManager.require(names);
    }

    get packageManager(): PackageManager {
        if (this._packageManager === null) {
            this._packageManager = new PackageManager();
        }

        return this._packageManager;
    }

    set packageManager(packageManager: PackageManager) {
        this._packageManager = packageManager;
    }

    load(_url: string, _options?: unknown): Promise<unknown | null> {
        return Promise.resolve(null);
    }

    dispose() {
    }
}

export default BaseLoader;
