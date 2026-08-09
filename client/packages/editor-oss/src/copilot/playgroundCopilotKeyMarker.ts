const COPILOT_READY_MARKER = "stem.playground.copilotReady";

export const COPILOT_KEYS_CHANGED_EVENT = "stem:playground-copilot-keys-changed";

function getLocalStorage(): Storage | undefined {
    return typeof window === "undefined" ? undefined : window.localStorage;
}

/**
 * Synchronous best-effort answer to "can the playground copilot run?". Reads
 * the localStorage marker written by `refreshCopilotKeysMarker()`.
 */
export function hasCopilotKeysSync(): boolean {
    const storage = getLocalStorage();
    if (!storage) return false;
    try {
        return storage.getItem(COPILOT_READY_MARKER) === "1";
    } catch {
        return false;
    }
}

export function writeCopilotKeysMarker(ready: boolean): void {
    const storage = getLocalStorage();
    if (!storage) return;
    try {
        if (ready) storage.setItem(COPILOT_READY_MARKER, "1");
        else storage.removeItem(COPILOT_READY_MARKER);
    } catch {
        // Ignore storage failures (private mode, denied access, quota).
    }
}

export function notifyCopilotKeysChanged(): void {
    if (typeof window === "undefined") return;
    try {
        window.dispatchEvent(new Event(COPILOT_KEYS_CHANGED_EVENT));
    } catch {
        // Ignore environments that do not support Event construction.
    }
}
