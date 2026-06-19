import "fake-indexeddb/auto";

import {IDBFactory} from "fake-indexeddb";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {
    readWorkspaceChatSnapshot,
    saveWorkspaceChatSnapshot,
} from "./workspaceChatSnapshot";

describe("workspaceChatSnapshot", () => {
    beforeEach(() => {
        window.localStorage.clear();
        vi.stubGlobal("indexedDB", new IDBFactory());
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("stores and restores latest default-workspace chat state by scene", async () => {
        await saveWorkspaceChatSnapshot({
            sceneID: "scene-1",
            sessionID: "session-1",
            messages: [
                {id: "m1", type: "user", content: "Make jumping floatier", timestamp: 100},
                {id: "m2", type: "agent", content: "I updated the preview.", timestamp: 200},
            ],
        });

        const snapshot = await readWorkspaceChatSnapshot("scene-1");

        expect(snapshot?.sceneID).toBe("scene-1");
        expect(snapshot?.sessionID).toBe("session-1");
        expect(snapshot?.messages.map(message => message.content)).toEqual([
            "Make jumping floatier",
            "I updated the preview.",
        ]);
    });

    it("can restore a specific session snapshot", async () => {
        await saveWorkspaceChatSnapshot({
            sceneID: "scene-1",
            sessionID: "session-a",
            messages: [{id: "a", type: "user", content: "First", timestamp: 1}],
        });
        await saveWorkspaceChatSnapshot({
            sceneID: "scene-1",
            sessionID: "session-b",
            messages: [{id: "b", type: "user", content: "Second", timestamp: 2}],
        });

        expect((await readWorkspaceChatSnapshot("scene-1", "session-a"))?.messages[0]?.content).toBe("First");
        expect((await readWorkspaceChatSnapshot("scene-1", "session-b"))?.messages[0]?.content).toBe("Second");
        expect((await readWorkspaceChatSnapshot("scene-1"))?.messages[0]?.content).toBe("Second");
    });

    it("stores stale interactive result messages as inert agent transcript entries", async () => {
        await saveWorkspaceChatSnapshot({
            sceneID: "scene-1",
            messages: [
                {
                    id: "interactive",
                    type: "interactive",
                    content: "Choose an asset",
                    timestamp: 10,
                },
            ],
        });

        const message = (await readWorkspaceChatSnapshot("scene-1"))?.messages[0];

        expect(message?.type).toBe("agent");
        expect(message?.content).toBe("Choose an asset");
    });

    it("stores large snapshots in IndexedDB without touching localStorage", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const localStorageSetSpy = vi.spyOn(Storage.prototype, "setItem");

        await saveWorkspaceChatSnapshot({
            sceneID: "scene-1",
            sessionID: "session-large",
            messages: Array.from({length: 20}, (_, index) => ({
                id: `m${index}`,
                type: index % 2 === 0 ? "user" : "agent",
                content: `message ${index} ${"x".repeat(3_000)}`,
                timestamp: index,
            })),
        });

        const snapshot = await readWorkspaceChatSnapshot("scene-1", "session-large");

        expect(snapshot?.messages.length).toBe(20);
        expect(snapshot?.messages[19]?.content).toContain("message 19");
        expect(localStorageSetSpy).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();
    });
});
