# Planning and design index

This directory is a decision record, not a single live backlog. Start here
instead of treating every dated document as current direction.

## Current release scope

The active target is the **local Playground mode**. Scene creation, loading,
saving, Play, and return-to-Edit must work through local persistence. Remote
scene/API mode is not deployed, is not an acceptance path, and must not be used
as a fallback while optimizing Playground.

Calls to optional third-party asset or AI providers are a separate concern:
they do not make remote scene loading part of the release scope.

The supported physics backends are **Ammo and Rapier only**. Historical
references to Jolt, PhysX, or broader backend matrices do not describe the
current product.

## Record conventions

New records should begin with these fields:

```text
Status: Current | In progress | Superseded | Historical
Date: YYYY-MM-DD
Owner: person, team, or Unassigned
Superseded by: relative link (required when Status is Superseded)
Last verified: YYYY-MM-DD (required for claims about current code)
```

- **Current** is an authoritative direction or inventory.
- **In progress** is an active, incomplete workstream. Open checkboxes alone do
  not prove that an old record remains active.
- **Superseded** preserves an earlier decision while pointing to the replacement.
- **Historical** records completed work, investigations, handoffs, or proposals
  that are not an active commitment.
- Owners are responsible for keeping current-state claims and links verified.
  Use `Unassigned`; do not guess an owner.
- Add a status banner instead of rewriting historical observations in place.

## Current

| Record | Status | Owner | Use |
| --- | --- | --- | --- |
| [AAA Web Engine Quality Program](./2026-07-30-aaa-engine-quality-program.md) | Current | Unassigned | Playground-only quality gates and execution order. |
| [Physics engine cut inventory](./2026-07-30-physics-engine-cut-inventory.md) | Current | Unassigned | Ammo/Rapier retention and the evidence-based physics cut list. |

## In progress

These records still describe relevant Playground work, but their old evidence
must be revalidated before implementation resumes.

| Record | Status | Owner | Remaining concern |
| --- | --- | --- | --- |
| [Import asset dedup and localStorage hygiene](./2026-06-01-import-dedup-and-localstorage-hygiene.md) | In progress; needs revalidation | Unassigned | Import size, scene-local persistence, and open validation. |

## Superseded

| Record | Status | Superseded by / reason |
| --- | --- | --- |
| [Public site, Playground, and docs plan](./2026-05-19-buildwithstem-public-site.md) | Superseded for current release scope | [AAA quality program](./2026-07-30-aaa-engine-quality-program.md); remote/public deployment is deferred while local Playground is optimized. |
| [GitHub CI and Pages deploy](./2026-05-19-github-ci-and-pages.md) | Superseded for current release scope | [AAA quality program](./2026-07-30-aaa-engine-quality-program.md); useful infrastructure history, not a deployed-scene QA path. |
| [Builder and CAD follow-ups](./2026-06-28-builder-and-cad-mode-followups.md) | Superseded | [Builder/CAD production hardening](./2026-07-06-builder-cad-production-hardening.md). |
| [Three.js latest migration audit](./2026-07-11-threejs-latest-migration-audit.md) | Superseded as a current-state source | Its “latest” claim is date-bound, and its Jolt references predate the [Ammo/Rapier-only cut](./2026-07-30-physics-engine-cut-inventory.md). Retain it as audit evidence. |

## Historical

| Record | Kind |
| --- | --- |
| [ESLint warning cleanup](./2026-05-19-eslint-warning-cleanup.md) | Completed cleanup record. |
| [Browser-direct model generation](./2026-05-20-playground-direct-model-generation.md) | Provider/CORS implementation note; not remote scene architecture. |
| [Playground mode and Copilot keys](./2026-05-20-playground-mode-and-copilot-keys.md) | Implementation record with manual checks left open. |
| [Playground account and import fixes](./2026-05-22-playground-account-and-import-fixes.md) | Completed fixes and residual validation. |
| [Behavior dedup and edit persistence](./2026-05-30-oss-behavior-dedup-and-edit-persist.md) | Investigation and implementation record. |
| [GLB import re-export skip](./2026-05-30-oss-glb-import-skip-reexport.md) | Import performance investigation. |
| [Model import ZIP assumption](./2026-05-31-oss-model-import-zip-assumption.md) | Completed regression fix record. |
| [No masking fallbacks](./2026-06-01-no-masking-fallbacks-playground.md) | Playground reliability investigation. |
| [Copilot inspection allowlist](./2026-06-02-copilot-inspection-allowlist.md) | Completed implementation record. |
| [Asset and editor-tree dedup](./2026-06-03-asset-and-editor-tree-dedup.md) | Completed cleanup with validation debt recorded. |
| [Viewport safe-area API](./2026-06-03-viewport-safe-area.md) | Completed API record. |
| [Rodin provider proposal](./2026-06-16-rodin-asset-generation-provider.md) | Unverified provider proposal; not an active release commitment. |
| [TinySkies Playground port](./2026-06-19-tinyskies-playground-port.md) | Historical and superseded for release gating. Current local Playground Play/refresh evidence is recorded in [startup performance](../../.omo/evidence/threejs-startup-performance-2026-08-02.md), the [current gate review](../../.omo/evidence/tinyskies-current-gate-review-2026-08-02.md), and the [AAA evidence inventory](../../.omo/evidence/aaa-current-evidence-inventory-2026-08-02.md); standalone `/play/<id>` remains deferred. |
| [Builder/CAD production hardening](./2026-07-06-builder-cad-production-hardening.md) | Completed productization and validation record. |
| [Builder/CAD PR creation handoff](./2026-07-07-builder-cad-pr-create-handoff.md) | Operational handoff. |
| [Builder/CAD PR split manifest](./2026-07-07-builder-cad-pr-split-manifest.md) | Operational manifest; patch artifacts live in `pr-split-patches/`. |
| [Open-source-only cleanup](./2026-07-09-open-source-only-cleanup.md) | Completed cleanup with one visual follow-up. |

Historical records may contain stale paths, benchmark numbers, dependency
versions, or deployment assumptions. Verify those claims against the current
tree before using them to authorize work.
