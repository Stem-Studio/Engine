#!/bin/bash
set -e

# Build ammo.js WASM with growable memory (64MB initial → 256MB max).
#
# Prerequisites:
#   - Docker installed (uses the Dockerfile from the ammo.js fork)
#   OR
#   - emscripten SDK installed and activated (source emsdk_env.sh)
#   - cmake installed
#   - python3 installed
#
# Usage:
#   ./build.sh              # Build release
#   ./build.sh --install    # Build + install both checked-in Ammo asset copies

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$SCRIPT_DIR/ammo.js"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
INSTALL_FLAG=false

for arg in "$@"; do
    case "$arg" in
        --install) INSTALL_FLAG=true ;;
    esac
done

# ---------- Clone / update repo ----------
if [ ! -d "$REPO_DIR" ]; then
    echo "==> Cloning dotErth/ammo.js..."
    git clone --depth 1 https://github.com/dotErth/ammo.js.git "$REPO_DIR"
else
    echo "==> ammo.js already cloned, pulling latest..."
    git -C "$REPO_DIR" pull --ff-only || true
fi

# The fork keeps Bullet as a submodule; initialize it for fresh checkouts.
git -C "$REPO_DIR" submodule update --init --depth 1

# Apply the growable-memory/ESM build patch to a fresh clone. The current
# checkout may already contain it, so make this idempotent.
if ! grep -q 'MAXIMUM_MEMORY' "$REPO_DIR/CMakeLists.txt"; then
    python3 - "$REPO_DIR/CMakeLists.txt" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
text = text.replace(
    'set(ALLOW_MEMORY_GROWTH 0 CACHE STRING "Allow Memory Growth")\n',
    'set(ALLOW_MEMORY_GROWTH 0 CACHE STRING "Allow Memory Growth")\n\n'
    '# Maximum heap when memory growth is enabled.\n'
    'set(MAXIMUM_MEMORY 268435456 CACHE STRING "Maximum Memory")\n',
    1,
)
text = text.replace('  -s NO_FILESYSTEM=1\n', '  -s NO_FILESYSTEM=1\n  -s EXPORT_ES6=1\n', 1)
text = text.replace(
    '  -s TOTAL_MEMORY=${TOTAL_MEMORY})\n\nif(${CLOSURE})',
    '  -s TOTAL_MEMORY=${TOTAL_MEMORY})\n\n'
    'if(${ALLOW_MEMORY_GROWTH})\n'
    '  LIST(APPEND EMCC_ARGS\n'
    '    -s MAXIMUM_MEMORY=${MAXIMUM_MEMORY})\n'
    'endif()\n\nif(${CLOSURE})',
    1,
)
text = text.replace(
    'else()\n  LIST(APPEND EMCC_ARGS\n    -s NO_DYNAMIC_EXECUTION=1)\n',
    '',
    1,
)
path.write_text(text)
PY
fi

cd "$REPO_DIR"

# ---------- Custom memory flags ----------
# The upstream build uses 64MB fixed (non-growable).
# We override to: 64MB initial, growable up to 256MB.
EXTRA_LINK_FLAGS="-s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=67108864 -s MAXIMUM_MEMORY=268435456"

echo "==> Building ammo.js with growable memory (64MB initial, 256MB max)..."
echo "    Extra linker flags: $EXTRA_LINK_FLAGS"

# ---------- Build with Docker (preferred) ----------
if command -v docker &>/dev/null; then
    echo "==> Using Docker build..."
    # The dotErth/ammo.js fork has a Dockerfile for building.
    # We inject extra linker flags via environment variable.
    docker build -t ammo-builder .
    docker run --rm \
        -e EXTRA_LINK_FLAGS="$EXTRA_LINK_FLAGS" \
        -v "$REPO_DIR/builds:/src/builds" \
        -v "$REPO_DIR:/code" \
        ammo-builder \
        bash -c 'cd /code && rm -f builds/ammo.* && cmake -B builds -DCLOSURE=0 -DALLOW_MEMORY_GROWTH=1 -DTOTAL_MEMORY=67108864 -DMAXIMUM_MEMORY=268435456 && cmake --build builds --target ammo-wasm -j2'
else
    echo "==> Docker not found, using local emscripten..."
    echo "    Make sure you have run: source ~/emsdk/emsdk_env.sh"
    cmake -B builds -DCLOSURE=0 -DALLOW_MEMORY_GROWTH=1 -DTOTAL_MEMORY=67108864 -DMAXIMUM_MEMORY=268435456
    cmake --build builds --target ammo-wasm -j2
fi

echo ""
echo "==> Build complete. Output in: $REPO_DIR/builds/"
ls -lh "$REPO_DIR/builds/ammo.wasm."* 2>/dev/null || true

# ---------- Install into client/assets/js/ammo/ ----------
if [ "$INSTALL_FLAG" = true ]; then
    DEST="$PROJECT_ROOT/client/assets/js/ammo"
    PACKAGE_DEST="$PROJECT_ROOT/client/packages/editor-oss/assets/js/ammo"
    echo ""
    echo "==> Installing into $DEST ..."

    cp "$REPO_DIR/builds/ammo.wasm.js" "$DEST/ammo.wasm.js"
    cp "$REPO_DIR/builds/ammo.wasm.wasm" "$DEST/ammo.wasm.wasm"
    cp "$REPO_DIR/builds/ammo.wasm.js" "$PACKAGE_DEST/ammo.wasm.js"
    cp "$REPO_DIR/builds/ammo.wasm.wasm" "$PACKAGE_DEST/ammo.wasm.wasm"

    # Apply ESM export patch
    echo "==> Applying ESM export patch to ammo.wasm.js..."
    # Comment out Emscripten's global assignment so strict ESM imports are safe.
    sed -i.bak -E 's/(this\.Ammo|this\["Ammo"\])=[^;]+;/\/\* & *\//' "$DEST/ammo.wasm.js"
    sed -i.bak -E 's/(this\.Ammo|this\["Ammo"\])=[^;]+;/\/\* & *\//' "$PACKAGE_DEST/ammo.wasm.js"
    if ! grep -q 'export default Ammo;' "$DEST/ammo.wasm.js"; then
        echo 'export default Ammo;' >> "$DEST/ammo.wasm.js"
    fi
    if ! grep -q 'export default Ammo;' "$PACKAGE_DEST/ammo.wasm.js"; then
        echo 'export default Ammo;' >> "$PACKAGE_DEST/ammo.wasm.js"
    fi
    rm -f "$DEST/ammo.wasm.js.bak"
    rm -f "$PACKAGE_DEST/ammo.wasm.js.bak"

    # Copy types if available
    if [ -f "$REPO_DIR/builds/ammo.wasm.d.ts" ]; then
        cp "$REPO_DIR/builds/ammo.wasm.d.ts" "$PROJECT_ROOT/client/src/types/ammo.wasm.d.ts"
        echo "==> Copied type definitions to client/src/types/ammo.wasm.d.ts"
    fi

    echo "==> Done. Restart your dev server to pick up the new WASM."
fi
