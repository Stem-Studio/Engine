import { beforeEach, describe, expect, it, vi } from "vitest";

import { MULTIPLAYER_EVENTS } from "./MultiplayerEvents";
import { MultiplayerWorker } from "./MultiplayerWorker";
import { LAMBDA_EVENTS } from "@stem/editor-oss/physics/common/events";

const {mockClientFactory, mockGetPlayerState} = vi.hoisted(() => ({
    mockClientFactory: vi.fn(),
    mockGetPlayerState: vi.fn(),
}));

vi.mock("./MultiplayerClient", () => {
    class MockMultiplayerClient {
        constructor() {
            return mockClientFactory();
        }
    }
    return {
        default: MockMultiplayerClient,
    };
});

vi.mock("../GameRoomState", () => {
    return {
        getPlayerState: mockGetPlayerState,
    };
});

/**
 *
 */
function makeClientMock() {
    return {
        client: null,
        room: { state: { inviteCode: "ABC123" } },
        start: vi.fn().mockResolvedValue({ id: "player-1" }),
        stop: vi.fn(),
        setupRoom: vi.fn().mockResolvedValue(undefined),
        getHostSessionId: vi.fn().mockReturnValue("host-1"),
        updateObject: vi.fn(),
        addObject: vi.fn(),
        removeObject: vi.fn(),
        setCurrentAnimation: vi.fn(),
        setCollisionBehavior: vi.fn(),
        setBehaviorData: vi.fn(),
        setPlayerObject: vi.fn(),
        setPlayerData: vi.fn(),
        addChild: vi.fn(),
        removeChild: vi.fn(),
        sendChatMessage: vi.fn(),
        disconnectClients: vi.fn(),
        heartbeat: vi.fn(),
        addSnapshotObject: vi.fn(),
        removeSnapshotObject: vi.fn(),
        updateSnapshotObject: vi.fn(),
        updateSnapshotSceneChildren: vi.fn(),
        updateSnapshotObjectUserData: vi.fn(),
        addAsset: vi.fn(),
        removeAsset: vi.fn(),
        updateAsset: vi.fn(),
        registerBehavior: vi.fn(),
        unregisterBehavior: vi.fn(),
        updateBehavior: vi.fn(),
        registerScript: vi.fn(),
        unregisterScript: vi.fn(),
        updateScript: vi.fn(),
        registerLambda: vi.fn(),
        unregisterLambda: vi.fn(),
        updateLambda: vi.fn(),
        requestSyncCheckData: vi.fn(),
    };
}

describe("MultiplayerWorker", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        mockGetPlayerState.mockImplementation(player => ({ id: player.id }));
        (globalThis as any).postMessage = vi.fn();
    });

    it("drains queued messages in batches while preserving FIFO order", async () => {
        const client = makeClientMock();
        mockClientFactory.mockReturnValue(client);

        const worker = new MultiplayerWorker(2);
        worker.onMessage({
            data: { event: MULTIPLAYER_EVENTS.START, url: "ws://x", maxClients: 4, sceneId: "s", user: {}, userId: "u" },
        } as MessageEvent);
        worker.onMessage({
            data: { event: MULTIPLAYER_EVENTS.OBJECT.UPDATE, uuid: "1", objectState: { a: 1 } },
        } as MessageEvent);
        worker.onMessage({
            data: { event: MULTIPLAYER_EVENTS.OBJECT.REMOVE, uuid: "2" },
        } as MessageEvent);

        await Promise.resolve();
        expect(client.start).toHaveBeenCalledTimes(1);
        expect(client.updateObject).toHaveBeenCalledTimes(1);
        expect(client.removeObject).toHaveBeenCalledTimes(0);

        vi.runOnlyPendingTimers();
        await Promise.resolve();
        expect(client.removeObject).toHaveBeenCalledWith("2");
    });

    it("drains batches without shifting the pending message array", async () => {
        const client = makeClientMock();
        mockClientFactory.mockReturnValue(client);

        const worker = new MultiplayerWorker(2) as unknown as {
            onMessage(msg: MessageEvent): void;
            queue: Array<{event: string}>;
        };
        worker.onMessage({
            data: { event: MULTIPLAYER_EVENTS.START, url: "ws://x", maxClients: 4, sceneId: "s", user: {}, userId: "u" },
        } as MessageEvent);
        worker.onMessage({
            data: { event: MULTIPLAYER_EVENTS.OBJECT.UPDATE, uuid: "1", objectState: { a: 1 } },
        } as MessageEvent);
        worker.onMessage({
            data: { event: MULTIPLAYER_EVENTS.OBJECT.REMOVE, uuid: "2" },
        } as MessageEvent);

        const shiftSpy = vi.spyOn(worker.queue, "shift");

        await Promise.resolve();
        vi.runOnlyPendingTimers();
        await Promise.resolve();

        expect(shiftSpy).not.toHaveBeenCalled();
        expect(client.updateObject).toHaveBeenCalledWith("1", { a: 1 });
        expect(client.removeObject).toHaveBeenCalledWith("2");

        shiftSpy.mockRestore();
    });

    it("routes START and posts worker ready payload", async () => {
        const client = makeClientMock();
        mockClientFactory.mockReturnValue(client);

        const worker = new MultiplayerWorker();
        worker.onMessage({
            data: {
                event: MULTIPLAYER_EVENTS.START,
                url: "ws://localhost",
                maxClients: 8,
                sceneId: "scene",
                user: { name: "u" },
                userId: "user-1",
                isAuthRequired: true,
                authToken: "token",
                isCollaborative: true,
                inviteCode: "INVITE",
                apiUrl: "http://localhost",
            },
        } as MessageEvent);

        await Promise.resolve();
        await Promise.resolve();

        expect(client.start).toHaveBeenCalledTimes(1);
        expect(mockGetPlayerState).toHaveBeenCalledWith({ id: "player-1" });
        expect(globalThis.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                event: MULTIPLAYER_EVENTS.WORKER.READY,
                player: { id: "player-1" },
                hostSessionId: "host-1",
                inviteCode: "ABC123",
            }),
        );
        expect(client.setupRoom).toHaveBeenCalledTimes(1);
    });

    it("warns on unknown events without throwing", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const worker = new MultiplayerWorker();

        worker.onMessage({
            data: { event: "unknown.event" },
        } as MessageEvent);

        await Promise.resolve();

        expect(warnSpy).toHaveBeenCalledWith("[MultiplayerWorker] Unhandled event: unknown.event");
        warnSpy.mockRestore();
    });

    it("routes lambda sync events to the multiplayer client", async () => {
        const client = makeClientMock();
        (client as any).client = {};
        mockClientFactory.mockReturnValue(client);

        const worker = new MultiplayerWorker();
        worker.onMessage({
            data: { event: MULTIPLAYER_EVENTS.START, url: "ws://x", maxClients: 4, sceneId: "s", user: {}, userId: "u" },
        } as MessageEvent);
        await Promise.resolve();
        await Promise.resolve();

        const lambda = {
            id: "follow-player",
            config: { id: "follow-player", name: "Follow Player" },
            userId: "user-1",
        };

        worker.onMessage({ data: { event: LAMBDA_EVENTS.REGISTER, lambda } } as MessageEvent);
        worker.onMessage({ data: { event: LAMBDA_EVENTS.UPDATE, lambda } } as MessageEvent);
        worker.onMessage({
            data: { event: LAMBDA_EVENTS.UNREGISTER, lambda: { id: "follow-player", userId: "user-1" } },
        } as MessageEvent);
        await Promise.resolve();

        expect(client.registerLambda).toHaveBeenCalledWith(lambda);
        expect(client.updateLambda).toHaveBeenCalledWith(lambda);
        expect(client.unregisterLambda).toHaveBeenCalledWith({ id: "follow-player", userId: "user-1" });
    });
});
