/* eslint-disable no-case-declarations */
import JSZip from "jszip";
import * as THREE from "three";
import {Camera, Object3D, Scene} from "three";
import {GLTFExporter} from "three/addons/exporters/GLTFExporter.js";

import {
    AI_OPERATION,
    AICodeEditResponse,
    AiCommand,
    AiCommandsResponse,
    AiDecisionPromptResponse,
    AIResponse,
    AISearchTagsResponse,
    COMMANDS,
    CommandExecutionResult,
    GENERATION_STEPS,
    GenerationStep,
    IMAGE_TYPES,
    ModelsSearchResponse,
    PendingCommandData,
    AiAgentRequest,
    AI_AGENT_MODE,
    RiggingMetadata,
    ExternalAssetsSearchResponse,
} from "./AiWorldController.types";
import {
    urlToFile,
    generateAssetFile,
    generateAssetUrl,
    getLookAtPointOnGround,
    getSceneData,
    getObjectData,
    clearAllIndicators,
} from "./AiWorldController.utils";
import {DOCS, GAME_MANAGER_DOCS, PHYSICS_DOCS} from "./docs";
import {
    AssetType,
    createAssetWithData,
    createAssetDerivativeWithData,
    AssetDerivativeType,
    ModelFormat,
} from "@stem/network/api/asset";
import EngineRuntime from "@stem/editor-oss/EngineRuntime";
import ModelLoader from "../../assets/js/loaders/ModelLoader";
import * as Commands from "@stem/editor-oss/command/Commands";
import {javaScriptStarter} from "@stem/editor-oss/editor/script/JavaScriptStarter";
import {showToast} from "@stem/editor-oss/showToast";
import {GenerateImageRequest} from "@stem/editor-oss/types/imageGenerator";
import {getAIBackend} from "@stem/editor-oss/ai";
import Ajax from "@stem/editor-oss/utils/Ajax";
import ImageGeneratorProvider from "@stem/editor-oss/utils/ImageGeneratorProvider";
import ModelGeneratorProvider, {GENERATOR_TYPES, getGeneratorCapability} from "@stem/editor-oss/utils/ModelGeneratorProvider";
import {backendUrlFromPath} from "@stem/editor-oss/utils/UrlUtils";

/**
 * Extracts code blocks from markdown text
 * Specifically targets blocks wrapped in ```json and ```javascript tags
 */
const CODE_BLOCK_REGEX = /```(json|javascript)([\s\S]*?)```/g;
interface CodeBlock {
    language: string;
    content: string;
}

class AIWorldController {
    private static instance: AIWorldController | null = null;
    private scene: Scene;
    private player: Object3D | undefined | null = null;
    private engine: EngineRuntime;
    private camera: Camera;
    private sceneId: string = "";
    private OBJECTS_MODEL_ID = "model_hTRC1xN4YN3mWNDRroV85eCX";
    private playerWidth = "1";
    private playerHeight = "2";
    private authToken: string | undefined = "";
    private lastModifiedObject: Object3D | null = null;
    private isModelUploadBusy: boolean = false;
    private threadId: string = "";
    private isAiAgentAborted: boolean = false;
    // Configuration for commands requiring confirmation
    private commandsRequiringConfirmation: Set<COMMANDS> = new Set([]);
    private agentMode: AI_AGENT_MODE = AI_AGENT_MODE.EDITOR;
    modelGeneratorProvider: ModelGeneratorProvider | null = null;
    imageGeneratorProvider: ImageGeneratorProvider | null = null;
    isPlayer: boolean = false;
    isDebugMode: boolean = false;
    abortController: AbortController;

    constructor(engine: EngineRuntime, scene: Scene, camera: Camera, sceneId?: string) {
        this.scene = scene;
        this.sceneId = sceneId || "";
        this.engine = engine;
        this.camera = camera;
        this.authToken = this.engine.authManager.getAuthToken() || "";

        this.modelGeneratorProvider = new ModelGeneratorProvider(this.authToken);
        this.imageGeneratorProvider = new ImageGeneratorProvider(this.authToken);
        this.abortController = new AbortController();
        this.updatePlayerData();

        this.engine.on("sceneLoaded.AiWorldController", () => {
            clearAllIndicators();
        });
    }

    public static getInstance(engine?: EngineRuntime): AIWorldController {
        if (!AIWorldController.instance) {
            if (!engine) {
                throw new Error("EngineRuntime instance required for first initialization");
            }
            AIWorldController.instance = new AIWorldController(engine, engine.scene, engine.camera);
        }
        return AIWorldController.instance;
    }

    /**
     * Reset the singleton instance (for testing or reconnection with different config)
     */
    public static resetInstance(): void {
        if (AIWorldController.instance) {
            AIWorldController.instance.dispose();
            AIWorldController.instance = null;
        }
    }

    getBehaviorConfigs = async () => {
        const service = this.engine?.behaviorLoadingService;
        if (!service) {
            return this.scene.userData.behaviorConfigs;
        }
        try {
            return await service.loadDefaultConfigs();
        } catch (error) {
            console.error("Error loading behavior configs:", error);
            throw error;
        }
    };

    getLastModifiedObject = () => {
        return this.lastModifiedObject;
    };

    getSceneId = () => {
        return this.sceneId;
    };

    // Methods for managing commands requiring confirmation
    setCommandsRequiringConfirmation = (commands: COMMANDS[]) => {
        this.commandsRequiringConfirmation = new Set(commands);
    };

    addCommandRequiringConfirmation = (command: COMMANDS) => {
        this.commandsRequiringConfirmation.add(command);
    };

    removeCommandRequiringConfirmation = (command: COMMANDS) => {
        this.commandsRequiringConfirmation.delete(command);
    };

    getCommandsRequiringConfirmation = (): COMMANDS[] => {
        return Array.from(this.commandsRequiringConfirmation);
    };

    private doesCommandRequireConfirmation = (command: AiCommand): boolean => {
        return this.commandsRequiringConfirmation.has(command.type);
    };

    setAgentMode = (mode: AI_AGENT_MODE) => {
        this.agentMode = mode;
    };

    getAgentMode = () => {
        return this.agentMode;
    };

    private updatePlayerData = () => {
        if (!this.player) {
            this.player = this.engine.game?.player;
        }
        const boundingBox = this.player ? new THREE.Box3().setFromObject(this.player) : null;
        this.playerWidth = boundingBox ? (boundingBox.max.x - boundingBox.min.x).toFixed(2) : "1";
        this.playerHeight = boundingBox ? (boundingBox.max.y - boundingBox.min.y).toFixed(2) : "2";
    };

    /**
     * Extracts code blocks from markdown text
     * @param markdownText - The markdown text to extract code blocks from
     * @returns An array of CodeBlock objects containing the language and content
     */
    private extractCodeBlocks(markdownText: string): string {
        // Regular expression to match code blocks
        // This pattern looks for:
        // - Three backticks followed by either "json" or "javascript"
        // - Any content (non-greedy matching)
        // - Three backticks to close the block

        const blocks: CodeBlock[] = [];
        let match: RegExpExecArray | null;

        // Find all matches
        while ((match = CODE_BLOCK_REGEX.exec(markdownText)) !== null) {
            const language = match[1] ?? "";
            // Trim the content to remove leading/trailing whitespace
            const content = (match[2] ?? "").trim();

            blocks.push({
                language,
                content,
            });
        }

        return blocks.length > 0 ? blocks[0]!.content : "";
    }

    // This method is used to call the AI Agent API. AI Agent is used to generate commands to edit scene
    // it is capable of requesting the client to get more context about the scene, player, selected object, etc.
    async callAIAgent(
        userMessage: string,
        params: {
            sceneData?: string;
            playerData?: string;
            selectedObjectData?: string;
            objectData?: string;
            behaviorConfig?: string;
            playerWidth?: string;
            playerHeight?: string;
            docs?: string;
            starterCode?: string;
            lookAtPointData?: string;
            searchResults?: string;
        } = {},
    ): Promise<AiCommandsResponse | null> {
        try {
            if (this.isAiAgentAborted) {
                this.isAiAgentAborted = false;
                return null;
            }
            this.abortController = new AbortController();
            const aiResponse = await getAIBackend().request<{agentResponse: string; threadId?: string}>("/api/AI/Agent", {
                method: "POST",
                body: {
                    userMessage,
                    agentMode: this.agentMode,
                    threadId: this.threadId,
                    ...params,
                },
                headers: {"X-BYOK-Provider": "anthropic"},
                signal: this.abortController.signal,
            });

            if (aiResponse.ok && aiResponse.data) {
                const {agentResponse} = aiResponse.data;
                const regex = /,(?!\s*?[{["'\w])/g;
                let assistantText = agentResponse.replace(regex, "");

                let match: RegExpExecArray | null;
                // eslint-disable-next-line no-cond-assign
                if (match = CODE_BLOCK_REGEX.exec(assistantText)) {
                    const content = (match[2] ?? "").trim();
                    assistantText = content;
                }
                const json = JSON.parse(assistantText) as AiCommandsResponse;
                this.threadId = aiResponse.data.threadId || this.threadId;
                sessionStorage.setItem("aiThreadId", this.threadId);
                return json;
            } else {
                throw Error("No response from AI.");
            }
        } catch (error) {
            console.error("Error calling AI Assistant:", error);
            throw error;
        }
    }

    private async callAIAssistant<T>(
        operation: string,
        userMessage: string,
        params: {
            sceneData?: string;
            playerData?: string;
            selectedObjectData?: string;
            behaviorConfig?: string;
            playerWidth?: string;
            playerHeight?: string;
            docs?: string;
            starterCode?: string;
            lookAtPointData?: string;
            searchResults?: string;
        } = {},
    ): Promise<T | undefined> {
        try {
            this.abortController = new AbortController();
            const aiResponse = await getAIBackend().request<{assistantResponse: string}>("/api/AI/Assistant", {
                method: "POST",
                body: {
                    operation,
                    userMessage,
                    ...params,
                },
                headers: {"X-BYOK-Provider": "openai"},
                signal: this.abortController.signal,
            });

            if (aiResponse.ok && aiResponse.data) {
                const {assistantResponse} = aiResponse.data;
                const regex = /,(?!\s*?[{["'\w])/g;
                const assistantText = assistantResponse.replace(regex, "");

                if (operation === (AI_OPERATION.EDIT_CODE_PROMPT as string)) {
                    return {code: this.extractCodeBlocks(assistantText)} as T;
                }
                this.engine.call("aiAssistantResponse", this, assistantText);
                return JSON.parse(assistantText) as T;
            } else {
                throw Error("No response from AI.");
            }
        } catch (error) {
            console.error("Error calling AI Assistant:", error);
            throw error;
        }
    }

    generateDecision = async (prompt: string) => {
        try {
            const res = await this.callAIAssistant<AiDecisionPromptResponse>(AI_OPERATION.DECISION_PROMPT, prompt);
            return res;
        } catch (error) {
            console.error("Error:", error);
            throw error;
        }
    };

    generateCodeEdit = async (prompt: string) => {
        const behaviorConfigs = await this.getBehaviorConfigs();
        try {
            const res = await this.callAIAssistant<AICodeEditResponse>(AI_OPERATION.EDIT_CODE_PROMPT, prompt, {
                behaviorConfig: JSON.stringify(behaviorConfigs),
                starterCode: javaScriptStarter("object.uuid"),
                docs: [PHYSICS_DOCS, GAME_MANAGER_DOCS].join("\n"),
            });
            return res;
        } catch (error) {
            console.error("Error:", error);
            throw error;
        }
    };

    generateCommands = async (prompt: string, targetObject?: THREE.Object3D | null, searchResults?: string) => {
        this.updatePlayerData();

        const selectedObject = targetObject || this.engine.editor?.selected;

        try {
            const behaviorConfigs = this.getBehaviorConfigs();
            const res = await this.callAIAssistant<AiCommandsResponse>(AI_OPERATION.COMMANDS_PROMPT, prompt, {
                sceneData: JSON.stringify(getSceneData(this.scene)),
                selectedObjectData: JSON.stringify(getObjectData(selectedObject)),
                playerData: JSON.stringify(getObjectData(this.player, true)),
                behaviorConfig: JSON.stringify(behaviorConfigs),
                lookAtPointData: JSON.stringify(
                    !this.engine.isPlaying
                        ? this.engine.editor?.getObjectInsertPoint() || {}
                        : this.engine.editor?.getCameraLookAtPoint() || {},
                ),
                searchResults: searchResults || "",
            });
            return res;
        } catch (error) {
            console.error("Error:", error);
            throw error;
        }
    };

    generateSteps = async (prompt: string) => {
        try {
            const behaviorConfigs = await this.getBehaviorConfigs();
            const res = await this.callAIAssistant<GenerationStep[]>(AI_OPERATION.GENERATE_STEPS_PROMPT, prompt, {
                behaviorConfig: JSON.stringify(behaviorConfigs),
                docs: DOCS,
            });
            return res;
        } catch (error) {
            console.error("Error:", error);
            throw error;
        }
    };

    enchancePrompt = async (prompt: string, is3D?: boolean) => {
        try {
            const aiResponse = await this.callAIAssistant<AIResponse>(
                is3D ? AI_OPERATION.ENHANCE_MODEL_PROMPT : AI_OPERATION.ENHANCE_IMAGE_PROMPT,
                prompt,
                {
                    playerWidth: this.playerWidth,
                    playerHeight: this.playerHeight,
                },
            );
            return aiResponse;
        } catch (error) {
            console.error("Error:", error);
            throw error;
        }
    };

    generateSearchTags = async (prompt: string) => {
        this.updatePlayerData();
        try {
            const aiResponse = await this.callAIAssistant<AISearchTagsResponse>(
                AI_OPERATION.SEARCH_TAGS_PROMPT,
                prompt,
                {
                    playerWidth: this.playerWidth,
                    playerHeight: this.playerHeight,
                },
            );
            return aiResponse;
        } catch (error) {
            console.error("Error:", error);
            throw error;
        }
    };

    generateModelImage = async (
        aiResponse: AIResponse,
        options: GenerateImageRequest,
        additinalPrompt: string,
        imageType: IMAGE_TYPES,
        isFile: boolean,
        onError: (message?: string) => void,
        onSuccess?: () => void,
        onProgress?: (step: GENERATION_STEPS) => void,
    ) => {
        try {
            onProgress?.(GENERATION_STEPS.GENERATE_IMAGE);

            const modelId = this.OBJECTS_MODEL_ID;
            let response;
            if (imageType === IMAGE_TYPES.CHARACTER || imageType === IMAGE_TYPES.OBJECT) {
                options.prompt = options.prompt + " " + additinalPrompt;
                response = await this.imageGeneratorProvider?.generateImage({...options, modelId: modelId});
            } else if (imageType === IMAGE_TYPES.SKYBOX) {
                response = await this.imageGeneratorProvider?.generateSkybox({...options, modelId: modelId});
            } else {
                response = await this.imageGeneratorProvider?.generateTexture({...options, modelId: modelId});
            }

            if (response.assetIds.length === 0) {
                onError();
                return;
            }
            if (imageType === IMAGE_TYPES.CHARACTER || imageType === IMAGE_TYPES.OBJECT) {
                onProgress?.(GENERATION_STEPS.REMOVE_BACKGROUND);
                response = await this.imageGeneratorProvider?.removeImageBackground({assetId: response.assetIds[0]});
                if (response.assetIds.length === 0) {
                    onError();
                    return;
                }
            }

            onProgress?.(GENERATION_STEPS.UPLOAD_IMAGE);
            if (isFile) {
                const file = await generateAssetFile(this.imageGeneratorProvider, response.assetIds[0], onError);

                onSuccess?.();

                return {...aiResponse, file, url: ""};
            }
            const url = await generateAssetUrl(this.imageGeneratorProvider, {assetId: response.assetIds[0]}, onError);

            onSuccess?.();

            return {...aiResponse, url, file: null};
        } catch (error) {
            console.error(error);
            onError();
        }
    };

    uploadImageFor3dObjectGeneration = async (image: File, onProgress?: (step: GENERATION_STEPS) => void) => {
        try {
            onProgress?.(GENERATION_STEPS.UPLOAD_IMAGE);
            const res = await this.modelGeneratorProvider?.uploadImage(image);
            if (res?.status !== 200) {
                showToast({type: "error", title: "Failed to upload image."});
            }
            return res?.data.data.image_token;
        } catch (error) {
            console.error(error);
        }
    };

    generate3dObject = async (
        args: {
            generationType: "text_to_model" | "image_to_model";
            prompt: string;
            negative_prompt?: string;
            url?: string;
            file_token?: string;
            quality?: string;
            model_version?: string;
            generator?: GENERATOR_TYPES;
            target_polycount?: number;
            autoRig?: boolean;
            refine?: boolean;
        },

        onProgress?: (progress: number) => void,
        onTaskCreated?: (task_id: string) => void,
    ) => {
        this.abortController = new AbortController();
        const {
            generationType,
            prompt,
            negative_prompt,
            url: argUrl,
            file_token,
            model_version,
            quality,
            generator,
            target_polycount,
            autoRig,
            refine,
        } = args;
        const url = argUrl ? backendUrlFromPath(argUrl) : "";

        try {
            const res = await this.modelGeneratorProvider?.generateModel(
                {
                    type: generationType,
                    prompt,
                    negative_prompt,
                    url,
                    file_token,
                    quality: quality || "detailed",
                    model_version: model_version || "",
                    generator,
                    target_polycount,
                    autoRig,
                    refine,
                },
                this.abortController.signal,
                onProgress,
                onTaskCreated,
            );
            if (res) {
                const task_id = res.id;
                const model = res.model;
                const rendered_image = res.thumbnail;
                const composition = res.composition;
                const intermediateImage = res.intermediateImage;
                // Include rigging metadata only when auto-rig was requested AND
                // the provider has a proven rigging path (Meshy/Tripo). Rodin
                // exposes no rigging yet, so it never reports a rigged model.
                // Use riggingFailed flag to determine if rigging actually succeeded.
                const providerSupportsRig = generator ? getGeneratorCapability(generator).supportsAutoRig : false;
                const riggingMetadata: RiggingMetadata | undefined = autoRig && providerSupportsRig
                    ? {
                          isRigged: !res.riggingFailed,
                          riggedWith: res.riggingFailed ? undefined : generator,
                      }
                    : undefined;
                return {
                    task_id,
                    model,
                    rendered_image,
                    composition,
                    intermediateImage,
                    riggingMetadata,
                    assetId: (res as any).assetId as string | undefined
                };
            }
        } catch (error) {
            showToast({title: "Failed to generate model.", type: "error"});
            console.error(error);
            throw error;
        }
    };

    generateAndUpload3dObject = async (
        args: {
            generationType: "text_to_model" | "image_to_model";
            prompt: string;
            negative_prompt?: string;
            url?: string;
            file_token?: string;
            quality?: string;
            model_version?: string;
            generator?: GENERATOR_TYPES;
            enhancePrompt?: boolean;
        },

        onProgress?: (progress: number) => void,
        onTaskCreated?: (task_id: string) => void,
    ) => {
        let enchancePromptRes = null;
        try {
            if (args.enhancePrompt) {
                enchancePromptRes = await this.enchancePrompt(args.prompt, true);
            }
        } catch (error) {
            console.error("Failed to enhance prompt", error);
        }
        try {
            const {name, tags, prompt, width, height} = enchancePromptRes || {
                name: "",
                tags: [],
                prompt: args.prompt,
                width: undefined,
                height: undefined,
            };
            const res = await this.generate3dObject({...args, prompt}, onProgress, onTaskCreated);
            if (!res) {
                throw new Error("Failed to generate model");
            }

            // Job completed server-side — asset already uploaded, skip uploadObjectByUrl
            if (res.assetId) {
                return {assetId: res.assetId, Name: name || "object", width, height};
            }

            await new Promise(resolve => setTimeout(resolve, 1000)); // sometimes tripo requires delay
            const objData = await this.uploadObjectByUrl(
                res.model!,
                res.rendered_image ?? "",
                name || "object",
                tags,
                undefined, // onProgress
                undefined, // libraryID
                undefined, // sceneID
                undefined, // ERTHLibrary
                undefined, // zippedFile
                res.riggingMetadata, // riggingMetadata
            );

            return {...objData, width, height};
        } catch (error) {
            showToast({title: "Failed to generate model.", type: "error"});
            console.error(error);
            throw error;
        }
    };

    addObjectToScene = (
        object: THREE.Object3D,
        is2D: boolean,
        width?: number,
        height?: number,
        point?: THREE.Vector3Like,
    ) => {
        let targetObject = object;
        this.updatePlayerData();

        if (!is2D && targetObject.children.length === 1 && targetObject instanceof THREE.Group) {
            targetObject.userData.isSingleChildModel = true;
        }

        let boundingBox = new THREE.Box3().setFromObject(targetObject);

        if (width && height && !is2D) {
            const objHeight = boundingBox.max.y - boundingBox.min.y;
            const normalizedHeight = 1 / objHeight;
            const scale = height * normalizedHeight;
            targetObject.scale.set(scale, scale, scale);
        }

        boundingBox = new THREE.Box3().setFromObject(targetObject);
        const playerBoundingBox = this.player ? new THREE.Box3().setFromObject(this.player) : null;
        const halfHeight = (boundingBox.max.y - boundingBox.min.y) / 2;

        if (!point) {
            const lookAtPoint = getLookAtPointOnGround(this.camera);
            const feetPosition = playerBoundingBox?.min.y || 0;

            const y = feetPosition + halfHeight;
            const x = this.player?.position.x || lookAtPoint?.x || 0;
            const z = this.player?.position.z || lookAtPoint?.z || 0;

            targetObject.position.set(x, y, z);
        } else {
            // Place the bottom of the object at the given point
            this.engine.editor?.moveObjectToPoint(targetObject, point);
        }

        const cameraPosition = this.camera.position.clone();
        cameraPosition.y = targetObject.position.y;
        targetObject.lookAt(cameraPosition);

        new Commands.AddObjectCommand(targetObject).execute();

        targetObject.updateMatrixWorld(true);

        void this.engine.game?.addAllBehaviorsFromObject(targetObject);

        return targetObject;
    };

    addModelToSceneFromServer = async (objData: {Url: string; Image: string; Type: string}, name: string) => {
        let loader = new (ModelLoader as any)(this.engine);
        let url = backendUrlFromPath(objData.Url);

        try {
            const obj: THREE.Object3D = await loader.load(url, objData, {
                camera: this.camera,
                renderer: this.engine.renderer,
            });
            if (!obj) {
                return;
            }
            obj.name = name;
            Object.assign(obj.userData, objData, {
                Server: true,
            });

            return obj;
        } catch (error) {
            console.error(error);
            throw error;
        }
    };

    uploadModel = async (model: THREE.Object3D, name: string, imageUrl: string) => {
        try {
            const exporter = new GLTFExporter();
            const {ModelUtils} = await import("@stem/editor-oss/utils/ModelUtils");

            await new Promise<string>((resolve, reject) => {
                exporter.parse(
                    model,
                    async result => {
                        try {
                            let arrayBuffer = result as ArrayBuffer;
                            arrayBuffer = (await ModelUtils.compressModel(arrayBuffer, {isJSON: false}, () => {
                                showToast({title: "Could not compress model", type: "warning"});
                            })) as ArrayBuffer;
                            const blob = new Blob([arrayBuffer], {type: "model/gltf-binary"});
                            const fileUrl = URL.createObjectURL(blob);
                            await this.uploadObjectByUrl(fileUrl, imageUrl, name);
                            resolve(fileUrl);
                        } catch (error) {
                            showToast({title: "Error processing model", type: "error"});

                            reject(error instanceof Error ? error : new Error(String(error)));
                        }
                    },
                    () => {},
                    {trs: true, binary: true, includeCustomExtensions: true},
                );
            });
        } catch (error) {
            showToast({title: "Failed to upload model", type: "error"});
            console.error(error);
            throw error;
        }
    };

    searchModels = async (phrases: string[]) => {
        console.log("Searching models with phrases:", phrases);
        try {
            const response = await Ajax.post({
                url: backendUrlFromPath(`/api/Mesh/Search`),
                msgBodyType: "json",
                data: JSON.stringify({phrases}),
                token: this.authToken || null,
                needAuthorization: true,
            });

            if (response?.data.Code === 200) {
                return response.data.Data as ModelsSearchResponse;
            } else {
                return null;
            }
        } catch (error) {
            console.error("Error searching models:", error);

            return null;
        }
    };

    searchExternalAssets = async (prompt: string, provider?: string) => {
        try {
            this.abortController = new AbortController();
            const searchRes = await getAIBackend().request<ExternalAssetsSearchResponse>("/api/AI/SearchAssets", {
                method: "POST",
                body: {
                    userQuery: prompt,
                    provider: provider || "",
                },
                signal: this.abortController.signal,
            });
            if (searchRes.ok && searchRes.data) {
                return searchRes.data;
            } else {
                throw Error("No response from AI.");
            }
        } catch (error) {
            console.error("Error searching external models:", error);
            throw error;
        }
    };

    /**
     * Uploads a model using the new asset API with support for rigging metadata.
     * @param modelBlob
     * @param thumbnailUrl
     * @param name
     * @param sceneId
     * @param riggingMetadata
     */
    private uploadModelWithAssetApi = async (
        modelBlob: Blob,
        thumbnailUrl: string,
        name: string,
        riggingMetadata?: RiggingMetadata,
    ) => {
        // Build metadata including rigging info
        const metadata: Record<string, unknown> = {
            isAIGenerated: true,
        };

        if (riggingMetadata) {
            metadata.isRigged = riggingMetadata.isRigged;
            if (riggingMetadata.riggedWith) {
                metadata.riggedWith = riggingMetadata.riggedWith;
            }
            if (riggingMetadata.topology) {
                metadata.topology = riggingMetadata.topology;
            }
        }

        // Create the asset using the new asset API
        const asset = await createAssetWithData({
            type: AssetType.Model,
            name,
            data: modelBlob,
            format: ModelFormat.Glb,
            contentType: "model/gltf-binary",
            options: {
                metadata,
            },
        });

        // Create thumbnail derivative if we have a thumbnail URL
        if (thumbnailUrl) {
            try {
                const thumbnailResponse = await fetch(thumbnailUrl);
                if (thumbnailResponse.ok) {
                    const thumbnailBlob = await thumbnailResponse.blob();
                    await createAssetDerivativeWithData({
                        assetId: asset.id,
                        revisionId: asset.headRevisionId,
                        type: AssetDerivativeType.Thumbnail,
                        format: "png",
                        contentType: "image/png",
                        data: thumbnailBlob,
                        metadata: {
                            width: 256,
                            height: 256,
                        },
                    });
                }
            } catch (error) {
                console.warn("Failed to create thumbnail derivative:", error);
            }
        }

        return {
            ID: asset.id,
            Name: asset.name,
            Url: `/api/asset/${asset.id}/revisions/${asset.headRevisionId}/data`,
            IsAIGenerated: true,
            isRigged: riggingMetadata?.isRigged || false,
            riggedWith: riggingMetadata?.riggedWith,
        };
    };

    uploadObjectByUrl = async (
        url: string,
        imageUrl: string,
        name: string,
        tags: string[] = [],
        onProgress?: (step: GENERATION_STEPS) => void,
        libraryID?: string,
        sceneID?: string,
        ERTHLibrary?: boolean,
        zippedFile?: File,
        riggingMetadata?: RiggingMetadata,
    ) => {
        onProgress?.(GENERATION_STEPS.UPLOADING_MODEL);
        const isBlob = url.startsWith("blob:");
        const extension = isBlob ? "glb" : url.split(/[#?]/)[0]?.split(".")?.pop()?.trim();

        while (this.isModelUploadBusy) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        this.isModelUploadBusy = true;
        try {
            const image = await generateAssetUrl(this.imageGeneratorProvider, {assetUrl: imageUrl}, () => {
                showToast({title: "Failed to upload image.", type: "error"});
            });

            // Use the new asset API for rigged models
            if (riggingMetadata?.isRigged) {
                const modelFile = await urlToFile(url, `${name}.${extension || "glb"}`, "model/gltf-binary");
                const modelBlob = new Blob([modelFile], {type: "model/gltf-binary"});
                const result = await this.uploadModelWithAssetApi(
                    modelBlob,
                    image ?? "",
                    name,
                    riggingMetadata,
                );
                return result;
            }

            // Legacy path for non-rigged models
            if (!zippedFile) {
                const file = await urlToFile(url, `${name}.${extension || "glb"}`, "model/gltf-binary");

                const zipper = new JSZip();

                zipper.file(file.name, file);
                const zip = await zipper.generateAsync({type: "blob"});
                zippedFile = new File([zip], `${name}.zip`);
            }

            const data: any = {
                file: zippedFile,
                Image: image,
                IsAIGenerated: true,
                SceneID: this.sceneId,
                Tags: tags.length > 0 ? JSON.stringify(tags) : "",
            };
            if (sceneID) {
                data.SceneID = sceneID;
            }

            if (libraryID) {
                data.LibraryID = libraryID;
            }

            if (ERTHLibrary !== undefined) {
                data.ERTHLibrary = ERTHLibrary;
            }

            const response = await Ajax.post({
                url: backendUrlFromPath(`/api/Mesh/Add`),
                data,
                msgBodyType: "multipart",
                token: this.authToken || "",
                needAuthorization: true,
            });

            if (response?.data.Code === 200) {
                console.log("Model uploaded successfully:", response.data.Data);
                return response.data.Data;
            } else {
                throw Error("Failed to upload model");
            }
        } catch (error) {
            console.error(`Request failed. ${String(error)}`);
            throw error;
        } finally {
            this.isModelUploadBusy = false;
            if (!this.isPlayer) {
                this.engine.call("fetchModels");
            }
        }
    };

    generateRandomColor() {
        const randomHex = Math.floor(Math.random() * 16777215).toString(16);
        return "#" + randomHex.padStart(6, "0");
    }

    executeCommands = async (
        commands: AiCommand,
        isMutli?: boolean,
        onPendingConfirmation?: (data: PendingCommandData) => Promise<PendingCommandData | undefined>,
    ): Promise<CommandExecutionResult> => {
        if (!commands || this.isAiAgentAborted) {
            return {response: "", mainCommand: null, newCommands: null, allCommands: []};
        }

        let command;
        const allCommands: any[] = [];
        let newCommands: AiCommand | null = null;
        let aiResponse: AiCommandsResponse | null = null;
        let response = "";
        let isCompleted = false;
        let aiAgentRequest: AiAgentRequest | null = null;

        const getTargetObject = (objectName: string) => {
            if (objectName) {
                const object = this.scene.getObjectByName(objectName);
                if (object) {
                    this.lastModifiedObject = object;
                    return object;
                }
            }

            return this.lastModifiedObject;
        };

        const createMaterial = (params: any) => {
            const material = new THREE.MeshStandardMaterial();

            if (params.color) {
                material.color.set(params.color);
            }

            return material;
        };

        const setPosition = (object: THREE.Object3D, position: THREE.Vector3) => {
            if (position) {
                const boundingBox = new THREE.Box3().setFromObject(object);
                const halfHeight = (boundingBox.max.y - boundingBox.min.y) / 2;

                let y = position.y ? position.y + halfHeight : halfHeight;
                if (!y || y === Infinity || y === -Infinity) {
                    y = 0;
                }
                object.position.set(position.x ?? 0, y, position.z ?? 0);
            }
        };

        const addObjectToScene = (object: Object3D) => {
            void this.engine.game?.addAllBehaviorsFromObject(object);
        };

        switch (commands.type) {
            case COMMANDS.ADD_OBJECT:
                const type = commands.params.type?.toLowerCase();

                if (type === "box" || type === "cube") {
                    const width = commands.params.width ?? 1;
                    const height = commands.params.height ?? 1;
                    const depth = commands.params.depth ?? 1;
                    const widthSegments = commands.params.widthSegments ?? 1;
                    const heightSegments = commands.params.heightSegments ?? 1;
                    const depthSegments = commands.params.depthSegments ?? 1;
                    const geometry = new THREE.BoxGeometry(
                        width,
                        height,
                        depth,
                        widthSegments,
                        heightSegments,
                        depthSegments,
                    );
                    const mesh = new THREE.Mesh(geometry, createMaterial(commands.params));
                    mesh.name = commands.params.name || "Box";

                    setPosition(mesh, commands.params.position);

                    command = new Commands.AddObjectCommand(mesh, null, addObjectToScene.bind(this));
                    this.lastModifiedObject = mesh;
                } else if (type === "sphere") {
                    const radius = commands.params.radius ?? 0.5;
                    const widthSegments = commands.params.widthSegments ?? 32;
                    const heightSegments = commands.params.heightSegments ?? 16;
                    const geometry = new THREE.SphereGeometry(radius, widthSegments, heightSegments);
                    const mesh = new THREE.Mesh(geometry, createMaterial(commands.params));
                    mesh.name = commands.params.name || "Sphere";

                    setPosition(mesh, commands.params.position);

                    command = new Commands.AddObjectCommand(mesh, null, addObjectToScene.bind(this));
                    this.lastModifiedObject = mesh;
                } else if (type === "cylinder") {
                    const radiusTop = commands.params.radiusTop ?? 0.5;
                    const radiusBottom = commands.params.radiusBottom ?? 0.5;
                    const height = commands.params.height ?? 1;
                    const radialSegments = commands.params.radialSegments ?? 32;
                    const heightSegments = commands.params.heightSegments ?? 1;
                    const openEnded = commands.params.openEnded ?? false;
                    const geometry = new THREE.CylinderGeometry(
                        radiusTop,
                        radiusBottom,
                        height,
                        radialSegments,
                        heightSegments,
                        openEnded,
                    );
                    const mesh = new THREE.Mesh(geometry, createMaterial(commands.params));
                    mesh.name = commands.params.name || "Cylinder";

                    setPosition(mesh, commands.params.position);

                    command = new Commands.AddObjectCommand(mesh, null, addObjectToScene.bind(this));
                    this.lastModifiedObject = mesh;
                } else if (type === "directionallight") {
                    const color = commands.params.color || 0xffffff;
                    const intensity = commands.params.intensity ?? 1;
                    const light = new THREE.DirectionalLight(color, intensity);
                    light.name = commands.params.name || "DirectionalLight";
                    light.shadow.bias = 0;
                    light.shadow.normalBias = 0.1;

                    setPosition(light, commands.params.position);

                    command = new Commands.AddObjectCommand(light, null, addObjectToScene.bind(this));
                    this.lastModifiedObject = light;
                } else if (type === "pointlight") {
                    const color = commands.params.color || 0xffffff;
                    const intensity = commands.params.intensity ?? 1;
                    const distance = commands.params.distance ?? 0;
                    const decay = commands.params.decay ?? 2;
                    const light = new THREE.PointLight(color, intensity, distance, decay);
                    light.name = commands.params.name || "PointLight";
                    light.shadow.bias = 0;
                    light.shadow.normalBias = 0.1;

                    setPosition(light, commands.params.position);

                    command = new Commands.AddObjectCommand(light);
                    this.lastModifiedObject = light;
                } else if (type === "ambientlight") {
                    const color = commands.params.color || 0xffffff;
                    const intensity = commands.params.intensity ?? 1;
                    const light = new THREE.AmbientLight(color, intensity);
                    light.name = commands.params.name || "AmbientLight";

                    command = new Commands.AddObjectCommand(light, null, addObjectToScene.bind(this));
                    this.lastModifiedObject = light;
                } else {
                    console.warn("AGENT: Unsupported object type:", type);
                }

                break;

            case COMMANDS.SET_POSITION:
                const positionObject = getTargetObject(commands.params.object);

                if (positionObject && commands.params.position) {
                    const currentPos = positionObject.position;
                    const newPosition = new THREE.Vector3(
                        commands.params.position.x ?? currentPos.x,
                        commands.params.position.y ?? currentPos.y,
                        commands.params.position.z ?? currentPos.z,
                    );
                    command = new Commands.SetPositionCommand(positionObject, newPosition);
                }

                break;

            case COMMANDS.SET_ROTATION:
                const rotationObject = getTargetObject(commands.params.object);

                if (rotationObject && commands.params.rotation) {
                    const rot = commands.params.rotation;
                    const currentRot = rotationObject.rotation;
                    const newRotation = new THREE.Vector3(
                        rot.x ?? currentRot.x,
                        rot.y ?? currentRot.y,
                        rot.z ?? currentRot.z,
                    );
                    command = new Commands.SetRotationCommand(rotationObject, newRotation);
                }

                break;

            case COMMANDS.SET_SCALE:
                const scaleObject = getTargetObject(commands.params.object);

                if (scaleObject && commands.params.scale) {
                    const scale = commands.params.scale;
                    const newScale = new THREE.Vector3(scale.x || 1, scale.y || 1, scale.z || 1);
                    command = new Commands.SetScaleCommand(scaleObject, newScale);
                }

                break;

            case COMMANDS.SET_MATERIAL_COLOR:
                const colorObject = getTargetObject(commands.params.object);

                if (colorObject && colorObject instanceof THREE.Mesh && colorObject.material && commands.params.color) {
                    let colorValue = commands.params.color;
                    // If color is "random", generate a random color
                    if (colorValue === "random") {
                        colorValue = this.generateRandomColor();
                    }

                    const color = new THREE.Color(colorValue);
                    command = new Commands.SetMaterialColorCommand(colorObject, "color", color.getHex());
                }

                break;

            case COMMANDS.SET_MATERIAL_VALUE:
                const materialObject = getTargetObject(commands.params.object);

                if (
                    materialObject &&
                    materialObject instanceof THREE.Mesh &&
                    materialObject.material &&
                    commands.params.property
                ) {
                    const property = commands.params.property;
                    let value = commands.params.value;

                    // Handle special cases for certain property types
                    if (property.includes("map") && value === null) {
                        // Handle removing textures
                        value = null;
                    } else if (typeof value === "string") {
                        // Convert numeric strings to numbers
                        value = parseFloat(value);
                    }

                    command = new Commands.SetMaterialValueCommand(materialObject, property, value);
                }

                break;

            case COMMANDS.SET_GEOMETRY:
                const detailObject = getTargetObject(commands.params.object);

                if (detailObject && detailObject instanceof THREE.Mesh && detailObject.geometry) {
                    const params = commands.params;
                    let newGeometry;

                    if (detailObject.geometry instanceof THREE.BoxGeometry) {
                        const box = detailObject.geometry;
                        newGeometry = new THREE.BoxGeometry(
                            box.parameters.width ?? 1,
                            box.parameters.height ?? 1,
                            box.parameters.depth ?? 1,
                            params.widthSegments ?? 1,
                            params.heightSegments ?? 1,
                            params.depthSegments ?? 1,
                        );
                    } else if (detailObject.geometry instanceof THREE.SphereGeometry) {
                        const sphere = detailObject.geometry;
                        newGeometry = new THREE.SphereGeometry(
                            sphere.parameters.radius ?? 0.5,
                            params.widthSegments ?? 32,
                            params.heightSegments ?? 16,
                        );
                    } else if (detailObject.geometry instanceof THREE.CylinderGeometry) {
                        const cylinder = detailObject.geometry;
                        newGeometry = new THREE.CylinderGeometry(
                            params.radiusTop ?? cylinder.parameters.radiusTop ?? 0.5,
                            params.radiusBottom ?? cylinder.parameters.radiusBottom ?? 0.5,
                            params.height ?? cylinder.parameters.height ?? 1,
                            params.radialSegments ?? cylinder.parameters.radialSegments ?? 32,
                            params.heightSegments ?? cylinder.parameters.heightSegments ?? 1,
                            params.openEnded ?? cylinder.parameters.openEnded ?? false,
                        );
                    }

                    if (newGeometry) {
                        command = new Commands.SetGeometryCommand(detailObject, newGeometry);
                    }
                }

                break;

            case COMMANDS.REMOVE_OBJECT:
                const removeObject = getTargetObject(commands.params.object);
                const selectedObject = this.engine.editor?.selected;
                if (removeObject) {
                    command = new Commands.RemoveObjectCommand(removeObject, selectedObject);
                    this.lastModifiedObject = null;
                }

                break;

            case COMMANDS.ATTACH_BEHAVIOR:
                const attachObject = getTargetObject(commands.params.object);

                if (attachObject) {
                    command = new Commands.AttachBehaviorCommand(attachObject, commands.params.name, {
                        attributesData: commands.params.data,
                    });
                }

                break;
            case COMMANDS.DETACH_BEHAVIOR:
                const detachObject = getTargetObject(commands.params.object);

                if (detachObject && commands.params.id) {
                    command = new Commands.DetachBehaviorCommand(detachObject, commands.params.id);
                }

                break;
            case COMMANDS.UPDATE_BEHAVIOR:
                const updateObject = getTargetObject(commands.params.object);

                if (updateObject && commands.params.id) {
                    command = new Commands.UpdateBehaviorCommand(
                        updateObject,
                        commands.params.id,
                        commands.params.data,
                    );
                }

                break;
            case COMMANDS.GENERATE_3D_OBJECT:
                if (!commands.params.prompt) {
                    console.warn("AGENT: Missing prompt for generating 3D object.");
                    break;
                }
                command = new Commands.Generate3dObjectCommand(
                    commands.params.prompt,
                    commands.params.negative_prompt,
                    commands.params.position,
                    model => {
                        this.lastModifiedObject = model;
                    },
                );

                break;
            case COMMANDS.ADD_3D_OBJECT:
                if (!commands.params.id || !commands.params.name || !commands.params.provider) {
                    console.warn("AGENT: Missing parameters for adding 3D object.");
                    break;
                }
                command = new Commands.Add3dObjectCommand(
                    commands.params.id,
                    commands.params.name,
                    commands.params.provider,
                    commands.params.downloadUrl,
                    commands.params.position,
                    commands.params.width || 1,
                    commands.params.height || 1,
                    model => {
                        this.lastModifiedObject = model;
                    },
                );
                break;
            case COMMANDS.SET_MATERIAL_TEXTURE:
                const setMaterialObject = getTargetObject(commands.params.object);
                if (setMaterialObject) {
                    command = new Commands.SetMaterialTextureCommand(
                        setMaterialObject,
                        commands.params.id,
                        commands.params.assetType,
                        commands.params.name,
                        commands.params.provider,
                    );
                }
                break;
            // AI contextual commands
            case COMMANDS.GET_SCENE_DATA:
                const sceneData = getSceneData(this.scene);
                aiAgentRequest = {
                    userMessage: "scene data",
                    params: {
                        sceneData: JSON.stringify(sceneData),
                    },
                };

                break;
            case COMMANDS.GET_PLAYER_DATA:
                this.updatePlayerData();
                aiAgentRequest = {
                    userMessage: "player data",
                    params: {
                        playerData: JSON.stringify(getObjectData(this.player, true)),
                    },
                };

                break;
            case COMMANDS.GET_SELECTED_OBJECT_DATA:
                const selected = this.engine.editor?.selected;
                const selectedObjectData = getObjectData(selected);

                aiAgentRequest = {
                    userMessage: "selected object data",
                    params: {
                        selectedObjectData: JSON.stringify(selectedObjectData),
                    },
                };

                break;
            case COMMANDS.GET_OBJECT_DATA:
                const searchedObject = getTargetObject(commands.params.object);
                const objectData = getObjectData(searchedObject || null);

                aiAgentRequest = {
                    userMessage: "object data",
                    params: {
                        objectData: JSON.stringify(objectData),
                    },
                };

                break;
            case COMMANDS.GET_LOOK_AT_POINT:
                const lookAtPoint = this.engine.isPlaying
                    ? this.engine.editor?.getCameraLookAtPoint()
                    : this.engine.editor?.getObjectInsertPoint();

                aiAgentRequest = {
                    userMessage: "look at point",
                    params: {
                        lookAtPointData: JSON.stringify(lookAtPoint),
                    },
                };

                break;
            case COMMANDS.GET_SEARCH_RESULTS:
                let searchResults = null;
                try {
                    searchResults = await this.searchExternalAssets(commands.params.query);
                } catch (error) {
                    console.error("Error fetching search results:", error);
                    throw error;
                }

                aiAgentRequest = {
                    userMessage: "search results",
                    params: {
                        searchResults: JSON.stringify(searchResults),
                    },
                };

                break;
            case COMMANDS.GET_BEHAVIORS_CONFIG:
                const behaviorsConfig = await this.getBehaviorConfigs();

                aiAgentRequest = {
                    userMessage: "behaviors config",
                    params: {
                        behaviorConfig: JSON.stringify(behaviorsConfig),
                    },
                };
                break;
            // End of AI contextual commands
            case COMMANDS.MUTLI_CMDS:
                if (Array.isArray(commands.params.commands)) {
                    for (const cmd of commands.params.commands) {
                        const subCommandResult = await this.executeCommands(cmd, true);
                        if (subCommandResult?.mainCommand && !allCommands.includes(subCommandResult.mainCommand)) {
                            allCommands.push(subCommandResult.mainCommand);
                        }
                        if (subCommandResult?.allCommands) {
                            for (const cmd of subCommandResult.allCommands) {
                                if (!allCommands.includes(cmd)) {
                                    allCommands.push(cmd);
                                }
                            }
                        }
                    }
                }
                break;
            case COMMANDS.COMPLETE:
                newCommands = null;
                aiResponse = null;
                isCompleted = true;
                break;

            default:
                console.warn(
                    "AGENT: Unsupported command type:",
                    commands.type,
                    "- Available commands are: AddObject, SetPosition, SetRotation, SetScale, SetMaterialColor, SetMaterialValue, SetGeometry, RemoveObject, MultiCmds",
                );
                break;
        }
        let commandResult;

        // Check if command requires user confirmation
        if (this.doesCommandRequireConfirmation(commands) && !isMutli) {
            const pendingConfirmation: PendingCommandData = {
                aiCommand: commands,
                command,
                aiAgentRequest: aiAgentRequest,
            };

            try {
                const data = await onPendingConfirmation?.(pendingConfirmation);
                if (data) {
                    aiAgentRequest = data.aiAgentRequest || aiAgentRequest;
                }
            } catch (error) {
                console.error("Error handling pending confirmation:", error);
                return {
                    response: "",
                    mainCommand: null,
                    newCommands: null,
                    allCommands: [],
                };
            }
        }

        if (aiAgentRequest) {
            aiResponse = await this.callAIAgent(aiAgentRequest.userMessage, aiAgentRequest.params);
            if (aiResponse) {
                response = aiResponse.response;
                newCommands = aiResponse.commands;
            }
        }

        if (command) {
            allCommands.push(command);
            commandResult = await this.engine.editor?.execute(command);
        }

        if (!response && !newCommands && !isCompleted && !isMutli) {
            delete commandResult.model; // do not send 3d model back to AI
            aiResponse = await this.callAIAgent(`Commands result: ${JSON.stringify(commandResult)}`, {});
            if (aiResponse) {
                response = aiResponse.response;
                newCommands = aiResponse.commands;
            }
        }

        return {mainCommand: command, newCommands, response, allCommands};
    };

    executeLoopedCommands = async (
        commands: AiCommand,
        onResponseGet?: (res: string) => void,
        onCommandsGet?: (cmd: any[]) => void,
        onPendingConfirmation?: (pendingCommand: PendingCommandData) => Promise<PendingCommandData | undefined>,
    ) => {
        if (this.isAiAgentAborted) {
            this.isAiAgentAborted = false;
            return;
        }

        const {newCommands, response, allCommands} = await this.executeCommands(commands, false, onPendingConfirmation);

        if (this.isAiAgentAborted) return;
        onResponseGet?.(response);
        onCommandsGet?.(allCommands);
        if (newCommands && !this.isAiAgentAborted) {
            await this.executeLoopedCommands(newCommands, onResponseGet, onCommandsGet, onPendingConfirmation);
        }
        this.isAiAgentAborted = false;
    };

    resetAIAgentThread = () => {
        this.threadId = "";
        sessionStorage.removeItem("aiThreadId");
    };

    abortAIAgent = () => {
        this.isAiAgentAborted = true;
        this.abortController?.abort();
    };

    resetSignal = () => {
        this.isAiAgentAborted = false;
    };

    update = () => {};

    public dispose() {
        clearAllIndicators();
        this.abortController?.abort();
        this.engine?.on("sceneLoaded.AiWorldController", null);
    }
}

export default AIWorldController;
