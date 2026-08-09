import z from 'zod/v3';

import { makeMetadataSchema } from './BaseSchema';
import { Object3DSchema } from './Object3DSchema';

export const PrefabSchema = makeMetadataSchema('PrefabSerializer')
    .extend(Object3DSchema.shape)
    .extend(z.object({ prefabId: z.string() }).shape);

export type SerializedPrefab = z.infer<typeof PrefabSchema>;
