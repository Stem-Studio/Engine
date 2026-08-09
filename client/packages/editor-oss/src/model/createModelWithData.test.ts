import {describe, expect, it, vi} from "vitest";

import {ModelFormat} from "@stem/network/api/asset";
import {createModelWithData} from "./createModelWithData";
import type {AssetSource} from "../editor/asset-management/AssetSource";

describe("createModelWithData", () => {
    it("passes ArrayBuffer model data through without wrapping it in a Blob", async () => {
        const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
        const assetSource = {
            createAsset: vi.fn().mockResolvedValue({
                id: "model-asset",
                headRevisionId: "model-rev",
            }),
        } as unknown as AssetSource;

        const asset = await createModelWithData({
            name: "Model",
            blob: buffer,
            format: ModelFormat.Glb,
            contentType: "model/gltf-binary",
            assetSource,
        });

        expect(asset.id).toBe("model-asset");
        expect(assetSource.createAsset).toHaveBeenCalledWith(expect.objectContaining({
            type: "model",
            name: "Model",
            data: buffer,
            format: ModelFormat.Glb,
            contentType: "model/gltf-binary",
        }));
    });
});
