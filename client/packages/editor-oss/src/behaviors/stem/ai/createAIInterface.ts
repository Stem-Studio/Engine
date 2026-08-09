import { StemAI, StemAIGen, Generate3dModelParams } from './StemAI';
import { GENERATOR_TYPES } from '@stem/editor-oss/utils/modelGeneratorTypes';
import GameManager from '../../game/GameManager';

const mapGenerator = (generator: string | undefined): GENERATOR_TYPES | undefined => {
    switch (generator) {
        case "meshy":
            return GENERATOR_TYPES.MESHY;
        case "tripo":
            return GENERATOR_TYPES.TRIPO;
        case "rodin":
            return GENERATOR_TYPES.RODIN;
        default:
            return undefined;
    }
};

const createAIGenInterface = (game: GameManager): StemAIGen => {
    return {
        async generate3dModel(params: Generate3dModelParams) {
            const aiController = await game.ensureAiWorldController();
            if (!aiController) {
                throw new Error("AI World Controller not available");
            }

            const result = await aiController.generate3dObject(
                {
                    generationType: params.generationType,
                    prompt: params.prompt,
                    negative_prompt: params.negativePrompt,
                    url: params.url,
                    file_token: params.fileToken,
                    quality: params.quality,
                    model_version: params.modelVersion,
                    generator: mapGenerator(params.generator),
                    target_polycount: params.targetPolygonCount,
                    autoRig: params.autoRig,
                    refine: params.refine,
                },
                params.onProgress,
                params.onTaskCreated,
            );

            if (!result?.model) {
                throw new Error("Failed to generate 3D model");
            }

            return {
                taskId: result.task_id,
                modelUrl: result.model,
                thumbnailUrl: result.rendered_image,
            };
        },
    };
};

export const createAIInterface = (game: GameManager): StemAI => {
    return {
        gen: createAIGenInterface(game),
    };
};
