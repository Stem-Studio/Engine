import {setSceneSaveHandler} from "@stem/network/api/scene/saveHandler";

import {IndexedDBProjectStore} from "./IndexedDBProjectStore";
import {setOSSPersistenceMode as writeOSSPersistenceMode} from "./mode";
import type {ProjectStore} from "./ProjectStore";

export {getOSSPersistenceMode} from "./mode";
export type {OSSPersistenceMode} from "./mode";

let singleton: ProjectStore | undefined;
let ossSaveScenePromise: Promise<typeof import("./ossSceneSave").ossSaveScene> | undefined;

async function lazyOssSaveScene(createThumbnail: boolean, shouldShowToast: boolean): Promise<void> {
    ossSaveScenePromise ??= import("./ossSceneSave").then(module => module.ossSaveScene);
    const ossSaveScene = await ossSaveScenePromise;
    return ossSaveScene(createThumbnail, shouldShowToast);
}

export function setOSSPersistenceMode(mode: import("./mode").OSSPersistenceMode): void {
    writeOSSPersistenceMode(mode);
    // Clear singleton so the next access picks up the new mode.
    singleton = undefined;
}

/**
 * Returns the process-wide ProjectStore singleton.
 *
 * If a caller has previously registered a store via `setProjectStore`, that
 * store is returned. Otherwise the function falls back to the local
 * `IndexedDBProjectStore`; the bootstrap modal may replace it with a
 * `FileSystemProjectStore` when the user picks folder mode.
 */
export function getProjectStore(): ProjectStore {
    if (singleton) return singleton;
    setProjectStore(new IndexedDBProjectStore());
    return singleton!;
}

/** Read-only identity check for an in-flight save; never creates a fallback store. */
export function isCurrentProjectStore(store: ProjectStore): boolean {
    return singleton === store;
}

/**
 * Inject a ProjectStore (test stubs or the FileSystemProjectStore once the
 * bootstrap modal has resolved a directory handle).
 *
 * Side effect: local stores (`indexeddb` / `filesystem`) install the
 * `network/scene::saveScene` handler so every save routes through the
 * selected local store. Custom remote stores can still clear the handler by
 * using kind `"remote"`.
 */
export function setProjectStore(store: ProjectStore | undefined): void {
    singleton = store;
    if (!store || store.kind === "remote") {
        setSceneSaveHandler(null);
    } else {
        setSceneSaveHandler(lazyOssSaveScene);
    }
}
