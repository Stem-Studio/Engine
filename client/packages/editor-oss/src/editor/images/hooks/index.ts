import {AssetType} from "@stem/network/api/asset";
import {useCreateAssetWithData} from "../../asset-management/hooks/assets";

export const parseMaterialAssetIdWithRevision = (value: string): {assetId: string} | null => {
    if (!value) return null;

    // Local imports synthesize asset ids as `oss-asset-<timestamp>-<rand>` (optionally
    // with a legacy `:<revisionId>` suffix). The hex/UUID regex below does not
    // match these, so without this branch a material texture backed by an
    // imported local image asset is never resolved and renders blank.
    if (value.startsWith("oss-asset-")) {
        return {assetId: value.split(":")[0] || value};
    }

    const match = value.match(/^([a-f0-9]{24}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (!match) return null;

    return {
        assetId: match[1] || "",
    };
};

type CreateImageParams = {
    name: string;
    file: File;
};

export const useCreateImage = () => {
    const createAssetWithData = useCreateAssetWithData();

    return async ({name, file}: CreateImageParams) => {
        const asset = await createAssetWithData.mutateAsync({
            type: AssetType.Image,
            name,
            data: file,
            format: file.name.split(".").pop()?.toLowerCase() || "",
            contentType: file.type,
        });

        return {
            assetId: asset.id,
            revisionId: asset.headRevisionId,
        };
    };
};
