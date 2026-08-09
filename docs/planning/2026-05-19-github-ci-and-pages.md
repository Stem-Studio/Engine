# GitHub CI + GitHub Pages deploy

> **Status: Superseded for the current release scope (2026-07-30).**
> Preserve this as deployment-infrastructure history. GitHub Pages and remote
> scene loading are not acceptance paths for the active local Playground
> optimization program. See the
> [planning index](./README.md) and
> [AAA Web Engine Quality Program](./2026-07-30-aaa-engine-quality-program.md).

## Goal

1. A CI pipeline that runs the project's tests on GitHub — on every pull
   request and when a branch is merged to `main`.
2. Deploy the static build to GitHub Pages, serving the public site at
   the custom domain `buildwithstem.com`.

## Assumptions / decisions

- GitHub repo is `Stem-Studio/Engine`.
- Pages serves at the custom domain `buildwithstem.com`, so the Vite
  `base` stays `/` — no router/basename changes, editor + player bundles
  are unaffected. (Confirmed with the user. Note: this means
  `buildwithstem.com` DNS must point at GitHub Pages, not Cloudflare.)
- The build emits four SPA shells into `build/public/`
  (`index.html`, `shell.html`, `editor.html`, `play.html`) plus
  `_redirects`. GitHub Pages cannot honour `_redirects`; it only has a
  global `404.html` fallback. We add a smart `404.html` that classifies
  the path (mirroring `_redirects`) and renders the correct shell while
  keeping the URL.
- CI runs typecheck + lint + unit tests + the static routing smoke.
  Browser e2e smokes need a dev server and are left out of CI to keep it
  fast and deterministic.
- The Go AI server and Colyseus multiplayer are not part of a static
  Pages deploy. The editor still loads; the Copilot panel hides itself
  with no provider. This matches the "basic" stack.

## Affected files

- `.github/workflows/ci.yml` — new: PR + push-to-main test pipeline.
- `.github/workflows/pages.yml` — new: build + deploy to GitHub Pages.
- `client/public/404.html` — new: multi-SPA fallback router (copied
  verbatim into `build/public/` by Vite's `publicDir`).
- `client/public/CNAME` — new: `buildwithstem.com` (copied into build).
- `package.json` — fix `homepage` / `repository` / `bugs` URLs to
  `Stem-Studio/Engine`.
- `docs/site.md` — document the GitHub Pages deploy path.

## Implementation steps

- [x] Add `client/public/CNAME` with `buildwithstem.com`.
- [x] Add `client/public/404.html` — path-classifying SPA router.
- [x] Add `.github/workflows/ci.yml` (typecheck, lint, test, routing smoke).
- [x] Add `.github/workflows/pages.yml` (build, upload, deploy-pages).
- [x] Update repo URLs in `package.json`.
- [x] Document the GitHub Pages deploy in `docs/site.md`.

## Validation steps

- [x] Manual code review.
- [ ] CI workflow runs green on a PR (verified after push to GitHub).
- [ ] Pages workflow builds and publishes; `buildwithstem.com` resolves
      to the GitHub Pages deploy.
- [ ] Deep links work via `404.html`: `/docs/byok`, `/playground`,
      `/dashboard` each render the right shell with the URL preserved.

## Manual GitHub setup (one-time, outside the repo)

- Repo Settings → Pages → Source = "GitHub Actions".
- Repo Settings → Pages → Custom domain = `buildwithstem.com`, and point
  the domain's DNS at GitHub Pages.
