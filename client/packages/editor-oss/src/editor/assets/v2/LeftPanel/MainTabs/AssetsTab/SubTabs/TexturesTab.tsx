import I18n from "i18next";
import {useEffect, useState} from "react";

import {EmptyAssetsState} from "./EmptyAssetsState";
import global from "@stem/editor-oss/global";
import {showToast} from "@stem/editor-oss/showToast";
import Ajax from "@stem/editor-oss/utils/Ajax";
import {UploadUtils} from "@stem/editor-oss/utils/UploadUtils";
import {backendUrlFromPath} from "@stem/editor-oss/utils/UrlUtils";
import {AssetsListLegacy, type AssetItem} from "../../../../common/AssetsListLegacy";
import uploadIconSmall from "../../../../icons/upload-icon-small.svg";
import {FileData} from "../../../../types/file";

export const TexturesTab = () => {
    const [search, setSearch] = useState("");
    const [data, setData] = useState<FileData[]>();
    const [filteredData, setFilteredData] = useState<FileData[]>();

    const app = (global as any).app;

    const fetchData = () => {
        Ajax.get({url: backendUrlFromPath(`/api/Map/List`)}).then(response => {
            const obj = response?.data;
            if (obj.Code !== 200) {
                showToast({type: "warning", body: I18n.t(obj.Msg)});
                return;
            }
            setData(obj.Data);
        });
    };

    const handleAdd = () => {
        UploadUtils.upload(backendUrlFromPath(`/api/Map/Add`) || "", (obj: any) => {
            if (obj.Code === 200) {
                fetchData();
            }
            showToast({type: "info", body: I18n.t(obj.Msg)});
        });
    };

    const handleClick = (id: string) => {
        const obj = data?.find(item => item.ID === id);
        if (obj) {
            app.call(`selectMap`, obj, obj);
        }
    };

    useEffect(() => {
        if (!search) {
            setFilteredData(data);
            return;
        } else {
            setFilteredData(
                data?.filter(n => {
                    return n.Name.toLowerCase().indexOf(search.toLowerCase()) > -1;
                }),
            );
        }
    }, [search, data]);

    useEffect(() => {
        fetchData();
    }, []);

    if (!filteredData || filteredData.length === 0) {
        return (
            <EmptyAssetsState
                search={search}
                label="textures"
            />
        );
    }

    return (
        <>
            <img
                src={uploadIconSmall}
                alt="upload-icon-small"
                className="upload-assets-button"
                onClick={handleAdd}
            />

            <input
                className="search-input"
                type="text"
                onChange={e => setSearch(e.target.value)}
            />

            {filteredData && (
                <AssetsListLegacy
                    data={filteredData as unknown as AssetItem[]}
                    onClick={handleClick}
                />
            )}
        </>
    );
};
