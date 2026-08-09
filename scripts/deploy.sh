#!/usr/bin/env bash
# Unified deploy entry point for buildwithstem.com.
#
# Pipeline:
#   1. Sanity-check the redirect rules (catches the "static host routes
#      the wrong page" class of bug before it hits prod).
#   2. Run the production build.
#   3. Hand off to one or more deploy backends.
#
# Targets:
#   cloudflare   Cloudflare Pages via wrangler (default for remote)
#   render       Render.com (blueprint apply OR API deploy)
#   all          Both cloudflare + render, sequentially
#   local-basic  docker compose up (site + editor + player, no copilot)
#   local-full   docker compose up (site + editor + player + copilot + mp)
#   down         Tear down the local stack
#
# Usage:
#   bun run deploy                       # cloudflare
#   bun run deploy -- render             # render only
#   bun run deploy -- all                # cloudflare + render
#   bun run deploy -- local-basic        # docker compose, no AI
#   bun run deploy -- local-full         # docker compose, with AI + MP
#   bun run deploy -- down               # stop local stack
#   bun run deploy -- cloudflare --skip-build
#
# Env:
#   SKIP_BUILD=1            skip step 2 (remote targets only)
#   SKIP_ROUTING_CHECK=1    skip step 1
#   PAGES_PROJECT           Cloudflare Pages project name (default: buildwithstem)
#   RENDER_MODE             apply | deploy (default: apply)
#   COMPOSE_DETACH=0        run docker compose up in the foreground (default: detached)
#   NO_BUILD=1              docker compose up without --build

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

target="${1:-cloudflare}"
shift || true

extra_args=("$@")

print_header() {
    printf '\n\033[1;36m▶ %s\033[0m\n' "$1"
}

run_routing_check() {
    if [[ "${SKIP_ROUTING_CHECK:-0}" == "1" ]]; then
        echo "[deploy] SKIP_ROUTING_CHECK=1 — skipping _redirects validation"
        return
    fi
    print_header "1/3 Validating _redirects routing rules"
    node scripts/playwright/site-deploy-routing.mjs
}

run_build() {
    if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
        echo "[deploy] SKIP_BUILD=1 — skipping build"
        return
    fi
    print_header "2/3 Building (bun run build)"
    bun run build
    if [[ ! -d build/public ]]; then
        echo "[deploy] build/public is missing — build failed" >&2
        exit 1
    fi
    # Verify the four shell HTMLs all landed.
    for shell in index.html shell.html editor.html play.html; do
        if [[ ! -f "build/public/$shell" ]]; then
            echo "[deploy] build/public/$shell missing — vite multi-input build is broken" >&2
            exit 1
        fi
    done
    # GitHub Pages does not honour _redirects, so the public Playground and
    # its embedded dashboard also need real directory indexes.
    for route_index in playground/index.html dashboard/index.html; do
        if [[ ! -f "build/public/$route_index" ]]; then
            echo "[deploy] build/public/$route_index missing — deep-link route entrypoint was not emitted" >&2
            exit 1
        fi
    done
    if [[ ! -f build/public/_redirects ]]; then
        echo "[deploy] build/public/_redirects missing — Vite did not copy client/public/_redirects" >&2
        exit 1
    fi
    echo "[deploy] build OK — $(du -sh build/public | awk '{print $1}') in build/public/"
}

deploy_cloudflare() {
    print_header "3/3 Deploying to Cloudflare Pages"
    SKIP_BUILD=1 ./scripts/deploy-cloudflare.sh --skip-build "${extra_args[@]+"${extra_args[@]}"}"
}

deploy_render() {
    print_header "3/3 Deploying to Render"
    local mode="${RENDER_MODE:-apply}"
    ./scripts/deploy-render.sh "$mode"
}

resolve_compose_cmd() {
    if docker compose version >/dev/null 2>&1; then
        echo "docker compose"
    elif command -v docker-compose >/dev/null 2>&1; then
        echo "docker-compose"
    else
        echo "[deploy] docker compose not found. Install Docker Desktop or the compose plugin." >&2
        exit 1
    fi
}

deploy_local() {
    local compose_file="$1"
    local label="$2"

    if [[ ! -f "$compose_file" ]]; then
        echo "[deploy] $compose_file not found" >&2
        exit 1
    fi

    local compose_cmd
    compose_cmd="$(resolve_compose_cmd)"

    print_header "Bringing up $label ($compose_file)"

    # Image is built inside the container — skip the host-side bun build.
    SKIP_BUILD=1 run_routing_check

    local up_flags=()
    [[ "${NO_BUILD:-0}" == "1" ]] || up_flags+=("--build")
    [[ "${COMPOSE_DETACH:-1}" == "0" ]] || up_flags+=("-d")

    # shellcheck disable=SC2086  # word-splitting of compose_cmd is intentional
    $compose_cmd -f "$compose_file" up "${up_flags[@]}"

    if [[ "${COMPOSE_DETACH:-1}" == "1" ]]; then
        echo
        echo "[deploy] $label is up."
        echo "    site:        http://localhost:8080"
        echo "    landing:     http://localhost:8080/"
        echo "    docs:        http://localhost:8080/docs"
        echo "    playground:  http://localhost:8080/playground"
        echo "    dashboard:   http://localhost:8080/dashboard"
        if [[ "$compose_file" == *full* ]]; then
            echo "    ai server:   http://localhost:8081 (proxied via /api)"
            echo "    multiplayer: http://localhost:2567 (proxied via /colyseus)"
        fi
        echo
        echo "    logs:        $compose_cmd -f $compose_file logs -f"
        echo "    tear down:   bun run deploy -- down"
    fi
}

deploy_local_down() {
    local compose_cmd
    compose_cmd="$(resolve_compose_cmd)"
    print_header "Tearing down local stack"
    for cf in docker-compose.full.yml docker-compose.yml; do
        if [[ -f "$cf" ]]; then
            # shellcheck disable=SC2086
            $compose_cmd -f "$cf" down --remove-orphans || true
        fi
    done
}

case "$target" in
    cloudflare)
        run_routing_check
        run_build
        deploy_cloudflare
        ;;
    render)
        run_routing_check
        run_build
        deploy_render
        ;;
    all)
        run_routing_check
        run_build
        deploy_cloudflare
        deploy_render
        ;;
    local-basic|basic|local)
        deploy_local docker-compose.yml "buildwithstem (basic: site + editor + player)"
        ;;
    local-full|full)
        deploy_local docker-compose.full.yml "buildwithstem (full: site + editor + player + copilot + multiplayer)"
        ;;
    down|stop)
        deploy_local_down
        ;;
    -h|--help|help)
        sed -n '2,40p' "$0"
        exit 0
        ;;
    *)
        echo "unknown target: $target" >&2
        echo "valid targets: cloudflare, render, all, local-basic, local-full, down" >&2
        exit 2
        ;;
esac

print_header "Done"
echo "buildwithstem.com deploy complete ($target)."
