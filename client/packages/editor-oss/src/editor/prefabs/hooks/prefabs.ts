import {Object3D, Scene, type Vector3Like} from "three";

import {AssetType, forkAsset, getAsset} from "@stem/network/api/asset";
import {saveScene} from "@stem/network/api/scene";
import {
    emptyAssetResolutionContext,
    getAssetResolutionContext,
    resolveAssetRevisionId,
} from "@stem/editor-oss/asset-management/AssetResolutionContext";
import {AddObjectCommand, RemoveObjectCommand} from "@stem/editor-oss/command/Commands";
import {useAssetResolutionContext} from "@stem/editor-oss/context/AssetResolutionContext";
import Editor from "../../../editor/Editor";
import global from "@stem/editor-oss/global";
import {serializePrefab} from "@stem/editor-oss/prefab/serialization";
import {
    canConvertToPrefab,
    checkPrefabUnlock,
    getPrefabEditRevisionId,
    getPrefabId,
    isPrefab,
    isPrefabUnlocked,
    isPrefabUnlockedInScene,
    loadPrefab,
    lockPrefab,
    PrefabConversionError,
    setPrefabId,
    unlockPrefab,
} from "@stem/editor-oss/prefab/util";
import {showToast} from "@stem/editor-oss/showToast";
import Converter from "@stem/editor-oss/utils/Converter";
import {ElementsUtils} from "@stem/editor-oss/utils/ElementsUtils";
import MeshUtils from "@stem/editor-oss/utils/MeshUtils";
import {ModelUtils} from "@stem/editor-oss/utils/ModelUtils";
import {retainObjectGpuResources} from "@stem/editor-oss/core/resources/GpuResourceOwnership";
import {cloneObject} from "@stem/editor-oss/utils/ObjectUtils";
import {getScene, traverseSceneDepthFirst} from "@stem/editor-oss/utils/SceneUtil";
import {generateUniqueName, getObjectNamesInScene} from "../../../v2/pages/services";
import {useAddEditorDependencies, useCreateAssetRevisionWithData, useCreateAssetWithData} from "../../asset-management/hooks/assets";
import {useReplaceAsset} from "../../asset-management/hooks/useReplaceAsset";
import {useCanEditAsset} from "../../assets/v2/common/hooks/useCanEditAsset";
import {THUMBNAIL_SIZE} from "../../assets/v2/LeftPanel/MainTabs/AssetsTab/ModelUpload/constants";
import {useCreateThumbnailDerivative} from "../../models/hooks/models";

const getThumbnail = async (object: Object3D) => {
    const thumbnailSourceModel = object;
    const thumbnailUrl = await ModelUtils.createThumbnailFromModel(
        thumbnailSourceModel,
        THUMBNAIL_SIZE,
        THUMBNAIL_SIZE,
    );
    const thumbnailFile = Converter.dataURLtoFile(thumbnailUrl, "thumbnail");

    return {file: thumbnailFile, width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE};
};

export const useCreatePrefabRevision = () => {
    const createAssetRevisionWithData = useCreateAssetRevisionWithData();
    const createThumbnailDerivative = useCreateThumbnailDerivative();

    return async ({prefabId, revisionId, object}: {prefabId: string; revisionId: string; object: Object3D}) => {
        // Serialize the object into a prefab
        let serializeResult;
        try {
            serializeResult = serializePrefab(object);
        } catch (err) {
            showToast({type: "error", title: "Failed to save stem", body: String(err)});
            console.error("Stem failed to serialize", err);
            return;
        }

        // Create the new revision
        const revision = await createAssetRevisionWithData.mutateAsync({
            assetId: prefabId,
            parentRevisionId: revisionId,
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

        const thumbnail = await getThumbnail(object);

        if (thumbnail) {
            await createThumbnailDerivative(prefabId, revision.id, thumbnail);
        }

        return revision;
    };
};

export const useCreatePrefab = () => {
    const createAssetWithData = useCreateAssetWithData();
    const createThumbnailDerivative = useCreateThumbnailDerivative();

    return async ({object}: {object: Object3D}) => {
        // Serialize the object into a prefab
        let serializeResult;
        try {
            serializeResult = serializePrefab(object);
        } catch (err) {
            showToast({type: "error", title: "Failed to save stem", body: String(err)});
            console.error("Stem failed to serialize", err);
            return;
        }

        const asset = await createAssetWithData.mutateAsync({
            type: AssetType.Prefab,
            name: object.name,
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

        const thumbnail = await getThumbnail(object);
        if (thumbnail) {
            global.app?.call("generatingThumbnail");
            await createThumbnailDerivative(asset.id, asset.headRevisionId, thumbnail);
            global.app?.call("generatingThumbnailDone");
        }

        return asset;
    };
};

export const useAddPrefabToScene = () => {
    const {context} = useAssetResolutionContext();

    const addPrefabToScene = async (prefabId: string, position?: Vector3Like) => {
        const asset = await getAsset(prefabId);
        if (!asset) {
            throw new Error(`Failed to fetch stem ${prefabId}`);
        }

        const prefabInstance = await loadPrefab(prefabId, context);

        // Generate a unique name for the object in the scene
        const scene = global.app?.editor?.scene;
        if (scene) {
            const existingNames = scene ? getObjectNamesInScene(scene) : new Set<string>();
            prefabInstance.name = generateUniqueName(asset.name, existingNames);
        } else {
            prefabInstance.name = asset.name;
        }

        if (position) {
            prefabInstance.position.set(position.x, position.y, position.z);
        } else {
            // Position in front of camera if no specific position provided
            global.app?.editor?.moveObjectToCameraClosestPoint(prefabInstance);
        }

        global.app?.editor?.execute(new AddObjectCommand(prefabInstance)).catch(console.error);

        return prefabInstance;
    };

    return addPrefabToScene;
};

const showConvertToPrefabError = (error: PrefabConversionError) => {
    switch (error) {
        case PrefabConversionError.HasMultipleAssetRevisions:
            showToast({type: "error", title: "Object references multiple revisions of the same asset."});
            console.warn("Object references different asset revisions.");
            return;

        case PrefabConversionError.HasUnlockedPrefab:
            showToast({type: "error", title: "Object contains unlocked stems. Save any child stems first."});
            console.warn("Object contains unlocked stems.");
            return;

        default:
            break;
    }
};

export const useConvertToPrefab = () => {
    const createPrefab = useCreatePrefab();
    const updatePrefabInstances = useUpdatePrefabInstances();

    const convertToPrefab = (object: Object3D) => {
        const scene = getScene(object);
        const sceneId = global.app?.editor?.sceneID;

        if (!scene || !sceneId) {
            console.warn("Object is not part of any scene.");
            return;
        }

        // Check to see if the object can be converted to a prefab
        const error = canConvertToPrefab(object);
        if (error !== PrefabConversionError.None) {
            showConvertToPrefabError(error);
            return;
        }

        global.app?.editor?.select(null); // has to be done before serialization

        // Create / upload the prefab
        createPrefab({object})
            .then(async asset => {
                if (!asset) return console.error("[convertToPrefab]: asset is undefined");
                setPrefabId(object, asset.id);
                await updatePrefabInstances(scene, asset.id); // Reload the prefab instances
                global.app?.call("objectChanged", global.app.editor, scene);
            })
            .catch(err => {
                showToast({type: "error", title: "Failed to create stem", body: String(err)});
                console.error("Stem failed to save", err);
            });
    };

    return convertToPrefab;
};

export const useEditPrefab = () => {
    const addEditorDependencies = useAddEditorDependencies();

    const doUnlock = async (object: Object3D, sceneId: string, newDependencies: Record<string, string>) => {
        // Add new dependencies to the scene if needed
        if (Object.keys(newDependencies).length > 0) {
            try {
                await addEditorDependencies.mutateAsync(newDependencies);
            } catch (err) {
                console.error("Failed to add stem dependencies to scene", err);
                showToast({
                    type: "error",
                    title: "Failed to edit stem",
                    body: "Could not add required assets to the scene. Please try again.",
                });
                return;
            }
        }

        unlockPrefab(object);

        // Verify the unlock succeeded
        if (!isPrefabUnlocked(object)) {
            showToast({type: "error", title: "Failed to unlock stem"});
            return;
        }

        global.app?.call("objectChanged", this, object);
        showToast({type: "success", title: "Stem unlocked for editing"});
    };

    const editPrefab = async (object: Object3D) => {
        const prefabId = getPrefabId(object);
        if (!prefabId) {
            console.warn("Object is not a stem.");
            return;
        }

        const scene = getScene(object);
        if (!scene) {
            console.warn("Object is not part of any scene.");
            return;
        }

        const sceneId = global.app?.editor?.sceneID;
        if (!sceneId) {
            console.warn("Scene ID not found.");
            return;
        }

        if (isPrefabUnlockedInScene(scene, prefabId)) {
            showToast({type: "info", title: "Stem is already being edited in this scene."});
            return;
        }

        const context = getAssetResolutionContext(object, true) || emptyAssetResolutionContext;
        const currentRevisionId = resolveAssetRevisionId(prefabId, context);
        if (!currentRevisionId) {
            console.warn("Failed to resolve stem revision ID.");
            return;
        }

        try {
            const {headRevisionId} = await getAsset(prefabId);
            if (currentRevisionId !== headRevisionId) {
                showToast({type: "error", title: "Only the latest version of the stem can be edited."});
                return;
            }
        } catch (err) {
            console.error("Failed to get stem", err);
            showToast({type: "error", title: "Failed to edit stem. Please try again."});
            return;
        }

        // Check for conflicts between prefab dependencies and scene dependencies
        const sceneContext = getAssetResolutionContext(scene) || emptyAssetResolutionContext;
        const {canUnlock, conflicts, newDependencies} = checkPrefabUnlock(object, sceneContext);

        if (!canUnlock) {
            console.warn("Cannot unlock stem due to asset revision conflicts:", conflicts);
            showToast({
                type: "error",
                title: "Cannot edit stem",
                body: "The stem uses different versions of assets than this scene. Try editing it in an empty scene.",
            });
            return;
        }

        // Confirm with the user if new assets will be added to the scene
        const newDependencyCount = Object.keys(newDependencies).length;
        if (newDependencyCount > 0) {
            ElementsUtils.confirm({
                title: "Edit Stem",
                content: `Editing this stem will add ${newDependencyCount} asset${newDependencyCount > 1 ? "s" : ""} to the scene. Do you want to continue?`,
                onOK: () => doUnlock(object, sceneId, newDependencies),
            });
            return;
        }

        return doUnlock(object, sceneId, newDependencies);
    };

    return editPrefab;
};

/**
 * Reverts any changes made to the given prefab instance, reverting it back to
 * the current revision stored in the scene (or container prefab).
 *
 * @param object - The prefab instance to revert
 * @returns A promise that resolves when the revert is complete.
 */
export const useRevertPrefab = () => {
    const replacePrefabInstance = useReplacePrefabInstance();

    const revertPrefab = async (object: Object3D) => {
        const prefabId = getPrefabId(object);
        if (!prefabId) {
            console.warn("Object is not a stem.");
            return;
        }

        if (!isPrefabUnlocked(object)) {
            console.warn("Stem object is not being edited.");
            return;
        }

        // Search up the ancestor chain for a revision context.
        const context = object.parent ? getAssetResolutionContext(object.parent, true) : null;

        if (!context) {
            console.warn("No asset resolution context found for stem.");
            return;
        }

        const prefabInstance = await loadPrefab(prefabId, context);

        return replacePrefabInstance(object, prefabInstance)
            .then(() => {
                showToast({type: "success", title: "Stem reverted"});
            })
            .catch(err => {
                showToast({type: "error", title: "Failed to revert stem", body: String(err)});
                console.error("Failed to revert stem", err);
            });
    };

    const handleRevertPrefabOk = (object: Object3D) => {
        global.app?.editor?.select(null);
        revertPrefab(object)
            .then(() => {
                showToast({type: "success", title: "Stem reverted"});
            })
            .catch(err => {
                showToast({type: "error", title: "Failed to revert stem", body: String(err)});
                console.error("Failed to revert stem", err);
            });
    };

    const showRevertPrefabPrompt = (object: Object3D) => {
        ElementsUtils.confirm({
            title: "Revert Stem",
            content: "Are you sure you want to revert this stem? All changes will be lost.",
            onOK: () => handleRevertPrefabOk(object),
        });
    };

    return showRevertPrefabPrompt;
};

export const useSavePrefab = () => {
    const createPrefabRevision = useCreatePrefabRevision();
    const {setAssetRevision} = useAssetResolutionContext();
    const updatePrefabInstances = useUpdatePrefabInstances();
    const replaceAsset = useReplaceAsset();
    // canFork is independent of the asset's owner — safe to evaluate here.
    // Used to decide whether to fork-on-save when the just-edited stem
    // belongs to someone other than the scene owner.
    const {canFork} = useCanEditAsset({});

    const handleSavePrefabOk = (
        selected: Object3D,
        scene: Scene,
        prefabId: string,
        parentRevisionId: string,
        forkedFromPrefabId: string | null,
    ) => {
        // Check to see if the object can be converted to a prefab
        const error = canConvertToPrefab(selected);
        if (error !== PrefabConversionError.None) {
            showConvertToPrefabError(error);
            return;
        }
        global.app?.editor?.select(null); // has to be done before serialization

        createPrefabRevision({
            prefabId,
            revisionId: parentRevisionId,
            object: selected,
        })
            .then(revision => {
                if (!revision) return console.error("[createPrefabRevision]: revision is undefined");

                if (forkedFromPrefabId) {
                    // Fork-on-save: swap every scene reference from the old
                    // prefab id to the fork. replaceAsset → useChangePrefabRevision
                    // pins the new revision, reloads the OTHER locked instances
                    // with the just-saved content (the unlocked just-edited
                    // instance is skipped by the isPrefabUnlocked check; we
                    // also pass it via excludeUuids for explicitness), and
                    // mapAssetIds rewrites every prefabId reference.
                    replaceAsset({
                        originalAssetId: forkedFromPrefabId,
                        newAssetId: prefabId,
                        newRevisionId: revision.id,
                        assetType: AssetType.Prefab,
                        excludeUuids: [selected.uuid],
                    })
                        .then(() => {
                            lockPrefab(selected);
                            saveScene().catch(console.error);
                            showToast({type: "success", title: "Stem saved"});
                            global.app?.call("objectChanged", global.app.editor, scene);
                        })
                        .catch(err => {
                            showToast({type: "error", title: "Failed to save stem", body: String(err)});
                            console.error("Stem failed to swap refs after fork", err);
                        });
                } else {
                    setAssetRevision(prefabId, revision.id);
                    lockPrefab(selected);
                    // without saving a scene on edit, prefab gets broken after page refresh - no ability to edit again due to different revisionId vs headRevisionId
                    saveScene().catch(console.error);
                    showToast({type: "success", title: "Stem saved"});

                    updatePrefabInstances(scene, prefabId)
                        .then(() => {
                            global.app?.call("objectChanged", global.app.editor, scene);
                        })
                        .catch(console.error);
                }
            })
            .catch(err => {
                showToast({type: "error", title: "Failed to save stem", body: String(err)});
                console.error("Stem failed to save", err);
            });
    };

    const savePrefab = async (object: Object3D) => {
        const scene = getScene(object);
        if (!scene) {
            console.warn("Stem object is not part of any scene.");
            return;
        }

        const prefabId = getPrefabId(object);
        if (!prefabId) {
            console.warn("Object is not a stem.");
            return;
        }

        const prefabEditRevisionId = getPrefabEditRevisionId(object);
        if (!prefabEditRevisionId) {
            console.warn("Stem object is not being edited.");
            return;
        }

        // Determine the latest version of the prefab AND its owner. The
        // owner check drives fork-on-save below.
        let asset;
        try {
            asset = await getAsset(prefabId);
        } catch (err) {
            console.error("Failed to get prefab", err);
            showToast({type: "error", title: "Failed to save stem. Please try again."});
            return;
        }

        const isOutOfDate = prefabEditRevisionId !== asset.headRevisionId;
        const parentRevisionId = isOutOfDate ? asset.headRevisionId : prefabEditRevisionId;

        // Decide whether this save needs to fork. The user's "Save" click
        // (after the confirm dialog) is the explicit consent — no separate
        // fork prompt.
        const sceneOwnerId = global.app?.editor?.projectUserId;
        const assetBelongsToSceneOwner =
            !!asset.userId && !!sceneOwnerId && asset.userId === sceneOwnerId;
        const shouldFork = !assetBelongsToSceneOwner && canFork;

        const proceed = async () => {
            if (shouldFork) {
                let forked;
                try {
                    forked = await forkAsset({assetId: prefabId, revisionId: parentRevisionId});
                } catch (err) {
                    console.error("Failed to fork stem for saving", err);
                    showToast({
                        type: "error",
                        title: "Failed to save stem",
                        body: "Could not create your own copy of this stem. Please try again.",
                    });
                    return;
                }
                handleSavePrefabOk(object, scene, forked.assetId, forked.revisionId, prefabId);
            } else {
                handleSavePrefabOk(object, scene, prefabId, parentRevisionId, null);
            }
        };

        if (isOutOfDate) {
            // If the user chooses "OK", use the scene revision ID to save, since
            // that is the latest version (unless the prefab has been edited
            // externally).
            ElementsUtils.confirm({
                title: "Stem modified",
                content:
                    "The stem has been modified while you were editing it. Saving the stem will overwrite those changes. Do you want to continue?",
                onOK: () => { void proceed(); },
            });
            return;
        }

        ElementsUtils.confirm({
            title: "Confirm",
            content: "Saving the stem will update all its instances in the scene. Do you want to continue?",
            onOK: () => { void proceed(); },
        });
    };

    return savePrefab;
};

export const useReplacePrefabInstance = () => {
    const replacePrefabInstance = async (editor: Editor, target: Object3D, prefabInstance: Object3D) => {
        if (!isPrefab(target)) {
            throw new Error("Target object is not a stem instance");
        }

        const parent = target.parent;
        if (!parent) {
            throw new Error("Target object has no parent");
        }

        // Keep certain properties from the original object
        prefabInstance.uuid = target.uuid;
        prefabInstance.name = target.name;
        prefabInstance.position.copy(target.position);
        prefabInstance.quaternion.copy(target.quaternion);
        prefabInstance.scale.copy(target.scale);
        prefabInstance.visible = target.visible;
        prefabInstance.castShadow = target.castShadow;
        prefabInstance.receiveShadow = target.receiveShadow;

        // Replace old object with new prefab instance, remove prefabId from old object to make sure that every children are properly disposed
        delete target.userData?.prefabId;
        await editor.execute(new RemoveObjectCommand(target));
        await editor.execute(new AddObjectCommand(prefabInstance, parent));
    };

    return (target: Object3D, prefabInstance: Object3D) => {
        const editor = global.app?.editor;
        if (!editor) {
            throw new Error("Cannot replace stem instance. Editor not found.");
        }

        return replacePrefabInstance(editor, target, prefabInstance);
    };
};

/**
 * Update all prefab instances in the scene (or prefab) to the current revision
 * stored in the scene's asset resolution context.
 *
 * @param object - The scene or prefab
 * @param prefabId - The prefab ID to update
 * @returns A promise that resolves when the update is complete.
 */
export const useUpdatePrefabInstances = () => {
    const replacePrefabInstance = useReplacePrefabInstance();

    const updatePrefabInstances = async (
        object: Object3D,
        prefabId: string,
        newPrefabId?: string,
        options: {excludeUuids?: string[]} = {},
    ) => {
        const context = getAssetResolutionContext(object) || emptyAssetResolutionContext;
        // Load the replacement prefab using the effective id — same as
        // prefabId for legacy revision changes; the new fork id when
        // swapping asset references on fork-on-edit.
        const loadId = newPrefabId ?? prefabId;
        const prefab = await loadPrefab(loadId, context);
        retainObjectGpuResources(prefab);

        const excludeSet = new Set(options.excludeUuids ?? []);
        const instances: Object3D[] = [];
        traverseSceneDepthFirst(object, obj => {
            if (
                getPrefabId(obj) === prefabId &&
                !isPrefabUnlocked(obj) &&
                !excludeSet.has(obj.uuid)
            ) {
                instances.push(obj);
                return false; // stop traversing child prefab instances
            }

            const isChildPrefab = isPrefab(obj) && obj !== object;
            const isServerObject = Boolean(obj.userData?.Server);
            const shouldTraverseChildren = !isChildPrefab && !isServerObject;

            return shouldTraverseChildren;
        });

        for (const instance of instances) {
            const newInstance = cloneObject(prefab);
            retainObjectGpuResources(newInstance);
            try {
                await replacePrefabInstance(instance, newInstance);
            } catch (error) {
                MeshUtils.dispose(newInstance);
                throw error;
            }
        }

        MeshUtils.dispose(prefab);
    };

    return (
        object: Object3D,
        prefabId: string,
        newPrefabId?: string,
        options: {excludeUuids?: string[]} = {},
    ) => {
        return updatePrefabInstances(object, prefabId, newPrefabId, options)
            .then(() => {
                showToast({
                    type: "success",
                    title: "Updated stem instances",
                });
            })
            .catch(error => {
                console.error("Failed to update stem instances", error);
                showToast({
                    type: "error",
                    title: "Failed to update stem instances",
                });
            });
    };
};
