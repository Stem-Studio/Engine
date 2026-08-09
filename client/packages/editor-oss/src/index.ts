// @stem/editor-oss — open-source editor + player + runtime core.
//
// Forbidden imports inside this package (enforced by ESLint
// no-restricted-paths once configured):
//   - @web-dashboard / dashboard-internal
//   - marketing pages
//   - avatar creator (MediaPipe-heavy)
//   - growafarm clients
//   - direct fetch() calls to /api/Scene/* or /api/AI/* — use the
//     interfaces below instead.

export * from "./mode/buildMode";
export * from "./ai";
export * from "./persistence";
