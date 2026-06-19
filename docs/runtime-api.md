# Runtime API

Behavior scripts access the engine through `this.erth`. Class-based engine code also has `this.stem` and `this.stemEngine` aliases, but the editor scripting runtime consistently exposes `this.erth`, so the public docs use that name.

Use `this.erth` for normal gameplay work before dropping down to `this.game`. It is the stable author-facing layer for assets, runtime objects, shared state, behavior lookup, AI generation, events, and utility systems.

## Top-level namespaces

```ts
this.erth.ai
this.erth.asset
this.erth.camera
this.erth.object
this.erth.viewport
this.erth.scene
this.erth.store
this.erth.behaviors
this.erth.lambdas
this.erth.events
this.erth.combat
this.erth.team
this.erth.pool
this.erth.tween
this.erth.fsm
this.erth.behaviorTree
this.erth.spatial
```

`tween`, `fsm`, `behaviorTree`, and `spatial` load their underlying libraries the first time you call them. Await the creator once during `init()` or `onStart()`, then use the returned handle from `update()`.

## Assets

Most asset methods work with an `AssetRef`:

```ts
type AssetRef = {
  assetId: string;
  revisionId: string;
};
```

Asset attributes selected in the editor usually already have this shape. You can also resolve scene assets by name.

```ts
this.onStart = async function () {
  const ref = await this.erth.asset.model.findByName("Enemy");
  if (!ref) return;

  const enemy = await this.erth.asset.model.createInstance(ref);
  enemy.position.set(0, 1, -4);
  await this.erth.scene.addObject(enemy);
};
```

| Namespace | Methods |
|---|---|
| `asset.model` | `createFromUrl(params)`, `preload(ref)`, `createInstance(ref)`, `unload(ref)`, `findByName(name)` |
| `asset.stem` | `preload(ref)`, `createInstance(ref)`, `unload(ref)`, `findByName(name)` |
| `asset.image` | `createTexture(ref)`, `getUrl(ref)`, `findByName(name)` |
| `asset.audio` | `getUrl(ref)`, `getUrlByName(name)`, `findByName(name)` |
| `asset.video` | `getUrl(ref)`, `getUrlByName(name)`, `findByName(name)` |
| `asset.file` | `getUrl(ref)`, `getUrlByName(name)`, `findByName(name)` |
| `asset.script` | `getUrl(ref)`, `getUrlByName(name)`, `findByName(name)` |

`asset.script.getUrl()` returns a `blob:` URL for a script asset and strips `@import` directives because those are only valid inside the behavior runtime. Use it for raw workers or standalone script loading.

```ts
this.init = async function () {
  const workerUrl = await this.erth.asset.script.getUrlByName("pathfinding-worker");
  this.worker = new Worker(workerUrl);
};
```

The asset namespace also exposes management calls:

```ts
await this.erth.asset.createAssetRelease(params);
await this.erth.asset.getAssetDerivatives({assetId, revisionId});
await this.erth.asset.getMyAssets({types, includeLatestRelease: true});
```

These methods exist in the engine, but they depend on the configured asset backend. In local playground projects, most behavior code should prefer scene asset refs, `findByName()`, and the loader methods above.

## Objects, scene, and camera

`erth.object.createFromThreeObject()` wraps a raw Three.js object as a `GameObject`. `erth.scene.addObject()` adds that wrapper to the running scene and initializes behaviors, lambdas, and physics.

```ts
this.onStart = async function () {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({color: 0xff5533}),
  );

  const box = this.erth.object.createFromThreeObject(mesh);
  box.position.set(0, 2, 0);
  await this.erth.scene.addObject(box);
};
```

`erth.camera` exposes the active camera position, orientation, projection planes, field of view, and `lookAt(x, y, z)`.

```ts
this.update = function () {
  this.erth.camera.lookAt(0, 1, 0);
};
```

`erth.viewport` exposes the current visible runtime rect after Stem Studio host chrome is accounted for. It is the right source for DOM overlays, screen-space markers, or custom UI camera alignment that must avoid the player nav or registered host overlays such as the player watermark.

```ts
const safe = this.erth.viewport.getSafeArea();
// { left, top, right, bottom, width, height, insetLeft, insetTop, insetRight, insetBottom }

this.onStart = function () {
  const safe = this.erth.viewport.getSafeArea();
  this.hud.style.left = `${safe.left + safe.width / 2}px`;
  this.hud.style.bottom = `${safe.insetBottom + 16}px`;
};
```

For lower-level object and physics details, see [GameObject and GameManager API](/docs/gameobject-and-game-manager-api).

## Store

The global store is a per-game-session key-value map shared by behaviors on the local client.

```ts
this.erth.store.get<T = unknown>(key);
this.erth.store.set(key, value);
this.erth.store.has(key);
this.erth.store.delete(key);
this.erth.store.keys();
this.erth.store.size;
```

Important constraints:

- The store is cleared when a game session starts.
- It has a hard limit of 128 keys.
- It is local to each client. It does not automatically synchronize multiplayer state.
- Store plain gameplay data, not Three.js objects, DOM elements, or functions.

```ts
this.onStart = function () {
  if (!this.erth.store.has("score")) {
    this.erth.store.set("score", 0);
  }
};

this.onEvent = function (msg, data) {
  if (msg !== "coin.collected") return;
  const current = this.erth.store.get("score") ?? 0;
  this.erth.store.set("score", current + (data?.points ?? 1));
};
```

## Behaviors and lambdas

Use `erth.behaviors` for cross-behavior lookup and attribute changes.

```ts
const mover = this.erth.behaviors.find(this.target, "moving-platform");
if (mover) {
  await this.erth.behaviors.requestChange(mover, "speed", 4);
}
```

```ts
this.erth.behaviors.find(target, id);
this.erth.behaviors.findAll(id);
this.erth.behaviors.findOnObject(target);
this.erth.behaviors.getAttribute(behavior, key);
this.erth.behaviors.requestChange(behavior, key, value, options?);
```

Use `erth.lambdas` when a behavior needs to query or register objects with lambda instances.

```ts
const systems = this.erth.lambdas.getInstancesByType("damage-system");
const damageSystem = systems[0];

if (damageSystem) {
  this.erth.lambdas.registerObject(damageSystem.uuid, this.target, {
    health: 100,
    armorType: "light",
  });
}
```

```ts
this.erth.lambdas.getInstance(instanceId);
this.erth.lambdas.getInstancesByType(lambdaId);
this.erth.lambdas.registerObject(instanceId, target, componentData?);
this.erth.lambdas.deregisterObject(instanceId, target);
this.erth.lambdas.getObjectLambdas(target);
```

## Events

There are two event paths:

1. Targeted behavior messages use `onEvent(msg, data)` on the receiver and `game.behaviorManager.sendEventToObjectBehaviors(target, msg, data)` on the sender.
2. Engine-wide topics use `this.erth.events.on(topic, callback)` and return an unsubscribe function.

```ts
this.init = function (game) {
  this.game = game;
};

this.onStart = function () {
  this.stopScoreListener = this.erth.events.on("game.score", (msg, amount) => {
    console.log("score event", msg, amount);
  });
};

this.dispose = function () {
  this.stopScoreListener?.();
};
```

Engine event subscriptions are hierarchical. Subscribing to `game.score` receives `game.score.inc` and `game.score.dec`; the callback's first argument is the actual topic.

Current engine topic groups include:

| Group | Topics |
|---|---|
| Game state | `game.lives.inc`, `game.lives.dec`, `game.health.inc`, `game.health.dec`, `game.score.inc`, `game.score.dec`, `game.time.inc`, `game.time.dec`, `game.loginSuccess` |
| Enemy | `enemy.spawned`, `enemy.died`, `enemy.got.hit`, `enemy.state.changed`, `enemy.player.detected`, `enemy.player.lost`, `enemy.attack.started`, `enemy.attack`, `enemy.attack.ended` |
| Character motion | `character.motion.none`, `character.motion_start`, `character.motion`, `character.motion_end`, `character.motion.walk_start`, `character.motion.walk`, `character.motion.walk_end`, `character.motion.run_start`, `character.motion.run`, `character.motion.run_end` |
| Character action | `character.action.jump_start`, `character.action.jump`, `character.action.land`, `character.action.climb_start`, `character.action.climb`, `character.action.climb_end`, `character.action.crouch_start`, `character.action.crouch`, `character.action.crouch_end`, `character.action.fall_start`, `character.action.fall`, `character.action.fall_end`, `character.action.fall_back`, `character.action.dead`, `character.action.interact` |
| Animation | `character.animation.trigger`, `character.animation.stop`, `character.animation.complete` |
| Pickups and triggers | `consumable.in.range`, `consumable.not.in.range`, `consumable.collected`, `consumable.collided`, `jumppad.activated`, `platform.activated`, `platform.moving`, `platform.deactivated`, `volume.activated`, `randomized.spawner.activated`, `spawner.activated`, `teleport.activated` |
| NPC | `npc.interaction.started`, `npc.interaction.ended`, `npc.action.started`, `npc.action.ended` |
| Device and services | `device.orientation`, `gameServices.authenticated` |

The global `EventBus` object is still injected for legacy scripts, but new behavior-to-behavior code should use `onEvent()` and `game.behaviorManager.sendEventToObjectBehaviors()`.

## AI generation

3D model generation is available through:

```ts
await this.erth.ai.gen.generate3dModel({
  generationType: "text_to_model",
  prompt: "low poly treasure chest",
  generator: "meshy",
  quality: "preview",
  onProgress: (progress) => console.log(progress),
});
```

Parameters include:

```ts
{
  generationType: "text_to_model" | "image_to_model";
  prompt: string;
  negativePrompt?: string;
  url?: string;
  fileToken?: string;
  quality?: string;
  modelVersion?: string;
  generator?: "meshy" | "tripo" | "rodin";
  targetPolygonCount?: number;
  autoRig?: boolean;
  refine?: boolean;
  onProgress?: (progress: number) => void;
  onTaskCreated?: (taskId: string) => void;
}
```

`generator` selects the provider. `meshy` and `tripo` support image input and
rigging; `rodin` (Hyper3D) is text-to-3D only in this build (no refine/rig).
Each requires the matching BYOK key — see `docs/byok.md`.

The call returns `{taskId, modelUrl, thumbnailUrl}`. In the public playground, the user must configure the relevant provider key before generation can complete.

## Combat, teams, and pooling

`erth.combat` exposes reusable stat helpers:

```ts
this.erth.combat.calculateDamage(attacker, target);
this.erth.combat.applyDamage(target, damage);
this.erth.combat.regenerateHealth(unit, deltaTime);
this.erth.combat.getAttackPriority(unit);
this.erth.combat.selectBestTarget(attackerPos, targets);
this.erth.combat.getDamageEffectiveness(damageType, armorType);
```

`erth.team` exposes friendly/enemy checks:

```ts
this.erth.team.isEnemy(a, b);
this.erth.team.isFriendly(a, b);
this.erth.team.canAttack(attacker, target, friendlyFire?);
this.erth.team.findNearestEnemy(unit, allUnits, maxRange?);
this.erth.team.getEnemiesInRange(unit, allUnits, range);
```

`erth.pool.create(config)` builds a generic object pool:

```ts
this.bulletPool = this.erth.pool.create({
  create: () => new THREE.Object3D(),
  reset: (obj) => {
    obj.visible = true;
  },
  destroy: (obj) => {
    obj.parent?.remove(obj);
  },
  initialSize: 10,
  maxSize: 100,
});
```

## Tween

`erth.tween.to(target, options)` animates numeric properties. Time values are seconds, matching behavior `update(deltaTime)`.

```ts
this.onStart = async function () {
  this.popIn = await this.erth.tween.to(this.gameObject.position, {
    y: 5,
    duration: 0.6,
    easing: "Cubic.InOut",
    autoStart: true,
  });
};

this.dispose = function () {
  this.popIn?.stop();
};
```

Common handle methods: `start()`, `stop()`, `pause()`, `resume()`, `onComplete(cb)`, `onUpdate(cb)`, `delay(seconds)`, `repeat(count)`, `yoyo()`, `chain(...)`, `isPlaying()`.

Use `this.erth.tween.killAll()` only when you intentionally want to stop every active engine tween.

## Finite state machines

`erth.fsm.create(config)` wraps XState v5 and returns an actor.

```ts
this.init = async function () {
  this.door = (await this.erth.fsm.create({
    id: "door",
    initial: "closed",
    context: {locked: false},
    states: {
      closed: {on: {OPEN: {target: "open", guard: ({context}) => !context.locked}}},
      open: {on: {CLOSE: "closed"}},
    },
  })).start();

  this.unsubscribeDoor = this.door.subscribe((snapshot) => {
    console.log(snapshot.value, snapshot.context);
  });
};

this.dispose = function () {
  this.unsubscribeDoor?.();
  this.door?.stop();
};
```

Actor methods: `start()`, `stop()`, `send(event)`, `snapshot()`, `subscribe(fn)`, `matches(statePath)`.

## Behavior trees

`erth.behaviorTree.create(definition, agent)` wraps mistreevous. Conditions and actions are looked up by method name on the agent object.

```ts
this.init = async function () {
  const agent = {
    canSeePlayer: () => !!this.erth.behaviors.findAll("player.tag")[0],
    attack: () => "SUCCEEDED",
    patrol: () => "RUNNING",
  };

  this.tree = await this.erth.behaviorTree.create({
    type: "selector",
    children: [
      {type: "sequence", children: [
        {type: "condition", call: "canSeePlayer"},
        {type: "action", call: "attack"},
      ]},
      {type: "action", call: "patrol"},
    ],
  }, agent);
};

this.update = function () {
  this.tree?.step();
};
```

Action return values are `"SUCCEEDED"`, `"FAILED"`, or `"RUNNING"`.

## Spatial queries

`erth.spatial.octree()` builds an octree for static scene geometry.

```ts
this.init = async function (game) {
  const levelRoot = game.scene.getObjectByName("Level");
  if (!levelRoot) return;

  this.octree = (await this.erth.spatial.octree()).fromGroup(levelRoot);
};
```

Octree methods:

```ts
octree.fromGroup(group);
octree.rayCast(ray);
octree.intersectSphere(sphere);
octree.intersectCapsule(capsule);
octree.getBox();
```

`fromGroup()` walks mesh descendants and should be called when static world geometry changes, not every frame.

## Patterns from real playground games

These examples are condensed from working game projects and adjusted to the current author-facing API. They show how the APIs above tend to fit together in full behaviors.

### Procedural runtime world builder

Kenny Cars-style track builders create raw Three.js geometry, wrap it as a `GameObject`, add it to the scene, then publish spawn state for the player controller.

```ts
this.onStart = async function () {
  const root = new THREE.Group();
  root.name = "RuntimeTrack";
  root.userData.isRuntimeOnly = true;

  const road = new THREE.Mesh(
    new THREE.BoxGeometry(24, 0.25, 80),
    new THREE.MeshStandardMaterial({color: 0x30343a}),
  );
  road.position.set(0, 0, -20);
  road.userData.isRuntimeOnly = true;
  root.add(road);

  const startGate = new THREE.Mesh(
    new THREE.BoxGeometry(8, 4, 0.25),
    new THREE.MeshStandardMaterial({color: 0xffcc33}),
  );
  startGate.position.set(0, 2, 12);
  startGate.userData.isRuntimeOnly = true;
  root.add(startGate);

  const track = this.erth.object.createFromThreeObject(root);
  await this.erth.scene.addObject(track);

  this.erth.store.set("race.spawn", {
    position: {x: 0, y: 0.5, z: 10},
    yaw: Math.PI,
  });
  this.erth.store.set("race.trackReady", true);
};
```

This pattern is useful when authored scene data describes a course, puzzle, or arena, but the actual mesh layout is generated at runtime.

### Asset-driven model, texture, and sound setup

Rail shooters and chess games commonly let designers pick model/image/audio assets as behavior attributes, with name lookup as a fallback for template projects.

```ts
this.onStart = async function () {
  let shipRef = this.getAttribute("shipModel");
  if (!shipRef) {
    shipRef = await this.erth.asset.model.findByName("Player Ship");
  }

  if (shipRef) {
    const ship = await this.erth.asset.model.createInstance(shipRef);
    const shipObject = ship._internal?.three ?? ship.target ?? ship;
    shipObject.userData.isRuntimeOnly = true;
    this.target.add(shipObject);
    this.ship = shipObject;
  }

  let reticleRef = this.getAttribute("reticleImage");
  if (!reticleRef) {
    reticleRef = await this.erth.asset.image.findByName("Reticle");
  }
  if (reticleRef) {
    this.reticleTexture = await this.erth.asset.image.createTexture(reticleRef);
  }

  let fireRef = this.getAttribute("fireSound");
  if (!fireRef) {
    fireRef = await this.erth.asset.audio.findByName("LaserFire");
  }
  if (fireRef) {
    this.fireSoundUrl = await this.erth.asset.audio.getUrl(fireRef);
  }
};
```

Prefer passing an `AssetRef` into `createInstance()`, `createTexture()`, or `getUrl()`. `getUrlByName()` still exists for audio/video/file/script assets, but behavior attributes and `findByName()` keep the asset dependency explicit.

### Store as a lightweight blackboard

Vehicle games and HUD-heavy arcade games use `erth.store` to share numbers between independent behaviors without introducing hard references. Keep the values plain and overwrite them as state changes.

```ts
// Vehicle controller behavior
this.update = function () {
  this.erth.store.set("car.telemetry", {
    speed: this.speed,
    drift: this.driftAmount,
    boost: this.boostActive,
  });
};
```

```ts
// Audio or HUD behavior
this.update = function () {
  const telemetry = this.erth.store.get("car.telemetry") ?? {};
  const speed = telemetry.speed ?? 0;
  const drift = telemetry.drift ?? 0;

  this.speedText?.setProperties({text: `${Math.round(speed)} km/h`});
  this.engineGain = THREE.MathUtils.lerp(0.35, 1.0, Math.min(speed / 140, 1));
  this.driftGain = Math.min(drift, 1);
};
```

For cross-client or authoritative state, use the multiplayer systems instead. The store is local to one running game session.

### Engine topic subscription with cleanup

Menu and lobby behaviors can react to engine topics such as `game.loginSuccess`, then tear down the subscription when the behavior is disposed.

```ts
this.onStart = function () {
  this.offLogin = this.erth.events.on("game.loginSuccess", (_topic, user) => {
    this.erth.store.set("player.profile", {
      id: user?.id,
      name: user?.displayName ?? "Player",
    });
    this.showLobby();
  });
};

this.dispose = function () {
  this.offLogin?.();
  this.offLogin = null;
};
```

Use targeted behavior events for object-to-object gameplay messages. Use `erth.events.on()` for engine-wide topics.
