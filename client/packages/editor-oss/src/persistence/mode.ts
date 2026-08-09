const STORAGE_MODE_KEY = "stemstudio.persistence.mode";

export type OSSPersistenceMode = "indexeddb" | "filesystem";

/**
 * Returns the chosen persistence mode for local-first builds. Read from
 * `localStorage`; falls back to `indexeddb` (the safest, universally
 * supported option). The first-time bootstrap modal writes this value once
 * the user picks.
 */
export function getOSSPersistenceMode(): OSSPersistenceMode {
    if (typeof localStorage === "undefined") return "indexeddb";
    const stored = localStorage.getItem(STORAGE_MODE_KEY);
    return stored === "filesystem" ? "filesystem" : "indexeddb";
}

export function setOSSPersistenceMode(mode: OSSPersistenceMode): void {
    if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_MODE_KEY, mode);
    }
}
