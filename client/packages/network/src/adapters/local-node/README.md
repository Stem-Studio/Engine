# Local-Node Adapter

Skeleton for a backend adapter that targets the Node reference server in
`packages/local-backend/` instead of the canonical Go backend.

This adapter is intentionally empty in this PR — landing the directory
establishes the `adapters/remote-go` ↔ `adapters/local-node` symmetry the
network library is building toward, without claiming features it doesn't
yet have.

## What lives here in the future

Each module under `remote-go/` (`asset/`, `scene/`, `behavior/`, …) has a
matching module here that satisfies the same exported API surface but
implements it against `packages/local-backend/`'s HTTP endpoints.

The active adapter is chosen by `createBackendAdapter` based on the
explicit `?backend=local|remote` query, Playground session, stored preference,
environment, then the no-flag local default — see `network/src/adapter.ts`.

## Current state

`createBackendAdapter` currently only resolves a `server` URL; it doesn't
yet return an adapter implementing the full canonical API interface. The
follow-up is:

1. Define a `NetworkApi` interface in `network/src/api.ts` that captures
   the canonical surface (today's per-domain exports in
   `remote-go/*/index.ts`).
2. `remote-go/index.ts` exports an implementation of `NetworkApi` that
   delegates to today's `getScene`, `getAsset`, etc.
3. `local-node/index.ts` exports an implementation of `NetworkApi` that
   talks to `packages/local-backend/` over HTTP.
4. `adapter.ts` returns the active implementation rather than just the
   server URL.

That work is intentionally deferred — it requires defining the canonical
TypeScript surface for the 35 domains, which is a separate refactor.
