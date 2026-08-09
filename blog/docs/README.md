---
title: StemStudio Documentation
slug: /
description: Learn how to build and test local 3D projects in the StemStudio Playground.
---

# StemStudio Documentation

StemStudio is a browser-based 3D editor and runtime. The current supported
workflow is the local-first **Playground**: create a project in the browser,
build a scene, add gameplay, press Play, and save it locally.

> **Current scope:** hosted accounts, cloud projects, public sharing,
> collaboration, one-click publishing, and remote scene loading are not
> deployed. Documentation that discusses those integration seams is explicitly
> marked as future or self-hosted work.
>
> Mobile editing is landscape-only. Portrait intentionally asks the creator to
> rotate the device.

## Pick Your Path

These docs are layered for two audiences. Each section's README points you to the right entry point for both.

- **Visual editor** — add objects, attach built-in behaviors, and test in play
  mode. Start with [Quickstart](/quickstart) → [Getting Started](getting-started/README.md).
- **JavaScript developer** — write custom behaviors, lambdas, and call runtime APIs. Start with [Behaviors vs Lambdas](scripting/01-behaviors-vs-lambdas.md) → [Erth Interface](apis/01-erth-interface.md).

## Quick Links

| Task | Go here |
|------|---------|
| Use the AI copilot | [AI Copilot](ai/01-ai-copilot.md) |
| Generate 3D models with AI | [AI Model Generation](ai/03-ai-model-generation.md) |
| Create AI NPCs | [AI NPCs](ai/02-ai-npcs.md) |
| Add sound effects | [Audio](gameplay/04-audio.md) |
| Use a built-in behavior | [Built-in Behaviors](scripting/05-built-in-behaviors.md) |
| Look up all events | [Built-in Events](apis/02-eventbus.md) |
| Work inside the unified script editor | [Code Editor Workflow](scripting/06-code-editor-workflow.md) |
| Make objects communicate | [Communication Patterns](scripting/04-communication-patterns.md) |
| Create or manage local projects | [Local Project Flow](getting-started/04-dashboard-and-projects.md) |
| Look up the full API | [Erth Interface](apis/01-erth-interface.md) |
| Follow the tutorial | [Getting Started Tutorial](getting-started/getting-started-tutorial.md) |
| Look up keyboard shortcuts | [Keyboard Shortcuts](editor/05-keyboard-shortcuts.md) |
| Add an object to my scene | [Left Panel](editor/01-left-panel.md) |
| Enable multiplayer | [Multiplayer Overview](multiplayer/01-multiplayer-overview.md) |
| Add particle effects | [Particles and VFX](gameplay/03-particles-vfx.md) |
| Set up physics | [Physics](gameplay/01-physics.md) |
| Look up all primitives | [Primitives Reference](assets/03-primitives-reference.md) |
| Move or self-host a project | [Saving and Sharing](shipping.md) |
| Configure an object | [Right Panel](editor/02-right-panel.md) |
| Review art asset guidelines | [Art Specs & Recommendations](assets/10-art-specs.md) |
| Build an outdoor world | [World Building and Environment](gameplay/07-world-building.md) |
| Add gameplay logic | [Writing Behaviors](scripting/02-writing-behaviors.md) |
| Fix a local editor problem | [Troubleshooting](troubleshooting.md) |

---

## Documentation Sections

### [Getting Started](getting-started/README.md)
Playground overview, editor walkthrough, first game tutorial, and local project
basics.

### [Editor](editor/README.md)
Left panel, right panel, toolbar, project settings, and keyboard shortcuts.

### [Assets](assets/README.md)
Asset library, importing, primitives reference, stems/prefabs, and materials.

### [Scripting](scripting/README.md)
Behaviors vs lambdas, writing custom scripts, the unified code editor workflow, communication patterns, and the built-in behavior reference.

### [APIs](apis/README.md)
Current `this.erth` runtime namespaces, built-in events, global store, GameManager, and GameObject API.

### [Gameplay](gameplay/README.md)
Physics, animation, particles/VFX, audio, HUD/UI, camera, and world-building workflows.

### [AI](ai/README.md)
AI copilot, AI NPCs, 3D model generation, and image generation.

### [Multiplayer](multiplayer/README.md)
Multiplayer mental model and writing multiplayer-safe code.

### [Saving and Sharing](shipping.md)
What is saved locally today, how folder projects work, and what is not yet a
supported export or publishing flow.

### [Troubleshooting](troubleshooting.md)
Playground storage, WebGPU, save, physics, asset, and AI checks.
