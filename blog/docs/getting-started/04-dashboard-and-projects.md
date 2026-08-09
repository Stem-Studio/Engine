---
title: Local Project Flow
slug: local-project-flow
description: Create, open, save, and import browser-local StemStudio Playground projects.
status: current
audience: creators
prerequisites: [getting-started/01-what-is-stemstudio]
---

# Local Project Flow

The Playground dashboard is the home for projects stored in your browser or in
a local folder. It is not connected to a deployed account or remote scene API.

![Local project dashboard](images/dashboard.PNG)

## Choose Storage

On a normal local editor launch, the first-run prompt offers:

- **IndexedDB** — browser-local storage with no folder permission.
- **Local folder** — Chromium's File System Access API writes
  `.stemscript.json` project files and packaged assets into a folder you
  choose.

The public Playground may choose its local storage mode automatically and hide
the bootstrap prompt. In either case, projects remain local to the browser
origin. A project created at `localhost` does not appear automatically on a
hosted Playground, or vice versa.

## Create A Project

The create dashboard offers two primary paths:

- **Start from scratch** opens the full editor with a new local project.
- **Create from a prompt** opens the Copilot-focused flow. In Playground mode
  it needs a browser-stored provider key.

Templates may appear when the running build has local template data. Do not
depend on a remote template catalog: the remote API-backed mode is not
deployed.

## Open And Save

Open a project card to continue editing it. The editor auto-saves to the active
project store. During play mode, physics and behavior changes are temporary;
stopping play restores the edit-time scene.

### Refresh-safe editor links

Playground editor links include both the scene name and the active action:

- `/create/project/<project-id>/<scene-name>/edit` opens the editor.
- `/create/project/<project-id>/<scene-name>/play` restores play mode.

The project ID loads the browser-local project; the scene-name segment is a
readable URL label. Refreshing the page preserves the selected mode. Playground
links include `?mode=playground` so a new tab keeps the same local-only boundary.

For important work:

1. Watch for save errors before closing the tab.
2. Keep browser site data intact when using IndexedDB.
3. Prefer folder storage when you need visible files or external backups.
4. Reconnect the same folder if the browser asks for permission again.

Changing the selected storage mode does not automatically move projects
between IndexedDB and a folder.

## Import

In Chromium browsers with the File System Access API, use **Import project
file** for a self-contained `.stemscript.json` project.
When a project has packaged assets, use **Import project folder** and select
the folder containing the project file and matching `oss-<project-id>/` asset
directory. The Playground creates a new local project and remaps imported
identities; it does not overwrite the source files.

Treat unresolved-file, conversion, or save errors as failed imports. Do not
assume that a project JSON alone embeds every model, texture, audio file, or
other binary asset.

## Features Deliberately Absent In Playground

The Playground hides account, publish, public/private, collaboration, admin,
and remote-upload surfaces. Local JSON scene/source and STL geometry exports
may be available in the editor menu, but they are not a hosted publish flow or
a complete standalone game package.

There is therefore no **Shared with Me**, hosted **Community** gallery,
collaborator management, public project URL, or cloud archive in the current
workflow.

## Next Steps

- Read [Editor Tour](02-editor-tour.md) for the authoring layout.
- Follow [Your First Game](getting-started-tutorial.md).
- Read [Saving and Sharing](../shipping.md) before moving an important project.
- Use [Troubleshooting](../troubleshooting.md) for storage and reload issues.
