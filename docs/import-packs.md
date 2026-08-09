# Import Packs

An **import pack** is a curated, read-only JavaScript module that ships with
the editor and can be cloned into a project as a **Script asset** in one click.
Once added, behaviors and lambdas pull it in with an `@import` directive and
call its exported helpers — shared math, RNG, UI scaffolding, and the like.

Think of packs as the engine's standard library for game code: instead of
copy-pasting a simplex-noise implementation into five behaviors, you add the
`noise` pack once and `@import` it wherever you need it.

> Import packs contain **code only** — no behaviors, lambdas, prefabs, or
> assets. For attachable game logic see [`built-in-behaviors.md`](./built-in-behaviors.md)
> and [`lambdas.md`](./lambdas.md).

---

## What ships

Three packs are bundled today, under
`client/packages/editor-oss/src/editor/scripts/builtinPacks/`:

| Pack | What it gives you |
|---|---|
| `noise` | Seedable 2D/3D simplex noise. Deterministic — same seed, same field. Terrain heights, clouds, particle drift, organic motion. |
| `prng` | Seeded pseudo-random generator (alea). Deterministic across multiplayer clients and replays — same seed → same sequence everywhere. |
| `uikit-dual-mode` | UIKit lifecycle helper that renders the same `UIKit.Fullscreen` tree in both editor preview and play mode, replacing per-behavior inlined IIFEs. |

Each is a StemStudio export-envelope YAML file (`meta` / `config` / `code`) —
the same shape you get when you export a Script asset from the editor.

---

## Anatomy of a pack

The loader interface (`builtinPacks/index.ts`) is deliberately tiny:

```ts
export interface ImportPack {
    name: string;        // stable id — also becomes the Script asset name
    description: string; // shown in the picker
    code: string;        // JS source, cloned verbatim into the new Script asset
}
```

Packs are bundled into the client at **build time** via Vite's
`import.meta.glob("./*.yaml")` — there is no backend round-trip and no runtime
fetch. `getSystemImportPacks()` parses and caches them on first use.

The YAML envelope:

```yaml
meta:
  tool: StemStudio
  type: import        # "import" or "script" both accepted
  exportVersion: 1
config:
  name: noise
  description: |
    Seedable 2D and 3D simplex noise. Deterministic …
code: |
  // JavaScript source here — copied verbatim into the Script asset
```

---

## Adding a pack to your project (step by step)

1. Open the **Assets** sidebar (left panel) and find the **Scripts** row.
2. Click the **Add New** (upload) button on that row to open the import menu.
3. Choose **Browse packs**. The picker lists every bundled pack with its
   description. Packs already in the project are greyed out with a checkmark so
   you can't add a duplicate.
4. Click a pack — say `noise`. It is cloned into the scene as a Script asset
   named `noise` (its `code` copied verbatim).
5. The creation hook scans the new code for its own `@import` dependencies and
   seeds the dependency cache, so the asset is immediately resolvable.

That's it — the pack is now a normal Script asset in your project, editable
like any other (though you'll usually leave the curated source as-is).

The same **Add New → Browse packs** flow is available from the script **Code
Editor** modal in the right panel; both routes converge on the same picker and
the same `useCreateScript()` hook.

---

## Creating a project import in the editor

You do not need to add an engine import pack for one-project helpers. Create a
normal Script asset and import it by name.

1. Open the **Assets** sidebar.
2. Expand **Scripts**.
3. Click **Add New** and choose **New empty import**.
4. Name the Script asset `steering-utils`.
5. Paste this code and save:

```js
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function seek2D(position, target, maxStep) {
    const dx = Number(target.x || 0) - Number(position.x || 0);
    const dz = Number(target.z || 0) - Number(position.z || 0);
    const distance = Math.hypot(dx, dz);

    if (distance <= 0.0001) {
        return {x: position.x, z: position.z, distance: 0};
    }

    const step = Math.min(distance, Math.max(0, Number(maxStep || 0)));
    return {
        x: position.x + dx / distance * step,
        z: position.z + dz / distance * step,
        distance
    };
}

function arriveFactor(distance, slowingRadius) {
    const radius = Math.max(0.0001, Number(slowingRadius || 1));
    return clamp(Number(distance || 0) / radius, 0, 1);
}
```

Only top-level function declarations, function expressions, and arrow-function
variables are exported onto the import alias. Plain variables stay private to
the import.

### Use it from a behavior

```js
@import "steering-utils" as steer;

this.onStart = function () {
    this._speed = Number(this.getAttribute("speed") ?? 4);
    this._target = {
        x: Number(this.getAttribute("targetX") ?? 0),
        z: Number(this.getAttribute("targetZ") ?? 0)
    };
};

this.onAttributesUpdated = function () {
    this.onStart();
};

this.update = function (deltaTime) {
    const next = steer.seek2D(
        {x: this.target.position.x, z: this.target.position.z},
        this._target,
        this._speed * deltaTime
    );

    this.target.position.x = next.x;
    this.target.position.z = next.z;
};
```

### Use it from a lambda

```js
@import "steering-utils" as steer;

function update(deltaTime) {
    this.processObjects(deltaTime, (object, data, dt) => {
        const target = {
            x: Number(data.targetX ?? 0),
            z: Number(data.targetZ ?? 0)
        };
        const speed = Number(data.speed ?? 3);
        const next = steer.seek2D(
            {x: object.position.x, z: object.position.z},
            target,
            speed * dt
        );

        object.position.x = next.x;
        object.position.z = next.z;

        const arrive = steer.arriveFactor(next.distance, Number(data.slowingRadius ?? 4));
        this.setComponentData(object, "arrive", arrive);
    });
}
```

For that lambda, include component fields such as `targetX`, `targetZ`,
`speed`, `slowingRadius`, and `arrive` in the lambda config. If another lambda
reads `arrive`, put `arrive` in this lambda's `writeComponents` and the other
lambda's `readComponents` so the scheduler orders them correctly.

---

## Using a pack or import from a behavior or lambda

Once the Script asset exists, pull it in with an `@import "<name>" as <alias>;`
directive at the top of your behavior/lambda code. The alias becomes a normal
object whose methods are the pack's exports.

### `noise` — procedural fields

```js
@import "noise" as noise;

const n = noise.create("world-1");          // seed by string or number
const h = n.noise2D(x * 0.05, z * 0.05);    // -1..1  (e.g. terrain height)
const v = n.noise3D(x, y, z);               // -1..1  (e.g. 3D density)
```

### `prng` — deterministic randomness

```js
@import "prng" as prng;

const rng  = prng.create("level-42");        // seed by string or number
const x    = rng.next();                      // 0..1
const dice = rng.intRange(1, 7);              // [1,6] inclusive
const pick = rng.pick(["a", "b", "c"]);
const dup  = rng.clone();                     // independent copy at same state
rng.skip(1000);                               // advance N steps without consuming
```

Because the sequence is fully determined by the seed, every multiplayer client
that uses the same seed sees the same rolls — use `prng`, not `Math.random()`,
for anything that must agree across clients or replays.

### `uikit-dual-mode` — UI that works in editor and play

```js
@import "uikit-dual-mode" as uikit;

this.init = function (_game) {
    this._uikitCtx = uikit.createPlayContext(_game);
    this._uiRoot   = uikit.buildRoot(this._uikitCtx);
    this._buildUIKitContent();
    uikit.attach(this, this._uikitCtx);
};
this.update  = function (dt) { uikit.tick(this, dt); };
this.dispose = function ()   { uikit.teardown(this); };

this.onEditorAdded = async function (editor) {
    if (!this._uiRoot) {
        this._uikitCtx = await uikit.createEditorContext(editor);
        this._uiRoot   = uikit.buildRoot(this._uikitCtx);
        this._buildUIKitContent();
    }
};
```

(Requires `editor.ensureUICamera()` and `GameManager.initUIKit()` — present in
this build. See [`uikit-api.md`](./uikit-api.md).)

---

## How packs relate to the rest of the import system

The packs picker is one entry into the broader **script-tool import pipeline**
(`client/packages/editor-oss/src/agent/script-tool/`). The same pipeline also
handles:

- **Uploading a file** — `.js`/`.mjs`/`.cjs` (raw code; filename becomes the
  asset name) or a `.yaml` export envelope (parsed the same way packs are).
- **New empty import** — a blank Script asset you write from scratch.

All of these land as Script assets through `useCreateScript()`, which scans for
`@import` dependencies and seeds the dependency cache.

Script imports can import other Script imports with the same directive. Cycles
are rejected at load time so a helper graph cannot deadlock the runtime.

In Chromium browsers with the File System Access API, the dashboard's
**Import project folder** feature supports two larger flows.
For an exported `.stemscript.json` project plus its matching asset directory,
it validates and copies the bundle directly into the local project store. For
an executable `.stemscript` folder, it stages the folder, navigates to a fresh
project, and runs the `exec` flow to materialize the scene and assets. Import
packs are the single-module version of the executable-script path.

---

## Imports and background workers

`@import` aliases are created when behavior or lambda code is evaluated. A Web
Worker is a separate global context, so it does not automatically receive those
aliases.

Use one of these patterns:

- Use imports on the main thread to prepare a serializable job, send that job to
  the worker, then use imports again when applying the result.
- Put worker-only helpers directly in the worker Script asset or Blob source.
- For behavior-managed worker Script assets, load the worker with
  `this.erth.asset.script.getUrlByName("worker-script-name")`; that URL points
  at the raw script source with `@import` directives stripped.

Example behavior using an import on the main thread and a separate worker:

```js
@import "steering-utils" as steer;

this.init = async function () {
    const url = await this.erth.asset.script.getUrlByName("steering-worker");
    this._worker = new window.Worker(url);
    this._worker.onmessage = (event) => {
        this._result = event.data;
    };
};

this.update = function (deltaTime) {
    const next = steer.seek2D(
        {x: this.target.position.x, z: this.target.position.z},
        {x: 0, z: 0},
        Number(this.getAttribute("speed") ?? 3) * deltaTime
    );

    this._worker.postMessage({
        type: "score",
        position: {x: next.x, z: next.z}
    });

    if (this._result?.type === "score") {
        this.target.userData.lastScore = this._result.score;
    }
};

this.dispose = function () {
    this._worker?.terminate();
};
```

The worker script should be self-contained:

```js
self.onmessage = function (event) {
    const message = event.data || {};
    if (message.type !== "score") return;

    const p = message.position || {x: 0, z: 0};
    const score = Math.hypot(Number(p.x || 0), Number(p.z || 0));
    self.postMessage({type: "score", score});
};
```

For lambdas, use the same boundary but create the worker from a Blob inside the
lambda, as shown in [`lambdas.md`](./lambdas.md#worker-backed-lambda-flockoffsets).

---

## Import/export, revisions, and managed files

Script import assets can be moved as raw `.js`/`.mjs`/`.cjs` files or as the
StemStudio YAML envelope:

```yaml
meta:
  tool: StemStudio
  type: import
  exportVersion: 1
config:
  name: steering-utils
  description: Shared movement helpers
code: |
  function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
  }
```

The **Scripts → Add New → Upload file** flow accepts raw JavaScript files and
YAML import exports. Raw JavaScript uses the filename as the import asset name;
YAML uses `config.name` and preserves the optional description. Scene bundle
exports write script imports under `imports/`, while behavior and lambda
exports that depend on those imports keep their dependency references through
the scene asset resolution context.

When a visual designer, AI generator, or other higher-level authoring surface
creates helper imports for you, treat them as managed files. The designer owns
the import names, dependency graph, and generated helper code needed by the
behavior/lambda it produced. Rename or edit those imports only if you are also
updating every `@import` reference that depends on them.

In local playground mode, script import edits are latest-only: each asset resolves
to the single current local version. In a self-hosted server-backed install, script imports
participate in the full asset revision system; the history icon on script cards
opens revision history and the scene pins the active revision just like it does
for behavior and lambda assets.

---

## Shipping a new pack

Because packs are loaded by a build-time glob, adding one is just dropping a
file in — no code changes:

1. In the editor, author the helper as a Script asset and **export** it (you
   get a `meta`/`config`/`code` YAML envelope).
2. Drop that `.yaml` into
   `client/packages/editor-oss/src/editor/scripts/builtinPacks/`.
3. Ensure `meta.type` is `import` or `script`, and `config.name` + `code` are
   present (the loader skips files that fail these checks and logs why).
4. Rebuild the client. `getSystemImportPacks()` picks it up automatically and
   it appears in the picker, sorted by name.

---

## Verification

The packs picker feeds the script-tool import pipeline, which the local smokes
cover:

```bash
bun run typecheck
bun run test          # Vitest — NOT `bun test`
node scripts/playwright/oss-import-3dchess.mjs   # needs `bun run dev` on :5173
```

Re-run the import/persistence smokes if you change the picker, the loader, or
`useCreateScript()`.
