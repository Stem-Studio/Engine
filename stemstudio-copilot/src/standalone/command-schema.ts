/**
 * Pure-data command schema for Studio API requests.
 *
 * Extracted from StudioMcpProxy so that consumers (generate-tools, system-prompt)
 * can import the schema without pulling in the transport/session singleton.
 */

export type ToolKind = 'read' | 'mutate';

/** Schema metadata for a single tool parameter — enables typed JSON Schema generation. */
export type ParamSchemaInfo = {
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    description?: string;
    enum?: string[];
    /** Nested property schemas for object-typed parameters */
    properties?: Record<string, ParamSchemaInfo>;
};

export type ApiRequestConfig = {
    command: string;
    path: string;
    queryParams?: string[];
    optionalQueryParams?: string[];
    bodyParams?: string[];
    optionalBodyParams?: string[];
    method: 'GET' | 'POST' | 'DELETE';
    kind: ToolKind;
    /** Typed parameter schemas — when present, generate precise JSON Schema instead of generic oneOf. */
    paramSchemas?: Record<string, ParamSchemaInfo>;
}

export type SessionInfo = {
    sessionId: string;
    connectedAt: number;
    lastMessageAt: number;
};

/**
 * Configs for Studio API requests.
 *  <command>(params) -> api/studio/scene/{path}/:sessionId?{queryParams[0]}=<>&{queryParams[1]}=<>
 * For example:
 *  Command: get_scene_objects -> API path: /api/studio/scene/objects/:sessionId?filter=test
 */
export const apiRequestConfigs: ApiRequestConfig[] =
    [
        // scene objects — query
        {command: "get_scene_objects", path: "objects", method: "GET", optionalQueryParams: ["filter"], kind: "read"},
        {command: "get_selected_object", path: "selected", method: "GET", kind: "read"},
        {command: "get_object", path: "object", method: "GET", queryParams: ["target"], kind: "read"},
        {command: "get_player", path: "player", method: "GET", kind: "read"},
        // objects — create / modify / delete
        {
            command: "create_primitive",
            path: "create-primitive",
            method: "POST",
            bodyParams: ["type"],
            optionalBodyParams: ["name", "position", "scale", "rotation", "color", "parent"],
            kind: "mutate",
            paramSchemas: {
                type: {
                    type: 'string',
                    description: 'Primitive type',
                    enum: ['box', 'sphere', 'cylinder', 'cone', 'plane', 'torus', 'torusKnot', 'triangle', 'capsule', 'icosahedron', 'octahedron', 'dodecahedron', 'ring']
                },
                name: {type: 'string', description: 'Name for the object'},
                position: {type: 'object', description: 'Position {x, y, z}'},
                scale: {type: 'object', description: 'Scale {x, y, z}'},
                rotation: {type: 'object', description: 'Rotation {x, y, z} in radians'},
                color: {type: 'string', description: "Hex color (e.g. '#ff0000')"},
                parent: {type: 'string', description: 'Parent object name or UUID'},
            }
        },
        {
            command: "create_group",
            path: "create-group",
            method: "POST",
            optionalBodyParams: ["name", "position", "scale", "rotation", "parent"],
            kind: "mutate",
            paramSchemas: {
                name: {type: 'string', description: 'Name for the group'},
                position: {type: 'object', description: 'Position {x, y, z}'},
                scale: {type: 'object', description: 'Scale {x, y, z}'},
                rotation: {type: 'object', description: 'Rotation {x, y, z} in radians'},
                parent: {type: 'string', description: 'Parent object name or UUID'},
            }
        },
        {
            command: "clone_object",
            path: "clone-object",
            method: "POST",
            bodyParams: ["target"],
            optionalBodyParams: ["position"],
            kind: "mutate",
            paramSchemas: {
                target: {type: 'string', description: 'Object name or UUID to clone'},
                position: {type: 'object', description: 'Position {x, y, z} for the clone'},
            }
        },
        {
            command: "modify_object",
            path: "modify-object",
            method: "POST",
            bodyParams: ["target"],
            optionalBodyParams: ["position", "rotation", "scale", "color", "name", "tag"],
            kind: "mutate",
            paramSchemas: {
                target: {type: 'string', description: 'Object name or UUID'},
                position: {type: 'object', description: 'New position {x, y, z}'},
                rotation: {type: 'object', description: 'New rotation {x, y, z} in radians'},
                scale: {type: 'object', description: 'New scale {x, y, z}'},
                color: {type: 'string', description: 'New hex color'},
                name: {type: 'string', description: 'New name'},
                tag: {type: 'string', description: 'Tag or array of tags to add to the object'},
            }
        },
        {
            command: "move_object",
            path: "move-object",
            method: "POST",
            bodyParams: ["target", "parent"],
            kind: "mutate",
            paramSchemas: {
                target: {type: 'string', description: 'Object name or UUID to move'},
                parent: {type: 'string', description: 'UUID or name of new parent, or null for scene root'},
            }
        },
        {
            command: "delete_object", path: "delete-object", method: "DELETE", bodyParams: ["target"], kind: "mutate",
            paramSchemas: {
                target: {type: 'string', description: 'Object name or UUID to delete'},
            }
        },
        // materials
        {
            command: "set_material",
            path: "set-material",
            method: "POST",
            bodyParams: ["target"],
            optionalBodyParams: ["color", "opacity", "metalness", "roughness"],
            kind: "mutate"
        },
        {
            command: "set_texture",
            path: "set-texture",
            method: "POST",
            bodyParams: ["target", "textureUrl"],
            optionalBodyParams: ["textureType"],
            kind: "mutate"
        },
        {
            command: "set_external_texture",
            path: "set-external-texture",
            method: "POST",
            bodyParams: ["target", "assetId", "assetType", "name", "provider"],
            kind: "mutate"
        },
        // library assets
        {command: "search_local_assets", path: "assets", method: "GET", queryParams: ["phrases"], optionalQueryParams: ["type"], kind: "read"},
        {command: "get_library_asset", path: "asset", method: "GET", queryParams: ["assetId"], kind: "read"},
        {
            command: "search_external_assets",
            path: "external-assets",
            method: "GET",
            queryParams: ["prompt"],
            optionalQueryParams: ["provider"],
            kind: "read"
        },
        {
            command: "generate_3d_model",
            path: "generate-3d-model",
            method: "POST",
            bodyParams: ["prompt"],
            optionalBodyParams: ["name", "position", "parent"],
            kind: "mutate"
        },
        {
            command: "add_model_to_scene",
            path: "add-model-to-scene",
            method: "POST",
            bodyParams: ["id", "name", "provider", "downloadUrl"],
            optionalBodyParams: ["position", "width", "height", "parent"],
            kind: "mutate"
        },
        // behaviors
        {
            command: "list_behaviors",
            path: "list-behaviors",
            method: "GET",
            optionalQueryParams: ["filter"],
            kind: "read"
        },
        {command: "get_behavior", path: "get-behavior", method: "GET", queryParams: ["behaviorId"], kind: "read"},
        {
            command: "add_behavior",
            path: "add-behavior",
            method: "POST",
            bodyParams: ["name", "code", "metadata", "version"],
            optionalBodyParams: ["description", "author"],
            kind: "mutate"
        },
        {
            command: "update_behavior",
            path: "update-behavior",
            method: "POST",
            bodyParams: ["behaviorId"],
            optionalBodyParams: ["description", "author", "code", "name", "metadata", "version"],
            kind: "mutate"
        },
        {
            command: "attach_behavior",
            path: "attach-behavior",
            method: "POST",
            bodyParams: ["target", "behaviorId"],
            optionalBodyParams: ["config"],
            kind: "mutate"
        },
        {
            command: "add_navmesh",
            path: "add-navmesh",
            method: "POST",
            optionalBodyParams: [
                "target", "enabled", "cellSize", "cellHeight", "agentHeight", "agentRadius",
                "agentMaxClimb", "agentMaxSlope", "regionMinSize", "regionMergeSize",
                "edgeMaxLen", "edgeMaxError", "vertsPerPoly", "detailSampleDist",
                "detailSampleMaxError", "autoGenerate", "onlyPhysicsMeshes", "debugVisualization",
            ],
            kind: "mutate"
        },
        {
            command: "rebuild_navmesh",
            path: "rebuild-navmesh",
            method: "POST",
            optionalBodyParams: ["target"],
            kind: "mutate"
        },
        {
            command: "add_navmesh_connection",
            path: "add-navmesh-connection",
            method: "POST",
            bodyParams: ["source", "target"],
            optionalBodyParams: ["enabled", "bidirectional", "radius", "showConnection"],
            kind: "mutate"
        },
        {
            command: "add_waypoint_path",
            path: "add-waypoint-path",
            method: "POST",
            bodyParams: ["name"],
            optionalBodyParams: ["position", "parent", "loop"],
            kind: "mutate"
        },
        {
            command: "add_waypoint",
            path: "add-waypoint",
            method: "POST",
            bodyParams: ["path", "position"],
            optionalBodyParams: ["name", "order", "waitTime", "arrivalRadius"],
            kind: "mutate"
        },
        {
            command: "set_behavior_config",
            path: "set-behavior-config",
            method: "POST",
            bodyParams: ["target", "behaviorId"],
            optionalBodyParams: ["attributesData", "enabled"],
            kind: "mutate"
        },
        {
            command: "detach_behavior",
            path: "detach-behavior",
            method: "POST",
            bodyParams: ["target", "behaviorId"],
            kind: "mutate"
        },
        {
            command: "remove_behavior",
            path: "remove-behavior",
            method: "DELETE",
            queryParams: ["behaviorId"],
            kind: "mutate"
        },
        // physics
        {
            command: "set_physics",
            path: "set-physics",
            method: "POST",
            bodyParams: ["target", "config"],
            kind: "mutate",
            paramSchemas: {
                target: {type: 'string', description: 'Object name or UUID'},
                config: {
                    type: 'object',
                    description: "Physics config (all fields optional unless noted). Shape values are lowercase friendly names: 'box' | 'sphere' | 'capsule' | 'convexHull' | 'concaveHull' (legacy 'trimesh'→'concaveHull', 'cylinder'→'capsule'). ctype is PascalCase per CollisionType enum: 'Static' | 'Dynamic' | 'Kinematic' (runtime COLLISION_MAP requires this exact casing). Fields: enabled (boolean), shape, ctype, mass (number; required for non-static), inertia ({x,y,z}), friction (0..1), restitution (0..1), rollingFriction (0..1), spinningFriction (0..1), contactStiffness (0..1), contactDamping (0..1), rotationLock ({x,y,z} of boolean), climbable (boolean), collision_material (one of 'Metal'|'Dirt'|'Ground'|'Plastic'|'Snow'|'Wood'|'Concrete'|'Mud'|'Ice'|'Slime'|'Water'|'Slippery Ground'|'Rubber'|'Sand'|'Custom'), bounciness_preset (same labels — engine-tuned restitution/friction/contactStiffness/contactDamping per BOUNCINESS_PRESET_VALUES), anchorOffset/anchorScale/userShapeOffset/userShapeScale ({x,y,z}). NOTE: 'bodyType' is NOT a field — use 'ctype'."
                },
            }
        },
        {command: "enable_physics", path: "enable-physics", method: "POST", bodyParams: ["target"], kind: "mutate"},
        {command: "disable_physics", path: "disable-physics", method: "POST", bodyParams: ["target"], kind: "mutate"},
        {
            command: "set_physics_engine",
            path: "set-physics-engine",
            method: "POST",
            bodyParams: ["type"],
            optionalBodyParams: ["gravity"],
            kind: "mutate",
            paramSchemas: {
                type: {
                    type: 'string',
                    enum: ['ammo', 'rapier'],
                    description: "Scene-level physics engine. 'ammo' is the default and most mature. Takes effect at next scene load."
                },
                gravity: {
                    type: 'number',
                    description: "Scene gravity on the Y axis. Negative = down (Earth-like is -9.81). Optional — omit to leave gravity unchanged."
                },
            }
        },
        {
            command: "set_scene_compartments",
            path: "set-scene-compartments",
            method: "POST",
            bodyParams: ["enabled"],
            kind: "mutate",
            paramSchemas: {
                enabled: {type: 'boolean', description: 'Enable or disable scene-level SES compartments for behavior/lambda scripts'},
            }
        },
        {
            command: "set_light_properties",
            path: "set-light-properties",
            method: "POST",
            bodyParams: ["target"],
            optionalBodyParams: ["intensity", "color", "castShadow", "shadowMapSize", "shadowBias", "shadowNormalBias", "shadowRadius"],
            kind: "mutate",
            paramSchemas: {
                target: {type: 'string', description: "Light object name or UUID"},
                intensity: {type: 'number', description: 'Light intensity'},
                color: {type: 'string', description: "Light color hex (e.g. '#ffffcc')"},
                castShadow: {type: 'boolean', description: 'Enable shadow casting'},
                shadowMapSize: {type: 'number', description: 'Shadow map resolution'},
                shadowBias: {type: 'number', description: 'Shadow bias'},
                shadowNormalBias: {type: 'number', description: 'Shadow normal bias'},
                shadowRadius: {type: 'number', description: 'Shadow softness radius'},
            }
        },
        // vfx
        {
            command: "add_vfx",
            path: "add-vfx",
            method: "POST",
            bodyParams: ["name"],
            optionalBodyParams: ["position", "rotation", "scale", "parent", "preset", "config"],
            kind: "mutate"
        },
        {
            command: "modify_vfx",
            path: "modify-vfx",
            method: "POST",
            bodyParams: ["target"],
            optionalBodyParams: ["position", "rotation", "scale", "duration", "looping", "worldSpace", "emissionRate", "config", "action"],
            kind: "mutate"
        },
        {command: "delete_vfx", path: "delete-vfx", method: "DELETE", bodyParams: ["target"], kind: "mutate"},
        {command: "get_vfx", path: "get-vfx", method: "GET", queryParams: ["target"], kind: "read"},
        {
            command: "add_vfx_behavior",
            path: "add-vfx-behavior",
            method: "POST",
            bodyParams: ["target", "behaviorType"],
            optionalBodyParams: ["config"],
            kind: "mutate"
        },
        {
            command: "remove_vfx_behavior",
            path: "remove-vfx-behavior",
            method: "DELETE",
            bodyParams: ["target", "behaviorIndex"],
            kind: "mutate"
        },
        // prefabs (stems)
        {command: "list_prefabs", path: "list-prefabs", method: "GET", optionalQueryParams: ["filter"], kind: "read"},
        {command: "get_prefab", path: "get-prefab", method: "GET", queryParams: ["id"], kind: "read"},
        {
            command: "create_prefab",
            path: "create-prefab",
            method: "POST",
            bodyParams: ["target"],
            optionalBodyParams: ["name", "createThumbnail"],
            kind: "mutate"
        },
        {
            command: "add_prefab_to_scene",
            path: "add-prefab-to-scene",
            method: "POST",
            bodyParams: ["id"],
            optionalBodyParams: ["position", "name"],
            kind: "mutate"
        },
        // editor settings
        {
            command: "get_editor_settings",
            path: "editor-settings",
            method: "GET",
            optionalQueryParams: ["category"],
            kind: "read"
        },
        // per-subsystem settings reads — mirror the engine's CommandsRegistry handlers
        {
            command: "get_object_settings",
            path: "object-settings",
            method: "GET",
            queryParams: ["target"],
            optionalQueryParams: ["kind"],
            kind: "read",
        },
        {
            command: "get_material_settings",
            path: "material-settings",
            method: "GET",
            queryParams: ["target"],
            kind: "read",
        },
        {
            command: "get_behavior_settings",
            path: "behavior-settings",
            method: "GET",
            queryParams: ["target"],
            optionalQueryParams: ["behaviorId"],
            kind: "read",
        },
        {
            command: "get_physics_settings",
            path: "physics-settings",
            method: "GET",
            queryParams: ["target"],
            kind: "read",
        },
        {
            command: "get_light_settings",
            path: "light-settings",
            method: "GET",
            queryParams: ["target"],
            kind: "read",
        },
        {
            command: "get_camera_settings",
            path: "camera-settings",
            method: "GET",
            queryParams: ["target"],
            kind: "read",
        },
        {
            command: "get_scene_setting",
            path: "scene-setting",
            method: "GET",
            optionalQueryParams: ["category"],
            kind: "read",
        },
        {
            command: "set_scene_thumbnail",
            path: "set-scene-thumbnail",
            method: "POST",
            bodyParams: ["name"],
            kind: "mutate",
            paramSchemas: {
                name: {type: "string", description: "Name of the imported image asset to use as the scene thumbnail"},
            },
        },
        {
            command: "set_scene_lighting",
            path: "set-scene-lighting",
            method: "POST",
            optionalBodyParams: ["ambient", "hemisphere", "shadows"],
            kind: "mutate"
        },
        {
            command: "set_scene_fog",
            path: "set-scene-fog",
            method: "POST",
            bodyParams: ["type"],
            optionalBodyParams: ["color", "near", "far", "density"],
            kind: "mutate",
            paramSchemas: {
                type: {type: 'string', description: 'Fog type', enum: ['none', 'linear', 'exponential']},
                color: {type: 'string', description: "Fog color hex (e.g. '#aaaaaa')"},
                near: {type: 'number', description: 'Fog start distance (linear fog)'},
                far: {type: 'number', description: 'Fog end distance (linear fog)'},
                density: {type: 'number', description: 'Fog density (exponential fog)'},
            }
        },
        {
            command: "set_scene_background",
            path: "set-scene-background",
            method: "POST",
            bodyParams: ["type"],
            optionalBodyParams: ["color", "gradient", "rotation", "intensity", "blurriness"],
            kind: "mutate",
            paramSchemas: {
                type: {
                    type: 'string',
                    description: 'Background type',
                    enum: ['Color', 'Texture', 'Cubemap', 'Gradient']
                },
                color: {type: 'string', description: 'Background color hex'},
                gradient: {type: 'string', description: 'CSS gradient string'},
                rotation: {type: 'number', description: 'Background rotation'},
                intensity: {type: 'number', description: 'Background intensity'},
                blurriness: {type: 'number', description: 'Background blurriness'},
            }
        },
        {
            command: "set_tone_mapping",
            path: "set-tone-mapping",
            method: "POST",
            bodyParams: ["type"],
            optionalBodyParams: ["exposure"],
            kind: "mutate",
            paramSchemas: {
                type: {
                    type: 'string',
                    description: 'Tone mapping type',
                    enum: ['None', 'Linear', 'Reinhard', 'Cineon', 'ACESFilmic']
                },
                exposure: {type: 'number', description: 'Tone mapping exposure (default: 1.0)'},
            }
        },
        {
            command: "set_post_processing",
            path: "set-post-processing",
            method: "POST",
            optionalBodyParams: ["ao", "bloom", "outline"],
            kind: "mutate"
        },
        {
            command: "set_camera_settings",
            path: "set-camera-settings",
            method: "POST",
            bodyParams: ["target"],
            optionalBodyParams: ["fov", "near", "far", "cameraType", "defaultDistance", "minDistance", "maxDistance", "headHeight", "axis", "occlusionType"],
            kind: "mutate",
            paramSchemas: {
                target: {type: 'string', description: 'Object name or UUID to configure camera on'},
                fov: {type: 'number', description: 'Field of view in degrees'},
                near: {type: 'number', description: 'Near clipping plane'},
                far: {type: 'number', description: 'Far clipping plane'},
                cameraType: {
                    type: 'string',
                    description: 'Camera type',
                    enum: ['THIRD_PERSON', 'FIRST_PERSON', 'TOP_DOWN', 'SIDE_SCROLLER']
                },
                defaultDistance: {type: 'number', description: 'Default camera distance'},
                minDistance: {type: 'number', description: 'Minimum camera distance'},
                maxDistance: {type: 'number', description: 'Maximum camera distance'},
                headHeight: {type: 'number', description: 'Camera head height (first-person)'},
                axis: {type: 'string', description: "Camera axis constraint (e.g. 'Z' for side-scroller)"},
                occlusionType: {type: 'string', description: 'Camera occlusion handling type'},
            }
        },
        {
            command: "set_game_settings",
            path: "set-game-settings",
            method: "POST",
            optionalBodyParams: ["enabled", "lives", "maxScore", "timer", "useAvatar", "isMultiplayer", "showHUD", "isSandbox", "voiceChatEnabled"],
            kind: "mutate"
        },
        {
            command: "set_project_title",
            path: "set-project-title",
            method: "POST",
            bodyParams: ["title"],
            kind: "mutate",
            paramSchemas: {
                title: {type: 'string', description: 'Project or scene title'},
            }
        },
        {
            command: "set_rendering_settings",
            path: "set-rendering-settings",
            method: "POST",
            optionalBodyParams: ["useShadows", "useInstancing", "shadowMapType", "usePhysicsWorker"],
            kind: "mutate",
            paramSchemas: {
                useShadows: {type: 'boolean', description: 'Enable shadow rendering'},
                useInstancing: {type: 'boolean', description: 'Enable GPU instancing'},
                shadowMapType: {type: 'number', description: 'Shadow map type THREE constant: 0=Basic, 1=PCF, 2=PCFSoft, 3=VSM'},
                usePhysicsWorker: {type: 'boolean', description: 'Run physics in web worker'},
            }
        },
        {
            command: "list_project_tasks",
            path: "project-tasks",
            method: "GET",
            optionalQueryParams: ["sceneID", "sessionID", "status", "limit"],
            kind: "read"
        },
        {
            command: "create_project_task",
            path: "create-project-task",
            method: "POST",
            bodyParams: ["title"],
            optionalBodyParams: ["description", "status", "order", "sceneID", "sessionID"],
            kind: "mutate"
        },
        {
            command: "update_project_task",
            path: "update-project-task",
            method: "POST",
            bodyParams: ["id"],
            optionalBodyParams: ["title", "description", "status", "order"],
            kind: "mutate"
        },
        {
            command: "delete_project_task",
            path: "delete-project-task",
            method: "DELETE",
            bodyParams: ["id"],
            kind: "mutate"
        },
    ];
