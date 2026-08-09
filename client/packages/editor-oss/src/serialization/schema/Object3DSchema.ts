import z from 'zod/v3';

import { BehaviorDataSchema } from './BehaviorDataSchema';
import { LambdaComponentDataSchema } from './LambdaComponentDataSchema';

export const Object3DSchema = z.object({
    uuid: z.string().optional(),
    name: z.string().optional().default(''),
    parent: z.string().optional(),
    position: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number(),
    }).optional(),
    quaternion: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number(),
        w: z.number(),
    }).optional(),
    scale: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number(),
    }).optional(),
    visible: z.boolean().optional(),
    castShadow: z.boolean().optional(),
    receiveShadow: z.boolean().optional(),
    userData: z.object({
        behaviors: z.array(BehaviorDataSchema).optional(),
        lambdaComponents: z.array(LambdaComponentDataSchema).optional(),
    }).catchall(z.any()).optional(),
});

export type SerializedObject3D = z.infer<typeof Object3DSchema>;
