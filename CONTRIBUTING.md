# Contributing to StemStudio

Thanks for your interest in contributing. This document explains how the codebase is organized and how to land a good PR.

## Code of Conduct

Please read and follow our [Code of Conduct](./CODE_OF_CONDUCT.md). Be kind, be specific, assume good intent.

## Quick links

- [Where to file issues](https://github.com/your-org/stemstudio/issues)
- [Architecture overview](./docs/architecture.md)
- [BYOK setup](./docs/byok.md)
- [Multiplayer guide](./docs/multiplayer.md)
- [Exporting a game](./docs/exporting-a-game.md)

## Development setup

```bash
git clone https://github.com/your-org/stemstudio.git
cd stemstudio
git submodule update --init --recursive
bun install
bun run dev
```

Open `http://localhost:5173` and follow the first-time bootstrap.

For AI features, copy `.env.example` to `.env` and fill in whichever provider keys you want — or skip them all and the editor will prompt you when needed.

## How the codebase is organized

```
client/
  packages/
    editor-oss/        ← Editor, player, runtime, behaviors, lambdas,
                         physics, render, multiplayer client, Monaco,
                         AI/persistence/asset interfaces.
    shared/            ← Thin re-export shims plus app boot.
    network/           ← HTTP client adapters (api/scene, api/asset, etc.).

stemstudio-multiplayer/ ← Colyseus server. Runs as a sidecar in dev
                          (bun run dev:mp); deploy standalone for production.

server/
  cmd/ai-server/       ← Go AI proxy entry point. Forwards calls to
                         Anthropic, OpenAI, Meshy, Tripo, Rodin, ElevenLabs,
                         AnythingWorld using env keys or BYOK keys forwarded
                         by the editor.
  server/controllers/tools/ai/        ← AI handler implementations.
  server/controllers/tools/ai/byok/   ← BYOK key resolution.

scripts/               ← Dev scripts.
docs/                  ← Contributor and user documentation.
```

## Code organization rules

A few practical constraints keep the codebase consistent:

### Use the interfaces, don't `fetch` directly

- **AI calls** go through `AIBackend` (`client/packages/editor-oss/src/ai/AIBackend.ts`). The default implementation talks to the local AI server. BYOK keys are stored client-side via `BYOKKeyStore` (IndexedDB-backed, optional passphrase encryption).
- **Auth** goes through `IAuthProvider` (`client/packages/editor-oss/src/auth/IAuthProvider.ts`). The default `NullAuthProvider` returns a dummy local user so backend requests can carry a stable token.
- **Analytics** goes through `IAnalyticsRecorder` (default: no-op).
- **Remote docs** go through `IRemoteDocStore` (default: no-op).
- **Project save/load** goes through `ProjectStore` (`client/packages/editor-oss/src/persistence/ProjectStore.ts`). Implementations: `IndexedDBProjectStore`, `FileSystemProjectStore`.
- **Copilot** goes through `ICopilotProvider`. Wire in an ACP-compatible bridge to enable it.

If you need a capability these interfaces don't expose, extend the interface — don't bypass it.

### Behaviors with optional backends

If you add a behavior that uses multiplayer or AI, it must degrade gracefully when the sidecar isn't running or no AI key is configured. Log a clear message and no-op — don't crash, don't pop modals on every frame.

### Lint gates

```bash
bun run lint                # full repo lint
bun run lint:oss-boundary   # narrow gate on packages/editor-oss/
```

`lint:oss-boundary` runs `client/eslint.boundary.cjs` and rejects imports from packages that aren't part of this repo. Keep `editor-oss/` self-contained.

## Submitting a PR

1. **Branch from `main`.** Use a descriptive name: `feat/...`, `fix/...`, `docs/...`, `refactor/...`.
2. **One topic per PR.** Smaller is better.
3. **Tests:** add or update tests for the change. Bun's test runner is the default; Vitest is also supported.
4. **Verification before submitting:**
   ```bash
   bun run typecheck
   bun run lint
   bun run lint:oss-boundary
   bun run test
   bun run build
   ```
   All five must pass.
5. **PR description template:**
   - **What:** one-paragraph summary.
   - **Why:** the user problem or technical motivation.
   - **How:** brief design notes if the change is non-trivial.
   - **Test plan:** what you did to verify, including OSS-boundary checks.

## Reviewer checklist

Reviewers will look for:

- [ ] No new imports in `editor-oss/` from packages outside this repo.
- [ ] AI / persistence / asset code paths go through the interfaces.
- [ ] `bun run dev` still boots cleanly end-to-end.
- [ ] First-time bootstrap modal still works on a fresh IndexedDB.
- [ ] If the change touches behaviors: behavior lifecycle is respected, Three.js resources are disposed, no leaked timers/listeners.
- [ ] If the change touches multiplayer: graceful degradation when sidecar is unavailable.
- [ ] If the change touches AI: graceful degradation when no key is configured.
- [ ] Tests added or updated.

## Adding a behavior

The fastest way to learn the codebase is to add a behavior. Short version:

1. Create `client/packages/editor-oss/src/behaviors/packs/<category>/myBehavior.ts`.
2. Extend `Behavior`. Override `init(game)`, `update(dt)`, and any event handlers you need.
3. Register the behavior type in the appropriate pack `index.ts`.
4. Add a test under `client/packages/editor-oss/src/behaviors/packs/<category>/__tests__/myBehavior.test.ts`.
5. Document any attributes in JSDoc on the class.

Read `client/packages/editor-oss/src/behaviors/Behavior.ts` first — that's the base class plus the lifecycle contract.

## Adding an AI provider

The AI server registers providers by environment variable. To add a new one:

1. Add a provider client under `server/server/controllers/tools/ai/helpers/` (mirror the existing `claude.go` / `openai.go` shape).
2. Register the provider in `server/server/controllers/tools/ai/byok/resolve.go`'s `ProviderEnvVars` map so BYOK lookup knows how to find its env key.
3. Wire it into `helpers.NewLLMProvider` / `NewLLMProviderWithKey` if it's an LLM-class provider.
4. Add the env var to `.env.example` and document the key shape in `docs/byok.md`.

## Questions?

Open a [GitHub Discussion](https://github.com/your-org/stemstudio/discussions) or an [Issue](https://github.com/your-org/stemstudio/issues). For security disclosures, see [SECURITY.md](./SECURITY.md).

Thanks for contributing.
