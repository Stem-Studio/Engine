/**
 * @stem/network — pluggable network layer for the StemStudio editor.
 *
 * Today this package exposes two things:
 *
 * 1. **Adapter selection** — one place that records local or remote
 *    deployment intent. No-flag OSS and Playground sessions resolve to
 *    local mode; `?backend=remote` is an explicit opt-in. The app pages
 *    call `createBackendAdapter()` once at boot and read the resulting
 *    `{server, mode, entrypoint}`.
 *
 * 2. **The API surface itself** — exported via the
 *    `@stem/network/api/*` subpath, which is path-aliased in tsconfig
 *    and vite to compatibility modules under `adapters/remote-go/`.
 *    Despite that legacy directory name, Playground scene persistence
 *    routes through the local `ProjectStore`.
 *    New code should import from `@stem/network/api/<domain>`; the
 *    legacy `@web-shared/api/<domain>` alias resolves to the same
 *    location for the 200+ existing import sites.
 *
 * Forks that want to swap the backend without forking the engine can
 * implement an alternative adapter by writing their own
 * `createBackendAdapter` replacement and feeding its `server` URL into
 * the engine bootstrap. The existing Go-targeted REST surface lives at
 * `adapters/remote-go/`; the Node mock at `client/packages/local-backend/` is
 * what the future `adapters/local-node/` implementation will target.
 *
 * Future direction (not in this PR): define a canonical `NetworkApi`
 * interface in `api.ts` that both adapters satisfy, then have the
 * selector return the active adapter (rather than just a server URL)
 * so the API surface itself is pluggable end-to-end.
 */

export type {
    BackendAdapter,
    BackendEntrypoint,
    BackendMode,
} from "./adapter";

export {
    createBackendAdapter,
    getBackendAdapter,
    isLocalBackendMode,
} from "./adapter";
