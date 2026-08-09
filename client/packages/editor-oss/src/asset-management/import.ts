import { keyBy } from 'lodash';

import { AssetRef, assetRefKey, isAssetRef } from './AssetRef';
import { IMPORT_TUNING } from './importTuning';
import { AssetObjectSchema, SerializedAssetDerivative } from './schema';
import { Asset, batchImportAssets, createAsset, createAssetDerivative, createAssetRevision, getAsset, getAssetRevision, isNoChangesError } from '@stem/network/api/asset';
import { DomainAssetType } from '@stem/network/api/client/api';
import BehaviorData from '../behaviors/BehaviorData';
import { LambdaComponentData } from '../lambdas/Lambda';
import { withRetry } from '../utils/retry';

// Progress is divided into 4 equal sub-steps (25% each):
// 1. Batch import assets (0.00 - 0.25)
// 2. Create assets (0.25 - 0.50)
// 3. Batch import derivatives (0.50 - 0.75)
// 4. Create derivatives (0.75 - 1.00)
const SUB_STEP_WEIGHT = 0.25;

const isBuiltInLambdaId = (id: string) => !/^[a-fA-F0-9]{24}$/.test(id);

/** Import item type for tracking revision data during import */
export interface ImportItem {
    assetId: string;
    revisionId: string;
    assetRefKey: string;
    type: DomainAssetType;
    format: string;
    contentType: string;
    contentEncoding: string | undefined;
    name: string;
    description: string | undefined;
    dataUrl: string;
    dependencies: Record<string, string> | undefined;
    metadata: Record<string, unknown> | undefined;
}

/** Result type for parallel asset creation */
interface AssetCreationResult {
    index: number;
    oldAssetId: string;
    newAssetId: string | null;
    oldRevisionKey: string;
    newRevisionId: string;
    newAsset: Asset | null;
}

export interface ImportAssetsProgress {
    /** Progress from 0 to 1 */
    progress: number;
    /** Description of current activity */
    currentStep: string;
}

export type ImportAssetsProgressCallback = (progress: ImportAssetsProgress) => void;

/** Serialized asset from parseAssetData */
export interface SerializedAsset {
    id: string;
    type: DomainAssetType;
    format: string;
    contentType: string;
    name: string;
    description?: string;
}

/** Serialized revision from parseAssetData */
export interface SerializedRevision {
    id: string;
    assetId: string;
    format?: string;
    contentType?: string;
    contentEncoding?: string;
    dataUrl: string;
    dependencies?: Record<string, string>;
    metadata?: Record<string, unknown>;
}

/**
 * Builds import items from assets and revisions.
 *
 * Joins each revision with its corresponding asset to create a unified
 * import item. Revisions referencing missing assets are skipped with a warning.
 *
 * @param assets - The serialized assets from the export
 * @param revisions - The serialized revisions from the export
 * @returns Array of import items ready for processing
 * @internal Exported for testing
 */
export const buildImportItems = (
    assets: SerializedAsset[],
    revisions: SerializedRevision[],
): ImportItem[] => {
    const assetsById = keyBy(assets, 'id');
    const importItems: ImportItem[] = [];

    for (const revision of revisions) {
        const asset = assetsById[revision.assetId];
        if (!asset) {
            console.warn("Revision references a missing asset:", revision);
            continue;
        }

        importItems.push({
            assetId: asset.id,
            revisionId: revision.id,
            assetRefKey: assetRefKey({ assetId: asset.id, revisionId: revision.id }),
            type: asset.type,
            format: revision.format || asset.format,
            contentType: revision.contentType || asset.contentType,
            contentEncoding: revision.contentEncoding,
            name: asset.name,
            description: asset.description,
            dataUrl: revision.dataUrl,
            dependencies: revision.dependencies,
            metadata: revision.metadata,
        });
    }

    return importItems;
};

/**
 * Builds dependency levels for parallel processing.
 *
 * Groups items by dependency level using a modified Kahn's algorithm.
 * Also adds implicit dependencies so later revisions of the same asset
 * depend on earlier revisions (for correct processing order only, not
 * sent to backend).
 *
 * @param importItems - The import items to group by dependency level
 * @returns Array of levels, where each level contains indices into importItems
 *          that can be processed in parallel
 * @internal Exported for testing
 */
export const buildDependencyLevels = (importItems: ImportItem[]): number[][] => {
    // Flatten dependencies into assetRefKey strings.
    // NOTE: flatDependencies is used ONLY for local processing order. It is NOT
    // sent to the backend. The backend receives dependencies from the original
    // importItem.dependencies (see createImportedAssets).
    const flatDependencies = new Map<string, string[]>();
    for (const importItem of importItems) {
        const dependencies = importItem.dependencies || {};
        flatDependencies.set(importItem.assetRefKey, Object.entries(dependencies).map(
            ([assetId, revisionId]) => assetRefKey({ assetId, revisionId }),
        ));
    }

    // Add implicit dependencies: later revisions of the same asset depend on
    // earlier revisions. This ensures that asset creation happens before
    // revision creation for the same asset. These implicit dependencies are
    // only used for local processing order and are NOT sent to the backend.
    const revisionsByAssetId = new Map<string, string[]>();
    for (const item of importItems) {
        const revisions = revisionsByAssetId.get(item.assetId) || [];
        revisions.push(item.assetRefKey);
        revisionsByAssetId.set(item.assetId, revisions);
    }
    for (const revisions of revisionsByAssetId.values()) {
        for (let i = 1; i < revisions.length; i++) {
            const deps = flatDependencies.get(revisions[i]!) || [];
            deps.push(revisions[i - 1]!);
            flatDependencies.set(revisions[i]!, deps);
        }
    }

    return groupIndicesByDependencyLevel(
        importItems,
        item => item.assetRefKey,
        item => flatDependencies.get(item.assetRefKey) || [],
    );
};

/**
 * Validates an import job and returns an error message if invalid.
 *
 * Checks that the import job exists, has a success status, and includes
 * an uploadId. Returns a formatted error message if any check fails.
 *
 * @param importItem - The import item being validated (used for error context)
 * @param importJob - The import job result from batchImportAssets
 * @returns null if valid, or a formatted error message string if invalid
 * @internal Exported for testing
 */
export const validateImportJob = (
    importItem: ImportItem,
    importJob: { status: string; uploadId?: string } | undefined,
): string | null => {
    if (importJob && importJob.status === "success" && importJob.uploadId) {
        return null;
    }

    const assetName = importItem.name || importItem.assetRefKey;
    const assetType = importItem.type || 'unknown';
    const sourceUrl = importItem.dataUrl || 'unknown';
    const truncatedUrl = sourceUrl.length > 100
        ? sourceUrl.slice(0, 100) + '...'
        : sourceUrl;
    const status = importJob?.status || 'no response';

    let reason: string;
    if (!importJob) {
        reason = 'No import job was created for this asset';
    } else if (status === 'failed') {
        if (importItem.type === DomainAssetType.AssetTypePrefab) {
            reason = 'The server failed to download or process this stem. ' +
                'This usually means the stem revision is unavailable in this environment ' +
                'or its source project cannot be resolved.';
        } else {
            reason = 'The server failed to download or process the asset. ' +
                'The source URL may be inaccessible or the file may be corrupted.';
        }
    } else if (!importJob.uploadId) {
        reason = 'The asset was processed but no upload ID was returned. ' +
            'The file may be empty or in an unsupported format.';
    } else {
        reason = 'Unknown reason';
    }

    return [
        `Failed to import asset "${assetName}"`,
        ``,
        `  • Type: ${assetType}`,
        `  • Status: ${status}`,
        `  • Source: ${truncatedUrl}`,
        ``,
        `  Reason: ${reason}`,
        importItem.type === DomainAssetType.AssetTypePrefab && status === 'failed'
            ? '  Hint: Export the stem from the source environment and import it into this environment, or make sure you can access that stem revision.'
            : '',
    ].join('\n');
};

/**
 * Maps old dependency IDs to new IDs.
 *
 * Transforms a dependency map from old asset/revision IDs to new IDs
 * using the provided mapping. Dependencies that cannot be mapped are
 * skipped with a warning.
 *
 * @param dependencies - Map of old asset ID to old revision ID
 * @param assetIdMap - Map of old asset ID to new asset ID
 * @param assetRevisionIdMap - Map of old "assetId:revisionId" to new revision ID
 * @returns Map of new asset ID to new revision ID
 * @internal Exported for testing
 */
export const mapDependenciesToNewIds = (
    dependencies: Record<string, string> | undefined,
    assetIdMap: Map<string, string>,
    assetRevisionIdMap: Map<string, string>,
): Record<string, string> => {
    const newDependencies: Record<string, string> = {};
    const deps = dependencies || {};

    for (const [depAssetId, depRevisionId] of Object.entries(deps)) {
        const mappedAssetId = assetIdMap.get(depAssetId);
        if (!mappedAssetId) {
            console.warn(`Dependency asset with id ${depAssetId} not found`);
            continue;
        }

        const revisionKey = assetRefKey({ assetId: depAssetId, revisionId: depRevisionId });
        const mappedRevisionId = assetRevisionIdMap.get(revisionKey);
        if (!mappedRevisionId) {
            console.warn(`Dependency asset revision with id ${depAssetId}:${depRevisionId} not found`);
            continue;
        }

        newDependencies[mappedAssetId] = mappedRevisionId;
    }

    return newDependencies;
};

/**
 * Remaps asset IDs in metadata (e.g., logicalAssetIdMap).
 *
 * Creates a copy of the metadata with any asset ID references updated
 * to their new values. Currently handles the logicalAssetIdMap field.
 * Unmapped asset IDs are skipped with a warning.
 *
 * @param metadata - The original metadata object (may be undefined)
 * @param assetIdMap - Map of old asset ID to new asset ID
 * @returns New metadata object with remapped asset IDs
 * @internal Exported for testing
 */
export const remapMetadataAssetIds = (
    metadata: Record<string, unknown> | undefined,
    assetIdMap: Map<string, string>,
): Record<string, unknown> => {
    const newMetadata = { ...metadata };

    if (metadata?.logicalAssetIdMap) {
        const logicalAssetIdMap = metadata.logicalAssetIdMap as Record<string, string>;
        const newLogicalAssetIdMap: Record<string, string> = {};

        for (const [logicalId, logicalAssetId] of Object.entries(logicalAssetIdMap)) {
            const mappedAssetId = assetIdMap.get(logicalAssetId);
            if (!mappedAssetId) {
                console.warn(`Asset with id ${logicalAssetId} not found`);
                continue;
            }
            newLogicalAssetIdMap[logicalId] = mappedAssetId;
        }

        newMetadata.logicalAssetIdMap = newLogicalAssetIdMap;
    }

    return newMetadata;
};

/** Import job result from batchImportAssets */
interface ImportJob {
    referenceId: string;
    status: string;
    uploadId?: string;
}

/**
 * Creates assets and revisions in parallel by dependency level.
 *
 * Processes each dependency level sequentially, but items within a level
 * are created in parallel with a concurrency limit. Maps old IDs to new IDs
 * as assets are created.
 *
 * @param importItems - The import items to create
 * @param levels - Dependency levels from buildDependencyLevels
 * @param importJobsByRef - Map of assetRefKey to import job result
 * @param reportProgress - Callback for progress updates (count, total)
 * @returns Object containing assetIdMap, assetRevisionIdMap, and newAssets array
 */
const createImportedAssets = async (
    importItems: ImportItem[],
    levels: number[][],
    importJobsByRef: Map<string, ImportJob>,
    reportProgress: (count: number, total: number) => void,
): Promise<{
    assetIdMap: Map<string, string>;
    assetRevisionIdMap: Map<string, string>;
    newAssets: Asset[];
}> => {
    const assetIdMap = new Map<string, string>();
    const assetRevisionIdMap = new Map<string, string>();
    const latestRevisionIds = new Map<string, string>();
    const newAssets: Asset[] = [];

    let createdCount = 0;
    const totalCount = importItems.length;

    for (const level of levels) {
        const levelResults = await processWithConcurrency(
            level,
            async (index): Promise<AssetCreationResult> => {
                const importItem = importItems[index]!;
                const importJob = importJobsByRef.get(importItem.assetRefKey);

                // Validate the import job
                const errorMsg = validateImportJob(importItem, importJob);
                if (errorMsg) {
                    console.error(`[Import] ${errorMsg}`);
                    throw new Error(errorMsg);
                }

                // Map dependencies to new IDs (safe: dependencies are from previous levels)
                const itemNewDependencies = mapDependenciesToNewIds(
                    importItem.dependencies,
                    assetIdMap,
                    assetRevisionIdMap,
                );

                // Remap asset IDs in metadata
                const newMetadata = remapMetadataAssetIds(importItem.metadata, assetIdMap);

                const existingNewAssetId = assetIdMap.get(importItem.assetId);
                const options = {
                    metadata: newMetadata,
                    dependencies: itemNewDependencies,
                };

                if (existingNewAssetId) {
                    // Create a new revision for the existing asset
                    const parentRevisionId = latestRevisionIds.get(existingNewAssetId)!;
                    try {
                        const { id } = await withRetry(
                            () => createAssetRevision({
                                assetId: existingNewAssetId,
                                parentRevisionId,
                                uploadId: importJob!.uploadId!,
                                format: importItem.format,
                                contentType: importItem.contentType,
                                options,
                            }),
                            { operationName: 'createAssetRevision' },
                        );
                        createdCount++;
                        reportProgress(createdCount, totalCount);
                        return {
                            index,
                            oldAssetId: importItem.assetId,
                            newAssetId: null,
                            oldRevisionKey: assetRefKey(importItem),
                            newRevisionId: id,
                            newAsset: null,
                        };
                    } catch (error) {
                        if (isNoChangesError(error)) {
                            createdCount++;
                            reportProgress(createdCount, totalCount);
                            return {
                                index,
                                oldAssetId: importItem.assetId,
                                newAssetId: null,
                                oldRevisionKey: assetRefKey(importItem),
                                newRevisionId: parentRevisionId,
                                newAsset: null,
                            };
                        }
                        throw error;
                    }
                } else {
                    // Create a new asset
                    const newAsset = await withRetry(
                        () => createAsset({
                            type: importItem.type,
                            format: importItem.format,
                            contentType: importItem.contentType,
                            name: importItem.name,
                            uploadId: importJob!.uploadId!,
                            options,
                        }),
                        { operationName: 'createAsset' },
                    );
                    createdCount++;
                    reportProgress(createdCount, totalCount);
                    return {
                        index,
                        oldAssetId: importItem.assetId,
                        newAssetId: newAsset.id,
                        oldRevisionKey: assetRefKey(importItem),
                        newRevisionId: newAsset.headRevisionId,
                        newAsset,
                    };
                }
            },
            IMPORT_TUNING.assetCreationConcurrency,
            { failFast: true },
        );

        // Update maps after level completes (single-threaded, safe)
        for (const result of levelResults) {
            if (result.newAssetId) {
                assetIdMap.set(result.oldAssetId, result.newAssetId);
                latestRevisionIds.set(result.newAssetId, result.newRevisionId);
            } else {
                const existingNewAssetId = assetIdMap.get(result.oldAssetId);
                if (existingNewAssetId) {
                    latestRevisionIds.set(existingNewAssetId, result.newRevisionId);
                }
            }
            assetRevisionIdMap.set(result.oldRevisionKey, result.newRevisionId);
            if (result.newAsset) {
                newAssets.push(result.newAsset);
            }
        }
    }

    return { assetIdMap, assetRevisionIdMap, newAssets };
};

/**
 * Builds new dependencies map from old dependencies.
 *
 * Transforms the scene's dependency map from old asset/revision IDs to
 * new IDs. This is used to update the scene's assetIdToRevisionId mapping
 * after import. Dependencies that cannot be mapped are skipped with a warning.
 *
 * @param dependencies - The original scene dependencies (old asset ID to old revision ID)
 * @param assetIdMap - Map of old asset ID to new asset ID
 * @param assetRevisionIdMap - Map of old "assetId:revisionId" to new revision ID
 * @returns New dependencies map (new asset ID to new revision ID)
 * @internal Exported for testing
 */
export const buildNewDependencies = (
    dependencies: Record<string, string>,
    assetIdMap: Map<string, string>,
    assetRevisionIdMap: Map<string, string>,
): Record<string, string> => {
    const newDependencies: Record<string, string> = {};

    for (const [assetId, revisionId] of Object.entries(dependencies)) {
        const newAssetRef = mapAssetRef({ assetId, revisionId }, assetIdMap, assetRevisionIdMap);
        if (!newAssetRef) {
            console.warn(`Failed to map asset ref ${assetId}:${revisionId} in scene dependencies`);
            continue;
        }
        newDependencies[newAssetRef.assetId] = newAssetRef.revisionId;
    }

    return newDependencies;
};

/**
 * Import assets from an exported scene.
 *
 * @remarks
 * This is necessary when switching environments (e.g., staging vs. production),
 * or when the user doing the import is different from the user who exported the
 * scene. In these cases, assets need to be re-created and references to them
 * need to be updated.
 *
 * References to the old assets will be updated in-place in the scene data. The
 * following references will be updated:
 * - Behavior IDs
 * - Behavior attributes containing asset IDs
 * - Model IDs
 * - Prefab IDs
 *
 * This function returns a new dependency map for the scene.
 *
 * @param sceneData - The scene data being imported
 * @param dependencies - A map from imageId -> revisionID
 * @param onProgress - Optional callback for progress updates
 * @returns A promise that resolves when the assets have been imported.
 */
export const importAssets = async (
    sceneData: any[],
    dependencies: Record<string, string>,
    onProgress?: ImportAssetsProgressCallback,
): Promise<{
    // Updated dependencies
    dependencies: Record<string, string>,
}> => {

    // Parse and validate asset data
    const { assets, revisions, derivatives } = parseAssetData(sceneData);
    if (!assets.length || !revisions.length) {
        return { dependencies: {} };
    }

    console.log(`[Import] Found ${assets.length} assets to import:`,
        assets.map(a => `${a.type}:${a.name || a.id.slice(0, 8)}`).join(', '));

    // Progress helper for 4 sub-phases (25% each)
    const reportProgress = (subPhase: number, subProgress: number, currentStep: string) => {
        const progress = subPhase * SUB_STEP_WEIGHT + subProgress * SUB_STEP_WEIGHT;
        onProgress?.({ progress, currentStep });
    };

    // Phase 1: Build import items from assets/revisions
    const importItems = buildImportItems(assets, revisions);

    // Phase 2: Determine processing order via dependency levels
    const levels = buildDependencyLevels(importItems);

    // Phase 3: Batch upload asset data (sub-phase 0)
    reportProgress(0, 0, "Importing assets...");
    const batchImportItems = importItems.map((item) => ({
        referenceId: item.assetRefKey,
        contentType: item.contentType,
        contentEncoding: item.contentEncoding,
        dataUrl: item.dataUrl,
    }));
    const importJobs = await batchImportAssets(
        batchImportItems,
        IMPORT_TUNING.assetBatchSize,
        (completed, total) => {
            const subProgress = total > 0 ? completed / total : 1;
            reportProgress(0, subProgress, `Importing assets (${completed}/${total})`);
        },
        IMPORT_TUNING.assetBatchPollConcurrency,
    );

    // Create a map from referenceId to import job (server may return jobs in any order)
    const importJobsByRef = new Map(
        importJobs.map((job) => [job.referenceId, job]),
    );

    // Phase 4: Create assets/revisions in parallel by level (sub-phase 1)
    reportProgress(1, 0, "Creating assets...");
    const { assetIdMap, assetRevisionIdMap } = await createImportedAssets(
        importItems,
        levels,
        importJobsByRef,
        (count, total) => {
            const subProgress = total > 0 ? count / total : 1;
            reportProgress(1, subProgress, `Creating assets (${count}/${total})`);
        },
    );

    // Phase 5: Import derivatives (sub-phases 2 and 3)
    await importDerivatives(
        derivatives,
        assetIdMap,
        assetRevisionIdMap,
        (subPhase, subProgress, currentStep) => reportProgress(2 + subPhase, subProgress, currentStep),
    );

    // Phase 6: Migrate asset refs in scene data
    migrateAssetRefs(sceneData, assetIdMap, assetRevisionIdMap);

    // Phase 7: Build and return new dependencies
    return { dependencies: buildNewDependencies(dependencies, assetIdMap, assetRevisionIdMap) };
};

/**
 * Indicates whether the assets in the given scene data should be reimported.
 * 
 * @remarks
 * This method returns true if one or more of the assets / revisions in the
 * scene data do not exist on the server, or if the user does not have access to
 * them.
 * 
 * @param isSameServer - Whether the source and destination servers are the same
 * @param sceneData - The scene data to check
 * @param userId - The ID of the user importing the scene
 * @returns true if the assets should be reimported, false otherwise.
 */
export const shouldImportAssets = async (isSameServer: boolean, sceneData: any[], userId: string) => {
    if (!isSameServer) {
        return true;
    }
    
    const { assets, revisions } = parseAssetData(sceneData);
    if (!assets.length || !revisions.length) {
        return false;
    }

    // Attempt to fetch each asset.
    const assetPromises = assets.map((asset) => getAsset(asset.id));
    const assetResults = await Promise.allSettled(assetPromises);
    const assetsById: Record<string, Asset> = {};
    for (const assetResult of assetResults) {
        // Check that the user has access to the asset. If not, we should
        // reimport it.
        if (assetResult.status === "rejected") {
            return true;
        }

        assetsById[assetResult.value.id] = assetResult.value;
    }

    // If any of the assets were not found, we should reimport them.
    const someAssetsNotFound = assetResults.some((result) => result.status === "rejected");
    if (someAssetsNotFound) {
        return true;
    }

    // Also check that the user has access to all of the revisions.
    const revisionPromises = revisions.map((revision) => getAssetRevision(revision.assetId, revision.id, {
        includeRelease: true,
    }));
    const foundRevisions = await Promise.allSettled(revisionPromises);

    // If any of the assets are not owned by the user, and the revisions are not
    // published, we need to reimport them.
    for (const revisionResult of foundRevisions) {
        // Check that the user has access to the revision. If not, we should
        // reimport it.
        if (revisionResult.status === "rejected") {
            return true;
        }

        const revision = revisionResult.value;
        const asset = assetsById[revision.assetId];
        if (!asset) {
            console.warn(`Asset ${revision.assetId} not found in scene data`);
            continue;
        }

        if (asset.userId !== userId && !revision.release) {
            return true;
        }
    }

    return false;
};

/**
 * Parses the asset data from the scene data.
 *
 * @param sceneData - The scene data
 * @returns The parsed asset data.
 */
export const parseAssetData = (sceneData: any[]) => {
    const assetJson = sceneData.find((item) => item.metadata?.generator === "AssetSerializer");
    if (!assetJson) {
        return {
            assets: [],
            revisions: [],
            derivatives: [],
        };
    }

    const result = AssetObjectSchema.safeParse(assetJson);
    if (!result.success) {
        console.warn("Failed to parse asset data:", result.error);
        throw new Error("Failed to parse asset data");
    }

    return {
        assets: result.data.assets,
        revisions: result.data.revisions,
        derivatives: result.data.derivatives,
    };
};

/**
 * Imports derivatives for the newly created asset revisions.
 *
 * @param derivatives - The serialized derivatives to import
 * @param assetIdMap - Maps old asset IDs to new asset IDs
 * @param assetRevisionIdMap - Maps old "assetId:revisionId" keys to new revision IDs
 * @param reportProgress - Callback for progress updates (subPhase 0 = batch import, subPhase 1 = create)
 */
const importDerivatives = async (
    derivatives: SerializedAssetDerivative[],
    assetIdMap: Map<string, string>,
    assetRevisionIdMap: Map<string, string>,
    reportProgress: (subPhase: number, subProgress: number, currentStep: string) => void,
): Promise<void> => {
    if (!derivatives.length) {
        return;
    }

    // Build import items for derivatives, mapping old IDs to new IDs
    const derivativeImportItems = [];
    for (const derivative of derivatives) {
        const newAssetId = assetIdMap.get(derivative.assetId);
        if (!newAssetId) {
            console.warn(`Derivative references unknown asset: ${derivative.assetId}`);
            continue;
        }

        const oldRefKey = assetRefKey({ assetId: derivative.assetId, revisionId: derivative.revisionId });
        const newRevisionId = assetRevisionIdMap.get(oldRefKey);
        if (!newRevisionId) {
            console.warn(`Derivative references unknown revision: ${oldRefKey}`);
            continue;
        }

        derivativeImportItems.push({
            referenceId: derivative.id,
            contentType: derivative.contentType,
            contentEncoding: derivative.contentEncoding,
            dataUrl: derivative.dataUrl,
            newAssetId,
            newRevisionId,
            type: derivative.type,
            format: derivative.format,
            metadata: derivative.metadata || {},
            lodLevel: derivative.lodLevel,
        });
    }

    if (!derivativeImportItems.length) {
        return;
    }

    const totalDerivatives = derivativeImportItems.length;

    // Sub-phase 0: Batch import derivative data (upload + server processing)
    reportProgress(0, 0, "Importing derivatives...");

    const batchItems = derivativeImportItems.map((item) => ({
        referenceId: item.referenceId,
        contentType: item.contentType,
        contentEncoding: item.contentEncoding,
        dataUrl: item.dataUrl,
    }));
    const importJobs = await batchImportAssets(
        batchItems,
        IMPORT_TUNING.derivativeBatchSize,
        (completed, total) => {
            const subProgress = total > 0 ? completed / total : 1;
            reportProgress(0, subProgress, `Importing derivatives (${completed}/${total})`);
        },
        IMPORT_TUNING.derivativeBatchPollConcurrency,
    );

    // Create a map from referenceId to import job
    const importJobsByRef = new Map(
        importJobs.map((job) => [job.referenceId, job]),
    );

    // Sub-phase 1: Create derivatives
    let createdCount = 0;
    reportProgress(1, 0, "Creating derivatives...");

    for (const item of derivativeImportItems) {
        const job = importJobsByRef.get(item.referenceId);

        if (!job || job.status !== "success" || !job.uploadId) {
            console.warn(`Failed to import derivative data: ${item.referenceId}`);
            createdCount++;
            const subProgress = totalDerivatives > 0 ? createdCount / totalDerivatives : 1;
            reportProgress(1, subProgress, `Creating derivatives (${createdCount}/${totalDerivatives})`);
            continue;
        }

        try {
            await withRetry(
                () => createAssetDerivative(item.newAssetId, item.newRevisionId, {
                    type: item.type,
                    format: item.format,
                    metadata: item.metadata,
                    lodLevel: item.lodLevel,
                    uploadId: job.uploadId!,
                }),
                { operationName: 'createAssetDerivative' },
            );
        } catch (err) {
            console.warn(`Failed to create derivative: ${item.referenceId}`, err);
        }

        createdCount++;
        const subProgress = totalDerivatives > 0 ? createdCount / totalDerivatives : 1;
        reportProgress(1, subProgress, `Creating derivatives (${createdCount}/${totalDerivatives})`);
    }
};

/**
 * Maps an old asset reference to a new asset reference.
 *
 * @param assetRef - The original asset reference with old IDs
 * @param assetIdMap - Map of old asset ID to new asset ID
 * @param assetRevisionIdMap - Map of old "assetId:revisionId" to new revision ID
 * @returns New asset reference with mapped IDs, or null if mapping fails
 */
const mapAssetRef = (
    assetRef: Readonly<AssetRef>,
    assetIdMap: Map<string, string>,
    assetRevisionIdMap: Map<string, string>,
): AssetRef | null => {
    const newAssetId = assetIdMap.get(assetRef.assetId);
    if (!newAssetId) {
        return null;
    }

    const newRevisionId = assetRevisionIdMap.get(assetRefKey(assetRef));
    if (!newRevisionId) {
        return null;
    }

    return {
        assetId: newAssetId,
        revisionId: newRevisionId,
    };
};

const migrateAssetRefsInValue = (
    root: Record<string, any> | any[],
    assetIdMap: Map<string, string>,
    assetRevisionIdMap: Map<string, string>,
): void => {
    const stack: Array<{container: Record<string, any> | any[]; key: string | number}> = [];
    const seen = new WeakSet<object>();

    if (Array.isArray(root)) {
        for (let i = root.length - 1; i >= 0; i--) {
            stack.push({container: root, key: i});
        }
    } else {
        const keys = Object.keys(root);
        for (let i = keys.length - 1; i >= 0; i--) {
            stack.push({container: root, key: keys[i]!});
        }
    }

    while (stack.length > 0) {
        const {container, key} = stack.pop()!;
        const value = (container as any)[key];
        if (isAssetRef(value)) {
            const mapped = mapAssetRef(value, assetIdMap, assetRevisionIdMap);
            (container as any)[key] = mapped ?? value;
            continue;
        }

        if (!value || typeof value !== "object") {
            continue;
        }

        if (seen.has(value)) {
            continue;
        }
        seen.add(value);

        if (Array.isArray(value)) {
            for (let i = value.length - 1; i >= 0; i--) {
                stack.push({container: value, key: i});
            }
            continue;
        }

        const keys = Object.keys(value);
        for (let i = keys.length - 1; i >= 0; i--) {
            stack.push({container: value, key: keys[i]!});
        }
    }
};

/**
 * Migrates asset references within behavior attributes to new IDs.
 * Scans nested objects and arrays (e.g. group/array attribute types).
 *
 * @param behavior - The behavior data containing attributes to migrate
 * @param assetIdMap - Map of old asset ID to new asset ID
 * @param assetRevisionIdMap - Map of old "assetId:revisionId" to new revision ID
 */
const migrateBehaviorAttributeAssetRefs = (
    behavior: BehaviorData,
    assetIdMap: Map<string, string>,
    assetRevisionIdMap: Map<string, string>,
): void => {
    const attributesData = behavior.attributesData;
    if (!attributesData) {
        return;
    }

    migrateAssetRefsInValue(attributesData, assetIdMap, assetRevisionIdMap);
};

/**
 * Migrates asset references within lambda component data to new IDs.
 *
 * @param lambdaComponent - The lambda component data to migrate
 * @param assetIdMap - Map of old asset ID to new asset ID
 * @param assetRevisionIdMap - Map of old "assetId:revisionId" to new revision ID
 */
const migrateLambdaComponentDataAssetRefs = (
    lambdaComponent: LambdaComponentData,
    assetIdMap: Map<string, string>,
    assetRevisionIdMap: Map<string, string>,
): void => {
    const componentData = lambdaComponent.componentData;
    if (!componentData) {
        return;
    }

    for (const [key, value] of Object.entries(componentData)) {
        if (isAssetRef(value)) {
            const newAssetRef = mapAssetRef(value, assetIdMap, assetRevisionIdMap);
            if (!newAssetRef) {
                console.warn(`Failed to map lambda componentData asset reference ${value.assetId}:${value.revisionId}`);
                componentData[key] = {
                    assetId: 'missing-asset-id',
                    revisionId: 'missing-revision-id',
                };
                continue;
            }

            componentData[key] = newAssetRef;
        }
    }
};

const extractLegacyAssetId = (value: string): string => {
    // Check for old format: assetIdrevisionID=...
    if (value.length > 24) {
        const assetIdCandidate = value.slice(0, 24);
        const isValidObjectId = /^[a-fA-F0-9]{24}$/.test(assetIdCandidate);

        // Ensure the string is exactly: <24-char ObjectId> + "revisionID=..."
        if (isValidObjectId && value.startsWith('revisionID=', 24)) {
            return assetIdCandidate;
        }
    }
    return value;
};

/**
 * Handle legacy asset data structure in userData.
 * Old format: { assetID: "...", revisionID: "..." }
 * New format: { imageId: "..." }
 * @param userData
 * @param assetIdMap
 */
const migrateLegacyUserData = (userData: any, assetIdMap: Map<string, string>): boolean => {
    if (userData.assetID) {
        const newAssetId = assetIdMap.get(userData.assetID);
        if (newAssetId) {
            userData.imageId = newAssetId;
            delete userData.assetID;
            delete userData.revisionID;
            return true;
        }
    }
    return false;
};

const migrateMaterialAssetIds = (
    material: Record<string, any> | any[],
    assetIdMap: Map<string, string>,
): void => {
    const stack: unknown[] = [material];
    const seen = new WeakSet<object>();

    while (stack.length > 0) {
        const current = stack.pop();
        if (!current || typeof current !== 'object') {
            continue;
        }

        const currentObject = current as Record<string, any> | any[];
        if (seen.has(currentObject)) {
            continue;
        }
        seen.add(currentObject);

        if (Array.isArray(currentObject)) {
            for (let i = currentObject.length - 1; i >= 0; i--) {
                const value = currentObject[i];
                if (typeof value === 'string') {
                    const newAssetId = assetIdMap.get(value);
                    if (newAssetId) {
                        currentObject[i] = newAssetId;
                    }
                } else if (value && typeof value === 'object') {
                    stack.push(value);
                }
            }
            continue;
        }

        for (const key of Object.keys(currentObject)) {
            const value = currentObject[key];
            if (typeof value === 'string') {
                const assetId = extractLegacyAssetId(value);
                const newAssetId = assetIdMap.get(assetId);
                if (newAssetId) {
                    currentObject[key] = newAssetId;
                }
            } else if (value && typeof value === 'object') {
                if (key === 'userData') {
                    migrateLegacyUserData(value, assetIdMap);
                }
                stack.push(value);
            }
        }
    }
};

/**
 * Migrates all asset references in scene data to new IDs.
 *
 * Updates behavior IDs, behavior attribute asset refs, lambda component IDs,
 * model IDs, and prefab IDs to use the newly created asset IDs.
 *
 * @param sceneData - The scene data array to migrate (modified in place)
 * @param assetIdMap - Map of old asset ID to new asset ID
 * @param assetRevisionIdMap - Map of old "assetId:revisionId" to new revision ID
 * @throws Error if a required asset reference cannot be mapped
 */
const migrateAssetRefs = (
    sceneData: any[],
    assetIdMap: Map<string, string>,
    assetRevisionIdMap: Map<string, string>,
): void => {
    for (const item of sceneData) {
        if (item.userData?.behaviors) {
            // Migrate behavior references
            for (const behavior of item.userData.behaviors || []) {
                const newBehaviorId = assetIdMap.get(behavior.id);
                if (newBehaviorId) {
                    behavior.id = newBehaviorId;
                } else if (behavior.id) {
                    console.warn(`[Import] Behavior asset ${behavior.id} not found in asset map. Object: ${item.name || item.uuid}`);
                }
            }

            // Migrate behavior attributes
            for (const behavior of item.userData.behaviors || []) {
                migrateBehaviorAttributeAssetRefs(behavior as BehaviorData, assetIdMap, assetRevisionIdMap);
            }
        }

        // Migrate lambda references
        if (item.userData?.lambdaComponents) {
            for (const lc of item.userData.lambdaComponents as LambdaComponentData[]) {
                if (!isBuiltInLambdaId(lc.lambdaId)) {
                    const newLambdaId = assetIdMap.get(lc.lambdaId);
                    if (newLambdaId) {
                        lc.lambdaId = newLambdaId;
                    } else {
                        console.warn(`[Import] Lambda asset ${lc.lambdaId} not found in asset map. Object: ${item.name || item.uuid}`);
                    }
                }

                migrateLambdaComponentDataAssetRefs(lc, assetIdMap, assetRevisionIdMap);
            }
        }

        // Migrate model IDs
        if (item.metadata.generator === "ModelSerializer") {
            const newAssetId = assetIdMap.get(item.modelId);
            if (newAssetId) {
                item.modelId = newAssetId;
            } else {
                const errorMsg = [
                    `Cannot import scene: Model asset not found`,
                    ``,
                    `  • Asset ID: ${item.modelId}`,
                    `  • Object: ${item.name || item.uuid || 'unknown'}`,
                    ``,
                    `  This may happen if the model was deleted or is missing from this environment.`,
                ].join('\n');
                throw new Error(errorMsg);
            }
        }

        // Migrate prefab IDs
        if (item.metadata.generator === "PrefabSerializer") {
            const newAssetId = assetIdMap.get(item.prefabId);
            if (newAssetId) {
                item.prefabId = newAssetId;
            } else {
                const errorMsg = [
                    `Cannot import scene: Prefab asset not found`,
                    ``,
                    `  • Asset ID: ${item.prefabId}`,
                    `  • Object: ${item.name || item.uuid || 'unknown'}`,
                    ``,
                    `  This may happen if the prefab was deleted or is missing from this environment.`,
                ].join('\n');
                throw new Error(errorMsg);
            }
        }

        if (item.userData?.prefabId) {
            const oldPrefabId = item.userData.prefabId;
            const newPrefabId = assetIdMap.get(oldPrefabId);
            if (newPrefabId) {
                item.userData.prefabId = newPrefabId;
            } else {
                const errorMsg = [
                    `Cannot import scene: Prefab instance not found`,
                    ``,
                    `  • Prefab ID: ${oldPrefabId}`,
                    `  • Object: ${item.name || item.uuid || 'unknown'}`,
                    ``,
                    `  This may happen if the prefab was deleted or is missing from this environment.`,
                ].join('\n');
                throw new Error(errorMsg);
            }

            // Migrate prefab edit revision IDs
            if (item.userData.prefabEditRevisionId) {
                const assetRef = {
                    assetId: oldPrefabId,
                    revisionId: item.userData.prefabEditRevisionId,
                };
                const newAssetRef = mapAssetRef(assetRef, assetIdMap, assetRevisionIdMap);
                if (newAssetRef) {
                    item.userData.prefabEditRevisionId = newAssetRef.revisionId;
                } else {
                    // The edit revision wasn't exported (e.g., exported before this
                    // fix, or the revision was deleted). Detach from the prefab
                    // entirely to preserve the user's edits rather than reverting
                    // to the locked prefab revision.
                    console.warn(
                        `[Import] Detaching prefab for "${item.name || item.uuid}": ` +
                        `edit revision ${assetRef.revisionId} of prefab ${assetRef.assetId} was not exported`,
                    );
                    delete item.userData.prefabId;
                    delete item.userData.prefabEditRevisionId;
                }
            }
        }

        if (item.userData?.materialSettings) {
            const settings = item.userData.materialSettings;
            const migrateTextures = (s: any) => {
                if (!s.textures) return;
                for (const key of Object.keys(s.textures)) {
                    let oldAssetId = s.textures[key];
                    if (typeof oldAssetId === 'string') {
                        oldAssetId = extractLegacyAssetId(oldAssetId);
                        
                        const newAssetId = assetIdMap.get(oldAssetId);
                        if (newAssetId) {
                            s.textures[key] = newAssetId;
                        }
                    }
                }
            };

            if ('textures' in settings) {
                migrateTextures(settings);
            } else {
                for (const key of Object.keys(settings)) {
                    if (typeof settings[key] === 'object' && settings[key] !== null) {
                        migrateTextures(settings[key]);
                    }
                }
            }
        }

        // Migrate material textures by scanning nested material payloads.
        if (item.material) {
            migrateMaterialAssetIds(item.material, assetIdMap);
        }
    }
};

/**
 * Groups item indices by dependency level for parallel processing.
 * Level 0 = items with no dependencies, Level 1 = items depending only on level 0, etc.
 *
 * @remarks
 * This is a modified Kahn's algorithm that groups items by level instead of
 * producing a flat ordering. Items at the same level can be processed in parallel.
 * Throws an error if a cyclic dependency is detected.
 *
 * @param items - The items to group
 * @param getId - A function that returns the ID of an item
 * @param getDependencies - A function that returns the IDs of the dependencies
 * @returns An array of levels, where each level is an array of item indices.
 * @internal Exported for testing
 */
export const groupIndicesByDependencyLevel = <T>(
    items: T[],
    getId: (item: T) => string,
    getDependencies: (item: T) => string[],
): number[][] => {
    const idToIndex = new Map<string, number>();
    items.forEach((item, idx) => idToIndex.set(getId(item), idx));

    const inDegree = new Array(items.length).fill(0);
    const graph: number[][] = Array.from({ length: items.length }, () => []);

    for (let i = 0; i < items.length; i++) {
        for (const dep of getDependencies(items[i]!)) {
            const depIndex = idToIndex.get(dep);
            if (depIndex === undefined) {
                throw new Error(`Missing dependency ${dep}`);
            }
            graph[depIndex]!.push(i);
            inDegree[i]++;
        }
    }

    const levels: number[][] = [];
    let currentLevel = items
        .map((_, i) => i)
        .filter(i => inDegree[i] === 0);

    while (currentLevel.length > 0) {
        levels.push(currentLevel);
        const nextLevel: number[] = [];

        for (const idx of currentLevel) {
            for (const neighbor of graph[idx]!) {
                inDegree[neighbor]--;
                if (inDegree[neighbor] === 0) {
                    nextLevel.push(neighbor);
                }
            }
        }
        currentLevel = nextLevel;
    }

    const totalProcessed = levels.reduce((sum, l) => sum + l.length, 0);
    if (totalProcessed !== items.length) {
        throw new Error("Cycle detected in dependency graph");
    }

    return levels;
};

/**
 * Process items with limited concurrency.
 *
 * @param items - The items to process
 * @param processor - Async function to process each item
 * @param concurrencyLimit - Maximum number of concurrent operations
 * @param options - Optional concurrency behavior
 * @param options.failFast - If true, stop scheduling new items after first error
 * @returns Array of results in the same order as input items.
 */
export const processWithConcurrency = async <T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    concurrencyLimit: number,
    options: { failFast?: boolean } = {},
): Promise<R[]> => {
    const results: Array<R | undefined> = new Array(items.length);
    const maxWorkers = Math.max(1, Math.min(concurrencyLimit, items.length));
    const failFast = options.failFast ?? false;
    let currentIndex = 0;
    let shouldStop = false;
    let firstError: unknown = null;

    const runNext = async (): Promise<void> => {
        while (currentIndex < items.length) {
            if (failFast && shouldStop) {
                return;
            }

            const index = currentIndex++;

            try {
                results[index] = await processor(items[index]!);
            } catch (error) {
                firstError = firstError ?? error;
                if (failFast) {
                    shouldStop = true;
                    return;
                }
                throw error;
            }
        }
    };

    const workers = Array.from(
        { length: maxWorkers },
        () => runNext(),
    );

    await Promise.all(workers);
    if (firstError) {
        if (firstError instanceof Error) {
            throw firstError;
        }
        throw new Error('Unknown error during concurrent processing');
    }

    return results as R[];
};
