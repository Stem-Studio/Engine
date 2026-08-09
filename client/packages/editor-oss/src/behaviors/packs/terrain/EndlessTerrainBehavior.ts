/*
 * Copyright: StemStudio Maintainers
 * Portions of this code are derived from the Shadow Editor (MIT License)
 */
import { Material, Matrix4, Mesh, Object3D, Vector3 } from "three";

import { EndlessProceduralTerrain, ChunkEvent } from "./EndlessProceduralTerrain";
import {
    DEFAULT_TERRAIN_TEXTURES,
    DEFAULT_TERRAIN_VALUES,
    defaultTerrainModels,
    getDefaultTerrainObjectConfigs,
    getLocalDefaultModelUrl,
    getLocalDefaultTextureUrl,
} from "./EndlessTerrainConstants";
import { EndlessTerrainGridHeight } from "./EndlessTerrainGridHeight";
import { EndlessTerrainHeight } from "./EndlessTerrainHeight";
import { EndlessTerrainObjects, TerrainObjectModel, TerrainObjectType } from "./EndlessTerrainObjects";
import { EndlessTerrainPhysics } from "./EndlessTerrainPhysics";
import { TerrainObjectConfig } from "./EndlessTerrainTypes";
import { resolveTerrainUv } from "./TerrainUvMode";
import Editor from "@stem/editor-oss/editor/Editor";
import { BehaviorBase } from "../../Behavior";
import GameManager from "../../game/GameManager";

class EndlessTerrainBehavior extends BehaviorBase {
    private static readonly tmpMatrix = new Matrix4();
    private static readonly tmpVector = new Vector3();

    private endlessProceduralTerrain: EndlessProceduralTerrain | null = null;
    private endlessTerrainPhysics: EndlessTerrainPhysics | null = null;
    private endlessTerrainObjects: EndlessTerrainObjects | null = null;
    private lastUpdateTime = 0;
    private lastParentWorldPosition = new Vector3();

    // Editor reference for camera access in editor mode
    private editor: Editor | null = null;

    // Race condition guard
    private initializationToken = 0;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;

    init(game: GameManager): void | Promise<void> {
        this.game = game;

        // Data migration: infer isDefaultState for existing scenes that don't have it
        // If terrainObjects is undefined/null, it means defaults will be used (default state)
        // If terrainObjects has any value (including []), user has customized (not default state)
        if (this.attributes.isDefaultState === undefined) {
            this.attributes.isDefaultState = this.attributes.terrainObjects === undefined ||
                this.attributes.terrainObjects === null;
        }

        // Initialize terrain objects with defaults early so UI shows them
        this.initializeTerrainObjectsIfEmpty();
        this.initializeDefaultTextureAttributes();
    }

    async onStart(): Promise<void> {
        // Increment token at start of initialization
        this.initializationToken++;
        const myToken = this.initializationToken;

        // Preserve backwards compatibility with old terrain behavior.
        // We identify the old terrain via userData.isEndlessTerrain. Old
        // terrain differs as follows:
        //   1. The target was a plane rotated 90 degrees. Now a 90 degree
        //      rotation of the target would also rotate the terrain by 90
        //      degrees.
        //   2. The plane's visible property was set to false and all the
        //      children of the plane (i.e., the terrain chunks) were marked
        //      with visible = true. Now the target's visibility property
        //      affects the visibility of the terrain chunks.
        //
        // To preserve backwards compatibility, we do the following when
        // userData.isEndlessTerrain is true:
        //   1. Set the target's visible property to true but set the plane's
        //      material to fully transparent.
        //   2. Clear the target's quaternion.
        //   3. Set the target's userData.isSelectable to false.
        if (this.target?.userData.isEndlessTerrain) {
            this.target.visible = true;
            this.target.quaternion.set(0, 0, 0, 1);
            if (this.target instanceof Mesh) {
                if (this.target.material instanceof Material) {
                    this.target.material.transparent = true;
                    this.target.material.opacity = 0;
                    this.target.material.depthTest = false;
                }
            }
            this.target.userData.isSelectable = false;
        }

        const chunkSize = EndlessTerrainHeight.getChunkSize();
        const chunkSegments = 20;
        const waterEnabled = this.attributes.waterEnabled ?? true;
        const waterPercentage = waterEnabled
            ? (this.attributes.waterPercentage ?? DEFAULT_TERRAIN_VALUES.waterPercentage)
            : 0;
        const useEnhancedTerrain = this.attributes.useEnhancedTerrain !== false;
        const heightFn = this.makeHeightFunction(chunkSize, chunkSegments);

        // Initialize terrainObjects with defaults if empty (so UI shows them)
        this.initializeTerrainObjectsIfEmpty();
        this.initializeDefaultTextureAttributes();

        // Get terrain object models - use user config if available, otherwise defaults
        const terrainModels = this.getTerrainObjectModels();

        // Get scene root for UUID lookups (if available)
        const sceneRoot = this.game?.engine?.scene || this.editor?.scene || undefined;

        // Get asset loader for loading models from asset library
        const assetLoader = this.game?.engine?.assetLoader || undefined;

        // Pass terrain height parameters for snow threshold calculation
        const maxHeight = Number(this.attributes.maxHeight) || DEFAULT_TERRAIN_VALUES.maxHeight;
        const grassMaxHeight = this.attributes.grassMaxHeight ?? DEFAULT_TERRAIN_VALUES.grassMaxHeight;
        const rockMaxHeight = this.attributes.rockMaxHeight; // Let EndlessTerrainObjects calculate default if not set

        this.endlessTerrainObjects = new EndlessTerrainObjects(this.target, heightFn, terrainModels, {
            chunkSize,
            chunkSegments,
            density: 0.005,
            seed: Number(this.attributes.seed),
            useEnhancedTerrain,
            waterPercentage,
            sceneRoot,
            assetLoader,
            maxHeight,
            grassMaxHeight,
            rockMaxHeight,
            treeDensity: this.attributes.treeDensity ?? DEFAULT_TERRAIN_VALUES.treeDensity,
            rockDensity: this.attributes.rockDensity ?? DEFAULT_TERRAIN_VALUES.rockDensity,
        });
        const terrainObjectsInstance = this.endlessTerrainObjects;
        terrainObjectsInstance.onTerrainObjectAdded = this.onTerrainObjectAdded.bind(this);
        terrainObjectsInstance.onTerrainObjectRemoved = this.onTerrainObjectRemoved.bind(this);

        // --- ASYNC POINT ---
        await terrainObjectsInstance.init();

        // Check race condition
        if (this.initializationToken !== myToken) {
            // Clean up only OUR instance. Do not touch this.endlessTerrainObjects,
            // which may already point to a newer instance created by a later onStart.
            terrainObjectsInstance.dispose();
            if (this.endlessTerrainObjects === terrainObjectsInstance) {
                this.endlessTerrainObjects = null;
            }
            return;
        }

        // Update preview URLs with generated thumbnails (runs async, doesn't block terrain)
        void this.updatePreviewUrls();
        // -------------------

        if (this.game?.physics && this.game?.engine?.physics) {
            this.endlessTerrainPhysics = new EndlessTerrainPhysics(this.game.physics, this.game.engine.physics);
        }

        const ditchUv = resolveTerrainUv({
            uvMode: this.attributes.ditchUVMode,
            uvScaleLocked: this.attributes.ditchUVScaleLocked,
            uvScale: this.attributes.ditchUVScale,
            uvScaleX: this.attributes.ditchUVScaleX,
            uvScaleY: this.attributes.ditchUVScaleY,
            uvRepeatLocked: this.attributes.ditchUVRepeatLocked,
            uvRepeat: this.attributes.ditchUVRepeat,
            uvRepeatU: this.attributes.ditchUVRepeatU,
            uvRepeatV: this.attributes.ditchUVRepeatV,
        });
        const grassUv = resolveTerrainUv({
            uvMode: this.attributes.grassUVMode,
            uvScaleLocked: this.attributes.grassUVScaleLocked,
            uvScale: this.attributes.grassUVScale,
            uvScaleX: this.attributes.grassUVScaleX,
            uvScaleY: this.attributes.grassUVScaleY,
            uvRepeatLocked: this.attributes.grassUVRepeatLocked,
            uvRepeat: this.attributes.grassUVRepeat,
            uvRepeatU: this.attributes.grassUVRepeatU,
            uvRepeatV: this.attributes.grassUVRepeatV,
        });
        const rockUv = resolveTerrainUv({
            uvMode: this.attributes.rockUVMode,
            uvScaleLocked: this.attributes.rockUVScaleLocked,
            uvScale: this.attributes.rockUVScale,
            uvScaleX: this.attributes.rockUVScaleX,
            uvScaleY: this.attributes.rockUVScaleY,
            uvRepeatLocked: this.attributes.rockUVRepeatLocked,
            uvRepeat: this.attributes.rockUVRepeat,
            uvRepeatU: this.attributes.rockUVRepeatU,
            uvRepeatV: this.attributes.rockUVRepeatV,
        });
        const snowUv = resolveTerrainUv({
            uvMode: this.attributes.snowUVMode,
            uvScaleLocked: this.attributes.snowUVScaleLocked,
            uvScale: this.attributes.snowUVScale,
            uvScaleX: this.attributes.snowUVScaleX,
            uvScaleY: this.attributes.snowUVScaleY,
            uvRepeatLocked: this.attributes.snowUVRepeatLocked,
            uvRepeat: this.attributes.snowUVRepeat,
            uvRepeatU: this.attributes.snowUVRepeatU,
            uvRepeatV: this.attributes.snowUVRepeatV,
        });

        this.endlessProceduralTerrain = new EndlessProceduralTerrain(this.target, heightFn, {
            // Note: for backward compatibility, it is important that we use
            // the same chunk size that the height function uses to ensure
            // we generate the same terrain geometry.
            chunkSize,
            chunkSegments,
            // GPU optimization options
            useGPU: this.attributes.useGPU ?? false,
            maxHeight,
            // Height thresholds for terrain layers
            grassMaxHeight: this.attributes.grassMaxHeight ?? DEFAULT_TERRAIN_VALUES.grassMaxHeight,
            rockMaxHeight: this.attributes.rockMaxHeight ?? DEFAULT_TERRAIN_VALUES.rockMaxHeight,
            // Ditch textures (falls back to rock if not set)
            ditchTextureUrl: this.attributes.ditchTexture || undefined,
            ditchNormalTextureUrl: this.attributes.ditchNormalTexture || undefined,
            ditchRoughnessTextureUrl: this.attributes.ditchRoughnessTexture || undefined,
            ditchUVScaleX: ditchUv.u,
            ditchUVScaleY: ditchUv.v,
            // Grass textures (empty string means use default)
            groundTextureUrl: this.attributes.groundTexture || undefined,
            normalTextureUrl: this.attributes.normalTexture || undefined,
            grassRoughnessTextureUrl: this.attributes.grassRoughnessTexture || undefined,
            grassUVScaleX: grassUv.u,
            grassUVScaleY: grassUv.v,
            // Rock textures
            rockTextureUrl: this.attributes.rockTexture || undefined,
            rockNormalTextureUrl: this.attributes.rockNormalTexture || undefined,
            rockRoughnessTextureUrl: this.attributes.rockRoughnessTexture || undefined,
            rockUVScaleX: rockUv.u,
            rockUVScaleY: rockUv.v,
            // Snow textures (falls back to rock if not set)
            snowTextureUrl: this.attributes.snowTexture || undefined,
            snowNormalTextureUrl: this.attributes.snowNormalTexture || undefined,
            snowRoughnessTextureUrl: this.attributes.snowRoughnessTexture || undefined,
            snowUVScaleX: snowUv.u,
            snowUVScaleY: snowUv.v,
        });
        this.endlessProceduralTerrain.onChunkAdded = this.onChunkAdded.bind(this);
        this.endlessProceduralTerrain.onChunkRemoved = this.onChunkRemoved.bind(this);
        this.endlessProceduralTerrain.init();
        console.warn(`[EndlessTerrainBehavior] Terrain initialized with chunkSize=${chunkSize}`);
    }

    update(/* dt: number */) {
        // TODO: we are not currently getting accurate dt values from the engine
        // due to throttling. When that is fixed, use the dt value passed in
        // instead of computing it ourselves.
        const time = Date.now() / 1000;
        const dt = time - this.lastUpdateTime;
        this.lastUpdateTime = time;

        // Get camera position - prefer game camera, fall back to editor camera
        const camera = this.game?.camera || this.editor?.camera;
        const playerPosition = camera?.position || { x: 0, y: 0, z: 0 };

        // Get player position in the terrain's local space, storing the result
        // in EndlessTerrainBehavior.tmpVector.
        this.target.updateWorldMatrix(true, false);

        // Detect if the terrain parent was moved (e.g., by editor transform gizmo)
        // and rebuild physics bodies at the new world position.
        EndlessTerrainBehavior.tmpVector.setFromMatrixPosition(this.target.matrixWorld);
        if (!EndlessTerrainBehavior.tmpVector.equals(this.lastParentWorldPosition)) {
            this.lastParentWorldPosition.copy(EndlessTerrainBehavior.tmpVector);
            this.endlessTerrainPhysics?.onParentMoved();
        }

        EndlessTerrainBehavior.tmpMatrix.copy(this.target.matrixWorld);
        EndlessTerrainBehavior.tmpMatrix.invert();
        EndlessTerrainBehavior.tmpVector.set(playerPosition.x, playerPosition.y, playerPosition.z);
        EndlessTerrainBehavior.tmpVector.applyMatrix4(EndlessTerrainBehavior.tmpMatrix);

        this.endlessProceduralTerrain?.update(EndlessTerrainBehavior.tmpVector);
        this.endlessTerrainObjects?.setPriorityOrigin(EndlessTerrainBehavior.tmpVector.x, EndlessTerrainBehavior.tmpVector.z);
        this.endlessTerrainObjects?.update(dt);
        this.endlessTerrainPhysics?.update(EndlessTerrainBehavior.tmpVector);
    }

    onStop(): void {
        // Invalidate any pending initializations
        this.initializationToken++;

        // Clear debounce timer if active
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }

        this.endlessProceduralTerrain?.dispose();
        this.endlessProceduralTerrain = null;
        this.endlessTerrainObjects?.dispose();
        this.endlessTerrainObjects = null;
        this.endlessTerrainPhysics?.dispose();
        this.endlessTerrainPhysics = null;
    }

    onAttributesUpdated(): void {
        // Debounce only works if we have an active context, but for standard runtime this might be immediate.
        // In editor, we override onEditorAttributesUpdated.

        // TODO: do this more efficiently
        // In runtime, prompt updates might be desired? Assuming consistent with legacy logic:
        void this.restartBehavior();
    }

    private async restartBehavior(): Promise<void> {
        this.onStop();
        await this.onStart();
    }

    onReset() { }

    // Editor methods

    onEditorAdded(editor: Editor): Promise<void> {
        // Store editor reference for camera access
        this.editor = editor;
        // Initialize terrain objects with defaults early so UI shows them
        this.initializeTerrainObjectsIfEmpty();
        this.initializeDefaultTextureAttributes();
        return this.onStart();
    }

    onEditorRemoved(): void {
        this.editor = null;
        this.onStop();
    }

    onEditorDispose(): void {
        this.editor = null;
        this.onStop();
    }

    onEditorUpdate(): void {
        this.update();
    }

    onEditorPanelShown(): void {
        // Ensure terrain objects are initialized when panel is shown
        this.initializeTerrainObjectsIfEmpty();
        this.initializeDefaultTextureAttributes();
    }

    onEditorPanelHidden(): void { }

    onEditorAttributesUpdated(): void {
        this.initializeDefaultTextureAttributes();

        // User is customizing - no longer in default state
        if (this.attributes.isDefaultState) {
            this.attributes.isDefaultState = false;
        }

        // Debounce attribute updates in editor to prevent race conditions and performance killing re-gens
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            // onStart is async and rebuilds the instanced meshes after the
            // restart. Reapply the editor-only render cap once that rebuild
            // has settled instead of leaving a freshly generated mesh uncapped.
            void this.restartBehavior().finally(() => {
                this.editor?.scheduleEditorPreviewInstancingBudget?.();
            });
        }, 200);
    }

    onEditorButtonClicked(action: string): void {
        if (action === "resetToDefaults") {
            // Reset attributes to default values from behavior.json
            this.attributes.useGPU = false;
            this.attributes.useEnhancedTerrain = true;
            this.attributes.waterEnabled = true;
            this.attributes.waterPercentage = DEFAULT_TERRAIN_VALUES.waterPercentage;
            this.attributes.maxHeight = DEFAULT_TERRAIN_VALUES.maxHeight;
            this.attributes.seed = DEFAULT_TERRAIN_VALUES.seed;
            // Reset height thresholds
            this.attributes.grassMaxHeight = DEFAULT_TERRAIN_VALUES.grassMaxHeight;
            this.attributes.rockMaxHeight = DEFAULT_TERRAIN_VALUES.rockMaxHeight;
            // Reset ditch textures
            this.attributes.ditchTexture = DEFAULT_TERRAIN_TEXTURES.ditch;
            this.attributes.ditchNormalTexture = DEFAULT_TERRAIN_TEXTURES.normal;
            this.attributes.ditchRoughnessTexture = null;
            this.attributes.ditchUVScaleLocked = false;
            this.attributes.ditchUVScale = DEFAULT_TERRAIN_VALUES.uvScale;
            this.attributes.ditchUVScaleX = DEFAULT_TERRAIN_VALUES.uvScale;
            this.attributes.ditchUVScaleY = DEFAULT_TERRAIN_VALUES.uvScale;
            this.attributes.ditchUVMode = "scale";
            this.attributes.ditchUVRepeatLocked = true;
            this.attributes.ditchUVRepeat = 1;
            this.attributes.ditchUVRepeatU = 1;
            this.attributes.ditchUVRepeatV = 1;
            // Reset grass textures
            this.attributes.groundTexture = DEFAULT_TERRAIN_TEXTURES.grass;
            this.attributes.normalTexture = DEFAULT_TERRAIN_TEXTURES.normal;
            this.attributes.grassRoughnessTexture = null;
            this.attributes.grassUVScaleLocked = false;
            this.attributes.grassUVScale = DEFAULT_TERRAIN_VALUES.uvScale;
            this.attributes.grassUVScaleX = DEFAULT_TERRAIN_VALUES.uvScale;
            this.attributes.grassUVScaleY = DEFAULT_TERRAIN_VALUES.uvScale;
            this.attributes.grassUVMode = "scale";
            this.attributes.grassUVRepeatLocked = true;
            this.attributes.grassUVRepeat = 1;
            this.attributes.grassUVRepeatU = 1;
            this.attributes.grassUVRepeatV = 1;
            // Reset rock textures
            this.attributes.rockTexture = DEFAULT_TERRAIN_TEXTURES.rock;
            this.attributes.rockNormalTexture = DEFAULT_TERRAIN_TEXTURES.normal;
            this.attributes.rockRoughnessTexture = null;
            this.attributes.rockUVScaleLocked = false;
            this.attributes.rockUVScale = DEFAULT_TERRAIN_VALUES.uvScale;
            this.attributes.rockUVScaleX = DEFAULT_TERRAIN_VALUES.uvScale;
            this.attributes.rockUVScaleY = DEFAULT_TERRAIN_VALUES.uvScale;
            this.attributes.rockUVMode = "scale";
            this.attributes.rockUVRepeatLocked = true;
            this.attributes.rockUVRepeat = 1;
            this.attributes.rockUVRepeatU = 1;
            this.attributes.rockUVRepeatV = 1;
            // Reset snow textures
            this.attributes.snowTexture = DEFAULT_TERRAIN_TEXTURES.snow;
            this.attributes.snowNormalTexture = DEFAULT_TERRAIN_TEXTURES.normal;
            this.attributes.snowRoughnessTexture = null;
            this.attributes.snowUVScaleLocked = false;
            this.attributes.snowUVScale = DEFAULT_TERRAIN_VALUES.uvScale;
            this.attributes.snowUVScaleX = DEFAULT_TERRAIN_VALUES.uvScale;
            this.attributes.snowUVScaleY = DEFAULT_TERRAIN_VALUES.uvScale;
            this.attributes.snowUVMode = "scale";
            this.attributes.snowUVRepeatLocked = true;
            this.attributes.snowUVRepeat = 1;
            this.attributes.snowUVRepeatU = 1;
            this.attributes.snowUVRepeatV = 1;
            // Reset density settings
            this.attributes.treeDensity = DEFAULT_TERRAIN_VALUES.treeDensity;
            this.attributes.rockDensity = DEFAULT_TERRAIN_VALUES.rockDensity;
            // Reset terrain objects to defaults
            this.attributes.terrainObjects = getDefaultTerrainObjectConfigs();
            // Mark as default state since user explicitly reset to defaults
            this.attributes.isDefaultState = true;

            // Trigger terrain regeneration (use restartBehavior directly to avoid
            // onEditorAttributesUpdated setting isDefaultState = false)
            void this.restartBehavior().finally(() => {
                this.editor?.scheduleEditorPreviewInstancingBudget?.();
            });
        }
    }

    /**
     * Initialize terrainObjects attribute with defaults if never set
     * This ensures the UI displays the default models for editing
     *
     * Logic:
     * - If terrainObjects is undefined/null OR (empty array AND isDefaultState is true/undefined)
     *   → populate with defaults
     * - If terrainObjects is empty array AND isDefaultState is false
     *   → user intentionally cleared, leave empty
     */
    private initializeTerrainObjectsIfEmpty(): void {
        const userConfigs = this.attributes.terrainObjects as TerrainObjectConfig[] | undefined;
        const isDefaultState = this.attributes.isDefaultState;

        // Check if we should populate with defaults
        const isUninitialized = userConfigs === undefined || userConfigs === null;
        const isEmptyButDefaultState = Array.isArray(userConfigs) && userConfigs.length === 0 &&
            (isDefaultState === true || isDefaultState === undefined);

        if (isUninitialized || isEmptyButDefaultState) {
            // Populate with default terrain object configs
            this.attributes.terrainObjects = getDefaultTerrainObjectConfigs();
            // Mark as default state since we're initializing with defaults
            this.attributes.isDefaultState = true;
            return;
        }

        // If explicitly empty array and user has customized (isDefaultState = false), leave empty
        if (Array.isArray(userConfigs) && userConfigs.length === 0) {
            return;
        }

        // Restore missing modelUrl for bundled models using modelName
        // Note: Invalid items (no modelUrl/modelUUID) are filtered in getTerrainObjectModels()
        const defaults = getDefaultTerrainObjectConfigs();
        const defaultsByName = new Map(defaults.map(d => [d.modelName, d]));
        const defaultsByUrl = new Map(defaults.map(d => [d.modelUrl, d]));

        const backfillTerrainOffset = (config: TerrainObjectConfig, defaultConfig?: TerrainObjectConfig): TerrainObjectConfig => {
            if (config.terrainOffset !== undefined) return config;
            const fallback = defaultConfig
                ?? (config.modelUrl ? defaultsByUrl.get(config.modelUrl) : undefined)
                ?? (config.modelName ? defaultsByName.get(config.modelName) : undefined);
            if (!fallback || fallback.terrainOffset === undefined) return config;
            return { ...config, terrainOffset: fallback.terrainOffset };
        };

        const restoredConfigs = userConfigs.map(config => {
            // Scene object reference or custom asset, keep as-is
            if (config.modelUUID || config.modelAsset?.assetId) {
                return config;
            }

            if (config.modelUrl) {
                // Check if this is a stale bundled model URL from another environment
                const localUrl = getLocalDefaultModelUrl(config.modelUrl);
                const normalized = localUrl && localUrl !== config.modelUrl
                    ? { ...config, modelUrl: localUrl }
                    : config;
                return backfillTerrainOffset(normalized, defaultsByUrl.get(normalized.modelUrl ?? ''));
            }

            // Try to restore bundled model URL from modelName
            if (config.modelName) {
                const defaultConfig = defaultsByName.get(config.modelName);
                if (defaultConfig) {
                    return backfillTerrainOffset({
                        ...config,
                        modelUrl: defaultConfig.modelUrl,
                    }, defaultConfig);
                }
            }

            // Return as-is (will be filtered out later if invalid)
            return config;
        });

        this.attributes.terrainObjects = restoredConfigs;
    }

    private initializeDefaultTextureAttributes(): void {
        const defaultTextures: Array<[string, string]> = [
            ["ditchTexture", DEFAULT_TERRAIN_TEXTURES.ditch],
            ["ditchNormalTexture", DEFAULT_TERRAIN_TEXTURES.normal],
            ["groundTexture", DEFAULT_TERRAIN_TEXTURES.grass],
            ["normalTexture", DEFAULT_TERRAIN_TEXTURES.normal],
            ["rockTexture", DEFAULT_TERRAIN_TEXTURES.rock],
            ["rockNormalTexture", DEFAULT_TERRAIN_TEXTURES.normal],
            ["snowTexture", DEFAULT_TERRAIN_TEXTURES.snow],
            ["snowNormalTexture", DEFAULT_TERRAIN_TEXTURES.normal],
        ];

        for (const [key, value] of defaultTextures) {
            const current = this.attributes[key];
            if (!current) {
                this.attributes[key] = value;
            } else if (typeof current === "string" && current !== value && getLocalDefaultTextureUrl(current) !== null) {
                // Replace stale bundled texture URL from another environment
                this.attributes[key] = value;
            }
        }
    }

    /**
     * Update preview URLs with generated thumbnails from loaded models
     */
    private async updatePreviewUrls(): Promise<void> {
        const configs = this.attributes.terrainObjects as TerrainObjectConfig[] | undefined;
        if (!configs) return;

        let updated = false;
        const sceneRoot = this.game?.engine?.scene || this.editor?.scene;

        for (const config of configs) {
            // Handle bundled models (modelUrl)
            if (config.modelUrl) {
                const thumbnail = EndlessTerrainObjects.getThumbnail(config.modelUrl);
                if (thumbnail && config.previewUrl !== thumbnail) {
                    config.previewUrl = thumbnail;
                    updated = true;
                }
            }
            // Handle custom models from asset library (modelAsset)
            else if (config.modelAsset?.assetId && config.modelAsset?.revisionId) {
                const cacheKey = `asset:${config.modelAsset.assetId}:${config.modelAsset.revisionId}`;
                // Check if already cached
                let thumbnail = EndlessTerrainObjects.getThumbnail(cacheKey);
                if (!thumbnail) {
                    // Generate thumbnail for asset
                    thumbnail = await EndlessTerrainObjects.generateThumbnailForAsset(
                        config.modelAsset.assetId,
                        config.modelAsset.revisionId,
                    );
                }
                if (thumbnail && config.previewUrl !== thumbnail) {
                    config.previewUrl = thumbnail;
                    updated = true;
                }
            }
            // Handle custom scene objects (modelUUID) - deprecated
            else if (config.modelUUID && sceneRoot) {
                const cacheKey = `uuid:${config.modelUUID}`;
                // Check if already cached
                let thumbnail = EndlessTerrainObjects.getThumbnail(cacheKey);
                if (!thumbnail) {
                    // Generate thumbnail for scene object
                    thumbnail = await EndlessTerrainObjects.generateThumbnailForSceneObject(
                        config.modelUUID,
                        sceneRoot,
                    );
                }
                if (thumbnail && config.previewUrl !== thumbnail) {
                    config.previewUrl = thumbnail;
                    updated = true;
                }
            }
        }

        // Trigger UI refresh if thumbnails were updated
        if (updated && this.editor) {
            // Force the behavior panel to re-render with new thumbnails
            void this.editor.behaviorUIManager?.refresh();
        }
    }

    /**
     * Get terrain object models from user configuration or defaults
     * Note: Empty array [] means user cleared all objects, undefined means use defaults
     */
    private getTerrainObjectModels(): TerrainObjectModel[] {
        const userConfigs = this.attributes.terrainObjects as TerrainObjectConfig[] | undefined;

        // If userConfigs is undefined/null, use defaults (initial/uninitialized state)
        if (userConfigs === undefined || userConfigs === null) {
            return [...defaultTerrainModels];
        }

        // If user explicitly set to empty array, return empty (no terrain objects)
        if (userConfigs.length === 0) {
            return [];
        }

        // Convert user configs to internal format
        return userConfigs.map((config): TerrainObjectModel => ({
            url: config.modelUrl || '',
            modelUUID: config.modelUUID,
            modelAsset: config.modelAsset,
            minScale: config.minScale,
            maxScale: config.maxScale,
            terrainOffset: config.terrainOffset ?? 0,
            probability: config.probability,
            type: config.objectType as TerrainObjectType,
        })).filter(model => model.url || model.modelUUID || model.modelAsset?.assetId); // Filter out invalid entries
    }

    private onChunkAdded({ chunkX, chunkZ, mesh }: ChunkEvent) {
        this.endlessTerrainObjects?.addObjectsForChunk(chunkX, chunkZ);
        this.endlessTerrainPhysics?.addPhysicsForChunk(mesh);
    }

    private onChunkRemoved({ chunkX, chunkZ, mesh }: ChunkEvent) {
        this.endlessTerrainObjects?.removeObjectsForChunk(chunkX, chunkZ);
        this.endlessTerrainPhysics?.removePhysicsForChunk(mesh);
    }

    private onTerrainObjectAdded(mesh: Object3D, index: number, objectId: string, type: TerrainObjectType) {
        if (type === TerrainObjectType.Plant) return;
        this.endlessTerrainPhysics?.addPhysicsForTerrainObject(mesh, index, objectId);
    }

    private onTerrainObjectRemoved(mesh: Object3D, objectId: string) {
        this.endlessTerrainPhysics?.removePhysicsForTerrainObject(objectId);
    }

    private makeHeightFunction(chunkSize: number, chunkSegments: number) {
        const waterEnabled = this.attributes.waterEnabled ?? true;
        const waterPercentage = waterEnabled
            ? (this.attributes.waterPercentage ?? DEFAULT_TERRAIN_VALUES.waterPercentage)
            : 0;

        const endlessTerrainHeight = new EndlessTerrainHeight(
            Number(this.attributes.seed),
            Number(this.attributes.maxHeight),
            waterPercentage,
        );

        const halfChunkSize = chunkSize / 2;
        const gridSpacing = chunkSize / chunkSegments;
        const gridOffset = halfChunkSize % gridSpacing;

        const heightFn = this.attributes.useEnhancedTerrain !== false
            ? endlessTerrainHeight.getEnhancedHeightFn()
            : endlessTerrainHeight.getHeightFn();

        const endlessTerrainGridHeight = new EndlessTerrainGridHeight(
            heightFn,
            gridSpacing,
            gridOffset,
        );

        return endlessTerrainGridHeight.getHeightFn();
    }
}

export default EndlessTerrainBehavior;
