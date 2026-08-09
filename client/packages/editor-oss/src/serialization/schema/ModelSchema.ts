import z from 'zod/v3';

import { makeMetadataSchema } from './BaseSchema';
import { Object3DSchema } from './Object3DSchema';

export const ModelSchema = makeMetadataSchema('ModelSerializer')
    .extend(Object3DSchema.shape)
    .extend(z.object({ modelId: z.string() }).shape);

export type SerializedModel = z.infer<typeof ModelSchema>;
