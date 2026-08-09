# Built-in Behaviors

A **behavior** is a script attached to a single scene object. It gets a
lifecycle (init, start, per-frame update, dispose), a handle to the engine,
and a bag of per-instance attributes. If you have ever written a Unity
`MonoBehaviour` or a Unreal `Component`, this is the same idea.

StemStudio ships ~40 built-in behaviors so you rarely start from scratch:
character controllers, triggers, sound, joints, billboards, spawners, and
more. **Reuse a built-in before you author a custom one** — search the catalog
below first.

This doc covers: the model, how to attach one in the editor, the catalog of
built-ins, and how to author your own. For lambdas (the batched ECS layer) see
[`lambdas.md`](./lambdas.md); for reusable code modules see
[`import-packs.md`](./import-packs.md).

---

## The model

Built-in behaviors live in
`client/packages/editor-oss/src/behaviors/packs/<name>/`. Each pack is a
TypeScript class extending `BehaviorBase` plus a `behavior.json` declaring its
attributes and defaults.

- **Base class & lifecycle** — `src/behaviors/Behavior.ts`
- **Registry** — `src/behaviors/BehaviorTypeRegistry.ts` (maps an id like
  `"trigger"` to its constructor)
- **Manager** — `src/behaviors/BehaviorManager.ts` (creates, attaches, hydrates
  configs, drives the update loop)
- **Scene shape** — `src/behaviors/BehaviorData.ts`

Saved scenes store only the behavior **id** and the **per-instance attribute
overrides**, in `object.userData.behaviors`. Full defaults rehydrate from the
in-process registry on load, so built-in upgrades flow into existing projects.

```jsonc
// object.userData.behaviors — one entry per attached behavior
{
  "id": "genericSound",      // looked up in BehaviorTypeRegistry
  "uuid": "…",               // unique per instance
  "enabled": true,
  "priority": 0,
  "attributesData": {        // overrides merged onto registry defaults
    "looping": true,
    "volume": 0.6
  }
}
```

### Lifecycle hooks

Override only the hooks you need. They are defined on the `Behavior` interface
in `Behavior.ts`.

| Hook | When it fires |
|---|---|
| `init(game)` | Once at instantiation. Async-friendly. Target not yet attached. |
| `onStart()` | When attached to the object (target available). Prefer over the deprecated `onAdded()`. |
| `update(deltaTime)` | Every frame in play mode. |
| `fixedUpdate(dt)` | Once per authoritative fixed simulation step, after physics and collision processing. The rate and maximum catch-up steps come from the active quality policy. |
| `onAttributesUpdated()` | An attribute changed (e.g. the user edited a field). |
| `onPaused()` / `onResumed()` / `onReset()` | Pause / resume / game reset. |
| `onEvent(msg, data)` | A custom event was delivered to this behavior. |
| `onStateUpdated(key, value)` | Multiplayer state in `GameManager.storage` changed. |
| `onStop()` / `dispose()` | Removed / destroyed. Dispose Three.js resources here. |

**Editor-mode hooks** run in the editor where `init(game)` is *never* called:
`onEditorAdded(editor)`, `onEditorUpdate()`, `onEditorAttributesUpdated()`,
`onEditorButtonClicked(action)`.

> **Common bug.** Do not cache `const erth = this.stem` only inside `init()` and
> then use that local from an editor hook — `init()` did not run there, so the
> local is `undefined`. Always read `this.stem` / `this.gameObject` directly at
> the top of each entry point. There is no `gameObject.game`; in the editor
> `game` is typically `undefined`, so guard any `game.renderer.*` access.

### Reaching the engine

From inside a behavior:

- `this.stem` — the engine API (`this.stem.asset`, `this.stem.physics`,
  `this.stem.scene`, `this.stem.ai`, …). This is the current name.
  `this.erth` and `this.stemEngine` are **deprecated aliases** that still work,
  so you will see `this.erth` in older built-ins.
- `this.gameObject` — the wrapper around the attached object. Exposes
  `uuid`/`position`/`rotation`/`scale`/`visible`/`physics`/`_internal.three`.
- `this.target` — the raw `THREE.Object3D` (deprecated in favor of
  `this.gameObject`).
- `this.getAttribute(key)` — read a per-instance attribute.

---

## Inter-behavior communication

Use the narrowest communication path that matches the job:

| Pattern | Use it for |
|---|---|
| Targeted `onEvent()` messages | One object telling behaviors on another object to react. This is the preferred behavior-to-behavior path. |
| `this.erth.behaviors.find*()` | Reading or requesting changes from a known behavior. |
| `this.erth.events.on()` | Engine-wide topics such as auth, score/lives, UI, or built-in gameplay events. Do not use it for ordinary behavior-to-behavior dispatch. |

### Targeted messages

Receiver:

```js
this.onEvent = function (msg, data) {
    if (msg !== "door.open") return;
    this._open = true;
    this._openedBy = data?.sourceName || "";
};
```

Sender:

```js
this.triggerDoor = function (doorObject) {
    this.game.behaviorManager.sendEventToObjectBehaviors(
        doorObject,
        "door.open",
        {source: this.target.uuid, sourceName: this.target.name}
    );
};
```

`sendEventToObjectBehaviors(target, msg, data, exceptIds?)` delivers the event
to every behavior attached to `target`. Use `exceptIds` when a behavior should
not receive its own event.

### Finding and changing behaviors

The `erth.behaviors` helper returns safe foreign-behavior views:

```js
this.onStart = function () {
    this._health = this.erth.behaviors.find(this.target, "health");
};

this.damage = function (amount) {
    if (!this._health) return;
    const current = Number(this.erth.behaviors.getAttribute(this._health, "hp") ?? 0);
    this.erth.behaviors.requestChange(this._health, "hp", Math.max(0, current - amount));
};
```

Use `find(target, id)` for a behavior on a specific object,
`findOnObject(target)` to list everything on an object, and `findAll(id)` to
query the scene by behavior id.

### Engine-wide events

Engine events are subscriptions, so always clean them up:

```js
this.onStart = function () {
    this._offScore = this.erth.events.on("game.score", (_topic, amount) => {
        this.target.userData.lastScore = amount;
    });
};

this.dispose = function () {
    this._offScore?.();
    this._offScore = null;
};
```

Use this for engine topics and built-in systems. For custom gameplay messages
between objects, prefer targeted `onEvent()` dispatch so lifetimes stay local to
the target object.

---

## Attaching a built-in behavior (step by step)

1. **Select an object** in the scene tree (e.g. a coin mesh).
2. Open the **right-hand properties panel** and find the **Behaviors** section.
3. Click **Add Behavior** and pick one from the searchable list — e.g.
   `genericSound`.
4. **Configure its attributes** inline. For `genericSound` that's the audio
   asset, `looping`, `volume`, `positional`, `autoPlay`. Edits fire
   `onAttributesUpdated()` live.
5. **Press Play.** The behavior's `init` → `onStart` → `update` loop runs. For
   `genericSound`, the clip loads and (if `autoPlay`) plays.
6. **Save.** Only the id + your overrides are written to
   `object.userData.behaviors`; everything else rehydrates from the registry.

To remove one, use the **×** next to it in the Behaviors section. To toggle it
without removing, flip its `enabled` checkbox.

> Some behaviors seed object-level state on attach. The `character` behavior,
> for instance, declares a default physics capsule. If your object sets physics
> explicitly (e.g. `enabled: false` on a ship), that explicit setting is
> respected — the behavior default only seeds objects that have *no* explicit
> physics. Keep that in mind when stacking controllers.

---

## The catalog

All under `src/behaviors/packs/`. Pick the closest match before writing custom
code.

### Movement & control
| Behavior | What it does |
|---|---|
| `character` | Player controller: walk/run, jump, climb. Seeds a capsule body. |
| `npc` / `aiNpc` | Non-player character; `aiNpc` adds navmesh pathfinding. |
| `enemy` | AI adversary. |
| `follow` | Track a target (camera, parent, player). |
| `platform` | Moving / patrolling platform. |
| `touchControls` | Mobile on-screen joystick, buttons, steering wheel. |
| `cinematicCamera` | Scripted camera moves. |

### Interaction & events
| Behavior | What it does |
|---|---|
| `trigger` | The workhorse event system: fire actions on collision, input, timer, distance, line-of-sight, metadata, … |
| `objectInteractions` | Pick up / use / interact with objects. |
| `consumable` | Health / ammo / buff pickups. |
| `shop` | NPC shop interaction. |
| `teleport` | Warp between locations. |
| `jumppad` | Velocity boost on contact. |
| `destructible` | Breakable objects. |
| `enableDisable` | Enable/disable other objects. |

### Spawning & world
| Behavior | What it does |
|---|---|
| `spawnpoint` | Marks a player spawn location. |
| `randomizedSpawner` | Spawns objects on a timer/condition. |
| `projectile` | Fired projectile. |
| `dayNightCycle` | Animated lighting / time of day. |
| `terrain` | Terrain mesh handling. |
| `navmesh` / `navmesh-connection` | Navigation mesh and links between regions. |
| `cesium` | CesiumJS geographic data. |

### Audio, graphics & FX
| Behavior | What it does |
|---|---|
| `genericSound` | Play an audio clip, positional or 2D, looping or one-shot. |
| `animation` | Play/stop skeletal or object animations; trigger via event. |
| `tween` | Interpolate properties over time. |
| `visualEffect` | Particles / VFX. |
| `postFx` | Post-processing effects. |
| `skybox` | Environment skybox. |
| `billboard` / `image_billboard` / `video_billboard` | Face-camera quads for sprites / images / video. |
| `csm` | Cascaded shadow mapping. |

### Physics joints
| Behavior | What it does |
|---|---|
| `jointFixed` | Rigid constraint between two bodies. |
| `jointHinge` | Revolute joint (doors, wheels). |
| `jointPoint2Point` | Ball-and-socket joint. |

(`testBehavior`, `testAttributesBehavior`, `spawn`, `volume` are dev/legacy
helpers.)

---

## Authoring custom behaviors

There are two authoring paths:

- **In the editor** — use this for project/game logic. The Behavior Creator
  saves a behavior asset with code, attributes, documentation, and revisions.
- **In engine source** — use this only when you are adding a reusable built-in
  pack that should ship with every project.

For gameplay authors, start in the editor. Source-code packs are covered after
the editor examples.

### Create one in the editor: `SpinPickup`

1. Open the **Assets** sidebar.
2. Click the **New** menu and choose **New Behavior**.
3. Name it `SpinPickup`.
4. Add these attributes in the right-hand settings panel:

| Key | Type | Default | Purpose |
|---|---|---:|---|
| `spinSpeed` | number | `2` | Radians per second around the Y axis. |
| `bobHeight` | number | `0.2` | Vertical bob distance in world units. |
| `bobSpeed` | number | `3` | Bob cycles per second-ish. |

Paste this into the behavior code editor:

```js
this.applyConfig = function () {
    this._spinSpeed = Number(this.getAttribute("spinSpeed") ?? 2);
    this._bobHeight = Number(this.getAttribute("bobHeight") ?? 0.2);
    this._bobSpeed = Number(this.getAttribute("bobSpeed") ?? 3);
};

this.onStart = function () {
    this.applyConfig();
    this._time = 0;
    this._baseY = this.target.position.y;
};

this.onAttributesUpdated = function () {
    this.applyConfig();
};

this.update = function (deltaTime) {
    this._time += deltaTime;
    this.target.rotation.y += this._spinSpeed * deltaTime;
    this.target.position.y = this._baseY + Math.sin(this._time * this._bobSpeed) * this._bobHeight;
};
```

Then select a coin, gem, or pickup object in the scene, open the **Behaviors**
section in the right panel, add `SpinPickup`, and press **Play**. The behavior
asset is saved with the project; it does not require a repo change.

### Worker-backed behavior: `ThreatHeatmap`

Use a worker when a behavior needs pure computation that might stall the main
thread: path scoring, terrain sampling, procedural placement, visibility
queries, or large array transforms. Workers cannot access Three.js objects, the
DOM, `this.stem`, or behavior attributes directly. Send plain JSON or
transferable buffers in, then apply the result on the main thread.

Create a **Script** asset named `threat-heatmap-worker`:

```js
self.onmessage = function (event) {
    const message = event.data || {};
    if (message.type !== "sample") return;

    const data = message.data || {};
    const origin = data.origin || {x: 0, z: 0};
    const points = Array.isArray(data.points) ? data.points : [];
    const radius = Math.max(0.001, Number(data.radius || 12));
    let nearestSq = radius * radius;

    for (const p of points) {
        const dx = Number(p.x || 0) - origin.x;
        const dz = Number(p.z || 0) - origin.z;
        nearestSq = Math.min(nearestSq, dx * dx + dz * dz);
    }

    const danger = Math.max(0, 1 - Math.sqrt(nearestSq) / radius);
    self.postMessage({type: "danger", data: {danger}});
};
```

Create a behavior named `ThreatHeatmap` with these attributes:

| Key | Type | Default | Purpose |
|---|---|---:|---|
| `radius` | number | `12` | Distance where threat fades to zero. |
| `sampleRate` | number | `6` | Worker samples per second. |
| `points` | object | `[]` | Array like `[{x: 5, z: 1}, {x: -3, z: 8}]`. |

Paste this into the behavior code editor:

```js
this.init = async function () {
    this._danger = 0;
    this._elapsed = 0;
    this._pending = false;

    const url = await this.erth.asset.script.getUrlByName("threat-heatmap-worker");
    this._worker = new window.Worker(url);
    this._worker.onmessage = (event) => {
        const message = event.data || {};
        if (message.type !== "danger") return;
        this._danger = Number(message.data?.danger || 0);
        this._pending = false;
    };
};

this.update = function (deltaTime) {
    this._elapsed += deltaTime;

    const rate = Math.max(1, Number(this.getAttribute("sampleRate") ?? 6));
    if (this._worker && !this._pending && this._elapsed >= 1 / rate) {
        this._elapsed = 0;
        this._pending = true;
        this._worker.postMessage({
            type: "sample",
            data: {
                origin: {x: this.target.position.x, z: this.target.position.z},
                radius: Number(this.getAttribute("radius") ?? 12),
                points: this.getAttribute("points") || [],
            },
        });
    }

    // Main-thread application stays small: read the last worker result and
    // apply it to a real scene object.
    this.target.scale.y = 1 + this._danger * 2;
};

this.dispose = function () {
    if (this._worker) {
        this._worker.terminate();
        this._worker = null;
    }
};
```

This pattern keeps the worker stateless and disposable. For heavier jobs, send
typed arrays and transfer their buffers in `postMessage` so the browser does
not clone large payloads every frame.

### Import, export, revisions, and managed files

Behavior assets are portable YAML documents with three sections:

```yaml
meta:
  tool: StemStudio
  type: behavior
  exportVersion: 1
config:
  id: spin-pickup
  name: Spin Pickup
  attributes: {}
code: |
  this.update = function (deltaTime) {};
```

To import a behavior, open **Assets → Behaviors**, click the import/upload icon
on that row, and choose one or more `.yaml`/`.yml` behavior exports. The editor
parses the `config` and `code`, checks for duplicate names/ids, creates a new
behavior asset, and registers it so it appears in the behavior picker.

The export helper in the codebase emits the same YAML shape, and full scene
exports include behavior YAML files under `behaviors/` when the scene bundle is
dumped. Use that format when you need to move a behavior between projects,
review a behavior in Git, or seed a project from a scripted import.

When you use a visual designer, AI generator, or other higher-level authoring
surface, treat the files it creates as managed artifacts. The designer is
responsible for creating the behavior asset, matching config fields to the UI,
and keeping associated helper files/imports in sync. Edit through the designer
unless you intentionally switch that asset to hand-authored code.

In local playground mode, behavior edits are latest-only: the local adapter keeps a
single effective version for each behavior asset. In a self-hosted server-backed install,
each save creates an immutable asset revision; the history icon on behavior
cards opens revision history, lets you diff, switch, or roll back, and stores
the selected revision in the scene's asset resolution context.

### Source-code behavior packs

Edit engine source only when the behavior should become a built-in pack. Use
`genericSound` as the reference for shape: load in `init`, apply config in
`onStart`/`onAttributesUpdated`, release in `onStop`.

```ts
import {BehaviorBase} from "../../Behavior";
import GameManager from "../../game/GameManager";

class SpinBehavior extends BehaviorBase {
    private speed = 1;

    private applyConfig() {
        this.speed = Number(this.getAttribute("speed") ?? 1);
    }

    init(_game: GameManager) {
        this.applyConfig();
    }

    onStart() {
        this.applyConfig();
    }

    onAttributesUpdated() {
        this.applyConfig();
    }

    update(deltaTime: number) {
        this.gameObject.rotation.y += this.speed * deltaTime;
    }

    dispose() {
        // Release any geometries/materials/textures/listeners you created.
    }
}

export default SpinBehavior;
```

A `behavior.json` next to the class declares the editor-editable fields and
their defaults:

```jsonc
{
  "id": "spin",
  "name": "Spin",
  "attributes": {
    "speed": { "name": "Speed (rad/s)", "type": "number", "default": 1, "min": 0, "max": 10 }
  }
}
```

> Read engine handles from `this.stem` / `this.gameObject` directly inside each
> hook. Re-deriving config in `onStart` and `onAttributesUpdated` keeps editor
> edits and play mode in sync.

---

## Verification

Behavior changes are exercised by the local smokes (they save → reload → play and
import a real game):

```bash
bun run typecheck
bun run test          # Vitest — NOT `bun test`
node scripts/playwright/oss-smoke.mjs           # needs `bun run dev` on :5173
node scripts/playwright/oss-import-3dchess.mjs
```

Re-run the smokes if you touch behavior attach/hydrate, the registry, or the
manager update loop.
