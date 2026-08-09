import {useMemo} from "react";
import {AnimationClip, Box3, Object3D, Vector3} from "three";
import {GLTFExporter} from "three/addons/exporters/GLTFExporter.js";
import * as WebGLTextureUtils from "three/addons/utils/WebGLTextureUtils.js";
import {toast} from "toastywave";

import {AssetDerivativeType, AssetType, forkAsset, getAsset, SUPPORTED_MODEL_CONTENT_TYPES} from "@stem/network/api/asset";
import {ApiClientOptions} from "@stem/network/api/client";
import {DomainAssetDto} from "@stem/network/api/client/api";
import {
    emptyAssetResolutionContext,
    getAssetResolutionContext,
    resolveAssetRevisionId,
} from "@stem/editor-oss/asset-management/AssetResolutionContext";
import {AddObjectCommand, AttachBehaviorCommand, RemoveObjectCommand} from "@stem/editor-oss/command/Commands";
import {useModelsTabContext} from "@stem/editor-oss/context";
import {useAssetResolutionContext} from "@stem/editor-oss/context/AssetResolutionContext";
import {FileData} from "../../../editor/assets/v2/types/file";
import Editor from "../../../editor/Editor";
import global from "@stem/editor-oss/global";
import {CreateModelParams, ModelLod, Thumbnail} from "@stem/editor-oss/model/createModelWithData";
import {createLods, loadModel} from "@stem/editor-oss/model/load-util";
import {isModelAssetInstance} from "@stem/editor-oss/model/util";
import {showToast} from "@stem/editor-oss/showToast";
import Converter from "@stem/editor-oss/utils/Converter";
import MeshUtils from "@stem/editor-oss/utils/MeshUtils";
import {ModelUtils} from "@stem/editor-oss/utils/ModelUtils";
import {cloneObject} from "@stem/editor-oss/utils/ObjectUtils";
import {cloneJsonCompatible} from "@stem/editor-oss/utils/cloneJsonCompatible";
import {generateUniqueName, getObjectNamesInScene} from "../../../v2/pages/services";
import {
    useCreateAssetDerivativeWithData,
    useCreateAssetRevisionWithData,
    useCreateAssetWithData,
    useGetAsset,
    useGetAssetRevision,
    useListEditorAssets,
} from "../../asset-management/hooks/assets";
import {useChangeModelRevision} from "../../asset-management/hooks/useChangeModelRevision";
import {useReplaceAsset} from "../../asset-management/hooks/useReplaceAsset";
import {useCanEditAsset} from "../../assets/v2/common/hooks/useCanEditAsset";
import {DEFAULT_UPLOAD_SETTINGS} from "../../assets/v2/LeftPanel/MainTabs/AssetsTab/ModelUpload/constants";
import {LodSettings, UploadSettings} from "../../assets/v2/LeftPanel/MainTabs/AssetsTab/ModelUpload/types";
import {applyMaterialSettingsToObject} from "../../assets/v2/materials/materialUtils";

export type ModelData = {
    id: string;
    name: string;
    userId?: string;
    thumbnailUrl?: string;
    isAvatar?: boolean;
    IsAIGenerated?: boolean;
    isLegacy?: boolean;
};

export const useAddModelToScene = () => {
    const {context} = useAssetResolutionContext();
    const getAsset = useGetAsset();
    const {modelsData, modelsDataForSceneID, loadModelToScene} = useModelsTabContext();
    const getAssetRevision = useGetAssetRevision();

    const addModelToScene = async (modelId: string) => {
        const isLegacyModel = [...(modelsData || []), ...(modelsDataForSceneID || [])].some(
            model => model.ID === modelId,
        );
        if (isLegacyModel) {
            return new Promise<Object3D>((resolve, reject) => {
                loadModelToScene(modelId, resolve, reject);
            });
        }

        const asset = await getAsset(modelId);
        if (!asset) {
            throw new Error(`Failed to fetch model ${modelId}`);
        }

        const object = await loadModel(modelId, context);
        if (!object) {
            throw new Error(`Failed to load model ${modelId}`);
        }

        const data = await getAssetRevision(asset.id, asset.headRevisionId, {includeMetadata: true});
        if (data.metadata?.avatarType) {
            global.app?.editor
                ?.execute(new AttachBehaviorCommand(object, data.metadata.avatarType as string).execute())
                .catch(console.error);
        }

        // Generate a unique name for the object in the scene
        const scene = global.app?.editor?.scene;
        if (scene) {
            const existingNames = scene ? getObjectNamesInScene(scene) : new Set<string>();
            object.name = generateUniqueName(asset.name, existingNames);
        } else {
            object.name = asset.name;
        }

        global.app?.editor?.moveObjectToCameraClosestPoint(object);
        global.app?.editor?.execute(new (AddObjectCommand as any)(object)).catch(console.error);

        return object;
    };

    return addModelToScene;
};

export type ListSceneModelsOptions = {
    legacyModelsAsArg?: FileData[];
    apiClientOptions?: ApiClientOptions;
    enabled?: boolean;
};

/**
 * Get a list of models for the current editing session (scene or stem).
 *
 * @remarks
 * This hook retrieves both legacy and new models.
 *
 * @param options - Options for the hook
 * @returns A list of models.
 */
export const useListEditorModels = (options: ListSceneModelsOptions = {}): DomainAssetDto[] | ModelData[] => {
    const {modelsDataForSceneID = []} = useModelsTabContext() || {};

    let legacyModels = modelsDataForSceneID;

    if (options.legacyModelsAsArg) {
        legacyModels = legacyModels.concat(options.legacyModelsAsArg);
    }

    const {data: modelsData} = useListEditorAssets({
        types: [AssetType.Model],
        enabled: options.enabled ?? true,
        includeThumbnails: true,
    });

    // Combine legacy and new models
    const allModels = useMemo(() => {
        const assets = modelsData?.assets || [];

        return [
            ...(legacyModels ?? []).map(legacyModel => ({
                id: legacyModel.ID,
                name: legacyModel.Name,
                thumbnailUrl: legacyModel.Thumbnail,
                isAvatar: legacyModel.IsAvatar,
                isLegacy: true,
                userId: undefined,
            })),
            ...assets.map(model => ({
                ...model,
                isAvatar: false,
                isLegacy: false,
                userId: model.userId,
            })),
        ];
    }, [legacyModels, modelsData]);

    return allModels;
};

const useCreateLodDerivatives = () => {
    const createAssetDerivativeWithData = useCreateAssetDerivativeWithData();

    return async (assetId: string, revisionId: string, lods: ModelLod[]) => {
        const lodPromises = lods.map(async lod => {
            const extension = lod.file.name.split(".").pop()?.toLowerCase() || "";
            const derivative = await createAssetDerivativeWithData.mutateAsync({
                assetId,
                revisionId,
                type: AssetDerivativeType.Model,
                format: extension,
                contentType: lod.file.type,
                contentEncoding: "gzip",
                data: lod.file,
                lodLevel: lod.level,
                metadata: {
                    polygonCount: lod.polygonCount,
                    vertexCount: lod.vertexCount,
                    compression: lod.compression,
                },
            });

            return derivative;
        });

        await Promise.all(lodPromises);
    };
};

export const useCreateThumbnailDerivative = () => {
    const createAssetDerivativeWithData = useCreateAssetDerivativeWithData();

    return async (assetId: string, revisionId: string, thumbnail: Thumbnail) => {
        const extension = thumbnail.file.name.split(".").pop()?.toLowerCase() || "";
        await createAssetDerivativeWithData.mutateAsync({
            assetId,
            revisionId,
            type: AssetDerivativeType.Thumbnail,
            format: extension,
            contentType: thumbnail.file.type,
            data: thumbnail.file,
            metadata: {
                width: thumbnail.width,
                height: thumbnail.height,
            },
        });
    };
};

export const useCreateModel = () => {
    const createAssetWithDataHook = useCreateAssetWithData();
    const createLodDerivatives = useCreateLodDerivatives();
    const createThumbnailDerivative = useCreateThumbnailDerivative();

    return async ({
        name,
        blob,
        format,
        contentType,
        lods,
        thumbnail,
        metadata,
    }: Omit<CreateModelParams, "assetSource">) => {
        // Create the primary asset using the hook (for React Query integration)
        const asset = await createAssetWithDataHook.mutateAsync({
            type: AssetType.Model,
            name,
            data: blob,
            format,
            contentType,
            contentEncoding: "gzip",
            options: {
                metadata,
            },
        });

        // Create LOD derivatives
        if (lods) {
            await createLodDerivatives(asset.id, asset.headRevisionId, lods);
        }

        if (thumbnail) {
            await createThumbnailDerivative(asset.id, asset.headRevisionId, thumbnail);
        }

        return asset;
    };
};

type CreateModelRevisionParams = {
    id: string;
    parentRevisionId: string;
    format: string;
    contentType: string;
    blob: Blob;
    lods?: ModelLod[];
    thumbnail?: {
        file: File;
        width: number;
        height: number;
    };
    metadata?: Record<string, any>;
};

export const useCreateModelRevision = () => {
    const createAssetRevisionWithData = useCreateAssetRevisionWithData();
    const createLodDerivatives = useCreateLodDerivatives();
    const createThumbnailDerivative = useCreateThumbnailDerivative();

    return async ({
        id,
        parentRevisionId,
        format,
        contentType,
        blob,
        lods,
        thumbnail,
        metadata,
    }: CreateModelRevisionParams) => {
        // Create the new revision
        const revision = await createAssetRevisionWithData.mutateAsync({
            assetId: id,
            parentRevisionId,
            data: blob,
            format,
            contentType,
            contentEncoding: "gzip",
            options: {
                metadata,
            },
        });

        if (lods) {
            await createLodDerivatives(id, revision.id, lods);
        }

        if (thumbnail) {
            await createThumbnailDerivative(id, revision.id, thumbnail);
        }

        return revision;
    };
};

/**
 * Update all model instances in the scene to the current revision.
 *
 * @remarks
 * Call this after changing a model asset's revision.
 *
 * @returns A function that updates the model instances in the scene.
 */
export const useUpdateModelInstances = () => {
    const updateModelInstances = async (editor: Editor, root: Object3D, objectUuids: string[], modelId: string) => {
        if (objectUuids.length === 0) {
            return;
        }

        const context = getAssetResolutionContext(root) || emptyAssetResolutionContext;
        const model = await loadModel(modelId, context);

        const instances: Object3D[] = [];
        root.traverse(object => {
            if (objectUuids.includes(object.uuid)) {
                instances.push(object);
            }
        });

        for (const instance of instances) {
            const newInstance = cloneObject(model);
            await replaceModelInstance(editor, instance, newInstance, context);
        }

        MeshUtils.dispose(model);
    };

    const replaceModelInstance = async (
        editor: Editor,
        target: Object3D,
        modelInstance: Object3D,
        context: ReturnType<typeof useAssetResolutionContext>["context"],
    ) => {
        const isServerObject = Boolean(target.userData?.Server);
        if (!isServerObject && !isModelAssetInstance(target)) {
            throw new Error("Target object is not a model instance");
        }

        const parent = target.parent;
        if (!parent) {
            throw new Error("Target object has no parent");
        }

        // Keep certain properties from the original object
        modelInstance.uuid = target.uuid;
        modelInstance.name = target.name;
        modelInstance.position.copy(target.position);
        modelInstance.quaternion.copy(target.quaternion);
        modelInstance.scale.set(1, 1, 1);
        modelInstance.visible = target.visible;
        modelInstance.castShadow = target.castShadow;
        modelInstance.receiveShadow = target.receiveShadow;
        modelInstance.userData = {
            ...cloneJsonCompatible(target.userData),
            ...modelInstance.userData,
        };

        // Remove legacy server object properties
        delete modelInstance.userData.ID;
        delete modelInstance.userData.Url;
        delete modelInstance.userData.Server;

        // Use bouding box to scale the new object to the same size as the original
        const boundingBox = new Box3().setFromObject(target);
        const originalSize = boundingBox.getSize(new Vector3());

        modelInstance.updateMatrixWorld(true);
        const newBoundingBox = new Box3().setFromObject(modelInstance);
        const newSize = newBoundingBox.getSize(new Vector3());

        // Apply a uniform scale to the new object
        const scaleX = originalSize.x / newSize.x;
        const scaleY = originalSize.y / newSize.y;
        const scaleZ = originalSize.z / newSize.z;
        const averageScale = (scaleX + scaleY + scaleZ) / 3;
        modelInstance.scale.set(averageScale, averageScale, averageScale);

        applyMaterialSettingsToObject(modelInstance, modelInstance.userData.materialSettings, context);

        await editor.execute(new AddObjectCommand(modelInstance, parent));
        await editor.execute(new RemoveObjectCommand(target));
    };

    return (modelId: string, objectUuids: string[]) => {
        const editor = global.app?.editor;
        if (!editor) {
            throw new Error("Cannot update model instances. Editor not found.");
        }

        const scene = editor.scene;
        if (!scene) {
            throw new Error("Cannot update model instances. Scene not found.");
        }

        return updateModelInstances(editor, scene, objectUuids, modelId)
            .then(() => {
                showToast({
                    type: "success",
                    title: "Updated model instances",
                });
            })
            .catch(error => {
                console.error("Failed to update model instances", error);
                showToast({
                    type: "error",
                    title: "Failed to update model instances",
                });
            });
    };
};

const detectModelFormat = (filename?: string | null): string | null => {
    if (!filename) return null;
    const extension = filename.split(".").pop()?.toUpperCase();
    if (!extension) return null;
    switch (extension) {
        case "GLB":
            return "GLB";
        case "GLTF":
        case "GLTF2":
            return "GLTF";
        case "VRM":
            return "VRM";
        default:
            return null;
    }
};

export type SaveModelParams = {
    /**
     * In-scene Object3D referencing the model asset (carries
     * `userData.modelId`). Used to look up the original asset id and the
     * format hint, and is mutated post-fork so a second save in the same
     * session reads the fork id.
     */
    selection: Object3D;
    /**
     * Object3D tree to serialize as GLB. Often a separate preview clone
     * that the editor has been mutating in-memory. If it has children, the
     * children are serialized; otherwise the object itself.
     */
    exportSource: Object3D;
    /** Format hint; auto-detected from `selection.userData.Name` if omitted. */
    format?: string | null;
    /** Animation clips to embed in the GLB export. Defaults to none. */
    animations?: AnimationClip[];
    /**
     * Optional callback invoked after the exporter is constructed but
     * before `parse()` runs. Use this to register custom GLTF plugins
     * (e.g. the EARTH animation graph extension) without making the
     * generic save logic aware of them.
     */
    configureExporter?: (exporter: GLTFExporter) => void;
};

export type SaveModelResult = {
    assetId: string;
    revisionId: string;
};

/**
 * Hook that persists an in-place model edit by exporting GLB content,
 * forking the underlying asset first when the user is a contributor on
 * the scene but doesn't own it. The user's "Save" click is the explicit
 * consent — there's no separate fork prompt.
 *
 * Mirrors `useSavePrefab` and `useSaveVfx` for models. The hook owns the
 * persistence concerns (fork, GLB export, thumbnail/LODs, revision
 * creation, scene-instance reload); animation-specific or other custom
 * exporter plugins are injected via `configureExporter`.
 *
 * @returns A function that persists the model edit and returns the saved
 *   {assetId, revisionId}, or null if the save failed.
 */
export const useSaveModel = () => {
    const createModelRevision = useCreateModelRevision();
    const changeModelRevision = useChangeModelRevision();
    const replaceAsset = useReplaceAsset();
    const {context: assetResolutionContext, setAssetRevision} = useAssetResolutionContext();
    // canFork is independent of the asset's owner — safe to evaluate at
    // hook setup. Ownership is computed inline below from the fetched
    // asset's userId.
    const {canFork} = useCanEditAsset({});

    return async ({
        selection,
        exportSource,
        format,
        animations,
        configureExporter,
    }: SaveModelParams): Promise<SaveModelResult | null> => {
        const originalAssetId = selection?.userData?.modelId as string | undefined;
        if (!originalAssetId) {
            console.warn("[useSaveModel] selection has no modelId — nothing to persist.");
            return null;
        }

        // Pre-export fork check.
        let asset;
        try {
            asset = await getAsset(originalAssetId);
        } catch (err) {
            console.error("[useSaveModel] Failed to fetch model asset", err);
            showToast({type: "error", title: "Failed to save model"});
            return null;
        }

        const sceneOwnerId = global.app?.editor?.projectUserId;
        const assetBelongsToSceneOwner = !!asset.userId && !!sceneOwnerId && asset.userId === sceneOwnerId;

        let effectiveAssetId = originalAssetId;
        let forkedAssetId: string | null = null;
        if (!assetBelongsToSceneOwner && canFork) {
            try {
                const forked = await forkAsset({
                    assetId: originalAssetId,
                    revisionId: asset.headRevisionId,
                });
                // Pin the fork's head so resolveAssetRevisionId resolves
                // cleanly when createModelRevision runs below.
                setAssetRevision(forked.assetId, forked.revisionId);
                effectiveAssetId = forked.assetId;
                forkedAssetId = forked.assetId;
            } catch (err) {
                console.error("[useSaveModel] Failed to fork model asset", err);
                showToast({
                    type: "error",
                    title: "Failed to save model",
                    body: "Could not create your own copy of this model. Please try again.",
                });
                return null;
            }
        }

        const fmt = format ?? detectModelFormat(selection?.userData?.Name as string | undefined);
        const formatStr = (fmt || "GLB").toLowerCase();
        const contentType =
            (SUPPORTED_MODEL_CONTENT_TYPES as Record<string, [string, ...string[]]>)[formatStr]?.[0] ||
            "model/gltf-binary";

        // Set up exporter and let the caller register any custom plugins.
        const gltfExporter = new GLTFExporter();
        gltfExporter.setTextureUtils(WebGLTextureUtils);
        configureExporter?.(gltfExporter);

        // Wrap the callback-based parse() in a Promise so the rest of the
        // flow can read linearly.
        let result: ArrayBuffer | object;
        try {
            result = await new Promise<ArrayBuffer | object>((resolve, reject) => {
                gltfExporter.parse(
                    exportSource.children?.length > 0 ? exportSource.children : exportSource,
                    res => resolve(res),
                    err => reject(err),
                    {
                        trs: true,
                        binary: !fmt || fmt === "GLB",
                        includeCustomExtensions: true,
                        animations: animations ?? [],
                    },
                );
            });
        } catch (err) {
            console.error("[useSaveModel] GLB export failed", err);
            showToast({type: "error", title: "Failed to save model"});
            return null;
        }

        try {
            let blob: Blob;
            let lods: ModelLod[] = [];
            let thumbnail: Thumbnail | undefined;

            if (result instanceof ArrayBuffer) {
                let arrayBuffer = result;

                try {
                    const thumbDataUrl = await ModelUtils.createThumbnailFromModel(exportSource);
                    const thumbFile = Converter.dataURLtoFile(thumbDataUrl, "thumbnail");
                    thumbnail = {file: thumbFile, width: 512, height: 512};
                } catch (e) {
                    console.error("[useSaveModel] Failed to generate thumbnail", e);
                }

                try {
                    // LOD settings live on the asset's metadata. After fork,
                    // the fork inherits its source's metadata so reading
                    // either yields the same settings.
                    const effectiveAsset = await getAsset(effectiveAssetId);
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const lodSettings = (effectiveAsset as any)?.metadata?.lodSettings as LodSettings[] | undefined;
                    const settingsToUse = lodSettings || DEFAULT_UPLOAD_SETTINGS.lodSettings;
                    if (settingsToUse) {
                        const uploadSettings: UploadSettings = {lodSettings: settingsToUse};
                        const name = (selection?.userData?.Name as string | undefined) || "model.glb";
                        lods = await createLods(arrayBuffer, name, uploadSettings, new AbortController().signal);
                    }
                } catch (e) {
                    console.error("[useSaveModel] Failed to generate LODs", e);
                }

                arrayBuffer = (await ModelUtils.compressModel(arrayBuffer, {isJSON: false}, () => {
                    toast.warning("Could not compress model");
                })) as ArrayBuffer;
                blob = new Blob([arrayBuffer], {type: contentType});
            } else {
                blob = new Blob([JSON.stringify(result)], {type: contentType});
            }

            const parentRevisionId = resolveAssetRevisionId(effectiveAssetId, assetResolutionContext);
            if (!parentRevisionId) {
                throw new Error("Failed to resolve parent revision id for asset");
            }

            const revision = await createModelRevision({
                id: effectiveAssetId,
                parentRevisionId,
                format: formatStr,
                contentType,
                blob,
                lods,
                thumbnail,
            });
            if (!revision?.id) {
                throw new Error("createModelRevision returned no revision id");
            }

            if (forkedAssetId) {
                // Fork-on-save: swap every scene reference from the old
                // model id to the fork, pin the just-saved revision, and
                // reload all in-scene model instances with the new content.
                await replaceAsset({
                    originalAssetId,
                    newAssetId: forkedAssetId,
                    newRevisionId: revision.id,
                    assetType: AssetType.Model,
                });
                // Patch selection.userData.modelId to the fork id so a
                // second save in the same session reads the fork (avoiding
                // double-fork on the orphan ref left when RemoveObjectCommand
                // clears editor.selected during the instance swap).
                if (selection?.userData) {
                    selection.userData.modelId = forkedAssetId;
                }
            } else {
                await changeModelRevision(originalAssetId, revision.id);
            }

            showToast({type: "success", title: "Model revision created"});
            return {assetId: effectiveAssetId, revisionId: revision.id};
        } catch (err) {
            console.error("[useSaveModel]", err);
            showToast({type: "error", title: "Failed to create model revision"});
            return null;
        }
    };
};
