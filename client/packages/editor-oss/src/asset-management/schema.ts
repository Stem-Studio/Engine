import z from 'zod/v3';

import { AssetDerivativeType, AssetType } from '@stem/network/api/asset';

export const AssetSchema = z.object({
  id: z.string(),
  type: z.nativeEnum(AssetType),
  format: z.string(),
  contentType: z.string(),
  name: z.string(),
  description: z.string().optional(),
});

export const AssetRevisionSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  format: z.string().optional(),
  contentType: z.string().optional(),
  contentEncoding: z.string().optional(),
  dataUrl: z.string(),
  dependencies: z.record(z.string(), z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export const AssetDerivativeSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  revisionId: z.string(),
  type: z.nativeEnum(AssetDerivativeType),
  format: z.string(),
  contentType: z.string(),
  contentEncoding: z.string().optional(),
  dataUrl: z.string(),
  metadata: z.record(z.string(), z.any()).optional(),
  lodLevel: z.number().optional(),
});

export const AssetObjectSchema = z.object({
  metadata: z.object({
    generator: z.literal('AssetSerializer'),
  }),
  assets: z.array(AssetSchema).optional().default([]),
  revisions: z.array(AssetRevisionSchema).optional().default([]),
  derivatives: z.array(AssetDerivativeSchema).optional().default([]),
});

export type SerializedAsset = z.infer<typeof AssetSchema>;
export type SerializedAssetRevision = z.infer<typeof AssetRevisionSchema>;
export type SerializedAssetDerivative = z.infer<typeof AssetDerivativeSchema>;
export type SerializedAssetObjectSchema = z.infer<typeof AssetObjectSchema>;
