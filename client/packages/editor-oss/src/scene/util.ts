import { Camera } from 'three';

import { AssetLoader } from '@stem/editor-oss/asset-management/AssetLoader';
import { AssetResolutionContext, setAssetResolutionContext } from '@stem/editor-oss/asset-management/AssetResolutionContext';
import { mapAssetIds, resolveBehaviorAttributeAssetRefs, resolveLambdaComponentDataAssetRefs } from '@stem/editor-oss/asset-management/dependencies';
import { SceneLoadProfiler } from '../utils/SceneLoadProfiler';

type SceneConverter = {
    fromJson: (
        data: any,
        options: {
            server: string;
            camera: Camera;
            domWidth: number;
            domHeight: number;
            assetResolutionContext?: AssetResolutionContext;
            assetLoader?: AssetLoader;
        },
    ) => Promise<any>;
};

export type LoadSceneParams = {
    server: string;
    camera: Camera;
    domWidth: number;
    domHeight: number;
    /** Optional AssetLoader for efficient model loading (avoids N+1 API requests) */
    assetLoader?: AssetLoader;
    /** Scene data (metadata and payload) */
    sceneData: {
        /** Raw scene JSON payload fed to the untyped Converter.fromJson. */
        data: any;
        metadata:
            | {
                  Dependencies?: Record<string, string>;
                  LogicalIDToAssetID?: Record<string, string>;
                  [key: string]: unknown;
              }
            | undefined;
    };
    /** Optional shared Converter instance. Direct callers can omit this. */
    converter?: SceneConverter;
};

export const loadScene = async ({
    server,
    camera,
    domWidth,
    domHeight,
    assetLoader,
    converter: suppliedConverter,
    sceneData,
}: LoadSceneParams) => {
    const { data, metadata } = sceneData;

    // Construct an asset resolution context from the scene metadata
    let assetResolutionContext: AssetResolutionContext | undefined = undefined;
    if (metadata?.Dependencies || metadata?.LogicalIDToAssetID) {
        assetResolutionContext = {
            assetIdToRevisionId: metadata.Dependencies,
            logicalIdToAssetId: metadata.LogicalIDToAssetID,
        };
    }

    // Deserialize the scene
    SceneLoadProfiler.begin('converterParse');
    const converter =
        suppliedConverter ??
        new ((await import("../serialization/Converter")).default as unknown as new () => SceneConverter)();
    const result = await converter.fromJson(data, {
        server,
        camera,
        domWidth,
        domHeight,
        assetResolutionContext,
        assetLoader,
    });
    SceneLoadProfiler.end('converterParse');

    if (result.scene && assetResolutionContext) {
        // Remove the asset resolution context from the scene (we use the
        // context from the scene metadata instead).
        if (result.scene.userData?.assetResolutionContext) {
            result.scene.userData.assetResolutionContext = undefined;
        }

        // Map logical asset IDs back to asset IDs only when a logical map exists.
        if (assetResolutionContext.logicalIdToAssetId) {
            SceneLoadProfiler.begin('mapAssetIds');
            mapAssetIds(result.scene, assetResolutionContext, (assetId, context) => {
                // Don't modify an asset ID that has a different context
                // (i.e., in a prefab).
                if (context !== assetResolutionContext) {
                    return assetId;
                }

                // If the asset ID is not in the context, return it
                // as-is.
                const resolvedAssetId = assetResolutionContext.logicalIdToAssetId?.[assetId];
                return resolvedAssetId || assetId;
            });
            SceneLoadProfiler.end('mapAssetIds');
        }

        // Drop the logical ID map since we already mapped all asset IDs.
        const resolvedContext = {
            ...assetResolutionContext,
            logicalIdToAssetId: undefined,
        };

        // Assign the revision context to the scene.
        setAssetResolutionContext(result.scene, resolvedContext);

        // Resolve revision IDs in behavior attribute and lambda component
        // AssetRefs. Without this, cloned scenes retain the source scene's
        // stale revision IDs, causing asset dropdowns to show "none".
        // Prefab children are handled correctly: the recursive traversal
        // switches to the prefab's own context for its children.
        resolveBehaviorAttributeAssetRefs(result.scene, resolvedContext, true);
        resolveLambdaComponentDataAssetRefs(result.scene, resolvedContext, true);
    }

    return result;
};
