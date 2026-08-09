# Genre Playbook: Racing / Kart

## Preserve First

- vehicle handling feel
- steering response
- drift, boost, traction, and surface behavior
- race progression and checkpoints
- chase camera feel

## Stem Defaults

- use built-ins only when they truly match the handling model
- racing cameras often need custom behavior
- touch controls are usually appropriate with steering wheel or racing-specific layout

## When Custom Code Is Likely Needed

- arcade handling
- drift systems
- boost zones and checkpoint logic
- custom camera follow and look-ahead
- suspension or ground-sampling behavior

## Physics

See `~/.claude/stemstudio-docs/physics-system.md` "Physics Defaults by Genre" — row `racing-kart`. Summary:

- **Gravity:** `-9.81` (Earth-like).
- **Engine choice:** `ammo` (default) or `rapier`. Set the engine via `set_physics_engine` (`stemstudio-physics` skill).
- **Vehicle body type — pick one:**
  - **Arcade racer (custom controller writes position):** `Kinematic` box chassis. Engine doesn't apply gravity; controller owns ground sampling. Raycast ground logic is acceptable here.
  - **Sim racer:** `Dynamic` chassis with `addVehicleObject` on Ammo.
- **Track:** `Static` `concaveHull`. `bounciness_preset:"Ground"`. Use `"Slippery Ground"` for drift zones, `"Ice"` for hazard patches.
- **Material zone trick:** invisible `Static` `box` triggers over surface variants; switch friction logic on `on_enter`.
- **Pitfall:** `Dynamic` body + manual position writes → engine gravity fights controller → kart sinks/jitters. Either fully `Kinematic` or fully `Dynamic`; do not mix.

## Touch

Use the built-in `touchControls` behavior plus `game.inputManager` patterns, usually steering wheel + action button.

## Ask the User When

- handling feel would materially change
- drift/boost systems require a major approximation
- camera behavior is tightly coupled to speed feel

---

## Building From Scratch (Creation Mode)

- **Minimum viable scene:** player kart, track (ground plane or imported track model), 3 checkpoints, start/finish line
- **Essential behaviors/lambdas:** custom vehicle controller behavior (no built-in kart physics), `trigger` for checkpoints, `touchControls` for mobile
- **Custom needed:** vehicle physics (drift, acceleration), race manager (lap tracking, timer), camera follow behavior
- **Asset requirements:** kart model, track model, checkpoint markers, skybox
- **Recommended built-ins:** `trigger`, `genericSound`, `touchControls`, `jumppad` (for boost pads), `randomizedSpawner` (for item pickups)

## Common Pitfalls

1. Using built-in `character` for kart — it's designed for humanoid movement, not vehicle physics
2. Camera too sluggish on turns — racing needs responsive camera with look-ahead
3. Physics timestep inconsistency — use `fixedUpdate` for vehicle physics, not `update`
4. Checkpoint order not enforced — players can skip checkpoints without proper sequence tracking
5. Missing drift feel — drift mechanics need careful tuning of angular velocity and grip recovery

## Configurable Parameter Templates

| Parameter | Type | Default | Range | Description |
|-----------|------|---------|-------|-------------|
| topSpeed | number | 30 | 10-100 | Maximum vehicle speed |
| acceleration | number | 15 | 5-50 | Forward acceleration |
| brakeForce | number | 20 | 5-50 | Braking deceleration |
| turnSpeed | number | 2.5 | 0.5-5 | Steering sensitivity |
| driftFactor | number | 0.8 | 0-1 | Lateral grip (0=ice, 1=full grip) |
| cameraLookAhead | number | 5 | 0-15 | Camera look-ahead distance |
| totalLaps | number | 3 | 1-10 | Laps to complete race |

## Built-in Behaviors to Use

| Need | Built-in ID | Config Notes |
|------|-------------|--------------|
| Checkpoints | `trigger` | Configure sequence validation |
| Sound effects | `genericSound` | Engine sound, drift SFX |
| Touch controls | `touchControls` | Steering + accelerate/brake |
| Boost pads | `jumppad` | Use strengthMode for speed boost |
| Item spawns | `randomizedSpawner` | Randomize item pickups |
