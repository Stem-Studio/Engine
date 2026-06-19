import {toast} from "toastywave";

import {isPlaygroundMode} from "@web-shared/playgroundMode";
import {getAIBackend} from "../ai";
import {MeshyDirectClient} from "../ai/MeshyDirectClient";
import {RodinDirectClient} from "../ai/RodinDirectClient";
import Ajax from "./Ajax";
import {backendUrlFromPath} from "./UrlUtils";
import global from "../global";

enum Topology {
    BIPED = "bip",
    QUADRUPED = "quad",
}

const bipAnimations = [
    "preset:idle",
    "preset:walk",
    "preset:climb",
    "preset:jump",
    "preset:run",
    "preset:slash",
    "preset:shoot",
    "preset:hurt",
    "preset:fall",
    "preset:turn",
];
const quadAnimations = ["preset:quad_catrun", "preset:quad_catwalk"];

export enum GENERATOR_TYPES {
    MESHY = "meshy",
    TRIPO = "tripo",
    RODIN = "rodin",
    ERTH = "erth",
}

/**
 * Per-provider capability metadata. Drives UI control visibility (auto-rig,
 * refine, model version) and playground availability instead of scattering
 * `generator === ...` checks across the Create flow.
 */
export type ModelGeneratorCapability = {
    /** Human-readable label shown in the provider picker. */
    label: string;
    /** BYOK provider key, or null for providers with no external key (Erth). */
    byokProvider: "meshy" | "tripo" | "rodin" | null;
    supportsTextToModel: boolean;
    supportsImageToModel: boolean;
    supportsRefine: boolean;
    supportsAutoRig: boolean;
    /**
     * Whether the provider can run entirely browser-direct in the public
     * playground (no Go server). Meshy and Rodin expose permissive-enough
     * APIs; Tripo and Erth require the server.
     */
    supportsBrowserDirectPlayground: boolean;
};

export const MODEL_GENERATOR_CAPABILITIES: Record<GENERATOR_TYPES, ModelGeneratorCapability> = {
    [GENERATOR_TYPES.MESHY]: {
        label: "meshy",
        byokProvider: "meshy",
        supportsTextToModel: true,
        supportsImageToModel: true,
        supportsRefine: true,
        supportsAutoRig: true,
        supportsBrowserDirectPlayground: true,
    },
    [GENERATOR_TYPES.TRIPO]: {
        label: "tripo",
        byokProvider: "tripo",
        supportsTextToModel: true,
        supportsImageToModel: true,
        supportsRefine: false,
        supportsAutoRig: true,
        supportsBrowserDirectPlayground: false,
    },
    [GENERATOR_TYPES.RODIN]: {
        label: "Rodin (Hyper3D)",
        byokProvider: "rodin",
        supportsTextToModel: true,
        // Image-to-3D deferred until the Rodin upload contract is confirmed.
        supportsImageToModel: false,
        supportsRefine: false,
        supportsAutoRig: false,
        supportsBrowserDirectPlayground: true,
    },
    [GENERATOR_TYPES.ERTH]: {
        label: "Erth (experimental)",
        byokProvider: null,
        supportsTextToModel: true,
        supportsImageToModel: false,
        supportsRefine: false,
        supportsAutoRig: false,
        supportsBrowserDirectPlayground: false,
    },
};

/** Capability lookup with a safe Meshy fallback for unknown values. */
export function getGeneratorCapability(generator: GENERATOR_TYPES): ModelGeneratorCapability {
    return MODEL_GENERATOR_CAPABILITIES[generator] ?? MODEL_GENERATOR_CAPABILITIES[GENERATOR_TYPES.MESHY];
}

type GenerateModelRequest = {
    type: "text_to_model" | "image_to_model";
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
};

export type StemComposition = {
    primitives: StemPrimitive[];
    metadata: {
        totalPrimitives: number;
        boundingBox: {width: number; height: number; depth: number};
        generatedImage: string;
    };
};

export type StemPrimitive = {
    type: "box" | "sphere" | "cylinder" | "cone" | "plane";
    name: string;
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
    color: string;
    material?: {roughness?: number; metalness?: number};
};

export type TaskResponse = {
    status: string;
    progress: number;
    model?: string; // Optional for Erth
    topology?: string;
    riggable?: boolean;
    id: string;
    thumbnail?: string;
    // Erth-specific fields
    stage?: string;
    message?: string;
    composition?: StemComposition;
    intermediateImage?: string;
    error?: string;
    // Set when rigging was attempted but failed (non-humanoid model)
    riggingFailed?: boolean;
};

class ModelGeneratorProvider {
    authToken?: string;

    constructor(authToken?: string) {
        this.authToken = authToken;
    }

    async uploadImage(image: File) {
        const formData = new FormData();
        formData.append("file", image);
        const res = await getAIBackend().request<any>("/api/AI/ObjectGeneration/Tripo/Upload", {
            method: "POST",
            body: formData,
            headers: {"X-BYOK-Provider": "tripo"},
        });
        return res;
    }

    async generateModel(
        args: GenerateModelRequest,
        signal: AbortSignal,
        onProgress?: (progress: number) => void,
        onTaskCreated?: (task_id: string) => void,
    ) {
        const {
            type,
            prompt,
            negative_prompt,
            url,
            file_token,
            quality,
            model_version,
            generator,
            target_polycount,
            autoRig,
            refine,
        } = args;
        if (!url && !file_token && type === "image_to_model") {
            throw Error("No image provided.");
        }

        let payload;
        let endpoint;

        const currentGenerator = generator || process.env.REACT_APP_DEFAULT_AI_GENERATOR || GENERATOR_TYPES.MESHY;

        switch (currentGenerator) {
            case GENERATOR_TYPES.MESHY:
                payload = {
                    mode: "preview",
                    prompt,
                    negative_prompt: negative_prompt || "",
                    target_polycount: target_polycount ?? 3000,
                    should_remesh: true,
                    model_type: "standard",
                    target_formats: ["glb"],
                };
                endpoint = "/api/AI/ObjectGeneration/Meshy/Generate";
                break;
            case GENERATOR_TYPES.RODIN:
                // Rodin only takes a text prompt in this first pass; quality
                // defaults are applied server-side (the Rodin quality vocabulary
                // differs from Meshy/Tripo, so we don't forward the editor's
                // texture-quality value here).
                payload = {prompt};
                endpoint = "/api/AI/ObjectGeneration/Rodin/Generate";
                break;
            case GENERATOR_TYPES.ERTH:
                payload = {prompt: prompt, style: "low-poly"};
                endpoint = "/api/AI/ObjectGeneration/Erth/Generate";
                break;
            default:
                payload = {
                    type: type,
                    prompt: prompt,
                    negative_prompt: negative_prompt || "",
                    url: url || "",
                    file_token: file_token || "",
                    texture_quality: quality || "standard",
                    auto_size: true,
                    face_limit: 3000,
                    model_version: model_version || "",
                };
                endpoint = "/api/AI/ObjectGeneration/Tripo/Generate";
        }

        // Playground has no Go server: Meshy and Rodin generation go
        // browser-direct against the provider API with the user's BYOK key.
        let resData: {job_id?: string; task_id?: string} | undefined;
        if (isPlaygroundMode() && currentGenerator === GENERATOR_TYPES.MESHY) {
            resData = await MeshyDirectClient.generate(payload as Record<string, unknown>);
        } else if (isPlaygroundMode() && currentGenerator === GENERATOR_TYPES.RODIN) {
            resData = await RodinDirectClient.generate(payload as Record<string, unknown>);
        } else {
            const res = await Ajax.post({
                url: backendUrlFromPath(endpoint),
                msgBodyType: "json",
                data: JSON.stringify(payload),
                token: this.authToken || null,
                signal,
            });
            resData = res?.data;
        }

        if (resData) {
            // If the backend returned a job_id, the asset is being created server-side.
            // Poll the job status endpoint until complete and return the result.
            if (resData.job_id) {
                return await this.pollJobStatus(resData.job_id, signal, onProgress);
            }

            const taskId = resData.task_id;
            if (!taskId) {
                throw Error("Model generation did not return a task id.");
            }
            if (onTaskCreated) onTaskCreated(taskId);

            if (currentGenerator === GENERATOR_TYPES.MESHY) {
                // Determine progress splits based on refine and autoRig options
                // refine=false, autoRig=false: preview (0-100%)
                // refine=false, autoRig=true: preview (0-50%), rig (50-100%)
                // refine=true, autoRig=false: preview (0-50%), refine (50-100%)
                // refine=true, autoRig=true: preview (0-33%), refine (33-66%), rig (66-100%)

                if (refine && autoRig) {
                    // preview (0-33%), refine (33-66%), rig (66-100%)
                    const previewRes = await this.pollTaskStatus(
                        taskId,
                        currentGenerator,
                        p => onProgress && onProgress(p / 3),
                    );
                    const refinedRes = await this.meshyRefineModel(previewRes.id);
                    const refinedModel = await this.pollTaskStatus(
                        refinedRes.task_id,
                        currentGenerator,
                        p => onProgress && onProgress(33 + p / 3),
                    );

                    // Attempt rigging - if it fails (non-humanoid model), proceed with refined model
                    try {
                        const rigTask = await this.meshyRigModel(refinedModel.id);
                        return await this.pollTaskStatus(
                            rigTask.task_id,
                            "meshy_rig",
                            p => onProgress && onProgress(66 + p / 3),
                        );
                    } catch (error) {
                        console.warn(
                            "Rigging failed (model may not be humanoid), proceeding with un-rigged model:",
                            error,
                        );
                        // Return refined model with rigging marked as failed
                        return {
                            ...refinedModel,
                            riggingFailed: true,
                        };
                    }
                } else if (refine && !autoRig) {
                    // preview (0-50%), refine (50-100%)
                    const previewRes = await this.pollTaskStatus(
                        taskId,
                        currentGenerator,
                        p => onProgress && onProgress(p / 2),
                    );
                    const refinedRes = await this.meshyRefineModel(previewRes.id);
                    return await this.pollTaskStatus(
                        refinedRes.task_id,
                        currentGenerator,
                        p => onProgress && onProgress(50 + p / 2),
                    );
                } else if (!refine && autoRig) {
                    // preview (0-50%), rig (50-100%) - skip refinement
                    const previewRes = await this.pollTaskStatus(
                        taskId,
                        currentGenerator,
                        p => onProgress && onProgress(p / 2),
                    );

                    // Attempt rigging - if it fails (non-humanoid model), proceed with preview model
                    try {
                        const rigTask = await this.meshyRigModel(previewRes.id);
                        return await this.pollTaskStatus(
                            rigTask.task_id,
                            "meshy_rig",
                            p => onProgress && onProgress(50 + p / 2),
                        );
                    } catch (error) {
                        console.warn(
                            "Rigging failed (model may not be humanoid), proceeding with un-rigged model:",
                            error,
                        );
                        // Return preview model with rigging marked as failed
                        return {
                            ...previewRes,
                            riggingFailed: true,
                        };
                    }
                } else {
                    // No refine, no autoRig: preview only (0-100%)
                    return await this.pollTaskStatus(taskId, currentGenerator, onProgress);
                }
            } else if (currentGenerator === GENERATOR_TYPES.ERTH) {
                // Erth doesn't need refinement like Meshy
                return await this.pollTaskStatus(taskId, currentGenerator, onProgress);
            } else {
                return await this.pollTaskStatus(taskId, currentGenerator, onProgress);
            }
        } else {
            throw Error("No response from AI.");
        }
    }

    async pollTaskStatus(
        taskId: string,
        generator: string,
        onProgress?: (progress: number) => void,
    ): Promise<TaskResponse> {
        // Rigging operations take longer - use 30 second polling and 10 minute timeout
        const isRiggingTask = generator === "meshy_rig" || generator === "tripo_rig";
        // Meshy and Rodin generations run long; poll slower and allow more time.
        const isSlowGenTask = generator === GENERATOR_TYPES.MESHY || generator === GENERATOR_TYPES.RODIN;
        const pollInterval = isRiggingTask ? 30000 : isSlowGenTask ? 5000 : 3000;
        const maxTimeout = isRiggingTask || isSlowGenTask ? 10 * 60 * 1000 : 5 * 60 * 1000;
        const startTime = Date.now();

        while (true) {
            // Check for timeout
            if (Date.now() - startTime > maxTimeout) {
                throw Error(`Task timed out after ${maxTimeout / 60000} minutes. Please try again.`);
            }

            const taskRes = await this.getTaskStatus(taskId, generator);
            const status = taskRes.status.toLowerCase();
            if (["success", "succeeded", "completed"].includes(status)) {
                global.app?.call("aiModelGenerationResponse", this, taskRes);
                return taskRes;
            } else if (["in_progress", "queued", "running", "in_queue", "pending", "processing"].includes(status)) {
                if (onProgress) {
                    onProgress(taskRes.progress);
                }
                await new Promise(resolve => setTimeout(resolve, pollInterval));
            } else if (["failed", "canceled", "cancelled"].includes(status)) {
                throw Error(taskRes.error || taskRes.message || "Model generation failed.");
            } else {
                throw Error("Model generation failed with unknown status: " + status);
            }
        }
    }

    async getTaskStatus(taskId: string, generator: string) {
        // Playground: poll the provider directly (no Go server to proxy).
        if (isPlaygroundMode()) {
            if (generator === GENERATOR_TYPES.MESHY) {
                return await MeshyDirectClient.fetchTask(taskId);
            }
            if (generator === "meshy_rig") {
                return await MeshyDirectClient.fetchRigTask(taskId);
            }
            if (generator === GENERATOR_TYPES.RODIN) {
                return await RodinDirectClient.fetchTask(taskId);
            }
        }
        const res = await getAIBackend().request<any>(
            `/api/AI/ObjectGeneration/Task?taskId=${encodeURIComponent(taskId)}&generator=${encodeURIComponent(generator)}`,
            {method: "GET"},
        );

        if (!res.ok || !res.data) {
            throw Error(`No response from AI (status ${res.status}).`);
        }
        return res.data;
    }

    async meshyRefineModel(task_id: string) {
        if (isPlaygroundMode()) {
            return await MeshyDirectClient.refine(task_id);
        }
        const res = await getAIBackend().request<any>("/api/AI/ObjectGeneration/Meshy/Refine", {
            method: "POST",
            body: {
                preview_task_id: task_id,
                target_formats: ["glb"],
            },
            headers: {"X-BYOK-Provider": "meshy"},
        });

        if (!res.ok || !res.data) {
            throw Error(`No response from AI (status ${res.status}).`);
        }

        return res.data;
    }

    async pollJobStatus(
        jobId: string,
        signal: AbortSignal,
        onProgress?: (progress: number) => void,
    ): Promise<TaskResponse> {
        const maxTimeout = 15 * 60 * 1000; // 15 minutes
        const startTime = Date.now();

        while (true) {
            if (Date.now() - startTime > maxTimeout) {
                throw Error("Job timed out after 15 minutes.");
            }
            if (signal.aborted) {
                throw Object.assign(new Error("Aborted"), {name: "AbortError"});
            }

            const res = await getAIBackend().request<any>(
                `/api/AI/ObjectGeneration/Job?jobId=${encodeURIComponent(jobId)}`,
                {method: "GET"},
            );

            if (!res.ok || !res.data) {
                throw Error(`No response from job status endpoint (status ${res.status}).`);
            }

            const dto = res.data as {
                jobId: string;
                name: string;
                stage: string;
                progress: number;
                assetId?: string;
                revisionId?: string;
                error?: string;
            };

            if (dto.stage === "complete" && dto.assetId && dto.revisionId) {
                return {
                    status: "succeeded",
                    progress: 100,
                    id: dto.jobId,
                    assetId: dto.assetId,
                    revisionId: dto.revisionId,
                } as TaskResponse & {assetId: string; revisionId: string};
            }

            if (dto.stage === "failed") {
                throw Error(dto.error || "Generation failed.");
            }

            onProgress?.(dto.progress);
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }

    async submitGenerationJob(args: {
        generator: GENERATOR_TYPES;
        sceneId: string;
        name: string;
        prompt: string;
        negative_prompt?: string;
        doRefine?: boolean;
        doRig?: boolean;
        target_polycount?: number;
        type?: string;
        file_token?: string;
        quality?: string;
        model_version?: string;
    }): Promise<{jobId: string}> {
        const {
            generator,
            sceneId,
            name,
            prompt,
            negative_prompt,
            doRefine,
            doRig,
            target_polycount,
            type,
            file_token,
            quality,
            model_version,
        } = args;

        let payload: object;
        let endpoint: string;

        if (generator === GENERATOR_TYPES.MESHY) {
            payload = {
                prompt,
                negative_prompt: negative_prompt || "",
                target_polycount: target_polycount ?? 3000,
                model_type: "lowpoly",
                sceneId,
                name,
                doRefine: doRefine ?? false,
                doRig: doRig ?? false,
            };
            endpoint = "/api/AI/ObjectGeneration/Meshy/Generate";
        } else {
            payload = {
                type: type || "text_to_model",
                prompt,
                file_token: file_token || "",
                texture_quality: quality || "standard",
                auto_size: true,
                face_limit: 3000,
                model_version: model_version || "",
                sceneId,
                name,
            };
            endpoint = "/api/AI/ObjectGeneration/Tripo/Generate";
        }

        const res = await Ajax.post({
            url: backendUrlFromPath(endpoint),
            msgBodyType: "json",
            data: JSON.stringify(payload),
            token: this.authToken || null,
        });

        if (!res?.data?.job_id) {
            throw new Error("Failed to submit generation job");
        }

        global.app?.call("generationJobStarted", null, {jobId: res.data.job_id, sceneId});

        return {jobId: res.data.job_id};
    }

    async meshyRigModel(task_id: string) {
        if (isPlaygroundMode()) {
            return await MeshyDirectClient.rig(task_id);
        }
        const res = await getAIBackend().request<any>("/api/AI/ObjectGeneration/Meshy/Rig", {
            method: "POST",
            body: {input_task_id: task_id},
            headers: {"X-BYOK-Provider": "meshy"},
        });

        if (!res.ok || !res.data) {
            throw Error(`No response from AI (status ${res.status}).`);
        }

        return res.data;
    }

    async animateModel(task_id: string) {
        const res = await getAIBackend().request<{output?: {topology: Topology; riggable: boolean}}>("/api/AI/ObjectGeneration/Tripo/PreRigCheck", {
            method: "POST",
            body: {original_model_task_id: task_id},
            headers: {"X-BYOK-Provider": "tripo"},
        });

        if (!res.ok || !res.data?.output) {
            throw Error(`No response from AI (status ${res.status}).`);
        }

        const {topology, riggable} = res.data.output;
        if (!riggable) {
            throw Error("Model is not riggable.");
        }
        const rigResponse = await getAIBackend().request<{task_id: string}>("/api/AI/ObjectGeneration/Tripo/Rig", {
            method: "POST",
            body: {
                original_model_task_id: task_id,
                topology: topology,
                spec: "mixamo",
            },
            headers: {"X-BYOK-Provider": "tripo"},
        });

        if (!rigResponse.ok || !rigResponse.data) {
            throw Error("Failed to rig model.");
        }

        const retargetResponse = await getAIBackend().request<any>("/api/AI/ObjectGeneration/Tripo/Retarget", {
            method: "POST",
            body: {
                original_model_task_id: rigResponse.data.task_id,
                animation: topology === Topology.BIPED ? bipAnimations[1] : quadAnimations[1],
            },
            headers: {"X-BYOK-Provider": "tripo"},
        });

        if (!retargetResponse.ok || !retargetResponse.data) {
            toast.warning("Failed to retarget animation.");
            return rigResponse.data;
        }

        return retargetResponse.data;
    }
}

export default ModelGeneratorProvider;
