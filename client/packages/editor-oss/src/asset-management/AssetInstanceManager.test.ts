import { Object3D } from 'three';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { AssetInstanceManager } from './AssetInstanceManager';
import { AssetRef } from './AssetRef';

vi.mock('../model/load-util', () => ({
    loadModelWithLoader: vi.fn(),
}));

vi.mock('../prefab/util', () => ({
    loadPrefabWithLoader: vi.fn(),
}));

vi.mock('../utils/MeshUtils', () => ({
    default: { dispose: vi.fn() },
}));

import { loadModelWithLoader } from '../model/load-util';
import { loadPrefabWithLoader } from '../prefab/util';
import MeshUtils from '../utils/MeshUtils';

const makeObject = (): Object3D => {
    const obj = new Object3D();
    obj.name = 'template';
    return obj;
};

const ref: AssetRef = { assetId: 'asset1', revisionId: 'rev1' };

describe('AssetInstanceManager', () => {
    let manager: AssetInstanceManager;

    beforeEach(() => {
        vi.clearAllMocks();
        manager = new AssetInstanceManager({} as any);

        (loadModelWithLoader as any).mockImplementation(() => Promise.resolve(makeObject()));
        (loadPrefabWithLoader as any).mockImplementation(() => Promise.resolve(makeObject()));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // -- Without preload (no template kept) --

    it('createModelInstance loads and returns the object directly', async () => {
        const instance = await manager.createModelInstance(ref);
        expect(loadModelWithLoader).toHaveBeenCalledOnce();
        expect(instance).toBeInstanceOf(Object3D);
    });

    it('createPrefabInstance loads and returns the object directly', async () => {
        const instance = await manager.createPrefabInstance(ref);
        expect(loadPrefabWithLoader).toHaveBeenCalledOnce();
        expect(instance).toBeInstanceOf(Object3D);
    });

    it('without preload, each createInstance call loads fresh', async () => {
        await manager.createModelInstance(ref);
        await manager.createModelInstance(ref);
        expect(loadModelWithLoader).toHaveBeenCalledTimes(2);
    });

    // -- With preload (template cached and cloned) --

    it('preload + createInstance only loads once', async () => {
        await manager.preloadModel(ref);
        await manager.createModelInstance(ref);
        expect(loadModelWithLoader).toHaveBeenCalledOnce();
    });

    it('preload + multiple createInstance calls returns distinct clones', async () => {
        await manager.preloadModel(ref);
        const a = await manager.createModelInstance(ref);
        const b = await manager.createModelInstance(ref);
        expect(loadModelWithLoader).toHaveBeenCalledOnce();
        expect(a.uuid).not.toBe(b.uuid);
    });

    it('deduplicates concurrent preload calls', async () => {
        await Promise.all([
            manager.preloadModel(ref),
            manager.preloadModel(ref),
        ]);
        expect(loadModelWithLoader).toHaveBeenCalledOnce();
    });

    it('caches models and prefabs independently', async () => {
        await manager.preloadModel(ref);
        await manager.preloadPrefab(ref);
        await manager.createModelInstance(ref);
        await manager.createPrefabInstance(ref);
        expect(loadModelWithLoader).toHaveBeenCalledOnce();
        expect(loadPrefabWithLoader).toHaveBeenCalledOnce();
    });

    // -- Unload / dispose --

    it('unload disposes template and forces re-load', async () => {
        await manager.preloadModel(ref);
        manager.unloadModel(ref);
        expect(MeshUtils.dispose).toHaveBeenCalled();

        vi.clearAllMocks();
        (loadModelWithLoader as any).mockImplementation(() => Promise.resolve(makeObject()));
        await manager.createModelInstance(ref);
        expect(loadModelWithLoader).toHaveBeenCalledOnce();
    });

    it('dispose clears all templates and forces re-load', async () => {
        await manager.preloadModel(ref);
        await manager.preloadPrefab(ref);
        manager.dispose();
        expect(MeshUtils.dispose).toHaveBeenCalled();

        vi.clearAllMocks();
        (loadModelWithLoader as any).mockImplementation(() => Promise.resolve(makeObject()));
        await manager.createModelInstance(ref);
        expect(loadModelWithLoader).toHaveBeenCalledOnce();
    });

    it('unload disposes deep templates without Object3D.traverse', async () => {
        await manager.preloadModel(ref);
        vi.spyOn(Object3D.prototype, 'traverse').mockImplementation(() => {
            throw new Error('recursive Object3D.traverse should not be used');
        });

        expect(() => manager.unloadModel(ref)).not.toThrow();
        expect(MeshUtils.dispose).toHaveBeenCalled();
    });

    it('dispose clears deep template caches without Object3D.traverse', async () => {
        await manager.preloadModel(ref);
        await manager.preloadPrefab(ref);
        vi.spyOn(Object3D.prototype, 'traverse').mockImplementation(() => {
            throw new Error('recursive Object3D.traverse should not be used');
        });

        expect(() => manager.dispose()).not.toThrow();
        expect(MeshUtils.dispose).toHaveBeenCalled();
    });
});
