# @stem/network

Network compatibility layer for the StemStudio open-source editor. The
no-configuration OSS and Playground path is browser-local; remote services are
an explicit integration choice.

## What ships today

### Adapter selection

`createBackendAdapter("editor" | "play")` runs once at app boot and returns:

```typescript
type BackendAdapter = {
    mode: "remote" | "local";
    entrypoint: "editor" | "play";
    server: string;   // base URL the API client should hit
};
```

Mode resolution:

1. Query string — `?backend=local|remote` (explicit override, sticky in local
   storage).
2. Playground session — always `local` unless the URL explicitly requests a
   backend.
3. Local storage — `stem.backend.mode`.
4. Env — `REACT_ENGINE_BACKEND_MODE`.
5. Default — `local`.

The automatic Playground/default-local path uses the current origin and keeps
scene persistence in the browser-backed `ProjectStore`. When `mode ===
"local"` is selected explicitly, the local server origin is resolved from
`?localBackendUrl=` / `?localServer=` / `REACT_ENGINE_LOCAL_BACKEND_URL`,
falling back to `${protocol}//${hostname}:3030`. The Node reference server
that satisfies this contract lives at `client/packages/local-backend/` in this
repo.

`?backend=remote` remains an explicit opt-in for deployments that provide the
corresponding services. Remote scene APIs are not part of the current
Playground deployment.

The active adapter is stashed on `window.__STEM_BACKEND_ADAPTER__` so
consumers can read it without re-resolving.

### REST API surface

The API-shaped domain modules (scenes, assets, behaviors, audio, …) live under
`client/packages/network/src/adapters/remote-go/`. The directory keeps its
legacy name, but OSS scene load/save/list paths route to `ProjectStore`.
They're exported under the `@stem/network/api/*` subpath through tsconfig and
Vite path aliases:

```typescript
// Preferred: target the library boundary
import {getScene} from "@stem/network/api/scene/v2";

// Legacy alias kept for the 200+ existing import sites — still resolves
// to the same files
import {getScene} from "@web-shared/api/scene/v2";
```

The legacy `@web-shared/api/*` alias remains for existing imports; new code
should target the canonical `@stem/network/api/*` path.

A sibling `local-node/` adapter directory exists as a placeholder for the
Node reference server in `client/packages/local-backend/`. See the
[local-node roadmap](./src/adapters/local-node/README.md).

## Future direction (not in this PR)

Split today's single REST surface into per-adapter implementations:

```
client/packages/network/src/
├── adapter.ts                     # mode selection (here today)
├── api.ts                         # canonical TypeScript interface
└── adapters/
    ├── remote-go/                 # current API-shaped compatibility modules
    └── local-node/                # talks to client/packages/local-backend/
```

`adapter.ts` then returns the active adapter object (which exposes the
canonical `api.ts` interface), not just a server URL, so the API surface
itself becomes pluggable rather than just the base URL.

## Writing your own adapter

Until the per-adapter split lands, the integration point is the mode
selector. You can:

1. Implement an HTTP server that speaks the canonical Go backend's REST
   shape (see `server/` in the parent repo for the contract, or
   `client/packages/local-backend/` for a minimal Node reference).
2. Start your server on a different origin.
3. Launch the editor with `?backend=local&localBackendUrl=https://your-server`
   to point the entire frontend at it.

Once the per-adapter split lands, you'll be able to implement the
canonical `CopilotProvider`-style interface from this package directly
and skip the HTTP layer.
