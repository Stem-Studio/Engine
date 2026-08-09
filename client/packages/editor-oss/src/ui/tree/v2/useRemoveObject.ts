import {useCallback} from "react";
import * as THREE from "three";
import {GLTFExporter} from "three/addons/exporters/GLTFExporter.js";
import * as WebGLTextureUtils from "three/addons/utils/WebGLTextureUtils.js";

import {getAsset} from "@stem/network/api/asset";
import {resolveAssetRevisionId} from "../../../asset-management/AssetResolutionContext";
import {RemoveObjectCommand} from "../../../command/Commands";
import {useAssetResolutionContext} from "../../../context/AssetResolutionContext";
import {deleteManagedPlanCadObject} from "../../../editor/assets/v2/PlanMode/planCadEditorBridge";
import {useChangeModelRevision} from "../../../editor/asset-management/hooks/useChangeModelRevision";
import {DEFAULT_UPLOAD_SETTINGS} from "../../../editor/assets/v2/LeftPanel/MainTabs/AssetsTab/ModelUpload/constants";
import {useCreateModelRevision} from "../../../editor/models/hooks/models";
import global from "../../../global";
import {createLods} from "../../../model/load-util";
import {showToast} from "../../../showToast";
import Converter from "../../../utils/Converter";
import {ElementsUtils} from "../../../utils/ElementsUtils";
import {ModelUtils} from "../../../utils/ModelUtils";
import {getChildIndexPath, getObjectByChildIndexPath} from "./removeObjectClonePath";

interface ModelUpdateArgs {
    parent: THREE.Object3D<THREE.Object3DEventMap>;
    modelID: string;
    objectToRemove: THREE.Object3D<THREE.Object3DEventMap>;
}

export const useRemoveObject = () => {
    const app = global.app!;
    const createModelRevision = useCreateModelRevision();
    const {context} = useAssetResolutionContext();
    const changeModelRevision = useChangeModelRevision();

    const handleModelEditConfirmation = async (args: ModelUpdateArgs) => {
        ElementsUtils.confirm({
            title: `Are you sure you want to delete ${args.objectToRemove.name}?`,
            content: `Deleting this object will update the ${args.parent.name} model. Continue with delete?`,
            onOK: async () => await handleModelRevisionChange(args),
        });
    };

    const generateThumbnail = async (parent: THREE.Object3D<THREE.Object3DEventMap>) => {
        try {
            const thumbDataUrl = await ModelUtils.createThumbnailFromModel(parent);

            const thumbFile = Converter.dataURLtoFile(thumbDataUrl, "thumbnail");

            return {
                file: thumbFile,
                width: 512,
                height: 512,
            };
        } catch (e) {
            console.error("Thumbnail generation failed", e);
        }
    };

    const generateLODs = async (parent: THREE.Object3D<THREE.Object3DEventMap>, arrayBuffer: ArrayBuffer) => {
        try {
            const lodSettings = DEFAULT_UPLOAD_SETTINGS.lodSettings;

            if (lodSettings) {
                const lods = await createLods(
                    arrayBuffer,
                    parent.userData?.Name || "model.glb",
                    {lodSettings},
                    new AbortController().signal,
                );
                return lods;
            }
        } catch (e) {
            console.error("LOD generation failed", e);
        }
    };

    const handleModelRevisionChange = async (args: ModelUpdateArgs) => {
        const {parent, modelID, objectToRemove} = args;

        try {
            const asset = await getAsset(modelID);
            if (!asset) return;
            const parentRevisionId = resolveAssetRevisionId(modelID, context);

            if (!parentRevisionId) {
                throw new Error("Failed to resolve parent revision ID");
            }

            if (parentRevisionId !== asset.headRevisionId) {
                showToast({
                    type: "warning",
                    title: "Editable only in the latest revision",
                });
                return;
            }

            const removalPath = getChildIndexPath(parent, objectToRemove);

            const exportTarget = parent.clone(true);

            exportTarget.position.set(0, 0, 0);
            exportTarget.rotation.set(0, 0, 0);
            exportTarget.scale.set(1, 1, 1);

            exportTarget.updateMatrixWorld(true);
            const clonedToRemove = removalPath ? getObjectByChildIndexPath(exportTarget, removalPath) : null;

            if (!clonedToRemove) {
                console.warn("Cloned object to remove not found!");
            } else {
                (clonedToRemove as THREE.Object3D).parent?.remove(clonedToRemove as THREE.Object3D);
                console.log("Object removed from export clone");
            }

            exportTarget.updateMatrixWorld(true);

            // -------------------------------------------------
            // EXPORT GLB
            // -------------------------------------------------

            const exporter = new GLTFExporter();
            exporter.setTextureUtils(WebGLTextureUtils);

            const arrayBuffer: ArrayBuffer = await new Promise((resolve, reject) => {
                exporter.parse(
                    exportTarget,
                    result => {
                        if (result instanceof ArrayBuffer) {
                            resolve(result);
                        } else {
                            resolve(new TextEncoder().encode(JSON.stringify(result)).buffer);
                        }
                    },
                    error => reject(error),
                    {
                        binary: true,
                        trs: false,
                        includeCustomExtensions: true,
                    },
                );
            });

            const thumbnail = await generateThumbnail(parent);
            const lods: any[] = (await generateLODs(parent, arrayBuffer)) || [];

            // -------------------------------------------------
            // COMPRESSION
            // -------------------------------------------------

            let finalArrayBuffer = arrayBuffer;

            try {
                finalArrayBuffer = (await ModelUtils.compressModel(
                    finalArrayBuffer,
                    {isJSON: false},
                    () => {},
                )) as ArrayBuffer;
            } catch (e) {
                console.error("Compression failed", e);
            }

            // -------------------------------------------------
            // SAVE REVISION
            // -------------------------------------------------

            const contentType = "model/gltf-binary";

            const blob = new Blob([finalArrayBuffer], {
                type: contentType,
            });

            const revision = await createModelRevision({
                id: modelID,
                parentRevisionId,
                format: "glb",
                contentType,
                blob,
                lods,
                thumbnail,
            });

            await changeModelRevision(modelID, revision.id);

            app.call("objectRemoved", this, objectToRemove);
        } catch (error) {
            console.error("REVISION CHANGE FAILED:", error);
        }
    };

    return useCallback(async (event: React.MouseEvent<HTMLDivElement, MouseEvent>, objectUuid: string) => {
        event.stopPropagation();

        const objectToRemove = app.editor?.objectByUuid(objectUuid);
        if (!objectToRemove || !objectToRemove.parent) return;

        if (await deleteManagedPlanCadObject(app.editor, objectToRemove)) return;

        const modelID = objectToRemove.parent?.userData?.modelId as string | undefined;

        // Not an asset → normal remove
        if (!modelID) {
            return app.editor!.execute(new RemoveObjectCommand(objectToRemove));
        }

        const parent = objectToRemove.parent;
        await handleModelEditConfirmation({parent, modelID, objectToRemove});
    }, []);
};
