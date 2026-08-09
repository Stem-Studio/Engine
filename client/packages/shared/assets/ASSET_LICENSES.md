# Asset licensing

This directory ships with StemStudio. The engine code itself is
MIT-licensed (see `/LICENSE`), but the *content* bundled here comes from
several sources with their own terms.

## Fonts (`fonts/`)

All bundled font families are licensed under the
[SIL Open Font License (OFL) 1.1](https://scripts.sil.org/OFL). Each family
ships with the upstream `OFL.txt` inside its folder. You can use, embed, and
redistribute them under the OFL — see the linked text for the (short)
attribution requirement.

Included families: Balsamiq Sans, Inter, Jockey One, Lato, Lexend,
Montserrat, Open Sans, Roboto, Droid Sans, Lilita One.

## HDRIs (`hdr/`)

Both `studio.hdr` and `environment.hdr` come from
[Poly Haven](https://polyhaven.com/) and are licensed
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)
(public domain). No attribution required. See `hdr/README.md`.

## Animations (`animations/mixamo/`)

Four character locomotion clips downloaded from
[Mixamo](https://www.mixamo.com), Adobe's free character-animation library.
Adobe's Mixamo FAQ allows royalty-free use in commercial and non-commercial
projects including video games. See `animations/mixamo/README.md` for the
exact terms — they apply to any build that ships these files. Adobe's terms
do not turn into MIT; they ride on top.

## Engine support files (`js/`)

These are vendor-prebuilt WASM and decoder modules:

- `js/ammo/` — Ammo.js, the WebAssembly port of Bullet Physics.
  [zlib license](https://github.com/kripken/ammo.js/blob/main/LICENSE).
- `js/draco/` — Google's Draco mesh decoder.
  [Apache 2.0](https://github.com/google/draco/blob/main/LICENSE).
- `js/basis/` and `js/ktx2/` — Binomial's Basis Universal / KTX2 GPU texture
  decoders. [Apache 2.0](https://github.com/BinomialLLC/basis_universal/blob/master/LICENSE).
Per-folder `README.md` files inside each vendor directory link to upstream.

## Other textures (`textures/`)

The texture subdirectories (`SPE/`, `VolumetricFire/`, `patterns/`,
`particles/`, `terrain/`) ship with small placeholder textures useful as
defaults inside the editor. They are not load-bearing for the engine and
contain no externally-licensed content as of this writing. If you import
your own textures into a project, the project file references them by URL
or by content hash — the textures themselves are not embedded in
`.stemscript.json` exports.

## Assets intentionally absent

The repository should not ship assets whose terms are incompatible with
open-source redistribution. These legacy/deployment-specific assets are
intentionally absent:

- `textures/lensflare/` — CC-BY-NC-SA 3.0 (NonCommercial), unused by code.
- `ErthAI-logo.png` — deployment-specific brand asset.
- `AvatarCreator/` — hosted avatar creator assets are not part of this
  repository; the TypeScript component is a no-op compatibility shim.

## Re-checking the bundle

When adding new bundled assets, drop a `README.md` next to them documenting
the source and license, and append a row to this file. The OSS release
checklist requires every binary asset in `client/assets/` to have a
documented provenance.
