import {describe, expect, it, vi} from "vitest";

import global from "../global";
import {DirectCopilotProvider} from "./DirectCopilotProvider";
import type {CopilotChatKey} from "./playgroundCopilotKeys";
import type {PlaygroundLLMClient} from "./playgroundLLMClient";

const openAIKey: CopilotChatKey = {provider: "openai", apiKey: "sk-test", model: "gpt-5.5"};
const anthropicKey: CopilotChatKey = {
    provider: "anthropic",
    apiKey: "sk-test",
    model: "claude-sonnet-4-5-20250929",
};

const makeLLMClient = (...responses: Array<Record<string, unknown>>): PlaygroundLLMClient => ({
    generateText: vi.fn().mockImplementation(async () => {
        const response = responses.shift();
        return JSON.stringify(response ?? {reply: "No changes.", stemscript: ""});
    }),
});

const makeExecutor = () => {
    const objects = new Map<string, Record<string, any>>();
    const behaviors = new Map<string, Record<string, any>>();
    let projectTitle = "Untitled";
    let gameSettings: Record<string, any> = {
        isGame: false,
        lives: 0,
        maxScore: 0,
        showHUD: false,
    };

    const executeCommand = vi.fn().mockImplementation(async (command: string, parameters: Record<string, unknown>) => {
        const successResult = (data?: unknown) => ({
            success: true,
            step: {
                id: "step-1",
                command,
                parameters,
                status: "completed",
            },
            result: {message: "ok", data},
        });

        if (command === "create_primitive") {
            const name = String(parameters.name);
            objects.set(name, {
                name,
                kind: parameters.type,
                transform: {
                    position: parameters.position,
                    rotation: parameters.rotation,
                    scale: parameters.scale,
                },
                material: {
                    color: parameters.color,
                },
                geometry: {parameters: {}},
            });
            return successResult();
        }

        if (command === "create_group") {
            const name = String(parameters.name);
            objects.set(name, {
                name,
                kind: "group",
                transform: {
                    position: parameters.position,
                    rotation: parameters.rotation,
                    scale: parameters.scale,
                },
            });
            return successResult();
        }

        if (command === "modify_object") {
            const target = String(parameters.target ?? parameters.name);
            objects.set(target, {
                ...(objects.get(target) ?? {name: target}),
                name: parameters.name ?? target,
                transform: {
                    ...(objects.get(target)?.transform ?? {}),
                    position: parameters.position ?? objects.get(target)?.transform?.position,
                    rotation: parameters.rotation ?? objects.get(target)?.transform?.rotation,
                    scale: parameters.scale ?? objects.get(target)?.transform?.scale,
                },
                material: {
                    ...(objects.get(target)?.material ?? {}),
                    color: parameters.color ?? objects.get(target)?.material?.color,
                },
            });
            return successResult();
        }

        if (command === "set_project_title") {
            projectTitle = String(parameters.title);
            return successResult({title: projectTitle});
        }

        if (command === "set_game_settings") {
            gameSettings = {...gameSettings, ...parameters};
            if (parameters.enabled !== undefined && parameters.isGame === undefined) {
                gameSettings.isGame = parameters.enabled;
            }
            return successResult(gameSettings);
        }

        if (command === "attach_behavior" || command === "set_behavior_config") {
            const target = String(parameters.target);
            const behaviorId = String(parameters.behaviorId);
            const key = `${target}:${behaviorId}`;
            const current = behaviors.get(key) ?? {behavior: {attributesData: {}, enabled: true}};
            behaviors.set(key, {
                behavior: {
                    ...current.behavior,
                    attributesData: parameters.config ?? parameters.attributesData ?? current.behavior.attributesData,
                    enabled: parameters.enabled ?? current.behavior.enabled,
                },
            });
            return successResult(behaviors.get(key));
        }

        if (command === "get_object_settings") {
            const target = String(parameters.target);
            return successResult(objects.get(target) ?? {name: target, kind: parameters.kind});
        }

        if (command === "get_scene_setting") {
            if (parameters.category === "project") return successResult({title: projectTitle});
            if (parameters.category === "game") return successResult(gameSettings);
            return successResult({});
        }

        if (command === "get_behavior_settings") {
            const target = String(parameters.target);
            const behaviorId = String(parameters.behaviorId);
            return successResult(behaviors.get(`${target}:${behaviorId}`) ?? {behavior: {attributesData: {}, enabled: true}});
        }

        return successResult();
    });

    return {
        executeCommand,
        hasPendingInteractiveResults: () => false,
        getPendingInteractiveResults: () => [],
        handleUserSelectionResult: () => false,
        on: vi.fn(),
    };
};

const withFakeAssetApp = async (run: (assetSource: any) => Promise<void>) => {
    const previousApp = global.app;
    const assets: any[] = [];
    let assetCounter = 0;
    const assetSource = {
        kind: "scene",
        id: "scene-1",
        getAssets: vi.fn(async ({types}: {types?: string[]} = {}) => ({
            assets: types?.length ? assets.filter(asset => types.includes(asset.type)) : assets,
        })),
        addDependencies: vi.fn(async () => {}),
        removeDependencies: vi.fn(async () => {}),
        createAsset: vi.fn(async ({type, name}: {type: string; name: string}) => {
            assetCounter += 1;
            const asset = {
                id: `asset-${assetCounter}`,
                name,
                type,
                headRevisionId: `rev-${assetCounter}`,
                revisionId: `rev-${assetCounter}`,
            };
            assets.push(asset);
            return asset;
        }),
        createAssetRevision: vi.fn(async ({assetId}: {assetId: string}) => {
            assetCounter += 1;
            const revision = {
                id: `rev-${assetCounter}`,
                assetId,
                createTime: "2026-01-01T00:00:00Z",
            };
            const asset = assets.find(item => item.id === assetId);
            if (asset) {
                asset.headRevisionId = revision.id;
                asset.revisionId = revision.id;
            }
            return revision;
        }),
    };
    const lambdaConfigs = new Map<string, any>();
    const lambdaAssetMeta = new Map<string, any>();
    const scene = {
        children: [],
        traverse: vi.fn(),
        userData: {},
    };
    const fakeApp = {
        scene,
        editor: {
            sceneID: "scene-1",
            scene,
            assetSource,
            loadBackendImportSources: vi.fn(async () => {}),
            lambdaConfigRegistry: {
                getConfig: vi.fn((id: string) => lambdaConfigs.get(id) ?? null),
                registerConfig: vi.fn((id: string, config: any) => lambdaConfigs.set(id, config)),
                updateConfig: vi.fn((id: string, config: any) => lambdaConfigs.set(id, config)),
                setAssetMeta: vi.fn((id: string, meta: any) => lambdaAssetMeta.set(id, meta)),
                getAssetMeta: vi.fn((id: string) => lambdaAssetMeta.get(id) ?? null),
            },
        },
        call: vi.fn(),
    };
    global.app = fakeApp as any;
    try {
        await run(assetSource);
    } finally {
        global.app = previousApp;
    }
};

describe("DirectCopilotProvider", () => {
    it("generates StemScript through the provider and executes it in the registry path", async () => {
        const executor = makeExecutor();
        const llmClient = makeLLMClient({
            reply: "Added a box.",
            stemscript: "add box name=TestBox position=1,2,3 color=#ff0000",
        });
        const events: string[] = [];
        const provider = new DirectCopilotProvider({
            llmClient,
            resolveKey: async () => openAIKey,
            createExecutor: () => executor,
        });

        provider.on("commandWillExecute", event => events.push(`will:${event.data.command}`));
        provider.on("commandExecuted", event => events.push(`done:${event.data.command}`));

        const response = await provider.prompt("make a red test box");
        const llmRequest = vi.mocked(llmClient.generateText).mock.calls[0]?.[0];

        expect(llmClient.generateText).toHaveBeenCalledOnce();
        expect(llmRequest?.prompt).toContain("User request:");
        expect(llmRequest?.prompt).not.toContain("StemStudio playground knowledge base");
        expect(llmRequest?.systemPrompt).toContain("cached StemScript/API knowledge base");
        expect(llmRequest?.knowledgePrompt).toContain("StemStudio playground knowledge base");
        expect(llmRequest?.knowledgePrompt).toContain("1 unit = 1 meter");
        expect(llmRequest?.systemPrompt).toContain("complete playable changes");
        expect(llmRequest?.systemPrompt).toContain("designBrief");
        expect(llmRequest?.systemPrompt).toContain("coreLoop");
        expect(llmRequest?.systemPrompt).toContain("Prefer existing built-in behavior components");
        expect(llmRequest?.knowledgePrompt).toContain("Dynamic Asset and Registry Inspection");
        expect(llmRequest?.knowledgePrompt).not.toContain("Racing Recipe");
        expect(llmRequest?.knowledgePrompt).not.toContain("Script Imports and Shared Helpers");
        expect(llmRequest?.systemPrompt).toContain("set a project title");
        expect(llmRequest?.systemPrompt).toContain('project title "Arena Runner"');
        expect(llmRequest?.systemPrompt).toContain('description="Copilot generated for:');
        expect(llmRequest?.systemPrompt).toContain("inspected/reused assets");
        expect(llmRequest?.systemPrompt).toContain("inspectionStemscript");
        expect(llmRequest?.systemPrompt).toContain("lambda list");
        expect(llmRequest?.systemPrompt).toContain("list assets");
        expect(llmRequest?.systemPrompt).toContain("list imports");
        expect(llmRequest?.systemPrompt).toContain("list files");
        expect(llmRequest?.knowledgePrompt).toContain("behavior list/behavior get");
        expect(llmRequest?.knowledgePrompt).toContain("list behavior packs");
        expect(llmRequest?.knowledgePrompt).toContain("list lambda packs");
        expect(llmRequest?.promptCacheKey).toBe("stemstudio-playground-copilot-v5");
        expect(llmRequest?.maxOutputTokens).toBe(128000);
        expect(llmRequest?.key).toMatchObject({provider: "openai", model: "gpt-5.5"});
        expect(executor.executeCommand).toHaveBeenCalledWith("create_primitive", expect.objectContaining({
            type: "box",
            name: "TestBox",
        }));
        expect(events).toEqual([
            "will:create_primitive",
            "done:create_primitive",
            "will:get_object_settings",
            "done:get_object_settings",
        ]);
        expect(response).toContain("Added a box.");
        expect(response).toContain("Applied 1/1 command");
    });

    it("emits workflow progress while OpenAI response chunks stream", async () => {
        const llmClient: PlaygroundLLMClient = {
            generateText: vi.fn(async request => {
                request.onStreamProgress?.({type: "raw"});
                request.onStreamProgress?.({type: "reasoning", delta: "thinking"});
                request.onStreamProgress?.({type: "text", delta: "{\"reply\":\"No changes.\",\"stemscript\":\"\"}"});
                return JSON.stringify({reply: "No changes.", stemscript: ""});
            }),
        };
        const provider = new DirectCopilotProvider({
            llmClient,
            resolveKey: async () => openAIKey,
            createExecutor: makeExecutor,
        });
        const progressLines: string[] = [];
        provider.on("toolCallUpdate", event => {
            if (typeof event.data.line === "string") progressLines.push(event.data.line);
        });

        await provider.prompt("think for a while before changing the scene");

        expect(progressLines.some(line => line.includes("OpenAI stream active"))).toBe(true);
        expect(progressLines.some(line => line.includes("OpenAI stream complete"))).toBe(true);
    });

    it("selects game, porting, and custom-code cards for complex game requests", async () => {
        const llmClient = makeLLMClient({reply: "No changes.", stemscript: ""});
        const provider = new DirectCopilotProvider({
            llmClient,
            resolveKey: async () => openAIKey,
            createExecutor: makeExecutor,
        });

        await provider.prompt("port this kart racing game with custom vehicle handling and checkpoints");
        const llmRequest = vi.mocked(llmClient.generateText).mock.calls[0]?.[0];

        expect(llmRequest?.knowledgePrompt).toContain("Full Game Build Flow");
        expect(llmRequest?.knowledgePrompt).toContain("Game Porting and Source Mapping");
        expect(llmRequest?.knowledgePrompt).toContain("Racing Recipe");
        expect(llmRequest?.knowledgePrompt).toContain("Custom Behavior Authoring");
        expect(llmRequest?.knowledgePrompt).toContain("Built-In Behavior Catalog");
    });

    it("includes available behavior registry details in the dynamic provider prompt", async () => {
        const previousApp = global.app;
        global.app = {
            editor: {
                behaviorConfigRegistry: {
                    getAllConfigs: () => [
                        {
                            id: "custom.doorController",
                            name: "Door Controller",
                            description: "Opens a door when a trigger activates it.",
                            isScript: true,
                            attributes: {
                                speed: {type: "number", default: 2},
                                separator: {type: "separator"},
                            },
                        },
                    ],
                },
                lambdaConfigRegistry: {
                    getAllConfigs: () => [
                        {
                            id: "custom.motionLambda",
                            name: "Motion Lambda",
                            description: "Moves registered objects.",
                            attributes: {
                                speed: {type: "number", default: 1},
                            },
                            componentSchema: {
                                enabled: {type: "boolean", default: true},
                            },
                        },
                    ],
                },
            },
        } as any;

        try {
            const llmClient = makeLLMClient({reply: "No changes.", stemscript: ""});
            const provider = new DirectCopilotProvider({
                llmClient,
                resolveKey: async () => openAIKey,
                createExecutor: makeExecutor,
            });

            await provider.prompt("what behavior can open a door?");
            const llmRequest = vi.mocked(llmClient.generateText).mock.calls[0]?.[0];

            expect(llmRequest?.prompt).toContain("Available behavior registry JSON");
            expect(llmRequest?.prompt).toContain('"id": "custom.doorController"');
            expect(llmRequest?.prompt).toContain('"key": "speed"');
            expect(llmRequest?.prompt).toContain("Available lambda registry JSON");
            expect(llmRequest?.prompt).toContain('"id": "custom.motionLambda"');
            expect(llmRequest?.prompt).toContain('"componentSchema"');
            expect(llmRequest?.prompt).not.toContain("separator");
        } finally {
            global.app = previousApp;
        }
    });

    it("runs read-only inspection and replans before mutating the scene", async () => {
        const objects = new Map<string, Record<string, any>>([
            ["Player", {
                name: "Player",
                kind: "capsule",
                transform: {position: {x: 0, y: 1, z: 0}},
            }],
        ]);
        const executeCommand = vi.fn().mockImplementation(async (command: string, parameters: Record<string, unknown>) => {
            if (command === "modify_object") {
                const target = String(parameters.target);
                objects.set(target, {
                    ...(objects.get(target) ?? {name: target}),
                    transform: {
                        ...(objects.get(target)?.transform ?? {}),
                        position: parameters.position ?? objects.get(target)?.transform?.position,
                    },
                });
                return {
                    success: true,
                    step: {id: "step-1", command, parameters, status: "completed"},
                    result: {message: "ok"},
                };
            }
            const result =
                command === "get_scene_objects"
                    ? {message: "Found objects", data: [{name: "Player", type: "Mesh"}]}
                    : command === "get_object"
                      ? {message: "Retrieved Player", data: {name: "Player", position: {x: 0, y: 1, z: 0}}}
                      : command === "get_object_settings"
                        ? {message: "Retrieved Player", data: objects.get(String(parameters.target))}
                      : {message: "ok"};
            return {
                success: true,
                step: {id: "step-1", command, parameters, status: "completed"},
                result,
            };
        });
        const executor = {
            executeCommand,
            hasPendingInteractiveResults: () => false,
            getPendingInteractiveResults: () => [],
            handleUserSelectionResult: () => false,
            on: vi.fn(),
        };
        const llmClient = makeLLMClient(
            {
                reply: "I need to inspect the player first.",
                inspectionStemscript: "list objects filter=Player\nget Player",
                stemscript: "",
            },
            {
                reply: "Moved the existing player.",
                stemscript: "update Player position=1,1,0",
            },
        );
        const provider = new DirectCopilotProvider({
            llmClient,
            resolveKey: async () => openAIKey,
            createExecutor: () => executor,
        });

        const response = await provider.prompt("move the player right");
        const secondRequest = vi.mocked(llmClient.generateText).mock.calls[1]?.[0];

        expect(llmClient.generateText).toHaveBeenCalledTimes(2);
        expect(executeCommand).toHaveBeenCalledWith("get_scene_objects", expect.objectContaining({filter: "Player"}));
        expect(executeCommand).toHaveBeenCalledWith("get_object", expect.objectContaining({target: "Player"}));
        expect(executeCommand).toHaveBeenCalledWith("modify_object", expect.objectContaining({target: "Player"}));
        expect(secondRequest?.prompt).toContain("Inspection results JSON");
        expect(secondRequest?.prompt).toContain("Retrieved Player");
        expect(secondRequest?.prompt).toContain('"position": {');
        expect(secondRequest?.prompt).toContain('"x": 0');
        expect(response).toContain("Applied 1/1 command");
    });

    it("lets inspection query imported models, imports, files, and behavior/lambda packs", async () => {
        const executeCommand = vi.fn().mockImplementation(async (command: string, parameters: Record<string, unknown>) => ({
            success: true,
            step: {id: "step-1", command, parameters, status: "completed"},
            result: {
                message: `ok ${command}`,
                data: command === "list_scene_assets"
                    ? {assets: [{id: "asset-1", name: "Kart", type: parameters.type}]}
                    : {asset: {id: parameters.assetId ?? parameters.name, name: parameters.assetId ?? parameters.name}},
            },
        }));
        const executor = {
            executeCommand,
            hasPendingInteractiveResults: () => false,
            getPendingInteractiveResults: () => [],
            handleUserSelectionResult: () => false,
            on: vi.fn(),
        };
        const llmClient = makeLLMClient(
            {
                reply: "I need to inspect imported assets.",
                inspectionStemscript: [
                    "list models",
                    "list imports",
                    "list files",
                    "list behavior packs",
                    "list lambda packs",
                    "get asset assetId=model-1",
                ].join("\n"),
                stemscript: "",
            },
            {
                reply: "Used the existing imported asset context.",
                stemscript: "",
            },
        );
        const provider = new DirectCopilotProvider({
            llmClient,
            resolveKey: async () => openAIKey,
            createExecutor: () => executor,
        });

        const response = await provider.prompt("use the existing imported kart model");
        const secondRequest = vi.mocked(llmClient.generateText).mock.calls[1]?.[0];

        expect(executeCommand).toHaveBeenCalledWith("list_scene_assets", expect.objectContaining({type: "models"}));
        expect(executeCommand).toHaveBeenCalledWith("list_scene_assets", expect.objectContaining({type: "imports"}));
        expect(executeCommand).toHaveBeenCalledWith("list_scene_assets", expect.objectContaining({type: "files"}));
        expect(executeCommand).toHaveBeenCalledWith("list_scene_assets", expect.objectContaining({type: "behaviors"}));
        expect(executeCommand).toHaveBeenCalledWith("list_scene_assets", expect.objectContaining({type: "lambdas"}));
        expect(executeCommand).toHaveBeenCalledWith("get_scene_asset", expect.objectContaining({assetId: "model-1"}));
        expect(secondRequest?.prompt).toContain("Inspection results JSON");
        expect(secondRequest?.prompt).toContain("list_scene_assets");
        expect(response).toContain("Used the existing imported asset context.");
    });

    it("executes existing behavior attach and config commands", async () => {
        const executor = makeExecutor();
        const llmClient = makeLLMClient({
            reply: "Made the player controllable.",
            stemscript: [
                'behavior attach Player behaviorId=character config={isDefault:true,walkSpeed:3}',
                'behavior config Player behaviorId=character attributesData={runSpeed:8}',
            ].join("\n"),
        });
        const provider = new DirectCopilotProvider({
            llmClient,
            resolveKey: async () => openAIKey,
            createExecutor: () => executor,
        });

        const response = await provider.prompt("make player controllable");

        expect(executor.executeCommand).toHaveBeenCalledWith("attach_behavior", expect.objectContaining({
            target: "Player",
            behaviorId: "character",
        }));
        expect(executor.executeCommand).toHaveBeenCalledWith("set_behavior_config", expect.objectContaining({
            target: "Player",
            behaviorId: "character",
        }));
        expect(response).toContain("Applied 2/2 command");
    });

    it("executes game metadata commands when generating a playable game", async () => {
        const executor = makeExecutor();
        const llmClient = makeLLMClient({
            reply: "Created a playable arena game.",
            designBrief: {
                coreLoop: "Collect crystals while avoiding hazards.",
                controlsCamera: "Third-person character controls.",
                goalsFailState: "Win at five crystals, lose when lives run out.",
                challengeCurve: "More hazards near the goal.",
                feedbackProgression: "HUD score and pickup feedback.",
                reusePlan: "Use character and consumable built-ins.",
                implementationStrategy: "Set metadata first, then objects and mechanics.",
            },
            stemscript: [
                'project title "Crystal Dash"',
                "game settings isGame=true lives=3 maxScore=5 showHUD=true",
            ].join("\n"),
        });
        const provider = new DirectCopilotProvider({
            llmClient,
            resolveKey: async () => openAIKey,
            createExecutor: () => executor,
        });

        const response = await provider.prompt("make a crystal collection game");

        expect(executor.executeCommand).toHaveBeenCalledWith("set_project_title", expect.objectContaining({
            title: "Crystal Dash",
        }));
        expect(executor.executeCommand).toHaveBeenCalledWith("set_game_settings", expect.objectContaining({
            isGame: true,
            lives: 3,
            maxScore: 5,
            showHUD: true,
        }));
        expect(response).toContain("Design brief:");
        expect(response).toContain("Collect crystals");
        expect(response).toContain("Applied 2/2 command");
    });

    it("executes phased plans and materializes reusable behavior artifacts", async () => {
        const executor = makeExecutor();
        const llmClient = makeLLMClient({
            reply: "Built the staged game loop.",
            phases: [
                {
                    name: "Environment",
                    stemscript: "add group name=Arena",
                },
                {
                    name: "Controller",
                    artifacts: [
                        {
                            type: "behavior",
                            name: "CheckpointController",
                            description: "Copilot generated for: checkpoint racing loop; purpose: track laps; inspected/reused: built-in trigger; target: Player",
                            code: "this.update = function(dt) {}",
                            metadata: {
                                attributes: {
                                    maxLaps: {type: "number", default: 3},
                                },
                            },
                        },
                    ],
                    stemscript: "behavior attach Player behaviorId=CheckpointController config={maxLaps:3}",
                },
            ],
        });
        const provider = new DirectCopilotProvider({
            llmClient,
            resolveKey: async () => openAIKey,
            createExecutor: () => executor,
        });

        const response = await provider.prompt("make a checkpoint racing game");

        expect(executor.executeCommand).toHaveBeenCalledWith("create_group", expect.objectContaining({
            name: "Arena",
        }));
        expect(executor.executeCommand).toHaveBeenCalledWith("add_behavior", expect.objectContaining({
            name: "CheckpointController",
            code: "this.update = function(dt) {}",
            description: expect.stringContaining("checkpoint racing loop"),
            metadata: expect.objectContaining({
                attributes: expect.objectContaining({
                    maxLaps: expect.objectContaining({default: 3}),
                }),
            }),
        }));
        expect(executor.executeCommand).toHaveBeenCalledWith("attach_behavior", expect.objectContaining({
            target: "Player",
            behaviorId: "CheckpointController",
        }));
        expect(response).toContain("Materialized 1/1 reusable artifact");
        expect(response).toContain("Applied 2/2 command(s) across 2 phase(s)");
        expect(response).toContain("Environment: 1/1 command");
        expect(response).toContain("Controller: 1/1 command(s), artifacts 1/1");
    });

    it("repairs a non-empty StemScript response with no executable commands exactly once", async () => {
        const executor = makeExecutor();
        const llmClient = makeLLMClient(
            {
                reply: "Generated a script.",
                stemscript: "# I forgot the command",
            },
            {
                reply: "Repaired the empty script.",
                stemscript: "add box name=RepairBox position=0,1,0 color=#00ff00",
            },
        );
        const provider = new DirectCopilotProvider({
            llmClient,
            resolveKey: async () => openAIKey,
            createExecutor: () => executor,
        });

        const response = await provider.prompt("add a repair test box");

        expect(llmClient.generateText).toHaveBeenCalledTimes(2);
        expect(executor.executeCommand).toHaveBeenCalledWith("create_primitive", expect.objectContaining({
            name: "RepairBox",
        }));
        expect(response).toContain("Repair pass:");
        expect(response).toContain("Repaired the empty script.");
    });

    it("repairs failed readback verification once and does not loop", async () => {
        let projectTitle = "Untitled";
        let mismatchFirstReadback = true;
        const executeCommand = vi.fn().mockImplementation(async (command: string, parameters: Record<string, unknown>) => {
            if (command === "set_project_title") {
                projectTitle = String(parameters.title);
            }
            const data = command === "get_scene_setting" && parameters.category === "project"
                ? {title: mismatchFirstReadback ? "Wrong Title" : projectTitle}
                : undefined;
            if (command === "get_scene_setting") {
                mismatchFirstReadback = false;
            }
            return {
                success: true,
                step: {id: "step-1", command, parameters, status: "completed"},
                result: {message: "ok", data},
            };
        });
        const executor = {
            executeCommand,
            hasPendingInteractiveResults: () => false,
            getPendingInteractiveResults: () => [],
            handleUserSelectionResult: () => false,
            on: vi.fn(),
        };
        const llmClient = makeLLMClient(
            {
                reply: "Set the title.",
                stemscript: 'project title "Crystal Dash"',
            },
            {
                reply: "Re-applied the title.",
                stemscript: 'project title "Crystal Dash"',
            },
            {
                reply: "Should not be used.",
                stemscript: "add box name=Unexpected",
            },
        );
        const provider = new DirectCopilotProvider({
            llmClient,
            resolveKey: async () => openAIKey,
            createExecutor: () => executor,
        });

        const response = await provider.prompt("set the game title");

        expect(llmClient.generateText).toHaveBeenCalledTimes(2);
        expect(executeCommand).toHaveBeenCalledWith("set_project_title", expect.objectContaining({
            title: "Crystal Dash",
        }));
        expect(response).toContain("Verification failed");
        expect(response).toContain("Repair pass:");
    });

    it("materializes lambda, script import, and file artifacts before assembly StemScript", async () => {
        await withFakeAssetApp(async assetSource => {
            const executor = makeExecutor();
            const llmClient = makeLLMClient({
                reply: "Created reusable assets and assembled the scene.",
                phases: [
                    {
                        name: "Reusable systems",
                        artifacts: [
                            {
                                type: "lambda",
                                name: "Enemy State",
                                code: "export default class EnemyState {}",
                                config: {
                                    id: "enemy-state",
                                    name: "Enemy State",
                                    version: "1.0.0",
                                    main: "index.js",
                                    attributes: {},
                                    componentSchema: {},
                                },
                            },
                            {
                                type: "scriptImport",
                                name: "wave-math",
                                code: "export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));",
                            },
                            {
                                type: "file",
                                name: "waves.json",
                                content: "{\"waves\":[1,2,3]}",
                                format: "json",
                                contentType: "application/json",
                            },
                        ],
                        stemscript: "add group name=ArtifactScene",
                    },
                ],
            });
            const provider = new DirectCopilotProvider({
                llmClient,
                resolveKey: async () => openAIKey,
                createExecutor: () => executor,
            });

            const response = await provider.prompt("make reusable wave artifacts");

            expect(assetSource.createAsset, response).toHaveBeenCalledTimes(3);
            expect(assetSource.createAsset).toHaveBeenCalledWith(expect.objectContaining({
                name: "Enemy State",
                format: "json",
                contentType: "application/json",
            }));
            expect(assetSource.createAsset).toHaveBeenCalledWith(expect.objectContaining({
                name: "wave-math",
            }));
            expect(assetSource.createAsset).toHaveBeenCalledWith(expect.objectContaining({
                name: "waves.json",
                format: "json",
                contentType: "application/json",
            }));
            expect(executor.executeCommand, response).toHaveBeenCalledWith("create_group", expect.objectContaining({
                name: "ArtifactScene",
            }));
            expect(response).toContain("Materialized 3/3 reusable artifact");
            expect(response).toContain("Applied 1/1 command");
        });
    });

    it("asks before essential external asset generation instead of mutating", async () => {
        const executor = makeExecutor();
        const llmClient = makeLLMClient({
            reply: "A generated hero model is essential for this request.",
            assetRequests: [
                {
                    type: "model",
                    name: "HeroShip",
                    prompt: "sleek hero spaceship",
                    essential: true,
                    reason: "The user asked for an exact generated model.",
                },
            ],
            stemscript: "add box name=ShouldNotRun",
        });
        const provider = new DirectCopilotProvider({
            llmClient,
            resolveKey: async () => openAIKey,
            createExecutor: () => executor,
        });

        const response = await provider.prompt("generate a hero spaceship model");

        expect(executor.executeCommand).not.toHaveBeenCalled();
        expect(response).toContain("Asset generation approval needed");
        expect(response).toContain("Should I generate these assets");
    });

    it("passes Anthropic key and dynamic knowledge to the LLM client", async () => {
        const executor = makeExecutor();
        const llmClient = makeLLMClient({
            reply: "Added behavior.",
            stemscript:
                'behavior add name="ScoreController" description="Copilot generated for: score over time" code="this.update = function(dt) {}"',
        });
        const provider = new DirectCopilotProvider({
            llmClient,
            resolveKey: async () => anthropicKey,
            createExecutor: () => executor,
        });

        await provider.prompt("add a score controller behavior");
        const llmRequest = vi.mocked(llmClient.generateText).mock.calls[0]?.[0];

        expect(llmRequest?.key).toMatchObject({provider: "anthropic", model: "claude-sonnet-4-5-20250929"});
        expect(llmRequest?.systemPrompt).toContain("StemStudio playground copilot");
        expect(llmRequest?.knowledgePrompt).toContain("StemStudio playground knowledge base");
        expect(llmRequest?.prompt).toContain("User request:");
        expect(executor.executeCommand).toHaveBeenCalledWith("add_behavior", expect.objectContaining({
            name: "ScoreController",
            description: "Copilot generated for: score over time",
        }));
    });

    it("does not call a provider without a BYOK chat key", async () => {
        const llmClient = makeLLMClient();
        const provider = new DirectCopilotProvider({
            llmClient,
            resolveKey: async () => null,
            createExecutor: makeExecutor,
        });

        const response = await provider.prompt("make a scene");

        expect(llmClient.generateText).not.toHaveBeenCalled();
        expect(response).toContain("No AI provider key");
    });

    it("asks for a model selection when multiple BYOK chat keys are configured", async () => {
        const llmClient = makeLLMClient();
        const provider = new DirectCopilotProvider({
            llmClient,
            resolveKeyChoice: async () => ({
                kind: "needs-selection",
                keys: [
                    openAIKey,
                    {provider: "gemini", apiKey: "gem-test", model: "gemini-2.5-flash"},
                ],
            }),
            createExecutor: makeExecutor,
        });

        const response = await provider.prompt("make a game");

        expect(llmClient.generateText).not.toHaveBeenCalled();
        expect(response).toContain("Multiple AI provider keys");
        expect(response).toContain("openai: gpt-5.5");
        expect(response).toContain("gemini: gemini-2.5-flash");
    });
});
