import {useCallback, useEffect, useState} from "react";
import {createPortal} from "react-dom";
import type {Vector3Like} from "three";

import {EmptyAssetsState} from "./EmptyAssetsState";
import {saveScene} from "@stem/network/api/scene";
import type {AssetRef} from "@stem/editor-oss/asset-management/AssetRef";
import {useModelsTabContext} from "@stem/editor-oss/context";
import {useRemoveAssetsAndInstancesFromScene} from "../../../../../../../editor/asset-management/hooks/scene";
import {
    UPLOAD_FILE_TYPE,
    UploadView,
    UploadViewProps,
} from "../../../../../../../editor/assets/v2/AssetsLibrary/UploadView/UploadView";
import global from "@stem/editor-oss/global";
import {showToast} from "@stem/editor-oss/showToast";
import Ajax from "@stem/editor-oss/utils/Ajax";
import {ElementsUtils} from "@stem/editor-oss/utils/ElementsUtils";
import {backendUrlFromPath} from "@stem/editor-oss/utils/UrlUtils";
import {useChangeModelRevision} from "../../../../../../asset-management/hooks/useChangeModelRevision";
import {ModelData, useAddModelToScene} from "../../../../../../models/hooks/models";
import {AssetItem, AssetsList} from "../../../../common/AssetsList";

const DELETE_WARNING =
    "Deleting this asset will remove all instances of it from your project. This can not be undone. Do you want to continue?";

export const ModelsTab = ({search}: {search: string}) => {
    const app = global.app!;
    const {selectedItemId, handleDeleteFromScene, modelsForScene} = useModelsTabContext();
    const [isUploadViewOpen, setIsUploadViewOpen] = useState(false);
    const [originalAsset, setOriginalAsset] = useState<ModelData | undefined>(undefined);
    const changeModelRevision = useChangeModelRevision();
    const addModelToScene = useAddModelToScene();
    const removeAssetsAndInstancesFromScene = useRemoveAssetsAndInstancesFromScene();
    const addModelToCurrentScene = useCallback(
        (modelId: string, position?: Vector3Like) => {
            addModelToScene(modelId)
                .then(object => {
                    if (position) {
                        object.position.set(position.x, position.y, position.z);
                    }
                })
                .catch(err => {
                    console.error(err);
                    showToast({type: "error", title: "Failed to add model to scene."});
                });
        },
        [addModelToScene],
    );

    const [filteredData, setFilteredData] = useState<AssetItem[]>();

    const removeLegacyModel = async (id: string, sceneId: string, skipDeleteFromScene?: boolean) => {
        const data: any = {
            ID: [id],
            SceneIDToRemove: [sceneId],
        };

        const response = await Ajax.post({
            url: backendUrlFromPath(`/api/Mesh/UpdateSceneID`),
            data,
            msgBodyType: "urlEncoded",
        });

        if (response?.data.Code !== 200) {
            showToast({type: "error", title: "Could not delete asset from project."});
            console.error("Request failed", response?.data.Msg);
        } else {
            if (!skipDeleteFromScene) {
                handleDeleteFromScene(id);
            }

            app?.call("fetchModels");
            showToast({type: "success", title: `Model removed from this project.`});
        }
    };

    const handleRemove = (args: {id: string; name: string}, skipDeleteFromScene?: boolean) => {
        const {id} = args;
        const sceneID = app?.editor?.sceneID;
        if (!sceneID) {
            showToast({
                type: "error",
                title: `Failed to remove model from the project.`,
            });
            console.error("Scene id is missing");
            return;
        }

        const model = modelsForScene.find(model => model.id === id);
        if (!model) {
            showToast({
                type: "error",
                title: `Failed to remove model from the project.`,
            });
            console.warn("Cannot delete model. Model not found.");
            return;
        }

        if (!model.isLegacy) {
            removeAssetsAndInstancesFromScene([id]).catch(console.error);
            return;
        }

        // Handle legacy model removal
        ElementsUtils.confirm({
            title: "Warning!",
            content: DELETE_WARNING,
            onOK: () => {
                removeLegacyModel(id, sceneID, skipDeleteFromScene).catch(console.error);
            },
        });
    };

    const handleReplace = (args: {id: string; name: string}) => {
        const modelAsset = modelsForScene.find(model => model.id === args.id);
        if (!modelAsset) {
            console.warn("Cannot replace model. Model not found.");
            return;
        }

        setOriginalAsset(modelAsset);
        setIsUploadViewOpen(true);
    };

    const handleUploadComplete = (assets: AssetRef[]) => {
        const asset = assets[0];
        if (!asset) {
            console.warn("Cannot replace model. Asset not found.");
            return;
        }

        changeModelRevision(asset.assetId, asset.revisionId)
            .then(() => saveScene())
            .catch(console.error);
    };

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, id: string) => {
        e.dataTransfer.setData("asset-id", id);
        e.dataTransfer.setData("asset-type", "model");
    };

    const closeUploadView = () => {
        setIsUploadViewOpen(false);
    };

    useEffect(() => {
        if (!search) {
            setFilteredData(modelsForScene);
            return;
        }

        setFilteredData(
            modelsForScene.filter(n => {
                return n.name.toLowerCase().indexOf(search.toLowerCase()) > -1;
            }),
        );
    }, [search, modelsForScene]);

    useEffect(() => {
        app?.on(`dragEnd.ModelsTab`, (type: string, id: string, position: any) => {
            if (type === "model") {
                addModelToCurrentScene(id, position);
            }
        });
        return () => {
            app?.on(`dragEnd.ModelsTab`, null);
        };
    }, [addModelToCurrentScene]);

    useEffect(() => {
        app?.call("fetchModels");
    }, []);

    if (!filteredData || filteredData.length === 0) {
        return (
            <EmptyAssetsState
                search={search}
                label="models"
            />
        );
    }

    return (
        <>
            {filteredData && (
                <AssetsList
                    data={filteredData}
                    selectedItemsIds={[selectedItemId]}
                    onClick={addModelToCurrentScene}
                    onDelete={handleRemove}
                    onReplace={handleReplace}
                    draggable
                    onDragStart={handleDragStart}
                    onLoadRevision={({asset, revisionId}) => changeModelRevision(asset.id, revisionId)}
                />
            )}
            {isUploadViewOpen && (
                <UploadViewModal
                    uploadForScene
                    fileType={UPLOAD_FILE_TYPE.MODEL}
                    closeView={closeUploadView}
                    closeUpload={closeUploadView}
                    onUploadComplete={handleUploadComplete}
                    updateModelId={!originalAsset?.isLegacy ? originalAsset?.id : undefined}
                />
            )}
        </>
    );
};

const UploadViewModal = ({...props}: UploadViewProps) => {
    return createPortal(<UploadView {...props} />, document.body);
};
