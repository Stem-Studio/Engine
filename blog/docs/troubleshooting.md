---
title: Playground Troubleshooting
slug: troubleshooting
description: Diagnose local project, WebGPU, save, physics, asset, and AI issues in the StemStudio Playground.
status: current
audience: creators
prerequisites: []
---

# Playground Troubleshooting

Start by confirming that the problem occurs in Playground mode and in the
project you intended to open. Remote API-backed scene loading is not deployed,
so account, publish, cloud, or remote-scene workflows are not expected to work.

## The Viewport Does Not Start

StemStudio prefers WebGPU and has a WebGL compatibility fallback.

1. Use a current Chrome, Edge, or another Chromium browser. WebGPU is
   preferred.
2. Check `chrome://gpu` and confirm hardware acceleration is active. WebGPU is
   preferred; when its initialization fails, the runtime retries with WebGL.
3. Update the browser and graphics driver.
4. Reload without extensions if an extension injects errors into the page.

If both WebGPU and the WebGL compatibility path fail, the viewport cannot
start. Post-processing can differ on fallback, so verify the project visually.

## A Phone Shows “Rotate Your Device”

That is expected in portrait. The mobile editor supports landscape authoring
only; rotate the device and keep at least an `844 × 390` CSS-pixel viewport.
Portrait editor layouts are intentionally outside the support and QA target.

## A Project Disappeared

IndexedDB projects belong to one browser profile and one origin. Projects at
`localhost`, `127.0.0.1`, and a hosted Playground are separate.

- Reopen the same URL and browser profile used to create the project.
- Do not clear site data while projects exist only in IndexedDB.
- For durable, inspectable files, use Chromium folder storage and back up the
  selected folder.
- If folder permission expired, use the dashboard's reconnect-folder action
  and select the same folder again.

Switching storage modes does not automatically migrate an existing project.

## A Save Does Not Finish

- Wait for an import or asset conversion to finish before closing the tab.
- Check that the selected folder is still writable.
- Look for an error toast; failed asset writes should not be treated as a
  successful save.
- In browser developer tools, inspect the first application error rather than
  unrelated extension warnings.

Play-mode movement is temporary. Stopping play restores the edit-time scene.

## Physics Looks Wrong

- Confirm the project uses **Ammo** or **Rapier**.
- Use static bodies for floors and complex concave world geometry.
- Use simple box, sphere, or capsule colliders where possible.
- Avoid dynamic concave hulls.
- Confirm scale and transform values before creating a body.
- Enable the physics debug view and compare the collider with the visible
  mesh.

Backend-specific edge cases can exist even though the common object API is
shared. Re-test important mechanics on the engine selected for the project.

## An Asset Is Missing After Reload

- Keep project files and their packaged asset data together.
- A `.stemscript.json` file is not automatically a self-contained game bundle
  in every storage/import flow.
- In Chromium browsers with the File System Access API, use **Import project
  folder** when the project has a matching
  `oss-<project-id>/` asset directory. The importer rejects incomplete bundles
  before saving a partial project.
- Browser object URLs are temporary and cannot be used as durable asset
  references.
- Retry the import and treat any unresolved import or save error as a real
  failure.

## AI Is Unavailable

Playground AI uses your browser-stored provider key. It does not depend on a
deployed StemStudio AI server.

- Open the Copilot key control and configure a supported provider.
- Confirm the selected provider supports the requested feature in Playground
  mode.
- Browser-direct requests are subject to the provider's CORS, quota, billing,
  and content policies.
- Never share a Playground URL expecting your browser-stored key to travel
  with it.
