// Using WebGPU / TSL node system (see GridHelper for reference)
import {texture, uniformTexture, uv, smoothstep, mix, positionWorld, uniform, vec2, vec3, vec4, normalize, float, sin, cos} from "three/tsl";
import type {Node} from "three/webgpu";
import {
    BufferGeometry,
    Color,
    DataTexture,
    DoubleSide,
    FrontSide,
    Mesh,
    Object3D,
    PlaneGeometry,
    RepeatWrapping,
    SRGBColorSpace,
    TextureLoader,
    Vector2,
} from "three";
import {MeshStandardNodeMaterial} from "three/webgpu";
import {MeshBVH} from "three-mesh-bvh";

import { DEFAULT_TERRAIN_TEXTURES, DEFAULT_TERRAIN_VALUES } from "./EndlessTerrainConstants";
import {EndlessTerrainHeightGPU} from "./EndlessTerrainHeightGPU";
import {HeightFn} from "./EndlessTerrainTypes";
import {TerrainUtils} from "./EndlessTerrainUtils";
import MeshUtils from "@stem/editor-oss/utils/MeshUtils";

export interface ChunkEvent {
    chunkX: number;
    chunkZ: number;
    mesh: Mesh;
}

interface ChunkData {
    chunkX: number;
    chunkZ: number;
    mesh: Mesh;
}

type OnChunkAdded = (event: ChunkEvent) => void;
type OnChunkRemoved = (event: ChunkEvent) => void;

interface EndlessProceduralTerrainOptions {
    /** The width and length of each chunk */
    chunkSize: number;

    /** The number of segments (grid squares) in each direction */
    chunkSegments: number;

    /** The distance around the player at which chunks are rendered */
    chunkRadius: number;

    /** The terrain height function */
    heightFn: HeightFn;

    /** Maximum terrain height (for GPU displacement) */
    maxHeight?: number;

    /** Use GPU vertex displacement instead of CPU geometry modification */
    useGPU?: boolean;

    /** Height where grass ends and rock begins (default: 7) */
    grassMaxHeight?: number;
    /** Height where rock ends and snow begins (default: 12) */
    rockMaxHeight?: number;

    /** Custom ditch texture URL (falls back to rock if not set) */
    ditchTextureUrl?: string;
    /** Custom ditch normal map texture URL */
    ditchNormalTextureUrl?: string;
    /** Custom ditch roughness map texture URL */
    ditchRoughnessTextureUrl?: string;
    /** UV scale X for ditch textures */
    ditchUVScaleX?: number;
    /** UV scale Y for ditch textures */
    ditchUVScaleY?: number;

    /** Custom grass texture URL (uses default if empty) */
    groundTextureUrl?: string;
    /** Custom grass normal map texture URL (uses default if empty) */
    normalTextureUrl?: string;
    /** Custom grass roughness map texture URL */
    grassRoughnessTextureUrl?: string;
    /** UV scale X for grass textures */
    grassUVScaleX?: number;
    /** UV scale Y for grass textures */
    grassUVScaleY?: number;

    /** Custom rock texture URL (uses default if empty) */
    rockTextureUrl?: string;
    /** Custom rock normal map texture URL */
    rockNormalTextureUrl?: string;
    /** Custom rock roughness map texture URL */
    rockRoughnessTextureUrl?: string;
    /** UV scale X for rock textures */
    rockUVScaleX?: number;
    /** UV scale Y for rock textures */
    rockUVScaleY?: number;

    /** Custom snow texture URL (falls back to rock if not set) */
    snowTextureUrl?: string;
    /** Custom snow normal map texture URL */
    snowNormalTextureUrl?: string;
    /** Custom snow roughness map texture URL */
    snowRoughnessTextureUrl?: string;
    /** UV scale X for snow textures */
    snowUVScaleX?: number;
    /** UV scale Y for snow textures */
    snowUVScaleY?: number;
}

export class EndlessProceduralTerrain {
    onChunkAdded: OnChunkAdded | null = null;
    onChunkRemoved: OnChunkRemoved | null = null;

    private terrainChunkMap = new Map<string, ChunkData>();
    private readonly shaderMaterial: MeshStandardNodeMaterial;
    private readonly chunkSize: number;
    private readonly chunkSegments: number;
    private readonly chunkRadius: number;
    private readonly useGPU: boolean;
    private readonly maxHeight: number;
    private readonly heightGPU: EndlessTerrainHeightGPU | null = null;

    private waterPlane: Mesh | null = null;

    // Uniforms for GPU vertex displacement (shared across all chunks)
    private readonly uHeightmap = uniformTexture();
    private readonly uTexelSize = uniform(0.0);

    constructor(
        private readonly parent: Object3D,
        private readonly heightFn: HeightFn,
        options?: Partial<EndlessProceduralTerrainOptions>,
    ) {
        this.parent = parent;
        this.chunkSize = options?.chunkSize ?? 350;
        this.chunkSegments = options?.chunkSegments ?? 20;
        this.chunkRadius = options?.chunkRadius ?? 4;
        this.useGPU = options?.useGPU ?? true;
        this.maxHeight = options?.maxHeight ?? DEFAULT_TERRAIN_VALUES.maxHeight;

        // Initialize GPU heightmap generator if using GPU mode
        if (this.useGPU) {
            this.heightGPU = new EndlessTerrainHeightGPU(
                this.heightFn,
                this.chunkSize,
                this.chunkSegments,
            );
            this.uTexelSize.value = 1.0 / (this.chunkSegments + 1);
        }

        // Water plane at y=0 — covers visible terrain area
        this.waterPlane = this.createWaterPlane();

        this.shaderMaterial = EndlessProceduralTerrain.createGroundNodeMaterial({
            // Height thresholds
            grassMaxHeight: options?.grassMaxHeight,
            rockMaxHeight: options?.rockMaxHeight,
            // Ditch textures (falls back to rock)
            ditchTextureUrl: options?.ditchTextureUrl,
            ditchNormalTextureUrl: options?.ditchNormalTextureUrl,
            ditchRoughnessTextureUrl: options?.ditchRoughnessTextureUrl,
            ditchUVScaleX: options?.ditchUVScaleX,
            ditchUVScaleY: options?.ditchUVScaleY,
            // Grass textures
            groundTextureUrl: options?.groundTextureUrl,
            normalTextureUrl: options?.normalTextureUrl,
            grassRoughnessTextureUrl: options?.grassRoughnessTextureUrl,
            grassUVScaleX: options?.grassUVScaleX,
            grassUVScaleY: options?.grassUVScaleY,
            // Rock textures
            rockTextureUrl: options?.rockTextureUrl,
            rockNormalTextureUrl: options?.rockNormalTextureUrl,
            rockRoughnessTextureUrl: options?.rockRoughnessTextureUrl,
            rockUVScaleX: options?.rockUVScaleX,
            rockUVScaleY: options?.rockUVScaleY,
            // Snow textures (falls back to rock)
            snowTextureUrl: options?.snowTextureUrl,
            snowNormalTextureUrl: options?.snowNormalTextureUrl,
            snowRoughnessTextureUrl: options?.snowRoughnessTextureUrl,
            snowUVScaleX: options?.snowUVScaleX,
            snowUVScaleY: options?.snowUVScaleY,
        });
    }

    /**
     * Call this method once and only once to initialize the terrain.
     *
     * @remarks
     * Each call to init() should be paired with a call to dispose().
     */
    init() {
        if (this.waterPlane) {
            this.parent.add(this.waterPlane);
        }
        this.generateInitialChunks();
    }

    /**
     * Frees resources associated with the terrain.
     *
     * @remarks
     * Once called, the EndlessProceduralTerrain instance is no longer usable. Each
     * call to init() should be paired with a call to dispose().
     */
    dispose(): void {
        this.terrainChunkMap.forEach(({chunkX, chunkZ}) => {
            this.removeChunk(chunkX, chunkZ);
        });

        this.shaderMaterial.dispose();

        // Clean up water plane
        if (this.waterPlane) {
            this.waterPlane.removeFromParent();
            this.waterPlane.geometry.dispose();
            (this.waterPlane.material as MeshStandardNodeMaterial).dispose();
            this.waterPlane = null;
        }

        // Clean up GPU resources
        if (this.heightGPU) {
            this.heightGPU.dispose();
        }
    }

    /**
     * Update the terrain chunks that are currently visible.
     *
     * @param playerPosition - The player position in the terrain's local space
     * @param playerPosition.x - X coordinate in local space
     * @param playerPosition.z - Z coordinate in local space
     */
    update(playerPosition: {x: number; z: number}) {
        const playerChunk = this.getChunkCoords(playerPosition);
        this.updateChunks(playerChunk.chunkX, playerChunk.chunkZ);

        // Move water plane to follow player XZ position
        if (this.waterPlane) {
            this.waterPlane.position.x = playerPosition.x;
            this.waterPlane.position.z = playerPosition.z;
        }
    }

    private createWaterPlane(): Mesh {
        const waterSize = this.chunkSize * this.chunkRadius * 3;
        const geometry = new PlaneGeometry(waterSize, waterSize);
        geometry.rotateX(-Math.PI / 2);

        const material = new MeshStandardNodeMaterial({
            color: new Color('#1a6e8e'),
            transparent: true,
            opacity: 0.85,
            metalness: 0.1,
            roughness: 0.3,
            side: DoubleSide,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
        });

        const mesh = new Mesh(geometry, material);
        mesh.position.y = -0.2;
        mesh.renderOrder = 1;
        mesh.userData.isRuntimeOnly = true;
        mesh.userData.isSelectable = false;
        mesh.userData.preserveOnSceneClear = true;

        return mesh;
    }

    private generateInitialChunks() {
        const center = this.getChunkCoords({x: 0, z: 0});

        for (let x = -this.chunkRadius; x <= this.chunkRadius; x++) {
            for (let z = -this.chunkRadius; z <= this.chunkRadius; z++) {
                const chunkX = center.chunkX + x;
                const chunkZ = center.chunkZ + z;
                this.addChunk(chunkX, chunkZ);
            }
        }
    }

    private getChunkCoords(pos: {x: number; z: number}) {
        return {
            chunkX: Math.floor(pos.x / this.chunkSize),
            chunkZ: Math.floor(pos.z / this.chunkSize),
        };
    }

    private static createGroundNodeMaterial(options: {
        grassMaxHeight?: number;
        rockMaxHeight?: number;
        ditchTextureUrl?: string;
        ditchNormalTextureUrl?: string;
        ditchRoughnessTextureUrl?: string;
        ditchUVScaleX?: number;
        ditchUVScaleY?: number;
        groundTextureUrl?: string;
        normalTextureUrl?: string;
        grassRoughnessTextureUrl?: string;
        grassUVScaleX?: number;
        grassUVScaleY?: number;
        rockTextureUrl?: string;
        rockNormalTextureUrl?: string;
        rockRoughnessTextureUrl?: string;
        rockUVScaleX?: number;
        rockUVScaleY?: number;
        snowTextureUrl?: string;
        snowNormalTextureUrl?: string;
        snowRoughnessTextureUrl?: string;
        snowUVScaleX?: number;
        snowUVScaleY?: number;
    }): MeshStandardNodeMaterial {
        const loader = new TextureLoader();

        // Load base textures with fallbacks
        const ditchTextureUrl = options.ditchTextureUrl || DEFAULT_TERRAIN_TEXTURES.ditch;
        const ditchNormalUrl = options.ditchNormalTextureUrl || DEFAULT_TERRAIN_TEXTURES.normal;
        const grassTextureUrl = options.groundTextureUrl || DEFAULT_TERRAIN_TEXTURES.grass;
        const grassNormalUrl = options.normalTextureUrl || DEFAULT_TERRAIN_TEXTURES.normal;
        const rockTextureUrl = options.rockTextureUrl || DEFAULT_TERRAIN_TEXTURES.rock;
        const rockNormalUrl = options.rockNormalTextureUrl || DEFAULT_TERRAIN_TEXTURES.normal;
        const snowTextureUrl = options.snowTextureUrl || DEFAULT_TERRAIN_TEXTURES.snow;
        const snowNormalUrl = options.snowNormalTextureUrl || DEFAULT_TERRAIN_TEXTURES.normal;

        // Load all textures
        const ditchBaseMap = loader.load(ditchTextureUrl);
        const ditchNormalMapTex = loader.load(ditchNormalUrl);
        const grassBaseMap = loader.load(grassTextureUrl);
        const grassNormalMapTex = loader.load(grassNormalUrl);
        const rockBaseMap = loader.load(rockTextureUrl);
        const rockNormalMapTex = loader.load(rockNormalUrl);
        const snowBaseMap = loader.load(snowTextureUrl);
        const snowNormalMapTex = loader.load(snowNormalUrl);

        // Configure all texture parameters
        const colorTextures = [ditchBaseMap, grassBaseMap, rockBaseMap, snowBaseMap];
        colorTextures.forEach(tex => {
            tex.wrapS = tex.wrapT = RepeatWrapping;
            tex.repeat.set(1, 1);
            tex.colorSpace = SRGBColorSpace;
        });
        const normalTextures = [ditchNormalMapTex, grassNormalMapTex, rockNormalMapTex, snowNormalMapTex];
        normalTextures.forEach(tex => {
            tex.wrapS = tex.wrapT = RepeatWrapping;
            tex.repeat.set(1, 1);
        });

        // UV scale uniforms (per-axis)
        const ditchScaleVec = vec2(uniform(options.ditchUVScaleX ?? 1.0), uniform(options.ditchUVScaleY ?? 1.0));
        const grassScaleVec = vec2(uniform(options.grassUVScaleX ?? 1.0), uniform(options.grassUVScaleY ?? 1.0));
        const rockScaleVec = vec2(uniform(options.rockUVScaleX ?? 1.0), uniform(options.rockUVScaleY ?? 1.0));
        const snowScaleVec = vec2(uniform(options.snowUVScaleX ?? 1.0), uniform(options.snowUVScaleY ?? 1.0));

        // Height thresholds for 4-layer blending
        // Ditch: below 0, Grass: 0-grassMaxHeight, Rock: grassMaxHeight-rockMaxHeight, Snow: above rockMaxHeight
        const grassMaxHeight = options.grassMaxHeight ?? DEFAULT_TERRAIN_VALUES.grassMaxHeight;
        const rockMaxHeight = options.rockMaxHeight ?? DEFAULT_TERRAIN_VALUES.rockMaxHeight;
        const uDitchMaxHeight = uniform(2.0);
        const uDitchBlendRange = uniform(2.0);
        const uRockMinHeight = uniform(grassMaxHeight);
        const uRockBlendRange = uniform(5.0);
        const uSnowMinHeight = uniform(rockMaxHeight);
        const uSnowBlendRange = uniform(5.0);

        // Build separate UV coordinates for each layer
        const ditchScaledUV = uv().mul(ditchScaleVec);
        const grassScaledUV = uv().mul(grassScaleVec);
        const rockScaledUV = uv().mul(rockScaleVec);
        const snowScaledUV = uv().mul(snowScaleVec);

        // Sample all textures
        const ditchSample = texture(ditchBaseMap, ditchScaledUV).toVar();
        const grassSample = texture(grassBaseMap, grassScaledUV).toVar();
        const rockSample = texture(rockBaseMap, rockScaledUV).toVar();
        const snowSample = texture(snowBaseMap, snowScaledUV).toVar();

        // Wavy biome boundaries: add sin/cos offset to break up horizontal banding
        const biomeWave = sin(positionWorld.x.mul(0.15)).mul(2.5)
            .add(cos(positionWorld.z.mul(0.15)).mul(2.5));
        const blendHeight = positionWorld.y.add(biomeWave).toVar();

        // Height-based blend factors
        // Ditch factor: 1.0 at low heights, 0.0 above ditchMaxHeight
        const ditchFactor = smoothstep(
            uDitchMaxHeight.add(uDitchBlendRange),
            uDitchMaxHeight,
            blendHeight,
        ).toVar();

        // Rock factor: 0.0 below rockMinHeight, 1.0 above rockMinHeight + blendRange
        const rockFactor = smoothstep(
            uRockMinHeight,
            uRockMinHeight.add(uRockBlendRange),
            blendHeight,
        ).toVar();

        // Snow factor: 0.0 below snowMinHeight, 1.0 above snowMinHeight + blendRange
        const snowFactor = smoothstep(
            uSnowMinHeight,
            uSnowMinHeight.add(uSnowBlendRange),
            blendHeight,
        ).toVar();

        // Blend layers: ditch → grass → rock → snow
        // Start with grass as base
        let blendedRGB = grassSample.rgb.toVar();
        // Mix in ditch for low areas
        blendedRGB = mix(blendedRGB, ditchSample.rgb, ditchFactor).toVar();
        // Mix in rock for mid-high areas
        blendedRGB = mix(blendedRGB, rockSample.rgb, rockFactor).toVar();
        // Mix in snow for peaks
        blendedRGB = mix(blendedRGB, snowSample.rgb, snowFactor).toVar();

        const finalColor = vec4(blendedRGB, grassSample.a);

        // Create material
        const mat = new MeshStandardNodeMaterial({
            metalness: 0.0,
            roughness: 1.0,
            side: FrontSide,
        });

        // Use grass normal map as base (could implement blending later)
        mat.normalMap = grassNormalMapTex;
        mat.normalScale = new Vector2(0.1, 0.1);

        // Handle roughness maps if provided
        const hasRoughness = options.ditchRoughnessTextureUrl || options.grassRoughnessTextureUrl ||
                           options.rockRoughnessTextureUrl || options.snowRoughnessTextureUrl;
        if (hasRoughness) {
            // Load roughness maps (use default 1.0 if not provided)
            const defaultRoughness = uniform(1.0);

            let ditchRoughness: Node<"float"> = defaultRoughness;
            if (options.ditchRoughnessTextureUrl) {
                const ditchRoughnessMap = loader.load(options.ditchRoughnessTextureUrl);
                ditchRoughnessMap.wrapS = ditchRoughnessMap.wrapT = RepeatWrapping;
                ditchRoughnessMap.repeat.set(1, 1);
                ditchRoughness = texture(ditchRoughnessMap, ditchScaledUV).r;
            }

            let grassRoughness: Node<"float"> = defaultRoughness;
            if (options.grassRoughnessTextureUrl) {
                const grassRoughnessMap = loader.load(options.grassRoughnessTextureUrl);
                grassRoughnessMap.wrapS = grassRoughnessMap.wrapT = RepeatWrapping;
                grassRoughnessMap.repeat.set(1, 1);
                grassRoughness = texture(grassRoughnessMap, grassScaledUV).r;
            }

            let rockRoughness: Node<"float"> = defaultRoughness;
            if (options.rockRoughnessTextureUrl) {
                const rockRoughnessMap = loader.load(options.rockRoughnessTextureUrl);
                rockRoughnessMap.wrapS = rockRoughnessMap.wrapT = RepeatWrapping;
                rockRoughnessMap.repeat.set(1, 1);
                rockRoughness = texture(rockRoughnessMap, rockScaledUV).r;
            }

            let snowRoughness: Node<"float"> = defaultRoughness;
            if (options.snowRoughnessTextureUrl) {
                const snowRoughnessMap = loader.load(options.snowRoughnessTextureUrl);
                snowRoughnessMap.wrapS = snowRoughnessMap.wrapT = RepeatWrapping;
                snowRoughnessMap.repeat.set(1, 1);
                snowRoughness = texture(snowRoughnessMap, snowScaledUV).r;
            }

            // Blend roughness same way as color
            let blendedRoughness: Node<"float"> = grassRoughness;
            blendedRoughness = mix(blendedRoughness, ditchRoughness, ditchFactor);
            blendedRoughness = mix(blendedRoughness, rockRoughness, rockFactor);
            blendedRoughness = mix(blendedRoughness, snowRoughness, snowFactor);
            mat.roughnessNode = blendedRoughness;
        }

        // Assign color node result
        mat.colorNode = finalColor;

        return mat;
    }

    private generateTerrainGeometry(chunkX: number, chunkZ: number): PlaneGeometry {
        const geometry = new PlaneGeometry(this.chunkSize, this.chunkSize, this.chunkSegments, this.chunkSegments);
        geometry.rotateX(-Math.PI / 2);

        const vertices = geometry.attributes.position;

        // Sample heights for vertex positions (needed for BVH/physics)
        for (let i = 0; i < vertices!.count; i++) {
            const x = vertices!.getX(i) + chunkX * this.chunkSize;
            const z = vertices!.getZ(i) + chunkZ * this.chunkSize;
            const height = this.heightFn(x, z);
            vertices!.setY(i, height);
        }

        // GPU mode: skip CPU normal computation, normals computed in shader
        // CPU mode: compute normals on CPU (legacy behavior)
        if (!this.useGPU) {
            geometry.computeVertexNormals();
        }

        // Attach BVH for raycasting (type cast due to Three/WebGPU typing differences)
        (geometry as unknown as BufferGeometry & {boundsTree: MeshBVH}).boundsTree = new MeshBVH(geometry);

        return geometry;
    }

    private addChunk(chunkX: number, chunkZ: number) {
        const chunkKey = TerrainUtils.getChunkKey(chunkX, chunkZ);
        if (this.terrainChunkMap.has(chunkKey)) {
            return;
        }

        const geometry = this.generateTerrainGeometry(chunkX, chunkZ);

        let material: MeshStandardNodeMaterial;
        if (this.useGPU && this.heightGPU) {
            // GPU mode: create per-chunk material with heightmap-based normal computation
            const heightmapTexture = this.heightGPU.generateHeightmapTexture(chunkX, chunkZ, this.maxHeight);
            material = this.createGPUMaterial(heightmapTexture);
        } else {
            // CPU mode: use shared material
            material = this.shaderMaterial;
        }

        const mesh = new Mesh(geometry, material);
        mesh.position.set(chunkX * this.chunkSize, 0, chunkZ * this.chunkSize);
        mesh.userData.isRuntimeOnly = true;
        mesh.userData.isSelectable = false;
        mesh.userData.preserveOnSceneClear = true;
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        mesh.renderOrder = 0;

        this.parent.add(mesh);

        this.terrainChunkMap.set(chunkKey, {chunkX, chunkZ, mesh});

        this.onChunkAdded?.({chunkX, chunkZ, mesh});
    }

    /**
     * Create a material clone with GPU-computed normals from heightmap.
     * @param heightmapTexture
     */
    private createGPUMaterial(heightmapTexture: DataTexture): MeshStandardNodeMaterial {
        // Clone the base material
        const material = this.shaderMaterial.clone();

        // Parameters for normal computation
        const texelSize = 1.0 / (this.chunkSegments + 1);
        const heightScale = this.maxHeight * 2; // Scale for gradient computation

        // Compute normal from heightmap gradient
        // Sample neighboring heights to compute gradient
        const currentUV = uv();
        const texelOffset = float(texelSize);
        const zeroOffset = float(0);

        // Sample heights at neighboring texels
        const heightL = texture(heightmapTexture, currentUV.sub(vec2(texelOffset, zeroOffset))).r;
        const heightR = texture(heightmapTexture, currentUV.add(vec2(texelOffset, zeroOffset))).r;
        const heightD = texture(heightmapTexture, currentUV.sub(vec2(zeroOffset, texelOffset))).r;
        const heightU = texture(heightmapTexture, currentUV.add(vec2(zeroOffset, texelOffset))).r;

        // Compute gradient (height difference * scale)
        const scaleNode = float(heightScale);
        const dx = heightR.sub(heightL).mul(scaleNode);
        const dz = heightU.sub(heightD).mul(scaleNode);

        // Compute normal from gradient (cross product of tangent vectors)
        // Tangent X: (2*texelSize*chunkSize, dx, 0)
        // Tangent Z: (0, dz, 2*texelSize*chunkSize)
        // Normal = TangentX x TangentZ = (-dx, 2*step, -dz)
        const computedNormal = normalize(vec3(dx.negate(), float(2), dz.negate()));

        // Override the normal node
        material.normalNode = computedNormal;

        return material;
    }

    private removeChunk(chunkX: number, chunkZ: number) {
        const chunkKey = TerrainUtils.getChunkKey(chunkX, chunkZ);
        const meshData = this.terrainChunkMap.get(chunkKey);
        if (!meshData) {
            return;
        }

        const {mesh} = meshData;

        if (mesh) {
            this.onChunkRemoved?.({chunkX, chunkZ, mesh});
            mesh.removeFromParent();

            // In GPU mode, dispose per-chunk material and heightmap
            if (this.useGPU && mesh.material !== this.shaderMaterial) {
                (mesh.material as MeshStandardNodeMaterial).dispose();
            }

            MeshUtils.dispose(mesh);
        }

        // Clean up heightmap texture cache
        if (this.useGPU && this.heightGPU) {
            this.heightGPU.removeHeightmap(chunkX, chunkZ);
        }

        this.terrainChunkMap.delete(chunkKey);
    }

    private updateChunks(playerChunkX: number, playerChunkZ: number) {
        const newChunkSet = new Set<string>();

        // Add new chunks
        for (let x = -this.chunkRadius; x <= this.chunkRadius; x++) {
            for (let z = -this.chunkRadius; z <= this.chunkRadius; z++) {
                const chunkX = playerChunkX + x;
                const chunkZ = playerChunkZ + z;
                const chunkKey = TerrainUtils.getChunkKey(chunkX, chunkZ);

                if (!this.terrainChunkMap.has(chunkKey)) {
                    this.addChunk(chunkX, chunkZ);
                }

                newChunkSet.add(chunkKey);
            }
        }

        // Remove old chunks
        this.terrainChunkMap.forEach(({chunkX, chunkZ}, key) => {
            if (!newChunkSet.has(key)) {
                this.removeChunk(chunkX, chunkZ);
            }
        });
    }
}
