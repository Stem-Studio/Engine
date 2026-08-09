#!/usr/bin/env bash
# Trigger a deploy of buildwithstem.com on Render.com.
#
# Render's primary deploy flow is git push: configure the workspace to
# watch the `main` branch via render.yaml and it builds automatically on
# every push. This script supports two manual flows on top of that:
#
#   1. Apply / re-apply the render.yaml blueprint
#   2. Trigger a fresh deploy of an existing service via the Render API
#
# Requires the Render CLI (`brew install render` / `render-oss/tap`) for
# the first flow, or RENDER_API_KEY + RENDER_SERVICE_ID env vars for the
# second.
#
# Usage:
#   ./scripts/deploy-render.sh apply            # apply render.yaml
#   ./scripts/deploy-render.sh deploy           # API-trigger a deploy
#   ./scripts/deploy-render.sh build            # local build sanity check

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

cmd="${1:-help}"

case "$cmd" in
    apply)
        if ! command -v render >/dev/null 2>&1; then
            echo "render CLI not found. Install it: https://render.com/docs/cli" >&2
            exit 1
        fi
        echo "[render] applying blueprint from render.yaml…"
        render blueprint apply
        ;;

    deploy)
        : "${RENDER_API_KEY:?RENDER_API_KEY must be set}"
        : "${RENDER_SERVICE_ID:?RENDER_SERVICE_ID must be set (find in the Render dashboard URL)}"
        echo "[render] triggering deploy for $RENDER_SERVICE_ID…"
        curl --fail --silent --show-error \
            -X POST \
            -H "Authorization: Bearer $RENDER_API_KEY" \
            -H "Content-Type: application/json" \
            "https://api.render.com/v1/services/$RENDER_SERVICE_ID/deploys" \
            -d '{"clearCache": "do_not_clear"}'
        echo
        echo "[render] deploy triggered. Watch progress at https://dashboard.render.com/static/$RENDER_SERVICE_ID"
        ;;

    build)
        echo "[render] running the same build command Render will run…"
        bun run build
        echo "[render] output ready at build/public (Render publishes from ./build/public)."
        ;;

    help|--help|-h|"")
        cat <<EOF
Usage: $0 <command>

Commands:
  apply    Apply render.yaml via the Render CLI (provisions / updates services)
  deploy   Trigger a fresh deploy via the Render API (needs RENDER_API_KEY + RENDER_SERVICE_ID)
  build    Run the production build locally to verify before pushing

For day-to-day deploys, just push to the branch Render is watching — the
render.yaml blueprint already wires the build + publish step.
EOF
        ;;

    *)
        echo "unknown command: $cmd" >&2
        echo "run '$0 help' for usage" >&2
        exit 2
        ;;
esac
