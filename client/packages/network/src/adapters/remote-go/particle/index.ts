import Ajax from "@web-shared/utils/Ajax";
import {backendUrlFromPath} from "@web-shared/utils/UrlUtils";


export type ParticleBackendData = {
    ID: string;
    Name: string;
    CreateTime: string;
    UpdateTime: string;
    Thumbnail: string;
    UserID?: string;
};

export type ParticleDetailBackendData = ParticleBackendData & {
    Data: string;
};

export const saveParticle = async (id: string, name: string, data: string): Promise<any> => {
    try {
        const response = await Ajax.post({
            url: backendUrlFromPath(`/api/Particle/Save`),
            data: {
                ID: id,
                Name: name,
                Data: data,
            },
            msgBodyType: "urlEncoded",
        });

        if (response?.data.Code !== 200) {
            throw new Error(response?.data.Msg || "Failed to save particle.");
        }

        return response.data.Data;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Error saving particle:", message || error);
        throw new Error(message || "Failed to save particle.");
    }
};

export const editParticle = async (id: string, name: string, thumbnail?: string, category?: string): Promise<any> => {
    try {
        const data: Record<string, string> = {
            ID: id,
            Name: name,
        };

        if (thumbnail) {
            data.Thumbnail = thumbnail;
        }

        if (category) {
            data.Category = category;
        }

        const response = await Ajax.post({
            url: backendUrlFromPath(`/api/Particle/Edit`),
            data,
            msgBodyType: "urlEncoded",
        });

        if (response?.data.Code !== 200) {
            throw new Error(response?.data.Msg || "Failed to edit particle.");
        }

        return response.data.Data;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Error editing particle:", message || error);
        throw new Error(message || "Failed to edit particle.");
    }
};

export const getParticle = async (id: string): Promise<ParticleBackendData & {Data: string}> => {
    try {
        const response = await Ajax.get({
            url: backendUrlFromPath(`/api/Particle/Get?ID=${id}`),
        });

        if (response?.data.Code !== 200) {
            throw new Error(response?.data.Msg || "Failed to get particle.");
        }

        return response.data.Data;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Error getting particle:", message || error);
        throw new Error(message || "Failed to get particle.");
    }
};

export const getParticlesList = async (): Promise<ParticleBackendData[]> => {
    return [];
};

export const deleteParticle = async (id: string): Promise<any> => {
    try {
        const response = await Ajax.post({
            url: backendUrlFromPath(`/api/Particle/Delete`),
            data: {
                ID: id,
            },
            msgBodyType: "urlEncoded",
        });

        if (response?.data.Code !== 200) {
            throw new Error(response?.data.Msg || "Failed to delete particle.");
        }

        return response.data;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Error deleting particle:", message || error);
        throw new Error(message || "Failed to delete particle.");
    }
};
