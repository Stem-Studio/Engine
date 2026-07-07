# Architecture

StemStudio OSS runs entirely on your machine. There is no hosted backend, no account service, no cloud sync. This document explains the three processes that make up a running StemStudio instance and how they communicate.

## The three processes

```
+- BROWSER ----------------------------------------------------------------+
|                                                                          |
|   @stem/editor-oss: Editor + Player + Monaco                             |
|      |                |              |                                   |
|   AI client       MP client     Persistence:                             |
|      |                |          IndexedDB  OR                           |
|      |                |          File System Access                      |
|   BYOK keystore       |          (chosen at first-time bootstrap modal)  |
|   (IndexedDB)         |                                                  |
+------|----------------|--------------------------------------------------+
       |                |
   HTTPS                WSS
   X-BYOK-Key header    |
       |                |
       v                v
+- localhost --------- started by `bun run dev` (concurrently) ---------+
|                                                                       |
|   +-------------+   +-------------------+   +------------------+      |
|   | Vite        |   | Go ai-server      |   | multiplayer      |      |
|   | :5173       |   | cmd/ai-server/    |   | sidecar :2567    |      |
|   |             |   | :8081             |   |                  |      |
|   | HMR +       |   |                   |   | Colyseus         |      |
|   | asset serve |   | /api/AI/*         |   | in-memory rooms  |      |
|   |             |   | /api/AI/Capabilities  | no MongoDB       |      |
|   |             |   | /api/AI/ConfigureKeys |                  |      |
|   +-------------+   +---------+---------+   +------------------+      |
+-------------------------------|---------------------------------------+
                                |
                                v
                +-----------------------------------------------+
                |  External (your keys, BYOK)                   |
                |    Anthropic  *  OpenAI  *  Meshy  *          |
                |    ElevenLabs  *  AnythingWorld               |
                +-----------------------------------------------+
```

### Vite (the editor)

Serves the React + Three.js editor at `http://localhost:5173` in dev and as a static bundle in production builds. All editor UI, scene management, behaviors, lambdas, physics, rendering, and the Monaco script editor live here.

### AI server (Go)

Runs at `http://localhost:8081`. A small Go binary that:

- Forwards AI requests from the editor to your configured providers (Anthropic, OpenAI, Meshy, ElevenLabs, AnythingWorld, Tripo, Gemini).
- Resolves which key to use: env vars take precedence over per-session BYOK keys passed in the `X-BYOK-Key` header (with `X-BYOK-Provider` identifying the target).
- Exposes `GET /api/AI/Capabilities` so the editor can ask which providers are ready.
- Exposes `POST /api/AI/ConfigureKeys` so the editor can submit a key for the current session.

The AI server holds no state across restarts. Restart it and the editor will re-submit any BYOK keys the user has saved in IndexedDB.

### Multiplayer sidecar (Node + Colyseus)

Runs at `ws://localhost:2567`. A Colyseus server with in-memory room state. No database. Two browser tabs on the same machine can join the same room and exchange schema-synced state.

If you don't need multiplayer, this process can be killed without affecting anything else. Behaviors that depend on it degrade gracefully — they log a warning and no-op.

## Communication

| From      | To                                                      | Protocol                          | Notes                                                          |
| --------- | ------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------- |
| Editor    | AI server                                               | HTTPS (HTTP in dev)               | Bearer-style `X-BYOK-Key` header when no env key is configured |
| Editor    | MP sidecar                                              | WebSocket (Colyseus protocol)     | Same protocol as a production deployment                       |
| AI server | Anthropic / OpenAI / Meshy / ElevenLabs / AnythingWorld | HTTPS                             | Direct egress from your machine                                |
| Editor    | IndexedDB                                               | Browser API                       | Auto-save and BYOK key storage                                 |
| Editor    | Local folder                                            | File System Access API (Chromium) | Optional, chosen at first-time bootstrap                       |

## Persistence model

On first run, the editor asks how you want to store projects:

1. **IndexedDB** — projects live in the browser's storage. Auto-save, no permissions needed, works in every browser. Limited by browser quota (typically several hundred MB).
2. **Local folder** (Chromium only) — pick a directory. Projects are saved as `.stemscript` files inside it. Survives browser data clears, git-friendly, no quota.

Your choice is saved in `localStorage` and can be changed from Settings. Switching modes does not migrate existing projects — export them first.

Builder Studio surfaces follow the same persistence boundary. Quick Build stamps are ordinary scene objects. BIM Plan stores its source data in `scene.userData.planCad`; generated BIM geometry is runtime-only and rebuilt from that node dictionary on load, undo, and redo. See `docs/quick-build.md` and `docs/plan-cad.md`.

## AI capability protocol

When the editor starts, it queries the AI server:

```
GET /api/AI/Capabilities

Response:
{
  "buildMode": "oss",
  "providers": {
    "anthropic":    {"status": "ready",       "source": "env"},
    "openai":       {"status": "missing-key", "source": ""},
    "meshy":        {"status": "ready",       "source": "byok-session"},
    "elevenlabs":   {"status": "missing-key", "source": ""},
    "anythingworld":{"status": "missing-key", "source": ""},
    "gemini":       {"status": "missing-key", "source": ""},
    "tripo":        {"status": "missing-key", "source": ""}
  }
}
```

The editor uses this to decide which AI features to enable and which to gate behind a "Configure key" CTA. When the user enters a key, the editor sends:

```
POST /api/AI/ConfigureKeys
{"provider": "openai", "key": "sk-..."}
```

The key is held in the AI server's process memory for the current session and persisted client-side in IndexedDB (optionally encrypted with a passphrase) so a refresh re-submits it automatically. Keys are never written to disk on the server.

## What's intentionally absent

- **No accounts.** No login, no JWT, no Firebase. The machine running StemStudio is the trust boundary.
- **No telemetry.** Zero outbound calls except those you initiate (AI requests, multiplayer connections, asset loads).
- **No managed asset CDN.** Asset URLs are configurable via `ASSET_BASE_URL`. The default points at a permissive public mirror.
- **No project gallery, no discovery.** This is a creator tool; sharing is via exported `.stemscript` files or self-hosted builds.
