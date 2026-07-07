# Builder/CAD PR Creation Handoff

Prepared on 2026-07-07 after publishing the stacked review branches to
`origin`.

This environment can push branches over SSH, but it has no `gh`, no `hub`, no
GitHub API token, and git's HTTPS credential helper returned no GitHub API
credential. Use the commands below from an authenticated GitHub-capable
environment, or open the compare URLs in GitHub's UI.

## PR Order

1. DirectCopilot test baseline fix
2. Behavior pack refactors
3. Quick Build tools
4. Mesh CAD Action Bar
5. BIM Plan
6. Builder Studio docs, site, and misc wiring

## Commands

```bash
gh pr create \
  --repo Stem-Studio/Engine \
  --base main \
  --head builder-hardening/direct-copilot-test-fix \
  --title "Fix DirectCopilot test app stub" \
  --body "Isolates the pre-existing DirectCopilot test stub failure so the behavior-pack split can run full validation independently. Validation: typecheck, lint, test, and Vite build passed locally."

gh pr create \
  --repo Stem-Studio/Engine \
  --base builder-hardening/direct-copilot-test-fix \
  --head builder-hardening/behavior-packs-with-baseline \
  --title "Split behavior pack refactors" \
  --body "Splits behavior-pack refactors and tests away from Builder/CAD. Validation: targeted behavior tests plus typecheck, lint, test, and Vite build passed locally."

gh pr create \
  --repo Stem-Studio/Engine \
  --base builder-hardening/behavior-packs-with-baseline \
  --head builder-hardening/quick-build-stacked \
  --title "Add Quick Build tools" \
  --body "Adds Quick Build registry, placement, batching, texture pack support, docs, ActionBar Quick mode wiring, and Quick Build smokes. Validation: typecheck, lint, test, and Vite build passed locally."

gh pr create \
  --repo Stem-Studio/Engine \
  --base builder-hardening/quick-build-stacked \
  --head builder-hardening/mesh-cad-stacked \
  --title "Add Mesh CAD Action Bar workflow" \
  --body "Adds Mesh CAD action bar controls, editor guards, CAD icons, tests, and two-mode Quick/Mesh ActionBar wiring. Validation: targeted Mesh CAD tests plus typecheck, lint, test, and Vite build passed locally."

gh pr create \
  --repo Stem-Studio/Engine \
  --base builder-hardening/mesh-cad-stacked \
  --head builder-hardening/bim-plan-stacked \
  --title "Add BIM Plan mode" \
  --body "Adds Plan/CAD data model, generated geometry bridge, properties, import/export, docs, settings, ActionBar BIM mode wiring, and Plan CAD smoke. Validation: targeted BIM tests, typecheck, lint, test, Vite build, and test:e2e:plan-cad passed locally."

gh pr create \
  --repo Stem-Studio/Engine \
  --base builder-hardening/bim-plan-stacked \
  --head builder-hardening/docs-site-misc-stacked \
  --title "Add Builder Studio docs and release smokes" \
  --body "Adds Builder Studio documentation, site/playground polish, package-script aggregation, filesystem/site smokes, and builder-release smoke. Validation: typecheck, lint, test, Vite build, test:e2e, test:e2e:site, and test:e2e:builder-release passed locally."
```

## Compare URLs

- https://github.com/Stem-Studio/Engine/compare/main...builder-hardening/direct-copilot-test-fix
- https://github.com/Stem-Studio/Engine/compare/builder-hardening/direct-copilot-test-fix...builder-hardening/behavior-packs-with-baseline
- https://github.com/Stem-Studio/Engine/compare/builder-hardening/behavior-packs-with-baseline...builder-hardening/quick-build-stacked
- https://github.com/Stem-Studio/Engine/compare/builder-hardening/quick-build-stacked...builder-hardening/mesh-cad-stacked
- https://github.com/Stem-Studio/Engine/compare/builder-hardening/mesh-cad-stacked...builder-hardening/bim-plan-stacked
- https://github.com/Stem-Studio/Engine/compare/builder-hardening/bim-plan-stacked...builder-hardening/docs-site-misc-stacked
