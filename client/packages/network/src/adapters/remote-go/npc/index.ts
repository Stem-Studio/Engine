import Ajax from "@web-shared/utils/Ajax";
import {backendUrlFromPath} from "@web-shared/utils/UrlUtils";


export type Career = {
    Name: string;
    Rating: number;
};

export type NPCBackendData = {
    ID: string;
    UserID: string;
    Name: string;
    ProfileImage?: string;
    Inventory: string[];
    Wallet: number;
    Bio?: string;
    Careers: Career[];
    Personality?: string;
    ResponseStyle?: string;
    CreatedAt: string;
    UpdatedAt: string;
    IsArchived?: boolean;
};

export type NPCCreateData = {
    Name: string;
    ProfileImage?: string;
    Model?: string;
    Inventory?: string[];
    Wallet?: number;
    Bio?: string;
    Careers?: Career[];
    Personality?: string;
    ResponseStyle?: string;
};

export type NPCUpdateData = {
    ID: string;
    Name?: string;
    ProfileImage?: string;
    Model?: string;
    Inventory?: string[];
    Wallet?: number;
    Bio?: string;
    Careers?: Career[];
    Personality?: string;
    ResponseStyle?: string;
};

export type NPCConversationRequest = {
    npcID: string;
    sceneID: string; // Scene/Game ID for ReactionData
    text: string;
    userName?: string;
    gameContext?: GameContext;
    provider?: "openai" | "claude" | "gemini";
};

// GameContext structures for dynamic NPC behavior
export type GameAction = {
    name: string;
    description: string;
    parameters?: Record<string, unknown>;
};

export type GameObject = {
    id: string;
    name: string;
    type: string;
    description?: string;
    distance?: number; // Distance from NPC
    position?: Vector3;
    size?: Vector3;
};

export type GameEvent = {
    type: string;
    description: string;
    timestamp: string; // ISO 8601
    participants?: string[];
    data?: Record<string, unknown>; // Additional event data
};

export type Vector3 = {
    x: number;
    y: number;
    z: number;
};

export type CurrentAction = {
    name: string;
    parameters?: Record<string, unknown>;
    startedAt: string; // ISO 8601
    status: "executing" | "completed" | "failed";
};

export type PlayerInfo = {
    id: string;
    position: Vector3;
};

export type GameContext = {
    availableActions?: GameAction[];
    surroundedObjects?: GameObject[];
    environment?: string;
    groups?: string[];
    recentEvents?: GameEvent[];
    npcPosition?: Vector3;
    currentActions?: CurrentAction[];
    playerInfo?: PlayerInfo;
};

// Action selected by AI from availableActions
export type SelectedAction = {
    name: string;
    parameters?: Record<string, unknown>;
};

/**
 * Get a list of all NPCs for the authenticated user
 * @returns Promise with array of NPC data
 */
export const getNPCList = async (): Promise<NPCBackendData[]> => {
    return [];
};

/**
 * Get a specific NPC by ID (public access, no authentication required)
 * @param id - The NPC's ObjectID in hexadecimal format
 * @returns Promise with NPC data
 */
export const getNPC = async (id: string): Promise<NPCBackendData> => {
    try {
        const response = await Ajax.get({
            url: backendUrlFromPath(`/api/NPC/Get?ID=${id}`),
            needAuthorization: false,
        });

        if (response?.data.Code !== 200) {
            throw new Error(response?.data.Msg || "Failed to get NPC.");
        }

        return response.data.Data;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to get NPC.";
        console.error("Error getting NPC:", errorMessage);
        throw new Error(errorMessage);
    }
};

/**
 * Create a new NPC
 * @param npcData - The NPC data to create
 * @returns Promise with created NPC data
 */
export const addNPC = async (npcData: NPCCreateData): Promise<NPCBackendData> => {
    try {
        const data: Record<string, string> = {
            Name: npcData.Name,
        };

        if (npcData.ProfileImage) data.ProfileImage = npcData.ProfileImage;
        if (npcData.Wallet !== undefined) data.Wallet = npcData.Wallet.toString();
        if (npcData.Bio) data.Bio = npcData.Bio;
        if (npcData.Personality) data.Personality = npcData.Personality;
        if (npcData.ResponseStyle) data.ResponseStyle = npcData.ResponseStyle;

        // Serialize arrays as JSON
        if (npcData.Inventory && npcData.Inventory.length > 0) {
            data.Inventory = JSON.stringify(npcData.Inventory);
        }
        if (npcData.Careers && npcData.Careers.length > 0) {
            data.Careers = JSON.stringify(npcData.Careers);
        }

        const response = await Ajax.post({
            url: backendUrlFromPath(`/api/NPC/Add`),
            data,
            msgBodyType: "urlEncoded",
        });

        if (response?.data.Code !== 200) {
            throw new Error(response?.data.Msg || "Failed to add NPC.");
        }

        return response.data.Data;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to add NPC.";
        console.error("Error adding NPC:", errorMessage);
        throw new Error(errorMessage);
    }
};

/**
 * Update an existing NPC
 * @param npcData - The NPC data to update
 * @returns Promise with updated NPC data
 */
export const updateNPC = async (npcData: NPCUpdateData): Promise<NPCBackendData> => {
    try {
        const data: Record<string, string> = {
            ID: npcData.ID,
        };

        if (npcData.Name) data.Name = npcData.Name;
        if (npcData.ProfileImage) data.ProfileImage = npcData.ProfileImage;
        if (npcData.Wallet !== undefined) data.Wallet = npcData.Wallet.toString();
        if (npcData.Bio) data.Bio = npcData.Bio;
        if (npcData.Personality) data.Personality = npcData.Personality;
        if (npcData.ResponseStyle) data.ResponseStyle = npcData.ResponseStyle;

        // Serialize arrays as JSON
        if (npcData.Inventory) {
            data.Inventory = JSON.stringify(npcData.Inventory);
        }
        if (npcData.Careers) {
            data.Careers = JSON.stringify(npcData.Careers);
        }

        const response = await Ajax.put({
            url: backendUrlFromPath(`/api/NPC/Update`),
            data,
            msgBodyType: "urlEncoded",
        });

        if (response?.data.Code !== 200) {
            throw new Error(response?.data.Msg || "Failed to update NPC.");
        }

        return response.data.Data;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to update NPC.";
        console.error("Error updating NPC:", errorMessage);
        throw new Error(errorMessage);
    }
};

/**
 * Delete an NPC (soft delete)
 * @param id - The NPC's ObjectID in hexadecimal format
 * @returns Promise with deletion result
 */
export const deleteNPC = async (id: string): Promise<{Code: number; Msg: string}> => {
    try {
        const response = await Ajax.post({
            url: backendUrlFromPath(`/api/NPC/Delete`),
            data: {
                ID: id,
            },
            msgBodyType: "urlEncoded",
        });

        if (response?.data.Code !== 200) {
            throw new Error(response?.data.Msg || "Failed to delete NPC.");
        }

        return response.data;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to delete NPC.";
        console.error("Error deleting NPC:", errorMessage);
        throw new Error(errorMessage);
    }
};

/**
 * Start a conversation with an NPC using Server-Sent Events (SSE)
 * @param request - The conversation request data
 * @param onChunk - Callback for each chunk of dialogue text received
 * @param onActions - Callback for selected actions (if any)
 * @param onEnd - Callback when conversation ends
 * @param onError - Callback for errors
 * @returns Promise that resolves when conversation starts
 */
export const startNPCConversation = async (
    request: NPCConversationRequest,
    onChunk: (text: string) => void,
    onActions: (actions: SelectedAction[]) => void,
    onEnd: () => void,
    onError: (error: Error) => void,
): Promise<void> => {
    try {
        const url = backendUrlFromPath(`/api/AI/NPC/Conversation`);
        if (!url) {
            throw new Error("Failed to get backend URL");
        }

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(request),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
            throw new Error("Failed to get response reader");
        }

        let buffer = "";
        let currentEventType = "message"; // default event type

        while (true) {
            const {done, value} = await reader.read();

            if (done) {
                onEnd();
                break;
            }

            buffer += decoder.decode(value, {stream: true});
            const lines = buffer.split("\n");

            // Keep the last incomplete line in buffer
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (!line.trim()) {
                    // Empty line resets event type
                    currentEventType = "message";
                    continue;
                }

                // Handle event type lines (e.g., "event: actions")
                if (line.startsWith("event: ")) {
                    currentEventType = line.substring(7).trim();
                    continue;
                }

                // Handle data lines
                if (line.startsWith("data: ")) {
                    const data = line.substring(6);

                    if (currentEventType === "actions") {
                        // Parse actions JSON
                        try {
                            const actions = JSON.parse(data) as SelectedAction[];
                            onActions(actions);
                        } catch (e) {
                            console.error("Failed to parse actions:", e);
                        }
                    } else if (currentEventType === "end") {
                        // End event
                        onEnd();
                        return;
                    } else {
                        // Regular dialogue chunk (message event)
                        if (data.trim()) {
                            onChunk(data);
                        }
                    }
                }
            }
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to start NPC conversation.";
        console.error("Error in NPC conversation:", errorMessage);
        onError(new Error(errorMessage));
    }
};

/**
 * Simplified version of NPC conversation that returns the full response as a promise
 * Useful when you don't need streaming
 * @param request - The conversation request data
 * @returns Promise with object containing full NPC response text and selected actions (if any)
 */
export const getNPCResponse = async (
    request: NPCConversationRequest,
): Promise<{text: string; actions: SelectedAction[]}> => {
    return new Promise((resolve, reject) => {
        let fullResponse = "";
        let selectedActions: SelectedAction[] = [];

        void startNPCConversation(
            request,
            chunk => {
                fullResponse += chunk;
            },
            actions => {
                selectedActions = actions;
            },
            () => {
                resolve({text: fullResponse, actions: selectedActions});
            },
            (error: Error) => {
                reject(error);
            },
        );
    });
};
