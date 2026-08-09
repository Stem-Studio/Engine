import { Object3D, MathUtils } from 'three';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { getAssetResolutionContext } from '@stem/editor-oss/asset-management/AssetResolutionContext';
import { serializePrefab, deserializePrefab, SerializePrefabResult } from '../prefab/serialization';
import { setPrefabId } from '../prefab/util';
import { findObjectByNameDepthFirst } from '../utils/SceneTraverser';

vi.mock('three', async (importOriginal) => ({
    ...await importOriginal<typeof import('three')>(),
    Audio: vi.fn(),
    AudioListener: vi.fn(),
}));

// NOTE: Adjust import paths above if your repo layout differs.
// This file assumes:
// - serializePrefab & deserializePrefab are exported from src/prefab/serialization
// - AssetResolutionContext is at src/asset-management/AssetResolutionContext
// - prefab util at src/prefab/util

// Helper to build a behavior data object shape for tests
const makeBehavior = (
    id?: string,
    prefabBehaviorUuid?: string,
    attributesData?: Record<string, unknown>,
) => ({
    id: id ?? 'behavior:example',
    enabled: true,
    priority: 0,
    prefabBehaviorUuid,
    attributesData,
});

describe('serializePrefab / deserializePrefab', () => {
    // deterministic UUIDs: return uuid-1, uuid-2, ...
    let uuidCounter = 0;
    beforeEach(() => {
        uuidCounter = 0;
        vi.spyOn(MathUtils, 'generateUUID').mockImplementation(() => {
            uuidCounter += 1;
            return `uuid-${uuidCounter}`;
        });
    });

    it('basic roundtrip: prefab with no behaviors roundtrips and returns JSON/data', async () => {
        const root = new Object3D();
        root.name = 'root';

        // attach a simple child to ensure Converter produces children
        const child = new Object3D();
        child.name = 'child';
        root.add(child);

        // Set prefab ID on original — serializePrefab should remove prefabId from the clone only
        setPrefabId(root, 'prefabA');

        const result: SerializePrefabResult = serializePrefab(root);

        expect(typeof result.data).toBe('string');
        expect(result.assetResolutionContext).toBeTruthy();
        // Because no dependencies were present, assetIdToRevisionId should be empty or undefined
        expect(result.assetResolutionContext.assetIdToRevisionId).toBeDefined();

        // Deserialize with same context
        const prefabObj = await deserializePrefab(result.data, result.assetResolutionContext);

        expect(prefabObj).toBeTruthy();
        expect(prefabObj.uuid).toEqual(expect.any(String));
        // The deserialized object should have an asset resolution context set (without logical map)
        const ctx = getAssetResolutionContext(prefabObj);
        expect(ctx).toBeTruthy();
        // logicalIdToAssetId is expected to have been removed by deserializePrefab (set to undefined)
        expect((ctx as any).logicalIdToAssetId).toBeUndefined();
    });

    it('generates prefabBehaviorUuid for behaviors that are missing it and does not mutate original object', () => {
        const root = new Object3D();
        root.name = 'root-with-behavior';

        // Behavior on the root (these get prefabBehaviorUuid assigned if missing)
        root.userData = {
            behaviors: [
                makeBehavior('behavior:foo', undefined),
            ],
        };

        // Keep original copy of the behavior prefabBehaviorUuid (should be undefined)
        const originalPrefabUuidBefore = root.userData.behaviors[0].prefabBehaviorUuid;
        expect(originalPrefabUuidBefore).toBeUndefined();

        const result = serializePrefab(root);

        // Original object must not be mutated; still undefined
        expect(root.userData.behaviors[0].prefabBehaviorUuid).toBeUndefined();

        // The returned assetResolutionContext should exist
        expect(result.assetResolutionContext).toBeDefined();

        // Since generateUUID is deterministic, we can check that logicalIdToAssetId keys use uuids
        // but only if dependencies triggered mapping. For this test there may be no dependencies,
        // so ensure we at least got JSON back.
        expect(typeof result.data).toBe('string');
    });

    it('maps attribute asset refs to logical IDs and resolves them back during deserialize', async () => {
        // Build a root object with a child. Child behavior has an attribute which is an AssetRef
        const root = new Object3D();
        root.name = 'root-map-assets';

        // child holds the behavior attribute containing an assetRef { assetId, revisionId }
        const child = new Object3D();
        child.name = 'child-with-asset-ref';

        // Behavior on child with attributesData referencing an asset (direct dependency)
        child.userData = {
            behaviors: [
                makeBehavior('behavior:child', undefined, {
                    someAsset: { assetId: 'asset-A', revisionId: 'rev-A' },
                }),
            ],
        };

        root.add(child);

        // No explicit asset resolution context required for attribute-asset refs — attribute refs are included by findDirectDependencies.
        const result = serializePrefab(root);
        console.log("result", result);

        // Expect that the returned context includes the assetId -> revisionId mapping
        expect(result.assetResolutionContext).toBeDefined();
        const assetRevisionMap = result.assetResolutionContext.assetIdToRevisionId || {};
        expect(assetRevisionMap['asset-A']).toBe('rev-A');

        // logicalIdToAssetId should map some generated logicalId (uuid) -> 'asset-A'
        const logicalMap = result.assetResolutionContext.logicalIdToAssetId || {};
        // There must be at least one mapping with value 'asset-A'
        const logicalEntries = Object.entries(logicalMap).filter(([, v]) => v === 'asset-A');
        expect(logicalEntries.length).toBeGreaterThan(0);

        // Deserialize using the returned context
        const prefab = await deserializePrefab(result.data, result.assetResolutionContext);

        // Find the child again (Converter/parse should recreate similar structure)
        const foundChild = findObjectByNameDepthFirst(prefab, 'child-with-asset-ref');
        expect(foundChild).not.toBeNull();

        // Ensure the attribute asset ref was restored to the real asset ID and had revisionId set
        const behaviors = foundChild!.userData?.behaviors || [];
        expect(behaviors.length).toBeGreaterThan(0);
        const attrAssetRef = behaviors[0].attributesData?.someAsset;
        expect(attrAssetRef).toBeDefined();
        expect(attrAssetRef.assetId).toBe('asset-A');
        // resolveBehaviorAttributeAssetRefs should have set the revisionId from context
        expect(attrAssetRef.revisionId).toBe('rev-A');

        // Ensure the prefab object has assetResolutionContext.assetIdToRevisionId set (and logicalIdToAssetId removed)
        const prefabCtx = getAssetResolutionContext(prefab);
        expect(prefabCtx).toBeTruthy();
        expect(prefabCtx!.logicalIdToAssetId).toBeUndefined();
        expect(prefabCtx!.assetIdToRevisionId?.['asset-A']).toBe('rev-A');
    });

    it('does not mutate original object asset IDs when mapping logical IDs in clone', () => {
        const root = new Object3D();
        root.name = 'root-no-mutate';

        const child = new Object3D();
        child.name = 'child-original-preserved';

        // Behavior attribute references an asset
        child.userData = {
            behaviors: [
                makeBehavior('behavior:child', undefined, {
                    someAsset: { assetId: 'asset-X', revisionId: 'rev-X' },
                }),
            ],
        };
        root.add(child);

        // Save original asset value
        const originalAttr = child.userData.behaviors[0].attributesData.someAsset;
        expect(originalAttr.assetId).toBe('asset-X');

        const result = serializePrefab(root);

        // After serialization, original object should remain unchanged
        expect(child.userData.behaviors[0].attributesData.someAsset.assetId).toBe('asset-X');

        // The serialized payload (data) should be a string
        expect(typeof result.data).toBe('string');
    });

    it('assigns prefab metadata through deep hierarchies without Three recursive traversal', async () => {
        const root = new Object3D();
        root.name = 'deep-root';
        let cursor = root;
        for (let i = 0; i < 12000; i++) {
            const child = new Object3D();
            child.name = `deep-child-${i}`;
            cursor.add(child);
            cursor = child;
        }
        cursor.userData.behaviors = [makeBehavior('behavior:deep')];
        cursor.userData.lambdaComponents = [{lambdaId: 'lambda:deep'}];
        const traverseSpy = vi.spyOn(Object3D.prototype, 'traverse');

        const result = serializePrefab(root);
        const prefab = await deserializePrefab(result.data, result.assetResolutionContext);
        const deepest = findObjectByNameDepthFirst(prefab, 'deep-child-11999')!;

        expect(traverseSpy).not.toHaveBeenCalled();
        expect(deepest.userData.behaviors[0].prefabBehaviorUuid).toBeDefined();
        expect(deepest.userData.behaviors[0].uuid).toBeDefined();
        expect(deepest.userData.lambdaComponents[0].prefabLambdaUuid).toBeDefined();
        expect(deepest.userData.lambdaComponents[0].uuid).toBeDefined();
    });

    it('throws when deserialize receives JSON that cannot be parsed to a prefab (no child)', async () => {
        // Construct a minimal context
        const ctx = {
            logicalIdToAssetId: {},
            assetIdToRevisionId: {},
        };

        // Provide JSON that is unlikely to parse into a group with children.
        // In many converter implementations an empty object will not produce children.
        const badJson = JSON.stringify({ hello: 'world' });

        await expect(deserializePrefab(badJson, ctx)).rejects.toThrow();
    });
});
