# Engine documentation

These are the repository-facing guides for the StemStudio editor and runtime.
The current product focus is the **browser-local Playground**. Projects are
created, loaded, edited, played, and saved in the browser. A remote mode backed
by scene and asset APIs exists as an integration seam, but it is not a deployed
or supported user workflow yet.

## Start here

| Goal | Guide |
| --- | --- |
| Understand the local architecture | [Architecture](architecture.md) |
| Run the editor and public Playground | [Site and Playground](site.md) |
| Configure local AI keys | [BYOK](byok.md) |
| Learn behavior scripting | [Built-in behaviors](built-in-behaviors.md) |
| Learn the ECS-style lambda layer | [Lambdas](lambdas.md) |
| Use the runtime API | [Runtime API](runtime-api.md) |
| Use `GameObject` and `GameManager` | [GameObject and GameManager API](gameobject-and-game-manager-api.md) |
| Configure scheduler and quality settings | [Scheduler and editor settings](scheduler-and-editor-settings.md) |
| Move a project between machines | [Exporting a game](exporting-a-game.md) |
| Integrate a future storage backend | [Server-side storage](server-side-storage.md) |

Builder tools have separate guides for [Quick Build](quick-build.md),
[BIM Plan/CAD](plan-cad.md), and their
[release gate](builder-studio-release-gate.md).

## Current capability boundary

- **Supported now:** local Playground editing, play mode, IndexedDB
  persistence, Chromium folder persistence, Ammo and Rapier physics, local
  BYOK copilot, and browser-direct Playground providers where the UI offers
  them.
- **Mobile authoring:** landscape only. Portrait intentionally shows the
  rotate-device gate instead of the editor. The minimum phone QA viewport is
  `844 × 390` CSS pixels in landscape.
- **Optional local development services:** the Go AI proxy and Colyseus
  sidecar started by `bun run dev`.
- **Not a deployed product workflow:** accounts, cloud project sync,
  collaboration through hosted scene APIs, a public project gallery, one-click
  publishing, or a hosted remote scene loader.
- **Not yet packaged:** a standalone player-only export containing a selected
  project and all of its binary assets.

## Terminology

- A **project** is the persisted unit shown on the local dashboard.
- A **scene** is the Three.js scene and its serialized settings inside a
  project. Older APIs and files sometimes use `scene` where the UI says
  `project`.
- A **game** is the experience while play mode or the player runtime is
  running. “Game” is not a separate storage type.
- **Playground mode** is the local-first, browser-only product surface enabled
  by `?mode=playground`. It deliberately hides remote-only account, publish,
  collaboration, admin, and upload surfaces. Local source/geometry export
  actions may still be present; they are not cloud publishing.
- **Refreshable scene URLs:** once a Playground scene is open, the editor uses
  `/create/project/<project-id>/edit` or `/play` and keeps
  `?mode=playground&scene=<scene-name>` on the URL. The project ID is
  authoritative for local loading; the scene query is a readable label.
  Refreshing either URL restores the corresponding edit or play state. The
  former `/<scene-name>/<mode>` form remains accepted for old bookmarks.

Historical notes and dated plans under `planning/` describe decisions at the
time they were written. Treat them as context, not as current user
documentation.
