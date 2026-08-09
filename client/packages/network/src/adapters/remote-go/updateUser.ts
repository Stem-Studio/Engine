import {IStats} from "./getGames";
import {IEditorUser} from "@web-shared/v2/pages/types";

export const addLikedGame = async (
    _gameId: string,
    _setDbUser: React.Dispatch<React.SetStateAction<IEditorUser | null>>,
    _redirectToLogin: () => void,
): Promise<IStats | null | void> => {
    return null;
};

export const getLikedGames = async (_userId?: string) => {
    return [];
};
