import {NullRemoteDocStore, type IRemoteDocStore} from "./IRemoteDocStore";

let singleton: IRemoteDocStore | undefined;

/**
 * Returns the process-wide remote doc store. Defaults to
 * `NullRemoteDocStore` (silent no-op) unless an embedder registers a custom
 * implementation.
 */
export function getRemoteDocStore(): IRemoteDocStore {
    if (!singleton) {
        singleton = new NullRemoteDocStore();
    }
    return singleton;
}

/** Replace the singleton. Tests use this to inject a stub. */
export function setRemoteDocStore(store: IRemoteDocStore | undefined): void {
    singleton = store;
}
