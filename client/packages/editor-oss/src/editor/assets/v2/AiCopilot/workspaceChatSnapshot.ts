import type {Message} from "./utils/history";

const DB_NAME = "stemstudio-ai-copilot-chat";
const DB_VERSION = 1;
const STORE_NAME = "workspaceChatSnapshots";
const WORKSPACE_CHAT_SNAPSHOT_PREFIX = "ai_copilot_workspace_chat_snapshot";
const MAX_STORED_MESSAGES = 80;
const MAX_MESSAGE_CHARS = 20_000;

export type WorkspaceChatSnapshot = {
    sceneID: string;
    sessionID?: string | null;
    updatedAt: number;
    messages: Message[];
};

type StoredWorkspaceMessage = {
    id: string;
    type: Message["type"];
    content: string;
    timestamp: number;
};

type StoredWorkspaceChatSnapshot = {
    sceneID: string;
    sessionID?: string | null;
    updatedAt: number;
    messages: StoredWorkspaceMessage[];
};

type StoredLatestPointer = {
    sceneID: string;
    latestSessionID: string;
    updatedAt: number;
};

const memoryStore = new Map<string, StoredWorkspaceChatSnapshot | StoredLatestPointer>();
const warnedSnapshotFailures = new Set<string>();

const storageKey = (sceneID: string, sessionID?: string | null): string => {
    const safeSceneID = encodeURIComponent(sceneID);
    if (!sessionID) return `${WORKSPACE_CHAT_SNAPSHOT_PREFIX}:${safeSceneID}:latest`;
    return `${WORKSPACE_CHAT_SNAPSHOT_PREFIX}:${safeSceneID}:session:${encodeURIComponent(sessionID)}`;
};

const normalizeText = (value: unknown, limit: number): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.length > limit ? `${trimmed.slice(0, limit).trim()}...` : trimmed;
};

const normalizeMessageType = (value: unknown): Message["type"] | null => {
    if (value === "user" || value === "agent" || value === "thought") return value;
    if (value === "interactive") return "agent";
    return null;
};

const serializeMessage = (message: Message): StoredWorkspaceMessage | null => {
    const type = normalizeMessageType(message.type);
    const content = normalizeText(message.content, MAX_MESSAGE_CHARS);
    if (!type || !content) return null;

    return {
        id: message.id,
        type,
        content,
        timestamp: Number.isFinite(message.timestamp) ? message.timestamp : Date.now(),
    };
};

const deserializeMessage = (message: unknown): Message | null => {
    if (!message || typeof message !== "object") return null;
    const value = message as Partial<StoredWorkspaceMessage>;
    const type = normalizeMessageType(value.type);
    const content = normalizeText(value.content, MAX_MESSAGE_CHARS);
    if (!type || !content) return null;

    return {
        id: typeof value.id === "string" && value.id ? value.id : `workspace-${Date.now()}`,
        type,
        content,
        timestamp: typeof value.timestamp === "number" && Number.isFinite(value.timestamp)
            ? value.timestamp
            : 0,
    };
};

const isSnapshot = (value: unknown): value is StoredWorkspaceChatSnapshot => {
    if (!value || typeof value !== "object") return false;
    const snapshot = value as Partial<StoredWorkspaceChatSnapshot>;
    return typeof snapshot.sceneID === "string" && Array.isArray(snapshot.messages);
};

const isLatestPointer = (value: unknown): value is StoredLatestPointer => {
    if (!value || typeof value !== "object") return false;
    const pointer = value as Partial<StoredLatestPointer>;
    return typeof pointer.sceneID === "string" && typeof pointer.latestSessionID === "string";
};

const toWorkspaceSnapshot = (
    value: unknown,
    sceneID: string,
): WorkspaceChatSnapshot | null => {
    if (!isSnapshot(value) || value.sceneID !== sceneID) return null;

    const messages = value.messages
        .map(deserializeMessage)
        .filter((message): message is Message => Boolean(message));
    if (messages.length === 0) return null;

    return {
        sceneID,
        sessionID: typeof value.sessionID === "string" ? value.sessionID : null,
        updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
        messages,
    };
};

const purgeLegacyLocalSnapshots = (): void => {
    if (typeof window === "undefined") return;
    try {
        const keys: string[] = [];
        for (let i = 0; i < window.localStorage.length; i += 1) {
            const key = window.localStorage.key(i);
            if (key?.startsWith(`${WORKSPACE_CHAT_SNAPSHOT_PREFIX}:`)) keys.push(key);
        }
        keys.forEach(key => window.localStorage.removeItem(key));
    } catch {
        // localStorage can be disabled or already over quota; snapshot storage
        // no longer depends on it, so cleanup is best-effort.
    }
};
purgeLegacyLocalSnapshots();

const openDb = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is unavailable."));
        return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Failed to open workspace chat snapshot database."));
    request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
        }
    };
    request.onsuccess = () => resolve(request.result);
});

const runStoreRequest = async <T>(
    mode: IDBTransactionMode,
    createRequest: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
    const db = await openDb();
    return await new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        const request = createRequest(store);

        request.onerror = () => reject(request.error ?? new Error("Workspace chat snapshot request failed."));
        request.onsuccess = () => resolve(request.result);
        transaction.oncomplete = () => db.close();
        transaction.onerror = () => {
            db.close();
            reject(transaction.error ?? new Error("Workspace chat snapshot transaction failed."));
        };
        transaction.onabort = () => {
            db.close();
            reject(transaction.error ?? new Error("Workspace chat snapshot transaction aborted."));
        };
    });
};

const putSnapshot = async (snapshot: StoredWorkspaceChatSnapshot) => {
    const sessionKey = snapshot.sessionID
        ? storageKey(snapshot.sceneID, snapshot.sessionID)
        : storageKey(snapshot.sceneID);
    const latestKey = storageKey(snapshot.sceneID);

    memoryStore.set(sessionKey, snapshot);
    if (snapshot.sessionID) {
        memoryStore.set(latestKey, {
            sceneID: snapshot.sceneID,
            latestSessionID: snapshot.sessionID,
            updatedAt: snapshot.updatedAt,
        });
    } else {
        memoryStore.set(latestKey, snapshot);
    }

    await runStoreRequest("readwrite", store => {
        if (snapshot.sessionID) {
            store.put(snapshot, sessionKey);
            return store.put(
                {
                    sceneID: snapshot.sceneID,
                    latestSessionID: snapshot.sessionID,
                    updatedAt: snapshot.updatedAt,
                } satisfies StoredLatestPointer,
                latestKey,
            );
        }
        return store.put(snapshot, latestKey);
    });
};

const getStoredValue = async (key: string): Promise<StoredWorkspaceChatSnapshot | StoredLatestPointer | null> => {
    try {
        const value = await runStoreRequest<StoredWorkspaceChatSnapshot | StoredLatestPointer | undefined>(
            "readonly",
            store => store.get(key),
        );
        return value ?? null;
    } catch (error) {
        if (!warnedSnapshotFailures.has(key)) {
            warnedSnapshotFailures.add(key);
            console.warn("[workspaceChatSnapshot] Failed to read IndexedDB workspace chat snapshot:", error);
        }
        return memoryStore.get(key) ?? null;
    }
};

export const saveWorkspaceChatSnapshot = async (input: {
    sceneID: string | null | undefined;
    sessionID?: string | null;
    messages: Message[];
}): Promise<void> => {
    const sceneID = input.sceneID?.trim();
    if (!sceneID || input.messages.length === 0 || typeof window === "undefined") return;

    const messages = input.messages
        .slice(-MAX_STORED_MESSAGES)
        .map(serializeMessage)
        .filter((message): message is StoredWorkspaceMessage => Boolean(message));
    if (messages.length === 0) return;

    const snapshot: StoredWorkspaceChatSnapshot = {
        sceneID,
        sessionID: input.sessionID || null,
        updatedAt: Date.now(),
        messages,
    };

    try {
        await putSnapshot(snapshot);
        warnedSnapshotFailures.delete(storageKey(sceneID, input.sessionID || null));
    } catch (error) {
        if (!warnedSnapshotFailures.has(sceneID)) {
            warnedSnapshotFailures.add(sceneID);
            console.warn("[workspaceChatSnapshot] Failed to write IndexedDB workspace chat snapshot:", error);
        }
    }
};

export const readWorkspaceChatSnapshot = async (
    sceneID: string | null | undefined,
    sessionID?: string | null,
): Promise<WorkspaceChatSnapshot | null> => {
    const normalizedSceneID = sceneID?.trim();
    if (!normalizedSceneID || typeof window === "undefined") return null;

    if (sessionID) {
        return toWorkspaceSnapshot(await getStoredValue(storageKey(normalizedSceneID, sessionID)), normalizedSceneID);
    }

    const latest = await getStoredValue(storageKey(normalizedSceneID));
    if (isLatestPointer(latest)) {
        return toWorkspaceSnapshot(
            await getStoredValue(storageKey(normalizedSceneID, latest.latestSessionID)),
            normalizedSceneID,
        );
    }
    return toWorkspaceSnapshot(latest, normalizedSceneID);
};
