import AIWorldController from "../controls/AiWorldController/AiWorldController";
import EngineRuntime from "../EngineRuntime";
import global from "../global";
import {AssetHandlers} from "./handlers/AssetHandlers";
import {BehaviorHandlers} from "./handlers/BehaviorHandlers";
import {LambdaHandlers} from "./handlers/LambdaHandlers";
import {LightHandlers} from "./handlers/LightHandlers";
import {ObjectHandlers} from "./handlers/ObjectHandlers";
import {PhysicsHandlers} from "./handlers/PhysicsHandlers";
import {PrefabHandlers} from "./handlers/PrefabHandlers";
import {SettingsHandlers} from "./handlers/SettingsHandlers";
import {TaskHandlers} from "./handlers/TaskHandlers";
import {VFXHandlers} from "./handlers/VfxHandlers";
import {CommandCapability, CommandResult} from "./types/ACPTypes";

/**
 * CommandsRegistry
 *
 * Central registry for all available commands that can be executed by the AI Agent.
 * Each command includes:
 * - Name and description
 * - Parameter definitions with types and validation
 * - Execution handler function
 * - Examples for the AI to understand usage
 */
export class CommandsRegistry {
    private commands: Map<string, RegisteredCommand> = new Map();
    private engine = global.app as unknown as EngineRuntime;
    private aiWorldController = AIWorldController.getInstance(this.engine);

    // Handler instances
    private assetHandlers: AssetHandlers;
    private objectHandlers: ObjectHandlers;
    private behaviorHandlers: BehaviorHandlers;
    private lambdaHandlers: LambdaHandlers;
    private prefabHandlers: PrefabHandlers;
    private physicsHandlers: PhysicsHandlers;
    private vfxHandlers: VFXHandlers;
    private settingsHandlers: SettingsHandlers;
    private lightHandlers: LightHandlers;
    private taskHandlers: TaskHandlers;

    constructor(options: CommandsRegistryOptions = {}) {
        this.assetHandlers = new AssetHandlers(this.engine);
        this.objectHandlers = new ObjectHandlers(this.engine, this.aiWorldController);
        this.behaviorHandlers = new BehaviorHandlers(this.engine);
        this.lambdaHandlers = new LambdaHandlers(this.engine);
        this.prefabHandlers = new PrefabHandlers(this.engine);
        this.physicsHandlers = new PhysicsHandlers(this.engine);
        this.vfxHandlers = new VFXHandlers(this.engine);
        this.settingsHandlers = new SettingsHandlers(this.engine);
        this.lightHandlers = new LightHandlers(this.engine);
        this.taskHandlers = new TaskHandlers(this.engine, {getSessionId: options.getSessionId});
        this.registerDefaultCommands();
    }

    /**
     * Register a new command
     * @param command
     */
    registerCommand(command: RegisteredCommand): void {
        this.commands.set(command.name, command);
    }

    /**
     * Get a registered command by name
     * @param name - The name of the command
     * @returns The registered command or undefined if not found
     */
    getCommand(name: string): RegisteredCommand | undefined {
        return this.commands.get(name);
    }

    /**
     * Get all registered commands
     * @returns Array of all registered commands
     */
    getAllCommands(): RegisteredCommand[] {
        return Array.from(this.commands.values());
    }

    /**
     * Get capabilities in ACP format
     * @returns Array of command capabilities
     */
    getCapabilities(): CommandCapability[] {
        return Array.from(this.commands.values()).map(cmd => ({
            name: cmd.name,
            description: cmd.description,
            parameters: cmd.parameters,
            returns: {
                status: "string",
                message: "string",
                data: "any",
            },
        }));
    }

    /**
     * Register all default Studio 3D commands
     */
    private registerDefaultCommands(): void {
        // ===== OBJECT CREATION & MANIPULATION COMMANDS =====
        this.registerCommand({
            name: SupportedCommands.CreatePrimitive,
            description: "Create a new 3D primitive object in the scene (cube, sphere, cylinder, plane, etc.)",
            parameters: [
                {
                    name: "type",
                    type: "string",
                    description:
                        "Object type: 'box', 'sphere', 'cylinder', 'cone', 'plane', 'torus', 'torusKnot', 'triangle', 'capsule', 'icosahedron', 'octahedron', 'dodecahedron', 'ring'",
                    required: true,
                },
                {name: "name", type: "string", description: "Name for the object", required: false},
                {name: "position", type: "object", description: "Position {x, y, z}", required: false},
                {
                    name: "size",
                    type: "object",
                    description:
                        "Geometry dimensions {x, y, z}. Sets the actual geometry size (e.g., box width/height/depth, sphere radius via x). Unlike scale, this changes the geometry itself.",
                    required: false,
                },
                {
                    name: "widthSegments",
                    type: "number",
                    description: "Optional horizontal subdivision count for supported primitives such as box, plane, and sphere.",
                    required: false,
                },
                {
                    name: "heightSegments",
                    type: "number",
                    description: "Optional vertical subdivision count for supported primitives such as box, plane, sphere, cylinder, and cone.",
                    required: false,
                },
                {
                    name: "depthSegments",
                    type: "number",
                    description: "Optional depth subdivision count for box primitives.",
                    required: false,
                },
                {
                    name: "radialSegments",
                    type: "number",
                    description: "Optional radial subdivision count for cylinder, cone, torus, torusKnot, and capsule primitives.",
                    required: false,
                },
                {
                    name: "tubularSegments",
                    type: "number",
                    description: "Optional tubular subdivision count for torus and torusKnot primitives.",
                    required: false,
                },
                {
                    name: "thetaSegments",
                    type: "number",
                    description: "Optional angular subdivision count for ring primitives.",
                    required: false,
                },
                {
                    name: "phiSegments",
                    type: "number",
                    description: "Optional radial band count for ring primitives.",
                    required: false,
                },
                {
                    name: "capSegments",
                    type: "number",
                    description: "Optional cap subdivision count for capsule primitives.",
                    required: false,
                },
                {name: "scale", type: "object", description: "Scale {x, y, z}", required: false},
                {name: "rotation", type: "object", description: "Rotation {x, y, z} in radians", required: false},
                {name: "color", type: "string", description: "Hex color (e.g., '#ff0000')", required: false},
                {name: "parent", type: "string", description: "Parent object name or UUID", required: false},
                {
                    name: "objectSettings",
                    type: "object",
                    description:
                        "Optional object settings: { isBatchable?: boolean, isStatic?: boolean, isSelectable?: boolean, enableAtStart?: boolean, visibleByAI?: boolean, gameVisibility?: boolean, EnableMorphing?: boolean }",
                    required: false,
                },
            ],
            handler: async params => this.objectHandlers.handleCreatePrimitive(params),
        });

        this.registerCommand({
            name: SupportedCommands.CreateGroup,
            description: "Create a new empty group (container) in the scene for organizing objects",
            parameters: [
                {name: "name", type: "string", description: "Name for the group", required: false},
                {name: "position", type: "object", description: "Position {x, y, z}", required: false},
                {name: "scale", type: "object", description: "Scale {x, y, z}", required: false},
                {name: "rotation", type: "object", description: "Rotation {x, y, z} in radians", required: false},
                {name: "parent", type: "string", description: "Parent object name or UUID", required: false},
                {
                    name: "objectSettings",
                    type: "object",
                    description:
                        "Optional object settings: { isBatchable?: boolean, isStatic?: boolean, isSelectable?: boolean, enableAtStart?: boolean, visibleByAI?: boolean, gameVisibility?: boolean, EnableMorphing?: boolean }",
                    required: false,
                },
            ],
            handler: async params => this.objectHandlers.handleCreateGroup(params),
        });

        this.registerCommand({
            name: SupportedCommands.CloneObject,
            description: "Clone an existing object in the scene by name or UUID",
            parameters: [
                {name: "target", type: "string", description: "Object name or UUID to clone", required: true},
                {
                    name: "position",
                    type: "object",
                    description: "Position {x, y, z} for the cloned object",
                    required: false,
                },
            ],
            handler: async params => this.objectHandlers.handleCloneObject(params),
        });

        this.registerCommand({
            name: SupportedCommands.DeleteObject,
            description: "Delete an object from the scene by name or UUID",
            parameters: [
                {name: "target", type: "string", description: "Object name or UUID to delete", required: true},
            ],
            handler: async params => this.objectHandlers.handleDeleteObject(params),
        });

        this.registerCommand({
            name: SupportedCommands.MoveObject,
            description: "Move an object to a different parent in the scene hierarchy",
            parameters: [
                {name: "target", type: "string", description: "Object name or UUID to move", required: true},
                {
                    name: "parent",
                    type: "string",
                    description: "UUID or name of new parent object, or null to move to scene root",
                    required: true,
                },
                {
                    name: "keepLocalSpace",
                    type: "boolean",
                    description:
                        "Whether to keep local transform when reparenting. Default: true. Set false to preserve world transform.",
                    required: false,
                    default: true,
                },
            ],
            handler: async params => this.objectHandlers.handleMoveObject(params),
        });

        this.registerCommand({
            name: SupportedCommands.ModifyObject,
            description: "Modify properties of an existing object (position, rotation, scale, color)",
            parameters: [
                {name: "target", type: "string", description: "Object name or UUID", required: true},
                {name: "position", type: "object", description: "New position {x, y, z}", required: false},
                {name: "rotation", type: "object", description: "New rotation {x, y, z} in radians", required: false},
                {name: "scale", type: "object", description: "New scale {x, y, z}", required: false},
                {name: "color", type: "string", description: "New hex color", required: false},
                {name: "name", type: "string", description: "New name", required: false},
                {name: "tag", type: "string", description: "Tag or array of tags to add to the object", required: false},
                {
                    name: "objectSettings",
                    type: "object",
                    description:
                        "Optional object settings: { isBatchable?: boolean, isStatic?: boolean, isSelectable?: boolean, enableAtStart?: boolean, visibleByAI?: boolean, gameVisibility?: boolean, EnableMorphing?: boolean }",
                    required: false,
                },
            ],
            handler: params => Promise.resolve(this.objectHandlers.handleModifyObject(params)),
        });

        // ===== SCENE QUERY COMMANDS =====
        this.registerCommand({
            name: SupportedCommands.GetSceneObjects,
            description: "Get list of all objects in the scene with their properties",
            parameters: [
                {name: "filter", type: "string", description: "Optional filter by name pattern", required: false},
            ],
            handler: params => Promise.resolve(this.objectHandlers.handleSceneGetObjects(params)),
        });

        this.registerCommand({
            name: SupportedCommands.GetObject,
            description: "Get detailed information about a specific object",
            parameters: [{name: "target", type: "string", description: "Object name or UUID", required: true}],
            handler: params => Promise.resolve(this.objectHandlers.handleGetObject(params)),
        });

        this.registerCommand({
            name: SupportedCommands.GetObjectSettings,
            description:
                "Get compact, script-verifiable settings for an object: transform, kind, geometry, material, physics, behaviors, tags, and object userData settings",
            parameters: [
                {name: "target", type: "string", description: "Object name or UUID", required: true},
                {
                    name: "kind",
                    type: "string",
                    description: "Optional expected object kind such as box, sphere, group, mesh, camera, or light",
                    required: false,
                },
            ],
            handler: params => Promise.resolve(this.objectHandlers.handleGetObjectSettings(params)),
        });

        this.registerCommand({
            name: SupportedCommands.GetMaterialSettings,
            description: "Get compact material and texture override settings for an object",
            parameters: [{name: "target", type: "string", description: "Object name or UUID", required: true}],
            handler: params => Promise.resolve(this.objectHandlers.handleGetMaterialSettings(params)),
        });

        this.registerCommand({
            name: SupportedCommands.GetBehaviorSettings,
            description: "Get behaviors attached to an object, optionally filtered by behaviorId or behavior UUID",
            parameters: [
                {name: "target", type: "string", description: "Object name or UUID", required: true},
                {name: "behaviorId", type: "string", description: "Optional behavior id or behavior UUID", required: false},
            ],
            handler: params => Promise.resolve(this.objectHandlers.handleGetBehaviorSettings(params)),
        });

        this.registerCommand({
            name: SupportedCommands.GetSelectedObject,
            description: "Get the currently selected object in the editor",
            parameters: [],
            handler: () => Promise.resolve(this.objectHandlers.handleGetSelectedObject()),
        });

        this.registerCommand({
            name: SupportedCommands.GetPlayer,
            description: "Get the player object data",
            parameters: [],
            handler: () => Promise.resolve(this.objectHandlers.handleGetPlayer()),
        });

        this.registerCommand({
            name: SupportedCommands.ListSceneAssets,
            description:
                "List imported scene/stem assets such as models, behavior packs, lambda packs, script imports, files, media, VFX, and prefabs",
            parameters: [
                {
                    name: "type",
                    type: "string",
                    description:
                        "Optional asset type filter: all, model/models, import/imports/script/scripts, file/files, behavior/behaviors, lambda/lambdas, pack/packs, media, image, audio, video, vfx, prefab/stem",
                    required: false,
                },
                {name: "filter", type: "string", description: "Optional filter by id, name, description, tag, or type", required: false},
                {name: "limit", type: "number", description: "Maximum assets to return (default 80, max 200)", required: false},
            ],
            handler: params => this.assetHandlers.handleListSceneAssets(params),
        });

        this.registerCommand({
            name: SupportedCommands.GetSceneAsset,
            description: "Get compact metadata for one imported scene/stem asset by assetId, revisionId, or name",
            parameters: [
                {name: "assetId", type: "string", description: "Asset id, revision id, or exact name", required: false},
                {name: "name", type: "string", description: "Asset name when assetId is omitted", required: false},
                {name: "type", type: "string", description: "Optional asset type filter", required: false},
            ],
            handler: params => this.assetHandlers.handleGetSceneAsset(params),
        });

        this.registerCommand({
            name: SupportedCommands.ListLambdas,
            description: "List all available lambdas with optional filtering",
            parameters: [
                {name: "filter", type: "string", description: "Optional filter by id or name pattern", required: false},
            ],
            handler: params => Promise.resolve(this.lambdaHandlers.handleListLambdas(params)),
        });

        this.registerCommand({
            name: SupportedCommands.GetLambda,
            description: "Get detailed information about a specific lambda by ID, optionally including code when available",
            parameters: [
                {name: "lambdaId", type: "string", description: "ID of the lambda", required: true},
                {name: "includeCode", type: "boolean", description: "Try to include lambda source code", required: false},
            ],
            handler: params => this.lambdaHandlers.handleGetLambda(params),
        });

        // ===== MATERIAL & TEXTURE COMMANDS =====
        this.registerCommand({
            name: SupportedCommands.SetMaterial,
            description: "Set or modify material properties of an object",
            parameters: [
                {name: "target", type: "string", description: "Object name or UUID", required: true},
                {name: "color", type: "string", description: "Hex color", required: false},
                {name: "opacity", type: "number", description: "Opacity (0-1)", required: false},
                {name: "metalness", type: "number", description: "Metalness (0-1)", required: false},
                {name: "roughness", type: "number", description: "Roughness (0-1)", required: false},
                {
                    name: "tileAmountX",
                    type: "number",
                    description: "Texture repeat multiplier on X (defaults to 1 when material settings are first created)",
                    required: false,
                    default: 1,
                },
                {
                    name: "tileAmountY",
                    type: "number",
                    description: "Texture repeat multiplier on Y (defaults to 1 when material settings are first created)",
                    required: false,
                    default: 1,
                },
                {
                    name: "panningSpeedX",
                    type: "number",
                    description: "Texture offset on X (defaults to 1 when material settings are first created)",
                    required: false,
                    default: 1,
                },
                {
                    name: "panningSpeedY",
                    type: "number",
                    description: "Texture offset on Y (defaults to 1 when material settings are first created)",
                    required: false,
                    default: 1,
                },
            ],
            handler: params => Promise.resolve(this.objectHandlers.handleSetMaterial(params)),
        });

        this.registerCommand({
            name: SupportedCommands.SetTexture,
            description: "Apply an asset-backed texture override to an object or model via material settings",
            parameters: [
                {name: "target", type: "string", description: "Object name or UUID", required: true},
                {
                    name: "textureUrl",
                    type: "string",
                    description: "Texture URL/path, scene image asset name, or image asset ID",
                    required: false,
                },
                {
                    name: "imageAsset",
                    type: "string",
                    description: "Name or ID of an imported scene image asset to use as texture",
                    required: false,
                },
                {
                    name: "textureType",
                    type: "string",
                    description:
                        "Persisted material texture channel: 'map'/'base', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'specularMap', or 'arm'/'orm'",
                    required: false,
                    default: "map",
                },
            ],
            handler: async params => this.objectHandlers.handleSetTexture(params),
        });

        this.registerCommand({
            name: SupportedCommands.SetExternalTexture,
            description: "Apply texture or HDRI from external providers (Polyhaven, etc.) to an object",
            parameters: [
                {name: "target", type: "string", description: "Object name or UUID", required: true},
                {name: "assetId", type: "string", description: "Asset ID from the external provider", required: true},
                {name: "assetType", type: "string", description: "Asset type: 'textures' or 'hdris'", required: true},
                {name: "name", type: "string", description: "Name of the texture/HDRI", required: true},
                {
                    name: "provider",
                    type: "string",
                    description: "Provider: 'polyhaven' or other supported providers",
                    required: true,
                },
            ],
            handler: async params => this.objectHandlers.handleSetExternalTexture(params),
        });

        // ===== BEHAVIOR COMMANDS =====
        this.registerCommand({
            name: SupportedCommands.ListBehaviors,
            description: "List all available behaviors with optional filtering",
            parameters: [
                {name: "filter", type: "string", description: "Optional filter by id or name pattern", required: false},
            ],
            handler: params => Promise.resolve(this.behaviorHandlers.handleListBehaviors(params)),
        });

        this.registerCommand({
            name: SupportedCommands.GetBehavior,
            description: "Get detailed information about a specific behavior by ID",
            parameters: [{name: "behaviorId", type: "string", description: "ID of the behavior", required: true}],
            handler: params => Promise.resolve(this.behaviorHandlers.handleGetBehavior(params)),
        });

        this.registerCommand({
            name: SupportedCommands.AddBehavior,
            description: "Add a new behavior to the registry",
            parameters: [
                {name: "name", type: "string", description: "Name of the behavior", required: true},
                {name: "code", type: "string", description: "Behavior code/script", required: true},
                {name: "metadata", type: "object", description: "Metadata for the behavior", required: false},
                {name: "version", type: "string", description: "Version of the behavior", required: false},
                {name: "description", type: "string", description: "Description of the behavior", required: false},
                {name: "author", type: "string", description: "Author of the behavior", required: false},
            ],
            handler: async params => this.behaviorHandlers.handleAddBehavior(params),
        });

        this.registerCommand({
            name: SupportedCommands.UpdateBehavior,
            description: "Update an existing behavior in the registry, creating a new revision",
            parameters: [
                {name: "behaviorId", type: "string", description: "ID of the behavior to update", required: true},
                {name: "code", type: "string", description: "Updated behavior code/script", required: true},
                {name: "name", type: "string", description: "Updated name of the behavior", required: false},
                {name: "metadata", type: "object", description: "Updated metadata for the behavior", required: false},
                {name: "version", type: "string", description: "Updated version of the behavior", required: false},
                {
                    name: "description",
                    type: "string",
                    description: "Updated description of the behavior",
                    required: false,
                },
                {name: "author", type: "string", description: "Updated author of the behavior", required: false},
            ],
            handler: async params => this.behaviorHandlers.handleUpdateBehavior(params),
        });

        this.registerCommand({
            name: SupportedCommands.AttachBehavior,
            description: "Attach a behavior script to an object",
            parameters: [
                {name: "target", type: "string", description: "Object name or UUID", required: true},
                {name: "behaviorId", type: "string", description: "ID of behavior to attach", required: true},
                {name: "config", type: "object", description: "Behavior configuration parameters", required: false},
            ],
            handler: async params => this.behaviorHandlers.handleAttachBehavior(params),
        });

        this.registerCommand({
            name: SupportedCommands.AddNavMesh,
            description: "Create or configure the singleton NavMesh behavior on a scene object",
            parameters: [
                {
                    name: "target",
                    type: "string",
                    description: "Scene object name or UUID to own the navmesh behavior (defaults to Default Scene)",
                    required: false,
                },
                {name: "enabled", type: "boolean", description: "Enable navmesh generation", required: false},
                {name: "cellSize", type: "number", description: "Horizontal navmesh precision", required: false},
                {name: "cellHeight", type: "number", description: "Vertical navmesh precision", required: false},
                {name: "agentHeight", type: "number", description: "Supported agent height", required: false},
                {name: "agentRadius", type: "number", description: "Supported agent radius", required: false},
                {name: "agentMaxClimb", type: "number", description: "Maximum climb step height", required: false},
                {name: "agentMaxSlope", type: "number", description: "Maximum walkable slope angle", required: false},
                {name: "regionMinSize", type: "number", description: "Minimum region size", required: false},
                {name: "regionMergeSize", type: "number", description: "Region merge threshold", required: false},
                {name: "edgeMaxLen", type: "number", description: "Maximum polygon edge length", required: false},
                {name: "edgeMaxError", type: "number", description: "Maximum simplification error", required: false},
                {name: "vertsPerPoly", type: "number", description: "Maximum polygon vertices", required: false},
                {name: "detailSampleDist", type: "number", description: "Detail sample distance", required: false},
                {name: "detailSampleMaxError", type: "number", description: "Detail sample error threshold", required: false},
                {name: "autoGenerate", type: "boolean", description: "Auto rebuild when scene changes", required: false},
                {name: "onlyPhysicsMeshes", type: "boolean", description: "Bake only physics-enabled meshes", required: false},
                {name: "debugVisualization", type: "boolean", description: "Show navmesh debug wireframe", required: false},
            ],
            handler: async params => this.behaviorHandlers.handleAddNavMesh(params),
        });

        this.registerCommand({
            name: SupportedCommands.RebuildNavMesh,
            description: "Trigger a NavMesh regeneration on the target scene object",
            parameters: [
                {
                    name: "target",
                    type: "string",
                    description: "Scene object name or UUID that owns the navmesh behavior (defaults to Default Scene)",
                    required: false,
                },
            ],
            handler: params => Promise.resolve(this.behaviorHandlers.handleRebuildNavMesh(params)),
        });

        this.registerCommand({
            name: SupportedCommands.AddNavMeshConnection,
            description: "Attach a navmesh-connection behavior between two scene objects",
            parameters: [
                {
                    name: "source",
                    type: "string",
                    description: "Source object name or UUID that owns the connection behavior",
                    required: true,
                },
                {
                    name: "target",
                    type: "string",
                    description: "Destination object name or UUID for the off-mesh connection",
                    required: true,
                },
                {name: "enabled", type: "boolean", description: "Enable or disable the connection", required: false},
                {name: "bidirectional", type: "boolean", description: "Allow travel in both directions", required: false},
                {name: "radius", type: "number", description: "Connection snap/search radius", required: false},
                {name: "showConnection", type: "boolean", description: "Show the editor visualization", required: false},
            ],
            handler: async params => this.behaviorHandlers.handleAddNavMeshConnection(params),
        });

        this.registerCommand({
            name: SupportedCommands.AddWaypointPath,
            description: "Create or configure a waypoint path group for AI or custom behaviors",
            parameters: [
                {name: "name", type: "string", description: "Waypoint path object name", required: true},
                {name: "position", type: "object", description: "Path origin {x, y, z}", required: false},
                {name: "parent", type: "string", description: "Optional parent object name or UUID", required: false},
                {name: "loop", type: "boolean", description: "Whether the path should loop", required: false},
            ],
            handler: async params => this.behaviorHandlers.handleAddWaypointPath(params),
        });

        this.registerCommand({
            name: SupportedCommands.AddWaypoint,
            description: "Create a waypoint marker under a waypoint path group",
            parameters: [
                {name: "path", type: "string", description: "Waypoint path object name or UUID", required: true},
                {name: "name", type: "string", description: "Waypoint object name", required: false},
                {name: "position", type: "object", description: "Waypoint position {x, y, z}", required: true},
                {name: "order", type: "number", description: "Explicit waypoint order", required: false},
                {name: "waitTime", type: "number", description: "Optional dwell time at this point", required: false},
                {name: "arrivalRadius", type: "number", description: "Optional arrival radius", required: false},
            ],
            handler: async params => this.behaviorHandlers.handleAddWaypoint(params),
        });

        this.registerCommand({
            name: SupportedCommands.DetachBehavior,
            description: "Remove a behavior from an object",
            parameters: [
                {name: "target", type: "string", description: "Object name or UUID", required: true},
                {name: "behaviorId", type: "string", description: "ID of behavior to remove", required: true},
            ],
            handler: async params => this.behaviorHandlers.handleDetachBehavior(params),
        });

        this.registerCommand({
            name: SupportedCommands.RemoveBehavior,
            description: "Remove a behavior from the registry",
            parameters: [{name: "behaviorId", type: "string", description: "ID of behavior to remove", required: true}],
            handler: async params => this.behaviorHandlers.handleRemoveBehavior(params),
        });

        this.registerCommand({
            name: SupportedCommands.SetBehaviorConfig,
            description: "Update configuration parameters for a behavior attached to an object",
            parameters: [
                {name: "target", type: "string", description: "Object name or UUID", required: true},
                {name: "behaviorId", type: "string", description: "ID of behavior to update", required: true},
                {
                    name: "attributesData",
                    type: "object",
                    description: "New behavior attributes configuration",
                    required: false,
                },
                {
                    name: "config",
                    type: "object",
                    description: "Alias for attributesData, used by StemScript behavior config commands",
                    required: false,
                },
                {name: "enabled", type: "boolean", description: "Whether the behavior is enabled", required: false},
            ],
            handler: params => Promise.resolve(this.behaviorHandlers.handleSetTargetBehaviorConfig(params)),
        });

        // ===== PHYSICS COMMANDS =====
        this.registerCommand({
            name: SupportedCommands.EnablePhysics,
            description: "Enable physics simulation for a 3D object",
            parameters: [
                {name: "target", type: "string", description: "Object name or UUID (must be a mesh or group, not a light or camera)", required: true},
                {
                    name: "config",
                    type: "object",
                    description: "Optional physics config to apply while enabling, equivalent to physics set config={...}",
                    required: false,
                },
                {name: "shape", type: "string", description: "Optional friendly collider shape, such as box, sphere, capsule, convexHull, or concaveHull", required: false},
                {name: "ctype", type: "string", description: "Optional collision type: static, dynamic, or kinematic", required: false},
                {name: "mass", type: "number", description: "Optional rigid body mass", required: false},
                {name: "friction", type: "number", description: "Optional friction value", required: false},
                {name: "restitution", type: "number", description: "Optional restitution/bounce value", required: false},
            ],
            handler: async params => this.physicsHandlers.handleEnablePhysics(params),
        });

        this.registerCommand({
            name: SupportedCommands.DisablePhysics,
            description: "Disable physics simulation for a 3D object",
            parameters: [{name: "target", type: "string", description: "Object name or UUID (must be a mesh or group, not a light or camera)", required: true}],
            handler: async params => this.physicsHandlers.handleDisablePhysics(params),
        });

        this.registerCommand({
            name: SupportedCommands.SetPhysics,
            description:
                "Configure detailed physics properties for a 3D object (shape, mass, friction, restitution, collision type, etc.)",
            parameters: [
                {name: "target", type: "string", description: "Object name or UUID (must be a mesh or group, not a light or camera)", required: true},
                {
                    name: "config",
                    type: "object",
                    description:
                        "Physics configuration object with properties like enabled, shape, mass, friction, restitution, ctype, etc.",
                    required: false,
                },
                {name: "enabled", type: "boolean", description: "Direct shorthand for config.enabled", required: false},
                {name: "shape", type: "string", description: "Direct shorthand for config.shape", required: false},
                {name: "ctype", type: "string", description: "Direct shorthand for config.ctype", required: false},
                {name: "mass", type: "number", description: "Direct shorthand for config.mass", required: false},
                {name: "friction", type: "number", description: "Direct shorthand for config.friction", required: false},
                {name: "restitution", type: "number", description: "Direct shorthand for config.restitution", required: false},
            ],
            handler: async params => this.physicsHandlers.handleSetPhysics(params),
        });

        this.registerCommand({
            name: SupportedCommands.GetPhysicsSettings,
            description: "Get physics settings stored on an object",
            parameters: [
                {name: "target", type: "string", description: "Object name or UUID", required: true},
            ],
            handler: params => Promise.resolve(this.physicsHandlers.handleGetPhysicsSettings(params)),
        });

        this.registerCommand({
            name: SupportedCommands.SetPhysicsEngine,
            description:
                "Set the scene-level physics engine (ammo | rapier | jolt | physx) and optionally scene gravity. Takes effect at next scene load.",
            parameters: [
                {
                    name: "type",
                    type: "string",
                    description: "Physics engine: 'ammo' (default) | 'rapier' | 'jolt' | 'physx'",
                    required: true,
                },
                {
                    name: "gravity",
                    type: "number",
                    description: "Scene gravity on the Y axis. Negative = down (Earth-like is -9.81). Optional — defaults retained when omitted.",
                    required: false,
                },
            ],
            handler: async params => this.physicsHandlers.handleSetPhysicsEngine(params),
        });

        this.registerCommand({
            name: SupportedCommands.SetSceneCompartments,
            description:
                "Toggle the scene-level SES compartment sandbox for behavior/lambda scripts. Disabled by default (DOT-7463).",
            parameters: [
                {
                    name: "enabled",
                    type: "boolean",
                    description: "true/on to enable compartments; false/off to disable.",
                    required: true,
                },
            ],
            handler: params => Promise.resolve(this.settingsHandlers.handleSetSceneCompartments(params)),
        });

        // ===== LIGHT COMMANDS =====
        this.registerCommand({
            name: SupportedCommands.SetLightProperties,
            description: "Set properties on a light object: intensity, color, castShadow, shadow map size, shadow bias",
            parameters: [
                {name: "target", type: "string", description: "Light object name or UUID (e.g. 'Directional')", required: true},
                {name: "intensity", type: "number", description: "Light intensity", required: false},
                {name: "color", type: "string", description: "Light color hex (e.g. '#ffffcc')", required: false},
                {name: "castShadow", type: "boolean", description: "Enable shadow casting", required: false},
                {name: "shadowMapSize", type: "number", description: "Shadow map resolution (e.g. 1024, 2048)", required: false},
                {name: "shadowBias", type: "number", description: "Shadow bias to reduce artifacts", required: false},
                {name: "shadowNormalBias", type: "number", description: "Shadow normal bias", required: false},
                {name: "shadowRadius", type: "number", description: "Shadow softness radius", required: false},
            ],
            handler: params => Promise.resolve(this.lightHandlers.handleSetLightProperties(params)),
        });

        this.registerCommand({
            name: SupportedCommands.GetLightSettings,
            description: "Get current settings for a light object",
            parameters: [
                {name: "target", type: "string", description: "Light object name or UUID", required: true},
            ],
            handler: params => Promise.resolve(this.lightHandlers.handleGetLightSettings(params)),
        });

        // ===== 3D MODEL GENERATION & ASSETS =====
        this.registerCommand({
            name: SupportedCommands.Generate3DModel,
            description: "Generate a 3D model using AI from text description",
            parameters: [
                {
                    name: "prompt",
                    type: "string",
                    description: "Description of the 3D model to generate",
                    required: true,
                },
                {name: "name", type: "string", description: "Name for the generated model", required: false},
                {name: "position", type: "object", description: "Position to place the model", required: false},
                {
                    name: "parent",
                    type: "string",
                    description: "Parent object name or UUID to attach the model",
                    required: false,
                },
                {
                    name: "provider",
                    type: "string",
                    description: "Generation provider: meshy, tripo, or rodin (defaults to meshy)",
                    required: false,
                },
            ],
            handler: async params => this.objectHandlers.handleGenerate3DModel(params),
        });

        this.registerCommand({
            name: SupportedCommands.SearchLocalAssets,
            description: "Search for assets in the library by tag phrases. Supports different asset types.",
            parameters: [
                {
                    name: "phrases",
                    type: "array",
                    description: "Array of search phrases (tags) that describe the desired asset",
                    required: true,
                },
                {
                    name: "type",
                    type: "string",
                    description:
                        "Type of asset to search for: 'model' (3D models, default), 'audio', 'image', 'behavior', 'prefab', 'vfx'",
                    required: false,
                },
            ],
            handler: async params => this.objectHandlers.handleSearchLocalAssets(params),
        });

        this.registerCommand({
            name: SupportedCommands.GetLibraryAsset,
            description: "Get detailed information about a specific asset from the library by its ID",
            parameters: [
                {
                    name: "assetId",
                    type: "string",
                    description: "The ID of the asset to retrieve",
                    required: true,
                },
            ],
            handler: async params => this.objectHandlers.handleGetLibraryAsset(params),
        });

        this.registerCommand({
            name: SupportedCommands.SearchExternalAssets,
            description: "Search for 3D models and assets from external providers",
            parameters: [
                {
                    name: "prompt",
                    type: "string",
                    description: "Search prompt describing the desired asset",
                    required: true,
                },
                {
                    name: "provider",
                    type: "string",
                    description: "Provider to search from: 'sketchfab', 'polyhaven', 'meshy', 'local'",
                    required: false,
                },
            ],
            handler: async params => this.objectHandlers.handleSearchExternalAssets(params),
        });

        this.registerCommand({
            name: SupportedCommands.AddModelToScene,
            description:
                "Add a 3D model from an external provider (Sketchfab, Polyhaven, Meshy, or Local) to the scene",
            parameters: [
                {
                    name: "id",
                    type: "string",
                    description: "Asset ID from the external provider",
                    required: true,
                },
                {
                    name: "name",
                    type: "string",
                    description: "Name for the model in the scene",
                    required: true,
                },
                {
                    name: "provider",
                    type: "string",
                    description: "Provider: 'sketchfab', 'polyhaven', 'meshy' or 'local'",
                    required: true,
                },
                {
                    name: "downloadUrl",
                    type: "string",
                    description:
                        "Download URL for the model. Required for 'local' provider. For other providers use empty string.",
                    required: true,
                },
                {
                    name: "position",
                    type: "object",
                    description: "Position {x, y, z} to place the model in the scene",
                    required: false,
                },
                {
                    name: "width",
                    type: "number",
                    description: "Width of the model (default: 1)",
                    required: false,
                },
                {
                    name: "height",
                    type: "number",
                    description: "Height of the model (default: 1)",
                    required: false,
                },
                {name: "parent", type: "string", description: "Parent object name or UUID", required: false},
            ],
            handler: async params => this.objectHandlers.handleAddModelToScene(params),
        });

        // ===== VFX (PARTICLE SYSTEMS) =====
        this.registerCommand({
            name: SupportedCommands.AddVFX,
            description:
                "Create a new particle system VFX effect. Put emitter shape data in config.shape as a typed descriptor like {type:\"PointEmitter\"} or {type:\"CircleEmitter\",radius:1}. Do not write raw objects to config.emitterShape. config.autoPlay/autoplay/autoStart are copied to the created emitter userData for runtime auto-start behavior.",
            parameters: [
                {name: "name", type: "string", description: "Name for the VFX", required: true},
                {name: "position", type: "object", description: "Position {x, y, z}", required: false},
                {
                    name: "config",
                    type: "object",
                    description:
                        "Custom particle system configuration. Use config.shape for emitter shapes, not config.emitterShape. Shape values must be typed emitter descriptors like {type:\"PointEmitter\"}, {type:\"SphereEmitter\",radius:1.5}, or {type:\"CircleEmitter\",radius:0.75}.",
                    required: false,
                },
            ],
            handler: async params => this.vfxHandlers.handleAddVFX(params),
        });

        this.registerCommand({
            name: SupportedCommands.ModifyVFX,
            description:
                "Modify properties of an existing VFX (particle emitter). All ParticleSystem parameters (duration, looping, worldSpace, emissionOverTime, startLife, startSpeed, startSize, startColor, shape, material, etc.) must be passed in 'config'. Use config.shape for emitter shapes, not raw config.emitterShape objects. config.autoPlay/autoplay/autoStart update emitter userData flags for runtime auto-start behavior. Behaviors cannot be modified here - use add_vfx_behavior/remove_vfx_behavior instead.",
            parameters: [
                {name: "target", type: "string", description: "VFX emitter name or UUID", required: true},
                {name: "position", type: "object", description: "New position {x, y, z}", required: false},
                {name: "rotation", type: "object", description: "New rotation {x, y, z} in radians", required: false},
                {name: "scale", type: "object", description: "New scale {x, y, z}", required: false},
                {
                    name: "config",
                    type: "object",
                    description:
                        "ParticleSystem configuration object. Supports all ParticleSystemParameters: duration, looping, worldSpace, emissionOverTime, emissionOverDistance, startLife, startSpeed, startSize, startLength, startColor, startRotation, shape, material (with texture map support), renderMode, emissionBursts, autoDestroy, prewarm, onlyUsedByOther, speedFactor, renderOrder, uTileCount, vTileCount, blendTiles, softParticles, softFarFade, softNearFade, etc. Put emitter shapes in config.shape as typed descriptors like {type:\"PointEmitter\"} or {type:\"CircleEmitter\",radius:1}. Do NOT include 'behaviors' - use add_vfx_behavior instead. Material can include 'map' field with Base64 or percent-encoded data URL for textures.",
                    required: false,
                },
                {
                    name: "action",
                    type: "string",
                    description: "Playback control: 'play', 'stop', 'pause', 'restart'",
                    required: false,
                },
            ],
            handler: async params => this.vfxHandlers.handleModifyVFX(params),
        });

        this.registerCommand({
            name: SupportedCommands.DeleteVFX,
            description: "Remove a VFX particle system",
            parameters: [{name: "target", type: "string", description: "VFX name or UUID", required: true}],
            handler: async params => this.vfxHandlers.handleDeleteVFX(params),
        });

        this.registerCommand({
            name: SupportedCommands.GetVFX,
            description: "Get information about a VFX particle system",
            parameters: [{name: "target", type: "string", description: "VFX name or UUID", required: true}],
            handler: params => Promise.resolve(this.vfxHandlers.handleGetVFX(params)),
        });

        this.registerCommand({
            name: SupportedCommands.AddVFXBehavior,
            description: "Add a behavior to a VFX particle system",
            parameters: [
                {name: "target", type: "string", description: "VFX name or UUID", required: true},
                {
                    name: "behaviorType",
                    type: "string",
                    description: "Behavior type (e.g., ColorOverLife, SizeOverLife, RotationOverLife)",
                    required: true,
                },
                {name: "config", type: "object", description: "Behavior configuration", required: true},
            ],
            handler: params => Promise.resolve(this.vfxHandlers.handleAddVFXBehavior(params)),
        });

        this.registerCommand({
            name: SupportedCommands.RemoveVFXBehavior,
            description: "Remove a behavior from a VFX particle system",
            parameters: [
                {name: "target", type: "string", description: "VFX name or UUID", required: true},
                {name: "behaviorIndex", type: "number", description: "Index of behavior to remove", required: true},
            ],
            handler: params => Promise.resolve(this.vfxHandlers.handleRemoveVFXBehavior(params)),
        });

        // ===== STEM COMMANDS =====
        this.registerCommand({
            name: SupportedCommands.ListPrefabs,
            description: "List all prefabs in the current scene with optional filtering",
            parameters: [
                {name: "filter", type: "string", description: "Optional filter by name or id pattern", required: false},
            ],
            handler: async params => this.prefabHandlers.handleListPrefabs(params),
        });

        this.registerCommand({
            name: SupportedCommands.GetPrefab,
            description: "Get detailed information about a specific prefab by ID",
            parameters: [{name: "id", type: "string", description: "ID of the prefab", required: true}],
            handler: async params => this.prefabHandlers.handleGetPrefab(params),
        });

        this.registerCommand({
            name: SupportedCommands.AddPrefabToScene,
            description: "Add an existing prefab to the scene at a specific position",
            parameters: [
                {name: "id", type: "string", description: "ID of the prefab to add", required: true},
                {
                    name: "position",
                    type: "object",
                    description: "Position {x, y, z} for the prefab instance",
                    required: false,
                },
                {name: "name", type: "string", description: "Optional name for the prefab instance", required: false},
            ],
            handler: async params => this.prefabHandlers.handleAddPrefabToScene(params),
        });

        this.registerCommand({
            name: SupportedCommands.CreatePrefab,
            description: "Create a new prefab from an existing object in the scene",
            parameters: [
                {
                    name: "target",
                    type: "string",
                    description: "Object name or UUID to convert to prefab",
                    required: true,
                },
                {
                    name: "name",
                    type: "string",
                    description: "Optional name for the prefab (defaults to object name)",
                    required: false,
                },
                {
                    name: "createThumbnail",
                    type: "boolean",
                    description: "Whether to create a thumbnail (default: true)",
                    required: false,
                },
            ],
            handler: async params => this.prefabHandlers.handleCreatePrefab(params),
        });

        // ===== EDITOR SETTINGS COMMANDS =====
        this.registerCommand({
            name: SupportedCommands.SetSceneLighting,
            description: "Configure scene lighting: ambient light, hemisphere light, and shadow settings",
            parameters: [
                {
                    name: "ambient",
                    type: "object",
                    description: "Ambient light config {color?: string, intensity?: number}",
                    required: false,
                },
                {
                    name: "hemisphere",
                    type: "object",
                    description:
                        "Hemisphere light config {skyColor?: string, groundColor?: string, intensity?: number}",
                    required: false,
                },
                {
                    name: "shadows",
                    type: "object",
                    description: "Shadow config {enabled?: boolean, mapType?: number}. Use numeric THREE constants for mapType: 0=Basic, 1=PCF, 2=PCFSoft, 3=VSM.",
                    required: false,
                },
            ],
            handler: async params => this.settingsHandlers.handleSetSceneLighting(params),
        });

        this.registerCommand({
            name: SupportedCommands.SetSceneFog,
            description: "Configure scene fog: type, color, near/far distances, density",
            parameters: [
                {
                    name: "type",
                    type: "string",
                    description: "Fog type: 'none', 'linear', or 'exponential'",
                    required: true,
                },
                {name: "color", type: "string", description: "Fog color hex (e.g., '#aaaaaa')", required: false},
                {name: "near", type: "number", description: "Fog start distance (linear fog)", required: false},
                {name: "far", type: "number", description: "Fog end distance (linear fog)", required: false},
                {name: "density", type: "number", description: "Fog density (exponential fog)", required: false},
            ],
            handler: async params => this.settingsHandlers.handleSetSceneFog(params),
        });

        this.registerCommand({
            name: SupportedCommands.SetSceneBackground,
            description:
                "Configure scene background: solid color, gradient, texture, or cubemap. `gradient` must be a CSS gradient string like `linear-gradient(...)`, not a JSON object.",
            parameters: [
                {
                    name: "type",
                    type: "string",
                    description: "Background type: 'Color', 'Texture', 'Cubemap', or 'Gradient'",
                    required: true,
                },
                {name: "color", type: "string", description: "Background color hex", required: false},
                {
                    name: "texture",
                    type: "string",
                    description: "Equirectangular background texture URL/path or imported image asset name",
                    required: false,
                },
                {
                    name: "cubemap",
                    type: "array",
                    description: "Cubemap face URLs/paths or imported image asset names in [+X, -X, +Y, -Y, +Z, -Z] order",
                    required: false,
                },
                {
                    name: "gradient",
                    type: "string",
                    description:
                        "CSS gradient string, e.g. `linear-gradient(180deg, #87CEEB 0%, #dfefff 100%)`. Do not pass a JSON gradient object here.",
                    required: false,
                },
                {
                    name: "gradientMode",
                    type: "string",
                    description: "Gradient render mode: '2d' or '3d'",
                    required: false,
                },
                {name: "rotation", type: "number", description: "Background rotation", required: false},
                {name: "intensity", type: "number", description: "Background intensity", required: false},
                {name: "blurriness", type: "number", description: "Background blurriness", required: false},
            ],
            handler: async params => this.settingsHandlers.handleSetSceneBackground(params),
        });

        this.registerCommand({
            name: SupportedCommands.SetToneMapping,
            description: "Configure tone mapping: type (None, Linear, Reinhard, Cineon, ACESFilmic) and exposure",
            parameters: [
                {
                    name: "type",
                    type: "string",
                    description: "Tone mapping type: 'None', 'Linear', 'Reinhard', 'Cineon', 'ACESFilmic'",
                    required: true,
                },
                {
                    name: "exposure",
                    type: "number",
                    description: "Tone mapping exposure (default: 1.0)",
                    required: false,
                },
            ],
            handler: async params => this.settingsHandlers.handleSetToneMapping(params),
        });

        this.registerCommand({
            name: SupportedCommands.SetPostProcessing,
            description: "Configure post-processing effects: ambient occlusion, bloom, screen-space reflections, depth of field, and outline",
            parameters: [
                {
                    name: "ao",
                    type: "object",
                    description: "Ambient occlusion config {enabled?, kernelRadius?, minDistance?, maxDistance?}",
                    required: false,
                },
                {
                    name: "bloom",
                    type: "object",
                    description: "Bloom config {enabled?, strength?, radius?, threshold?}",
                    required: false,
                },
                {
                    name: "ssr",
                    type: "object",
                    description: "SSR config {enabled?, resolutionScale?, maxDistance?, thickness?, opacity?, quality?, blur?, blurQuality?}",
                    required: false,
                },
                {
                    name: "dof",
                    type: "object",
                    description: "Depth of field config {enabled?, focusDistance?, focalLength?, bokehScale?}",
                    required: false,
                },
                {
                    name: "outline",
                    type: "object",
                    description: "Outline config {enabled?, edgeStrength?, edgeGlow?, edgeThickness?}",
                    required: false,
                },
            ],
            handler: params => Promise.resolve(this.settingsHandlers.handleSetPostProcessing(params)),
        });

        this.registerCommand({
            name: SupportedCommands.SetCameraSettings,
            description:
                "Configure camera settings on a specific object: FOV, clipping planes, camera type, distance, etc.",
            parameters: [
                {
                    name: "target",
                    type: "string",
                    description: "Camera object name or UUID (e.g. 'DefaultCamera'). Target must be a camera.",
                    required: true,
                },
                {name: "fov", type: "number", description: "Field of view in degrees", required: false},
                {name: "near", type: "number", description: "Near clipping plane", required: false},
                {name: "far", type: "number", description: "Far clipping plane", required: false},
                {
                    name: "cameraType",
                    type: "string",
                    description:
                        "Camera type: 'THIRD_PERSON', 'FIRST_PERSON', 'TOP_DOWN', 'SIDE_SCROLLER', 'NONE' (disables camera on object)",
                    required: false,
                },
                {name: "defaultDistance", type: "number", description: "Default camera distance", required: false},
                {name: "minDistance", type: "number", description: "Minimum camera distance", required: false},
                {name: "maxDistance", type: "number", description: "Maximum camera distance", required: false},
                {name: "headHeight", type: "number", description: "Camera head height (first-person)", required: false},
                {
                    name: "axis",
                    type: "string",
                    description: "Camera axis constraint (e.g., 'Z' for side-scroller)",
                    required: false,
                },
                {name: "occlusionType", type: "string", description: "Camera occlusion handling type", required: false},
            ],
            handler: params => Promise.resolve(this.settingsHandlers.handleSetCameraSettings(params)),
        });

        this.registerCommand({
            name: SupportedCommands.GetCameraSettings,
            description: "Get camera settings from a camera object, including DefaultCamera",
            parameters: [
                {
                    name: "target",
                    type: "string",
                    description: "Camera object name or UUID (e.g. 'DefaultCamera')",
                    required: true,
                },
            ],
            handler: params => Promise.resolve(this.settingsHandlers.handleGetCameraSettings(params)),
        });

        this.registerCommand({
            name: SupportedCommands.SetGameSettings,
            description: "Configure game rules: lives, score, timer, multiplayer, avatar, HUD, sandbox mode",
            parameters: [
                {name: "isGame", type: "boolean", description: "Mark the project as a game", required: false},
                {name: "enabled", type: "boolean", description: "Legacy alias for isGame", required: false},
                {name: "lives", type: "number", description: "Number of lives", required: false},
                {name: "maxScore", type: "number", description: "Maximum score to win", required: false},
                {name: "timer", type: "number", description: "Game timer in seconds (0 = no timer)", required: false},
                {name: "useAvatar", type: "boolean", description: "Use avatar system", required: false},
                {name: "isMultiplayer", type: "boolean", description: "Enable multiplayer", required: false},
                {name: "showHUD", type: "boolean", description: "Show HUD overlay", required: false},
                {name: "isSandbox", type: "boolean", description: "Enable sandbox mode", required: false},
                {name: "voiceChatEnabled", type: "boolean", description: "Enable voice chat", required: false},
            ],
            handler: params => Promise.resolve(this.settingsHandlers.handleSetGameSettings(params)),
        });

        this.registerCommand({
            name: SupportedCommands.SetProjectTitle,
            description: "Set the project/scene title",
            parameters: [
                {name: "title", type: "string", description: "The project title to set", required: true},
            ],
            handler: params => Promise.resolve(this.settingsHandlers.handleSetProjectTitle(params)),
        });

        this.registerCommand({
            name: SupportedCommands.SetSceneThumbnail,
            description:
                "Set the scene's Thumbnail metadata field to an image asset already declared in the scene's asset library. " +
                "The image must have been imported earlier with `import image name=\"<name>\" filepath=\"...\"`. " +
                "Resolves the asset's signed CDN URL and PATCHes the scene's Thumbnail field via the scene REST API.",
            parameters: [
                {
                    name: "name",
                    type: "string",
                    description: "Image asset name (case-insensitive). Convention: `ProjectCover`.",
                    required: true,
                },
            ],
            handler: params => this.settingsHandlers.handleSetSceneThumbnail(params),
        });

        this.registerCommand({
            name: SupportedCommands.SetRenderingSettings,
            description:
                "Configure rendering quality: shadows, instancing, shadow map type, physics worker. `shadowMapType` should be a numeric THREE constant: 0=Basic, 1=PCF, 2=PCFSoft, 3=VSM.",
            parameters: [
                {name: "useShadows", type: "boolean", description: "Enable shadow rendering", required: false},
                {name: "useInstancing", type: "boolean", description: "Enable GPU instancing", required: false},
                {
                    name: "shadowMapType",
                    type: "number",
                    description: "Shadow map type (THREE constant): 0=Basic, 1=PCF, 2=PCFSoft, 3=VSM",
                    required: false,
                },
                {name: "usePhysicsWorker", type: "boolean", description: "Run physics in web worker", required: false},
            ],
            handler: async params => this.settingsHandlers.handleSetRenderingSettings(params),
        });

        this.registerCommand({
            name: SupportedCommands.GetEditorSettings,
            description:
                "Get current editor settings by category: lighting, fog, background, toneMapping, postProcessing, game, rendering, or all",
            parameters: [
                {
                    name: "category",
                    type: "string",
                    description:
                        "Settings category: 'lighting', 'fog', 'background', 'toneMapping', 'postProcessing', 'game', 'rendering', or 'all'",
                    required: false,
                    default: "all",
                },
            ],
            handler: params => Promise.resolve(this.settingsHandlers.handleGetEditorSettings(params)),
        });

        this.registerCommand({
            name: SupportedCommands.GetSceneSetting,
            description:
                "Get a script-verifiable scene setting category, including outline, bloom, ao, dof, physics, compartments, and project title",
            parameters: [
                {
                    name: "category",
                    type: "string",
                    description:
                        "Scene setting category: lighting, fog, background, toneMapping, postProcessing, outline, bloom, ao, dof, game, rendering, physics, compartments, project, or all",
                    required: false,
                    default: "all",
                },
            ],
            handler: params => Promise.resolve(this.settingsHandlers.handleGetSceneSetting(params)),
        });

        this.registerCommand({
            name: SupportedCommands.ListProjectTasks,
            description: "List persisted Copilot project tasks for the current scene/project",
            parameters: [
                {name: "sceneID", type: "string", description: "Scene/project ID; defaults to the active scene", required: false},
                {name: "sessionID", type: "string", description: "Copilot session ID; defaults to the active session", required: false},
                {
                    name: "status",
                    type: "string",
                    description: "Optional status filter: todo, in_progress, done, blocked, or cancelled",
                    required: false,
                    enum: ["todo", "in_progress", "done", "blocked", "cancelled"],
                },
                {name: "limit", type: "number", description: "Maximum number of tasks to return", required: false},
            ],
            handler: async params => this.taskHandlers.handleListProjectTasks(params),
        });

        this.registerCommand({
            name: SupportedCommands.CreateProjectTask,
            description: "Create a persisted Copilot task for the current scene/project",
            parameters: [
                {name: "title", type: "string", description: "Short task title", required: true},
                {name: "description", type: "string", description: "Optional task detail or blocked reason", required: false},
                {
                    name: "status",
                    type: "string",
                    description: "Initial status: todo, in_progress, done, blocked, or cancelled",
                    required: false,
                    enum: ["todo", "in_progress", "done", "blocked", "cancelled"],
                },
                {name: "order", type: "number", description: "Sort order for the task in the plan", required: false},
                {name: "sceneID", type: "string", description: "Scene/project ID; defaults to the active scene", required: false},
                {name: "sessionID", type: "string", description: "Copilot session ID; defaults to the active session", required: false},
            ],
            handler: async params => this.taskHandlers.handleCreateProjectTask(params),
        });

        this.registerCommand({
            name: SupportedCommands.UpdateProjectTask,
            description: "Update a persisted Copilot project task status or metadata",
            parameters: [
                {name: "id", type: "string", description: "Task ID", required: true},
                {name: "title", type: "string", description: "Updated task title", required: false},
                {name: "description", type: "string", description: "Updated task detail or blocked reason", required: false},
                {
                    name: "status",
                    type: "string",
                    description: "Updated status: todo, in_progress, done, blocked, or cancelled",
                    required: false,
                    enum: ["todo", "in_progress", "done", "blocked", "cancelled"],
                },
                {name: "order", type: "number", description: "Updated sort order", required: false},
            ],
            handler: async params => this.taskHandlers.handleUpdateProjectTask(params),
        });

        this.registerCommand({
            name: SupportedCommands.DeleteProjectTask,
            description: "Delete a persisted Copilot project task",
            parameters: [
                {name: "id", type: "string", description: "Task ID", required: true},
            ],
            handler: async params => this.taskHandlers.handleDeleteProjectTask(params),
        });
    }
}

export interface CommandsRegistryOptions {
    getSessionId?: () => string | null | undefined;
}

export interface RegisteredCommand {
    name: string;
    description: string;
    parameters: Array<{
        name: string;
        type: "string" | "number" | "boolean" | "object" | "array";
        description: string;
        required: boolean;
        default?: any;
        enum?: any[];
    }>;
    handler: (params: any) => Promise<CommandResult>;
}

export enum SupportedCommands {
    CreatePrimitive = "create_primitive",
    CreateGroup = "create_group",
    CloneObject = "clone_object",
    DeleteObject = "delete_object",
    MoveObject = "move_object",
    ModifyObject = "modify_object",
    GetSceneObjects = "get_scene_objects",
    GetObject = "get_object",
    GetObjectSettings = "get_object_settings",
    GetMaterialSettings = "get_material_settings",
    GetBehaviorSettings = "get_behavior_settings",
    GetSelectedObject = "get_selected_object",
    GetPlayer = "get_player",
    ListSceneAssets = "list_scene_assets",
    GetSceneAsset = "get_scene_asset",
    ListLambdas = "list_lambdas",
    GetLambda = "get_lambda",
    SetMaterial = "set_material",
    SetTexture = "set_texture",
    SetExternalTexture = "set_external_texture",
    ListBehaviors = "list_behaviors",
    GetBehavior = "get_behavior",
    AddBehavior = "add_behavior",
    UpdateBehavior = "update_behavior",
    AttachBehavior = "attach_behavior",
    AddNavMesh = "add_navmesh",
    RebuildNavMesh = "rebuild_navmesh",
    AddNavMeshConnection = "add_navmesh_connection",
    AddWaypointPath = "add_waypoint_path",
    AddWaypoint = "add_waypoint",
    DetachBehavior = "detach_behavior",
    RemoveBehavior = "remove_behavior",
    SetBehaviorConfig = "set_behavior_config",
    EnablePhysics = "enable_physics",
    DisablePhysics = "disable_physics",
    SetPhysics = "set_physics",
    GetPhysicsSettings = "get_physics_settings",
    SetPhysicsEngine = "set_physics_engine",
    SetSceneCompartments = "set_scene_compartments",
    SetLightProperties = "set_light_properties",
    GetLightSettings = "get_light_settings",
    Generate3DModel = "generate_3d_model",
    SearchLocalAssets = "search_local_assets",
    GetLibraryAsset = "get_library_asset",
    SearchExternalAssets = "search_external_assets",
    AddModelToScene = "add_model_to_scene",
    AddVFX = "add_vfx",
    ModifyVFX = "modify_vfx",
    DeleteVFX = "delete_vfx",
    GetVFX = "get_vfx",
    AddVFXBehavior = "add_vfx_behavior",
    RemoveVFXBehavior = "remove_vfx_behavior",
    ListPrefabs = "list_prefabs",
    GetPrefab = "get_prefab",
    AddPrefabToScene = "add_prefab_to_scene",
    CreatePrefab = "create_prefab",
    SetSceneLighting = "set_scene_lighting",
    SetSceneFog = "set_scene_fog",
    SetSceneBackground = "set_scene_background",
    SetToneMapping = "set_tone_mapping",
    SetPostProcessing = "set_post_processing",
    SetCameraSettings = "set_camera_settings",
    GetCameraSettings = "get_camera_settings",
    SetGameSettings = "set_game_settings",
    SetProjectTitle = "set_project_title",
    SetSceneThumbnail = "set_scene_thumbnail",
    SetRenderingSettings = "set_rendering_settings",
    GetEditorSettings = "get_editor_settings",
    GetSceneSetting = "get_scene_setting",
    ListProjectTasks = "list_project_tasks",
    CreateProjectTask = "create_project_task",
    UpdateProjectTask = "update_project_task",
    DeleteProjectTask = "delete_project_task",
}
