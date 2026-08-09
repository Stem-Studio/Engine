import { Object3D, Vector3 } from 'three';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PrefabSerializer } from './PrefabSerializer';
import { AssetResolutionContext, setAssetResolutionContext } from '@stem/editor-oss/asset-management/AssetResolutionContext';
import BehaviorData from '@stem/editor-oss/behaviors/BehaviorData';
import { loadPrefab, setPrefabId, unlockPrefab } from '@stem/editor-oss/prefab/util';

vi.mock('three', async (importOriginal) => ({
    ...await importOriginal<typeof import('three')>(),
    Audio: vi.fn(),
    AudioListener: vi.fn(),
}));

// PrefabSerializer.ts imports `loadPrefab` directly from
// `@stem/editor-oss/prefab/util`, so mocking that path routes the call to a
// shared `vi.fn()` the test body controls via `mockResolvedValue`. The fn is
// created through `vi.hoisted` so it exists before the hoisted `vi.mock`
// factory runs.
const {sharedLoadPrefab} = vi.hoisted(() => ({sharedLoadPrefab: vi.fn()}));
vi.mock('@stem/editor-oss/prefab/util', async (importOriginal) => ({
    ...await importOriginal<typeof import('@stem/editor-oss/prefab/util')>(),
    loadPrefab: sharedLoadPrefab,
}));

describe('PrefabSerializer', () => {
    let serializer: PrefabSerializer;
    let context: AssetResolutionContext;

    beforeEach(() => {
        serializer = new PrefabSerializer();
        context = {
            logicalIdToAssetId: {},
            assetIdToRevisionId: {},
        };
        vi.clearAllMocks();
    });

    it('should serialize a simple Object3D to JSON', () => {
        const obj = new Object3D();
        obj.name = 'MyObject';
        obj.position.set(1, 2, 3);
        obj.quaternion.set(0, 0, 0, 1);
        obj.scale.set(1, 1, 1);
        obj.visible = true;
        obj.castShadow = false;
        obj.receiveShadow = true;

        const behavior: BehaviorData = {
            id: 'b1',
            uuid: 'uuid-b1',
            enabled: true,
            priority: 0,
        };

        obj.userData = {
            behaviors: [behavior],
            someOtherProp: 123,
        };
        
        setPrefabId(obj, 'prefab-123');

        const json = serializer.toJSON(obj);

        expect(json).toEqual({
            metadata: {
                generator: 'PrefabSerializer',
            },
            prefabId: 'prefab-123',
            uuid: obj.uuid,
            name: 'MyObject',
            parent: undefined,
            position: { x: 1, y: 2, z: 3 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
            visible: true,
            castShadow: false,
            receiveShadow: true,
            userData: {
                behaviors: [behavior],
                someOtherProp: 123,
            },
        });
    });

    it('should throw error when serializing non-prefab Object3D', () => {
        const obj = new Object3D();
        obj.userData = {}; // No prefabId

        expect(() => serializer.toJSON(obj)).toThrow("Object is not a prefab instance");
    });

    it('should throw error when serializing unlocked prefab instance', () => {
        const obj = new Object3D();
        setAssetResolutionContext(obj, { assetIdToRevisionId: { 'prefab-123': 'revision-123' } });
        setPrefabId(obj, 'prefab-123');
        unlockPrefab(obj); // Mark as unlocked

        expect(() => serializer.toJSON(obj)).toThrow("Cannot serialize an unlocked prefab instance");
    });

    it('should deserialize JSON into an Object3D', async () => {
        const prefabInstance = new Object3D();
        (loadPrefab as any).mockResolvedValue(prefabInstance);

        const behavior: BehaviorData = {
            id: 'b1',
            uuid: 'uuid-b1',
            enabled: true,
            priority: 0,
        };

        const json = {
            metadata: {
                generator: 'PrefabSerializer',
            },
            prefabId: 'prefab-123',
            uuid: 'my-uuid',
            name: 'DeserializedObject',
            position: { x: 4, y: 5, z: 6 },
            quaternion: { x: 1, y: 0, z: 0, w: 1 },
            scale: { x: 2, y: 2, z: 2 },
            visible: false,
            castShadow: true,
            receiveShadow: false,
            userData: {
                behaviors: [behavior],
            },
        };

        const obj = await serializer.fromJSON(json, null, { assetResolutionContext: context });

        expect(obj).toBe(prefabInstance);
        expect(obj?.uuid).toBe('my-uuid');
        expect(obj?.name).toBe('DeserializedObject');
        expect(obj?.position).toEqual(new Vector3(4, 5, 6));
        expect(obj?.quaternion.toArray()).toEqual([1, 0, 0, 1]);
        expect(obj?.scale).toEqual(new Vector3(2, 2, 2));
        expect(obj?.visible).toBe(false);
        expect(obj?.castShadow).toBe(true);
        expect(obj?.receiveShadow).toBe(false);
    });

    it('should throw error for invalid JSON', async () => {
        const invalidJson = { invalid: 'data' };

        await expect(() => serializer.fromJSON(invalidJson, null, { assetResolutionContext: context })).rejects.toThrow();
    });

    describe('behaviors handling during deserialization', () => {
        it('should handle empty behaviors array correctly', async () => {
            const prefabInstance = new Object3D();
            prefabInstance.userData.behaviors = [];
            (loadPrefab as any).mockResolvedValue(prefabInstance);

            const json = {
                metadata: {
                    generator: 'PrefabSerializer',
                },
                prefabId: 'prefab-123',
                uuid: 'my-uuid',
                name: 'DeserializedObject',
                userData: { behaviors: [] },
            };

            const obj = await serializer.fromJSON(json, null, { assetResolutionContext: context });

            expect(obj?.userData.behaviors).toEqual([]);
        });

        it('should merge behaviors from JSON with prefab behaviors', async () => {
            const prefabBehavior: BehaviorData = {
                id: 'b1',
                uuid: 'uuid-b1',
                prefabBehaviorUuid: 'pb1',
                enabled: true,
                priority: 0,
                attributesData: { value: 1 },
            };

            const prefabInstance = new Object3D();
            prefabInstance.userData.behaviors = [prefabBehavior];
            (loadPrefab as any).mockResolvedValue(prefabInstance);

            const newBehavior: BehaviorData = {
                id: 'b1',
                uuid: 'uuid-b1',
                prefabBehaviorUuid: 'pb1',
                enabled: true,
                priority: 0,
                attributesData: { value: 42 },
            };

            const json = {
                metadata: {
                    generator: 'PrefabSerializer',
                },
                prefabId: 'prefab-123',
                userData: { behaviors: [newBehavior] },
            };

            const obj = await serializer.fromJSON(json, null, { assetResolutionContext: context });

            expect(obj?.userData.behaviors.length).toBe(1);
            expect(obj?.userData.behaviors[0].attributesData).toEqual({ value: 42 });
        });

        it('should use revision context to resolve asset refs', async () => {
            const prefabBehavior: BehaviorData = {
                id: 'b1',
                uuid: 'uuid-b1',
                prefabBehaviorUuid: 'pb1',
                enabled: true,
                priority: 0,
                attributesData: { someAssetRef: { assetId: 'a1', revisionId: 'r1' } }, // asset reference
            };

            const prefabInstance = new Object3D();
            prefabInstance.userData.behaviors = [prefabBehavior];
            (loadPrefab as any).mockResolvedValue(prefabInstance);

            const newBehavior: BehaviorData = {
                id: 'b1',
                uuid: 'uuid-b1',
                prefabBehaviorUuid: 'pb1',
                enabled: true,
                priority: 0,
                attributesData: { someAssetRef: { assetId: 'a2', revisionId: 'r1' } }, // new asset reference
            };

            const json = {
                metadata: {
                    generator: 'PrefabSerializer',
                },
                prefabId: 'prefab-123',
                userData: { behaviors: [newBehavior] },
            };

            context = {
                assetIdToRevisionId: {
                    'a2': 'r2',
                },
            };

            const obj = await serializer.fromJSON(json, null, { assetResolutionContext: context });

            expect(obj?.userData.behaviors.length).toBe(1);
            expect(obj?.userData.behaviors[0].attributesData).toEqual({ someAssetRef: { assetId: 'a2', revisionId: 'r2' } });
        });

        it('should skip behavior overrides with mismatched behavior ids', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const prefabBehavior: BehaviorData = {
                id: 'enemy',
                uuid: 'uuid-b1',
                prefabBehaviorUuid: 'pb1',
                enabled: true,
                priority: 0,
                attributesData: { value: 1 },
            };

            const prefabInstance = new Object3D();
            prefabInstance.userData.behaviors = [prefabBehavior];
            (loadPrefab as any).mockResolvedValue(prefabInstance);

            const json = {
                metadata: {
                    generator: 'PrefabSerializer',
                },
                prefabId: 'prefab-123',
                userData: {
                    behaviors: [{
                        id: 'shop',
                        uuid: 'uuid-b1',
                        prefabBehaviorUuid: 'pb1',
                        enabled: true,
                        priority: 0,
                        attributesData: { value: 99 },
                    }],
                },
            };

            const obj = await serializer.fromJSON(json, null, { assetResolutionContext: context });

            expect(obj?.userData.behaviors[0].attributesData).toEqual({ value: 1 });
            expect(warn).toHaveBeenCalledWith(
                expect.stringContaining('because behavior id changed'),
            );
            warn.mockRestore();
        });

        it('should skip behavior overrides with invalid attributesData', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const prefabBehavior: BehaviorData = {
                id: 'b1',
                uuid: 'uuid-b1',
                prefabBehaviorUuid: 'pb1',
                enabled: true,
                priority: 0,
                attributesData: { value: 1 },
            };

            const prefabInstance = new Object3D();
            prefabInstance.userData.behaviors = [prefabBehavior];

            (serializer as any).applyBehaviorOverrides(prefabInstance, [{
                id: 'b1',
                uuid: 'uuid-b1',
                prefabBehaviorUuid: 'pb1',
                enabled: true,
                priority: 0,
                attributesData: [],
            }], context);

            expect(prefabInstance.userData.behaviors[0].attributesData).toEqual({ value: 1 });
            expect(warn).toHaveBeenCalledWith(
                expect.stringContaining('with invalid attributesData'),
            );
            warn.mockRestore();
        });
    });

    describe('physics handling during deserialization', () => {
        it('should override physics enabled property correctly', async () => {
            const prefabInstance = new Object3D();
            prefabInstance.userData.physics = {
                enabled: false,
                mass: 10,
            };
            (loadPrefab as any).mockResolvedValue(prefabInstance);

            const json = {
                metadata: {
                    generator: 'PrefabSerializer',
                },
                prefabId: 'prefab-123',
                userData: {
                    physics: {
                        enabled: true,
                        mass: 5, // This should be ignored
                    },
                },
            };

            const obj = await serializer.fromJSON(json, null, { assetResolutionContext: context });

            expect(obj?.userData.physics).toEqual({
                enabled: true, // Override from JSON
                mass: 10, // Original mass from prefab should remain
            });
        });
    });
});
