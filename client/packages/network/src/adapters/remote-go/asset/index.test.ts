import { afterEach, describe, expect, it } from 'vitest';

import {
    AssetType,
    createOssAssetRegistry,
    getOssAssetRegistry,
    getOssAssetsForProject,
    dataToBase64,
    lookupOssAsset,
    processWithConcurrencyLimit,
    registerOssAsset,
    resetOssAssetRegistryForTests,
    setOssAssetRegistry,
    setOssAssetThumbnail,
    unregisterOssAsset,
} from './index';

afterEach(() => {
    resetOssAssetRegistryForTests();
});

describe('processWithConcurrencyLimit', () => {
    it('should respect the provided concurrency limit', async () => {
        const active = { count: 0, max: 0 };
        const releaseResolvers: Array<() => void> = [];
        let completed = 0;

        const promise = processWithConcurrencyLimit(
            [1, 2, 3, 4, 5, 6],
            2,
            async (item) => {
                active.count++;
                active.max = Math.max(active.max, active.count);
                await new Promise<void>(resolve => {
                    releaseResolvers.push(resolve);
                });
                active.count--;
                completed++;
                return item * 10;
            },
        );

        // Allow initial workers to start.
        await Promise.resolve();

        while (completed < 6) {
            const next = releaseResolvers.shift();
            if (next) {
                next();
                // Allow next task to start.
                await Promise.resolve();
            } else {
                await Promise.resolve();
            }
        }

        const result = await promise;
        expect(active.max).toBeLessThanOrEqual(2);
        expect(result).toEqual([10, 20, 30, 40, 50, 60]);
    });

    it('should return empty array for empty input', async () => {
        const result = await processWithConcurrencyLimit([], 5, async (item: number) => item);
        expect(result).toEqual([]);
    });

    it('should run with at least one worker when concurrency is zero', async () => {
        const result = await processWithConcurrencyLimit([1, 2], 0, async (item) => item + 1);
        expect(result).toEqual([2, 3]);
    });
});

describe('dataToBase64', () => {
    it('preserves binary data across chunk boundaries', async () => {
        const bytes = new Uint8Array(0x8000 + 17);
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = i % 256;
        }

        const encoded = await dataToBase64(bytes.buffer);
        const decoded = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));

        expect(decoded).toEqual(bytes);
    });
});

describe('OSS asset registry', () => {
    it('uses the active registry object instead of recreating storage across calls', () => {
        const registry = createOssAssetRegistry();
        setOssAssetRegistry(registry);

        registerOssAsset({
            assetId: 'asset-1',
            revisionId: 'revision-1',
            type: AssetType.Model,
            format: 'glb',
            name: 'Stable model',
            dataUrl: 'data:model/gltf-binary;base64,AAAA',
            projectId: 'project-1',
        });

        expect(getOssAssetRegistry()).toBe(registry);
        expect(lookupOssAsset('asset-1')).toBe(registry.get('asset-1'));
        expect(lookupOssAsset('revision-1')).toBe(registry.get('revision-1'));
        expect(getOssAssetsForProject('project-1')).toHaveLength(1);

        setOssAssetThumbnail('asset-1', 'data:image/png;base64,thumb');
        expect(lookupOssAsset('revision-1')?.thumbnailDataUrl).toBe('data:image/png;base64,thumb');

        unregisterOssAsset('asset-1');
        expect(registry.has('asset-1')).toBe(false);
        expect(registry.has('revision-1')).toBe(false);
    });

    it('keeps a single fallback registry reference when no provider installs one', () => {
        const first = getOssAssetRegistry();
        const second = getOssAssetRegistry();

        expect(second).toBe(first);
    });
});
