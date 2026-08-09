import type {AIProvider} from "./types";

/**
 * BYOKKeyStore persists provider keys client-side.
 *
 * The default implementation is IndexedDB-backed. The interface is here so a
 * desktop wrapper (Tauri, Electron) can plug in an OS-keychain implementation
 * without touching the rest of the editor.
 */
export interface BYOKKeyStore {
    get(provider: AIProvider): Promise<string | undefined>;
    set(provider: AIProvider, key: string): Promise<void>;
    delete(provider: AIProvider): Promise<void>;
    all(): Promise<Partial<Record<AIProvider, string>>>;
    clear(): Promise<void>;
}

const DB_NAME = "stemstudio-byok";
const STORE_NAME = "provider-keys";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | undefined;

const openDb = (): Promise<IDBDatabase> => {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            if (typeof indexedDB === "undefined") {
                reject(new Error("IndexedDB is not available in this environment"));
                return;
            }
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
        });
    }
    return dbPromise;
};

const runTx = <T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T> | T,
): Promise<T> =>
    openDb().then(
        db =>
            new Promise<T>((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, mode);
                const store = tx.objectStore(STORE_NAME);
                const result = fn(store);
                if (result instanceof IDBRequest) {
                    result.onsuccess = () => resolve(result.result);
                    result.onerror = () => reject(result.error ?? new Error("IndexedDB error"));
                } else {
                    tx.oncomplete = () => resolve(result);
                    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction error"));
                }
            }),
    );

export class IndexedDBBYOKKeyStore implements BYOKKeyStore {
    async get(provider: AIProvider): Promise<string | undefined> {
        try {
            const value = await runTx("readonly", store => store.get(provider));
            return typeof value === "string" ? value : undefined;
        } catch {
            return undefined;
        }
    }

    async set(provider: AIProvider, key: string): Promise<void> {
        await runTx("readwrite", store => store.put(key, provider));
    }

    async delete(provider: AIProvider): Promise<void> {
        await runTx("readwrite", store => store.delete(provider));
    }

    async all(): Promise<Partial<Record<AIProvider, string>>> {
        try {
            const out: Partial<Record<AIProvider, string>> = {};
            const db = await openDb();
            await new Promise<void>((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, "readonly");
                const store = tx.objectStore(STORE_NAME);
                const cursorReq = store.openCursor();
                cursorReq.onsuccess = () => {
                    const cursor = cursorReq.result;
                    if (cursor) {
                        if (typeof cursor.value === "string") {
                            out[cursor.key as AIProvider] = cursor.value;
                        }
                        cursor.continue();
                    } else {
                        resolve();
                    }
                };
                cursorReq.onerror = () => reject(cursorReq.error ?? new Error("Cursor error"));
            });
            return out;
        } catch {
            return {};
        }
    }

    async clear(): Promise<void> {
        await runTx("readwrite", store => store.clear());
    }
}

/**
 * In-memory implementation used in environments where IndexedDB is unavailable
 * (SSR, tests). Keys do not survive a page reload.
 */
export class InMemoryBYOKKeyStore implements BYOKKeyStore {
    private readonly map = new Map<AIProvider, string>();

    async get(provider: AIProvider): Promise<string | undefined> {
        return this.map.get(provider);
    }

    async set(provider: AIProvider, key: string): Promise<void> {
        this.map.set(provider, key);
    }

    async delete(provider: AIProvider): Promise<void> {
        this.map.delete(provider);
    }

    async all(): Promise<Partial<Record<AIProvider, string>>> {
        const out: Partial<Record<AIProvider, string>> = {};
        for (const [k, v] of this.map) out[k] = v;
        return out;
    }

    async clear(): Promise<void> {
        this.map.clear();
    }
}
