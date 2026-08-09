// Playground mode — runtime gating for the public-site playground iframe.
//
// The public site at buildwithstem.com renders the editor inside an iframe at
// `/playground` and points it at `/shell.html?mode=playground`. When this flag
// is set, the editor restricts the user to four surfaces: the project
// dashboard, the editor itself, the AI copilot panel, and the player. Every
// other surface (settings, export, multiplayer setup, asset uploads, admin)
// is hidden. BYOK key management is reachable via the copilot panel's "Keys"
// button so playground visitors can configure their own AI provider keys.
//
// Gating contract:
//   1. The query param `?mode=playground` activates the flag once. It is
//      persisted to sessionStorage so subsequent client-side navigations
//      inside the editor keep the flag without needing the URL to carry it.
//   2. On mount, PublicAppContainerLite sets `<html data-playground-mode>`
//      so CSS can hide elements without each panel needing a JS check.
//   3. Any component that wants to be hidden in playground mode either:
//        - returns null when `isPlaygroundMode()` is true, OR
//        - adds `data-playground-hide` to its root element (CSS rule below).
//
// The flag is intentionally one-way per session: once playground mode is
// active in this tab it stays active. Closing the tab clears it.

const STORAGE_KEY = "stem.playgroundMode";

let cached: boolean | null = null;

export function isPlaygroundMode(): boolean {
    if (cached !== null) return cached;
    if (typeof window === "undefined") {
        cached = false;
        return cached;
    }

    let active = false;

    try {
        const params = new URLSearchParams(window.location.search);
        if (params.get("mode") === "playground") {
            active = true;
            window.sessionStorage.setItem(STORAGE_KEY, "1");
        } else if (window.sessionStorage.getItem(STORAGE_KEY) === "1") {
            active = true;
        }
    } catch {
        // sessionStorage can throw under file:// or sandbox contexts.
        // Fall back to URL-only detection in that case.
        active = new URLSearchParams(window.location.search).get("mode") === "playground";
    }

    cached = active;
    return active;
}

export function applyPlaygroundModeAttribute(): void {
    if (typeof document === "undefined") return;
    if (isPlaygroundMode()) {
        document.documentElement.dataset.playgroundMode = "true";
    }
}

// Test hook. Not for application code.
export function _resetPlaygroundModeForTests(): void {
    cached = null;
    if (typeof window !== "undefined") {
        try {
            window.sessionStorage.removeItem(STORAGE_KEY);
        } catch {
            // ignore
        }
    }
    if (typeof document !== "undefined") {
        delete document.documentElement.dataset.playgroundMode;
    }
}
