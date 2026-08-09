import type {AIBackend} from "./AIBackend";
import {IndexedDBBYOKKeyStore, InMemoryBYOKKeyStore, type BYOKKeyStore} from "./BYOKKeyStore";
import {EncryptedBYOKKeyStore} from "./EncryptedBYOKKeyStore";
import {HttpAIBackend} from "./HttpAIBackend";

let singleton: AIBackend | undefined;
let byokStore: EncryptedBYOKKeyStore | undefined;

function buildByokStore(): EncryptedBYOKKeyStore | undefined {
    const underlying: BYOKKeyStore =
        typeof indexedDB !== "undefined" ? new IndexedDBBYOKKeyStore() : new InMemoryBYOKKeyStore();
    return new EncryptedBYOKKeyStore(underlying);
}

/**
 * Returns the process-wide AIBackend singleton. Constructed lazily on first
 * access so unit tests can override via `setAIBackend()` before any consumer
 * pulls it in.
 *
 * The default backend uses an EncryptedBYOKKeyStore wrapping IndexedDB. The
 * wrapper acts as a plain pass-through until the user sets a passphrase via
 * `getBYOKKeyStore().setPassphrase(...)`.
 */
export function getAIBackend(): AIBackend {
    if (!singleton) {
        if (!byokStore) byokStore = buildByokStore();
        singleton = new HttpAIBackend({keyStore: byokStore});
    }
    return singleton;
}

/**
 * Returns the BYOK key store. The store exposes the passphrase lifecycle
 * methods (`setPassphrase`, `unlock`, `lock`, `resetPassphrase`,
 * `hasPassphrase`, `isUnlocked`) so the BYOK settings panel can drive
 * encryption-at-rest without going through the AIBackend interface, which
 * intentionally keeps its surface narrow.
 */
export function getBYOKKeyStore(): EncryptedBYOKKeyStore | undefined {
    if (!byokStore) byokStore = buildByokStore();
    return byokStore;
}

/**
 * Replace the singleton. Tests use this to inject a stub. Production code
 * shouldn't call it.
 */
export function setAIBackend(backend: AIBackend | undefined): void {
    singleton = backend;
}

/**
 * Replace the BYOK key store. Tests use this to inject a stub. Resetting
 * to `undefined` causes the next `getBYOKKeyStore()` call to rebuild from
 * the default local store.
 */
export function setBYOKKeyStore(store: EncryptedBYOKKeyStore | undefined): void {
    byokStore = store;
    // The AIBackend captured a reference to the previous store at
    // construction time, so we have to rebuild the singleton too.
    singleton = undefined;
}
