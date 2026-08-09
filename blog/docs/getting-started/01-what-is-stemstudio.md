---
title: What Is StemStudio?
slug: what-is-stemstudio
description: An overview of the local-first StemStudio Playground and its current creation workflow.
status: current
audience: beginners
prerequisites: []
---

# What Is StemStudio?

StemStudio is a browser-based 3D game editor and runtime. The current product
focus is the **Playground**: build and test projects locally in your browser,
with no account or remote scene service required.

![Gallery of example games made with StemStudio](images/dashboard-with-games.png)

## What You Can Build

StemStudio is designed for a wide range of 3D projects:

- **Action games** — Platformers, shooters, obstacle courses
- **Puzzle games** — Physics-based puzzles, escape rooms, logic challenges
- **Social experiences** — Multiplayer hangouts, virtual spaces, showcase rooms
- **Simulations** — Physics sandboxes, educational demos, interactive visualizations
- **Story-driven games** — Adventures with AI NPCs, dialogue, and branching paths

For the hosted Playground you do not install an editor. Repository contributors
can run the same surface locally. Use a current hardware-accelerated browser;
Chromium is recommended and is required for folder storage. The runtime prefers
WebGPU and retries through a WebGL compatibility backend when WebGPU
initialization fails.

Mobile authoring is supported in landscape only. Portrait mode intentionally
shows a rotate-device gate rather than a compressed editor. Phone QA starts at
an `844 × 390` CSS-pixel landscape viewport.

## Key Features

### Visual 3D Editor

Build scenes by dragging in objects, adjusting properties, and testing with one click. No command line required for basic creation.

![Editor viewport with a simple scene containing objects](images/editior%20viewport%20with%20objects.PNG)

### Behavior System

Attach gameplay logic to objects using **behaviors** — pre-built or custom scripts that control how objects act. Dozens of built-in behaviors handle common patterns like character movement, collectibles, triggers, spawning, AI NPCs, and more.

### Lambda System

For advanced creators, **lambdas** provide ECS-style batch processing across many objects. Use them when you need high-performance systems that update hundreds of objects per frame.

### Built-in Physics

Full physics simulation with two interchangeable engines: **Ammo.js** (Bullet Physics) and **Rapier3D**. Objects can collide, bounce, stack, and respond to forces out of the box. Pick the engine per project from Project Settings.

### Local Multiplayer Development

The repository includes an optional Colyseus sidecar for testing multiplayer
between local browser tabs. Hosted rooms, accounts, and collaboration are not
part of the deployed Playground.

### AI-Powered Creation

- **AI Copilot** — Describe what you want to build in natural language
- **AI NPCs** — Create characters that talk, listen, and respond with AI-generated dialogue and voice
- **3D Model Generation** — Generate 3D models from text descriptions
- **Image Generation** — Create textures, skyboxes, and images with AI

### Local-First Persistence

Projects auto-save to the active local project store. IndexedDB works without
folder permission. Chromium folder storage creates files you can inspect and
back up. Cloud sync and one-click publishing are not currently deployed.

## The Creation Workflow

Here is the typical flow for building a game in StemStudio:

```
1. SET UP THE SCENE
   Add objects from primitives, models, or the asset library

2. CONFIGURE OBJECTS
   Set physics, rendering, and visual properties

3. ADD GAMEPLAY LOGIC
   Attach behaviors for interactions, triggers, scoring

4. TEST
   Press Play to test your game in the editor

5. ITERATE
   Adjust, add more objects, refine behaviors

6. SAVE AND BACK UP
   Keep the project in IndexedDB or a selected local folder
```

You will spend most of your time in steps 2–5, cycling between configuring objects and testing gameplay.

## Who Is This For?

| If you are... | Start here |
|---------------|------------|
| **Brand new** to StemStudio | [Editor Tour](02-editor-tour.md) → [Your First Game](getting-started-tutorial.md) |
| **A creator** who wants to build without code | [Editor Tour](02-editor-tour.md) → [Built-in Behaviors](../scripting/05-built-in-behaviors.md) |
| **A technical creator** who wants to write scripts | [Behaviors vs Lambdas](../scripting/01-behaviors-vs-lambdas.md) → [Writing Behaviors](../scripting/02-writing-behaviors.md) |
| **Experienced** and want API reference | [Erth Interface](../apis/01-erth-interface.md) → [Built-in Events](../apis/02-eventbus.md) |

## What You Need

- **Browser:** a current hardware-accelerated browser (Chromium recommended)
- **RAM:** 4 GB minimum, 8 GB recommended
- **Graphics:** hardware acceleration; WebGPU preferred, WebGL compatibility fallback
- **Phone orientation:** landscape (`844 × 390` CSS pixels or larger)
- No StemStudio account
- No installation for the hosted Playground

## Next Steps

- Take the [Editor Tour](02-editor-tour.md) to learn where everything lives.
- Build your first playable game in 10 minutes with [Your First Game](getting-started-tutorial.md).
