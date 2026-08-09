import {Object3D} from "three";

import type {Player} from "../../multiplayer/GameRoomState";

export enum PlayerAnimations{
    IDLE = "Idle"
}

//must match with values from types.ts
export enum PhysicsShape {
    BOX = "btBoxShape",
    SPHERE = "btSphereShape",
    CAPSULE = "btCapsuleShape",
    CONVEX_HULL = "btConvexHullShape",
    CONCAVE_HULL = "btConcaveHullShape",
}

export type ClientDisconnectedListener = (consented: boolean) => void;
export type HostChangedListener = () => void;
export type PlayerAddedOrRemovedListener = (player: Player) => void;
export type PlayerDataChangedListener = (player: Player, key: string) => void;
export type ChatMessageReceivedListener = (messageId: string, senderId: string, message: string, filtered: boolean, timestamp: number) => void;
export type PrivateRoomInfo = {
    name: string;
    inviteCode: string;
}
export type RoomInfo = {
    roomId: string;
    sceneId: string;
    inviteCode: string;
    isPrivate: boolean;
    isRunning: boolean;
}


//used for storing behavior data and simple multiplayer support
export interface IMultiplayerState {
    //called by the GameManager once it's initialized
    start(inviteCode?: string): Promise<void>;

    //called on every frame
    update(deltaTime: number): void;

    //invite
    getInviteCode(): string | null;
    getRoomInfo(inviteCode: string): Promise<RoomInfo>;

    //private tables
    createPrivateRoom(name: string): Promise<PrivateRoomInfo>;
    getPrivateRooms(): Promise<PrivateRoomInfo[]>;
    deletePrivateRoom(inviteCode: string): Promise<void>;

    //disconnects
    disconnect(): void;
    reconnect(inviteCode?: string, removeLocalObjects?: boolean): Promise<void>;
    addOnClientDisconnectedListener(listener: ClientDisconnectedListener): string;
    removeOnClientDisconnectedListener(token: string): void;

    //indicates a client responsible for running global behaviors (like day-night cycle, etc.)
    isHost(): boolean;
    addOnHostChangedListener(listener: HostChangedListener): string;
    removeOnHostChangedListener(token: string): void;

    //chat
    sendChatMessage(message: string): void;
    addOnChatMessageReceivedListener(listener: ChatMessageReceivedListener): string;
    removeOnChatMessageReceivedListener(token: string): void;

    //unique number associated with this client ranged from 0 to max_clients
    getSlot(): number;

    // share and persist behavior data
    setBehaviorData(object: Object3D, behaviorId: string, key: string, data: string): void;
    getBehaviorData(object: Object3D, behaviorId: string, key: string) : string | undefined;

    //players
    getPlayers(): Map<string, Player>;
    addOnPlayerAddedListener(listener: PlayerAddedOrRemovedListener): string;
    removeOnPlayerAddedListener(token: string): void;
    addOnPlayerRemovedListener(listener:PlayerAddedOrRemovedListener): string;
    removeOnPlayerRemovedListener(token: string): void;

    //player data
    setPlayerData(key: string, value: string): void;
    addOnPlayerDataChangedListener(listener: PlayerDataChangedListener): string;
    removeOnPlayerDataChangedListener(token: string): void;

    //animations
    setCurrentAnimation(objectUuid: string, animation: string): void;

    addChild(object: Object3D, child: Object3D): void;
    removeChild(object: Object3D, childUuid: string): void;

    //TEST ONLY - add objects to physics instead
    // add an object to synchronize between clients
    // addObject(object: Object3D, templateType: TemplateType, templateValue: string, shape: PhysicsShape, animation?: string): void;
    // removeObject(uuid: string): void;
}
