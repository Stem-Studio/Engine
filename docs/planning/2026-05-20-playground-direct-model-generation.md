# Browser-direct model generation in the playground

> **Status: Historical implementation note.**
> The provider API calls described here concern optional generated assets, not
> remote scene loading. They do not change the current local Playground scope.
> See the [planning index](./README.md).

## Goal

The deployed playground has no Go `ai-server`. 3D model generation must route
straight to the provider's backend from the browser, gated on a BYOK key.

## CORS verification (real preflight tests)

- **Meshy** (`api.meshy.ai`) — reflects any `Origin`, allows the
  `Authorization` header. Browser-direct works.
- **Tripo** (`api.tripo3d.ai`) — sends no `Access-Control-Allow-Origin`.
  Browser-direct is impossible.
- **Anything World** — no active generation code in the repo.

Decision (confirmed with the user): **Meshy-direct, Tripo hidden in the
playground.** Local / integrated builds keep both via the Go server.

## Key discovery

The OSS model-generation UI was half-wired: `Create.tsx` and
`ObjectHandlers.handleGenerate3DModel` call `submitGenerationJob` — a
server background-job flow expecting a `job_id`. The OSS server
(`handle_jobs_oss.go`) stubs `/Job` with `404`, and `handle_meshy_generate_oss.go`
returns `task_id`. So that flow never worked in any OSS build.

The fix routes Meshy through the **polling flow** instead
(`generateModel` → poll task → import the resulting GLB).

## Implementation

- `editor-oss/src/ai/MeshyDirectClient.ts` (new) — browser-direct Meshy API
  (generate / refine / rig / poll), reads the `meshy` BYOK key.
- `ModelGeneratorProvider.ts` — in playground, Meshy generate / task-poll /
  refine / rig go through `MeshyDirectClient` instead of the Go endpoints.
- `uploadModelFromUrl.ts`, `AiWorldController.utils.tsx` — in playground,
  fetch the generated GLB straight from the provider CDN (no
  `/api/Proxy/Download`).
- `Create.tsx` — in playground the Meshy path uses the polling flow
  (`generate3dObject`) and imports the result with `uploadModelFromUrl`,
  then adds the ready object to the scene. Tripo/Erth hidden; Meshy forced
  as the default generator.
- `PromptStep.tsx` — generator picker shows only Meshy in the playground.

## Validation

- [x] `bun run typecheck` — 0 errors.
- [x] `bun run lint` (changed files) — 0 errors (pre-existing `any` warnings
      only).
- [x] OSS `vite build` — builds.
- [ ] Manual code review.
- [ ] Live playground test with a real Meshy key — generate a model end to
      end. **This also verifies the one residual unknown:** Meshy's asset CDN
      (`assets.meshy.ai`, CloudFront) CORS for the GLB download could not be
      confirmed without a real signed URL. If the CDN blocks cross-origin
      fetches, the download step needs a tiny stateless proxy even though the
      API itself does not.

## Out of scope

- `ObjectHandlers.handleGenerate3DModel` (copilot tool) still uses the job
  flow. The playground copilot (`DirectCopilotProvider`) now runs constrained
  StemScript through the browser command registry and explicitly rejects
  `generate_3d_model`, `add_model_to_scene`, and external asset search, so it
  still never reaches that model-generation handler.
- Image generation still routes through the Go server.
