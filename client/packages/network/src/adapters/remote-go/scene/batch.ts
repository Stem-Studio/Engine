import Ajax from "@web-shared/utils/Ajax";
import {backendUrlFromPath} from "@web-shared/utils/UrlUtils";

/**
 * Retrieves multiple scenes by their IDs.
 */
export async function getSceneBatch(sceneIds: string[]): Promise<any> {
    try {
        const response = await Ajax.post({
            url: backendUrlFromPath(`/api/Scene/GetBatch`),
            data: JSON.stringify({
                IDs: sceneIds,
            }),
            msgBodyType: "json",
            needAuthorization: false,
        });

        if (response?.data.Code !== 200) {
            throw new Error(response?.data.Msg);
        }

        return response?.data.Data;
    } catch (error) {
        throw new Error((error instanceof Error ? error.message : "") || "Failed to get scenes");
    }
}
