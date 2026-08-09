import {beforeEach, describe, expect, it, vi} from "vitest";

const hoisted = vi.hoisted(() => ({
    getModelStats: vi.fn(),
    optimizeGlbFileWithStats: vi.fn(),
}));

vi.mock("@stem/network/api/asset", () => ({
    lookupOssAsset: vi.fn(),
    SUPPORTED_MODEL_FORMATS_REGEX: /\.(glb|gltf|fbx)$/i,
}));

vi.mock("../utils/ModelUtils", () => ({
    getModelStats: hoisted.getModelStats,
    optimizeGlbFileWithStats: hoisted.optimizeGlbFileWithStats,
}));

import {createLods} from "./load-util";

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(res => {
        resolve = res;
    });
    return {promise, resolve};
};
const flushAsyncWork = () => new Promise(resolve => setTimeout(resolve, 0));

describe("createLods", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("uses optimizer-returned stats without reparsing the optimized GLB", async () => {
        const sourceBuffer = new ArrayBuffer(16);
        const optimizedBuffer = new ArrayBuffer(12);
        hoisted.optimizeGlbFileWithStats.mockResolvedValue({
            glbData: optimizedBuffer,
            stats: {
                vertexCount: 123,
                triangleCount: 45,
            },
        });

        const lods = await createLods(
            sourceBuffer,
            "robot.glb",
            {
                compressTextures: true,
                maxTextureSize: 1024,
                lodSettings: [
                    {
                        vertexRetention: 50,
                        textureScale: 75,
                    },
                ],
            } as any,
            new AbortController().signal,
        );

        expect(hoisted.optimizeGlbFileWithStats).toHaveBeenCalledWith(sourceBuffer, {
            simplifyRatio: 0.5,
            simplifyError: 0.001,
            compressTextures: true,
            maxTextureSize: 1024,
            textureScale: 0.75,
            removeMorphTargets: true,
            useMeshopt: true,
        });
        expect(hoisted.getModelStats).not.toHaveBeenCalled();
        expect(lods).toHaveLength(1);
        expect(lods[0]).toMatchObject({
            level: 1,
            vertexCount: 123,
            polygonCount: 45,
            compression: {
                vertexRetention: 0.5,
                textureScale: 0.75,
                method: "meshopt",
            },
        });
        expect(lods[0]!.file.name).toBe("robot_1.glb");
        expect(lods[0]!.file.size).toBe(optimizedBuffer.byteLength);
    });

    it("generates LODs serially to limit peak GLB optimization memory", async () => {
        const firstOptimization = deferred<{
            glbData: ArrayBuffer;
            stats: {vertexCount: number; triangleCount: number};
        }>();
        const secondOptimization = deferred<{
            glbData: ArrayBuffer;
            stats: {vertexCount: number; triangleCount: number};
        }>();
        hoisted.optimizeGlbFileWithStats
            .mockImplementationOnce(() => firstOptimization.promise)
            .mockImplementationOnce(() => secondOptimization.promise);

        const lodsPromise = createLods(
            new ArrayBuffer(32),
            "robot.glb",
            {
                lodSettings: [
                    {vertexRetention: 80, textureScale: 75},
                    {vertexRetention: 50, textureScale: 50},
                ],
            } as any,
            new AbortController().signal,
        );

        await flushAsyncWork();
        expect(hoisted.optimizeGlbFileWithStats).toHaveBeenCalledTimes(1);

        firstOptimization.resolve({
            glbData: new ArrayBuffer(16),
            stats: {vertexCount: 80, triangleCount: 24},
        });
        await flushAsyncWork();
        expect(hoisted.optimizeGlbFileWithStats).toHaveBeenCalledTimes(2);

        secondOptimization.resolve({
            glbData: new ArrayBuffer(12),
            stats: {vertexCount: 50, triangleCount: 15},
        });

        const lods = await lodsPromise;
        expect(lods.map(lod => lod.level)).toEqual([1, 2]);
        expect(lods.map(lod => lod.vertexCount)).toEqual([80, 50]);
    });
});
