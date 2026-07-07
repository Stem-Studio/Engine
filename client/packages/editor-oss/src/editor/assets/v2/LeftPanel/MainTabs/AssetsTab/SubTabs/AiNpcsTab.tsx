import {useEffect, useMemo, useState} from "react";

import {useListEditorNpcs} from "./hooks/useListEditorNpcs";
import global from "@stem/editor-oss/global";
import {showToast} from "@stem/editor-oss/showToast";
import {useRemoveAssetsAndInstancesFromScene} from "../../../../../../asset-management/hooks/scene";
import {AssetsListLegacy, AssetItem} from "../../../../common/AssetsListLegacy";
import {EmptyState} from "../AssetsTab.style";


export const AiNpcsTab = ({search}: {search: string}) => {
    const app = global.app;
    const [filteredData, setFilteredData] = useState<AssetItem[]>([]);
    const removeAssetsAndInstancesFromScene = useRemoveAssetsAndInstancesFromScene();
    const {assets: npcs, isLoading} = useListEditorNpcs();

    const sceneAssets = useMemo<AssetItem[]>(() => {
        return (npcs || []).map(npc => ({
            ID: npc.ID,
            Name: npc.Name,
            Type: npc.Type,
            Thumbnail: npc.Thumbnail,
            UserId: npc.UserID,
            NewApi: true,
        }));
    }, [npcs]);

    const handleEdit = (id: string) => {
        const npc = sceneAssets.find(n => n.ID === id);
        if (npc) {
            // Cast to any as openAiNpcCreator expects legacy NPCBackendData type
            app?.editor?.component?.openAiNpcCreator(npc as any);
        }
    };

    const handleDelete = async (args: {ID: string; Name: string}) => {
        try {
            await removeAssetsAndInstancesFromScene([args.ID]);
            showToast({
                type: "success",
                title: "NPC deleted successfully",
            });
        } catch (error) {
            showToast({
                type: "error",
                title: "Failed to delete NPC",
                body: String(error),
            });
        }
    };

    useEffect(() => {
        if (!search) {
            setFilteredData(sceneAssets);
        } else {
            const filtered = sceneAssets.filter(npc => npc.Name.toLowerCase().includes(search.toLowerCase()));
            setFilteredData(filtered);
        }
    }, [search, sceneAssets]);

    if (isLoading) {
        return <div style={{padding: "16px", color: "#fff"}}>Loading NPCs...</div>;
    }

    return (
        <>
            {filteredData && filteredData.length > 0 ? (
                <AssetsListLegacy
                    data={filteredData}
                    selectedItemsIds={[]}
                    onClick={handleEdit}
                    onDelete={handleDelete}
                />
            ) : (
                <EmptyState>{search ? "No NPCs found" : "No NPCs yet. Create one to get started!"}</EmptyState>
            )}
        </>
    );
};
