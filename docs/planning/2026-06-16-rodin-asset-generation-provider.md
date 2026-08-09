# Rodin asset-generation provider support

> **Status: Historical, unverified proposal.**
> This is not an active release commitment. Any future provider work must be
> revalidated independently and must not become a fallback for local Playground
> scene loading. See the [planning index](./README.md).

## Goal

Add Rodin/Hyper3D as a 3D asset generation provider alongside Meshy and
Tripo. The first implementation should let a user generate and import a GLB
model from a text prompt, then extend to image-to-3D once the Rodin upload
contract is confirmed.

## Product scope

Supported in the first pass:

- Text-to-3D generation through Rodin.
- Optional single-image input if Rodin accepts either a remote image URL or a
  simple upload token in its public API.
- GLB output imported through the existing generated-model upload/import path.
- BYOK with server env and per-request/session key fallback.
- Create context-menu provider selection, script/runtime API provider values,
  and backend task polling.

Deferred:

- Multi-reference image fusion, pose/direction controls, and advanced Rodin
  generation presets.
- Browser-direct Rodin in the public playground.
- Rodin-specific edit/refine workflows after first generation.
- Rigging/animation until Rodin exposes a stable equivalent to Meshy rigging or
  Tripo rig/retarget.

## Current system

Frontend:

- `client/packages/editor-oss/src/utils/ModelGeneratorProvider.ts` owns the
  provider enum, request payload selection, task polling, Meshy refine/rig, and
  Tripo animation helpers.
- `client/packages/editor-oss/src/editor/assets/v2/ContextMenu/Create/PromptStep.tsx`
  shows an admin-only provider combobox from `GENERATOR_TYPES`.
- `client/packages/editor-oss/src/editor/assets/v2/ContextMenu/Create/Create.tsx`
  submits Meshy/Tripo to the background job path outside playground mode and
  uses direct polling for Erth and playground Meshy.
- `client/packages/editor-oss/src/controls/AiWorldController/AiWorldController.ts`
  wraps `ModelGeneratorProvider` and uploads completed model URLs.
- `client/packages/editor-oss/src/behaviors/stem/ai/StemAI.ts` and
  `createAIInterface.ts` expose `"meshy" | "tripo"` to runtime behavior code.
- `client/packages/editor-oss/src/agent/handlers/ObjectHandlers.ts` currently
  hard-codes Meshy for `generate_3d_model`.

Backend:

- `server/server/controllers/tools/ai/helpers/api_clients.go`,
  `meshy_client.go`, and `tripo_client.go` normalize provider auth, request,
  and polling behavior into `UnifiedTaskResponse`.
- `server/server/controllers/tools/ai/object_generation/handle_meshy_generate_oss.go`
  and `handle_tripo_generate_oss.go` create provider tasks.
- `server/server/controllers/tools/ai/object_generation/handle_task.go` polls
  Meshy, Meshy rigging, Tripo, and Erth tasks.
- `server/server/controllers/tools/ai/byok/handle_capabilities.go` lists
  provider env vars used by the BYOK capabilities endpoint.

Important mismatch to fix while adding Rodin:

- In OSS, `/api/AI/ObjectGeneration/Meshy/Generate` and
  `/api/AI/ObjectGeneration/Tripo/Generate` return `task_id`.
- `ModelGeneratorProvider.submitGenerationJob` expects `job_id`, while
  `handle_jobs_oss.go` explicitly says server-side generation jobs are not
  available in OSS mode.
- Rodin should not copy this mismatch. Either the Create flow should use the
  polling path when the server returns `task_id`, or OSS should get a real
  local job wrapper that turns provider tasks into `job_id` records.

## External Rodin facts confirmed

Hyper3D's public Rodin site describes Rodin as an image/text-to-3D product,
supports export formats including GLB/GLTF, FBX, OBJ, STL, and USD, supports
multiple reference images, polygon-count controls, and says API access is tied
to business subscriptions.

The public site did not expose a stable API contract in searchable docs or the
SPA bundle. Implementation must start with an API-contract spike against the
actual Rodin business/API docs before coding request fields.

References:

- https://hyper3d.ai/
- https://hyper3d.ai/rodin

## Design

### 1. Add a normalized provider capability table

Create a small provider metadata map near `GENERATOR_TYPES` instead of adding
more `if generator === ...` checks:

```ts
type ModelGeneratorCapability = {
  label: string;
  byokProvider: "meshy" | "tripo" | "rodin";
  supportsTextToModel: boolean;
  supportsImageToModel: boolean;
  supportsRefine: boolean;
  supportsAutoRig: boolean;
  supportsBrowserDirectPlayground: boolean;
};
```

Initial values:

- Meshy: text/image, refine, auto-rig, browser-direct playground.
- Tripo: text/image, auto-rig via existing Tripo rig/retarget helpers, no
  browser-direct playground.
- Rodin: text first, image only after upload contract spike, no refine/rig,
  no browser-direct playground.
- Erth: internal primitive builder, no BYOK.

Use this in `PromptStep.tsx` to show/hide auto-rig, refine, model version, and
texture quality controls instead of provider-specific inline conditions.

### 2. Backend Rodin client

Add:

- `server/server/controllers/tools/ai/helpers/rodin_client.go`
- Rodin client type and constructors in `api_clients.go`
- `RodinAPIBaseURL`, preferably overrideable with `RODIN_API_BASE_URL`
- BYOK lookup using provider key `rodin` and env vars
  `RODIN_API_KEY`, then `HYPER3D_API_KEY`

The client should provide:

```go
func NewRodinClientWithKey(byokKey string) (*RodinClient, error)
func (c *RodinClient) MakeRequest(method, endpoint string, payload any) (*http.Response, error)
func (c *RodinClient) FetchTask(taskID string) (*UnifiedTaskResponse, error)
```

`FetchTask` must normalize Rodin statuses into the existing frontend status
vocabulary:

- success: `completed`, `succeeded`, or provider equivalent
- active: `queued`, `pending`, `running`, `processing`, or provider equivalent
- failed: `failed`, `canceled`, `cancelled`, or provider equivalent

`UnifiedTaskResponse.Model` must be a GLB URL whenever possible. If Rodin
returns multiple output formats, prefer GLB, then GLTF, then fail with a clear
message rather than importing OBJ/FBX through an unverified path.

### 3. Backend routes

Add:

- `POST /api/AI/ObjectGeneration/Rodin/Generate`
- `GET /api/AI/ObjectGeneration/Task?generator=rodin`

The generate handler should:

- call `userlimits.Require3D` / `Consume3D` like Meshy and Tripo
- resolve BYOK using `byok.ResolveFromRequest(r, "rodin", byok.ProviderEnvVars("rodin")...)`
- validate non-empty prompt for text generation
- map StemStudio's normalized request into Rodin fields after the API spike
- return `{ "task_id": "<rodin-task-id>" }`

If Rodin requires file upload before image-to-3D, add a Rodin-specific upload
handler instead of reusing `/Tripo/Upload`, because Tripo's upload response
shape is `image_token` specific to Tripo.

### 4. Frontend routing

Add `RODIN = "rodin"` to `GENERATOR_TYPES`.

In `ModelGeneratorProvider.generateModel`:

- build a Rodin payload from `GenerateModelRequest`
- POST to `/api/AI/ObjectGeneration/Rodin/Generate`
- poll `getTaskStatus(taskId, "rodin")`
- use longer Meshy-like timeout defaults until Rodin timings are measured

In `submitGenerationJob`:

- either add a Rodin branch only for environments with real server jobs, or
  make the method handle `{task_id}` by returning a client-side polling marker.
- Prefer the cleaner fix: `Create.tsx` should choose background jobs only when
  the server advertises job support. In OSS, Meshy, Tripo, and Rodin should use
  the polling/import flow.

In `Create.tsx`:

- update "Meshy/Tripo" comments and conditions to capability-based checks.
- do not show Rodin in the playground until Rodin CORS and CDN download CORS
  are tested with real signed URLs.

In `AiWorldController.ts`:

- allow Rodin in generation and rigging metadata, but only set `isRigged` for
  providers with a proven rigging path.

### 5. Runtime and agent surfaces

Update:

- `StemAI.ts` generator union to `"meshy" | "tripo" | "rodin"`.
- `createAIInterface.ts` to map `"rodin"` to `GENERATOR_TYPES.RODIN`.
- `docs/runtime-api.md` generator examples and parameter docs.
- `docs/byok.md`, `README.md`, `CONTRIBUTING.md`, and `CLAUDE.md` provider
  lists after implementation.
- `ObjectHandlers.handleGenerate3DModel` to accept an optional provider or use
  the configured default instead of hard-coding Meshy.
- Script-tool help data if `generate model` exposes provider choices.

### 6. CSP and download/import

Rodin output URLs may use `file.hyper3d.com` or another CDN. Add only the
domains verified from real Rodin task output to:

- `client/packages/editor-oss/src/utils/CSPMetaTag.tsx`
- any provider/CDN allowlists used by `uploadModelFromUrl` or proxy download
  helpers

Do not add broad `*.hyper3d.ai` or wildcard CDN permissions unless the provider
requires them and they are documented.

## API contract (recorded 2026-06-18)

Implemented against the public Hyper3D Rodin (Gen-2) API — the same contract
used by Hyper3D's developer platform and the BlenderMCP integration. Base URL
`https://hyperhuman.deemos.com/api/v2`, overridable via `RODIN_API_BASE_URL`.
Auth: `Authorization: Bearer <API_KEY>`.

- **Create** `POST /rodin` — `multipart/form-data`. Fields used:
  `prompt`, `tier` (Regular), `quality` (high|medium|low|extra-low),
  `material` (PBR), `geometry_file_format` (glb). Response:
  `{ "uuid": "<task>", "jobs": { "uuids": [...], "subscription_key": "<key>" } }`.
- **Status** `POST /status` — JSON `{ "subscription_key": "<key>" }` →
  `{ "jobs": [ { "uuid": "...", "status": "Done"|"Generating"|"Waiting"|"Failed" } ] }`.
- **Download** `POST /download` — JSON `{ "task_uuid": "<task>" }` →
  `{ "list": [ { "name": "model.glb", "url": "https://..." } ] }`.

Because status keys off the subscription key and download keys off the task
uuid, the wrapper threads both through a composite `task_id`:
`"<task_uuid>|<subscription_key>"` (see `EncodeRodinTaskID` /
`helpers/rodin_client.go` and `RodinDirectClient.ts`).

Status normalization → unified poller vocabulary: any `Failed`/`error` →
`failed`; all jobs `Done` → `completed`; otherwise `processing` with
progress = done/total. GLB preferred over GLTF; other formats rejected.

**Still unverified without a live business key** (the final checklist item):
exact `quality`/`tier` enum acceptance, output CDN host (assumed `*.deemos.com`,
added to CSP alongside the `*.s3...` allowlist), signed-URL TTL, and whether the
output CDN sends permissive CORS for the playground origin. If the playground
origin is blocked, generation surfaces a clear network error; desktop builds
fetch the same CDN directly too (this OSS build ships no download proxy).

## API-contract spike

Before implementation, confirm:

- Base URL and endpoint names.
- Auth header format.
- Text-to-3D request fields.
- Image-to-3D upload or image URL flow.
- Task creation response shape.
- Task status response shape and all terminal/active status values.
- Output URL fields and supported model formats.
- Whether output URLs are signed and how long they remain valid.
- Whether output CDN permits browser fetches from the playground origin.
- Rate-limit and credit error shapes.

Record these findings in this file before coding `RodinClient`.

## Implementation checklist

- [x] Complete Rodin API-contract spike. (recorded above)
- [x] Add `rodin` to backend BYOK capabilities.
      (`byok/handle_capabilities.go`)
- [x] Add `RodinClient` and unit tests for auth, request body, status
      normalization, and GLB URL selection.
      (`helpers/rodin_client.go`, `helpers/rodin_client_test.go`)
- [x] Add Rodin generate and task routes.
      (`object_generation/handle_rodin_generate_oss.go`, `handle_task.go`)
- [x] Add frontend provider enum and capability metadata.
      (`utils/ModelGeneratorProvider.ts` — `GENERATOR_TYPES.RODIN`,
      `MODEL_GENERATOR_CAPABILITIES`)
- [x] Add Rodin to `ModelGeneratorProvider.generateModel` and polling.
      (+ browser-direct `ai/RodinDirectClient.ts` for playground)
- [x] Fix OSS Create flow so provider tasks can poll/import without relying on
      unavailable server jobs. (`Create.tsx` drops the job path; all providers
      poll + `uploadModelFromUrl`, which now fetches CDN-direct under OSS)
- [x] Add Rodin to runtime AI and agent command surfaces.
      (`StemAI.ts`, `createAIInterface.ts`, `ObjectHandlers.handleGenerate3DModel`
      now takes an optional `provider`, `CommandsRegistry` + `helpData`)
- [x] Update docs and setup env examples. (`byok.md`, `runtime-api.md`,
      `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `.env.example`)
- [ ] Verify with one real Rodin text-to-3D task and one failure case.
      **Blocked** — needs a live Hyper3D business key + network access, which
      isn't available in this environment. All other layers are unit/integration
      tested (Go httptest for the client, Vitest for the codec/capabilities) and
      both builds pass.

## Validation

- [x] `go build -tags oss ./cmd/ai-server` (full server compiles, Rodin route registered)
- [x] `go test -tags oss ./server/controllers/tools/ai/...` (helpers + byok green)
- [x] `bun run typecheck`
- [x] `bun run lint` (0 errors)
- [x] `bun run test` — script-tool + ai suites (231 tests) incl. new Rodin tests
- [x] `bun run build` (Vite production build succeeds)
- [ ] Manual local flow with a real `RODIN_API_KEY` (blocked — see above)
- [x] Manual code review

## Verification plan

- `go test ./server/controllers/tools/ai/...` or the closest package-scoped Go
  test command after adding backend tests.
- `bun run typecheck`.
- Targeted Vitest for `ModelGeneratorProvider` provider routing if existing
  test harnesses can mock `getAIBackend`.
- Manual local flow with `RODIN_API_KEY`: Create menu -> Rodin -> prompt ->
  generated GLB appears in scene.
- Negative manual flow with missing key: clear error from capabilities/BYOK.

## Open questions

- What is the exact Rodin API contract for task creation and status polling?
- Should Rodin be visible to all users or remain admin-only with the current
  generator combobox behavior?
- Should image-to-3D be enabled immediately or after text-to-3D is stable?
- Should Rodin outputs be passed through a local server proxy for download
  consistency even if CORS allows direct browser fetches?
