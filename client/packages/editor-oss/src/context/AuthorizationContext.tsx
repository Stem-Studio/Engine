import React, {useCallback, useEffect, useMemo, useState} from "react";

import {OSS_LOCAL_USER_ID} from "@web-shared/ossUser";
import global from "../global";
import type {IUser} from "../userManagement/types";
import type {IEditorUser} from "../v2/pages/types";

const OSS_DUMMY_TOKEN = "stemstudio-token";
const AI_CREDITS_DEFAULT = 5000;

const createLocalUser = (overrides: Partial<IEditorUser> = {}): IEditorUser => ({
    id: OSS_LOCAL_USER_ID,
    name: "Local User",
    username: "local",
    email: "local@stemstudio.invalid",
    avatar: "",
    memberSince: 0,
    aiCredits: AI_CREDITS_DEFAULT,
    lastCreditsRefresh: 0,
    ...overrides,
});

const toAuthStoreUser = (user: IEditorUser): IUser => ({
    id: user.id,
    name: user.name || user.username || "Local User",
    email: user.email || null,
    firebaseId: user.id,
    avatar: user.avatar || "",
    username: user.username || "local",
    token: OSS_DUMMY_TOKEN,
    isGuest: false,
    platform: "anonymous",
});

const syncGlobalAuthState = (user: IEditorUser | null, token: string | null) => {
    const authManager = global.app?.authManager;
    authManager?.setAuthToken(token);
    authManager?.setUser(user ? toAuthStoreUser(user) : null);
    authManager?.setUserName(user?.username || null);
    if (global.app) {
        global.app.userId = user?.id || null;
    }
};

interface AuthorizationContextValue {
    isAuthorized: boolean;
    setIsAuthorized: React.Dispatch<React.SetStateAction<boolean>>;
    onboarding: boolean;
    setOnboarding: React.Dispatch<React.SetStateAction<boolean>>;
    userInitialized: boolean;
    handleLogOut: () => void;
    authToken: string | null;
    isInitializingAuth: boolean;
    dbUser: IEditorUser | null;
    setDbUser: React.Dispatch<React.SetStateAction<IEditorUser | null>>;
    likedGamesIds: string[];
    setLikedGamesIds: React.Dispatch<React.SetStateAction<string[]>>;
    handleGetLikedGames: () => Promise<void>;
    saveUser: (updatedUser: IEditorUser) => Promise<void>;
    getUser: (userId?: string, userName?: string) => Promise<IEditorUser | undefined>;
    validateUsername: (username: string) => Promise<boolean>;
    saveUsername: (username: string) => Promise<true | undefined>;
    /** @deprecated Compatibility alias for older callers; use saveUsername. */
    saveUsernameInFirebase: (username: string) => Promise<true | undefined>;
    isAdmin: boolean;
    isWhitelisted: boolean | undefined;
    checkForAvatar: () => Promise<boolean>;
    fetchUser: () => Promise<IEditorUser | null>;
    onLogOut: () => void;
    isCollaborator: boolean;
    aiCredits: number | null;
    setAiCredits: React.Dispatch<React.SetStateAction<number | null>>;
    refreshAiCredits: () => Promise<number | null>;
    updateRecentlyViewed: () => Promise<void>;
}

export const AuthorizationContext = React.createContext<AuthorizationContextValue>(null!);
export const useAuthorizationContext = () => React.useContext(AuthorizationContext);

export interface AuthorizationContextProviderProps {
    children: React.ReactNode;
}

const AuthorizationContextProvider: React.FC<AuthorizationContextProviderProps> = ({children}) => {
    const [isAuthorized, setIsAuthorized] = useState(true);
    const [authToken, setAuthToken] = useState<string | null>(OSS_DUMMY_TOKEN);
    const [dbUser, setDbUserState] = useState<IEditorUser | null>(() => createLocalUser());
    const [likedGamesIds, setLikedGamesIds] = useState<string[]>([]);
    const [aiCredits, setAiCredits] = useState<number | null>(AI_CREDITS_DEFAULT);
    const [onboarding, setOnboarding] = useState(false);

    useEffect(() => {
        syncGlobalAuthState(dbUser, authToken);
    }, [dbUser, authToken]);

    const setDbUser: React.Dispatch<React.SetStateAction<IEditorUser | null>> = useCallback(
        value => {
            setDbUserState(previous => {
                const next = typeof value === "function"
                    ? (value as (previous: IEditorUser | null) => IEditorUser | null)(previous)
                    : value;
                if (next?.aiCredits !== undefined) {
                    setAiCredits(next.aiCredits);
                }
                if (next?.likedGamesIds) {
                    setLikedGamesIds(next.likedGamesIds);
                }
                return next;
            });
        },
        [],
    );

    const resetLocalSession = useCallback(() => {
        const localUser = createLocalUser();
        setIsAuthorized(true);
        setAuthToken(OSS_DUMMY_TOKEN);
        setDbUserState(localUser);
        setLikedGamesIds([]);
        setAiCredits(AI_CREDITS_DEFAULT);
        setOnboarding(false);
    }, []);

    const handleLogOut = useCallback(() => {
        resetLocalSession();
        if (window.location.pathname !== "/") {
            window.location.assign("/");
        }
    }, [resetLocalSession]);

    const saveUser = useCallback(async (updatedUser: IEditorUser) => {
        const nextUser = createLocalUser(updatedUser);
        setDbUser(nextUser);
    }, [setDbUser]);

    const getUser = useCallback(
        async (userId?: string, userName?: string) => {
            const current = dbUser ?? createLocalUser();
            if (!userId && !userName) return current;
            if (userId && userId === current.id) return current;
            if (userName && userName === current.username) return current;
            return undefined;
        },
        [dbUser],
    );

    const validateUsername = useCallback(async (username: string) => username.trim().length > 0, []);

    const saveUsername = useCallback(
        async (username: string) => {
            const normalized = username.trim();
            if (!normalized) return undefined;
            setDbUser(previous => createLocalUser({...((previous ?? {}) as Partial<IEditorUser>), username: normalized}));
            return true;
        },
        [setDbUser],
    );

    const saveUsernameInFirebase = saveUsername;

    const handleGetLikedGames = useCallback(async () => undefined, []);

    const checkForAvatar = useCallback(async () => false, []);

    const fetchUser = useCallback(async () => dbUser ?? createLocalUser(), [dbUser]);

    const refreshAiCredits = useCallback(async () => aiCredits ?? AI_CREDITS_DEFAULT, [aiCredits]);

    const updateRecentlyViewed = useCallback(async () => {
        const sceneID = global.app?.editor?.sceneID;
        if (!sceneID) return;
        setDbUser(previous => {
            const current = previous ?? createLocalUser();
            const existing = current.recentlyViewed ?? [];
            return {
                ...current,
                recentlyViewed: [sceneID, ...existing.filter(id => id !== sceneID)],
            };
        });
    }, [setDbUser]);

    const value = useMemo<AuthorizationContextValue>(
        () => ({
            onLogOut: resetLocalSession,
            isAuthorized,
            setIsAuthorized,
            userInitialized: true,
            handleLogOut,
            authToken,
            isInitializingAuth: false,
            dbUser,
            setDbUser,
            likedGamesIds,
            setLikedGamesIds,
            handleGetLikedGames,
            saveUser,
            getUser,
            validateUsername,
            saveUsername,
            saveUsernameInFirebase,
            isAdmin: false,
            isWhitelisted: true,
            checkForAvatar,
            updateRecentlyViewed,
            fetchUser,
            isCollaborator: false,
            aiCredits,
            setAiCredits,
            refreshAiCredits,
            onboarding,
            setOnboarding,
        }),
        [
            aiCredits,
            authToken,
            checkForAvatar,
            dbUser,
            fetchUser,
            getUser,
            handleGetLikedGames,
            handleLogOut,
            isAuthorized,
            likedGamesIds,
            onboarding,
            refreshAiCredits,
            resetLocalSession,
            saveUser,
            saveUsername,
            saveUsernameInFirebase,
            setDbUser,
            updateRecentlyViewed,
            validateUsername,
        ],
    );

    return <AuthorizationContext.Provider value={value}>{children}</AuthorizationContext.Provider>;
};

export default AuthorizationContextProvider;
