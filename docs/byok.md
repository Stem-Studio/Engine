# Bring Your Own Keys (BYOK)

StemStudio does not ship with managed API keys. AI features work only when you provide your own provider credentials. This page explains how that works, what the supported providers are, and where your keys live.

## Supported providers

| Provider | Used for | Env variable | Get a key |
|---|---|---|---|
| Anthropic | AI copilot, behavior generation, dialogue | `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com/) |
| OpenAI | Alternate copilot, image generation | `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com/) |
| Gemini | Alternate copilot | `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com/) |
| Meshy | Text-to-3D model generation | `MESHY_API_KEY` | [meshy.ai](https://meshy.ai/) |
| Tripo | Alternate text-to-3D + character rigging | `TRIPO_API_KEY` | [tripo3d.ai](https://www.tripo3d.ai/) |
| Rodin (Hyper3D) | Alternate text-to-3D model generation | `RODIN_API_KEY` (or `HYPER3D_API_KEY`) | [hyper3d.ai](https://hyper3d.ai/) |
| ElevenLabs | Text-to-speech, NPC voices | `ELEVEN_LABS_API_KEY` | [elevenlabs.io](https://elevenlabs.io/) |
| AnythingWorld | Rigged character + animation library | `ANYTHING_WORLD_API_KEY` | [anything.world](https://anything.world/) |

Any provider you don't configure simply won't be available — the editor disables features that need it and shows a "Configure key" CTA.

## Two ways to provide a key

### 1. Environment variables (recommended for solo dev)

Copy the example file:

```bash
cp .env.example .env
```

Fill in whichever keys you have. The AI server reads them at startup.

```bash
ANTHROPIC_API_KEY=sk-ant-...
MESHY_API_KEY=...
```

Restart `bun run dev` after editing `.env`.

### 2. In-editor entry (per-browser, per-session)

If you don't want to manage a `.env` file, the editor will prompt you the first time you try a feature that needs a key. Paste it in, and the editor:

1. Stores it in your browser's IndexedDB under origin `http://localhost:5173`.
2. Forwards it to the AI server on every request via the `X-BYOK-Key` header.

The key never touches the server's disk and is not shared with other browsers or other machines.

### Precedence

If a key is configured both ways, the **environment variable wins**. This makes it easy to override a saved BYOK key by setting an env var, and it means self-hosted deployments can pin keys without UI interference.

## How requests flow

In the local editor path, BYOK requests go through the AI server:

```
Editor                AI server                Provider (Anthropic, etc.)
  |                       |                              |
  | POST /api/AI/...      |                              |
  | X-BYOK-Provider: openai                              |
  | X-BYOK-Key: sk-...    |                              |
  |---------------------->|                              |
  |                       | resolve key:                 |
  |                       |   env var if present,        |
  |                       |   else session store,        |
  |                       |   else X-BYOK-Key header     |
  |                       |---------------------------->|
  |                       |                              |
  |                       |<----------------------------|
  |<----------------------|                              |
```

The AI server is a thin proxy. It does not modify prompts or responses (apart from provider-specific request shaping). Run `bun run dev:ai` and `curl http://localhost:8081/api/AI/Capabilities` to inspect its state.

In playground mode, the Copilot panel uses the browser-direct path instead:
the selected Anthropic, OpenAI/Codex, or Gemini key is read from the local BYOK
store, the browser calls the provider directly, and the returned Stem Script is
parsed into immutable command intents and applied through the in-editor command
registry. The playground copilot rejects file/import/export commands so
generation stays live in the browser instead of creating filesystem bundles.

See [Stem Script](./stem-script.md) for the Script Tool workflow, command
categories, and links to existing Stem Script game folders.

## Key storage details

**Server side:** keys exist only in process memory. Restarting `ai-server` clears them. Env-var keys are re-read on next start; BYOK keys are re-submitted by the editor on the next request.

**Client side:** BYOK keys live in IndexedDB under the database `stemstudio-byok`. By default they are stored as plaintext (the threat model is "a developer's own laptop"; if a process on your machine can read your IndexedDB, it can also read your `.env` and your shell history).

**Optional passphrase encryption.** From Settings → AI Provider Keys → "Set passphrase…" you can wrap the key store in `EncryptedBYOKKeyStore` (AES-GCM 256 + PBKDF2-SHA-256, 210k iterations). Once a passphrase is set, the editor prompts for it after every reload before it can read or write keys. The passphrase itself is never persisted. See `client/packages/editor-oss/src/ai/EncryptedBYOKKeyStore.ts`.

In playground mode, prompt-created projects perform a hard dashboard-to-editor
navigation. If a chat key is selected while the store is unlocked, the selected
key is staged in `sessionStorage` for that navigation and consumed into memory
on the editor page so the initial generation can start without a second
passphrase prompt. The staged value expires quickly and is cleared when keys are
cleared or reset.

If you want even stronger storage, the `BYOKKeyStore` interface (`client/packages/editor-oss/src/ai/BYOKKeyStore.ts`) accepts any alternative implementation — you can plug in OS-keychain access via a desktop wrapper (Tauri, Electron) without changing the rest of the editor.

## Rotating or removing a key

- **Rotate** (env var): edit `.env`, restart `bun run dev`.
- **Rotate** (BYOK): Settings → AI Provider Keys → enter a new value. The IndexedDB entry is overwritten.
- **Remove** (env var): delete the line from `.env`, restart.
- **Remove** (BYOK): Settings → AI Provider Keys → Clear. Deletes the IndexedDB entry.
- **Nuke everything**: clear site data for `localhost:5173` in your browser's devtools, or run `indexedDB.deleteDatabase('stemstudio-byok')` in the console.

## Cost considerations

You are billed directly by each provider for usage routed through your key. The editor does not aggregate, batch, or cache provider calls beyond what's necessary for a feature to work. If you want to cap spend:

- Most providers offer hard monthly limits in their console.
- The AI server exposes a request log in dev mode (`AI_SERVER_LOG_REQUESTS=true`) so you can see what the editor is sending.

## Self-hosting the AI server

If you want to share one AI server among several editors on a LAN, you can run it on a separate machine and point the editor at it:

```bash
# On the AI host
ANTHROPIC_API_KEY=... bun run dev:ai

# On each editor machine
VITE_AI_SERVER_URL=http://<host>:8081 bun run dev:editor
```

This is the same code that runs locally — just bound to a non-localhost interface. Don't expose it to the public internet without a reverse proxy that adds auth; it has no built-in authentication.
