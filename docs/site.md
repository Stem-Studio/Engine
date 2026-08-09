# buildwithstem.com — site, playground, docs, deploy

This document is the runbook for the public StemStudio site that ships
from this repository. The site lives in `client/packages/site/` and is
built as a sibling Vite entry alongside the existing editor / player /
app-shell bundles.

> **Deployment boundary:** the current target is the local-first Playground.
> The static build contains remote-oriented routes and adapters, but the
> scene/asset API mode is not deployed. A successful static deployment does
> not make `/play/:projectID`, accounts, publishing, or cloud projects
> functional.

## URL surface

| URL pattern                | Served by             | Notes                                   |
|----------------------------|-----------------------|-----------------------------------------|
| `/`                        | `site/index.html`     | Landing page                            |
| `/docs`, `/docs/:slug`     | `site/index.html`     | Markdown docs SPA                       |
| `/playground`              | `site/index.html`     | Iframe wrapper                          |
| `/dashboard`               | `marketing` (shell)   | Project list, local storage bootstrap   |
| `/create/project[/*]`      | `editor/editor.html`  | Full editor                             |
| `/stem-editor/*`           | `editor/editor.html`  | Asset-scoped editor view                |
| `/play/:projectID`         | `play/play.html`      | API-backed player route; remote data mode is not deployed |

In dev (`bun run dev`), the Vite middleware in `vite.config.ts` routes
each URL prefix to the matching `packages/*/index.html`. In production,
the same routing is encoded in `client/public/_redirects` (Cloudflare
Pages, Netlify, Render Static) and `render.yaml` (Render-native routes).

## Playground mode

The `/playground` route renders an iframe pointed at the standalone app shell
`/shell.html?mode=playground` (with `/dashboard/index.html?mode=playground` as a
static-host fallback). The editor reads that query param via
`@web-shared/playgroundMode`, persists it to sessionStorage, and tags
`<html data-playground-mode="true">` before React renders.

Components that should be hidden in playground mode either:

- return `null` when `isPlaygroundMode()` is true, or
- add `data-playground-hide` to their root element (CSS rule in
  `client/packages/shared/src/playgroundMode.css` does the rest).

The local storage bootstrap modal is hidden automatically (it is tagged
`data-oss-bootstrap-modal` for compatibility). Playground mode intentionally
hides remote-only account, publishing, collaboration, multiplayer setup,
upload, and admin surfaces. Local JSON scene/source and STL geometry exports
may remain available; they are not publishing. Treat any exposed remote-only
control as a bug rather than as a usable feature.

## Local development

```bash
# All services (vite + Go AI server + Colyseus)
bun run dev

# Vite only — fastest for site work
bun run dev:editor
```

Then visit:

- http://localhost:5173/ — landing
- http://localhost:5173/docs — docs
- http://localhost:5173/playground — playground iframe
- http://localhost:5173/dashboard — app shell

## Build

```bash
bun run build
```

Outputs to `build/public/`:

```
build/public/
  index.html        ← site (landing + docs + /playground wrapper)
  shell.html        ← marketing / app shell (dashboard, project list)
  editor.html       ← editor runtime
  play.html         ← player runtime
  _redirects        ← static-host routing rules
  assets/           ← hashed JS/CSS/imagery
```

## Deploy

### Cloudflare Pages

1. Create a Pages project named `buildwithstem` (or set `PAGES_PROJECT=<name>`
   when running the script).
2. Either:
   - **Git-based** — point the Pages project at the GitHub repo, set the
     build command to `bun run build`, and the output
     directory to `build/public`. Cloudflare reads `wrangler.toml`
     automatically.
   - **CLI-based** — `bun run deploy:cloudflare` runs the build and
     publishes via `wrangler pages deploy build/public`. Requires
     `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (or
     `wrangler login` once).
3. Add the `buildwithstem.com` custom domain in the Pages dashboard, or:

   ```bash
   bunx wrangler pages project domain add buildwithstem buildwithstem.com
   ```

### GitHub Pages

GitHub Actions builds and publishes the site on every push to `main`
via `.github/workflows/pages.yml`. No CLI step is needed.

1. Repo Settings → Pages → **Source = "GitHub Actions"**.
2. Repo Settings → Pages → **Custom domain = `buildwithstem.com`**, then
   point the domain's DNS at GitHub Pages. (Only one host can own the
   domain — GitHub Pages or Cloudflare, not both.)
3. Push to `main`. The workflow runs `bun run build` and
   deploys `build/public`.

Static-host routing on GitHub Pages differs from Cloudflare/Render:
GitHub Pages ignores `_redirects` and only supports a single global
`404.html`. `client/public/404.html` is a small SPA router that
classifies the path (mirroring `_redirects`), fetches the matching shell
(`index.html` / `shell.html` / `editor.html` / `play.html`), and renders
it with the URL preserved. `client/public/CNAME` carries the custom
domain into the build. Both files are copied verbatim by Vite's
`publicDir` and are inert on Cloudflare/Render (the `_redirects`
catch-all means `404.html` never fires there). The build also emits
`playground/index.html` and `dashboard/index.html` as direct-entry fallbacks
for hosts that support directory indexes.

Tests run on every pull request and on merge to `main` via
`.github/workflows/ci.yml` (typecheck, lint, unit tests, and the
`site-deploy-routing` smoke).

### Render.com

1. Apply the blueprint:

   ```bash
   bun run deploy:render apply
   ```

   This provisions the `buildwithstem-site` static service from
   `render.yaml`. Subsequent pushes to `main` auto-deploy.
2. To force a redeploy of an already-provisioned service:

   ```bash
   RENDER_API_KEY=… RENDER_SERVICE_ID=… bun run deploy:render deploy
   ```
3. To dry-run the same build Render will run:

   ```bash
   bun run deploy:render build
   ```

The Go AI proxy (`server/cmd/ai-server`) is *not* deployed by default.
A commented service block in `render.yaml` enables it when you want a
hosted AI endpoint — it still requires BYOK keys at runtime.

### Local Docker

Two compose files mirror the two prod shapes — what visitors actually
hit on Cloudflare/Render vs. what you get with the AI + multiplayer
sidecars wired up. The nginx routing inside the container is a
hand-translation of `_redirects` (see `docker/nginx.basic.conf` and
`docker/nginx.full.conf`), so the local test exercises the same routing
contract the static host will.

**Basic** (site + editor + player, no copilot):

```bash
bun run deploy:local
# equivalent: docker compose up --build -d
```

Visit http://localhost:8080. The Copilot panel hides itself because no
AI provider is registered. Closest local reproduction of a Cloudflare
Pages / Render Static deploy.

**Full** (adds copilot AI server + Colyseus multiplayer):

```bash
bun run deploy:local:full
# equivalent: docker compose -f docker-compose.full.yml up --build -d
```

AI requests from the editor flow `editor → /api/* → nginx → ai-server
(Go)`. Multiplayer rooms flow `editor → /colyseus/* → nginx → mp-server
(Colyseus)`. For the AI proxy to call real providers it needs BYOK keys
— either export them in your shell or drop them in a `.env` file next
to the compose file:

```bash
ANTHROPIC_API_KEY=sk-…
OPENAI_API_KEY=sk-…
# MESHY_API_KEY, ELEVENLABS_API_KEY, ANYTHING_WORLD_API_KEY also picked up
```

**Tear down** either stack:

```bash
bun run deploy:local:down
```

**Run the site Playwright smokes against the Docker container:**

```bash
PLAYWRIGHT_BASE_URL=http://localhost:8080 bun run test:e2e:site
```

The `site-deploy-routing.mjs` smoke is static and runs regardless of
which stack is up; the four browser-based smokes hit the live container.

## Verification

All site-level checks:

```bash
bun run test:e2e:site
```

Individually (each takes a few seconds, except `site-playground.mjs`
which mounts the editor and runs longer):

```bash
node scripts/playwright/site-deploy-routing.mjs   # static — no server needed
node scripts/playwright/site-landing.mjs          # needs dev server
node scripts/playwright/site-docs.mjs
node scripts/playwright/site-nav.mjs
node scripts/playwright/site-playground.mjs
```

The deploy-routing smoke is a pure-text check against
`client/public/_redirects` — wire it into CI before pushing the site so
typos in the redirect file don't reach prod.

## Files of interest

- `client/packages/site/` — landing, docs, playground React SPA
- `client/packages/site/src/content/docs-nav.ts` — curated docs sidebar
- `client/packages/site/src/components/MarkdownPage.tsx` — markdown
  loader (raw-imports `docs/*.md`, `README.md`, `CONTRIBUTING.md`)
- `client/packages/shared/src/playgroundMode.ts` — playground-mode flag
- `client/packages/shared/src/playgroundMode.css` — CSS gating rules
- `client/public/_redirects` — static-host routing
- `vite.config.ts` — multi-HTML inputs + dev URL rewriter
- `wrangler.toml`, `scripts/deploy-cloudflare.sh` — Cloudflare deploy
- `render.yaml`, `scripts/deploy-render.sh` — Render deploy
- `scripts/playwright/site-*.mjs` — site smokes
