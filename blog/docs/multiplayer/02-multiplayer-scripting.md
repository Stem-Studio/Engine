---
title: Multiplayer Scripting
slug: multiplayer-scripting
description: Learn how to write behaviors that work correctly in multiplayer, including synced state, host-only logic, and common patterns.
status: draft
audience: technical-creators
prerequisites: [multiplayer/01-multiplayer-overview, scripting/01-behaviors-vs-lambdas]
---

# Multiplayer Scripting

Writing multiplayer-safe behaviors requires thinking about which client runs which logic, what state needs to be shared, and how to respond to state changes from other clients. This page covers the patterns and tools you need to write behaviors that work correctly in multiplayer sessions.

## What This Page Is For

Use this page when you need to answer questions like:

- How do I sync custom state across clients?
- What runs on all clients vs only on the host?
- How do I respond to state changes from other clients?
- What syncs automatically and what requires manual sync?
- How do I test multiplayer behavior locally?

## The Core Idea

In single-player, a behavior can read and write state freely. There is one simulation, one physics engine, one scene graph.

In multiplayer, there are multiple clients running the same behaviors. If every client computes the same logic independently, the results will drift apart. The solution is a pattern where:

1. **The host computes** authoritative state
2. **The host writes** that state to the room via `setBehaviorData`
3. **Other clients receive** the update via `onStateUpdated`
4. **Other clients apply** the new state to their local scene

## BehaviorDataStorage

`BehaviorDataStorage` is the mechanism for synchronizing custom behavior state across all clients. It stores string key-value pairs organized by object UUID and behavior ID.

### Writing Data (Host)

```ts
this.multiplayerState?.setBehaviorData(
    this.target,           // the object this data belongs to
    this.id,               // the behavior ID (e.g., "erth.platform")
    "position",            // the key
    JSON.stringify(pos)    // the value (must be a string)
);
```

### Reading Data

```ts
const value = this.multiplayerState?.getBehaviorData(
    this.target,
    this.id,
    "position"
);
if (value) {
    const pos = JSON.parse(value);
}
```

### Receiving Updates (Non-Host Clients)

When synced behavior data changes, the behavior's `onStateUpdated` method is called:

```ts
onStateUpdated(key: string, value: string | undefined): void {
    // Called on every client when behavior data is updated
    // The host usually ignores this since it already has the data

    if (this.multiplayerState?.isHost()) {
        return; // Host already knows the state
    }

    switch (key) {
        case "position":
            if (value) {
                const pos = JSON.parse(value);
                this.target.position.set(pos.x, pos.y, pos.z);
            }
            break;
        case "rotation":
            if (value) {
                const rot = JSON.parse(value);
                this.target.rotation.set(rot.x, rot.y, rot.z);
            }
            break;
    }
}
```

### Data Structure

```
behaviorData (room state)
  -> "object-uuid-123"               (object UUID)
    -> "erth.platform"               (behavior ID)
      -> "position": "{x:1,y:2,z:3}" (key-value pair)
      -> "rotation": "{x:0,y:1,z:0}" (key-value pair)
    -> "erth.enemy"                   (another behavior on the same object)
      -> "health": "80"
      -> "state": "chasing"
```

## What Syncs Automatically vs What Needs Manual Sync

### Automatically Synchronized

These are handled by the multiplayer system without any behavior code:

| Data | How It Syncs |
|------|-------------|
| **Object transforms** | Position, rotation, scale sync through physics with debouncing |
| **Object visibility** | Synced through room state |
| **Object materials** | Color, opacity, emissive synced through room state |
| **Player state** | Name, slot, UUID, animation synced automatically |
| **Game state** | Score and ended flag synced across all clients |
| **Animations** | `setCurrentAnimation` broadcasts to all clients |

### Requires Manual Sync (BehaviorDataStorage)

These require you to use `setBehaviorData` and `onStateUpdated`:

| Data | Why Manual |
|------|-----------|
| **Custom behavior state** | Health, inventory, AI state, timers |
| **Behavior-driven transforms** | Tweened positions, procedural movement |
| **Game logic state** | Spawn timers, wave counters, phase transitions |
| **Object state beyond physics** | Doors open/closed, lights on/off, counters |

## Host-Only Logic Patterns

### The Basic Host Guard

The most common multiplayer pattern is the host guard:

```ts
update(deltaTime: number): void {
    // Only the host runs this expensive computation
    if (!this.multiplayerState || this.multiplayerState.isHost()) {
        this.computeNewState(deltaTime);
    }

    // All clients apply visual updates
    this.applyVisuals();
}
```

Note the condition: `!this.multiplayerState || this.multiplayerState.isHost()`. When `multiplayerState` is null (single-player mode), the logic still runs. When multiplayer is active, only the host executes.

### Real-World Example: Moving Platform

Here is the pattern used by the built-in PlatformBehavior:

```ts
class PlatformBehavior extends BehaviorBase {
    private multiplayerState?: IMultiplayerState | null = null;

    init(game: GameManager): void {
        this.multiplayerState = game.multiplayerState;
    }

    update(deltaTime: number): void {
        // Only the host computes the tween movement
        if (!this.multiplayerState || this.multiplayerState.isHost()) {
            this.tweenGroup.update();
        }

        // All clients do local visual work (player speed adjustment)
        this.handlePlayerOnPlatform(deltaTime);

        // Host writes the current position to synced state
        this.syncMultiplayerState();
    }

    syncMultiplayerState(): void {
        if (this.multiplayerState?.isHost()) {
            this.multiplayerState.setBehaviorData(
                this.target, this.id, "position",
                JSON.stringify(this.target.position)
            );
            this.multiplayerState.setBehaviorData(
                this.target, this.id, "rotation",
                JSON.stringify(this.target.rotation)
            );
        }
    }

    onStateUpdated(key: string, value: string | undefined): void {
        // Non-host clients apply the position update
        if (this.multiplayerState?.isHost()) {
            return;
        }

        if (key === "position" && value) {
            const pos = JSON.parse(value);
            this.target.position.set(pos.x, pos.y, pos.z);
        }
        if (key === "rotation" && value) {
            const rot = JSON.parse(value);
            this.target.rotation.set(rot.x, rot.y, rot.z);
        }
    }
}
```

The key elements:

1. **Host computes** the tween movement
2. **Host writes** position and rotation to behavior data every frame
3. **Non-host clients receive** `onStateUpdated` and apply the position directly
4. **All clients** handle local player-platform interaction

### Start Logic Only On Host

For behaviors that start actions (like spawning or movement), gate the startup:

```ts
private startMovement() {
    // Notify listeners that the platform activated
    const listeners = this.findBehaviors("platformListener");
    for (const l of listeners) {
        l.onEvent("platform.activated", this.data);
    }

    // But only the host actually runs the movement tween
    if (this.multiplayerState && !this.multiplayerState.isHost()) {
        return;
    }

    this.isStarted = true;
    // ... start tween logic
}
```

## Physics Sync Constraints

Physics in multiplayer mode runs on the **server**, not locally on each client. This has important implications:

### What This Means For Behaviors

- **Do not apply forces locally** and expect them to sync. Use the multiplayer physics API (`room.send` with physics events).
- **Object positions are authoritative on the server.** Local modifications will be overwritten by the next server update.
- **Host-driven kinematic objects** (like platforms) should write their position through behavior data, not through local physics.
- **Dynamic objects** (balls, crates) are handled by server physics and sync automatically.

### Debounce Awareness

Transform updates are debounced (position: 0.01 units, rotation: 0.5 degrees, scale: 0.01 units). This means:

- Very small movements may not be sent to other clients.
- Animations and visual-only movements that do not affect physics can run locally without syncing.
- If you need exact position sync for a behavior-driven object, use `setBehaviorData` instead of relying on transform sync.

## Common Multiplayer Patterns

### Pattern: Synced Timer

```ts
private timer: number = 0;
private readonly INTERVAL = 5; // seconds

update(deltaTime: number): void {
    if (!this.multiplayerState || this.multiplayerState.isHost()) {
        this.timer += deltaTime;
        if (this.timer >= this.INTERVAL) {
            this.timer = 0;
            this.onTimerFired();
            this.multiplayerState?.setBehaviorData(
                this.target, this.id, "timerEvent",
                Date.now().toString()
            );
        }
    }
}

onStateUpdated(key: string, value: string | undefined): void {
    if (key === "timerEvent" && !this.multiplayerState?.isHost()) {
        this.onTimerFired();
    }
}

private onTimerFired(): void {
    // Runs on all clients when the timer fires
}
```

### Pattern: Per-Player Data

Use the player data system for state that belongs to individual players:

```ts
// Set data for the local player
this.multiplayerState?.setPlayerData("team", "red");
this.multiplayerState?.setPlayerData("score", "150");

// Listen for changes from any player
const token = this.multiplayerState?.addOnPlayerDataChangedListener(
    (player, key) => {
        console.log(`${player.name} set ${key} to ${player.data.get(key)}`);
    }
);
```

### Pattern: Host Migration Safety

When the host changes, behaviors need to handle the transition:

```ts
init(game: GameManager): void {
    this.multiplayerState = game.multiplayerState;

    this.hostChangeToken = this.multiplayerState?.addOnHostChangedListener(() => {
        if (this.multiplayerState?.isHost()) {
            // I am the new host -- start running authoritative logic
            this.startHostLogic();
        }
    });
}

dispose(): void {
    if (this.hostChangeToken) {
        this.multiplayerState?.removeOnHostChangedListener(this.hostChangeToken);
    }
}
```

### Pattern: Synced Object State

For objects with complex state (like a door that can be open or closed):

```ts
// Host toggles the door
private toggleDoor(): void {
    this.isOpen = !this.isOpen;
    this.applyDoorState();
    this.multiplayerState?.setBehaviorData(
        this.target, this.id, "isOpen",
        this.isOpen.toString()
    );
}

// All clients respond
onStateUpdated(key: string, value: string | undefined): void {
    if (this.multiplayerState?.isHost()) return;

    if (key === "isOpen") {
        this.isOpen = value === "true";
        this.applyDoorState();
    }
}

private applyDoorState(): void {
    // Visual update that runs on all clients
    if (this.isOpen) {
        // Animate door opening
    } else {
        // Animate door closing
    }
}
```

## What To Avoid

### Do Not Rely On Local Random Values

If the host generates a random number and uses it for gameplay, other clients will generate a different random number. Always sync random results through behavior data.

Bad:

```ts
update(deltaTime: number): void {
    // Every client gets a different random position
    const x = Math.random() * 10;
    this.target.position.x = x;
}
```

Good:

```ts
update(deltaTime: number): void {
    if (this.multiplayerState?.isHost()) {
        const x = Math.random() * 10;
        this.multiplayerState.setBehaviorData(
            this.target, this.id, "posX", x.toString()
        );
    }
}

onStateUpdated(key: string, value: string | undefined): void {
    if (key === "posX" && value && !this.multiplayerState?.isHost()) {
        this.target.position.x = parseFloat(value);
    }
}
```

### Do Not Forget To Clean Up Listeners

Always remove multiplayer listeners in `dispose()`:

```ts
dispose(): void {
    if (this.playerAddedToken) {
        this.multiplayerState?.removeOnPlayerAddedListener(this.playerAddedToken);
    }
    if (this.hostChangeToken) {
        this.multiplayerState?.removeOnHostChangedListener(this.hostChangeToken);
    }
}
```

### Do Not Sync Every Frame Unnecessarily

Only write to `setBehaviorData` when the value has actually changed. Syncing unchanged state every frame wastes bandwidth:

```ts
syncMultiplayerState(): void {
    if (!this.multiplayerState?.isHost()) return;

    const newPos = JSON.stringify(this.target.position);
    if (newPos !== this.lastSyncedPosition) {
        this.lastSyncedPosition = newPos;
        this.multiplayerState.setBehaviorData(
            this.target, this.id, "position", newPos
        );
    }
}
```

### Do Not Assume Client Count

Your behavior should work with 1 player or 4 players (or whatever the max is). Do not hardcode player counts or indices.

## Testing Multiplayer

### Method 1: Two Browser Tabs

1. Start the local Colyseus sidecar and press Play in the editor.
2. Open the same local project in a second browser tab and press Play.
3. Both tabs connect to the same Colyseus room.
4. The first tab becomes the host; the second tab joins as a client.

### Method 2: Regular Window Plus Incognito

1. Open the game in a regular browser window.
2. Open the same URL in an incognito/private window.
3. This provides an isolated browser context; Playground accounts are not
   involved.

### What To Verify

When testing multiplayer behaviors:

- [ ] Host logic runs only on the host tab
- [ ] Non-host clients receive and apply state updates correctly
- [ ] Closing the host tab triggers host migration
- [ ] The new host picks up host-only logic
- [ ] Player join and leave are handled cleanly
- [ ] No race conditions on rapid state changes
- [ ] Single-player mode still works (when `multiplayerState` is null)

## Decision Guide: Where Should This State Live?

| State Type | Storage | Why |
|-----------|---------|-----|
| Object transform | Automatic (physics) | Synced automatically by the multiplayer proxy |
| Behavior-driven movement | `setBehaviorData` | Host computes, clients apply |
| Game score | `gameState.score` | Built-in game state |
| Per-player info | `setPlayerData` | Each player can write their own data |
| Spawn timers | `setBehaviorData` | Host runs timer, syncs events |
| Door open/closed | `setBehaviorData` | Host toggles, all clients animate |
| Visual-only effects | Local only | Particles, screen shake -- no sync needed |
| UI state | Local only | Each player has their own UI |

## Next Steps

- Read [Multiplayer Overview](01-multiplayer-overview.md) for the room model and architecture.
- Read [Communication Patterns](../scripting/04-communication-patterns.md) for behavior communication patterns that complement multiplayer sync.
- Read [Writing Behaviors](../scripting/02-writing-behaviors.md) for the behavior lifecycle in detail.
