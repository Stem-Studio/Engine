import {useQueryClient} from "@tanstack/react-query";
import {useEffect, useState} from "react";

import {AssetType, CreateAssetOptions} from "@stem/network/api/asset";
import {getAssetResolutionContext, resolveAssetRevisionId} from "@stem/editor-oss/asset-management/AssetResolutionContext";
import {useAssetResolutionContext} from "@stem/editor-oss/context/AssetResolutionContext";
import global from "@stem/editor-oss/global";
import type {LambdaConfig} from "../../../lambdas/Lambda";
import {seedScriptDependencyEntry} from "../../../script-runtime/scriptDependencyCache";
import {buildNameAwareScriptImportContext, getScriptImportDependencyMap} from "../../../script-runtime/scriptImports";
import {
    getAssetRevisionData,
    useAddEditorDependencies,
    useCreateAssetRevisionWithData,
    useCreateAssetWithData,
    useGetAssetRevisionData,
} from "../../asset-management/hooks/assets";
import {updateSceneLambdaRevision} from "../util";

export const useAddLambdaToScene = () => {
    const addEditorDependencies = useAddEditorDependencies();

    return async (lambdaId: string, revisionId: string | null) => {
        if (!revisionId) {
            throw new Error("No revision found for lambda: " + lambdaId);
        }

        await addEditorDependencies.mutateAsync({
            [lambdaId]: revisionId,
        });
    };
};

export const useLambdaData = (lambdaId: string, revisionId?: string) => {
    const queryClient = useQueryClient();
    const {context} = useAssetResolutionContext();
    const [config, setConfig] = useState<LambdaConfig | null>(null);
    const [code, setCode] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<unknown>(null);

    useEffect(() => {
        const actualRevisionId = revisionId || resolveAssetRevisionId(lambdaId, context);

        if (!actualRevisionId) {
            setConfig(null);
            setCode(null);
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        setError(null);

        getAssetRevisionData(queryClient, lambdaId, actualRevisionId, "json")
            .then(data => {
                const parsed = JSON.parse(data.config);
                // Ensure config.id is the human-readable ID, not the asset hex ID
                setConfig({...parsed, id: parsed.id || lambdaId});
                setCode(data.code);
            })
            .catch(err => {
                console.error("Error getting lambda data:", err);
                setConfig(null);
                setCode(null);
                setError(err);
            })
            .finally(() => {
                setIsLoading(false);
            });
    }, [queryClient, lambdaId, revisionId, context, setConfig, setCode, setIsLoading, setError]);

    return {config, code, isLoading, error};
};

export const useGetLambdaRevisionData = () => {
    const getRevisionData = useGetAssetRevisionData();

    return async (lambdaId: string, revisionId: string) => {
        const data = await getRevisionData(lambdaId, revisionId, "json");
        const parsed = JSON.parse(data.config) as LambdaConfig;
        // Ensure config.id is the human-readable ID, not the asset hex ID
        const config: LambdaConfig = {...parsed, id: parsed.id || lambdaId};
        const code = data.code as string;
        return {config, code};
    };
};

export interface UpdateSceneLambdaRevisionOptions {
    /** If provided with config, skips fetching from API */
    code?: string;
    /** If provided with code, skips fetching from API */
    config?: LambdaConfig;
}

/**
 * Hook for re-pinning a lambda's revision in the current scene. Mirrors
 * `useUpdateSceneBehaviorRevision` for the lambda path: fetches the new
 * revision's data when not provided, then calls the plain
 * {@link updateSceneLambdaRevision} helper to refresh registries and the
 * scene's `AssetResolutionContext`.
 *
 * Returns `false` when the requested revision is already pinned and no
 * code/config override was supplied (no-op).
 */
export const useUpdateSceneLambdaRevision = () => {
    const getLambdaRevisionData = useGetLambdaRevisionData();
    const {context} = useAssetResolutionContext();

    return async (
        lambdaId: string,
        revisionId: string,
        options: UpdateSceneLambdaRevisionOptions = {},
    ): Promise<boolean> => {
        const app = global.app;
        if (!app) {
            throw new Error("Cannot update lambda. App not found.");
        }

        const oldRevisionId = resolveAssetRevisionId(lambdaId, context);

        // Skip if already at this revision and no overrides were provided.
        if (oldRevisionId === revisionId && !options.code && !options.config) {
            return false;
        }

        let newCode: string;
        let newConfig: LambdaConfig;

        if (options.code !== undefined && options.config !== undefined) {
            newCode = options.code;
            newConfig = options.config;
        } else {
            const newData = await getLambdaRevisionData(lambdaId, revisionId);
            newCode = newData.code;
            newConfig = newData.config;
        }

        await updateSceneLambdaRevision({
            assetId: lambdaId,
            revisionId,
            code: newCode,
            configStr: JSON.stringify(newConfig),
        });

        return true;
    };
};

type CreateLambdaParams = {
    name: string;
    config: string;
    code: string;
    options?: CreateAssetOptions;
};

export const useCreateLambda = () => {
    const createAssetWithData = useCreateAssetWithData();

    return async ({name, config, code, options}: CreateLambdaParams) => {
        const sceneContext = global.app?.scene ? getAssetResolutionContext(global.app.scene) || undefined : undefined;
        const importContext = await buildNameAwareScriptImportContext(global.app?.editor?.sceneID, sceneContext);
        const dependencies = getScriptImportDependencyMap(code, importContext);
        return createAssetWithData.mutateAsync({
            type: AssetType.Lambda,
            name,
            data: JSON.stringify({config, code}),
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
                ownerType: "lambda",
                dependencies,
            });
            return asset;
        });
    };
};

type CreateLambdaRevisionParams = {
    id: string;
    parentRevisionId: string;
    config: string;
    code: string;
};

export const useCreateLambdaRevision = () => {
    const createAssetRevisionWithData = useCreateAssetRevisionWithData();

    return async ({id, parentRevisionId, config, code}: CreateLambdaRevisionParams) => {
        const sceneContext = global.app?.scene ? getAssetResolutionContext(global.app.scene) || undefined : undefined;
        const importContext = await buildNameAwareScriptImportContext(global.app?.editor?.sceneID, sceneContext);
        const dependencies = getScriptImportDependencyMap(code, importContext);
        const revision = await createAssetRevisionWithData.mutateAsync({
            assetId: id,
            parentRevisionId,
            data: JSON.stringify({config, code}),
            format: "json",
            contentType: "application/json",
            options: {dependencies},
        });
        
        await updateSceneLambdaRevision({
            assetId: id,
            revisionId: revision.id,
            code,
            configStr: config,
        });

        return revision;
    };
};
