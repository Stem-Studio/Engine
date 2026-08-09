---
title: Rendering and Performance
slug: post-processing
description: Quality presets, post-processing effects, shadow settings, physics options, and behavior performance tuning.
status: current
audience: technical-creators
prerequisites: [editor/04-project-settings]
---

# Rendering and Performance

The Rendering & Performance panel lets you control visual quality, post-processing effects, shadow behavior, physics settings, and behavior optimization. These settings affect how your game looks and performs across different devices.

## How To Access

1. Open the **Project** tab in the left panel.
2. Select the **Rendering & Performance** section.

---

## Quality Presets

Quality presets are named groups of target settings. The current preset
registry includes general, desktop, Apple Silicon, iOS, and Android lanes.
Choose a conservative preset, measure the actual project in play mode, and
adjust from there.

> **Implementation boundary:** a preset contains more targets than the live
> renderer currently applies. Pixel ratio and shadow mode are applied runtime
> controls. Several anti-aliasing, texture, cascade, reflection, volumetric,
> batching, and culling fields remain policy metadata or are owned by another
> subsystem. Do not document or budget a feature as active merely because its
> field exists in a preset.

---

## Rendering Options

| Setting | Description |
|---------|-------------|
| **Dynamic Batching** | A policy preference; confirm the project's meshes are actually batched in renderer statistics |
| **Mesh Instancing** | A policy preference; use instanced assets/systems and verify the resulting draw-call count |

---

## Post-Processing Effects

Post-processing effects are applied after the scene is rendered to enhance visual quality.

### Ambient Occlusion (AO)

Ambient occlusion adds soft shadows in corners and crevices where light would naturally be occluded.

| Property | Type | Description |
|----------|------|-------------|
| **Enabled** | toggle | Turn AO on or off |
| **Scale** | number | Overall intensity of the AO effect |
| **Samples** | number | Number of samples per pixel. Higher = better quality, more expensive |
| **Kernel Radius** | number | Size of the sampling area around each pixel |

**Advanced AO settings:**

| Property | Type | Description |
|----------|------|-------------|
| **Resolution Scale** | number | Render AO at a fraction of screen resolution for better performance |
| **Thickness** | number | Controls how thick occluded areas appear |
| **Distance Exponent** | number | How quickly AO falls off with distance between surfaces |
| **Distance Falloff** | number | Maximum distance at which AO is computed |

### Bloom

Bloom creates a glow effect around bright areas of the scene.

| Property | Type | Description |
|----------|------|-------------|
| **Enabled** | toggle | Turn bloom on or off |
| **Strength** | number | Intensity of the bloom glow |
| **Radius** | number | How far the glow spreads from bright areas |
| **Threshold** | number | Minimum brightness level that triggers the bloom effect |

---

## Shadows (CSM)

Cascaded Shadow Maps (CSM) settings control how directional light shadows are rendered across the scene.

| Property | Type | Description |
|----------|------|-------------|
| **Fade** | toggle | Retained/stored CSM setting; it is not currently wired to the live CSM node |
| **Mode** | dropdown | Distribution of shadow cascades: **Uniform**, **Logarithmic**, or **Practical** |
| **Cascades** | number | Number of shadow cascade levels (more = better quality at distance, higher cost) |
| **Light Margin** | number | Extra space around the shadow camera frustum |

---

## Graphics API

The runtime prefers WebGPU. **Force WebGL** requests Three.js's WebGL backend,
and WebGPU initialization failure automatically retries through that
compatibility path. Renderer-specific post-processing may be reduced or
unavailable, so verify every enabled effect after a fallback.

---

## Physics

| Setting | Description |
|---------|-------------|
| **Sleeping** | Allows physics bodies at rest to stop simulating, improving performance |
| **Multi-Threaded** | Requests the backend's worker/thread path where the selected engine and browser support it; verify behavior on the deployment's cross-origin isolation setup |

---

## Scheduler

| Setting | Description |
|---------|-------------|
| **Runtime Frame Budget** | Sets the per-frame budget used by active behavior and lambda update loops |
| **Fixed Rate Metadata** | Retained for older scenes and APIs; the retired FrameOrchestrator controls are no longer exposed |

---

## Behavior Performance

These settings control how behaviors are optimized at runtime to maintain frame rates.

| Setting | Description |
|---------|-------------|
| **Off-Screen Optimization** | Behaviors on objects outside the camera view are updated less frequently |
| **Distance Throttling** | Behaviors on distant objects are updated less frequently based on distance from the camera |
| **Update Priority** | Each behavior declares a priority level (Critical, High, Medium, Low, Minimal) that determines how aggressively it can be throttled |
| **Distance Thresholds** | Configure the distances at which behaviors switch from full-rate to throttled updates |

### Throttle Priority Levels

| Priority | Throttling Behavior | Example Use Cases |
|----------|--------------------|--------------------|
| **Critical** | Never throttled | Player movement, core mechanics |
| **High** | Rarely throttled | AI, interactions |
| **Medium** | Moderately throttled | Animations, visual effects |
| **Low** | Aggressively throttled | Ambient sounds, environment |
| **Minimal** | Most aggressive throttling | Debug, metrics, background tasks |

---

## Tips

- **Start with a conservative preset**, then verify actual renderer statistics
  and frame time in play mode.
- **Disable post-processing on mobile** for significant performance gains.
- **Reduce shadow cascades** from 4 to 2 if shadows are causing frame rate drops.
- **Enable physics sleeping** to prevent idle objects from consuming simulation time.
- **Use distance throttling** for suitable non-critical behaviors in large
  scenes, and verify that gameplay remains correct.
- **Measure effects individually.** A checked UI field or preset entry is not
  proof that a rendering pass is active.

## Next Steps

- Configure project-level settings in [Project Settings](04-project-settings.md).
- Learn about the specialized VFX and animation editors in [Specialized Editors](07-specialized-editors.md).
- Optimize your scene by reducing draw calls, lowering shadow resolution, and disabling expensive effects on complex scenes.
