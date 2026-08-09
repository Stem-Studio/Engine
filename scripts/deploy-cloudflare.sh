#!/usr/bin/env bash
# Deploy buildwithstem.com to Cloudflare Pages.
#
# Requires:
#   - bun installed
#   - CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID exported (or
#     `wrangler login` once interactively)
#   - A Cloudflare Pages project named `buildwithstem` (or set
#     PAGES_PROJECT to match an existing project)
#
# Usage:
#   ./scripts/deploy-cloudflare.sh              # build + deploy
#   ./scripts/deploy-cloudflare.sh --skip-build # deploy pre-built output

set -euo pipefail

PAGES_PROJECT="${PAGES_PROJECT:-buildwithstem}"
BRANCH="${BRANCH:-main}"
SKIP_BUILD=0
for arg in "$@"; do
    case "$arg" in
        --skip-build) SKIP_BUILD=1 ;;
        *) echo "unknown arg: $arg" >&2; exit 2 ;;
    esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ "$SKIP_BUILD" -eq 0 ]]; then
    echo "[deploy] building production bundle…"
    bun run build
fi

if [[ ! -d build/public ]]; then
    echo "[deploy] build/public not found — did the build fail?" >&2
    exit 1
fi

echo "[deploy] publishing build/public to Cloudflare Pages project '$PAGES_PROJECT' (branch $BRANCH)…"
bunx wrangler pages deploy build/public \
    --project-name "$PAGES_PROJECT" \
    --branch "$BRANCH" \
    --commit-dirty=true

echo "[deploy] done."
echo "[deploy] custom domain (one-time): wrangler pages project domain add $PAGES_PROJECT buildwithstem.com"
