import React, { useMemo, useState } from "react";
import * as THREE from "three";

import { Finalization } from "./Finalization";
import { GenerationStepsList } from "./GenerationStepsList";
import { PromptStep } from "./PromptStep";
import { Result } from "./Result";
import EngineRuntime from "@stem/editor-oss/EngineRuntime";
import { AttachBehaviorCommand, RemoveObjectCommand } from "@stem/editor-oss/command/Commands";
import { useAuthorizationContext } from "@stem/editor-oss/context";
import AIWorldController from "../../../../../controls/AiWorldController/AiWorldController";
import {
    GENERATION_STEPS_FUNCTIONS,
    GenerationStep,
    MODEL_VERSION,
    TEXTURE_QUALITY,
} from "../../../../../controls/AiWorldController/AiWorldController.types";
import { addIndicator, removeIndicator } from "../../../../../controls/AiWorldController/AiWorldController.utils";
import global from "@stem/editor-oss/global";
import { showToast } from "@stem/editor-oss/showToast";
import { StemCompositionBuilder } from "@stem/editor-oss/utils/StemCompositionBuilder";
import { GENERATOR_TYPES } from "@stem/editor-oss/utils/ModelGeneratorProvider";
import { uploadModelFromUrl } from "@stem/editor-oss/model/uploadModelFromUrl";
import { isPlaygroundMode } from "@web-shared/playgroundMode";
import { LoadingWrapper, Menu } from "../ContextMenu.styles";
import loadingIcon from "../icons/loading.png";

export enum AI_BUILDER_STEPS {
    PROMPT = "Prompt",
    SEARCH = "Search",
    GENERATE = "Generate",
    LOADING = "Loading",
    RESULT = "Result",
    FINALIZATION = "Finalization",
}

type Props = {
    isOpen: boolean;
    sceneID?: string;
    onMenuClose: () => void;
    setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
    position: { x: number; y: number };
    objectToReplace?: THREE.Object3D | null;
    replaceObject?: boolean;
    onGenerationStart?: () => void;
};

const ATTACH_BEHAVIORS_STEP = {
    step: "Attach Behaviors",
    function: GENERATION_STEPS_FUNCTIONS.ATTACH_BEHAVIORS,
    description: "AI is attaching behaviors to the model",
    parameters: {
        names: [],
    },
};

export const Create = ({
    isOpen,
    onMenuClose,
    setIsOpen,
    position,
    objectToReplace,
    replaceObject,
    onGenerationStart,
}: Props) => {
    const [prompt, setPrompt] = useState("");
    const [isRequesting, setIsRequesting] = useState(false);
    const [quality, setQuality] = useState(TEXTURE_QUALITY.DETAILED);
    const [modelVersion, setModelVersion] = useState(MODEL_VERSION.V_25);
    const [defaultGenerationSteps, setDefaultGenerationSteps] = useState<GenerationStep[]>([ATTACH_BEHAVIORS_STEP]);
    const [generationSteps, setGenerationSteps] = useState<GenerationStep[]>([]);
    const [loading, setLoading] = useState(false);
    const [generator, setGenerator] = useState<GENERATOR_TYPES>(
        // Playground runs Meshy browser-direct and has no server for Tripo/Erth.
        isPlaygroundMode()
            ? GENERATOR_TYPES.MESHY
            : (process.env.REACT_APP_DEFAULT_AI_GENERATOR as GENERATOR_TYPES) || GENERATOR_TYPES.MESHY,
    );
    const [autoRig, setAutoRig] = useState(false);
    const [refine, setRefine] = useState(true);
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [step, setStep] = useState(AI_BUILDER_STEPS.PROMPT);
    const [foundModels, setFoundModels] = useState<any[]>([]);
    const [followUpMessage, setFollowUpMessage] = useState("");
    const [, setLoadingDescription] = useState("");
    const [modelData, setModelData] = useState<{
        width: number;
        height: number;
    }>({
        width: 1,
        height: 2,
    });

    const { fetchUser } = useAuthorizationContext();

    const app = global.app as EngineRuntime;

    const aiWorldController = useMemo(
        () => AIWorldController.getInstance(app),
        [isOpen],
    );

    const handleClose = () => {
        setIsOpen(false);
        onMenuClose();
        setPrompt("");
        setImageFile(null);
        setGenerationSteps([]);
        setStep(AI_BUILDER_STEPS.PROMPT);
    };

    const getPoint = () => {
        let intersectPoint = new THREE.Vector3();

        if (objectToReplace && replaceObject) {
            const boundingBox = new THREE.Box3().setFromObject(objectToReplace);
            const halfHeight = (boundingBox.max.y - boundingBox.min.y) / 2;
            const point = objectToReplace.position.clone();
            intersectPoint.copy({ x: point.x, y: point.y - halfHeight, z: point.z });
        } else {
            intersectPoint = app.editor!.computeIntersectPoint(position, app.sceneHelpers);
        }

        return intersectPoint;
    };

    const removeObjectToReplace = () => {
        if (objectToReplace && replaceObject) {
            const sceneObj = app.editor?.objectByUuid(objectToReplace.uuid || "");
            if (sceneObj) {
                const removeCommand = new RemoveObjectCommand(sceneObj);
                app.editor?.execute(removeCommand);
            }
        }
    };

    const handleModelsSearch = async () => {
        aiWorldController.resetSignal();
        setGenerationSteps([]);
        try {
            setLoading(true);
            const aiRes = await aiWorldController.generateSearchTags(prompt);
            let nameArray: any = [];
            let tagsArray: any = [];

            if (!aiRes) return;
            setModelData({ width: aiRes.width, height: aiRes.height });
            setFollowUpMessage(aiRes.followUpMessage);
            const res = await aiWorldController.searchModels(aiRes.tags);
            if (res && (res.NameResults || res.TagResults)) {
                if (res.NameResults && res.NameResults.length > 0) {
                    nameArray = res.NameResults;
                }
                if (res.TagResults && res.TagResults.length > 0) {
                    tagsArray = res.TagResults;
                }
                const fiteredNameArray = nameArray.filter(
                    (obj: any) => !tagsArray.some((tag: any) => tag.ID === obj.ID),
                );

                setFoundModels([...tagsArray, ...fiteredNameArray]);
                setStep(AI_BUILDER_STEPS.SEARCH);
            } else {
                await generateSteps();
            }
        } catch {
            await generateSteps();
        } finally {
            setLoading(false);
        }
    };

    const generateSteps = async () => {
        if (generationSteps.length > 0) {
            setStep(AI_BUILDER_STEPS.GENERATE);
            return;
        }
        setLoading(true);
        try {
            const aiRes = await aiWorldController.generateSteps(prompt);
            if (!aiRes) throw new Error("Failed to generate steps");
            setGenerationSteps(aiRes);
            setStep(AI_BUILDER_STEPS.GENERATE);
        } catch (error) {
            console.error(error);
            showToast({ type: "error", title: "Failed to create generation steps" });
            handleClose();
        } finally {
            fetchUser();
            setLoading(false);
        }
    };

    const generateAndUploadModel = async (prompt: string, uuid: string, name: string, _tags: string[] = []) => {
        let url = "";
        let imageToken = "";
        let displayedProgress = 0;

        // Upload image first if present
        if (imageFile) {
            const uploadRes = await aiWorldController.uploadImageFor3dObjectGeneration(imageFile);
            imageToken = uploadRes.image_token;
        }

        // This OSS build has no server-side generation jobs (see
        // handle_jobs_oss.go), so every provider — desktop and playground —
        // runs the synchronous polling flow below and imports the resulting
        // GLB URL directly. The provider task endpoints return a `task_id`.
        const res = await aiWorldController.generate3dObject(
            {
                generationType: imageFile ? "image_to_model" : "text_to_model",
                prompt,
                negative_prompt: "",
                url,
                file_token: imageToken,
                quality,
                model_version: modelVersion,
                generator,
                autoRig,
                refine,
            },
            progress => {
                if (progress > 90) {
                    displayedProgress++;
                    if (displayedProgress > progress) {
                        displayedProgress = progress;
                    }
                } else {
                    displayedProgress = progress;
                }
                app.call("updateIndicator", null, { progress: displayedProgress, uuid });
            },
            () => {
                fetchUser().catch(console.error);
                setIsRequesting(false);
            },
        );

        if (!res?.model) {
            throw new Error("Failed to generate model");
        }

        await new Promise(resolve => setTimeout(resolve, 1000)); // sometimes tripo requires delay
        app.call("updateIndicator", null, { progress: 100, uuid });

        // Handle Erth composition differently - build from primitives instead of uploading URL
        if (generator === GENERATOR_TYPES.ERTH && res.composition) {
            console.log("[Create] Erth composition received:", res.composition);
            const group = StemCompositionBuilder.buildFromComposition(res.composition);
            console.log("[Create] Erth group built:", group, "children:", group.children.length);
            return {
                object: group,
                isErthComposition: true,
                thumbnail: res.intermediateImage || res.rendered_image,
                name: name || "Erth Generated",
            };
        }

        // The polling flow produced a GLB URL. Import it and hand back a
        // ready-to-place object. uploadModelFromUrl fetches the provider CDN
        // directly in this OSS build (no asset-download proxy ships here).
        if (res.model) {
            const uploaded = await uploadModelFromUrl({
                url: res.model,
                name: name || prompt || "Generated Model",
            });
            return {object: uploaded.object, name: name || "Generated Model"};
        }

        throw new Error(`Unexpected generator response: no composition returned`);
    };

    const handleAcceptSelectedModel = async (selectedModel: any) => {
        const intersectPoint = getPoint();

        const steps = [...defaultGenerationSteps];
        const attachBehaviorStep = steps.find(s => s.function === String(GENERATION_STEPS_FUNCTIONS.ATTACH_BEHAVIORS));

        let width = modelData.width;
        let height = modelData.height;
        let model: THREE.Object3D | undefined = undefined;

        try {
            setIsRequesting(true);

            if (selectedModel) {
                model = await aiWorldController.addModelToSceneFromServer(selectedModel, selectedModel.Name);

                if (model) {
                    aiWorldController.addObjectToScene(model, false, width, height, intersectPoint);
                }
            }

            if (attachBehaviorStep && attachBehaviorStep.parameters.names.length > 0 && model) {
                const names = attachBehaviorStep.parameters.names;

                for (const name of names) {
                    const command = new AttachBehaviorCommand(model, name);
                    command.execute();
                }

                app.call("objectChanged", null, model);
            }

            setStep(AI_BUILDER_STEPS.FINALIZATION);
            setPrompt("");
            setDefaultGenerationSteps([ATTACH_BEHAVIORS_STEP]);
        } catch (error) {
            console.error(error);
            showToast({ type: "error", title: "Failed to add object" });
            handleClose();
        } finally {
            fetchUser();
            setIsRequesting(false);
        }
    };

    const handleGenerateBasedOnSteps = async () => {
        const uuid = THREE.MathUtils.generateUUID();
        const objPosition = objectToReplace && replaceObject ? objectToReplace.position : undefined;
        const { indicator, intersectPoint } = addIndicator(uuid, position, objPosition);

        const steps = [...generationSteps];
        const enhanceStep = steps.find(s => s.function === String(GENERATION_STEPS_FUNCTIONS.ENCHANCE_PROMPT));
        const generateStep = steps.find(s => s.function === String(GENERATION_STEPS_FUNCTIONS.GENERATE_MODEL));
        const attachBehaviorStep = steps.find(s => s.function === String(GENERATION_STEPS_FUNCTIONS.ATTACH_BEHAVIORS));
        const modifyStep = steps.find(s => s.function === String(GENERATION_STEPS_FUNCTIONS.MODIFY_MODEL));

        let modelName = "";
        let width = 1;
        let height = 2;
        let currentPrompt = prompt;
        let tags: string[] = [];

        try {
            setIsRequesting(true);
            setStep(AI_BUILDER_STEPS.LOADING);
            onGenerationStart?.();

            if (enhanceStep && enhanceStep.parameters.prompt) {
                setLoadingDescription(enhanceStep.description);
                const adjectives = enhanceStep.parameters.adjectives;
                currentPrompt = enhanceStep.parameters.prompt;

                const aiRes = await aiWorldController.enchancePrompt(currentPrompt + " " + adjectives, true);
                if (!aiRes) throw new Error("Failed to enchance prompt");
                const { name, width: aiWidth, height: aiHeight, prompt: aiPrompt, tags: aiTags } = aiRes;
                modelName = name;
                width = aiWidth;
                height = aiHeight;
                currentPrompt = aiPrompt;
                tags = aiTags;
            }

            // Generate model if there's a generate step OR if using ERTH builder (doesn't require AI steps)
            if (generateStep || generator === GENERATOR_TYPES.ERTH) {
                setLoadingDescription(generateStep?.description || "Generating model...");
                const objData = await generateAndUploadModel(currentPrompt, uuid, modelName, tags);

                // Add the generated object to the scene. Both the Erth
                // composition and the playground browser-direct Meshy import
                // hand back a ready Object3D.
                let model: THREE.Object3D | undefined = undefined;
                const isErthComposition = objData && "isErthComposition" in objData && objData.isErthComposition;

                if (objData && "object" in objData && objData.object) {
                    model = objData.object;
                    removeObjectToReplace();
                    aiWorldController.addObjectToScene(model, false, width, height, intersectPoint);
                    setModelData({ width, height });
                }

                if (attachBehaviorStep && model) {
                    setLoadingDescription(attachBehaviorStep.description);
                    const names = attachBehaviorStep.parameters?.names;

                    if (names && Array.isArray(names)) {
                        for (const name of names) {
                            
                            const command = new AttachBehaviorCommand(model, name);
                            command.execute();
                        }
                    }

                    app.call("objectChanged", null, model);
                }

                if (modifyStep && modifyStep.parameters.prompt) {
                    setLoadingDescription(modifyStep.description);
                    const res = await aiWorldController.generateCommands(modifyStep.parameters.prompt);
                    if (app.editor?.scene && res) {
                        await aiWorldController.executeCommands(res.commands);
                    }

                    app.call("objectChanged", null, model);
                }

                // Show appropriate success message and close dialog
                if (isErthComposition) {
                    showToast({ type: "success", title: "Model successfully constructed using Three.js primitives." });
                } else if (objData) {
                    showToast({ type: "success", title: "Model generated successfully." });
                }
            }

            // Close dialog after successful generation
            handleClose();
        } catch (error) {
            console.error(error);
            showToast({ type: "error", title: "Failed to generate object" });
            handleClose();
        } finally {
            fetchUser();
            setIsRequesting(false);
            removeIndicator(indicator);
            setLoadingDescription("");
        }
    };

    const handleParamChange = (genStep: string, paramName: string, value: any) => {
        const steps = step === AI_BUILDER_STEPS.GENERATE ? generationSteps : defaultGenerationSteps;
        const newSteps = steps.map(s => {
            if (s.step === genStep) {
                return {
                    ...s,
                    parameters: {
                        ...s.parameters,
                        [paramName]: value,
                    },
                };
            }
            return s;
        });
        if (step === AI_BUILDER_STEPS.GENERATE) {
            setGenerationSteps(newSteps);
        } else {
            setDefaultGenerationSteps(newSteps);
        }
    };

    const handleAcceptResult = () => {
        setStep(AI_BUILDER_STEPS.FINALIZATION);
    };

    const handleFinished = () => {
        handleClose();
    };

    if (!isOpen) return null;

    // Hide dialog during generation - component stays mounted so async operations continue
    // Progress is shown via the in-scene indicator
    if (step === AI_BUILDER_STEPS.LOADING) {
        return <div style={{ display: "none" }} />;
    }

    return (
        <Menu>
            {loading ? 
                <LoadingWrapper>
                    <img src={loadingIcon}
                        alt="loading"
                    />
                </LoadingWrapper>
             : 
                <>
                    {step === AI_BUILDER_STEPS.PROMPT &&
                        <PromptStep
                            isOpen
                            prompt={prompt}
                            setPrompt={setPrompt}
                            isRequesting={isRequesting}
                            loading={loading}
                            modelVersion={modelVersion}
                            setModelVersion={setModelVersion}
                            quality={quality}
                            setQuality={setQuality}
                            handleSubmit={handleModelsSearch}
                            generator={generator}
                            setGenerator={setGenerator}
                            autoRig={autoRig}
                            setAutoRig={setAutoRig}
                            refine={refine}
                            setRefine={setRefine}
                            imageFile={imageFile}
                            setImageFile={setImageFile}
                        />
                    }
                    {(step === AI_BUILDER_STEPS.GENERATE || step === AI_BUILDER_STEPS.SEARCH) && 
                        <GenerationStepsList
                            generationSteps={
                                step === AI_BUILDER_STEPS.GENERATE ? generationSteps : defaultGenerationSteps
                            }
                            handleParamChange={handleParamChange}
                            handleEnhanceSelect={generateSteps}
                            handleAccept={handleAcceptSelectedModel}
                            handleGenerate={handleGenerateBasedOnSteps}
                            foundModels={foundModels}
                            behaviorConfigs={app.editor?.behaviorConfigRegistry.getAllConfigs() || []}
                            setStep={setStep}
                            step={step}
                        />
                    }
                    {step === AI_BUILDER_STEPS.RESULT &&
                        <Result
                            handleParamChange={handleParamChange}
                            onAccept={handleAcceptResult}
                            generationSteps={generationSteps}
                            onRemix={handleGenerateBasedOnSteps}
                        />
                    }

                    {step === AI_BUILDER_STEPS.FINALIZATION && 
                        <Finalization
                            followUpMessage={followUpMessage}
                            handleFinished={handleFinished}
                            prompt={prompt}
                            setPrompt={setPrompt}
                            handleCreate={handleModelsSearch}
                        />
                    }
                </>
            }
        </Menu>
    );
};
