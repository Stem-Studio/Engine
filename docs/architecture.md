# Architecture

StemStudio's supported Playground workflow runs locally in the browser. There
is no deployed account service, cloud project store, or remote scene loader.
This document separates that browser-only path from optional development
sidecars.

## Runtime shapes

| Shape | Project source | AI path | Multiplayer |
| --- | --- | --- | --- |
| Public Playground | IndexedDB (chooser hidden) | Browser-direct BYOK for supported providers | Not hosted |
| Local full development (`bun run dev`) | IndexedDB or selected local folder | Optional Go proxy | Optional local Colyseus sidecar |
| Remote/API mode | Scene and asset APIs | Deployment-defined | Deployment-defined |

The remote/API mode is an integration seam, not a deployed product workflow.

## Local full-development processes

```
+- BROWSER ----------------------------------------------------------------+
|                                                                          |
|   @stem/editor-oss: Editor + Player + Monaco                             |
|      |                |              |                                   |
|   AI client       MP client     Persistence:                             |
|      |                |          IndexedDB  OR                           |
|      |                |          File System Access                      |
|   BYOK keystore       |          (Playground defaults to IndexedDB)      |
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

### AI server (Go, optional)

Runs at `http://localhost:8081`. A small Go binary that:

- Forwards AI requests from the editor to your configured providers (Anthropic, OpenAI, Meshy, ElevenLabs, AnythingWorld, Tripo, Gemini).
- Resolves which key to use: env vars take precedence over per-session BYOK keys passed in the `X-BYOK-Key` header (with `X-BYOK-Provider` identifying the target).
- Exposes `GET /api/AI/Capabilities` so the editor can ask which providers are ready.
- Exposes `POST /api/AI/ConfigureKeys` so the editor can submit a key for the current session.

The AI server holds no state across restarts. Restart it and the editor will re-submit any BYOK keys the user has saved in IndexedDB.

### Multiplayer sidecar (Node + Colyseus, optional)

Runs at `ws://localhost:2567`. A Colyseus server with in-memory room state. No database. Two browser tabs on the same machine can join the same room and exchange schema-synced state.

If you don't need multiplayer, this process can be killed without affecting anything else. Behaviors that depend on it degrade gracefully — they log a warning and no-op.

## Communication

| From      | To                                                      | Protocol                          | Notes                                                          |
| --------- | ------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------- |
| Editor    | AI server                                               | HTTPS (HTTP in dev)               | Optional local-development path; Playground AI can be browser-direct |
| Editor    | MP sidecar                                              | WebSocket (Colyseus protocol)     | Same protocol as a production deployment                       |
| AI server | Anthropic / OpenAI / Meshy / ElevenLabs / AnythingWorld | HTTPS                             | Direct egress from your machine                                |
| Editor    | IndexedDB                                               | Browser API                       | Auto-save and BYOK key storage                                 |
| Editor    | Local folder                                            | File System Access API (Chromium) | Optional in the normal local editor; the public Playground hides the chooser |

## Persistence model

The public Playground hides the storage bootstrap and uses IndexedDB by
default. A normal local editor launch can expose the storage chooser:

1. **IndexedDB** — projects live in the browser's storage. Auto-save, no permissions needed, works in every browser. Limited by browser quota (typically several hundred MB).
2. **Local folder** (Chromium only) — pick a directory. Projects are saved as
   `.stemscript.json` files with packaged asset data. This survives browser data
   clears and is suitable for external backups.

The local editor's choice is saved locally. Switching modes does not migrate
existing projects. There is not yet a complete one-click portable-game export
for every IndexedDB project, so select folder storage at the start of important
portable work when that chooser is available.

Builder Studio surfaces follow the same persistence boundary. Quick Build stamps are ordinary scene objects. BIM Plan stores its source data in `scene.userData.planCad`; generated BIM geometry is runtime-only and rebuilt from that node dictionary on load, undo, and redo. See `docs/quick-build.md` and `docs/plan-cad.md`.

## AI capability protocol (optional proxy path)

When the optional proxy-backed path starts, the editor queries the AI server:

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

The proxy-backed path uses this to decide which AI features to enable. This is
not the Playground copilot path: Playground chat providers use browser-direct
requests with browser-stored keys.

```
POST /api/AI/ConfigureKeys
{"provider": "openai", "key": "sk-..."}
```

The key is held in the AI server's process memory for the current session and persisted client-side in IndexedDB (optionally encrypted with a passphrase) so a refresh re-submits it automatically. Keys are never written to disk on the server.

## What's intentionally absent

- **No accounts.** No login, no JWT, no Firebase. The machine running StemStudio is the trust boundary.
- **No telemetry.** Zero outbound calls except those you initiate (AI requests, multiplayer connections, asset loads).
- **No managed asset CDN.** Asset URLs are configurable via `ASSET_BASE_URL`. The default points at a permissive public mirror.
- **No project gallery, no discovery.** Current portability is folder-backed
  `.stemscript.json` project data; a self-hosted static build is the entire
  application, not a published project.
