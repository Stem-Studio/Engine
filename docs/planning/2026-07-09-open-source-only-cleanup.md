# Open-source-only cleanup

## Goal

Make repository-facing metadata, docs, and comments describe StemStudio as the
open-source project, not as an OSS variant of a separate product.

## Assumptions

- Keep package/import names such as `@stem/editor-oss`, `IS_OSS`, and
  `bootstrap/integrated` for API and path compatibility.
- Do not remove runtime feature gates in this pass.
- Prefer wording that points to local-first, self-hosted, or optional provider
  behavior instead of edition terminology.

## Implementation

- [x] Update top-level package and contribution/security links.
- [x] Replace user-facing `OSS mode/build/playground` language in core docs.
- [x] Reword compatibility comments around historical names and boundary gates.
- [x] Run focused verification for metadata/docs-only changes.

## Validation

- [x] Search for remaining stale open-source edition wording.
- [x] Manual code review.

## Follow-ups

- [ ] Fix the playground download icon background so the icon does not show an
      unintended contrasting square behind it.
