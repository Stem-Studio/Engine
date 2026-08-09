# Multiplayer

StemStudio's multiplayer is built on [Colyseus](https://colyseus.io). By default, the Colyseus server runs as a local sidecar on `ws://localhost:2567` with in-memory room state.

## Local sidecar (default)

When you run `bun run dev`, the sidecar starts automatically alongside Vite and the AI server via `concurrently` (look at the `dev` script in `package.json`). No additional configuration required.

To run only the sidecar:

```bash
bun run dev:mp
```

To run the editor without multiplayer (e.g., when working on offline-only features):

```bash
bun run dev:editor
```

Behaviors that depend on multiplayer detect that the sidecar isn't reachable, log a warning once, and no-op for the rest of the session.

## Two-tab test

Open two browser tabs on `http://localhost:5173`. Load the same project in both. Add any behavior that uses the `colyseusRoom` Erth helper. Both tabs join the same room and see each other's state updates.

This works because:

- Colyseus is running on `ws://localhost:2567` and both tabs connect to it.
- Rooms are keyed by project ID, so the same project = the same room.
- State is held in the sidecar's memory; both tabs receive schema-synced updates.

## Configuration

Environment variables read by the multiplayer sidecar:

| Var | Default | Purpose |
|---|---|---|
| `MULTIPLAYER_PORT` | `2567` | Port to bind |
| `MULTIPLAYER_HOST` | `0.0.0.0` | Interface to bind |
| `MULTIPLAYER_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

Environment variables read by the editor:

| Var | Default | Purpose |
|---|---|---|
| `REACT_APP_MULTIPLAYER_SERVER_URL` | `ws://localhost:2567` | Where to connect |

If you want the editor to connect to a remote sidecar:

```bash
REACT_APP_MULTIPLAYER_SERVER_URL=wss://mp.example.com bun run dev:editor
```

## Persistence

By default, the sidecar holds **no persistent state**. Rooms exist only while they have at least one connected client. When the last client disconnects, the room is destroyed and its state is gone.

If you need cross-session persistence — leaderboards, character progression, world state that survives a server restart — wire that into a self-hosted game-services backend. You can either:

- Run a local persistence layer yourself by wiring a behavior to write to `localStorage` or IndexedDB on each client.
- Self-host a game-services backend; see the [self-hosting](#self-hosting-the-sidecar) section below.

## Self-hosting the sidecar

To deploy the multiplayer sidecar on a real server (so players on different machines can connect):

1. Clone the multiplayer submodule into its own deployment:
   ```bash
   git clone <multiplayer-submodule-url> stemstudio-multiplayer
   cd stemstudio-multiplayer
   npm install
   npm run build
   ```
2. Run it with a public hostname:
   ```bash
   MULTIPLAYER_HOST=0.0.0.0 MULTIPLAYER_PORT=2567 npm start
   ```
3. Front it with a TLS-terminating reverse proxy (Caddy, nginx, Cloudflare).
4. Point editor clients at the public URL via `REACT_APP_MULTIPLAYER_SERVER_URL=wss://your-host`.

For production use you'll want to add:

- A MongoDB connection (the submodule supports persistent rooms via `MONGO_URL`; the default sidecar runs in-memory).
- Rate limiting at the reverse proxy.
- Process supervision (systemd, Docker, Kubernetes).
- Monitoring (the sidecar exposes basic `/health` and `/metrics` endpoints).

See the multiplayer submodule's own `README.md` for full deployment details.

## Behavior author notes

Behaviors that use multiplayer should:

1. **Check sidecar availability** before subscribing to room events. The `colyseusRoom` Erth helper returns `null` if no sidecar is reachable.
2. **Handle disconnects gracefully** — players will drop and rejoin. Don't assume continuous presence.
3. **Pin schema versions** — if your behavior reads a schema field, version it so old clients don't crash on a new server.
4. **Test the offline path** by killing the sidecar with `kill $(lsof -ti:2567)` and verifying your behavior still loads.

The active Play-mode path wraps the selected local Ammo or Rapier engine with
`client/packages/editor-oss/src/physics/simple/PhysicsWrapper.ts`. Room joins
and gameplay synchronization are handled by
`multiplayer/worker/SimpleMultiplayerClient.ts`; collaborative editor scene
synchronization is layered on by
`multiplayer/worker/SimpleMultiplayerCollaborativeClient.ts` and
`multiplayer/worker/CollaborationClient.ts`.
