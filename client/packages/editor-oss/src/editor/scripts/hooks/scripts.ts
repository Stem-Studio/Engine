import {useQueryClient} from "@tanstack/react-query";
import {useEffect, useState} from "react";

import {AssetType, CreateAssetOptions} from "@stem/network/api/asset";
import {resolveAssetRevisionId} from "@stem/editor-oss/asset-management/AssetResolutionContext";
import {useAssetResolutionContext} from "@stem/editor-oss/context/AssetResolutionContext";
import global from "@stem/editor-oss/global";
import {seedScriptDependencyEntry} from "../../../script-runtime/scriptDependencyCache";
import {buildNameAwareScriptImportContext, getScriptImportDependencyMap} from "../../../script-runtime/scriptImportCore";
import {
    getAssetRevisionData,
    useCreateAssetRevisionWithData,
    useCreateAssetWithData,
    useGetAssetRevisionData,
} from "../../asset-management/hooks/assets";

export interface ScriptData {
    code: string;
}

export const useScriptData = (assetId: string, revisionId?: string) => {
    const queryClient = useQueryClient();
    const {context} = useAssetResolutionContext();
    const [code, setCode] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<unknown>(null);

    useEffect(() => {
        const resolvedRevisionId = revisionId || resolveAssetRevisionId(assetId, context);
        if (!resolvedRevisionId) {
            setCode(null);
            setIsLoading(false);
            return;
        }

        let isCancelled = false;
        setIsLoading(true);
        setError(null);

        getAssetRevisionData(queryClient, assetId, resolvedRevisionId, "json")
            .then((data) => {
                if (isCancelled) return;
                setCode(data.code);
            })
            .catch((err) => {
                if (isCancelled) return;
                setCode(null);
                setError(err);
            })
            .finally(() => {
                if (!isCancelled) {
                    setIsLoading(false);
                }
            });

        return () => {
            isCancelled = true;
        };
    }, [assetId, revisionId, context, queryClient]);

    return {code, isLoading, error};
};

export const useGetScriptRevisionData = () => {
    const getRevisionData = useGetAssetRevisionData();

    return async (assetId: string, revisionId: string): Promise<ScriptData> => {
        const data = await getRevisionData(assetId, revisionId, "json");
        return {code: data.code as string};
    };
};

type CreateScriptParams = {
    name: string;
    code: string;
    sceneId?: string;
    options?: CreateAssetOptions;
};

export const useCreateScript = () => {
    const createAssetWithData = useCreateAssetWithData();

    return async ({sceneId: _sceneId, name, code, options}: CreateScriptParams) => {
        const sceneContext = global.app?.scene?.userData?.assetResolutionContext;
        const importContext = await buildNameAwareScriptImportContext(global.app?.editor?.sceneID, sceneContext);
        const dependencies = getScriptImportDependencyMap(code, importContext);
        return createAssetWithData.mutateAsync({
            type: AssetType.Script,
            name,
            data: JSON.stringify({code}),
            format: "json",
            contentType: "application/json",
            options: {
                ...options,
                dependencies: {
                    ...options?.dependencies,
                    ...dependencies,
                },
            },
        }).then((asset) => {
            seedScriptDependencyEntry({
                assetId: asset.id,
                revisionId: asset.headRevisionId,
                ownerType: "import",
                dependencies,
            });
            return asset;
        });
    };
};

type CreateScriptRevisionParams = {
    id: string;
    parentRevisionId: string;
    code: string;
};

export const useCreateScriptRevision = () => {
    const createAssetRevisionWithData = useCreateAssetRevisionWithData();

    return async ({id, parentRevisionId, code}: CreateScriptRevisionParams) => {
        const sceneContext = global.app?.scene?.userData?.assetResolutionContext;
        const importContext = await buildNameAwareScriptImportContext(global.app?.editor?.sceneID, sceneContext);
        const dependencies = getScriptImportDependencyMap(code, importContext);
        return createAssetRevisionWithData.mutateAsync({
            assetId: id,
            parentRevisionId,
            data: JSON.stringify({code}),
            format: "json",
            contentType: "application/json",
            options: {dependencies},
        }).then((revision) => {
            seedScriptDependencyEntry({
                assetId: id,
                revisionId: revision.id,
                ownerType: "import",
                dependencies,
            });
            return revision;
        });
    };
};
