import {collection, doc, getDocs, limit, query, setDoc} from "firebase/firestore";
import I18n from "i18next";
import {MathUtils} from "three";

import {db} from "@web-shared/firebase";
import global from "@web-shared/global";
import {showToast} from "@web-shared/showToast";
import {getInitProfileData} from "./helpers/mockedData";
import Ajax from "@web-shared/utils/Ajax";
import {backendUrlFromPath} from "@web-shared/utils/UrlUtils";
import {getGameUrl} from "@web-shared/v2/pages/links";
import {IBasicGameInterface, IUserProfileData, SEARCH_GAME_QUERY} from "@web-shared/v2/pages/types";

export interface IStats {
    playCount: number;
    likes: number;
}

/**
 * Fetches public scenes that were remixed from a given scene. The backend
 * sorts these by play count (descending) when `remixedFrom` is set. Used
 * by the Game Overview page to surface a scene's most-played remixes.
 */
export const getRemixes = async (sceneID: string) => {
    try {
        if (!global?.app || !sceneID) return;
        const url = backendUrlFromPath(`/api/Scene/Public?remixedFrom=${encodeURIComponent(sceneID)}`);
        const response = await Ajax.get({url, needAuthorization: false});
        const obj = response?.data;
        if (obj?.Code !== 200) return;
        const remixes: IBasicGameInterface[] = (obj.Data || []).map((data: IBasicGameInterface) => ({
            ...data,
            GameURL: getGameUrl(data.ID, null),
            Tags: data.Tags ? JSON.parse(data.Tags as unknown as string) : [],
        }));
        return remixes;
    } catch (error) {
        console.log(`Error from fetching remixes: ${String(error)}`);
    }
};

export const getGames = async (userID?: string) => {
    try {
        if (!global?.app) return;
        const url = userID
            ? backendUrlFromPath(`/api/Scene/Public?userID=${userID}`)
            : backendUrlFromPath(`/api/Scene/Public`);
        const response = await Ajax.get({url: url, needAuthorization: false});
        const obj = response?.data;
        if (obj.Code !== 200) {
            showToast({type: "warning", body: I18n.t(obj.Msg)});
            return;
        }
        const publicScenes = obj.Data;

        const communityGamesData: IBasicGameInterface[] = [];
        publicScenes.forEach((data: IBasicGameInterface) => {
            const scene = {
                ...data,
                GameURL: getGameUrl(data.ID, null),
                Tags: data.Tags ? JSON.parse(data.Tags as unknown as string) : [],
            } as IBasicGameInterface;
            communityGamesData.push(scene);
        });

        communityGamesData.sort(
            (a, b) => new Date(b.UpdateTime).getTime() - new Date(a.UpdateTime).getTime(),
        );

        return communityGamesData;
    } catch (error) {
        showToast({type: "error", title: "Couldn't fetch games."});
        console.log(`Error from fetching games document: ${error}`);
    }
};

export interface QUERY_PARAMS {
    [SEARCH_GAME_QUERY.GAME_NAME]?: string;
    [SEARCH_GAME_QUERY.GAME_AUTHOR]?: string;
    [SEARCH_GAME_QUERY.GAME_TAGS]?: string;
    [SEARCH_GAME_QUERY.PAGE]?: string;
    [SEARCH_GAME_QUERY.LIMIT]?: string;
}
export const getGamesByQuery = async (args: QUERY_PARAMS) => {
    const {tags, name, page, limit} = args;
    try {
        if (!global?.app) return;

        // Construct query parameters
        const params: URLSearchParams = new URLSearchParams();
        if (tags) {
            params.append(SEARCH_GAME_QUERY.GAME_TAGS, tags);
        }
        if (name) {
            params.append(SEARCH_GAME_QUERY.GAME_NAME, name);
        }
        if (limit) {
            params.append(SEARCH_GAME_QUERY.LIMIT, limit);
        }
        if (page) {
            params.append(SEARCH_GAME_QUERY.PAGE, page);
        }
        // if (userID) {
        //     params.append(SEARCH_GAME_QUERY.GAME_AUTHOR, userID);
        // }

        // Create the full URL with query parameters
        const url = backendUrlFromPath(`/api/Scene/Public?${params.toString()}`);
        const response = await Ajax.get({url, needAuthorization: false});

        const obj = response?.data;
        if (obj.Code !== 200) {
            showToast({type: "warning", body: I18n.t(obj.Msg)});
            return;
        }
        const publicScenes = obj.Data;

        const communityGamesData: IBasicGameInterface[] = [];
        publicScenes.forEach((data: IBasicGameInterface) => {
            const scene = {
                ...data,
                GameURL: getGameUrl(data.ID, null),
                Tags: data.Tags ? JSON.parse(data.Tags as unknown as string) : [],
            } as IBasicGameInterface;
            communityGamesData.push(scene);
        });

        // Sort the games by the last update time
        communityGamesData.sort(
            (a, b) => new Date(b.UpdateTime).getTime() - new Date(a.UpdateTime).getTime(),
        );

        return communityGamesData;
    } catch (error) {
        console.log(`Error from fetching games document: ${error}`);
    }
};

export const getProfileData = async () => {
    try {
        if (!db) return;
        const gamesCollection = collection(db, "profileData");

        const q = query(gamesCollection, limit(1));

        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const snapshot = querySnapshot.docs[0];
            if (!snapshot) return getInitProfileData();
            const data = snapshot.data();
            return data as IUserProfileData;
        } else {
            console.log("No documents found in the 'profileData' collection.");
            await setDoc(doc(db, "profileData", MathUtils.generateUUID()), getInitProfileData());
            return getInitProfileData();
        }
    } catch (error) {
        console.log(`Error from fetching profileData document: ${error}`);
    }
};

export const updatePlayCount = async (_sceneID: string): Promise<IStats | null> => {
    return null;
};

export enum LIKES_ACTION {
    INCREMENT = "increment",
    DECREMENT = "decrement",
}
export const updateLikesCount = async (sceneID: string, action: LIKES_ACTION): Promise<IStats | null> => {
    try {
        if (!global?.app) return null;
        const response = await Ajax.post({
            url: backendUrlFromPath(`/api/Scene/Likes`),
            needAuthorization: false,
            data: {
                ID: sceneID,
                action,
            },
            msgBodyType: "urlEncoded",
        });
        const obj = response?.data;
        if (obj.Code !== 200) {
            showToast({type: "warning", body: I18n.t(obj.Msg)});
            return null;
        }
        return {playCount: obj.Data.PlayCount, likes: obj.Data.Likes};
    } catch (error) {
        console.log(`Error from updating likes: ${error}`);
        return null;
    }
};
