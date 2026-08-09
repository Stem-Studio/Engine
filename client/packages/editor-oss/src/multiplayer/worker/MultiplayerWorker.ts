/// <reference no-default-lib="true"/>
/// <reference lib="webworker" />
import MultiplayerClient from "./MultiplayerClient";
import {MULTIPLAYER_EVENTS} from "./MultiplayerEvents";
import {SNAPSHOT_EVENTS, BEHAVIOR_EVENTS, ASSET_EVENTS, LAMBDA_EVENTS} from "@stem/editor-oss/physics/common/events";
import {getPlayerState} from "../GameRoomState";

type WorkerMessage = {
    event?: string;
    [key: string]: any;
};

type MessageHandler = (data: WorkerMessage) => void;

const DEFAULT_DRAIN_BATCH_SIZE = 32;

export class MultiplayerWorker {
    private mpClient: MultiplayerClient;
    private handlers: Map<string, MessageHandler>;
    private queue: WorkerMessage[] = [];
    private queueHead = 0;
    private isDrainScheduled: boolean = false;
    private readonly drainBatchSize: number;

    constructor(drainBatchSize: number = DEFAULT_DRAIN_BATCH_SIZE) {
        this.mpClient = null as unknown as MultiplayerClient;
        this.handlers = new Map();
        this.drainBatchSize = Math.max(1, Math.floor(drainBatchSize));
        this.registerHandlers();
    }

    onMessage(msg: MessageEvent): void {
        const {data} = msg;
        if (!data || typeof data.event !== "string") {
            return;
        }
        this.queue.push(data);
        this.scheduleDrain();
    }

    private scheduleDrain(): void {
        if (this.isDrainScheduled) {
            return;
        }
        this.isDrainScheduled = true;
        Promise.resolve().then(() => this.drainQueue());
    }

    private drainQueue(): void {
        this.isDrainScheduled = false;
        let processed = 0;
        while (this.queueHead < this.queue.length && processed < this.drainBatchSize) {
            const data = this.queue[this.queueHead++];
            if (data) {
                this.dispatch(data);
                processed++;
            }
        }

        if (this.queueHead >= this.queue.length) {
            this.queue.length = 0;
            this.queueHead = 0;
            return;
        }

        if (this.queueHead >= 1024 && this.queueHead * 2 >= this.queue.length) {
            this.queue.splice(0, this.queueHead);
            this.queueHead = 0;
        }

        if (this.queueHead < this.queue.length) {
            this.isDrainScheduled = true;
            setTimeout(() => this.drainQueue(), 0);
        }
    }

    private dispatch(data: WorkerMessage): void {
        const handler = this.handlers.get(data.event as string);
        if (!handler) {
            console.warn(`[MultiplayerWorker] Unhandled event: ${String(data.event)}`);
            return;
        }
        handler(data);
    }

    private withClient(action: (client: MultiplayerClient) => void): void {
        if (!this.mpClient) {
            return;
        }
        action(this.mpClient);
    }

    private registerHandlers(): void {
        this.handlers.set(MULTIPLAYER_EVENTS.START, data => this.handleStart(data));

        this.handlers.set(MULTIPLAYER_EVENTS.DISCONNECT, () => this.withClient(client => client.stop()));
        this.handlers.set(MULTIPLAYER_EVENTS.STOP, () => this.withClient(client => client.stop()));

        this.handlers.set(MULTIPLAYER_EVENTS.OBJECT.ANIMATION.SET, ({uuid, animation}) =>
            this.withClient(client => client.setCurrentAnimation(uuid, animation)),
        );
        this.handlers.set(MULTIPLAYER_EVENTS.OBJECT.UPDATE, ({uuid, objectState}) =>
            this.withClient(client => client.updateObject(uuid, objectState)),
        );
        this.handlers.set(MULTIPLAYER_EVENTS.OBJECT.ADD, ({uuid, objectState}) =>
            this.withClient(client => client.addObject(uuid, objectState)),
        );
        this.handlers.set(MULTIPLAYER_EVENTS.OBJECT.REMOVE, ({uuid}) =>
            this.withClient(client => client.removeObject(uuid)),
        );
        this.handlers.set(MULTIPLAYER_EVENTS.OBJECT.COLLISION_BEHAVIOR.SET, ({uuid, behavior}) =>
            this.withClient(client => client.setCollisionBehavior(uuid, behavior)),
        );
        this.handlers.set(MULTIPLAYER_EVENTS.BEHAVIOR.DATA.SET, ({uuid, behaviorId, key, value}) =>
            this.withClient(client => client.setBehaviorData(uuid, behaviorId, key, value)),
        );
        this.handlers.set(MULTIPLAYER_EVENTS.PLAYER.SET, ({uuid}) =>
            this.withClient(client => client.setPlayerObject(uuid)),
        );
        this.handlers.set(MULTIPLAYER_EVENTS.PLAYER.DATA.SET, ({key, value}) =>
            this.withClient(client => client.setPlayerData(key, value)),
        );
        this.handlers.set(MULTIPLAYER_EVENTS.OBJECT.CHILD.ADD, ({uuid, child}) =>
            this.withClient(client => client.addChild(uuid, child)),
        );
        this.handlers.set(MULTIPLAYER_EVENTS.OBJECT.CHILD.REMOVE, ({uuid, child}) =>
            this.withClient(client => client.removeChild(uuid, child)),
        );
        this.handlers.set(MULTIPLAYER_EVENTS.CHAT.MESSAGE, ({message}) =>
            this.withClient(client => client.sendChatMessage(message)),
        );
        this.handlers.set(MULTIPLAYER_EVENTS.DISCONNECT_CLIENTS, () =>
            this.withClient(client => client.disconnectClients()),
        );
        this.handlers.set(MULTIPLAYER_EVENTS.HEARTBEAT, () =>
            this.withClient(client => client.heartbeat()),
        );

        this.handlers.set(SNAPSHOT_EVENTS.ADD.OBJECT, ({object}) =>
            this.withClient(client => client.addSnapshotObject(object)),
        );
        this.handlers.set(SNAPSHOT_EVENTS.REMOVE.OBJECT, ({uuid}) =>
            this.withClient(client => client.removeSnapshotObject(uuid)),
        );
        this.handlers.set(SNAPSHOT_EVENTS.UPDATE.OBJECT, ({object}) =>
            this.withClient(client => client.updateSnapshotObject(object)),
        );
        this.handlers.set(SNAPSHOT_EVENTS.UPDATE.SCENE_CHILDREN, ({uuid, children}) =>
            this.withClient(client => client.updateSnapshotSceneChildren(uuid, children)),
        );
        this.handlers.set(SNAPSHOT_EVENTS.UPDATE.OBJECT_USER_DATA, ({uuid, userData}) =>
            this.withClient(client => client.updateSnapshotObjectUserData(uuid, userData)),
        );
        this.handlers.set(SNAPSHOT_EVENTS.SYNC.CHECK_REQUEST, () =>
            this.withClient(client => client.requestSyncCheckData()),
        );

        this.handlers.set(ASSET_EVENTS.ADD, ({assetId}) =>
            this.withClient(client => client.addAsset(assetId)),
        );
        this.handlers.set(ASSET_EVENTS.REMOVE, ({assetId}) =>
            this.withClient(client => client.removeAsset(assetId)),
        );
        this.handlers.set(ASSET_EVENTS.UPDATE, ({assetId}) =>
            this.withClient(client => client.updateAsset(assetId)),
        );

        this.handlers.set(BEHAVIOR_EVENTS.REGISTER.BEHAVIOR, ({behavior}) =>
            this.withClient(client => client.registerBehavior(behavior)),
        );
        this.handlers.set(BEHAVIOR_EVENTS.UNREGISTER.BEHAVIOR, ({behavior}) =>
            this.withClient(client => client.unregisterBehavior(behavior)),
        );
        this.handlers.set(BEHAVIOR_EVENTS.UPDATE.BEHAVIOR, ({behavior}) =>
            this.withClient(client => client.updateBehavior(behavior)),
        );
        this.handlers.set(BEHAVIOR_EVENTS.REGISTER.SCRIPT, ({script}) =>
            this.withClient(client => client.registerScript(script)),
        );
        this.handlers.set(BEHAVIOR_EVENTS.UNREGISTER.SCRIPT, ({script}) =>
            this.withClient(client => client.unregisterScript(script)),
        );
        this.handlers.set(BEHAVIOR_EVENTS.UPDATE.SCRIPT, ({script}) =>
            this.withClient(client => client.updateScript(script)),
        );

        this.handlers.set(LAMBDA_EVENTS.REGISTER, ({lambda}) =>
            this.withClient(client => client.registerLambda(lambda)),
        );
        this.handlers.set(LAMBDA_EVENTS.UNREGISTER, ({lambda}) =>
            this.withClient(client => client.unregisterLambda(lambda)),
        );
        this.handlers.set(LAMBDA_EVENTS.UPDATE, ({lambda}) =>
            this.withClient(client => client.updateLambda(lambda)),
        );
    }

    private handleStart(data: WorkerMessage): void {
        if (this.mpClient?.client) {
            return;
        }
        const {url, maxClients, sceneId, user, userId, isAuthRequired, authToken, isCollaborative, inviteCode, apiUrl, ownerId} = data;
        this.mpClient = new MultiplayerClient();
        this.mpClient.start(url, maxClients, sceneId, user, userId, isAuthRequired, authToken, isCollaborative, inviteCode, apiUrl, ownerId)
            .then(async player => {
                postMessage({
                    event: MULTIPLAYER_EVENTS.WORKER.READY,
                    player: getPlayerState(player),
                    hostSessionId: this.mpClient.getHostSessionId(),
                    inviteCode: this.mpClient.room?.state.inviteCode,
                });
                // start listening for room updates
                await this.mpClient.setupRoom();
            })
            .catch(err => {
                postMessage({event: MULTIPLAYER_EVENTS.WORKER.ERROR, error: err});
            });
    }
}

/**
 *
 */
export function bootstrapMultiplayerWorker(): void {
    console.log("MP worker starting...");
    const multiplayerWorker = new MultiplayerWorker();
    addEventListener(
        "message",
        function (e) {
            multiplayerWorker.onMessage(e);
        },
        false,
    );
}

const isWorkerRuntime =
    typeof WorkerGlobalScope !== "undefined" &&
    typeof self !== "undefined" &&
    self instanceof WorkerGlobalScope;

if (isWorkerRuntime) {
    bootstrapMultiplayerWorker();
}
