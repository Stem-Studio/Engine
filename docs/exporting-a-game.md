# Exporting and self-hosting

StemStudio's current supported product workflow is the local-first Playground.
It does **not** yet ship a project publishing pipeline or a standalone
player-only package that embeds a selected project and all of its binary
assets.

Keep these three operations separate:

1. **Persist a project locally** in IndexedDB or a Chromium-selected folder.
2. **Move project data** between local editor installations.
3. **Build the entire StemStudio application** as a static web deployment.

The third operation does not automatically perform the first two.

## Keep a portable project

Folder storage is the reliable current path when portability matters:

1. At the local storage bootstrap, choose a folder in a Chromium browser.
2. Create or import the project.
3. Let the editor save the `.stemscript.json` file and packaged asset data.
4. Copy or version the whole project folder, not just one JSON file.
5. Reconnect that folder in the destination editor.

The editor menu currently offers **Export Scene Source (.json)** and an STL
geometry export. Older builds labelled the JSON action **Export Game**, but it
has never been a standalone-game packager. The JSON action serializes the
current scene and asset metadata; the STL action exports printable mesh
geometry. Neither action creates a standalone player, publishes a URL, or
guarantees a portable bundle containing every binary asset.

The `ProjectStore` interface also has `exportToBlob` and `importFromBlob`
methods. Those are storage integration APIs and should not be confused with
the menu's scene-source export.

A project JSON is not guaranteed to embed every model, texture, audio file, or
other binary asset. Moving only the JSON can therefore produce missing assets.

## Build the whole application

The repository can produce static application files:

```bash
bun run build
bunx http-server build/public -p 8080
```

Open `http://localhost:8080/` and use the Playground/local dashboard. Every
visitor still gets their own browser-local project store. The build does not
preload one developer's IndexedDB project, create user accounts, or turn a
project into a public game URL.

The static output includes editor, site, and player entry points because they
share the runtime. The `/play/:projectID` route expects an API-backed project
identifier; that remote scene-loading mode is not deployed yet and should not
be presented as a current sharing flow.

## Optional local services

- AI in the Playground can call supported providers directly with the user's
  browser-stored key.
- `bun run dev:ai` starts the optional Go proxy for local development.
- `bun run dev:mp` starts the optional Colyseus sidecar for local multiplayer
  testing.

A static host does not automatically deploy either sidecar. If a self-hosted
integration depends on them, you must operate and secure them separately.

## Hosting checklist

- Serve the Vite output with SPA fallback rules from the repository.
- Use HTTPS outside `localhost`.
- Serve `.wasm` with `application/wasm`.
- Preserve the Content Security Policy allowances required by WebGPU, WASM,
  workers, and any explicitly configured provider endpoints.
- Test folder access separately; the File System Access API is Chromium-only
  and requires a secure context.
- Do not expose the local AI proxy directly to the public internet without
  adding authentication and abuse controls.

## Not implemented yet

- One-click cloud publishing, visibility, discovery, or remix
- Hosted remote scene and asset APIs
- A runtime-only artifact containing one selected project
- Automatic binary-asset bundling for every IndexedDB project
- Turnkey mobile or third-party platform packages

Until those exist, describe the output as a local project or a self-hosted
StemStudio application—not as a published standalone game.
