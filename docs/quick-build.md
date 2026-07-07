# Quick Build

Quick Build is the fast stamping surface for blockout scenes, small worlds, and playable greyboxes. It is visible by default from the editor ActionBar Build control and can be opened directly with `/create/project?builder=quick` or `/create/project?builder=1`.

## Concepts

- **Stamp**: one placed Quick Build object, stored as an ordinary scene object with `userData.quickBuild` metadata.
- **Variant**: an alternate visual form for a stamp kind, such as cottage vs cabin.
- **Brush**: placement mode. Single places one stamp; Radius, Line, and Rectangle place batches. Single and Radius can also paint continuously while dragging.
- **Adjacency**: compatible stamps update neighboring edge/corner pieces after placement.
- **Texture preset**: optional texture pack entry applied to compatible stamp kinds.
- **Bake**: combines live stamps into generated runtime batches for rendering. The source stamps stay editable in the editor while the baked batch is used for game visibility. **Clear Bakes** removes generated batches and restores the live stamps as game-visible objects.

## Shortcuts

| Key             | Action                                           |
| --------------- | ------------------------------------------------ |
| `1`-`9`, `0`    | Select stamp tools shown in the toolbar          |
| `V`             | Select                                           |
| `E`             | Erase                                            |
| `B`, `U`, `L`   | Bridge, shrub, lamp                              |
| `R` / `Shift+R` | Rotate clockwise / counterclockwise              |
| `[` / `]`       | Decrease / increase brush radius                 |
| `Esc`           | Cancel active draft/tool, then close Quick Build |

The shortcut registry is explicit, not positional after `9`: additional tools
use `0` or mnemonic letters, and every tool tooltip shows its assigned key.

## Texture Packs

Quick Build looks for texture-pack indexes at `/vendor/texture-packs/manifest.json`. The OSS build does not bundle AGPL texture payloads by default.

To opt into Tiny World Builder textures for a local/deployment build:

```bash
ENABLE_TINY_WORLD_TEXTURES=1 node scripts/copy-tiny-world-builder-textures.mjs
```

The script copies the upstream `LICENSE` and writes `NOTICE.md` beside the generated pack. Keep those files with redistributed copies.

Texture preset UI surfaces each preset's license and attribution from the pack metadata. Tiny World Builder remains opt-in: generated payload files under `client/public/vendor/texture-packs/` are gitignored and are not part of the default OSS build.

## URL Params

Documented Builder Studio entry values are `builder=1`, `builder=quick`, `builder=cad`, and `builder=plan`. Older aliases still parse for compatibility but should not be linked from docs or tests.

## Test IDs

Smokes rely on these stable selectors:

- `actionbar-quick-build`
- `actionbar-build-quick`
- `quick-build-toolbar`
- `quick-build-close`
- `quick-build-hint`
- `quick-build-tool-{id}`
- `quick-build-group-{terrain|paths|nature|buildings}`
- `quick-build-brush-{single|radius|line|rectangle}`
- `quick-build-texture-preset`
- `quick-build-placement-status`
- `quick-build-bake-batch`
- `quick-build-clear-bakes`
- `quick-build-bake-status`

Pointer events are used for viewport input. Mouse, pen, and one-finger touch can stamp; multi-touch input is ignored so navigation gestures do not paint.
