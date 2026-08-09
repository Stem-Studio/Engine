import {afterEach, describe, expect, it, vi} from 'vitest';

import {generateAtlas, generateAtlasFromBlobs, type TextureInfo} from './AtlasGeneratorCore';

class TestOffscreenCanvas {
    readonly context = {
        clearRect: vi.fn(),
        drawImage: vi.fn(),
    };

    constructor(readonly width: number, readonly height: number) {}

    getContext() {
        return this.context;
    }

    async convertToBlob() {
        return new Blob(['atlas'], {type: 'image/png'});
    }
}

const texture = (name: string, width: number, height: number): TextureInfo => ({
    name,
    width,
    height,
    imageData: {width, height} as ImageBitmap,
});

describe('AtlasGeneratorCore', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('rejects textures wider than the configured atlas instead of clipping them', async () => {
        vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas);

        await expect(generateAtlas([
            texture('too-wide', 65, 8),
            texture('small', 8, 8),
        ], {maxAtlasSize: 64})).resolves.toBeNull();
    });

    it('does not include trailing row padding in power-of-two atlas dimensions', async () => {
        vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas);

        const result = await generateAtlas([
            texture('first', 15, 8),
            texture('second', 15, 8),
        ], {maxAtlasSize: 64, padding: 2});

        expect(result?.config.width).toBe(32);
        expect(result?.config.height).toBe(8);
        expect(result?.config.regions.second?.x).toBe(17);
    });

    it('decodes blobs concurrently and closes every decoded bitmap', async () => {
        vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas);
        const resolvers: Array<(bitmap: ImageBitmap) => void> = [];
        const firstBitmap = {width: 8, height: 8, close: vi.fn()};
        const secondBitmap = {width: 8, height: 8, close: vi.fn()};
        const createImageBitmap = vi.fn(() => new Promise<ImageBitmap>(resolve => resolvers.push(resolve)));
        vi.stubGlobal('createImageBitmap', createImageBitmap);

        const pending = generateAtlasFromBlobs(new Map([
            ['first', new Blob(['first'])],
            ['second', new Blob(['second'])],
        ]));
        await Promise.resolve();

        expect(createImageBitmap).toHaveBeenCalledTimes(2);
        resolvers[0]!(firstBitmap as unknown as ImageBitmap);
        resolvers[1]!(secondBitmap as unknown as ImageBitmap);
        await pending;

        expect(firstBitmap.close).toHaveBeenCalledOnce();
        expect(secondBitmap.close).toHaveBeenCalledOnce();
    });
});
