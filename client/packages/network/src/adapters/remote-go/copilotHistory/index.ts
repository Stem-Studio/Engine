import {InteractiveResult} from "@web-shared/agent/types/ACPTypes";

export type MessageExtra = {
    SeqNum: number;
    AttachedObjects?: string[];
    InteractiveResult?: InteractiveResult;
};

export type CopilotHistoryData = {
    ID: string;
    SessionID: string;
    UserID: string;
    SceneID: string;
    Title: string;
    MessageExtras: MessageExtra[];
    UsedCredits: number;
    AddTime: string;
    UpdateTime: string;
};

export type CopilotHistoryListData = Omit<CopilotHistoryData, "MessageExtras">;

export type CopilotHistoryListResponse = {
    items: CopilotHistoryListData[];
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    hasMore: boolean;
};

export const getCopilotHistoryList = async (
    _sceneID: string,
    page: number = 1,
    limit: number = 20,
): Promise<CopilotHistoryListResponse> => {
    return {items: [], page, limit, totalCount: 0, totalPages: 0, hasMore: false};
};

export const getSessionExtras = async (id: string): Promise<CopilotHistoryData> => {
    return {
        ID: id,
        SessionID: "",
        UserID: "",
        SceneID: "",
        Title: "",
        MessageExtras: [],
        UsedCredits: 0,
        AddTime: "",
        UpdateTime: "",
    };
};

export const createCopilotSession = async (
    _sessionID: string,
    _sceneID: string,
    _title: string,
): Promise<void> => {
    return;
};

export const addMessageExtra = async (
    _sessionID: string,
    _seqNum: number,
    _attachedObjects?: string[],
    _interactiveResult?: InteractiveResult,
): Promise<void> => {
    return;
};

export const deleteCopilotHistory = async (_id?: string, _sessionID?: string): Promise<unknown> => {
    return {};
};

export const updateCopilotHistoryCredits = async (_sessionID: string, _delta: number): Promise<void> => {
    return;
};
