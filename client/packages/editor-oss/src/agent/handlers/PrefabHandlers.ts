import {Object3D} from "three";

import {
    AssetType,
    createAssetDerivativeWithData,
    getAsset,
} from "@stem/network/api/asset";
import {saveScene} from "@stem/network/api/scene";
import {
    emptyAssetResolutionContext,
    getAssetResolutionContext,
    setAssetRevision,
} from "../../asset-management/AssetResolutionContext";
import {AddObjectCommand, RemoveObjectCommand} from "../../command/Commands";
import {createAsset} from "../../editor/asset-management/hooks/assets";
import {THUMBNAIL_SIZE} from "../../editor/assets/v2/LeftPanel/MainTabs/AssetsTab/ModelUpload/constants";
import EngineRuntime from "../../EngineRuntime";
import global from "../../global";
import {serializePrefab} from "../../prefab/serialization";
import {loadPrefab, setPrefabId} from "../../prefab/util";
import {showToast} from "../../showToast";
import Converter from "../../utils/Converter";
import MeshUtils from "../../utils/MeshUtils";
import {ModelUtils} from "../../utils/ModelUtils";
import {cloneObject} from "../../utils/ObjectUtils";
import {findObjectByUuidOrNameDepthFirst} from "../../utils/SceneTraverser";
import {traverseSceneDepthFirst} from "../../utils/SceneUtil";
import {retainObjectGpuResources} from "../../core/resources/GpuResourceOwnership";
import {generateUniqueName, getObjectNamesInScene} from "../../v2/pages/services";
import {CommandResult} from "../types/ACPTypes";
import {getObjectBaseMetaData} from "../utils/serialization";

/**
 * Prefab (Stems) command handlers for CommandsRegistry
 */
export class PrefabHandlers {
    constructor(private engine: EngineRuntime) {}

    /**
     * Lists all prefabs (stems) in the current scene
     * @param root0
     * @param root0.filter
     */
    async handleListPrefabs({filter}: {filter?: string}): Promise<CommandResult> {
        try {
            const assetSource = this.engine?.editor?.assetSource;
            if (!assetSource) {
                return {
                    status: "failed",
                    message: "No active editing context (scene or stem) available",
                    data: [],
                };
            }

            const response = await assetSource.getAssets({
                types: [AssetType.Prefab],
                includeLatestRelease: true,
                includeThumbnails: true,
            });
            let prefabs = response?.assets || [];

            // Apply filter if provided
            if (filter && filter !== "*") {
                const filterLower = filter.toLowerCase();
                prefabs = prefabs.filter(prefab => {
                    return (
                        prefab.name.toLowerCase().includes(filterLower) ||
                        prefab.id.toLowerCase().includes(filterLower) ||
                        prefab.description?.toLowerCase().includes(filterLower)
                    );
                });
            }

            return {
                status: "success",
                message: `Retrieved ${prefabs.length} stems`,
                data: prefabs,
            };
        } catch (error) {
            console.error("Error listing stems:", error);
            return {
                status: "failed",
                message: `Error listing stems: ${error instanceof Error ? error.message : String(error)}`,
                data: [],
            };
        }
    }

    /**
     * Gets details of a specific prefab by ID
     * @param root0
     * @param root0.id
     */
    async handleGetPrefab({id}: {id: string}): Promise<CommandResult> {
        try {
            if (!id) {
                return {
                    status: "failed",
                    message: "No prefab/stem ID provided",
                    data: null,
                };
            }

            const asset = await getAsset(id);

            if (!asset) {
                return {
                    status: "failed",
                    message: `Stem ${id} not found`,
                    data: null,
                };
            }

            if (asset.type !== AssetType.Prefab) {
                return {
                    status: "failed",
                    message: `Asset ${id} is not a stem (type: ${asset.type})`,
                    data: null,
                };
            }

            return {
                status: "success",
                message: `Retrieved stem ${asset.name} (${id})`,
                data: asset,
            };
        } catch (error) {
            console.error("Error getting stem:", error);
            return {
                status: "failed",
                message: `Error getting stem: ${error instanceof Error ? error.message : String(error)}`,
                data: null,
            };
        }
    }

    /**
     * Adds an existing prefab to the scene
     * @param root0
     * @param root0.id
     * @param root0.position
     * @param root0.position.x
     * @param root0.position.y
     * @param root0.position.z
     * @param root0.name
     */
    async handleAddPrefabToScene({
        id,
        position,
        name,
    }: {
        id: string;
        position?: {x: number; y: number; z: number};
        name?: string;
    }): Promise<CommandResult> {
        try {
            if (!id) {
                return {
                    status: "failed",
                    message: "No stem ID provided",
                    data: null,
                };
            }

            // Get the asset to verify it exists
            const asset = await getAsset(id);
            if (!asset) {
                return {
                    status: "failed",
                    message: `Failed to fetch stem ${id}`,
                    data: null,
                };
            }

            // Get the asset resolution context
            const scene = this.engine?.editor?.scene;
            if (!scene) {
                return {
                    status: "failed",
                    message: "No scene available",
                    data: null,
                };
            }

            const revisionId = asset.latestRelease?.revisionId ?? asset.headRevisionId;
            if (!revisionId) {
                return {
                    status: "failed",
                    message: `No revision found for stem ${id}`,
                    data: null,
                };
            }

            setAssetRevision(scene, asset.id, revisionId);
            global.app?.call("objectChanged", null, scene);

            const context = getAssetResolutionContext(scene) || emptyAssetResolutionContext;

            // Load the prefab
            const prefabInstance = await loadPrefab(id, context);

            // Generate a unique name for the object in the scene
            if (name) {
                prefabInstance.name = name;
            } else {
                const existingNames = getObjectNamesInScene(scene);
                prefabInstance.name = generateUniqueName(asset.name, existingNames);
            }

            // Set position
            if (position) {
                prefabInstance.position.set(position.x, position.y, position.z);
            } else {
                // Position in front of camera if no specific position provided
                this.engine?.editor?.moveObjectToCameraClosestPoint(prefabInstance);
            }

            // Add to scene
            await this.engine?.editor?.execute(new AddObjectCommand(prefabInstance));

            return {
                status: "success",
                message: `Stem ${asset.name} added to scene`,
                data: getObjectBaseMetaData(prefabInstance),
            };
        } catch (error) {
            console.error("Error adding stem to scene:", error);
            return {
                status: "failed",
                message: `Error adding stem to scene: ${error instanceof Error ? error.message : String(error)}`,
                data: null,
            };
        }
    }

    /**
     * Creates a new prefab from an existing object in the scene
     * @param root0
     * @param root0.target
     * @param root0.name
     * @param root0.createThumbnail
     */
    async handleCreatePrefab({
        target,
        name,
        createThumbnail = true,
    }: {
        target: string;
        name?: string;
        createThumbnail?: boolean;
    }): Promise<CommandResult> {
        try {
            const assetSource = this.engine?.editor?.assetSource;
            if (!assetSource) {
                return {
                    status: "failed",
                    message: "No active editing context (scene or stem) available",
                    data: null,
                };
            }

            // Find the object
            const object = this.findObject(target);
            if (!object) {
                return {
                    status: "failed",
                    message: `Object ${target} not found`,
                    data: null,
                };
            }

            // Serialize the object into a prefab
            let serializeResult;
            try {
                serializeResult = serializePrefab(object);
            } catch (err) {
                const errorMsg = `Failed to serialize object as stem: ${String(err)}`;
                console.error(errorMsg, err);
                return {
                    status: "failed",
                    message: errorMsg,
                    data: null,
                };
            }

            // Create the asset
            const asset = await createAsset({
                assetSource,
                type: AssetType.Prefab,
                name: name || object.name,
                data: serializeResult.data,
                format: "json",
                contentType: "application/json",
                options: {
                    dependencies: serializeResult.assetResolutionContext.assetIdToRevisionId,
                    metadata: {
                        logicalAssetIdMap: serializeResult.assetResolutionContext.logicalIdToAssetId,
                    },
                },
            });

            // Create thumbnail if requested
            if (createThumbnail) {
                try {
                    global.app?.call("generatingThumbnail");
                    const thumbnail = await this.generateThumbnail(object);
                    if (thumbnail) {
                        await this.createThumbnailDerivative(asset.id, asset.headRevisionId, thumbnail);
                    }
                } catch (err) {
                    console.warn("Failed to create thumbnail:", err);
                    // Don't fail the whole operation if thumbnail creation fails
                } finally {
                    global.app?.call("generatingThumbnailDone");
                }
            }

            // Update the scene's asset resolution context
            const scene = this.engine?.editor?.scene;
            if (scene) {
                setPrefabId(object, asset.id);
                setAssetRevision(scene, asset.id, asset.headRevisionId);

                // Update all prefab instances in the scene
                await this.updatePrefabInstances(scene, asset.id);
            }

            global.app?.call("objectChanged", null, this.engine.scene); // Needed for collab mode

            saveScene().catch(console.error);

            showToast({type: "success", title: `Stem ${asset.name} created successfully!`});

            return {
                status: "success",
                message: `Stem ${asset.name} created successfully with ID: ${asset.id}`,
                data: asset,
            };
        } catch (error) {
            console.error("Error creating stem:", error);
            return {
                status: "failed",
                message: `Error creating stem: ${error instanceof Error ? error.message : String(error)}`,
                data: null,
            };
        }
    }

    /**
     * Helper method to find an object by UUID or name
     * @param identifier
     */
    private findObject(identifier: string): Object3D | null {
        return findObjectByUuidOrNameDepthFirst(this.engine.scene, identifier);
    }

    /**
     * Helper method to generate thumbnail from an object
     * @param object
     */
    private async generateThumbnail(object: Object3D): Promise<{
        file: File;
        width: number;
        height: number;
    } | null> {
        try {
            const thumbnailUrl = await ModelUtils.createThumbnailFromModel(object, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
            const thumbnailFile = Converter.dataURLtoFile(thumbnailUrl, "thumbnail");

            return {
                file: thumbnailFile,
                width: THUMBNAIL_SIZE,
                height: THUMBNAIL_SIZE,
            };
        } catch (error) {
            console.error("Error generating thumbnail:", error);
            return null;
        }
    }

    /**
     * Helper method to create a thumbnail derivative
     * @param assetId
     * @param revisionId
     * @param thumbnail
     * @param thumbnail.file
     * @param thumbnail.width
     * @param thumbnail.height
     */
    private async createThumbnailDerivative(
        assetId: string,
        revisionId: string,
        thumbnail: {file: File; width: number; height: number},
    ): Promise<void> {
        const thumbnailBlob = await thumbnail.file.arrayBuffer();

        await createAssetDerivativeWithData({
            assetId,
            revisionId,
            type: "thumbnail",
            format: "png",
            contentType: "image/png",
            data: thumbnailBlob,
            metadata: {
                width: thumbnail.width,
                height: thumbnail.height,
            },
        });
    }

    /**
     * Update all prefab instances in the scene to the current revision
     * @param scene
     * @param prefabId
     */
    private async updatePrefabInstances(scene: Object3D, prefabId: string): Promise<void> {
        const context = getAssetResolutionContext(scene) || emptyAssetResolutionContext;
        const prefab = await loadPrefab(prefabId, context);
        retainObjectGpuResources(prefab);

        const instances: Object3D[] = [];
        traverseSceneDepthFirst(scene, obj => {
            if (obj.userData?.prefabId === prefabId) {
                instances.push(obj);
                return false; // Don't traverse children of prefab instances
            }
            return true;
        });

        for (const instance of instances) {
            await this.replacePrefabInstance(instance, prefab);
        }

        MeshUtils.dispose(prefab);
    }

    /**
     * Replace a prefab instance with a new one
     * @param target
     * @param prefabInstance
     */
    private async replacePrefabInstance(target: Object3D, prefabInstance: Object3D): Promise<void> {
        const parent = target.parent;
        if (!parent) {
            throw new Error("Target object has no parent");
        }

        const editor = this.engine?.editor;
        if (!editor) {
            throw new Error("Editor not available");
        }

        // Clone the prefab instance to avoid reusing the same object
        const newInstance = cloneObject(prefabInstance);
        retainObjectGpuResources(newInstance);

        // Keep certain properties from the original object
        newInstance.uuid = target.uuid;
        newInstance.name = target.name;
        newInstance.position.copy(target.position);
        newInstance.quaternion.copy(target.quaternion);
        newInstance.scale.copy(target.scale);
        newInstance.visible = target.visible;
        newInstance.castShadow = target.castShadow;
        newInstance.receiveShadow = target.receiveShadow;

        // Copy prefab metadata
        newInstance.userData.prefabId = target.userData?.prefabId;
        newInstance.userData.prefabRevisionId = target.userData?.prefabRevisionId;

        // Replace old object with new prefab instance
        delete target.userData?.prefabId;

        try {
            await editor.execute(new RemoveObjectCommand(target));
            await editor.execute(new AddObjectCommand(newInstance, parent));
        } catch (error) {
            MeshUtils.dispose(newInstance);
            throw error;
        }
    }
}
