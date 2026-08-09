/**
 * Help text content for the script-tool terminal.
 * Organized by category for the `help` and `help <category>` commands.
 *
 * Parameter details are embedded here (mirrored from CommandsRegistry) to avoid
 * importing CommandsRegistry which pulls in Three.js and breaks unit tests.
 */

import {isScriptsEnabled} from "../../utils/featureFlags";

export interface HelpEntry {
    syntax: string;
    description: string;
}

export interface HelpCategory {
    name: string;
    description: string;
    entries: HelpEntry[];
}

export interface ParamInfo {
    name: string;
    type: string;
    required: boolean;
    description: string;
    default?: string;
}

export interface CommandHelp {
    /** The registry command name */
    registryCommand: string;
    description: string;
    params: ParamInfo[];
    examples?: string[];
}

/**
 * Detailed parameter help for each command, keyed by shorthand names.
 * Multiple shorthand keys can point to the same underlying registry command.
 */
const COMMAND_PARAMS: Record<string, CommandHelp> = {
    // --- Object creation ---
    "add box": {
        registryCommand: "create_primitive",
        description: "Create a box primitive in the scene",
        params: [
            {name: "name", type: "string", required: false, description: "Name for the object"},
            {name: "position", type: "x,y,z", required: false, description: "Position {x, y, z}"},
            {name: "size", type: "x,y,z", required: false, description: "Geometry dimensions {width, height, depth}. Sets actual geometry size."},
            {name: "widthSegments", type: "number", required: false, description: "Optional width subdivision count. Prefer enough segments that each span stays near or below 1000 m on huge primitives."},
            {name: "heightSegments", type: "number", required: false, description: "Optional height subdivision count. Prefer enough segments that each span stays near or below 1000 m on huge primitives."},
            {name: "depthSegments", type: "number", required: false, description: "Optional depth subdivision count for boxes."},
            {name: "scale", type: "x,y,z", required: false, description: "Scale {x, y, z}"},
            {name: "rotation", type: "x,y,z", required: false, description: "Rotation {x, y, z} in radians"},
            {name: "color", type: "string", required: false, description: "Hex color (e.g., '#ff0000')"},
            {name: "parent", type: "string", required: false, description: "Parent object name or UUID"},
            {name: "objectSettings", type: "object", required: false, description: "{ isBatchable, isStatic, isSelectable, enableAtStart, visibleByAI, gameVisibility, EnableMorphing }"},
        ],
        examples: [
            'add box position=0,1,0 color=#ff0000 name="RedBox"',
            'add box name="Ground" size=128,0.1,128 position=0,-0.05,0',
            'add box name="MegaWall" size=4000,20,200 widthSegments=4',
        ],
    },
    "add sphere": {
        registryCommand: "create_primitive",
        description: "Create a sphere primitive in the scene",
        params: [
            {name: "name", type: "string", required: false, description: "Name for the object"},
            {name: "position", type: "x,y,z", required: false, description: "Position {x, y, z}"},
            {name: "size", type: "x,y,z", required: false, description: "Geometry dimensions {diameter, -, -}. x sets diameter."},
            {name: "widthSegments", type: "number", required: false, description: "Optional horizontal subdivision count."},
            {name: "heightSegments", type: "number", required: false, description: "Optional vertical subdivision count."},
            {name: "scale", type: "x,y,z", required: false, description: "Scale {x, y, z}"},
            {name: "rotation", type: "x,y,z", required: false, description: "Rotation {x, y, z} in radians"},
            {name: "color", type: "string", required: false, description: "Hex color"},
            {name: "parent", type: "string", required: false, description: "Parent object name or UUID"},
        ],
        examples: ["add sphere position=0,2,0 color=#00ff00"],
    },
    "add cylinder": {
        registryCommand: "create_primitive",
        description: "Create a cylinder primitive in the scene",
        params: [
            {name: "name", type: "string", required: false, description: "Name for the object"},
            {name: "position", type: "x,y,z", required: false, description: "Position {x, y, z}"},
            {name: "size", type: "x,y,z", required: false, description: "Geometry dimensions {diameter, height, -}. x=diameter, y=height."},
            {name: "radialSegments", type: "number", required: false, description: "Optional radial subdivision count."},
            {name: "heightSegments", type: "number", required: false, description: "Optional height subdivision count."},
            {name: "scale", type: "x,y,z", required: false, description: "Scale {x, y, z}"},
            {name: "rotation", type: "x,y,z", required: false, description: "Rotation {x, y, z} in radians"},
            {name: "color", type: "string", required: false, description: "Hex color"},
            {name: "parent", type: "string", required: false, description: "Parent object name or UUID"},
        ],
        examples: ["add cylinder position=0,1,0 size=1,2,1"],
    },
    "add cone": {
        registryCommand: "create_primitive",
        description: "Create a cone primitive",
        params: [
            {name: "name", type: "string", required: false, description: "Name for the object"},
            {name: "position", type: "x,y,z", required: false, description: "Position {x, y, z}"},
            {name: "size", type: "x,y,z", required: false, description: "Geometry dimensions {diameter, height, -}. x=diameter, y=height."},
            {name: "radialSegments", type: "number", required: false, description: "Optional radial subdivision count."},
            {name: "heightSegments", type: "number", required: false, description: "Optional height subdivision count."},
            {name: "scale", type: "x,y,z", required: false, description: "Scale {x, y, z}"},
            {name: "color", type: "string", required: false, description: "Hex color"},
            {name: "parent", type: "string", required: false, description: "Parent object name or UUID"},
        ],
        examples: ["add cone position=0,1,0 color=#ffaa00"],
    },
    "add plane": {
        registryCommand: "create_primitive",
        description: "Create a plane primitive",
        params: [
            {name: "name", type: "string", required: false, description: "Name for the object"},
            {name: "position", type: "x,y,z", required: false, description: "Position {x, y, z}"},
            {name: "size", type: "x,y,z", required: false, description: "Geometry dimensions {width, -, depth}. x=width, z=depth."},
            {name: "widthSegments", type: "number", required: false, description: "Optional width subdivision count. For very large planes, use enough segments to keep each span near or below 1000 m."},
            {name: "heightSegments", type: "number", required: false, description: "Optional depth subdivision count for planes."},
            {name: "scale", type: "x,y,z", required: false, description: "Scale {x, y, z}"},
            {name: "rotation", type: "x,y,z", required: false, description: "Rotation {x, y, z} in radians"},
            {name: "color", type: "string", required: false, description: "Hex color"},
            {name: "parent", type: "string", required: false, description: "Parent object name or UUID"},
        ],
        examples: ["add plane position=0,0,0 size=10,1,10", 'add plane name="MegaTerrain" size=4000,1,3000 widthSegments=4 heightSegments=3'],
    },
    "add torus": {
        registryCommand: "create_primitive",
        description: "Create a torus primitive",
        params: [
            {name: "name", type: "string", required: false, description: "Name for the object"},
            {name: "position", type: "x,y,z", required: false, description: "Position {x, y, z}"},
            {name: "size", type: "x,y,z", required: false, description: "Geometry dimensions {outerDiameter, tubeDiameter, -}. x=outer, y=tube."},
            {name: "radialSegments", type: "number", required: false, description: "Optional radial subdivision count."},
            {name: "tubularSegments", type: "number", required: false, description: "Optional tubular subdivision count."},
            {name: "scale", type: "x,y,z", required: false, description: "Scale {x, y, z}"},
            {name: "color", type: "string", required: false, description: "Hex color"},
            {name: "parent", type: "string", required: false, description: "Parent object name or UUID"},
        ],
        examples: ["add torus position=0,2,0 color=#ff00ff"],
    },
    "add capsule": {
        registryCommand: "create_primitive",
        description: "Create a capsule primitive",
        params: [
            {name: "name", type: "string", required: false, description: "Name for the object"},
            {name: "position", type: "x,y,z", required: false, description: "Position {x, y, z}"},
            {name: "size", type: "x,y,z", required: false, description: "Geometry dimensions {diameter, length, -}. x=diameter, y=length."},
            {name: "radialSegments", type: "number", required: false, description: "Optional radial subdivision count."},
            {name: "capSegments", type: "number", required: false, description: "Optional cap subdivision count."},
            {name: "scale", type: "x,y,z", required: false, description: "Scale {x, y, z}"},
            {name: "color", type: "string", required: false, description: "Hex color"},
            {name: "parent", type: "string", required: false, description: "Parent object name or UUID"},
        ],
        examples: ["add capsule position=0,1,0 color=#4488ff"],
    },
    "add group": {
        registryCommand: "create_group",
        description: "Create an empty group container for organizing objects",
        params: [
            {name: "name", type: "string", required: false, description: "Name for the group"},
            {name: "position", type: "x,y,z", required: false, description: "Position {x, y, z}"},
            {name: "scale", type: "x,y,z", required: false, description: "Scale {x, y, z}"},
            {name: "rotation", type: "x,y,z", required: false, description: "Rotation {x, y, z} in radians"},
            {name: "parent", type: "string", required: false, description: "Parent object name or UUID"},
        ],
        examples: ['add group name="Obstacles"'],
    },
    "add model": {
        registryCommand: "add_model_to_scene",
        description: "Add a 3D model from an external provider to the scene",
        params: [
            {name: "id", type: "string", required: true, description: "Asset ID from the external provider"},
            {name: "name", type: "string", required: true, description: "Name for the model in the scene"},
            {name: "provider", type: "string", required: true, description: "Provider: 'sketchfab', 'polyhaven', 'meshy', or 'local'"},
            {name: "downloadUrl", type: "string", required: true, description: "Download URL for the model"},
            {name: "position", type: "x,y,z", required: false, description: "Position {x, y, z}"},
            {name: "width", type: "number", required: false, description: "Width of the model (default: 1)"},
            {name: "height", type: "number", required: false, description: "Height of the model (default: 1)"},
            {name: "parent", type: "string", required: false, description: "Parent object name or UUID"},
        ],
        examples: ['add model id=abc123 name="Tree" provider=local downloadUrl=/assets/tree.glb'],
    },
    "add prefab": {
        registryCommand: "add_prefab_to_scene",
        description: "Add a prefab instance to the scene",
        params: [
            {name: "id", type: "string", required: true, description: "ID of the prefab to add"},
            {name: "position", type: "x,y,z", required: false, description: "Position {x, y, z}"},
            {name: "name", type: "string", required: false, description: "Name for the prefab instance"},
        ],
        examples: ["add prefab id=abc123 position=5,0,0"],
    },

    // --- Object manipulation ---
    update: {
        registryCommand: "modify_object",
        description: "Modify properties of an existing object",
        params: [
            {name: "<target>", type: "string", required: true, description: "Object name or UUID (first argument)"},
            {name: "position", type: "x,y,z", required: false, description: "New position {x, y, z}"},
            {name: "rotation", type: "x,y,z", required: false, description: "New rotation {x, y, z} in radians"},
            {name: "scale", type: "x,y,z", required: false, description: "New scale {x, y, z}"},
            {name: "color", type: "string", required: false, description: "New hex color"},
            {name: "name", type: "string", required: false, description: "New name"},
            {name: "tag", type: "string", required: false, description: "Tag or array of tags to add to the object (stored in userData.tags)"},
            {name: "objectSettings", type: "object", required: false, description: "{ isBatchable, isStatic, isSelectable, enableAtStart, visibleByAI, gameVisibility }"},
        ],
        examples: [
            "update MyBox position=1,3,1 color=#00ff00",
            "update Player tag=Player",
            "update MyBox --position 0,5,0 --color #ff0000",
            'update "My Box" --position 0,5,0 --color #ff0000',
        ],
    },
    delete: {
        registryCommand: "delete_object",
        description: "Delete an object from the scene",
        params: [
            {name: "<target>", type: "string", required: true, description: "Object name or UUID"},
        ],
        examples: ["delete MyBox"],
    },
    clone: {
        registryCommand: "clone_object",
        description: "Clone an existing object",
        params: [
            {name: "<target>", type: "string", required: true, description: "Object name or UUID to clone"},
            {name: "position", type: "x,y,z", required: false, description: "Position for the clone"},
        ],
        examples: ["clone MyBox position=5,0,0"],
    },
    move: {
        registryCommand: "move_object",
        description: "Move an object to a different parent in the hierarchy. keepLocalSpace=true keeps local transform after reparenting (default). keepLocalSpace=false preserves world transform.",
        params: [
            {name: "<target>", type: "string", required: true, description: "Object name or UUID to move"},
            {name: "parent", type: "string", required: true, description: "New parent name or UUID (null for scene root)"},
            {name: "keepLocalSpace", type: "boolean", required: false, description: "Default true. true: keep local transform values on reparent. false: preserve world transform."},
        ],
        examples: ["move ChildObj parent=ParentGroup", "move ChildObj parent=ParentGroup keepLocalSpace=false"],
    },

    // --- Queries ---
    "list objects": {
        registryCommand: "get_scene_objects",
        description: "List all objects in the scene",
        params: [
            {name: "filter", type: "string", required: false, description: "Filter by name pattern"},
        ],
        examples: ["list objects", "list objects filter=Wall"],
    },
    get: {
        registryCommand: "get_object",
        description: "Get detailed information about a specific object",
        params: [
            {name: "<target>", type: "string", required: true, description: "Object name or UUID"},
        ],
        examples: ["get MyBox"],
    },
    "get box": {
        registryCommand: "get_object_settings",
        description: "Get compact, script-verifiable settings for a box object. Type-specific getters fail if the object kind does not match.",
        params: [
            {name: "<target>", type: "string", required: true, description: "Object name or UUID"},
        ],
        examples: ["get box MyBox"],
    },
    "get group": {
        registryCommand: "get_object_settings",
        description: "Get compact, script-verifiable settings for a group object.",
        params: [
            {name: "<target>", type: "string", required: true, description: "Object name or UUID"},
        ],
        examples: ["get group Obstacles"],
    },
    "get material": {
        registryCommand: "get_material_settings",
        description: "Get material and texture override settings for an object.",
        params: [
            {name: "<target>", type: "string", required: true, description: "Object name or UUID"},
        ],
        examples: ["get material MyBox"],
    },
    "get physics": {
        registryCommand: "get_physics_settings",
        description: "Get physics settings stored on an object.",
        params: [
            {name: "<target>", type: "string", required: true, description: "Object name or UUID"},
        ],
        examples: ["get physics Ground"],
    },
    select: {
        registryCommand: "get_selected_object",
        description: "Get the currently selected object in the editor",
        params: [],
        examples: ["select"],
    },
    player: {
        registryCommand: "get_player",
        description: "Get the player object data",
        params: [],
        examples: ["player"],
    },

    // --- Materials ---
    material: {
        registryCommand: "set_material",
        description: "Set or modify material properties of an object",
        params: [
            {name: "<target>", type: "string", required: true, description: "Object name or UUID"},
            {name: "color", type: "string", required: false, description: "Hex color"},
            {name: "opacity", type: "number", required: false, description: "Opacity (0-1)"},
            {name: "metalness", type: "number", required: false, description: "Metalness (0-1)"},
            {name: "roughness", type: "number", required: false, description: "Roughness (0-1)"},
            {
                name: "tileAmountX",
                type: "number",
                required: false,
                description: "Texture repeat multiplier on X. Default when material settings are first created: 1",
            },
            {
                name: "tileAmountY",
                type: "number",
                required: false,
                description: "Texture repeat multiplier on Y. Default when material settings are first created: 1",
            },
            {
                name: "panningSpeedX",
                type: "number",
                required: false,
                description: "Texture offset on X. Default when material settings are first created: 1",
            },
            {
                name: "panningSpeedY",
                type: "number",
                required: false,
                description: "Texture offset on Y. Default when material settings are first created: 1",
            },
        ],
        examples: [
            "material MyBox color=#ff0000 metalness=0.8 roughness=0.2",
            "material MyBox tileAmountX=1 tileAmountY=1 panningSpeedX=1 panningSpeedY=1",
        ],
    },
    texture: {
        registryCommand: "set_texture",
        description: "Apply a texture to an object",
        params: [
            {name: "<target>", type: "string", required: true, description: "Object name or UUID"},
            {name: "textureUrl", type: "string", required: true, description: "URL to texture image"},
            {name: "textureType", type: "string", required: false, description: "'map' (color), 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'bumpMap', 'displacementMap'", default: "map"},
        ],
        examples: [
            "texture MyBox textureUrl=/textures/brick.jpg",
            "texture MyBox textureUrl=/textures/brick_normal.jpg textureType=normalMap",
            "texture MyBox textureUrl=/textures/brick_roughness.jpg textureType=roughnessMap",
        ],
    },
    "texture external": {
        registryCommand: "set_external_texture",
        description: "Apply a texture or HDRI from an external provider to an object",
        params: [
            {name: "<target>", type: "string", required: true, description: "Object name or UUID"},
            {name: "assetId", type: "string", required: true, description: "Asset ID from the external provider"},
            {name: "assetType", type: "string", required: true, description: "'textures' or 'hdris'"},
            {name: "name", type: "string", required: true, description: "Name of the texture or HDRI"},
            {name: "provider", type: "string", required: true, description: "Provider such as 'polyhaven'"},
        ],
        examples: ['texture external Ground assetId=rocky_trail assetType=textures name="Rocky Trail" provider=polyhaven'],
    },

    // --- Light ---
    light: {
        registryCommand: "set_light_properties",
        description: "Set properties on a light object (intensity, color, castShadow, shadow settings)",
        params: [
            {name: "<target>", type: "string", required: true, description: "Light object name or UUID (e.g. 'Directional')"},
            {name: "intensity", type: "number", required: false, description: "Light intensity"},
            {name: "color", type: "string", required: false, description: "Light color hex (e.g. '#ffffcc')"},
            {name: "castShadow", type: "boolean", required: false, description: "Enable shadow casting"},
            {name: "shadowMapSize", type: "number", required: false, description: "Shadow map resolution (e.g. 1024, 2048)"},
            {name: "shadowBias", type: "number", required: false, description: "Shadow bias to reduce artifacts"},
            {name: "shadowNormalBias", type: "number", required: false, description: "Shadow normal bias"},
            {name: "shadowRadius", type: "number", required: false, description: "Shadow softness radius"},
        ],
        examples: [
            'light "Directional Light" intensity=2 color=#ffffcc castShadow=true',
            'light "Directional Light" shadowMapSize=2048 shadowBias=-0.001',
        ],
    },

    // --- Physics ---
    "physics enable": {
        registryCommand: "enable_physics",
        description: "Enable physics simulation for an object",
        params: [
            {name: "<target>", type: "string", required: true, description: "Object name or UUID (must be a mesh or group, not a light or camera)"},
        ],
        examples: ["physics enable Ground"],
    },
    "physics disable": {
        registryCommand: "disable_physics",
        description: "Disable physics simulation for an object",
        params: [
            {name: "<target>", type: "string", required: true, description: "Object name or UUID (must be a mesh or group, not a light or camera)"},
        ],
        examples: ["physics disable Ground"],
    },
    "physics set": {
        registryCommand: "set_physics",
        description: "Configure detailed physics properties",
        params: [
            {name: "<target>", type: "string", required: true, description: "Object name or UUID (must be a mesh or group, not a light or camera)"},
            {name: "config", type: "object", required: true, description: "Physics config: { shape: 'box'|'sphere'|'capsule'|'convexHull'|'concaveHull' (trimesh), mass: number (0=static), friction: 0-1, restitution: 0-1 (bounciness), ctype: 'Static'|'Dynamic'|'Kinematic', bounciness_preset: 'Custom'|'Metal'|'Wood'|'Concrete'|'Ice'|'Rubber'|... (engine-tuned restitution/friction), collision_material: same labels }. Field is 'ctype' — 'bodyType' is silently ignored."},
        ],
        examples: [
            'physics set Ground config={shape:"box",mass:0,friction:0.8,ctype:"Static"}',
            'physics set Ball config={shape:"sphere",mass:1,ctype:"Dynamic",bounciness_preset:"Rubber"}',
            'physics set Terrain config={shape:"concaveHull",mass:0,ctype:"Static",bounciness_preset:"Ground"}',
        ],
    },
    "physics engine": {
        registryCommand: "set_physics_engine",
        description: "Set the scene-level physics engine (and optionally gravity). Takes effect at next scene load.",
        params: [
            {name: "<type>", type: "string", required: true, description: "Physics engine: 'ammo' (default) | 'rapier'"},
            {name: "gravity", type: "number", required: false, description: "Scene gravity on the Y axis. Negative = down (Earth-like is -9.81)"},
        ],
        examples: [
            "physics engine ammo",
            "physics engine rapier gravity=-9.81",
        ],
    },
    "scene compartments": {
        registryCommand: "set_scene_compartments",
        description: "Toggle the scene-level SES compartment sandbox for behavior/lambda scripts. Disabled by default (DOT-7463). Takes effect at next scene load.",
        params: [
            {name: "<enabled>", type: "boolean", required: true, description: "on/off or true/false"},
        ],
        examples: [
            "scene compartments on",
            "scene compartments off",
        ],
    },

    // --- Behaviors ---
    "behavior attach": {
        registryCommand: "attach_behavior",
        description: "Attach a behavior script to an object",
        params: [
            {name: "<target>", type: "string", required: true, description: "Object name or UUID"},
            {name: "behaviorId", type: "string", required: true, description: "ID of behavior to attach"},
            {name: "config", type: "object", required: false, description: "Behavior configuration parameters"},
        ],
        examples: ["behavior attach Player behaviorId=character config={speed:5,jumpForce:10}"],
    },
    "navmesh add": {
        registryCommand: "add_navmesh",
        description: "Create or configure the built-in NavMesh behavior on a scene object",
        params: [
            {name: "target", type: "string", required: false, description: "Object name or UUID that owns the navmesh (defaults to Default Scene)"},
            {name: "enabled", type: "boolean", required: false, description: "Enable navmesh generation"},
            {name: "cellSize", type: "number", required: false, description: "Horizontal navmesh precision"},
            {name: "cellHeight", type: "number", required: false, description: "Vertical navmesh precision"},
            {name: "agentHeight", type: "number", required: false, description: "Supported agent height"},
            {name: "agentRadius", type: "number", required: false, description: "Supported agent radius"},
            {name: "agentMaxClimb", type: "number", required: false, description: "Maximum climb step"},
            {name: "agentMaxSlope", type: "number", required: false, description: "Maximum walkable slope angle"},
            {name: "autoGenerate", type: "boolean", required: false, description: "Auto rebuild when the scene changes"},
            {name: "onlyPhysicsMeshes", type: "boolean", required: false, description: "Bake only physics-enabled meshes"},
            {name: "debugVisualization", type: "boolean", required: false, description: "Show navmesh debug wireframe"},
        ],
        examples: [
            "navmesh add target=\"Default Scene\" autoGenerate=true agentHeight=1.8 agentRadius=0.45 debugVisualization=false",
        ],
    },
    "navmesh rebuild": {
        registryCommand: "rebuild_navmesh",
        description: "Trigger a navmesh regeneration for the target object",
        params: [
            {name: "target", type: "string", required: false, description: "Object name or UUID that owns the navmesh (defaults to Default Scene)"},
        ],
        examples: [
            "navmesh rebuild",
            "navmesh rebuild target=\"Default Scene\"",
        ],
    },
    "navmesh connection add": {
        registryCommand: "add_navmesh_connection",
        description: "Attach a navmesh off-mesh connection from one object to another",
        params: [
            {name: "<source>", type: "string", required: true, description: "Source object name or UUID"},
            {name: "target", type: "string", required: true, description: "Destination object name or UUID"},
            {name: "enabled", type: "boolean", required: false, description: "Enable or disable the connection"},
            {name: "bidirectional", type: "boolean", required: false, description: "Allow traversal both ways"},
            {name: "radius", type: "number", required: false, description: "Connection snap/search radius"},
            {name: "showConnection", type: "boolean", required: false, description: "Show editor visualization"},
        ],
        examples: [
            "navmesh connection add RooftopStart target=RooftopEnd bidirectional=false radius=0.75",
        ],
    },
    "waypoint path add": {
        registryCommand: "add_waypoint_path",
        description: "Create or configure a waypoint path group for custom AI or patrol logic",
        params: [
            {name: "name", type: "string", required: true, description: "Waypoint path object name"},
            {name: "position", type: "x,y,z", required: false, description: "Path origin"},
            {name: "parent", type: "string", required: false, description: "Optional parent object name or UUID"},
            {name: "loop", type: "boolean", required: false, description: "Whether the path should loop"},
        ],
        examples: [
            "waypoint path add name=MarketLoop position=0,0,0 loop=true",
        ],
    },
    "waypoint add": {
        registryCommand: "add_waypoint",
        description: "Create a waypoint marker under an existing waypoint path group",
        params: [
            {name: "path", type: "string", required: true, description: "Waypoint path object name or UUID"},
            {name: "name", type: "string", required: false, description: "Waypoint object name"},
            {name: "position", type: "x,y,z", required: true, description: "Waypoint position"},
            {name: "order", type: "number", required: false, description: "Explicit waypoint order"},
            {name: "waitTime", type: "number", required: false, description: "Optional dwell time"},
            {name: "arrivalRadius", type: "number", required: false, description: "Optional arrival radius"},
        ],
        examples: [
            "waypoint add path=MarketLoop position=12,0,8 order=0 waitTime=1.5",
        ],
    },
    "behavior detach": {
        registryCommand: "detach_behavior",
        description: "Remove a behavior from an object",
        params: [
            {name: "<target>", type: "string", required: true, description: "Object name or UUID"},
            {name: "behaviorId", type: "string", required: true, description: "ID of behavior to remove"},
        ],
        examples: ["behavior detach Player behaviorId=character"],
    },
    "behavior config": {
        registryCommand: "set_behavior_config",
        description: "Update configuration for a behavior attached to an object. For trigger behaviors, use attributesData to set if_condition (array of conditions), if_operator (\"and\"|\"or\"), and then_steps (array of actions). The variable_compare condition reads from the global store (erth.store): set variablePath to the store key, variableOperator to eq|neq|lt|lte|gt|gte, and variableValue to the expected value.",
        params: [
            {name: "<target>", type: "string", required: true, description: "Object name or UUID"},
            {name: "behaviorId", type: "string", required: true, description: "ID of behavior to update"},
            {name: "attributesData", type: "object", required: false, description: "New behavior attributes configuration"},
            {name: "enabled", type: "boolean", required: false, description: "Whether the behavior is enabled"},
        ],
        examples: [
            "behavior config Player behaviorId=character attributesData={speed:10}",
            'behavior config TriggerZone behaviorId=trigger attributesData={if_condition:[{conditionType:"variable_compare",variablePath:"score",variableOperator:"gte",variableValue:"100"}],if_operator:"and"}',
        ],
    },
    "behavior list": {
        registryCommand: "list_behaviors",
        description: "List all available behaviors",
        params: [
            {name: "filter", type: "string", required: false, description: "Filter by id or name pattern"},
        ],
        examples: ["behavior list", "behavior list filter=character"],
    },
    "behavior get": {
        registryCommand: "get_behavior",
        description: "Get detailed information about a specific behavior",
        params: [
            {name: "behaviorId", type: "string", required: true, description: "ID of the behavior"},
        ],
        examples: ["behavior get behaviorId=character"],
    },
    "behavior add": {
        registryCommand: "add_behavior",
        description: "Add a new behavior to the registry",
        params: [
            {name: "name", type: "string", required: true, description: "Name of the behavior"},
            {name: "code", type: "string", required: true, description: "Behavior code/script"},
            {name: "metadata", type: "object", required: false, description: "Metadata for the behavior"},
            {name: "version", type: "string", required: false, description: "Version of the behavior"},
            {name: "description", type: "string", required: false, description: "Description of the behavior"},
            {name: "author", type: "string", required: false, description: "Author of the behavior"},
        ],
        examples: ['behavior add name="MyBehavior" code="this.update = function(dt) {}"'],
    },
    "behavior update": {
        registryCommand: "update_behavior",
        description: "Update an existing behavior, creating a new revision",
        params: [
            {name: "behaviorId", type: "string", required: true, description: "ID of the behavior to update"},
            {name: "code", type: "string", required: true, description: "Updated behavior code/script"},
            {name: "name", type: "string", required: false, description: "Updated name"},
            {name: "version", type: "string", required: false, description: "Updated version"},
        ],
        examples: ['behavior update behaviorId=my.behavior code="this.update = function(dt) {}"'],
    },
    "behavior remove": {
        registryCommand: "remove_behavior",
        description: "Remove a behavior from the registry",
        params: [
            {name: "behaviorId", type: "string", required: true, description: "ID of behavior to remove"},
        ],
        examples: ["behavior remove behaviorId=my.behavior"],
    },

    // --- VFX ---
    "vfx add": {
        registryCommand: "add_vfx",
        description:
            "Create a new VFX particle system. Put particle system settings inside `config`, including timing, emission, spawn properties, shape, material, sprite-sheet, and renderer settings. Missing keys fall back to the built-in defaults: duration=1, looping=true, startLife=IntervalValue(1,2), startSpeed=IntervalValue(1,3), startSize=IntervalValue(0.1,0.5), startRotation=IntervalValue(-PI,PI), startColor=ConstantColor([1,1,1,1]), worldSpace=false, emissionOverTime=ConstantValue(10), one initial burst of 2 particles, shape=PointEmitter, material=MeshBasicMaterial{transparent:true, blending:AdditiveBlending, side:DoubleSide}, startTileIndex=ConstantValue(81), renderMode=BillBoard, renderOrder=2, autoDestroy=false, prewarm=false, onlyUsedByOther=false, rendererEmitterSettings={}, behaviors=[]. `config.autoPlay`, `config.autoplay`, and `config.autoStart` are treated as object-level flags and copied into the created VFX object's userData so runtime auto-start logic can respect them; if omitted, VFX defaults to auto-starting. Use `worldSpace:false` for effects that should stick to a moving object (aura/glow), and `worldSpace:true` for emitted particles that should stay in world space (sparks, smoke, dust, exhaust trails). Particle textures are set through `config.material.map` using a loadable image string such as a data URL or a direct asset/download URL. Bare asset IDs are not resolved automatically here. Use `config.shape` for emitter shapes and never write raw objects to `config.emitterShape`, because `emitterShape` is a runtime field and plain JSON there breaks serialization. Use `vfx behavior add` to attach over-lifetime behaviors instead of putting them in `config`.",
        params: [
            {name: "name", type: "string", required: true, description: "Name for the VFX"},
            {name: "position", type: "x,y,z", required: false, description: "Position {x, y, z}"},
            {
                name: "config",
                type: "object",
                required: false,
                description:
                    "ParticleSystem config. Common keys: duration, looping, prewarm, autoDestroy, worldSpace, speedFactor, emissionOverTime, emissionOverDistance, emissionBursts, startLife, startSpeed, startSize, startLength, startRotation, startColor, startTileIndex, shape, material, renderMode, renderOrder, uTileCount, vTileCount, blendTiles, softParticles, softNearFade, softFarFade, and rendererEmitterSettings. Defaults for `vfx add` are duration=1, looping=true, startLife=IntervalValue(1,2), startSpeed=IntervalValue(1,3), startSize=IntervalValue(0.1,0.5), startRotation=IntervalValue(-PI,PI), startColor=ConstantColor([1,1,1,1]), worldSpace=false, emissionOverTime=ConstantValue(10), emissionBursts=[{time:0,count:ConstantValue(2),cycle:1,interval:0.01,probability:1}], shape=PointEmitter, material=MeshBasicMaterial{transparent:true, blending:AdditiveBlending, side:DoubleSide}, startTileIndex=ConstantValue(81), renderMode=BillBoard, renderOrder=2, autoDestroy=false, prewarm=false, onlyUsedByOther=false, rendererEmitterSettings={}, behaviors=[]. `autoPlay`, `autoplay`, and `autoStart` are reserved object-level flags here; they are copied to the created emitter userData instead of the particle system config. For moving gameplay objects, set `worldSpace:true` when you want particles to detach and trail in the world (sparks/smoke/dust), keep `worldSpace:false` for effects that should stay attached (glow/aura). Texture setup goes inside `material`, usually with a `MeshBasicMaterial` or `SpriteMaterial` plus `map:<image-string>` and `transparent:true`. `map` may be a data URL or a normal image URL, including an existing asset download URL, but not a bare `assetId` or asset-ref object. Generators are accepted as typed objects such as {type:\"ConstantValue\",value:10} or {type:\"IntervalValue\",a:1,b:3}. Emitter shapes must go in `shape` as typed descriptors like {type:\"PointEmitter\"}, {type:\"SphereEmitter\",radius:1.5}, or {type:\"CircleEmitter\",radius:0.75}; do not put plain objects in `emitterShape`. Do not include behaviors here.",
            },
        ],
        examples: [
            'vfx add name="Fire" position=0,1,0',
            'vfx add name="Smoke" config={duration:4,looping:true,emissionOverTime:{type:"ConstantValue",value:20},startLife:{type:"IntervalValue",a:1,b:2},startSize:{type:"IntervalValue",a:0.25,b:0.8}}',
            'vfx add name="SparkRing" config={shape:{type:"CircleEmitter",radius:0.75,thickness:0.1,speed:{type:"ConstantValue",value:2}},material:{type:"MeshBasicMaterial",transparent:true,blending:"AdditiveBlending"}}',
            'vfx add name="Ember" config={material:{type:"MeshBasicMaterial",transparent:true,blending:"AdditiveBlending",map:"data:image/png;base64,<encoded-texture>"},renderMode:0}',
            'vfx add name="Dust" config={material:{type:"SpriteMaterial",transparent:true,map:"https://.../asset-texture.png"}}',
            'vfx add name="DriftSmokeLeft" config={autoPlay:false,worldSpace:true,emissionOverTime:{type:"ConstantValue",value:55}}',
        ],
    },
    "add vfx": {
        registryCommand: "add_vfx",
        description: "Create a new VFX particle system (alias for vfx add)",
        params: [
            {name: "name", type: "string", required: true, description: "Name for the VFX"},
            {name: "position", type: "x,y,z", required: false, description: "Position {x, y, z}"},
            {
                name: "config",
                type: "object",
                required: false,
                description:
                    "Same as `vfx add`: use `config` for particle system settings such as timing, emission, start values, shape, material, sprite-sheet, soft-particle, and rendererEmitterSettings values. Omitted keys use the same defaults as `vfx add`, including duration=1, looping=true, emissionOverTime=ConstantValue(10), shape=PointEmitter, and renderMode=BillBoard. Particle textures live in `config.material.map` and can be data URLs or direct image URLs, including resolved asset URLs. Use `shape`, not `emitterShape`, for emitter descriptors.",
            },
        ],
        examples: ['add vfx name="Smoke"', 'add vfx name="Mist" config={worldSpace:true,shape:{type:"SphereEmitter",radius:1.5},startColor:{type:"ConstantColor",value:[0.8,0.9,1,0.35]}}'],
    },
    "vfx modify": {
        registryCommand: "modify_vfx",
        description:
            "Modify an existing VFX transform or particle system settings. Pass any ParticleSystem updates through `config`. Only the keys you provide are changed; `vfx modify` does not reapply the `vfx add` defaults for omitted fields. `config.autoPlay`, `config.autoplay`, and `config.autoStart` update the VFX object's userData flags rather than the particle system itself. To change the particle texture, update `config.material.map` with a data URL or direct image URL. Bare asset IDs are not resolved here. Use `config.shape` for emitter changes, never a raw `config.emitterShape` object. Behaviors are managed separately with `vfx behavior add` and `vfx behavior remove`.",
        params: [
            {name: "<target>", type: "string", required: true, description: "VFX name or UUID"},
            {name: "position", type: "x,y,z", required: false, description: "New position"},
            {name: "rotation", type: "x,y,z", required: false, description: "New rotation in radians"},
            {name: "scale", type: "x,y,z", required: false, description: "New scale"},
            {
                name: "config",
                type: "object",
                required: false,
                description:
                    "ParticleSystem config updates. Supports timing/playback keys (duration, looping, prewarm, autoDestroy, worldSpace, speedFactor), emission keys (emissionOverTime, emissionOverDistance, emissionBursts), start keys (startLife, startSpeed, startSize, startLength, startRotation, startColor, startTileIndex), shape, material, renderMode, renderOrder, uTileCount, vTileCount, blendTiles, softParticles, softNearFade, softFarFade, and rendererEmitterSettings. Only provided fields are patched. `autoPlay`, `autoplay`, and `autoStart` are treated specially and written to emitter userData for runtime auto-start behavior. To change texture, pass `material:{type:\"MeshBasicMaterial\"|\"SpriteMaterial\",transparent:true,map:\"<data-or-url>\"}`. Existing texture assets must be resolved to a real image URL first; typed generator/color/shape objects are deserialized automatically. For shapes, send `shape:{type:\"PointEmitter\"|\"CircleEmitter\"|\"SphereEmitter\"|...}` and not a plain `emitterShape` object.",
            },
            {name: "action", type: "string", required: false, description: "'play', 'stop', 'pause', or 'restart'"},
        ],
        examples: [
            "vfx modify Fire action=restart",
            'vfx modify Fire config={startSpeed:{type:"ConstantValue",value:5},startSize:{type:"ConstantValue",value:0.5}}',
            'vfx modify Fire config={emissionBursts:[{time:0,count:{type:"ConstantValue",value:12},cycle:1,interval:0.05,probability:1}],rendererEmitterSettings:{type:"StretchedBillBoardSettings",speedFactor:1.5,lengthFactor:2}}',
            'vfx modify Fire config={material:{type:"SpriteMaterial",transparent:true,map:"data:image/png;base64,<encoded-texture>"}}',
        ],
    },
    "vfx delete": {
        registryCommand: "delete_vfx",
        description: "Remove a VFX particle system",
        params: [{name: "<target>", type: "string", required: true, description: "VFX name or UUID"}],
        examples: ["vfx delete Fire"],
    },
    "vfx get": {
        registryCommand: "get_vfx",
        description: "Get information about a VFX particle system",
        params: [{name: "<target>", type: "string", required: true, description: "VFX name or UUID"}],
        examples: ["vfx get Fire"],
    },
    "vfx behavior add": {
        registryCommand: "add_vfx_behavior",
        description: "Add a behavior to a VFX particle system",
        params: [
            {name: "<target>", type: "string", required: true, description: "VFX name or UUID"},
            {name: "behaviorType", type: "string", required: true, description: "Behavior type such as 'ColorOverLife' or 'SizeOverLife'"},
            {name: "config", type: "object", required: true, description: "Behavior configuration object"},
        ],
        examples: ['vfx behavior add Fire behaviorType=ColorOverLife config={mode:"gradient"}'],
    },
    "vfx behavior remove": {
        registryCommand: "remove_vfx_behavior",
        description: "Remove a behavior from a VFX particle system",
        params: [
            {name: "<target>", type: "string", required: true, description: "VFX name or UUID"},
            {name: "behaviorIndex", type: "number", required: true, description: "Index of the behavior to remove"},
        ],
        examples: ["vfx behavior remove Fire behaviorIndex=0"],
    },
    "vfx particle docs": {
        registryCommand: "add_vfx",
        description:
            "Compact reference for Script Tool particle-system config, including supported particle settings, behavior types, and compatibility guidance for Script Tool usage.",
        params: [],
        examples: ["help vfx particle docs"],
    },

    // --- Prefabs ---
    "prefab list": {
        registryCommand: "list_prefabs",
        description: "List all prefabs in the scene",
        params: [{name: "filter", type: "string", required: false, description: "Filter by name or id pattern"}],
        examples: ["prefab list", "prefab list filter=enemy"],
    },
    "prefab get": {
        registryCommand: "get_prefab",
        description: "Get detailed information about a prefab",
        params: [{name: "id", type: "string", required: true, description: "ID of the prefab"}],
        examples: ["prefab get id=abc123"],
    },
    "prefab add": {
        registryCommand: "add_prefab_to_scene",
        description: "Add a prefab to the scene",
        params: [
            {name: "id", type: "string", required: true, description: "ID of the prefab"},
            {name: "position", type: "x,y,z", required: false, description: "Position {x, y, z}"},
            {name: "name", type: "string", required: false, description: "Name for the instance"},
        ],
        examples: ["prefab add id=abc123 position=5,0,0"],
    },
    "prefab create": {
        registryCommand: "create_prefab",
        description: "Create a new prefab from an existing object",
        params: [
            {name: "<target>", type: "string", required: true, description: "Object name or UUID to convert"},
            {name: "name", type: "string", required: false, description: "Name for the prefab"},
            {name: "createThumbnail", type: "boolean", required: false, description: "Create a thumbnail (default: true)"},
        ],
        examples: ["prefab create MyObject"],
    },

    // --- Scene settings ---
    "scene lighting": {
        registryCommand: "set_scene_lighting",
        description: "Configure scene lighting",
        params: [
            {name: "ambient", type: "object", required: false, description: "Ambient light: { color: '#hex', intensity: number }"},
            {name: "hemisphere", type: "object", required: false, description: "Hemisphere light: { skyColor: '#hex', groundColor: '#hex', intensity: number }"},
            {name: "shadows", type: "object", required: false, description: "Shadows: { enabled: boolean, mapType: number }. Use 0=Basic, 1=PCF, 2=PCFSoft, 3=VSM for mapType."},
        ],
        examples: ["scene lighting ambient={color:\"#ffffff\",intensity:0.5}"],
    },
    "scene fog": {
        registryCommand: "set_scene_fog",
        description: "Configure scene fog",
        params: [
            {name: "type", type: "string", required: true, description: "'none', 'linear', or 'exponential'"},
            {name: "color", type: "string", required: false, description: "Fog color hex"},
            {name: "near", type: "number", required: false, description: "Start distance (linear)"},
            {name: "far", type: "number", required: false, description: "End distance (linear)"},
            {name: "density", type: "number", required: false, description: "Density (exponential)"},
        ],
        examples: ["scene fog type=linear color=#aaaaaa near=10 far=100"],
    },
    "scene background": {
        registryCommand: "set_scene_background",
        description: "Configure scene background. `gradient` must be a CSS gradient string, not a JSON object.",
        params: [
            {name: "type", type: "string", required: true, description: "'Color', 'Texture', 'Cubemap', or 'Gradient'"},
            {name: "color", type: "string", required: false, description: "Background color hex"},
            {name: "texture", type: "string", required: false, description: "Equirectangular background texture URL/path or imported image asset name"},
            {name: "cubemap", type: "array", required: false, description: "Cubemap face URLs/paths or imported image asset names in [+X, -X, +Y, -Y, +Z, -Z] order"},
            {name: "gradient", type: "string", required: false, description: "CSS gradient string such as `linear-gradient(180deg, #87CEEB 0%, #dfefff 100%)`. Do not pass a JSON object."},
            {name: "gradientMode", type: "string", required: false, description: "Gradient render mode: '2d' or '3d'"},
            {name: "rotation", type: "number", required: false, description: "Background rotation"},
            {name: "intensity", type: "number", required: false, description: "Background intensity"},
            {name: "blurriness", type: "number", required: false, description: "Background blurriness"},
        ],
        examples: [
            "scene background type=Color color=#1a1a2e",
            'scene background type=Texture texture="/hdr/studio.hdr" rotation=0.35 intensity=1.1',
            'scene background type=Cubemap cubemap=["SkyPX","SkyNX","SkyPY","SkyNY","SkyPZ","SkyNZ"] intensity=1.0 blurriness=0',
            'scene background type=Gradient gradientMode=3d gradient="linear-gradient(180deg, #87CEEB 0%, #dfefff 100%)"',
        ],
    },
    "scene tonemapping": {
        registryCommand: "set_tone_mapping",
        description: "Configure tone mapping",
        params: [
            {name: "type", type: "string", required: true, description: "'None', 'Linear', 'Reinhard', 'Cineon', 'ACESFilmic'"},
            {name: "exposure", type: "number", required: false, description: "Exposure (default: 1.0)"},
        ],
        examples: ["scene tonemapping type=ACESFilmic exposure=1.2"],
    },
    "scene postprocessing": {
        registryCommand: "set_post_processing",
        description: "Configure post-processing effects. After this command runs, the active render pipeline is updated so AO, bloom, SSR, DoF, and outline changes take effect immediately.",
        params: [
            {name: "ao", type: "object", required: false, description: "Ambient occlusion: { enabled, kernelRadius, minDistance, maxDistance }"},
            {name: "bloom", type: "object", required: false, description: "Bloom: { enabled, strength, radius, threshold }"},
            {name: "ssr", type: "object", required: false, description: "SSR: { enabled, resolutionScale, maxDistance, thickness, opacity, quality, blur, blurQuality }"},
            {name: "dof", type: "object", required: false, description: "Depth of field: { enabled, focusDistance, focalLength, bokehScale }"},
            {name: "outline", type: "object", required: false, description: "Outline: { enabled, edgeStrength, edgeGlow, edgeThickness }"},
        ],
        examples: [
            "scene postprocessing bloom={enabled:true,strength:0.5,radius:0.4,threshold:0.8}",
            "scene postprocessing ssr={enabled:true,opacity:0.8,maxDistance:12,quality:0.5}",
            "scene postprocessing dof={enabled:true,focusDistance:10,focalLength:6,bokehScale:1.5}",
        ],
    },
    "scene settings": {
        registryCommand: "get_editor_settings",
        description: "Get current editor settings",
        params: [
            {name: "category", type: "string", required: false, description: "'lighting', 'fog', 'background', 'toneMapping', 'postProcessing', 'game', 'rendering', or 'all'", default: "all"},
        ],
        examples: ["scene settings", "scene settings category=lighting"],
    },
    "get outline": {
        registryCommand: "get_scene_setting",
        description: "Get the current outline post-processing settings.",
        params: [],
        examples: ["get outline"],
    },
    "get camera": {
        registryCommand: "get_camera_settings",
        description: "Get camera settings from a camera object, including the editor/runtime DefaultCamera.",
        params: [
            {name: "<target>", type: "string", required: true, description: "Camera object name or UUID"},
        ],
        examples: ['get camera "DefaultCamera"'],
    },
    camera: {
        registryCommand: "set_camera_settings",
        description: "Configure camera settings on an object",
        params: [
            {name: "<target>", type: "string", required: true, description: "Camera object name or UUID (e.g. 'DefaultCamera'). Target must be a camera."},
            {name: "fov", type: "number", required: false, description: "Field of view in degrees"},
            {name: "near", type: "number", required: false, description: "Near clipping plane"},
            {name: "far", type: "number", required: false, description: "Far clipping plane"},
            {name: "cameraType", type: "string", required: false, description: "'THIRD_PERSON', 'FIRST_PERSON', 'TOP_DOWN', 'SIDE_SCROLLER', 'NONE' (disables camera)"},
            {name: "defaultDistance", type: "number", required: false, description: "Default camera distance"},
            {name: "minDistance", type: "number", required: false, description: "Minimum camera distance"},
            {name: "maxDistance", type: "number", required: false, description: "Maximum camera distance"},
            {name: "headHeight", type: "number", required: false, description: "Camera head height (first-person)"},
            {name: "axis", type: "string", required: false, description: "Axis constraint (e.g., 'Z' for side-scroller)"},
        ],
        examples: ['camera "DefaultCamera" cameraType=THIRD_PERSON defaultDistance=8 minDistance=3 maxDistance=15'],
    },
    "project title": {
        registryCommand: "set_project_title",
        description: "Set the project/scene title",
        params: [
            {name: "title", type: "string", required: true, description: "The project title to set (quote if it contains spaces)"},
        ],
        examples: [
            'project title "My Racing Game"',
            "project title MyGame",
        ],
    },
    "scene thumbnail": {
        registryCommand: "set_scene_thumbnail",
        description:
            "Set the scene's Thumbnail metadata field from an image asset already declared in the scene library. " +
            "The image must have been imported with `import image name=\"<name>\" filepath=\"...\"` earlier in the same stemscript.",
        params: [
            {name: "name", type: "string", required: true, description: "Image asset name (case-insensitive). Convention: ProjectCover."},
        ],
        examples: [
            'import image name="ProjectCover" filepath="cover.png"',
            'scene thumbnail name="ProjectCover"',
        ],
    },
    "game settings": {
        registryCommand: "set_game_settings",
        description: "Configure game rules",
        params: [
            {name: "isGame", type: "boolean", required: false, description: "Mark this project as a game"},
            {name: "enabled", type: "boolean", required: false, description: "Legacy alias for isGame"},
            {name: "lives", type: "number", required: false, description: "Number of lives"},
            {name: "maxScore", type: "number", required: false, description: "Maximum score to win"},
            {name: "timer", type: "number", required: false, description: "Timer in seconds (0 = no timer)"},
            {name: "useAvatar", type: "boolean", required: false, description: "Use avatar system"},
            {name: "isMultiplayer", type: "boolean", required: false, description: "Enable multiplayer"},
            {name: "showHUD", type: "boolean", required: false, description: "Show HUD overlay"},
            {name: "isSandbox", type: "boolean", required: false, description: "Enable sandbox mode"},
            {name: "voiceChatEnabled", type: "boolean", required: false, description: "Enable voice chat"},
        ],
        examples: ["game settings isGame=true lives=3 maxScore=100 showHUD=true"],
    },
    "render settings": {
        registryCommand: "set_rendering_settings",
        description: "Configure rendering quality. `shadowMapType` must be a number: 0=Basic, 1=PCF, 2=PCFSoft, 3=VSM.",
        params: [
            {name: "useShadows", type: "boolean", required: false, description: "Enable shadow rendering"},
            {name: "useInstancing", type: "boolean", required: false, description: "Enable GPU instancing"},
            {name: "shadowMapType", type: "number", required: false, description: "Shadow map type (THREE constant): 0=Basic, 1=PCF, 2=PCFSoft, 3=VSM"},
            {name: "usePhysicsWorker", type: "boolean", required: false, description: "Run physics in web worker"},
        ],
        examples: ["render settings useShadows=true useInstancing=true", "render settings useShadows=true shadowMapType=2"],
    },

    // --- Assets ---
    "search assets": {
        registryCommand: "search_local_assets",
        description: "Search for assets in the library by tag phrases",
        params: [
            {name: "phrases", type: "array", required: true, description: "Array of search phrases (tags)"},
            {name: "type", type: "string", required: false, description: "'model', 'audio', 'image', 'behavior', 'prefab', 'vfx'"},
        ],
        examples: ['search assets phrases=["tree","forest"] type=model'],
    },
    "asset get": {
        registryCommand: "get_library_asset",
        description: "Get detailed information about a specific library asset",
        params: [
            {name: "assetId", type: "string", required: true, description: "The ID of the asset to retrieve"},
        ],
        examples: ["asset get assetId=abc123"],
    },
    "search external": {
        registryCommand: "search_external_assets",
        description: "Search for assets from external providers",
        params: [
            {name: "prompt", type: "string", required: true, description: "Search prompt"},
            {name: "provider", type: "string", required: false, description: "'sketchfab', 'polyhaven', 'meshy', 'local'"},
        ],
        examples: ['search external prompt="low poly tree" provider=sketchfab'],
    },
    "generate model": {
        registryCommand: "generate_3d_model",
        description: "Generate a 3D model using AI from a text description",
        params: [
            {name: "prompt", type: "string", required: true, description: "Description of the 3D model"},
            {name: "name", type: "string", required: false, description: "Name for the generated model"},
            {name: "position", type: "x,y,z", required: false, description: "Position to place the model"},
            {name: "parent", type: "string", required: false, description: "Parent object name or UUID"},
            {name: "provider", type: "string", required: false, description: "'meshy', 'tripo', or 'rodin' (default meshy)"},
        ],
        examples: ['generate model prompt="a medieval wooden barrel" name="Barrel" position=3,0,0'],
    },
};

COMMAND_PARAMS["check"] = {
    registryCommand: "check",
    description: "Admin-only validation command. Derives getter probes from a StemScript and compares expected settings against the current scene.",
    params: [
        {name: "mode", type: "string", required: false, description: "`check` validates the last executed script, `check exec` executes a picked script and validates it, `check buffer` validates command history"},
    ],
    examples: ["check", "check exec", "check buffer"],
};

COMMAND_PARAMS["test"] = {
    registryCommand: "test",
    description: "Admin-only script test command. Executes a selected StemScript, then validates applied settings with equivalent getter probes.",
    params: [
        {name: "mode", type: "string", required: false, description: "`test` opens the script/folder picker, executes the selected .stemscript, then runs the same getter-based validation as `check`"},
    ],
    examples: ["test", "test script"],
};

/**
 *
 */
export function getCommandHelpTopics(): string[] {
    return Object.keys(COMMAND_PARAMS);
}

/**
 *
 * @param topic
 */
export function getCommandHelpDefinition(topic: string): CommandHelp | null {
    return COMMAND_PARAMS[topic.toLowerCase().trim()] || null;
}

/**
 *
 * @param registryCommand
 */
export function getCommandHelpByRegistryCommand(
    registryCommand: string,
): {topic: string; help: CommandHelp} | null {
    const matches = Object.entries(COMMAND_PARAMS)
        .filter(([, cmd]) => cmd.registryCommand === registryCommand.toLowerCase().trim());

    if (matches.length === 0) {
        return null;
    }

    const preferredMatch = matches.find(([key]) => key === "add")
        || matches.find(([key]) => key.startsWith("vfx "))
        || matches[0]!;
    const [topic, help] = preferredMatch;
    return {topic, help};
}

// Also allow "add" as a generic lookup to show all primitives
COMMAND_PARAMS["add"] = {
    registryCommand: "create_primitive",
    description: "Create a 3D primitive object. Specify the type after 'add'.",
    params: [
        {name: "type", type: "string", required: true, description: "Primitive type: box, sphere, cylinder, cone, plane, torus, torusKnot, triangle, capsule, icosahedron, octahedron, dodecahedron, ring"},
        {name: "name", type: "string", required: false, description: "Name for the object"},
        {name: "position", type: "x,y,z", required: false, description: "Position {x, y, z}"},
        {name: "size", type: "x,y,z", required: false, description: "Geometry dimensions {x, y, z}. Sets actual geometry size (e.g., box width/height/depth)."},
        {name: "widthSegments", type: "number", required: false, description: "Optional width subdivision count for supported primitives."},
        {name: "heightSegments", type: "number", required: false, description: "Optional height subdivision count for supported primitives."},
        {name: "depthSegments", type: "number", required: false, description: "Optional depth subdivision count for box primitives."},
        {name: "radialSegments", type: "number", required: false, description: "Optional radial subdivision count for cylinder, cone, torus, torusKnot, and capsule."},
        {name: "tubularSegments", type: "number", required: false, description: "Optional tubular subdivision count for torus and torusKnot."},
        {name: "thetaSegments", type: "number", required: false, description: "Optional angular subdivision count for ring."},
        {name: "phiSegments", type: "number", required: false, description: "Optional radial band count for ring."},
        {name: "capSegments", type: "number", required: false, description: "Optional cap subdivision count for capsule."},
        {name: "scale", type: "x,y,z", required: false, description: "Scale {x, y, z}"},
        {name: "rotation", type: "x,y,z", required: false, description: "Rotation {x, y, z} in radians"},
        {name: "color", type: "string", required: false, description: "Hex color (e.g., '#ff0000')"},
        {name: "parent", type: "string", required: false, description: "Parent object name or UUID"},
        {name: "objectSettings", type: "object", required: false, description: "{ isBatchable, isStatic, isSelectable, enableAtStart, visibleByAI, gameVisibility, EnableMorphing }"},
    ],
    examples: [
        'add box position=0,1,0 color=#ff0000 name="RedBox"',
        'add box name="Ground" size=128,0.1,128',
        'add plane name="MegaTerrain" size=4000,1,4000 widthSegments=4 heightSegments=4',
        "add cylinder position=3,0,0 color=#00ff00",
    ],
};

const HELP_CATEGORIES: HelpCategory[] = [
    {
        name: "Objects",
        description: "Create, modify, and manage 3D objects in the scene",
        entries: [
            {syntax: "add <type> [params]", description: "Create a primitive (box, sphere, cylinder, cone, plane, torus, torusKnot, triangle, capsule, icosahedron, octahedron, dodecahedron, ring)"},
            {syntax: "add group [params]", description: "Create an empty group container"},
            {syntax: "add model [params]", description: "Add a 3D model to the scene"},
            {syntax: "add prefab id=<id>", description: "Add a prefab instance to the scene"},
            {syntax: 'update <target> [params]', description: 'Modify object properties: position, rotation, scale, color, name, tag (quote <target> when it contains spaces, e.g. update "My Box" color=#ff0000)'},
            {syntax: "delete <target>", description: "Delete an object from the scene"},
            {syntax: "clone <target> [params]", description: "Clone an existing object"},
            {syntax: "move <target> parent=<parent> [keepLocalSpace=true|false]", description: "Move object to a different parent. keepLocalSpace defaults to true"},
            {syntax: "list objects [filter=<pattern>]", description: "List all scene objects"},
            {syntax: "get <target>", description: "Get detailed info about an object"},
            {syntax: "get box|sphere|group <target>", description: "Get compact settings for a typed object and fail on type mismatch"},
            {syntax: "select", description: "Get the currently selected object"},
            {syntax: "player", description: "Get player object data"},
        ],
    },
    {
        name: "Materials & Textures",
        description: "Modify object appearance",
        entries: [
            {
                syntax: "material <target> [color=<hex>] [opacity=<0-1>] [metalness=<0-1>] [roughness=<0-1>] [tileAmountX=<n>] [tileAmountY=<n>] [panningSpeedX=<n>] [panningSpeedY=<n>]",
                description: "Set material properties. Texture tiling/offset defaults are 1 when material settings are first created",
            },
            {syntax: "get material <target>", description: "Get material and texture override settings"},
            {syntax: "texture <target> textureUrl=<url> [textureType=map|normalMap|roughnessMap]", description: "Apply a texture to an object"},
            {syntax: "texture external <target> assetId=<id> assetType=textures|hdris name=<name> provider=<provider>", description: "Apply external texture or HDRI from a provider"},
        ],
    },
    {
        name: "Physics",
        description: "Enable and configure physics simulation",
        entries: [
            {syntax: "physics engine <type> [gravity=<n>]", description: "Set scene-level physics engine (ammo | rapier) and optional gravity"},
            {syntax: "get physics engine", description: "Get scene-level physics engine settings"},
            {syntax: "physics enable <target>", description: "Enable physics on an object"},
            {syntax: "physics disable <target>", description: "Disable physics on an object"},
            {syntax: "physics set <target> config={shape,mass,friction,restitution,ctype}", description: "Configure physics properties"},
            {syntax: "get physics <target>", description: "Get object physics settings"},
        ],
    },
    {
        name: "Behaviors",
        description: "Manage behavior scripts on objects",
        entries: [
            {syntax: "behavior attach <target> behaviorId=<id> [config={...}]", description: "Attach a behavior to an object"},
            {syntax: "navmesh add [target=<object>] [autoGenerate=true] [...]", description: "Create or configure the built-in navmesh"},
            {syntax: "navmesh rebuild [target=<object>]", description: "Trigger navmesh regeneration"},
            {syntax: "navmesh connection add <source> target=<object> [...]", description: "Create an off-mesh navmesh connection"},
            {syntax: "waypoint path add name=<path> [position=x,y,z] [loop=true|false]", description: "Create a waypoint path group"},
            {syntax: "waypoint add path=<path> position=x,y,z [order=n]", description: "Create a waypoint marker"},
            {syntax: "behavior detach <target> behaviorId=<id>", description: "Remove a behavior from an object"},
            {syntax: "behavior config <target> behaviorId=<id> [attributesData={...}]", description: "Update behavior configuration"},
            {syntax: "behavior list [filter=<pattern>]", description: "List all available behaviors"},
            {syntax: "behavior get behaviorId=<id>", description: "Get behavior details"},
            {syntax: "behavior add name=<name> code=<code>", description: "Add a new behavior to the registry"},
            {syntax: "behavior update behaviorId=<id> code=<code>", description: "Update an existing behavior"},
            {syntax: "behavior remove behaviorId=<id>", description: "Remove a behavior from the registry"},
        ],
    },
    {
        name: "VFX",
        description: "Create and manage particle system effects",
        entries: [
            {syntax: "vfx add name=<name> [position=x,y,z] [config={...}]", description: "Create a new VFX particle system; omitted config keys use built-in defaults such as duration=1, looping=true, emissionOverTime=ConstantValue(10), shape=PointEmitter, transparent additive MeshBasicMaterial, and renderMode=BillBoard. Texture map accepts image URLs or data URLs, not bare asset IDs"},
            {syntax: "vfx modify <target> [config={...}] [action=play|stop|pause|restart]", description: "Modify VFX transform or particle system config such as start values, bursts, shape, material, texture map, and playback. Only provided config keys are changed. Use `shape`, not `emitterShape`, for emitter updates. Texture map accepts image URLs or data URLs"},
            {syntax: "vfx delete <target>", description: "Remove a VFX"},
            {syntax: "vfx get <target>", description: "Get VFX information"},
            {syntax: "vfx behavior add <target> behaviorType=<type> config={...}", description: "Add a behavior to a VFX system"},
            {syntax: "vfx behavior remove <target> behaviorIndex=<n>", description: "Remove a behavior from a VFX system"},
            {syntax: "add vfx name=<name>", description: "Alias for vfx add"},
        ],
    },
    {
        name: "Prefabs",
        description: "Work with reusable prefab templates",
        entries: [
            {syntax: "prefab list [filter=<pattern>]", description: "List all prefabs"},
            {syntax: "prefab get id=<id>", description: "Get prefab details"},
            {syntax: "prefab add id=<id> [position=x,y,z]", description: "Add prefab to scene"},
            {syntax: "prefab create <target> [name=<name>]", description: "Create prefab from existing object"},
        ],
    },
    {
        name: "Scene Settings",
        description: "Configure scene-wide rendering and environment",
        entries: [
            {syntax: "scene lighting [ambient={color,intensity}] [hemisphere={skyColor,groundColor,intensity}] [shadows={enabled,mapType}]", description: "Configure scene lighting"},
            {syntax: "scene fog type=none|linear|exponential [color=<hex>] [near=<n>] [far=<n>] [density=<n>]", description: "Configure scene fog"},
            {syntax: "scene background type=Color|Texture|Cubemap|Gradient [color=<hex>] [texture=<url>] [cubemap=[...]] [gradient=<css>] [gradientMode=2d|3d] [rotation=<n>] [intensity=<n>] [blurriness=<n>]", description: "Configure scene background"},
            {syntax: "scene tonemapping type=None|Linear|Reinhard|Cineon|ACESFilmic [exposure=<n>]", description: "Set tone mapping"},
            {syntax: "scene postprocessing [ao={...}] [bloom={...}] [ssr={...}] [dof={...}] [outline={...}]", description: "Configure post-processing and refresh the active render pipeline"},
            {syntax: "scene settings [category=all|lighting|fog|background|...]", description: "Get current editor settings"},
            {syntax: "get outline|bloom|ao|dof", description: "Get an individual post-processing effect setting"},
        ],
    },
    {
        name: "Camera, Light & Game",
        description: "Configure camera, light, and game settings",
        entries: [
            {syntax: "camera <target> [fov=<n>] [near=<n>] [far=<n>] [cameraType=THIRD_PERSON|FIRST_PERSON|TOP_DOWN|SIDE_SCROLLER|NONE]", description: "Configure camera settings"},
            {syntax: "get camera <target>", description: "Get camera settings"},
            {syntax: "light <target> [intensity=<n>] [color=<hex>] [castShadow=<bool>] [shadowMapSize=<n>]", description: "Set light properties (intensity, color, shadows)"},
            {syntax: "get light <target>", description: "Get light settings"},
            {syntax: "game settings [isGame=<bool>] [lives=<n>] [maxScore=<n>] [timer=<n>]", description: "Configure game rules"},
            {syntax: "get game settings", description: "Get game settings"},
            {syntax: 'project title "<title>"', description: "Set the project/scene title"},
            {syntax: "render settings [useShadows=<bool>] [useInstancing=<bool>]", description: "Configure rendering quality"},
            {syntax: "get render settings", description: "Get rendering settings"},
        ],
    },
    {
        name: "Assets & Generation",
        description: "Search for and generate 3D assets",
        entries: [
            {syntax: "search assets phrases=[\"tag1\",\"tag2\"] [type=model|audio|image|behavior|prefab|vfx]", description: "Search local asset library"},
            {syntax: "asset get assetId=<id>", description: "Get detailed information for a library asset"},
            {syntax: "search external prompt=<text> [provider=sketchfab|polyhaven|meshy|local]", description: "Search external asset providers"},
            {syntax: "generate model prompt=<text> [name=<name>] [position=x,y,z]", description: "Generate 3D model with AI"},
        ],
    },
    {
        name: "Import",
        description: 'Import files into the project. Quote names/filepaths that contain spaces with ""',
        entries: [
            {syntax: 'import <type> <name>|"<name>" [filepath|"filepath"] ["comment"]', description: "Import an asset with a name; optional filepath for auto-resolve, quoted comment shown in file picker"},
            {syntax: 'import <type> name=<name> [filepath=<path>] [comment=<text>]', description: "Named parameter variant (quote values with spaces)"},
            {syntax: 'import <type> name=<name> url=<url> [comment=<text>]', description: "Fetch the asset blob from a URL (used by `export scene` bundles)"},
            {syntax: 'import model Kart kart.glb "The racing kart"', description: "Import 3D model named 'Kart'"},
            {syntax: 'import model "Racing Kart" "my models/kart.glb"', description: "Import with spaces in name and filepath"},
            {syntax: 'import model Kart url=https://assets.example.com/kart.glb', description: "Import from a URL (export-mode bundles)"},
            {syntax: 'import behavior NpcController behaviors/npc.yaml', description: "Import behavior YAML named 'NpcController'"},
            {syntax: "import audio EngineSound engine.mp3", description: "Import audio asset (.mp3, .wav, .ogg, .m4a)"},
            {syntax: "import sound BgMusic", description: "Import sound file (alias for audio)"},
            {syntax: "import image MyTexture", description: "Import image (.png, .jpg, .webp, .svg)"},
            {syntax: "import video Intro", description: "Import video (.mp4, .webm)"},
            {syntax: "import prefab EnemyPrefab", description: "Import prefab from YAML"},
            {syntax: 'import script name="math-helpers" filepath="imports/math-helpers.js"', description: "Import a JavaScript helper as an Import asset (referenced by `@import` directives in behaviors/lambdas)"},
        ],
    },
    {
        name: "Script",
        description: "Terminal and script management commands",
        entries: [
            {syntax: "help [command|category]", description: "Show help (all, specific command, or category)"},
            {syntax: "exec [path]", description: "Run a .stemscript file (opens file picker if no path)"},
            {syntax: "test | test script", description: "Admin-only: execute a selected .stemscript and validate it with equivalent getter probes"},
            {syntax: "check | check exec | check buffer", description: "Admin-only: validate applied script settings by deriving getter probes"},
            {syntax: "save [path]", description: "Save command history as .stemscript (opens save dialog if no path)"},
            {syntax: "dump scene [name=<bundle-name>]", description: "Dump the current scene as a zip bundle: stemscript + physical asset files (models/textures/audio/videos) + behavior/lambda YAMLs. Offline-replayable via `exec`. Owner only."},
            {syntax: "export scene [name=<bundle-name>]", description: "Export the current scene as a zip bundle with stemscript + behavior/lambda YAMLs; assets are referenced by signed URL (no binaries). `exec` fetches them on import. Owner only."},
            {syntax: "clear", description: "Clear terminal output"},
            {syntax: "history", description: "Show command history for this session"},
            {syntax: "exit", description: "Return to Copilot chat mode"},
        ],
    },
];

/**
 * Look up detailed parameter help for a topic.
 * Tries exact match first, then prefix match on COMMAND_PARAMS keys.
 * @param topic
 */
function getCommandParamHelp(topic: string): string | null {
    const lower = topic.toLowerCase().trim();

    // Exact match
    if (COMMAND_PARAMS[lower]) {
        return formatCommandHelp(lower, COMMAND_PARAMS[lower]);
    }

    // Raw CommandsRegistry command names should also resolve to help.
    const registryMatches = Object.entries(COMMAND_PARAMS)
        .filter(([, cmd]) => cmd.registryCommand === lower);
    if (registryMatches.length > 0) {
        return formatRegistryCommandHelp(lower, registryMatches);
    }

    // Prefix match — e.g. "add box" matches "add box"
    const matches: string[] = [];
    for (const key of Object.keys(COMMAND_PARAMS)) {
        if (key.startsWith(lower) || lower.startsWith(key)) {
            matches.push(key);
        }
    }

    // If we have an exact-length match, prefer it
    const exactLen = matches.find(m => m === lower);
    if (exactLen) {
        return formatCommandHelp(exactLen, COMMAND_PARAMS[exactLen]!);
    }

    // If "add box" was typed but we only have generic "add", don't match generic
    // If there's exactly one match, use it
    if (matches.length === 1) {
        return formatCommandHelp(matches[0]!, COMMAND_PARAMS[matches[0]!]!);
    }

    // Multiple matches — show all
    if (matches.length > 1) {
        // Prefer the longest (most specific) match
        matches.sort((a, b) => b.length - a.length);
        const best = matches[0]!;
        if (best.startsWith(lower) || lower.startsWith(best)) {
            return formatCommandHelp(best, COMMAND_PARAMS[best]!);
        }
    }

    return null;
}

/**
 *
 * @param registryCommand
 * @param matches
 */
function formatRegistryCommandHelp(
    registryCommand: string,
    matches: [string, CommandHelp][],
): string {
    const preferredMatch = matches.find(([key]) => key === "add")
        || matches.find(([key]) => key.startsWith("vfx "))
        || matches[0]!;
    const [, cmd] = preferredMatch;
    const syntaxes = Array.from(new Set(matches.map(([key]) => key)));
    const lines: string[] = [];

    lines.push(`## \`${registryCommand}\``);
    lines.push("");
    lines.push(cmd.description);
    lines.push("");

    if (syntaxes.length > 0) {
        lines.push("### Script Syntax");
        lines.push("");
        for (const syntax of syntaxes) {
            lines.push(`- \`${syntax}\``);
        }
        lines.push("");
    }

    lines.push(`**Registry command:** \`${registryCommand}\``);
    lines.push("");

    if (cmd.params.length === 0) {
        lines.push("### Parameters");
        lines.push("");
        lines.push("No parameters.");
    } else {
        lines.push("### Parameters");
        lines.push("");
        for (const p of cmd.params) {
            const requiredLabel = p.required ? "required" : "optional";
            const defaultLabel = p.default ? ` Default: \`${p.default}\`.` : "";
            lines.push(`- \`${p.name}\` (\`${p.type}\`, ${requiredLabel}): ${p.description}${defaultLabel}`);
        }
    }

    if (cmd.examples && cmd.examples.length > 0) {
        lines.push("");
        lines.push("### Examples");
        lines.push("");
        lines.push("```text");
        lines.push(...cmd.examples);
        lines.push("```");
    }

    return lines.join("\n");
}

/**
 *
 * @param key
 * @param cmd
 */
function formatCommandHelp(key: string, cmd: CommandHelp): string {
    const lines: string[] = [];
    lines.push(`## \`${key}\``);
    lines.push("");
    lines.push(cmd.description);
    lines.push("");
    lines.push(`**Registry command:** \`${cmd.registryCommand}\``);
    lines.push("");

    if (cmd.params.length === 0) {
        lines.push("### Parameters");
        lines.push("");
        lines.push("No parameters.");
    } else {
        lines.push("### Parameters");
        lines.push("");
        for (const p of cmd.params) {
            const requiredLabel = p.required ? "required" : "optional";
            const defaultLabel = p.default ? ` Default: \`${p.default}\`.` : "";
            lines.push(`- \`${p.name}\` (\`${p.type}\`, ${requiredLabel}): ${p.description}${defaultLabel}`);
        }
    }

    if (cmd.examples && cmd.examples.length > 0) {
        lines.push("");
        lines.push("### Examples");
        lines.push("");
        lines.push("```text");
        lines.push(...cmd.examples);
        lines.push("```");
    }

    return lines.join("\n");
}

function getHelpCategories(): HelpCategory[] {
    if (isScriptsEnabled()) return HELP_CATEGORIES;
    return HELP_CATEGORIES.map(cat => ({
        ...cat,
        entries: cat.entries.filter(entry => !/^import\s+script\b/i.test(entry.syntax)),
    }));
}

/**
 * Get help for a specific topic — tries detailed param help first, falls back to category/verb matching.
 * @param topic
 */
export function getHelpForTopic(topic: string): string {
    const lower = topic.toLowerCase().trim();

    // 1. Try detailed parameter help (e.g. "add box", "physics set", "camera")
    const paramHelp = getCommandParamHelp(lower);
    if (paramHelp) {
        return paramHelp;
    }

    const categories = getHelpCategories();

    // 2. Match category name
    for (const cat of categories) {
        if (cat.name.toLowerCase() === lower) {
            return formatCategory(cat);
        }
    }

    // 3. Match command verb in category entries
    const matchingEntries: {category: string; entry: HelpEntry}[] = [];
    for (const cat of categories) {
        for (const entry of cat.entries) {
            const syntaxVerb = entry.syntax.split(" ")[0]!.toLowerCase();
            const syntaxFull = entry.syntax.toLowerCase();
            if (syntaxVerb === lower || syntaxFull.startsWith(lower)) {
                matchingEntries.push({category: cat.name, entry});
            }
        }
    }

    if (matchingEntries.length > 0) {
        const lines: string[] = [];
        let lastCat = "";
        for (const {category, entry} of matchingEntries) {
            if (category !== lastCat) {
                if (lines.length > 0) {
                    lines.push("");
                }
                lines.push(`### ${category}`);
                lastCat = category;
            }
            lines.push(`- \`${entry.syntax}\`: ${entry.description}`);
        }
        lines.push("");
        lines.push("Tip: Use `help <command>` for detailed parameters, for example `help add box` or `help physics set`.");
        return lines.join("\n");
    }

    return `No help found for \`${topic}\`. Type \`help\` to see all commands.`;
}

/**
 * Format all help categories into a single string.
 */
export function getAllHelp(): string {
    const cats = getHelpCategories().map(formatCategory).join("\n\n");
    return `${cats}\n\nTip: Use \`help <command>\` for detailed parameters, for example \`help add box\` or \`help physics set\`.`;
}

/**
 *
 * @param cat
 */
function formatCategory(cat: HelpCategory): string {
    const lines = [
        `## ${cat.name}`,
        "",
        cat.description,
        "",
        ...cat.entries.map(e => `- \`${e.syntax}\`: ${e.description}`),
    ];

    return lines.join("\n");
}
