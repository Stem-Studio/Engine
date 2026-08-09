import { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    importAssets,
    buildImportItems,
    buildDependencyLevels,
    validateImportJob,
    mapDependenciesToNewIds,
    remapMetadataAssetIds,
    buildNewDependencies,
    groupIndicesByDependencyLevel,
    processWithConcurrency,
    type ImportItem,
    type SerializedAsset,
    type SerializedRevision,
} from './import';
import { AssetObjectSchema } from './schema';
import { batchImportAssets, createAsset, createAssetRevision } from '@stem/network/api/asset';

/**
 * Creates a mock Axios error for testing.
 * @param status
 * @param data
 */
const createAxiosError = (status: number, data: unknown): AxiosError => {
    const error = new AxiosError(
        `Request failed with status code ${status}`,
        'ERR_BAD_REQUEST',
        undefined,
        undefined,
        {
            status,
            statusText: status === 400 ? 'Bad Request' : 'Internal Server Error',
            headers: {},
            config: { headers: new AxiosHeaders() },
            data,
        },
    );
    return error;
};

vi.mock('@stem/network/api/asset', () => ({
    createAsset: vi.fn(),
    createAssetRevision: vi.fn(),
    batchImportAssets: vi.fn(),
    isNoChangesError: (error: unknown) => {
        // Check for Axios error with 400 status and "no changes" in response
        const axiosError = error as AxiosError | undefined;
        return (
            axiosError?.isAxiosError === true &&
            axiosError.response?.status === 400 &&
            (axiosError.response?.data as { msg?: string })?.msg?.toLowerCase().includes('no changes')
        );
    },
}));

vi.mock('./schema', () => ({
    AssetObjectSchema: {
        safeParse: vi.fn(),
    },
}));

// --- Test Fixtures ----------------------------------------------------------

const fakeAssets = [
    { id: 'a1', type: 'prefab', format: 'json', contentType: 'application/json', name: 'Asset 1' },
    { id: 'a2', type: 'prefab', format: 'json', contentType: 'application/json', name: 'Asset 2' },
    { id: 'a3', type: 'behavior', format: 'json', contentType: 'application/json', name: 'Asset 3' },
    { id: 'a4', type: 'model', format: 'glb', contentType: 'model/gltf-binary', name: 'Asset 4' },
];

const fakeRevisions = [
    { id: 'rev1', assetId: 'a1', dataUrl: 'https://example.com/prefab1' },
    { id: 'rev2', assetId: 'a1', dataUrl: 'https://example.com/prefab2' },
    {
        id: 'rev1',
        assetId: 'a2',
        dataUrl: 'https://example.com/prefab3',
        dependencies: { a1: 'rev2' },
        metadata: { logicalAssetIdMap: { someLogicalId: 'a1' } },
    },
    { id: 'rev1', assetId: 'a3', dataUrl: 'https://example.com/behavior1' },
    { id: 'rev1', assetId: 'a4', dataUrl: 'https://example.com/model.glb' },
];

const makeSceneData = () => {
    const sceneDependencies = {
        a1: 'rev1',
    };

    const scene = {
        metadata: { generator: 'SceneSerializer' },
        userData: {
            assetResolutionContext: {
                assetIdToRevisionId: sceneDependencies,
                logicalIdToAssetId: {},
            },
        },
    };

    const basicPrefab = {
        metadata: { generator: 'PrefabSerializer' },
        prefabId: 'a1',
    };

    const nestedPrefab = {
        metadata: { generator: 'PrefabSerializer' },
        prefabId: 'a2',
        // Note that asset a2:rev1 in fakeRevisions has a dependency on another
        // asset: a1:rev2
    };

    const prefabBeingEdited = {
        metadata: { generator: 'Object3DSerializer' },
        userData: {
            prefabId: 'a1',
            prefabEditRevisionId: 'rev1',
        },
    };

    const objectWithBehavior = {
        metadata: { generator: 'Object3DSerializer' },
        userData: {
            behaviors: [
                {
                    id: 'a3',
                    attributesData: { someAssetRef: { assetId: 'a1', revisionId: 'rev1' } },
                },
            ],
        },
    };

    const objectWithLegacyBehavior = {
        metadata: { generator: 'Object3DSerializer' },
        userData: {
            behaviors: [
                {
                    id: 'user.somebehavior', // legacy behavior ID
                    attributesData: { someAssetRef: { assetId: 'a1', revisionId: 'rev1' } },
                },
            ],
        },
    };

    const modelObject = {
        metadata: { generator: 'ModelSerializer' },
        modelId: 'a4',
    };

    return {
        scene,
        sceneDependencies,
        basicPrefab,
        nestedPrefab,
        prefabBeingEdited,
        objectWithBehavior,
        objectWithLegacyBehavior,
        modelObject,
        sceneData: [
            { metadata: { generator: 'AssetSerializer' } },
            scene, basicPrefab, nestedPrefab, prefabBeingEdited, objectWithBehavior, objectWithLegacyBehavior, modelObject,
        ],
    };
};

const makeDeepObjectChain = (depth = 12_000): {root: Record<string, any>; leaf: Record<string, any>} => {
    const root: Record<string, any> = {};
    let cursor = root;
    for (let i = 0; i < depth; i++) {
        cursor.next = {};
        cursor = cursor.next;
    }
    return {root, leaf: cursor};
};

// ---------------------------------------------------------------------------

describe('importAssets', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    // --- Basic Behavior -----------------------------------------------------

    it('should return empty map if no asset data found', async () => {
        const sceneData = [
            { metadata: { generator: 'SceneSerializer' }, userData: {} },
        ];

        const result = await importAssets(sceneData, {});
        expect(result.dependencies).toEqual({});
        expect(createAsset).not.toHaveBeenCalled();
        expect(createAssetRevision).not.toHaveBeenCalled();
        expect(batchImportAssets).not.toHaveBeenCalled();
    });

    it('should throw if asset data fails validation', async () => {
        (AssetObjectSchema.safeParse as any).mockReturnValue({
            success: false,
            error: new Error('Invalid data'),
        });

        await expect(importAssets([{ metadata: { generator: 'AssetSerializer' } }], {}))
            .rejects
            .toThrow('Failed to parse asset data');
    });

    // --- Setup Shared Successful Parse -------------------------------------

    const setupSuccessParse = () => {
        (AssetObjectSchema.safeParse as any).mockReturnValue({
            success: true,
            data: { assets: fakeAssets, revisions: fakeRevisions, derivatives: [] },
        });

        (batchImportAssets as any).mockResolvedValue([
            { referenceId: 'a1:rev1', uploadId: 'upload1', status: 'success' },
            { referenceId: 'a1:rev2', uploadId: 'upload2', status: 'success' },
            { referenceId: 'a2:rev1', uploadId: 'upload3', status: 'success' },
            { referenceId: 'a3:rev1', uploadId: 'upload4', status: 'success' },
            { referenceId: 'a4:rev1', uploadId: 'upload5', status: 'success' },
        ]);

        // Use argument-matching mock since parallel processing doesn't guarantee order
        (createAsset as any).mockImplementation(
            ({name}: {name: string}) => {
                if (name === 'Asset 1') return Promise.resolve({ id: 'newA1', headRevisionId: 'newRev1' });
                if (name === 'Asset 2') return Promise.resolve({ id: 'newA2', headRevisionId: 'newRev1' });
                if (name === 'Asset 3') return Promise.resolve({ id: 'newA3', headRevisionId: 'newRev1' });
                if (name === 'Asset 4') return Promise.resolve({ id: 'newA4', headRevisionId: 'newRev1' });
                return Promise.reject(new Error(`Unexpected asset: ${name}`));
            },
        );

        (createAssetRevision as any).mockResolvedValue({ id: 'newRev2' });
    };

    // --- Test Groups --------------------------------------------------------

    describe('batch import preparation', () => {
        it('should include contentEncoding in batch items when set on revision', async () => {
            (AssetObjectSchema.safeParse as any).mockReturnValue({
                success: true,
                data: {
                    assets: [
                        { id: 'a1', type: 'model', format: 'glb', contentType: 'model/gltf-binary', name: 'Model 1' },
                    ],
                    revisions: [
                        { id: 'rev1', assetId: 'a1', dataUrl: 'https://example.com/model.glb', contentEncoding: 'gzip' },
                    ],
                    derivatives: [],
                },
            });

            (batchImportAssets as any).mockResolvedValue([
                { referenceId: 'a1:rev1', uploadId: 'upload1', status: 'success' },
            ]);

            (createAsset as any).mockResolvedValue({ id: 'newA1', headRevisionId: 'newRev1' });

            const sceneData = [
                { metadata: { generator: 'AssetSerializer' } },
                { metadata: { generator: 'ModelSerializer' }, modelId: 'a1' },
            ];

            await importAssets(sceneData, { a1: 'rev1' });

            expect(batchImportAssets).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({
                        referenceId: 'a1:rev1',
                        contentEncoding: 'gzip',
                    }),
                ]),
                expect.any(Number),
                expect.any(Function),
                expect.any(Number),
            );
        });

        it('should use revision format and contentType when creating asset', async () => {
            (AssetObjectSchema.safeParse as any).mockReturnValue({
                success: true,
                data: {
                    assets: [
                        { id: 'a1', type: 'model', format: 'glb', contentType: 'model/gltf-binary', name: 'Model 1' },
                    ],
                    revisions: [
                        { id: 'rev1', assetId: 'a1', dataUrl: 'https://example.com/model.usdz', format: 'usdz', contentType: 'model/vnd.usdz+zip' },
                    ],
                    derivatives: [],
                },
            });

            (batchImportAssets as any).mockResolvedValue([
                { referenceId: 'a1:rev1', uploadId: 'upload1', status: 'success' },
            ]);

            (createAsset as any).mockResolvedValue({ id: 'newA1', headRevisionId: 'newRev1' });

            const sceneData = [
                { metadata: { generator: 'AssetSerializer' } },
                { metadata: { generator: 'ModelSerializer' }, modelId: 'a1' },
            ];

            await importAssets(sceneData, { a1: 'rev1' });

            expect(createAsset).toHaveBeenCalledWith(expect.objectContaining({
                format: 'usdz',
                contentType: 'model/vnd.usdz+zip',
            }));
        });

        it('should upload all revisions correctly', async () => {
            setupSuccessParse();
            const { sceneData, sceneDependencies } = makeSceneData();

            await importAssets(sceneData, sceneDependencies);

            // batchImportAssets is called with (items, batchSize, progressCallback, pollConcurrency)
            expect(batchImportAssets).toHaveBeenCalledWith(
                [
                    {
                        referenceId: 'a1:rev1',
                        contentType: 'application/json',
                        dataUrl: 'https://example.com/prefab1',
                    },
                    {
                        referenceId: 'a1:rev2',
                        contentType: 'application/json',
                        dataUrl: 'https://example.com/prefab2',
                    },
                    {
                        referenceId: 'a2:rev1',
                        contentType: 'application/json',
                        dataUrl: 'https://example.com/prefab3',
                    },
                    {
                        referenceId: 'a3:rev1',
                        contentType: 'application/json',
                        dataUrl: 'https://example.com/behavior1',
                    },
                    {
                        referenceId: 'a4:rev1',
                        contentType: 'model/gltf-binary',
                        dataUrl: 'https://example.com/model.glb',
                    },
                ],
                20, // batch size
                expect.any(Function), // progress callback
                5, // poll concurrency
            );
        });
    });

    describe('asset creation & dependency rewriting', () => {
        it('should create assets with correct rewritten dependency metadata', async () => {
            setupSuccessParse();
            const { sceneData, sceneDependencies } = makeSceneData();

            await importAssets(sceneData, sceneDependencies);

            // Order is not guaranteed with parallel processing, so use toHaveBeenCalledWith
            expect(createAsset).toHaveBeenCalledWith({
                type: 'prefab',
                format: 'json',
                contentType: 'application/json',
                name: 'Asset 1',
                uploadId: 'upload1',
                options: { dependencies: {}, metadata: {} },
            });

            expect(createAsset).toHaveBeenCalledWith({
                type: 'behavior',
                format: 'json',
                contentType: 'application/json',
                name: 'Asset 3',
                uploadId: 'upload4',
                options: { dependencies: {}, metadata: {} },
            });

            expect(createAsset).toHaveBeenCalledWith({
                type: 'model',
                format: 'glb',
                contentType: 'model/gltf-binary',
                name: 'Asset 4',
                uploadId: 'upload5',
                options: { dependencies: {}, metadata: {} },
            });

            expect(createAsset).toHaveBeenCalledWith({
                type: 'prefab',
                format: 'json',
                contentType: 'application/json',
                name: 'Asset 2',
                uploadId: 'upload3',
                options: {
                    dependencies: { newA1: 'newRev2' },
                    metadata: { logicalAssetIdMap: { someLogicalId: 'newA1' } },
                },
            });

            expect(createAssetRevision).toHaveBeenCalledWith({
                assetId: 'newA1',
                uploadId: 'upload2',
                format: 'json',
                contentType: 'application/json',
                parentRevisionId: 'newRev1',
                options: { dependencies: {}, metadata: {} },
            });
        });
    });

    describe('model updates', () => {
        it('should rewrite model IDs', async () => {
            setupSuccessParse();
            const { modelObject, sceneData, sceneDependencies } = makeSceneData();

            await importAssets(sceneData, sceneDependencies);

            expect(modelObject.modelId).toBe('newA4');
        });
    });

    describe('prefab updates', () => {
        it('should rewrite basic and nested prefab IDs', async () => {
            setupSuccessParse();
            const { basicPrefab, nestedPrefab, sceneData, sceneDependencies } = makeSceneData();

            await importAssets(sceneData, sceneDependencies);

            expect(basicPrefab.prefabId).toBe('newA1');
            expect(nestedPrefab.prefabId).toBe('newA2');
        });
    });

    describe('Object3D prefab editing updates', () => {
        it('should update prefab ID and edit revision fields', async () => {
            setupSuccessParse();
            const { prefabBeingEdited, sceneData, sceneDependencies } = makeSceneData();

            await importAssets(sceneData, sceneDependencies);

            expect(prefabBeingEdited.userData.prefabId).toBe('newA1');

            expect(prefabBeingEdited.userData.prefabEditRevisionId)
                .toBe('newRev1');
        });
    });

    describe('unlocked prefab with missing edit revision', () => {
        it('should clear prefabId and prefabEditRevisionId when edit revision is not found', async () => {
            setupSuccessParse();
            const { sceneData, sceneDependencies } = makeSceneData();

            // Add an object whose prefabEditRevisionId references a revision
            // that was NOT exported (simulating a pre-fix export).
            const unlockedPrefab = {
                metadata: { generator: 'Object3DSerializer' },
                name: 'UnlockedPrefab',
                userData: {
                    prefabId: 'a1',
                    prefabEditRevisionId: 'rev-not-exported',
                },
            };
            sceneData.push(unlockedPrefab);

            await importAssets(sceneData, sceneDependencies);

            // Both should be deleted so the object is detached from the prefab
            expect(unlockedPrefab.userData).not.toHaveProperty('prefabId');
            expect(unlockedPrefab.userData).not.toHaveProperty('prefabEditRevisionId');
        });
    });

    describe('behavior attribute asset reference updates', () => {
        it('should rewrite behavior IDs', async () => {
            setupSuccessParse();
            const { objectWithBehavior, objectWithLegacyBehavior, sceneData, sceneDependencies } = makeSceneData();

            await importAssets(sceneData, sceneDependencies);

            expect(objectWithBehavior.userData.behaviors[0]!.id).toBe('newA3');

            // Legacy behavior ID should *not* be rewritten
            expect(objectWithLegacyBehavior.userData.behaviors[0]!.id).toBe('user.somebehavior');
        });

        it('should rewrite asset references inside behavior attributes', async () => {
            setupSuccessParse();
            const { objectWithBehavior, objectWithLegacyBehavior, sceneData, sceneDependencies } = makeSceneData();

            await importAssets(sceneData, sceneDependencies);

            expect(
                objectWithBehavior.userData.behaviors[0]!.attributesData.someAssetRef,
            ).toEqual({ assetId: 'newA1', revisionId: 'newRev1' });

            expect(
                objectWithLegacyBehavior.userData.behaviors[0]!.attributesData.someAssetRef,
            ).toEqual({ assetId: 'newA1', revisionId: 'newRev1' });
        });

        it('should rewrite asset references nested inside a group object', async () => {
            setupSuccessParse();
            const objectWithGroupBehavior = {
                metadata: { generator: 'Object3DSerializer' },
                userData: {
                    behaviors: [{
                        id: 'a3',
                        attributesData: {
                            groupAttr: {
                                nestedRef: { assetId: 'a1', revisionId: 'rev1' },
                                otherField: 'hello',
                            },
                        },
                    }],
                },
            };
            const { sceneDependencies, sceneData } = makeSceneData();
            sceneData.push(objectWithGroupBehavior);

            await importAssets(sceneData, sceneDependencies);

            expect(
                objectWithGroupBehavior.userData.behaviors[0]!.attributesData.groupAttr.nestedRef,
            ).toEqual({ assetId: 'newA1', revisionId: 'newRev1' });
            expect(
                objectWithGroupBehavior.userData.behaviors[0]!.attributesData.groupAttr.otherField,
            ).toBe('hello');
        });

        it('should rewrite asset references nested inside an array group', async () => {
            setupSuccessParse();
            const objectWithArrayBehavior = {
                metadata: { generator: 'Object3DSerializer' },
                userData: {
                    behaviors: [{
                        id: 'a3',
                        attributesData: {
                            arrayAttr: [
                                { ref: { assetId: 'a1', revisionId: 'rev1' } },
                                { ref: { assetId: 'a1', revisionId: 'rev1' } },
                            ],
                        },
                    }],
                },
            };
            const { sceneDependencies, sceneData } = makeSceneData();
            sceneData.push(objectWithArrayBehavior);

            await importAssets(sceneData, sceneDependencies);

            const items = objectWithArrayBehavior.userData.behaviors[0]!.attributesData.arrayAttr;
            expect(items[0]!.ref).toEqual({ assetId: 'newA1', revisionId: 'newRev1' });
            expect(items[1]!.ref).toEqual({ assetId: 'newA1', revisionId: 'newRev1' });
        });

        it('should rewrite deeply nested behavior asset references without recursive traversal', async () => {
            setupSuccessParse();
            const {root, leaf} = makeDeepObjectChain();
            leaf.ref = {assetId: 'a1', revisionId: 'rev1'};
            const objectWithDeepBehavior = {
                metadata: { generator: 'Object3DSerializer' },
                userData: {
                    behaviors: [{
                        id: 'a3',
                        attributesData: {
                            deepAttr: root,
                        },
                    }],
                },
            };
            const { sceneDependencies, sceneData } = makeSceneData();
            sceneData.push(objectWithDeepBehavior);

            await importAssets(sceneData, sceneDependencies);

            expect(leaf.ref).toEqual({ assetId: 'newA1', revisionId: 'newRev1' });
        });
    });

    describe('material asset reference updates', () => {
        it('should rewrite deeply nested material asset IDs without recursive traversal', async () => {
            setupSuccessParse();
            const {root, leaf} = makeDeepObjectChain();
            leaf.map = 'a1';
            const objectWithDeepMaterial = {
                metadata: { generator: 'Object3DSerializer' },
                material: root,
            };
            const { sceneDependencies, sceneData } = makeSceneData();
            sceneData.push(objectWithDeepMaterial);

            await importAssets(sceneData, sceneDependencies);

            expect(leaf.map).toBe('newA1');
        });
    });

    describe('asset ID mapping', () => {
        it('should return a mapping of new asset IDs -> new revision IDs', async () => {
            setupSuccessParse();
            const { sceneData, sceneDependencies } = makeSceneData();

            const result = await importAssets(sceneData, sceneDependencies);
            expect(result.dependencies['newA1']).toBe('newRev1');
        });
    });

    describe('missing assets', () => {
        it('should skip revisions referencing unknown assets', async () => {
            (AssetObjectSchema.safeParse as any).mockReturnValue({
                success: true,
                data: {
                    assets: [],
                    revisions: [{ assetId: 'missing', dataUrl: 'https://example.com' }],
                },
            });

            (batchImportAssets as any).mockResolvedValue([]);

            const result = await importAssets([{ metadata: { generator: 'AssetSerializer' } }], {});
            expect(result.dependencies).toEqual({});
        });
    });

    describe('import job order handling', () => {
        it('should match import jobs by referenceId when server returns jobs in different order', async () => {
            // Set up three assets with no dependencies
            (AssetObjectSchema.safeParse as any).mockReturnValue({
                success: true,
                data: {
                    assets: [
                        { id: 'a1', type: 'model', format: 'glb', contentType: 'model/gltf-binary', name: 'Model 1' },
                        { id: 'a2', type: 'model', format: 'glb', contentType: 'model/gltf-binary', name: 'Model 2' },
                        { id: 'a3', type: 'model', format: 'glb', contentType: 'model/gltf-binary', name: 'Model 3' },
                    ],
                    revisions: [
                        { id: 'rev1', assetId: 'a1', dataUrl: 'https://example.com/model1.glb' },
                        { id: 'rev1', assetId: 'a2', dataUrl: 'https://example.com/model2.glb' },
                        { id: 'rev1', assetId: 'a3', dataUrl: 'https://example.com/model3.glb' },
                    ],
                    derivatives: [],
                },
            });

            // Return import jobs in REVERSED order (simulating server returning in different order)
            (batchImportAssets as any).mockResolvedValue([
                { referenceId: 'a3:rev1', uploadId: 'upload-for-a3', status: 'success' },
                { referenceId: 'a2:rev1', uploadId: 'upload-for-a2', status: 'success' },
                { referenceId: 'a1:rev1', uploadId: 'upload-for-a1', status: 'success' },
            ]);

            // Use argument-matching mock since parallel processing doesn't guarantee order
            (createAsset as any).mockImplementation(
                ({name}: {name: string}) => {
                    if (name === 'Model 1') return Promise.resolve({ id: 'newA1', headRevisionId: 'newRev1' });
                    if (name === 'Model 2') return Promise.resolve({ id: 'newA2', headRevisionId: 'newRev1' });
                    if (name === 'Model 3') return Promise.resolve({ id: 'newA3', headRevisionId: 'newRev1' });
                    return Promise.reject(new Error(`Unexpected asset: ${name}`));
                },
            );

            const sceneData = [
                { metadata: { generator: 'AssetSerializer' } },
                { metadata: { generator: 'ModelSerializer' }, modelId: 'a1' },
                { metadata: { generator: 'ModelSerializer' }, modelId: 'a2' },
                { metadata: { generator: 'ModelSerializer' }, modelId: 'a3' },
            ];

            await importAssets(sceneData, { a1: 'rev1', a2: 'rev1', a3: 'rev1' });

            // Verify each asset was created with the CORRECT uploadId (matched by referenceId)
            // Despite the server returning jobs in reversed order, a1 should use upload-for-a1, etc.
            expect(createAsset).toHaveBeenCalledWith(expect.objectContaining({
                type: 'model',
                format: 'glb',
                contentType: 'model/gltf-binary',
                name: 'Model 1',
                uploadId: 'upload-for-a1',  // NOT upload-for-a3 (which would be index 0)
            }));

            expect(createAsset).toHaveBeenCalledWith(expect.objectContaining({
                type: 'model',
                format: 'glb',
                contentType: 'model/gltf-binary',
                name: 'Model 2',
                uploadId: 'upload-for-a2',
            }));

            expect(createAsset).toHaveBeenCalledWith(expect.objectContaining({
                type: 'model',
                format: 'glb',
                contentType: 'model/gltf-binary',
                name: 'Model 3',
                uploadId: 'upload-for-a3',
            }));
        });

        it('should throw error when import job is missing for a referenceId', async () => {
            (AssetObjectSchema.safeParse as any).mockReturnValue({
                success: true,
                data: {
                    assets: [
                        { id: 'a1', type: 'model', format: 'glb', contentType: 'model/gltf-binary', name: 'Model 1' },
                        { id: 'a2', type: 'model', format: 'glb', contentType: 'model/gltf-binary', name: 'Model 2' },
                    ],
                    revisions: [
                        { id: 'rev1', assetId: 'a1', dataUrl: 'https://example.com/model1.glb' },
                        { id: 'rev1', assetId: 'a2', dataUrl: 'https://example.com/model2.glb' },
                    ],
                    derivatives: [],
                },
            });

            // Only return job for a1, missing job for a2
            (batchImportAssets as any).mockResolvedValue([
                { referenceId: 'a1:rev1', uploadId: 'upload-for-a1', status: 'success' },
                // a2:rev1 is missing from the response
            ]);

            (createAsset as any).mockResolvedValueOnce({ id: 'newA1', headRevisionId: 'newRev1' });

            const sceneData = [
                { metadata: { generator: 'AssetSerializer' } },
            ];

            // Should throw error when asset import fails (fail-fast behavior)
            await expect(importAssets(sceneData, { a1: 'rev1', a2: 'rev1' }))
                .rejects.toThrow('Failed to import asset "Model 2"');
        });
    });

    describe('revision creation error handling', () => {
        it('should use head revision ID when createAssetRevision returns 400 "no changes"', async () => {
            // Set up a single asset with two revisions
            (AssetObjectSchema.safeParse as any).mockReturnValue({
                success: true,
                data: {
                    assets: [
                        { id: 'a1', type: 'prefab', format: 'json', contentType: 'application/json', name: 'Asset 1' },
                    ],
                    revisions: [
                        { id: 'rev1', assetId: 'a1', dataUrl: 'https://example.com/prefab1' },
                        { id: 'rev2', assetId: 'a1', dataUrl: 'https://example.com/prefab2' },
                    ],
                    derivatives: [],
                },
            });

            (batchImportAssets as any).mockResolvedValue([
                { referenceId: 'a1:rev1', uploadId: 'upload1', status: 'success' },
                { referenceId: 'a1:rev2', uploadId: 'upload2', status: 'success' },
            ]);

            // First call creates the asset
            (createAsset as any).mockResolvedValueOnce({ id: 'newA1', headRevisionId: 'newRev1' });

            // Second call (createAssetRevision) fails with 400 "no changes"
            (createAssetRevision as any).mockRejectedValueOnce(
                createAxiosError(400, { msg: 'No changes.' }),
            );

            const sceneData = [
                { metadata: { generator: 'AssetSerializer' } },
                {
                    metadata: { generator: 'PrefabSerializer' },
                    prefabId: 'a1',
                },
            ];

            const result = await importAssets(sceneData, { a1: 'rev2' });

            // Should succeed without throwing
            expect(result.dependencies['newA1']).toBe('newRev1'); // Uses parent revision ID
        });

        it('should throw when createAssetRevision returns non-400 error', { timeout: 15000 }, async () => {
            (AssetObjectSchema.safeParse as any).mockReturnValue({
                success: true,
                data: {
                    assets: [
                        { id: 'a1', type: 'prefab', format: 'json', contentType: 'application/json', name: 'Asset 1' },
                    ],
                    revisions: [
                        { id: 'rev1', assetId: 'a1', dataUrl: 'https://example.com/prefab1' },
                        { id: 'rev2', assetId: 'a1', dataUrl: 'https://example.com/prefab2' },
                    ],
                },
            });

            (batchImportAssets as any).mockResolvedValue([
                { referenceId: 'a1:rev1', uploadId: 'upload1', status: 'success' },
                { referenceId: 'a1:rev2', uploadId: 'upload2', status: 'success' },
            ]);

            (createAsset as any).mockResolvedValueOnce({ id: 'newA1', headRevisionId: 'newRev1' });

            // Throw a 500 error (use mockRejectedValue to reject all retries)
            (createAssetRevision as any).mockRejectedValue(
                createAxiosError(500, { msg: 'Internal server error' }),
            );

            const sceneData = [
                { metadata: { generator: 'AssetSerializer' } },
            ];

            await expect(importAssets(sceneData, {})).rejects.toThrow('Request failed with status code 500');
        });

        it('should throw when createAssetRevision returns 400 without "no changes" in body', async () => {
            (AssetObjectSchema.safeParse as any).mockReturnValue({
                success: true,
                data: {
                    assets: [
                        { id: 'a1', type: 'prefab', format: 'json', contentType: 'application/json', name: 'Asset 1' },
                    ],
                    revisions: [
                        { id: 'rev1', assetId: 'a1', dataUrl: 'https://example.com/prefab1' },
                        { id: 'rev2', assetId: 'a1', dataUrl: 'https://example.com/prefab2' },
                    ],
                },
            });

            (batchImportAssets as any).mockResolvedValue([
                { referenceId: 'a1:rev1', uploadId: 'upload1', status: 'success' },
                { referenceId: 'a1:rev2', uploadId: 'upload2', status: 'success' },
            ]);

            (createAsset as any).mockResolvedValueOnce({ id: 'newA1', headRevisionId: 'newRev1' });

            // Throw 400 but with different error message (use mockRejectedValue to reject all retries)
            (createAssetRevision as any).mockRejectedValue(
                createAxiosError(400, { msg: 'Invalid revision data' }),
            );

            const sceneData = [
                { metadata: { generator: 'AssetSerializer' } },
            ];

            await expect(importAssets(sceneData, {})).rejects.toThrow('Request failed with status code 400');
        });
    });
});

// --- Helper Function Unit Tests ---------------------------------------------

describe('buildImportItems', () => {
    it('should create import items from assets and revisions', () => {
        const assets: SerializedAsset[] = [
            { id: 'a1', type: 'prefab', format: 'json', contentType: 'application/json', name: 'Asset 1' },
            { id: 'a2', type: 'model', format: 'glb', contentType: 'model/gltf-binary', name: 'Asset 2' },
        ];
        const revisions: SerializedRevision[] = [
            { id: 'rev1', assetId: 'a1', dataUrl: 'https://example.com/prefab1' },
            { id: 'rev1', assetId: 'a2', dataUrl: 'https://example.com/model.glb', dependencies: { a1: 'rev1' } },
        ];

        const result = buildImportItems(assets, revisions);

        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({
            assetId: 'a1',
            revisionId: 'rev1',
            assetRefKey: 'a1:rev1',
            type: 'prefab',
            name: 'Asset 1',
        });
        expect(result[1]).toMatchObject({
            assetId: 'a2',
            revisionId: 'rev1',
            assetRefKey: 'a2:rev1',
            dependencies: { a1: 'rev1' },
        });
    });

    it('should skip revisions with missing assets', () => {
        const assets: SerializedAsset[] = [
            { id: 'a1', type: 'prefab', format: 'json', contentType: 'application/json', name: 'Asset 1' },
        ];
        const revisions: SerializedRevision[] = [
            { id: 'rev1', assetId: 'a1', dataUrl: 'https://example.com/prefab1' },
            { id: 'rev1', assetId: 'missing', dataUrl: 'https://example.com/missing' },
        ];

        const result = buildImportItems(assets, revisions);

        expect(result).toHaveLength(1);
        expect(result[0]!.assetId).toBe('a1');
    });

    it('should handle empty inputs', () => {
        expect(buildImportItems([], [])).toEqual([]);
    });

    it('should carry contentEncoding from revision when set', () => {
        const assets: SerializedAsset[] = [
            { id: 'a1', type: 'model', format: 'glb', contentType: 'model/gltf-binary', name: 'Asset 1' },
        ];
        const revisions: SerializedRevision[] = [
            { id: 'rev1', assetId: 'a1', dataUrl: 'https://example.com/model.glb', contentEncoding: 'gzip' },
        ];

        const result = buildImportItems(assets, revisions);

        expect(result[0]!.contentEncoding).toBe('gzip');
    });

    it('should leave contentEncoding undefined when not set on revision', () => {
        const assets: SerializedAsset[] = [
            { id: 'a1', type: 'model', format: 'glb', contentType: 'model/gltf-binary', name: 'Asset 1' },
        ];
        const revisions: SerializedRevision[] = [
            { id: 'rev1', assetId: 'a1', dataUrl: 'https://example.com/model.glb' },
        ];

        const result = buildImportItems(assets, revisions);

        expect(result[0]!.contentEncoding).toBeUndefined();
    });

    it('should use revision format and contentType when they differ from the asset', () => {
        const assets: SerializedAsset[] = [
            { id: 'a1', type: 'model', format: 'glb', contentType: 'model/gltf-binary', name: 'Asset 1' },
        ];
        const revisions: SerializedRevision[] = [
            { id: 'rev1', assetId: 'a1', dataUrl: 'https://example.com/model.usdz', format: 'usdz', contentType: 'model/vnd.usdz+zip' },
        ];

        const result = buildImportItems(assets, revisions);

        expect(result[0]!.format).toBe('usdz');
        expect(result[0]!.contentType).toBe('model/vnd.usdz+zip');
    });

    it('should fall back to asset format and contentType when not set on revision', () => {
        const assets: SerializedAsset[] = [
            { id: 'a1', type: 'model', format: 'glb', contentType: 'model/gltf-binary', name: 'Asset 1' },
        ];
        const revisions: SerializedRevision[] = [
            { id: 'rev1', assetId: 'a1', dataUrl: 'https://example.com/model.glb' },
        ];

        const result = buildImportItems(assets, revisions);

        expect(result[0]!.format).toBe('glb');
        expect(result[0]!.contentType).toBe('model/gltf-binary');
    });
});

describe('buildDependencyLevels', () => {
    it('should group items with no dependencies in level 0', () => {
        const items: ImportItem[] = [
            { assetId: 'a1', revisionId: 'rev1', assetRefKey: 'a1:rev1', type: 'prefab', format: 'json', contentType: 'application/json', name: 'A1', description: undefined, dataUrl: '', dependencies: undefined, metadata: undefined, contentEncoding: undefined },
            { assetId: 'a2', revisionId: 'rev1', assetRefKey: 'a2:rev1', type: 'prefab', format: 'json', contentType: 'application/json', name: 'A2', description: undefined, dataUrl: '', dependencies: undefined, metadata: undefined, contentEncoding: undefined },
        ];

        const levels = buildDependencyLevels(items);

        expect(levels).toHaveLength(1);
        expect(levels[0]).toEqual(expect.arrayContaining([0, 1]));
    });

    it('should place dependent items in later levels', () => {
        const items: ImportItem[] = [
            { assetId: 'a1', revisionId: 'rev1', assetRefKey: 'a1:rev1', type: 'prefab', format: 'json', contentType: 'application/json', name: 'A1', description: undefined, dataUrl: '', dependencies: undefined, metadata: undefined, contentEncoding: undefined },
            { assetId: 'a2', revisionId: 'rev1', assetRefKey: 'a2:rev1', type: 'prefab', format: 'json', contentType: 'application/json', name: 'A2', description: undefined, dataUrl: '', dependencies: { a1: 'rev1' }, metadata: undefined, contentEncoding: undefined },
        ];

        const levels = buildDependencyLevels(items);

        expect(levels).toHaveLength(2);
        expect(levels[0]).toContain(0); // a1 has no deps
        expect(levels[1]).toContain(1); // a2 depends on a1
    });

    it('should add implicit dependencies for same-asset revisions', () => {
        const items: ImportItem[] = [
            { assetId: 'a1', revisionId: 'rev1', assetRefKey: 'a1:rev1', type: 'prefab', format: 'json', contentType: 'application/json', name: 'A1', description: undefined, dataUrl: '', dependencies: undefined, metadata: undefined, contentEncoding: undefined },
            { assetId: 'a1', revisionId: 'rev2', assetRefKey: 'a1:rev2', type: 'prefab', format: 'json', contentType: 'application/json', name: 'A1', description: undefined, dataUrl: '', dependencies: undefined, metadata: undefined, contentEncoding: undefined },
        ];

        const levels = buildDependencyLevels(items);

        // rev2 should be in a later level than rev1 due to implicit dependency
        expect(levels).toHaveLength(2);
        expect(levels[0]).toContain(0);
        expect(levels[1]).toContain(1);
    });
});

describe('validateImportJob', () => {
    const baseImportItem: ImportItem = {
        assetId: 'a1',
        revisionId: 'rev1',
        assetRefKey: 'a1:rev1',
        type: 'prefab',
        format: 'json',
        contentType: 'application/json',
        name: 'Test Asset',
        description: undefined,
        dataUrl: 'https://example.com/asset',
        dependencies: undefined,
        metadata: undefined,
        contentEncoding: undefined,
    };

    it('should return null for successful import job', () => {
        const result = validateImportJob(baseImportItem, {
            status: 'success',
            uploadId: 'upload123',
        });

        expect(result).toBeNull();
    });

    it('should return error message when import job is missing', () => {
        const result = validateImportJob(baseImportItem, undefined);

        expect(result).toContain('Failed to import asset "Test Asset"');
        expect(result).toContain('No import job was created');
    });

    it('should return error message when status is failed', () => {
        const result = validateImportJob(baseImportItem, {
            status: 'failed',
            uploadId: undefined,
        });

        expect(result).toContain('Status: failed');
        expect(result).toContain('server failed to download');
        expect(result).toContain('source project cannot be resolved');
        expect(result).toContain('Hint: Export the stem from the source environment');
    });

    it('should return generic failed message for non-stem assets', () => {
        const result = validateImportJob({...baseImportItem, type: 'model'}, {
            status: 'failed',
            uploadId: undefined,
        });

        expect(result).toContain('The server failed to download or process the asset.');
        expect(result).not.toContain('target environment');
        expect(result).not.toContain('Hint: Export the stem from the source environment');
    });

    it('should return error message when uploadId is missing', () => {
        const result = validateImportJob(baseImportItem, {
            status: 'success',
            uploadId: undefined,
        });

        expect(result).toContain('no upload ID was returned');
    });

    it('should truncate long URLs in error messages', () => {
        const itemWithLongUrl = {
            ...baseImportItem,
            dataUrl: 'https://example.com/' + 'a'.repeat(200),
        };

        const result = validateImportJob(itemWithLongUrl, undefined);

        expect(result).toContain('...');
        expect(result!.length).toBeLessThan(itemWithLongUrl.dataUrl.length + 200);
    });
});

describe('mapDependenciesToNewIds', () => {
    it('should map old dependency IDs to new IDs', () => {
        const dependencies = { oldAsset1: 'oldRev1', oldAsset2: 'oldRev2' };
        const assetIdMap = new Map([['oldAsset1', 'newAsset1'], ['oldAsset2', 'newAsset2']]);
        const assetRevisionIdMap = new Map([
            ['oldAsset1:oldRev1', 'newRev1'],
            ['oldAsset2:oldRev2', 'newRev2'],
        ]);

        const result = mapDependenciesToNewIds(dependencies, assetIdMap, assetRevisionIdMap);

        expect(result).toEqual({
            newAsset1: 'newRev1',
            newAsset2: 'newRev2',
        });
    });

    it('should skip dependencies with unmapped asset IDs', () => {
        const dependencies = { oldAsset1: 'oldRev1', missingAsset: 'rev1' };
        const assetIdMap = new Map([['oldAsset1', 'newAsset1']]);
        const assetRevisionIdMap = new Map([['oldAsset1:oldRev1', 'newRev1']]);

        const result = mapDependenciesToNewIds(dependencies, assetIdMap, assetRevisionIdMap);

        expect(result).toEqual({ newAsset1: 'newRev1' });
    });

    it('should skip dependencies with unmapped revision IDs', () => {
        const dependencies = { oldAsset1: 'oldRev1' };
        const assetIdMap = new Map([['oldAsset1', 'newAsset1']]);
        const assetRevisionIdMap = new Map<string, string>(); // Empty

        const result = mapDependenciesToNewIds(dependencies, assetIdMap, assetRevisionIdMap);

        expect(result).toEqual({});
    });

    it('should handle undefined dependencies', () => {
        const result = mapDependenciesToNewIds(undefined, new Map(), new Map());
        expect(result).toEqual({});
    });
});

describe('remapMetadataAssetIds', () => {
    it('should remap logicalAssetIdMap asset IDs', () => {
        const metadata = {
            logicalAssetIdMap: { someLogicalId: 'oldAsset1', anotherLogicalId: 'oldAsset2' },
            otherData: 'preserved',
        };
        const assetIdMap = new Map([['oldAsset1', 'newAsset1'], ['oldAsset2', 'newAsset2']]);

        const result = remapMetadataAssetIds(metadata, assetIdMap);

        expect(result).toEqual({
            logicalAssetIdMap: { someLogicalId: 'newAsset1', anotherLogicalId: 'newAsset2' },
            otherData: 'preserved',
        });
    });

    it('should skip unmapped asset IDs in logicalAssetIdMap', () => {
        const metadata = {
            logicalAssetIdMap: { someLogicalId: 'oldAsset1', missingLogicalId: 'missingAsset' },
        };
        const assetIdMap = new Map([['oldAsset1', 'newAsset1']]);

        const result = remapMetadataAssetIds(metadata, assetIdMap);

        expect(result.logicalAssetIdMap).toEqual({ someLogicalId: 'newAsset1' });
    });

    it('should handle metadata without logicalAssetIdMap', () => {
        const metadata = { someOtherField: 'value' };

        const result = remapMetadataAssetIds(metadata, new Map());

        expect(result).toEqual({ someOtherField: 'value' });
    });

    it('should handle undefined metadata', () => {
        const result = remapMetadataAssetIds(undefined, new Map());
        expect(result).toEqual({});
    });
});

describe('buildNewDependencies', () => {
    it('should map old dependencies to new IDs', () => {
        const dependencies = { oldAsset1: 'oldRev1', oldAsset2: 'oldRev2' };
        const assetIdMap = new Map([['oldAsset1', 'newAsset1'], ['oldAsset2', 'newAsset2']]);
        const assetRevisionIdMap = new Map([
            ['oldAsset1:oldRev1', 'newRev1'],
            ['oldAsset2:oldRev2', 'newRev2'],
        ]);

        const result = buildNewDependencies(dependencies, assetIdMap, assetRevisionIdMap);

        expect(result).toEqual({
            newAsset1: 'newRev1',
            newAsset2: 'newRev2',
        });
    });

    it('should skip unmappable dependencies', () => {
        const dependencies = { oldAsset1: 'oldRev1', missingAsset: 'rev1' };
        const assetIdMap = new Map([['oldAsset1', 'newAsset1']]);
        const assetRevisionIdMap = new Map([['oldAsset1:oldRev1', 'newRev1']]);

        const result = buildNewDependencies(dependencies, assetIdMap, assetRevisionIdMap);

        expect(result).toEqual({ newAsset1: 'newRev1' });
    });
});

describe('groupIndicesByDependencyLevel', () => {
    it('should group all items in level 0 when no dependencies', () => {
        const items = ['a', 'b', 'c'];
        const levels = groupIndicesByDependencyLevel(
            items,
            item => item,
            () => [],
        );

        expect(levels).toHaveLength(1);
        expect(levels[0]).toEqual(expect.arrayContaining([0, 1, 2]));
    });

    it('should create multiple levels for dependent items', () => {
        const items = [
            { id: 'a', deps: [] },
            { id: 'b', deps: ['a'] },
            { id: 'c', deps: ['b'] },
        ];
        const levels = groupIndicesByDependencyLevel(
            items,
            item => item.id,
            item => item.deps,
        );

        expect(levels).toHaveLength(3);
        expect(levels[0]).toEqual([0]); // 'a'
        expect(levels[1]).toEqual([1]); // 'b'
        expect(levels[2]).toEqual([2]); // 'c'
    });

    it('should group independent items at the same level', () => {
        const items = [
            { id: 'a', deps: [] },
            { id: 'b', deps: [] },
            { id: 'c', deps: ['a', 'b'] },
        ];
        const levels = groupIndicesByDependencyLevel(
            items,
            item => item.id,
            item => item.deps,
        );

        expect(levels).toHaveLength(2);
        expect(levels[0]).toEqual(expect.arrayContaining([0, 1]));
        expect(levels[1]).toEqual([2]);
    });

    it('should throw error for missing dependency', () => {
        const items = [{ id: 'a', deps: ['missing'] }];

        expect(() => groupIndicesByDependencyLevel(
            items,
            item => item.id,
            item => item.deps,
        )).toThrow('Missing dependency missing');
    });

    it('should throw error for cyclic dependency', () => {
        const items = [
            { id: 'a', deps: ['b'] },
            { id: 'b', deps: ['a'] },
        ];

        expect(() => groupIndicesByDependencyLevel(
            items,
            item => item.id,
            item => item.deps,
        )).toThrow('Cycle detected');
    });

    it('should handle empty input', () => {
        const levels = groupIndicesByDependencyLevel(
            [],
            (item: string) => item,
            () => [],
        );

        expect(levels).toEqual([]);
    });
});

describe('processWithConcurrency', () => {
    it('should stop scheduling new work after first error in failFast mode', async () => {
        const started: number[] = [];
        const completed: number[] = [];
        const blockedResolvers: Array<() => void> = [];
        const items = [0, 1, 2, 3, 4];

        const promise = processWithConcurrency(
            items,
            async (item) => {
                started.push(item);

                if (item === 0) {
                    throw new Error('boom');
                }

                await new Promise<void>(resolve => {
                    blockedResolvers.push(() => {
                        completed.push(item);
                        resolve();
                    });
                });

                return item;
            },
            3,
            { failFast: true },
        );

        // Allow in-flight workers to finish.
        blockedResolvers.forEach(resolve => resolve());

        await expect(promise).rejects.toThrow('boom');
        // With concurrency=3, only first wave should have started before fail-fast stop.
        expect(started.length).toBeLessThanOrEqual(3);
        expect(started).not.toContain(4);
        expect(completed.length).toBeLessThanOrEqual(2);
    });

    it('should process all items when failFast is disabled', async () => {
        const items = [1, 2, 3, 4];
        const processed: number[] = [];

        const result = await processWithConcurrency(
            items,
            (item) => {
                processed.push(item);
                return Promise.resolve(item * 2);
            },
            2,
            { failFast: false },
        );

        expect(processed).toHaveLength(items.length);
        expect(result).toEqual([2, 4, 6, 8]);
    });
});
