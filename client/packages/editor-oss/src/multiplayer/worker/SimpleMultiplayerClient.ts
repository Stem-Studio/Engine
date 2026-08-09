import {MathUtils, Mesh, MeshStandardMaterial, Object3D, Quaternion, Scene, Vector3} from "three";
import type {QuaternionLike, Vector3Like, Wrapping} from "three";

import {MULTIPLAYER_EVENTS} from "./MultiplayerEvents";
import MultiplayerWorker from "./MultiplayerWorker.ts?worker";
import EngineRuntime, {ApplicationMode} from "@stem/editor-oss/EngineRuntime";
import {PhysicsShape} from "@stem/editor-oss/behaviors/state/IMultiplayerState";
import type {
    ChatMessageReceivedListener,
    ClientDisconnectedListener,
    HostChangedListener,
    IMultiplayerState,
    PlayerAddedOrRemovedListener,
    PlayerDataChangedListener,
    PrivateRoomInfo,
    RoomInfo,
} from "@stem/editor-oss/behaviors/state/IMultiplayerState";
import {AnimationController} from "@stem/editor-oss/controls/AnimationController";
import {markLocalPlayerAvatar, markRemotePlayerAvatar} from "@stem/editor-oss/core/budget/AvatarBudgetPolicy";
import global from "@stem/editor-oss/global";
import {loadModel} from "@stem/editor-oss/model/load-util";
import {CollisionBehavior, IDispatcher, IPhysics} from "@stem/editor-oss/physics/common/types";
import {PhysicsRuntimeUtil as PhysicsUtil} from "@stem/editor-oss/physics/PhysicsRuntimeUtil";
import {MultiplayerUtils} from "@stem/editor-oss/physics/simple/MultiplayerUtils";
import {loadPrefab} from "@stem/editor-oss/prefab/util";
import {showToast} from "@stem/editor-oss/showToast";
import {TemplateType} from "@stem/editor-oss/types/TemplateType";
import Ajax from "@stem/editor-oss/utils/Ajax";
import {confirm as showConfirm} from "@stem/editor-oss/utils/ElementsUtils";
import {getObjectTemplate, getObjectTemplateType} from "@stem/editor-oss/utils/ObjectUtils";
import {findObjectByUuidDepthFirst, traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";
import {backendUrlFromPath} from "@stem/editor-oss/utils/UrlUtils";
import {REACT_APP_MULTIPLAYER_SERVER_URL} from "../Constants";
import type {GameObject, Material, Player} from "../GameRoomState";

enum ErrorAction {
    RETURN_TO_DASHBOARD = "RETURN_TO_DASHBOARD",
}

type StoredState = {
    position: Vector3Like;
    quaternion: Quaternion;
    scale: Vector3Like;
    visible: boolean;
    material?: MaterialData;
};

type RoomInfoResponse = {
    name: string;
    inviteCode: string;
    sceneId: string;
    ownerId: string;
    currentPlayers: number;
    maxPlayers: number;
    waitingListCount: number;
    canJoin: boolean;
    canJoinWaitingList: boolean;
    settings: {
        allowWaitingList: boolean;
        autoStart: boolean;
    };
    isActive: boolean;
    createdAt: Date;
};

export default class SimpleMultiplayerClient implements IMultiplayerState {
    userId: string;

    sceneId: string;
    scene: Scene;
    maxClientsPerRoom: number;
    physics: IPhysics | null = null;
    dispatcher: IDispatcher | null = null;

    workerHandler: Worker | null = null;
    workerReady: boolean = false;
    workerError: boolean = false;
    workerErrorMessage: string | null = null;
    protected terminated: boolean = false;
    private closeConnectionErrorDialog?: () => void;

    behaviorData: BehaviorDataStorage = new BehaviorDataStorage();

    clientDisconnectedListeners = new Map<string, ClientDisconnectedListener>();

    hostChangedListeners = new Map<string, HostChangedListener>();

    localObjects: Map<string, Object3D> = new Map<string, Object3D>();
    remoteObjects: Map<string, Object3D> = new Map<string, Object3D>();
    interpolatedObjects: Map<string, Object3D> = new Map<string, Object3D>();

    playerUuid: string | null = null;
    player: Player | null = null;

    hostSessionId: string = "";

    inviteCode: string | null = null;

    players: Map<string, Player> = new Map<string, Player>();
    playerAddedListeners: Map<string, PlayerAddedOrRemovedListener> = new Map<string, PlayerAddedOrRemovedListener>();
    playerRemovedListeners: Map<string, PlayerAddedOrRemovedListener> = new Map<string, PlayerAddedOrRemovedListener>();
    playerDataChangedListeners: Map<string, PlayerDataChangedListener> = new Map<string, PlayerDataChangedListener>();

    chatListeners: Map<string, ChatMessageReceivedListener> = new Map<string, ChatMessageReceivedListener>();

    heartbeatIntervalId: ReturnType<typeof setInterval> | undefined = undefined;

    public static THRESHOLD_MOVEMENT = 0.01;
    public static THRESHOLD_SCALE = 0.01;
    public static THRESHOLD_QUATERNION = 1 - 0.01;

    constructor(
        userId: string,
        maxClient: number,
        sceneId: string,
        scene: Scene,
        physics: IPhysics | null,
        dispatcher: IDispatcher | null,
    ) {
        this.userId = userId == null ? MathUtils.generateUUID() : userId;
        this.maxClientsPerRoom = maxClient;
        this.sceneId = sceneId;
        this.scene = scene;
        this.physics = physics;
        this.dispatcher = dispatcher;
    }

    public start(inviteCode?: string): Promise<void> {
        this.terminated = false;
        return new Promise((resolve, reject) => {
            if (this.workerHandler) {
                reject(new Error("MP: worker already started. Call terminate() first."));
                return;
            }
            //create worker
            const workerHandler = new MultiplayerWorker();
            this.workerHandler = workerHandler;
            workerHandler.onmessage = this.onMessage;
            workerHandler.onerror = (error: ErrorEvent) => {
                console.error("Multiplayer worker error:", error);
                this.workerError = true;
                this.workerReady = false;
                this.workerErrorMessage = error.message || "An unexpected error occurred in the multiplayer worker";
                this.showConnectionErrorDialog(this.workerErrorMessage!);
            };
            workerHandler.onmessageerror = (error: any) => {
                console.error("Multiplayer worker message error:", error);
            };
            console.debug("Multiplayer worker created");

            // getUserData now guarantees non-empty values, but keep fallback for extra safety
            const userData = global.app?.authManager?.getUserData();
            const safeUser = {
                username: userData?.username ?? "Guest",
                avatar: userData?.avatar ?? "",
                name: userData?.name ?? "Guest",
                email:
                    userData?.email ??
                    (userData?.username ?? userData?.name ?? "guest").replace(" ", "_") + "@guest.com",
                id: userData?.id ?? MathUtils.generateUUID(),
            };

            //start a heartbeat interval
            clearInterval(this.heartbeatIntervalId);
            this.heartbeatIntervalId = setInterval(() => {
                this.verifyPlayers();
                if (this.workerReady) {
                    this.workerHandler?.postMessage({event: MULTIPLAYER_EVENTS.HEARTBEAT});
                }
            }, 1000);

            this.workerError = false;
            this.workerErrorMessage = null;

            workerHandler.postMessage({
                event: MULTIPLAYER_EVENTS.START,
                url: REACT_APP_MULTIPLAYER_SERVER_URL,
                maxClients: this.maxClientsPerRoom,
                sceneId: this.sceneId,
                user: safeUser,
                inviteCode: inviteCode,
                apiUrl: this.getMultiplayerApiUrl(),
            });
            this.waitWorkerIsReady(resolve, reject, 60000);
        });
    }

    private verifyPlayers(): void {
        this.players.forEach(player => {
            // Skip players with empty or invalid UUID
            if (!player.uuid || player.uuid === "") {
                return;
            }

            const playerObj = findObjectByUuidDepthFirst(this.scene, player.uuid);
            if (playerObj && !playerObj.visible) {
                console.error("MP: CHECK: player is not visible", playerObj);
            } else if (!playerObj) {
                console.error("MP: CHECK: player object not found", player);
            }
        });
    }

    public terminate(): Promise<void> {
        this.terminated = true;
        return new Promise(resolve => {
            //stop the heartbeat
            clearInterval(this.heartbeatIntervalId);
            if (this.workerHandler) {
                //stop receiving messages from the worker
                this.workerHandler.onmessage = null;
                //disconnect the mp client
                this.workerHandler.postMessage({event: MULTIPLAYER_EVENTS.STOP});
                //wait a few sec to make sure the disconnect was completed
                setTimeout(() => {
                    this.workerHandler?.terminate();
                    this.workerHandler = null;
                    this.workerReady = false;
                    this.workerError = false;
                    resolve();
                }, 3000);
            } else {
                resolve();
            }
        });
    }

    public getSlot() {
        return this.player?.slot || 0;
    }

    public setCurrentAnimation(objectUuid: string): void {
        const object = findObjectByUuidDepthFirst(this.scene, objectUuid);
        if (!object) {
            return;
        }

        const animationParams = AnimationController.getCurrentAnimationParams(object);

        this.workerHandler?.postMessage({
            event: MULTIPLAYER_EVENTS.OBJECT.ANIMATION.SET,
            uuid: objectUuid,
            animation: JSON.stringify(animationParams),
        });
    }

    public setCollisionBehavior(uuid: string, behavior: CollisionBehavior): void {
        this.workerHandler?.postMessage({
            event: MULTIPLAYER_EVENTS.OBJECT.COLLISION_BEHAVIOR.SET,
            uuid,
            behavior,
        });
    }

    /////////// private stuff ////////////

    protected onMessage = (event: MessageEvent) => {
        const {data} = event;
        switch (data.event) {
            case MULTIPLAYER_EVENTS.WORKER.READY: {
                const {player, hostSessionId, inviteCode} = data;
                this.workerReady = true;
                this.player = player;
                if (this.playerUuid) {
                    this.player!.uuid = player.uuid;
                }
                this.hostSessionId = hostSessionId;
                this.inviteCode = inviteCode;
                console.debug("MP: worker ready !!!", this.player, this.isHost());
                break;
            }
            case MULTIPLAYER_EVENTS.DISCONNECTED: {
                const {consented, code} = data;
                this.workerReady = false;
                this.onClientDisconnected(consented);
                if (code === 3000) {
                    showToast({
                        type: "info",
                        title: "Disconnected",
                        body: "You have been disconnected from the server by client request. Refresh the page to reconnect.",
                    });
                }
                break;
            }
            case MULTIPLAYER_EVENTS.WORKER.ERROR: {
                const {error, action} = data;
                console.error(`MP: worker error: error=${error} action=${action}`, data);
                this.workerErrorMessage = error || "Failed to connect to multiplayer server.";
                this.showConnectionErrorDialog(this.workerErrorMessage!, action);
                this.workerReady = false;
                this.workerError = true;
                break;
            }
            case MULTIPLAYER_EVENTS.HOST.CHANGED: {
                console.debug("MP: host changed: " + data.hostSessionId);
                this.hostSessionId = data.hostSessionId;
                this.onHostChanged();
                break;
            }
            case MULTIPLAYER_EVENTS.OBJECT.ANIMATION.CHANGED: {
                const {uuid, animation} = data;
                this.onObjectAnimationChanged(uuid, animation);
                break;
            }
            case MULTIPLAYER_EVENTS.OBJECT.COLLISION_BEHAVIOR.CHANGED: {
                const {uuid, behavior} = data;
                this.onCollisionBehaviorChanged(uuid, behavior);
                break;
            }
            case MULTIPLAYER_EVENTS.OBJECT.ADDED: {
                const {objectState} = data;
                this.onObjectAdded(objectState).catch(console.error);
                break;
            }
            case MULTIPLAYER_EVENTS.OBJECT.UPDATED: {
                const {uuid, position, quaternion, scale, visible} = data;
                const object = this.remoteObjects.get(uuid);
                if (!object) {
                    console.warn("MP: object not found in remote objects: " + uuid);
                    return;
                }
                if (this.interpolatedObjects.has(uuid) && position) {
                    InterpolationData.setCurrentUpdate(object, position);
                    this.updateObjectWithInterpolation(object, position, quaternion, scale, visible);
                } else {
                    this.updateObject(object, position, quaternion, scale, visible);
                }
                break;
            }
            case MULTIPLAYER_EVENTS.OBJECT.REMOVED: {
                const {uuid} = data;
                this.onObjectRemoved(uuid);
                break;
            }
            case MULTIPLAYER_EVENTS.OBJECT.CHILD.ADDED: {
                const {uuid, child} = data;
                this.onChildAdded(uuid, child).catch(console.error);
                break;
            }
            case MULTIPLAYER_EVENTS.OBJECT.CHILD.REMOVED: {
                const {uuid, childUuid} = data;
                this.onChildRemoved(uuid, childUuid);
                break;
            }
            case MULTIPLAYER_EVENTS.OBJECT.CHILD.UPDATED: {
                const {uuid, childUuid, position, quaternion, scale, visible, material} = data;
                const object = this.remoteObjects.get(uuid);
                if (object) {
                    const child = findObjectByUuidDepthFirst(object, childUuid);
                    if (child) {
                        this.updateObject(child, position, quaternion, scale, visible, material);
                    } else {
                        console.warn(
                            `MP: child not found in remote object: ${uuid} -> ${object.name} => ${childUuid}`,
                            object,
                        );
                    }
                }
                break;
            }
            case MULTIPLAYER_EVENTS.BEHAVIOR.DATA.CHANGED: {
                const {uuid, behaviorId, key, value} = data;
                this.onBehaviorDataChanged(uuid, behaviorId, key, value);
                break;
            }
            case MULTIPLAYER_EVENTS.PLAYER.ADDED: {
                const {player} = data;
                if (this.player?.sessionId === player.sessionId) return; //ignore self
                this.onPlayerAdded(player);
                break;
            }
            case MULTIPLAYER_EVENTS.PLAYER.REMOVED: {
                const {player} = data;
                if (this.player?.sessionId === player.sessionId) return; //ignore self
                this.onPlayerRemoved(player);
                break;
            }
            case MULTIPLAYER_EVENTS.PLAYER.DATA.CHANGED: {
                const {playerObjectUuid, key, value} = data;
                //console.debug(`MP: onPlayerDataChanged: ${this.player?.uuid} <> ${playerObjectUuid}`, this.player, key, value);
                if (this.player?.uuid === playerObjectUuid) return; //ignore self
                this.onPlayerDataChanged(playerObjectUuid, key, value);
                break;
            }
            case MULTIPLAYER_EVENTS.CHAT.MESSAGE: {
                const {id, senderId, message, filtered, timestamp} = data;
                this.onChatMessage(id, senderId, message, filtered, timestamp);
                break;
            }
        }
    };

    public sendChatMessage(message: string): void {
        this.workerHandler!.postMessage({event: MULTIPLAYER_EVENTS.CHAT.MESSAGE, message});
    }

    public addOnChatMessageReceivedListener(listener: ChatMessageReceivedListener): string {
        const token = MathUtils.generateUUID();
        this.chatListeners.set(token, listener);
        return token;
    }

    public removeOnChatMessageReceivedListener(token: string): void {
        this.chatListeners.delete(token);
    }

    private getMultiplayerApiUrl() {
        const apiUrl = backendUrlFromPath("/api/", true);
        return apiUrl?.replace("/api/", "");
    }

    private onChatMessage(
        messageId: string,
        senderId: string,
        message: string,
        filtered: boolean,
        timestamp: number,
    ): void {
        this.chatListeners.forEach(listener => {
            listener(messageId, senderId, message, filtered, timestamp);
        });
    }

    private onClientDisconnected(consented: boolean) {
        this.remoteObjects.forEach(object => {
            (global.app as EngineRuntime)?.game?.removeObject(object);
        });
        this.remoteObjects.clear();
        this.interpolatedObjects.clear();
        this.players.clear();
        this.behaviorData.clear();
        //stop heartbeat
        clearInterval(this.heartbeatIntervalId);
        //notify listeners
        for (const listener of this.clientDisconnectedListeners.values()) {
            listener(consented);
        }
    }

    private onObjectAnimationChanged(uuid: any, animation: any) {
        const targetObj = findObjectByUuidDepthFirst(this.scene, uuid);
        if (!targetObj) return;
        try {
            if (!animation) {
                global.app!.animationControl?.stopAnimation(targetObj);
            } else {
                const animationParams = JSON.parse(animation);
                global.app!.animationControl?.playAnimation(targetObj, animationParams, 1);
            }
        } catch (e) {
            console.error(`MP: Failed to parse animation params for ${targetObj.uuid}/${targetObj.name}`, animation, e);
        }
    }

    private isCollisionBehavior(behavior: string): behavior is CollisionBehavior {
        return Object.values(CollisionBehavior).includes(behavior as CollisionBehavior);
    }

    private onCollisionBehaviorChanged(uuid: string, behavior: string) {
        if (!this.isCollisionBehavior(behavior)) {
            console.warn("MP.start.objects.onCollisionBehaviorChanged: invalid behavior: " + behavior);
            return;
        }

        this.physics?.setCollisionBehavior(uuid, behavior);
    }

    private async onChildAdded(uuid: string, child: ObjectState) {
        const object = findObjectByUuidDepthFirst(this.scene, uuid);
        if (!object) {
            console.warn("MP: onChildAdded: root not found in scene: " + uuid);
            return;
        }
        return this.addChildObject(object, child);
    }

    //called by the MP worker
    private async addChildObject(object: Object3D, child: ObjectState | GameObject) {
        //check parent
        const parentObject = findObjectByUuidDepthFirst(object, child.parent);
        if (!parentObject) {
            console.warn(
                `MP: parent not found in scene: ${object.uuid}/${object.name} -> ${child.uuid}/${child.name} -> ${child.parent}`,
                child,
            );
            return;
        }
        //clone child object
        if (!child.templateType || !child.template) {
            console.warn(
                `MP: child object doesn't have template set: ${object.uuid}/${object.name} -> ${child.uuid}/${child.name}`,
                child,
            );
            return;
        }

        let childObject;
        try {
            childObject = await this.cloneObject(child as GameObject);
        } catch (error) {
            console.error(
                `MP: objects.onAdd failed to clone object: ${object.uuid}/${object.name} -> ${child.uuid}/${child.name}`,
                child,
                error,
            );
            return;
        }

        childObject.uuid = child.uuid;
        //add child to parent
        parentObject?.add(childObject);
    }

    private onChildRemoved(uuid: any, childUuid: any) {
        const object = findObjectByUuidDepthFirst(this.scene, uuid);
        if (!object) {
            console.warn("MP: onChildRemoved: root not found in scene: " + uuid);
            return;
        }
        const childObject = findObjectByUuidDepthFirst(object, childUuid);
        if (!childObject) {
            console.warn("MP: onChildRemoved: child not found in root object: " + childUuid);
            return;
        }
        childObject.removeFromParent();
    }

    private onObjectRemoved(uuid: any) {
        const sceneObject = findObjectByUuidDepthFirst(this.scene, uuid);
        if (sceneObject) {
            console.debug("this.scene.remove(sceneObject)", sceneObject);
            global.app!.animationControl?.stopAnimation(sceneObject);
            PhysicsUtil.removePhysicsObject(this.scene, this.physics, sceneObject);
        } else {
            console.warn("MP.start.objects.onRemove: object not found in the scene: " + uuid, this.scene);
        }
        //remove from all lists
        this.remoteObjects.delete(uuid);
        this.interpolatedObjects.delete(uuid);
        this.players.delete(uuid);
    }

    private async onObjectAdded(objectState: GameObject) {
        if (this.localObjects.has(objectState.uuid)) return;

        let clonedObj;
        try {
            clonedObj = await this.cloneObject(objectState);
        } catch (error) {
            console.error(
                `MP: objects.onAdd failed to clone object: ${objectState.templateType} -> ${objectState.template} -> children=${objectState.children?.size}`,
                objectState,
                error,
            );
            return;
        }

        //add to remote list
        this.remoteObjects.set(clonedObj.uuid, clonedObj);
        //add remote players to interpolated objects list
        const player = this.players.get(objectState.uuid);
        if (player) {
            console.debug("MP: adding player to interpolated objects list: " + objectState.uuid);
            this.markRemotePlayerObject(clonedObj, player);
            this.interpolatedObjects.set(objectState.uuid, clonedObj);
        }

        // CHILDREN
        if (objectState.children && objectState.children.size > 0) {
            // Children are stored in a flat list. Each child has a unique
            // index to identify it. The indices reflect the traversal order
            // of the children, so it is important that all clients traverse
            // the children in the same order.
            const uuidMap = new Map<number, string>();
            objectState.children.forEach(child => {
                if (child.index >= 0) {
                    //added children have negative index
                    uuidMap.set(child.index, child.uuid);
                }
            });

            const childObjectMap = new Map<string, Object3D>();
            traverseObjectDepthFirst(clonedObj, child => {
                // Skip the root object (the client adding the new object
                // does this as well).
                if (child.uuid === clonedObj.uuid) {
                    return;
                }

                childObjectMap.set(child.uuid, child);
            });

            // Update children uuids in the cloned object to match the ones
            // in the GameObject.
            let index = 0;
            childObjectMap.forEach(child => {
                const uuid = uuidMap.get(index);

                if (!uuid) {
                    console.error(
                        `MP: child is missing in uuid map: ${clonedObj.uuid} -> ${index}/${child.name}`,
                        clonedObj,
                        uuidMap,
                    );
                    return;
                }

                child.uuid = uuid;
                index++;
            });

            //clone material in children
            childObjectMap.forEach(child => {
                //clone material
                MaterialData.cloneMaterial(child);
            });

            //check added children
            for (const [, child] of objectState.children) {
                if (child.index < 0) {
                    await this.addChildObject(clonedObj, child);
                }
            }
        }
    }

    protected waitWorkerIsReady(
        resolve: (value: void | PromiseLike<void>) => void,
        reject: (reason?: any) => void,
        remainingTimeMs: number,
    ): void {
        console.debug("MP: Waiting for worker " + this.workerReady);
        setTimeout(() => {
            if (this.terminated) {
                reject(new Error("MP: connection aborted due to mode change"));
                return;
            }
            if (this.workerReady) {
                console.debug("MP: Worker started successfully !");
                if (this.isHost()) {
                    global.app?.call("multiplayerHostStarted", this, this.player);
                }
                global.app?.call("multiplayerConnected", this, this.player);
                resolve();
            } else {
                console.debug("MP: Waiting for worker. Time remaining: " + remainingTimeMs + " ms");
                if (this.workerError || remainingTimeMs <= 0) {
                    console.error("MP: Worker failed to start with expected time");
                    const errorMessage =
                        this.workerErrorMessage || "Failed to connect to multiplayer server. Please try again later.";
                    this.showConnectionErrorDialog(errorMessage);
                    reject(new Error(errorMessage));
                } else {
                    this.waitWorkerIsReady(resolve, reject, remainingTimeMs - 500);
                }
            }
        }, 500);
    }

    private onPlayerAdded(player: Player) {
        console.debug(`MP: onPlayerAdded: ${player.uuid}`, player);

        // Guard against empty or invalid UUID
        if (!player.uuid || player.uuid === "") {
            console.warn("MP: onPlayerAdded called with empty UUID, ignoring", player);
            return;
        }

        //add new player to the list
        this.players.set(player.uuid, player);
        const playerObject = this.remoteObjects.get(player.uuid);
        if (playerObject) {
            console.debug("MP: adding player to interpolated objects list: " + player.uuid);
            this.markRemotePlayerObject(playerObject, player);
            this.interpolatedObjects.set(player.uuid, playerObject);
        } else {
            console.debug(
                "MP.onPlayerAdded: player object not found in the remote objects: " + player.uuid,
                this.remoteObjects,
            );
        }
        //notify listeners
        for (const listener of this.playerAddedListeners.values()) {
            listener(player);
        }
    }

    private onPlayerRemoved(player: Player) {
        this.players.delete(player.uuid);
        this.interpolatedObjects.delete(player.uuid);
        //notify listeners
        for (const listener of this.playerRemovedListeners.values()) {
            listener(player);
        }
    }

    private onPlayerDataChanged(playerObjectUuid: string, key: string, value: string) {
        // Guard against empty or invalid UUID
        if (!playerObjectUuid || playerObjectUuid === "") {
            console.warn("MP: onPlayerDataChanged called with empty playerObjectUuid", {key, value});
            return;
        }

        const player = this.players.get(playerObjectUuid);
        if (!player) {
            console.error(`MP: onPlayerDataChanged: player is missing: ${playerObjectUuid}`, {
                key,
                value,
                playersCount: this.players.size,
                playerKeys: Array.from(this.players.keys()),
            });
            return;
        }
        player.data.set(key, value);
        //notify listeners
        for (const listener of this.playerDataChangedListeners.values()) {
            listener(player, key);
        }
    }

    private updateObjectWithInterpolation(
        object: Object3D,
        position: Vector3Like,
        quaternion: QuaternionLike,
        scale: Vector3Like,
        visible: boolean,
    ): void {
        const interpolatedPosition = InterpolationData.getCurrentValue(object) || position;
        this.updateObject(object, interpolatedPosition, quaternion, scale, visible);
    }

    private updateObject(
        object: Object3D,
        position: Vector3Like,
        quaternion: QuaternionLike,
        scale: Vector3Like,
        visible: boolean,
        material?: Material,
    ) {
        if (position) object.position.copy(position);
        if (quaternion) object.quaternion.copy(quaternion);
        if (scale) object.scale.copy(scale);
        if (material) MaterialData.setFromSchema(object, material);
        if (visible !== undefined) object.visible = visible;
    }

    private onHostChanged() {
        this.hostChangedListeners.forEach(listener => listener());
    }

    private onBehaviorDataChanged(uuid: string, behaviorId: string, key: string, value: string) {
        //update the local data storage
        this.behaviorData.setBehaviorData(uuid, behaviorId, key, value);

        //notify the behavior
        const target = findObjectByUuidDepthFirst(this.scene, uuid);
        if (target) {
            const behaviors = global.app?.game?.behaviorManager?.getTargetBehaviorsById(target, behaviorId);
            if (behaviors && behaviors.length > 0) {
                behaviors[0]!.onStateUpdated(key, value);
            } else {
                console.warn(`MP.behaviorData: behavior not found: ${uuid} -> ${behaviorId} -> ${key}`);
            }
        } else {
            console.warn(`MP.behaviorData: target object not found: ${uuid} -> ${behaviorId} -> ${key}`);
        }
    }

    private async cloneObject(objectState: GameObject): Promise<Object3D> {
        if (findObjectByUuidDepthFirst(this.scene, objectState.uuid)) {
            console.warn("Object already added to the scene: " + objectState.uuid);
            throw new Error("Object already added to the scene");
        }

        let object: Object3D | undefined = undefined;

        switch (objectState.templateType) {
            case String(TemplateType.MODEL_ASSET):
                object = await this.cloneModelAsset(objectState);
                break;
            case String(TemplateType.PREFAB_ASSET):
                object = await this.clonePrefabAsset(objectState);
                break;
            case String(TemplateType.UUID):
                object = await this.cloneUUID(objectState);
                break;
            case String(TemplateType.URL):
                console.warn("Not implemented: clone by model URL");
                break;
            case String(TemplateType.PRIMITIVE):
                console.warn("Not implemented: clone primitive");
                break;
            default:
                console.error("Template type not supported: " + objectState.templateType);
                break;
        }

        if (!object) {
            throw new Error("Failed to clone object");
        }

        this.applyObjectSettings(object, objectState);
        this.scene.add(object);
        return object;
    }

    private applyObjectSettings(object: Object3D, objectState: GameObject) {
        object.uuid = objectState.uuid; //set new object uuid to the remote player uuid
        object.name = objectState.name + " Remote";
        object.position.set(objectState.position.x, objectState.position.y, objectState.position.z);
        object.quaternion.set(
            objectState.quaternion.x,
            objectState.quaternion.y,
            objectState.quaternion.z,
            objectState.quaternion.w,
        );
        object.scale.set(objectState.scale.x, objectState.scale.y, objectState.scale.z);
        object.setRotationFromQuaternion(object.quaternion);
        object.visible = objectState.visible;

        if (objectState.animation) {
            global.app!.animationControl?.playAnimation(object, objectState.animation, 1);
        }
    }

    private async cloneModelAsset(objectState: GameObject): Promise<Object3D> {
        const assetRefStr = objectState.template;
        const assetRefTokens = assetRefStr.split(":");
        if (assetRefTokens.length !== 2) {
            console.error("Invalid template for model: " + assetRefStr);
            throw new Error("Invalid template for model");
        }

        const assetId = assetRefTokens[0]!;
        const revisionId = assetRefTokens[1]!;

        return loadModel(assetId, {
            assetIdToRevisionId: {
                [assetId]: revisionId,
            },
        });
    }

    private async clonePrefabAsset(objectState: GameObject): Promise<Object3D> {
        const assetRefStr = objectState.template;
        const assetRefTokens = assetRefStr.split(":");
        if (assetRefTokens.length !== 2) {
            console.error("Invalid template for prefab: " + assetRefStr);
            throw new Error("Invalid template for prefab");
        }

        const assetId = assetRefTokens[0]!;
        const revisionId = assetRefTokens[1]!;

        return loadPrefab(assetId, {
            assetIdToRevisionId: {
                [assetId]: revisionId,
            },
        });
    }

    private async cloneUUID(objectState: GameObject): Promise<Object3D> {
        const templateUuid = objectState.template;

        const objectTemplate = findObjectByUuidDepthFirst(this.scene, templateUuid);
        if (!objectTemplate) {
            console.warn(`MP: object template is not in the scene: ${templateUuid}`);
            throw new Error("Object template is not in the scene");
        }

        const clonedObject = MultiplayerUtils.cloneObject(this.physics, objectTemplate);

        const physicsConfig = PhysicsUtil.getPhysicsConfig(objectTemplate);

        //add to physics if shape is set
        if (objectState.shape) {
            //reset physics to kinematic type
            clonedObject.userData.physics = {
                enabled: true,
                type: "rigidBody",
                shape: objectState.shape,
                // Copy several properties from the original object
                shapeExcludesHiddenObjects: physicsConfig?.shapeExcludesHiddenObjects,
                userShapeOffset: physicsConfig?.userShapeOffset || {x: 0, y: 0, z: 0},
                userShapeScale: physicsConfig?.userShapeScale || {x: 1, y: 1, z: 1},
                mass: 0,
                inertia: {
                    x: 0,
                    y: 0,
                    z: 0,
                },
                restitution: 0,
                ctype: "Kinematic",
                friction: 0,
            };

            const {PhysicsUtil: ShapePhysicsUtil} = await import("@stem/editor-oss/physics/PhysicsUtil");
            ShapePhysicsUtil.updateShapeOffsetAndScale(clonedObject);
            await ShapePhysicsUtil.addObjectShapeToPhysics(clonedObject, this.physics, objectTemplate);
        }

        return clonedObject;
    }

    private handleErrorAction(action?: string) {
        if (!action) return;
        switch (action) {
            case ErrorAction.RETURN_TO_DASHBOARD as string:
                this.goToDashboard();
                break;
            default:
                console.warn("MP: handleErrorAction: action not supported: " + action);
        }
    }

    private showConnectionErrorDialog(error: string, action?: string) {
        const message = error || "Failed to connect to multiplayer server. Please try again later.";
        if (this.closeConnectionErrorDialog) {
            return;
        }

        const isPlayerOnlyRoute = !!global.app?.options?.isPlayModeOnly;
        const primaryActionLabel = isPlayerOnlyRoute ? "Retry" : "Dismiss";
        const secondaryActionLabel = "Dashboard";

        const dialog = showConfirm({
            title: "Failed to connect to multiplayer server",
            content: message,
            okText: primaryActionLabel,
            cancelText: secondaryActionLabel,
            onOK: () => {
                this.clearConnectionErrorDialog();
                if (isPlayerOnlyRoute) {
                    window.location.reload();
                    return;
                }
                void global.app?.setMode(ApplicationMode.EDIT);
            },
            onCancel: () => {
                this.clearConnectionErrorDialog();
                if (action === (ErrorAction.RETURN_TO_DASHBOARD as string)) {
                    this.handleErrorAction(action);
                    return;
                }
                this.goToDashboard();
            },
            onClose: () => {
                this.clearConnectionErrorDialog();
                this.goToDashboard();
            },
        });

        if (dialog.component) {
            this.closeConnectionErrorDialog = dialog.close;
            return;
        }

        const retry = window.confirm(
            isPlayerOnlyRoute
                ? `Failed to connect to multiplayer server.\n\n${message}\n\nPress OK to retry or Cancel to go back to the dashboard.`
                : `Failed to connect to multiplayer server.\n\n${message}\n\nPress OK to go back or Cancel to open the dashboard.`,
        );
        if (retry) {
            if (isPlayerOnlyRoute) {
                window.location.reload();
                return;
            }
            void global.app?.setMode(ApplicationMode.EDIT);
            return;
        }
        this.goToDashboard();
    }

    private clearConnectionErrorDialog() {
        this.closeConnectionErrorDialog = undefined;
    }

    private goToDashboard() {
        window.location.href = "/dashboard";
    }

    private isPlayer(object: Object3D): boolean {
        return object.uuid === this.playerUuid;
    }

    update(): void {
        //move interpolated objects
        this.interpolatedObjects.forEach(object => {
            this.updateObjectWithInterpolation(
                object,
                object.position,
                undefined as any,
                undefined as any,
                undefined as any,
            );
        });

        if (this.workerReady) {
            // Local obj updates
            for (const object of this.localObjects.values()) {
                const objectState = ObjectState.getObjectState(object, false, this.isPlayer(object));
                if (!objectState) {
                    continue;
                }
                this.workerHandler?.postMessage({
                    event: MULTIPLAYER_EVENTS.OBJECT.UPDATE,
                    uuid: object.uuid,
                    objectState,
                });
            }
        }
    }

    public addChild(object: Object3D, child: Object3D): void {
        const childState = ObjectState.getChildState(child, -1, getObjectTemplateType(child), getObjectTemplate(child));
        if (!child.parent) {
            console.warn(`MP: addChild: child has no parent: ${child.uuid}/${child.name}`);
            return;
        }
        childState.parent = child.parent.uuid;
        this.workerHandler!.postMessage({
            event: MULTIPLAYER_EVENTS.OBJECT.CHILD.ADD,
            uuid: object.uuid,
            child: childState,
        });
    }

    public removeChild(object: Object3D, childUuid: string): void {
        this.workerHandler!.postMessage({
            event: MULTIPLAYER_EVENTS.OBJECT.CHILD.REMOVE,
            uuid: object.uuid,
            child: childUuid,
        });
    }

    // IMultiplayerState

    //private rooms

    public async createPrivateRoom(name: string): Promise<PrivateRoomInfo> {
        const url = backendUrlFromPath("/mp/api/private-rooms/", true);
        const response = await Ajax.post({
            url: url,
            data: JSON.stringify({
                name: name,
                sceneId: this.sceneId,
                maxPlayers: this.maxClientsPerRoom,
                settings: {
                    allowWaitingList: false,
                    autoStart: true,
                },
            }),
            msgBodyType: "json",
            needAuthorization: true,
        });
        if (response?.status === 201) {
            const data = response.data as RoomInfoResponse;
            return {name: data.name, inviteCode: data.inviteCode};
        }

        return null as unknown as PrivateRoomInfo;
    }

    public async getPrivateRooms(): Promise<PrivateRoomInfo[]> {
        const url = backendUrlFromPath("/mp/api/private-rooms/my/rooms", true);
        const response = await Ajax.get({url: url, needAuthorization: true});
        if (response?.status === 200) {
            const data = response.data.rooms as RoomInfoResponse[];
            if (Array.isArray(data)) {
                return data.map(room => {
                    return {name: room.name, inviteCode: room.inviteCode};
                });
            } else {
                console.warn("MP: getPrivateRooms: invalid response", data);
            }
        }
        return [];
    }

    public async deletePrivateRoom(inviteCode: string): Promise<void> {
        const url = backendUrlFromPath(`/mp/api/private-rooms/${inviteCode}`, true);
        const response = await Ajax.ajaxDelete({url: url, needAuthorization: true});
        if (response?.status !== 200) {
            console.warn("MP: deletePrivateRoom: failed to delete room", response);
        }
    }

    //invites

    public getInviteCode(): string | null {
        return this.inviteCode;
    }

    public async getRoomInfo(inviteCode: string): Promise<RoomInfo> {
        const url = backendUrlFromPath(`/mp/api/match/scenes/${this.sceneId}/${inviteCode}`, true);
        console.debug(`MP: getRoomInfo: ${url}`);

        try {
            const response = await Ajax.get({
                url: url,
                needAuthorization: false,
            });
            console.debug("MP: getRoomInfo: response=", response);
            if (response?.status !== 200) {
                console.warn("MP: getRoomInfo: failed to get room info", response);
                throw new Error("Failed to get room info");
            }

            return response?.data as RoomInfo;
        } catch (error) {
            console.warn("MP: getRoomInfo: failed to get room info", error);
            throw new Error("No room found for invite code");
        }
    }

    //disconnects

    public disconnect() {
        this.workerHandler!.postMessage({event: MULTIPLAYER_EVENTS.DISCONNECT});
    }

    public async reconnect(inviteCode?: string, removeLocalObjects = false): Promise<void> {
        console.debug("MP: reconnect...");
        //save old player for data restoration
        let oldPlayer = null;
        //disconnect and stop the worker if it is running
        if (this.workerHandler) {
            //cleanup local objects
            if (removeLocalObjects) {
                //remove all local objects except for the player
                this.localObjects.forEach(object => {
                    if (object.uuid !== this.playerUuid) {
                        (global.app as EngineRuntime)?.game?.removeObject(object);
                    }
                });
                this.localObjects.clear();
            }
            this.localObjects.delete(this.playerUuid!); //re-add a player object on reconnect
            oldPlayer = this.player;
            //stop the worker
            await this.terminate();
            //remove remote objects
            this.onClientDisconnected(true);
        }
        //start the worker
        await this.start(inviteCode);
        //and local objects
        this.localObjects.forEach(object => {
            this.addObject(object);
        });
        //add player
        const playerObject = findObjectByUuidDepthFirst(this.scene, this.playerUuid);
        if (playerObject) {
            if (!this.localObjects.has(playerObject.uuid)) {
                this.addObject(playerObject);
            }
            this.setPlayer(playerObject);
        }
        //set player data
        console.debug("MP: reconnect - set player data: " + oldPlayer?.data?.size);
        oldPlayer?.data.forEach((value, key) => {
            this.setPlayerData(key, value);
        });
    }

    public addOnClientDisconnectedListener(listener: ClientDisconnectedListener): string {
        const token = MathUtils.generateUUID();
        this.clientDisconnectedListeners.set(token, listener);
        return token;
    }

    public removeOnClientDisconnectedListener(token: string): void {
        this.clientDisconnectedListeners.delete(token);
    }

    public isHost() {
        return this.hostSessionId === this.player?.sessionId;
    }

    public addOnHostChangedListener(listener: HostChangedListener): string {
        const token = MathUtils.generateUUID();
        this.hostChangedListeners.set(token, listener);
        return token;
    }

    public removeOnHostChangedListener(token: string) {
        this.hostChangedListeners.delete(token);
    }

    public addObject(object: Object3D) {
        const templateType = getObjectTemplateType(object);
        const template = getObjectTemplate(object);
        if (templateType && template) {
            const shape = PhysicsUtil.getPhysicsShape(object, PhysicsShape.BOX);
            const animationParams = AnimationController.getCurrentAnimationParams(object);
            const objectState = ObjectState.getObjectState(
                object,
                true,
                this.isPlayer(object),
                templateType,
                template,
                shape,
                JSON.stringify(animationParams),
            );
            if (objectState) {
                this.localObjects.set(object.uuid, object);
                this.workerHandler?.postMessage({event: MULTIPLAYER_EVENTS.OBJECT.ADD, uuid: object.uuid, objectState});
            }
        }
    }

    public static checkChildren(object: Object3D, force = false, isPlayer = false): ObjectState[] {
        if (!MultiplayerUtils.shouldSynchronizeChildren(object)) {
            return [];
        }

        const gameObjectMap = new Map<string, Object3D>();

        // CHILDREN
        traverseObjectDepthFirst(object, child => {
            // Skip the root object.
            if (child.uuid === object.uuid) return;

            //FIXME: hack for updated player object
            if (isPlayer && !child.userData.originalPlayerObject) return;

            if (!MultiplayerUtils.isValidChild(object, child)) return;

            if (!force && !ObjectState.isObjectStateChanged(child, true)) return;

            gameObjectMap.set(child.uuid, child);
        });

        let index = 0;
        const gameObjectArray: ObjectState[] = [];
        gameObjectMap.forEach(child => {
            const data = ObjectState.getChildState(child, index);
            gameObjectArray.push(data);
            index++;
        });

        return gameObjectArray;
    }

    public removeObject(uuid: string): void {
        if (this.localObjects.has(uuid)) {
            this.localObjects.delete(uuid);
            this.workerHandler?.postMessage({event: MULTIPLAYER_EVENTS.OBJECT.REMOVE, uuid: uuid});
        }
    }

    public setBehaviorData(object: Object3D, behaviorId: string, key: string, value: string): void {
        this.workerHandler?.postMessage({
            event: MULTIPLAYER_EVENTS.BEHAVIOR.DATA.SET,
            uuid: object.uuid,
            behaviorId,
            key,
            value,
        });
    }

    public getBehaviorData(object: Object3D, behaviorId: string, key: string): string | undefined {
        return this.behaviorData.getBehaviorData(object.uuid, behaviorId, key);
    }

    public getPlayers(): Map<string, Player> {
        return this.players;
    }

    public addOnPlayerAddedListener(listener: (player: Player) => void): string {
        const token = MathUtils.generateUUID();
        this.playerAddedListeners.set(token, listener);
        return token;
    }

    public removeOnPlayerAddedListener(token: string): void {
        this.playerAddedListeners.delete(token);
    }

    public addOnPlayerRemovedListener(listener: (player: Player) => void): string {
        const token = MathUtils.generateUUID();
        this.playerRemovedListeners.set(token, listener);
        return token;
    }

    public removeOnPlayerRemovedListener(token: string): void {
        this.playerRemovedListeners.delete(token);
    }

    public setPlayerData(key: string, value: string): void {
        this.player?.data.set(key, value);
        this.workerHandler?.postMessage({event: MULTIPLAYER_EVENTS.PLAYER.DATA.SET, key, value});
    }

    public addOnPlayerDataChangedListener(listener: PlayerDataChangedListener): string {
        const token = MathUtils.generateUUID();
        this.playerDataChangedListeners.set(token, listener);
        return token;
    }

    public removeOnPlayerDataChangedListener(token: string): void {
        this.playerDataChangedListeners.delete(token);
    }

    //end of IMultiplayerState

    public setPlayer(playerObject: Object3D) {
        this.playerUuid = playerObject.uuid;
        const usesProfileAvatar = this.isGameUsingProfileAvatar();
        markLocalPlayerAvatar(playerObject, {
            playerId: this.userId,
            sourceObjectUuid: getObjectTemplate(playerObject) ?? undefined,
            usesProfileAvatar,
            avatarSource: usesProfileAvatar ? "profile-avatar" : "multiplayer-template",
        });
        if (this.player) {
            this.player.uuid = playerObject.uuid;
            this.workerHandler?.postMessage({event: MULTIPLAYER_EVENTS.PLAYER.SET, uuid: playerObject.uuid});
        }
    }

    private markRemotePlayerObject(playerObject: Object3D, player: Player): void {
        markRemotePlayerAvatar(playerObject, {
            playerId: player.id,
            sessionId: player.sessionId,
            playerName: player.name,
            sourceObjectUuid: player.origin || getObjectTemplate(playerObject) || undefined,
            usesProfileAvatar: this.isGameUsingProfileAvatar(),
            avatarSource: "multiplayer-template",
        });
    }

    private isGameUsingProfileAvatar(): boolean {
        return (global.app as EngineRuntime | null | undefined)?.game?.useAvatar?.() === true;
    }

    public disconnectClients(): void {
        this.workerHandler!.postMessage({event: MULTIPLAYER_EVENTS.DISCONNECT_CLIENTS});
    }
}

class InterpolationData {
    private static auxVector = new Vector3();

    public readonly value: Vector3 = new Vector3();
    public readonly delta: number = 0; //time since previous update
    public timestamp: number = 0; //when update was received

    public constructor(value: Vector3Like, delta: number, timestamp: number) {
        this.value.copy(value);
        this.delta = delta; //TODO: sliding window average
        this.timestamp = timestamp;
    }

    public static getCurrentValue(object: Object3D): Vector3 | null {
        const currUpdate = InterpolationData.getCurrentUpdate(object);
        if (!currUpdate) {
            return null;
        }
        const delta = Date.now() - currUpdate.timestamp;
        const progress = currUpdate.delta !== 0 ? delta / currUpdate.delta : 1;
        if (progress > 1) {
            return currUpdate.value;
        }
        return InterpolationData.auxVector.copy(object.position).lerp(currUpdate.value, progress <= 1 ? progress : 1);
    }

    public static setCurrentUpdate(object: Object3D, value: Vector3Like) {
        if (!object.userData.mpu) {
            object.userData.mpu = {prevUpdate: null, currUpdate: null};
        }
        const timestamp = Date.now();
        const currUpdate = InterpolationData.getCurrentUpdate(object);
        //no prediction
        object.userData.mpu.currUpdate = new InterpolationData(
            value,
            currUpdate ? timestamp - currUpdate.timestamp : 0,
            timestamp,
        );
    }

    public static getCurrentUpdate(object: Object3D): InterpolationData | null {
        return object.userData.mpu && object.userData.mpu.currUpdate ? object.userData.mpu.currUpdate : null;
    }
}

export class ObjectState {
    public constructor(
        object: Object3D,
        childrenToSync?: ObjectState[],
        material?: MaterialData,
        index?: number,
        templateType?: TemplateType,
        template?: string,
        shape?: PhysicsShape,
        animation?: string,
        synchronizeChildren?: boolean,
    ) {
        this.uuid = object.uuid;
        this.name = object.name;
        this.index = index;
        this.templateType = templateType;
        this.template = template;
        this.shape = shape;
        this.synchronizeChildren = synchronizeChildren;
        this.data = {
            position: {
                x: object.position.x,
                y: object.position.y,
                z: object.position.z,
            },
            quaternion: {
                x: object.quaternion.x,
                y: object.quaternion.y,
                z: object.quaternion.z,
                w: object.quaternion.w,
            },
            scale: {
                x: object.scale.x,
                y: object.scale.y,
                z: object.scale.z,
            },
            animation,
            visible: object.visible,
            material,
        };
        this.children = childrenToSync && childrenToSync.length > 0 ? childrenToSync : undefined;
    }

    public static getChildState(
        child: Object3D,
        index: number,
        templateType?: TemplateType,
        template?: string,
    ): ObjectState {
        const childState = new ObjectState(
            child,
            undefined,
            MaterialData.getMaterialState(child),
            index,
            templateType,
            template,
        );
        ObjectState.setPreviousState(child, childState.data.material);
        return childState;
    }

    public static getObjectState(
        object: Object3D,
        force: boolean,
        isPlayer: boolean,
        templateType?: TemplateType,
        template?: string,
        shape?: PhysicsShape,
        animation?: string,
    ): ObjectState | null {
        const objectNeedsSync = ObjectState.isObjectStateChanged(object);

        // Get children that need to be synced.
        const childrenToSync = SimpleMultiplayerClient.checkChildren(object, force, isPlayer);

        if (force || objectNeedsSync || childrenToSync.length > 0) {
            const objectState = new ObjectState(
                object,
                childrenToSync,
                undefined,
                undefined,
                templateType,
                template,
                shape,
                animation,
                MultiplayerUtils.shouldSynchronizeChildren(object),
            );

            ObjectState.setPreviousState(object);

            return objectState;
        }

        return null;
    }

    public static getPreviousState(object: Object3D): StoredState | null {
        return object.userData.mp && object.userData.mp.prev ? object.userData.mp.prev : null;
    }

    public static setPreviousState(object: Object3D, material?: MaterialData) {
        if (!object.userData.mp) {
            object.userData.mp = {prev: null};
        }
        object.userData.mp.prev = {
            position: object.position.clone(),
            quaternion: object.quaternion.clone(),
            scale: object.scale.clone(),
            visible: object.visible,
            material: material,
        } as StoredState;
    }

    public static isObjectStateChanged(object: Object3D, checkMaterial = false): boolean {
        const previousState = ObjectState.getPreviousState(object);
        return (
            !previousState ||
            object.position.distanceTo(previousState.position) > SimpleMultiplayerClient.THRESHOLD_MOVEMENT ||
            object.scale.distanceTo(previousState.scale) > SimpleMultiplayerClient.THRESHOLD_SCALE ||
            object.quaternion.dot(previousState.quaternion) < SimpleMultiplayerClient.THRESHOLD_QUATERNION ||
            object.visible !== previousState.visible ||
            (checkMaterial && MaterialData.isMaterialChanged(object, previousState)) ||
            MultiplayerUtils.isNeedsShapeUpdate(object)
        );
    }

    uuid: string;
    name: string;
    data: {
        position: {
            x: number;
            y: number;
            z: number;
        };
        quaternion: {
            x: number;
            y: number;
            z: number;
            w: number;
        };
        scale: {
            x: number;
            y: number;
            z: number;
        };
        animation?: string;
        visible?: boolean;
        material?: MaterialData;
    };
    synchronizeChildren?: boolean;
    templateType?: string;
    template?: string;
    shape?: string;
    children?: ObjectState[];
    parent?: string;
    index?: number;
}

class BehaviorDataStorage {
    private readonly data: Map<string, Map<string, Map<string, string>>> = new Map();

    public getBehaviorData(uuid: string, behaviorId: string, key: string): string | undefined {
        const objectStorage = this.data.get(uuid);
        if (objectStorage) {
            const behaviorStorage = objectStorage.get(behaviorId);
            if (behaviorStorage) {
                return behaviorStorage.get(key);
            }
        }
        return undefined;
    }

    public setBehaviorData(uuid: string, behaviorId: string, key: string, value: string): void {
        let objectStorage = this.data.get(uuid);
        if (!objectStorage) {
            objectStorage = new Map();
            this.data.set(uuid, objectStorage);
        }
        let behaviorStorage = objectStorage.get(behaviorId);
        if (!behaviorStorage) {
            behaviorStorage = new Map();
            objectStorage.set(behaviorId, behaviorStorage);
        }
        behaviorStorage.set(key, value);
    }

    public clear() {
        this.data.clear();
    }
}

class MaterialData {
    constructor(object: Object3D) {
        this.valid = MaterialData.isValidObject(object);
        if (this.valid) {
            const material = (object as Mesh).material as MeshStandardMaterial;
            this.emissive = material.emissive.getHex();
            this.color = material.color.getHex();
            this.opacity = material.opacity;
            if (material.map) {
                this.map_wrapS = material.map.wrapS;
                this.map_wrapT = material.map.wrapT;
            }
        }
    }

    static isValidObject(object: Object3D): boolean {
        return (object as Mesh).isMesh && (object as Mesh).material instanceof MeshStandardMaterial;
    }

    static setFromSchema(object: Object3D, materialSchema: Material) {
        if (MaterialData.isValidObject(object)) {
            const material = (object as Mesh).material as MeshStandardMaterial;
            material.emissive.setHex(materialSchema.emissive);
            material.color.setHex(materialSchema.color);
            material.opacity = materialSchema.opacity;
            if (material.map) {
                material.map.wrapS = materialSchema.map_wrapS as Wrapping;
                material.map.wrapT = materialSchema.map_wrapT as Wrapping;
            }
        }
    }

    static cloneMaterial(object: Object3D) {
        if (MaterialData.isValidObject(object)) {
            (object as Mesh).material = ((object as Mesh).material as MeshStandardMaterial).clone();
            return true;
        }
        return false;
    }

    static isMaterialChanged(object: Object3D, previousState: StoredState) {
        if (!MaterialData.isValidObject(object) || !previousState || !previousState.material) {
            return false;
        }
        const material = (object as Mesh).material as MeshStandardMaterial;
        const equal =
            material.emissive.getHex() === previousState.material.emissive &&
            material.color.getHex() === previousState.material.color &&
            material.opacity === previousState.material.opacity &&
            (!material.map ||
                (material.map.wrapS === previousState.material.map_wrapS &&
                    material.map.wrapT === previousState.material.map_wrapT));
        return !equal;
    }

    static getMaterialState(object: Object3D): MaterialData | undefined {
        if (!MaterialData.isValidObject(object)) {
            return undefined;
        }
        //TODO: reuse existing state
        return new MaterialData(object);
    }

    valid: boolean = false;

    emissive: number = 0;
    color: number = 0;
    opacity: number = 0;
    map_wrapS: number = -1;
    map_wrapT: number = -1;
}
