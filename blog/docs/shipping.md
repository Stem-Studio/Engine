---
title: Saving and Sharing
slug: saving-and-sharing
description: What the StemStudio Playground saves today and the current limits of export and publishing.
status: current
audience: creators
prerequisites: [getting-started/04-dashboard-and-projects]
---

# Saving and Sharing

The Playground is local-first. It is ready for building and testing projects,
but it does not currently provide one-click cloud publishing or a standalone
game package.

## Where Projects Are Saved

- **IndexedDB** stores projects inside the current browser profile and origin.
  It is the simplest option, but clearing site data removes those projects.
- **Folder storage** writes `.stemscript.json` project files and packaged
  assets to a folder you choose. It requires a Chromium browser and is the best
  option when you need visible files, backups, or Git.

The editor auto-saves to the active project store. Save before closing the tab
when the UI reports pending changes, and keep an external backup of important
folder projects.

## Moving A Project

Folder-backed projects are the current reliable portability path:

1. Choose folder storage before creating or importing the project.
2. Allow the browser to write to that folder.
3. Copy the project file together with its packaged asset data.
4. On the destination machine, reconnect the folder or import the project from
   the local dashboard.

The editor menu offers **Export Scene Source (.json)** and STL geometry export.
These are useful authoring outputs, but neither is a complete standalone game:
binary assets may remain external, no player is packaged, and no public URL is
created. IndexedDB contains the authoritative local project, but there is not
yet a “download this complete playable game” button.

## What Is Not Available Yet

- A hosted project URL backed by StemStudio scene APIs
- Public/private publishing, discovery, or remix pages
- Cloud accounts, cloud sync, or hosted collaboration
- A player-only bundle containing one selected project and every binary asset
- Turnkey iOS, Android, Steam, Discord, or portal packaging

Developers can build and self-host the whole static application. That is an
application deployment, not a project publishing flow; it does not
automatically preload a local project for visitors. See the repository's
`docs/exporting-a-game.md` for that boundary.
