/** Parameters for 3D model generation. */
export interface Generate3dModelParams {
    /** Whether to generate from text or an image. */
    generationType: "text_to_model" | "image_to_model";
    /** Text description of the desired model. */
    prompt: string;
    /** Text description of what to avoid in the model. */
    negativePrompt?: string;
    /** Source image URL (required for image_to_model). */
    url?: string;
    /** File token for uploaded source images. */
    fileToken?: string;
    /** Generation quality level. */
    quality?: string;
    /** Model version to use for generation. */
    modelVersion?: string;
    /** Which generation provider to use. */
    generator?: "meshy" | "tripo" | "rodin";
    /** Target polygon count for the generated model. */
    targetPolygonCount?: number;
    /** Whether to automatically rig the model for animation. */
    autoRig?: boolean;
    /** Whether to refine the model after initial generation. */
    refine?: boolean;
    /** Callback invoked with progress percentage (0-100). */
    onProgress?: (progress: number) => void;
    /** Callback invoked when the generation task is created. */
    onTaskCreated?: (taskId: string) => void;
}

/** Result of a 3D model generation request. */
export interface Generate3dModelResult {
    /** The generation task ID for tracking. */
    taskId: string;
    /** URL to download the generated GLB model. */
    modelUrl: string;
    /** URL to a thumbnail image of the model, if available. */
    thumbnailUrl: string | undefined;
}

/**
 * AI generation services for 3D models.
 */
export interface StemAIGen {
    /**
     * Generate a 3D model from text or image input.
     * Polls the generation service until complete.
     *
     * @param params - Generation parameters (prompt, type, quality, etc.)
     * @returns The task ID, model URL, and optional thumbnail URL
     */
    generate3dModel(params: Generate3dModelParams): Promise<Generate3dModelResult>;
}

/**
 * AI subsystem providing access to generative AI services.
 */
export interface StemAI {
    /** 3D model and asset generation. */
    gen: StemAIGen;
}
