import {
    DataTexture,
    FloatType,
    LinearFilter,
    RedFormat,
    ClampToEdgeWrapping,
} from "three";

import { HeightFn } from "./EndlessTerrainTypes";

/**
 * GPU-optimized heightmap generator for endless terrain.
 *
 * Generates heightmap textures that can be sampled in vertex/fragment shaders
 * for efficient GPU-based vertex displacement and normal computation.
 */
export class EndlessTerrainHeightGPU {
    private readonly heightFn: HeightFn;
    private readonly chunkSize: number;
    private readonly segments: number;
    private readonly textureSize: number;

    // Cache for heightmap textures per chunk
    private readonly heightmapCache = new Map<string, DataTexture>();

    constructor(
        heightFn: HeightFn,
        chunkSize: number,
        segments: number,
    ) {
        this.heightFn = heightFn;
        this.chunkSize = chunkSize;
        this.segments = segments;
        this.textureSize = segments + 1; // +1 for vertices at edges
    }

    /**
     * Generate a heightmap texture for a terrain chunk.
     * The texture stores normalized height values in the red channel.
     *
     * @param chunkX - Chunk X coordinate
     * @param chunkZ - Chunk Z coordinate
     * @param maxHeight - Maximum terrain height for normalization
     * @returns DataTexture containing heightmap data
     */
    generateHeightmapTexture(chunkX: number, chunkZ: number, _maxHeight: number): DataTexture {
        const cacheKey = `${chunkX},${chunkZ}`;

        // Check cache first
        const cached = this.heightmapCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const size = this.textureSize;
        const data = new Float32Array(size * size);

        // Sample height function at each texel
        // Texel (0,0) corresponds to corner (-halfChunk, -halfChunk)
        // Texel (size-1, size-1) corresponds to corner (+halfChunk, +halfChunk)
        const halfChunk = this.chunkSize / 2;
        const step = this.chunkSize / this.segments;

        for (let z = 0; z < size; z++) {
            for (let x = 0; x < size; x++) {
                // World position for this texel
                const worldX = chunkX * this.chunkSize + (x * step - halfChunk);
                const worldZ = chunkZ * this.chunkSize + (z * step - halfChunk);

                // Get height and store in texture
                const height = this.heightFn(worldX, worldZ);
                data[z * size + x] = height;
            }
        }

        // Create texture
        const texture = new DataTexture(data, size, size, RedFormat, FloatType);
        texture.minFilter = LinearFilter;
        texture.magFilter = LinearFilter;
        texture.wrapS = ClampToEdgeWrapping;
        texture.wrapT = ClampToEdgeWrapping;
        texture.needsUpdate = true;

        // Cache the texture
        this.heightmapCache.set(cacheKey, texture);

        return texture;
    }

    /**
     * Get min and max height values from a heightmap texture.
     * Useful for physics bounds calculation.
     * @param chunkX
     * @param chunkZ
     * @param maxHeight
     */
    getHeightBounds(chunkX: number, chunkZ: number, maxHeight: number): { min: number; max: number } {
        const texture = this.generateHeightmapTexture(chunkX, chunkZ, maxHeight);
        const data = texture.image.data as Float32Array;

        let min = Infinity;
        let max = -Infinity;

        for (let i = 0; i < data.length; i++) {
            const height = data[i]!;
            if (height < min) min = height;
            if (height > max) max = height;
        }

        return { min, max };
    }

    /**
     * Sample height at a specific world position from the heightmap.
     * Uses bilinear interpolation for smooth results.
     * @param chunkX
     * @param chunkZ
     * @param worldX
     * @param worldZ
     * @param maxHeight
     */
    sampleHeight(chunkX: number, chunkZ: number, worldX: number, worldZ: number, maxHeight: number): number {
        const texture = this.generateHeightmapTexture(chunkX, chunkZ, maxHeight);
        const data = texture.image.data as Float32Array;
        const size = this.textureSize;

        // Convert world position to texture coordinates
        const halfChunk = this.chunkSize / 2;
        const localX = worldX - chunkX * this.chunkSize + halfChunk;
        const localZ = worldZ - chunkZ * this.chunkSize + halfChunk;

        // Normalize to [0, segments] range
        const u = localX / this.chunkSize * this.segments;
        const v = localZ / this.chunkSize * this.segments;

        // Bilinear interpolation
        const x0 = Math.floor(u);
        const z0 = Math.floor(v);
        const x1 = Math.min(x0 + 1, size - 1);
        const z1 = Math.min(z0 + 1, size - 1);
        const fx = u - x0;
        const fz = v - z0;

        const h00 = data[z0 * size + x0]!;
        const h10 = data[z0 * size + x1]!;
        const h01 = data[z1 * size + x0]!;
        const h11 = data[z1 * size + x1]!;

        const h0 = h00 * (1 - fx) + h10 * fx;
        const h1 = h01 * (1 - fx) + h11 * fx;

        return h0 * (1 - fz) + h1 * fz;
    }

    /**
     * Remove cached heightmap for a chunk.
     * @param chunkX
     * @param chunkZ
     */
    removeHeightmap(chunkX: number, chunkZ: number): void {
        const cacheKey = `${chunkX},${chunkZ}`;
        const texture = this.heightmapCache.get(cacheKey);
        if (texture) {
            texture.dispose();
            this.heightmapCache.delete(cacheKey);
        }
    }

    /**
     * Clear all cached heightmaps.
     */
    dispose(): void {
        this.heightmapCache.forEach(texture => texture.dispose());
        this.heightmapCache.clear();
    }
}
