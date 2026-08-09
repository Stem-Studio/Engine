# buildwithstem.com — public site, playground, docs

> **Status: Superseded for the current release scope (2026-07-30).**
> This is a historical public-site/deployment plan. The active program targets
> local Playground persistence and play flows; remote scene/API mode is not
> deployed or a valid fallback. See the
> [planning index](./README.md) and
> [AAA Web Engine Quality Program](./2026-07-30-aaa-engine-quality-program.md).

## Goal

Ship a public marketing site for the StemStudio OSS engine at
`buildwithstem.com`, modeled on pixijs.com and babylonjs.com.

Surfaces:

- Landing page with hero, feature grid, code/scene sample, community/GitHub
  CTAs.
- `/playground` — loads the existing editor in a locked-down mode where only
  the dashboard, editor, AI copilot, and player are reachable. Settings,
  export, BYOK panel, multiplayer setup, and other surfaces are hidden.
- `/docs/*` — renders the markdown files already in `docs/` (architecture,
  byok, exporting-a-game, multiplayer) with a sidebar and content pane.
- GitHub repo link prominent in nav + footer.

Deployable as a static bundle to Cloudflare Pages / Vercel. No hosted
backend; the AI Go proxy stays user-run (existing BYOK flow).

## Assumptions / open questions

- Single deploy artifact: the new site bundle and the existing editor bundle
  build side-by-side from the same Vite config (multi-HTML-input) and ship as
  one static folder.
- Branding: site name is "StemStudio", domain is buildwithstem.com, repo URL
  is `https://github.com/stemstudio/stemstudio` (matches `package.json`
  `repository.url`). Confirm before launch.
- Docs surface = exactly the four files currently in `docs/` root
  (`architecture.md`, `byok.md`, `exporting-a-game.md`, `multiplayer.md`).
  Subsystem docs under `docs/behaviors/`, `docs/lambdas/`, etc. referenced
  in `CLAUDE.md` don't exist in this OSS export and are out of scope for
  v1. Open: do we want to also surface `README.md` and `CONTRIBUTING.md` as
  doc pages? Default: yes, as "Getting started" and "Contributing".
- Playground gating is **runtime**, not a build flag. The editor reads a
  `?mode=playground` URL param (or `pathname.startsWith('/playground')`)
  and hides non-allowed surfaces. This avoids forking the editor bundle.
- No new server dependencies. No analytics. No auth.

## Affected files

New:

- `client/packages/site/package.json`
- `client/packages/site/index.html`
- `client/packages/site/tsconfig.json`
- `client/packages/site/src/main.tsx`
- `client/packages/site/src/App.tsx`
- `client/packages/site/src/routes/Landing.tsx`
- `client/packages/site/src/routes/Playground.tsx`
- `client/packages/site/src/routes/Docs.tsx`
- `client/packages/site/src/routes/NotFound.tsx`
- `client/packages/site/src/components/Nav.tsx`
- `client/packages/site/src/components/Footer.tsx`
- `client/packages/site/src/components/Hero.tsx`
- `client/packages/site/src/components/FeatureGrid.tsx`
- `client/packages/site/src/components/CodeShowcase.tsx`
- `client/packages/site/src/components/MarkdownPage.tsx`
- `client/packages/site/src/content/features.ts`
- `client/packages/site/src/content/docs-nav.ts`
- `client/packages/site/src/styles/globals.css`
- `client/packages/site/public/_redirects` (Cloudflare Pages SPA fallback)
- `client/packages/site/public/favicon.svg` (copy existing)
- `docs/planning/2026-05-19-buildwithstem-public-site.md` (this file)
- `docs/site.md` (deploy + dev runbook)

Modified:

- `vite.config.ts` — add second HTML input
  (`client/packages/site/index.html`) and a route rewrite so `/`, `/docs/*`,
  `/playground` (when not loading the app shell) resolve to the site
  bundle, and `/app/*` continues to load the marketing/editor entry.
- `package.json` — add convenience scripts: `dev:site`, `build:site`.
- `client/packages/editor-oss/src/...` — runtime playground-mode gating.
  Exact files to be identified during step 4 below; expected suspects:
  the editor shell (header/menu rendering), the settings panel, the BYOK
  panel, the export menu, and the multiplayer panel. Each gets a single
  guard reading from a small `usePlaygroundMode()` hook.

## Implementation steps

### 1. Scaffold the site package

- [ ] Create `client/packages/site/` with `package.json`, `tsconfig.json`
  (extending root), `index.html`, `src/main.tsx`, `src/App.tsx`.
- [ ] Add `react-router` routes for `/`, `/playground`, `/docs`,
  `/docs/:slug`, `*` → NotFound.
- [ ] Confirm site bundle builds in isolation with
  `bunx vite build --config <inline>` before wiring into root config.

### 2. Wire site into root Vite config

- [ ] In `vite.config.ts`, switch `rollupOptions.input` from a single
  `main` entry to a map: `main: marketing/index.html`,
  `site: site/index.html`.
- [ ] Add the route rewriter (line ~132 area today): keep
  `packages/marketing/index.html` for `/app/*`, route `/`, `/docs/*`,
  `/playground` to `packages/site/index.html`.
- [ ] Verify `bun run dev` still serves the editor under `/app/` and the
  new site under `/`.

### 3. Landing page (pixi/babylon-style)

- [ ] `Hero.tsx` — name, tagline, two primary CTAs ("Open Playground",
  "Star on GitHub"), tertiary "Read the Docs". Background: simple Three.js
  scene (rotating geometry or animated shader) using the already-installed
  `three` dependency. Keep it under ~5 KB of code and dispose on unmount.
- [ ] `FeatureGrid.tsx` — six cards: Behaviors, Lambdas (ECS), Physics
  (Ammo/Rapier), AI Copilot (BYOK), Multiplayer (Colyseus), File-System
  persistence. Copy is short, links each to the relevant doc.
- [ ] `CodeShowcase.tsx` — static side-by-side panel: behavior snippet on
  the left, screenshot/iframe of resulting scene on the right. (v1: image;
  v2: live iframe to `/app/playground?example=...`.)
- [ ] `Footer.tsx` — repo link, license (MIT), security policy, code of
  conduct, contributing, third-party notices.

### 4. Playground mode

- [ ] Add `client/packages/editor-oss/src/playgroundMode.ts`:
  exports `isPlaygroundMode()` (URL param or path prefix) and
  `usePlaygroundMode()` hook backed by it.
- [ ] Audit editor shell for top-level menu/panel mount points. Tag each
  non-allowed surface (settings, BYOK, exports, MP setup, asset-store
  upload, …) with a `if (isPlaygroundMode()) return null;` guard. Allowed
  surfaces: dashboard, scene tree + viewport (editor), AI copilot panel,
  player toggle.
- [ ] Site's `Playground.tsx` renders an `<iframe src="/app/?mode=playground" />`
  filling the viewport with a thin top bar (logo, back-to-site, docs link).
  Set `allow="clipboard-read; clipboard-write"` and let WebGL/audio fall
  through.
- [ ] Sanity: visit `/playground` directly, confirm only the four allowed
  surfaces are reachable; visit `/app/` (no flag) and confirm full editor
  still works.

### 5. Docs

- [ ] Vite raw-import the four `docs/*.md` files at build time (using
  `vite-raw-plugin`, already installed).
- [ ] `MarkdownPage.tsx` renders via `marked` (already in deps) + a small
  syntax-highlight pass for fenced code blocks.
- [ ] `docs-nav.ts` defines sidebar structure:
  - Getting started (README.md)
  - Architecture (docs/architecture.md)
  - BYOK & AI providers (docs/byok.md)
  - Exporting a game (docs/exporting-a-game.md)
  - Multiplayer (docs/multiplayer.md)
  - Contributing (CONTRIBUTING.md)
- [ ] Internal links inside markdown that point to repo paths get rewritten
  to GitHub URLs when the target isn't part of the curated nav.

### 6. Cloudflare Pages deploy

- [ ] `_redirects`: `/app/* /app/index.html 200` and `/* /index.html 200`
  (site SPA fallback, app SPA fallback).
- [ ] `docs/site.md` runbook: build command (`bun run build`), output
  directory (`build/`), Pages project config, custom domain
  (`buildwithstem.com`) DNS record.
- [ ] Confirm `bun run build` emits both `index.html` (site) and
  `app/index.html` (editor) under `build/` with assets co-located. Adjust
  `scripts/copy.js` if needed.

## Validation

- [ ] `bun run typecheck` clean.
- [ ] `bun run lint` clean.
- [ ] `bun test` clean.
- [ ] `bun run vite-build` produces both entry bundles; check
  `build/index.html` and `build/app/index.html` exist.
- [ ] Run `bun run dev`, visit `http://localhost:5173/` — landing renders,
  hero loads, all nav links resolve.
- [ ] Visit `http://localhost:5173/playground` — editor loads inside the
  iframe with dashboard + AI copilot + editor + player only; settings,
  BYOK, exports, MP setup are not reachable.
- [ ] Visit `http://localhost:5173/app/` (no playground flag) — full editor
  still works (existing surfaces all present).
- [ ] Visit `http://localhost:5173/docs/architecture` — markdown renders,
  sidebar nav highlights the active page, code blocks formatted.
- [ ] Run the four existing OSS smokes
  (`oss-smoke`, `oss-filesystem-roundtrip`, `oss-open-folder-banner`,
  `oss-import-3dchess`); none should regress.
- [ ] Manual code review.

## Out of scope (later)

- Live multi-example playground (babylonjs's left-panel example picker).
- Search across docs.
- API reference auto-generation.
- Hosted AI proxy (requires keys/infra) — render.yaml has a commented
  block ready to enable.
- i18n.

## Follow-up: surface-by-surface playground gating

The playground-mode infrastructure (`shared/src/playgroundMode.ts` +
`playgroundMode.css`) is in place. Annotation of individual surfaces with
`data-playground-hide` (or `if (isPlaygroundMode()) return null;` guards)
is incremental and needs a dedicated audit pass:

- Settings panel + menu entry
- BYOK key-management panel
- Export/publish menu items
- Download/export icon styling in playground mode: the download icon currently
  renders with an unexpected background and needs a chrome/style audit.
- Multiplayer room setup
- Asset upload / library admin
- Account / login / signup surfaces (no-op in OSS but still mounted)

The OSS bootstrap modal is already covered (`data-oss-bootstrap-modal`).
