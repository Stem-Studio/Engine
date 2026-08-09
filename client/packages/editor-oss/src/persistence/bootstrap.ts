import {FileSystemProjectStore} from "./FileSystemProjectStore";
import {loadHandle, verifyPermission} from "./fsHandleStore";
import {IndexedDBProjectStore} from "./IndexedDBProjectStore";
import {getOSSPersistenceMode} from "./mode";
import {setProjectStore} from "./projectStoreFactory";

export {isOSSBootstrapped, markOSSBootstrapped, resetOSSBootstrap} from "./bootstrapState";

/**
 * Rehydrates the persistence singleton on app boot before the first
 * project-store consumer runs.
 *
 * Logic:
 *   - If the user picked the filesystem mode and a directory handle is
 *     persisted in IDB, verify its permission. If granted, register the
 *     `FileSystemProjectStore`. If revoked, fall through to IndexedDB so
 *     the editor stays usable; the bootstrap modal can re-prompt.
 *   - Otherwise register an `IndexedDBProjectStore`.
 *
 * Returns the kind of store that was registered. Callers can use the return
 * value to decide whether to surface a "folder access lost — re-pick"
 * banner.
 */
export async function rehydrateProjectStore(): Promise<"indexeddb" | "filesystem" | "fallback-indexeddb"> {
    // The save handler is installed automatically by setProjectStore()
    // whenever a local-only backend (IndexedDB / FS Access) is registered —
    // see projectStoreFactory.ts. So every code path that goes through
    // setProjectStore (this function, the bootstrap modal, tests) wires
    // saveScene() to the active store with no extra step.
    const mode = getOSSPersistenceMode();

    if (mode === "filesystem") {
        const handle = await loadHandle();
        if (handle && (await verifyPermission(handle))) {
            setProjectStore(new FileSystemProjectStore(handle as never));
            return "filesystem";
        }
        setProjectStore(new IndexedDBProjectStore());
        return "fallback-indexeddb";
    }

    setProjectStore(new IndexedDBProjectStore());
    return "indexeddb";
}

/**
 * Memoized `rehydrateProjectStore()`.
 *
 * Rehydration must happen exactly once, and *before* the first scene load —
 * but the trigger can't be left to a single React shell. The standalone
 * Player route, in particular, mounts without running the dashboard's
 * bootstrap effect, so it would otherwise read the lazy IndexedDB fallback
 * and report a File System Access project as "not found".
 *
 * Any consumer that needs the real backend (the app shells on boot, and
 * `loadSceneFromProjectStore` before every scene fetch) awaits this. The
 * first caller kicks off rehydration; the rest share the same promise.
 */
let rehydrationPromise: Promise<"indexeddb" | "filesystem" | "fallback-indexeddb"> | null = null;

export function ensureProjectStoreRehydrated(): Promise<"indexeddb" | "filesystem" | "fallback-indexeddb"> {
    if (!rehydrationPromise) {
        rehydrationPromise = rehydrateProjectStore();
    }
    return rehydrationPromise;
}

/**
 * Called from a user-gesture click handler (e.g. a "Reconnect folder"
 * banner). Re-runs the FS Access permission prompt, and on success swaps
 * the active ProjectStore back to FileSystemProjectStore so the dashboard
 * project list reads from disk again.
 *
 * Returns:
 *   - "reconnected" — permission was granted and the store is now FS
 *   - "no-handle"   — no persisted handle exists (user must re-pick via
 *                     the bootstrap modal)
 *   - "denied"      — the user dismissed/blocked the permission prompt
 */
export async function reconnectFilesystemFolder(): Promise<"reconnected" | "no-handle" | "denied"> {
    const handle = await loadHandle();
    if (!handle) return "no-handle";
    const ok = await verifyPermission(handle);
    if (!ok) return "denied";
    setProjectStore(new FileSystemProjectStore(handle as never));
    return "reconnected";
}
