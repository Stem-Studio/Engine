export const GITHUB_URL = "https://github.com/Stem-Studio/Engine";
export const ISSUES_URL = `${GITHUB_URL}/issues`;
export const CONTRIBUTING_URL = `${GITHUB_URL}/blob/main/CONTRIBUTING.md`;
export const LICENSE_URL = `${GITHUB_URL}/blob/main/LICENSE`;
export const SECURITY_URL = `${GITHUB_URL}/blob/main/SECURITY.md`;
export const COC_URL = `${GITHUB_URL}/blob/main/CODE_OF_CONDUCT.md`;

// In playground mode the editor loads with this URL flag. Editor shell reads
// it via `isPlaygroundMode()` and hides surfaces outside the allowed four:
// dashboard, scene editor, AI copilot, and player.
//
// Use the emitted app-shell entrypoint directly. This avoids a stale static
// host resolving `/dashboard` to the public-site shell and recursively
// embedding the Playground. The dashboard directory entrypoint remains a
// compatibility fallback in Playground.tsx.
export const PLAYGROUND_ROUTE = "/playground/index.html";
export const PLAYGROUND_APP_URL = "/shell.html?mode=playground";
