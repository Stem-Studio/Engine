import I18n from "i18next";
import React, {useEffect, useState} from "react";

import {useAuthorizationContext} from ".";
import {FileData} from "../editor/assets/v2/types/file";
import global from "../global";
import {showToast} from "../showToast";
import Ajax from "../utils/Ajax";
import {UploadUtils} from "../utils/UploadUtils";
import {backendUrlFromPath} from "../utils/UrlUtils";

export enum AssetType {
    SOUNDS = "Audio",
    IMAGES = "Map",
    VIDEOS = "Video",
    NPC_PROFILES = "NPC",
}

interface AssetsTabContextValue {
    fetchAssets: (assetType: AssetType) => void;
    batchAudioUpload: (libraryIDToAdd: string) => void;
    deleteAsset: (assetType: AssetType, ID: string) => void;
    assetsData: Map<AssetType, FileData[]> | undefined;
    audioDataForSceneID: FileData[] | undefined;
}

export const AssetsTabContext = React.createContext<AssetsTabContextValue>(null!);

export interface AssetsTabContextProviderProps {
    children: React.ReactNode;
}

const AssetsTabContextProvider: React.FC<AssetsTabContextProviderProps> = ({children}) => {
    const app = (global as any).app;
    const [assetsData, setAssetsData] = useState<Map<AssetType, FileData[]>>();
    const {dbUser} = useAuthorizationContext();
    const [audioDataForSceneID, setAudioDataForSceneID] = useState<FileData[]>();

    useEffect(() => {
        app.on(`fetchAudio.AssetsTabContextProvider`, () => fetchAssets(AssetType.SOUNDS));
        app.on(`refreshAiNpcsList.AssetsTabContextProvider`, () => fetchAssets(AssetType.NPC_PROFILES));

        return () => {
            app.on(`fetchAudio.AssetsTabContextProvider`, null);
            app.on(`refreshAiNpcsList.AssetsTabContextProvider`, null);
        };
    }, []);

    //prefetch assets types used by behaviors
    useEffect(() => {
        if (dbUser) {
            fetchAssets(AssetType.SOUNDS);
            fetchAssets(AssetType.IMAGES);
            fetchAssets(AssetType.VIDEOS);
            fetchAssets(AssetType.NPC_PROFILES);
        }
    }, [dbUser]);

    useEffect(() => {
        if (assetsData) {
            const soundsDataFetched = assetsData?.get(AssetType.SOUNDS);
            setAudioDataForSceneID(
                soundsDataFetched?.filter(el => !!el.SceneID?.find(id => id === app.editor.sceneID)),
            );
        }
    }, [assetsData]);

    const fetchAssets = (assetType: AssetType) => {
        setAssetsData(prev => new Map(prev).set(assetType, []));
    };

    const batchAudioUpload = (libraryIDToAdd: string) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "audio/*";
        input.multiple = true;
        input.style.display = "none";

        input.onchange = async () => {
            const files = Array.from(input.files || []);

            if (files.length === 0) return;

            showToast({
                type: "info",
                title: `Uploading ${files.length} audio files...`,
                body: "Processing in batches of 4 for optimal performance",
                duration: 3000,
            });

            try {
                const {successful, failed} = await UploadUtils.batchUploadFiles(
                    files,
                    `/api/${AssetType.SOUNDS}/Add`,
                    (completed, total, errors) => {
                        if (completed % 4 === 0 || completed === total) {
                            showToast({
                                type: "info",
                                title: `Progress: ${completed}/${total} files uploaded`,
                                body: errors.length > 0 ? `${errors.length} errors occurred` : "Upload proceeding...",
                                duration: 2000,
                            });
                        }
                    },
                    undefined,
                    libraryIDToAdd,
                    4, // Process 4 files concurrently
                );

                if (successful.length > 0) {
                    showToast({
                        type: "success",
                        title: `Successfully uploaded ${successful.length} audio files`,
                        duration: 3000,
                    });
                    app.call("finishedModelUpload");
                    app.call("fetchAudio");
                    fetchAssets(AssetType.SOUNDS);
                }

                if (failed.length > 0) {
                    showToast({
                        type: "warning",
                        title: `${failed.length} uploads failed`,
                        body: failed.map(f => f.file.name).join(", "),
                        duration: 5000,
                    });
                }
            } catch {
                showToast({type: "error", body: "Batch upload failed. Please try again."});
            }
        };

        document.body.appendChild(input);
        input.click();
    };

    const deleteAsset = (assetType: AssetType, ID: string) => {
        void Ajax.post({
            url: backendUrlFromPath(`/api/${assetType}/Delete?ID=${ID}`),
        }).then(response => {
            const obj = response?.data;
            if (obj.Code !== 200) {
                showToast({type: "warning", body: I18n.t(obj.Msg)});
                return;
            }
            fetchAssets(assetType);
        });
    };

    return (
        <AssetsTabContext.Provider
            value={{
                fetchAssets,
                deleteAsset,
                assetsData,
                audioDataForSceneID,
                batchAudioUpload,
            }}
        >
            {children}
        </AssetsTabContext.Provider>
    );
};

export default AssetsTabContextProvider;
