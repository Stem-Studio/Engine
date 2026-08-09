---
title: Quickstart
slug: /quickstart
description: One-page jump-in for the local StemStudio Playground.
---

# Quickstart

StemStudio is a browser-based 3D editor. Open the local or hosted Playground
and start placing objects. Projects remain in that browser unless you selected
Chromium folder storage.

> The current focus is Playground mode. Remote API-backed projects, accounts,
> cloud collaboration, and one-click publishing are not deployed.
>
> On a phone, rotate to landscape before authoring. Portrait mode intentionally
> shows a rotate-device gate; the supported minimum QA viewport is `844 × 390`
> CSS pixels.

Pick the path that matches you:

## Path 1 — No-code creator

You want to drag objects in, attach built-in behaviors, and test a playable
scene. Start here:

1. [What is StemStudio?](getting-started/01-what-is-stemstudio.md) — what the Playground supports today.
2. [Editor Tour](getting-started/02-editor-tour.md) — the three panels you'll use every session.
3. [Getting Started Tutorial](getting-started/getting-started-tutorial.md) — build a playable scene in one sitting.
4. [Built-in Behaviors](scripting/05-built-in-behaviors.md) — character controllers, triggers, jump pads, AI NPCs — drag, configure, done.

## Path 2 — Developer

You're comfortable in JS and want to write custom behaviors, hook into the engine, and use the runtime APIs:

1. [Editor Tour](getting-started/02-editor-tour.md) — skim, then move on.
2. [Behaviors vs Lambdas](scripting/01-behaviors-vs-lambdas.md) — pick the right primitive.
3. [Writing Behaviors](scripting/02-writing-behaviors.md) — lifecycle, params, `this.erth.*`.
4. [Erth Interface](apis/01-erth-interface.md) — runtime API reference.
5. [Communication Patterns](scripting/04-communication-patterns.md) — EventBus, GameManager, GlobalStore.

## Saving or sharing your work

When you have something playable, read [Saving and Sharing](shipping.md).
A one-click hosted release, mobile package, and platform integrations are not
current Playground features.

## Want a full tour?

The full documentation index lives at the [Documentation home](README.md).
