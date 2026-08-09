# Custom Ammo.js WASM Build

Builds `ammo.js` with **growable WASM memory** (64MB initial → 256MB max).

The checked-in assets in `client/assets/js/ammo/` and
`client/packages/editor-oss/assets/js/ammo/` use the growable build. This avoids
fixed-heap exhaustion during complex Playground physics scenes.

## Source

Built from the [dotErth/ammo.js](https://github.com/dotErth/ammo.js) fork (a fork of
[i12345/ammo.js](https://github.com/i12345/ammo.js)).

## Prerequisites

**Option A: Docker** (preferred)

```bash
docker --version  # Just need Docker installed
```

**Option B: Local emscripten**

1. **Emscripten SDK** — https://emscripten.org/docs/getting_started/downloads.html
   ```bash
   git clone https://github.com/nicbarker/emsdk.git ~/emsdk
   cd ~/emsdk && ./emsdk install latest && ./emsdk activate latest
   source ~/emsdk/emsdk_env.sh
   ```

2. **CMake** — `brew install cmake`

## Build

```bash
# Build and install into both canonical Playground asset locations
./build.sh --install

# Or just build (output goes to ammo.js/builds/)
./build.sh
```

The `--install` flag copies the WASM files to both asset locations and applies
the ESM export patch (comments out Emscripten's global `Ammo` assignment and
adds `export default Ammo;`). A fresh clone is patched idempotently before the
CMake build, so the generated output does not depend on an untracked checkout.

## What it changes

| Setting | Upstream | This build |
|---------|----------|------------|
| `ALLOW_MEMORY_GROWTH` | `0` (off) | `1` (on) |
| `INITIAL_MEMORY` | 64 MB | 64 MB |
| `MAXIMUM_MEMORY` | N/A (fixed) | 256 MB |

## After building

Restart the dev server to pick up the new WASM files.
