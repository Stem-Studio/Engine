import z from "zod/v3";

export const LambdaComponentDataSchema = z.object({
    lambdaId: z.string(),
    instanceId: z.string(),
    uuid: z.string(),
    prefabLambdaUuid: z.string().optional(),
    enabled: z.boolean(),
    autoApply: z.boolean().optional(),
    componentData: z.record(z.string(), z.any()).optional(),
});

export const LambdaInstanceDataSchema = z.object({
    lambdaId: z.string(),
    instanceId: z.string(),
    enabled: z.boolean(),
    attributes: z.record(z.string(), z.any()).optional(),
});
