# EARTH_animation_graph glTF Extension

## Overview

The `EARTH_animation_graph` extension allows complex animation state machines to be stored and loaded from glTF files. This extension preserves animation graphs, including states, transitions, parameters, and blend trees, enabling sophisticated animation systems to be shared across different applications.

## Extension Details

- **Extension Name**: `EARTH_animation_graph`
- **Extension Version**: 1.0
- **Vendor**: Erth AI, Inc.

## Data Structure

The extension stores the following data in the glTF file:

```json
{
    "extensions": {
        "EARTH_animation_graph": {
            "animationGraph": "string" // JSON string of the animation graph
        }
    }
}
```

### Fields

- **animationGraph**: A JSON string containing the serialized animation graph data, including:
    - States (AnimationState and BlendTreeState)
    - Transitions between states
    - Parameters (float, int, bool, trigger)
    - Current state information
    - State positions for visual editors
    - Clip names (stored within the graph serialization)

## Usage

### Exporting with Animation Graph

```typescript
import {GLTFExporter} from "three/addons/exporters/GLTFExporter";
import {EARTHAnimationGraphExporterPlugin} from "./extensions/EARTHAnimationGraphExporterPlugin";

const exporter = new GLTFExporter();

// Register the EARTH_animation_graph extension plugin using the proper callback pattern
if (animationGraph && animations.length > 0) {
    exporter.register(writer => {
        const plugin = new EARTHAnimationGraphExporterPlugin(writer);
        plugin.setAnimationData(animationGraph, animations);
        return plugin;
    });
}

// Export the model
exporter.parse(
    model,
    result => {
        // result will include the EARTH_animation_graph extension
    },
    undefined,
    {includeCustomExtensions: true},
);
```

### Loading with Animation Graph

```typescript
import {GLTFLoader} from "three/addons/loaders/GLTFLoader";
import {EARTHAnimationGraphLoaderPlugin} from "./extensions/EARTHAnimationGraphLoaderPlugin";

const loader = new GLTFLoader();
loader.register(parser => new EARTHAnimationGraphLoaderPlugin(parser));

loader.load("model.gltf", result => {
    // Check if animation graph was loaded
    if (result.animationGraph) {
        console.log("Animation graph loaded:", result.animationGraph);
        console.log("Animation clips:", result.animationGraphClips);
    }
});
```

### Using the AnimationGraphLoader Utility

```typescript
import {AnimationGraphLoader} from "./utils/AnimationGraphLoader";

// After loading a model
const {graph, clips} = AnimationGraphLoader.extractAnimationGraph(model);

if (graph) {
    // Use the loaded animation graph
    graph.setState("Idle");
    graph.update(deltaTime);
}

// Check if model has animation graph
if (AnimationGraphLoader.hasAnimationGraph(model)) {
    console.log("Model contains animation graph");
}
```

## Implementation Details

### Exporter Plugin

The `EARTHAnimationGraphExporterPlugin` implements the `GLTFExporterPlugin` interface:

- **beforeParse**: No specific setup required
- **afterParse**: Serializes the animation graph and adds it to the glTF JSON
- **setAnimationData**: Sets the animation graph and clips to be exported

### Loader Plugin

The `EARTHAnimationGraphLoaderPlugin` implements the `GLTFLoaderPlugin` interface:

- **afterRoot**: Processes the extension data and deserializes the animation graph
- Creates a clip map from loaded animations to resolve clip references
- Stores the loaded graph in `result.animationGraph` and clips in `result.animationGraphClips`

### Extension Class

The `EARTHAnimationGraphExtension` class provides:

- **serialize**: Converts animation graph to extension data (clip names are already included in the graph serialization)
- **deserialize**: Reconstructs animation graph from extension data using a clip map created from loaded animations
- **validate**: Validates extension data structure

## Integration

The extension is automatically integrated into:

1. **Export Component**: The `Export.tsx` component automatically includes animation graph data when exporting glTF/GLB files using `exporter.register()`
2. **Model Loader**: The `GLTFLoader.js` automatically registers the loader plugin and extracts animation graph data from loaded models

## Compatibility

- Compatible with glTF 2.0
- Works with both .gltf and .glb formats
- Preserves all animation graph functionality including blend trees and complex transitions
- Backward compatible - models without the extension load normally

## Example

A complete animation graph with states, transitions, and parameters will be preserved:

```typescript
// Original graph
const graph = new AnimationGraph(model);
graph.addState(new AnimationState("Idle", "Idle", idleClip));
graph.addState(new AnimationState("Walk", "Walk", walkClip));
graph.addParameter("speed", "float", 0);
graph.addTransition("Idle", "Walk", [{parameter: "speed", operator: "greater", value: 0.1}]);

// After export/import, the graph will be identical
const loadedGraph = result.animationGraph;
loadedGraph.getStates(); // Returns the same states
loadedGraph.getParameters(); // Returns the same parameters
```

## Design Notes

The extension is designed to be minimal and efficient:

- **No redundant data**: Clip names are already stored within the animation graph serialization
- **Automatic clip resolution**: The loader creates a clip map from loaded animations to resolve references
- **Simple structure**: Only the animation graph JSON is stored, reducing file size and complexity
- **Proper plugin registration**: Uses the standard `exporter.register()` callback pattern for integration
