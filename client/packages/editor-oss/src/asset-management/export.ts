import {Scene} from "three";

import {AssetRef, assetRefKey} from "./AssetRef";
import {SerializedAssetDerivative, SerializedAssetObjectSchema, SerializedAssetRevision} from "./schema";
import {getAsset, getAssetDerivatives, getAssetRevision} from "@stem/network/api/asset";
import {getPrefabEditRevisionId, getPrefabId} from "../prefab/util";
import {traverseObjectDepthFirst} from "../utils/SceneTraverser";

/**
 * Collects all asset refs needed for export from the scene's resolution
 * context and any unlocked prefab edit revisions.
 * @param scene
 * @param dependencies
 */
export const collectExportAssetRefs = (scene: Scene, dependencies: Record<string, string>): AssetRef[] => {
    const assetRefs: AssetRef[] = Object.entries(dependencies).map(([assetId, revisionId]) => ({
        assetId,
        revisionId,
    }));

    // Include prefab edit revision refs for unlocked prefabs.
    // These reference a different revision than the scene's pinned
    // revision, so they aren't in assetIdToRevisionId.
    traverseObjectDepthFirst(scene, (obj) => {
        const editRevisionId = getPrefabEditRevisionId(obj);
        const prefabId = getPrefabId(obj);
        if (editRevisionId && prefabId) {
            assetRefs.push({ assetId: prefabId, revisionId: editRevisionId });
        }
    });

    return assetRefs;
};

/**
 * Serializes the assets and revisions used in the scene.
 *
 * @remarks
 * This is used when exporting the scene to a JSON file. It includes asset and
 * revision metadata, including a signed URL to download the asset content. This
 * is necessary when switching environments (e.g., staging vs. production).
 *
 * @param dependencies - The asset dependencies used in the scene (must be unique)
 * @returns Serialized asset and revision metadata.
 */
export const exportAssets = async (dependencies: Readonly<AssetRef[]>): Promise<SerializedAssetObjectSchema> => {
    // Find all asset revisions used in the scene
    const revisionMap = new Map<string, SerializedAssetRevision>();
    const derivativeMap = new Map<string, SerializedAssetDerivative>();
    await findAllAssetRevisions(dependencies, revisionMap, derivativeMap);

    const revisions = [...revisionMap.values()];
    const derivatives = [...derivativeMap.values()];
    const assetIds = revisions.map(revision => revision.assetId);

    // Fetch the asset metadata for all used assets
    const assets = await Promise.all(assetIds.map(assetId => getAsset(assetId)));

    // Output the assets, revisions, and derivatives
    return {
        metadata: {
            generator: "AssetSerializer",
        },
        assets: assets.map(asset => ({
            id: asset.id,
            type: asset.type,
            format: asset.format,
            contentType: asset.contentType,
            name: asset.name,
            description: asset.description,
        })),
        revisions,
        derivatives,
    };
};

/**
 * Traverse the asset dependency graph, recording all assets, revisions, and
 * derivatives used by the specified dependencies (e.g., those of the scene).
 *
 * @param dependencies - The "root" dependencies (must be unique)
 * @param allRevisions - On output, all revisions used
 * @param allDerivatives - On output, all derivatives used
 */
const findAllAssetRevisions = async (
    dependencies: Readonly<AssetRef[]>,
    allRevisions: Map<string, SerializedAssetRevision>,
    allDerivatives: Map<string, SerializedAssetDerivative>,
): Promise<void> => {
    let pending = [...dependencies];

    while (pending.length > 0) {
        const newAssetRefsMap = new Map<string, AssetRef>();
        for (const assetRef of pending) {
            const key = assetRefKey(assetRef);
            if (!allRevisions.has(key)) {
                newAssetRefsMap.set(key, assetRef);
            }
        }

        const newAssetRefs = Array.from(newAssetRefsMap.values());
        if (newAssetRefs.length === 0) {
            return;
        }

        const revisionPromises = newAssetRefs.map(({assetId, revisionId}) =>
            getAssetRevision(assetId, revisionId, {
                includeDataUrl: true,
                includeDependencies: true,
                includeMetadata: true,
            }),
        );
        const revisions = await Promise.all(revisionPromises);

        for (const revision of revisions) {
            const key = assetRefKey({assetId: revision.assetId, revisionId: revision.id});
            allRevisions.set(key, {
                id: revision.id,
                assetId: revision.assetId,
                format: revision.format,
                contentType: revision.contentType,
                contentEncoding: revision.contentEncoding,
                dataUrl: revision.dataUrl!,
                dependencies: revision.dependencies || undefined,
                metadata: revision.metadata || undefined,
            });
        }

        const derivativePromises = newAssetRefs.map(({assetId, revisionId}) =>
            getAssetDerivatives(assetId, revisionId, { includeDataUrl: true })
                .catch(() => []), // Return empty array if fetching fails
        );
        const derivativeResults = await Promise.all(derivativePromises);

        for (const derivatives of derivativeResults) {
            for (const derivative of derivatives) {
                allDerivatives.set(derivative.id, {
                    id: derivative.id,
                    assetId: derivative.assetId,
                    revisionId: derivative.revisionId,
                    type: derivative.type,
                    format: derivative.format,
                    contentType: derivative.contentType,
                    contentEncoding: derivative.contentEncoding,
                    dataUrl: derivative.dataUrl!,
                    metadata: derivative.metadata || undefined,
                    lodLevel: derivative.lodLevel,
                });
            }
        }

        const nextDependenciesMap = new Map<string, AssetRef>();
        for (const revision of revisions) {
            for (const [assetId, revisionId] of Object.entries(revision.dependencies || {})) {
                const assetRef = {assetId, revisionId};
                nextDependenciesMap.set(assetRefKey(assetRef), assetRef);
            }
        }
        pending = Array.from(nextDependenciesMap.values());
    }
};
