import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { legacyAddBehaviorToScene } from '@stem/network/api/behavior';
import { resolveAssetRevisionId } from '@stem/editor-oss/asset-management/AssetResolutionContext';
import { isLegacyBehaviorId } from '../../../behaviors/util';
import { useAssetResolutionContext } from '@stem/editor-oss/context/AssetResolutionContext';
import global from '@stem/editor-oss/global';
import { getAssetRevisionData, useAddEditorDependencies, useGetAssetRevisionData } from '../../asset-management/hooks/assets';
import { BehaviorConfig } from '../BehaviorConfig';
import { updateSceneBehaviorRevision } from '../util';

export const useAddBehaviorToScene = () => {
    const addEditorDependencies = useAddEditorDependencies();

    const addNewBehaviorToScene = async (behaviorId: string, revisionId: string | null) => {
        if (!revisionId) {
            throw new Error("No revision found for behavior: " + behaviorId);
        }

        await addEditorDependencies.mutateAsync({
            [behaviorId]: revisionId,
        });
    };

    return async (behaviorId: string, revisionId: string | null, sceneId: string) => {
        if (isLegacyBehaviorId(behaviorId)) {
            await legacyAddBehaviorToScene(behaviorId, sceneId);
        } else {
            await addNewBehaviorToScene(behaviorId, revisionId);
        }
    };
};

type UseBehaviorDataOptions = {
    enabled?: boolean;
    revisionId?: string;
};

export const useBehaviorData = (behaviorId: string, options: UseBehaviorDataOptions = {}) => {
    const queryClient = useQueryClient();
    const { context } = useAssetResolutionContext();
    const [config, setConfig] = useState<BehaviorConfig | null>(null);
    const [code, setCode] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<unknown>(null);

    const resolvedRevisionId = options.revisionId || resolveAssetRevisionId(behaviorId, context);

    useEffect(() => {
        const enabled = options.enabled ?? true;
        if (!enabled) {
            return;
        }

        if (isLegacyBehaviorId(behaviorId)) {
            setConfig(global.app?.editor?.behaviorConfigRegistry.getConfig(behaviorId) || null);
            setCode(global.app?.editor?.behaviorScriptRegistry.getScript(behaviorId) || null);
            setIsLoading(false);
            return;
        }

        if (!resolvedRevisionId) {
            setConfig(null);
            setCode(null);
            setIsLoading(false);
            return;
        }

        // Track if this effect has been cancelled (user switched behaviors)
        let isCancelled = false;

        setIsLoading(true);
        setError(null);

        getAssetRevisionData(queryClient, behaviorId, resolvedRevisionId, "json")
            .then(data => {
                // Don't update state if user has switched to a different behavior
                if (isCancelled) return;

                const config = JSON.parse(data.config) as BehaviorConfig;
                setConfig({
                    ...config,
                    id: behaviorId, // for backwards compatibility
                });
                setCode(data.code);
            })
            .catch((error) => {
                // Don't update state if user has switched to a different behavior
                if (isCancelled) return;

                console.error("Error getting behavior data:", error);
                setConfig(null);
                setCode(null);
                setError(error);
            })
            .finally(() => {
                if (!isCancelled) {
                    setIsLoading(false);
                }
            });

        // Cleanup: mark as cancelled when effect re-runs or unmounts
        return () => {
            isCancelled = true;
        };
    }, [
        queryClient,
        behaviorId,
        options.enabled,
        resolvedRevisionId,
        setConfig,
        setCode,
        setIsLoading,
        setError,
    ]);

    return {
        config,
        code,
        isLoading,
        error,
    };
};

export const useGetBehaviorRevisionData = () => {
    const getAssetRevisionData = useGetAssetRevisionData();

    return async (behaviorId: string, revisionId: string) => {
        const data = await getAssetRevisionData(behaviorId, revisionId, "json");
        const config = JSON.parse(data.config) as BehaviorConfig;
        const code = data.code as string;
        return {
            config: {
                ...config,
                id: behaviorId, // for backwards compatibility
            },
            code,
        };
    };
};


export interface UpdateSceneBehaviorRevisionOptions {
    /** If provided with config, skips fetching from API */
    code?: string;
    /** If provided with code, skips fetching from API */
    config?: BehaviorConfig;
}

export const useUpdateSceneBehaviorRevision = () => {
    const getBehaviorRevisionData = useGetBehaviorRevisionData();
    const { context } = useAssetResolutionContext();

    return async (
        behaviorId: string,
        revisionId: string,
        options: UpdateSceneBehaviorRevisionOptions = {},
    ): Promise<boolean> => {
        const app = global.app;
        if (!app) {
            throw new Error("Cannot update behavior. App not found.");
        }

        const oldRevisionId = resolveAssetRevisionId(behaviorId, context);

        // Skip if already at this revision (unless code/config provided for registry update)
        if (oldRevisionId === revisionId && !options.code && !options.config) {
            return false;
        }

        let newCode: string;
        let newConfig: BehaviorConfig;

        // Use provided code/config or fetch from API
        if (options.code !== undefined && options.config !== undefined) {
            newCode = options.code;
            newConfig = options.config;
        } else {
            if (!oldRevisionId) {
                throw new Error("Cannot update behavior. Old revision not found.");
            }

            const newData = await getBehaviorRevisionData(behaviorId, revisionId);
            newConfig = newData.config;
            newCode = newData.code;
        }

        await updateSceneBehaviorRevision({
            assetId: behaviorId,
            revisionId,
            code: newCode,
            config: newConfig,
        });

        return true;
    };
};
