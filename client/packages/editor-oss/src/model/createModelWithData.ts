import {
    AssetDerivativeType,
    AssetType,
    createAssetDerivativeWithData,
    createAssetWithData,
    ModelFormat,
} from "@stem/network/api/asset";
import type {AssetSource} from "../editor/asset-management/AssetSource";

export type ModelLod = {
    file: File;
    level: number;
    polygonCount: number;
    vertexCount: number;
    compression?: {
        vertexRetention: number;
        textureScale: number;
        method: string;
    };
};

export type Thumbnail = {
    file: File;
    width: number;
    height: number;
};

export type CreateModelParams = {
    name: string;
    blob: Blob | ArrayBuffer;
    format: ModelFormat;
    contentType: string;
    lods?: ModelLod[];
    thumbnail?: Thumbnail;
    assetSource?: AssetSource;
    ERTHLibrary?: boolean;
    metadata?: Record<string, unknown>;
};

/**
 * Standalone function to create a model with LODs and thumbnail.
 * This can be used both from React components (via useCreateModel hook) and from non-React code.
 * @param params
 */
export const createModelWithData = async (params: CreateModelParams) => {
    const {name, blob, format, contentType, lods, thumbnail, assetSource, metadata} = params;

    // Create the primary asset (gzip-compressed for presigned URL uploads)
    const asset = assetSource
        ? await assetSource.createAsset({
              type: AssetType.Model,
              name,
              data: blob,
              format,
              contentType,
              contentEncoding: "gzip",
              options: {
                  metadata,
              },
          })
        : await createAssetWithData({
              type: AssetType.Model,
              name,
              data: blob,
              format,
              contentType,
              contentEncoding: "gzip",
              options: {
                  metadata,
              },
          });

    // Create LOD derivatives (gzip-compressed)
    if (lods && lods.length > 0) {
        const lodPromises = lods.map(async lod => {
            const extension = lod.file.name.split(".").pop()?.toLowerCase() || "";
            return createAssetDerivativeWithData({
                assetId: asset.id,
                revisionId: asset.headRevisionId,
                type: AssetDerivativeType.Model,
                format: extension,
                contentType: lod.file.type,
                data: lod.file,
                lodLevel: lod.level,
                contentEncoding: "gzip",
                metadata: {
                    polygonCount: lod.polygonCount,
                    vertexCount: lod.vertexCount,
                    compression: lod.compression,
                },
            });
        });
        try {
            await Promise.all(lodPromises);
        } catch (error) {
            console.error("Failed to create LOD derivatives:", error);
        }
    }

    // Create thumbnail derivative
    if (thumbnail) {
        const extension = thumbnail.file.name.split(".").pop()?.toLowerCase() || "";
        try {
            await createAssetDerivativeWithData({
                assetId: asset.id,
                revisionId: asset.headRevisionId,
                type: AssetDerivativeType.Thumbnail,
                format: extension,
                contentType: thumbnail.file.type,
                data: thumbnail.file,
                metadata: {
                    width: thumbnail.width,
                    height: thumbnail.height,
                },
            });
        } catch (error) {
            console.error("Failed to create LOD derivatives:", error);
        }
    }

    return asset;
};
