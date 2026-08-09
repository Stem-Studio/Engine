import z from 'zod/v3';

import { BehaviorThrottlePriority } from '@stem/editor-oss/behaviors/performance/interfaces/IThrottleStrategy';
import {BEHAVIOR_DATA_SCHEMA_VERSION} from '@stem/editor-oss/behaviors/BehaviorData';

export const BehaviorThrottleConfigSchema = z.object({
    throttlePriority: z.nativeEnum(BehaviorThrottlePriority),
    enableFrustumCulling: z.boolean(),
    enableDistanceThrottling: z.boolean(),
    requiresConsistentUpdates: z.boolean().default(false),
});

export const BehaviorDataSchema = z.object({
    schemaVersion: z.number().int().positive().default(BEHAVIOR_DATA_SCHEMA_VERSION),
    id: z.string(),
    uuid: z.string(),
    prefabBehaviorUuid: z.string().optional(),
    enabled: z.boolean(),
    priority: z.number(),
    attributesData: z.record(z.string(), z.any()).optional(),
    throttleConfig: BehaviorThrottleConfigSchema.optional(),
});
